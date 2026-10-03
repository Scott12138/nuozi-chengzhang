/**
 * ============================================================
 *  BootPage.ts · 启动页（设计稿 S01）
 * ============================================================
 *  版式（逐条对应设计稿 #s-boot）：
 *      **整块居中**：朱砂印章 → 标题 → 副标题 → 进度条
 *      **绝对贴底**：两行小字（设计稿 .boot-tip 的 position:absolute;bottom:34px）
 *
 *  【为什么是"整块居中"而不是"按设计稿写死每个 y"】
 *  设计稿 #s-boot 是 flex 居中列，内容块的高度决定了它的起始位置。
 *  照抄设计稿的绝对像素会在别的屏幕高度上偏。这里先把块高算出来再居中：
 *  720×1440 的舞台上与设计稿逐像素一致，真机（19.5:9 ≈ 1560）上因为
 *  可视区更高、上方留白更多，观感同样成立（而不是"整体偏下"）。
 *
 *  【印章里为什么刻「挪字 / 成章」而不是设计稿的「拆字 / 挪对」】
 *  设计稿刻的是**改名前的旧名**。游戏名已拍板为「挪字成章」（首页大标题亦然），
 *  印章作为"名字的章"必须跟着改 —— 否则启动页与首页会同时出现两个名字。
 *  版式一字未动，只有名字随命名更新。
 *
 *  【进度条为什么按进度重画而不是缩放】
 *  它是胶囊（border-radius:99px）。用 scaleX 拉伸会把**右端的圆头一起拉扁**，
 *  看起来像个小胶囊而不是"被填满的胶囊"。所以每帧重画 Graphics，只改宽度 ——
 *  60ms 一帧、每帧十几个矩形，开销可以忽略。
 * ============================================================
 */

import { Graphics, log, Node, tween, Vec3 } from 'cc';
import { CFG, px } from '../CFG';
import { PageBase } from './PageBase';
import { PageManager } from './PageManager';
import { PAGE_BOOT, PAGE_HOME } from './PAGES';
import {
    hex, lerpColor, mkGradPanel, mkLabel, mkNode, mkPaperBG, setPos, topY, visibleSize,
} from './UIFactory';

/**
 * 管线自检标识符（ASCII）。
 * ★ 保留它的理由：命令行构建 + 小游戏环境下，任何一环断掉的表现**都是白屏**。
 *   这一串同时出现在「构建产物 / 控制台日志」两处，两处都能 grep 到，
 *   才说明「脚本入包 → Bootstrap 挂载 → UI 建节点 → 渲染」整条链通了。
 *   release 包不保留中文，所以它必须是 ASCII。
 *   （屏幕上不再显示它 —— 设计稿上没有这行东西。）
 */
export const BOOT_MARK = 'NUOZI_BOOT_OK';

/** 启动页停留多久后进首页（给入场动画和进度条留够时间） */
const SPLASH_MS = 1300;

// ── 尺寸（括号里是 tools/design-geometry.mjs 实测的设计稿盒模型值）──
const SEAL_D = px(118), SEAL_R = px(20), SEAL_INSET = px(7), SEAL_RING_W = px(1.5);
const SEAL_S = px(30), SEAL_LS = px(1), SEAL_LINE_H = px(31.8);
/** 印章内两行字的中心间距 = 行盒 31.8（= 30px × line-height:1.06）的一半 × 2，实测 ∓15.9 */
const SEAL_LINE_GAP = px(15.9);
const TITLE_MT = px(24), TITLE_S = px(30), TITLE_LH = px(42), TITLE_LS = px(10);
const SUB_MT = px(8), SUB_S = px(12), SUB_LH = px(17), SUB_LS = px(4);
const BAR_MT = px(30), BAR_W = px(186), BAR_H = px(6);
const TIP_BOTTOM = px(34), TIP_S = px(10.5), TIP_LH = px(19.95);

/** 主块总高（用于整块居中）：印章 + 标题 + 副标题 + 进度条 */
const BLOCK_H = SEAL_D + TITLE_MT + TITLE_LH + SUB_MT + SUB_LH + BAR_MT + BAR_H;

export class BootPage extends PageBase {

    readonly pageName = PAGE_BOOT;

    private _barFill!: Graphics;

    protected onCreate(): void {
        const { w: W, h: H } = visibleSize();
        const C = CFG.COLOR;

        mkPaperBG(this._root, W, H, C.BG_TOP, C.BG_MID, C.BG_BOT);

        // 自顶向下排，整块上下居中
        let cur = (H - BLOCK_H) / 2;
        const at = (h: number): number => {
            const c = cur + h / 2;
            cur += h;
            return topY(H, c);
        };

        // —— 朱砂印章：渐变方章 + 内圈白线 + 两行楷体 ——
        const seal = mkGradPanel(this._root, SEAL_D, SEAL_D, SEAL_R, C.SEAL_A, C.SEAL_B);
        setPos(seal, 0, at(SEAL_D));
        drawSealRing(seal, SEAL_D, SEAL_INSET, SEAL_RING_W);
        setPos(mkLabel(seal, '挪字', {
            size: SEAL_S, color: C.BTN_TX, bold: true, font: 'kai',
            spacing: SEAL_LS, lineHeight: SEAL_LINE_H,
        }).node, 0, SEAL_LINE_GAP);
        setPos(mkLabel(seal, '成章', {
            size: SEAL_S, color: C.BTN_TX, bold: true, font: 'kai',
            spacing: SEAL_LS, lineHeight: SEAL_LINE_H,
        }).node, 0, -SEAL_LINE_GAP);

        cur += TITLE_MT;
        setPos(mkLabel(this._root, '挪字成章', {
            size: TITLE_S, color: C.INK, bold: true, font: 'kai',
            spacing: TITLE_LS, lineHeight: TITLE_LH,
        }).node, 0, at(TITLE_LH));

        cur += SUB_MT;
        setPos(mkLabel(this._root, '偏 旁 相 逢 · 一 挪 成 字', {
            size: SUB_S, color: C.INK2, font: 'hei', spacing: SUB_LS, lineHeight: SUB_LH,
        }).node, 0, at(SUB_LH));

        cur += BAR_MT;
        const barY = at(BAR_H);
        const track = mkNode('bar', this._root, BAR_W, BAR_H);
        setPos(track, 0, barY);
        const tg = track.addComponent(Graphics);
        tg.fillColor = hex(CFG.COLOR.BAR_TRACK, CFG.COLOR.BAR_TRACK_A);   // rgba(140,120,85,.16)
        tg.roundRect(-BAR_W / 2, -BAR_H / 2, BAR_W, BAR_H, BAR_H / 2);
        tg.fill();

        const fillNode = mkNode('bar-fill', track, BAR_W, BAR_H);
        this._barFill = fillNode.addComponent(Graphics);
        this.drawBar(0);

        // 进度动画：0 → 1 线性走完整个停留时间
        const t0 = Date.now();
        this.interval(() => this.drawBar(Math.min(1, (Date.now() - t0) / SPLASH_MS)), 60);

        // —— 底部两行小字（绝对贴底）——
        setPos(mkLabel(this._root, '挪字成章 · Cocos 版 v0.1\n沿本行/本列滑动字牌 → 直线对齐 → 合成汉字', {
            size: TIP_S, color: C.INK3, font: 'hei', lineHeight: TIP_LH,
        }).node, 0, -H / 2 + TIP_BOTTOM + TIP_LH);

        // 入场：整页轻微放大回正（顺便证明 tween 模块在包里 —— engine.json 关掉了 42 个
        // 模块，tween 是保留的 13 个之一，万一哪天被误关，这一行会立刻暴露）
        this._root.setScale(0.985, 0.985, 1);
        tween(this._root)
            .to(0.26, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
            .start();

        log(`[BootPage] ${BOOT_MARK} 启动页就绪，可见尺寸 ${W}×${H}`);

        // 走完这一秒半就进首页。用 PageBase.timer 而不是裸 setTimeout：
        // 它登记在页面里，切页时会被统一清掉（否则切页后回调会打到已销毁的节点上）。
        this.timer(() => PageManager.goto(PAGE_HOME), SPLASH_MS);
    }

    /** 按进度重画胶囊填充（金 → 朱砂 横向渐变 + 两端圆头） */
    private drawBar(t: number): void {
        const g = this._barFill;
        if (!g || !g.isValid) return;
        g.clear();
        const w = BAR_W * t;
        if (w < 1) return;
        const h = BAR_H;
        const A = hex(CFG.COLOR.GOLD), B = hex(CFG.COLOR.RED);
        const SLICES = 16;
        const sw = w / SLICES;
        for (let i = 0; i < SLICES; i++) {
            g.fillColor = lerpColor(A, B, i / (SLICES - 1));
            g.rect(-BAR_W / 2 + i * sw, -h / 2, sw + 1, h);
            g.fill();
        }
        // 两端圆头：没有这两笔就是"方头胶囊"
        g.fillColor = A;
        g.circle(-BAR_W / 2 + h / 2, 0, h / 2);
        g.fill();
        g.fillColor = B;
        g.circle(-BAR_W / 2 + w - h / 2, 0, h / 2);
        g.fill();
    }
}

/** 印章内圈白线（设计稿 `.seal::after`：inset 7px、radius 14、1.5px 白描边） */
function drawSealRing(parent: Node, d: number, inset: number, lineW: number): void {
    const n = mkNode('seal-ring', parent, d, d);
    const g = n.addComponent(Graphics);
    g.strokeColor = hex(CFG.COLOR.SEAL_RING, CFG.COLOR.SEAL_RING_A);   // rgba(255,255,255,.42)
    g.lineWidth = Math.max(2, lineW);
    const inner = d - inset * 2;
    g.roundRect(-inner / 2, -inner / 2, inner, inner, px(14));
    g.stroke();
}
