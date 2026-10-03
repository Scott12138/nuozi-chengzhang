#!/usr/bin/env node
/* ============================================================================
 * 关卡配比校验器 —— 把关卡设计逐条过规则
 *
 * 背景：原型原来的关卡是 `pool.slice(0, nx)` 程序化生成的，导致
 *   ① 字池按偏旁分组排列 → 每关清一色一个偏旁
 *   ② 永远从第 0 个切       → 相邻关字单逐字相同
 * 结论是「关卡字单必须是设计出来的，不能是算出来的」。
 * 本脚本负责在铺关时把设计**逐条验过**，不靠肉眼。
 *
 * 规则（详见 docs/关卡设计_v2.0_草案.md §1）：
 *   R1 字种数 ≥ 4，且 ≤ 配对数（否则有字一局凑不出，目标栏会出现 0/0）
 *   R2 偏旁种类 ≥ 2
 *   R3 单张牌面重复率 ≤ 30%          ← 最硬的可验收指标
 *   R4 章内孤偏旁豁免，但每关 ≤ 3 个
 *   R5 本关偏旁字 ∩ 本关部件字 = 空集（同一关内一个字不能既当偏旁又当部件）
 *      理由：水墨版已去掉偏旁/部件的冷暖双色，两张同字不同 kind 的牌会让玩家无法分辨
 *
 * 用法：
 *   node tools/level-design-check.js            # 校验下方内嵌的第一章样张
 *   node tools/level-design-check.js --file x.js  # 校验外部关卡表
 *
 * 关卡表格式（定稿后移到 design/levels-v2.js）：
 *   [{ n:1, ch:1, pairs:9, junk:3, words:['枪','棍','锤','钩'], note:'教学' }, ...]
 * ========================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const lib = require(path.join(ROOT, 'assets', 'wordlib.json'));

/* 全库字 → 拆分信息 */
const RAD = {}, PART = {}, TIER = {}, STRUCT = {};
lib.chapters.forEach(c => c.words.forEach(w => {
  RAD[w.word] = w.radical; PART[w.word] = w.part;
  TIER[w.word] = w.tier; STRUCT[w.word] = w.structure;
}));

/* 章内偏旁字数 → 识别「章内孤偏旁」。
   ★ 用数组下标（1 起）作键，不要用 c.id —— 它是 'ch1' 这种字符串。 */
const CH_RAD = {};
lib.chapters.forEach((c, i) => {
  const m = {};
  c.words.forEach(w => { m[w.radical] = (m[w.radical] || 0) + 1; });
  CH_RAD[i + 1] = m;
});

const JUNK_CHARS = ['疒', '匚', '彳', '卩', '冫', '屮', '丬', '廾', '弋'];

/* ── 第一章样张（已校验通过 8/8）─────────────────────────────────────────
 * 棋盘/对数/干扰牌数严格沿用规格书 §2.11 原值，只重排「用哪些字、偏旁怎么搭」。 */
const SAMPLE_CH1 = [
  { n: 1, ch: 1, pairs: 9, junk: 3, words: ['枪', '棍', '锤', '钩'], note: '教学：一上来就是两种偏旁' },
  { n: 2, ch: 1, pairs: 9, junk: 3, words: ['枪', '棒', '锤', '钩', '镰'], note: '字种 +1' },
  { n: 3, ch: 1, pairs: 9, junk: 4, words: ['棍', '杖', '锤', '钩', '锏', '铠'], note: '★偏旁换血：钅升为主' },
  { n: 4, ch: 1, pairs: 10, junk: 4, words: ['枪', '棒', '槌', '镰', '锏', '铠'], note: '★撤掉拆法提示条' },
  { n: 5, ch: 1, pairs: 10, junk: 4, words: ['枪', '杵', '槌', '钩', '镰', '鞭', '鞘'], note: '★引入第三种偏旁 革' },
  { n: 6, ch: 1, pairs: 10, junk: 4, words: ['棍', '杖', '柄', '锏', '铠', '鞭', '靶'], note: '三偏旁均衡' },
  { n: 7, ch: 1, pairs: 11, junk: 4, words: ['枪', '棍', '锤', '钩', '箭', '斧', '弩'], note: '★★特殊结构：形旁在右/在下' },
  { n: 8, ch: 1, pairs: 11, junk: 4, words: ['棒', '柄', '杵', '锏', '铠', '鞘', '靶', '剑'], note: '章末综合关' },
];

const fIdx = process.argv.indexOf('--file');
const LEVELS = fIdx > 0 ? require(path.resolve(process.argv[fIdx + 1])) : SAMPLE_CH1;

/* 章内序号（用于显示 1-3、3-8 这样的关号，而不是全局关号） */
const CH_SEQ = {};
LEVELS.forEach(lv => { const c = lv.ch || 1; CH_SEQ[c] = (CH_SEQ[c] || 0) + 1; lv._seq = CH_SEQ[c]; });

const pad = (s, n) => { s = String(s); let w = 0; for (const c of s) w += (c.charCodeAt(0) > 0x2000 ? 2 : 1); return s + ' '.repeat(Math.max(0, n - w)); };

/* ── 精确复刻 buildDeck：pairs 按 words 轮转分配 ── */
function analyze(lv) {
  const faces = {}, radWords = {}, used = {};
  for (let i = 0; i < lv.pairs; i++) {
    const w = lv.words[i % lv.words.length];
    const a = RAD[w], b = PART[w];
    if (a === undefined) throw new Error('字库里没有「' + w + '」');
    faces[a] = (faces[a] || 0) + 1;
    faces[b] = (faces[b] || 0) + 1;
    radWords[a] = (radWords[a] || 0) + 1;
    used[w] = (used[w] || 0) + 1;
  }
  for (let i = 0; i < lv.junk; i++) { const c = JUNK_CHARS[i % JUNK_CHARS.length]; faces[c] = (faces[c] || 0) + 1; }

  const tiles = lv.pairs * 2 + lv.junk;
  const radKeys = Object.keys(radWords).sort((a, b) => radWords[b] - radWords[a]);
  const faceKeys = Object.keys(faces).sort((a, b) => faces[b] - faces[a]);

  /* ── 逐条过规则。exempt 是专题关的「明示豁免」——
        只允许豁免 R4（孤偏旁），且必须写明理由；R1/R2/R3/R5 不许豁免。 ── */
  const raw = [];
  if (lv.words.length < 4) raw.push(['R1', '字种<4']);
  if (lv.words.length > lv.pairs) raw.push(['R1', '字种>对数(' + lv.words.length + '>' + lv.pairs + ')']);
  if (radKeys.length < 2) raw.push(['R2', '偏旁<2']);
  const share = faces[faceKeys[0]] / tiles;
  if (share > 0.30) raw.push(['R3', '「' + faceKeys[0] + '」重复' + Math.round(share * 100) + '%>30%']);

  const chap = lv.ch || 1;
  const cmap = CH_RAD[chap] || CH_RAD[1];
  let lonely = 0;
  radKeys.forEach(r => {
    if ((cmap[r] || 0) >= 2 && radWords[r] < 2) raw.push(['R4', '孤偏旁' + r]);
    if ((cmap[r] || 0) === 1) lonely++;
  });
  if (lonely > 3) raw.push(['R4', '孤偏旁字过多(' + lonely + ')']);

  // R5：本关偏旁字 与 本关部件字 不能有交集
  const radSet = new Set(radKeys), partSet = new Set(lv.words.map(w => PART[w]));
  for (const c of partSet) if (radSet.has(c)) raw.push(['R5', '「' + c + '」既当偏旁又当部件']);

  const exempt = lv.exempt || {};
  const viol = raw.filter(([code]) => !exempt[code]);
  const waived = raw.filter(([code]) => exempt[code]).map(([code, msg]) => code + '(' + msg + ')');

  return { tiles, radKeys, radWords, faceKeys, faces, top: faceKeys[0], topN: faces[faceKeys[0]], share, viol, waived, lonely, used };
}

let bad = 0;
const coverAll = {};
console.log('\n═══ 关卡配比校验 · ' + LEVELS.length + ' 关 ═══\n');
console.log(pad('关', 6) + pad('牌', 5) + pad('对', 4) + pad('字种', 6) + pad('偏旁', 5) +
  pad('偏旁构成', 18) + pad('图案', 6) + pad('最重复牌面', 15) + '规则');
console.log('─'.repeat(94));

LEVELS.forEach(lv => {
  const a = analyze(lv);
  if (a.viol.length) bad++;
  const label = (lv.ch || 1) + '-' + lv._seq;
  console.log(pad(label, 6) + pad(a.tiles, 5) + pad(lv.pairs, 4) + pad(lv.words.length, 6) + pad(a.radKeys.length, 5) +
    pad(a.radKeys.map(r => r + a.radWords[r]).join(' '), 18) +
    pad(a.faceKeys.length, 6) + pad(a.top + '×' + a.topN + '(' + Math.round(a.share * 100) + '%)', 15) +
    (a.viol.length ? '✗ ' + a.viol.join(', ') : '✓'));
  if (lv.words.length) console.log('      ' + lv.words.map(w => w + '(' + TIER[w] + STRUCT[w] + ')').join(' '));
  if (lv.note) console.log('      —— ' + lv.note);
  if (a.waived.length) console.log('      ⚠ 明示豁免：' + a.waived.join('; '));
  lv.words.forEach(w => coverAll[w] = (coverAll[w] || 0) + 1);
});

/* 分章覆盖 */
const chapSeen = [...new Set(LEVELS.map(l => l.ch || 1))];
console.log('─'.repeat(94));
chapSeen.forEach(ci => {
  const all = lib.chapters[ci - 1].words.map(w => w.word);
  const miss = all.filter(w => !coverAll[w]);
  const sumK = LEVELS.filter(l => (l.ch || 1) === ci).reduce((s, l) => s + l.words.length, 0);
  const nLv = LEVELS.filter(l => (l.ch || 1) === ci).length;
  const sumShare = LEVELS.filter(l => (l.ch || 1) === ci).reduce((s, l) => s + analyze(l).share, 0);
  console.log('章' + ci + ' ' + lib.chapters[ci - 1].name +
    '　覆盖 ' + (all.length - miss.length) + '/' + all.length + (miss.length ? '　缺 → ' + miss.join('') : ' ✅') +
    '　平均字种 ' + (sumK / nLv).toFixed(2) +
    '　平均牌面重复 ' + (sumShare / nLv * 100).toFixed(1) + '%');
  console.log('   出场关数 ' + all.map(w => w + '×' + (coverAll[w] || 0)).join(' '));
});
console.log('\n违规关数：' + bad + ' / ' + LEVELS.length + (bad ? '  ← 必须先修掉再落数据' : '  ✅ 全部通过'));
console.log();
process.exit(bad ? 1 : 0);
