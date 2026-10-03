/**
 * ============================================================
 *  TileAtlas.ts · 牌面贴图的加载与缓存（按章 Bundle 路由）
 * ============================================================
 *  贴图放在 `assets/<bundle>/tiles/` 下，文件名是码位（t_67aa.png），
 *  由 tools/make-tile-atlas.py 烘出、TileManifest.ts 给出映射。
 *
 *  【★ 为什么有"按章 Bundle"这一层】
 *  128px × 248 张字形贴图 ≈ 4.6MB，**单包放不下**（微信小游戏主包 ≤ 4MB 硬红线）。
 *  所以 2026-10-03 拍板「128px + 按章分包」：
 *    第 1 章 → 内置 `resources`（= 主包，开箱即用）
 *    第 2~4 章 → 自定义 bundle `ch02` / `ch03` / `ch04`（构建时压缩类型 subpackage，
 *                即微信小游戏分包，进这一章前下载）
 *  `TileManifest.TILE_CHAPTER` 说"这个字属于哪一章"，
 *  `TileManifest.CHAPTER_BUNDLE` 说"那一章的图在哪个 bundle、什么前缀" —— 本文件是它们唯一的消费者。
 *
 *  ⚠️ **这一层不做会怎样**：第 2 章起所有牌面都是空的，而 `resources.load` 是**失败回调**，
 *     日志里只有一行 warn —— 表现是"棋盘上一片空白、游戏照跑"。
 *     这正是「解封关卡到 38」必须同时做本文件的原因。
 *
 *  【为什么自己写一层缓存，而不是每张牌各自 load】
 *  同一关里「木」会出现 8~10 次。每次建牌都发一次 load：
 *    ① 微信下会重复走一遍文件 IO；
 *    ② 更要命的是加载是异步的 —— 同一张贴图会有 N 个回调，
 *      而回调里 setContentSize 的时序不同，牌会出现"先小后大"的跳动。
 *  所以：**同一名字只发一次请求，其余挂到等待队列**，一次性回调给所有等待者。
 *
 *  【为什么失败也要回调（而不是静默）】
 *  缺一张贴图 = 棋盘上一个洞，而它是**不报错的**。
 *  必须打日志说清是哪个文件名（据此能反查是哪个字），否则只能靠肉眼数牌。
 * ============================================================
 */

import { assetManager, AssetManager, resources, SpriteFrame, warn } from 'cc';
import { CHAPTER_BUNDLE, JUNK_TEX, TILE_CHAPTER, TILE_TEX } from '../TileManifest';

const PREFIX = 'tiles/';

const _cache: Record<string, SpriteFrame> = {};
const _waiting: Record<string, ((sf: SpriteFrame | null) => void)[]> = {};
const _loading: Record<string, boolean> = {};

/** 已就绪的自定义 bundle（章号 → Bundle） */
const _bundles: Record<number, AssetManager.Bundle> = {};
/** 正在加载中的自定义 bundle（章号 → Promise），防止并发重复 loadBundle */
const _bundlePending: Record<number, Promise<boolean>> = {};

// ---------------------------------------------------------------- 基础队列

/** 命中缓存就同步回调；否则挂进等待队列。返回已缓存的那张（没有则 null） */
function _queue(key: string, cb?: (sf: SpriteFrame | null) => void): SpriteFrame | null {
    const got = _cache[key];
    if (got) {
        if (cb) cb(got);
        return got;
    }
    if (cb) {
        if (!_waiting[key]) _waiting[key] = [];
        _waiting[key].push(cb);
    }
    return null;
}

/** 请求结束（成功或失败）：唤醒所有等待者 */
function _settle(key: string, sf: SpriteFrame | null): void {
    const list = _waiting[key] || [];
    delete _waiting[key];
    if (sf) _cache[key] = sf;
    for (const f of list) f(sf);
}

/** 拿已缓存的（没加载好就是 null，此时应去调 loadSprite） */
export function cached(name: string): SpriteFrame | null {
    return _cache[name] || null;
}

// ---------------------------------------------------------------- 章 Bundle

/** 某一章的贴图是否**现在就能同步取到**（第 1 章恒为 true） */
export function isChapterReady(ch: number): boolean {
    const cfg = CHAPTER_BUNDLE[ch] || CHAPTER_BUNDLE[1];
    return cfg.bundle === 'resources' || !!_bundles[ch];
}

/**
 * 确保某一章的 bundle 已加载。第 1 章（内置 resources）立即 resolve。
 *
 * ★ 并发安全：同一章同时被多处调用只发一次 `loadBundle`，其余挂到同一个 Promise。
 *   不这样做的话，"进关时预热" + "地图页预拉" 撞上就是两次下载同一个分包。
 * ★ 失败也 resolve(false)，**不 reject** —— 调用方要继续把"这一关的牌面缺图"
 *   这件事走完（棋盘还是要画出来，只是没图），而不是让整页崩掉。
 */
export function ensureChapter(ch: number): Promise<boolean> {
    const cfg = CHAPTER_BUNDLE[ch] || CHAPTER_BUNDLE[1];
    if (cfg.bundle === 'resources') return Promise.resolve(true);
    if (_bundles[ch]) return Promise.resolve(true);
    if (_bundlePending[ch]) return _bundlePending[ch];

    const p = new Promise<boolean>((resolve) => {
        assetManager.loadBundle(cfg.bundle, (err, bundle) => {
            delete _bundlePending[ch];
            if (err || !bundle) {
                warn(`[TileAtlas] 第 ${ch} 章的贴图分包（${cfg.bundle}）加载失败，`
                    + `这一章的牌面会缺图`, err);
                resolve(false);
                return;
            }
            _bundles[ch] = bundle;
            resolve(true);
        });
    });
    _bundlePending[ch] = p;
    return p;
}

/**
 * 预拉某一章的贴图分包（不阻塞、不关心结果）。
 * 地图页/章节页在玩家**还没进关**时调它，等真进关时就已经在本地了 ——
 * 相当于 `wx.preloadSubpackage`，但走 Cocos 的 `loadBundle`，
 * 因此 web / 原生 / 微信三个平台行为一致（不依赖 wx API 是否存在）。
 */
export function prefetchChapter(ch: number): void {
    ensureChapter(ch).catch(() => { /* 预拉失败无所谓，进关时还会再试一次 */ });
}

// ---------------------------------------------------------------- 取图

/**
 * 取一张贴图。
 *
 * @param path **resources/ 下的相对路径、不带扩展名**，
 *             例：`'tiles/t_67aa'`（牌面）、`'ui/lock'`（UI 图标）
 * @param cb   贴图就绪时回调；若已缓存则**同步**回调
 * @returns 已缓存则直接返回，否则返回 null（并已排好加载）
 *
 * ★ 只走**内置 resources**。牌面请用 `loadTileIn` / `loadTileByChar`
 *   —— 第 2~4 章的图不在 resources 里，用本函数取必然失败（且只是 warn，不报错）。
 */
export function loadSprite(path: string, cb?: (sf: SpriteFrame | null) => void): SpriteFrame | null {
    const got = _queue(path, cb);
    if (got) return got;
    if (_loading[path]) return null;
    _loading[path] = true;
    resources.load(path + '/spriteFrame', SpriteFrame, (err, sf) => {
        delete _loading[path];
        if (err || !sf) {
            // 不 throw：缺一张牌不该让整个对局崩掉。但要留下可反查的日志。
            warn(`[TileAtlas] 贴图加载失败：${path}（画面上会缺这一张）`, err);
            _settle(path, null);
            return;
        }
        _settle(path, sf);
    });
    return null;
}

/**
 * 取一张**指定章**的牌面贴图。
 *
 * @param ch   章号（1~4）。bundle 还没就绪时会自动排一次加载，
 *             加载完再把这次请求补上（调用方的 cb 不会被丢）。
 * @param name TileManifest 里的文件名（如 't_67aa'）
 */
export function loadTileIn(ch: number, name: string, cb?: (sf: SpriteFrame | null) => void): SpriteFrame | null {
    if (!name) {
        if (cb) cb(null);
        return null;
    }
    const cfg = CHAPTER_BUNDLE[ch] || CHAPTER_BUNDLE[1];
    const path = cfg.prefix + '/' + name;

    // 第 1 章：就在内置 resources 里
    if (cfg.bundle === 'resources') return loadSprite(path, cb);

    const b = _bundles[ch];
    if (!b) {
        // ⚠️ 不能在这里直接返回 null 了事 —— 那会把 cb 吞掉，
        //    调用方（建牌）永远等不到回调，牌面就永久空着。
        ensureChapter(ch).then((ok) => {
            if (!ok) {
                warn(`[TileAtlas] 第 ${ch} 章分包不可用，跳过 ${name}`);
                if (cb) cb(null);
                return;
            }
            loadTileIn(ch, name, cb);
        });
        return null;
    }

    // ★ 缓存键带 bundle 名：各章的 prefix 都是 `tiles/`，
    //   不带 bundle 名的话 `木`（ch1）与 `氵`（ch2）会撞在同一个键上 ——
    //   而"撞键"的表现是**某张牌显示成另一个字**，不报错。
    const key = cfg.bundle + '/' + path;
    const got = _queue(key, cb);
    if (got) return got;
    if (_loading[key]) return null;
    _loading[key] = true;
    b.load(path + '/spriteFrame', SpriteFrame, (err, sf) => {
        delete _loading[key];
        if (err || !sf) {
            warn(`[TileAtlas] 第 ${ch} 章贴图加载失败：${cfg.bundle}/${path}（画面上会缺这一张）`, err);
            _settle(key, null);
            return;
        }
        _settle(key, sf);
    });
    return null;
}

/**
 * 取一张牌面的贴图（自动路由到该字所属章的 bundle）。
 *
 * @param ch   牌面字（宝牌传展示名即可，它走 `tex`）
 * @param kind 牌的种类（`treasure` 的图恒在主包）
 * @param tex  宝牌贴图键（见 `core/Treasure.ts`）；普通牌不传
 */
export function loadTileByChar(
    ch: string, kind: string, tex?: string,
    cb?: (sf: SpriteFrame | null) => void,
): SpriteFrame | null {
    const name = texNameOf(ch, kind, tex);
    if (!name) {
        if (cb) cb(null);
        return null;
    }
    // 宝牌（8 张）与 UI 图标一样住在主包：它跨章共用，塞进任何一章的分包都不对。
    if (kind === 'treasure') return loadTileIn(1, name, cb);
    return loadTileIn(TILE_CHAPTER[ch] || 1, name, cb);
}

/**
 * 取一张牌面的贴图（**主包专用**，等价于 `loadTileIn(1, ...)`）。
 * 保留它是因为宝牌贴图与 UI 图标都走这里，语义比 `loadSprite('tiles/'+name)` 清楚。
 * ⚠️ 普通牌不要用它 —— 第 2 章起会静默缺图。
 */
export function loadTile(name: string, cb?: (sf: SpriteFrame | null) => void): SpriteFrame | null {
    return loadTileIn(1, name, cb);
}

/**
 * 一张牌 → 贴图文件名。
 *
 * ★ 宝牌走 `tex` 字段**而不是** `char`：宝牌的 char 是给玩家看的展示名
 *   （「铁砧」），而贴图按「章 + 第几件」区分（第 2 章的「花瓶」不在第 1 章出现）。
 *   两者混用会出现"第四章的陶罐显示成铁砧"这种**不报错**的错位。
 *
 * @param tex 宝牌贴图键（见 `core/Treasure.ts`）；普通牌不传
 */
export function texNameOf(ch: string, kind: string, tex?: string): string {
    // ★ 宝牌没有兜底：`tex` 缺失时返回空串（→ 一张空牌）。这是**故意的** ——
    //   退到 TILE_TEX[ch] 会拿"铁砧"两个字去查字牌表，必然查不到，
    //   最后仍然是一张空牌，却把"谁漏了 tex"这条线索藏起来了。
    if (kind === 'treasure') return tex || '';
    if (kind === 'junk') return JUNK_TEX[ch] || TILE_TEX[ch] || '';
    return TILE_TEX[ch] || JUNK_TEX[ch] || '';
}

/** 一张牌需要什么贴图（`preloadTiles` 的入参形状，避免调用方去拼文件名） */
export interface TileRef {
    char: string;
    kind: string;
    tex?: string;
}

/**
 * 一关的牌面会用到**哪些章的 bundle**。
 *
 * ★★ 为什么不是"这一关属于哪一章"这么简单：
 *   `tools/gen-cocos-leveldata.js` 里有一条归属规则 ——「跨章出现的字，
 *   按**最早使用它的那一章**归档」，于是后面的章复用前面 bundle 里的那张。
 *   实测：**38 关里有 30 关跨章**（L17 起同时要第 1、2 章的 bundle，L29 起要 1/2/3）。
 *   只 ensure 本关那一章的话，跨过来的那些字会在建牌时才现场加载 →
 *   牌面**晚一拍才出现**（在"合成字化开""器物显形"这种瞬时演出上就是一片空）。
 *
 * @param levelCh 这一关属于哪一章（即使它的图全来自别的章，也要把它算进去）
 */
export function chaptersOf(refs: readonly TileRef[], levelCh: number): number[] {
    const set: number[] = [levelCh];
    for (const r of refs) {
        if (r.kind === 'treasure') continue;      // 宝牌 8 张恒在主包（第 1 章那条路）
        const ch = TILE_CHAPTER[r.char] || 1;
        if (set.indexOf(ch) < 0) set.push(ch);
    }
    return set.sort((a, b) => a - b);
}

/**
 * 批量预热**一关要用的牌面**。进对局前调一次，避免开局时牌面一张张"跳出来"。
 * 返回 Promise 是为了让调用方能 await 完再开计时 —— 否则计时开始的那一刻
 * 玩家还在等贴图，等于白扣时间。
 *
 * ★ 第一步是把**涉及的每一个章**都 `ensureChapter` 一遍（下载分包）。
 *   这一步可能几百毫秒到几秒（看网络与是否已缓存），必须也算在这个 Promise 里，
 *   否则会出现"分包还没下完、预热就全失败、棋盘一片空白"。
 *
 * @param refs    这一关盘面上所有牌的 (char, kind, tex)
 * @param levelCh 这一关属于哪一章
 */
export function preloadTiles(refs: readonly TileRef[], levelCh: number): Promise<void> {
    const chs = chaptersOf(refs, levelCh);
    return Promise.all(chs.map(ensureChapter)).then(() => {
        return new Promise<void>((resolve) => {
            const jobs: { ch: number; name: string }[] = [];
            const seen: Record<string, boolean> = {};
            for (const r of refs) {
                const name = texNameOf(r.char, r.kind, r.tex);
                if (!name) continue;
                const ch = r.kind === 'treasure' ? 1 : (TILE_CHAPTER[r.char] || 1);
                const cfg = CHAPTER_BUNDLE[ch] || CHAPTER_BUNDLE[1];
                const key = cfg.bundle + '/' + name;   // ★ 键带 bundle 名，见 loadTileIn 的注释
                if (seen[key]) continue;
                seen[key] = true;
                jobs.push({ ch, name });
            }
            let left = jobs.length;
            if (left === 0) { resolve(); return; }
            for (const j of jobs) {
                loadTileIn(j.ch, j.name, () => {
                    left--;
                    if (left <= 0) resolve();   // 失败也 resolve：缺贴图不该卡住开局
                });
            }
        });
    });
}
