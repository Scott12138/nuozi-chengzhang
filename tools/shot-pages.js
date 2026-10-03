#!/usr/bin/env node
/* 全页面截图器（零依赖，node 22 内置 WebSocket + fetch）
 *
 * 【为什么不用 tools/shot.sh】
 * shot.sh 走 `chrome --screenshot`，只能截「直接打开某 URL」时的样子。
 * 但有一类界面**没有 URL 入口**：失败页、激励视频弹窗、提示引导……
 * 它们只能靠「在页面上执行 JS 把状态切过去」才能看到。
 * 所以这里改成 CDP：navigate → Runtime.evaluate 切态 → Page.captureScreenshot。
 *
 * 【为什么每个状态单独 navigate】
 * 状态之间有副作用（开局、消耗道具、改 G.stats），同页连续切态会互相污染。
 * 每个状态都从干净的 file:// 重新加载，并且先清 localStorage 保证存档态可控。
 *
 * 【长列表怎么一次截全：expand】
 * 一开始想「把视口调高就行」，结果截出来手机框浮在中间、上下全是空白 ——
 * 因为 .phone 是**固定 390×780**（max-height:100vh-28px），视口再高它也不长，
 * 长列表照样在框内部滚动，加高只多出空白。
 * 正确做法是注入一段样式把框和滚动容器「展开」：
 *   .phone 高度自适应 + .chap-list/.map-wrap/.atlas-wrap 取消滚动改自然高度，
 * 量出展开后的真实高度，再把视口高度设成它 —— 一次截全，且不留空白。
 *
 * 用法：
 *   node tools/shot-pages.js                 # 全部状态
 *   node tools/shot-pages.js 07 15           # 只跑编号前缀匹配的状态
 */
'use strict';
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9344;
const OUTDIR = path.join(ROOT, 'shots', 'all-pages');
const PAGE = 'file://' + path.join(ROOT, 'prototype', 'index.html');
const DSF = 2;                       // 输出 = 视口 × 2

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ── 页面状态清单 ────────────────────────────────────────────
   q     : 挂在 index.html 后面的查询串
   h     : 视口高（默认 900）
   wait  : 导航后、执行 js 前的等待（等 boot / 等 startLevel 建完盘面）
   js    : 切态用的表达式（在页面里执行）
   after : 执行 js 后再等多久（toast / 过渡动画）
   ──────────────────────────────────────────────────────── */
const STATES = [
  /* 启动页要等 boot() 自己的进度条动画跑完（约 1.0s 后它会 go('s-home')），
     去晚了才是「停在启动页」；去早了会被那一下自动跳转顶掉，截出来是首页。 */
  { id: '01-启动页',        q: '',                    wait: 1700,
    js: "go('s-boot');document.getElementById('boot-bar').style.width='62%'", after: 450 },

  { id: '02-首页-初见',      q: '?s=home',             wait: 700 },

  { id: '03-首页-有进度',    q: '?s=home',             wait: 700,
    js: "G.stars={1:3,2:3,3:2,4:3,5:1,6:2,7:3,8:3};" +
        "['枪','棍','锤','钩','棒','镰','锏','铠'].forEach(function(w){G.litWords[w]=1;});renderHome();",
    note: '看首页在「有存档」时的样子：三个统计数字 + 章节预览字' },

  { id: '04-章节选择',       q: '?s=chap',             expand: true, wait: 900 },

  { id: '05-关卡地图-第一章', q: '?s=map&ch=1',         expand: true, wait: 1000,
    js: "G.stars={1:3,2:3,3:2};renderMap(1);", after: 500 },

  /* 注入的是第 3 章（17~28 关）自己的星，才能在一屏里同时看到
     「已通关(带星) / 当前关(红圈) / 未解锁(灰)」三种节点样式 */
  { id: '06-关卡地图-第三章', q: '?s=map&ch=3',         expand: true, wait: 1000,
    js: "G.stars={17:3,18:3,19:2,20:3,21:1};renderMap(3);",
    after: 500, note: '12 关的小径 + 已通关/当前/未解锁三种节点样式' },

  { id: '07-对局-第1关',     q: '?s=play&lv=1',         h: 940, wait: 1200 },

  { id: '08-对局-拖动中',    q: '?s=play&lv=1',         h: 940, wait: 1300, mouse: 'drag',
    note: '按住牌时：可落格亮起 + 与搭档的连线' },

  { id: '09-对局-第24关鸟字组', q: '?s=play&lv=24',      h: 980, wait: 1400,
    note: '一关里四张一模一样的「鸟」牌' },

  { id: '10-对局-提示引导',  q: '?s=play&lv=8',         h: 940, wait: 1300,
    js: 'useHint()', after: 320,
    note: '点「提示」时的实时引导' },

  { id: '11-对局-终章',      q: '?s=play&lv=38',        h: 1060, wait: 1500,
    note: '7×7 棋盘、四偏旁混排' },

  /* ?s=clear 是直接跳结算，用时算出来是 0s（真实玩不会这样）——
     覆盖成一个合理值，免得评审时被"0s"带偏 */
  { id: '12-通关结算',       q: '?s=clear&lv=1',        wait: 1600,
    js: "document.getElementById('res-time').textContent='83s'", after: 200 },

  { id: '13-失败结算',       q: '?s=play&lv=1',         wait: 1300,
    js: 'G.stats.matched=5;finishFail()', after: 420 },

  { id: '14-激励视频弹窗',   q: '?s=play&lv=1',         wait: 1300,
    js: "G.stats.matched=5;finishFail();showAd('复活 +30 秒',function(){})", after: 420 },

  { id: '15-图鉴-未解锁',    q: '?s=atlas',             expand: true, wait: 1000 },

  /* 点亮顺序要**按关卡推进顺序**，不能直接切 Object.keys(WORDS) 的前 N 个 ——
     字库是按偏旁分组的，那样切出来会在同一个章节里东亮一个西亮一个，很假。
     按 LEVELS 逐关累计，得到的就是「第一章全亮 + 第二章亮一半」的自然进度。 */
  { id: '16-图鉴-已解锁',    q: '?s=atlas',             expand: true, wait: 1000,
    js: "(function(){var lit={},cnt=0,N=34;" +
        "for(var i=0;i<LEVELS.length&&cnt<N;i++){" +
        "var ws=LEVELS[i].words;" +
        "for(var j=0;j<ws.length&&cnt<N;j++){" +
        "if(!lit[ws[j]]){lit[ws[j]]=1;cnt++;}}}" +          // ★ 计「唯一字」，不是关卡条目
        "G.litWords=lit;G.stars={1:3,2:3,3:2,4:3,5:1,6:2,7:3,8:3};renderAtlas();})()",
    after: 400, note: '已点亮/未点亮两种状态' },

  { id: '17-设置',           q: '?s=set',               wait: 800 },

  /* 干扰牌是本作特色机制，值得单独看一张：点它会被明确告知"配不成字" */
  { id: '18-干扰牌提示',     q: '?s=play&lv=1',         wait: 1300,
    js: "toast('这是干扰牌，拼不成字',9000)", after: 400,
    note: '点干扰牌时的提示条（也可对比它和棋盘的位置关系）' },
];

/* 一个状态最多给 45 秒 —— 超时只跳过它自己，不拖垮整轮 */
const STATE_TIMEOUT = 45000;

/* 展开样式：把「固定 780 高的手机框 + 框内滚动」改成「框随内容长高、内容全部铺开」。
   只对 chap / map / atlas 这类长列表页用；其余页保持真实 780 视口。 */
const EXPAND_JS = `(function(){
  if (document.getElementById('__expand')) return;
  var s = document.createElement('style'); s.id = '__expand';
  s.textContent =
    'body{align-items:flex-start!important;padding:14px!important}' +
    '.phone{height:auto!important;max-height:none!important;overflow:visible!important}' +
    '.screen{overflow:visible!important}' +
    '.screen.active{position:relative!important;inset:auto!important;height:auto!important}' +
    '.chap-list,.map-wrap,.atlas-wrap{flex:none!important;height:auto!important;' +
      'max-height:none!important;overflow:visible!important}';
  document.head.appendChild(s);
  var w = document.getElementById('map-wrap');
  if (w && document.getElementById('s-map').classList.contains('active')) {
    requestAnimationFrame(function(){ drawMapPath(w); });   // 尺寸变了，重画关卡小径
  }
})()`;

const EXPAND_MAX_H = 6000;      // 展开后高度上限，防某页异常长时截出巨图

/* ── 「拖动中」怎么截 ────────────────────────────────────────
 * 不能用页面里现成的 demoDrag()：它是给人看的示意动画，效果依赖
 * 它自己那一下 markReachable，而且截图时机稍偏就什么都不剩。
 * 改成**派发真实鼠标事件**（原型监听的是 pointerdown/move/up，
 * Chrome 会把 CDP 的鼠标事件合成为 pointer 事件）：
 *   找一张有解的牌 → 按住 → 朝它的搭档方向挪半格 → 不松手直接截图。
 * 这样截到的是"玩家手指还按在牌上"的瞬间，亮格与连线都是真实状态。 */
/* ★ 第一版直接用了 findSuggest() 给的那张牌，结果截出来**没有任何亮格** ——
   因为 findSuggest 找的是「已经能凑对的牌」（它俩本来就同行同列、点一下就消），
   那种牌往往四周早已被堵死，slideRange 退化成一个点，reachableCells 是空的，
   自然一处也不点亮。所以要挑的是**真的还有地方可挪、且挪过去能凑对**的牌：
   枚举可到达空格 → 用原型自己的 matchTargets() 试算 → 命中优先。 */
const DRAG_PREP_JS = `(function(){
  if (typeof reachableCells !== 'function') return 'null';
  function pairs(t, c2){                            // 把牌摆到 c2 试算一次，马上还原
    var oI = t.r*G.cols + t.c, nI = c2.r*G.cols + c2.c;
    var saveO = G.board[oI], saveN = G.board[nI], sr = t.r, sc = t.c;
    G.board[oI] = null; G.board[nI] = t; t.r = c2.r; t.c = c2.c;
    var hits = (typeof matchTargets === 'function') ? matchTargets(t) : null;
    t.r = sr; t.c = sc; G.board[oI] = saveO; G.board[nI] = saveN;
    return !!(hits && hits.length);
  }
  function pack(t, c2){
    var r = t.el.getBoundingClientRect();
    var sx = c2.c === t.c ? 0 : (c2.c > t.c ? 1 : -1);
    var sy = c2.r === t.r ? 0 : (c2.r > t.r ? 1 : -1);
    /* 只走 0.65 格：够让 clampSlide 吸附到相邻格（round(0.5)=1），
       又不会一格未满就卡在缝里；吸附后落点=相邻格，预判才会亮、才会连线。 */
    var dx = sx * G.cell * 0.65, dy = sy * G.cell * 0.65;
    if (!dx && !dy) dx = G.cell * 0.65;
    return JSON.stringify({
      x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2),
      dx: Math.round(dx), dy: Math.round(dy), ch: t.char, r: t.r, c: t.c
    });
  }
  var all = allTiles(), fallback = null, anyPair = null;
  for (var i = 0; i < all.length; i++){
    var t = all[i];
    if (t.kind === 'junk' || !t.el) continue;
    var rc = reachableCells(t);
    if (!rc.length) continue;                       // 无处可挪 → 亮格是空的，跳过
    if (!fallback) fallback = { t: t, c2: rc[0] };
    for (var j = 0; j < rc.length; j++){
      var c2 = rc[j];
      if (!pairs(t, c2)) continue;
      var d = Math.abs(c2.r - t.r) + Math.abs(c2.c - t.c);
      if (d === 1) return pack(t, c2);              // 最理想：紧邻一格且能凑对
      if (!anyPair) anyPair = { t: t, c2: c2 };
    }
  }
  var pk = anyPair || fallback;
  return pk ? pack(pk.t, pk.c2) : 'null';
})()`;

async function doDrag(send, sleep) {
  const prep = await send('Runtime.evaluate', { expression: DRAG_PREP_JS, returnByValue: true });
  const info = JSON.parse(prep.result.value || 'null');
  if (!info) throw new Error('找不到可拖动的牌（findSuggest 无解）');
  await send('Input.dispatchMouseEvent',
    { type: 'mousePressed', x: info.x, y: info.y, button: 'left', clickCount: 1, buttons: 1 });
  await sleep(60);
  for (let i = 1; i <= 5; i++) {
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', button: 'left', buttons: 1,
      x: Math.round(info.x + info.dx * i / 5), y: Math.round(info.y + info.dy * i / 5),
    });
    await sleep(38);
  }
  // ★ 不派发 mouseReleased —— 要的就是「还按着」的那一帧
  await sleep(240);
  // 自检：确实有一张牌处于 dragging，否则截出来是静态盘面（看不出来）
  const chk = await send('Runtime.evaluate', {
    expression: "!!document.querySelector('.tile.dragging')", returnByValue: true,
  });
  return { ch: info.ch, dragging: !!chk.result.value };
}

const withTimeout = (p, ms, label) => Promise.race([
  p,
  sleep(ms).then(() => { throw new Error('超时 ' + ms + 'ms：' + label); })
]);

(async () => {
  fs.mkdirSync(OUTDIR, { recursive: true });
  const want = process.argv.slice(2);
  const list = want.length
    ? STATES.filter(s => want.some(w => s.id.startsWith(w)))
    : STATES;

  const chrome = spawn(CHROME, [
    '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--remote-debugging-port=' + PORT,
    '--window-size=430,900',
    'about:blank',
  ], { stdio: 'ignore' });

  const get = (u) => new Promise((res, rej) =>
    http.get(u, r => { let d = ''; r.on('data', c => (d += c)); r.on('end', () => res(d)); }).on('error', rej));

  let targets = null;
  for (let i = 0; i < 60; i++) {
    try {
      targets = JSON.parse(await get(`http://127.0.0.1:${PORT}/json/list`));
      if (targets.some(t => t.type === 'page')) break;
    } catch (e) { /* 还没起来 */ }
    await sleep(200);
  }
  if (!targets) { console.error('✗ Chrome 没起来'); chrome.kill(); process.exit(1); }

  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let msgId = 0;
  const pending = new Map();
  const events = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method) events.push(m.method);
  });
  const send = (method, params) => new Promise((res, rej) => {
    const mid = ++msgId;
    pending.set(mid, (m) => m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result));
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
  await new Promise(r => ws.addEventListener('open', r, { once: true }));

  await send('Page.enable');
  await send('Runtime.enable');

  const rows = [];
  for (const st of list) {
    delete st._vh;                                  // 部分重跑时清掉上一轮残留
    const out = path.join(OUTDIR, st.id + '.png');
    const t0 = Date.now();
    let err = null, bytes = 0;
    try {
      await withTimeout((async () => {
        await send('Emulation.setDeviceMetricsOverride', {
          width: 430, height: st.h || 900, deviceScaleFactor: DSF, mobile: false,
        });
        events.length = 0;
        await send('Page.navigate', { url: PAGE + st.q });
        for (let i = 0; i < 80; i++) {
          if (events.includes('Page.loadEventFired')) break;
          await sleep(100);
        }
        await sleep(200);
        // 每个状态都从「干净存档」出发，避免上一个状态的注入残留
        await send('Runtime.evaluate', { expression: "try{localStorage.clear()}catch(e){}" });
        await sleep(st.wait || 800);
        if (st.js) {
          const r = await send('Runtime.evaluate', { expression: st.js, returnByValue: true });
          if (r.exceptionDetails) throw new Error('切态 JS 报错：' + r.exceptionDetails.text);
          await sleep(st.after || 300);
        }
        if (st.mouse === 'drag') {
          const d = await doDrag(send, sleep);
          if (!d.dragging) throw new Error('拖动未生效：没有处于 dragging 的牌');
          st.note = (st.note || '') + '（按住的是「' + d.ch + '」）';
        }
        if (st.expand) {
          await send('Runtime.evaluate', { expression: EXPAND_JS });
          await sleep(260);
          const m = await send('Runtime.evaluate', {
            expression: "Math.ceil(document.querySelector('.phone').getBoundingClientRect().height)",
            returnByValue: true,
          });
          const need = Math.min(EXPAND_MAX_H, (m.result.value || 780) + 30);
          st._vh = need;                       // 真实视口高，写进清单与汇总表
          await send('Emulation.setDeviceMetricsOverride', {
            width: 430, height: need, deviceScaleFactor: DSF, mobile: false,
          });
          await sleep(420);
          // 展开后 .phone 的真实高度就是最终图高，供自检比对
          const m2 = await send('Runtime.evaluate', {
            expression: "Math.ceil(document.querySelector('.phone').getBoundingClientRect().height)",
            returnByValue: true,
          });
          st._realH = m2.result.value;
        }
        const shot = await withTimeout(
          send('Page.captureScreenshot', { format: 'png' }),
          20000, st.id + ' 截图');
        const buf = Buffer.from(shot.data, 'base64');
        if (buf.length < 4096) throw new Error('截图疑似空白（' + buf.length + ' 字节）');
        fs.writeFileSync(out, buf);
        bytes = buf.length;
      })(), STATE_TIMEOUT, st.id);
    } catch (e) { err = e.message; }

    const h = st._vh || st.h || 900;
    rows.push({ id: st.id, h, bytes, ms: Date.now() - t0, err, note: st.note || '' });
    console.log(err
      ? '✗ ' + st.id.padEnd(20) + ' ' + err
      : '✓ ' + st.id.padEnd(20) + ' ' + String(430 * DSF) + '×' + String(h * DSF).padEnd(6) +
        ' ' + (bytes / 1024).toFixed(0).padStart(4) + 'KB  ' + (Date.now() - t0) + 'ms');
  }

  /* 清单按 id 合并 —— 支持「只重跑某几张」，不会把其余状态从清单里抹掉。
     顺序按 STATES 的原始顺序排，保证拼图脚本拿到的是稳定次序。 */
  const mpath = path.join(OUTDIR, 'manifest.json');
  let prev = [];
  try { prev = JSON.parse(fs.readFileSync(mpath, 'utf8')); } catch (e) {}
  const byId = new Map(prev.map(x => [x.id, x]));
  rows.forEach(r => byId.set(r.id, {
    id: r.id, file: r.err ? null : r.id + '.png', w: 430 * DSF, h: r.h * DSF,
    note: r.note, ok: !r.err,
  }));
  const manifest = [...byId.values()].sort(
    (a, b) => STATES.findIndex(s => s.id === a.id) - STATES.findIndex(s => s.id === b.id));
  fs.writeFileSync(mpath, JSON.stringify(manifest, null, 2));

  const bad = rows.filter(r => r.err);
  console.log('\n' + (bad.length ? '✗ ' + bad.length + ' 个状态失败' : '✓ 全部 ' + rows.length + ' 个状态截图完成'));
  chrome.kill();
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('✗ ' + e.message); process.exit(1); });
