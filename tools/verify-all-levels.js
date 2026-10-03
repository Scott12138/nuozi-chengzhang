#!/usr/bin/env node
/* ============================================================================
 * 全关卡试玩验证（零依赖，node 22 内置 WebSocket + CDP）
 *
 * 【为什么不能只看截图 / 只看静态检查】
 * 上一轮血泪教训：截图里「看起来有牌」，但 pointermove/pointerup 从未注册，
 * 屏幕上完全看不出来，实际点都点不动。所以：
 *   · 静态段：每关都查（牌数对不对、有没有空白牌、控制台有没有异常）
 *   · 拖动段：只挑关键关，派发**真实鼠标事件**，判据是「G.stats.matched 真的涨了」
 *
 * 用法：
 *   node tools/verify-all-levels.js              # 38 关静态 + 内置关键关拖动
 *   node tools/verify-all-levels.js --static     # 只做静态段（快）
 *   node tools/verify-all-levels.js --drag 24,33 # 只拖这几关
 * ========================================================================= */
'use strict';

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9336;
const FILE_URL = 'file://' + path.resolve(__dirname, '..', 'prototype', 'index.html');
const W = 430, H = 900;
const PER_LEVEL_TIMEOUT = 25000;      // ★ 每关硬超时，防止单关卡住拖垮整轮

/* 关键关：每一个都代表一类「可能出问题」的设计 */
const KEY_DRAG = [1, 7, 15, 22, 24, 33, 38];

const args = process.argv.slice(2);
const staticOnly = args.includes('--static');
const dragArg = (() => { const i = args.indexOf('--drag'); return i >= 0 ? args[i + 1] : null; })();
const dragList = dragArg ? dragArg.split(',').map(Number) : (staticOnly ? [] : KEY_DRAG);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = u => new Promise((res, rej) => {
  http.get(u, r => { let d = ''; r.on('data', c => (d += c)); r.on('end', () => res(d)); }).on('error', rej);
});
const withTimeout = (p, ms, tag) => Promise.race([
  p, new Promise((_, rej) => setTimeout(() => rej(new Error('超时 ' + ms + 'ms @ ' + tag)), ms))
]);

let pass = 0, fail = 0;
const failures = [];

(async () => {
  const chrome = spawn(CHROME, [
    '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--remote-debugging-port=' + PORT, `--window-size=${W},${H}`, 'about:blank'
  ], { stdio: 'ignore' });

  let targets = null;
  for (let i = 0; i < 60; i++) {
    try {
      targets = JSON.parse(await get(`http://127.0.0.1:${PORT}/json/list`));
      if (targets.some(t => t.type === 'page')) break;
    } catch (e) {}
    await sleep(200);
  }
  if (!targets) { console.error('✗ Chrome 没起来'); chrome.kill(); process.exit(1); }

  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  let errs = [];
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails || {};
      errs.push((d.exception && d.exception.description) || d.text || '?');
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errs.push((m.params.args || []).map(a => a.value).join(' '));
    }
  });
  const send = (method, params) => new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, m => m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result));
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  await send('Runtime.enable');
  await send('Page.enable');

  const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('页面报错：' + (r.exceptionDetails.text || ''));
    return r.result.value;
  };

  /* 读出原型里的关卡总表（用于校验每关的预期牌数） */
  await send('Page.navigate', { url: FILE_URL + '?s=home' });
  await sleep(1500);
  const meta = JSON.parse(await ev(`JSON.stringify({
    n: LEVELS.map(function(l){return {n:l.n,ch:l.ch,cols:l.cols,rows:l.rows,pairs:l.pairs,junk:l.junk,kinds:l.words.length}}),
    glyph: { count: InkGlyphs.count, has: function(){ return true; } }
  })`));
  const LV = meta.n;
  console.log('原型内关卡 ' + LV.length + ' 关，字库 ' + meta.glyph.count + ' 字\n');

  /* 单关：加载 → 等牌 → 静态读 → （可选）真实拖动合成 */
  async function runLevel(lv, doDrag) {
    errs = [];
    await send('Page.navigate', { url: FILE_URL + '?s=play&lv=' + lv.n });
    // 等牌真的铺出来（最多 6s）
    let tileN = 0;
    for (let i = 0; i < 30; i++) {
      await sleep(200);
      try { tileN = await ev('document.querySelectorAll(".tile").length'); } catch (e) { tileN = 0; }
      if (tileN > 0) break;
    }
    await sleep(400);

    const st = JSON.parse(await ev(`(function(){
      try{
        var tiles=[].slice.call(document.querySelectorAll('.tile'));
        var noGlyph=[], junk=0, transformOK=0;
        for (var i=0;i<tiles.length;i++){
          var el=tiles[i];
          if (/\\bjunk\\b/.test(el.className)) junk++;
          if (/^translate/.test(el.style.transform||'')) transformOK++;
          if (el.querySelectorAll('svg path[filter]').length === 0) noGlyph.push(el._tile?el._tile.char:'?');
        }
        var w=function(sel){return (document.querySelector(sel)||{}).textContent};
        return JSON.stringify({
          screen:(document.querySelector('.screen.active')||{}).id||null,
          tiles:tiles.length, junk:junk, noGlyph:noGlyph, transformOK:transformOK,
          boardCells:(G.board||[]).length, cols:G.cols, rows:G.rows,
          title:w('#play-title'), tipShow:!!document.getElementById('tips') && document.getElementById('tips').classList.contains('show'),
          tipText:w('#tips'), move:G.stats.move, matched:G.stats.matched,
          runWords:(typeof runWords!=='undefined')?runWords.length:null
        });
      }catch(e){ return JSON.stringify({err:e.message}); }
    })()`));

    const exp = lv.pairs * 2 + lv.junk;
    const problems = [];
    if (st.err) problems.push('读取失败 ' + st.err);
    if (st.screen !== 's-play') problems.push('没进对局页（' + st.screen + '）');
    if (st.tiles !== exp) problems.push('牌数 ' + st.tiles + ' ≠ 预期 ' + exp);
    if (st.noGlyph && st.noGlyph.length) problems.push('空白牌 ' + st.noGlyph.length + ' 张：' + st.noGlyph.join(''));
    if (st.boardCells !== st.cols * st.rows) problems.push('棋盘格数 ' + st.boardCells + ' ≠ ' + (st.cols * st.rows));
    if (st.transformOK !== st.tiles) problems.push('有牌没用 transform 定位（会掉帧）');
    if (errs.length) problems.push('控制台异常：' + errs.slice(0, 2).join(' | '));

    /* ── 真实鼠标拖动 → 合成 ── */
    let dragInfo = '';
    if (doDrag && !problems.length) {
      const s = await ev(`(function(){
        var s = findSuggest();
        if (!s || !s.tile || !s.tile.el) return 'null';
        var br = document.getElementById('board').getBoundingClientRect();
        var cell = G.cell, gap = G.gap;
        var from = s.tile.el.getBoundingClientRect();
        return JSON.stringify({
          ch: s.tile.char, hit: s.hit.char, word: pairWord(s.tile, s.hit),
          fromX: Math.round(from.left + from.width/2), fromY: Math.round(from.top + from.height/2),
          toX: Math.round(br.left + s.c*cell + gap/2 + (cell-gap)/2),
          toY: Math.round(br.top  + s.r*cell + gap/2 + (cell-gap)/2),
          r0: s.tile.r, c0: s.tile.c, r1: s.r, c1: s.c, cell: cell
        });
      })()`);

      if (s === 'null') {
        problems.push('findSuggest 找不到任何可挪动的组合（死局？）');
      } else {
        const g = JSON.parse(s);
        const steps = 8;
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: g.fromX, y: g.fromY, button: 'left', clickCount: 1, buttons: 1 });
        for (let i = 1; i <= steps; i++) {
          const f = i / steps;
          await send('Input.dispatchMouseEvent', {
            type: 'mouseMoved',
            x: Math.round(g.fromX + (g.toX - g.fromX) * f),
            y: Math.round(g.fromY + (g.toY - g.fromY) * f),
            button: 'left', buttons: 1
          });
          await sleep(25);
        }
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: g.toX, y: g.toY, button: 'left', clickCount: 1, buttons: 0 });
        await sleep(700);

        const after = JSON.parse(await ev(`JSON.stringify({
          matched: G.stats.matched, move: G.stats.move,
          tiles: document.querySelectorAll('.tile').length,
          words: (typeof runWords!=='undefined') ? runWords.filter(function(x){return x.got>0}).map(function(x){return x.w}) : [],
          screen: (document.querySelector('.screen.active')||{}).id||null
        })`));
        const cleared = after.tiles === st.tiles - 2;
        const scored = after.matched > st.matched;
        dragInfo = ' 拖「' + g.ch + '」→(' + g.r1 + ',' + g.c1 + ') 与「' + g.hit + '」合成' +
                   (g.word ? '「' + g.word + '」' : '') +
                   ' → matched ' + st.matched + '→' + after.matched +
                   '，牌 ' + st.tiles + '→' + after.tiles +
                   (scored && cleared ? ' ✅' : ' ✗');
        if (!scored || !cleared) {
          problems.push('拖动没产生合成：matched ' + st.matched + '→' + after.matched + '，牌 ' + st.tiles + '→' + after.tiles);
        }
      }
    }

    return { st, problems, dragInfo };
  }

  /* ── 主循环 ── */
  console.log('关   章  棋盘   牌数(期望)  字种  transform  拖动合成');
  console.log('─'.repeat(78));
  for (const lv of LV) {
    const doDrag = dragList.includes(lv.n);
    let out;
    try {
      out = await withTimeout(runLevel(lv, doDrag), PER_LEVEL_TIMEOUT, '第' + lv.n + '关');
    } catch (e) {
      fail++; failures.push('第 ' + lv.n + ' 关：' + e.message);
      console.log(String(lv.n).padStart(2) + '   ' + String(lv.ch).padEnd(3) + String(lv.cols + 'x' + lv.rows).padEnd(7) +
                  '  —  ' + e.message);
      continue;
    }
    const { st, problems, dragInfo } = out;
    const exp = lv.pairs * 2 + lv.junk;
    const line = String(lv.n).padStart(2) + '   ' + String(lv.ch).padEnd(3) +
      String(lv.cols + 'x' + lv.rows).padEnd(7) +
      String((st.tiles != null ? st.tiles : '-') + '(' + exp + ')').padEnd(11) +
      String(lv.kinds).padEnd(5) +
      (st.transformOK === st.tiles ? '  ok    ' : '  BAD   ') +
      (dragInfo || '' + '');
    if (problems.length) { fail++; failures.push('第 ' + lv.n + ' 关：' + problems.join('；')); console.log('\x1b[31m' + line + '\x1b[0m'); }
    else { pass++; console.log(line); }
  }

  console.log('─'.repeat(78));
  console.log('\x1b[32m通过 ' + pass + '\x1b[0m / \x1b[31m失败 ' + fail + '\x1b[0m');
  if (failures.length) { console.log('\n失败明细：'); failures.forEach(f => console.log('  · ' + f)); }

  ws.close(); chrome.kill(); await sleep(150); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('✗ 脚本异常：', e.message); process.exit(2); });
