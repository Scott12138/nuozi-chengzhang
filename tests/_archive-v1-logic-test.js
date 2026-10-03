/**
 * 拆字连连看 · 核心逻辑自测
 * 用法：node tests/logic-test.js
 *
 * 做法：从 prototype/index.html 中提取 <script>，注入最小 DOM 桩后在 vm 中执行，
 *      直接调用原型内的真实函数做验证（不是复制一份代码来测，避免测试与实现脱节）。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const htmlPath = path.join(__dirname, '..', 'prototype', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('未找到 <script> 块'); process.exit(1); }
const code = m[1];

/* ---------------- 最小 DOM 桩 ---------------- */
function el() {
  const node = {
    style: {}, dataset: {}, innerHTML: '', textContent: '', value: '',
    classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
    appendChild(){}, removeChild(){}, setAttribute(){}, getAttribute(){ return null; },
    addEventListener(){}, removeEventListener(){},
    querySelectorAll(){ return []; }, querySelector(){ return el(); },
    getBoundingClientRect(){ return { left:0, top:0, width:0, height:0 }; },
    onclick: null,
  };
  return node;
}
const documentStub = {
  getElementById(){ return el(); },
  querySelectorAll(){ return []; },
  querySelector(){ return el(); },
  createElement(){ return el(); },
  createElementNS(){ return el(); },
  body: el(),
};

const sandbox = {
  console,
  document: documentStub,
  window: {},
  location: { search: '' },          // boot 里读评审直达参数用
  URLSearchParams,                    // Node 全局可用
  setTimeout(){ return 0; },      // 阻断异步副作用
  clearTimeout(){},
  setInterval(){ return 0; },     // 阻断 boot 的加载条循环
  clearInterval(){},
  requestAnimationFrame(){ return 0; },
};
vm.createContext(sandbox);

/* ---------------- 测试代码（在原型作用域内执行） ---------------- */
const testCode = `
;(function(){
  const results = [];
  const t = (name, actual, expect) => {
    const ok = actual === expect;
    results.push({ name, ok, actual, expect });
  };

  /* ============ 1. 连通判定 ============ */
  CFG = { cols: 5, rows: 5 };

  // 1.1 相邻两张牌
  G.board = makeGrid(CFG);
  let a = { id:1, char:'木', x:0, y:0 }, b = { id:2, char:'仓', x:1, y:0 };
  G.board[0][0] = a; G.board[0][1] = b;
  t('相邻两牌可连通', !!findPath(a,b), true);

  // 1.2 同行中间是空格
  G.board = makeGrid(CFG);
  a = { id:1, char:'木', x:0, y:0 }; b = { id:2, char:'仓', x:4, y:0 };
  G.board[0][0] = a; G.board[0][4] = b;
  t('同行中间全空可连通(0折点)', !!findPath(a,b), true);

  // 1.3 同行中间有牌 → 仍可绕外圈
  G.board = makeGrid(CFG);
  const blk = { id:9, char:'疒', x:2, y:0, junk:true };
  G.board[0][0] = a; G.board[0][4] = b; G.board[0][2] = blk;
  t('同行被挡但可绕外圈 → 连通', !!findPath(a,b), true);

  // 1.4 1 折点
  G.board = makeGrid(CFG);
  a = { id:1, char:'木', x:0, y:0 }; b = { id:2, char:'仓', x:3, y:2 };
  G.board[0][0] = a; G.board[2][3] = b;
  const p14 = findPath(a,b);
  t('1 折点可连通', !!p14, true);
  t('1 折点路径点数=3', p14 ? p14.length : 0, 3);

  // 1.5 2 折点：候选拐点都被挡，必须走 Z 形
  CFG = { cols: 6, rows: 6 };
  G.board = makeGrid(CFG);
  a = { id:1, char:'木', x:0, y:1 }; b = { id:2, char:'仓', x:5, y:2 };
  G.board[1][0] = a; G.board[2][5] = b;
  G.board[0][2] = { id:8, char:'疒', x:2, y:0, junk:true };   // 挡上方
  G.board[1][1] = { id:9, char:'廴', x:1, y:1, junk:true };   // 挡左侧
  G.board[2][4] = { id:10,char:'彳', x:4, y:2, junk:true };   // 挡下方
  const p15 = findPath(a,b);
  t('2 折点可连通', !!p15, true);
  t('2 折点路径点数=4', p15 ? p15.length : 0, 4);

  // 1.6 被完全包围 → 不连通
  CFG = { cols: 5, rows: 5 };
  G.board = makeGrid(CFG);
  a = { id:1, char:'木', x:1, y:1 }; b = { id:2, char:'仓', x:3, y:1 };
  for (let y=0;y<5;y++) for (let x=0;x<5;x++){
    if (!((x===1&&y===1)||(x===3&&y===1))) G.board[y][x] = { id:100+x*10+y, char:'■', x, y, junk:true };
  }
  G.board[1][1] = a; G.board[1][3] = b;
  t('被完全包围 → 不连通', findPath(a,b) === null, true);

  /* ============ 2. 配对合法性 ============ */
  buildPairMap(LEVELS[0]);                        // 目标: 枪棍棒 / 彩蛋: 杖杵
  const m木 = { id:1, char:'木', junk:false, role:'radical' };
  const m仓 = { id:2, char:'仓', junk:false, role:'part' };
  const m昆 = { id:3, char:'昆', junk:false, role:'part' };
  const m木2 = { id:4, char:'木', junk:false, role:'radical' };
  const j1 = { id:5, char:'疒', junk:true, role:'junk' };
  const j2 = { id:6, char:'疒', junk:true, role:'junk' };
  const j3 = { id:7, char:'廴', junk:true, role:'junk' };

  t('木+仓 合法(=枪)', canPair(m木, m仓), true);
  t('仓+木 也合法(不区分顺序)', canPair(m仓, m木), true);
  t('木+木 不合法(同类型)', canPair(m木, m木2), false);
  t('木+昆 合法(=棍)', canPair(m木, m昆), true);
  t('同名废牌可互消', canPair(j1, j2), true);
  t('不同名废牌不可消', canPair(j1, j3), false);
  t('废牌 与 正常牌 不可消', canPair(j1, m木), false);
  t('pairWord(木,仓) = 枪', pairWord(m木, m仓), '枪');

  // 上下结构 / 形旁在右 的字：原型演示字库只含左右结构，这里补两条真实字库条目来验证规则
  WORDLIB['箭'] = { r:'竹', p:'前', py:'jiàn', gl:'搭在弓上发射的武器', st:'tb', tag:'兵器' };
  WORDLIB['鸽'] = { r:'合', p:'鸟', py:'gē',   gl:'鸽子',               st:'lr', tag:'飞禽' };

  const topLevel = { targets:['箭'], eggs:[] };   // 箭 = 竹 + 前（上下结构）
  buildPairMap(topLevel);
  t('上下结构 竹+前 合法(=箭)', canPair({char:'竹',junk:false},{char:'前',junk:false}), true);

  const rightLevel = { targets:['鸽'], eggs:[] }; // 鸽 = 合 + 鸟（形旁在右）
  buildPairMap(rightLevel);
  t('形旁在右 合+鸟 合法(=鸽)', canPair({char:'合',junk:false},{char:'鸟',junk:false}), true);
  t('形旁在右 鸟+合 也合法', canPair({char:'鸟',junk:false},{char:'合',junk:false}), true);

  /* ============ 3. 关卡生成器 · 可解性 ============ */
  buildPairMap(LEVELS[0]);            // ★ 必须重建：PAIRMAP 是全局单例，上面测鸽/箭时被覆盖了
  let allSolvable = true, allHasPair = true, failInfo = '';
  for (let i=0;i<120;i++){
    const lv = LEVELS[0];
    const grid = generateLevel(lv);
    G.board = grid;
    CFG = { cols: lv.cols, rows: lv.rows };
    buildPairMap(lv);
    if (!isSolvable(grid, CFG, lv)){ allSolvable = false; failInfo = '不可解 idx='+i; break; }
    if (findAllPairs().length === 0){ allHasPair = false; failInfo = '初始无可消组合 idx='+i; break; }
  }
  t('生成 120 次全部可解', allSolvable, true);
  t('生成 120 次初始都有可消组合', allHasPair, true);

  /* ============ 4. 牌数守恒 ============ */
  const lv0 = LEVELS[0];
  const pool = buildPool(lv0);
  const expectPool = (lv0.targets.length + lv0.eggs.length) * 2 + lv0.junkPairs * 2;
  t('牌池数量 = 目标*2 + 彩蛋*2 + 废牌对*2', pool.length, expectPool);
  t('牌池数量 <= 棋盘格数', pool.length <= lv0.cols*lv0.rows, true);

  /* ============ 5. 每张牌都有搭档(无死牌) ============ */
  // 目标字与彩蛋字都成对出现 → 每张牌必然能找到搭档
  buildPairMap(lv0);
  let everyTilePaired = true;
  G.board = generateLevel(lv0);
  CFG = { cols: lv0.cols, rows: lv0.rows };
  buildPairMap(lv0);
  for (const tl of allTiles()){
    // 初始局面下不一定立即连通，这里只校验"存在合法的搭档牌"
    const legalMate = allTiles().some(o => o.id!==tl.id && canPair(tl,o));
    if (!legalMate){ everyTilePaired = false; break; }
  }
  t('每张牌都有合法搭档(无死牌)', everyTilePaired, true);

  /* ============ 输出 ============ */
  let pass = 0, fail = 0;
  const lines = [];
  for (const r of results){
    if (r.ok) { pass++; lines.push('  ✅ ' + r.name); }
    else { fail++; lines.push('  ❌ ' + r.name + '  期望:' + r.expect + '  实际:' + r.actual); }
  }
  console.log('\\n===== 拆字连连看 · 核心逻辑自测 =====');
  console.log(lines.join('\\n'));
  console.log('\\n通过 ' + pass + ' / ' + (pass+fail));
  if (failInfo) console.log('失败线索: ' + failInfo);
  console.log('====================================\\n');
  if (fail > 0) throw new Error('存在未通过用例');
})();
`;

try {
  vm.runInContext(code + testCode, sandbox, { filename: 'prototype-inline.js', timeout: 30000 });
  process.exit(0);
} catch (e) {
  console.error('自测失败：', e.message);
  process.exit(1);
}
