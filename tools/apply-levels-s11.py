#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""apply-levels-s11.py · 把 S11 定稿的关卡数据写进真源 prototype/index.html

依据：docs/关卡设计_S11-10x12定稿与贴图体积复核.md

改动四块：
  1. WORDS    —— 扩库 42 字（S9 §四 的拆法表）
  2. CH_POOL  —— 每章字池追加新字
  3. CHAPTERS —— 第一章改名「百炼堂」；cols/rows 改成该章最大尺寸（只用于生成期自检）
  4. LEVELS   —— 38 关重排：11 档尺寸（上限 10×12）、新 pairs/宝牌对/限时、每关新 words

★ 每关 words 的排法（三条硬约束，生成期会再断言一遍）
  L = ⌈pairs/2⌉              同一关里一个字最多 2 组（4 张牌）
  每个偏旁最多 2 个字          同一关里一个偏旁最多 4 张牌
  L ≤ 2 × 偏旁种数            否则第二条无解

用法： python3 tools/apply-levels-s11.py [--dry]
"""
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'prototype', 'index.html')

# ------------------------------------------------------------
# 1. 扩库 42 字（S9 §四）
# ------------------------------------------------------------
NEW_WORDS = [
    # 章 1 · 百炼堂（兵器）
    ('弦', '弓', '玄'), ('弧', '弓', '瓜'), ('炮', '火', '包'),
    # 章 2 · 花间集（花卉草木）
    ('蜻', '虫', '青'), ('蜓', '虫', '廷'), ('蝴', '虫', '胡'), ('蝉', '虫', '单'), ('蛾', '虫', '我'),
    ('池', '氵', '也'), ('湖', '氵', '胡'), ('溪', '氵', '奚'), ('波', '氵', '皮'), ('涟', '氵', '连'),
    ('露', '雨', '路'), ('霜', '雨', '相'), ('霖', '雨', '林'), ('雾', '雨', '务'),
    ('晴', '日', '青'), ('晖', '日', '军'), ('暖', '日', '爰'), ('昭', '日', '召'),
    ('帕', '巾', '白'), ('帆', '巾', '凡'),
    # 章 3 · 逛三园
    ('稻', '禾', '舀'), ('穗', '禾', '惠'), ('秧', '禾', '央'), ('秆', '禾', '干'),
    # 章 4 · 百工坊
    ('坛', '土', '云'), ('坊', '土', '方'), ('坎', '土', '欠'), ('均', '土', '匀'),
    ('扇', '户', '羽'), ('房', '户', '方'), ('扉', '户', '非'), ('扁', '户', '册'),
    ('室', '宀', '至'), ('宫', '宀', '吕'), ('宾', '宀', '兵'),
    ('铜', '钅', '同'), ('铁', '钅', '失'), ('银', '钅', '艮'), ('铃', '钅', '令'),
]
APPEND = {
    1: [w for w, _, _ in NEW_WORDS if w in '弦弧炮'],
    2: ['蜻', '蜓', '蝴', '蝉', '蛾', '池', '湖', '溪', '波', '涟',
        '露', '霜', '霖', '雾', '晴', '晖', '暖', '昭', '帕', '帆'],
    3: ['稻', '穗', '秧', '秆'],
    4: ['坛', '坊', '坎', '均', '扇', '房', '扉', '扁', '室', '宫', '宾',
        '铜', '铁', '银', '铃'],
}

# ------------------------------------------------------------
# 2. S11 §二 的 38 关表
#    每关：档位索引（决定尺寸 / 占格 / 宝牌对）
# ------------------------------------------------------------
TIERS = [(6, 6), (6, 7), (7, 7), (7, 8), (8, 8), (8, 9),
         (9, 9), (9, 10), (10, 10), (10, 11), (10, 12)]
SEQ = ([0, 0, 1, 1, 2, 2, 3, 3] +                    # 章 1 · L1~L8
       [0, 4, 4, 5, 5, 6, 6, 6] +                    # 章 2 · L9~L16
       [0, 6, 6, 7, 7, 7, 8, 8, 8, 9, 9, 9] +        # 章 3 · L17~L28
       [0, 9, 9, 9, 9, 10, 10, 10, 10, 10])          # 章 4 · L29~L38
CHAP_STARTS = {1, 9, 17, 29}
CHAPTER_OF = lambda n: 1 if n <= 8 else 2 if n <= 16 else 3 if n <= 28 else 4

CHAPTERS_NEW = [
    (1, '第一章 · 百炼堂', '十八般兵器 · 木 / 钅 / 革 / 竹 / 弓 / 火', (7, 8)),
    (2, '第二章 · 花间集', '花卉草木 · 木 / 艹 / 虫 / 氵 / 雨 / 日 / 巾', (9, 9)),
    (3, '第三章 · 逛三园', '果园 / 动物园 / 植物园 · 木 / 艹 / 犭 / 虫 / 鱼 / 禾', (10, 11)),
    (4, '第四章 · 百工坊', '民俗器物 · 火 / 竹 / 钅 / 纟 / 木 / 土 / 户 / 宀', (10, 12)),
]


def ceil_div(a, b):
    return -(-a // b)


def cut(html, name):
    """按括号配平切出 `const NAME = ...` 那段字面量，返回 (start, end) 下标"""
    head = 'const ' + name + ' = '
    i = html.index(head)
    start = i + len(head)
    op, cl = html[start], {'{': '}', '[': ']'}[html[start]]
    depth, instr, k = 0, None, start
    while k < len(html):
        ch = html[k]
        if instr:
            if ch == '\\':
                k += 2
                continue
            if ch == instr:
                instr = None
            k += 1
            continue
        if ch in "'\"`":
            instr = ch
        elif ch == op:
            depth += 1
        elif ch == cl:
            depth -= 1
            if depth == 0:
                return start, k + 1
        k += 1
    raise RuntimeError(name + ' 括号不配平')


def main():
    dry = '--dry' in sys.argv
    html = io.open(SRC, encoding='utf-8').read()

    ws, we = cut(html, 'WORDS')
    WORDS = {m.group(1): (m.group(2), m.group(3))
             for m in re.finditer(r"'(\S)':\{a:'(\S)',b:'(\S)'\}", html[ws:we])}
    print('现有 WORDS %d 条' % len(WORDS))
    for w, a, b in NEW_WORDS:
        if w in WORDS:
            raise SystemExit('扩库冲突：%s 已存在' % w)
        WORDS[w] = (a, b)
    print('扩库后 %d 条（新增 %d）' % (len(WORDS), len(NEW_WORDS)))

    # -- CH_POOL --
    cs, ce = cut(html, 'CH_POOL')
    POOL = {int(m.group(1)): re.findall(r"'(\S)'", m.group(2))
            for m in re.finditer(r'(\d):\[([^\]]*)\]', html[cs:ce])}
    for ch, add in APPEND.items():
        for w in add:
            if w not in POOL[ch]:
                POOL[ch].append(w)
    for ch in (1, 2, 3, 4):
        print('  章%d 字池 %d 个' % (ch, len(POOL[ch])))

    # -- 每关 words --
    def order_of(pool, rot):
        """先按章内首次出现的顺序给偏旁分组，再轮转取字：
           第 0 轮 = 每组的第 1 个字，第 1 轮 = 每组的第 2 个字 → 天然满足「每偏旁 ≤2 个字」"""
        p = pool[rot % len(pool):] + pool[:rot % len(pool)]
        groups, gidx = [], {}
        for w in p:
            a = WORDS[w][0]
            if a not in gidx:
                gidx[a] = len(groups)
                groups.append([])
            groups[gidx[a]].append(w)
        out = []
        for r in range(2):
            for g in groups:
                if len(g) > r:
                    out.append(g[r])
        return out

    levels = []
    for i, tier in enumerate(SEQ):
        n = i + 1
        ch = CHAPTER_OF(n)
        cols, rows = TIERS[tier]
        cells = cols * rows
        used = 28 + 4 * tier
        tr = 0 if cells < 42 else 1 if cells <= 72 else 2 if cells <= 110 else 3
        pairs = used // 2 - tr
        L = ceil_div(pairs, 2)
        # 章内序号 → 字池轮转量（让同档位的相邻关卡拿到不同的字）
        k = sum(1 for j in range(i) if CHAPTER_OF(j + 1) == ch)
        words = order_of(POOL[ch], k * 5)[:L]
        bonus = 1.25 if n == 1 else (1.10 if n in CHAP_STARTS else 1.00)
        t = (pairs * 9.5 + cells * 0.2) * bonus + 60 * (cells - 36) / 108
        time = int(round(t / 5.0)) * 5

        # 硬约束自检
        rad = {}
        for w in words:
            rad[WORDS[w][0]] = rad.get(WORDS[w][0], 0) + 1
        cnt = {}
        for j in range(pairs):
            w = words[j % len(words)]
            cnt[w] = cnt.get(w, 0) + 1
        bad = []
        if len(words) < L:
            bad.append('字池不够选出 %d 个字' % L)
        if max(cnt.values()) > 2:
            bad.append('有字超过 2 组：%s' % {k2: v for k2, v in cnt.items() if v > 2})
        if max(rad.values()) > 2:
            bad.append('有偏旁超过 2 个字：%s' % {k2: v for k2, v in rad.items() if v > 2})
        tile_of_rad = {}
        for j in range(pairs):
            w = words[j % len(words)]
            tile_of_rad[WORDS[w][0]] = tile_of_rad.get(WORDS[w][0], 0) + 1
        if max(tile_of_rad.values()) > 4:
            bad.append('有偏旁超过 4 张：%s' % {k2: v for k2, v in tile_of_rad.items() if v > 4})
        if bad:
            raise SystemExit('L%d 排字失败：%s' % (n, '；'.join(bad)))

        tip = None
        if k < 3:                                       # 每章前 3 关留拆法提示
            w0 = words[0]
            tip = '%s + %s = %s' % (WORDS[w0][0], WORDS[w0][1], w0)
        note = '%d×%d · 目标 %d 字' % (cols, rows, len(words))
        if tr:
            note += ' · %d 对宝牌' % tr
        levels.append(dict(n=n, ch=ch, cols=cols, rows=rows, time=time, words=words,
                           pairs=pairs, tr=tr, junk=0, tip=tip, note=note))

    assert len(levels) == 38, len(levels)

    # -- 渲染四块 --
    def render_words():
        keys = list(WORDS.keys())
        out = []
        for i in range(0, len(keys), 3):
            row = []
            for k in keys[i:i + 3]:
                a, b = WORDS[k]
                row.append("  '%s':{a:'%s',b:'%s'}" % (k, a, b))
            out.append(', '.join(row) + ',')
        return 'const WORDS = {\n' + '\n'.join(out) + '\n};'

    def render_pool():
        out = []
        for ch in (1, 2, 3, 4):
            out.append('  %d:[%s],' % (ch, ','.join("'%s'" % w for w in POOL[ch])))
        return 'const CH_POOL = {\n' + '\n'.join(out) + '\n};'

    def render_chapters():
        out = []
        for cid, name, sub, (cc, rr) in CHAPTERS_NEW:
            out.append("  { id:%d, name:'%s', sub:'%s', cols:%d, rows:%d }," % (cid, name, sub, cc, rr))
        return 'const CHAPTERS = [\n' + '\n'.join(out) + '\n];'

    def render_levels():
        out = []
        for lv in levels:
            parts = ["n:%d" % lv['n'], "ch:%d" % lv['ch'], "cols:%d" % lv['cols'],
                     "rows:%d" % lv['rows'], "time:%d" % lv['time']]
            s = "  { " + ', '.join(parts) + ',\n'
            s += "    words:['" + "','".join(lv['words']) + "'],\n"
            s += "    pairs:%d, tr:%d, junk:%d" % (lv['pairs'], lv['tr'], lv['junk'])
            if lv['tip']:
                s += ", tip:'%s'" % lv['tip']
            s += ",\n    note:'%s' }," % lv['note']
            out.append(s)
        return 'const LEVELS = [\n' + '\n'.join(out) + '\n];'

    # 从后往前替换，避免下标漂移
    for name, rend in (('LEVELS', render_levels), ('CHAPTERS', render_chapters),
                       ('CH_POOL', render_pool), ('WORDS', render_words)):
        s, e = cut(html, name)
        html = html[:s] + rend()[len('const ' + name + ' = '):] + html[e:]

    print('\n38 关预览（前 6 关 + 末 6 关）：')
    for lv in levels[:6] + levels[-6:]:
        print('  L%-2d %d×%-2d %4ds pairs=%-2d 宝牌=%d 字%d个 %s'
              % (lv['n'], lv['cols'], lv['rows'], lv['time'], lv['pairs'], lv['tr'],
                 len(lv['words']), ''.join(lv['words'])))

    if dry:
        print('\n[dry] 不写盘')
        return
    io.open(SRC, 'w', encoding='utf-8').write(html)
    print('\n✓ 已写 %s' % SRC)
    json.dump(levels, io.open('/tmp/chaizi-levels-s11.json', 'w'), ensure_ascii=False)


if __name__ == '__main__':
    main()
