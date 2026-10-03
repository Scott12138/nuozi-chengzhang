#!/usr/bin/env python3
"""把 shots/all-pages/ 下的 18 张页面截图拼成一张评审总览图。

【为什么不是简单地网格铺开】
截图的长宽比差得很远：普通页是 860×1800（手机一屏），
图鉴是 860×5272（103 个字的长列表）。若一律等比缩到同一格子里，
图鉴会被压成一条细长条，什么都看不出来。
所以分两种处理：
  · 高 ≤ 2200 → 整张等比缩放，居中放进格子（完整可见）
  · 高 > 2200 → 只取顶部一屏（1740px）代表它，并在标题上标注「长页」

【依赖】Pillow 只装在受管 venv 里：
  /Users/consli/.workbuddy/binaries/python/envs/default/bin/python
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'shots', 'all-pages')
OUT = os.path.join(SRC, '总览-全部页面.png')

CARD_W, CARD_H = 430, 870        # 每格的图片区
BAR_H = 62                       # 标题条
GAP = 18
PAD = 26
COLS = 4
HEAD = 132                       # 顶部大标题区
FOOT = 60

BG = '#e8e2d4'
CARD_BG = '#f7f3e8'
BAR_BG = '#2c3a33'
BAR_FG = '#f2e6c8'
HEAD_FG = '#2b2b28'
HEAD_SUB = '#6d675c'

TALL = 2200                      # 超过这个高度就当「长页」只取首屏


def load_font(size):
    for p in ['/System/Library/Fonts/PingFang.ttc',
              '/System/Library/Fonts/Hiragino Sans GB.ttc',
              '/System/Library/Fonts/STHeiti Medium.ttc']:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()


def fit(im):
    """返回放进 CARD_W×CARD_H 的图（等比、居中留白），以及是否是长页"""
    w, h = im.size
    is_tall = h > TALL
    if is_tall:
        im = im.crop((0, 0, w, 1740))          # 只取首屏
        w, h = im.size
    s = min(CARD_W / w, CARD_H / h)
    im = im.resize((max(1, int(w * s)), max(1, int(h * s))), Image.LANCZOS)
    return im, is_tall


def main():
    man_path = os.path.join(SRC, 'manifest.json')
    with open(man_path, encoding='utf-8') as f:
        man = json.load(f)
    man = [m for m in man if m.get('ok')]
    if not man:
        print('✗ 清单里没有可用截图')
        return 1

    rows = (len(man) + COLS - 1) // COLS
    total_w = PAD * 2 + COLS * CARD_W + (COLS - 1) * GAP
    total_h = HEAD + rows * (BAR_H + CARD_H) + (rows - 1) * GAP + FOOT
    canvas = Image.new('RGB', (total_w, total_h), BG)
    d = ImageDraw.Draw(canvas)

    f_title = load_font(56)
    f_sub = load_font(26)
    f_bar = load_font(30)
    f_bar2 = load_font(22)

    d.text((PAD + 2, 30), '挪字成章 · 全部页面一览（18 张，按手机一屏出图）',
           font=f_title, fill=HEAD_FG)
    d.text((PAD + 6, 96), '对局界面已是水墨牌面；首页 / 选关 / 图鉴 / 结算仍为国风浅色 —— 风格是否统一由你定',
           font=f_sub, fill=HEAD_SUB)

    drawn = []
    for i, m in enumerate(man):
        r, c = divmod(i, COLS)
        x = PAD + c * (CARD_W + GAP)
        y = HEAD + r * (BAR_H + CARD_H + GAP)

        d.rounded_rectangle([x, y, x + CARD_W, y + BAR_H + CARD_H],
                            radius=14, fill=CARD_BG)

        # 标题条：序号 + 名称（长页补一个标注）
        label = m['id']
        is_tall = False
        im = Image.open(os.path.join(SRC, m['file'])).convert('RGB')
        im, is_tall = fit(im)
        d.rounded_rectangle([x, y, x + CARD_W, y + BAR_H], radius=14, fill=BAR_BG)
        d.rectangle([x, y + BAR_H - 14, x + CARD_W, y + BAR_H], fill=BAR_BG)

        name = label.split('-', 1)[1] if '-' in label else label
        num = label.split('-', 1)[0]
        d.text((x + 16, y + 15), num, font=f_bar, fill='#c9a227')
        nw = d.textlength(num, font=f_bar)
        d.text((x + 16 + nw + 12, y + 15), name, font=f_bar, fill=BAR_FG)
        if is_tall:
            tag = '长页·此处为首屏'
            tw = d.textlength(tag, font=f_bar2)
            d.text((x + CARD_W - tw - 14, y + 21), tag, font=f_bar2, fill='#9fb3a6')

        ox = x + (CARD_W - im.width) // 2
        oy = y + BAR_H + max(0, (CARD_H - im.height) // 2)
        canvas.paste(im, (ox, oy))
        drawn.append({'id': label, 'x': x, 'y': y, 'name': name})

    tail = '共 %d 张 · 每一张都用无头浏览器真实渲染（含真实鼠标拖动态）' % len(man)
    tw = d.textlength(tail, font=f_sub)
    d.text(((total_w - tw) // 2, total_h - FOOT + 6), tail, font=f_sub, fill=HEAD_SUB)

    canvas.save(OUT)
    print('✓', OUT, canvas.size, '%d 张' % len(man))

    # 落一份坐标清单，给画廊页做锚点（可选）
    with open(os.path.join(SRC, 'sheet-layout.json'), 'w', encoding='utf-8') as f:
        json.dump(drawn, f, ensure_ascii=False, indent=1)
    return 0


if __name__ == '__main__':
    sys.exit(main())
