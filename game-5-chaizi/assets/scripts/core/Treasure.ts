/**
 * ============================================================
 *  Treasure.ts · 宝牌物件表（每章各一套）
 * ============================================================
 *  【宝牌是什么】
 *  取代原来的"干扰牌"。每关按 `LevelDef.tr` 发 `tr` 对，**每对一种物件**，
 *  同款两张才能互配（见 `PairTable.canPair`）。凑成一对时：
 *    ① 消掉这两张宝牌；
 *    ② **额外随机消掉盘面上一对能合成的普通牌**（`Board.randomNormalPair`）。
 *
 *  所以它对操作次数是中性的 —— 每凑一对宝牌就替玩家省掉一对普通对，
 *  价值在"视觉减负 + 节奏爽点"，不在数值减负。
 *
 *  【为什么物件要按章分】
 *  宝牌是**主题物件**：第一章是兵器铺，摆个花瓶不合语境。
 *  第 1 章只用得上 1 件（该章 `tr` 恒为 1），第 4 章最多 3 件（`tr` 最高 3）。
 *
 *  【为什么 name 和 tex 分开】
 *    name = 给玩家看的（toast / 日志里说「把『铁砧』凑成一对」）；
 *    tex  = 贴图键，`TileManifest.TREASURE_TEX` 用它查文件名。
 *  两张表由 `tools/core-selftest.js` 对账（键集必须一致），
 *  防止"加了物件忘了出图"或"出了图没登记"这种静默错位。
 *
 *  ★ 本文件不 import 'cc'，与 core/ 其余部分同规矩（可用 node 直接断言）。
 * ============================================================
 */

export interface TreasureItem {
    /** 展示名（给玩家看的，两个字） */
    name: string;
    /** 贴图键，形如 `x_ch1_01` */
    tex: string;
}

/**
 * 章号 → 该章的宝牌物件（顺序即"第几对"）。
 *
 * ⚠️ **件数必须 ≥ 该章任意一关的 `tr`**，否则 `treasureOf()` 会回落到第 0 件，
 *    同一关里两对宝牌就会长得一模一样（且 `PairTable` 会认为它们能互配 → 违规则）。
 *    这条由 `tools/core-selftest.js` 的「宝牌物件」断言把关。
 *
 * ⚠️ 命名已经在**避让同章的字牌**：第一章的「锤」是正文字（`WORDS.锤`），
 *    所以宝牌叫「铁砧」而不是「大锤」—— 免得玩家以为它是能拆的字。
 */
export const TREASURE_ITEMS: Record<number, TreasureItem[]> = {
    // 第一章 百炼堂（兵器铺 / 锻造）
    1: [
        { name: '铁砧', tex: 'x_ch1_01' },
    ],
    // 第二章 花间集（花草 / 池塘 / 雨日）
    2: [
        { name: '花瓶', tex: 'x_ch2_01' },
        { name: '水盆', tex: 'x_ch2_02' },
    ],
    // 第三章 逛三园（果实 / 动物 / 稻禾）
    3: [
        { name: '果盘', tex: 'x_ch3_01' },
        { name: '竹篓', tex: 'x_ch3_02' },
    ],
    // 第四章 百工坊（器物 / 屋舍）
    4: [
        { name: '陶罐', tex: 'x_ch4_01' },
        { name: '灯盏', tex: 'x_ch4_02' },
        { name: '墨斗', tex: 'x_ch4_03' },
    ],
};

/** 取某一关「第 idx 对」宝牌用哪件物件（越界一律回落到第 0 件，见文件头警告） */
export function treasureOf(ch: number, idx: number): TreasureItem {
    const list = TREASURE_ITEMS[ch] || TREASURE_ITEMS[1];
    return list[idx < list.length ? idx : 0];
}

/** 一张牌是不是宝牌 */
export function isTreasure(t: { kind: string } | null | undefined): boolean {
    return !!t && t.kind === 'treasure';
}
