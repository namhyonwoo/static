/* DefenseGame: 디펜스 모드 조립 (원소스 멀티유즈의 첫 게임 — 한 사이클 뼈대).
   RTS 모드(rts.js)와 같은 원본 데이터·그림·소리·전투 공식을 그대로 쓰고, "게임 규칙"만 이 파일에 새로 썼다.

   ■ 다시 쓰는 것 (공용 엔진 mw/ 와 원본 에셋 sim/)
     - MWE.UnitType / MWE.Unit : 유닛 수치, 방향, 애니메이션 프레임 고르기 (core/unit.js)
     - MWE.OriginalRules       : 원본 피해 공식·공격 간격 (core/rules.js)
     - MWE.GameMap / TerrainRenderer : 원본 맵 지형을 배경으로 (core/gamemap.js, render/terrain.js)
     - MWE.Assets / MWE.Sfx / MWE.Bgm : 그림·효과음·배경음 (render/assets.js, ui/sfx.js, ui/hud.js)
     - MW.units / MW.fx / MW.map2 : 원본에서 뽑은 데이터 (sim/data.js)

   ■ 이 파일의 구성 (위에서 아래로 읽으면 된다)
     1. CONFIG   — 숫자만 바꿔도 게임이 달라지는 설정 (아군 목록, 웨이브, 스킬, 기지 체력 …)
     2. 준비     — 캔버스 크기 맞추기, 에셋 불러오기, 입력 연결
     3. 한 판    — reset() 으로 상태를 처음으로
     4. update() — 웨이브 → 유닛 행동 → 발사체 → 승패 판정 (1초에 60번쯤)
     5. draw()   — 배경 → 기지 → 유닛 → 이펙트 → HUD
     6. 입력     — 버튼 누르기 (마우스·터치 공통), 단축키

   좌표계: 화면 픽셀. 세로는 항상 450, 가로는 기기 비율에 맞춰 640~1100 (가로 모드 전용).
   전투는 왼쪽(아군 기지) ↔ 오른쪽(적 출구) 한 줄에서 벌어진다. */
(function (root) {
  'use strict';
  var MWE = root.MWE;

  /* ───────────────────────── 1. CONFIG ───────────────────────── */
  var CONFIG = {
    VIEW_H: 450,                 // 논리 화면 높이(px). 가로는 화면 비율로 정한다
    MIN_W: 640, MAX_W: 1100,
    HUD_H: 92,                   // 아래 버튼 줄 높이
    LANE_ROWS: [-26, 0, 26],     // 전투 줄 안에서 유닛이 서는 세로 위치 3개 (겹쳐 보이지 않게)
    BASE: { hp: 600, x: 64 },    // 아군 기지 체력과 가로 위치
    MANA: { max: 200, start: 70, regen: 10, perKill: 6 },   // 마나: 최대, 시작, 초당 회복, 처치 보상
    MOVE_SCALE: 0.45,            // 원본 걷기 속도(px/틱)를 이 게임 속도로 줄이는 배수
    RANGE_SCALE: 0.07,           // 원본 사거리 → 화면 px (근접 700 → 49px, 원거리 3000 → 210px)
    ENEMY_HP_MUL: 2,             // 적 체력 배수 (원본 해골전사는 체력 50이라 한 방에 쓰러진다)
    /* 소환할 수 있는 아군: id = 원본 유닛 번호 (0 전사, 4 궁수, 1 기사, 12 마법사). cost = 마나, cd = 다시 소환까지(초) */
    ROSTER: [
      { id: 0, cost: 30, cd: 1.5, key: '1' },
      { id: 4, cost: 45, cd: 2.5, key: '2' },
      { id: 1, cost: 60, cd: 4, key: '3' },
      { id: 12, cost: 80, cd: 5, key: '4' }
    ],
    /* 플레이어 스킬: 원본 소환사(20)의 첫 행동(나르 소환)의 아이콘·이펙트·소리를 쓴다 */
    SKILL: { unit: 20, act: 0, cost: 90, cd: 12, radius: 170, dmg: 140, hitDelay: 0.45 },
    /* 웨이브: list = [유닛 번호, 수] 묶음들(순서대로 나온다), gap = 한 기씩 나오는 간격(초), rest = 다음 웨이브까지 쉬는 시간(초)
       28 해골전사, 29 해골기사 */
    WAVES: [
      { list: [[28, 4]], gap: 1.8, rest: 6 },
      { list: [[28, 7]], gap: 1.4, rest: 6 },
      { list: [[28, 8], [29, 1]], gap: 1.2, rest: 7 },
      { list: [[28, 12], [29, 2]], gap: 1.0, rest: 7 },
      { list: [[28, 14], [29, 4]], gap: 0.8, rest: 0 }
    ]
  };

  /* ───────────────────────── 2. 준비 ───────────────────────── */
  function DefenseGame(canvas, data, opts) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.data = data; this.cfg = CONFIG;
    this.H = CONFIG.VIEW_H; this.W = 800;

    // 원본 데이터 → 엔진 객체
    this.types = data.units.map(function (d) { return new MWE.UnitType(d); });
    this.rules = new MWE.OriginalRules(data.fx.arms);        // 원본 피해 공식
    this.rng = new MWE.Rng(Date.now() & 0xffff);
    this.map = new MWE.GameMap(data.map2);                   // 배경으로 쓸 원본 맵 (평지가 있는 2인용 맵)

    // 그림: 필요한 것만 불러온다 (배경 타일, 이펙트, 스킬 아이콘, 유닛 작은 그림, 쓰는 유닛의 스프라이트)
    var A = this.assets = new MWE.Assets(opts.base), self = this;
    A.load('tiles', this.map.keys.tiles + '.png').load('arms', 'arms.png').load('acticons', 'acticons.png').load('figs', 'figs.png');
    this._usedUnitIds().forEach(function (id) { A.load('u' + id, self.types[id].img); });
    this.terrain = null;                                     // 그림이 다 오면 만든다

    this.sfx = new MWE.Sfx(opts.base + 'sfx.js', data.sfx);
    this.bgm = new MWE.Bgm(opts.base, ['bgm0.mp3', 'bgm1.mp3', 'bgm2.mp3']);
    this.soundOn = true;

    this.screen = 'loading';     // loading(불러오는 중) → title(시작 화면) → play(진행) → win / lose
    this.time = 0; this._last = 0;
    this._resize(); this._bind(); this.reset();
    requestAnimationFrame(function loop(ts) { requestAnimationFrame(loop); self._frame(ts); });
  }
  var P = DefenseGame.prototype;

  /* 이 게임이 화면에 올리는 유닛 번호 전부 (아군 목록 + 웨이브에 나오는 적) */
  P._usedUnitIds = function () {
    var ids = {}; CONFIG.ROSTER.forEach(function (r) { ids[r.id] = 1; });
    CONFIG.WAVES.forEach(function (w) { w.list.forEach(function (e) { ids[e[0]] = 1; }); });
    return Object.keys(ids).map(Number);
  };

  /* 캔버스의 논리 크기를 화면 비율에 맞춘다. 세로 450 고정, 가로만 늘었다 줄었다 한다.
     실제 화면에 꽉 채우는 것은 CSS(object-fit: contain)가 한다 — 여기서는 "게임 안 좌표"만 정한다. */
  P._resize = function () {
    var vw = root.innerWidth || 800, vh = root.innerHeight || 450, C = CONFIG;
    this.W = Math.max(C.MIN_W, Math.min(C.MAX_W, Math.round(C.VIEW_H * vw / vh)));
    this.cv.width = this.W; this.cv.height = this.H;
    this.ctx.imageSmoothingEnabled = false;                  // 도트 그림이 뭉개지지 않게 (크기를 바꾸면 다시 켜지므로 매번 끈다)
    this.laneY = Math.round((this.H - C.HUD_H) * 0.6);       // 전투 줄의 세로 중심
    this.spawnX = this.W + 24;                               // 적이 나오는 곳 (화면 오른쪽 바깥)
    this.frontX = this.W - 70;                               // 아군이 나아가는 한계
    this._layout();
  };

  /* 아래 버튼들의 위치. 스킬은 정가운데, 소환 버튼은 그 왼쪽, 마나 바는 오른쪽 */
  P._layout = function () {
    var C = CONFIG, y = this.H - C.HUD_H + 14, bh = 66, gap = 8, n = C.ROSTER.length, cx = this.W / 2;
    var bw = Math.min(62, Math.floor((cx - 52 - 8) / n) - gap);   // 화면이 좁으면 버튼 폭을 줄여 왼쪽으로 넘치지 않게
    var x0 = cx - 52 - n * (bw + gap);
    this.btns = C.ROSTER.map(function (r, i) { return { r: r, x: x0 + i * (bw + gap), y: y, w: bw, h: bh }; });
    this.skillBtn = { x: cx - 38, y: y - 6, w: 76, h: 76 };
    this.soundBtn = { x: this.W - 44, y: 8, w: 36, h: 26 };
  };

  /* ───────────────────────── 3. 한 판 ───────────────────────── */
  P.reset = function () {
    var C = CONFIG;
    this.units = [];             // 전장 위의 모든 유닛 (아군·적)
    this.shots = [];             // 날아가는 발사체
    this.effects = [];           // 터지는 이펙트
    this.texts = [];             // 떠오르는 숫자 (피해량 등)
    this.baseHp = C.BASE.hp; this.baseHit = 0;
    this.mana = C.MANA.start;
    this.cool = C.ROSTER.map(function () { return 0; });     // 소환 버튼별 남은 대기 시간
    this.skillCool = 0; this.flash = 0;
    this.wave = 0; this.queue = this._waveQueue(0); this.spawnT = 2; this.restT = 0; this.kills = 0;
    this.pendingBlasts = [];     // 스킬: 이펙트가 터진 뒤 조금 있다가 피해가 들어간다
  };

  /* 웨이브 한 개를 "나올 순서대로의 유닛 번호 목록"으로 편다. [[28,2],[29,1]] → [28,28,29] */
  P._waveQueue = function (i) {
    var q = [], w = CONFIG.WAVES[i]; if (!w) return q;
    w.list.forEach(function (e) { for (var k = 0; k < e[1]; k++) q.push(e[0]); });
    return q;
  };

  /* 유닛 한 기를 전장에 올린다. side: 0 아군(왼쪽에서 오른쪽으로), 1 적(오른쪽에서 왼쪽으로) */
  P.spawn = function (typeId, side) {
    var C = CONFIG, t = this.types[typeId], u = new MWE.Unit(t, side, 0, 0);
    u.side = side;
    u.x = side === 0 ? C.BASE.x + 40 : this.spawnX;
    u.y = this.laneY + C.LANE_ROWS[Math.floor(this.rng.next() * C.LANE_ROWS.length)];
    if (side === 1) { u.maxHp = Math.round(u.maxHp * C.ENEMY_HP_MUL); u.hp = u.maxHp; }
    u.dir = side === 0 ? 1 : -1;
    // 스프라이트 방향: 원본은 마름모 좌표라 "화면 오른쪽"이 (1,-1), "화면 왼쪽"이 (-1,1)이다
    u.face(u.dir, -u.dir);
    u.state = 'move'; u.cd = 0; u.fade = 0;
    u.rangePx = (u.act ? u.act.range : 700) * C.RANGE_SCALE;
    u.speedPx = t.walkPx * this.rules.tps * C.MOVE_SCALE;    // 초당 이동 px
    this.units.push(u);
    return u;
  };

  /* 아군 소환 버튼 i 를 누름: 마나와 대기 시간이 되면 소환 */
  P.summon = function (i) {
    var r = CONFIG.ROSTER[i]; if (!r || this.screen !== 'play') return false;
    if (this.mana < r.cost || this.cool[i] > 0) return false;
    this.mana -= r.cost; this.cool[i] = r.cd;
    var u = this.spawn(r.id, 0);
    this._play(u.t.snd.ready, 0.8);                          // 원본 등장 음성
    return true;
  };

  /* 플레이어 스킬: 화면 가운데에 큰 마법이 터지고, 범위 안의 적 전부에게 피해 */
  P.castSkill = function () {
    var S = CONFIG.SKILL; if (this.screen !== 'play') return false;
    if (this.mana < S.cost || this.skillCool > 0) return false;
    this.mana -= S.cost; this.skillCool = S.cd;
    var a = this._skillAct(), cx = this.W / 2, cy = this.laneY;
    // 이펙트: 원본 이펙트(칸 = a.arm)를 가운데와 양옆에 세 번 겹쳐서 넓게 보이게
    for (var k = -1; k <= 1; k++) this._addEffect(cx + k * S.radius * 0.55, cy + (k === 0 ? 0 : 10), a.arm, k === 0 ? 0 : 0.12);
    this.pendingBlasts.push({ x: cx, y: cy, r: S.radius, dmg: S.dmg, t: S.hitDelay });
    this.flash = 0.35;
    this._play(a.snd, 1);
    return true;
  };
  P._skillAct = function () { var S = CONFIG.SKILL; return this.types[S.unit].acts[S.act]; };

  /* ───────────────────────── 4. update ───────────────────────── */
  P._frame = function (ts) {
    var dt = Math.min(0.05, (ts - this._last) / 1000 || 0); this._last = ts;   // 탭이 멈췄다 돌아와도 한 번에 0.05초까지만 진행
    if (this.screen === 'loading' && this.assets.ready()) {
      this.terrain = new MWE.TerrainRenderer(this.map, this.assets.get('tiles'));
      this.screen = 'title';
    }
    if (this.screen === 'play' && !this.paused) this.update(dt);
    this.time += dt;
    this.draw();
  };

  P.update = function (dt) {
    var C = CONFIG, i;
    this.rules.now = this.time;
    // 마나 회복, 버튼 대기 시간
    this.mana = Math.min(C.MANA.max, this.mana + C.MANA.regen * dt);
    for (i = 0; i < this.cool.length; i++) this.cool[i] = Math.max(0, this.cool[i] - dt);
    this.skillCool = Math.max(0, this.skillCool - dt);
    this.flash = Math.max(0, this.flash - dt); this.baseHit = Math.max(0, this.baseHit - dt);

    this._updateWave(dt);
    for (i = 0; i < this.units.length; i++) this._updateUnit(this.units[i], dt);
    this._updateShots(dt);
    this._updateBlasts(dt);

    // 사라질 것 정리: 쓰러진 뒤 다 흐려진 유닛, 끝난 이펙트·숫자
    var T = this.time;
    this.units = this.units.filter(function (u) { return !(u.state === 'dead' && u.fade >= 1); });
    this.effects = this.effects.filter(function (e) { return (T - e.t0) * 15 < e.f.length; });
    this.texts = this.texts.filter(function (t) { return T - t.t0 < 0.8; });

    // 승패
    if (this.baseHp <= 0) { this.baseHp = 0; this.screen = 'lose'; }
    else if (this.wave >= C.WAVES.length && !this._alive(1).length) this.screen = 'win';
  };

  /* 웨이브 진행: 대기열에서 한 기씩 꺼내 내보내고, 다 나오면 쉬었다가 다음 웨이브 */
  P._updateWave = function (dt) {
    var C = CONFIG, w = C.WAVES[this.wave]; if (!w) return;
    if (this.queue.length) {
      this.spawnT -= dt;
      if (this.spawnT <= 0) { this.spawn(this.queue.shift(), 1); this.spawnT = w.gap; if (!this.queue.length) this.restT = w.rest; }
    } else {
      // 이 웨이브가 다 나왔다 → 쉬는 시간이 지나거나 적이 전멸하면 다음 웨이브
      this.restT -= dt;
      if (this.restT <= 0 || !this._alive(1).length) { this.wave++; this.queue = this._waveQueue(this.wave); this.spawnT = 1.5; }
    }
  };

  P._alive = function (side) { return this.units.filter(function (u) { return u.side === side && u.state !== 'dead'; }); };

  /* 유닛 한 기의 행동: (쓰러짐) → 공격 동작 진행 → 사거리 안에 적이 있으면 공격 시작 → 없으면 전진 */
  P._updateUnit = function (u, dt) {
    var R = this.rules, C = CONFIG, tps = R.tps;
    if (u.state === 'dead') { u.deadT += dt; if (u.deadT > 1.2) u.fade = Math.min(1, u.fade + dt * 1.5); return; }
    u.cd = Math.max(0, u.cd - dt);

    if (u.state === 'attack') {
      // 공격 동작: 원본 애니메이션을 틱 속도(초당 12장)로 넘기다가, 중간 프레임에서 실제 타격
      var A = u.t.anim.atk, n = A ? A.n : 6, hitAt = A && A.ev != null ? A.ev : Math.floor(n * 0.6);
      u.at += dt * tps;
      if (!u.hitDone && u.at >= hitAt) { u.hitDone = true; this._strike(u); }
      if (u.at >= n) { u.state = 'idle'; u.cd = R.cooldown(u, this.rng); }
      return;
    }

    // 공격할 대상 찾기: 맞은편 유닛 중 가장 가까운 것. 적은 대상이 없으면 기지를 친다
    var tgt = this._nearestFoe(u), baseDist = u.side === 1 ? u.x - (C.BASE.x + 30) : Infinity;
    var canHitUnit = tgt && Math.abs(tgt.x - u.x) <= u.rangePx, canHitBase = !canHitUnit && baseDist <= u.rangePx;
    if (canHitUnit || canHitBase) {
      if (u.cd <= 0 && u.act) { u.state = 'attack'; u.at = 0; u.hitDone = false; u.tgt = canHitUnit ? tgt : 'base'; this._play(u.act.snd, 0.5); }
      else u.state = 'idle';
      return;
    }
    // 전진. 아군은 화면 오른쪽 끝 앞에서 멈춰 기다린다
    if (u.side === 0 && u.x >= this.frontX) { u.state = 'idle'; return; }
    u.state = 'move'; u.walkT += dt; u.x += u.dir * u.speedPx * dt;
  };

  P._nearestFoe = function (u) {
    var best = null, bd = Infinity, L = this.units;
    for (var i = 0; i < L.length; i++) { var o = L[i]; if (o.side === u.side || o.state === 'dead') continue;
      var d = Math.abs(o.x - u.x); if (d < bd) { bd = d; best = o; } }
    return best;
  };

  /* 타격 순간: 근접은 바로 피해, 원거리(행동에 발사체 arm이 있음)는 발사체를 날린다 */
  P._strike = function (u) {
    var tgt = u.tgt, R = this.rules;
    if (tgt === 'base') { this._hitBase(R.attackValue(u)); return; }
    if (!tgt || tgt.state === 'dead') return;
    var dmg = R.damage(u, tgt, this.rng), arm = u.act.arm, def = arm >= 0 ? this.data.fx.arms[arm] : null;
    if (def) this.shots.push({ x: u.x + u.dir * 14, y: u.y - u.t.h * 0.6, tgt: tgt, dmg: dmg, arm: arm, def: def, dir: u.dir, t0: this.time, speed: 380 });
    else this._damage(tgt, dmg);
  };

  P._damage = function (u, dmg) {
    if (u.state === 'dead') return;
    this.texts.push({ x: u.x, y: u.y - u.t.h - 6, s: dmg > 0 ? String(dmg) : 'miss', t0: this.time, col: u.side === 1 ? '#ffe9a8' : '#ff9a8a' });
    if (dmg <= 0) return;
    u.hp -= dmg;
    if (u.hp <= 0) {
      u.hp = 0; u.state = 'dead'; u.deadT = 0; u.fade = 0;
      this._play(u.t.snd.die, 0.7);
      if (u.side === 1) { this.kills++; this.mana = Math.min(CONFIG.MANA.max, this.mana + CONFIG.MANA.perKill); }
    }
  };

  P._hitBase = function (dmg) { this.baseHp -= dmg; this.baseHit = 0.25; this.texts.push({ x: CONFIG.BASE.x, y: this.laneY - 96, s: '-' + dmg, t0: this.time, col: '#ff7a6a' }); };

  /* 발사체: 대상을 향해 날아가 닿으면 피해 + 명중 이펙트 */
  P._updateShots = function (dt) {
    var keep = [];
    for (var i = 0; i < this.shots.length; i++) {
      var s = this.shots[i], t = s.tgt, tx = t.x, ty = t.y - t.t.h * 0.5, dx = tx - s.x, dy = ty - s.y, d = Math.hypot(dx, dy), step = s.speed * dt;
      if (d <= step || t.state === 'dead') {
        if (t.state !== 'dead') { this._damage(t, s.dmg); if (s.def.hit.length) this._addEffect(tx, ty, s.arm, 0); }
        continue;
      }
      s.x += dx / d * step; s.y += dy / d * step; s.ang = Math.atan2(dy, dx); keep.push(s);
    }
    this.shots = keep;
  };

  P._updateBlasts = function (dt) {
    var keep = [], self = this;
    this.pendingBlasts.forEach(function (b) {
      b.t -= dt; if (b.t > 0) { keep.push(b); return; }
      self.units.forEach(function (u) { if (u.side === 1 && u.state !== 'dead' && Math.abs(u.x - b.x) <= b.r) self._damage(u, b.dmg); });
    });
    this.pendingBlasts = keep;
  };

  P._addEffect = function (x, y, arm, delay) {
    var d = this.data.fx.arms[arm], fr = d && (d.hit.length ? d.hit : d.fly);
    if (fr && fr.length) this.effects.push({ x: x, y: y, f: fr, t0: this.time + (delay || 0), add: !d.dir });
  };

  P._play = function (id, vol) { if (this.soundOn && id != null && id >= 0) this.sfx.play(id, vol); };

  /* ───────────────────────── 5. draw ───────────────────────── */
  P.draw = function () {
    var ctx = this.ctx, W = this.W, H = this.H;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0b0d12'; ctx.fillRect(0, 0, W, H);
    if (this.screen === 'loading') { this._center(this.assets.failed ? '그림을 불러오지 못했습니다: ' + this.assets.failed : '불러오는 중…', H / 2, 16, '#c9d1e3'); return; }

    this._drawGround();
    this._drawBases();
    // 유닛: 아래쪽(y가 큰) 유닛이 위에 그려지도록 정렬
    var L = this.units.slice().sort(function (a, b) { return a.y - b.y; }), i;
    for (i = 0; i < L.length; i++) this._drawUnit(L[i]);
    for (i = 0; i < this.shots.length; i++) this._drawShot(this.shots[i]);
    for (i = 0; i < this.effects.length; i++) this._drawEffect(this.effects[i]);
    this._drawTexts();
    if (this.flash > 0) { ctx.fillStyle = 'rgba(255,240,200,' + (this.flash * 0.9) + ')'; ctx.fillRect(0, 0, W, H - CONFIG.HUD_H); }
    this._drawHud();
    if (this.screen !== 'play') this._drawOverlay();
  };

  /* 배경: 원본 맵의 평지를 그대로 깔고, 전투 줄을 살짝 어둡게 표시 */
  P._drawGround = function () {
    var ctx = this.ctx, W = this.W, gh = this.H - CONFIG.HUD_H, map = this.map, c = map.t2w(map.arena[0], map.arena[1]);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, gh); ctx.clip();
    this.terrain.draw(ctx, { x: Math.round(c[0] - W / 2), y: Math.round(c[1] - this.laneY) }, W, gh);
    var g = ctx.createLinearGradient(0, this.laneY - 70, 0, this.laneY + 60);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(0,0,0,.22)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, this.laneY - 70, W, 130);
    ctx.restore();
  };

  /* 아군 기지(왼쪽 탑)와 적 출구(오른쪽 문). 뼈대 단계라 도형으로 그린다 — 나중에 원본 건물 그림으로 바꿀 자리 */
  P._drawBases = function () {
    var ctx = this.ctx, bx = CONFIG.BASE.x, y = this.laneY + 34, hit = this.baseHit > 0;
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(bx, y, 46, 12, 0, 0, 6.3); ctx.fill();
    ctx.fillStyle = hit ? '#d98a7a' : '#8f96a8'; ctx.fillRect(bx - 26, y - 104, 52, 104);
    ctx.fillStyle = hit ? '#b96a5a' : '#6d7487'; ctx.fillRect(bx - 32, y - 116, 64, 16);
    for (var k = 0; k < 4; k++) ctx.fillRect(bx - 32 + k * 17, y - 126, 12, 12);              // 성벽 톱니
    ctx.fillStyle = '#2a2f3c'; ctx.fillRect(bx - 9, y - 30, 18, 30);                          // 문
    ctx.fillStyle = '#3f7fd9'; ctx.fillRect(bx - 1, y - 160, 2, 36); ctx.beginPath(); ctx.moveTo(bx + 1, y - 160); ctx.lineTo(bx + 24, y - 152); ctx.lineTo(bx + 1, y - 144); ctx.fill();   // 깃발
    // 적 출구: 어두운 문
    var ex = this.W - 26;
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(ex, y, 40, 11, 0, 0, 6.3); ctx.fill();
    ctx.fillStyle = '#3a2233'; ctx.beginPath(); ctx.ellipse(ex, y - 52, 30, 56, 0, 0, 6.3); ctx.fill();
    ctx.fillStyle = 'rgba(190,80,200,' + (0.35 + 0.2 * Math.sin(this.time * 4)) + ')'; ctx.beginPath(); ctx.ellipse(ex, y - 52, 20, 44, 0, 0, 6.3); ctx.fill();
  };

  /* 유닛 한 기: 그림자 → 원본 스프라이트(Unit.frameIndex가 고른 프레임) → 체력 바 */
  P._drawUnit = function (u) {
    var ctx = this.ctx, fi = u.frameIndex(this.rules.tps), f = fi >= 0 ? u.t.frames[fi] : null, x = Math.round(u.x), y = Math.round(u.y);
    if (!f) return;
    ctx.globalAlpha = u.state === 'dead' ? 1 - u.fade : 1;
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(x, y + 2, 13, 5, 0, 0, 6.3); ctx.fill();
    ctx.save(); ctx.translate(x, y); if (u.mir) ctx.scale(-1, 1);
    ctx.drawImage(this.assets.get(f[6] || ('u' + u.t.id)), f[0], f[1], f[2], f[3], -f[4], -f[5], f[2], f[3]);
    ctx.restore(); ctx.globalAlpha = 1;
    if (u.state !== 'dead' && u.hp < u.maxHp) this._bar(x - 15, y - u.t.h - 8, 30, 4, u.hp / u.maxHp, u.side === 0 ? '#5fd46a' : '#e0584a');
  };

  /* 발사체: 방향 없는 이펙트(불덩이 등)는 원본 그림, 방향 있는 것(화살)은 선으로 */
  P._drawShot = function (s) {
    var ctx = this.ctx, fl = s.def.fly;
    if (!s.def.dir && fl.length) this._fxFrame(fl[Math.floor((this.time - s.t0) * 15) % fl.length], s.x, s.y, true);
    else { var a = s.ang || (s.dir > 0 ? 0 : Math.PI); ctx.strokeStyle = '#f3e3b0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(s.x - Math.cos(a) * 9, s.y - Math.sin(a) * 9); ctx.lineTo(s.x + Math.cos(a) * 9, s.y + Math.sin(a) * 9); ctx.stroke(); }
  };

  P._drawEffect = function (e) {
    var k = Math.floor((this.time - e.t0) * 15); if (k < 0 || k >= e.f.length) return;
    this._fxFrame(e.f[k], e.x, e.y, e.add);
  };

  /* 이펙트 그림 한 장 (arms.png 안의 번호). add = 빛나는 가산 합성 */
  P._fxFrame = function (idx, x, y, add) {
    var fr = this.data.fx.frames[idx], ctx = this.ctx; if (!fr) return;
    if (add) ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(this.assets.get('arms'), fr[0], fr[1], fr[2], fr[3], Math.round(x - fr[4]), Math.round(y - fr[5]), fr[2], fr[3]);
    if (add) ctx.globalCompositeOperation = 'source-over';
  };

  P._drawTexts = function () {
    var ctx = this.ctx; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (var i = 0; i < this.texts.length; i++) { var t = this.texts[i], k = (this.time - t.t0) / 0.8;
      ctx.globalAlpha = 1 - k; ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.strokeText(t.s, t.x, t.y - k * 22); ctx.fillStyle = t.col; ctx.fillText(t.s, t.x, t.y - k * 22); }
    ctx.globalAlpha = 1; ctx.textAlign = 'left';
  };

  P._bar = function (x, y, w, h, ratio, col) {
    var ctx = this.ctx; ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = col; ctx.fillRect(x, y, Math.round(w * Math.max(0, Math.min(1, ratio))), h);
  };

  /* HUD: 위 = 기지 체력·웨이브·소리 버튼, 아래 = 소환 버튼·스킬·마나 */
  P._drawHud = function () {
    var ctx = this.ctx, W = this.W, H = this.H, C = CONFIG, i;
    // 위: 기지 체력
    ctx.font = 'bold 12px sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(8, 8, 190, 26);
    ctx.fillStyle = '#dfe6f5'; ctx.fillText('기지', 16, 21);
    this._bar(50, 15, 110, 12, this.baseHp / C.BASE.hp, this.baseHp / C.BASE.hp > 0.35 ? '#5fd46a' : '#e0584a');
    ctx.fillStyle = '#fff'; ctx.textAlign = 'right'; ctx.fillText(Math.ceil(this.baseHp), 192, 21);
    // 위 가운데: 웨이브
    var wv = Math.min(this.wave + 1, C.WAVES.length), left = this._alive(1).length + this.queue.length;
    ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(W / 2 - 80, 8, 160, 26);
    ctx.fillStyle = '#ffd36e'; ctx.fillText('웨이브 ' + wv + ' / ' + C.WAVES.length + '   남은 적 ' + left, W / 2, 21);
    // 위 오른쪽: 소리
    var sb = this.soundBtn; ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(sb.x, sb.y, sb.w, sb.h);
    ctx.fillStyle = this.soundOn ? '#dfe6f5' : '#6f7687'; ctx.fillText(this.soundOn ? '소리' : '무음', sb.x + sb.w / 2, sb.y + sb.h / 2);

    // 아래 바탕
    var y0 = H - C.HUD_H; ctx.fillStyle = '#12151d'; ctx.fillRect(0, y0, W, C.HUD_H); ctx.fillStyle = '#2a3040'; ctx.fillRect(0, y0, W, 2);

    // 소환 버튼: 원본 유닛 작은 그림(figs.png, 유닛 번호 × 36px) + 마나 값 + 대기 시간 가림막
    var figs = this.assets.get('figs');
    for (i = 0; i < this.btns.length; i++) {
      var b = this.btns[i], r = b.r, ok = this.mana >= r.cost && this.cool[i] <= 0, t = this.types[r.id];
      ctx.fillStyle = ok ? '#232a3a' : '#191d27'; ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = ok ? '#c9a35a' : '#3a4152'; ctx.lineWidth = 2; ctx.strokeRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2);
      ctx.globalAlpha = ok ? 1 : 0.45; ctx.drawImage(figs, t.pid * 36, 0, 36, 43, b.x + (b.w - 36) / 2, b.y + 3, 36, 43); ctx.globalAlpha = 1;
      if (this.cool[i] > 0) { ctx.fillStyle = 'rgba(0,0,0,.6)'; var ch = b.h * this.cool[i] / r.cd; ctx.fillRect(b.x, b.y + b.h - ch, b.w, ch); }
      ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = this.mana >= r.cost ? '#8fc7ff' : '#e0584a'; ctx.fillText(r.cost, b.x + b.w / 2, b.y + b.h - 9);
      ctx.font = '9px sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = '#8a93a8'; ctx.fillText(r.key, b.x + 5, b.y + 9);
    }

    // 스킬 버튼 (정가운데, 둥글게): 원본 행동 아이콘(acticons.png)
    var s = this.skillBtn, S = C.SKILL, a = this._skillAct(), D = this.data.fx.icon, sok = this.mana >= S.cost && this.skillCool <= 0, cx = s.x + s.w / 2, cy = s.y + s.h / 2, fi = a.icon * 2;
    ctx.fillStyle = sok ? '#3a2a12' : '#191d27'; ctx.beginPath(); ctx.arc(cx, cy, s.w / 2, 0, 6.3); ctx.fill();
    ctx.strokeStyle = sok ? '#ffd36e' : '#3a4152'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(cx, cy, s.w / 2 - 2, 0, 6.3); ctx.stroke();
    ctx.globalAlpha = sok ? 1 : 0.45; ctx.drawImage(this.assets.get('acticons'), (fi % D.cols) * D.w, Math.floor(fi / D.cols) * D.h, D.w, D.h, cx - D.w * 0.7, cy - D.h * 0.7 - 4, D.w * 1.4, D.h * 1.4); ctx.globalAlpha = 1;
    if (this.skillCool > 0) { ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, s.w / 2, -Math.PI / 2, -Math.PI / 2 + 6.283 * this.skillCool / S.cd); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(Math.ceil(this.skillCool), cx, cy); }
    ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = this.mana >= S.cost ? '#8fc7ff' : '#e0584a'; ctx.fillText(S.cost, cx, s.y + s.h - 4);

    // 마나 바 (스킬 오른쪽)
    var mx = cx + 56, mw = Math.min(230, W - mx - 16), my = y0 + 34;
    ctx.textAlign = 'left'; ctx.font = 'bold 12px sans-serif'; ctx.fillStyle = '#8fc7ff'; ctx.fillText('마나 ' + Math.floor(this.mana) + ' / ' + C.MANA.max, mx, my - 12);
    this._bar(mx, my, mw, 14, this.mana / C.MANA.max, '#3f8fe8');
    ctx.font = '10px sans-serif'; ctx.fillStyle = '#6f7687'; ctx.fillText('처치 ' + this.kills + '   ·   1~4 소환, 스페이스 스킬', mx, my + 30);
  };

  /* 시작 / 승리 / 패배 화면 */
  P._drawOverlay = function () {
    var ctx = this.ctx, W = this.W, H = this.H, sc = this.screen;
    ctx.fillStyle = 'rgba(5,7,12,.72)'; ctx.fillRect(0, 0, W, H);
    if (sc === 'title') { this._center('거울전쟁 디펜스', H / 2 - 50, 30, '#ffd36e'); this._center('해골 군단을 막아 기지를 지키세요', H / 2 - 12, 14, '#dfe6f5');
      this._center('아래 버튼으로 아군을 소환하고, 가운데 버튼으로 마법을 씁니다', H / 2 + 12, 12, '#9aa3b8'); this._center('화면을 눌러 시작', H / 2 + 56, 16, '#fff'); }
    else if (sc === 'win') { this._center('스테이지 클리어!', H / 2 - 30, 30, '#8fe89a'); this._center('처치 ' + this.kills + '   ·   남은 기지 체력 ' + Math.ceil(this.baseHp), H / 2 + 8, 14, '#dfe6f5'); this._center('화면을 눌러 다시 하기', H / 2 + 50, 16, '#fff'); }
    else if (sc === 'lose') { this._center('게임 오버', H / 2 - 30, 30, '#ff7a6a'); this._center('웨이브 ' + Math.min(this.wave + 1, CONFIG.WAVES.length) + ' 에서 기지가 무너졌습니다', H / 2 + 8, 14, '#dfe6f5'); this._center('화면을 눌러 다시 하기', H / 2 + 50, 16, '#fff'); }
  };

  P._center = function (s, y, size, col) { var ctx = this.ctx; ctx.font = 'bold ' + size + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = col; ctx.fillText(s, this.W / 2, y); ctx.textAlign = 'left'; };

  /* ───────────────────────── 6. 입력 ───────────────────────── */
  /* 화면에서 누른 위치 → 게임 안 좌표. 캔버스가 화면에 맞춰 늘어나 있고(object-fit: contain) 남는 곳은 여백이므로 그만큼 보정한다 */
  P._pos = function (e) {
    var r = this.cv.getBoundingClientRect(), k = Math.min(r.width / this.W, r.height / this.H);
    return [(e.clientX - r.left - (r.width - this.W * k) / 2) / k, (e.clientY - r.top - (r.height - this.H * k) / 2) / k];
  };
  function inBox(b, x, y) { return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h; }

  P._tap = function (x, y) {
    this.sfx.unlock();                                       // 브라우저는 첫 터치 뒤에만 소리를 허락한다
    if (inBox(this.soundBtn, x, y)) { this.toggleSound(); return; }
    if (this.screen === 'title') { this.start(); return; }
    if (this.screen === 'win' || this.screen === 'lose') { this.reset(); this.screen = 'play'; return; }
    if (this.screen !== 'play') return;
    for (var i = 0; i < this.btns.length; i++) if (inBox(this.btns[i], x, y)) { this.summon(i); return; }
    if (inBox(this.skillBtn, x, y)) this.castSkill();
  };

  P.start = function () {
    this.reset(); this.screen = 'play';
    if (this.soundOn && !this.bgm.on) { this.bgm.set(0); this.bgm.toggle(); }
    // 휴대폰: 전체 화면 + 가로 고정을 시도한다 (지원하지 않는 브라우저에서는 조용히 넘어간다)
    try { var el = document.documentElement, p = root.matchMedia && root.matchMedia('(pointer: coarse)').matches && el.requestFullscreen ? el.requestFullscreen() : null;
      if (p && p.then) p.then(function () { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(function () {}); }).catch(function () {}); } catch (err) {}
  };

  P.toggleSound = function () { this.soundOn = !this.soundOn; this.sfx.on = this.soundOn; if (this.bgm.on !== this.soundOn && this.screen !== 'title') this.bgm.toggle(); };

  P._bind = function () {
    var self = this, cv = this.cv;
    cv.addEventListener('pointerdown', function (e) { e.preventDefault(); var p = self._pos(e); self._tap(p[0], p[1]); });
    cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    root.addEventListener('resize', function () { self._resize(); });
    root.addEventListener('keydown', function (e) {
      if (e.repeat) return;
      if (e.code === 'Space' || e.key === 'Enter') { e.preventDefault(); self.sfx.unlock(); if (self.screen === 'play') self.castSkill(); else if (self.screen !== 'loading') self._tap(-1, -1); return; }
      var i = CONFIG.ROSTER.map(function (r) { return r.key; }).indexOf(e.key); if (i >= 0) { self.sfx.unlock(); self.summon(i); }
      if (e.key === 'm' || e.key === 'M') self.toggleSound();
    });
    // 다른 탭으로 가면 멈춘다
    document.addEventListener('visibilitychange', function () { self.paused = document.hidden; });
  };

  DefenseGame.CONFIG = CONFIG;
  MWE.DefenseGame = DefenseGame;
})(window);
