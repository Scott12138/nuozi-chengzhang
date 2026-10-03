#!/usr/bin/env node
/* 原型墨面验证（零依赖，node 22 内置 WebSocket）
 *
 * 【为什么不能只看截图】
 * 上一轮血泪教训：截图里「看起来有牌」，但 pointermove/pointerup 两个监听器
 * 从未注册，点击判定又写在 pointerup 里 —— 屏幕上完全看不出来，实际点都点不动。
 * 所以这里派发**真实鼠标事件**，判据是「状态真的变了」，不是「元素存在」。
 *
 * 用法: node tools/verify-prototype.js [URL]
 */
'use strict';
const { spawn } = require('child_process');
const http = require('http');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9334;
const URL_ARG = process.argv[2] || 'file://' + require('path').resolve(__dirname, '..', 'prototype', 'index.html') + '?s=play&lv=1';
const W = 430, H = 900;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const get = (u) => new Promise((res, rej) => {
  http.get(u, r => { let d = ''; r.on('data', c => (d += c)); r.on('end', () => res(d)); }).on('error', rej);
});

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
  const errs = [];
  ws.addEventListener('message', (ev) => {
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
    pending.set(mid, (m) => m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result));
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
  await new Promise(r => ws.addEventListener('open', r, { once: true }));

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL_ARG });
  await sleep(3000);                       // 等 boot 动画 + 关卡铺牌

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result.value;
  };

  // ── 1) 静态自检：牌面是否真的画出来了 ──
  const art = await ev(`(function(){
    try{
      var tiles = document.querySelectorAll('.tile');
      var noGlyph = [], kinds = {}, junkDim = 0;
      for (var i=0;i<tiles.length;i++){
        var el = tiles[i];
        var k = (el.className.match(/\\b(radical|part|junk)\\b/)||[''])[0];
        kinds[k] = (kinds[k]||0)+1;
        if (k==='junk') junkDim++;
        // 字层：带 filter 的 path（墨水笔迹）。印也用 path，所以字层至少 1 条。
        var g = el.querySelectorAll('svg path[filter]');
        if (g.length === 0) noGlyph.push(el._tile ? el._tile.char : '?');
      }
      return JSON.stringify({
        screen: (document.querySelector('.screen.active')||{}).id || null,
        tiles: tiles.length, kinds: kinds,
        noGlyph: noGlyph, junk: junkDim,
        boardCells: (typeof G!=='undefined' && G.board) ? G.board.length : null,
        useTransform: tiles.length ? /^translate/.test(tiles[0].style.transform||'') : null,
        useLeft: tiles.length ? !!tiles[0].style.left : null
      });
    }catch(e){ return 'ERR: '+e.message; }
  })()`);
  console.log('① 静态自检  ' + art);

  // ── 2) 真实鼠标拖动：判据是「状态真的变了」 ──
  const pick = await ev(`(function(){
    var all = document.querySelectorAll('.tile:not(.junk)');
    for (var i=0;i<all.length;i++){
      var t = all[i]._tile;
      if (t && t.el && typeof canSlide==='function' && canSlide(t)){
        var r = all[i].getBoundingClientRect();
        return JSON.stringify({x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2),
                               ch:t.char, r:t.r, c:t.c, tf:t.el.style.transform});
      }
    }
    return 'null';
  })()`);
  console.log('② 选中待拖牌  ' + pick);
  if (pick !== 'null') {
    const p = JSON.parse(pick);
    // 先探出它在本行/本列能滑多远
    const dir = await ev(`(function(){
      var all=document.querySelectorAll('.tile');
      for (var i=0;i<all.length;i++){ var t=all[i]._tile;
        if (t && t.char===${JSON.stringify(p.ch)} && t.r===${p.r} && t.c===${p.c}){
          var rg = slideRange(t);
          return JSON.stringify(rg);
        } }
      return 'null';
    })()`);
    console.log('③ 可滑动范围  ' + dir);

    const rg = (dir && dir !== 'null') ? JSON.parse(dir) : null;
    const cellPx = (await ev('G.cell')) || 58;
    /* ★ 必须拖够「一格」才会换格：第一版只拖了 24px 而 cell=58px，
       牌原地弹回、moves 仍是 0 —— 那不是 bug，是测试距离不够。 */
    /* ★ slideRange 给的是**绝对格号**（{up,down,left,right} = 本列可到的行区间、
       本行可到的列区间），不是相对偏移。所以「能不能右移」要跟当前列号比：
       rg.right > p.c 才叫能右移。第一版拿 rg.right > 0 当判据，
       于是朝一个本来就封死的方向拖，牌当然原位弹回。 */
    let ux = 0, uy = 0;
    if (rg) {
      if (rg.right > p.c) ux = 1;
      else if (rg.left < p.c) ux = -1;
      else if (rg.down > p.r) uy = 1;
      else if (rg.up < p.r) uy = -1;
    }
    if (!ux && !uy) { console.log('    ⚠ 这张牌的四个方向都封死了，跳过拖动'); }
    const dist = cellPx * 1.15;
    const dx = ux * dist, dy = uy * dist;
    const MX = [0.25, 0.5, 0.75, 1].map(f => ({ x: Math.round(p.x + dx * f), y: Math.round(p.y + dy * f) }));
    console.log(`    （cell=${cellPx}px，朝 ${ux ? (ux > 0 ? '右' : '左') : (uy > 0 ? '下' : '上')} 拖 ${Math.round(dist)}px）`);

    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1, buttons: 1 });
    for (const m of MX) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: m.x, y: m.y, button: 'left', buttons: 1 });
      await sleep(30);
    }
    // 拖动中的状态（在松手前读）
    const during = await ev(`(function(){
      var all=document.querySelectorAll('.tile');
      for (var i=0;i<all.length;i++){ var t=all[i]._tile;
        if (t && t.char===${JSON.stringify(p.ch)} && t.el.classList.contains('dragging'))
          return JSON.stringify({tf:t.el.style.transform, drag:!!G.drag, axis:G.drag&&G.drag.axis});
      }
      return 'no-dragging-el';
    })()`);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: MX[MX.length-1].x, y: MX[MX.length-1].y, button: 'left', clickCount: 1, buttons: 0 });
    await sleep(500);
    const after = await ev(`(function(){
      var all=document.querySelectorAll('.tile');
      for (var i=0;i<all.length;i++){ var t=all[i]._tile;
        if (t && t.char===${JSON.stringify(p.ch)})
          return JSON.stringify({r:t.r, c:t.c, tf:t.el.style.transform, moves:G.stats.move});
      }
      return 'gone(可能已合成)';
    })()`);
    console.log('④ 拖动中      ' + during);
    console.log('⑤ 松手后      ' + after + '   (起始 r' + p.r + ' c' + p.c + ')');
  }

  console.log('⑥ 控制台异常  ' + (errs.length ? errs.slice(0, 3).join(' | ') : '无 ✅'));

  ws.close(); chrome.kill(); await sleep(200); process.exit(0);
})().catch(e => { console.error('✗', e.message); process.exit(1); });
