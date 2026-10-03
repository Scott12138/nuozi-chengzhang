#!/usr/bin/env node
/**
 * 偏旁/部件「靠边对齐」试样生成器（一次性探针，不进仓库）
 * 一、单张部件：内容在**本格**里的位置与大小（4 种口径）
 * 二、两张相邻时：两种「靠哪边」的读法并排（自己那半边 vs 相接的那条边）
 */
import fs from 'fs';
import path from 'path';

const ROOT = '/Users/consli/WorkBuddy/2026-10-01-19-57-04/chaizi-lianliankan';
const D = path.join(ROOT, 'design');
const rd = (f) => fs.readFileSync(path.join(D, f), 'utf8');

globalThis.window = globalThis;
new Function(rd('glyphs-data.js'))();
const G = globalThis.InkGlyphs;

const V = 1000;
const PAD_EDGE = 62;

function glyphLayer(ch, pos, shrink, distort) {
  const box = G.box(ch);
  const bw = Math.max(1, box[2] - box[0]);
  const bh = Math.max(1, box[3] - box[1]);
  const k = (V * 0.76) / Math.max(bw, bh) * shrink;
  let sx = k, sy = k;
  if (pos === 't' || pos === 'b') sy = k * distort;
  if (pos === 'l' || pos === 'r') sx = k * distort;
  const gw = bw * sx, gh = bh * sy;
  let gx, gy;
  if (pos === 'c') { gx = (V - gw) / 2; gy = (V - gh) / 2; }
  else if (pos === 'l') { gx = PAD_EDGE; gy = (V - gh) / 2; }
  else if (pos === 'r') { gx = V - PAD_EDGE - gw; gy = (V - gh) / 2; }
  else if (pos === 't') { gy = PAD_EDGE; gx = (V - gw) / 2; }
  else { gy = V - PAD_EDGE - gh; gx = (V - gw) / 2; }
  const d = G.path(ch) || '';
  return '<g transform="translate(' + (gx - box[0] * sx).toFixed(1) + ',' + (gy - box[1] * sy).toFixed(1)
    + ') scale(' + sx.toFixed(4) + ',' + sy.toFixed(4) + ')">'
    + '<path d="' + d + '" fill="url(#moGrad)" filter="url(#inkMo)"/></g>';
}

function guide(pos, show) {
  if (!show) return '';
  const st = 'stroke="#c0392b" stroke-width="4" stroke-dasharray="18 14" opacity=".45"';
  if (pos === 't' || pos === 'b') return '<line x1="60" y1="500" x2="940" y2="500" ' + st + '/>';
  if (pos === 'l' || pos === 'r') return '<line x1="500" y1="60" x2="500" y2="940" ' + st + '/>';
  return '';
}

function tile(ch, pos, shrink, distort, opt) {
  opt = opt || {};
  const s = [];
  s.push('<rect width="1000" height="1000" fill="#f3eee1"/>');
  s.push('<rect width="1000" height="1000" filter="url(#chenZhi)"/>');
  s.push('<rect width="1000" height="1000" filter="url(#xianWei)"/>');
  s.push('<g filter="url(#moYun)"><ellipse cx="120" cy="128" rx="600" ry="200" '
    + 'transform="rotate(-24 120 128)" fill="url(#yunGrad)" opacity="0.19"/></g>');
  if (opt.guide) s.push(guide(pos, true));
  s.push(glyphLayer(ch, pos, shrink, distort));
  return s.join('');
}

const CELL = 116;
const COLS = [
  { tag: '① 现状', sub: '居中 · 满格 0.76', pos: 'c', shrink: 1.00, distort: 1.00 },
  { tag: '② 靠边 · 轻缩', sub: '0.72 · 只挪一点', pos: null, shrink: 0.72, distort: 1.00 },
  { tag: '③ 靠边 · 半格', sub: '0.58 · 占半格', pos: null, shrink: 0.58, distort: 1.00 },
  { tag: '④ 半格 + 变形', sub: '0.58 · 顺结构压 0.82', pos: null, shrink: 0.58, distort: 0.82 },
];
const ROWS = [
  { ch: '竹', pos: 't', note: '竹字头（上半）', word: '箭 = 竹 + 前' },
  { ch: '弓', pos: 'b', note: '底部件（下半）', word: '弩 = 奴 + 弓' },
  { ch: '前', pos: 'b', note: '底部件（下半）', word: '箭 = 竹 + 前' },
  { ch: '木', pos: 'l', note: '左偏旁（左半）', word: '枪 = 木 + 仓' },
  { ch: '仓', pos: 'r', note: '右部件（右半）', word: '枪 = 木 + 仓' },
];

const cells = [], jobs = [];
for (const r of ROWS) {
  cells.push('<div class="lbl"><b>' + r.ch + '</b><span>' + r.note + '</span><i>' + r.word + '</i></div>');
  for (const c of COLS) {
    cells.push('<div class="cell"><svg viewBox="0 0 1000 1000" width="' + CELL + '" height="' + CELL + '"></svg></div>');
    jobs.push(tile(r.ch, c.pos || r.pos, c.shrink, c.distort, { guide: c !== COLS[0] }));
  }
}
const head = ['<div class="lbl head"></div>']
  .concat(COLS.map((c) => '<div class="head">' + c.tag + '<em>' + c.sub + '</em></div>')).join('');

/* ── 二、两张相邻 ─────────────────────────────────────────── */
const HALF = 104;
const PAIRS = [
  { a: '竹', b: '前', w: '箭', dir: 'tb' },
  { a: '奴', b: '弓', w: '弩', dir: 'tb' },
  { a: '艹', b: '化', w: '花', dir: 'tb' },
  { a: '木', b: '仓', w: '枪', dir: 'lr' },
];
/* 靠边口径：
   away  —— 各自靠"自己所属的那半边"（字头贴上、底部件贴下）＝ 用户原话的读法
   join  —— 各自靠"与对方相接的那条边"（字头贴下、底部件贴上）＝ 合起来像一个字 */
function pairFrag(p, mode, shrink, distort) {
  const lr = p.dir === 'lr';
  const posA = mode === 'join' ? (lr ? 'r' : 'b') : (lr ? 'l' : 't');
  const posB = mode === 'join' ? (lr ? 'l' : 't') : (lr ? 'r' : 'b');
  const o2 = lr ? 'translate(1000,0)' : 'translate(0,1000)';
  return '<g>' + tile(p.a, posA, shrink, distort) + '</g>'
    + '<g transform="' + o2 + '">' + tile(p.b, posB, shrink, distort) + '</g>';
}
const PCOLS = [
  { tag: '① 现状', sub: '居中满格', mode: 'now', shrink: 1, distort: 1 },
  { tag: '② 各靠自己那半边', sub: '字头贴上 · 底件贴下', mode: 'away', shrink: 0.72, distort: 1 },
  { tag: '③ 各靠相接那条边', sub: '字头贴下 · 底件贴上', mode: 'join', shrink: 0.72, distort: 1 },
];
const pairCells = [], pairJobs = [];
for (const p of PAIRS) {
  const lr = p.dir === 'lr';
  pairCells.push('<div class="lbl"><b>' + p.a + p.b + '</b><span>拼成</span><i>' + p.w + '</i></div>');
  for (const c of PCOLS) {
    const vb = lr ? '0 0 2000 1000' : '0 0 1000 2000';
    const w = lr ? HALF * 2 : HALF, h = lr ? HALF : HALF * 2;
    pairCells.push('<div class="cell"><svg viewBox="' + vb + '" width="' + w + '" height="' + h
      + '" data-i="' + pairJobs.length + '"></svg></div>');
    pairJobs.push(c.mode === 'now' ? pairFrag(p, 'away', 1, 1) : pairFrag(p, c.mode, c.shrink, c.distort));
  }
}
const pairHead = '<div class="lbl head"></div>'
  + PCOLS.map((c) => '<div class="head">' + c.tag + '<em>' + c.sub + '</em></div>').join('');

const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:#f6f3ec;font-family:-apple-system,"PingFang SC",sans-serif}
#wrap{padding:18px 22px}
h1{font-size:19px;margin:0 0 3px;color:#2b2a26}
p.sub{font-size:12px;color:#7b776d;margin:0 0 15px;line-height:1.6}
h2{font-size:14px;margin:22px 0 9px;color:#3b3933;border-left:3px solid #b9b2a2;padding-left:8px}
#grid{display:grid;grid-template-columns:158px repeat(4,auto);gap:7px;align-items:center;justify-content:start}
#grid2{display:grid;grid-template-columns:158px repeat(3,auto);gap:7px;align-items:center;justify-content:start}
.head{font-size:12px;color:#4a4740;text-align:center;font-weight:600;line-height:1.3}
.head em{display:block;font-style:normal;font-weight:400;font-size:10.5px;color:#8a857a}
.lbl{font-size:11px;color:#5b574e;line-height:1.3}
.lbl b{font-size:18px;color:#2b2a26;display:inline-block;margin-right:5px;vertical-align:-3px}
.lbl span{color:#8a857a;margin-right:4px}
.lbl i{font-style:normal;color:#a8a294;font-size:10.5px;display:block}
.cell{box-shadow:0 1px 4px rgba(0,0,0,.14);border-radius:5px;overflow:hidden;line-height:0;justify-self:start}
</style></head><body>
${rd('ink-defs.svg')}
<div id="wrap">
<h1>部件「靠边对齐」试样</h1>
<p class="sub">同一套字形，只改「摆在本格的哪半边 / 缩多少」。红色虚线 = 半格中线。</p>

<h2>一、单张部件长什么样</h2>
<div id="grid">${head}${cells.join('')}</div>

<h2>二、两张相邻时（玩家实际看到的两格）</h2>
<p class="sub" style="margin:-4px 0 8px">同一对部件，两种「靠哪边」的读法 —— 这就是要请你拍板的地方：<b>②</b> 是按你说的「字头占本格上半、底件占本格下半」，中间会空出来；<b>③</b> 是让两块贴向相接的那条边，合成时更像一个字。</p>
<div id="grid2">${pairHead}${pairCells.join('')}</div>
</div>
<script>
var A = ${JSON.stringify(jobs)};
document.querySelectorAll('#grid svg').forEach(function (s, k) { s.innerHTML = A[k]; });
var B = ${JSON.stringify(pairJobs)};
document.querySelectorAll('#grid2 svg').forEach(function (s, k) { s.innerHTML = B[k]; });
document.title = 'OK/' + A.length + '/' + B.length;
</script>
</body></html>`;

fs.writeFileSync('/tmp/_aligndemo/demo.html', html);
console.log('wrote demo.html', html.length, 'bytes');
