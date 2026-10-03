/**
 * ============================================================
 *  ChapterPage.ts · 章节选择（设计稿 S03 · #s-chap）
 * ============================================================
 *  版式（数字全部来自 tools/design-geometry.mjs 实测的原型盒模型，
 *  不是从 CSS 属性值推的 —— 设计稿真实视口 372×762，见 CFG.SPEC）：
 *
 *      topbar            高 96（= 安全区 56 + 返回键 32 + 下距 8）；
 *                        返回键 32×32；标题 15px/600 起于 x 58
 *      卡片列表          顶栏之下**垂直居中**；卡片 x=16 / 宽 340 / 高 135 / 圆角 17，
 *                        卡间距 12（这三个数仍是设计稿原值，只挪整块位置）
 *      卡内四行（内容盒 x=32、宽 308）：
 *          ① 章名   楷 19px / 行盒 26 / 字距 2 / 下距 3   → 行盒 y 71..97
 *          ② 副题   黑 13px / 行盒 18                    → 行盒 y 100..118
 *          ③ 预览字 楷 15px / 行盒 21 / 字距 5 / 上距 7  → 行盒 y 125..146
 *          ④ 星级行 14px 星 + 11.5px 计数 / 行盒 21 / 上距 9 → 行盒 y 155..176
 *        卡底 = 176 + 15(padding) = 191，卡高 135 ✔
 *
 *  【两处"与设计稿不同"，都是真机适配，不是抄错】
 *  ① 顶栏上距 16 → 56（安全区，见 CFG.LAYOUT.SAFE_TOP）
 *  ② 列表从"顶锚"改成"居中"（见下方 onCreate 里的说明）
 *
 *  【"四行"而不是三行】
 *  只看 CSS（.chap h3 / .preview / .meta）会以为是三行，但实测盒模型里
 *  「十八般兵器 · 木 / 钅 / 革 / 竹」（.muted 13px）与「枪 棍 锤 钩 棒 镰」（.preview 15px）
 *  是两行不同的东西 —— 前者是章的题材说明，后者是本章会出现的字。以实测为准。
 *
 *  【星级是"整章掌握度"，不是"这一章拿到了几颗星"】
 *  原型：`starStr(Math.round(st / (lvs.length*3) * 3))`
 *      st = 本章所有关卡的星数之和，分母 = 关卡数 × 3。
 *  也就是说第一章 8 关（满星 24）拿到 3 颗，显示 0 星；拿到 12 颗才显示 2 星。
 *  旁边的 `0/8` 才是精确进度。**这条规则是设计稿定的，别按"直觉"改回来**。
 *
 *  【锁定态怎么表达】
 *  设计稿是 `.chap.locked{opacity:.5;filter:grayscale(.7)}` —— 整张卡降透明 + 去色。
 *  做法：
 *    · 透明度 —— 给整卡挂 UIOpacity=128（子节点会一起乘，与 CSS 的效果一致）；
 *    · 去色   —— Graphics 没有滤镜，但卡里真正"有颜色"的只有左侧竖条与星级，
 *                用 UIFactory.desat() 提前把它们混成灰即可，其余本来就无饱和。
 * ============================================================
 */

import { Node, UIOpacity } from 'cc';
import { CFG, px } from '../CFG';
import { CHAPTERS, levelsOfChapter } from '../core/LevelData';
import { chapterUnlocked } from '../core/Progress';
import { Save } from '../core/Save';
import { dump } from './LayoutDump';
import { PageBase } from './PageBase';
import { PageManager } from './PageManager';
import { PAGE_CHAP, PAGE_HOME, PAGE_MAP } from './PAGES';
import { Toast } from './Toast';
import {
    centerBlockTop, desat, mkBackBtn, mkCard, mkLabel, mkLeftBar, mkPaperBG, pressable,
    safeTop, setPos, topY, visibleSize,
} from './UIFactory';

// ── topbar（设计稿 .topbar{padding:16px 16px 8px} + .btn-back 32）──
// ⚠️ 设计稿的第一个数 16 是"距屏幕顶"，真机上要避开状态栏/灵动岛与微信胶囊，
//    所以改用 safeTop()（=56 设计px）。理由见 CFG.LAYOUT.SAFE_TOP。
//
// ★★ 2026-10-02 用户拍板：标题**下移**、**放大** ★★
//   与 MapPage 用的是**同一套数**（那边注释里有推导）：
//     标题自成一行、落在返回键下方（中心 72 → 109）；字号 15 → 19；底栏 96 → 124。
//   本页的卡片列表本来是"顶栏之下垂直居中"，底栏长高 28 ⇒ 居中区域缩 28
//   ⇒ 列表中心**自动**下移 14，无需另加偏移（这正是用居中而不是写死 y 的好处）。
const TOP_PAD_T = safeTop(), TOP_PAD_S = px(16), TOP_GAP = px(10);
const BACK_D = px(32);
const TITLE_GAP = px(8);
const TOP_TITLE_S = px(19), TOP_TITLE_LH = px(26);
const TOP_PAD_B = px(2);
const TOPBAR_H = TOP_PAD_T + BACK_D + TITLE_GAP + TOP_TITLE_LH + TOP_PAD_B;   // 124
/** 标题行中心距屏幕顶（= 56 + 32 + 8 + 13） */
const TITLE_CY = TOP_PAD_T + BACK_D + TITLE_GAP + TOP_TITLE_LH / 2;           // 109

// ── 卡片（设计稿 .chap{padding:15px 16px;margin:0 16px 12px;border-radius:17px}）──
const CARD_MX = px(16), CARD_R = px(17), CARD_GAP = px(12);
const CARD_PAD_Y = px(15), CARD_PAD_X = px(16);
const BAR_W = px(4);

// ── 卡内四行（行盒高 = 实测值；设计稿没写 line-height，用的是 font 的 normal）──
const H3_S = px(19), H3_LS = px(2), H3_LH = px(26), H3_MB = px(3);
const SUB_S = px(13), SUB_LH = px(18);
const PV_S = px(15), PV_LS = px(5), PV_LH = px(21), PV_MT = px(7);
const META_S = px(14), META_LS = px(1.5), META_LH = px(21), META_MT = px(9);
const CNT_S = px(11.5);
/** 星与计数之间的空隙：设计稿在 .stars 与 .cnt 之间有一个 16px 空格（≈6.5px 视觉间隙） */
const STAR_CNT_GAP = px(6.5);

const CARD_H = CARD_PAD_Y * 2 + H3_LH + H3_MB + SUB_LH + PV_MT + PV_LH + META_MT + META_LH;

/** 每张卡预览几个字（设计稿 `CH_POOL[c.id].slice(0, 6)`） */
const PREVIEW_N = 6;
/** 锁定态整卡不透明度（设计稿 opacity:.5） */
const LOCKED_ALPHA = 128;
/** 锁定态去色强度（设计稿 filter:grayscale(.7)） */
const LOCKED_DESAT = 0.7;

export class ChapterPage extends PageBase {

    readonly pageName = PAGE_CHAP;

    private _toast!: Toast;

    protected onCreate(): void {
        const { w: W, h: H } = visibleSize();
        const C = CFG.COLOR;
        const cardW = W - 2 * CARD_MX;

        mkPaperBG(this._root, W, H, C.BG_TOP, C.BG_MID, C.BG_BOT);

        // —— topbar：返回键 + 标题（标题左对齐，与返回键留 10 的间隙）——
        const backY = topY(H, TOP_PAD_T + BACK_D / 2);
        setPos(mkBackBtn(this._root, BACK_D, () => PageManager.goto(PAGE_HOME), this),
            -W / 2 + TOP_PAD_S + BACK_D / 2, backY);

        const titleLeft = -W / 2 + TOP_PAD_S + BACK_D + TOP_GAP;
        const titleW = W - 2 * TOP_PAD_S - BACK_D - TOP_GAP;
        // ★ 标题落在返回键**下方**（TITLE_CY），不再与返回键共用 backY
        setPos(mkLabel(this._root, '选择章节', {
            size: TOP_TITLE_S, color: C.INK, bold: true, font: 'hei', lineHeight: TOP_TITLE_LH,
            align: 'left', autoWidth: false, width: titleW,
        }).node, titleLeft + titleW / 2, topY(H, TITLE_CY));

        // —— 章节卡列表 ——
        //  ★ 顶栏之下**垂直居中**（2026-10-02 拍板）：设计稿的 .chap-list 是
        //    `flex:1;overflow-y:auto`（顶锚），设计舞台 745 高时底部留白尚可；
        //    真机可见高 781，多出来的空间全堆在底部，整页看起来"整体偏上"。
        //    卡片高 135 / 间距 12 仍是设计稿原值，只挪整块的位置。
        const listH = CHAPTERS.length * CARD_H + (CHAPTERS.length - 1) * CARD_GAP;
        let cur = centerBlockTop(H, TOPBAR_H, listH);
        const cardTops: number[] = [];
        for (const c of CHAPTERS) {
            setPos(this.buildCard(cardW, c.id, c.name, c.sub), 0, topY(H, cur + CARD_H / 2));
            cardTops.push(cur);
            cur += CARD_H + CARD_GAP;
        }

        this._toast = new Toast(this._root, W, topY(H, H * 0.52));
        this.dumpLayout(W, cardTops, listH);
    }

    /**
     * 版式转储（给 tools/layout-diff.py 逐值比对，见 ui/LayoutDump.ts）。
     *
     * ★ `.chap-list` 与 `.chap[i]` 的**绝对 y 是"居中"算出来的**，
     *   与设计稿的顶锚值本就不同 —— 所以比对脚本对它们用的是另外两条判据
     *   （列表看"上下留白相等"、逐卡看"步距 = 135+12 = 147"），
     *   见 tools/layout-diff.py 的 CENTER_LIST / SAME_NAME_STEP。
     */
    private dumpLayout(W: number, cardTops: number[], listH: number): void {
        const box = (n: string, l: number, t: number, w: number, h: number, ex = ''): void =>
            dump(PAGE_CHAP, n, l, t, w, h, ex);

        box('.topbar', 0, 0, W, TOPBAR_H);
        box('.btn-back', TOP_PAD_S, TOP_PAD_T, BACK_D, BACK_D);
        box('.chap-list', 0, cardTops[0], W, listH);
        for (let i = 0; i < cardTops.length; i++) {
            box(`.chap[${i}]`, CARD_MX, cardTops[i], W - 2 * CARD_MX, CARD_H,
                `r=${Math.round(CARD_R / CFG.SPEC.SCALE)}`);
        }
    }

    onExit(): void {
        if (this._toast) this._toast.dispose();
        super.onExit();
    }

    // ------------------------------------------------------------
    /** 建一张章节卡，返回卡节点（由调用方摆位） */
    private buildCard(w: number, id: number, name: string, sub: string): Node {
        const C = CFG.COLOR;
        const unlocked = chapterUnlocked(id);
        const lvs = levelsOfChapter(id);
        const done = lvs.filter((l) => Save.isCleared(l.n)).length;
        const got = lvs.reduce((s, l) => s + Save.stars(l.n), 0);
        // ★ 整章掌握度：本章星数总和 / (关卡数 × 3)，取整到 3 档（原型 renderChap 原式）
        const starN = Math.round(got / Math.max(1, lvs.length * 3) * 3);

        const card = mkCard(this._root, w, CARD_H, CARD_R, C.SURFACE_A_STRONG, C.EDGE_A);
        const barTop = unlocked ? C.RED : desat(C.RED, LOCKED_DESAT);
        const barBot = unlocked ? C.GOLD : desat(C.GOLD, LOCKED_DESAT);
        setPos(mkLeftBar(card, BAR_W, CARD_H, CARD_R, barTop, barBot), -w / 2 + BAR_W / 2, 0);

        // 卡内内容区：自顶向下（top 是当前可用的上沿，局部坐标）
        const contentW = w - 2 * CARD_PAD_X;
        const contentLeft = -w / 2 + CARD_PAD_X;
        let top = CARD_H / 2 - CARD_PAD_Y;
        const at = (lh: number): number => {
            const c = top - lh / 2;
            top -= lh;
            return c;
        };

        this.line(card, name, contentLeft, contentW, at(H3_LH), H3_S, H3_LH, C.INK, 'kai', true, H3_LS);
        top -= H3_MB;
        this.line(card, sub, contentLeft, contentW, at(SUB_LH), SUB_S, SUB_LH, C.INK2, 'hei', false, 0);
        top -= PV_MT;
        // ★ 预览字用 ink2（设计稿 .chap .preview{color:var(--ink2)}），不是 ink
        this.line(card, previewOf(id), contentLeft, contentW, at(PV_LH), PV_S, PV_LH, C.INK2, 'kai', false, PV_LS);
        top -= META_MT;

        // —— meta：左「★★★ 0/8」 右「可挑战 / 通关上一章解锁」 ——
        const metaY = at(META_LH);
        const pitch = META_S + META_LS;
        const gold = unlocked ? C.GOLD : desat(C.GOLD, LOCKED_DESAT);
        for (let s = 0; s < 3; s++) {
            // ★ 未点亮的星是**同一字形换灰色**（原型 `starStr`：`i<n ? '★' : '<span class="off">★</span>'`），
            //   不是空心 ☆。写成 ☆ 会导致整行字宽、笔画粗细、视觉重心都与设计稿不同 ——
            //   这类"看着差不多"的差异只有把两个字形并排看才发现。
            //   每个星的字形宽 = 字号（汉字全宽），中心 = 起笔 + 半字宽
            setPos(mkLabel(card, '★', {
                size: META_S, color: s < starN ? gold : C.OFF_STAR2,
                font: 'hei', lineHeight: META_LH,
            }).node, contentLeft + s * pitch + META_S / 2, metaY);
        }
        const cntLeft = contentLeft + 3 * pitch + STAR_CNT_GAP;
        const cntW = contentW - 3 * pitch - STAR_CNT_GAP;
        setPos(mkLabel(card, `${done}/${lvs.length}`, {
            size: CNT_S, color: C.INK3, font: 'hei',
            align: 'left', autoWidth: false, width: cntW, lineHeight: META_LH,
        }).node, cntLeft + cntW / 2, metaY);

        setPos(mkLabel(card, unlocked ? '可挑战' : '通关上一章解锁', {
            size: CNT_S, color: C.INK3, font: 'hei',
            align: 'right', autoWidth: false, width: contentW, lineHeight: META_LH,
        }).node, contentLeft + contentW / 2, metaY);

        if (!unlocked) {
            // 整卡 50% 透明（子节点一起乘，等价于 CSS 的 opacity:.5）
            card.addComponent(UIOpacity).opacity = LOCKED_ALPHA;
        }

        pressable(card, () => {
            if (!unlocked) { this._toast.show('先通关上一章才能来这里'); return; }
            PageManager.goto(PAGE_MAP, { chapter: id });
        }, this);
        return card;
    }

    /** 卡内左对齐的一行：用固定宽度 + 左对齐，免去"先量宽再居中"的异步 */
    private line(parent: Node, text: string, left: number, w: number, y: number,
                 size: number, lh: number, color: string,
                 font: 'kai' | 'hei', bold: boolean, spacing: number): void {
        setPos(mkLabel(parent, text, {
            size, color, font, bold, spacing, lineHeight: lh,
            align: 'left', autoWidth: false, width: w,
        }).node, left + w / 2, y);
    }
}

/**
 * 本章预览字：设计稿取 `CH_POOL[c.id].slice(0, 6)`。
 * 这里**不抄一份字池表**，而是按原型 CH_POOL 的生成规则现算 ——
 * 它定义就是"按关卡顺序首次出现的字"，用 LEVELS 导出必然与原型逐字一致，
 * 也就不会在改关卡字单时忘了同步（抄表则是静默错误）。
 */
function previewOf(ch: number): string {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const lv of levelsOfChapter(ch)) {
        for (const w of lv.words) {
            if (seen.has(w)) continue;
            seen.add(w);
            out.push(w);
            if (out.length >= PREVIEW_N) return out.join(' ');
        }
    }
    return out.join(' ');
}
