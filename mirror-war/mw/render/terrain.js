/* TerrainRenderer: 다이아몬드 타일을 512px 청크로 미리 그려 둔다. */
(function (root) {
  'use strict';
  var MWE = root.MWE, CH = 512;
  function TerrainRenderer(map, tiles) { this.map = map; this.tiles = tiles; this.chunks = {}; }
  TerrainRenderer.CH = CH;
  TerrainRenderer.prototype.chunk = function (cx, cy) {
    var key = cx + ',' + cy, c = this.chunks[key]; if (c) return c;
    var map = this.map, rows = map.rows, TC = map.tileCols, x0 = cx * CH, y0 = cy * CH;
    c = document.createElement('canvas'); c.width = CH; c.height = CH;
    var g = c.getContext('2d');
    var r0 = Math.max(0, Math.floor((y0 - 48) / 16) - 1), r1 = Math.min(rows.length - 1, Math.ceil((y0 + CH + 48) / 16) + 1);
    for (var r = r0; r <= r1; r++) {
      var row = rows[r], off = (r & 1) * 32;
      for (var k = 0; k < row.t.length; k++) {
        var X = (row.s + k) * 64 + off; if (X + 64 <= x0 || X >= x0 + CH) continue;
        var t = row.t[k], Y = r * 16 + 32 - t[1] * 16;
        g.drawImage(this.tiles, (t[0] % TC) * 64, Math.floor(t[0] / TC) * 48, 64, 48, X - x0, Y - y0, 64, 48);
      }
    }
    this.chunks[key] = c; return c;
  };
  TerrainRenderer.prototype.draw = function (ctx, cam, vw, vh) {
    var map = this.map, cx0 = Math.floor(cam.x / CH), cy0 = Math.floor(cam.y / CH), cx1 = Math.floor((cam.x + vw) / CH), cy1 = Math.floor((cam.y + vh) / CH);
    for (var cy = cy0; cy <= cy1; cy++) for (var cx = cx0; cx <= cx1; cx++) {
      if (cx < 0 || cy < 0 || cx * CH >= map.worldW || cy * CH >= map.worldH) continue;
      ctx.drawImage(this.chunk(cx, cy), Math.round(cx * CH - cam.x), Math.round(cy * CH - cam.y));
    }
  };
  MWE.TerrainRenderer = TerrainRenderer;
})(window);
