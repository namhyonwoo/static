/* Hud: 원본 HUD 바(800×152) 위에 미니맵·초상화·명령 아이콘을 얹는다.
   배치 좌표는 원본 InterfaceData.mwd에서 읽은 값(data.hud[진영])이다 — 800×600 화면 기준. */
(function (root) {
  'use strict';
  var MWE = root.MWE;
  function Hud(ctx, assets, view, y, layouts, iconDef) {
    this.ctx = ctx; this.assets = assets; this.view = view; this.y = y; this.layouts = layouts; this.iconDef = iconDef; this.setFaction(0);
  }
  var P = Hud.prototype;
  /* 원본 단축키 (hotkey.txt "유닛 단축키"·"특수 행동/마법 단축키"): M 이동, A 공격, S 정지.
     행동은 종류별 글자 — 기본 공격 A, L 범위 공격 마법, U 신성(범위 공격·회복), H 회복, V 시야, D 방어·방패 막기, T 순간 이동,
     R 아군 소환 이동(리콜), I 숨기·투명, W 공격 보조·속도 향상, E 합체·주위 동시 공격, B 폭탄 설치, O 변신, K 버서커, C 차밍,
     Y 암살·레이즈 언데드, N 마법 해제·거미줄·목 던지기·포이즌 밤·피어섬 테러. 한 유닛 안에서 겹치면 앞의 행동만 갖는다. */
  var SUPKEY = { heal: 'H', sight: 'V', shield: 'D', teleport: 'T', recall: 'R', hide: 'I', weapon: 'W', haste: 'W', merge: 'E', morph: 'O', copy: 'O', berserk: 'K', charm: 'C', assassin: 'Y', raise: 'Y', dispel: 'N', melt: 'N', meltw: 'N', melta: 'N', slow: 'N', stone: 'N', massheal: 'U' };
  function keyOfAct(t, i) {
    var a = t.acts[i]; if (!a) return null; if (i === t.ai) return 'A';
    if (a.cls === 22) return 'U';
    if (a.sup) return SUPKEY[a.sup] || null;
    if (!a.dmg) return null;
    if (a.cls === 48 || a.suicide) return 'B'; if (a.cls === 49 && a.need === 'ground') return 'N';
    return a.need === 'none' && a.aoe ? 'E' : 'L';
  }
  /* 종류 t의 행동 번호 → 단축키 글자 (겹치면 앞의 것만) */
  Hud.keys = function (t) {
    if (t._keys) return t._keys; var used = {}, out = [];
    if (t.ai >= 0) used.A = 1;
    for (var i = 0; i < t.acts.length; i++) { var k = keyOfAct(t, i); if (k && (!used[k] || i === t.ai)) { out[i] = k; used[k] = 1; } else out[i] = null; }
    return (t._keys = out);
  };
  /* 기본 공격이 행동 아이콘으로 나오는 유닛은 공격(A) 버튼을 따로 두지 않는다 — 그 아이콘이 공격(A) 버튼 */
  Hud.mergedAttack = function (t) { return t.ai >= 0 && t.icons && t.icons[t.ai] >= 0; };
  P.setFaction = function (f) {
    var L = this.L = this.layouts[f], v = this.view, m = L.mini, w = m[2] - m[0], sc = w / v.map.worldW;
    this.mm = { x: m[0], y: m[1] + ((m[3] - m[1]) - v.map.worldH * sc) / 2, w: w, h: v.map.worldH * sc, sc: sc };
  };
  P.inMini = function (sx, sy) { var m = this.mm; return sx >= m.x && sx < m.x + m.w && sy >= m.y && sy < m.y + m.h; };
  P.miniToCam = function (sx, sy) { var v = this.view, m = this.mm; v.cam.x = (sx - m.x) / m.sc - v.vw / 2; v.cam.y = (sy - m.y) / m.sc - v.vh / 2; v.clampCam(); };
  /* 여러 유닛 선택 시 작은 그림의 번호(0~11). 없으면 -1 */
  P.groupAt = function (sx, sy, n) { var inf = this.L.info, nm = this.L.name; for (var k = 0; k < Math.min(n, 12); k++) { var x = inf[0] + 12 + (k % 6) * 27, y = nm[3] + 10 + Math.floor(k / 6) * 44; if (sx >= x && sx < x + 27 && sy >= y && sy < y + 32) return k; } return -1; };
  /* 마우스가 올라간 버튼의 설명 */
  P.tipFor = function (world, s, c) {
    var sb = s.selB, s0 = s.focus || s.selected[0];
    if (sb) { if (sb.owner !== s.faction) return null; if (c === 0) return '퇴각 (T): 안의 유닛을 모두 내보냄'; if (c === 1) return '전직: 왼쪽 상급 유닛으로'; if (c === 2) return '전직: 오른쪽 상급 유닛으로';
      var pl = world.producible(sb)[c - 5]; if (!pl) return null; var cs = pl.cost, RN = ['민간인', '전사형', '마법사형', '금', '젬'];
      return pl.name + ' 생산 — ' + cs.map(function (v, k) { return v ? RN[k] + ' ' + v : ''; }).filter(Boolean).join(', '); }
    if (c === 0) return '이동(M)'; if (c === 2) return '정지 · 위치 사수(S)';
    if (c === 1) return s0 && Hud.mergedAttack(s0.t) ? null : '공격 이동(A)';
    if (!s0) return null;
    if (c === 4) return s0.origType ? '원래 모습으로' : null;
    var a = s0.t.acts[c - 5]; if (!a) return null; var hk = Hud.keys(s0.t)[c - 5];
    var KIND = { heal: '치유', weapon: '무기 강화', shield: '방어', berserk: '광폭화', haste: '가속', slow: '감속', stone: '석화', charm: '매혹', melt: '약화·해제', assassin: '암살', hide: '은신', teleport: '순간이동', sight: '시야', morph: '변형', copy: '변신', raise: '시체 소환', merge: '합체', recall: '리콜', massheal: '광역 치유' };
    return a.name + (hk ? '(' + hk + ')' : '') + ' — ' + (c - 5 === s0.t.ai ? '기본 공격 · ' : '') + (a.dmg ? (a.aoe ? '범위 공격' : '공격') : (KIND[a.sup] || '사용 불가')) + (a.mana ? ', 마나 ' + a.mana : '') + (a.need === 'none' ? ' · 즉시' : a.need === 'ground' ? ' · 지점 지정' : a.need === 'unit' ? ' · 대상 지정' : '');
  };
/* 스킬 수치 한 줄: 해독한 행동 데이터에서 */
  P.statLine = function (a, tps) {
    var p = [];
    if (a.dmg) p.push("피해 계수 " + a.k1 + "/" + a.k2);
    if (a.range && a.range < 60000) p.push("사거리 " + Math.round(a.range / 10) + "px");
    if (a.mana) p.push("마나 " + a.mana);
    if (a.dur && !a.dmg) p.push("지속 " + Math.round(a.dur / (tps || 12)) + "초");
    if (a.hpCost) p.push("체력 1/" + a.hpCost + " 소모");
    p.push(a.need === "none" ? "즉시 사용" : a.need === "ground" ? "지점 지정" : a.need === "unit" ? "대상 지정" : "사용 불가");
    return p.join(" · ");
  };
  P._wrap = function (ctx, text, maxW) { var out = [], line = ""; for (var i = 0; i < text.length; i++) { var c = text.charAt(i); if (ctx.measureText(line + c).width > maxW && line) { out.push(line); line = c === " " ? "" : c; } else line += c; } if (line) out.push(line); return out; };
  P._tip = function (world, s) {
    var m = s.mouse; if (!m || !m.inside) return; var c = this.iconAt(m.x, m.y); if (c < 0) return; var t = this.tipFor(world, s, c); if (!t) return;
    var ctx = this.ctx, s0 = s.focus || s.selected[0], a = !s.selB && s0 && c >= 5 ? s0.t.acts[c - 5] : null, W = 310, lines = [], desc = a && root.MWE.SKILL_DESC && root.MWE.SKILL_DESC[a.name];
    ctx.textBaseline = "top"; ctx.font = "11px \"IBM Plex Sans KR\",sans-serif";
    if (a) { lines.push({ t: this.statLine(a, world.rules.tps), c: "#9fb4d8" }); if (desc) this._wrap(ctx, desc, W - 16).forEach(function (l) { lines.push({ t: l, c: "#d6dbe6" }); }); }
    var ak = a && Hud.keys(s0.t)[c - 5], title = a ? a.name + (ak ? '(' + ak + ')' : '') + (c - 5 === s0.t.ai ? ' — 기본 공격' : '') : t, h = 24 + lines.length * 15 + (lines.length ? 5 : 0); ctx.font = "bold 12px \"IBM Plex Sans KR\",sans-serif";
    var w = a ? W : ctx.measureText(title).width + 16, x = Math.min(this.view.vw - w - 4, Math.max(4, m.x - w / 2)), y = this.L.btn[0][1] - h - 8;
    ctx.fillStyle = "rgba(8,10,16,.94)"; ctx.fillRect(x, y, w, h); ctx.strokeStyle = "#c9a35a"; ctx.lineWidth = 1; ctx.strokeRect(x + .5, y + .5, w - 1, h - 1);
    ctx.fillStyle = "#ffe9b0"; ctx.fillText(title, x + 8, y + 6); ctx.font = "11px \"IBM Plex Sans KR\",sans-serif";
    lines.forEach(function (l, i) { ctx.fillStyle = l.c; ctx.fillText(l.t, x + 8, y + 25 + i * 15); });
  };
  /* 명령 버튼 번호(0~14). 없으면 -1. 0 이동, 1 공격 이동, 2 정지 */
  P.iconAt = function (sx, sy) { var B = this.L.btn; for (var c = 0; c < B.length; c++) if (sx >= B[c][0] && sx <= B[c][2] && sy >= B[c][1] && sy <= B[c][3]) return c; return -1; };
  /* s: { faction, facName, colors, selected, cmdMode } */
  P.draw = function (world, s) {
    var ctx = this.ctx, A = this.assets, Y = this.y, v = this.view, map = v.map, mm = this.mm, L = this.L, i;
    ctx.drawImage(A.get('hud' + s.faction), 0, Y);
    ctx.drawImage(A.get(map.keys.minimap), 0, 0, map.mini.w, map.mini.h, mm.x, mm.y, mm.w, mm.h);
    for (i = 0; i < world.units.length; i++) { var u = world.units[i]; if (!u.alive() || (u.fac !== s.faction && !v.visible(u.x, u.y))) continue;
      var w = map.t2w(u.x, u.y); ctx.fillStyle = s.colors[u.fac]; ctx.fillRect(mm.x + w[0] * mm.sc - 1, mm.y + w[1] * mm.sc - 1, 3, 3); }
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1; ctx.strokeRect(mm.x + v.cam.x * mm.sc + .5, mm.y + v.cam.y * mm.sc + .5, v.vw * mm.sc, v.vh * mm.sc);
    var sel = s.selected, s0 = s.focus || sel[0], pr = L.portrait, nm = L.name, inf = L.info, B = L.btn; ctx.textBaseline = 'top';
    var RN = ['민간인', '전사형', '마법사형', '금', '젬'], rs = world.res[s.faction];
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(v.vw - 330, 4, 326, 18); ctx.fillStyle = '#ffe9b0'; ctx.font = '11px "IBM Plex Sans KR",sans-serif';
    ctx.fillText(RN.map(function (n, k) { return n + ' ' + rs[k]; }).join('   '), v.vw - 322, 7);
    var sb = s.selB;
    if (sb) {                                                   // 건물 선택: 이름·소유·자원 보유량·안의 유닛·생산 대기열
      ctx.fillStyle = '#ffd36e'; ctx.font = '12px "IBM Plex Sans KR",sans-serif'; ctx.fillText(sb.b.name + (sb.owner < 0 ? ' (중립)' : ''), nm[0] + 4, nm[1]);
      ctx.fillStyle = '#d6dbe6'; ctx.font = '11px "IBM Plex Sans KR",sans-serif'; var by0 = nm[3] + 10;
      ctx.fillText('보유 ' + sb.pool.map(function (p, k) { return RN[k].charAt(0) + p; }).join(' '), inf[0] + 10, by0);
      ctx.fillText('안의 유닛 ' + sb.inside.length + '기' + (sb.inside.length ? ': ' + sb.inside.slice(0, 3).map(function (u) { return u.t.name; }).join(', ') : ''), inf[0] + 10, by0 + 16);
      var q0 = sb.queue[0]; if (!q0 && sb.claim != null && sb.claim !== sb.owner) q0 = { type: { name: '' }, t: sb.b.cap.time - sb.capT, total: sb.b.cap.time, cap: 1 };
      ctx.fillText(q0 && q0.cap ? '점령 중 ' + Math.floor(100 * q0.t / q0.total) + '%' : q0 ? '생산 중 ' + q0.type.name + ' (' + sb.queue.length + ')' : (sb.owner === s.faction ? '오른쪽 아이콘으로 생산' : sb.owner < 0 ? '점령 비용 ' + (s.faction === 0 ? '금 ' + sb.b.cap.gold : s.faction === 2 ? '젬 ' + sb.b.cap.gem : '사람 ' + sb.b.cap.pop) : '비어 있으면 무료로 점령'), inf[0] + 10, by0 + 32);
      if (q0) { ctx.fillStyle = 'rgba(255,255,255,.2)'; ctx.fillRect(inf[0] + 10, by0 + 50, 150, 5); ctx.fillStyle = '#ffd36e'; ctx.fillRect(inf[0] + 10, by0 + 50, 150 * Math.min(1, q0.t / q0.total), 5); }
      if (sb.owner === s.faction) { ctx.font = '10px "IBM Plex Sans KR",sans-serif'; ctx.fillStyle = '#ffd36e'; ['퇴각', '◀전직', '전직▶'].forEach(function (t, k) { ctx.fillText(t, B[k][0] + 3, B[k][1] + 14); });
        var pl = world.producible(sb), fg = A.get('figs');
        for (i = 0; i < pl.length && i < 10; i++) { ctx.globalAlpha = world.canAfford(s.faction, pl[i].cost) ? 1 : 0.35; ctx.drawImage(fg, pl[i].id * 36, 0, 36, 43, B[5 + i][0], B[5 + i][1], 34, 40); } ctx.globalAlpha = 1; }
      this._tip(world, s); return;
    }
    if (s0) {
      var id = s0.t.pid;
      ctx.drawImage(A.get('portraits'), (id % 12) * 120, Math.floor(id / 12) * 160, 120, 160, pr[0], pr[1], pr[2] - pr[0], pr[3] - pr[1]);
      // 초상화 바로 아래: 체력·마나 상태 바 (체력은 남은 비율에 따라 초록→노랑→빨강)
      var bw = 76, bx = Math.round((pr[0] + pr[2]) / 2 - bw / 2), by = pr[3] - 13, hr = Math.max(0, Math.min(1, s0.hp / s0.maxHp));
      ctx.fillStyle = 'rgba(6,8,12,.85)'; ctx.fillRect(bx - 1, by - 1, bw + 2, s0.maxMp ? 12 : 6);
      ctx.fillStyle = hr > 0.5 ? '#5fc46a' : hr > 0.25 ? '#d9b23c' : '#d2513f'; ctx.fillRect(bx, by, Math.round(bw * hr), 4);
      if (s0.maxMp) { ctx.fillStyle = '#4f8fe0'; ctx.fillRect(bx, by + 6, Math.round(bw * Math.max(0, Math.min(1, s0.mp / s0.maxMp))), 4); }
      ctx.fillStyle = '#ffd36e'; ctx.font = '12px "IBM Plex Sans KR",sans-serif';
      ctx.fillText(s0.t.name, nm[0] + 4, nm[1]);
      if (sel.length > 1) { ctx.fillStyle = '#8a94a8'; ctx.font = '11px "IBM Plex Sans KR",sans-serif'; ctx.textAlign = 'right'; ctx.fillText(sel.length + '기 선택', nm[2] - 4, nm[1] + 1); ctx.textAlign = 'left'; }
      if (sel.length === 1) {
        var st = Math.min(4, Math.floor((1 - s0.hp / s0.maxHp) * 5)), ty = nm[3] + 12;
        ctx.drawImage(A.get('figs'), id * 36, st * 43, 36, 43, inf[0] + 14, ty, 36, 43);
        ctx.fillStyle = '#d6dbe6'; ctx.font = '11px "IBM Plex Mono",monospace';
        ctx.fillText('Lv' + s0.level + ' 체력 ' + s0.hp + '/' + s0.maxHp, inf[0] + 58, ty);
        ctx.fillText(s0.maxMp ? '마나 ' + Math.floor(s0.mp) + '/' + s0.maxMp : '공격 ' + s0.t.atk + ' 방어 ' + s0.t.def, inf[0] + 58, ty + 15);
        if (s0.maxMp) ctx.fillText('공격 ' + s0.t.atk + ' 방어 ' + s0.t.def, inf[0] + 58, ty + 30);
        ctx.fillStyle = '#8a94a8'; ctx.font = '11px "IBM Plex Sans KR",sans-serif';
        ctx.fillText(s0.act ? s0.act.name + (s0.act.mana ? ' (마나 ' + s0.act.mana + ')' : '') : '공격 행동 없음', inf[0] + 14, inf[3] - 22);
      } else {
        // 그룹: 초점 유닛만 옅은 금색 바탕 + 모서리 꺾쇠, 나머지는 살짝 어둡게 — 대비로만 구분한다
        for (var k = 0; k < Math.min(sel.length, 12); k++) { var q = sel[k], st2 = Math.min(4, Math.floor((1 - q.hp / q.maxHp) * 5)), gx = inf[0] + 12 + (k % 6) * 27, gy = nm[3] + 10 + Math.floor(k / 6) * 44, on = q === s0;
          if (on) { ctx.fillStyle = 'rgba(255,211,110,.13)'; ctx.fillRect(gx, gy, 27, 32); }
          ctx.globalAlpha = on ? 1 : 0.62; ctx.drawImage(A.get('figs'), q.t.pid * 36, st2 * 43, 36, 43, gx, gy, 27, 32); ctx.globalAlpha = 1;
          if (on) { ctx.strokeStyle = 'rgba(255,211,110,.85)'; ctx.lineWidth = 1; ctx.beginPath(); var c5 = 5, x0 = gx + .5, y0 = gy + .5, x1 = gx + 26.5, y1 = gy + 31.5;
            ctx.moveTo(x0, y0 + c5); ctx.lineTo(x0, y0); ctx.lineTo(x0 + c5, y0); ctx.moveTo(x1 - c5, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1, y0 + c5);
            ctx.moveTo(x1, y1 - c5); ctx.lineTo(x1, y1); ctx.lineTo(x1 - c5, y1); ctx.moveTo(x0 + c5, y1); ctx.lineTo(x0, y1); ctx.lineTo(x0, y1 - c5); ctx.stroke(); } }
        ctx.fillStyle = '#d6dbe6'; ctx.font = '10px "IBM Plex Mono",monospace';
        ctx.fillText('Lv' + s0.level + ' ' + s0.hp + '/' + s0.maxHp + (s0.maxMp ? '  MP ' + Math.floor(s0.mp) + '/' + s0.maxMp : ''), inf[0] + 12, inf[3] - 22);
      }
    } else { ctx.fillStyle = '#8a94a8'; ctx.font = '12px "IBM Plex Sans KR",sans-serif'; ctx.fillText(s.facName + ' 유닛을 선택하세요', nm[0] + 4, nm[1]); }
    // 명령 버튼: 윗줄 = 기본 명령(이동·공격 이동·정지), 둘째 줄부터 = 선택 유닛의 원본 행동 아이콘
    var hot = [s.cmdMode === 'move', s.cmdMode === 'amove', false];
    for (var c = 0; c < 3; c++) if (!(c === 1 && s0 && Hud.mergedAttack(s0.t))) ctx.drawImage(A.get('icons'), (c * 2 + (hot[c] ? 1 : 0)) * 33, 0, 33, 31, B[c][0] + 1, B[c][1] + 5, 33, 31);
    if (s0 && s0.origType) { ctx.fillStyle = '#ffd36e'; ctx.font = '10px "IBM Plex Sans KR",sans-serif'; ctx.fillText('원래대로', B[4][0] + 1, B[4][1] + 14); }
    if (s0) { var ic = s0.t.icons, D = this.iconDef, im = A.get('acticons');
      for (i = 0; i < ic.length && i < 10; i++) { if (ic[i] < 0) continue; var ac = s0.t.acts[i], fi = ic[i] * 2 + (ac === s0.act ? 1 : 0), bb = B[5 + i];   // 지금 쓰는 행동 = 눌림 그림, 쓸 수 없는 행동 = 흐리게
        if (s.skill === ac) fi = ic[i] * 2 + 1;
        ctx.globalAlpha = ac.dmg || ac.sup ? 1 : 0.35; ctx.drawImage(im, (fi % D.cols) * D.w, Math.floor(fi / D.cols) * D.h, D.w, D.h, bb[0], bb[1], D.w, D.h); ctx.globalAlpha = 1; } }
    this._tip(world, s);
    for (i = 0; i < world.buildings.length; i++) { var wb = world.buildings[i]; if (wb.owner < 0) continue; var bw2 = map.t2w(wb.x, wb.y); ctx.strokeStyle = s.colors[wb.owner]; ctx.strokeRect(mm.x + bw2[0] * mm.sc - 2.5, mm.y + bw2[1] * mm.sc - 2.5, 5, 5); }
  };
  MWE.Hud = Hud;

  /* Bgm: 진영별 원본 배경음. 브라우저 정책상 버튼을 눌러야 재생된다. */
  function Bgm(base, files) { this.base = base; this.files = files; this.el = null; this.on = false; this.cur = -1; }
  Bgm.prototype.set = function (i) { this.cur = i; if (this.on) this._play(); };
  Bgm.prototype.toggle = function () { this.on = !this.on; if (this.on) this._play(); else if (this.el) this.el.pause(); return this.on; };
  Bgm.prototype._play = function () {
    if (!this.el) { this.el = new Audio(); this.el.loop = true; this.el.volume = 0.5; }
    var src = this.base + this.files[this.cur < 0 ? 0 : this.cur];
    if (this.el.getAttribute('data-src') !== src) { this.el.src = src; this.el.setAttribute('data-src', src); }
    var p = this.el.play(); if (p && p.catch) p.catch(function () {});
  };
  MWE.Bgm = Bgm;
})(window);
