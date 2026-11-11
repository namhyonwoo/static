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
