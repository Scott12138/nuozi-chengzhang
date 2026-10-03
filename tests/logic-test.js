/* ============================================================
   挪字成章 · 核心逻辑自测（v2 挪对机制）
   运行：node tests/logic-test.js
   手法：把原型里的 <script> 抽出来，注入 DOM 桩后跑真实代码，
        直接验证 canPair / lineClear / matchTargets / 关卡生成 / 挪动求解器
   ============================================================ */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const HTML = path.join(__dirname, '..', 'prototype', 'index.html');
const html = fs.readFileSync(HTML, 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m){ console.error('未找到 <script> 块'); process.exit(1); }
const code = m[1];

/* ---------------- DOM 桩 ---------------- */
function mkEl(tag){
  const el = {
    tagName: tag, _cls: new Set(),
    style: {}, textContent: '', innerHTML: '', children: [], _tile: null,
    classList: {
      add: (...c) => c.forEach(x => el._cls.add(x)),
      remove: (...c) => c.forEach(x => el._cls.delete(x)),
      toggle: (c) => { el._cls.has(c) ? el._cls.delete(c) : el._cls.add(c); },
      contains: (c) => el._cls.has(c)
    },
    appendChild: (c) => { el.children.push(c); return c; },
    removeChild: (c) => { el.children = el.children.filter(x => x !== c); return c; },
    remove: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    setPointerCapture: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 390, height: 780 })
  };
  Object.defineProperty(el, 'firstChild', { get: () => el.children[0] || null });
  return el;
}
const cache = {};
const sandbox = {
  console,
  URLSearchParams,
  setTimeout: () => 0,
  clearTimeout: () => {},
  setInterval: () => 0,
  clearInterval: () => {},
  requestAnimationFrame: () => 0,
  localStorage: { getItem: () => null, setItem: () => {} },
  location: { search: '' },
  document: {
    getElementById: (id) => { if (!cache[id]) cache[id] = mkEl('div'); return cache[id]; },
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (t) => mkEl(t),
    createElementNS: (ns, t) => mkEl(t),
    addEventListener: () => {}
  }
};
vm.createContext(sandbox);

const exportSnippet = `
;globalThis.__EXPORT = function(){
  return {
    G: G, WORDS: WORDS, LEVELS: LEVELS, CHAPTERS: CHAPTERS,
    canPair: canPair, lineClear: lineClear, matchTargets: matchTargets,
    generateLevel: generateLevel, computeNeed: computeNeed, buildRunPair: buildRunPair,
    allTiles: allTiles, findSuggest: findSuggest, hasDirectMatch: hasDirectMatch,
    inB: inB, tileAt: tileAt, idxOf: idxOf, pairWord: pairWord,
    slideRange: slideRange, canSlide: canSlide,
    reachableCells: reachableCells, clampSlide: clampSlide
  };
};`;
vm.runInContext(code + exportSnippet, sandbox);
const T = sandbox.__EXPORT();

/* ---------------- 断言工具 ---------------- */
let pass = 0, fail = 0;
const fails = [];
function t(name, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else { fail++; fails.push(name + '  期望=' + JSON.stringify(want) + ' 实际=' + JSON.stringify(got)); }
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok ? '' : '  → 期望 ' + JSON.stringify(want) + '，实际 ' + JSON.stringify(got)));
}
function sec(s){ console.log('\n' + s); }
function mk(cols, rows, spec){
  const b = new Array(cols * rows).fill(null);
  T.G.cols = cols; T.G.rows = rows;
  for (const k in spec){
    const parts = k.split(',');
    const r = Number(parts[0]), c = Number(parts[1]);
    const tl = Object.assign({ r: r, c: c }, spec[k]);
    b[r * cols + c] = tl;
  }
  T.G.board = b;
  return b;
}
const R = (ch) => ({ char: ch, kind: 'radical' });
const P = (ch) => ({ char: ch, kind: 'part' });
const J = (ch) => ({ char: ch, kind: 'junk' });

/* ============================================================
   1. 配对判定（拆字关系）
   ============================================================ */
sec('1. 配对判定 · 拆字关系');
T.buildRunPair(T.LEVELS[0]);                       // 第 1 关：枪 / 棍 / 棒
t('木 + 仓 = 枪（偏旁在前）', T.canPair(R('木'), P('仓')), true);
t('仓 + 木 = 枪（顺序无关）', T.canPair(P('仓'), R('木')), true);
t('木 + 昆 = 棍', T.canPair(R('木'), P('昆')), true);
t('木 + 奉 = 棒', T.canPair(R('木'), P('奉')), true);
t('木 + 木 → 不可配（同类型）', T.canPair(R('木'), P('木')), false);
t('仓 + 昆 → 不可配（都是部件）', T.canPair(P('仓'), P('昆')), false);
t('木 + 干扰牌 → 不可配', T.canPair(R('木'), J('疒')), false);
t('干扰牌 + 干扰牌 → 不可配', T.canPair(J('疒'), J('匚')), false);
t('木 + 每 → 不可配（不在本关字库）', T.canPair(R('木'), P('每')), false);
t('pairWord 正确返回目标字', T.pairWord(R('木'), P('仓')), '枪');

/* ============================================================
   2. 直线判定（本作核心：同行/同列且中间无阻挡）
   ============================================================ */
sec('2. 直线判定 · 同行 / 同列 / 中间无阻挡');
mk(6, 5, { '0,0': R('木'), '0,1': P('仓') });
t('同行相邻 → 可消', T.lineClear(T.tileAt(0,0), T.tileAt(0,1)), true);

mk(6, 5, { '0,0': R('木'), '1,0': P('仓') });
t('同列相邻 → 可消', T.lineClear(T.tileAt(0,0), T.tileAt(1,0)), true);

mk(6, 5, { '0,0': R('木'), '0,3': P('仓') });
t('同行隔 2 空格 → 可消', T.lineClear(T.tileAt(0,0), T.tileAt(0,3)), true);

mk(6, 5, { '0,0': R('木'), '0,3': P('仓'), '0,1': J('疒') });
t('同行但中间有牌挡住 → 不可消', T.lineClear(T.tileAt(0,0), T.tileAt(0,3)), false);

mk(6, 5, { '0,0': R('木'), '4,0': P('仓') });
t('同列跨 3 行无阻挡 → 可消', T.lineClear(T.tileAt(0,0), T.tileAt(4,0)), true);

mk(6, 5, { '0,0': R('木'), '4,0': P('仓'), '2,0': J('疒') });
t('同列但中间有牌挡住 → 不可消', T.lineClear(T.tileAt(0,0), T.tileAt(4,0)), false);

mk(6, 5, { '0,0': R('木'), '2,3': P('仓') });
t('不同行也不同列 → 不可消', T.lineClear(T.tileAt(0,0), T.tileAt(2,3)), false);

/* ============================================================
   3. 可消目标检索 matchTargets
   ============================================================ */
sec('3. matchTargets · 综合判定');
mk(6, 5, { '0,0': R('木'), '0,2': P('仓'), '3,4': P('昆') });
t('只返回同行无阻挡的那张', T.matchTargets(T.tileAt(0,0)).map(x => x.char), ['仓']);

mk(6, 5, { '0,0': R('木'), '0,2': P('仓'), '0,1': J('疒'), '0,3': P('昆') });
t('被挡住时同行牌都不算', T.matchTargets(T.tileAt(0,0)).map(x => x.char), []);

mk(6, 5, { '0,0': R('木'), '0,3': P('仓'), '3,0': P('昆') });
t('同行 + 同列各一张，都返回', T.matchTargets(T.tileAt(0,0)).map(x => x.char).sort(), ['仓', '昆']);

mk(6, 5, { '0,0': R('木'), '0,3': J('疒') });
t('干扰牌永远不是目标', T.matchTargets(T.tileAt(0,0)).length, 0);

/* ============================================================
   4. 关卡生成 · 空格数与牌数守恒
   ============================================================ */
sec('4. 关卡生成 · 32 关全量校验');
let badSpace = [], badCount = [], badKinds = [];
for (const lv of T.LEVELS){
  const total = lv.cols * lv.rows;
  const want = lv.pairs * 2 + lv.junk;
  const b = T.generateLevel(lv);
  const cnt = b.filter(x => x).length;
  const empty = total - cnt;
  if (empty < 3) badSpace.push(lv.n + '(空' + empty + ')');
  if (cnt !== want) badCount.push(lv.n + '(' + cnt + '≠' + want + ')');
  const rad = b.filter(x => x && x.kind === 'radical').length;
  const prt = b.filter(x => x && x.kind === 'part').length;
  if (rad !== lv.pairs || prt !== lv.pairs) badKinds.push(lv.n + '(偏' + rad + '/件' + prt + ')');
}
t('32 关全部至少留 3 个空格', badSpace, []);
t('32 关牌数 = pairs×2 + junk', badCount, []);
t('32 关偏旁数 = 部件数 = pairs', badKinds, []);

let badNeed = [];
for (const lv of T.LEVELS){
  T.buildRunPair(lv);
  const b = T.generateLevel(lv);
  const partCnt = {};
  for (const x of b) if (x && x.kind === 'part') partCnt[x.char] = (partCnt[x.char] || 0) + 1;
  const need = T.computeNeed(lv);
  let sum = 0;
  for (const w in need){
    sum += need[w];
    const bc = T.WORDS[w].b;
    if (partCnt[bc] !== need[w]) badNeed.push('第' + lv.n + '关 ' + w + ':' + (partCnt[bc] || 0) + '≠' + need[w]);
  }
  if (sum !== lv.pairs) badNeed.push('第' + lv.n + '关 need 合计 ' + sum + '≠' + lv.pairs);
}
t('目标条需求数与部件牌数一致', badNeed.slice(0, 4), []);

/* ============================================================
   5. 挪动求解器 findSuggest（提示 / 死局检测 / 自动演示都靠它）
   ============================================================ */
sec('5. findSuggest · 挪动求解器');
T.buildRunPair(T.LEVELS[0]);

mk(4, 4, { '0,0': R('木'), '1,1': P('仓') });
let s = T.findSuggest();
t('不同行列时能找出挪法', s !== null, true);
if (s){
  const oR = s.tile.r, oC = s.tile.c, oI = T.idxOf(s.tile);
  T.G.board[oI] = null; T.G.board[s.r * 4 + s.c] = s.tile; s.tile.r = s.r; s.tile.c = s.c;
  const ok = T.matchTargets(s.tile).length > 0;
  T.G.board[s.r * 4 + s.c] = null; T.G.board[oI] = s.tile; s.tile.r = oR; s.tile.c = oC;
  t('按建议挪过去后确实能消', ok, true);
}

T.buildRunPair(T.LEVELS[0]);
const full = new Array(16).fill(null);
for (let i = 0; i < 8; i++){
  const r = Math.floor((i * 2) / 4), c = (i * 2) % 4;
  const r2 = Math.floor((i * 2 + 1) / 4), c2 = (i * 2 + 1) % 4;
  full[r * 4 + c] = { char: '木', kind: 'radical', r: r, c: c };
  full[r2 * 4 + c2] = { char: '仓', kind: 'part', r: r2, c: c2 };
}
T.G.board = full; T.G.cols = 4; T.G.rows = 4;
t('满盘无空格 → 求解器返回 null', T.findSuggest(), null);

T.buildRunPair(T.LEVELS[0]);
mk(4, 4, { '0,0': J('疒'), '1,1': J('匚'), '2,2': J('彳') });
t('场上无有效牌 → 返回 null', T.findSuggest(), null);

T.buildRunPair(T.LEVELS[0]);
mk(4, 4, { '0,0': R('木'), '0,1': P('仓') });
t('已对齐时 hasDirectMatch = true', T.hasDirectMatch(), true);
mk(4, 4, { '0,0': R('木'), '2,2': P('仓') });
t('未对齐时 hasDirectMatch = false', T.hasDirectMatch(), false);

/* ============================================================
   6. 滑动约束 slideRange / reachableCells / clampSlide
      —— v2.2 的核心：牌只能沿「本行或本列」滑动，且不能跨过别的牌
   ============================================================ */
sec('6. 滑动约束 · 只能沿本行/本列、遇牌即停');
T.buildRunPair(T.LEVELS[0]);
T.G.cell = 50; T.G.gap = 5;                 // clampSlide 需要格子尺寸

// —— 空旷盘：四向都能滑到边界 ——
mk(5, 5, { '2,2': R('木') });
let g = T.slideRange(T.tileAt(2, 2));
t('空旷盘 · 上滑到顶', g.up, 0);
t('空旷盘 · 下滑到底', g.down, 4);
t('空旷盘 · 左滑到头', g.left, 0);
t('空旷盘 · 右滑到头', g.right, 4);
t('空旷盘 · 可达格 = 横向 4 + 纵向 4', T.reachableCells(T.tileAt(2, 2)).length, 8);
t('可达格不包含自身', T.reachableCells(T.tileAt(2, 2)).some(x => x.r === 2 && x.c === 2), false);
t('可达格全部与自身同行或同列',
  T.reachableCells(T.tileAt(2, 2)).every(x => x.r === 2 || x.c === 2), true);

// —— 被邻牌挡住：只有那一侧走不动，其余三侧照旧 ——
mk(5, 5, { '2,2': R('木'), '2,3': P('仓') });
g = T.slideRange(T.tileAt(2, 2));
t('右侧紧邻有牌 → 右滑范围就是自身', g.right, 2);
t('左侧无阻挡 → 仍可滑到最左', g.left, 0);
t('上方无阻挡 → 仍可滑到最上', g.up, 0);
t('下方无阻挡 → 仍可滑到最下', g.down, 4);

// —— 关键：绝不能「跳」过挡路的牌 ——
mk(5, 5, { '2,0': R('木'), '2,1': P('仓'), '2,4': P('昆') });
t('被挡住的更远空格不在可达集内',
  T.reachableCells(T.tileAt(2, 0)).some(x => x.r === 2 && x.c >= 1), false);
t('被挡住时 木 的可达格只剩纵向',
  T.reachableCells(T.tileAt(2, 0)).every(x => x.c === 0), true);

// —— 四面被围死 ——
mk(5, 5, { '2,2': R('木'), '2,1': P('仓'), '2,3': P('昆'), '1,2': J('疒'), '3,2': J('匚') });
t('四面被围死 → canSlide = false', T.canSlide(T.tileAt(2, 2)), false);
t('四面被围死 → 可达格为空', T.reachableCells(T.tileAt(2, 2)).length, 0);
// 注意：这里只断言「那张被围死的牌不会被选中」——场上别的牌仍可能滑开给它让路，
// 所以不能断言整体无解（那需要整盘互锁，是另一回事）。
t('四面被围死的那张牌不会被求解器选中', (T.findSuggest() || {}).tile !== T.tileAt(2, 2), true);

// —— 边界与贴边 ——
mk(5, 5, { '0,0': R('木') });
g = T.slideRange(T.tileAt(0, 0));
t('左上角 · 上/左范围等于自身', [g.up, g.left], [0, 0]);
t('左上角 · 可达格 = 右 4 + 下 4', T.reachableCells(T.tileAt(0, 0)).length, 8);

mk(5, 5, { '0,3': R('木'), '0,4': P('仓') });
t('贴顶边且右侧被挡 → 四向范围 = 顶/底/最左/被挡在邻格',
  (function () { const q = T.slideRange(T.tileAt(0, 3)); return [q.up, q.down, q.left, q.right]; })(), [0, 4, 0, 3]);

// —— clampSlide：拖动落点被夹进范围 ——
mk(5, 5, { '2,0': R('木'), '2,1': P('仓') });
let d = { range: T.slideRange(T.tileAt(2, 0)), homeR: 2, homeC: 0, axis: 'h' };
t('向右猛拖 → 被邻牌挡住，落点仍是原位', T.clampSlide(d, 999, 0), { r: 2, c: 0 });
t('向左猛拖 → 夹在棋盘左边界', T.clampSlide(d, -999, 0), { r: 2, c: 0 });
t('横向拖动 → 行永远不变', T.clampSlide(d, 51, 0).r, 2);

mk(5, 5, { '2,1': R('木') });
d = { range: T.slideRange(T.tileAt(2, 1)), homeR: 2, homeC: 1, axis: 'v' };
t('纵向拖动 → 列永远不变', T.clampSlide(d, 0, 999).c, 1);
t('纵向猛拖到底 → 夹在最后一行', T.clampSlide(d, 0, 999), { r: 4, c: 1 });
t('纵向猛拖到顶 → 夹在首行', T.clampSlide(d, 0, -999), { r: 0, c: 1 });
t('斜着拖（右 300 / 下 300）→ 落点仍与起点同行或同列',
  (function () { const p = T.clampSlide(d, 300, 300); return p.r === 2 || p.c === 1; })(), true);

// —— 全量：求解器给出的落点，玩家一定真滑得到 ——
let badSug = [];
for (const lv of T.LEVELS){
  T.buildRunPair(lv);
  for (let k = 0; k < 6; k++){
    const b = T.generateLevel(lv);
    T.G.board = b; T.G.cols = lv.cols; T.G.rows = lv.rows;
    const sg = T.findSuggest();
    if (!sg) continue;
    const ok = T.reachableCells(sg.tile).some(x => x.r === sg.r && x.c === sg.c);
    if (!ok) badSug.push('第' + lv.n + '关 ' + sg.tile.char + '→(' + sg.r + ',' + sg.c + ')');
    if (sg.tile.r !== sg.r && sg.tile.c !== sg.c) badSug.push('第' + lv.n + '关 落点与起点不在同行/同列');
  }
}
t('全量 32 关 × 6 次：提示落点都在可达集内且同行/同列', badSug.slice(0, 5), []);

/* ============================================================
   7. 真实关卡开局 · 是否总有可下手的一步
   ============================================================ */
sec('7. 真实开局可玩性');
let noFirstMove = 0, noDirect = 0;
for (const lv of T.LEVELS){
  T.buildRunPair(lv);
  const b = T.generateLevel(lv);
  T.G.board = b; T.G.cols = lv.cols; T.G.rows = lv.rows;
  if (!T.findSuggest()) noFirstMove++;
  if (!T.hasDirectMatch()) noDirect++;
}
t('32 关开局都有可挪动的一步', noFirstMove, 0);
console.log('  ℹ 开局就需要挪动（没有任何已对齐对）的关卡数：' + noDirect + '/32 —— 符合挪对玩法预期');

/* ============================================================
   8. 盲玩模拟 —— 滑动约束下的真实体验指标
     策略：能点就点，不能点就按求解器挪一步；死局则免费重排（与游戏内兜底一致）。
     两个真正被玩家感知的数：
       ① 平均洗牌次数 —— 被迫重排的频率（越低越好）
       ② 平均挪动次数 —— 核心玩法「挪牌创造对齐」被用到的频率
                          太低 = 开局送得太顺，玩家不需要动脑
   ============================================================ */
sec('8. 盲玩模拟 · 滑动约束下的真实体验');

function simShuffleBoard(){
  const ts = T.allTiles(), n = T.G.cols * T.G.rows;
  const open = []; for (let i = 0; i < n; i++) open.push(i);
  for (let i = open.length - 1; i > 0; i--){ const j = Math.floor(Math.random()*(i+1)); const k = open[i]; open[i] = open[j]; open[j] = k; }
  const use = open.slice(0, ts.length);
  T.G.board = new Array(n).fill(null);
  ts.forEach((t, i) => { const idx = use[i]; t.r = Math.floor(idx / T.G.cols); t.c = idx % T.G.cols; T.G.board[idx] = t; });
}
function simSmartShuffle(){
  for (let k = 0; k < 25; k++){ simShuffleBoard(); if (T.hasDirectMatch() || T.findSuggest()) return true; }
  return false;
}
function playFull(lv){
  T.buildRunPair(lv);
  T.G.board = T.generateLevel(lv);
  T.G.cols = lv.cols; T.G.rows = lv.rows;
  let cleared = 0, shuffles = 0, moves = 0, guard = 0, bad = false;
  while (cleared < lv.pairs && guard < 4000){
    guard++;
    let a = null, b = null;
    const ts = T.allTiles();
    outer: for (let i = 0; i < ts.length; i++)
      for (let j = i + 1; j < ts.length; j++)
        if (T.canPair(ts[i], ts[j]) && T.lineClear(ts[i], ts[j])) { a = ts[i]; b = ts[j]; break outer; }
    if (!a){
      const s = T.findSuggest();
      if (!s){ shuffles++; simSmartShuffle(); continue; }
      T.G.board[T.idxOf(s.tile)] = null;
      T.G.board[s.r * T.G.cols + s.c] = s.tile;
      s.tile.r = s.r; s.tile.c = s.c; moves++;
      a = s.tile; b = s.hit;
      if (!(T.canPair(a, b) && T.lineClear(a, b))) { bad = true; break; }   // 求解器给了假解
    }
    T.G.board[T.idxOf(a)] = null;
    T.G.board[T.idxOf(b)] = null;
    cleared++;
  }
  return { shuffles: shuffles, moves: moves, win: cleared >= lv.pairs, bad: bad };
}

let runs = 0, sumSh = 0, sumMv = 0, notWin = 0, worstSh = 0;
for (const lv of T.LEVELS){
  for (let k = 0; k < 8; k++){
    const r = playFull(lv);
    runs++; sumSh += r.shuffles; sumMv += r.moves;
    if (!r.win) notWin++;
    if (r.shuffles > worstSh) worstSh = r.shuffles;
  }
}
const avgSh = sumSh / runs, avgMv = sumMv / runs;
console.log(`  ℹ ${runs} 局盲玩：平均每局洗牌 ${avgSh.toFixed(2)} 次（最多 ${worstSh} 次），平均挪动 ${avgMv.toFixed(1)} 次`);
console.log(`  ℹ 参考：滑动约束下，牌永远只能待在自己那一行/列 —— 所以「挪」是唯一的出路，洗牌是被迫的兜底`);
t('没有一局卡死（都能通关）', notWin, 0);
t('平均每局洗牌 < 1 次（兜底重排不频繁）', avgSh < 1, true);
t('平均每局至少挪动 1 次（挪对玩法确实在用）', avgMv >= 1, true);

/* ============================================================
   汇总
   ============================================================ */
console.log('\n' + '='.repeat(52));
console.log('通过 ' + pass + ' / ' + (pass + fail));
if (fail){
  console.log('\n失败项：');
  fails.forEach(f => console.log('  · ' + f));
  process.exit(1);
}
console.log('全部通过 ✅');
