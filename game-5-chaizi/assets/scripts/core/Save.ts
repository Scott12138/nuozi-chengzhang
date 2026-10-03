/**
 * ============================================================
 *  Save.ts · 存档（浏览器 / 微信小游戏 / 无存储环境三态兼容）
 * ============================================================
 *  【为什么不用 cc.sys.localStorage】
 *  可以用，但那样 core/ 就 import 了 'cc'，整个目录就不能再用 node 单测了
 *  （见 Types.ts 的说明）。而这里真正需要的只是"一个能读写的键值对"，
 *  直接摸 globalThis 上的 wx / localStorage 即可，三行适配就够。
 *
 *  【为什么要有第三态（内存兜底）】
 *  ① node 下跑单测时没有 localStorage，不能因此崩掉；
 *  ② 微信里首次进入、或用户清了缓存，读出来是空串 —— 必须退回默认档
 *     而不是抛异常。存档坏了导致游戏进不去，是最不划算的一种失败。
 * ============================================================
 */

import { CFG } from '../CFG';
import { ClearResult } from './Types';

export interface SaveData {
    version: number;
    /** 已通关的关号 */
    cleared: number[];
    /** 关号 → 星级（1~3） */
    stars: Record<number, number>;
    /** 关号 → 最短通关用时（秒），仅作记录 */
    bestTime: Record<number, number>;
    /** 已合成过的字（图鉴用） */
    litWords: Record<string, 1>;
}

const VERSION = 1;

function blank(): SaveData {
    return { version: VERSION, cleared: [], stars: {}, bestTime: {}, litWords: {} };
}

/** 拿出来用的一句"最底层存储"，找不到就返回 null */
function backend(): { get(k: string): string | null; set(k: string, v: string): void } | null {
    const g = globalThis as unknown as Record<string, any>;
    try {
        const wx = g.wx;
        if (wx && typeof wx.setStorageSync === 'function' && typeof wx.getStorageSync === 'function') {
            return {
                get: (k) => {
                    const v = wx.getStorageSync(k);
                    return typeof v === 'string' && v ? v : null;
                },
                set: (k, v) => wx.setStorageSync(k, v),
            };
        }
    } catch { /* 落到下一档 */ }
    try {
        const ls = g.localStorage;
        if (ls && typeof ls.setItem === 'function') {
            return {
                get: (k) => (typeof ls.getItem === 'function' ? ls.getItem(k) : null),
                set: (k, v) => ls.setItem(k, v),
            };
        }
    } catch { /* 落到下一档 */ }
    return null;
}

/** 内存兜底：进程内有效，够单测与"存储不可用"时跑完一局 */
let _mem: SaveData | null = null;

export class Save {

    private static _data: SaveData | null = null;

    /** 读档。任何异常 / 空档 / 版本不符 → 返回全新档，绝不抛 */
    static load(): SaveData {
        if (this._data) return this._data;
        const bd = backend();
        if (!bd) {
            this._data = _mem ? { ..._mem } : blank();
            return this._data;
        }
        let raw: string | null = null;
        try { raw = bd.get(CFG.SAVE.KEY); } catch { raw = null; }
        if (!raw) {
            this._data = blank();
            return this._data;
        }
        try {
            const o = JSON.parse(raw) as Partial<SaveData>;
            const d = blank();
            if (o && o.version === VERSION) {
                if (Array.isArray(o.cleared)) d.cleared = o.cleared.filter((n) => typeof n === 'number');
                if (o.stars && typeof o.stars === 'object') d.stars = { ...o.stars } as Record<number, number>;
                if (o.bestTime && typeof o.bestTime === 'object') d.bestTime = { ...o.bestTime } as Record<number, number>;
                if (o.litWords && typeof o.litWords === 'object') d.litWords = { ...o.litWords } as Record<string, 1>;
            }
            this._data = d;
        } catch {
            // 存档损坏：**不要**清掉它（可能是版本兼容问题，清了就回不去），
            // 只是本次用空档跑，下一次 save() 会用新格式覆盖。
            this._data = blank();
        }
        return this._data;
    }

    static save(): void {
        const d = this._data || this.load();
        const bd = backend();
        if (!bd) { _mem = { ...d }; return; }
        try { bd.set(CFG.SAVE.KEY, JSON.stringify(d)); } catch { _mem = { ...d }; }
    }

    /** 测试与"清档"用 */
    static reset(): void {
        this._data = blank();
        _mem = null;
        this.save();
    }

    // ---------- 查询 ----------
    static stars(level: number): number {
        return this.load().stars[level] || 0;
    }

    static isCleared(level: number): boolean {
        return this.load().cleared.indexOf(level) >= 0;
    }

    /**
     * 关卡是否已解锁。
     * 规则：第 1 关永远开放；其余需要**上一关已通关**。
     * ★ 不用"上一关星级 > 0"来判断 —— 星级可以是 0（未来若有"0 星也算过关"的设计），
     *   而 cleared 是明确的过/没过，语义不重叠。
     */
    static isUnlocked(level: number): boolean {
        if (level <= 1) return true;
        return this.isCleared(level - 1);
    }

    /** 该章是否已解锁（章 i 要求上一章最后一关已通关） */
    static isChapterUnlocked(ch: number, lastLevelOfPrevChapter: number): boolean {
        if (ch <= 1) return true;
        return this.isCleared(lastLevelOfPrevChapter);
    }

    static totalStars(): number {
        const s = this.load().stars;
        let n = 0;
        for (const k in s) n += s[k] || 0;
        return n;
    }

    static litCount(): number {
        return Object.keys(this.load().litWords).length;
    }

    /** 已通关的关数（首页「已通关」那一格） */
    static clearedCount(): number {
        return this.load().cleared.length;
    }

    // ---------- 写入 ----------
    /** 通关。星级取历史最好，避免"重打一次拿 1 星把 3 星顶掉" */
    static recordClear(r: ClearResult): void {
        const d = this.load();
        if (d.cleared.indexOf(r.level) < 0) d.cleared.push(r.level);
        const old = d.stars[r.level] || 0;
        if (r.stars > old) d.stars[r.level] = r.stars;
        const spent = Math.round(r.totalSec - r.leftSec);
        const bt = d.bestTime[r.level];
        if (bt === undefined || spent < bt) d.bestTime[r.level] = spent;
        for (const rw of r.runWords) if (rw.got > 0) d.litWords[rw.w] = 1;
        this.save();
    }
}
