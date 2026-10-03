#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成《挪字成章》「节点素材候选 + 地图/章节页改版方案」拍板图。

产物（docs/verify/S6/nodes/）：
  00-节点素材候选.html        6 张素材卡（含参考锁）+ 「三态特写」
  01-地图页排布方案.html      现状 / 甲·缓蛇形 / 乙·山水错落
  02-标题下移放大对比.html    地图页 + 章节页，现状 vs 新版

设计口径
--------
· 画布按真机截图同尺寸 **540×960** 做（= 720 设计宽 × 0.75），
  所以 `K = 1.9355 × 0.75 = 1.4516` 即「1 设计px = 1.4516 CSS px」。
· 页面里所有坐标都先用**设计px**写，再乘 K —— 与工程 CFG/MapPage 的常量一一对应，
  用户拍板后可以直接把数字抄回代码。
· 字体用 PingFang SC；手机框只画页面本体，不画手机外框（避免和真机截图混淆）。
"""
import base64
import os

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
NODES = os.path.join(ROOT, 'docs', 'verify', 'S6', 'nodes')
UIP = os.path.join(ROOT, 'game-5-chaizi', 'assets', 'resources', 'ui')

K = 1.4516                      # 设计px → CSS px（540 宽画布）


def k(v):
    """设计px → CSS px（保留 2 位）"""
    return round(v * K, 2)


def uri(path):
    with open(path, 'rb') as f:
        return 'data:image/png;base64,' + base64.b64encode(f.read()).decode('ascii')


def wh(path):
    return Image.open(path).size


def kb(path):
    return os.path.getsize(path) / 1024.0


def show(path):
    """返回 (dataURI, '256×243', '47.1KB')"""
    w, h = wh(path)
    return uri(path), '%d×%d' % (w, h), '%.1fKB' % kb(path)


# ── 素材 ──────────────────────────────────────────────────────
MAT = {}
for key in ('trophy-A', 'trophy-B', 'trophy-C', 'mount-A', 'mount-B'):
    MAT[key] = show(os.path.join(NODES, key + '.png'))
MAT['lock'] = show(os.path.join(UIP, 'lock.png'))

CSS = """
*{box-sizing:border-box;margin:0;padding:0}
body{background:#e6e0d3;font-family:'PingFang SC','Hiragino Sans GB','Heiti SC',sans-serif;
     color:#2b2620;padding:30px 34px;-webkit-font-smoothing:antialiased}
h1{font-size:25px;letter-spacing:.5px;margin-bottom:8px}
.lead{font-size:14px;color:#6d665a;line-height:1.75;margin-bottom:22px;max-width:1500px}
.lead b{color:#b5352a}
.foot{font-size:13px;color:#6d665a;line-height:1.8;margin-top:20px}
.row{display:flex;gap:26px;align-items:flex-start;flex-wrap:wrap}
figure{display:flex;flex-direction:column;gap:10px;align-items:center}
figcaption{font-size:15px;font-weight:700;letter-spacing:.3px}
figcaption small{font-weight:400;color:#6d665a;font-size:12.5px;display:block;margin-top:3px;text-align:center}

/* ---------- 素材卡 ---------- */
.grid{display:grid;grid-template-columns:repeat(3,330px);gap:18px}
.card{background:#fff;border-radius:14px;padding:13px;box-shadow:0 1px 3px rgba(0,0,0,.10)}
.card .name{font-size:14.5px;font-weight:700;margin-bottom:2px}
.card .desc{font-size:11.5px;color:#8b8478;margin-bottom:9px;min-height:15px}
.chk{border-radius:9px;height:186px;display:flex;align-items:center;justify-content:center;
     background-color:#fff;background-image:
       linear-gradient(45deg,#dcdcdc 25%,transparent 25%),linear-gradient(-45deg,#dcdcdc 25%,transparent 25%),
       linear-gradient(45deg,transparent 75%,#dcdcdc 75%),linear-gradient(-45deg,transparent 75%,#dcdcdc 75%);
     background-size:16px 16px;background-position:0 0,0 8px,8px -8px,-8px 0}
.chk img{max-width:82%;max-height:82%;object-fit:contain}
.real{margin-top:9px;border-radius:8px;height:66px;display:flex;align-items:center;justify-content:center;
      background:radial-gradient(120% 80% at 50% 0%,#FCF8EF,#F6F0E2 45%,#EDE4D2 100%)}
.real img{width:84px;object-fit:contain}
.spec{margin-top:7px;font-size:11px;color:#8b8478;display:flex;justify-content:space-between}
.tag{display:inline-block;font-size:10.5px;border-radius:5px;padding:1.5px 6px;margin-left:6px;
     background:#f1ece0;color:#6d665a;vertical-align:1px}
.tag.pick{background:#e9f3f0;color:#2e7a70}

/* ---------- 手机框 ---------- */
.ph{position:relative;width:540px;height:960px;border-radius:26px;overflow:hidden;
    box-shadow:0 3px 14px rgba(0,0,0,.16);
    background:radial-gradient(120% 80% at 50% 0%,#FCF8EF,#F6F0E2 45%,#EDE4D2 100%);
    font-family:'PingFang SC','Hiragino Sans GB',sans-serif}
.ph .back{position:absolute;border-radius:50%;background:rgba(255,255,255,.70);
          border:1.5px solid rgba(150,130,95,.30);display:flex;align-items:center;justify-content:center}
.ph .cap{position:absolute;background:#3a3a3c;border-radius:100px;display:flex;align-items:center;
         justify-content:space-between;padding:0 11px}
.ph .cap i{display:block;width:4.4px;height:4.4px;border-radius:50%;background:#c8c8c8;margin-right:3px}
.ph .cap u{display:block;width:17px;height:17px;border-radius:50%;border:2.2px solid #e8e8e8;position:relative}
.ph .cap u:after{content:'';position:absolute;inset:3.6px;border-radius:50%;background:#e8e8e8}
.ph .ttl{position:absolute;font-weight:800;color:#2b2620;white-space:nowrap}
.ph .sub{position:absolute;color:#8b8478;white-space:nowrap}
.ph svg.path{position:absolute;inset:0;pointer-events:none}
.nd{position:absolute;transform:translate(-50%,-50%);display:flex;align-items:center;justify-content:center}
.nd .disc{position:absolute;width:99px;height:99px;border-radius:50%;
          background:rgba(255,255,255,.86);border:1.5px solid rgba(150,130,95,.18)}
.nd .disc.gold{background:linear-gradient(160deg,#fdf3d8,#f3e2b4);border:2.9px solid rgba(200,160,46,.42)}
.nd .disc.cur{background:rgba(255,255,255,.92);border:3.6px solid #b5352a;box-shadow:0 0 0 0 rgba(181,53,42,.35)}
.nd img.ic{position:relative}
.nd .num{position:absolute;font-weight:800;color:#2b2620;letter-spacing:-.5px;
         text-shadow:0 0 3px rgba(255,255,255,.95),0 0 3px rgba(255,255,255,.95),0 1px 0 rgba(255,255,255,.9)}
.nd .stars{position:absolute;font-size:11px;color:#c8a02e;letter-spacing:1px}
.nd .lnum{position:absolute;font-size:19px;font-weight:800;color:#2b2620}
.badge{position:absolute;font-size:10.5px;border-radius:5px;padding:2px 6px;background:#b5352a;color:#fff}

/* ---------- 章节卡 ---------- */
.cc{position:absolute;border-radius:25px;background:rgba(255,255,255,.86);
    border:1px solid rgba(150,130,95,.13);overflow:hidden;
    box-shadow:0 1px 3px rgba(0,0,0,.05)}
.cc .bar{position:absolute;left:0;top:14px;bottom:14px;width:5px;border-radius:3px;
         background:linear-gradient(180deg,#c8a02e,#b5352a)}
.cc .in{position:absolute;left:23px;right:23px}
.cc h3{font-size:24px;font-weight:800;letter-spacing:.2px}
.cc .s1{font-size:16px;color:#8b8478;margin-top:3px}
.cc .s2{font-size:20px;color:#2b2620;margin-top:8px;letter-spacing:5px}
.cc .meta{display:flex;justify-content:space-between;align-items:center;margin-top:10px;font-size:14px;color:#8b8478}
.cc .st{color:#c8a02e;letter-spacing:1px}
.cc .st .off{color:#e5cb74}
.cc.dim{opacity:.55}
"""


def phone_head(title, title_mode, sub=None, page='map'):
    """返回顶栏 HTML（绝对定位片段）。所有坐标是设计px→CSS"""
    back = '<div class="back" style="left:%spx;top:%spx;width:%spx;height:%spx">%s</div>' % (
        k(16), k(56), k(32), k(32),
        '<svg width="%s" height="%s" viewBox="0 0 20 20"><path d="M12.4 4.6 7 10l5.4 5.4" '
        'fill="none" stroke="#2b2620" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        % (k(15), k(15)))
    cap = ('<div class="cap" style="left:%spx;top:%spx;width:%spx;height:%spx">'
           '<div style="display:flex">%s%s%s</div><u></u></div>') % (
        540 - k(16) - k(79), k(56), k(79), k(31),
        '<i></i>', '<i></i>', '<i></i>')

    if title_mode == 'old':
        fs, lh = k(15), k(21)
        top = k(56 + 16) - lh / 2.0
    else:
        fs, lh = k(19), k(27)
        top = k(88) + k(8)
    ttl = '<div class="ttl" style="left:%spx;top:%spx;font-size:%spx;line-height:%spx">%s</div>' % (
        k(16 + 32 + 10), top, fs, lh, title)

    out = back + cap + ttl
    if sub:
        if title_mode == 'old':
            stop = k(96 + 2) + (k(17) - k(12)) / 2.0
        else:
            stop = k(88) + k(8) + k(27) + k(4) + (k(17) - k(12)) / 2.0
        out += '<div class="sub" style="left:%spx;top:%spx;font-size:%spx;line-height:%spx">%s</div>' % (
            k(20), stop, k(12), k(17), sub)
    return out


def nice(t, val):
    """标注小签：模型给的相对值"""
    return t


# ── 排布方案 ───────────────────────────────────────────────────
import math

NLEV = 8
Y0_D = 153.6                 # 第 1 关圆心的**设计**y（= 截图实测 223 CSS ÷ K）
AMD = 132.0                  # 现状三列的最大横向偏移（设计px）
# ★ 标题下移 28 设计px ⇒ 列表起点跟着下移，节点也要跟着下移，
#   否则奖杯会压到副标题上（第一版就踩了这个坑，截图上一眼可见）。
LIST_SHIFT_D = 28.0


def scheme_pos(scheme, shift_d=0.0):
    """返回 [(x_off_design, y_css)]，i = 0..NLEV-1；shift_d = 列表整体下移量（设计px）"""
    y0 = Y0_D + shift_d
    pts = []
    if scheme == 'now':
        cols = [-AMD, 0.0, AMD]
        step = 78.0                       # ROW_STEP
        for i in range(NLEV):
            pts.append((cols[i % 3], k(y0 + step * i)))
    elif scheme == 'a':
        # 甲 · 缓蛇形：x = -A·cos(2πi/6)，周期 6 关的平滑 S
        step = 78.0
        for i in range(NLEV):
            x = -AMD * math.cos(2 * math.pi * i / 6.0)
            pts.append((x, k(y0 + step * i)))
    else:
        # 乙 · 山水错落：振幅由上到下渐开（0.70A → 1.0A）
        #                   步距由上密到下疏（0.86 → 1.14 倍 ROW_STEP）
        y = k(y0)
        for i in range(NLEV):
            amp = AMD * (0.70 + 0.30 * i / (NLEV - 1.0))
            x = -amp * math.cos(2 * math.pi * i / 6.0)
            pts.append((x, y))
            y += k(78.0 * (0.86 + 0.28 * i / (NLEV - 1.0)))
    return pts


def map_phone(scheme, title_mode='old', trophy='trophy-A', mount='mount-A',
              trophy_num=False, label=''):
    pts = scheme_pos(scheme, LIST_SHIFT_D if title_mode == 'new' else 0.0)
    cur = 2                                   # 第 3 关 = 当前可攻打
    svg = ['<svg class="path" width="540" height="960" viewBox="0 0 540 960">']
    d = 'M %.2f %.2f' % (270 + k(pts[0][0]), pts[0][1])
    for xo, y in pts[1:]:
        d += ' L %.2f %.2f' % (270 + k(xo), y)
    svg.append('<path d="%s" fill="none" stroke="#b5352a" stroke-opacity="0.26" '
               'stroke-width="%s" stroke-dasharray="%s %s"/>' % (d, k(2), k(5), k(8)))
    svg.append('</svg>')

    body = []
    for i, (xo, y) in enumerate(pts):
        x = 270 + k(xo)
        if i < cur:                            # 已通关 → 奖杯
            img = '<img class="ic" src="%s" style="width:%spx">' % (MAT[trophy][0], k(56))
            if trophy_num:
                img += '<div class="num" style="font-size:%spx">%d</div>' % (k(22), i + 1)
            body.append('<div class="nd" style="left:%.2fpx;top:%.2fpx">%s</div>' % (x, y, img))
        elif i == cur:                         # 当前 → 山 + 数字
            body.append(
                '<div class="nd" style="left:%.2fpx;top:%.2fpx">'
                '<img class="ic" src="%s" style="width:%spx">'
                '<div class="num" style="font-size:%spx;margin-top:-3px">%d</div>'
                '</div>' % (x, y, MAT[mount][0], k(76), k(24), i + 1))
            body.append('<div class="nd" style="left:%.2fpx;top:%.2fpx">'
                        '<div style="width:%spx;height:%spx;border-radius:50%%;'
                        'border:%spx solid rgba(181,53,42,.50)"></div></div>'
                        % (x, y, k(88), k(88), k(1.8)))
        else:                                  # 未通关 → 锁
            body.append('<div class="nd" style="left:%.2fpx;top:%.2fpx">'
                        '<div class="disc"></div>'
                        '<img class="ic" src="%s" style="width:%spx"></div>'
                        % (x, y, MAT['lock'][0], k(58)))

    return ('<div class="ph">%s%s%s</div>'
            % (''.join(svg), phone_head('第一章 · 木字营', title_mode,
                                        '共 8 关 · 已通关 2 关'),
               ''.join(body)))


CHAPS = [
    ('第一章 · 木字营', '十八般兵器 · 木 / 钅 / 草 / 竹', '枪棍锤钩棒镰', '★☆☆', '2/8', '可挑战', False),
    ('第二章 · 花间集', '花卉草木 · 木 / 艹', '桃柳梅 花莲松', '☆☆☆', '0/8', '通关上一章解锁', True),
    ('第三章 · 逛三园', '果园 / 动物园 / 植物园', '杏李柿蕉莓蔗', '☆☆☆', '0/12', '通关上一章解锁', True),
    ('第四章 · 百工坊', '民俗器物 · 火 / 竹 / 钅 / 纟', '灯炉烛针钉钟', '☆☆☆', '0/10', '通关上一章解锁', True),
]


def chap_phone(title_mode='old'):
    top = k(127) if title_mode == 'old' else k(155)
    card_h = k(120)
    cards = []
    y = top
    for name, s1, s2, st, prog, state, dim in CHAPS:
        cls = 'cc dim' if dim else 'cc'
        cards.append(
            '<div class="%s" style="left:%spx;top:%.2fpx;width:%spx;height:%.2fpx">'
            '<div class="bar"></div><div class="in" style="top:%spx">'
            '<h3>%s</h3><div class="s1">%s</div><div class="s2">%s</div>'
            '<div class="meta"><span><span class="st">%s</span> %s</span><span>%s</span></div>'
            '</div></div>' % (cls, k(16), y, 540 - 2 * k(16), card_h, k(15), name, s1, s2, st, prog, state))
        y += card_h + k(12)
    return '<div class="ph">%s%s</div>' % (phone_head('选择章节', title_mode), ''.join(cards))


def card(key, name, desc, pick=False, note=''):
    u, sz, s = MAT[key]
    tag = '<span class="tag pick">%s</span>' % note if pick else (
        '<span class="tag">%s</span>' % note if note else '')
    return ('<div class="card"><div class="name">%s%s</div><div class="desc">%s</div>'
            '<div class="chk"><img src="%s"></div>'
            '<div class="real"><img src="%s"></div>'
            '<div class="spec"><span>%s</span><span>%s</span></div></div>'
            % (name, tag, desc, u, u, sz, s))


def page(title, lead, inner, foot=''):
    return ('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
            '<style>%s</style></head><body><h1>%s</h1><p class="lead">%s</p>%s'
            '<p class="foot">%s</p></body></html>' % (CSS, title, lead, inner, foot))


# ============================================================
#  00 · 节点素材候选
# ============================================================
def build00():
    cards = [
        card('trophy-A', '奖杯 A · 经典双耳',
             '杯身饱满、两耳对称 —— 最像“奖杯”', pick=True, note='推荐'),
        card('trophy-B', '奖杯 B · 圆胖萌杯',
             '矮墩圆润、更 Q，但缩到 58px 像小罐子'),
        card('trophy-C', '奖杯 C · 极简无耳',
             '三块大形、无碎细节，小尺寸最清楚'),
        card('mount-A', '山峦 A · 双峰',
             '两个圆头峰 + 水波山脚，最简', pick=True, note='推荐'),
        card('mount-B', '山峦 B · 三峰叠影',
             '近浓远淡三层，最像“山”'),
        card('lock', '锁 · 现有（参考基准）',
             '已在用的 Q 版挂锁 —— 新素材都向它看齐'),
    ]
    # 三态特写
    trio = """
<div style="margin-top:26px;display:flex;gap:20px;align-items:flex-start">
  <figure><figcaption>① 已通关 · 奖杯<small>纯图标 · 无底圈</small></figcaption>
    <div class="ph" style="width:232px;height:232px;border-radius:20px">
      <div class="nd" style="left:116px;top:116px"><img class="ic" src="%s" style="width:104px"></div>
    </div></figure>
  <figure><figcaption>② 已通关 · 奖杯 + 关号<small>保留数字（备选）</small></figcaption>
    <div class="ph" style="width:232px;height:232px;border-radius:20px">
      <div class="nd" style="left:116px;top:116px"><img class="ic" src="%s" style="width:104px">
      <div class="num" style="font-size:38px">1</div></div>
    </div></figure>
  <figure><figcaption>③ 已通关 · 奖杯 + 三星<small>保留星级（备选）</small></figcaption>
    <div class="ph" style="width:232px;height:232px;border-radius:20px">
      <div class="nd" style="left:116px;top:130px"><img class="ic" src="%s" style="width:104px"></div>
      <div class="nd" style="left:116px;top:56px">
        <div style="font-size:20px;letter-spacing:2px;color:#c8a02e;
        text-shadow:0 1px 0 #fff">★★★</div></div>
    </div></figure>
  <figure><figcaption>④ 即将攻打 · 山 + 数字<small>红细环 = 当前关</small></figcaption>
    <div class="ph" style="width:232px;height:232px;border-radius:20px">
      <div class="nd" style="left:116px;top:110px"><img class="ic" src="%s" style="width:138px">
      <div class="num" style="font-size:44px;margin-top:-6px">3</div></div>
      <div class="nd" style="left:116px;top:110px"><div style="width:160px;height:160px;
        border-radius:50%%;border:3.3px solid rgba(181,53,42,.50)"></div></div>
    </div></figure>
  <figure><figcaption>⑤ 未通关 · 锁<small>沿用现有，不动</small></figcaption>
    <div class="ph" style="width:232px;height:232px;border-radius:20px">
      <div class="nd" style="left:116px;top:116px"><div class="disc"></div>
      <img class="ic" src="%s" style="width:104px"></div>
    </div></figure>
</div>""" % (MAT['trophy-A'][0], MAT['trophy-A'][0], MAT['trophy-A'][0],
             MAT['mount-A'][0], MAT['lock'][0])

    inner = '<div class="grid">%s</div>%s' % (''.join(cards), trio)
    foot = ('每张卡下半格是「缩到 84px 实际显示」的样子（= 58 设计px），请重点看这一格 —— '
            '奖杯 B 在这一格里已经看不太出是奖杯了，奖杯 A 仍然一眼认得出。<br>'
            '三态特写里 <b>①/②/③ 是「奖杯要不要保留关号 / 星级」的三个备选</b>（① 最干净、③ 信息最全），'
            '④ 的红色细环用来标出“当前关”。<br>'
            '⚠️ 山峦 B 上一版被抠图脚本抠穿了（浅灰蓝的远山被当成背景吃掉，只剩一块平顶墨块）；'
            '已修脚本的容差自适应逻辑后重跑，本图是修好的结果。')
    return page('节点素材候选 · 《挪字成章》关卡地图页',
                '全部为 <b>AI 文生图</b>（ImageGen）→ 白底 flood-fill 抠图 → 256px 入库，'
                '风格向已在用的 Q 版挂锁看齐：暖棕粗描边 + 平滑渐变 + 一道高光。'
                '画面里没有任何文字数字（关号由引擎叠加，避免 AI 写错字）。',
                inner, foot)


# ============================================================
#  01 · 地图页排布方案
# ============================================================
def build01():
    a = '<figure><figcaption>甲 · 缓蛇形<small>平滑 S 曲线（周期 6 关）<br>行距均匀</small></figcaption>%s</figure>' % map_phone('a')
    b = '<figure><figcaption>乙 · 山水错落<small>振幅上窄下宽 + 上密下疏<br>像一条从山上流下来的溪</small></figcaption>%s</figure>' % map_phone('b')
    n = '<figure><figcaption>现行 · 三列轮转<small>左/中/右 三个固定位置来回跳<br>（"生硬"的来源）</small></figcaption>%s</figure>' % map_phone('now')
    inner = '<div class="row">%s%s%s</div>' % (n, a, b)
    foot = ('三张图的节点素材、标题位置、配色**完全相同**，<b>只有排布算法不同</b>（只变一个变量，才能归因）：'
            '现行是 `x = 三列离散值`（左/中/右来回横跳，且行距恒为 78 设计px）；<br>'
            '甲 / 乙 把它换成一条连续曲线 —— '
            '<b>甲</b>：`x = −132·cos(2πi/6)`（设计px），周期 6 关；'
            '<b>乙</b>：在甲的基础上再让振幅从 0.70×132 渐开到 132、行距从 0.86×78 渐增到 1.14×78。')
    return page('地图页排布方案 · 三个并排', '同一个章节（8 关），只有关卡怎么摆不同。',
                inner, foot)


# ============================================================
#  02 · 标题下移放大
# ============================================================
def build02():
    m1 = '<figure><figcaption>地图页 · 现状<small>标题与返回键同高 · 15 设计px</small></figcaption>%s</figure>' % map_phone('a', 'old')
    m2 = '<figure><figcaption>地图页 · 新版<small>标题下移 37px 设计值 + 放大到 19</small></figcaption>%s</figure>' % map_phone('a', 'new')
    c1 = '<figure><figcaption>章节页 · 现状<small>标题与返回键同高 · 15 设计px</small></figcaption>%s</figure>' % chap_phone('old')
    c2 = '<figure><figcaption>章节页 · 新版<small>标题下移 + 放大到 19</small></figcaption>%s</figure>' % chap_phone('new')
    inner = '<div class="row">%s%s</div><div class="row" style="margin-top:30px">%s%s</div>' % (m1, m2, c1, c2)
    foot = ('改法只有两条：<b>① 标题不再与返回键垂直居中，改为落在返回键下方自成一行</b>'
            '（中心从距顶 72 → 109 设计px）；<b>② 字号 15 → 19 设计px</b>。'
            '副标题与列表起点随之下移 28 设计px（列表从 127 → 155）。')
    return page('标题下移 + 放大 · 地图页与章节页', '同一套改法用在两个页面上，左右直接对照。',
                inner, foot)


for name, html in (('00-节点素材候选', build00()),
                   ('01-地图页排布方案', build01()),
                   ('02-标题下移放大对比', build02())):
    p = os.path.join(NODES, name + '.html')
    with open(p, 'w', encoding='utf-8') as f:
        f.write(html)
    print('写下 %s  %.0f KB' % (p, os.path.getsize(p) / 1024))
