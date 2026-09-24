/* ==========================================================
   logic.js — 遊戲的「純邏輯」:只有數值和計算,不碰畫面。
   這樣拆開的好處:可以用 Node 直接跑單元測試(tests/logic.test.js),
   瀏覽器裡則由 game.js 透過全域變數 HouyiLogic 使用。
   所有數值都對應 SPEC.md,改數值請同步改 SPEC。
   ========================================================== */
(function (root) {
  'use strict';

  const CONFIG = {
    W: 900,
    H: 600,
    GROUND_Y: 555,
    PLATFORM_THICKNESS: 22,
    // 跟 assets/platforms.json、background.png 上畫的平台一致(y = 站立面)
    PLATFORMS: [
      { x: 70, y: 470, w: 160 },
      { x: 330, y: 400, w: 160 },
      { x: 600, y: 470, w: 160 },
      { x: 700, y: 380, w: 160 },
      { x: 150, y: 310, w: 150 },
      { x: 450, y: 300, w: 160 },
    ],

    // 重力(SPEC §7)
    GRAVITY: 1400,
    MAX_FALL: 700,
    JUMP_V: 580,
    MOVE_SPEED: 240,
    DROP_THROUGH_TIME: 0.25,

    // 玩家
    PLAYER_HP: 100,
    PLAYER_HALF_W: 22,
    PLAYER_H: 58,
    HIT_INVINCIBLE: 0.8,
    ATTACK_INTERVAL: 0.4,
    ARROW_DAMAGE: 6,
    ARROW_SPEED: 560,
    DOUBLE_ARROW_SPREAD: 0.1, // 雙箭:兩支箭各往外偏約 6°

    // 兔劍(SPEC §6)
    SLASH_COOLDOWN: 5,
    SLASH_RADIUS: 150,
    SLASH_ANIM: 0.35,
    BUBBLE_TIME: 0.8,
    ROAR_FACE_TIME: 0.4,
    BUBBLE_TEXT: '🖕🐰',

    // 月光衝刺(SPEC §6 新增技能)
    DASH_COOLDOWN: 4,
    DASH_DISTANCE: 120,
    DASH_TIME: 0.12,
    DASH_INVINCIBLE: 0.2,

    // 月餅 buff
    BUFFS: ['rapid', 'double', 'shield', 'heal'],
    BUFF_DURATION: 6,
    RAPID_DIVISOR: 2.2,
    HEAL_AMOUNT: 25,
    CAKE_BOUNCE: 0.3,
    CAKE_LIFETIME: 6,
    CAKE_BLINK: 2,
    CAKE_HALF: 16,

    // 太陽(SPEC §4、§5)
    SUN_COUNT: 9,
    SUN_HP: 80,
    SUN_HIT_RADIUS: 34,
    SUN_FLOAT_AMP: 7,
    SUN_FLOAT_PERIOD: 2.5,
    LAST_STAND_RATIO: 0.2,
    LAST_STAND_SHOTS: 10,

    // 太陽攻擊節奏(v3 調降:彈幕變少、技能之間有全域冷卻)
    SUN_FIRE_INTERVAL: [3.0, 4.5],   // 每顆太陽普通攻擊間隔(秒)
    FAN_CHANCE: 0.15,                // 普通攻擊變成扇形的機率
    SPECIAL_INTERVAL: [12, 18],      // 每顆太陽自己的特殊技能冷卻
    GLOBAL_SKILL_CD: 3.5,            // 全場任兩個特殊技能(追蹤/灼熱/雷射)之間至少隔這麼久
    LASER_INTERVAL: [14, 18],
    HOMING_SPEED: 130,
    HOMING_TURN_RATE: 0.7,           // 每秒最多轉幾弧度(舊版 1.8,幾乎躲不掉)
    HOMING_TRACK_TIME: 1.8,          // 只追前 1.8 秒,之後直線飛

    // 手機版搖桿
    STICK_DEADZONE: 0.25,

    // 光照(SPEC §2):只要還有太陽,最暗只到深黃昏
    MAX_DARKNESS: 0.55,
  };

  /** 天色變暗程度(0 = 大白天)。存活太陽 ≥1 時永遠不超過 MAX_DARKNESS。 */
  function skyDarkness(alive, total, maxDarkness) {
    total = total || CONFIG.SUN_COUNT;
    maxDarkness = maxDarkness === undefined ? CONFIG.MAX_DARKNESS : maxDarkness;
    const a = Math.max(0, Math.min(total, alive));
    return maxDarkness * (1 - a / total);
  }

  /**
   * 單向平台落地判定。回傳站到的表面 y,沒有落地回傳 null。
   * 只有「上一幀在表面上方、這一幀到了表面或下方」才算落地,所以從下往上跳會直接穿過平台。
   * ignorePlatforms = true 時只看地面(從平台往下跳用)。
   */
  function landOnSurface(prevBottom, newBottom, x, halfW, platforms, groundY, ignorePlatforms) {
    if (newBottom < prevBottom) return null; // 往上移動不會落地
    let best = null;
    if (!ignorePlatforms) {
      for (const p of platforms) {
        const overlap = x + halfW > p.x && x - halfW < p.x + p.w;
        if (overlap && prevBottom <= p.y + 0.01 && newBottom >= p.y) {
          if (best === null || p.y < best) best = p.y;
        }
      }
    }
    if (newBottom >= groundY && (best === null || groundY < best)) best = groundY;
    return best;
  }

  /** 找 x 位置、y 以下最近的表面(用來決定灼熱警戒圈畫在哪)。 */
  function surfaceBelow(x, y, platforms, groundY) {
    let best = groundY;
    for (const p of platforms) {
      if (x >= p.x && x <= p.x + p.w && p.y >= y - 1 && p.y < best) best = p.y;
    }
    return best;
  }

  /** 冷卻進度 0~1(1 = 可以用了)。 */
  function cooldownProgress(remaining, total) {
    if (remaining <= 0) return 1;
    return Math.max(0, Math.min(1, 1 - remaining / total));
  }

  function attackInterval(base, buff) {
    return buff === 'rapid' ? base / CONFIG.RAPID_DIVISOR : base;
  }

  function applyHeal(hp, maxHp, amount) {
    return Math.min(maxHp, hp + amount);
  }

  /** 兔劍:清掉半徑內的「太陽彈幕」。只收彈幕陣列,玩家的箭根本不會傳進來。 */
  function clearProjectilesInRadius(projectiles, cx, cy, radius) {
    const kept = [];
    const removed = [];
    for (const p of projectiles) {
      if (Math.hypot(p.x - cx, p.y - cy) < radius) removed.push(p);
      else kept.push(p);
    }
    return { kept, removed };
  }

  /**
   * 勝負判定:剩 1 顆太陽 = 贏;血量歸零 = 輸;
   * 同一瞬間把最後兩顆一起射下來(0 顆)= 隱藏結局 'allgone'。
   */
  function checkOutcome(aliveSuns, playerHp) {
    if (playerHp <= 0) return 'lose';
    if (aliveSuns <= 0) return 'allgone';
    if (aliveSuns === 1) return 'win';
    return 'playing';
  }

  function sunFloatOffset(t, phase, amp, period) {
    amp = amp === undefined ? CONFIG.SUN_FLOAT_AMP : amp;
    period = period || CONFIG.SUN_FLOAT_PERIOD;
    return amp * Math.sin((2 * Math.PI * t) / period + phase);
  }

  /** 月餅第一次落地反彈 30%,之後就停住。回傳新的 vy(負的 = 往上彈)。 */
  function cakeBounceVelocity(vy, alreadyBounced) {
    return alreadyBounced ? 0 : -Math.abs(vy) * CONFIG.CAKE_BOUNCE;
  }

  /** 月餅落地後的狀態:'solid' 正常、'blink' 閃爍、'gone' 消失。 */
  function cakeState(ageOnGround) {
    if (ageOnGround >= CONFIG.CAKE_LIFETIME) return 'gone';
    if (ageOnGround >= CONFIG.CAKE_LIFETIME - CONFIG.CAKE_BLINK) return 'blink';
    return 'solid';
  }

  /** 9 顆太陽的「輕微打亂」排列。rng 預設 Math.random,測試時可以塞固定亂數。 */
  function layoutSuns(rng) {
    rng = rng || Math.random;
    const out = [];
    const n = CONFIG.SUN_COUNT;
    for (let i = 0; i < n; i++) {
      const x = 70 + i * (760 / (n - 1)) + (rng() * 2 - 1) * 20;
      const y = i % 2 === 0 ? 70 + rng() * 55 : 125 + rng() * 50;
      out.push({ x, y });
    }
    return out;
  }

  function pickBuff(rng) {
    rng = rng || Math.random;
    return CONFIG.BUFFS[Math.floor(rng() * CONFIG.BUFFS.length) % CONFIG.BUFFS.length];
  }

  /** 依距離排序,回傳最近的 n 顆存活太陽。 */
  function nearestSuns(suns, x, y, n) {
    return suns
      .filter((s) => s.alive)
      .map((s) => ({ s, d: Math.hypot(s.x - x, s.y - y) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, n)
      .map((o) => o.s);
  }

  /** 追蹤火球:每次最多轉 maxTurn 弧度朝目標修正方向,速度不變。 */
  function steerTowards(vx, vy, x, y, tx, ty, maxTurn) {
    const speed = Math.hypot(vx, vy);
    const cur = Math.atan2(vy, vx);
    const want = Math.atan2(ty - y, tx - x);
    let diff = want - cur;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    const turn = Math.max(-maxTurn, Math.min(maxTurn, diff));
    const ang = cur + turn;
    return { vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed };
  }

  /** 追蹤火球:只在發射後 HOMING_TRACK_TIME 秒內追蹤,而且每秒最多轉 HOMING_TURN_RATE 弧度。 */
  function homingSteer(vx, vy, x, y, tx, ty, dt, age) {
    if (age >= CONFIG.HOMING_TRACK_TIME) return { vx, vy };
    return steerTowards(vx, vy, x, y, tx, ty, CONFIG.HOMING_TURN_RATE * dt);
  }

  /** 全場特殊技能冷卻:距離上一次特殊技能夠久了才准發。 */
  function globalSkillReady(timeSinceLastSpecial) {
    return timeSinceLastSpecial >= CONFIG.GLOBAL_SKILL_CD;
  }

  /** 朝滑鼠位置射箭。count = 2(雙箭)時兩支箭左右各偏一點。回傳每支箭的速度。 */
  function arrowVolley(sx, sy, tx, ty, count) {
    const base = Math.atan2(ty - sy, tx - sx);
    const angles = count >= 2 ? [base - CONFIG.DOUBLE_ARROW_SPREAD, base + CONFIG.DOUBLE_ARROW_SPREAD] : [base];
    return angles.map((a) => ({ vx: Math.cos(a) * CONFIG.ARROW_SPEED, vy: Math.sin(a) * CONFIG.ARROW_SPEED }));
  }

  /** 把滑鼠在網頁上的座標換算成遊戲畫布座標(畫布會跟著視窗縮放)。 */
  function toCanvasPoint(clientX, clientY, rect, w, h) {
    return {
      x: ((clientX - rect.left) / rect.width) * w,
      y: ((clientY - rect.top) / rect.height) * h,
    };
  }

  /** 箭有沒有打到某顆太陽(箭現在是直線飛,會打中路上碰到的第一顆)。 */
  function arrowHitSun(ax, ay, suns) {
    for (const s of suns) {
      if (s.alive && Math.hypot(ax - s.x, ay - s.y) < CONFIG.SUN_HIT_RADIUS) return s;
    }
    return null;
  }

  /**
   * 手機版瞄準搖桿:手指離中心 (dx, dy),搖桿半徑 radius。
   * 推超過 deadzone(比例)才算在瞄準 → 會自動射箭;回傳方向角度和推的力道 0~1。
   */
  function stickVector(dx, dy, radius, deadzone) {
    deadzone = deadzone === undefined ? CONFIG.STICK_DEADZONE : deadzone;
    const mag = Math.min(1, Math.hypot(dx, dy) / radius);
    return { angle: Math.atan2(dy, dx), mag, active: mag > deadzone };
  }

  /**
   * 要不要用手機介面:主要輸入是觸控(pointer: coarse),或有觸控點但沒有滑鼠這類精準指標。
   * 觸控筆電(有觸控也有滑鼠)預設用電腦介面,手指一碰螢幕才切成手機介面(在 game.js 處理)。
   */
  function prefersTouchUI(env) {
    if (env.coarse) return true;
    return env.maxTouchPoints > 0 && !env.fine;
  }

  /** 圓形(彈幕)跟矩形(倉鼠)的碰撞。 */
  function circleRectHit(cx, cy, r, left, top, right, bottom) {
    const nx = Math.max(left, Math.min(cx, right));
    const ny = Math.max(top, Math.min(cy, bottom));
    return (cx - nx) ** 2 + (cy - ny) ** 2 < r * r;
  }

  const HouyiLogic = {
    CONFIG,
    skyDarkness,
    landOnSurface,
    surfaceBelow,
    cooldownProgress,
    attackInterval,
    applyHeal,
    clearProjectilesInRadius,
    checkOutcome,
    sunFloatOffset,
    cakeBounceVelocity,
    cakeState,
    layoutSuns,
    pickBuff,
    nearestSuns,
    steerTowards,
    homingSteer,
    globalSkillReady,
    arrowVolley,
    toCanvasPoint,
    arrowHitSun,
    stickVector,
    prefersTouchUI,
    circleRectHit,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = HouyiLogic;
  else root.HouyiLogic = HouyiLogic;
})(typeof window !== 'undefined' ? window : globalThis);
