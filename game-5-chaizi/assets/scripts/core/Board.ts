/**
 * ============================================================
 *  Board.ts · 玩法规则的唯一真源
 * ============================================================
 *  本作的四条规则，全部在这一个文件里，别处不许再实现一遍：
 *    ① **只能沿本行 / 本列滑动**（`slideRange`）
 *    ② **前方连着的牌会被一起推着走**，整段像一列珠子平移，直到段尾顶到墙或另一张牌
 *       （`slideRange` 的 `_reach` 就是全部）
 *    ③ **一偏旁 + 一部件，同行或同列且中间无牌** → 合成（`matchTargets`）
 *    ④ **落位凑不成字 → 整段沿原路弹回**（严格回弹，由调用方 `Board.undoDrag` 实现）
 *
 *  【为什么这四条必须收在一起 —— 上一版真踩过】
 *  原型里"拖动限制 / 提示 / 死局检测 / 自动演示"各写了一套判定，
 *  结果提示给出的走法玩家**拖不过去**（提示认为是空的，拖动那里认为被挡），
 *  而且死局检测还会误判"明明有解却说没解"。
 *  现在 reachableCells / findSuggest / 拖动 全都从 slideRange 出，
 *  物理上不可能再打架。
 *
 *  【★ 2026-10-03：规则②从"撞到牌就停"改成"可以推"】
 *  用户拍板：「把每次允许推着相邻的格子一起动」——
 *  奴 往右推，右邻的 革 跟着走一格，奴 落到 革 原来的位置，
 *  正好与下面同列的 弓 凑成 弩；消掉之后 革 就永久停在被推到的位置。
 *
 *  这条改动**只改了一处**：`_reach` 里"数空格"之前多了"先越过连续被占的那一段"。
 *  之所以能这么小，是因为"被推的牌也会永久停在新位置"这件事，
 *  在本文件里天然由"整段位移 = 一组 `CellMove`"表达（见 `dragMoves`）——
 *  调用方拿到的仍是"这张牌最远能到哪一行/哪一列"，形状一个字没变，
 *  所以 `reachableCells` / `clampSlide` / `findSuggest` 全部零改动。
 *
 *  ★ 不 import 'cc'，纯算术，可用 node 直接跑断言。
 * ============================================================
 */

import { Cell, CellMove, LevelDef, NonMatchMove, PushMove, PushScan, RunWord, SlideRange, Suggestion, Tile, TileKind, WordSplit } from './Types';
import { JUNK_CHARS, WORDS } from './LevelData';
import { treasureOf } from './Treasure';
import { Rng } from './Rng';

// ------------------------------------------------------------
//  配对表：某一关的「哪些字能配成什么」
// ------------------------------------------------------------
export class PairTable {

    private _map: Record<string, string> = {};

    constructor(words: readonly string[]) {
        for (const w of words) {
            const s = WORDS[w];
            if (!s) continue;                       // 数据缺字：生成期已自检，这里只兜底
            this._map[s.a + '|' + s.b] = w;
            this._map[s.b + '|' + s.a] = w;         // ★ 无序：谁先谁后都能配
        }
    }

    /**
     * 这两张牌能不能配成一对。
     *
     * 【普通牌】三条同时成立才行：
     *   一、都不是干扰牌；
     *   二、**种类不同** —— 必须是「一偏旁 + 一部件」，两块偏旁拼不成字；
     *   三、这个组合在本关的拆字表里。
     *
     * 【宝牌】★ 2026-10-03 新增，规则**完全独立**于拆字表：
     *   两张都是宝牌、且**同款**（`char` 相等）才成对。
     *   宝牌与普通牌永不互配 —— 否则玩家会以为"宝牌能当偏旁用"，
     *   而它其实不在 `WORDS` 里，配上去也合不出字（`word()` 返回空串）。
     */
    canPair(a: Tile | null, b: Tile | null): boolean {
        if (!a || !b || a === b) return false;
        if (a.kind === 'treasure' || b.kind === 'treasure') {
            return a.kind === 'treasure' && b.kind === 'treasure' && a.char === b.char;
        }
        if (a.kind === 'junk' || b.kind === 'junk') return false;
        if (a.kind === b.kind) return false;
        return !!this._map[a.char + '|' + b.char];
    }

    /**
     * 这两张牌合成什么字（配不上返回空串）。
     * ★ 宝牌永远返回空串 —— 它不合成字，只触发"额外消一对"。
     *   调用方**必须先判 `isTreasurePair`**（见 `GamePage.resolveMatch` 的宝牌分支），
     *   否则会走进"合成字为空 → 静默 return"那条路，表现为"点了没反应"。
     */
    word(a: Tile, b: Tile): string {
        return this._map[a.char + '|' + b.char] || '';
    }

    /** 这一对是不是宝牌对（宝牌走另一套结算：不合成字，改为额外消一对普通牌） */
    isTreasurePair(a: Tile | null, b: Tile | null): boolean {
        return !!a && !!b && a.kind === 'treasure' && b.kind === 'treasure' && a.char === b.char;
    }
}

// ------------------------------------------------------------
//  棋盘
// ------------------------------------------------------------
export class Board {

    readonly cols: number;
    readonly rows: number;
    /** 行优先展开的一维数组，长度 = cols*rows。用一维是为了 idxOf 能 O(1) */
    private _cells: (Tile | null)[];

    constructor(cols: number, rows: number) {
        this.cols = cols;
        this.rows = rows;
        this._cells = new Array(cols * rows).fill(null);
    }

    // ---------- 基本访问 ----------
    inBounds(r: number, c: number): boolean {
        return r >= 0 && r < this.rows && c >= 0 && c < this.cols;
    }

    idx(r: number, c: number): number {
        return r * this.cols + c;
    }

    at(r: number, c: number): Tile | null {
        return this.inBounds(r, c) ? this._cells[this.idx(r, c)] : null;
    }

    idxOf(t: Tile): number {
        return this.idx(t.r, t.c);
    }

    setCell(r: number, c: number, t: Tile | null): void {
        this._cells[this.idx(r, c)] = t;
        if (t) { t.r = r; t.c = c; }
    }

    /**
     * 直接按一维下标写格子，**不改动牌的 r/c**。
     * 只给"模拟落位"用（拖动中预览能不能消，见 GamePage.previewMatch）：
     * 那里必须能在不动牌自身坐标的前提下临时挪一下，模拟完再原样还原。
     */
    setCellRaw(i: number, t: Tile | null): void {
        this._cells[i] = t;
    }

    /** 把牌从它当前所在格摘掉（不改变它的 r/c） */
    removeAt(t: Tile): void {
        this._cells[this.idxOf(t)] = null;
    }

    /** 空格数 */
    emptyCount(): number {
        let n = 0;
        for (const c of this._cells) if (!c) n++;
        return n;
    }

    allTiles(): Tile[] {
        const out: Tile[] = [];
        for (const c of this._cells) if (c) out.push(c);
        return out;
    }

    /**
     * 还剩下的「要消掉的牌」数量（归零 = 通关）。
     *
     * ★ 宝牌**算在内**：它成对后自己也会消失，不消完就不算通关。
     *   这不增加玩家的操作量 —— 每凑一对宝牌会自动替他消掉一对普通牌
     *   （见 `randomNormalPair`），总数正好抵消。
     */
    remainingPlayable(): number {
        let n = 0;
        for (const c of this._cells) if (c && c.kind !== 'junk') n++;
        return n;
    }

    /** 盘面上还剩几张宝牌（HUD 用：还差几对宝牌没凑） */
    remainingTreasure(): number {
        let n = 0;
        for (const c of this._cells) if (c && c.kind === 'treasure') n++;
        return n;
    }

    /**
     * 盘面指纹：把「谁在哪」压成一个 8 位十六进制串（FNV-1a 32 位）。
     *
     * 【为什么需要它】
     * 关卡种子表（`core/LevelSeeds.ts`）是**离线挑出来、验证过有解**的，
     * 它有没有跟上"当前的发牌实现"不能靠人去记 —— 所以种子表里同时存下
     * 每颗种子**当时**的发牌指纹，自检时重算一遍对上即可：
     * 指纹对不上 ⇒ 发牌路径（Board/LevelData/Treasure/Rng）动过了 ⇒
     * 「这四局有解」这个结论已经过期，必须重跑 `tools/gen-level-seeds.js`。
     *
     * 【为什么是哈希而不是原串】
     * 原串是「68 张牌 × `id@r,c`」≈ 700 字符；4 颗种子 × 38 关全塞进源码是 100KB 级的
     * 纯冗余数据（还要进主包）。压成 8 字符后整张表只有 1KB 出头。
     * 32 位的碰撞概率在"152 个数两两比较"的量级下约 3e-6，作为"改没改过"的判据足够；
     * 而且它**只用来报警**，不参与任何玩法判定。
     *
     * ⚠️ tile 的 id 由 `generateBoard` 每次从 0 开始发（`buildDeck(lv, rng, 0)`），
     *   所以同一颗种子在任何时刻都得到同一个指纹 —— 这是这个方法成立的前提。
     *   若哪天 id 改成全局自增，这里会立刻全线报警（这正是想要的效果，
     *   但它同时说明**不能把 id 当盘面标识用**）。
     */
    fingerprint(): string {
        const parts: string[] = [];
        for (const t of this.allTiles()) parts.push(`${t.id}@${t.r},${t.c}`);
        parts.sort();
        const s = parts.join(' ');
        let h = 0x811c9dc5;
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 0x01000193) >>> 0;
        }
        return h.toString(16).padStart(8, '0');
    }

    // ---------- 规则 ① ②：滑动范围 ----------
    /**
     * 这张牌沿本行 / 本列能到的最远范围（含自身）。
     *
     * 【口径（2026-10-03 用户拍板"允许推着相邻的格子一起动"之后）】
     * 朝一个方向看过去，盘面被切成三段：
     *
     *      [ t ]  [ 连着的一大段牌 ]  [ 连着的一段空格 ]  [ 后面的东西 ]
     *        ↑推  ← 整段会被推着走 →   ← 能推进来的余量 →
     *
     *  ① 先**越过**前方连续被占的一整段 —— 它们会跟着一起走，不算障碍；
     *  ② 再数后面连续的空格数 `k` —— 有几个空格，整段就能往前推几格；
     *  ③ 于是 t 最远停在 `当前位置 + k 格`。
     *
     * 前方第一格就是空格时「连着一大段牌」长度为 0，退化成原来的普通滑动 ——
     * 所以这条改动是**把旧规则包含在内**的推广，不是替换。
     *
     * 【★ 为什么返回值形状一个字没改（这是本次改动最要紧的一处）】
     * 返回的仍是「t 最远能到哪一行/哪一列」。`reachableCells` / `clampSlide` /
     * `canSlide` / `findSuggest` / `findNonMatch` / `findTreasureMove` **全部零改动**，
     * 因为它们问的都是同一个问题："这张牌最远能到哪" —— 只是答案变大了。
     * 只有"被推的牌去哪儿"是新增的信息，那件事由 `dragMoves` 单独回答。
     *
     * ⚠️ 可达范围里的格子**可能是有牌的**（那些牌会被推走）——
     *    调用方若假设"可达格必然为空"，推箱之后就会错。
     *    `GamePage` 的落位动画与求解器的 `firstHit` 都必须走 `dragMoves`。
     */
    slideRange(t: Tile): SlideRange {
        return {
            up: this._reach(t, -1, 0),
            down: this._reach(t, 1, 0),
            left: this._reach(t, 0, -1),
            right: this._reach(t, 0, 1),
        };
    }

    /** 规则①②的全部实现：沿 (dr,dc) 把 t 推到不能推为止，返回 t 最远的那一行/列 */
    private _reach(t: Tile, dr: number, dc: number): number {
        let r = t.r, c = t.c;
        // ① 越过前方连续被占的一整段（它们会被一起推走）
        while (this.inBounds(r + dr, c + dc) && this.at(r + dr, c + dc)) { r += dr; c += dc; }
        // ② 数这段牌后面还有几格空 —— 那就是整段能前移的格数
        let k = 0;
        while (this.inBounds(r + dr, c + dc) && !this.at(r + dr, c + dc)) { r += dr; c += dc; k++; }
        return dr !== 0 ? t.r + k * dr : t.c + k * dc;
    }

    /**
     * ★ 规则②的完整答案：把 t 拖到 (r,c) 时，**盘面上哪些牌要动、各自去哪**。
     *
     * 返回的是一整段刚性平移：t 走 k 格，它前方连着的那一串牌也各走 k 格
     * （所以段尾那几张会顶到更远处，而不是被 t 吃掉）。
     * 空数组 = 原地不动。
     *
     * 【为什么必须由 Board 出，而不是让调用方自己拼】
     * "哪些牌被推"这件事，`GamePage`（落位动画）、`Solver.firstHit`（求解）、
     * `Board._simulate`（提示/死局检测）三处都要用。各写一遍必然分叉 ——
     * 上一版"提示说能走、玩家拖不过去"就是这么来的。
     *
     * ⚠️ 只处理**单轴**落点（拖动被 `clampSlide` 锁死在一行或一列上）。
     *    若 (r,c) 与 t 不同行也不同列（不该发生），只返回 t 自己那一动、
     *    不做任何推动 —— 宁可少推，也不要凭空把一排牌挪走。
     *
     * ★ 纯函数：只看盘面与入参，不改任何东西。
     */
    dragMoves(t: Tile, r: number, c: number): CellMove[] {
        const dr = Math.sign(r - t.r), dc = Math.sign(c - t.c);
        if (!dr && !dc) return [];
        const out: CellMove[] = [{ t, from: { r: t.r, c: t.c }, to: { r, c } }];
        if (dr !== 0 && dc !== 0) return out;          // 斜落点：不推，见函数头
        const k = Math.abs(dr !== 0 ? r - t.r : c - t.c);
        if (k <= 0) return out;
        // 前方连续被占的一串，整串跟着前移 k 格
        let rr = t.r + dr, cc = t.c + dc;
        while (this.inBounds(rr, cc) && this.at(rr, cc)) {
            const o = this.at(rr, cc) as Tile;
            out.push({ t: o, from: { r: o.r, c: o.c }, to: { r: o.r + k * dr, c: o.c + k * dc } });
            rr += dr; cc += dc;
        }
        return out;
    }

    /**
     * 把一次拖动落到盘面上（改 `_cells` 与牌的 r/c）。**与 `undoDrag` 成对使用。**
     *
     * ⚠️ 必须先**全部清空** `from`、再**全部写入** `to` —— 整段平移时两个集合是重叠的，
     *    边清边写会把还没搬走的牌擦掉（一个只在推箱时才出现的 bug，
     *    表现为"推完之后少了一张牌"，而少的那张不会再回来）。
     */
    applyDrag(mv: CellMove[]): void {
        for (const m of mv) this._cells[this.idx(m.from.r, m.from.c)] = null;
        for (const m of mv) this.setCell(m.to.r, m.to.c, m.t);
    }

    /** `applyDrag` 的逆操作（严格回弹 / 搜索撤销都走它） */
    undoDrag(mv: CellMove[]): void {
        for (const m of mv) this._cells[this.idx(m.to.r, m.to.c)] = null;
        for (let i = mv.length - 1; i >= 0; i--) {
            const m = mv[i];
            this.setCell(m.from.r, m.from.c, m.t);
        }
    }

    /** 这张牌此刻还有没有移动余地（上下左右全无路 → false；能推也算有路） */
    canSlide(t: Tile): boolean {
        const g = this.slideRange(t);
        return g.up !== t.r || g.down !== t.r || g.left !== t.c || g.right !== t.c;
    }

    /** 这张牌当前能到的所有格（必然与它同行或同列）。⚠️ 可能含**有牌的格**（推箱） */
    reachableCells(t: Tile): Cell[] {
        const g = this.slideRange(t);
        const out: Cell[] = [];
        for (let c = g.left; c <= g.right; c++) if (c !== t.c) out.push({ r: t.r, c });
        for (let r = g.up; r <= g.down; r++) if (r !== t.r) out.push({ r, c: t.c });
        return out;
    }

    /**
     * 给定拖动位移，算出落点被约束到哪个格子。
     *
     * @param range  拿起那一刻就冻结的滑动范围（★ 拖动全程用它，不重算）
     * @param axis   'h' 横滑 / 'v' 竖滑
     * @param homeR  这次拖动开始时牌的行
     * @param homeC  这次拖动开始时牌的列
     * @param nx     （拖动中）牌的左边缘在棋盘内的 x，单位=设计像素，原点=棋盘左上
     * @param ny     同上 y
     * @param pitch  格距（格宽 + 间隙）
     * @param gap    格间隙
     *
     * ★ 夹紧的那两行现在管的是"推箱能推多远"：range 已经是推箱口径
     *   （见 slideRange），所以这里**一个字都不用改**。落点落在有牌的格上是合法的 ——
     *   那意味着"把这一串往前推"，具体推谁由 `dragMoves` 回答。
     */
    clampSlide(range: SlideRange, axis: 'h' | 'v', homeR: number, homeC: number,
               nx: number, ny: number, pitch: number, gap: number): Cell {
        if (axis === 'v') {
            let r = Math.round((ny - gap / 2) / pitch);
            r = Math.max(range.up, Math.min(range.down, r));
            return { r, c: homeC };
        }
        let c = Math.round((nx - gap / 2) / pitch);
        c = Math.max(range.left, Math.min(range.right, c));
        return { r: homeR, c };
    }

    // ---------- 规则 ③：对齐合成 ----------
    /** 两张牌同行或同列，且**中间没有别的牌** */
    lineClear(a: Tile, b: Tile): boolean {
        if (a.r === b.r) {
            const l = Math.min(a.c, b.c), h = Math.max(a.c, b.c);
            for (let c = l + 1; c < h; c++) if (this.at(a.r, c)) return false;
            return true;
        }
        if (a.c === b.c) {
            const l = Math.min(a.r, b.r), h = Math.max(a.r, b.r);
            for (let r = l + 1; r < h; r++) if (this.at(r, a.c)) return false;
            return true;
        }
        return false;
    }

    /** 返回与 t 当前可立即合成的所有牌 */
    matchTargets(t: Tile, pair: PairTable): Tile[] {
        const out: Tile[] = [];
        for (const o of this.allTiles()) {
            if (o === t) continue;
            if (!pair.canPair(t, o)) continue;
            if (this.lineClear(t, o)) out.push(o);
        }
        return out;
    }

    /** 盘面上是否已有「直接可消」的一对（教学关靠它保证正反馈） */
    hasDirectMatch(pair: PairTable): boolean {
        const ts = this.allTiles();
        for (let i = 0; i < ts.length; i++) {
            for (let j = i + 1; j < ts.length; j++) {
                if (pair.canPair(ts[i], ts[j]) && this.lineClear(ts[i], ts[j])) return true;
            }
        }
        return false;
    }

    /**
     * ★ 宝牌结算用：从盘面上**随机挑一对能合成的普通牌**（不要求已对齐）。
     *
     * 【为什么必须"能合成"（用户 2026-10-03 拍板选项 A）】
     * 宝牌凑成一对后要额外替玩家消掉一对普通牌。若从"任意两张普通牌"里随机，
     * 有三成概率消掉两张**凑不成字**的牌 —— 那两个字的偏旁/部件数量就不平衡了，
     * **本关永远凑不满目标，直接变成死局**。这不是"运气差"，是规则层面的破坏。
     * 所以候选集只取 `pair.canPair()` 为真的组合：拆掉任意一对，
     * 剩下的牌堆仍然是完美成对的（每个字的 a/b 数量守恒）。
     *
     * 【为什么只查 `pair.canPair` 而不查 `lineClear`】
     * 这是"宝牌替你消"，不是"你亲手消"，所以不受滑动/对齐规则约束 ——
     * 否则盘面一乱就找不到候选，宝牌就变成"白凑了"。省下的那对由系统消掉，
     * 玩家看到的是它自己撞在一起消失。
     *
     * 返回 null = 盘面上已经没有可合成的普通牌对了（例如只剩宝牌）。
     * 这种情况**是合法的**（不是错误），调用方只消宝牌、跳过额外奖励即可。
     */
    randomNormalPair(pair: PairTable, rng: Rng): [Tile, Tile] | null {
        const normals = this.allTiles().filter((t) => t.kind !== 'treasure' && t.kind !== 'junk');
        const cands: [Tile, Tile][] = [];
        for (let i = 0; i < normals.length; i++) {
            for (let j = i + 1; j < normals.length; j++) {
                if (pair.canPair(normals[i], normals[j])) cands.push([normals[i], normals[j]]);
            }
        }
        if (!cands.length) return null;
        return cands[rng.int(0, cands.length)];
    }

    /**
     * 「把这一次拖动先落到纸上，看一眼，立刻原样撤掉」——
     * findSuggest / findNonMatch / findTreasureMove 三处共用的模拟。
     *
     * ★ 收成一个方法不是为了少写几行，而是为了让三者**在物理上不可能分叉**：
     *   这段逻辑写错的方式很隐蔽（忘了还原、或者只挪了 t 却漏掉被推的那一串），
     *   而一旦分叉，就会出现"提示给出的走法玩家拖不过去""死局检测误判"这类
     *   老问题（见文件头那段）。共用一个实现，错了就是三处一起错、一起被发现。
     *
     * ★ 2026-10-03 随推箱一起改：原来是"把 t 单独挪过去"，现在是
     *   **"按 dragMoves 把整段挪过去"**。改动只有这一行，但它决定了
     *   "拖过去之后盘面长什么样"这件事只有一个答案 —— 而落位后消谁、
     *   提示给哪一步，全都建立在这个答案上。
     */
    private _simulate<T>(t: Tile, r: number, c: number, fn: () => T): T {
        const mv = this.dragMoves(t, r, c);
        this.applyDrag(mv);
        const out = fn();
        this.undoDrag(mv);
        return out;
    }

    /**
     * 找一步「玩家真的做得到」的挪法，给提示 / 死局检测 / 自动演示用。
     *
     * ★ 候选落点只能来自 reachableCells —— 也就是"沿本行本列、推得动的范围"。
     *   若允许任意空格当候选，提示就会给出一个拖动限制下根本走不到的格子，
     *   等于骗玩家；死局检测也会跟着误判（明明走不通却说还有解）。
     *   （2026-10-03 推箱上线后 reachableCells 的集合变大了，但"只从它出"这条没变。）
     *
     * 返回 null 表示：**当前盘面无解**（每个非干扰牌都试过了，挪到任何能挪的
     * 地方都凑不成一对）。
     */
    findSuggest(pair: PairTable, rng: Rng): Suggestion | null {
        const tiles = rng.shuffled(this.allTiles());
        for (const t of tiles) {
            if (t.kind === 'junk') continue;         // 挪干扰牌永远凑不成字
            const cells = rng.shuffled(this.reachableCells(t));
            for (const x of cells) {
                const hits = this._simulate(t, x.r, x.c, () => this.matchTargets(t, pair));
                if (hits.length) return { tile: t, r: x.r, c: x.c, hit: hits[0] };
            }
        }
        return null;
    }

    /**
     * ★ 宝牌版 findSuggest：只找「把两张同款宝牌挪到一起」的走法。
     *
     * 【它为什么必须单独有一个（而不是"用 findSuggest 筛 kind 就行"）】
     * `findSuggest` 只会返回**它随机撞上的第一条**可消走法 —— 盘面上普通牌成对
     * 的可能性远大于宝牌（`pairs` 对 vs `tr` 对），所以它给出宝牌走法的概率极低。
     * 而"宝牌成对 → 额外消一对"是本作最需要看清楚的一条规则，
     * 没有这个入口就只能靠人手在真机上碰运气。
     * 现在它接在 `[Diag] TREASURE` 上，冒烟的 `treasure:` 动作照着它拖真事件。
     *
     * 返回 null：**当前没有"挪一步就能凑宝牌"的走法**（两张宝牌已对齐时不返回 ——
     * 那是"点一下"而不是"挪一步"，此时 hasDirectMatch 为真）。
     */
    findTreasureMove(pair: PairTable, rng: Rng): Suggestion | null {
        const ts = rng.shuffled(this.allTiles().filter((t) => t.kind === 'treasure'));
        for (const t of ts) {
            const cells = rng.shuffled(this.reachableCells(t));
            for (const x of cells) {
                const hits = this._simulate(t, x.r, x.c, () => this.matchTargets(t, pair));
                if (hits.length) return { tile: t, r: x.r, c: x.c, hit: hits[0] };
            }
        }
        return null;
    }

    /**
     * 盘面上有没有「已经对齐、**点一下**就能消」的普通牌对？返回其中一对。
     *
     * 【它和 hasDirectMatch 的分工】
     * `hasDirectMatch` 只回答"有没有"（死局检测 / 教学关判据用），
     * 这里回答"是哪一对" —— 因为 `[Diag] DIRECT` 那行日志要给出**坐标**，
     * 冒烟的 `treasure:` 前置消除才能把"只能点"的局面也走下去。
     *
     * 【为什么必须有那行日志（2026-10-03 实测）】
     * `findSuggest` 只在 reachableCells 里找落点，而"把 A 挪到它搭档身上"
     * （搭档本来就被 A 推到别处去了）这种走法它给不出来 → `SUGGEST none`。
     * 而 `SUGGEST none` 其实对应两种完全不同的局面：`REACH direct=1` 是
     * "还活着，该点不该拖"，`direct=0` 才是真卡住。
     * 冒烟的前置消除原本只认 SUGGEST，于是撞上前者就罢工，报出来的却是
     * "20 手之后仍拿不到宝牌走法" —— 完全指错了方向（实测：那一局已消 9/15、
     * 剩牌 14，盘面明明活着）。
     */
    findDirectPair(pair: PairTable): [Tile, Tile] | null {
        const ts = this.allTiles().filter((t) => t.kind !== 'treasure' && t.kind !== 'junk');
        for (let i = 0; i < ts.length; i++) {
            for (let j = i + 1; j < ts.length; j++) {
                if (pair.canPair(ts[i], ts[j]) && this.lineClear(ts[i], ts[j])) return [ts[i], ts[j]];
            }
        }
        return null;
    }

    /**
     * ★ 宝牌版的"已经对齐、**点一下**就能消"—— `findTreasureMove` 的互补面。
     *
     * 【为什么必须有它 —— 与 `[Diag] REACH direct=` 是同一条教训，不是测试垃圾】
     * `findTreasureMove` 只找**需要挪一步**的走法。而两张宝牌完全可能一开局就
     * 落在同一行/同一列、中间无牌 —— 那时它返回 null，可那不是"没得消"，
     * 而是"该点不该拖"。上一轮 `SUGGEST none` 正是把这两种局面混成一句，
     * 害得「卡住」弹层的断言白查了一整轮（见 GamePage.diag 里的 REACH 注释）。
     * 宝牌这里同理：冒烟的 `treasure:` 动作要么照 `TREASURE` 拖、要么照
     * `TREASURE direct` 点，缺一个就会把"可以点掉"误读成"这盘没有宝牌走法"。
     *
     * 【2026-10-03 实测踩到】
     * L3 首盘 `铁砧@4,1` 与 `铁砧@4,3` 中间夹着一张 `玄@4,2` —— 两张宝牌谁也挪不到
     * 对方身旁（列上都被挡住），`TREASURE` 因此是 `none`。而玩家真正要做的是
     * **先把 `玄` 消掉**，宝牌才变成"点一下"。所以这行日志同时也是给玩家的线索。
     *
     * 返回两张**同款且已经 lineClear**的宝牌；没有则 null。
     */
    findDirectTreasure(pair: PairTable): [Tile, Tile] | null {
        const ts = this.allTiles().filter((t) => t.kind === 'treasure');
        for (let i = 0; i < ts.length; i++) {
            for (let j = i + 1; j < ts.length; j++) {
                if (pair.canPair(ts[i], ts[j]) && this.lineClear(ts[i], ts[j])) return [ts[i], ts[j]];
            }
        }
        return null;
    }

    /**
     * 找一步「玩家做得到、但落位**凑不成字**」的挪法 —— `findSuggest` 的互补面。
     *
     * 【它为什么必要（而不是"测试专用垃圾"）】
     * 玩法是**严格回弹**：拖了凑不成字就滑回原位、盘面与步数都不变。
     * 这条规则如果没有一个可观测的入口，验证就只能靠人拿手指拖 ——
     * 而"人拖的到底是不是那一格"本身不可复现。冒烟的 `rebound:` 动作靠它
     * 拿到一对确定坐标，才能用**真事件**断言"牌弹回去了、且步数没涨"。
     *
     * 【与 findSuggest 的关系】
     * 两者都用 `reachableCells` 当候选（保证"玩家真的做得到"），只是一个
     * 要求落位有解、一个要求落位无解。同一个盘面上两者**可以同时非 null**：
     * "这盘有解"不等于"每一步都有解"。
     *
     * 返回 null 表示：**任何能挪的落点都会凑成字** —— 此时严格回弹根本
     * 弹不回来（每一步都合法），断言脚本要能识别这种情况而不是误报失败。
     */
    findNonMatch(pair: PairTable, rng: Rng): NonMatchMove | null {
        const tiles = rng.shuffled(this.allTiles());
        for (const t of tiles) {
            if (t.kind === 'junk') continue;      // 干扰牌挪来挪去都不成字，拿它当样本没意义
            const cells = rng.shuffled(this.reachableCells(t));
            for (const x of cells) {
                const hits = this._simulate(t, x.r, x.c, () => this.matchTargets(t, pair));
                if (!hits.length) return { tile: t, r: x.r, c: x.c };
            }
        }
        return null;
    }

    /**
     * ★ 推箱走法的**可测入口**（2026-10-03 加）。一次扫出两种样本：
     *   · `match`   推着相邻牌一起走、落位**凑成了字** → 用来断言"被推的牌永久留在新位置"；
     *   · `nomatch` 推着相邻牌一起走、落位**凑不成字** → 用来断言"整段沿原路弹回"。
     *
     * 【为什么两条都要】
     * 推箱给玩家带来的只有两件事：**能推** 与 **推了不算就弹回去**。
     * 只验前者，等于没验"必须达成消除条件才允许这样推"这半句（用户原话）。
     * 而这两件事在推箱**之前**都测不出来 —— 旧规则下"拖动一张牌"永远只动它自己，
     * 所以既没有"被推的牌"，也没有"整段回弹"可言。
     *
     * 【判据：怎么算"一次推箱"】
     * `dragMoves(t, x)` 返回的整段里**除了 t 自己还有别人** ⇒ 这次拖动推了东西。
     * ⚠️ 落点必须取自 `reachableCells(t)` —— 它已经把"推得动多远"夹紧了。
     *   随手传一个别的格子也能得到长度 > 1 的 dragMoves（那个函数不看可达性），
     *   但玩家根本拖不到那里，拿它当样本等于验一个不存在的手势。
     *
     * 【返回值的稳定性】
     * 用调用方传进来的 `rng`（GamePage 用的是**固定种子**新建的），
     * 所以同一个盘面连续调用得到的是同一组样本，断言不会随"脚本读了几次日志"漂移。
     *
     * 【★ 2026-10-03：优先挑"这一推**新造出**的配对"】
     * 第一版只要求"落位后 matchTargets 非空"，于是 L3 的 PUSH 样本回回是
     * 「玄@4,5 → 3,5，命中 弓@6,5」—— 可这两张**拖动之前就同列、中间无遮挡**，
     * 本来就已对齐（`REACH direct=1` 那条就是它）。那种样本下"凑成字"根本不是
     * 这一推带来的，A 段断言等于**只验了被推的牌会动**，把用户那句
     * 「推着走、落位凑成字」验漏了。
     * 所以先算一遍 `preHits`（**拖动之前**与该牌对齐的那些），落位后的命中
     * 只有在**不在 preHits 里**时才算"新造的"，优先返回它。
     */
    findPush(pair: PairTable, rng: Rng): PushScan {
        let matchNew: PushMove | null = null;        // 最优：命中的是**这一推新造出**的配对
        let matchPlain: PushMove | null = null;      // 次选：任何"推 + 落位凑成字"
        let matchLoose: PushMove | null = null;      // 兜底：命中的正好是被推的那张（断言弱一些）
        let nomatch: PushMove | null = null;
        for (const t of rng.shuffled(this.allTiles())) {
            if (t.kind === 'junk') continue;
            // ★ 必须在 `_simulate` **之外**算：它内部是先落位、判完再还原，
            //   在它里面拿到的"对齐情况"已经是落位之后的，等于没算。
            const preHits = this.matchTargets(t, pair);
            for (const x of rng.shuffled(this.reachableCells(t))) {
                const mv = this.dragMoves(t, x.r, x.c);
                const shoved = mv.filter((m) => m.t !== t);
                if (!shoved.length) continue;                       // 只动自己 = 不是推箱
                const hits = this._simulate(t, x.r, x.c, () => this.matchTargets(t, pair));
                if (hits.length) {
                    const hit = hits[0];
                    const rec: PushMove = { tile: t, r: x.r, c: x.c, shoved, hit };
                    // ★ 优先挑「命中的那张**不在**被推之列」的样本。
                    //   原因：如果命中恰好是被推的那一张，它落位后立刻被消掉 ——
                    //   冒烟就断言不了用户最在意的那句"被推的牌**永久**停在新位置"
                    //   （只能断言"它要么在新位置、要么没了"，等于半个断言）。
                    //   盘面上只要有干净的样本就用干净的；实在没有才退回。
                    if (shoved.some((m) => m.t === hit)) {
                        if (!matchLoose) matchLoose = rec;
                    } else {
                        if (!matchPlain) matchPlain = rec;
                        // 牌没被推 ⇒ 身份即位置，直接比对象引用就能判"拖动前是否已对齐"
                        if (!matchNew && preHits.indexOf(hit) < 0) matchNew = rec;
                    }
                } else if (!nomatch) {
                    nomatch = { tile: t, r: x.r, c: x.c, shoved };
                }
                // 两个最优样本都到手就收工（挑到"新造配对"之后再往下扫没有收益）
                if (matchNew && nomatch) return { match: matchNew, nomatch };
            }
        }
        return { match: matchNew || matchPlain || matchLoose, nomatch };
    }
}

// ------------------------------------------------------------
//  发牌
// ------------------------------------------------------------
/** 本关每个目标字要合几个（pairs 张一对，字数不足时前面的字多拿） */
export function computeNeed(lv: LevelDef): Record<string, number> {
    const need: Record<string, number> = {};
    for (let i = 0; i < lv.pairs; i++) {
        const w = lv.words[i % lv.words.length];
        need[w] = (need[w] || 0) + 1;
    }
    return need;
}

/** 本关的目标条数据（顺序按 lv.words，让新字排前面） */
export function makeRunWords(lv: LevelDef): RunWord[] {
    const need = computeNeed(lv);
    return lv.words.map((w) => ({ w, need: need[w] || 0, got: 0 }));
}

/** 一关的牌堆（还没落到格子上） */
function buildDeck(lv: LevelDef, rng: Rng, firstId: number): Tile[] {
    const deck: Tile[] = [];
    let id = firstId;
    for (let i = 0; i < lv.pairs; i++) {
        const w = lv.words[i % lv.words.length];
        const s: WordSplit = WORDS[w];
        deck.push({ id: id++, char: s.a, kind: 'radical', r: -1, c: -1 });
        deck.push({ id: id++, char: s.b, kind: 'part', r: -1, c: -1 });
    }
    // ★ 宝牌（2026-10-03 接入）：每对**一种物件**，两张同款。
    //   用 lv.ch 取物件，所以同一关里 tr=2 时是两件不同的东西、彼此配不上 ——
    //   这正是"每对一种物件"的玩法含义（见 core/Treasure.ts 的警告）。
    for (let i = 0; i < lv.tr; i++) {
        const it = treasureOf(lv.ch, i);
        deck.push({ id: id++, char: it.name, kind: 'treasure', tex: it.tex, r: -1, c: -1 });
        deck.push({ id: id++, char: it.name, kind: 'treasure', tex: it.tex, r: -1, c: -1 });
    }
    // 干扰牌：★ 数据里已全线归零（宝牌取代了它）。循环保留到"确认线上包体里
    // 确实没有 junk 贴图"之后再删，届时 `JUNK_CHARS` 一并下线。
    for (let i = 0; i < lv.junk; i++) {
        deck.push({ id: id++, char: JUNK_CHARS[i % JUNK_CHARS.length], kind: 'junk', r: -1, c: -1 });
    }
    return rng.shuffle(deck);
}

/** 造一个空棋盘，把牌堆随机撒上去 */
export function generateBoard(lv: LevelDef, pair: PairTable, rng: Rng): Board {
    const bd = new Board(lv.cols, lv.rows);
    const deck = buildDeck(lv, rng, 0);
    const total = lv.cols * lv.rows;
    if (deck.length > total) {
        // 数据错（生成期已自检）时的兜底：宁可少放牌也不要死循环
        deck.length = total;
    }
    const slots = rng.shuffled(Array.from({ length: total }, (_, i) => i)).slice(0, deck.length);
    deck.forEach((d, i) => {
        const idx = slots[i];
        bd.setCell(Math.floor(idx / lv.cols), idx % lv.cols, d);
    });

    // 教学关保证「一上来就有一对能直接消」：否则玩家第一步无从下手。
    // ★ 必须有重试上限 —— 无上限的 while 在"怎么撒都凑不出"的极端情况下会卡死主线程。
    if (lv.n <= 3 && !bd.hasDirectMatch(pair)) {
        for (let k = 0; k < 24; k++) {
            const bd2 = generateBoardShuffled(lv, rng);
            if (bd2.hasDirectMatch(pair)) return bd2;
        }
    }
    return bd;
}

/**
 * 只重排、不重试（generateBoard 的重试用它，避免递归里再套重试 → 递归爆栈）。
 * ★ 上一版把重试写在 generateBoard 自身里并递归调用自己，25 层嵌套；
 *   虽然没炸，但一旦"怎么排都无解"就会一路递归到爆。这里分成两个函数根治。
 */
function generateBoardShuffled(lv: LevelDef, rng: Rng): Board {
    const bd = new Board(lv.cols, lv.rows);
    const deck = buildDeck(lv, rng, 0);
    const total = lv.cols * lv.rows;
    const slots = rng.shuffled(Array.from({ length: total }, (_, i) => i)).slice(0, deck.length);
    deck.forEach((d, i) => {
        const idx = slots[i];
        bd.setCell(Math.floor(idx / lv.cols), idx % lv.cols, d);
    });
    return bd;
}

/** 牌的种类（发牌时用） */
export function kindOf(char: string, lv: LevelDef): TileKind {
    for (const w of lv.words) {
        const s = WORDS[w];
        if (!s) continue;
        if (s.a === char) return 'radical';
        if (s.b === char) return 'part';
    }
    return 'junk';
}
