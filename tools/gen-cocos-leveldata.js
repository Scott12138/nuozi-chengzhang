/* ============================================================
 *  gen-cocos-leveldata.js · 从原型抽取关卡字表，生成 Cocos 侧的 LevelData.ts
 * ============================================================
 *  【为什么要有这个生成器，而不是手抄一遍】
 *  WORDS（拆字表）103 条、LEVELS 38 关，手抄一遍必然出错，
 *  而且**出错的方式是静默的** —— 抄错一个字，生成器照样跑，
 *  只是那一关永远合不出那个字，玩家卡死。所以：
 *  字表的唯一真源是 prototype/index.html，Cocos 侧由它生成。
 *
 *  【为什么用 vm 求值而不是正则抠字段】
 *  这些数据是纯对象/数组字面量（无函数、无引用），用 vm 求值得到的是
 *  真正的 JS 结构，不存在"正则少匹配一层括号"这类翻车。
 *  WORDS 用 `const WORDS = {...}` 到下一个顶层 `const` 之间切片；
 *  CHAPTERS / LEVELS / JUNK_CHARS 同理。
 *
 *  用法： node tools/gen-cocos-leveldata.js
 *  产物： ① game-5-chaizi/assets/scripts/core/LevelData.ts
 *        ② /private/tmp/chaizi-tile-chars.json  ← 给 tools/make-tile-atlas.py 用
 *  退出码：0 = 生成成功且自检通过
 *
 *  【为什么还要吐一份 JSON 给贴图脚本】
 *  贴图清单必须和关卡字单**严格一致**：少烘一张 → 棋盘上一个洞（不报错）；
 *  多烘一张 → 白占主包体积。而字单的唯一真源是原型，读它最稳的办法是走本生成器
 *  （它已经用 vm 求值把 WORDS/LEVELS 解出来了）。Python 自己正则抠 JS 字面量
 *  属于重复造轮子，且"少匹配一层括号"的翻车方式完全静默。
 *  → 于是：本生成器顺手把「每章要烘哪些字」一起写出来，贴图脚本只消费结果。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.dirname(__dirname);
const SRC = path.join(ROOT, 'prototype', 'index.html');
const OUT = path.join(ROOT, 'game-5-chaizi', 'assets', 'scripts', 'core', 'LevelData.ts');

const html = fs.readFileSync(SRC, 'utf8');

/** 从 `const NAME = ` 起，按括号配平切出那段字面量 */
function sliceLiteral(name) {
    const head = 'const ' + name + ' = ';
    const i = html.indexOf(head);
    if (i < 0) throw new Error('原型里找不到 ' + name);
    const start = i + head.length;
    const open = html[start];
    const close = { '{': '}', '[': ']' }[open];
    if (!close) throw new Error(name + ' 不是对象/数组字面量（首字符 ' + open + '）');
    let depth = 0;
    let instr = null;
    for (let k = start; k < html.length; k++) {
        const ch = html[k];
        if (instr) {
            if (ch === '\\') { k++; continue; }
            if (ch === instr) instr = null;
            continue;
        }
        if (ch === "'" || ch === '"' || ch === '`') { instr = ch; continue; }
        if (ch === open) depth++;
        else if (ch === close) {
            depth--;
            if (depth === 0) return html.slice(start, k + 1);
        }
    }
    throw new Error(name + ' 括号不配平');
}

/** 字面量 → JS 值（用 vm 而不是 eval：不污染本进程的作用域） */
function evalLiteral(name) {
    const src = sliceLiteral(name);
    const ctx = vm.createContext({});
    return vm.runInContext('(' + src + ')', ctx);
}

const WORDS = evalLiteral('WORDS');
const JUNK_CHARS = evalLiteral('JUNK_CHARS');
const CHAPTERS = evalLiteral('CHAPTERS');
const LEVELS = evalLiteral('LEVELS');

// ------------------------------------------------------------
//  自检（★ 这里每一条都是"破了不报错、只让玩家卡死"的坑，必须在生成期拦住）
//
//  自检 1：每关 words 必须在 WORDS 里；牌数不能超过棋盘格数
//          （漏一条 → 生成器会把牌堆挤在随机格点上，甚至死循环重试）
//  自检 2：★★ 字频三条硬约束（2026-10-03 用户拍板，见 docs/关卡设计_S11）★★
//          ① 一种组合在盘面上最多 2 组（4 张牌）
//          ② 相同偏旁不超过 4 张（= 4 组）
//          ③ 由此推出 words 至少要有 ⌈pairs/2⌉ 个不同的字
//          ⚠️ 为什么必须断言而不是"设计时注意一下"：
//             `Board.buildDeck()` 是按 `lv.words[i % words.length]` **轮转**取字的，
//             所以"某字出现了几次"完全由 `pairs` 与 `words.length` 决定。
//             以后任何人手改一关的 words 或 pairs，破了约束都不会报错 ——
//             只会在手机上一眼看出来"枪字怎么出现了 5 次"。必须在这里拦住。
// ------------------------------------------------------------
const problems = [];
for (const lv of LEVELS) {
    const ch = CHAPTERS.find((c) => c.id === lv.ch);
    if (!ch) { problems.push(`L${lv.n} 的章号 ${lv.ch} 不存在`); continue; }

    // 棋盘格数取**关卡自己的** cols/rows（各关尺寸不同，章级尺寸只是该章最大值）
    const cells = lv.cols * lv.rows;
    const need = lv.pairs * 2 + (lv.tr || 0) * 2 + (lv.junk || 0);
    if (need > cells) problems.push(`L${lv.n} 需要 ${need} 张牌 > 棋盘 ${cells} 格`);
    if (!lv.words || !lv.words.length) { problems.push(`L${lv.n} 没有 words`); continue; }
    for (const w of lv.words) {
        if (!WORDS[w]) problems.push(`L${lv.n} 的字「${w}」不在 WORDS 里`);
    }

    // ---- 字频三条 ----
    const want = Math.ceil(lv.pairs / 2);
    if (lv.words.length < want) {
        problems.push(`L${lv.n} 只给了 ${lv.words.length} 个字，少于 ⌈pairs/2⌉=${want}（会有一个字出现 >2 组）`);
    }
    const byWord = {};
    const byRadical = {};
    for (let i = 0; i < lv.pairs; i++) {
        const w = lv.words[i % lv.words.length];
        byWord[w] = (byWord[w] || 0) + 1;
        const a = WORDS[w] && WORDS[w].a;
        byRadical[a] = (byRadical[a] || 0) + 1;
    }
    for (const w in byWord) {
        if (byWord[w] > 2) problems.push(`L${lv.n} 的「${w}」出现了 ${byWord[w]} 组（上限 2）`);
    }
    for (const a in byRadical) {
        if (byRadical[a] > 4) problems.push(`L${lv.n} 的偏旁「${a}」有 ${byRadical[a]} 张（上限 4）`);
    }
}
if (problems.length) {
    console.error('✗ 关卡数据自检失败：\n  ' + problems.join('\n  '));
    process.exit(1);
}

// ------------------------------------------------------------
//  生成 TS
// ------------------------------------------------------------
const L = [];
L.push('/**');
L.push(' * LevelData.ts · **由 tools/gen-cocos-leveldata.js 生成，不要手改**');
L.push(' *');
L.push(' * 唯一真源是 prototype/index.html 里的 WORDS / JUNK_CHARS / CHAPTERS / LEVELS。');
L.push(` * 手抄 ${Object.keys(WORDS).length} 条拆字表 + ${LEVELS.length} 关字单必然出错，而且出错是**静默**的：`);
L.push(' * 抄错一个字生成器照样跑，只是那一关永远合不出那个字、玩家卡死。');
L.push(' * 所以字表由生成器抽取，改字表请改原型再重跑生成器。');
L.push(' */');
L.push('');
L.push('import { LevelDef, WordSplit } from \'./Types\';');
L.push('');
L.push('/** 一个合成字的拆法：a 是偏旁、b 是部件（顺序由 a 的音序无关，仅表示"一个是偏旁"） */');
L.push('export const WORDS: Record<string, WordSplit> = {');

// 每行 3 条，凑成可读的行宽
const wordKeys = Object.keys(WORDS);
for (let i = 0; i < wordKeys.length; i += 3) {
    const row = wordKeys.slice(i, i + 3)
        .map((k) => `'${k}': { a: '${WORDS[k].a}', b: '${WORDS[k].b}' }`)
        .join(', ');
    L.push('    ' + row + ',');
}
L.push('};');
L.push('');
L.push('/** 干扰牌字池：这些字拼不成任何目标字，只用来占格、挡路 */');
L.push(`export const JUNK_CHARS: string[] = ${JSON.stringify(JUNK_CHARS)};`);
L.push('');
L.push('/** 章节的棋盘尺寸（各章不同：6×5 → 7×7） */');
L.push('export const CHAPTERS = [');
for (const c of CHAPTERS) {
    L.push(`    { id: ${c.id}, name: '${c.name}', sub: '${c.sub}', cols: ${c.cols}, rows: ${c.rows} },`);
}
L.push('] as const;');
L.push('');
L.push('/**');
L.push(' * 全部 38 关。');
L.push(' *');
L.push(' * ★ `isPlayable` 已**于 2026-10-03 全量解封**（原为 3）—— 现在 = 关卡表的总数。');
L.push(' *   解封的三个前置条件当天都已补齐，写在这里免得后来人以为还能往前推：');
L.push(' *     ① 第 2~4 章的贴图早已烘好、按章躺在分包里（assets/ch02|ch03|ch04/tiles/）；');
L.push(' *     ② `ui/TileAtlas.ts` 实现了按章 Bundle 加载（**不做这步第 9 关起棋盘会全空白**，');
L.push(' *        而且只是 warn，不报错）；');
L.push(' *     ③ 38 关逐关跑过「开局有解」（tools/solve-exact.js）。');
L.push(' *   保留 `isPlayable` 这个函数是因为它仍是一个**结构性兜底**：');
L.push(' *   以后往 LEVELS 里加关、而贴图还没来得及烘时，把关号上限调回来即可，');
L.push(' *   选关页会自动把后面几关显示成「待开发」，而不是让玩家点进一张空盘面。');
L.push(' */');
/** ★ 可玩的最大关号。改这里 = 改选关页的「待开发」分界。
 *  ★ 取 `LEVELS.length` 而不是硬编码一个数：以后加关不用再记得改这里
 *    （忘改的表现是最后几关永远显示「待开发」，很难联想到是这个常量）。 */
const PLAYABLE_MAX_N = LEVELS.length;
L.push(`const PLAYABLE_MAX = ${PLAYABLE_MAX_N};`);
L.push('');
L.push('export const LEVELS: LevelDef[] = [');
for (const lv of LEVELS) {
    const w = lv.words.map((x) => `'${x}'`).join(', ');
    const parts = [
        `n: ${lv.n}`,
        `ch: ${lv.ch}`,
        `cols: ${lv.cols}`,
        `rows: ${lv.rows}`,
        `time: ${lv.time}`,
        `words: [${w}]`,
        `pairs: ${lv.pairs}`,
        `tr: ${lv.tr || 0}`,
        `junk: ${lv.junk || 0}`,
    ];
    if (lv.tip) parts.push(`tip: '${lv.tip}'`);
    parts.push(`note: '${String(lv.note).replace(/'/g, "\\'")}'`);
    L.push('    { ' + parts.join(', ') + ' },');
}
L.push('];');
L.push('');
L.push('/** 关号 → 关卡定义（越界返回 undefined，调用方自己兜） */');
L.push('export function levelByN(n: number): LevelDef | undefined {');
L.push('    return LEVELS.find((l) => l.n === n);');
L.push('}');
L.push('');
L.push('/** 章节 → 该章的关卡数组 */');
L.push('export function levelsOfChapter(ch: number): LevelDef[] {');
L.push('    return LEVELS.filter((l) => l.ch === ch);');
L.push('}');
L.push('');
L.push('/** 该关当前是否可玩（贴图/机制是否已备齐）。2026-10-03 起恒为 true。 */');
L.push('export function isPlayable(lv: LevelDef): boolean {');
L.push('    return lv.n <= PLAYABLE_MAX;');
L.push('}');
L.push('');
L.push('/**');
L.push(' * 「待开发」的第一关（选关页用它画分界）。');
L.push(' * ★ 全量解封后它 = 关卡总数 + 1，也就是**没有待开发的关卡了**；');
L.push(' *   保留它是因为以后加关、贴图没跟上时还要用它画那道分界线。');
L.push(' */');
L.push('export const FIRST_UNPLAYABLE = PLAYABLE_MAX + 1;');
L.push('');

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, L.join('\n'), 'utf8');

const bytes = fs.statSync(OUT).size;
console.log(`✓ ${Object.keys(WORDS).length} 条拆字表 · ${LEVELS.length} 关 · ${CHAPTERS.length} 章`);
console.log('✓ 关卡数据自检通过（牌数 ≤ 棋盘格数、目标字都在拆字表里、'
    + '★字频三条：每字 ≤2 组 / 每偏旁 ≤4 张 / 每关字数 ≥ ⌈pairs/2⌉）');
console.log(`✓ 已写 ${OUT}（${(bytes / 1024).toFixed(1)} KB）`);
// ★ 干扰字数**从数据算**，不要写死 —— 2026-10-02 删掉「罒」时这句写死的
//   "10 干扰" 就成了假话（它比代码更晚被发现，正是写死字符串的通病）。
// ★ 贴图数量**从数据算**，不要写死 —— 关卡字单或分辨率一变，写死的数字当场变假话。
const P = LEVELS.slice(0, PLAYABLE_MAX_N);
const gset = new Set();
for (const lv of P) for (const w of lv.words) { gset.add(w); gset.add(WORDS[w].a); gset.add(WORDS[w].b); }
// 全库（38 关）需要的字形总数 —— 决定贴图要烘多少张、包体预算怎么分
const all = new Set();
for (const lv of LEVELS) for (const w of lv.words) { all.add(w); all.add(WORDS[w].a); all.add(WORDS[w].b); }
console.log(`  首版可玩：第 1~${PLAYABLE_MAX_N} 关 → 需烘 ${gset.size} 张字形贴图`);
console.log(`  全库 38 关 → 需烘 ${all.size} 张字形贴图（干扰牌已下线）`);

// ------------------------------------------------------------
//  ★ 贴图字单（按章拆分）—— 给 tools/make-tile-atlas.py 消费
//
//  【为什么要"按章"而不是一张大清单】
//  主包 ≤ 4MB，全库 248 张 128px 贴图 ≈ 4.7MB，塞不进主包。
//  所以：第 1 章留主包（resources bundle），第 2~4 章各做一个小游戏分包。
//  见 docs/关卡设计_S11-10x12定稿与贴图体积复核.md §四。
//
//  【跨章出现的字归谁】
//  一个偏旁（如「木」）会在多章出现。若每章各烘一份，同一个字会占多份体积。
//  所以按"**最早使用它的那一章**"归属，后面的章复用前面 bundle 里的那张 ——
//  代价是跨 bundle 引用（运行时必须先加载前面的 bundle），但省体积更划算。
//  归属规则写死在下面 `owner` 里，任何人改字单都不会悄悄改变它。
// ------------------------------------------------------------
const CHAPTER_BUNDLE = (ch) => (ch === 1
    ? { bundle: 'resources', prefix: 'tiles' }        // 内置 resources bundle = 主包
    : { bundle: 'ch0' + ch, prefix: 'tiles' });       // 自定义 bundle = 微信小游戏分包

const owner = new Map();                              // 字 → 归属章
for (const lv of LEVELS) {
    for (const w of lv.words) {
        for (const c of [w, WORDS[w].a, WORDS[w].b]) if (!owner.has(c)) owner.set(c, lv.ch);
    }
}
const charsOfChapter = new Map();                     // 章 → 该章归属的字（顺序稳定）
for (const lv of LEVELS) {
    let arr = charsOfChapter.get(lv.ch);
    if (!arr) charsOfChapter.set(lv.ch, (arr = []));
    for (const w of lv.words) {
        for (const c of [w, WORDS[w].a, WORDS[w].b]) {
            if (owner.get(c) === lv.ch && arr.indexOf(c) < 0) arr.push(c);
        }
    }
}

const chaptersOut = CHAPTERS.map((c) => {
    const chars = charsOfChapter.get(c.id) || [];
    const b = CHAPTER_BUNDLE(c.id);
    return { id: c.id, name: c.name, bundle: b.bundle, prefix: b.prefix, chars };
});

const TILE_CHARS_JSON = '/private/tmp/chaizi-tile-chars.json';
// 全库偏旁（含未归属到任何关卡的也算：只要 WORDS 里出现过）—— 贴图脚本用它生成
// `RADICALS` 常量，游戏侧据此判断"一张牌是不是偏旁"。写成 JSON 而不是让 Python 猜。
const radicalSet = [];
for (const w of Object.keys(WORDS)) {
    const a = WORDS[w].a;
    if (radicalSet.indexOf(a) < 0) radicalSet.push(a);
}
// ★ 2026-10-03：再吐一份「关卡真会用到的**全部部件**」（偏旁 a ∪ 部件 b）。
//   为什么不是只有 a：牌面上要靠边的不止偏旁，字底/字头/右部件一样要靠边，
//   角色表（design/tile-roles.js）必须覆盖它们全部。
//   为什么只算"关卡用到的"：没上过棋盘的字投票会污染角色表（实测「连」就因此从
//   'b' 被投成居中）。口径必须与 tools/gen-tile-roles.py 完全一致，否则两边会漂。
const partSet = [];
for (const lv of LEVELS) {
    for (const w of lv.words) {
        for (const c of [WORDS[w].a, WORDS[w].b]) if (partSet.indexOf(c) < 0) partSet.push(c);
    }
}
fs.writeFileSync(TILE_CHARS_JSON, JSON.stringify({
    note: '由 tools/gen-cocos-leveldata.js 生成，给 tools/make-tile-atlas.py 用。改字单请改原型再重跑本脚本。',
    cell: 64, dsf: 2,                       // → 128×128 贴图（2026-10-03 拍板）
    radicals: radicalSet,
    parts: partSet,                         // ← 角色表要覆盖的集合（make-tile-atlas.py 会断言）
    chapters: chaptersOut,
}, null, 2) + '\n', 'utf8');

console.log('');
console.log('  贴图字单（按章归属，跨章的字只烘一次）：');
let sum = 0;
for (const c of chaptersOut) {
    sum += c.chars.length;
    console.log(`    第 ${c.id} 章 ${c.name}  → ${c.bundle}/  ${String(c.chars.length).padStart(3)} 张`);
}
console.log(`    合计 ${sum} 张（全库去重后应为 ${all.size} 张）`);
if (sum !== all.size) {
    console.error(`✗ 按章归属合计 ${sum} ≠ 全库去重 ${all.size} —— 归属逻辑有 bug`);
    process.exit(1);
}
console.log(`  ✓ 已写 ${TILE_CHARS_JSON}`);
