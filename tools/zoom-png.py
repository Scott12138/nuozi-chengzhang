#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
截图局部放大 —— 把某一块裁出来放大看。

为什么要它：76px 的牌面在整屏截图里只有指甲盖大，「这个偏旁到底长什么样」
根本看不清。评审字形时（尤其「犭」这类容易被看成别的字的偏旁）必须放大。

依赖在受管 venv 里：
  /Users/consli/.workbuddy/binaries/python/envs/default/bin/python

用法：
  python3 tools/zoom-png.py 输入.png 输出.png --x 158 --y 570 --w 667 --h 105 --zoom 3
  坐标是**原图像素**。不传 --w/--h 时默认取全图的中间一块。
"""
import argparse
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit('需要 Pillow：/Users/consli/.workbuddy/binaries/python/envs/default/bin/pip install pillow')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('dst')
    ap.add_argument('--x', type=int, default=None)
    ap.add_argument('--y', type=int, default=None)
    ap.add_argument('--w', type=int, default=None)
    ap.add_argument('--h', type=int, default=None)
    ap.add_argument('--zoom', type=float, default=3.0)
    a = ap.parse_args()

    im = Image.open(a.src)
    W, H = im.size
    w = a.w or W // 2
    h = a.h or H // 4
    x = a.x if a.x is not None else (W - w) // 2
    y = a.y if a.y is not None else (H - h) // 3
    x = max(0, min(x, W - 1)); y = max(0, min(y, H - 1))
    w = min(w, W - x); h = min(h, H - y)

    box = im.crop((x, y, x + w, y + h))
    # NEAREST：像素级放大，不做插值平滑 —— 我们要的是「笔画的断面长什么样」
    out = box.resize((int(w * a.zoom), int(h * a.zoom)), Image.NEAREST)
    out.save(a.dst)
    print('原图 %dx%d → 裁 (%d,%d %dx%d) ×%.1f → %s (%dx%d)' %
          (W, H, x, y, w, h, a.zoom, a.dst, out.size[0], out.size[1]))


if __name__ == '__main__':
    main()
