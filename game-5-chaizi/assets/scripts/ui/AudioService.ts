/**
 * ============================================================
 *  AudioService.ts · 音效与 BGM 播放（S6）
 * ============================================================
 *  职责：把"播一声"收敛成一个静态方法调用。业务代码永远不需要知道：
 *        文件在哪、加载好没有、有没有静音、用哪条声道、上一次播是什么时候。
 *
 *  ------------------------------------------------------------
 *  【设计要点：为什么是"声道池"而不是 playOneShot】
 *  Cocos 的 AudioSource 有个很省事的 `playOneShot(clip, volume)`，
 *  一个组件就能并发播多个音效，但它给不了**抢占**：
 *  声道池可以明确地"先 stop 掉最老的一条、再播新的"，
 *  保证玩家当下这一下**永远有声音**（宁可掐掉一条音效尾巴，
 *  也不许点击没有反馈）。
 *
 *  ------------------------------------------------------------
 *  【设计要点：加载未完成时"静默跳过"，绝不补播】
 *  音效是异步加载的。第一次点击时如果正好还没加载完，
 *  正确做法是**放弃这一声**，而不是等加载完再补播 ——
 *  补播出来的是一个 300ms 前就该响的声音，玩家会觉得"声音和动作对不上"，
 *  比少一声更糟。这也是为什么必须在启动时就 preload。
 *
 *  ------------------------------------------------------------
 *  【★ 设计要点：首次播放必须落在"用户手势栈"里】
 *  浏览器 / 微信的 autoplay 策略要求音频的**首次**播放发生在用户手势的调用栈内，
 *  否则被静默拦截 —— **不报错、日志也没有线索，表现只是"没声音"**。
 *
 *  ⚠️ 这里有一个极易误判的地方：同样是"进页面时起播"，
 *     · `PageBase.build()` 由 `PageManager.goto` **同步**调用，而 goto 又由
 *       点击回调同步触发 ⇒ **在手势栈内** ✅
 *       → 本工程的 `onCreate` 就是安全的起播点（PageManager.goto 全同步，
 *         没有 setTimeout / 转场动画，已核对）。
 *     · 而任何 `.then()` / `setTimeout` 之后的代码**都已出栈** ❌
 *       → 本页的贴图 `preload(...).then(...)` 里就**不能**起播 BGM。
 *
 *  双保险：`play()`（音效必然在点击栈内）里顺手 `tryStartBgm()` 一次 ——
 *  页面那次若因为资源还没就绪没成，玩家第一下点牌一定会成。
 *
 *  ------------------------------------------------------------
 *  【本作与"隔壁麻将项目"的差别】
 *  编曲引擎、合成链、声道池、BGM 独占声道的家法是移植来的，但：
 *    · 音效 id 换成拆字题材的 13 段（多了 `bead`，没有连章/吃/碰那些）；
 *    · 静音开关做成了对局页顶栏的小喇叭（用户拍板），并持久化到独立存储键；
 *    · BGM 是《点将》（四段候选里用户选的 C），不是电音。
 * ============================================================
 */

import { AudioClip, AudioSource, Input, input, Node, log, resources, sys, warn } from 'cc';
import { CFG } from '../CFG';

/**
 * BGM 的资源路径（相对 assets/resources）。
 * 不要写成 'audio/bgm.m4a' —— `resources.load` 的路径**不带扩展名**，
 * 带上就会走到"加载失败只 warn 不报错"的静默分支里。
 */
const BGM_PATH = 'audio/bgm';

/**
 * 全部音效 id。★ 与 `tools/make-sfx.py` 的 SFX 字典**一一对应** ——
 * 改名字两边都要改，否则是"加载失败只 warn"的静默失败（最难查的那一种）。
 */
export type SfxId =
    | 'tap' | 'pick' | 'bead' | 'land' | 'reject'
    | 'clash' | 'clear'
    | 'hint' | 'shuffle' | 'reward'
    | 'win' | 'fail' | 'revive';

/** 与资源目录一致的清单（顺序无关，只用于遍历加载） */
const ALL_SFX: SfxId[] = [
    'tap', 'pick', 'bead', 'land', 'reject',
    'clash', 'clear',
    'hint', 'shuffle', 'reward',
    'win', 'fail', 'revive',
];

/**
 * 「珠子滑过格子」单独放宽节流到 60ms。
 *
 * 【为什么它要跟别人不一样】
 * 一次拖动最多连响 6 下（每跨一格一下），全局 MIN_GAP_MS=45 会把
 * "过了一格"的颗粒感糊成一串 —— 而**这串颗粒感正是这条音效的全部意义**：
 * 玩家要听见的是"珠子一格一格滑过去"，不是"拖动了"。
 * 60ms 也仍然快过人手跨一格的最快速度，不会漏掉任何一格。
 */
const BEAD_GAP_MS = 60;

/** 播放参数 */
export interface PlayOpts {
    /** 音量倍率（会再乘 CFG.AUDIO.MASTER 与 CFG.AUDIO.GAIN[id]） */
    gain?: number;
    /** 覆盖本音效的最短重放间隔（毫秒） */
    gapMs?: number;
    /** 延后多少毫秒再播（用于"撞 → 消散"这类二连） */
    delayMs?: number;
}

export class AudioService {

    private static _host: Node | null = null;
    private static _voices: AudioSource[] = [];
    private static _rr = 0;
    private static _clips: Partial<Record<SfxId, AudioClip>> = {};
    /** 每个音效上一次播放的时间戳（节流用） */
    private static _lastAt: Partial<Record<SfxId, number>> = {};
    private static _muted = false;
    /** 已发起过 preload（重复调用直接返回，避免重复请求同一批资源） */
    private static _loaded = false;
    /** 已成功加载的音效数量（全部就绪时打一条日志） */
    private static _readyCount = 0;
    /** 延后播放的定时器（页面不管，进程内有效；音效都很短，不需要跟页面生命周期） */
    private static _delayIds: number[] = [];

    // ---- BGM -------------------------------------------------
    /**
     * BGM 的专用声道。
     * 🔴 它**不进 `_voices` 池** —— 池里的声道会被音效按"最久没用"抢占用掉，
     *    而 BGM 被掐断就是"整局没音乐"，跟"少一声点击音"完全不是一个量级的事故。
     */
    private static _bgm: AudioSource | null = null;
    private static _bgmClip: AudioClip | null = null;
    /** 业务侧的意图：「现在应该放 BGM」（与"是否真的响了"解耦） */
    private static _bgmWanted = false;
    /** 是否已经把 play() 发出去过（防止重复 play 把音乐从头打断） */
    private static _bgmStarted = false;
    /** 淡出链路上的定时器句柄 */
    private static _bgmFadeIds: number[] = [];
    /** 「首播到底响没响」的复查定时器（见 probeBgm） */
    private static _bgmProbeId = 0;
    /** 是否已挂上"玩家第一次摸屏幕就起播"的一次性监听 */
    private static _gestureHooked = false;

    // --------------------------------------------------------
    //  初始化
    // --------------------------------------------------------

    /**
     * 建立声道池并开始预加载。必须在**启动时**调用一次（GameRoot.start），
     * 不要等玩家点牌才建 —— 那样第一批音效一定播不出来。
     *
     * @param host 承载 AudioSource 的宿主节点。它挂在 UIRoot 下，
     *             这样页面来回切换时声道不会被销毁（音效不跟着页面走）。
     */
    public static init(host: Node): void {
        if (this._host && this._host.isValid) return;
        this._host = host;

        this._muted = this.readMuted();

        const n = Math.max(1, CFG.AUDIO.VOICES);
        for (let i = 0; i < n; i++) {
            const node = new Node(`AudioVoice_${i}`);
            node.layer = host.layer;
            host.addChild(node);
            const src = node.addComponent(AudioSource);
            // playOnAwake 默认 true，会在 onEnable 时尝试播一次空 clip，
            // 虽无害但污染日志，明确关掉。
            src.playOnAwake = false;
            src.loop = false;
            src.volume = CFG.AUDIO.MASTER;
            this._voices.push(src);
        }

        // BGM 独占一条 AudioSource。
        // loop 由 AudioSource 自己维持（不监听"播完了"再手动接 ——
        // 那种写法在切后台/丢帧的瞬间会漏掉一次结尾，音乐就断了）。
        const bgmNode = new Node('AudioVoice_BGM');
        bgmNode.layer = host.layer;
        host.addChild(bgmNode);
        const bgm = bgmNode.addComponent(AudioSource);
        bgm.playOnAwake = false;
        bgm.loop = true;
        bgm.volume = 0;
        this._bgm = bgm;

        this.pinMuteSwitch();
        this.hookFirstGesture();
        this.preload();
    }

    /**
     * 挂一个"玩家第一次摸屏幕就把 BGM 带起来"的一次性监听。
     *
     * 【为什么需要它 —— 这是第 2 轮改动的全部起因】
     * 用户拍板：**「BGM 从进入游戏就可以一直播放，不需要进入到关卡」**。
     * 而"进游戏那一刻"是**没有用户手势**的（首页是启动后自动进的），
     * 于是这里有一个死结：
     *   · 想在进游戏时就响 ⇒ 必须无手势起播 ⇒ 被 autoplay 拦；
     *   · 想借手势起播 ⇒ 最早也得等玩家点一下 ⇒ 就"晚"了。
     *
     * 上一轮是这么处理这个死结的：干脆把起播点挪进对局页（点关卡节点时，
     * 天然在手势栈内）。代价是"菜单和地图页没音乐"，用户不满意。
     *
     * 这一轮的取法是**把两件事拆开**：
     *   · "想要 BGM"这个**意图**在 `GameRoot.start()` 里就置上（越早越好）；
     *   · 真正发 `play()` 的**时机**挂在这里 —— 玩家第一次触摸屏幕。
     * 玩家进游戏必然要摸屏幕（点开始、点关卡），所以这一步**几乎立刻就会发生**，
     * 而且 Cocos 的 input 回调跑在原生事件的调用栈里，**天然是用户手势** ✅。
     *
     * ⚠️ 别改成"延迟 1 秒再播"之类的兜底：那时已经出栈了，一样会被拦。
     */
    private static hookFirstGesture(): void {
        if (this._gestureHooked) return;
        this._gestureHooked = true;

        const onGesture = (): void => {
            this.tryStartBgm();
            // 真的响了才解绑；没响（资源还没加载好 / 仍被拦）就继续等下一次手势。
            if (!this._bgmStarted) return;
            input.off(Input.EventType.TOUCH_START, onGesture);
            input.off(Input.EventType.MOUSE_DOWN, onGesture);
        };
        input.on(Input.EventType.TOUCH_START, onGesture);
        input.on(Input.EventType.MOUSE_DOWN, onGesture);
    }

    /**
     * 钉死"跟随系统静音键"这个行为。
     *
     * 【为什么只写一行、而且行为不变】
     * 微信 `wx.setInnerAudioOption` 的 `obeyMuteSwitch` **默认就是 true** ——
     * "开静音拨杆 → 游戏静音"本来就已满足，这一行不改变任何行为。
     * 那为什么还要写：把这个**意图**写进代码。将来换引擎版本 / 运行环境时，
     * 默认值一旦漂移，这里会立刻暴露成一次"声音行为异常"，
     * 而不是一次没人发现的静默变化。
     *
     * ⚠️ 只在微信环境调用；它是锦上添花，绝不该有能力把启动搞崩 —— 故包 try/catch。
     */
    private static pinMuteSwitch(): void {
        const api = (globalThis as {
            wx?: { setInnerAudioOption?: (o: Record<string, unknown>) => void };
        }).wx;
        if (!api || typeof api.setInnerAudioOption !== 'function') return;
        try {
            api.setInnerAudioOption({ obeyMuteSwitch: true });
        } catch (e) {
            warn(`[AudioService] setInnerAudioOption 调用失败（不影响玩法）：${String(e)}`);
        }
    }

    /** 预加载全部音效 + BGM。失败的单个资源只告警，不影响其它资源 */
    private static preload(): void {
        if (this._loaded) return;
        this._loaded = true;

        for (const id of ALL_SFX) {
            // 相对 assets/resources：assets/resources/audio/tap.m4a → 'audio/tap'
            resources.load(`audio/${id}`, AudioClip, (err, clip) => {
                if (err || !clip) {
                    warn(`[AudioService] 音效加载失败：${id}（${err ? String(err) : '空资源'}）`);
                    return;
                }
                this._clips[id] = clip;
                this._readyCount++;
                // 全部就绪时打一条日志。命令行无头验证看不到调试器，
                // 这一行是"音频到底加载成功没有"的唯一线索。
                if (this._readyCount === ALL_SFX.length) {
                    log(`[AudioService] 音效就绪 ${this._readyCount}/${ALL_SFX.length}`);
                }
            });
        }

        // BGM 单独打一条日志：它 263K，是最大的一个音频资源，
        // 加载失败的后果也最明显（整局没音乐）。混在"音效就绪 13/13"里看不出来。
        resources.load(BGM_PATH, AudioClip, (err, clip) => {
            if (err || !clip) {
                warn(`[AudioService] BGM 加载失败：${BGM_PATH}（${err ? String(err) : '空资源'}）`);
                return;
            }
            this._bgmClip = clip;
            log(`[AudioService] BGM 就绪：${BGM_PATH}（${clip.getDuration().toFixed(1)}s）`);
            // 资源到位时补试一次（微信里通常到此就能起播；浏览器会拦，
            // 那就等下一次点击"借势"）。
            this.tryStartBgm();
        });
    }

    // --------------------------------------------------------
    //  播放
    // --------------------------------------------------------

    /**
     * 播一个音效。**永远不抛异常** —— 音效挂掉不该影响玩法。
     *
     * @param id   音效 id
     * @param opts 音量 / 节流 / 延后
     */
    public static play(id: SfxId, opts: PlayOpts = {}): void {
        if (!CFG.AUDIO.ENABLED || this._muted) return;

        // ★【借手势】BGM 的首次起播必须落在用户手势栈里。
        //   音效 100% 由点击触发，所以"玩家点下的这一下"就是天然的时机。
        this.tryStartBgm();

        const clip = this._clips[id];
        // 还没加载好 → 静默跳过（理由见文件头：补播比少一声更糟）
        if (!clip) return;

        const delay = opts.delayMs ?? 0;
        if (delay > 0) {
            this._delayIds.push(setTimeout(() => this.emit(id, clip, opts),
                delay) as unknown as number);
            return;
        }
        this.emit(id, clip, opts);
    }

    /** 真正往声道上打（play 的尾巴，延后播与立即播共用） */
    private static emit(id: SfxId, clip: AudioClip, opts: PlayOpts): void {
        if (!CFG.AUDIO.ENABLED || this._muted) return;

        // 节流：同一个音效短时间内只响一次
        const gap = opts.gapMs ?? (id === 'bead' ? BEAD_GAP_MS : CFG.AUDIO.MIN_GAP_MS);
        const now = Date.now();
        if (now - (this._lastAt[id] ?? -1e9) < gap) return;
        this._lastAt[id] = now;

        const src = this.pickVoice();
        if (!src) return;

        const perGain = CFG.AUDIO.GAIN[id] ?? 1;
        src.stop();                                   // 抢到的是最老的一条，先掐断它
        src.clip = clip;
        src.volume = Math.max(0, Math.min(1, CFG.AUDIO.MASTER * perGain * (opts.gain ?? 1)));
        src.play();
    }

    /**
     * 挑一条声道：优先空闲的；全忙则按轮转抢占（最久没被用过的那条）。
     * 抢占是有意的：宁可掐掉一个 400ms 前的音效尾巴，也不能让当前的点击没声音。
     */
    private static pickVoice(): AudioSource | null {
        const n = this._voices.length;
        if (n === 0) return null;
        for (let i = 0; i < n; i++) {
            const idx = (this._rr + i) % n;
            const v = this._voices[idx];
            if (v && v.isValid && !v.playing) {
                this._rr = (idx + 1) % n;
                return v;
            }
        }
        const v = this._voices[this._rr];
        this._rr = (this._rr + 1) % n;
        return (v && v.isValid) ? v : null;
    }

    // --------------------------------------------------------
    //  BGM
    // --------------------------------------------------------

    /**
     * 请求播放 BGM（**幂等**，重复调用安全，已在播则什么都不做）。
     *
     * ★【调用点必须在用户手势的调用栈里】本作落在各页面的 `onCreate`
     *   （PageManager.goto 全同步 ⇒ 天然在栈内）。
     *   ⚠️ 绝不要挪进任何 `.then()` / `setTimeout` —— 那就出栈了。
     *
     * 【为什么"想要"（_bgmWanted）与"已发过 play"（_bgmStarted）要分成两个状态】
     *   资源是异步加载的。玩家完全可能在 BGM 还没就绪时就进了对局页 ——
     *   正确做法是**记住这个意图**，等资源到位或下一次点击时补上；
     *   而不是"没就绪就放弃，以后也不播了"。
     */
    public static playBgm(): void {
        if (!CFG.AUDIO.ENABLED || !CFG.AUDIO.BGM_ENABLED) return;
        // 先取消进行中的淡出：否则淡出链路末尾那句 stop() 会把刚起的 BGM 掐掉
        // （快速"回菜单 → 又进游戏"时最容易踩到）
        this.cancelFade();
        this._bgmWanted = true;
        this.tryStartBgm();
    }

    /** 请求停止 BGM（带淡出）。语义是"业务侧不再需要 BGM"，会清掉 _bgmWanted */
    public static stopBgm(): void {
        this._bgmWanted = false;
        clearTimeout(this._bgmProbeId);      // 别让一次过期的复查把后续起播误判成"被拦"

        const src = this._bgm;
        if (!src || !src.isValid || !this._bgmStarted) return;

        const total = Math.max(0, CFG.AUDIO.BGM_FADE_MS);
        this.cancelFade();
        if (total <= 0) {
            src.stop();
            src.volume = 0;
            this._bgmStarted = false;
            return;
        }

        const from = src.volume;
        const steps = 6;
        const stepMs = Math.max(16, Math.round(total / steps));
        for (let i = 1; i <= steps; i++) {
            const k = i / steps;
            this._bgmFadeIds.push(setTimeout(() => {
                if (!src.isValid || !this._bgmStarted) return;
                src.volume = i === steps ? 0 : from * (1 - k);
            }, stepMs * i) as unknown as number);
        }
        // 兜底：无论淡出链路有没有被打断，到点必须真的停下来。
        // 铁律同 PageManager —— 状态流转走"必然执行"的路径，动效只负责好看。
        this._bgmFadeIds.push(setTimeout(() => {
            if (!src.isValid || !this._bgmStarted) return;
            src.stop();
            src.volume = 0;
            this._bgmStarted = false;
        }, total + 140) as unknown as number);
    }

    /** 真正把 play() 发出去。资源未就绪 / 已静音 / 已在播 都会安静返回 */
    private static tryStartBgm(): void {
        if (!this._bgmWanted) return;

        const src = this._bgm;
        if (!src || !src.isValid) return;

        // 已在播：只把音量校正回该有的位置。
        // 这一条是"选关 ↔ 局内来回切不重启音乐"的关键 ——
        // 每次进页面都从头重播的话，音乐会不停从第 0 秒开始，非常廉价。
        if (this._bgmStarted) {
            if (!this._muted) src.volume = this.bgmVolume();
            return;
        }

        if (this._muted || !this._bgmClip) return;   // 还没就绪：等"借势"

        this._bgmStarted = true;
        this.cancelFade();
        src.stop();                 // 清掉可能残留的播放态，保证从第 0 秒干净开始
        src.clip = this._bgmClip;
        src.loop = true;            // 循环由 AudioSource 维持，不靠监听结束事件
        src.volume = this.bgmVolume();
        src.play();
        log(`[AudioService] BGM 起播（${this._bgmClip.getDuration().toFixed(1)}s 循环）`);
        // ★ 起播后**必须**复查一次 —— 见 probeBgm 的注释。
        //   少了这一步，"被 autoplay 拦下"会变成"整局永远不响"。
        this.probeBgm();
    }

    /**
     * 起播后 600ms 复查：这声 play() **到底响没响**。
     *
     * 【为什么非查不可】
     * autoplay 拦截是**静默的**：`play()` 不抛异常、不返回失败，日志也全绿，
     * 表现只有"没声音"。而本类在发 play() 的同时就把 `_bgmStarted` 置真了，
     * 于是之后每次 `tryStartBgm()` 都以为"已经起过了"，只校音量就返回 ——
     * **再也不会重试**。一次拦截 ⇒ 整局没音乐，且没有任何线索。
     * （上一轮就栽在这里：日志写着 `[AudioService] BGM 起播`，
     *   同一份日志里还躺着浏览器的 "AudioContext was not allowed to start"。）
     *
     * 所以这里做一次"事后验尸"：真在播就算了；没在播就把状态**复位**，
     * 允许下一次手势（hookFirstGesture / 任何一次音效 play）再试一次。
     */
    private static probeBgm(): void {
        clearTimeout(this._bgmProbeId);
        this._bgmProbeId = setTimeout(() => {
            const src = this._bgm;
            // 期间被 stopBgm / setMuted 掐掉过 —— 那是"有意停"，不是被拦
            if (!this._bgmStarted || !src || !src.isValid) return;
            if (src.playing || src.currentTime > 0.01) return;      // 真的在响 ✅
            this._bgmStarted = false;
            log('[AudioService] BGM 首播未生效（多半被 autoplay 拦了）—— 已复位，'
                + '等下一次触摸重试');
        }, 600) as unknown as number;
    }

    /** BGM 该有的音量（MASTER × BGM_GAIN，夹到 0~1） */
    private static bgmVolume(): number {
        return Math.max(0, Math.min(1, CFG.AUDIO.MASTER * CFG.AUDIO.BGM_GAIN));
    }

    /** 清掉淡出链路上的定时器（不动 _bgmStarted，那由 tryStartBgm / stopBgm 决定） */
    private static cancelFade(): void {
        for (const id of this._bgmFadeIds) clearTimeout(id);
        this._bgmFadeIds.length = 0;
    }

    /** 仅供测试/排查：BGM 是否已经起播 */
    public static get bgmPlaying(): boolean {
        return this._bgmStarted;
    }

    // --------------------------------------------------------
    //  静音（对局页顶栏小喇叭）
    // --------------------------------------------------------

    public static get muted(): boolean { return this._muted; }

    /**
     * 静音。会立刻掐断所有正在播的声音，而不是等它们播完。
     * 设置会被记住（独立存储键，理由见 CFG.SAVE.AUDIO_KEY）。
     */
    public static setMuted(m: boolean): void {
        this._muted = m;
        this.writeMuted(m);

        const bgm = this._bgm;
        if (m) {
            // 静音这个动作本身就该是**即时**的 —— 此时再给 BGM 做淡出，
            // 玩家会觉得"我按了静音它还在响"。所以这里硬停。
            for (const v of this._voices) {
                if (v && v.isValid && v.playing) v.stop();
            }
            for (const id of this._delayIds) clearTimeout(id);
            this._delayIds.length = 0;
            this.cancelFade();
            if (bgm && bgm.isValid) {
                bgm.stop();
                bgm.volume = 0;
            }
            this._bgmStarted = false;
            return;
        }

        // 取消静音：若业务侧仍然"想要 BGM"，把它接回来。
        // ⚠️ _bgmWanted 是**页面生命周期**给的意图，不因静音而丢弃 ——
        //    否则"在局内点一下静音、再取消"，BGM 就再也回不来了。
        if (bgm && bgm.isValid) bgm.volume = this.bgmVolume();
        this.tryStartBgm();
    }

    /** 返回切换**之后**的静音状态（给按钮重绘用） */
    public static toggleMuted(): boolean {
        this.setMuted(!this._muted);
        return this._muted;
    }

    // ---- 静音偏好的持久化 ----
    /**
     * 为什么用 `sys.localStorage` 而不是 core/Save：
     * Save 的存档体有 `version` 闸门（版本不符整档回空），为一个开关动它不划算。
     * 偏好与进度分家，各自独立演进（详见 CFG.SAVE.AUDIO_KEY 的注释）。
     */
    private static readMuted(): boolean {
        try {
            return sys.localStorage.getItem(CFG.SAVE.AUDIO_KEY) === '1';
        } catch { return false; }
    }

    private static writeMuted(m: boolean): void {
        try {
            sys.localStorage.setItem(CFG.SAVE.AUDIO_KEY, m ? '1' : '0');
        } catch { /* 存不下就算了，本次进程内仍然有效 */ }
    }

    /** 仅供测试/排查：当前已加载好的音效数量 */
    public static get loadedCount(): number {
        return this._readyCount;
    }
}
