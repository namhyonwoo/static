/* WorldView: 카메라 + 지형·배치물·유닛·발사체 그리기. World를 읽기만 한다. */
(function (root) {
  'use strict';
  var MWE = root.MWE;

  function WorldView(ctx, map, assets, vw, vh) {
    this.ctx = ctx; this.map = map; this.assets = assets; this.vw = vw; this.vh = vh;
    this.cam = { x: 0, y: 0 }; this.terrain = new MWE.TerrainRenderer(map, assets.get(map.keys.tiles));
    this.showBlocked = false; this.time = 0;
    this.fx = null; this.effects = []; this.marks = [];
    /* 안개: 0 미탐사, 1 탐사함, 2 지금 보임. 시야 반경은 추정 */
    this.reveals = []; this.fogOn = true; this.fogFac = 0; this.fog = new Uint8Array(map.M * map.M); this._fogT = 0; this.sight = 9;   // 타격 이펙트, 이동 표시 (화면 전용 상태)
  }
  var P = WorldView.prototype;
  P.clampCam = function () {
    var c = this.cam, m = this.map;
    c.x = Math.max(-100, Math.min(m.worldW - this.vw + 100, c.x)); c.y = Math.max(-60, Math.min(m.worldH - this.vh + 60, c.y));
  };
  P.centerOn = function (tx, ty) { var w = this.map.t2w(tx, ty); this.cam.x = w[0] - this.vw / 2; this.cam.y = w[1] - this.map.elevAt(tx, ty) - this.vh / 2; this.clampCam(); };
  P.scroll = function (dx, dy) { this.cam.x += dx; this.cam.y += dy; this.clampCam(); };
  /* 타일 좌표 → 화면 (고도 반영) */
  P.toScreen = function (tx, ty) { var w = this.map.t2w(tx, ty); return [w[0] - this.cam.x, w[1] - this.map.elevAt(tx, ty) - this.cam.y]; };
  /* 화면 → 땅 위 타일 좌표 */
  P.groundAt = function (sx, sy) {
    var m = this.map, wx = sx + this.cam.x, wy = sy + this.cam.y, t = m.w2t(wx, wy);
    for (var i = 0; i < 3; i++) t = m.w2t(wx, wy + m.elevAt(t[0], t[1]));
    return [m.clamp(t[0]), m.clamp(t[1])];
  };
/* 화면 좌표에 있는 유닛. 지금 그려진 스프라이트의 영역(좌우 반전·비행 높이 포함)으로 판정한다.
     그림이 작은 유닛은 최소 24×30 영역을 보장하고, 겹치면 영역 중심에 가까운 쪽을 고른다. */
  P.unitRect = function (u, fps) {
    var p = this.toScreen(u.x, u.y), fi = u.frameIndex(fps), f = fi >= 0 ? u.t.frames[fi] : null, ax = p[0], ay = p[1] - u.t.alt;
    if (!f) return [ax - 14, ay - 44, 28, 48];
    var l = u.mir ? ax - (f[2] - f[4]) : ax - f[4], t = ay - f[5], w = f[2], h = f[3];
    if (w < 24) { l -= (24 - w) / 2; w = 24; } if (h < 30) { t -= (30 - h); h = 30; }
    return [l, t, w, h];
  };
  P.unitAt = function (world, sx, sy, pred) {
    var best = null, bd = 1e9, L = world.units, fps = world.rules.tps;
    for (var i = 0; i < L.length; i++) {
      var u = L[i]; if (!u.alive() || !pred(u) || (u.fac !== this.fogFac && !this.visible(u.x, u.y))) continue;
      var r = this.unitRect(u, fps); if (sx < r[0] - 2 || sx > r[0] + r[2] + 2 || sy < r[1] - 2 || sy > r[1] + r[3] + 2) continue;
      var dx = sx - (r[0] + r[2] / 2), dy = sy - (r[1] + r[3] / 2), d = dx * dx + dy * dy; if (d < bd) { bd = d; best = u; }
    }
    return best;
  };
  P.resetFog = function (fac) { this.fogFac = fac; this.fog.fill(0); this._fogT = 0; };
  P.updateFog = function (world) {
    var M = this.map.M, F = this.fog, i, r = this.sight, self = this;
    for (i = 0; i < F.length; i++) if (F[i] === 2) F[i] = 1;
    function see(x, y, rr) { var x0 = Math.max(0, Math.floor(x - rr)), x1 = Math.min(M - 1, Math.ceil(x + rr)), y0 = Math.max(0, Math.floor(y - rr)), y1 = Math.min(M - 1, Math.ceil(y + rr)), r2 = rr * rr;
      for (var ty = y0; ty <= y1; ty++) for (var tx = x0; tx <= x1; tx++) if ((tx - x) * (tx - x) + (ty - y) * (ty - y) <= r2) F[ty * M + tx] = 2; }
    world.units.forEach(function (u) { if (u.fac === self.fogFac && u.alive()) see(u.x, u.y, u.t.sight || r); });
    world.buildings.forEach(function (b) { if (b.owner === self.fogFac) see(b.x, b.y, r); });
    this.reveals = this.reveals.filter(function (v) { if (v.until < self.time) return false; see(v.x, v.y, v.r); return true; });
  };
  /* 이 진영 눈에 지금 보이는 위치인가 */
  P.visible = function (x, y) { if (!this.fogOn) return true; var M = this.map.M, tx = Math.round(x), ty = Math.round(y); if (tx < 0 || ty < 0 || tx >= M || ty >= M) return false; return this.fog[ty * M + tx] === 2; };
  P._drawFog = function () {
    var ctx = this.ctx, m = this.map, M = m.M, F = this.fog;
    var c0 = this.groundAt(0, 0), c1 = this.groundAt(this.vw, 0), c2 = this.groundAt(0, this.vh), c3 = this.groundAt(this.vw, this.vh);
    var x0 = Math.max(0, Math.floor(Math.min(c0[0], c2[0])) - 3), x1 = Math.min(M - 1, Math.ceil(Math.max(c1[0], c3[0])) + 3), y0 = Math.max(0, Math.floor(Math.min(c0[1], c1[1])) - 3), y1 = Math.min(M - 1, Math.ceil(Math.max(c2[1], c3[1])) + 3);
    for (var pass = 0; pass < 2; pass++) {
      ctx.fillStyle = pass ? 'rgba(3,5,10,.94)' : 'rgba(3,5,10,.5)'; ctx.beginPath();
      for (var ty = y0; ty <= y1; ty++) for (var tx = x0; tx <= x1; tx++) { var v = F[ty * M + tx]; if (v === 2 || (v === 1) === !!pass) continue;
        var p = this.toScreen(tx, ty); if (p[0] < -40 || p[0] > this.vw + 40 || p[1] < -24 || p[1] > this.vh + 24) continue;
        ctx.moveTo(p[0], p[1] - 17); ctx.lineTo(p[0] + 33, p[1]); ctx.lineTo(p[0], p[1] + 17); ctx.lineTo(p[0] - 33, p[1]); ctx.closePath(); }
      ctx.fill();
    }
  };
  P.addEffect = function (x, y, z, arm) { var d = this.fx && this.fx.arms[arm], fr = d && (d.hit.length ? d.hit : d.fly); if (fr && fr.length) this.effects.push({ x: x, y: y, z: z, f: fr, t0: this.time, add: !d.dir }); };
  P.addMark = function (x, y) { this.marks.push({ x: x, y: y, t0: this.time }); };
  P._sprite = function (fr, x, y, mir, add) {
    var ctx = this.ctx, img = this.assets.get('arms');
    if (add) ctx.globalCompositeOperation = 'lighter';   // 빛나는 이펙트는 가산 합성 (검은 바탕이 사라진다)
    if (mir) { ctx.save(); ctx.translate(Math.round(x), Math.round(y)); ctx.scale(-1, 1); ctx.drawImage(img, fr[0], fr[1], fr[2], fr[3], -fr[4], -fr[5], fr[2], fr[3]); ctx.restore(); }
    else ctx.drawImage(img, fr[0], fr[1], fr[2], fr[3], Math.round(x - fr[4]), Math.round(y - fr[5]), fr[2], fr[3]);
    if (add) ctx.globalCompositeOperation = 'source-over';
  };
  P.buildingAt = function (world, sx, sy) { var B = world.buildings; for (var i = 0; i < B.length; i++) { var p = this.toScreen(B[i].x, B[i].y); if (Math.abs(sx - p[0]) < 72 && sy - p[1] > -95 && sy - p[1] < 40) return B[i]; } return null; };
  P.reveal = function (x, y, r, sec) { this.reveals.push({ x: x, y: y, r: r, until: this.time + sec }); };
  P._drawBlocked = function () {
    var ctx = this.ctx, m = this.map, S = m.S, a = m.attr, COL = { 5: 'rgba(70,150,255,.45)', 8: 'rgba(80,230,220,.45)', 9: 'rgba(255,70,200,.45)' };
    var c0 = this.groundAt(0, 0), c1 = this.groundAt(this.vw, 0), c2 = this.groundAt(0, this.vh), c3 = this.groundAt(this.vw, this.vh);
    var x0 = Math.max(0, m.cellOf(Math.min(c0[0], c2[0])) - 6), x1 = Math.min(S - 1, m.cellOf(Math.max(c1[0], c3[0])) + 6);
    var y0 = Math.max(0, m.cellOf(Math.min(c0[1], c1[1])) - 6), y1 = Math.min(S - 1, m.cellOf(Math.max(c2[1], c3[1])) + 6);
    for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) {
      var col = COL[a[y * S + x]]; if (!col) continue;
      var p = this.toScreen(m.cellCenter(x), m.cellCenter(y));
      if (p[0] < -20 || p[0] > this.vw + 20 || p[1] < -12 || p[1] > this.vh + 12) continue;
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(p[0], p[1] - 7); ctx.lineTo(p[0] + 14, p[1]); ctx.lineTo(p[0], p[1] + 7); ctx.lineTo(p[0] - 14, p[1]); ctx.fill();
    }
  };
  /* opts: { selected:Set-like(has), colors:[진영색], dragBox, paths:bool } */
  P.draw = function (world, opts) {
    var ctx = this.ctx, m = this.map, cam = this.cam, vw = this.vw, vh = this.vh, A = this.assets, i;
    ctx.fillStyle = '#07090c'; ctx.fillRect(0, 0, vw, vh);
    if (this.fogOn && this.time - this._fogT > 0.2) { this._fogT = this.time; this.updateFog(world); }
    this.terrain.draw(ctx, cam, vw, vh);
    if (this.showBlocked) this._drawBlocked();
    // 원본 이동 표시(mouseMove.spr): 우클릭한 땅 위에 한 번 재생
    var MK = this.fx && this.fx.mark, mk = A.get('movemark'), keep = [];
    for (i = 0; MK && i < this.marks.length; i++) {
      var mkk = this.marks[i], fi2 = Math.floor((this.time - mkk.t0) * 20); if (fi2 >= MK.n * 2) continue; keep.push(mkk);
      var mo = MK.o[fi2 % MK.n], mp = this.toScreen(mkk.x, mkk.y);
      ctx.drawImage(mk, (fi2 % MK.n) * MK.w, 0, mo[0], mo[1], Math.round(mp[0] - mo[2]), Math.round(mp[1] - mo[3]), mo[0], mo[1]);
    }
    this.marks = keep;
    // 깊이 정렬: 배치물과 유닛을 한 목록으로
    var list = [], L = world.units, u, p;
    for (i = 0; i < L.length; i++) {
      u = L[i]; if (u.state === 'inside' || (u.state === 'dead' && u.deadT > 7)) continue;
      if (u.fac !== this.fogFac && !this.visible(u.x, u.y)) continue;
      p = this.toScreen(u.x, u.y); if (p[0] < -80 || p[0] > vw + 80 || p[1] < -60 || p[1] > vh + 140) continue;
      list.push({ d: (u.state === 'dead' ? -1000 : 0) + u.x + u.y, u: u, p: p });
    }
    var O = m.objs, OF = m.objFrames, OD = m.objDefs, objs = A.get(m.keys.objs);
    for (i = 0; i < O.length; i++) {
      var o = O[i], sx = o[1] - cam.x, sy = o[2] - cam.y; if (sx < -260 || sx > vw + 260 || sy < -40 || sy > vh + 340) continue;
      list.push({ d: o[3], o: o, x: sx, y: sy });
    }
    var B = m.blds, BF = m.bldFrames, bimg = A.get(m.keys.blds);
    for (i = 0; i < B.length; i++) { var bb = B[i], bx = bb.x - cam.x, by = bb.y - cam.y; if (bx < -300 || bx > vw + 300 || by < -80 || by > vh + 400) continue; list.push({ d: bb.d, b: bb, x: bx, y: by, own: world.buildings[i].claim != null ? world.buildings[i].claim : world.buildings[i].owner, sel: opts.selB === world.buildings[i], c: bb.c }); }
    list.sort(function (a, b) { return a.d - b.d; });
    for (i = 0; i < list.length; i++) {
      var it = list[i];
      if (it.b) { var bf = it.b.f, f0 = BF[bf[0]];
        if (it.own >= 0 || it.sel) { if (it.own < 0) ctx.setLineDash([5, 4]); var cp = this.toScreen(it.c[0], it.c[1]); ctx.strokeStyle = it.sel ? 'rgba(120,255,140,.95)' : opts.colors[it.own]; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cp[0], cp[1] - 44); ctx.lineTo(cp[0] + 88, cp[1]); ctx.lineTo(cp[0], cp[1] + 44); ctx.lineTo(cp[0] - 88, cp[1]); ctx.closePath(); ctx.stroke(); ctx.setLineDash([]); }
        ctx.drawImage(bimg, f0[0], f0[1], f0[2], f0[3], Math.round(it.x - f0[4]), Math.round(it.y - f0[5]), f0[2], f0[3]);
        if (bf.length > 1) { var nn = bf.length - 1, ph = Math.floor(this.time * 6) % (nn * 2 - (nn > 1 ? 2 : 0) || 1), f1 = BF[bf[1 + (ph < nn ? ph : nn * 2 - 2 - ph)]];   // 덧그림은 왕복 재생
          ctx.drawImage(bimg, f1[0], f1[1], f1[2], f1[3], Math.round(it.x - f1[4]), Math.round(it.y - f1[5]), f1[2], f1[3]); }
        continue; }
      if (it.o) { var fl = OD[it.o[0]].f, fr = OF[fl[fl.length > 1 ? Math.floor(this.time * 8) % fl.length : 0]];
        ctx.drawImage(objs, fr[0], fr[1], fr[2], fr[3], Math.round(it.x - fr[4]), Math.round(it.y - fr[5]), fr[2], fr[3]); continue; }
      u = it.u; p = it.p; var alt = u.t.alt, fi = u.frameIndex(world.rules.tps), isSel = opts.selected && opts.selected.indexOf(u) >= 0;
      if (u.alive()) {
        ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.ellipse(p[0], p[1], 13, 6, 0, 0, 6.283); ctx.fill();
        if (isSel) { ctx.strokeStyle = 'rgba(120,255,140,.95)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.ellipse(p[0], p[1] + 1, 14, 6.5, 0, 0, 6.283); ctx.stroke();   // 선택 표시: 발밑의 작은 원
          if (opts.focus === u && opts.selected.length > 1) { ctx.strokeStyle = 'rgba(255,226,150,.9)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(p[0], p[1] + 1, 10.5, 4.5, 0, 0, 6.283); ctx.stroke(); } }
      }
      if (fi < 0) continue;
      var f = u.t.frames[fi];
      ctx.save();
      if (u.state === 'dead') ctx.globalAlpha = Math.max(0, Math.min(1, (7 - u.deadT) / 2));
      ctx.translate(Math.round(p[0]), Math.round(p[1] - alt)); if (u.mir) ctx.scale(-1, 1);
      ctx.drawImage(A.get('u' + u.t.id), f[0], f[1], f[2], f[3], -f[4], -f[5], f[2], f[3]);
      ctx.restore();
      if (u.alive() && (u.hp < u.maxHp || isSel)) {
        if (isSel) {                                   // 선택된 유닛: 발밑 원 아래에 체력·마나 바 (체력은 비율에 따라 초록→노랑→빨강)
          var sw = 28, sx0 = Math.round(p[0] - sw / 2), sy0 = Math.round(p[1] + 10), hr = Math.max(0, Math.min(1, u.hp / u.maxHp));
          ctx.fillStyle = 'rgba(6,8,12,.8)'; ctx.fillRect(sx0 - 1, sy0 - 1, sw + 2, u.maxMp ? 9 : 5);
          ctx.fillStyle = hr > 0.5 ? '#5fc46a' : hr > 0.25 ? '#d9b23c' : '#d2513f'; ctx.fillRect(sx0, sy0, Math.round(sw * hr), 3);
          if (u.maxMp) { ctx.fillStyle = '#4f8fe0'; ctx.fillRect(sx0, sy0 + 4, Math.round(sw * Math.max(0, Math.min(1, u.mp / u.maxMp))), 3); }
        } else {
        var bw = 30, by = p[1] - alt - f[5] - 7;
        ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(p[0] - bw / 2 - 1, by - 1, bw + 2, 5);
        ctx.fillStyle = opts.colors[u.fac]; ctx.fillRect(p[0] - bw / 2, by, bw * u.hp / u.maxHp, 3);
        }
      }
    }
    if (opts.paths && opts.selected) {           // 선택 유닛의 경로 표시
      ctx.strokeStyle = 'rgba(255,220,120,.7)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      opts.selected.forEach(function (s) { if (!s.path || !s.path.length || !s.alive()) return;
        var q = this.toScreen(s.x, s.y); ctx.beginPath(); ctx.moveTo(q[0], q[1]);
        s.path.forEach(function (w) { var r = this.toScreen(w[0], w[1]); ctx.lineTo(r[0], r[1]); }, this); ctx.stroke(); }, this);
      ctx.setLineDash([]);
    }
    for (i = 0; i < world.shots.length; i++) {
      var s = world.shots[i], q = this.toScreen(s.x, s.y), qy = q[1] - s.z; if (!this.visible(s.x, s.y)) continue;
      var ad = this.fx && this.fx.arms[s.arm];
      if (ad && ad.fly.length) {
        if (ad.dir) { var sdx = (s.dx - s.dy) * 32, sdy = (s.dx + s.dy) * 16, ang = Math.atan2(sdx, -sdy) * 180 / Math.PI; if (ang < 0) ang += 360;
          var east = ang < 180, tt = east ? ang : 360 - ang; this._sprite(this.fx.frames[ad.fly[Math.min(16, Math.round(tt / 180 * 16))]], q[0], qy, east); }
        else this._sprite(this.fx.frames[ad.fly[Math.floor(s.t * 15) % ad.fly.length]], q[0], qy, false, true);
        continue;
      }
      ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.beginPath(); ctx.arc(q[0], qy, 2.2, 0, 6.283); ctx.fill();
      ctx.fillStyle = opts.colors[s.from.fac]; ctx.globalAlpha = .5; ctx.beginPath(); ctx.arc(q[0], qy, 5, 0, 6.283); ctx.fill(); ctx.globalAlpha = 1;
    }
    if (this.fogOn) this._drawFog();
    var ek = [];
    for (i = 0; i < this.effects.length; i++) { var e = this.effects[i], ef = Math.floor((this.time - e.t0) * 15); if (ef >= e.f.length) continue; ek.push(e);
      if (!this.visible(e.x, e.y)) continue;
      var ep = this.toScreen(e.x, e.y); this._sprite(this.fx.frames[e.f[ef]], ep[0], ep[1] - e.z, false, e.add); }
    this.effects = ek;
    var b = opts.dragBox;
    if (b) { ctx.strokeStyle = 'rgba(120,255,140,.9)'; ctx.lineWidth = 1; ctx.strokeRect(Math.min(b.x0, b.x1) + .5, Math.min(b.y0, b.y1) + .5, Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0)); }
  };
  MWE.WorldView = WorldView;
})(window);
