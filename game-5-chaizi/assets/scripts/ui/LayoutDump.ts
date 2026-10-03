/**
 * ============================================================
 *  LayoutDump.ts · 把版式打成"能与设计稿逐值比对"的日志
 * ============================================================
 *  【为什么要有它 —— 上一轮的教训】
 *  「页面要严格按照设计稿来」这句话，靠截图并排看是**验不出来的**：
 *  上一版把设计稿手机框的 390 当成了真实视口，实际是 372（border-box 把
 *  左右各 9px 的边框算进了 width），标尺差 4.8%。九页摆在一起才看得出
 *  "整体比设计稿紧一点"，单看任何一页都只是"差不多"。
 *  肉眼比对的分辨率就是不够。
 *
 *  所以这里把每个版式块的位置**按设计 px 打出来**，与
 *  `tools/design-geometry.mjs` 从原型量出的同一批数字做逐值 diff
 *  （`tools/layout-diff.py`）。误差 > 1 设计 px 就会在表里显出来。
 *
 *  【约定】
 *   · left / top 一律是「距屏幕左上角」的距离，单位 = **本工程 px**；
 *     换算成设计 px 由本文件统一做，页面里只管传真实布局值。
 *   · name 尽量用设计稿的类名（.topbar / .goal-bar / .tips / #board …），
 *     这样 diff 脚本能直接按名字对上。
 *   · 只在 DEBUG.LOG_STATE 打开时输出 —— 它是调试设施，不是运行时数据。
 * ============================================================
 */

import { log } from 'cc';
import { CFG } from '../CFG';
import { visibleSize } from './UIFactory';

/** 屏幕高度（本工程 px）。底部锚定元素的"距底距离"要用它 */
let _visH = 0;

/** 由 GameRoot 在启动时调一次，之后 dump() 才能算"距底距离" */
export function initDump(): void {
    _visH = visibleSize().h;
}

/**
 * 打一个版式块。
 * @param page  页面名（与 PAGES.ts 常量一致）
 * @param name  块名（尽量用设计稿类名）
 * @param left  左边缘距屏幕左边（本工程 px）
 * @param top   上边缘距屏幕上边（本工程 px）
 * @param w     宽（本工程 px）
 * @param h     高（本工程 px）
 * @param extra 备注（字号/文字等，纯给人看）
 */
export function dump(page: string, name: string, left: number, top: number,
                     w: number, h: number, extra = ''): void {
    if (!CFG.DEBUG.LOG_STATE) return;
    const S = CFG.SPEC.SCALE;
    const f = (v: number): string => (Math.round(v / S * 10) / 10).toFixed(1);
    const bot = _visH ? (Math.round((_visH - top - h) / S * 10) / 10).toFixed(1) : '?';
    log(`[Layout] ${page} ${name} x=${f(left)} y=${f(top)} w=${f(w)} h=${f(h)} `
        + `db=${bot}${extra ? ' ' + extra : ''}`);
}
