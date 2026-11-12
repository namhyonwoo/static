/* UnitType: 원본 데이터 한 종(unitdata.mwd + unitNN.mwa)을 감싼 불변 객체.
   Unit: 전장 위의 한 기. 종류별 차이는 상속이 아니라 type 데이터와 Rules로 표현한다. */
(function (root) {
  'use strict';
  var MWE = root.MWE;

  function UnitType(d) {
    this.id = d.id; this.name = d.name; this.fac = d.fac; this.morph = !!d.morph; this.pid = d.pid == null ? d.id : d.pid;   // morph: 변형 형태(직접 생산·배치하지 않음), pid: 초상화에 쓸 원래 유닛
    this.hp = d.hp; this.atk = d.atk; this.def = d.def; this.spd = d.spd;   // 필드 의미는 추정
    this.walkPx = d.walkPx || 6;        // 걷기 한 프레임의 가로 이동량(px) — unitNN.mwa의 이동량 표
    this.size = d.size || [14, 9];       // 원본 크기 사각형 반폭·반높이(픽셀) — unitdata +0x22/+0x24 (분석 8-31)
    this.h = d.h || 48;                  // 그림 높이(픽셀) — unitdata +0x26. 부착 이펙트(베리어·실드)를 띄우는 기준 (FUN_004f7490, 분석 8-32)
    this.rad = Math.max(0.3, this.size[0] / 33);   // 목업 충돌 반지름(칸): 전사(14) 0.42 → 전사끼리 0.85칸, 엔트(30) 0.91 (목업 환산)
    this.sight = d.sight || 7;          // 시야(타일) — unitdata +0x34 (던전 지형에서 5로 제한되는 값)
    this.race = d.race || 0;            // unitdata +0x1C: 종족 (5 언데드, 6 흡혈귀·늑대인간·도펠갱거·메두사 … 분석 8-36)
    this.immune = !!d.immune;           // unitdata +0x54: 특수 효과(중독·마비·흡혈 등)를 받지 않음
    this.moveClass = d.mc;            // 원본 +64: 4 = 지상, 5 = 물 위도 통과
    this.fly = d.fly; this.alt = d.fly ? d.alt : 0;
    this.ranged = !!d.ranged;         // 가상 분류
    this.acts = d.acts || []; this.ai = d.ai == null ? -1 : d.ai;   // 원본 행동 목록(actionData.mwd)과 기본 공격 행동 번호. -1 = 공격 행동 없음
    this.cost = d.cost || [0, 0, 0, 0, 0]; this.btime = d.btime || 0; this.base = !!d.base; this.prod = d.prod || []; this.up = d.up || [];   // 생산 비용(민간인·전사형·마법사형·금·젬), 생산 틱, 전직 대상
    this.upGold = d.upGold || 0; this.upTime = d.upTime || 0; this.upLv = d.upLv || 1;
    this.bon = d.bon || { hp: 0, mp: 0, pop: 0, gold: 0, gem: 0, cap: 0 }; this.regen = !!d.regen;
    this.sups = this.acts.filter(function (a) { return a.sup; });   // 보조 행동(치유·강화·방어막·광폭화·가속)
    this.lv = d.lv || { max: 1, exp: 0, hpGrow: 0, mpGrow: 0, tbl: null };
    this.actions = d.actions || []; this.defGrow = d.defGrow || 0; this.aff = d.aff || []; this.affMul = d.affMul || 8;
    this.icons = d.icons || []; this.mana = d.mana || { max: 0, init: 0 };
    if (MANA_FIX[d.id] != null) this.mana = { max: MANA_FIX[d.id], init: this.mana.init };   // 목업 고유 보정 (아래 MANA_FIX)
    this.snd = d.snd || {};             // 원본 음성: sel 선택, mov 이동, atk 공격, die 사망
    this.img = d.img; this.frames = d.fr; this.anim = d.anim;
  }
  /* 목업 고유 마나 보정: { 유닛 번호: 기본 최대 마나(mana.max) }. 원본 데이터(unitdata.mwd)는 그대로 두고 여기서만 덮어쓴다.
     15 마법전사: 원본 100 + 레벨당 20 → 레벨 1 최대 마나 120이라 아이스 웨폰(마나 150)을 쓸 수 없었다.
     180으로 올려 레벨 1 최대 마나 200 (2026-11-11 아레나 시험에서 발견).
     20·58 소환사(원본 200 + 레벨당 25 → 225), 21 신수사(250 + 25 → 275): 케멘·말다·웨쓰 소환(마나 300)을 쓸 수 없었다.
     275로 올려 셋 모두 레벨 1 최대 마나 300 (2026-11-11 소환 스킬 시험).
     9 도사(원본 100 + 10 → 110 < 텔레포테이션 150) → 140으로 레벨 1 150, 10 의적(90 + 5 → 95 < 셀프 텔레포테이션·암살 100) → 95로 레벨 1 100 (2026-11-11 순간이동 시험).
     나머지(2026-11-11 일괄): 레벨 1 최대 마나가 가진 스킬의 최대 소모 마나와 같아지게 — 24 공주 멀티 챠밍 200, 34 다크로드 레이즈 언데드 150,
     35·63 흡혈귀 박쥐 변신 140, 37 도펠갱거 메타몰포시스 150, 42 서큐버스 챠밍 120, 46 박쥐 슈퍼 소닉 사이트 40, 56 대도 폭발 함정 120,
     62 마녀 윈드 실드 120, 69 거미 거미줄 50, 71 왕자 멀티 슬로우 100. (해골전사·좀비의 합체는 마나 없는 유닛이라 제외 — 원본이 레벨업 후 쓰도록 설계했는지는 미확인) */
  var MANA_FIX = { 9: 140, 10: 95, 15: 180, 20: 275, 21: 275, 58: 275,
    24: 185, 34: 130, 35: 120, 37: 130, 42: 100, 46: 35, 56: 112, 62: 100, 63: 120, 69: 35, 71: 90 };
  UnitType.prototype.canAttack = function () { return this.ai >= 0; };
  UnitType.prototype.maxHpAt = function (lv) { return this.hp + this.lv.hpGrow * lv; };                    // FUN_0044f230
  UnitType.prototype.maxMpAt = function (lv) { return this.mana.max ? this.mana.max + this.lv.mpGrow * lv : 0; };

  var nextId = 1;
  function Unit(type, fac, x, y) {
    this.uid = nextId++; this.t = type; this.fac = fac; this.x = x; this.y = y; this.level = 1; this.exp = 0; this.maxHp = type.maxHpAt(1); this.hp = this.maxHp; this.maxMp = type.maxMpAt(1); this.mp = this.maxMp;
    this.act = type.ai >= 0 ? type.acts[type.ai] : null;   // 지금 쓰는 공격 행동 (스킬 버튼으로 바꿀 수 있다)
    this.row = 4; this.mir = false;             // 스프라이트 방향 (5방향 + 좌우 반전)
    this.state = 'idle';                        // idle | move | attack | dead
    this.order = null; this.tgt = null;
    this.at = 0; this.cd = 0; this.hitDone = false; this.walkT = 0; this.deadT = 0; this.blockT = 0;   // blockT: 방패 막기 자세를 취한 시간(초), 0 = 막고 있지 않음
    this.buffs = {};                              // weapon·shield·berserk·haste → {k1,k2,until}
    this.path = null; this.pgx = 0; this.pgy = 0; this.repath = 0;
  }
  var P = Unit.prototype;
  P.alive = function () { return this.state !== 'dead' && this.state !== 'inside'; };   // 전장에 나와 있는가
  P.living = function () { return this.state !== 'dead'; };                                // 건물 안 포함
  /* 전직·부활 등으로 종류나 레벨이 바뀔 때 수치를 다시 맞춘다 */
  P.setType = function (type) { this.t = type; this.maxHp = type.maxHpAt(this.level); this.hp = Math.min(this.hp, this.maxHp); this.maxMp = type.maxMpAt(this.level); this.mp = Math.min(this.mp, this.maxMp); this.act = type.ai >= 0 ? type.acts[type.ai] : null; };
  /* 경험치를 더하고 레벨을 올린다 (FUN_0044ea80 / FUN_0044f230). 올랐으면 true */
  P.gainExp = function (n) {
    var lv = this.t.lv, T = lv.tbl; if (!T || this.level >= lv.max) return false;
    this.exp += n; var L = this.level; while (L < lv.max && L < T.length && this.exp >= T[L]) L++;
    if (L === this.level) return false;
    this.level = L; var mh = this.t.maxHpAt(L); this.hp += mh - this.maxHp; this.maxHp = mh; this.maxMp = this.t.maxMpAt(L); return true;
  };
  P.distTo = function (o) { return Math.hypot(this.x - o.x, this.y - o.y); };
  /* 타일 좌표상의 이동 벡터 → 화면 방향 (0 뒤 … 4 앞, 동쪽 절반은 반전) */
  P.face = function (dx, dy) {
    var sdx = (dx - dy) * 32, sdy = (dx + dy) * 16; if (!sdx && !sdy) return;
    var a = Math.atan2(sdx, -sdy) * 180 / Math.PI; if (a < 0) a += 360;
    var t = a, m = true; if (t > 180) { t = 360 - t; m = false; }
    var row = Math.round(t / 45); if (row > 4) row = 4;
    this.row = row; this.mir = m;
  };
  /* 현재 상태에 해당하는 스프라이트 프레임 번호 (-1 = 그리지 않음) */
  P.frameIndex = function (fps) {
    fps = fps || 12;
    var A = this.t.anim;
    if (this.state === 'dead') return A.die ? A.die.f[Math.min(A.die.n - 1, Math.floor(this.deadT * fps))] : -1;
    if (this.state === 'attack' && A.atk) return A.atk.f[this.row * A.atk.n + Math.min(A.atk.n - 1, Math.floor(this.at))];
    if (this.state === 'move') return A.walk.f[this.row * A.walk.n + Math.floor(this.walkT * fps) % A.walk.n];
    /* 방패 막기 (unitNN.mwa 레코드 2): 방패를 들어 올려 이벤트 프레임에서 멈추고, 효과가 이어지는 동안 서 있을 때 그 자세를 유지한다 */
    if (A.block && this.blockT > 0) return A.block.f[this.row * A.block.n + Math.min(A.block.ev, A.block.n - 1, Math.floor(this.blockT * fps))];
    return A.idle[this.row];
  };
  MWE.UnitType = UnitType; MWE.Unit = Unit;
})(typeof window !== 'undefined' ? window : globalThis);
