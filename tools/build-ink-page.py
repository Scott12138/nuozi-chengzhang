#!/usr/bin/env python3
"""构建水墨字形预览页（单文件，内联 CSS/JS/字形数据）。

用法:
  build-ink-page.py <输出html> <字1> <字2> ... [--no-obj] [--title 标题]

会先对 design/*.js 做语法检查 —— 语法错会让整页静默空白，必须前置拦住。
"""
import io, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, 'design')
NODE = '/Users/consli/.workbuddy/binaries/node/versions/22.22.2-3/bin/node'


def check_js():
    for fn in ('glyphs-data.js', 'brush.js', 'imagery.js'):
        p = os.path.join(D, fn)
        r = subprocess.run([NODE, '--check', p], capture_output=True, text=True)
        if r.returncode != 0:
            print(f'✗ {fn} 语法错误：')
            print(r.stderr.strip().split('\n')[0:6])
            sys.exit(1)
    print('✓ design/*.js 语法检查通过')


def read(fn):
    return io.open(os.path.join(D, fn), encoding='utf-8').read()


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    flags = [a for a in sys.argv[1:] if a.startswith('--')]
    out = args[0]
    chars = args[1:]
    show_obj = '--no-obj' not in flags
    show_grid = '--grid' in flags

    check_js()
    css, defs = read('ink.css'), read('ink-defs.svg')
    js = [read('glyphs-data.js'), read('brush.js'), read('imagery.js')]

    def cell(ch, cls):
        return f'<div class="c"><div class="pad"><svg class="{cls}" viewBox="0 0 1000 1000" data-ch="{ch}"></svg></div><div class="lbl">{ch}</div></div>'

    big = ''.join(cell(c, 'art') for c in chars)
    small = ''.join(
        f'<div class="sz"><div class="tile"><svg class="art2" viewBox="0 0 1000 1000" data-ch="{c}"></svg></div>'
        f'<div class="lbl">{c}</div></div>' for c in chars)

    paint = f'''
var NS='http://www.w3.org/2000/svg';
var GRID = {str(show_grid).lower()};
function gridSVG(){{
  var g='';
  for(var i=0;i<=10;i++){{
    var v=i*100, w=(i%5===0)?3:1.2, c=(i%5===0)?'rgba(90,110,130,.42)':'rgba(90,110,130,.20)';
    g+='<line x1="'+v+'" y1="0" x2="'+v+'" y2="1000" stroke="'+c+'" stroke-width="'+w+'"/>';
    g+='<line x1="0" y1="'+v+'" x2="1000" y2="'+v+'" stroke="'+c+'" stroke-width="'+w+'"/>';
  }}
  return g;
}}
function paint(svg){{
  var ch=svg.dataset.ch, d=InkGlyphs.path(ch)||'', s='';
  if(GRID) s += gridSVG();
  if({str(show_obj).lower()} && InkImagery.has(ch)) s += '<g class="obj">'+InkImagery.back(ch)+'</g>';
  s += '<path class="mo" d="'+d+'"/>';
  if({str(show_obj).lower()} && InkImagery.has(ch)) s += '<g class="obj2">'+InkImagery.front(ch)+'</g>';
  svg.innerHTML = s;
}}
try {{ document.querySelectorAll('.art,.art2').forEach(paint); }}
catch(e) {{ document.title='ERR: '+(e&&e.message||e); }}
'''

    html = f'''<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><style>
{css}
body{{margin:0;padding:24px 30px 40px;font-family:var(--kai);}}
h2{{font-size:16px;font-weight:400;color:var(--mo-3);margin:24px 0 12px;letter-spacing:.14em}}
h2 b{{color:var(--mo-1);font-weight:700}}
.grid{{display:grid;grid-template-columns:repeat({min(len(chars),7)},1fr);gap:16px}}
.c{{text-align:center}}
.pad{{width:100%;aspect-ratio:1;background:var(--zhi-1);box-shadow:0 0 0 1px rgba(120,110,86,.22)}}
.art{{width:100%;height:100%;display:block;overflow:visible}}
.mo{{fill:url(#moGrad);filter:url(#inkMo)}}
.obj path{{filter:url(#inkWu)}}
.obj2 path{{filter:url(#inkWu)}}
.sizes{{display:grid;grid-template-columns:repeat({min(len(chars),8)},1fr);gap:16px;align-items:start}}
.sz{{text-align:center}}
.tile{{aspect-ratio:1;background:var(--zhi-2);border-radius:4px;display:flex;align-items:center;justify-content:center;
      padding:4%;box-shadow:0 0 0 1px rgba(120,110,86,.30)}}
.art2{{width:100%;height:100%;display:block;overflow:visible}}
.art2 path.mo{{filter:url(#inkMini)}}
.art2 .obj path{{filter:url(#inkMini)}}
.art2 .obj2 path{{filter:url(#inkMini)}}
.lbl{{margin-top:5px;font-size:14px;color:var(--mo-3)}}
</style></head><body class="paper">
{defs}
<h2>墨字 + <b>物象</b>（1000 网格 · 原大）</h2>
<div class="grid">{big}</div>
<h2>字牌尺寸（约 76px）</h2>
<div class="sizes">{small}</div>
<script>{js[0]}</script><script>{js[1]}</script><script>{js[2]}</script>
<script>{paint}</script>
</body></html>'''
    io.open(out, 'w', encoding='utf-8').write(html)
    print(f'✓ {out}  ({len(html)/1024:.0f}KB, {len(chars)} 字)')


if __name__ == '__main__':
    main()
