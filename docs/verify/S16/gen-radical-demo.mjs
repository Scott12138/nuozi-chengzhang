#!/usr/bin/env node
/**
 * 「竹字头」怎么补 —— 三路对比（一次性探针）
 *   A 现状：整字「竹」
 *   B 变换：整字压扁（保留全形，只是变矮）
 *   C 裁剪合成：把「竹」的下半截裁掉再上移 —— 用它自己的笔画当竹字头
 *   D 真偏旁：宋体 ⺮（系统字体，**仅作形状参考，不可随产品分发**）
 */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const ROOT = '/Users/consli/WorkBuddy/2026-10-01-19-57-04/chaizi-lianliankan';
const D = path.join(ROOT, 'design');
const rd = (f) => fs.readFileSync(path.join(D, f), 'utf8');

globalThis.window = globalThis;
new Function(rd('glyphs-data.js'))();
const G = globalThis.InkGlyphs;

const V = 1000, PAD = 62;

function paper() {
  return '<rect width="1000" height="1000" fill="#f3eee1"/>'
    + '<rect width="1000" height="1000" filter="url(#chenZhi)"/>'
    + '<rect width="1000" height="1000" filter="url(#xianWei)"/>'
    + '<g filter="url(#moYun)"><ellipse cx="120" cy="128" rx="600" ry="200" '
    + 'transform="rotate(-24 120 128)" fill="url(#yunGrad)" opacity="0.19"/></g>';
}

/** 普通摆放：pos='c' 居中满格；pos='t' 靠上 */
function plain(ch, pos, shrink, distort) {
  const box = G.box(ch);
  const bw = Math.max(1, box[2] - box[0]), bh = Math.max(1, box[3] - box[1]);
  const k = (V * 0.76) / Math.max(bw, bh) * shrink;
  let sx = k, sy = k * distort;
  const gw = bw * sx, gh = bh * sy;
  let gx = (V - gw) / 2, gy;
  if (pos === 't') gy = PAD; else gy = (V - gh) / 2;
  return '<g transform="translate(' + (gx - box[0] * sx).toFixed(1) + ',' + (gy - box[1] * sy).toFixed(1)
    + ') scale(' + sx.toFixed(4) + ',' + sy.toFixed(4) + ')">'
    + '<path d="' + G.path(ch) + '" fill="url(#moGrad)" filter="url(#inkMo)"/></g>';
}

/** 裁剪合成：按 keepFrac 只留上半截，再上移到靠上（stroke 粗细与别处一致） */
function cropped(ch, shrink, keepFrac, id) {
  const box = G.box(ch);
  const bw = Math.max(1, box[2] - box[0]), bh = Math.max(1, box[3] - box[1]);
  const k = (V * 0.76) / Math.max(bw, bh) * shrink;
  const gw = bw * k, gh = bh * k;
  const gx = (V - gw) / 2;
  const gy = PAD;                       // 裁完之后的顶边贴在这
  // 原始（未裁）状态下，被保留的部分是高 keepFrac，要把这部分的顶边放到 gy
  const cutY = PAD + gh * keepFrac;     // 裁剪线（在画布里）
  return '<clipPath id="crop' + id + '"><rect x="0" y="0" width="1000" height="'
    + cutY.toFixed(1) + '"/></clipPath>'
    + '<g clip-path="url(#crop' + id + ')">'
    + '<g transform="translate(' + (gx - box[0] * k).toFixed(1) + ',' + (gy - box[1] * k).toFixed(1)
    + ') scale(' + k.toFixed(4) + ')">'
    + '<path d="' + G.path(ch) + '" fill="url(#moGrad)" filter="url(#inkMo)"/></g></g>';
}

/* ── 宋体真 ⺮ 转路径（仅参考）── */
function songtiRadicalPath(cp, outJs) {
  const py = `
import io,json
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.misc.transform import Transform
f=TTFont('/System/Library/Fonts/Supplemental/Songti.ttc', fontNumber=1, lazy=True)
cm=f.getBestCmap()
gs=f.getGlyphSet()
res={}
for cp in [0x2EAE,0x2ED7]:
    if cp not in cm: continue
    gn=cm[cp]
    # 用全字库并集盒的近似：直接取该字形自身盒，缩到 1000 画布 76%
    from fontTools.pens.boundsPen import BoundsPen
    bp=BoundsPen(gs); gs[gn].draw(bp)
    if not bp.bounds: continue
    x0,y0,x1,y1=bp.bounds
    w,h=max(1,x1-x0),max(1,y1-y0)
    k=1000*0.76/max(w,h)
    tf=Transform(k,0,0,-k, 500-(x0+w/2)*k, 500+(y0+h/2)*k)
    pen=SVGPathPen(gs)
    gs[gn].draw(TransformPen(pen,tf))
    res[hex(cp)]=pen.getCommands()
io.open('${outJs}','w',encoding='utf-8').write(json.dumps(res))
print('ok', list(res.keys()))
`;
  fs.writeFileSync('/tmp/_aligndemo/_st.py', py);
  execFileSync('/Users/consli/.workbuddy/binaries/python/envs/default/bin/python', ['/tmp/_aligndemo/_st.py'], { stdio: 'inherit' });
  return JSON.parse(fs.readFileSync(outJs, 'utf8'));
}
const ST = songtiRadicalPath(0, '/tmp/_aligndemo/_st.json');

const CELL = 118;
const COLS = [
  { tag: 'A 现状', sub: '整字「竹」', body: () => plain('竹', 'c', 1, 1) },
  { tag: 'B 整字压扁', sub: '只变形，还是「竹」', body: () => plain('竹', 't', 1, 0.62) },
  { tag: 'C 裁剪合成', sub: '裁掉下半截 · 留 62%', body: () => cropped('竹', 0.72, 0.62, 'c1') },
  { tag: 'C2 裁剪合成', sub: '留 72%', body: () => cropped('竹', 0.72, 0.72, 'c2') },
  { tag: 'D 真偏旁 ⺮', sub: '宋体 · 仅作形状参考', body: () => '<g><path d="' + (ST['0x2eae'] || '')
      + '" fill="url(#moGrad)" filter="url(#inkMo)"/></g>' },
];

const head = '<div class="lbl head"></div>'
  + COLS.map((c) => '<div class="head">' + c.tag + '<em>' + c.sub + '</em></div>').join('');
const cells = [], jobs = [];
cells.push('<div class="lbl"><b>竹</b><span>字头</span><i>箭 = 竹 + 前</i></div>');
for (const c of COLS) {
  cells.push('<div class="cell"><svg viewBox="0 0 1000 1000" width="' + CELL + '" height="' + CELL + '"></svg></div>');
  jobs.push(paper() + c.body());
}

const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:#f6f3ec;font-family:-apple-system,"PingFang SC",sans-serif}
#wrap{padding:20px 24px}
h1{font-size:19px;margin:0 0 4px;color:#2b2a26}
p.sub{font-size:12px;color:#7b776d;margin:0 0 16px;line-height:1.65}
#grid{display:grid;grid-template-columns:120px repeat(5,auto);gap:8px;align-items:center;justify-content:start}
.head{font-size:12px;color:#4a4740;text-align:center;font-weight:600;line-height:1.3}
.head em{display:block;font-style:normal;font-weight:400;font-size:10.5px;color:#8a857a}
.lbl{font-size:11px;color:#5b574e;line-height:1.3}
.lbl b{font-size:18px;color:#2b2a26;display:inline-block;margin-right:5px}
.lbl span{color:#8a857a;margin-right:4px}
.lbl i{font-style:normal;color:#a8a294;font-size:10.5px;display:block}
.cell{box-shadow:0 1px 4px rgba(0,0,0,.14);border-radius:5px;overflow:hidden;line-height:0;justify-self:start}
</style></head><body>
${rd('ink-defs.svg')}
<div id="wrap">
<h1>「竹字头」怎么补 —— 4 条路对比</h1>
<p class="sub">字体（马善政毛笔楷书，OFL）**根本不含** ⺮ / ⻗ 这类偏旁码位，所以只能自己想办&#27861;。<br>
D 是宋体里的真 ⺮，只用来对形状；宋体是系统字体，**不可随产品分发**，不能直接上架用。</p>
<div id="grid">${head}${cells.join('')}</div>
</div>
<script>
var A = ${JSON.stringify(jobs)};
document.querySelectorAll('#grid svg').forEach(function (s, k) { s.innerHTML = A[k]; });
document.title = 'OK/' + A.length;
</script>
</body></html>`;

fs.writeFileSync('/tmp/_aligndemo/demo2.html', html);
console.log('wrote demo2.html');
