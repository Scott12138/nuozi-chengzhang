/* ============================================================
 *  gen-level-seeds.js · 给每一关挑 4 颗「开局已验证有解」的固定种子
 * ============================================================
 *  用户 2026-10-03 拍板（本轮原话）：
 *    「减少随机开局的情况，从 8 盘随机开局降低到 4 盘随机开局，
 *      保证这 4 种开局时一定有解的」
 *
 *  于是「开局随机发牌」下线，改成：**每关固定 4 颗种子，开局从这 4 颗里随机挑一颗**。
 *  这 4 颗必须**每一颗都被求解器判定为有解**，而且是**离线**判定的 ——
 *  手机端因此不需要跑任何求解，开局零额外开销。
 *
 *  ------------------------------------------------------------------
 *  一、为什么不"运行时自检"
 *  ------------------------------------------------------------------
 *  另一条路是"生成后现场自检、不行就重排"。它保留了"每局都不一样"，
 *  但代价是开局要在手机上跑一遍搜索（实测单次贪心 0.4~3ms，乘上重排次数
 *  是几十到几百毫秒），而且**每次开局都要重付**。固定种子把这笔钱挪到离线，
 *  一次付清。用户选的是后者。
 *
 *  ------------------------------------------------------------------
 *  二、判据与真源（本工具不重写规则）
 *  ------------------------------------------------------------------
 *  求解器就是 `tools/solve-exact.js`（它直接 require 编译后的 `core/*.ts`）。
 *  判据口径固定 `bonus: 'none'` —— 也就是"**这张牌面本身是不是死局**"，
 *  与宝牌赠品的运气无关（口径的来由见 solve-exact.js 文件头第三节）。
 *
 *  ------------------------------------------------------------------
 *  三、产出
 *  ------------------------------------------------------------------
 *    game-5-chaizi/assets/scripts/core/LevelSeeds.ts   ← 生成物，勿手改
 *    docs/verify/level-seeds.json                      ← 归档（含每颗种子当时的有解证据）
 *
 *  LevelSeeds.ts 里同时存下每颗种子**当时**的发牌指纹（`Board.fingerprint()`）。
 *  `tools/core-selftest.js` 会在每次自检时重算指纹并比对：
 *  对不上 ⇒ 发牌路径（Board / LevelData / Treasure / Rng）动过了 ⇒
 *  「这四局有解」这个结论已过期 ⇒ 必须重跑本工具。这是那 4 颗种子**不会悄悄失效**的保证。
 *
 *  ★★ 2026-10-03 修正一处**会丢证据**的旧口径 ★★
 *  说明：本工具原来把归档**写死在 `docs/verify/S14/level-seeds.json`**。
 *  意味着以后每一次重挑种子都会**静默覆盖** S14 那一轮的原始证据 ——
 *  而 S14 那份 JSON 里记的正是"当时那 4 颗种子有解"的一手凭据，
 *  它被覆盖之后，「S14 的结论是什么」就再也说不清了（与上一版仓库
 *  `*.log` 被静默排掉是同一类错：证据消失时不报错）。
 *  现在：默认写**中性路径** `docs/verify/level-seeds.json`（表示"当前状态"），
 *  每一轮验收要留档时用 `--out docs/verify/S<轮次>/level-seeds.json` 显式指定。
 *
 *  用法：
 *    node tools/gen-level-seeds.js                 # 挑种子并写文件
 *    node tools/gen-level-seeds.js --verify        # 只复核已入库的种子（逐颗重判）
 *    node tools/gen-level-seeds.js --levels 3-38 --per 4
 *    node tools/gen-level-seeds.js --out docs/verify/S18/level-seeds.json
 *  退出码：0 = 全部通过
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const S = require('./solve-exact.js');

const ROOT = path.dirname(__dirname);
const SCRIPTS = path.join(ROOT, 'game-5-chaizi', 'assets', 'scripts');
const OUT_TS = path.join(SCRIPTS, 'core', 'LevelSeeds.ts');
/** 默认写**中性路径**（= "当前状态"），避免把某一轮的验收证据覆盖掉。见文件头第三十节 */
const OUT_JSON_DEF = path.join(ROOT, 'docs', 'verify', 'level-seeds.json');
let OUT_JSON = OUT_JSON_DEF;

/** 每关要几颗种子（用户拍板：4） */
const PER_LEVEL_DEF = 4;
/** 挑种子时的候选上限：找不到 4 颗就报错，绝不静默降级 */
const MAX_CANDIDATES = 800;
/** 判"有解"时换多少个随机顺序（全败才上 DFS） */
const RESTARTS = 120;
/** 单盘 DFS 的节点/墙钟上限（判"真的无解"用） */
const BUDGET = 800000;
const BOARD_MS = 6000;

function parseArgs(argv) {
    const o = { levels: '1-38', per: PER_LEVEL_DEF, verify: false, quiet: false, out: null };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--levels') o.levels = argv[++i];
        else if (a === '--per') o.per = parseInt(argv[++i], 10);
        else if (a === '--verify') o.verify = true;
        else if (a === '--quiet') o.quiet = true;
        else if (a === '--out') o.out = argv[++i];
        else if (a === '--help' || a === '-h') { console.log('用法见文件头注释'); process.exit(0); }
        else { console.error('未知参数：' + a); process.exit(2); }
    }
    return o;
}

// ============================================================
//  主流程
// ============================================================
function main() {
    const opt = parseArgs(process.argv);
    const t0 = Date.now();
    const { PairTable, generateBoard, LEVELS, Rng } = S.compileCore();
    const byN = new Map(LEVELS.map((l) => [l.n, l]));

    const say = (s) => { if (!opt.quiet) console.log(s); };
    const nums = S.parseLevels(opt.levels).filter((n) => byN.has(n));
    if (!nums.length) { console.error('✖ 关号区间解析为空：' + opt.levels); process.exit(2); }

    const mk = (lv, seed) => {
        const pair = new PairTable(lv.words);
        const bd = generateBoard(lv, pair, new Rng(seed));
        return { pair, bd };
    };

    // 候选种子怎么来：由「关号」派生的固定序列 —— 可复现，且换一批时整批一起换。
    //   不用时间戳：这一批种子是要**写进源码**的，必须任何人任何机器跑出来都一样。
    function candidate(lv, k) {
        const r = new Rng(20261003 + lv.n * 100003);
        for (let i = 0; i <= k; i++) r.next();
        return r.int(1, 0x7fffffff);
    }

    /**
     * 判一颗种子：这盘有解吗？
     * ★ 判据固定 `bonus:'none'`（solve-exact 的 solvable 内部就是这么定的），
     *   所以这里只负责把工厂喂进去。
     */
    function judge(lv, seed) {
        const g = S.solvable(
            () => mk(lv, seed).bd,
            () => new PairTable(lv.words),
            { restarts: RESTARTS, budget: BUDGET, boardDeadline: Date.now() + BOARD_MS, seed: (seed ^ 0x5bf03635) >>> 0 },
        );
        return g;
    }

    const report = { generatedAt: new Date(t0).toISOString(), per: opt.per, levels: {}, ok: true };

    // ★ 归档路径：`--out` 显式指定（**每一轮验收都该这么用，否则会覆盖上一轮的证据**）。
    //   默认写中性路径 docs/verify/level-seeds.json（= "当前状态"，不冒充某一轮）。
    if (opt.out) {
        OUT_JSON = path.isAbsolute(opt.out) ? opt.out : path.join(ROOT, opt.out);
    }
    if (!opt.verify) console.log(`  归档：${path.relative(ROOT, OUT_JSON)}`);

    // ---------- 模式一：复核已入库的种子 ----------
    if (opt.verify) {
        if (!fs.existsSync(OUT_TS)) { console.error('✖ 没有 ' + OUT_TS + '，先跑一次不带 --verify 的'); process.exit(2); }
        const mod = requireCompiled();
        say(`复核 ${OUT_TS}（每关 ${opt.per} 颗，共 ${nums.length} 关）`);
        let bad = 0, total = 0;
        for (const n of nums) {
            const lv = byN.get(n);
            const seeds = (mod.LEVEL_SEEDS || {})[n] || [];
            const fps = (mod.LEVEL_BOARD_FP || {})[n] || [];
            const row = { seeds: seeds.slice(), verdicts: [], fps: [] };
            if (seeds.length !== opt.per) {
                say(`L${String(n).padStart(2)} ✖ 种子里只有 ${seeds.length} 颗，期望 ${opt.per}`);
                bad++; report.ok = false; report.levels[n] = row;
                continue;
            }
            for (let i = 0; i < seeds.length; i++) {
                total++;
                const seed = seeds[i];
                // ① 指纹：发牌路径没变？
                const fpNow = mk(lv, seed).bd.fingerprint();
                const fpOk = fpNow === fps[i];
                // ② 有解：这盘还能通关吗？
                const v = judge(lv, seed);
                row.verdicts.push(v.verdict + '/' + v.via);
                row.fps.push({ want: fps[i], got: fpNow, ok: fpOk });
                if (!fpOk || v.verdict !== 'YES') {
                    bad++;
                    say(`L${String(n).padStart(2)} seed=${seed} ✖ ${v.verdict}/${v.via}`
                        + (fpOk ? '' : ` 指纹不符（表里 ${fps[i]}，现在 ${fpNow}）`));
                }
            }
            report.levels[n] = row;
            if (!bad) say(`L${String(n).padStart(2)} ✓ ${seeds.length} 颗全部有解，指纹一致`);
        }
        report.total = total;
        report.bad = bad;
        report.ok = bad === 0;
        finish(report, opt, t0);
        return;
    }

    // ---------- 模式二：挑种子 ----------
    say('挑种子：每关 ' + opt.per + ' 颗「开局有解」的固定盘面');
    say(`判据：tools/solve-exact.js（直接 require core 真源）· bonus=none · 换 ${RESTARTS} 个顺序贪心，全败再上 DFS`);
    say('');

    const seedsByLevel = {};
    const fpByLevel = {};
    let allOk = true;

    for (const n of nums) {
        const lv = byN.get(n);
        const found = [];
        const fps = [];
        const seenFp = new Set();
        let k = 0;
        let tried = 0;
        let rejectedNoSol = 0;
        let rejectedDup = 0;
        const t1 = Date.now();
        while (found.length < opt.per && k < MAX_CANDIDATES) {
            const seed = candidate(lv, k++);
            tried++;
            const made = mk(lv, seed);
            const fp = made.bd.fingerprint();
            if (seenFp.has(fp)) { rejectedDup++; continue; }   // 同一盘面不能占两个名额
            const v = judge(lv, seed);
            if (v.verdict === 'YES') {
                seenFp.add(fp);
                found.push(seed);
                fps.push(fp);
            } else if (v.verdict === 'NO') {
                rejectedNoSol++;
            } else {
                // 未知（DFS 撞预算）**不能**当有解收下，也不能当无解丢掉 ——
                // 直接跳过它，继续看下一颗。代价只是多试几次。
                rejectedNoSol++;
            }
        }
        const ms = Date.now() - t1;
        if (found.length < opt.per) {
            say(`L${String(n).padStart(2)} ✖ 只找到 ${found.length}/${opt.per} 颗（试了 ${tried} 颗候选，`
                + `无解 ${rejectedNoSol}、重样 ${rejectedDup}）—— ${lv.cols}×${lv.rows} 牌=${lv.pairs * 2 + lv.tr * 2} tr=${lv.tr}`);
            allOk = false;
        } else {
            say(`L${String(n).padStart(2)} ✓ ${found.length} 颗  `
                + `试了 ${tried} 颗候选（无解 ${rejectedNoSol}、重样 ${rejectedDup}）  ${ms}ms  `
                + `种子 ${found.join(', ')}`);
        }
        seedsByLevel[n] = found;
        fpByLevel[n] = fps;
        report.levels[n] = {
            cols: lv.cols, rows: lv.rows, pairs: lv.pairs, tr: lv.tr,
            tiles: lv.pairs * 2 + lv.tr * 2, candidatesTried: tried,
            rejectedNoSol, rejectedDup, ms, seeds: found, fps,
        };
    }

    report.ok = allOk;
    if (!allOk) {
        say('');
        say('✖ 有关卡凑不齐 ' + opt.per + ' 颗「有解」的种子 —— 这通常说明这一关的牌面本身就很难有解。');
        say('  （这是关卡设计要处理的事，不是把工具调松：种子的意义就是"这四局一定通得了"。）');
        finish(report, opt, t0);
        return;
    }

    writeTs(seedsByLevel, fpByLevel, nums, opt);
    say('');
    say(`✓ 已写入 ${path.relative(ROOT, OUT_TS)}（${nums.length} 关 × ${opt.per} 颗）`);
    finish(report, opt, t0);
}

// ============================================================
//  写 LevelSeeds.ts
// ============================================================
function writeTs(seeds, fps, nums, opt) {
    const L = [];
    L.push('/**');
    L.push(' * ============================================================');
    L.push(' *  LevelSeeds.ts · 每关 4 颗「开局已验证有解」的固定种子（生成物，勿手改）');
    L.push(' * ============================================================');
    L.push(' *  生成器：`node tools/gen-level-seeds.js`');
    L.push(' *');
    L.push(' *  【它解决什么】');
    L.push(' *  用户拍过「每一关做完设计后固定下来，开局要确定有解」。但发牌是随机的，');
    L.push(' *  实测（36 关 × 8 盘）**只有 84% 的随机开局有解** —— 20 关会发到死局盘面。');
    L.push(' *  现在改成：每关固定这 4 颗种子，开局从里面随机挑一颗。');
    L.push(' *  这 4 颗**每一颗都经求解器判定为有解**（判据口径 bonus=none，见');
    L.push(' *  tools/solve-exact.js 文件头），而且是**离线**判定的 ⇒ 手机端零额外开销。');
    L.push(' *');
    L.push(' *  【LEVEL_BOARD_FP 是干什么的】');
    L.push(' *  种子表有没有跟上"当前的发牌实现"，不能靠人记。这里存下每颗种子当时');
    L.push(' *  的发牌指纹（`Board.fingerprint()`），`tools/core-selftest.js` 每次自检');
    L.push(' *  重算一遍比对：**对不上 ⇒ 发牌路径动过了 ⇒「这四局有解」已过期 ⇒');
    L.push(' *  重跑 `node tools/gen-level-seeds.js`**。');
    L.push(' *  ⚠️ 自检只能查"路径没变"，查不出"路径变了但指纹恰好一样"（32 位，约 3e-6）；');
    L.push(' *     真正的有解性复核是 `node tools/gen-level-seeds.js --verify`，发布前跑一次。');
    L.push(' *');
    L.push(' *  ⚠️ 关卡数据（LevelData.ts）一改，就**必须**重跑生成器：');
    L.push(' *     `lv.words / pairs / tr / ch` 任一变化都会让这 4 局的盘面变样。');
    L.push(' * ============================================================');
    L.push(' */');
    L.push('');
    L.push('/** 生成器的基准常量；种子由它派生，改它等于整批换种子 */');
    L.push('export const SEED_MASTER = 20261003;');
    L.push('');
    L.push('/** 每关固定几颗种子（开局从这里面随机挑一颗） */');
    L.push('export const SEEDS_PER_LEVEL = ' + opt.per + ';');
    L.push('');
    L.push('/** 关号 → 4 颗已验证有解的发牌种子 */');
    L.push('export const LEVEL_SEEDS: Readonly<Record<number, readonly number[]>> = {');
    for (const n of nums) {
        L.push('    ' + String(n).padStart(2) + ': [' + seeds[n].join(', ') + '],');
    }
    L.push('};');
    L.push('');
    L.push('/** 关号 → 上面每颗种子对应的盘面指纹（`Board.fingerprint()` 的 8 位十六进制） */');
    L.push('export const LEVEL_BOARD_FP: Readonly<Record<number, readonly string[]>> = {');
    for (const n of nums) {
        L.push('    ' + String(n).padStart(2) + ": ['" + fps[n].join("', '") + "'],");
    }
    L.push('};');
    L.push('');
    L.push('/**');
    L.push(' * 取一关的候选种子。调用方（ui/GamePage）负责从里面随机挑一颗。');
    L.push(' * 返回空数组 = 这一关没登记种子 —— 那是**数据脱节**，不是正常状态：');
    L.push(' * core-selftest 有断言会当场报出来，调用方只需要在日志里留个痕。');
    L.push(' */');
    L.push('export function seedsOf(n: number): readonly number[] {');
    L.push('    return LEVEL_SEEDS[n] || [];');
    L.push('}');
    L.push('');
    fs.writeFileSync(OUT_TS, L.join('\n'), 'utf8');
}

/**
 * 把已经写在磁盘上的 LevelSeeds.ts 读出来（只给 --verify 用）。
 *
 * 【为什么不直接 require 那个 .ts】
 * node 读不了 .ts（本项目统一用 Cocos 自带的 tsc 编到临时目录再 require）。
 * 这里图省事，用正则把两个字面量剥出来 —— 只解析**生成器自己写的、格式固定**的
 * 那两行，不试图做一个通用 TS 解析器。一旦格式变了，下面的 assert 会当场炸，
 * 而不是悄悄解析出半个表。
 */
function requireCompiled() {
    const src = fs.readFileSync(OUT_TS, 'utf8');
    const grab = (name) => {
        const m = new RegExp('export const ' + name + ':[^=]*=\\s*\\{([\\s\\S]*?)\\n\\};').exec(src);
        if (!m) throw new Error(`LevelSeeds.ts 里找不到 ${name} —— 文件被手改过？`);
        const out = {};
        for (const line of m[1].split('\n')) {
            const mm = /^\s*(\d+):\s*\[(.*)\],?\s*$/.exec(line);
            if (!mm) continue;
            const items = mm[2].split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter(Boolean);
            out[+mm[1]] = items;
        }
        return out;
    };
    return { LEVEL_SEEDS: grab('LEVEL_SEEDS'), LEVEL_BOARD_FP: grab('LEVEL_BOARD_FP') };
}

function finish(report, opt, t0) {
    report.elapsedMs = Date.now() - t0;
    fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
    fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));
    console.log('');
    console.log(`结果已写入 ${path.relative(ROOT, OUT_JSON)}`);
    console.log(report.ok ? '\n✓ 全部通过' : '\n✖ 存在未通过项（见上）');
    process.exit(report.ok ? 0 : 1);
}

main();
