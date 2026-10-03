/**
 * ============================================================
 *  HomePage.ts · 首页（设计稿 S02 · #s-home）
 * ============================================================
 *  版式（数字全部来自 tools/design-geometry.mjs 实测的原型盒模型）：
 *
 *      .home-wrap  padding: 0 22px，高 = 屏高（flex 列）
 *      .home-hero  上距 52，内含
 *          荷叶标  楷 15px / 行盒 21 / 字距 8        y 52..73
 *          大标题  楷 44px / 行盒 62 / 字距 10，上距 12   y 85..147
 *          玩法两行 黑 12.5px / 行盒 25（line-height:2）/ 字距 1.6，上距 16
 *                  y 163..213（第 1 行含一段朱砂强调）
 *          示例拆字 上距 30，块高 52                y 243..295
 *      .home-intro margin:auto 0 0（**只吃掉上方弹性空白**），高 131
 *          收录行  黑 12px / 行盒 21 / 字距 1，里面的数字是楷 15.5px 朱砂
 *          12 张小字牌 32×32 / 圆角 9 / 间距 6，上下距 13 / 11
 *          章名小字 黑 11px / 字距 2.4
 *      .home-menu  margin-top:auto + margin-bottom:26，gap 11
 *          三格统计 数字楷 21px / 行盒 29，标签黑 12px / 行盒 17；格子间距 22
 *          主按钮   高 54 / 朱砂渐变 / 白字 17px / 字距 1 / 圆角 15
 *          两个 ghost 高 51 / 半透明白底 / 墨字 15px
 *
 *  【两处 margin:auto 怎么复刻】
 *  `.home-intro{margin:auto 0 0}` 与 `.home-menu{margin-top:auto}` 都是"上边距 auto"，
 *  在一个 flex 列里两个 auto 会**平分**剩余高度。所以这里显式算：
 *      F = 屏高 − hero高 − intro高 − menu高
 *      上半段 F/2 落在 intro 之上，下半段 F/2 落在菜单之上。
 *  实测复核：762 高的设计舞台上 F = 762 − 295 − 131 − 215 = 121 → 各 60.5，
 *  与盒模型量到的 355.5（intro 顶）和 547（菜单顶）完全对上。
 *
 *  【大标题为什么拆成四个单字 label】
 *  设计稿是 `拆字<em>挪对</em>` —— 同一行里两种颜色。Cocos 的 Label 不支持富文本
 *  混色，而"等到渲染后再量宽度回填位置"既异步又脆。改成四个单字 label 按固定步距
 *  `字号 + 字距` 排列：字距由我们说了算（比依赖 spacingX 更准），换色只是换第 3、4 个字。
 *  步距对齐设计稿的 `letter-spacing:10px`（实测四字步距 54px）。
 *
 *  【12 张预览字牌 & 那串数字一律算出来，不写死】
 *  设计稿里「本作收录 103 字 · 4 章 · 38 关」与预览牌曾经是写死的字符串，
 *  关卡从 32 改到 38 之后它就开始撒谎（预览牌里还有两个本作不会出现的字）。
 *  预览牌的取样规则是原型里的 `CHAPTERS.map(c => CH_POOL[c.id].slice(0,3))`
 *  —— 每章取前 3 个字，合起来 12 张。这里按该规则现算。
 * ============================================================
 */

import { CFG, px } from '../CFG';
import { CHAPTERS, LEVELS, WORDS, levelsOfChapter } from '../core/LevelData';
import { nextLevelToPlay } from '../core/Progress';
import { Save } from '../core/Save';
import { PageBase } from './PageBase';
import { PageManager } from './PageManager';
import { PAGE_ATLAS, PAGE_CHAP, PAGE_HOME, PAGE_SET } from './PAGES';
import {
    mkCard, mkGhostBtn, mkLabel, mkPaperBG, mkPiece, mkPrimaryBtn, mkRuns,
    safeTop, setPos, topY, visibleSize,
} from './UIFactory';

// ── hero ──
// ⚠️ 设计稿写的是 52，但本页**没有顶栏**，首行直接就是内容 ——
//    真机上 52 会落进状态栏/灵动岛那一带（安全区典型值 56）。
//    取 max(设计值, 安全区)：既不改设计稿的意图，又保证首行不压到状态栏。
//    下面 free/2 的分配会自动吸收这 4px 的变化。
const HERO_TOP = Math.max(px(52), safeTop());
const LOTUS_S = px(15), LOTUS_LH = px(21), LOTUS_SP = px(8);
const TITLE_S = px(44), TITLE_LH = px(62), TITLE_MT = px(12), TITLE_SP = px(10);
const RULE_S = px(12.5), RULE_LH = px(25), RULE_MT = px(16), RULE_SP = px(1.6);
const DEMO_MT = px(30), DEMO_P = px(52), DEMO_GAP = px(9), DEMO_OP_S = px(17);

// ── 收录一览 ──
const INTRO_PAD = px(4);
const HITITLE_S = px(12), HITITLE_B_S = px(15.5), HITITLE_LH = px(21), HITITLE_SP = px(1);
const TILE = px(32), TILE_R = px(9), TILE_GAP = px(6), TILE_S = px(15);
const TILES_MT = px(13), TILES_MB = px(11);
const HINOTE_S = px(11), HINOTE_LH = px(16), HINOTE_SP = px(2.4);
/** 每章取几个字做预览（原型 `CH_POOL[c.id].slice(0,3)`） */
const PER_CHAPTER = 3;

// ── 底部菜单 ──
const STAT_B_S = px(21), STAT_B_LH = px(29), STAT_L_S = px(12), STAT_L_LH = px(17);
const STAT_GAP = px(22), STAT_MB = px(16);
const BTN_H = px(54), BTN_S = px(17), BTN_SP = px(1);
const ROW_H = px(51), ROW_S = px(15), ROW_SP = px(1);
const MENU_GAP = px(11), MENU_MB = px(26);

export class HomePage extends PageBase {

    readonly pageName = PAGE_HOME;

    /**
     * 这里**不需要**再调 `AudioService.playBgm()`。
     *
     * "全局都要有 BGM"这个意图已经在 `GameRoot.start()` 里置上了（更早、
     * 也更贴"从进入游戏就播"）；真正发 `play()` 的时机挂在 AudioService 的
     * "第一次触摸屏幕"监听上。**再调一次只会是幂等的空转**，写在这里反而
     * 会让人以为"首页负责起播"，下次改动就容易改错地方。
     *
     * ⚠️ 别在这里"补一句 playBgm"：首页是启动后自动进的、**不在手势栈里**，
     *    此时发的 play() 会被 autoplay 静默拦掉（不报错、日志也没有线索）。
     *    上一轮就是这么写的，结果日志里 `[AudioService] BGM 起播` 和浏览器的
     *    "AudioContext was not allowed to start" 同时出现 —— 看起来好了，
     *    实际整局没声音（详见 AudioService.probeBgm 的注释）。
     */
    protected onCreate(): void {
        const { w: W, h: H } = visibleSize();
        const C = CFG.COLOR;
        const wrapW = W - 2 * px(22);

        mkPaperBG(this._root, W, H, C.BG_TOP, C.BG_MID, C.BG_BOT);

        // ============================================================
        //  ① hero（自顶向下，游标累计）
        // ============================================================
        let cur = HERO_TOP;
        const at = (h: number): number => {
            const c = cur + h / 2;
            cur += h;
            return topY(H, c);
        };

        setPos(mkLabel(this._root, '文 · 字 · 拆 · 合', {
            size: LOTUS_S, color: C.INK3, font: 'kai', spacing: LOTUS_SP,
            lineHeight: LOTUS_LH,
        }).node, 0, at(LOTUS_LH));

        cur += TITLE_MT;
        this.buildTitle(at(TITLE_LH));

        cur += RULE_MT;
        const ruleY = at(RULE_LH * 2);
        // 第 1 行：设计稿把「本行或本列」做成了朱砂强调（.home-rule b{color:var(--red)}），
        // 所以这一行是三段拼的；第 2 行无强调，直接用普通 label。
        mkRuns(this._root, [
            { t: '字牌只能沿', color: C.INK2 },
            { t: '本行或本列', color: C.RED, bold: true },
            { t: '滑动，遇到牌即停', color: C.INK2 },
        ], RULE_S, RULE_LH, ruleY + RULE_LH / 2, RULE_SP);
        setPos(mkLabel(this._root, '让偏旁与部件同行同列、中间无挡，即可合成一字', {
            size: RULE_S, color: C.INK2, font: 'hei', lineHeight: RULE_LH, spacing: RULE_SP,
        }).node, 0, ruleY - RULE_LH / 2);

        cur += DEMO_MT;
        this.buildDemo(at(DEMO_P));
        const heroEnd = cur;

        // ============================================================
        //  ② 底部菜单（自底向上，游标累计；bc = 距屏幕底的距离）
        // ============================================================
        let bc = MENU_MB;
        const atB = (h: number): number => {
            const c = bc + h / 2;
            bc += h;
            return -H / 2 + c;
        };

        // 一行两个 ghost：左「字盘图鉴」右「设置」，合起来正好铺满 wrapW
        const rowW = (wrapW - MENU_GAP) / 2;
        const rowY = atB(ROW_H);
        setPos(mkGhostBtn(this._root, rowW, ROW_H, '字盘图鉴',
            () => PageManager.goto(PAGE_ATLAS), this, ROW_S, ROW_SP), -wrapW / 2 + rowW / 2, rowY);
        setPos(mkGhostBtn(this._root, rowW, ROW_H, '设置',
            () => PageManager.goto(PAGE_SET), this, ROW_S, ROW_SP), wrapW / 2 - rowW / 2, rowY);

        bc += MENU_GAP;
        setPos(mkPrimaryBtn(this._root, wrapW, BTN_H, '开始拆字',
            () => PageManager.goto(PAGE_CHAP, { chapter: chapterToPlay() }), this, BTN_S, BTN_SP),
            0, atB(BTN_H));

        bc += MENU_GAP;
        // 三格统计：格子等宽（设计稿里格宽由 3 个汉字的标签撑到 36），整体居中、间距 22
        const statCell = px(36);
        const statTotal = 3 * statCell + 2 * STAT_GAP;
        const statY = atB(STAT_B_LH + STAT_L_LH);
        const stats: Array<[string, string]> = [
            [`${Save.totalStars()}`, '已得星'],
            [`${Save.litCount()}`, '已识字'],
            [`${Save.clearedCount()}`, '已通关'],
        ];
        for (let i = 0; i < stats.length; i++) {
            const x = -statTotal / 2 + i * (statCell + STAT_GAP) + statCell / 2;
            setPos(mkLabel(this._root, stats[i][0], {
                size: STAT_B_S, color: C.RED, bold: true, font: 'kai', lineHeight: STAT_B_LH,
            }).node, x, statY + STAT_L_LH / 2);
            setPos(mkLabel(this._root, stats[i][1], {
                size: STAT_L_S, color: C.INK2, font: 'hei', lineHeight: STAT_L_LH,
            }).node, x, statY - STAT_B_LH / 2);
        }
        bc += STAT_MB;
        const menuTop = bc;

        // ============================================================
        //  ③ 收录一览（夹在 hero 与菜单之间，吃 F/2 的自动边距）
        // ============================================================
        const innerW = wrapW - 2 * INTRO_PAD;
        const perRow = Math.max(1, Math.floor((innerW + TILE_GAP) / (TILE + TILE_GAP)));
        const words = previewWords();
        const rows = Math.max(1, Math.ceil(words.length / perRow));
        const tilesH = rows * TILE + (rows - 1) * TILE_GAP;
        const introH = HITITLE_LH + TILES_MT + tilesH + TILES_MB + HINOTE_LH;

        const free = H - heroEnd - introH - menuTop;
        const introBottom = menuTop + (free > 0 ? free / 2 : 0);

        let ic = introBottom;
        const atI = (h: number): number => {
            const c = ic + h / 2;
            ic += h;
            return -H / 2 + c;
        };

        setPos(mkLabel(this._root, '十八般兵器 · 花间集 · 逛三园 · 百工坊', {
            size: HINOTE_S, color: C.INK3, font: 'hei', spacing: HINOTE_SP, lineHeight: HINOTE_LH,
        }).node, 0, atI(HINOTE_LH));

        ic += TILES_MB;
        const tilesBottom = ic;                       // 牌区底边距屏幕底
        for (let i = 0; i < words.length; i++) {
            const r = Math.floor(i / perRow), c = i % perRow;
            const inRow = Math.min(perRow, words.length - r * perRow);
            const rowW2 = inRow * TILE + (inRow - 1) * TILE_GAP;
            const x = -rowW2 / 2 + c * (TILE + TILE_GAP) + TILE / 2;
            const y = -H / 2 + tilesBottom + (rows - r) * TILE + (rows - 1 - r) * TILE_GAP - TILE / 2;
            this.buildPreviewTile(x, y, words[i]);
        }
        ic += tilesH;

        ic += TILES_MT;
        // 「本作收录 N 字 · N 章 · N 关」——三段小字里夹三个大号朱砂数字
        mkRuns(this._root, [
            { t: '本作收录 ', color: C.INK2 },
            { t: `${Object.keys(WORDS).length}`, color: C.RED, size: HITITLE_B_S, bold: true, kai: true },
            { t: ' 字 · ', color: C.INK2 },
            { t: `${CHAPTERS.length}`, color: C.RED, size: HITITLE_B_S, bold: true, kai: true },
            { t: ' 章 · ', color: C.INK2 },
            { t: `${LEVELS.length}`, color: C.RED, size: HITITLE_B_S, bold: true, kai: true },
            { t: ' 关', color: C.INK2 },
        ], HITITLE_S, HITITLE_LH, atI(HITITLE_LH), HITITLE_SP);
    }

    // ------------------------------------------------------------
    /** 大标题：四个单字按固定步距（字号 + 字距）排，「成章」两字朱砂 */
    private buildTitle(y: number): void {
        const chars = ['挪', '字', '成', '章'];
        const pitch = TITLE_S + TITLE_SP;
        for (let i = 0; i < chars.length; i++) {
            setPos(mkLabel(this._root, chars[i], {
                size: TITLE_S, color: i < 2 ? CFG.COLOR.INK : CFG.COLOR.RED,
                bold: true, font: 'kai', lineHeight: TITLE_LH,
            }).node, (i - 1.5) * pitch, y);
        }
    }

    /** 示例拆字：木 ＋ 仓 ＝ 枪（设计稿 .home-demo 是 gap:9 的居中 flex 行） */
    private buildDemo(y: number): void {
        const items: Array<{ ch?: string; op?: string; kind?: 'r' | 'p' | 'w' }> = [
            { ch: '木', kind: 'r' }, { op: '＋' },
            { ch: '仓', kind: 'p' }, { op: '＝' },
            { ch: '枪', kind: 'w' },
        ];
        // 「＋」「＝」都是全角，宽度 = 字号（设计稿实测 17.3）
        const opW = DEMO_OP_S;
        const total = 3 * DEMO_P + 2 * opW + 4 * DEMO_GAP;
        let x = -total / 2;
        for (const it of items) {
            if (it.ch) {
                setPos(mkPiece(this._root, DEMO_P, it.kind, it.ch), x + DEMO_P / 2, y);
                x += DEMO_P + DEMO_GAP;
            } else {
                setPos(mkLabel(this._root, it.op!, {
                    size: DEMO_OP_S, color: CFG.COLOR.INK3, font: 'hei',
                }).node, x + opW / 2, y);
                x += opW + DEMO_GAP;
            }
        }
    }

    /** 收录一览里的一张小字牌（半透明白底 + 细米边 + 楷体字） */
    private buildPreviewTile(x: number, y: number, ch: string): void {
        const n = mkCard(this._root, TILE, TILE, TILE_R,
            CFG.COLOR.SURFACE_A_DEMO, CFG.COLOR.EDGE_A_SOFT, false);
        setPos(n, x, y);
        mkLabel(n, ch, {
            size: TILE_S, color: CFG.COLOR.TILE_TX, bold: true, font: 'kai', lineHeight: TILE,
        });
    }

    /**
     * 「同一行里分段换色/换字号」的通用排法（设计稿的富文本用 <b>/<em> 表达）。
     * ★ 已上移到 UIFactory.mkRuns —— 已成字条、结算页也要用同一条，
     *   留在这里会变成三份各自演化的副本。
     */
}

/**
 * 首页 12 张预览字牌（设计稿 `CHAPTERS.map(c => CH_POOL[c.id].slice(0,3))`）。
 * 不抄字池表：按"本章关卡里首次出现"的规则现算，与原型逐字一致，
 * 也不会在改关卡字单时忘了同步。
 */
function previewWords(): string[] {
    const out: string[] = [];
    for (const c of CHAPTERS) {
        const seen = new Set<string>();
        let got = 0;
        for (const lv of levelsOfChapter(c.id)) {
            for (const w of lv.words) {
                if (seen.has(w)) continue;
                seen.add(w);
                out.push(w);
                if (++got >= PER_CHAPTER) break;
            }
            if (got >= PER_CHAPTER) break;
        }
    }
    return out;
}

/** 「开始拆字」跳到哪一章：第一个还有未通关关卡的章 */
function chapterToPlay(): number {
    const n = nextLevelToPlay();
    for (const lv of LEVELS) if (lv.n === n) return lv.ch;
    return 1;
}
