#!/usr/bin/env node
/* 牌面渲染开销探针（零依赖，node 22 内置 WebSocket）
 *
 * 【为什么需要它】
 * 水墨牌面每张要算 ≈18 个 octave 级的 feTurbulence，filter region 按 1000×1000
 * 用户坐标算。30 张牌 = 540 次全幅噪声 —— 手机上极可能卡死。
 * 这是**架构级的风险**，不能靠推测，必须量。
 *
 * 【为什么用 captureScreenshot 计时】
 * Chrome 里 filter 的栅格化跑在 raster 线程上，主线程的 performance.now()
 * 测不到它（只能测到挂 DOM 的时间）。而 captureScreenshot **必须等整页
 * 光栅化完成**才返回 —— 所以它的 wall time 是「渲染总成本」最好的代理指标。
 * 同一台机器上的相对值就足以定架构。
 *
 * 用法: node tools/perf-probe.js <页面URL> [重复次数]
 */
'use strict';
const { spawn } = require('child_process');
const http = require('http');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;
const URL_ARG = process.argv[2];
const N = parseInt(process.argv[3] || '3', 10);
const W = 400, H = 860;          // 约等于一台手机

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const get = (u) => new Promise((res, rej) => {
  http.get(u, r => { let d = ''; r.on('data', c => (d += c)); r.on('end', () => res(d)); })
      .on('error', rej);
});

(async () => {
  const chrome = spawn(CHROME, [
    '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--remote-debugging-port=' + PORT,
    `--window-size=${W},${H}`,
    'about:blank'
  ], { stdio: 'ignore' });

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
  let id = 0;
  const pending = new Map();
  const events = [];

  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method) events.push(m.method);
  });
  const send = (method, params) => new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, (m) => m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result));
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
  await new Promise(r => ws.addEventListener('open', r, { once: true }));

  await send('Page.enable');
  const t0 = Date.now();
  await send('Page.navigate', { url: URL_ARG });
  // 等 load
  for (let i = 0; i < 80; i++) { if (events.includes('Page.loadEventFired')) break; await sleep(100); }
  const tLoad = Date.now() - t0;

  // 页面自检（约定：写 document.title）
  const r = await send('Runtime.evaluate', { expression: 'document.title', returnByValue: true });
  const title = r.result.value;

  // 稳定一下再开始计时（首帧可能包含字体/资源冷启动）
  await sleep(600);

  const shots = [];
  for (let i = 0; i < N; i++) {
    const a = Date.now();
    await send('Page.captureScreenshot', { format: 'png' });
    shots.push(Date.now() - a);
    await sleep(120);
  }
  shots.sort((a, b) => a - b);
  const med = shots[Math.floor(shots.length / 2)];

  /* ── 动态帧率：真正的考验是「位置变化时」的重绘开销 ──
   * 原型拖动牌时改的是 left/top（触发重排+重绘），如果每帧都要重算
   * filter，就会掉帧。对比 transform（走合成层，不重绘）能看出差多少。
   * 判据：60 帧里有没有出现 >33ms 的长帧 —— 有就是肉眼可见的卡。 */
  async function frameProbe(prop) {
    const expr = `new Promise(function(res){
      var el = document.querySelector('.board') || document.body;
      el.style.position = 'relative';
      var t = [], n = 0;
      function loop(){
        el.style.${prop} = (n % 2 ? '4px' : '-4px');
        t.push(performance.now());
        if (++n < 60) requestAnimationFrame(loop);
        else {
          var d = [];
          for (var i = 1; i < t.length; i++) d.push(t[i] - t[i-1]);
          d.sort(function(a,b){return a-b;});
          var sum = 0; for (var j = 0; j < d.length; j++) sum += d[j];
          res(JSON.stringify({
            med: +d[d.length >> 1].toFixed(1),
            max: +d[d.length - 1].toFixed(1),
            avg: +(sum / d.length).toFixed(1),
            over33: d.filter(function(x){return x > 33;}).length
          }));
        }
      }
      requestAnimationFrame(loop);
    })`;
    const rr = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    return rr.result.value;
  }

  const frames = {
    transform: await frameProbe('transform'),
    left: await frameProbe('left')
  };

  console.log(JSON.stringify({
    url: URL_ARG, title, loadMs: tLoad, shots,
    medianShotMs: med, minShotMs: shots[0], frames
  }));

  ws.close();
  chrome.kill();
  await sleep(200);
  process.exit(0);
})().catch(e => { console.error('✗', e.message); process.exit(1); });
