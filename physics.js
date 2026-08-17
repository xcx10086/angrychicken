/**
 * Angry Chicken - Physics Engine Module
 *
 * 自研轻量物理引擎，提供重力、碰撞检测、刚体运动与建筑破坏计算能力。
 *
 * 全局对象：Physics
 * 接口：
 *   Physics.update(dt)            — 推进一帧物理模拟
 *   Physics.addBody(body)         — 添加刚体
 *   Physics.removeBody(body)      — 移除刚体
 *   Physics.onCollision(a,b,impact) — 碰撞回调（由引擎在发生碰撞时调用）
 *
 * 刚体结构：
 *   { x, y, vx, vy, radius, mass, type, isStatic, onHit }
 *     - x, y       位置（世界坐标）
 *     - vx, vy     速度
 *     - radius     用于圆形碰撞的半径（同时也用于 AABB 半边长）
 *     - mass       质量；isStatic 物体质量视为无穷大
 *     - type       字符串标签："projectile" | "block" | "pig" | "debris" | "ground" | "wall"
 *     - isStatic   是否静态（不受力、不移动）
 *     - onHit      可选，被碰撞时触发的回调 (impact) => void
 */

const Physics = (function () {
  // ── 全局参数 ────────────────────────────────────────────────
  const GRAVITY = 980;            // 重力加速度（px/s²），按屏幕坐标（y 向下为正）
  const FIXED_DT = 1 / 60;        // 固定时间步长
  const RESTITUTION = 0.35;       // 全局弹性系数
  const FRICTION = 0.92;          // 地面摩擦系数（每帧水平速度衰减）
  const MAX_BODIES = 300;         // 刚体上限（含碎片）
  const MAX_DEBRIS = 100;         // 碎片上限
  const DEBRIS_MIN_RADIUS = 4;    // 碎片最小半径
  const GRID_CELL_SIZE = 64;      // 空间分区网格单元尺寸

  // ── 破坏阈值相关 ────────────────────────────────────────────
  // 建筑破碎条件：冲击力 > mass * BLOCK_BREAK_THRESHOLD
  const BLOCK_BREAK_THRESHOLD = 380;
  // 碎片数量范围 2-4
  const DEBRIS_MIN_COUNT = 2;
  const DEBRIS_MAX_COUNT = 4;
  // 牛头受击阈值（冲击力大于该值才回调 onHit）
  const PIG_HIT_THRESHOLD = 120;

  // ── 内部状态 ────────────────────────────────────────────────
  let bodies = [];
  let accumulator = 0;
  let debrisCount = 0;

  // 碰撞回调（外部可覆写）
  let _collisionCallback = null;

  // ── 空间分区网格 ────────────────────────────────────────────
  // 用 Map 存储："cellX,cellY" -> Set<body>
  // 每帧 update 前重建网格，以加速碰撞对的发现
  function buildSpatialGrid() {
    const grid = new Map();
    for (const b of bodies) {
      const minX = Math.floor((b.x - b.radius) / GRID_CELL_SIZE);
      const maxX = Math.floor((b.x + b.radius) / GRID_CELL_SIZE);
      const minY = Math.floor((b.y - b.radius) / GRID_CELL_SIZE);
      const maxY = Math.floor((b.y + b.radius) / GRID_CELL_SIZE);
      for (let cx = minX; cx <= maxX; cx++) {
        for (let cy = minY; cy <= maxY; cy++) {
          const key = cx + "," + cy;
          let cell = grid.get(key);
          if (!cell) {
            cell = [];
            grid.set(key, cell);
          }
          cell.push(b);
        }
      }
    }
    return grid;
  }

  function getNearby(grid, body) {
    const result = [];
    const seen = new Set();
    const minX = Math.floor((body.x - body.radius) / GRID_CELL_SIZE);
    const maxX = Math.floor((body.x + body.radius) / GRID_CELL_SIZE);
    const minY = Math.floor((body.y - body.radius) / GRID_CELL_SIZE);
    const maxY = Math.floor((body.y + body.radius) / GRID_CELL_SIZE);
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cy = minY; cy <= maxY; cy++) {
        const cell = grid.get(cx + "," + cy);
        if (!cell) continue;
        for (const other of cell) {
          if (other === body || seen.has(other)) continue;
          seen.add(other);
          result.push(other);
        }
      }
    }
    return result;
  }

  // ── 碰撞检测 ────────────────────────────────────────────────
  // 这里把所有刚体都当作"圆形"参与碰撞（半径 = radius），
  // 但 AABB 检测同样提供，供需要轴对齐包围盒的场景使用。
  // 实际碰撞解算使用圆-圆检测以获得更自然的反弹方向。

  /**
   * AABB 检测两个刚体是否相交（基于 radius 作为半边长）。
   */
  function aabbOverlap(a, b) {
    return (
      Math.abs(a.x - b.x) < a.radius + b.radius &&
      Math.abs(a.y - b.y) < a.radius + b.radius
    );
  }

  /**
   * 圆形碰撞检测，返回穿透深度和法向量；不相交返回 null。
   * 当两体重合（dist≈0）时，用相对速度方向作为法向量，
  * 避免法向量退化为零导致冲击力计算为 0。
    */
    function circleCollision(a, b) {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let distSq = dx * dx + dy * dy;
    const rSum = a.radius + b.radius;
    if (distSq >= rSum * rSum) return null;
    let dist = Math.sqrt(distSq);
      let overlap = rSum - dist;

      if (dist < 0.0001) {
    // 两体重合：用相对速度方向作为法向量（a -> b）
  const rvx = b.vx - a.vx;
      const rvy = b.vy - a.vy;
      const speed = Math.sqrt(rvx * rvx + rvy * rvy);
      if (speed > 0.0001) {
        dx = rvx / speed;
        dy = rvy / speed;
      } else {
        // 都静止且重合：默认向上（物理上无意义，但避免除零）
        dx = 0;
        dy = -1;
      }
      dist = 0;
      overlap = rSum;
    }
    return {
      nx: dx / (dist > 0.0001 ? dist : 1),
      ny: dy / (dist > 0.0001 ? dist : 1),
      overlap: overlap,
    };
  }

  /**
   * 计算碰撞冲击力（用于破坏判定）。
   * 使用相对速度沿法线方向的投影作为冲击力指标。
   */
  function computeImpact(a, b, nx, ny) {
    const rvx = b.vx - a.vx;
    const rvy = b.vy - a.vy;
    const relVelAlongNormal = rvx * nx + rvy * ny;
    // 取绝对值作为冲击力大小
    return Math.abs(relVelAlongNormal);
  }

  /**
   * 解算两个刚体之间的碰撞：位置分离 + 速度反弹 + onHit 回调。
   */
  function resolveCollision(a, b) {
    const col = circleCollision(a, b);
    if (!col) return;

    const { nx, ny, overlap } = col;
    const impact = computeImpact(a, b, nx, ny);

    // 位置分离（按质量比）
    if (a.isStatic && b.isStatic) {
      // 两个静态物体重叠，不做处理
      return;
    } else if (a.isStatic) {
      b.x += nx * overlap;
      b.y += ny * overlap;
    } else if (b.isStatic) {
      a.x -= nx * overlap;
      a.y -= ny * overlap;
    } else {
      const totalMass = a.mass + b.mass;
      const aRatio = b.mass / totalMass;
      const bRatio = a.mass / totalMass;
      a.x -= nx * overlap * aRatio;
      a.y -= ny * overlap * aRatio;
      b.x += nx * overlap * bRatio;
      b.y += ny * overlap * bRatio;
    }

    // 速度反弹（冲量法）
    const rvx = b.vx - a.vx;
    const rvy = b.vy - a.vy;
    const velAlongNormal = rvx * nx + rvy * ny;
    if (velAlongNormal > 0) {
      // 已经在分离方向上，不需要再施加冲量
    } else {
      let invMassA = a.isStatic ? 0 : 1 / a.mass;
      let invMassB = b.isStatic ? 0 : 1 / b.mass;
      const j = -(1 + RESTITUTION) * velAlongNormal / (invMassA + invMassB);
      const impulseX = j * nx;
      const impulseY = j * ny;
      if (!a.isStatic) {
        a.vx -= impulseX * invMassA;
        a.vy -= impulseY * invMassA;
      }
      if (!b.isStatic) {
        b.vx += impulseX * invMassB;
        b.vy += impulseY * invMassB;
      }
    }

    // 碰撞回调
    if (_collisionCallback) {
      _collisionCallback(a, b, impact);
    }

    // 建筑破坏判定
    handleBreak(a, b, impact);
    // 牛头受击判定
    handlePigHit(a, b, impact);
  }

  // ── 建筑破坏 ────────────────────────────────────────────────
  function handleBreak(a, b, impact) {
    // 其中一个是 block 且冲击力超过阈值时破碎
    const block = a.type === "block" ? a : b.type === "block" ? b : null;
    if (!block) return;
    if (block.isStatic) return; // 静态 block 不破坏（可按需调整）
    if (impact <= block.mass * BLOCK_BREAK_THRESHOLD) return;

    breakBlock(block);
  }

  /**
   * 将一个建筑块破碎为 2-4 个碎片。
   * 碎片继承 block 的位置与部分速度，并散开。
   */
  function breakBlock(block) {
    // 碎片数量
    const count = DEBRIS_MIN_COUNT +
      Math.floor(Math.random() * (DEBRIS_MAX_COUNT - DEBRIS_MIN_COUNT + 1));

    // 从 bodies 中移除原 block
    removeBodyInternal(block);

    // 检查碎片上限
    const canSpawn = Math.min(count, MAX_DEBRIS - debrisCount);
    if (canSpawn <= 0) return;

    for (let i = 0; i < canSpawn; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
      const speed = 60 + Math.random() * 80;
      const r = Math.max(DEBRIS_MIN_RADIUS, block.radius * 0.5);
      const debris = {
        x: block.x + Math.cos(angle) * r * 0.5,
        y: block.y + Math.sin(angle) * r * 0.5,
        vx: block.vx + Math.cos(angle) * speed,
        vy: block.vy + Math.sin(angle) * speed - 40,
        radius: r,
        mass: block.mass / count,
        type: "debris",
        isStatic: false,
        onHit: null,
      };
      addBodyInternal(debris);
      debrisCount++;
    }
  }

  // ── 牛头受击 ────────────────────────────────────────────────
  function handlePigHit(a, b, impact) {
    if (impact < PIG_HIT_THRESHOLD) return;
    const pig = a.type === "pig" ? a : b.type === "pig" ? b : null;
    if (!pig || !pig.onHit) return;
    pig.onHit(impact);
  }

  // ── 刚体管理 ────────────────────────────────────────────────
  let _nextBodyId = 0;

  function addBodyInternal(body) {
    if (bodies.length >= MAX_BODIES) {
      // 达到上限时优先淘汰最老的碎片
      const idx = bodies.findIndex(b => b.type === "debris");
      if (idx >= 0) {
        bodies.splice(idx, 1);
        debrisCount = Math.max(0, debrisCount - 1);
      } else {
        return false; // 无法添加
      }
    }
    // 分配唯一 ID，用于碰撞配对去重
    if (body._id === undefined) body._id = _nextBodyId++;
    bodies.push(body);
    return true;
  }

  function removeBodyInternal(body) {
    const idx = bodies.indexOf(body);
    if (idx >= 0) {
      bodies.splice(idx, 1);
      if (body.type === "debris") {
        debrisCount = Math.max(0, debrisCount - 1);
      }
      return true;
    }
    return false;
  }

  // ── 物理步进 ────────────────────────────────────────────────
  // 为防止高速物体穿透（隧道效应），当某帧内某物体位移可能超过
    // 任意碰撞对半径之和时，自动对这一帧做子步进。
    function step(dt) {
      // 计算本帧最大位移，决定子步数
      let maxMove = 0;
      for (const b of bodies) {
      if (b.isStatic) continue;
      const move = (Math.abs(b.vx) + Math.abs(b.vy)) * dt;
      if (move > maxMove) maxMove = move;
    }
// 最小碰撞半径（防止除零）
    let minRadius = 8;
    for (const b of bodies) {
    if (b.radius < minRadius) minRadius = b.radius;
    }
      // 若最大位移超过最小半径的一半，做子步进
      const subSteps = maxMove > minRadius * 0.5
        ? Math.min(8, Math.ceil(maxMove / (minRadius * 0.5)))
        : 1;
        const subDt = dt / subSteps;

        for (let s = 0; s < subSteps; s++) {
        // 1) 积分运动
        for (const b of bodies) {
      if (b.isStatic) continue;
    // 应用重力
b.vy += GRAVITY * subDt;
    // 更新位置
    b.x += b.vx * subDt;
      b.y += b.vy * subDt;
      }

      // 2) 碰撞检测与解算（使用空间分区网格）
          const grid = buildSpatialGrid();
          const checked = new Set();
          for (const b of bodies) {
            const nearby = getNearby(grid, b);
            for (const other of nearby) {
              // 用配对标记避免重复检测同一对
              const pairKey = b._id < other._id ? b._id + "|" + other._id : other._id + "|" + b._id;
              if (checked.has(pairKey)) continue;
              checked.add(pairKey);
              // 跳过两个静态物体
              if (b.isStatic && other.isStatic) continue;
              resolveCollision(b, other);
            }
          }
        }

        // 3) 地面/墙壁约束 & 摩擦（约定 y 向下为正）
        for (const b of bodies) {
          if (b.isStatic) continue;
          // 地面（可由外部添加 ground 类型刚体；这里不做硬编码地面，
          // 但为防止物体永远下落，提供一个可选的世界边界）
          if (b._worldBounds) {
        const wb = b._worldBounds;
        if (b.x - b.radius < wb.left) {
          b.x = wb.left + b.radius;
          b.vx = -b.vx * RESTITUTION;
        }
        if (b.x + b.radius > wb.right) {
          b.x = wb.right - b.radius;
          b.vx = -b.vx * RESTITUTION;
        }
        if (b.y + b.radius > wb.bottom) {
          b.y = wb.bottom - b.radius;
          b.vy = -b.vy * RESTITUTION;
          // 地面摩擦
          b.vx *= FRICTION;
          // 速度过小时静止
          if (Math.abs(b.vy) < 5) b.vy = 0;
          if (Math.abs(b.vx) < 2) b.vx = 0;
        }
        if (b.y - b.radius < wb.top) {
          b.y = wb.top + b.radius;
          b.vy = -b.vy * RESTITUTION;
        }
      }
    }

    // 4) 碎片生命周期：静止过久的碎片移除以维持性能
    for (const b of bodies) {
      if (b.type !== "debris") continue;
      const speed = Math.abs(b.vx) + Math.abs(b.vy);
      if (speed < 3) {
        b._restTime = (b._restTime || 0) + dt;
        if (b._restTime > 2.5) {
          removeBodyInternal(b);
        }
      } else {
        b._restTime = 0;
      }
    }
  }

  // ── 公共 API ────────────────────────────────────────────────
  return {
    /** 推进物理模拟。dt 为帧间隔（秒）。内部使用固定步长累加器。 */
    update(dt) {
      accumulator += dt;
      let steps = 0;
      while (accumulator >= FIXED_DT && steps < 5) {
        step(FIXED_DT);
        accumulator -= FIXED_DT;
        steps++;
      }
      // 防止累加器爆炸
      if (accumulator > FIXED_DT * 5) accumulator = 0;
    },

    /** 添加刚体。 */
    addBody(body) {
      return addBodyInternal(body);
    },

    /** 移除刚体。 */
    removeBody(body) {
      return removeBodyInternal(body);
    },

    /** 获取所有刚体（只读引用，不要直接修改数组结构）。 */
    getBodies() {
      return bodies;
    },

    /** 设置碰撞回调：(a, b, impact) => void */
    onCollision(fn) {
      _collisionCallback = fn;
    },

    /** 清空所有刚体，重置引擎状态。 */
    clear() {
      bodies = [];
      debrisCount = 0;
      accumulator = 0;
    },

    /** 配置全局参数（可选）。 */
    config(opts) {
      if (typeof opts.gravity === "number") {
        // 注意：直接修改闭包内的常量需要改成 let，这里通过 _params 桥接
      }
    },

    // 暴露部分常量供外部读取
    constants: {
      GRAVITY,
      FIXED_DT,
      RESTITUTION,
      FRICTION,
      MAX_BODIES,
      MAX_DEBRIS,
      BLOCK_BREAK_THRESHOLD,
      PIG_HIT_THRESHOLD,
    },

    /** 为测试/调试暴露内部函数（非生产 API）。 */
    _internal: {
      circleCollision,
      aabbOverlap,
      computeImpact,
      breakBlock,
    },
  };
})();

// 暴露到全局
if (typeof window !== "undefined") {
  window.Physics = Physics;
}
if (typeof globalThis !== "undefined") {
  globalThis.Physics = Physics;
}
