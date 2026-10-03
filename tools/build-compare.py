#!/usr/bin/env python3
"""构建对照页：旧版手绘字形 vs 新版真毛笔楷书（纯字 / 字+物象）。

用法: build-compare.py <输出html> <字...>
"""
import io, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, 'design')
NODE = '/Users/consli/.workbuddy/binaries/node/versions/22.22.2-3/bin/node'


def rd(fn):
    return io.open(os.path.join(D, fn), encoding='utf-8').read()


def main():
    out, chars = sys.argv[1], sys.argv[2:]
    for fn in ('glyphs-data.js', 'brush.js', 'imagery.js', 'glyph-engine.js'):
        p = os.path.join(D, fn)
        if not os.path.exists(p):
            continue
        r = subprocess.run([NODE, '--check', p], capture_output=True, text=True)
        if r.returncode != 0:
            print(f'✗ {fn}: ' + r.stderr.strip().split('\n')[0])
            sys.exit(1)

    def cells(cls, chs):
        return ''.join(
            f'<div class="c"><div class="pad"><svg class="{cls}" viewBox="0 0 1000 1000" data-ch="{c}"></svg></div>'
            f'<div class="lbl">{c}</div></div>' for c in chs)

    cols = max(len(chars), 2)
    js = [rd('glyphs-data.js'), rd('brush.js'), rd('imagery.js'), rd('glyph-engine.js')]

    paint = '''
function paintNew(svg, withObj){
  var ch=svg.dataset.ch, s='';
  if(withObj && InkImagery.has(ch)) s += '<g class="obj">'+InkImagery.back(ch)+'</g>';
  s += '<path class="mo" d="'+(InkGlyphs.path(ch)||'')+'"/>';
  if(withObj && InkImagery.has(ch)) s += '<g class="obj2">'+InkImagery.front(ch)+'</g>';
  svg.innerHTML = s;
}
try{
  document.querySelectorAll('.plain').forEach(function(s){ paintNew(s,false); });
  document.querySelectorAll('.withobj').forEach(function(s){ paintNew(s,true); });
  document.querySelectorAll('.old').forEach(function(s){
    var ch=s.dataset.ch;
    s.innerHTML = (typeof glyphSVG==='function' && glyphSVG(ch)) ? glyphSVG(ch) : '<text x="500" y="600" font-size="300" text-anchor="middle" fill="#aaa">—</text>';
  });
}catch(e){ document.title='ERR: '+(e&&e.message||e); }
window.addEventListener('load',function(){
  var n=document.querySelectorAll('path.mo').length;
  if(document.title.indexOf('ERR')!==0) document.title='OK/'+n+'字';
});
'''

    html = f'''<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>挪字成章 · 字形第二版对照</title>
<style>
{rd('ink.css')}
body{{margin:0;padding:26px 34px 48px;font-family:var(--kai);max-width:1340px}}
h1{{font-size:24px;font-weight:700;color:var(--mo-1);margin:6px 0 4px;letter-spacing:.16em}}
.sub{{font-size:14px;color:var(--mo-3);margin-bottom:22px;letter-spacing:.06em}}
h2{{font-size:16px;font-weight:400;color:var(--mo-3);margin:30px 0 12px;letter-spacing:.12em}}
h2 b{{color:var(--mo-1);font-weight:700}}
h2 span{{font-size:13px;color:var(--mo-4);margin-left:10px;letter-spacing:0}}
.grid{{display:grid;grid-template-columns:repeat({cols},1fr);gap:18px}}
.c{{text-align:center}}
.pad{{width:100%;aspect-ratio:1;background:var(--zhi-1);box-shadow:0 0 0 1px rgba(120,110,86,.24)}}
svg{{width:100%;height:100%;display:block;overflow:visible}}
.mo{{fill:url(#moGrad);filter:url(#inkMo)}}
.obj path,.obj2 path{{filter:url(#inkThin)}}
.lbl{{margin-top:5px;font-size:14px;color:var(--mo-3)}}
.note{{font-size:14px;line-height:2;color:var(--mo-2);background:rgba(255,255,255,.42);
      padding:16px 20px;border-left:3px solid var(--mo-4);margin:10px 0 4px}}
.note b{{color:var(--mo-1)}}
.opts{{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:8px}}
.opt{{background:rgba(255,255,255,.5);padding:14px 16px;box-shadow:0 0 0 1px rgba(120,110,86,.22)}}
.opt h3{{font-size:15px;margin:0 0 8px;color:var(--mo-1);letter-spacing:.08em}}
.opt p{{font-size:13px;line-height:1.85;color:var(--mo-2);margin:0}}
.opt .tag{{display:inline-block;font-size:11px;color:#fdf6ea;background:var(--mo-3);
          padding:1px 7px;border-radius:2px;margin-left:6px;vertical-align:2px}}
.opt .tag.rec{{background:var(--zhu)}}
</style></head><body class="paper">
{rd('ink-defs.svg')}
<h1>挪字成章 · 字形第二版对照</h1>
<div class="sub">弃用手绘折线骨架，改用真毛笔楷书轮廓；物象从「彩色贴纸」改为「淡墨写意」</div>

<div class="note">
上一版丑的根因有三条，这版逐条换掉了：<br>
<b>① 骨架是手画的</b> —— 拿折线随手定坐标，撇捺比例失衡，笔迹等宽圆头像铁丝。
　→ 改为从开源毛笔楷书（<b>马善政毛笔楷书</b>，SIL OFL 1.1）抽取<b>真实矢量轮廓</b>，共 275 字，全项目统一变换归一化。<br>
<b>② 笔没有墨</b> —— 等宽色块填充，没有起笔的顿、行笔的提按、收笔的出锋。
　→ 改为「毛边 + 双副本错位叠墨（浓墨主体 + 淡墨洇影）+ 渗化晕 + 蘸一次墨写到底的浓淡渐变」。<br>
<b>③ 物象是彩色贴纸</b> —— 赭石叶、玉青叶、粉花瓣、蓝枪头，彩色和墨一样浓，全在抢主体。
　→ 改为<b>全用淡墨</b>的写意笔触（起笔顿、收笔出锋成尖、末端渐隐），<b>从字形笔画的末端长出去</b>；
　　 全图最多点一处<b>朱砂</b>（枪的红缨、梅的花心、火的火星）—— 水墨画的美感来自「惜色如金」。
</div>

<h2>① 旧版 <span>手绘折线骨架 + 等宽笔画 + 彩色贴纸</span></h2>
<div class="grid">{cells('old', chars)}</div>
<h2>② 新版 · <b>纯墨字</b> <span>真毛笔楷书轮廓 + 墨化，不加物象</span></h2>
<div class="grid">{cells('plain', chars)}</div>
<h2>③ 新版 · <b>墨字 + 淡墨物象</b> <span>物象从笔画末端长出去，全用淡墨，画眼点一处朱砂</span></h2>
<div class="grid">{cells('withobj', chars)}</div>

<h2>待拍板：物象走哪条路</h2>
<div class="opts">
  <div class="opt">
    <h3>A 字 + 淡墨物象<span class="tag rec">本稿方向</span></h3>
    <p>字保持完整漂亮的楷书，物象用淡墨在留白处「长」出去（木的横长出枝叶、枪的木旁拉成枪杆）。
    认字 100% 不受影响，且物象不抢主体。<b>这是第 ③ 行。</b>可直接铺开到全部 120 字。</p>
  </div>
  <div class="opt">
    <h3>B 字物合一（笔画变形成物）</h3>
    <p>把笔画本身改造成物：木的竖长成树干、枪的「仓」变枪头。
    最贴近你最初的设想，但需要改字形轮廓、逐字重画，<b>返工量大，且可辨认度会掉</b>，要再来两三轮迭代。</p>
  </div>
  <div class="opt">
    <h3>C 只要纯墨字</h3>
    <p>不加任何物象，靠楷书本身的象形感（木天生像树、火天生像火焰）。
    <b>最干净、最耐看</b>，第 ② 行。代价是「拆字」的象形趣味只剩字形本身。</p>
  </div>
</div>
<script>{js[0]}</script><script>{js[1]}</script><script>{js[2]}</script><script>{js[3]}</script>
<script>{paint}</script>
</body></html>'''
    io.open(out, 'w', encoding='utf-8').write(html)
    print(f'✓ {out}')


if __name__ == '__main__':
    main()
