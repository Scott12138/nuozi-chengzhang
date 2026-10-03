/**
 * ============================================================
 *  Toast.ts · 飘字提示（设计稿 .toast）
 * ============================================================
 *  设计稿：`rgba(43,38,32,.92)` 的深色圆角小条 + `#F6F0E2` 浅字 + `radius:13px`，
 *  居中压在屏幕 52% 高度处。宣纸浅底上，深色小条是**唯一**的提示语言 ——
 *  浅底上再放浅色提示等于没提示。
 *
 *  【为什么收成一个类，而不是每个页面各写一遍】
 *  自己写一遍就会各漏一样东西：要么忘了清定时器（切页后回调打到已销毁的
 *  节点上），要么忘了连续提示时把上一条的定时器清掉（后一条刚显示就被
 *  前一条的超时提前关掉）。这两条都不报错，只是"提示偶尔不出现"。
 *  收成一处，两个坑一次性堵死。
 *
 *  【为什么自己要按内容算高度】
 *  CSS 的 padding + 自动高度是免费的；Graphics 不行 —— 小条的高度得自己画。
 *  所以这里按"估算字宽 → 需要几行 → 高度"来重画底，最多两行（提示语都很短）。
 * ============================================================
 */

import { Graphics, Label, log, Node, UIOpacity } from 'cc';
import { CFG, px } from '../CFG';
import { hex, mkLabel, mkNode, setPos } from './UIFactory';

const S = px(13);                       // 字号（设计稿 13px）
const LH = px(19);                      // 行高（设计稿 line-height:1.6 → 20.8，取整）
const PAD_X = px(17), PAD_Y = px(11);
const MAX_W = px(320);                 // 设计稿 max-width:80%（80% × 390 ≈ 312）

export class Toast {

    private _node: Node;
    private _face: Graphics;
    private _lb: Label;
    private _op: UIOpacity;
    private _timer = 0;

    /**
     * @param root    页面根节点
     * @param visW    可见宽度（用来算 max-width）
     * @param centerY 小条中心相对页面根的 y（设计稿是屏幕 52% 高度处）
     */
    constructor(root: Node, visW: number, centerY: number) {
        const maxW = Math.min(MAX_W, visW * 0.8);
        const box = mkNode('toast', root, maxW, LH + PAD_Y * 2);
        setPos(box, 0, centerY);
        this._face = box.addComponent(Graphics);
        this._op = box.addComponent(UIOpacity);
        this._lb = mkLabel(box, '', {
            size: S, color: CFG.COLOR.TOAST_TX, font: 'hei',
            lineHeight: LH, autoWidth: false, width: maxW - PAD_X * 2,
        });
        this._node = box;
        box.active = false;
        this.redraw('');
    }

    show(msg: string, ms = 2100): void {
        if (!this._node || !this._node.isValid) return;
        this._lb.string = msg;
        this.redraw(msg);
        this._node.active = true;
        this._op.opacity = 255;
        // ★ 提示必须可被观测。工具链（tools/web-smoke.mjs 的 `t:` 动作）靠这行
        //   断言"点了锁定/待开发关卡确实弹了提示"，否则那次点击只能证明
        //   "页面没跳走"，证明不了"玩家看到了原因"。
        if (CFG.DEBUG.LOG_STATE) log('[Toast] ' + msg);
        // ★ 连续提示：先清掉上一条的定时器，否则新的一条会被旧超时提前关掉
        if (this._timer) clearTimeout(this._timer as unknown as number);
        this._timer = setTimeout(() => {
            if (!this._node || !this._node.isValid) return;
            this._node.active = false;
        }, ms) as unknown as number;
    }

    /** 按内容估行数，重画圆角底（1~2 行） */
    private redraw(msg: string): void {
        const g = this._face;
        if (!g || !g.isValid) return;
        const availW = MAX_W - PAD_X * 2;
        const textW = estimateWidth(msg, S);
        // 超过一行就按满宽画两行高 —— 提示语都很短，最多两行足够
        const lines = textW > availW ? 2 : 1;
        const w = lines === 1 ? Math.min(MAX_W, Math.max(px(80), textW + PAD_X * 2)) : MAX_W;
        const h = lines * LH + PAD_Y * 2;

        g.clear();
        g.fillColor = hex(CFG.COLOR.TOAST_BG, CFG.COLOR.TOAST_BG_A);
        g.roundRect(-w / 2, -h / 2, w, h, px(13));
        g.fill();
    }

    /** 页面退出时必须调，否则回调会打到已销毁的节点上 */
    dispose(): void {
        if (this._timer) clearTimeout(this._timer as unknown as number);
        this._timer = 0;
    }
}

/** 粗略字宽：汉字 1em，西文/数字 0.55em。只用来定提示条的宽 */
function estimateWidth(t: string, size: number): number {
    let w = 0;
    for (const ch of t) w += ch.charCodeAt(0) < 128 ? size * 0.55 : size;
    return w;
}
