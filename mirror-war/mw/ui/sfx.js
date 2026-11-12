/* Sfx: 원본 효과음. sfx.js(MP3 조각 묶음을 base64로 담은 스크립트)를 한 번 읽어 필요할 때 조각을 디코드한다.
   fetch를 쓰지 않으므로 서버 없이 파일을 바로 열어도 소리가 난다.
   브라우저 정책상 첫 클릭 이후에만 소리가 난다. */
(function (root) {
  'use strict';
  var MWE = root.MWE;
  function Sfx(url, index) { this.url = url; this.index = index || {}; this.on = true; this.ctx = null; this.bin = null; this.buf = {}; this.last = {}; this.live = 0; this.volume = 0.6; this._loading = false; this.bytes = 0; this.total = (root.MW_SIZES && root.MW_SIZES['sfx.js']) || 0; this._fetch(); }
  var P = Sfx.prototype;
  /* 사용자 동작 안에서 호출: 오디오 컨텍스트를 만들고 묶음을 받아 둔다 */
  P.unlock = function () {
    if (!this.ctx) { var AC = root.AudioContext || root.webkitAudioContext; if (!AC) return; this.ctx = new AC(); }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this._fetch();
  };
  /* 묶음 파일은 페이지가 열릴 때 미리 받는다 (재생만 첫 클릭 이후).
     http(s) 면 fetch 스트림으로 받아 진행률(bytes/total)을 세고, file:// 이거나 fetch 가 실패하면 script 태그로 받는다. */
  P._fetch = function () {
    var self = this; if (this.bin || this._loading) return; this._loading = true;
    var useFetch = !!(root.fetch && root.ReadableStream && root.TextDecoder && /^https?:/.test(root.location.protocol));
    var fromB64 = function (b64) { var raw = atob(b64), n = raw.length, u8 = new Uint8Array(n); for (var i = 0; i < n; i++) u8[i] = raw.charCodeAt(i); self.bin = u8.buffer; self.bytes = self.total = Math.max(self.total, self.bytes); };
    var viaScript = function () {
      var el = document.createElement('script'); el.src = self.url; el.async = true;
      el.onload = function () { var b64 = root.MW_SFX; if (!b64) { self._loading = false; return; } fromB64(b64); root.MW_SFX = null; };
      el.onerror = function () { self._loading = false; };
      document.head.appendChild(el); };
    if (!useFetch) { viaScript(); return; }
    root.fetch(this.url).then(function (r) {
      if (!r.ok || !r.body) throw new Error(r.status);
      if (!self.total) self.total = +r.headers.get('content-length') || 0;
      var reader = r.body.getReader(), td = new TextDecoder(), text = '';
      return (function pump() { return reader.read().then(function (c) {
        if (c.done) return text + td.decode();
        self.bytes += c.value.length; if (self.total && self.bytes > self.total) self.total = self.bytes; text += td.decode(c.value, { stream: true }); return pump(); }); })();
    }).then(function (text) {
      var m = /MW_SFX\s*=\s*"([^"]*)"/.exec(text); if (!m) throw new Error('format'); fromB64(m[1]);
    }).catch(function () { self.bytes = 0; viaScript(); });
  };
  /* 효과음 묶음 진행률 0~1 (받았으면 1) */
  P.progress = function () { return this.bin ? 1 : (this.total ? Math.min(0.999, this.bytes / this.total) : 0); };
  P.has = function (id) { return id >= 0 && !!this.index[id]; };
  /* id 재생. vol 0~1. 같은 소리는 90ms 안에 겹치지 않게, 동시 재생은 10개까지 */
  P.play = function (id, vol) {
    if (!this.on || !this.ctx || !this.bin || !this.has(id)) return;
    var now = this.ctx.currentTime, self = this;
    if (now - (this.last[id] || -1) < 0.09 || this.live >= 10) return; this.last[id] = now;
    var b = this.buf[id];
    if (b === 'pending') return;
    if (!b) { var e = this.index[id]; this.buf[id] = 'pending';
      this.ctx.decodeAudioData(this.bin.slice(e[0], e[0] + e[1]), function (d) { self.buf[id] = d; self._start(d, vol); }, function () { delete self.index[id]; });
      return; }
    this._start(b, vol);
  };
  P._start = function (b, vol) {
    var s = this.ctx.createBufferSource(), g = this.ctx.createGain(), self = this;
    s.buffer = b; g.gain.value = this.volume * (vol == null ? 1 : vol); s.connect(g); g.connect(this.ctx.destination);
    this.live++; s.onended = function () { self.live--; }; s.start();
  };
  MWE.Sfx = Sfx;
})(window);
