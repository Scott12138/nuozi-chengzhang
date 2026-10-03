/**
 * ============================================================
 *  Rng.ts · 可复现的伪随机
 * ============================================================
 *  【为什么不用 Math.random】
 *  同一个种子必须每次跑出**完全一样的盘面**。两个直接收益：
 *    ① 自测脚本（tools/core-selftest.mjs）能对固定盘面断言"这一步该消哪个"，
 *       而不是每次重新猜；
 *    ② 真机上手感不对时，可以把种子报出来，在同一盘面上复现。
 *  Math.random 做不到上面任何一条 —— 它连"再跑一次刚才那盘"都不行。
 *
 *  算法用 mulberry32：32 位状态、一行实现、分布够均匀，
 *  比 LCG 好得多（LCG 低位周期极短，做格点采样会看出规律）。
 * ============================================================
 */

export class Rng {

    private _s: number;

    constructor(seed: number) {
        // 保证非零有限整数，否则某些种子会让状态卡在 0 上不动
        this._s = (Math.floor(seed) >>> 0) || 0x9e3779b9;
    }

    /** 全局共享实例：不给种子的地方用它（例如"重排"道具），需要复现时再单开 */
    static shared = new Rng(Date.now() & 0x7fffffff);

    /** [0, 1) */
    next(): number {
        this._s = (this._s + 0x6d2b79f5) >>> 0;
        let t = this._s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    /** [lo, hi) 的整数 */
    int(lo: number, hi: number): number {
        return lo + Math.floor(this.next() * (hi - lo));
    }

    /** 原地 Fisher-Yates 洗牌（返回同一数组，方便链式） */
    shuffle<T>(a: T[]): T[] {
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(this.next() * (i + 1));
            const t = a[i]; a[i] = a[j]; a[j] = t;
        }
        return a;
    }

    /** 不改原数组的洗牌 */
    shuffled<T>(a: readonly T[]): T[] {
        return this.shuffle(a.slice());
    }
}

/**
 * 由「关号 + 时间戳」造种子。
 * ⚠️ 不要用 `n * 1000 + Date.now() % 1000` 这类写法：
 *   Date.now() 的低位在连续调用时几乎不变，会导致连开两局拿到同一盘面。
 */
export function seedFrom(level: number): number {
    return ((Date.now() & 0xffff) * 65537 + level * 2654435761) >>> 0;
}
