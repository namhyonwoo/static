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
     - 마법 유닛: 마법(마나를 쓰는 원본 행동)을 가진 유닛. 전장에 동시에 MAX_MAGIC(3)기까지만.
       소환되면 그 유닛의 마법 전부가 오른쪽 아래 스킬 패널에 칸(SkillSlot)으로 생기고, 쓰러지면 그 칸들도 사라진다.
       칸이 3개를 넘으면 패널을 좌우로 넘겨 본다(캐러셀).
       스킬 패널 위의 유닛 칩을 두 번 누르면 그 유닛을 회수한다(recall) — 마나를 일부 돌려받고 자리가 빈다.
     - 성 배치(건물 원거리 공격): 원본 규칙(분석 8-35) — 건물은 스스로 공격하지 않고, 안에 든 "건물 무기 등급" 유닛이 건물에서 쏜다.
       [성 배치]를 켜고 궁수·명궁·창검사·마법사·장로를 소환하면 전장 대신 성에 들어가 무기가 전개되고, 사거리 안의 적(공중 포함)을 쏜다.
       정령사·연금술사·마법전사·마법기사는 성 안에서 사격 피해를 올려 준다.
     - 공중 유닛(엔젤 나이트): 지상 유닛 위를 그냥 지나가고, 지상 근접 유닛은 공중 유닛을 때리지 못한다.

   화면: 가로 모드와 세로 모드를 모두 지원한다. 게임 안 크기(W × H)는 기기에 맞춰 정하고(CONFIG.SCREEN, _resize), 버튼 배치는 _layout이 모드별로 짠다.
   전장은 화면보다 긴 가로 WORLD_W(2000px)이고, 카메라(cam.x)가 좌우로 움직이며 그 일부를 비춘다.
     유닛·건물·이펙트의 x = 전장 좌표,  화면 x = 전장 x − cam.x
   전투는 왼쪽(아군 기지) ↔ 오른쪽(적 출구) 사이에서 벌어지고, 유닛은 세로 5줄에 나뉘어 선다. */
(function (root) {
  'use strict';
  var MWE = root.MWE;

  /* ───────────────────────── 1. CONFIG ───────────────────────── */
  var CONFIG = {
    /* 화면 크기 정하기 (_resize). "게임 안 크기" = 실제 화면 크기 ÷ 확대 배수. 게임 안 크기가 작을수록 유닛·버튼이 크게 보인다.
         이 게임은 **세로 전용**이다(아이폰의 세로 고정 앱처럼). 세로 화면: 가로 = 화면 가로 ÷ portZoom (아이폰 12 → 390, 1배), 세로는 화면 비율대로.
         가로 화면·PC: 배치를 바꾸지 않고 기준 크기(refW × refH = 아이폰 12 세로)를 그대로 쓴다 — CSS object-fit: contain 이 가운데에 세워 놓고 좌우는 검은 여백.
         (2026-11-12 사용자 요청: 가로 배치는 전장이 낮아 답답해서 없앰) */
    SCREEN: { portZoom: 1, portMinW: 340, portMaxW: 520, portMinH: 560, portMaxH: 1000, refW: 390, refH: 844 },
    WORLD_W: 2000,               // 전장 전체 가로 길이(px). 화면보다 길어서 카메라가 좌우로 움직인다
    LANE_ROWS: [-136, -102, -68, -34, 0, 34, 68, 102, 136],   // 유닛이 서는 세로 줄 9개 (전투 줄 중심에서의 거리). 세로 전용 화면의 남는 높이를 써서 접촉면을 넓힌다 — 전에는 5줄 ±56
    PACK: { bands: 3, min: 3, max: 5 },   // 적은 3~5기씩 무리를 지어 위·가운데·아래 중 한 띠로 나온다 (무리마다 띠가 바뀐다) — 범위 마법을 어느 무리에 쓸지 고르게
    UNIT_GAP: 30,                // 줄 서기: 같은 편 앞사람과 벌려 두는 간격(px)
    ROW_NEAR: 18,                // 세로로 이만큼 안이면 "같은 줄"로 본다
    /* 에워싸기(근접 유닛): 적이 engage(px) 안에 들어오면 줄을 풀고 그 적에게 바로 다가가 사방에서 친다.
       yScale = 세로 거리를 가로보다 얼마나 멀게 칠지(비스듬한 화면이라 세로가 눌려 보인다), personal = 같은 편끼리 벌리는 거리 */
    SURROUND: { engage: 220, yScale: 1.3, personal: 26, slots: 8, skipSec: 4, detour: 52, holdDist: 85 },   // holdDist = 나를 둘러싸러 오는 적이 이 거리 안에 왔을 때부터 제자리를 지킨다   // slots = 적 하나를 둘러싸는 자리 수, 자리가 다 차면 skipSec 동안 그 적을 두고 detour(px)만큼 비켜 돌아간다
    PASS_LOOK: 2.5,              // 앞지르기 미리 보기: 같은 줄 앞쪽 UNIT_GAP × 이 값 안에 나보다 느리게 걷는 같은 편이 있으면, 붙어서 멈추기 전에 걸어가면서 옆줄로 비켜 앞지른다 (0 = 끔)
    PASS_WAIT: 0.5,              // 앞사람에게 이만큼(초) 막혀 있으면 빈 옆줄로 추월을 시도한다
    ALT_MAX: 16,                 // 공중 유닛이 땅에서 떠 보이는 높이의 한도(px). 원본 그림은 엔젤 나이트가 100px 넘게 떠 있어 위쪽 표시를 가린다
    RANGE_SPREAD: 0.2,           // 원거리 유닛마다 서는 거리를 사거리의 (1 − 이 값)~1배 사이에서 다르게 (한 줄로 뭉치지 않게)
    CAM: { follow: 2.5, manualSec: 5, skillSec: 2.5, skillSpeed: 7 },   // skillSec = 내 마법을 쓴 뒤 그 지점을 비추는 시간(초), skillSpeed = 그리로 미끄러져 가는 빠르기   // 카메라: 전선을 따라가는 빠르기, 손으로 움직인 뒤 자동으로 돌아오기까지(초)
    BASE: { hp: 600, x: 78, front: 196 },   // 아군 기지(성): 체력, 그림 기준점의 가로 위치, 성 앞 선(아군이 나오고 적이 멈춰 때리는 곳)
    LAIR: { back: 74, mouth: 150 },         // 적 출구(마굴): 그림 기준점이 화면 오른쪽 끝에서 떨어진 거리, 적이 나오는 입구까지의 거리
    MANA: { max: 300, start: 80, regen: 12, perKill: 6 },   // 마나: 최대, 시작, 초당 회복, 처치 보상
    MOVE_SCALE: 0.45,            // 원본 걷기 속도(px/틱)를 이 게임 속도로 줄이는 배수
    RANGE_SCALE: 0.07,           // 원본 사거리 → 화면 px (근접 700 → 49px, 원거리 3000 → 210px)
    ENEMY_HP_MUL: 1.1,             // 적 체력 배수 (원본 해골전사는 체력 50이라 한 방에 쓰러진다)
    COST_PER_GOLD: 0.45,         // 소환 마나 = 원본 생산 비용(금) × 이 값 (5 단위로 반올림)
    MAX_MAGIC: 3,                // 마법 유닛 동시 소환 한도
    /* 회수: 마법 유닛을 전장에서 거둬들여 자리를 비운다. 마나 환급 = 소환 값 × refund × 남은 체력 비율.
       confirmSec = 칩을 한 번 누른 뒤 "회수"로 바뀌어 있는 시간(이 안에 한 번 더 눌러야 회수), fxArm·snd = 사라질 때의 원본 이펙트 칸·소리(텔레포테이션) */
    RECALL: { refund: 0.5, confirmSec: 2, fxArm: 3, snd: 5018 },
    /* 성 배치 = 건물 원거리 공격 (원본 FUN_004d0a40 / FUN_004d1760 / FUN_004a69e0, 분석 8-35).
       등급(유닛 종류의 unitdata +0x2B2 — sim/defense.js 의 MW_DEF.units 에 구워 둠)별로:
         act   = 쏘는 원본 행동 번호 (4 활 쏘기, 15 파이어 볼)        mod·step = 사격 틱 조건: tick % mod == 자리 번호 × step
         deploy = 무기가 전개되는 틱 수 (그동안은 못 쏜다)             loop = 가동 중 되풀이하는 그림 수
       사거리 = (4000 + 건물 사거리 보정 × 10) × RANGE_SCALE,  피해 = 원본 피해 공식 + 성 안 유닛들의 건물 공격 보너스 합 */
    GARRISON: { tps: 12, shotSpeed: 420, classes: { 4: { act: 4, from: 4, mod: 24, step: 1, deploy: 5, loop: 16 }, 0: { act: 15, from: 12, mod: 40, step: 4, deploy: 10, loop: 10 } } },
    SUPPORT_DIST: 210,           // 기본 공격이 없는 유닛(성직자·소환사 등)이 적과 벌려 두는 거리(px)
    /* 스킬은 전체 마나를 쓴다 (소환과 같은 마나) + 짧은 재사용 대기 cool(초). 값 = 원본 행동 마나 × costMul 을 5 단위로, 종류별 [최소, 최대] 안으로 자른다 (COST)
       — 원본은 유닛마다 마나통이 따로라 값을 그대로 쓸 수 없어 비율만 가져온다. 2026-11-12: 쿨타임만 돌던 방식에서 바꿈 (공짜라 강화를 상시 돌리던 문제) */
    SKILL: { cool: 3, costMul: 0.4, COST: { blast: [40, 70], buff: [20, 30], heal: [15, 40], haste: [60, 60], weaken: [20, 25], stun: [35, 50], recall: [40, 40], charm: [50, 60], assassin: [40, 40], morph: [20, 20] }, radius: 95, buffRadius: 170, dmgMul: 2, healRatio: 0.5, stunSec: 6, firstWait: 2, hasteMul: 1.5, maxCast: 320 },   // maxCast = 시전 거리 한도(px). 원본 사거리가 무제한(65535)인 마법도 이 안에 대상이 있어야 한다   // 스킬 공통 수치 (목업 값)
    /* 소환 패널의 탭: 해방부대 전체(원본 유닛 번호 0~24)를 네 묶음으로 나눈다 */
    TABS: [
      { name: '근접', ids: [0, 1, 2, 3, 6, 7, 8] },          // 전사 기사 창기사 성기사 창검사 격투가 무도가
      { name: '원거리', ids: [4, 5, 9, 10, 22, 23] },        // 궁수 명궁 도사 의적 엔젤 나이트 엔트
      { name: '마법', ids: [11, 12, 13, 14, 15, 16] },       // 정령사 마법사 장로 연금술사 마법전사 마법기사
      { name: '신성·소환', ids: [17, 18, 19, 20, 21, 24] }   // 성령사 사제 주교 소환사 신수사 공주
    ],
    /* 마법 유닛과 마법은 표로 정하지 않는다: 원본 행동 중 "기본 공격이 아니고, 마나를 쓰고, 이 게임이 효과를 구현한(skillKind)" 것이
       그 유닛의 마법이고(skillsOf), 마법이 하나라도 있으면 마법 유닛이다. 아이콘·이펙트·소리·수치는 원본 행동 데이터 그대로. */
    MORPH: { 23: 77, 77: 23 },   // 변형 스킬로 오가는 유닛 번호 (엔트 ↔ 지상 엔트)
    /* 웨이브: list = [유닛 번호, 수] 묶음들(순서대로 나온다), gap = 한 기씩 나오는 간격(초), rest = 다음 웨이브까지 쉬는 시간(초)
       28 해골전사, 29 해골기사 */
    /* 적 마법: 적 마법 유닛(리치·다크로드·사탄·메두사·서큐버스·술사류)도 자기 마법을 스스로 쓴다 — 마나 없이 재사용 대기만.
       cool = 한 번 쓴 뒤 다시 쓰기까지(초), first = 나온 뒤 처음 쓰기까지 [최소, 최대](초). 난이도 조절용: 지금은 길게 둔다 */
    ENEMY_SKILL: { cool: 30, first: [8, 16] },
    /* 웨이브: 악령군 전체가 섞여 나온다. [유닛 번호, 수]. 한 웨이브 안에서는 순서를 섞는다(_waveQueue).
       28 해골전사 29 해골기사 30 듀라한 32 유령 33 리치 34 다크로드 35 흡혈귀 36 늑대인간 38 메두사 39 데몬 40 데빌 41 사탄 42 서큐버스
       43 늑대 44 켈베로스 45 펜릴 46 박쥐(공중) 47 드래곤(공중) 48 디아블로 25 악령술사 26 강신술사 27 사술사
       (좀비 31·도펠갱거 37은 기본 공격이 없어 서 있기만 해서 뺐다) */
    WAVES: [
      { list: [[28, 4]], gap: 1.8, rest: 6 },
      { list: [[28, 5], [43, 2]], gap: 1.4, rest: 6 },
      { list: [[28, 6], [43, 2], [32, 2], [25, 1]], gap: 1.2, rest: 7 },
      { list: [[28, 6], [29, 2], [46, 3], [35, 1], [39, 2], [33, 1]], gap: 1.0, rest: 7 },
      { list: [[28, 6], [29, 3], [36, 2], [40, 2], [26, 1], [38, 1], [44, 1], [48, 2]], gap: 0.8, rest: 8 },
      { list: [[28, 8], [29, 3], [30, 2], [45, 2], [34, 1], [42, 1], [46, 3], [33, 2], [36, 2]], gap: 0.7, rest: 8 },
      { list: [[28, 8], [29, 5], [30, 2], [44, 2], [34, 2], [41, 1], [27, 1], [47, 1], [48, 3], [38, 1], [40, 3]], gap: 0.6, rest: 0 }
    ]
  };

  /* ───────────────────────── 2. 준비 ───────────────────────── */
  function DefenseGame(canvas, data, opts) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.data = data; this.cfg = CONFIG;
    this.H = 450; this.W = 800;

    // 원본 데이터 → 엔진 객체
    this.types = {}; var self = this;
    data.units.forEach(function (d) { self.types[d.id] = new MWE.UnitType(d); });   // 유닛 번호로 찾는다 (77 같은 변형 형태도 있다)
    this.rules = new MWE.OriginalRules(data.fx.arms);        // 원본 피해 공식
    this.rng = new MWE.Rng(Date.now() & 0xffff);
    this.map = new MWE.GameMap(data.map2);                   // 배경으로 쓸 원본 맵 (평지가 있는 2인용 맵)

    // 소환 목록: 탭마다 { 유닛 종류, 마나 값, 다시 소환까지(초), 마법 유닛인가 }
    this.roster = CONFIG.TABS.map(function (tab) { return tab.ids.map(function (id) {
      var t = self.types[id], cost = Math.max(15, Math.round(t.cost[3] * CONFIG.COST_PER_GOLD / 5) * 5);
      return { id: id, t: t, cost: cost, cd: Math.max(1, Math.min(8, cost / 20)), magic: skillsOf(t).length > 0, wait: 0, gar: garInfo(id) };
    }); });
    this.tab = 0;

    // 그림: 필요한 것만 불러온다 (배경 타일, 이펙트, 스킬 아이콘, 유닛 작은 그림, 건물, 쓰는 유닛의 스프라이트)
    var A = this.assets = new MWE.Assets(opts.base);
    A.load('tiles', this.map.keys.tiles + '.png').load('arms', 'arms.png').load('acticons', 'acticons.png').load('figs', 'figs.png').load('defense', 'defense.png').load('hpbar', 'hpbar.png');   // 원작 체력 바 틀·숫자 (bar.spr, helpnum.mwl → tools/hpbarbuild.js)
    this.bld = root.MW_DEF || {};                            // 건물 그림 위치표 { base, lair } (sim/defense.js)
    this._usedUnitIds().forEach(function (id) { A.load('u' + id, self.types[id].img); });
    this.terrain = null;                                     // 그림이 다 오면 만든다

    this.recallIcon = -1;                                    // 회수 팻말에 그릴 원작 리콜 아이콘 (넨 소환의 아이콘 번호)
    data.units.forEach(function (d) { (d.acts || []).forEach(function (a) { if (a && a.sup === 'recall' && a.icon >= 0 && self.recallIcon < 0) self.recallIcon = a.icon; }); });
    this.sfx = new MWE.Sfx(opts.base + 'sfx.js', data.sfx);
    this.bgm = new MWE.Bgm(opts.base, [['bgm0.mp3', 'bgm0b.mp3', 'bgm0c.mp3'], ['bgm1.mp3', 'bgm1b.mp3', 'bgm1c.mp3'], ['bgm2.mp3', 'bgm2b.mp3', 'bgm2c.mp3']]);
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

  /* 게임 안 크기(W × H)를 화면에 맞춰 정한다 (CONFIG.SCREEN 설명 참고).
     실제 화면에 꽉 채우는 것은 CSS(object-fit: contain)가 한다 — 여기서는 "게임 안 좌표"만 정한다. */
  P._resize = function () {
    var r = this.cv.getBoundingClientRect(), vw = r.width || root.innerWidth || 800, vh = r.height || root.innerHeight || 450, C = CONFIG, S = C.SCREEN;
    var clamp = function (v, a, b) { return Math.max(a, Math.min(b, Math.round(v))); };
    this.port = true;                                        // 늘 세로 배치 (가로 화면이어도 바뀌지 않는다)
    if (vh > vw * 1.05) { this.W = clamp(vw / S.portZoom, S.portMinW, S.portMaxW); this.H = clamp(this.W * vh / vw, S.portMinH, S.portMaxH); }   // 세로 화면: 화면 비율대로
    else { this.W = S.refW; this.H = S.refH; }                // 가로 화면·PC: 기준 크기 고정, CSS가 가운데에 세워 놓는다
    this.cv.width = this.W; this.cv.height = this.H;
    this.ctx.imageSmoothingEnabled = false;                  // 도트 그림이 뭉개지지 않게 (크기를 바꾸면 다시 켜지므로 매번 끈다)
    this._layout();                                          // 아래 패널 높이(hudH)가 여기서 정해진다
    var fieldH = this.H - this.hudH, half = C.LANE_ROWS[C.LANE_ROWS.length - 1];
    this.laneY = Math.round(fieldH * 0.66);                  // 전투 줄의 세로 중심 (위쪽 표시와 겹치지 않게 조금 아래)
    var rk = Math.max(0.4, Math.min(1, (this.laneY - 130) / half, (fieldH - this.laneY - 14) / half));   // 화면이 낮으면 줄 간격을 줄인다: 맨 윗줄 유닛 머리가 위쪽 표시 밑에, 맨 아랫줄이 패널 위에 남도록
    this.rows = C.LANE_ROWS.map(function (v) { return Math.round(v * rk); });   // 유닛이 서는 세로 줄 (전투 줄 중심에서의 거리)
    this.spawnX = C.WORLD_W - C.LAIR.mouth;                  // 적이 나오는 곳 (마굴 입구) — 전장 좌표
    this.frontX = C.WORLD_W - C.LAIR.mouth - 40;             // 아군이 나아가는 한계 (마굴 앞)
    this.cam = this.cam || { x: 0 };                         // 카메라: 화면 왼쪽 끝이 전장의 어디인가
    this._clampCam();
  };

  /* 버튼 배치. 모든 버튼은 { x, y, w, h } 상자이고, 그리기·누르기 코드는 상자만 본다 — 배치를 바꾸려면 이 함수만 고치면 된다.
       세로 전용: 아래 패널 = [탭 5칸] → [소환 버튼 한 줄 캐러셀 ◀ 4칸 ▶] → [마법 유닛 칩 + ◀▶] → [스킬 칸 4개] → 하단 여유. 전장을 넓게 남기면서 터치 타깃은 44px 이상.
     위쪽 표시(기지·마나·수비 / 웨이브 / 진행 막대 / 소리)는 왼쪽 상자 오른쪽에 웨이브와 진행 막대를 붙인다 (가로가 좁으므로) */
  var SAFE = { top: 20, bottom: 24 };   // 게임 안쪽 여유(px): 위쪽 표시가 상태 표시줄 밑에 바싹 붙지 않게, 아래 마지막 줄이 iOS 홈 막대 스와이프 영역과 겹치지 않게 (safe-area 자체는 CSS가 뺀다)
  P._layout = function () {
    var C = CONFIG, W = this.W, H = this.H, n = C.MAX_MAGIC, most = Math.max.apply(null, C.TABS.map(function (t) { return t.ids.length; })), i, y0, lx = 8;
    {
      // 세로: [탭 5칸 26] → [소환 버튼 한 줄 64: ◀ 4칸 ▶ 캐러셀] → [마법 유닛 칩 + 마법 N + ◀▶ 22] → [스킬 칸 4개 62] → 하단 여유 24  = 214 (390×844 에서 전장 630)
      var per = 4, g = 6, aw2 = 24, bh = 64, tabH = 26, ch = 22, sh = 62;
      this.slotsVis = 4; this.btnVis = per; this.hudH = 6 + tabH + 4 + bh + 4 + ch + 2 + sh + SAFE.bottom; y0 = H - this.hudH;
      var tw = Math.floor((W - 16 - C.TABS.length * 4) / (C.TABS.length + 1));
      this.tabBoxes = C.TABS.map(function (t, k) { return { x: lx + k * (tw + 4), y: y0 + 6, w: tw, h: tabH }; });
      this.garBtn = { x: lx + C.TABS.length * (tw + 4), y: y0 + 6, w: W - 8 - (lx + C.TABS.length * (tw + 4)), h: tabH };
      // 소환 줄: 양 끝에 넘김 화살표(24×64), 그 사이에 보이는 4칸. 탭에 유닛이 더 있으면 끌거나 화살표로 넘긴다 (btnFirst)
      var by = y0 + 6 + tabH + 4, ax = lx + aw2 + 2, bw = Math.floor((W - 16 - (aw2 + 2) * 2 - (per - 1) * g) / per);
      this.btnPrev = { x: lx, y: by, w: aw2, h: bh }; this.btnNext = { x: W - 8 - aw2, y: by, w: aw2, h: bh };
      this.btnStep = bw + g; this.btnArea = { x: ax, y: by, w: per * bw + (per - 1) * g, h: bh };
      this.btnBoxes = []; for (i = 0; i < per; i++) this.btnBoxes.push({ x: ax + i * (bw + g), y: by, w: bw, h: bh });
      // 칩 줄: 마법 유닛 칩(32×22, 선택·카메라 이동용) + "마법 N" + 스킬 캐러셀 ◀▶
      var hy = by + bh + 4, sy = hy + ch + 2, sw = Math.floor((W - 16 - (this.slotsVis - 1) * g) / this.slotsVis);
      this.skillPanel = { x: lx, y: hy, w: W - 16, h: ch };
      this.chipBoxes = []; for (i = 0; i < n; i++) this.chipBoxes.push({ x: lx + i * 36, y: hy, w: 32, h: ch });
      this.slotPrev = { x: W - 8 - 70, y: hy, w: 33, h: ch }; this.slotNext = { x: W - 8 - 33, y: hy, w: 33, h: ch };
      this.slotStep = sw + g; this.slotArea = { x: lx, y: sy, w: W - 16, h: sh };
      this.slotBoxes = []; for (i = 0; i < this.slotsVis; i++) this.slotBoxes.push({ x: lx + i * (sw + g), y: sy, w: sw, h: sh });
    }
    // 위쪽 표시 (y = SAFE.top)
    var ty = SAFE.top; this.narrow = true;
    this.topBox = { x: 8, y: ty, w: 168 };
    this.soundBtn = { x: W - 44, y: ty, w: 36, h: 26 };
    var wx = this.topBox.x + this.topBox.w + 6; this.waveBox = { x: wx, y: ty, w: W - 44 - 4 - wx, h: 26 }; this.miniBox = { x: wx + 4, y: ty + 32, w: W - 12 - (wx + 4), h: 14 };   // 진행 막대: 전장 전체를 한 줄로
    this._scrollBtns(0);                                     // 화면이 바뀌면 소환 캐러셀 위치를 범위 안으로
  };

  /* ───────────────────────── 3. 한 판 ───────────────────────── */
  P.reset = function () {
    var C = CONFIG;
    this.units = [];             // 전장 위의 모든 유닛 (아군·적)
    this.slots = [];             // 스킬 칸(SkillSlot) — 전장의 마법 유닛이 가진 마법마다 하나 (만든 순서)
    this.slotView = [];          // 패널에 보이는 순서: 쓸 수 있게 된 순서대로 앞에, 쿨타임 중인 칸은 곧 끝날 것부터 뒤에 (_sortSlots)
    this.magicUnits = [];        // 전장의 마법 유닛 (최대 MAX_MAGIC기). 순서 = 머리 위 번호
    this.aim = null;             // 지점 지정 대기: { slot } — 적에게 쓰는 마법의 칸을 누른 상태. 전장을 누르면 그 지점에 쓴다
    this.aimPt = null;           // 조준 중 손가락·마우스가 가리키는 화면 좌표 (반경 원을 미리 보여 준다)
    this.sel = null;             // 전장에서 고른 아군 마법 유닛 (머리 위에 [회수] 버튼이 뜬다). 상태이지 상자가 아니다 — 매 프레임 자리를 다시 계산
    this.btnFirst = 0;           // 소환 캐러셀(세로 모드): 맨 왼쪽에 보이는 칸 번호
    this.recallArm = null;       // (이전 두 번 누르기 회수의 흔적 — 지금은 쓰지 않는다)
    this.garOn = false;          // [성 배치] 켜짐: 소환 버튼이 유닛을 전장 대신 성에 넣는다
    this.garrison = [];          // 성 안의 유닛 { r(소환 목록 항목), u(피해 계산용 Unit), cls, bonus } — 순서 = 자리 번호
    this.weapons = { 0: { phase: -1, c: 0 }, 4: { phase: -1, c: 0 } };   // 건물 무기 상태: phase -1 없음 / 0 전개 중 / 2 가동, c = 그림 카운터
    this.garTick = 0;            // 마지막으로 처리한 사격 틱
    this.slotFirst = 0; this.slotPos = 0; this.slotView = [];   // 캐러셀: 맨 왼쪽에 보이는 칸 번호, 넘기는 동작용 현재 위치
    this.shots = [];             // 날아가는 발사체
    this.effects = [];           // 터지는 이펙트
    this.texts = [];             // 떠오르는 숫자·글자 (피해량 등)
    this.baseHp = C.BASE.hp; this.baseHit = 0;
    this.mana = C.MANA.start;
    this.roster.forEach(function (list) { list.forEach(function (r) { r.wait = 0; }); });   // 소환 버튼별 남은 대기 시간
    this.flash = 0;
    this.cam.x = 0; this.manualUntil = 0; this.drag = null; this.camGoal = null;
    this.pack = null;            // 지금 나오는 적 무리 { band(0 위·1 가운데·2 아래), left(남은 수) }
    this.wave = 0; this.queue = this._waveQueue(0); this.spawnT = 2; this.restT = 0; this.kills = 0;
  };

  /* 웨이브 한 개를 "나올 순서대로의 유닛 번호 목록"으로 편다. [[28,2],[29,1]] → [28,28,29] */
  P._waveQueue = function (i) {
    var q = [], w = CONFIG.WAVES[i]; if (!w) return q;
    w.list.forEach(function (e) { for (var k = 0; k < e[1]; k++) q.push(e[0]); });
    for (var j = q.length - 1; j > 0; j--) { var r = Math.floor(this.rng.next() * (j + 1)), t = q[j]; q[j] = q[r]; q[r] = t; }   // 섞는다 — 종류가 뒤섞여 나오게
    return q;
  };

  /* 그 종류의 "기본 공격" 행동. 공격 행동(isAtk)이 없는 유닛(성직자·소환사 등)은 null → 싸우지 않고 뒤에서 스킬만 쓴다 */
  /* 이 유닛이 성에 들어가면 하는 일: { cls: 건물 무기 등급(-1 = 쏘지는 못함), bonus: 건물 공격 보너스 }. 둘 다 없으면 null (배치 불가).
     등급은 이 게임이 구현한 것(CONFIG.GARRISON.classes: 0 마법사·장로, 4 궁수·명궁·창검사)만 인정한다 */
  function garInfo(id) {
    var d = root.MW_DEF && root.MW_DEF.units && root.MW_DEF.units[id]; if (!d) return null;
    var cls = CONFIG.GARRISON.classes[d.cls] ? d.cls : -1;
    return cls >= 0 || d.bonus > 0 ? { cls: cls, bonus: d.bonus } : null;
  }

  function basicAct(t) { var a = t.ai >= 0 ? t.acts[t.ai] : null; return a && a.isAtk == 1 ? a : null; }

  /* 적이 나올 줄 번호: 지금 무리(pack)의 띠 안에서 고른다. 무리가 다 나오면 다른 띠로 새 무리를 시작한다 */
  P._packRow = function () {
    var K = CONFIG.PACK, n = this.rows.length, per = Math.max(1, Math.floor(n / K.bands)), p = this.pack;
    if (!p || p.left <= 0) { var b = Math.floor(this.rng.next() * K.bands); if (p && b === p.band) b = (b + 1) % K.bands;
      p = this.pack = { band: b, left: K.min + Math.floor(this.rng.next() * (K.max - K.min + 1)) }; }
    p.left--;
    return Math.min(n - 1, p.band * per + Math.floor(this.rng.next() * per));
  };

  /* 유닛 한 기를 전장에 올린다. side: 0 아군(왼쪽에서 오른쪽으로), 1 적(오른쪽에서 왼쪽으로) */
  P.spawn = function (typeId, side) {
    var C = CONFIG, t = this.types[typeId], u = new MWE.Unit(t, side, 0, 0), self = this;
    u.side = side;
    u.x = side === 0 ? C.BASE.front - 8 : this.spawnX;
    u.y = this.laneY + this.rows[side === 1 ? this._packRow() : Math.floor(this.rng.next() * this.rows.length)];
    if (side === 1) { u.maxHp = Math.round(u.maxHp * C.ENEMY_HP_MUL); u.hp = u.maxHp; }
    u.state = 'move'; u.cd = 0; u.fade = 0; u.stunUntil = 0; u.blockT = 0; u.passY = null;
    u.rangeK = 1 - C.RANGE_SPREAD * this.rng.next();         // 이 유닛이 서는 거리 배수 (원거리만 쓴다)
    u.lookDir = 0; u.slotOf = null; u.slotA = null; u.slotAt = null; u.slotT = 0; u.apT = -9; u.skipUid = null; u.skipUntil = 0; this._setSide(u, side);
    this._applyType(u);
    // 마법 유닛이면 가진 마법마다 스킬 칸을 만들어 서로 가리키게 한다 (유닛 하나 ↔ 칸 여러 개)
    u.spawnId = typeId;                                      // 소환 버튼의 유닛 번호 (변형해도 그대로 — 회수 환급 계산용)
    u.slots = []; u.castSkill = function (i) { return self.castUnitSkill(u, i || 0); };
    if (side === 0) { skillsOf(t).forEach(function (a) { self._addSlot(u, a); }); if (u.slots.length) this.magicUnits.push(u); }
    else {                                                   // 적 마법 유닛: 칸은 유닛만 갖고(패널에는 안 나옴) 스스로 쓴다 (_enemyMagic). 변형은 이 게임에서 대응 형태가 없어 뺀다
      var E = C.ENEMY_SKILL; u.auto = true;
      skillsOf(t).forEach(function (a) { var q = new SkillSlot(u, a); if (q.kind === 'morph') return; q.cdMax = E.cool; q.cd = E.first[0] + self.rng.next() * (E.first[1] - E.first[0]); q.cost = 0; u.slots.push(q); }); }
    this.units.push(u);
    return u;
  };

  /* 편(진영)과 걷는 방향을 정한다. 매혹으로 편이 바뀔 때도 쓴다.
     스프라이트 방향: 원본은 마름모 좌표라 "화면 오른쪽"이 (1,-1), "화면 왼쪽"이 (-1,1)이다 */
  P._setSide = function (u, side) { u.side = side; u.fac = side; u.dir = side === 0 ? 1 : -1; u.lookDir = u.dir; u.face(u.dir, -u.dir); u.tgt = null; };

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
       'mana' 마나 부족      'wait' 다시 소환까지 대기 중
       'nogar' 성에 배치할 수 없는 유닛      'full' 성이 가득 참  (둘은 [성 배치]가 켜져 있을 때만) */
  P.canSummon = function (r) {
    if (this.garOn) {                                        // 성 배치 중: 배치할 수 있는 유닛만, 성의 수용 인원까지. 마법 유닛 한도와는 무관
      if (!r.gar) return 'nogar';
      if (this.garrison.length >= this.garCap()) return 'full';
      return this.mana < r.cost ? 'mana' : r.wait > 0 ? 'wait' : '';
    }
    if (r.magic && this.magicCount() >= CONFIG.MAX_MAGIC) return 'max';
    if (this.mana < r.cost) return 'mana';
    if (r.wait > 0) return 'wait';
    return '';
  };

  /* 전장에 살아 있는 마법 유닛 수 (쓰러지면 바로 목록에서 빠진다) */
  P.magicCount = function () { return this.magicUnits.length; };

  /* 지금 탭의 i번째 소환 버튼을 누름 */
  P.summon = function (i) {
    var r = this.roster[this.tab][i]; if (!r || this.screen !== 'play') return false;
    var why = this.canSummon(r);
    if (why) { var msg = why === 'max' ? '마법 유닛은 ' + CONFIG.MAX_MAGIC + '기까지' : why === 'nogar' ? '성에 배치할 수 없는 유닛' : why === 'full' ? '성이 가득 찼습니다' : '';
      if (msg) this._say(this.cam.x + this.W / 2, this.laneY - 120, msg, '#ffb36a'); return false; }
    this.mana -= r.cost; r.wait = r.cd;
    if (this.garOn) { this._garrison(r); return true; }
    var u = this.spawn(r.id, 0);
    this._play(u.t.snd.ready, 0.8);                          // 원본 등장 음성
    return true;
  };

  /* ───────────────────────── 3-2. 성 배치 (건물 원거리 공격) ───────────────────────── */
  /* 성의 수용 인원 (BuildingData +0x10: 성 8) */
  P.garCap = function () { return this.bld.base ? this.bld.base.cap : 0; };
  /* 성 안 유닛들의 건물 공격 보너스 합 (원본 건물 +0x30 = Σ unitdata +0x2B4) */
  P.garBonus = function () { return this.garrison.reduce(function (n, m) { return n + m.bonus; }, 0); };
  /* 성의 사거리(px): 원본 4000 + BuildingData[+0x1C] × 10 (0.1px 단위) → 이 게임 배수로 */
  P.garRange = function () { return (4000 + this.bld.base.rangeAdd * 10) * CONFIG.RANGE_SCALE; };

  /* 유닛을 성에 넣는다. 무기 등급이 있는 유닛이 처음 들어오면 그 등급의 무기가 전개되기 시작한다 */
  P._garrison = function (r) {
    var G = CONFIG.GARRISON, g = r.gar, u = new MWE.Unit(r.t, 0, 0, 0), k = G.classes[g.cls];
    if (k) { u.act = this.types[k.from].acts.filter(function (a) { return a.id === k.act; })[0]; var w = this.weapons[g.cls]; if (w.phase < 0) { w.phase = 0; w.c = 0; } }   // 건물에서는 등급의 행동으로 쏜다 (명궁·창검사도 활 쏘기)
    this.garrison.push({ r: r, u: u, cls: g.cls, bonus: g.bonus });
    this._play(r.t.snd.ready, 0.8);
    var o = this._bldOrigin(this.bld.base, C_BASE_X(), this.laneY + 44);
    this._say(o[0] + this.bld.base.center[0], this.laneY - 150, r.t.name + ' 성 배치' + (g.bonus ? '  (사격 +' + g.bonus + ')' : ''), '#ffe9b0');
  };
  function C_BASE_X() { return CONFIG.BASE.x; }

  /* 매 틱(초당 12): 무기 그림 카운터를 넘기고, 자리 번호에 맞는 틱에 사격한다.
       전개(phase 0): deploy 틱 동안 솟아오르는 그림, 그동안은 쏘지 않는다 → 가동(phase 2): loop 장을 되풀이
       사격: 자리 i의 유닛은 tick % mod == i × step 일 때, 성 중심에서 사거리 안의 가장 가까운 적(지상·공중)에게 */
  P._updateGarrison = function () {
    var G = CONFIG.GARRISON, tick = Math.floor(this.time * G.tps), self = this, B = this.bld.base; if (!B) return;
    if (tick - this.garTick > 6) this.garTick = tick - 6;    // 탭이 오래 멈췄다 돌아왔을 때 몰아서 쏘지 않게
    while (this.garTick < tick) {
      var t = ++this.garTick;
      [0, 4].forEach(function (cls) { var w = self.weapons[cls], k = G.classes[cls]; if (w.phase < 0) return;
        w.c++; if (w.phase === 0 && w.c >= k.deploy) { w.phase = 2; w.c = 0; } else if (w.phase === 2) w.c %= k.loop; });
      if (!this.garrison.some(function (m) { return m.cls >= 0; })) continue;
      var o = this._bldOrigin(B, CONFIG.BASE.x, this.laneY + 44), cx = o[0] + B.center[0], range = this.garRange(), bonus = this.garBonus();
      for (var i = 0; i < this.garrison.length; i++) { var m = this.garrison[i], k2 = G.classes[m.cls]; if (!k2 || this.weapons[m.cls].phase !== 2 || t % k2.mod !== (i * k2.step) % k2.mod) continue;
        var tgt = null, bd = range, L = this.units;
        for (var j = 0; j < L.length; j++) { var e = L[j]; if (e.side !== 1 || e.state === 'dead') continue; var d = Math.abs(e.x - cx); if (d <= bd) { bd = d; tgt = e; } }
        if (!tgt) continue;
        var act = m.u.act, pos = B['arm' + m.cls], def = this.data.fx.arms[act.arm];
        this.shots.push({ x: o[0] + pos[0], y: o[1] + pos[1] - 24, tgt: tgt, dmg: this.rules.damage(m.u, tgt, this.rng) + bonus, arm: act.arm, def: def, dir: 1, t0: this.time, speed: G.shotSpeed });
        this._play(act.snd, 0.35);
      }
    }
  };

  /* ───────────────────────── 4. 스킬 ───────────────────────── */
  /* SkillSlot: 오른쪽 스킬 패널의 한 칸 = 마법 유닛 한 기의 마법 하나.
       slot.unit → 그 유닛,  unit.slots → 그 유닛의 칸들 (유닛 하나에 마법이 여럿일 수 있다)
     this.slots의 순서가 패널에서의 순서다(소환한 순서대로, 한 유닛의 마법은 붙어서). 칸마다 쿨타임이 따로 돈다. */
  function SkillSlot(unit, act) {
    this.unit = unit; this.act = act;
    this.cdMax = CONFIG.SKILL.cool;                          // 재사용 대기(초): 짧게 — 몰아 쓰기만 막는다. 실제 제한은 마나 값(cost)
    this.cd = CONFIG.SKILL.firstWait;                        // 소환 직후 잠깐은 못 쓴다
    this.readyAt = 0;                                        // 쿨타임이 끝난 시각 (패널에서 앞에 설 순서를 정한다)
    this.vi = null;                                          // 패널에서 지금 그려지는 자리 (순서가 바뀌면 그 자리로 미끄러져 간다)
    this.kind = skillKind(act);
    this.aimed = this.needsFoe() || this.kind === 'recall';   // 리콜도 불러올 곳을 찍는다                            // 적에게 쓰는 마법은 누르면 바로 나가지 않고 전장에서 지점을 찍는다 (아군·자기에게 쓰는 마법은 즉시)
    var lim = CONFIG.SKILL.COST[this.kind] || [20, 60];
    this.cost = Math.max(lim[0], Math.min(lim[1], Math.round(act.mana * CONFIG.SKILL.costMul / 5) * 5));   // 쓸 때 드는 마나
  }
  SkillSlot.prototype.ready = function () { return this.cd <= 0 && this.unit.state !== 'dead'; };
  /* 적이 있어야 쓰는 마법인가 (범위 공격·약화·멈춤·매혹·암살). 아니면 아군에게 쓰는 마법(회복·강화·가속)이거나 자기에게 쓰는 것(변형) */
  SkillSlot.prototype.needsFoe = function () { return { blast: 1, weaken: 1, stun: 1, charm: 1, assassin: 1 }[this.kind] === 1; };
  SkillSlot.prototype.needsAlly = function () { return { heal: 1, buff: 1, haste: 1 }[this.kind] === 1; };

  /* 원본 행동 → 이 게임에서의 스킬 종류 (null = 아직 구현하지 않은 행동: 텔레포테이션·천리안·숨기·술 소환 등) */
  function skillKind(a) {
    if (a.dmg) return 'blast';                                         // 범위 피해
    if (a.sup === 'heal' || a.sup === 'massheal') return 'heal';       // 아군 회복
    if (a.sup === 'weapon' || a.sup === 'shield') return 'buff';       // 아군 공격·방어 강화
    if (a.sup === 'haste' || a.sup === 'masshaste') return 'haste';    // 아군 가속
    if (a.sup === 'meltw' || a.sup === 'melta') return 'weaken';       // 적 공격·방어 약화
    if (a.sup === 'stone') return 'stun';                              // 적 멈춤
    if (a.sup === 'charm') return 'charm';                             // 적을 우리 편으로
    if (a.sup === 'assassin') return 'assassin';                       // 적 하나 즉사
    if (a.sup === 'morph') return 'morph';                             // 변형
    if (a.sup === 'recall') return 'recall';                           // 리콜: 찍은 곳 주변의 아군을 시전자 곁으로 (넨 소환)
    return null;
  }
  var KIND_NAME = { blast: '범위 공격', heal: '회복', buff: '강화', haste: '가속', weaken: '약화', stun: '적 멈춤', charm: '매혹', assassin: '암살', morph: '변형', recall: '리콜' };

  /* 그 종류가 가진 마법 목록: 기본 공격이 아니고, 마나를 쓰고(방패 막기 같은 몸동작 제외), 효과를 구현한 행동 */
  function skillsOf(t) { return t.acts.filter(function (a) { return a.isAtk != 1 && a.mana > 0 && skillKind(a); }); }

  /* 동적 UI 만들기: 마법 유닛이 소환될 때 마법마다 한 칸 */
  P._addSlot = function (u, act) { var s = new SkillSlot(u, act); u.slots.push(s); this.slots.push(s); this._sortSlots(); return s; };

  /* 동적 UI 없애기: 마법 유닛이 쓰러질 때 그 유닛의 칸을 모두 뺀다 — 뒤의 칸들이 앞으로 당겨진다 */
  P._removeSlots = function (u) {
    if (!u.slots || !u.slots.length) return;
    this.slots = this.slots.filter(function (s) { return s.unit !== u; }); this._sortSlots();
    u.slots.forEach(function (s) { s.unit = null; }); u.slots = [];
    var k = this.magicUnits.indexOf(u); if (k >= 0) this.magicUnits.splice(k, 1);
    this.scrollSlots(0);
  };

  /* 쿨타임 처리: 모든 칸의 남은 시간을 줄인다. 캐러셀이 넘어가는 동작도 여기서 진행 */
  P._updateSlots = function (dt) {
    for (var i = 0; i < this.slots.length; i++) { var s = this.slots[i]; if (s.cd > 0) { s.cd = Math.max(0, s.cd - dt); if (s.cd === 0) s.readyAt = this.time; } }
    this._sortSlots();
    // 칸마다 지금 순서의 자리로 미끄러져 간다 (순서가 바뀔 때 툭 튀지 않게)
    for (i = 0; i < this.slotView.length; i++) { var v = this.slotView[i]; v.vi = v.vi == null ? i : v.vi + (i - v.vi) * Math.min(1, dt * 10); }
    this.slotPos += (this.slotFirst - this.slotPos) * Math.min(1, dt * 14);
  };

  /* 패널 순서를 다시 정한다 (실시간):
       ① 쓸 수 있는 칸이 앞 — 먼저 쓸 수 있게 된 칸일수록 앞  ② 쿨타임 중인 칸은 뒤 — 곧 끝날 칸일수록 앞
     같은 값이면 만든 순서 그대로 */
  P._sortSlots = function () {
    var base = this.slots;
    this.slotView = base.slice().sort(function (a, b) {
      var ra = a.cd <= 0, rb = b.cd <= 0;
      if (ra !== rb) return ra ? -1 : 1;
      var d = ra ? a.readyAt - b.readyAt : a.cd - b.cd;
      return d || base.indexOf(a) - base.indexOf(b);
    });
  };

  /* 캐러셀을 d칸 넘긴다 (음수 = 왼쪽). 범위를 벗어나지 않게 맞춘다 */
  P.scrollSlots = function (d) { this.slotFirst = Math.max(0, Math.min(Math.max(0, this.slots.length - this.slotsVis), this.slotFirst + d)); };

  /* i번째 칸(this.slots 기준)을 누름 → 그 칸에 묶인 유닛의 castSkill(그 유닛의 몇 번째 마법) */
  P.pressSlot = function (i) {
    var s = this.slots[i], was = (this.aim && this.aim.slot) || this._aimWas; this.aim = null; this._aimWas = null;
    if (!s || this.screen !== 'play') return false;
    if (!s.aimed) return !!s.unit.castSkill(s.unit.slots.indexOf(s));
    if (was === s) return false;                             // 조준 중인 칸을 다시 누르면 취소
    var why = this._whyNot(s.unit, s); if (why) { this._say(s.unit.x, s.unit.y - s.unit.headY - 10, why[0], why[1]); return false; }
    this.aim = { slot: s }; this.sel = null; this.aimPt = null;
    this.camGoal = { x: s.unit.x - this.W / 2 + Math.min(this.W * 0.3, this.aimReach(s) * 0.5), until: this.time + 1.2 }; this.manualUntil = 0;   // 시전자와 그 앞쪽이 보이게
    return true;
  };
  /* 이 마법을 지금 못 쓰는 이유 [문구, 색]. 쓸 수 있으면 null */
  P._whyNot = function (u, s) {
    if (u.state === 'dead') return ['', '#c9d1e3'];
    if (s.cd > 0) return ['쿨타임 ' + Math.ceil(s.cd), '#c9d1e3'];
    if (u.stunUntil > this.time) return ['멈춤 중', '#c9d1e3'];
    if (!u.auto && this.mana < s.cost) return ['마나 부족 (' + s.cost + ')', '#e0584a'];
    if (!this.skillTarget(u, s)) return [s.needsFoe() ? '가까이에 적이 없음' : '가까이에 아군이 없음', '#c9d1e3'];
    return null;
  };
  /* 지점 지정 마법의 시전 거리(px): 시전자에서 이 가로 거리 안의 지점만 찍을 수 있다 */
  P.aimReach = function (s) { return s.kind === 'recall' ? CONFIG.WORLD_W : Math.min(CONFIG.SKILL.maxCast, s.act.range * CONFIG.RANGE_SCALE); };   // 리콜은 원본처럼 거리 제한 없음
  /* 지점 지정 마법의 효과 반경(px) — 그리기와 판정이 같은 값을 쓴다 */
  P.aimRadius = function (s) { var S = CONFIG.SKILL; return s.kind === 'recall' ? 120 : s.kind === 'blast' ? (s.act.aoe ? S.radius : 60) : s.kind === 'charm' ? S.radius * 0.7 : s.kind === 'assassin' ? 45 : S.radius; };
  /* 조준 중 전장을 눌렀다: 그 지점(전장 좌표)에 마법을 쓴다. 시전 거리 밖이면 알려 주고 조준은 유지 */
  P._aimCast = function (wx, wy) {
    var s = this.aim.slot, u = s.unit; if (!u || u.state === 'dead') { this.aim = null; return false; }
    var R = this.rows, y = Math.max(this.laneY + R[0] - 30, Math.min(this.laneY + R[R.length - 1] + 10, wy));
    if (Math.abs(wx - u.x) > this.aimReach(s)) { this._say(wx, y - 12, '너무 멀다', '#e08a6a'); return false; }
    var ok = this.castUnitSkill(u, u.slots.indexOf(s), { x: wx, y: y });
    if (ok) { this.aim = null; this.aimPt = null; }
    return ok;
  };
  /* 지금 보이는 칸 중 k번째(0~2)를 누름 — 단축키 A·S·D. 보이는 순서(slotView)에서 고른다 */
  P.pressVisible = function (k) { var s = this.slotView[this.slotFirst + k]; return !!s && this.pressSlot(this.slots.indexOf(s)); };

  /* 소환 캐러셀(세로 모드)을 d칸 넘긴다. 가로 모드는 전부 보이므로 늘 0 */
  P._scrollBtns = function (d) { var n = this.roster ? this.roster[this.tab].length : 0, vis = this.btnVis || n; this.btnFirst = Math.max(0, Math.min(Math.max(0, n - vis), (this.btnFirst || 0) + d)); };
  /* (x, y)에 있는 소환 버튼의 목록 번호 (보이는 칸 k → btnFirst + k). 없으면 -1 */
  P.btnIndexAt = function (x, y) { var vis = this.btnVis || this.btnBoxes.length, list = this.roster[this.tab]; for (var k = 0; k < vis && k < this.btnBoxes.length; k++) if (inBox(this.btnBoxes[k], x, y)) { var i = (this.btnFirst || 0) + k; return i < list.length ? i : -1; } return -1; };

  /* 회수할 수 있는 유닛인가: 살아 있는 아군 마법 유닛 (magicUnits와 같은 기준) */
  P._recallable = function (u) { return !!(u && u.side === 0 && u.slots && u.slots.length && u.state !== 'dead'); };
  /* 유닛을 고른다: 선택 표시 + 머리 위 [회수] 버튼, 그 유닛의 마법이 스킬 칸 맨 앞에 보이게 */
  P._selectUnit = function (u) {
    this.sel = u; if (!u) return;
    var view = this.slotView, idx = u.slots.map(function (q) { return view.indexOf(q); }).filter(function (k) { return k >= 0; });
    if (idx.length) { this.slotFirst = Math.min.apply(null, idx); this.scrollSlots(0); }
  };
  /* 회수 때 돌려받는 마나 — 버튼 라벨과 실제 반환량이 같은 값이 되도록 한 곳에서 */
  P._refundOf = function (u) {
    var r = null; this.roster.forEach(function (list) { list.forEach(function (q) { if (q.id === u.spawnId) r = q; }); });
    return r ? Math.round(r.cost * CONFIG.RECALL.refund * u.hp / u.maxHp) : 0;
  };
  /* 선택한 유닛 머리 위 [회수] 버튼의 화면 상자 (그리기와 누르기가 같은 함수를 본다). 터치 타깃 64×44, 화면 가장자리·위쪽 표시·아래 패널을 피한다 */
  P._recallBtnBox = function (u) {
    var w = 74, h = 44, sx = Math.round(u.x - this.cam.x), x = Math.max(6, Math.min(this.W - 6 - w, sx - w / 2));
    var topY = Math.max(this.topBox.y + (this.garrison.length ? 70 : 46), this.miniBox.y + this.miniBox.h) + 4;
    var y = Math.max(topY, Math.min(this.H - this.hudH - 6 - h, Math.round(u.y - u.headY) - h - 8));
    return { x: x, y: y, w: w, h: h };
  };
  /* 전장을 끌지 않고 눌렀다(탭). 우선순위: ① 선택 유닛의 [회수] 버튼 → 회수  ② 아군 마법 유닛 몸통 → 선택  ③ 일반 아군 → 안내만  ④ 빈 곳 → 선택 해제 */
  P._tapField = function (x, y) {
    if (this.screen !== 'play') return;
    if (this.aim) { this._aimCast(x + this.cam.x, y); return; }   // 조준 중: 누른 지점에 마법
    var sel = this.sel; if (sel && this._recallable(sel) && inBox(this._recallBtnBox(sel), x, y)) { this.recall(sel); this.sel = null; return; }
    var wx = x + this.cam.x, best = null, bd = Infinity, plain = null, L = this.units, i, u, d;
    for (i = 0; i < L.length; i++) { u = L[i]; if (u.side !== 0 || u.state === 'dead') continue;
      if (Math.abs(u.x - wx) <= 20 && y >= u.y - u.headY - 6 && y <= u.y + 8) { d = Math.hypot(u.x - wx, (u.y - y) * 1.6);
        if (this._recallable(u)) { if (d < bd) { bd = d; best = u; } } else if (!plain) plain = u; } }
    if (best) { this._selectUnit(best); return; }
    this.sel = null;
    if (plain) this._say(wx, y - 12, '마법 유닛만 회수할 수 있습니다', '#c9d1e3');
  };

  /* 마법 유닛 칩 i를 누름 = 그 유닛을 선택하고 카메라를 그쪽으로, 스킬 칸도 그 유닛의 마법으로. (회수는 전장의 [회수] 버튼으로) */
  P.pressChip = function (i) {
    var u = this.magicUnits[i]; if (!u || this.screen !== 'play') return false;
    this._selectUnit(u); this.panTo(u.x - this.W / 2);
    return true;
  };

  /* 회수: 유닛을 전장에서 거둬들인다. 스킬 칸이 사라지고 마법 유닛 자리가 하나 비며, 남은 체력만큼 마나를 돌려받는다.
     멈춤에 걸려 있으면 회수할 수 없다. 같은 유닛을 다시 소환하려면 소환 대기 시간을 기다려야 한다 */
  P.recall = function (u) {
    var C = CONFIG, R = C.RECALL; this.recallArm = null;
    if (!u || u.state === 'dead' || u.side !== 0) return false;
    if (u.stunUntil > this.time) { this._say(u.x, u.y - u.headY - 10, '멈춤 중에는 회수 불가', '#c9d1e3'); return false; }
    var r = null; this.roster.forEach(function (list) { list.forEach(function (q) { if (q.id === u.spawnId) r = q; }); });
    var back = this._refundOf(u);
    this.mana = Math.min(C.MANA.max, this.mana + back); if (r) r.wait = r.cd;
    this._addEffect(u.x, u.y, R.fxArm, 0); this._play(R.snd, 0.9);
    this._say(u.x, u.y - u.headY - 10, '회수  +' + back, '#8fc7ff');
    this._removeSlots(u);
    u.state = 'dead'; u.deadT = 99; u.fade = 1; u.buffs = {};   // 쓰러지는 동작 없이 바로 사라진다
    if (this.sel === u) this.sel = null;
    return true;
  };

  /* 이 마법을 지금 쓸 대상이 시전자 가까이에 있는가. 있으면 { foe } (적에게 쓰는 마법이면 그 적), 없으면 null.
       적에게 쓰는 마법: 가장 가까운 적이 시전 거리 안 — 시전 거리 = 원본 행동 사거리 × RANGE_SCALE, 한도 maxCast
       아군에게 쓰는 마법: 효과 반경 안에 시전자 말고 다른 아군이 하나 이상
       변형: 조건 없음 */
  P.skillTarget = function (u, s) {
    var C = CONFIG, S = C.SKILL, L = this.units, i, o;
    if (s.needsFoe()) {
      var reach = Math.min(S.maxCast, s.act.range * C.RANGE_SCALE), best = null, bd = Infinity;
      for (i = 0; i < L.length; i++) { o = L[i]; if (o.side === u.side || o.state === 'dead') continue; var d = Math.abs(o.x - u.x); if (d < bd) { bd = d; best = o; } }
      return best && bd <= reach ? { foe: best } : null;
    }
    if (s.act.self) return { foe: null };                    // 자기에게만 거는 강화: 대상 조건 없음
    if (s.needsAlly()) {
      var r = s.kind === 'haste' ? S.buffRadius * 1.3 : s.act.sup === 'massheal' ? S.buffRadius * 1.5 : S.buffRadius;
      for (i = 0; i < L.length; i++) { o = L[i]; if (o !== u && o.side === u.side && o.state !== 'dead' && Math.abs(o.x - u.x) <= r) return { foe: null }; }
      return null;
    }
    return { foe: null };
  };

  /* 적 마법 유닛(u.auto)이 스스로 마법을 쓴다: 재사용 대기가 끝났고 대상이 가까이 있으면 쓴다. 한 프레임에 한 번만.
     매혹으로 우리 편이 된 적도 계속 스스로 쓴다(편만 바뀐다). 쿨타임은 여기서 줄인다 — 아군 칸은 _updateSlots 가 맡는다 */
  P._enemyMagic = function (dt) {
    var L = this.units, cast = false;
    for (var i = 0; i < L.length; i++) { var u = L[i]; if (!u.auto || !u.slots || !u.slots.length || u.state === 'dead') continue;
      for (var k = 0; k < u.slots.length; k++) { var s = u.slots[k]; if (s.cd > 0) { s.cd = Math.max(0, s.cd - dt); continue; }
        if (cast || u.stunUntil > this.time || !this.skillTarget(u, s)) continue;
        if (s.kind === 'buff' && u.buffs[s.act.sup] && u.buffs[s.act.sup].until > this.time) continue;   // 이미 걸려 있는 강화는 다시 쓰지 않는다
        if (s.kind === 'heal' && !L.some(function (o) { return o.side === u.side && o.state !== 'dead' && o.hp < o.maxHp * 0.7 && Math.abs(o.x - u.x) < 170; })) continue;
        if (this.castUnitSkill(u, k)) cast = true; else s.cd = 2; } }   // 실패하면 2초 뒤 다시 본다 (매 프레임 "대상 없음" 글자가 뜨지 않게)
  };

  /* 유닛 u가 자기 i번째 마법을 쓴다. 성공하면 그 칸에 쿨타임이 돈다 */
  P.castUnitSkill = function (u, i, pt) {   // pt = { x, y } 지점 지정(플레이어의 조준). 없으면 가장 가까운 대상에 자동으로 (적 마법 유닛, 아군·자기 대상 마법)
    var s = u.slots[i]; if (!s || u.state === 'dead') return false;
    if (s.cd > 0) { this._say(u.x, u.y - u.headY - 10, '쿨타임 ' + Math.ceil(s.cd), '#c9d1e3'); return false; }   // 눌렀는데 안 되는 이유를 알려 준다
    if (u.stunUntil > this.time) { this._say(u.x, u.y - u.headY - 10, '멈춤 중', '#c9d1e3'); return false; }
    if (!u.auto && this.mana < s.cost) { this._say(u.x, u.y - u.headY - 10, '마나 부족 (' + s.cost + ')', '#e0584a'); return false; }
    var a = s.act, S = CONFIG.SKILL, self = this, ok = false, tps = this.rules.tps;
    // 시전 조건: 시전자 가까이에 대상이 있어야 한다 — 적에게 쓰는 마법은 시전 거리 안의 적, 아군에게 쓰는 마법은 주변의 다른 아군 (skillTarget)
    var tg = pt ? { foe: pt } : this.skillTarget(u, s), foe = tg ? tg.foe : null;
    if (pt && s.kind === 'assassin') { foe = null; var bd0 = 45;   // 암살은 유닛 하나가 대상: 찍은 지점에서 가장 가까운 적
      this.units.forEach(function (o) { if (o.side === u.side || o.state === 'dead') return; var d0 = Math.hypot(o.x - pt.x, o.y - pt.y); if (d0 < bd0) { bd0 = d0; foe = o; } }); }
    if (!tg) { this._say(u.x, u.y - u.headY - 10, s.needsFoe() ? '가까이에 적이 없음' : '가까이에 아군이 없음', '#c9d1e3'); return false; }
    var allies = function (r) { return self.units.filter(function (o) { return o.side === u.side && o.state !== 'dead' && Math.abs(o.x - u.x) <= r; }); };
    var foesAt = function (c, r) { return self.units.filter(function (o) { return o.side !== u.side && o.state !== 'dead' && Math.hypot(o.x - c.x, o.y - c.y) <= r; }); };   // 원형 범위: 대상 적을 중심으로 반경 r 안 (전에는 가로 거리만 봐서 세로 줄 전체가 맞았다)

    if (s.kind === 'recall' && pt) {                         // 리콜 (원본 FUN_004b9590 case 0x34 / 0x3A): 찍은 곳 주변의 아군이 대형 그대로 시전자 곁으로 순간이동. 피해 없음
      var RR = this.aimRadius(s), R0 = this.rows, lo0 = this.laneY + R0[0], hi0 = this.laneY + R0[R0.length - 1], moved = 0;
      this.units.forEach(function (o) { if (o === u || o.side !== u.side || o.state === 'dead' || Math.hypot(o.x - pt.x, o.y - pt.y) > RR) return;
        self._addEffect(o.x, o.y, 3, 0); o.x = Math.max(CONFIG.BASE.front - 8, u.x + (o.x - pt.x)); o.y = Math.max(lo0, Math.min(hi0, u.y + (o.y - pt.y)));
        o.tgt = null; o.slotOf = null; o.slotA = null; o.slotAt = null; o.passY = null; o.blockT = 0; if (o.state !== 'attack') o.state = 'move'; self._addEffect(o.x, o.y, 3, 0.25); moved++; });
      if (moved) ok = true; else { this._say(pt.x, pt.y - 12, '불러올 아군이 없음', '#c9d1e3'); return false; }
    } else if (s.kind === 'blast' && foe) {                         // 가장 가까운 적을 중심으로 범위 피해 (원본 피해 공식 × dmgMul)
      var keep = u.act; u.act = a;
      foesAt(foe, a.aoe ? S.radius : 60).forEach(function (o) { self._damage(o, self.rules.damage(u, o, self.rng) * S.dmgMul); });
      u.act = keep; this._addEffect(foe.x, foe.y, a.arm, 0); this.flash = 0.2; ok = true;
    } else if (s.kind === 'heal') {                          // 주변 아군 회복. 말다 소환(massheal)은 더 넓게, 전부 회복
      var mass = a.sup === 'massheal';
      allies(mass ? S.buffRadius * 1.5 : S.buffRadius).forEach(function (o) { var h = mass ? o.maxHp : Math.round(o.maxHp * S.healRatio), got = Math.min(o.maxHp - o.hp, h);
        o.hp += got; if (got > 0) self._say(o.x, o.y - o.t.h - 6, '+' + got, '#8fe89a'); if (!mass) self._addEffect(o.x, o.y - o.t.h * 0.5, a.arm, 0); });
      if (mass) this._addEffect(u.x, this.laneY, a.arm, 0);
      ok = true;
    } else if (s.kind === 'buff') {                          // 주변 아군에게 강화. 배수는 원본 규칙(OriginalRules)이 buffs를 보고 적용한다
      (a.self ? [u] : allies(S.buffRadius)).forEach(function (o) { o.buffs[a.sup] = { k1: a.k1, k2: a.k2, arm: a.arm, until: self.time + (a.dur || 600) / tps }; });   // 자기 전용 강화(아이스 웨폰 등, 원본 +0x3C == 0xFFFF)는 시전자에게만
      ok = true;
    } else if (s.kind === 'haste') {                         // 주변 아군이 빨리 걷는다 (케멘 소환). 걸린 유닛 머리 위에 원본 가속 이펙트(칸 44)
      allies(S.buffRadius * 1.3).forEach(function (o) { o.buffs.haste = { arm: a.arm, until: self.time + (a.dur || 600) / tps }; });
      this._addEffect(u.x, this.laneY, a.arm, 0); ok = true;
    } else if (s.kind === 'weaken' && foe) {                 // 범위 안 적의 공격(멜팅 웨폰)·방어(멜팅 아머)를 무너뜨린다 — 수치는 원본 규칙이 buffs를 보고 적용
      foesAt(foe, S.radius).forEach(function (o) { o.buffs[a.sup] = { arm: a.arm, until: self.time + (a.dur || 600) / tps }; self._say(o.x, o.y - o.headY - 6, '약화', '#c7a0ff'); });
      this._addEffect(foe.x, foe.y, a.arm, 0); ok = true;
    } else if (s.kind === 'stun' && foe) {                   // 범위 안의 적을 잠시 멈춘다
      foesAt(foe, S.radius).forEach(function (o) { if (a.races && a.races.indexOf(o.t.race) < 0) return;   // 걸리는 종족만 (턴 언데드 = 언데드, 디스트로이 언홀리 = 언데드 + 흡혈귀·늑대인간류, 분석 8-36)
        o.stunUntil = self.time + S.stunSec; o.state = 'idle'; delete o.buffs.weapon; delete o.buffs.shield; delete o.buffs.haste; });
      this._addEffect(foe.x, foe.y, a.arm, 0); ok = true;
    } else if (s.kind === 'charm' && foe) {                  // 범위 안의 적이 우리 편이 되어 싸운다
      foesAt(foe, S.radius * 0.7).forEach(function (o) { self._setSide(o, u.side); o.state = 'idle'; self._say(o.x, o.y - o.t.h - 6, '매혹', '#ff9ad5'); });
      this._addEffect(foe.x, foe.y - 20, a.arm, 0); ok = true;
    } else if (s.kind === 'assassin' && foe) {               // 가장 가까운 적 하나를 쓰러뜨린다
      this._damage(foe, foe.hp); ok = true;
    } else if (s.kind === 'morph') {                         // 다른 형태로 (엔트 ↔ 지상 엔트). 체력 비율은 유지
      var to = this.types[CONFIG.MORPH[u.t.id]];
      if (to) { var ratio = u.hp / u.maxHp; u.setType(to); u.hp = Math.max(1, Math.round(u.maxHp * ratio)); this._applyType(u); u.face(u.dir, -u.dir); ok = true; }
    }
    if (!ok) { this._say(u.x, u.y - u.headY - 10, '대상 없음', '#c9d1e3'); return false; }
    if (!u.auto) { this.mana -= s.cost;                      // 내가 쓴 마법: 터진 곳(적에게 쓰는 마법은 그 적, 아니면 시전자)이 화면 가운데에 오도록 카메라가 미끄러져 간다
      this.camGoal = { x: (foe && s.kind !== 'recall' ? foe.x : u.x) - this.W / 2, until: this.time + CONFIG.CAM.skillSec }; this.manualUntil = 0; }
    s.cd = s.cdMax; this._sortSlots();                       // 방금 쓴 칸은 바로 뒤로 간다
    this._say(u.x, u.y - u.t.h - 18, a.name, u.side === 0 ? '#ffd36e' : '#ff8a7a');   // 적이 쓴 마법은 붉은 글씨
    this._play(a.snd, 1);
    return true;
  };

  /* ───────────────────────── 5. update ───────────────────────── */
  P._frame = function (ts) {
    var dt = Math.min(0.05, (ts - this._last) / 1000 || 0); this._last = ts;   // 탭이 멈췄다 돌아와도 한 번에 0.05초까지만 진행
    if (!this.ground && this.assets.ready()) {               // 그림이 다 왔다: 바닥을 만들고 시작 화면으로 (바닥이 없으면 어느 화면에서든 먼저 만든다)
      this.terrain = new MWE.TerrainRenderer(this.map, this.assets.get('tiles'));
      this._makeGround();
      if (this.screen === 'loading') this.screen = 'title';
    }
    // 바닥 조각을 0.5초마다 다시 그린다: 큰 이펙트 시트(arms.png, 2,150만 픽셀)를 펼칠 때 아이폰에서 보조 캔버스가 비워져 전장 바닥만 검게 나오던 문제의 복구 (448×192 한 장이라 비용은 작다)
    else if (this.ground && this.terrain && this.time - this._groundAt > 0.5) this._makeGround();
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
    if (this.aim && (!this.aim.slot.unit || this.aim.slot.unit.state === 'dead' || this.slots.indexOf(this.aim.slot) < 0)) this.aim = null;   // 조준하던 유닛이 사라지면 조준도 풀린다
    if (this.sel && !this._recallable(this.sel)) this.sel = null;   // 고른 유닛이 쓰러지거나 사라지면 선택도 사라진다
    this._scrollBtns(0);                                     // 탭·유닛 수가 바뀌어도 소환 캐러셀이 범위 밖에 남지 않게

    this._updateWave(dt);
    for (i = 0; i < this.units.length; i++) this._updateUnit(this.units[i], dt);
    this._separate(dt);
    this._updateShots(dt);
    this._updateGarrison();
    this._enemyMagic(dt);
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
      // 근접 유닛이 적에게 닿았어도, 맡은 자리(적 둘레의 빈칸)에 아직 못 갔으면 먼저 자리로 간다 — 앞에서 멈춰 뒤따르는 유닛의 길을 막지 않게.
      // 단, 내가 둘러싸이는 쪽(besieged)이면 움직이지 않고 그 자리에서 싸운다 (서로 자리를 잡으려다 뒤로 밀려나는 것 방지)
      var melee = u.rangePx < 80, held = melee && tgt && this._besieged(u);
      if (held) { u.slotOf = null; u.slotA = null; }                   // 지키는 쪽은 자기가 맡았던 자리를 내려놓는다 — 서로 "네가 와라" 하며 멈춰 서는 것을 막는다
      if (canHitUnit && melee && !held && u.slotAt !== tgt.uid) { this._approach(u, tgt, dt); return; }
      if (canHitUnit || canHitBase) {
        if (canHitUnit) this._look(u, tgt.x >= u.x ? 1 : -1);          // 때릴 적을 바라본다 (에워싸면 뒤돌아 칠 수도 있다)
        if (u.cd <= 0) { u.state = 'attack'; u.at = 0; u.hitDone = false; u.tgt = canHitUnit ? tgt : 'base'; this._play(u.act.snd, 0.5); }
        else u.state = 'idle';
        return;
      }
      // 근접 유닛: 적이 가까이 있으면 줄을 풀고 그 적에게 바로 다가간다 → 한 적을 여럿이 둘러싸서 친다 (_approach)
      if (tgt && melee && adx <= u.rangePx + C.SURROUND.engage) {
        if (held) this._stepToward(u, tgt, dt); else this._approach(u, tgt, dt);   // 둘러싸이는 쪽은 자리를 잡으러 돌지 않고, 닿을 때까지만 곧장 다가간다
        return;
      }
      // 원거리 유닛: 가로로는 닿는데 못 쏘는 경우는 없다 (거리를 가로로만 잰다)
    } else if (adx <= C.SUPPORT_DIST) { u.state = 'idle'; return; }   // 기본 공격이 없는 유닛은 적과 거리를 두고 선다
    // 전진 한계: 아군은 마굴 앞, 적은 성 앞 (매혹된 적은 아군 규칙)
    if (u.side === 0 && u.x >= this.frontX) { u.state = 'idle'; return; }
    if (u.side === 1 && u.x <= C.BASE.front) { u.state = 'idle'; return; }
    // 줄 서기: 같은 줄 바로 앞에 같은 편이 있으면 멈춰 기다린다. 기다리는 동안 적이 있는 줄 쪽으로 조금씩 비켜 서서 빈자리를 찾는다
    // 줄 서기와 추월: 같은 줄 바로 앞에 같은 편이 있으면 멈춰 기다린다.
    // 막힌 시간이 쌓이면(앞사람이 느려서 붙었다 떨어졌다 해도 쌓이도록 천천히 줄인다) 가까운 빈 줄을 골라 그 줄로 옮겨 가서 앞지른다
    var blocked = this._blockedAhead(u);
    // 앞지르기: 앞사람이 나보다 느리게 걷고 있으면 기다리지 않는다 — 멀리서 미리 옆줄로 비켜 걸음을 멈추지 않고 지나간다 (빠른 유닛이 느린 유닛 뒤에서 섰다 갔다 하던 것을 없앤다)
    if (u.passY == null && C.PASS_LOOK > 0 && this._slowAhead(u)) { u.passY = this._freeRow(u); u.passT = 0; }
    if (blocked) u.blockT += dt; else u.blockT = Math.max(0, u.blockT - dt * 0.5);
    if (u.blockT >= C.PASS_WAIT && u.passY == null) { u.passY = this._freeRow(u); u.passT = 0; if (u.passY == null) u.blockT = 0; }
    if (u.passY != null) { u.passT += dt; this._shiftRow(u, u.passY, Math.max(45, this._speed(u) * 0.9) * dt); if (Math.abs(u.passY - u.y) < 1 || u.passT > 2) { u.passY = null; u.blockT = 0; } }
    if (blocked) { if (u.passY != null) { u.state = 'move'; u.walkT += dt; } else u.state = 'idle'; return; }
    if (u.lookDir !== u.dir) this._look(u, u.dir);           // 싸우느라 돌아봤으면 다시 가던 쪽을 본다
    u.slotOf = null; u.slotA = null;                         // 다시 전진한다 = 둘러싸려던 적을 놓았다 (남겨 두면 그 적이 "나를 노리는 중"으로 잘못 알고 서 있는다)
    u.state = 'move'; u.walkT += dt; u.x += u.dir * this._speed(u) * dt;
  };

  /* 지금 걷는 속도(px/초): 가속이 걸려 있으면 hasteMul배 */
  P._speed = function (u) { var h = u.buffs.haste; return u.speedPx * (h && h.until > this.time ? CONFIG.SKILL.hasteMul : 1); };

  /* 바라보는 쪽을 바꾼다 (d: 1 오른쪽, -1 왼쪽). 걷는 방향(u.dir)은 그대로 */
  P._look = function (u, d) { if (u.lookDir === d) return; u.lookDir = d; u.face(d, -d); };

  /* 에워싸기와 우회: 근접 유닛 u가 적 tgt에게 다가간다.
     적 둘레를 slots개의 자리(각도)로 나누고, 지금 내 위치에서 가장 가까운 빈자리를 하나 맡는다(u.slotA). 앞자리가 차 있으면
     옆·뒤 자리를 맡게 되므로 길이 막혀도 돌아 들어가 사방에서 친다. 가는 길에는 적 몸을 뚫지 않고 둘레를 따라 돈다.
     자리가 하나도 없으면 그 적은 잠시 두고(skip) 위아래로 비켜서 지나간다 → 다음 적이나 기지로 간다 */
  P._approach = function (u, tgt, dt) {
    var S = CONFIG.SURROUND, R = this.rows, lo = this.laneY + R[0] - 14, hi = this.laneY + R[R.length - 1] + 14, r = u.rangePx * 0.85;
    u.apT = this.time;                                       // 지금 이 적에게 다가가는 중이라는 표시 (_besieged가 본다)
    if (u.slotOf !== tgt.uid || u.slotA == null) { u.slotOf = tgt.uid; u.slotA = this._pickSlot(u, tgt, r, lo, hi); u.slotAt = null; u.slotT = 0; }
    if (this._dist(u, tgt) <= u.rangePx) u.slotT += dt;      // 이미 닿는 거리인데도 자리를 못 찾고 도는 시간만 잰다
    this._look(u, tgt.x >= u.x ? 1 : -1);
    if (u.slotA == null) {                                   // 둘레가 꽉 찼다 → 이 적은 건너뛰고 돌아서 간다
      u.skipUid = tgt.uid; u.skipUntil = this.time + S.skipSec; u.slotOf = null;
      var side = u.y >= tgt.y ? 1 : -1, py = tgt.y + side * S.detour; if (py < lo || py > hi) py = tgt.y - side * S.detour;
      u.passY = Math.max(lo, Math.min(hi, py)); u.passT = 0; u.state = 'idle'; return;
    }
    var ang = u.slotA * 2 * Math.PI / S.slots, sx = tgt.x + Math.cos(ang) * r, sy = tgt.y + Math.sin(ang) * r / S.yScale;
    var dx = sx - u.x, dy = sy - u.y, d = Math.hypot(dx, dy);
    if (d < 3 || u.slotT > 2.5) { u.slotAt = tgt.uid; u.state = 'idle'; return; }   // 자리에 도착 (너무 오래 걸리면 지금 자리에서 싸운다). 이후로는 이 적을 상대로 다시 움직이지 않는다
    var vx = dx / d, vy = dy / d;
    // 적 몸 가까이로는 들어가지 않는다: 안쪽이면 바깥으로 미는 힘을 더해 둘레를 따라 돌게 한다
    var tx = u.x - tgt.x, ty = (u.y - tgt.y) * S.yScale, td = Math.hypot(tx, ty) || 1;
    if (td < r * 0.9) { var out = (r * 0.9 - td) / (r * 0.9) * 2.5; vx += tx / td * out; vy += ty / td * out; }
    var v = Math.hypot(vx, vy) || 1, step = Math.min(d, this._speed(u) * dt);
    u.x += vx / v * step; u.y = Math.max(lo, Math.min(hi, u.y + vy / v * step));
    u.state = 'move'; u.walkT += dt; u.blockT = 0; u.passY = null;
  };

  /* 둘러싸이는 쪽의 이동: 가장 가까운 적에게 곧장, 내 사거리에 닿을 때까지만 (닿으면 다음 틱부터 공격한다).
     서서 기다리기만 하면 사거리가 짧은 유닛(무도가·격투가 42px)이 사거리가 긴 적(49px)에게 맞기만 하고 못 때리는 일이 생긴다 */
  P._stepToward = function (u, tgt, dt) {
    var R = this.rows, lo = this.laneY + R[0] - 14, hi = this.laneY + R[R.length - 1] + 14, dx = tgt.x - u.x, dy = tgt.y - u.y, d = Math.hypot(dx, dy) || 1;
    this._look(u, dx >= 0 ? 1 : -1);
    var step = Math.min(this._speed(u) * dt, Math.max(0, this._dist(u, tgt) - u.rangePx + 1));
    if (step <= 0) { u.state = 'idle'; return; }
    u.x += dx / d * step; u.y = Math.max(lo, Math.min(hi, u.y + dy / d * step));
    u.state = 'move'; u.walkT += dt;
  };

  /* 내가 둘러싸이는 쪽인가: 나를 둘러싸려고 자리를 맡은(slotOf = 나) 적이 가까이에 있다.
     두 근접 유닛이 마주치면 먼저 움직인 쪽이 상대 둘레에 자리를 잡고, 상대는 이 판정으로 제자리를 지킨다 */
  P._besieged = function (u) {
    var L = this.units;
    for (var i = 0; i < L.length; i++) { var o = L[i]; if (o.side === u.side || o.state === 'dead' || o.slotOf !== u.uid || Math.hypot(o.x - u.x, o.y - u.y) >= CONFIG.SURROUND.holdDist) continue;   // 코앞까지 온 적만 — 멀리서 오는 적은 서서 기다리지 않고 마주 다가간다
      // 실제로 오고 있거나(방금 _approach 함) 이미 닿는 거리에 있는 적만 친다. 멈춤에 걸렸거나 기지를 치러 가 버린 적의 예전 표시는 무시 —
      // 그런 적을 기다리며 서 있으면 "적을 만났는데 다가가지 않고 멈추는" 현상이 된다
      if (o.stunUntil > this.time) continue;
      if (this.time - o.apT < 0.3 || this._dist(o, u) <= o.rangePx) return true; }
    return false;
  };

  /* 적 tgt 둘레에서 u가 맡을 자리(각도 번호)를 고른다: 지금 위치에서 가까운 각도부터, 같은 편이 이미 맡지 않았고 전투 줄 안에 있는 자리. 없으면 null */
  P._pickSlot = function (u, tgt, r, lo, hi) {
    var S = CONFIG.SURROUND, n = S.slots, L = this.units, taken = {}, i;
    for (i = 0; i < L.length; i++) { var o = L[i]; if (o !== u && o.side === u.side && o.state !== 'dead' && o.slotOf === tgt.uid && o.slotA != null) taken[o.slotA] = 1; }
    var bearing = Math.atan2((u.y - tgt.y) * S.yScale, u.x - tgt.x), best = null, bd = Infinity;
    for (i = 0; i < n; i++) { if (taken[i]) continue; var a = i * 2 * Math.PI / n, y = tgt.y + Math.sin(a) * r / S.yScale; if (y < lo || y > hi) continue;
      var diff = Math.abs(Math.atan2(Math.sin(a - bearing), Math.cos(a - bearing))); if (diff < bd) { bd = diff; best = i; } }
    return best;
  };

  /* 두 유닛 사이의 "닿는 거리". 원거리는 가로 거리만, 근접은 세로까지 넣은 2차원 거리 (적의 위·아래·뒤에서도 닿으면 친다) */
  P._dist = function (u, o) { var dx = Math.abs(o.x - u.x); return u.rangePx < 80 ? Math.hypot(dx, (o.y - u.y) * CONFIG.SURROUND.yScale) : dx; };

  /* 세로로 y 쪽을 향해 step만큼 옮긴다 (전투 줄 범위 안에서) */
  P._shiftRow = function (u, y, step) {
    var R = this.rows, lo = this.laneY + R[0], hi = this.laneY + R[R.length - 1], d = y - u.y;
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

  /* 같은 줄 앞쪽(UNIT_GAP × PASS_LOOK 안)에 나보다 느리게 "걷고 있는" 같은 편이 있는가. 서서 싸우는 유닛은 해당 없음(그건 줄 서기·에워싸기가 맡는다) */
  P._slowAhead = function (u) {
    var C = CONFIG, L = this.units, mine = this._speed(u); if (u.air) return false;
    for (var i = 0; i < L.length; i++) { var o = L[i]; if (o === u || o.air || o.side !== u.side || o.state !== 'move' || Math.abs(o.y - u.y) >= C.ROW_NEAR) continue;
      if (o.reach > u.reach + 1) continue;
      var ahead = (o.x - u.x) * u.dir; if (ahead > 0 && ahead < C.UNIT_GAP * C.PASS_LOOK && this._speed(o) < mine * 0.9) return true; }
    return false;
  };

  /* 추월할 줄 고르기: 지금 줄에서 가까운 순서로, 내 옆과 바로 앞에 나를 막을 같은 편이 없는 줄. 없으면 null */
  P._freeRow = function (u) {
    var C = CONFIG, L = this.units, self = this, rows = this.rows.map(function (r) { return self.laneY + r; })
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
    var C = CONFIG, L = this.units, R = this.rows, lo = this.laneY + R[0], hi = this.laneY + R[R.length - 1];
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
      if (u.skipUid === o.uid && this.time < u.skipUntil) continue;   // 둘레가 꽉 차서 건너뛰기로 한 적
      if (o.air && !u.air && u.rangePx < 80) continue;               // 지상 근접 유닛은 공중 유닛을 때리지 못한다 (원거리·마법·공중 유닛만 가능)
      var d = this._dist(u, o); if (d < bd) { bd = d; best = o; } }
    return best;
  };

  /* 카메라: 손으로 움직인 직후가 아니면 전선(아군 맨 앞과 적 맨 앞 사이)을 부드럽게 따라간다 */
  P._updateCamera = function (dt) {
    var C = CONFIG, W = this.W, a = -Infinity, e = Infinity, L = this.units, target;
    if ((this.drag && !this.drag.slots && !this.drag.btn) || this.time < this.manualUntil) { this.camGoal = null; this._clampCam(); return; }   // 손으로 움직이면 마법 지점 비추기도 그만둔다
    if (this.camGoal) { if (this.time >= this.camGoal.until) this.camGoal = null; else { this.cam.x += (this.camGoal.x - this.cam.x) * Math.min(1, dt * C.CAM.skillSpeed); this._clampCam(); return; } }
    for (var i = 0; i < L.length; i++) { var o = L[i]; if (o.state === 'dead') continue; if (o.side === 0) a = Math.max(a, o.x); else e = Math.min(e, o.x); }
    if (a === -Infinity) target = e < W * 0.9 ? e - W * 0.6 : 0;             // 아군이 없다: 적이 성 근처에 올 때까지는 성을 비춘다
    else if (e - a < W * 0.8) target = (a + e) / 2 - W / 2;                    // 맞붙었다: 두 전선의 가운데
    else target = a - W * 0.35;                                               // 아군만 나아가는 중: 아군 맨 앞을 조금 앞서 본다
    this.cam.x += (target - this.cam.x) * Math.min(1, dt * C.CAM.follow);
    this._clampCam();
  };
  P._clampCam = function () { this.cam.x = Math.max(0, Math.min(CONFIG.WORLD_W - this.W, this.cam.x)); };
  /* 손으로 카메라를 옮김 (끌기·방향키·진행 막대 누르기). 잠시 동안 자동 따라가기를 멈춘다 */
  P.panTo = function (x) { this.camGoal = null; this.cam.x = x; this._clampCam(); this.manualUntil = this.time + CONFIG.CAM.manualSec; };

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
      this._removeSlots(u);                                  // 마법 유닛이면 그 유닛의 스킬 칸도 함께 없앤다 → 소환 버튼이 다시 켜진다
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
    var d = this.data.fx.arms[arm], fr = d && (d.hit.length ? d.hit : d.fly.length ? d.fly : d.seq);   // seq = 순간이동 이펙트의 틱 순서표
    if (fr && fr.length) this.effects.push({ x: x, y: y, f: fr, t0: this.time + (delay || 0), add: !d.dir });
  };

  P._play = function (id, vol) { if (this.soundOn && id != null && id >= 0) this.sfx.play(id, vol); };

  /* ───────────────────────── 6. draw ───────────────────────── */
  P.draw = function () {
    var ctx = this.ctx, W = this.W, H = this.H;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0b0d12'; ctx.fillRect(0, 0, W, H);
    if (this.screen === 'loading') { MWE.drawLoading(ctx, W, H, this.assets, this.sfx); return; }   // 진행률 바 (render/assets.js)

    this._drawGround();
    // 전장 층: 여기서부터는 전장 좌표로 그린다 (카메라만큼 왼쪽으로 밀고, 아래 패널 영역은 잘라낸다)
    var camX = Math.round(this.cam.x), vx0 = camX - 120, vx1 = camX + W + 120, i;
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H - this.hudH); ctx.clip(); ctx.translate(-camX, 0);
    this._drawBases();
    // 유닛: 화면에 보이는 것만, 아래쪽(y가 큰) 유닛이 위에 그려지도록 정렬
    var L = this.units.filter(function (u) { return u.x > vx0 && u.x < vx1; }).sort(function (a, b) { return a.y - b.y; });
    for (i = 0; i < L.length; i++) this._drawUnit(L[i]);
    for (i = 0; i < this.shots.length; i++) this._drawShot(this.shots[i]);
    for (i = 0; i < this.effects.length; i++) this._drawEffect(this.effects[i]);
    this._drawTexts();
    ctx.restore();
    this._drawAim();                                         // 조준 중: 시전 거리 띠 + 반경 원
    this._drawSelectionOverlay();                            // 선택 링 위의 [회수] 버튼 — 유닛 정렬 루프 밖(위에 그려지는 유닛에 가리지 않게), 화면 좌표
    if (this.flash > 0) { ctx.fillStyle = 'rgba(255,240,200,' + (this.flash * 0.9) + ')'; ctx.fillRect(0, 0, W, H - this.hudH); }
    this._drawHud();
    if (this.screen !== 'play') this._drawOverlay();
  };

  /* 바닥 무늬 만들기: 원본 맵에서 장애물 없는 평지 한 조각(GW × GH)을 떠 온다.
     원본 타일은 가로 64 · 세로 32 간격의 마름모라서, 그 배수 크기로 뜬 조각은 이어 붙여도 타일 모양이 어긋나지 않는다.
     (맵을 그대로 깔면 2000px 안에 절벽·맵 가장자리가 들어와서, 평지 조각을 되풀이해 긴 전장을 만든다) */
  var GW = 448, GH = 192;
  P._makeGround = function () {
    // 이미 있으면 같은 캔버스에 다시 그린다 (새로 만들지 않는다) — 아이폰 WebKit 은 메모리가 모자라면 다시 그리지 않는 캔버스의 내용을 비우므로, 주기적으로 다시 그려 복구한다 (_frame)
    var map = this.map, c = map.t2w(map.arena[0], map.arena[1]), cv = this.ground || document.createElement('canvas'); if (cv.width !== GW) cv.width = GW; if (cv.height !== GH) cv.height = GH;
    var g = cv.getContext('2d'); g.imageSmoothingEnabled = false; g.clearRect(0, 0, GW, GH);
    this.terrain.draw(g, { x: Math.round(c[0] / 64) * 64 - GW / 2, y: Math.round(c[1] / 32) * 32 - GH / 2 }, GW, GH);
    this.ground = cv; this._groundAt = this.time;
  };

  /* 배경: 평지 조각을 카메라에 맞춰 이어 깔고, 전투 줄을 살짝 어둡게 표시 */
  P._drawGround = function () {
    var ctx = this.ctx, W = this.W, gh = this.H - this.hudH, rows = this.rows, top = this.laneY + rows[0] - 40, bot = this.laneY + rows[rows.length - 1] + 30;
    if (!this.ground) return;
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, gh); ctx.clip();
    for (var x = -(Math.round(this.cam.x) % GW); x < W; x += GW) for (var y = 0; y < gh; y += GH) ctx.drawImage(this.ground, x, y);
    var g = ctx.createLinearGradient(0, top, 0, bot);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(0,0,0,.2)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, top, W, bot - top);
    ctx.restore();
  };

  /* 아군 기지(왼쪽 성)와 적 출구(오른쪽 마굴): 원본 건물 그림. 그림의 기준점(ax, ay = 땅에 닿는 앞쪽 모서리)을 전투 줄 바로 아래에 맞춘다 */
  P._drawBases = function () {
    var C = CONFIG, D = this.bld, B = D.base, L = D.lair, gy = this.laneY + 44;
    if (B) { var sh = this.baseHit > 0 ? Math.round(Math.sin(this.time * 90) * 2) : 0;                  // 맞으면 살짝 흔들린다
      this._drawBuilding(B, C.BASE.x + sh, gy); }
    if (L) { var lx = C.WORLD_W - C.LAIR.back, lp = D.pics[L.pic], ctx = this.ctx;
      this._drawBuilding(L, lx, gy);
      // 마굴 입구의 으스스한 빛 (가산 합성으로 깜박임)
      var gx = lx - lp[2] * 0.16, gcy = gy - lp[3] * 0.30, g = ctx.createRadialGradient(gx, gcy, 2, gx, gcy, 46);
      g.addColorStop(0, 'rgba(190,90,220,' + (0.30 + 0.16 * Math.sin(this.time * 3)) + ')'); g.addColorStop(1, 'rgba(190,90,220,0)');
      ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g; ctx.fillRect(gx - 46, gcy - 46, 92, 92); ctx.globalCompositeOperation = 'source-over'; }
  };

  /* 건물 하나: 본체 + 깃발. (x, y) = 건물 기준점(땅에 닿는 앞쪽 모서리)의 전장 좌표.
     깃발은 원본처럼 주인이 있는 건물에 늘 걸려 있고 8장을 돌려 가며 펄럭인다 (flag.mwb, 자리 = BuildingData +0x46~+0x4C, 분석 8-35) */
  P._drawBuilding = function (b, x, y) {
    var D = this.bld, p = D.pics[b.pic], o = this._bldOrigin(b, x, y), k = Math.floor(this.time * 8) % b.flagFrames.length;
    this._pic(b.pic, o[0], o[1]);
    if (b === D.base) this._drawWeapons(b, o);
    for (var i = 0; i < b.flags.length; i++) this._pic(b.flagFrames[(k + i * 3) % b.flagFrames.length], o[0] + b.flags[i][0], o[1] + b.flags[i][1]);
  };
  /* 성 위의 건물 무기 (원본 FUN_004f4950의 그림 고르기 그대로):
       등급 0(마법사·장로, barm00 30장): 전개 중 = 0~9, 가동 = 10~19 위에 20~29를 겹침.  자리 = BuildingData +0x56/+0x58
       등급 4(궁수류, barm05 21장):      전개 중 = 0~4, 가동 = 4(다 선 망루) 위에 5~20을 겹침.  자리 = +0x60/+0x62/+0x64로 계산한 곳 */
  P._drawWeapons = function (b, o) {
    var D = this.bld, w0 = this.weapons[0], w4 = this.weapons[4];
    if (w4.phase === 0) this._pic(D.arm4[Math.min(4, w4.c)], o[0] + b.arm4[0], o[1] + b.arm4[1]);
    else if (w4.phase === 2) { this._pic(D.arm4[4], o[0] + b.arm4[0], o[1] + b.arm4[1]); this._pic(D.arm4[5 + w4.c % 16], o[0] + b.arm4[0], o[1] + b.arm4[1]); }
    if (w0.phase === 0) this._pic(D.arm0[Math.min(9, w0.c)], o[0] + b.arm0[0], o[1] + b.arm0[1]);
    else if (w0.phase === 2) { this._pic(D.arm0[10 + w0.c % 10], o[0] + b.arm0[0], o[1] + b.arm0[1]); this._pic(D.arm0[20 + w0.c % 10], o[0] + b.arm0[0], o[1] + b.arm0[1]); }
  };
  /* 건물의 "그리기 원점"(원본 좌표의 기준 — 깃발·무기 자리가 여기서부터의 거리)의 전장 좌표 */
  P._bldOrigin = function (b, x, y) { var p = this.bld.pics[b.pic]; return [x - b.ax + p[4], y - b.ay + p[5]]; };
  /* defense.png 안의 그림 한 장을 (x, y)에 원점을 맞춰 그린다 */
  P._pic = function (i, x, y) { var p = this.bld.pics[i]; this.ctx.drawImage(this.assets.get('defense'), p[0], p[1], p[2], p[3], Math.round(x - p[4]), Math.round(y - p[5]), p[2], p[3]); };

  /* 유닛 한 기: 그림자 → 강화 이펙트 → 원본 스프라이트(Unit.frameIndex가 고른 프레임) → 체력 바 → 스킬 칸 번호 */
  P._drawUnit = function (u) {
    var ctx = this.ctx, fi = u.frameIndex(this.rules.tps), f = fi >= 0 ? u.t.frames[fi] : null, x = Math.round(u.x), y = Math.round(u.y), drop = u.drop || 0, T = this.time;
    if (!f) return;
    ctx.globalAlpha = u.state === 'dead' ? 1 - u.fade : 1;
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(x, y + 2, 13, 5, 0, 0, 6.3); ctx.fill();
    // 발밑 편 표시: 아군 파랑, 적 빨강 (난전에서 한눈에 구분되게)
    if (u.state !== 'dead') { ctx.strokeStyle = u.side === 0 ? 'rgba(90,170,255,.9)' : 'rgba(255,90,70,.9)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(x, y + 2, 14, 6, 0, 0, 6.3); ctx.stroke(); }
    // 고른 유닛: 발밑에 금색 링이 1.2Hz로 맥박친다 (회수 버튼은 _drawSelectionOverlay)
    if (u === this.sel) { ctx.globalAlpha = 0.775 + 0.225 * Math.sin(T * 7.54); ctx.strokeStyle = '#ffd36e'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(x, y + 2, 19, 9, 0, 0, 6.3); ctx.stroke(); ctx.globalAlpha = 1; }
    // 공격 강화(웨폰): 발밑에서 도는 원본 이펙트. 방어 강화(베리어)는 몸 가운데 높이 — 전장 시뮬(worldview.js)과 같은 방식
    var wb = u.buffs.weapon, sb = u.buffs.shield;
    if (wb && wb.until > T) this._loopFx(wb.arm, x, y);
    ctx.save(); ctx.translate(x, y + drop); if (u.mir) ctx.scale(-1, 1);
    if (u.stunUntil > T) ctx.filter = 'grayscale(1) brightness(1.25)';   // 멈춘 적은 돌처럼 회색으로 (지원하지 않는 브라우저에서는 그대로 보인다)
    ctx.drawImage(this.assets.get(f[6] || ('u' + u.t.id)), f[0], f[1], f[2], f[3], -f[4], -f[5], f[2], f[3]);
    ctx.restore(); ctx.globalAlpha = 1;
    if (sb && sb.until > T) { var sd = this.data.fx.arms[sb.arm], si = sd ? MWE.shieldFrame(sd, sb, u.t, T) : -1;   // 파운틴 베리어: 시전 동작은 한 번, 그 뒤 물줄기 유지 (render/assets.js)
      if (si >= 0) this._fxFrame(si, x, y - (sb.arm === 7 || sb.arm === 43 ? u.headY : u.headY >> 1), !sd.dir); }
    var hb = u.buffs.haste; if (hb && hb.until > T && u.state !== 'dead') this._loopFx(44, x, y - u.headY);   // 가속: 머리 위 (원본 FUN_004f7490과 같은 자리)
    if (u.state === 'dead') return;
    var top = y - u.headY - 8;
    if (u.hp < u.maxHp || u === this.sel) this._drawHpBar(u, x, y);   // 원작 체력 바 (닳았을 때와 고른 유닛)
    // 마법 유닛: 몇 번째 마법 유닛인지 머리 위에 번호로 (스킬 칸에도 같은 번호가 붙는다). 쓸 수 있는 마법이 있으면 밝게
    if (u.slots && u.slots.length && this.magicUnits.indexOf(u) >= 0) { var k = this.magicUnits.indexOf(u) + 1, by = top - 14;
      ctx.fillStyle = u.slots.some(function (q) { return q.ready(); }) ? '#ffd36e' : '#59607a'; ctx.beginPath(); ctx.arc(x, by, 7, 0, 6.3); ctx.fill();
      ctx.fillStyle = '#10131b'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(k, x, by + 0.5); ctx.textAlign = 'left'; }
  };

  /* 조준 표시 (전장 클립 안, 화면 좌표): 시전자 발밑 링, 찍을 수 있는 가로 범위를 옅게, 손가락·마우스 자리에 효과 반경 원, 위쪽에 안내 한 줄 */
  P._drawAim = function () {
    var A = this.aim; if (!A || this.screen !== 'play') return;
    var ctx = this.ctx, s = A.slot, u = s.unit, W = this.W, fh = this.H - this.hudH, reach = this.aimReach(s), r = this.aimRadius(s), ux = u.x - this.cam.x, T = this.time;
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, fh); ctx.clip();
    ctx.fillStyle = 'rgba(5,7,12,.38)'; if (ux - reach > 0) ctx.fillRect(0, 0, ux - reach, fh); if (ux + reach < W) ctx.fillRect(ux + reach, 0, W - (ux + reach), fh);   // 닿지 않는 곳을 어둡게
    ctx.strokeStyle = 'rgba(127,214,255,.55)'; ctx.lineWidth = 1; ctx.setLineDash([6, 5]); ctx.beginPath(); ctx.moveTo(ux - reach + 0.5, 0); ctx.lineTo(ux - reach + 0.5, fh); ctx.moveTo(ux + reach - 0.5, 0); ctx.lineTo(ux + reach - 0.5, fh); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = '#7fd6ff'; ctx.lineWidth = 3; ctx.globalAlpha = 0.775 + 0.225 * Math.sin(T * 7.54); ctx.beginPath(); ctx.ellipse(ux, u.y + 2, 19, 9, 0, 0, 6.3); ctx.stroke(); ctx.globalAlpha = 1;
    var p = this.aimPt; if (p && p.y < fh) { var okp = Math.abs(p.x + this.cam.x - u.x) <= reach;
      ctx.fillStyle = okp ? 'rgba(255,211,110,.16)' : 'rgba(224,88,74,.14)'; ctx.strokeStyle = okp ? '#ffd36e' : '#e0584a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 6.3); ctx.fill(); ctx.stroke(); }
    var msg = s.act.name + ' — 쓸 곳을 누르세요 (칸을 다시 누르면 취소)'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    var mw = Math.min(W - 16, ctx.measureText(msg).width + 20), my = Math.max(this.topBox.y + (this.garrison.length ? 70 : 46), this.miniBox.y + this.miniBox.h) + 8;
    ctx.fillStyle = 'rgba(8,10,16,.8)'; ctx.fillRect(W / 2 - mw / 2, my, mw, 24); ctx.fillStyle = '#7fd6ff'; ctx.fillText(this._fit(msg, mw - 10), W / 2, my + 12.5);
    ctx.textAlign = 'left'; ctx.restore();
  };

  /* 고른 유닛 머리 위의 [회수 +N] 버튼. 전장 클립 안, 화면 좌표. 유닛이 화면 밖이면 그리지 않는다 */
  P._drawSelectionOverlay = function () {
    var u = this.sel; if (!u || !this._recallable(u) || this.screen !== 'play') return;
    var sx = u.x - this.cam.x; if (sx < -30 || sx > this.W + 30) return;
    var ctx = this.ctx, b = this._recallBtnBox(u), c = 5, tx = Math.max(b.x + 12, Math.min(b.x + b.w - 12, Math.round(sx)));
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, this.W, this.H - this.hudH); ctx.clip();
    // 팻말: 원작 HUD 의 명령 칸처럼 — 모서리를 깎은 어두운 판, 청동 테두리(위는 밝고 아래는 어둡게), 안쪽 가는 선, 네 귀의 징
    var plate = function (x, y, w, h, k) { ctx.beginPath(); ctx.moveTo(x + k, y); ctx.lineTo(x + w - k, y); ctx.lineTo(x + w, y + k); ctx.lineTo(x + w, y + h - k); ctx.lineTo(x + w - k, y + h); ctx.lineTo(x + k, y + h); ctx.lineTo(x, y + h - k); ctx.lineTo(x, y + k); ctx.closePath(); };
    ctx.fillStyle = 'rgba(0,0,0,.45)'; plate(b.x + 2, b.y + 3, b.w, b.h, c); ctx.fill();                       // 그림자
    ctx.beginPath(); ctx.moveTo(tx - 7, b.y + b.h - 1); ctx.lineTo(tx + 7, b.y + b.h - 1); ctx.lineTo(tx, b.y + b.h + 7); ctx.closePath(); ctx.fillStyle = '#6b4f1e'; ctx.fill();   // 유닛을 가리키는 쐐기 (테두리 색)
    var gb = ctx.createLinearGradient(0, b.y, 0, b.y + b.h); gb.addColorStop(0, '#e6c476'); gb.addColorStop(0.45, '#a8823a'); gb.addColorStop(1, '#5c431a');
    ctx.fillStyle = gb; plate(b.x, b.y, b.w, b.h, c); ctx.fill();                                                 // 청동 테두리
    var gi = ctx.createLinearGradient(0, b.y, 0, b.y + b.h); gi.addColorStop(0, '#262b3a'); gi.addColorStop(1, '#0c0e15');
    ctx.fillStyle = gi; plate(b.x + 2, b.y + 2, b.w - 4, b.h - 4, c - 1); ctx.fill();                             // 어두운 판
    ctx.strokeStyle = 'rgba(255,233,176,.22)'; ctx.lineWidth = 1; plate(b.x + 3.5, b.y + 3.5, b.w - 7, b.h - 7, c - 2); ctx.stroke();   // 안쪽 가는 선
    ctx.beginPath(); ctx.moveTo(tx - 4, b.y + b.h - 2); ctx.lineTo(tx + 4, b.y + b.h - 2); ctx.lineTo(tx, b.y + b.h + 3); ctx.closePath(); ctx.fillStyle = '#0c0e15'; ctx.fill();   // 쐐기 속
    ctx.fillStyle = '#f3dc9a'; [[b.x + 5, b.y + 5], [b.x + b.w - 7, b.y + 5], [b.x + 5, b.y + b.h - 7], [b.x + b.w - 7, b.y + b.h - 7]].forEach(function (q) { ctx.fillRect(q[0], q[1], 2, 2); });   // 징
    // 내용: 왼쪽에 원작 리콜(넨 소환) 아이콘, 오른쪽에 "회수"와 돌려받는 마나
    var D = this.data.fx.icon, ic = this.recallIcon, ih = b.h - 12, iw = Math.round(ih * D.w / D.h), ix = b.x + 7, cx = ix + iw + (b.x + b.w - 6 - ix - iw) / 2;
    if (ic >= 0) { var fi = ic * 2; ctx.drawImage(this.assets.get('acticons'), (fi % D.cols) * D.w, Math.floor(fi / D.cols) * D.h, D.w, D.h, ix, b.y + 6, iw, ih); } else cx = b.x + b.w / 2;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.9)';
    ctx.font = 'bold 12px sans-serif'; ctx.strokeText('회수', cx, b.y + 15); ctx.fillStyle = '#ffe9b0'; ctx.fillText('회수', cx, b.y + 15);
    var rf = '+' + this._refundOf(u); ctx.font = 'bold 12px sans-serif'; ctx.strokeText(rf, cx, b.y + 30); ctx.fillStyle = '#8fc7ff'; ctx.fillText(rf, cx, b.y + 30);   // 마나 색 (소환 버튼의 마나 값과 같은 색)
    ctx.textAlign = 'left'; ctx.restore();
  };

  /* 원작 체력 바 — 전장 시뮬(render/worldview.js)과 같은 그림·색·폭·채움 식 (FUN_004f7cf0, 분석 8-27):
       bar.spr 틀(종류별 폭 unitData +0x100), 초록이고 폭의 1/3 이하면 빨강, 오른쪽에 레벨 숫자(helpnum.mwl).
       적은 늘 빨강(목업 고유, 피아 구분). 자리는 머리 위(원본은 발밑·선택한 유닛만). 이 게임은 유닛 마나가 없어 마나 줄은 없다 */
  P._drawHpBar = function (u, x, y) {
    var HB = root.MW && root.MW.hpbar, him = this.assets.get('hpbar'), ctx = this.ctx; if (!HB || !him) return;
    var hb = HB.units[u.t.id] || HB.units[0], bw = hb[1], hf = HB.frames[hb[0]], x0 = x - (bw >> 1), hy = y - u.headY - 6, fill = Math.floor(Math.max(0, u.hp) * bw / u.maxHp);
    ctx.fillStyle = u.side !== 0 || fill <= Math.floor(bw / 3) ? HB.low : HB.hp; ctx.fillRect(x0, hy, fill + 1, 3);
    ctx.drawImage(him, hf[0], hf[1], hf[2], hf[3], x - hf[4], hy - 11 - hf[5], hf[2], hf[3]);
    for (var ls = String(u.level), li = 0, lx = x0 + bw + 3; li < ls.length; li++, lx += 5) { var lg = HB.digits[ls.charCodeAt(li) - 48]; if (lg) ctx.drawImage(him, lg[0], lg[1], lg[2], lg[3], lx - lg[4], hy - 3 - lg[5], lg[2], lg[3]); }
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

  /* HUD: 위 = 기지 체력·마나·수비 / 웨이브 / 진행 막대 / 소리, 아래 = 소환 패널 + 스킬 패널. 자리는 모두 _layout이 정한 상자 */
  P._drawHud = function () {
    var ctx = this.ctx, W = this.W, H = this.H, C = CONFIG, T = this.topBox, bx = T.x + 40, bw = T.w - 90, rx = T.x + T.w - 6;
    // 위 왼쪽: 기지 체력과 마나
    ctx.font = 'bold 12px sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(T.x, T.y, T.w, this.garrison.length ? 70 : 46);
    ctx.fillStyle = '#dfe6f5'; ctx.fillText('기지', T.x + 8, T.y + 13);
    this._bar(bx, T.y + 7, bw, 12, this.baseHp / C.BASE.hp, this.baseHp / C.BASE.hp > 0.35 ? '#5fd46a' : '#e0584a');
    ctx.fillStyle = '#fff'; ctx.textAlign = 'right'; ctx.fillText(Math.ceil(this.baseHp), rx, T.y + 13);
    ctx.textAlign = 'left'; ctx.fillStyle = '#8fc7ff'; ctx.fillText('마나', T.x + 8, T.y + 33);
    this._bar(bx, T.y + 27, bw, 12, this.mana / C.MANA.max, '#3f8fe8');
    ctx.fillStyle = '#fff'; ctx.textAlign = 'right'; ctx.fillText(Math.floor(this.mana), rx, T.y + 33);
    // 성 안의 유닛(수비대): 작은 그림을 자리 순서대로
    if (this.garrison.length) { var gf = this.assets.get('figs'), gi, gs = Math.min(16, Math.floor((bw + 6) / this.garCap())); ctx.textAlign = 'left'; ctx.fillStyle = '#ffe9b0'; ctx.fillText('수비', T.x + 8, T.y + 57);
      for (gi = 0; gi < this.garrison.length; gi++) ctx.drawImage(gf, this.garrison[gi].r.t.pid * 36, 0, 36, 43, bx - 2 + gi * gs, T.y + 47, 16, 19);
      ctx.textAlign = 'right'; ctx.fillStyle = '#fff'; ctx.fillText(this.garrison.length + '/' + this.garCap(), rx, T.y + 57); }
    // 웨이브
    var wb = this.waveBox, wv = Math.min(this.wave + 1, C.WAVES.length), left = this._alive(1).length + this.queue.length;
    ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(wb.x, wb.y, wb.w, wb.h);
    ctx.fillStyle = '#ffd36e'; ctx.fillText(this._fit(this.narrow ? '웨이브 ' + wv + '/' + C.WAVES.length + ' · 적 ' + left : '웨이브 ' + wv + ' / ' + C.WAVES.length + '   남은 적 ' + left, wb.w - 6), wb.x + wb.w / 2, wb.y + wb.h / 2);
    this._drawMini();
    // 소리
    var sb = this.soundBtn; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(sb.x, sb.y, sb.w, sb.h);
    ctx.fillStyle = this.soundOn ? '#dfe6f5' : '#6f7687'; ctx.fillText(this.soundOn ? '소리' : '무음', sb.x + sb.w / 2, sb.y + sb.h / 2);

    // 아래 바탕
    var y0 = H - this.hudH; ctx.fillStyle = '#12151d'; ctx.fillRect(0, y0, W, this.hudH); ctx.fillStyle = '#2a3040'; ctx.fillRect(0, y0, W, 2);
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

  /* 소환 패널: 탭 + [성 배치] 토글 + 지금 탭의 유닛 버튼. 버튼 = 원본 유닛 작은 그림(figs.png, 유닛 번호 × 36px) + 이름 + 마나 값.
     버튼 안의 그림·글자 자리는 상자 크기에서 계산한다 (가로·세로 모드, 납작한 배치에서 상자 크기가 다르다) */
  P._drawSummonPanel = function () {
    var ctx = this.ctx, C = CONFIG, i, figs = this.assets.get('figs'), list = this.roster[this.tab], full = this.magicCount() >= C.MAX_MAGIC;
    ctx.textBaseline = 'middle';
    for (i = 0; i < this.tabBoxes.length; i++) { var tb = this.tabBoxes[i], on = i === this.tab;
      ctx.fillStyle = on ? '#2c3550' : '#181c27'; ctx.fillRect(tb.x, tb.y, tb.w, tb.h);
      if (on) { ctx.fillStyle = '#c9a35a'; ctx.fillRect(tb.x, tb.y + tb.h - 2, tb.w, 2); }
      ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = on ? '#ffe9b0' : '#8a93a8'; ctx.fillText(this._fit(C.TABS[i].name, tb.w - 4), tb.x + tb.w / 2, tb.y + tb.h / 2); }
    // [성 배치] 토글: 켜면 소환 버튼이 유닛을 성에 넣는다 (배치할 수 있는 유닛만 밝게 남는다)
    var gb = this.garBtn; ctx.fillStyle = this.garOn ? '#7a4a12' : '#181c27'; ctx.fillRect(gb.x, gb.y, gb.w, gb.h);
    ctx.strokeStyle = this.garOn ? '#ffb36a' : '#3a4152'; ctx.lineWidth = 1; ctx.strokeRect(gb.x + 0.5, gb.y + 0.5, gb.w - 1, gb.h - 1);
    ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = this.garOn ? '#ffe9b0' : '#8a93a8'; ctx.fillText(this._fit('성 배치 ' + this.garrison.length + '/' + this.garCap(), gb.w - 4), gb.x + gb.w / 2, gb.y + gb.h / 2);
    // 세로 모드 캐러셀 화살표: 넘길 칸이 있는 쪽만 밝게
    var first = this.btnFirst || 0, vis = this.btnVis || this.btnBoxes.length;
    if (this.btnPrev) { var bar = [[this.btnPrev, '◀', first > 0], [this.btnNext, '▶', first < list.length - vis]];
      for (i = 0; i < 2; i++) { var ab2 = bar[i][0], on2 = bar[i][2]; ctx.fillStyle = on2 ? '#2c3550' : '#181c27'; ctx.fillRect(ab2.x, ab2.y, ab2.w, ab2.h);
        ctx.textAlign = 'center'; ctx.font = '12px sans-serif'; ctx.fillStyle = on2 ? '#ffe9b0' : '#3f465a'; ctx.fillText(bar[i][1], ab2.x + ab2.w / 2, ab2.y + ab2.h / 2 + 1); } }
    for (var k = 0; k < vis && k < this.btnBoxes.length; k++) { i = first + k; if (i >= list.length) break;
      var b = this.btnBoxes[k], r = list[i], why = this.canSummon(r), ok = !why, cx = b.x + b.w / 2, fh = Math.min(43, b.h - 24), fw = Math.round(fh * 36 / 43);
      ctx.fillStyle = ok ? '#232a3a' : '#191d27'; ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = ok ? (r.magic ? '#7fb6ff' : '#c9a35a') : '#3a4152'; ctx.lineWidth = 2; ctx.strokeRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2);
      ctx.globalAlpha = ok ? 1 : why === 'max' || why === 'nogar' ? 0.2 : 0.5; ctx.drawImage(figs, r.t.pid * 36, 0, 36, 43, Math.round(cx - fw / 2), b.y + 2, fw, fh); ctx.globalAlpha = 1;
      if (r.wait > 0) { ctx.fillStyle = 'rgba(0,0,0,.6)'; var ch = b.h * r.wait / r.cd; ctx.fillRect(b.x, b.y + b.h - ch, b.w, ch); }
      ctx.textAlign = 'center';
      ctx.font = '9px sans-serif'; ctx.fillStyle = ok ? '#dfe6f5' : '#7b8397'; ctx.fillText(this._fit(r.t.name, b.w - 4), cx, b.y + b.h - 18);
      ctx.font = 'bold 11px sans-serif'; ctx.fillStyle = this.mana >= r.cost ? '#8fc7ff' : '#e0584a'; ctx.fillText(r.cost, cx, b.y + b.h - 7);
      ctx.font = '9px sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = '#8a93a8'; ctx.fillText(i + 1, b.x + 4, b.y + 8);
      if (this.garOn) { if (r.gar) { ctx.textAlign = 'right'; ctx.fillStyle = '#ffb36a'; ctx.fillText(r.gar.cls >= 0 ? '사격' : '+' + r.gar.bonus, b.x + b.w - 4, b.y + 8); } }
      else if (r.magic) { ctx.textAlign = 'right'; ctx.fillStyle = '#7fb6ff'; ctx.fillText('마법', b.x + b.w - 4, b.y + 8); }
      // 마법 유닛 한도에 닿음: 버튼을 어둡게 덮고 "최대" 표시 (눌러도 소환되지 않는다)
      if (r.magic && full && !this.garOn) { ctx.fillStyle = 'rgba(8,10,16,.55)'; ctx.fillRect(b.x + 2, b.y + 2, b.w - 4, b.h - 4);
        ctx.textAlign = 'center'; ctx.font = 'bold 11px sans-serif'; ctx.fillStyle = '#ffb36a'; ctx.fillText('최대', cx, b.y + Math.round(fh * 0.4)); ctx.font = '9px sans-serif'; ctx.fillText(C.MAX_MAGIC + ' / ' + C.MAX_MAGIC, cx, b.y + Math.round(fh * 0.4) + 13); }
    }
  };

  /* 스킬 패널 (캐러셀): 전장의 마법 유닛이 가진 마법 전부가 칸으로 늘어서고, 그중 slotsVis칸(가로 모드 3, 세로 모드 4)이 창에 보인다.
     ◀ ▶ 를 누르거나 칸을 좌우로 끌어 넘긴다. 칸 = 원본 행동 아이콘 + 쿨타임 가림막 + 유닛 번호·이름 + 마법 이름 */
  P._drawSkillPanel = function () {
    var ctx = this.ctx, C = CONFIG, D = this.data.fx.icon, icons = this.assets.get('acticons'), p = this.skillPanel, A = this.slotArea, KEYS = ['A', 'S', 'D', 'F'];
    var n = this.slots.length, vis = this.slotsVis, B = this.slotBoxes[0], i, ih = Math.min(D.h, B.h - 22), iw = Math.round(ih * D.w / D.h), T = this.time;
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.font = 'bold 11px sans-serif';
    // 머리줄: 마법 유닛 칩(작은 그림 + 번호) = 현황 표시. 누르면 그 유닛을 고르고 카메라가 그쪽으로 간다. 고른 유닛의 칩은 파란 테두리
    var figs = this.assets.get('figs');
    for (i = 0; i < this.chipBoxes.length; i++) { var cb = this.chipBoxes[i], mu = this.magicUnits[i], ccy = cb.y + cb.h / 2;
      if (!mu) { ctx.strokeStyle = '#2f3647'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.strokeRect(cb.x + 0.5, cb.y + 0.5, cb.w - 1, cb.h - 1); ctx.setLineDash([]); continue; }
      ctx.fillStyle = '#232a3a'; ctx.fillRect(cb.x, cb.y, cb.w, cb.h); ctx.strokeStyle = mu === this.sel ? '#7fb6ff' : '#3a4152'; ctx.lineWidth = mu === this.sel ? 2 : 1; ctx.strokeRect(cb.x + 0.5, cb.y + 0.5, cb.w - 1, cb.h - 1);
      var ch2 = cb.h - 2; ctx.drawImage(figs, mu.t.pid * 36, 0, 36, 43, cb.x + 2, cb.y + 1, Math.round(ch2 * 36 / 43), ch2);
      ctx.fillStyle = '#ffd36e'; ctx.beginPath(); ctx.arc(cb.x + cb.w - 7, ccy, 5, 0, 6.3); ctx.fill();
      ctx.fillStyle = '#10131b'; ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(i + 1, cb.x + cb.w - 7, ccy + 0.5); }
    var lc = this.chipBoxes[this.chipBoxes.length - 1];
    ctx.textAlign = 'left'; ctx.font = '10px sans-serif'; ctx.fillStyle = '#7b8397'; if (n) ctx.fillText('마법 ' + n, lc.x + lc.w + 6, p.y + p.h / 2);
    // ◀ ▶ : 넘길 칸이 있는 쪽만 밝게
    var arrows = [[this.slotPrev, '◀', this.slotFirst > 0], [this.slotNext, '▶', this.slotFirst < n - vis]];
    for (i = 0; i < 2; i++) { var ab = arrows[i][0], on = arrows[i][2];
      ctx.fillStyle = on ? '#2c3550' : '#181c27'; ctx.fillRect(ab.x, ab.y, ab.w, ab.h);
      ctx.textAlign = 'center'; ctx.font = '11px sans-serif'; ctx.fillStyle = on ? '#ffe9b0' : '#3f465a'; ctx.fillText(arrows[i][1], ab.x + ab.w / 2, ab.y + ab.h / 2 + 1); }
    // 빈 창: 점선 칸
    if (!n) { for (i = 0; i < vis; i++) { var e = this.slotBoxes[i]; ctx.strokeStyle = '#2f3647'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.strokeRect(e.x + 1.5, e.y + 1.5, e.w - 3, e.h - 3); ctx.setLineDash([]);
      ctx.textAlign = 'center'; ctx.font = '9px sans-serif'; ctx.fillStyle = '#4a5268'; ctx.fillText('빈 칸', e.x + e.w / 2, e.y + e.h / 2); } return; }
    // 칸들: 창 밖으로 나간 부분은 잘라낸다
    ctx.save(); ctx.beginPath(); ctx.rect(A.x, A.y, A.w, A.h); ctx.clip();
    for (i = 0; i < n; i++) {
      var s = this.slotView[i], vp = (s.vi == null ? i : s.vi) - this.slotPos; if (vp < -1.2 || vp > vis + 0.2) continue;   // 창 밖
      var bx = Math.round(A.x + vp * this.slotStep), cx = bx + B.w / 2, a = s.act, fi = a.icon * 2, vk = i - this.slotFirst, cu = s.unit;
      var stunned = cu.stunUntil > T, far = s.ready() && !stunned && !this.skillTarget(cu, s), poor = this.mana < s.cost, ok = s.ready() && !far && !stunned && !poor;   // far = 쿨타임은 끝났지만 가까이에 대상이 없다. 멈춘 시전자·죽은 시전자는 사용 불가
      ctx.fillStyle = ok ? '#3a2a12' : '#191d27'; ctx.fillRect(bx, B.y, B.w, B.h);
      var aiming = this.aim && this.aim.slot === s;
      ctx.strokeStyle = aiming ? '#7fd6ff' : ok ? '#ffd36e' : '#3a4152'; ctx.lineWidth = aiming ? 3 : 2; ctx.strokeRect(bx + 1, B.y + 1, B.w - 2, B.h - 2);   // 조준 중인 칸은 하늘색 굵은 테두리
      ctx.globalAlpha = ok ? 1 : 0.4; ctx.drawImage(icons, (fi % D.cols) * D.w, Math.floor(fi / D.cols) * D.h, D.w, D.h, Math.round(cx - iw / 2), B.y + 1, iw, ih); ctx.globalAlpha = 1;
      if (s.cd > 0) {                                        // 쿨타임: 위에서부터 걷히는 가림막 + 남은 초(흰 글자·검은 테두리) + 칸 아래 2px 진행 바(남은 비율)
        ctx.fillStyle = 'rgba(0,0,0,.72)'; ctx.fillRect(bx, B.y, B.w, B.h * s.cd / s.cdMax);
        ctx.textAlign = 'center'; ctx.font = 'bold 15px sans-serif'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.9)'; ctx.strokeText(Math.ceil(s.cd), cx, B.y + Math.round(ih / 2) + 2); ctx.fillStyle = '#fff'; ctx.fillText(Math.ceil(s.cd), cx, B.y + Math.round(ih / 2) + 2);
        ctx.fillStyle = '#ffd36e'; ctx.fillRect(bx + 2, B.y + B.h - 4, Math.round((B.w - 4) * s.cd / s.cdMax), 2); }
      else if (stunned) { ctx.textAlign = 'center'; ctx.font = 'bold 11px sans-serif'; ctx.fillStyle = '#c9d1e3'; ctx.fillText('멈춤', cx, B.y + Math.round(ih / 2) + 2); }
      ctx.textAlign = 'center'; ctx.font = '9px sans-serif';
      ctx.fillStyle = '#dfe6f5'; ctx.fillText(this._fit(a.name, B.w - 6), cx, B.y + B.h - 18);
      if (far) { ctx.fillStyle = '#e08a6a'; ctx.fillText(s.needsFoe() ? '적이 멀다' : '아군 없음', cx, B.y + B.h - 7); }
      else { ctx.font = 'bold 11px sans-serif'; ctx.fillStyle = poor ? '#e0584a' : '#8fc7ff'; ctx.fillText(s.cost, cx, B.y + B.h - 7); ctx.font = '9px sans-serif'; }   // 마나 값: 모자라면 빨강 (소환 버튼과 같은 표기)
      // 왼쪽 위: 단축키(보이는 칸만), 오른쪽 위: 이 마법을 가진 유닛의 번호 (유닛 머리 위 번호와 같다)
      if (vk >= 0 && vk < vis) { ctx.textAlign = 'left'; ctx.fillStyle = '#8a93a8'; ctx.fillText(KEYS[vk], bx + 4, B.y + 8); }
      ctx.fillStyle = ok ? '#ffd36e' : '#59607a'; ctx.beginPath(); ctx.arc(bx + B.w - 9, B.y + 9, 6, 0, 6.3); ctx.fill();
      ctx.fillStyle = '#10131b'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(this.magicUnits.indexOf(s.unit) + 1, bx + B.w - 9, B.y + 9.5);
    }
    ctx.restore();
  };

  /* 글자가 칸보다 길면 끝을 … 로 줄인다 */
  P._fit = function (str, w) { var ctx = this.ctx; if (ctx.measureText(str).width <= w) return str; while (str.length > 1 && ctx.measureText(str + '…').width > w) str = str.slice(0, -1); return str + '…'; };

  /* 시작 / 승리 / 패배 화면. 줄마다 [글, 글자 크기, 색, 위 여백]. 화면보다 긴 줄은 띄어쓰기에서 꺾어 여러 줄로 (세로 모드는 가로가 좁다) */
  P._drawOverlay = function () {
    var ctx = this.ctx, W = this.W, H = this.H, sc = this.screen, G = '#9aa3b8', items;
    ctx.fillStyle = 'rgba(5,7,12,.78)'; ctx.fillRect(0, 0, W, H);
    if (sc === 'title') items = [['거울전쟁 디펜스', 28, '#ffd36e', 0], ['해골 군단을 막아 성을 지키세요', 14, '#dfe6f5', 14],
      ['탭을 골라 해방부대 유닛을 소환합니다', 12, G, 12],
      ['마법 유닛은 3기까지 — 소환하면 그 유닛의 마법이 스킬 칸에 생깁니다 (많으면 좌우로 넘기기)', 12, G, 6],
      ['마법도 마나를 씁니다 — 소환과 마법 중 어디에 쓸지 고르세요. 적을 쓰러뜨리면 마나를 얻습니다', 12, G, 6],
      ['적에게 쓰는 마법은 칸을 누른 뒤 전장에서 쓸 곳을 누릅니다', 12, G, 6],
      ['전장의 마법 유닛을 누르면 [회수] 버튼 — 남은 체력만큼 마나를 돌려받습니다', 12, G, 6],
      ['[성 배치]를 켜고 궁수·명궁·창검사·마법사·장로를 소환하면 성에서 적을 쏩니다', 12, G, 6],
      ['전장은 좌우로 깁니다 — 화면을 끌거나 위쪽 막대를 눌러 둘러보세요', 12, G, 6], ['화면을 눌러 시작', 16, '#fff', 18],
      // 팬 게임 고지 (사용자 2026-11-12 확정 문구) — 전장 시뮬 페이지 하단과 같은 문장
      ['이 게임은 원작 「거울전쟁」에 대한 팬심으로 만든 비영리 팬 게임입니다.', 10, '#7b8397', 22],
      ['원작 자산의 저작권은 제작사 L&K Logic Korea에 있으며, 요청이 있으면 즉시 내리겠습니다.', 10, '#7b8397', 4]];
    else if (sc === 'win') items = [['스테이지 클리어!', 28, '#8fe89a', 0], ['처치 ' + this.kills + '   ·   남은 기지 체력 ' + Math.ceil(this.baseHp), 14, '#dfe6f5', 14], ['화면을 눌러 다시 하기', 16, '#fff', 22]];
    else items = [['게임 오버', 28, '#ff7a6a', 0], ['웨이브 ' + Math.min(this.wave + 1, CONFIG.WAVES.length) + ' 에서 기지가 무너졌습니다', 14, '#dfe6f5', 14], ['화면을 눌러 다시 하기', 16, '#fff', 22]];
    var lines = [], total = 0, maxW = W - 28, self = this;
    items.forEach(function (it) { ctx.font = (it[1] <= 10 ? '' : 'bold ') + it[1] + 'px sans-serif';
      self._wrap(it[0], maxW).forEach(function (ln, k) { var gap = k ? 3 : it[3], lh = Math.round(it[1] * 1.25); lines.push([ln, it[1], it[2], gap, lh]); total += gap + lh; }); });
    var y = Math.max(8, Math.round((H - total) / 2));
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    lines.forEach(function (l) { y += l[3]; ctx.font = (l[1] <= 10 ? '' : 'bold ') + l[1] + 'px sans-serif'; ctx.fillStyle = l[2]; ctx.fillText(l[0], W / 2, y + l[4] / 2); y += l[4]; });
    ctx.textAlign = 'left';
  };
  /* 글을 폭 w 안에 들어가게 띄어쓰기에서 나눈다 (지금 ctx.font 기준) */
  P._wrap = function (str, w) {
    var ctx = this.ctx, words = str.split(' '), out = [], line = '';
    words.forEach(function (wd) { var t = line ? line + ' ' + wd : wd; if (line && ctx.measureText(t).width > w) { out.push(line); line = wd; } else line = t; });
    if (line) out.push(line); return out;
  };

  P._center = function (s, y, size, col) { var ctx = this.ctx; ctx.font = 'bold ' + size + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = col; ctx.fillText(s, this.W / 2, y, this.W - 16); ctx.textAlign = 'left'; };

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
    if (y < this.H - this.hudH) { this._tapField(x, y); return; }   // 전장 (키보드 등으로 들어온 경우 — 포인터는 _bind 가 직접 _tapField 로 보낸다)
    this._aimWas = this.aim ? this.aim.slot : null; this.aim = null;   // 아래 패널의 다른 것을 누르면 조준 취소 (같은 스킬 칸이면 pressSlot 이 취소로 처리)
    this.sel = null;                                         // 아래 패널의 무엇이든 누르면 전장 선택은 풀린다 (칩은 다시 고른다)
    if (inBox(this.garBtn, x, y)) { this.garOn = !this.garOn; return; }
    for (i = 0; i < this.tabBoxes.length; i++) if (inBox(this.tabBoxes[i], x, y)) { this.tab = i; this.btnFirst = 0; return; }
    if (this.btnPrev && inBox(this.btnPrev, x, y)) { this._scrollBtns(-1); return; }
    if (this.btnNext && inBox(this.btnNext, x, y)) { this._scrollBtns(1); return; }
    var bi = this.btnIndexAt(x, y); if (bi >= 0) { this.summon(bi); return; }
    for (i = 0; i < this.chipBoxes.length; i++) if (inBox(this.chipBoxes[i], x, y)) { this.pressChip(i); return; }
    if (inBox(this.slotPrev, x, y)) { this.scrollSlots(-1); return; }
    if (inBox(this.slotNext, x, y)) { this.scrollSlots(1); return; }
    for (i = 0; i < this.slotBoxes.length; i++) if (inBox(this.slotBoxes[i], x, y)) { this.pressVisible(i); return; }
  };

  /* 진행 막대를 누르거나 그 위에서 끌면: 그 지점이 화면 가운데에 오도록 카메라를 옮긴다 */
  P._miniPan = function (x) { var m = this.miniBox; this.panTo((x - m.x) / m.w * CONFIG.WORLD_W - this.W / 2); };

  P.start = function () {
    this.reset(); this.screen = 'play';
    if (this.soundOn && !this.bgm.on) { this.bgm.set(0); this.bgm.toggle(); }
    // 휴대폰: 전체 화면을 시도한다 (지원하지 않는 브라우저에서는 조용히 넘어간다). 세로 전용
    try { var el = document.documentElement, p = root.matchMedia && root.matchMedia('(pointer: coarse)').matches && el.requestFullscreen ? el.requestFullscreen() : null;
      var lock = function () { try { var o = root.screen && root.screen.orientation; if (o && o.lock) { var q = o.lock('portrait'); if (q && q.catch) q.catch(function () {}); } } catch (e2) {} };   // 세로 고정 (안드로이드 Chrome 전체 화면에서만 됨, iOS Safari 는 무시)
      if (p && p.then) p.then(lock, function () {}); else lock(); } catch (err) {}
  };

  P.toggleSound = function () { this.soundOn = !this.soundOn; this.sfx.on = this.soundOn; if (this.bgm.on !== this.soundOn && this.screen !== 'title') this.bgm.toggle(); };

  /* 단축키 (PC): 1~7 소환, Q·W·E·R 탭, A·S·D 보이는 스킬 칸, Z·X 스킬 칸 넘기기, ←·→ 카메라, M 소리, 스페이스·엔터 시작/다시 하기 */
  P._bind = function () {
    var self = this, cv = this.cv;
    /* 누르기: 버튼이면 바로 실행, 진행 막대면 그곳으로 이동, 전장이면 끌어서 카메라 옮기기 시작 */
    cv.addEventListener('pointerdown', function (e) {
      e.preventDefault(); var p = self._pos(e), x = p[0], y = p[1], m = self.miniBox; if (self.aim) self.aimPt = { x: x, y: y };
      if (self.screen === 'play' && x >= m.x - 6 && x <= m.x + m.w + 6 && y >= m.y - 6 && y <= m.y + m.h + 6) { self.drag = { mini: true, id: e.pointerId }; self._miniPan(x); return; }
      // 전장: 손을 뗄 때까지 지켜본다 — 6px 넘게 끌면 카메라 이동(그때부터 따라온다), 끌지 않고 떼면 탭(유닛 선택·회수 버튼)
      if (self.screen === 'play' && y < self.H - self.hudH && !inBox(self.soundBtn, x, y)) { self.sfx.unlock(); self.drag = { field: true, x: x, y: y, cam: self.cam.x, moved: false, id: e.pointerId }; try { cv.setPointerCapture(e.pointerId); } catch (err) {} return; }
      // 스킬 칸·소환 줄 위: 바로 누르지 않고, 손을 뗄 때까지 지켜본다 — 그대로 떼면 "누르기", 옆으로 끌면 "캐러셀 넘기기" (HUD 안이라 카메라 이동과 겹치지 않는다)
      if (self.screen === 'play' && inBox(self.slotArea, x, y)) { self.sfx.unlock(); self.drag = { slots: true, x: x, y: y, first: self.slotFirst, moved: false, id: e.pointerId }; try { cv.setPointerCapture(e.pointerId); } catch (err) {} return; }
      if (self.screen === 'play' && self.btnArea && y >= self.btnArea.y && y <= self.btnArea.y + self.btnArea.h) { self.sfx.unlock(); self.drag = { btn: true, x: x, y: y, first: self.btnFirst, moved: false, id: e.pointerId }; try { cv.setPointerCapture(e.pointerId); } catch (err) {} return; }
      self._tap(x, y);
    });
    cv.addEventListener('pointermove', function (e) {
      var p = self._pos(e); if (self.aim) self.aimPt = { x: p[0], y: p[1] };   // 조준 중: 가리키는 곳에 반경 원 (마우스는 움직이기만 해도, 터치는 누르고 있는 동안)
      var d = self.drag; if (!d || d.id !== e.pointerId) return;
      if (d.mini) self._miniPan(p[0]);
      else if (d.slots) { var dx = p[0] - d.x; if (Math.abs(dx) > 8) d.moved = true; if (d.moved) { self.slotFirst = d.first; self.scrollSlots(-Math.round(dx / self.slotStep)); } }
      else if (d.btn) { var bx = p[0] - d.x; if (Math.abs(bx) > 8) d.moved = true; if (d.moved) { self.btnFirst = d.first; self._scrollBtns(-Math.round(bx / self.btnStep)); } }
      else if (d.field) { if (!d.moved && Math.hypot(p[0] - d.x, p[1] - d.y) > 6) d.moved = true; if (d.moved) self.panTo(d.cam - (p[0] - d.x)); }   // 끌기로 판정된 뒤에만 전장이 손가락을 따라온다 (손가락 떨림에 화면이 밀려 탭이 어긋나지 않게)
    });
    var endDrag = function (e) { var d = self.drag; if (!d || d.id !== e.pointerId) return; self.drag = null;
      if ((d.slots || d.btn) && !d.moved && e.type === 'pointerup') self._tap(d.x, d.y);   // 끌지 않고 뗐다 = 그 칸을 눌렀다
      if (d.field && !d.moved && e.type === 'pointerup') self._tapField(d.x, d.y); };   // 전장을 끌지 않고 뗐다 = 탭
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
      var ti = 'QWER'.indexOf(kc), si = 'ASDF'.indexOf(kc);
      if (kc && ti >= 0 && ti < CONFIG.TABS.length) { self.tab = ti; self.btnFirst = 0; }
      else if (kc && si >= 0 && si < self.slotsVis) self.pressVisible(si);
      else if (kc === 'Z') self.scrollSlots(-1);
      else if (kc === 'X') self.scrollSlots(1);
      else if (kc === 'M') self.toggleSound();
      else if (e.key === 'Escape') { self.aim = null; self.sel = null; }   // 조준·선택 취소
      else if (kc === 'G' && self.screen === 'play') self.garOn = !self.garOn;   // 성 배치 켜기/끄기
    });
    // 다른 탭으로 가면 멈춘다
    document.addEventListener('visibilitychange', function () { self.paused = document.hidden; });
  };

  DefenseGame.CONFIG = CONFIG; DefenseGame.SkillSlot = SkillSlot;
  MWE.DefenseGame = DefenseGame;
})(window);
