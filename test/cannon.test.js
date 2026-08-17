/**
 * Cannon & Launch System - 单元测试（Node.js 运行）
 * 覆盖验收标准：
 *   1. 炮弹初速度方向与发射方向一致（角度计算无误差）
 *   2. 力度影响射程：力度越大飞得越远
 *   3. 发射次数正确扣减，耗尽后无法再发射
 *   4. 炮口动画在发射时播放，无动画残留
 *   5. 角度范围限制（不能向后发射）
 */

const assert = require("assert");

require("../cannon.js");
const Cannon = globalThis.Cannon;

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
    console.log("    " + (e.stack || e.message).split("\n").slice(0, 2).join("\n"));
  }
}

function approx(a, b, eps) {
  eps = eps || 0.5;
  return Math.abs(a - b) < eps;
}

console.log("\nCannon & Launch System Tests\n");

// ── 重置 & 基础 ──────────────────────────────────────────────
Cannon.reset(5);

console.log("[基础]");
test("reset 设置 shotsLeft", () => {
  Cannon.reset(3);
  assert.strictEqual(Cannon.shotsLeft, 3);
});

test("canFire 在有炮弹时返回 true", () => {
  Cannon.reset(3);
  assert.ok(Cannon.canFire());
});

test("canFire 在耗尽时返回 false", () => {
  Cannon.reset(0);
  assert.ok(!Cannon.canFire());
});

// ── 发射与角度 ──────────────────────────────────────────────
console.log("\n[发射与角度]");
test("fire 返回炮弹对象，初速度方向与发射角度一致", () => {
  Cannon.reset(5);
  // 显式传入角度与力度
  const angle = Math.PI / 4; // 45°
  const force = 1000;
  const proj = Cannon.fire({ angle, force });
  assert.ok(proj, "应返回炮弹对象");
  assert.strictEqual(proj.type, "chicken");
  // vx = cos(angle)*force, vy = sin(angle)*force
  assert.ok(approx(proj.vx, Math.cos(angle) * force, 1),
    "vx 应≈" + Math.cos(angle) * force + "，实际=" + proj.vx);
  assert.ok(approx(proj.vy, Math.sin(angle) * force, 1),
    "vy 应≈" + Math.sin(angle) * force + "，实际=" + proj.vy);
});

test("fire 消耗炮弹计数", () => {
  Cannon.reset(5);
  const before = Cannon.shotsLeft;
  Cannon.fire({ angle: 0, force: 500 });
  assert.strictEqual(Cannon.shotsLeft, before - 1);
});

test("炮弹耗尽后 fire 返回 null", () => {
  Cannon.reset(1);
  assert.ok(Cannon.fire({ angle: 0, force: 100 }));
  assert.strictEqual(Cannon.shotsLeft, 0);
  const proj = Cannon.fire({ angle: 0, force: 100 });
  assert.ok(proj === null, "耗尽后应返回 null");
});

// ── 力度影响射程 ────────────────────────────────────────────
console.log("\n[力度映射]");
test("力度越大初速度越大", () => {
  Cannon.reset(5);
  const p1 = Cannon.fire({ angle: 0, force: 500 });
  const p2 = Cannon.fire({ angle: 0, force: 1000 });
  assert.ok(Math.abs(p2.vx) > Math.abs(p1.vx), "更大力度应有更大初速度");
});

test("拖拽距离影响力度", () => {
  Cannon.reset(5);
  Cannon.input({ type: "dragStart", x: 80, y: 380 });
  // 短拖拽
  Cannon.input({ type: "dragMove", x: 100, y: 380 });
  const smallForce = Cannon.getForce();
  // 长拖拽
  Cannon.input({ type: "dragStart", x: 80, y: 380 });
  Cannon.input({ type: "dragMove", x: 280, y: 380 });
  const bigForce = Cannon.getForce();
  assert.ok(bigForce > smallForce, "长拖拽力度应更大");
});

test("力度被 clamp 到 maxForce", () => {
  Cannon.reset(5);
  Cannon.config = { maxForce: 1000 };
  Cannon.input({ type: "dragStart", x: 0, y: 0 });
  Cannon.input({ type: "dragMove", x: 9999, y: 0 });
  assert.ok(Cannon.getForce() <= 1000, "力度不应超过 maxForce");
  // 还原默认
  Cannon.config = { maxForce: 1200 };
});

// ── 角度范围限制 ────────────────────────────────────────────
console.log("\n[角度范围]");
test("不能向后发射（角度被限制）", () => {
  Cannon.reset(5);
  // 默认范围 -80° ~ 80°；尝试 150° 应被 clamp 到 80°
  const proj = Cannon.fire({ angle: Math.PI * 150 / 180, force: 800 });
  const actualAngle = Math.atan2(proj.vy, proj.vx);
  const maxAngle = Math.PI * 80 / 180;
  assert.ok(actualAngle <= maxAngle + 0.01,
    "角度应被限制在 80° 以内，实际=" + actualAngle * 180 / Math.PI + "°");
});

test("向下超过范围也被 clamp", () => {
  Cannon.reset(5);
  const proj = Cannon.fire({ angle: -Math.PI * 89 / 180, force: 800 });
  const actualAngle = Math.atan2(proj.vy, proj.vx);
  const minAngle = -Math.PI * 80 / 180;
  assert.ok(actualAngle >= minAngle - 0.01,
    "角度应不低于 -80°，实际=" + actualAngle * 180 / Math.PI + "°");
});

// ── 炮口动画 ────────────────────────────────────────────────
console.log("\n[炮口动画]");
test("发射时触发后坐力动画", () => {
  Cannon.reset(5);
  assert.strictEqual(Cannon.getRecoil(), 0, "初始无后坐力");
  Cannon.fire({ angle: 0, force: 500 });
  assert.ok(Cannon.getRecoil() > 0, "发射后应有后坐力");
});

test("发射时产生烟雾粒子", () => {
  Cannon.reset(5);
  assert.strictEqual(Cannon.getSmokeParticles().length, 0, "初始无烟雾");
  Cannon.fire({ angle: 0, force: 500 });
  assert.ok(Cannon.getSmokeParticles().length > 0, "发射后应有烟雾粒子");
});

test("update 推进后动画逐渐消退", () => {
  Cannon.reset(5);
  Cannon.fire({ angle: 0, force: 500 });
  const recoil0 = Cannon.getRecoil();
  // 推进 0.2 秒（超过 RECOIL_DURATION=0.18）
  for (let i = 0; i < 12; i++) Cannon.update(1 / 60);
  assert.ok(Cannon.getRecoil() < recoil0, "后坐力应衰减");
  assert.ok(Cannon.getRecoil() === 0, "超时后后坐力应归零，实际=" + Cannon.getRecoil());
});

test("烟雾粒子在 lifetime 后消失", () => {
  Cannon.reset(5);
  Cannon.fire({ angle: 0, force: 500 });
  // 推进 1 秒，远超 SMOKE_LIFETIME=0.5
  for (let i = 0; i < 60; i++) Cannon.update(1 / 60);
  assert.strictEqual(Cannon.getSmokeParticles().length, 0, "烟雾应全部消散");
});

test("无动画残留：未发射时 update 不产生粒子", () => {
  Cannon.reset(5);
  for (let i = 0; i < 10; i++) Cannon.update(1 / 60);
  assert.strictEqual(Cannon.getSmokeParticles().length, 0);
  assert.strictEqual(Cannon.getRecoil(), 0);
});

// ── 输入流转 ────────────────────────────────────────────────
console.log("\n[输入流转]");
test("dragStart → dragMove → dragEnd 设置瞄准角度", () => {
  Cannon.reset(5);
  Cannon.input({ type: "dragStart", x: 100, y: 400 });
  Cannon.input({ type: "dragMove", x: 200, y: 300 });
  assert.ok(Cannon.isAiming(), "拖拽中应为 aiming");
  // atan2(-100, 100) = -45°
  assert.ok(approx(Cannon.getAngle(), -Math.PI / 4, 0.1),
    "角度应≈-45°，实际=" + Cannon.getAngle() * 180 / Math.PI + "°");
  Cannon.input({ type: "dragEnd", x: 200, y: 300 });
  assert.ok(!Cannon.isAiming(), "dragEnd 后应退出 aiming");
});

// ── 回调钩子 ────────────────────────────────────────────────
console.log("\n[回调钩子]");
test("onFire 钩子可被覆写", () => {
  Cannon.reset(5);
  let called = false;
  Cannon.onFire = function (proj) { called = true; };
  Cannon.fire({ angle: 0, force: 100 });
  // onFire 由 Game 调用，此处仅验证可覆写不报错
  Cannon.onFire(null);
  assert.ok(typeof Cannon.onFire === "function");
});

test("onCollision 钩子可被调用", () => {
  Cannon.reset(5);
  let hit = false;
  Cannon.onCollision = function () { hit = true; };
  Cannon.onCollision({}, {}, 500);
  assert.ok(hit);
});

// ── API 完整性 ──────────────────────────────────────────────
console.log("\n[API 完整性]");
test("Cannon 暴露必要接口", () => {
  assert.strictEqual(typeof Cannon.fire, "function");
  assert.strictEqual(typeof Cannon.canFire, "function");
  assert.strictEqual(typeof Cannon.update, "function");
  assert.strictEqual(typeof Cannon.input, "function");
  assert.strictEqual(typeof Cannon.onFire, "function");
  assert.strictEqual(typeof Cannon.onCollision, "function");
  assert.strictEqual(typeof Cannon.reset, "function");
  assert.strictEqual(typeof Cannon.getAngle, "function");
  assert.strictEqual(typeof Cannon.getForce, "function");
  assert.strictEqual(typeof Cannon.getRecoil, "function");
  assert.strictEqual(typeof Cannon.getSmokeParticles, "function");
});

// ── 结果 ────────────────────────────────────────────────────
console.log("\n──────────────────────────────");
console.log("  通过: " + passed + " / 失败: " + failed);
console.log("──────────────────────────────\n");

if (failed > 0) process.exit(1);
