/* ==========================================================
   game.js — 畫面、輸入、遊戲流程(第二版:2D 平台跳躍)
   數值和判定邏輯都在 logic.js(HouyiLogic),這裡負責「把它畫出來、讓它動起來」。
   流程:loading → start → playing → victory / lose → (再玩一次) playing
   ========================================================== */
(function () {
  'use strict';

  const L = window.HouyiLogic;
  const C = L.CONFIG;
  const W = C.W;
  const H = C.H;

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const overlay = document.getElementById('overlay');

  const EMOJI_FONT = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
  const UI_FONT = '"Microsoft JhengHei","PingFang TC","Noto Sans TC",sans-serif';

  // ---------------- 素材 ----------------
  const ASSETS = ['background', 'sun', 'hamster_idle', 'hamster_slash', 'bow', 'arrow', 'fireball', 'mooncake', 'bunny_sword'];
  const IMG = {};
  function loadImages() {
    return Promise.all(
      ASSETS.map(
        (name) =>
          new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
              IMG[name] = img;
              resolve();
            };
            img.onerror = () => reject(new Error('無法載入 assets/' + name + '.png'));
            img.src = 'assets/' + name + '.png';
          })
      )
    );
  }

  // ---------------- 狀態 ----------------
  let state = 'loading'; // loading | start | playing | victory | badend | lose
  let time = 0;
  let shake = 0;
  let player, suns, enemyShots, arrows, cakes, heatZones, lasers, particles, texts, slashFx;
  let cakeTimer, laserTimer, victory, badEnd;
  let lastSpecialAt = -99; // 全場上一次特殊技能的時間(全域冷卻用)
  let laserPending = false; // 雷射排隊中:其他特殊技能先讓路,不然雷射會一直搶不到全域冷卻
  const mouse = { x: W / 2, y: 200, down: false };
  const stick = { active: false, angle: -Math.PI / 2, pointerId: null }; // 手機版瞄準搖桿
  let mobileMode = false;
  const STARS = Array.from({ length: 80 }, () => ({
    x: Math.random() * W,
    y: Math.random() * 400,
    s: 0.6 + Math.random() * 1.8,
    tw: Math.random() * 6,
  }));

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const ease = (v) => v * v * (3 - 2 * v);

  function initGame() {
    player = {
      x: 410, y: C.GROUND_Y, vx: 0, vy: 0, onGround: true, dropTimer: 0, facing: 1,
      hp: C.PLAYER_HP, attackCd: 0, slashCd: 0, dashCd: 0, dashTimer: 0,
      invincible: 0, hurtTimer: 0, buff: null, buffTimer: 0,
      roarTimer: 0, bubbleTimer: 0, aim: -Math.PI / 2,
    };
    suns = L.layoutSuns().map((p) => {
      // 每顆太陽:基本招(直線/扇形)+ 隨機 1~2 個特殊招(追蹤火球/灼熱警戒)
      const r = Math.random();
      const specials = r < 0.45 ? ['homing'] : r < 0.9 ? ['heat'] : ['homing', 'heat'];
      return {
        x: p.x, baseY: p.y, y: p.y, phase: Math.random() * Math.PI * 2,
        hp: C.SUN_HP, alive: true, specials,
        fireTimer: rand(1.5, 4), fireInterval: rand(C.SUN_FIRE_INTERVAL[0], C.SUN_FIRE_INTERVAL[1]),
        specialTimer: rand(6, 14), lastStandDone: false,
        hitFlash: 0, laserGlow: 0, deathT: -1,
      };
    });
    enemyShots = [];
    arrows = [];
    cakes = [];
    heatZones = [];
    lasers = [];
    particles = [];
    texts = [];
    slashFx = null;
    cakeTimer = rand(4, 7);
    laserTimer = rand(C.LASER_INTERVAL[0], C.LASER_INTERVAL[1]);
    lastSpecialAt = -99;
    laserPending = false;
    victory = null;
    badEnd = null;
    time = 0;
    shake = 0;
  }

  const aliveSuns = () => suns.filter((s) => s.alive);

  // ---------------- 輸入 ----------------
  const keys = {};
  const GAME_KEYS = ['KeyA', 'KeyD', 'KeyW', 'KeyS', 'KeyQ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'ShiftLeft', 'ShiftRight'];
  window.addEventListener('keydown', (e) => {
    if (GAME_KEYS.includes(e.code)) e.preventDefault();
    keys[e.code] = true;
    if (state !== 'playing' || e.repeat) return;
    if (e.code === 'KeyW' || e.code === 'ArrowUp') tryJump();
    if (e.code === 'KeyS' || e.code === 'ArrowDown') tryDrop();
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') tryDash();
    if (e.code === 'KeyQ') trySlash();
  });
  window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
  });
  window.addEventListener('blur', () => {
    for (const k in keys) keys[k] = false;
    mouse.down = false;
  });
  // 滑鼠:按住左鍵朝游標方向連續射箭
  function trackMouse(e) {
    const pt = L.toCanvasPoint(e.clientX, e.clientY, canvas.getBoundingClientRect(), W, H);
    mouse.x = pt.x;
    mouse.y = pt.y;
  }
  canvas.addEventListener('pointermove', trackMouse);
  canvas.addEventListener('pointerdown', (e) => {
    trackMouse(e);
    if (state !== 'playing' || e.button > 0) return;
    e.preventDefault();
    mouse.down = true;
  });
  window.addEventListener('pointerup', () => {
    mouse.down = false;
  });
  canvas.addEventListener('pointercancel', () => {
    mouse.down = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---------------- 玩家動作 ----------------
  function roar() {
    player.roarTimer = C.ROAR_FACE_TIME;
  }

  function tryJump() {
    if (!player.onGround) return;
    player.vy = -C.JUMP_V;
    player.onGround = false;
    puff(player.x, player.y, '#ffffff', 6);
  }

  function tryDrop() {
    if (!player.onGround || player.y >= C.GROUND_Y - 1) return; // 在地面上按 S 沒反應
    player.dropTimer = C.DROP_THROUGH_TIME;
    player.onGround = false;
    player.vy = 60;
  }

  function tryDash() {
    if (player.dashCd > 0 || player.dashTimer > 0) return;
    player.dashTimer = C.DASH_TIME;
    player.dashCd = C.DASH_COOLDOWN;
    player.invincible = Math.max(player.invincible, C.DASH_INVINCIBLE);
    roar();
    for (let i = 0; i < 10; i++) {
      particles.push({ x: player.x, y: player.y - rand(8, 50), vx: -player.facing * rand(60, 160), vy: rand(-20, 20), life: 0.4, max: 0.4, color: '#e1f5fe', size: 4 });
    }
  }

  function trySlash() {
    if (player.slashCd > 0) return; // 冷卻中按 Q 沒反應
    player.slashCd = C.SLASH_COOLDOWN;
    roar();
    player.bubbleTimer = C.BUBBLE_TIME;
    const cx = player.x;
    const cy = player.y - 30;
    slashFx = { t: 0, dir: player.facing };
    // 只把「太陽彈幕」陣列丟進去清,玩家的箭(arrows)完全不受影響
    const { kept, removed } = L.clearProjectilesInRadius(enemyShots, cx, cy, C.SLASH_RADIUS);
    enemyShots = kept;
    for (const s of removed) puff(s.x, s.y, '#b3e5fc', 8);
  }

  function bowPosition() {
    return { x: player.x + Math.cos(player.aim) * 30, y: player.y - 32 + Math.sin(player.aim) * 30 };
  }

  // 瞄準點:手機用搖桿方向,電腦用滑鼠游標
  function aimTarget() {
    if (stick.active) {
      return { x: player.x + Math.cos(stick.angle) * 400, y: player.y - 32 + Math.sin(stick.angle) * 400 };
    }
    return { x: mouse.x, y: mouse.y };
  }

  function fireArrows() {
    const bow = bowPosition();
    const n = player.buff === 'double' ? 2 : 1;
    const t = aimTarget();
    for (const v of L.arrowVolley(bow.x, bow.y, t.x, t.y, n)) {
      arrows.push({ x: bow.x, y: bow.y, vx: v.vx, vy: v.vy });
    }
  }

  function hurt(dmg) {
    const p = player;
    if (p.invincible > 0 || p.buff === 'shield' || p.dashTimer > 0) return false;
    p.hp = Math.max(0, p.hp - dmg);
    p.invincible = C.HIT_INVINCIBLE;
    p.hurtTimer = C.HIT_INVINCIBLE;
    shake = 9;
    puff(p.x, p.y - 30, '#ff7043', 12);
    addText(p.x, p.y - 80, '-' + dmg, '#ff5252');
    return true;
  }

  function applyBuff(type) {
    roar();
    if (type === 'heal') {
      player.hp = L.applyHeal(player.hp, C.PLAYER_HP, C.HEAL_AMOUNT);
      addText(player.x, player.y - 80, '+' + C.HEAL_AMOUNT + ' HP', '#76ff03');
      return;
    }
    player.buff = type;
    player.buffTimer = C.BUFF_DURATION;
    const names = { rapid: '連射!', double: '雙箭!', shield: '無敵!' };
    addText(player.x, player.y - 80, names[type], '#ffd54f');
  }

  // ---------------- 特效小工具 ----------------
  function puff(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rand(50, 170);
      particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.35, 0.7), max: 0.7, color, size: rand(3, 5) });
    }
  }
  function addText(x, y, text, color) {
    texts.push({ x, y, text, color, life: 1.1 });
  }

  // ---------------- 太陽 ----------------
  function shoot(s, vx, vy, kind) {
    const homing = kind === 'homing';
    enemyShots.push({ x: s.x, y: s.y + 28, vx, vy, r: homing ? 14 : 10, dmg: homing ? 10 : 8, kind, life: homing ? 6 : 99, age: 0 });
  }

  function basicAttack(s) {
    if (Math.random() < C.FAN_CHANCE) {
      // 扇形彈幕
      const sp = rand(170, 220);
      for (const a of [-0.35, 0, 0.35]) shoot(s, Math.sin(a) * sp, Math.cos(a) * sp, 'fire');
    } else {
      // 直線彈幕
      shoot(s, rand(-20, 20), rand(170, 230), 'fire');
    }
  }

  function specialAttack(s) {
    const skill = s.specials[Math.floor(Math.random() * s.specials.length)];
    if (skill === 'homing') {
      shoot(s, 0, C.HOMING_SPEED, 'homing');
    } else {
      // 灼熱警戒:在倉鼠腳下的平台/地面畫警告圈,1 秒後爆炸
      const y = L.surfaceBelow(player.x, player.y, C.PLATFORMS, C.GROUND_Y);
      heatZones.push({ x: player.x, y, r: 65, t: 0, warn: 1.0, dmg: 15, owner: s, exploded: false });
    }
  }

  function lastStand(s) {
    s.lastStandDone = true;
    s.hitFlash = 1;
    addText(s.x, s.y + 60, '迴光返照!', '#ff5252');
    for (let i = 0; i < C.LAST_STAND_SHOTS; i++) {
      const a = (i / C.LAST_STAND_SHOTS) * Math.PI * 2;
      shoot(s, Math.cos(a) * 170, Math.sin(a) * 170, 'fire');
    }
  }

  function startLaser() {
    const alive = aliveSuns();
    if (alive.length < 3) return false;
    const k = Math.min(alive.length, Math.random() < 0.5 ? 2 : 3);
    const chosen = alive.sort(() => Math.random() - 0.5).slice(0, k);
    const y = Math.max(200, Math.min(C.GROUND_Y - 22, player.y - 30));
    lasers.push({ y, t: 0, warn: 1.1, active: 0.5, suns: chosen, hit: false });
    addText(W / 2, y - 24, '合體雷射!', '#ff1744');
    return true;
  }

  function damageSun(s, dmg) {
    s.hp -= dmg;
    s.hitFlash = 1;
    if (s.hp <= 0) {
      s.hp = 0;
      s.alive = false;
      s.deathT = 0;
      puff(s.x, s.y, '#ffb300', 34);
      addText(s.x, s.y, '擊落!', '#ffca28');
      return;
    }
    if (!s.lastStandDone && s.hp <= C.SUN_HP * C.LAST_STAND_RATIO) lastStand(s);
  }

  // ---------------- 更新 ----------------
  function updatePlayer(dt, controllable) {
    const p = player;
    let dir = 0;
    if (controllable) {
      if (keys.KeyA || keys.ArrowLeft) dir -= 1;
      if (keys.KeyD || keys.ArrowRight) dir += 1;
    }
    if (dir) p.facing = dir;
    if (p.dashTimer > 0) {
      p.dashTimer -= dt;
      p.vx = (p.facing * C.DASH_DISTANCE) / C.DASH_TIME;
    } else {
      p.vx = dir * C.MOVE_SPEED;
    }
    p.x = Math.max(20, Math.min(W - 20, p.x + p.vx * dt));

    // 重力 + 單向平台
    if (p.dropTimer > 0) p.dropTimer -= dt;
    p.vy = Math.min(C.MAX_FALL, p.vy + C.GRAVITY * dt);
    const next = p.y + p.vy * dt;
    const land = L.landOnSurface(p.y, next, p.x, 13, C.PLATFORMS, C.GROUND_Y, p.dropTimer > 0);
    if (land !== null) {
      p.y = land;
      p.vy = 0;
      p.onGround = true;
    } else {
      p.y = next;
      p.onGround = false;
    }

    for (const k of ['attackCd', 'slashCd', 'dashCd', 'invincible', 'hurtTimer', 'roarTimer', 'bubbleTimer']) {
      if (p[k] > 0) p[k] -= dt;
    }
    if (p.buffTimer > 0) {
      p.buffTimer -= dt;
      if (p.buffTimer <= 0) p.buff = null;
    }

    const aim = aimTarget();
    p.aim = Math.atan2(aim.y - (p.y - 32), aim.x - p.x);
    if (controllable && !dir && p.dashTimer <= 0) p.facing = aim.x >= p.x ? 1 : -1; // 沒在走路時面向瞄準方向

    // 電腦:按住滑鼠左鍵射;手機:推著瞄準搖桿就自動射
    if (controllable && (mouse.down || stick.active) && p.attackCd <= 0) {
      fireArrows();
      p.attackCd = L.attackInterval(C.ATTACK_INTERVAL, p.buff);
    }
  }

  function updateSuns(dt) {
    for (const s of suns) {
      if (!s.alive) continue;
      s.y = s.baseY + L.sunFloatOffset(time, s.phase);
      s.hitFlash = Math.max(0, s.hitFlash - dt * 4);
      s.laserGlow = Math.max(0, s.laserGlow - dt * 3);
      s.fireTimer -= dt;
      if (s.fireTimer <= 0) {
        basicAttack(s);
        s.fireTimer = s.fireInterval;
      }
      s.specialTimer -= dt;
      if (s.specialTimer <= 0) {
        // 全域冷卻:全場上一個特殊技能還沒過 GLOBAL_SKILL_CD 秒,就晚一點再試
        if (!laserPending && L.globalSkillReady(time - lastSpecialAt)) {
          specialAttack(s);
          lastSpecialAt = time;
          s.specialTimer = rand(C.SPECIAL_INTERVAL[0], C.SPECIAL_INTERVAL[1]);
        } else {
          s.specialTimer = rand(0.8, 2);
        }
      }
    }
    laserTimer -= dt;
    if (laserTimer <= 0) laserPending = true;
    if (laserPending && L.globalSkillReady(time - lastSpecialAt)) {
      if (startLaser()) lastSpecialAt = time; // 存活太陽不到 3 顆就不發,直接重新計時
      laserPending = false;
      laserTimer = rand(C.LASER_INTERVAL[0], C.LASER_INTERVAL[1]);
    }
  }

  function playerRect() {
    return [player.x - 18, player.y - 54, player.x + 18, player.y - 4];
  }

  function updateShots(dt) {
    const [l, t, r, b] = playerRect();
    for (let i = enemyShots.length - 1; i >= 0; i--) {
      const s = enemyShots[i];
      s.age += dt;
      if (s.kind === 'homing') {
        // 只追前 1.8 秒、轉彎很慢,之後就直線飛,看準了可以躲開
        const v = L.homingSteer(s.vx, s.vy, s.x, s.y, player.x, player.y - 30, dt, s.age);
        s.vx = v.vx;
        s.vy = v.vy;
        s.life -= dt;
      }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (L.circleRectHit(s.x, s.y, s.r * 0.8, l, t, r, b)) {
        enemyShots.splice(i, 1);
        hurt(s.dmg);
        continue;
      }
      if (s.y > C.GROUND_Y + 8) {
        puff(s.x, C.GROUND_Y, '#ffab40', 4);
        enemyShots.splice(i, 1);
      } else if (s.x < -40 || s.x > W + 40 || s.y < -80 || s.life <= 0) {
        enemyShots.splice(i, 1);
      }
    }

    for (let i = arrows.length - 1; i >= 0; i--) {
      const a = arrows[i];
      a.x += a.vx * dt;
      a.y += a.vy * dt;
      const hit = L.arrowHitSun(a.x, a.y, suns);
      if (hit) {
        puff(a.x, a.y, '#fff59d', 5);
        damageSun(hit, C.ARROW_DAMAGE);
        arrows.splice(i, 1);
        continue;
      }
      if (a.x < -40 || a.x > W + 40 || a.y < -40 || a.y > H + 40) arrows.splice(i, 1);
    }
  }

  function updateHazards(dt) {
    for (let i = heatZones.length - 1; i >= 0; i--) {
      const z = heatZones[i];
      z.t += dt;
      if (!z.exploded && z.t >= z.warn) {
        z.exploded = true;
        puff(z.x, z.y - 10, '#ff6d00', 20);
        if (Math.hypot(player.x - z.x, player.y - 30 - z.y) < z.r + 20) hurt(z.dmg);
      }
      if (z.t >= z.warn + 0.35) heatZones.splice(i, 1);
    }
    for (let i = lasers.length - 1; i >= 0; i--) {
      const lz = lasers[i];
      lz.t += dt;
      for (const s of lz.suns) if (s.alive) s.laserGlow = 1;
      const active = lz.t >= lz.warn && lz.t < lz.warn + lz.active;
      if (active && !lz.hit) {
        const [, top, , bottom] = playerRect();
        if (bottom > lz.y - 14 && top < lz.y + 14 && hurt(18)) lz.hit = true;
      }
      if (lz.t >= lz.warn + lz.active) lasers.splice(i, 1);
    }
  }

  function updateCakes(dt) {
    cakeTimer -= dt;
    if (cakeTimer <= 0) {
      cakes.push({ x: rand(60, W - 60), y: -20, vy: 0, bounced: false, landed: false, age: 0 });
      cakeTimer = rand(7, 11);
    }
    const [l, t, r, b] = playerRect();
    for (let i = cakes.length - 1; i >= 0; i--) {
      const c = cakes[i];
      if (!c.landed) {
        c.vy = Math.min(C.MAX_FALL, c.vy + C.GRAVITY * dt);
        const next = c.y + c.vy * dt;
        const land = L.landOnSurface(c.y, next, c.x, 6, C.PLATFORMS, C.GROUND_Y, false);
        if (land !== null) {
          c.y = land;
          if (!c.bounced) {
            c.vy = L.cakeBounceVelocity(c.vy, false);
            c.bounced = true;
          } else {
            c.vy = 0;
            c.landed = true;
          }
        } else {
          c.y = next;
        }
      } else {
        c.age += dt;
        if (L.cakeState(c.age) === 'gone') {
          cakes.splice(i, 1);
          continue;
        }
      }
      const h = C.CAKE_HALF;
      if (c.x + h > l && c.x - h < r && c.y > t && c.y - h * 2 < b) {
        cakes.splice(i, 1);
        applyBuff(L.pickBuff());
      }
    }
  }

  function updateFx(dt) {
    // 被擊落太陽的消失動畫放這裡:勝利過場時 updateSuns 不會跑,放那邊會卡住畫面
    for (const s of suns) if (!s.alive && s.deathT >= 0) s.deathT += dt;
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
    for (let i = texts.length - 1; i >= 0; i--) {
      const t = texts[i];
      t.y -= 40 * dt;
      t.life -= dt;
      if (t.life <= 0) texts.splice(i, 1);
    }
    if (slashFx) {
      slashFx.t += dt;
      if (slashFx.t > C.SLASH_ANIM + 0.15) slashFx = null;
    }
    shake = Math.max(0, shake - dt * 40);
  }

  function startVictory() {
    state = 'victory';
    const last = aliveSuns()[0];
    victory = { t: 0, sun: last, startDark: L.skyDarkness(1), overlayShown: false };
    for (const s of enemyShots) puff(s.x, s.y, '#ffe082', 3);
    enemyShots = [];
    arrows = [];
    heatZones = [];
    lasers = [];
    for (const c of cakes) puff(c.x, c.y - 16, '#ffcc80', 5);
    cakes = [];
  }

  // 隱藏結局:最後兩顆太陽同一瞬間被射下來,九顆全滅
  function startBadEnd() {
    state = 'badend';
    badEnd = { t: 0, overlayShown: false };
    enemyShots = [];
    arrows = [];
    heatZones = [];
    lasers = [];
    cakes = [];
    shake = 16;
    player.roarTimer = 99; // 倉鼠嚇到,一直維持咆哮臉
  }

  function updateBadEnd(dt) {
    badEnd.t += dt;
    player.roarTimer = 99;
    if (!badEnd.overlayShown && badEnd.t > 6) {
      badEnd.overlayShown = true;
      showOverlay('badend');
    }
  }

  function updateVictory(dt) {
    const v = victory;
    v.t += dt;
    if (v.sun) v.sun.y = v.sun.baseY + ease(clamp01(v.t / 2.6)) * 110; // 最後一顆太陽慢慢下山
    if (!v.overlayShown && v.t > 7) {
      v.overlayShown = true;
      showOverlay('win');
    }
  }

  function update(dt) {
    time += dt;
    if (state === 'playing') {
      updatePlayer(dt, true);
      updateSuns(dt);
      updateShots(dt);
      updateHazards(dt);
      updateCakes(dt);
      const outcome = L.checkOutcome(aliveSuns().length, player.hp);
      if (outcome === 'win') startVictory();
      else if (outcome === 'allgone') startBadEnd();
      else if (outcome === 'lose') {
        state = 'lose';
        shake = 14;
        setTimeout(() => showOverlay('lose'), 700);
      }
    } else if (state === 'victory') {
      updatePlayer(dt, false);
      updateVictory(dt);
    } else if (state === 'badend') {
      updatePlayer(dt, false);
      updateBadEnd(dt);
    }
    updateKeybar();
    if (state !== 'loading' && state !== 'start') updateFx(dt);
  }

  // ---------------- 繪製 ----------------
  function drawImageCentered(img, x, y, w, h, angle) {
    ctx.save();
    ctx.translate(x, y);
    if (angle) ctx.rotate(angle);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function currentDarkness() {
    if (state === 'badend') {
      // 沒有太陽也沒有月亮:兩秒內整個天地變成一片漆黑
      return L.skyDarkness(0) + (0.96 - L.skyDarkness(0)) * ease(clamp01(badEnd.t / 2));
    }
    if (state === 'victory') {
      // 勝利過場:獨立的夜晚轉場,不受「有太陽就不能全黑」限制
      const k = ease(clamp01(victory.t / 3));
      return victory.startDark + (0.8 - victory.startDark) * k;
    }
    return L.skyDarkness(aliveSuns().length);
  }

  function drawSky() {
    ctx.drawImage(IMG.background, 0, 0, W, H);
    const d = currentDarkness();
    if (d > 0) {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, `rgba(18, 20, 60, ${d})`);
      g.addColorStop(0.6, `rgba(60, 35, 70, ${d * 0.9})`);
      g.addColorStop(1, `rgba(80, 40, 30, ${d * 0.75})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    if (state === 'victory') drawNight();
    if (state === 'badend') {
      // 再疊一層接近全黑的顏色,只隱約看得到平台輪廓
      ctx.fillStyle = `rgba(2, 3, 8, ${0.8 * ease(clamp01(badEnd.t / 2))})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function drawNight() {
    const v = victory;
    const starA = clamp01((v.t - 1.5) / 1.5);
    for (const s of STARS) {
      ctx.globalAlpha = starA * (0.55 + 0.45 * Math.sin(time * 2 + s.tw));
      ctx.fillStyle = '#fff';
      ctx.fillRect(s.x, s.y, s.s, s.s);
    }
    // 月亮從淡到亮、慢慢升起
    const k = ease(clamp01((v.t - 2) / 3));
    if (k > 0) {
      const mx = W / 2;
      const my = 200 - 90 * k;
      ctx.globalAlpha = k;
      const glow = ctx.createRadialGradient(mx, my, 20, mx, my, 110);
      glow.addColorStop(0, 'rgba(255, 244, 200, 0.55)');
      glow.addColorStop(1, 'rgba(255, 244, 200, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(mx, my, 110, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff6d5';
      ctx.beginPath();
      ctx.arc(mx, my, 46, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(214, 200, 150, 0.55)';
      for (const [dx, dy, r] of [[-14, -10, 9], [12, 8, 7], [4, -18, 5], [-6, 16, 6]]) {
        ctx.beginPath();
        ctx.arc(mx + dx, my + dy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawSuns() {
    const size = 92;
    for (const s of suns) {
      let alpha = 1;
      let scale = 1;
      if (!s.alive) {
        if (s.deathT < 0 || s.deathT > 0.5) continue;
        alpha = 1 - s.deathT / 0.5;
        scale = 1 + s.deathT;
      }
      if (state === 'victory' && s === victory.sun) alpha = 1 - clamp01((victory.t - 0.6) / 2);
      if (alpha <= 0) continue;
      ctx.save();
      ctx.globalAlpha = alpha;
      if (s.laserGlow > 0) {
        const g = ctx.createRadialGradient(s.x, s.y, 20, s.x, s.y, 70);
        g.addColorStop(0, `rgba(255, 30, 30, ${0.6 * s.laserGlow})`);
        g.addColorStop(1, 'rgba(255, 30, 30, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 70, 0, Math.PI * 2);
        ctx.fill();
      }
      drawImageCentered(IMG.sun, s.x, s.y, size * scale, size * scale);
      if (s.hitFlash > 0) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = alpha * s.hitFlash * 0.5;
        drawImageCentered(IMG.sun, s.x, s.y, size * scale, size * scale);
      }
      ctx.restore();
      if (s.alive && state === 'playing') {
        const bw = 54;
        ctx.fillStyle = 'rgba(40,40,40,0.8)';
        ctx.fillRect(s.x - bw / 2, s.y - 54, bw, 6);
        ctx.fillStyle = s.hp / C.SUN_HP > 0.4 ? '#66bb6a' : '#ef5350';
        ctx.fillRect(s.x - bw / 2, s.y - 54, (bw * s.hp) / C.SUN_HP, 6);
      }
    }
  }

  function drawHeatZones() {
    for (const z of heatZones) {
      if (!z.exploded) {
        const pulse = 0.5 + 0.5 * Math.sin(z.t * 18);
        if (z.owner && z.owner.alive) {
          ctx.strokeStyle = 'rgba(255, 90, 30, 0.25)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(z.owner.x, z.owner.y + 30);
          ctx.lineTo(z.x, z.y);
          ctx.stroke();
        }
        ctx.fillStyle = `rgba(255, 80, 20, ${0.15 + 0.2 * pulse})`;
        ctx.strokeStyle = 'rgba(255, 40, 0, 0.9)';
        ctx.lineWidth = 3;
        ctx.setLineDash([8, 6]);
        ctx.beginPath();
        ctx.ellipse(z.x, z.y, z.r * (z.t / z.warn), z.r * 0.3 * (z.t / z.warn), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(z.x, z.y, z.r, z.r * 0.3, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        const k = (z.t - z.warn) / 0.35;
        const g = ctx.createRadialGradient(z.x, z.y - 10, 5, z.x, z.y - 10, z.r * (1 + k * 0.4));
        g.addColorStop(0, `rgba(255, 240, 150, ${0.9 * (1 - k)})`);
        g.addColorStop(0.5, `rgba(255, 110, 20, ${0.7 * (1 - k)})`);
        g.addColorStop(1, 'rgba(255, 60, 0, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(z.x, z.y - 10, z.r * (1 + k * 0.4), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawLasers() {
    for (const lz of lasers) {
      if (lz.t < lz.warn) {
        const a = 0.35 + 0.35 * Math.sin(lz.t * 20);
        ctx.strokeStyle = `rgba(255, 30, 30, ${a})`;
        ctx.lineWidth = 2;
        ctx.setLineDash([12, 8]);
        ctx.beginPath();
        ctx.moveTo(0, lz.y);
        ctx.lineTo(W, lz.y);
        ctx.stroke();
        for (const s of lz.suns) {
          if (!s.alive) continue;
          ctx.beginPath();
          ctx.moveTo(s.x, s.y + 30);
          ctx.lineTo(s.x, lz.y);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      } else {
        const k = (lz.t - lz.warn) / lz.active;
        const fade = 1 - k * k;
        for (const s of lz.suns) {
          if (!s.alive) continue;
          ctx.fillStyle = `rgba(255, 60, 60, ${0.7 * fade})`;
          ctx.fillRect(s.x - 5, s.y + 30, 10, lz.y - s.y - 30);
        }
        const g = ctx.createLinearGradient(0, lz.y - 14, 0, lz.y + 14);
        g.addColorStop(0, 'rgba(255, 40, 40, 0)');
        g.addColorStop(0.5, `rgba(255, 255, 255, ${fade})`);
        g.addColorStop(1, 'rgba(255, 40, 40, 0)');
        ctx.fillStyle = `rgba(255, 50, 50, ${0.55 * fade})`;
        ctx.fillRect(0, lz.y - 14, W, 28);
        ctx.fillStyle = g;
        ctx.fillRect(0, lz.y - 14, W, 28);
      }
    }
  }

  function drawCakes() {
    const size = C.CAKE_HALF * 2 + 2;
    for (const c of cakes) {
      if (c.landed && L.cakeState(c.age) === 'blink' && Math.floor(c.age * 8) % 2 === 1) continue;
      drawImageCentered(IMG.mooncake, c.x, c.y - size / 2, size, size);
    }
  }

  function drawShots() {
    for (const s of enemyShots) {
      // 火球圖的頭在右邊、尾巴在左邊;轉到飛行方向,讓「頭」剛好在碰撞點上
      const h = s.r * 3.4;
      const w = (h * IMG.fireball.width) / IMG.fireball.height;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(Math.atan2(s.vy, s.vx));
      ctx.drawImage(IMG.fireball, -w * 0.86, -h / 2, w, h);
      ctx.restore();
      if (s.kind === 'homing') {
        ctx.strokeStyle = 'rgba(200, 0, 60, 0.8)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r + 4 + Math.sin(time * 12) * 2, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    for (const a of arrows) drawImageCentered(IMG.arrow, a.x, a.y, 40, 9, Math.atan2(a.vy, a.vx));
  }

  function drawPlayer() {
    const p = player;
    const roaring = p.roarTimer > 0;
    const img = roaring ? IMG.hamster_slash : IMG.hamster_idle;
    // 咆哮臉畫在跟平常一模一樣大的框裡,出招時角色不會突然變大
    const h = 60;
    const w = (h * IMG.hamster_idle.width) / IMG.hamster_idle.height;
    ctx.save();
    if (p.hurtTimer > 0 && Math.floor(p.hurtTimer * 20) % 2 === 0) ctx.globalAlpha = 0.45;
    if (p.buff === 'shield') {
      ctx.strokeStyle = 'rgba(79, 195, 247, 0.9)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.x, p.y - 30, 44, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.translate(p.x, p.y);
    ctx.scale(p.facing, 1);
    ctx.drawImage(img, -w / 2, -h, w, h);
    ctx.restore();
    // 弓:放在倉鼠身旁,永遠指向最近的太陽
    if (state === 'playing' || state === 'victory') {
      const bx = p.x + Math.cos(p.aim) * 30;
      const by = p.y - 32 + Math.sin(p.aim) * 30;
      drawImageCentered(IMG.bow, bx, by, 15, 50, p.aim);
    }
  }

  function drawSlash() {
    if (!slashFx) return;
    const p = player;
    const cx = p.x;
    const cy = p.y - 30;
    const k = ease(clamp01(slashFx.t / C.SLASH_ANIM));
    // 面向右:從頭頂(-100°)劃到右下(+20°);面向左就左右鏡像
    const start = (-100 * Math.PI) / 180;
    const end = (20 * Math.PI) / 180;
    const mirror = (a) => (slashFx.dir === 1 ? a : Math.PI - a);
    const cur = start + (end - start) * k;
    const fadeOut = 1 - clamp01((slashFx.t - C.SLASH_ANIM) / 0.15);

    // 白色刀光
    ctx.save();
    ctx.globalAlpha = 0.85 * fadeOut;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.beginPath();
    const a0 = mirror(start);
    const a1 = mirror(cur);
    ctx.arc(cx, cy, 128, Math.min(a0, a1), Math.max(a0, a1));
    ctx.stroke();
    ctx.globalAlpha = 0.5 * fadeOut;
    ctx.strokeStyle = '#b3e5fc';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, C.SLASH_RADIUS, Math.min(a0, a1), Math.max(a0, a1));
    ctx.stroke();
    ctx.restore();

    // 兔子劍 + 殘影(越舊越淡)
    const bladeH = 130;
    const bladeW = (bladeH * IMG.bunny_sword.width) / IMG.bunny_sword.height;
    for (let i = 4; i >= 0; i--) {
      const a = cur - (end - start) * 0.1 * i;
      if (a < start) continue;
      const ang = mirror(a);
      ctx.save();
      ctx.globalAlpha = (i === 0 ? 1 : 0.5 - i * 0.09) * fadeOut;
      drawImageCentered(IMG.bunny_sword, cx + Math.cos(ang) * 78, cy + Math.sin(ang) * 78, bladeW, bladeH, ang + Math.PI / 2);
      ctx.restore();
    }
  }

  function drawBubble() {
    const p = player;
    if (p.bubbleTimer <= 0) return;
    const t = C.BUBBLE_TIME - p.bubbleTimer;
    const alpha = Math.min(1, t / 0.08, p.bubbleTimer / 0.15);
    const bw = 96;
    const bh = 48;
    const bx = p.x - bw / 2 - p.facing * 34;
    const by = p.y - 138;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#141414';
    ctx.lineWidth = 3;
    roundRect(bx, by, bw, bh, 14);
    ctx.fill();
    ctx.stroke();
    const tipX = p.x - p.facing * 6;
    ctx.beginPath();
    ctx.moveTo(bx + bw / 2 + p.facing * 4, by + bh - 2);
    ctx.lineTo(tipX, by + bh + 18);
    ctx.lineTo(bx + bw / 2 + p.facing * 22, by + bh - 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(bx + bw / 2 + p.facing * 4, by + bh);
    ctx.lineTo(tipX, by + bh + 18);
    ctx.lineTo(bx + bw / 2 + p.facing * 22, by + bh);
    ctx.stroke();
    ctx.fillStyle = '#000';
    ctx.font = '28px ' + EMOJI_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(C.BUBBLE_TEXT, bx + bw / 2, by + bh / 2 + 1);
    ctx.restore();
  }

  function drawFx() {
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 18px ' + UI_FONT;
    for (const t of texts) {
      ctx.globalAlpha = Math.max(0, Math.min(1, t.life));
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  }

  function bar(x, y, w, h, frac, color) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * frac, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }

  function drawHud() {
    if (mobileMode) {
      drawHudMobile();
      return;
    }
    const p = player;
    // 左下角土地上:血條 + 兔劍冷卻條 + 衝刺冷卻條(不會擋到上面的太陽)
    ctx.fillStyle = 'rgba(30, 18, 10, 0.55)';
    roundRect(8, 558, 360, 40, 8);
    ctx.fill();
    ctx.font = '11px ' + UI_FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    bar(16, 562, 180, 10, p.hp / C.PLAYER_HP, p.hp / C.PLAYER_HP > 0.3 ? '#66bb6a' : '#ef5350');
    ctx.fillStyle = '#fff';
    ctx.fillText('HP ' + Math.ceil(p.hp) + '/' + C.PLAYER_HP, 204, 567);

    const slashReady = p.slashCd <= 0;
    bar(16, 576, 180, 8, L.cooldownProgress(p.slashCd, C.SLASH_COOLDOWN), slashReady ? '#4fc3f7' : '#90a4ae');
    ctx.fillStyle = slashReady ? '#b3e5fc' : '#fff';
    ctx.fillText(slashReady ? '兔劍 READY(Q)' : '兔劍 冷卻 ' + p.slashCd.toFixed(1) + 's', 204, 580);

    const dashReady = p.dashCd <= 0;
    bar(16, 588, 180, 6, L.cooldownProgress(p.dashCd, C.DASH_COOLDOWN), dashReady ? '#ce93d8' : '#90a4ae');
    ctx.fillStyle = dashReady ? '#f3e5f5' : '#fff';
    ctx.fillText(dashReady ? '衝刺 READY(Shift)' : '衝刺 冷卻 ' + p.dashCd.toFixed(1) + 's', 204, 592);

    // 右下角:剩幾顆太陽 + 目前 buff
    ctx.fillStyle = 'rgba(30, 18, 10, 0.55)';
    roundRect(W - 178, 558, 170, 40, 8);
    ctx.fill();
    ctx.textAlign = 'right';
    ctx.font = 'bold 13px ' + UI_FONT;
    ctx.fillStyle = '#ffe082';
    ctx.fillText('太陽 ' + aliveSuns().length + ' / ' + C.SUN_COUNT + '(打到剩 1)', W - 16, 569);
    if (p.buff) {
      const names = { rapid: '連射中', double: '雙箭中', shield: '無敵中' };
      ctx.fillStyle = '#ffd54f';
      ctx.fillText(names[p.buff] + ' ' + p.buffTimer.toFixed(1) + 's', W - 16, 587);
    }
  }

  // 手機版 HUD:左右兩個下角被觸控按鈕佔走了,整組資訊縮成一塊放在正下方中間
  function drawHudMobile() {
    const p = player;
    const x0 = 262;
    const w0 = 376;
    ctx.fillStyle = 'rgba(30, 18, 10, 0.6)';
    roundRect(x0, 556, w0, 42, 8);
    ctx.fill();
    ctx.font = '11px ' + UI_FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    bar(x0 + 8, 561, 120, 10, p.hp / C.PLAYER_HP, p.hp / C.PLAYER_HP > 0.3 ? '#66bb6a' : '#ef5350');
    ctx.fillStyle = '#fff';
    ctx.fillText('HP ' + Math.ceil(p.hp), x0 + 134, 566);
    bar(x0 + 8, 576, 120, 7, L.cooldownProgress(p.slashCd, C.SLASH_COOLDOWN), p.slashCd <= 0 ? '#4fc3f7' : '#90a4ae');
    ctx.fillText(p.slashCd <= 0 ? '兔劍 OK' : '兔劍 ' + p.slashCd.toFixed(1) + 's', x0 + 134, 580);
    bar(x0 + 8, 588, 120, 6, L.cooldownProgress(p.dashCd, C.DASH_COOLDOWN), p.dashCd <= 0 ? '#ce93d8' : '#90a4ae');
    ctx.fillText(p.dashCd <= 0 ? '衝刺 OK' : '衝刺 ' + p.dashCd.toFixed(1) + 's', x0 + 134, 592);
    ctx.textAlign = 'right';
    ctx.font = 'bold 13px ' + UI_FONT;
    ctx.fillStyle = '#ffe082';
    ctx.fillText('太陽 ' + aliveSuns().length + '/' + C.SUN_COUNT, x0 + w0 - 10, 569);
    if (p.buff) {
      const names = { rapid: '連射', double: '雙箭', shield: '無敵' };
      ctx.fillStyle = '#ffd54f';
      ctx.fillText(names[p.buff] + ' ' + p.buffTimer.toFixed(1) + 's', x0 + w0 - 10, 587);
    }
  }

  function drawBadEndText() {
    const k = clamp01((badEnd.t - 2.2) / 1.2);
    if (k <= 0 || badEnd.overlayShown) return; // 跳出結算框後就不畫,避免文字疊在一起
    ctx.globalAlpha = k;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    const lines = [
      ['bold 30px ', '后羿射下了九顆太陽……', 250, '#ffffff'],
      ['17px ', '天地一片漆黑。沒有太陽,也就沒有月亮,更沒有中秋了。', 292, '#cfd8dc'],
      ['bold 15px ', '— 隱藏結局 —', 332, '#ffab40'],
    ];
    for (const [font, text, y, color] of lines) {
      ctx.font = font + UI_FONT;
      ctx.fillStyle = color;
      ctx.strokeText(text, W / 2, y);
      ctx.fillText(text, W / 2, y);
    }
    ctx.globalAlpha = 1;
  }

  function drawVictoryText() {
    const k = clamp01((victory.t - 4.2) / 1.2);
    if (k <= 0 || victory.overlayShown) return; // 跳出結算框後就不畫,避免文字疊在一起
    ctx.globalAlpha = k;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.fillStyle = '#fff';
    const lines = [
      ['bold 30px ', '后羿射下了八顆太陽', 262],
      ['17px ', '只留下最後一顆,讓白天剛剛好,夜晚也看得見月亮', 302],
      ['17px ', '后羿和嫦娥的故事,就從這裡開始——中秋快樂!', 330],
    ];
    for (const [font, text, y] of lines) {
      ctx.font = font + UI_FONT;
      ctx.strokeText(text, W / 2, y);
      ctx.fillText(text, W / 2, y);
    }
    ctx.globalAlpha = 1;
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    if (state === 'loading') {
      ctx.fillStyle = '#0b1023';
      ctx.fillRect(0, 0, W, H);
      return;
    }
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    drawSky();
    if (state === 'start') {
      ctx.restore();
      return;
    }
    drawHeatZones();
    drawCakes();
    drawSuns();
    drawLasers();
    drawShots();
    drawPlayer();
    drawSlash();
    drawBubble();
    drawFx();
    if (state === 'victory') drawVictoryText();
    else if (state === 'badend') drawBadEndText();
    else drawHud();
    ctx.restore();
  }

  // ---------------- 覆蓋畫面(開始 / 勝利 / 失敗) ----------------
  const TOUCH_CONTROLS_HTML = `
    <div class="keyguide">
      <div class="kg-row"><span class="keys"><kbd>◀</kbd><kbd>▶</kbd></span><span>左下:左右移動</span></div>
      <div class="kg-row"><span class="keys"><kbd>▲</kbd><kbd>▼</kbd></span><span>左下:跳 / 從平台往下跳</span></div>
      <div class="kg-row"><span class="keys"><kbd class="wide">搖桿</kbd></span><span>右下:推哪個方向就朝哪裡自動射箭</span></div>
      <div class="kg-row"><span class="keys"><kbd>🐰</kbd><kbd>衝</kbd></span><span>兔劍(清火球)/ 月光衝刺</span></div>
    </div>
    <p class="small">建議手機橫放,按右上角 ⛶ 進入全螢幕。撿月餅拿 buff。</p>`;
  const controlsHtml = () => (mobileMode ? TOUCH_CONTROLS_HTML : CONTROLS_HTML);

  const CONTROLS_HTML = `
    <div class="keyguide">
      <div class="kg-row"><span class="keys"><kbd>A</kbd><kbd>D</kbd></span><span>左右移動</span></div>
      <div class="kg-row"><span class="keys"><kbd>W</kbd></span><span>跳躍</span></div>
      <div class="kg-row"><span class="keys"><kbd>S</kbd></span><span>從平台往下跳</span></div>
      <div class="kg-row"><span class="keys"><kbd class="wide">🖱 左鍵</kbd></span><span>朝游標射箭(可按住連射)</span></div>
      <div class="kg-row"><span class="keys"><kbd>Q</kbd></span><span>兔劍:清掉身邊的火球(冷卻 5 秒)</span></div>
      <div class="kg-row"><span class="keys"><kbd class="wide">Shift</kbd></span><span>月光衝刺:瞬間無敵(冷卻 4 秒)</span></div>
    </div>
    <p class="small">撿月餅拿 buff:連射 / 雙箭 / 無敵 / 回血。遊戲中下方的按鍵列會亮起你正在按的鍵。</p>`;

  let overlayKind = null;
  function showOverlay(kind) {
    overlayKind = kind;
    overlay.classList.remove('hidden');
    if (kind === 'start') {
      overlay.innerHTML = `<h2>后羿射日</h2><p>九個太陽,打到只剩最後一個。</p>${controlsHtml()}<button id="actionBtn">開始遊戲</button>`;
    } else if (kind === 'win') {
      overlay.innerHTML = `<h2>通關!</h2><p>后羿射下了八顆太陽,只留下一顆。</p><p>太陽下山、月亮升起,嫦娥奔月的故事要開始了。</p><button id="actionBtn">再玩一次</button>`;
    } else if (kind === 'badend') {
      overlay.innerHTML = `<h2>隱藏結局:沒有太陽的世界</h2><p>最後兩顆太陽被同時射了下來。</p><p>神話裡,后羿本來應該留下一顆的……</p><button id="actionBtn">再玩一次(這次留一顆)</button>`;
    } else {
      overlay.innerHTML = `<h2>倉鼠被曬乾了……</h2><p>還剩 ${aliveSuns().length} 顆太陽。再試一次?</p>${controlsHtml()}<button id="actionBtn">再試一次</button>`;
    }
    const btn = document.getElementById('actionBtn');
    btn.addEventListener('click', () => {
      overlay.classList.add('hidden');
      overlayKind = null;
      initGame();
      state = 'playing';
      btn.blur();
    });
    btn.focus();
  }

  // ---------------- 畫面下方的按鍵列 ----------------
  // 按下的鍵會亮起來;兔劍、衝刺冷卻中會變灰並顯示剩餘秒數
  const keybarEls = {};
  document.querySelectorAll('#keybar [data-act]').forEach((el) => {
    keybarEls[el.dataset.act] = el;
  });
  function setKeyState(act, pressed, cooldown) {
    const el = keybarEls[act];
    if (!el) return;
    el.classList.toggle('pressed', !!pressed);
    el.classList.toggle('cooling', cooldown > 0);
    const cd = el.querySelector('.cd');
    if (cd) cd.textContent = cooldown > 0 ? cooldown.toFixed(1) + 's' : '';
  }
  function updateKeybar() {
    const playing = state === 'playing';
    const p = player || {};
    setKeyState('move', playing && (keys.KeyA || keys.KeyD || keys.ArrowLeft || keys.ArrowRight), 0);
    setKeyState('jump', playing && (keys.KeyW || keys.ArrowUp), 0);
    setKeyState('drop', playing && (keys.KeyS || keys.ArrowDown), 0);
    setKeyState('shoot', playing && mouse.down, 0);
    setKeyState('slash', playing && keys.KeyQ, playing ? p.slashCd : 0);
    setKeyState('dash', playing && (keys.ShiftLeft || keys.ShiftRight), playing ? p.dashCd : 0);
    for (const [name, cd] of [['slash', playing ? p.slashCd : 0], ['dash', playing ? p.dashCd : 0]]) {
      const btn = touchBtns[name];
      if (!btn) continue;
      btn.classList.toggle('cooling', cd > 0);
      btn.querySelector('.cd').textContent = cd > 0 ? Math.ceil(cd) : '';
    }
  }

  // ---------------- 手機觸控介面 ----------------
  // 左下:◀ ▶ 移動、▲ 跳、▼ 往下跳;右下:瞄準搖桿(推著就自動射)+ 兔劍 + 衝刺
  const touchBtns = {};
  function trySetCapture(el, id) {
    try {
      el.setPointerCapture(id);
    } catch (err) {
      /* 有些瀏覽器/測試環境不支援,沒關係 */
    }
  }
  document.querySelectorAll('#touchControls [data-btn]').forEach((btn) => {
    const name = btn.dataset.btn;
    touchBtns[name] = btn;
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      trySetCapture(btn, e.pointerId);
      btn.classList.add('pressed');
      if (name === 'left') keys.KeyA = true;
      else if (name === 'right') keys.KeyD = true;
      else if (state === 'playing') {
        if (name === 'jump') tryJump();
        else if (name === 'drop') tryDrop();
        else if (name === 'slash') trySlash();
        else if (name === 'dash') tryDash();
      }
    });
    const release = () => {
      btn.classList.remove('pressed');
      if (name === 'left') keys.KeyA = false;
      if (name === 'right') keys.KeyD = false;
    };
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('lostpointercapture', release);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  });

  const stickEl = document.getElementById('aimStick');
  const knobEl = document.getElementById('aimKnob');
  function moveStick(e) {
    const r = stickEl.getBoundingClientRect();
    const radius = r.width / 2;
    let dx = e.clientX - (r.left + radius);
    let dy = e.clientY - (r.top + radius);
    const v = L.stickVector(dx, dy, radius);
    stick.active = v.active;
    stick.angle = v.angle;
    const d = Math.hypot(dx, dy);
    if (d > radius) {
      dx = (dx / d) * radius;
      dy = (dy / d) * radius;
    }
    knobEl.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    stickEl.classList.toggle('active', stick.active);
  }
  function endStick(e) {
    if (e.pointerId !== stick.pointerId) return;
    stick.pointerId = null;
    stick.active = false;
    knobEl.style.transform = 'translate(-50%, -50%)';
    stickEl.classList.remove('active');
  }
  if (stickEl) {
    stickEl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      stick.pointerId = e.pointerId;
      trySetCapture(stickEl, e.pointerId);
      moveStick(e);
    });
    stickEl.addEventListener('pointermove', (e) => {
      if (e.pointerId === stick.pointerId) moveStick(e);
    });
    stickEl.addEventListener('pointerup', endStick);
    stickEl.addEventListener('pointercancel', endStick);
  }

  const fsBtn = document.getElementById('fsBtn');
  if (fsBtn) {
    if (!document.fullscreenEnabled) fsBtn.style.display = 'none'; // iPhone Safari 不支援網頁全螢幕
    fsBtn.addEventListener('click', async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else {
          await document.documentElement.requestFullscreen();
          if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape').catch(() => {});
        }
      } catch (err) {
        /* 使用者拒絕或不支援就算了 */
      }
    });
  }

  // 判斷要用電腦介面還是手機介面;手指一碰螢幕就切手機版,之後用鍵盤/滑鼠就切回來
  const coarseQuery = window.matchMedia ? window.matchMedia('(pointer: coarse)') : null;
  const fineQuery = window.matchMedia ? window.matchMedia('(pointer: fine)') : null;
  function setMobileMode(on) {
    if (on === mobileMode) return;
    mobileMode = on;
    document.body.classList.toggle('mobile', on);
    if (!on) {
      keys.KeyA = keys.KeyD = false;
      stick.active = false;
    }
    if (overlayKind === 'start' || overlayKind === 'lose') showOverlay(overlayKind); // 換成對應的操作說明
  }
  setMobileMode(
    L.prefersTouchUI({
      coarse: !!(coarseQuery && coarseQuery.matches),
      fine: !!(fineQuery && fineQuery.matches),
      maxTouchPoints: navigator.maxTouchPoints || 0,
    })
  );
  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') setMobileMode(true);
    else if (e.pointerType === 'mouse' && !(coarseQuery && coarseQuery.matches)) setMobileMode(false);
  }, true);
  window.addEventListener('keydown', () => {
    if (!(coarseQuery && coarseQuery.matches)) setMobileMode(false);
  }, true);

  // ---------------- 主迴圈 ----------------
  let last = 0;
  function loop(ts) {
    const dt = last ? Math.min(0.033, (ts - last) / 1000) : 0;
    last = ts;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  // 開發/測試用:在瀏覽器 console 可以用 window.__houyi 看目前狀態
  window.__houyi = {
    get state() { return state; },
    get player() { return player; },
    get suns() { return suns; },
    get enemyShots() { return enemyShots; },
    get arrows() { return arrows; },
    get cakes() { return cakes; },
    get lasers() { return lasers; },
    get heatZones() { return heatZones; },
    get mobile() { return mobileMode; },
    get stick() { return stick; },
  };

  overlay.innerHTML = '<h2>載入中……</h2>';
  loadImages()
    .then(() => {
      initGame();
      state = 'start';
      showOverlay('start');
    })
    .catch((err) => {
      overlay.innerHTML = `<h2>素材載入失敗</h2><p>${err.message}</p><p>請確認 assets 資料夾跟 index.html 放在一起。</p>`;
    });
  requestAnimationFrame(loop);
})();
