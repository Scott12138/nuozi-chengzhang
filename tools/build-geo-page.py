#!/usr/bin/env python3
"""渲染带坐标网格的字形大字图，用于精确摆放物象笔触。

用法: build-geo-page.py <输出html> <字...> [--cell 620] [--cols 2]
"""
import io, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, 'design')


def read(fn):
    return io.open(os.path.join(D, fn), encoding='utf-8').read()


def main():
    argv = sys.argv[1:]
    flags, pos, i = {}, [], 0
    while i < len(argv):
        a = argv[i]
        if a.startswith('--'):
            if '=' in a:
                k, _, v = a.partition('=')
                flags[k] = v
            else:
                flags[a] = argv[i + 1] if i + 1 < len(argv) else ''
                i += 1
        else:
            pos.append(a)
        i += 1
    out, chars = pos[0], pos[1:]
    cell = flags.get('--cell', '600')
    cols = flags.get('--cols', '2')

    css, defs = read('ink.css'), read('ink-defs.svg')
    G, B, I = read('glyphs-data.js'), read('brush.js'), read('imagery.js')

    grid_js = '''
var NS='http://www.w3.org/2000/svg';
document.querySelectorAll('.geo').forEach(function(host){
  var ch=host.dataset.ch;
  var s=document.createElementNS(NS,'svg');
  s.setAttribute('viewBox','0 0 1000 1000'); s.setAttribute('class','art');
  var g='';
  for(var i=0;i<=10;i++){
    var v=i*100, w=(i%5===0)?3:1.2, c=(i%5===0)?'rgba(90,110,130,.42)':'rgba(90,110,130,.20)';
    g+='<line x1="'+v+'" y1="0" x2="'+v+'" y2="1000" stroke="'+c+'" stroke-width="'+w+'"/>';
    g+='<line x1="0" y1="'+v+'" x2="1000" y2="'+v+'" stroke="'+c+'" stroke-width="'+w+'"/>';
  }
  g+='<line x1="500" y1="0" x2="500" y2="1000" stroke="rgba(190,50,50,.40)" stroke-width="3.4"/>';
  g+='<line x1="0" y1="500" x2="1000" y2="500" stroke="rgba(190,50,50,.40)" stroke-width="3.4"/>';
  g+='<path class="mo" d="'+(InkGlyphs.path(ch)||'')+'"/>';
  g+='<circle cx="500" cy="500" r="5" fill="rgba(190,50,50,.55)"/>';
  s.innerHTML=g;
  host.appendChild(s);
});
'''

    cells = ''.join(
        f'<div class="c"><div class="geo pad" data-ch="{c}"></div>'
        f'<div class="lbl">{c}　（每格 100 单位）</div></div>' for c in chars)

    html = f'''<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><style>
{css}
body{{margin:0;padding:24px;font-family:var(--kai);}}
.grid{{display:grid;grid-template-columns:repeat({cols},1fr);gap:22px;max-width:{int(cell)}px;margin:0 auto}}
.c{{text-align:center}}
.pad{{width:100%;aspect-ratio:1;position:relative;background:var(--zhi-1);box-shadow:0 0 0 1px rgba(120,110,86,.30)}}
.art{{width:100%;height:100%;display:block;overflow:visible}}
.mo{{fill:#1b1d22}}
.lbl{{margin-top:6px;font-size:14px;color:var(--mo-3)}}
</style></head><body class="paper">
{defs}
<div class="grid">{cells}</div>
<script>{G}</script><script>{B}</script><script>{I}</script>
<script>{grid_js}</script>
</body></html>'''
    io.open(out, 'w', encoding='utf-8').write(html)
    print(f'✓ {out}')


if __name__ == '__main__':
    main()
