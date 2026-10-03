#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
============================================================
 make-bgm.py · 程序化合成候选 BGM（零素材依赖）
============================================================
 项目：《挪字成章》（chaizi-lianliankan / game-5-chaizi）
 素材血统：从隔壁 `game-4-mahjong/tools/make-bgm.py` 移植。**编曲引擎
 （Song / nf / shift / put-wrap / duck / active_rms / auto_balance /
 analyze 的循环接缝口径）与"合成链家法"原样沿用**；
 配器与配方按本作题材（古风 · 将军令 · 汉字拆合）重写。

 为什么要"合成"而不是"下一条曲子"：
   ① 版权干净 —— 本作上线主体是**个人开发者**，BGM 若来自曲库/下载，
      授权链极难自证；自己合成则"来源 = 本仓库这 1 个脚本"，
      和既有 13 段音效同一份出生证明。
   ② 家法一致 —— 采样率、电平标准、afconvert 参数、容器时间清零，
      全部与 make-sfx.py 对齐，不放两条产线在仓库里。
   ③ 参数可调 —— 速度/调式/配器/循环长度全是脚下几行数字。
      拍板后想"再快一点""鼓再轻一点""多两小节"，改参数重跑即可，
      不用回头去求第 12 个素材网站。

 ------------------------------------------------------------
  ★ 用户拍板（第 1 轮，2026-10-01）：**要古风，有点将军令的那种感觉**。
    第 1 轮据此做了"将军令轴"4 段（唢呐 + 战鼓，104→132BPM），用户选了 C 点将。
 ------------------------------------------------------------
  ★★ 用户反馈（第 2 轮，2026-10-02 真机试玩后）：**「这背景 BGM 太辣耳朵了」**
    并要求：**用古筝来演奏、舒缓一些、不用太着急、可以抒情一些。**

    ⚠️ 所以第 2 轮是**推倒重来，不是调参数**。"辣"的三个来源都跟"国不国风"
       无关、只跟"吵不吵"有关，逐个钉死在这里，免得后人又改回去：
         ① 唢呐 i_suona 的 9 次谐波锯齿谱 —— 手机小喇叭上就是"尖"；
         ② 战鼓 i_dagu 96→32Hz、每小节两下 —— 抒情拆字不需要这么重的地基；
         ③ 116BPM + 十六分木鱼 —— 高频瞬态密铺把零交叉率顶到 1678，
            而"安静"的 A 段只有 847（差一倍，这就是"辣"的量化形态）。
    第 2 轮的轴换成**「有多静 / 有多流动」**，铁律四条：
       · 主奏一律古筝（新增 i_guzheng：义甲瞬态 + 两段余韵 + 邻弦共鸣）；
       · **不要唢呐、不要战鼓**；
       · 慢下来（64 / 70 / 76 / 82 BPM，全部低于上一版最慢的 104）；
       · 高频收着给：木鱼整段只 2 下（-27dB），手鼓只有最流动的 D 段有（-25dB）。
    → 用户挑的仍然是**这条轴上的位置**，不是"哪首好听"。
 ------------------------------------------------------------

 第 2 轮 4 段候选（古筝 · 舒缓抒情轴）：
   A 空山    64BPM D宫五声 古筝独奏        最静，一个鼓点都没有（轴最左）
   B 流水    70BPM G宫五声 古筝 + 淡琶音    安静但有流动（轴左中）
   C 月夜    76BPM A宫五声 古筝 + 箫        最抒情，箫吹句尾长音（轴右中）
   D 行云    82BPM D宫五声 古筝 + 十六分琶音 最流动，配器档位**基准**（轴最右）
   （第 1 轮的 A 墨韵 / B 鼓韵 / C 点将 / D 行军配方已整段替换，
     音色函数 i_suona / i_dagu / i_gong 保留未删 —— 万一将来要"沙场"那味。）

 ⚠️ 拍板后只改下面的 `CHOSEN` 一行，再跑 `--install` —— **别手工拷文件**
    （手工拷会丢 `.meta` 的 uuid，Cocos 里表现为"资源莫名为空"，且不报错）。

 合成链：Python 直出 16bit/44.1kHz 单声道 WAV
         → 系统 afconvert 转 AAC 64kbps（m4a）
         → 调 make-sfx.py 的 zero_container_times() 清容器时间戳
         → docs/verify/S6/bgm/（试听页消费的就是这一份）
         →（--install）直接搬进 game-5-chaizi/assets/resources/audio/bgm.m4a

 用法：
     python3 tools/make-bgm.py                 # 合成 4 段
     python3 tools/make-bgm.py --only A,C      # 只出指定段
     python3 tools/make-bgm.py --wav-only      # 只出 wav（调试波形用）
     python3 tools/make-bgm.py --stems         # 打印各声部"活跃段 RMS"，校验配器平衡
     python3 tools/make-bgm.py --no-trim       # 关掉自动配平，听原始写法的平衡
     python3 tools/make-bgm.py --page          # 顺带生成试听页 HTML
     python3 tools/make-bgm.py --install       # 把 CHOSEN 那段装进游戏（bgm.m4a）

 ⚠️ 本机**没有 ffmpeg**，转码只能用系统的 afconvert / afinfo。

 ⚠️ `--install` **不重新合成**，而是直接搬 `OUT_DIR` 里那份已通过自检的 m4a。
    这是有意的：**用户拍板时听的就是那个文件** —— 重新渲染一次等于
    "拍板的和上线的是两个东西"，哪怕参数没变也不该冒这个险。

 ⚠️ 【循环无缝】每条轨道的总长**恰好**是 bars×16 个十六分音符，
    音符尾巴超出末尾的部分**回绕到开头**（见 Song.put 的 wrap）。
    所以它天生可循环：末小节第 4 拍的吊镲余音会接进第 1 小节开头。
    这也意味着**不能**在首尾做淡入淡出 —— 那会在循环点上砍出一个豁口。

 ⚠️ 【随机数用固定种子 + 每次 new 一个 Random】
    噪声（军鼓/踩镲/沙锤）是"合成素材"的一部分，必须逐字节可复现。
    每个音色内部各自 random.Random(固定种子)，**不共用全局 random** ——
    否则改动一处调用顺序就会让所有噪声音色全部变化。
============================================================
"""

import base64
import importlib.util
import json
import math
import os
import random
import shutil
import struct
import subprocess
import sys
import wave

# ------------------------------------------------------------
#  全局参数
# ------------------------------------------------------------
SR = 44100              # 采样率。与 make-sfx.py 一致
TAU = math.pi * 2.0
PEAK = 0.70             # 归一化峰值。与既有 13 段音效同一标准，方便公平 A/B
LIMIT = 1.35            # 软削波驱动量：压掉瞬态波峰，让整轨听起来更"满"
SEAM_TOL = 1.25         # 循环接缝判据的容差，见 analyze() 里那段长注释
HERE = os.path.dirname(os.path.abspath(__file__))
#  ★ 暂存目录：**试听/拍板消费的就是这一份**。--install 才搬进游戏，
#    搬的时候不重新渲染 —— 否则"拍板的"和"上线的"会变成两个东西。
OUT_DIR = os.path.abspath(os.path.join(HERE, '..', 'docs', 'verify', 'S6', 'bgm'))
WAV_DIR = '/tmp/chaizi-bgm-wav'

# ★ 落库目标：**Cocos 工程在 game-5-chaizi/ 里面**，不在仓库根。
#   ⚠️ 移植时照抄了上游的 HERE/../assets/... —— 而本仓库根那个 assets/ 里
#   只有 wordlib.json。`os.makedirs(exist_ok=True)` 会**开心地把错目录建出来**、
#   文件也照写，全程不报错，表现是"入库成功"但工程里一个音频都没有。
#   现在改成显式两级，并在 install_to_game() 里先断言工程根存在。
GAME_ROOT = os.path.abspath(os.path.join(HERE, '..', 'game-5-chaizi'))
GAME_AUDIO = os.path.join(GAME_ROOT, 'assets', 'resources', 'audio')

# ★ 用户拍板前**先留空** —— 留空时 --install 会拒绝执行并列出可选值，
#   避免"还没选就装进去一段"。
#
#
# ★★ 2026-10-02 第 2 轮：用户听完第 1 轮的 C 点将后说「太辣耳朵了」，
#    要求改成**古筝演奏、舒缓、不着急、可以抒情**。配方已整段重写
#    （见文件头"第 2 轮"那一节与 §五 的配方注释）。
#
#    ★★ 2026-10-02 第 3 轮：用户在试听页里听完 4 段，**自己挑了 D 行云**
#      （82BPM / D 宫五声 / 35.1s / 277.2KB / 零交叉 1132 / 音头 3.53 每秒）。
#      它是这条轴上"最流动"的那一段 —— 琶音走得最密，但因为节拍器慢、
#      每音时值长，听感仍然是舒缓的（密集的是**过门**，不是**速度**）。
#      ⚠️ 它是 4 段里最"满"的一段 ⇒ 若真机上觉得盖住"碰"的撞击音，
#         先降 `CFG.AUDIO.BGM_GAIN`（现 0.30），别去改曲子。
#    换段只需改这一个字母再跑 `--install`（它搬的是已合成的那份，不重新渲染）。
#    候选：A 空山（最静，无鼓）/ B 流水 / C 月夜（最抒情，加箫）/ D 行云（★ 当前）
CHOSEN = 'D'
# 装进游戏后的资源名 —— 这个名字同时决定
# ① 落盘路径 assets/resources/audio/<INSTALL_AS>.m4a
# ② AudioService 里的加载路径 'audio/<INSTALL_AS>'
INSTALL_AS = 'bgm'


# ============================================================
#  〇、借用 make-sfx.py 的容器时间清零
# ============================================================
#  文件名带连字符，`import make-sfx` 是语法错误，只能按路径加载。
#  （make-voice.py 已经踩过这个坑，这里照抄同一个做法。）
# ============================================================

def _load_zero_times():
    path = os.path.join(HERE, 'make-sfx.py')
    spec = importlib.util.spec_from_file_location('make_sfx_shared', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.zero_container_times


# ============================================================
#  一、基元：振荡器与包络
# ============================================================

def _n(sec: float) -> int:
    """秒 → 样点数（至少 1）"""
    return max(1, int(round(sec * SR)))


def env(n: int, *, atk=0.005, dec=0.0, sus=1.0, rel=0.05, curve=3.0) -> list:
    """
    通用包络：atk 线性起音 → dec 指数衰减到 sus → rel 线性收尾。

    · 只要 `dec=0 / sus=1`，中间段就是平的（持续音用这个）。
    · 收尾的起点取衰减段的**末值**，否则会在接缝处跳一下（爆音）。
    """
    out = [0.0] * n
    na = min(n, max(1, int(atk * SR)))
    nr = min(max(0, n - na), max(1, int(rel * SR)))
    nd = max(0, n - na - nr)
    start = sus if nd > 0 else 1.0
    for i in range(n):
        if i < na:
            g = i / na
        elif nd and i < na + nd:
            x = (i - na) / nd
            g = sus + (1.0 - sus) * math.exp(-curve * x)
        else:
            k = (i - na - nd) / nr if nr else 1.0
            g = start * (1.0 - min(1.0, k))
        out[i] = g
    return out


def _osc(ratios, amps, taus, f0, n, *, bend=0.0, bend_tau=0.05, duty=None):
    """
    加法合成一批分音（ratio 相对基频）。
    衰减用**乘性递推**而不是每样点调 exp —— 这是整条渲染链上最大的一笔开销。
    duty 给了就用脉冲波（方波族）替换正弦，用于主奏的"电"味。
    """
    h = len(ratios)
    ph = [0.0] * h
    g = [amps[k] for k in range(h)]
    dk = [math.exp(-1.0 / max(1e-6, taus[k] * SR)) for k in range(h)]
    inv = 1.0 / SR
    out = [0.0] * n
    for i in range(n):
        f = f0 * (1.0 + bend * math.exp(-i * inv / bend_tau)) if bend else f0
        s = 0.0
        for k in range(h):
            ph[k] += ratios[k] * f * inv
            if ph[k] >= 1.0:
                ph[k] -= 1.0
            s += ((1.0 if ph[k] < duty else -1.0) if duty else math.sin(TAU * ph[k])) * g[k]
            g[k] *= dk[k]
        out[i] = s
    return out


def _tail(sig, ms=10.0):
    """
    统一收尾淡出 —— 每个音色都强制做一次。

    【为什么每个音色都必须有】
      合成音色大多是"指数衰减 + 到点截断"，而**截断那一刻的幅度并不为零**。
      实测：i_bass 走到 dur 时包络还剩 21%、开镲甚至还剩 63% ——
      直接截断就是一个"咔"的爆音；低音每小节八下，就是八次爆音。
      10ms 的线性收尾，人耳听不出"淡出"，但足以把那个跳变抹平。

      放在 memoized 里统一做，是为了**保证没有任何一个音色被漏掉**：
      漏一个就是一处随机的爆音，而且极难定位（它不在报错里，只在耳朵里）。
    """
    n = len(sig)
    f = min(n, max(1, int(round(SR * ms / 1000.0))))
    out = list(sig)
    for i in range(f):
        out[n - f + i] *= 1.0 - (i + 1) / f
    return out


def memoized(fn):
    """
    按参数缓存渲染结果 + 统一收尾淡出。
    编曲里同一音高会重复出现几百次，缓存是刚需（渲染时间降两个数量级）。
    """
    cache = {}

    def wrapper(*a, **k):
        key = (a, tuple(sorted(k.items())))
        if key not in cache:
            cache[key] = _tail(fn(*a, **k))
        return cache[key]
    wrapper.__name__ = fn.__name__
    return wrapper


def active_rms(buf, frame=0.020, thresh=0.20, stride=3):
    """
    活跃段 RMS —— **只在"这个声部真的在响"的帧上**求 RMS。

    【为什么不能用整轨 RMS 做配平】
      吊镲整曲只响 2 次。若按整轨 RMS 衡量，它会被算得极低，
      配平时就被狂补 +20dB —— 而它一响就是全曲最响的一下，直接炸掉。
      所以要看的是"响的时候有多响"，这才是乐器之间的真实音量比。

    实现按 stride 抽样（每 3 个样点取 1），30 秒的曲子误差 <0.2dB，
    但省掉 2/3 的运算量。
    """
    f = _n(frame)
    vals = []
    for i in range(0, len(buf) - f, f):
        seg = buf[i:i + f]
        s = sum(v * v for v in seg[::stride])
        vals.append(math.sqrt(s / max(1, len(seg[::stride]))))
    if not vals:
        return 0.0
    mx = max(vals)
    if mx < 1e-9:
        return 0.0
    act = [v for v in vals if v > mx * thresh]
    return math.sqrt(sum(v * v for v in act) / len(act)) if act else 0.0


# ============================================================
#  二、打击乐
# ============================================================

@memoized
def i_kick(dur=0.34, f0=128.0, f1=44.0, tau=0.105, pitch_t=0.055, click=0.55):
    """底鼓：正弦从 128Hz 扫到 44Hz + 4ms 的高频击打瞬态"""
    n = _n(dur)
    out = [0.0] * n
    ph = 0.0
    k = math.log(f1 / f0)
    for i in range(n):
        t = i / SR
        f = f0 * math.exp(k * min(1.0, t / pitch_t))
        ph += f / SR
        if ph >= 1.0:
            ph -= 1.0
        s = math.sin(TAU * ph) * math.exp(-t / tau)
        if click and t < 0.014:
            s += math.sin(TAU * 1750.0 * t) * math.exp(-t / 0.0035) * click
        out[i] = s
    return out


@memoized
def i_snare(dur=0.24, tone=196.0, tau=0.090, hp_hz=1400.0, seed=11):
    """军鼓：高通噪声 + 一个中频膜音"""
    n = _n(dur)
    out = [0.0] * n
    rnd = random.Random(seed)
    a = 1.0 - math.exp(-TAU * hp_hz / SR)
    hp = 0.0
    px = 0.0
    for i in range(n):
        t = i / SR
        x = rnd.uniform(-1.0, 1.0)
        hp = a * (hp + x - px)
        px = x
        out[i] = hp * math.exp(-t / tau) * 2.6 + math.sin(TAU * tone * t) * math.exp(-t / 0.055) * 0.5
    return out


@memoized
def i_clap(dur=0.30, hp_hz=1100.0, seed=33):
    """拍手：3 簇极短噪声（模拟多只手不同时到）+ 一条尾巴"""
    n = _n(dur)
    out = [0.0] * n
    rnd = random.Random(seed)
    a = 1.0 - math.exp(-TAU * hp_hz / SR)
    hp = 0.0
    px = 0.0
    offs = (0.000, 0.010, 0.020)
    for i in range(n):
        t = i / SR
        x = rnd.uniform(-1.0, 1.0)
        hp = a * (hp + x - px)
        px = x
        g = 0.0
        for o in offs:
            if t >= o:
                g = max(g, math.exp(-(t - o) / 0.006))
        g = max(g, math.exp(-t / 0.16) * 0.45)
        out[i] = hp * g * 2.2
    return out


@memoized
def i_hat(dur=0.07, open_=False, hp_hz=7000.0, seed=22):
    """踩镲：高通噪声。open_=True 给开镲（长尾，"呲——"）"""
    n = _n(dur)
    out = [0.0] * n
    rnd = random.Random(seed)
    a = 1.0 - math.exp(-TAU * hp_hz / SR)
    hp = 0.0
    px = 0.0
    tau = 0.150 if open_ else 0.026
    for i in range(n):
        x = rnd.uniform(-1.0, 1.0)
        hp = a * (hp + x - px)
        px = x
        out[i] = hp * math.exp(-(i / SR) / tau) * 2.4
    return out


@memoized
def i_shaker(dur=0.05, seed=44):
    """沙锤：更柔的高频噪声，用来把十六分音符网格铺满"""
    n = _n(dur)
    out = [0.0] * n
    rnd = random.Random(seed)
    a = 1.0 - math.exp(-TAU * 5200.0 / SR)
    hp = 0.0
    px = 0.0
    for i in range(n):
        t = i / SR
        x = rnd.uniform(-1.0, 1.0)
        hp = a * (hp + x - px)
        px = x
        g = math.exp(-t / 0.030) * (1.0 - math.exp(-t / 0.002))
        out[i] = hp * g * 2.0
    return out


@memoized
def i_wood(dur=0.10, freq=1180.0, tau=0.020, seed=55):
    """木块/木鱼：带音高的短促敲击（三度、五度分音各一点）"""
    n = _n(dur)
    out = [0.0] * n
    rnd = random.Random(seed)
    body = _osc([1.0, 2.76, 5.4], [1.0, 0.32, 0.10], [tau, tau * 0.6, tau * 0.4], freq, n)
    for i in range(n):
        t = i / SR
        out[i] = body[i] + rnd.uniform(-1.0, 1.0) * math.exp(-t / 0.004) * 0.35
    return out


@memoized
def i_tom(dur=0.30, freq=150.0, tau=0.11):
    """手鼓/通鼓：低中频膜音，给国风段做「咚 · 哒」的骨架"""
    n = _n(dur)
    out = [0.0] * n
    ph = 0.0
    for i in range(n):
        t = i / SR
        f = freq * (1.0 + 0.35 * math.exp(-t / 0.03))
        ph += f / SR
        if ph >= 1.0:
            ph -= 1.0
        out[i] = math.sin(TAU * ph) * math.exp(-t / tau)
    return out


@memoized
def i_crash(dur=1.10, hp_hz=3600.0, tau=0.34, seed=77):
    """吊镲：高通噪声长衰减，用在乐段开头"""
    n = _n(dur)
    out = [0.0] * n
    rnd = random.Random(seed)
    a = 1.0 - math.exp(-TAU * hp_hz / SR)
    hp = 0.0
    px = 0.0
    for i in range(n):
        t = i / SR
        x = rnd.uniform(-1.0, 1.0)
        hp = a * (hp + x - px)
        px = x
        out[i] = hp * math.exp(-t / tau) * 2.2
    return out


@memoized
def i_riser(dur=1.90, f0=280.0, f1=3600.0, seed=88):
    """上行音效（riser）：乐段切换前铺一条"要来了"的斜坡"""
    n = _n(dur)
    out = [0.0] * n
    rnd = random.Random(seed)
    ph = 0.0
    k = math.log(f1 / f0)
    for i in range(n):
        t = i / SR
        x = i / n
        f = f0 * math.exp(k * x)
        ph += f / SR
        if ph >= 1.0:
            ph -= 1.0
        saw = 2.0 * ph - 1.0
        out[i] = (saw * 0.5 + rnd.uniform(-1.0, 1.0) * 0.5) * (x ** 1.6)
    return out


# ============================================================
#  三、旋律类音色
# ============================================================

@memoized
def i_bass(freq, dur, *, c0=1500.0, c1=260.0, sweep_t=0.09, tau=None, drive=1.45):
    """合成贝斯：锯齿 + 方波 → 软削波 → 一阶低通（截止往下滑）。电子乐的低音脊梁"""
    n = _n(dur)
    out = [0.0] * n
    tau = tau if tau else dur * 0.65
    ph = 0.0
    y = 0.0
    a0 = 1.0 - math.exp(-TAU * c0 / SR)
    a1 = 1.0 - math.exp(-TAU * c1 / SR)
    k = math.log(c1 / c0)
    for i in range(n):
        t = i / SR
        ph += freq / SR
        if ph >= 1.0:
            ph -= 1.0
        saw = 2.0 * ph - 1.0
        sq = 1.0 if ph < 0.5 else -1.0
        x = math.tanh((saw * 0.72 + sq * 0.42) * drive)
        a = a0 + (a1 - a0) * min(1.0, t / sweep_t)
        y += a * (x - y)
        g = math.exp(-t / tau)
        if t < 0.004:
            g *= t / 0.004
        out[i] = y * g
    return out


@memoized
def i_pluck(freq, dur, *, bright=0.55, bend=0.012, seed=101):
    """拨弦/古筝：少量分音、高次衰减更快、带一点起音上滑"""
    n = _n(dur)
    body = _osc(
        [1.0, 2.0, 3.0, 4.02, 5.4],
        [1.0, bright * 0.62, bright * 0.34, bright * 0.22, bright * 0.12],
        [dur * 0.55, dur * 0.30, dur * 0.20, dur * 0.13, dur * 0.09],
        freq, n, bend=bend, bend_tau=0.035,
    )
    return body


@memoized
def i_marimba(freq, dur, *, tau=None):
    """马林巴/木琴：基音 + 4 倍分音 + 10 倍分音（琴板振型），高次衰减更快"""
    n = _n(dur)
    tau = tau if tau else dur * 0.45
    return _osc([1.0, 3.95, 9.2], [1.0, 0.30, 0.10], [tau, tau * 0.45, tau * 0.22], freq, n)


@memoized
def i_toy(freq, dur, *, tau=None):
    """玩具钢琴：正弦为主 + 一点点三倍分音，圆头圆脑"""
    n = _n(dur)
    tau = tau if tau else dur * 0.40
    body = _osc([1.0, 2.0, 3.01], [1.0, 0.16, 0.06], [tau, tau * 0.5, tau * 0.3], freq, n)
    e = env(n, atk=0.003, dec=dur * 0.6, sus=0.32, rel=0.05, curve=2.2)
    return [body[i] * e[i] for i in range(n)]


@memoized
def i_lead(freq, dur, *, duty=0.32, vib=5.4, vib_depth=0.005, seed=66):
    """主奏：脉冲波（方波族）+ 颤音。电子乐里最"抓耳"的一种音色"""
    n = _n(dur)
    out = [0.0] * n
    ph = 0.0
    e = env(n, atk=0.008, dec=dur * 0.85, sus=0.72, rel=min(0.09, dur * 0.35), curve=1.6)
    for i in range(n):
        t = i / SR
        f = freq * (1.0 + vib_depth * math.sin(TAU * vib * t) * min(1.0, t / 0.12))
        ph += f / SR
        if ph >= 1.0:
            ph -= 1.0
        out[i] = (1.0 if ph < duty else -1.0) * e[i]
    return out


@memoized
def i_flute(freq, dur, *, vib=5.0, vib_depth=0.008):
    """吹管（近似笛/箫）：正弦为主 + 三次分音一点点 + 明显颤音，慢起音"""
    n = _n(dur)
    out = [0.0] * n
    ph = 0.0
    ph3 = 0.0
    e = env(n, atk=min(0.10, dur * 0.3), dec=dur * 0.9, sus=0.8, rel=min(0.12, dur * 0.35), curve=1.4)
    for i in range(n):
        t = i / SR
        f = freq * (1.0 + vib_depth * math.sin(TAU * vib * t) * min(1.0, t / 0.25))
        ph += f / SR
        ph3 += 3.0 * f / SR
        if ph >= 1.0:
            ph -= 1.0
        if ph3 >= 1.0:
            ph3 -= 1.0
        out[i] = (math.sin(TAU * ph) * 0.85 + math.sin(TAU * ph3) * 0.15) * e[i]
    return out


@memoized
def i_epiano(freq, dur, *, idx=1.7, ratio=3.0, tau=None):
    """电钢：FM 合成（载波 + 快速衰减的调制器），有种"叮"的铃感"""
    n = _n(dur)
    out = [0.0] * n
    tau = tau if tau else dur * 0.85
    cph = 0.0
    mph = 0.0
    gi = idx
    dm = math.exp(-1.0 / (0.05 * SR))
    dk = math.exp(-1.0 / (tau * SR))
    e = env(n, atk=0.004, dec=dur * 0.9, sus=0.55, rel=0.06, curve=1.7)
    for i in range(n):
        cph += freq / SR
        mph += ratio * freq / SR
        if cph >= 1.0:
            cph -= 1.0
        if mph >= 1.0:
            mph -= 1.0
        out[i] = math.sin(TAU * cph + gi * math.sin(TAU * mph)) * dk * e[i]
        gi *= dm
    return out


@memoized
def i_pad(freqs, dur, *, cutoff=820.0, detune=0.0032, atk=0.28, rel=0.20):
    """
    铺底：每个音符 3 把失谐锯齿（左/中/右各偏 ±0.32%），一阶低通。
    失谐是"宽"的来源 —— 单把锯齿听起来是干的。
    """
    n = _n(dur)
    voices = []
    for f in freqs:
        for d in (-detune, 0.0, detune):
            voices.append(f * (1.0 + d))
    h = len(voices)
    ph = [0.0] * h
    inv = 1.0 / SR
    a = 1.0 - math.exp(-TAU * cutoff * inv)
    y = 0.0
    e = env(n, atk=atk, rel=rel, sus=1.0)
    out = [0.0] * n
    for i in range(n):
        s = 0.0
        for k in range(h):
            ph[k] += voices[k] * inv
            if ph[k] >= 1.0:
                ph[k] -= 1.0
            s += 2.0 * ph[k] - 1.0
        y += a * (s / h - y)
        out[i] = y * e[i]
    return out


# ============================================================
#  三·b、本作新增：古风乐器（唢呐 / 战鼓 / 开道锣）
# ============================================================
#  上游（麻将题材）的音色表里没有这三件，而"将军令"的气质**必须**靠它们：
#    唢呐 = 号角式主奏（将军令的"人声"）；战鼓 = 骨架；锣 = 开道的标点。
#  为什么不用现成的近似替代：
#    · 唢呐 ≈ i_lead（脉冲波）？不行 —— i_lead 是**电子**脉冲，方波整数比谐波，
#      听起来是"游戏机"；唢呐的第 5 次谐振峰 + 簧片气声 + 大颤音才是那股市井的"悍"。
#    · 战鼓 ≈ i_kick（底鼓）？不行 —— 底鼓尾巴 0.105s、扫到 44Hz，是"电子的鼓"；
#      战鼓要能听出**一张皮被擂下去的余韵**，尾巴得长一倍、还要有桶腔。
#    · 锣 —— 材质体系本来"刻意不要金属长尾"（那是给音效定的规矩，怕和 clash 撞车），
#      但开道锣是"将军令"的身份标记，所以保留、**只用 2 次、并压到 -26dB**，
#      让它当"氛围标点"而不是"游戏事件"。
# ============================================================

@memoized
def i_suona(freq, dur, *, vib=6.2, vib_depth=0.013, bend=-0.010,
            vib_t=0.18, seed=121):
    """
    唢呐：**簧片**乐器。谐波极丰富、亮而"扎"、颤音夸张、起音极快。

    与 i_lead（电子脉冲）/ i_flute（吹管）的区别：
      · 频谱走**锯齿型**（1..9 次谐波全给），并在第 3、5 次谐波上抬一个包
        —— 唢呐的"亮度"主要来自这个高次谐波包，而不是基音；
      · 叠一条**簧片气声**（很小的噪声），去掉它就不像"人吹的"；
      · 颤音深度 1.3%（笛子是 0.8%）、频率 6.2Hz —— 真人吹唢呐就是这么大；
      · 起音有个**从下方滑上来**的小动作（bend<0），这是吹管的肌肉记忆。

    ⚠️ 谐波用**恒定幅度**（不是像拨弦那样逐分音指数衰减）+ 统一包络。
       拨弦的"衰减型谐波"套在唢呐上会变成"弹拨"，一听就错。
    """
    n = _n(dur)
    out = [0.0] * n
    rnd = random.Random(seed)
    ratios = (1, 2, 3, 4, 5, 6, 7, 8, 9)
    #            基音   2次   3次   4次   5次   6次   7次   8次   9次
    amps = (1.00, 0.52, 0.80, 0.34, 0.60, 0.25, 0.19, 0.10, 0.07)
    ph = [0.0] * len(ratios)
    inv = 1.0 / SR
    # 簧片气声：高通噪声（3.2kHz 以上才是"呲"而不是"呼"）
    hp_a = 1.0 - math.exp(-TAU * 3200.0 / SR)
    hp = 0.0
    px = 0.0
    e = env(n, atk=0.012, dec=0.0, sus=1.0, rel=min(0.07, dur * 0.34))
    for i in range(n):
        t = i * inv
        # 颤音 + 起音滑音
        f = freq * (1.0 + vib_depth * math.sin(TAU * vib * t) * min(1.0, t / vib_t)
                    + bend * math.exp(-t / 0.05))
        s = 0.0
        for k in range(len(ratios)):
            ph[k] += ratios[k] * f * inv
            if ph[k] >= 1.0:
                ph[k] -= 1.0
            s += math.sin(TAU * ph[k]) * amps[k]
        # 气声只在起音头 10ms 里"吹"一下，之后收干（否则整段都在嘶）
        x = rnd.uniform(-1.0, 1.0)
        hp = hp_a * (hp + x - px)
        px = x
        out[i] = (s + hp * math.exp(-t / 0.010) * 0.9) * e[i]
    return out


@memoized
def i_dagu(dur=0.62, f0=96.0, f1=32.0, tau=0.230, pitch_t=0.075, body=0.34):
    """
    战鼓（大鼓）：比 i_kick 更低沉、尾巴长一倍，多一条"桶腔"共振。

    · 扫频 96 → 32Hz，比底鼓（128 → 44）低一档 —— 那是"大鼓"和"底鼓"的体量差；
    · pitch_t 0.075s（底鼓 0.055）—— 音高滑落更慢，听感更"沉"；
    · **1.62 倍分音**（非整数比）＝ 鼓桶里的空气腔共振。整数比会变成"有音高的
      定音鼓"，非整数比才是"一张皮"。
    """
    n = _n(dur)
    out = [0.0] * n
    ph = 0.0
    ph2 = 0.0
    k = math.log(f1 / f0)
    for i in range(n):
        t = i / SR
        f = f0 * math.exp(k * min(1.0, t / pitch_t))
        ph += f / SR
        if ph >= 1.0:
            ph -= 1.0
        ph2 += f * 1.62 / SR
        if ph2 >= 1.0:
            ph2 -= 1.0
        out[i] = (math.sin(TAU * ph) * math.exp(-t / tau)
                  + math.sin(TAU * ph2) * math.exp(-t / (tau * 0.35)) * body)
    return out


@memoized
def i_gong(dur=1.70, f0=196.0, tau=0.780, seed=131):
    """
    开道锣：非谐分音（1 / 1.009 / 2.41 / 3.79 / 5.28 / 7.10）+ 起音噪声瞬态。

    · 1.0 与 1.009 是一对**极近的分音** —— 它们之间会以 196×0.009 ≈ 1.8Hz
      相互拍频，这就是锣那种"晃"的余韵（单个分音是敲铁皮，不是锣）。
    · 其余分音取非整数比：金属体的振型本来就是非谐的。
    """
    n = _n(dur)
    ratios = (1.000, 1.009, 2.41, 3.79, 5.28, 7.10)
    amps = (1.00, 0.72, 0.62, 0.40, 0.24, 0.14)
    taus = tuple(tau * x for x in (1.00, 0.96, 0.78, 0.60, 0.44, 0.30))
    ph = [0.0] * len(ratios)
    g = list(amps)
    dk = [math.exp(-1.0 / max(1e-6, taus[k] * SR)) for k in range(len(ratios))]
    inv = 1.0 / SR
    rnd = random.Random(seed)
    out = [0.0] * n
    for i in range(n):
        t = i * inv
        s = 0.0
        for k in range(len(ratios)):
            ph[k] += ratios[k] * f0 * inv
            if ph[k] >= 1.0:
                ph[k] -= 1.0
            s += math.sin(TAU * ph[k]) * g[k]
            g[k] *= dk[k]
        out[i] = s + rnd.uniform(-1.0, 1.0) * math.exp(-t / 0.004) * 0.55
    return out


@memoized
def i_guzheng(freq, dur, *, bright=0.55, bend=0.010, body=0.28):
    """
    古筝（比 i_pluck 更"像筝"的一版 —— 抒情 BGM 的主奏全靠它）。

    与 i_pluck 的三处差别，每一处都对应"筝之所以是筝"的一件事：
      ① **义甲触弦瞬态**：起音处一记 ~2.6kHz 的极短爆音（τ=1.1ms）。
         拨弦乐器的"颗粒"全在这个瞬态上 —— 没有它就只剩一串衰减正弦，
         听着像电钢琴。
         ⚠️ 用**衰减正弦爆音**而不是白噪声：白噪声是全频带的，会把整段的
            零交叉率顶上去。上一版《点将》被判"辣耳朵"的元凶之一就是
            高频瞬态太多，这里不能再犯一次。
      ② **两段余韵**：弦自身的能量衰减快（0.30×dur），琴箱与岳山的反射
         拖一条长尾（1.40×dur）。古筝"余音袅袅"靠的就是这条尾巴 ——
         单段指数衰减怎么调都出不来"余韵"，只会出来"长短"。
      ③ **邻弦共鸣**：低八度一条极轻的同振（`body` 参数）。真筝拨一根弦，
         相邻弦与琴箱会一起微微响，这是"木头的屋子"和"正弦波"的分界。
      另外分音一律取**略高于整数倍**（2.003 / 3.010 / 4.021 …）：真弦有
      刚度，分音会偏高一点点 —— 这也是"拨弦"和"电子音"的差别之一。
    """
    n = _n(dur)
    inv = 1.0 / SR
    ratios = (1.0, 2.003, 3.010, 4.021, 5.045, 6.082)
    amps = (1.0, bright * 0.55, bright * 0.31, bright * 0.17, bright * 0.09, bright * 0.05)
    # 两段衰减：fast = 弦，slow = 琴箱；mix = 慢段占比（两段起点都是 1，和为 1）
    fast = tuple(dur * x for x in (0.30, 0.24, 0.17, 0.12, 0.085, 0.060))
    slow = tuple(dur * x for x in (1.40, 1.00, 0.62, 0.40, 0.26, 0.170))
    mix = (0.55, 0.50, 0.46, 0.42, 0.38, 0.34)
    dk1 = [math.exp(-inv / max(1e-6, t)) for t in fast]
    dk2 = [math.exp(-inv / max(1e-6, t)) for t in slow]
    ph = [0.0] * len(ratios)
    g1 = [1.0] * len(ratios)
    g2 = [1.0] * len(ratios)
    dkb = math.exp(-inv / max(1e-6, dur * 0.22))
    dkt = math.exp(-inv / 0.0011)
    gb = 1.0
    gt = 1.0
    phb = 0.0
    pht = 0.0
    bend_n = max(1, _n(0.030))        # 起音上滑只在这 30ms 内（左手按弦那一下）
    out = [0.0] * n
    for i in range(n):
        f = freq * (1.0 + bend * (1.0 - i / bend_n)) if i < bend_n else freq
        s = 0.0
        for k in range(len(ratios)):
            # ⚠️ **先取值、后递增相位** —— 顺序反了会埋一个循环点上的"啪"。
            #
            #   古筝主奏的第一个音就落在循环点（第 0 小节第 0 格）上。
            #   若写成"先 ph += f/SR 再 sin(TAU*ph)"，那么 out[0] 不是 0，
            #   而是 sin(2π·f/SR) —— 基音 294Hz 时是 0.042 还好，
            #   但 2.6kHz 的义甲瞬态是 sin(0.370) = **0.362**，乘上 0.42
            #   就是 0.152 ≈ 峰值的 22%。
            #   而曲子末尾是静音的（乐句收完） ⇒ 循环接缝从 0 直接跳到 0.152，
            #   实测 -13.2dBc —— 每圈一次"啪"。
            #   （上一版用 i_flute 当主奏，起音平缓，所以从未暴露这个坑。）
            s += math.sin(TAU * ph[k]) * amps[k] * ((1.0 - mix[k]) * g1[k] + mix[k] * g2[k])
            ph[k] += ratios[k] * f * inv
            if ph[k] >= 1.0:
                ph[k] -= 1.0
            g1[k] *= dk1[k]
            g2[k] *= dk2[k]
        s += math.sin(TAU * phb) * body * gb
        phb += (f * 0.5) * inv
        if phb >= 1.0:
            phb -= 1.0
        gb *= dkb
        s += math.sin(TAU * pht) * gt * 0.42
        pht += 2600.0 * inv
        if pht >= 1.0:
            pht -= 1.0
        gt *= dkt
        out[i] = s
    return out


# ============================================================
#  四、编曲引擎
# ============================================================

_PC = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}

# 参与**侧链泵动**的声部（底鼓类）。duck() 只认这张表里的声音当"泵"。
# 电子轨用 'kick'；本作古风轨用 'dagu'（战鼓）当泵 —— 战鼓落下去，
# pad / bass 一起"收气"，这就是"有动感"最直接的来源。
KICK_KEYS = ('kick', 'dagu')


def nf(name: str) -> float:
    """音名 → 频率。'C4' / 'F#3' / 'Bb5'，A4 = 440Hz"""
    s = name.strip()
    pc = _PC[s[0].upper()]
    i = 1
    while i < len(s) and s[i] in '#b':
        pc += 1 if s[i] == '#' else -1
        i += 1
    midi = (int(s[i:]) + 1) * 12 + pc
    return 440.0 * 2.0 ** ((midi - 69) / 12.0)


def pc_of(name: str) -> str:
    """
    音名 → 音级名（去掉八度）。**调内检查专用**，见 Song.audit()。
    'F#5' → 'F#'，'D3' → 'D'。
    """
    s = name.strip()
    out = s[0].upper()
    i = 1
    while i < len(s) and s[i] in '#b':
        out += s[i]
        i += 1
    return out


# 3 个调式的五声音阶（宫商角徵羽）。写在这里是为了让 Song.audit() 能**自动
# 检查旋律有没有出调** —— 旋律是手写的音名，敲错一个字母（比如把 F# 敲成 F）
# 不会报错，只会多一个"洋味"的音，而且极难在 30 秒的循环里定位。
PENTA = {
    'D宫五声': ('D', 'E', 'F#', 'A', 'B'),
    'G宫五声': ('G', 'A', 'B', 'D', 'E'),
    'A宫五声': ('A', 'B', 'C#', 'E', 'F#'),
}


def shift(name: str, semis: int) -> str:
    """把音名整体移调若干半音"""
    s = name.strip()
    pc = _PC[s[0].upper()]
    i = 1
    while i < len(s) and s[i] in '#b':
        pc += 1 if s[i] == '#' else -1
        i += 1
    midi = (int(s[i:]) + 1) * 12 + pc + semis
    names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    return f'{names[midi % 12]}{midi // 12 - 1}'


class Song:
    """
    网格：一拍 = 4 个十六分音符；step 越小越早。
    声部（stem）分开存，便于 --stems 打印 RMS 校验配器平衡 ——
    没有听感的情况下，"军鼓比主奏响 20dB"这种事只能靠数字抓出来。
    """

    def __init__(self, name, bpm, bars, mix=None, scale=None):
        self.name = name
        self.bpm = bpm
        self.bars = bars
        # 本段的「配器档位」偏移（dB，相对 TRIM_TARGET 基准）。见 MIX 段的长注释。
        # 走构造参数而不是全局查表：曲子和它的混音意图应该长在一起，
        # 加一段候选时不会忘了去别处补一行。
        self.mix = dict(mix or {})
        # 调式（PENTA 的键）。给了就让 audit() 自动检查旋律出没出调。
        self.scale = scale
        self.bad_notes = []          # [(step, 音名)] —— 出调的旋律音
        self.step_s = 60.0 / (bpm * 4.0)      # 一个十六分音符的秒数
        self.steps = bars * 16
        self.n = _n(self.steps * self.step_s)  # 恰好一圈，不留尾巴（见文件头）
        self._stems = {}
        self.kick_steps = []

    # ---- 缓冲 ----
    def stem(self, key):
        if key not in self._stems:
            self._stems[key] = [0.0] * self.n
        return self._stems[key]

    def put(self, key, sig, step, gain=1.0):
        """把 sig 叠加到第 step 个十六分音符处；**超出末尾的部分回绕到开头**"""
        buf = self.stem(key)
        at = int(round(step * self.step_s * SR))
        at %= self.n
        # ★ 记下"底鼓类"声部的位置，给 duck() 的侧链泵动用。
        #
        #  ⚠️ 这里修的是上游一个**沉默的 bug**：`kick_steps` 声明了、
        #  `duck()` 也老老实实遍历了，但**从来没有任何一行往里写过** ——
        #  于是所有 `s.duck(...)` 全是空转，"侧链泵动"这个卖点在波形上
        #  一点都没生效，而且不报错、不警告、跑得通，只有量波形才看得出来。
        #  修在 `put()` 而不是 `drumline()`：put 是**所有声部的唯一漏斗**
        #  （hit / drumline / melody 最后都走它），放这里不可能漏。
        if key in KICK_KEYS:
            self.kick_steps.append(step)
        ln = len(sig)
        for i in range(ln):
            buf[(at + i) % self.n] += sig[i] * gain

    # ---- 便捷写法 ----
    def hit(self, key, sig, step, gain=1.0):
        self.put(key, sig, step, gain)

    def drumline(self, key, pat, bar, maker, gain=1.0):
        """按一小节的 16 格字符串铺鼓：'x' 常规 / 'X' 重音 / '.' 空"""
        for i, ch in enumerate(pat):
            if ch == '.':
                continue
            g = gain * (1.25 if ch == 'X' else 1.0)
            self.put(key, maker(), bar * 16 + i, g)

    def melody(self, key, notes, bar0, maker, gain=1.0, extra_steps=0.9):
        """notes: [(step_in_phrase, 音名, 占几格)]；maker(频率, 秒) → 波形"""
        ok = PENTA.get(self.scale) if self.scale else None
        for st, note, ln in notes:
            # ---- 顺手做出调检查 ----
            # 只在**旋律**上查，不查和弦/低音：像 D 宫里的 A 和弦（A C# E）
            # 本身就含 C#（变宫，偏音），那是和声的正常用法，不是错。
            if ok is not None and pc_of(note) not in ok:
                self.bad_notes.append((bar0 * 16 + st, note))
            dur = ln * self.step_s * extra_steps
            self.put(key, maker(nf(note), dur), bar0 * 16 + st, gain)

    def audit(self):
        """返回本段的"自证"问题清单（目前只有一项：旋律出调）。"""
        return list(self.bad_notes)

    # ---- 侧链泵动 ----
    def duck(self, key, *, depth=0.42, release=0.13, attack=0.004):
        """
        给某声部加"泵动"（sidechain）：每次底鼓落下时把该声部压下去，再指数恢复。
        这是"有动感"最直接的来源 —— 踢一下、气一收，整首歌就跟着呼吸。
        """
        buf = self.stem(key)
        eg = [1.0] * self.n
        span = _n(release * 3.2)
        for s in self.kick_steps:
            at = int(round(s * self.step_s * SR)) % self.n
            for i in range(min(span, self.n)):
                t = i / SR
                if t < attack:
                    v = depth * (t / attack) + 1.0 - depth
                else:
                    v = 1.0 - (1.0 - depth) * math.exp(-(t - attack) / release)
                j = (at + i) % self.n
                if v < eg[j]:
                    eg[j] = v
        for i in range(self.n):
            buf[i] *= eg[i]

    # ---- 导出 ----
    def stems(self):
        return self._stems

    def render(self):
        out = [0.0] * self.n
        for buf in self._stems.values():
            for i in range(self.n):
                out[i] += buf[i]
        return out


# ============================================================
#  五、4 段候选的配方（古筝 · 「舒缓抒情」这条轴上的 4 个落点）
# ============================================================
#  ★ 这一版是**推倒重来**，不是上一版的微调。原因写在最前面，
#    免得后人照着"将军令"的旧注释又改回去：
#      上一版（唢呐主奏 + 战鼓 + 116BPM）真机试玩后的反馈是「太辣耳朵」。
#      "辣"的具体来源有三条，而且都跟"国不国风"无关、只跟"吵不吵"有关：
#        ① 唢呐的 9 次谐波锯齿谱 —— 手机小喇叭上这一段就是"尖"；
#        ② 战鼓 96→32Hz、每小节两下 —— 抒情拆字根本不需要这么重的地基；
#        ③ 116BPM + 十六分木鱼 —— 密铺的高频瞬态把零交叉率顶到 1678
#           （而"安静"的 A 段只有 847，差一倍）。
#      所以这一版的铁律：**不要唢呐、不要战鼓、慢下来、高频收着给。**
#
#  共同原则：
#   · 每小节一个和弦，4 小节一句；主奏旋律按"句"铺（见每段末尾的长注释）。
#   · 旋律**只用五声音阶**（宫商角徵羽），宁缺毋滥 —— 五声是"古风"最硬的
#     一道保险：只要不写 fa/si（宫调式里的第 4、7 级），怎么跳都不会"洋"。
#   · 主奏一律是**古筝 i_guzheng**：抒情的"唱"靠它的余韵，不靠音头。
#     所以这一版的旋律音符普遍更长（4~8 格，即一拍到两拍），
#     上一版那些 1~2 格的短音符是给唢呐写的，拿来弹筝只会显得碎。
#   · 打击乐在这 4 段里是**配角中的配角**：最静的 A 段一个鼓点都没有；
#     最流动的 D 段才出现手鼓，而且是 -25dB 的"点"，不是"行进"。
#
#  ★ 轴的方向（从最静到最流动）：
#      A 空山 64BPM → B 流水 70BPM → C 月夜 76BPM → D 行云 82BPM
#      速度、织体密度、打击乐分量**三个一起往右走** —— 只动其中一个的话，
#      "快"和"密"会打架（快而稀 = 空，慢而密 = 糊）。
#
#  ★ 4 段共用一张「声部目标表」（TRIM_TARGET）+ 各自的「配器档位」偏移（MIX）。
#    这样"谁该压着谁"是全工程**唯一**的一套关系，而不是 4 段各调各的。
#    没有这一层的话 auto_balance 会把 4 段的织体拉成一样响 —— 而"有多密"
#    恰恰就是这 4 段唯一的分档维度。
# ============================================================

# ------------------------------------------------------------
#  「配器档位」：各段相对 TRIM_TARGET 基准（= D 行云，最流动那一档）的 dB 偏移
# ------------------------------------------------------------
#  为什么是**偏移**而不是每段一张完整的表：
#    基准表回答的是"主奏和铺底谁该压着谁"，那是全工程共用的常识；
#    而"这一段该有多密"才是每段自己的事。用偏移表达，改基准时
#    4 段一起跟着走，不会出现"改了 3 段忘了第 4 段"。
#
#  读法：负数 = 比基准轻。1dB 约等于"能听出来但说不清"，
#  6dB ≈ 响度减半，10dB ≈ 从"主角"退到"背景"。
# ------------------------------------------------------------
MIX_A = {                       # 空山：最静 —— 只有筝与一层铺底
    'bass': -3.0, 'guzheng': -2.5, 'pad': +1.5,
}
MIX_B = {                       # 流水：加一层很淡的琶音
    'bass': -1.5, 'guzheng': -1.0, 'arp': -2.5, 'pad': +0.5,
}
MIX_C = {                       # 月夜：箫进来，铺底稍微让一点给箫
    'bass': -0.5, 'guzheng': -0.5, 'arp': -1.0, 'pad': +1.0,
}
MIX_D = {}                      # 行云 = 基准档，偏移全 0（也是"基准"这个称号的由来）
MIX = {'A': MIX_A, 'B': MIX_B, 'C': MIX_C, 'D': MIX_D}


def track_A():
    """A · 空山 —— 64BPM / D宫五声 / 古筝独奏（轴最左：最静，一个鼓点都没有）"""
    s = Song('A-空山', 64, 8, mix=MIX_A, scale='D宫五声')
    ch = {
        'D':  (['D3', 'F#3', 'A3'], 'D2'),
        'A':  (['A2', 'C#3', 'E3'], 'A2'),
        'Bm': (['B2', 'D3', 'F#3'], 'B2'),
        'G':  (['G2', 'B2', 'D3'], 'G2'),
    }
    order = ['D', 'A', 'Bm', 'G']      # 1-5-6-4，抒情最顺的一条

    # 旋律：**长音、级进、句尾落回主音**。
    # 每句 64 格（4 小节）里只有 12 个音 —— 一半以上的时间是留白，
    # 留白才是"空山"。古筝的余韵会把这些空白填满，不用再写音符进去。
    lead = [
        (0,  'A4', 6),  (6,  'B4', 2),  (8,  'D5', 8),  (16, 'B4', 4),  (20, 'A4', 4),
        (24, 'F#4', 6), (30, 'E4', 2),  (32, 'D4', 8),  (40, 'E4', 4),  (44, 'F#4', 4),
        (48, 'A4', 8),  (56, 'D4', 8),
    ]

    for b in range(s.bars):
        bar = b % 4
        tones, root = ch[order[bar]]
        beat = 1.0 * 4 * 60.0 / s.bpm

        # ---- 低音：一小节**两下**（根音 + 五度），比别的段都稀 ----
        # i_pluck 在低频比 i_guzheng 更"钝"，当低音反而合适（筝的低音弦本来就更厚）。
        for st, semi in [(0, 0), (8, 7)]:
            s.hit('guzheng', i_pluck(nf(shift(root, semi)), 1.10, bright=0.30),
                  b * 16 + st, 0.26)
        # 合成低音只兜一层底，且压得很轻（抒情曲的地基不该"顶"人）
        # ⚠️ gain 0.40 → 1.30：配平实测这一档需要 **+12.7dB** 才能到目标，
        #    撞了 ±12dB 的上限（家法：撞限 = 写法问题，回去改增益，不许硬拉）。
        #    原因是 i_bass 的低通扫频（c1=150Hz）把输出压得很扁，
        #    再乘 0.40 就掉到配平够不着的地方去了。
        s.hit('bass', i_bass(nf(root), 1.4, c0=520.0, c1=150.0, drive=0.85),
              b * 16, 1.30)

        # ---- 刮奏：**每 4 小节一次**，且落在奇数句（b//4 为奇）----
        # ⚠️ 不落在第 0 小节，这是上一版 A 段踩过的坑（详见那时的注释）：
        #    刮奏的起音是 5 个高频拨弦，摞在**循环点**上会让"接缝跳变"
        #    变成全曲最大的一下。挪走之后循环点不再背这个包袱。
        if b % 8 == 5:
            guz = [shift(tones[2], 12), tones[2], tones[1], tones[0], shift(tones[0], -12)]
            for j in range(5):
                s.hit('guzheng', i_pluck(nf(guz[j]), 0.80, bright=0.55, bend=0.015),
                      b * 16 + j, 0.13)

        # ---- 铺底：截止压到 420Hz（最暗的一档）----
        s.hit('pad', i_pad(tuple(nf(x) for x in tones), beat, cutoff=420.0, atk=0.45),
              b * 16, 0.30)

    # ★ 主奏必须放在上面"每小节"循环的**外面**。
    #   放里面的话同一句会在相邻 4 个小节里各铺一层，主奏被叠成 4 倍响
    #   （上游实测 lead 声部 max 冲到 1.36 = 0.34×4）。这个 bug 编译过、
    #   跑得通、波形也正常，只有量声部 RMS 才看得出来。
    for pb in range(0, s.bars, 4):
        s.melody('lead', lead, pb,
                 lambda f, d: i_guzheng(f, d, bright=0.52, bend=0.010, body=0.26),
                 0.44, extra_steps=0.98)
    return s


def track_B():
    """B · 流水 —— 70BPM / G宫五声 / 古筝 + 淡琶音（轴左中：安静但有流动）"""
    s = Song('B-流水', 70, 8, mix=MIX_B, scale='G宫五声')
    ch = {
        'G':  (['G2', 'B2', 'D3'], 'G2'),
        'D':  (['D3', 'F#3', 'A3'], 'D2'),
        'Em': (['E3', 'G3', 'B3'], 'E2'),
        'C':  (['C3', 'E3', 'G3'], 'C2'),
    }
    order = ['G', 'D', 'Em', 'C']      # 1-5-6-4

    # 旋律：级进上下行 + 句尾落回主音。比 A 多几个"经过音"，听起来更像水在走。
    lead = [
        (0,  'D5', 4),  (4,  'E5', 2),  (6,  'D5', 2),  (8,  'B4', 8),
        (16, 'A4', 4),  (20, 'G4', 4),
        (24, 'A4', 4),  (28, 'B4', 4),  (32, 'D5', 8),  (40, 'E5', 4), (44, 'D5', 4),
        (48, 'B4', 6),  (54, 'A4', 2),  (56, 'G4', 8),
    ]

    for b in range(s.bars):
        bar = b % 4
        tones, root = ch[order[bar]]
        beat = 1.0 * 4 * 60.0 / s.bpm

        # ---- 低音：一小节三下（根-根-五），比 A 密一档 ----
        for st, semi in [(0, 0), (6, 0), (11, 7)]:
            s.hit('guzheng', i_pluck(nf(shift(root, semi)), 0.95, bright=0.32),
                  b * 16 + st, 0.24)
        s.hit('bass', i_bass(nf(root), 1.2, c0=560.0, c1=160.0, drive=0.90),
              b * 16, 0.44)

        # ---- 琶音：**八分**（每 2 格一个），很轻（-21dB 再 -2.5dB）----
        # "流水"的流动感全在这条上；它用的是**暗**的 i_pluck（bright=0.34），
        # 亮了就变成"竖琴"，而且会把零交叉率抬上去 —— 上一版的教训。
        arp = [tones[0], tones[1], tones[2], shift(tones[1], 12)]
        for j in range(8):
            s.hit('arp', i_pluck(nf(arp[j % 4]), 0.55, bright=0.34), b * 16 + j * 2, 0.15)

        # ---- 刮奏：每 2 小节一次，落在**奇数**小节（理由同 A 段）----
        if b % 2 == 1:
            guz = [shift(tones[2], 12), tones[2], tones[1], tones[0], shift(tones[0], -12)]
            for j in range(5):
                s.hit('guzheng', i_pluck(nf(guz[j]), 0.70, bright=0.56, bend=0.015),
                      b * 16 + j, 0.14)

        # ---- 木鱼：**只在句末点两下**（第 4 小节的第 4 拍）----
        # 它是"句读"，不是节拍器。整段 8 小节里只响 2 次。
        if bar == 3:
            s.hit('wood', i_wood(0.18, 760.0, 0.030), b * 16 + 14, 0.16)
            s.hit('wood', i_wood(0.18, 760.0, 0.030), b * 16 + 15, 0.12)

        s.hit('pad', i_pad(tuple(nf(x) for x in tones), beat, cutoff=520.0, atk=0.38),
              b * 16, 0.28)

    for pb in range(0, s.bars, 4):
        s.melody('lead', lead, pb,
                 lambda f, d: i_guzheng(f, d, bright=0.55, bend=0.011, body=0.28),
                 0.46, extra_steps=0.98)
    return s


def track_C():
    """C · 月夜 —— 76BPM / A宫五声 / 古筝 + 箫（轴右中：最"抒情"的一档）"""
    s = Song('C-月夜', 76, 12, mix=MIX_C, scale='A宫五声')
    ch = {
        'A':   (['A2', 'C#3', 'E3'], 'A2'),
        'E':   (['E3', 'G#3', 'B3'], 'E2'),
        'F#m': (['F#3', 'A3', 'C#4'], 'F#2'),
        'D':   (['D3', 'F#3', 'A3'], 'D2'),
    }
    order = ['A', 'E', 'F#m', 'D']     # 1-5-6-4

    # 旋律：这一段的"抒情"靠**音区**——乐句在中高音区起，句尾落回中音区，
    # 不做大跳。五声里 A 宫的 C#（角）是最"软"的一个音，放在句腹。
    lead = [
        (0,  'E5', 6),  (6,  'F#5', 2), (8,  'A5', 8),  (16, 'F#5', 4), (20, 'E5', 4),
        (24, 'C#5', 4), (28, 'B4', 4),  (32, 'A4', 8),  (40, 'B4', 4),  (44, 'C#5', 4),
        (48, 'E5', 8),  (56, 'A4', 8),
    ]

    for b in range(s.bars):
        bar = b % 4
        tones, root = ch[order[bar]]
        beat = 1.0 * 4 * 60.0 / s.bpm

        for st, semi in [(0, 0), (8, 7)]:
            s.hit('guzheng', i_pluck(nf(shift(root, semi)), 1.00, bright=0.33),
                  b * 16 + st, 0.25)
        # 同上：0.46 → 1.30（配平原需 +12.0dB，撞上限）
        s.hit('bass', i_bass(nf(root), 1.15, c0=600.0, c1=170.0, drive=0.95),
              b * 16, 1.30)

        # ---- 琶音：八分，比 B 密一档（十六分里的**正拍**）----
        arp = [tones[0], tones[1], tones[2], shift(tones[1], 12)]
        for j in range(8):
            s.hit('arp', i_pluck(nf(arp[j % 4]), 0.50, bright=0.36), b * 16 + j * 2, 0.16)

        if b % 2 == 1:
            guz = [shift(tones[2], 12), tones[2], tones[1], tones[0], shift(tones[0], -12)]
            for j in range(5):
                s.hit('guzheng', i_pluck(nf(guz[j]), 0.66, bright=0.56, bend=0.015),
                      b * 16 + j, 0.14)

        s.hit('pad', i_pad(tuple(nf(x) for x in tones), beat, cutoff=600.0, atk=0.34),
              b * 16, 0.26)

    for pb in range(0, s.bars, 4):
        s.melody('lead', lead, pb,
                 lambda f, d: i_guzheng(f, d, bright=0.58, bend=0.012, body=0.30),
                 0.47, extra_steps=0.98)
        # ---- 箫：**句尾的两个长音** ----
        # 单开一条 'flute' 声部而不是塞进 'lead' —— 塞进去的话它的峰值会
        # 把主旋律的活跃段 RMS 抬高，配平一算就把整条旋律压下去（此消彼长）。
        # 箫只吹第 3 小节的最后两拍：筝弹完一句，箫在尾巴上"叹"一声，
        # 这就是"抒情"两字在这段里的落点。
        s.hit('flute', i_flute(nf('C#5'), 2.05, vib=4.6, vib_depth=0.007),
              pb * 16 + 44, 0.30)
        s.hit('flute', i_flute(nf('A4'), 2.60, vib=4.6, vib_depth=0.007),
              pb * 16 + 48, 0.34)
    return s


def track_D():
    """D · 行云 —— 82BPM / D宫五声 / 古筝 + 十六分琶音（基准档：最流动）"""
    s = Song('D-行云', 82, 12, mix=MIX_D, scale='D宫五声')
    ch = {
        'D':  (['D3', 'F#3', 'A3'], 'D2'),
        'A':  (['A2', 'C#3', 'E3'], 'A2'),
        'Bm': (['B2', 'D3', 'F#3'], 'B2'),
        'G':  (['G2', 'B2', 'D3'], 'G2'),
    }
    order = ['D', 'A', 'Bm', 'G']

    lead = [
        (0,  'F#5', 4), (4,  'E5', 2),  (6,  'D5', 2),  (8,  'B4', 4), (12, 'D5', 4),
        (16, 'E5', 4),  (20, 'F#5', 4), (24, 'A5', 8),  (32, 'F#5', 4), (36, 'E5', 4),
        (40, 'D5', 6),  (46, 'B4', 2),  (48, 'A4', 8),  (56, 'D5', 8),
    ]

    for b in range(s.bars):
        bar = b % 4
        tones, root = ch[order[bar]]
        beat = 1.0 * 4 * 60.0 / s.bpm

        # ---- 手鼓：**1、3 拍的"点"**，-25dB —— 是"行云"的步子，不是战鼓 ----
        # 用 i_tom 而不是 i_dagu：战鼓（96→32Hz、尾 0.23s）一进来整段就
        # 变成"将军令"了，那正是这一版要拿掉的东西。
        s.drumline('tom', 'x.......x.......', b, lambda: i_tom(0.42, 128.0, 0.16), 0.20)

        for st, semi in [(0, 0), (4, 0), (8, 7), (12, 0)]:
            s.hit('guzheng', i_pluck(nf(shift(root, semi)), 0.80, bright=0.34),
                  b * 16 + st, 0.24)
        s.hit('bass', i_bass(nf(root), 1.05, c0=640.0, c1=180.0, drive=1.00),
              b * 16, 0.48)

        # ---- 刮奏：每 4 小节的**后 3 小节**（第 0 小节留白，理由同 A 段）----
        if b % 4 != 0:
            guz = [shift(tones[2], 12), tones[2], tones[1], tones[0], shift(tones[0], -12)]
            for j in range(5):
                s.hit('guzheng', i_pluck(nf(guz[j]), 0.60, bright=0.56, bend=0.015),
                      b * 16 + j, 0.14)

        # ---- 十六分琶音：**这一段"流动"的全部来源** ----
        # 全是暗的 i_pluck（bright=0.30）、单音只有 0.11s，所以它提供的是
        # "沙沙的底噪"而不是"音符" —— 亮了就会跟主奏抢。
        arp = [tones[0], tones[1], tones[2], shift(tones[1], 12)]
        for j in range(16):
            s.hit('arp', i_pluck(nf(arp[j % 4]), 0.30, bright=0.30), b * 16 + j, 0.13)

        s.hit('pad', i_pad(tuple(nf(x) for x in tones), beat, cutoff=660.0, atk=0.30),
              b * 16, 0.24)

    for pb in range(0, s.bars, 4):
        s.melody('lead', lead, pb,
                 lambda f, d: i_guzheng(f, d, bright=0.60, bend=0.012, body=0.30),
                 0.48, extra_steps=0.98)
    return s


TRACKS = [track_A, track_B, track_C, track_D]

# ------------------------------------------------------------
#  「基准」声部目标表（**活跃段** RMS，dBFS）
# ------------------------------------------------------------
#  这张表就是"混音师的手"：把它当成"谁该压着谁"的关系表来读 ——
#    · lead 是古筝主奏，在最前；但它不是独奏，而是一段要循环半小时的
#      背景音乐，所以不吃满（-13dB，留 8dB 余量给音效）；
#    · bass 是地基，但**比主奏低 3dB** —— 抒情曲的地基该托着人，不该顶着人
#      （上一版 dagu 压到 -14dB 只比主奏低 1dB，那就是"顶"）；
#    · guzheng / arp 是伴奏织体，退到主奏后面 6~8dB；
#    · flute 是句尾的"叹"，比主奏低 5dB，只在句末出现，不该抢句子；
#    · pad 是氛围，tom / wood 是"点"（这一版把它们压到 -25 / -27，
#      上一版木鱼在 -24 还嫌吵，因为那时候它是十六分密铺的）。
#  为什么需要它：i_bass 经过低通后单音峰值只剩 0.50、i_pluck 在低频又天然很轻
#  —— 这类"音色天然偏轻"的声部靠一个个手调增益是猜，有目标值才能量出来再补回去。
#
#  ⚠️ 这张表是 **D（行云，最流动那一档）的基准**。其它段靠 MIX_x 的 dB 偏移
#     在它上面做加减。拍板之后想改整体平衡，改这张表；
#     想改"某一段有多密"，改那一段的 MIX_x。
# ------------------------------------------------------------
TRIM_TARGET = {
    'lead':    -13.0,   # 古筝主奏（4 段都是它）
    'bass':    -16.0,   # 低音（i_bass，抒情参数：drive 只有 0.85~1.0）
    'flute':   -18.0,   # 箫（C 段句尾的两个长音）
    'guzheng': -19.0,   # 古筝织体：低音拨弦 + 刮奏
    'arp':     -21.0,   # 琶音（B 八分 / D 十六分）
    'pad':     -22.0,   # 铺底
    'tom':     -25.0,   # 手鼓（只有 D 段有）
    'wood':    -27.0,   # 木鱼（只有 B 段句末有，整段 2 下）
}
TRIM_LIMIT = 12.0     # 单次配平最多 ±12dB，防止某声部被拉到离谱


def target_of(song, key):
    """某段某声部的最终目标 = 基准表 + 该段的档位偏移。"""
    base = TRIM_TARGET.get(key)
    if base is None:
        return None
    return base + song.mix.get(key, 0.0)


def auto_balance(song, verbose=False):
    """
    按 target_of() 逐声部补增益。
    上限 ±12dB —— 真需要补更多的，说明音色本身写坏了，该去改音色而不是硬拉。
    """
    log = []
    for k, buf in song.stems().items():
        tgt = target_of(song, k)
        if tgt is None:
            continue
        a = active_rms(buf)
        if a < 1e-9:
            continue
        db = tgt - 20.0 * math.log10(a)
        db = max(-TRIM_LIMIT, min(TRIM_LIMIT, db))
        if abs(db) < 0.05:
            continue
        g = 10.0 ** (db / 20.0)
        for i in range(len(buf)):
            buf[i] *= g
        log.append((k, db, db >= TRIM_LIMIT - 1e-6 or db <= -TRIM_LIMIT + 1e-6))
    if verbose:
        for k, db, hit in log:
            flag = '  ⚠️ 撞上限' if hit else ''
            print(f'      {k:<9}{db:+6.1f}dB{flag}')
    return log


#  每段候选的"说明书"（试听页直接用）
#  ⚠️ 这四段不是"四种风格选一个"，而是**一条轴上的四个落点**：
#     轴上只有一个变量 —— **有多密 / 有多流动**（速度、织体、打击乐一起走）。
#     用户挑的是位置，不是"哪首好听"。
META = {
    'A': dict(
        tag='古筝独奏 · 最静（轴最左）',
        lead='古筝', key='D 宫五声',
        desc='D 宫五声、64BPM（4 段里最慢）。古筝弹一条长音旋律，'
             '下面只有一层很暗的铺底和每小节两下的低音拨弦；'
             '**一个鼓点都没有**，刮奏每 4 小节才一笔。',
        fit='想让 BGM 彻底退成"背景纸"、把耳朵留给拆字的思路 —— 选它。'
            '长时间挂机也不累。',
        risk='最安静也意味着最"没有存在感"：8 小节里只有 2 句，'
             '玩久了可能觉得它一直停在同一个地方。',
    ),
    'B': dict(
        tag='古筝 + 淡琶音 · 安静但有流动（轴左中）',
        lead='古筝', key='G 宫五声',
        desc='G 宫五声、70BPM。在 A 的基础上加了一层**八分音符的暗琶音**'
             '（"流水"的流动感全靠它），木鱼只在句末点两下当"句读"。'
             '刮奏每 2 小节一笔。',
        fit='想要"安静但不死板" —— 舒缓、不着急，耳朵里又有东西在走。**最均衡的一段。**',
        risk='比 A 密一档，如果你要的是"几乎没有音乐"，它还是偏多。',
    ),
    'C': dict(
        tag='古筝 + 箫 · 最抒情（轴右中）',
        lead='古筝（箫吹句尾）', key='A 宫五声',
        desc='A 宫五声、76BPM。古筝主奏，每句的第 3 小节末尾**箫吹两个长音**'
             '（筝弹完一句、箫在尾巴上"叹"一声 —— 这就是"抒情"两字的落点）。'
             '琶音八分，比 B 密一档。',
        fit='明确想要"抒情"、想让音乐有一点歌唱性 —— 选它。',
        risk='箫进来之后织体比 B 更满；76BPM 比 B 快一点，'
             '如果嫌"有点赶"就往左退到 B。',
    ),
    'D': dict(
        tag='古筝 + 十六分琶音 · 最流动（基准档）',
        lead='古筝', key='D 宫五声',
        desc='D 宫五声、82BPM（4 段里最快，但仍是行板，不上 100）。'
             '十六分琶音铺满（用的是很暗的拨弦，只是"沙沙的底噪"），'
             '手鼓在 1、3 拍点两下（**不是战鼓**，压到 -25dB）。配器档位的**基准**。',
        fit='想让 BGM 明显在"往前走"，给关卡一点推动力 —— 选它。',
        risk='4 段里最密的一档；84→82BPM 对"不着急"的诉求是最不友好的，'
             '循环久了可能又有点"催"。',
    ),
}

# ============================================================
#  六、渲染、导出与体检
# ============================================================

def polish(sig, peak=PEAK, drive=LIMIT):
    """
    总线处理：归一化 → 软削波 → 再归一化。
    软削波压掉瞬态波峰，波峰因数下降 → 同样的峰值下**听感更响更满**。
    """
    m = max((abs(v) for v in sig), default=0.0)
    if m < 1e-9:
        return sig
    sig = [v / m for v in sig]
    k = math.tanh(drive)
    sig = [math.tanh(v * drive) / k for v in sig]
    m2 = max((abs(v) for v in sig), default=1.0)
    return [v * peak / m2 for v in sig]


def write_wav(path, sig):
    """写 16bit 单声道 WAV（与 make-sfx.py 同一格式）"""
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(b''.join(
            struct.pack('<h', max(-32768, min(32767, int(v * 32767))))
            for v in sig
        ))


def analyze(sig, bar_samples):
    """
    体检指标。听不到声音的时候，这些数字就是眼睛：
      · 每秒音头数 —— "动感密度"，直接对应"有没有律动"
      · 零交叉率   —— 高频占比的廉价代理，对应"亮不亮/吵不吵"
      · 波峰因数   —— 越高越"动态"，越低越"压得死"
      · 接缝       —— 循环点的跳变 ÷ 曲内强拍跳变中位数（见下方长注释）
    """
    bar_samples = max(1, int(round(bar_samples)))
    n = len(sig)
    dur = n / SR
    peak = max((abs(v) for v in sig), default=0.0)
    rms = math.sqrt(sum(v * v for v in sig) / max(1, n))
    zc = 0
    prev = sig[0] if n else 0.0
    for v in sig:
        if (v >= 0) != (prev >= 0):
            zc += 1
        prev = v

    step = _n(0.010)
    onsets = 0
    prev_e = 0.0
    for i in range(0, n - step, step):
        seg = sig[i:i + step]
        e = math.sqrt(sum(v * v for v in seg) / step)
        if e > prev_e * 1.9 and e > 0.02:
            onsets += 1
        prev_e = 0.88 * prev_e + 0.12 * e

    # 50ms 一格的 RMS 包络，给试听页画波形
    envstep = _n(0.050)
    points = []
    for i in range(0, n, envstep):
        seg = sig[i:i + envstep]
        if not seg:
            break
        points.append(round(math.sqrt(sum(v * v for v in seg) / len(seg)), 4))

    # ---- 循环接缝 ----
    #  ⚠️ 别用「循环点跳变 / 峰值」这种比值 —— 它会把你带沟里：
    #     那个数在电子轨上高达 0.32，看着像"循环爆音"，
    #     实际测的是**循环点正好落在强拍上、底鼓+吊镲攻击的那一下跳变**。
    #     正确思路是拿它跟"曲内其它强拍的跳变"比：
    #     强拍的鼓攻击本来就该跳，只要循环点不比别的强拍更跳，就算接得上。
    #
    #  ⚠️⚠️ 但也**不能**只看「循环点跳变 ÷ 强拍跳变**中位数**」
    #     （2026-10-02 修，这条是移植上游时实测踩出来的）：
    #     那个分母会**塌成 0**。实测本作 A 段 15 个强拍跳变的中位数只有
    #     9.10e-4（−57.7dBc，相对峰值）——因为 i_dagu / i_pluck 都是
    #     "从 0 起音"的平滑音色，小节头上第一对样点几乎不跳；而 B / D 段
    #     因为 i_wood 起音带噪声瞬态（第一对样点就跳），中位数是 −15dBc。
    #     于是**同一套写法、同一首曲子，只因为配器换了，比值从 42 掉到 0.78**
    #     —— 那不是判据，是噪声。
    #
    #  ⇒ 判据改成两层，**两层都过才算接得上**：
    #     ① 绝对层：循环点跳变 ≤ 峰值的 −40dB（即 1% 峰值）。一个单样点的
    #        阶跃小于峰值的 1%，任何回放设备上都听不成"咔"。
    #     ② 相对层：循环点跳变 ≤ 曲内**最强**强拍跳变 × SEAM_TOL。
    #        · 用 max 而不是 median：强拍跳变本来就该跳，只要循环点不比
    #          曲内最猛的那一下更猛，它就是"正常的一拍"而不是"接缝"。
    #        · SEAM_TOL = 1.25 是为了盖住**此判据自身的分辨率**：它取的是
    #          "某个整数下标处的一对样点之差"，而 put() 用 round() 定位、
    #          每拍还有 ±1 样点的累积偏差。实测证据：本作 C 段第 0 小节与
    #          第 8 小节在代码里**完全一样**（同和弦、同配器、同锣），
    #          量出来却是 2.915e-2 与 2.840e-2 —— 判据自己的噪声就有 ±3%；
    #          A 段（0 与 +2 小节）差 11%。拿一个分辨率 ±10% 的尺子去卡
    #          "超 11% 就报警"，只会天天误报，最后让人不再看这一栏。
    dj = []
    b = 1
    while b * bar_samples < n:
        i = b * bar_samples
        dj.append(abs(sig[i] - sig[i - 1]))
        b += 1
    dj.sort()
    med = dj[len(dj) // 2] if dj else 0.0
    beat_max = dj[-1] if dj else 0.0
    seam_abs = abs(sig[0] - sig[-1])
    # 打印用的比值：分母抬到"峰值的 1%"（−40dBc），免得除出一个爆炸的数字
    den = max(med, peak * 0.01, 1e-9)
    seam = seam_abs / den
    seam_max = beat_max / den
    dbc = lambda x: round(20 * math.log10(max(x, 1e-12) / max(peak, 1e-12)), 1)
    seam_dbc, beat_dbc = dbc(seam_abs), dbc(beat_max)
    seam_ok = bool(seam_dbc <= -40.0 or seam_abs <= beat_max * SEAM_TOL)

    return dict(
        dur=round(dur, 3),
        peak=round(peak, 4),
        peak_db=round(20 * math.log10(max(peak, 1e-6)), 1),
        rms=round(rms, 4),
        rms_db=round(20 * math.log10(max(rms, 1e-6)), 1),
        crest=round(peak / max(rms, 1e-6), 2),
        seam=round(seam, 2),
        seam_max=round(seam_max, 2),
        seam_dbc=seam_dbc,
        beat_dbc=beat_dbc,
        seam_ok=seam_ok,
        onsets=onsets,
        onsets_per_s=round(onsets / max(dur, 1e-6), 2),
        zcr=round(zc / max(dur, 1e-6)),
        env=points,
    )


# ============================================================
#  八、入库（--install）：把拍板那一段装进游戏
# ============================================================
#  为什么要有这一步，而不是"手工把 m4a 拖进 assets/resources/audio"：
#   ① `.meta` 是资源的身份证。Cocos 靠 uuid 引用资源 —— 手工拖文件要么
#      没有 `.meta`（编辑器补一个随机 uuid，不可复现），要么覆盖时把 uuid
#      换了（工程里凭空多一个资源、旧的变野指针，表现为"音频莫名为空"）。
#      这里用 uuid5（名字哈希）派生固定值，跑多少次都一样。
#   ② `afconvert` 会把"编码那一刻"的时间戳写进容器 → 同一段音频重跑两次
#      md5 都不一样。搬完必须再调一次 zero_container_times()。
#   ③ "文件在" ≠ "能播"：参数写错的 afconvert 会**安静地**产出坏文件，
#      所以落盘后立刻 afinfo 复验。
#  这套家法与 install-voice-lib.py / make-voice.py --install 完全一致，
#  仓库里不能有第二条"资源是怎么进来的"产线。
# ============================================================

def _stable_uuid(name: str) -> str:
    """
    由资源名派生固定 uuid（与"固定随机种子"同理：保证可复现）。

    ⚠️ 命名空间前缀改成**本作**的 `chaizi-lianliankan://`。
       移植时如果照抄上游的 `game4-mahjong://`，本作 `bgm.m4a` 会算出
       和麻将项目 `bgm.m4a` **完全相同的 uuid** —— 两个工程各自独立，
       同 uuid 不会当场出事，但一旦有人把两边资源合到一处（合并分支、
       共用一个资源库），Cocos 会认为它们是同一个资源，直接串味。
       这类问题不会报错，只会"某天音频变成了别人的曲子"。
    """
    import uuid
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f'chaizi-lianliankan://audio/{name}'))


def _meta_json(name: str) -> str:
    """与工程既有 13 段音效的 .meta 逐字段一致。"""
    return json.dumps({
        'ver': '1.0.0',
        'importer': 'audio-clip',      # ★ 必须是 audio-clip，否则构建后不是 AudioClip
        'imported': True,
        'uuid': _stable_uuid(name),
        'files': ['.json', '.m4a'],
        'subMetas': {},
        'userData': {'downloadMode': 0},
    }, indent=2) + '\n'


def install_to_game() -> int:
    """把 CHOSEN 指的那段 BGM 装进 game-5-chaizi/assets/resources/audio/<INSTALL_AS>.m4a"""
    # ① 先拦住"还没拍板就装进去"
    if not CHOSEN:
        names = '、'.join(f.__name__[-1] for f in TRACKS)
        print('✗ CHOSEN 还是空串 —— 用户还没拍板，不装。')
        print(f'  可选：{names}')
        print('  拍板后把文件头的 CHOSEN 改成对应字母，再跑 --install。')
        return 1

    pick = next((f for f in TRACKS if f.__name__[-1] == CHOSEN.upper()), None)
    if pick is None:
        names = '、'.join(f.__name__[-1] for f in TRACKS)
        print(f'✗ CHOSEN={CHOSEN!r} 不对应任何轨道（可选 {names}）')
        return 1

    # ② 再拦住"路径写错却把错目录建出来"（见 GAME_ROOT 上方注释里那次踩坑）
    if not os.path.isdir(os.path.join(GAME_ROOT, 'assets')):
        print(f'✗ 找不到 Cocos 工程：{GAME_ROOT}')
        print('  请确认脚本位于 <仓库根>/tools/ 下、工程目录名为 game-5-chaizi。')
        return 2
    os.makedirs(GAME_AUDIO, exist_ok=True)

    song_name = pick().name                       # 例：'C-点将'
    src = os.path.join(OUT_DIR, f'{song_name}.m4a')
    if not os.path.exists(src):
        print(f'✗ 找不到已合成的产物：{src}')
        print('  先跑一次：python3 tools/make-bgm.py --page')
        return 1

    dst = os.path.join(GAME_AUDIO, f'{INSTALL_AS}.m4a')
    meta = dst + '.meta'
    existed = os.path.exists(dst)

    zero_times = _load_zero_times()
    shutil.copyfile(src, dst)
    zero_times(dst)                               # 清容器时间戳 → 可复现

    # 落盘后立刻复验
    info = subprocess.run(['afinfo', dst], capture_output=True)
    ok = info.returncode == 0 and b'audio' in info.stdout.lower()
    dur, fmt = 0.0, ''
    for line in info.stdout.decode(errors='ignore').splitlines():
        if 'estimated duration' in line:
            try:
                dur = float(line.split(':')[1].strip().split()[0])
            except Exception:
                pass
        if 'Data format' in line:
            fmt = line.split(':', 1)[1].strip()

    # .meta：新建才写；覆盖已有资源**绝不重写**（重写会换 uuid）
    if os.path.exists(meta):
        verb = '覆盖（保留原 .meta，uuid 不变）'
    else:
        with open(meta, 'w', encoding='utf-8') as f:
            f.write(_meta_json(f'{INSTALL_AS}.m4a'))
        verb = f'新建 .meta（uuid={_stable_uuid(f"{INSTALL_AS}.m4a")[:8]}…）'

    kb = os.path.getsize(dst) / 1024.0
    print('=' * 72)
    print(f'  BGM 入库：{song_name}  →  audio/{INSTALL_AS}.m4a')
    print('=' * 72)
    print(f'  源     {src}')
    print(f'  目标   {dst}{"" if existed else "（新资源）"}')
    print(f'  参数   {fmt}')
    print(f'  时长   {dur:.3f}s   体积 {kb:.1f}K')
    print(f'  meta   {verb}')
    print(f'  复验   {"✅ afinfo 通过" if ok else "⚠️  解码复验失败！"}')
    print()
    print('  下一步：bash tools/wechat-preview.sh   # 构建 + 出真机试玩码')
    print('=' * 72)
    return 0 if ok else 1


def main() -> int:
    argv = sys.argv[1:]

    # --install 是"另一件事"：不合成，只把拍板那段搬进游戏。
    # 放在最前面短路，免得跟着合成流程白跑一遍 4 段（每段 3~6 秒）。
    if '--install' in argv:
        return install_to_game()

    wav_only = '--wav-only' in argv
    want_page = '--page' in argv
    show_stems = '--stems' in argv
    no_trim = '--no-trim' in argv
    only = None
    if '--only' in argv:
        only = set(argv[argv.index('--only') + 1].upper().replace(',', ''))

    os.makedirs(WAV_DIR, exist_ok=True)
    os.makedirs(OUT_DIR, exist_ok=True)
    zero_times = _load_zero_times()

    picks = [fn for fn in TRACKS if not only or fn.__name__[-1] in only]
    if not picks:
        print('没有匹配的轨道')
        return 1

    print(f'{"候选":<14}{"时长":>8}{"峰值dB":>9}{"RMS dB":>9}{"波峰":>7}{"音头/秒":>9}{"m4a":>9}')
    print('-' * 68)

    report = []
    for fn in picks:
        song = fn()
        if not no_trim:
            # ⚠️ 撞 ±12dB 上限**必须喊出来**。
            #    这是配平里唯一会"静默失败"的情况：声部没被拉到目标、
            #    也没有任何报错，只有把数字打印出来对着看才看得见
            #    （上一版就有一条 bass 差 0.7dB 一直没解释，根源就是撞了限）。
            bal = auto_balance(song, verbose=False)
            for k, db, hit in bal:
                if hit:
                    print(f'  ⚠️ [{song.name.split("-")[0]}] 声部 {k} 配平撞 ±{TRIM_LIMIT:.0f}dB'
                          f' 上限（需要 {db:+.1f}dB）—— 音色本身写坏了，'
                          f'回去改音色/写法的增益，别在这里硬拉')
        raw = song.render()
        sig = polish(raw)
        body = song.name.split('-')[0]

        # ---- 自证：旋律有没有出调 ----
        # 五声是"古风"最硬的一道保险，也是最容易被一个字母敲错破坏的地方
        # （F# → F 只差一个字符，听感是"忽然拐到西洋去了"，30 秒循环里极难定位）。
        # 所以宁可让脚本喊出来，也不靠耳朵。
        bad = song.audit()
        if bad:
            print(f'  ⚠️ [{body}] 旋律出调 {len(bad)} 处（调式 {song.scale}）：')
            for st, note in bad[:8]:
                print(f'        第 {st // 16 + 1} 小节第 {st % 16} 格  音名 {note}')

        if show_stems:
            print(f'  [{body}] 活跃段 RMS（实测 / 目标 = 基准 + 本段档位偏移）：')
            for k, buf in song.stems().items():
                a = active_rms(buf)
                tgt = target_of(song, k)
                now = 20.0 * math.log10(max(a, 1e-9))
                off = song.mix.get(k, 0.0)
                t = f'{tgt:+.1f}' if tgt is not None else '  —'
                o = f'  (基准{TRIM_TARGET[k]:+.1f} {off:+.1f}dB)' if tgt is not None and off else ''
                print(f'      {k:<9}{now:7.1f}dB  目标 {t}{o}')

        wav_path = os.path.join(WAV_DIR, f'{song.name}.wav')
        write_wav(wav_path, sig)

        a = analyze(sig, 16.0 * song.step_s * SR)
        size_kb = 0.0
        if not wav_only:
            m4a_path = os.path.join(OUT_DIR, f'{song.name}.m4a')
            r = subprocess.run(
                ['afconvert', '-f', 'm4af', '-d', 'aac', '-b', '64000', wav_path, m4a_path],
                capture_output=True,
            )
            if r.returncode != 0:
                print(f'{song.name} 转码失败：{r.stderr.decode()[:160]}')
                return 1
            zero_times(m4a_path)      # 清容器时间戳，否则每次重跑 md5 全变
            size_kb = os.path.getsize(m4a_path) / 1024.0

        # 循环接缝：判据见 analyze() 里那段长注释（绝对层 −40dBc / 相对层 1.25×）
        seam_note = ''
        if not a['seam_ok']:
            seam_note = (f"   ⚠️ 接缝 {a['seam_dbc']:+.1f}dBc 比曲内最强强拍 "
                         f"{a['beat_dbc']:+.1f}dBc 还跳")
        print(f'{song.name:<14}{a["dur"]:7.2f}s{a["peak_db"]:9.1f}{a["rms_db"]:9.1f}'
              f'{a["crest"]:7.2f}{a["onsets_per_s"]:9.2f}{size_kb:8.1f}K{seam_note}')

        report.append(dict(
            id=body, name=song.name, bpm=song.bpm, bars=song.bars,
            size_kb=round(size_kb, 1), **a,
            **META.get(body, {}),
        ))

    with open(os.path.join(OUT_DIR, 'candidates.json'), 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    print('-' * 68)
    print(f'输出目录 {OUT_DIR}')

    if want_page and not wav_only:
        page = os.path.join(OUT_DIR, 'BGM候选-试听.html')
        build_page(report, page)
        print(f'试听页   {page}')
    return 0


# ============================================================
#  七、试听页（音频 base64 内嵌，不依赖任何外部路径）
# ============================================================
#  为什么不写 <audio src="./A-墨韵.m4a">：
#    预览面板对相对路径的支持不确定（file:// 下的媒体加载各浏览器策略不同），
#    内嵌成 data URI 是唯一"一定能播"的写法。代价是 HTML 大了 1.3 倍。
# ============================================================

def build_page(report, out_path):
    rows = []
    for r in report:
        m4a = os.path.join(OUT_DIR, r['name'] + '.m4a')
        b64 = base64.b64encode(open(m4a, 'rb').read()).decode('ascii')
        rows.append((r, b64))

    cards = []
    for i, (r, b64) in enumerate(rows, 1):
        # 包络按自身峰值归一化后再开 0.6 次方 —— 直接按绝对值画，4 段的柱子
        # 会几乎一样高（RMS 都落在 0.15 上下），看不出段落起伏。
        #
        # ⚠️ 先**重采样到固定 120 列**再画（2026-10-02 修）。原因：
        #   env 是每 50ms 一格，4 段分别是 738 / 711 / 662 / 582 格。
        #   直接 flex 排出来的话：① 每段柱子宽度不同，"看起来的高度"没有可比性；
        #   ② 738 格 × (1px + 1px gap) 远超面板宽度，`.wave` 没设 overflow，
        #      会横向溢出；就算加 overflow:hidden，亚像素宽度的柱子也会糊成一坨。
        #   每个桶取 **max** 而不是均值：鼓/刮奏的瞬态是一格宽，均值会把它抹平，
        #   而"有没有段落起伏"恰恰全靠那些瞬态在柱图上显示出来。
        env = r['env']
        NCOL = 120
        if len(env) > NCOL:
            cols = []
            for c in range(NCOL):
                a = c * len(env) // NCOL
                b_ = max(a + 1, (c + 1) * len(env) // NCOL)
                cols.append(max(env[a:b_]))
        else:
            cols = env
        mx = max(cols) or 1.0
        # 柱高用 **dB 刻度**（−40dB 到底，0dB 到顶），不是线性。
        # 线性刻度下 B / C / D 三段（鼓点密）每一格的 RMS 都差不多，
        # 柱子画出来是一堵齐平的墙 —— "第 8 小节进了唢呐"这类信息全被压没了。
        # 换成 dB 之后，"只有一半响"（−6dB）才占到 15% 的高度，段落起伏才看得见。
        def _h(v):
            if v <= 0:
                return 3
            t = 1.0 + 20.0 * math.log10(max(v / mx, 1e-4)) / 40.0   # −40dB → 0
            return max(3, int(max(0.0, min(1.0, t)) * 40))
        bars = ''.join(f'<i style="height:{_h(v)}px"></i>' for v in cols)
        cards.append(f'''
  <section class="card" id="c{r['id']}">
    <div class="hd">
      <span class="no">{i}</span>
      <div class="ttl">
        <h2>{r['name'].split('-', 1)[1]}</h2>
        <span class="tag">{r.get('tag', '')}</span>
      </div>
      <button class="pick" data-id="{r['id']}">就选它</button>
    </div>
    <div class="stats">
      <b>{r['bpm']}</b><span>BPM</span>
      <b>{r.get('key', '')}</b><span>调式</span>
      <b>{r.get('lead', '')}</b><span>主奏</span>
      <b>{r['dur']:.0f}s</b><span>循环长度</span>
      <b>{r['onsets_per_s']:.1f}</b><span>密集度</span>
      <b>{r['size_kb']:.0f}K</b><span>体积</span>
    </div>
    <div class="wave">{bars}</div>
    <audio controls loop preload="metadata" src="data:audio/mp4;base64,{b64}"></audio>
    <p class="desc">{r.get('desc', '')}</p>
    <p class="fit"><em>适合</em>{r.get('fit', '')}</p>
    <p class="risk"><em>代价</em>{r.get('risk', '')}</p>
    <p class="tech">工程指标（不用看，留痕用）：零交叉率 {r['zcr']} · 波峰因数 {r['crest']:.2f} ·
       循环接缝 {r['seam_dbc']:+.1f}dBc，曲内最强强拍 {r['beat_dbc']:+.1f}dBc ——
       {'✅ 接得上（不比曲内最强强拍更跳）' if r['seam_ok'] else '⚠️ 接缝比曲内最强强拍更跳'}</p>
  </section>''')

    html = f'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>《挪字成章》BGM 候选试听（古风 · 将军令轴）</title>
<style>
  :root {{
    --bg:#f6f5f2; --card:#fff; --ink:#1c1b19; --sub:#6b6862;
    --line:#e4e1da; --accent:#b23a2e; --wave:#c9c4ba;
  }}
  * {{ box-sizing:border-box; }}
  body {{ margin:0; background:var(--bg); color:var(--ink);
    font:15px/1.7 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif; }}
  header {{ padding:34px 24px 18px; max-width:920px; margin:0 auto; }}
  h1 {{ margin:0 0 6px; font-size:24px; letter-spacing:.5px; }}
  .lead {{ color:var(--sub); margin:0; }}
  .lead b {{ color:var(--ink); }}
  main {{ max-width:920px; margin:0 auto; padding:0 24px 60px; }}
  .card {{ background:var(--card); border:1px solid var(--line); border-radius:14px;
    padding:18px 20px 16px; margin:16px 0; }}
  .hd {{ display:flex; align-items:center; gap:12px; }}
  .no {{ width:30px; height:30px; flex:0 0 30px; border-radius:50%;
    background:var(--ink); color:#fff; display:grid; place-items:center;
    font-size:15px; font-weight:600; }}
  .ttl {{ flex:1; display:flex; align-items:baseline; gap:10px; flex-wrap:wrap; }}
  .ttl h2 {{ margin:0; font-size:19px; }}
  .tag {{ font-size:12px; color:var(--accent); border:1px solid currentColor;
    border-radius:999px; padding:1px 9px; }}
  .pick {{ border:1px solid var(--line); background:#fff; color:var(--ink);
    border-radius:999px; padding:6px 14px; font-size:13px; cursor:pointer; }}
  .pick:hover {{ border-color:var(--accent); color:var(--accent); }}
  .pick.on {{ background:var(--accent); border-color:var(--accent); color:#fff; }}
  .stats {{ display:flex; flex-wrap:wrap; align-items:baseline; gap:4px 16px;
    margin:12px 0 10px; font-size:13px; }}
  .stats b {{ font-size:15px; }}
  .stats span {{ color:var(--sub); margin-left:-12px; }}
  .wave {{ display:flex; align-items:flex-end; gap:1px; height:44px;
    margin:2px 0 12px; padding:0 1px; overflow:hidden; }}
  .wave i {{ flex:1 1 0; background:var(--wave); border-radius:1px; min-width:0; }}
  audio {{ width:100%; height:34px; }}
  .desc {{ margin:12px 0 6px; }}
  .tech {{ margin:8px 0 2px; font-size:12px; color:#9a968e;
    border-top:1px dashed var(--line); padding-top:8px; }}
  .fit, .risk {{ margin:4px 0; font-size:13.5px; color:var(--sub); }}
  .fit em, .risk em {{ font-style:normal; display:inline-block; min-width:34px;
    color:var(--ink); font-weight:600; margin-right:6px; }}
  footer {{ max-width:920px; margin:0 auto; padding:0 24px 60px;
    color:var(--sub); font-size:13px; }}
  #bar {{ position:sticky; bottom:0; background:rgba(246,245,242,.94);
    backdrop-filter:blur(6px); border-top:1px solid var(--line); }}
  #bar div {{ max-width:920px; margin:0 auto; padding:10px 24px; font-size:14px; }}
  #bar b {{ color:var(--accent); }}
</style>
</head>
<body>
<header>
  <h1>《挪字成章》— BGM 候选试听</h1>
  <p class="lead">按你拍板的<b>「古风、有点将军令的感觉、要跟我的字搭得上」</b>做了 4 段，
     全是<b>程序化合成的纯音乐</b>（零素材依赖、无版权风险），可<b>无缝循环</b>。</p>
  <p class="lead"><b>这 4 段不是"四种风格"，而是同一条轴上的 4 个落点</b> ——
     轴上只有一个变量：<b>「将军令」的分量</b>。
     从左到右是「书架」到「沙场」：鼓从"点一下"变成"四四不停地擂"，
     主奏从箫换成唢呐，速度从 104 涨到 132 BPM。
     <b>你挑的是这条轴上的位置</b>，不是"哪首好听"。
     点开听，告诉我编号即可（也可以说"比 B 再少一点鼓"这种相对的话）。</p>
</header>
<main>{"".join(cards)}</main>
<footer>
  <p>合成脚本 <code>chaizi-lianliankan/tools/make-bgm.py</code>；
     所有参数（速度 / 调式 / 配器 / 各声部电平 / 循环长度）都在这一个文件里，
     拍板后想微调改数字重跑即可 —— 不需要重新找素材。</p>
  <p>注意：这 4 段是<b>拍板用的合成 demo</b>，不是最终混音成品 —— 选定后我会再走一遍
     总线处理，并把 BGM 音量压到<b>音效的 1/3（约 −10dB）</b>，
     保证"珠子滑过格子"和"两个字撞成一个字"那两下听得清。</p>
</footer>
<div id="bar"><div>当前选择：<b id="sel">还没选</b></div></div>
<script>
  document.querySelectorAll('.pick').forEach(function (b) {{
    b.addEventListener('click', function () {{
      document.querySelectorAll('.pick').forEach(function (o) {{ o.classList.remove('on'); }});
      b.classList.add('on');
      document.getElementById('sel').textContent = b.closest('.card').querySelector('h2').textContent
        + '（编号 ' + b.dataset.id + '）';
    }});
  }});
</script>
</body>
</html>
'''
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(html)


if __name__ == '__main__':
    sys.exit(main())
