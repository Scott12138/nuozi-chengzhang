/* ============================================================================
 * 挪字成章 · 写意笔触引擎（毛笔笔触）
 * ----------------------------------------------------------------------------
 * 为什么要引擎而不是手写 path：
 *   一个字要配 2~4 笔物象（根须、枝叶、枪头、红缨…），全项目上百笔。
 *   手写 path 必然风格越画越散，而且「把笔画改粗一点」要动上百处。
 *   引擎把「笔意」参数化：中心线 + 宽度曲线 + 出锋 + 渐隐 + 侧锋。
 *
 * 一根笔触由四件事决定：
 *   ① 中心线   —— 折线控制点，自动过 Catmull-Rom 平滑
 *   ② 宽度曲线 —— 起笔顿 / 行笔提按 / 收笔出锋（收锋处宽度收到 0，才是尖）
 *   ③ 侧锋     —— 中锋两侧宽度不等，笔才有「势」
 *   ④ 墨色     —— 起笔墨浓、收笔墨淡（蘸一次墨写到底）
 * ========================================================================== */
(function (root) {
  'use strict';

  var VIEW = 1000;

  function f(v) { return Math.round(v * 10) / 10; }

  /* ───────────────────────────── 宽度曲线预设 ───────────────────────────── */
  /* t ∈ [0,1]，返回半宽系数（1 = 设定宽度的满值） */
  var PROFILE = {
    /* 起笔顿 → 行笔匀 → 收笔出锋成尖。最像「一撇」 */
    pie: function (t) {
      if (t < 0.08) return 0.42 + 7.25 * t;            // 起笔一顿，迅速铺开
      if (t < 0.58) return 1 - 0.09 * (t - 0.08) / 0.5;
      return Math.max(0.02, 0.91 * (1 - Math.pow((t - 0.58) / 0.42, 1.25)));  // 出锋
    },
    /* 两头尖、中段饱 —— 叶子、花瓣、缨穗 */
    ye: function (t) { return Math.pow(Math.sin(Math.PI * t), 0.55); },
    /* 起笔重、一路收到尖 —— 根须、草叶、细枝 */
    xu: function (t) { return Math.max(0.03, Math.pow(1 - t, 0.85) * (1 - Math.exp(-14 * t))); },
    /* 两头略收、中段匀 —— 枪杆、竹竿这类「杆」 */
    gan: function (t) { return 0.72 + 0.28 * Math.pow(Math.sin(Math.PI * t), 0.4); },
    /* 点：起笔轻、按下去、提起来 */
    dian: function (t) { return Math.pow(Math.sin(Math.PI * Math.pow(t, 0.78)), 0.7); },
    /* 细丝：整体很细，末端几乎消失 */
    si: function (t) { return Math.max(0.02, 0.55 * Math.pow(1 - t, 0.6) * (1 - Math.exp(-18 * t))); },

    /* ★ 枝 / 根：起笔一顿 → 迅速铺开 → 缓收 → 末梢出锋成尖。
     *   为什么不用 xu：xu = pow(1-t, 0.85) 是指数衰减，长一点就瘦成一根线。
     *   实测木的根须（长 203）在 t=0.8 处只剩 13 单位宽 —— 76px 的牌面上是 1 个像素，
     *   渲染出来就是「细worm」。指数改 0.42 后同一位置有 26 单位，才立得住。 */
    zhi: function (t) {
      return Math.max(0.05, Math.pow(1 - t, 0.42) * Math.min(1, 0.55 + t * 5));
    },
    /* ★ 侧锋叶：贴笔处饱满、一路出锋。必须配 asym 用（一侧平、一侧鼓），
     *   否则对称纺锤 = 橄榄 = 眉毛。叶子的「势」全在侧锋上。 */
    ce: function (t) {
      return Math.max(0.04, Math.pow(1 - t, 0.62) * Math.min(1, 0.30 + t * 5));
    }
  };

  /* ───────────────────────────── 中心线平滑 ───────────────────────────── */
  /* Catmull-Rom 重采样：把 3~5 个控制点变成 40+ 个点，边缘才顺 */
  function resample(pts, seg) {
    seg = seg || 12;
    if (pts.length < 2) return pts.slice();
    var P = [pts[0]].concat(pts, [pts[pts.length - 1]]);
    var out = [];
    for (var i = 1; i < P.length - 2; i++) {
      var p0 = P[i - 1], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2];
      for (var j = 0; j < seg; j++) {
        var t = j / seg, t2 = t * t, t3 = t2 * t;
        out.push({
          x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t +
                    (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
                    (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
          y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t +
                    (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
                    (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
        });
      }
    }
    out.push(P[P.length - 2]);
    return out;
  }

  /* 用「中点 + 二次贝塞尔」把点串平滑连起来 */
  function smooth(pts) {
    var n = pts.length;
    if (n === 0) return '';
    if (n === 1) return 'M' + f(pts[0].x) + ' ' + f(pts[0].y);
    var d = 'M' + f(pts[0].x) + ' ' + f(pts[0].y);
    for (var i = 1; i < n - 1; i++) {
      var mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
      d += 'Q' + f(pts[i].x) + ' ' + f(pts[i].y) + ' ' + f(mx) + ' ' + f(my);
    }
    d += 'L' + f(pts[n - 1].x) + ' ' + f(pts[n - 1].y);
    return d;
  }

  /* ───────────────────────────── 生成笔触轮廓 ───────────────────────────── */
  /**
   * @param pts    中心线控制点数组 [{x,y},...]
   * @param opt    { w:半宽, profile:预设名或函数, asym:侧锋倾斜, seg, taperStart }
   * @returns      {'d': 路径, 'a': 起点, 'b': 终点}
   */
  function stroke(pts, opt) {
    opt = opt || {};
    var w = opt.w || 8;
    var prof = typeof opt.profile === 'function' ? opt.profile : (PROFILE[opt.profile] || PROFILE.pie);
    var asym = opt.asym == null ? 0 : opt.asym;   // -1..1，正值表示笔肚偏左
    var seg = opt.seg || 14;

    var c = resample(pts, seg);
    var n = c.length;
    if (n < 2) return { d: '', a: c[0], b: c[0] };

    var L = [], R = [];
    for (var i = 0; i < n; i++) {
      var t = i / (n - 1);
      /* 切线：用前后点差分，端点用单侧 */
      var p0 = c[Math.max(0, i - 1)], p1 = c[Math.min(n - 1, i + 1)];
      var tx = p1.x - p0.x, ty = p1.y - p0.y;
      var len = Math.hypot(tx, ty) || 1;
      var nx = -ty / len, ny = tx / len;           // 法线

      var hw = w * prof(t);
      var wl = hw * (1 + asym), wr = hw * (1 - asym);
      L.push({ x: c[i].x + nx * wl, y: c[i].y + ny * wl });
      R.push({ x: c[i].x - nx * wr, y: c[i].y - ny * wr });
    }

    var d = smooth(L);
    var rb = R.slice().reverse();
    d += smooth(rb).replace(/^M/, 'L');
    d += 'Z';

    return { d: d, a: c[0], b: c[n - 1] };
  }

  /* ───────────────────────────── 墨色 ───────────────────────────── */
  /* ★ 铁律：淡墨是「墨加水」，不是「灰色」。
   *
   * 上一版把淡墨写成 #666b74 —— 这是个蓝调冷灰（b=116 > r=102）。压在米黄宣纸上
   * 渲染出来是水泥/橡皮泥的颜色，一眼假。这就是「灰虫子」的色源。
   *
   * 正确算法：淡墨 = 纸色 × (1-α) + 墨色 × α。取纸 #f4f0e4、墨 #14161a：
   *   α=0.72 → #535352（重墨）   α=0.55 → #797875（淡墨）   α=0.38 → #9f9d97（清墨）
   * 三者的 r/g/b 基本相等且 b 略低 —— 暖中性，不带一丝蓝。 */
  var TONE = {
    jiao:  '#0e1012',   // 焦墨（最浓，只用于画眼级别的重笔）
    nong:  '#1c1e20',   // 浓墨
    zhong: '#535352',   // 重墨
    dan:   '#797875',   // 淡墨（暖中性）
    qing:  '#9f9d97',   // 清墨（最淡）
    zhu:   '#9e2b22',   // 朱砂（画眼，全图只点一两处）
    teng:  '#b8862b'    // 藤黄
  };

  var _gid = 0;

  /**
   * 把笔触包成可直接放进 SVG 的元素。
   * fade='tail' 时用沿笔轴的线性渐变，做「墨将尽」的渐隐。
   */
  function strokeEl(pts, opt) {
    opt = opt || {};
    var s = stroke(pts, opt);
    var tone = TONE[opt.tone || 'dan'] || opt.color || TONE.dan;
    var fill = tone, defs = '';
    if (opt.fade && opt.fade !== 'none') {
      var id = 'bg' + (++_gid);
      var a = s.a, b = s.b;
      var head = opt.fade === 'tail' ? tone : 'transparent';
      var tail = opt.fade === 'tail' ? 'transparent' : tone;
      defs = '<linearGradient id="' + id + '" gradientUnits="userSpaceOnUse" ' +
             'x1="' + f(a.x) + '" y1="' + f(a.y) + '" x2="' + f(b.x) + '" y2="' + f(b.y) + '">' +
             '<stop offset="0" stop-color="' + head + '"/>' +
             '<stop offset="' + (opt.fadeHold == null ? 0.45 : opt.fadeHold) + '" stop-color="' + tone + '"/>' +
             '<stop offset="1" stop-color="' + tail + '"/></linearGradient>';
      fill = 'url(#' + id + ')';
    }
    var op = opt.opacity == null ? 1 : opt.opacity;
    var blur = opt.blur ? ' filter="url(#' + opt.blur + ')"' : '';
    var el = '<path d="' + s.d + '" fill="' + fill + '" opacity="' + op + '"' + blur + '/>';
    return defs ? '<defs>' + defs + '</defs>' + el : el;
  }

  root.InkBrush = {
    VIEW: VIEW,
    TONE: TONE,
    PROFILE: PROFILE,
    stroke: stroke,
    strokeEl: strokeEl,
    resample: resample
  };
})(typeof window !== 'undefined' ? window : this);
