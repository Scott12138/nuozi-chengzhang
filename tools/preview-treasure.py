#!/usr/bin/env python3
"""宝牌试样页 —— 三套配色 × 全部器物，供拍板与自检。

【为什么必须"并排比"，而不是单看一张宝牌】
宝牌的设计目标不是"自己好看"，而是**在一盘字牌里一眼被认出来**。
单独放大看时，三套配色都好看；只有把它和「枪 / 木 / 仓」摆在一起、
缩到真实牌面尺寸（128px 贴图在盘面上约 53~64px），
才能看出"哪个在扫视时跳得出来、哪个淹进纸里"。

页面分四段：
  ① 放大（340px）：看**造型** —— 明暗块面、结构细节、外描边、接触投影
  ② 混盘（64px） ：看**辨识度** —— 与字牌并排，扫一眼跳不跳得出来
  ③ 八件器物（200px）：看每一件是否"像它自己"
  ④ 易撞形对照（96px）：水盆/果盘、花瓶/陶罐 这些同章近形件，缩到真实尺寸还分不分得开

自检约定：结果写进 document.title —— OK/<n>牌/<n>元素，出错则 ERR: 消息。
（SVG 里 filter / clipPath 引用一旦失效，元素会**静默不渲染**，
光看截图会误判成"样式没生效"。）

用法： preview-treasure.py <输出html>
"""
import io
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, 'design')
NODE = '/Users/consli/.workbuddy/binaries/node/versions/22.22.2-3/bin/node'
JS_FILES = ('glyphs-data.js', 'brush.js', 'imagery.js', 'ink-tile.js', 'ink-treasure.js')

PALS = ['zhu', 'wu', 'sajin']
ITEMS = ['x_ch1_01', 'x_ch2_01', 'x_ch2_02', 'x_ch3_01', 'x_ch3_02', 'x_ch4_01', 'x_ch4_02', 'x_ch4_03']
# 混排用的普通字牌：第一章的字 + 偏旁 + 部件，正好覆盖"牌面上会出现的三类"
NORMALS = ['枪', '木', '仓']
# 易撞形对照：同一章里形状最接近的几件并排
CLASH = ['x_ch2_01', 'x_ch2_02', 'x_ch3_01', 'x_ch4_01', 'x_ch4_02', 'x_ch3_02']


def main():
    out = sys.argv[1]
    for fn in JS_FILES:
        r = subprocess.run([NODE, '--check', os.path.join(D, fn)], capture_output=True, text=True)
        if r.returncode != 0:
            print('✗ %s: %s' % (fn, r.stderr.strip().split('\n')[0]))
            sys.exit(1)

    rd = lambda f: io.open(os.path.join(D, f), encoding='utf-8').read()
    js = [rd(f) for f in JS_FILES]

    # ① 大图：三套配色 × 第一章「铁砧」
    big = ''.join(
        '<div class="w"><svg class="t big" viewBox="0 0 1000 1000" data-tr="%s" data-pal="%s"></svg>'
        '<div class="lb">%s</div></div>' % (ITEMS[0], p, p) for p in PALS)

    # ② 真尺寸混排：三行，每行「3 张字牌 + 2 张宝牌」（同一套配色）
    rows = ''
    for p in PALS:
        cell = ''.join('<svg class="t sm" viewBox="0 0 1000 1000" data-ch="%s"></svg>' % c
                       for c in NORMALS)
        cell += ''.join('<svg class="t sm" viewBox="0 0 1000 1000" data-tr="x_ch1_01" data-pal="%s"></svg>' % p
                        for _ in range(2))
        rows += '<div class="mixrow"><span class="tag">%s</span>%s</div>' % (p, cell)

    # ③ 其余器物
    others = ''.join(
        '<div class="w"><svg class="t mid" viewBox="0 0 1000 1000" data-tr="%s" data-pal="zhu"></svg>'
        '<div class="lb">%s</div></div>' % (k, k) for k in ITEMS)

    # ④ 易撞形对照（真实牌面尺寸）
    clash = ''.join(
        '<div class="w"><svg class="t tiny" viewBox="0 0 1000 1000" data-tr="%s" data-pal="zhu"></svg>'
        '<div class="lb">%s</div></div>' % (k, k) for k in CLASH)

    html = '''<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>宝牌试样</title><style>
body{margin:0;padding:22px 26px 30px;background:#ded7c6;
     font-family:"Kaiti SC","STKaiti","Songti SC",serif;color:#4a4438}
h2{font-size:17px;margin:20px 0 10px;letter-spacing:.12em;font-weight:normal}
h2:first-child{margin-top:0}
.note{font-size:12px;color:#7a7266;margin:-4px 0 12px;letter-spacing:.04em}
.row{display:flex;gap:26px;flex-wrap:wrap;align-items:flex-start}
.w{text-align:center}
.t{display:block;box-shadow:0 2px 9px rgba(50,40,25,.30)}
.big{width:340px;height:340px;border-radius:11px}
.mid{width:200px;height:200px;border-radius:7px}
.sm{width:64px;height:64px;border-radius:3px}
.tiny{width:96px;height:96px;border-radius:5px}
.lb{margin-top:7px;font-size:13px;color:#5a5347;letter-spacing:.14em}
.mixrow{display:flex;align-items:center;gap:8px;margin-bottom:12px}
.mixrow .tag{width:52px;font-size:12px;color:#6a6256;letter-spacing:.1em}
</style></head><body>
<!-- ★ SVG 滤镜定义必须内联进同一个文档：外部 <use>/href 引用在 file:// 下取不到，
     表现为「牌面渲染出来了但帘纹、陈纸、墨韵全没有」——不会报错，只会静默变平。 -->
<div style="position:absolute;width:0;height:0;overflow:hidden">%s</div>
<h2>① 造型放大（第一章「铁砧」· 三套配色）</h2>
<div class="note">看的是：砧面/砧腰/砧座能不能分出来；有没有砧孔这处特征；器物的外描边是否干净；底下有没有一点接触投影。</div>
<div class="row">%s</div>

<h2>② 混盘辨识度（真实尺寸 64px，与字牌并排）</h2>
<div class="note">每行前三张是普通字牌「枪 木 仓」，后两张是同色系的宝牌。这一栏才是拍板的关键：扫一眼，宝牌跳不跳得出来。</div>
%s

<h2>③ 四章八件器物（朱漆底 · 200px）</h2>
<div class="note">确认每一件在 200px 下都还认得出是什么 —— 认不出就得重画轮廓。</div>
<div class="row">%s</div>

<h2>④ 易撞形对照（真实尺寸 96px）</h2>
<div class="note">花瓶 / 水盆 / 果盘 / 陶罐 / 灯盏 / 竹篓 摆在一起，缩到这个尺寸还分不分得开。前三章两两撞形是老问题，这一栏专门盯它。</div>
<div class="row">%s</div>

<script>%s</script><script>%s</script><script>%s</script><script>%s</script><script>%s</script>
<script>
try{
  var n=0,p=0;
  var ts=document.querySelectorAll('svg[data-tr]');
  for(var i=0;i<ts.length;i++){
    ts[i].innerHTML = InkTreasure.svg(ts[i].dataset.tr,{palette:ts[i].dataset.pal});
    n++;
  }
  var cs=document.querySelectorAll('svg[data-ch]');
  for(var j=0;j<cs.length;j++){
    cs[j].innerHTML = InkTile.svg(cs[j].dataset.ch,{style:'bai',wash:true,seal:true});
    n++;
  }
  p = document.querySelectorAll('svg path, svg rect').length;
  document.title='OK/'+n+'牌/'+p+'元素';
}catch(e){ document.title='ERR: '+(e&&e.message||e); }
</script>
</body></html>''' % (rd('ink-defs.svg'), big, rows, others, clash,
                     js[0], js[1], js[2], js[3], js[4])

    io.open(out, 'w', encoding='utf-8').write(html)
    print('✓ %s' % out)


if __name__ == '__main__':
    main()
