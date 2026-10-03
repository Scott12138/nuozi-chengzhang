/* ============================================================================
 * 挪字成章 · 评审页自测（无头 Chrome + CDP 真实事件）
 * ----------------------------------------------------------------------------
 * 判据是「真的渲染出来了」，不是「HTML 里写了标签」：
 *   ① 全程无 JS 异常
 *   ② 每一个 [data-ch] 容器都必须有内容——要么是真字形 SVG，要么是文字兜底，
 *      绝不能是空白（空白的牌 = 玩家看到一块白板）
 *   ③ 表义形旁 17 个、合成字样张 10 个，必须是「真 SVG」而不是兜底文字
 *   ④ 真实滚动一次，确认长页面没有渲染断裂
 * 零依赖：node 22 自带全局 WebSocket，不需要 Playwright。
 * ========================================================================== */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = path.resolve(__dirname, '..');
const PAGE = 'file://' + path.join(ROOT, 'design', 'review.html');
const PORT = 9334;   // ★ 和 browser-test.js(9333) 错开：同端口会导致连到别人的标签页

const RADS = ['木','艹','钅','竹','犭','鸟','虫','鱼','火','纟','革','石','巾','斤','弓','刂','皿'];
const WORDS = ['枪','棒','梅','铜','狗','笼','烛','虾','莲','鲤'];

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log(`✅ ${name}${extra ? '  ' + extra : ''}`); }
  else { fail++; console.log(`❌ ${name}${extra ? '  ' + extra : ''}`); }
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

function getJSON(url) {
  return new Promise((res, rej) => {
    http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); })
        .on('error', rej);
  });
}

(async () => {
  if (!fs.existsSync(CHROME)) { console.log('找不到 Chrome，跳过'); process.exit(1); }

  const chrome = spawn(CHROME, [
    '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`,
    '--window-size=1180,1000',
    'about:blank'
  ], { stdio: 'ignore' });

  let wsUrl = null;
  for (let i = 0; i < 40; i++) {
    try {
      // ★ 必须取「页面」级 target：/json/version 给的是浏览器级 socket，
      //   在上面调 Runtime.evaluate 会报 "'Runtime.evaluate' wasn't found"
      const list = await getJSON(`http://127.0.0.1:${PORT}/json/list`);
      const page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) { wsUrl = page.webSocketDebuggerUrl; break; }
    } catch (e) { /* 还没起来 */ }
    await sleep(250);
  }
  if (!wsUrl) { console.log('无法连接调试端口'); chrome.kill(); process.exit(1); }

  const ws = new WebSocket(wsUrl);
  // ★ 握手必须带超时：Chrome 启动即崩时 onopen/onerror 都不触发，
  //   事件循环被抽干会让 node 静默 exit 0，测试"通过"得莫名其妙。
  await new Promise((res, rej) => {
    const tm = setTimeout(() => rej(new Error('WebSocket 握手超时（Chrome 可能启动即崩）')), 8000);
    ws.addEventListener('open', () => { clearTimeout(tm); res(); });
    ws.addEventListener('error', () => { clearTimeout(tm); rej(new Error('WebSocket 连接失败')); });
  });

  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push(m.params.exceptionDetails.text +
        ' ' + (m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || ''));
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      errors.push('[log] ' + m.params.entry.text);
    }
  });
  const send = (method, params) => new Promise(res => {
    const i = ++id; pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params: params || {} }));
  });
  const evalJS = async (expr, retry) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (!r || r.error || !r.result) {                       // CDP 返回的是错误体，没有 result
      if (!retry) { await sleep(600); return evalJS(expr, 1); }
      throw new Error('CDP evaluate 失败：' + JSON.stringify((r && (r.error || r)) || null).slice(0, 300));
    }
    if (r.result.exceptionDetails) {
      throw new Error('页面内异常：' + (r.result.exceptionDetails.exception &&
        r.result.exceptionDetails.exception.description || r.result.exceptionDetails.text));
    }
    return r.result.result.value;
  };

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');

  console.log('\n===== 评审页自测 =====\n');

  await send('Page.navigate', { url: PAGE });
  await sleep(1600);

  ok('① 页面已加载', await evalJS(`document.querySelectorAll('[data-ch]').length > 0`),
     `容器数=${await evalJS(`document.querySelectorAll('[data-ch]').length`)}`);

  // ② 每个容器都必须有内容
  const empties = await evalJS(`
    [...document.querySelectorAll('[data-ch]')].filter(el => {
      const t = (el.textContent || '').trim();
      return el.querySelectorAll('svg').length === 0 && t === '';
    }).map(el => el.dataset.ch)
  `);
  ok('② 没有空白字牌（每个容器都有 SVG 或文字兜底）', empties.length === 0,
     empties.length ? '空白=' + empties.join(',') : '');

  // ③ 形旁 / 合成字必须是真字形，不是兜底文字
  const radInfo = await evalJS(`
    ${JSON.stringify(RADS)}.map(c => {
      const el=[...document.querySelectorAll('#rad-grid [data-ch]')].find(e=>e.dataset.ch===c);
      return {c, svg: el? el.querySelectorAll('svg').length : -1};
    })
  `);
  const radBad = radInfo.filter(r => r.svg !== 1).map(r => r.c);
  ok(`③ 表义形旁 ${RADS.length} 个全部为真字形 SVG`, radBad.length === 0,
     radBad.length ? '缺=' + radBad.join(',') : `命中 ${RADS.length}/${RADS.length}`);

  const wordInfo = await evalJS(`
    ${JSON.stringify(WORDS)}.map(c => {
      const el=[...document.querySelectorAll('#word-grid [data-ch]')].find(e=>e.dataset.ch===c);
      return {c, svg: el? el.querySelectorAll('svg').length : -1};
    })
  `);
  const wordBad = wordInfo.filter(r => r.svg !== 1).map(r => r.c);
  ok(`③ 合成字样张 ${WORDS.length} 个全部为真字形 SVG`, wordBad.length === 0,
     wordBad.length ? '缺=' + wordBad.join(',') : `命中 ${WORDS.length}/${WORDS.length}`);

  // ④ 色板与棋盘
  ok('④ 墨色阶 5 档已渲染', await evalJS(`document.querySelectorAll('#ramp-mo .sw').length`) === 5);
  ok('④ 国画颜料 5 色已渲染', await evalJS(`document.querySelectorAll('#ramp-paint .sw').length`) === 5);
  const bt = await evalJS(`document.querySelectorAll('#mock-board .bt').length`);
  const btFilled = await evalJS(`
    [...document.querySelectorAll('#mock-board .bt')].filter(el =>
      el.querySelectorAll('svg').length>0 || (el.textContent||'').trim()!=='').length
  `);
  ok('④ 玩法样张棋盘 30 格全部有内容', bt === 30 && btFilled === 30, `${btFilled}/${bt}`);

  // ⑤ 字牌不是 0 尺寸（渲染塌陷检查）
  const zero = await evalJS(`
    [...document.querySelectorAll('#rad-grid [data-ch]')].filter(el => {
      const r = el.getBoundingClientRect(); return r.width < 20 || r.height < 20;
    }).length
  `);
  ok('⑤ 形旁字牌尺寸正常（无 0 尺寸塌陷）', zero === 0, `异常 ${zero} 个`);

  // ⑥ 真实滚动一屏到底（长页面渲染断裂检查）
  const h = await evalJS(`document.documentElement.scrollHeight`);
  for (let y = 0; y <= h; y += 900) {
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 590, y: 500, deltaX: 0, deltaY: 900 });
    await sleep(80);
  }
  await sleep(500);
  ok('⑥ 长页面真实滚动到底无异常', errors.length === 0, `页面高=${h}px`);

  // ⑦ 全程无 JS 异常
  ok('⑦ 全程无 JS 异常', errors.length === 0, errors.length ? errors.slice(0, 3).join(' | ') : '');

  console.log(`\n===== 评审页自测：${pass} 通过 / ${fail} 失败 =====\n`);

  ws.close(); chrome.kill();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('自测脚本异常：', e); process.exit(1); });
