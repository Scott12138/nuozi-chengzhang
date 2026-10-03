#!/usr/bin/env python3
"""把产出的 PDF 逐页渲染成图，用来「真的看一眼」而不是只看文件大小。

为什么必须这么做：Chrome 的打印管线在页面高度算错时会**悄悄多出空白页**，
或者把某张图挤到下一页 —— 文件照样非空、页数甚至可能看着正常。
只有把每一页画出来才能确认「14 页 = 封面 + 13 页内容，每页都是满的」。

依赖：pypdfium2（受管 venv 里已有）。
用法： verify-pdf.py <pdf> [输出目录]
"""
import os
import sys

import pypdfium2 as pdfium
from PIL import Image, ImageDraw, ImageFont

SCALE = 1.4          # 渲染倍率：A4 595×842pt → 约 833×1179px


def load_font(sz):
    for p in ('/System/Library/Fonts/PingFang.ttc',
              '/System/Library/Fonts/Hiragino Sans GB.ttc'):
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, sz)
            except Exception:
                pass
    return ImageFont.load_default()


def main():
    pdf_path = sys.argv[1]
    outdir = sys.argv[2] if len(sys.argv) > 2 else '/tmp/pdfpages'
    os.makedirs(outdir, exist_ok=True)

    doc = pdfium.PdfDocument(pdf_path)
    n = len(doc)
    pages = []
    for i in range(n):
        im = doc[i].render(scale=SCALE).to_pil()
        p = os.path.join(outdir, 'p%02d.png' % (i + 1))
        im.save(p)
        pages.append(im)
        # 空白页探测：算像素标准差，全白页 std ≈ 0
        g = im.convert('L')
        px = list(g.getdata())
        mean = sum(px) / len(px)
        var = sum((v - mean) ** 2 for v in px) / len(px)
        ink = sum(1 for v in px if v < 240) / len(px)
        print('p%02d  %4d×%4d  std=%6.2f  着墨=%.1f%%  %s'
              % (i + 1, im.width, im.height, var ** .5, ink * 100,
                 '⚠ 疑似空白' if ink < 0.02 else 'ok'))

    # ── 拼一张联络表，一眼扫 14 页 ──
    cols = 5
    rows = (n + cols - 1) // cols
    tw = 360
    th = int(tw * pages[0].height / pages[0].width)
    gap, top = 14, 58
    sheet = Image.new('RGB', (cols * tw + gap * (cols + 1),
                              top + rows * th + gap * (rows + 1)), '#e8e2d4')
    d = ImageDraw.Draw(sheet)
    d.text((gap + 4, 18), '挪字成章 · 界面设计 PDF —— 共 %d 页' % n,
           font=load_font(26), fill='#2b2b28')
    for i, im in enumerate(pages):
        r, c = divmod(i, cols)
        t = im.resize((tw, th), Image.LANCZOS)
        x = gap + c * (tw + gap)
        y = top + gap + r * (th + gap)
        sheet.paste(t, (x, y))
        d.rectangle([x - 1, y - 1, x + tw, y + th], outline='#b0a68e')
        d.text((x + 3, y + th + 2), 'P%02d' % (i + 1), font=load_font(15), fill='#6d675c')

    sheet_path = os.path.join(outdir, '联络表.png')
    sheet.save(sheet_path)
    print('✓', sheet_path, sheet.size)
    return 0


if __name__ == '__main__':
    sys.exit(main())
