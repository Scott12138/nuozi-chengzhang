/**
 * ============================================================
 *  Progress.ts · 进度派生规则（解锁 / 当前关）：唯一真源
 * ============================================================
 *  【为什么单独开一个文件】
 *  上一版把"某关解不解锁"分别写在三处：
 *      Save.isUnlocked(n)      —— 第 1 关永远开，其余要求上一关已通关
 *      ChapterPage.isUnlocked  —— 章：要求上一章最后一关已通关
 *      MapPage（内联）          —— 又有自己的一套
 *  三套规则稍有出入就会出**最恶心的那种 bug**：地图上节点是亮的（看着能点），
 *  点进去却被告知"还没解锁"。而且它不报错，只在特定存档下出现。
 *
 *  【设计稿的规则（prototype/index.html 的 renderChap / renderMap 原式）】
 *      章：  c.id === 1 || stars(上一章最后一关) > 0
 *      关：  i === 0 || stars(本章上一关) > 0 || ch === 1
 *            ↑ 注意最后一项：**第一章的所有关卡一上来全部开放**，
 *              玩家可以自由挑顺序打。这是设计稿刻意的（见
 *              shots/all-pages/05-关卡地图-第一章.png：只通了 1~3 关，
 *              4 关是红圈"当前关"，而 5~8 关是**正常白底**而非灰掉的锁定态）。
 *              第二、三、四章才走"顺序解锁"。
 *
 *  【为什么用 Save.isCleared 而不是"星数 > 0"】
 *  原型判的是 `G.stars[n] !== undefined`（有星就算过）。本工程用 cleared 表达
 *  "过关"更准确：星数是奖励，将来若有"0 星也算过关"的设计，两者就会分叉。
 *  在当前的星级规则下（通关必得 ≥1 星）两者完全等价。
 * ============================================================
 */

import { CHAPTERS, isPlayable, levelByN, levelsOfChapter } from './LevelData';
import { Save } from './Save';
import { LevelDef } from './Types';

/** 章是否解锁（第 1 章永远开；其余要求上一章最后一关已通关） */
export function chapterUnlocked(ch: number): boolean {
    if (ch <= 1) return true;
    const prev = levelsOfChapter(ch - 1);
    if (prev.length === 0) return false;
    return Save.isCleared(prev[prev.length - 1].n);
}

/**
 * 地图上第 i 个关节点是否解锁（设计稿 renderMap 原式）。
 * ★ `ch === 1` 直接全开 —— 这不是偷懒，是设计稿明确写着的规则，别改。
 */
export function levelInMapUnlocked(ch: number, lvs: LevelDef[], i: number): boolean {
    if (i <= 0) return true;
    if (ch === 1) return true;
    if (i >= lvs.length) return false;
    return Save.isCleared(lvs[i - 1].n);
}

/** 该关是否已通关（地图上画成"已完成"金底） */
export function isDone(n: number): boolean {
    return Save.isCleared(n);
}

/**
 * 本章的"当前关"：第一个「已解锁 + 未通关 + 贴图已备齐」的关；全通则返回 0。
 * 地图上它是唯一的朱砂红圈 + 呼吸光晕（设计稿 `.node.cur`）。
 * 加了 `isPlayable` 这一项：否则打到第 4 关时红圈会停在"待开发"的节点上，
 * 玩家会以为自己卡住了，其实只是这一关还没做完。
 */
export function currentLevelOf(ch: number): number {
    const lvs = levelsOfChapter(ch);
    for (let i = 0; i < lvs.length; i++) {
        const lv = lvs[i];
        if (isPlayable(lv) && levelInMapUnlocked(ch, lvs, i) && !Save.isCleared(lv.n)) return lv.n;
    }
    return 0;
}

/** 全局"从哪继续"：第一个「已解锁 + 未通关 + 可玩」的关；全通返回 1 */
export function nextLevelToPlay(): number {
    for (const c of CHAPTERS) {
        const lvs = levelsOfChapter(c.id);
        for (let i = 0; i < lvs.length; i++) {
            const lv = lvs[i];
            if (!isPlayable(lv)) continue;
            if (!levelInMapUnlocked(c.id, lvs, i)) continue;
            if (!Save.isCleared(lv.n)) return lv.n;
        }
    }
    return 1;
}

/** 该关是否可以真的进入（全局口径：可玩 + 本章内已解锁） */
export function canPlay(n: number): boolean {
    const lv = levelByN(n);
    if (!lv || !isPlayable(lv)) return false;
    const lvs = levelsOfChapter(lv.ch);
    const i = lvs.findIndex((x) => x.n === n);
    return i >= 0 && levelInMapUnlocked(lv.ch, lvs, i);
}
