/**
 * ============================================================
 *  MapPage.ts · 关卡地图（设计稿 S04 · #s-map）
 * ============================================================
 *  版式（数字全部来自 tools/design-geometry.mjs 实测的原型盒模型）：
 *      topbar        高 96（= 安全区 56 + 返回键 32 + 下距 8）；标题 15px 起于 x 58
 *      map-info      高 31（padding:2px 20px 12px，文字 12px / 行盒 17）→ 起于 y 96
 *      map-wrap      起于 y 127，padding 6 0 30，高 = 屏高 − 127（flex:1）
 *                    ★ 小径**装得下时在视口内居中**（上下留白相等），装不下才是
 *                      纯顶锚 + 可滚动（见 applyScroll）。设计稿是纯 flex:1 顶锚，
 *                      长屏上会把两边的空白全堆到底部。
 *      node-row      高 68 + 下距 10 → **步距 78**；节点 68×68 圆
 *      三列横坐标    左 20 / 中 (W−68)/2 / 右 W−20−68  → 圆心 54 / 186 / 318
 *
 *  【为什么是"蛇形小径"而不是"每行 4 个的宫格"】
 *  原型 `row.style.justifyContent = i%3===0 ? 'flex-start' : (i%3===1 ? 'center':'flex-end')`
 *  —— 一关一行，按序号左/中/右轮转。渲染出来的就是一条蜿蜒的小径。
 *  只看 CSS（`.node-row{display:flex}`）会做成等宽宫格，与设计稿完全是两个东西。
 *
 *  【节点内部：星在上、序号在下，而且"空槽"也占位】
 *  实测：`.n-st`（星级，9px，**height:11px**）恒在，`.n-id`（序号，19px，行盒 26）在它下面。
 *  两者合成一个高 37 的块在圆里居中，于是
 *      星级中心 = 圆心上方 13px      序号中心 = 圆心下方 5.5px
 *  未通关的节点里 `.n-st` 是空字符串但仍有 11px 高 —— 所以序号**不会**回到圆心。
 *  这一条最容易漏：漏了之后未通关的序号会比设计稿高 5.5px，而且只有叠图才看得出来。
 *
 *  【小径：三次贝塞尔 + 虚线】
 *  原型用 SVG：`M p0 C p0.x,my p1.x,my p1.x,p1.y`（控制点落在两点纵向中点 →
 *  两端切线水平，读起来像一条"路"而不是折线），
 *  `stroke:rgba(181,53,42,.26); stroke-width:2; stroke-dasharray:5 8; linecap:round`。
 *  Graphics 既没有贝塞尔虚线也没有 dash，所以这里自己采样曲线 + 按弧长切段：
 *  64 段折线足够（节点间距 78px，折线偏差 < 0.1px），全部线段进**同一个** Graphics
 *  → 不管多少段都只占一个 draw call。
 *
 *  【呼吸光圈怎么复刻】
 *  `.node.cur` 的 pulse 不是"整体放大"，而是**同一个光圈从 2.5px 撑到 8px 同时淡出**：
 *      0%   box-shadow 0 0 0 2.5px var(--red)
 *      50%  box-shadow 0 0 0 8px   rgba(181,53,42,0)
 *      100% 回到 0%
 *  即：以 1.6s 为周期、**三角波**（不是正弦）在 2.5→8 之间来回，alpha 同步 1→0→1。
 *  所以页面里按 40ms 重画一个只描边的圆环，宽度与 alpha 用三角波取。
 *  用 interval 而不是 tween：PageBase 会在 onExit 统一收口，切页后一定停
 *  （tween 在极端情况下会残留一帧，打在已销毁的节点上）。
 * ============================================================
 */

import { EventTouch, Graphics, Node, UIOpacity, UITransform } from 'cc';
import { CFG, px } from '../CFG';
import { CHAPTERS, isPlayable, levelsOfChapter } from '../core/LevelData';
import { currentLevelOf, isDone, levelInMapUnlocked } from '../core/Progress';
import { Save } from '../core/Save';
import { LevelDef } from '../core/Types';
import { dump } from './LayoutDump';
import { PageBase } from './PageBase';
import { PageManager } from './PageManager';
import { PAGE_CHAP, PAGE_GAME, PAGE_MAP } from './PAGES';
import { Toast } from './Toast';
import { prefetchChapter } from './TileAtlas';
import {
    hex, mkBackBtn, mkCircle, mkLabel, mkNode, mkPaperBG, mkSprite, pressable,
    redrawCircleRing, safeTop, setPos, topY, visibleSize,
} from './UIFactory';

// ── topbar / info ──
// ⚠️ 设计稿的 16 是"距屏幕顶"，真机上要避开状态栏/灵动岛与微信胶囊，
//    所以改用 safeTop()（=56 设计px）。理由见 CFG.LAYOUT.SAFE_TOP。
//
// ★★ 2026-10-02 用户拍板：标题**下移**、**放大** ★★
//   原版式把标题与返回键放在同一行（共用 backY = 72 设计px），15 号字挤在
//   返回键右侧的窄条里。改成：
//     · 标题**自成一行**，落在返回键下方 —— 中心 72 → **109** 设计px
//     · 字号 15 → **19**，行盒 21 → **26**
//     · 底栏因此从 96 长到 **124**，其下的「本章进度」「小节列表」整体 +28
//       （列表起点 127 → 155）。章节页用的是同一套数（见 ChapterPage.ts）。
//   109 这个数不是拍的：返回键下缘 = 56+32 = 88，再留 8 的空隙，加半个行盒 13。
const TOP_PAD_T = safeTop(), TOP_PAD_S = px(16), TOP_GAP = px(10);
const BACK_D = px(32);
/** 返回键与标题行之间的空隙（标题下移后新增的一档） */
const TITLE_GAP = px(8);
const TOP_TITLE_S = px(19), TOP_TITLE_LH = px(26);
/** 标题行下沿到底栏下沿的留白。原来是给返回键下缘留的 8，现在标题把那段占了 */
const TOP_PAD_B = px(2);
const TOPBAR_H = TOP_PAD_T + BACK_D + TITLE_GAP + TOP_TITLE_LH + TOP_PAD_B;   // 124
/** 标题行中心距屏幕顶（= 56 + 32 + 8 + 13） */
const TITLE_CY = TOP_PAD_T + BACK_D + TITLE_GAP + TOP_TITLE_LH / 2;           // 109

const INFO_PAD_T = px(2), INFO_PAD_X = px(20), INFO_PAD_B = px(12);
const INFO_S = px(12), INFO_LH = px(17);
const INFO_H = INFO_PAD_T + INFO_LH + INFO_PAD_B;
const LIST_TOP = TOPBAR_H + INFO_H;                 // = 87 设计px

// ── 小径与节点 ──
const LIST_PAD_T = px(6), LIST_PAD_B = px(30);
const NODE_D = px(68);
const ROW_STEP = px(78);                            // 68 高 + 10 下距
const ROW_PAD_X = px(20);

const ST_S = px(9), ST_LS = px(-0.5), ST_SLOT_H = px(11);
const ID_S = px(19), ID_LH = px(26);
/** 兜底白圆节点的序号中心（圆心下方 5.5 设计px）；已通关节点的星位见 STAR_Y_DONE */
const ID_Y = px(-5.5);

const RING_DEF_W = px(1), RING_CUR_W = px(2.5);
/** 光圈涨到多宽（设计稿 0 0 0 8px） */
const PULSE_MAX_W = px(8);
/** 光圈周期 1.6s；每 40ms 重画一次 */
const PULSE_TICK = 40, PULSE_PERIOD = 1600;
/**
 * 锁定态的不透明度改在 `buildLockedNode` 里按「未解锁 / 未开放」分两档算
 * （`LOCK_A_UNLOCKED` / `LOCK_A_UNPLAYABLE`）—— 原来的 `.node.locked{opacity:.4}`
 * 是给"灰圆 + 序号"用的，挂上彩色卡通锁后 0.4 会淡到认不出，故常量已删。
 */
/** 虚线小径：stroke-dasharray:5 8、width 2、rgba(181,53,42,.26) */
const PATH_DASH = px(5), PATH_GAP = px(8), PATH_W = px(2), PATH_A = 66;

/** 拖动超过这个位移算"在滚地图"，同一手势松手就不算点击 */
const PAN_SLOP = 8;

// ── 锁定态用的 Q 版锁图标（2026-10-02 用户拍板：地图页「锁住/未开放」的关卡节点换它）──
/** resources/ui/lock（由 cute-cartoon-assets 技能生成 + flood-fill 抠图入库） */
const LOCK_TEX = 'ui/lock';
/** 锁在节点里的宽度（设计px）。节点圆是 68，留出 5 的边 */
const LOCK_W = px(58);
/** 贴图原始宽高比 256×241 —— 必须按宽等比算高，硬拉到正方形会变成"扁锁" */
const LOCK_AR = 241 / 256;
/**
 * 锁定态的两档不透明度。
 *
 * 设计稿是 `.node.locked{opacity:.4}`，那是给"灰圆 + 序号"用的 ——
 * 挂上一张有颜色的卡通图标之后，0.4 会淡到看不出是什么东西。所以分两档：
 *   · 未解锁（通关上一章就能来）—— 亮一点，是"真能解锁"的状态；
 *   · 未开放（首版还没做的关卡）—— 更淡，一眼看出"这块还没内容"。
 * 这是本页唯一一处偏离设计稿数值的地方，刻意为之。
 */
const LOCK_A_UNLOCKED = Math.round(255 * 0.82);
const LOCK_A_UNPLAYABLE = Math.round(255 * 0.5);

// ============================================================
//  三态节点素材（2026-10-02 用户拍板：奖杯 A · 山峦 B）
// ============================================================
//  全部走 cute-cartoon-assets 技能：AI 文生图 → 白底 flood-fill 抠图 → 256px 入库，
//  风格与已在用的 Q 版锁同源（暖棕粗描边 + 平滑渐变 + 一道高光）。
//
//  ★ 用户拍板原话：
//      「奖杯选A，山峦选B」「已通关节点选择③ 奖杯+三星」
//      「排布方案还是先保留现行的三列轮转」← 所以本文件的三列算法**一行未动**，
//      改的只是"节点长什么样"和"标题在哪"。
//
//  ⚠️ 贴图的原始宽高比必须各按各的值算，硬拉成正方形会变形：
//     trophy 256×243（≈0.949，接近方）、mount 256×127（≈0.496，很扁）。
const TROPHY_TEX = 'ui/trophy';
const TROPHY_AR = 243 / 256;
/** 奖杯宽 56 设计px（节点 68，左右各留 6） */
const TROPHY_W = px(56);
/**
 * 奖杯中心（圆心为 0、向上为正）。
 * 「星槽 11 + 奖杯 53」共 64 高的块整体居中 ⇒ 占 [−32, +32]，
 * 于是 奖杯中心 = −32 + 53/2 ≈ **−5.5**，星中心 = 32 − 11/2 = **+26.5**。
 * （这样整块仍装得进 68 的节点，不会侵入相邻关卡那 10px 的间隙。）
 */
const TROPHY_Y = px(-5.5);
/** 已通关节点里星槽中心 */
const STAR_Y_DONE = px(26.5);

const MOUNT_TEX = 'ui/mount';
const MOUNT_AR = 127 / 256;
/**
 * 山宽 72 设计px。
 * ⚠️ 第一版取 66（与奖杯同档），实拍发现**红圈里显得空** —— 山很扁（高只有 36），
 *    而红圈是 68 的圆，左右一留白就显得"山缩在圈中间"。放大到 72 让它与静止红圈
 *    大致同宽（光圈涨到峰值 84 时仍在圈内），圈里才立得住。
 */
const MOUNT_W = px(72);
/** 山中心（略偏上，给下方关号让位） */
const MOUNT_Y = px(9);
/** 关号中心：骑在山的下缘附近，让"数字 + 山"读成一个整体（而非两个元素） */
const MOUNT_ID_Y = px(-14);

export class MapPage extends PageBase {

    readonly pageName = PAGE_MAP;

    private _chapter = 1;
    private _tone = 0;                                 // 光圈相位（0..1，三角波）
    private _pulseG: Graphics | null = null;

    // 滚动手势
    private _scroll = 0;
    private _maxScroll = 0;
    private _content: Node | null = null;
    private _dragFrom = 0;
    private _dragStartScroll = 0;
    private _moved = false;

    private _toast!: Toast;

    onExit(): void {
        if (this._toast) this._toast.dispose();
        this._pulseG = null;
        super.onExit();
    }

    protected onCreate(param?: { chapter?: number }): void {
        this._chapter = (param && param.chapter) || 1;
        // ★ 趁玩家还在翻地图，**先把这一章的贴图分包拉下来**。
        //   第 2~4 章各是一个微信小游戏分包（约 1.2~1.35MB），
        //   不在进关时才下：进关那个 Promise 是"边下边等开局"，玩家会盯着空盘面发呆。
        //   这里提前拉，等真点进某一关时它已经在本地了（等价于 wx.preloadSubpackage，
        //   但走 Cocos 的 loadBundle，三个平台行为一致）。
        prefetchChapter(this._chapter);
        const { w: W, h: H } = visibleSize();
        const C = CFG.COLOR;

        mkPaperBG(this._root, W, H, C.BG_TOP, C.BG_MID, C.BG_BOT);

        // —— topbar ——
        const backY = topY(H, TOP_PAD_T + BACK_D / 2);
        setPos(mkBackBtn(this._root, BACK_D, () => PageManager.goto(PAGE_CHAP), this),
            -W / 2 + TOP_PAD_S + BACK_D / 2, backY);

        const titleLeft = -W / 2 + TOP_PAD_S + BACK_D + TOP_GAP;
        const titleW = W - 2 * TOP_PAD_S - BACK_D - TOP_GAP;
        // ★ 标题落在返回键**下方**（TITLE_CY），不再与返回键共用 backY
        setPos(mkLabel(this._root, chapterName(this._chapter), {
            size: TOP_TITLE_S, color: C.INK, bold: true, font: 'hei', lineHeight: TOP_TITLE_LH,
            align: 'left', autoWidth: false, width: titleW,
        }).node, titleLeft + titleW / 2, topY(H, TITLE_CY));

        // —— 本章进度（.map-info：padding 2px 20px 12px / 12px 字）——
        const lvs = levelsOfChapter(this._chapter);
        const done = lvs.filter((l) => Save.isCleared(l.n)).length;
        const infoW = W - 2 * INFO_PAD_X;
        setPos(mkLabel(this._root, `共 ${lvs.length} 关 · 已通关 ${done} 关`, {
            size: INFO_S, color: C.INK2, font: 'hei', lineHeight: INFO_LH,
            align: 'left', autoWidth: false, width: infoW,
        }).node, -W / 2 + INFO_PAD_X + infoW / 2, topY(H, TOPBAR_H + INFO_PAD_T + INFO_LH / 2));

        // ============================================================
        //  可滚动视口：设计稿 .map-wrap{flex:1} → 高度 = 屏高 − 87
        // ============================================================
        const wrapY = topY(H, LIST_TOP);
        const wrapH = H - LIST_TOP;
        const contentH = LIST_PAD_T + lvs.length * ROW_STEP + LIST_PAD_B;
        this._maxScroll = Math.max(0, contentH - wrapH);

        const wrap = mkNode('map-wrap', this._root, W, wrapH);
        // wrapY 是视口**上沿**的 y；节点锚点在中心，所以中心 = 上沿 − 半高
        setPos(wrap, 0, wrapY - wrapH / 2);

        const content = mkNode('map-content', wrap, W, contentH);
        this._content = content;
        this.applyScroll();

        // —— 小径（先画线，节点压在线之上）——
        this.drawPath(content, W, contentH, lvs.length);

        // —— 节点 ——
        const curN = currentLevelOf(this._chapter);
        const pulse = mkNode('cur-pulse', content, NODE_D + PULSE_MAX_W * 2, NODE_D + PULSE_MAX_W * 2);
        this._pulseG = pulse.addComponent(Graphics);

        for (let i = 0; i < lvs.length; i++) {
            const lv = lvs[i];
            const x = colX(i % 3, W);
            const y = contentH / 2 - (LIST_PAD_T + ROW_STEP * i + NODE_D / 2);
            if (lv.n === curN) setPos(pulse, x, y);
            this.buildNode(content, lv, x, y, curN);
        }

        // —— 光圈：40ms 重画一次（CSS pulse 的三角波） ——
        if (curN > 0) {
            this.interval(() => {
                if (!this._pulseG || !this._pulseG.isValid) return;
                this._tone = (this._tone + PULSE_TICK / (PULSE_PERIOD / 2)) % 1;
                // 三角波：0 → 1 → 0（对应 CSS 的 0% → 50% → 100%）
                const u = this._tone < 0.5 ? this._tone * 2 : (1 - this._tone) * 2;
                redrawCircleRing(this._pulseG, NODE_D,
                    RING_CUR_W + (PULSE_MAX_W - RING_CUR_W) * u,
                    C.RED, 255 * (1 - u));
            }, PULSE_TICK);
        }

        // —— 滚动：TouchStart / Move / End 挂在视口上 ——
        wrap.on(Node.EventType.TOUCH_START, (e: EventTouch) => {
            this._dragFrom = e.getUILocation().y;
            this._dragStartScroll = this._scroll;
            this._moved = false;
        }, this);
        wrap.on(Node.EventType.TOUCH_MOVE, (e: EventTouch) => {
            const dy = e.getUILocation().y - this._dragFrom;
            if (!this._moved && Math.abs(dy) < PAN_SLOP) return;
            this._moved = true;
            // 手指下滑 = 内容跟着下移 = 往回看（scroll 减小）
            this._scroll = clamp(this._dragStartScroll - dy, 0, this._maxScroll);
            this.applyScroll();
        }, this);
        wrap.on(Node.EventType.TOUCH_END, () => { this._moved = false; }, this);
        wrap.on(Node.EventType.TOUCH_CANCEL, () => { this._moved = false; }, this);

        this._toast = new Toast(this._root, W, topY(H, H * 0.52));
        this.dumpLayout(W, wrapH, contentH, lvs);
    }

    /**
     * 版式转储（给 tools/layout-diff.py 逐值比对，见 ui/LayoutDump.ts）。
     *
     * `.node-row[i]` / `.node[i]` 的绝对 y 由"内容在视口内居中"决定，
     * 与设计稿的顶锚值不一定相等 —— 比对脚本对它们要看的是
     * **相邻步距 = 78**（节点 68 + 下距 10）与 **三列横坐标轮转**，
     * 见 tools/layout-diff.py 的 SAME_NAME_STEP / 列位置判据。
     */
    private dumpLayout(W: number, wrapH: number, contentH: number, lvs: LevelDef[]): void {
        if (!this._content || !this._content.isValid) return;
        const box = (n: string, l: number, t: number, w: number, h: number, ex = ''): void =>
            dump(PAGE_MAP, n, l, t, w, h, ex);

        box('.topbar', 0, 0, W, TOPBAR_H);
        box('.btn-back', TOP_PAD_S, TOP_PAD_T, BACK_D, BACK_D);
        box('.map-info', 0, TOPBAR_H, W, INFO_H);
        box('.map-wrap', 0, LIST_TOP, W, wrapH);

        // content 中心在视口内的偏移（Cocos 系）→ 换算成"距屏幕上边"
        const dy = this._content.position.y;
        const contentTop = LIST_TOP + wrapH / 2 - dy - contentH / 2;
        box('.map-content', 0, contentTop, W, contentH);

        for (let i = 0; i < lvs.length; i++) {
            const rowTop = contentTop + LIST_PAD_T + ROW_STEP * i;
            box(`.node-row[${i}]`, 0, rowTop, W, NODE_D);
            box(`.node[${i}]`, W / 2 + colX(i % 3, W) - NODE_D / 2, rowTop,
                NODE_D, NODE_D, `L${lvs[i].n}`);
        }
    }

    // ------------------------------------------------------------
    /**
     * content 相对 wrap 的 y（Cocos 系，y 朝上为正）：
     *   · 内容**装得下** → 偏移 0，即内容中心与视口中心重合 → 上下留白相等（居中）
     *   · 内容**装不下** → 偏移 (wrapH−contentH)/2（负）：
     *       scroll=0 时内容顶边贴视口顶（看得到第 1 关），
     *       滚到底时底边贴视口底 —— 这才是"顶锚 + 可滚动"该有的样子
     *
     * ★ 上一版无条件用 (wrapH−contentH)/2，那在"装得下"时等价于**顶锚**
     *   （内容顶边贴视口顶），空白全堆在底部 —— 正是这次要修的"整体偏上"。
     *   写注释时我说它"居中"，代码却不是 —— 这类"注释对、代码错"只有
     *   把数字打出来逐值比对才抓得住，光看截图分辨不出。
     */
    private applyScroll(): void {
        if (!this._content || !this._content.isValid) return;
        const contentH = this._content.getComponent(UITransform)!.height;
        const wrapH = this._content.parent!.getComponent(UITransform)!.height;
        setPos(this._content, 0, Math.min(0, (wrapH - contentH) / 2) + this._scroll);
    }

    /**
     * 小径：相邻两关圆心中间的三次贝塞尔（控制点落在纵向中点），虚线。
     *
     * 【为什么自己采样而不是用 Graphics.bezierCurveTo】
     * 因为要**虚线**。bezierCurveTo 只能画实线，而 Graphics 没有 setLineDash。
     * 采样成折线后按弧长切段，就能精确复刻 CSS 的 `stroke-dasharray:5 8`。
     * 采样点按弧长走（不是按 t 等分）：贝塞尔在 t 中部走得快，按 t 等分会
     * 让虚线在曲线两端变密、中段变疏，一眼能看出"这不是 dash"。
     */
    private drawPath(content: Node, W: number, contentH: number, count: number): void {
        if (count < 2) return;
        const n = mkNode('path', content, W, contentH);
        const g = n.addComponent(Graphics);
        g.strokeColor = hex(CFG.COLOR.RED, PATH_A);
        g.lineWidth = PATH_W;

        const SAMPLES = 64;
        const STEP = PATH_DASH + PATH_GAP;

        for (let i = 0; i + 1 < count; i++) {
            const p0 = nodeCenter(i, i % 3, W, contentH);
            const p3 = nodeCenter(i + 1, (i + 1) % 3, W, contentH);
            const my = (p0.y + p3.y) / 2;
            const p1 = { x: p0.x, y: my }, p2 = { x: p3.x, y: my };

            // ① 采样成折线 + 累计弧长
            const pts: Array<{ x: number; y: number }> = [];
            const cum: number[] = [0];
            for (let s = 0; s <= SAMPLES; s++) {
                const t = s / SAMPLES, u = 1 - t;
                const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
                pts.push({
                    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
                    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
                });
                if (s > 0) {
                    cum.push(cum[s - 1] + Math.hypot(pts[s].x - pts[s - 1].x, pts[s].y - pts[s - 1].y));
                }
            }
            const total = cum[SAMPLES];

            // ② 沿弧长取点（线性扫过即可：64 段，每次调用只看几十个下标）
            const at = (d: number): { x: number; y: number } => {
                const dd = Math.max(0, Math.min(total, d));
                let k = 1;
                while (k < SAMPLES && cum[k] < dd) k++;
                const seg = cum[k] - cum[k - 1] || 1;
                const r = (dd - cum[k - 1]) / seg;
                return {
                    x: pts[k - 1].x + (pts[k].x - pts[k - 1].x) * r,
                    y: pts[k - 1].y + (pts[k].y - pts[k - 1].y) * r,
                };
            };

            // ③ 按 5:8 切段。★ 从圆心起笔：节点圆是画在路径之上的，
            //    会盖住圆内的那一段 —— 与设计稿"线从圆心连到圆心"的画法一致。
            for (let d = 0; d < total; d += STEP) {
                const a = at(d), b = at(Math.min(d + PATH_DASH, total));
                g.moveTo(a.x, a.y);
                g.lineTo(b.x, b.y);
                g.stroke();
            }
        }
    }

    /** 建一个关卡节点（四态见文件头） */
    private buildNode(parent: Node, lv: LevelDef, x: number, y: number, curN: number): void {
        const C = CFG.COLOR;
        const playable = isPlayable(lv);
        const i = levelsOfChapter(this._chapter).findIndex((l) => l.n === lv.n);
        const unlocked = levelInMapUnlocked(this._chapter, levelsOfChapter(this._chapter), i);
        const done = isDone(lv.n);
        const isCur = lv.n === curN;

        /** 点击行为（锁定态与普通态共用；文案按"未开放 / 未解锁"分开） */
        const onTap = (): void => {
            if (this._moved) return;                   // 这一步是在滚地图，不算点击
            if (!playable) {
                // ★ 2026-10-03 全量解封后这条路**走不到**了（`isPlayable` 恒为 true）。
                //   保留它 + 保留 `buildLockedNode` 的 `playable` 分支，是因为它们
                //   仍是一个**结构性兜底**：以后往 LEVELS 里加关、贴图还没烘时，
                //   把生成器里的关号上限调回来就会落到这里 ——
                //   那时需要的正是"这条路走不了"的提示，而不是一张空盘面。
                //   ⚠️ 文案不要说死"首版只开放第 1~N 关"：那句话是跟着常量变的，
                //      写死过一次就会在解封之后变成假话（原句就是这样过期的）。
                this._toast.show(`第 ${lv.n} 关还在做\n更多字正在路上`);
                return;
            }
            if (!unlocked) { this._toast.show('先通过前面的关卡'); return; }
            PageManager.goto(PAGE_GAME, { level: lv.n });
        };

        // ★ 锁定态（未解锁 / 未开放）：整颗节点换成 Q 版锁图标。
        //   设计稿这里只有"灰圆 + 序号"（`.node.locked{opacity:.4}`）—— 用户 2026-10-02
        //   拍板要换成图 3 那种圆润的卡通锁。
        //   序号**不再显示**：68 设计px 的圆里放下锁身就再塞不进一个能看清的字号了；
        //   而"进不去"才是这一格最要紧的信息，第几关从蛇形小径的位置就能数出来。
        if (!unlocked || !playable) {
            this.buildLockedNode(parent, x, y, playable, onTap);
            return;
        }

        // ★★ 2026-10-02 用户拍板：三态各用一张 AI 插图，不再用"圆 + 文字" ★★
        //    done   → 奖杯 + 三星（内容备选 ③）
        //    cur    → 山峦 + 关号（用户原话「即将攻打的使用数字 + 简易山峦」）
        //    locked → Q 版锁（在上面那条 return 里）
        if (done) {
            this.buildTrophyNode(parent, lv, x, y, onTap);
            return;
        }
        if (isCur) {
            this.buildMountNode(parent, lv, x, y, onTap);
            return;
        }

        // 兜底：已解锁、可玩、既没通关又不是当前关 —— 按本作规则不会出现
        // （解锁是严格顺序推进的），留着是为了将来规则放宽时不至于白屏。
        const node = mkCircle(parent, NODE_D, C.SURFACE, C.SURFACE_A_STRONG,
            C.EDGE, C.EDGE_A_NODE, RING_DEF_W);
        setPos(node, x, y);
        setPos(mkLabel(node, `${lv.n}`, {
            size: ID_S, color: C.INK, bold: true, font: 'kai', lineHeight: ID_LH,
        }).node, 0, ID_Y);
        pressable(node, onTap, this);
    }

    /**
     * 已通关节点 = **奖杯 + 三星**。
     *
     * 【为什么没有底圈】用户原话是「使用简易奖杯来**代替外面的圆圈**」——
     *   圆圈原本承担的"这一格有内容"由奖杯接管了，再画一圈反而像"把奖杯框住了"。
     *   代价：小径的淡红虚线不再被圆盘挡住，会从奖杯上下缘"穿"过去。
     *   实测这反而好读 —— 奖杯实心部分盖住线，露出来的只有杯耳两侧，
     *   视觉上像"奖杯骑在路线上"，比"圆圈 + 图标"少一层套娃。
     *
     * 【为什么关号不见了】方案图里 ①②③ 是三个**互斥**的内容备选
     *   （纯图标 / 关号 / 星级），用户选 ③ ⇒ 保留的是**星级**。
     *   地图本来就是按顺序数着往下走的，"第几关"从位置就能读出来；
     *   而"拿了几颗星"才是这一格唯一无法从位置推出来的信息。
     *
     * 【星为什么在奖杯**上方**】沿用本页原有版式（星在上、序号在下、整块居中），
     *   只是"序号"被奖杯替掉了 —— 新旧布局同源，不会让星星忽上忽下。
     *   整块高 64（星槽 11 + 奖杯 53）仍装得进 68 的节点。
     */
    private buildTrophyNode(parent: Node, lv: LevelDef, x: number, y: number,
                            onTap: () => void): void {
        const C = CFG.COLOR;
        const holder = mkNode('node-done', parent, NODE_D, NODE_D);
        setPos(holder, x, y);

        const sp = mkSprite(holder, TROPHY_TEX, TROPHY_W, Math.round(TROPHY_W * TROPHY_AR));
        setPos(sp.node, 0, TROPHY_Y);

        // 三星：与章节页同一条口径 —— 未点亮是**同一字形换颜色**，不是空心 ☆
        // （原型漏写 `.n-st .off` 规则，2 星与 3 星会只差位置不差颜色，见本页旧注释）
        // ★ 通关但 0 星时**一颗都不画**（原型 `st ? starStr(st) : ''`）
        const stars = Save.stars(lv.n);
        if (stars > 0) {
            const pitch = ST_S + ST_LS;                 // 9 + (−0.5) = 8.5 设计px
            for (let s = 0; s < 3; s++) {
                setPos(mkLabel(holder, '★', {
                    size: ST_S, color: s < stars ? C.GOLD : C.GOLD_L,
                    font: 'hei', lineHeight: ST_SLOT_H,
                }).node, pitch * (s - 1), STAR_Y_DONE);
            }
        }
        pressable(holder, onTap, this);
    }

    /**
     * 当前可攻打的节点 = **山峦 + 关号**。
     *
     * 【为什么红圈还在】那颗呼吸光圈是"当前关"唯一的**动态**提示，与底图无关；
     *   山峦替掉的是**静态白圆**，不是这个环 —— 环由 cur-pulse 图层单独绘制，
     *   本方法一行都不用管它。
     *
     * 【关号为什么骑在山脚上】山只有约 33 设计px 高（贴图 256×127 很扁），
     *   把 19 号字独立排一行会把整块顶出节点；叠在山的下缘既保住了字号，
     *   又让"数字 + 山"读成**一个**标记，而不是两个挨着的元素。
     *
     * ⚠️ 数字压在山体（近山 #4A555F，亮度 ≈84）上，纯墨色对比不足 ⇒
     *    必须加**白描边**把字从山体上"托"出来。这不是装饰，是可读性刚需。
     */
    private buildMountNode(parent: Node, lv: LevelDef, x: number, y: number,
                           onTap: () => void): void {
        const C = CFG.COLOR;
        const holder = mkNode('node-cur', parent, NODE_D, NODE_D);
        setPos(holder, x, y);

        const sp = mkSprite(holder, MOUNT_TEX, MOUNT_W, Math.round(MOUNT_W * MOUNT_AR));
        setPos(sp.node, 0, MOUNT_Y);

        const lb = mkLabel(holder, `${lv.n}`, {
            size: ID_S, color: C.INK, bold: true, font: 'kai', lineHeight: ID_LH,
        });
        // ★ 用 Label **自带的**描边属性，不要 addComponent(LabelOutline) ——
        //   后者在 Cocos 3.8 已废弃，每创建一次就打两条 deprecation warning
        //   （实测：`LabelOutline.color` 与 `LabelOutline.width` 各一条）。
        //   功能相同，但走自带属性少两个组件、也不刷屏。
        lb.outlineColor = hex('#FFFFFF');
        lb.outlineWidth = Math.max(1, Math.round(px(1.6)));
        setPos(lb.node, 0, MOUNT_ID_Y);

        pressable(holder, onTap, this);
    }

    /**
     * 锁定态的节点 = 淡底盘 + Q 版锁。
     *
     * 底盘**保留**：蛇形小径是靠一圈圈等大的节点连起来读成"路"的，
     * 全换成形状不一的图标，路的节奏就散了。锁叠在圆内、留 5 设计px 的边。
     *
     * 透明度挂在 **holder** 上，不是分别挂底盘和锁 —— UIOpacity 会让子节点
     * 一起乘，一份就够；挂两处反而容易漏掉后来新增的子节点。
     */
    private buildLockedNode(parent: Node, x: number, y: number,
                            playable: boolean, onTap: () => void): void {
        const C = CFG.COLOR;
        const holder = mkNode('node-locked', parent, NODE_D, NODE_D);
        setPos(holder, x, y);
        mkCircle(holder, NODE_D, C.SURFACE, C.SURFACE_A_STRONG, C.EDGE, C.EDGE_A_NODE, RING_DEF_W);
        // ⚠️ mkSprite 内部用 SizeMode.CUSTOM 钉尺寸（理由见它的注释）；
        //    高必须按贴图原始宽高比算，硬拉成正方形锁会变扁。
        const sp = mkSprite(holder, LOCK_TEX, LOCK_W, Math.round(LOCK_W * LOCK_AR));
        setPos(sp.node, 0, 0);
        holder.addComponent(UIOpacity).opacity = playable ? LOCK_A_UNLOCKED : LOCK_A_UNPLAYABLE;
        pressable(holder, onTap, this);
    }
}

// ------------------------------------------------------------
/** 三列轮转的横坐标：0 = 左，1 = 中，2 = 右（原型 justify-content flex-start/center/flex-end + padding 20） */
function colX(col: number, W: number): number {
    if (col === 1) return 0;
    return col === 0
        ? -W / 2 + ROW_PAD_X + NODE_D / 2
        : W / 2 - ROW_PAD_X - NODE_D / 2;
}

/** 第 i 个节点的圆心（content 局部坐标） */
function nodeCenter(i: number, col: number, W: number, contentH: number): { x: number; y: number } {
    return {
        x: colX(col, W),
        y: contentH / 2 - (LIST_PAD_T + ROW_STEP * i + NODE_D / 2),
    };
}

function chapterName(ch: number): string {
    const c = CHAPTERS.find((x) => x.id === ch);
    return c ? c.name : `第 ${ch} 章`;
}

function clamp(v: number, lo: number, hi: number): number {
    return v < lo ? lo : (v > hi ? hi : v);
}
