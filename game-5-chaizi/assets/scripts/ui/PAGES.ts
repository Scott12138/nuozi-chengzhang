/**
 * ============================================================
 *  PAGES.ts · 页面名常量（唯一真源）
 * ============================================================
 *  【为什么单独开一个文件放这几个字符串】
 *  页面之间要互相跳（首页→章节→地图→对局→结算→地图），若把常量写在各自页面里，
 *  就必然出现 `HomePage ⇄ ChapterPage` 这种**循环 import**。
 *  ES 模块能容忍循环 import（提升后是 undefined），但代价是运行时
 *  "某个常量读到 undefined"这类极难查的问题。常量单独放，问题从根上没有了。
 *
 *  ★ 名字与设计稿的 screen id 一一对应，便于逐页比对：
 *      #s-boot  → PAGE_BOOT      #s-clear → PAGE_CLEAR
 *      #s-home  → PAGE_HOME      #s-fail  → PAGE_FAIL
 *      #s-chap  → PAGE_CHAP      #s-atlas → PAGE_ATLAS
 *      #s-map   → PAGE_MAP       #s-set   → PAGE_SET
 *      #s-play  → PAGE_GAME
 *
 *  ⚠️ tools/web-smoke.mjs 的 `p:<page>` 断言直接比对这些字符串，
 *     改名字必须同步改脚本。
 * ============================================================
 */

export const PAGE_BOOT = 'boot';
export const PAGE_HOME = 'home';
export const PAGE_CHAP = 'chap';
export const PAGE_MAP = 'map';
export const PAGE_GAME = 'game';
export const PAGE_CLEAR = 'clear';
export const PAGE_FAIL = 'fail';
export const PAGE_ATLAS = 'atlas';
export const PAGE_SET = 'set';
