#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""出「部件靠边」验收试样图 → docs/verify/S16/试样3-靠边对齐.png

【为什么要有这张图】
「部件靠哪半边」「竹字头裁多少」这两件事，**只有眼睛能拍板**。
数字再对（表里 131 个部件角色齐全、自检全过），也可能看着别扭：
贴上会不会顶到格线？缩到 0.72 之后还认不认得出来？竹字头到底该裁掉几成？
所以这里把真实渲染结果摊开给人看。

【★ 关键：必须用**真的那个渲染器**】
本脚本不重写任何摆位逻辑 —— 它读的是 design/ 下与烘贴图**同一批** JS 文件
（tile-roles.js / glyphs-data.js / brush.js / imagery.js / ink-tile.js / ink-defs.svg）。
试样图上看到的，就是手机里会看到的。重写一份"示意版"是自欺：
它俩迟早漂，而漂的方向永远是"试样好看、真机难看"。

【三节】
  一、单张：每个半边取几个代表部件，并排放在带半边中线的格子里
  二、两格拼读：玩家实际看到的相邻两格（箭 / 弩 / 枪 / 花 / 烛 / 波）
  三、竹字头裁剪比例扫描：0.50~0.74，挑一个最像字头的

用法： python3 tools/make-align-sheet.py [--cell 116] [--out <png>] [--keep-only]
依赖：受管 venv + tools/shot.sh（无头 Chrome）
"""
import io
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, 'design')
OUT_PNG = os.path.join(ROOT, 'docs', 'verify', 'S16', '试样3-靠边对齐.png')
TMP_HTML = '/private/tmp/align-sheet.html'
NODE = '/Users/consli/.workbuddy/binaries/node/versions/22.22.2-3/bin/node'

# ★ 顺序 = script 标签顺序。tile-roles.js 必须在 ink-tile.js 之前。
JS_FILES = ('tile-roles.js', 'glyphs-data.js', 'brush.js', 'imagery.js', 'ink-tile.js')

# 每个半边挑代表 —— 挑的是"玩家最常看到的那几个"，不是随机取。
# 最后一个空位留给对照组：合成字。
ROWS = [
    ('t  贴上（字头）', ['竹', '艹', '宀', '雨', '分']),
    ('b  贴下（字底）', ['弓', '前', '斤', '皿', '羽']),
    ('l  贴左（左偏旁）', ['木', '氵', '钅', '犭', '虫']),
    ('r  贴右（右部件）', ['仓', '刂', '鸟', '马', '月']),
    ('c  居中（无多数派）', ['方', '—']),
    ('①  对照：合成字', ['箭', '弩', '枪', '花', '烛']),
]
# 两格拼读：(上/左 部件, 下/右 部件, 拼成的字, 方向)。木仓/火虫/氵皮 是左右结构。
PAIRS = [
    ('竹', '前', '箭', 'tb'), ('奴', '弓', '弩', 'tb'), ('艹', '化', '花', 'tb'),
    ('木', '仓', '枪', 'lr'), ('火', '虫', '烛', 'lr'), ('氵', '皮', '波', 'lr'),
]
KEEPS = [0.50, 0.56, 0.62, 0.68, 0.74]


def js_str(s):
    return json.dumps(s, ensure_ascii=False)


def html_svg(cell):
    return ('<svg viewBox="0 0 1000 1000" width="%d" height="%d"></svg>' % (cell, cell))


def build_html(cell):
    rd = lambda f: io.open(os.path.join(D, f), encoding='utf-8').read()
    scripts = ''.join('<script>%s</script>' % rd(f) for f in JS_FILES)

    # ── 一节：单张部件 ──
    job1, rows = [], []
    for name, chars in ROWS:
        cells = []
        for c in chars:
            if c == '—':                                   # 占位，保持列对齐
                cells.append('<div class="cell blank"></div>')
                continue
            guide = {'t': 'g-h', 'b': 'g-h', 'l': 'g-v', 'r': 'g-v'}.get(role_stub(c), '')
            cells.append('<div class="cell %s">%s<i>%s</i></div>' % (guide, html_svg(cell), c))
            job1.append('InkTile.svg(%s, %s)' % (js_str(c), OPTS))
        rows.append('<div class="row"><div class="rowh">%s</div>%s</div>' % (name, ''.join(cells)))
    sec1 = '<div class="grid rows" id="sec1">%s</div>' % ''.join(rows)

    # ── 二节：两格拼读 ──
    cells2, job2 = [], []
    for a, b, w, d in PAIRS:
        lr = (d == 'lr')
        vb = '0 0 2000 1000' if lr else '0 0 1000 2000'
        ww, hh = (cell * 2, cell) if lr else (cell, cell * 2)
        cells2.append('<div class="cell pair"><svg viewBox="%s" width="%d" height="%d"></svg>'
                      '<i>%s ＋ %s → %s</i></div>' % (vb, ww, hh, a, b, w))
        off = 'translate(1000,0)' if lr else 'translate(0,1000)'
        job2.append('InkTile.svg(%s, %s) + \'<g transform="%s">\' + InkTile.svg(%s, %s) + \'</g>\''
                    % (js_str(a), OPTS, off, js_str(b), OPTS))

    # ── 三节：竹字头裁剪扫描 ──
    #  这里**故意绕开角色表**：要扫的正是一个还没定下来的参数。
    #  定下来之后写回 tools/gen-tile-roles.py 的 CROP，再重跑。
    cells3, job3 = [], []
    for kk in KEEPS:
        cells3.append('<div class="cell g-h">%s<i>留 %d%%</i></div>'
                      % (html_svg(cell), round(kk * 100)))
        job3.append('(function(){var T=window.TileRoles,old=T.cropMap["竹"];'
                    'T.cropMap["竹"]={from:"top",keep:%s};'
                    'var out=InkTile.svg("竹",{style:"bai",wash:true,seal:true,role:"t",part:true});'
                    'T.cropMap["竹"]=old;return out;})()' % kk)

    return '''<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:#f4f1ea;font-family:-apple-system,"PingFang SC",sans-serif}
#wrap{padding:15px 19px 20px}
h1{font-size:18px;margin:0 0 3px;color:#2b2a26}
p.sub{font-size:11.5px;color:#7b776d;margin:0 0 11px;line-height:1.55}
h2{font-size:13px;margin:15px 0 7px;color:#3b3933;border-left:3px solid #b9b2a2;padding-left:7px}
.grid{display:flex;flex-wrap:wrap;gap:7px;align-items:center}
.row{margin:0 0 5px}
.rowh{width:124px;font-size:11px;color:#4a4740;flex:0 0 auto;line-height:1.3}
.cell{position:relative;line-height:0;box-shadow:0 1px 4px rgba(0,0,0,.15);border-radius:5px;overflow:hidden}
.cell.blank{box-shadow:none}
.cell i{position:absolute;left:0;right:0;bottom:0;font-style:normal;font-size:9.5px;color:#9d978a;
  background:rgba(244,241,234,.84);text-align:center;line-height:1.5}
.cell.pair i{font-size:10px;color:#6f6a5f}
.g-h:after,.g-v:after{content:"";position:absolute;pointer-events:none;
  border-color:#c0392b;border-style:dashed;border-width:0;opacity:.42}
.g-h:after{left:5%%;right:5%%;top:50%%;border-top-width:2px}
.g-v:after{top:5%%;bottom:5%%;left:50%%;border-left-width:2px}
</style></head><body>
%s
<div id="wrap">
<h1>部件「靠边对齐」验收试样 · 用真实渲染器出的（与手机里同一批代码）</h1>
<p class="sub">红线 = 本格中线。部件应整体落在<b>自己那一半</b>。合成字（第 ① 行）保持居中满格作对照。</p>
<h2>一、单张部件：靠哪半边</h2>
%s
<h2>二、两格拼读 —— 玩家真正看到的画面</h2>
<p class="sub" style="margin:-3px 0 6px">两块拼起来能不能读成一个字，是这套口径的最终判据。</p>
<div class="grid" id="sec2">%s</div>
<h2>三、竹字头：裁剪比例扫描（字体里没有 ⺮，只能把「竹」下半截裁掉）</h2>
<p class="sub" style="margin:-3px 0 6px">留得少 → 只剩两个"个"，像两撇；留得多 → 下面的竖又长出来，又变回「竹」。挑最像字头的那个。</p>
<div class="grid" id="sec3">%s</div>
</div>
%s
<script>
var A=%s, B=%s, C=%s;
function fill(sel, arr){ document.querySelectorAll(sel).forEach(function(s,i){ s.innerHTML=arr[i]; }); }
fill('#sec1 svg', A); fill('#sec2 svg', B); fill('#sec3 svg', C);
document.title = 'OK/' + A.length + '/' + B.length + '/' + C.length;
</script>
</body></html>''' % (rd('ink-defs.svg'), sec1, ''.join(cells2), ''.join(cells3), scripts,
                      js_arr(job1), js_arr(job2), js_arr(job3))


def js_arr(arr):
    """把一串 **JS 表达式源码** 拼成数组字面量。

    ★ 这里踩过一次：第一版写成 `'"%s"' % x`，于是生成的是
      `["InkTile.svg(\\"竹\\",...)"]` —— 一个**字符串数组**。
      `s.innerHTML = arr[i]` 拿到的是那行代码的文字，浏览器把它当纯文本 → 画出来是空白牌。
      截图上一片白，代码里一句错都没有。表达式就是表达式，不要给它加引号。
    """
    return '[\n  ' + ',\n  '.join(arr) + '\n]'


# 只是给试样图挑那条红线用；不参与渲染，所以这里查表失败也无所谓
_ROLE_CACHE = {}


def role_stub(ch):
    global _ROLE_CACHE
    if not _ROLE_CACHE:
        js = ("globalThis.window=globalThis;"
              "new Function(require('fs').readFileSync(%s,'utf8'))();"
              "var T=globalThis.TileRoles;console.log(JSON.stringify(T.map));" % js_str(os.path.join(D, 'tile-roles.js')))
        r = subprocess.run([NODE, '-e', js], capture_output=True, text=True)
        _ROLE_CACHE = json.loads(r.stdout) if r.returncode == 0 else {}
    return _ROLE_CACHE.get(ch, 'c')


OPTS = '{style:"bai",wash:true,seal:true}'


def main():
    cell, out_png = 116, OUT_PNG
    args = sys.argv[1:]
    for i, a in enumerate(args):
        if a == '--cell':
            cell = int(args[i + 1])
        elif a == '--out':
            out_png = args[i + 1]

    for fn in JS_FILES:
        r = subprocess.run([NODE, '--check', os.path.join(D, fn)], capture_output=True, text=True)
        if r.returncode != 0:
            print('✗ %s 语法错：%s' % (fn, r.stderr.strip().split('\n')[0]))
            return 1

    html = build_html(cell)
    io.open(TMP_HTML, 'w', encoding='utf-8').write(html)

    os.makedirs(os.path.dirname(out_png), exist_ok=True)
    r = subprocess.run(['bash', os.path.join(ROOT, 'tools', 'shot.sh'), TMP_HTML, out_png,
                        '1400', '1600', '2'], capture_output=True, text=True)
    if r.returncode != 0:
        print('✗ 截图失败：%s' % (r.stderr or r.stdout))
        return 1
    try:
        from PIL import Image
        im = Image.open(out_png)
        print('✓ %s  %d×%d' % (out_png, im.size[0], im.size[1]))
    except Exception:
        print('✓ %s' % out_png)
    return 0


if __name__ == '__main__':
    sys.exit(main())
