#!/usr/bin/env node
/* ============================================================================
 * levels-v2 → 原型能直接吃的关卡 JSON
 *
 * 输入：design/levels-v2.js（38 关字单，只有「用哪些字」）
 *       assets/wordlib.json（103 字：radical 偏旁 / part 部件 / structure / tier）
 * 输出：/tmp/cz-levels-v2.json —— { words, chapters, chPool, levels, meta }
 *
 * 这里只做「补齐」，不发明：
 *   cols/rows  沿用原型 CHAPTERS 的棋盘尺寸（设计表不定义棋盘，规格书 §2.11 也是按章固定）
 *   time       沿用原型公式 150 - min(30, 章内序号*4)
 *   tip        前 3 关给拆法提示；内容取「本关新出现的第一个字」，避免连续两关提示同一个字
 *
 * 用法：node tools/build-levels-v2-json.js [--out 路径]
 * ========================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LV = require(path.join(ROOT, 'design', 'levels-v2.js'));
const LIB = require(path.join(ROOT, 'assets', 'wordlib.json'));

/* ── 1. 字表：字 → {a 偏旁, b 部件} ─────────────────────────────────────────
   wordlib 的 radical 就是本作里说的「偏旁」（左/上半边），part 是另一半。
   ★ 剑 的 radical='佥' part='刂' —— wordlib 站在「谁是形旁」的语义上（佥 表音但字形在左），
     原型站在「谁在左边」上并不重要：配对表是无序的（PAIR[a|b] 与 PAIR[b|a] 都建），
     所以两张牌谁先谁后都能拼。 */
const WORDS = {};
LIB.chapters.forEach(c => c.words.forEach(w => {
  WORDS[w.word] = { a: w.radical, b: w.part, structure: w.structure, tier: w.tier };
}));

/* ── 2. 章表 ───────────────────────────────────────────────────────────── */
const CH_BOARD = { 1: [6, 5], 2: [6, 6], 3: [7, 6], 4: [7, 7] };
const CHAPTERS = [
  { id: 1, name: '第一章 · 木字营', sub: '十八般兵器 · 木 / 钅 / 革 / 竹', cols: 6, rows: 5 },
  { id: 2, name: '第二章 · 花间集', sub: '花卉草木 · 木 / 艹',            cols: 6, rows: 6 },
  { id: 3, name: '第三章 · 逛三园', sub: '果园 / 动物园 / 植物园',         cols: 7, rows: 6 },
  { id: 4, name: '第四章 · 百工坊', sub: '民俗器物 · 火 / 竹 / 钅 / 纟',   cols: 7, rows: 7 },
];

/* ── 3. 每章字池（按首次出现顺序去重，供选关页预览前 6 个字） ─────────────── */
const seen = {};
const chPool = {};
LV.forEach(l => {
  chPool[l.ch] = chPool[l.ch] || [];
  l.words.forEach(w => { const k = l.ch + '|' + w; if (!seen[k]) { seen[k] = 1; chPool[l.ch].push(w); } });
});

/* ── 4. 关卡：补 cols/rows/time/tip ──────────────────────────────────────── */
const prevWords = {};                       // 章 → 上一关的字集
const idxInCh = {};
const levels = LV.map(l => {
  const [cols, rows] = CH_BOARD[l.ch];
  idxInCh[l.ch] = (idxInCh[l.ch] || 0) + 1;
  const i = idxInCh[l.ch] - 1;

  // 拆法提示：只在每章前 3 关出现；取本关第一个「上一关没见过」的字，避免重复同一个字
  let tip = '';
  if (i < 3) {
    const prev = prevWords[l.ch] || new Set();
    const fresh = l.words.find(w => !prev.has(w)) || l.words[0];
    const k = WORDS[fresh];
    if (k) tip = k.a + ' + ' + k.b + ' = ' + fresh;
  }
  prevWords[l.ch] = new Set(l.words);

  const tiles = l.pairs * 2 + l.junk;
  const cap = cols * rows;
  if (tiles > cap - 3) {
    throw new Error('第 ' + l.n + ' 关牌数 ' + tiles + ' 超出棋盘容量 ' + cap + ' - 3');
  }
  return {
    n: l.n, ch: l.ch, cols: cols, rows: rows,
    time: 150 - Math.min(30, i * 4),
    words: l.words.slice(), pairs: l.pairs, junk: l.junk, tip: tip,
    note: l.note || '', exempt: l.exempt || null,
    tiles: tiles, free: cap - tiles,
  };
});

/* ── 5. 汇总校验 ───────────────────────────────────────────────────────── */
const used = new Set();
levels.forEach(l => l.words.forEach(w => used.add(w)));
const missing = [...used].filter(w => !WORDS[w]);
if (missing.length) throw new Error('字表缺：' + missing.join(''));

const meta = {
  levelCount: levels.length,
  wordCount: used.size,
  byChapter: CHAPTERS.map(c => {
    const rs = levels.filter(l => l.ch === c.id);
    return { ch: c.id, levels: rs.length, pool: chPool[c.id].length,
             avgKinds: +(rs.reduce((s, r) => s + r.words.length, 0) / rs.length).toFixed(2) };
  }),
};

const out = { words: WORDS, chapters: CHAPTERS, chPool: chPool, levels: levels, meta: meta };
const outPath = (() => { const i = process.argv.indexOf('--out'); return i >= 0 ? process.argv[i + 1] : '/tmp/cz-levels-v2.json'; })();
fs.writeFileSync(outPath, JSON.stringify(out, null, 1));

/* ── 打印 ─────────────────────────────────────────────────────────────── */
console.log('字表 ' + Object.keys(WORDS).length + ' 字 → 关卡用到 ' + used.size + ' 字，缺 ' + missing.length);
console.log('关卡 ' + levels.length + ' 关\n');
levels.forEach(l => {
  console.log(
    String(l.n).padStart(2) + '  章' + l.ch + '  ' + l.cols + 'x' + l.rows +
    '  牌' + String(l.tiles).padStart(2) + '(空' + l.free + ')' +
    '  字种' + String(l.words.length).padStart(2) +
    '  ' + l.time + 's  ' + l.words.join('') +
    (l.tip ? '   [tip: ' + l.tip + ']' : '') +
    (l.exempt ? '   [豁免 ' + Object.keys(l.exempt).join(',') + ']' : '')
  );
});
console.log('\n分章：' + meta.byChapter.map(c => '章' + c.ch + ' ' + c.levels + '关/' + c.pool + '字/均' + c.avgKinds + '字种').join('   '));
console.log('写出 → ' + outPath);
