#!/usr/bin/env python3
"""把新的 LEVELS 块写回 prototype/index.html（一次性工具）"""
import io, re, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
HTML = ROOT / 'prototype/index.html'
NEW = pathlib.Path('/tmp/new-levels.txt')

src = HTML.read_text(encoding='utf-8')
lines = src.split('\n')

# 定位 const LEVELS = [ 所在行（0-based）
i0 = next(i for i, l in enumerate(lines) if l.startswith('const LEVELS = ['))
i1 = next(i for i, l in enumerate(lines) if l.startswith('];') and i > i0)

body = NEW.read_text(encoding='utf-8').rstrip('\n')
new_block = ['const LEVELS = ['] + body.split('\n') + ['  ];']

# 更新上方注释：cols/rows 不再是规格书原值
old_note = '     棋盘 cols/rows、pairs、junk、time 沿用规格书 §2.11 原值。 */'
new_note = (
    '     ★ 2026-10-03 「铺满」重排：cols 沿用规格书 §2.11，rows/pairs/words 重算 ——\n'
    '       rows 取「使 cols×rows 为偶数、且刚好装下这些牌」的最小行数，牌数 = cols×rows。\n'
    '       规则见 tools/plan-dense-levels.mjs；字频三条由生成器逐关断言。 */'
)
assert old_note in src, '旧注释没找到'
src2 = src.replace(old_note, new_note)

lines2 = src2.split('\n')
i0 = next(i for i, l in enumerate(lines2) if l.startswith('const LEVELS = ['))
i1 = next(i for i, l in enumerate(lines2) if l.startswith('];') and i > i0)
out = lines2[:i0] + new_block + lines2[i1 + 1:]
HTML.write_text('\n'.join(out), encoding='utf-8')
print(f'替换 {i0 + 1}..{i1 + 1} 行，新块 {len(new_block)} 行；文件 {len(lines2)} → {len(out)} 行')
