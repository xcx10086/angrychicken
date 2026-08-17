/**
 * Angry Chicken - Level & Target System
 *
 * 实现关卡数据定义、牛头与建筑布局、通关条件配置，数据驱动各关场景。
 *
 * 全局对象：Level
 * 接口：
 *   Level.load(n)     — 加载第 n 关（1-based），返回关卡场景对象
 *   Level.count       — 关卡总数
 *   Level.current      — 当前关卡序号（0 表示尚未加载）
 *
 * 关卡场景对象格式：
 *   {
 *     cannon:  { x, y }                  — 炮台初始位置
 *     bulls:   [ { x, y, radius, mass, ... } ]   — 牛头圆形刚体
 *     blocks:  [ { x, y, width, height, radius, mass, ... } ] — 建筑矩形刚体
 *     shots:   N                          — 本关可用炮弹数
 *     ground:  { x, y, width, height, ... }     — 地面配置（可选，默认内置）
 *     name:    "第 N 关"                  — 关卡名
 *   }
 *
 * 刚体格式与 Physics.addBody 兼容：
 *   牛头：圆形刚体，type="pig"，半径稍大便于击中
 *   建筑块：矩形刚体（width/height 标注视觉尺寸，radius=半边长供物理引擎碰撞用），
 *           type="block"
 *
 * 技术备注：
 *   - 单文件 JS，通过 const Level = {...} 命名空间组织
 *   - 关卡数据用对象数组硬编码（无需外部文件）
 *   - 关卡 3 需设计为需要利用反弹/连锁破坏才能通关
 */

const Level = (function () {
  // ── 世界常量（与 game.js WORLD 一致） ──────────────────────
  const WORLD = {
    left: 0,
    top: 0,
    right: 800,
    bottom: 480,
  };

  // ── 默认地面配置 ──────────────────────────────────────────
  // 贴在世界底部下方，不侵入游戏区
  const DEFAULT_GROUND = {
    x: (WORLD.left + WORLD.right) / 2,   // 400
    y: WORLD.bottom + 8,                  // 488
    width: WORLD.right - WORLD.left,       // 800
    height: 16,
    radius: 8,                             // AABB 半边长（物理引擎用）
    mass: 99999,
    type: "ground",
    isStatic: true,
  };

  // ── 关卡数据 ──────────────────────────────────────────────
  // 每关：cannon 炮台位置、bulls 牛头、blocks 建筑、shots 炮弹数
  // 难度递进：关卡1 简单直接命中 → 关卡2 建筑保护需破拆 →
  //          关卡3 需利用反弹/连锁破坏才能通关
  const LEVELS = [
    // ── 第 1 关：入门，1 只牛头暴露在外，3 发炮弹 ──
    {
      name: "第 1 关",
      cannon: { x: 80, y: 380 },
      shots: 3,
      bulls: [
        // 牛头放在右侧地面，无建筑保护，直接可命中
        { x: 620, y: 420, radius: 18, mass: 1 },
      ],
      blocks: [
        // 少量装饰性建筑块，不遮挡牛头
        { x: 540, y: 430, width: 28, height: 28, radius: 14, mass: 1 },
      ],
    },

    // ── 第 2 关：进阶，2 只牛头被建筑保护，4 发炮弹 ──
    {
      name: "第 2 关",
      cannon: { x: 80, y: 380 },
      shots: 4,
      bulls: [
        // 牛头被建筑墙围住，需先破坏建筑才能打到
        { x: 560, y: 420, radius: 18, mass: 1 },
        { x: 680, y: 420, radius: 18, mass: 1 },
      ],
      blocks: [
        // 底层建筑块（地基墙）
        { x: 520, y: 430, width: 28, height: 28, radius: 14, mass: 2 },
        { x: 560, y: 430, width: 28, height: 28, radius: 14, mass: 2 },
        { x: 680, y: 430, width: 28, height: 28, radius: 14, mass: 2 },
        { x: 720, y: 430, width: 28, height: 28, radius: 14, mass: 2 },
        // 上层建筑块（屋顶，需击落后牛头才暴露）
        { x: 540, y: 400, width: 28, height: 28, radius: 14, mass: 1.5 },
        { x: 700, y: 400, width: 28, height: 28, radius: 14, mass: 1.5 },
      ],
    },

    // ── 第 3 关：挑战，3 只牛头藏于复杂结构中，5 发炮弹 ──
    // 设计为需利用反弹/连锁破坏才能通关：
    //   - 牛头 B 藏在底层墙后，正面射击被建筑遮挡
    //   - 需从上方击落建筑块引发连锁倒塌，或利用地面反弹击中
    //   - 牛头 C 位于高台，需抛物线或反弹才能命中
    {
      name: "第 3 关",
      cannon: { x: 80, y: 380 },
      shots: 5,
      bulls: [
        // 牛头 A：右前方，较高位置（高台），需抛物线命中
        { x: 700, y: 360, radius: 18, mass: 1 },
        // 牛头 B：中后方，被建筑墙保护，需连锁破坏或反弹
        { x: 560, y: 420, radius: 18, mass: 1 },
        // 牛头 C：左后方深处，被多层建筑遮挡
        { x: 460, y: 420, radius: 18, mass: 1 },
      ],
      blocks: [
        // 左侧围墙（保护牛头 C）
        { x: 420, y: 430, width: 28, height: 28, radius: 14, mass: 2 },
        { x: 420, y: 400, width: 28, height: 28, radius: 14, mass: 1.5 },
        // 中部建筑（保护牛头 B，击破后连锁倒塌波及 C）
        { x: 520, y: 430, width: 28, height: 28, radius: 14, mass: 2 },
        { x: 600, y: 430, width: 28, height: 28, radius: 14, mass: 2 },
        { x: 560, y: 400, width: 28, height: 28, radius: 14, mass: 1.5 },
        // 右侧高台支柱（支撑牛头 A，击倒支柱可让 A 落地）
        { x: 660, y: 430, width: 28, height: 28, radius: 14, mass: 2 },
        { x: 740, y: 430, width: 28, height: 28, radius: 14, mass: 2 },
        { x: 700, y: 400, width: 28, height: 28, radius: 14, mass: 1.5 },
      ],
    },
  ];

  // ── 内部状态 ──────────────────────────────────────────────
  let _current = 0;   // 当前关卡序号（0 = 尚未加载）

  // ── 工具函数 ──────────────────────────────────────────────
  /**
   * 将关卡数据中的原始刚体定义转换为 Physics.addBody 兼容格式。
   * 牛头：圆形刚体，补全 type/isStatic/vx/vy/onHit
   * 建筑块：矩形刚体，补全 type/isStatic/vx/vy，radius 已在数据中设定
   */
  function buildBull(raw) {
    const bull = {
      x: raw.x,
      y: raw.y,
      vx: 0,
      vy: 0,
      radius: raw.radius,
      mass: raw.mass,
      type: "pig",
      isStatic: false,
      _worldBounds: WORLD,
      onHit: function (impact) {
        bull._lastHitImpact = impact;
        bull._hp = (bull._hp ?? 1) - 1;
      },
    };
    bull._hp = 1;
    return bull;
  }

  function buildBlock(raw) {
    return {
      x: raw.x,
      y: raw.y,
      vx: 0,
      vy: 0,
      width: raw.width,       // 矩形视觉宽度
      height: raw.height,     // 矩形视觉高度
      radius: raw.radius,     // AABB 半边长（供物理引擎圆形碰撞用）
      mass: raw.mass,
      type: "block",
      isStatic: false,
      _worldBounds: WORLD,
    };
  }

  function buildGround(groundDef) {
    const g = groundDef || DEFAULT_GROUND;
    return {
      x: g.x,
      y: g.y,
      vx: 0,
      vy: 0,
      width: g.width,
      height: g.height,
      radius: g.radius,
      mass: g.mass,
      type: "ground",
      isStatic: true,
    };
  }

  // ── 公共 API ──────────────────────────────────────────────
  return {
    /**
     * 加载第 n 关（1-based）。
     * 返回关卡场景对象 { cannon, bulls, blocks, shots, ground, name }，
     * 供 Renderer 渲染、Physics 注册刚体、Cannon 设置初始位置。
     * 越界返回 null。
     */
    load(n) {
      if (n < 1 || n > LEVELS.length) return null;
      const data = LEVELS[n - 1];
      _current = n;

      return {
        name: data.name,
        cannon: { x: data.cannon.x, y: data.cannon.y },
        shots: data.shots,
        bulls: data.bulls.map(buildBull),
        blocks: data.blocks.map(buildBlock),
        ground: buildGround(data.ground),
      };
    },

    /** 关卡总数。 */
    get count() {
      return LEVELS.length;
    },

    /** 当前关卡序号（0 = 尚未加载）。 */
    get current() {
      return _current;
    },

    /**
     * 获取关卡原始数据（不含刚体构建），仅供调试/渲染预览用。
     */
    _raw(n) {
      if (n < 1 || n > LEVELS.length) return null;
      return LEVELS[n - 1];
    },

    /** 世界常量。 */
    WORLD,
  };
})();

// 暴露到全局
if (typeof window !== "undefined") {
  window.Level = Level;
}
if (typeof globalThis !== "undefined") {
  globalThis.Level = Level;
}
