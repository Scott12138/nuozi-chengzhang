#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把 design/review.tpl.html 组装成自包含的 design/review.html。
唯一真源：design/ink.css（视觉令牌）+ design/glyph-engine.js（字形引擎）。
评审页必须是单文件——手机、微信里都能直接打开看。
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(p):
    return io.open(os.path.join(ROOT, p), encoding='utf-8').read()


def main():
    tpl = read('design/review.tpl.html')
    css = read('design/ink.css')
    js = read('design/glyph-engine.js')

    for marker, payload in (('<!--INK_CSS-->', css), ('<!--GLYPH_JS-->', js)):
        if marker not in tpl:
            print('模板缺少占位符：' + marker)
            return 1
        tpl = tpl.replace(marker, payload)

    out = os.path.join(ROOT, 'design/review.html')
    io.open(out, 'w', encoding='utf-8').write(tpl)

    left = [m for m in ('<!--INK_CSS-->', '<!--GLYPH_JS-->') if m in tpl]
    print('✓ 已生成 %s（%.0f KB）' % (out, len(tpl.encode('utf-8')) / 1024))
    if left:
        print('✗ 仍有未替换占位符：' + ','.join(left))
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
