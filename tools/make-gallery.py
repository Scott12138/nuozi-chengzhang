#!/usr/bin/env python3
"""由 shots/all-pages/manifest.json 生成一份「页面画廊」HTML。

为什么还要画廊：总览图是给「一眼扫」用的，缩略后细节看不清；
画廊把每张按原比例铺开、点击即开原图，适合逐页评审字牌与留白。

分组是按评审动线排的（入口 → 选关 → 对局 → 结算 → 图鉴设置），
不是按文件名顺序 —— 评审时顺着走一遍就知道玩家会看到什么。

【依赖】受管 venv 里的 Python 即可（纯标准库，无第三方）。
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'shots', 'all-pages')
OUT = os.path.join(SRC, '页面画廊.html')

GROUPS = [
    ('一 · 入口', ['01-启动页', '02-首页-初见', '03-首页-有进度']),
    ('二 · 选关路径', ['04-章节选择', '05-关卡地图-第一章', '06-关卡地图-第三章']),
    ('三 · 对局玩法', ['07-对局-第1关', '08-对局-拖动中', '09-对局-第24关鸟字组',
                    '10-对局-提示引导', '11-对局-终章', '18-干扰牌提示']),
    ('四 · 结算与弹窗', ['12-通关结算', '13-失败结算', '14-激励视频弹窗']),
    ('五 · 图鉴与设置', ['15-图鉴-未解锁', '16-图鉴-已解锁', '17-设置']),
]

TALL = 2200     # 与拼图脚本同一判据：超过就当长页，用固定高度 + 顶部对齐预览

# 截图脚本里没写 note 的状态，在这里补一句「这张该看什么」，
# 免得画廊里出现一片空白注释区
NOTE_FILL = {
    '01-启动页': '进度条约 1 秒后自动进首页；冷启动时看到的第一个画面',
    '02-首页-初见': '新档状态，三个统计都是 0',
    '04-章节选择': '四章卡片：可挑战 / 通关上一章解锁，各带 6 个预览字',
    '05-关卡地图-第一章': '8 关小径，含已通关（带星）/ 当前关（红圈）/ 未解锁（灰）三种节点',
    '07-对局-第1关': '教学关：一上来就是木 / 钅两种偏旁；灰牌带朱砂斜划的是干扰牌',
    '11-对局-终章': '7×7 棋盘、8 个目标字、火竹钅纟 四偏旁混排',
    '12-通关结算': '三星 + 本关四个成字的拆解（偏旁＋部件＝字）+ 下一关',
    '13-失败结算': '看视频复活 / 重来一局 / 返回地图',
    '14-激励视频弹窗': '从失败页触发的激励视频；原型里是模拟广告位（真机接 wx.createRewardedVideoAd）',
    '15-图鉴-未解锁': '一次都没玩过时的图鉴：一律显示「？」',
    '17-设置': '三个开关（音乐/音效/振动）+ 玩法速记',
}

CSS = """
*{box-sizing:border-box}
body{margin:0;background:#e8e2d4;color:#2b2b28;
  font-family:-apple-system,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;}
header{padding:34px 30px 18px;border-bottom:1px solid rgba(120,100,70,.22);
  position:sticky;top:0;background:rgba(232,226,212,.94);backdrop-filter:blur(8px);z-index:9;}
h1{margin:0;font-size:26px;letter-spacing:1px;}
h1 small{display:block;margin-top:8px;font-size:13px;font-weight:400;color:#6d675c;line-height:1.7;}
h2{margin:38px 30px 4px;font-size:17px;letter-spacing:1px;color:#3a4a42;}
h2::after{content:'';display:block;margin-top:10px;height:2px;width:44px;background:#c9a227;border-radius:2px;}
.grid{display:grid;gap:22px;padding:14px 30px 60px;
  grid-template-columns:repeat(auto-fill,minmax(280px,1fr));}
.card{margin:0;background:#f9f6ee;border-radius:16px;overflow:hidden;
  box-shadow:0 8px 22px rgba(70,55,30,.13);border:1px solid rgba(120,100,70,.16);}
.card .bar{display:flex;align-items:baseline;gap:9px;padding:13px 16px 11px;
  background:#2c3a33;color:#f2e6c8;}
.card .bar b{color:#c9a227;font-size:15px;}
.card .bar span{font-size:15px;}
.card a{display:block;background:#efe9db;}
.card img{display:block;width:100%;}
.card.tall img{height:520px;object-fit:cover;object-position:top;}
.card p{margin:0;padding:11px 16px 15px;font-size:12px;line-height:1.75;color:#6d675c;
  min-height:52px;}
.hint{padding:0 30px 26px;font-size:12px;color:#6d675c;}
.hint code{background:#f0ead9;padding:1px 6px;border-radius:5px;font-size:11px;}
"""


def main():
    with open(os.path.join(SRC, 'manifest.json'), encoding='utf-8') as f:
        man = {m['id']: m for m in json.load(f) if m.get('ok')}

    parts = ['<!DOCTYPE html>', '<html lang="zh-CN">', '<head>', '<meta charset="utf-8">',
             '<meta name="viewport" content="width=device-width,initial-scale=1">',
             '<title>挪字成章 · 全部页面</title>', '<style>' + CSS + '</style>',
             '</head>', '<body>',
             '<header><h1>挪字成章 · 全部页面（18 张）'
             '<small>每一张都是无头浏览器真实渲染的手机一屏 · 点图看原尺寸<br>'
             '对局界面已换水墨牌面；首页 / 选关 / 图鉴 / 结算仍是国风浅色</small></h1></header>']

    missing = []
    for gname, ids in GROUPS:
        parts.append('<h2>%s</h2>' % gname)
        parts.append('<div class="grid">')
        for i in ids:
            m = man.get(i)
            if not m:
                missing.append(i)
                continue
            num, name = i.split('-', 1)
            tall = ' tall' if m['h'] > TALL else ''
            tip = ('（长页，此处只显示首屏；点开看完整）' if tall else '')
            note = (m.get('note') or '').strip() or NOTE_FILL.get(i, '　')
            parts.append(
                '<figure class="card%s">'
                '<div class="bar"><b>%s</b><span>%s</span></div>'
                '<a href="%s" target="_blank" rel="noopener"><img src="%s" alt="%s" loading="lazy"></a>'
                '<p>%s%s</p></figure>' % (
                    tall, num, name, m['file'], m['file'], name, note, tip))
        parts.append('</div>')

    parts.append('<p class="hint">原图目录 <code>shots/all-pages/</code> · '
                 '总览大图 <code>总览-全部页面.png</code> · '
                 '需要重出时跑 <code>node tools/shot-pages.js</code> 再跑两个生成脚本</p>')
    parts.append('</body></html>')

    with open(OUT, 'w', encoding='utf-8') as f:
        f.write('\n'.join(parts))
    print('✓', OUT, len(man), '张')
    if missing:
        print('⚠ 清单里缺这些状态（截图没跑成？）：', ' '.join(missing))
    return 0


if __name__ == '__main__':
    sys.exit(main())
