#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把 design/levels-v2.js 的 38 关设计，幂等注入 prototype/index.html。

来源（唯一真源，不手抄）：
  design/levels-v2.js   38 关字单
  assets/wordlib.json   103 字（radical/part/structure/tier）
前置：先跑
  node tools/build-levels-v2-json.js --out /tmp/cz-levels-v2.json

替换范围（原型的第 1、2 节）：
  const WORDS / PAIR / needOf / CHAPTERS / CH_POOL / LEVELS
标记：/* ==LEVELS-V2-BEGIN== */ ... /* ==LEVELS-V2-END== */
已经是新版（有标记）时只替换标记之间的内容，不会叠加。

用法：
  python3 tools/apply-levels-v2.py --dry     # 只报告，不写
  python3 tools/apply-levels-v2.py           # 写入（自动备份 .bak）
"""
import json
import os
import re
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML = os.path.join(ROOT, 'prototype', 'index.html')
DATA = '/tmp/cz-levels-v2.json'

BEGIN = '/* ==LEVELS-V2-BEGIN== */'
END = '/* ==LEVELS-V2-END== */'

# 旧块的两个锚点（首次运行时用）
ANCHOR_A = '/* ============================================================\n   1. 字库（拆字表）'
ANCHOR_B = '/* ============================================================\n   3. 全局状态 & 存档'


def js_str(s):
    return "'" + s.replace('\\', '\\\\').replace("'", "\\'") + "'"


def build_words(words):
    """103 字拆字表：每行 6 组"""
    items = []
    for ch, k in words.items():
        items.append("%s:{a:%s,b:%s}" % (js_str(ch), js_str(k['a']), js_str(k['b'])))
    lines = []
    for i in range(0, len(items), 4):
        lines.append('  ' + ', '.join(items[i:i + 4]) + ',')
    return ('/* 103 字：a = 本作说的「偏旁」（左/上半边），b = 另一半。\n'
            '   ★ 配对是无序的，a/b 谁先谁后都能拼（见下方 PAIR 双向建索引）。\n'
            '   来源：assets/wordlib.json —— 由 tools/apply-levels-v2.py 生成，勿手工改。 */\n'
            'const WORDS = {\n' + '\n'.join(lines) + '\n};\n')


def build_chapters(chapters):
    lines = []
    for c in chapters:
        lines.append("  { id:%d, name:%s, sub:%s, cols:%d, rows:%d }," %
                     (c['id'], js_str(c['name']), js_str(c['sub']), c['cols'], c['rows']))
    lines[-1] = lines[-1].rstrip(',')
    return ('const CHAPTERS = [\n' + '\n'.join(lines) + '\n];\n')


def build_ch_pool(ch_pool):
    """每章字池 —— 只用于选关页的「本节会出现」预览"""
    lines = []
    keys = sorted(ch_pool.keys(), key=lambda x: int(x))
    for i, k in enumerate(keys):
        arr = ','.join(js_str(w) for w in ch_pool[k])
        lines.append('  %s:[%s]%s' % (k, arr, '' if i == len(keys) - 1 else ','))
    return ('/* 每章字池（按关卡里首次出现的顺序）。选关页取前 6 个字做预览。 */\n'
            'const CH_POOL = {\n' + '\n'.join(lines) + '\n};\n')


def build_levels(levels):
    lines = []
    for l in levels:
        w = ','.join(js_str(x) for x in l['words'])
        lines.append(
            '  { n:%d, ch:%d, cols:%d, rows:%d, time:%d,\n    words:[%s],\n'
            '    pairs:%d, junk:%d%s%s },' % (
                l['n'], l['ch'], l['cols'], l['rows'], l['time'], w,
                l['pairs'], l['junk'],
                (", tip:%s" % js_str(l['tip'])) if l['tip'] else '',
                (", note:%s" % js_str(l['note'])) if l['note'] else ''))
    lines[-1] = lines[-1].rstrip(',')
    return ('/* 38 关（设计定稿：docs/关卡设计_v2.1.md）。\n'
            '   ★ 这里不再是程序化生成 —— 关关的字单是设计出来的：\n'
            '     每关至少两种偏旁、字种随进度递增、单张牌面重复率 ≤30%。\n'
            '     棋盘 cols/rows、pairs、junk、time 沿用规格书 §2.11 原值。 */\n'
            'const LEVELS = [\n' + '\n'.join(lines) + '\n];\n')


def main():
    dry = '--dry' in sys.argv
    if not os.path.exists(DATA):
        sys.exit('缺少 %s —— 先跑 node tools/build-levels-v2-json.js' % DATA)
    with open(DATA, encoding='utf-8') as f:
        d = json.load(f)

    new_body = '\n'.join([
        BEGIN,
        '/* ============================================================',
        '   1. 字库（拆字表）  —— 103 字，由 assets/wordlib.json 生成',
        '   ============================================================ */',
        build_words(d['words']),
        '/* 建配对索引（无序匹配） */',
        'const PAIR = {};',
        "for (const w in WORDS){ const {a,b} = WORDS[w]; PAIR[a+'|'+b] = w; PAIR[b+'|'+a] = w; }",
        '/* 反向：某字 → 需要的两张牌 */',
        'function needOf(w){ return [WORDS[w].a, WORDS[w].b]; }',
        '',
        '/* ============================================================',
        '   2. 关卡表',
        '   ============================================================ */',
        build_chapters(d['chapters']),
        build_ch_pool(d['chPool']),
        build_levels(d['levels']),
        END,
    ])

    with open(HTML, encoding='utf-8') as f:
        src = f.read()

    old_len = len(src)
    if BEGIN in src and END in src:
        i = src.index(BEGIN)
        j = src.index(END) + len(END)
        out = src[:i] + new_body + src[j:]
        how = '替换标记区间'
    else:
        ia = src.index(ANCHOR_A)
        ib = src.index(ANCHOR_B)
        out = src[:ia] + new_body + '\n\n' + src[ib:]
        how = '按锚点首次注入'

    # 存档 key：旧 32 关的进度和新关卡表对不上（第 33 关在新表里是「宅园」关），
    # 沿用旧 key 会让玩家看到一堆张冠李戴的星。升一个版本号，从头开始。
    n_key = out.count("'cz_nd_v2'")
    out = out.replace("'cz_nd_v2'", "'cz_nd_v3'")

    # 自检：注入后这几段必须还在
    for must in ['const WORDS = {', 'const CHAPTERS = [', 'const CH_POOL = {',
                 'const LEVELS = [', 'const PAIR = {}', 'function needOf(w)']:
        if must not in out:
            sys.exit('★ 注入结果里找不到：' + must)

    # LEVELS 里不应再有旧的程序化生成痕迹
    if 'pool.slice(0' in out:
        sys.exit('★ 注入后仍存在旧的 pool.slice(0, ...) 生成逻辑')

    print('%s：%d → %d 字节（%+d）' % (how, old_len, len(out), len(out) - old_len))
    print('存档 key 改写 %d 处：cz_nd_v2 → cz_nd_v3' % n_key)
    print('字表 %d 字 / %d 关 / 章 %d' %
          (len(d['words']), len(d['levels']), len(d['chapters'])))

    if dry:
        print('--dry：未写入')
        return
    shutil.copy2(HTML, HTML + '.bak')
    with open(HTML, 'w', encoding='utf-8') as f:
        f.write(out)
    print('已写入 prototype/index.html（备份 index.html.bak）')


if __name__ == '__main__':
    main()
