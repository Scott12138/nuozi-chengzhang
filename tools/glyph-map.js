#!/usr/bin/env node
/* ============================================================================
 * 字形墨迹剖面扫描器 —— 把 1000 网格里的字栅格化成 ASCII 密度图
 * ----------------------------------------------------------------------------
 * 为什么需要它：物象（枝叶、根须、枪缨）的落点必须锚在**真实笔画端点**上，
 * 靠肉眼瞄网格估坐标，估一次错一次。这个工具把路径按 even-odd 规则扫描线填充，
 * 直接打印出「哪块是空的、哪个笔梢在哪」。
 *
 * 用法:
 *   node tools/glyph-map.js 木                 # 默认 46 列
 *   node tools/glyph-map.js 梅 --cols 60 --rows 40
 *   node tools/glyph-map.js 梅 --x 60 400 --y 500 900   # 只看局部放大
 *   node tools/glyph-map.js 木 --edges          # 额外打印该字所有「笔梢」（端点）坐标
 * ========================================================================== */
'use strict';

const path = require('path');
const ROOT = path.dirname(__dirname);
global.window = global;
require(path.join(ROOT, 'design', 'glyphs-data.js'));

/* ── 路径 → 稠密折线 ──────────────────────────────────────────────────── */
function toPolyline(d, perQuad) {
  perQuad = perQuad || 12;
  const pts = [];
  const toks = d.match(/[MLQZ]|-?\d+(?:\.\d+)?/g) || [];
  let i = 0, cur = { x: 0, y: 0 }, start = null;
  const num = () => parseFloat(toks[i++]);
  while (i < toks.length) {
    const c = toks[i++];
    if (c === 'M' || c === 'L') {
      let first = true;
      while (i < toks.length && /^-?[\d.]/.test(toks[i])) {
        const x = num(), y = num();
        if (first && c === 'M') { start = { x, y }; first = false; }
        pts.push({ x, y }); cur = { x, y };
      }
    } else if (c === 'Q') {
      const cx = num(), cy = num(), x = num(), y = num();
      for (let k = 1; k <= perQuad; k++) {
        const t = k / perQuad, u = 1 - t;
        pts.push({
          x: u * u * cur.x + 2 * u * t * cx + t * t * x,
          y: u * u * cur.y + 2 * u * t * cy + t * t * y
        });
      }
      cur = { x, y };
    } else if (c === 'Z') {
      if (start) pts.push({ x: start.x, y: start.y });
    }
  }
  return pts;
}

/* ── even-odd 扫描线填充 ──────────────────────────────────────────────
 * 返回 rows 行 × cols 列 的覆盖率矩阵（0~1）。
 * 每一行取格心 y，求多边形与该 y 的所有交点，排序后成对填满。 */
function rasterize(poly, x0, y0, x1, y1, cols, rows, sub) {
  sub = sub || 3;                                     // 每行再细分，抗锯齿
  const g = [];
  for (let r = 0; r < rows; r++) g.push(new Array(cols).fill(0));
  const cw = (x1 - x0) / cols, ch = (y1 - y0) / rows;
  for (let r = 0; r < rows; r++) {
    for (let s = 0; s < sub; s++) {
      const y = y0 + (r + (s + 0.5) / sub) * ch;
      const xs = [];
      for (let k = 0; k < poly.length - 1; k++) {
        const a = poly[k], b = poly[k + 1];
        if ((a.y <= y) !== (b.y <= y)) {
          const t = (y - a.y) / (b.y - a.y);
          xs.push(a.x + t * (b.x - a.x));
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const lo = Math.max(x0, xs[k]), hi = Math.min(x1, xs[k + 1]);
        if (hi <= lo) continue;
        const ca = Math.floor((lo - x0) / cw), cb = Math.floor((hi - x0) / cw);
        for (let c = ca; c <= cb && c < cols; c++) {
          if (c < 0) continue;
          const cl = x0 + c * cw, cr = cl + cw;
          g[r][c] += Math.max(0, Math.min(hi, cr) - Math.max(lo, cl)) / cw / sub;
        }
      }
    }
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) g[r][c] = Math.min(1, g[r][c]);
  return g;
}

/* ── 笔梢（端点）探测 ────────────────────────────────────────────────
 * 在网格里找「只有一个邻居」的墨块 —— 那就是笔尖/梢。
 * 粗笔画会导致大片区域，所以先按格心采样，再做 8 邻域连通。 */
function tips(g, x0, y0, x1, y1) {
  const rows = g.length, cols = g[0].length;
  const on = (r, c) => r >= 0 && c >= 0 && r < rows && c < cols && g[r][c] > 0.12;
  const cx = c => Math.round(x0 + (c + 0.5) * (x1 - x0) / cols);
  const cy = r => Math.round(y0 + (r + 0.5) * (y1 - y0) / rows);
  const out = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (!on(r, c)) continue;
    let n = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++)
      if ((dr || dc) && on(r + dr, c + dc)) n++;
    if (n <= 2) out.push({ x: cx(c), y: cy(r), n });
  }
  return out;
}

/* ── 主流程 ─────────────────────────────────────────────────────────── */
const argv = process.argv.slice(2);
const ch = argv.find(a => !a.startsWith('--'));
const flag = (k, dflt) => {
  const i = argv.indexOf('--' + k);
  return i < 0 ? dflt : parseFloat(argv[i + 1]);
};
const cols = flag('cols', 46), rows = flag('rows', Math.round(46 / 1.0));
let x0 = flag('x0', 0), y0 = flag('y0', 0), x1 = flag('x1', 1000), y1 = flag('y1', 1000);
const X = argv.indexOf('--x'), Y = argv.indexOf('--y');
if (X >= 0) { x0 = parseFloat(argv[X + 1]); x1 = parseFloat(argv[X + 2]); }
if (Y >= 0) { y0 = parseFloat(argv[Y + 1]); y1 = parseFloat(argv[Y + 2]); }

if (!ch || !InkGlyphs.has(ch)) {
  console.error('用法: node tools/glyph-map.js <字> [--cols N] [--x0 a --x1 b] [--x y0 y1] [--edges]');
  console.error('可用字:', Object.keys(InkGlyphs.boxes).join(''));
  process.exit(1);
}

const box = InkGlyphs.boxes[ch];
const poly = toPolyline(InkGlyphs.path(ch));
const g = rasterize(poly, x0, y0, x1, y1, cols, rows, 3);

console.log(`《${ch}》墨迹包围盒 [${box.join(', ')}]  视窗 x[${x0},${x1}] y[${y0},${y1}]  ${cols}×${rows}\n`);

/* 坐标尺 */
const cw = (x1 - x0) / cols;
let ruler = '      ';
for (let c = 0; c < cols; c++) ruler += (c % 10 === 0) ? '|' : ' ';
console.log(ruler + '   ← x 每格 ' + cw.toFixed(0) + ' 单位');
for (let r = 0; r < rows; r++) {
  let line = '';
  for (let c = 0; c < cols; c++) {
    const v = g[r][c];
    line += v < 0.12 ? '·' : v < 0.4 ? '░' : v < 0.75 ? '▒' : '█';
  }
  const yy = Math.round(y0 + (r + 0.5) * (y1 - y0) / rows);
  console.log(String(yy).padStart(5) + ' ' + line);
}

if (argv.includes('--edges')) {
  const t = tips(g, x0, y0, x1, y1);
  t.sort((a, b) => a.y - b.y);
  console.log('\n笔梢候选（格心坐标，需肉眼复核）:');
  t.forEach(p => console.log(`  (${p.x}, ${p.y})  邻域墨块数 ${p.n}`));
}
