#!/usr/bin/env python3
"""由 shots/all-pages/manifest.json 生成一份「可分享的 PDF 版」页面画廊。

【为什么不在浏览器里直接「打印成 PDF」】
页面画廊是 CSS Grid 自适应长页，直接打印会由浏览器自己分页 ——
卡片会被拦腰截断，而且图鉴那两张 5272px 的长图会被压成一条细线。
所以这里改成「确定性分页」：脚本先把每页内容算好，写成固定高度的
.sheet（210×297mm，A4），每张 .sheet 正好落一页，Chrome 只负责渲染。

【长图怎么办】
15/16 两张图鉴高 5272px（手机屏的 6 倍），一张塞进一页会小到看不清。
按手机屏比例（约 860×1760）切成 3 段，每段当一个独立卡片，
标题上标 (1/3)(2/3)(3/3)，读者顺着翻就是完整的图鉴。

【为什么转 JPEG】
18 张 PNG 合计约 12MB，内嵌进 PDF 后体积会翻倍。转成 4:4:4 的
JPEG q90（不做色度抽样，保文字边缘）后约 2MB，打印观感无差别。
原 PNG 原地不动，本脚本只往 _pdf_assets/ 里写副本。

【依赖】受管 venv：/Users/consli/.workbuddy/binaries/python/envs/default/bin/python
（需要 Pillow）。脚本只生成 HTML，转 PDF 由 tools/make-pdf.sh 调 Chrome 完成。
"""
import importlib.util
import json
import math
import os
import sys

from PIL import Image, ImageStat

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'shots', 'all-pages')
ASSETS = os.path.join(SRC, '_pdf_assets')
OUT_HTML = os.path.join(SRC, '页面画廊-打印版.html')

SLICE_THRESHOLD = 2400      # 超过这个高度（设备像素）就当长图，切片
SLICE_TARGET = 1760         # 每片的目标高度 ≈ 一张手机屏
SLICE_SEARCH = 220          # 在理想切点附近找「空白行」的搜索半径
SLICE_MIN_H = 700           # 切片不得矮于这个高度，免得切出碎条
JPEG_Q = 90                 # 4:4:4 + q90：文字边缘不吃亏，体积约 1/6

PER_SHEET = 2               # 每页放 2 张手机屏（A4 竖版的最佳密度）


def load_gallery_meta():
    """复用 make-gallery.py 里的分组与注释，避免两份清单各写一遍后走样。"""
    path = os.path.join(ROOT, 'tools', 'make-gallery.py')
    spec = importlib.util.spec_from_file_location('gal', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.GROUPS, mod.NOTE_FILL


def row_flatness(im_gray, y):
    """给某一行打「平坦度」分：越小越像空白间隔带。

    只按标准差挑会踩坑 —— 卡片内部的一块纯色也是「平坦」的，
    切在那里等于把一张牌劈成两半。所以再加一条：这一行得够亮（背景色），
    否则记重罚。两个条件合起来才等价于「卡片之间的空隙」。
    """
    row = im_gray.crop((0, y, im_gray.width, y + 1))
    st = ImageStat.Stat(row)
    sd, mean = st.stddev[0], st.mean[0]
    return sd + (0.0 if mean > 225 else 200.0)


def find_cuts(im, n):
    """把高度切成 n 段，但切点落在卡片之间的空白带上，不切穿卡片。"""
    h = im.height
    gray = im.convert('L')
    cuts = [0]
    for i in range(1, n):
        ideal = round(h * i / n)
        lo = max(cuts[-1] + SLICE_MIN_H, ideal - SLICE_SEARCH)
        hi = min(h - SLICE_MIN_H, ideal + SLICE_SEARCH)
        if lo > hi:                       # 搜索区间被挤没了 → 退回理想切点
            cuts.append(ideal)
            continue
        best, best_score = ideal, None
        for y in range(lo, hi + 1):
            s = row_flatness(gray, y)
            if best_score is None or s < best_score:
                best, best_score = y, s
        cuts.append(best)
    cuts.append(h)
    return cuts


def slice_units(m):
    """把一张截图拆成若干「卡片单元」：(资源文件名, 角标文字)。

    常规图 → 1 个单元；长图 → 切成接近手机屏比例的数段，
    切点优先落在空白间隔带上（见 find_cuts）。
    """
    src = os.path.join(SRC, m['file'])
    im = Image.open(src)
    w, h = im.size

    if h <= SLICE_THRESHOLD:
        return [(save_jpeg(im, m['id']), '')]

    n = math.ceil(h / SLICE_TARGET)
    cuts = find_cuts(im, n)
    print('  · 长图 %s（%dpx）切点：%s  段高 %s'
          % (m['id'], h, cuts,
             [cuts[i + 1] - cuts[i] for i in range(len(cuts) - 1)]))
    units = []
    for i in range(len(cuts) - 1):
        top, bottom = cuts[i], cuts[i + 1]
        if bottom - top < 1:
            continue
        # 注意：切片不改宽度，保持原始 860px，交给 CSS 统一缩放
        units.append((save_jpeg(im.crop((0, top, w, bottom)),
                                '%s_s%d' % (m['id'], i + 1)),
                      '(%d/%d)' % (i + 1, n)))
    return units


def save_jpeg(im, stem):
    os.makedirs(ASSETS, exist_ok=True)
    name = stem + '.jpg'
    dst = os.path.join(ASSETS, name)
    im.convert('RGB').save(dst, 'JPEG', quality=JPEG_Q, subsampling=0,
                           optimize=True, dpi=(150, 150))
    return name


CSS = """
@page { size: 210mm 297mm; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: "PingFang SC", "Hiragino Sans GB", "Heiti SC",
               "Microsoft YaHei", sans-serif;
  color: #2b2b28; background: #fff;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
/* 每个 .sheet 正好一页。296mm 而不是 297mm：留 1mm 余量，
   否则四舍五入后可能溢出到下一页，多出空白页。 */
.sheet {
  width: 210mm; height: 296mm; padding: 12mm 12mm 10mm;
  page-break-after: always; break-after: page;
  overflow: hidden; display: flex; flex-direction: column;
}
.sheet:last-child { page-break-after: auto; break-after: auto; }
/* 某章最后只剩一张时居中 —— 左对齐会让人以为右边缺了一张 */
.sheet.solo .row { justify-content: center; }

.band {
  flex: none; display: flex; align-items: baseline; gap: 10px;
  margin-bottom: 6mm; padding-bottom: 3mm;
  border-bottom: 1.5px solid #c9a227;
}
.band h2 { margin: 0; font-size: 15pt; letter-spacing: 2px; color: #3a4a42; }
.band em { font-style: normal; font-size: 8.5pt; color: #8a8375; }

.row { flex: 1; display: flex; gap: 7mm; align-items: flex-start; }

.card { margin: 0; width: 89.5mm; }
.card .shot {
  display: flex; align-items: center; justify-content: center;
  height: 188mm; background: #e8e2d4; border-radius: 3mm;
  border: 0.4mm solid rgba(120, 100, 70, .25); overflow: hidden;
}
.card .shot img { display: block; max-width: 100%; max-height: 100%; }
.card figcaption { padding-top: 3mm; }
.card .t { display: flex; align-items: baseline; gap: 2.5mm; }
.card .t b { color: #b8912a; font-size: 10.5pt; }
.card .t span { font-size: 10.5pt; color: #2c3a33; }
.card .t i { font-style: normal; font-size: 8pt; color: #9a927f; }
.card p { margin: 1.5mm 0 0; font-size: 8pt; line-height: 1.65; color: #6d675c; }

.foot {
  flex: none; margin-top: 4mm; padding-top: 2.5mm;
  border-top: 0.4mm solid rgba(120, 100, 70, .22);
  display: flex; justify-content: space-between;
  font-size: 7.5pt; color: #9a927f;
}

/* ── 封面 ── */
.cover { justify-content: center; align-items: flex-start; background: #f4f0e4; }
.cover .kicker { font-size: 10pt; letter-spacing: 6px; color: #b8912a; }
.cover h1 { margin: 6mm 0 0; font-size: 40pt; letter-spacing: 8px; color: #23262c; }
.cover .sub { margin-top: 6mm; font-size: 13pt; letter-spacing: 2px; color: #4a544d; }
.cover .stats { margin-top: 12mm; display: flex; gap: 14mm; }
.cover .stats div { text-align: left; }
.cover .stats b { display: block; font-size: 22pt; color: #b8912a; }
.cover .stats span { font-size: 8.5pt; color: #6d675c; }
.cover .groups { margin-top: 14mm; }
.cover .groups div { font-size: 9.5pt; color: #4a544d; line-height: 2.1; }
.cover .groups em { font-style: normal; color: #b8912a; margin-right: 3mm; }
.cover .note { margin-top: 16mm; font-size: 8.5pt; line-height: 1.9; color: #8a8375; }
"""


def card_html(num, name, suffix, asset, note):
    return (
        '<figure class="card">'
        '<div class="shot"><img src="_pdf_assets/%s" alt="%s" loading="eager"></div>'
        '<figcaption>'
        '<div class="t"><b>%s</b><span>%s</span>%s</div>'
        '<p>%s</p>'
        '</figcaption></figure>' % (
            asset, name, num, name,
            ('<i>%s</i>' % suffix) if suffix else '',
            note or '&nbsp;'))


def main():
    # 每次重建前清空素材目录：切点数会随版式微调而变，
    # 留着旧切片会让「数出来的张数」和「实际用到的张数」对不上。
    if os.path.isdir(ASSETS):
        for f in os.listdir(ASSETS):
            if f.endswith('.jpg'):
                os.remove(os.path.join(ASSETS, f))

    with open(os.path.join(SRC, 'manifest.json'), encoding='utf-8') as f:
        man = {m['id']: m for m in json.load(f) if m.get('ok')}
    GROUPS, NOTE_FILL = load_gallery_meta()

    parts = ['<!DOCTYPE html>', '<html lang="zh-CN">', '<head>',
             '<meta charset="utf-8">', '<title>挪字成章 · 界面设计（全部页面）</title>',
             '<style>' + CSS + '</style>', '</head>', '<body>']

    # ── 封面 ──
    total_shots = len(man)
    parts.append(
        '<section class="sheet cover">'
        '<div class="kicker">微 信 小 游 戏 · 界 面 设 计</div>'
        '<h1>挪字成章</h1>'
        '<div class="sub">拆偏旁 · 挪对齐 · 拼成字</div>'
        '<div class="stats">'
        '<div><b>%d</b><span>个界面状态</span></div>'
        '<div><b>4</b><span>个章节</span></div>'
        '<div><b>38</b><span>个关卡</span></div>'
        '<div><b>103</b><span>个汉字</span></div>'
        '</div>'
        '<div class="groups">%s</div>'
        '<div class="note">本册为设计与开发阶段的界面记录稿。<br>'
        '每一张截图都是浏览器真实渲染的手机一屏，不是手绘稿。<br>'
        '对局界面为水墨牌面；首页 / 选关 / 图鉴 / 结算仍为国风浅色（待统一）。</div>'
        '</section>' % (
            total_shots,
            ''.join('<div><em>%s</em>%s</div>' % (g.split(' · ')[0], g.split(' · ')[-1])
                    for g, _ in GROUPS)))

    page = 0
    rows = []          # 收集每页内容，便于最后报数
    for gname, ids in GROUPS:
        cards = []
        for i in ids:
            m = man.get(i)
            if not m:
                print('⚠ 清单里缺：', i)
                continue
            num, name = i.split('-', 1)
            note = (m.get('note') or '').strip() or NOTE_FILL.get(i, '')
            for asset, suffix in slice_units(m):
                cards.append((num, name, suffix, asset, note))

        for ci in range(0, len(cards), PER_SHEET):
            chunk = cards[ci:ci + PER_SHEET]
            page += 1
            band = ('<div class="band"><h2>%s</h2><em>%d / %d 张</em></div>'
                    % (gname, len(cards), len(cards))) if ci == 0 else ''
            body = ''.join(card_html(*c) for c in chunk)
            solo = ' solo' if len(chunk) == 1 else ''
            parts.append(
                '<section class="sheet%s">%s<div class="row">%s</div>'
                '<div class="foot"><span>挪字成章 · 界面设计稿</span>'
                '<span>%02d</span></div></section>' % (solo, band, body, page + 1))
            rows.append((gname, [c[0] + c[2] for c in chunk]))

    parts.append('</body></html>')

    with open(OUT_HTML, 'w', encoding='utf-8') as f:
        f.write('\n'.join(parts))

    total_pages = page + 1
    n_assets = len([f for f in os.listdir(ASSETS) if f.endswith('.jpg')])
    size = sum(os.path.getsize(os.path.join(ASSETS, f))
               for f in os.listdir(ASSETS) if f.endswith('.jpg'))

    print('✓', OUT_HTML)
    print('  素材：%d 张 JPEG，合计 %.1f MB' % (n_assets, size / 1048576))
    print('  分页：封面 1 页 + 内容 %d 页 = 共 %d 页' % (page, total_pages))
    for g, cs in rows:
        print('    %-14s %s' % (g, ' '.join(c.ljust(8) for c in cs)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
