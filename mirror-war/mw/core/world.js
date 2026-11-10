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
  P.orderMove = function (u, x, y, attackMove) {
    if (!u.alive()) return;
    u.order = { type: 'move', x: this.map.clamp(x), y: this.map.clamp(y), amove: !!attackMove }; u.path = null;
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

  P._hurt = function (a, b) {
    if (!b.alive()) return;
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
    b.hp = 0; b.state = 'dead'; b.at = 0; b.deadT = 0; b.order = null; b.path = null; b.buffs = {}; this.events.emit('death', b, a);
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
    if (u.mp < a.mana || u.cd > 0 || !u.alive()) return false;
    if (forced) { if (!forced.alive() && a.sup !== "raise") return false; if (a.foe && (forced.t.immune || (a.sup === "assassin" && forced.t.fly === 2))) return false; tgt = forced; } else
    if (a.sup === "heal") { for (j = 0; j < L.length; j++) { o = L[j]; if (o.fac !== u.fac || !o.alive() || o.hp >= o.maxHp * (manual ? 1 : 0.75)) continue; var d = u.distTo(o), r = o.hp / o.maxHp; if (d <= rng && r < best) { best = r; tgt = o; } } }
    else if (a.sup === "hide" || a.sup === "sight" || a.sup === "teleport" || a.sup === "morph" || a.sup === "merge") { if (!manual) return false; tgt = u; }
    else if (a.sup === "raise") { for (j = 0; j < L.length; j++) { o = L[j]; if (o.state !== 'dead' || o.deadT > 12) continue; var dr = u.distTo(o); if (dr <= Math.max(rng, 4) && dr < best) { best = dr; tgt = o; } } }
    else {
      var threat = manual; for (j = 0; !threat && j < L.length; j++) { o = L[j]; if (o.fac !== u.fac && o.alive() && u.distTo(o) < 10) threat = true; }
      if (!threat) return false;
      if (a.foe) { for (j = 0; j < L.length; j++) { o = L[j]; if (o.fac === u.fac || !o.alive() || o.t.immune || R.buff(o, a.sup) || (a.sup === "assassin" && o.t.fly === 2)) continue; var df = u.distTo(o); if (df <= rng && df < best) { best = df; tgt = o; } } }
      else if (a.sup === "berserk" || (a.sup === "shield" && a.arm < 0)) { if (!R.buff(u, a.sup)) tgt = u; }
      else { for (j = 0; j < L.length; j++) { o = L[j]; if (o.fac !== u.fac || !o.alive() || R.buff(o, a.sup) || (a.sup === "weapon" && !o.act)) continue; var dd = u.distTo(o); if (dd <= rng && dd < best) { best = dd; tgt = o; } } }
    }
    if (!tgt) return false;
    if (a.sup !== "heal" && a.sup !== "merge") u.mp -= a.mana;
    u.cd = (a.delay + 10) / R.tps; if (tgt !== u) u.face(tgt.x - u.x, tgt.y - u.y);
    if (a.sup === "heal") R.heal(u, tgt, a);
    else if (a.sup === "assassin") { this._slay(u, tgt); u.hp = Math.max(1, Math.floor(u.hp / 5)); }   // 암살: 대상 즉사, 시전자 체력은 1/5로 (FUN_004ac6f0)
    else if (a.sup === "morph") { var to = this.typeOf(MORPH[u.t.id]); if (!to) return false; if (!u.origType) u.origType = u.t; u.setType(to);
      u.morphUntil = 0; }                                                              // 시간 제한 없음. 되돌리기는 revert()
    else if (a.sup === "copy") { if (!u.origType) u.origType = u.t; u.setType(tgt.t); u.morphUntil = 0; }   // 메타몰포시스: 대상 유닛의 모습으로. 되돌리기는 revert()
    else if (a.sup === "raise") { var sk = this.typeOf(28); tgt.deadT = 99; this.spawn(sk, u.fac, tgt.x, tgt.y).made = true; }   // 레이즈 언데드: 시체를 해골전사로 (결과 유닛 추정)
    else if (a.sup === "merge") {                                                   // 합체 (FUN_004f1490, FUN_004585f0): 유령 + 좀비·해골전사 → 리치, 사탄 + 리치 → 다크로드
      var want = u.t.id === 32 ? [31, 28] : u.t.id === 41 ? [33] : null, mate = null, md = 5; if (!want || u.mp < 30) return false;
      for (j = 0; j < L.length; j++) { o = L[j]; if (o.fac !== u.fac || !o.alive() || o === u || want.indexOf(o.t.id) < 0 || o.buffs.charm) continue; var dm = u.distTo(o); if (dm < md) { md = dm; mate = o; } }
      if (!mate) return false; u.mp -= 30; var keep = mate.level > u.level ? mate : u, gone = keep === u ? mate : u;
      gone.state = 'dead'; gone.deadT = 99; gone.hp = 0; keep.x = u.x; keep.y = u.y; keep.origType = null; keep.setType(this.typeOf(u.t.id === 32 ? 33 : 34)); keep.hp = keep.maxHp; keep.mp = Math.floor(keep.maxMp / 3); keep.buffs = {}; tgt = keep; }
    else if (a.sup === "teleport") u.blink = a;                                        // 다음 이동 명령 때 그 자리로 순간이동
    else if (a.sup === "sight") { /* 화면 쪽에서 cast 사건을 받아 안개를 걷는다 */ }
    else { tgt.buffs[a.sup] = { k1: a.k1, k2: a.k2, arm: a.arm, until: a.sup === "hide" ? 1e12 : this.time + R.supDuration(a), orig: tgt.fac };
      if (a.sup === "meltw" || a.sup === "melta" || a.sup === "dispel" || a.sup === "melt") { delete tgt.buffs.weapon; delete tgt.buffs.shield; delete tgt.buffs.haste; delete tgt.buffs.berserk; if (a.sup === "dispel") delete tgt.buffs.dispel; }   // 강화 마법 해제
      if (a.sup === "charm") { tgt.fac = u.fac; tgt.order = null; tgt.tgt = null; tgt.path = null; } }
    this.events.emit("cast", u, tgt, a); return true;
  };
  /* 대상을 지정한 시전 명령: 사거리 밖이면 다가가서 쓴다. 순간이동은 지정한 땅으로 바로 */
  P.orderCast = function (u, a, target, x, y) {
    if (!u.alive() || !a) return;
    if (a.sup === "teleport") { if (u.mp < a.mana) return; u.mp -= a.mana; var p = this.map.nearestWalkable(this.map.clamp(x), this.map.clamp(y), u.t.moveClass); u.x = p[0]; u.y = p[1]; u.order = null; u.path = null; u.cd = (a.delay + 10) / this.rules.tps; this.events.emit("cast", u, u, a); return; }
    u.order = { type: 'cast', a: a, target: target, x: x, y: y }; u.tgt = null; u.path = null;
  };
  /* 지점 범위 타격: (x,y) 주변의 적 모두에게 행동 a의 피해. 자기 주변 공격도 이것으로 */
P._blast = function (u, a, x, y) {
    if (u.mp < a.mana || u.cd > 0 || !u.alive()) return false;
    var R = this.rules, L = this.units, r = R.aoeRadius(u), keep = u.act, self = this;
    if (a.hpCost) { var hc = Math.floor(u.maxHp / a.hpCost); if (u.hp <= hc) return false; u.hp -= hc; }   // 체력을 쓰는 행동 (원본 조건 문구: 체력 1/10·1/4 이상 가능)
    u.mp -= a.mana; u.cd = a.dmg ? R.cooldown(u, this.rng) : (a.delay + 10) / R.tps; u.act = a; if (u.buffs.hide) delete u.buffs.hide;
    u.face(x - u.x, y - u.y);
    for (var i = 0; i < L.length; i++) { var o = L[i];
      if (o === u || !o.alive() || Math.hypot(o.x - x, o.y - y) > r || (!a.ff && o.fac === u.fac) || (a.groundOnly && o.t.fly === 2)) continue;
      if (a.dmg) this._hurt(u, o);
      else if (a.sup && !o.t.immune && !(a.undead && !(o.t.id >= 28 && o.t.id <= 34))) {           // 범위 약화 (언데드 전용: 해골·좀비·유령·리치·다크로드 계열)
        o.buffs[a.sup] = { k1: a.k1, k2: a.k2, arm: a.arm, until: this.time + R.supDuration(a), orig: o.fac }; if (a.drain) o.mp = 0; }
    }
    u.act = keep; this.events.emit(cast, u, { x: x, y: y, t: { alt: 0 } }, a);
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
  P._support = function (u) {
    var S = u.t.sups; for (var i = 0; i < S.length; i++) { if (S[i].sup === "heal" && u.fac === this.manualHeal) continue; if (this._cast(u, S[i], false)) return true; }
    return false;
  };
  /* 경로를 따라 한 틱 이동. 도착하면 true */
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
      var nx = u.x + dx / d * mv, ny = u.y + dy / d * mv;
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
      if (u.morphUntil && u.morphUntil <= this.time && u.origType) { u.setType(u.origType); u.origType = null; u.morphUntil = 0; }
      var bc = u.buffs.charm; if (bc && bc.until <= this.time) { u.fac = bc.orig; u.order = null; u.tgt = null; delete u.buffs.charm; }
      if (u.buffs.stone && u.buffs.stone.until > this.time && u.state !== 'attack') { u.state = 'idle'; continue; }   // 석화: 움직이지 못함
      if (u.mp < u.maxMp) u.mp = Math.min(u.maxMp, u.mp + R.manaRegen(u) * DT);
      if (this._gt) {                                                                  // 게임 틱 단위 효과 (FUN_00454580, FUN_004516c0)
        var ps = u.buffs.poison; if (ps) { if (ps.until <= this.time) delete u.buffs.poison; else if (this.gtick % 2 === 0 && u.hp > 1) u.hp--; }   // 중독: 2틱마다 −1, 1 밑으로는 안 내려감
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
          if (Math.hypot(o.x - u.x, o.y - u.y) <= Math.max(1.5, Math.min(12, o.a.range / 10 / 45.25))) { u.state = 'idle'; u.path = null; if (u.cd <= 0) { this._blast(u, o.a, o.x, o.y); u.order = null; } }
          else this._moveToward(u, o.x, o.y);
        }
        else if (!ct || (!ct.alive() && o.a.sup !== 'raise')) { u.order = null; u.state = 'idle'; }
        else if (u.distTo(ct) <= R.supRange(o.a)) { u.state = 'idle'; u.path = null; if (u.cd <= 0) { this._cast(u, o.a, true, ct); u.order = null; } }
        else this._moveToward(u, ct.x, ct.y);
      } else if (o && o.type === 'enter') {
        if (Math.hypot(o.b.x - u.x, o.b.y - u.y) < 3.6) this.enter(u, o.b); else this._moveToward(u, o.b.x + 1.2, o.b.y + 2.6);
      } else if (o && o.type === 'move') {
        if (this._moveToward(u, o.x, o.y)) { u.order = null; u.path = null; u.state = 'idle'; }
      } else u.state = 'idle';
    }
    // 겹침 처리: 서 있는 유닛은 절대 밀리지 않고, 움직이는 유닛만 옆으로 비켜 간다 (통행 불가 칸으로는 밀지 않는다)
    for (i = 0; i < L.length; i++) {
      var a = L[i]; if (!a.alive()) continue;
      for (var j = i + 1; j < L.length; j++) {
        var b = L[j]; if (!b.alive() || (a.t.fly === 2) !== (b.t.fly === 2)) continue;
        var dx = b.x - a.x, dy = b.y - a.y, dd = Math.hypot(dx, dy), min = 0.85;
        if (dd >= min) continue;
        if (dd < 0.001) { dx = 0.01; dy = 0; dd = 0.01; }
        var p = (min - dd) / 2 * Math.min(1, DT * 8), ux = dx / dd, uy = dy / dd;
        var am = a.state === 'move', bm = b.state === 'move'; if (!am && !bm) continue;      // 둘 다 서 있으면 그대로 둔다
        if (am && bm) p *= 1; else p *= 2;                                               // 한쪽만 움직이면 그쪽이 전부 비킨다
        if (am && map.walkable(a.x - ux * p, a.y - uy * p, a.t.moveClass)) { a.x -= ux * p; a.y -= uy * p; }
        if (bm && map.walkable(b.x + ux * p, b.y + uy * p, b.t.moveClass)) { b.x += ux * p; b.y += uy * p; }
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
