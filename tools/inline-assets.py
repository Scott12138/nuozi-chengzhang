#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 design/ 下的渲染资源内联进 prototype/index.html。

【为什么】
原型是「局域网 HTTP + 手机扫码」交付的，必须自包含单文件 ——
否则手机上要么跨域、要么要多服务一个目录。

【幂等】
用 BEGIN/END 标记做替换而不是追加，重复运行不会叠加。
改过 design/ink-tile.js / glyphs-data.js / ink-defs.svg 之后重跑本脚本即可。

用法: python3 tools/inline-assets.py [--check]
"""
import io, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML = os.path.join(ROOT, 'prototype', 'index.html')
D = os.path.join(ROOT, 'design')

JS_FILES = ('glyphs-data.js', 'brush.js', 'ink-tile.js')   # 顺序即依赖顺序
DEFS = 'ink-defs.svg'

JB = '/* ==INLINE-JS-BEGIN== 由 tools/inline-assets.py 注入，勿手改 == */'
JE = '/* ==INLINE-JS-END== */'
DB = '<!-- ==INLINE-DEFS-BEGIN== 由 tools/inline-assets.py 注入，勿手改 -->'
DE = '<!-- ==INLINE-DEFS-END== -->'


def main():
    check = '--check' in sys.argv
    html = io.open(HTML, encoding='utf-8').read()
    rd = lambda f: io.open(os.path.join(D, f), encoding='utf-8').read()

    # node --check 前置：一个注释里的多余花括号就能让整页脚本静默失效
    import subprocess
    NODE = '/Users/consli/.workbuddy/binaries/node/versions/22.22.2-3/bin/node'
    for f in JS_FILES:
        r = subprocess.run([NODE, '--check', os.path.join(D, f)],
                           capture_output=True, text=True)
        if r.returncode != 0:
            print(f'✗ {f} 语法错误：' + r.stderr.strip().split('\n')[0])
            return 1
    print('✓ 三个 JS 语法检查通过')

    js_block = '\n'.join(
        f'/* ── {f} ── */\n' + rd(f) for f in JS_FILES)
    js_new = JB + '\n' + js_block + '\n' + JE
    defs_new = DB + '\n' + rd(DEFS) + '\n' + DE

    # ── 1) JS：插在第一个 <script> 之后（原型只有一个脚本标签）──
    if JB in html:
        html = re.sub(re.escape(JB) + r'.*?' + re.escape(JE), lambda m: js_new,
                      html, count=1, flags=re.S)
        how_js = '替换'
    else:
        i = html.index('<script>') + len('<script>')
        html = html[:i] + '\n' + js_new + '\n' + html[i:]
        how_js = '插入'

    # ── 2) defs：插在 <body> 之后（★ 绝不能放 <head> —— 放 head 会被丢弃，
    #    于是所有 url(#filter) 失效，SVG 元素是「静默不渲染」而不是「忽略滤镜」）──
    if DB in html:
        html = re.sub(re.escape(DB) + r'.*?' + re.escape(DE), lambda m: defs_new,
                      html, count=1, flags=re.S)
        how_defs = '替换'
    else:
        m = re.search(r'<body[^>]*>', html)
        if not m:
            print('✗ 找不到 <body>')
            return 1
        i = m.end()
        html = html[:i] + '\n' + defs_new + '\n' + html[i:]
        how_defs = '插入'

    if check:
        print(f'--check：JS {how_js} / defs {how_defs}，未写文件')
        return 0

    io.open(HTML, 'w', encoding='utf-8').write(html)
    print(f'✓ JS {how_js} / defs {how_defs}')
    print(f'  {HTML}  {os.path.getsize(HTML)/1024:.0f}KB')
    return 0


if __name__ == '__main__':
    sys.exit(main())
