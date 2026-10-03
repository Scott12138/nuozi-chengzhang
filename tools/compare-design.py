#!/usr/bin/env python3
"""
============================================================
 compare-design.py · 设计稿 ⇄ Cocos 实拍并排比对
============================================================
【为什么要它】
"严格按照设计稿"这句话落到工程上就是：**同一个元素在两张图上的位置要对得上**。
肉眼来回切换两张图很容易把 4.8% 的整体偏差当成"差不多"（标尺搞错那一次就是这么
滑过去的）。并排 + 统一网格，偏差立刻变成"线压在字上/线偏在字外"，可判定。

【怎么对齐】
设计稿的手机框是 390 宽、带 9px 边框，**屏幕内容盒只有 372×762**（见 CFG.SPEC）。
所以：
  ① 自动找出手机外框（深色 #241F1A）→ 向内 9px 得到屏幕区域 → 裁出来；
  ② 裁出的屏幕按 `720/372` 缩放到 720 宽 —— 与 Cocos 实拍**同宽、同比例**；
  ③ 两张图都画上"每 50 设计px"的横线并标注设计坐标值。
纵向必然不完全重合：设计稿屏高 762，本工程画布 1280 = 661 设计px，
少的那 101px 全部是设计稿里 `margin:auto` / `flex:1` 分掉的**弹性空白**。
横向、字号、行盒、间距这些"硬尺寸"则应当逐像素对齐 —— 那才是这张图要看的东西。

用法：
  python3 tools/compare-design.py <设计稿图> <Cocos实拍> <输出图> [--left 设计稿|实拍]
例：
  python3 tools/compare-design.py shots/all-pages/04-章节选择.png /tmp/s3/02-p_chap.png /tmp/cmp-chap.png
"""
import os
import sys

from PIL import Image, ImageDraw

SCALE = 720 / 372          # 设计px → 屏幕px（与 CFG.SPEC.SCALE 一致）
PHONE_W = 390              # .phone 的外框宽（border-box）
BEZEL = 9                  # 边框厚度
GRID = 50                  # 每 50 设计px 一条参考线
PANEL_W = 720


def find_screen(im):
    """在截图里找到手机屏幕的内容盒矩形 (x0,y0,x1,y1)，单位=图像像素。"""
    px = im.load()
    w, h = im.size
    mid_y = h // 2
    xs = [x for x in range(w) if sum(px[x, mid_y]) < 200]
    if not xs:
        raise SystemExit('✗ 没找到手机深色外框（图里没有 #241F1A 的竖边）')
    mid_x = (xs[0] + xs[-1]) // 2
    ys = [y for y in range(h) if sum(px[mid_x, y]) < 200]
    if not ys:
        raise SystemExit('✗ 没找到手机深色外框（横向）')
    b = round(BEZEL * (xs[-1] - xs[0] + 1) / PHONE_W)   # 按实际缩放换算边框厚度
    return xs[0] + b, ys[0] + b, xs[-1] - b, ys[-1] - b


def fit_width(im, w):
    return im.resize((w, max(1, round(im.height * w / im.width))), Image.LANCZOS)


def add_grid(im, start_note):
    """画参考线并标注设计坐标。返回新图（不原地改，避免污染调用方）。"""
    out = im.copy()
    d = ImageDraw.Draw(out)
    for n in range(0, 900, GRID):
        y = round(n * SCALE)
        if y >= out.height:
            break
        color = (220, 60, 60) if n % 100 == 0 else (200, 140, 140)
        d.line([(0, y), (out.width, y)], fill=color, width=1)
        d.text((4, y + 2), f'{n}', fill=(200, 40, 40))
    d.text((4, 4), start_note, fill=(200, 40, 40))
    return out


def main():
    if len(sys.argv) < 4:
        print(__doc__)
        sys.exit(2)
    src_design, src_shot, dst = sys.argv[1], sys.argv[2], sys.argv[3]

    d = Image.open(src_design).convert('RGB')
    s = Image.open(src_shot).convert('RGB')

    x0, y0, x1, y1 = find_screen(d)
    design_screen = d.crop((x0, y0, x1 + 1, y1 + 1))
    d_design_px = design_screen.width * 372 / (x1 - x0 + 1)
    print(f'设计稿屏幕区域 {design_screen.width}×{design_screen.height}px '
          f'(≈{d_design_px:.0f} 设计px 宽，应为 372)')

    L = fit_width(add_grid(fit_width(design_screen, PANEL_W), f'DESIGN {src_design}'), PANEL_W)
    R = fit_width(add_grid(s, f'COCOS {src_shot}'), PANEL_W)

    H = max(L.height, R.height)
    canvas = Image.new('RGB', (PANEL_W * 2 + 12, H), (24, 24, 26))
    canvas.paste(L, (0, 0))
    canvas.paste(R, (PANEL_W + 12, 0))
    ImageDraw.Draw(canvas).line([(PANEL_W + 5, 0), (PANEL_W + 5, H)], fill=(255, 255, 255), width=2)

    os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)
    canvas.save(dst)
    print(f'✓ 已写出 {dst}  ({canvas.width}×{canvas.height})')


if __name__ == '__main__':
    main()
