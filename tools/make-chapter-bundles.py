#!/usr/bin/env python3
"""按字单把第 2~4 章的贴图目录建成 Cocos 的「小游戏分包」。

【为什么要用脚本，而不是在编辑器里点几下】
分包这件事要落到**两个**地方，缺一个就静默失效：
  ① `assets/<bundle>.meta` 里 `userData.isBundle = true` + `bundleName` + `bundleConfigID`
     → 只是"它是个 Bundle"；
  ② `settings/v2/packages/builder.json` 的 `bundleConfig.custom.<id>` 里
     `configs.miniGame.preferredOptions.compressionType = "subpackage"`
     → 才是"这个 Bundle 要打成微信小游戏分包"。
只做 ① 的后果：构建**成功**、体积**正常**、`subpackages/` 目录**根本不存在**，
贴图全被塞进主包 —— 也就是"主包悄悄超 4MB"这种最难查的失败。

【怎么逆出来的（免得下次又要考古）】
Cocos Creator 3.8.8 的编辑器源码在 app.asar 里，是加密的 .ccc 读不了；
但 `@types/protected/bundle-config.d.ts` 是明文，给出了
`BundleCompressionTypes.SUBPACKAGE = 'subpackage'` 与 `CustomBundleConfig` 的结构；
再从 i18n 表里挖到工程设置项名 `bundleConfig.custom`。合起来就是上面的 ②。
验证判据是**产物**，不是日志：`build/wechatgame/subpackages/<name>/` 存在
且 `game.json` 多出 `subpackages: [{name, root}]`。

用法： python3 tools/make-chapter-bundles.py
依赖： /private/tmp/chaizi-tile-chars.json（由 tools/gen-cocos-leveldata.js 生成）
"""
import io
import json
import os
import sys
import uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJ = os.path.join(ROOT, 'game-5-chaizi')
ASSETS = os.path.join(PROJ, 'assets')
SETTINGS = os.path.join(PROJ, 'settings', 'v2', 'packages', 'builder.json')
CHARS_JSON = '/private/tmp/chaizi-tile-chars.json'

# 优先级：内置 resources=8（工程既有值），分包往后排。同优先级会让加载顺序不确定。
PRIORITY_BASE = 8


def load_chars():
    if not os.path.exists(CHARS_JSON):
        print('✗ 找不到字单：%s\n  先跑： node tools/gen-cocos-leveldata.js' % CHARS_JSON)
        sys.exit(1)
    return json.load(io.open(CHARS_JSON, encoding='utf-8'))


def ensure_bundle_dir(name, priority):
    """建目录 + 目录同名的 .meta（不存在则新建 uuid，存在则只补/改 userData）"""
    d = os.path.join(ASSETS, name)
    os.makedirs(os.path.join(d, 'tiles'), exist_ok=True)

    mp = os.path.join(ASSETS, name + '.meta')
    if os.path.exists(mp):
        m = json.load(io.open(mp, encoding='utf-8'))
    else:
        m = {"ver": "1.2.0", "importer": "directory", "imported": True,
             "uuid": str(uuid.uuid4()), "files": [], "subMetas": {}}
    m.setdefault('userData', {})
    m['userData'].update({
        'isBundle': True,
        'bundleConfigID': name,
        'bundleName': name,
        'priority': priority,
    })
    io.open(mp, 'w', encoding='utf-8').write(
        json.dumps(m, ensure_ascii=False, indent=2) + '\n')
    return m['uuid']


def main():
    data = load_chars()
    bundles = [c for c in data['chapters'] if c['bundle'] != 'resources']
    if not bundles:
        print('字单里没有分包章（只有第 1 章？）—— 无事可做')
        return 0

    # ── settings：bundleConfig.custom ──
    st = {}
    if os.path.exists(SETTINGS):
        st = json.load(io.open(SETTINGS, encoding='utf-8'))
    st.setdefault('__version__', '1.3.9')
    custom = st.setdefault('bundleConfig', {}).setdefault('custom', {})
    for i, c in enumerate(bundles):
        custom[c['bundle']] = {
            'displayName': '第%d章贴图（小游戏分包）' % c['id'],
            'configs': {
                # 只写 miniGame 一档：native / web 留空 → 走默认（合并 json），
                # 免得给别的平台塞一个它们不支持的 compressionType（会校验失败回落）。
                'miniGame': {
                    'preferredOptions': {'compressionType': 'subpackage', 'isRemote': False},
                },
            },
        }
    io.open(SETTINGS, 'w', encoding='utf-8').write(
        json.dumps(st, ensure_ascii=False, indent=2) + '\n')

    print('✓ 分包目录与配置：')
    for i, c in enumerate(bundles):
        u = ensure_bundle_dir(c['bundle'], PRIORITY_BASE + 1 + i)
        print('    %-6s → assets/%s/tiles/   %3d 字   uuid %s'
              % (c['bundle'], c['bundle'], len(c['chars']), u))
    print('✓ 已写 %s' % SETTINGS)
    print('  下一步： python3 tools/make-tile-atlas.py  然后重跑构建')
    print('  验收判据（不是日志，是产物）：')
    print('    build/wechatgame/subpackages/<name>/ 存在；')
    print('    build/wechatgame/game.json 里出现 subpackages: [{name, root}]。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
