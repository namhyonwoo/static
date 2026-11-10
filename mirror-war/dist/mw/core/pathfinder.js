/* Pathfinder: 반칸 격자 위 8방향 A*. 원본도 반칸·8방향으로 검사한다(0x52F190~0x534BBA).
   탐색 순서·비용은 원본 그대로가 아니라 표준 A*다. */
(function (root) {
  'use strict';
  var MWE = root.MWE;
  var DX = [1, -1, 0, 0, 1, 1, -1, -1], DY = [0, 0, 1, -1, 1, -1, 1, -1], DC = [1, 1, 1, 1, 1.4142, 1.4142, 1.4142, 1.4142];

  function Pathfinder(map) {
    this.map = map; var n = map.S * map.S;
    this.g = new Float32Array(n); this.from = new Int32Array(n); this.stamp = new Uint32Array(n); this.gen = 0;
  }
  /* 반환: 타일 좌표 경유점 배열 (출발점 제외). 길이 없으면 null. */
  Pathfinder.prototype.find = function (x0, y0, x1, y1, mc) {
    var map = this.map, S = map.S, W = map.walkGrid(mc);
    var goal = map.nearestWalkable(x1, y1, mc); x1 = goal[0]; y1 = goal[1];
    if (map.lineWalkable(x0, y0, x1, y1, mc)) return [[x1, y1]];
    var sx = map.cellOf(x0), sy = map.cellOf(y0), gx = map.cellOf(x1), gy = map.cellOf(y1);
    if (sx < 0 || sy < 0 || sx >= S || sy >= S) return null;
    var s = sy * S + sx, t = gy * S + gx, gen = ++this.gen, G = this.g, F = this.from, ST = this.stamp;
    var heap = new MWE.Heap(); G[s] = 0; F[s] = -1; ST[s] = gen; heap.push(0, s);
    var found = false, guard = 0;
    while (heap.size()) {
      var c = heap.pop(); if (c === t) { found = true; break; }
      if (++guard > 60000) break;
      var cx = c % S, cy = (c / S) | 0, gc = G[c];
      for (var d = 0; d < 8; d++) {
        var nx = cx + DX[d], ny = cy + DY[d]; if (nx < 0 || ny < 0 || nx >= S || ny >= S) continue;
        var n = ny * S + nx; if (!W[n]) continue;
        if (d > 3 && (!W[cy * S + nx] || !W[ny * S + cx])) continue;       // 모서리 끼어들기 금지
        var ng = gc + DC[d];
        if (ST[n] === gen && G[n] <= ng) continue;
        G[n] = ng; F[n] = c; ST[n] = gen;
        var hx = Math.abs(nx - gx), hy = Math.abs(ny - gy);
        heap.push(ng + (hx > hy ? hx + 0.4142 * hy : hy + 0.4142 * hx), n);
      }
    }
    if (!found) return null;
    var pts = [], k = t;
    while (k !== s && k >= 0) { pts.push([map.cellCenter(k % S), map.cellCenter((k / S) | 0)]); k = F[k]; }
    pts.reverse(); pts[pts.length - 1] = [x1, y1];
    // 직선으로 갈 수 있는 구간은 경유점을 건너뛴다
    var out = [], px = x0, py = y0, i = 0;
    while (i < pts.length) {
      var j = Math.min(pts.length - 1, i + 24);
      while (j > i && !map.lineWalkable(px, py, pts[j][0], pts[j][1], mc)) j--;
      out.push(pts[j]); px = pts[j][0]; py = pts[j][1]; i = j + 1;
    }
    return out;
  };
  MWE.Pathfinder = Pathfinder;
})(typeof window !== 'undefined' ? window : globalThis);
