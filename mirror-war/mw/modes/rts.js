/* RtsGame: RTS 모드 조립. 코어(World) + 렌더(WorldView) + UI(Hud) 위에
   "입력 → 명령" 번역만 담당한다. 자동전투 모드는 이 파일만 다른 것으로 바꾸면 된다. */
(function (root) {
  'use strict';
  var MWE = root.MWE;

  function RtsGame(canvas, data, opts) {
    this.cv = canvas; this.ctx = canvas.getContext('2d'); this.ctx.imageSmoothingEnabled = false;
    this.data = data; this.factions = opts.factions; this.colors = opts.factions.map(function (f) { return f.col; });
    this.startSlots = opts.startSlots; this.VW = 800; this.VH = 448;
    this.assets = new MWE.Assets(opts.base);
    ['tiles', 'minimap', 'objs', 'blds', 'acticons', 'movemark', 'hpbar', 'block', 'mouse', 'hud0', 'hud1', 'hud2', 'portraits', 'figs', 'icons'].forEach(function (k) { this.assets.load(k, k + '.png'); }, this);
    for (var ak = 0; ak < (data.fx.sheets || 1); ak++) this.assets.load('arms' + ak, 'arms' + ak + '.png');   // 이펙트 시트 (여러 장으로 나뉘어 있다 — fxbuild.js)
    data.units.forEach(function (u) { this.assets.load('u' + u.id, u.img); }, this);
    this.types = data.units.map(function (d) { return new MWE.UnitType(d); });
    this.maps = { battle: new MWE.GameMap(data.map), test: new MWE.GameMap(data.map2) };   // 전장(콜로세움)과 1:n 시험장(2인 맵의 평지)
    this.map = this.maps.battle;
    ['tiles2', 'minimap2', 'objs2', 'blds2'].forEach(function (k) { this.assets.load(k, k + '.png'); }, this);
    this.sfx = new MWE.Sfx(opts.base + 'sfx.js', data.sfx);
    this.bgm = new MWE.Bgm(opts.bgmBase || opts.base, [['bgm0.mp3', 'bgm0b.mp3', 'bgm0c.mp3'], ['bgm1.mp3', 'bgm1b.mp3', 'bgm1c.mp3'], ['bgm2.mp3', 'bgm2b.mp3', 'bgm2c.mp3']]);
    this.mode = 'battle'; this.test = { left: [{ id: 0, n: 1 }], right: [{ id: 28, n: 5 }], behave: 'dummy', tough: false };   // 양쪽 모두 [{유닛 번호, 수}] 목록   // mode: battle(전장) | test(아레나: n:m 시험)
    this.speed = 2; this.ais = []; this.aiOn = false; this.infMana = false;   // 컴퓨터 AI는 기본 꺼짐. infMana: 모든 유닛의 마나를 항상 가득 (시험용) this.selB = null; this.skill = null; this.focus = null;   // skill: 대상 지정을 기다리는 행동, focus: 그룹 중 HUD에 보이는 유닛
    this.ctrl = 0; this.sel = []; this.cmdMode = null; this.auto = false; this.showPaths = true;
    this.watch = null;   // 적(또는 다른 진영) 유닛 하나를 "보기만" — HUD에 상태·정보를 띄우되 명령은 받지 않는다 (sel이 비어 있을 때만 유효)
    this.bars = { ally: true, enemy: true, hurt: true };   // 머리 위 체력·마나 바: 아군 표시, 적군 표시, 체력이 닳았을 때만 (선택한 유닛은 항상)
    this.drag = null; this.mouse = { x: -1, y: -1, inside: false }; this.keys = {};
    this.world = null; this.view = null; this.hud = null; this.onReset = null; this.seed = 1;
    this._bind(); this._last = 0;
    var self = this; requestAnimationFrame(function f(ts) { requestAnimationFrame(f); self._frame(ts); });
  }
  var P = RtsGame.prototype;

  P.reset = function () {
    var map = this.map = this.maps[this.mode], w = this.world = new MWE.World(map, new MWE.OriginalRules(this.data.fx.arms), this.seed++), self = this, cnt = [0, 0, 0];
    w.types = this.types;
    this.starts = this.startSlots.map(function (i) { return map.starts[i]; });
    if (this.mode === 'test') this._spawnTest(w);
    else this.types.forEach(function (t) { if (t.morph) return; var i = cnt[t.fac]++, c = self.starts[t.fac];
      w.spawn(t, t.fac, c[0] + ((i % 5) - 2) * 1.5, c[1] + (Math.floor(i / 5) - 2) * 1.5); });
    w.invulnFac = this.mode === 'test' && this.godAlly ? this.ctrl : null;   // 아레나 "아군 무적"
    w.events.on('death', function (u) { var k = self.sel.indexOf(u); if (k >= 0) self.sel.splice(k, 1); });
    w.rules.tps = MWE.OriginalRules.SPEEDS[this.speed];
    this.sel = []; this.selB = null; this.watch = null; this.cmdMode = null; this.auto = false; w.types = this.types; w.manualHeal = this.ctrl;
    if (!this.view || this.view.map !== map) { var keepFog = this.view ? this.view.fogOn : false,   /* 안개는 기본 꺼짐 */ keepBlk = this.view ? this.view.showBlocked : false;
      this.view = new MWE.WorldView(this.ctx, map, this.assets, this.VW, this.VH); this.hud = new MWE.Hud(this.ctx, this.assets, this.view, this.VH, this.data.hud, this.data.fx.icon); this.hud.setFaction(this.ctrl); this.view.fogOn = keepFog; this.view.showBlocked = keepBlk; }
    this.view.fx = this.data.fx; this.view.effects = []; this.view.marks = []; this.view.resetFog(this.ctrl);
    this.ais = [0, 1, 2].map(function (fc) { return new MWE.SimpleAI(w, fc); });
    w.events.on('cast', function (u, t, a) { if (a.sup === 'sight' && u.fac === self.ctrl) self.view.reveal(u.x, u.y, 22, (a.dur || 400) / 40); if (a.arm >= 0 && a.sup !== 'weapon' && a.sup !== 'shield' && a.sup !== 'haste') self.view.addEffect(t.x, t.y, t.t.alt + 20, a.arm); self.sfx.play(a.snd, self._vol(u)); });   // 웨폰·실드 계열은 걸린 유닛에 붙여 계속 그린다 (worldview)
    w.events.on('impact', function (b, arm, a) { if (arm >= 0) self.view.addEffect(b.x, b.y, b.t.alt + 20, arm); if (a.act) self.sfx.play(a.act.snd2, self._vol(b)); });
    w.events.on('teleport', function (u, arm) { if (u.fac === self.ctrl && u.tp) self.view.reveal(u.tp.x, u.tp.y, 6, 2);   // 순간이동 소리 (FUN_004eb200 1틱째): 라이딩(21)은 행동 36, 도사·의적은 행동 12, 그 밖은 행동 18의 소리
      var tA = self.data.units.reduce(function (z, d) { return z || d.acts.filter(function (x) { return x && x.id === (arm === 21 ? 36 : (u.t.id === 9 || u.t.id === 10) ? 12 : 18); })[0]; }, null);
      if (tA && self.view.time - (self._tpSnd || -9) > 0.15) { self._tpSnd = self.view.time; self.sfx.play(tA.snd, self._vol(u)); } });
    w.events.on('strike', function (u) { if (u.act) self.sfx.play(u.act.snd, self._vol(u)); });
    w.events.on('death', function (u) { self.sfx.play(u.t.snd.die, self._vol(u)); });
    w.events.on('produced', function (u) { if (u.fac === self.ctrl) self.sfx.play(u.t.snd.ready, 0.9); });
    if (this.mode === 'test') { this.view.fogOn = false; this.sel = this.testLefts.slice(); this.focus = this.testLeft; var ar2 = map.arena || [this.testLeft.x, this.testLeft.y]; this.view.centerOn(ar2[0], ar2[1]); if (this.hud) this.hud.setFaction(this.ctrl); } else this.focusFaction();
    if (this.onReset) this.onReset();
  };
  /* 화면 중심에서 멀수록 작게, 화면 밖이면 0 */
  P._vol = function (u) { var p = this.view.toScreen(u.x, u.y), dx = (p[0] - this.VW / 2) / (this.VW / 2), dy = (p[1] - this.VH / 2) / (this.VH / 2), d = Math.max(Math.abs(dx), Math.abs(dy)); return d > 1.3 ? 0 : d < 0.6 ? 1 : 1 - (d - 0.6) / 0.7 * 0.8; };
  /* 선택·명령 응답 음성: 슬롯 1~7을 순서대로 (원본 FUN_005625f0) */
  P._voice = function (u) { var r = u.t.snd.resp; if (r && r.length) this.sfx.play(r[(this._vc = (this._vc || 0) + 1) % r.length], 0.9); };
  /* 게임 속도 0~4 (원본 틱 간격 166 / 111 / 83 / 71 / 62 ms) */
  P.setSpeed = function (i) { this.speed = i; if (this.world) this.world.rules.tps = MWE.OriginalRules.SPEEDS[i]; };
  P.setInfMana = function (on) { this.infMana = on; if (!on && this.world) this.world.units.forEach(function (u) { if (u.mp > u.maxMp) u.mp = u.maxMp; }); };
  /* 아레나 배치: 왼쪽에 조작 유닛 n기, 오른쪽에 상대 m기. 상대는 진영과 상관없이 적으로 놓는다 */
P._spawnTest = function (w) {
    var c = this.test, ar = this.map.arena || this.map.starts[0], ox = ar[0], oy = ar[1], self = this;
    function flat(list) { var out = []; list.forEach(function (e) { var t = w.typeOf(e.id); for (var i = 0; t && i < e.n && out.length < 24; i++) out.push(t); }); return out; }
    var LT = flat(c.left), RT = flat(c.right); if (!LT.length) LT = [w.typeOf(0)];
    this.ctrl = LT[0].fac; var lf = this.ctrl, rf = (lf + 1) % 3; w.noAuto = true;          // 시험 중에는 보조 행동을 스스로 쓰지 않는다
    /* 한 줄에 4기씩, 화면 가로로 열을 늘린다. side: -1 왼쪽, +1 오른쪽 */
    function place(types, side, fac, each) {
      var rows = Math.min(4, types.length);
      types.forEach(function (t, k) { var col = Math.floor(k / 4), row = k % 4, d = (row - (rows - 1) / 2) * 1.7, off = 2.4 + col * 0.95;
        each(w.spawn(t, fac, ox + side * off + d, oy - side * off + d)); });
    }
    this.testLefts = [];
    place(LT, -1, lf, function (u) { u.passive = true; self.testLefts.push(u); });          // 조작 유닛은 명령한 것만 한다 (공격 이동은 예외)
    place(RT, 1, rf, function (u) { if (c.tough) { u.maxHp *= 10; u.hp = u.maxHp; }
      if (c.behave === "dummy") { u.passive = true; u.order = { type: "hold" }; } else if (c.behave === "hold") u.order = { type: "hold" }; });
    this.testLeft = this.testLefts[0];
    w.res[lf] = [999, 999, 999, 99999, 9999];
  };
  /* 아레나 "동시 공격": 양쪽 모두 돌진해 싸운다 — 왼쪽(조작)과 오른쪽(상대) 유닛 전부를 기본 공격으로 되돌리고
     서로의 무리 한가운데로 공격 이동시킨다. 상대는 "가만히"였더라도 이 순간부터 스스로 싸운다 (passive 해제). */
  P.allAttack = function () {
    if (this.mode !== 'test' || !this.world) return;
    var w = this.world, me = this.ctrl, L = (this.testLefts || []).filter(function (u) { return u.alive() && u.fac === me; }),
      E = w.units.filter(function (u) { return u.alive() && u.fac !== me; });
    if (!L.length || !E.length) return;
    var mid = function (G) { var c = [0, 0]; G.forEach(function (u) { c[0] += u.x / G.length; c[1] += u.y / G.length; }); return c; }, ce = mid(E), cl = mid(L);
    L.concat(E).forEach(function (u) { if (u.t.ai >= 0) u.act = u.t.acts[u.t.ai]; });
    E.forEach(function (u) { u.passive = false; u.order = null; });
    this.sel = L.slice(); this.skill = null; this.cmdMode = null; this._groupMove(L, ce[0], ce[1], true); this._groupMove(E, cl[0], cl[1], true); this._voice(L[0]);
  };
  P.setGodAlly = function (on) { this.godAlly = on; if (this.world) this.world.invulnFac = this.mode === 'test' && on ? this.ctrl : null; };
  P.setMode = function (m) { this.mode = m; if (this.world) this.reset(); };
  P.focusFaction = function () {
    var i = this.ctrl, mine = this.world.units.filter(function (u) { return u.fac === i && u.alive(); });
    if (mine.length) this.view.centerOn(mine[0].x, mine[0].y); else this.view.centerOn(this.starts[i][0], this.starts[i][1]);
  };
  P.setFaction = function (i) { this.ctrl = i; this.sel = []; this.selB = null; this.watch = null; if (this.world) this.world.manualHeal = i; this.cmdMode = null; this.bgm.set(i); if (this.hud) this.hud.setFaction(i); if (this.view) this.view.resetFog(i); if (this.world) this.focusFaction(); };
  P.setAuto = function (on) {
    var w = this.world, M = this.map.M; this.auto = on; w.seekAll = on;
    w.units.forEach(function (u) { if (!u.alive()) return; if (on) w.orderMove(u, M / 2 + (w.rng.next() - .5) * 8, M / 2 + (w.rng.next() - .5) * 8, true); else w.orderFree(u); });
    if (on) this.view.centerOn(M / 2, M / 2);
  };
  P.select = function (u) { this.view.centerOn(u.x, u.y); if (u.fac === this.ctrl && u.alive()) this.sel = [u]; };
  /* 명령 버튼 c(0~14)를 누른다 — HUD 클릭과 단축키가 같이 쓴다 */
  P._button = function (c) {
    var self = this, fu = this._focus(), merged = fu && MWE.Hud.mergedAttack(fu.t);
    var ai = MWE.Hud.actAt(c);   // 칸 배치: 0 이동 · 1 정지 · 2 정찰 · 3 첫째 행동 · 4 되돌리기 · 5~ 나머지 행동 (원본 화면)
    if (c === 0) this.cmdMode = this.cmdMode === 'move' ? null : 'move';
    else if (c === 1) this.stopSel();
    else if (c === 2) this.cmdMode = this.cmdMode === 'patrol' ? null : 'patrol';
    else if (c === 4) { if (fu) this.world.revert(fu); }   // 변형 되돌리기
    else if (ai >= 0 && fu) { var ua = fu.t.acts[ai];                    // 스킬 버튼: 자기 자신에게 쓰는 행동은 즉시, 나머지는 대상 지정 대기
      if (ua && ai === MWE.Hud.basic(fu.t)) { this.sel.forEach(function (x) { if (x.t.ai >= 0) x.act = x.t.acts[x.t.ai]; }); this.skill = null; this.cmdMode = this.cmdMode === 'amove' ? null : 'amove'; }   // 기본 공격 아이콘 = 공격(A): 기본 공격으로 되돌리고 공격 이동 대기
      else if (ua && ua.need === 'none') this.sel.forEach(function (x) { if (x.t.acts.indexOf(ua) >= 0) self.world.castNow(x, ua); });   // 대상이 필요 없는 행동은 즉시
      else if (ua && ua.need) this.skill = this.skill === ua ? null : ua; }   // 스킬 버튼: 공격 행동 전환
  };
  P.stopSel = function () { var w = this.world; this.sel.forEach(function (u) { w.orderStop(u); }); this.cmdMode = null; };

  /* 부대 이동 (목업 고유): 목적지 주변에 1.1칸(큰 유닛이 있으면 그 크기만큼 넓힌) 간격 격자 칸을 만들고, 지금 대형에서의 상대 위치가 가장 가까운 칸부터
     짝지어 준다(욕심쟁이 배정) — 유닛들이 서로 엇갈려 지나가지 않게. 막혔을 때 도착으로 칠 거리는 부대 크기에 맞춘다. */
  P._groupMove = function (us, gx, gy, am) {
    var w = this.world, n = us.length; if (!n) return;
    if (n === 1) { var d1 = w.map.nearestWalkable(w.map.clamp(gx), w.map.clamp(gy), us[0].t.moveClass); w.orderMove(us[0], d1[0], d1[1], am); return; }   // 건물 위 등 못 서는 곳을 누르면 가장 가까운 설 수 있는 곳으로
    var cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols), S = [], i, j, cx = 0, cy = 0, gap = 1.1;
    us.forEach(function (u) { if (u.t.fly !== 2) gap = Math.max(gap, u.t.rad * 2 + 0.25); });   // 큰 유닛(엔트 등)이 있으면 칸 간격을 넓힌다
    for (i = 0; i < n; i++) S.push([((i % cols) - (cols - 1) / 2) * gap, (Math.floor(i / cols) - (rows - 1) / 2) * gap]);
    us.forEach(function (u) { cx += u.x / n; cy += u.y / n; });
    var P = []; for (i = 0; i < n; i++) for (j = 0; j < n; j++) P.push([Math.hypot(us[i].x - cx - S[j][0], us[i].y - cy - S[j][1]), i, j]);
    P.sort(function (a, b) { return a[0] - b[0]; });
    var du = {}, ds = {}, tol = 1.2 + 0.25 * Math.sqrt(n);
    for (var k = 0; k < P.length; k++) { var q = P[k]; if (du[q[1]] || ds[q[2]]) continue; du[q[1]] = ds[q[2]] = 1;
      var u = us[q[1]], d = w.map.nearestWalkable(w.map.clamp(gx + S[q[2]][0]), w.map.clamp(gy + S[q[2]][1]), u.t.moveClass); w.orderMove(u, d[0], d[1], am, tol); }
  };
  P._command = function (sx, sy, forceMove) {
    if (!this.sel.length) return;
    var w = this.world, ctrl = this.ctrl, en = forceMove ? null : this.view.unitAt(w, sx, sy, function (u) { return u.fac !== ctrl; });
    var bd = en || forceMove ? null : this.view.buildingAt(w, sx, sy);
    if (bd && !this.sel.some(function (u) { return w.canEnter(u, bd); })) bd = null;   // 들어갈 수 없는 건물(점령 기능 꺼짐 등)을 누르면 그냥 그 자리로 이동
    if (bd) { this.sel.forEach(function (u) { w.orderEnter(u, bd); }); this._voice(this.sel[0]); this.cmdMode = null; return; }   // 건물 우클릭 = 들어가기
    if (en) { this.sel.forEach(function (u) { w.orderAttack(u, en); }); this._voice(this.sel[0]); }
    else { var g = this.view.groundAt(sx, sy), n = this.sel.length; this.view.addMark(g[0], g[1]); this._voice(this.sel[0]); var pt = this.cmdMode === 'patrol', am = pt || this.cmdMode === 'amove', from = pt ? this.sel.map(function (u) { return [u.x, u.y]; }) : null;
      this._groupMove(this.sel, g[0], g[1], am);
      if (pt) this.sel.forEach(function (u, k) { if (u.order && u.order.type === 'move') u.order.patrol = { x: from[k][0], y: from[k][1] }; }); }   // 정찰(P): 떠난 자리와 찍은 곳을 오간다
    this.cmdMode = null;
  };
  /* 대상 지정 스킬 사용: 피해 행동 → 그 행동으로 대상 공격, 보조 행동 → 대상에게 시전, 순간이동 → 그 땅으로 */
  P._useSkill = function (sx, sy) {
    var a = this.skill, w = this.world, ctrl = this.ctrl, us = this.sel.filter(function (x) { return x.t.acts.indexOf(a) >= 0; }), u = us[0]; this.skill = null; if (!a || !u) return;   // 선택한 유닛 중 이 행동을 가진 유닛 모두
    if (a.sup === 'teleport') { var g = this.view.groundAt(sx, sy); us.forEach(function (x) { w.orderCast(x, a, null, g[0], g[1], us); }); this.view.addMark(g[0], g[1]); return; }   // us: 같이 시전하는 유닛은 남의 순간이동에 끌려가지 않는다
    var gp = this.view.groundAt(sx, sy);
    if (a.need === 'ground') { us.forEach(function (x) { w.orderCast(x, a, null, gp[0], gp[1]); }); this.view.addMark(gp[0], gp[1]); this._voice(u); return; }   // 지점 범위 행동
    var foe = a.dmg || a.foe, ok = function (x) { return foe ? x.fac !== ctrl : x.fac === ctrl; }, t = this.view.unitAt(w, sx, sy, ok);
    if (!t) { var bd = 2.5; w.units.forEach(function (x) { if (!x.alive() || !ok(x)) return; var d = Math.hypot(x.x - gp[0], x.y - gp[1]); if (d < bd) { bd = d; t = x; } }); }   // 빈 곳을 눌렀으면 그 근처의 알맞은 유닛
    if (!t) return;
    us.forEach(function (x) { if (a.dmg) { x.act = a; w.orderAttack(x, t); } else w.orderCast(x, a, t); });
    this._voice(u);
  };
  /* 초점 유닛: 선택 안에 살아 있으면 유지, 아니면 첫 유닛 */
  P._focus = function () { var f = this.focus; if (!f || !f.alive() || this.sel.indexOf(f) < 0) f = this.focus = this.sel[0] || null; return f; };
  /* HUD에 보이는 유닛: 선택 중인 초점 유닛, 없으면 관찰 중인 적 유닛 (죽으면 관찰 해제) */
  P._shown = function () { var f = this._focus(); if (f) return f; if (this.watch && !this.watch.alive()) this.watch = null; return this.watch; };
  P._watchList = function () { return this.sel.length ? this.sel : (this._shown() ? [this.watch] : []); };
  /* 두 번 클릭 판정: 같은 대상(key)을 0.35초 안에 다시 누르면 true */
  P._dbl = function (key) { var now = performance.now(), L = this._lastClick, hit = L && L.key === key && now - L.t < 350; this._lastClick = hit ? null : { key: key, t: now }; return !!hit; };
  P._pos = function (e) { var r = this.cv.getBoundingClientRect(); return [(e.clientX - r.left) * (this.cv.width / r.width), (e.clientY - r.top) * (this.cv.height / r.height)]; };
  P._bind = function () {
    var self = this, cv = this.cv;
    cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    cv.addEventListener('pointerdown', function (e) {
      if (!self.world) return; var p = self._pos(e); cv.setPointerCapture(e.pointerId); self.sfx.unlock();
      if (document.activeElement && document.activeElement !== document.body && document.activeElement.blur) document.activeElement.blur();   // 화면을 누르면 입력 칸에서 초점을 뺀다
      if (p[1] >= self.VH) {
        if (self.hud.inMini(p[0], p[1])) { self.drag = { mini: true }; self.hud.miniToCam(p[0], p[1]); return; }
        if (self.hud.inPortrait(p[0], p[1]) && !self.selB) { var pf = self._shown(); if (pf) self.view.centerOn(pf.x, pf.y); return; }   // 초상화 클릭(한 번·두 번) → 그 유닛 위치로 화면 이동 (관찰 중인 적도)
        if (!self.sel.length && !self.selB && self._shown()) return;   // 적 유닛을 보는 중: 명령 버튼은 그림일 뿐, 누를 수 없다
        if (self.sel.length > 1) { var gk = self.hud.groupAt(p[0], p[1], self.sel.length); if (gk >= 0) { var gu = self.sel[gk], gdbl = self._dbl('g' + gk); self.skill = null;
          if (e.shiftKey) { self.sel.splice(gk, 1); if (self.focus === gu) self.focus = self.sel[0] || null; return; }                 // Shift + 클릭 → 그 유닛만 선택에서 뺀다
          if (e.ctrlKey || e.metaKey || gdbl) { self.sel = self.sel.filter(function (x) { return x.t.id === gu.t.id; }); self.focus = gu; self._voice(gu); return; }   // 두 번 클릭·Ctrl + 클릭 → 같은 종류만 남긴다
          self.focus = gu; self._voice(gu); return; } }   // 그룹 그림 클릭 → 그 유닛에 초점 (그룹은 유지)
        var c = self.hud.iconAt(p[0], p[1]);
        if (self.selB) { var sb = self.selB, w0 = self.world;
          if (sb.owner === self.ctrl) { if (c === 0) w0.leave(sb); else if (c === 1 || c === 2) sb.inside.forEach(function (u) { var t = self.types[u.t.up[c - 1]]; if (t) w0.promote(u, t); }); else if (c >= 5) { var pl = w0.producible(sb)[c - 5]; if (pl) w0.produce(sb, pl); } }
          return; }
        self._button(c);
        return;
      }
      if (e.button === 2) { if (self.skill) { self.skill = null; return; } self._command(p[0], p[1], false); return; }
      if (self.skill) { self._useSkill(p[0], p[1]); return; }
      self.drag = { x0: p[0], y0: p[1], x1: p[0], y1: p[1], box: false, add: e.shiftKey, same: e.ctrlKey || e.metaKey };
    });
    cv.addEventListener('pointermove', function (e) {
      var p = self._pos(e), d = self.drag; self.mouse.x = p[0]; self.mouse.y = p[1]; self.mouse.inside = true;
      if (!d) return; if (d.mini) { self.hud.miniToCam(p[0], p[1]); return; }
      d.x1 = p[0]; d.y1 = Math.min(p[1], self.VH - 1); if (Math.abs(d.x1 - d.x0) + Math.abs(d.y1 - d.y0) > 8) d.box = true;
    });
    cv.addEventListener('pointerleave', function () { self.mouse.inside = false; });
    /* 가장자리 스크롤용: 캔버스 밖으로 조금 벗어나도 위치를 계속 따라간다 (캔버스 좌표, 밖이면 음수이거나 크기를 넘는다) */
    window.addEventListener('pointermove', function (e) { var p = self._pos(e); self.mouse.gx = p[0]; self.mouse.gy = p[1];
      self.mouse.near = p[0] >= 0 && p[0] <= cv.width && p[1] >= 0 && p[1] <= cv.height; });   // 가장자리 스크롤은 마우스가 게임 화면 안에 있을 때만 — 전에는 화면 밖 160px까지 따라가서, 페이지의 다른 곳을 보는데도 맵이 움직였다
    document.documentElement.addEventListener('pointerleave', function () { self.mouse.near = false; });
    window.addEventListener('blur', function () { self.mouse.near = false; });
    cv.addEventListener('pointerup', function () {
      var d = self.drag; self.drag = null; if (!d || d.mini || !self.world) return;
      var ctrl = self.ctrl, v = self.view, mine = function (u) { return u.fac === ctrl; };
      if (d.box) {
        var x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1), y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1);
        var pick = self.world.units.filter(function (u) { if (!u.alive() || !mine(u)) return false; var q = v.unitRect(u, self.world.rules.tps), cx = q[0] + q[2] / 2, cy = q[1] + q[3] * 0.6; return cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1; });   // 그림의 몸통 위치 기준
        var np = d.add ? self.sel.concat(pick.filter(function (u) { return self.sel.indexOf(u) < 0; })) : pick;
        if (!np.length) return;                                                             // 빈 곳을 끌어도 선택은 그대로 둔다
        self.sel = np; self.watch = null; self.selB = null; self._voice(self.sel[0]); return;
      }
      if (self.cmdMode) { self._command(d.x0, d.y0, self.cmdMode !== 'amove'); return; }
      var u = v.unitAt(self.world, d.x0, d.y0, mine);
      if (!u) { var eu = v.unitAt(self.world, d.x0, d.y0, function (x) { return x.fac !== ctrl; });   // 적 유닛 클릭 = 관찰 (HUD에 상태·정보만, 명령 없음)
        if (eu) { self.sel = []; self.selB = null; self.watch = eu; return; }
        var hb = v.buildingAt(self.world, d.x0, d.y0); if (hb) { var bs = hb.b.snd; if (bs && bs.length) self.sfx.play(bs[(self._vc = (self._vc || 0) + 1) % bs.length], 0.9); self.selB = hb; self.sel = []; self.watch = null; return; } }
      if (!u) return;                                                                       // 빈 땅 왼쪽 클릭 = 아무 일도 없음 (선택 유지, 해제는 Esc)
      self.selB = null; self.watch = null;
      if (d.same || self._dbl('u' + u.t.id)) {                                              // 두 번 클릭·Ctrl + 클릭 → 화면에 보이는 같은 종류 아군 전부
        var tps = self.world.rules.tps, same = self.world.units.filter(function (x) { if (!x.alive() || !mine(x) || x.t.id !== u.t.id) return false; var q = v.unitRect(x, tps), cx = q[0] + q[2] / 2, cy = q[1] + q[3] * 0.6; return cx >= 0 && cx <= v.vw && cy >= 0 && cy <= v.vh; });
        self.sel = d.add ? self.sel.concat(same.filter(function (x) { return self.sel.indexOf(x) < 0; })) : same; self.focus = u; self._voice(u); return; }
      if (d.add) { var k = self.sel.indexOf(u); if (k >= 0) self.sel.splice(k, 1); else self.sel.push(u); } else self.sel = [u]; if (self.sel.length) self._voice(self.sel[0]);
      self._command(d.x0, d.y0, false);
    });
    window.addEventListener('keydown', function (e) {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) && e.key !== 'Escape') return;   // 입력 칸에 글자를 넣는 중일 때만 양보한다 (버튼에 초점이 있어도 단축키는 듣는다)
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      self.keys[e.key] = true; if (e.key.indexOf('Arrow') === 0) e.preventDefault();
      var kc = /^Key[A-Z]$/.test(e.code) ? e.code.charAt(3) : null;   // 한글 입력 상태와 상관없이 자판 위치로 (원본 단축키, hotkey.txt)
      if (kc === 'A' && !self.selB && self.sel.length) { var fa = self._focus(); if (fa && MWE.Hud.mergedAttack(fa.t)) self._button(MWE.Hud.slot(MWE.Hud.basic(fa.t))); else self.cmdMode = 'amove'; }   // 선택한 아군이 없으면(적 관찰 중 포함) 명령 모드로 들어가지 않는다
      if (kc === 'M' && !self.selB && self.sel.length) self.cmdMode = 'move';
      if (kc === 'P' && !self.selB && self.sel.length) self.cmdMode = 'patrol';   // 정찰 (hotkey.txt 'P')
      if (kc === 'S') self.stopSel();
      if (kc && 'ASMPHT'.indexOf(kc) < 0 && !self.selB && self._focus()) { var fk = self._focus(), ks = MWE.Hud.keys(fk.t), ki = ks.indexOf(kc); if (ki >= 0 && fk.t.icons[ki] >= 0) self._button(MWE.Hud.slot(ki)); }   // 행동 단축키
      if (kc === 'T' && !self.selB && self._focus()) { var ft = self._focus(), ti = MWE.Hud.keys(ft.t).indexOf('T'); if (ti >= 0) self._button(MWE.Hud.slot(ti)); }   // T: 순간 이동 (건물을 골랐을 때는 아래 퇴각)
      if (e.key === 'Escape') { self.skill = null; self.cmdMode = null; self.sel = []; self.selB = null; self.watch = null; }
      if ((e.key === 'h' || e.key === 'H' || e.key === 'ㅗ') && self.world) self.sel.forEach(function (u) { u.t.sups.forEach(function (a) { if (a.sup === 'heal') self.world._cast(u, a, true); }); });   // H: 치유 (원본은 수동)
      if ((e.key === 't' || e.key === 'T' || e.key === 'ㅅ') && self.selB && self.selB.owner === self.ctrl) self.world.leave(self.selB);              // T: 건물 밖으로
    });
    window.addEventListener('keyup', function (e) { self.keys[e.key] = false; });
    window.addEventListener('blur', function () { self.keys = {}; });
  };
  P._frame = function (ts) {
    var ctx = this.ctx, A = this.assets;
    if (A.failed) { ctx.fillStyle = '#111'; ctx.fillRect(0, 0, 800, 600); ctx.fillStyle = '#e08484'; ctx.font = '14px monospace'; ctx.fillText('에셋을 불러오지 못했습니다: ' + A.failed, 24, 40); return; }
    if (!A.ready()) { MWE.drawLoading(ctx, 800, 600, A, this.sfx); return; }   // 진행률 바 (render/assets.js)
    if (!this.world) this.reset();
    var dt = this._last ? Math.min((ts - this._last) / 1000, 0.05) : 0; this._last = ts;
    var k = this.keys, m = this.mouse, mx = 0, my = 0;
    if (k.ArrowLeft) mx--; if (k.ArrowRight) mx++; if (k.ArrowUp) my--; if (k.ArrowDown) my++;
    /* 가장자리 스크롤: 안쪽 36px 띠(아래는 HUD가 있어 10px)에 들어오면 움직이고, 캔버스 밖으로 좌우 160px, 위아래 28px까지 벗어나도 계속 움직인다 */
    if (m.near && !this.drag) { var EDGE = 36; if (m.gx < EDGE) mx--; if (m.gx > this.cv.width - EDGE) mx++; if (m.gy < EDGE) my--; if (m.gy > this.cv.height - 10) my++; }
    if (mx || my) this.view.scroll(mx * 520 * dt, my * 520 * dt);
    if (this.aiOn && !this.auto && this.mode !== 'test') for (var ai = 0; ai < this.ais.length; ai++) if (ai !== this.ctrl) this.ais[ai].update(dt);
    if (this.infMana) this.world.units.forEach(function (u) { if (u.living()) u.mp = u.maxMp || 9999; });   // 전체 진영
    this.world.update(dt); this.view.time += dt;
    this.view.draw(this.world, { selected: this._watchList(), focus: this._focus(), selB: this.selB, colors: this.colors, dragBox: this.drag && this.drag.box ? this.drag : null, paths: this.showPaths, me: this.ctrl, bars: this.bars });
    if (this.skill) { ctx.font = '12px "IBM Plex Sans KR",sans-serif'; var st = this.skill.name + ': ' + (this.skill.need === 'ground' ? '지점' : this.skill.dmg || this.skill.foe ? '적' : '아군') + ' 클릭 (우클릭 취소)'; ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(8, 8, ctx.measureText(st).width + 16, 22); ctx.fillStyle = '#ffd36e'; ctx.textBaseline = 'middle'; ctx.fillText(st, 16, 19); }
    else if (this.cmdMode) { ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(8, 8, 150, 22); ctx.fillStyle = '#ffd36e'; ctx.font = '12px "IBM Plex Sans KR",sans-serif'; ctx.textBaseline = 'middle';
      ctx.fillText(this.cmdMode === 'amove' ? '공격 이동: 목적지 클릭' : this.cmdMode === 'patrol' ? '정찰: 목적지 클릭' : '이동: 목적지 클릭', 16, 19); }
    this.hud.draw(this.world, { faction: this.ctrl, facName: this.factions[this.ctrl].name, colors: this.colors, selected: this.sel, focus: this._focus(), watch: this.sel.length ? null : this._shown(), selB: this.selB, cmdMode: this.cmdMode, mouse: this.mouse, skill: this.skill });
    this._cursor(mx, my);
  };
  /* 원본 마우스 커서(mouse.spr → sim-assets/mouse.*)를 캔버스 위에 그린다 (CSS 커서는 숨김). 묶음 배정은 목업 고유 — tools/mousebuild.js 주석 참고.
     (mx,my): 이번 프레임의 가장자리 스크롤 방향 */
  P._cursor = function (mx, my) {
    var m = this.mouse, MC = root.MW && root.MW.mouse, im = this.assets.get('mouse'); if (!m.inside || !MC || !im) return;
    var G = MC.groups, g = G.normal, w = this.world, v = this.view;
    if ((mx || my) && m.near && !this.drag && (m.gx < 36 || m.gx > this.cv.width - 36 || m.gy < 36 || m.gy > this.cv.height - 10))
      g = my < 0 ? (mx > 0 ? G.sUR : mx < 0 ? G.normal : G.sU) : my > 0 ? (mx > 0 ? G.sDR : mx < 0 ? G.sDL : G.sD) : (mx > 0 ? G.sR : G.sL);
    else if (m.y < this.VH && w && !(this.drag && this.drag.box)) {
      if (this.skill) g = this.skill.dmg || this.skill.foe ? G.gAttack : G.gSkill;
      else if (this.cmdMode) g = this.cmdMode === 'move' ? G.gMove : G.gAttack;
      else { var ctrl = this.ctrl, hu = v.unitAt(w, m.x, m.y, function (x) { return x.alive(); });
        if (hu) g = hu.fac === ctrl ? G.ally : G.enemy; else if (v.buildingAt(w, m.x, m.y)) g = G.building; }
    }
    var f = MC.frames[g[Math.floor(this.view.time * 10) % g.length]];
    this.ctx.drawImage(im, f[0], f[1], f[2], f[3], Math.round(m.x - f[4]), Math.round(m.y - f[5]), f[2], f[3]);
  };
  MWE.RtsGame = RtsGame;
})(window);
