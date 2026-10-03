# -*- coding: utf-8 -*-
"""阶段 4：清理散落在各章的 v1（连线版）遗留表述。"""
import io, json, os

DOC = '/Users/consli/WorkBuddy/2026-10-01-19-57-04/chaizi-lianliankan/docs/拆字挪对_游戏开发规格说明书.md'
WL  = '/Users/consli/WorkBuddy/2026-10-01-19-57-04/chaizi-lianliankan/assets/wordlib.json'
s = io.open(DOC, encoding='utf-8').read()
log = []

def rep(old, new):
    global s
    n = s.count(old)
    if n == 0:
        log.append('✗ 未匹配: ' + old[:44]); return
    s = s.replace(old, new)
    log.append('✓ x%d  %s' % (n, old[:44]))

# 1.1 核心乐趣公式
rep('| **路径连通** |', '| **挪动规划** |')
rep('0/1/2 折点判定 + 绕圈 + 腾挪', '空格稀缺，一步只能挪一张，每步都是空间取舍')
rep('退化成普通连连看，失去题材灵魂', '退化成普通消除，失去题材灵魂')

# 3.4 干扰牌
rep('提高路径阻塞，让腾挪有意义', '制造空间阻力、压缩挪动空间')
rep('灰调 + 裂纹视觉', '灰墨色 + 斜线划痕')
rep('**废牌的消除规则**：两张**同名废牌**可以互相消除（回到经典连连看规则）。',
    '''**干扰牌的消除规则（v2 已修订）**：干扰牌**永远不可消除**，也不计入过关条件。它是纯空间阻力，玩家只能绕开它。过关条件只看**有效牌（偏旁 + 部件）是否全部消完**。

> ⚠️ v1 曾规定「两张同名废牌可以互消」。v2 取消这条：一来会削弱干扰牌的阻力作用，二来会让玩家误以为废牌也是可用资源。''')

# 6.1 音频清单
rep('| 腾挪 | 牌沿直线滑动 + 拖尾 | 200ms |', '| 挪牌 | 牌跟随手指移动、落位吸附 | 200ms |')
rep('连连看类游戏如果只有', '消除类游戏如果只有')

# 5.3 状态机
rep('死局检测 --> 腾挪提示 : 无解且有腾挪次数', '死局检测 --> 洗牌引导 : 无解且有洗牌次数')
rep('死局检测 --> 自动重排 : 无解且腾挪用完', '死局检测 --> 免费重排 : 无解且洗牌用完')
rep('腾挪提示 --> 读字拆字', '洗牌引导 --> 读字拆字')

# 7.2 目录结构
rep('LinkFinder.js', 'PairJudge.js')
rep('# ★ 连通判定（0/1/2 折点 + 外圈绕行）', '# ★ 配对判定 + 通视判定（canPair / lineClear / matchTargets）')

# 7.7 埋点
rep('`nudge_used`', '`move_count`')
rep('腾挪机制的实际使用率，验证这个机制是否被玩家感知', '每关挪动次数，用于校准关卡难度（次数异常偏高说明构图过难）')

# 8.2 广告位
rep('**A3 腾挪补充**', '**A3 提示补充**')
rep('关内点 ↔️（3 次用完后）', '关内点「提示」（3 次用完后）')

# 第 10 章 核心难点
rep('玩家明明还有牌，却一个都连不了，只能干等', '玩家明明还有牌，却一个都消不了，只能干等')
rep('① 每次消除后自动检测 ② 有腾挪次数时气泡引导 ③ 没有则**自动免费重排**',
    '① 每次挪动后自动检测（**必须先判 hasDirectMatch，否则会把"已对齐"误报成死局**）② 洗牌按钮发光 + 气泡引导 ③ 洗牌用完则**自动免费重排**')
rep('`reshuffle_auto` 的触发率', '`deadlock_hit` 的触发率')
rep('**腾挪机制玩家根本发现不了**', '**玩家不知道「牌可以拖」**')
rep('| 🟠 中 | 这是需求方指定的机制，但玩家不会主动去"把牌拖到空格"',
    '| 🔴 高 | 只要玩家以为这是连连看（牌不动），整局就废了')
rep('① 连续 3 次判定失败后**强制弹一次引导**（见 2.7.3）② 道具栏里常驻 ↔️ 图标 ③ 首次可腾挪时给一次"预演"动效',
    '① 第 1 关**强制**走一次拖动手势引导 ② 拖动时搭档牌发光 + 金色虚线，把规则"演"给玩家看 ③ 点未对齐的牌时给出"拖一张过去让它们对齐"的文案')

# 第 11 章 里程碑
rep('拆字+连连看', '拆字+挪对')

# 13.4 名词中英对照
rep('| 折点 | Corner / Turn | `corners` |\n| 腾挪 | Nudge | `nudge()` |',
    '| 通视 | Line of Sight | `lineClear()` |\n'
    '| 挪动 | Move / Shift | `moveTile()` |\n'
    '| 配对判定 | Pair Check | `canPair()` |\n'
    '| 挪动求解器 | Move Solver | `findSuggest()` |\n'
    '| 偏旁牌 | Radical Tile | `kind:"radical"` |\n'
    '| 部件牌 | Component Tile | `kind:"part"` |\n'
    '| 干扰牌 | Junk Tile | `kind:"junk"` |')

# JSON 片段里的游戏名
rep('"game": "拆字连连看（暂定名）"', '"game": "拆字挪对（暂定名）"')

io.open(DOC, 'w', encoding='utf-8').write(s)

# 同步字库文件里的 game 字段
if os.path.exists(WL):
    d = json.load(io.open(WL, encoding='utf-8'))
    meta = d.get('meta', {})
    if 'game' in meta:
        meta['game'] = meta['game'].replace('拆字连连看', '拆字挪对')
    io.open(WL, 'w', encoding='utf-8').write(json.dumps(d, ensure_ascii=False, indent=2))
    print('wordlib.json game 字段已同步')

print('\n'.join(log))
print('阶段 4 完成')
