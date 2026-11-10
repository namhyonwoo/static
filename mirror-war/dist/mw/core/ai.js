/* SimpleAI: 컴퓨터 진영의 행동. 원본 AI를 옮긴 것이 아니라 시연용으로 만든 규칙이다.
   2초마다: 빈 건물에 유닛을 들여보내 점령하고, 자원이 되면 생산하고, 나머지는 가까운 적을 공격한다. */
(function (root) {
  'use strict';
  var MWE = root.MWE;
  function SimpleAI(world, fac) { this.world = world; this.fac = fac; this.t = 0; this.on = true; }
  SimpleAI.prototype.update = function (dt) {
    if (!this.on) return; this.t += dt; if (this.t < 2) return; this.t = 0;
    var w = this.world, f = this.fac, L = w.units, B = w.buildings, i, j;
    var free = L.filter(function (u) { return u.fac === f && u.alive() && !u.order && u.state !== 'attack'; });
    // 건물: 비어 있거나 우리 것인데 안이 빈 건물에 지상 유닛 한 기씩
    for (j = 0; j < B.length; j++) {
      var b = B[j]; if (b.inside.length || (b.owner < 0 && b.claim !== f && !w.canPay(f, b)) || L.some(function (u) { return u.fac === f && u.order && u.order.type === 'enter' && u.order.b === b; })) continue;
      var pick = null, pd = 40;
      for (i = 0; i < free.length; i++) { var c = free[i]; if (c.t.fly === 2 || c.buffs.charm) continue; var d = Math.hypot(b.x - c.x, b.y - c.y); if (d < pd) { pd = d; pick = c; } }
      if (pick) { w.orderEnter(pick, b); free.splice(free.indexOf(pick), 1); }
    }
    // 생산: 대기열이 빈 우리 건물에서 살 수 있는 유닛 하나
    for (j = 0; j < B.length; j++) { var ob = B[j]; if (ob.owner !== f || ob.queue.length) continue;
      var can = w.producible(ob).filter(function (ty) { return w.canAfford(f, ty.cost); });
      if (can.length) w.produce(ob, can[Math.floor(w.rng.next() * can.length)]); }
    // 전투: 가까운 적이 있으면 공격 이동, 없으면 가장 가까운 적에게
    for (i = 0; i < free.length; i++) {
      var u = free[i], best = null, bd = 1e9;
      for (j = 0; j < L.length; j++) { var o = L[j]; if (o.fac === f || !o.alive()) continue; var de = u.distTo(o); if (de < bd) { bd = de; best = o; } }
      if (best && (bd < 14 || w.tickN > 30 * 40)) w.orderMove(u, best.x, best.y, true);
    }
  };
  MWE.SimpleAI = SimpleAI;
})(typeof window !== 'undefined' ? window : globalThis);
