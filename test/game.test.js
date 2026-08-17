/**
 * Game Core Logic - 单元测试（Node.js 运行）
 * 覆盖验收标准：
 *   1. 主循环可启停，状态机切换正常
 *   2. AIMING → FLYING → RESOLVING → WIN/LOSE 流转
 *   3. 胜负判定：全灭牛头=通关；炮弹耗尽且牛头未清=失败
 *   4. 通关后可进入下一关
 *   5. 状态切换前清理中间态
 *
 * 驱动方式：直接调用 Game._internal.stepFrame(FIXED_DT) 推进逻辑帧，
 * 不依赖 requestAnimationFrame / running 标志。
 */

const assert = require("assert");

require("../physics.js");
require("../game.js");
const Physics = globalThis.Physics;
const Game = globalThis.Game;

const FIXED_DT = 1 / 60;
const stepFrame = Game._internal.stepFrame;

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

// stub requestAnimationFrame（start/stop 测试用）
let rafCbs = [];
globalThis.requestAnimationFrame = function (cb) {
  const id = rafCbs.length;
  rafCbs.push(cb);
  return id;
};
globalThis.cancelAnimationFrame = function (id) {
  rafCbs[id] = null;
};
if (!globalThis.performance) globalThis.performance = {};
globalThis.performance.now = function () { return Date.now(); };

function driveFrames(count) {
  for (let i = 0; i < count; i++) {
    stepFrame(FIXED_DT);
  }
}

// 驱动直到状态变化或达到最大帧数（防止无限循环）
function driveUntil(targetState, maxFrames) {
  maxFrames = maxFrames || 600;
  let n = 0;
  while (Game.getState() !== targetState && n < maxFrames) {
    stepFrame(FIXED_DT);
    n++;
  }
  return n;
}

console.log("\nGame Core Logic Tests\n");

// 1. 状态枚举与初始状态
console.log("[状态枚举]");
test("Game.State 包含五个状态", () => {
  assert.ok(Game.State.AIMING);
  assert.ok(Game.State.FLYING);
  assert.ok(Game.State.RESOLVING);
  assert.ok(Game.State.WIN);
  assert.ok(Game.State.LOSE);
});

test("loadLevel 后状态为 AIMING", () => {
  Game.loadLevel(1);
  assert.strictEqual(Game.getState(), Game.State.AIMING);
  assert.strictEqual(Game.getCurrentLevel(), 1);
});

// 2. 发射与状态流转
console.log("\n[发射与状态流转]");
test("fire 从 AIMING 切到 FLYING", () => {
  Game.loadLevel(1);
  const ok = Game.fire({ vx: 800, vy: -400 });
  assert.ok(ok, "fire 应返回 true");
  assert.strictEqual(Game.getState(), Game.State.FLYING);
  assert.strictEqual(Game.getProjectilesLeft(), 2); // 3-1
});

test("非 AIMING 态 fire 返回 false", () => {
  Game.loadLevel(1);
  Game.fire({ vx: 800, vy: -400 });
  // 现在是 FLYING
  const ok = Game.fire();
  assert.ok(!ok, "FLYING 态不应再 fire");
});

test("fire 消耗炮弹计数", () => {
  Game.loadLevel(1);
  const before = Game.getProjectilesLeft();
  Game.fire({ vx: 1, vy: -1 });
  assert.strictEqual(Game.getProjectilesLeft(), before - 1);
});

// 3. 胜负判定
console.log("\n[胜负判定]");
test("炮弹耗尽且牛头仍在 → LOSE", () => {
  Game.loadLevel(1);
  // 第1关3发炮弹；低速炮弹打不到牛头，3发打完应失败
  for (let i = 0; i < 3; i++) {
    // 确保从 AIMING 发射
    if (Game.getState() !== Game.State.AIMING) {
      driveUntil(Game.State.AIMING, 600);
    }
    if (Game.getState() !== Game.State.AIMING) break;
    Game.fire({ vx: 10, vy: -5, x: 80, y: 380 });
    // 推进到炮弹静止 + RESOLVING 延迟（1s≈60帧 + 缓冲）
    driveUntil(Game.State.RESOLVING, 600);
    driveFrames(90); // 越过 RESOLVING 延迟
  }
  assert.strictEqual(Game.getState(), Game.State.LOSE,
    "3发耗尽应失败，状态=" + Game.getState());
});

test("直接消灭所有牛头 → WIN", () => {
  Game.loadLevel(1);
  // 第1关1只牛头在 (600,420)；从场地中部水平发射高速炮弹命中
  Game.fire({ x: 200, y: 420, vx: 2000, vy: 0 });
  // 推进让碰撞发生并结算
  driveUntil(Game.State.RESOLVING, 600);
  driveFrames(70); // RESOLVING 延迟
  // 若未直接通关，再来几发
  while (Game.getState() === Game.State.AIMING && Game.getProjectilesLeft() > 0) {
    Game.fire({ x: 200, y: 420, vx: 2000, vy: 0 });
    driveUntil(Game.State.RESOLVING, 600);
    driveFrames(70);
  }
  assert.strictEqual(Game.getState(), Game.State.WIN,
    "消灭所有牛头应通关，状态=" + Game.getState());
});

// 4. 关卡进度
console.log("\n[关卡进度]");
test("通关后 nextLevel 加载下一关", () => {
  Game.loadLevel(1);
  // 手动把牛头 hp 清零，再发一发让结算判定 WIN
  for (const b of Physics.getBodies()) {
    if (b.type === "pig") b._hp = 0;
  }
  Game.fire({ vx: 1, vy: -1, x: 200, y: 380 });
  driveUntil(Game.State.RESOLVING, 600);
  driveFrames(70);
  assert.strictEqual(Game.getState(), Game.State.WIN, "应先 WIN，状态=" + Game.getState());
  const before = Game.getCurrentLevel();
  const ok = Game.nextLevel();
  assert.ok(ok);
  assert.strictEqual(Game.getCurrentLevel(), before + 1);
  assert.strictEqual(Game.getState(), Game.State.AIMING);
});

test("loadLevel 越界返回 false", () => {
  assert.ok(!Game.loadLevel(0));
  assert.ok(!Game.loadLevel(999));
});

test("总关卡数 >= 3", () => {
  assert.ok(Game.getTotalLevels() >= 3, "总关卡=" + Game.getTotalLevels());
});

// 5. 中间态清理
console.log("\n[中间态清理]");
test("结算后飞行炮弹与碎片被清理", () => {
  Game.loadLevel(1);
  Game.fire({ vx: 50, vy: -30, x: 80, y: 380 });
  // 推进到 RESOLVING 并完成延迟判定
  driveUntil(Game.State.RESOLVING, 600);
  driveFrames(90);
  // 进入 AIMING/LOSE/WIN 后不应有 projectile/debris
  const bodies = Physics.getBodies();
  const transient = bodies.filter(b => b.type === "projectile" || b.type === "debris");
  assert.ok(transient.length === 0,
    "不应残留炮弹/碎片，残留=" + transient.length);
});

// 6. 主循环启停
console.log("\n[主循环]");
test("start/stop 控制运行状态", () => {
  Game.loadLevel(1);
  Game.start();
  assert.ok(Game.isRunning());
  // 驱动几帧 rAF 队列
  for (let i = 0; i < 3; i++) {
    const cbs = rafCbs.slice();
    rafCbs = [];
    for (const cb of cbs) { if (cb) cb(performance.now() + 16); }
  }
  Game.stop();
  assert.ok(!Game.isRunning());
});

// 7. 状态变化回调
console.log("\n[状态回调]");
test("onStateChange 被调用", () => {
  const transitions = [];
  Game.onStateChange((next, prev) => transitions.push(prev + "->" + next));
  Game.loadLevel(1);
  Game.fire({ vx: 1, vy: -1, x: 80, y: 380 });
  driveUntil(Game.State.RESOLVING, 600);
  driveFrames(90);
  assert.ok(transitions.length > 0, "应有状态切换记录");
  Game.onStateChange(null);
});

// ── 结果 ────────────────────────────────────────────────────
console.log("\n──────────────────────────────");
console.log("  通过: " + passed + " / 失败: " + failed);
console.log("──────────────────────────────\n");

if (failed > 0) process.exit(1);
