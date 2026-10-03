#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Q 版素材抠图入库通用脚本
========================
把「AI 生成的近白底 PNG」批量处理成透明背景、可入库的游戏素材：
1. 从四边 flood-fill 抠掉近白背景（容差自适应：白身主体用更小容差防抠穿）
2. 补回「被不透明完全包围的内部空洞」（防白身动物/角色误挖）
3. 清除孤立噪点小岛
4. alpha 1px 腐蚀去白 halo（MinFilter）
5. 裁剪到主体包围盒 -> 等比缩放最长边 --max-edge（默认 512）
6. 输出 PNG24(optimize) 到输出目录（文件名保持输入名）
7. 打印量化自检表（背景占比/主体岛/空洞/成品KB），便于人工复核

用法:
    python process_assets.py <输入目录> <输出目录> [--max-edge 512] [--skip-list a.png,b.png]

输入目录建议：先用拷贝把超长中文名改为目标资源名（如 pig.png、cowboy_basic_stand.png）
再运行本脚本，输出即对应游戏资源 key。

依赖: Pillow  (pip install Pillow)
"""
import os
import sys
from collections import deque
from PIL import Image, ImageFilter

def flood_bg_mask(im, tol):
    """从四边 BFS 蔓延背景（Chebyshev 距离<=tol 视为同色背景）。返回 bool list: True=背景"""
    w, h = im.size
    px = im.load()
    bg = [False] * (w * h)
    dq = deque()
    for x in range(w):
        dq.append((x, 0)); dq.append((x, h - 1))
    for y in range(h):
        dq.append((0, y)); dq.append((w - 1, y))
    for x, y in dq:
        bg[y * w + x] = True
    while dq:
        x, y = dq.popleft()
        r0, g0, b0 = px[x, y][:3]
        for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            nx, ny = x + dx, y + dy
            if nx < 0 or ny < 0 or nx >= w or ny >= h:
                continue
            i = ny * w + nx
            if bg[i]:
                continue
            r, g, b = px[nx, ny][:3]
            if max(abs(r - r0), abs(g - g0), abs(b - b0)) <= tol:
                bg[i] = True
                dq.append((nx, ny))
    return bg

def label_fg(fg, w, h):
    """给前景连通域编号，返回 (labels, {label: area})，只保留面积>=min_area 的由调用方决定"""
    lab = [0] * (w * h)
    areas = {}
    cur = 0
    for start in range(w * h):
        if not fg[start] or lab[start]:
            continue
        cur += 1
        q = deque([start]); lab[start] = cur; area = 0
        while q:
            i = q.popleft(); area += 1
            x, y = i % w, i // w
            for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                nx, ny = x + dx, y + dy
                if nx < 0 or ny < 0 or nx >= w or ny >= h:
                    continue
                j = ny * w + nx
                if fg[j] and not lab[j]:
                    lab[j] = cur; q.append(j)
        areas[cur] = area
    return lab, areas

def flood_outside(im, fg, tol):
    """以 fg 为墙，从边缘 flood 出真正的外部背景（内部被误抠的浅色区不会算入）"""
    w, h = im.size
    px = im.load()
    bg = [False] * (w * h)
    dq = deque()
    for x in range(w):
        dq.append((x, 0)); dq.append((x, h - 1))
    for y in range(h):
        dq.append((0, y)); dq.append((w - 1, y))
    for x, y in dq:
        if not fg[y * w + x]:
            bg[y * w + x] = True
    while dq:
        x, y = dq.popleft()
        # BFS：以 fg 为墙向外蔓延，颜色与首遍同容差
        r0, g0, b0 = px[x, y][:3]
        for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            nx, ny = x + dx, y + dy
            if nx < 0 or ny < 0 or nx >= w or ny >= h:
                continue
            i = ny * w + nx
            if fg[i] or bg[i]:
                continue
            r, g, b = px[nx, ny][:3]
            if max(abs(r - r0), abs(g - g0), abs(b - b0)) <= tol:
                bg[i] = True
                dq.append((nx, ny))
    return bg

def process_one(path, dst, max_edge):
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    name = os.path.splitext(os.path.basename(path))[0]

    # ── 容差自适应（2026-10-02 重写）─────────────────────────────
    # ★ 旧写法只试 (26, 16)，判据是"前景占比 >= 10%" —— **对浅色层不敏感**。
    #   原因：AI 生成的"纯白底"上，主体与背景之间是**抗锯齿的平滑渐变**，
    #   BFS 会顺着渐变**一路爬进主体**（单步差都小于容差）。主体里越浅的部分
    #   越先被吞：远山、薄雾、奶白机身、浅色花纹……
    #   实例：mount-B「三峰叠影」三座山里两座浅灰蓝(#9AA6AF)被整片吃掉，
    #        只剩最前面那座深色近山 —— 输出变成一个"平顶墨块"。
    #   自检表上看不出来（主体岛 1、空洞 948px，全都"正常"）。
    #
    #   新判据：**盯"再降容差，前景还涨不涨"**。真边界处占比会收敛成一个平台，
    #   而"抠穿"那一档的占比会明显偏小。所以从大到小扫，
    #   取**第一次达到平台**的那一档（= 背景够干净、又还没开始抠穿）。
    CANDS = (26, 20, 16, 13, 11, 9, 7, 5)
    pcts = []
    for t in CANDS:
        bg = flood_bg_mask(im, t)
        pcts.append(sum(1 for b in bg if not b) / float(w * h))
    tol = CANDS[-1]
    scan = ' '.join('%d:%.0f%%' % (t, p * 100) for t, p in zip(CANDS, pcts))
    for i, t in enumerate(CANDS):
        nxt = pcts[i + 1] if i + 1 < len(CANDS) else 0.0
        tol = t
        if pcts[i] >= 0.10 and nxt <= pcts[i] * 1.05:
            break
    bg = flood_bg_mask(im, tol)
    fg = [not b for b in bg]

    # 前景连通域 → 删小岛（<60px 噪点）
    lab, areas = label_fg(fg, w, h)
    keep = {k for k, a in areas.items() if a >= 60}
    if not keep:
        print(f"{name:24s} ✗ 无前景主体，跳过"); return False
    fg2 = [(lab[i] in keep) for i in range(w * h)]

    # 内部空洞补回：真外部背景 = 以 fg2 为墙的边缘 flood；其余透明区为洞 → 变不透明
    ext = flood_outside(im, fg2, tol)
    final = [ (fg2[i] or (not ext[i])) for i in range(w*h) ]
    holes = sum(1 for i in range(w*h) if (not fg2[i]) and (not ext[i]))

    # 主体包围盒
    xs = [i % w for i in range(w*h) if final[i]]
    ys = [i // w for i in range(w*h) if final[i]]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)

    # alpha 构建 + 1px 腐蚀去白 halo
    alpha = Image.new("L", (w, h), 0)
    apx = alpha.load()
    for i in range(w*h):
        if final[i]:
            apx[i % w, i // w] = 255
    alpha = alpha.filter(ImageFilter.MinFilter(3))

    out = im.copy(); out.putalpha(alpha)
    out = out.crop((x0, y0, x1 + 1, y1 + 1))
    ow, oh = out.size
    s = max_edge / max(ow, oh)
    if s < 1:
        out = out.resize((max(1, int(ow*s)), max(1, int(oh*s))), Image.LANCZOS)
    out.save(dst, "PNG", optimize=True)
    kb = os.path.getsize(dst) / 1024
    islands = len(keep)
    bg_pct = (w*h - sum(final)) * 100 // (w*h)
    print(f"{name:24s} tol={tol:>2d} 背景{bg_pct:>3d}% 主体岛{islands} 空洞{holes:>4d}px "
          f"bbox=({x0},{y0})-({x1},{y1}) {out.size} {kb:>6.0f}KB  OK")
    print(f"{'':24s}   tol 扫描 {scan}")
    return True

def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--max-edge=") and a != "--max-edge"]
    # 简化解析：位置参数 前两个 = in out；--max-edge N 可后置
    max_edge = 512
    if "--max-edge" in sys.argv:
        i = sys.argv.index("--max-edge")
        max_edge = int(sys.argv[i+1])
    elif any(a.startswith("--max-edge=") for a in sys.argv):
        max_edge = int([a for a in sys.argv if a.startswith("--max-edge=")][0].split("=")[1])
    pos = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(pos) < 2:
        print("用法: python process_assets.py <输入目录> <输出目录> [--max-edge 512]")
        sys.exit(1)
    in_dir, out_dir = pos[0], pos[1]
    os.makedirs(out_dir, exist_ok=True)

    ok = 0; fail = 0
    files = sorted(f for f in os.listdir(in_dir) if f.lower().endswith((".png", ".jpg", ".jpeg")))
    if not files:
        print(f"输入目录无图片: {in_dir}"); sys.exit(2)
    print(f"{'文件':24s} 处理报告（入库最长边={max_edge}）")
    for f in files:
        src = os.path.join(in_dir, f)
        base = os.path.splitext(f)[0] + ".png"
        dst = os.path.join(out_dir, base)
        if process_one(src, dst, max_edge):
            ok += 1
        else:
            fail += 1
    print(f"\n完成: 成功 {ok} / 失败 {fail} -> {out_dir}")

if __name__ == "__main__":
    main()
