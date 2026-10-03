#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
sfx-probe.py · 音效体检（没有任何听感时的"眼睛"）

为什么需要它：无头环境下改音效只能靠猜。这个脚本把三段最关键的主观描述
翻译成可测量的量：

  · "清脆"      → 零交叉率（高频占比的廉价代理）+ 高频带能量比
  · "快 / 短"   → -20dB 衰减时间（包络掉到峰值 10% 用了多久）
  · "不糊"      → 低频带能量比（<300Hz）—— 拖动时一秒响十次，
                  低频会累积成轰轰的底噪，这一列是"珠子"能不能用的判据

  · 循环接缝（只有 BGM 有意义）：循环点跳变 ÷ 曲内强拍跳变中位数。

用法：
    python3 tools/sfx-probe.py                      # 量 docs/verify/S6/sfx/*.m4a
    python3 tools/sfx-probe.py <某个.m4a> [...]
"""
import math
import os
import struct
import subprocess
import sys
import tempfile
import wave

SR = 44100


def read_m4a(path):
    """m4a → 单声道 float 列表（借 afconvert 解码成 wav，再读）"""
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
        tmp = f.name
    try:
        r = subprocess.run(
            ['afconvert', '-f', 'WAVE', '-d', 'LEI16@44100', '-c', '1', path, tmp],
            capture_output=True,
        )
        if r.returncode != 0:
            raise RuntimeError(f'afconvert 失败：{r.stderr.decode()[:160]}')
        with wave.open(tmp, 'rb') as w:
            n = w.getnframes()
            raw = w.readframes(n)
            ch = w.getnchannels()
        vals = struct.unpack(f'<{len(raw) // 2}h', raw)
        if ch > 1:
            vals = vals[::ch]
        return [v / 32768.0 for v in vals]
    finally:
        os.unlink(tmp)


def rms(seg):
    return math.sqrt(sum(v * v for v in seg) / max(1, len(seg)))


def band_energy(sig, lo, hi):
    """
    用一阶 IIR 带通近似求某个频带的能量占比。
    不做 FFT —— 免依赖，而且这里要的只是"哪个频带为主"这个量级判断。
    """
    a = 1.0 - math.exp(-2 * math.pi * hi / SR)       # 低通
    b = 1.0 - math.exp(-2 * math.pi * lo / SR)       # 更低的低通
    y = z = 0.0
    tot = 0.0
    bp = 0.0
    for v in sig:
        y += a * (v - y)
        z += b * (v - z)
        band = y - z
        bp += band * band
        tot += v * v
    return bp / tot if tot > 1e-12 else 0.0


def probe(path):
    sig = read_m4a(path)
    n = len(sig)
    dur_ms = n / SR * 1000.0
    peak = max((abs(v) for v in sig), default=0.0)
    rms_all = rms(sig)

    # 零交叉率（每秒）
    zc = 0
    prev = sig[0] if n else 0.0
    for v in sig:
        if (v >= 0) != (prev >= 0):
            zc += 1
        prev = v
    zcr = zc / max(dur_ms / 1000.0, 1e-6)

    # 有效结束时刻：**从峰值那一帧起**往后找，最后一个仍然 > 峰值帧 10% 的位置。
    #
    # ⚠️ 第一版写成了"从 0 开始找第一个低于阈值的帧"，结果它在带起音的音效上
    #    （clear / fail / revive 都是慢起音）当场返回 0 ——
    #    因为第 0 毫秒本来就是静音，"低于阈值"立刻成立。
    #    那个数看着像"衰减极快"，实际测的是"起音前有多静"。**判据错了比没有更糟**。
    step = max(1, int(SR * 0.001))
    frames = [(i, rms(sig[i:i + step])) for i in range(0, n, step)]
    if not frames:
        return dict(name=os.path.splitext(os.path.basename(path))[0], dur_ms=dur_ms,
                    peak=peak, rms_db=-99, zcr=zcr, tail_ms=0, peak_ms=0,
                    low=0, mid=0, high=0)
    pk_i, pk_v = max(frames, key=lambda kv: kv[1])
    thr = pk_v * 0.1
    tail_i = pk_i
    for i, v in frames:
        if i >= pk_i and v > thr:
            tail_i = i
    peak_ms = pk_i / SR * 1000.0
    tail_ms = tail_i / SR * 1000.0

    return dict(
        name=os.path.splitext(os.path.basename(path))[0],
        dur_ms=dur_ms,
        peak=peak,
        rms_db=20 * math.log10(max(rms_all, 1e-9)),
        zcr=zcr,
        peak_ms=peak_ms,          # 峰值出现时刻（起音快不快）
        tail_ms=tail_ms,          # 有效结束时刻（声音实际有多长）
        low=band_energy(sig, 20, 300),        # 低频占比
        mid=band_energy(sig, 300, 2000),
        high=band_energy(sig, 2000, 12000),
    )


def main():
    args = [a for a in sys.argv[1:]]
    if args:
        files = args
    else:
        d = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                         '..', 'docs', 'verify', 'S6', 'sfx')
        files = sorted(os.path.join(d, f) for f in os.listdir(d) if f.endswith('.m4a'))
    if not files:
        print('没有找到 .m4a')
        return 1

    print(f'{"名称":<9}{"时长ms":>8}{"RMS dB":>8}{"零交叉/秒":>10}'
          f'{"峰值ms":>8}{"结束ms":>8}{"低频%":>8}{"中频%":>8}{"高频%":>8}')
    print('-' * 82)
    for f in files:
        r = probe(f)
        print(f'{r["name"]:<9}{r["dur_ms"]:8.0f}{r["rms_db"]:8.1f}{r["zcr"]:10.0f}'
              f'{r["peak_ms"]:8.0f}{r["tail_ms"]:8.0f}{r["low"] * 100:7.0f}%'
              f'{r["mid"] * 100:7.0f}%{r["high"] * 100:7.0f}%')
    return 0


if __name__ == '__main__':
    sys.exit(main())
