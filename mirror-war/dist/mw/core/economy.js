/* economy.js: 건물 진입·점령, 자원 채취, 유닛 생산, 전직. World에 메서드를 더한다.
   원본 근거(게임 도움말 tip.txt / hotkey.txt + 데이터):
     - 공중 유닛을 뺀 모든 유닛은 건물에 들어갈 수 있다. 빈 건물에 들어가면 점령한다. 매혹된 유닛은 못 들어간다.
     - 자원 5종(민간인·전사형 민간인·마법사형 민간인·금·젬)은 건물이 가지고 있고(맵 레코드), 안에 유닛이 많을수록(3기까지) 빨리 채취한다.
       금·젬은 연금술사가 안에 있으면 더 빠르다.
     - 생산 비용 5종과 생산 시간(틱)은 unitdata, 생산 가능 유닛 목록은 hotkey.txt.
     - 건물 안의 유닛은 MP가 빨리, HP가 서서히 회복되고 범위 공격을 받지 않는다.
   채취 주기·진영별 채취 자원·건물 안 회복·점령 비용과 시간은 실행 파일의 표와 함수에서 확인(estimates-confirmed.md).
   넣지 않은 것: 젬↔금 환전, 악령군 건물의 정화, 생산 진행 가속. 추정: 시작 자원, 점령 중 퇴각 처리. */
(function (root) {
  'use strict';
  var MWE = root.MWE, P = MWE.World.prototype;

  P.orderEnter = function (u, b) { if (u.alive() && u.t.fly !== 2 && !u.buffs.charm) { u.order = { type: 'enter', b: b }; u.tgt = null; u.path = null; } };
  P.canEnter = function (u, b) { return u.t.fly !== 2 && !u.buffs.charm && (b.owner === u.fac || b.claim === u.fac || b.inside.length === 0); };
/* 건물 진입 (FUN_004ccd60). 중립 건물은 진영별 자원 한 가지를 내야 한다: 해방부대 금, 악령군 사람(민간인→전사형→마법사형), 흑마술파 젬.
     남의 건물은 비어 있으면 무료. 들어간 뒤 점령 시간(b.capT, 틱)이 0이 되어야 소유가 넘어온다. */
  P.captureCost = function (fac, b) { var c = b.b.cap; return fac === 0 ? [0, 0, 0, c.gold, 0] : fac === 2 ? [0, 0, 0, 0, c.gem] : [c.pop, 0, 0, 0, 0]; };
  P.canPay = function (fac, b) { var r = this.res[fac], c = b.b.cap; return fac === 0 ? r[3] >= c.gold : fac === 2 ? r[4] >= c.gem : r[0] + r[1] + r[2] >= c.pop; };
  P.enter = function (u, b) {
    u.order = null; u.path = null;
    if (!this.canEnter(u, b)) { u.state = 'idle'; return false; }
    if (b.owner !== u.fac && b.claim !== u.fac) {
      if (b.owner < 0) { if (!this.canPay(u.fac, b)) { u.state = 'idle'; this.events.emit('nofunds', u, b); return false; }
        var r = this.res[u.fac], c = b.b.cap;
        if (u.fac === 0) r[3] -= c.gold; else if (u.fac === 2) r[4] -= c.gem; else { var need = c.pop; for (var k = 0; k < 3 && need > 0; k++) { var t = Math.min(r[k], need); r[k] -= t; need -= t; } } }
      b.claim = u.fac; b.capT = b.b.cap.time; b.queue = [];
    }
    b.inside.push(u); u.state = 'inside'; u.tgt = null; u.inside = b; this.events.emit('enter', u, b); return true;
  };
  P.exitPoint = function (b, k, mc) { var a = (k || 0) * 0.9; return this.map.nearestWalkable(b.x + 1.2 + Math.cos(a) * 1.4, b.y + 3.2 + Math.sin(a) * 1.0, mc); };
  P.leave = function (b) {
    var self = this; b.inside.forEach(function (u, k) { var p = self.exitPoint(b, k, u.t.moveClass); u.x = p[0]; u.y = p[1]; u.state = 'idle'; u.inside = null; u.cd = 0.3; });
    b.inside = []; if (b.claim != null && b.claim !== b.owner) { b.claim = null; b.capT = 0; }   // 점령 중에 나가면 점령이 취소된다 (추정)
  };
  P.canAfford = function (fac, cost) { var r = this.res[fac]; for (var i = 0; i < 5; i++) if (r[i] < cost[i]) return false; return true; };
  P.producible = function (b) { if (b.owner < 0) return []; var o = b.owner, t = b.b.type; return this.types.filter(function (ty) { return ty.fac === o && ty.base && ty.prod.indexOf(t) >= 0; }); };
  P.produce = function (b, type) {
    if (b.owner !== type.fac || !type.base || type.prod.indexOf(b.b.type) < 0 || b.queue.length >= 5 || !this.canAfford(b.owner, type.cost)) return false;
    var pop = 0, o = b.owner; this.units.forEach(function (u) { if (u.fac === o && u.living()) pop++; }); this.buildings.forEach(function (x) { if (x.owner === o) pop += x.queue.length; });
    if (pop >= this.popCap) return false;                    // 인구 상한: 플레이어당 유닛 슬롯 200개 (원본 구조)
    var r = this.res[b.owner]; for (var i = 0; i < 5; i++) r[i] -= type.cost[i];
    b.queue.push({ type: type, t: 0, total: Math.max(1, type.btime) }); return true;
  };
  /* 전직: 건물 안의 유닛을 상급 유닛으로. 비용(금)·시간·요구 레벨은 대상 유닛 레코드의 값 */
  P.promote = function (u, type) {
    var b = u.inside; if (!b || u.promo || u.t.up.indexOf(type.id) < 0 || u.level < type.upLv || this.res[u.fac][3] < type.upGold) return false;
    this.res[u.fac][3] -= type.upGold; u.promo = { type: type, t: 0, total: Math.max(1, type.upTime) }; return true;
  };
/* 채취 주기 표 (실행 파일의 표 값, 주기 = 값 + 1틱) */
  var T_CIV = [0, 86, 72, 64, 58, 52, 48, 44], T_WM = [0, 614, 384, 341, 307, 279, 256, 236], T_GOLD = [19, 17, 15, 14, 13, 12, 11, 10, 10, 9], T_GEM = [44, 39, 35, 32, 29, 27, 25, 23], T_HP = [16, 15, 14, 13, 12, 11, 11, 10, 10, 9, 9, 8, 8, 8, 7];
  function at(tb, i) { return tb[Math.min(tb.length - 1, i)]; }
  /* 원본 게임 틱 한 번 (FUN_004c9b60 건물 틱): 점령 진행, 채취, 건물 안 회복 */
  P._buildingTick = function (b) {
    var n = b.inside.length, k, u, bon = { prod: 0, hp: 0, mp: 0, pop: 0, gold: 0, gem: 0, cap: 0 };
    for (k = 0; k < n; k++) { var tb = b.inside[k].t.bon; bon.prod += tb.prod; bon.hp += tb.hp; bon.mp += tb.mp; bon.pop += tb.pop; bon.gold += tb.gold; bon.gem += tb.gem; bon.cap += tb.cap; }
    if (b.claim != null && b.claim !== b.owner) {            // 점령 중: 틱마다 1 + 보너스÷16 씩 줄고, 그동안 채취·회복 없음
      if (!n) return; b.capT -= 1 + bon.cap / 16;
      if (b.capT <= 0) { b.owner = b.claim; b.capT = 0; this.events.emit('capture', b, b.owner); }
      return;
    }
    if (b.owner < 0 || !n) return;
    var r = this.res[b.owner], f = b.owner, c = b.cnt || (b.cnt = { civ: 0, wm: 0, gold: 0, gem: 0 }), ip = Math.min(3, n) + bon.pop;
    function take(key, period, slots, amt) { if (++c[key] <= period) return; c[key] = 0; slots.forEach(function (s) { var g = Math.min(b.pool[s], amt); b.pool[s] -= g; r[s] += g; }); }
    if (f === 1 || f === 2) take('civ', at(T_CIV, ip), [0], 1);                 // 민간인: 악령군·흑마술파
    if (f === 0 || f === 1) take('wm', at(T_WM, ip), [1, 2], 1);                // 전사형·마법사형: 해방부대·악령군
    if (f === 0) take('gold', at(T_GOLD, bon.gold), [3], 5);                    // 금 5씩: 해방부대 (연금술사가 주기를 줄임)
    if (f === 2) take('gem', at(T_GEM, bon.gem), [4], 1);                       // 젬 1씩: 흑마술파
    var hp = at(T_HP, bon.hp);
    for (k = 0; k < n; k++) { u = b.inside[k];                                       // 건물 안 회복: 체력은 표 주기, 마나는 6틱마다
      if (u.hp < u.maxHp && this.gtick % hp === 0) u.hp++;
      if (u.mp < u.maxMp && this.gtick % 6 === 0) u.mp++;
      if (u.promo && ++u.promo.t >= u.promo.total) { u.setType(u.promo.type); u.promo = null; this.events.emit('promote', u, b); } }
    var q = b.queue[0];
    if (q) q.t += 1 + bon.prod;
    if (q && q.t >= q.total) { b.queue.shift(); var p = this.exitPoint(b, this.gtick % 7, q.type.moveClass), nu = this.spawn(q.type, b.owner, p[0], p[1]); nu.made = true; this.events.emit('produced', nu, b); }
  };
  P._economy = function () { for (var t = 0; t < this._gt; t++) for (var i = 0; i < this.buildings.length; i++) this._buildingTick(this.buildings[i]); };
})(typeof window !== 'undefined' ? window : globalThis);
