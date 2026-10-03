#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""汉字轮廓抽取（多字体 + upem 统一归一化）→ design/glyphs-data.js

【为什么要多字体 —— 以及为什么现在只剩一支了】
主字体「马善政毛笔楷书」是设计字体，只覆盖常用字。历史上项目里有 6 个字它没有：
    戉 匊 枼 夆 罒 龴
当时的打算是"这些字会作为部件牌出现在关卡里（菊=艹+匊、蝶=虫+枼、蜂=虫+夆、钺=钅+戉）"。
**后来这套目标字根本没进字库**（菊/蝶/蜂/钺 都不在 assets/wordlib.json 里，
LevelData.ts 也没有），于是：
  · 戉 匊 枼 夆 —— 谁都不引用，重跑本脚本即自动消失（它们只留在旧版 glyphs-data.js 里）；
  · 罒 —— 曾是原型 JUNK_CHARS 的一员，靠系统宋体补字形；
  · 匸 —— 只在本文件的 JUNK_POOL 当候选，从没烘过贴图，但同样要宋体。

2026-10-02 用户拍板「把生僻字换成常见的、能授权的字体的字」→ 已把 `罒` 从 JUNK_CHARS、
`罒`+`匸` 从 JUNK_POOL 删掉。现在本脚本**不再需要系统字体**，
`design/glyphs-data.js` 100% 出自 OFL 字体，可随产品分发。

【为什么必须统一 upem】
不同字体的 unitsPerEm 可能不同（马善政 1000、宋体可能 1000/2048）。
若直接混用原始字体坐标，两个字体的字大小会差几倍。
所以所有坐标先乘 (1000 / upem) 归一到同一尺度，**再**算并集包围盒。

【为什么用并集包围盒，而不是逐字适配】
逐字适配会把每个字都撑满画心 ——「艹」会变得和「木」一样大，
「艹在上 / 皿在下」这类**上下结构关系就全毁了**。
用全字库并集包围盒统一变换，字与字之间的相对大小、基线、居中全部保持。
（★ 这是上一轮踩过的坑：CJK 字形 em-box 在基线下方，y ∈ [-187, 852]，
  朴素地 y_svg = 1000 - y_font 会把字推到画布外，底部被裁掉且看不出来。）

用法:
    python3 tools/build-glyphs.py            # 全量重建
    python3 tools/build-glyphs.py --dry      # 只报告覆盖情况，不写文件
"""
import io, json, os, re, sys

from fontTools.ttLib import TTFont
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.misc.transform import Transform

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'design', 'glyphs-data.js')

MSJ_CSS = '/tmp/ink-font/msj/package/400.css'
MSJ_FILES = '/tmp/ink-font/msj/package/files'
SONGTI = '/System/Library/Fonts/Supplemental/Songti.ttc'
SONGTI_FACE = 1                      # 1 = Songti SC（Regular）

VIEW = 1000.0
PAD = 46.0
UPEM = 1000.0                        # 统一到 1000

# 干扰字候选池（供"原型 JUNK_CHARS 抽不到时挑一个替补"用）。
#
# ★ 2026-10-02 拍板后的状态：池子里**不允许再出现马善政缺字形的字**。
#   已剔除：
#     · `罒` —— 原先在原型 JUNK_CHARS 里，靠系统宋体补字形；本轮已从
#       JUNK_CHARS 删掉（38 关的 junk ≤ 4，只取前 4 个字，它从没上过棋盘）。
#     · `匸` —— 从来只是本池子的候选，连贴图都没烘过，但**它同样要宋体**，
#       留着会让整个字形库一直带着一条"系统字体不可分发"的尾巴。
#   → 现在若本脚本报出 `songti:` 非 0，说明有人又往目标集合里加了马善政
#     覆盖不到的字，**必须当场处理**（换成常见字 / 从池子删掉），
#     否则 `design/glyphs-data.js` 里会重新混入不可随产品分发的字形。
JUNK_POOL = ['疒', '匚', '彳', '卩', '冫', '屮', '廾', '弋',
             '丬', '尢', '彐', '攴', '疋', '殳', '聿', '缶', '虍', '耒']


# ────────────────────────── 目标字符 ──────────────────────────
def load_targets():
    """原型用字 ∪ 字库(wordlib)用字 ∪ 界面字"""
    cs = set()

    # 1) 原型（真源：原型里 WORDS 的键与 a/b 两半，以及 JUNK_CHARS）
    html = io.open(os.path.join(ROOT, 'prototype', 'index.html'), encoding='utf-8').read()
    for m in re.finditer(r"'([^']+)':\{a:'([^']*)',b:'([^']*)'\}", html):
        cs.add(m.group(1)); cs.add(m.group(2)); cs.add(m.group(3))
    jm = re.search(r'JUNK_CHARS\s*=\s*\[([^\]]+)\]', html)
    if jm:
        for c in jm.group(1).split(','):
            c = c.strip().strip("'\"")
            if c:
                cs.add(c)

    # 2) 字库（可能含原型之外的字，并集保留）
    lib_p = os.path.join(ROOT, 'assets', 'wordlib.json')
    if os.path.exists(lib_p):
        lib = json.load(io.open(lib_p, encoding='utf-8'))
        for ch in lib.get('chapters', []):
            for w in ch.get('words', []):
                cs.add(w.get('word', ''))
                for k in ('radical', 'part', '偏旁', '部件'):
                    if w.get(k):
                        cs.add(w[k])

    # 3) 界面文案 + 印章用字
    cs |= set('挪字成章水墨丹青一二三四五六七八九十关卡第页开始提示玩法设置音效返回重来洗牌章')
    # 4) 干扰字候选也一起抽，抽完再挑
    cs |= set(JUNK_POOL)

    return {c for c in cs if c and c.strip()}


# ────────────────────────── 字体装载 ──────────────────────────
def parse_ranges(spec):
    out = []
    for part in spec.split(','):
        part = part.strip().lower().replace('u+', '').rstrip(';').strip()
        if not part:
            continue
        if '-' in part:
            a, b = part.split('-', 1)
            out.append((int(a, 16), int(b, 16)))
        elif '?' in part:
            out.append((int(part.replace('?', '0'), 16), int(part.replace('?', 'f'), 16)))
        else:
            v = int(part, 16)
            out.append((v, v))
    return out


class Source:
    """一个字体来源：给一批字符，按需惰性打开底层分片。"""

    def __init__(self, name, tag, css=None, fdir=None, ttc=None, face=0):
        self.name, self.tag = name, tag
        self.css, self.fdir, self.ttc, self.face = css, fdir, ttc, face
        self._c2f = None
        self._fonts = {}

    def _split_map(self):
        if self._c2f is None:
            if not self.css:
                self._c2f = {}
            else:
                css = io.open(self.css, encoding='utf-8').read()
                blocks = re.findall(
                    r"url\([^)]*?([A-Za-z0-9._\-]+\.woff2)['\"]?\)[^}]*unicode-range:\s*([^}]+)",
                    css, re.S)
                self._c2f = {}
                for fname, spec in blocks:
                    for lo, hi in parse_ranges(spec):
                        for cp in range(lo, hi + 1):
                            self._c2f[cp] = fname
        return self._c2f

    def font_for(self, ch):
        """返回 (TTFont, upem)；取不到返回 (None, None)"""
        if self.ttc:
            key = self.ttc
            if key not in self._fonts:
                self._fonts[key] = TTFont(self.ttc, fontNumber=self.face, lazy=True)
            f = self._fonts[key]
            return (f, f['head'].unitsPerEm) if ord(ch) in f.getBestCmap() else (None, None)

        fname = self._split_map().get(ord(ch))
        if not fname:
            return None, None
        p = os.path.join(self.fdir, fname)
        if not os.path.exists(p):
            return None, None
        if fname not in self._fonts:
            self._fonts[fname] = TTFont(p, fontNumber=0, lazy=True)
        f = self._fonts[fname]
        return (f, f['head'].unitsPerEm) if ord(ch) in f.getBestCmap() else (None, None)

    def close(self):
        for f in self._fonts.values():
            try:
                f.close()
            except Exception:
                pass
        self._fonts.clear()


SOURCES = [
    Source('msj', 'MaShanZheng', css=MSJ_CSS, fdir=MSJ_FILES),
    Source('songti', 'Songti SC', ttc=SONGTI, face=SONGTI_FACE),
]


def main():
    dry = '--dry' in sys.argv
    targets = load_targets()
    print(f'目标字符 {len(targets)} 个')

    # ── 分配来源：按 SOURCES 顺序，先到先得 ──
    assign = {}                        # ch -> (Source, TTFont, upem)
    for ch in sorted(targets):
        for s in SOURCES:
            f, upem = s.font_for(ch)
            if f is not None:
                assign[ch] = (s, f, upem)
                break
    missing = sorted(set(targets) - set(assign))
    print(f'命中 {len(assign)}  缺 {len(missing)}' + ('：' + ''.join(missing) if missing else ' ✅'))

    by_src = {}
    for ch, (s, f, upem) in assign.items():
        by_src.setdefault(s.name, []).append(ch)
    for k, v in by_src.items():
        print(f'  {k}: {len(v)} 字')

    # ── 第一遍：并集包围盒（upem 归一到 1000）──
    U = [1e9, 1e9, -1e9, -1e9]
    boxes_raw = {}
    for ch, (s, f, upem) in assign.items():
        k = UPEM / upem
        gs = f.getGlyphSet()
        gn = f.getBestCmap().get(ord(ch))
        if not gn:
            continue
        bp = BoundsPen(gs)
        try:
            gs[gn].draw(bp)
        except Exception:
            continue
        if not bp.bounds:
            continue
        x0, y0, x1, y1 = bp.bounds
        bb = [x0 * k, y0 * k, x1 * k, y1 * k]
        boxes_raw[ch] = bb
        U[0] = min(U[0], bb[0]); U[1] = min(U[1], bb[1])
        U[2] = max(U[2], bb[2]); U[3] = max(U[3], bb[3])

    print(f'并集包围盒 x[{U[0]:.0f},{U[2]:.0f}] y[{U[1]:.0f},{U[3]:.0f}]')
    uw, uh = U[2] - U[0], U[3] - U[1]
    avail = VIEW - PAD * 2
    scale = avail / max(uw, uh)
    cx, cy = (U[0] + U[2]) / 2, (U[1] + U[3]) / 2
    print(f'统一缩放 {scale:.6f}（可用边长 {avail:.0f}）')

    # ── 第二遍：输出轮廓 ──
    glyphs, boxes, origin = {}, {}, {}
    for ch, (s, f, upem) in sorted(assign.items()):
        if ch not in boxes_raw:
            continue
        k = UPEM / upem
        gs = f.getGlyphSet()
        gn = f.getBestCmap().get(ord(ch))
        tf = Transform(k * scale, 0, 0, -k * scale,
                       VIEW / 2 - cx * scale, VIEW / 2 + cy * scale)
        pen = SVGPathPen(gs, ntos=lambda v: str(int(round(v))))
        try:
            gs[gn].draw(TransformPen(pen, tf))
        except Exception as e:
            print(f'  ✗ {ch}: {e}')
            continue
        d = pen.getCommands()
        if not d:
            continue
        glyphs[ch] = d
        origin[ch] = s.name
        x0, y0, x1, y1 = boxes_raw[ch]
        boxes[ch] = [int(round(x0 * scale + (VIEW / 2 - cx * scale))),
                     int(round(y1 * -scale + (VIEW / 2 + cy * scale))),
                     int(round(x1 * scale + (VIEW / 2 - cx * scale))),
                     int(round(y0 * -scale + (VIEW / 2 + cy * scale)))]

    bad = [c for c, b in boxes.items()
           if b[0] < -1 or b[1] < -1 or b[2] > VIEW + 1 or b[3] > VIEW + 1]
    print(f'输出字形 {len(glyphs)}')
    print('越界字形:', ''.join(bad) if bad else '无 ✅')

    # 干扰字候选：报告哪些可用
    avail_junk = [c for c in JUNK_POOL if c in glyphs]
    print('干扰字候选可用:', ''.join(avail_junk))

    songti_chars = ''.join(sorted(c for c, s in origin.items() if s == 'songti'))
    if songti_chars:
        print(f'⚠️ 由系统宋体补的字（风格与毛笔楷书略有差异，正式发布需换授权字体）：{songti_chars}')

    for s in SOURCES:
        s.close()

    if dry:
        print('\n--dry：未写文件')
        return 0

    # ── 写 JS ──
    # ★ 「来源」这几行**按实际有没有用系统字体生成**，不要写死。
    #   写死"仅用于补充 5 个生僻字"会把已经清干净的库说成还没清干净，
    #   后来的人照着注释去"修"一个不存在的问题。
    src_lines = [
        ' *   · 马善政毛笔楷书 (Ma Shan Zheng) — SIL OFL 1.1，未声明保留字体名，',
        ' *     允许转轮廓、修改、商用；分发时需附带版权声明与许可证全文。']
    if songti_chars:
        src_lines += [
            f' *   · 宋体 (Songti SC, macOS 系统字体) — 补了 {len(songti_chars)} 个字：{songti_chars}',
            ' *     ⚠️ 系统字体**不可随产品分发**，正式发布前必须换成授权字体！']
    else:
        src_lines += [
            ' *   ·（无系统字体补字 —— 全部字形都出自上面这支 OFL 字体，可随产品分发）']
    src_tag = ('MaShanZheng(OFL) + Songti SC(临时补字)' if songti_chars
               else 'MaShanZheng(OFL)')

    js = ['/* ============================================================================',
          ' * 挪字成章 · 字形轮廓数据（自动生成，请勿手改）',
          ' * ----------------------------------------------------------------------------',
          ' * 来源：',
          *src_lines,
          ' *',
          ' * 归一化：所有字体先按 upem 归一到 1000，再取**全字库并集包围盒**做统一变换。',
          ' * 绝不可改成逐字适配 —— 那会毁掉「艹在上 / 皿在下」这类结构关系。',
          ' *',
          f' * 字数：{len(glyphs)}   viewBox：{int(VIEW)}   pad：{int(PAD)}',
          ' * ========================================================================== */',
          '(function (root) {',
          '  "use strict";',
          '  var map = ' + json.dumps(glyphs, ensure_ascii=False, separators=(',', ':')) + ';',
          '  var boxes = ' + json.dumps(boxes, ensure_ascii=False, separators=(',', ':')) + ';',
          '  var origin = ' + json.dumps(origin, ensure_ascii=False, separators=(',', ':')) + ';',
          '  root.InkGlyphs = {',
          '    view: ' + str(int(VIEW)) + ',',
          '    map: map,',
          '    boxes: boxes,',
          '    origin: origin,',
          '    path: function (ch) { return map[ch] || ""; },',
          '    box: function (ch) { return boxes[ch] || [63, 63, 937, 937]; },',
          '    has: function (ch) { return !!map[ch]; },',
          '    count: ' + str(len(glyphs)) + ',',
          '    source: ' + json.dumps(src_tag, ensure_ascii=False) + ',',
          '  };',
          '})(typeof window !== "undefined" ? window : this);',
          '']
    io.open(OUT, 'w', encoding='utf-8').write('\n'.join(js))
    print(f'\n已写出 {OUT}  {os.path.getsize(OUT) / 1024:.0f}KB')
    return 0


if __name__ == '__main__':
    sys.exit(main())
