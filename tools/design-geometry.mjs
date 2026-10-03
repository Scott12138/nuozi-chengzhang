#!/usr/bin/env node
/* ============================================================
 *  design-geometry.mjs · 把设计稿的真实盒模型量出来（只读，不改任何东西）
 * ============================================================
 *  【为什么需要它】
 *  把设计稿移植到 Cocos 时，最容易出错的不是"看不出差别"，而是
 *  **凭 CSS 猜数字**。本次就撞了两个：
 *    ① 只看 CSS 会以为手机框是 390 宽 —— 但全局 `*{box-sizing:border-box}`
 *       让 `width:390px` 把左右各 9px 的边框也算进去了，真实视口是 **372**。
 *       标尺 720/372=1.9355，而不是 720/390=1.846 —— 4.8% 的差，全页都偏。
 *    ② 只看 `.chap h3{margin:0 0 3px}` 会以为卡片是"标题/副题/预览/星级"四行
 *       的紧凑堆叠，实际每行的**行盒**（= font-size × normal 行高）比字号大得多，
 *       四行加起来把卡片撑到 135px 高。
 *  这些都是 getComputedStyle + getBoundingClientRect 一句话能问清楚的，
 *  不该靠肉眼量 PNG。
 *
 *  【量什么】
 *  对每个 screen（用 ?s=xxx 直达），遍历其内部元素，输出：
 *      designX/Y/W/H   —— 相对 `.screen` 内容盒左上角的设计像素坐标
 *      fs / lh / ls / fw / ff —— font-size / line-height / letter-spacing / weight / family
 *      color / bg
 *  行盒 vs 墨迹：rect 给的是**行盒**，而截图里看到的是**墨迹**。
 *  两者差约 (lineHeight − fontSize×0.86)/2，所以对比截图时别拿墨迹中心
 *  去和 rect 中心硬对。
 *
 *  【为什么视口设成 430×1100】
 *  `.phone{height:780px;max-height:calc(100vh-28px)}`：视口矮了框就被压扁，
 *  量出来的"屏幕高"就不是 762 了（截图脚本里 04 页量到 668 就是这个原因）。
 *  1100 够高，框保持满尺寸。
 *
 *  用法：
 *    node tools/design-geometry.mjs              # 全部 9 页
 *    node tools/design-geometry.mjs chap map     # 只量指定页（screen id 去掉 s- 前缀）
 *    node tools/design-geometry.mjs chap --all   # 连每个元素都列出来（默认只列关键项）
 * ============================================================
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ⚠️ 本文件是 .mjs（ESM）：**没有** require / __dirname，要用 import.meta.url 还原。
//    （tools/shot-pages.js 是 .js 走 CJS，所以那边可以直接 require —— 抄代码时注意这条。）
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9346;
const PAGE = 'file://' + path.join(ROOT, 'prototype', 'index.html');

const VW = 430, VH = 1100;          // 视口：够高，手机框保持 780 满高

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── 每页：查询串 + 进页后要执行的切态 JS ───────────────────── */
const SCREENS = [
    { id: 'boot', q: '?s=boot', wait: 400,
      js: "go('s-boot');document.getElementById('boot-bar').style.width='62%'" },
    { id: 'home', q: '?s=home', wait: 700 },
    { id: 'chap', q: '?s=chap', wait: 900 },
    { id: 'map', q: '?s=map&ch=1', wait: 1000, js: 'G.stars={1:3,2:3,3:2};renderMap(1)' },
    { id: 'play', q: '?s=play&lv=1', wait: 1400 },
    { id: 'clear', q: '?s=clear&lv=1', wait: 1600 },
    { id: 'fail', q: '?s=play&lv=1', wait: 1400, js: 'G.stats.matched=5;finishFail()' },
    { id: 'atlas', q: '?s=atlas', wait: 1100 },
    { id: 'set', q: '?s=set', wait: 800 },
];

/* ── 在页面里跑的导出器 ──────────────────────────────────────
 * 一律相对 `.screen` 的**内容盒**（clientLeft/clientTop 去掉边框）算，
 * 这样得到的数字可以 1:1 乘以标尺直接用在 Cocos 上。
 * 默认只列"有 class 或是有文本"的元素，跳过纯容器噪声；
 * 传 all=true 时全列。棋盘 tile 单独汇总（一关几十张，逐张列没意义）。 */
const DUMP_JS = (all) => `(function(){
  var ALL = ${all ? 'true' : 'false'};
  var sc = document.querySelector('.screen.active');
  if (!sc) return JSON.stringify({err:'没有 active 的 screen'});
  var sr = sc.getBoundingClientRect();
  var ox = sr.left + sc.clientLeft, oy = sr.top + sc.clientTop;
  var out = [];
  function push(el, tag){
    var r = el.getBoundingClientRect();
    if (r.width < 0.5 && r.height < 0.5) return;
    var cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    var txt = (el.textContent || '').replace(/\\s+/g,' ').trim();
    var kids = el.children.length;
    out.push({
      tag: tag,
      cls: el.className ? ('.' + String(el.className).trim().replace(/\\s+/g,'.')) : el.tagName.toLowerCase(),
      x: +(r.left - ox).toFixed(1), y: +(r.top - oy).toFixed(1),
      w: +r.width.toFixed(1), h: +r.height.toFixed(1),
      fs: cs.fontSize, lh: cs.lineHeight, ls: cs.letterSpacing,
      fw: cs.fontWeight, ff: cs.fontFamily.split(',')[0].replace(/"/g,''),
      rad: cs.borderRadius, pad: cs.padding, mar: cs.margin,
      col: cs.color, bg: cs.backgroundColor, bgi: cs.backgroundImage === 'none' ? '' : 'grad',
      hadow: cs.boxShadow === 'none' ? '' : 'shadow',
      text: kids === 0 ? txt.slice(0, 26) : (txt ? txt.slice(0, 26) + '  ['+kids+']' : ''),
    });
  }
  var nodes = sc.querySelectorAll('*');
  for (var i = 0; i < nodes.length; i++){
    var el = nodes[i];
    var id = el.id || '';
    var cls = String(el.className || '').trim();
    var txt = (el.textContent || '').trim();
    if (el.tagName === 'SVG' || el.tagName === 'PATH' || el.closest('.map-path')) continue;
    if (/^tile($|\\s)|\\btile\\b/.test(cls) || el.closest('.board')) { continue; }  // 棋盘单独处理
    if (!ALL && !id && !cls && !txt) continue;
    push(el, el.tagName.toLowerCase());
  }
  // 棋盘汇总
  var b = document.querySelector('.board');
  if (b && b.offsetParent !== null){
    var br = b.getBoundingClientRect(), csb = getComputedStyle(b);
    out.push({ tag: 'board', cls: '#board', x:+(br.left-ox).toFixed(1), y:+(br.top-oy).toFixed(1),
      w:+br.width.toFixed(1), h:+br.height.toFixed(1), fs:'-', lh:'-', ls:'-', fw:'-', ff:'-',
      rad:csb.borderRadius, pad:csb.padding, mar:csb.margin, col:csb.color, bg:csb.backgroundColor,
      bgi:csb.backgroundImage==='none'?'':'grad', hadow:csb.boxShadow==='none'?'':'shadow',
      text:'cell='+ (window.G && G.cell ? G.cell : '?') + ' cols=' + (window.G?G.cols:'?') + ' rows=' + (window.G?G.rows:'?') });
  }
  var t0 = document.querySelector('.tile');
  if (t0){
    var tr = t0.getBoundingClientRect(), cst = getComputedStyle(t0);
    out.push({ tag: 'tile', cls: '.tile', x:+(tr.left-ox).toFixed(1), y:+(tr.top-oy).toFixed(1),
      w:+tr.width.toFixed(1), h:+tr.height.toFixed(1), fs:cst.fontSize, lh:cst.lineHeight, ls:cst.letterSpacing,
      fw:cst.fontWeight, ff:cst.fontFamily.split(',')[0], rad:cst.borderRadius, pad:cst.padding, mar:cst.margin,
      col:cst.color, bg:cst.backgroundColor, bgi:cst.backgroundImage==='none'?'':'grad',
      hadow:cst.boxShadow==='none'?'':'shadow', text:(t0.textContent||'').trim().slice(0,8) });
  }
  var sc2 = { w: sc.clientWidth, h: sc.clientHeight,
              phoneW: document.querySelector('.phone').getBoundingClientRect().width,
              phoneH: document.querySelector('.phone').getBoundingClientRect().height };
  return JSON.stringify({ screen: sc2, items: out });
})()`;

const pad = (s, n) => String(s).padEnd(n);

(async () => {
    const argv = process.argv.slice(2);
    const all = argv.includes('--all');
    const want = argv.filter((a) => !a.startsWith('--'));
    const list = want.length ? SCREENS.filter((s) => want.includes(s.id)) : SCREENS;

    const chrome = spawn(CHROME, [
        '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
        '--remote-debugging-port=' + PORT, `--window-size=${VW},${VH}`, 'about:blank',
    ], { stdio: 'ignore' });

    const get = (u) => new Promise((res, rej) =>
        http.get(u, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res(d)); }).on('error', rej));

    let targets = null;
    for (let i = 0; i < 60; i++) {
        try {
            targets = JSON.parse(await get(`http://127.0.0.1:${PORT}/json/list`));
            if (targets.some((t) => t.type === 'page')) break;
        } catch { /* 还没起来 */ }
        await sleep(200);
    }
    if (!targets) { console.error('✗ Chrome 没起来'); chrome.kill(); process.exit(1); }

    const page = targets.find((t) => t.type === 'page');
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
        pending.set(mid, (m) => (m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result)));
        ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
    });
    await new Promise((r) => ws.addEventListener('open', r, { once: true }));
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', {
        width: VW, height: VH, deviceScaleFactor: 1, mobile: false,
    });

    for (const st of list) {
        events.length = 0;
        await send('Page.navigate', { url: PAGE + st.q });
        for (let i = 0; i < 80; i++) {
            if (events.includes('Page.loadEventFired')) break;
            await sleep(100);
        }
        await sleep(200);
        await send('Runtime.evaluate', { expression: 'try{localStorage.clear()}catch(e){}' });
        await sleep(st.wait || 800);
        if (st.js) {
            const r = await send('Runtime.evaluate', { expression: st.js, returnByValue: true });
            if (r.exceptionDetails) console.error(`  ⚠ ${st.id} 切态 JS 报错：${r.exceptionDetails.text}`);
            await sleep(350);
        }
        const r = await send('Runtime.evaluate', { expression: DUMP_JS(all), returnByValue: true });
        if (r.exceptionDetails) {
            const d0 = r.exceptionDetails.exception;
            console.error(`✗ ${st.id}: ${r.exceptionDetails.text}` +
                (d0 && d0.description ? '\n' + d0.description : ''));
            continue;
        }
        const d = JSON.parse(r.result.value);
        const sc = d.screen;

        console.log('');
        console.log('='.repeat(118));
        console.log(`#s-${st.id}   屏幕 ${sc.w}×${sc.h}   手机框 ${sc.phoneW}×${sc.phoneH}` +
            `    ★ 标尺 = 720/${sc.w} = ${(720 / sc.w).toFixed(4)}`);
        console.log('='.repeat(118));
        console.log('  ' + pad('元素', 26) + pad('  x', 8) + pad('  y', 8) + pad('  宽', 8) + pad('  高', 8) +
            pad('字号', 8) + pad('行高', 9) + pad('字距', 8) + pad('圆角', 7) + '文字');
        for (const it of d.items) {
            console.log('  ' + pad(it.cls, 26) +
                pad(it.x, 8) + pad(it.y, 8) + pad(it.w, 8) + pad(it.h, 8) +
                pad(it.fs, 8) + pad(it.lh, 9) + pad(it.ls, 8) + pad(it.rad, 7) +
                (it.text || ''));
        }
    }

    chrome.kill();
    process.exit(0);
})().catch((e) => { console.error('✗ ' + e.message); process.exit(1); });
