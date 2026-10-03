/**
 * ============================================================
 *  Solver.ts · 「整盘能不能消空」的唯一内核
 * ============================================================
 *  ★ 本文件**不 import 'cc'**（与 core/ 全体同一条硬规矩，见 Types.ts 文件头）。
 *
 *  ------------------------------------------------------------------
 *  一、它为什么必须存在（2026-10-03 用户拍板方案 A）
 *  ------------------------------------------------------------------
 *  在这之前，"这盘还有没有解"有两个各自为政的判定：
 *    · 离线：`tools/solve-exact.js` —— 贪心换顺序 + DFS，严丝合缝；
 *    · 运行时：`GamePage.reshuffleRemaining` —— 只查
 *      `hasDirectMatch || findSuggest`，也就是**只保证"至少有一对能消"**。
 *
 *  后者是被玩家看得见的那个：他点「看广告重排」，收到"盘面已重排"的正反馈，
 *  结果只消一对又被卡住，只能再点一次广告。**承诺是"能走"，兑现的是"能动一下"。**
 *
 *  两个判定的差别不是"精度"问题，而是**一套规则写了两遍** ——
 *  上一版原型正是这么栽的（拖动限制 / 提示 / 死局检测各写一套，最后提示给出的
 *  走法玩家拖不过去）。所以这里不做第二套，直接把内核抽出来给两边共用：
 *    · `tools/solve-exact.js`  require 编译后的本文件；
 *    · `ui/GamePage.ts`       直接 import 本文件。
 *  判据一旦要改，两边同时改，**不可能再分叉**。
 *
 *  ------------------------------------------------------------------
 *  二、两条契约（调用方可以依赖，改代码时不许破坏）
 *  ------------------------------------------------------------------
 *  ① **`search` / `greedyPlan` / `solvable*` 返回时，盘面必须与调用前逐字节一致**
 *     （连牌的 r/c 都没动过）。踩过两次，症状一次是"回放 0/8 通关"，
 *     一次是"落位后消的不是计划里的 XX" —— 两次都被读成"游戏有问题"，
 *     实际是搜索把自己的痕迹留在了活盘面上。异常路径也必须还原（见 search 的 catch）。
 *
 *  ② **本文件不重写规则**。滑动范围、能不能消、落位后消谁、宝牌赠品送哪一对，
 *     一律调 `Board` / `PairTable` 的原语。这里只负责**搜索策略**。
 *     想让判据变严/变松，去改 Board；想换搜索方式，才改本文件。
 *
 *  ------------------------------------------------------------------
 *  三、什么会改状态（搜索空间的支点）★ 2026-10-03 推箱后被改写过
 *  ------------------------------------------------------------------
 *  严格回弹（用户 2026-10-02 拍板）意味着：拖出去、落位凑不成字 → 牌沿原路滑回，
 *  `_cells` 与牌的 r/c **从未变过**（见 `GamePage.reboundTile` 的注释：
 *  "整个拖动过程只改节点的 position"）。
 *
 *  【推箱之前，这条推论成立】任何一张牌，只要能消它就是被删掉，消不掉它就在原地
 *  没动 —— 没有任何一张牌会永久停在新位置上。于是：
 *    · 状态 = 初始牌的一个子集（牌位恒定，不用记录谁在哪）；
 *    · 走法 = 「消掉哪一对」；通关 ⟺ 能把这份子集一路消空。
 *
 *  【★★ 推箱之后，这条推论**断了** —— 整个内核最要紧的一处改动 ★★】
 *  用户 2026-10-03 拍板「允许推着相邻的格子一起动」，并且明确了推箱的结算口径：
 *  **消成了，被推的牌就永久停在新位置**（他的原话："当两者消掉后，革字比原来
 *  往右移动了一格"）。也就是说，**牌会搬家**了。
 *
 *  于是：
 *    · 状态 = **每一张牌的 (id, 行, 列)** —— 光记"还剩哪些牌"不够了，
 *      同一份子集从两条不同路径走过来，牌位可以完全不同（`stateKey` 已同步改）；
 *    · 走法 = 「把谁拖到哪一格」—— 同一个"消掉哪一对"从不同落点过去，
 *      被推的牌落在哪不一样，**结果是两个不同的局面**（`listActions` 的去重键
 *      因此必须带上落点，见那里的注释）；
 *    · 搜索空间因此**明显变大**，DFS 更容易撞预算 ——
 *      这不是 bug，是玩法的必然。所以 `NO` 这个结论比以前更难得，
 *      而 `UNKNOWN`（没算完）更常见。三态语义照旧，见第二节。
 *
 *  ⚠️ 换句话说：**推箱让玩家更难被卡死，却让"证明他被卡死"更难。**
 *     两边是同一件事的两面 —— 不要为了让 `NO` 好出现而把动作集砍回旧口径，
 *     那样重排判据会看不见推箱解，把"能通关的盘面"报成无解。
 *
 *  ------------------------------------------------------------------
 *  四、宝牌赠品怎么算（口径写在明处）
 *  ------------------------------------------------------------------
 *  宝牌成对时会**额外随机消掉一对普通牌**（`Board.randomNormalPair`）。
 *  "随机"意味着严格说这是**非确定**玩法，所以口径分两档（缺一不可）：
 *
 *    'none'  不触发赠品 —— 回答"**这张牌面本身是不是死局**"（设计判据，
 *            也是工具的对账档：规划器与回放同规则，必须 100% 通关）
 *    'real'  每步现抽 —— 回答"**玩家真遇上时能不能通**"（真机口径）
 *
 *  【实测结论：赠品**真的**会把可通关变成不可通关】
 *  36 关 × 8 盘里"模型说有解"的 221 盘：`real` 通关 201（9.0% 被送进死局），
 *  `none` 通关 221。差额就是"赠品这一步随机"的全部代价。
 *  曾经有过一个漂亮的论证 ——"额外消除只会少两张牌，而少牌只会让别的牌更好挪
 *  （slideRange 单调不缩、lineClear 单调变松），所以不可能把可通关变成不可通关"。
 *  **每半句都认，合起来是错的**：少牌确实让"两张牌之间能不能连上"变松，
 *  但**该连的是谁**变了。被拆掉的那一对本来承担着"把某个字引到能碰面的位置"。
 *
 *  ⚠️ 还有一条边界要说清：'none' 口径给的是**「存在通关路径」**（∃），
 *    不是"无论赠品送掉哪一对都通关"（∀）—— 后者要枚举全部候选组合
 *    （3 对宝牌 × 上百候选 → 组合爆炸），而这**正是上面那 9% 的来处**。
 * ============================================================
 */

import { Board, PairTable } from './Board';
import { Rng } from './Rng';
import { Cell, CellMove, Tile } from './Types';

// ============================================================
//  类型
// ============================================================

/** 一步走法：把 `t` 拖到 `x`，落位后引擎会消掉 `o` */
export interface MoveAction {
    t: Tile;
    o: Tile;
    /** 引擎口径的落点（把 t 拖到它、落位后 `firstHit` 恰好是 o） */
    x: Cell;
    /**
     * 宝牌赠品：这一步实际送掉了哪一对普通牌。
     *   undefined = 还没问过真源；null = 问过了、盘上没有可送的；
     *   [a, b]    = 送掉这两张。
     * ★ 三态必须分清，见 `settle` 的注释。
     */
    bonus?: [Tile, Tile] | null;
}

/** 被摘掉的牌与它原来的格子（撤销用） */
export interface Gone {
    t: Tile;
    i: number;
}

/**
 * ★ 一步走法在盘面上留下的**全部**痕迹（撤销用）。
 *
 * 【为什么不能只记"摘掉了哪几张"（2026-10-03 推箱上线后必须改）】
 * 推箱会让**没被消掉的牌也搬家**。只记 `killed` 的话，撤销之后盘面看起来
 * "牌都回来了"，实际它们全停在被推到的位置上 —— 于是搜索会在一片
 * 错位的盘面上继续往下走，而它自己不知道。
 * 症状会非常像"游戏规则有问题"（计划里的落点锁不住目标），
 * 但根因在内核：**撤销不是"把牌放回去"，是"把这一步倒放一遍"**。
 *
 * 顺序不能颠倒：正向是「先整段位移、再摘牌」，逆向就必须是
 * 「先把牌放回（放回的是位移**之后**的位置）、再把整段位移倒回去」。
 * `undoAction` 里那两行的先后关系是契约，不是风格。
 */
export interface Applied {
    /** 这一步发生的位移（含被推的那一串） */
    mv: CellMove[];
    /** 这一步被摘掉的牌与它当时所在的格下标 */
    killed: Gone[];
}

export type BonusMode = 'none' | 'real' | 'plan';

export interface SearchOpt {
    /** DFS 节点数上限（缺省不限） */
    budget?: number;
    /** DFS 墙钟上限（毫秒时间戳，缺省不限） */
    deadline?: number;
}

export interface SearchOut {
    ok: boolean;
    plan: MoveAction[] | null;
    nodes: number;
}

export type Verdict = 'YES' | 'NO' | 'UNKNOWN';

export interface SolverOpts {
    /** 换多少个随机顺序做贪心（判"有解"用；全败才上 DFS） */
    tries: number;
    /** 单盘 DFS 节点上限 */
    budget: number;
    /** 单盘 DFS 墙钟上限（毫秒时间戳） */
    boardDeadline: number;
}

export interface SolverOut {
    verdict: Verdict;
    /**
     * 'greedy' = 贪心撞上一条真解（构造性证据，最可靠）；
     * 'dfs'    = DFS 穷尽（`NO` 这一路可以当死局证据；`YES` 是找到了解）；
     * 'budget' = **没算完** —— 绝不能说成死局。
     */
    via: 'greedy' | 'dfs' | 'budget';
    tries: number;
    steps: number;
}

export interface GreedyOut {
    cleared: boolean;
    steps: number;
    actions: MoveAction[];
}

export interface GreedyAnyOut {
    cleared: boolean;
    tries: number;
    steps: number;
}

export interface GreedyPlanOut {
    cleared: boolean;
    actions: MoveAction[] | null;
    tries: number;
}

export interface PlanOut {
    ok: boolean;
    actions: MoveAction[] | null;
    via: 'greedy' | 'dfs' | 'budget';
    tries: number;
}

// ============================================================
//  预算哨兵
// ============================================================
/**
 * ★ 为什么不用 `class BudgetError extends Error`：
 *   微信小游戏的构建链有一档"ES6 转 ES5"，在那里 `extends Error` 的
 *   `instanceof` **会静默失效**（原型链没接上），于是 `catch (e) { if (e instanceof ...) }`
 *   永远为假 —— 撞预算会被当成崩溃抛出去，而不是被当成"没算完"。
 *   这类 bug 只在真机上出现，本地 Node 跑得好好的（Node 走原生 class，没问题）。
 *   所以这里用**一个字段**当哨兵：不依赖原型链，转译怎么折腾都还在。
 */
const BUDGET_FLAG = '__chaiziSolverBudget';

export function isBudgetStop(e: unknown): boolean {
    return !!e && typeof e === 'object' && (e as Record<string, unknown>)[BUDGET_FLAG] === true;
}

function stopBudget(why: string): never {
    const e = new Error('求解预算用尽：' + why) as unknown as Record<string, unknown>;
    e[BUDGET_FLAG] = true;
    throw e;
}

// ============================================================
//  规则层：只用真源里的原语来拼「能不能凑到一起」
// ============================================================

/**
 * ★ 引擎口径的"落位后第一个被消掉的是谁"—— 这是整个内核最要紧的一个函数。
 *
 * `matchTargets` 是**按棋盘行优先序**遍历所有牌，返回第一张能配上的。
 * 而能配上的牌只可能在 t 的**同一行或同一列**（`lineClear` 的要求），
 * 所以"行优先序里的第一个"只可能是这三种位置里的最先一个：
 *
 *   ① 列上、行号比 t 小的（行号升序）
 *   ② t 这一行上的（列号升序）
 *   ③ 列上、行号比 t 大的（行号升序）
 *
 * 按这个顺序扫、命中即返回，就与引擎逐字一致 —— 不需要真去遍历整张盘面。
 *
 * 【为什么必须精确到"第一个"（实测踩到）】
 * 一开始用的是"任意落点，只要落位后能与目标 o 对齐就算这一步可行"。
 * 开局时两种口径的**可消对集合完全一样**（逐盘对账过 48 盘零差异），
 * 但**中局会分叉**：落位后这一行里若有另一张更靠前的可配对牌，
 * 引擎会消它而不是你想要的 o。于是计划从第二步起就脱离了现实。
 * 症状是"真机口径回放只有 51% 通关"，而失败原因里 97/109 是
 * "找不到能锁定 XX 的落点" —— 看起来像模型不准，其实是**动作集本身就错了**。
 * 换成精确口径之后，搜索出来的每一步就是玩家真按下去会发生的事。
 *
 * ★ 契约：返回时盘面与牌的 r/c 均已还原。t 的搭档 o **不存在**时返回 null。
 *
 * ★ 2026-10-03 推箱：模拟的**不再是把 t 单独挪过去，而是整段拖动**。
 *   这一步看着只是换了三行，实际是这次改动里最容易漏的一处 ——
 *   被推的牌挪走之后，"t 与候选 o 之间还有没有挡路的"会变，
 *   所以 `lineClear` 必须在**推完之后**的盘面上问。
 *   只挪 t 的话，会遇到"计划说这一格能消、玩家拖过去却消别人"的老毛病。
 */
export function firstHit(bd: Board, pair: PairTable, t: Tile, x: Cell): Tile | null {
    const mv = bd.dragMoves(t, x.r, x.c);
    bd.applyDrag(mv);
    let hit: Tile | null = null;
    const ok = (o: Tile | null): boolean => !!o && pair.canPair(t, o) && bd.lineClear(t, o);
    for (let r = 0; r < t.r && !hit; r++) { const o = bd.at(r, t.c); if (ok(o)) hit = o; }
    for (let c = 0; c < bd.cols && !hit; c++) { if (c === t.c) continue; const o = bd.at(t.r, c); if (ok(o)) hit = o; }
    for (let r = t.r + 1; r < bd.rows && !hit; r++) { const o = bd.at(r, t.c); if (ok(o)) hit = o; }
    bd.undoDrag(mv);
    return hit;
}

/**
 * 盘面上此刻所有「玩家真能消掉的一对」，返回 [{t, o, x}]。
 *
 * x 是**引擎口径的落点**：把 t 拖到 x，落位后 `firstHit` 恰好是 o。
 *
 * ★ 2026-10-03 推箱之后，去重键里**必须带上落点**。
 *   旧键是 `t.id:hit.id`（"消掉哪两张"决定一切），推箱之前这是对的。
 *   现在同一个 (拖谁, 消谁) 从不同落点过去，**被推的牌落在哪是不一样的** ——
 *   盘面因此不同，是两条不同的走法。按旧键去重会把其中一条当重复扔掉，
 *   搜索就漏掉了半个局面，而"漏掉的那条刚好是唯一能通关的"这种事
 *   只在个别盘面上出现，症状是"明明有解却报无解"，极难查。
 */
export function listActions(bd: Board, pair: PairTable): MoveAction[] {
    const out: MoveAction[] = [];
    const seen = new Set<string>();
    for (const t of bd.allTiles()) {
        const spots: Cell[] = [{ r: t.r, c: t.c }].concat(bd.reachableCells(t));
        for (const x of spots) {
            const hit = firstHit(bd, pair, t, x);
            if (!hit) continue;
            const k = t.id + ':' + hit.id + '@' + x.r + ',' + x.c;
            if (seen.has(k)) continue;
            seen.add(k);
            out.push({ t, o: hit, x: { r: x.r, c: x.c } });
        }
    }
    return out;
}

/**
 * 把这一步落到盘面上：**先整段位移，再摘牌**。
 * 顺序与 `undoAction` 互为逆操作，见 `Applied` 的注释。
 */
export function applyAction(bd: Board, a: MoveAction): Applied {
    const mv = bd.dragMoves(a.t, a.x.r, a.x.c);
    bd.applyDrag(mv);
    const killed: Gone[] = [];
    const kill = (t: Tile): void => {
        const i = bd.idx(t.r, t.c);
        bd.setCellRaw(i, null);
        killed.push({ t, i });
    };
    kill(a.t);
    kill(a.o);
    if (a.bonus) { kill(a.bonus[0]); kill(a.bonus[1]); }
    return { mv, killed };
}

/**
 * 撤销：先把摘掉的牌放回（放回的是位移**之后**的格子），再把整段位移倒回去。
 * ★ 这两行的先后是契约，别调换 —— 理由见 `Applied` 的注释。
 */
export function undoAction(bd: Board, ap: Applied): void {
    for (const g of ap.killed) bd.setCellRaw(g.i, g.t);
    bd.undoDrag(ap.mv);
}

/**
 * ★ 把一步走法在盘面上落实，**并把"宝牌赠品送掉哪一对"一并定下来**。
 *
 * 【为什么要单独抽这一层：踩得最深的一个坑】
 * 原先 `greedy` / `greedyPlan` 直接调 `applyAction`，而 `applyAction` 只在
 * `a.bonus` 有值时才多消一对 —— 可那两条路径**从来没给 a.bonus 赋过值**。
 * 于是：
 *   · 算方案时走的是"宝牌只消两张"的世界；
 *   · 回放时走的是真引擎"宝牌还额外送一对"的世界。
 * 两个世界的盘面从**第一次凑成宝牌**起就分道扬镳，之后方案里记的落点 x
 * （它在旧盘面上恰好锁定 o）在新盘面上锁定的往往是别人。
 * 症状是回放报"落位后消的不是计划里的 日（模型与引擎不一致）"——
 * **明明是工具在比两份不同的棋盘，却被读成游戏规则出了问题。**
 *
 * 修法的关键不是"回放时补抽一次"，而是**让赠品成为动作的一部分**：
 * 定下来的那一对写回 `a`（`a.bonus`），`applyAction` / `undoAction` 照它做。
 * 这样一条方案是自洽的 —— 回放按同一份赠品走，才谈得上"逐手对齐"。
 *
 * ⚠️ `a.bonus === null` 与 `undefined` 是两件事：
 *   `null` = 已经问过真源了，盘上没有可送的普通对（别再问一次）；
 *   `undefined` = 还没问过。
 *   混为一谈会让"记在动作里"这件事在边角盘面上悄悄失效。
 */
export function settle(bd: Board, pair: PairTable, rng: Rng, a: MoveAction): Applied {
    if (a.bonus === undefined && pair.isTreasurePair(a.t, a.o)) {
        const b = bd.randomNormalPair(pair, rng);
        a.bonus = b ? [b[0], b[1]] : null;
    }
    return applyAction(bd, a);
}

// ============================================================
//  搜索层
// ============================================================

/**
 * 局面键 = 每张牌的 (id, 行, 列)。
 *
 * 【2026-10-03 推箱之前，这里只记 id 就够了】那时牌位恒定（严格回弹 + 只有"消对"
 * 会改状态），所以"还剩哪些牌"就是完整的局面描述。
 * 推箱之后牌会搬家（消成了，被推的就停在新位置），只记 id 会把**两个不同的盘面
 * 当成同一个** —— 于是记忆化剪枝会把"没试过的那一支"当成"试过且失败"剪掉，
 * 表现是搜索漏解、误报无解。这是本次改动里**最安静**的一个坑：
 * 没有报错、没有崩溃，只是结论悄悄变错。所以键里必须带上坐标。
 *
 * ⚠️ 代价：键串变长（68 张牌 × ~8 字符），`Set` 的内存与哈希开销涨了约 3 倍。
 *    搜索本来就被 600ms 墙钟卡着，这里涨的是"每节点更贵"，不是"跑得更久"。
 */
export function stateKey(bd: Board): string {
    const parts: string[] = [];
    for (const t of bd.allTiles()) parts.push(t.id + '@' + t.r + ',' + t.c);
    return parts.join(' ');
}

/** 0 = 原地就能消（纯点击），1 = 要挪一下。排序用 */
function directness(a: MoveAction): number {
    return (a.x.r === a.t.r && a.x.c === a.t.c) ? 0 : 1;
}

/**
 * 判定「这份盘面能不能一路消空」，能则返回走法序列。
 *
 * 【为什么是 DFS 而不是纯贪心】
 * 三条规则看不出"任意顺序都行"这件事是否成立（虽然大概率成立），
 * 所以在没有实测结论之前，只有 DFS 给得出"无解"这个结论。
 * 有了解法就立刻返回 —— 我们的问题只问"有没有路"，不需要最优解。
 *
 * 【记忆化记的是"失败"】
 * 状态 = 剩余牌的子集（见文件头第三节），所以同一个子集只可能从多条路径到达。
 * 记失败态，下次撞上直接剪掉。记成功态没意义 —— 命中就意味着已经返回了。
 *
 * 【★ 契约：search 不改动盘面（含抛异常这一路）★】
 * 返回时 bd 必须与调用前**一模一样**（连牌的 r/c 都没动过），`plan` 才是结果。
 * 这条踩过**两次**，两次症状完全不同，所以单独说清：
 *   ① 第一次：找到解时是"沿成功路径一路 return true"，撤销被跳过 → 盘面被清空一半。
 *      在离线逐关判定里看不出来（每盘都是新造的，只用 plan），
 *      但真机口径回放是在**活盘面**上边搜边走的 → 一调就炸，报"回放 0/8 通关"。
 *   ② 第二次：撞预算/墙钟时 `throw` 会**跳过沿途所有 undoAction** →
 *      回放继续用一块被拆掉 25 张牌的盘面，报"落位后消的不是计划里的 XX"。
 *      这两次都不是"游戏有问题"，却都以"游戏有问题"的样子报出来。
 * 所以撤销与返回的顺序有讲究，而且**异常路径也必须撤销**（见下面的 catch）：
 *   先撤销、再返回；抛之前先把已落子的栈倒空。
 *
 * ⚠️ 本函数走 `applyAction`，**不触发宝牌赠品** —— 所以它的结论只在
 *    'none' 口径下成立（这正是判据口径固定为 none 的一半原因，见 solvable）。
 */
export function search(bd: Board, pair: PairTable, opt: SearchOpt): SearchOut {
    const fails = new Set<string>();
    const plan: MoveAction[] = [];
    const applied: Applied[] = [];   // 已落子但还没撤销的（异常时按逆序倒空）
    const deadline = opt.deadline;
    let nodes = 0;

    function dfs(): boolean {
        if (bd.remainingPlayable() === 0) return true;
        if (opt.budget !== undefined && nodes++ > opt.budget) stopBudget('节点上限');
        if (deadline && Date.now() > deadline) stopBudget('时间上限');

        const k = stateKey(bd);
        if (fails.has(k)) return false;

        const acts = listActions(bd, pair);
        if (!acts.length) { fails.add(k); return false; }
        // 启发式：先把"点一下就能消"的排前面 —— 这类走法不需要挪动，
        // 落点就是原地，不会受"落位后只消第一个"的影响，最不容易岔开。
        acts.sort((a, b) => (directness(a) - directness(b)) || (a.t.id - b.t.id));
        for (const a of acts) {
            plan.push(a);
            const ap = applyAction(bd, a);
            applied.push(ap);
            const ok = dfs();
            // ★ 先撤销再返回（成功时同样要撤销）—— 见函数头"契约"那段。
            undoAction(bd, ap);
            applied.pop();
            if (ok) return true;
            plan.pop();
        }
        fails.add(k);
        return false;
    }

    try {
        const ok = dfs();
        return { ok, plan: ok ? plan.slice() : null, nodes };
    } catch (e) {
        // ★ 异常这一路也必须把盘面还原：预算哨兵是从很深的地方抛出来的，
        //   沿途那些 undoAction 全被跳过了。不补这一步，调用方（回放 / 运行时）
        //   会拿到一块被拆掉一半的盘面，然后把"搜索自己的错"报成"这一关有问题"。
        while (applied.length) undoAction(bd, applied.pop() as Applied);
        throw e;
    }
}

/**
 * 一次贪心：每步随便挑一个合法走法，直到消空或卡住。
 *
 * ★ 宝牌赠品必须走 `settle`（把赠品记进动作），不能直接 `applyAction` ——
 *   否则这条"贪心"走的是另一套规则，它的结论对真机没有约束力（见 settle 注释）。
 *
 * ⚠️ 本函数**会吃掉盘面**（不还原），调用方要么给崭新副本，要么自己负责。
 *    需要"跑完还我原盘"的，用 `greedyPlan`。
 *
 * bonusMode：'none' 不给赠品（设计判据）/ 'real' 每步现抽（真机）/ 'plan' 留给上层。
 */
export function greedy(bd: Board, pair: PairTable, rng: Rng, bonusMode: BonusMode): GreedyOut {
    const actions: MoveAction[] = [];
    let steps = 0;
    while (bd.remainingPlayable() > 0) {
        const acts = listActions(bd, pair);
        if (!acts.length) return { cleared: false, steps, actions };
        const a = acts[rng.int(0, acts.length)];
        if (bonusMode === 'none') a.bonus = null;   // 明确"这次不送"，别让 settle 去现抽
        settle(bd, pair, rng, a);
        actions.push(a);
        steps++;
        if (steps > 4000) return { cleared: false, steps, actions };   // 兜底，正常绝不会到
    }
    return { cleared: true, steps, actions };
}

/**
 * ★ 换 R 个随机顺序各贪心一次，有一次通关就算"这盘有解"。
 *
 * 【为什么它是主要判据，而不是 DFS】
 * 实测：一盘**有解**的盘面，随机顺序贪心的成功率只有 ~25~35% ——
 * 也就是说**顺序很重要**，"随便怎么消都能通"这件事**不成立**（这条一开始是想当然，
 * 被实测否掉了）。但反过来：随机顺序能通关 ⇒ **这盘一定有解**（贪心走出来的
 * 就是一条真解）。所以"多换几个顺序"是一个**只会漏报、不会误报**的判据 ——
 * 漏报的代价是多抽一次盘，误报的代价是玩家卡死，后者严重得多。
 *
 * 代价实测：一次贪心 ~0.7ms（68 张牌的大盘也一样），所以 R=40 也就 ~30ms。
 * 真正贵的是"证明无解"，那才需要 DFS —— 所以两段式：先贪心后 DFS（见 `solvable`）。
 *
 * 【★★ 指纹断言：这不是洁癖，是真踩过的坑 ★★】
 * `make()` 必须是"同一局面的**崭新副本**"。第一次写 lemma 模式时图省事传了
 * `() => b2` —— 每次拿到的是同一个对象，而 `greedy` 会把它吃掉。
 * 于是第 2 个"重启"是在**已经被吃空的盘面**上重试，必然失败，
 * 报出来的却是"额外拆一对有 47%~80% 概率把盘面变成死局"这种惊人结论。
 * 也就是说：**结论很硬 ≠ 结论对**。加这道指纹，第二次调用对不上就当场炸，
 * 比让人去怀疑"游戏是不是真这么脆"便宜一万倍。
 */
export function greedyAny(
    make: () => Board,
    pairOf: () => PairTable,
    rng: Rng,
    tries: number,
    bonusMode: BonusMode,
): GreedyAnyOut {
    let fp: string | null = null;
    for (let j = 0; j < tries; j++) {
        const bd = make();
        const k = bd.fingerprint();
        if (j === 0) fp = k;
        else if (k !== fp) {
            throw new Error('greedyAny：工厂必须每次返回同一局面的崭新副本，'
                + `第 ${j + 1} 次拿到了不同的盘面\n  期望 ${fp}\n  实得 ${k}`);
        }
        const g = greedy(bd, pairOf(), rng, bonusMode);
        if (g.cleared) return { cleared: true, tries: j + 1, steps: g.steps };
    }
    return { cleared: false, tries, steps: 0 };
}

/**
 * ★ 换 R 个随机顺序贪心，返回**通关那一次的全套走法**（找不到返回 null）。
 *
 * 【为什么回放要它、不要 search】
 * 实测：DFS 在 19~34 手的大盘上"撞预算"是常态 —— 它会一头扎进一棵大子树，
 * 解明明近在眼前也够不着。回放里每步都要重规划，用 DFS 就是"每步都超时"，
 * 然后退化成随机乱走、把局面带进死路。症状是回放只有 80% 通关，
 * 而失败原因写的是"重规划判无解" —— 又一次把工具的问题报成游戏的问题。
 * 贪心换顺序恰好相反：一次 ~0.7ms、成功率 25~35%，两三次就撞上一条真解。
 *
 * 与 `greedyAny` 的区别只在于它**会把盘面还原**并交出整套走法
 * （调用方要拿它的第一步接着往下走，必须留着盘面）。
 *
 * ★ 契约：返回时盘面已还原。
 */
export function greedyPlan(
    bd: Board,
    pair: PairTable,
    rng: Rng,
    tries: number,
    bonusMode: BonusMode,
): GreedyPlanOut {
    for (let j = 0; j < tries; j++) {
        const applied: Applied[] = [];
        const actions: MoveAction[] = [];
        while (bd.remainingPlayable() > 0 && actions.length <= 4000) {
            const acts = listActions(bd, pair);
            if (!acts.length) break;
            const a = acts[rng.int(0, acts.length)];
            if (bonusMode === 'none') a.bonus = null;
            applied.push(settle(bd, pair, rng, a));   // ★ 含宝牌赠品，见 settle 注释
            actions.push(a);
        }
        const cleared = bd.remainingPlayable() === 0;
        while (applied.length) undoAction(bd, applied.pop() as Applied);   // ★ 盘面必须还回来
        if (cleared) return { cleared: true, actions, tries: j + 1 };
    }
    return { cleared: false, actions: null, tries };
}

/**
 * ★ 强规划器：给一个盘面，尽最大努力交出一条**能消空**的走法序列。
 *
 * 【为什么要它，而不是直接 greedyPlan(tries=40)】
 * 实测（L4 某一盘，32 张牌 / 10 个空格）：**一次**随机顺序贪心的成功率只有 **2.5%**。
 * 于是 40 次里一次都不中的概率是 (1-0.025)^40 ≈ 36% —— 而回放把这个
 * "规划器没找到"直接报成了 **"重规划试了 40 个顺序都不通"**，
 * 也就是**把工具的搜索能力不足，说成了这一盘走死了**。同一批盘面上，
 * DFS 只用了 2595 个节点就找到了 16 步的走法。
 *
 * 所以这里沿用两段式，只是要的是**走法本身**：
 *   ① 换 `tries` 个随机顺序贪心（实测 0.4~3ms/次）；
 *   ② 全败再上 DFS 穷尽 —— 要找解通常几毫秒，撞预算就如实报"算不完"。
 *
 * 返回 { ok, actions, via, tries }。`via` 有两件事很要紧：
 *   'greedy' / 'dfs' = **真的没有走法**（`dfs` 这一路是穷尽过的，可以当死局证据）；
 *   'budget'         = **没算完**，绝不能说成死局。
 *
 * ★ 契约：返回时盘面已还原。
 */
export function planFor(
    bd: Board,
    pair: PairTable,
    rng: Rng,
    tries: number,
    budget: number,
    boardMs: number,
): PlanOut {
    const g = greedyPlan(bd, pair, rng, tries, 'none');
    if (g.cleared && g.actions && g.actions.length) {
        return { ok: true, actions: g.actions, via: 'greedy', tries: g.tries };
    }
    try {
        const s = search(bd, pair, { budget: budget || 800000, deadline: Date.now() + (boardMs || 4000) });
        if (s.ok && s.plan && s.plan.length) return { ok: true, actions: s.plan, via: 'dfs', tries: g.tries };
        return { ok: false, actions: null, via: 'dfs', tries: g.tries };
    } catch (e) {
        if (!isBudgetStop(e)) throw e;
        return { ok: false, actions: null, via: 'budget', tries: g.tries };
    }
}

// ============================================================
//  判定层：两段式（先便宜后贵）
// ============================================================

/**
 * 两段式判定：
 *   ① 便宜：换 R 个顺序贪心。能通 → **有解**（构造性证据，最可靠的那种）。
 *   ② 贵：只有 ① 全败才上 DFS。DFS 穷尽 → **真的无解**（可当作死局的证据）；
 *      撞上预算/时间 → 只能说"未知"，绝不能当成无解报出去。
 *
 * ★ 判据的口径固定是 `'none'`（不给赠品）。为什么不是"真机口径"：
 *   赠品是**随机**的，"存在一条运气好的路线"不是玩家能指望的东西。
 *   设计上该问的是"这张牌面本身是不是死局"—— 去掉运气因素才问得清楚。
 *   真机上"外加赠品运气"能不能通，由 `--bonus real` 的回放单独回答，
 *   两个数字一起看才有意义（见文件头第四节）。
 *
 * ⚠️ 这里给的"无解"是**在"把某张牌拖到某个可达格"这个动作集上**穷尽的
 *    （见文件头第三节：严格回弹下盘面只会因为消对而变，而"被推的牌停在哪"
 *    也由落点唯一决定，所以这个动作集就是全部）。
 *    动作集由 `listActions` 按**引擎口径**算出（`firstHit`：落位后第一个被消的是谁）。
 *    `search` 走的是 `applyAction`，它**不触发赠品** —— 所以 DFS 的结论
 *    只在 'none' 口径下成立。
 *
 * ★ 契约：返回时盘面已还原。
 */
export function solvable(
    make: () => Board,
    pairOf: () => PairTable,
    opts: SolverOpts & { seed: number },
): SolverOut {
    const g = greedyAny(make, pairOf, new Rng(opts.seed), opts.tries, 'none');
    if (g.cleared) return { verdict: 'YES', via: 'greedy', tries: g.tries, steps: g.steps };
    try {
        const s = search(make(), pairOf(), { budget: opts.budget, deadline: opts.boardDeadline });
        return s.ok
            ? { verdict: 'YES', via: 'dfs', tries: g.tries, steps: s.plan ? s.plan.length : 0 }
            : { verdict: 'NO', via: 'dfs', tries: g.tries, steps: 0 };
    } catch (e) {
        if (!isBudgetStop(e)) throw e;
        return { verdict: 'UNKNOWN', via: 'budget', tries: g.tries, steps: 0 };
    }
}

/**
 * ★ 就地判定（运行时用）：**不重造盘面**，直接在一个活盘面上判，返回时原样奉还。
 *
 * 与 `solvable` 的唯一区别是"牌从哪来"：
 *   `solvable`      拿工厂，每次 `make()` 一份崭新副本（离线逐关判定用）；
 *   `solvableInPlace` 就地判（重排之后手上就这一个盘面，没有第二份可造）。
 * 判据本身、两段式顺序、`'none'` 口径**完全一样** —— 这正是把内核抽出来的意义。
 *
 * ★ 契约：返回时盘面已还原。为什么这里用 `greedyPlan` 而不是 `greedyAny`：
 *   `greedyAny` 每轮都要 `make()` 一份新盘（离线判定的工厂），而运行时只有手上这一份；
 *   `greedyPlan` 就地跑多轮、自己 undo，两者**消耗 RNG 的次数与顺序完全相同**
 *   （都是每步一次 `int`、同样轮数），所以两条路径对同一盘面给出的判定逐字一致。
 */
export function solvableInPlace(
    bd: Board,
    pair: PairTable,
    rng: Rng,
    opts: SolverOpts,
): SolverOut {
    const g = greedyPlan(bd, pair, rng, opts.tries, 'none');
    if (g.cleared) {
        return { verdict: 'YES', via: 'greedy', tries: g.tries, steps: g.actions ? g.actions.length : 0 };
    }
    // ★ 预算 <= 0、或已经过期 = 调用方明确说"这一轮不做 DFS"（运行期省算力用）。
    //   此时**不许**报 NO —— 没搜过就断言"这盘无解"，是把"没找"说成"没有"。
    //   返回 UNKNOWN + via:'greedy'，含义是"只做了便宜的那一档，既没找到证据、
    //   也没排除"，调用方据此决定是继续换顺序，还是收下这个局面。
    if (!(opts.budget > 0) || !(opts.boardDeadline > Date.now())) {
        return { verdict: 'UNKNOWN', via: 'greedy', tries: g.tries, steps: 0 };
    }
    try {
        const s = search(bd, pair, { budget: opts.budget, deadline: opts.boardDeadline });
        return s.ok
            ? { verdict: 'YES', via: 'dfs', tries: g.tries, steps: s.plan ? s.plan.length : 0 }
            : { verdict: 'NO', via: 'dfs', tries: g.tries, steps: 0 };
    } catch (e) {
        if (!isBudgetStop(e)) throw e;
        return { verdict: 'UNKNOWN', via: 'budget', tries: g.tries, steps: 0 };
    }
}
