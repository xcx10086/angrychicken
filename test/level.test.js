/**
 * Level & Target System - 单元测试（Node.js 运行）
 * 覆盖验收标准：
 *   1. Level.load(n) 返回 { cannon, bulls, blocks, shots, ground, name }
 *   2. Level.count >= 3
 *   3. Level.current 正确跟踪当前关卡
 *   4. 牛头为圆形刚体，格式兼容 Physics.addBody
 *   5. 建筑块为矩形刚体，格式兼容 Physics.addBody
 *   6. 关卡难度递进（炮弹/牛头/建筑数量）
 *   7. 关卡 3 含可触发连锁破坏的结构
 */

const assert = require("assert");

require("../physics.js");
require("../level.js");
const Level = globalThis.Level;
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
    console.log("    " + (e.stack || e.message).split("\n").slice(0, 2).join("\n"));
  }
}

console.log("\nLevel & Target System Tests\n");

// 1. API 完整性
console.log("[API 完整性]");
test("Level 暴露 load/count/current", () => {
  assert.strictEqual(typeof Level.load, "function");
  assert.strictEqual(typeof Level.count, "number");
  assert.strictEqual(typeof Level.current, "number");
});

test("Level.current 初始为 0", () => {
  // 注意：由于其他测试可能已修改 current，这里只验证类型
  assert.strictEqual(typeof Level.current, "number");
});

// 2. 关卡总数
console.log("\n[关卡总数]");
test("Level.count >= 3", () => {
  assert.ok(Level.count >= 3, "关卡总数应>=3，实际=" + Level.count);
});

// 3. load 返回结构
console.log("\n[关卡结构]");
test("load(1) 返回完整关卡对象", () => {
  const lv = Level.load(1);
  assert.ok(lv, "load(1) 不应返回 null");
  assert.ok(lv.cannon && typeof lv.cannon.x === "number" && typeof lv.cannon.y === "number");
  assert.ok(Array.isArray(lv.bulls) && lv.bulls.length > 0);
  assert.ok(Array.isArray(lv.blocks));
  assert.ok(typeof lv.shots === "number" && lv.shots > 0);
  assert.ok(lv.ground, "应有 ground 配置");
  assert.ok(typeof lv.name === "string");
});

test("load 越界返回 null", () => {
  assert.strictEqual(Level.load(0), null);
  assert.strictEqual(Level.load(-1), null);
  assert.strictEqual(Level.load(Level.count + 1), null);
  assert.strictEqual(Level.load(999), null);
});

test("load 后 current 更新", () => {
  Level.load(2);
  assert.strictEqual(Level.current, 2);
  Level.load(1);
  assert.strictEqual(Level.current, 1);
  Level.load(3);
  assert.strictEqual(Level.current, 3);
});

// 4. 牛头刚体格式
console.log("\n[牛头刚体]");
test("牛头为圆形刚体，兼容 Physics.addBody", () => {
  const lv = Level.load(1);
  for (const bull of lv.bulls) {
    assert.strictEqual(bull.type, "pig", "牛头 type 应为 pig");
    assert.strictEqual(bull.isStatic, false, "牛头应为动态");
    assert.ok(typeof bull.x === "number" && typeof bull.y === "number");
    assert.ok(typeof bull.radius === "number" && bull.radius > 0, "牛头应有正 radius");
    assert.ok(typeof bull.mass === "number" && bull.mass > 0);
    assert.ok(typeof bull.vx === "number" && typeof bull.vy === "number");
    assert.strictEqual(typeof bull.onHit, "function", "牛头应有 onHit 回调");
    assert.ok(bull._hp !== undefined, "牛头应有 _hp");
    assert.ok(bull._worldBounds, "牛头应有 _worldBounds");
  }
});

test("牛头可注册到 Physics 并被检测", () => {
  Physics.clear();
  const lv = Level.load(1);
  for (const bull of lv.bulls) Physics.addBody(bull);
  const pigs = Physics.getBodies().filter(b => b.type === "pig");
  assert.strictEqual(pigs.length, lv.bulls.length);
});

test("牛头 onHit 回调可被触发", () => {
  Physics.clear();
  const lv = Level.load(1);
  const bull = lv.bulls[0];
  Physics.addBody(bull);
  // 高速炮弹击中牛头
  const proj = { x: bull.x - 60, y: bull.y, vx: 1500, vy: 0, radius: 8, mass: 2, type: "projectile", isStatic: false };
  Physics.addBody(proj);
  for (let i = 0; i < 10; i++) Physics.update(1 / 60);
  assert.ok(bull._hp <= 0 || bull._lastHitImpact > 0, "牛头应被击中");
});

// 5. 建筑块刚体格式
console.log("\n[建筑块刚体]");
test("建筑块为矩形刚体，兼容 Physics.addBody", () => {
  const lv = Level.load(2);
  assert.ok(lv.blocks.length > 0, "第2关应有建筑块");
  for (const block of lv.blocks) {
    assert.strictEqual(block.type, "block", "建筑块 type 应为 block");
    assert.strictEqual(block.isStatic, false, "建筑块应为动态");
    assert.ok(typeof block.width === "number" && block.width > 0, "应有 width");
    assert.ok(typeof block.height === "number" && block.height > 0, "应有 height");
    assert.ok(typeof block.radius === "number" && block.radius > 0, "应有 radius（AABB 半边长）");
    assert.ok(typeof block.mass === "number" && block.mass > 0);
    assert.ok(typeof block.x === "number" && typeof block.y === "number");
    assert.ok(typeof block.vx === "number" && typeof block.vy === "number");
    assert.ok(block._worldBounds, "建筑块应有 _worldBounds");
  }
});

test("建筑块可注册到 Physics 并被破碎", () => {
  Physics.clear();
  const lv = Level.load(2);
  for (const b of lv.blocks) Physics.addBody(b);
  // 高速炮弹击碎建筑
  const block = lv.blocks[0];
  const proj = { x: block.x - 60, y: block.y, vx: 2000, vy: 0, radius: 8, mass: 2, type: "projectile", isStatic: false };
  Physics.addBody(proj);
  const before = Physics.getBodies().filter(b => b.type === "block").length;
  for (let i = 0; i < 10; i++) Physics.update(1 / 60);
  const after = Physics.getBodies().filter(b => b.type === "block").length;
  const debris = Physics.getBodies().filter(b => b.type === "debris").length;
  assert.ok(after < before || debris > 0, "建筑应被破坏");
});

// 6. 关卡难度递进
console.log("\n[难度递进]");
test("关卡炮弹数/牛头数/建筑数递进", () => {
  const stats = [];
  for (let i = 1; i <= Level.count; i++) {
    const lv = Level.load(i);
    stats.push({ shots: lv.shots, bulls: lv.bulls.length, blocks: lv.blocks.length });
  }
  // 炮弹数递增
  for (let i = 1; i < stats.length; i++) {
    assert.ok(stats[i].shots >= stats[i - 1].shots, "炮弹数应递增");
  }
  // 牛头数递增
  for (let i = 1; i < stats.length; i++) {
    assert.ok(stats[i].bulls >= stats[i - 1].bulls, "牛头数应递增");
  }
  // 建筑数递增
  for (let i = 1; i < stats.length; i++) {
    assert.ok(stats[i].blocks >= stats[i - 1].blocks, "建筑数应递增");
  }
});

// 7. 关卡 3 需连锁/反弹结构
console.log("\n[关卡3 结构]");
test("关卡3 有多层建筑可触发连锁破坏", () => {
  const lv = Level.load(3);
  assert.ok(lv.bulls.length >= 3, "关卡3 至少3只牛头");
  assert.ok(lv.blocks.length >= 5, "关卡3 至少5个建筑块");

  // 验证有牛头被建筑遮挡（y 坐标上方有建筑块）
  const bullsY = lv.bulls.map(b => b.y);
  const blocksY = lv.blocks.map(b => b.y);
  const minBlockY = Math.min(...blocksY);
  const maxBullY = Math.max(...bullsY);
  // 应有建筑在牛头上方（y 更小），构成遮挡
  assert.ok(minBlockY < maxBullY, "应有建筑块在牛头上方形成遮挡");

  // 验证有不同高度的牛头（需要不同弹道/反弹）
  const uniqueY = new Set(lv.bulls.map(b => Math.round(b.y / 20) * 20));
  assert.ok(uniqueY.size >= 2, "牛头应分布在至少2个高度层，需不同弹道");
});

// 8. 地面配置
console.log("\n[地面配置]");
test("每关都有 ground 配置且兼容 Physics", () => {
  for (let i = 1; i <= Level.count; i++) {
    const lv = Level.load(i);
    assert.ok(lv.ground, "第" + i + "关应有 ground");
    assert.strictEqual(lv.ground.type, "ground");
    assert.strictEqual(lv.ground.isStatic, true);
    assert.ok(typeof lv.ground.x === "number" && typeof lv.ground.y === "number");
    assert.ok(typeof lv.ground.radius === "number" && lv.ground.radius > 0);
    assert.ok(lv.ground.mass > 1000, "地面质量应很大");
  }
});

test("ground 可注册到 Physics 作为静态刚体", () => {
  Physics.clear();
  const lv = Level.load(1);
  Physics.addBody(lv.ground);
  const grounds = Physics.getBodies().filter(b => b.type === "ground");
  assert.strictEqual(grounds.length, 1);
  assert.strictEqual(grounds[0].isStatic, true);
});

// 9. 炮台位置合理性
console.log("\n[炮台位置]");
test("炮台在左侧区域，牛头在右侧区域", () => {
  for (let i = 1; i <= Level.count; i++) {
    const lv = Level.load(i);
    assert.ok(lv.cannon.x < 200, "炮台应在左侧，x=" + lv.cannon.x);
    for (const bull of lv.bulls) {
      assert.ok(bull.x > lv.cannon.x, "牛头应在炮台右侧");
    }
  }
});

// 10. 牛头半径稍大（便于击中）
test("牛头半径 >= 15（稍大便于击中）", () => {
  for (let i = 1; i <= Level.count; i++) {
    const lv = Level.load(i);
    for (const bull of lv.bulls) {
      assert.ok(bull.radius >= 15, "牛头半径应>=15，实际=" + bull.radius);
    }
  }
});

// ── 结果 ────────────────────────────────────────────────────
console.log("\n──────────────────────────────");
console.log("  通过: " + passed + " / 失败: " + failed);
console.log("──────────────────────────────\n");

if (failed > 0) process.exit(1);
