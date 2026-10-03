/**
 * ============================================================
 *  AdGate.ts · 看广告兜底弹层（死局重排 / 未来可复用于失败复活）
 * ============================================================
 *  【它解决什么】
 *  玩法改成严格回弹之后，「盘面走进死局」是**正常状态**而不是玩家的失误
 *  （完整搜索的结论见 ui/AdService.ts 的说明）。这时必须让玩家看清两件事：
 *  「为什么走不动了」和「有一条什么出路」。只弹一句 toast 是不够的 ——
 *  玩家会以为卡 bug 了，直接退游戏。
 *
 *  【为什么做成可 show/hide 的常驻节点，而不是像 Toast 那样自取自销】
 *  ① 它是**模态**：弹出期间不能碰到下面的棋盘。Cocos 的触摸派发按
 *     "UITransform 命中 + 该节点是否挂了监听器"来决定，所以光画一层深色底
 *     **挡不住**事件，必须给遮罩挂一个什么都不做的 TOUCH_START 把命中吃掉。
 *  ② 节点常驻、只切 active，比每次现拼一遍省事，也给未来的失败页复用留了口子。
 *
 *  【版式】
 *  遮罩铺满可见区（CFG.COLOR.MASK / MASK_A），卡片居中：
 *      朱砂标题  →  两行说明  →  朱砂主按钮  →  半透明次按钮
 *  面/边/影全部交给 mkCard + mkPrimaryBtn + mkGhostBtn —— 它们已经把设计稿的
 *  圆角、描边、纸影封好了，不在这里重画第二遍（重画就是"棱角"的来源）。
 *
 *  【一个必须注意的点：说明文字要按节点宽度换行】
 *  用 `autoWidth:false + width`，让 Label 自己折行。否则长句会横着溢出一大截 ——
 *  Graphics 不做裁剪，溢出就是真的画到卡片外面去了。
 * ============================================================
 */

import { Graphics, Label, Node, log } from 'cc';
import { CFG, px } from '../CFG';
import { hex, mkCard, mkGhostBtn, mkLabel, mkNode, mkPrimaryBtn, setPos } from './UIFactory';

/** 卡片与内部间距（设计px） */
const CARD_W = 300;
const CARD_H = 250;
const PAD_X = 22;
/** 按钮宽 = 卡片宽 − 两侧内距；高度取设计稿里主/次按钮的常见值 */
const BTN_W = CARD_W - PAD_X * 2;
const BTN_H = 46;
const GHOST_H = 40;

export interface AdGateOpts {
    /** 标题，如「卡住了」 */
    title: string;
    /** 说明行（逐行给，避免自动折行位置不可控） */
    lines: string[];
    /** 主按钮文案，如「看广告重排」 */
    actionText: string;
    /** 次按钮文案，如「返回地图」 */
    backText: string;
}

export class AdGate {

    private _root: Node;
    private _title: Label;
    private _body: Label;
    private _actionLabel: Label;
    private _actionHolder: Node;
    private _backLabel: Label;

    private _onAction: () => void = () => { /* show() 时覆盖 */ };
    private _onBack: () => void = () => { /* show() 时覆盖 */ };
    /** 主按钮是否处于"等广告"的禁用态 */
    private _busy = false;

    /**
     * @param root 页面根节点（弹层挂在它最上层）
     * @param visW 可见宽（设计px，用于遮罩尺寸）
     * @param visH 可见高（设计px）
     */
    constructor(root: Node, visW: number, visH: number) {
        const C = CFG.COLOR;

        // ── 遮罩：铺满 + 吃手势 ──
        const scrim = mkNode('adgate-scrim', root, visW, visH);
        setPos(scrim, 0, 0);
        const g = scrim.addComponent(Graphics);
        g.fillColor = hex(C.MASK, C.MASK_A);
        g.rect(-visW / 2, -visH / 2, visW, visH);
        g.fill();
        scrim.on(Node.EventType.TOUCH_START, () => { /* 吞掉，不下传给棋盘 */ });
        this._root = scrim;

        // ── 卡片 ──
        // 面用**不透明**（alpha 255）：弹层压在深色遮罩上，半透明白会发灰、字看不清。
        const card = mkCard(scrim, px(CARD_W), px(CARD_H), px(20), 255, C.EDGE_A_MID, true);
        setPos(card, 0, 0);

        this._title = mkLabel(card, '', {
            size: px(21), color: C.RED, bold: true, font: 'kai',
            lineHeight: px(28), autoWidth: false, width: px(BTN_W),
        });
        setPos(this._title.node, 0, px(84));

        this._body = mkLabel(card, '', {
            size: px(13.5), color: C.INK2, font: 'hei',
            lineHeight: px(21), autoWidth: false, width: px(BTN_W),
        });
        setPos(this._body.node, 0, px(34));

        this._actionHolder = mkPrimaryBtn(card, px(BTN_W), px(BTN_H), '', () => {
            if (this._busy) return;                     // 等广告期间连点无效
            this._onAction();
        }, this, px(17), px(1));
        setPos(this._actionHolder, 0, px(-38));
        this._actionLabel = firstLabel(this._actionHolder);

        const ghost = mkGhostBtn(card, px(BTN_W), px(GHOST_H), '', () => this._onBack(),
            this, px(14.5), px(1));
        setPos(ghost, 0, px(-92));
        this._backLabel = firstLabel(ghost);

        this._root.active = false;
    }

    get visible(): boolean {
        return !!this._root && this._root.isValid && this._root.active;
    }

    get busy(): boolean { return this._busy; }

    /**
     * 弹出。
     * @param onAction 主按钮（看广告）—— 由调用方负责拉起 AdService
     * @param onBack   次按钮（返回地图）
     */
    show(opts: AdGateOpts, onAction: () => void, onBack: () => void): void {
        if (!this._root || !this._root.isValid) return;
        this._onAction = onAction;
        this._onBack = onBack;
        this._busy = false;

        this._title.string = opts.title;
        this._body.string = opts.lines.join('\n');
        this._actionLabel.string = opts.actionText;
        this._backLabel.string = opts.backText;
        this._actionHolder.setScale(1, 1, 1);

        this._root.active = true;
        // 与 Toast 同理：必须能被工具链观测到，否则冒烟只能证明"页面没跳走"，
        // 证明不了"玩家看到出路了"。
        if (CFG.DEBUG.LOG_STATE) log('[AdGate] 弹出：' + opts.title + ' / ' + opts.actionText);
    }

    hide(): void {
        if (!this._root || !this._root.isValid) return;
        this._root.active = false;
        this._busy = false;
        if (CFG.DEBUG.LOG_STATE) log('[AdGate] 关闭');
    }

    /**
     * 广告拉取/播放期间锁住主按钮并改文案，结束后传 null 收尾。
     * @param text null = 解锁（保持当前文案不变，由下一次 show 重置）
     */
    setBusy(text: string | null): void {
        this._busy = !!text;
        if (this._actionLabel && this._actionLabel.isValid && text) this._actionLabel.string = text;
        if (this._actionHolder && this._actionHolder.isValid) {
            this._actionHolder.setScale(this._busy ? 0.97 : 1, this._busy ? 0.97 : 1, 1);
        }
    }

    dispose(): void {
        if (this._root && this._root.isValid) this._root.destroy();
    }
}

/**
 * 取子树里第一个 Label。
 * mkPrimaryBtn / mkGhostBtn 内部建的 label 没有起名（要改它们得连带改所有调用点），
 * 所以这里按"深度优先找第一个 Label"来拿 —— 两个按钮的子树结构都很浅，
 * 第一个 Label 必然是按钮文字。
 */
function firstLabel(n: Node): Label {
    for (const ch of n.children) {
        const got = ch.getComponent(Label);
        if (got) return got;
        const deep = firstLabel(ch);
        if (deep) return deep;
    }
    return null as unknown as Label;
}
