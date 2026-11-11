/* DefenseGame: 디펜스 모드 조립 (원소스 멀티유즈의 첫 게임 — 한 사이클 뼈대).
   RTS 모드(rts.js)와 같은 원본 데이터·그림·소리·전투 공식을 그대로 쓰고, "게임 규칙"만 이 파일에 새로 썼다.

   ■ 다시 쓰는 것 (공용 엔진 mw/ 와 원본 에셋 sim/)
     - MWE.UnitType / MWE.Unit : 유닛 수치, 방향, 애니메이션 프레임 고르기 (core/unit.js)
     - MWE.OriginalRules       : 원본 피해 공식·공격 간격·무기/방어 강화 배수 (core/rules.js)
     - MWE.GameMap / TerrainRenderer : 원본 맵 지형을 배경으로 (core/gamemap.js, render/terrain.js)
     - MWE.Assets / MWE.Sfx / MWE.Bgm : 그림·효과음·배경음 (render/assets.js, ui/sfx.js, ui/hud.js)
     - MW.units / MW.fx / MW.map2 : 원본에서 뽑은 데이터 (sim/data.js)
     - MW_DEF + defense.png       : 원본 건물 그림(성·마굴)을 이 게임 크기로 구운 것 (sim/defense.js, tools/defbuild.js)

   ■ 이 파일의 구성 (위에서 아래로 읽으면 된다)
     1. CONFIG    — 숫자만 바꿔도 게임이 달라지는 설정 (탭·웨이브·마나·마법 유닛 제한 …)
     2. 준비      — 캔버스 크기 맞추기, 에셋 불러오기, 버튼 배치
     3. 한 판     — reset(), 유닛 소환(spawn / summon)과 소환 검증(canSummon)
     4. 스킬      — SkillSlot(유닛과 1:1로 묶인 스킬 칸) 만들기·없애기·쿨타임, 스킬 종류별 효과
     5. update()  — 웨이브 → 유닛 행동 → 발사체 → 승패 판정 (1초에 60번쯤)
     6. draw()    — 배경 → 건물 → 유닛 → 이펙트 → HUD(왼쪽 소환 패널, 오른쪽 스킬 패널)
     7. 입력      — 버튼 누르기 (마우스·터치 공통), 단축키

   ■ 유닛 두 종류
     - 일반 유닛: 마나만 있으면 몇 기든 소환.
     - 마법 유닛: 스킬을 가진 유닛(SKILL_ACT 표). 전장에 동시에 MAX_MAGIC(3)기까지만.
       소환되면 오른쪽 아래 스킬 패널에 그 유닛 전용 칸(SkillSlot)이 생기고, 쓰러지면 칸도 사라진다.

   좌표계: 세로는 항상 450, 화면 가로는 기기 비율에 맞춰 720~1100 (가로 모드 전용).
   전장은 화면보다 긴 가로 WORLD_W(2000px)이고, 카메라(cam.x)가 좌우로 움직이며 그 일부를 비춘다.
     유닛·건물·이펙트의 x = 전장 좌표,  화면 x = 전장 x − cam.x
   전투는 왼쪽(아군 기지) ↔ 오른쪽(적 출구) 사이에서 벌어지고, 유닛은 세로 5줄에 나뉘어 선다. */
(function (root) {
  'use strict';
  var MWE = root.MWE;

  /* ───────────────────────── 1. CONFIG ───────────────────────── */
  var CONFIG = {
    VIEW_H: 450,                 // 논리 화면 높이(px). 가로는 화면 비율로 정한다
    MIN_W: 720, MAX_W: 1100,
    HUD_H: 108,                  // 아래 패널 높이 (탭 한 줄 + 버튼 한 줄)
    WORLD_W: 2000,               // 전장 전체 가로 길이(px). 화면보다 길어서 카메라가 좌우로 움직인다
    LANE_ROWS: [-56, -28, 0, 28, 56],   // 유닛이 서는 세로 줄 5개 (전투 줄 중심에서의 거리)
    UNIT_GAP: 30,                // 줄 서기: 같은 편 앞사람과 벌려 두는 간격(px)
    ROW_NEAR: 18,                // 세로로 이만큼 안이면 "같은 줄"로 본다
    ROW_WEIGHT: 0.35,            // 근접 공격: 세로 줄 차이를 거리에 얼마나 넣을지 (작을수록 옆줄의 적도 쳐서 한 적을 여럿이 에워싼다)
    PASS_WAIT: 0.5,              // 앞사람에게 이만큼(초) 막혀 있으면 빈 옆줄로 추월을 시도한다
    ALT_MAX: 16,                 // 공중 유닛이 땅에서 떠 보이는 높이의 한도(px). 원본 그림은 엔젤 나이트가 100px 넘게 떠 있어 위쪽 표시를 가린다
    RANGE_SPREAD: 0.2,           // 원거리 유닛마다 서는 거리를 사거리의 (1 − 이 값)~1배 사이에서 다르게 (한 줄로 뭉치지 않게)
    CAM: { follow: 2.5, manualSec: 5 },   // 카메라: 전선을 따라가는 빠르기, 손으로 움직인 뒤 자동으로 돌아오기까지(초)
    BASE: { hp: 600, x: 78, front: 196 },   // 아군 기지(성): 체력, 그림 기준점의 가로 위치, 성 앞 선(아군이 나오고 적이 멈춰 때리는 곳)
    LAIR: { back: 74, mouth: 150 },         // 적 출구(마굴): 그림 기준점이 화면 오른쪽 끝에서 떨어진 거리, 적이 나오는 입구까지의 거리
    MANA: { max: 300, start: 80, regen: 12, perKill: 6 },   // 마나: 최대, 시작, 초당 회복, 처치 보상
    MOVE_SCALE: 0.45,            // 원본 걷기 속도(px/틱)를 이 게임 속도로 줄이는 배수
    RANGE_SCALE: 0.07,           // 원본 사거리 → 화면 px (근접 700 → 49px, 원거리 3000 → 210px)
    ENEMY_HP_MUL: 2,             // 적 체력 배수 (원본 해골전사는 체력 50이라 한 방에 쓰러진다)
    COST_PER_GOLD: 0.45,         // 소환 마나 = 원본 생산 비용(금) × 이 값 (5 단위로 반올림)
    MAX_MAGIC: 3,                // 마법 유닛 동시 소환 한도 = 스킬 칸 수
    SUPPORT_DIST: 210,           // 기본 공격이 없는 유닛(성직자·소환사 등)이 적과 벌려 두는 거리(px)
    SKILL: { radius: 150, buffRadius: 170, dmgMul: 2, healRatio: 0.5, stunSec: 6, firstWait: 2 },   // 스킬 공통 수치 (목업 값)
    /* 소환 패널의 탭: 해방부대 전체(원본 유닛 번호 0~24)를 네 묶음으로 나눈다 */
    TABS: [
      { name: '근접', ids: [0, 1, 2, 3, 6, 7, 8] },          // 전사 기사 창기사 성기사 창검사 격투가 무도가
      { name: '원거리', ids: [4, 5, 9, 10, 22, 23] },        // 궁수 명궁 도사 의적 엔젤 나이트 엔트
      { name: '마법', ids: [11, 12, 13, 14, 15, 16] },       // 정령사 마법사 장로 연금술사 마법전사 마법기사
      { name: '신성·소환', ids: [17, 18, 19, 20, 21, 24] }   // 성령사 사제 주교 소환사 신수사 공주
    ],
    /* 마법 유닛과 그 유닛의 스킬: { 유닛 번호: 원본 행동 목록에서 몇 번째 행동을 스킬로 쓸지 }.
       이 표에 있는 유닛이 "마법 유닛"이다. 스킬의 아이콘·이펙트·소리·수치는 원본 행동 데이터 그대로. */
    SKILL_ACT: {
      3: 1,    // 성기사    힐링            (주변 아군 회복)
      10: 3,   // 의적      암살            (가까운 적 하나 즉사)
      11: 1,   // 정령사    파이어 웨폰      (주변 아군 공격 강화)
      12: 1,   // 마법사    파운틴 베리어    (주변 아군 방어 강화)
      13: 2,   // 장로      라이트닝 썬더    (범위 피해)
      14: 1,   // 연금술사  매직 웨폰        (주변 아군 공격 강화)
      15: 1,   // 마법전사  아이스 웨폰      (주변 아군 공격 강화)
      16: 1,   // 마법기사  아이스 웨폰
      17: 1,   // 성령사    힐링
      18: 0,   // 사제      디스트로이 언홀리 (범위 안 적을 잠시 멈춤)
      19: 0,   // 주교      홀리 크로스      (범위 피해)
      20: 0,   // 소환사    나르 소환        (범위 피해)
      21: 0,   // 신수사    말다 소환        (넓은 범위 아군 완전 회복)
      22: 1,   // 엔젤 나이트 홀리 크로스
      23: 0,   // 엔트      엔트 변형        (공중 ↔ 지상 엔트)
      24: 0    // 공주      멀티 챠밍        (범위 안 적을 우리 편으로)
    },
    MORPH: { 23: 77, 77: 23 },   // 변형 스킬로 오가는 유닛 번호 (엔트 ↔ 지상 엔트)
    /* 웨이브: list = [유닛 번호, 수] 묶음들(순서대로 나온다), gap = 한 기씩 나오는 간격(초), rest = 다음 웨이브까지 쉬는 시간(초)
       28 해골전사, 29 해골기사 */
    WAVES: [
      { list: [[28, 4]], gap: 1.8, rest: 6 },
      { list: [[28, 7]], gap: 1.4, rest: 6 },
      { list: [[28, 8], [29, 1]], gap: 1.2, rest: 7 },
      { list: [[28, 12], [29, 2]], gap: 1.0, rest: 7 },
      { list: [[28, 14], [29, 4]], gap: 0.8, rest: 8 },
      { list: [[28, 16], [29, 6]], gap: 0.7, rest: 8 },
      { list: [[29, 6], [28, 18], [29, 6]], gap: 0.6, rest: 0 }
    ]
  };

  /* ───────────────────────── 2. 준비 ───────────────────────── */
  function DefenseGame(canvas, data, opts) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.data = data; this.cfg = CONFIG;
    this.H = CONFIG.VIEW_H; this.W = 800;

    // 원본 데이터 → 엔진 객체
    this.types = {}; var self = this;
    data.units.forEach(function (d) { self.types[d.id] = new MWE.UnitType(d); });   // 유닛 번호로 찾는다 (77 같은 변형 형태도 있다)
    this.rules = new MWE.OriginalRules(data.fx.arms);        // 원본 피해 공식
    this.rng = new MWE.Rng(Date.now() & 0xffff);
    this.map = new MWE.GameMap(data.map2);                   // 배경으로 쓸 원본 맵 (평지가 있는 2인용 맵)

    // 소환 목록: 탭마다 { 유닛 종류, 마나 값, 다시 소환까지(초), 마법 유닛인가 }
    this.roster = CONFIG.TABS.map(function (tab) { return tab.ids.map(function (id) {
      var t = self.types[id], cost = Math.max(15, Math.round(t.cost[3] * CONFIG.COST_PER_GOLD / 5) * 5);
      return { id: id, t: t, cost: cost, cd: Math.max(1, Math.min(8, cost / 20)), magic: CONFIG.SKILL_ACT[id] != null, wait: 0 };
    }); });
    this.tab = 0;

    // 그림: 필요한 것만 불러온다 (배경 타일, 이펙트, 스킬 아이콘, 유닛 작은 그림, 건물, 쓰는 유닛의 스프라이트)
    var A = this.assets = new MWE.Assets(opts.base);
    A.load('tiles', this.map.keys.tiles + '.png').load('arms', 'arms.png').load('acticons', 'acticons.png').load('figs', 'figs.png').load('defense', 'defense.png');
    this.bld = root.MW_DEF || {};                            // 건물 그림 위치표 { base, lair } (sim/defense.js)
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

  /* 이 게임이 화면에 올리는 유닛 번호 전부 (소환 목록 + 변형 형태 + 웨이브에 나오는 적) */
  P._usedUnitIds = function () {
    var ids = {}, C = CONFIG;
    C.TABS.forEach(function (tab) { tab.ids.forEach(function (id) { ids[id] = 1; }); });
    Object.keys(C.MORPH).forEach(function (id) { ids[id] = 1; });
    C.WAVES.forEach(function (w) { w.list.forEach(function (e) { ids[e[0]] = 1; }); });
    return Object.keys(ids).map(Number);
  };

  /* 캔버스의 논리 크기를 화면 비율에 맞춘다. 세로 450 고정, 가로만 늘었다 줄었다 한다.
     실제 화면에 꽉 채우는 것은 CSS(object-fit: contain)가 한다 — 여기서는 "게임 안 좌표"만 정한다. */
  P._resize = function () {
    var vw = root.innerWidth || 800, vh = root.innerHeight || 450, C = CONFIG;
    this.W = Math.max(C.MIN_W, Math.min(C.MAX_W, Math.round(C.VIEW_H * vw / vh)));
    this.cv.width = this.W; this.cv.height = this.H;
    this.ctx.imageSmoothingEnabled = false;                  // 도트 그림이 뭉개지지 않게 (크기를 바꾸면 다시 켜지므로 매번 끈다)
    this.laneY = Math.round((this.H - C.HUD_H) * 0.70);      // 전투 줄의 세로 중심 (위쪽 표시와 겹치지 않게 조금 아래)
    this.spawnX = C.WORLD_W - C.LAIR.mouth;                  // 적이 나오는 곳 (마굴 입구) — 전장 좌표
    this.frontX = C.WORLD_W - C.LAIR.mouth - 40;             // 아군이 나아가는 한계 (마굴 앞)
    this.cam = this.cam || { x: 0 };                         // 카메라: 화면 왼쪽 끝이 전장의 어디인가
    this._clampCam();
    this._layout();
  };

  /* 아래 패널의 버튼 위치.
       왼쪽  [소환 패널]  탭 한 줄 + 지금 탭의 유닛 버튼 (고정 영역)
       오른쪽 [스킬 패널]  마법 유닛 스킬 칸 MAX_MAGIC개 (전장의 마법 유닛에 따라 채워졌다 비워진다) */
  P._layout = function () {
    var C = CONFIG, y0 = this.H - C.HUD_H, W = this.W, n = C.MAX_MAGIC, sw = 64, sg = 6, i;
    // 오른쪽 스킬 패널
    var rx = W - 10 - n * sw - (n - 1) * sg;
    this.slotBoxes = []; for (i = 0; i < n; i++) this.slotBoxes.push({ x: rx + i * (sw + sg), y: y0 + 32, w: sw, h: 68 });
    this.skillPanel = { x: rx, y: y0 + 6, w: W - 10 - rx, h: 22 };
    // 왼쪽 소환 패널: 버튼 폭은 "가장 긴 탭(7개)"이 왼쪽 영역에 들어가도록
    var lx = 8, lw = rx - 16 - lx, most = Math.max.apply(null, C.TABS.map(function (t) { return t.ids.length; })), gap = 5;
    var bw = Math.min(62, Math.floor(lw / most) - gap);
    this.btnBoxes = []; for (i = 0; i < most; i++) this.btnBoxes.push({ x: lx + i * (bw + gap), y: y0 + 32, w: bw, h: 68 });
    var tw = Math.min(92, Math.floor(lw / C.TABS.length) - 4);
    this.tabBoxes = C.TABS.map(function (t, k) { return { x: lx + k * (tw + 4), y: y0 + 6, w: tw, h: 22 }; });
    this.soundBtn = { x: W - 44, y: 8, w: 36, h: 26 };
    this.miniBox = { x: Math.round(W / 2 - 120), y: 38, w: 240, h: 14 };   // 위 가운데: 전장 전체를 한 줄로 줄인 진행 막대
  };

  /* ───────────────────────── 3. 한 판 ───────────────────────── */
  P.reset = function () {
    var C = CONFIG;
    this.units = [];             // 전장 위의 모든 유닛 (아군·적)
    this.slots = [];             // 스킬 칸(SkillSlot) — 전장의 마법 유닛마다 하나, 최대 MAX_MAGIC개
    this.shots = [];             // 날아가는 발사체
    this.effects = [];           // 터지는 이펙트
    this.texts = [];             // 떠오르는 숫자·글자 (피해량 등)
    this.baseHp = C.BASE.hp; this.baseHit = 0;
    this.mana = C.MANA.start;
    this.roster.forEach(function (list) { list.forEach(function (r) { r.wait = 0; }); });   // 소환 버튼별 남은 대기 시간
    this.flash = 0;
    this.cam.x = 0; this.manualUntil = 0; this.drag = null;
    this.wave = 0; this.queue = this._waveQueue(0); this.spawnT = 2; this.restT = 0; this.kills = 0;
  };

  /* 웨이브 한 개를 "나올 순서대로의 유닛 번호 목록"으로 편다. [[28,2],[29,1]] → [28,28,29] */
  P._waveQueue = function (i) {
    var q = [], w = CONFIG.WAVES[i]; if (!w) return q;
    w.list.forEach(function (e) { for (var k = 0; k < e[1]; k++) q.push(e[0]); });
    return q;
  };

  /* 그 종류의 "기본 공격" 행동. 공격 행동(isAtk)이 없는 유닛(성직자·소환사 등)은 null → 싸우지 않고 뒤에서 스킬만 쓴다 */
  function basicAct(t) { var a = t.ai >= 0 ? t.acts[t.ai] : null; return a && a.isAtk == 1 ? a : null; }

  /* 유닛 한 기를 전장에 올린다. side: 0 아군(왼쪽에서 오른쪽으로), 1 적(오른쪽에서 왼쪽으로) */
  P.spawn = function (typeId, side) {
    var C = CONFIG, t = this.types[typeId], u = new MWE.Unit(t, side, 0, 0), self = this;
    u.side = side;
    u.x = side === 0 ? C.BASE.front - 8 : this.spawnX;
    u.y = this.laneY + C.LANE_ROWS[Math.floor(this.rng.next() * C.LANE_ROWS.length)];
    if (side === 1) { u.maxHp = Math.round(u.maxHp * C.ENEMY_HP_MUL); u.hp = u.maxHp; }
    u.state = 'move'; u.cd = 0; u.fade = 0; u.stunUntil = 0; u.blockT = 0; u.passY = null;
    u.rangeK = 1 - C.RANGE_SPREAD * this.rng.next();         // 이 유닛이 서는 거리 배수 (원거리만 쓴다)
    this._setSide(u, side);
    this._applyType(u);
    // 마법 유닛이면 스킬 칸을 만들어 서로 가리키게 한다 (유닛 ↔ 칸 1:1)
    u.slot = null; u.castSkill = function () { return self.castUnitSkill(u); };
    if (side === 0 && C.SKILL_ACT[typeId] != null) this._addSlot(u, t.acts[C.SKILL_ACT[typeId]]);
    this.units.push(u);
    return u;
  };

  /* 편(진영)과 걷는 방향을 정한다. 매혹으로 편이 바뀔 때도 쓴다.
     스프라이트 방향: 원본은 마름모 좌표라 "화면 오른쪽"이 (1,-1), "화면 왼쪽"이 (-1,1)이다 */
  P._setSide = function (u, side) { u.side = side; u.fac = side; u.dir = side === 0 ? 1 : -1; u.face(u.dir, -u.dir); u.tgt = null; };

  /* 종류에서 나오는 값(기본 공격·사거리·속도)을 유닛에 다시 적는다. 처음 소환할 때와 변형할 때 */
  P._applyType = function (u) {
    var C = CONFIG, t = u.t;
    // 떠 있는 높이: 원본 스프라이트는 공중 유닛의 고도가 그림 안에 이미 들어 있다(발밑 기준점보다 그림 아랫변이 위에 있음).
    // 그 높이가 ALT_MAX를 넘으면 넘는 만큼 그림을 내려 그린다(drop). headY = 발밑에서 머리 꼭대기까지 — 체력 바·글자·발사체 위치의 기준
    var f0 = t.frames[t.anim.idle[u.row]] || t.frames[0], lift = f0 ? Math.max(0, f0[5] - f0[3]) : 0;
    u.drop = Math.max(0, lift - C.ALT_MAX);
    u.headY = (f0 ? Math.max(t.h, f0[5]) : t.h) - u.drop;
    u.air = t.fly === 2;                                     // 공중 유닛(엔젤 나이트): 줄 서기 없이 아군 위를 지나간다 — 원본도 공중 유닛은 충돌이 없다
    u.act = basicAct(t);
    u.rangePx = (u.act ? u.act.range : 0) * C.RANGE_SCALE;
    if (u.rangePx >= 80) u.rangePx *= u.rangeK;              // 원거리: 유닛마다 조금씩 다른 거리에서 멈춘다
    // reach = "적에게 얼마나 가까이 가려는가". 줄 서기에서 reach가 짧은 유닛(근접)은 긴 유닛(원거리·지원)을 지나쳐 앞으로 나간다
    u.reach = u.act ? u.rangePx : C.SUPPORT_DIST;
    u.speedPx = t.walkPx * this.rules.tps * C.MOVE_SCALE;    // 초당 이동 px
  };

  /* 소환 검증: 지금 이 버튼으로 소환할 수 있는가. 안 되면 이유를 돌려준다 ('' = 가능)
       'max'  마법 유닛이 이미 한도만큼 전장에 있음
       'mana' 마나 부족      'wait' 다시 소환까지 대기 중 */
  P.canSummon = function (r) {
    if (r.magic && this.magicCount() >= CONFIG.MAX_MAGIC) return 'max';
    if (this.mana < r.cost) return 'mana';
    if (r.wait > 0) return 'wait';
    return '';
  };

  /* 전장에 살아 있는 마법 유닛 수 = 스킬 칸 수 (유닛이 쓰러지면 칸이 바로 없어지므로 항상 같다) */
  P.magicCount = function () { return this.slots.length; };

  /* 지금 탭의 i번째 소환 버튼을 누름 */
  P.summon = function (i) {
    var r = this.roster[this.tab][i]; if (!r || this.screen !== 'play') return false;
    var why = this.canSummon(r);
    if (why) { if (why === 'max') this._say(this.cam.x + this.W / 2, this.laneY - 120, '마법 유닛은 ' + CONFIG.MAX_MAGIC + '기까지', '#ffb36a'); return false; }
    this.mana -= r.cost; r.wait = r.cd;
    var u = this.spawn(r.id, 0);
    this._play(u.t.snd.ready, 0.8);                          // 원본 등장 음성
    return true;
  };

  /* ───────────────────────── 4. 스킬 ───────────────────────── */
  /* SkillSlot: 오른쪽 스킬 패널의 한 칸. 마법 유닛 한 기와 1:1로 묶인다.
       slot.unit → 그 유닛,  unit.slot → 이 칸
     칸의 순서(배열 위치)가 곧 화면 위치이고, 유닛 머리 위의 번호(1·2·3)와 같다. */
  function SkillSlot(unit, act) {
    this.unit = unit; this.act = act;
    this.cdMax = Math.max(6, Math.min(30, act.mana / 8));    // 쿨타임(초): 원본 마나 소모가 클수록 길게 (목업 환산)
    this.cd = CONFIG.SKILL.firstWait;                        // 소환 직후 잠깐은 못 쓴다
    this.kind = skillKind(act);
  }
  SkillSlot.prototype.ready = function () { return this.cd <= 0 && this.unit.state !== 'dead'; };

  /* 원본 행동 → 이 게임에서의 스킬 종류 */
  function skillKind(a) {
    if (a.dmg) return 'blast';                                         // 범위 피해
    if (a.sup === 'heal' || a.sup === 'massheal') return 'heal';       // 아군 회복
    if (a.sup === 'weapon' || a.sup === 'shield') return 'buff';       // 아군 공격·방어 강화
    if (a.sup === 'stone') return 'stun';                              // 적 멈춤
    if (a.sup === 'charm') return 'charm';                             // 적을 우리 편으로
    if (a.sup === 'assassin') return 'assassin';                       // 적 하나 즉사
    if (a.sup === 'morph') return 'morph';                             // 변형
    return null;
  }
  var KIND_NAME = { blast: '범위 공격', heal: '회복', buff: '강화', stun: '적 멈춤', charm: '매혹', assassin: '암살', morph: '변형' };

  /* 동적 UI 만들기: 마법 유닛이 소환될 때 */
  P._addSlot = function (u, act) { var s = new SkillSlot(u, act); u.slot = s; this.slots.push(s); return s; };

  /* 동적 UI 없애기: 마법 유닛이 쓰러질 때 — 칸을 빼면 뒤의 칸들이 앞으로 당겨진다 */
  P._removeSlot = function (u) {
    if (!u.slot) return;
    var k = this.slots.indexOf(u.slot); if (k >= 0) this.slots.splice(k, 1);
    u.slot.unit = null; u.slot = null;
  };

  /* 쿨타임 처리: 모든 칸의 남은 시간을 줄인다 */
  P._updateSlots = function (dt) { for (var i = 0; i < this.slots.length; i++) this.slots[i].cd = Math.max(0, this.slots[i].cd - dt); };

  /* 스킬 패널의 i번째 칸을 누름 → 그 칸에 묶인 유닛의 castSkill() */
  P.pressSlot = function (i) { var s = this.slots[i]; return !!(s && this.screen === 'play' && s.unit.castSkill()); };

  /* 유닛 u가 자기 스킬을 쓴다. 성공하면 칸에 쿨타임이 돈다 */
  P.castUnitSkill = function (u) {
    var s = u.slot; if (!s || !s.ready() || u.stunUntil > this.time) return false;
    var a = s.act, S = CONFIG.SKILL, self = this, ok = false, foe = this._nearestFoe(u), tps = this.rules.tps;
    var allies = function (r) { return self.units.filter(function (o) { return o.side === u.side && o.state !== 'dead' && Math.abs(o.x - u.x) <= r; }); };
    var foesAt = function (x, r) { return self.units.filter(function (o) { return o.side !== u.side && o.state !== 'dead' && Math.abs(o.x - x) <= r; }); };

    if (s.kind === 'blast' && foe) {                         // 가장 가까운 적을 중심으로 범위 피해 (원본 피해 공식 × dmgMul)
      var keep = u.act; u.act = a;
      foesAt(foe.x, a.aoe ? S.radius : 60).forEach(function (o) { self._damage(o, self.rules.damage(u, o, self.rng) * S.dmgMul); });
      u.act = keep; this._addEffect(foe.x, this.laneY, a.arm, 0); this.flash = 0.2; ok = true;
    } else if (s.kind === 'heal') {                          // 주변 아군 회복. 말다 소환(massheal)은 더 넓게, 전부 회복
      var mass = a.sup === 'massheal';
      allies(mass ? S.buffRadius * 1.5 : S.buffRadius).forEach(function (o) { var h = mass ? o.maxHp : Math.round(o.maxHp * S.healRatio), got = Math.min(o.maxHp - o.hp, h);
        o.hp += got; if (got > 0) self._say(o.x, o.y - o.t.h - 6, '+' + got, '#8fe89a'); if (!mass) self._addEffect(o.x, o.y - o.t.h * 0.5, a.arm, 0); });
      if (mass) this._addEffect(u.x, this.laneY, a.arm, 0);
      ok = true;
    } else if (s.kind === 'buff') {                          // 주변 아군에게 강화. 배수는 원본 규칙(OriginalRules)이 buffs를 보고 적용한다
      allies(S.buffRadius).forEach(function (o) { o.buffs[a.sup] = { k1: a.k1, k2: a.k2, arm: a.arm, until: self.time + (a.dur || 600) / tps }; });
      ok = true;
    } else if (s.kind === 'stun' && foe) {                   // 범위 안의 적을 잠시 멈춘다
      foesAt(foe.x, S.radius).forEach(function (o) { o.stunUntil = self.time + S.stunSec; o.state = 'idle'; });
      this._addEffect(foe.x, this.laneY, a.arm, 0); ok = true;
    } else if (s.kind === 'charm' && foe) {                  // 범위 안의 적이 우리 편이 되어 싸운다
      foesAt(foe.x, S.radius * 0.7).forEach(function (o) { self._setSide(o, u.side); o.state = 'idle'; self._say(o.x, o.y - o.t.h - 6, '매혹', '#ff9ad5'); });
      this._addEffect(foe.x, this.laneY - 20, a.arm, 0); ok = true;
    } else if (s.kind === 'assassin' && foe) {               // 가장 가까운 적 하나를 쓰러뜨린다
      this._damage(foe, foe.hp); ok = true;
    } else if (s.kind === 'morph') {                         // 다른 형태로 (엔트 ↔ 지상 엔트). 체력 비율은 유지
      var to = this.types[CONFIG.MORPH[u.t.id]];
      if (to) { var ratio = u.hp / u.maxHp; u.setType(to); u.hp = Math.max(1, Math.round(u.maxHp * ratio)); this._applyType(u); u.face(u.dir, -u.dir); ok = true; }
    }
    if (!ok) { this._say(u.x, u.y - u.t.h - 10, '대상 없음', '#c9d1e3'); return false; }
    s.cd = s.cdMax;
    this._say(u.x, u.y - u.t.h - 18, a.name, '#ffd36e');
    this._play(a.snd, 1);
    return true;
  };

  /* ───────────────────────── 5. update ───────────────────────── */
  P._frame = function (ts) {
    var dt = Math.min(0.05, (ts - this._last) / 1000 || 0); this._last = ts;   // 탭이 멈췄다 돌아와도 한 번에 0.05초까지만 진행
    if (this.screen === 'loading' && this.assets.ready()) {
      this.terrain = new MWE.TerrainRenderer(this.map, this.assets.get('tiles'));
      this._makeGround();
      this.screen = 'title';
    }
    if (this.screen === 'play' && !this.paused) this.update(dt);
    this.time += dt;
    this.draw();
  };

  P.update = function (dt) {
    var C = CONFIG, i;
    this.rules.now = this.time;                              // 강화(buffs)의 남은 시간을 규칙이 알 수 있게
    // 마나 회복, 버튼 대기 시간, 스킬 쿨타임
    this.mana = Math.min(C.MANA.max, this.mana + C.MANA.regen * dt);
    this.roster.forEach(function (list) { list.forEach(function (r) { r.wait = Math.max(0, r.wait - dt); }); });
    this._updateSlots(dt);
    this.flash = Math.max(0, this.flash - dt); this.baseHit = Math.max(0, this.baseHit - dt);

    this._updateWave(dt);
    for (i = 0; i < this.units.length; i++) this._updateUnit(this.units[i], dt);
    this._separate(dt);
    this._updateShots(dt);
    this._updateCamera(dt);

    // 사라질 것 정리: 쓰러진 뒤 다 흐려진 유닛, 끝난 이펙트·글자
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

  /* 유닛 한 기의 행동: (쓰러짐·멈춤) → 공격 동작 진행 → 닿는 적이 있으면 공격 시작 → 옆줄의 적에게 다가가기 → 줄 서기 → 전진 */
  P._updateUnit = function (u, dt) {
    var R = this.rules, C = CONFIG, tps = R.tps;
    if (u.state === 'dead') { u.deadT += dt; if (u.deadT > 1.2) u.fade = Math.min(1, u.fade + dt * 1.5); return; }
    if (u.stunUntil > this.time) { u.state = 'idle'; return; }   // 멈춤 스킬에 걸림
    u.cd = Math.max(0, u.cd - dt);

    if (u.state === 'attack') {
      // 공격 동작: 원본 애니메이션을 틱 속도(초당 12장)로 넘기다가, 중간 프레임에서 실제 타격
      var A = u.t.anim.atk, n = A ? A.n : 6, hitAt = A && A.ev != null ? A.ev : Math.floor(n * 0.6);
      u.at += dt * tps;
      if (!u.hitDone && u.at >= hitAt) { u.hitDone = true; this._strike(u); }
      if (u.at >= n) { u.state = 'idle'; u.cd = R.cooldown(u, this.rng); }
      return;
    }

    var tgt = this._nearestFoe(u), dist = tgt ? this._dist(u, tgt) : Infinity, adx = tgt ? Math.abs(tgt.x - u.x) : Infinity;
    if (u.act) {
      // 공격할 대상: 맞은편 유닛 중 가장 가까운 것. 적은 대상이 없으면 기지를 친다
      var baseDist = u.side === 1 ? u.x - C.BASE.front : Infinity;
      var canHitUnit = dist <= u.rangePx, canHitBase = !canHitUnit && baseDist <= u.rangePx;
      if (canHitUnit || canHitBase) {
        if (u.cd <= 0) { u.state = 'attack'; u.at = 0; u.hitDone = false; u.tgt = canHitUnit ? tgt : 'base'; this._play(u.act.snd, 0.5); }
        else u.state = 'idle';
        return;
      }
      // 가로로는 닿는데 세로 줄이 달라 못 때리는 적 → 그 줄 쪽으로 옮겨 간다 (적을 그냥 지나쳐 가지 않게)
      if (tgt && adx <= u.rangePx) { u.state = 'move'; u.walkT += dt; this._shiftRow(u, tgt.y, 45 * dt); return; }
    } else if (adx <= C.SUPPORT_DIST) { u.state = 'idle'; return; }   // 기본 공격이 없는 유닛은 적과 거리를 두고 선다
    // 전진 한계: 아군은 마굴 앞, 적은 성 앞 (매혹된 적은 아군 규칙)
    if (u.side === 0 && u.x >= this.frontX) { u.state = 'idle'; return; }
    if (u.side === 1 && u.x <= C.BASE.front) { u.state = 'idle'; return; }
    // 줄 서기: 같은 줄 바로 앞에 같은 편이 있으면 멈춰 기다린다. 기다리는 동안 적이 있는 줄 쪽으로 조금씩 비켜 서서 빈자리를 찾는다
    // 줄 서기와 추월: 같은 줄 바로 앞에 같은 편이 있으면 멈춰 기다린다.
    // 막힌 시간이 쌓이면(앞사람이 느려서 붙었다 떨어졌다 해도 쌓이도록 천천히 줄인다) 가까운 빈 줄을 골라 그 줄로 옮겨 가서 앞지른다
    var blocked = this._blockedAhead(u);
    if (blocked) u.blockT += dt; else u.blockT = Math.max(0, u.blockT - dt * 0.5);
    if (u.blockT >= C.PASS_WAIT && u.passY == null) { u.passY = this._freeRow(u); u.passT = 0; if (u.passY == null) u.blockT = 0; }
    if (u.passY != null) { u.passT += dt; this._shiftRow(u, u.passY, 45 * dt); if (Math.abs(u.passY - u.y) < 1 || u.passT > 2) { u.passY = null; u.blockT = 0; } }
    if (blocked) { if (u.passY != null) { u.state = 'move'; u.walkT += dt; } else u.state = 'idle'; return; }
    u.state = 'move'; u.walkT += dt; u.x += u.dir * u.speedPx * dt;
  };

  /* 두 유닛 사이의 "닿는 거리". 원거리는 가로 거리만, 근접은 세로 줄 차이도 더한다 (다른 줄의 적은 옆으로 가야 때릴 수 있다) */
  P._dist = function (u, o) { var dx = Math.abs(o.x - u.x); return u.rangePx < 80 ? dx + Math.abs(o.y - u.y) * CONFIG.ROW_WEIGHT : dx; };

  /* 세로로 y 쪽을 향해 step만큼 옮긴다 (전투 줄 범위 안에서) */
  P._shiftRow = function (u, y, step) {
    var R = CONFIG.LANE_ROWS, lo = this.laneY + R[0], hi = this.laneY + R[R.length - 1], d = y - u.y;
    var ny = Math.max(lo, Math.min(hi, u.y + Math.max(-step, Math.min(step, d)))), C = CONFIG, L = this.units;
    // 옮겨 갈 자리에 같은 편이 이미 서 있으면 그대로 둔다 (포개지지 않게)
    for (var i = 0; i < L.length; i++) { var o = L[i]; if (o === u || o.air || u.air || o.side !== u.side || o.state === 'dead') continue;
      if (Math.abs(o.x - u.x) < C.UNIT_GAP * 0.7 && Math.abs(o.y - ny) < C.ROW_NEAR && Math.abs(o.y - u.y) >= Math.abs(o.y - ny)) return; }
    u.y = ny;
  };

  /* 같은 줄, 가는 방향 바로 앞(UNIT_GAP 안)에 나를 막는 같은 편 유닛이 있는가.
     나보다 reach가 긴 유닛(원거리·지원)은 막는 것으로 치지 않는다 → 전사는 궁수·마법사·성직자를 지나쳐 앞줄로 나간다.
     정확히 같은 자리면 먼저 나온 유닛이 앞 */
  P._blockedAhead = function (u) {
    var C = CONFIG, L = this.units; if (u.air) return false;   // 공중 유닛은 막히지 않는다
    for (var i = 0; i < L.length; i++) { var o = L[i]; if (o === u || o.air || o.side !== u.side || o.state === 'dead' || Math.abs(o.y - u.y) >= C.ROW_NEAR) continue;
      if (o.reach > u.reach + 1) continue;
      var ahead = (o.x - u.x) * u.dir; if ((ahead > 0 && ahead < C.UNIT_GAP) || (ahead === 0 && o.uid < u.uid)) return true; }
    return false;
  };

  /* 추월할 줄 고르기: 지금 줄에서 가까운 순서로, 내 옆과 바로 앞에 나를 막을 같은 편이 없는 줄. 없으면 null */
  P._freeRow = function (u) {
    var C = CONFIG, L = this.units, self = this, rows = C.LANE_ROWS.map(function (r) { return self.laneY + r; })
      .filter(function (y) { return Math.abs(y - u.y) >= C.ROW_NEAR; }).sort(function (a, b) { return Math.abs(a - u.y) - Math.abs(b - u.y); });
    for (var k = 0; k < rows.length; k++) { var y = rows[k], free = true;
      for (var i = 0; i < L.length && free; i++) { var o = L[i]; if (o === u || o.air || o.side !== u.side || o.state === 'dead' || Math.abs(o.y - y) >= C.ROW_NEAR || o.reach > u.reach + 1) continue;
        var ahead = (o.x - u.x) * u.dir; if (ahead > -C.UNIT_GAP * 0.7 && ahead < C.UNIT_GAP) free = false; }
      if (free) return y; }
    return null;
  };

  /* 포개짐 풀기: 같은 편 둘이 거의 같은 자리에 서 있으면(주로 사거리 끝에서 멈춘 원거리 유닛) 나중에 온 쪽이 위아래로 조금씩 비켜 선다.
     전투 줄 끝이라 더 비킬 데가 없으면 뒤로 물러난다 */
  P._separate = function (dt) {
    var C = CONFIG, L = this.units, R = C.LANE_ROWS, lo = this.laneY + R[0], hi = this.laneY + R[R.length - 1];
    for (var i = 0; i < L.length; i++) { var u = L[i]; if (u.state === 'dead' || u.air) continue;   // 공중 유닛은 땅 위 유닛과 겹쳐도 된다
      for (var j = 0; j < L.length; j++) { var o = L[j]; if (o === u || o.air || o.side !== u.side || o.state === 'dead' || o.uid > u.uid) continue;
        var dy = u.y - o.y; if (Math.abs(u.x - o.x) >= 14 || Math.abs(dy) >= 12) continue;
        var dir = dy !== 0 ? (dy > 0 ? 1 : -1) : (u.uid % 2 ? 1 : -1), ny = u.y + dir * 30 * dt;
        if (ny < lo || ny > hi) u.x -= u.dir * 20 * dt; else u.y = ny;
        break; } }
  };

  /* 맞은편 유닛 중 가장 가까운 것 (_dist 기준) */
  P._nearestFoe = function (u) {
    var best = null, bd = Infinity, L = this.units;
    for (var i = 0; i < L.length; i++) { var o = L[i]; if (o.side === u.side || o.state === 'dead') continue;
      var d = this._dist(u, o); if (d < bd) { bd = d; best = o; } }
    return best;
  };

  /* 카메라: 손으로 움직인 직후가 아니면 전선(아군 맨 앞과 적 맨 앞 사이)을 부드럽게 따라간다 */
  P._updateCamera = function (dt) {
    var C = CONFIG, W = this.W, a = -Infinity, e = Infinity, L = this.units, target;
    if (this.drag || this.time < this.manualUntil) { this._clampCam(); return; }
    for (var i = 0; i < L.length; i++) { var o = L[i]; if (o.state === 'dead') continue; if (o.side === 0) a = Math.max(a, o.x); else e = Math.min(e, o.x); }
    if (a === -Infinity) target = e < W * 0.9 ? e - W * 0.6 : 0;             // 아군이 없다: 적이 성 근처에 올 때까지는 성을 비춘다
    else if (e - a < W * 0.8) target = (a + e) / 2 - W / 2;                    // 맞붙었다: 두 전선의 가운데
    else target = a - W * 0.35;                                               // 아군만 나아가는 중: 아군 맨 앞을 조금 앞서 본다
    this.cam.x += (target - this.cam.x) * Math.min(1, dt * C.CAM.follow);
    this._clampCam();
  };
  P._clampCam = function () { this.cam.x = Math.max(0, Math.min(CONFIG.WORLD_W - this.W, this.cam.x)); };
  /* 손으로 카메라를 옮김 (끌기·방향키·진행 막대 누르기). 잠시 동안 자동 따라가기를 멈춘다 */
  P.panTo = function (x) { this.cam.x = x; this._clampCam(); this.manualUntil = this.time + CONFIG.CAM.manualSec; };

  /* 타격 순간: 근접은 바로 피해, 원거리(행동에 발사체 arm이 있음)는 발사체를 날린다 */
  P._strike = function (u) {
    var tgt = u.tgt, R = this.rules;
    if (tgt === 'base') { this._hitBase(R.attackValue(u)); return; }
    if (!tgt || tgt.state === 'dead' || tgt.side === u.side) return;
    var dmg = R.damage(u, tgt, this.rng), arm = u.act.arm, def = arm >= 0 ? this.data.fx.arms[arm] : null;
    if (def) this.shots.push({ x: u.x + u.dir * 14, y: u.y - u.headY * 0.6, tgt: tgt, dmg: dmg, arm: arm, def: def, dir: u.dir, t0: this.time, speed: 380 });
    else this._damage(tgt, dmg);
  };

  P._damage = function (u, dmg) {
    if (u.state === 'dead') return;
    this._say(u.x, u.y - u.headY - 6, dmg > 0 ? String(dmg) : 'miss', u.side === 1 ? '#ffe9a8' : '#ff9a8a');
    if (dmg <= 0) return;
    u.hp -= dmg;
    if (u.hp <= 0) {
      u.hp = 0; u.state = 'dead'; u.deadT = 0; u.fade = 0; u.buffs = {};
      this._removeSlot(u);                                   // 마법 유닛이면 스킬 칸도 함께 없앤다 → 소환 버튼이 다시 켜진다
      this._play(u.t.snd.die, 0.7);
      if (u.side === 1) { this.kills++; this.mana = Math.min(CONFIG.MANA.max, this.mana + CONFIG.MANA.perKill); }
    }
  };

  P._hitBase = function (dmg) { this.baseHp -= dmg; this.baseHit = 0.25; this._say(CONFIG.BASE.front - 50, this.laneY - 70, '-' + dmg, '#ff7a6a'); };

  /* 떠오르는 글자 하나 (피해량, 회복량, 스킬 이름 …) */
  P._say = function (x, y, s, col) { this.texts.push({ x: x, y: y, s: s, t0: this.time, col: col }); };

  /* 발사체: 대상을 향해 날아가 닿으면 피해 + 명중 이펙트 */
  P._updateShots = function (dt) {
    var keep = [];
    for (var i = 0; i < this.shots.length; i++) {
      var s = this.shots[i], t = s.tgt, tx = t.x, ty = t.y - t.headY * 0.5, dx = tx - s.x, dy = ty - s.y, d = Math.hypot(dx, dy), step = s.speed * dt;
      if (d <= step || t.state === 'dead') {
        if (t.state !== 'dead') { this._damage(t, s.dmg); if (s.def.hit.length) this._addEffect(tx, ty, s.arm, 0); }
        continue;
      }
      s.x += dx / d * step; s.y += dy / d * step; s.ang = Math.atan2(dy, dx); keep.push(s);
    }
    this.shots = keep;
  };

  P._addEffect = function (x, y, arm, delay) {
    var d = this.data.fx.arms[arm], fr = d && (d.hit.length ? d.hit : d.fly);
    if (fr && fr.length) this.effects.push({ x: x, y: y, f: fr, t0: this.time + (delay || 0), add: !d.dir });
  };

  P._play = function (id, vol) { if (this.soundOn && id != null && id >= 0) this.sfx.play(id, vol); };

  /* ───────────────────────── 6. draw ───────────────────────── */
  P.draw = function () {
    var ctx = this.ctx, W = this.W, H = this.H;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0b0d12'; ctx.fillRect(0, 0, W, H);
    if (this.screen === 'loading') { this._center(this.assets.failed ? '그림을 불러오지 못했습니다: ' + this.assets.failed : '불러오는 중…', H / 2, 16, '#c9d1e3'); return; }

    this._drawGround();
    // 전장 층: 여기서부터는 전장 좌표로 그린다 (카메라만큼 왼쪽으로 밀고, 아래 패널 영역은 잘라낸다)
    var camX = Math.round(this.cam.x), vx0 = camX - 120, vx1 = camX + W + 120, i;
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H - CONFIG.HUD_H); ctx.clip(); ctx.translate(-camX, 0);
    this._drawBases();
    // 유닛: 화면에 보이는 것만, 아래쪽(y가 큰) 유닛이 위에 그려지도록 정렬
    var L = this.units.filter(function (u) { return u.x > vx0 && u.x < vx1; }).sort(function (a, b) { return a.y - b.y; });
    for (i = 0; i < L.length; i++) this._drawUnit(L[i]);
    for (i = 0; i < this.shots.length; i++) this._drawShot(this.shots[i]);
    for (i = 0; i < this.effects.length; i++) this._drawEffect(this.effects[i]);
    this._drawTexts();
    ctx.restore();
    if (this.flash > 0) { ctx.fillStyle = 'rgba(255,240,200,' + (this.flash * 0.9) + ')'; ctx.fillRect(0, 0, W, H - CONFIG.HUD_H); }
    this._drawHud();
    if (this.screen !== 'play') this._drawOverlay();
  };

  /* 바닥 무늬 만들기: 원본 맵에서 장애물 없는 평지 한 조각(GW × GH)을 떠 온다.
     원본 타일은 가로 64 · 세로 32 간격의 마름모라서, 그 배수 크기로 뜬 조각은 이어 붙여도 타일 모양이 어긋나지 않는다.
     (맵을 그대로 깔면 2000px 안에 절벽·맵 가장자리가 들어와서, 평지 조각을 되풀이해 긴 전장을 만든다) */
  var GW = 448, GH = 192;
  P._makeGround = function () {
    var map = this.map, c = map.t2w(map.arena[0], map.arena[1]), cv = document.createElement('canvas'); cv.width = GW; cv.height = GH;
    var g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
    this.terrain.draw(g, { x: Math.round(c[0] / 64) * 64 - GW / 2, y: Math.round(c[1] / 32) * 32 - GH / 2 }, GW, GH);
    this.ground = cv;
  };

  /* 배경: 평지 조각을 카메라에 맞춰 이어 깔고, 전투 줄을 살짝 어둡게 표시 */
  P._drawGround = function () {
    var ctx = this.ctx, W = this.W, gh = this.H - CONFIG.HUD_H, rows = CONFIG.LANE_ROWS, top = this.laneY + rows[0] - 40, bot = this.laneY + rows[rows.length - 1] + 30;
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, gh); ctx.clip();
    for (var x = -(Math.round(this.cam.x) % GW); x < W; x += GW) for (var y = 0; y < gh; y += GH) ctx.drawImage(this.ground, x, y);
    var g = ctx.createLinearGradient(0, top, 0, bot);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(0,0,0,.2)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, top, W, bot - top);
    ctx.restore();
  };

  /* 아군 기지(왼쪽 성)와 적 출구(오른쪽 마굴): 원본 건물 그림. 그림의 기준점(ax, ay = 땅에 닿는 앞쪽 모서리)을 전투 줄 바로 아래에 맞춘다 */
  P._drawBases = function () {
    var ctx = this.ctx, C = CONFIG, img = this.assets.get('defense'), B = this.bld.base, L = this.bld.lair, gy = this.laneY + 44;
    if (B) { var sh = this.baseHit > 0 ? Math.round(Math.sin(this.time * 90) * 2) : 0;                  // 맞으면 살짝 흔들린다
      ctx.drawImage(img, B.x, B.y, B.w, B.h, C.BASE.x - B.ax + sh, gy - B.ay, B.w, B.h); }
    if (L) { var lx = C.WORLD_W - C.LAIR.back;
      ctx.drawImage(img, L.x, L.y, L.w, L.h, lx - L.ax, gy - L.ay, L.w, L.h);
      // 마굴 입구의 으스스한 빛 (가산 합성으로 깜박임)
      var gx = lx - L.w * 0.16, gcy = gy - L.h * 0.30, g = ctx.createRadialGradient(gx, gcy, 2, gx, gcy, 46);
      g.addColorStop(0, 'rgba(190,90,220,' + (0.30 + 0.16 * Math.sin(this.time * 3)) + ')'); g.addColorStop(1, 'rgba(190,90,220,0)');
      ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g; ctx.fillRect(gx - 46, gcy - 46, 92, 92); ctx.globalCompositeOperation = 'source-over'; }
  };

  /* 유닛 한 기: 그림자 → 강화 이펙트 → 원본 스프라이트(Unit.frameIndex가 고른 프레임) → 체력 바 → 스킬 칸 번호 */
  P._drawUnit = function (u) {
    var ctx = this.ctx, fi = u.frameIndex(this.rules.tps), f = fi >= 0 ? u.t.frames[fi] : null, x = Math.round(u.x), y = Math.round(u.y), drop = u.drop || 0, T = this.time;
    if (!f) return;
    ctx.globalAlpha = u.state === 'dead' ? 1 - u.fade : 1;
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(x, y + 2, 13, 5, 0, 0, 6.3); ctx.fill();
    // 발밑 편 표시: 아군 파랑, 적 빨강 (난전에서 한눈에 구분되게)
    if (u.state !== 'dead') { ctx.strokeStyle = u.side === 0 ? 'rgba(90,170,255,.9)' : 'rgba(255,90,70,.9)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(x, y + 2, 14, 6, 0, 0, 6.3); ctx.stroke(); }
    // 공격 강화(웨폰): 발밑에서 도는 원본 이펙트. 방어 강화(베리어)는 몸 가운데 높이 — 전장 시뮬(worldview.js)과 같은 방식
    var wb = u.buffs.weapon, sb = u.buffs.shield;
    if (wb && wb.until > T) this._loopFx(wb.arm, x, y);
    ctx.save(); ctx.translate(x, y + drop); if (u.mir) ctx.scale(-1, 1);
    if (u.stunUntil > T) ctx.filter = 'grayscale(1) brightness(1.25)';   // 멈춘 적은 돌처럼 회색으로 (지원하지 않는 브라우저에서는 그대로 보인다)
    ctx.drawImage(this.assets.get(f[6] || ('u' + u.t.id)), f[0], f[1], f[2], f[3], -f[4], -f[5], f[2], f[3]);
    ctx.restore(); ctx.globalAlpha = 1;
    if (sb && sb.until > T) this._loopFx(sb.arm, x, y - (sb.arm === 7 || sb.arm === 43 ? u.headY : u.headY >> 1));
    if (u.state === 'dead') return;
    var top = y - u.headY - 8;
    if (u.hp < u.maxHp) this._bar(x - 15, top, 30, 4, u.hp / u.maxHp, u.side === 0 ? '#5fd46a' : '#e0584a');
    // 마법 유닛: 스킬 패널의 몇 번째 칸과 묶였는지 머리 위에 번호로
    if (u.slot) { var k = this.slots.indexOf(u.slot) + 1, by = top - 12;
      ctx.fillStyle = u.slot.ready() ? '#ffd36e' : '#59607a'; ctx.beginPath(); ctx.arc(x, by, 7, 0, 6.3); ctx.fill();
      ctx.fillStyle = '#10131b'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(k, x, by + 0.5); ctx.textAlign = 'left'; }
  };

  /* 계속 도는 이펙트 한 장 (유닛에 붙은 강화 표시) */
  P._loopFx = function (arm, x, y) {
    var d = this.data.fx.arms[arm], fr = d && (d.fly.length ? d.fly : d.hit); if (!fr || !fr.length) return;
    this._fxFrame(fr[Math.floor(this.time * 15) % fr.length], x, y, !d.dir);
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

  /* HUD: 위 = 기지 체력·마나·웨이브·소리, 아래 왼쪽 = 소환 패널, 아래 오른쪽 = 스킬 패널 */
  P._drawHud = function () {
    var ctx = this.ctx, W = this.W, H = this.H, C = CONFIG;
    // 위 왼쪽: 기지 체력과 마나
    ctx.font = 'bold 12px sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(8, 8, 200, 46);
    ctx.fillStyle = '#dfe6f5'; ctx.fillText('기지', 16, 21);
    this._bar(50, 15, 110, 12, this.baseHp / C.BASE.hp, this.baseHp / C.BASE.hp > 0.35 ? '#5fd46a' : '#e0584a');
    ctx.fillStyle = '#fff'; ctx.textAlign = 'right'; ctx.fillText(Math.ceil(this.baseHp), 202, 21);
    ctx.textAlign = 'left'; ctx.fillStyle = '#8fc7ff'; ctx.fillText('마나', 16, 41);
    this._bar(50, 35, 110, 12, this.mana / C.MANA.max, '#3f8fe8');
    ctx.fillStyle = '#fff'; ctx.textAlign = 'right'; ctx.fillText(Math.floor(this.mana), 202, 41);
    // 위 가운데: 웨이브
    var wv = Math.min(this.wave + 1, C.WAVES.length), left = this._alive(1).length + this.queue.length;
    ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(W / 2 - 80, 8, 160, 26);
    ctx.fillStyle = '#ffd36e'; ctx.fillText('웨이브 ' + wv + ' / ' + C.WAVES.length + '   남은 적 ' + left, W / 2, 21);
    this._drawMini();
    // 위 오른쪽: 소리
    var sb = this.soundBtn; ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(sb.x, sb.y, sb.w, sb.h);
    ctx.fillStyle = this.soundOn ? '#dfe6f5' : '#6f7687'; ctx.fillText(this.soundOn ? '소리' : '무음', sb.x + sb.w / 2, sb.y + sb.h / 2);

    // 아래 바탕
    var y0 = H - C.HUD_H; ctx.fillStyle = '#12151d'; ctx.fillRect(0, y0, W, C.HUD_H); ctx.fillStyle = '#2a3040'; ctx.fillRect(0, y0, W, 2);
    this._drawSummonPanel();
    this._drawSkillPanel();
    ctx.textAlign = 'left';
  };

  /* 진행 막대: 전장 전체(성 ― 마굴)를 한 줄로 줄여 아군(파랑)·적(빨강) 위치와 지금 화면이 비추는 구간(흰 테두리)을 보여 준다. 누르면 그곳으로 */
  P._drawMini = function () {
    var ctx = this.ctx, C = CONFIG, m = this.miniBox, k = m.w / C.WORLD_W, L = this.units, cy = m.y + m.h / 2;
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(m.x - 4, m.y - 2, m.w + 8, m.h + 4);
    ctx.fillStyle = '#2a3040'; ctx.fillRect(m.x, cy - 1, m.w, 2);
    ctx.fillStyle = '#9fb4d8'; ctx.fillRect(m.x, m.y + 1, 6, m.h - 2);                       // 성
    ctx.fillStyle = '#a060c0'; ctx.fillRect(m.x + m.w - 6, m.y + 1, 6, m.h - 2);             // 마굴
    for (var i = 0; i < L.length; i++) { var u = L[i]; if (u.state === 'dead') continue;
      ctx.fillStyle = u.side === 0 ? '#5aaaff' : '#ff5a46'; ctx.fillRect(Math.round(m.x + u.x * k) - 1, cy + (u.side === 0 ? -4 : 1), 3, 3); }
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.strokeRect(Math.round(m.x + this.cam.x * k) + 0.5, m.y + 0.5, Math.round(this.W * k), m.h - 1);
  };

  /* 왼쪽 소환 패널: 탭 + 지금 탭의 유닛 버튼. 버튼 = 원본 유닛 작은 그림(figs.png, 유닛 번호 × 36px) + 이름 + 마나 값 */
  P._drawSummonPanel = function () {
    var ctx = this.ctx, C = CONFIG, i, figs = this.assets.get('figs'), list = this.roster[this.tab], full = this.magicCount() >= C.MAX_MAGIC;
    ctx.textBaseline = 'middle';
    for (i = 0; i < this.tabBoxes.length; i++) { var tb = this.tabBoxes[i], on = i === this.tab;
      ctx.fillStyle = on ? '#2c3550' : '#181c27'; ctx.fillRect(tb.x, tb.y, tb.w, tb.h);
      if (on) { ctx.fillStyle = '#c9a35a'; ctx.fillRect(tb.x, tb.y + tb.h - 2, tb.w, 2); }
      ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = on ? '#ffe9b0' : '#8a93a8'; ctx.fillText(C.TABS[i].name, tb.x + tb.w / 2, tb.y + tb.h / 2); }
    for (i = 0; i < list.length; i++) {
      var b = this.btnBoxes[i], r = list[i], why = this.canSummon(r), ok = !why, cx = b.x + b.w / 2;
      ctx.fillStyle = ok ? '#232a3a' : '#191d27'; ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = ok ? (r.magic ? '#7fb6ff' : '#c9a35a') : '#3a4152'; ctx.lineWidth = 2; ctx.strokeRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2);
      ctx.globalAlpha = ok ? 1 : why === 'max' ? 0.25 : 0.5; ctx.drawImage(figs, r.t.pid * 36, 0, 36, 43, Math.round(cx - 18), b.y + 2, 36, 43); ctx.globalAlpha = 1;
      if (r.wait > 0) { ctx.fillStyle = 'rgba(0,0,0,.6)'; var ch = b.h * r.wait / r.cd; ctx.fillRect(b.x, b.y + b.h - ch, b.w, ch); }
      ctx.textAlign = 'center';
      ctx.font = '9px sans-serif'; ctx.fillStyle = ok ? '#dfe6f5' : '#7b8397'; ctx.fillText(r.t.name, cx, b.y + 50);
      ctx.font = 'bold 11px sans-serif'; ctx.fillStyle = this.mana >= r.cost ? '#8fc7ff' : '#e0584a'; ctx.fillText(r.cost, cx, b.y + 61);
      ctx.font = '9px sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = '#8a93a8'; ctx.fillText(i + 1, b.x + 4, b.y + 8);
      if (r.magic) { ctx.textAlign = 'right'; ctx.fillStyle = '#7fb6ff'; ctx.fillText('마법', b.x + b.w - 4, b.y + 8); }
      // 마법 유닛 한도에 닿음: 버튼을 어둡게 덮고 "최대" 표시 (눌러도 소환되지 않는다)
      if (r.magic && full) { ctx.fillStyle = 'rgba(8,10,16,.55)'; ctx.fillRect(b.x + 2, b.y + 2, b.w - 4, b.h - 4);
        ctx.textAlign = 'center'; ctx.font = 'bold 11px sans-serif'; ctx.fillStyle = '#ffb36a'; ctx.fillText('최대', cx, b.y + 22); ctx.font = '9px sans-serif'; ctx.fillText(C.MAX_MAGIC + ' / ' + C.MAX_MAGIC, cx, b.y + 35); }
    }
  };

  /* 오른쪽 스킬 패널: 칸 MAX_MAGIC개. 채워진 칸 = 전장의 마법 유닛과 묶인 SkillSlot, 빈 칸 = 점선 */
  P._drawSkillPanel = function () {
    var ctx = this.ctx, C = CONFIG, D = this.data.fx.icon, icons = this.assets.get('acticons'), p = this.skillPanel, KEYS = ['A', 'S', 'D'];
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.font = 'bold 11px sans-serif';
    ctx.fillStyle = this.magicCount() >= C.MAX_MAGIC ? '#ffb36a' : '#7fb6ff'; ctx.fillText('마법 유닛 ' + this.magicCount() + ' / ' + C.MAX_MAGIC, p.x, p.y + p.h / 2);
    for (var i = 0; i < this.slotBoxes.length; i++) {
      var b = this.slotBoxes[i], s = this.slots[i], cx = b.x + b.w / 2;
      if (!s) { ctx.strokeStyle = '#2f3647'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.strokeRect(b.x + 1.5, b.y + 1.5, b.w - 3, b.h - 3); ctx.setLineDash([]);
        ctx.textAlign = 'center'; ctx.font = '9px sans-serif'; ctx.fillStyle = '#4a5268'; ctx.fillText('빈 칸', cx, b.y + b.h / 2); continue; }
      var ok = s.ready(), a = s.act, fi = a.icon * 2;
      ctx.fillStyle = ok ? '#3a2a12' : '#191d27'; ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = ok ? '#ffd36e' : '#3a4152'; ctx.lineWidth = 2; ctx.strokeRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2);
      ctx.globalAlpha = ok ? 1 : 0.45; ctx.drawImage(icons, (fi % D.cols) * D.w, Math.floor(fi / D.cols) * D.h, D.w, D.h, Math.round(cx - D.w / 2), b.y + 1, D.w, D.h); ctx.globalAlpha = 1;
      if (s.cd > 0) {                                        // 쿨타임: 위에서부터 걷히는 가림막 + 남은 초
        ctx.fillStyle = 'rgba(0,0,0,.62)'; var ch = b.h * s.cd / s.cdMax; ctx.fillRect(b.x, b.y, b.w, ch);
        ctx.textAlign = 'center'; ctx.font = 'bold 15px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(Math.ceil(s.cd), cx, b.y + 24); }
      ctx.textAlign = 'center'; ctx.font = '9px sans-serif'; ctx.fillStyle = '#dfe6f5'; ctx.fillText(s.unit.t.name, cx, b.y + 50);
      ctx.fillStyle = ok ? '#ffd36e' : '#7b8397'; ctx.fillText(KIND_NAME[s.kind] || a.name, cx, b.y + 61);
      ctx.textAlign = 'left'; ctx.fillStyle = '#8a93a8'; ctx.fillText((i + 1) + ' ' + KEYS[i], b.x + 4, b.y + 8);
    }
  };

  /* 시작 / 승리 / 패배 화면 */
  P._drawOverlay = function () {
    var ctx = this.ctx, W = this.W, H = this.H, sc = this.screen;
    ctx.fillStyle = 'rgba(5,7,12,.72)'; ctx.fillRect(0, 0, W, H);
    if (sc === 'title') { this._center('거울전쟁 디펜스', H / 2 - 60, 30, '#ffd36e'); this._center('해골 군단을 막아 성을 지키세요', H / 2 - 22, 14, '#dfe6f5');
      this._center('왼쪽 아래에서 해방부대 유닛을 소환합니다 (탭으로 종류 바꾸기)', H / 2 + 4, 12, '#9aa3b8');
      this._center('마법 유닛은 3기까지 — 소환하면 오른쪽 아래에 그 유닛의 스킬 칸이 생깁니다', H / 2 + 22, 12, '#9aa3b8'); this._center('전장은 좌우로 깁니다 — 화면을 끌거나 위쪽 막대를 눌러 둘러보세요', H / 2 + 40, 12, '#9aa3b8'); this._center('화면을 눌러 시작', H / 2 + 76, 16, '#fff'); }
    else if (sc === 'win') { this._center('스테이지 클리어!', H / 2 - 30, 30, '#8fe89a'); this._center('처치 ' + this.kills + '   ·   남은 기지 체력 ' + Math.ceil(this.baseHp), H / 2 + 8, 14, '#dfe6f5'); this._center('화면을 눌러 다시 하기', H / 2 + 50, 16, '#fff'); }
    else if (sc === 'lose') { this._center('게임 오버', H / 2 - 30, 30, '#ff7a6a'); this._center('웨이브 ' + Math.min(this.wave + 1, CONFIG.WAVES.length) + ' 에서 기지가 무너졌습니다', H / 2 + 8, 14, '#dfe6f5'); this._center('화면을 눌러 다시 하기', H / 2 + 50, 16, '#fff'); }
  };

  P._center = function (s, y, size, col) { var ctx = this.ctx; ctx.font = 'bold ' + size + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = col; ctx.fillText(s, this.W / 2, y); ctx.textAlign = 'left'; };

  /* ───────────────────────── 7. 입력 ───────────────────────── */
  /* 화면에서 누른 위치 → 게임 안 좌표. 캔버스가 화면에 맞춰 늘어나 있고(object-fit: contain) 남는 곳은 여백이므로 그만큼 보정한다 */
  P._pos = function (e) {
    var r = this.cv.getBoundingClientRect(), k = Math.min(r.width / this.W, r.height / this.H);
    return [(e.clientX - r.left - (r.width - this.W * k) / 2) / k, (e.clientY - r.top - (r.height - this.H * k) / 2) / k];
  };
  function inBox(b, x, y) { return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h; }

  P._tap = function (x, y) {
    var i;
    this.sfx.unlock();                                       // 브라우저는 첫 터치 뒤에만 소리를 허락한다
    if (inBox(this.soundBtn, x, y)) { this.toggleSound(); return; }
    if (this.screen === 'title') { this.start(); return; }
    if (this.screen === 'win' || this.screen === 'lose') { this.reset(); this.screen = 'play'; return; }
    if (this.screen !== 'play') return;
    for (i = 0; i < this.tabBoxes.length; i++) if (inBox(this.tabBoxes[i], x, y)) { this.tab = i; return; }
    for (i = 0; i < this.roster[this.tab].length; i++) if (inBox(this.btnBoxes[i], x, y)) { this.summon(i); return; }
    for (i = 0; i < this.slotBoxes.length; i++) if (inBox(this.slotBoxes[i], x, y)) { this.pressSlot(i); return; }
  };

  /* 진행 막대를 누르거나 그 위에서 끌면: 그 지점이 화면 가운데에 오도록 카메라를 옮긴다 */
  P._miniPan = function (x) { var m = this.miniBox; this.panTo((x - m.x) / m.w * CONFIG.WORLD_W - this.W / 2); };

  P.start = function () {
    this.reset(); this.screen = 'play';
    if (this.soundOn && !this.bgm.on) { this.bgm.set(0); this.bgm.toggle(); }
    // 휴대폰: 전체 화면 + 가로 고정을 시도한다 (지원하지 않는 브라우저에서는 조용히 넘어간다)
    try { var el = document.documentElement, p = root.matchMedia && root.matchMedia('(pointer: coarse)').matches && el.requestFullscreen ? el.requestFullscreen() : null;
      if (p && p.then) p.then(function () { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(function () {}); }).catch(function () {}); } catch (err) {}
  };

  P.toggleSound = function () { this.soundOn = !this.soundOn; this.sfx.on = this.soundOn; if (this.bgm.on !== this.soundOn && this.screen !== 'title') this.bgm.toggle(); };

  /* 단축키 (PC): 1~7 소환, Q·W·E·R 탭, A·S·D 스킬 칸, ←·→ 카메라, M 소리, 스페이스·엔터 시작/다시 하기 */
  P._bind = function () {
    var self = this, cv = this.cv;
    /* 누르기: 버튼이면 바로 실행, 진행 막대면 그곳으로 이동, 전장이면 끌어서 카메라 옮기기 시작 */
    cv.addEventListener('pointerdown', function (e) {
      e.preventDefault(); var p = self._pos(e), x = p[0], y = p[1], m = self.miniBox;
      if (self.screen === 'play' && x >= m.x - 6 && x <= m.x + m.w + 6 && y >= m.y - 6 && y <= m.y + m.h + 6) { self.drag = { mini: true, id: e.pointerId }; self._miniPan(x); return; }
      if (self.screen === 'play' && y < self.H - CONFIG.HUD_H && !inBox(self.soundBtn, x, y)) { self.sfx.unlock(); self.drag = { x: x, cam: self.cam.x, id: e.pointerId }; try { cv.setPointerCapture(e.pointerId); } catch (err) {} return; }
      self._tap(x, y);
    });
    cv.addEventListener('pointermove', function (e) {
      var d = self.drag; if (!d || d.id !== e.pointerId) return; var p = self._pos(e);
      if (d.mini) self._miniPan(p[0]); else self.panTo(d.cam - (p[0] - d.x));           // 손가락을 따라 전장이 끌려온다
    });
    var endDrag = function (e) { if (self.drag && self.drag.id === e.pointerId) self.drag = null; };
    cv.addEventListener('pointerup', endDrag); cv.addEventListener('pointercancel', endDrag);
    cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    root.addEventListener('resize', function () { self._resize(); });
    root.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); if (self.screen === 'play') self.panTo(self.cam.x + (e.key === 'ArrowLeft' ? -90 : 90)); return; }
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      var kc = /^Key[A-Z]$/.test(e.code) ? e.code.charAt(3) : null;   // 한글 입력 상태와 상관없이 자판 위치로
      if (e.code === 'Space' || e.key === 'Enter') { e.preventDefault(); if (self.screen !== 'play' && self.screen !== 'loading') self._tap(-1, -1); return; }
      self.sfx.unlock();
      if (/^Digit[1-9]$/.test(e.code)) { self.summon(+e.code.charAt(5) - 1); return; }
      var ti = 'QWER'.indexOf(kc), si = 'ASD'.indexOf(kc);
      if (kc && ti >= 0 && ti < CONFIG.TABS.length) self.tab = ti;
      else if (kc && si >= 0) self.pressSlot(si);
      else if (kc === 'M') self.toggleSound();
    });
    // 다른 탭으로 가면 멈춘다
    document.addEventListener('visibilitychange', function () { self.paused = document.hidden; });
  };

  DefenseGame.CONFIG = CONFIG; DefenseGame.SkillSlot = SkillSlot;
  MWE.DefenseGame = DefenseGame;
})(window);
