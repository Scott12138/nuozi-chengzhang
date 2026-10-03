#!/usr/bin/env python3
"""把水墨牌面批量烘成 PNG 贴图，按章分目录，供 Cocos 直接当 Sprite 用。

【为什么要烘贴图，而不是在 Cocos 里画】
原型牌面的灵魂是三层 SVG 滤镜（陈纸 / 帘纹 / 墨韵 feDisplacementMap）。
Cocos 的 Graphics 画不出 SVG 滤镜，而用 Graphics 近似会丢掉"宣纸感" ——
那正是用户反复要求的东西。所以：**在浏览器里按原样渲染好，烘成位图**，
Cocos 只负责摆放，不负责生成。

【为什么用「网格图 + 裁切」而不是逐张截元素】
逐张截图 = N 次启动 Chrome（248 张要几十分钟，且每次都有 CDP 抖动）。
一次截一整页 + 按坐标裁，几秒钟搞定，且每张的渲染条件完全一致。

【为什么钉死格子尺寸、不留间隙】
零间隙 → 裁切坐标就是 CELL 的整数倍，不用量像素、不会错位半格。
相邻两张牌在网格图上确实会连成一片，但裁切按坐标走，不影响结果。

【为什么文件名用码位而不是汉字】
微信开发者工具对含中文的路径历史上出过编译缓存问题。贴图文件名统一用
`t_<hex>.png`（枪 → t_67aa.png），另生成一份 TS 映射表给游戏侧。

------------------------------------------------------------
★ 为什么是 128px（CELL=64 / DSF=2），而不是原来的 192px
------------------------------------------------------------
微信小游戏「主包 ≤ 4MB」是硬红线，而本工程的非贴图固定占用实测 2.295MB
（引擎 1.38MB + internal + 音频 440KB + UI + 脚本），留给贴图的只有约 1.7MB。
全库 248 张字形贴图在哪一档分辨率下的实测体积（Pillow LANCZOS + PNG optimize）：

    192px = 32.8 KB/张 → 7.9 MB   ✗ 远超
    160px = 27.6 KB/张 → 6.7 MB   ✗
    128px = 19.0 KB/张 → 4.6 MB   ✗（单包仍超，但配「按章分包」后主包只放第 1 章 = 874KB ✓）
     96px = 12.0 KB/张 → 2.9 MB   ○（单包可行，但 L1 盘面约 0.57× 欠采样）
     64px =  6.3 KB/张 → 1.5 MB   ○（单包可行，但明显糊）

⚠️ 注意「降分辨率不是按面积等比」—— 192→96 只降到 36.4%（不是 25%）。
   这是实测结论，不要再用 S9 那份「÷4 ≈ 1.8MB」的估算。
于是 2026-10-03 拍板：**128px + 按章分包**。主包放第 1 章（46 张 ≈ 874KB），
第 2~4 章各做一个小游戏分包（Cocos 自定义 Bundle + 压缩类型 subpackage）。

------------------------------------------------------------
★ 字单从哪来（不要再手写字表）
------------------------------------------------------------
本脚本**不手写字表**。字单由 `tools/gen-cocos-leveldata.js` 按章归属算好，
写在 /private/tmp/chaizi-tile-chars.json 里。手写字表的坑：
少烘一张 → 棋盘上一个洞（**不报错**）；多烘一张 → 白占主包体积。
所以：改字单请改原型 → 重跑生成器 → 再跑本脚本。

用法： python3 tools/make-tile-atlas.py [章号...]
      不给参数 = 烘全部 4 章；给参数（如 `1`）= 只烘第 1 章（改第 1 章时省时间）。
依赖：受管 venv（Pillow）
"""
import io
import json
import os
import re
import shutil
import subprocess
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, 'design')
PROJ = os.path.join(ROOT, 'game-5-chaizi')
MANIFEST_TS = os.path.join(PROJ, 'assets', 'scripts', 'TileManifest.ts')
TREASURE_TS = os.path.join(PROJ, 'assets', 'scripts', 'core', 'Treasure.ts')
NODE = '/Users/consli/.workbuddy/binaries/node/versions/22.22.2-3/bin/node'
J = lambda *p: os.path.join(*p)
CHARS_JSON = '/private/tmp/chaizi-tile-chars.json'
# ★ 顺序即 script 标签顺序，tile-roles 必须排在 ink-tile 之前 ——
#   后者在渲染时就要读 root.TileRoles 决定"靠哪半边"。
JS_FILES = ('tile-roles.js', 'glyphs-data.js', 'brush.js', 'imagery.js',
            'ink-tile.js', 'ink-treasure.js')

CELL = 64           # 单张牌的 CSS 像素
DSF = 2             # 设备像素比 → 最终贴图 = 128×128
COLS = 8
TABLE = '#23262c'   # 案几底色（与 CFG.COLOR.TABLE / Main.scene 相机底色一致）

# ★ 宝牌配色（2026-10-03 试样三选一）。
#   ★★ 2026-10-03 用户拍板：**「乌木描金」（wu）**。
#      判据不是"看着像"，是像素比对 —— 用户给的截图主色 #2e2b28 与 wu.panel
#      #2f2b28 的距离只有 1.0，而 zhu 是 122.2、sajin 是 283.8。
#      （换配色只改这一行 → 重跑本脚本 → 重出试玩码。器物轮廓与配色解耦，
#        换色不动任何一张器物的画法，见 design/ink-treasure.js 的 PAL。）
TREASURE_PALETTE = 'wu'

# 一处真源：CELL/DSF 与 JSON 里记的那份对得上，否则说明改了一处忘了另一处
EXPECT_CELL, EXPECT_DSF = 64, 2


def chapter_dir(ch):
    """章 → 输出目录。

    第 1 章落在内置的 resources bundle（= 主包），第 2~4 章各自落在一个
    自定义 bundle 目录（= 微信小游戏分包，见 game-5-chaizi/settings/v2/packages/builder.json）。
    ⚠️ 分包目录必须在 `assets/` 下且自带 `<名字>.meta`（userData.isBundle=true），
       否则 Cocos 不认它是 Bundle，贴图会静默地全打进主包。
    """
    if ch['bundle'] == 'resources':
        return J(PROJ, 'assets', 'resources', 'tiles')
    return J(PROJ, 'assets', ch['bundle'], 'tiles')


def load_chars():
    if not os.path.exists(CHARS_JSON):
        print('✗ 找不到字单：%s\n  先跑： node tools/gen-cocos-leveldata.js' % CHARS_JSON)
        sys.exit(1)
    d = json.load(io.open(CHARS_JSON, encoding='utf-8'))
    if d.get('cell') != EXPECT_CELL or d.get('dsf') != EXPECT_DSF:
        print('✗ 字单里记的分辨率是 %s×%s，本脚本是 %s×%s —— 改了一处忘了另一处'
              % (d.get('cell'), d.get('dsf'), EXPECT_CELL, EXPECT_DSF))
        sys.exit(1)
    # 字单必须比 LevelData.ts 新：两者由同一个生成器同时写出，
    # 若 LevelData 更新则说明有人只重跑了生成器的一半流程（不可能，但便宜的自检）。
    lv_ts = J(PROJ, 'assets', 'scripts', 'core', 'LevelData.ts')
    if os.path.exists(lv_ts) and os.path.getmtime(lv_ts) > os.path.getmtime(CHARS_JSON) + 2:
        print('✗ 字单比 LevelData.ts 旧，可能不是同一次生成的 —— 请重跑 node tools/gen-cocos-leveldata.js')
        sys.exit(1)
    check_roles(d)
    return d


def check_roles(data):
    """★ 断言「角色表覆盖了所有上过棋盘的部件」。

    这是**最贵的一种静默失败**：改了关卡字单（新加了一个部件），但忘了重跑
    tools/gen-tile-roles.py —— 那个新部件在表里查不到，`TileRoles.role()` 会
    老老实实返回 'c'（居中满格），于是它长得跟合成字一样，**不报任何错**，
    只有玩家会觉得"这张牌怎么跟别的不是一路的"。

    所以这里主动去问 JS：字单里的每个部件，表认识吗？谁来问？—— 问 node。
    在 Python 里重写一遍"怎么查表"等于把口径抄两份，迟早漂。
    """
    parts = data.get('parts')
    if parts is None:
        print('✗ 字单里没有 parts 字段 —— 请重跑 node tools/gen-cocos-leveldata.js（旧版字单）')
        sys.exit(1)
    roles_js = J(D, 'tile-roles.js')
    if not os.path.exists(roles_js):
        print('✗ 找不到角色表 %s\n  先跑： python3 tools/gen-tile-roles.py' % roles_js)
        sys.exit(1)
    probe = ("globalThis.window=globalThis;"
             "new Function(require('fs').readFileSync(%s,'utf8'))();"
             "var T=globalThis.TileRoles,missing=[],cnt={};"
             "(%s).forEach(function(c){"
             "  if(!T.has(c))missing.push(c); else cnt[T.role(c)]=(cnt[T.role(c)]||0)+1;});"
             "console.log(JSON.stringify({missing:missing,cnt:cnt,count:T.count}));"
             % (json.dumps(roles_js), json.dumps(parts, ensure_ascii=False)))
    r = subprocess.run([NODE, '-e', probe], capture_output=True, text=True)
    if r.returncode != 0:
        print('✗ 查角色表失败：%s' % (r.stderr.strip() or '无输出'))
        sys.exit(1)
    out = json.loads(r.stdout)
    if out['missing']:
        print('✗ 有 %d 个部件没有角色（会静默地画成居中满格，跟合成字长得一样）：%s'
              % (len(out['missing']), ''.join(out['missing'])))
        print('  → 重跑： python3 tools/gen-tile-roles.py')
        sys.exit(1)
    print('✓ 角色表覆盖全部 %d 个上过棋盘的部件  %s'
          % (len(parts), ' '.join('%s=%d' % kv for kv in sorted(out['cnt'].items()))))


def tile_js(ch):
    """返回一段 JS 表达式，在页面里对某个 <svg> 求值填入牌面"""
    return "InkTile.svg(%s, {style:'bai',wash:true,seal:true})" % json.dumps(ch)


def build_html(path, items, cell, mode='char'):
    """把 N 个格子拼成一页待截图。

    mode='char'     → 字牌（items = 汉字，走 InkTile.svg）
    mode='treasure' → 宝牌（items = 贴图键，走 InkTreasure.svg + TREASURE_PALETTE）

    ★ 两条渲染路径共用同一个函数，是因为它们的**唯一差异**只有"调哪个渲染器"：
      网格图 + 一次截图 + 按坐标裁，这套机制对两者完全一样。
      拆成两份会让"裁切坐标""自检阈值""尺寸校验"三处逻辑各写一遍，迟早分叉。
    """
    for fn in JS_FILES:
        r = subprocess.run([NODE, '--check', J(D, fn)], capture_output=True, text=True)
        if r.returncode != 0:
            print('✗ %s: %s' % (fn, r.stderr.strip().split('\n')[0]))
            sys.exit(1)

    rd = lambda f: io.open(J(D, f), encoding='utf-8').read()
    js = [rd(f) for f in JS_FILES]

    attr = 'data-ch' if mode == 'char' else 'data-key'
    # ⚠️ 渲染时要传 **字段值**（`dataset.ch`）而不是 `dataset` 本身。
    #   写成 `CARD_TILE(ns[i].dataset)` 不会报错 —— `InkTile.svg({...})` 会对
    #   一个对象做 hash 与查表，全部查不到 → 静默画出一张**只有纸底的空牌**。
    #   这一版的第一次运行就是这么错的：46 张字牌全部 615KB（13.4KB/张，
    #   正常是 17.7KB），自检报"纸0.99 墨0.006"才把它抓出来。
    field = 'ch' if mode == 'char' else 'key'
    cells = ''.join(
        '<svg viewBox="0 0 1000 1000" width="%d" height="%d" %s="%s"></svg>'
        % (cell, cell, attr, c) for c in items)

    rows = (len(items) + COLS - 1) // COLS
    w, h = COLS * cell, rows * cell
    scripts = ''.join('<script>%s</script>' % s for s in js)
    html = '''<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>tile-atlas</title><style>
html,body{margin:0;padding:0;background:%s;overflow:hidden}
#grid{display:grid;grid-template-columns:repeat(%d,%dpx);width:%dpx;height:%dpx}
svg{display:block}
</style></head><body>
%s
<div id="grid">%s</div>
%s
<script>
try{
  var ns=document.querySelectorAll('svg[%s]');
  for(var i=0;i<ns.length;i++){
    ns[i].innerHTML = %s(ns[i].dataset.%s);
  }
  document.title = 'OK/'+ns.length+'/'+document.querySelectorAll('svg[%s] path').length;
}catch(e){ document.title='ERR: '+(e&&e.message||e); }
function CARD_TILE(ch){ return %s; }
function CARD_TR(key){ return InkTreasure.svg(key, {palette: %s}); }
</script>
</body></html>''' % (TABLE, COLS, cell, w, h, rd('ink-defs.svg'),
                     cells, scripts, attr,
                     'CARD_TILE' if mode == 'char' else 'CARD_TR', field, attr,
                     tile_js('X').replace(json.dumps('X'), 'ch'),
                     json.dumps(TREASURE_PALETTE))
    io.open(path, 'w', encoding='utf-8').write(html)
    return w, h


def fname(ch):
    """字形 → 贴图文件名（码位，避开中文路径）"""
    return 't_%04x' % ord(ch)


def bake(chapter):
    """烘一章：一次截图 → 按坐标裁成 N 张 PNG。返回 (成功字, 可疑字)"""
    chars = chapter['chars']
    out = chapter_dir(chapter)
    os.makedirs(out, exist_ok=True)

    html = '/private/tmp/tile-atlas-ch%s.html' % chapter['id']
    shot = '/private/tmp/tile-atlas-ch%s.png' % chapter['id']
    w, h = build_html(html, chars, CELL)

    r = subprocess.run(['bash', J(ROOT, 'tools', 'shot.sh'), html, shot,
                        str(w), str(h), str(DSF)], capture_output=True, text=True)
    if r.returncode != 0 or not os.path.exists(shot):
        print('✗ 第 %d 章截图失败：%s' % (chapter['id'], r.stderr or r.stdout))
        sys.exit(1)

    atlas = Image.open(shot).convert('RGB')
    expect = (w * DSF, h * DSF)
    if atlas.size != expect:
        print('✗ 第 %d 章截图尺寸 %s ≠ 预期 %s（页面溢出？）' % (chapter['id'], atlas.size, expect))
        sys.exit(1)

    cell_px = CELL * DSF
    px = cell_px * cell_px
    bad = []
    for i, ch in enumerate(chars):
        r_, c_ = divmod(i, COLS)
        box = (c_ * cell_px, r_ * cell_px, (c_ + 1) * cell_px, (r_ + 1) * cell_px)
        tile = atlas.crop(box)

        # 自检：牌面必须「大部分是浅色纸底 + 有一小部分是墨」。
        # 只看文件非空会漏掉"空白牌"（缺字形时正是这样，且不报错）。
        # ⚠️ 用 tobytes() 而不是 getdata()：后者在 Pillow 14 会被移除（现在已报弃用警告），
        #    而且 getdata() 返回对象，要 list() 一遍，比直接拿 bytes 还慢。
        data = tile.convert('L').tobytes()
        paper = sum(1 for v in data if v > 200) / px
        ink = sum(1 for v in data if v < 110) / px
        if not (paper > 0.45 and ink > 0.015):
            bad.append('%s(纸%.2f 墨%.3f)' % (ch, paper, ink))
        tile.save(J(out, fname(ch) + '.png'), 'PNG', optimize=True)

    total = sum(os.path.getsize(J(out, f)) for f in os.listdir(out) if f.endswith('.png'))
    print('  第 %d 章 %-18s → %-9s %3d 张  %6.0f KB（单张 %.1f KB）'
          % (chapter['id'], chapter['name'], chapter['bundle'] + '/',
             len(chars), total / 1024, total / 1024 / max(1, len(chars))))
    return chars, bad


def manifest_own(data):
    """映射表要写的 (章, 字) 清单 —— **按盘上真实存在的 PNG** 算出来。

    ★ 为什么不直接用本次烘过的章（`own`）：
      本脚本支持 `python3 tools/make-tile-atlas.py 1` 只烘第 1 章。
      第一版就拿 `own` 去写清单 —— 于是"只烘 1 章"会把第 2~4 章**从清单里删掉**
      （分包配置、字→章映射全会消失），而构建与运行**都不会报错**，
      只在真机上进第 2 章时才发现贴图全丢。这是本脚本踩过的坑，别再走回去。
    ★ 为什么不直接用 JSON 里的字单：
      那会产生"指向不存在文件"的条目（只烘了一半时），运行期打 warn 画空牌，
      比直接没有更难查（见 write_manifest 的注释）。
      所以取两者的交集：**JSON 里该有的字 ∩ 盘上真的有的 PNG**。
    """
    out = []
    for ch in data['chapters']:
        d = chapter_dir(ch)
        on_disk = set(os.listdir(d)) if os.path.isdir(d) else set()
        out.append((ch, [c for c in ch['chars'] if (fname(c) + '.png') in on_disk]))
    return out


def write_manifest(data, own, treasure_keys):
    """生成 TileManifest.ts。

    ★ 映射表按**盘上真实存在的 PNG** 生成，而不是按字单 —— 这样"只烘了前几章"
      时，缺的字不会在表里留下一个指向不存在文件的条目（那种条目会让运行期
      打一条 warn 然后画一张空牌，比直接没有更难查）。
    """
    radicals = data.get('radicals', [])
    lines = ['/**',
             ' * TileManifest.ts · 由 tools/make-tile-atlas.py 生成，**不要手改**',
             ' *',
             ' * 贴图文件名用码位（t_67aa.png）而不是汉字，是为了避开微信开发者工具',
             ' * 对含中文路径的编译缓存问题。这张表把「字 → 文件名」固化下来，',
             ' * 于是游戏侧不需要在运行时拼字符串。',
             ' *',
             ' * ★ 贴图按章分目录（2026-10-03 拍板「128px + 按章分包」）：',
             ' *   第 1 章在内置 resources bundle（= 主包，开箱即用），',
             ' *   第 2~4 章各在一个自定义 bundle（= 微信小游戏分包，进章前加载）。',
             ' *   `TILE_CHAPTER` 就是「这个字该去哪个 bundle 取」的唯一依据。',
             ' */',
             '',
             '/** 正文牌（偏旁 / 部件 / 合成字）贴图 → 文件名（不含扩展名） */',
             'export const TILE_TEX: Record<string, string> = {']
    n = 0
    for ch, chars in own:
        lines.append('    // —— 第 %d 章 ——' % ch['id'])
        for c in chars:
            lines.append("    '%s': '%s'," % (c, fname(c)))
            n += 1
    lines.append('};')
    lines.append('')
    lines.append('/** 字 → 所属章（决定从哪个 Asset Bundle 取贴图） */')
    lines.append('export const TILE_CHAPTER: Record<string, number> = {')
    for ch, chars in own:
        for c in chars:
            lines.append("    '%s': %d," % (c, ch['id']))
    lines.append('};')
    lines.append('')
    lines.append('/**')
    lines.append(' * 章 → Bundle 名 + 该 Bundle 内贴图的路径前缀。')
    lines.append(' * 第 1 章是内置 resources（`resources.load` 直接可用）；')
    lines.append(' * 第 2~4 章要在 `assetManager.loadBundle(name)` 之后再 `bundle.load(prefix + 文件名)`。')
    lines.append(' */')
    lines.append('export const CHAPTER_BUNDLE: Record<number, { bundle: string; prefix: string }> = {')
    for ch, _ in own:
        lines.append("    %d: { bundle: '%s', prefix: '%s' }," % (ch['id'], ch['bundle'], ch['prefix']))
    lines.append('};')
    lines.append('')
    lines.append('/** 全库偏旁（用于快速判断一张牌是不是偏旁） */')
    lines.append("export const RADICALS = '%s'.split('');" % ''.join(radicals))
    lines.append('')
    lines.append('/**')
    lines.append(' * 宝牌贴图 → 文件名。★ 键就是文件名（`x_ch1_01` → `x_ch1_01.png`），')
    lines.append(' * 不再另起一套编码 —— 宝牌统共 8 张，再编一次码只是多一层反查。')
    lines.append(' *')
    lines.append(' * 宝牌贴图一律落在 **resources（主包）**：它跨章共用（第 1 章就要用「铁砧」），')
    lines.append(' * 不能塞进任何一章的分包；8 张 128px 合计不到 200KB，主包放得下。')
    lines.append(' *')
    lines.append(' * ⚠️ 与 `core/Treasure.ts` 的 `TREASURE_ITEMS` **必须键集一致**：')
    lines.append(' *   那边说这一关要发哪件宝牌，这边说那件宝牌的图在哪。')
    lines.append(' *   `tools/core-selftest.js` 的「宝牌」断言会替你对账。')
    lines.append(' */')
    lines.append('export const TREASURE_TEX: Record<string, string> = {')
    for k in treasure_keys:
        lines.append("    '%s': '%s'," % (k, k))
    lines.append('};')
    lines.append('')
    lines.append('/**')
    lines.append(' * 干扰牌贴图。★ **已废弃（2026-10-03）**：宝牌取代了干扰牌，')
    lines.append(' * `LEVELS` 里 junk 一律为 0，本表永远是空的。')
    lines.append(' * 保留一个空表是为了让 `TileAtlas.texNameOf()` 不必改签名 ——')
    lines.append(' * 等 `core/Board.ts` 彻底摘掉 junk 之后连同这张表一起删。')
    lines.append(' */')
    lines.append('export const JUNK_TEX: Record<string, string> = {};')
    lines.append('')
    io.open(MANIFEST_TS, 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
    return n


# ------------------------------------------------------------
#  宝牌：器物键从 core/Treasure.ts 里读，不在本脚本里再抄一份
# ------------------------------------------------------------
def treasure_keys():
    """从 `core/Treasure.ts` 抽出全部宝牌贴图键。

    ★ 为什么从 TS 里读而不是在本脚本里再写一份列表：
      写两份 = 两份会漂。漂的表现是"某一关的宝牌没有贴图" → 运行期 warn + 一张空牌，
      而且**不报错**（这正是本项目栽过的那种静默错位）。
      现在唯一真源是 `TREASURE_ITEMS`，本脚本只是它的执行者。
    """
    if not os.path.exists(TREASURE_TS):
        print('✗ 找不到 %s' % TREASURE_TS)
        sys.exit(1)
    src = io.open(TREASURE_TS, encoding='utf-8').read()
    keys = re.findall(r"tex:\s*'(x_[a-z0-9_]+)'", src)
    if not keys:
        print('✗ 从 core/Treasure.ts 里没读到任何宝牌 tex 键（格式变了？）')
        sys.exit(1)
    if len(set(keys)) != len(keys):
        print('✗ core/Treasure.ts 里有重复的宝牌 tex 键：%s'
              % [k for k in keys if keys.count(k) > 1])
        sys.exit(1)
    return keys


def hex2rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def palette_colors():
    """从 `design/ink-treasure.js` 的 PAL 里抠出「漆面色 + 器物色」，供自检比对。

    ★ 这是**有意为之的跨语言耦合**：宝牌的自检必须知道"漆面应该是哪个色"，
      否则一张纯色牌（器物没画出来）和一张正常牌在"非空"这个判据下长得一样。
      抠色而不是在本脚本里硬写一份色表，是为了让"改配色忘了改自检"不可能发生 ——
      改了 ink-treasure.js，这里自动跟着变。
    """
    src = io.open(J(D, 'ink-treasure.js'), encoding='utf-8').read()
    m = re.search(r'var PAL = \{(.*?)\n  \};', src, re.S)
    if not m:
        print('✗ 解析不出 ink-treasure.js 的 PAL 块（格式变了？）')
        sys.exit(1)
    out = {}
    for pm in re.finditer(r"(\w+):\s*\{(.*?)\n    \}", m.group(1), re.S):
        pan = re.search(r"panel:\s*'(#[0-9a-fA-F]{6})'", pm.group(2))
        mot = re.search(r"motif:\s*'(#[0-9a-fA-F]{6})'", pm.group(2))
        if pan and mot:
            out[pm.group(1)] = (hex2rgb(pan.group(1)), hex2rgb(mot.group(1)))
    if TREASURE_PALETTE not in out:
        print('✗ 配色 %s 不在 ink-treasure.js 的 PAL 里（可选：%s）'
              % (TREASURE_PALETTE, ', '.join(out)))
        sys.exit(1)
    return out


def bake_treasure(keys, out_dir, pal):
    """烘宝牌：与字牌同一条流程（一页网格图 → 按坐标裁）。

    【自检判据为什么与字牌不同】
    字牌判的是"浅色纸底够不够多 + 有没有墨"，因为字牌就是"纸上一团墨"。
    宝牌是"深色漆面上一个反白器物"，同一个判据会把正常宝牌判成失败。
    所以宝牌改成两条互补判据：
      ① 整张里**漆面色**占比 ≥ 18% —— 抓"漆面没渲染出来"（会退化成一张纸）；
      ② 中央 45% 方框里**器物色**占比 ≥ 2% —— 抓"器物没画出来 / 画到框外去了"。
    两条缺一不可：只有 ① 时，纯色漆面牌（器物丢失）照样通过。
    """
    os.makedirs(out_dir, exist_ok=True)
    for f in os.listdir(out_dir):
        if f.startswith('x_') and f.endswith('.png'):
            os.remove(J(out_dir, f))

    html = '/private/tmp/tile-atlas-treasure.html'
    shot = '/private/tmp/tile-atlas-treasure.png'
    w, h = build_html(html, keys, CELL, 'treasure')

    r = subprocess.run(['bash', J(ROOT, 'tools', 'shot.sh'), html, shot,
                        str(w), str(h), str(DSF)], capture_output=True, text=True)
    if r.returncode != 0 or not os.path.exists(shot):
        print('✗ 宝牌截图失败：%s' % (r.stderr or r.stdout))
        sys.exit(1)

    atlas = Image.open(shot).convert('RGB')
    expect = (w * DSF, h * DSF)
    if atlas.size != expect:
        print('✗ 宝牌截图尺寸 %s ≠ 预期 %s（页面溢出？）' % (atlas.size, expect))
        sys.exit(1)

    cell_px = CELL * DSF
    (pr, pg, pb), (mr, mg, mb) = pal
    # 中央方框：1000 空间 280..720 → 128px 下的 36..92
    c0, c1 = int(280 * cell_px / 1000), int(720 * cell_px / 1000)
    good, bad = [], []
    for i, key in enumerate(keys):
        r_, c_ = divmod(i, COLS)
        tile = atlas.crop((c_ * cell_px, r_ * cell_px, (c_ + 1) * cell_px, (r_ + 1) * cell_px))

        raw = tile.tobytes()
        n = len(raw) // 3
        pan = 0
        for k in range(0, len(raw), 3):
            if abs(raw[k] - pr) + abs(raw[k + 1] - pg) + abs(raw[k + 2] - pb) < 90:
                pan += 1
        mid = tile.crop((c0, c0, c1, c1))
        raws = mid.tobytes()
        nm = len(raws) // 3
        mot = 0
        for k in range(0, len(raws), 3):
            if abs(raws[k] - mr) + abs(raws[k + 1] - mg) + abs(raws[k + 2] - mb) < 90:
                mot += 1

        sr, sm = pan / n, mot / nm
        if sr < 0.18 or sm < 0.02:
            bad.append('%s(漆面%.2f 器物%.3f)' % (key, sr, sm))
        else:
            good.append(key)
        tile.save(J(out_dir, key + '.png'), 'PNG', optimize=True)
    return good, bad


def main():
    data = load_chars()
    want = [int(a) for a in sys.argv[1:]]
    chapters = [c for c in data['chapters'] if not want or c['id'] in want]

    print('分辨率 %d×%d（CELL=%d × DSF=%d）' % (CELL * DSF, CELL * DSF, CELL, DSF))

    own, problems = [], []
    for ch in chapters:
        # 只清理本章目录里的贴图：别的章的目录不动
        out = chapter_dir(ch)
        os.makedirs(out, exist_ok=True)
        for f in os.listdir(out):
            # t_* = 正文牌（要重烘）；j_* = 干扰牌（★ 已废弃，见文件头「宝牌取代干扰牌」）
            # 清掉 j_* 不是顺手，而是维持一条不变量：**盘上的贴图集 == 字单**。
            # 留着它的后果是它照样被打进主包白占体积（9 张 192px ≈ 270KB）。
            # ★ x_* = 宝牌，**不动** —— 它由 bake_treasure 自己清、自己在主包目录里，
            #   而第 1 章的目录恰好就是主包目录，在这里顺手清掉会把宝牌删掉。
            if (f.startswith('t_') or f.startswith('j_')) and f.endswith('.png'):
                os.remove(J(out, f))
        chars, bad = bake(ch)
        own.append((ch, chars))
        problems += ['第%d章 %s' % (ch['id'], b) for b in bad]

    # ---- 宝牌：与字牌同一条流水线，烘进主包（resources/tiles）----
    keys = treasure_keys()
    pals = palette_colors()
    tex_dir = J(PROJ, 'assets', 'resources', 'tiles')
    good, bad = bake_treasure(keys, tex_dir, pals[TREASURE_PALETTE])
    tsize = sum(os.path.getsize(J(tex_dir, k + '.png')) for k in good)
    print('  宝牌   %-18s → %-9s %3d 张  %6.0f KB（配色 %s，单张 %.1f KB）'
          % ('全 4 章共用', 'resources/', len(good), tsize / 1024,
             TREASURE_PALETTE, tsize / 1024 / max(1, len(good))))
    problems += ['宝牌 %s' % b for b in bad]

    mown = manifest_own(data)
    n = write_manifest(data, mown, keys)
    total = sum(os.path.getsize(J(chapter_dir(c), f))
                for c, chars in mown for f in os.listdir(chapter_dir(c)) if f.endswith('.png'))
    total += tsize
    n += len(keys)
    print('✓ 共 %d 张贴图，合计 %.0f KB' % (n, total / 1024))
    print('✓ 映射表 → %s' % MANIFEST_TS)
    # 只烘了一部分时，把"清单里少了哪些章"明说出来 —— 静默的清单缩水是最贵的错。
    shrunk = ['第%d章 %d/%d' % (ch['id'], len(chars), len(ch['chars']))
              for ch, chars in mown if len(chars) != len(ch['chars'])]
    if shrunk:
        print('⚠ 映射表里有章节没烘全（本次只烘了 %s）：%s'
              % (want or '全部', '，'.join(shrunk)))
    if problems:
        print('⚠ 可疑贴图（字牌看"纸底+墨"，宝牌看"漆面+器物"）：' + ' '.join(problems))
        return 1
    print('✅ 全部牌面自检通过（字牌：宣纸底 + 墨迹 ／ 宝牌：漆面 + 器物）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
