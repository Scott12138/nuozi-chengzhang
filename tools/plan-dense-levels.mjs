/**
 * plan-dense-levels.mjs · 计算「铺满」方案的逐关数据（一次性分析工具）
 *
 * 背景（用户 2026-10-03 第 2 条）：
 *   「字数没有铺满所有格子，对于所有关卡，重新设置字数，要铺满所有格子，
 *     而且要满足我们之前的约束条件」
 *
 * 硬事实：
 *   · 牌数恒为偶数（偏旁+部件成对 push、宝牌 2 张一对）
 *   · ⇒ **棋盘格数必须是偶数**，否则永远差一格
 *
 * 规则：
 *   ① cols 保持关卡表原值；
 *   ② rows 取「使 cols*rows 为偶数、≥ 牌数、且最小」；若 rows0=ceil(牌数/cols) 给的是
 *      奇数格，可退一行（最多少 1 对）时就退，否则进一行；
 *   ③ pairs = cols*rows/2 - tr；
 *   ④ words 补到 ⌈pairs/2⌉ 个（不足时从该章 CH_POOL 里枚举补，**一次补到位**再验字频）。
 *
 * 字频三条（用户 2026-10-03 拍板）：
 *   ① 一种组合最多 2 组（`words[i % words.length]` 轮转 ⇒ pairs ≤ 2×words）
 *   ② 相同偏旁 ≤ 4 张
 *   ③ words ≥ ⌈pairs/2⌉（①的推论）
 *
 * 用法：node tools/plan-dense-levels.mjs [--json | --ts]
 *
 * ★★ 本脚本是「**读原型 → 改原型**」的单向工具，天然不幂等 ★★
 *   它把 prototype/index.html 的 LEVELS 当作**原始数据**消费。
 *   跑过一次并把结果写回原型之后，再跑一次就会把"已经改好的数据"当成原始数据，
 *   表现是 Δ对 全是 0、补字全是「—」，看起来"一切正常" —— **这是假绿**。
 *   所以：每次要重算，先 `git checkout prototype/index.html` 回到干净状态。
 *   下面运行时也会打印一行提醒。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(ROOT, 'prototype/index.html'), 'utf8');

function grabLiteral(name) {
    const at = SRC.indexOf(`const ${name} = `);
    if (at < 0) throw new Error(`找不到 const ${name}`);
    let i = SRC.indexOf('=', at) + 1;
    while (SRC[i] === ' ' || SRC[i] === '\n') i++;
    const open = SRC[i];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    for (let j = i; j < SRC.length; j++) {
        if (SRC[j] === open) depth++;
        else if (SRC[j] === close) {
            depth--;
            if (depth === 0) return SRC.slice(i, j + 1);
        }
    }
    throw new Error(`${name} 字面量没闭合`);
}
const evalLit = (name) => (0, eval)(`(${grabLiteral(name)})`);
const WORDS = evalLit('WORDS');
const CH_POOL = evalLit('CH_POOL');
const LEVELS = evalLit('LEVELS');

function dealStats(pairs, words) {
    const byWord = {};
    const byRad = {};
    for (let i = 0; i < pairs; i++) {
        const w = words[i % words.length];
        byWord[w] = (byWord[w] || 0) + 1;
        const a = WORDS[w] ? WORDS[w].a : '?';
        byRad[a] = (byRad[a] || 0) + 1;
    }
    return { byWord, byRad };
}
const legal = (st) => Object.values(st.byWord).every((n) => n <= 2)
    && Object.values(st.byRad).every((n) => n <= 4);

/**
 * 补字黑名单。
 *
 * ⚠️ 为什么不能随手补「弦」：
 *   部件「弓」的"靠哪半边"是由**关卡出现次数**投票算出来的（tools/gen-tile-roles.py），
 *   而它在两个角色之间**只差 2 票**：
 *       b（字底，来自「弩」）  8 关
 *       l（左偏旁，来自「弦」「弧」）6 关
 *   给 L1、L2 各补一个「弦」→ l 票也变成 8 → 打平 → 自动判定翻成 **c（居中）**，
 *   而生成器的硬断言里写着「用户点名要求 弓 = b」。真机上表现为：
 *   「弩」的部件牌不再靠下画，看不出"这是弩字的下半块"。
 *   （这不是猜测 —— 本轮第一次跑 gen-tile-roles.py 就是被这条断言拦下的。）
 *
 * 加黑名单的原则：**该字的偏旁或部件，其角色投票处于边界**（打平/仅差一两票）。
 * 木/钅/革/竹/父/奴/佥/虫/艹/氵/犭/鱼/禾/土/户/宀 这些都是压倒性多数派，随便加。
 */
const BANNED_PICK = new Set(['弦', '弧', '弩', '房', '坊']);

function targetRows(cols, need) {
    const rows0 = Math.ceil(need / cols);
    if ((cols * rows0) % 2 === 0) return { rows: rows0, note: '整行' };
    const back = rows0 - 1;
    if (back >= 1 && cols * back >= need - 2) return { rows: back, note: '退一行（少 1 对）' };
    return { rows: rows0 + 1, note: '进一行' };
}

/** 补字：从池里枚举 add 个组合（add ≤ 3，直接递归），取第一个让最终态合法的 */
function fillWords(lv, pairsNew, wordsMin) {
    const words = lv.words.slice();
    const add = wordsMin - words.length;
    if (add <= 0) {
        return { words, picks: [], ok: legal(dealStats(pairsNew, words)) };
    }
    const pool = CH_POOL[lv.ch]
        .filter((w) => !words.includes(w) && WORDS[w] && !BANNED_PICK.has(w));
    // 偏好：**先引入本关还没出现过的偏旁**（目标字条更多样、玩家更好分辨），
    // 同档内保持字池原顺序（字池已按主题排过）。
    const haveRad = new Set(lv.words.map((w) => WORDS[w].a));
    const ranked = pool
        .map((w, i) => ({ w, i, fresh: haveRad.has(WORDS[w].a) ? 1 : 0 }))
        .sort((a, b) => a.fresh - b.fresh || a.i - b.i)
        .map((x) => x.w);
    let best = null;
    const rec = (start, picked) => {
        if (best) return;
        if (picked.length === add) {
            const tryWords = [...words, ...picked];
            if (legal(dealStats(pairsNew, tryWords))) best = picked.slice();
            return;
        }
        for (let i = start; i < ranked.length; i++) {
            picked.push(ranked[i]);
            rec(i + 1, picked);
            picked.pop();
            if (best) return;
        }
    };
    rec(0, []);
    if (!best) return { words, picks: [], ok: false, failed: true };
    const out = [...words, ...best];
    return { words: out, picks: best, ok: legal(dealStats(pairsNew, out)) };
}

const report = [];
const nextLevels = [];
for (const lv of LEVELS) {
    const tr = lv.tr || 0;
    const junk = lv.junk || 0;
    const need = lv.pairs * 2 + tr * 2 + junk;
    const { rows, note } = targetRows(lv.cols, need);
    const cells = lv.cols * rows;
    const pairsNew = cells / 2 - tr;
    const wordsMin = Math.ceil(pairsNew / 2);
    const { words, picks, ok, failed } = fillWords(lv, pairsNew, wordsMin);
    const st = dealStats(pairsNew, words);

    report.push({
        n: lv.n, ch: lv.ch, cols: lv.cols, rowsTable: lv.rows, rows, note,
        need, cells, delta: pairsNew - lv.pairs, pairsOld: lv.pairs, pairs: pairsNew,
        tr, wordsOld: lv.words.length, wordsMin, wordsNew: words.length, picks,
        failed: !!failed, ok,
        wordsList: words,
        rad: st.byRad, wordCnt: st.byWord,
    });
    nextLevels.push({ ...lv, rows, pairs: pairsNew, words });
}

const mode = process.argv.includes('--json') ? 'json' : process.argv.includes('--ts') ? 'ts' : 'table';
if (mode !== 'json') {
    const noop = report.every((r) => r.delta === 0 && !r.picks.length);
    console.error(noop
        ? '⚠️  所有关的 Δ对 都是 0、也没有补字 —— 原型的 LEVELS 看起来**已经是铺满过的**。\n'
          + '    如果你要重算，先 `git checkout prototype/index.html` 回到干净状态，否则这是假绿。'
        : 'ℹ  输入是原型的当前 LEVELS；改完后请用 tools/_apply-dense-levels.py 写回。');
}

if (mode === 'json') {
    console.log(JSON.stringify(nextLevels));
} else if (mode === 'ts') {
    for (const r of report) {
        const lv = nextLevels.find((x) => x.n === r.n);
        const noteTxt = `${lv.cols}×${r.rows} · 目标 ${lv.words.length} 字`
            + (lv.tr ? ` · ${lv.tr} 对宝牌` : '');
        const tip = lv.tip ? `\n        tip: '${lv.tip}',` : '';
        console.log(`    { n: ${lv.n}, ch: ${lv.ch}, cols: ${lv.cols}, rows: ${r.rows}, time: ${lv.time},`
            + `\n        words: ${JSON.stringify(lv.words).replace(/","/g, "', '").replace(/^\["/, "['").replace(/"\]$/, "']")},`
            + `\n        pairs: ${r.pairs}, tr: ${lv.tr || 0}, junk: 0,${tip}`
            + `\n        note: '${noteTxt}' },`);
    }
} else {
    console.log('关 | 章 | 表尺寸 | 新尺寸 | 牌数 | 新格数 | Δ对 | pairs | 字(旧→新/需) | 补字 | 字频 | 备注');
    for (const r of report) {
        const radStr = Object.entries(r.rad).map(([a, n]) => `${a}${n}`).join(' ');
        console.log(`L${r.n} | ch${r.ch} | ${r.cols}×${r.rowsTable} | ${r.cols}×${r.rows} | ${r.need} | ${r.cells} `
            + `| ${r.delta >= 0 ? '+' : ''}${r.delta} | ${r.pairsOld}→${r.pairs} `
            + `| ${r.wordsOld}→${r.wordsNew}/${r.wordsMin} | ${r.picks.join(',') || '—'} `
            + `| ${r.ok ? '✅' : '❌' + (r.failed ? '补不齐' : '')} | ${r.note}`);
    }
    const bad = report.filter((r) => !r.ok);
    const radAll = report.flatMap((r) => Object.entries(r.rad).filter(([, n]) => n > 4).map(([a, n]) => `L${r.n}:${a}${n}`));
    console.log(`\n合计对数变化 ${report.reduce((s, r) => s + r.delta, 0) >= 0 ? '+' : ''}${report.reduce((s, r) => s + r.delta, 0)}`);
    console.log(`字频不合法的关：${bad.length ? bad.map((b) => 'L' + b.n).join(',') : '无'}`);
    console.log(`偏旁超 4 的：${radAll.length ? radAll.join(',') : '无'}`);
    console.log(`每关格数 == 牌数（铺满）：${report.every((r) => r.cells === r.pairs * 2 + r.tr * 2) ? '✅ 全部满足' : '❌'}`);
}
