/* Assets: 이미지 로더. 게임 모드와 무관하게 키로 꺼내 쓴다. */
(function (root) {
  'use strict';
  var MWE = root.MWE;
  function Assets(base) { this.base = base; this.img = {}; this.need = 0; this.got = 0; this.failed = null; }
  Assets.prototype.load = function (key, src) {
    var self = this, im = new Image(); this.need++;
    im.onload = function () { self.got++; }; im.onerror = function () { self.failed = src; };
    im.src = this.base + src; this.img[key] = im; return this;
  };
  Assets.prototype.ready = function () { return !this.failed && this.got >= this.need; };
  Assets.prototype.get = function (key) { return this.img[key]; };
  MWE.Assets = Assets;
})(window);
