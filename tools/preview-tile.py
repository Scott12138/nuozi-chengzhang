#!/usr/bin/env python3
"""水墨牌面 · 单牌检视页（大尺寸看细节）

用法: preview-tile.py <输出html> [--size 520] [--style bai|ge] [--nowash] [--noseal] <字...>

为什么单独做一个：牌面上真正要看的东西（帘纹、墨韵的浓淡与飞白、朱印的形状）
在 76px 的实尺寸下全都看不见。这张页把牌放大到 400~600px，
才能判断「像不像一张宣纸」，而不是「像不像一个带边框的卡片」。

自检约定：页面把结果写进 document.title —— OK/<n>牌/<n>路径，出错则 ERR: 消息。
（因为 SVG 里 filter 引用一旦失效，元素会**静默不渲染**，光看截图会误判成"样式没生效"。）
"""
import io, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, 'design')
NODE = '/Users/consli/.workbuddy/binaries/node/versions/22.22.2-3/bin/node'
JS_FILES = ('glyphs-data.js', 'brush.js', 'imagery.js', 'ink-tile.js')


def main():
    argv = sys.argv[1:]
    # 逐个消费参数：带值的 flag 要把后面那个 token 一起吃掉，
    # 否则「--size 460」里的 460 会被当成一个汉字，凭空多渲染一张空牌。
    pos, flags, i = [], {}, 0
    VALUED = ('--size', '--style')
    while i < len(argv):
        a = argv[i]
        if a in VALUED:
            flags[a] = argv[i + 1]; i += 2; continue
        if a.startswith('--'):
            flags[a] = True; i += 1; continue
        pos.append(a); i += 1

    out = pos[0]
    chars = pos[1:] or list('木枪梅火竹艹')
    size = int(flags.get('--size', 520))
    style = flags.get('--style', 'bai')
    wash = not flags.get('--nowash')
    seal = not flags.get('--noseal')

    for fn in JS_FILES:
        r = subprocess.run([NODE, '--check', os.path.join(D, fn)], capture_output=True, text=True)
        if r.returncode != 0:
            print(f'✗ {fn}: ' + r.stderr.strip().split('\n')[0])
            sys.exit(1)

    rd = lambda f: io.open(os.path.join(D, f), encoding='utf-8').read()
    js = [rd(f) for f in JS_FILES]
    cells = ''.join(f'<div class="w"><svg class="t" viewBox="0 0 1000 1000" data-ch="{c}"></svg>'
                    f'<div class="lb">{c}</div></div>' for c in chars)

    opt = "{style:'%s',wash:%s,seal:%s}" % (style, str(wash).lower(), str(seal).lower())
    html = f'''<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>挪字成章 · 单牌检视</title><style>
body{{margin:0;padding:26px;background:#ded7c6;font-family:"Kaiti SC","STKaiti","Songti SC",serif}}
.row{{display:flex;gap:24px;flex-wrap:wrap;justify-content:center}}
.w{{text-align:center}}
.t{{width:{size}px;height:{size}px;display:block;box-shadow:0 2px 10px rgba(50,40,25,.30)}}
.lb{{margin-top:8px;font-size:15px;color:#5a5347;letter-spacing:.2em}}
</style></head><body>
{rd('ink-defs.svg')}
<div class="row">{cells}</div>
<script>{js[0]}</script><script>{js[1]}</script><script>{js[2]}</script><script>{js[3]}</script>
<script>
try{{
  var ns=document.querySelectorAll('svg.t');
  for(var i=0;i<ns.length;i++){{ ns[i].innerHTML = InkTile.svg(ns[i].dataset.ch, {opt}); }}
  document.title = 'OK/'+ns.length+'牌/'+document.querySelectorAll('svg.t path').length;
}}catch(e){{ document.title='ERR: '+(e&&e.message||e); }}
</script>
</body></html>'''
    io.open(out, 'w', encoding='utf-8').write(html)
    print(f'✓ {out}')


if __name__ == '__main__':
    main()
