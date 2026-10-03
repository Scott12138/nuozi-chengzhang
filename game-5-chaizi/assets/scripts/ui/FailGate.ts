/**
 * ============================================================
 *  FailGate.ts · 时间到弹层（含「看视频复活 +30 秒」）
 * ============================================================
 *  【为什么失败不做成独立页，而是对局页里的常驻弹层】
 *  设计稿有一张独立的 `#s-fail` 屏（功亏一篑 / ✧✧✧ / 时间到了 / 看视频复活…）。
 *  但那个版式**在工程上做不到"复活"**：切页会 `destroy()` 掉对局页整棵节点，
 *  盘面（每个格、每张牌的 r/c、已成字列表、步数）随对象一起没了。
 *  想复活就得先做一套完整的状态序列化 + 反序列化 —— 那是另一个量级的工作。
 *
 *  做成弹层就没这个问题：对局页从头到尾**没有被销毁**，盘面数据原样在场，
 *  复活只需要把 `_deadline` 往后推 30 秒、把 `_finished/_busy` 复位、重启计时器。
 *  用户 2026-10-02 拍板选的就是这条（"失败页用页内弹层"）。
 *
 *  【它和 AdGate 的关系】
 *  同一个设计语言（遮罩 + 白卡 + 朱砂主按钮 + 半透明次按钮），但内容不同：
 *  AdGate 是「标题 + 两行说明 + 主 + 次」，这里是「标签 + 三颗空星 + 标题 +
 *  一行说明 + 两项统计 + 三个按钮」。硬塞进 AdGate 会让那个组件的参数变成
 *  一堆可选开关，所以单独一个类，但构造方式与 AdGate 逐行同构 —— 改版式时两边一起看。
 *
 *  【遮罩必须吃掉手势】
 *  Cocos 的触摸派发看的是"UITransform 命中 + 节点有没有挂监听"，
 *  光画一层深色底**挡不住**事件，必须给遮罩挂一个什么都不做的 TOUCH_START。
 *  （同 AdGate 的注释 —— 少这一行的表现是"弹层下面还能拖动棋盘"。）
 *
 *  【为什么主按钮文案是「看视频复活」而不是「看视频复活 +30 秒」】
 *  Graphics 不做裁剪 —— 文字超出按钮宽度就是**真的画到卡片外面去**。
 *  按 `estWidth` 估：`＋30 秒` 那一段在 px(17) 字号下要多占 ~85 设备px，
 *  257 宽的按钮装不下（"看视频复活 +30 秒" ≈ 288）。所以把加时信息下移成
 *  一行说明，按钮只留动作词 —— 与设计稿的按钮文案也一致。
 * ============================================================
 */

import { Graphics, Label, Node, log } from 'cc';
import { CFG, px } from '../CFG';
import { hex, mkCard, mkGhostBtn, mkLabel, mkNode, mkPrimaryBtn, setPos } from './UIFactory';

// ------------------------------------------------------------
//  版式（设计稿 px）
// ------------------------------------------------------------
const CARD_W = 300;
const PAD_X = 22;
/** 按钮宽 = 卡片宽 − 两侧内距 */
const BTN_W = CARD_W - PAD_X * 2;             // 256
const PAD_TOP = 24, PAD_BOT = 24;

// .res-tag{font-family:var(--kai);font-size:15px;color:var(--ink2);letter-spacing:7px}
const TAG_S = 15, TAG_LS = 7, TAG_LH = 21;

// .res-stars 的小号版（弹层要压得住，不照搬 34px）
const STAR_S = 24, STAR_H = 30, STAR_GAP = 8, STAR_MT = 8;
const STAR_STEP = STAR_S + STAR_GAP;

// .res-title{font-family:var(--kai);font-size:25px;font-weight:700;letter-spacing:4px}
const TITLE_S = 25, TITLE_LS = 4, TITLE_LH = 34, TITLE_MT = 8;

// 说明行（AdGate 的 .body 同源：13.5px 灰字）
const BODY_S = 13.5, BODY_LH = 19, BODY_MT = 6;

// .res-stats{display:flex;justify-content:center;gap:26px;font-size:12px}
// .res-stats b{display:block;font-family:var(--kai);font-size:20px;color:var(--red)}
const STAT_B_S = 20, STAT_L_S = 12, STAT_B_LH = 27, STAT_L_LH = 16, STAT_GAP = 26;
const STAT_BLOCK = STAT_B_LH + STAT_L_LH;
const STAT_MT = 12;

// .res-btns{display:flex;flex-direction:column;gap:10px}
const BTN_H = 50, GHOST_H = 44, BTN_GAP = 10, BTN_MT = 20;

/** 卡片高度由上面全部行高相加得出 —— 与 ResultPage 同一套算法，别改成写死 */
const CARD_H = PAD_TOP + TAG_LH + STAR_MT + STAR_H + TITLE_MT + TITLE_LH
    + BODY_MT + BODY_LH + STAT_MT + STAT_BLOCK + BTN_MT
    + BTN_H + BTN_GAP + GHOST_H + BTN_GAP + GHOST_H + PAD_BOT;

export interface FailGateOpts {
    /** 本关合出的不同字数 */
    words: number;
    /** 还没合出来的牌数（非干扰牌） */
    left: number;
}

export class FailGate {

    private _root: Node;
    private _wordVal!: Label;
    private _leftVal!: Label;
    private _reviveLabel!: Label;
    private _reviveHolder!: Node;

    private _onRevive: () => void = () => { /* show() 时覆盖 */ };
    private _onRetry: () => void = () => { /* show() 时覆盖 */ };
    private _onMap: () => void = () => { /* show() 时覆盖 */ };
    /** 主按钮是否处于"等广告"的禁用态 */
    private _busy = false;

    constructor(root: Node, visW: number, visH: number) {
        const C = CFG.COLOR;

        // ── 遮罩：铺满 + 吃手势 ──
        const scrim = mkNode('failgate-scrim', root, visW, visH);
        setPos(scrim, 0, 0);
        const g = scrim.addComponent(Graphics);
        g.fillColor = hex(C.MASK, C.MASK_A);
        g.rect(-visW / 2, -visH / 2, visW, visH);
        g.fill();
        scrim.on(Node.EventType.TOUCH_START, () => { /* 吞掉，不下传给棋盘 */ });
        this._root = scrim;

        // 面用不透明（压在深色遮罩上，半透明白会发灰）——同 AdGate
        const card = mkCard(scrim, px(CARD_W), px(CARD_H), px(20), 255, C.EDGE_A_MID, true);
        setPos(card, 0, 0);

        // y 游标：从卡片上沿往下排（Cocos y 朝上，所以一路递减）
        let y = px(CARD_H) / 2 - px(PAD_TOP);

        // ① 标签「功 亏 一 篑」
        setPos(mkLabel(card, '功 亏 一 篑', {
            size: px(TAG_S), color: C.INK2, font: 'kai', spacing: px(TAG_LS),
            lineHeight: px(TAG_LH),
        }).node, 0, y - px(TAG_LH) / 2);
        y -= px(TAG_LH) + px(STAR_MT);

        // ② 三颗空星。
        //    ★ 设计稿写的是 `✧ ✧ ✧`（U+2727）。那个字符在 iOS/Android 的中文字体里
        //      覆盖不全，取不到就是方框 —— 所以改用 `★` 涂成"未得星"色（#DCD5C6），
        //      语义（一颗都没拿到）与视觉重量完全一致，且零字体风险。
        for (let i = 0; i < 3; i++) {
            setPos(mkLabel(card, '★', {
                size: px(STAR_S), color: C.OFF_STAR, font: 'hei', lineHeight: px(STAR_H),
            }).node, (i - 1) * px(STAR_STEP), y - px(STAR_H) / 2);
        }
        y -= px(STAR_H) + px(TITLE_MT);

        // ③ 标题「时间到了」
        setPos(mkLabel(card, '时间到了', {
            size: px(TITLE_S), color: C.INK, bold: true, font: 'kai',
            spacing: px(TITLE_LS), lineHeight: px(TITLE_LH),
        }).node, 0, y - px(TITLE_LH) / 2);
        y -= px(TITLE_LH) + px(BODY_MT);

        // ④ 一行说明（把「+30 秒」的信息挂在这儿，见文件头）
        setPos(mkLabel(card, '看一段广告，原地接着打，时间 +30 秒', {
            size: px(BODY_S), color: C.INK2, font: 'hei',
            lineHeight: px(BODY_LH), autoWidth: false, width: px(BTN_W),
        }).node, 0, y - px(BODY_LH) / 2);
        y -= px(BODY_LH) + px(STAT_MT);

        // ⑤ 两项统计：已成字 / 剩余牌。
        //    `.res-stats{display:flex;gap:26px;justify-content:center}` → 两列各
        //    (BTN_W − 26)/2 宽、间距 26，整组居中 → 列中心距中轴 ±(列宽+间距)/2。
        const colW = (BTN_W - STAT_GAP) / 2;
        const off = px((colW + STAT_GAP) / 2);
        this._wordVal = this.buildStat(card, -off, y, '已成字');
        this._leftVal = this.buildStat(card, off, y, '剩余牌');
        y -= px(STAT_BLOCK) + px(BTN_MT);

        // ⑥ 三个按钮
        this._reviveHolder = mkPrimaryBtn(card, px(BTN_W), px(BTN_H), '看视频复活', () => {
            if (this._busy) return;                 // 等广告期间连点无效
            this._onRevive();
        }, this, px(17), px(1));
        setPos(this._reviveHolder, 0, y - px(BTN_H) / 2);
        this._reviveLabel = firstLabel(this._reviveHolder);
        y -= px(BTN_H) + px(BTN_GAP);

        setPos(mkGhostBtn(card, px(BTN_W), px(GHOST_H), '重来一局',
            () => this._onRetry(), this, px(14.5), px(1)), 0, y - px(GHOST_H) / 2);
        y -= px(GHOST_H) + px(BTN_GAP);

        setPos(mkGhostBtn(card, px(BTN_W), px(GHOST_H), '返回地图',
            () => this._onMap(), this, px(14.5), px(1)), 0, y - px(GHOST_H) / 2);

        this._root.active = false;
    }

    /**
     * 一列统计：大号朱砂数字在上、灰色小字在下（设计稿 `.res-stats b` 是 block）。
     * @returns 数字那行的 Label（show() 时改文字用）
     */
    private buildStat(card: Node, cx: number, yTop: number, label: string): Label {
        const C = CFG.COLOR;
        const val = mkLabel(card, '0', {
            size: px(STAT_B_S), color: C.RED, bold: true, font: 'kai',
            lineHeight: px(STAT_B_LH),
        });
        setPos(val.node, cx, yTop - px(STAT_B_LH) / 2);
        setPos(mkLabel(card, label, {
            size: px(STAT_L_S), color: C.INK2, font: 'hei', lineHeight: px(STAT_L_LH),
        }).node, cx, yTop - px(STAT_B_LH) - px(STAT_L_LH) / 2);
        return val;
    }

    get visible(): boolean {
        return !!this._root && this._root.isValid && this._root.active;
    }

    get busy(): boolean { return this._busy; }

    show(opts: FailGateOpts, onRevive: () => void, onRetry: () => void, onMap: () => void): void {
        if (!this._root || !this._root.isValid) return;
        this._onRevive = onRevive;
        this._onRetry = onRetry;
        this._onMap = onMap;
        this._busy = false;

        this._wordVal.string = String(opts.words);
        this._leftVal.string = String(opts.left);
        this._reviveLabel.string = '看视频复活';
        this._reviveHolder.setScale(1, 1, 1);

        this._root.active = true;
        // ★ 与 AdGate 的日志**同构**（`[AdGate] 弹出：<标题> / <按钮>`）：
        //   tools/web-smoke.mjs 的 `gate:` 动作用一条正则同时覆盖两种弹层，
        //   断言脚本不必为"卡住"和"时间到"写两套。
        if (CFG.DEBUG.LOG_STATE) log('[FailGate] 弹出：时间到了 / ' + this._reviveLabel.string);
    }

    hide(): void {
        if (!this._root || !this._root.isValid) return;
        this._root.active = false;
        this._busy = false;
        if (CFG.DEBUG.LOG_STATE) log('[FailGate] 关闭');
    }

    /** 广告拉取期间锁住主按钮并改文案；传 null 解锁 */
    setBusy(text: string | null): void {
        this._busy = !!text;
        if (this._reviveLabel && this._reviveLabel.isValid && text) this._reviveLabel.string = text;
        if (this._reviveHolder && this._reviveHolder.isValid) {
            this._reviveHolder.setScale(this._busy ? 0.97 : 1, this._busy ? 0.97 : 1, 1);
        }
    }

    dispose(): void {
        if (this._root && this._root.isValid) this._root.destroy();
    }
}

/** 取子树里第一个 Label（与 AdGate 同一实现，理由见那边的注释） */
function firstLabel(n: Node): Label {
    for (const ch of n.children) {
        const got = ch.getComponent(Label);
        if (got) return got;
        const deep = firstLabel(ch);
        if (deep) return deep;
    }
    return null as unknown as Label;
}
