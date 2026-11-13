/* Rules: 게임마다 갈아끼우는 규칙 묶음. World는 이 인터페이스만 호출한다.
   MockRules는 시연용 가상 규칙이다 — 원본 전투 공식이 확인되면 OriginalRules를 추가해 교체한다. */
(function (root) {
  'use strict';
  var MWE = root.MWE;

  function MockRules() {}
  var P = MockRules.prototype;
  P.damage = function (a, b) { return Math.max(1, Math.round(a.t.atk - b.t.def / 2)); };
  P.range = function (u) { return u.t.ranged ? 6 : 1.4; };          // 타일
  P.speed = function (u) { return 1.3 + u.t.spd * 0.2; };           // 타일/초
  P.cooldown = function (u) { return 0.45; };
  P.aggro = function (u) { return u.t.ranged ? 8.5 : 7; };
  P.leash = function (u) { return 11; };
  P.shotSpeed = function (u) { return 16; };
  P.animRate = function (u) { return 12; };                         // 공격 프레임/초
  /* 목표 선택: 가장 가까운 적. 자동전투에서는 이 메서드만 바꿔도 성격이 달라진다. */
  P.pickTarget = function (u, world, radius) {
    var best = null, bd = radius, L = world.units;
    var wild = this.buff ? this.buff(u, 'berserk') : null;      // 광폭화 중에는 지상 유닛만 노린다
    var groundOnly = wild || (u.act && u.act.groundOnly);      // 광폭화: 같은 종류(늑대인간)만 빼고 아군·적군 가리지 않고 공격 (사용자 제보 + 나무위키 악령군 문서, 원본 코드로는 미확인)
    for (var i = 0; i < L.length; i++) { var o = L[i]; if (o === u || !o.alive() || (groundOnly && o.t.fly === 2) || (wild ? o.t.name === u.t.name : o.fac === u.fac) || (o.buffs.hide && o.buffs.hide.until > world.time)) continue;
      var d = u.distTo(o); if (d < bd) { bd = d; best = o; } }
    return best;
  };
  P.inRange = function (u, t, map) { return u.distTo(t) <= this.range(u); };
  P.manaCost = function (u) { return 0; };
  P.manaRegen = function (u) { return 0; };                          // 초당
  P.killExp = function (k, v) { return 0; };
  P.projectile = function (u) { return -1; };                       // 발사체 그림 번호 (-1 = 점)
  MWE.MockRules = MockRules;

  /* OriginalRules: 원본 실행 파일에서 읽은 전투 공식.
       공격값 = k1×레벨÷8 + k2×공격력÷8            (FUN_004b83d0, k1·k2는 행동 데이터)
       방어값 = 방어력 + 방어성장×레벨÷4           (FUN_004b8000)
       상성    = 공격자 상성표에 대상이 있으면 공격값×배수÷8   (FUN_004ace80)
       피해    = 공격값 − 방어값. 1 미만이면 rand%(1−피해) > 9 일 때 빗나감, 아니면 1  (FUN_004b75e0)
     사거리는 행동 데이터 값÷10 픽셀로 해석했다(추정). 레벨은 1로 고정, 마나·버프·상태 보정은 뺐다.
     레벨·경험치·마나 회복(11틱마다 +1) 포함. 발사체 속도 단위와 보조 행동의 효과 식은 추정.
     공격 행동이 없는 유닛(소환·보조 전용)은 원본대로 공격하지 않는다. */
  var WEAPON = { 6: 12, 9: 16, 10: 14, 34: 14 };          // 파이어 웨폰 ×12/8, 매직 웨폰 ×2, 아이스 웨폰·다크웨폰 ×14/8
  var SHIELD = { 7: 20, 19: 20, 35: 20, 76: 20, 43: 16 };   // 파운틴·이블 스피리츠 베리어·토네이도 실드 ×20/8, 윈드 실드 ×2
  function OriginalRules(arms) { this.arms = arms || {}; this.tps = 12; this.now = 0; }   // tps: 원본 시뮬레이션 틱/초. 게임 속도 0~4 = 6.0 / 9.0 / 12.0 / 14.1 / 16.1 (FUN_0055d570)
  OriginalRules.SPEEDS = [6.02, 9.01, 12.05, 14.08, 16.13];
  /* 한 번의 공격 동작에서 기본 타격(이벤트 프레임) 말고 더 치는 프레임 — 행동 번호별 (원본 FUN_004c1e10 등 공격 작업, 분석 8-41).
     5 에로우 샤워(명궁): 프레임 10·12·14에 화살을 한 발씩 더 (모두 네 발).  7 컴비네이션 어택(무도가): 프레임 4에 한 번 더 */
  OriginalRules.EXTRA_HITS = { 5: [10, 12, 14], 7: [4] };
  var O = OriginalRules.prototype = Object.create(MockRules.prototype);
  O.buff = function (u, k) { var b = u.buffs[k]; return b && b.until > this.now ? b : null; };
  O.attackValue = function (a) {
    var c = a.act, v = ((c.k1 * a.level) >> 3) + ((c.k2 * a.t.atk) >> 3), w = this.buff(a, "weapon");
    if (w && WEAPON[w.arm]) v = (v * WEAPON[w.arm]) >> 3;                              // 무기 강화: 원본 배수 (FUN_004b83d0의 상태 6·9·10·0x22 = 이펙트 번호)
    if (this.buff(a, "meltw")) v = 1;                                                // 멜팅 웨폰: 공격값 1 (FUN_004b83d0 상태 0xD)
    if (this.buff(a, "berserk")) v = (v * 12) >> 3;                                   // 광폭화: 원본 ×12/8 (FUN_004b83d0)
    return v;
  };
  O.defenseValue = function (b) {
    var d = b.t.def + ((b.t.defGrow * b.level) >> 2), s = this.buff(b, "shield");
    if (s) d = (d * (SHIELD[s.arm] || 16)) >> 3;                                       // 방어막: 원본 배수 (FUN_004b8000의 상태 7·0x13·0x23·0x4c ×20/8, 0x2b ×2, 방패 막기 ×2)
    if (this.buff(b, "melta")) d = 0;                                                // 멜팅 아머: 방어값 0 (FUN_004b8000 상태 0x29)
    if (this.buff(b, "berserk")) d = (d * 10) >> 3;                                   // 광폭화: 원본 ×10/8 (FUN_004b8000)
    return d;
  };
  /* 이동 속도: 틱마다 걷기 프레임 1장, 그 프레임의 이동량만큼 (FUN_004e7290) */
  O.animRate = function (u) { return this.tps; };
  O.speed = function (u) { return u.t.walkPx * this.tps / 45.25 * (this.buff(u, "haste") ? 1.5 : 1) * (this.buff(u, "slow") ? 0.5 : 1); };   // 가속 배수는 추정
  /* 치유 (FUN_004b87d0): 남은 마나 × k ÷ 2 만큼, 부족분까지만. k = 4(힐링·다크 힐링), 3(파워 힐링). 쓴 만큼 마나 차감.
     대상에 상태 이상이 있으면 그 시전은 해제만 한다 (힐링 기준 비용: 매혹 200, 석화 150, 약화 80, 중독 60, 마비·감속 20) */
  O.heal = function (u, t, a) {
    var cost = { charm: 200, stone: 150, melt: 80, poison: 60, slow: 20 }, top = 0, k;
    for (k in cost) if (t.buffs[k] && t.buffs[k].until > this.now && u.mp >= cost[k]) { top = Math.max(top, cost[k]); if (k === 'charm') t.fac = t.buffs.charm.orig; delete t.buffs[k]; }
    if (top) { u.mp -= top; return; }
    var kk = a.arm === 48 ? 3 : 4, need = t.maxHp - t.hp, can = Math.floor(u.mp * kk / 2);
    if (can < need) { t.hp += can; u.mp = 0; } else { t.hp = t.maxHp; u.mp -= Math.floor(need * 2 / kk); }
  };
  O.aoeRadius = function (u) { return 2; };                                           // 범위 공격 반경(타일)은 추정
  O.supRange = function (a) { return Math.max(1.5, a.range / 10 / 45.25); };
  O.supDuration = function (a) { return (a.dur || 120) / this.tps; };                 // 지속 시간: 행동 +0x3E 틱
  O.damage = function (a, b, rng) {
    var c = a.act; if (!c) return 0;
    var atk = this.attackValue(a);
    if (c.type === 2 && rng.next() * 100 < 67) atk *= 3;
    if (c.id === 7) atk = (atk * 7) >> 3;                                             // 컴비네이션 어택 ×7/8 (FUN_004ac6f0)
    if (a.t.aff.indexOf(b.t.id) >= 0) atk = (a.t.affMul * atk) >> 3;
    var d = atk - this.defenseValue(b);
    if (d < 1) { if (Math.floor(rng.next() * 32768) % (1 - d) > 9) return 0; d = 1; }
    return d;
  };
  O.range = function (u) { var c = u.act; return c ? c.range / 10 / 45.25 : 0; };
  /* 사거리 판정 (FUN_004eaf70과 같은 식): 월드 픽셀 차 dx,dy로
       D = dy×2 < dx ? dx×10 + dy×8 : dx×4 + dy×20   (세로를 2배로 본 팔각 근사, 단위 0.1px)
       D ≤ 사거리 + (공격자 고도 − 대상 고도) × 고도 보정(행동 +0x42)  이면 사거리 안 */
  O.inRange = function (u, t, map) {
    var c = u.act; if (!c) return false;
    var ax = t.x - u.x, ay = t.y - u.y, dx = Math.abs(ax - ay) * 32, dy = Math.abs(ax + ay) * 16;
    var D = dy * 2 < dx ? dx * 10 + dy * 8 : dx * 4 + dy * 20;
    return D <= c.range + (map.levelAt(u.x, u.y) - map.levelAt(t.x, t.y)) * c.elev;
  };
  O.manaCost = function (u) { var c = u.act; return c ? c.mana : 0; };
  O.manaRegen = function (u) { return this.tps / 11; };              // 원본: 11틱마다 마나 +1 (FUN_004515c0)
  /* 공격 간격 (FUN_004548d0): 행동 +0x26 틱 + rand % (틱÷4 + 1) */
  /* 공격 뒤 다음 공격까지의 대기(초). 원본 FUN_004dace0 (분석 8-38): 기다릴 틱 = 행동 +0x26 지연 + rand % (지연/4 + 1).
     유닛 상태 +0x40 이 1(가속: 케멘 소환·헤이스트)이면 **대기 없이 바로** 다시 공격하고, 2(감속)이면 3배를 기다린다 */
  O.extraHits = function (act) { return (act && OriginalRules.EXTRA_HITS[act.id]) || null; };
  O.cooldown = function (u, rng) { var c = u.act; if (!c) return 1; var d = (c.delay + Math.floor(rng.next() * 32768) % ((c.delay >> 2) + 1)) / this.tps;
    return this.buff(u, "haste") ? 0 : this.buff(u, "slow") ? d * 3 : d; };
  /* 발사체 속도: armData +56 = 틱당 가로 픽셀 (FUN_004aba40) */
  O.shotSpeed = function (u) { var c = u.act, a = c && this.arms[c.arm]; return a && a.spd > 0 ? a.spd * this.tps / 45.25 : 16; };
  /* 처치 경험치 (FUN_004b75e0): 대상의 +0x2AE 를 레벨 차로 보정 */
  O.killExp = function (k, v) {
    var e = v.t.lv.exp, d;
    if (v.level < k.level) { d = k.level - v.level; return d < 4 ? (e * 6) >> 3 : d < 7 ? (e * 4) >> 3 : (e * 2) >> 3; }
    d = v.level - k.level;
    return d < 3 ? e : d < 5 ? (e * 10) >> 3 : d < 7 ? (e * 12) >> 3 : d < 11 ? (e * 14) >> 3 : d < 15 ? e * 2 : d < 21 ? (e * 20) >> 3 : e * 3;
  };
  O.aggro = function (u) { return Math.max(7, this.range(u) + 2); };
  O.projectile = function (u) { var c = u.act; return c ? c.arm : -1; };
  MWE.OriginalRules = OriginalRules;
})(typeof window !== 'undefined' ? window : globalThis);
