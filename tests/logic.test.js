// 執行方式:在專案根目錄打 `node --test`(或 `npm test`),需要 Node 18 以上
// 每個測試都對應 SPEC.md 的一條規則或驗收標準。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../src/logic.js');
const C = L.CONFIG;

// 固定亂數,讓測試結果每次都一樣
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

test('SPEC §4:平台資料跟 assets/platforms.json 完全一致', () => {
  const json = JSON.parse(fs.readFileSync(path.join(__dirname, '../assets/platforms.json'), 'utf8'));
  assert.deepEqual(C.PLATFORMS, json.platforms);
  assert.equal(C.GROUND_Y, json.groundY);
});

test('SPEC §2:9 顆太陽都在時是大白天,越少越暗', () => {
  assert.equal(L.skyDarkness(9), 0);
  for (let a = 9; a > 1; a--) assert.ok(L.skyDarkness(a - 1) > L.skyDarkness(a));
});

test('SPEC §2:只要還有太陽,天色不會超過「深黃昏」上限', () => {
  for (let a = 1; a <= 9; a++) assert.ok(L.skyDarkness(a) <= C.MAX_DARKNESS);
  assert.ok(L.skyDarkness(1) < C.MAX_DARKNESS);
});

test('SPEC §7:跳躍高度約 120px,夠跳上高一層平台', () => {
  const h = (C.JUMP_V * C.JUMP_V) / (2 * C.GRAVITY);
  assert.ok(h > 115 && h < 125, `jump height ${h}`);
  // 相鄰平台高度差都要跳得上去
  const levels = [C.GROUND_Y, ...C.PLATFORMS.map((p) => p.y)].sort((a, b) => b - a);
  for (let i = 1; i < levels.length; i++) assert.ok(levels[i - 1] - levels[i] <= h);
});

test('SPEC §7:從上方落下會站到平台上', () => {
  const p = C.PLATFORMS[1]; // x 330~490, y 400
  const y = L.landOnSurface(395, 410, 400, C.PLAYER_HALF_W, C.PLATFORMS, C.GROUND_Y, false);
  assert.equal(y, p.y);
});

test('SPEC §7:單向平台——從下方往上跳會直接穿過', () => {
  // 往上移動
  assert.equal(L.landOnSurface(420, 395, 400, C.PLAYER_HALF_W, C.PLATFORMS, C.GROUND_Y, false), null);
  // 往下移動但本來就在平台下方
  assert.equal(L.landOnSurface(405, 415, 400, C.PLAYER_HALF_W, C.PLATFORMS, C.GROUND_Y, false), null);
});

test('SPEC §7:按 S 往下跳時忽略平台,但還是會落在地面', () => {
  assert.equal(L.landOnSurface(395, 410, 400, C.PLAYER_HALF_W, C.PLATFORMS, C.GROUND_Y, true), null);
  assert.equal(L.landOnSurface(550, 560, 400, C.PLAYER_HALF_W, C.PLATFORMS, C.GROUND_Y, true), C.GROUND_Y);
});

test('SPEC §7:站在平台外面不會被平台接住', () => {
  assert.equal(L.landOnSurface(395, 410, 20, C.PLAYER_HALF_W, C.PLATFORMS, C.GROUND_Y, false), null);
});

test('SPEC §6:兔劍只清掉半徑 150 內的彈幕', () => {
  const projectiles = [
    { x: 100, y: 100 }, // 距離 0
    { x: 240, y: 100 }, // 距離 140 → 清掉
    { x: 260, y: 100 }, // 距離 160 → 保留
  ];
  const { kept, removed } = L.clearProjectilesInRadius(projectiles, 100, 100, C.SLASH_RADIUS);
  assert.equal(removed.length, 2);
  assert.deepEqual(kept, [{ x: 260, y: 100 }]);
});

test('SPEC §6:兔劍冷卻 5 秒,進度條 0→1', () => {
  assert.equal(C.SLASH_COOLDOWN, 5);
  assert.equal(L.cooldownProgress(5, 5), 0);
  assert.equal(L.cooldownProgress(2.5, 5), 0.5);
  assert.equal(L.cooldownProgress(0, 5), 1);
  assert.equal(L.cooldownProgress(-1, 5), 1);
});

test('SPEC §6:月餅 buff 數值', () => {
  assert.deepEqual(C.BUFFS, ['rapid', 'double', 'shield', 'heal']);
  assert.ok(Math.abs(L.attackInterval(0.44, 'rapid') - 0.2) < 1e-9);
  assert.equal(L.attackInterval(0.4, 'double'), 0.4);
  assert.equal(L.applyHeal(60, 100, C.HEAL_AMOUNT), 85);
  assert.equal(L.applyHeal(90, 100, C.HEAL_AMOUNT), 100);
  const rng = seeded(1);
  for (let i = 0; i < 50; i++) assert.ok(C.BUFFS.includes(L.pickBuff(rng)));
});

test('SPEC §5:太陽血量 80,普通箭約 14 發打掉一顆', () => {
  assert.equal(C.SUN_HP, 80);
  assert.equal(Math.ceil(C.SUN_HP / C.ARROW_DAMAGE), 14);
});

test('SPEC §8:勝負判定', () => {
  assert.equal(L.checkOutcome(1, 50), 'win');
  assert.equal(L.checkOutcome(2, 50), 'playing');
  assert.equal(L.checkOutcome(5, 0), 'lose');
});

test('v3 SPEC §8:最後兩顆同時被射下來(剩 0 顆)= 隱藏結局', () => {
  assert.equal(L.checkOutcome(0, 50), 'allgone');
  assert.equal(L.checkOutcome(0, 0), 'lose'); // 同時被打死還是算輸
});

test('SPEC §4:太陽漂浮幅度 ±7px、2.5 秒一循環', () => {
  for (let t = 0; t < 5; t += 0.05) assert.ok(Math.abs(L.sunFloatOffset(t, 1.3)) <= 7 + 1e-9);
  assert.ok(Math.abs(L.sunFloatOffset(0.3, 0.7) - L.sunFloatOffset(2.8, 0.7)) < 1e-9);
});

test('SPEC §3:太陽排列輕微打亂,不是一直線、也不會疊在一起', () => {
  const suns = L.layoutSuns(seeded(42));
  assert.equal(suns.length, 9);
  assert.ok(new Set(suns.map((s) => Math.round(s.y))).size > 1);
  for (let i = 0; i < suns.length; i++) {
    const s = suns[i];
    assert.ok(s.x > 30 && s.x < 870 && s.y > 50 && s.y < 190);
    for (let j = i + 1; j < suns.length; j++) {
      assert.ok(Math.hypot(s.x - suns[j].x, s.y - suns[j].y) > 55, `sun ${i} & ${j} overlap`);
    }
  }
});

test('SPEC §7:月餅第一次落地反彈 30%,第二次就停住', () => {
  assert.equal(L.cakeBounceVelocity(500, false), -150);
  assert.equal(L.cakeBounceVelocity(150, true), 0);
});

test('SPEC §7:月餅落地 6 秒後消失,最後 2 秒閃爍', () => {
  assert.equal(L.cakeState(0), 'solid');
  assert.equal(L.cakeState(3.9), 'solid');
  assert.equal(L.cakeState(4.1), 'blink');
  assert.equal(L.cakeState(6), 'gone');
});

test('SPEC §5:追蹤火球每次只微幅轉向,速度不變', () => {
  const r = L.steerTowards(0, 100, 0, 0, 100, 0, 0.1); // 往下飛,目標在右邊
  assert.ok(Math.abs(Math.hypot(r.vx, r.vy) - 100) < 1e-9);
  assert.ok(r.vx > 0 && r.vy > 0); // 往右偏了一點,但還是往下
});

test('雙箭:回傳最近的兩顆存活太陽', () => {
  const suns = [
    { x: 0, y: 0, alive: true },
    { x: 10, y: 0, alive: false },
    { x: 20, y: 0, alive: true },
    { x: 500, y: 0, alive: true },
  ];
  const near = L.nearestSuns(suns, 12, 0, 2);
  assert.deepEqual(near.map((s) => s.x), [20, 0]);
});

test('彈幕跟倉鼠矩形的碰撞', () => {
  assert.ok(L.circleRectHit(50, 50, 10, 40, 40, 60, 60));
  assert.ok(L.circleRectHit(35, 50, 6, 40, 40, 60, 60));
  assert.ok(!L.circleRectHit(20, 50, 6, 40, 40, 60, 60));
});

// ---------------- v3 ----------------

test('v3 SPEC §7:箭朝游標方向直線飛出', () => {
  const [v] = L.arrowVolley(100, 100, 100, 0, 1); // 游標在正上方
  assert.ok(Math.abs(v.vx) < 1e-9 && v.vy < 0);
  assert.ok(Math.abs(Math.hypot(v.vx, v.vy) - C.ARROW_SPEED) < 1e-9);
});

test('v3 SPEC §6:雙箭 = 兩支箭左右各偏一點', () => {
  const vs = L.arrowVolley(0, 0, 100, 0, 2); // 游標在正右方
  assert.equal(vs.length, 2);
  assert.ok(vs[0].vy < 0 && vs[1].vy > 0);
  assert.ok(Math.abs(vs[0].vy + vs[1].vy) < 1e-9);
});

test('v3:滑鼠座標會依畫布縮放換算', () => {
  const rect = { left: 10, top: 20, width: 450, height: 300 }; // 畫布被縮成一半顯示
  assert.deepEqual(L.toCanvasPoint(10 + 225, 20 + 150, rect, 900, 600), { x: 450, y: 300 });
});

test('v3:直線飛的箭打中路上碰到的太陽,死掉的太陽不算', () => {
  const suns = [{ x: 0, y: 0, alive: false }, { x: 0, y: 0, alive: true, id: 2 }, { x: 500, y: 0, alive: true }];
  assert.equal(L.arrowHitSun(10, 10, suns).id, 2);
  assert.equal(L.arrowHitSun(200, 200, suns), null);
});

test('v3 SPEC §5:追蹤火球轉彎變慢,而且只追前 1.8 秒', () => {
  const dt = 1 / 60;
  // 往下飛、玩家在正右方:一幀最多只能轉 HOMING_TURN_RATE * dt
  const r = L.homingSteer(0, 130, 0, 0, 100, 0, dt, 0.5);
  const turned = Math.abs(Math.atan2(r.vy, r.vx) - Math.PI / 2);
  assert.ok(turned <= C.HOMING_TURN_RATE * dt + 1e-9);
  assert.ok(C.HOMING_TURN_RATE < 1.8); // 比 v2 慢
  // 超過追蹤時間就完全不轉
  assert.deepEqual(L.homingSteer(0, 130, 0, 0, 100, 0, dt, C.HOMING_TRACK_TIME + 0.1), { vx: 0, vy: 130 });
});

test('v3 SPEC §5:特殊技能有全域冷卻', () => {
  assert.ok(!L.globalSkillReady(C.GLOBAL_SKILL_CD - 0.1));
  assert.ok(L.globalSkillReady(C.GLOBAL_SKILL_CD));
});

test('v3 SPEC §5:彈幕變少(普通攻擊間隔拉長、扇形機率降低)', () => {
  assert.ok(C.SUN_FIRE_INTERVAL[0] >= 3);
  assert.ok(C.FAN_CHANCE < 0.22);
  assert.ok(C.SPECIAL_INTERVAL[0] >= 12);
  assert.ok(C.LAST_STAND_SHOTS < 16);
});

// ---------------- 手機版 ----------------

test('手機版:搖桿推超過死區才開始瞄準射箭,方向正確', () => {
  const idle = L.stickVector(5, 0, 60);
  assert.equal(idle.active, false);
  const up = L.stickVector(0, -50, 60);
  assert.equal(up.active, true);
  assert.ok(Math.abs(up.angle + Math.PI / 2) < 1e-9); // 往上推 = 朝上射
  assert.equal(L.stickVector(0, -500, 60).mag, 1); // 推出框外也只算 1
});

test('手機版:依裝置決定要不要用觸控介面', () => {
  assert.equal(L.prefersTouchUI({ coarse: true, fine: false, maxTouchPoints: 5 }), true); // 手機
  assert.equal(L.prefersTouchUI({ coarse: false, fine: true, maxTouchPoints: 0 }), false); // 一般電腦
  assert.equal(L.prefersTouchUI({ coarse: false, fine: true, maxTouchPoints: 10 }), false); // 觸控筆電:先用電腦介面
  assert.equal(L.prefersTouchUI({ coarse: false, fine: false, maxTouchPoints: 5 }), true);
});

test('手機版:瞄準輔助會吸附到方向附近的太陽', () => {
  const suns = [
    { x: 100, y: -100, alive: true, id: 'a' },  // 右上 45°
    { x: -100, y: -100, alive: true, id: 'b' }, // 左上
  ];
  const up45 = -Math.PI / 4;
  const near = L.aimAssist(0, 0, up45 + 0.1, suns); // 差 0.1 弧度 ≈ 6° → 吸附
  assert.equal(near.target.id, 'a');
  assert.ok(Math.abs(near.angle - up45) < 1e-9);
  const far = L.aimAssist(0, 0, -Math.PI / 2, suns); // 正上方,兩顆都差 45° → 不吸附
  assert.equal(far.target, null);
  assert.equal(far.angle, -Math.PI / 2);
  const dead = L.aimAssist(0, 0, up45, [{ x: 100, y: -100, alive: false }]);
  assert.equal(dead.target, null); // 死掉的太陽不吸
});
