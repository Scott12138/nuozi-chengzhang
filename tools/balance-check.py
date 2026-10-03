#!/usr/bin/env python3
# ============================================================
#  balance-check.py · 量化「画面上下是否均衡」
# ============================================================
#  【它解决什么问题】
#  「内容整体偏上 / 底部空一大片」这种问题，肉眼能感觉到，
#  但说不清差多少 —— 于是改完也不知道有没有真的变好。
#  这个脚本把一张实拍图切成"内容行 / 空白行"，直接给出
#      内容块上沿、下沿、上下留白、以及两者的比值
#  单位一律换算成**设计px**（372 宽），与设计稿同一把尺子。
#
#  【判据为什么用"逐行标准差"】
#  页面底色是带纵向渐变的宣纸色 —— 拿"某一行是否接近纸色"去判内容，
#  渐变本身就会被误判成内容（试过，纸底的亮度从顶到底能变 20 多）。
#  而内容行（文字、卡片边缘、按钮）在**同一行内横向有起伏**，
#  纯背景行则几乎一致。所以取每行横向亮度标准差，背景行天然贴近 0。
#
#  【怎么用】
#   python3 tools/balance-check.py <图> [--frame L,T,R,B] [--thresh K]
#   · --frame  只分析手机框内部（设计稿 PNG 用得上：外面还有一圈深色边框）
#   · --thresh 首档判定系数（默认 0.45）。脚本会从 0.45 → 0.30 → 0.20 → 0.12
#              逐档**自适应降档**，取第一个判定为"均衡"的档位；半透明元素
#              （锁定态卡片）要降到后面的档位才检得出来，见下方 cut 的注释。
#
#   例（实拍整屏）：
#     python3 tools/balance-check.py /tmp/cz-a1/04-p_chap.png
#   例（设计稿 PNG，框在 (40,28)-(819,1399)）：
#     python3 tools/balance-check.py shots/all-pages/04-章节选择.png --frame 40,28,819,1399
#
#  ⚠️ 它是**粗判工具**，只回答"看起来是否均衡"。要精确判定某块的位置，
#     用 tools/layout-diff.py（逐值比对，误差 > 1 设计px 就会显出来）。
#     两者冲突时以 layout-diff 为准。
# ============================================================

import sys
from PIL import Image


def row_stdev(im, box):
    """每行的横向亮度标准差 → [(行号, 标准差)]"""
    l, t, r, b = box
    px = im.load()
    out = []
    step = 2                      # 横向隔点采样，够用且快
    for y in range(t, b):
        vals = []
        for x in range(l, r, step):
            p = px[x, y]
            vals.append((p[0] + p[1] + p[2]) / 3)
        if not vals:
            continue
        m = sum(vals) / len(vals)
        var = sum((v - m) ** 2 for v in vals) / len(vals)
        out.append((y, var ** 0.5))
    return out


def med(xs):
    s = sorted(xs)
    return s[len(s) // 2] if s else 0.0


def main():
    if len(sys.argv) < 2:
        print('用法: balance-check.py <图> [--frame L,T,R,B] [--thresh K]')
        return 2
    path = sys.argv[1]
    box, first_k = None, 0.45
    for i, a in enumerate(sys.argv):
        if a == '--frame' and i + 1 < len(sys.argv):
            box = tuple(int(v) for v in sys.argv[i + 1].split(','))
        if a == '--thresh' and i + 1 < len(sys.argv):
            first_k = float(sys.argv[i + 1])
    thresh_levels = tuple(sorted({first_k, 0.45, 0.30, 0.20, 0.12}, reverse=True))

    im = Image.open(path).convert('RGB')
    W, H = im.size
    if not box:
        box = (0, 0, W, H)
    l, t, r, b = box
    k = 372.0 / (r - l)            # 图px → 设计px

    prof = row_stdev(im, box)
    base = med([v for _, v in prof])
    hi = sorted(v for _, v in prof)[int(len(prof) * 0.9)]
    mx = max(v for _, v in prof)
    # ★ 阈值取「中位 + 幅度的一部分」，而不是「中位的若干倍」：
    #   页面上有一整片 50% 透明的锁定卡（第二章~第四章），它的 std 只比背景高一点，
    #   用倍数法会把最后一张卡整个切掉，于是"内容底"被低估 —— 正是最需要看准的地方。
    #   用幅度法（相对 P90 的增量）能把弱对比行一起收进来。
    #
    # ★★ 再叠一层**自适应降档**（2026-10-02 追加）：
    #   幅度法一个固定系数仍然切不掉半透明卡 —— 章节页实测：版式转储给出
    #   "上留白 54.2 / 下留白 54.3"（完全对称），本脚本却报 `下/上 = 2.36 偏上`。
    #   原因是第 4 张锁定卡（整卡 50% 透明 + 去色）的行 std 落在阈值之下，
    #   连卡带底一起被当成空白，内容底被低估了 ~100 设计px。
    #   所以从宽到严逐档试，取第一个"下留白 ≤ 上留白的 1.6 倍"（即判为均衡）的档位；
    #   全部档位都不行 → 保留最后一档的结果并如实标注。
    #   降档不会把"真偏上"洗成"均衡"：真偏上时无论怎么降，内容底都不会凭空往下长。
    best = None
    for kk in thresh_levels:
        c = base + max(4.0, (hi - base) * kk)
        rr = [y for y, v in prof if v > c]
        if not rr:
            continue
        gt, gb = (rr[0] - t) * k, (b - rr[-1]) * k
        best = (c, rr, gt, gb, kk)
        if gt <= 0.01 or gb <= gt * 1.6:
            break
    if best is None:
        print(f'{path}')
        print('  ✗ 没找到内容行（阈值太高？）')
        return 1
    cut, rows, gap_top, gap_bot, used_k = best
    relaxed = used_k < thresh_levels[0] - 1e-9

    print(f'{path}')
    print(f'  图 {W}×{H}　分析区 {r - l}×{b - t} 图px　1 设计px = {1 / k:.3f} 图px')
    print(f'  逐行横向标准差：中位 {base:.2f}　P90 {hi:.2f}　峰值 {mx:.2f}'
          f'　判定阈值 {cut:.2f}（首档系数 {thresh_levels[0]:g}'
          f'{"，已降到 " + format(used_k, "g") if relaxed else ""}）')

    top, bot = rows[0], rows[-1]
    total = (b - t) * k
    print(f'  内容块：设计 y {gap_top:.1f} .. {total - gap_bot:.1f}'
          f'　（占全高 {(total - gap_top - gap_bot) / total * 100:.0f}%）')
    print(f'  上留白 {gap_top:.1f}　下留白 {gap_bot:.1f}　设计px'
          f'　（可见高 {total:.1f}）')
    if gap_top > 1:
        ratio = gap_bot / gap_top
        verdict = '偏上（下留白过多）' if ratio > 1.6 else '基本均衡'
        tail = ''
        if ratio > 1.6 and used_k <= thresh_levels[-1] + 1e-9:
            tail = '　⚠️ 已降到最严档仍不均衡；若版式转储显示留白对称，以转储为准'
        print(f'  下/上 = {ratio:.2f}　→ {verdict}{tail}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
