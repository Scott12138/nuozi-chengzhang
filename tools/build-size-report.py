#!/usr/bin/env python3
"""构建产物体积体检 —— 主包 / 各分包 / 固定占用，并对 4MB 红线给结论。

【为什么必须有这一步，而不是"看一眼 du -sh"】
微信小游戏「主包 ≤ 4MB」是**上架硬红线**，而它算的是「除 subpackages/ 之外的全部文件」。
`du -sh build/wechatgame` 给的是**含分包的总和**（本工程 6.76MB），
拿它跟 4MB 比会得出"超了 2.7MB"的错误结论，然后去做一堆没必要的优化。
反过来，`du` 按块（4KB 对齐）统计，248 张小文件会被系统性高估 ——
必须按**真实字节** `st_size` 累加。

【判据是产物结构，不是日志】
某个章的资料如果没进 `subpackages/`，构建**照样成功**、日志里也有
"output config of bundle ch0N success"，只是字节全在主包里。
所以体检脚本同时核对 `game.json` 里声明了几个分包、以及每个分包目录在不在。

用法： python3 tools/build-size-report.py [产物目录]
      默认 game-5-chaizi/build/wechatgame
退出码：0 = 主包在红线内；1 = 超了（不该被忽略）
"""
import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    ROOT, 'game-5-chaizi', 'build', 'wechatgame')

MAIN_LIMIT = 4 * 1024 * 1024          # 主包 4MB
TOTAL_LIMIT = 30 * 1024 * 1024        # 主包 + 全部分包 30MB（开通虚拟支付后）

MB = 1024 * 1024


def size(p):
    if os.path.isfile(p):
        return os.path.getsize(p)
    s = 0
    for r, _, fs in os.walk(p):
        for f in fs:
            s += os.path.getsize(os.path.join(r, f))
    return s


def main():
    if not os.path.isdir(OUT):
        print('✗ 找不到产物目录：%s\n  先跑： bash tools/cocos-build.sh' % OUT)
        return 1

    total = size(OUT)
    subdir = os.path.join(OUT, 'subpackages')
    sub = size(subdir) if os.path.isdir(subdir) else 0
    main_pkg = total - sub

    # ── game.json 声明 vs 目录实际 ──
    gj = json.load(io.open(os.path.join(OUT, 'game.json'), encoding='utf-8'))
    declared = [s['name'] for s in gj.get('subpackages', [])]
    on_disk = sorted(os.listdir(subdir)) if os.path.isdir(subdir) else []

    print('产物目录 %s' % OUT)
    print()
    print('  ★ 主包          %9d B   %6.2f MB   （红线 %d MB）'
          % (main_pkg, main_pkg / MB, MAIN_LIMIT // MB))
    left = MAIN_LIMIT - main_pkg
    print('     余量          %9d B   %6.2f MB   %s'
          % (left, left / MB, '✅ 在红线内' if left >= 0 else '❌ 超红线！'))
    print('    全部分包      %9d B   %6.2f MB' % (sub, sub / MB))
    print('    （合计        %9d B   %6.2f MB   上限 %d MB）'
          % (total, total / MB, TOTAL_LIMIT // MB))
    print()

    if declared or on_disk:
        print('  分包（game.json 声明 / 盘上目录）：')
        for name in sorted(set(declared) | set(on_disk)):
            d = os.path.join(subdir, name)
            s = size(d) if os.path.isdir(d) else 0
            mark = '✓' if name in declared and name in on_disk else '✗'
            print('    %s %-6s %9d B   %6.2f MB' % (mark, name, s, s / MB))
        if set(declared) != set(on_disk):
            print('    ⚠️ game.json 声明与盘上目录不一致 —— 分包没真正生效，字节会落回主包')
        print()

    print('  主包构成：')
    parts = {}
    ad = os.path.join(OUT, 'assets')
    if os.path.isdir(ad):
        for n in os.listdir(ad):
            parts['assets/' + n] = size(os.path.join(ad, n))
    for n in os.listdir(OUT):
        p = os.path.join(OUT, n)
        if n in ('assets', 'subpackages'):
            continue
        if os.path.isfile(p):
            parts[n] = os.path.getsize(p)
        elif os.path.isdir(p):
            parts[n + '/'] = size(p)     # 引擎（cocos-js）在顶层目录里，别漏
    for k, v in sorted(parts.items(), key=lambda x: -x[1]):
        print('    %-24s %9d B   %6.1f KB' % (k, v, v / 1024))

    ok = left >= 0 and total <= TOTAL_LIMIT
    print()
    print('✅ 体积合格' if ok else '❌ 体积超标，需要再优化/再分包')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
