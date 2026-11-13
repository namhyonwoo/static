/* World: 고정 틱(1/30초) 시뮬레이션. 화면·입력을 모른다.
   같은 시드와 같은 명령열이면 같은 결과가 나온다 → 리플레이·밸런스 시뮬레이션에 그대로 쓴다.
   사건: spawn, attack, strike, shot, impact, miss, hit, death, levelup, capture, cast, reinforce */
(function (root) {
  'use strict';
  var MWE = root.MWE, DT = 1 / 30;

  function World(map, rules, seed) {
    this.map = map; this.rules = rules; this.rng = new MWE.Rng(seed || 1);
    this.path = new MWE.Pathfinder(map); this.events = new MWE.Emitter();
    this.units = []; this.shots = []; this.tickN = 0; this.acc = 0;
    this.seekAll = false; this.time = 0; this.manualHeal = -1;   // manualHeal: 이 진영은 치유를 스스로 쓰지 않는다 (원본: H 키)
    /* 건물: 지상 유닛이 들어가면 그 진영 소유. 안의 유닛 수에 따라 건물 자원을 채취하고, 유닛을 생산한다 (economy.js) */
    this.buildings = (map.blds || []).map(function (b, i) { return { id: i, b: b, x: b.c[0], y: b.c[1], owner: -1, claim: null, capT: 0, pool: b.pool.slice(), inside: [], queue: [] }; });
    this.res = [[0, 5, 5, 800, 0], [60, 10, 10, 0, 0], [30, 0, 0, 0, 90]];   // 진영별 자원: 민간인, 전사형, 마법사형, 금, 젬. 시작 자원은 가상(중립 건물 두세 채를 점령할 만큼)
    this.types = []; this.popCap = 200;   // 원본은 플레이어당 유닛 슬롯 200개 (유닛 번호 ÷ 200 = 플레이어)                 // true면 명령 없는 유닛이 맵 전체에서 적을 찾는다
  }
  var P = World.prototype;
  World.DT = DT;

  P.spawn = function (type, fac, x, y) {
    var p = this.map.nearestWalkable(this.map.clamp(x), this.map.clamp(y), type.moveClass);
    var u = new MWE.Unit(type, fac, p[0], p[1]); u.cd = this.rng.next() * 0.5;
    this.units.push(u); this.events.emit('spawn', u); return u;
  };
  /* ---- 명령 (입력·AI·리플레이가 공통으로 쓰는 유일한 통로) ---- */
  /* tol: 막혔을 때 도착으로 칠 거리(칸). 부대 이동은 부대 크기에 맞춰 넓게 준다 (rts._command) */
  P.orderMove = function (u, x, y, attackMove, tol) {
    if (!u.alive()) return;
    u.order = { type: 'move', x: this.map.clamp(x), y: this.map.clamp(y), amove: !!attackMove, tol: tol || 1.2 }; u.path = null;
    if (u.blink) { var bp = this.map.nearestWalkable(u.order.x, u.order.y, u.t.moveClass); u.x = bp[0]; u.y = bp[1]; u.blink = null; u.order = null; this.events.emit('blink', u); }
    if (!attackMove) u.tgt = null;
  };
  P.orderAttack = function (u, target) { if (u.alive() && u.t.canAttack()) { u.order = { type: 'attack', target: target }; u.tgt = null; u.path = null; } };
  /* 정지 = 위치 사수 (원본 S 키): 사거리 안의 적만 공격하고 움직이지 않는다 */
  P.orderStop = function (u) { u.order = { type: 'hold' }; u.tgt = null; u.path = null; if (u.state === 'move') u.state = 'idle'; };
  P.orderFree = function (u) { u.order = null; u.tgt = null; u.path = null; };

  P.revert = function (u) { if (u.origType) { u.setType(u.origType); u.origType = null; u.morphUntil = 0; } };
  P.typeOf = function (id) { for (var i = 0; i < this.types.length; i++) if (this.types[i].id === id) return this.types[i]; return null; };
  P.countAlive = function () { var c = {}; this.units.forEach(function (u) { if (u.living()) c[u.fac] = (c[u.fac] || 0) + 1; }); return c; };

  /* 실시간 구동: 프레임 시간을 받아 고정 틱으로 나눠 돌린다 */
  P.update = function (dt) { this.acc += Math.min(dt, 0.1); while (this.acc >= DT) { this.step(); this.acc -= DT; } };

  /* 무적 진영 (아레나 시험용, 목업 고유): this.invulnFac 진영 유닛은 피해·중독·마비·암살을 받지 않는다 */
  P.isInvuln = function (u) { return this.invulnFac != null && u.fac === this.invulnFac; };
  P._hurt = function (a, b) {
    if (!b.alive()) return;
    if (this.isInvuln(b)) { this.events.emit('impact', b, this.rules.projectile(a), a); this.events.emit('hit', a, b, 0); return; }
    var d = this.rules.damage(a, b, this.rng), arm = this.rules.projectile(a);
    this.events.emit('impact', b, arm, a);
    if (d <= 0) { this.events.emit('miss', a, b); return; }
    b.hp -= d; this.events.emit('hit', a, b, d);
    var ac = a.act;                                                                   // 행동 종류별 부가 효과 (FUN_004ac6f0)
    if (ac && !b.t.immune) {
      if (ac.type === 4) a.hp = Math.min(a.maxHp, a.hp + d);                          // 흡혈: 준 피해만큼 회복
      else if (ac.type === 11 && this.rng.next() * 100 < 34) b.buffs.stone = { until: this.time + this.rules.supDuration(ac) };   // 마비: 34%
      else if (ac.type === 1) b.buffs.poison = { until: this.time + this.rules.supDuration(ac) };                                 // 중독
    }
    if (b.hp <= 0) this._slay(a, b);
    else if (!b.order && b.state === 'idle' && a.alive() && !b.passive) b.tgt = a;
  };
  P._slay = function (a, b) {
    b.hp = 0; b.state = 'dead'; b.at = 0; b.deadT = 0; b.order = null; b.path = null; b.buffs = {}; b.tp = null; this.events.emit('death', b, a);
    if (a && a !== b && a.alive() && a.gainExp(this.rules.killExp(a, b))) this.events.emit('levelup', a);
  };
  /* 타격: 범위 행동이면 대상 주변의 적 모두에게 */
  P._strike = function (a, t, act) {
    act = act || a.act; if (a.buffs.hide) delete a.buffs.hide;                       // 공격하는 순간 투명이 풀린다 (원본)
    if (!act || !act.aoe) { this._hurt(a, t); return; }
    var r = this.rules.aoeRadius(a), L = this.units, x = t.x, y = t.y;
    for (var i = 0; i < L.length; i++) { var o = L[i]; if (o.fac !== a.fac && o.alive() && Math.hypot(o.x - x, o.y - y) <= r) this._hurt(a, o); }
    if (act.suicide && a.alive()) this._slay(null, a);                                // 자폭
  };
  /* 보조 행동 하나를 시전. 대상이 없거나 마나가 모자라면 false.
     원본 규칙: 치유는 수동(H), 투명은 공격할 때까지 유지, 멜팅·술 소환은 강화 마법을 푼다, 암살은 지상 유닛을 즉사시킨다,
     드래곤·흑기사·엔트·가고일은 특수 공격의 영향을 받지 않는다. 누구에게 쓸지 고르는 판단은 시연용. */
  var MORPH = { 23: 77, 77: 23, 65: 79, 79: 65, 35: 46, 63: 46, 28: 78 };   // 엔트↔지상 엔트, 가고일↔석상, 흡혈귀→박쥐, 해골전사→본월 (unitdata 77~79)
  P._cast = function (u, a, manual, forced) {
    var R = this.rules, L = this.units, j, o, rng = R.supRange(a), tgt = null, best = 1e9;
    if (a.sup === "teleport" || a.sup === "recall" || a.sup === "massheal" || a.sup === "massdispel" || a.sup === "masshaste") return false;   // 땅을 지정하는 행동: orderCast → _teleportCast / _recall / _massHeal (자동 보조로 쓰지 않는다)
    if (u.mp < a.mana || u.cd > 0 || !u.alive()) return false;
    if (forced) { if (!forced.alive() && a.sup !== "raise") return false; if (a.foe && (forced.t.immune || (a.sup === "assassin" && forced.t.fly === 2))) return false; tgt = forced; } else
    if (a.sup === "heal") { for (j = 0; j < L.length; j++) { o = L[j]; if (o.fac !== u.fac || !o.alive() || o.hp >= o.maxHp * (manual ? 1 : 0.75)) continue; var d = u.distTo(o), r = o.hp / o.maxHp; if (d <= rng && r < best) { best = r; tgt = o; } } }
    else if (a.sup === "hide" || a.sup === "sight" || a.sup === "teleport" || a.sup === "morph" || a.sup === "merge") { if (!manual) return false; tgt = u; }
    else if (a.sup === "raise") { for (j = 0; j < L.length; j++) { o = L[j]; if (o.state !== 'dead' || o.deadT > 12) continue; var dr = u.distTo(o); if (dr <= Math.max(rng, 4) && dr < best) { best = dr; tgt = o; } } }
    else {
      var threat = manual; for (j = 0; !threat && j < L.length; j++) { o = L[j]; if (o.fac !== u.fac && o.alive() && u.distTo(o) < 10) threat = true; }
      if (!threat) return false;
      if (a.foe) { for (j = 0; j < L.length; j++) { o = L[j]; if (o.fac === u.fac || !o.alive() || o.t.immune || R.buff(o, a.sup) || (a.sup === "assassin" && o.t.fly === 2)) continue; var df = u.distTo(o); if (df <= rng && df < best) { best = df; tgt = o; } } }
      else if (a.sup === "berserk" || (a.sup === "shield" && a.arm < 0) || a.self) { if (!R.buff(u, a.sup)) tgt = u; }   // a.self = 자기 전용 강화 (원본 행동 +0x3C == 0xFFFF, 분석 8-37)
      else { for (j = 0; j < L.length; j++) { o = L[j]; if (o.fac !== u.fac || !o.alive() || R.buff(o, a.sup) || (a.sup === "weapon" && !o.act)) continue; var dd = u.distTo(o); if (dd <= rng && dd < best) { best = dd; tgt = o; } } }
    }
    if (!tgt) return false;
    if (a.sup !== "heal" && a.sup !== "merge") u.mp -= a.mana;
    u.cd = (a.delay + 10) / R.tps; if (tgt !== u) u.face(tgt.x - u.x, tgt.y - u.y);
    if (a.sup === "heal") R.heal(u, tgt, a);
    else if (a.sup === "assassin") { if (this.isInvuln(tgt)) { this.events.emit("cast", u, tgt, a); return true; } this._slay(u, tgt); u.hp = Math.max(1, Math.floor(u.hp / 5)); }   // 암살: 대상 즉사, 시전자 체력은 1/5로 (FUN_004ac6f0)
    else if (a.sup === "morph") { var MM = (root.MW && root.MW.morph) || MORPH, to = this.typeOf(MM[u.t.id]); if (!to) return false; if (!u.origType) u.origType = u.t; u.setType(to);   // 판마다 다른 표: 원본판은 data.morph (mirrorwar-original/tools/simbuild.js)
      u.morphUntil = 0; }                                                              // 시간 제한 없음. 되돌리기는 revert()
    else if (a.sup === "copy") { if (!u.origType) u.origType = u.t; u.setType(tgt.t); u.morphUntil = 0; }   // 메타몰포시스: 대상 유닛의 모습으로. 되돌리기는 revert()
    else if (a.sup === "raise") { var sk = this.typeOf(28); tgt.deadT = 99; this.spawn(sk, u.fac, tgt.x, tgt.y).made = true; }   // 레이즈 언데드: 시체를 해골전사로 (결과 유닛 추정)
    else if (a.sup === "merge") {                                                   // 합체 (FUN_004f1490, FUN_004585f0): 유령 + 좀비·해골전사 → 리치, 사탄 + 리치 → 다크로드
      var MG = root.MW && root.MW.merge, want = MG ? (MG.from.indexOf(u.t.id) >= 0 ? MG.from.filter(function (k) { return k !== u.t.id || MG.self; }) : null) : u.t.id === 32 ? [31, 28] : u.t.id === 41 ? [33] : null, mate = null, md = 5; if (!want || u.mp < 30) return false;   // 원본판: data.merge = { from: [합칠 수 있는 종류], to: 결과 } (FUN_00442740 — 결과 0x1D 리치)
      for (j = 0; j < L.length; j++) { o = L[j]; if (o.fac !== u.fac || !o.alive() || o === u || want.indexOf(o.t.id) < 0 || o.buffs.charm) continue; var dm = u.distTo(o); if (dm < md) { md = dm; mate = o; } }
      if (!mate) return false; u.mp -= 30; var keep = mate.level > u.level ? mate : u, gone = keep === u ? mate : u;
      gone.state = 'dead'; gone.deadT = 99; gone.hp = 0; keep.x = u.x; keep.y = u.y; keep.origType = null; keep.setType(this.typeOf(MG ? MG.to : u.t.id === 32 ? 33 : 34)); keep.hp = keep.maxHp; keep.mp = Math.floor(keep.maxMp / 3); keep.buffs = {}; tgt = keep; }
    else if (a.sup === "sight") { /* 화면 쪽에서 cast 사건을 받아 안개를 걷는다 */ }
    else { tgt.buffs[a.sup] = { k1: a.k1, k2: a.k2, arm: a.arm, until: a.sup === "hide" ? 1e12 : this.time + R.supDuration(a), orig: tgt.fac, block: a.sup === "shield" && a.arm < 0 };   // block: 방패 막기(이펙트 없는 자기 방어) — 막기 자세를 취한다
      if (tgt.buffs[a.sup].block) tgt.blockT = 0;
      if (a.sup === "meltw" || a.sup === "melta" || a.sup === "dispel" || a.sup === "melt") { delete tgt.buffs.weapon; delete tgt.buffs.shield; delete tgt.buffs.haste; delete tgt.buffs.berserk; if (a.sup === "dispel") delete tgt.buffs.dispel; }   // 강화 마법 해제
      if (a.sup === "charm") { tgt.fac = u.fac; tgt.order = null; tgt.tgt = null; tgt.path = null; } }
    this.events.emit("cast", u, tgt, a); return true;
  };
  /* 대상을 지정한 시전 명령: 사거리 밖이면 다가가서 쓴다. 순간이동은 지정한 땅으로 바로 */
  P.orderCast = function (u, a, target, x, y, skip) {
    if (!u.alive() || !a) return;
    if (a.sup === "teleport") { this._teleportCast(u, a, this.map.clamp(x), this.map.clamp(y), skip); return; }
    u.order = { type: 'cast', a: a, target: target, x: x, y: y }; u.tgt = null; u.path = null;
  };
  /* 지점 범위 타격: (x,y) 주변의 적 모두에게 행동 a의 피해. 자기 주변 공격도 이것으로 */
P._blast = function (u, a, x, y) {
    if (u.mp < a.mana || u.cd > 0 || !u.alive()) return false;
    var R = this.rules, L = this.units, r = R.aoeRadius(u), keep = u.act, self = this;
    if (a.hpCost) { var hc = Math.floor(u.maxHp / a.hpCost); if (u.hp <= hc) return false; u.hp -= hc; }   // 체력을 쓰는 행동 (원본 조건 문구: 체력 1/10·1/4 이상 가능)
    u.mp -= a.mana; u.cd = a.dmg ? R.cooldown(u, this.rng) : (a.delay + 10) / R.tps; u.act = a; if (u.buffs.hide) delete u.buffs.hide;
    u.face(x - u.x, y - u.y);
    var HO = MWE.OriginalRules.HOLY, holy = HO && a.arm === HO.arm;
    if (holy) { var hv = R.attackValue(u) + HO.heal;        // 홀리 크로스: 범위 안의 아군(시전자 포함)은 회복 + 상태 이상 해제 (분석 8-43)
      for (var hi = 0; hi < L.length; hi++) { var ho = L[hi]; if (!ho.alive() || ho.fac !== u.fac || Math.hypot(ho.x - x, ho.y - y) > r) continue;
        ho.hp = Math.min(ho.maxHp, ho.hp + hv); ['stone', 'meltw', 'melta', 'slow', 'poison'].forEach(function (k) { delete ho.buffs[k]; }); } }
    for (var i = 0; i < L.length; i++) { var o = L[i];
      if (o === u || !o.alive() || Math.hypot(o.x - x, o.y - y) > r || (!a.ff && o.fac === u.fac) || (a.groundOnly && o.t.fly === 2)) continue;
      if (a.dmg) { this._hurt(u, o);
        if (holy && o.alive() && o.t.race === HO.race && !o.t.immune) { o.buffs.stone = { arm: a.arm, until: this.time + HO.stoneTicks / R.tps, orig: o.fac }; delete o.buffs.weapon; delete o.buffs.shield; delete o.buffs.haste; delete o.buffs.berserk; o.order = null; o.tgt = null; o.path = null; } }   // 언데드는 석화
      else if (a.sup && !o.t.immune && !(a.races && a.races.indexOf(o.t.race) < 0)) {           // 범위 약화. a.races = 걸리는 종족(유닛 종류 +0x1C): 턴 언데드 [5], 디스트로이 언홀리 [5, 6] (분석 8-36)
        o.buffs[a.sup] = { k1: a.k1, k2: a.k2, arm: a.arm, until: this.time + R.supDuration(a), orig: o.fac }; if (a.drain) o.mp = 0;
        if (a.sup === 'stone' && a.races) { delete o.buffs.weapon; delete o.buffs.shield; delete o.buffs.haste; delete o.buffs.berserk; o.order = null; o.tgt = null; o.path = null; } }   // 원본은 석화와 함께 강화(+0x34·+0x2C·+0x40 …)를 전부 지우고 작업을 멈춘다
    }
    u.act = keep; this.events.emit('cast', u, { x: x, y: y, t: { alt: 0 } }, a);
    if (a.suicide && u.alive()) this._slay(null, u); return true;
  };
  /* 대상이 필요 없는 행동을 바로 쓴다: 자기 주변 공격, 주변 적 전체 약화, 자기·자동 대상 보조 */
  P.castNow = function (u, a) {
    if (a.dmg) return this._blast(u, a, u.x, u.y);
    if (a.area && !a.foe) { if (u.mp < a.mana || u.cd > 0) return false; var RR = this.rules, rr = RR.supRange(a), me = this; u.mp -= a.mana; u.cd = (a.delay + 10) / RR.tps;   // 주변 아군 전체 강화 (케멘 소환)
      this.units.forEach(function (o) { if (o.fac === u.fac && o.alive() && u.distTo(o) <= Math.max(rr, 5)) o.buffs[a.sup] = { k1: a.k1, k2: a.k2, arm: a.arm, until: me.time + RR.supDuration(a) }; });
      this.events.emit('cast', u, u, a); return true; }
    if (a.foe) { if (u.mp < a.mana || u.cd > 0) return false; var R = this.rules, L = this.units, rng = R.supRange(a), n = 0, self = this; u.mp -= a.mana; u.cd = (a.delay + 10) / R.tps;
      L.forEach(function (o) { if (o.fac === u.fac || !o.alive() || o.t.immune || u.distTo(o) > rng) return; n++; o.buffs[a.sup] = { k1: a.k1, k2: a.k2, arm: a.arm, until: self.time + R.supDuration(a), orig: o.fac };
        if (a.sup === 'charm') { o.fac = u.fac; o.order = null; o.tgt = null; o.path = null; } self.events.emit('cast', u, o, a); });
      return n > 0; }
    return this._cast(u, a, true);
  };
  /* ---- 순간이동·리콜·말다 소환 (원본 해독, 분석 8-29) ----
     원본 거리 (FUN_004d9860, FUN_004b9590 case 0x38·0x3a): 화면 픽셀 차 dx, dy로
     dy*2 < dx 이면 dx*10 + dy*8, 아니면 dx*4 + dy*20. 행동 +0x2A(range)·armData +0x3C(r)과 비교한다. */
  P.origDist = function (ax, ay, bx, by) {
    var m = this.map, p = m.t2w(ax, ay), q = m.t2w(bx, by), dx = Math.abs(p[0] - q[0]), dy = Math.abs(p[1] - q[1]);
    return dy * 2 < dx ? dx * 10 + dy * 8 : dx * 4 + dy * 20;
  };
  /* 함께 옮길 수 있는 아군인가: 살아 있고, 건물 안·순간이동 중·변형 형태(77~79)가 아니고, 이동 등급이 상한 이하 */
  P._tpOk = function (o, fac, lim) { return o.fac === fac && o.alive() && !o.tp && !(o.t.id >= 77 && o.t.id <= 79) && o.t.fly <= lim; };
  /* 순간이동 상태로 들어간다. arm = 출발 지점 이펙트 칸 (3 또는 21) */
  P._teleport = function (o, x, y, arm) {
    o.tp = { f: 0, x: x, y: y, sx: o.x, sy: o.y, arm: arm, moved: false }; o.order = null; o.tgt = null; o.path = null; o.state = 'idle'; o.blockT = 0;
    this.events.emit('teleport', o, arm);
  };
  /* 순간이동 진행 (FUN_004eb200): 원본 게임 틱마다 +1, 16틱째에 목적지로 옮기고 80틱째에 끝난다.
     그리기(FUN_004f5370): 0~16틱 사라짐, 16~80틱 나타남, 0~15틱 출발 지점에 이펙트 */
  P._tpStep = function (u) {
    var tp = u.tp; tp.f += this._gt || 0; u.state = 'idle';
    if (!tp.moved && tp.f >= 16) { var p = this.map.nearestWalkable(this.map.clamp(tp.x), this.map.clamp(tp.y), u.t.moveClass); u.x = p[0]; u.y = p[1]; tp.moved = true; this.events.emit('blink', u); }
    if (tp.f >= 80) u.tp = null;
  };
  /* 텔레포테이션·셀프 텔레포테이션·라이딩 이블 스피리츠 (FUN_004d9860): 시전자와, 시전자 주변(행동 range 안)의 아군이
     지정한 지점으로 대형을 유지한 채 함께 간다. 셀프는 range 15라 사실상 혼자. 라이딩은 이펙트 21, 나머지는 3.
     skip: 같은 명령으로 직접 순간이동하는 다른 시전자 (원본: 선택된 유닛 중 마나가 되는 순간이동 보유자는 제외) */
  P._teleportCast = function (u, a, x, y, skip) {
    if (!u.alive() || u.tp || u.mp < a.mana) return false;
    var arm = a.id === 36 ? 21 : 3, self = this, L = this.units;
    u.mp -= a.mana; u.cd = (a.delay + 10) / this.rules.tps;
    var go = [];
    for (var i = 0; i < L.length; i++) { var o = L[i];
      if (o !== u && (!this._tpOk(o, u.fac, a.kind) || (skip && skip.indexOf(o) >= 0 && o.mp >= a.mana))) continue;
      if (o === u || this.origDist(o.x, o.y, u.x, u.y) <= a.range) go.push(o); }
    go.forEach(function (o) { self._teleport(o, x + (o.x - u.x), y + (o.y - u.y), arm); });
    this.events.emit('cast', u, u, a); return true;
  };
  /* 팔라니아 소환 = 리콜 (FUN_004b9590 case 0x3a, 이펙트 칸 58): 지정한 지점 주변(armData[58] +0x3C = 2000)의 아군을
     대형을 유지한 채 시전자 곁으로 순간이동시킨다(상태 0xF, 이펙트 3). 시전자는 움직이지 않고 피해는 없다. */
  P._recall = function (u, a, x, y) {
    if (u.mp < a.mana || u.cd > 0 || !u.alive()) return false;
    var A = this.rules.arms && this.rules.arms[a.arm] || {}, r = A.r || 2000, lim = A.lim != null ? A.lim : 2, L = this.units, self = this, go = [];
    u.mp -= a.mana; u.cd = (a.delay + 10) / this.rules.tps; u.face(x - u.x, y - u.y);
    for (var i = 0; i < L.length; i++) { var o = L[i]; if (o !== u && this._tpOk(o, u.fac, lim) && this.origDist(o.x, o.y, x, y) <= r) go.push(o); }
    go.forEach(function (o) { self._teleport(o, u.x + (o.x - x), u.y + (o.y - y), 3); });
    this.events.emit('cast', u, { x: x, y: y, t: { alt: 0 } }, a); return true;
  };
  /* 말다 소환 (FUN_004b9590 case 0x38, 이펙트 칸 56): 지정한 지점 주변(armData[56] +0x3C = 2000) 아군의 체력 +1000(최대치까지)과
     상태 이상 해제(석화·감속·중독·약화 계열). 피해는 없다. 원본은 유닛 +0x20·+0x24·+0x2C·+0x34·+0x3C·+0x40·+0x4A 상태를 지운다 —
     목업 버프와의 대응은 추정 */
  P._massHeal = function (u, a, x, y) {
    if (u.mp < a.mana || u.cd > 0 || !u.alive()) return false;
    var A = this.rules.arms && this.rules.arms[a.arm] || {}, r = A.r || 2000, lim = A.lim != null ? A.lim : 2, L = this.units;
    u.mp -= a.mana; u.cd = (a.delay + 10) / this.rules.tps; u.face(x - u.x, y - u.y);
    for (var i = 0; i < L.length; i++) { var o = L[i];
      if (o.fac !== u.fac || !o.alive() || o.t.fly > lim || this.origDist(o.x, o.y, x, y) > r) continue;
      o.hp = Math.min(o.maxHp, o.hp + 1000);
      ['stone', 'slow', 'poison', 'melt', 'meltw', 'melta'].forEach(function (k) { delete o.buffs[k]; }); }
    this.events.emit('cast', u, { x: x, y: y, t: { alt: 0 } }, a); return true;
  };
  /* 케멘 소환 (FUN_004b9590 case 0x35, 이펙트 칸 53, 분석 8-33): 지정한 지점 주변(armData[53] +0x3C = 2000, 이동 등급 ≤ +0x40 = 2)의
     면역이 아닌(종류 +0x54 == 0) 아군에게 가속 — 원본은 유닛 +0x40 = 1(가속 상태, 머리 위에 이펙트 칸 44를 그림), +0x44 = 지속(행동 28 +0x3E = 640틱),
     +0x3C = -8(이동 보정, 배수 환산은 미확인 → 목업은 rules.speed의 1.5배), +0x3E = 같은 지속. 시전자는 움직이지 않고 피해는 없다. */
  P._massHaste = function (u, a, x, y) {
    if (u.mp < a.mana || u.cd > 0 || !u.alive()) return false;
    var A = this.rules.arms && this.rules.arms[a.arm] || {}, r = A.r || 2000, lim = A.lim != null ? A.lim : 2, L = this.units, until = this.time + this.rules.supDuration(a);
    u.mp -= a.mana; u.cd = (a.delay + 10) / this.rules.tps; u.face(x - u.x, y - u.y);
    for (var i = 0; i < L.length; i++) { var o = L[i];
      if (o.fac !== u.fac || !o.alive() || o.t.immune || o.t.fly > lim || this.origDist(o.x, o.y, x, y) > r) continue;
      o.buffs.haste = { k1: a.k1, k2: a.k2, arm: a.arm, until: until }; }
    this.events.emit('cast', u, { x: x, y: y, t: { alt: 0 } }, a); return true;
  };
  /* 술 소환 (FUN_004b9590 case 0x36, 이펙트 칸 54): 지정한 지점 주변(armData[54] +0x3C = 2000, 이동 등급 ≤ +0x40 = 2)의
     면역이 아닌 유닛(종류 +0x54 == 0)에게 —
     · 적: 강화 해제 (원본은 +0x2C·+0x34·+0x40·+0x4A·+0x58·+0x3C 상태와 +0x22 강화 타이머를 지운다 → 목업 weapon·shield·haste·berserk, 대응은 추정)
       + 공격받은 것처럼 반응 (FUN_004db830 — 목업은 가만히 있는 적만 시전자를 노리게)
     · 아군: 상태 이상 해제 (말다와 같은 필드: 석화·감속·중독·약화 계열), 체력 회복은 없음
     피해는 없다. 원본의 +0x54 연결(매혹 등으로 추정) 해제는 목업에서 "이 진영에서 매혹돼 넘어간 유닛을 되돌림"으로 둔다(추정). */
  P._massDispel = function (u, a, x, y) {
    if (u.mp < a.mana || u.cd > 0 || !u.alive()) return false;
    var A = this.rules.arms && this.rules.arms[a.arm] || {}, r = A.r || 2000, lim = A.lim != null ? A.lim : 2, L = this.units;
    u.mp -= a.mana; u.cd = (a.delay + 10) / this.rules.tps; u.face(x - u.x, y - u.y);
    for (var i = 0; i < L.length; i++) { var o = L[i];
      if (!o.alive() || o.t.immune || o.t.fly > lim || this.origDist(o.x, o.y, x, y) > r) continue;
      var ch = o.buffs.charm;
      if (ch && ch.orig === u.fac && o.fac !== u.fac) { o.fac = ch.orig; o.order = null; o.tgt = null; o.path = null; delete o.buffs.charm; continue; }   // 매혹돼 넘어간 우리 유닛을 되돌림 (추정)
      if (o.fac !== u.fac) { ['weapon', 'shield', 'haste', 'berserk'].forEach(function (k) { delete o.buffs[k]; }); if (o.state === 'idle' && !o.order && !o.passive && o.t.canAttack()) o.tgt = u; }
      else ['stone', 'slow', 'poison', 'melt', 'meltw', 'melta'].forEach(function (k) { delete o.buffs[k]; });
    }
    this.events.emit('cast', u, { x: x, y: y, t: { alt: 0 } }, a); return true;
  };
  P._support = function (u) {
    var S = u.t.sups; for (var i = 0; i < S.length; i++) { if (S[i].sup === "heal" && u.fac === this.manualHeal) continue; if (this._cast(u, S[i], false)) return true; }
    return false;
  };
  /* 명령 없이 그냥 서 있는 유닛인가. 지금은 "서 있는 아군끼리 겹쳐 있을 때 천천히 벌리기"에만 쓴다.
     원본(분석 8-31)은 서 있는 유닛을 밀지 않으므로, 움직이는 유닛이 서 있는 아군을 밀어내는 처리(스타크래프트 2 방식)는 2026-11-11 사용자 확인 뒤 껐다. */
  P._pushable = function (o) {
    return o.state === 'idle' && !o.order && !o.tgt && !o.tp && !(o.buffs.stone && o.buffs.stone.until > this.time) && !o.blockT;
  };
  /* 유닛 우회 (목업 고유 — 원본의 유닛 회피 방식은 미해독): 진행 방향 바로 앞에 서 있는 유닛이 길을 막으면 옆으로 돌아간다.
     (hx,hy) 진행 방향, mv 이번 틱 이동량, (gx,gy) 최종 목적지. 돌아갈 방향 벡터를 돌려주고, 막는 유닛이 없으면 null.
     움직이는 유닛은 장애물로 보지 않는다(같이 가는 무리끼리 서로 피하지 않게) — 그쪽은 겹침 처리가 맡는다.
     목적지 위에 서 있는 유닛(공격·시전 대상 포함)도 피하지 않는다. 한번 고른 쪽(u.avoidSide)은 다 돌 때까지 유지한다. */
  P._avoid = function (u, hx, hy, mv, gx, gy) {
    if (u.t.fly === 2) return null;                                                   // 공중 유닛은 충돌이 없다 (원본: 점유 격자를 쓰지 않음, 8-31)
    var L = this.units, map = this.map, mc = u.t.moveClass, CLEAR = 0.95, LOOK = 1.8, best = null, bd = 1e9, blat = 0, i, o;
    for (i = 0; i < L.length; i++) {
      o = L[i]; if (o === u || !o.alive() || o.state === 'move' || o.state === 'inside' || (o.t.fly === 2) !== (u.t.fly === 2)) continue;
      var ox = o.x - u.x, oy = o.y - u.y, ahead = ox * hx + oy * hy; if (ahead <= 0 || ahead > LOOK || ahead >= bd) continue;
      CLEAR = u.t.rad + o.t.rad + 0.1;                                                 // 두 유닛 크기에 맞춘 비켜 갈 폭
      var lat = oy * hx - ox * hy; if (Math.abs(lat) >= CLEAR) continue;            // 진행 방향의 왼쪽이 +
      if (Math.hypot(o.x - gx, o.y - gy) < 0.9) continue;
      best = o; bd = ahead; blat = lat;
    }
    if (!best) { u.avoidSide = 0; return null; }
    var side = u.avoidSide || (blat > 0 ? -1 : 1);                                  // 막는 유닛이 왼쪽에 있으면 오른쪽으로
    for (var k = 0; k < 2; k++, side = -side) {
      var w = 0.7 + 1.3 * (1 - bd / LOOK), sx = hx - hy * side * w, sy = hy + hx * side * w;   // 가까울수록 더 크게 꺾는다
      var dist = Math.hypot(best.x - u.x, best.y - u.y); if (dist < CLEAR && dist > 0.001) { sx -= (best.x - u.x) / dist * 0.8; sy -= (best.y - u.y) / dist * 0.8; }   // 너무 붙었으면 바깥으로
      var n = Math.hypot(sx, sy); if (n < 0.001) continue; sx /= n; sy /= n;
      if (map.walkable(u.x + sx * mv, u.y + sy * mv, mc)) { u.avoidSide = side; return [sx, sy]; }   // 그쪽이 막혀 있으면 반대쪽으로
    }
    return null;
  };
  /* 경로를 따라 한 틱 이동. 도착하면 true */
  /* 목적지 쪽 바로 앞(반지름 합 + 0.35칸)에 명령 없이 서 있는 아군이 있는가 — 부대 이동에서 늦게 온 유닛이 바깥에 서는 판정 */
  P._blockedByIdleAlly = function (u, gx, gy) {
    var L = this.units, dx = gx - u.x, dy = gy - u.y, d = Math.hypot(dx, dy); if (d < 0.001) return false; dx /= d; dy /= d;
    for (var i = 0; i < L.length; i++) { var o = L[i]; if (o === u || o.fac !== u.fac || !o.alive() || o.order || o.state !== 'idle' || o.t.fly !== u.t.fly) continue;
      var ox = o.x - u.x, oy = o.y - u.y, od = Math.hypot(ox, oy); if (od > u.t.rad + o.t.rad + 0.35) continue; if (ox * dx + oy * dy > 0) return true; }
    return false;
  };
  P._moveToward = function (u, tx, ty) {
    var map = this.map, mc = u.t.moveClass;
    if (Math.hypot(tx - u.x, ty - u.y) < 0.08) return true;
    u.repath -= DT;
    if (!u.path || u.repath <= 0 || Math.hypot(tx - u.pgx, ty - u.pgy) > 0.75) {
      u.path = this.path.find(u.x, u.y, tx, ty, mc); u.pgx = tx; u.pgy = ty; u.repath = 0.6 + this.rng.next() * 0.4;
    }
    if (!u.path || !u.path.length) { u.state = 'idle'; return true; }       // 갈 수 없는 곳
    var wp = u.path[0], dx = wp[0] - u.x, dy = wp[1] - u.y, d = Math.hypot(dx, dy), mv = this.rules.speed(u) * DT;
    if (d <= mv) { u.x = wp[0]; u.y = wp[1]; u.path.shift(); }
    else {
      var hx = dx / d, hy = dy / d, av = this._avoid(u, hx, hy, mv, tx, ty); if (av) { hx = av[0]; hy = av[1]; }
      var nx = u.x + hx * mv, ny = u.y + hy * mv;
      if (map.walkable(nx, ny, mc)) { u.x = nx; u.y = ny; }
      else if (map.walkable(nx, u.y, mc)) u.x = nx;
      else if (map.walkable(u.x, ny, mc)) u.y = ny;
      else u.repath = 0;
    }
    u.face(dx, dy); u.state = 'move'; u.walkT += DT;
    return !u.path.length;
  };
  P.step = function () {
    var R = this.rules, L = this.units, map = this.map, i, u;
    this.tickN++; R.now = this.time = this.tickN * DT;
    this._gacc = (this._gacc || 0) + (R.tps || 12) * DT; this._gt = 0; while (this._gacc >= 1) { this._gacc--; this.gtick = (this.gtick || 0) + 1; this._gt++; }   // 이번 스텝에 지나간 원본 게임 틱 수
    for (i = 0; i < L.length; i++) {
      u = L[i];
      if (u.state === 'dead') { u.deadT += DT; continue; }
      if (u.state === 'inside') continue;
      if (u.cd > 0) u.cd -= DT;
      var bsh = u.buffs.shield; if (bsh && bsh.block && bsh.until > this.time) u.blockT += DT; else u.blockT = 0;   // 방패 막기 자세 시간
      if (u.morphUntil && u.morphUntil <= this.time && u.origType) { u.setType(u.origType); u.origType = null; u.morphUntil = 0; }
      var bc = u.buffs.charm; if (bc && bc.until <= this.time) { u.fac = bc.orig; u.order = null; u.tgt = null; delete u.buffs.charm; }
      if (u.buffs.stone && u.buffs.stone.until > this.time && u.state !== 'attack') { u.state = 'idle'; continue; }   // 석화: 움직이지 못함
      if (u.mp < u.maxMp) u.mp = Math.min(u.maxMp, u.mp + R.manaRegen(u) * DT);
      if (u.tp) { this._tpStep(u); continue; }                                         // 순간이동 중: 아무것도 하지 않는다 (FUN_004eb200)
      if (this._gt) {                                                                  // 게임 틱 단위 효과 (FUN_00454580, FUN_004516c0)
        var ps = u.buffs.poison; if (ps && this.isInvuln(u)) { delete u.buffs.poison; ps = null; }
        if (ps) { if (ps.until <= this.time) delete u.buffs.poison; else if (this.gtick % 2 === 0 && u.hp > 1) u.hp--; }   // 중독: 2틱마다 −1, 1 밑으로는 안 내려감
        if (u.t.regen && u.hp < u.maxHp && this.gtick % 16 === 0) u.hp++;             // 무도가·도사: 16틱마다 +1
      }
      if (u.state === 'attack') {
        u.at += DT * R.animRate(u);
        var A = u.t.anim.atk, n = A ? A.n : 6, hit = A ? A.hit : 3;
        if (!u.hitDone && u.at >= hit) {
          u.hitDone = true; this.events.emit('strike', u);
          if (u.tgt && u.tgt.alive()) {
            if (u.t.ranged) { var s = { x: u.x, y: u.y, z: u.t.alt + 24, from: u, to: u.tgt, act: u.act, arm: R.projectile(u), t: 0, dx: 0, dy: 1 }; this.shots.push(s); this.events.emit('shot', s); }
            else this._strike(u, u.tgt);
          }
        }
        // 연속 타격 (원본 FUN_004c1e10, 분석 8-41): 에로우 샤워는 프레임 10·12·14에 화살을 더 쏘고, 컴비네이션 어택은 프레임 4에 한 번 더 친다
        var X = R.extraHits ? R.extraHits(u.act) : null;
        if (X) { if (u.at < X[0]) u.xN = 0;
          while ((u.xN || 0) < X.length && u.at >= X[u.xN]) { u.xN = (u.xN || 0) + 1;
            if (u.tgt && u.tgt.alive()) { if (u.t.ranged) { var s2 = { x: u.x, y: u.y, z: u.t.alt + 24, from: u, to: u.tgt, act: u.act, arm: R.projectile(u), t: 0, dx: 0, dy: 1 }; this.shots.push(s2); this.events.emit('shot', s2); } else this._strike(u, u.tgt); } } }
        if (u.at >= n) { u.state = 'idle'; u.cd = R.cooldown(u, this.rng); }
        continue;
      }
      if (u.cd <= 0 && u.t.sups.length && !u.passive && !this.noAuto && !(u.order && u.order.type === 'cast') && this._support(u)) { u.state = 'idle'; continue; }
      var o = u.order, tgt = null;
      if (o && o.type === 'attack') { if (!o.target.alive()) u.order = o = null; else tgt = o.target; }
      if (R.buff && R.buff(u, 'berserk')) { if (o && o.type !== 'hold') u.order = o = null; if (u.tgt && u.tgt.t.name === u.t.name) u.tgt = null; }   // 광폭화 중에는 명령을 듣지 않는다
      else if (u.tgt && u.tgt.fac === u.fac) u.tgt = null;                                     // 광폭화가 끝나면 아군 공격을 멈춘다
      var hold = o && o.type === 'hold', hidden = u.buffs.hide;
      if (!tgt && (!o || o.amove || hold) && u.t.canAttack() && !hidden && (!u.passive || (o && o.amove))) {   // 수동 유닛도 공격 이동 중에는 적을 찾는다
        if (u.tgt && (!u.tgt.alive() || (!this.seekAll && u.distTo(u.tgt) > R.leash(u)))) u.tgt = null;
        tgt = u.tgt || R.pickTarget(u, this, this.seekAll && !o ? 1e9 : R.aggro(u));
        u.tgt = tgt;
      }
      if (tgt) {
        if (R.inRange(u, tgt, map)) {
          u.face(tgt.x - u.x, tgt.y - u.y); u.path = null;
          var cost = R.manaCost(u);
          if (u.cd <= 0 && u.mp >= cost) { u.mp -= cost; u.state = 'attack'; u.at = 0; u.hitDone = false; u.tgt = tgt; this.events.emit('attack', u, tgt); }
          else u.state = 'idle';
        } else if (hold) { u.state = 'idle'; u.tgt = null; }
        else this._moveToward(u, tgt.x, tgt.y);
      } else if (o && o.type === 'cast') {
        var ct = o.target;
        if (!ct && o.x != null) {                                                       // 땅을 지정한 범위 행동
          if (o.a.sup === 'recall' || Math.hypot(o.x - u.x, o.y - u.y) <= Math.max(1.5, Math.min(12, o.a.range / 10 / 45.25))) { u.state = 'idle'; u.path = null;   // 리콜은 사거리 65535 = 어디든 (걸어가지 않는다)
            if (u.cd <= 0) { if (o.a.sup === 'recall') this._recall(u, o.a, o.x, o.y); else if (o.a.sup === 'massheal') this._massHeal(u, o.a, o.x, o.y); else if (o.a.sup === 'massdispel') this._massDispel(u, o.a, o.x, o.y); else if (o.a.sup === 'masshaste') this._massHaste(u, o.a, o.x, o.y); else this._blast(u, o.a, o.x, o.y); u.order = null; } }
          else this._moveToward(u, o.x, o.y);
        }
        else if (!ct || (!ct.alive() && o.a.sup !== 'raise')) { u.order = null; u.state = 'idle'; }
        else if (u.distTo(ct) <= R.supRange(o.a)) { u.state = 'idle'; u.path = null; if (u.cd <= 0) { this._cast(u, o.a, true, ct); u.order = null; } }
        else this._moveToward(u, ct.x, ct.y);
      } else if (o && o.type === 'enter') {
        if (Math.hypot(o.b.x - u.x, o.b.y - u.y) < 3.6) this.enter(u, o.b); else this._moveToward(u, o.b.x + 1.2, o.b.y + 2.6);
      } else if (o && o.type === 'move') {
        /* 막힘 판정 (목업 고유): 목적지까지 거리가 0.1칸 넘게 줄지 않은 채 1초가 지나면,
           목적지 근처(o.tol 안)이면 도착으로 치고 멈춘다(부대가 한 곳에 모일 때 마지막 몇 기가 빙빙 도는 것 방지).
           멀리서 2.5초 막혀 있으면 경로를 새로 찾는다. */
        var gd = Math.hypot(o.x - u.x, o.y - u.y);
        if (u.mvOrder !== o) { u.mvOrder = o; u.mvBest = gd; u.mvT = this.time; }
        else if (gd < u.mvBest - 0.1) { u.mvBest = gd; u.mvT = this.time; }
        if (this.time - u.mvT > 1.0 && gd <= (o.tol || 1.2)) { u.order = null; u.path = null; u.state = 'idle'; }
        else if (this.time - u.mvT > 1.0 && this._blockedByIdleAlly(u, o.x, o.y)) { u.order = null; u.path = null; u.state = 'idle'; }   // 먼저 도착해 서 있는 아군이 길을 막으면 그 자리에 선다 (부대가 모일 때 바깥에 서는 것)
        else if (this.time - u.mvT > 1.0) {                                             // 멀리서 막힘: 원본(8-31)처럼 서서 기다리다 2.5초마다 경로를 다시 찾고, 20초 넘게 못 나가면 포기
          if (this.time - (u.mvRetry || 0) > 2.5) { u.mvRetry = this.time; u.path = null; if (this._moveToward(u, o.x, o.y)) { u.order = null; u.path = null; } }
          else u.state = 'idle';
          if (this.time - u.mvT > 20) { u.order = null; u.path = null; u.state = 'idle'; } }
        else if (this._moveToward(u, o.x, o.y)) { u.order = null; u.path = null; u.state = 'idle'; }
        if (o.patrol && !u.order && u.alive()) { this.orderMove(u, o.patrol.x, o.patrol.y, true, o.tol); if (u.order) u.order.patrol = { x: o.x, y: o.y }; }   // 정찰(P, 목업 구현): 도착하면 떠난 자리로 되돌아가기를 되풀이
      } else u.state = 'idle';
    }
    /* 겹침 처리 (목업 고유 — 원본 8-31처럼 서 있는 유닛은 밀리지 않는다):
       · 움직이는 유닛끼리는 반씩 비킨다. 한쪽이 벽이라 못 비키면 다른 쪽이 전부 비킨다.
       · 움직이는 유닛과 서 있는 유닛(아군·적 모두)이 겹치면 움직이는 쪽만 비킨다. 서 있는 유닛은 돌아가야 할 장애물(_avoid)이고, 돌아갈 수 없으면 막힘 도착 처리가 받는다.
       · 둘 다 서 있으면 그냥 서 있는 아군끼리만 두 반지름 합의 82%까지 천천히 벌린다(배치 때 겹친 것 풀기).
       · 거리 기준은 유닛 크기(원본 +0x22 반폭 → UnitType.rad)에 비례한다. 공중 유닛은 충돌하지 않는다(원본 8-31).
       · 완전히 겹쳤을 때(거리 0)는 두 유닛 번호로 정한 방향으로 떼어 놓는다. 통행 불가 칸으로는 밀지 않는다. */
    for (i = 0; i < L.length; i++) {
      var a = L[i]; if (!a.alive()) continue;
      for (var j = i + 1; j < L.length; j++) {
        var b = L[j]; if (!b.alive() || a.t.fly === 2 || b.t.fly === 2) continue;      // 공중 유닛은 서로도 지상과도 겹친다 (원본 8-31)
        var dx = b.x - a.x, dy = b.y - a.y, dd = Math.hypot(dx, dy), min = a.t.rad + b.t.rad;   // 원본 유닛 크기(+0x22)에 비례
        if (dd >= min) continue;
        if (dd < 0.001) { var ang = ((a.uid * 7 + b.uid * 13) % 16) / 16 * 6.283; dx = Math.cos(ang) * 0.01; dy = Math.sin(ang) * 0.01; dd = 0.01; }
        var am = a.state === 'move', bm = b.state === 'move', ux = dx / dd, uy = dy / dd;
        if (!am && !bm) {                                                                 // 둘 다 서 있으면: 그냥 서 있는 아군끼리만 아주 천천히 떼어 놓는다
          var sep = min * 0.82; if (a.fac === b.fac && dd < sep && this._pushable(a) && this._pushable(b)) { var ps = (sep - dd) * DT * 1.5;
            if (map.walkable(a.x - ux * ps, a.y - uy * ps, a.t.moveClass)) { a.x -= ux * ps; a.y -= uy * ps; }
            if (map.walkable(b.x + ux * ps, b.y + uy * ps, b.t.moveClass)) { b.x += ux * ps; b.y += uy * ps; } }
          continue; }
        var p = (min - dd) * Math.min(1, DT * 8), wa, wb;
        if (am && bm) { wa = 0.5; wb = 0.5; }
        else if (am) { wa = 1; wb = 0; }
        else { wa = 0; wb = 1; }
        var okA = wa > 0 && map.walkable(a.x - ux * p * wa, a.y - uy * p * wa, a.t.moveClass), okB = wb > 0 && map.walkable(b.x + ux * p * wb, b.y + uy * p * wb, b.t.moveClass);
        if (okA && !okB && (bm || am)) wa = Math.min(1, wa + wb); else if (okB && !okA) wb = Math.min(1, wa + wb);   // 한쪽이 막혔으면 다른 쪽이 마저 비킨다
        if (okA && map.walkable(a.x - ux * p * wa, a.y - uy * p * wa, a.t.moveClass)) { a.x -= ux * p * wa; a.y -= uy * p * wa; }
        if (okB && map.walkable(b.x + ux * p * wb, b.y + uy * p * wb, b.t.moveClass)) { b.x += ux * p * wb; b.y += uy * p * wb; }
      }
    }
    this._economy();
    if (this.tickN % 300 === 0) this.units = this.units.filter(function (x) { return !(x.state === 'dead' && x.deadT > 12 && x.made); });   // 생산된 유닛의 오래된 시체는 치운다
    // 발사체
    for (i = this.shots.length - 1; i >= 0; i--) {
      var sh = this.shots[i], t = sh.to, ddx = t.x - sh.x, ddy = t.y - sh.y, d2 = Math.hypot(ddx, ddy), mv = R.shotSpeed(sh.from) * DT;
      if (d2 <= mv || !t.alive()) { if (t.alive()) this._strike(sh.from, t, sh.act); this.shots.splice(i, 1); }
      else { sh.x += ddx / d2 * mv; sh.y += ddy / d2 * mv; sh.dx = ddx; sh.dy = ddy; sh.t += DT; }
    }
  };
  MWE.World = World;
})(typeof window !== 'undefined' ? window : globalThis);
