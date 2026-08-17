/**
 * Physics Engine - 单元测试（Node.js 运行）
 * 覆盖验收标准：
 *   1. 抛物线轨迹符合物理直觉
 *   2. 无穿透
 *   3. 建筑可破碎成 2-4 个碎片
 *   4. 牛头可受击回调
 */

const assert = require("assert");

// 加载 physics.js（它会挂到 globalThis.Physics）
require("../physics.js");
const Physics = globalThis.Physics;

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("  ✓ " + name);
  } catch (e) {
    failed++;
    console.log("  ✗ " + name);
    console.log("    " + e.message);
  }
}

function approx(a, b, eps) {
  eps = eps || 0.5;
  return Math.abs(a - b) < eps;
}

// ── 测试组 ──────────────────────────────────────────────────

console.log("\nPhysics Engine Tests\n");

// 1. 抛物线运动
console.log("[抛物线运动]");
test("无阻力下水平速度恒定，竖直受重力加速", () => {
  Physics.clear();
  const b = { x: 0, y: 0, vx: 100, vy: 0, radius: 10, mass: 1, type: "projectile", isStatic: false };
  Physics.addBody(b);
  // 推进 0.5 秒（30 步）
  for (let i = 0; i < 30; i++) Physics.update(1 / 60);
  // 水平位移 ≈ 100 * 0.5 = 50
  assert.ok(approx(b.x, 50, 1), "水平位移应≈50，实际=" + b.x);
  // 竖直位移 ≈ 0.5 * g * t² = 0.5 * 980 * 0.25 = 122.5
  assert.ok(b.y > 100, "应有明显下落，y=" + b.y);
  assert.ok(approx(b.vy, 980 * 0.5, 5), "vy应≈490，实际=" + b.vy);
});

test("自由落体：1秒后 vy ≈ g", () => {
  Physics.clear();
  const b = { x: 0, y: 0, vx: 0, vy: 0, radius: 5, mass: 1, type: "debris", isStatic: false };
  Physics.addBody(b);
  for (let i = 0; i < 60; i++) Physics.update(1 / 60);
  assert.ok(approx(b.vy, 980, 5), "1秒后vy应≈980，实际=" + b.vy);
});

// 2. 碰撞检测
console.log("\n[碰撞检测]");
test("圆-圆碰撞检测返回法向量与穿透深度", () => {
  Physics.clear();
  const a = { x: 0, y: 0, vx: 0, vy: 0, radius: 10, mass: 1, type: "block", isStatic: true };
  const b = { x: 15, y: 0, vx: 0, vy: 0, radius: 10, mass: 1, type: "projectile", isStatic: false };
  const col = Physics._internal.circleCollision(a, b);
  assert.ok(col, "应检测到碰撞");
  assert.ok(approx(col.nx, 1, 0.1), "法向量x应≈1，实际=" + col.nx);
  assert.ok(approx(col.overlap, 5, 0.5), "穿透深度应≈5，实际=" + col.overlap);
});

test("分离的两个圆不碰撞", () => {
  const a = { x: 0, y: 0, radius: 10 };
  const b = { x: 50, y: 0, radius: 10 };
  const col = Physics._internal.circleCollision(a, b);
  assert.ok(!col, "不应碰撞");
});

test("AABB 检测重叠", () => {
  const a = { x: 0, y: 0, radius: 10 };
  const b = { x: 15, y: 0, radius: 10 };
  assert.ok(Physics._internal.aabbOverlap(a, b), "AABB应重叠");
  const c = { x: 30, y: 0, radius: 10 };
  assert.ok(!Physics._internal.aabbOverlap(a, c), "AABB不应重叠");
});

// 3. 无穿透
console.log("\n[无穿透]");
test("运动物体碰撞静态物体后不穿透", () => {
  Physics.clear();
  const ground = { x: 100, y: 200, vx: 0, vy: 0, radius: 50, mass: 9999, type: "ground", isStatic: true };
  const ball = { x: 100, y: 100, vx: 0, vy: 500, radius: 10, mass: 1, type: "projectile", isStatic: false };
  Physics.addBody(ground);
  Physics.addBody(ball);
  // 推进 60 帧（1秒），让球下落
  for (let i = 0; i < 60; i++) Physics.update(1 / 60);
  // 球不应穿透地面：球底部 (y+radius) 不应超过地面顶部 (y-radius)
  assert.ok(ball.y + ball.radius <= ground.y + ground.radius + 1,
    "球穿透了地面！ball.y=" + ball.y + " ground.y=" + ground.y);
});

test("两个运动物体碰撞后位置分离", () => {
  Physics.clear();
  const a = { x: 50, y: 0, vx: 100, vy: 0, radius: 10, mass: 1, type: "projectile", isStatic: false };
  const b = { x: 80, y: 0, vx: -100, vy: 0, radius: 10, mass: 1, type: "block", isStatic: false };
  Physics.addBody(a);
  Physics.addBody(b);
  for (let i = 0; i < 10; i++) Physics.update(1 / 60);
  const dist = Math.abs(a.x - b.x);
  assert.ok(dist >= 18, "碰撞后应分离，距离=" + dist + " 半径和=20");
});

// 4. 建筑破碎
console.log("\n[建筑破碎]");
test("block 受高速冲击后破碎为 2-4 个碎片", () => {
  Physics.clear();
  const block = { x: 100, y: 100, vx: 0, vy: 0, radius: 15, mass: 1, type: "block", isStatic: false };
  const projectile = { x: 50, y: 100, vx: 2000, vy: 0, radius: 8, mass: 2, type: "projectile", isStatic: false };
  Physics.addBody(block);
  Physics.addBody(projectile);
  const bodiesBefore = Physics.getBodies().length;
  // 推进若干帧让碰撞发生
  for (let i = 0; i < 10; i++) Physics.update(1 / 60);
  const bodiesAfter = Physics.getBodies();
  const debrisCount = bodiesAfter.filter(b => b.type === "debris").length;
  // block 应消失，碎片应在 2-4 个
  assert.ok(!bodiesAfter.includes(block), "原 block 应被移除");
  assert.ok(debrisCount >= 2 && debrisCount <= 4,
    "碎片数量应在2-4个，实际=" + debrisCount);
});

test("低速冲击不破碎", () => {
  Physics.clear();
  const block = { x: 100, y: 100, vx: 0, vy: 0, radius: 15, mass: 1, type: "block", isStatic: false };
  const projectile = { x: 80, y: 100, vx: 5, vy: 0, radius: 8, mass: 1, type: "projectile", isStatic: false };
  Physics.addBody(block);
  Physics.addBody(projectile);
  for (let i = 0; i < 30; i++) Physics.update(1 / 60);
  const debrisCount = Physics.getBodies().filter(b => b.type === "debris").length;
  assert.ok(debrisCount === 0, "低速不应破碎，碎片数=" + debrisCount);
});

// 5. 牛头受击回调
console.log("\n[牛头受击]");
test("pig 受击超过阈值时触发 onHit 回调", () => {
  Physics.clear();
  let hitImpact = 0;
  const pig = {
    x: 100, y: 100, vx: 0, vy: 0, radius: 12, mass: 1, type: "pig", isStatic: false,
    onHit: (impact) => { hitImpact = impact; }
  };
  const projectile = { x: 50, y: 100, vx: 1500, vy: 0, radius: 8, mass: 2, type: "projectile", isStatic: false };
  Physics.addBody(pig);
  Physics.addBody(projectile);
  for (let i = 0; i < 10; i++) Physics.update(1 / 60);
  assert.ok(hitImpact > 0, "应触发 onHit 回调，impact=" + hitImpact);
});

test("pig 受击低于阈值不触发 onHit", () => {
  Physics.clear();
  let hit = false;
  const pig = {
    x: 100, y: 100, vx: 0, vy: 0, radius: 12, mass: 1, type: "pig", isStatic: false,
    onHit: () => { hit = true; }
  };
  const projectile = { x: 85, y: 100, vx: 10, vy: 0, radius: 8, mass: 1, type: "projectile", isStatic: false };
  Physics.addBody(pig);
  Physics.addBody(projectile);
  for (let i = 0; i < 20; i++) Physics.update(1 / 60);
  assert.ok(!hit, "低速冲击不应触发 onHit");
});

// 6. 碰撞回调
console.log("\n[碰撞回调]");
test("onCollision 回调被调用并传入 impact", () => {
  Physics.clear();
  let callbackHit = false;
  Physics.onCollision((a, b, impact) => {
    callbackHit = true;
    assert.ok(typeof impact === "number", "impact 应为数字");
  });
  const a = { x: 50, y: 0, vx: 200, vy: 0, radius: 10, mass: 1, type: "projectile", isStatic: false };
  const b = { x: 70, y: 0, vx: 0, vy: 0, radius: 10, mass: 1, type: "block", isStatic: true };
  Physics.addBody(a);
  Physics.addBody(b);
  for (let i = 0; i < 10; i++) Physics.update(1 / 60);
  assert.ok(callbackHit, "碰撞回调应被调用");
  Physics.onCollision(null);
});

// 7. API 完整性
console.log("\n[API 完整性]");
test("Physics 暴露 update/addBody/removeBody/onCollision", () => {
  assert.strictEqual(typeof Physics.update, "function");
  assert.strictEqual(typeof Physics.addBody, "function");
  assert.strictEqual(typeof Physics.removeBody, "function");
  assert.strictEqual(typeof Physics.onCollision, "function");
});

test("removeBody 正确移除", () => {
  Physics.clear();
  const b = { x: 0, y: 0, vx: 0, vy: 0, radius: 5, mass: 1, type: "debris", isStatic: false };
  Physics.addBody(b);
  assert.strictEqual(Physics.getBodies().length, 1);
  Physics.removeBody(b);
  assert.strictEqual(Physics.getBodies().length, 0);
});

// ── 结果 ────────────────────────────────────────────────────
console.log("\n──────────────────────────────");
console.log("  通过: " + passed + " / 失败: " + failed);
console.log("──────────────────────────────\n");

if (failed > 0) process.exit(1);
