/* Assets: 이미지 로더. 게임 모드와 무관하게 키로 꺼내 쓴다. */
(function (root) {
  'use strict';
  var MWE = root.MWE;
  /* 받은 바이트를 센다. fetch 스트림으로 받아 Image 로 바꾸므로 "12.3 / 20.9 MB" 같은 진행률을 낼 수 있다.
     파일 크기는 sim/sizes.js(window.MW_SIZES, dist.js 가 만든다)에서, 없으면 Content-Length 에서, 그것도 없으면 개수 기준.
     fetch 가 안 되는 곳(file:// 로 바로 연 경우)은 예전처럼 Image 로만 받는다. */
  function Assets(base) { this.base = base; this.img = {}; this.need = 0; this.got = 0; this.failed = null; this.bytes = 0; this.total = 0; this.sizes = root.MW_SIZES || {}; this.useFetch = !!(root.fetch && root.ReadableStream && /^https?:/.test(root.location.protocol)); }
  Assets.prototype.load = function (key, src) {
    var self = this, im = new Image(); this.need++; this.img[key] = im;
    var est = this.sizes[src] || 0, got = 0; this.total += est;
    var plain = function () { im.onload = function () { self.got++; }; im.onerror = function () { self.failed = src; }; im.src = self.base + src; };
    if (!this.useFetch) { plain(); return this; }
    root.fetch(this.base + src).then(function (r) {
      if (!r.ok || !r.body) throw new Error(r.status);
      if (!est) { var cl = +r.headers.get('content-length') || 0; if (cl) { est = cl; self.total += cl; } }
      var reader = r.body.getReader(), parts = [];
      return (function pump() { return reader.read().then(function (c) {
        if (c.done) return new Blob(parts);
        parts.push(c.value); got += c.value.length; self.bytes += c.value.length;
        if (est && got > est) { self.total += got - est; est = got; }   // 추정보다 크면 합계를 늘린다
        return pump(); }); })();
    }).then(function (blob) {
      if (est && got < est) { self.bytes += est - got; }                 // 추정보다 작으면 남은 몫을 채운다
      var url = URL.createObjectURL(blob);
      im.onload = function () { self.got++; URL.revokeObjectURL(url); }; im.onerror = function () { URL.revokeObjectURL(url); plain(); }; im.src = url;
    }).catch(function () { if (est) { self.bytes += est - got; } plain(); });   // fetch 가 막히면 Image 로
    return this;
  };
  Assets.prototype.ready = function () { return !this.failed && this.got >= this.need; };
  /* 진행률 0~1: 바이트를 알면 바이트, 모르면 개수 */
  Assets.prototype.progress = function () { if (this.ready()) return 1; return this.total ? Math.min(0.999, this.bytes / this.total) : (this.need ? this.got / this.need : 0); };
  Assets.prototype.get = function (key) { return this.img[key]; };
  MWE.Assets = Assets;
  /* 로딩 화면 한 장: 그림 진행률(바이트) + 효과음 진행률. 두 게임이 같이 쓴다.
     ctx 캔버스, W×H 화면 크기, assets, sfx(없어도 됨), failed 문구 */
  var MB = function (b) { return (b / 1048576).toFixed(1); };
  MWE.drawLoading = function (ctx, W, H, assets, sfx) {
    var p = assets.progress(), y = Math.round(H * 0.46), bw = Math.min(420, W - 48), bx = Math.round((W - bw) / 2);
    ctx.fillStyle = '#0b0d12'; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 16px "IBM Plex Sans KR",sans-serif'; ctx.fillStyle = '#c9d1e3';
    if (assets.failed) { ctx.fillText('그림을 불러오지 못했습니다: ' + assets.failed, W / 2, y, W - 16); ctx.textAlign = 'left'; return; }
    ctx.fillText('원본 그림을 불러오는 중 ' + Math.floor(p * 100) + '%', W / 2, y - 22, W - 16);
    ctx.fillStyle = '#2a2f3a'; ctx.fillRect(bx, y, bw, 10); ctx.fillStyle = '#e0a05c'; ctx.fillRect(bx, y, Math.round(bw * p), 10);
    ctx.font = '12px "IBM Plex Sans KR",sans-serif'; ctx.fillStyle = '#8a94a8';
    ctx.fillText(assets.total ? MB(Math.min(assets.bytes, assets.total)) + ' / ' + MB(assets.total) + ' MB · 파일 ' + assets.got + '/' + assets.need : '파일 ' + assets.got + ' / ' + assets.need, W / 2, y + 24, W - 16);
    if (sfx && sfx.total) { var q = sfx.progress(); ctx.fillStyle = '#2a2f3a'; ctx.fillRect(bx, y + 44, bw, 4); ctx.fillStyle = '#6f87b8'; ctx.fillRect(bx, y + 44, Math.round(bw * q), 4);
      ctx.fillStyle = '#6b7488'; ctx.fillText('효과음 ' + (q >= 1 ? '준비됨' : MB(sfx.bytes) + ' / ' + MB(sfx.total) + ' MB (뒤에서 계속 받음)'), W / 2, y + 60, W - 16); }
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  };

  /* 유닛에 붙은 방어 이펙트(베리어·실드)의 지금 그림 번호. 전장 시뮬(worldview.js)과 디펜스(defense.js)가 같이 쓴다.
     대부분은 그림 전체를 되풀이하지만, 파운틴 베리어(칸 7)는 원본대로 (FUN_00453ec0, 분석 8-34):
       처음 loop(5)장은 물이 솟아오르는 시전 동작으로 한 번만, 그 뒤로는 나머지 그림만 되풀이해 물줄기가 유지되는 모양.
       그림 묶음(def.var)은 유닛 크기(종류 +0xFE = 체력 바 틀 번호: 0~1 / 2~3 / 4 이상)에 따라 셋 중 하나.
     buff.t0v = 이 이펙트를 처음 그린 시각 (걸린 순간부터 센다). now 단위는 초, 원본은 틱(초당 12)마다 한 장 */
  MWE.shieldFrame = function (def, buff, type, now) {
    var seq = def.fly.length ? def.fly : def.hit; if (!seq || !seq.length) return -1;
    if (!def.var) return seq[Math.floor(now * 15) % seq.length];
    if (buff.t0v == null) buff.t0v = now;
    var HB = root.MW && root.MW.hpbar, cls = HB && HB.units[type.id] ? HB.units[type.id][0] : 0;
    var s = def.var[cls < 2 ? 0 : cls < 4 ? 1 : 2], f = Math.floor((now - buff.t0v) * 12), L = def.loop;
    return s[f < L ? f : L + (f - L) % (s.length - L)];
  };
})(window);
