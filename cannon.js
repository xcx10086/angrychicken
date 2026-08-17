/**
 * Angry Chicken - Cannon & Launch System
 *
 * 实现大炮的瞄准角度、力度控制、发射小鸡炮弹及炮口动画。
 *
 * 全局对象：Cannon
 * 接口：
 *   Cannon.config                 — 大炮配置 { x, y, maxForce, angleRange }
 *   Cannon.shotsLeft              — 剩余炮弹数
 *   Cannon.fire(opts?)            — 发射，返回炮弹对象 {x,y,vx,vy,radius,type}
 *   Cannon.canFire()             — 是否还能发射
 *   Cannon.update(dt)            — 推进炮口动画（后坐力 + 烟雾）
 *   Cannon.onFire(proj)           — 发射回调钩子（由 Game 调用）
 *   Cannon.onCollision(a,b,impact)— 碰撞回调（由 Physics 经 Game 透传）
 *   Cannon.input(event)           — 接收 Input 事件（dragStart/dragMove/dragEnd）
 *   Cannon.reset(shots)           — 重置炮弹数与瞄准状态
 *   Cannon.getAngle()             — 当前瞄准角度（弧度）
 *   Cannon.getForce()             — 当前蓄力（0~maxForce）
 *   Cannon.getRecoil()            — 当前后坐力偏移（0~1，供渲染）
 *   Cannon.getSmokeParticles()   — 炮口烟雾粒子列表（供渲染）
 *
 * 约定：
 *   - Canvas 坐标系 y 向下为正；角度用 atan2(dy, dx)
 *   - 拖拽方向即为发射方向：从炮口指向拖拽点的反方向（拉弓式）
 *   - 力度 = 拖拽距离 / 最大拖拽距离 * maxForce，clamp 到 [0, maxForce]
 *   - 角度范围限制：默认只允许向右半区发射（-80° ~ 80°，即不能向后）
 */

const Cannon = (function () {
  // ── 默认配置 ────────────────────────────────────────────────
  // x, y 为炮口位置；maxForce 为最大初速度；angleRange 为允许角度范围（弧度）
  const DEFAULT_MAX_DRAG = 200;       // 最大拖拽距离（px）
  const DEFAULT_RADIUS = 8;           // 炮弹半径
  const DEFAULT_MASS = 2;             // 炮弹质量
  const RECOIL_DURATION = 0.18;       // 后坐力动画时长（秒）
  const SMOKE_LIFETIME = 0.5;         // 烟雾粒子寿命（秒）
  const SMOKE_COUNT = 6;              // 单次发射烟雾粒子数

  let config = {
    x: 80,
    y: 380,
    maxForce: 1200,
    angleRange: { min: -Math.PI * 80 / 180, max: Math.PI * 80 / 180 },
  };

  // ── 内部状态 ────────────────────────────────────────────────
  let shotsLeft = 0;
  let aiming = false;
  let dragStart = null;       // { x, y } 拖拽起点
  let dragCurrent = null;     // { x, y } 当前拖拽点
  let angle = 0;              // 当前瞄准角度（弧度）
  let force = 0;              // 当前蓄力（0~maxForce）

  // 炮口动画状态
  let recoil = 0;             // 后坐力偏移 0~1
  let recoilTimer = 0;
  let smokeParticles = [];    // [{x,y,vx,vy,age,life}]

  // ── 工具函数 ────────────────────────────────────────────────
  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function dist(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * 将角度限制到 config.angleRange 范围内。
   * angleRange.min/max 是相对于水平向右（0 弧度）的偏移，
   * 负值表示向上（y 减小方向），正值表示向下。
   */
  function clampAngle(a) {
    const r = config.angleRange;
    if (!r) return a;
    return clamp(a, r.min, r.max);
  }

  // ── 输入处理 ────────────────────────────────────────────────
  /**
   * 接收 Input 事件。
   * dragStart/dragMove/dragEnd 事件需提供 { x, y } 位置坐标。
   */
  function input(event) {
    if (!event || !event.type) return;
    const pos = { x: event.x, y: event.y };
    switch (event.type) {
      case "dragStart":
        aiming = true;
        dragStart = pos;
        dragCurrent = pos;
        force = 0;
        break;
      case "dragMove":
        if (!aiming) return;
        dragCurrent = pos;
        updateAim();
        break;
      case "dragEnd":
        if (!aiming) return;
        dragCurrent = pos;
        updateAim();
        aiming = false;
        break;
    }
  }

  /**
   * 根据拖拽起止点更新瞄准角度与力度。
   * 拖拽方向：从炮口指向当前拖拽点。发射方向 = 拖拽方向。
   * （炮口在拖拽起点后方，拉得越远力越大，松手后炮弹朝拖拽方向飞出。）
   */
  function updateAim() {
    if (!dragStart || !dragCurrent) return;
    // 以拖拽起点为基准计算方向
    const dx = dragCurrent.x - dragStart.x;
    const dy = dragCurrent.y - dragStart.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 0.0001) {
      angle = 0;
      force = 0;
      return;
    }
    angle = clampAngle(Math.atan2(dy, dx));
    const ratio = clamp(d / DEFAULT_MAX_DRAG, 0, 1);
    force = ratio * config.maxForce;
  }

  // ── 发射 ────────────────────────────────────────────────────
  /**
   * 发射炮弹。
   * @param {object} [opts] 可选覆盖 { x, y, vx, vy, angle, force }
   * @returns {object|null} 炮弹对象，无法发射返回 null
   */
  function fire(opts) {
    opts = opts || {};
    if (shotsLeft <= 0) return null;

    // 优先使用显式传入的 angle/force，否则用当前瞄准值
    let fireAngle = opts.angle !== undefined ? opts.angle : angle;
    let fireForce = opts.force !== undefined ? opts.force : force;

    // 若没有拖拽且未显式传参，给一个默认水平发射
    if (fireForce === 0 && opts.vx === undefined && opts.vy === undefined) {
      fireAngle = 0;
      fireForce = config.maxForce * 0.5;
    }

    fireAngle = clampAngle(fireAngle);
    fireForce = clamp(fireForce, 0, config.maxForce);

    const vx = opts.vx !== undefined ? opts.vx : Math.cos(fireAngle) * fireForce;
    const vy = opts.vy !== undefined ? opts.vy : Math.sin(fireAngle) * fireForce;
    const x = opts.x !== undefined ? opts.x : config.x;
    const y = opts.y !== undefined ? opts.y : config.y;

    const proj = {
      x: x,
      y: y,
      vx: vx,
      vy: vy,
      radius: DEFAULT_RADIUS,
      mass: DEFAULT_MASS,
      type: "chicken",
      isStatic: false,
    };

    shotsLeft--;

    // 触发炮口动画
    triggerRecoil();
    spawnSmoke(x, y, fireAngle);

    return proj;
  }

  function canFire() {
    return shotsLeft > 0;
  }

  // ── 炮口动画 ────────────────────────────────────────────────
  function triggerRecoil() {
    recoil = 1;
    recoilTimer = RECOIL_DURATION;
  }

  function spawnSmoke(x, y, a) {
    for (let i = 0; i < SMOKE_COUNT; i++) {
      const spread = (Math.random() - 0.5) * 0.8;
      const dir = a + spread;
      const speed = 30 + Math.random() * 50;
      smokeParticles.push({
        x: x + Math.cos(dir) * 10,
        y: y + Math.sin(dir) * 10,
        vx: Math.cos(dir) * speed,
        vy: Math.sin(dir) * speed - 20,
        age: 0,
        life: SMOKE_LIFETIME * (0.7 + Math.random() * 0.6),
        size: 4 + Math.random() * 4,
      });
    }
  }

  /**
   * 推进炮口动画。
   * @param {number} dt 帧间隔（秒）
   */
  function update(dt) {
    // 后坐力衰减
    if (recoilTimer > 0) {
      recoilTimer -= dt;
      if (recoilTimer <= 0) {
        recoil = 0;
        recoilTimer = 0;
      } else {
        recoil = recoilTimer / RECOIL_DURATION;
      }
    }

    // 烟雾粒子更新
    const alive = [];
    for (const p of smokeParticles) {
      p.age += dt;
      if (p.age >= p.life) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy -= 30 * dt;        // 烟雾上飘
      p.vx *= 0.96;
      p.vy *= 0.96;
      alive.push(p);
    }
    smokeParticles = alive;
  }

  // ── 回调钩子 ────────────────────────────────────────────────
  /**
   * 发射后回调（由 Game.fire 调用，传入已加入物理世界的炮弹引用）。
   * 这里不做额外处理，仅保留钩子供外部覆写。
   */
  function onFire(proj) {
    // hook: 外部可覆写 Cannon.onFire = function(proj) {...}
  }

  /**
   * 碰撞回调（由 Game 透传 Physics.onCollision）。
   */
  function onCollision(a, b, impact) {
    // hook: 可在此处理炮弹命中逻辑
  }

  // ── 重置 ────────────────────────────────────────────────────
  function reset(shots) {
    shotsLeft = shots !== undefined ? shots : 0;
    aiming = false;
    dragStart = null;
    dragCurrent = null;
    angle = 0;
    force = 0;
    recoil = 0;
    recoilTimer = 0;
    smokeParticles = [];
  }

  // ── 公共 API ────────────────────────────────────────────────
  return {
    get config() { return config; },
    set config(c) {
      if (c) {
        if (c.x !== undefined) config.x = c.x;
        if (c.y !== undefined) config.y = c.y;
        if (c.maxForce !== undefined) config.maxForce = c.maxForce;
        if (c.angleRange !== undefined) config.angleRange = c.angleRange;
      }
    },
    get shotsLeft() { return shotsLeft; },
    set shotsLeft(n) { shotsLeft = n; },

    fire,
    canFire,
    update,
    input,
    onFire,
    onCollision,
    reset,

    getAngle() { return angle; },
    getForce() { return force; },
    getRecoil() { return recoil; },
    getSmokeParticles() { return smokeParticles; },
    isAiming() { return aiming; },
  };
})();

// 暴露到全局
if (typeof window !== "undefined") {
  window.Cannon = Cannon;
}
if (typeof globalThis !== "undefined") {
  globalThis.Cannon = Cannon;
}
