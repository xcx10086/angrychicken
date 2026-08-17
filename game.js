/**
 * Angry Chicken - Core Game Logic
 *
 * 统筹游戏主循环、状态机（AIMING / FLYING / RESOLVING / WIN / LOSE）、
 * 关卡进度管理与胜负判定，作为协调各模块的中枢。
 *
 * 全局对象：Game
 * 接口：
 *   Game.start()           — 启动主循环
 *   Game.stop()            — 停止主循环
 *   Game.loadLevel(n)      — 加载第 n 关（1-based）
 *   Game.fire()            — 发射炮弹（AIMING 态可用）
 *   Game.State             — 状态枚举
 *   Game.onStateChange(fn) — 状态变化回调
 *
 * 依赖：
 *   Physics（physics.js）— 物理模拟
 *   可选模块（若存在则调用，缺失时安全降级）：
 *     Renderer.draw(bodies, state, info)
 *     Input.poll()
 *     Cannon.update(dt)
 *     Cannon.onFire / Cannon.canFire
 *
 * 技术要点：
 *   - requestAnimationFrame 主循环，固定逻辑步长 1/60s
 *   - 状态切换前清理中间态（飞行中炮弹、碎片）
 *   - RESOLVING 态有 1s 延迟，等碎片静止后再判定
 *   - 炮弹耗尽且牛头未清 = 失败；所有牛头消灭 = 通关
 */

const Game = (function () {
  // ── 状态枚举 ────────────────────────────────────────────────
  const State = {
    AIMING: "AIMING",
    FLYING: "FLYING",
    RESOLVING: "RESOLVING",
    WIN: "WIN",
    LOSE: "LOSE",
  };

  // ── 配置 ─────────────────────────────────────────────────────
  const FIXED_DT = 1 / 60;            // 固定逻辑步长（秒）
  const MAX_FRAME_STEPS = 5;          // 单帧最大步进数，防止螺旋死亡
  const RESOLVE_DELAY = 1000;         // RESOLVING → 判定前的延迟（ms）
  const RESOLVE_FRAMES = 60;         // RESOLVING 延迟帧数（固定步长 1/60s × 60 = 1s）
  const PROJECTILE_REST_SPEED = 5;    // 炮弹静止阈值（px/s）
  const WORLD = {                      // 世界边界（屏幕坐标，y 向下为正）
    left: 0,
    top: 0,
    right: 800,
    bottom: 480,
  };

  // ── 内部状态 ────────────────────────────────────────────────
  let state = State.AIMING;
  let running = false;
  let rafId = null;
  let lastTime = 0;
  let accumulator = 0;

  // 关卡数据
  let currentLevel = 0;
  let unlockedLevel = 0;              // 已解锁的最高关卡
  let projectilesLeft = 0;
  let maxProjectiles = 0;

  // 发射的炮弹引用（FLYING 态追踪用）
  let activeProjectiles = [];
  // RESOLVING 延迟计时
  let resolveTimer = 0;
  let resolveFrames = 0;
  // FLYING 超时兜底：炮弹飞行超过该时长（ms）强制结算
  const FLYING_TIMEOUT = 5000;

  // 状态变化回调
  let _stateChangeCb = null;

  // 可选模块引用（运行时探测）
  function getRenderer() {
    return (typeof window !== "undefined" && window.Renderer) ||
      (typeof globalThis !== "undefined" && globalThis.Renderer) || null;
  }
  function getInput() {
    return (typeof window !== "undefined" && window.Input) ||
      (typeof globalThis !== "undefined" && globalThis.Input) || null;
  }
  function getCannon() {
    return (typeof window !== "undefined" && window.Cannon) ||
      (typeof globalThis !== "undefined" && globalThis.Cannon) || null;
  }
  function getPhysics() {
    return (typeof window !== "undefined" && window.Physics) ||
      (typeof globalThis !== "undefined" && globalThis.Physics) || null;
  }

  // ── 关卡数据 ────────────────────────────────────────────────
  // 内置关卡：pigs（牛头位置）、blocks（建筑）、projectiles（本关炮弹数）
  const LEVELS = [
    {
      name: "第 1 关",
      projectiles: 3,
      pigs: [{ x: 600, y: 420, radius: 16, mass: 1 }],
      blocks: [
        { x: 560, y: 430, radius: 14, mass: 1 },
        { x: 640, y: 430, radius: 14, mass: 1 },
      ],
    },
    {
      name: "第 2 关",
      projectiles: 4,
      pigs: [
        { x: 560, y: 420, radius: 16, mass: 1 },
        { x: 660, y: 420, radius: 16, mass: 1 },
      ],
      blocks: [
        { x: 520, y: 430, radius: 14, mass: 1 },
        { x: 600, y: 430, radius: 14, mass: 1 },
        { x: 680, y: 430, radius: 14, mass: 1 },
        { x: 610, y: 400, radius: 14, mass: 1 },
      ],
    },
    {
      name: "第 3 关",
      projectiles: 5,
      pigs: [
        { x: 500, y: 420, radius: 16, mass: 1 },
        { x: 640, y: 420, radius: 16, mass: 1 },
        { x: 720, y: 380, radius: 16, mass: 1 },
      ],
      blocks: [
        { x: 460, y: 430, radius: 14, mass: 1 },
        { x: 540, y: 430, radius: 14, mass: 1 },
        { x: 600, y: 430, radius: 14, mass: 1 },
        { x: 680, y: 430, radius: 14, mass: 1 },
        { x: 580, y: 395, radius: 14, mass: 1 },
        { x: 690, y: 395, radius: 14, mass: 1 },
      ],
    },
  ];

  // ── 世界搭建 ────────────────────────────────────────────────
  function setupWorld() {
    const Physics = getPhysics();
    if (!Physics) return;
    Physics.clear();

    // 地面：薄条贴在世界底部下方，不侵入游戏区。
    // 用较窄的半径 + 靠下放置，避免巨型刚体罩住整个场景。
      Physics.addBody({
      x: (WORLD.left + WORLD.right) / 2,
      y: WORLD.bottom + 8,
      vx: 0, vy: 0,
      radius: 8,
      mass: 99999,
      type: "ground",
    isStatic: true,
});

    // 左右边界不设墙刚体（避免大半径圆形侵入游戏区），
      // 改由每个动态刚体的 _worldBounds 边界约束负责挡边。

    // 碰撞回调：交给可选模块或内部空处理
    Physics.onCollision(function (a, b, impact) {
      const Cannon = getCannon();
      if (Cannon && typeof Cannon.onCollision === "function") {
        Cannon.onCollision(a, b, impact);
      }
    });
  }

  function loadLevelData(n) {
    const level = LEVELS[n - 1];
    if (!level) return false;
    const Physics = getPhysics();
    if (!Physics) return false;

    setupWorld();
    activeProjectiles = [];

    // 放置牛头
    for (const p of level.pigs) {
      const pig = {
        x: p.x, y: p.y, vx: 0, vy: 0,
        radius: p.radius, mass: p.mass,
        type: "pig", isStatic: false,
        onHit: function (impact) {
          pig._lastHitImpact = impact;
          pig._hp = ((pig._hp ?? 1)) - 1;
        },
      };
      pig._hp = 1;
      Physics.addBody(pig);
    }

    // 放置建筑
    for (const b of level.blocks) {
      const block = {
        x: b.x, y: b.y, vx: 0, vy: 0,
        radius: b.radius, mass: b.mass,
        type: "block", isStatic: false,
        _worldBounds: WORLD,
      };
      Physics.addBody(block);
    }

    // 给非静态物体也挂上世界边界（用于地面约束）
    for (const body of Physics.getBodies()) {
      if (!body.isStatic && !body._worldBounds) {
        body._worldBounds = WORLD;
      }
    }

    maxProjectiles = level.projectiles;
    projectilesLeft = level.projectiles;
    currentLevel = n;
    return true;
  }

  // ── 状态机 ──────────────────────────────────────────────────
  function setState(next) {
    if (state === next) return;
    const prev = state;
    state = next;
    if (_stateChangeCb) {
      try { _stateChangeCb(next, prev); } catch (e) { /* 回调异常不影响主循环 */ }
    }
  }

  /**
   * 清理中间态：移除飞行中的炮弹与残留碎片。
   * 在状态切换前调用，确保进入下一态时物理世界是干净的。
   */
  function clearTransientBodies() {
    const Physics = getPhysics();
    if (!Physics) return;
    const toRemove = [];
    for (const b of Physics.getBodies()) {
      if (b.type === "projectile" || b.type === "debris") {
        toRemove.push(b);
      }
    }
    for (const b of toRemove) Physics.removeBody(b);
    activeProjectiles = [];
  }

  /**
   * 进入 RESOLVING 态：记录开始时间，延迟判定。
   */
  function enterResolving() {
    setState(State.RESOLVING);
    resolveTimer = performanceNow();
    resolveFrames = 0;
  }

  /**
   * RESOLVING 延迟到期后执行胜负判定。
   */
  function resolveOutcome() {
    const Physics = getPhysics();
    if (!Physics) { setState(State.LOSE); return; }

    // 清理飞行炮弹与碎片，只保留 pig/block/ground/wall
    clearTransientBodies();

    // 统计剩余牛头
    const pigs = Physics.getBodies().filter(b => b.type === "pig");
    const pigsAlive = pigs.filter(p => (p._hp ?? 1) > 0);

    if (pigsAlive.length === 0) {
      // 通关：解锁下一关
      unlockedLevel = Math.max(unlockedLevel, currentLevel + 1);
      setState(State.WIN);
    } else if (projectilesLeft <= 0) {
      // 炮弹耗尽且仍有牛头 → 失败
      setState(State.LOSE);
    } else {
      // 还有炮弹，回到瞄准态继续
      setState(State.AIMING);
    }
  }

  // ── 主循环 ──────────────────────────────────────────────────
  function tick(now) {
    if (!running) return;
    if (!lastTime) lastTime = now;
    let frameDt = (now - lastTime) / 1000;
    lastTime = now;
    // 限制单帧时间，避免切后台后大跳
    if (frameDt > 0.25) frameDt = 0.25;

    accumulator += frameDt;
    let steps = 0;
    while (accumulator >= FIXED_DT && steps < MAX_FRAME_STEPS) {
      update(FIXED_DT);
      accumulator -= FIXED_DT;
      steps++;
    }
    // 防止累加器爆炸
    if (accumulator > FIXED_DT * MAX_FRAME_STEPS) accumulator = 0;

    render();
    if (running) rafId = requestAnimationFrame(tick);
  }

  /**
   * 单帧步进：推进一个固定步长的逻辑 + 渲染。
   * 供 tick 内部与测试/调试复用，不依赖 running 标志。
   */
  function stepFrame(dt) {
    update(dt != null ? dt : FIXED_DT);
    render();
  }

  /**
   * 固定步长逻辑更新。
   */
  function update(dt) {
    const Physics = getPhysics();
    const Input = getInput();
    const Cannon = getCannon();

    // 输入轮询（可选）
    if (Input && typeof Input.poll === "function") {
      Input.poll();
    }

    switch (state) {
      case State.AIMING: {
        // 瞄准态：更新炮台，等待发射
        if (Cannon && typeof Cannon.update === "function") {
          Cannon.update(dt);
        }
        break;
      }
      case State.FLYING: {
        // 飞行态：推进物理
        if (Physics) Physics.update(dt);
        if (Cannon && typeof Cannon.update === "function") {
          Cannon.update(dt);
        }
        // 检测所有活跃炮弹是否静止 / 出界
        let allStopped = true;
        const out = [];
        const nowMs = performanceNow();
          for (const p of activeProjectiles) {
            if (!p || Physics && !Physics.getBodies().includes(p)) {
            out.push(p);
          continue;
          }
          const speed = Math.abs(p.vx) + Math.abs(p.vy);
            const outOfBounds =
            p.x < WORLD.left - 50 || p.x > WORLD.right + 50 ||
          p.y > WORLD.bottom + 50;
            const timedOut = (p._fireTime || 0) && (nowMs - p._fireTime > FLYING_TIMEOUT);
          if (!outOfBounds && !timedOut && speed > PROJECTILE_REST_SPEED) {
            allStopped = false;
          } else {
        out.push(p);
        }
        }
          // 移除已停止/出界的炮弹
          for (const p of out) {
          if (Physics) Physics.removeBody(p);
        const idx = activeProjectiles.indexOf(p);
        if (idx >= 0) activeProjectiles.splice(idx, 1);
        }
          // 所有炮弹都停了 → 进入结算
        if (allStopped && activeProjectiles.length === 0) {
        enterResolving();
      }
        break;
      }
      case State.RESOLVING: {
        // 结算态：继续推进物理让碎片落定，等待延迟后判定
        if (Physics) Physics.update(dt);
        resolveFrames++;
          // 固定步长下用帧数判定（60帧=1s）；墙钟兜底
          const elapsed = (resolveTimer ? performanceNow() - resolveTimer : 0);
        if (resolveFrames >= RESOLVE_FRAMES || elapsed >= RESOLVE_DELAY) {
        resolveTimer = 0;
      resolveFrames = 0;
          resolveOutcome();
        }
        break;
      }
      case State.WIN:
      case State.LOSE:
        // 终态：不再推进物理
        break;
    }
  }

  /**
   * 渲染（可选模块）。
   */
  function render() {
    const Renderer = getRenderer();
    const Physics = getPhysics();
    if (!Renderer || typeof Renderer.draw !== "function") return;
    const bodies = Physics ? Physics.getBodies() : [];
    Renderer.draw(bodies, state, {
      level: currentLevel,
      projectilesLeft: projectilesLeft,
      maxProjectiles: maxProjectiles,
      unlockedLevel: unlockedLevel,
      totalLevels: LEVELS.length,
    });
  }

  // ── 时间工具 ────────────────────────────────────────────────
  function performanceNow() {
    if (typeof performance !== "undefined" && performance.now) return performance.now();
    return Date.now();
  }
  function requestAnimationFrame(cb) {
    if (typeof window !== "undefined" && window.requestAnimationFrame) {
      return window.requestAnimationFrame(cb);
    }
    // Node 环境（测试用）：用 setTimeout 模拟 60fps
    if (typeof globalThis !== "undefined" && !globalThis.requestAnimationFrame) {
      return setTimeout(() => cb(performanceNow()), 16);
    }
    if (typeof globalThis.requestAnimationFrame === "function") {
      return globalThis.requestAnimationFrame(cb);
    }
    return setTimeout(() => cb(performanceNow()), 16);
  }
  function cancelAnimationFrame(id) {
    if (typeof window !== "undefined" && window.cancelAnimationFrame) {
      return window.cancelAnimationFrame(id);
    }
    if (typeof globalThis !== "undefined" && globalThis.cancelAnimationFrame) {
      return globalThis.cancelAnimationFrame(id);
    }
    return clearTimeout(id);
  }

  // ── 公共 API ────────────────────────────────────────────────
  return {
    State,

    /** 启动主循环。会自动加载第 1 关（若尚未加载）。 */
    start() {
      if (running) return;
      if (currentLevel === 0) {
        this.loadLevel(1);
      }
      running = true;
      lastTime = 0;
      accumulator = 0;
      setState(State.AIMING);
      rafId = requestAnimationFrame(tick);
    },

    /** 停止主循环。 */
    stop() {
      running = false;
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    },

    /** 是否正在运行。 */
    isRunning() { return running; },

    /** 当前状态。 */
    getState() { return state; },

    /** 加载第 n 关（1-based）。 */
    loadLevel(n) {
      if (n < 1 || n > LEVELS.length) return false;
      const ok = loadLevelData(n);
      if (ok) {
        setState(State.AIMING);
        resolveTimer = 0;
        resolveFrames = 0;
        accumulator = 0;
      }
      return ok;
    },

    /**
     * 发射炮弹。
     * 仅 AIMING 态可用；若 Cannon 模块提供 fire/launch 则委托它，
     * 否则用默认弹道（从左下发射，水平向右）。
     * @param {object} opts 可选 { vx, vy, x, y }
     */
    fire(opts) {
      if (state !== State.AIMING) return false;
      if (projectilesLeft <= 0) return false;

      opts = opts || {};
      const Physics = getPhysics();
      const Cannon = getCannon();
      if (!Physics) return false;

      let proj;
      if (Cannon && typeof Cannon.fire === "function") {
        proj = Cannon.fire(opts);
      } else if (Cannon && typeof Cannon.launch === "function") {
        proj = Cannon.launch(opts);
        } else {
        // 默认弹道：从左下角附近发射，向右上方
          proj = {
          x: opts.x !== undefined ? opts.x : 80,
          y: opts.y !== undefined ? opts.y : 380,
          vx: opts.vx !== undefined ? opts.vx : 600,
          vy: opts.vy !== undefined ? opts.vy : -500,
          radius: 8,
          mass: 2,
          type: "projectile",
          isStatic: false,
        _worldBounds: WORLD,
      };
      }
      if (!proj) return false;
      // 确保炮弹有世界边界约束
      if (!proj._worldBounds) proj._worldBounds = WORLD;
      Physics.addBody(proj);
      proj._fireTime = performanceNow();
      activeProjectiles.push(proj);
      projectilesLeft--;

      // Cannon.onFire → FLYING
      if (Cannon && typeof Cannon.onFire === "function") {
        try { Cannon.onFire(proj); } catch (e) { /* 忽略 */ }
      }
      setState(State.FLYING);
      return true;
    },

    /** 剩余炮弹数。 */
    getProjectilesLeft() { return projectilesLeft; },

    /** 当前关卡序号。 */
    getCurrentLevel() { return currentLevel; },

    /** 已解锁关卡数。 */
    getUnlockedLevel() { return unlockedLevel; },

    /** 总关卡数。 */
    getTotalLevels() { return LEVELS.length; },

    /** 注册状态变化回调。 */
    onStateChange(fn) { _stateChangeCb = fn; },

    /**
     * 通关后加载下一关；若已是最后一关则保持 WIN 态。
     */
    nextLevel() {
      if (state !== State.WIN) return false;
      if (currentLevel >= LEVELS.length) return false;
      return this.loadLevel(currentLevel + 1);
    },

    /** 重置当前关。 */
    restartLevel() {
      if (currentLevel === 0) return false;
      return this.loadLevel(currentLevel);
    },

    /** 仅供测试/调试：直接触发结算判定。 */
    _resolveNow() {
      if (state === State.RESOLVING) {
        resolveTimer = 0;
        resolveOutcome();
      }
    },

    /** 仅供测试/调试：暴露内部数据。 */
    _internal: {
      LEVELS,
      WORLD,
      clearTransientBodies,
      setupWorld,
      stepFrame,
    },
  };
})();

// 暴露到全局
if (typeof window !== "undefined") {
  window.Game = Game;
}
if (typeof globalThis !== "undefined") {
  globalThis.Game = Game;
}
