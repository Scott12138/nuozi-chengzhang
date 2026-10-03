#!/usr/bin/env node
/* ============================================================================
 * 关卡体检器 —— 把「这一关好不好玩」量成数字
 *
 * 为什么要它：用户反馈「每关字种类太少、全是同一个偏旁，玩得疲劳」。
 * 感觉是主观的，但疲劳有客观来源：**牌面上到底有多少种不同的图案**。
 * 一关 21 张牌，如果其中 9 张是一模一样的「木」，那这一关的信息量就只有 4 种图案
 * —— 这不是"难"，是"单调"。本脚本把这个数字算出来。
 *
 * 用法：
 *   node tools/level-audit.js             # 审计 prototype 里当前的 32 关
 *   node tools/level-audit.js --json      # 输出 JSON（供别的脚本消费）
 *
 * 数据来源（不复制、不复刻，直接读真源）：
 *   - prototype/index.html  → CHAPTERS / CH_POOL / LEVELS / WORDS / JUNK_CHARS
 *   - assets/wordlib.json   → 每字的 radical（左/上半边）+ tier + structure
 * ========================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, 'prototype', 'index.html');

/* ── 从原型 HTML 里把 `const X = ...;` 整条语句抠出来（括号配对到深度 0 的分号） ── */
const src = fs.readFileSync(HTML, 'utf8');
function stmt(name) {
  const tag = 'const ' + name + ' =';
  const i = src.indexOf(tag);
  if (i < 0) throw new Error('在 prototype/index.html 里找不到 ' + name);
  let d = 0, k = i + tag.length;
  for (; k < src.length; k++) {
    const c = src[k];
    if ('([{'.indexOf(c) >= 0) d++;
    else if (')]}'.indexOf(c) >= 0) d--;
    else if (c === ';' && d === 0) break;
  }
  return src.slice(i + tag.length, k);
}
function ev(name) { return (0, eval)('(' + stmt(name) + ')'); }
/* LEVELS 是 IIFE，里面引用了 CHAPTERS / CH_POOL / WORDS —— 必须显式把依赖喂进去，
   否则它在全局作用域里找不到这三个名字（本地 const 不在 eval 的作用域链上）。 */
function evWith(name, deps) {
  const keys = Object.keys(deps);
  return new Function(keys.join(','), 'return (' + stmt(name) + ');')(...keys.map(k => deps[k]));
}

const WORDS = ev('WORDS');
const CHAPTERS = ev('CHAPTERS');
const CH_POOL = ev('CH_POOL');
const JUNK = ev('JUNK_CHARS');
const LEVELS = evWith('LEVELS', { CHAPTERS, CH_POOL, WORDS, JUNK_CHARS: JUNK });

/* ── 字库：字 → 左/上半边（本作里这才叫「偏旁」） ── */
const lib = require(path.join(ROOT, 'assets', 'wordlib.json'));
const RAD = {};                       // 字 → {radical, part, tier, structure}
lib.chapters.forEach(c => c.words.forEach(w => { RAD[w.word] = w; }));

/* ── 精确复刻 buildDeck / computeNeed：pairs 按 words 轮转分配 ── */
function deckOf(lv) {
  const ks = lv.words.map(w => ({ a: WORDS[w].a, b: WORDS[w].b }));
  const deck = [];
  for (let i = 0; i < lv.pairs; i++) {
    const k = ks[i % ks.length];
    deck.push({ char: k.a, kind: 'radical' });
    deck.push({ char: k.b, kind: 'part' });
  }
  for (let i = 0; i < lv.junk; i++) deck.push({ char: JUNK[i % JUNK.length], kind: 'junk' });
  return deck;
}

/* ── 单关体检 ── */
function audit(lv) {
  const deck = deckOf(lv);
  const faces = {};                    // 牌面图案 → 张数
  deck.forEach(d => { faces[d.char] = (faces[d.char] || 0) + 1; });

  // 偏旁分布：本关每个目标字的「左/上半边」是什么
  const rad = {};
  lv.words.forEach(w => {
    const r = (RAD[w] && RAD[w].radical) || (WORDS[w] && WORDS[w].a) || '?';
    rad[r] = (rad[r] || 0) + 1;
  });
  const order = Object.keys(rad).sort((a, b) => rad[b] - rad[a]);
  const top = order[0], topN = rad[top] || 0;

  const sorted = Object.keys(faces).sort((a, b) => faces[b] - faces[a]);
  const maxFace = sorted[0], maxN = faces[maxFace];

  return {
    n: lv.n, ch: lv.ch, board: lv.cols + 'x' + lv.rows,
    tiles: deck.length, pairs: lv.pairs, junk: lv.junk,
    kinds: lv.words.length,                                  // 字种数
    radicals: order.map(r => r + rad[r]).join(' '),           // 偏旁构成
    radCount: order.length,                                   // 偏旁种类数
    topRadShare: +(topN / lv.words.length).toFixed(2),        // 主偏旁占比
    faces: sorted.length,                                     // 不同牌面图案数
    // 全关牌面里最单调的一张：重复了几次 / 占全关多少
    dullFace: maxFace, dullN: maxN,
    dullShare: +(maxN / deck.length).toFixed(2),
    words: lv.words.join('')
  };
}

const rows = LEVELS.map(audit);

/* ── 汇总 ── */
const used = new Set();
LEVELS.forEach(l => l.words.forEach(w => used.add(w)));
const libAll = new Set();
lib.chapters.forEach(c => c.words.forEach(w => libAll.add(w.word)));
const unused = [...libAll].filter(w => !used.has(w));

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ rows, used: [...used], unused }, null, 1));
  process.exit(0);
}

const pad = (s, n) => { s = String(s); let w = 0; for (const c of s) w += (c.charCodeAt(0) > 0x2000 ? 2 : 1); return s + ' '.repeat(Math.max(0, n - w)); };

console.log('\n═══ 当前 ' + rows.length + ' 关体检（原型实际运行的那一版）═══\n');
console.log(pad('关', 5) + pad('棋盘', 6) + pad('牌数', 5) + pad('字种', 5) + pad('偏旁', 4) +
            pad('主偏旁', 8) + pad('图案数', 7) + pad('最单调牌面', 12) + '目标字');
console.log('─'.repeat(88));
rows.forEach(r => {
  console.log(
    pad(r.n, 5) + pad(r.board, 6) + pad(r.tiles, 5) + pad(r.kinds, 5) + pad(r.radCount, 4) +
    pad((r.radicals || '-'), 8) + pad(r.faces, 7) +
    pad(r.dullFace + '×' + r.dullN + '(' + Math.round(r.dullShare * 100) + '%)', 12) +
    r.words);
});

const avgKinds = rows.reduce((s, r) => s + r.kinds, 0) / rows.length;
const avgFaces = rows.reduce((s, r) => s + r.faces, 0) / rows.length;
const single = rows.filter(r => r.radCount === 1).length;
console.log('─'.repeat(88));
console.log('平均字种 ' + avgKinds.toFixed(2) + '   平均不同牌面图案 ' + avgFaces.toFixed(1));
console.log('清一色单一偏旁的关：' + single + ' / ' + rows.length + ' 关');
console.log('\n字库 ' + libAll.size + ' 字，原型实际用到 ' + used.size + ' 字，**从未出现 ' + unused.length + ' 字**：');
console.log('  ' + unused.join(' '));

/* 分章汇总 */
console.log('\n═══ 分章' + '─'.repeat(60));
CHAPTERS.forEach(c => {
  const rs = rows.filter(r => r.ch === c.id);
  const pool = CH_POOL[c.id] || [];
  const usedInChap = new Set(); rs.forEach(r => r.words.split('').forEach(w => usedInChap.add(w)));
  console.log(pad(c.name, 16) +
    '关数 ' + rs.length +
    '  字池 ' + pool.length + ' 字 → 实际用到 ' + usedInChap.size + ' 字' +
    '  平均字种 ' + (rs.reduce((s, r) => s + r.kinds, 0) / rs.length).toFixed(2) +
    '  偏旁种类 ' + [...new Set(rs.flatMap(r => r.radicals.split(' ').map(x => x[0])))].join(''));
  console.log('   ' + pad('关号', 6) + pad('字种', 5) + pad('偏旁', 6) + '目标字');
  rs.forEach(r => console.log('   ' + pad(r.n, 6) + pad(r.kinds, 5) + pad(r.radCount, 6) + r.words));
});
console.log();
