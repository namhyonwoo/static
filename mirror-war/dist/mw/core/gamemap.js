/* GameMap: 원본 .mwm에서 읽은 지형·고도·통행 속성.
   좌표계 — 타일 좌표(tx,ty)는 다이아몬드 축, 정수 = 타일 중심.
   통행 격자는 타일을 4등분한 반칸(2M×2M). 원본 규칙(FUN_00530da0):
     칸 속성 ≤ 유닛 이동 등급 이면 통과. 유닛은 자기 칸 + 상하좌우 4칸을 모두 검사한다.
   속성: 0 풀밭, 1 흙길, 3 맵 모서리, 5 물, 8 자원지(추정), 9 배치물. */
(function (root) {
  'use strict';
  var MWE = root.MWE;

  function GameMap(d) {
    this.name = d.name; this.M = d.M; this.S = d.M * 2;
    this.keys = d.keys || { tiles: 'tiles', objs: 'objs', blds: 'blds', minimap: 'minimap' };   // 이 맵이 쓰는 이미지 키
    this.arena = d.arena || null;        // 장애물 없는 평지의 중심 (1:n 시험장)
    this.rows = d.rows; this.el = d.el; this.tileCols = d.tileCols; this.mini = d.mini;
    this.objs = d.objs || []; this.objDefs = d.objDefs || []; this.objFrames = d.objFrames || []; this.sites = d.sites || [];
    this.blds = d.blds || []; this.bldFrames = d.bldFrames || [];   // 맵에 미리 놓인 중립 건물
    this.worldW = d.M * 64 + 32; this.worldH = d.M * 32 + 64;
    this.OX = d.M * 32 + 32; this.OY = 64;
    var S = this.S, a = this.attr = new Uint8Array(S * S), i;
    for (i = 0; i < S * S; i++) a[i] = d.attr.charCodeAt(i) - 48;
    this.starts = d.starts.map(function (s) { return this.w2t(s[0] + 32, s[1] + 48); }, this);
    this._walk = {};
  }
  var P = GameMap.prototype;
  P.t2w = function (tx, ty) { return [this.OX + (tx - ty) * 32, this.OY + (tx + ty) * 16]; };
  P.w2t = function (wx, wy) { var d = (wx - this.OX) / 32, s = (wy - this.OY) / 16; return [(s + d) / 2, (s - d) / 2]; };
  P.clamp = function (v) { return v < 0.5 ? 0.5 : v > this.M - 1.5 ? this.M - 1.5 : v; };
  P.elevAt = function (tx, ty) {
    var M = this.M, el = this.el, x0 = Math.floor(tx), y0 = Math.floor(ty), fx = tx - x0, fy = ty - y0;
    function e(x, y) { x = x < 0 ? 0 : x >= M ? M - 1 : x; y = y < 0 ? 0 : y >= M ? M - 1 : y; return el[y * M + x] * 16; }
    return e(x0, y0) * (1 - fx) * (1 - fy) + e(x0 + 1, y0) * fx * (1 - fy) + e(x0, y0 + 1) * (1 - fx) * fy + e(x0 + 1, y0 + 1) * fx * fy;
  };
  P.levelAt = function (tx, ty) { var M = this.M, x = Math.round(tx), y = Math.round(ty); x = x < 0 ? 0 : x >= M ? M - 1 : x; y = y < 0 ? 0 : y >= M ? M - 1 : y; return this.el[y * M + x]; };
  /* 타일 좌표 ↔ 반칸 */
  P.cellOf = function (t) { return Math.floor(2 * t + 1); };
  P.cellCenter = function (c) { return c / 2 - 0.25; };
  /* 이동 등급별 통행 격자 (발자국 5칸 검사 포함), 최초 1회 계산 */
  P.walkGrid = function (mc) {
    var g = this._walk[mc]; if (g) return g;
    var S = this.S, a = this.attr; g = new Uint8Array(S * S);
    for (var y = 1; y < S - 1; y++) for (var x = 1; x < S - 1; x++) {
      var i = y * S + x;
      g[i] = (a[i] <= mc && a[i - 1] <= mc && a[i + 1] <= mc && a[i - S] <= mc && a[i + S] <= mc) ? 1 : 0;
    }
    return (this._walk[mc] = g);
  };
  P.walkable = function (tx, ty, mc) {
    var S = this.S, cx = this.cellOf(tx), cy = this.cellOf(ty);
    if (cx < 0 || cy < 0 || cx >= S || cy >= S) return false;
    return this.walkGrid(mc)[cy * S + cx] === 1;
  };
  /* 직선으로 걸어갈 수 있는가 (경로 단순화·추격 판단용) */
  P.lineWalkable = function (x0, y0, x1, y1, mc) {
    var d = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(d * 4);
    for (var i = 1; i <= n; i++) { var t = i / n; if (!this.walkable(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, mc)) return false; }
    return true;
  };
  /* 가장 가까운 통행 가능 칸의 타일 좌표 */
  P.nearestWalkable = function (tx, ty, mc) {
    if (this.walkable(tx, ty, mc)) return [tx, ty];
    var S = this.S, g = this.walkGrid(mc), cx = this.cellOf(tx), cy = this.cellOf(ty), best = null, bd = 1e9;
    for (var r = 1; r < 40 && !best; r++)
      for (var y = cy - r; y <= cy + r; y++) for (var x = cx - r; x <= cx + r; x++) {
        if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r || x < 0 || y < 0 || x >= S || y >= S || !g[y * S + x]) continue;
        var dd = (x - cx) * (x - cx) + (y - cy) * (y - cy); if (dd < bd) { bd = dd; best = [this.cellCenter(x), this.cellCenter(y)]; }
      }
    return best || [tx, ty];
  };
  MWE.GameMap = GameMap;
})(typeof window !== 'undefined' ? window : globalThis);
