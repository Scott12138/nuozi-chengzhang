/* ============================================================================
 * 挪字成章 · 水墨牌面（第三版核心）
 * ----------------------------------------------------------------------------
 * 【为什么单独做牌面】
 * 前两版都把力气花在「字的旁边长物象」上，两版都丑。第三版想明白了：
 * 问题不在物象画得好不好，而在**位置错了**。
 *
 *   一张牌只有 76px。字本身吃掉 80% 的面积，剩下的边角最多容纳几笔细线 ——
 *   而「一小条灰」在人眼里永远被读成「附肢 / 污渍」，不可能被读成「枝叶、火焰、花」。
 *   ★ 所以：物象不该是「字的配件」，应该是「牌的底子」。
 *     一张淡墨的画纸上写一个字，是水墨画；一个字旁边挂几笔，是贴纸。
 *
 * 顺带这也补上了需求的第一条：「把整体风格优化，设计成水墨画风格」——
 * 牌面本身就是一幅小水墨。
 *
 * 【留白悖论，顺手解掉】
 * 字形归一化时只留了 6.3% 的边。牌面上一张画布全被墨占满，就没有留白，
 * 也就没有水墨的「呼吸」。这里把字重新按自己的墨迹包围盒适配到 76% 的画心，
 * 留出四周的空白：76px 的牌上字仍有 58px 高，可辨认度毫发无损。
 *
 * 【★ 2026-10-03：部件要"靠边"】
 * 用户提的：「偏旁和部首要靠边，比如竹字头……要放在格子的上半部分，
 *           比如弓字，要靠格子的下半部分，类似的字体都要重新渲染」
 *
 * 于是牌面上画的字分两种，摆法不同：
 *
 *   ┌ 合成字（枪、箭、弩…）→ 居中满格 0.76。它就是"一个字"，本来就该占满。
 *   └ 部件（木、艹、弓、前…）→ 缩到满格的 PART_SCALE(0.72)，
 *                              再靠向它在合成字里占的那半边。
 *
 * 「靠哪半边」不是在这里猜的，是一份算出来的数据：design/tile-roles.js
 * （由 tools/gen-tile-roles.py 从真实字形测出来，含完整的推导与代价说明）。
 * 本文件只负责把那份数据翻译成坐标。
 *
 * ★ 为什么部件要缩到 0.72 而不是原地靠边：
 *   部件在合成字里本来就只有半边大。不缩的话，"木"贴左后仍是 76% 画心那么大，
 *   会顶到格子中线甚至越界；缩到 0.72 之后它只占本格约 55%，靠边才靠得住。
 *
 * 【层序】陈纸 → 帘纹 → 墨韵（景，柔） → 字（主，锐） → 印（气眼）
 *   景柔字锐 = 景深。上一版把物象画得又锐又小，那才是唯一的错。
 * ========================================================================== */
(function (root) {
  'use strict';

  var B = root.InkBrush;
  var V = 1000;

  /* ── 部件靠边的两个常量 ──
   * FIT       合成字占画心的比例（沿用旧值，一动就会牵动所有关卡的第一印象）
   * PART_SCALE 部件在 FIT 基础上的再缩比 —— 就是用户拍板的 0.72
   * PAD_EDGE  部件贴的那条边与格边之间的距离。62/1000 ≈ 6.2%，与字形的天然留边同量级，
   *           再小就会让笔画顶到格线上（牌面四周还有一圈飞白边）
   */
  var FIT = 0.76;
  var PART_SCALE = 0.72;
  var PAD_EDGE = 62;

  /* 稳定散列：同一张牌每次渲染必须长得一样，所以不能用 Math.random */
  function hash(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  /* ── 墨韵：纸上一笔扫过的淡墨。位置按字散列，让整盘牌有变化，不做成复制粘贴 ──
   * 每一张牌给「两笔」：一大一小、一主一次、分处两个角。
   * 只给一笔时画面是平的；给两笔才有前后远近，才是「画」。
   * 形状取「长扫」——圆心在牌外、扫过一角，这样墨是从边上洇进来的，
   * 而不是在纸中间凭空出现一个圆斑（那样读出来是霉点）。
   * 中心必须干净 —— 字要落在没被洇湿的地方，墨才不糊。 */
  var WASH = [
    { a: { cx: 96, cy: 118, rx: 620, ry: 214, ang: -26 }, b: { cx: 928, cy: 906, rx: 330, ry: 130, ang: -38 } },
    { a: { cx: 84, cy: 130, rx: 590, ry: 200, ang: 30 }, b: { cx: 906, cy: 884, rx: 356, ry: 142, ang: -22 } },
    { a: { cx: 906, cy: 112, rx: 604, ry: 208, ang: 28 }, b: { cx: 96, cy: 892, rx: 340, ry: 136, ang: 22 } },
    { a: { cx: 500, cy: 42, rx: 660, ry: 150, ang: -3 }, b: { cx: 512, cy: 962, rx: 600, ry: 152, ang: 2 } },
    { a: { cx: 108, cy: 918, rx: 610, ry: 212, ang: 24 }, b: { cx: 900, cy: 120, rx: 348, ry: 138, ang: 36 } },
    { a: { cx: 924, cy: 892, rx: 630, ry: 218, ang: -28 }, b: { cx: 104, cy: 132, rx: 334, ry: 130, ang: -20 } }
  ];

  /* ── 印章：右下角。76px 的牌上它只是一个小红点 —— 那正是「惜色如金」的效果 ── */
  function seal(ch, x, y, s, op) {
    var inner = root.InkGlyphs && root.InkGlyphs.has('章') ? root.InkGlyphs.path('章') : '';
    var box = (root.InkGlyphs && root.InkGlyphs.box('章')) || [0, 0, 1000, 1000];
    var w = box[2] - box[0], h = box[3] - box[1];
    var k = (s - s * 0.26) / Math.max(w, h);
    /* 印章里是「白文」：朱砂底、纸色的字 —— 所以字用纸色画在朱砂方上 */
    return '<g opacity="' + op + '">' +
      '<rect x="' + x + '" y="' + y + '" width="' + s + '" height="' + s + '" rx="' + (s * 0.07) +
        '" fill="#9c2b21" fill-opacity=".88" filter="url(#feiBai)"/>' +
      (inner ? '<g transform="translate(' + (x + s / 2) + ',' + (y + s / 2) + ') scale(' + k.toFixed(4) + ') ' +
        'translate(' + (-(box[0] + w / 2)).toFixed(1) + ',' + (-(box[1] + h / 2)).toFixed(1) + ')">' +
        '<path d="' + inner + '" fill="#f3eee1"/></g>' : '') +
      '</g>';
  }

  /**
   * @param ch   字
   * @param opt  { style:'bai'|'ge'  牌面式样
   *               wash:true|false    是否要墨韵
   *               seal:true|false    是否要印章
   *               fit:0.76           字占画心的比例（部件会在此基础上再乘 PART_SCALE）
   *               role:'t'|'b'|'l'|'r'|'c'   显式指定靠哪半边（不传 = 听 design/tile-roles.js）
   *               part:true|false    显式指定"这是部件"（不传 = 听表；表里没有的一律算合成字）
   *               seed:0             额外扰动（同一字要不同效果时用） }
   * @returns    可直接塞进 <svg viewBox="0 0 1000 1000"> 的内容
   *
   * ★ role / part 两个参数**只给试样图与调试用**。烘焙贴图时不传，
   *   让每一张牌的角色唯一地来自 design/tile-roles.js —— 少一个能写歪的地方。
   */
  function svg(ch, opt) {
    opt = opt || {};
    var style = opt.style || 'bai';
    var useWash = opt.wash !== false;
    var useSeal = opt.seal !== false;
    var fit = opt.fit == null ? FIT : opt.fit;
    var seed = opt.seed || 0;

    var h = hash(ch) + seed * 7919;
    var s = [];
    s.push('<rect width="1000" height="1000" fill="#f3eee1"/>');
    /* 纸：先不平的明暗，再帘纹 */
    s.push('<rect width="1000" height="1000" filter="url(#chenZhi)"/>');
    s.push('<rect width="1000" height="1000" filter="url(#xianWei)"/>');

    /* 墨韵：景 —— 两笔，极淡，柔 */
    if (useWash) {
      var w = WASH[h % WASH.length];
      var opA = 0.15 + ((h >> 5) % 6) * 0.018;          // 主团 0.150 ~ 0.240
      var opB = opA * (0.62 + ((h >> 11) % 4) * 0.09);  // 次团一直是主团的六到九成
      s.push('<g filter="url(#moYun)">' +
        '<ellipse cx="' + w.a.cx + '" cy="' + w.a.cy + '" rx="' + w.a.rx + '" ry="' + w.a.ry +
        '" transform="rotate(' + w.a.ang + ' ' + w.a.cx + ' ' + w.a.cy + ')" fill="url(#yunGrad)" opacity="' + opA.toFixed(3) + '"/>' +
        '<ellipse cx="' + w.b.cx + '" cy="' + w.b.cy + '" rx="' + w.b.rx + '" ry="' + w.b.ry +
        '" transform="rotate(' + w.b.ang + ' ' + w.b.cx + ' ' + w.b.cy + ')" fill="url(#yunGrad)" opacity="' + opB.toFixed(3) + '"/>' +
        '</g>');
    }

    /* 格线：书法练习纸的淡墨边框 —— 既给玩法明确的边界，本身也是国画语言。
       76px 时它会细到几乎看不见，所以只在大牌上起作用，小牌上退成一点灰边。 */
    if (style === 'ge') {
      s.push('<g opacity=".5">' +
        '<rect x="66" y="66" width="868" height="868" fill="none" stroke="#8e8b80" stroke-width="3"/>' +
        '<rect x="82" y="82" width="836" height="836" fill="none" stroke="#8e8b80" stroke-width="1.4" opacity=".7"/>' +
        '</g>');
    }

    /* 字：主 —— 按自己的墨迹包围盒适配到画心，保证每张牌的「视觉字号」一致 */
    var box = (root.InkGlyphs && root.InkGlyphs.box(ch)) || [63, 63, 937, 937];
    var bw = Math.max(1, box[2] - box[0]), bh = Math.max(1, box[3] - box[1]);
    var d = (root.InkGlyphs && root.InkGlyphs.path(ch)) || '';

    /* ── 角色：这张牌上画的是「合成字」还是「部件」？ ──
     * 表在 design/tile-roles.js（随本文件一起被 make-tile-atlas.py 读入）。
     * 表不在时（比如某些只载了 glyphs 的旧页面）退化成旧的居中满格 —— 不报错、不白屏。
     * opt.part / opt.role 是给试样图用的显式覆盖：不传就完全听表的。 */
    var TR = root.TileRoles;
    var tabled = !!(TR && TR.has && TR.has(ch));                  // 表里说它是"部件"
    var isPart = (opt.part == null) ? tabled : !!opt.part;
    var role = opt.role || (tabled ? TR.role(ch) : 'c');

    var k = (V * fit) / Math.max(bw, bh) * (isPart ? PART_SCALE : 1);
    var gw = bw * k, gh = bh * k;
    var gx, gy;
    if (role === 't') { gx = (V - gw) / 2; gy = PAD_EDGE; }
    else if (role === 'b') { gx = (V - gw) / 2; gy = V - PAD_EDGE - gh; }
    else if (role === 'l') { gx = PAD_EDGE; gy = (V - gh) / 2; }
    else if (role === 'r') { gx = V - PAD_EDGE - gw; gy = (V - gh) / 2; }
    else { gx = (V - gw) / 2; gy = (V - gh) / 2; }        /* 'c'：居中 */

    var dx = gx - box[0] * k;
    var dy = gy - box[1] * k;

    /* ── 偏旁形态：字体里没有这个偏旁的码位时，靠裁剪合成 ──
     * 目前只有「竹」。做罗马善政（Ma Shan Zheng）7015 个码位里**没有** ⺮（U+2EAE），
     * 而整字「竹」跟竹字头差得肉眼认不出 —— 用户原话「不要以竹字来表示，别人看不懂」。
     * 系统的宋体有真 ⺮，但系统字体不可随产品分发（详见 docs 里的字库说明），
     * 所以走「把竹的下半截裁掉」这条路。
     *
     * ★ clipPath 挂在**内层** g 上：内层 g 的坐标系是字形坐标（外层 transform 之后再作用），
     *   于是裁切矩形可以直接用 box 的单位写，不用先乘 k 再换算。
     * ★ id 里带 hash，避免同一页渲染多张牌时几个 clipPath 互相顶掉。 */
    var crop = (TR && TR.crop) ? TR.crop(ch) : null;
    var clipId = '';
    if (crop && crop.from === 'top') {
      clipId = 'clip' + (hash(ch) >>> 0).toString(36);
      s.push('<defs><clipPath id="' + clipId + '"><rect x="' + (box[0] - 200) + '" y="' +
        (box[1] - 200) + '" width="' + (bw + 400) + '" height="' +
        (bh * crop.keep + 200).toFixed(1) + '"/></clipPath></defs>');
    }

    /* 兜底描边：给「用系统字体补出来的字」（origin === 'songti'）描一道同色边。
       宋体笔画明显比毛笔楷书细，并排一眼能看出不是同一支笔，描边把视觉重量补回来。

       ★ 2026-10-02 之后这条分支**已经打不到了** —— 用户拍板把靠系统宋体补字的
         `罒`（原原型 JUNK_CHARS）与 `匸`（JUNK_POOL 候选）都清掉了，
         `design/glyphs-data.js` 现在 100% 出自马善政（origin 只有 'msj'）。
       代码保留不是疏漏：它是"有人日后又往目标集合里塞了生僻字"的**可视告警** ——
       一旦重新出现 songti 字形，牌面立刻会显出两种笔触，比看日志更容易发现。
       真要清干净，请去 tools/build-glyphs.py 处理目标集合，而不是删掉这里。 */
    var thin = root.InkGlyphs && root.InkGlyphs.origin && root.InkGlyphs.origin[ch] === 'songti';
    s.push('<g transform="translate(' + dx.toFixed(1) + ',' + dy.toFixed(1) + ') scale(' + k.toFixed(4) + ')">' +
      (clipId ? '<g clip-path="url(#' + clipId + ')">' : '') +
      '<path d="' + d + '" fill="url(#moGrad)" filter="url(#inkMo)"' +
      (thin ? ' stroke="url(#moGrad)" stroke-width="30" stroke-linejoin="round" stroke-linecap="round"' : '') +
      '/>' + (clipId ? '</g>' : '') + '</g>');

    /* 印：右下角的气眼 */
    if (useSeal) s.push(seal(ch, 848, 848, 100, 0.92));

    return s.join('');
  }

  root.InkTile = {
    svg: svg,
    WASH: WASH,
    hash: hash,
    styleList: ['bai', 'ge']
  };
})(typeof window !== 'undefined' ? window : this);
