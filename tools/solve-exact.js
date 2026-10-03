/* ============================================================
 *  solve-exact.js · 「开局有解」求解器（第 3 关 → 第 38 关）
 * ============================================================
 *  用户 2026-10-03 拍板过一条硬规矩：**每一关设计后固定下来，开局要确定有解**。
 *  可在那之前，第 3~38 关从来没有被真正验证过 —— 只有 `lv.n <= 3` 的教学关
 *  在 `generateBoard` 里做了一次「必须有一对直接可消」的重排。
 *  这个工具就是那份欠账：逐关抽样随机盘面，判定它**能不能被打通**。
 *
 *  ------------------------------------------------------------------
 *  一、本工具不重写规则（这是最重要的一条）
 *  ------------------------------------------------------------------
 *  规则永远只有一份真源：`assets/scripts/core/Board.ts`。
 *  重写一遍的后果不是"多写点代码"，而是**验证的对象变成了另一套规则** ——
 *  上一版原型正是这么栽的：拖动限制 / 提示 / 死局检测各写一套判定，
 *  结果提示给出的走法玩家拖不过去，死局检测还会误判（见 Board.ts 文件头）。
 *
 *  所以这里沿用 `tools/core-selftest.js` 的老套路：
 *  用 Cocos 自带的 tsc 把 core/*.ts 编成 CommonJS 到临时目录，再 require 出来。
 *  `slideRange` / `reachableCells` / `lineClear` / `matchTargets` / `canPair` /
 *  `randomNormalPair` 全部调真源。
 *
 *  ★ 2026-10-03 又往前推了一步：**连"搜索策略"也一并搬走了**。
 *  这一层原本写在本文件里，而 `GamePage.reshuffleRemaining` 另有一套
 *  （只查 `hasDirectMatch || findSuggest`，也就是**只保证"至少有一对能消"**）——
 *  "这盘还有没有解"于是有两个各自为政的判定，而被玩家天天看见的偏偏是后者：
 *  他点「看广告重排」收到"盘面已重排"的正反馈，结果只消一对又被卡住。
 *  现在内核统一在 `game-5-chaizi/assets/scripts/core/Solver.ts`：
 *  本文件 **require 它**，游戏侧 **import 它**，判据只可能有一份。
 *  本文件从此只剩**编排**（CLI / 造盘工厂 / 各 --mode 的统计与输出）。
 *  详见下面"规则层 / 搜索层"那一段。
 *
 *  ------------------------------------------------------------------
 *  二、整盘只有「消掉一对」会改状态（这条是全工具的支点）
 *  ------------------------------------------------------------------
 *  严格回弹（用户 2026-10-02 拍板）意味着：
 *    拖出去、落位凑不成字 → 牌沿原路滑回去，`_cells` 与牌的 r/c **从未变过**
 *    （`GamePage.reboundTile` 的注释写了："整个拖动过程只改节点的 position"）。
 *  于是**任何一张牌，只要能消，它就是被删掉；消不掉，它就在原地没动**。
 *  没有任何一张牌会永久停在新位置上。
 *
 *  这条一口气砍掉了整个搜索空间的一个维度：
 *    · **状态 = 初始牌的一个子集**（牌位恒定，不用记录谁在哪）；
 *    · 走法 = 「消掉哪一对」；
 *    · 通关 ⟺ 能把这份子集一路消空。
 *
 *  ------------------------------------------------------------------
 *  三、宝牌怎么算（口径写在明处；这条**被实测改过一次**，下面留了旧论证的尸体）
 *  ------------------------------------------------------------------
 *  宝牌成对时会**额外随机消掉一对普通牌**（`Board.randomNormalPair`）。
 *  这个"随机"是本工具最麻烦的地方：玩家不可控，所以严格说这是**非确定**玩法。
 *  本工具的口径是两档（**缺一不可**，原因见本节末尾的实测）：
 *
 *    `--bonus none`  去掉运气因素，回答"**这张牌面本身是不是死局**"（判据口径）
 *    `--bonus real`  赠品每次现抽，回答"**玩家真遇上时能不能通**"（真机口径）
 *
 *  【旧口径（错）：求解时把宝牌当普通成对牌处理 —— 只消那两张，不做额外消除】
 *  当初的依据写在这里，两条里有一条被推翻了，原样留档以免有人再想一遍：
 *
 *    ·【结构层·✅ 成立】`randomNormalPair` 的候选集只含 `pair.canPair()` 为真的对，
 *      也就是"本身就能合成一个字的偏旁+部件"。而一个关卡的牌堆 D 恒等于
 *      ⊎_w n_w·{a_w, b_w}（`buildDeck` 就是这么发的）。拆掉其中任意一个合法对，
 *      等价于把某个 n_{w0} 减 1 —— 剩下的仍然是若干"字对"的并集，**永远配得满**。
 *      ⇒ 额外消除不会让某两个字变得凑不出来（上一版从"任意两张普通牌"里随机，
 *        三成概率拆散一对凑不成的牌，那才是真的会造出死局 —— 见 `randomNormalPair`
 *        的注释，用户当时拍板的选项 A 就是为堵这个洞）。
 *
 *    ·【几何层·❌ 被推翻】"额外消除**只会少两张牌**，而少牌只会让别的牌更好挪
 *      （`slideRange` 单调不缩、`lineClear` 单调变松），所以多消一对不可能把
 *      可通关变成不可通关" —— **每半句都认，合起来是错的**。少牌确实让
 *      "两张牌之间能不能连上"变松，但**该连的是谁**变了：
 *      设原方案把 A 与 C 配、B 与 D 配；赠品把 A、B 拿走（它俩能合成一个字，
 *      完全合法），剩下的 C、D 虽然同属一个字、配对也合法，**几何上却可能永远碰不到面**
 *      —— 被拆掉的那一对本来承担着"把某个字引到能碰面的位置"。
 *
 *  【结论：赠品**真的**会把可通关变成不可通关 —— 实测 9.0%】
 *  实测（`--mode levels --bonus real`，36 关 × 8 盘里"模型说有解"的 221 盘）：
 *    `--bonus real`  → **201/221 通关**，20 盘被赠品带进死局（9.0%）
 *    `--bonus none`  → **221/221 通关**
 *  两个数字之间的差额，就是"赠品这一步随机"的全部代价。
 *
 *  ⚠️ 上面 `--bonus none` 那一行还有第二重身份：**工具对账档**。
 *    这一档里规划器与回放走的是同一套规则，所以在"模型说 YES"的盘面上
 *    它**必须 100% 通关**（实测 221/221 成立）。这条是"工具与真源没有分叉"
 *    最直接的证据 —— **它一旦掉下来，先查工具**，别去怀疑游戏。
 *    另一条边界：本工具给出的是**「存在通关路径」**（∃），
 *    不是"无论赠品送掉哪一对都通关"（∀）—— 后者要枚举全部候选组合
 *    （3 对宝牌 × 上百候选 → 组合爆炸），而这**正是上面那 9% 的来处**：
 *    光要求 ∃ 就已经保不住玩家了。
 *
 *  ------------------------------------------------------------------
 *  四、各个模式各自回答什么
 *  ------------------------------------------------------------------
 *    --mode order    同一盘换 K 个随机顺序各贪心一次，看"一次贪心"的命中率。
 *                    这个数字直接决定 `--restarts` 要多少才够（实测有盘只有 2.5%）。
 *    --mode lemma    盘中额外拆掉一个合法对，是否仍可通关？三口径各测一遍。
 *    --mode playout  按**引擎口径**逐字回放（hits[0] + randomNormalPair + RNG）；
 *                    `--bonus` 决定赠品是现抽（real）还是不抽（none）。
 *    --mode levels   逐关抽样判定（默认模式）+ 真机口径回放
 *
 *  用法：
 *    node tools/solve-exact.js --mode levels --levels 3-38 --seeds 60
 *    node tools/solve-exact.js --mode theorem --seeds 40
 *    node tools/solve-exact.js --mode playout --seeds 30 --time 120000
 *  退出码：0 = 全部通过；1 = 有 STUCK / BUDGET；2 = 环境问题（缺 tsc）。
 * ============================================================ */
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.dirname(__dirname);
const SCRIPTS = path.join(ROOT, 'game-5-chaizi', 'assets', 'scripts');
const TSC = '/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/Resources/app.asar.unpacked/node_modules/typescript/bin/tsc';
const NODE = process.execPath;
const OUT = path.join(os.tmpdir(), 'chaizi-solve-exact');

// ------------------------------------------------------------
//  CLI
// ------------------------------------------------------------
function parseArgs(argv) {
    const o = { mode: 'levels', levels: '1-38', seeds: 40, restarts: 100, budget: 800000, boardTime: 4000, time: 600000, json: '', verbose: false, bonus: 'none', planTries: 200 };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        const val = () => argv[++i];
        if (a === '--mode') o.mode = val();
        else if (a === '--levels') o.levels = val();
        else if (a === '--seeds') o.seeds = parseInt(val(), 10);
        else if (a === '--restarts') o.restarts = parseInt(val(), 10);
        else if (a === '--bonus') o.bonus = val();
        else if (a === '--plan-tries') o.planTries = parseInt(val(), 10);
        else if (a === '--budget') o.budget = parseInt(val(), 10);
        else if (a === '--board-time') o.boardTime = parseInt(val(), 10);
        else if (a === '--time') o.time = parseInt(val(), 10);
        else if (a === '--json') o.json = val();
        else if (a === '--verbose' || a === '-v') o.verbose = true;
        else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
        else { console.error('未知参数：' + a); printHelp(); process.exit(2); }
    }
    if (!['none', 'real'].includes(o.bonus)) {
        console.error(`--bonus 只认 none|real，收到「${o.bonus}」`);
        process.exit(2);
    }
    return o;
}

function printHelp() {
    console.log([
        'solve-exact.js · 拆字连连看「开局有解」求解器',
        '',
        '  --mode levels|order|lemma|playout    默认 levels',
        '  --levels 1-38                        关号区间',
        '  --seeds 40                           每关抽多少盘随机盘面',
        '  --restarts 100                       每盘换多少个随机顺序贪心（判"有解"用；全败才上 DFS）',
        '  --bonus none|real                    宝牌赠品口径（决定"有解"到底在问什么）：',
        '                                       none=不触发赠品（默认；设计判据，也是回放对账档）',
        '                                       real=每次现抽（真机口径：玩家真遇上时能不能通）',
        '  --plan-tries 200                     回放中方案失效时重规划换多少个顺序（全败再上 DFS）',
        '  --budget 800000                      单盘 DFS 节点上限（只有贪心全败才用）',
        '  --board-time 4000                    单盘 DFS 墙钟上限（毫秒）',
        '  --time 600000                        整轮墙钟上限（毫秒）',
        '  --json <path>                        把结果写成 JSON 归档',
        '  -v, --verbose                        打印每盘明细与失败盘面',
    ].join('\n'));
}

function parseLevels(spec) {
    const out = [];
    for (const part of String(spec).split(',')) {
        const m = /^(\d+)\s*-\s*(\d+)$/.exec(part.trim());
        if (m) { for (let n = +m[1]; n <= +m[2]; n++) out.push(n); }
        else if (/^\d+$/.test(part.trim())) out.push(+part.trim());
    }
    return out;
}

// ------------------------------------------------------------
//  ⓪ 编译 core/ 到临时目录（与 tools/core-selftest.js 同一套路）
// ------------------------------------------------------------
function compileCore() {
    if (!fs.existsSync(TSC)) {
        console.error('✖ 找不到 Cocos 自带的 tsc：' + TSC);
        console.error('  （本机没装全局 typescript，也不该为一个检查去全局装 —— 所以借 Cocos 里的那份）');
        process.exit(2);
    }
    const need = ['Types', 'Rng', 'Treasure', 'LevelData', 'Board', 'Solver'];
    // ★ 增量复用：这五个文件的 mtime 都没变就直接用上次的编译产物。
    //   省掉的不是几秒，而是"每次想跑一下判定都得先等编译"这件事 ——
    //   一旦嫌慢，工具就会被绕过，绕过就等于没有。
    let fresh = false;
    try {
        let newest = 0;
        for (const n of need) {
            const p = path.join(SCRIPTS, 'core', n + '.ts');
            newest = Math.max(newest, fs.statSync(p).mtimeMs);
        }
        const stamp = path.join(OUT, '.stamp');
        if (fs.existsSync(stamp) && +fs.readFileSync(stamp, 'utf8') >= newest) fresh = true;
    } catch (_) { fresh = false; }

    if (!fresh) {
        fs.rmSync(OUT, { recursive: true, force: true });
        const r = spawnSync(NODE, [
            TSC,
            '--module', 'commonjs',
            '--target', 'es2020',
            '--moduleResolution', 'node',
            '--skipLibCheck',
            '--strict',
            '--noImplicitAny', 'true',
            '--outDir', OUT,
            '--rootDir', SCRIPTS,
            ...need.map((n) => path.join(SCRIPTS, 'core', n + '.ts')),
        ], { encoding: 'utf8' });
        const txt = (r.stdout || '') + (r.stderr || '');
        if (r.status !== 0) {
            console.error('✖ core/ 编译失败：\n' + txt);
            process.exit(2);
        }
        let newest = 0;
        for (const n of need) newest = Math.max(newest, fs.statSync(path.join(SCRIPTS, 'core', n + '.ts')).mtimeMs);
        fs.writeFileSync(path.join(OUT, '.stamp'), String(newest));
    }
    const coreDir = path.join(OUT, 'core');
    CORE = {
        Board: require(path.join(coreDir, 'Board.js')).Board,
        PairTable: require(path.join(coreDir, 'Board.js')).PairTable,
        generateBoard: require(path.join(coreDir, 'Board.js')).generateBoard,
        LEVELS: require(path.join(coreDir, 'LevelData.js')).LEVELS,
        Rng: require(path.join(coreDir, 'Rng.js')).Rng,
        // ★ 规则层 + 搜索层的唯一内核（游戏侧 import 的是同一个文件）。
        Solver: require(path.join(coreDir, 'Solver.js')),
    };
    return CORE;
}

/**
 * 模块级的"真源句柄"。
 * ★ 为什么要有它：`solvable` / `greedyAny` 这类**策略函数**只需要 `Rng`，
 *   而 `Rng` 是编译产物、得先编译才有。把它们做成"必须先传进来"会让调用点
 *   到处铺开一层样板；做成模块级单例（编译一次、缓存）反而更短也更不容易漏。
 */
let CORE = null;
function rngOf(seed) {
    if (!CORE) compileCore();
    return new CORE.Rng(seed);
}

// ============================================================
//  规则层 / 搜索层：★ 已搬到 core/Solver.ts（工具与游戏共用同一份）
// ============================================================
//  【为什么要搬】(2026-10-03 用户拍板方案 A)
//  在此之前，"这盘还有没有解"有两个各自为政的判定：本工具一套；
//  `GamePage.reshuffleRemaining` 另一套，而它只查
//  `hasDirectMatch || findSuggest` —— **只保证"至少有一对能消"**。
//  被玩家看见的偏偏是后者：点「看广告重排」收到"盘面已重排"的正反馈，
//  结果只消一对又被卡住，只能再点一次广告。
//  **一套规则写两遍的下场，上一版原型已经演示过一次**（拖动限制 / 提示 /
//  死局检测各写一套，最后提示给出的走法玩家拖不过去）。
//  现在两边 require 同一个 `core/Solver.ts`：判据要改，两边同时改，
//  **不可能再分叉**。那些踩坑记录（firstHit 必须精确到"落位后第一个"、
//  settle 的 undefined/null/[a,b] 三态、search 不许改盘面…）**全部随内核迁走**，
//  本文件不再各留一份 —— 两份注释迟早会互相矛盾。
//
//  【本文件现在只剩"编排"】CLI / 造盘工厂 / 各 --mode 的统计与输出。
//  下面这些名字保留为**一层转发壳**，而不是删掉再把几十处调用点逐个改遍：
//  壳让"这里已不是真源"写在明处，且 `module.exports` 的形状不变，
//  调试脚本（`node -e "require('./tools/solve-exact.js')"`）不用跟着改。
//
//  ⚠️ 壳里一律走 `S()`（惰性取编译产物）：`CORE` 是编译之后才有的，
//     文件加载时就抓函数会抓到 undefined。
// ============================================================

function S() {
    if (!CORE) compileCore();
    return CORE.Solver;
}

// —— 以下均为 core/Solver.ts 的转发壳（形参顺序与内核一致）——
const firstHit = (bd, pair, t, x) => S().firstHit(bd, pair, t, x);
const listActions = (bd, pair) => S().listActions(bd, pair);
const applyAction = (bd, a) => S().applyAction(bd, a);
const undoAction = (bd, gone) => S().undoAction(bd, gone);
const settle = (bd, pair, rng, a) => S().settle(bd, pair, rng, a);
const stateKey = (bd) => S().stateKey(bd);
const search = (bd, pair, opt) => S().search(bd, pair, opt);
const greedy = (bd, pair, rng, bonusMode) => S().greedy(bd, pair, rng, bonusMode);
const greedyAny = (make, pairOf, rng, tries, bonusMode) => S().greedyAny(make, pairOf, rng, tries, bonusMode);
const greedyPlan = (bd, pair, rng, tries, bonusMode) => S().greedyPlan(bd, pair, rng, tries, bonusMode);
const planFor = (bd, pair, rng, tries, budget, boardMs) => S().planFor(bd, pair, rng, tries, budget, boardMs);
const solvableInPlace = (bd, pair, rng, opts) => S().solvableInPlace(bd, pair, rng, opts);

// `solvable` 的形参名与内核不同（工具这侧叫 restarts），在这里对一次账。
// 除此之外逐字等同内核：贪心换顺序 → 全败上 DFS → 撞预算报 UNKNOWN。
const solvable = (make, pairOf, opts) => S().solvable(make, pairOf, {
    tries: opts.restarts,
    budget: opts.budget,
    boardDeadline: opts.boardDeadline,
    seed: opts.seed,
});

/**
 * 宝牌"额外消掉一对"的候选集，按三种口径取（只取普通牌，宝牌不参与）。
 *   any    = 任意能合成的对 —— **现行实现**（`Board.randomNormalPair` 就是这个口径）
 *   legal  = 当前**真能消掉**的对（`listActions`，也就是玩家此刻做得到的）
 *   direct = 当前**已经对齐、点一下即消**的对（更窄）
 *
 * 之所以要分三档：`--mode lemma` 实测出"多消一对**可能**把可通关变成不可通关"，
 * 那就要看把候选集收窄到哪一档才安全。收窄只影响"送哪一对"，不影响机制本身。
 *
 * ★ 这是**工具特有的实验口径**，玩法里没有对应物，所以没跟着内核搬走。
 */
function pickCands(bd, pair, rule) {
    const normal = (t) => t.kind !== 'treasure' && t.kind !== 'junk';
    if (rule === 'any') {
        const ts = bd.allTiles().filter(normal);
        const out = [];
        for (let i = 0; i < ts.length; i++) {
            for (let j = i + 1; j < ts.length; j++) {
                if (pair.canPair(ts[i], ts[j])) out.push({ t: ts[i], o: ts[j] });
            }
        }
        return out;
    }
    const acts = listActions(bd, pair).filter((a) => normal(a.t) && normal(a.o));
    if (rule === 'legal') return acts;
    return acts.filter((a) => bd.lineClear(a.t, a.o));
}

/** 盘面指纹（谁在哪）—— 直接调真源的 `Board.fingerprint()`，本工具不再自己实现一份。
 *  它有两处用处，都是断言：
 *    ① `greedyAny` 断言"工厂给的确实是同一盘的崭新副本"；
 *    ② 挑种子时断言"4 颗种子给出的是 4 个**不同**的盘面"（否则玩家会看到重样）。 */
function fpOf(bd) {
    return bd.fingerprint();
}

/** 按 id 摘掉两张牌 —— 给"重造同一局面"的工厂用 */
function killByIds(bd, ids) {
    for (const id of ids) {
        const t = bd.allTiles().find((x) => x.id === id);
        if (t) bd.setCellRaw(bd.idx(t.r, t.c), null);
    }
    return bd;
}

/**
 * ★ 按**引擎口径**回放一局（`--mode playout`）。
 *
 * 与 search 的区别，恰恰是它存在的理由：
 *   · search 问"有没有一条路"，它问"玩家真按下去会发生什么"；
 *   · 引擎的走法是「(牌, 落点)」，落位后由 `matchTargets(t)[0]` 决定消谁 ——
 *     我们规划的搭档**可能不是第一个**（比如落点这一行里另有一张更靠前的可配对牌）。
 *     这不是实现细节，是玩家真会遇到的手感：想凑「杏」却先被消成了「桃」。
 *   · 宝牌额外消除走真 RNG（`randomNormalPair`），送掉哪一对不由我们定。
 * 所以 `--mode playout` 的通过率，才是"玩家会不会被卡死"最直接的证据。
 *
 * policy：'replan' = **照着一条已找到的方案走**，方案失效时才重规划；
 *         'random' = 随机挑（用来测"任意顺序都行"在真引擎下是否也成立）。
 *
 * bonus： 'real' = 宝牌赠品**每次现抽**（真机口径，玩家真实遇到的那种）；
 *         'none' = 不触发赠品。这一档同时是**工具对账档**：
 *                  规划器与回放走的是同一套规则（都不发赠品），
 *                  所以在"模型说 YES"的盘面上它必须 100% 通关 ——
 *                  **跑不满 100%，问题一律在工具这边，与游戏无关**。
 *
 * ★ 为什么是"跟着方案走"而不是"每步重规划"（2026-10-03 实测踩到）
 * 每一步都从零重抽一条方案，等于**每一步都把手上的解丢掉重新碰运气**：
 * 明明上一秒已经有一条通关路线，第二手却要再赌一次 25~35% 的命中率。
 * 一次赌输就报"这盘走死了" —— 而它其实有解。症状是 L13 某一盘在第 1 手之后
 * 就报死，可那盘的 46 张牌明明还有大把走法。
 * 现在只有**方案真的失效**（宝牌送掉的那一对把后续步骤的牌拿走了）才重规划。
 *
 * ★ 方案记的是"消掉哪一对"，落点在执行时现查（`bind`）
 * 方案里的 `x` 是**规划那一刻**算出来的（`firstHit(x) === o`）。盘面一变
 * （宝牌送牌、别的对先被消），同一个 x 未必还锁得住同一个 o。若死认那个 x，
 * 就会报"落位后消的不是计划里的 X" —— 可当时的盘面上**明明还有别的落点**能消掉这一对。
 * 玩家的做法本来也是"贴着 o 落"，而不是背下一个坐标。
 *
 * ★★ 2026-10-03 推箱上线后，这条"换落点无所谓"的论证**只对了一半** ★★
 * 推箱之前它成立的理由是"(t,o) 相同的两条走法产生的新局面一模一样
 * （都只是把这两张牌拿掉）"。
 * 现在**不一样了**：从不同落点过去，被推的那一串牌落在哪是不同的，
 * 于是后续步骤面对的盘面不同、原先的落点也就未必还锁得住同一个 o。
 *
 * 所以 `bind` 改成**两级**：
 *   ① 先认"连落点都完全一致"的那一条（方案原样成立，最可信）；
 *   ② 找不到再退而认 (t,o) 一致但落点不同的那一条 —— 但**记一笔 replanFails**，
 *      因为它意味着这条方案的后半段已经失准了，数字要如实反映出来。
 */
function playReal(bd, pair, rng, policy, opt) {
    const bonusMode = opt.bonus || 'none';
    let steps = 0;
    let replanFails = 0;
    let plan = [];                     // 手上那条方案的剩余步骤
    // 方案里的 (t,o[,x]) → 此刻能做到它的走法；exact=false 表示落点已经变了
    const bind = (a, acts) => {
        let loose = null;
        for (const c of acts) {
            if (c.t !== a.t || c.o !== a.o) continue;
            if (c.x.r === a.x.r && c.x.c === a.x.c) return { act: c, exact: true };
            if (!loose) loose = c;
        }
        return loose ? { act: loose, exact: false } : null;
    };
    while (bd.remainingPlayable() > 0) {
        let acts = listActions(bd, pair);
        if (!acts.length) return { cleared: false, steps, replanFails, left: bd.remainingPlayable(), why: '无可消对' };
        let a = null;
        if (policy === 'replan') {
            // 把方案里**还成立**的步骤依次用掉；牌已经被拿走的那些直接跳过。
            while (plan.length) {
                const got = bind(plan.shift(), acts);
                if (got) {
                    a = got.act;
                    if (!got.exact) replanFails++;   // 落点变了：方案后半段已失准，记一笔
                    break;
                }
                replanFails++;              // 记一笔：计划被打断过（多半是宝牌送牌）
            }
            if (!a) {
                // 方案用完/失效 → 重规划（贪心换顺序，全败再上 DFS；见 planFor 注释）。
                const got = planFor(bd, pair, rng, opt.planTries || 200, opt.budget, opt.boardTime);
                if (got.ok) plan = got.actions.slice(1), a = got.actions[0];
                else if (got.via === 'budget') {
                    // 算不完 ≠ 走死了。分开记账，别把"没算完"报成"卡死"。
                    return { cleared: false, steps, replanFails: replanFails + 1, left: bd.remainingPlayable(), why: '规划没算完（DFS 撞预算）' };
                } else {
                    // 换满顺序 + DFS 穷尽都没路 ⇒ 这盘**真的走死了**。
                    // 最典型的原因：宝牌刚送掉的那一对把盘面拆坏了（见文件头第三节）。
                    return { cleared: false, steps, replanFails: replanFails + 1, left: bd.remainingPlayable(), why: `重规划试了 ${got.tries} 个顺序 + DFS 穷尽，都无路` };
                }
            }
        } else {
            a = acts[rng.int(0, acts.length)];
        }
        if (!a) return { cleared: false, steps, replanFails, left: bd.remainingPlayable(), why: '计划为空' };

        // —— 从这一步起，完全按引擎来（`GamePage.applyMove` → `matchTargets[0]`）——
        // ① 落位之后引擎会消掉谁：**直接问内核的 `firstHit`**。
        //    ★ 2026-10-03 推箱之前，这里是手写的一段"把 t 搬过去、matchTargets、
        //      再搬回来"。它当时是对的，但推箱之后**必须是"整段一起搬"** ——
        //      手写第二遍就是把 S15 好不容易并成一份的规则又抄了一份出来。
        //      现在换成 `firstHit`：它内部走 `Board.dragMoves/applyDrag/undoDrag`，
        //      与游戏、与 `_simulate`、与 `search` 是同一份规则，且自带盘面还原。
        //    （原来那段注释里"必须把格子与牌的 r/c 一起还原干净"的教训，
        //      现在由 `Board.undoDrag` 承担 —— 只有一处需要记得。）
        const x = a.x;
        const hit = firstHit(bd, pair, a.t, x);
        // ★ x 来自 `listActions`（落位后 `firstHit` 恰好是 o），所以这里**必然**命中 a.o。
        //   留着这条判断是当断言用 —— 一旦它响了，说明两处口径真的分叉了，
        //   那才是必须停下来查的大事。
        if (!hit || hit !== a.o) {
            return { cleared: false, steps, replanFails, left: bd.remainingPlayable(), why: `落位后消的不是计划里的 ${a.o.char}（模型与引擎不一致，落点 ${x.r},${x.c}）` };
        }
        // ② 结算：t 与 hit 两张牌拿掉；宝牌则另按真源规则额外送掉一对
        //    赠品口径：'real' = 现抽（真机）；'none' = 不送；'plan' = 认方案里预记的那一份（对账用）
        if (bonusMode === 'real') {
            a.bonus = undefined;                       // 现抽 —— 不信方案里记的那份
            plan = [];                                 // 现抽之后，方案的后半段不再可信
        } else if (bonusMode === 'none') {
            a.bonus = null;                            // 明确"不送"，别让 settle 去现抽
        }
        settle(bd, pair, rng, a);
        steps++;
        if (steps > 4000) return { cleared: false, steps, replanFails, left: bd.remainingPlayable(), why: '步数爆表' };
    }
    return { cleared: true, steps, replanFails };
}

// ============================================================
//  主流程
// ============================================================
function main() {
    const opt = parseArgs(process.argv);
    const t0 = Date.now();
    const { Board, PairTable, generateBoard, LEVELS, Rng } = compileCore();
    const byN = new Map(LEVELS.map((l) => [l.n, l]));
    const deadline = t0 + opt.time;

    const lines = [];
    const say = (s) => { lines.push(s); console.log(s); };

    say('拆字连连看 · 「开局有解」求解器');
    say(`规则真源：game-5-chaizi/assets/scripts/core/Board.ts（直接 require 编译产物，本工具不重写规则）`);
    say(`模式=${opt.mode} 每关盘面数=${opt.seeds} 节点上限=${opt.budget} 墙钟上限=${Math.round(opt.time / 1000)}s`);
    say(`判定口径=${opt.bonus}` + (opt.bonus === 'none'
        ? '（不发宝牌赠品 · 设计判据 / 工具对账档）' : '（宝牌赠品每次现抽 · 真机口径）'));
    say('');

    const result = { mode: opt.mode, seeds: opt.seeds, startedAt: new Date(t0).toISOString(), levels: {}, extra: {} };

    // ---------- 造盘：同一种子序列，保证可复现 ----------
    const MASTER = 20261003;
    function buildBoard(lv, seed) {
        const pair = new PairTable(lv.words);
        const bd = generateBoard(lv, pair, new Rng(seed));
        return { bd, pair };
    }
    function seedFor(lv, k) {
        // 一个固定的主 RNG 派生每盘的种子 —— 这样"跑的是哪 60 盘"是可复现的，
        // 失败盘的种子能原样报出来。
        const r = new Rng(MASTER + lv.n * 100003);
        for (let i = 0; i <= k; i++) r.next();
        return r.int(1, 0x7fffffff);
    }

    // ----------------------------------------------------------
    //  造盘工厂
    //  ├─ `mk(lv,seed)` 造真实的一盘（generateBoard，与真机同一条路径）
    //  └─ `solvable` 要的是"工厂"而不是"一盘"：贪心会吃掉盘面，
    //     每换一个顺序都得重造一次，否则测的就不是同一盘了。
    // ----------------------------------------------------------
    const mk = (lv, seed) => {
        const pair = new PairTable(lv.words);
        const bd = generateBoard(lv, pair, new Rng(seed));
        return { bd, pair };
    };
    const makeFac = (lv, seed) => () => mk(lv, seed).bd;
    const pairFac = (lv) => () => new PairTable(lv.words);
    const lvs = parseLevels(opt.levels).map((n) => byN.get(n)).filter(Boolean);
    const boardOpt = (seed) => ({
        restarts: opt.restarts,
        budget: opt.budget,
        boardDeadline: Date.now() + opt.boardTime,
        seed: (seed ^ 0x5bf03635) >>> 0,
    });

    if (opt.mode === 'order') {
        // ============================================================
        //  顺序敏感性：一盘"有解"的盘面，随便挑一个顺序贪心，有多大把握？
        //  这个数字直接决定"运行时开局自检"要换多少个顺序才便宜又够准。
        // ============================================================
        say('顺序敏感性：同一盘面换不同随机顺序做贪心，看「一次贪心」的命中率');
        say(`  每关 ${opt.seeds} 盘 × 每盘最多 ${opt.restarts} 个顺序`);
        say('');
        const stat = {};
        for (const lv of lvs) {
            if (Date.now() > deadline) { say('（墙钟到点，提前收尾）'); break; }
            const tries = [];
            let fail = 0;
            for (let k = 0; k < opt.seeds; k++) {
                const seed = seedFor(lv, k);
                const g = greedyAny(makeFac(lv, seed), pairFac(lv), new Rng(31415 + k * 271), opt.restarts, 'none');
                if (g.cleared) tries.push(g.tries);
                else fail++;
            }
            const n1 = tries.filter((x) => x === 1).length;
            const n5 = tries.filter((x) => x <= 5).length;
            const n10 = tries.filter((x) => x <= 10).length;
            const avg = tries.length ? (tries.reduce((a, b) => a + b, 0) / tries.length) : 0;
            say(`L${String(lv.n).padStart(2)} 找到解的 ${String(tries.length).padStart(2)}/${opt.seeds}`
                + ` · 第 1 个顺序就中 ${n1} · ≤5 中 ${n5} · ≤10 中 ${n10}`
                + ` · 平均要 ${avg.toFixed(1)} 个顺序 · 全败 ${fail}`);
            stat[lv.n] = { solved: tries.length, seeds: opt.seeds, first: n1, le5: n5, le10: n10, avgTries: +avg.toFixed(2), allFail: fail };
        }
        result.extra = stat;
        finish(opt, result, lines, t0, true);
        return;
    }

    if (opt.mode === 'lemma') {
        // ============================================================
        //  「宝牌额外消掉的那一对，会不会把'可通关'变成'不可通关'？」
        //  —— 三种候选口径各测一遍，看哪一种安全。
        //
        //  ★ 这条一开始是我的想当然："少两张牌只会更好挪，所以额外消除不可能坏事"。
        //    实测把它推翻了：牌数守恒、每个字仍然配得满（换是配得满的"字对"的并集），
        //    但**几何上**会卡死 —— 被拆掉的那一对本来承担着"把某个字引到能碰面的位置"。
        //    所以这不是可以靠嘴论证的事，必须逐盘实测。
        // ============================================================
        say('宝牌额外消除的安全性实测');
        say('  对每一盘"有解"的盘面：额外拆掉一对普通牌，再看这盘是否仍有解');
        say('  候选口径：any=任意能合成的对（现行实现） / legal=此刻真消得掉的对 / direct=已对齐、点一下即消的对');
        say('');
        const RULES = ['any', 'legal', 'direct'];
        const tally = {};
        for (const r of RULES) tally[r] = { keep: 0, break: 0, skipped: 0 };
        const bad = { any: [], legal: [], direct: [] };
        for (const lv of lvs) {
            if (Date.now() > deadline) { say('（墙钟到点，提前收尾）'); break; }
            for (let k = 0; k < opt.seeds; k++) {
                if (Date.now() > deadline) break;
                const seed = seedFor(lv, k);
                const base = solvable(makeFac(lv, seed), pairFac(lv), boardOpt(seed));
                if (base.verdict !== 'YES') { for (const r of RULES) tally[r].skipped++; continue; }
                for (const rule of RULES) {
                    // 每种口径都在同一盘上重造，才可横向比
                    const made = mk(lv, seed);
                    const cands = pickCands(made.bd, made.pair, rule);
                    if (!cands.length) { tally[rule].skipped++; continue; }
                    const a = cands[new Rng(4242 + lv.n * 31 + k + rule.length).int(0, cands.length)];
                    // ★ 拆同一对牌：靠 id 记住是哪两张，之后每次都**从零重造**再摘掉它们。
                    //   不能写 `() => b2`（同一个对象会被贪心吃掉），见 greedyAny 的指纹注释。
                    const ids = [a.t.id, a.o.id];
                    const after = solvable(
                        () => killByIds(mk(lv, seed).bd, ids), pairFac(lv), boardOpt(seed ^ 0x9e37));
                    if (after.verdict === 'NO') {
                        tally[rule].break++;
                        bad[rule].push(`L${lv.n} seed=${seed} 拆 ${a.t.char}+${a.o.char}`);
                    } else tally[rule].keep++;
                }
            }
        }
        say('  口径      保持有解    变成无解   拆坏率');
        for (const r of RULES) {
            const t = tally[r];
            const n = t.keep + t.break;
            say(`  ${r.padEnd(9)} ${String(t.keep).padStart(6)} ${String(t.break).padStart(9)}   `
                + `${n ? (t.break / n * 100).toFixed(1) + '%' : '-'}`
                + `（跳过 ${t.skipped}）`);
        }
        for (const r of RULES) {
            if (!bad[r].length) continue;
            say(`  ✖ ${r} 的反例（前 8）：`);
            for (const b of bad[r].slice(0, 8)) say(`      ${b}`);
        }
        result.extra = { tally, bad };
        finish(opt, result, lines, t0, false);
        return;
    }

    // ============================================================
    //  --mode levels / --mode playout
    // ============================================================
    const nums = parseLevels(opt.levels);
    let allOk = true;
    let badLevels = 0;
    for (const n of nums) {
        const lv = byN.get(n);
        if (!lv) { say(`⚠️ 关卡表里没有第 ${n} 关，跳过`); continue; }
        if (Date.now() > deadline) { say(`⚠️ 墙钟到点，L${n} 及之后未跑 —— 请调大 --time 或缩小 --seeds`); allOk = false; break; }
        const per = {
            n, cols: lv.cols, rows: lv.rows, tr: lv.tr, pairs: lv.pairs,
            seeds: opt.seeds, yes: 0, greedy: 0, dfs: 0, no: 0, unknown: 0, stepSum: 0,
            playTry: 0, playOk: 0, playDead: 0, playUnk: 0, full: lv.cols * lv.rows, deadSeeds: [],
        };
        for (let k = 0; k < opt.seeds; k++) {
            if (Date.now() > deadline) { per.unknown += opt.seeds - k; say(`  ⚠️ L${n} 墙钟到点，只跑了 ${k}/${opt.seeds} 盘`); allOk = false; break; }
            const seed = seedFor(lv, k);
            const v = solvable(makeFac(lv, seed), pairFac(lv), boardOpt(seed));
            if (v.verdict === 'YES') {
                per.yes++;
                per.stepSum += v.steps || 0;
                if (v.via === 'greedy') per.greedy++; else per.dfs++;
                // ★ 模型说有解，还要按**引擎口径**真回放一次：宝牌送掉哪一对由真 RNG 决定，
                //   而模型是"只删宝牌两张"。这一步就是在问"简化的口径会不会翻车"。
                if (lv.tr > 0 || opt.mode === 'playout') {
                    const { bd, pair } = mk(lv, seed);
                    // ★ 字段名是 `boardTime`（毫秒数），不是 `deadline`（时间戳）。
                    //   这里原来传的是 `deadline: Date.now() + opt.boardTime`，而
                    //   `playReal` 读的是 `opt.boardTime` ⇒ 永远是 undefined ⇒
                    //   落到 `planFor` 的 `boardMs || 4000` 兜底值。
                    //   后果：`--board-time` 对**回放**完全不起作用，而文档写着它管回放 ——
                    //   于是"回放没算完"会被误读成"这盘走死了"。一对账就现形了：同一关
                    //   同一批盘，换个时刻跑，报出来的"没算完"条数不一样（纯时序抖动）。
                    const real = playReal(bd, pair, new Rng((seed ^ 0x5bf03635) >>> 0), 'replan',
                        { bonus: opt.bonus, planTries: opt.planTries, budget: opt.budget, boardTime: opt.boardTime });
                    per.playTry++;
                    if (real.cleared) per.playOk++;
                    else {
                        if (real.why.startsWith('规划没算完')) per.playUnk++;
                        else per.playDead++;
                        per.deadSeeds.push(`play:${seed}(${real.why} 走${real.steps}步 剩${real.left} 重规划败${real.replanFails})`);
                    }
                }
            } else if (v.verdict === 'NO') {
                per.no++;
                per.deadSeeds.push(seed);
            } else {
                per.unknown++;
                per.deadSeeds.push(`?${seed}`);
            }
        }
        const rate = (per.yes / opt.seeds * 100).toFixed(1);
        const avg = per.yes ? (per.stepSum / per.yes).toFixed(1) : '-';
        const play = per.playTry ? `真机口径回放 ${per.playOk}/${per.playTry}`
            + (per.playDead ? `（死局 ${per.playDead}` + (per.playUnk ? ` / 没算完 ${per.playUnk}` : '') + '）'
                : (per.playUnk ? `（没算完 ${per.playUnk}）` : '')) : '';
        say(`L${String(n).padStart(2)} ${String(lv.cols).padStart(2)}×${String(lv.rows).padStart(2)} `
            + `牌=${String(lv.pairs * 2 + lv.tr * 2).padStart(2)} 空格=${String(per.full - lv.pairs * 2 - lv.tr * 2).padStart(2)} `
            + `tr=${lv.tr} | 有解 ${String(per.yes).padStart(2)}/${opt.seeds} (${rate.padStart(5)}%)`
            + ` 真无解 ${String(per.no).padStart(2)} 未知 ${per.unknown}`
            + ` | 平均 ${String(avg).padStart(5)} 手  ${play}`);
        if (per.deadSeeds.length && opt.verbose) {
            say(`     可疑种子：${per.deadSeeds.slice(0, 8).join(', ')}`);
        }
        if (per.yes < opt.seeds) badLevels++;
        result.levels[n] = per;
    }

    say('');
    const P = Object.values(result.levels);
    const seeded = P.reduce((s, p) => s + p.seeds, 0);
    const yes = P.reduce((s, p) => s + p.yes, 0);
    const no = P.reduce((s, p) => s + p.no, 0);
    const unk = P.reduce((s, p) => s + p.unknown, 0);
    const pt = P.reduce((s, p) => s + p.playTry, 0);
    const po = P.reduce((s, p) => s + p.playOk, 0);
    const pd = P.reduce((s, p) => s + (p.playDead || 0), 0);
    const pu = P.reduce((s, p) => s + (p.playUnk || 0), 0);
    say(`合计：${Object.keys(result.levels).length} 关 / ${seeded} 盘 —— 有解 ${yes}，真无解 ${no}，未知 ${unk}`);
    if (pt) {
        say(`      真机口径回放（宝牌赠品=${opt.bonus}）：${po}/${pt} 通关`
            + (pd ? `，死局 ${pd}` : '') + (pu ? `，没算完 ${pu}` : ''));
        if (opt.bonus === 'none') {
            say(`      ⚠️ 这一档是工具对账档：规划器与回放同规则，理应 ${pt}/${pt}。
                 差额一律先当工具的问题查，别当成游戏的问题。`.replace(/\n\s+/g, ' '));
        }
    }
    if (badLevels) say(`      ⚠️ 有 ${badLevels} 关存在"随机开局即死局"的盘面 —— 这正是用户拍的「开局要确定有解」要堵的洞`);
    finish(opt, result, lines, t0, badLevels === 0 && unk === 0);
}

// ★ 导出给调试脚本用（`node -e "require('./tools/solve-exact.js')"` 时不要把 main 跑起来）。
//   之所以要留这个口子：这一层的"错了"和"规则变了"很难只看输出分辨，
//   能单独把某个盘面拽出来一步步看，比读日志快得多。
//   ⚠️ 其中 firstHit / listActions / applyAction / undoAction / settle / stateKey /
//      search / greedy / greedyAny / greedyPlan / planFor / solvable / solvableInPlace
//      都是 **core/Solver.ts 的转发壳**（惰性取编译产物），不是本文件的实现 ——
//      它们会触发一次 core/ 编译（首次约几秒）。真要深挖，直接 require Solver.js 更省事。
if (require.main === module) main();
module.exports = { compileCore, firstHit, listActions, pickCands, applyAction, undoAction, settle, fpOf, killByIds, stateKey, search, greedy, greedyAny, greedyPlan, planFor, solvable, solvableInPlace, playReal, parseLevels, parseArgs };

function finish(opt, result, lines, t0, ok) {
    result.ok = ok;
    result.elapsedMs = Date.now() - t0;
    if (opt.json) {
        fs.mkdirSync(path.dirname(path.resolve(opt.json)), { recursive: true });
        fs.writeFileSync(opt.json, JSON.stringify(result, null, 2));
        console.log(`\n结果已写入 ${opt.json}`);
    }
    console.log(ok ? '\n✓ 全部通过' : '\n✖ 存在未通过项（见上）');
    process.exit(ok ? 0 : 1);
}
