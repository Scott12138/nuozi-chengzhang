/* ============================================================
   浏览器真实交互测试（CDP 直连，零依赖）
   目的：验证「玩家用鼠标真的能玩」，而不是靠直接调函数。
   做法：headless Chrome + 远程调试端口 + WebSocket 发 CDP 命令，
        派发**真实鼠标事件**（mousePressed / mouseMoved / mouseReleased），
        再读页面状态断言。
   覆盖：
     ① 点击已对齐的牌 → 消除
     ② 拖动一张牌到空格 → 位置真的变了（挪动）
     ③ 拖动一张牌到某空格 → 与搭档同行/列对齐 → 合成汉字（核心玩法）
     ④ 全过程无 JS 异常
   ============================================================ */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;
const PROJ = path.resolve(__dirname, '..');
const BASE = 'file://' + PROJ + '/prototype/index.html';

const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const t = (name, got, want) => {
  const ok = String(got) === String(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? '✅' : '❌'} ${name}  期望=${want} 实际=${got}`);
};

const getJSON = url => new Promise((res, rej) => {
  http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch(e){ rej(e); } }); }).on('error', rej);
});

(async () => {
  // ★ 看门狗：任何"静默退出"都会在这里变成一次响亮的失败，而不是"通过"。
  const WATCHDOG = setTimeout(() => {
    console.log('❌ 测试超时未完成（看门狗触发）');
    process.exit(2);
  }, 120000);
  process.on('unhandledRejection', e => {
    console.log('❌ 未捕获的异步异常：', e && (e.message || e));
    process.exit(2);
  });

  const chrome = spawn(CHROME, [
    // ★ 必须带 --no-sandbox：本机无头 Chrome 不带它会在启动时直接崩
    //   （sandbox initialization failed -> GPU process isn't usable -> SIGTRAP）
    '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=/tmp/cdp-cz-' + Date.now(),
    '--window-size=460,900', '--hide-scrollbars', '--force-device-scale-factor=1', 'about:blank'
  ], { stdio: 'ignore' });

  let ws, id = 0; const pending = new Map(); const pageErrors = [];

  try {
    let target = null;
    for (let i = 0; i < 60 && !target; i++){
      await sleep(250);
      try { const l = await getJSON(`http://127.0.0.1:${PORT}/json/list`); target = l.find(x => x.type === 'page' && x.webSocketDebuggerUrl); } catch(e){}
    }
    if (!target) throw new Error('无法连接 Chrome 调试端口');

    ws = new WebSocket(target.webSocketDebuggerUrl);
    // ★ 必须带超时：Chrome 若在握手前崩溃，onopen/onerror 都不会触发，
    //   事件循环被抽干 -> node 静默 exit 0，测试"通过"得莫名其妙。
    await new Promise((res, rej) => {
      const tm = setTimeout(() => rej(new Error('WebSocket 握手超时（Chrome 可能启动即崩，缺 --no-sandbox）')), 8000);
      ws.onopen = () => { clearTimeout(tm); res(); };
      ws.onerror = () => { clearTimeout(tm); rej(new Error('WebSocket 连接失败')); };
      ws.onclose = () => { clearTimeout(tm); rej(new Error('WebSocket 握手前被关闭')); };
    });

    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)){
        const p = pending.get(m.id); pending.delete(m.id);
        m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
        return;
      }
      if (m.method === 'Runtime.exceptionThrown'){
        pageErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || 'unknown');
      }
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error'){
        pageErrors.push('console.error ' + JSON.stringify(m.params.args.map(a => a.value ?? a.description)));
      }
    };

    const send = (method, params) => new Promise((res, rej) => {
      const mid = ++id; pending.set(mid, { res, rej });
      ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
    });
    const evl = async expr => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error('页面异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
      return r.result.value;
    };
    const mouse = (type, x, y, extra) => send('Input.dispatchMouseEvent',
      Object.assign({ type, x, y, button: 'left', clickCount: 1, buttons: type === 'mouseReleased' ? 0 : 1 }, extra || {}));

    await send('Page.enable'); await send('Runtime.enable');

    /* 打开一关，并等到「可交互」（渲染完成 + 不忙） */
    async function openLevel(lv){
      await send('Page.navigate', { url: BASE + '?s=play&lv=' + lv + '&t=' + Date.now() });
      for (let i = 0; i < 60; i++){
        await sleep(200);
        const r = await evl(`(typeof G !== 'undefined')
          ? {n: document.querySelectorAll('#board .tile').length, busy: G.busy, act: document.getElementById('s-play').classList.contains('active')}
          : {n:0,busy:true,act:false}`);
        if (r.n > 0 && !r.busy && r.act) return r.n;
      }
      throw new Error('关卡 ' + lv + ' 未能在预期时间内就绪');
    }
    async function waitIdle(max = 30){
      for (let i = 0; i < max; i++){
        if (await evl(`!G.busy`)) return true;
        await sleep(150);
      }
      return false;
    }

    /* ============ ① 点击：已对齐的牌，点一下应消除 ============ */
    await openLevel(1);
    const clickPt = await evl(`(function(){
      const ts = allTiles();
      for (const a of ts) for (const b of ts){
        if (a !== b && canPair(a,b) && lineClear(a,b)){
          const r = a.el.getBoundingClientRect();
          return { x: r.left + r.width/2, y: r.top + r.height/2,
                   pair: a.char + '+' + b.char + '=' + pairWord(a,b), matched: G.stats.matched };
        }
      }
      return null;
    })()`);
    if (!clickPt){
      t('① 盘面存在已对齐的一对', false, true);
    } else {
      console.log('   已对齐：' + clickPt.pair);
      await mouse('mousePressed', clickPt.x, clickPt.y);
      await mouse('mouseReleased', clickPt.x, clickPt.y, { buttons: 0 });
      await sleep(900);
      t('① 点击已对齐的牌 → 成字数 +1', await evl(`G.stats.matched`), clickPt.matched + 1);
      t('① 一次操作只消一对（无自动连锁）', await evl(`G.stats.matched`) - clickPt.matched, 1);
    }

    /* ============ ② 拖动：只能沿本行/本列滑动，落点真的改变 ============ */
    await openLevel(1);
    const drag = await evl(`(function(){
      const board = document.getElementById('board').getBoundingClientRect();
      const xy = (r,c)=>({x: board.left + c*G.cell + G.cell/2, y: board.top + r*G.cell + G.cell/2});
      for (const tl of allTiles()){
        for (const cell of reachableCells(tl)){        // ★ 只在「真滑得到」的格子里挑
          // 只挑「挪过去不会立即成对」的落点，纯验滑动本身
          const oR=tl.r, oC=tl.c, oI=idxOf(tl), nI=cell.r*G.cols+cell.c;
          G.board[oI]=null; G.board[nI]=tl; tl.r=cell.r; tl.c=cell.c;
          const hit = matchTargets(tl).length;
          G.board[nI]=null; G.board[oI]=tl; tl.r=oR; tl.c=oC;
          if (hit) continue;
          window.__dragTile = tl;                       // 打标记：盘面上可能有同名牌
          const a = tl.el.getBoundingClientRect();
          return { from:{x:a.left+a.width/2, y:a.top+a.height/2}, to:xy(cell.r, cell.c),
                   head: tl.char, fromCell: tl.r+','+tl.c, toCell: cell.r+','+cell.c,
                   move: G.stats.move, alongRow: cell.r===tl.r, alongCol: cell.c===tl.c,
                   reachCount: reachableCells(tl).length };
        }
      }
      return null;
    })()`);
    if (!drag){
      t('② 找得到可用于纯挪动的可达空格', false, true);
    } else {
      console.log(`   拖动「${drag.head}」 ${drag.fromCell} → ${drag.toCell}（${drag.alongRow?'横向':'纵向'}滑动）`);
      t('② 落点与起点同行或同列（滑动约束）', drag.alongRow || drag.alongCol, true);
      await mouse('mousePressed', drag.from.x, drag.from.y);
      await sleep(60);
      // ★ 高亮的格子必须与真实可达集**逐个对上**。
      //   只比数量不够 —— markReachable 是按 cellbg 的 DOM 下标定位的，
      //   一旦映射错了，亮起的就是别的格子，那种「错误提示」比没有提示更糟。
      const reachInfo = await evl(`(function(){
        const d = G.drag; if (!d) return null;
        const bgs = document.getElementById('board').querySelectorAll('.cellbg');
        const marked = [];
        bgs.forEach((e,i)=>{ if (e.classList.contains('reach')) marked.push(Math.floor(i/G.cols)+','+(i%G.cols)); });
        const want = reachableCells(d.t).map(x=>x.r+','+x.c);
        marked.sort(); want.sort();
        return { marked: marked.join(' '), want: want.join(' '), same: marked.join('|')===want.join('|'), n: marked.length };
      })()`);
      t('② 拿起字牌 → 高亮的格子 = 真实可达集', reachInfo.same, true);
      console.log(`     高亮 ${reachInfo.n} 格：${reachInfo.marked}`);
      if (!reachInfo.same) console.log(`     ✗ 应为：${reachInfo.want}`);
      // 真实按住状态下抓一张图（用于评审「可滑动范围」的视觉）
      const rShot = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(PROJ, 'shots', 'reach.png'), Buffer.from(rShot.data, 'base64'));
      const N = 8;
      for (let i = 1; i <= N; i++){
        await mouse('mouseMoved', drag.from.x + (drag.to.x - drag.from.x) * i / N,
                                  drag.from.y + (drag.to.y - drag.from.y) * i / N);
        await sleep(40);
        if (i === 3){
          t('② 拖动中状态被接管（G.drag.moved）', await evl(`!!G.drag && G.drag.moved`), true);
          // ★ 必须查真实 DOM 位置 —— G 里 t.r/t.c 在拖动过程中不会更新，查它等于没查
          const snap = await evl(`(function(){const d=G.drag; if(!d) return null;
            const br=document.getElementById('board').getBoundingClientRect();
            const b=d.el.getBoundingClientRect();
            const cx=b.left+b.width/2-br.left, cy=b.top+b.height/2-br.top;
            const gc=Math.round((cx-G.cell/2)/G.cell), gr=Math.round((cy-G.cell/2)/G.cell);
            const offC=Math.abs((cx-G.cell/2)/G.cell-gc), offR=Math.abs((cy-G.cell/2)/G.cell-gr);
            return {gc:gc, gr:gr, homeR:d.homeR, homeC:d.homeC, snapped:offC<0.08&&offR<0.08};})()`);
          console.log(`     拖动中：牌在 (${snap.gr},${snap.gc})，起点 (${snap.homeR},${snap.homeC})`);
          t('② 拖动中牌被吸附在格点上（没有斜飘）', snap.snapped, true);
          t('② 拖动中牌始终与起点同行或同列', (snap.gr === snap.homeR) || (snap.gc === snap.homeC), true);
        }
      }
      await mouse('mouseReleased', drag.to.x, drag.to.y, { buttons: 0 });
      await sleep(800);
      t('② 拖动后「挪动次数」+1', await evl(`G.stats.move`), drag.move + 1);
      t('② 牌确实换了格子', await evl(`(function(){const t=window.__dragTile;
          return t ? (t.r+','+t.c)==='${drag.toCell}' : 'tile-lost';})()`), true);
      t('② 松手后可达高亮已清除', await evl(`document.querySelectorAll('#board .cellbg.reach').length`), 0);
    }

    /* —— markReachable 的「下标 → 格子」映射必须精确 ——
       它是按 cellbg 的 DOM 顺序（r*cols+c）定位的，错一位就会亮错格子。 */
    const mapOk = await evl(`(function(){
      const bgs = document.getElementById('board').querySelectorAll('.cellbg');
      const read = () => { const a=[]; bgs.forEach((e,i)=>{ if(e.classList.contains('reach')) a.push(Math.floor(i/G.cols)+','+(i%G.cols)); }); a.sort(); return a.join(' '); };
      const t = allTiles()[0];
      // 语义：标记 (t.r, range 内的每个 c) 与 (range 内的每个 r, t.c)，跳过自身
      const want = [];
      for (let c=0;c<G.cols;c++) if (c!==t.c) want.push(t.r+','+c);
      for (let r=0;r<G.rows;r++) if (r!==t.r) want.push(r+','+t.c);
      want.sort();
      markReachable({up:0, down:G.rows-1, left:0, right:G.cols-1}, t);
      const full = read();
      markReachable({up:1, down:1, left:3, right:5}, {r:1, c:4});   // 行1 → 只该亮 (1,3) 和 (1,5)
      const rowLit = read();
      markReachable(null);
      return { fullSame: full === want.join(' '), fullN: full ? full.split(' ').length : 0,
               wantN: want.length, want: want.join(' '), full: full, rowLit: rowLit };
    })()`);
    t('② 全盘范围 → 标记整行+整列（不含自身）', mapOk.fullSame, true);
    if (!mapOk.fullSame) console.log(`     实际：${mapOk.full}\n     应为：${mapOk.want}`);
    t('② 标记格数 = (列数-1)+(行数-1)', mapOk.fullN, mapOk.wantN);
    t('② 行范围 [3,5] 且自身在列 4 → 只亮 (1,3) 和 (1,5)', mapOk.rowLit, '1,3 1,5');
    t('② markReachable(null) → 全部清除', await evl(`document.querySelectorAll('#board .cellbg.reach').length`), 0);

    /* ============ ③ 核心玩法：拖一张牌过去凑成对 ============ */
    await openLevel(1);
    const sug = await evl(`(function(){
      const s = findSuggest();
      if (!s) return null;
      const board = document.getElementById('board').getBoundingClientRect();
      const a = s.tile.el.getBoundingClientRect();
      return { from:{x:a.left+a.width/2, y:a.top+a.height/2},
               to:{x: board.left + s.c*G.cell + G.cell/2, y: board.top + s.r*G.cell + G.cell/2 },
               head: s.tile.char, hit: s.hit.char, word: pairWord(s.tile, s.hit), matched: G.stats.matched };
    })()`);
    if (!sug){
      t('③ 存在「挪一步即可成对」的组合', false, true);
    } else {
      console.log(`   挪「${sug.head}」去凑「${sug.hit}」→ 应合成「${sug.word}」`);
      await mouse('mousePressed', sug.from.x, sug.from.y);
      await sleep(50);
      const N = 8;
      for (let i = 1; i <= N; i++){
        await mouse('mouseMoved', sug.from.x + (sug.to.x - sug.from.x) * i / N,
                                  sug.from.y + (sug.to.y - sug.from.y) * i / N);
        await sleep(40);
      }
      const preview = await evl(`!!G.drag && !!G.drag.hover`);
      t('③ 拖动到有效落点时高亮出搭档（落点预判）', preview, true);
      // 趁指针还没松开，抓一张「拖动中」的真实截图（比 demoDrag 造的假状态可信）
      const mid = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(PROJ, 'shots', 'drag.png'), Buffer.from(mid.data, 'base64'));
      await mouse('mouseReleased', sug.to.x, sug.to.y, { buttons: 0 });
      await sleep(1000);
      t('③ 挪过去后成功合成一个字', await evl(`G.stats.matched`), sug.matched + 1);
      t('③ 合成的正是目标字', await evl(`matchedWords.indexOf('${sug.word}') >= 0`), true);
    }

    /* ============ ④-1 约束一：斜着拖，也只能落在同行或同列 ============ */
    await openLevel(1);
    const diag = await evl(`(function(){
      const board = document.getElementById('board').getBoundingClientRect();
      for (const tl of allTiles()){
        for (let r=0;r<G.rows;r++) for (let c=0;c<G.cols;c++){
          if (tileAt(r,c)) continue;
          const dr = Math.abs(r-tl.r), dc = Math.abs(c-tl.c);
          if (dr===0 || dc===0) continue;                     // 只要「不同行也不同列」的斜向目标
          if (Math.max(dr,dc) < Math.min(dr,dc)*2) continue;   // 只要主轴明确（≥2 倍），轴锁定才不含糊
          window.__diagTile = tl; window.__diagFrom = {r:tl.r, c:tl.c};
          const a = tl.el.getBoundingClientRect();
          return { from:{x:a.left+a.width/2, y:a.top+a.height/2},
                   to:{x: board.left + c*G.cell + G.cell/2, y: board.top + r*G.cell + G.cell/2},
                   fromCell: tl.r+','+tl.c, target: r+','+c, axis: dc>dr?'h':'v' };
        }
      }
      return null;
    })()`);
    if (!diag){
      t('④-1 找得到斜向空格（用于验证禁止斜移）', false, true);
    } else {
      console.log(`   斜向拖：「${diag.fromCell}」的牌，鼠标硬指向斜角格 ${diag.target}（主轴=${diag.axis==='h'?'横向':'纵向'}）`);
      await mouse('mousePressed', diag.from.x, diag.from.y);
      await sleep(50);
      for (let i = 1; i <= 8; i++){
        await mouse('mouseMoved', diag.from.x + (diag.to.x - diag.from.x) * i / 8,
                                  diag.from.y + (diag.to.y - diag.from.y) * i / 8);
        await sleep(40);
      }
      await mouse('mouseReleased', diag.to.x, diag.to.y, { buttons: 0 });
      await sleep(700);
      const res = await evl(`(function(){const t=window.__diagTile, f=window.__diagFrom;
        return { cell: t.r+','+t.c, sameRow: t.r===f.r, sameCol: t.c===f.c };})()`);
      console.log(`   结果落在：${res.cell}`);
      t('④-1 斜向拖动后，牌仍与起点同行或同列', res.sameRow || res.sameCol, true);
      t('④-1 牌没有落到斜角格', res.cell === diag.target, false);
    }

    /* ============ ④-2 约束二：邻牌挡路，拖不过去 ============ */
    await openLevel(1);
    const blocked = await evl(`(function(){
      const board = document.getElementById('board').getBoundingClientRect();
      for (const tl of allTiles()){
        if (tl.c+1 >= G.cols) continue;
        if (!tileAt(tl.r, tl.c+1)) continue;            // 右侧紧邻有牌 → 右向被堵死
        window.__blockTile = tl; window.__blockFrom = tl.r+','+tl.c;
        const a = tl.el.getBoundingClientRect();
        const far = Math.min(G.cols-1, tl.c+3);
        return { from:{x:a.left+a.width/2, y:a.top+a.height/2},
                 to:{x: board.left + far*G.cell + G.cell/2, y: board.top + tl.r*G.cell + G.cell/2},
                 fromCell: tl.r+','+tl.c, move: G.stats.move };
      }
      return null;
    })()`);
    if (!blocked){
      t('④-2 找得到「右侧被邻牌堵住」的牌', false, true);
    } else {
      console.log(`   挡路测试：「${blocked.fromCell}」右侧紧邻有牌，仍向右硬拖`);
      await mouse('mousePressed', blocked.from.x, blocked.from.y);
      await sleep(50);
      for (let i = 1; i <= 8; i++){
        await mouse('mouseMoved', blocked.from.x + (blocked.to.x - blocked.from.x) * i / 8, blocked.from.y);
        await sleep(40);
      }
      await mouse('mouseReleased', blocked.to.x, blocked.to.y, { buttons: 0 });
      await sleep(600);
      t('④-2 被邻牌挡住 → 牌没有跨过去（停在原位）',
        await evl(`(function(){const t=window.__blockTile; return t.r+','+t.c;})()`), blocked.fromCell);
      t('④-2 被挡住时不计入挪动次数', await evl(`G.stats.move`), blocked.move);
      t('④-2 松手后拖动状态已清理', await evl(`!!G.drag`), false);
    }

    /* ============ ⑤ 入口全流程：启动页→首页→章节→地图→进关（真实点击） ============ */
    await send('Page.navigate', { url: BASE + '?t=' + Date.now() });
    let reached = false;
    for (let i = 0; i < 40; i++){
      await sleep(200);
      if (await evl(`document.getElementById('s-home').classList.contains('active')`)){ reached = true; break; }
    }
    t('⑤ 打开文件后自动进入首页', reached, true);

    // 点击元素中心的辅助函数（派发真实鼠标事件）
    async function clickEl(sel, idx){
      const r = await evl(`(function(){const es=document.querySelectorAll(${JSON.stringify(sel)});
        const e=es[${idx||0}]; if(!e) return null; const b=e.getBoundingClientRect();
        return {x:b.left+b.width/2, y:b.top+b.height/2};})()`);
      if (!r) return false;
      await mouse('mousePressed', r.x, r.y);
      await mouse('mouseReleased', r.x, r.y, { buttons: 0 });
      await sleep(450);
      return true;
    }

    await clickEl('#s-home .btn');
    t('⑤ 点「开始拆字」→ 进入章节选择', await evl(`document.getElementById('s-chap').classList.contains('active')`), true);

    await clickEl('#chap-list .chap');
    t('⑤ 点第一章 → 进入关卡地图', await evl(`document.getElementById('s-map').classList.contains('active')`), true);

    await clickEl('#map-wrap .node');
    let playOk = false;
    for (let i = 0; i < 25; i++){
      await sleep(200);
      playOk = await evl(`document.getElementById('s-play').classList.contains('active')
                          && document.querySelectorAll('#board .tile').length > 0`);
      if (playOk) break;
    }
    t('⑤ 点第 1 关 → 进入主玩法并出牌', playOk, true);

    /* ============ ⑥ 无 JS 异常 ============ */
    t('⑥ 全过程无 JS 异常', pageErrors.length, 0);
    if (pageErrors.length) console.log('   异常明细：', pageErrors.slice(0, 5));

    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(PROJ, 'shots', 'browser-live.png'), Buffer.from(shot.data, 'base64'));
    console.log('\n   实时截图已存 shots/browser-live.png');

  } catch (e) {
    fail++; console.log('❌ 测试执行失败：', e.message);
  } finally {
    try { ws && ws.close(); } catch(e){}
    try { chrome.kill('SIGKILL'); } catch(e){}
  }

  console.log(`\n===== 浏览器真实交互测试：${pass} 通过 / ${fail} 失败 =====`);
  clearTimeout(WATCHDOG);
  process.exit(fail ? 1 : 0);
})();
