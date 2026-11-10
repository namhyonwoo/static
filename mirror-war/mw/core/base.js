/* MWE: 거울전쟁 공용 엔진 네임스페이스.
   core/   화면을 모르는 시뮬레이션 (DOM·Canvas 참조 금지 — Node에서도 돈다)
   render/ Canvas 그리기
   ui/     입력·HUD
   modes/  게임별 조립 (RTS, 자동전투 …) */
(function (root) {
  'use strict';
  var MWE = root.MWE = root.MWE || {};

  /* 시드 난수 (mulberry32). 같은 시드 → 같은 전투. */
  function Rng(seed) { this.s = seed >>> 0; }
  Rng.prototype.next = function () {
    var t = (this.s += 0x6D2B79F5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  /* 최소 이벤트 버스. 코어는 사건만 알리고, 소리·이펙트는 듣는 쪽이 붙인다. */
  function Emitter() { this._h = {}; }
  Emitter.prototype.on = function (k, f) { (this._h[k] = this._h[k] || []).push(f); return this; };
  Emitter.prototype.emit = function (k, a, b, c) { var h = this._h[k]; if (h) for (var i = 0; i < h.length; i++) h[i](a, b, c); };

  /* 이진 힙 (경로 탐색용) */
  function Heap() { this.k = []; this.v = []; }
  Heap.prototype.push = function (key, val) {
    var k = this.k, v = this.v, i = k.length; k.push(key); v.push(val);
    while (i > 0) { var p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  };
  Heap.prototype.pop = function () {
    var k = this.k, v = this.v, top = v[0], lk = k.pop(), lv = v.pop(), n = k.length;
    if (n) { var i = 0; for (;;) { var c = i * 2 + 1; if (c >= n) break; if (c + 1 < n && k[c + 1] < k[c]) c++; if (k[c] >= lk) break; k[i] = k[c]; v[i] = v[c]; i = c; } k[i] = lk; v[i] = lv; }
    return top;
  };
  Heap.prototype.size = function () { return this.k.length; };

  MWE.Rng = Rng; MWE.Emitter = Emitter; MWE.Heap = Heap;
})(typeof window !== 'undefined' ? window : globalThis);
