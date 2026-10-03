/**
 * ============================================================
 *  AdService.ts · 激励视频广告的唯一入口
 * ============================================================
 *  【它为什么必须有】
 *  玩法改成**严格回弹**之后（拖了凑不成字就滑回原位），盘面会真的走进死局。
 *  用 tools/solve-exact.js 对 38 关做过完整搜索，只有 71.9% 的局面存在通关路径。
 *  也就是说"卡住"不是玩家的错，而是**盘面自己会到的状态** —— 必须给一条出路。
 *  用户 2026-10-02 拍板：卡住就让他看广告重排。
 *
 *  【为什么包一层，而不是在页面里直接调 wx】
 *  ① 平台差异：web 端 / 无 wx 环境下 `createRewardedVideoAd` 不存在。
 *     页面里到处写 `if (wx && wx.xxx)` 会把可测性毁掉（core 单测与 web 冒烟都跑不了）。
 *  ② 微信的 `createRewardedVideoAd` 对同一个 unitId 返回的是**单例**，
 *     而 `onClose` 是**累加注册**的 —— 每次 show 都挂一次监听，
 *     第二次看广告就会回调两次（= 白送两次重排，且可能叠着弹两次 AdGate）。
 *     所以这里把它缓存起来、监听只挂一次、每次 show 换一个 pending 回调。
 *  ③ 回调可能回来时页面已经被切走/销毁 —— 统一让调用方在回调里自查节点有效性。
 *
 *  【降级策略（很重要，别当成 bug）】
 *  广告位 ID 为空（本地调试 / 首版还没申请下来）时**直接回调 success**，
 *  并在控制台打一条 warning。这样本地与 web 冒烟都能跑完整流程，
 *  而真机上没填 ID 时玩家也不会被卡死 —— "兜底把玩家卡住"比"白送一次重排"坏得多。
 *
 *  ★ 2026-10-02 拍板后的补充：**玩家可见文案里一个字都不许提广告**。
 *   降级路径过去会给玩家弹一句带 `CFG.AD.REWARD_UNIT_ID` 的提示（开发者文案外泄），
 *   已删除。现在分工是：
 *     · 玩家 —— 只看到结果（「盘面已重排」/「复活成功，时间 +30 秒」）；
 *     · 开发 —— console 的 warn（本文件）+ 启动期 error（`audit()`）；
 *     · 上线 —— 靠 `audit()` 在微信环境里把"忘了填 ID"顶成 error，不靠人记。
 * ============================================================
 */

import { error, log, warn } from 'cc';
import { CFG } from '../CFG';

export type AdResult =
    /** 看完了整段，应当发放奖励 */
    | 'rewarded'
    /** 玩家中途关掉了，不发放 */
    | 'closed'
    /** 拉取或播放失败 */
    | 'error'
    /** 没有接入广告位（ID 为空 / 非微信环境），按"直接发放"处理 */
    | 'degraded';

/** wx 全局的最小可用面（不引 @types，避免给 core/ 带进平台依赖） */
interface WxAd {
    show(): Promise<void>;
    load(): Promise<void>;
    onClose(cb: (res?: { isEnded?: boolean }) => void): void;
    onError(cb: (err: unknown) => void): void;
}
interface WxLike {
    createRewardedVideoAd?(opt: { adUnitId: string; multiton?: boolean }): WxAd;
}

export class AdService {

    /** 单例（微信侧本来就是按 unitId 单例，这里再兜一层，保证监听只挂一次） */
    private static _ad: WxAd | null = null;
    private static _adUnitId = '';
    /** 本次 show 的回调。微信的 onClose 不带"是哪一次"的上下文，只能这样配对 */
    private static _pending: ((r: AdResult) => void) | null = null;
    /** 防止"onClose 与 onError 同时来"导致回调跑两遍 */
    private static _settled = false;

    /** 当前环境能不能真的放广告（给 UI 决定文案用） */
    static get available(): boolean {
        const g = globalThis as unknown as { wx?: WxLike };
        return !!CFG.AD.REWARD_UNIT_ID && typeof g.wx?.createRewardedVideoAd === 'function';
    }

    /**
     * 启动期自检：**在微信里跑、却没配广告位** → 打一条 error。
     *
     * 【为什么必须有这道闸】
     * "忘了填 REWARD_UNIT_ID" 是一种**静默**故障：游戏一切正常、玩家照常玩、
     * 两处激励视频都降级成白送，控制台里只有一条 `warn`（很容易被淹掉）。
     * 等你想起来看收益时，可能已经白丢了很多天。所以把它提到启动期、
     * 提到 `error` 级，让命令行构建与真机 vConsole 第一眼就能看到。
     *
     * 【为什么用 error 而不是直接抛】
     * 它不影响任何玩法 —— 抛异常会让整个游戏起不来，把"少赚点钱"变成"玩不了"。
     *
     * 【为什么 web 端不报】
     * 无头冒烟与本地预览都跑在 web-desktop 上，那里**本来就没有 wx**，
     * 空串是正常状态。若不加这层判断，每次冒烟都会刷一条 error，
     * 很快就会被当成噪声忽略 —— 噪声化的告警等于没有告警。
     */
    static audit(): void {
        const g = globalThis as unknown as { wx?: WxLike };
        if (!g.wx) {
            if (CFG.DEBUG.LOG_STATE) {
                log('[AdService] 广告位自检：非微信环境（web / 本地预览），跳过');
            }
            return;
        }
        if (CFG.AD.REWARD_UNIT_ID) {
            if (CFG.DEBUG.LOG_STATE) {
                log('[AdService] 广告位自检：已配置 ✅');
            }
            return;
        }
        error('[AdService] ⛔ 微信环境里 CFG.AD.REWARD_UNIT_ID 仍是空串 —— '
            + '「死局重排」与「看视频复活」两处激励视频都会降级为**直接发放**，'
            + '玩家不看广告就能拿到奖励，流量主收益为 0。'
            + '上线前请到微信小游戏后台「推广 → 流量主 → 激励式广告」创建广告位，'
            + '把 adunit-xxxx 填进 CFG.AD.REWARD_UNIT_ID。'
            + '（注：流量主需累计独立访客 UV ≥ 1000 才能开通）');
    }

    /**
     * 拉起一次激励视频。
     * @param cb **一定会被调用一次**（含降级/失败路径），调用方不必再写兜底。
     */
    static showReward(cb: (r: AdResult) => void): void {
        const g = globalThis as unknown as { wx?: WxLike };
        const unitId = CFG.AD.REWARD_UNIT_ID;

        // ---- 降级路径：没配广告位，或不在微信里 ----
        if (!unitId || typeof g.wx?.createRewardedVideoAd !== 'function') {
            warn('[AdService] 未接入激励视频（CFG.AD.REWARD_UNIT_ID 为空 / 非微信环境）→ 直接发放');
            cb('degraded');
            return;
        }

        // ---- 首次：建实例 + 挂一次监听 ----
        if (!this._ad || this._adUnitId !== unitId) {
            this._ad = g.wx.createRewardedVideoAd({ adUnitId: unitId });
            this._adUnitId = unitId;
            this._ad.onClose((res) => {
                const ended = !!(res && res.isEnded);
                log(`[AdService] onClose isEnded=${ended}`);
                this.settle(ended ? 'rewarded' : 'closed');
            });
            this._ad.onError((err) => {
                warn('[AdService] onError：' + String(err));
                this.settle('error');
            });
        }

        this._pending = cb;
        this._settled = false;

        // show() 在"还没拉取到素材"时会 reject → 补一次 load() 再 show()
        this._ad.show().catch(() => {
            this._ad!.load()
                .then(() => this._ad!.show())
                .catch((e) => {
                    warn('[AdService] load/show 均失败：' + String(e));
                    this.settle('error');
                });
        });
    }

    /** 回调只跑一次；跑完清掉 pending，避免旧的 onClose 打到新的 show 上 */
    private static settle(r: AdResult): void {
        if (this._settled) return;
        this._settled = true;
        const cb = this._pending;
        this._pending = null;
        if (cb) cb(r);
    }
}
