/**
 * ============================================================
 *  UIFactory.ts · 代码建 UI 的工具箱
 * ============================================================
 *  本项目走「代码驱动 UI」：场景文件里一个界面元素都没有，全部运行时创建。
 *  三个理由：
 *    ① 命令行无头构建下，场景里挂的脚本组件会被静默丢弃（见 Bootstrap.ts）；
 *    ② 零贴图 UI → 微信首包体积几乎全由引擎决定，好控；
 *    ③ 布局常量与代码同处一文件，改数值不用开编辑器。
 *
 *  ⚠️ 所有节点都要显式设 `layer = Layers.Enum.UI_2D`：
 *     默认 layer 是 DEFAULT，而 Canvas 下的相机只渲染 UI_2D —— 漏设的节点**不报错、直接不显示**。
 *
 *  ⚠️ 颜色一律走 CFG.COLOR，**本文件与页面文件里都不许出现裸色值**。
 *     色板是设计稿的 :root，改色只改 CFG 一处。
 *
 *  ────────────────────────────────────────────────────────────
 *  【Graphics 没有渐变，怎么做出设计稿的渐变】
 *  设计稿的渐变全是 CSS 的 linear/radial-gradient。Cocos 的 Graphics 只有纯色，
 *  但没有关系 —— 关键事实是：
 *      **一个 Graphics 组件 = 一个 draw call，不管里面 fill() 了多少次**
 *      （多次 fill() 只是往同一个 mesh 追加顶点）。
 *  所以「用 N 条色带拼出渐变」的代价只是顶点数，不影响 draw call。
 *  本文件里所有 mk*Grad* 都是这么做的，N 取 16~40，肉眼看不出分层。
 *
 *  圆角 + 渐变一起要时有个坑：色带是全宽的矩形，直接铺进圆角框会**盖掉圆角**。
 *  做法（mkGradPanel）：
 *      ① 先用中间色填满整个圆角矩形 → 四个角是实的；
 *      ② 中段（上下各让出 r）全宽铺插值色带 → 渐变主体；
 *      ③ 上/下两端的 r 高度各补一条纯色带，水平内缩 r/2 → 不碰圆角。
 * ============================================================
 */

import { Color, Graphics, Label, Layers, Node, Sprite, UITransform, Widget, view } from 'cc';
import { CFG, px } from '../CFG';
import { loadSprite } from './TileAtlas';

/**
 * 引擎当前可见尺寸（设计单位）。
 *
 * 设计分辨率是 720×1280 且 fitWidth=true —— 也就是说**宽度恒为 720，
 * 高度随机型变**（越长的屏可见高度越大）。所以：
 *   · 横向排版可以安心按 720 算；
 *   · 纵向的"底部按钮/安全区"必须按实际高度排，否则长屏上会飘在中间。
 * 取一次就缓存，免得每个页面各调一次（它是纯读，但也没必要重复问引擎）。
 */
let _vs: { w: number; h: number } | null = null;
export function visibleSize(): { w: number; h: number } {
    if (!_vs) {
        const s = view.getVisibleSize();
        _vs = { w: Math.round(s.width) || 720, h: Math.round(s.height) || 1280 };
    }
    return _vs;
}

/** 新建一个带 UITransform 的 UI 节点 */
export function mkNode(name: string, parent: Node, w = 0, h = 0): Node {
    const n = new Node(name);
    n.layer = Layers.Enum.UI_2D;
    const t = n.addComponent(UITransform);
    if (w || h) t.setContentSize(w, h);
    parent.addChild(n);
    return n;
}

/** 改尺寸（节点必须已有 UITransform） */
export function setSize(n: Node, w: number, h: number): void {
    n.getComponent(UITransform)!.setContentSize(w, h);
}

/** 挪位置（相对父节点锚点） */
export function setPos(n: Node, x: number, y: number): void {
    n.setPosition(x, y, 0);
}

/** 让节点铺满父节点，并跟随尺寸变化 */
export function fill(n: Node, all = 0): void {
    const w = n.addComponent(Widget);
    w.isAlignTop = w.isAlignBottom = w.isAlignLeft = w.isAlignRight = true;
    w.top = w.bottom = w.left = w.right = all;
    w.alignMode = Widget.AlignMode.ALWAYS;
    w.updateAlignment();
}

/** 十六进制色 → cc.Color（统一入口，避免各处 new Color().fromHEX 写错） */
export function hex(s: string, alpha = 255): Color {
    const c = new Color();
    c.fromHEX(s.length === 7 ? s : '#' + s);
    c.a = alpha;
    return c;
}

/** 两个颜色之间插值（t=0 → a，t=1 → b）。alpha 一起插 */
export function lerpColor(a: Color, b: Color, t: number): Color {
    return new Color(
        Math.round(a.r + (b.r - a.r) * t),
        Math.round(a.g + (b.g - a.g) * t),
        Math.round(a.b + (b.b - a.b) * t),
        Math.round(a.a + (b.a - a.a) * t),
    );
}

/**
 * 去饱和（近似 CSS 的 `filter:grayscale(k)`）。
 *
 * 【为什么要它】
 * 设计稿的锁定态是 `.chap.locked{opacity:.5;filter:grayscale(.7)}`。
 * 透明度好办（整块挂 UIOpacity 即可，子节点会一起乘），但 Graphics **没有滤镜**。
 * 好在锁定卡里真正"有颜色"的只有两处：左边缘的朱砂→藤黄竖条、以及藤黄星级。
 * 把这两处提前按 grayscale 混成灰，剩下的墨字/白底本来就没饱和度 ——
 * 合起来与真加滤镜几乎一致，成本是零。
 *
 * 算法用 Rec.709 亮度权重（与浏览器 filter 的实现一致）：
 *     lum = 0.2126R + 0.7152G + 0.0722B
 *     out = src × (1−k) + lum × k
 */
export function desat(s: string, k: number): string {
    const c = new Color();
    c.fromHEX(s.length === 7 ? s : '#' + s);
    const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    const mix = (v: number): number => Math.round(v * (1 - k) + lum * k);
    const h = (v: number): string => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0');
    return '#' + h(mix(c.r)) + h(mix(c.g)) + h(mix(c.b));
}

/**
 * 顶部坐标 → 节点局部 y。
 *
 * 排版时人想的是「距屏幕顶多少像素」，而 Cocos 的原点是画布中心、y 轴朝上。
 * 每次手算 `visH/2 - top` 迟早会在某处漏掉负号，所以收成一个函数。
 */
export function topY(visibleH: number, top: number): number {
    return visibleH / 2 - top;
}

/**
 * 顶部安全区（实现px）：顶栏第一行内容距屏幕顶的距离。
 *
 * 设计稿的 16px 是画在浏览器"手机壳"里的；真机上这段高度落在状态栏 /
 * 灵动岛内，微信右上角的胶囊也压在同一行。取值理由见 CFG.LAYOUT.SAFE_TOP。
 *
 * ⚠️ 这是**顶栏第一行内容**的上沿，不是"顶栏容器的上沿"。
 *    页面里写法应当是 `const TOP_PAD_T = safeTop();`（替换掉原来的 px(16)），
 *    而不是在 px(16) 上再加 safeTop()。
 */
export function safeTop(): number {
    return px(CFG.LAYOUT.SAFE_TOP);
}

/**
 * 顶栏固定的页面：把内容块放进「顶栏之下」的剩余空间里**垂直居中**。
 *
 * @param visibleH 屏幕可见高（实现px）
 * @param topFixed 顶栏（及其下方固定块，如 .map-info）的总高，即内容块不得侵入的高度
 * @param contentH 内容块自身的高度
 * @returns 内容块上沿距屏幕顶的距离（实现px），可直接喂给 topY()
 *
 * 【为什么要有这个函数】
 * 设计稿的列表页是「顶锚 + 底部留白」（原型 `.chap-list{flex:1;overflow-y:auto}`），
 * 设计舞台 745 高时底部留白尚可接受；但真机可见高 781，多出来的空间**全部堆在底部**，
 * 整页看起来"整体偏上"。用户 2026-10-02 拍板：顶栏不动，其下内容块上下居中。
 *
 * 【装不下时怎么办】
 * free ≤ 0 时返回 topFixed（退化为顶锚），**不产生负偏移** ——
 * 内容比可用空间高时应当可滚动或直接溢出，而不是被上移切掉一截。
 * 地图页那种"装不下要滚动"的场景，仍走它自己的滚动逻辑。
 */
export function centerBlockTop(visibleH: number, topFixed: number, contentH: number): number {
    const free = visibleH - topFixed - contentH;
    return free > 0 ? topFixed + free / 2 : topFixed;
}

// ============================================================
//  纸 / 渐变
// ============================================================

/**
 * 页面底：宣纸径向渐变（设计稿 `.phone` 的 background）。
 * CSS 是 `radial-gradient(120% 80% at 50% 0%, #FCF8EF 0%, #F6F0E2 45%, #EDE4D2 100%)`
 * —— 亮点在顶部中央，向下变深。Graphics 做不了径向，用竖向色带近似：
 * 在 720 宽的屏上，这个径向在水平方向的差异远小于竖直方向，竖向带完全够用。
 *
 * `fiber = true` 时再叠一层纸纤维（设计稿 `.phone::before` 的两组 repeating-linear-gradient）。
 * 它极其淡（alpha .038~.05），但正是这一层让"纯色块"读成"纸"。
 */
export function mkPaperBG(parent: Node, w: number, h: number,
                          top: string, mid: string, bot: string,
                          fiber = true, midAt = 0.45): Node {
    const n = mkNode('paper', parent, w, h);
    const g = n.addComponent(Graphics);

    const cTop = hex(top), cMid = hex(mid), cBot = hex(bot);
    const BANDS = 36;
    const bh = h / BANDS;
    for (let i = 0; i < BANDS; i++) {
        const t = (i + 0.5) / BANDS;
        const c = t < midAt ? lerpColor(cTop, cMid, t / midAt)
            : lerpColor(cMid, cBot, (t - midAt) / (1 - midAt));
        g.fillColor = c;
        // 高度 +1 消除相邻色带之间因取整产生的缝（比逐带四舍五入更稳）
        g.rect(-w / 2, h / 2 - (i + 1) * bh, w, bh + 1);
        g.fill();
    }

    if (fiber) {
        // 纸纤维：横向细线，每 5px 一条，alpha 13（≈.05）。同属一个 Graphics，不增 draw call。
        g.fillColor = hex('#96825f', 13);
        for (let y = -h / 2; y < h / 2; y += 5) {
            g.rect(-w / 2, y, w, 1);
        }
        g.fill();
    }
    return n;
}

/**
 * 圆角 + 竖向渐变面板（主按钮 / 印章 / 字块 / 金底卡都用它）。
 * `radius = 0` 时退化为纯色带（章节卡左侧竖条那种）。
 *
 * ────────────────────────────────────────────────────────────
 * 【★ 2026-10-02 修掉的"棱角"bug —— 色带在圆角处戳出方块】
 *  旧写法分三步：
 *      ① 中间色填满整个圆角矩形；
 *      ② 中段（上下各让出 r）铺全宽插值色带；
 *      ③ 上下两端各补一条纯色带，宽度写的是 `w − r`、水平内缩 `r/2`。
 *  ① 和 ② 是对的，**问题全在 ③**：
 *      圆角矩形在**最顶边**的实心范围只有 `[−w/2+r, w/2−r]`，
 *      而这条带子是 `[−w/2+r/2, w/2−r/2]` —— 左右**各戳出 r/2**。
 *  按钮 r = 29 实现px，就是每侧戳出约 14.5px。表现：
 *      · 「开始拆字」按钮的左上/左下/右上/右下角各露出一块方角；
 *      · 「木＋仓＝枪」三个字块的四角发方（用户截图里一眼可见）。
 *
 *  现在改成**逐条色带按圆角轮廓内缩** —— 和 mkLeftBar 同一套 insetOf 思路，
 *  但左右两侧都要缩。两条硬约束：
 *      · 只许比轮廓**窄**，绝不许宽。窄了露出来的是底层的中间色（渐变中段），
 *        眼睛完全看不出来；宽了就是一块扎眼的直角。
 *      · 内缩量按"这条带子真正画到的那几行"取（含为消缝多铺的半像素），
 *        否则那半像素又会从圆角里探出去。
 *  一个 Graphics = 一个 draw call，所以带子从十几条加到几十条不影响性能。
 */
export function mkGradPanel(parent: Node, w: number, h: number, radius: number,
                            cTop: string, cBot: string): Node {
    const n = mkNode('grad', parent, w, h);
    const g = n.addComponent(Graphics);
    const A = hex(cTop), B = hex(cBot);
    const mid = lerpColor(A, B, 0.5);
    const r = Math.max(0, Math.min(radius, w / 2, h / 2));

    // ① 底：中间色填满整个轮廓。它是"兜底"—— 下面的色带在任何一行窄了一点，
    //    露出来的就是它（渐变中段色），看不出来。
    g.fillColor = mid;
    if (r > 0) g.roundRect(-w / 2, -h / 2, w, h, r);
    else g.rect(-w / 2, -h / 2, w, h);
    g.fill();

    // ② 逐条色带铺满全高，每条按圆角轮廓内缩
    const BANDS = Math.max(12, Math.min(64, Math.round(h / 3)));
    const bh = h / BANDS;
    /** 距上（或下）边缘 d 处，圆角轮廓相对左右边缘的内缩量 */
    const insetOf = (d: number): number => {
        if (r <= 0 || d >= r) return 0;
        const t = r - d;
        return r - Math.sqrt(Math.max(0, r * r - t * t));
    };
    for (let i = 0; i < BANDS; i++) {
        // 带 i 的目标区间 y ∈ [h/2−(i+1)bh, h/2−i·bh]；上下各多铺 0.5px 消缝。
        const yLo = h / 2 - (i + 1) * bh, yHi = h / 2 - i * bh;
        const yLoC = Math.max(-h / 2, yLo - 0.5);
        const yHiC = Math.min(h / 2, yHi + 0.5);
        // 距上边缘、距下边缘，各按"多铺到的那一行"算 → 内缩只会偏大，不会偏小
        const inset = Math.max(insetOf(h / 2 - yHiC), insetOf(yLoC + h / 2));
        const bw = w - inset * 2;
        if (bw <= 0.5) continue;                    // 装不下就整条不画（顶/底那两行）
        g.fillColor = lerpColor(A, B, (i + 0.5) / BANDS);
        g.rect(-bw / 2, yLoC, bw, yHiC - yLoC);
        g.fill();
    }
    return n;
}

// ============================================================
//  面 / 边 / 影
// ============================================================

/**
 * 纸影。设计稿里纸片是 `box-shadow:0 2px 10px rgba(120,100,60,.1)` ——
 * 一层柔和的暖灰。Graphics 没有模糊，用**两层错位半透明圆角矩形**近似：
 * 内层浅、外层更浅且更大，合起来在视觉上就是一圈软影。
 *
 * ⚠️ 已知偏差（待办）：这是**实心**矩形，会把影子透进半透明主体里去 ——
 *   `.card` 是 `rgba(255,255,255,.82)`，透进约 15% 的暖灰后白卡会偏灰，
 *   而 CSS 的 box-shadow **不覆盖元素内部**。
 *   正确做法是改成"环"（两层不重叠的 stroke，路径放在主体之外）。
 *   2026-10-02 试过一版 stroke 环形实现，改完后冒烟出现"地图页点击后整页重载"，
 *   为免和别的改动混在一起，先回退到实心版把其它修复验完，再单独做这件事。
 *
 * 颜色可覆盖：字块用的是带自身色调的投影（朱砂块投红影、玉青块投青影），
 * 一律走同一套暖灰会让"纸片"看起来像贴在同一张底上。
 */
export function mkShadow(parent: Node, w: number, h: number, radius: number,
                         dy = -3, spread = 4,
                         tint: string = CFG.COLOR.SHADOW,
                         alpha: number = CFG.COLOR.SHADOW_A): Node {
    const n = mkNode('shadow', parent, w, h);
    const g = n.addComponent(Graphics);
    g.fillColor = hex(tint, Math.round(alpha * 0.58));
    g.roundRect(-w / 2 - spread, -h / 2 + dy - spread, w + spread * 2, h + spread * 2, radius + spread);
    g.fill();
    g.fillColor = hex(tint, alpha);
    g.roundRect(-w / 2 - spread / 2, -h / 2 + dy - spread / 2, w + spread, h + spread, radius + spread / 2);
    g.fill();
    return n;
}

/**
 * 白卡：设计稿 `.card` / `.chap` / `.set-row` 的统一面。
 * 面 = rgba(255,255,255,.82)，边 = rgba(150,130,95,.13)，再加一层纸影。
 * ★ 面必须**半透明** —— 下方的宣纸渐变要透上来，否则整页会变成"白纸上一堆白块"。
 */
export function mkCard(parent: Node, w: number, h: number, radius: number,
                       alpha: number = CFG.COLOR.SURFACE_A,
                       edgeAlpha: number = CFG.COLOR.EDGE_A,
                       shadow = true): Node {
    const holder = mkNode('card', parent, w, h);
    if (shadow) {
        const sh = mkShadow(holder, w, h, radius);
        setPos(sh, 0, 0);
    }
    const n = mkNode('face', holder, w, h);
    const g = n.addComponent(Graphics);
    g.fillColor = hex(CFG.COLOR.SURFACE, alpha);
    g.roundRect(-w / 2, -h / 2, w, h, radius);
    g.fill();
    g.strokeColor = hex(CFG.COLOR.EDGE, edgeAlpha);
    g.lineWidth = 2;
    g.roundRect(-w / 2, -h / 2, w, h, radius);
    g.stroke();
    return holder;
}

/** 纯色圆角面（不带影、不带边），需要自己叠边/影时用 */
export function mkFace(parent: Node, w: number, h: number, radius: number,
                       color: string, alpha = 255): Node {
    const n = mkNode('face', parent, w, h);
    const g = n.addComponent(Graphics);
    g.fillColor = hex(color, alpha);
    if (radius > 0) g.roundRect(-w / 2, -h / 2, w, h, radius);
    else g.rect(-w / 2, -h / 2, w, h);
    g.fill();
    return n;
}

/** 边（不填充） */
export function mkEdge(parent: Node, w: number, h: number, radius: number,
                       color: string, alpha = 255, lineWidth = 2): Node {
    const n = mkNode('edge', parent, w, h);
    const g = n.addComponent(Graphics);
    g.strokeColor = hex(color, alpha);
    g.lineWidth = lineWidth;
    if (radius > 0) g.roundRect(-w / 2, -h / 2, w, h, radius);
    else g.rect(-w / 2, -h / 2, w, h);
    g.stroke();
    return n;
}

/** 圆（关卡节点 / 圆形返回键 / 开关滑钮） */
export function mkCircle(parent: Node, d: number, color: string, alpha = 255,
                        edge?: string, edgeAlpha = 255, edgeW = 2): Node {
    const n = mkNode('circle', parent, d, d);
    const g = n.addComponent(Graphics);
    g.fillColor = hex(color, alpha);
    g.circle(0, 0, d / 2);
    g.fill();
    if (edge) {
        g.strokeColor = hex(edge, edgeAlpha);
        g.lineWidth = edgeW;
        g.circle(0, 0, d / 2 - edgeW / 2);
        g.stroke();
    }
    return n;
}

/**
 * 卡片左竖条（设计稿 `.chap::before`）—— 4 设计px 宽、满高、上朱砂下藤黄。
 *
 * 【它画的到底是什么形状：**圆角盒子上 `border-left` 的真实形状**】
 * 设计稿写的是 `left:0;top:0;bottom:0;width:4px`（直角方头），靠父级
 * `.chap{overflow:hidden}` 把端头裁进卡片圆角。Cocos 的 Graphics **没有裁剪**，
 * 直接画矩形的话端头会**戳出卡片圆角之外** —— 真机 12 倍放大下一眼可见，
 * 用户 2026-10-02 明确要求美化掉，并拍板采用「跟随卡片圆角」这一版：
 * 竖条的**左边界跟着卡片的外弧走**，右边界保持直线（4 设计px 处，稳在卡片内）。
 * 结果与"给圆角盒子写 `border-left:4px`"完全一致：上端在距卡片顶边
 *     d = r − √(2rw − w²)      （r=17、w=4 设计px → d ≈ 6 设计px）
 * 处**收细成一个尖**，方头彻底消失。
 *
 * 【★ 2026-10-02 修掉的第一个"棱角"bug —— 负宽度会画到右边去】
 *  竖条只有 4 设计px（≈7.7 实现px）宽，而圆角半径 r = 17 设计px（≈32.9 实现px）。
 *  所以圆角那一段 `w − inset` 是**负数**，而 Graphics 的 `rect()` 拿到负宽度
 *  并不会"什么都不画"，而是按 x、x+w 两点连成一个**反向矩形**：
 *      x 从 `x0 + 32.9` 一路画到 `x0 + 32.9 − 25.2` —— 整块颜色跑到竖条**右边**、
 *      扎进卡片内部（约 25 实现px 宽）。上下各一次，就是设计稿里没见过的方形色块。
 *  现在负宽度不可能出现：左右边界都夹在 `[x0, xR]` 里，弧线越界时整条跳过。
 *
 * 【★ 修掉的第二个"棱角"bug —— 整段取最大内缩 = 11px 一级的台阶】
 *  老写法每条色带取**上下两端内缩量的较大者**，于是圆角区被量化成台阶
 *  （BANDS=24，而圆角只有 33 实现px 高，实际只落到 2~3 级）——
 *  放大后是"一条硬平切 + 一级台阶"，仍然不是圆弧。
 *  现在每条色带按**上下两端各自的弧线 x** 画成梯形，边界是一条连续折线：
 *  折线段 ≈3px、弧线误差 0.1px（亚像素），看不出多边形感。
 *
 * 【为什么形状与渐变必须在同一层里一起做】
 *  Graphics **不支持渐变填充**，只能用"多条近似色带"逼近；所以不能
 * "先填一条渐变 path 再裁剪"，只能逐条画梯形、每条取一个插值色。
 *  一个 Graphics = 一个 draw call（同色多次 fill 会合并），所以色带数量不增加 draw call。
 */
export function mkLeftBar(parent: Node, w: number, h: number, r: number,
                          cTop: string, cBot: string): Node {
    const n = mkNode('leftbar', parent, w, h);
    const g = n.addComponent(Graphics);
    const A = hex(cTop), B = hex(cBot);
    const rr = Math.max(0, Math.min(r, h / 2));
    const x0 = -w / 2;              // 左边界 = 卡片左边缘
    const xR = x0 + w;              // 右边界（直边，在卡片内部，不用收）
    /** 距上（或下）边缘 d 处，卡片圆角把左边界往右推了多少 */
    const insetOf = (d: number): number => {
        if (rr <= 0 || d >= rr) return 0;
        const t = rr - d;
        return rr - Math.sqrt(Math.max(0, rr * rr - t * t));
    };
    /** 高度 y 处需要的左边界内缩（上下圆角取较大者；直段两边都是 0） */
    const insetAt = (y: number): number =>
        Math.max(insetOf(h / 2 - y), insetOf(y + h / 2));

    // ── 纵向分段：两个圆角段各切 40 段，直段切 8 段 ──
    //   · 形状：顶点连成的折线逼近弧线，所以段数决定"折"得直不直；
    //     ★ 但真正的上限**不在段数**，而在**渲染像素密度**：
    //       竖条只有 8 实现px 宽，收尖处那条斜线在 dpr=1 的画布上只剩 1px 去铺，
    //       放大 20 倍看到的是"每格 1 个设备像素"的量化台阶 —— 那是采样极限。
    //       实测：8 段 → 20 段有可见改善，20 段 → 40 段几乎不动（同一画面 PNG 只差 4 字节）。
    //       所以"端头够不够干净"必须在 **dpr≥2** 下判（`SMOKE_DPR=3` 再拍一张），
    //       拿 dpr=1 的截图下结论会冤枉代码；证据见 docs/verify/S4/ 的两组放大图。
    //   · 颜色：Graphics 没有渐变填充，只能把渐变切成一条条纯色带；
    //     直段切 8 段是为了色带够密（形状上直段其实 1 段就够）。
    //   · 代价：88 个梯形 ≈ 352 个顶点，仍是**一个 Graphics = 一个 draw call**
    //     （Graphics 把顶点攒在自己的缓冲里，画多少次都进同一批）。
    const ys: number[] = [];
    const seg = (from: number, to: number, nSeg: number): void => {
        for (let i = 0; i <= nSeg; i++) {
            const v = from + (to - from) * (i / nSeg);
            if (!ys.length || Math.abs(v - ys[ys.length - 1]) > 1e-6) ys.push(v);
        }
    };
    seg(-h / 2, -h / 2 + rr, 40);
    seg(-h / 2 + rr, h / 2 - rr, 8);
    seg(h / 2 - rr, h / 2, 40);

    const total = ys.length - 1;
    for (let i = 0; i < total; i++) {
        const yLo = ys[i], yHi = ys[i + 1];
        // 左右两端各自按弧线 x 算；越界就夹住（上面那块自然退化成三角形）
        const xLHi = Math.min(xR, x0 + insetAt(yHi));
        const xLLo = Math.min(xR, x0 + insetAt(yLo));
        if (Math.max(xR - xLHi, xR - xLLo) <= 0.5) continue;   // 整条都在圆角之外，不画
        g.fillColor = lerpColor(A, B, total <= 1 ? 0.5 : (i + 0.5) / total);
        g.moveTo(xLHi, yHi);
        g.lineTo(xR, yHi);
        g.lineTo(xR, yLo);
        g.lineTo(xLLo, yLo);
        g.close();
        g.fill();
    }
    return n;
}

/**
 * 虚线圆角框（设计稿 `.tips` 的 `border:1px dashed`）。
 * Graphics 没有 dash，用**逐段短线**拼：四条边各裁成若干小段，四角留空。
 * 圆角本身很小（12px 设计值），留空看不出。
 */
export function mkDashedBox(parent: Node, w: number, h: number, radius: number,
                            color: string, alpha = 255, lineWidth = 2,
                            dash = 13, gap = 9): Node {
    const n = mkNode('dashed', parent, w, h);
    const g = n.addComponent(Graphics);
    g.strokeColor = hex(color, alpha);
    g.lineWidth = lineWidth;
    const halfW = w / 2 - radius / 2, halfH = h / 2 - radius / 2;
    const step = dash + gap;
    for (let x = -halfW; x < halfW; x += step) {
        const len = Math.min(dash, halfW - x);
        g.moveTo(x, h / 2); g.lineTo(x + len, h / 2);
        g.moveTo(x, -h / 2); g.lineTo(x + len, -h / 2);
        g.stroke();
    }
    for (let y = -halfH; y < halfH; y += step) {
        const len = Math.min(dash, halfH - y);
        g.moveTo(-w / 2, y); g.lineTo(-w / 2, y + len);
        g.moveTo(w / 2, y); g.lineTo(w / 2, y + len);
        g.stroke();
    }
    return n;
}

/**
 * 圆形竖向渐变（设计稿 `.node.done` 的
 * `background:linear-gradient(160deg,#FFFDF6,#FBF2D9)`）。
 *
 * 【为什么不能像 mkGradPanel 那样"先铺底再叠色带"】
 * 圆角矩形的底可以用同色填满四角；圆没有"角"可填，色带一旦是全宽矩形就会
 * 戳出圆弧之外。所以这里**逐条色带按圆的半弦长裁宽**：
 *     对距圆心 y 处，半弦长 = √(r² − y²)
 * 每条色带的宽度就取该条中心处的半弦长 × 2，填出来的轮廓即为一叠内切矩形，
 * 边缘的锯齿只有 1px 量级、再被外圈描边压住，肉眼看不出来。
 * 一个 Graphics = 一个 draw call，所以 32 条带子不增加 draw call。
 */
export function mkGradCircle(parent: Node, d: number, cTop: string, cBot: string,
                            edge?: string, edgeAlpha = 255, edgeW = 2): Node {
    const n = mkNode('grad-circle', parent, d, d);
    const g = n.addComponent(Graphics);
    const A = hex(cTop), B = hex(cBot);
    const r = d / 2;
    const BANDS = 32;
    const bh = d / BANDS;
    for (let i = 0; i < BANDS; i++) {
        // 带 i 覆盖 y ∈ [r − (i+1)bh, r − i·bh]（以圆心为原点，顶部为正）
        const yTop = r - i * bh, yBot = r - (i + 1) * bh;
        const yc = (yTop + yBot) / 2;                     // 带中心的 y
        const half = Math.sqrt(Math.max(0, r * r - yc * yc));
        // 带的上/下沿取"较窄"的那个半弦长，保证不越出圆弧
        const halfMin = Math.min(
            Math.sqrt(Math.max(0, r * r - Math.min(r, Math.abs(yTop)) ** 2)),
            Math.sqrt(Math.max(0, r * r - Math.min(r, Math.abs(yBot)) ** 2)),
        );
        const hw = Math.max(halfMin, half - 0.5);
        g.fillColor = lerpColor(A, B, (i + 0.5) / BANDS);
        g.rect(-hw, yBot, hw * 2, bh + 1);
        g.fill();
    }
    if (edge) {
        g.strokeColor = hex(edge, edgeAlpha);
        g.lineWidth = edgeW;
        g.circle(0, 0, r - edgeW / 2);
        g.stroke();
    }
    return n;
}

/**
 * 内阴影暗角（设计稿 `.board{box-shadow:inset 0 0 64px rgba(0,0,0,.55)}`）。
 *
 * 【为什么必须补这一层】
 * 案几是深墨色的大方块。设计稿用 inset 阴影让四条边"沉下去"，中间略亮 ——
 * 少了它，棋盘就是一块平的深色卡纸，宣纸牌摊上去"浮"不起来，
 * 整套水墨的层次感就丢了。这是对局页面积最大的一个视觉元素，不能省。
 *
 * 【Graphics 没有内阴影，怎么拼】
 * 从四条边各向内铺一条**衰减色带**：每条带子 alpha 由深到浅，宽度 4 设计 px 一条。
 * 分左右两组而不是四组无缝拼接：
 *   · 上下两条横向带子跨满宽度；
 *   · 左右两条纵向带子**缩进 上/下带子的厚度** —— 否则四角会被叠两次，
 *     角上出现一块明显更黑的斑（这是最容易露馅的地方）。
 * 一个 Graphics = 一个 draw call，所以几十条带子不增加 draw call。
 */
export function mkInsetVignette(parent: Node, w: number, h: number, radius: number,
                                depth: number, color: string,
                                alpha: number, bands = 16): Node {
    const n = mkNode('vignette', parent, w, h);
    const g = n.addComponent(Graphics);
    const step = depth / bands;
    // 距离边沿 d 处的相对强度：d=0 → 1，d=depth → 0。用平方让近边处更实、中段更柔。
    const fall = (d: number): number => {
        const t = 1 - Math.max(0, Math.min(1, d / depth));
        return t * t;
    };
    // 圆角处要横向内缩，否则带子会戳到圆角之外
    const insetOf = (d: number): number => {
        const rr = Math.min(radius, w / 2, h / 2);
        if (rr <= 0 || d >= rr) return 0;
        const t = rr - d;
        return rr - Math.sqrt(Math.max(0, rr * rr - t * t));
    };
    const col = hex(color);

    for (let i = 0; i < bands; i++) {
        const d0 = i * step;                       // 距边沿的起点
        const a = Math.round(alpha * (fall(d0) + fall(d0 + step)) / 2);
        if (a <= 0) continue;
        g.fillColor = new Color(col.r, col.g, col.b, a);
        const ins = insetOf(d0);
        const len = w - 2 * ins;
        if (len <= 0) continue;
        // 上边
        g.rect(-w / 2 + ins, h / 2 - (i + 1) * step, len, step + 1);
        // 下边
        g.rect(-w / 2 + ins, -h / 2 + d0, len, step + 1);
        g.fill();
    }
    // 左右两条纵向带子：纵向范围缩进 上下带子的厚度，避免四角叠黑
    const y0 = -h / 2 + depth, y1 = h / 2 - depth;
    const vLen = y1 - y0;
    if (vLen > 0) {
        for (let i = 0; i < bands; i++) {
            const d0 = i * step;
            const a = Math.round(alpha * (fall(d0) + fall(d0 + step)) / 2);
            if (a <= 0) continue;
            g.fillColor = new Color(col.r, col.g, col.b, a);
            g.rect(-w / 2 + d0, y0, step + 1, vLen);
            g.rect(w / 2 - (i + 1) * step, y0, step + 1, vLen);
            g.fill();
        }
    }
    return n;
}

/**
 * 把一个 Graphics 重画成"只有一圈线"的圆环 —— 呼吸光晕用。
 *
 * 【为什么给函数而不是给组件】
 * 设计稿 `.node.cur` 的 pulse 不是"整体放大"，而是**光圈从 2.5px 扩散到 8px 并淡出**：
 *     @keyframes pulse{ 50%{ box-shadow: 0 0 0 8px rgba(181,53,42,0) } }
 * 要复刻它就必须每帧改描边宽度 + alpha 并重画。Cocos 里改 Graphics 得 clear 后重绘，
 * 所以这里只提供一个"重绘"函数，节奏由页面自己的 interval 掌握
 * （页面退出时 PageBase 会统一收口，不会留下打在半销毁节点上的定时器）。
 */
export function redrawCircleRing(g: Graphics, d: number, lineW: number,
                                color: string, alpha: number): void {
    g.clear();
    g.strokeColor = hex(color, Math.max(0, Math.min(255, Math.round(alpha))));
    g.lineWidth = lineW;
    // 往外长：描边中心落在 r 上，半径随宽度外扩
    g.circle(0, 0, d / 2 + lineW / 2);
    g.stroke();
}

// ============================================================
//  常用控件
// ============================================================

/**
 * 主按钮：设计稿 `.btn` —— 朱砂渐变 + 白字 + **15px 圆角**（`border-radius:15px`）。
 * 高度由调用方给：设计稿是 `padding:15px` + 17px 字（行盒 23.8）→ 实高 54。
 * 字距设计稿写的是 `letter-spacing:1px`，所以间距要显式传（不是按钮高的函数）。
 */
export function mkPrimaryBtn(parent: Node, w: number, h: number, text: string,
                             onTap: () => void, host?: object,
                             fontSize?: number, spacing?: number): Node {
    const holder = mkNode('btn-primary', parent, w, h);
    const r = px(15);
    const sh = mkShadow(holder, w, h, r, -5, 3);
    setPos(sh, 0, 0);
    const face = mkGradPanel(holder, w, h, r, CFG.COLOR.BTN_A, CFG.COLOR.BTN_B);
    setPos(face, 0, 0);
    setPos(mkLabel(face, text, {
        size: fontSize ?? Math.round(h * 0.33), color: CFG.COLOR.BTN_TX,
        bold: true, font: 'kai', spacing,
    }).node, 0, 0);
    pressable(holder, onTap, host);
    return holder;
}

/** 次按钮：设计稿 `.btn.ghost` —— 半透明白底 + 墨字 + 15px 圆角 */
export function mkGhostBtn(parent: Node, w: number, h: number, text: string,
                           onTap: () => void, host?: object,
                           fontSize?: number, spacing?: number): Node {
    const holder = mkNode('btn-ghost', parent, w, h);
    const face = mkCard(holder, w, h, px(15), CFG.COLOR.SURFACE_A_BACK,
        CFG.COLOR.EDGE_A_MID, false);
    setPos(face, 0, 0);
    setPos(mkLabel(face, text, {
        size: fontSize ?? Math.round(h * 0.29), color: CFG.COLOR.INK,
        bold: true, font: 'kai', spacing,
    }).node, 0, 0);
    pressable(holder, onTap, host);
    return holder;
}

/**
 * 圆形返回键（设计稿 `.btn-back`：32px 圆，半透明白底 + 米边 + 「←」）。
 * 「←」用字符而不是图标贴图 —— 系统字体一定有此字形，零资源。
 */
export function mkBackBtn(parent: Node, d: number, onTap: () => void, host?: object): Node {
    const holder = mkNode('btn-back', parent, d, d);
    mkCircle(holder, d, CFG.COLOR.SURFACE, CFG.COLOR.SURFACE_A_BACK,
        CFG.COLOR.EDGE, CFG.COLOR.EDGE_A_BACK, 2);
    setPos(mkLabel(holder, '←', {
        size: Math.round(d * 0.47), color: CFG.COLOR.INK, font: 'hei',
    }).node, 0, 1);
    pressable(holder, onTap, host);
    return holder;
}

export type PieceKind = 'r' | 'p' | 'w';

/** 字块的三套配色（偏旁 / 部件 / 合成字）。设计稿 .hd-piece / .ms-p / .ws-piece 同源 */
export function pieceColors(kind: PieceKind): { a: string; b: string; tx: string } {
    const C = CFG.COLOR;
    if (kind === 'r') return { a: C.PIECE_R_A, b: C.PIECE_R_B, tx: C.PIECE_R_TX };
    if (kind === 'p') return { a: C.PIECE_P_A, b: C.PIECE_P_B, tx: C.PIECE_P_TX };
    return { a: C.PIECE_W_A, b: C.PIECE_W_B, tx: C.PIECE_W_TX };
}

/** 字块的投影与底边配色 */
function pieceShade(kind: PieceKind): { inset: string; insetA: number; sh: string; shA: number } {
    const C = CFG.COLOR;
    if (kind === 'r') {
        return { inset: C.PIECE_R_INSET, insetA: C.PIECE_R_INSET_A, sh: C.PIECE_R_SHADOW, shA: C.PIECE_R_SHADOW_A };
    }
    if (kind === 'p') {
        return { inset: C.PIECE_P_INSET, insetA: C.PIECE_P_INSET_A, sh: C.PIECE_P_SHADOW, shA: C.PIECE_P_SHADOW_A };
    }
    // 朱砂块没有底边内阴影（设计稿只给了一层的投影），投得最重
    return { inset: C.PIECE_W_B, insetA: 0, sh: C.PIECE_W_SHADOW, shA: C.PIECE_W_SHADOW_A };
}

/**
 * 字块：一个竖渐变圆角小方块 + 居中楷体字。
 *
 * 【为什么要多画两笔】
 * 设计稿的 `.hd-piece` / `.ms-p` / `.ws-piece` 都有两条 box-shadow：
 *     inset 0 -2px 0 rgba(...)   ← 底边内阴影，读成"这块纸有厚度"
 *     0 Npx Mpx rgba(...)        ← 落在底上的投影
 * 少了它们，字块就是一块纯粹的色斑，"纸片"的物理感全丢 ——
 * 而首页那个「木＋仓＝枪」的示例正是靠这点厚度才立得起来。
 * Graphics 没有内阴影：用一条贴底的细圆角条来近似（颜色取该套色的暗端 + alpha）。
 */
export function mkPiece(parent: Node, size: number, kind: PieceKind, ch: string,
                        fontSize?: number): Node {
    const c = pieceColors(kind);
    const s = pieceShade(kind);
    const r = Math.round(size * 0.23);
    const holder = mkNode('piece', parent, size, size);
    setPos(mkShadow(holder, size, size, r, -Math.round(size * 0.06), Math.round(size * 0.05), s.sh, s.shA), 0, 0);

    const n = mkGradPanel(holder, size, size, r, c.a, c.b);
    setPos(n, 0, 0);

    if (s.insetA > 0) {
        const g = n.getComponent(Graphics)!;
        const th = Math.max(2, px(2));
        g.fillColor = hex(s.inset, s.insetA);
        g.roundRect(-size / 2 + r * 0.5, -size / 2 + th * 0.15, size - r, th, th / 2);
        g.fill();
    }

    setPos(mkLabel(n, ch, {
        size: fontSize ?? Math.round(size * 0.5),
        color: c.tx, bold: true, font: 'kai',
    }).node, 0, 0);
    return holder;
}

// ============================================================
//  贴图 / 文本
// ============================================================

/**
 * 贴图节点。贴图**异步**加载：先建好节点占位，加载完再挂 frame。
 *
 * 【为什么必须显式设 CUSTOM 尺寸模式 —— 一个很隐蔽的坑】
 * Sprite 默认是 TRIMMED，它会在**每次**赋 spriteFrame 时把节点 contentSize
 * 改成贴图的原始尺寸（这里是 192×192）。于是"按设计算好的 99×99"会被悄悄
 * 改回 192×192，整盘牌互相压住、越界。设成 CUSTOM 后才由我们说了算。
 *
 * 【path 的语义：**完整相对路径**，不是牌名】
 * ★ 2026-10-02 踩过的坑：这里原来调的是 `loadTile(texName)`，而 `loadTile`
 *   会**自动补 `tiles/` 前缀**。于是地图页传 `'ui/lock'` 时被拼成
 *   `tiles/ui/lock` → 构建产物里当然没有这个路径 → 运行期静默打一条
 *   `TileAtlas 贴图加载失败`，画面上锁就"凭空消失"，而且构建/体积全都正常，
 *   极难定位。现在统一走 `loadSprite(path)`，路径由调用方写全：
 *   牌面写 `'tiles/t_67aa'`，UI 图标写 `'ui/lock'`。
 */
export function mkSprite(parent: Node, path: string, w: number, h: number): Sprite {
    const n = mkNode('sprite', parent, w, h);
    const sp = n.addComponent(Sprite);
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    sp.type = Sprite.Type.SIMPLE;
    if (path) {
        loadSprite(path, (sf) => {
            if (!n.isValid) return;      // 页面已切走/已销毁，别再动它
            if (!sf) return;             // 缺贴图：TileAtlas 已打过日志
            sp.spriteFrame = sf;
            // 赋 frame 后再钉一次尺寸：TRIMMED 的残留影响、以及未来换 sizeMode 都能兜住
            n.getComponent(UITransform)!.setContentSize(w, h);
        });
    }
    return sp;
}

/**
 * 给任意节点装上"按下缩一下、松开弹回"的手感。
 *
 * 【为什么不用 cc.Button】内置 Button 靠 SpriteFrame 做状态切换，
 * 本项目零 UI 贴图（牌面贴图是另一回事）；而且它会在按下时切换整张图，
 * 与"代码画的圆角面板"对不上。自己拼一行反而更可控。
 */
export function pressable(node: Node, onTap: () => void, host?: object): void {
    node.on(Node.EventType.TOUCH_START, () => node.setScale(0.97, 0.97, 1), host);
    node.on(Node.EventType.TOUCH_CANCEL, () => node.setScale(1, 1, 1), host);
    node.on(Node.EventType.TOUCH_END, () => { node.setScale(1, 1, 1); onTap(); }, host);
}

export interface LabelOpts {
    size?: number;          // 字号
    color?: string;         // 颜色（十六进制）
    alpha?: number;         // 透明度（0~255）
    bold?: boolean;
    /** 字体族：kai = 楷体（设计稿 --kai），hei = 黑体（设计稿 --hei）。默认 hei */
    font?: 'kai' | 'hei';
    /** 字距（设计稿的 letter-spacing）。标题的大字距是这版设计的重要特征 */
    spacing?: number;
    align?: 'left' | 'center' | 'right';
    lineHeight?: number;
    /** 是否按内容自适应宽度（默认 true）。设为 false 时按节点宽度换行 */
    autoWidth?: boolean;
    width?: number;
}

/** 文本标签（系统字体，不引贴图字体） */
export function mkLabel(parent: Node, text: string, opts: LabelOpts = {}): Label {
    const size = opts.size ?? 28;
    const n = mkNode('label', parent);
    n.layer = Layers.Enum.UI_2D;
    const lb = n.addComponent(Label);
    lb.string = text;
    lb.fontSize = size;
    lb.lineHeight = opts.lineHeight ?? Math.round(size * 1.35);
    lb.color = hex(opts.color ?? CFG.COLOR.INK, opts.alpha ?? 255);
    lb.isBold = !!opts.bold;
    lb.fontFamily = opts.font === 'kai' ? CFG.FONT.KAI : CFG.FONT.HEI;
    // ★ 字距是设计稿的显性特征（大标题 ls:10px / 荷叶标 ls:8px）。
    //   Label.spacingX 对系统字体有效；取不到字距时只是变紧，不至于翻版。
    if (opts.spacing) lb.spacingX = opts.spacing;

    const halign = opts.align === 'left' ? Label.HorizontalAlign.LEFT
        : opts.align === 'right' ? Label.HorizontalAlign.RIGHT
            : Label.HorizontalAlign.CENTER;
    lb.horizontalAlign = halign;
    lb.verticalAlign = Label.VerticalAlign.CENTER;

    if (opts.autoWidth === false) {
        lb.overflow = Label.Overflow.RESIZE_HEIGHT;
        n.getComponent(UITransform)!.setContentSize(opts.width ?? 400, 0);
    } else {
        lb.overflow = Label.Overflow.NONE;
    }
    return lb;
}

/**
 * 粗略字宽：汉字 1em，数字/西文 0.55em。
 * 只用来给「同一行分段换色」的整体居中估宽 —— 这两处文本里只有汉字和数字，够准。
 * ⚠️ 不要拿它当排版度量用：真正的宽度只有渲染后才知道。
 */
export function estWidth(t: string, size: number): number {
    let w = 0;
    for (const ch of t) w += ch.charCodeAt(0) < 128 ? size * 0.55 : size;
    return w;
}

export interface TextRun {
    t: string;
    color: string;
    /** 覆盖基础字号（设计稿里的 <b> 大号数字） */
    size?: number;
    bold?: boolean;
    kai?: boolean;
}

/**
 * 「同一行里分段换色 / 换字号」的通用排法。
 *
 * 设计稿用 `<b>` / `<em>` 表达行内混合样式（首页的「本行或本列」朱砂强调、
 * 「收录 103 字 · 4 章 · 38 关」里三个大号数字、已成字条的 `偏旁＋部件＝字` 都是）。
 * Cocos 的 Label **不支持富文本**，所以逐段建 label 再按估宽整体居中。
 *
 * @returns 整行估宽（调用方要接着摆别的东西时用得上）
 */
export function mkRuns(parent: Node, runs: TextRun[], base: number, lh: number,
                        y: number, spacing = 0): number {
    const widths = runs.map((r) => estWidth(r.t, r.size ?? base) + spacing);
    const total = widths.reduce((a, b) => a + b, 0);
    let x = -total / 2;
    for (let i = 0; i < runs.length; i++) {
        const r = runs[i];
        setPos(mkLabel(parent, r.t, {
            size: r.size ?? base, color: r.color, bold: r.bold,
            font: r.kai ? 'kai' : 'hei', lineHeight: lh, spacing,
        }).node, x + widths[i] / 2, y);
        x += widths[i];
    }
    return total;
}

/** 简易按钮（纯色底版，保留给不需要渐变/纸影的地方） */
export function mkButton(parent: Node, w: number, h: number, text: string,
                         bg: string, fg: string, onTap: () => void,
                         fontSize = 30): Node {
    const n = mkNode('btn', parent, w, h);
    mkFace(n, w, h, Math.min(18, h / 2), bg);
    setPos(mkLabel(n, text, { size: fontSize, color: fg, bold: true }).node, 0, 0);

    // 按压反馈：缩到 0.94 再弹回。Cocos 没有 CSS :active，只能自己来
    const press = () => n.setScale(0.94, 0.94, 1);
    const release = () => n.setScale(1, 1, 1);
    n.on(Node.EventType.TOUCH_START, press);
    n.on(Node.EventType.TOUCH_CANCEL, release);
    n.on(Node.EventType.TOUCH_END, () => { release(); onTap(); });
    return n;
}
