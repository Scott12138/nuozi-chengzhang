#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
============================================================
 make-sfx.py · 程序化合成游戏音效（零素材依赖）
============================================================
 项目：《挪字成章》（chaizi-lianliankan / game-5-chaizi）
 素材血统：从隔壁 `game-4-mahjong/tools/make-sfx.py` 移植，合成原语
 （bell / tone / sweep / noise / mix / normalize）与"逐音效播种""容器时间清零"
 两条可复现家法**原样沿用**；配方（sfx_* 与 SFX 字典）按本作题材重写。

 为什么要"合成"而不是"下载素材"：
   ① 版权干净 —— 本作是要上架的微信小游戏（个人主体），音效素材的来源
      必须可追溯；自产则"来源 = 本仓库这 1 个脚本"；
   ② 体积可控 —— 首包红线 4MB，下载来的 mp3 动辄几百 KB，
      自己合成的短音效压成 m4a 后每段只有 3~8KB；
   ③ 参数可调 —— "珠子滑过格子"的音高、"合成撞击"的和弦全是脚下这几行数字，
      想换手感改参数重跑即可，不用去找第 12 个素材网站。

 合成链：Python 直出 16bit/44.1kHz 单声道 WAV
         → 系统 afconvert 转 AAC（m4a，64kbps 单声道）
         → 清容器时间戳（`zero_container_times`，保证重跑逐字节一致）
         → 落到 `OUT_DIR`（暂存，试听拍板用的就是这一份）
         →（`--install`）搬进 `assets/resources/audio/` 并补 `.meta`

 ============================================================================
  ⚠️⚠️ `--install` 为什么不是"手工拖文件" ⚠️⚠️
 ============================================================================
 `.meta` 是 Cocos 资源的身份证（靠 uuid 引用）。手工拖进去要么没有 `.meta`
 （编辑器补一个随机 uuid，不可复现），要么覆盖时换了 uuid（工程里凭空多一个
 资源、旧的变野指针）——表现是"音频莫名为空"，且**不报错**。
 所以 `.meta` 由本脚本用 `stable_uuid()`（uuid5 名字哈希）派生固定值写出来。

 ============================================================================
  音效分工（材质体系：**纸 + 墨 + 木 + 字**，刻意不要金属长尾）
 ============================================================================
   拖动  `bead`  = ★本作新增：「珠子滑过一格」的极短清脆一响（每跨一格一声）
   拿起  `pick`  = 「呲」一声离手；落位 `land` = 「咔」
   撞击  `clash` = **本作核心**：冲击瞬态 + 大三和弦（"两片字合成了一个字"）
   消散  `clear` = 上行扫频「唰」——与 clash 组成「咚—唰」二连
   回弹  `reject`= 低沉下滑「咚」（严格回弹的听觉句号）
   通关  `win`   = 大调上行琶音 + 尾音（整局的句号）
   失败  `fail`  = 下行两音（G→C，明确的"结束"语义）
   复活  `revive`= 明亮上行（与 fail 严格对偶，雨过天晴）
   工具  `hint` / `shuffle` / `reward`

 用法：
     python3 tools/make-sfx.py                 # 合成全部音效到 OUT_DIR
     python3 tools/make-sfx.py --wav-only      # 只出 wav（调试波形用）
     python3 tools/make-sfx.py --install       # 再搬进 assets/resources/audio/
     python3 tools/make-sfx.py --page          # 顺带生成音效试听页

 ⚠️ 随机数用固定种子：噪声是"合成素材"的一部分，
    换一台机器重跑必须得到逐字节相同的结果（否则每次重打包
    assets 的 md5 都在变，没法判断"这次提交到底改了什么"）。

 ⚠️ 光有固定种子**不够**，还有两层坑：
    ① **种子必须按音效名分开播**（见 `seed_for()`）。只播一次全局种子，
       随机数流就按 SFX 字典顺序被各音效依次消耗 ——
       **改一个音效会扰动它后面所有音效**的字节（上游项目实测：
       新插一段 `swish`，`shuffle` 与 `addslot` 的 md5 当场就变了，
       而它们自己的代码一个字没动）。现在每个音效独立播种，改 A 不影响 B。
    ② `afconvert` 会往 m4a 容器里写"编码那一刻"的时间戳，所以写完必须调
       `zero_container_times()`。少了这条，"重跑两次结果一致"就是假话。
============================================================
"""

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
SR = 44100              # 采样率。高频音效（"珠"、"叮"）需要足够带宽，22050 会出现金属感的折叠失真
SEED = 20261002         # 固定种子，见文件头说明
PEAK = 0.72             # 归一化峰值（留 3dB 余量，避免 AAC 编码削波）
HERE = os.path.dirname(os.path.abspath(__file__))
# ★ 暂存目录：**试听/拍板消费的就是这一份**。--install 才搬进游戏，
#   搬的时候不重新渲染 —— 否则"拍板的"和"上线的"会变成两个东西。
OUT_DIR = os.path.abspath(os.path.join(HERE, '..', 'docs', 'verify', 'S6', 'sfx'))
TMP_WAV_DIR = '/tmp/chaizi-sfx-wav'

# ★ 落库目标：**Cocos 工程在 game-5-chaizi/ 里面**，不在仓库根。
#   ⚠️ 2026-10-02 踩过：一开始写成 HERE/../assets/resources/audio，
#   而仓库根那个 assets/ 里只有 wordlib.json —— `os.makedirs(exist_ok=True)`
#   会**开心地把错目录建出来**、文件也照写，全程不报错。
#   表现是"入库成功"，但 Cocos 工程里一个音频都没有。
#   现在改成显式两级，并在 install_to_game() 里断言工程根存在。
GAME_ROOT = os.path.abspath(os.path.join(HERE, '..', 'game-5-chaizi'))
GAME_AUDIO = os.path.join(GAME_ROOT, 'assets', 'resources', 'audio')

# 模块级播种：只为"直接在 REPL / 单测里调用某个 sfx_xxx()"这种用法兜底。
# ★ 真正跑批量生成时走的是 main() 里的**逐音效播种**（见下），这个种子会被覆盖。
random.seed(SEED)


def seed_for(name: str) -> None:
    """
    ★ **按音效名**播种 —— 生成某个音效之前必须调用它。

    【为什么不能只用一个全局种子（2026-10-01 修正）】
    合成噪声用的是 `random.uniform`，它是一条**全局的随机数流**。
    只播一次全局种子的话，"流"是按 `SFX` 字典顺序被各个音效依次消耗的 ——
    于是**改一个音效会扰动它后面所有音效**：
      S18 把 `swish` 插到 `clear` 之后，`shuffle.m4a` 和 `addslot.m4a`
      的 md5 当场就变了（它们自己的代码一个字没动）。
    这在"每次修改都能回溯"的要求下是灾难：一次无关的 diff 里混进两个
    听不出区别、也解释不清的二进制变化，回溯的人会以为改坏了什么。

    【为什么用名字而不是数字下标】下标会随字典顺序漂移，
    而名字是稳定的 —— 加/删/移动任何一项，都不会改变其余音效的字节。

    【为什么是确定的】`random.seed(str)` 内部走 sha512，跨机器、跨进程、
    跨 Python 版本都是同一个结果（不像 `hash()` 受 PYTHONHASHSEED 影响）。
    """
    random.seed(f'{SEED}:{name}')


# ============================================================
#  一、基元（primitive）：所有音效都由这几种波形叠加而成
# ============================================================

def _attack_gain(t: float, attack_ms: float) -> float:
    """
    起音斜坡。**必须要有**：直接从 0 跳到峰值会产生一个瞬态 "啪"，
    在 AAC 里还会被编码器涂抹成一段刺耳的前回声。
    3ms 已经短到人耳听不出"渐入"，但足以让波形连续。
    """
    if attack_ms <= 0:
        return 1.0
    a = attack_ms / 1000.0
    return min(1.0, t / a) if t < a else 1.0


def bell(n: int, freq: float, decay: float, amp: float = 1.0,
         partials=((1.0, 1.0), (2.01, 0.34), (3.02, 0.16), (4.95, 0.07)),
         attack_ms: float = 3.0) -> list:
    """
    钟 / 铃类音色（"碰"、"消除"、"奖励"都用它打底）。

    【为什么泛音用 2.01 / 3.02 / 4.95 而不是整数倍】
    整数倍泛音叠加出来是"风琴"（谐波完全对齐，听起来很干净但很呆）。
    真实金属体（钟、铃、麻将牌本身）的泛音是**非整数倍**的，
    偏移一点点（2.01 而不是 2.00）就会产生缓慢的拍频，
    那种"轻轻晃动"的质感是"高级感"的来源 —— 这也是所有打击乐合成器的标准做法。
    """
    out = []
    for i in range(n):
        t = i / SR
        e = math.exp(-t / decay) * _attack_gain(t, attack_ms)
        v = 0.0
        for mult, pa in partials:
            v += pa * math.sin(2 * math.pi * freq * mult * t)
        out.append(amp * e * v)
    return out


def tone(n: int, freq: float, decay: float, amp: float = 1.0,
         attack_ms: float = 2.0, square: float = 0.0) -> list:
    """
    纯正弦 / 轻微方波化的单音（木质感打底）。
    square > 0 时把正弦"削平"一点，得到更硬的木质敲击感（用于 tap / pick）。
    注意这里的削平不是符号函数（那会产生无限谐波、编码后发毛），
    而是 tanh 软削波 —— 谐波随强度自然衰减，听起来是"硬"而不是"炸"。
    """
    out = []
    for i in range(n):
        t = i / SR
        e = math.exp(-t / decay) * _attack_gain(t, attack_ms)
        v = math.sin(2 * math.pi * freq * t)
        if square > 0:
            v = math.tanh(v * (1 + square * 6.0)) / math.tanh(1 + square * 6.0)
        out.append(amp * e * v)
    return out


def sweep(n: int, f0: float, f1: float, decay: float, amp: float = 1.0,
          attack_ms: float = 3.0, log: bool = True) -> list:
    """
    扫频（"消除"的上行、'失败'的下行）。

    【为什么默认用对数扫频】
    人耳对音高的感知是对数的：100→200Hz 与 1000→2000Hz 是"同样的距离"。
    线性扫频在低频段听着"半天不动"、高频段"唰一下就过去"，
    对数扫频才是听觉上"匀速上升"。
    """
    out = []
    phase = 0.0
    for i in range(n):
        t = i / SR
        k = i / max(1, n - 1)
        f = f0 * ((f1 / f0) ** k) if log else f0 + (f1 - f0) * k
        phase += 2 * math.pi * f / SR
        e = math.exp(-t / decay) * _attack_gain(t, attack_ms)
        out.append(amp * e * math.sin(phase))
    return out


def noise(n: int, decay: float, amp: float = 1.0,
          lp: float = 0.30, hp: float = 0.0,
          attack_ms: float = 1.0, humps: int = 0) -> list:
    """
    噪声（"洗牌"的摩擦、"碰"的冲击瞬态）。
    lp / hp 是一阶低通 / 高通系数（0~1），用来把白噪声塑形成"纸张"或"金属"。
    humps > 0 时给包络叠加起伏（洗牌是"哗—啦—啦"三下，不是一声闷响）。
    """
    out = []
    y = 0.0
    yh = 0.0
    prev = 0.0
    for i in range(n):
        t = i / SR
        x = random.uniform(-1.0, 1.0)
        y += lp * (x - y)                       # 低通
        if hp > 0:
            yh = hp * (yh + y - prev)           # 高通（y 与它的前一采样之差）
            prev = y
            v = yh
        else:
            v = y
        e = math.exp(-t / decay)
        if humps > 0:
            k = i / max(1, n - 1)
            e *= 0.55 + 0.45 * abs(math.sin(math.pi * humps * k))
        out.append(amp * e * v * _attack_gain(t, attack_ms))
    return out


# ============================================================
#  二、混音工具
# ============================================================

def buf(ms: float) -> list:
    """按毫秒申请一段空缓冲"""
    return [0.0] * max(1, int(SR * ms / 1000.0))


def mix(dst: list, src: list, at_ms: float = 0.0, gain: float = 1.0) -> list:
    """把 src 叠加到 dst 的 at_ms 处（越界部分丢弃）"""
    off = int(SR * at_ms / 1000.0)
    for i, v in enumerate(src):
        j = off + i
        if 0 <= j < len(dst):
            dst[j] += v * gain
    return dst


def normalize(sig: list, peak: float = PEAK) -> list:
    """峰值归一化 + 首尾各 2ms 淡入淡出（防止播放头尾的爆音）"""
    m = max((abs(v) for v in sig), default=0.0)
    if m > 1e-9:
        k = peak / m
        sig = [v * k for v in sig]
    fade = int(SR * 0.002)
    for i in range(min(fade, len(sig))):
        g = i / fade
        sig[i] *= g
        sig[-1 - i] *= g
    return sig


def write_wav(path: str, sig: list) -> None:
    """写 16bit 单声道 WAV"""
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(b''.join(
            struct.pack('<h', max(-32768, min(32767, int(v * 32767))))
            for v in sig
        ))


# ============================================================
#  三、逐个音效的配方
# ============================================================
#  设计原则（与动画时长一一对应）：
#   · 反馈音必须 **短于** 对应的动画 —— 动画还在跑、声音已经收尾，
#     观感是"动作干脆"；反过来的话每次操作都拖着一条声尾。
#   · 同一族动作（点击类）共用一个音高中心，靠音色区分，
#     玩家才会把它们听成"同一套语言"。
#
#  ⚠️ 本作的**材质体系是「纸 + 墨 + 木 + 字」**，刻意不要金属长尾：
#     长衰减的高频 bell 会立刻把声音拉去另一个游戏（而且会盖住 BGM）。
#     所以凡是用到 bell 的地方，decay 都压得比"钟"短得多。
# ============================================================

def sfx_tap() -> list:
    """按下：极短的木质 '哒'。对应 onDown 的 80ms「拎起来」，音效只给 70ms"""
    s = buf(70)
    mix(s, tone(int(SR * 0.055), 1750, 0.011, 0.75, square=0.55), 0)
    mix(s, noise(int(SR * 0.020), 0.004, 0.35, lp=0.75), 0)       # 击打的瞬态
    return normalize(s)


def sfx_pick() -> list:
    """拎起：'呲' 一声离手音（与落位 land 组成「呲——咔」的因果链）"""
    s = buf(110)
    mix(s, sweep(int(SR * 0.09), 900, 1500, 0.030, 0.55), 0)
    mix(s, noise(int(SR * 0.05), 0.012, 0.22, lp=0.55, hp=0.20), 0)
    return normalize(s)


def sfx_bead() -> list:
    """
    ★ 本作新增：**拖动时"珠子滑过一格"的一声**。

    【用户要求（2026-10-02）】「推动经过格子时，要有个珠子滑动的小音效，
      要快速清脆」。所以这一声的验收标准是**短 + 亮 + 干净**，三条缺一不可：

    · **短（55ms 总长、衰减 10ms）** —— 拖动一格最快可能 60~80ms，
      音效比这还长就会和下一格的那一声**叠在一起糊成一条**，
      听起来变成"连续的嗡嗡声"而不是"一颗颗珠子"。
      这是本段最重要的约束：它决定了整段的时长上限只能是 ~55ms。
    · **亮（2350Hz 基音 + 4700Hz 泛音）** —— "清脆"在声学上就是
      **高频 + 极快衰减**。低于 1.5kHz 会变成"哒"（tap 的音区），
      和按下音撞车，玩家分不清"我按到了"和"我挪了一格"。
    · **干净（起音 0.5ms、无低频成分）** —— 至少响 5~10 次/秒，
      任何一点低频都会累积成"轰轰"的底噪。所以这里**刻意不加低频冲击**
      （对比 clash 第一条就是 150Hz 的低频冲击）。

    【为什么泛音给到 4700Hz】约等于基音的 2 倍，是"瓷珠/玻璃珠"的振型；
      单纯的正弦听起来像电子提示音，加上 2 倍泛音才有"实体的珠子"感。

    【音量预留】归一化峰值压到 0.58（其余音效是 0.72）——
      它一秒可能响十次，按常规电平会盖过一切。真正的最终音量在
      `CFG.AUDIO.GAIN.bead` 里再压一次。
    """
    s = buf(55)
    # ① 珠体：2350Hz 主音，10ms 衰减 —— 这是"清脆"的主体
    mix(s, tone(int(SR * 0.050), 2350, 0.010, 0.80, attack_ms=0.5), 0)
    # ② 瓷珠泛音：4700Hz，衰减更快（5ms），只做"亮"不做"响"
    mix(s, tone(int(SR * 0.030), 4700, 0.005, 0.34, attack_ms=0.4), 0)
    # ③ 触格瞬态：极短高频噪声，给起音一个"点"（6ms 内结束，不拖尾）
    mix(s, noise(int(SR * 0.008), 0.0025, 0.22, lp=0.86, hp=0.40), 0)
    return normalize(s, 0.58)


def sfx_land() -> list:
    """落位：牌入格的 '咔'（比 tap 闷、比 pick 实）—— 与吸附补间同帧"""
    s = buf(120)
    mix(s, tone(int(SR * 0.09), 520, 0.028, 0.80, attack_ms=1.0), 0)
    mix(s, tone(int(SR * 0.07), 780, 0.018, 0.42), 0)
    mix(s, noise(int(SR * 0.030), 0.006, 0.30, lp=0.45), 0)
    return normalize(s)


def sfx_reject() -> list:
    """回弹拒绝：低沉下滑 '咚'。必须不悦耳，但不刺耳（这是"提示"不是"惩罚"）"""
    s = buf(170)
    mix(s, sweep(int(SR * 0.15), 240, 150, 0.045, 0.85, log=False), 0)
    mix(s, tone(int(SR * 0.10), 120, 0.035, 0.45), 0)
    return normalize(s, 0.62)


def sfx_clash() -> list:
    """
    ★★ **本作的核心音效**：两个字牌合成一个字的**撞击**。

    【学习来源（用户 2026-10-02：「合成字后要有撞击感，学习隔壁的麻将项目」）】
      结构沿用隔壁 `game-4-mahjong` 的 `sfx_peng`/`clash`：
        **冲击瞬态 + 三音和弦**。两处关键设计都照搬，因为它们各自解决一个问题：

      ① **为什么要有"冲击瞬态"（噪声 + 低频）**：纯和弦听起来是"响了一下"，
         不是"撞上了"。撞击感来自**起音那一两毫秒里的宽带能量** ——
         噪声给它"硬"，150Hz 的低频给它"有质量"。

      ② **为什么是三音和弦（C-E-G，大三度+小三度）**：一次合成是"两片合成一件事"，
         多个音同时响在听觉上就是"合而为一"；而**大三和弦在音乐心理学里
         天然被解读为"完成 / 达成"**，正好是"这个字做出来了"的语义。
         三个音各错开 5ms，避免相位完全对齐产生"数字化"的金属味。

    【与隔壁的差别：木石，不是金属】
      隔壁把和弦交给 `bell`（decay 0.115，偏钟/金属）。本作的材质是
      **纸 + 墨 + 木刻字**，钟声会跑味，所以：
        · 和弦 decay 压到 **0.075**（比隔壁短 35%），听感从"钟"变"磬/石板"；
        · 额外加一条 **320Hz 木质硬点**（square 削平过），
          读作"木头撞木头"，而不是"金属碰金属"。

    【时长 300ms 的来历】紧跟着 `clear`（消散，340ms）在 **70ms 后**响起，
      两条叠起来是「咚—唰」。两段各自完整、又不互相盖住。
    """
    s = buf(300)
    # ① 撞击瞬态：宽带高频噪声 —— "撞上去"的那一下
    mix(s, noise(int(SR * 0.035), 0.010, 0.62, lp=0.78, hp=0.30), 0)
    # ② 低频冲击：有质量（这一条是"珠子"音效**刻意没有**的，两者因此不打架）
    mix(s, tone(int(SR * 0.06), 150, 0.020, 0.55, attack_ms=1.0), 0)
    # ③ 木质硬点：让撞击落在"木头"而不是"金属"上
    mix(s, tone(int(SR * 0.045), 320, 0.014, 0.30, square=0.5, attack_ms=0.8), 0)
    # ④ 三音和弦 C-E-G（错开 5ms）—— "两片合成一件事" + "完成/达成"
    for k, f in enumerate((523.25, 659.25, 783.99)):
        mix(s, bell(int(SR * 0.22), f, 0.075, 0.40, attack_ms=1.8), 5 * k)
    return normalize(s, 0.74)


def sfx_clear() -> list:
    """
    消散：上行扫频 + 明亮泛音尾 —— "散开 / 凸显"的听感。

    与撞击的分工：`clash` 负责"撞上了"，`clear` 负责"它成了、亮出来了"。
    两者在合成流程里间隔 ~70ms（CFG.GAME 的撞击时长），听觉上正好是"咚—唰"。

    【为什么上行的目标是 1680Hz】刚好落在本作目标 chip 的金色高亮区，
      配合"合成字放大 + 金色光晕"的视觉，听起来就是"这个字亮出来了"。
    """
    s = buf(340)
    mix(s, sweep(int(SR * 0.30), 620, 1680, 0.085, 0.50), 0)
    for k, f in enumerate((1046.5, 1318.5, 1568.0)):
        mix(s, bell(int(SR * 0.26), f, 0.075, 0.26, attack_ms=1.5), 14 * k + 10)
    mix(s, noise(int(SR * 0.12), 0.030, 0.22, lp=0.62, hp=0.22), 0)
    return normalize(s)


def sfx_hint() -> list:
    """
    提示工具：两音上行「叮—咚」（A5 → E6）。

    【为什么要独立的提示音，而不是复用 reward】提示是**玩家主动求助**，
      奖励是**系统给的东西**。同一段声音会让玩家以为"我点了提示系统奖励了我"。
      这里用更窄的音程（纯五度上行）和更短的尾音，读作"指给你看"。
    """
    s = buf(260)
    mix(s, bell(int(SR * 0.18), 880.00, 0.055, 0.46, attack_ms=1.5), 0)
    mix(s, bell(int(SR * 0.22), 1318.51, 0.070, 0.40, attack_ms=1.5), 90)
    return normalize(s, 0.66)


def sfx_shuffle() -> list:
    """洗牌：'哗啦' —— 噪声 + 三个起伏（纸牌摩擦是断断续续的）"""
    s = buf(470)
    mix(s, noise(int(SR * 0.44), 0.150, 0.75, lp=0.24, hp=0.12, humps=3), 0)
    mix(s, noise(int(SR * 0.10), 0.020, 0.35, lp=0.70, hp=0.30), 0)   # 起手的"抽牌"声
    mix(s, bell(int(SR * 0.20), 392.0, 0.050, 0.16), 20)              # 一点音高，避免纯噪声听着像故障
    return normalize(s, 0.62)


def sfx_reward() -> list:
    """奖励到账 / 凑对工具：C-E-G-C 四音上行琶音（比提示更长更亮 = "这是好东西"）"""
    s = buf(430)
    for k, f in enumerate((523.25, 659.25, 783.99, 1046.50)):
        mix(s, bell(int(SR * 0.32), f, 0.105, 0.36, attack_ms=2.0), 62 * k)
    return normalize(s)


def sfx_fail() -> list:
    """失败（超时）：下行两音（G→C 下行 = 明确的"结束"语义），刻意压低明亮度"""
    s = buf(520)
    mix(s, bell(int(SR * 0.42), 392.00, 0.145, 0.55, attack_ms=3.0), 0)
    mix(s, bell(int(SR * 0.44), 261.63, 0.185, 0.60, attack_ms=3.0), 165)
    mix(s, tone(int(SR * 0.12), 98.0, 0.040, 0.35), 0)
    return normalize(s, 0.66)


def sfx_revive() -> list:
    """复活：明亮上行 + 闪亮泛音（雨过天晴），与 fail 严格对偶"""
    s = buf(460)
    mix(s, sweep(int(SR * 0.40), 330, 990, 0.130, 0.40), 0)
    for k, f in enumerate((659.25, 987.77)):
        mix(s, bell(int(SR * 0.32), f, 0.100, 0.40, attack_ms=2.0), 90 * k)
    return normalize(s)


def sfx_win() -> list:
    """通关：C-E-G-C 大调上行 + 尾音，比 reward 更长（这是整局的句号）"""
    s = buf(700)
    for k, f in enumerate((523.25, 659.25, 783.99, 1046.50)):
        mix(s, bell(int(SR * 0.55), f, 0.155, 0.34, attack_ms=3.0), 110 * k)
    mix(s, bell(int(SR * 0.60), 1567.98, 0.120, 0.22), 480)
    return normalize(s)


# 文件名 → 生成函数。字典顺序 = 生成顺序，也方便核对。
#
# ⚠️⚠️ **这个字典直接决定 assets/resources/audio/ 里有哪些 .m4a** ⚠️⚠️
#   `main()` 会无条件写盘**字典里的每一个键**，`--install` 也一样。
#   所以：想停用某个音效，必须**把它从本字典删掉**，
#   光删调用点没有用 —— 文件还在、还会被加载、还占首包体积。
#
#   ⚠️ 与 `ui/AudioService.ts` 的 `SfxId` 联合类型 + `ALL_SFX` 数组
#      **必须成对维护**。少一个 → 加载失败只 warn 不报错，
#      表现是"这个音效怎么没声音"，而且控制台里看不出是漏了。
SFX = {
    'tap': sfx_tap,
    'pick': sfx_pick,
    'bead': sfx_bead,          # ★ 拖动时"珠子滑过一格"
    'land': sfx_land,
    'reject': sfx_reject,
    'clash': sfx_clash,        # ★ 合成撞击（核心）
    'clear': sfx_clear,
    'hint': sfx_hint,          # ★ 提示工具
    'shuffle': sfx_shuffle,
    'reward': sfx_reward,
    'fail': sfx_fail,
    'revive': sfx_revive,
    'win': sfx_win,
}


# ============================================================
#  三·B、入库（--install）
# ============================================================
#  为什么必须有这一步、而不能手工把 m4a 拖进 assets/resources/audio：
#   ① `.meta` 是资源的身份证。Cocos 靠 uuid 引用资源 —— 手工拖文件要么
#      没有 `.meta`（编辑器补一个随机 uuid，不可复现），要么覆盖时把 uuid
#      换了（工程里凭空多一个资源、旧的变野指针，表现为"音频莫名为空"）。
#      这里用 uuid5（名字哈希）派生固定值，跑多少次都一样。
#   ② `afconvert` 会把"编码那一刻"的时间戳写进容器 → 同一段音频重跑两次
#      md5 都不一样。搬完必须再调一次 zero_container_times()。
#   ③ "文件在" ≠ "能播"：参数写错的 afconvert 会**安静地**产出坏文件，
#      所以落盘后立刻 afinfo 复验。
# ============================================================

def stable_uuid(name: str) -> str:
    """由资源名派生固定 uuid（与"固定随机种子"同理：保证可复现）。"""
    import uuid
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f'chaizi-lianliankan://audio/{name}'))


def meta_json(name: str) -> str:
    """与 Cocos 的 audio-clip importer 需要的字段一致。"""
    import json as _json
    return _json.dumps({
        'ver': '1.0.0',
        'importer': 'audio-clip',      # ★ 必须是 audio-clip，否则构建后不是 AudioClip
        'imported': True,
        'uuid': stable_uuid(name),
        'files': ['.json', '.m4a'],
        'subMetas': {},
        'userData': {'downloadMode': 0},
    }, indent=2) + '\n'


def install_to_game() -> int:
    """把 OUT_DIR 里已通过自检的 m4a 全部搬进 game-5-chaizi/assets/resources/audio/"""
    # ★ 先断言工程根存在，再建子目录。
    #   顺序反过来的话，路径写错时 makedirs 会把一整套错目录静静建出来
    #   （见 GAME_AUDIO 上方注释里记的那次踩坑）。
    if not os.path.isdir(os.path.join(GAME_ROOT, 'assets')):
        print(f'✗ 找不到 Cocos 工程：{GAME_ROOT}')
        print('  请确认脚本位于 <仓库根>/tools/ 下、工程目录名为 game-5-chaizi。')
        return 2
    os.makedirs(GAME_AUDIO, exist_ok=True)
    zero_times = zero_container_times

    total = 0
    bad = 0
    print('=' * 72)
    print(f'  音效入库：{len(SFX)} 段  →  assets/resources/audio/')
    print('=' * 72)
    print(f'{"名称":<10}{"体积":>9}  {"时长":>8}  复验   .meta')
    print('-' * 72)
    for name in SFX:
        src = os.path.join(OUT_DIR, f'{name}.m4a')
        if not os.path.exists(src):
            print(f'{name:<10}{"缺失":>9}  ——  先跑一次 python3 tools/make-sfx.py')
            bad += 1
            continue

        dst = os.path.join(GAME_AUDIO, f'{name}.m4a')
        meta = dst + '.meta'
        shutil.copyfile(src, dst)
        zero_times(dst)                      # 清容器时间戳 → 可复现

        info = subprocess.run(['afinfo', dst], capture_output=True)
        ok = info.returncode == 0 and b'audio' in info.stdout.lower()
        dur = 0.0
        for line in info.stdout.decode(errors='ignore').splitlines():
            if 'estimated duration' in line:
                try:
                    dur = float(line.split(':')[1].strip().split()[0])
                except Exception:
                    pass
        kb = os.path.getsize(dst) / 1024.0
        total += kb
        if not ok:
            bad += 1
        # .meta：新建才写；覆盖已有资源**绝不重写**（重写会换 uuid）
        if os.path.exists(meta):
            verb = '保留原 uuid'
        else:
            with open(meta, 'w', encoding='utf-8') as f:
                f.write(meta_json(f'{name}.m4a'))
            verb = f'新建 uuid={stable_uuid(f"{name}.m4a")[:8]}…'
        print(f'{name:<10}{kb:8.1f}K{dur:8.3f}s  {"✅" if ok else "⚠️ "}    {verb}')

    print('-' * 72)
    print(f'合计 {total:.1f}KB   复验失败 {bad} 段')
    print(f'目标 {GAME_AUDIO}')
    print()
    print('  下一步：bash tools/wechat-preview.sh   # 构建 + 出真机试玩码')
    print('=' * 72)
    return 0 if bad == 0 else 1


# ============================================================
#  六·b、听感组合：把"游戏里的那一下"拼出来
# ============================================================
#  为什么必须做这一步（不是为了好看）：
#    13 段**分开听**，恰恰听不出你最关心的那两下 ——
#      · 「撞击感」不是 clash 一个音的性质，而是 clash 与 clear 相隔 70ms
#        的**时序关系**。分开听 = 把"咚—唰"拆成"咚"和"唰"听两遍，
#        撞不撞得上完全判断不了；
#      · 「珠子滑过格子」在游戏里是**每 120ms 一次**的连发（拖一格一声），
#        单独听一声 55ms 的"叮"什么都说明不了 —— 要点是连发时颗粒分不分明。
#    所以这里按游戏里的**真实调用时序**拼 5 段短 demo，并排在一起听。
#
#  实现用「按毫秒偏移**叠加**」而不是首尾相接：
#    clash 与 clear 在游戏里是**重叠**的（相差 70ms，而 clash 本身 300ms）。
#    拼接会把那 70ms 变成"两段之间的间隙"，听感当场变成两个独立事件 ——
#    而撞击感恰恰就藏在这 70ms 的重叠里。
#
#  ⚠️ 读的是 TMP_WAV_DIR 里的 **wav** 而不是 OUT_DIR 的 m4a：
#     m4a 要先解码才能编辑，而 wav 就是刚才合成出来的那一份原始信号，
#     **没有任何一代编码损失**。编辑完再统一编码一次。
# ============================================================

PREVIEW_DIR = os.path.join(OUT_DIR, '_preview')

COMBOS = [
    ('drag', '拖动：珠子滑过 6 格',
     '按住一张牌横向拖 6 格（每格 120ms 一声）。**这一条是用来验「快速清脆」的**：'
     '六声连发时如果分不清颗粒、糊成一条线，说明单声还不够短或低频太多。',
     [('bead', 0), ('bead', 120), ('bead', 240),
      ('bead', 360), ('bead', 480), ('bead', 600)]),
    ('place', '拎起 → 落位',
     '「呲——咔」：按下拎起来，松手落到格子里。',
     [('pick', 0), ('land', 260)]),
    ('match', '★ 合成一个字（撞击 → 消散）',
     '**这一条就是你要的「撞击感」**：两片字牌撞在一起（冲击瞬态 + C-E-G 大三和弦），'
     '70ms 之后消散的「唰」压上来。注意这两声是**叠在一起**的，不是一前一后。',
     [('clash', 0), ('clear', 70)]),
    ('win', '消除 → 通关',
     '本关最后一步合成之后，直接进通关结算的上行琶音 —— 整局的句号。',
     [('clear', 0), ('win', 320)]),
    ('overtime', '超时失败 → 看视频复活',
     'G→C 下行两音（明确的"结束"），一秒后明亮上行的复活音（雨过天晴）。'
     '两条严格对偶 —— 是同一套语言的正反面。',
     [('fail', 0), ('revive', 1000)]),
]


def build_combos(wav_dir: str, out_dir: str) -> list:
    """按 COMBOS 把音效叠成短 demo，返回报告（详见上方长注释）。"""
    os.makedirs(out_dir, exist_ok=True)
    out = []
    for cid, title, note, parts in COMBOS:
        waves = []
        missing = False
        for name, off_ms in parts:
            p = os.path.join(wav_dir, f'{name}.wav')
            if not os.path.exists(p):
                missing = True
                break
            with wave.open(p, 'rb') as w:
                assert w.getnchannels() == 1, p
                assert w.getframerate() == SR, p
                cnt = w.getnframes()
                waves.append((list(struct.unpack(f'<{cnt}h', w.readframes(cnt))), off_ms))
        if missing:
            return []          # 还没合成过音效（比如 --wav-only 之外的分支），静默跳过

        # 总长 = 最后一个音的结束时刻 + 300ms，让最后一声的余韵自然收掉
        last = max(o + len(s) / SR * 1000.0 for s, o in waves)
        n = int((last + 300.0) / 1000.0 * SR)
        acc = [0.0] * n
        for s, off in waves:
            at = int(off / 1000.0 * SR)
            for i, v in enumerate(s):
                j = at + i
                if j < n:
                    acc[j] += v / 32768.0

        sig = normalize(acc)          # 峰值归一 + 首尾 2ms 淡入淡出
        wav_p = os.path.join(wav_dir, f'combo-{cid}.wav')
        write_wav(wav_p, sig)
        m4a_p = os.path.join(out_dir, f'combo-{cid}.m4a')
        r = subprocess.run(
            ['afconvert', '-f', 'm4af', '-d', 'aac', '-b', '64000', wav_p, m4a_p],
            capture_output=True,
        )
        if r.returncode != 0:
            print(f'  组合 {cid} 转码失败：{r.stderr.decode()[:120]}')
            continue
        zero_container_times(m4a_p)    # 与音效同一条家法：清容器时间戳
        out.append(dict(
            id=cid, title=title, note=note,
            dur=round(n / SR, 3),
            kb=round(os.path.getsize(m4a_p) / 1024.0, 1),
            path=m4a_p,
        ))
    return out


def build_page(out_path: str, combos=None) -> None:
    """
    音效试听页（给人拍板用）。音频 base64 内嵌 —— 不写 <audio src="./x.m4a">：
    预览面板对相对路径的支持不确定（file:// 下媒体加载各浏览器策略不同），
    内嵌成 data URI 是唯一"一定能播"的写法。
    """
    import base64 as _b64

    combos = combos or []

    rows = []
    for name in SFX:
        p = os.path.join(OUT_DIR, f'{name}.m4a')
        if not os.path.exists(p):
            continue
        b64 = _b64.b64encode(open(p, 'rb').read()).decode('ascii')
        size_kb = os.path.getsize(p) / 1024.0
        with wave.open(os.path.join(TMP_WAV_DIR, f'{name}.wav'), 'rb') as w:
            dur_ms = w.getnframes() / w.getframerate() * 1000.0
        rows.append((name, b64, size_kb, dur_ms))

    # ★ 组合卡放在**最前面**：它们是"游戏里的那一下"，
    #   拍板的判断应该建立在这上面；13 段单听是"零件目录"，用来定位问题。
    combo_cards = []
    for c in combos:
        b64 = _b64.b64encode(open(c['path'], 'rb').read()).decode('ascii')
        combo_cards.append(f'''
  <section class="card combo">
    <div class="hd"><h2>{c['title']}</h2>
      <span class="meta">{c['dur'] * 1000:.0f}ms · {c['kb']:.1f}K</span></div>
    <audio controls preload="metadata" src="data:audio/mp4;base64,{b64}"></audio>
    <p class="note">{c['note']}</p>
  </section>''')

    cards = []
    for name, b64, size_kb, dur_ms in rows:
        cards.append(f'''
  <section class="card">
    <div class="hd"><h2>{name}</h2>
      <span class="meta">{dur_ms:.0f}ms · {size_kb:.1f}K</span></div>
    <audio controls preload="metadata" src="data:audio/mp4;base64,{b64}"></audio>
    <p class="note">{SFX_NOTE.get(name, '')}</p>
  </section>''')

    html = f'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>《挪字成章》音效试听</title>
<style>
  :root {{ --bg:#f6f5f2; --card:#fff; --ink:#1c1b19; --sub:#6b6862;
          --line:#e4e1da; --accent:#b23a2e; }}
  * {{ box-sizing:border-box; }}
  body {{ margin:0; background:var(--bg); color:var(--ink);
    font:15px/1.7 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif; }}
  header {{ padding:30px 24px 12px; max-width:760px; margin:0 auto; }}
  h1 {{ margin:0 0 6px; font-size:22px; }}
  .lead {{ color:var(--sub); margin:0 0 8px; font-size:14px; }}
  main {{ max-width:760px; margin:0 auto; padding:0 24px 60px; }}
  h3 {{ margin:26px 0 4px; font-size:15px; color:var(--sub); font-weight:600; }}
  h3 span {{ font-weight:400; font-size:13px; }}
  .bar {{ display:flex; gap:8px; flex-wrap:wrap; margin:12px 0 0; }}
  .bar button {{ border:1px solid var(--line); background:#fff; color:var(--ink);
    border-radius:999px; padding:7px 15px; font-size:13.5px; cursor:pointer; }}
  .bar button:hover {{ border-color:var(--accent); color:var(--accent); }}
  .bar button.on {{ background:var(--accent); border-color:var(--accent); color:#fff; }}
  .card {{ background:var(--card); border:1px solid var(--line); border-radius:12px;
    padding:14px 18px; margin:12px 0; }}
  .card.combo {{ border-color:#e6cfc9; box-shadow:0 1px 0 #fff inset; }}
  .card.on {{ border-color:var(--accent); }}
  .hd {{ display:flex; align-items:baseline; gap:10px; }}
  .hd h2 {{ margin:0; font-size:16px; font-family:ui-monospace,Menlo,monospace; }}
  .card.combo .hd h2 {{ font-family:inherit; }}
  .meta {{ font-size:12px; color:var(--sub); }}
  audio {{ width:100%; height:32px; margin:8px 0 4px; }}
  .note {{ margin:2px 0 0; font-size:13.5px; color:var(--sub); }}
  .note b {{ color:var(--ink); }}
</style>
</head>
<body>
<header>
  <h1>《挪字成章》— 音效试听</h1>
  <p class="lead">{len(rows)} 段音效 + {len(combos)} 段<b>组合</b>，全部<b>程序化合成</b>
     （零素材依赖、无版权风险；没有用任何现成素材）。</p>
  <p class="lead"><b>先听上面 5 个组合</b> —— 那是"游戏里的那一下"，判断建立在这上面。
     下面 13 段单听是**零件目录**，用来定位问题（哪一声不对，告诉我名字即可）。</p>
  <div class="bar">
    <button id="all">▶ 连播全部（组合 → 音效）</button>
    <button id="stop">■ 停</button>
  </div>
</header>
<main>
  <h3>一、游戏里的那一下（组合）<span>—— 按游戏内真实调用时序叠加，不是拼接</span></h3>
  {"".join(combo_cards)}
  <h3>二、零件目录（单段音效）<span>—— 顺序 = 生成顺序</span></h3>
  {"".join(cards)}
</main>
<script>
  // 连播：preload="metadata" 的 data URI 在用户点过之后可以链式 play()
  // （浏览器把"用户手势"记成 sticky activation，后续 play() 不再需要手势）。
  // 每段之间留 380ms，否则 55ms 的珠子音会一声压一声。
  var seq = Array.prototype.slice.call(document.querySelectorAll('audio'));
  var idx = -1, timer = null;
  function clearOn() {{
    document.querySelectorAll('.card.on').forEach(function (c) {{ c.classList.remove('on'); }});
  }}
  function stopAll() {{
    if (timer) {{ clearTimeout(timer); timer = null; }}
    if (idx >= 0 && idx < seq.length) {{ seq[idx].pause(); }}
    idx = -1; clearOn();
    document.getElementById('all').classList.remove('on');
  }}
  function next() {{
    if (idx >= 0 && idx < seq.length) {{ seq[idx].pause(); }}
    idx++;
    if (idx >= seq.length) {{ stopAll(); return; }}
    // ⚠️ 这一行**必须有**：clearOn() 就是为了"只留当前一张高亮"写的。
    //    漏掉它高亮会越叠越多（实测播到第 4 段时同屏 4 张卡都亮着），
    //    而且会让"连播是不是在推进"这件事**看不出来** —— 外部脚本读
    //    "第一张高亮卡"永远读到第 0 张，看着像卡死了。
    clearOn();
    var a = seq[idx];
    a.closest('.card').classList.add('on');
    a.currentTime = 0;
    var p = a.play();
    if (p && p.catch) {{ p.catch(function () {{}}); }}
    timer = setTimeout(next, Math.max(600, a.duration * 1000 + 380));
  }}
  document.getElementById('all').addEventListener('click', function () {{
    if (idx >= 0) {{ stopAll(); return; }}
    this.classList.add('on');
    next();
  }});
  document.getElementById('stop').addEventListener('click', stopAll);
</script>
</body>
</html>
'''
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(html)


SFX_NOTE = {
    'tap': '按下确认（对应 80ms「拎起来」）。最频繁的一声，所以最轻。',
    'pick': '拎起离手「呲」——与 land 组成「呲——咔」。',
    'bead': '★ 拖动时每跨过一格的一声。**55ms、2350Hz、无低频**：短到不与下一格重叠，亮到读作"珠子"。',
    'land': '落位「咔」，与吸附补间同帧。',
    'reject': '严格回弹的句号。低沉但不刺耳（是"提示"不是"惩罚"）。',
    'clash': '★★ 合成撞击（核心）。冲击瞬态 + C-E-G 大三和弦，"两片合成一个字" + "完成/达成"。',
    'clear': '消散「唰」，与 clash 隔 70ms 组成「咚—唰」。上行到 1680Hz = "亮出来了"。',
    'hint': '提示工具（A5→E6 纯五度上行）。刻意与 reward 区分：这是我指给你看，不是奖励。',
    'shuffle': '洗牌「哗啦」，三个起伏 = 牌在断断续续地摩擦。',
    'reward': '奖励到账 / 凑对工具：四音上行琶音。',
    'fail': '超时失败：G→C 下行两音，"结束"语义。',
    'revive': '看视频复活：明亮上行，与 fail 严格对偶。',
    'win': '通关：C-E-G-C 上行 + 尾音，整局的句号。',
}


# ============================================================
#  四、入口
# ============================================================

def _iter_boxes(data: bytes, start: int, end: int):
    """
    按 MP4 box 结构逐个产出 (type, payload_start, box_end)。
    遇到畸形长度直接停止（宁可少清一个字段，也不要越界写坏文件）。

    MP4 的 box 布局：[size(4)][type(4)][payload...]
      size == 1 → 后面还有 8 字节的 64 位长度（payload 从 +16 开始）
      size == 0 → 这个 box 一直延伸到文件末尾
    """
    p = start
    while p + 8 <= end:
        size = int.from_bytes(data[p:p + 4], 'big')
        btype = bytes(data[p + 4:p + 8])
        payload = p + 8
        if size == 1:
            if p + 16 > end:
                return
            size = int.from_bytes(data[p + 8:p + 16], 'big')
            payload = p + 16
        elif size == 0:
            size = end - p
        if size < payload - p or p + size > end:
            return
        yield btype, payload, p + size
        p += size


def _zero_times(data: bytearray, payload: int) -> None:
    """清零某个 header box 的 creation_time / modification_time"""
    span = 16 if data[payload] == 1 else 8      # version 1 → 各 8 字节
    for j in range(payload + 4, payload + 4 + span):
        data[j] = 0


def zero_container_times(path: str) -> int:
    """
    把 m4a 容器里的**创建/修改时间戳**清零，让输出逐字节可复现。

    【为什么必须做这一步 —— 不写的话文件头的承诺就是假的】
    `afconvert` 会在 mvhd（movie header）与 mdhd（media header）两个 box 里
    写入"编码发生的那一刻"。于是**同一个脚本、同一个种子、不改一行**，
    两次运行的 m4a 的 md5 都不一样（实测确认：WAV 两次完全一致，
    差异全部来自容器时间戳）。

    后果不是"音质变了"，而是**版本控制被污染**：
    每重新生成一次，13 个二进制文件全部显示为"已修改"，
    于是"这次到底改了哪段音效"永远看不出来 —— 对一个要求"每次修改都能回溯"
    的项目来说，这比多几个字节严重得多。

    时间戳在 mvhd / mdhd 里的位置：
        'mvhd' 之后依次是 version(1) + flags(3)，然后就是
        creation_time 与 modification_time。
          version 0 → 各 4 字节（QuickTime 时间，起点 1904-01-01）
          version 1 → 各 8 字节
    时间戳不影响解码与播放，清零是安全的（main() 之后用 afinfo 复验可解码性）。

    ⚠️ 【必须按 box 结构解析，不能用 data.find(b'mvhd') 盲搜】
    'mvhd' 这 4 个字节**完全可能恰好出现在压缩后的音频数据里** ——
    盲搜到那里去清零就会**直接破坏音频**，而且是那种"大多数机器上没事、
    偶尔某段音效变噪音"的隐蔽故障。本文件踩过的坑已经够多了。
    """
    with open(path, 'rb') as f:
        data = bytearray(f.read())

    n = 0
    for t, pl, end in _iter_boxes(data, 0, len(data)):
        if t != b'moov':
            continue
        for t2, pl2, end2 in _iter_boxes(data, pl, end):
            if t2 == b'mvhd':
                _zero_times(data, pl2)
                n += 1
            elif t2 == b'trak':
                # trak 里**有两个**带时间戳的 box，一个都不能漏：
                #   tkhd（track header）—— 直接挂在 trak 下
                #   mdhd（media header）—— 藏在 trak → mdia 里
                # 实测教训：只清了 mvhd + mdhd 时，重跑两次仍然有 2 个字节在变
                # （tkhd 的 creation/modification 的末字节），diff 定位到偏移
                # 167/171 才发现的。所以下面逐个判别。
                for t3, pl3, end3 in _iter_boxes(data, pl2, end2):
                    if t3 == b'tkhd':
                        _zero_times(data, pl3)
                        n += 1
                    elif t3 == b'mdia':
                        for t4, pl4, _ in _iter_boxes(data, pl3, end3):
                            if t4 == b'mdhd':
                                _zero_times(data, pl4)
                                n += 1

    with open(path, 'wb') as f:
        f.write(bytes(data))
    return n


def main() -> int:
    argv = sys.argv[1:]

    # --install 是"另一件事"：不合成，只把已拍板的产物搬进游戏。
    # 放在最前面短路 —— 否则会白跑一遍全部音效（虽然只要几秒，
    # 但更重要的是：**它保证了"入库的就是刚才试听的那一份"**）。
    if '--install' in argv:
        return install_to_game()

    wav_only = '--wav-only' in argv
    want_page = '--page' in argv
    os.makedirs(TMP_WAV_DIR, exist_ok=True)
    os.makedirs(OUT_DIR, exist_ok=True)

    total = 0
    print(f'{"名称":<10} {"时长":>7}  {"wav":>8}  {"m4a":>8}')
    print('-' * 42)
    for name, fn in SFX.items():
        # ★ 逐音效播种：保证"改 A 不影响 B"，详见 seed_for 的注释
        seed_for(name)
        sig = fn()
        wav_path = os.path.join(TMP_WAV_DIR, f'{name}.wav')
        write_wav(wav_path, sig)
        wav_kb = os.path.getsize(wav_path) / 1024.0

        if wav_only:
            print(f'{name:<10} {len(sig) / SR * 1000:6.0f}ms  {wav_kb:7.1f}K  {"-":>8}')
            continue

        m4a_path = os.path.join(OUT_DIR, f'{name}.m4a')
        # -b 64000：单声道 64kbps。音效是短促瞬态，再高的码率在手机外放上听不出差别
        r = subprocess.run(
            ['afconvert', '-f', 'm4af', '-d', 'aac', '-b', '64000', wav_path, m4a_path],
            capture_output=True,
        )
        if r.returncode != 0:
            print(f'{name} 转码失败：{r.stderr.decode()[:120]}')
            return 1
        # 清零容器时间戳，否则每次生成全部文件 md5 都在变（见函数注释）
        zero_container_times(m4a_path)
        m4a_kb = os.path.getsize(m4a_path) / 1024.0
        total += m4a_kb
        print(f'{name:<10} {len(sig) / SR * 1000:6.0f}ms  {wav_kb:7.1f}K  {m4a_kb:7.1f}K')

    if not wav_only:
        print('-' * 42)
        print(f'合计 {total:.1f}KB（{len(SFX)} 段），输出目录 {OUT_DIR}')

    if want_page and not wav_only:
        # ★ 组合要在 build_page **之前**拼好：组合卡在页面最上面，
        #   而且它读的是刚刚写出的 wav（不是 m4a），所以必须排在音效合成之后。
        combos = build_combos(TMP_WAV_DIR, PREVIEW_DIR)
        if combos:
            print('-' * 42)
            print('听感组合（按游戏内真实调用时序叠加）：')
            for c in combos:
                print(f'  {c["id"]:<10}{c["dur"] * 1000:6.0f}ms  {c["kb"]:5.1f}K  {c["title"]}')
        page = os.path.join(OUT_DIR, '音效试听.html')
        build_page(page, combos)
        print(f'试听页   {page}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
