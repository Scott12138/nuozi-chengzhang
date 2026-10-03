#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""部件「靠哪半边」表生成器 → design/tile-roles.js

【要解决的是什么】
2026-10-03 用户提的：
  「偏旁和部首要靠边，比如竹字头，不要以竹字来表示，别人看不懂，
    而且要放在格子的上半部分，比如弓字，要靠格子的下半部分，
    类似的字体都要重新渲染」

也就是说：一张牌上画的是「部件」时，它应该**靠向它在合成字里占的那半边** ——
竹字头贴上、弓贴下、木贴左、仓贴右。而要"靠哪半边"是一份**数据**，
不能靠渲染时猜。本脚本就是把这份数据算出来、写死、并留下可审计的推导过程。

------------------------------------------------------------
【为什么不能手写这张表】
------------------------------------------------------------
153 个部件、145 个合成字。手写的翻车方式有两种，且**都不报错**：
  · 漏一个 → 那个部件渲染成居中（看起来像"整字"，正是用户抱怨的观感），无人发现；
  · 写反一个（木写成贴上）→ 只是"感觉哪里不对"，肉眼很难定位到是哪一行数据。
所以：表由本脚本从**真实字形**里测出来，人只对"测不准的那几个"出修正，并把
修正理由逐条写在下面。这样任何一个条目都能追溯它是怎么来的。

------------------------------------------------------------
【怎么测：两条独立的证据，而不是一条启发式】
------------------------------------------------------------
证据①「投影谷」—— 上下结构的合成字，在腰部有一条横向的低墨带；
                    左右结构则有一条纵向的低墨带。谁更低，谁就是分界线。
   ✗ 不够用：笔画交错时会误判（波、弧、靶 都被它判反过）。

证据②「模板匹配」—— 这是主判据，也是"真比对"：
                    把合成字按分界线切成两个半块，两个半块各自与 a、b **单独**的
                    字形比形状（都归一化到 128×128 再算 IoU）；
                    切法试 4 种（a上b下 / b上a下 / a左b右 / b左a右），总分最高的胜出。
                    这一条同时回答了「上下还是左右」和「a 在哪半边」两个问题。

★ 一条被否掉的路，别再走回去：
  曾经想用「a 的墨迹宽度 / b 的墨迹宽度 ≈ 分界线位置」来判 —— **信息量为零**。
  因为 a、b 单独渲染时各自都撑满 em 框，两个都是"接近满格"，比值恒 ≈ 0.5，
  与它们在合成字里真实占多少毫无关系。实测就是这么废掉的。

------------------------------------------------------------
【测出来之后：怎么从「字」回到「部件」】
------------------------------------------------------------
渲染是按**字符**走的（一张 t_<码位>.png），而结构是**字**的属性。
所以要把 145 个字的结论汇总回 153 个部件：

  木：在 29 个字里是 'l'（枪棍棒杖…），在 2 个字里是 't'（杏、李）
      → 一个字符只能烘一张图 ⇒ 取**多数派** 'l'。

  仓：枪里是 'r'、苍里是 'b' —— **1 : 1 平票**，没有多数派。
      → 归 'c'（居中）。理由：一旦宣称某半边，就有一半的场合是错的；
        居中不宣称任何半边，是"不知道就不猜"。
        平票的只有 5 个：仓 我 方 每 连。

------------------------------------------------------------
【用法 / 依赖】
------------------------------------------------------------
    python3 tools/gen-tile-roles.py            # 重新推导并覆写 design/tile-roles.js
    python3 tools/gen-tile-roles.py --dry      # 只打印结论，不写文件

依赖：受管 venv（Pillow + numpy）+ 主字体
  ~/.workbuddy/binaries/python/envs/default/bin/python
字体不在仓库里（5.8MB 且 OFL 只要求随产品附许可证，不必随仓库）。
本机若已丢失，按下面的命令取回（jsDelivr 走 GitHub 的 google/fonts 镜像；
直连 raw.githubusercontent.com 在本机被拦，别用那条）：

    mkdir -p /tmp/ink-font/msj && curl -sSL -o /tmp/ink-font/msj/msj.ttf \\
      "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/mashanzheng/MaShanZheng-Regular.ttf"

★ 为什么必须用**主字体**本身（而不是 design/glyphs-data.js 的轮廓）：
  轮廓数据是归一化后的路径，要判定结构就得先把它栅格化 —— 那等于在本脚本里
  再写一个路径光栅器。直接用字体渲染是最短路径，且和 glyphs-data.js 同源同形。
"""
import io
import json
import os
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'design', 'tile-roles.js')
PROTO = os.path.join(ROOT, 'prototype', 'index.html')
FONT = '/tmp/ink-font/msj/msj.ttf'
NODE = '/Users/consli/.workbuddy/binaries/node/versions/22.22.2-3/bin/node'

SIZE = 420          # 渲染字号（像素）
N = 128             # 归一化比对尺寸
IOU_INK = 200       # 灰度 < 此值算"有墨"

# ------------------------------------------------------------
#  ★ 人工修正集（模板匹配在下面这 4 个字上判错，只改这 4 个）
#
#  判据是"匹配分数差（margin）"：margin 越小说明两个假设分数越接近、越不可信。
#  下面 4 个的 margin 都 ≤0.02（其余 141 个字的中位 margin 是 0.30）。
#  每一条都注明了为什么人工判的是对的 —— 光写"判错了"等于没写。
# ------------------------------------------------------------
OVERRIDE = {
    '莲': ('tb', True),    # 艹 + 连。判成 lr（margin 0.02）。艹 是字头，只能在上。
    '房': ('tb', True),    # 户 + 方。判成 lr（margin 0.02）。户 在此是字头（户在上的房字头）。
    '扉': ('tb', True),    # 户 + 非。判成 bt 且 a_first=False（margin 0.01），两个都反了。
    '蓉': ('tb', True),    # 艹 + 容。判成 bt 且 a_first=False。同上，艹 只能在上。
}

# 竹是唯一一个「独立字形与偏旁形态差得肉眼认不出」的部件：
# 字体里没有 ⺮（U+2EAE，实测已确认不在 msj 的 7015 个码位里），
# 所以竹字头只能**裁剪合成** —— 把「竹」的下半截切掉，留上半截。
# 其余部件（艹 宀 氵 钅 犭 纟 刂 …）字体里本来就是偏旁形态，不需要处理。
CROP = {
    '竹': {'from': 'top', 'keep': 0.62},
}


# ────────────────────────── 1. 读源数据 ──────────────────────────
#  ★ 为什么走 node 求值而不是 Python 正则抠字面量：
#    正则抠 JS 字面量"少匹配一层括号"是**静默**的（不会报错，只会少几个字）。
#    这里沿用 tools/gen-cocos-leveldata.js 已经验证过的 sliceLiteral 思路，
#    让 node 把 WORDS 与 LEVELS 求值成 JSON 再交给 Python。
_DUMP_JS = r'''
const fs=require('fs'),vm=require('vm');
const html=fs.readFileSync(process.argv[1],'utf8');
function sl(n){
  const h='const '+n+' = ';const i=html.indexOf(h);
  if(i<0)throw new Error('原型里找不到 '+n);
  const s=i+h.length,o=html[s],c={'{':'}','[':']'}[o];
  let d=0,q=null;
  for(let k=s;k<html.length;k++){
    const ch=html[k];
    if(q){if(ch==='\\'){k++;continue;}if(ch===q)q=null;continue;}
    if(ch==="'"||ch==='"'||ch==='`'){q=ch;continue;}
    if(ch===o)d++;else if(ch===c){d--;if(!d)return html.slice(s,k+1);}
  }
  throw new Error(n+' 括号不配平');
}
const ev=n=>vm.runInContext('('+sl(n)+')',vm.createContext({}));
process.stdout.write(JSON.stringify({WORDS:ev('WORDS'),LEVELS:ev('LEVELS')}));
'''


def load_proto():
    """→ (words 有序列表 [(字, a, b)], 每个字的关卡出现次数 occ)"""
    r = subprocess.run([NODE, '-e', _DUMP_JS, PROTO], capture_output=True, text=True)
    if r.returncode != 0 or not r.stdout.strip():
        print('✗ 从原型抽 WORDS/LEVELS 失败：%s' % (r.stderr.strip() or '无输出'))
        sys.exit(1)
    d = json.loads(r.stdout)
    words = [(w, v['a'], v['b']) for w, v in d['WORDS'].items()]
    occ = {}
    for lv in d['LEVELS']:
        for w in lv['words']:
            occ[w] = occ.get(w, 0) + 1
    return words, occ


# ────────────────────────── 2. 栅格与形状比对 ──────────────────────────
def raster(ch, font):
    """渲染单字 → 只含墨迹的布尔矩阵（已按包围盒收紧）"""
    img = Image.new('L', (SIZE * 2 + 60,) * 2, 255)
    ImageDraw.Draw(img).text((SIZE // 2, SIZE // 2), ch, font=font, fill=0)
    a = np.array(img) < IOU_INK
    ys, xs = np.where(a)
    if len(xs) == 0:
        return np.zeros((2, 2), bool)
    return a[ys.min():ys.max() + 1, xs.min():xs.max() + 1]


def norm(m):
    """裁空白 → 各向异性拉伸到 N×N。
    单字与半块必须走同一个归一化口径，否则"比较形状"这件事本身就不成立。"""
    if m.size == 0 or m.sum() == 0:
        return np.zeros((N, N), bool)
    return np.array(Image.fromarray((m * 255).astype(np.uint8)).resize((N, N), Image.BILINEAR)) > 96


def iou(x, y):
    u = (x | y).sum()
    return float((x & y).sum()) / u if u else 0.0


def tight(x):
    ys, xs = np.where(x)
    return x[ys.min():ys.max() + 1, xs.min():xs.max() + 1] if len(xs) else x


def match_struct(mw, na, nb):
    """4 种切法里挑总分最高的那个 → (结构, a 是否在上/左, 分数, 次选分数)"""
    out = []
    for axis, a_first, tag in ((0, True, 'tb'), (0, False, 'bt'), (1, True, 'lr'), (1, False, 'rl')):
        best = -1.0
        n = mw.shape[axis]
        for frac in np.arange(0.34, 0.67, 0.02):
            k = max(1, min(n - 1, int(round(n * float(frac)))))
            p0, p1 = (mw[:k, :], mw[k:, :]) if axis == 0 else (mw[:, :k], mw[:, k:])
            s = (iou(norm(tight(p0)), na) + iou(norm(tight(p1)), nb)) if a_first \
                else (iou(norm(tight(p0)), nb) + iou(norm(tight(p1)), na))
            best = max(best, s)
        out.append((best, tag, a_first))
    out.sort(key=lambda r: -r[0])
    return out[0], out[1]


def valley(mw):
    """投影谷：返回 (横向谷深度, 纵向谷深度)。极小 = 中间断开。只作旁证打印用。"""
    def v(axis):
        p = mw.sum(axis=1 if axis == 0 else 0).astype(float)
        k = 5
        p = np.convolve(p, np.ones(k) / k, mode='same')
        n = len(p)
        if n < 8:
            return 1.0
        seg = p[int(n * .28):int(n * .72)]
        avg = p.mean()
        return float(seg.min() / avg) if avg > 0 else 1.0
    return v(0), v(1)


# ────────────────────────── 3. 汇总回「部件」 ──────────────────────────
FLIP = {'t': 'b', 'b': 't', 'l': 'r', 'r': 'l'}


def main():
    dry = '--dry' in sys.argv
    if not os.path.exists(FONT):
        print('✗ 找不到主字体 %s\n  取回命令见本文件头部注释。' % FONT)
        return 1
    font = ImageFont.truetype(FONT, SIZE)
    words, occ = load_proto()
    by_name = {w: (a, b) for w, a, b in words}
    unused = [w for w, _, _ in words if not occ.get(w)]

    cache = {}

    def mask(ch):
        if ch not in cache:
            cache[ch] = raster(ch, font)
        return cache[ch]

    def nmask(ch):
        k = '@' + ch
        if k not in cache:
            cache[k] = norm(mask(ch))
        return cache[k]

    ws, margins = {}, []
    for w, a, b in words:
        mw = mask(w)
        (score, tag, a_first), (runner, rtag, _) = match_struct(mw, nmask(a), nmask(b))
        margins.append(score - runner)
        if w in OVERRIDE:
            w_struct, w_first = OVERRIDE[w]
        else:
            w_struct, w_first = ('tb' if tag in ('tb', 'bt') else 'lr'), a_first
        ws[w] = (w_struct, w_first)
        rv, cv = valley(mw)
        flag = ' ' if w not in OVERRIDE else '★人工'
        print('  %s %s+%s → %s%s 分%.2f(次%.2f) 谷%.2f/%.2f%s'
              % (flag, a, b, w_struct, '' if w_first else '(a在下/右!)', score, runner, rv, cv,
                 '' if occ.get(w) else '   ← 没有关卡用到，不参与投票'))

    # ── 部件 → 候选半边 ──
    #
    #  ★ 两个"不那么显然但很重要"的口径，都在这里：
    #
    #  ① 只让**上过棋盘的字**投票。
    #     145 条拆字表里只有 117 条真被关卡用到。用不到的字投票 = 让一个永远不会
    #     出现的字形影响贴图 —— 纯噪声。实测：不用这一条时「连」会被"涟"（没关卡用）
    #     投成平票而落到居中，用了之后它老老实实是 'b'。
    #
    #  ② 按**关卡出现次数**加权，而不是按"出现在几个字里"。
    #     一个部件会跟着某个字在几十关里反复出现，玩家看到的是"出现次数"而不是
    #     "不同字的个数"。实测：弓 在「弩」里是字底（弩占 L1~L8）、在「弦/弧」里是
    #     左偏旁 —— 按字数是 1:2，按关卡次数是 8:6 ⇒ 取字底。
    #     ★ 这正好等于 2026-10-03 用户点名的那条口径（「比如弓字，要靠格子的下半部分」）。
    #       一条独立算出来的规则撞上用户的手工预期，是对这条规则最好的验证。
    cand = {}
    for w, a, b in words:
        n = occ.get(w, 0)
        if not n:
            continue
        s, first = ws[w]
        pa, pb = ('t', 'b') if s == 'tb' else ('l', 'r')
        if not first:
            pa, pb = FLIP[pa], FLIP[pb]
        cand.setdefault(a, []).append((pa, w, n))
        cand.setdefault(b, []).append((pb, w, n))

    role, conflicts = {}, {}
    for c, lst in cand.items():
        cnt = {}
        for p, _, n in lst:
            cnt[p] = cnt.get(p, 0) + n
        if len(cnt) == 1:
            role[c] = lst[0][0]
        else:
            total = sum(cnt.values())
            top, n = max(cnt.items(), key=lambda kv: kv[1])
            # 严格过半才敢宣称某半边；否则居中 —— "不知道就不猜"
            role[c] = top if n * 2 > total else 'c'
            conflicts[c] = cnt

    # ---------------- 自检（破了不报错、只是"看着不对"的坑，必须在这里拦住） ----------------
    problems = []
    parts = set(cand)
    for w, a, b in words:
        if not occ.get(w):
            continue
        for c in (a, b):
            if c not in role:
                problems.append('上过棋盘的部件「%s」（来自「%s」）没有分到任何半边' % (c, w))
    for c in role:
        if c not in parts:
            problems.append('「%s」不在任何一个字的拆法里，多出来的' % c)
    for c, p in role.items():
        if p not in ('t', 'b', 'l', 'r', 'c'):
            problems.append('「%s」的角色 %r 不在 t/b/l/r/c 里' % (c, p))
    for c in CROP:
        if c not in role:
            problems.append('CROP 里的「%s」不在部件表里' % c)
    # 结构比例：上下结构在这个字库里是少数派。若某次改动让它暴涨/暴跌，多半是判据坏了。
    n_tb = sum(1 for v in ws.values() if v[0] == 'tb')
    if not (0.20 * len(words) <= n_tb <= 0.40 * len(words)):
        problems.append('上下结构 %d/%d 落在这个字库的常识区间(20%%~40%%)之外 —— 判据可能坏了'
                        % (n_tb, len(words)))
    # 用户点名的两个例子：竹字头必须在上、弓必须在下。破了就是口径跑偏了。
    for ch, want in (('竹', 't'), ('弓', 'b')):
        if role.get(ch) != want:
            problems.append('「%s」的角色是 %s，但用户点名要求 %s —— 口径跑偏了'
                            % (ch, role.get(ch), want))
    if problems:
        print('\n✗ 自检失败：\n  ' + '\n  '.join(problems))
        return 1

    by_role = {p: sorted(c for c, v in role.items() if v == p) for p in 'tblrc'}
    print('\n字的层面：上下 %d / 左右 %d（共 %d；其中 %d 个没有关卡用到，不参与投票）'
          % (n_tb, len(ws) - n_tb, len(ws), len(unused)))
    if unused:
        print('  未被关卡用到：%s' % ''.join(unused))
    print('部件层面：上过棋盘的部件 %d 个，其中角色不唯一 %d 个（居中 %d 个）'
          % (len(role), len(conflicts), sum(1 for c in conflicts if role[c] == 'c')))
    for c, cnt in sorted(conflicts.items(), key=lambda kv: -sum(kv[1].values())):
        detail = ' '.join('%s:%d关' % (w, n) for p, w, n in cand[c] if cnt[p] == max(cnt.values())
                          or True)
        print('    %s → %s   %s' % (c, role[c], cnt))
    for p in 'tblrc':
        print('  %s(%3d)：%s' % (p, len(by_role[p]), ''.join(by_role[p])))
    print('  分位数：margin 中位 %.2f，最小 %.2f（只对 <0.06 的人工修正）'
          % (float(np.median(margins)), float(np.min(margins))))

    if dry:
        print('\n(--dry：不写文件)')
        return 0

    # 逐行排版：每行 6 条，方便以后人工核对
    lines = []
    items = sorted(role.items(), key=lambda kv: (kv[1], kv[0]))
    for i in range(0, len(items), 6):
        lines.append('    ' + ' '.join("'%s': '%s'," % (c, p) for c, p in items[i:i + 6]))

    # ★ 这里曾经写成 '\n'.join('...'.replace(...)) —— join 一个**字符串**是按字符拆，
    #   于是每个字符之间都被塞了换行，生成出来的 JS 第 87 行是一个孤零零的 `"`.
    #   现在按行显式构造，不再依赖任何 replace 魔法。
    ws_lines = []
    ws_items = list(ws.items())
    for i in range(0, len(ws_items), 4):
        ws_lines.append('    ' + ' '.join(
            "'%s': ['%s', %s]," % (w, v[0], 'true' if v[1] else 'false')
            for w, v in ws_items[i:i + 4]))

    # ── 生成文件头部那段"为什么这么定"的说明。★ 一律从数据算出来，不写死 ——
    #    写死的数字会在下一次重跑后悄悄变成假话（本项目已栽过这种跟头）。
    def role_of_word(w, side):
        s, first = ws[w]
        p = ('t', 'b') if s == 'tb' else ('l', 'r')
        if side == 'b':
            p = p[1]
        if not first:
            p = FLIP[p]
        return p

    NAMEC = {'t': '字头', 'b': '字底', 'l': '左偏旁', 'r': '右部件', 'c': '居中'}
    cen = [c for c in conflicts if role[c] == 'c']
    maj = [c for c in conflicts if role[c] != 'c']
    cen_txt = '\n'.join(
        ' *   %s  %s' % (c, '、'.join('%s里是%s(%s)' % (w, NAMEC[p], p)
                                     for p, w, _ in cand[c]))
        for c in sorted(cen))
    maj_txt = '\n'.join(
        ' *   %s  %s' % (c, ' vs '.join('%s×%d关' % (p, n) for p, n in
                                       sorted(conflicts[c].items(), key=lambda kv: -kv[1])))
        for c in sorted(maj))
    maj_detail = '；'.join(
        '%s 在「%s」里会画成%s' % (c, next(w for p, w, _ in cand[c] if p != role[c]), NAMEC[role[c]])
        for c in sorted(maj))

    js = '''/* ============================================================================
 * 挪字成章 · 部件「靠哪半边」表（自动生成，请勿手改）
 * ----------------------------------------------------------------------------
 * 生成器：tools/gen-tile-roles.py       重新推导：python3 tools/gen-tile-roles.py
 *
 * 【这张表回答什么】
 * 一张牌上画「部件」时，它该**靠向本格的哪半边** —— 因为部件在合成字里
 * 就占那半边，靠过去玩家才认得出"这是枪字的左边那一块"。
 *
 *   t = 贴上（字头）      b = 贴下（字底）
 *   l = 贴左（左偏旁）    r = 贴右（右部件）
 *   c = 居中（不宣称任何半边）
 *
 * 【数据是怎么来的 —— 不是拍脑袋，是可复算的】
 *  ① 用主字体栅格化每个合成字，按分界线切成两半，与它拆法里的 a、b 单独字形
 *     做形状比对（4 种切法取最优）→ 得到「这个字是上下还是左右、a 在哪半」。
 *     详见 tools/gen-tile-roles.py 头部（含一条被否掉的错路）。
 *  ② 只让**关卡真会用到的字**投票（%(nwords)d 条拆字表里只有 %(nused)d 条上过棋盘）。
 *  ③ 按**关卡出现次数**加权，不是按"出现在几个字里"。
 *     ★ 这条独立算出来的规则，正好给出用户点名的口径：弓 按字数是 1:2（弩 vs 弦/弧），
 *       按关卡次数是 8:6（弩占 L1~L8）⇒ 落在'字底'。规则与人工预期撞上，是最好的验证。
 *
 * 【为什么有 c】(%(ncen)d 个：%(cenchars)s)
 * 这些部件在不同字里扮演不同角色、且**票数打平**，没有多数派：
 *
%(centxt)s
 *
 * 一个字符只烘一张贴图 ⇒ 必须二选一。选任何一边，就有一半的字是错的；
 * 居中不宣称任何半边 —— "不知道就不猜"。要改口径，改生成器的汇总段即可。
 *
 * 【另 %(nmaj)d 个角色不唯一、但有多数派，取多数派】
%(majtxt)s
 * ★ 代价写在明处：%(majdetail)s。
 *   这些字里的部件牌因此不给"该往哪拼"的位置提示，但**不影响任何判定** ——
 *   合成关系由 WORDS 的 (a,b) 决定，与贴图上怎么画无关。
 * ========================================================================== */
(function (root) {
  "use strict";

  /** 部件 → 半边（t 上 / b 下 / l 左 / r 右 / c 居中）。不在表里的一律按 c 处理 */
  var ROLE = {
%(role)s
  };

  /**
   * 需要「偏旁形态」的部件：不能直接画整字，要裁剪合成。
   * 只有竹 —— 字体里没有 ⺮（U+2EAE），而「竹」整字跟竹字头差得肉眼认不出。
   * keep 是保留的高度比例，from 是保留哪一头。
   */
  var CROP = {
%(crop)s
  };

  /** 字 → 结构（tb 上下 / lr 左右）与 a 是否在上/左。仅供烘焙期工具与试样图使用 */
  var WORD_STRUCT = {
%(struct)s
  };

  root.TileRoles = {
    /** 查一个部件靠哪半边；不认识的字返回 'c'（等价于旧行为） */
    role: function (ch) { return ROLE[ch] || 'c'; },
    has: function (ch) { return !!ROLE[ch]; },
    /** 查裁剪规格；不需要裁剪的返回 null */
    crop: function (ch) { return CROP[ch] || null; },
    map: ROLE,
    cropMap: CROP,
    wordStruct: WORD_STRUCT,
    count: %(count)d
  };
})(typeof window !== "undefined" ? window : this);
''' % {
        'role': '\n'.join(lines),
        'crop': '\n'.join("    '%s': { from: '%s', keep: %s }," % (c, v['from'], v['keep'])
                          for c, v in sorted(CROP.items())),
        'struct': '\n'.join(ws_lines),
        'count': len(role),
        'nwords': len(words),
        'nused': len([w for w, _, _ in words if occ.get(w)]),
        'ncen': len(cen),
        'cenchars': ''.join(sorted(cen)) or '无',
        'centxt': cen_txt or ' *   （无）',
        'nmaj': len(maj),
        'majtxt': maj_txt or ' *   （无）',
        'majdetail': maj_detail or '无',
    }

    io.open(OUT, 'w', encoding='utf-8').write(js)
    print('\n✓ 已写 %s（%d 个部件，%d 字节）' % (OUT, len(role), len(js.encode('utf-8'))))
    return 0


if __name__ == '__main__':
    sys.exit(main())
