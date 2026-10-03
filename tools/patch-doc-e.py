import io, sys, re
p = 'docs/拆字挪对_游戏开发规格说明书.md'
s = io.open(p, encoding='utf-8').read()
orig = s

def rep(old, new, label):
    global s
    if old not in s:
        print('!! 未找到：' + label)
        return
    if s.count(old) != 1:
        print('!! 命中 %d 次（应为 1）：%s' % (s.count(old), label))
        return
    s = s.replace(old, new)
    print('ok  ' + label)

# 1) 术语表：连锁 → 改为「一次一对」的准确描述
rep('| **连锁** | 一次落位后同时形成多组可消对时，系统连续消除直到没有为止 |',
    '| **一次一对** | 一次点击 / 一次拖动只消除它直接凑成的那一对；**没有自动连锁**（v2.1 起） |',
    '术语表·连锁')

# 2) 状态机：消除后的分支描述
rep('| 6 | — | 两牌飞向中点、浮现汉字、目标条 +1；若同时形成多组则连锁 |',
    '| 6 | — | 两牌飞向中点、浮现汉字、目标条 +1、已成字条追加拆解卡；**只消这一对** |',
    '状态机·第6步')

# 3) 音效表：不连通 → 不在同行/列
rep('| 配对失败 · 不连通 | 抖动 + 红色虚线路径 | 300ms | 低频"嗯" |',
    '| 配对失败 · 不在同行 / 同列（或中间被挡） | 抖动 + 提示说明 | 300ms | 低频"嗯" |',
    '音效表·配对失败')

# 4) 流程图连线标签
rep('        判定 --> 读字拆字 : 不合法 / 不连通',
    '        判定 --> 读字拆字 : 不合法 / 不同行同列',
    '流程图·分支1')
rep('        判定 --> 消除动画 : 合法且连通',
    '        判定 --> 消除动画 : 合法且通视',
    '流程图·分支2')

# 5) 名词表：连通 → 通视（v2 只认通视）
rep('| 连通 | Linkable | `isLinkable()` |',
    '| 通视（判定） | Line of Sight | `lineClear()` / `isLineClear()` |',
    '名词表·连通')

io.open(p, 'w', encoding='utf-8').write(s)
print('\n已写回，变更 %d 字符' % (len(s) - len(orig)))
