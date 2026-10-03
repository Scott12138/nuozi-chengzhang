/**
 * ============================================================
 *  ResultPage.ts · 通关结算页（设计稿 #s-clear）
 * ============================================================
 *  竖排内容（设计稿 prototype/index.html 的 #s-clear 原式）：
 *      标签「字 成」 → 三颗星（逐颗 pop） → 标题 → 拆字回顾卡 → 三项统计 → 三个按钮
 *
 *  【它为什么必须存在 —— 这是 2026-10-02 用户报的 bug 的直接修复】
 *  用户截图：四个目标全满（枪 3/3、棍 2/2、锤 2/2、钩 2/2），却**没有出现下一关按钮**。
 *  查下来胜负判定完全正确（`Board.remainingPlayable() === 0` 时确实调了 `finishClear()`）,
 *  坏的是**这一页根本不存在**：
 *      GamePage.finishClear() → PageManager.goto(PAGE_CLEAR, res)
 *      → PageManager 在注册表里找不到 'clear' → 只打一行
 *        `[PageManager] 未注册的页面：clear` 就 return 了
 *  而此刻 `_finished` / `_busy` 已经双双置位 → 整个对局页冻死：拖不动、点不动、也不跳页。
 *  玩家看到的正是"目标全满、盘面还在、什么都没发生"。
 *
 *  ⚠️ 教训（写在这里免得下次再犯）：**切页调用必须与注册表成对存在**。
 *     `PAGES.ts` 里声明了 9 个页面名、`GameRoot.registerPages()` 只注册了 5 个，
 *     而 `goto()` 遇到未注册页面**不抛错、不降级、只记一行 log** ——
 *     于是"少注册一个页面"这种低级错误，症状表现为"玩法逻辑坏了"，
 *     排查方向会被整体带偏。新增页面时请顺手在 registerPages 里加一行。
 *
 *  【版式单位】
 *  本文件所有常量都是**设计稿 px**（就是 prototype 里写的数值），
 *  摆位时统一 `px()` 换算。理由见 CFG.SPEC。
 *
 *  【为什么整块面板要算总高再整体缩放】
 *  设计舞台是 372×762，本工程可见高随机型变（冒烟 600×1260 → 781 设计px）。
 *  正常手机上装得下；但万一遇到矮屏，宁可整体等比缩一点，也不要让按钮被切掉 ——
 *  "下一关点不到"恰恰就是这次要修的 bug，不能换个姿势再犯一遍。
 * ============================================================
 */

import { Graphics, Node, UIOpacity, Vec3, log, tween } from 'cc';
import { CFG, px } from '../CFG';
import { levelByN, WORDS } from '../core/LevelData';
import { canPlay } from '../core/Progress';
import { ResultParam } from '../core/Types';
import { PageBase } from './PageBase';
import { PageManager } from './PageManager';
import { PAGE_CLEAR, PAGE_GAME, PAGE_MAP } from './PAGES';
import { Toast } from './Toast';
import {
    centerBlockTop, estWidth, hex, mkCard, mkGhostBtn, mkLabel, mkNode, mkPaperBG, mkPiece,
    mkPrimaryBtn, setPos, topY, visibleSize,
} from './UIFactory';

// ------------------------------------------------------------
//  版式常量（单位 = 设计稿 px）
// ------------------------------------------------------------
// #s-clear,#s-fail{align-items:center;justify-content:center;padding:0 24px}
const PANEL_W = 372 - 24 * 2;                 // 324

// .res-tag{font-family:var(--kai);font-size:15px;color:var(--ink2);letter-spacing:7px;text-indent:7px}
const TAG_S = 15, TAG_LS = 7, TAG_LH = 21;

// .res-stars{font-size:34px;letter-spacing:8px;margin:12px 0 6px}
const STAR_S = 34, STAR_GAP = 8, STAR_LH = 46, STAR_MT = 12, STAR_MB = 6;
const STAR_STEP = STAR_S + STAR_GAP;          // 42：三颗星的中心间距
/** @keyframes starpop 的延迟：.15s / .3s / .45s（= 0.15 × 序号） */
const STAR_DELAY = 0.15, STAR_POP = 0.42;

// .res-title{font-family:var(--kai);font-size:25px;font-weight:700;letter-spacing:4px;margin:4px 0 18px}
const TITLE_S = 25, TITLE_LS = 4, TITLE_LH = 34, TITLE_MT = 4, TITLE_MB = 18;

// .word-showcase{background:rgba(255,255,255,.8);border-radius:18px;padding:16px 14px;margin:0 auto 18px;max-width:300px}
const SHOW_W = 300, SHOW_R = 18, SHOW_PAD_X = 14, SHOW_PAD_Y = 16, SHOW_MB = 18;
// .ws-row{display:flex;align-items:center;justify-content:center;gap:10px;padding:7px 0}
const ROW_PAD_Y = 7, PIECE = 44, PIECE_GAP = 10, OP_S = 17;
const ROW_H = ROW_PAD_Y * 2 + PIECE;          // 58
/** 设计稿 `word-showcase` 只展示前 4 个字（`runWords.slice(0,4)`） */
const MAX_ROWS = 4;

// .res-stats{display:flex;justify-content:center;gap:26px;margin-bottom:22px;font-size:12px}
// .res-stats b{display:block;font-family:var(--kai);font-size:20px;color:var(--red);font-weight:700}
const STAT_B_S = 20, STAT_L_S = 12, STAT_B_LH = 27, STAT_L_LH = 16;
const STAT_GAP = 26, STAT_MB = 22;
const STAT_BLOCK = STAT_B_LH + STAT_L_LH;     // 43

// .res-btns{display:flex;flex-direction:column;gap:10px} / .home-row{display:flex;gap:11px}
const BTN_H = 54, BTN_R_H = 51, BTN_GAP = 10, ROW_GAP = 11;

/** 副标题：设计稿 `stars===3 ? '妙手成字' : (stars===2 ? '顺利通关' : '惊险过关')` */
const TITLES = ['惊险过关', '惊险过关', '顺利通关', '妙手成字'];

export class ResultPage extends PageBase {

    readonly pageName = PAGE_CLEAR;

    private _res!: ResultParam;
    private _toast!: Toast;

    protected onCreate(param?: ResultParam): void {
        const C = CFG.COLOR;
        const vs = visibleSize();
        const res = param || emptyResult();

        // 页面底：宣纸径向渐变（与首页/章节页同源）
        mkPaperBG(this._root, vs.w, vs.h, C.BG_TOP, C.BG_MID, C.BG_BOT);

        // ── 面板：整块算高 → 在可见区里垂直居中 ──
        const rows = Math.min(MAX_ROWS, res.runWords.length);
        const showH = SHOW_PAD_Y * 2 + rows * ROW_H + Math.max(0, rows - 1) * 1;
        const totalH = TAG_LH
            + (STAR_MT + STAR_LH + STAR_MB)
            + (TITLE_MT + TITLE_LH + TITLE_MB)
            + (showH + SHOW_MB)
            + (STAT_BLOCK + STAT_MB)
            + (BTN_H + BTN_GAP + BTN_R_H);

        const panel = mkNode('res-panel', this._root, px(PANEL_W), px(totalH));
        const panelTop = centerBlockTop(vs.h, 0, px(totalH));
        setPos(panel, 0, topY(vs.h, panelTop + px(totalH) / 2));
        // 装不下时整体缩一点（宁可小，也不能让「下一关」被切到屏幕外）
        const fit = px(totalH) <= vs.h ? 1 : (vs.h / px(totalH)) * 0.98;
        if (fit < 1) {
            panel.setScale(fit, fit, 1);
            log(`[ResultPage] 面板高 ${Math.round(px(totalH))}px > 可见高 ${Math.round(vs.h)}px，整体缩到 ${fit.toFixed(3)}`);
        }

        // y 游标：从面板上沿往下排（Cocos y 朝上，所以是递减）
        let y = px(totalH) / 2;

        // ── ① 标签「字 成」──
        setPos(mkLabel(panel, '字 成', {
            size: px(TAG_S), color: C.INK2, font: 'kai', spacing: px(TAG_LS),
            lineHeight: px(TAG_LH),
        }).node, 0, y - px(TAG_LH) / 2);
        y -= px(TAG_LH);

        // ── ② 三颗星（得星的逐颗 pop，未得的灰着不动）──
        y -= px(STAR_MT);
        const starY = y - px(STAR_LH) / 2;
        for (let i = 0; i < 3; i++) {
            const on = i < res.stars;
            const lb = mkLabel(panel, '★', {
                size: px(STAR_S), color: on ? C.GOLD : C.OFF_STAR, font: 'hei',
                lineHeight: px(STAR_LH),
            });
            setPos(lb.node, (i - 1) * px(STAR_STEP), starY);
            if (on) this.popStar(lb.node, i);
        }
        y -= px(STAR_LH) + px(STAR_MB);

        // ── ③ 标题 ──
        y -= px(TITLE_MT);
        setPos(mkLabel(panel, TITLES[Math.max(0, Math.min(3, res.stars))], {
            size: px(TITLE_S), color: C.INK, bold: true, font: 'kai',
            spacing: px(TITLE_LS), lineHeight: px(TITLE_LH),
        }).node, 0, y - px(TITLE_LH) / 2);
        y -= px(TITLE_LH) + px(TITLE_MB);

        // ── ④ 拆字回顾卡 ──
        this.buildShowcase(panel, res, y - px(showH) / 2, px(showH), rows);
        y -= px(showH) + px(SHOW_MB);

        // ── ⑤ 三项统计 ──
        this.buildStats(panel, res, y);
        y -= px(STAT_BLOCK) + px(STAT_MB);

        // ── ⑥ 按钮 ──
        const next = mkPrimaryBtn(panel, px(PANEL_W), px(BTN_H), '下一关',
            () => this.onNext(), this, px(17), px(1));
        setPos(next, 0, y - px(BTN_H) / 2);
        y -= px(BTN_H) + px(BTN_GAP);

        const half = (PANEL_W - ROW_GAP) / 2;
        const retry = mkGhostBtn(panel, px(half), px(BTN_R_H), '再来一次',
            () => this.onRetry(), this, px(14.5), px(1));
        setPos(retry, -(px(half) / 2 + px(ROW_GAP) / 2), y - px(BTN_R_H) / 2);
        const back = mkGhostBtn(panel, px(half), px(BTN_R_H), '返回地图',
            () => this.onBackMap(), this, px(14.5), px(1));
        setPos(back, px(half) / 2 + px(ROW_GAP) / 2, y - px(BTN_R_H) / 2);
        y -= px(BTN_R_H);

        // ── 飘字（覆盖层最后挂，保证压在面板之上）──
        this._toast = new Toast(this._root, vs.w, topY(vs.h, vs.h * 0.52));
        this._res = res;

        // ★ 这行是给冒烟工具链用的：`p:clear` 只能证明"页面切过来了"，
        //   证明不了"结算内容真的按本局数据渲染了"。星级/用时一并回显便于逐值比对。
        log(`[ResultPage] 结算 L${res.level}：${res.stars} 星，用时 ${res.leftSec}/${res.totalSec}s，`
            + `挪动 ${res.moves}，成字 ${res.words}，展示 ${rows} 行拆字`);
    }

    onExit(): void {
        if (this._toast) this._toast.dispose();
        super.onExit();
    }

    // ============================================================
    //  分区构建
    // ============================================================
    /**
     * 拆字回顾卡：每行 `偏旁 ＋ 部件 ＝ 合成字`，行间一条 1px 虚线
     * （设计稿 `.ws-row+.ws-row{border-top:1px dashed rgba(150,130,95,.3)}`）。
     * 三个字块直接复用 mkPiece —— 它已经把设计稿的渐变/底边厚度/纸影封好了，
     * 在这里重画一遍就是"棱角"的来源（同 AdGate 的注释）。
     */
    private buildShowcase(panel: Node, res: ResultParam, cy: number,
                          showH: number, rows: number): void {
        const C = CFG.COLOR;
        const card = mkCard(panel, px(SHOW_W), showH, px(SHOW_R),
            C.SURFACE_A_SOFT, C.EDGE_A_SOFT, true);
        setPos(card, 0, cy);

        const innerW = px(SHOW_W) - px(SHOW_PAD_X) * 2;
        // 一行内的横向布局：3 块 + 2 个运算符，块间 10px
        const gap = px(PIECE_GAP), pw = px(PIECE), opW = Math.max(px(OP_S), px(OP_S));
        const rowW = pw * 3 + opW * 2 + gap * 4;

        for (let i = 0; i < rows; i++) {
            const rw = res.runWords[i];
            const split = WORDS[rw.w];
            // 行中心（自上而下）：卡片上沿 − 内距 − 半行高 − 已占行高
            const rowY = showH / 2 - px(SHOW_PAD_Y) - px(ROW_H) / 2 - i * px(ROW_H);

            if (i > 0) dashedLine(card, innerW, rowY + px(ROW_H) / 2 - px(0.5),
                C.EDGE, 77);      // rgba(150,130,95,.3)

            if (!split) continue;  // 数据缺字：生成期已自检，这里只兜底不画
            let x = -rowW / 2;
            setPos(mkPiece(card, pw, 'r', split.a), x + pw / 2, rowY);
            x += pw + gap;
            setPos(mkLabel(card, '＋', {
                size: px(OP_S), color: C.INK3, font: 'hei',
            }).node, x + opW / 2, rowY);
            x += opW + gap;
            setPos(mkPiece(card, pw, 'p', split.b), x + pw / 2, rowY);
            x += pw + gap;
            setPos(mkLabel(card, '＝', {
                size: px(OP_S), color: C.INK3, font: 'hei',
            }).node, x + opW / 2, rowY);
            x += opW + gap;
            // 合成字用朱砂块、字号大一点（设计稿 `.ws-piece.w{font-size:26px}`）
            setPos(mkPiece(card, pw, 'w', rw.w, px(26)), x + pw / 2, rowY);
        }
    }

    /**
     * 三项统计：用时 / 挪动 / 成字。
     * 设计稿是 `display:flex;gap:26px;justify-content:center` —— flex 项是内容宽，
     * 所以这里用 estWidth 估出各列宽度再整体居中（Cocos 没有 flex）。
     */
    private buildStats(panel: Node, res: ResultParam, yTop: number): void {
        const C = CFG.COLOR;
        const items: { v: string; l: string }[] = [
            { v: String(Math.max(0, res.totalSec - res.leftSec)) + 's', l: '用时' },
            { v: String(res.moves), l: '挪动' },
            { v: String(res.words), l: '成字' },
        ];
        const ws = items.map((it) => Math.max(
            estWidth(it.v, px(STAT_B_S)), estWidth(it.l, px(STAT_L_S))));
        const totalW = ws.reduce((a, b) => a + b, 0) + px(STAT_GAP) * (items.length - 1);

        let x = -totalW / 2;
        for (let i = 0; i < items.length; i++) {
            const cx = x + ws[i] / 2;
            setPos(mkLabel(panel, items[i].v, {
                size: px(STAT_B_S), color: C.RED, bold: true, font: 'kai',
                lineHeight: px(STAT_B_LH),
            }).node, cx, yTop - px(STAT_B_LH) / 2);
            setPos(mkLabel(panel, items[i].l, {
                size: px(STAT_L_S), color: C.INK2, font: 'hei',
                lineHeight: px(STAT_L_LH),
            }).node, cx, yTop - px(STAT_B_LH) - px(STAT_L_LH) / 2);
            x += ws[i] + px(STAT_GAP);
        }
    }

    /**
     * `@keyframes starpop{from{scale(0) rotate(-45deg);opacity:0} to{scale(1) rotate(0);opacity:1}}`
     * —— 用 backOut 近似那个"弹一下"的手感。
     * 必须给节点挂 UIOpacity：直接 tween Label 的 color alpha 会连带改掉字号缓存。
     */
    private popStar(n: Node, i: number): void {
        const op = n.addComponent(UIOpacity);
        op.opacity = 0;
        n.setScale(0, 0, 1);
        n.angle = -45;
        const delay = STAR_DELAY * (i + 1);
        tween(n)
            .delay(delay)
            .to(STAR_POP, { scale: new Vec3(1, 1, 1), angle: 0 }, { easing: 'backOut' })
            .start();
        tween(op).delay(delay).to(0.2, { opacity: 255 }).start();
    }

    // ============================================================
    //  按钮
    // ============================================================
    /**
     * 下一关。
     * ★ 判据走 `canPlay`（可玩 + 本章已解锁）而不是简单的 `n+1 <= LEVELS.length`：
     *   它替我们兜住了两种"点不动"的情况，而这两种的**文案必须分开**：
     *     ① 已经是最后一关（`n+1` 超出关卡表）→ 玩家通关了整本，要说"全通了"；
     *     ② `n+1` 还没解锁 → 说"先通过前面的关卡"。
     *   ★ 2026-10-03 解封到 38 关之前，这里两种都笼统说成"首版就到这里" ——
     *     解封之后那句话对最后一关就是错的（玩家明明通关了，却被告知"还在做"）。
     */
    private onNext(): void {
        const nx = this._res.level + 1;
        if (!canPlay(nx)) {
            const isLast = !levelByN(nx);
            log(`[ResultPage] 下一关 L${nx} ${isLast ? '已是最后一关' : '不可玩/未解锁'} → 提示后返回地图`);
            this._toast.show(isLast ? '已经是最后一关\n整本字帖都拆完了' : '先通过前面的关卡');
            this.timer(() => PageManager.goto(PAGE_MAP), 1200);
            return;
        }
        log(`[ResultPage] 下一关 → L${nx}`);
        PageManager.goto(PAGE_GAME, { level: nx });
    }

    private onRetry(): void {
        log(`[ResultPage] 再来一次 → L${this._res.level}`);
        PageManager.goto(PAGE_GAME, { level: this._res.level });
    }

    private onBackMap(): void {
        log('[ResultPage] 返回地图');
        PageManager.goto(PAGE_MAP);
    }
}

// ------------------------------------------------------------
//  小工具
// ------------------------------------------------------------
/**
 * 一条水平虚线（设计稿 `border-top:1px dashed`）。
 * Graphics 没有 dash 支持，用一段段短横线拼 —— 段长/间距取 4px/3px：
 * 再密就是实线，再疏就看不出是虚线。
 */
function dashedLine(parent: Node, w: number, y: number, color: string, alpha: number): void {
    const n = mkNode('dashed', parent, w, px(1));
    setPos(n, 0, y);
    const g = n.addComponent(Graphics);
    g.strokeColor = hex(color, alpha);
    g.lineWidth = px(1);
    const dash = px(4), step = px(7);
    for (let x = -w / 2; x < w / 2 - dash; x += step) {
        g.moveTo(x, 0);
        g.lineTo(x + dash, 0);
    }
    g.stroke();
}

/** 缺参兜底：正常情况下 param 一定是 GamePage 传的，这里只为"直接跳过来"不炸 */
function emptyResult(): ResultParam {
    return {
        win: true, level: 1, leftSec: 0, totalSec: 0, stars: 0,
        moves: 0, words: 0, runWords: [], leftWords: 0,
    };
}
