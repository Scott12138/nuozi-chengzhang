#!/usr/bin/env python3
"""在 chaizi 工作区新建一个 Cocos Creator 3.8.8 工程骨架（game-5-chaizi）。

【为什么是「复制骨架」而不是「让 Dashboard 新建」】
Dashboard 是 GUI，命令行下不可用；而官方模板（empty / empty-2d）**都不带场景**，
建出来的工程一构建就报 "当前初始场景不存在...无法设置为初始场景"。
所以直接以上一轮已验证可构建的 2D 工程为骨架：
  · settings/  —— 含**引擎模块裁剪**（关掉 3d/物理/骨骼/地形/spine…，42 项）
                  这是微信 4MB 首包红线的关键，重建一遍极易漏配
  · profiles/  —— 构建器偏好
  · Main.scene —— 只含 Canvas(720×1280) + Camera 的纯舞台（零脚本引用）

【为什么场景要换 uuid】
Scene 的 uuid 就是构建配置里的 startScene。沿用上一个工程的 uuid 会让两个工程
在 Cocos 的资源库里撞号。这里重新生成，并保证 **三处一致**：
  Main.scene 的 `_id` ／ Main.scene.meta 的 `uuid` ／ build-config 的 `startScene`

【关键取舍：Main.scene 保持零脚本引用】
命令行无头构建时，asset-db 导入场景的时机早于脚本类注册，场景里挂的自定义组件
会被判定 "Script ... is missing or invalid" 并**静默丢弃** —— 构建成功、体积正常、
跑起来一片空白。所以入口改由 assets/scripts/Bootstrap.ts 在运行时挂载（见该文件注释）。

用法： python3 tools/new-cocos-project.py [目标目录]
"""
import json
import os
import re
import shutil
import sys
import uuid

SRC_PROJ = '/Users/consli/WorkBuddy/2026-09-30-14-03-17/game-4-mahjong'
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DST = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(HERE, 'game-5-chaizi')

APPID = 'wx817f07150e00efa1'          # 用户在微信开发者工具里预填的 AppID
DESIGN_W, DESIGN_H = 720, 1280
BG = (35, 38, 44)                     # 案几色 #23262c（与水墨牌面的宣纸底成对比）

# 骨架里直接搬过来的目录/文件（不含任何上一轮的游戏代码）
COPY_DIRS = ['settings', 'profiles']
COPY_FILES = ['tsconfig.json', '.gitignore']


def main():
    if os.path.exists(DST):
        print('❌ 目标已存在，先删掉或换个路径：%s' % DST)
        return 1

    scene_uuid = str(uuid.uuid4())
    proj_uuid = str(uuid.uuid4())
    print('目标工程：%s' % DST)
    print('  场景 uuid：%s' % scene_uuid)

    os.makedirs(os.path.join(DST, 'assets', 'scenes'))
    os.makedirs(os.path.join(DST, 'assets', 'scripts'))
    os.makedirs(os.path.join(DST, 'build-config'))

    for d in COPY_DIRS:
        src = os.path.join(SRC_PROJ, d)
        if os.path.isdir(src):
            shutil.copytree(src, os.path.join(DST, d))
            print('  复制 %s/' % d)
    for f in COPY_FILES:
        src = os.path.join(SRC_PROJ, f)
        if os.path.isfile(src):
            shutil.copy2(src, os.path.join(DST, f))
            print('  复制 %s' % f)

    # ---- package.json（换新工程名与 uuid，否则 Cocos 会认成同一个工程）----
    with open(os.path.join(DST, 'package.json'), 'w', encoding='utf-8') as f:
        json.dump({'name': 'chaizi-nuodui', 'uuid': proj_uuid,
                   'version': '3.8.8', 'creator': {'version': '3.8.8'}},
                  f, ensure_ascii=False, indent=2)
    print('  写入 package.json')

    # ---- 场景：搬过来只改三处（名字无关，重要的是 _id 与相机底色）----
    raw = open(os.path.join(SRC_PROJ, 'assets/scenes/Main.scene'), encoding='utf-8').read()
    raw = raw.replace('"0f05e2d4-7857-5f45-a2f7-ff3f949dc2f8"', '"%s"' % scene_uuid)
    raw = raw.replace('"_name": "Main"', '"_name": "Main"')
    # 相机底色：上一轮是墨绿桌面，这里换成案几深灰
    raw = re.sub(r'("_color":\s*\{\s*"__type__":\s*"cc\.Color",\s*"r":\s*)\d+(,\s*"g":\s*)\d+(,\s*"b":\s*)\d+',
                 lambda m: '%s%d%s%d%s%d' % (m.group(1), BG[0], m.group(2), BG[1], m.group(3), BG[2]),
                 raw, count=1)
    scene_path = os.path.join(DST, 'assets/scenes/Main.scene')
    open(scene_path, 'w', encoding='utf-8').write(raw)
    assert scene_uuid in raw, '场景 uuid 没写进去'
    assert '"r": 35' in raw, '相机底色没改成功'
    with open(scene_path + '.meta', 'w', encoding='utf-8') as f:
        json.dump({'ver': '1.1.50', 'importer': 'scene', 'imported': True,
                   'uuid': scene_uuid, 'files': ['.json'], 'subMetas': {}, 'userData': {}},
                  f, ensure_ascii=False, indent=2)
    print('  写入 Main.scene（Canvas %d×%d，相机底色 #23262c）' % (DESIGN_W, DESIGN_H))

    # ---- 构建配置：AppID 只能从 configPath 传（顶层 appid= 会被静默忽略）----
    cfg = {
        '_说明': ('Cocos 微信小游戏构建配置。tools/cocos-build.sh 会把它通过 '
                  '--build configPath= 传给 Creator —— 这是唯一能可靠写入 AppID 的通道'
                  '（命令行顶层的 appid= 与 --build \'{"json":...}\' 都会被静默忽略，'
                  '回落成模板 demo 号）。'),
        'platform': 'wechatgame',
        'debug': False,
        'outputName': 'wechatgame',
        'startScene': scene_uuid,
        'packages': {
            'wechatgame': {
                'appid': APPID,
                'orientation': 'portrait',
                'separateEngine': False,
                'highPerformanceMode': False,
                'buildOpenDataContextTemplate': '',
            }
        },
    }
    with open(os.path.join(DST, 'build-config/wechatgame.json'), 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
    print('  写入 build-config/wechatgame.json（appid=%s）' % APPID)

    print('\n✅ 骨架就绪：%s' % DST)
    print('   startScene = %s' % scene_uuid)
    return 0


if __name__ == '__main__':
    sys.exit(main())
