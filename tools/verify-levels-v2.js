#!/usr/bin/env node
/* ============================================================================
 * 关卡接入自检 —— 在「出真机码」之前把所有会静默失败的东西查一遍
 *
 * 为什么需要它：这个原型里最贵的两类 bug 都是**不出声**的 ——
 *   · 字库缺字 → 渲染成一张空白牌（不报错，只是难看）
 *   · 关卡牌数超过棋盘 → 多余的牌被挤到盘外，看得见但摸不着
 * 静态查一遍比在手机上盯着找快得多。
 *
 * 检查项：
 *   A 数据来源      原型里的 WORDS/LEVELS 是否就是新生成的那一份（防手工改歪）
 *   B 字表完整性    每关 words 都在 WORDS 里；103 字一个不缺
 *   C 字形覆盖      103 目标字 + 10 干扰字 在 InkGlyphs 里都有非空 path
 *   D 容量          每关 pairs*2 + junk ≤ cols*rows - 3（至少留 3 个空格）
 *   E R5            同一关里同一个字不能既当偏旁又当部件
 *   F 偏旁混排      每关偏旁种类 ≥2（专题关显式豁免除外）
 *   G 存档键        已升到 cz_nd_v3
 *
 * 用法：node tools/verify-levels-v2.js
 * ========================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, 'prototype', 'index.html');
const src = fs.readFileSync(HTML, 'utf8');

let fail = 0, warn = 0;
const ok   = m => console.log('  \x1b[32m✓\x1b[0m ' + m);
const bad  = m => { fail++; console.log('  \x1b[31m✗\x1b[0m ' + m); };
const soft = m => { warn++; console.log('  \x1b[33m!\x1b[0m ' + m); };
const head = m => console.log('\n\x1b[1m' + m + '\x1b[0m');

/* ── 抠数据（同 level-audit.js 的做法） ── */
function stmt(name) {
  const tag = 'const ' + name + ' =';
  const i = src.indexOf(tag);
  if (i < 0) throw new Error('找不到 ' + name);
  let d = 0, k = i + tag.length;
  for (; k < src.length; k++) {
    const c = src[k];
    if ('([{'.indexOf(c) >= 0) d++;
    else if (')]}'.indexOf(c) >= 0) d--;
    else if (c === ';' && d === 0) break;
  }
  return src.slice(i + tag.length, k);
}
const ev = n => (0, eval)('(' + stmt(n) + ')');

const WORDS = ev('WORDS');
const LEVELS = ev('LEVELS');
const CHAPTERS = ev('CHAPTERS');
const CH_POOL = ev('CH_POOL');
const JUNK = ev('JUNK_CHARS');

/* ── 字形库 ── */
const InkGlyphs = require(path.join(ROOT, 'design', 'glyphs-data.js')).InkGlyphs
              || require(path.join(ROOT, 'design', 'glyphs-data.js'));

/* ═══ A 数据来源 ═══ */
head('A 数据来源');
const gen = JSON.parse(fs.readFileSync('/tmp/cz-levels-v2.json', 'utf8'));
if (JSON.stringify(Object.keys(WORDS)) === JSON.stringify(Object.keys(gen.words))) ok('WORDS 与生成数据一致（103 字，顺序相同）');
else bad('WORDS 与 /tmp/cz-levels-v2.json 不一致 —— 原型被手工改过？重跑 apply-levels-v2.py');
if (LEVELS.length === gen.levels.length) ok('LEVELS 关数 = ' + LEVELS.length);
else bad('LEVELS 关数 ' + LEVELS.length + ' ≠ 生成数据 ' + gen.levels.length);
const lvDiff = LEVELS.findIndex((l, i) => l.n !== gen.levels[i].n || l.words.join('') !== gen.levels[i].words.join(''));
if (lvDiff < 0) ok('38 关逐关字单与设计稿一致');
else bad('第 ' + LEVELS[lvDiff].n + ' 关字单与设计稿不一致');
if (src.includes("'cz_nd_v3'")) ok('存档键已升至 cz_nd_v3');
else bad('存档键还是旧值 —— 旧 32 关进度会张冠李戴');
if (!src.includes('pool.slice(0')) ok('旧的程序化生成逻辑已移除');
else bad('原型里还残留 pool.slice(0, ...)');

/* ═══ B 字表完整性 ═══ */
head('B 字表完整性');
const usedAll = new Set();
LEVELS.forEach(l => l.words.forEach(w => usedAll.add(w)));
const notInWords = [...usedAll].filter(w => !WORDS[w]);
if (!notInWords.length) ok('每关目标字都在 WORDS 表里（' + usedAll.size + ' 字）');
else bad('WORDS 表缺 ' + notInWords.length + ' 字：' + notInWords.join(''));
const badAB = Object.entries(WORDS).filter(([, v]) => !v.a || !v.b);
if (!badAB.length) ok('每字都有 a/b 两个部件');
else bad('以下字缺 a 或 b：' + badAB.map(x => x[0]).join(''));

/* ═══ C 字形覆盖 ═══ */
head('C 字形覆盖（缺字 = 一张空白牌，不报错但很难看）');
const noGlyph = [...usedAll].filter(w => !InkGlyphs.has(w) || !(InkGlyphs.path(w) || '').trim());
if (!noGlyph.length) ok('103 个目标字全部有非空轮廓');
else bad('缺轮廓 ' + noGlyph.length + ' 字：' + noGlyph.join(''));
const noJunk = JUNK.filter(w => !InkGlyphs.has(w) || !(InkGlyphs.path(w) || '').trim());
if (!noJunk.length) ok('10 个干扰字全部有非空轮廓');
else bad('干扰字缺轮廓：' + noJunk.join(''));

/* ═══ D 容量 ═══ */
head('D 棋盘容量（每关至少留 3 个空格，否则牌会被挤到盘外）');
let dBad = 0;
LEVELS.forEach(l => {
  const cap = l.cols * l.rows, tiles = l.pairs * 2 + l.junk, free = cap - tiles;
  if (free < 3) { bad('第 ' + l.n + ' 关：牌 ' + tiles + ' / 容 ' + cap + '，只余 ' + free + ' 格'); dBad++; }
});
if (!dBad) ok('38 关全部满足「牌数 ≤ 容量 - 3」');
const pairsOver = LEVELS.filter(l => l.pairs > Math.floor((l.cols * l.rows - 3 - l.junk) / 2));
if (!pairsOver.length) ok('配对数也在容量上限内');

/* ═══ E R5 ═══ */
head('E R5：同一关里同一个字不能既当偏旁又当部件');
const r5 = [];
LEVELS.forEach(l => {
  const rad = new Set(), part = new Set();
  l.words.forEach(w => { const k = WORDS[w]; if (!k) return; rad.add(k.a); part.add(k.b); });
  const clash = [...rad].filter(x => part.has(x));
  if (clash.length) r5.push('第 ' + l.n + ' 关：' + clash.join(''));
});
if (!r5.length) ok('38 关无 R5 冲突');
else r5.forEach(x => bad('R5 冲突 ' + x));

/* ═══ F 偏旁混排 ═══ */
head('F 偏旁混排（每关至少两种偏旁）');
const single = [];
LEVELS.forEach(l => {
  const rad = new Set(l.words.map(w => WORDS[w] && WORDS[w].a));
  if (rad.size < 2) single.push(l);
});
const exemptOk = single.filter(l => l.exempt);
if (!single.length) ok('38 关每关至少两种偏旁');
else if (exemptOk.length === single.length) ok(single.length + ' 关单偏旁，但均已显式豁免');
else single.filter(l => !l.exempt).forEach(l => bad('第 ' + l.n + ' 关只有一种偏旁，且未豁免'));

/* ═══ G 排版与展示面 ═══ */
head('G 展示面');
const mapCnt = CHAPTERS.map(c => ({ id: c.id, n: LEVELS.filter(l => l.ch === c.id).length, pool: (CH_POOL[c.id] || []).length }));
mapCnt.forEach(c => {
  if (c.n > 0 && c.pool >= 6) ok('章' + c.id + '：' + c.n + ' 关，字池 ' + c.pool + ' 字（选关页预览够用）');
  else bad('章' + c.id + '：关数 ' + c.n + ' / 字池 ' + c.pool + ' 字');
});
const chSum = mapCnt.reduce((s, c) => s + c.n, 0);
if (chSum === LEVELS.length) ok('分章关数合计 ' + chSum + ' = 总关数');
else bad('分章关数合计 ' + chSum + ' ≠ ' + LEVELS.length);

/* ═══ 汇总 ═══ */
console.log('\n' + '─'.repeat(56));
if (fail) console.log('\x1b[31m失败 ' + fail + ' 项\x1b[0m' + (warn ? '，警告 ' + warn + ' 项' : ''));
else console.log('\x1b[32m全部通过\x1b[0m' + (warn ? '（警告 ' + warn + ' 项）' : ''));
process.exit(fail ? 1 : 0);
