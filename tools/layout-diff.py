#!/usr/bin/env python3
# ============================================================
#  layout-diff.py · 把「设计稿盒模型」与「Cocos 版式转储」逐值对齐
# ============================================================
#  【它解决什么问题】
#  「页面要严格按照设计稿来」这句话，靠截图并排看是验不出来的：
#  肉眼比对的分辨率就是不够（上一版标尺差 4.8%，九页摆在一起才看得出来）。
#  这个脚本把两侧的数字直接相减，误差 > 1 设计 px 就会显出来。
#
#  【两侧数据从哪来】
#   设计稿：tools/design-geometry.mjs 的表格输出（默认 /tmp/design-geom.txt）
#           每行形如 `  .play-top    0    0    372   49    16px ...`
#           —— 坐标已相对 .screen 内容盒，单位=设计 px，可直接用。
#   Cocos：冒烟日志里的 `[Layout] <page> <name> x= y= w= h= db=`
#           —— ui/LayoutDump.ts 输出，x/y/w/h 已换算成设计 px。
#
#  【判据】—— 三种块判法不同，别一把尺子量到底
#   1. 顶锚块（自屏幕顶往下堆）：看 dy、dx、dw、dh，容差 ±TOL。
#   2. 底锚块（自屏幕底往上堆）：看 db（距底距离）、dx、dw、dh。
#      ⚠️ 它们的 dy 天然不为 0 —— 设计舞台 762 高，本工程可见高
#         1280/1.9355 = 661.3 设计px，**两边差 100.7**。拿 dy 判它们是错的。
#   3. 弹性块（FLEX_H，原型 flex:1 吃剩余高度）：h 必然不同（同上那 100.7），
#      **不判 h**，只判顶边 dy / x / w。它们真正的自洽判据在别处：
#      "自身底边 == 下一块顶边 − 间距"，那由页面代码保证。
#
#  【哪些名字进主表】
#   设计稿量出的是**所有**元素（含 .g-word/.ms-empty 这类文字子节点），
#   实现 dump 的是"版式块" —— 两者不必相等。所以主表 = **两侧名字的交集**
#   （设计侧只取 . / # 开头的类名，且归一化掉多 class 如 `.tips.show` → `.tips`）。
#   设计稿量到、实现没 dump 的，落到"未单独输出"附注里（提示，不计红灯）；
#   实现 dump 了、设计稿没量的，落到"实现独有"附注里。
#
#  用法：
#    python3 tools/layout-diff.py <页面名> [设计稿表] [冒烟日志]
#  例：
#    python3 tools/layout-diff.py play /tmp/design-geom.txt /tmp/cz-s5/console.log
# ============================================================

import re
import sys

# 设计稿里每个 screen 的表头形如：
#   #s-play   屏幕 372×762   手机框 390×780    ★ 标尺 = 720/372 = 1.9355
SCREEN_RE = re.compile(r'^#s-(\S+)\s+屏幕\s+(\d+)×(\d+)')
# 元素行：两个空格 + 类名 + 6 个数字 + 其余
ROW_RE = re.compile(
    r'^\s{2}(\S+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(.*)$')
LAYOUT_RE = re.compile(
    r'\[Layout\]\s+(\S+)\s+(\S+)\s+x=(-?[\d.]+)\s+y=(-?[\d.]+)\s+'
    r'w=(-?[\d.]+)\s+h=(-?[\d.]+)\s+db=(-?[\d.]+)')

TOL = 1.0          # 容差（设计 px）
TOL_WIDE = 2.0     # 估宽块的容差：宽度是按字号"估"出来的，与浏览器真实排版天然差零点几

# 设计稿页名 → 本工程 PAGES.ts 里的常量值。
# 原型把对局页叫 #s-play，本工程叫 PAGE_GAME('game') —— 名字不同但同一页。
# 放在这里显式列出，比在两边各起一个别名要清楚：看到这张表就知道哪页对哪页。
PAGE_ALIAS = {
    'boot': 'boot', 'home': 'home', 'chap': 'chap', 'map': 'map',
    'play': 'game', 'clear': 'clear', 'fail': 'fail',
    'atlas': 'atlas', 'set': 'set',
}

# 弹性块：高度由"吃掉剩余空间"决定（原型是 flex:1，本工程是算出来的）。
# 设计舞台 762 高、本工程可见高 1280/1.9355 = 661.3 设计px —— **两边差 100.7**，
# 所以这类块的 h 必然不同，拿 h 去比是错的（会把一个正确的实现判成红灯）。
FLEX_H = {'.board-wrap', '.map-wrap'}

# 宽度不参与判定的块：宽度 = 文本自然宽，实现用固定文本框 + 左对齐，
# 两者不必等宽（差多少都不影响观感：文字从左边开始画）。
W_FREE = {'.play-title'}

# 容差放宽到 TOL_WIDE 的块：宽度 = 按字号估算的文本宽（ui/UIFactory.estWidth），
# 与浏览器真实排版天然有零点几的差。这类差异是**估算方法**的固有误差，
# 不是版式错了 —— 但不能放开不管，所以给个 2px 的宽口径。
W_EST = {'.timer', '.goal-chip'}

# ── 顶部安全区偏移（2026-10-02 用户拍板）──────────────────────────
# 设计稿顶栏的"距屏幕顶"只有 13(play)/16(其余页) —— 那是画在浏览器手机壳里的；
# 真机上这段高度落在状态栏/灵动岛内，微信右上角的胶囊也压在同一行
# （对局页的 .timer 恰好就在那儿）。所以实现改用 CFG.LAYOUT.SAFE_TOP = 56。
#
# 后果：**所有顶锚块的期望 y 都要加 shift = 56 − 设计上距**。
# 不补这一步，一次有意的真机适配会淹没成十几个红灯，真正的 bug 反而看不见了。
SAFE_TOP = 56
TOP_PAD_DESIGN = {'play': 13, 'chap': 16, 'map': 16, 'atlas': 16, 'set': 16}
# 底锚块（自屏幕底往上堆）不受顶部偏移影响 —— 它们的期望 y 不加 shift，
# 判据也只看 db（距底距离），而 db 与 shift 无关。
NO_SHIFT = {'.made-strip', '.tool-bar', '.tool'}
# 顶栏容器本身：安全区只加高了它的**上内距**，所以顶边仍在 y=0，
# 高度则 +shift。拿普通顶锚判据（dy=0 且 dh=0）必然误判成红灯。
TOPBAR = {'.play-top', '.topbar'}

# ── 下面两类块的位置**不是从屏幕顶/底量的**，拿绝对 y 比它们必然出错 ──
# 它们的位置由父块决定，而父块（弹性块）的高度随舞台高变化 100.7 设计px。
# 所以判据换成"相对父块的关系"。
#
# 在父块内**居中**：设计侧 (480−290)/2 = 95，实现侧 (380.3−289.8)/2 = 45.25
# —— 两个数不同，但"都是居中"这个关系一致，这才是该验的东西。
CENTER_IN = {'#board': '.board-wrap'}
# 相对父块的**固定偏移**：.tile 是棋盘里 (0,0) 格的牌，(14.5−12, 226.5−224) = (2.5, 2.5)
OFF_FROM = {'.tile': '#board'}

# ── 位置由"上下居中"策略定的块（2026-10-02 用户拍板，属**有意偏离**设计稿）──
# 设计稿的列表容器是 `flex:1` 顶锚：屏幕多高都往下堆，空白全留在底部。
# 真机比设计舞台高，于是整页看起来"整体偏上"。改成居中后：
#   · 绝对 y 与设计稿本就不同 —— 拿它比会把一次正确的改动判成红灯；
#   · 该验的是"上留白 == 下留白"，即**确实居中了**。
# 边界（屏幕系）：.chap-list 上=顶栏底、下=屏幕底；父块在实现里含安全区，故取实现值。
CENTER_LIST = {'.chap-list'}

# 居中容器里的逐项：绝对 y 由居中策略定，但**步距**是设计稿钉死的。
#   .chap    步距 135 + 12 = 147      .node-row / .node  步距 68 + 10 = 78
# 判定：与"设计稿同名相邻项的步距"一致，且 x / w / h 在容差内。
SAME_NAME_STEP = {'.chap', '.node-row', '.node'}


def center_bounds(name, cocos, vis):
    """居中容器的上下边界（屏幕系，设计px）。父块取**实现**值：它含顶部安全区。"""
    if name == '.chap-list':
        tb = cocos.get('.topbar')
        return (tb[1] + tb[3] if tb else 0.0), vis
    return 0.0, vis


def read_design(path, want):
    """读设计稿几何表 → {元素名: [(x, y, w, h), ...]}

    ★ 坑（已修）：`cur` 必须**直接指向 out**，不能另起一个 {}。
      第一版写成 `cur = {} if stage == want else None`，于是元素全收进了那个
      临时字典，而返回的是 `out` —— 只剩 `__screen__` 一个键，
      脚本永远报"没找到页面 #play"。它是**静默错**：不抛异常，只是看起来
      像"设计稿表里没这个页面"。

    同名元素保留**全部**并按出现顺序排列：设计稿里 .goal-chip 有 4 个、
    .tool 有 3 个，实现侧对应输出 .goal-chip[0..3] / .tool[0..2]，
    靠序号一一对齐（同名的第 i 个 ↔ 实现的 name[i]）。
    """
    out, cur = {}, None
    with open(path, encoding='utf-8') as f:
        for line in f:
            m = SCREEN_RE.match(line)
            if m:
                if m.group(1) == want:
                    out['__screen__'] = (int(m.group(2)), int(m.group(3)))
                    cur = out                     # ← 与 out 同一对象
                else:
                    cur = None
                continue
            if cur is None:
                continue
            if line.startswith('====='):
                continue
            m = ROW_RE.match(line)
            if not m:
                continue
            cls, x, y, w, h = m.group(1), *map(float, m.groups()[1:5])
            # 归一化多 class：`.tips.show` → `.tips`（实现 dump 的是基类名）
            if cls.startswith('.'):
                cls = '.' + cls[1:].split('.')[0]
            cur.setdefault(cls, []).append((x, y, w, h))
    return out.get('__screen__'), {k: v for k, v in out.items() if k != '__screen__'}


def read_cocos(path, want):
    """读冒烟日志里的 [Layout] 行 → {元素名: (x, y, w, h, db)}

    ★ 坑（已修）：LAYOUT_RE 有 7 个捕获组 = (page, name, x, y, w, h, db)。
      第一版写 `m.groups()[2:6]` 取 x,y,w,h（对），但 db 写成了 `m.group(6)`
      —— 那是 **h**。于是 `.made-strip` 的 db 被读成 62（它的高），
      "距底差"凭空多出 −29，底部锚定块全部假红。
    """
    out = {}
    with open(path, encoding='utf-8', errors='replace') as f:
        for line in f:
            m = LAYOUT_RE.search(line)
            if not m:
                continue
            page, name = m.group(1), m.group(2)
            if page != want:
                continue
            out.setdefault(name, (*map(float, m.groups()[2:6]), float(m.group(7))))
    return out


def infer_vis_h(cocos):
    """从 [Layout] 行反推本次运行的可见高（设计px）。

    LayoutDump 打的 db = (可见高 − 上距 − 高) / SCALE，而 y = 上距 / SCALE、
    h = 高 / SCALE，所以 **y + h + db 恒等于 可见高/SCALE**。
    取中位数即可 —— 所有行算出来必然相同（都只差四舍五入）。

    ★ 为什么要反推而不是写死：可见高随视口比例变（661.3 / 781 …），
      写死一个数会让"弹性块"与"距底距离"的判定在换视口后集体失真。
      这是上一次用 720×1280 跑冒烟时漏掉问题的同一类错误。
    """
    vals = sorted(cy + ch + db for (_cx, cy, _cw, ch, db) in cocos.values())
    return vals[len(vals) // 2] if vals else None


def main():
    if len(sys.argv) < 2:
        print('用法: layout-diff.py <页面名> [设计稿表] [冒烟日志]')
        return 2
    want = sys.argv[1]
    design_path = sys.argv[2] if len(sys.argv) > 2 else '/tmp/design-geom.txt'
    cocos_path = sys.argv[3] if len(sys.argv) > 3 else None
    if not cocos_path:
        print('需要冒烟日志路径（其中含 [Layout] 行）')
        return 2

    log_page = PAGE_ALIAS.get(want, want)
    dsize, design = read_design(design_path, want)
    cocos = read_cocos(cocos_path, log_page)
    if not design:
        print(f'✗ 设计稿表里没找到页面 #{want}（可用页名见 {design_path} 的 #s-* 行）')
        return 2
    if not cocos:
        print(f'✗ 日志里没有 [{log_page}] 的 [Layout] 行 —— 该页是否忘了调 dumpLayout()？')
        return 2

    vis = infer_vis_h(cocos)
    shift = SAFE_TOP - TOP_PAD_DESIGN.get(want, SAFE_TOP)
    vis_txt = f'{vis:.1f}' if vis else '?'
    print(f'设计稿 #{want} 舞台 {dsize[0]}×{dsize[1]} 设计px'
          f'　本工程可见高 {vis_txt} 设计px（差 {dsize[1] - vis:+.1f}）')
    print(f'顶部安全区偏移 shift = {shift:+.0f} 设计px'
          f'（安全区 {SAFE_TOP} − 设计稿上距 {TOP_PAD_DESIGN.get(want, 0)}）'
          f'　→ 顶锚块的期望 y 已按此平移；底锚块 {sorted(NO_SHIFT)} 不平移')
    print(f'{"元素":<20}{"设计 x,y,w,h":<30}{"实现 x,y,w,h":<30}'
          f'{"dx":>7}{"dy":>7}{"dw":>7}{"dh":>7}   判定')
    print('-' * 130)

    bad, total = 0, 0
    covered_design, used_cocos = set(), set()

    for name, lst in design.items():
        if not (name.startswith('.') or name.startswith('#')):
            continue          # 无类名的标签（b / span / i / em）不是版式块
        for i, (x, y, w, h) in enumerate(lst):
            key = f'{name}[{i}]' if len(lst) > 1 else name
            got = cocos.get(key)
            if got is None:
                continue      # 未 dump → 落到"未单独输出"附注
            covered_design.add(name)
            used_cocos.add(key)
            total += 1

            cx, cy, cw, ch, db = got
            base = name.split('[')[0]
            # 顶部按安全区平移后的期望 y（底锚块不平移，理由见 NO_SHIFT 的注释）
            y_shift = y if base in NO_SHIFT else y + shift
            dx, dy, dw, dh = cx - x, cy - y_shift, cw - w, ch - h
            db_design = dsize[1] - y - h       # 同舞台高下的"距底距离"（与 shift 无关）
            ddb = db - db_design

            if base in TOPBAR:
                # 顶栏容器：上沿仍在 y=0（只有上内距变大），高度则 +shift
                ok = (abs(dx) <= TOL and abs(cy - y) <= TOL and abs(dw) <= TOL
                      and abs(dh - shift) <= TOL)
                anchor = '顶栏(高随安全区)'
                note = f'　h 设计 {h:g} + shift {shift:g} → 实现 {ch:g}'
            elif base in FLEX_H:
                ok = abs(dy) <= TOL and abs(dw) <= TOL
                anchor = '弹性高(不判h)'
                note = f'　h 设计 {h:g} → 实现 {ch:g}'
            elif base in CENTER_LIST:
                # 居中容器：绝对 y 是算出来的，只验"上下留白相等"
                lo, hi = center_bounds(base, cocos, vis)
                pad_t, pad_b = cy - lo, hi - (cy + ch)
                ok = abs(pad_t - pad_b) <= TOL
                anchor = '居中(上下留白相等)'
                note = (f'　上留白 {pad_t:.1f} / 下留白 {pad_b:.1f}'
                        f'（差 {pad_t - pad_b:+.1f}）'
                        f'　y 设计 {y:g} → 实现 {cy:g}（有意居中，不比 y）')
            elif base in SAME_NAME_STEP and len(lst) > 1:
                # 居中列表里的逐项：只验"步距"与 x / w / h
                if i == 0:
                    ok = abs(dx) <= TOL and abs(dw) <= TOL and abs(dh) <= TOL
                    anchor = '居中列表首项(不比 y)'
                    note = f'　y 设计 {y:g} → 实现 {cy:g}'
                else:
                    d_step = lst[i][1] - lst[i - 1][1]
                    prev = cocos.get(f'{base}[{i - 1}]')
                    got_step = cy - prev[1] if prev else d_step
                    ok = (abs(got_step - d_step) <= TOL and abs(dx) <= TOL
                          and abs(dw) <= TOL and abs(dh) <= TOL)
                    anchor = '步距(位置由居中策略定)'
                    note = f'　步距 设计 {d_step:.1f} / 实现 {got_step:.1f}'
            elif base in CENTER_IN:
                # 在父块内居中：两侧偏移量不同是**必然**的（父块高差 100.7），
                # 该验的是"各自都等于 (父高−自身高)/2"。
                pn = CENTER_IN[base]
                _, py0, _, ph0 = design[pn][0]
                _, pcy, _, pch, _ = cocos[pn]
                d_off, c_off = y - py0, cy - pcy
                exp_d, exp_c = (ph0 - h) / 2, (pch - ch) / 2
                ok = (abs(d_off - exp_d) <= TOL and abs(c_off - exp_c) <= TOL
                      and abs(dx) <= TOL and abs(dw) <= TOL and abs(dh) <= TOL)
                anchor = f'居中于 {pn}'
                note = (f'　偏移 设计 {d_off:.1f}(应 {exp_d:.1f})'
                        f' / 实现 {c_off:.1f}(应 {exp_c:.1f})')
            elif base in OFF_FROM:
                # 相对父块的固定偏移（父块本身可能是居中块，无所谓，只看差值）
                pn = OFF_FROM[base]
                _, py0, _, _ = design[pn][0]
                pcx, pcy = cocos[pn][0], cocos[pn][1]
                d_off, c_off = y - py0, cy - pcy
                ok = (abs(d_off - c_off) <= TOL and abs(dx) <= TOL
                      and abs(dw) <= TOL and abs(dh) <= TOL)
                anchor = f'相对 {pn}'
                note = f'　偏移 设计 {d_off:.1f} / 实现 {c_off:.1f}'
            else:
                tol = TOL_WIDE if base in W_EST else TOL
                free_w = base in W_FREE
                top_ok = (abs(dy) <= tol and abs(dh) <= tol
                          and (free_w or abs(dw) <= tol))
                bot_ok = (abs(ddb) <= tol and abs(dh) <= tol
                          and (free_w or abs(dw) <= tol))
                ok = top_ok or bot_ok
                anchor = ('顶锚' if top_ok and not bot_ok
                          else '底锚' if bot_ok and not top_ok else '顶底均可')
                note = '' if ok else f'　底锚差 {ddb:+.1f}'

            if not ok:
                bad += 1
            mark = '✔' if ok else '✗（超容差）'
            wide = ' 「估宽」' if (base in W_EST or base in W_FREE) else ''
            print(f'{key:<20}{(f"{x},{y},{w},{h}"):<30}'
                  f'{(f"{cx},{cy},{cw},{ch}"):<30}'
                  f'{dx:>7.1f}{dy:>7.1f}{dw:>7.1f}{dh:>7.1f}   {mark} {anchor}{wide}{note}')

    unout = sorted(n for n in design
                   if (n.startswith('.') or n.startswith('#')) and n not in covered_design)
    if unout:
        print('\n设计稿量到、本实现未单独 dump（多为文字子节点，位置由父块的内距+字号决定）：')
        for n in unout:
            x, y, w, h = design[n][0]
            print(f'  {n:<18}x={x} y={y} w={w} h={h}')

    extra = sorted(n for n in cocos if n not in used_cocos)
    if extra:
        print('\n本实现 dump 了、设计稿表里没量到：')
        for n in extra:
            cx, cy, cw, ch, db = cocos[n]
            print(f'  {n:<18}x={cx} y={cy} w={cw} h={ch} db={db}')

    print(f'\n主表 {total} 项，超容差 {bad} 项'
          f'（常规 ±{TOL}、估宽 ±{TOL_WIDE} 设计px）')
    return 0 if bad == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
