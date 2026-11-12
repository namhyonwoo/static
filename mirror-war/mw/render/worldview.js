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
    this.reveals = []; this.fogOn = false; this.fogFac = 0; this.fog = new Uint8Array(map.M * map.M); this._fogT = 0; this.sight = 9;   // 타격 이펙트, 이동 표시 (화면 전용 상태)
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
    var p = this.toScreen(u.x, u.y), fi = u.frameIndex(fps), f = fi >= 0 ? u.t.frames[fi] : null, ax = p[0], ay = p[1];   // 비행 높이는 스프라이트 오프셋에 이미 들어 있다 (alt를 또 빼면 두 배로 뜬다)
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
  /* 실루엣 그림자 (목업 고유 — 원본에 그림자가 있는지는 확인하지 않음).
     유닛·건물의 지금 프레임을 검게 칠해 바닥에 눕힌다: 세로를 shadow.sy배로 누르고 shadow.skew만큼 기울인다.
       지상·저공 유닛  발밑 기준점을 축으로 눕힌다 (발에서 그림자가 뻗어 나온다)
       건물            바닥 마름모의 중심을 축으로 눕힌다
       공중 유닛       그림의 아랫변을 지면 좌표에 맞춘다 (본체는 그 위에 떠 있다)
     겹친 그림자가 더 진해지지 않도록 화면 크기의 층에 불투명한 검정으로 모은 뒤 shadow.alpha로 한 번에 얹는다.
     매 프레임 좌표·프레임에서 다시 만들기 때문에 이동·동작·좌우 반전을 그대로 따라간다.
     순서 (draw): 지상 그림자 → 배치물·건물·지상 유닛 → 공중 그림자와 진영 원 → 공중 유닛 본체. */
  P.shadow = { sy: 0.45, skew: -0.95, alpha: 0.38 };   // 세로 압축, 기울기(위쪽이 오른쪽으로), 투명도. 덜 기울이면 그림자가 본체 뒤에 가려 거의 안 보인다
  P._shadowLayer = function () {
    var L = this._shL || (this._shL = document.createElement('canvas')); if (L.width !== this.vw || L.height !== this.vh) { L.width = this.vw; L.height = this.vh; }
    var c = L.getContext('2d'); c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, L.width, L.height); return c;
  };
  /* 프레임 f = [sx, sy, w, h, …]의 실루엣을 층 c에 눕혀 그린다. (px,py) 축, (dx,dy) 축에서 그림 왼쪽 위까지 */
  P._cast = function (c, im, f, px, py, dx, dy, mir) {
    var S = this.shadow, cv = this._shCv || (this._shCv = document.createElement('canvas')), sc = this._shCtx || (this._shCtx = cv.getContext('2d'));
    if (cv.width < f[2] || cv.height < f[3]) { cv.width = Math.max(cv.width, f[2]); cv.height = Math.max(cv.height, f[3]); }
    sc.globalCompositeOperation = 'source-over'; sc.clearRect(0, 0, cv.width, cv.height); sc.drawImage(im, f[0], f[1], f[2], f[3], 0, 0, f[2], f[3]);
    sc.globalCompositeOperation = 'source-in'; sc.fillStyle = '#000'; sc.fillRect(0, 0, f[2], f[3]);            // 그림 모양 그대로 검게
    c.setTransform(1, 0, 0, 1, px, py); c.transform(1, 0, S.skew, S.sy, 0, 0); if (mir) c.scale(-1, 1);
    c.drawImage(cv, 0, 0, f[2], f[3], dx, dy, f[2], f[3]);
  };
  P._groundShadows = function (world, list) {
    var c = this._shadowLayer(), A = this.assets, m = this.map, BF = m.bldFrames, bimg = A.get(m.keys.blds), tps = world.rules.tps, n = 0;
    for (var i = 0; i < list.length; i++) {
      var it = list[i], u = it.u;
      if (it.b) { var f0 = BF[it.b.f[0]], cp = this.toScreen(it.c[0], it.c[1]); this._cast(c, bimg, f0, Math.round(cp[0]), Math.round(cp[1]), Math.round(it.x - f0[4] - cp[0]), Math.round(it.y - f0[5] - cp[1]), false); n++; continue; }
      if (!u || u.t.fly === 2 || !u.alive() || u.tp) continue;   // 순간이동 중에는 그림자 없음
      var fi = u.frameIndex(tps), f = fi >= 0 ? u.t.frames[fi] : null, im = A.get((f && f[6]) || ('u' + u.t.id)); if (!f || !im) continue;
      this._cast(c, im, f, Math.round(it.p[0]), Math.round(it.p[1]), -f[4], -f[5], u.mir); n++;
    }
    if (n) { this.ctx.save(); this.ctx.globalAlpha = this.shadow.alpha; this.ctx.drawImage(this._shL, 0, 0); this.ctx.restore(); }
  };
  P._airShadows = function (world, list, opts) {
    var ctx = this.ctx, A = this.assets, HB = root.MW && root.MW.hpbar, tps = world.rules.tps, c = this._shadowLayer(), n = 0, i, u, p;
    for (i = 0; i < list.length; i++) {
      u = list[i].u; if (!u || u.t.fly !== 2 || !u.alive() || u.tp) continue;
      p = list[i].p; var fi = u.frameIndex(tps), f = fi >= 0 ? u.t.frames[fi] : null, im = A.get((f && f[6]) || ('u' + u.t.id)); if (!f || !im) continue;
      this._cast(c, im, f, Math.round(p[0]), Math.round(p[1]), -f[4], -f[3], u.mir); n++;                        // 아랫변을 지면 좌표에
    }
    if (n) { ctx.save(); ctx.globalAlpha = this.shadow.alpha; ctx.drawImage(this._shL, 0, 0); ctx.restore(); }
    for (i = 0; i < list.length; i++) {
      u = list[i].u; if (!u || u.t.fly !== 2 || !u.alive()) continue;
      p = list[i].p; var px = Math.round(p[0]), py = Math.round(p[1]), bw = HB && HB.units[u.t.id] ? HB.units[u.t.id][1] : 31, rx = bw * 0.45, ry = rx * 0.42, isSel = opts.selected && opts.selected.indexOf(u) >= 0;
      ctx.strokeStyle = u.fac === opts.me ? (isSel ? 'rgba(110,185,255,1)' : 'rgba(90,170,255,.5)') : (isSel ? 'rgba(255,95,70,1)' : 'rgba(247,77,49,.5)');
      ctx.lineWidth = isSel ? 2 : 1; ctx.beginPath(); ctx.ellipse(px, py + 1, rx + 2, ry + 1.5, 0, 0, 6.283); ctx.stroke();
      if (isSel && opts.focus === u && opts.selected.length > 1) { ctx.strokeStyle = 'rgba(255,226,150,.9)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(px, py + 1, rx * 0.7, ry * 0.7, 0, 0, 6.283); ctx.stroke(); }
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
    /* 두 겹으로 그린다: ① 지상(배치물·건물·지상 유닛) → 공중 유닛의 바닥 그림자 → ② 공중 유닛(fly = 2) 본체.
       그림자는 지상의 모든 것 위에, 공중 유닛 본체 아래에 놓인다. */
    this._groundShadows(world, list);
    for (var pass = 0; pass < 2; pass++) {
    if (pass === 1) this._airShadows(world, list, opts);
    for (i = 0; i < list.length; i++) {
      var it = list[i];
      if ((pass === 1) !== !!(it.u && it.u.t.fly === 2)) continue;
      if (it.b) { var bf = it.b.f, f0 = BF[bf[0]];
        if (it.own >= 0 || it.sel) { if (it.own < 0) ctx.setLineDash([5, 4]); var cp = this.toScreen(it.c[0], it.c[1]); ctx.strokeStyle = it.sel ? 'rgba(120,255,140,.95)' : opts.colors[it.own]; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cp[0], cp[1] - 44); ctx.lineTo(cp[0] + 88, cp[1]); ctx.lineTo(cp[0], cp[1] + 44); ctx.lineTo(cp[0] - 88, cp[1]); ctx.closePath(); ctx.stroke(); ctx.setLineDash([]); }
        ctx.drawImage(bimg, f0[0], f0[1], f0[2], f0[3], Math.round(it.x - f0[4]), Math.round(it.y - f0[5]), f0[2], f0[3]);
        if (bf.length > 1) { var nn = bf.length - 1, ph = Math.floor(this.time * 6) % (nn * 2 - (nn > 1 ? 2 : 0) || 1), f1 = BF[bf[1 + (ph < nn ? ph : nn * 2 - 2 - ph)]];   // 덧그림은 왕복 재생
          ctx.drawImage(bimg, f1[0], f1[1], f1[2], f1[3], Math.round(it.x - f1[4]), Math.round(it.y - f1[5]), f1[2], f1[3]); }
        continue; }
      if (it.o) { var fl = OD[it.o[0]].f, fr = OF[fl[fl.length > 1 ? Math.floor(this.time * 8) % fl.length : 0]];
        ctx.drawImage(objs, fr[0], fr[1], fr[2], fr[3], Math.round(it.x - fr[4]), Math.round(it.y - fr[5]), fr[2], fr[3]); continue; }
      /* 비행 높이: 공중 유닛의 프레임 오프셋(oy)에 고도가 이미 들어 있다(박쥐: 그림 아래가 기준점보다 94 위 = unitData +0x28 = 94).
         예전에는 여기서 alt를 한 번 더 빼서 두 배 높이에 그렸다. 발사체·이펙트의 z(alt + 24)는 한 번만 띄운 높이와 맞는다. */
      u = it.u; p = it.p; var alt = 0, fi = u.frameIndex(world.rules.tps), isSel = opts.selected && opts.selected.indexOf(u) >= 0;
      if (u.alive() && pass === 0) {                 // 공중 유닛의 그림자·진영 원은 _airShadows가 그린다
        /* 발밑 진영 원 (목업 고유): 모든 유닛에 항상. 아군 파랑, 적군 빨강. 선택한 유닛은 굵고 진하게 */
        var cmine = u.fac === opts.me;
        ctx.strokeStyle = cmine ? (isSel ? 'rgba(110,185,255,1)' : 'rgba(90,170,255,.5)') : (isSel ? 'rgba(255,95,70,1)' : 'rgba(247,77,49,.5)');
        ctx.lineWidth = isSel ? 2 : 1; ctx.beginPath(); ctx.ellipse(p[0], p[1] + 1, 14, 6.5, 0, 0, 6.283); ctx.stroke();
        if (isSel) {
          if (opts.focus === u && opts.selected.length > 1) { ctx.strokeStyle = 'rgba(255,226,150,.9)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(p[0], p[1] + 1, 10.5, 4.5, 0, 0, 6.283); ctx.stroke(); } }
      }
      if (fi < 0) continue;
      var f = u.t.frames[fi];
      ctx.save();
      if (u.state === 'dead') ctx.globalAlpha = Math.max(0, Math.min(1, (7 - u.deadT) / 2));
      else if (u.tp) ctx.globalAlpha = Math.max(0, Math.min(32, u.tp.f <= 16 ? (16 - u.tp.f) * 2 : (u.tp.f - 16) / 2)) / 32;   // 순간이동: 16틱 사라짐 → 64틱 나타남 (FUN_004f5370, 32단계)
      ctx.translate(Math.round(p[0]), Math.round(p[1] - alt)); if (u.mir) ctx.scale(-1, 1);
      if (u.state !== 'dead' && u.buffs.stone && u.buffs.stone.until > world.time) ctx.filter = 'grayscale(1) brightness(1.2)';   // 석화: 원본은 회색 팔레트(변형 20번)로 그린다 (FUN_004f5370, 분석 8-36). 필터를 지원하지 않는 브라우저에서는 그대로 보인다
      ctx.drawImage(A.get(f[6] || ('u' + u.t.id)), f[0], f[1], f[2], f[3], -f[4], -f[5], f[2], f[3]);
      ctx.restore();
      /* 순간이동 이펙트 (FUN_004f5370): 상태 틱 0~15 동안 출발 지점 바닥에 이펙트(유닛 +0xF6 = 칸 3 또는 21)를 틱 번호로 고른 그림으로 */
      if (u.tp && u.tp.f < 16 && this.fx) { var td = this.fx.arms[u.tp.arm], ts = td && (td.seq || td.hit);
        if (ts && ts.length) { var tq = this.toScreen(u.tp.sx, u.tp.sy); this._sprite(this.fx.frames[ts[Math.floor(u.tp.f) % ts.length]], tq[0], tq[1], false, !td.dir); } }
      /* 웨폰 계열 강화(파이어·매직·아이스·다크 웨폰): 걸려 있는 동안 이펙트가 발밑에서 계속 돌고 유닛을 따라다닌다.
         매 프레임 유닛의 발밑 좌표에 다시 그리므로 이동과 함께 움직인다. 원본도 유닛마다 발밑 좌표에 그린다
         (FUN_004f7490: 인스턴스 +0x34 = 이펙트 번호, +0x38 = 프레임 카운터). */
      var wb = u.buffs.weapon;
      if (wb && wb.arm >= 0 && wb.until > world.time && u.alive() && this.fx) { var wd = this.fx.arms[wb.arm], wf = wd && (wd.fly.length ? wd.fly : wd.hit);
        if (wf && wf.length) this._sprite(this.fx.frames[wf[Math.floor(this.time * 15) % wf.length]], p[0], p[1], false, !wd.dir); }
      /* 방어 강화(파운틴 베리어·이블 스피리츠 베리어·토네이도 실드·윈드 실드)도 같은 식으로 걸려 있는 동안 유닛을 따라다닌다.
         원본 FUN_004f7490: 인스턴스 +0x2C = 이펙트 번호, +0x30 = 프레임 카운터. 7(파운틴)·0x2B(윈드 실드)는 발밑에서 그림 높이(+0x26)만큼 위,
         0x13·0x23·0x29·0x4C는 높이의 절반 위에 그린다 (분석 8-32). */
      var sb = u.buffs.shield;
      if (sb && sb.arm >= 0 && sb.until > world.time && u.alive() && this.fx) { var sd = this.fx.arms[sb.arm], si = sd ? root.MWE.shieldFrame(sd, sb, u.t, this.time) : -1, sh = u.t.h || 48;   // 파운틴 베리어는 시전 동작 뒤 물줄기 유지 그림만 되풀이 (8-34)
        if (si >= 0) this._sprite(this.fx.frames[si], p[0], p[1] - (sb.arm === 7 || sb.arm === 43 ? sh : sh >> 1), false, !sd.dir); }
      /* 가속(케멘 소환·헤이스트): 걸려 있는 동안 머리 위(발밑에서 그림 높이 +0x26만큼 위)에 이펙트 칸 44(0x2C)가 돌며 따라다닌다.
         원본 FUN_004f7490: 인스턴스 +0x40 == 1이면 칸 0x2C를 프레임 카운터 +0x42로 그린다 (분석 8-33). */
      var hbf = u.buffs.haste;
      if (hbf && hbf.until > world.time && u.alive() && this.fx) { var hd = this.fx.arms[44], hq = hd && (hd.fly.length ? hd.fly : hd.hit);
        if (hq && hq.length) this._sprite(this.fx.frames[hq[Math.floor(this.time * 15) % hq.length]], p[0], p[1] - (u.t.h || 48), false, !hd.dir); }
      /* 체력·마나 바. 그림·색·폭·채움 식은 원본 그대로 (FUN_004f7cf0, 분석 8-27): bar.spr 틀, 종류별 폭(+0x100),
         체력은 초록·폭의 1/3 이하면 빨강, 마나 바는 마나가 있는 내 유닛만 6픽셀 아래, 오른쪽에 레벨 숫자(helpnum.mwl).
         위치와 표시 조건은 목업 고유: 원본은 발밑(+0x102)에 선택한 유닛만 그리지만, 여기서는 잘 보이도록 머리 위에 두고
         opts.bars = { ally, enemy, hurt }로 아군·적군 표시와 "체력이 닳았을 때만"을 고른다. 선택한 유닛은 항상 그린다. */
      var HB = root.MW && root.MW.hpbar, own = u.fac === opts.me, BO = opts.bars || {};
      if (HB && u.alive() && (isSel || (own ? BO.ally && (!BO.hurt || u.hp < u.maxHp) : BO.enemy))) {   // "닳았을 때만"은 아군에만 적용
        if (u.t.headY == null) u.t.headY = u.t.frames[0] ? u.t.frames[0][5] : 40;   // 머리 높이: 첫 프레임 기준으로 고정 (동작마다 흔들리지 않게)
        var hb = HB.units[u.t.id] || HB.units[0], bw = hb[1], hx = Math.round(p[0]), x0 = hx - (bw >> 1), hy = Math.round(p[1] - alt - u.t.headY) - (u.maxMp && own ? 12 : 6);
        var hf = HB.frames[hb[0]], him = A.get('hpbar'), fill = Math.floor(Math.max(0, u.hp) * bw / u.maxHp), ly = hy - 3;
        ctx.fillStyle = !own || fill <= Math.floor(bw / 3) ? HB.low : HB.hp; ctx.fillRect(x0, hy, fill + 1, 3);   // 적군은 항상 빨강 (목업 고유, 피아 구분용)
        ctx.drawImage(him, hf[0], hf[1], hf[2], hf[3], hx - hf[4], hy - 11 - hf[5], hf[2], hf[3]);
        if (u.maxMp && own) {
          ctx.fillStyle = HB.mp; ctx.fillRect(x0, hy + 6, Math.floor(Math.max(0, u.mp) * bw / u.maxMp) + 1, 3);
          ctx.drawImage(him, hf[0], hf[1], hf[2], hf[3], hx - hf[4], hy - 5 - hf[5], hf[2], hf[3]); ly = hy + 1;
        }
        for (var ls = String(u.level), li = 0, lx = x0 + bw + 3; li < ls.length; li++, lx += 5) { var lg = HB.digits[ls.charCodeAt(li) - 48]; if (lg) ctx.drawImage(him, lg[0], lg[1], lg[2], lg[3], lx - lg[4], ly - lg[5], lg[2], lg[3]); }
        if (hb[3] === 1) { var st = HB.frames[7]; ctx.save(); ctx.globalAlpha = 0.6; ctx.drawImage(him, st[0], st[1], st[2], st[3], x0 - st[4], hy - 20 - st[5], st[2], st[3]); ctx.restore(); }   // 영웅 별 (반투명 단계 3, 비율은 추정)
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
