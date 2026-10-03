#!/usr/bin/env python3
"""构建水墨牌面评审页（第三版主交付物）。

用法: build-scene.py <输出html> [字...]
默认字集: 木 枪 梅 火 竹 艹

页面包含四段：
  ① 牌面放大       —— 1000 网格原大，看墨韵、纸纹、印章
  ② 实际牌面       —— 76px，手机上的真实尺寸（这一行才是验收标准）
  ③ 关卡实景       —— 一局真正摆开的牌，看整体风格成不成立
  ④ 式样取舍       —— 白纸牌 / 格线牌 / 有韵有印，三选一
"""
import io, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, 'design')
NODE = '/Users/consli/.workbuddy/binaries/node/versions/22.22.2-3/bin/node'
JS_FILES = ('glyphs-data.js', 'brush.js', 'imagery.js', 'ink-tile.js')


def check_js():
    """语法错会让整页静默空白，必须前置拦住。"""
    for fn in JS_FILES:
        p = os.path.join(D, fn)
        r = subprocess.run([NODE, '--check', p], capture_output=True, text=True)
        if r.returncode != 0:
            print(f'✗ {fn} 语法错误：')
            print('\n'.join(r.stderr.strip().split('\n')[:6]))
            sys.exit(1)
    print('✓ design/*.js 语法检查通过')


def rd(fn):
    return io.open(os.path.join(D, fn), encoding='utf-8').read()


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    out = args[0] if args else os.path.join(D, 'review-tile.html')
    chars = args[1:] or list('木枪梅火竹艹')

    check_js()
    js = [rd(f) for f in JS_FILES]
    defs = rd('ink-defs.svg')

    def big(c):
        return (f'<div class="c"><div class="pad"><svg class="tile" viewBox="0 0 1000 1000" '
                f'data-ch="{c}"></svg></div><div class="lbl">{c}</div></div>')

    def real(c):
        return (f'<div class="c"><svg class="small" viewBox="0 0 1000 1000" data-ch="{c}"></svg>'
                f'<div class="lbl2">{c} · 76px</div></div>')

    def plain(c):
        return (f'<div class="c"><svg class="small plain" viewBox="0 0 1000 1000" data-ch="{c}"></svg>'
                f'<div class="lbl2">{c}</div></div>')

    bigs = ''.join(big(c) for c in chars)
    reals = ''.join(real(c) for c in chars)
    plains = ''.join(plain(c) for c in chars)
    # 关卡实景：照原型里的真实棋盘做 —— 第 1 章是 6 列 × 5 行共 30 格
    # （见 prototype/index.html: cols:6, rows:5）。挪对对是成对消除，所以同一个字出现两次是对的。
    BOARD_CH = list('木枪竹艹钅梅火桃松柏枫桐桂莲荷')
    board_cells = []
    for i in range(30):
        c = BOARD_CH[i % len(BOARD_CH)]
        board_cells.append(f'<svg class="btile" viewBox="0 0 1000 1000" data-ch="{c}"></svg>')
    board = ''.join(board_cells)
    zoom_chars = chars[:3]
    zooms = ''.join(
        f'<div class="c"><svg class="zoom" viewBox="0 0 1000 1000" data-ch="{c}"></svg>'
        f'<div class="lbl">{c}</div></div>' for c in zoom_chars)

    # 牌面式样对照：必须真的渲染出来比，不能只用文字描述
    # 注意别把 JSON 塞进单引号属性里 —— 引号会打架，用独立 data-* 属性最稳
    probe = chars[0]
    style_rows = ''.join(
        f'<div class="c"><svg class="stl" viewBox="0 0 1000 1000" data-ch="{probe}" '
        f'data-style="{st}" data-wash="{str(wa).lower()}" data-seal="{str(se).lower()}"></svg>'
        f'<div class="lbl">{name}</div><div class="cap">{cap}</div></div>'
        for name, st, wa, se, cap in (
            ('A 有韵有印', 'bai', True, True, '宣纸 + 两笔淡墨 + 朱印'),
            ('B 加淡墨格线', 'ge', True, True, '多一道练习纸方框，边界更明确'),
            ('C 纯白纸牌', 'bai', False, False, '只剩纸色与字，最干净也最平'),
        ))

    paint = '''
function paint(svg, opt){
  var ch = svg.dataset.ch;
  try { svg.innerHTML = InkTile.svg(ch, opt||{}); }
  catch(e){ svg.innerHTML=''; document.title='ERR: '+(e&&e.message||e); }
}
try{
  document.querySelectorAll('.tile').forEach(function(s){ paint(s); });
  document.querySelectorAll('.zoom').forEach(function(s){ paint(s); });
  document.querySelectorAll('.stl').forEach(function(s){ paint(s, {
    style: s.dataset.style,
    wash:  s.dataset.wash  === 'true',
    seal:  s.dataset.seal  === 'true'
  }); });
  document.querySelectorAll('.small:not(.plain)').forEach(function(s){ paint(s); });
  document.querySelectorAll('.plain').forEach(function(s){
    var ch=s.dataset.ch;
    s.innerHTML = '<rect width="1000" height="1000" fill="#f3eee1"/>' +
      '<g><path d="'+(InkGlyphs.path(ch)||'')+'" fill="url(#moGrad)" filter="url(#inkMini)"/></g>';
    var b=InkGlyphs.box(ch), k=1000/Math.max(b[2]-b[0],b[3]-b[1]);
    var g=s.querySelector('g');
    g.setAttribute('transform','translate('+(500-(b[0]+b[2])/2*k)+','+(500-(b[1]+b[3])/2*k)+') scale('+k+')');
    g.querySelector('path').setAttribute('filter','url(#inkMo)');
  });
  document.querySelectorAll('.btile').forEach(function(s){ paint(s); });
}catch(e){ document.title='ERR: '+(e&&e.message||e); }
window.addEventListener('load',function(){
  if(String(document.title).indexOf('ERR')===0) return;
  var all=document.querySelectorAll('svg'), painted=0, ink=0;
  for(var i=0;i<all.length;i++){
    if(all[i].innerHTML.length>40) painted++;
    ink += all[i].querySelectorAll('path[filter]').length;
  }
  document.title='OK/'+painted+'牌/'+ink+'墨';
});
'''

    html = f'''<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>挪字成章 · 水墨牌面</title>
<style>
{rd('ink.css')}
body{{margin:0;padding:26px 34px 54px;font-family:var(--kai);max-width:1360px}}
h1{{font-size:24px;font-weight:700;color:var(--mo-1);margin:6px 0 4px;letter-spacing:.16em}}
.sub{{font-size:14px;color:var(--mo-3);margin-bottom:24px;letter-spacing:.06em;line-height:1.9}}
h2{{font-size:16px;font-weight:400;color:var(--mo-3);margin:32px 0 12px;letter-spacing:.12em}}
h2 b{{color:var(--mo-1);font-weight:700}}
h2 span{{font-size:13px;color:var(--mo-4);margin-left:10px;letter-spacing:0}}

/* 列数用 auto-fit 而不是写死 —— 这一页要在手机上（扫码）看，
   写死 6 列在 390px 屏上每格只剩 60px，字会糊成一团。 */
.grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(126px,1fr));gap:16px;align-items:start}}
.c{{text-align:center}}
.pad{{width:100%;aspect-ratio:1;box-shadow:0 1px 3px rgba(60,50,30,.20),0 8px 22px rgba(60,50,30,.10)}}
.tile{{width:100%;height:100%;display:block}}
.zrow{{display:flex;gap:24px;flex-wrap:wrap;justify-content:center;align-items:flex-start}}
.zoom{{width:min(400px,86vw);aspect-ratio:1;display:block;
       box-shadow:0 1px 4px rgba(60,50,30,.20),0 10px 26px rgba(60,50,30,.10)}}
.small{{width:76px;height:76px;display:block;margin:0 auto;
        box-shadow:0 1px 2px rgba(60,50,30,.22)}}
.lbl{{margin-top:7px;font-size:14px;color:var(--mo-3)}}
.lbl2{{margin-top:5px;font-size:11px;color:var(--mo-4);letter-spacing:.04em}}

/* ── 关卡实景：深墨台面，纸牌摊在上头。棋盘比例照原型（6 列 × 5 行） ── */
.scene{{background:#20232a;border-radius:3px;padding:24px 20px 28px;
        box-shadow:inset 0 0 140px rgba(0,0,0,.6)}}
.scene .hd{{display:flex;justify-content:space-between;align-items:baseline;
            max-width:470px;margin:0 auto 18px;color:#cdc6b4;font-size:13px;letter-spacing:.1em}}
.scene .hd b{{color:#f0e9d8;font-size:15px;font-weight:400}}
.scene .hd em{{font-style:normal;color:#c8a05a}}
.board{{display:grid;grid-template-columns:repeat(6,1fr);gap:1.5%;
        max-width:486px;margin:0 auto}}
.btile{{width:100%;aspect-ratio:1;display:block;box-shadow:0 2px 6px rgba(0,0,0,.5)}}

.note{{font-size:14px;line-height:2;color:var(--mo-2);background:rgba(255,255,255,.42);
      padding:16px 20px;border-left:3px solid var(--mo-4);margin:10px 0 4px}}
.note b{{color:var(--mo-1)}}
.opts2{{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px;margin-top:8px}}
.stl{{width:100%;aspect-ratio:1;display:block;box-shadow:0 1px 4px rgba(60,50,30,.22)}}
.cap{{margin-top:4px;font-size:12px;color:var(--mo-4);line-height:1.7}}

@media (max-width:820px){{
  body{{padding:16px 14px 44px}}
  h1{{font-size:19px;letter-spacing:.10em}}
  .sub{{font-size:13px;line-height:1.95}}
  h2{{font-size:15px;margin:26px 0 10px}}
  h2 span{{display:block;margin:4px 0 0;font-size:12px}}
  .grid{{grid-template-columns:repeat(auto-fit,minmax(96px,1fr));gap:12px}}
  .zrow{{gap:14px}}
  .zoom{{width:min(400px,46vw)}}
  .scene{{padding:18px 12px 20px}}
  .scene .hd{{font-size:12px;margin-bottom:12px}}
  .note{{font-size:13px;line-height:1.95;padding:13px 15px}}
}}
</style></head><body class="paper">
{defs}
<h1>挪字成章 · 水墨牌面</h1>
<div class="sub">
物象不再贴在字的旁边，改为铺在牌的底下。<br>
前两版把「木」画成树、「火」画成火焰，都失败了三次：一张牌只有 76px，字吃掉八成面积，
剩下边角最多容几笔细线 —— 而<b>一小条灰，人眼只会读成附肢或污渍</b>，永远读不成枝叶和火焰。<br>
现在把物象退回它本来该在的位置：<b>牌是画，字是题款</b>。同时补上了漏做的一条：整体风格水墨化。
</div>

<h2>① 单牌放大 <span>420px —— 看清楚墨韵、帘纹、朱印到底立不立得住</span></h2>
<div class="zrow">{zooms}</div>

<h2>② 牌面一排 <span>看整盘牌摆在一起协不协调（每张的墨韵位置都是按字散列的，不重复）</span></h2>
<div class="grid">{bigs}</div>

<h2>③ 实际牌面 <span>76px —— 这一行才是验收标准，手机上就这么大</span></h2>
<div class="grid">{reals}</div>

<h2>④ 去掉牌面，只剩字 <span>对照用 · 同尺寸</span></h2>
<div class="grid">{plains}</div>

<h2>⑤ 关卡实景 <span>棋盘照原型真实比例（6 列 × 5 行），台面是深墨色</span></h2>
<div class="scene">
  <div class="hd"><div>第一章 · <b>木字营</b></div><div>步数 <em>12</em> ／ 目标 <em>15 组</em></div></div>
  <div class="board">{board}</div>
</div>

<h2>⑥ 牌面式样对照 <span>同一个字，三种牌面 —— 真的渲染出来比，不是文字描述</span></h2>
<div class="opts2">{style_rows}</div>
<div class="note" style="margin-top:14px">
  <b>A 有韵有印</b>：整张牌就是一幅小水墨，76px 时墨韵退成一层极淡的灰、朱印退成一个小红点 —— 正是「惜色如金」。<br>
  <b>B 加淡墨格线</b>：多一道书法练习纸式的方框，玩法边界最明确；代价是 76px 时细到快看不见，只在大牌上起作用。<b>第 ⑤ 段实景用的就是它</b>。<br>
  <b>C 纯白纸牌</b>：只剩纸色与字，最干净、渲染最省，但在深墨台面上偏平，也就丢掉了「水墨牌面」这件事本身。
</div>

<script>{js[0]}</script><script>{js[1]}</script><script>{js[2]}</script><script>{js[3]}</script>
<script>{paint}</script>
</body></html>'''
    io.open(out, 'w', encoding='utf-8').write(html)
    print(f'✓ {out}  ({len(html)/1024:.0f}KB, {len(chars)} 字)')


if __name__ == '__main__':
    main()
