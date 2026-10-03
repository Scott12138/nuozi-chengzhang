/* ============================================================
 *  core-selftest.js · 玩法规则的单元自测（不启动引擎、不开浏览器）
 * ============================================================
 *  【它存在的全部理由】
 *  「规则写错了」和「引擎没跑起来」在截图上长得一模一样 —— 都是白屏或乱糟糟。
 *  所以玩法层（assets/scripts/core/）被强制做成零引擎依赖（不 import 'cc'），
 *  代价是它可以直接用 tsc 编译 + node 跑断言，几秒钟出结论：
 *    滑动范围对不对 / 被挡是不是真停住 / 对齐判定对不对 / 发牌可不可复现。
 *  只有这些全绿了，再去构建、再去截图，排查范围才收敛。
 *
 *  【为什么用 tsc 编译而不是让 node 直接读 .ts】
 *  Node 22 有 type stripping，但**只能剥类型、不能做 import 重写**：
 *  `import { CFG } from '../CFG'` 少一个 .js，ESM 解析器直接报错。
 *  编译成 CommonJS 就没这个问题（require 不需要扩展名）。
 *
 *  【为什么用 Cocos 自带的 tsc】
 *  本机没有全局 typescript，也不该为一个检查去全局装。
 *  Cocos 3.8.8 目录里自带一份完整 typescript，版本与编辑器一致。
 *
 *  用法： node tools/core-selftest.js
 *  退出码：0 = 全部通过
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
const OUT = path.join(os.tmpdir(), 'chaizi-core-selftest');

// ------------------------------------------------------------
//  ⓪ 编译 core/（+ CFG.ts）到临时目录
// ------------------------------------------------------------
if (!fs.existsSync(TSC)) {
    console.error('✖ 找不到 Cocos 自带的 tsc：' + TSC);
    process.exit(2);
}
fs.rmSync(OUT, { recursive: true, force: true });

const inputs = [
    path.join(SCRIPTS, 'CFG.ts'),
    // ★ TileManifest.ts 也要编译进来：它是**生成的**（tools/make-tile-atlas.py），
    //   而"生成的东西"最容易出现"字单改了、贴图没重烘"这种静默错位。
    //   放进来自检，才能在下游断言"可玩关的每个字在主包里都有贴图"。
    path.join(SCRIPTS, 'TileManifest.ts'),
    ...fs.readdirSync(path.join(SCRIPTS, 'core'))
        .filter((f) => f.endsWith('.ts'))
        .map((f) => path.join(SCRIPTS, 'core', f)),
];

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
    ...inputs,
], { encoding: 'utf8' });

const tscOut = (r.stdout || '') + (r.stderr || '');
if (r.status !== 0) {
    console.error('✖ core/ 编译失败（这一步失败说明连类型都不对，先修它）：\n' + tscOut);
    process.exit(1);
}
if (/error TS\d+/.test(tscOut)) {
    console.error('✖ core/ 有类型错误：\n' + tscOut);
    process.exit(1);
}

const core = require(path.join(OUT, 'core', 'Board.js'));
const rngMod = require(path.join(OUT, 'core', 'Rng.js'));
const data = require(path.join(OUT, 'core', 'LevelData.js'));
const saveMod = require(path.join(OUT, 'core', 'Save.js'));
const types = require(path.join(OUT, 'core', 'Types.js'));   // 纯类型，导出应为空
const treasureMod = require(path.join(OUT, 'core', 'Treasure.js'));
const seedsMod = require(path.join(OUT, 'core', 'LevelSeeds.js'));
const solverMod = require(path.join(OUT, 'core', 'Solver.js'));
const manifest = require(path.join(OUT, 'TileManifest.js'));

// ------------------------------------------------------------
//  极简断言器（不引第三方：这点体量不值得为它装 jest）
// ------------------------------------------------------------
let pass = 0;
const fails = [];
function ok(cond, msg) {
    if (cond) { pass++; return true; }
    fails.push(msg);
    return false;
}
function eq(got, want, msg) {
    return ok(got === want, `${msg}（实际 ${JSON.stringify(got)}，期望 ${JSON.stringify(want)}）`);
}
function deq(got, want, msg) {
    return ok(JSON.stringify(got) === JSON.stringify(want),
        `${msg}（实际 ${JSON.stringify(got)}，期望 ${JSON.stringify(want)}）`);
}
const S = (name, fn) => {
    try { fn(); } catch (e) { fails.push(`${name} 抛异常：${e && e.stack ? e.stack.split('\n')[0] : e}`); }
};

// ------------------------------------------------------------
//  ⓪b 关卡种子表（LevelSeeds.ts，生成物）
// ------------------------------------------------------------
/**
 * 用户 2026-10-03 拍板：「减少随机开局的情况，从 8 盘随机开局降低到 4 盘随机开局，
 * 保证这 4 种开局时一定有解的」。落地方式就是这张表 —— 每关 4 颗**离线验证过有解**
 * 的固定种子，开局从里面随机挑一颗。
 *
 * 【这里能断言什么、不能断言什么 —— 分清楚很重要】
 *   ✅ 能：这 4 颗种子**当前**发出来的盘面，与生成时记下的指纹一致。
 *          ⇒ 意味着「离线判定时看的那盘」与「现在真机上发的那盘」是同一盘，
 *            所以那份「有解」的结论**依然成立**。
 *   ❌ 不能：它是不是真的有解 —— 那要跑求解器（`tools/solve-exact.js`，
 *          逐盘贪心换顺序 + DFS），几十秒级，不适合放进每次自检。
 *          ⇒ 所以这里只查"路径没变"；**有解性复核是发布前那条命令**：
 *            `node tools/gen-level-seeds.js --verify`
 *
 * 两道关的关系：指纹对不上 ⇒ 发牌路径（Board/LevelData/Treasure/Rng）动过了 ⇒
 * 那 4 局的盘面已经不是当初验的那 4 局 ⇒ 「有解」结论过期 ⇒ 重跑生成器。
 * 这是"种子表不会悄悄失效"的保证。
 */
S('关卡种子表', () => {
    const { LEVEL_SEEDS, LEVEL_BOARD_FP, SEEDS_PER_LEVEL, seedsOf } = seedsMod;
    eq(SEEDS_PER_LEVEL, 4, '★ 每关固定 4 颗种子（用户拍板的数）');

    const missing = [];
    const wrongCount = [];
    const dup = [];
    const badSeed = [];
    const fpBad = [];
    const Rng = rngMod.Rng;
    for (const l of data.LEVELS) {
        const seeds = LEVEL_SEEDS[l.n];
        if (!seeds) { missing.push(`L${l.n}`); continue; }
        if (seeds.length !== SEEDS_PER_LEVEL) wrongCount.push(`L${l.n}=${seeds.length}`);
        if (new Set(seeds).size !== seeds.length) dup.push(`L${l.n}`);
        for (const s of seeds) {
            if (!Number.isInteger(s) || s <= 0 || s > 0x7fffffff) badSeed.push(`L${l.n}:${s}`);
        }
        // 逐颗重造，比指纹
        const pair = new core.PairTable(l.words);
        seeds.forEach((s, i) => {
            const bd = core.generateBoard(l, pair, new Rng(s));
            const got = bd.fingerprint();
            const want = (LEVEL_BOARD_FP[l.n] || [])[i];
            if (got !== want) fpBad.push(`L${l.n} seed=${s}（表里 ${want}，现在 ${got}）`);
        });
        // 同一关的 4 颗必须给出 4 个**不同**盘面，否则玩家会看到重样
        const fps = seeds.map((s) => core.generateBoard(l, new core.PairTable(l.words), new Rng(s)).fingerprint());
        if (new Set(fps).size !== fps.length) dup.push(`L${l.n}(重样盘面)`);
    }
    deq(missing, [], '★ 1~38 关每关都登记了种子');
    deq(wrongCount, [], '★ 每关种子数都等于 4');
    deq(dup, [], '★ 每关的 4 颗种子（及其盘面）互不相同');
    deq(badSeed, [], '★ 种子都是 [1, 2^31-1] 的正整数');
    if (fpBad.length) {
        deq(fpBad, [], '★ 盘面指纹与种子表一致 —— 对不上说明发牌路径动过了，'
            + '请重跑 `node tools/gen-level-seeds.js` 并重新验证这 4 局有解');
    } else {
        ok(true, '★ 38 关 × 4 颗 = 152 个盘面指纹全部与种子表一致（发牌路径未漂移）');
    }
    eq(seedsOf(999).length, 0, '★ seedsOf 对没登记的关号返回空数组（不是 undefined）');
});

// ------------------------------------------------------------
//  ① 关卡数据：从原型生成的，必须与原型一致
// ------------------------------------------------------------
S('关卡数据', () => {
    // ★ 2026-10-03 S11 重排：扩库 42 字（103→145）、38 关全部换尺寸/对数/限时/
    //   宝牌对、干扰牌（junk）全线归零。以下期望值随真源一起走，改真源就要改这里。
    eq(Object.keys(data.WORDS).length, 145, '拆字表条数');
    eq(data.LEVELS.length, 38, '关卡总数');
    eq(data.CHAPTERS.length, 4, '章节数');
    eq(Object.keys(types).length, 0, 'Types.ts 是纯类型，编译后不应有运行时导出');

    deq(data.WORDS['枪'], { a: '木', b: '仓' }, '枪 = 木+仓');
    deq(data.WORDS['铠'], { a: '钅', b: '岂' }, '铠 = 钅+岂');
    deq(data.WORDS['露'], { a: '雨', b: '路' }, '★ 扩库抽样：露 = 雨+路');
    deq(data.WORDS['铃'], { a: '钅', b: '令' }, '★ 扩库抽样：铃 = 钅+令');

    const l1 = data.levelByN(1);
    eq(l1.cols, 6, 'L1 列数');
    eq(l1.rows, 6, 'L1 行数');
    eq(l1.pairs, 14, 'L1 配对数');
    eq(l1.tr, 0, 'L1 宝牌对数（6×6 不设宝牌）');
    eq(l1.junk, 0, 'L1 干扰牌数（已被宝牌取代）');
    eq(l1.time, 175, 'L1 限时');
    deq(l1.words, ['枪', '锤', '鞭', '箭', '斧', '弩', '剑'], 'L1 目标字');
    ok(!!l1.tip, 'L1 应有拆法提示');

    const l3 = data.levelByN(3);
    eq(l3.tr, 1, '★ L3（6×7）起就有宝牌');
    eq(l3.junk, 0, 'L3 干扰牌数');
    eq(l3.words.length, 8, 'L3 目标字数 = ⌈pairs/2⌉ = 8');

    // ★ 全部 38 关过一遍字频三条（生成期也断言了，这里再独立验一次）
    const bad = [];
    for (const l of data.LEVELS) {
        const byWord = {}, byRad = {};
        for (let i = 0; i < l.pairs; i++) {
            const w = l.words[i % l.words.length];
            byWord[w] = (byWord[w] || 0) + 1;
            byRad[data.WORDS[w].a] = (byRad[data.WORDS[w].a] || 0) + 1;
        }
        if (l.words.length < Math.ceil(l.pairs / 2)) bad.push(`L${l.n} 字数不足`);
        for (const w in byWord) if (byWord[w] > 2) bad.push(`L${l.n} 「${w}」${byWord[w]} 组`);
        for (const a in byRad) if (byRad[a] > 4) bad.push(`L${l.n} 偏旁「${a}」${byRad[a]} 张`);
        // 宝牌登场曲线：<42 格 0 对 / 42~72 格 1 对 / 81~110 格 2 对 / ≥120 格 3 对
        const c = l.cols * l.rows;
        const wantTr = c < 42 ? 0 : c <= 72 ? 1 : c <= 110 ? 2 : 3;
        if (l.tr !== wantTr) bad.push(`L${l.n} 宝牌对数 ${l.tr}≠${wantTr}`);
    }
    deq(bad, [], '★ 38 关全部满足字频三条 + 宝牌曲线');

    // ★ 尺寸上限 10×12（10 列 12 行）—— 用户 2026-10-03 拍板的硬上限
    const over = data.LEVELS.filter((l) => l.cols > 10 || l.rows > 12)
        .map((l) => `L${l.n} ${l.cols}×${l.rows}`);
    deq(over, [], '★ 没有任何一关超过 10×12');

    // ★ 占格数 = 28 + 4×档位，**章内**单调不减；章末逐章递增
    //   （章首会合法地回落到 6×6 —— 那是"每章重新起手"的设计，不是回退）
    const TIERS = [[6, 6], [6, 7], [7, 7], [7, 8], [8, 8], [8, 9],
        [9, 9], [9, 10], [10, 10], [10, 11], [10, 12]];
    const badUsed = [];
    const chapterEnd = {};
    let prev = 0, prevCh = 1;
    for (const l of data.LEVELS) {
        const ti = TIERS.findIndex((t) => t[0] === l.cols && t[1] === l.rows);
        if (ti < 0) { badUsed.push(`L${l.n} 尺寸 ${l.cols}×${l.rows} 不在 11 档里`); continue; }
        const used = l.pairs * 2 + l.tr * 2;
        if (used !== 28 + 4 * ti) badUsed.push(`L${l.n} 占格 ${used} ≠ ${28 + 4 * ti}`);
        if (l.ch === prevCh && used < prev) badUsed.push(`L${l.n} 章内占格 ${used} 比上一关 ${prev} 还小`);
        prev = used;
        prevCh = l.ch;
        chapterEnd[l.ch] = used;
    }
    const ends = [1, 2, 3, 4].map((c) => chapterEnd[c]);
    for (let i = 1; i < ends.length; i++) {
        if (ends[i] <= ends[i - 1]) badUsed.push(`章 ${i + 1} 末档 ${ends[i]} 没超过章 ${i} 的 ${ends[i - 1]}`);
    }
    deq(badUsed, [], '★ 38 关尺寸都在 11 档内、占格数 = 28+4×档位、章内不减且章末递增');

    ok(data.isPlayable(l1), 'L1 可玩');
    // ★ 2026-10-03 **全量解封**（PLAYABLE_MAX 3 → 38）。下面三条就是
    //   "解封没被回退"的哨兵 —— 它们一变红，说明有人把 PLAYABLE_MAX 调回去了，
    //   而那种情况的表现是"选关页后面几关又变回「待开发」"，
    //   很容易被当成 UI 的 bug 去查，查不到常量头上来。
    ok(data.isPlayable(data.levelByN(4)), 'L4 可玩（已解封，原为待开发）');
    ok(data.isPlayable(data.levelByN(38)), 'L38 可玩（解封到最后一关）');
    eq(data.FIRST_UNPLAYABLE, 39, '待开发分界关号 = 关卡总数 + 1（= 没有待开发的了）');
});

// ------------------------------------------------------------
//  ①′ 贴图清单：与字单、与主包/分包的划分必须一致
// ------------------------------------------------------------
S('贴图清单', () => {
    const TEX = manifest.TILE_TEX;
    const CH = manifest.TILE_CHAPTER;
    const B = manifest.CHAPTER_BUNDLE;

    // ① 清单条目 ↔ 盘上真实 PNG，一一对应（多一条 = 运行期 warn + 空牌；少一条 = 白占体积）
    const tileDirs = [
        path.join(SCRIPTS, '..', 'resources', 'tiles'),
        ...[2, 3, 4].map((n) => path.join(SCRIPTS, '..', 'ch0' + n, 'tiles')),
    ].map((p) => path.normalize(p)).filter((p) => fs.existsSync(p));
    ok(tileDirs.length === 4, `四个贴图目录都在（实际 ${tileDirs.length}）`);

    const disk = new Set();
    for (const d of tileDirs) {
        for (const f of fs.readdirSync(d)) if (f.endsWith('.png')) disk.add(f.slice(0, -4));
    }
    // ★ 宝牌也在同一个目录里（`x_*`），必须一起进"盘上"这个集合 ——
    //   否则它们会被判成"盘上有、清单里没有"，白占体积的假告警。
    const TR = manifest.TREASURE_TEX || {};
    const listed = new Set(Object.values(TEX).concat(Object.values(TR)));
    const inListNotDisk = [...listed].filter((f) => !disk.has(f));
    const onDiskNotList = [...disk].filter((f) => !listed.has(f));
    deq(inListNotDisk, [], '★ 清单（字牌 + 宝牌）里每一张贴图盘上都有（否则运行时是空牌）');
    deq(onDiskNotList, [], '★ 盘上每一张贴图清单里都有（否则白占主包/分包体积）');
    // 宝牌的键与文件名是同一个（见 TileManifest 的 TREASURE_TEX 注释），这条把该约定也钉住
    for (const k of Object.keys(TR)) eq(TR[k], k, `宝牌 ${k} 的键与文件名一致`);

    // ② 可玩关用到的字，必须**按章路由得到**。
    //
    // ★★ 2026-10-03 解封到 38 关时把这条断言重写了。
    //    旧断言是「可玩关的字全部落在第 1 章 = 主包（不需要加载分包）」——
    //    在只开放前 3 关时它是对的，解封之后就**必然全红**（第 2 章起一堆字都不在第 1 章）。
    //    它要防的其实是同一件事：**"选关页说能玩，进关却取不到图"**。
    //    所以新口径直接照那个目标写，分四查：
    //      ① 有文件名（否则一张空牌）      ② 有归属章（否则 TileAtlas 不知道该去哪个 bundle）
    //      ③ 归属章有对应的 bundle 配置     ④ 图**确实躺在那一章的目录里**
    //    第 ④ 条是最关键的一条：`TILE_CHAPTER` 说"去 ch03 拿"、而图其实在 ch02 里的话，
    //    运行期只会是一行 warn + 一张空牌 —— 这种错位在四查里唯一能提前抓住。
    const playable = data.LEVELS.filter((l) => data.isPlayable(l));
    const noTex = [];
    const uncharted = [];
    const badCh = [];
    const misplaced = [];
    const dirOfCh = {
        1: path.join(SCRIPTS, '..', 'resources', 'tiles'),
        2: path.join(SCRIPTS, '..', 'ch02', 'tiles'),
        3: path.join(SCRIPTS, '..', 'ch03', 'tiles'),
        4: path.join(SCRIPTS, '..', 'ch04', 'tiles'),
    };
    const diskOfCh = {};
    for (const n of [1, 2, 3, 4]) {
        const d = path.normalize(dirOfCh[n]);
        diskOfCh[n] = new Set(fs.existsSync(d)
            ? fs.readdirSync(d).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4))
            : []);
    }
    for (const l of playable) {
        for (const w of l.words) {
            for (const c of [w, data.WORDS[w].a, data.WORDS[w].b]) {
                if (!TEX[c]) { noTex.push(`L${l.n} 「${c}」没贴图`); continue; }
                const ch = CH[c];
                if (!ch) { uncharted.push(`L${l.n} 「${c}」没有归属章（TILE_CHAPTER 缺条目）`); continue; }
                if (!B[ch]) { badCh.push(`L${l.n} 「${c}」归属第 ${ch} 章，但没有该章的 bundle 配置`); continue; }
                if (!diskOfCh[ch] || !diskOfCh[ch].has(TEX[c])) {
                    misplaced.push(`L${l.n} 「${c}」归第 ${ch} 章，但 ${TEX[c]}.png 不在 `
                        + `${B[ch].bundle}/tiles/ 里（运行期会是空牌）`);
                }
            }
        }
    }
    deq(noTex, [], '★ 可玩关用到的每个字（字 + 偏旁 + 部件）都有贴图');
    deq(uncharted, [], '★ 可玩关用到的每个字都有归属章（TileAtlas 才知道去哪个 bundle 取）');
    deq(badCh, [], '★ 每个归属章都有对应的 bundle 配置');
    deq(misplaced, [], '★ 每张图确实躺在它归属章的目录里（错位时运行期只是空牌，不报错）');

    // ②′ 可玩关的宝牌也必须在主包 —— 宝牌贴图一律落 resources，跨章共用
    //    （第 3 关就要用「铁砧」，而它属于第 1 章；把它塞进任何一章的分包都说不通）
    const trMiss = [];
    for (const l of playable) {
        for (let i = 0; i < l.tr; i++) {
            const it = treasureMod.treasureOf(l.ch, i);
            if (!TR[it.tex]) trMiss.push(`L${l.n} 宝牌「${it.name}」缺贴图 ${it.tex}`);
        }
    }
    deq(trMiss, [], '★ 可玩关的宝牌贴图在主包里有（宝牌跨章共用，一律落 resources）');

    // ③ 章 → bundle 映射自洽；第 1 章必须是内置 resources
    deq(B[1], { bundle: 'resources', prefix: 'tiles' }, '第 1 章走内置 resources bundle（主包）');
    for (const n of [2, 3, 4]) {
        eq(B[n] && B[n].bundle, 'ch0' + n, `第 ${n} 章 → ch0${n} 分包`);
        eq(B[n] && B[n].prefix, 'tiles', `第 ${n} 章的贴图路径前缀`);
    }

    // ④ TILE_CHAPTER / TILE_TEX 的键集必须一致
    deq(Object.keys(CH).sort(), Object.keys(TEX).sort(), 'TILE_CHAPTER 与 TILE_TEX 的键完全一致');

    // ⑤ 干扰牌已下线 → 空表（留着非空说明有人又把旧贴图烘回来了）
    eq(Object.keys(manifest.JUNK_TEX).length, 0, '★ JUNK_TEX 为空（宝牌已取代干扰牌）');

    // ⑥ 全库规模：与「按章分包」的体积预算对齐（248 张 / 46 + 71 + 63 + 68）
    eq(Object.keys(TEX).length, 248, '全库字牌贴图张数');
    eq(Object.keys(TR).length, 8, '宝牌贴图张数（四章共 8 件器物）');
    const per = [1, 2, 3, 4].map((n) => Object.values(CH).filter((x) => x === n).length);
    deq(per, [46, 71, 63, 68], '各章贴图张数（跨章的字只烘一次，归属最早那章）');
});

// ------------------------------------------------------------
//  ② 配对表
// ------------------------------------------------------------
S('配对表', () => {
    const pt = new core.PairTable(['枪', '棍']);
    const mk = (char, kind, r, c) => ({ id: 0, char, kind, r, c });
    const mu = mk('木', 'radical', 0, 0);
    const cang = mk('仓', 'part', 0, 1);
    const mu2 = mk('木', 'radical', 1, 0);
    const junk = mk('疒', 'junk', 2, 0);

    ok(pt.canPair(mu, cang), '木+仓 可配（一偏旁一部件，且在表内）');
    ok(pt.canPair(cang, mu), '★ 无序：仓+木 也可配');
    eq(pt.word(cang, mu), '枪', '仓+木 合成「枪」');
    ok(!pt.canPair(mu, mu2), '★ 两块偏旁不能配（种类相同）');
    ok(!pt.canPair(mu, junk), '干扰牌不能配');
    ok(!pt.canPair(mu, null), '空牌不能配');
    eq(pt.word(mu, mu2), '', '配不上时返回空串');

    // 跨关不串味：本关字单里没有「棒」时，木+奉 必须配不上
    const pt2 = new core.PairTable(['棍']);
    const feng = mk('奉', 'part', 0, 1);
    ok(!pt2.canPair(mu, feng), '★ 配对表按关隔离：本关没有「棒」时 木+奉 配不上');

    // ---- ★ 宝牌（2026-10-03 接入）：同款互配，且与普通牌永不互配 ----
    const anvil1 = mk('铁砧', 'treasure', 0, 0);
    const anvil2 = mk('铁砧', 'treasure', 2, 0);
    const vase = mk('花瓶', 'treasure', 1, 0);
    ok(pt.canPair(anvil1, anvil2), '★ 两张同款宝牌可配');
    ok(!pt.canPair(anvil1, vase), '★ 不同款宝牌不可配（每对一种物件）');
    ok(!pt.canPair(anvil1, mu), '★ 宝牌不与普通牌互配（宝牌不在拆字表里，配上去也合不出字）');
    ok(!pt.canPair(anvil1, junk), '宝牌不与干扰牌互配');
    ok(!pt.canPair(anvil1, null), '宝牌与空牌不配');
    eq(pt.word(anvil1, anvil2), '', '★ 宝牌不合成字（word() 必须返回空串，走的是另一套结算）');
    ok(pt.isTreasurePair(anvil1, anvil2), 'isTreasurePair 认得出宝牌对');
    ok(!pt.isTreasurePair(anvil1, vase), 'isTreasurePair 不认不同款');
    ok(!pt.isTreasurePair(mu, cang), 'isTreasurePair 不认普通对');
});

// ------------------------------------------------------------
//  ③ 滑动范围 / 推箱余量  ← 核心玩法，测得最细
// ------------------------------------------------------------
S('滑动范围与推箱余量', () => {
    const bd = new core.Board(4, 3);
    const mk = (id, char, kind, r, c) => ({ id, char, kind, r, c });
    const A = mk(1, '木', 'radical', 1, 1);
    const B = mk(2, '仓', 'part', 1, 3);
    bd.setCell(1, 1, A);
    bd.setCell(1, 3, B);

    deq(bd.slideRange(A), { up: 0, down: 2, left: 0, right: 2 }, 'A 的四向最远格');
    eq(bd.slideRange(A).right, 2, '★ 右侧挡路牌与 A 之间还隔着空格 → 只到那格空格为止');
    ok(bd.canSlide(A), 'A 有滑动余地');

    // ★ 2026-10-03 推箱：紧贴着的牌不再是"终点"，而是"会被一起推走的余量"
    {
        const b2 = new core.Board(4, 1);
        const P = { id: 1, char: 'a', kind: 'radical', r: 0, c: 0 };
        b2.setCell(0, 0, P);
        b2.setCell(0, 1, { id: 2, char: 'b', kind: 'part', r: 0, c: 1 });
        // P 在 0，紧贴着 1；右边 2、3 是空格 ⇒ 整段还能前移 2 格
        eq(b2.slideRange(P).right, 2, '★ 紧贴的牌挡不住 —— 它会被推着走（旧规则这里是 0）');
        b2.setCell(0, 2, { id: 3, char: 'c', kind: 'part', r: 0, c: 2 });
        b2.setCell(0, 3, { id: 4, char: 'd', kind: 'part', r: 0, c: 3 });
        eq(b2.slideRange(P).right, 0, '★ 整行占满、右边是墙 ⇒ 退回到"一格都推不动"');
    }

    // 被完全包住 → 不能滑
    const bd2 = new core.Board(3, 3);
    const C = mk(9, '钅', 'radical', 1, 1);
    bd2.setCell(1, 1, C);
    bd2.setCell(0, 1, mk(10, 'a', 'part', 0, 1));
    bd2.setCell(2, 1, mk(11, 'b', 'part', 2, 1));
    bd2.setCell(1, 0, mk(12, 'c', 'part', 1, 0));
    bd2.setCell(1, 2, mk(13, 'd', 'part', 1, 2));
    eq(bd2.canSlide(C), false, '★ 四向全被堵死 → 不能滑');
    deq(bd2.reachableCells(C), [], '堵死时可达空格为空');

    // reachableCells 必须只含同行同列
    const cells = bd.reachableCells(A);
    ok(cells.every((x) => x.r === A.r || x.c === A.c), '★ 可达格必然与自身同行或同列');
    // 棋盘 4×3、A 在 (1,1)：横向 left=0→right=2 去掉自身 = 2 格（(1,0)、(1,2)）；
    // 纵向 up=0→down=2 去掉自身 = 2 格（(0,1)、(2,1)）。合计 4。
    eq(cells.length, 4, 'A 可达格数 = 横 2 + 纵 2');
    ok(cells.every((x) => !(x.r === A.r && x.c === A.c)), '可达格里不含自身');
});

S('落点夹紧（clampSlide）', () => {
    const bd = new core.Board(4, 3);
    const A = { id: 1, char: '木', kind: 'radical', r: 1, c: 1 };
    bd.setCell(1, 1, A);
    bd.setCell(1, 3, { id: 2, char: '仓', kind: 'part', r: 1, c: 3 });
    const range = bd.slideRange(A);
    const PITCH = 100, GAP = 10;

    // 往右拖到天上，也只能停在 2（B 的前一格）
    deq(bd.clampSlide(range, 'h', 1, 1, 99999, 0, PITCH, GAP), { r: 1, c: 2 },
        '★ 向右拖过头 → 停在挡路牌前一格');
    deq(bd.clampSlide(range, 'h', 1, 1, -99999, 0, PITCH, GAP), { r: 1, c: 0 }, '向左拖过头 → 停在左边界');
    deq(bd.clampSlide(range, 'v', 1, 1, 0, 99999, PITCH, GAP), { r: 2, c: 1 }, '向下拖过头 → 停在底边');
    deq(bd.clampSlide(range, 'v', 1, 1, 0, 99999, PITCH, GAP).c, 1, '★ 竖滑时列号必须锁死在本列');
    deq(bd.clampSlide(range, 'h', 1, 1, 0, 99999, PITCH, GAP).r, 1, '★ 横滑时行号必须锁死在本行');
});

// ------------------------------------------------------------
//  ④ 对齐合成
// ------------------------------------------------------------
S('对齐合成', () => {
    const pt = new core.PairTable(['枪']);
    const bd = new core.Board(5, 1);            // 一行五格
    const mu = { id: 1, char: '木', kind: 'radical', r: 0, c: 0 };
    const cang = { id: 2, char: '仓', kind: 'part', r: 0, c: 3 };
    const blk = { id: 3, char: '疒', kind: 'junk', r: 0, c: 2 };
    bd.setCell(0, 0, mu);
    bd.setCell(0, 3, cang);

    deq(bd.matchTargets(mu, pt).map((t) => t.id), [2], '同行中间无牌 → 可合成');

    // 中间插一张牌 → 立刻不可合成（这是"对齐"的另一半语义）
    bd.setCell(0, 2, blk);
    deq(bd.matchTargets(mu, pt), [], '★ 中间有牌阻挡 → 不可合成');
    bd.setCell(0, 2, null);
    deq(bd.matchTargets(mu, pt).map((t) => t.id), [2], '把挡路的牌挪走 → 又可合成');

    ok(!bd.lineClear(mu, cang) === false, 'lineClear 与 matchTargets 口径一致');

    // 斜着不算
    const bd2 = new core.Board(3, 3);
    const a = { id: 1, char: '木', kind: 'radical', r: 0, c: 0 };
    const b = { id: 2, char: '仓', kind: 'part', r: 1, c: 1 };
    bd2.setCell(0, 0, a); bd2.setCell(1, 1, b);
    deq(bd2.matchTargets(a, pt), [], '★ 斜向（既不同行也不同列）不算对齐');

    // 同列纵向
    const bd3 = new core.Board(1, 4);
    const a3 = { id: 1, char: '木', kind: 'radical', r: 0, c: 0 };
    const b3 = { id: 2, char: '仓', kind: 'part', r: 2, c: 0 };
    bd3.setCell(0, 0, a3); bd3.setCell(2, 0, b3);
    deq(bd3.matchTargets(a3, pt).map((t) => t.id), [2], '同列中间无牌 → 可合成');
});

// ------------------------------------------------------------
//  ⑤ 发牌：可复现 + 教学关必有可直接消的一对 + 张数正确
// ------------------------------------------------------------
S('发牌', () => {
    const lv = data.levelByN(1);
    const pt = new core.PairTable(lv.words);

    const b1 = core.generateBoard(lv, pt, new rngMod.Rng(12345));
    const b2 = core.generateBoard(lv, pt, new rngMod.Rng(12345));
    const dump = (b) => b.allTiles().map((t) => `${t.char}@${t.r},${t.c}`).sort().join(' ');
    eq(dump(b1), dump(b2), '★ 同种子必须出同盘面（自测可复现的前提）');

    const b3 = core.generateBoard(lv, pt, new rngMod.Rng(999));
    ok(dump(b1) !== dump(b3), '不同种子应出不同盘面');

    // ★ 2026-10-03 宝牌接入后这里是真实口径：牌数 = 2×pairs + 2×tr。
    //   （之前写着 `+ 0` 并带"临时真话"注释，是因为 buildDeck 还没发宝牌。）
    eq(b1.allTiles().length, lv.pairs * 2 + lv.tr * 2 + lv.junk,
        '牌数 = 配对数×2 + 宝牌×2 + 干扰牌');
    eq(lv.tr, 0, 'L1 是 6×6，按拍板不设宝牌 —— 上面这条对 L1 等价于 pairs×2');
    ok(b1.hasDirectMatch(pt), '★ L1 必须一上来就有可直接消的一对（教学关正反馈）');

    // 目标字计数：14 对分到 7 个字上 → 每个字 2 对（★ 上限就是 2 组，用户拍板）
    const need = core.computeNeed(lv);
    eq(Object.values(need).reduce((a, b) => a + b, 0), 14, '目标字总对数 = pairs');
    deq(Object.keys(need), lv.words, '目标条顺序 = lv.words（新字排前面）');
    const rw = core.makeRunWords(lv);
    eq(rw.length, 7, 'L1 目标条 7 格');
    eq(Math.max(...rw.map((x) => x.need)), 2, '★ 轮转发牌：每字最多 2 组（上限就是 2）');
    eq(rw.every((x) => x.got === 0), true, '初始 got 全 0');

    // 每关都发得出来（38 关全跑一遍，防"某关牌数 > 格数"这类数据错）
    let bad = [];
    for (const l of data.LEVELS) {
        const p = new core.PairTable(l.words);
        const bb = core.generateBoard(l, p, new rngMod.Rng(l.n * 7919));
        // ★ 真实口径：宝牌也上盘面（2×tr 张）
        const want = l.pairs * 2 + l.tr * 2 + l.junk;
        if (bb.allTiles().length !== want) bad.push(`L${l.n}: ${bb.allTiles().length}≠${want}`);
        if (bb.emptyCount() !== l.cols * l.rows - want) bad.push(`L${l.n}: 空格数不符`);
        // 宝牌张数必须正好 2×tr，且**同款成对**（tr=2 时是两件不同物件，各两张）
        const trs = bb.allTiles().filter((t) => t.kind === 'treasure');
        if (trs.length !== l.tr * 2) bad.push(`L${l.n}: 宝牌 ${trs.length}≠${l.tr * 2} 张`);
        const byName = {};
        for (const t of trs) byName[t.char] = (byName[t.char] || 0) + 1;
        for (const nm in byName) if (byName[nm] !== 2) bad.push(`L${l.n}: 宝牌「${nm}」${byName[nm]} 张（应为 2）`);
        if (Object.keys(byName).length !== l.tr) bad.push(`L${l.n}: 宝牌种类 ${Object.keys(byName).length}≠${l.tr}`);
    }
    deq(bad, [], '★ 38 关全部发牌成功、张数正确、宝牌按对同款发放');
});

// ------------------------------------------------------------
//  ⑤′ 宝牌：物件表、同款互配、额外消一对的合法性
// ------------------------------------------------------------
S('宝牌', () => {
    // ---- 物件表：每章件数必须 ≥ 该章任意一关的 tr ----
    //   件数不够时 treasureOf() 会回落到第 0 件 → 同一关里两对宝牌长得一样，
    //   而且 PairTable 会认为它们**能互配**（char 相等）→ 直接破坏"每对一种物件"。
    const badCount = [];
    for (const l of data.LEVELS) {
        const list = treasureMod.TREASURE_ITEMS[l.ch] || [];
        if (list.length < l.tr) badCount.push(`第${l.ch}章 只有 ${list.length} 件，L${l.n} 需要 ${l.tr} 件`);
    }
    deq(badCount, [], '★ 每章宝牌物件件数 ≥ 该章最大 tr');

    // 物件表 ↔ TileManifest.TREASURE_TEX 对账（加了物件忘了出图 / 出了图没登记）
    const itemTex = [];
    for (const ch in treasureMod.TREASURE_ITEMS) {
        for (const it of treasureMod.TREASURE_ITEMS[ch]) itemTex.push(it.tex);
    }
    const manifestTex = Object.keys(manifest.TREASURE_TEX || {});
    deq(itemTex.slice().sort(), manifestTex.slice().sort(),
        '★ 宝牌物件表与 TileManifest.TREASURE_TEX 键集一致');
    const names = new Set();
    for (const ch in treasureMod.TREASURE_ITEMS) {
        for (const it of treasureMod.TREASURE_ITEMS[ch]) {
            ok(!names.has(it.name), `宝牌名「${it.name}」不重复`);
            names.add(it.name);
            // 宝牌名绝不能撞上拆字表里的字 —— 撞了玩家会以为它是能拆的字
            ok(!data.WORDS[it.name], `★ 宝牌名「${it.name}」不在拆字表里`);
        }
    }

    // ---- 额外消一对：必须"只从能合成的普通牌对里选"（用户 2026-10-03 拍板 A）----
    //   这是本机制唯一会破坏可解性的地方：若随机到"凑不成字的两张"，
    //   那两个目标字就永远凑不满。断言直接验"拆掉后牌堆仍完美成对"。
    const ptL3 = new core.PairTable(data.levelByN(3).words);
    const b3 = core.generateBoard(data.levelByN(3), ptL3, new rngMod.Rng(4242));
    const pick = b3.randomNormalPair(ptL3, new rngMod.Rng(77));
    ok(!!pick, 'L3 盘面上应该存在可合成的普通牌对');
    if (pick) {
        ok(!ptL3.isTreasurePair(pick[0], pick[1]), '随机挑出的不是宝牌对');
        eq(pick[0].kind === 'treasure' || pick[1].kind === 'treasure', false, '随机挑出的两张都不是宝牌');
        eq(!!ptL3.word(pick[0], pick[1]), true, '★ 随机挑出的两张必须真的能合成一个字');
        // 拆掉之后：剩下的普通牌仍然"每个字的偏旁/部件数量相等"（可解性的必要条件）
        // ⚠️ 必须**按种类分开数**。同一个字既能当偏旁又能当部件 ——
        //   例如「弓」在 L3 里是「弩」的部件、又是「弦」的偏旁。
        //   混在一起数会得出「弓 4 张 vs 玄 2 张」这种假告警（本断言的第一版就这么错的）。
        const keep = b3.allTiles().filter((t) => t !== pick[0] && t !== pick[1] && t.kind !== 'treasure');
        const asRad = {}, asPart = {};
        for (const t of keep) {
            if (t.kind === 'radical') asRad[t.char] = (asRad[t.char] || 0) + 1;
            else if (t.kind === 'part') asPart[t.char] = (asPart[t.char] || 0) + 1;
        }
        const l3 = data.levelByN(3);
        const broke = [];
        for (const w of l3.words) {
            const s = data.WORDS[w];
            if ((asRad[s.a] || 0) !== (asPart[s.b] || 0)) {
                broke.push(`${w}: 偏旁${s.a}=${asRad[s.a] || 0} ≠ 部件${s.b}=${asPart[s.b] || 0}`);
            }
        }
        deq(broke, [], '★ 拆掉随机一对之后，每个字的偏旁/部件数量仍然相等（没被破坏成死局）');
    }

    // 只剩宝牌 → 没有普通牌可送，返回 null（合法，不是错误）
    const onlyTr = new core.Board(2, 1);
    onlyTr.setCell(0, 0, { id: 1, char: '铁砧', kind: 'treasure', tex: 'x_ch1_01', r: 0, c: 0 });
    onlyTr.setCell(0, 1, { id: 2, char: '铁砧', kind: 'treasure', tex: 'x_ch1_01', r: 0, c: 1 });
    eq(onlyTr.randomNormalPair(ptL3, new rngMod.Rng(1)), null, '盘上只剩宝牌时 randomNormalPair 返回 null');
    eq(onlyTr.remainingTreasure(), 2, 'remainingTreasure 数出 2 张宝牌');
    eq(onlyTr.remainingPlayable(), 2, '★ 宝牌计入 remainingPlayable（不消完不算通关）');
    eq(onlyTr.hasDirectMatch(ptL3), true, '★ 相邻两张同款宝牌算"可直接消"（死局检测/教学关一起认）');
    eq(onlyTr.findSuggest(ptL3, new rngMod.Rng(1)), null,
        '★ 相邻两张宝牌已对齐 → 没有"需要挪一步"的解（findSuggest 不管已对齐的）');

    // 宝牌没对齐时，findSuggest 应该能把"挪过去凑宝牌"当成一步可行解
    // ⚠️ Board(cols, rows) —— 竖着三格是 `new Board(1, 3)`。写成 (3,1) 会得到
    //   "一行三列"，setCell(2,0) 直接越界（`_cells` 是普通数组，越界写不报错，
    //   只会静默塞到 index 6），断言就变成查一个根本没放上盘面的牌。
    const spread = new core.Board(1, 3);
    spread.setCell(0, 0, { id: 1, char: '铁砧', kind: 'treasure', tex: 'x_ch1_01', r: 0, c: 0 });
    spread.setCell(2, 0, { id: 2, char: '铁砧', kind: 'treasure', tex: 'x_ch1_01', r: 2, c: 0 });
    const sg = spread.findSuggest(ptL3, new rngMod.Rng(1));
    ok(!!sg && sg.tile.kind === 'treasure' && sg.hit.kind === 'treasure',
        '★ 只有一对宝牌时，findSuggest 给出的解就是"把宝牌挪到一起"');

    // ---- findTreasureMove：宝牌走法的**可测入口**（冒烟 `treasure:` 动作靠它取坐标）----
    const tm = spread.findTreasureMove(ptL3, new rngMod.Rng(1));
    ok(!!tm, '★ 两张宝牌没对齐时，findTreasureMove 给得出一步');
    if (tm) {
        ok(tm.tile.kind === 'treasure' && tm.hit.kind === 'treasure',
            '★ findTreasureMove 的起点与命中都必须是宝牌（它只找宝牌的走法）');
        eq(tm.tile.char, tm.hit.char, '★ 命中的必须是**同款**宝牌');
        ok(spread.reachableCells(tm.tile).some((x) => x.r === tm.r && x.c === tm.c),
            '★ 落点在 reachableCells 里（玩家真拖得到）');
    }
    eq(onlyTr.findTreasureMove(ptL3, new rngMod.Rng(1)), null,
        '★ 两张宝牌已相邻对齐 → findTreasureMove 返回 null（该"点"不该"拖"）');
    // 连种子都换一遍：不能只有某个幸运种子才给得出走法
    let tmMiss = 0;
    for (let sd = 1; sd <= 30; sd++) {
        if (!spread.findTreasureMove(ptL3, new rngMod.Rng(sd))) tmMiss++;
    }
    eq(tmMiss, 0, '★ 30 个种子下 findTreasureMove 都给出走法（不挑种子）');
    // 普通牌不会被误当成宝牌走法：一个只有普通牌、且存在可挪解的盘面
    const normalOnly = core.generateBoard(data.levelByN(1), new core.PairTable(data.levelByN(1).words),
        new rngMod.Rng(7));
    eq(normalOnly.findTreasureMove(new core.PairTable(data.levelByN(1).words), new rngMod.Rng(3)), null,
        '★ 盘上没有宝牌时 findTreasureMove 返回 null（不会拿普通牌充数）');

    // ---- findDirectTreasure：宝牌版的"已经对齐、**点一下**就能消" ----
    // 它存在的理由与 `[Diag] TREASURE direct` 那行日志一样：把"该点不该拖"从
    // "挪一步"里拆出来。缺了它，冒烟会把"可以点掉"误读成"这盘没有宝牌走法"。
    const dTr = onlyTr.findDirectTreasure(ptL3);
    ok(!!dTr, '★ 两张宝牌已对齐 → findDirectTreasure 给得出（该"点"不该"拖"）');
    if (dTr) {
        ok(dTr[0].kind === 'treasure' && dTr[1].kind === 'treasure', '★ 返回的两张都是宝牌');
        eq(dTr[0].char, dTr[1].char, '★ 返回的是**同款**宝牌');
        ok(onlyTr.lineClear(dTr[0], dTr[1]), '★ 两张之间没有别的牌（这才叫"点一下就能消"）');
    }
    // ⚠️ 别拿 `spread` 当反例 —— 它两张宝牌在**同一列**、中间只是空格，
    //   `lineClear` 本来就为真（"中间没有牌"≠"不相邻"），所以它属于"已对齐"。
    //   要构造"没对齐"必须让两张牌**既不同行也不同列**：
    const diag = new core.Board(2, 2);
    diag.setCell(0, 0, { id: 1, char: '铁砧', kind: 'treasure', tex: 'x_ch1_01', r: 0, c: 0 });
    diag.setCell(1, 1, { id: 2, char: '铁砧', kind: 'treasure', tex: 'x_ch1_01', r: 1, c: 1 });
    eq(diag.findDirectTreasure(ptL3), null,
        '★ 两张宝牌斜对角（既不同行也不同列）→ findDirectTreasure 返回 null');
    ok(!!diag.findTreasureMove(ptL3, new rngMod.Rng(1)),
        '★ 同一盘面 findTreasureMove 却给得出走法 —— 这正是两者的分工（拖 vs 点）');

    // 复刻 L3 实测的"夹心"盘面：铁砧 玄 铁砧 —— 挪不动、也点不掉。
    // 冒烟的 `treasure:` 动作正是为了它才加了"先正常消一手"的前置。
    const sandwiched = new core.Board(3, 1);
    sandwiched.setCell(0, 0, { id: 1, char: '铁砧', kind: 'treasure', tex: 'x_ch1_01', r: 0, c: 0 });
    sandwiched.setCell(0, 1, { id: 2, char: '玄', kind: 'radical', r: 0, c: 1 });
    sandwiched.setCell(0, 2, { id: 3, char: '铁砧', kind: 'treasure', tex: 'x_ch1_01', r: 0, c: 2 });
    eq(sandwiched.findDirectTreasure(ptL3), null, '★ 中间夹着一张牌 → 两张宝牌不算"对齐"');
    eq(sandwiched.findTreasureMove(ptL3, new rngMod.Rng(1)), null,
        '★ 夹心盘面下连"挪一步"也给不出（这就是冒烟要加前置消除的原因）');

    eq(normalOnly.findDirectTreasure(new core.PairTable(data.levelByN(1).words)), null,
        '★ 盘上没有宝牌时 findDirectTreasure 返回 null（不会拿普通牌充数）');

    // ---- findDirectPair：普通牌版的"已经对齐、点一下就能消"（`[Diag] DIRECT` 用它）----
    // 冒烟的前置消除靠它把"只能点不该拖"的局面也走下去 —— 少了它，
    // 一旦 `SUGGEST none` + `REACH direct=1`，前置消除就会罢工并报出误导性的
    // "N 手之后仍拿不到宝牌走法"（2026-10-03 实测）。
    const dp = new core.Board(2, 1);          // 2 列 1 行：木 午 并排 → 已对齐
    dp.setCell(0, 0, { id: 1, char: '木', kind: 'radical', r: 0, c: 0 });
    dp.setCell(0, 1, { id: 2, char: '午', kind: 'part', r: 0, c: 1 });
    const dpp = dp.findDirectPair(ptL3);
    ok(!!dpp, '★ 并排的「木 + 午」= 杵 → findDirectPair 给得出这一对');
    if (dpp) {
        eq(dpp[0].char + '+' + dpp[1].char, '木+午',
            '★ 返回的就是那一对（allTiles 是行优先序，「木」在 c=0 所以排在前面）');
        ok(dp.lineClear(dpp[0], dpp[1]), '★ 两张之间没有别的牌');
    }
    // 同一对牌换个位置放（斜对角）→ 不再"对齐"
    const dp2 = new core.Board(2, 2);
    dp2.setCell(0, 0, { id: 1, char: '木', kind: 'radical', r: 0, c: 0 });
    dp2.setCell(1, 1, { id: 2, char: '午', kind: 'part', r: 1, c: 1 });
    eq(dp2.findDirectPair(ptL3), null, '★ 斜对角放 → 不算对齐，findDirectPair 返回 null');
    // 宝牌不参与：宝牌对由 findDirectTreasure 负责，两个入口不能互相冒充
    eq(onlyTr.findDirectPair(ptL3), null,
        '★ 盘上只剩宝牌时 findDirectPair 返回 null（它只管普通牌）');

    // 两个入口在水路上必须一致：`hasDirectMatch` 非空 ⇔ findDirectPair 非空
    eq(!!dp.findDirectPair(ptL3), dp.hasDirectMatch(ptL3),
        '★ findDirectPair 与 hasDirectMatch 口径一致（一个答"是哪对"、一个答"有没有"）');
});

// ------------------------------------------------------------
//  ⑥ findSuggest：给出来的走法必须"玩家真的做得到"
// ------------------------------------------------------------
S('可行解 / 死局检测', () => {
    const lv = data.levelByN(1);
    const pt = new core.PairTable(lv.words);
    const rng = new rngMod.Rng(2026);
    const bd = core.generateBoard(lv, pt, rng);

    const s = bd.findSuggest(pt, rng);
    ok(!!s, 'L1 盘面必有解');
    if (s) {
        // ① 落点必须是"拿起这张牌时就能滑到"的格子（否则提示等于骗玩家）
        const reach = bd.reachableCells(s.tile).some((x) => x.r === s.r && x.c === s.c);
        ok(reach, '★ 建议的落点必须在 reachableCells 里（拖动限制下真走得到）');
        // ② 落点在同行或同列
        ok(s.r === s.tile.r || s.c === s.tile.c, '★ 落点必须与起点同行或同列');
        // ③ 真的执行这一步之后，确实凑成了一对
        bd.removeAt(s.tile);
        bd.setCell(s.r, s.c, s.tile);
        const hits = bd.matchTargets(s.tile, pt);
        ok(hits.length > 0, '★ 走完这一步确实能合成（否则死局检测是假的）');
    }

    // 死局：手工造一个绝对无解的盘面 —— 两个偏旁同处一列且中间无牌，
    // 但种类相同拼不成，且周围没别的牌可借。findSuggest 应为 null。
    const dead = new core.Board(1, 3);
    dead.setCell(0, 0, { id: 1, char: '木', kind: 'radical', r: 0, c: 0 });
    dead.setCell(1, 0, { id: 2, char: '钅', kind: 'radical', r: 1, c: 0 });
    dead.setCell(2, 0, { id: 3, char: '疒', kind: 'junk', r: 2, c: 0 });
    const ds = dead.findSuggest(new core.PairTable(['枪']), new rngMod.Rng(7));
    eq(ds, null, '★ 无解盘面必须返回 null（不能谎报有解）');
});

// ------------------------------------------------------------
//  ⑥b findNonMatch：严格回弹的样本必须"玩家真的做得到、且真的消不掉"
// ------------------------------------------------------------
//  严格回弹（拖了凑不成字就滑回原位）只有"拖了不消"这一种触发场景，
//  drag:<n> 只拖有效走法，永远测不到它。冒烟的 `rebound:` 动作靠
//  Board.findNonMatch 拿一对确定坐标，所以这个函数本身必须先被单测过 ——
//  否则它给出的样本一旦两处都不对（比如落点根本走不到），
//  冒烟就会"拖了个寂寞"，还以为是回弹逻辑有问题。
S('严格回弹样本 findNonMatch', () => {
    const lv = data.levelByN(1);
    const pt = new core.PairTable(lv.words);
    const rng = new rngMod.Rng(2026);
    const bd = core.generateBoard(lv, pt, rng);

    const nm = bd.findNonMatch(pt, rng);
    // L1 是 6×5 的空位不多的盘面，未必存在"能拖但消不掉"的走法 ——
    // 允许 null，但非 null 时必须逐条验证。
    if (nm) {
        // ① 不是干扰牌（干扰牌挪来挪去都不成字，拿它当样本没有意义）
        ok(nm.tile.kind !== 'junk', '★ 回弹样本不能是干扰牌');
        // ② 落点必须是"拿起这张牌时就能滑到"的格子
        const reach = bd.reachableCells(nm.tile).some((x) => x.r === nm.r && x.c === nm.c);
        ok(reach, '★ 回弹样本的落点必须在 reachableCells 里（真拖得到）');
        // ③ 落点在同行或同列
        ok(nm.r === nm.tile.r || nm.c === nm.tile.c, '★ 回弹样本的落点必须与起点同行或同列');
        // ④ 真的执行这一步之后，确实一个都凑不成（否则它就不是"回弹样本"）
        const oR = nm.tile.r, oC = nm.tile.c;
        bd.removeAt(nm.tile);
        bd.setCell(nm.r, nm.c, nm.tile);
        const hits = bd.matchTargets(nm.tile, pt);
        eq(hits.length, 0, '★ 回弹样本落位后必须一个都凑不成（否则会误判成回弹失败）');
        bd.removeAt(nm.tile);
        bd.setCell(oR, oC, nm.tile);
        // ⑤ 探针必须**不留痕**：还原后盘面张数、这张牌的位置都要和原来一致
        eq(nm.tile.r, oR, '★ 探针用完要把牌的位置还原（r）');
        eq(nm.tile.c, oC, '★ 探针用完要把牌的位置还原（c）');
    }

    // 全盘无空位可挪 → 必然 null（不能返回一个走不到的落点）
    const wall = new core.Board(1, 3);
    wall.setCell(0, 0, { id: 1, char: '木', kind: 'radical', r: 0, c: 0 });
    wall.setCell(1, 0, { id: 2, char: '仓', kind: 'part', r: 1, c: 0 });
    wall.setCell(2, 0, { id: 3, char: '钅', kind: 'radical', r: 2, c: 0 });
    // 这三张挤满一列，谁都没有空位可挪（上下左右全被堵）
    eq(wall.findNonMatch(new core.PairTable(['枪']), new rngMod.Rng(3)), null,
        '★ 一张牌都挪不动时必须返回 null');
});

// ------------------------------------------------------------
//  ⑦ 存档：连锁解锁 + 星级只升不降
// ------------------------------------------------------------
S('存档', () => {
    saveMod.Save.reset();
    eq(saveMod.Save.isUnlocked(1), true, 'L1 永远开放');
    eq(saveMod.Save.isUnlocked(2), false, 'L2 初始锁定');
    eq(saveMod.Save.isUnlocked(3), false, 'L3 初始锁定');

    const mkRes = (level, stars) => ({
        level, leftSec: 100, totalSec: 150, stars, moves: 10, words: 2,
        runWords: [{ w: '枪', need: 3, got: 3 }],
    });

    saveMod.Save.recordClear(mkRes(1, 2));
    eq(saveMod.Save.stars(1), 2, 'L1 记 2 星');
    eq(saveMod.Save.isUnlocked(2), true, '★ 通了 L1 → L2 解锁');
    eq(saveMod.Save.isUnlocked(3), false, 'L3 仍锁定（要通 L2）');

    // 重打拿低星，不能把高星顶掉
    saveMod.Save.recordClear(mkRes(1, 1));
    eq(saveMod.Save.stars(1), 2, '★ 重打 1 星不覆盖已有的 2 星');
    saveMod.Save.recordClear(mkRes(1, 3));
    eq(saveMod.Save.stars(1), 3, '重打 3 星可以升上去');

    eq(saveMod.Save.totalStars(), 3, '总星数');
    eq(saveMod.Save.litCount(), 1, '已合成字数去重计数');
    saveMod.Save.recordClear(mkRes(2, 1));
    eq(saveMod.Save.isUnlocked(3), true, '通了 L2 → L3 解锁');

    // 时间记录取最短
    saveMod.Save.recordClear({ ...mkRes(2, 1), leftSec: 140 });
    eq(saveMod.Save.load().bestTime[2], 10, '最短用时取更小值（150-140=10）');
});

// ------------------------------------------------------------
//  ⑧ 求解器内核（core/Solver.ts）—— 工具与游戏共用的那一份
// ------------------------------------------------------------
/**
 * 【这一节在守什么】
 * 2026-10-03 用户拍板方案 A：把"整盘能不能消空"的判定从
 * `tools/solve-exact.js` 抽到 `core/Solver.ts`，让**离线逐关判定**与
 * **游戏里「看广告重排」的兑现判定**调同一个函数。
 *
 * 于是有三件事必须钉死在自检里，任何一件松了都会让"两边其实不是一套规则"：
 *   ① `listActions` 的动作集必须与引擎**逐字一致** —— 暴力枚举
 *      "每张牌搬到每个可达格、取 matchTargets[0]"当基准对账；
 *   ② **契约**：判定函数返回时盘面必须原样（含撞预算的异常路径）。
 *      这条松了，症状会伪装成"游戏规则出了问题"（踩过两次）；
 *   ③ **三态语义**：`UNKNOWN` 绝不能退化成 `NO`。
 *      没搜过/没搜完就说"这盘无解"，是把"没找"当"没有"。
 */
S('求解器·动作集与引擎逐字对账', () => {
    const lv = data.LEVELS.find((l) => l.n === 5);
    const pair = new core.PairTable(lv.words);
    const bd = core.generateBoard(lv, pair, new rngMod.Rng(20261003));

    // 基准：手写一遍引擎口径。
    // ★ 2026-10-03 推箱上线后，基准不能再是"只搬 t"——
    //   必须是"把 t 和它前方连着的那一串整体平移"，否则基准本身就落后于规则。
    //   这里**故意不调 bd.dragMoves**：对账的意义就是拿一份独立实现去撞，
    //   调同一个函数等于自己跟自己比。
    const brute = new Set();
    for (const t of bd.allTiles()) {
        for (const x of [{ r: t.r, c: t.c }].concat(bd.reachableCells(t))) {
            const dr = Math.sign(x.r - t.r), dc = Math.sign(x.c - t.c);
            const k = Math.abs(dr ? x.r - t.r : x.c - t.c);
            const touched = [{ t, fr: t.r, fc: t.c, tr: x.r, tc: x.c }];
            if (k > 0 && (dr === 0 || dc === 0)) {
                let rr = t.r + dr, cc = t.c + dc;
                const run = [];
                while (bd.inBounds(rr, cc) && bd.at(rr, cc)) {
                    run.push(bd.at(rr, cc)); rr += dr; cc += dc;
                }
                for (const o of run) {
                    touched.push({ t: o, fr: o.r, fc: o.c, tr: o.r + k * dr, tc: o.c + k * dc });
                }
            }
            for (const m of touched) bd.setCellRaw(bd.idx(m.fr, m.fc), null);
            for (const m of touched) { bd.setCellRaw(bd.idx(m.tr, m.tc), m.t); m.t.r = m.tr; m.t.c = m.tc; }
            const hits = bd.matchTargets(t, pair);
            const hit = hits.length ? hits[0] : null;
            for (const m of touched) bd.setCellRaw(bd.idx(m.tr, m.tc), null);
            for (let i = touched.length - 1; i >= 0; i--) {
                const m = touched[i];
                bd.setCellRaw(bd.idx(m.fr, m.fc), m.t); m.t.r = m.fr; m.t.c = m.fc;
            }
            if (hit) brute.add(t.id + ':' + hit.id + '@' + x.r + ',' + x.c);
        }
    }
    const acts = solverMod.listActions(bd, pair);
    const got = acts.map((a) => a.t.id + ':' + a.o.id + '@' + a.x.r + ',' + a.x.c);

    // ★ 去重键里必须带落点：同一个 (拖谁, 消谁) 从不同落点过去，
    //   被推的牌落在哪不一样，是两个不同的局面（见 listActions 注释）
    eq(new Set(got).size, got.length, 'listActions 不含重复的 (t,o,落点)');
    eq(JSON.stringify(got.slice().sort()), JSON.stringify([...brute].sort()),
        '★ 动作集与"暴力枚举整段平移后的 matchTargets[0]"完全一致（引擎口径，不是另写一套）');
    ok(acts.every((a) => a.t !== a.o), '一步走法的搭档不会是自己');

    // 每个动作给出的落点，落上去之后 firstHit 必须**恰好**是那个 o
    // （这条就是"动作集精确到第一个"的断言，见 Solver.firstHit 的注释）
    const wrong = acts.filter((a) => solverMod.firstHit(bd, pair, a.t, a.x) !== a.o);
    eq(wrong.length, 0, '★ 每个动作的落点都精确锁定它声明的搭档 o');
});

// ------------------------------------------------------------
//  ⑧b 推箱（2026-10-03 用户拍板「允许推着相邻的格子一起动」）
// ------------------------------------------------------------
/**
 * 【这一节在守什么】
 * 推箱是本作第一次出现"**没被消掉的牌也会永久搬家**"的规则。
 * 它同时踩到三处最容易静默出错的地方，所以每处都要有断言钉住：
 *   ① `slideRange` 要把"前方连着的一整段"算成可推的余量（挡路的牌不再是终点）；
 *   ② `dragMoves` 给出的位移必须是**整段刚性平移**，且 `applyDrag/undoDrag`
 *      必须严格互逆（否则"严格回弹"会把盘面搞脏，而脏了不会报错）；
 *   ③ 状态键必须带上坐标（否则两个不同盘面被当成同一个，搜索静默漏解）。
 */
S('推箱·滑动范围把"前方一整段"也算进来', () => {
    // (cols, rows) —— 注意 Board 的构造签名是 (列, 行)
    const bd = new core.Board(5, 1);
    const mk = (id, ch, kind, r, c) => { const t = { id, char: ch, kind, r, c }; bd.setCell(r, c, t); return t; };
    // [A][B][C] . .   —— A 推得动整段：段尾 C 后面还有 2 格空
    const A = mk(0, '木', 'radical', 0, 0);
    mk(1, '仓', 'part', 0, 1);
    mk(2, '木', 'radical', 0, 2);

    const g = bd.slideRange(A);
    eq(g.right, 2, '★ A 最远能推到第 2 列（推 2 格：BC 整段一起走）');
    eq(g.left, 0, '左边没空间，一步都动不了');

    // 推到最远：A@2 B@3 C@4
    const mv = bd.dragMoves(A, 0, 2);
    eq(mv.length, 3, '被推的是"整段"—— A 自己 + 后面 2 张，共 3 动');
    eq(mv.map((m) => m.t.id + ':' + m.to.c).join(','), '0:2,1:3,2:4',
        '★ 整段刚性平移：每张都走同样的 2 格');
});

S('推箱·applyDrag 与 undoDrag 严格互逆', () => {
    const bd = new core.Board(5, 1);
    const mk = (id, r, c) => { const t = { id, char: 'x', kind: 'part', r, c }; bd.setCell(r, c, t); return t; };
    const A = mk(0, 0, 0);
    mk(1, 0, 1);
    mk(2, 0, 2);
    const before = bd.fingerprint();

    const mv = bd.dragMoves(A, 0, 2);
    bd.applyDrag(mv);
    eq(bd.fingerprint() === before, false, '落位之后盘面确实变了');
    eq([0, 1, 2, 3, 4].map((c) => (bd.at(0, c) ? bd.at(0, c).id : '-')).join(''), '--012',
        '落位后：A 在 2，原来 1/2 位上的两张被推到 3/4');
    bd.undoDrag(mv);
    eq(bd.fingerprint(), before, '★ 撤销之后指纹逐字回到改前（严格回弹的底座）');
    eq([0, 1, 2, 3, 4].map((c) => (bd.at(0, c) ? bd.at(0, c).id : '-')).join(''), '012--',
        '撤销后：三张各回各位');
});

S('推箱·被墙/被别的牌挡住就推不动', () => {
    const bd = new core.Board(4, 1);
    const mk = (id, r, c) => { const t = { id, char: 'x', kind: 'part', r, c }; bd.setCell(r, c, t); return t; };
    const A = mk(0, 0, 0);
    mk(1, 0, 1);
    // 1,2,3 全占满、右边是墙 → 段尾顶到墙，一格都推不动
    mk(2, 0, 2);
    mk(3, 0, 3);
    eq(bd.slideRange(A).right, 0, '★ 整行占满 + 右边是墙 ⇒ 一格都推不动');
    // 落点由 clampSlide 夹在 range 里，所以"推不动"在盘面上的样子是**落点就是原地**，
    // 于是 dragMoves 返回空数组（没有任何位移）。
    eq(bd.dragMoves(A, 0, bd.slideRange(A).right).length, 0,
        '★ 被夹回原地 ⇒ 一动都没有（dragMoves 返回空）');

    // 中间隔一个空格 → 只推到空格处为止，不会隔空推第二段
    const bd2 = new core.Board(5, 1);
    const B = { id: 0, char: 'x', kind: 'part', r: 0, c: 0 };
    bd2.setCell(0, 0, B);
    bd2.setCell(0, 2, { id: 9, char: 'y', kind: 'part', r: 0, c: 2 });
    eq(bd2.slideRange(B).right, 1, '★ 前方是空格、空格后面才是牌 ⇒ 只到空格为止（不隔空推）');
});

S('推箱·状态键带上坐标（否则不同盘面会被当成同一个）', () => {
    const bd = new core.Board(5, 1);
    const mk = (id, c) => { const t = { id, char: 'x', kind: 'part', r: 0, c }; bd.setCell(0, c, t); return t; };
    const A = mk(0, 0);
    mk(1, 1);
    const k0 = solverMod.stateKey(bd);
    bd.applyDrag(bd.dragMoves(A, 0, 1));
    const k1 = solverMod.stateKey(bd);
    eq(k0 === k1, false, '★ 牌位变了 ⇒ 局面键必须跟着变（只记"还剩哪些牌"会把两个局面混成一个）');
});

/**
 * ★★ 这一条是本次改动的**价值证明**：直接复刻用户截图里的那一手。
 *
 * 盘面（3 列 × 2 行）：
 *      奴  革  .
 *      父  弓  .
 *
 * 奴 与 弓 不同行也不同列，本来**永远碰不到**（旧规则下 奴 四向全被堵死，
 * `canSlide` 都是 false）。推箱之后：
 *      奴 往右推 → 革 让到 (0,2)，奴 落到 (0,1)
 *      → 奴 与 弓 同列相邻 → 凑成「弩」
 *      消掉之后 革 **永久停在被推到的那一格**（用户原话：
 *      "当两者消掉后，革字比原来往右移动了一格"）
 *
 * 用户截图里圈的就是这三张牌。这条断言等于把那张截图钉进自检。
 */
S('推箱·复刻用户截图那一手（奴推革让位，与弓凑成弩）', () => {
    const pair = new core.PairTable(['弩']);           // 弩 = 奴 + 弓
    const bd = new core.Board(3, 2);
    const nu = { id: 1, char: '奴', kind: 'radical', r: 0, c: 0 };
    const ge = { id: 2, char: '革', kind: 'radical', r: 0, c: 1 };
    const gong = { id: 3, char: '弓', kind: 'part', r: 1, c: 1 };
    bd.setCell(0, 0, nu);
    bd.setCell(0, 1, ge);
    bd.setCell(1, 1, gong);

    // 旧规则会在这里判"奴 动不了"；新规则它推得动右边那张
    eq(bd.slideRange(nu).right, 1, '★ 奴 能往右推到第 1 列（旧规则＝0，一格都动不了）');
    eq(bd.canSlide(nu), true, '★ 四向被堵死也不等于动不了 —— 能推就是有路');

    const mv = bd.dragMoves(nu, 0, 1);
    eq(mv.length, 2, '被推的是 革 一张，加上 奴 自己 = 2 动');
    eq(mv[1].t, ge, '第二动是 革');
    eq(mv[1].to.r + ',' + mv[1].to.c, '0,2', '革 被推到 (0,2)');

    eq(solverMod.firstHit(bd, pair, nu, { r: 0, c: 1 }), gong,
        '★★ 落到 (0,1) 之后，引擎口径命中的搭档就是 弓 —— 这正是玩家那一手');
    ok(solverMod.listActions(bd, pair).some((a) => a.t === nu && a.x.c === 1),
        '★ 动作集里含这一手（旧动作集里没有它，所以重排判据看不见"推箱解"）');

    // 消掉之后：革 停在新位置 —— 这条就是"推箱让牌真的搬家"的直接证据
    solverMod.applyAction(bd, { t: nu, o: gong, x: { r: 0, c: 1 } });
    eq(bd.at(0, 2), ge, '★ 消掉 奴+弓 之后，革 永久停在 (0,2)');
    eq(bd.remainingPlayable(), 1, '盘上只剩被推走的 革 这一张');
});

S('推箱·apply/undo 往返必须逐字还原（含被推的那张）', () => {
    const pair = new core.PairTable(['弩']);
    const bd = new core.Board(3, 2);
    const nu = { id: 1, char: '奴', kind: 'radical', r: 0, c: 0 };
    const ge = { id: 2, char: '革', kind: 'radical', r: 0, c: 1 };
    const gong = { id: 3, char: '弓', kind: 'part', r: 1, c: 1 };
    bd.setCell(0, 0, nu); bd.setCell(0, 1, ge); bd.setCell(1, 1, gong);

    const fp = bd.fingerprint();
    const ap = solverMod.applyAction(bd, { t: nu, o: gong, x: { r: 0, c: 1 } });
    solverMod.undoAction(bd, ap);
    // ★ 这条是推箱版最要紧的回归：撤销若只把"消掉的牌放回去"、不倒回位移，
    //   盘面看着"牌都回来了"其实是错位的，而且**不会报任何错**。
    eq(bd.fingerprint(), fp, '★ applyAction → undoAction 之后指纹逐字还原');
    eq(bd.at(0, 2), null, '革 也回到了原位，没留在被推到的格子上');
    eq(bd.at(0, 1), ge, '革 回到 (0,1)');
});

/**
 * 用户的第二个例子（image #4）：**被别的牌挡住就推不进去**。
 *      奴
 *      父
 *      .
 *      前
 * 奴 往下推 → 奴 到 (1,0)、父 到 (2,0)，**只能走一格**：
 * 再往下父就顶到「前」了。
 */
S('推箱·被挡就停（复刻用户第二个例子）', () => {
    const bd = new core.Board(1, 4);                    // 1 列 × 4 行
    const nu = { id: 1, char: '奴', kind: 'radical', r: 0, c: 0 };
    const fu = { id: 2, char: '父', kind: 'radical', r: 1, c: 0 };
    const qian = { id: 3, char: '前', kind: 'part', r: 3, c: 0 };
    bd.setCell(0, 0, nu);
    bd.setCell(1, 0, fu);
    bd.setCell(3, 0, qian);

    eq(bd.slideRange(nu).down, 1, '★ 奴 最远只到第 1 行（整段前移 1 格就顶住了）');
    const mv = bd.dragMoves(nu, 1, 0);
    eq(mv.length, 2, '父 被一起推下去');
    eq(mv[1].to.r, 2, '父 到 (2,0) —— 再往下就是 前，顶住了');
    eq(bd.at(4 - 1, 0), qian, '前 原地不动，它是"墙"');
});


S('求解器·不改动盘面（契约，含异常路径）', () => {
    const lv = data.LEVELS.find((l) => l.n === 8);
    const pair = new core.PairTable(lv.words);
    const bd = core.generateBoard(lv, pair, new rngMod.Rng(777));
    const before = bd.fingerprint();
    const rng = new rngMod.Rng(20261003);

    // tries=0 ⇒ 贪心一次都不跑；budget=0 / deadline 过期 ⇒ 明确"这一轮不做 DFS"
    const v = solverMod.solvableInPlace(bd, pair, rng, { tries: 0, budget: 0, boardDeadline: 0 });
    eq(v.verdict, 'UNKNOWN', '★ 只跑便宜档（且没命中）时必须报 UNKNOWN，不能谎报 NO');
    eq(bd.fingerprint(), before, 'solvableInPlace 返回后盘面指纹不变');

    solverMod.greedyPlan(bd, pair, rng, 5, 'none');
    eq(bd.fingerprint(), before, 'greedyPlan 返回后盘面指纹不变');

    solverMod.search(bd, pair, { budget: 20000, deadline: Date.now() + 3000 });
    eq(bd.fingerprint(), before, 'search 返回后盘面指纹不变');

    // ★ 撞预算这一路：哨兵是从很深的地方抛出来的，沿途的 undo 全被跳过，
    //   所以 search 必须在 catch 里补一次全量还原（见 Solver.search 的契约注释）
    const v2 = solverMod.solvableInPlace(bd, pair, rng, { tries: 0, budget: 1, boardDeadline: Date.now() + 5000 });
    eq(v2.verdict, 'UNKNOWN', '★ 撞预算必须是 UNKNOWN —— 绝不能报成"这盘无解"');
    eq(v2.via, 'budget', '撞预算的 via=budget（与"只跑便宜档"的 via=greedy 分开记账）');
    eq(bd.fingerprint(), before, '★ 撞预算抛出后盘面同样必须原样');
});

S('求解器·找得到解 与 穷尽证伪', () => {
    // ① 真盘面：种子表里那 4 颗是**离线验过有解**的，这里当场再证一次
    const lv3 = data.LEVELS.find((l) => l.n === 3);
    const pair3 = new core.PairTable(lv3.words);
    const seed = seedsMod.seedsOf(3)[0];
    const bd3 = core.generateBoard(lv3, pair3, new rngMod.Rng(seed));
    const v1 = solverMod.solvableInPlace(bd3, pair3, new rngMod.Rng(1),
        { tries: 8, budget: 200000, boardDeadline: Date.now() + 8000 });
    eq(v1.verdict, 'YES', `种子表里 L3 的种子应当有解（seed=${seed}）`);
    ok(v1.steps > 0, 'YES 时必须给出走法步数');

    // ② 人为造死局：两张**都是偏旁**的牌 —— canPair 要求一偏旁 + 一部件，
    //    所以它们永远配不到一起，盘面清空不了 ⇒ DFS 必须穷尽后报 NO
    //    （构造是 (cols, rows)：2 列 3 行，两张牌分别放在 (0,0) 与 (2,0)）
    const bdDead = new core.Board(2, 3);
    const t1 = { id: 1, char: '木', kind: 'radical', r: 0, c: 0 };
    const t2 = { id: 2, char: '氵', kind: 'radical', r: 2, c: 0 };
    bdDead.setCellRaw(bdDead.idx(0, 0), t1);
    bdDead.setCellRaw(bdDead.idx(2, 0), t2);
    const deadPair = new core.PairTable(lv3.words);
    eq(deadPair.canPair(t1, t2), false, '两张偏旁之间不能互配（前提）');
    const v2 = solverMod.solvableInPlace(bdDead, deadPair, new rngMod.Rng(1),
        { tries: 3, budget: 20000, boardDeadline: Date.now() + 3000 });
    eq(v2.verdict, 'NO', '★ 真的走不动时必须是 NO（有 DFS 穷尽当证据）');
    eq(v2.via, 'dfs', 'NO 只能由 DFS 给出');
});

S('求解器·预算哨兵可辨识', () => {
    // ★ 为什么专门测这个：内核**故意不用** `class BudgetError extends Error` ——
    //   微信小游戏的构建链有一档"ES6 转 ES5"，那里 `extends Error` 的 instanceof
    //   会静默失效，于是"撞预算"会被当成崩溃抛出去。改用字段当哨兵就是为了绕开它。
    //   这里断言"普通 Error 不会被误认成哨兵"（反向也成立：哨兵必须带上那个字段）。
    eq(solverMod.isBudgetStop(new Error('普通错误')), false,
        '★ 普通 Error 不会被认成预算哨兵');
    eq(solverMod.isBudgetStop(null), false, 'null 不会被认成哨兵');
    eq(solverMod.isBudgetStop(undefined), false, 'undefined 不会被认成哨兵');
    // 真的撞一次，确认抛出来的确实是哨兵（而不是被 catch 成别的）
    const lv = data.LEVELS.find((l) => l.n === 38) || data.LEVELS[data.LEVELS.length - 1];
    const pair = new core.PairTable(lv.words);
    const bd = core.generateBoard(lv, pair, new rngMod.Rng(4242));
    let flag = null;
    try {
        solverMod.search(bd, pair, { budget: 1, deadline: Date.now() + 5000 });
    } catch (e) { flag = solverMod.isBudgetStop(e); }
    eq(flag, true, '★ 节点上限触发时抛出的必须是预算哨兵（而不是普通异常）');
});

// ------------------------------------------------------------
//  结果
// ------------------------------------------------------------
console.log(`\n断言通过 ${pass} 条，失败 ${fails.length} 条`);
if (fails.length) {
    console.error('\n✖ 失败明细：');
    for (const f of fails) console.error('  · ' + f);
    process.exit(1);
}
console.log('✅ core/ 玩法规则全部自测通过（滑动范围与推箱 / 对齐合成 / 发牌可复现 / 可行解 / 求解器内核 / 存档）');
