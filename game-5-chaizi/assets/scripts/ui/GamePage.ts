/**
 * ============================================================
 *  GamePage.ts · 对局页（设计稿 S05 · #s-play）
 * ============================================================
 *  玩法三条规则**一行都不在这里** —— 全在 core/Board.ts。本文件只负责：
 *    · 把 Board 的数据画成牌（贴图）
 *    · 把触摸事件翻成"拿起 / 拖动 / 落下"
 *    · 动效、计时、目标条、已成字条、工具、胜负判定
 *  这条分工是刻意的：规则能用 node 跑断言（tools/core-selftest.js），
 *  而这里的问题只能靠截图看 —— 两者混在一起，排查范围会失控。
 *
 *  ────────────────────────────────────────────────────────────
 *  版式：数字全部来自 tools/design-geometry.mjs 实测的盒模型
 *  （设计稿真实视口 **372×762**，见 CFG.SPEC），自顶向下：
 *
 *      .play-top   高 49 = 13 + 返回键32 + 4；返回键 32 在 (14,13)
 *                  标题 楷 15px/700 字距 1，起于 x 14+32+9 = 55
 *                  计时 16px/800 字距 .5 玉青，右端贴 372−14
 *      .goal-bar   高 40 = 4 + chip28 + 8；chip 高 28 / 圆角 10 / 间距 7 / 居中
 *                  chip 内：字 楷 18px 墨褐 + 计数 11px ink2，内距 9、间隙 5
 *      .tips       高 36、左右留 14、下距 4；圆角 12、金底金虚线边、
 *                  楷 14px 字距 1.5 色 #7A5F14。★ **只在有拆法提示的关卡出现**
 *      .board-wrap flex:1（吃掉全部剩余高度），棋盘在其中居中
 *      .made-strip 高 62、左右留 14、下距 8；圆角 14、半透明白底 + 1px 内描边
 *      .tool-bar   高 83 = 8 + tool59 + 16；三个 tool 各 108 宽、间距 10
 *                  tool 内：数字 楷 21px 朱砂 在上，标签 11.5px 墨褐 在下
 *
 *  【棋盘尺寸是"算"出来的，不是写死的】
 *  原型 `computeCell()` 原式见 CFG.BOARDGEO 的注释。实测复核 L1：
 *  cell 58 / gap 5 / 牌 53 / 棋盘 348×290 —— 与盒模型逐值吻合。
 *
 *  【★ 拿起那一刻就把滑动范围算死，拖动全程不重算】
 *  否则牌被拖到中途、原格变成空的，range 会越算越大 —— 表现就是
 *  "牌可以一边挪一边穿过别的牌"，直接违背核心规则。
 *
 *  【★ 空格平时不显形】
 *  设计稿 `.cellbg{background:transparent}`：水墨画面里不该有格子线。
 *  只有"拿起一张牌时把它本行/本列能滑到的格子点亮"才画 ——
 *  底色 + 双线描边 + 中心提示点三件套（太淡等于没有，实测在宣纸米色底上
 *  只铺底色几乎看不见）。
 *
 *  【拖动交互为什么挂在棋盘节点上，而不是每张牌各挂一个】
 *  ① 落点判定要的是**棋盘坐标系**（哪一格），挂在牌上还得反算父节点偏移；
 *  ② 牌在消除/重排时会销毁重建，挂在牌上的监听器要跟着搬一次，容易漏；
 *  ③ 拖动中会把牌 setSiblingIndex 置顶，若监听挂在牌上，事件目标会跟着换。
 *  棋盘节点只有一个，UITransform 覆盖整个棋盘，命中判定稳定。
 * ============================================================
 */

import {
    Color, EventTouch, Graphics, Label, Node, Sprite, tween, Tween, UIOpacity, UITransform,
    Vec2, Vec3, log, screen, view,
} from 'cc';
import { CFG, px } from '../CFG';
import { Board, PairTable, generateBoard, makeRunWords, pairedNeighbors } from '../core/Board';
import { CHAPTERS, LEVELS, WORDS, levelByN } from '../core/LevelData';
import { seedsOf } from '../core/LevelSeeds';
import { Rng, seedFrom } from '../core/Rng';
import { Save } from '../core/Save';
import { solvableInPlace } from '../core/Solver';
import { treasureOf } from '../core/Treasure';
import { Cell, DragAxis, LevelDef, PushMove, ResultParam, RunWord, SlideRange, Tile } from '../core/Types';
import { AdGate, AdGateOpts } from './AdGate';
import { AdService } from './AdService';
import { AudioService } from './AudioService';
import { FailGate } from './FailGate';
import { PageBase } from './PageBase';
import { PageManager } from './PageManager';
import { PAGE_CLEAR, PAGE_GAME, PAGE_MAP } from './PAGES';
import { Toast } from './Toast';
import { loadTileByChar, preloadTiles, TileRef } from './TileAtlas';
import { dump } from './LayoutDump';
import {
    estWidth, hex, mkEdge, mkFace, mkInsetVignette, mkLabel, mkNode, mkPaperBG, mkRuns, mkShadow,
    pressable, safeTop, setPos, topY, visibleSize,
} from './UIFactory';

// ------------------------------------------------------------
//  「看广告重排」的判定预算（单位：毫秒 / 节点数）
// ------------------------------------------------------------
//  ★ 判据是**整盘可解**（core/Solver.ts），不是"至少有一对能消"。
//    这个判定与离线逐关判定（tools/solve-exact.js）**用的是同一个函数**，
//    但运行期给不起离线那样的算力，所以分两档花：
//
//    ① 便宜档：换 RESHUFFLE_GREEDY_TRIES 个随机顺序各贪心一次（**每轮都做**）
//       实测一次贪心 ~0.7ms、单次命中率 25~35% ⇒ 8 次约 6ms、命中 90%+
//       贪心一旦通关，交出来的就是**一条真的走法**（构造性证据，最可靠）
//    ② 贵档：只有便宜档全败、且**整轮预算还没花完**时才上 DFS。
//       DFS 只活在这一个窗口里（毫秒与节点数谁先到谁停），
//       后面那些轮次一律只跑便宜档 —— 否则玩家点一下要卡好几秒。
// ------------------------------------------------------------
const RESHUFFLE_TRIES = 30;            // 换多少个盘面（沿用旧值）
const RESHUFFLE_GREEDY_TRIES = 8;      // 每个盘面换几个顺序贪心
const RESHUFFLE_DFS_MS = 600;          // 整轮共享的 DFS 墙钟
const RESHUFFLE_DFS_NODES = 20000;     // 单次 DFS 节点上限

// ------------------------------------------------------------
//  版式常量（单位 = 设计稿 px，统一走 px() 换算）
// ------------------------------------------------------------

// .play-top{padding:13px 14px 4px;gap:9px}
// ⚠️ 设计稿的第一个数 13 是"距屏幕顶"，真机上要避开状态栏/灵动岛与微信胶囊 ——
//    这一页尤其要紧：`.timer` 就在右上角，正好是胶囊所在的位置。
//    所以改用 safeTop()（=56 设计px）。理由见 CFG.LAYOUT.SAFE_TOP。
const TOP_PAD_T = safeTop(), TOP_PAD_X = px(14), TOP_PAD_B = px(4), TOP_GAP = px(9);
/**
 * `[Diag] NONMATCH` 用的固定种子。
 * ★ 必须是**常量**：这一行是给冒烟的 `rebound:` 动作取坐标的，
 *   若沿用会随时序漂移的 _diagRng，同一盘面读两次会给出不同的走法 ——
 *   脚本"读到坐标 → 拖过去"之间只要又打了一次 diag 就会拖错格。
 */
const DIAG_NM_SEED = 20261002;

/**
 * `[Diag] TREASURE` 用的固定种子（同理，必须是常量）。
 * ★ 与 NONMATCH 的种子**故意取不同的值**：两者都在同一次 diag() 里被调用，
 *   若共用种子，先调用的那个会把随机流走掉一段，后一个的输出就随调用顺序变了。
 */
const DIAG_TR_SEED = 20261003;

/**
 * `[Diag] PUSH` / `[Diag] PUSHNM` 用的固定种子（同理，必须是常量）。
 * ★ 与前两个**也必须不同**：三者在同一次 diag() 里依次被调用，
 *   共用种子的话，先跑的那个会把随机流走掉一段，后面的输出就随调用顺序变了。
 */
const DIAG_PUSH_SEED = 20261004;

/**
 * 调试用的**固定发牌种子**（工装往页面里写 `globalThis.__CHA_SEED__ = <正整数>`）。
 *
 * 【为什么必须留这个口子】
 * 开局虽然是"从本关 4 颗已验证种子里随机挑一颗"，但对验证来说**随机仍是灾难**：
 * 「卡住 → 看广告重排」这条链路只在盘面自己走死时才出现，而贪心拖拽
 * 有时 8 步就卡死、有时 9 步直接通关（同一条命令实测两种结果都出现过）。
 * 断言于是变成掷骰子 —— 失败了还分不清是"代码坏了"还是"这局恰好没走死"。
 * 钉住种子之后，同一颗种子永远给出同一个盘面，这条冒烟从"碰运气"变成
 * "确定性回归"：种子取到过死局，以后每次都能重放那一次死局。
 *
 * ⚠️ 只影响**发牌**，不改任何玩法规则；没设这个全局变量时返回值 0，
 *   调用处退回"从 LevelSeeds 里随机挑"。微信小游戏里没有任何地方会设它。
 */
function forceSeed(): number {
    const v = Number((globalThis as Record<string, unknown>).__CHA_SEED__);
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

/**
 * 本局用哪颗发牌种子。
 *
 * 【2026-10-03 改：从"按时间随机"改成"从本关 4 颗已验证种子里随机挑"】
 * 用户拍板的原话：「减少随机开局的情况，从 8 盘随机开局降低到 4 盘随机开局，
 * 保证这 4 种开局时一定有解的」。
 * 依据是实测：旧的 `seedFrom(lv.n)`（混 Date.now）发出来的盘面**只有 84% 有解**，
 * 36 关里有 20 关会发出死局盘面（第 1 关都只有 79%）。
 * 现在这 4 颗种子全部由 `tools/gen-level-seeds.js` **离线**判定为有解，
 * 所以开局零额外开销、且**不会**发出死局。
 *
 * 优先级：工装钉死的种子 > 本关登记表里随机挑一颗 > （兜底）旧的按时间随机。
 * 最后一档**不该发生**（core-selftest 断言了 1~38 关每关都有 4 颗），
 * 留着只是为了"宁可盘面可能无解，也不要因为查不到数据就崩在这一行"，
 * 而且要 log 出声 —— 静默降级会把数据脱节藏起来。
 */
function pickSeed(lvN: number, lvFallback: number): number {
    const forced = forceSeed();
    if (forced) return forced;
    const seeds = seedsOf(lvN);
    if (seeds.length) return seeds[Rng.shared.int(0, seeds.length)];
    log(`[GamePage] ⚠️ 第 ${lvN} 关没有登记种子（LevelSeeds 与关卡表脱节？）`
        + ' —— 退回按时间随机发牌，这局盘面可能无解');
    return seedFrom(lvFallback);
}

/**
 * 调试用的**限时压缩**（工装往页面里写 `globalThis.__CHA_TIME__ = <正整数秒>`）。
 *
 * 【为什么必须有它】
 * 「时间到 → 弹层 → 看视频复活 → 原地接着打」这条链路是本轮新加的，
 * 而 L1 的限时是 150 秒 —— 想用真事件跑完一次回归得干等两分半，
 * 而且要复现"复活之后还能继续玩"还得多等一轮。整条回归会被一个 sleep 拖垮，
 * 于是这条链路实测上等于不可验证。有了它，冒烟里 `time:6` + `wait:7000` 就够。
 *
 * ⚠️ 只改**倒计时长度**，不动关卡数据、不动星级口径、不动发牌。
 *    没设这个全局变量时原样返回 `lv.time` —— 行为与加这个口子之前逐字节一致。
 *    微信小游戏里没有任何地方会设它，所以线上永远是关卡表里的真实限时。
 */
function forceTimeLimit(lvTime: number): number {
    const v = Number((globalThis as Record<string, unknown>).__CHA_TIME__);
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : lvTime;
}

/**
 * 调试用的**指定关卡**（工装往页面里写 `globalThis.__CHA_LEVEL__ = <关号>`）。
 *
 * 【为什么需要它 —— 与 seed / time 同构的第三个口子】
 *   `unlock:<n>` 只把前 n 关标成已通关，**真正进哪一关还得在地图上点**。
 *   而地图是可滚动的（38 关分 13 行），要进第 34 关得先把地图拖到底、
 *   再把新位置量出来当 `d:` 用 —— 每次改版式都要重做一遍，且极易点偏。
 *   有了它，`lvl:34` 就稳定落在 10×7 的大盘面上，与 `lvl:1`（6×5）
 *   组成"同一套骨架、不同行列数"的对照 —— 这正是版式验收要的东西。
 *
 * ⚠️ 只改"进哪一关"，不改任何玩法；没设这个全局变量时返回 0，
 *   `onCreate` 退回用 `PageManager.goto` 传进来的关号 ⇒ 行为逐字节不变。
 *   微信小游戏里没有任何地方会设它。
 */
function forceLevel(): number {
    const v = Number((globalThis as Record<string, unknown>).__CHA_LEVEL__);
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}
const BACK_D = px(32);
const TOP_H = TOP_PAD_T + BACK_D + TOP_PAD_B;                 // 49

/**
 * ★★ 内容块整体下移的比例（2026-10-03 用户第 2 条「页面分割太开」）★★
 *
 * 【它在解决什么】
 *   牌面必须**正方形**，而屏幕是竖长的：6×5 的棋盘占满可视宽度却只用掉
 *   可用高度的 ~55%，10×7 更矮。旧做法是"棋盘区吃满剩余高度、棋盘在其中居中"，
 *   于是**顶部块与棋盘之间**、**棋盘与底部块之间**各摊到一大块空白 ——
 *   用户在真机上看到的就是"页面分割太开"。
 *
 * 【改法】
 *   棋盘面板取**固定内高** `CFG.BOARDGEO.PANEL_INNER_H`（见那里的长注释与
 *   computeGeometry ③④）。于是
 *     · 面板本身**不随行列数变** —— 用户原话「地图大小不变，只变格子和字体的大小」；
 *     · 三段之间**不留缝**（棋盘面板不再吃满剩余高度），省下来的空白
 *       让整块内容一起下移 `slack × 本比例`：
 *         · 0.0 = 空白全留在屏幕底部（顶部块顶天）
 *         · 0.5 = 空白天平（**采用**：上下各一半，视觉上就是正常的页面留白）
 *      ⚠️ 这个比例**只有 0.5 可行**：三段要"缝为 0"就必须 `2×下移量 == slack`
 *        （面板下沿 + 下移量 == 底部块上沿 − 下移量），取别的值会在
 *        面板与「已成字条」之间凭空多出一条缝。
 *   于是「顶部块 → 目标字条 → 地图面板 → 已成字条 → 道具栏」是**挨着**的、
 *   且**逐关不动**，空白只出现在屏幕最上/最下 —— 那两处本来就该是留白。
 */
const CONTENT_SHARE = 0.5;
const PTITLE_S = px(15), PTITLE_LS = px(1), PTITLE_LH = px(21), PTITLE_W = px(160);
const TIMER_S = px(16), TIMER_LS = px(0.5), TIMER_LH = px(22);

// .goal-bar{padding:4px 14px 8px;gap:7px;flex-wrap:wrap}
const GOAL_PAD_T = px(4), GOAL_PAD_X = px(14), GOAL_PAD_B = px(8), GOAL_GAP = px(7);
const CHIP_H = px(28), CHIP_R = px(10), CHIP_PAD = px(9), CHIP_BORDER = 1, CHIP_IGAP = px(5);
const GW_S = px(18), GN_S = px(11), GN_LS = px(0.5);

// .tips{margin:0 14px 4px;padding:7px 12px;border-radius:12px;border:1px dashed}
const TIPS_MX = px(14), TIPS_MB = px(4), TIPS_PAD_Y = px(7), TIPS_R = px(12);
const TIPS_S = px(14), TIPS_LS = px(1.5), TIPS_LH = px(20);
const TIPS_H = TIPS_PAD_Y * 2 + 2 + TIPS_LH;                  // 36

// .made-strip{margin:0 14px 8px;height:62px;border-radius:14px;padding:0 9px;gap:7px}
const MADE_MX = px(14), MADE_MB = px(8), MADE_H = px(62), MADE_R = px(14);
const MADE_PAD = px(9), MADE_GAP = px(7);
const MS_EMPTY_S = px(11.5), MS_EMPTY_LH = px(19), MS_EMPTY_LS = px(0.3);
const MS_CARD_PAD = px(5), MS_CARD_R = px(10);
const MS_P = px(25), MS_P_R = px(7), MS_P_S = px(15), MS_P_W_S = px(16);
const MS_OP_S = px(11), MS_IGAP = px(3);

// .tool-bar{padding:8px 14px 16px;gap:10px} / .tool{padding:9px 4px 8px;border:1px;border-radius:14px}
const TOOL_PAD_T = px(8), TOOL_PAD_X = px(14), TOOL_PAD_B = px(16), TOOL_GAP = px(10);
const TOOL_B_S = px(21), TOOL_B_LH = px(22.05);
const TOOL_LBL_S = px(11.5), TOOL_LBL_LS = px(0.5), TOOL_LBL_LH = px(16);
const TOOL_IGAP = px(2);
const TOOL_BORDER = 1, TOOL_R = px(14);
const TOOL_H = px(59);
/**
 * 工具格数。
 * ★ 2026-10-03 由 3 改为 4（用户拍板"道具更换成四个种类"）。
 *   收成一个常量是因为它同时被两处消费（`buildTools` 排版、`dumpLayout` 版式 dump），
 *   两边各写一个 3 的下场是：版式比对工具（tools/layout-diff.py）与真机不一致，
 *   而它看起来只会像"版式核对差了一点"，很难联想到是常量没同步。
 */
const TOOL_COUNT = 4;
const BAR_H = TOOL_PAD_T + TOOL_H + TOOL_PAD_B;               // 83

/** 文字区（棋盘四周的固定块）总高：棋盘区下沿距屏幕底的距离 */
const BOTTOM_BLOCKS = BAR_H + MADE_MB + MADE_H;               // 153

/** 工具禁用态 `.tool:disabled{opacity:.42}` */
const TOOL_OFF_ALPHA = Math.round(255 * 0.42);

// ---- 「多选配对」的呼吸闪烁（2026-10-03 用户拍板）----
/**
 * 紧邻（上下左右）的**可配对搭档数**达到这个值才闪。
 * 取 2 直接来自用户原话「**两个**都可以消除的时候，闪烁一下提示用户，
 * 让用户来选择消除哪个配对」—— 一个搭档时没有"选择"可言，闪了反而添乱。
 */
const FLASH_MIN_PARTNERS = 2;
/** 呼吸的步数（一个完整往返）与每步时长：8 × 160ms ≈ 1.28s */
const FLASH_STEPS = 8;
const FLASH_MS_STEP = 160;
/** 呼吸的透明度上下限（0~1）。下限不取 0：完全灭掉会读成"偶尔闪一下"而不是"一直在呼吸" */
const FLASH_HI = 1, FLASH_LO = 0.22;
/**
 * 拖动中牌的放大（原型 `scale(1.1)`）。
 * ★ 2026-10-03 真机试玩后，**原型的 `rotate(±6deg)` 被去掉了**（用户原话"格子会歪掉"）——
 *   所以这里只剩放大。别再照着原型把倾斜抄回来，见 onMove 里的说明。
 */
const DRAG_SCALE = 1.1;
/**
 * 「拎起来」的补间时长（秒）。
 * ★ 别改回"按下瞬间就把 scale 设成 DRAG_SCALE"：那种硬跳变在手感上像"牌被替换了"，
 *   而 80ms 的短补间会读成"纸片被手指拈起来"，同时也兼任**点击的第一个微反馈** ——
 *   玩家无论最后是点还是拖，按下立刻就有东西动，这是"跟手"的前提。
 */
const LIFT_MS = 0.08;
/**
 * ~~越界橡皮筋~~ **已在 2026-10-03 移除**。
 *
 * 原实现：拖出滑动范围后牌还能被拉着多走最多 20 设计px（渐近饱和），
 * 设计意图是"让人感到被拉住了而不是硬切"。
 * 真机上这条直接被读成 bug —— 用户原话：「而且能拉出边界之外」，
 * 截图实测：牌越出棋盘左边界约半张牌宽。
 *
 * 现在位置一律取 `clampSlide` 给的那一格的**格心**（见 onMove），
 * 而那个格恒在 `range` 内 ⇒ 牌永远落在格心上、永远在棋盘内，不需要额外的边界夹取。
 * ⚠️ 别再引入"超出范围时还能多走一点"的任何形式：那在玩法上就等于"牌离开了棋盘"。
 */
/** 落位补间（秒）：松手后牌滑进目标格，别用瞬移（瞬移会有"啪一下"的断裂感） */
const SEAT_MS = 0.09;
/** 点击落空时的"一点"回弹幅度与时长（秒） */
const TAP_PUNCH_MS = 0.07;
/** 点击波纹：从牌的 0.72 倍扩到 1.5 倍，用时与颜色 */
const TAP_RIPPLE_MS = 0.32;
/** 合成撞击：两牌沿运动轴的挤压（宽 → 窄），以及棋盘的微震位移（设计px） */
const IMPACT_SQUASH = 1.18, IMPACT_SQUASH_MS = 0.07;
const IMPACT_SHAKE = 3, IMPACT_SHAKE_MS = 0.2;
/** 合成撞击环：从 0.4 倍扩到 2.4 倍 */
const IMPACT_RING_MS = 0.34;
/** 计时警示态闪烁周期（原型 `blink .85s`） */
const BLINK_MS = 425;

// ── 合成字的"凸显"（用户拍板：更大更亮 + 金色光晕）──
/**
 * 合成字浮现的峰值倍率。原型是 1.42，拍板改成 1.78 ——
 * 合成那一瞬间，玩家的眼睛本来就在棋盘中点，1.42 只是"大一点"，
 * 1.78 才是"这个字是这一下做出来的"。
 * ⚠️ 再大就要撞到相邻格子了（牌宽 53 设计px，1.78 ≈ 94，仍在棋盘内）。
 */
const MELT_PEAK = 1.78;
/** 淡出时要比峰值再大一圈（1.78 → 2.3），读作"化开了"而不是"缩回去了" */
const MELT_OUT = 2.3;
/** 金色光晕：合成字背后那圈扩散的藤黄光环 */
const GLOW_MS = 0.52, GLOW_FROM = 0.55, GLOW_TO = 2.1;
/** 光晕的线宽（设计px）。太细会像描边，不像"光" */
const GLOW_W = 5;

// ── 宝牌成对的三段时序（ms）──
/**
 * 宝牌成对的演出是**三段**，不是一次全消。三个数就是这三段的分界：
 *   0            → `TREASURE_POINT_MS`  宝牌撞掉 + 器物显形 + 器物"收势"
 *   TREASURE_POINT_MS → `TREASURE_TAKE_MS`  把"被送掉的那一对"用金线圈出来（**必须看得见**）
 *   TREASURE_TAKE_MS  → `TREASURE_CLEANUP_MS` 它俩撞掉 → 清理 → 判胜负
 * ★ 中间那段绝对不能省：省掉之后玩家读到的是"凑了个宝牌，然后场上少了两张牌"，
 *   而不是"它替我把『木+仓』消成了『枪』" —— 后者才是这个机制的价值所在。
 *
 * ★★ 2026-10-03 用户拍板：**把"圈住赠品"整段延后**。
 *   原来第一段只留 240ms，而器物显形（`treasureCrest`）本身要演到 ~770ms 才收完 ——
 *   于是"器物"正好盖在"被圈住的赠品"上。用户给的解法原话：
 *   「选择延后『圈住赠品』那段，适当增加动态效果」。
 *
 *   新时序的**锚点不是拍脑袋的数，是 `treasureCrest` 的生命周期**：
 *     0     器物开始涨（0.4s → 峰值）
 *     430   器物开始收
 *     ~770  收到 MELT_OUT
 *     820   器物节点 destroy（treasureCrest 里的收尾 timer）
 *   → 所以第一段给到 **840**（= 820 + 20ms 缓冲）：器物确实没了，圈才开始。
 *   这一段也因此撑长了整段演出（1080 → 1780ms），但只在**一次宝牌成对**上发生，
 *   一关最多 3 次；换来的是"额外消掉的那一对"真的看得见，值。
 *
 *   多出来的 400ms 不是空等，全用来做"圈住"这一下的动态（见 `resolveTreasure`）：
 *   金线从一头**生长**过去 → 两枚金圈**收紧**套住 → 两张牌被**挑起**一下。
 */
const TREASURE_POINT_MS = 840, TREASURE_TAKE_MS = 1260, TREASURE_CLEANUP_MS = 1780;
/** 器物"收势"那一刻：与 `treasureCrest` 里 430ms 开始收缩对齐 */
const TREASURE_CREST_SINK_MS = 430;

// ── 通关 / 超时的收尾动效 ──
/** 通关：一圈金色涟漪从中点扩出去 + 棋盘轻轻"收势" */
const WIN_RING_MS = 0.62, WIN_RING_TO = 3.4;
/** 超时：一圈墨色涟漪（收束感）+ 棋盘一记更重的震 */
const FAIL_RING_MS = 0.46, FAIL_RING_TO = 2.2;
/** 超时震动的位移（设计px）—— 比合成撞击的 3 大一倍，读作"塌了" */
const FAIL_SHAKE = 7;

// ── 顶栏静音小喇叭 ──
const MUTE_D = px(24);
/** 喇叭与计时器之间的间隙（设计px） */
const MUTE_GAP = px(6);

/** 拖动中的状态。整个拖动期间只有这一份，松开即丢 */
interface DragState {
    tile: Tile;
    node: Node;
    homeR: number;
    homeC: number;
    /** ★ 拿起瞬间冻结的滑动范围 */
    range: SlideRange;
    startX: number;
    startY: number;
    /** 按下点相对牌中心的偏移：让牌不会"跳"到指针正下方 */
    offX: number;
    offY: number;
    axis: DragAxis | null;
    moved: boolean;
    last: Cell | null;
    /**
     * ★ 上一次**诊断采样**时牌节点的位置（棋盘局部坐标）。只服务于 `[Diag] DRAG`
     * 那一行的采样规则，不参与任何玩法判定。
     *
     * 【为什么不能只按"跨格"采样】（2026-10-03 负控实验揪出来的）
     * 旧实现在手指还按着时是"跟手自由滑"，牌可以一路滑到画布边 ——
     * 但**落点格 `p` 被 clampSlide 夹住**，到了棋盘最外一格就不再变了。
     * 于是"只在跨格时打印"意味着：**牌已经跑出棋盘的那几百毫秒里一行都不打**，
     * 冒烟的 `dragcell:` 想断言的"出界"永远取不到样本 —— 判据写着却永远不报警。
     * ⇒ 采样规则改成「跨格 **或** 节点位置比上次采样又多走了半格」。
     *   · 整格吸附（当前实现）：位置只在跨格时变 ⇒ 不会多出一行，零额外噪声；
     *   · 跟手自由滑（错的实现）：位置一直在变 ⇒ 反而能把越界那一段如实记下来。
     *   一句话：**采样规则要跟着"能变的东西"走，不能跟着"我们以为会变的东西"走**。
     */
    lastNode: { x: number; y: number } | null;
    /**
     * ★ 此刻正被这一手推着走的牌 → 它被推到的格（2026-10-03 推箱）。
     *
     * 这是**纯显示状态**：`_board` 里那些牌的位置一个字节都没动过
     * （与"整段拖动只改节点 position"这条老约定一致）。
     * 拖到一半松手 → 凑成字就 `applyDrag` 一次性落盘；凑不成字就整段弹回。
     * 每帧重算（见 `paintPush`），因为它会随落点变长变短。
     */
    pushed: Map<Tile, Cell>;
}

/** 目标条上的一格 */
interface Chip {
    word: string;
    root: Node;
    num: Label;
    /** 目标 chip 的面与边（完成态要重画成金底） */
    faceG: Graphics;
    edgeG: Graphics;
    w: number;
    h: number;
}

/** 工具按钮 */
interface ToolBtn {
    root: Node;
    num: Label;
    op: UIOpacity;
    /** 光晕圈（`.tool.glow`）。平时 alpha=0，死局时由 glowShuffle 点起来 */
    glow: Graphics;
}

/**
 * 四个道具的内部键（**顺序 = 工具栏从左到右**）。
 * ⚠️ `bomb` 这个键名对不上它现在的标签「消除」—— 见 CFG.TOOL 的说明，
 *    是"改名不值当"的刻意取舍，不是漏改。
 */
type ToolKey = 'hint' | 'bomb' | 'shuffle' | 'time';

export class GamePage extends PageBase {

    readonly pageName = PAGE_GAME;

    // ---- 玩法数据 ----
    private _lv!: LevelDef;
    private _pair!: PairTable;
    private _board!: Board;
    private _rng!: Rng;
    private _runWords: RunWord[] = [];
    private _madeWords: string[] = [];
    private _moves = 0;
    /**
     * 上次弹「这一步凑不成字」的时间戳（ms）。
     * 严格回弹会发生得很频繁（玩家探索时会连着拖好几张），
     * 靠它把提示节流到 2.5s 一次 —— 见 reboundTile 的注释。
     */
    private _lastReboundToastAt = 0;

    // ---- 几何 ----
    // ★ 必须显式标 number：CFG 是 `as const`，CFG.DESIGN.W 的类型是字面量 720，
    //   直接赋值会让字段被推断成 `720`，之后赋任意屏宽都报 TS2322。
    private _visW: number = CFG.DESIGN.W;
    private _visH: number = CFG.DESIGN.H;
    /** 格距（= 原型里的 G.cell） */
    private _pitch = 58;
    private _gap = 5;
    /** 牌面边长 = 格距 − 间隙 */
    private _tile = 53;
    private _boardW = 0;
    private _boardH = 0;
    /**
     * **实际棋盘**的列/行数 —— 不是关卡表里的 `lv.cols × lv.rows`。
     *
     * ★ 2026-10-03 起发牌是**密铺**的：行数 = `ceil(牌数 / lv.cols)`，
     *   比关卡表的 rows 小（L4 是 6×6、关卡表写的是 6×7）。所有几何
     *   （格距、棋盘宽高、`cellX/cellY`）都必须用这两个数，
     *   否则牌会按关卡表的行数去居中 → 整盘歪在棋盘上方。
     *   历来的 `_lv.cols/_lv.rows` 只表示"这一关的**容量上限**"。
     */
    private _cols = 0;
    private _rows = 0;

    // ---- 节点 ----
    private _boardNode!: Node;
    private _tileLayer!: Node;
    private _fxLayer!: Node;
    /** 水滴波纹层（点击微反馈 / 合成撞击环）—— 在描边层之上、特效层之下 */
    private _rippleLayer!: Node;
    private _reachDraw!: Graphics;
    private _linkDraw!: Graphics;
    private _ringDraw!: Graphics;
    /** 「多选配对」的呼吸闪烁层（画在牌之上）+ 它的定时器 id */
    private _flashDraw!: Graphics;
    private _flashId = 0;
    private _views = new Map<number, Node>();
    private _chips = new Map<string, Chip>();
    private _timerLb!: Label;
    private _timerOp!: UIOpacity;
    private _toast!: Toast;
    /** 卡住时的「看广告重排」弹层（常驻、切 active） */
    private _adGate!: AdGate;
    /** 时间到时的「看视频复活」弹层（常驻、切 active）。理由见 ui/FailGate 文件头 */
    private _failGate!: FailGate;
    private _tools: Record<ToolKey, ToolBtn | null>
        = { hint: null, shuffle: null, bomb: null, time: null };
    /** 已成字条的**可滚动内容节点**（横向 overflow） */
    private _madeLayer!: Node;
    private _madeInnerW = 0;

    // ---- 状态 ----
    private _drag: DragState | null = null;
    private _busy = false;
    private _finished = false;
    private _deadline = 0;
    private _tickId = 0;
    private _blinkId = 0;
    private _hintLeft: number = CFG.TOOL.HINT;
    private _shuffleLeft: number = CFG.TOOL.SHUFFLE;
    /** 原「凑对」，2026-10-03 起玩家看到的标签是「消除」（字段名保持不变，见 CFG.TOOL 的说明） */
    private _bombLeft: number = CFG.TOOL.BOMB;
    /** 2026-10-03 新增的第四个道具「延长时间」的剩余次数 */
    private _timeLeft: number = CFG.TOOL.TIME;
    /** 盘面状态序号（每次 diag 自增），用来判定"这一刻之后状态有没有变" */
    private _seq = 0;
    /**
     * 只给诊断用的随机源。
     * ★ 必须与玩法用的 _rng 分开：diag() 里会调 findSuggest，而它会洗牌。
     *   共用的话，冒烟脚本每读一次诊断日志就等于替玩家多摇了一次骰子，
     *   自动重排的结果会随"脚本读了几次"而变 —— 不可复现。
     */
    private _diagRng = new Rng(20260101);
    /** 本局实际用的发牌种子（来自 LevelSeeds；工装可以把它钉死） */
    private _seed = 0;
    /** 本局实际限时（秒）。正常等于 `_lv.time`，被 `__CHA_TIME__` 压过就是那个值 */
    private _timeLimit = 0;

    // ============================================================
    //  建页
    // ============================================================
    protected onCreate(param?: { level?: number }): void {
        // ★ 调试口子的优先级：`__CHA_LEVEL__`（工装）> `goto` 传进来的关号。
        //   与 seed / time 一致：只在被显式设置时才改行为，且**要 log 出声** ——
        //   静默覆盖会让"我明明点的第 3 关怎么进了第 34 关"变成一个查不出的谜。
        const forced = forceLevel();
        if (forced) log(`[GamePage] ⚠️ 工装指定关卡：__CHA_LEVEL__ = ${forced}（覆盖 goto 传进来的 ${(param && param.level) || 1}）`);
        const n = forced || ((param && param.level) || 1);
        const lv = levelByN(n) || LEVELS[0];
        this._lv = lv;

        const vs = visibleSize();
        this._visW = vs.w;
        this._visH = vs.h;

        // 页面底：#s-play 是略暖的径向渐变（比其它页再暖一档）
        const C = CFG.COLOR;
        mkPaperBG(this._root, this._visW, this._visH, C.BG_GAME_TOP, C.BG_GAME_MID, C.BG_GAME_BOT);

        this._pair = new PairTable(lv.words);
        this._seed = pickSeed(lv.n, lv.n);
        this._timeLimit = forceTimeLimit(lv.time);
        this._rng = new Rng(this._seed);
        this._board = generateBoard(lv, this._pair, this._rng);
        // ★ 密铺之后**实际棋盘**比关卡表矮：几何一律以实际棋盘为准（见 _cols/_rows 的说明）
        this._cols = this._board.cols;
        this._rows = this._board.rows;
        this._runWords = makeRunWords(lv);

        // ★★ BGM 的起播点：必须在**同步栈**里 ★★
        //   autoplay 策略要求音频的首次播放落在用户手势的调用栈内，否则被静默拦截
        //   （不报错、日志也没线索，只是没声音）。PageManager.goto 是全同步的，
        //   而它又由点击回调同步触发 ⇒ 此刻还在栈内 ✅
        //   ⚠️ 绝不能挪进下面那个 `preload(...).then(...)` —— 那里已经出栈了。
        //   资源若还没就绪也没关系：AudioService 会记住"想要 BGM"这个意图，
        //   等资源到位或玩家第一次点击时补上（play() 里也带一次 tryStartBgm）。
        AudioService.playBgm();

        this.computeGeometry();
        this.buildChrome();
        this.buildBoard();
        this.buildMadeStrip();
        this.buildTools();

        // 贴图先预热再开表：否则玩家在等贴图的那几秒白白被扣时间。
        // ★ 第 2~4 章的贴图在**微信小游戏分包**里（ch02/ch03/ch04），
        //   `preloadTiles` 内部先把涉及的章全部 ensure（下分包）再逐张取图。
        //   ⚠️ 是"涉及的每一章"而不是"本关那一章"：跨章复用的字会来自别的 bundle，
        //      38 关里有 30 关这样（见 TileAtlas.chaptersOf 的注释）。
        const refs: TileRef[] = [];
        for (const t of this._board.allTiles()) refs.push({ char: t.char, kind: t.kind, tex: t.tex });
        preloadTiles(refs, lv.ch).then(() => {
            if (!this._root || !this._root.isValid) return;   // 已切页
            this.renderTiles();
            this.renderGoals();
            this.renderMade();
            this.renderTools();
            // ★★ 覆盖层必须是**整页最后一个**挂上去的东西 ★★
            //   理由见 buildOverlays 的注释：Cocos 靠挂载先后决定层级，
            //   而 renderGoals 里的目标 chip 是直接挂在 _root 上的 ——
            //   只要覆盖层早于它就位，chip 就会飘在弹层/飘字之上。
            this.buildOverlays();
            this.startTimer();
            this.announceTreasure();
            this.dumpLayout();
            // ★ 坐标基准线：必须**在 Widget 把页面尺寸对齐之后**才准（理由见 dumpXform）
            this.dumpXform();
            log(`[GamePage] L${lv.n} 开局就绪：${this._board.allTiles().length} 张牌，`
                + `棋盘 ${this._cols}×${this._rows}（关卡表 ${lv.cols}×${lv.rows}，密铺后行数收紧），`
                + `格距 ${this._pitch}px / 牌 ${this._tile}px，`
                + `棋盘 ${this._boardW}×${this._boardH}，限时 ${this._timeLimit}s`
                + `${this._timeLimit === lv.time ? '' : `(force，关卡表是 ${lv.time}s)`} `
                + `· 种子=${forceSeed() ? `force:${this._seed}` : `seed:${this._seed}`}`);
            this.diag('开局');
            // ★ 开局就算一次「多选配对」的呼吸闪烁。
            //   密铺 + `OPEN_PAIRS` 保底对之后，**开局恰恰最容易出现"一张牌同时挨着
            //   两个能配的搭档"** —— 这正是用户要"让用户来选择消除哪个配对"的场景，
            //   所以它不能等到玩家动一次手才亮起来。
            //   ⚠️ 位置必须**紧跟 `diag()` 之后**，与合成/挪牌/宝牌/复活四处一致：
            //      工装的 `flash:` 断言是按"最后一条 `[Diag] STATE` 之后的那批
            //      `[Diag] FLASH` 行"来取样本的。放到 diag 之前，这批样本会落进
            //      **下一个** seq 的区间里 —— 断言于是拿新盘面的 STATE 去配旧盘面的
            //      闪烁，读起来像"闪烁算错了"，实际只是这两行前后脚站错了位。
            this.refreshFlash();
            // 开局即无解只记日志、不弹层（理由见 reboundTile 里那段说明）——
            // 严格回弹下这不是错误，但值得在冒烟日志里留痕，便于回归时发现关卡特难。
            // ★ 用 _diagRng 而不是 _rng：findSuggest 会洗牌，公用玩法随机源的话，
            //   "脚本读了几次诊断"就会改变后续洗牌结果 → 不可复现（同 _diagRng 的注释）。
            if (!this._board.hasDirectMatch(this._pair)
                && !this._board.findSuggest(this._pair, this._diagRng)) {
                log(`[GamePage] ⚠️ L${lv.n} 开局即无可凑成的挪法（玩家一拖就会被弹回，随后会弹「看广告重排」）`);
            }
        });
    }

    // ============================================================
    //  诊断日志（给 tools/web-smoke.mjs 用）
    // ============================================================
    /**
     * 打一份机器可读的盘面快照。
     *
     * 【为什么要把这些打出来，而不是让测试脚本去"看"画面】
     * 小游戏这边没有可编程的交互接口，命令行也看不到画面，只能靠 CDP 派事件 +
     * 读日志。而"读日志"要成立，日志就必须是**机器可读**的：
     *   · BOARD   —— 棋盘几何（格距、牌宽、棋盘中心在设计坐标里的位置）
     *   · TILES   —— 每张牌的 字/行列/种类
     *   · STATE   —— seq + 步数 + 已消/应消 + 剩余牌数  ← 判据落在这里
     *   · SUGGEST —— 下一步该把哪张牌拖到哪一格（来自 Board.findSuggest，
     *                而它已被 core-selftest 单测过，所以这里可信）
     *   · NONMATCH —— 一步"能拖、但凑不成字"的走法（来自 Board.findNonMatch）。
     *                严格回弹的断言脚本靠它拿坐标，见 tools/web-smoke.mjs 的 `rebound:`。
     *   · REACH   —— direct=（是否已有可直接点掉的成对）/ suggest=（是否还有可挪的解法）。
     *                ★ 它存在的唯一理由是**给 `SUGGEST none` 去歧义** ——
     *                  direct=1 时盘面还活着（该点不该拖），direct=0 才是真死局。
     *                  详见下方 diag() 里的注释，键名被 tools/web-smoke.mjs 的 drag 循环解析。
     * 判据一定是"STATE 的 seq 变了、且计数变了"，**不是**"某个节点存在" ——
     * 后者在上一轮真机试玩里正是"看起来好了其实点都点不动"的根源。
     *
     * ⚠️ `pitch=` 这一项是 tools/web-smoke.mjs 的 drag 动作要的（它按
     *    `cx + (c − (cols−1)/2) × pitch` 反算设计坐标），键名不能改。
     */
    private diag(tag: string): void {
        if (!CFG.DEBUG.LOG_STATE) return;
        const b = this._board;
        log(`[Diag] BOARD cols=${this._cols} rows=${this._rows} pitch=${this._pitch} `
            + `gap=${this._gap} cell=${this._tile} cx=0 cy=${Math.round(this.boardCy)}`);
        // ★ 版式三段的位置（2026-10-03 第 2 条"页面分割太开 / 固定住"的机器可读证据）：
        //   headY  = 头部块下沿（= 棋盘面板上沿，未含下移量）
        //   ct     = 内容块整体下移量；面板高**固定**（不随行列变），
        //            wrapTop + wrapH + ct 应当正好等于"已成字条"的上沿
        //            （slack 全部落在屏幕最上/最下，三段之间不留缝）。
        //   boardTop/room = 棋盘在面板内的位置与面板余量 —— 判据是
        //            `room ≥ 0`（棋盘装得进面板）且 `boardTop − wrapTop == room/2`（居中）。
        //   ★ 工装的 `frame` 动作按这几个键做硬断言：**跨关卡 `wrapH` 必须逐值相同**，
        //     且各样本的 `boardH` 必须**互不相同**（否则那两个样本行列一样，
        //     "面板不变"这条断言就是空转的假绿灯）。
        //   ⚠️ `boardTop` 是**距屏幕顶**的距离：Cocos 的 y 原点在屏幕中心，
        //      所以是 `visH/2 − (boardCy + boardH/2)`，**不是** `visH − (…)`。
        //      写成后者会整整偏掉半个屏高，而那种错在"居中"这条判据上只是
        //      "room 看起来大"，很容易被当成"留白比较多"放过去。
        const boardTop = Math.round(this._visH / 2 - (this.boardCy + this._boardH / 2));
        const room = Math.round(this._wrapH - this._boardH);
        log(`[Diag] FRAME headY=${Math.round(this._wrapTop - this._contentTop)} `
            + `ct=${this._contentTop} wrapTop=${Math.round(this._wrapTop)} `
            + `wrapH=${Math.round(this._wrapH)} boardH=${Math.round(this._boardH)} `
            + `boardTop=${boardTop} room=${room} `
            + `slack=${Math.round(this._visH - (this._wrapTop - this._contentTop) - this._wrapH - BOTTOM_BLOCKS)}`);
        log('[Diag] TILES ' + b.allTiles()
            .map((t) => `${t.char}@${t.r},${t.c},${t.kind}`).join(' '));
        const matched = this._runWords.reduce((s, x) => s + x.got, 0);
        const need = this._runWords.reduce((s, x) => s + x.need, 0);
        log(`[Diag] STATE seq=${++this._seq} ${tag} 步=${this._moves} `
            + `已消=${matched}/${need} 剩牌=${b.remainingPlayable()}`);
        const s = b.findSuggest(this._pair, this._diagRng);
        log(s
            ? `[Diag] SUGGEST 从=${s.tile.char}@${s.tile.r},${s.tile.c} 到=${s.r},${s.c} 命中=${s.hit.char}`
            : '[Diag] SUGGEST none');

        // ★ `SUGGEST none` 是**有歧义的**，必须再补一行把状态拆开（2026-10-02 踩过）。
        //   findSuggest 的候选落点来自 reachableCells，而它**只含空格** —— 于是一对
        //   已经同行/同列相邻、随时能点掉的牌，是**没有"挪"的解法**的：
        //   想把 A 挪到 B 身上？那一格被 B 占着，根本不是合法落点。
        //   所以 `SUGGEST none` 同时对应两种完全不同的局面：
        //     · direct=1 → 还活着，只是该「点」而不是该「拖」（点一下就消）；
        //     · direct=0 → 真的卡住，这时 checkDeadlock 才会弹「看广告重排」。
        //   冒烟的 drag 循环只认 SUGGEST，遇到前者会当成"拿不到建议"直接收工，
        //   看起来就像"卡住弹层没弹" —— 白查一轮。补上 direct= 之后，
        //   「弹层该不该出现」变成一行可读的单一判据。
        const direct = b.hasDirectMatch(this._pair);
        log(`[Diag] REACH direct=${direct ? 1 : 0} suggest=${s ? 1 : 0} → `
            + (s ? '有可挪的解法' : direct ? '只能点掉已对齐的一对' : '真的卡住'));

        // ★ 普通牌"已经对齐、点一下就能消"的**可测入口**（2026-10-03 加）。
        //   动机与下面的 `TREASURE direct` 完全一样：`SUGGEST none` 有歧义，
        //   冒烟的 `treasure:` 前置消除只认 SUGGEST 时，撞上"该点不该拖"的局面
        //   就会罢工 —— 而它报出来的却是"N 手之后仍拿不到宝牌走法"，
        //   完全指错方向（2026-10-03 实测：那一局已消 9/15、剩牌 14，盘面明明活着）。
        //   有了这行，前置消除就能把"只能点"的局面也走下去。
        const dp = b.findDirectPair(this._pair);
        log(dp
            ? `[Diag] DIRECT 从=${dp[0].char}@${dp[0].r},${dp[0].c} 到=${dp[1].r},${dp[1].c} 命中=${dp[1].char}`
            : '[Diag] DIRECT none');

        // ★ 严格回弹的**可测入口**：给一个"能拖、但凑不成字"的走法。
        //   冒烟的 `rebound:` 动作照着它拖，然后断言"牌弹回原位、步数不变"。
        //   随机源用**固定种子临时新建**，与 _diagRng 分开 —— 这样连续调用 diag()
        //   得到的 NONMATCH 是同一个（不随"脚本读了几次日志"漂移），断言才稳。
        const nm = b.findNonMatch(this._pair, new Rng(DIAG_NM_SEED));
        log(nm
            ? `[Diag] NONMATCH 从=${nm.tile.char}@${nm.tile.r},${nm.tile.c} 到=${nm.r},${nm.c}`
            : '[Diag] NONMATCH none');

        // ★ 推箱走法的**可测入口**（2026-10-03 推箱上线时加）。
        //   冒烟的 `push:` 动作照着这两行拖真事件，断言两件事：
        //     · 推着走、且凑成了字 → 被推的那串牌**永久停在新位置**（用户原话：
        //       "当两者消掉后，革字比原来往右移动了一格"）；
        //     · 推着走、但凑不成字 → 整段**沿原路弹回**（用户原话：
        //       "必须要达成消除条件，才允许这样推，不然会回到原来的地方"）。
        //
        //   ⚠️ 这两条在推箱**之前**是测不出来的：旧规则下拖动一张牌永远只动它自己，
        //      既没有"被推的牌"，也就没有"整段回弹"。所以必须新开入口。
        //   ⚠️ 与 NONMATCH 一样用**固定种子临时新建**随机源：同一个盘面连续调用
        //      给出的是同一组样本，断言不会随"脚本读了几次日志"漂移。
        //   ⚠️ 两行都可能 none（盘面未必存在推箱走法）。冒烟要能识别并跳过，
        //      而不是把它当成失败 —— 那会变成偶发红。
        const ps = b.findPush(this._pair, new Rng(DIAG_PUSH_SEED));
        // 命中牌**落位之后**的坐标：它若也在被推之列，就取它的落点；否则原地不动。
        // ⚠️ 不能直接用 hit.r/hit.c —— `findPush` 内部是"整段位移 → 判定 → 倒放回去"，
        //    所以 hit 上挂的仍是**拖动前**的坐标。
        const hitAt = (pm: PushMove): string => {
            if (!pm.hit) return '?';
            const m = pm.shoved.find((x) => x.t === pm.hit);
            const p = m ? m.to : { r: pm.hit.r, c: pm.hit.c };
            return `${pm.hit.char}@${p.r},${p.c}`;
        };
        log(ps.match
            ? `[Diag] PUSH 从=${ps.match.tile.char}@${ps.match.tile.r},${ps.match.tile.c} `
              + `到=${ps.match.r},${ps.match.c} `
              + `推=${ps.match.shoved.map((m) => `${m.t.char}@${m.from.r},${m.from.c}->${m.to.r},${m.to.c}`).join('|')} `
              + `命中=${hitAt(ps.match)}`
            : '[Diag] PUSH none');
        log(ps.nomatch
            ? `[Diag] PUSHNM 从=${ps.nomatch.tile.char}@${ps.nomatch.tile.r},${ps.nomatch.tile.c} `
              + `到=${ps.nomatch.r},${ps.nomatch.c} `
              + `推=${ps.nomatch.shoved.map((m) => `${m.t.char}@${m.from.r},${m.from.c}->${m.to.r},${m.to.c}`).join('|')}`
            : '[Diag] PUSHNM none');

        // ★ 宝牌走法的**可测入口**（2026-10-03 接入宝牌时加）。
        //   冒烟的 `treasure:` 动作照着这行拖真事件，然后断言"剩牌少了 4 张、
        //   出现『宝牌成对』"—— 否则"宝牌凑对会额外消一对"这条规则
        //   就只能靠人在真机上碰运气凑到两张宝牌才能验。
        //   ⚠️ 只在有宝牌的关卡打这行（`tr = 0` 时它恒为 none，纯噪音）。
        //
        //   ★ `TREASURE none` 与 `SUGGEST none` 一样**是有歧义的**，必须拆开：
        //     `findTreasureMove` 只找"需要挪一步"的走法；两张宝牌一开局就落成
        //     同行/同列且中间无牌时它也返回 null —— 而那不是"没得消"，
        //     是**该点不该拖**（tapTile 会直接消）。若把两者混成一句，
        //     冒烟就会把"可以点掉"误判成"这盘没有宝牌走法"（2026-10-03 实测踩到）。
        //   2026-10-03 实测：L3 首盘 铁砧@4,1 与 铁砧@4,3 中间夹着 玄@4,2，
        //   两边谁都挪不过去 → `TREASURE none`，玩家得先把「玄」消掉。
        if (this._lv.tr > 0) {
            const tr = b.findTreasureMove(this._pair, new Rng(DIAG_TR_SEED));
            if (tr) {
                log(`[Diag] TREASURE 从=${tr.tile.char}@${tr.tile.r},${tr.tile.c} 到=${tr.r},${tr.c} 命中=${tr.hit.char}`);
            } else {
                const d = b.findDirectTreasure(this._pair);
                log(d
                    ? `[Diag] TREASURE direct 从=${d[0].char}@${d[0].r},${d[0].c} 到=${d[1].r},${d[1].c}`
                    : '[Diag] TREASURE none');
            }
        }
    }

    /**
     * 把版式打成可逐值比对的日志（见 ui/LayoutDump.ts 的说明）。
     * 名字尽量对齐设计稿的类名，好让 tools/layout-diff.py 直接按名对上。
     */
    private dumpLayout(): void {
        const H = this._visH, W = this._visW;
        const goalRows = this._goalRows;
        const goalH = GOAL_PAD_T + goalRows * CHIP_H + (goalRows - 1) * GOAL_GAP + GOAL_PAD_B;
        const box = (n: string, l: number, t: number, w: number, h: number, ex = ''): void =>
            dump(PAGE_GAME, n, l, t, w, h, ex);

        // ★★ 三段各自跟着"内容块下移量"走（见 CONTENT_SHARE）★★
        //   顶部块 `+ ct`、底部块 `− ct`。**必须与真实定位用同一个量**，
        //   否则这份 dump 就不再是"版式的一手证据" —— 工装拿它算点击坐标，
        //   会整体点偏 ct（表现像"按钮坏了"，而实际只是 dump 没跟着挪）。
        const ct = this._contentTop;

        box('.play-top', 0, ct, W, TOP_H);
        box('.btn-back', TOP_PAD_X, TOP_PAD_T + ct, BACK_D, BACK_D);
        box('.play-title', TOP_PAD_X + BACK_D + TOP_GAP,
            TOP_PAD_T + BACK_D / 2 - PTITLE_LH / 2 + ct, PTITLE_W, PTITLE_LH);
        const tw = estWidth('02:29', TIMER_S) + TIMER_LS * 5;
        box('.timer', W - TOP_PAD_X - tw, TOP_PAD_T + BACK_D / 2 - TIMER_LH / 2 + ct, tw, TIMER_LH);
        box('.goal-bar', 0, TOP_H + ct, W, goalH);

        // 目标 chip（逐个）
        const rows = this.layoutGoalChips();
        let rowTop = TOP_H + GOAL_PAD_T;
        for (const row of rows) {
            const widths = row.map((rw) => this.chipWidth(rw));
            const total = widths.reduce((a, b) => a + b, 0) + GOAL_GAP * (row.length - 1);
            let x = W / 2 - total / 2;
            for (let i = 0; i < row.length; i++) {
                box(`.goal-chip[${i}]`, x, rowTop + ct, widths[i], CHIP_H, row[i].w);
                x += widths[i] + GOAL_GAP;
            }
            rowTop += CHIP_H + GOAL_GAP;
        }

        const tipsTop = TOP_H + goalH;
        if (this.hasTips()) box('.tips', TIPS_MX, tipsTop + ct, W - 2 * TIPS_MX, TIPS_H);
        box('.board-wrap', 0, this._wrapTop, W, this._wrapH);
        const boardL = (W - this._boardW) / 2;
        const boardT = this._wrapTop + (this._wrapH - this._boardH) / 2;
        box('#board', boardL, boardT, this._boardW, this._boardH);
        // ★ cellX/cellY 返回的是**相对棋盘中心**的偏移（Cocos 系，y 朝上为正），
        //   所以要先走回"棋盘左上角"（+boardW/2 / −boardH/2）才能落到屏幕系。
        //   我第一版 x 漏了 +boardW/2，于是打到 −159 设计px（跑到屏幕外左边去了）——
        //   而 y 当时是对的，所以这个错在截图上"看着没问题"，只有逐值比对才抓得住。
        box('.tile', boardL + this._boardW / 2 + this.cellX(0) - this._tile / 2,
            boardT + this._boardH / 2 - this.cellY(0) - this._tile / 2,
            this._tile, this._tile, `pitch=${this._pitch} gap=${this._gap}`);
        box('.made-strip', MADE_MX, H - BAR_H - MADE_MB - MADE_H - ct,
            W - 2 * MADE_MX, MADE_H);
        box('.tool-bar', 0, H - BAR_H - ct, W, BAR_H);
        const toolW = (W - 2 * TOOL_PAD_X - 2 * TOOL_GAP) / TOOL_COUNT;
        // ⚠️ 上界必须是 `TOOL_COUNT`，**不能写死 3** ——
        //    2026-10-03 加第四个道具（延长时间）时就漏了这一处：`toolW` 改成了 /4，
        //    循环却还在跑 3 次，于是 dump 里只有前三个框 ——
        //    而这份 dump 正是"道具栏版式"的**唯一机器可读证据**，
        //    少一个框既看不出布局错、也看不出个数错，等于把第四格的版式验证悄悄抹掉。
        for (let i = 0; i < TOOL_COUNT; i++) {
            box(`.tool[${i}]`, TOOL_PAD_X + i * (toolW + TOOL_GAP),
                H - BAR_H + TOOL_PAD_T - ct, toolW, TOOL_H);
        }
    }

    /**
     * 把「格 (0,0) 的中心」用**引擎自己的变换链**算成屏幕坐标，交给工装自检。
     *
     * 【它为什么值得永久留在产物里】
     * 2026-10-02 排查过一次「拖拽完全不生效」：日志里 SUGGEST 说的是格 (0,0)，
     * 而游戏收到的是格 (2,0) —— 差**恰好两行**。当时把整条链路（
     * `getUILocation → convertToNodeSpaceAR`）的数值全打出来逐项核对，
     * 结论是**游戏侧完全正确**（屏幕点 486.7 → 局部 (-279.6, 224.1) → 格 (0,0)，
     * 与理论值逐位吻合），偏差出在工装那侧。
     * 但那次排查花掉了整整一轮 —— 就因为没有一条"两边各自算一遍再比对"的锚。
     *
     * 这条日志就是那个锚：游戏算出屏幕坐标 → 工装用自己那套公式（
     * `cx + 设计x × PS`）再算一遍 → 两者必须一致（见 tools/web-smoke.mjs 的 `xform:`）。
     * 不一致时**根本不用去看游戏代码**，直接查工装的 cx/cy/PS。
     *
     * ⚠️ y 用「从屏幕顶往下」的口径（与工装、与 [Layout] dump 一致），
     *    因为屏幕坐标原点在左下、而工程里所有测量都是自顶向下的。
     */
    private dumpXform(): void {
        if (!CFG.DEBUG.LOG_STATE) return;
        if (!this._boardNode || !this._boardNode.isValid) return;
        const ut = this._boardNode.getComponent(UITransform);
        if (!ut) return;
        const w = ut.convertToWorldSpaceAR(new Vec3(this.cellX(0), this.cellY(0), 0));
        const sx = view.getScaleX(), sy = view.getScaleY();
        const winH = screen.windowSize.height;
        log(`[Diag] XFORM cell=0,0 screen=${(w.x * sx).toFixed(2)},${(winH - w.y * sy).toFixed(2)} `
            + `win=${screen.windowSize.width}×${Math.round(winH)} scale=${sx.toFixed(4)}`);
    }

    /** 棋盘中心在设计坐标里的 y（原点 = 屏幕中心，y 朝上） */
    private get boardCy(): number {
        return topY(this._visH, this._wrapTop + this._wrapH / 2);
    }

    onExit(): void {
        if (this._toast) this._toast.dispose();
        if (this._adGate) this._adGate.dispose();
        if (this._failGate) this._failGate.dispose();
        this._blinkId = 0;
        this._glowId = 0;
        this._drag = null;
        super.onExit();
    }

    // ============================================================
    //  几何
    // ============================================================
    /** 棋盘区上沿（距屏幕顶） */
    private _wrapTop = 0;
    /** 棋盘区高度 */
    private _wrapH = 0;
    /**
     * 内容块整体下移量（**实现px**）。见 CONTENT_SHARE 的说明。
     * · 顶部块（返回键/标题/计时/目标条/提示条）→ 定位时 **加** 它
     * · 底部块（已成字条/道具栏）→ 定位时 **减** 它
     * 两处必须成对，否则三段会散开 —— 这正是这条改动要修的病。
     */
    private _contentTop = 0;

    /**
     * 算棋盘尺寸。**逐条照搬原型 computeCell**（见 CFG.BOARDGEO 的说明）。
     * 棋盘区高度 = 总高 − 上方固定块 − 下方固定块，所以必须先知道
     * 目标条有几行（字多了会换行 → 目标条变高 → 棋盘区变矮）。
     *
     * ★★ 整个算式的**中间量一律用设计 px**，只在最后一步做 px() 换算 ★★
     *   CFG.BOARDGEO 里的 32 / 62 / 3 都是**设计稿上写的数**。
     *   若把它们当成本工程的像素直接用，CELL_MAX=62 就等于设计 32px ——
     *   于是格子被压到 32（比设计窄一半），棋盘缩成设计稿的一半大。
     *   上一版就是这么错的（实测 62/56 的格子 vs 设计 58/53，棋盘 372×310 vs 348×290）。
     */
    private computeGeometry(): void {
        // ★ 用**实际棋盘**的列/行数（密铺后行数比关卡表小），见 _cols/_rows 的说明
        const cols = this._cols;
        const rows = this._rows;
        const G = CFG.BOARDGEO;
        const S = CFG.SPEC.SCALE;

        // ① 目标条换行后的行数：按每个 chip 的自然宽度贪心装箱
        const goalRows = this.layoutGoalChips().length;
        const goalH = GOAL_PAD_T + goalRows * CHIP_H + (goalRows - 1) * GOAL_GAP + GOAL_PAD_B;

        // ② 头部块高度 = 屏幕顶 → 棋盘区上沿（标题行 + 目标条 + 可选的拆法提示条）
        const headTop = TOP_H + goalH + (this.hasTips() ? TIPS_H + TIPS_MB : 0);

        // ③ 格距（原型 computeCell 原式，全在设计 px 下算）
        //    ★★ **高度这一侧改成读「固定面板」，不再读"剩下的屏幕空间"** ★★
        //      这是"地图大小不变"的必要条件：只要 pitch 还与剩余高度有关，
        //      它就与 `_contentTop`（= slack 的一半）互相追着跑 ——
        //      下移量越大 → 剩余高度越大 → pitch 越大 → 面板越高 → 下移量越小 …
        //      而它**不报错**，只表现为"每关的格子大小飘来飘去"。
        //      面板固定之后，pitch 只由「面板内宽 ÷ 列数」与「面板内高 ÷ 行数」决定。
        //    ⚠️ `availH` 仍要夹一道"屏幕真的放得下"：极端窄高机型上
        //      `PANEL_INNER_H` 会超出可用高度，此时面板只能缩（那个降级是必要的，
        //      否则面板会压住下面的「已成字条」）。正常机型上这一夹**永不起作用**，
        //      于是面板逐关恒定。
        const availW = this._visW / S - 2 * G.WRAP_PAD_X;
        const availH = Math.min(
            G.PANEL_INNER_H,
            (this._visH - headTop - BOTTOM_BLOCKS) / S - 2 * G.WRAP_PAD_Y,
        );
        const cellD = Math.min(
            Math.floor((availW - 4) / cols),
            Math.floor((availH - 4) / rows),
        );
        const pitchD = Math.max(G.CELL_MIN, Math.min(cellD, G.CELL_MAX));
        const gapD = Math.max(G.GAP_MIN, Math.round(pitchD * G.GAP_RATIO));

        this._pitch = px(pitchD);
        this._gap = px(gapD);
        this._tile = this._pitch - this._gap;
        this._boardW = px(cols * pitchD);
        this._boardH = px(rows * pitchD);

        // ④ ★★ 棋盘面板高度**固定**（2026-10-03 用户第 2 条「地图大小不变」）★★
        //   于是「顶部块 → 目标字条 → 地图面板 → 已成字条 → 道具栏」这一整条骨架
        //   在**所有关卡**里的位置完全一致；行列变多只是格子与字变小，面板不动。
        //   棋盘在面板内**居中**（见 boardCy），所以牌少的关卡上下各留一点白 ——
        //   那点白是「正方形的格距塞进固定面板」的必然结果，不是没对齐。
        //
        //   ⚠️ 走过的两次弯路，都写在这里免得被改回去：
        //     · 最初 `_wrapH = visH − wrapTop − BOTTOM_BLOCKS`（面板吃满剩余高度）
        //       ⇒ 差额全变成"顶部块与棋盘之间"的空白 = 用户截图里的"页面分割太开"；
        //     · 中间版 `_wrapH = _boardH + 2×WRAP_PAD_Y`（面板只包住棋盘）
        //       ⇒ 段间无缝了，但面板随行数变 ⇒ 顶部块逐关浮动 0~51px，
        //         正是用户说的"要**固定住**"。
        //     两条要求必须**同时**成立 ⇒ 只有"固定面板 + 棋盘在其中居中"一条路。
        //   ⚠️ 加 min 兜底：面板不许超过"屏幕真的放得下"的高度（见 ③ 的说明）。
        const maxWrapH = Math.max(px(60), this._visH - headTop - BOTTOM_BLOCKS);
        this._wrapH = Math.min(px(availH) + 2 * px(G.WRAP_PAD_Y), maxWrapH);
        this.checkPanelFit();

        // ⑤ 多余的空白整块下移（分给屏幕最上/最下），不再夹在三段中间
        const slack = Math.max(0, this._visH - headTop - this._wrapH - BOTTOM_BLOCKS);
        this._contentTop = Math.round(slack * CONTENT_SHARE);
        this._wrapTop = headTop + this._contentTop;

        this._goalRows = goalRows;
    }

    /**
     * `PANEL_INNER_H` 的**自检**：棋盘装得进面板吗？
     *
     * `core-selftest` 已按关卡表逐关算过一遍（那条断言盯的是"加了新关卡会不会越界"），
     * 这里只兜**运行期**才知道的那一半：本局**实际棋盘**的行列数（密铺后可能与关卡表不同）。
     * 判据：棋盘（含上下各 2 设计px 的内距）不超过面板。
     * ⚠️ 它不会报错、只会表现为"棋盘压住下面的「已成字条」"，
     *   所以必须 log 出声 —— 静默的几何越界是这个项目里最难查的一类。
     */
    private checkPanelFit(): void {
        if (this._boardH + 2 * px(CFG.BOARDGEO.WRAP_PAD_Y) > this._wrapH) {
            log(`[GamePage] ⚠️ L${this._lv.n} 棋盘 ${this._boardH} 比面板 ${this._wrapH} 还高`
                + `（${this._cols}×${this._rows}，格距被 CELL_MIN=${CFG.BOARDGEO.CELL_MIN} 顶住了？）`
                + ' —— 会压住「已成字条」');
        }
    }

    private _goalRows = 1;

    /** 本关有没有拆法提示条（设计稿 `.tips` 默认 display:none，只有 lv.tip 才有） */
    private hasTips(): boolean {
        return !!this._lv.tip;
    }

    /** 每个目标 chip 的自然宽度：2×(内距+边框) + 字 + 间隙 + 计数 */
    private chipWidth(rw: RunWord): number {
        const numTxt = `${rw.got}/${rw.need}`;
        const numW = estWidth(numTxt, GN_S) + GN_LS * numTxt.length;
        return 2 * (CHIP_PAD + CHIP_BORDER) + GW_S + CHIP_IGAP + numW;
    }

    /** 把 chip 贪心装箱成若干行（原型是 flex-wrap，这里自己算，因为要据此定目标条高度） */
    private layoutGoalChips(): RunWord[][] {
        const maxW = this._visW - 2 * GOAL_PAD_X;
        const rows: RunWord[][] = [];
        let cur: RunWord[] = [];
        let w = 0;
        for (const rw of this._runWords) {
            const cw = this.chipWidth(rw);
            const add = cur.length ? GOAL_GAP + cw : cw;
            if (cur.length && w + add > maxW) {
                rows.push(cur);
                cur = [rw];
                w = cw;
            } else {
                cur.push(rw);
                w += add;
            }
        }
        if (cur.length) rows.push(cur);
        return rows.length ? rows : [[]];
    }

    /** 列 → 棋盘局部 x（棋盘中心为原点，右为正） */
    private cellX(c: number): number {
        return (c - (this._cols - 1) / 2) * this._pitch;
    }

    /** 行 → 棋盘局部 y（★ 行 0 在最上面，而 Cocos 的 y 朝上，所以是减法） */
    private cellY(r: number): number {
        return ((this._rows - 1) / 2 - r) * this._pitch;
    }

    /** 棋盘局部坐标 → 格子。落在格距的"热区"里就算这一格（含格间空隙） */
    private cellAtLocal(x: number, y: number): Cell | null {
        const c = Math.floor((x + this._boardW / 2) / this._pitch);
        const r = Math.floor((this._boardH / 2 - y) / this._pitch);
        if (!this._board.inBounds(r, c)) return null;
        return { r, c };
    }

    /** UI 坐标 → 棋盘局部坐标 */
    private toLocal(ui: Vec2): Vec3 {
        const ut = this._boardNode.getComponent(UITransform)!;
        return ut.convertToNodeSpaceAR(new Vec3(ui.x, ui.y, 0));
    }

    // ============================================================
    //  静态框架
    // ============================================================
    private buildChrome(): void {
        const H = this._visH, W = this._visW, C = CFG.COLOR;

        // —— 返回键（32×32 在 14,13）——
        //   顶栏整条随"内容块下移量"走（见 CONTENT_SHARE）：不跟的话，
        //   棋盘下移了、顶栏还顶着屏幕边，三段就又散开了。
        const backY = topY(H, TOP_PAD_T + BACK_D / 2 + this._contentTop);
        const back = mkNode('back', this._root, BACK_D, BACK_D);
        setPos(back, -W / 2 + TOP_PAD_X + BACK_D / 2, backY);
        this.drawBackCircle(back);
        pressable(back, () => this.exitToMap(), this);

        // —— 标题：`第 N 关 · 章名（去掉「第X章 · 」前缀）` ——
        const titleLeft = -W / 2 + TOP_PAD_X + BACK_D + TOP_GAP;
        const ch = CHAPTERS.find((c) => c.id === this._lv.ch);
        const short = ch ? ch.name.replace(/^第.章 · /, '') : '';
        setPos(mkLabel(this._root, `第 ${this._lv.n} 关 · ${short}`, {
            size: PTITLE_S, color: C.INK, bold: true, font: 'kai', spacing: PTITLE_LS,
            lineHeight: PTITLE_LH, align: 'left', autoWidth: false, width: PTITLE_W,
        }).node, titleLeft + PTITLE_W / 2, backY);

        // —— 计时（右端贴 14）——
        const timer = mkLabel(this._root, fmt(this._lv.time), {
            size: TIMER_S, color: C.JADE, bold: true, font: 'hei', spacing: TIMER_LS,
            lineHeight: TIMER_LH, align: 'right', autoWidth: false, width: px(120),
        });
        timer.node.getComponent(UITransform)!.setAnchorPoint(0.5, 0.5);
        setPos(timer.node, W / 2 - TOP_PAD_X - px(120) / 2, backY);
        this._timerLb = timer;
        this._timerOp = timer.node.addComponent(UIOpacity);
        this._timerOp.opacity = 255;

        // —— 静音小喇叭（顶栏，紧贴计时器左侧）——
        //   位置必须**从计时器反推**，不能自己挑一个好看的坐标：
        //   计时器是右端贴 14 的，屏宽一变它就移动，写死的坐标会在别的机型上压字。
        const mute = mkNode('mute', this._root, MUTE_D, MUTE_D);
        setPos(mute, W / 2 - TOP_PAD_X - px(120) - MUTE_GAP - MUTE_D / 2, backY);
        this.drawMuteBtn(mute);
        pressable(mute, () => {
            // ★ 这一下点击本身就是手势 —— 顺手把 BGM 也带起来，双保险
            this.paintMute(AudioService.toggleMuted());
        }, this);

        // —— 拆法提示条（只在有提示的关卡出现，位置随目标条行数走）——
        const goalRows = this._goalRows;
        const goalH = GOAL_PAD_T + goalRows * CHIP_H + (goalRows - 1) * GOAL_GAP + GOAL_PAD_B;
        if (this.hasTips()) {
            const tipTop = TOP_H + goalH;
            const tipW = W - 2 * TIPS_MX;
            const box = mkNode('tips', this._root, tipW, TIPS_H);
            setPos(box, 0, topY(H, tipTop + TIPS_H / 2 + this._contentTop));
            const g = box.addComponent(Graphics);
            g.fillColor = hex(C.TIP_BG, C.TIP_BG_A);
            g.roundRect(-tipW / 2, -TIPS_H / 2, tipW, TIPS_H, TIPS_R);
            g.fill();
            mkDashedRing(g, tipW, TIPS_H, TIPS_R, C.TIP_EDGE, C.TIP_EDGE_A);
            mkLabel(box, '拆法提示：' + this._lv.tip, {
                size: TIPS_S, color: C.TIP_TX, font: 'kai', spacing: TIPS_LS, lineHeight: TIPS_LH,
            });
        }
    }

    /**
     * 挂"覆盖层"：卡住弹层 + 飘字提示。
     *
     * ★★ 必须放在 onCreate 的**最后一步**，不能塞进 buildChrome ★★
     * Cocos 的 2D 渲染顺序完全由**同级节点的挂载先后**决定（后挂的画在上面），
     * 没有 CSS 那种 z-index。而 buildChrome 跑在 buildBoard / buildTools 之前 ——
     * 于是这两个覆盖层会被**棋盘、工具条、已成字条**盖住：
     *   · 弹层会"只剩卡片顶边在棋盘上沿露出一条白缝"，
     *     而且看起来像"弹层跑到了屏幕最上面"，非常容易误判成坐标算错（本轮就是这么被骗的：
     *     卡片的 worldPosition 打印出来明明是屏幕正中 (360,756)，画面上却只有一条缝）；
     *   · 飘字提示（对局页的「这一步凑不成字」等）会整条被棋盘吞掉，
     *     日志里有、画面上没有 —— 靠 `t:` 断言能过，靠眼睛看会以为提示没做。
     * 覆盖层的正确位置就是**最后挂**。
     */
    private buildOverlays(): void {
        // 顺序：先弹层、后提示 —— 让提示压在弹层之上，
        // 否则「广告没看完」这类反馈会藏在卡片背后看不见。
        this._adGate = new AdGate(this._root, this._visW, this._visH);
        this._failGate = new FailGate(this._root, this._visW, this._visH);

        // ★★ 提示条的落点：**棋盘下沿之下**，不再压在棋盘正中（2026-10-03 用户拍板）★★
        //   用户原话：「提示不要放在中间很影响用户体验和操作，遮住了页面」——
        //   原实现按设计稿把提示挂在屏幕 52% 高度（= 棋盘中部），两行提示能盖掉一整行牌。
        //
        //   取「棋盘下沿再往下一点」而不是一个写死的坐标，是因为棋盘高度**逐关不同**
        //   （密铺之后行数还随牌数变）：写死的线早晚会落在某一关的棋盘里面。
        //   再夹一道「不得低于底部区块上沿」：密铺后棋盘总是比可用高度矮（格距受
        //   屏宽限制），所以正常情况下它有落点；夹具只兜极端机型，避免提示条跑到
        //   「已成字条」上去。
        const belowBoard = this.boardCy - this._boardH / 2 - px(10);
        // ★ 底部区块上沿也要跟着"内容块下移量"上移（三段是一起挪的）
        const bandTop = topY(this._visH, this._visH - BOTTOM_BLOCKS - px(4) - this._contentTop);
        this._toast = new Toast(this._root, this._visW, Math.min(belowBoard, bandTop));
    }

    /** 圆形返回键的面（设计稿 `.btn-back`：半透明白底 + 米边 + 圆） */
    private drawBackCircle(n: Node): void {
        const C = CFG.COLOR;
        const d = BACK_D;
        const g = n.addComponent(Graphics);
        g.fillColor = hex(C.SURFACE, C.SURFACE_A_BACK);
        g.circle(0, 0, d / 2);
        g.fill();
        g.strokeColor = hex(C.EDGE, C.EDGE_A_BACK);
        g.lineWidth = 2;
        g.circle(0, 0, d / 2 - 1);
        g.stroke();
        setPos(mkLabel(n, '←', {
            size: Math.round(d * 0.47), color: C.INK, font: 'hei',
        }).node, 0, 1);
    }

    // --------------------------------------------------------
    //  顶栏静音小喇叭
    // --------------------------------------------------------
    /**
     * 喇叭用 Graphics 画，不用字符。
     * 【为什么不用 '🔊' / '🔇'】emoji 在小游戏里是**字体依赖**的：
     * iOS/Android/开发者工具的 emoji 字体各不相同，缺字形时出来是一个豆腐块 □，
     * 而"静音按钮看起来是个空框"是最难自查的一种坏（截图里它就是个小方块）。
     * Graphics 画的是矢量，任何机型都是同一个形状。
     */
    private drawMuteBtn(n: Node): void {
        const C = CFG.COLOR;
        const d = MUTE_D;
        const face = n.addComponent(Graphics);
        face.fillColor = hex(C.SURFACE, C.SURFACE_A_BACK);
        face.circle(0, 0, d / 2);
        face.fill();
        face.strokeColor = hex(C.EDGE, C.EDGE_A_BACK);
        face.lineWidth = 2;
        face.circle(0, 0, d / 2 - 1);
        face.stroke();
        this._muteG = mkNode('ico', n, d, d).addComponent(Graphics);
        this.paintMute(AudioService.muted);
    }

    /**
     * 喇叭图形：**锥形喇叭 + 两道声波**；静音时声波换成一道斜杠。
     * 坐标系是设计px（× px(1) 换算），半径以 d/2 为基准缩放。
     */
    private paintMute(muted: boolean): void {
        const g = this._muteG;
        if (!g || !g.isValid) return;
        const C = CFG.COLOR;
        const u = px(1);                       // 1 设计px
        const s = MUTE_D / (24 * u);           // 实际直径 / 设计直径，容错用
        const on = muted ? C.INK3 : C.INK;
        g.clear();

        // 喇叭锥（朝左）：底部竖直一段 + 向右张开的梯形
        g.fillColor = hex(on, 255);
        g.moveTo(-6 * u * s, -2.2 * u * s);
        g.lineTo(-2.2 * u * s, -2.2 * u * s);
        g.lineTo(2.0 * u * s, -5.6 * u * s);
        g.lineTo(2.0 * u * s, 5.6 * u * s);
        g.lineTo(-2.2 * u * s, 2.2 * u * s);
        g.lineTo(-6 * u * s, 2.2 * u * s);
        g.close();
        g.fill();

        g.strokeColor = hex(on, 255);
        g.lineWidth = Math.max(1.2, 1.6 * u * s);
        if (muted) {
            // 静音：一道斜杠（从右上到左下），比画一个 × 更"像被划掉"
            g.moveTo(4.2 * u * s, 4.2 * u * s);
            g.lineTo(8.6 * u * s, -4.2 * u * s);
            g.stroke();
        } else {
            // 两道声波：以喇叭口为圆心的两段圆弧（第 6 个参数 counterclockwise 必填）
            g.arc(2.0 * u * s, 0, 4.2 * u * s, -0.95, 0.95, false);
            g.stroke();
            g.arc(2.0 * u * s, 0, 6.8 * u * s, -0.85, 0.85, false);
            g.stroke();
        }
    }

    private _muteG: Graphics | null = null;

    // ============================================================
    //  目标条
    // ============================================================
    private renderGoals(): void {
        const rows = this.layoutGoalChips();
        let rowTop = TOP_H + GOAL_PAD_T;
        for (const row of rows) {
            const widths = row.map((rw) => this.chipWidth(rw));
            const total = widths.reduce((a, b) => a + b, 0) + GOAL_GAP * (row.length - 1);
            let x = -total / 2;
            for (let i = 0; i < row.length; i++) {
                const rw = row[i];
                const w = widths[i];
                const chip = this._chips.get(rw.w);
                if (chip) {
                    setPos(chip.root, x + w / 2, topY(this._visH, rowTop + CHIP_H / 2 + this._contentTop));
                    chip.w = w;
                    this.paintChip(chip, rw.got >= rw.need);
                } else {
                    this.buildChip(rw, w, x + w / 2, topY(this._visH, rowTop + CHIP_H / 2 + this._contentTop));
                }
                x += w + GOAL_GAP;
            }
            rowTop += CHIP_H + GOAL_GAP;
        }
    }

    private buildChip(rw: RunWord, w: number, x: number, y: number): void {
        const C = CFG.COLOR;
        const root = mkNode('chip', this._root, w, CHIP_H);
        setPos(root, x, y);
        const faceG = mkNode('face', root, w, CHIP_H).addComponent(Graphics);
        const edgeG = mkNode('edge', root, w, CHIP_H).addComponent(Graphics);

        // chip 内容：左「字」右「计数」，整组居中
        const numTxt = `${rw.got}/${rw.need}`;
        const numW = estWidth(numTxt, GN_S) + GN_LS * numTxt.length;
        const groupW = GW_S + CHIP_IGAP + numW;
        const x0 = -groupW / 2;
        setPos(mkLabel(root, rw.w, {
            size: GW_S, color: C.TILE_TX, bold: true, font: 'kai',
            lineHeight: GW_S, align: 'left', autoWidth: false, width: GW_S,
        }).node, x0 + GW_S / 2, 0);
        const num = mkLabel(root, numTxt, {
            size: GN_S, color: C.INK2, font: 'hei', spacing: GN_LS,
            align: 'left', autoWidth: false, width: numW,
        });
        setPos(num.node, x0 + GW_S + CHIP_IGAP + numW / 2, 0);

        const chip: Chip = { word: rw.w, root, num, faceG, edgeG, w, h: CHIP_H };
        this._chips.set(rw.w, chip);
        this.paintChip(chip, rw.got >= rw.need);
    }

    /**
     * 重画 chip 的面与边。
     * 设计稿：默认半透明白底 + 米边；凑够时换金渐变底 + 金字金边（`.goal-chip.done`）。
     */
    private paintChip(chip: Chip, done: boolean): void {
        const C = CFG.COLOR;
        const w = chip.w, h = chip.h;
        const g = chip.faceG;
        g.clear();
        if (done) {
            // 金底用色带拼渐变（linear-gradient(160deg,#FDF3D8,#F5E0A8)）
            const a = hex(C.DONE_A2), b = hex(C.DONE_B2);
            const BANDS = 12, bh = h / BANDS;
            for (let i = 0; i < BANDS; i++) {
                const t = (i + 0.5) / BANDS;
                g.fillColor = new Color(
                    Math.round(a.r + (b.r - a.r) * t),
                    Math.round(a.g + (b.g - a.g) * t),
                    Math.round(a.b + (b.b - a.b) * t), 255);
                g.roundRect(-w / 2, h / 2 - (i + 1) * bh, w, bh + 1, CHIP_R);
                g.fill();
            }
        } else {
            g.fillColor = hex(C.SURFACE, C.SURFACE_A_CHIP);
            g.roundRect(-w / 2, -h / 2, w, h, CHIP_R);
            g.fill();
        }
        const e = chip.edgeG;
        e.clear();
        e.strokeColor = done ? hex(C.DONE_EDGE, 140) : hex(C.EDGE, C.EDGE_A_LINE);
        e.lineWidth = 2;
        e.roundRect(-w / 2, -h / 2, w, h, CHIP_R);
        e.stroke();
    }

    private refreshGoals(): void {
        const C = CFG.COLOR;
        for (const rw of this._runWords) {
            const chip = this._chips.get(rw.w);
            if (!chip) continue;
            const done = rw.got >= rw.need;
            chip.num.string = `${rw.got}/${rw.need}`;
            chip.num.color = hex(done ? C.DONE_TX : C.INK2);
            this.paintChip(chip, done);
        }
    }

    // ============================================================
    //  棋盘
    // ============================================================
    private buildBoard(): void {
        const C = CFG.COLOR;
        const G = CFG.BOARDGEO;

        // ★ 案几的投影（`0 6px 20px rgba(40,30,15,.28)`）**必须先建**。
        //   投影和棋盘都挂在 this._root 上，Cocos 2D 按子节点顺序渲染 ——
        //   后建的在**上层**。我第一版把 mkShadow 写在 _boardNode 之后，
        //   于是这块"投影"（两层 roundRect，叠起来 α≈0.39）变成了一层
        //   盖住整个棋盘的暗罩：宣纸牌底从 220 亮度被压到 145。
        //   截图上看只是"整体有点暗"，非常像渲染风格差异，肉眼几乎不会怀疑到
        //   投影头上 —— 是逐点采样牌底颜色才把它揪出来的。
        setPos(mkShadow(this._root, this._boardW, this._boardH, px(G.R),
            -px(6), px(6), C.BOARD_SHADOW, C.BOARD_SHADOW_A), 0, this.boardCy);

        this._boardNode = mkNode('board', this._root, this._boardW, this._boardH);
        setPos(this._boardNode, 0, this.boardCy);

        // 案几的面（深墨）+ 内阴影暗角
        const face = mkNode('board-face', this._boardNode, this._boardW, this._boardH);
        const fg = face.addComponent(Graphics);
        fg.fillColor = hex(C.BOARD);
        fg.roundRect(-this._boardW / 2, -this._boardH / 2, this._boardW, this._boardH, px(G.R));
        fg.fill();
        mkInsetVignette(this._boardNode, this._boardW, this._boardH, px(G.R),
            px(C.BOARD_VIG_DEPTH), C.BOARD_VIG, C.BOARD_VIG_A);

        // 序：可滑高亮 → 牌 → 命中描边 + 连线 → 特效
        const reachLayer = mkNode('reach', this._boardNode, this._boardW, this._boardH);
        this._reachDraw = reachLayer.addComponent(Graphics);
        this._tileLayer = mkNode('tiles', this._boardNode, this._boardW, this._boardH);
        // ⚠️ 连线与描边必须挂在**两个节点**上：一个节点只能有一个渲染组件，
        //    同一个节点 addComponent(Graphics) 两次时第二次会被拒绝并报
        //    "Can't add renderable component to this node because it already have one."
        //    —— 只是 warn，不抛错，但那个 Graphics 根本没建出来（描边整层失效）。
        const linkLayer = mkNode('link', this._boardNode, this._boardW, this._boardH);
        this._linkDraw = linkLayer.addComponent(Graphics);
        const ringLayer = mkNode('ring', this._boardNode, this._boardW, this._boardH);
        this._ringDraw = ringLayer.addComponent(Graphics);
        // 「多选配对」的呼吸闪烁（2026-10-03 加）。挂在描边层旁边、牌之上 ——
        // 它是一圈**画在牌上**的提示，被牌盖住就等于没做。
        const flashLayer = mkNode('flash', this._boardNode, this._boardW, this._boardH);
        this._flashDraw = flashLayer.addComponent(Graphics);
        // 波纹层：点击的"叮"与合成的"撞击环"都画在它上面（每个波纹一个自己的节点，
        // 因为每个都要独立改大小/透明度；同期的波纹最多 1~2 个，代价可忽略）。
        this._rippleLayer = mkNode('ripple', this._boardNode, this._boardW, this._boardH);
        this._fxLayer = mkNode('fx', this._boardNode, this._boardW, this._boardH);

        // ★ 触摸挂在棋盘节点上（理由见文件头）。板上的牌没有监听，不会截走事件。
        this._boardNode.on(Node.EventType.TOUCH_START, this.onDown, this);
        this._boardNode.on(Node.EventType.TOUCH_MOVE, this.onMove, this);
        this._boardNode.on(Node.EventType.TOUCH_END, this.onUp, this);
        this._boardNode.on(Node.EventType.TOUCH_CANCEL, this.onUp, this);
    }

    /** 按棋盘数据建牌（贴图已预热，可同步拿到） */
    private renderTiles(): void {
        for (const t of this._board.allTiles()) this.createTileNode(t);
    }

    private createTileNode(t: Tile): Node {
        const n = mkNode('tile', this._tileLayer, this._tile, this._tile);
        setPos(n, this.cellX(t.c), this.cellY(t.r));
        n.addComponent(UIOpacity).opacity = 255;
        const sp = n.addComponent(Sprite);
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        sp.type = Sprite.Type.SIMPLE;
        // ★ 自动路由到「这个字所属章的 bundle」：第 2~4 章的图在分包里，
        //   用写死 resources 的老写法会**静默缺图**（只有一行 warn）。
        loadTileByChar(t.char, t.kind, t.tex, (sf) => {
            if (!n.isValid || !sf) return;
            sp.spriteFrame = sf;
            n.getComponent(UITransform)!.setContentSize(this._tile, this._tile);
        });
        this._views.set(t.id, n);
        return n;
    }

    private tileNode(t: Tile): Node | null {
        return this._views.get(t.id) || null;
    }

    /** 把牌的显示位置对齐到数据位置（顺带清掉它身上可能在跑的动画） */
    private snapTile(t: Tile): void {
        const n = this.tileNode(t);
        if (n && n.isValid) {
            Tween.stopAllByTarget(n);
            n.angle = 0;
            n.setPosition(this.cellX(t.c), this.cellY(t.r), 0);
            n.setScale(1, 1, 1);
        }
    }

    // ============================================================
    //  触摸：拿起 / 拖动 / 落下
    // ============================================================
    private onDown(e: EventTouch): void {
        if (this._busy || this._finished || this._drag) return;
        const ui = e.getUILocation();
        const local = this.toLocal(ui);
        const cell = this.cellAtLocal(local.x, local.y);
        if (!cell) return;
        const t = this._board.at(cell.r, cell.c);
        if (!t) return;

        const n = this.tileNode(t);
        if (!n || !n.isValid) return;

        // ★ 拿起瞬间冻结范围（理由见文件头）
        const range = this._board.slideRange(t);
        this._drag = {
            tile: t, node: n,
            homeR: t.r, homeC: t.c,
            range,
            startX: ui.x, startY: ui.y,
            offX: local.x - this.cellX(t.c),
            offY: local.y - this.cellY(t.r),
            // ★ 起手就把"当前格"置成原格，这样拖动**第一次跨格**就能响一声珠子音
            //   （若留 null，第一格会因为没有可比的前值而沉默 —— 而第一格恰恰是
            //   玩家确认"我在拖了"的那一声）。onUp 的落点判定读的也是它，语义不变。
            axis: null, moved: false, last: { r: t.r, c: t.c },
            // ★ 初值是"牌此刻的真实位置"（= 原格格心），不是 null。
            //   给 null 的话第一次 onMove 会拿它当"无前值"，白打一行没意义的采样。
            lastNode: { x: n.position.x, y: n.position.y },
            pushed: new Map(),
        };

        Tween.stopAllByTarget(n);
        n.setSiblingIndex(this._tileLayer.children.length - 1);   // 被拎起来了，浮到最上
        // 「拎起」这一声。它在手势栈里，顺带把 BGM 也借势带起来（见 AudioService）。
        AudioService.play('pick');
        // ★ 拎起来用 80ms 短补间，不是瞬间赋值 —— 见 LIFT_MS 的注释。
        //   这同时也是"点击的第一个微反馈"：无论玩家最后是点还是拖，
        //   按下去立刻就有东西动，手感才有"跟手"的起点。
        n.setScale(1, 1, 1);
        tween(n).to(LIFT_MS, { scale: new Vec3(DRAG_SCALE, DRAG_SCALE, 1) }).start();
        this.drawReach(range, t.r, t.c);
        // 点击的第二层微反馈：牌上"叮"一下的扩散波纹。
        // 宝牌用藤黄（它是"要凑的一对宝"），干扰牌用墨灰（中性，"这不是你要找的东西"），
        // 正常字牌也用藤黄/朱砂 —— 但宝牌的波纹更大更亮，因为整盘只有它两两成对。
        const isTr = t.kind === 'treasure';
        this.rippleAt(this.cellX(t.c), this.cellY(t.r),
            t.kind === 'junk' ? CFG.COLOR.INK3 : CFG.COLOR.HL_GOLD,
            isTr ? 255 : (t.kind === 'junk' ? 190 : 230), isTr ? 0.9 : 0.72,
            isTr ? 2.1 : 1.5, TAP_RIPPLE_MS);
    }

    private onMove(e: EventTouch): void {
        const d = this._drag;
        if (!d) return;
        const ui = e.getUILocation();
        const dx = ui.x - d.startX;
        const dy = ui.y - d.startY;
        if (!d.moved && Math.sqrt(dx * dx + dy * dy) > CFG.GAME.DRAG_SLOP) {
            d.moved = true;
            // ★★ 真的开始拖了，才收掉「多选配对」的呼吸闪烁 ★★
            //   为什么放在这里而不是 `onDown`：`onDown` 分不清"玩家要点"还是"玩家要拖" ——
            //   在那里就收掉的话，**单纯点一下**（没移动）也会让闪烁消失，
            //   而 `tapTile` 的"点到了但没能消"那条路**不会**重算它（见 tapTile 的注释，
            //   提示文案已删、指路全靠闪烁）⇒ 闪烁会一直黑着，直到下一次盘面变化。
            //   `onMove` 这个分支只在"位移真的超过 DRAG_SLOP"那一刻进一次，正合适。
            this.clearFlash();
        }
        if (!d.moved) return;

        // ★ 先定一条轴：横向拖得多就横滑，纵向拖得多就竖滑。
        //   锁定后整段拖动都只在这条轴上行进，牌不会斜着飞到别的行/列去。
        if (!d.axis) d.axis = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';

        const local = this.toLocal(ui);
        const cx = local.x - d.offX;                 // 牌中心的意图位置
        const cy = local.y - d.offY;
        // clampSlide 要的是"牌左上角相对棋盘左上角"的坐标
        const left = cx - this._tile / 2 + this._boardW / 2;
        const topDist = this._boardH / 2 - (cy + this._tile / 2);

        // 落点判定（取整到格）—— 玩法口径，一个字都没改
        const p = this._board.clampSlide(
            d.range, d.axis, d.homeR, d.homeC, left, topDist, this._pitch, this._gap);

        // ★★ 显示位置 = 落点那一格的**格心**（2026-10-03 真机试玩后回到原型口径）★★
        //
        // 之前这里是「跟手自由滑 + 越界橡皮筋」：沿锁定轴用**手指的真实位置**，
        // 超出 range 时走橡皮筋。真机试玩一眼看出三个问题（三条都是用户原话）：
        //   ① 「拖动的时候不像原来的格子」——
        //      牌会停在两格之间。截图实测：「革」的纸面顶边在 y=565，
        //      而它所在行的正常顶边是 y=518 ⇒ 牌跨在 row1/row2 正中，上方露出了棋盘底。
        //   ② 「格子会歪掉」——横拖时那句 `rotate(±6°)`。截图实测倾角 5.45°。
        //   ③ 「能拉出边界之外」——橡皮筋允许超出 range 最多 20 设计px，
        //      截图实测：牌越出棋盘左边界约半张牌宽。
        //
        // 而原型 `prototype/index.html` 的 onMove 本来就是**整格吸附**：
        //   `const p = clampSlide(d, nx, ny);`
        //   `tileXY(d.el, p.c*G.cell + G.gap/2, p.r*G.cell + G.gap/2, 'scale(1.1) rotate(tilt)');`
        // —— 位置直接取 `clampSlide` 算出来的那一格。所以这一改不是"新设计"，是**回口径**：
        //   Cocos 这版当初把它"优化"成了跟手，反而把三个问题一起引进来了。
        //
        // ★ 出界问题顺手就没了，不需要另写边界夹取：`p` 恒等于 range 内的合法格
        //   （clampSlide 里 `Math.max(range.up, Math.min(range.down, r))` 夹过），
        //   而 range 只含空格 ⇒ 牌永远落在格心上、永远在棋盘内。
        // ★ 另一轴锁死在拿起时的行/列，所以牌只会沿锁定轴一格格走，不会斜着飞。
        // ★ 这同时让"判定"与"显示"**完全同源**：判定用 p，显示也用 p，
        //   再不会出现"看着落在这一格、算的却是那一格"。
        // ★ 手感上也是更稳的：真机的 touchmove 有抖动，跟手会把抖动**如实画出来**，
        //   而吸附只在**跨格那一刻**动一次 —— 手机上吸附比跟手顺。
        if (d.axis === 'h') d.node.setPosition(this.cellX(p.c), this.cellY(d.homeR), 0);
        else d.node.setPosition(this.cellX(d.homeC), this.cellY(p.r), 0);
        // ★ 不倾斜 —— 这是**有意偏离原型**的一处。
        //   原型那句 `rotate(tilt)` 在真机上手感是"格子歪了"，用户明确要求去掉。
        //   以后重读原型时别又把它抄回来。
        d.node.angle = 0;
        // ★ 珠子滑过格子的"嗒"：只在**跨格那一刻**响，不是每帧响。
        //   判据是落点格与上一帧不同。★ 2026-10-03 起显示位置就是 p（整格吸附），
        //   两者同源 ⇒ "响的那一格"与"牌停的那一格"永远一致，不会出现
        //   "声音走了一格、牌还在半路上"的错位。
        //   节流 60ms 由 AudioService 里 BEAD_GAP_MS 兜住（一次拖动最多响 6 下左右）。
        const crossed = !d.last || d.last.r !== p.r || d.last.c !== p.c;
        if (crossed) AudioService.play('bead');
        // ★→ 采样规则：**跨格 或 节点位置又走了半格**（见 DragState.lastNode 的长注释）。
        //   整格吸附下位置只在跨格时变 ⇒ 这条不会带来任何额外输出；
        //   "跟手自由滑"下才会把越界的那一段如实记下来 —— 而那正是要抓的。
        const nodeMoved = d.lastNode
            ? Math.abs(d.node.position.x - d.lastNode.x)
              + Math.abs(d.node.position.y - d.lastNode.y)
            : 0;
        //   半格的门槛用 `this._tile / 2`（= 牌宽的一半）。它随关卡尺寸一起更新，
        //   与 cellX/cellY 用的是同一套设计单位。
        if (crossed || nodeMoved >= this._tile / 2) {
            // ★ 「拖动中牌停在哪一格 / 走了多远」的**可测入口**（2026-10-03 加）。
            //   冒烟的 `dragcell:` 动作靠这一行断言用户报的三件事：
            //     ① `节点=` 必须恰好等于 `期望=`（即格心）—— 不是"两格之间"；
            //     ② `角度=` 必须恒为 0.00 —— 没歪；
            //     ③ `节点=` 必须落在棋盘范围内 —— 没被拉出边界。
            //   ⚠️ ③ 判的是**节点位置**，不是 `格=`。`格=` 是 clampSlide 的输出，
            //      天然被夹在棋盘内，"格越界"是个恒假判据（负控实验实测过）。
            //   键名被 tools/web-smoke.mjs 的 parseDrag 解析，改名必须同步改脚本。
            log(`[Diag] DRAG 字=${d.tile.char} 格=${p.r},${p.c} `
                + `节点=(${Math.round(d.node.position.x)},${Math.round(d.node.position.y)}) `
                + `期望=(${Math.round(this.cellX(p.c))},${Math.round(this.cellY(p.r))}) `
                + `角度=${d.node.angle.toFixed(2)}`);
            d.lastNode = { x: d.node.position.x, y: d.node.position.y };
        }
        d.last = p;
        this.paintPush(d, p);      // ★ 推箱：被推的那一串必须**跟着一起动**
        this.previewMatch(d, p);
    }

    /**
     * ★ 推箱的即时预览：拖动中，被这一手推着走的牌一起挪。
     *
     * 【为什么不能只挪手里那一张】
     * 推箱的落点**是有牌的格子**：玩家必须看到自己那张压上去、被压的往后退一格，
     * 才读得懂"我在推"。只动手里那张的话，被推的一串会一直待在原位，
     * 松手瞬间突然整排换位 —— 看起来就是 bug。
     *
     * 【为什么每帧重算，而不是增量维护】
     * 落点每帧都可能变，被推的**那一串也跟着变**（推 1 格还是推 3 格，牵动的牌不一样）。
     * 增量维护要同时处理"新进串的"（要退回去）与"这一帧不推了"（也要退回去）两种情况，
     * 而每帧重算天然收敛。代价是每帧一次小数组，不值得为它写一版增量逻辑。
     *
     * 【为什么用瞬移而不是补间】
     * 这些牌是"被手指推着走的"，跟手才叫推；给它补间会变成慢半拍地跟。
     * 手里那张牌本身走的是"整格吸附"（见 onMove），两者读起来是同一件事：
     * 手指走到哪一格，整段牌就一起停到那一格。
     */
    private paintPush(d: DragState, p: Cell): void {
        const mv = this._board.dragMoves(d.tile, p.r, p.c);
        const now = new Map<Tile, Cell>();
        for (const m of mv) if (m.t !== d.tile) now.set(m.t, m.to);
        // 上一帧被推、这一帧不推了 → 送回它数据上的格子
        for (const t of d.pushed.keys()) if (!now.has(t)) this.snapTile(t);
        // 这一帧被推的 → 摆到它将被推到的格
        for (const [t, to] of now) {
            const n = this.tileNode(t);
            if (!n || !n.isValid) continue;
            Tween.stopAllByTarget(n);
            n.setPosition(this.cellX(to.c), this.cellY(to.r), 0);
        }
        d.pushed = now;
    }

    /**
     * 拖动作废时，把被推的牌放回它们**数据上的**格子。
     * @param animate true = 走与手里那张牌同一条回弹补间（整段看起来是一起退回去的）；
     *                false = 瞬移（用在"落点已经回到原格"这种本来就没位移的场合）
     */
    private resetPush(d: DragState, animate = false): void {
        for (const t of d.pushed.keys()) {
            if (!animate) { this.snapTile(t); continue; }
            const n = this.tileNode(t);
            if (!n || !n.isValid) continue;
            Tween.stopAllByTarget(n);
            n.angle = 0;
            tween(n)
                .to(CFG.GAME.REBOUND_MS / 1000,
                    { position: new Vec3(this.cellX(t.c), this.cellY(t.r), 0), scale: new Vec3(1, 1, 1) },
                    { easing: 'sineOut' })
                .start();
        }
        d.pushed.clear();
    }

    private onUp(_e: EventTouch): void {
        const d = this._drag;
        if (!d) return;
        this._drag = null;
        this._reachDraw.clear();
        this._linkDraw.clear();
        this._ringDraw.clear();

        const n = d.node;
        // ★ 先停掉"拎起来"那条补间再复位 —— 否则它还在跑，会把 angle/scale 又写回去
        if (n && n.isValid) {
            Tween.stopAllByTarget(n);
            n.setScale(1, 1, 1);
            n.angle = 0;
        }

        // 没怎么动 → 当作点击（对齐了就消，没对齐给一句提示）
        if (!d.moved) {
            this.snapTile(d.tile);
            this.tapTile(d.tile);
            return;
        }

        const p = d.last || { r: d.homeR, c: d.homeC };
        if (p.r === d.homeR && p.c === d.homeC) {
            // 落点回到原格（玩家拖出去了又拖回来）。
            // ★ 2026-10-03 起拖动是**整格吸附**的（见 onMove），所以"落点回到原格"
            //   时节点本来就在格心上，这条 seatTile 实际是个空补间。留着是为了
            //   兜住"拖动中途被别的补间写过位置"这类残留（幂等、代价近乎零）。
            //   ⚠️ 别据此认为"拖动时节点可能不在格心"——那是吸附之前的旧行为。
            this.resetPush(d);            // ★ 半路上被推过的牌也要回原位
            this.seatTile(d.tile);
            // 整张牌被堵死 → 明确告诉玩家，别让人以为是 bug
            if (!this._board.canSlide(d.tile)) {
                this.rejectTile(d.tile);
                this.toast('这张牌上下左右都被挡住了\n先把它旁边的牌挪开');
            }
            // ★ 盘面一个字节都没变 ⇒ 把拖动开始时收掉的闪烁原样还回去。
            //   （漏了这句的表现：拖出去又拖回来之后，全场金框全没了，
            //     而且"没了"和"本来就没有多选局面"长得一模一样，极难发现。）
            this.refreshFlash();
            return;
        }

        // ★★ 严格回弹（2026-10-02 用户拍板）★★
        //   落位之后**凑不成字**的走法一律不成立：牌沿原路滑回原格，盘面与步数都不变。
        //   目的：不让玩家把字牌"随便乱摆"—— 那样盘面会被推成一团死棋，
        //   而这游戏的核心就是把偏旁与部件挪到同行同列，乱摆等于绕开了玩法本身。
        //
        //   判据必须走 simulateHits（与拖动中的金圈预判**同一套**），
        //   否则会出现"圈亮了、松手却弹回"的错位。
        if (!this.simulateHits(d.tile, p.r, p.c).length) {
            this.reboundTile(d, p);
            // ★ 回弹 = 盘面没变 ⇒ 把闪烁还回去（同上）。
            //   金框按**各牌的 home 格**画，也就是牌正在滑回去的那几格 ——
            //   170ms 后牌到家，框正好落在牌上，观感是"它一直在那儿"。
            this.refreshFlash();
            return;
        }
        this.applyMove(d.tile, p.r, p.c);
    }

    /**
     * 严格回弹：把牌从"玩家松手的位置"补间滑回它**本来的格子**。
     *
     * 【为什么盘面数据根本不用动】
     * 整个拖动过程只改节点的 position，`_board` 里的 `_cells` 与牌的 r/c 从未变过
     * （`clampSlide` 只算坐标）。所以"回弹"是一次**纯视觉**动画：
     * 把节点 tween 回 home 格的中心，数据层自然是干净的。
     * 也正因为如此，本次操作**不 +1 步、不写 diag 日志、不触发死局检测**。
     *
     * 【为什么要 setScale / 收角度】
     * onDown 里把牌放大到 DRAG_SCALE，onUp 开头已经复位。
     * 角度则**从头到尾都是 0**（2026-10-03 去掉了原型的 ±6° 倾斜，见 onMove），
     * 这里收一次只是为了兜住将来的残留。本函数负责的是横向/纵向位移那一段。
     *
     * 【toast 节流】
     * 玩家探索时会连续拖好几张都弹回，每次都弹一句会非常吵。
     * 所以 2.5s 内只提示一次 —— 第一次足够让人明白规则，后面靠动画本身说话。
     */
    private reboundTile(d: DragState, p: Cell): void {
        const n = d.node;
        const t = d.tile;
        const homeX = this.cellX(d.homeC), homeY = this.cellY(d.homeR);
        // ★ 推箱：被推的那一串也要**一起**弹回去（同一条 170ms 补间）。
        //   它们的数据坐标从头到尾没动过，所以"弹回"只是把节点摆回各自的格。
        this.resetPush(d, true);
        // 「这一步不成立」。★ 声音放在**回弹开始**的这一刻，不是结束的时候 ——
        //   回弹只有 170ms，等滑回去再响就成了"迟到的反馈"，读起来像两个不相干的事。
        AudioService.play('reject');
        // ★ 这行日志是**严格回弹唯一的可观测证据**，键名被 tools/web-smoke.mjs 的
        //   `rebound:` 动作解析（节点位置 vs 目标位置），改名必须同步改脚本。
        //   带上"起点的节点位置"，是为了证明"牌真的先被拖走了、然后才弹回来" ——
        //   只断言"回到原位"的话，一次完全没生效的拖动也能算通过。
        const fromXY = n && n.isValid
            ? `节点=(${Math.round(n.position.x)},${Math.round(n.position.y)})`
            : '节点=无效';
        log(`[GamePage] 严格回弹：${t.char} 格(${p.r},${p.c}) → 格(${d.homeR},${d.homeC}) `
            + `${fromXY} 目标=(${Math.round(homeX)},${Math.round(homeY)}) 落位凑不成字`);

        if (n && n.isValid) {
            Tween.stopAllByTarget(n);
            tween(n)
                .to(CFG.GAME.REBOUND_MS / 1000,
                    { position: new Vec3(homeX, homeY, 0) },
                    { easing: 'sineOut' })
                .call(() => {
                    // 动画收尾按数据再钉一次，消掉浮点残差
                    this.snapTile(t);
                    log(`[GamePage] 回弹到位：${t.char} 节点=(${Math.round(n.position.x)},`
                        + `${Math.round(n.position.y)}) 目标=(${Math.round(homeX)},${Math.round(homeY)})`);
                })
                .start();
        } else {
            this.snapTile(t);
            log(`[GamePage] 回弹到位：${t.char} 节点=(${Math.round(homeX)},${Math.round(homeY)}) `
                + `目标=(${Math.round(homeX)},${Math.round(homeY)})`);
        }

        // 回弹期间不接受新的拖动，否则两次补间会打架
        this._busy = true;
        this.timer(() => {
            this._busy = false;
            // ★ 回弹之后补一次卡住检测。
            //   目的是兜住"整盘已经无路可走"的情况：这时玩家每拖一张都被弹回，
            //   若不在这里检测，他会连着试好几次才等到广告弹层 —— 那几秒很伤手感。
            //   反过来说，**开局时不检测**：关卡一进去就弹「卡住了」会像是坏了，
            //   而"拖了一下被弹回 → 弹层出现"是玩家自己动作带来的反馈，顺得多。
            this.checkDeadlock();
        }, CFG.GAME.REBOUND_MS + 30);

        const now = Date.now();
        if (now - this._lastReboundToastAt > 2500) {
            this._lastReboundToastAt = now;
            this.toast('这一步凑不成字\n字牌已滑回原位');
        }
    }

    // ============================================================
    //  落子与合成
    // ============================================================
    private applyMove(t: Tile, r: number, c: number): void {
        // ★★ 2026-10-03 推箱：落位是**整段一起**落的 ★★
        //   原来是"把 t 摘掉、写到 (r,c)"。现在被推的那一串也要跟着落盘 ——
        //   否则动画演完（`paintPush` 把它们摆到了新格）而数据还留在原格，
        //   盘面上就出现"看到的和算的不是一回事"，下一步的合成判定会全错。
        //   落盘用 `dragMoves + applyDrag` 一次做完，与求解器、与提示走同一份规则。
        const mv = this._board.dragMoves(t, r, c);
        this._board.applyDrag(mv);
        this._moves++;
        // ★ 不瞬移：从松手的位置补间滑进目标格（SEAT_MS = 90ms）。
        //   瞬移会有"啪一下"的断裂感 —— 拖动时牌是**整格吸附**的（见 onMove），
        //   所以"松手位置"本就等于某个格心，这条补间就是把"最后那一格的格心"
        //   滑到"数据上的目标格心"（推箱时会差一格），读起来是牌自己收进去。
        //   ★ 被推的牌同理，一起走同一条补间 —— 它们刚才跟着整段挪了，
        //     松手瞬间也该整段停稳。
        // 「落位」。与 90ms 的落位补间**同一时刻**发出去 ——
        //   声音比动作晚一点点人耳就觉得"对不上"，而落位这一下是"啪"的收尾感。
        AudioService.play('land');
        for (const m of mv) this.seatTile(m.t);
        this._busy = true;      // 这 130ms 里不接受新的拖动，避免时序打架
        this.timer(() => {
            if (this._finished) return;
            const hits = this._board.matchTargets(t, this._pair);
            if (hits.length) {
                this.resolveMatch(t, hits[0]);
            } else {
                this._busy = false;
                this.checkDeadlock();
                this.diag('挪牌');
                // 盘面变了 ⇒ 多选局面可能变多/变少，重算闪烁。
                // （拖动开始时已 clearFlash，这里收尾算一次，整段拖动只算一末尾。）
                this.refreshFlash();
            }
        }, 130);
    }

    /**
     * 落位补间：把牌从"松手时的位置"滑进它数据上的格子。
     * 数据（`_board` 的格与牌的 r/c）已经在 applyMove 里写好了，这里**纯视觉**。
     */
    private seatTile(t: Tile): void {
        const n = this.tileNode(t);
        if (!n || !n.isValid) return;
        Tween.stopAllByTarget(n);
        n.angle = 0;
        tween(n)
            .to(SEAT_MS, { position: new Vec3(this.cellX(t.c), this.cellY(t.r), 0), scale: new Vec3(1, 1, 1) },
                { easing: 'quadOut' })
            .start();
    }

    /**
     * 合成。
     * ★ 一次操作只消一对，不做自动连锁 —— 玩家每消一对都要自己出手。
     *   否则一次点击会把场上所有已对齐的牌一起清掉，游戏变成"自己玩自己"。
     */
    private resolveMatch(a: Tile, b: Tile): void {
        // ★ 宝牌走另一套结算：它**不合成字**（`pair.word()` 对宝牌恒返回空串），
        //   若不留这一步，下面 `if (!word)` 会静默 return —— 表现为"点了没反应"。
        if (this._pair.isTreasurePair(a, b)) { this.resolveTreasure(a, b); return; }

        const word = this._pair.word(a, b);
        if (!word) { this._busy = false; return; }

        // ★ 这两张牌马上要从盘上消失 ⇒ 先把闪烁收掉（理由同 clearFlash 的注释）：
        //   否则那圈金边会继续画在"牌已经没了"的格子上，读起来像飘着一个空框。
        //   新盘面的闪烁由下面清理回调里的 refreshFlash() 重算。
        this.clearFlash();

        this._board.removeAt(a);
        this._board.removeAt(b);
        const rw = this._runWords.find((x) => x.w === word);
        if (rw) rw.got++;
        if (this._madeWords.indexOf(word) < 0) this._madeWords.push(word);
        this.refreshGoals();
        // 目标刚好凑满 → 那颗 chip 脉冲一次。这是"这个字做完了"最直接的正反馈，
        // 而且它落在玩家的视野上半区（目标条），不会和棋盘上的撞击动效抢注意力。
        if (rw && rw.got === rw.need) this.pulseChip(rw.w);

        const mx = (this.cellX(a.c) + this.cellX(b.c)) / 2;
        const my = (this.cellY(a.r) + this.cellY(b.r)) / 2;
        const horiz = a.r === b.r;

        // ---- 0) 撞击帧 ★ 2026-10-02 新增 ----
        //   原来是"两牌匀速淡出飞向中点"，读起来像两张纸**飘**到一起，
        //   缺少"撞"的那一下。现在先在 70ms 里把两张牌沿**运动轴**压扁
        //   （横撞 → 变宽变矮；竖撞 → 变高变窄），再收进中点 ——
        //   挤压是"有质量的东西撞上去了"最省笔画的表达。
        //   同一帧还要三件小事：接触点迸一圈金环、棋盘微震、合成字随后浮现。
        const sqA = horiz ? IMPACT_SQUASH : 2 - IMPACT_SQUASH;
        const sqB = horiz ? 2 - IMPACT_SQUASH : IMPACT_SQUASH;
        // ★「咚—唰」二连：撞击在同一帧，消散推后 70ms。
        //   之所以是"延后"而不是"先播完 clash 再播 clear"：两段音效是**叠加**的，
        //   70ms 正好让 clash 的瞬态峰过去、尾巴还在，听感是一次撞击带着余韵散开，
        //   而不是两个挨着的独立声音（那是"两件事"，不是"一件事"）。
        AudioService.play('clash');
        AudioService.play('clear', { delayMs: 70 });
        this.rippleAt(mx, my, CFG.COLOR.HL_GOLD, 255, 0.4, 2.4, IMPACT_RING_MS);
        this.shakeBoard();

        // 1) 两张牌：先挤压 → 再飞向中点并淡出
        for (const t of [a, b]) {
            const n = this.tileNode(t);
            if (!n || !n.isValid) continue;
            // ★ 必须先停掉 seatTile 那条落位补间：同一个节点上两条 tween 会一起写
            //   position/scale，结果是"被两个方向同时拉"，表现为抖动与落点漂移。
            Tween.stopAllByTarget(n);
            const op = n.getComponent(UIOpacity);
            tween(n)
                .to(IMPACT_SQUASH_MS, { scale: new Vec3(sqA, sqB, 1) })
                .to(0.16, { position: new Vec3(mx, my, 0), scale: new Vec3(0.55, 0.55, 1) })
                .start();
            if (op) tween(op).to(0.23, { opacity: 0 }).start();
        }

        // 2a) 金色光晕（★ 用户拍板：合成字要"更大更亮 + 金色光晕"）
        //    先建 → 压在合成字下面。它是一圈**描边**而不是实心块：
        //    实心色块在宣纸底上会读成"贴了张金色贴纸"，描边才像"光"。
        const glow = mkNode('glow', this._fxLayer, this._tile, this._tile);
        setPos(glow, mx, my);
        const gg = glow.addComponent(Graphics);
        const gop = glow.addComponent(UIOpacity);
        gg.lineWidth = px(GLOW_W);
        gg.strokeColor = hex(CFG.COLOR.GOLD_L, 235);
        gg.roundRect(-this._tile / 2, -this._tile / 2, this._tile, this._tile, px(10));
        gg.stroke();
        glow.setScale(GLOW_FROM, GLOW_FROM, 1);
        tween(glow).to(GLOW_MS, { scale: new Vec3(GLOW_TO, GLOW_TO, 1) },
            { easing: 'quadOut' }).start();
        tween(gop).to(GLOW_MS, { opacity: 0 }).start();
        this.timer(() => { if (glow.isValid) glow.destroy(); }, GLOW_MS * 1000 + 60);

        // 2) 合成字从中点浮现（用烘好的同款牌面 → "合出来的是一个字"一眼可见）
        const melt = mkNode('melt', this._fxLayer, this._tile, this._tile);
        setPos(melt, mx, my);
        const mop = melt.addComponent(UIOpacity);
        mop.opacity = 0;
        melt.setScale(0.5, 0.5, 1);
        const sp = melt.addComponent(Sprite);
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        sp.type = Sprite.Type.SIMPLE;
        // 合成字的图同样按「这个字属于哪一章」路由（`word` 是自成一个字的，
        // 它在 TILE_CHAPTER 里有条目；用 kind='part' 只是复用"普通牌"那条查表分支）。
        loadTileByChar(word, 'part', undefined, (sf) => {
            if (!melt.isValid || !sf) return;
            sp.spriteFrame = sf;
            melt.getComponent(UITransform)!.setContentSize(this._tile, this._tile);
        });
        // 0.34s 涨到峰值（backOut 让它在峰值上"顿"一下，那是被看见的一瞬）
        tween(melt).to(0.34, { scale: new Vec3(MELT_PEAK, MELT_PEAK, 1) }, { easing: 'backOut' }).start();
        tween(mop).to(0.2, { opacity: 255 }).start();
        this.timer(() => {
            if (!melt.isValid) return;
            tween(melt).to(0.3, { scale: new Vec3(MELT_OUT, MELT_OUT, 1) }).start();
            tween(mop).to(0.3, { opacity: 0 }).start();
        }, 360);

        // 3) 清理 → 判胜负 / 判死局（时点见 CFG.GAME.MATCH_CLEANUP_MS）
        this.timer(() => {
            for (const t of [a, b]) {
                const n = this.tileNode(t);
                if (n && n.isValid) n.destroy();
                this._views.delete(t.id);
            }
            if (melt.isValid) melt.destroy();
            if (this._finished) return;
            this.renderMade();
            if (this._board.remainingPlayable() === 0) { this.finishClear(); return; }
            this._busy = false;
            this.checkDeadlock();
            this.diag('合成');
            // 盘面变了（少了两张）⇒ 重算"多选配对"的闪烁。
            // ★ 放在 diag 之后：这样冒烟日志里 FLASH 那几行**紧跟着**这一手的
            //   STATE 快照，回放时不用在两个时间点之间来回翻。
            this.refreshFlash();
        }, CFG.GAME.MATCH_CLEANUP_MS);
    }

    /**
     * ★ 宝牌成对（2026-10-03 接入）。
     *
     * 【它为什么不能直接复用 resolveMatch】
     * 宝牌不合成字，它干的是另一件事：**消掉自己 + 额外送玩家一对普通牌**。
     * 复用 resolveMatch 会有三个说不通的地方：
     *   ① 它要 `pair.word()` 非空才继续，而宝牌的 word 恒为空串；
     *   ② 它会走"合成字从中点浮现 + 金晕"那套演出 —— 宝牌没有合成字；
     *   ③ 送掉的那一对**也得演出来**，否则玩家只看到"盘面莫名少了两张牌"。
     * 所以单开一条流程，只复用最底层的动效原语（挤压 / 飞出 / 金环 / 震屏）。
     *
     * 【时序：为什么要分四段而不是一次全消】
     *   0ms    宝牌两张撞到一起 → 器物显形（"这是件宝物"）
     *   430ms  器物**开始收势**（与 `treasureCrest` 里那 430ms 的收缩对齐）＋ 一枚金环由大收小
     *   ~820ms 器物消失（`MELT_OUT` 收完、destroy）
     *   840ms  被送掉的那一对：金线生长 + 圈住 ← **必须等器物消失之后才看得见**
     *   1260ms 它俩撞掉
     *   1780ms 清理 + 判胜负
     *
     * ★ 第二段原来是 240ms —— 而器物要演到 ~770ms 才收完，
     *   于是金圈与金线正好画在器物贴图底下，玩家读到的是"我凑了个宝牌，
     *   然后场上少了两张牌"，而不是"我凑了个宝牌，它替我把『木+仓』消成了『枪』"。
     *   后者才是这个机制的价值。（用户 2026-10-03 拍板：延后这一段 + 加动态效果。）
     *   改这几个数时请连同 `TREASURE_*_MS` 常量一起改，别只改注释。
     */
    private resolveTreasure(a: Tile, b: Tile): void {
        // 整段演出期间锁输入：这 1.78 秒（`TREASURE_CLEANUP_MS`）里盘面数据已经在变
        // （宝牌已摘掉、赠品已在 `TREASURE_TAKE_MS` 摘掉），玩家此刻点任何一张牌，
        // 算出来的可消对都不是他看到的那个盘面。
        // ⚠️ 这个数随 `TREASURE_*_MS` 一起变，别再写死"1.1 秒"。
        this._busy = true;

        const name = a.char;
        // ★ "送哪一对"必须在**动画开始之前**就定下来。
        //   等动画放完再挑，中途可能已被别的逻辑改过盘面，挑出来的就不是
        //   "凑成宝牌那一刻的那一对" —— 玩家会觉得"它随便消了别人的牌"。
        //   （用户 2026-10-03 拍板：只从**能合成的普通牌对**里挑，保证可解性。）
        const bonus = this._board.randomNormalPair(this._pair, this._rng);
        const word = bonus ? this._pair.word(bonus[0], bonus[1]) : '';

        this._board.removeAt(a);
        this._board.removeAt(b);

        // ★ 宝牌这一路整段 1.78s 都锁着输入，盘面在演出的中途就变了 ——
        //   闪烁必须**在演出开始前**收掉，否则那一圈金边会留在两张已经没了的牌上，
        //   而且中途玩家也不能操作（本来也没法按 clearFlash 的时机去点）。
        this.clearFlash();

        // 目标条：宝牌自己不占目标；**被送掉的那一对要计入它对应的字** ——
        // 否则那两个字的目标永远差一对，关卡通不了。
        const rw = word ? this._runWords.find((x) => x.w === word) : undefined;
        if (rw) rw.got++;
        if (word && this._madeWords.indexOf(word) < 0) this._madeWords.push(word);
        if (rw && rw.got === rw.need) this.pulseChip(rw.w);
        this.refreshGoals();

        const mx = (this.cellX(a.c) + this.cellX(b.c)) / 2;
        const my = (this.cellY(a.r) + this.cellY(b.r)) / 2;

        // 「咚 —沓— 唰」：clash 是撞击、reward 是"额外拿到东西"那一声（专给宝牌）、
        // clear 收尾。三段错开 90/150ms，听感是一次事件带两个余韵，不是三个独立音。
        AudioService.play('clash');
        AudioService.play('reward', { delayMs: 90 });
        AudioService.play('clear', { delayMs: 170 });
        this.rippleAt(mx, my, CFG.COLOR.HL_GOLD, 255, 0.55, 3.6, IMPACT_RING_MS + 0.14);
        this.shakeBoard(IMPACT_SHAKE + 1);
        this.flyOut(a, b);
        this.treasureCrest(mx, my, a.tex);

        // ── 器物"收势"：与 `treasureCrest` 里 430ms 开始收缩的那一帧对齐 ──
        //   原来这一段是空的：器物涨起来、又缩回去，中间没有任何东西收束它。
        //   补一枚**由大收小**的金环（与撞击环方向相反），读作"宝物落袋"；
        //   顺带把观众的视线从"盘面中点"**推向下一段（被送掉的那一对）**，
        //   否则器物一消失，视线会断在那里。
        this.timer(() => {
            if (this._finished || !this._boardNode.isValid) return;
            this.rippleAt(mx, my, CFG.COLOR.HL_GOLD, 205, 2.1, 0.5, 0.4);
        }, TREASURE_CREST_SINK_MS);

        if (bonus) {
            // ── 第二段：把"被送掉的那一对"指出来 ──
            // ★ 它在器物**完全消失之后**才开始（见文件头时序说明）。
            //   原来卡在 240ms，而器物要演到 ~770ms 才收完 —— 于是一圈金圈+金线
            //   正好画在器物贴图底下，玩家看到的是"凑了个宝牌，然后场上少了两张牌"，
            //   是这个机制最不该有的读法。
            this.timer(() => {
                if (this._finished || !this._boardNode.isValid) return;
                if (!this.tileNode(bonus[0]) || !this.tileNode(bonus[1])) return;

                // ① 两枚金圈一次性落上去（`ringTiles` 是立即成形的描边）
                this.ringTiles(bonus, CFG.COLOR.HL_GOLD, 238, px(2.6));
                // ② 每张牌**各自炸开一小圈** —— 静态金圈的"圈住"感很弱，
                //    从牌心扩出去一枚环，才有"点中了这两个"的动作感。
                for (const t of bonus) {
                    this.rippleAt(this.cellX(t.c), this.cellY(t.r),
                        CFG.COLOR.HL_GOLD, 232, 0.55, 1.7, 0.38);
                }
                // ③ 两张牌被"挑起"一下（不用 pulseTiles —— 那条要停 0.85s，会拖长整段）
                this.bumpTiles(bonus);
                // ④ 金线**从一头生长到另一头**，而不是整条一次出现。
                //    生长把"它俩是一对"变成一个有先后的动作，比"啪一下出现一条虚线"
                //    更贴"金线是宝物赏下来的"这个读法。
                const from: Cell = { r: bonus[0].r, c: bonus[0].c };
                const to: Cell = { r: bonus[1].r, c: bonus[1].c };
                const st = { k: 0 };
                tween(st)
                    .to(0.22, { k: 1 }, {
                        easing: 'quadOut',
                        onUpdate: () => {
                            if (!this._linkDraw.isValid) return;
                            this._linkDraw.clear();
                            this.drawLink(this._linkDraw, from, to,
                                CFG.COLOR.HL_GOLD, 205, st.k);
                        },
                    })
                    .start();
            }, TREASURE_POINT_MS);

            // 第三段：它俩撞掉
            this.timer(() => {
                if (this._linkDraw.isValid) this._linkDraw.clear();
                if (this._ringDraw.isValid) this._ringDraw.clear();
                if (this._finished) return;
                AudioService.play('clash');
                const bx = (this.cellX(bonus[0].c) + this.cellX(bonus[1].c)) / 2;
                const by = (this.cellY(bonus[0].r) + this.cellY(bonus[1].r)) / 2;
                this.rippleAt(bx, by, CFG.COLOR.HL_GOLD, 245, 0.4, 2.6, IMPACT_RING_MS);
                this.shakeBoard(IMPACT_SHAKE - 1);
                this._board.removeAt(bonus[0]);
                this._board.removeAt(bonus[1]);
                this.flyOut(bonus[0], bonus[1]);
            }, TREASURE_TAKE_MS);
        }

        this.timer(() => {
            const gone = bonus ? [a, b, bonus[0], bonus[1]] : [a, b];
            for (const t of gone) {
                const n = this.tileNode(t);
                if (n && n.isValid) n.destroy();
                this._views.delete(t.id);
            }
            if (this._finished) return;
            this.renderMade();
            if (this._board.remainingPlayable() === 0) { this.finishClear(); return; }
            this._busy = false;
            this.checkDeadlock();
            this.diag('宝牌');
            log(`[GamePage] 宝牌成对：${name} ×2`
                + (word ? ` → 额外消掉 ${bonus![0].char}+${bonus![1].char}=${word}` : '（盘上已无可合成的普通对，只消宝牌）'));
            this.toast(word
                ? `「${name}」凑成一对！\n额外消掉「${bonus![0].char}」+「${bonus![1].char}」= ${word}`
                : `「${name}」凑成一对！`);
            // 这一手一次少了 4 张牌（宝牌 2 + 赠品 2）⇒ 盘面变化最大，必须重算闪烁。
            this.refreshFlash();
        }, TREASURE_CLEANUP_MS);
    }

    /** 两张牌：挤压 → 飞向中点 → 淡出（与合成那套同一组参数，手感才一致） */
    private flyOut(a: Tile, b: Tile): void {
        const mx = (this.cellX(a.c) + this.cellX(b.c)) / 2;
        const my = (this.cellY(a.r) + this.cellY(b.r)) / 2;
        const horiz = a.r === b.r;
        const sqA = horiz ? IMPACT_SQUASH : 2 - IMPACT_SQUASH;
        const sqB = horiz ? 2 - IMPACT_SQUASH : IMPACT_SQUASH;
        const pair = [a, b];
        for (let i = 0; i < 2; i++) {
            const n = this.tileNode(pair[i]);
            if (!n || !n.isValid) continue;
            // ★ 必须先停掉可能还在跑的落位补间，否则两条 tween 会同时写 position/scale
            Tween.stopAllByTarget(n);
            const op = n.getComponent(UIOpacity);
            tween(n)
                .to(IMPACT_SQUASH_MS,
                    { scale: i === 0 ? new Vec3(sqA, sqB, 1) : new Vec3(sqB, sqA, 1) })
                .to(0.16, { position: new Vec3(mx, my, 0), scale: new Vec3(0.55, 0.55, 1) })
                .start();
            if (op) tween(op).to(0.23, { opacity: 0 }).start();
        }
    }

    /**
     * 宝牌"显形"：器物贴图从中点涨起来 + 一圈更大的金晕。
     * 与合成字的 melt 是同一套手法，但**更大更亮**（宝牌是奖励，值得夸张一档），
     * 而且用的是器物贴图本身 —— 玩家一眼看到"我凑到的是铁砧"。
     */
    private treasureCrest(x: number, y: number, tex?: string): void {
        const glow = mkNode('crest-glow', this._fxLayer, this._tile, this._tile);
        setPos(glow, x, y);
        const gg = glow.addComponent(Graphics);
        const gop = glow.addComponent(UIOpacity);
        gg.lineWidth = px(GLOW_W * 1.7);
        gg.strokeColor = hex(CFG.COLOR.GOLD_L, 242);
        gg.roundRect(-this._tile / 2, -this._tile / 2, this._tile, this._tile, px(12));
        gg.stroke();
        glow.setScale(GLOW_FROM, GLOW_FROM, 1);
        tween(glow).to(GLOW_MS * 1.2, { scale: new Vec3(GLOW_TO * 1.35, GLOW_TO * 1.35, 1) },
            { easing: 'quadOut' }).start();
        tween(gop).to(GLOW_MS * 1.2, { opacity: 0 }).start();
        this.timer(() => { if (glow.isValid) glow.destroy(); }, GLOW_MS * 1200 + 80);

        const crest = mkNode('crest', this._fxLayer, this._tile, this._tile);
        setPos(crest, x, y);
        const cop = crest.addComponent(UIOpacity);
        cop.opacity = 0;
        crest.setScale(0.6, 0.6, 1);
        const sp = crest.addComponent(Sprite);
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        sp.type = Sprite.Type.SIMPLE;
        // 宝牌恒在主包（跨章共用），`loadTileByChar` 对 kind='treasure' 会锁到第 1 章那条路。
        loadTileByChar('', 'treasure', tex, (sf) => {
            if (!crest.isValid || !sf) return;
            sp.spriteFrame = sf;
            crest.getComponent(UITransform)!.setContentSize(this._tile, this._tile);
        });
        tween(crest).to(0.4, { scale: new Vec3(MELT_PEAK, MELT_PEAK, 1) }, { easing: 'backOut' }).start();
        tween(cop).to(0.22, { opacity: 255 }).start();
        this.timer(() => {
            if (!crest.isValid) return;
            tween(crest).to(0.34, { scale: new Vec3(MELT_OUT, MELT_OUT, 1) }).start();
            tween(cop).to(0.34, { opacity: 0 }).start();
        }, 430);
        this.timer(() => { if (crest.isValid) crest.destroy(); }, 820);
    }

    /**
     * 点击一张牌：能消就消；不能消就告诉玩家它该和谁对齐。
     *
     * 【点击的反馈分三层，别让它们互相盖掉】
     *   ① onDown 已经给了两样：牌的 80ms "拎起来" + 该格一圈扩散波纹
     *      —— 这是"手指点到了"的即时确认（任何牌都有，包括干扰牌）；
     *   ② 这里给的是**语义**反馈：能消 → 撞击动效；能配但没对齐 → 提示 + 双方脉冲；
     *      纯干扰牌 / 无搭档 → rejectTile（挤压 + 轻晃），读作"这张牌不参与"；
     *   ③ toast 只在"玩家不知道原因"时给（如"要先挪到同一行"），不要每次都弹。
     *
     * ⚠️ ②③ 里的挤压/脉冲**必须落在不同节点上**：rejectTile 点的是被点的牌，
     *    pulseTiles 点的是它的搭档 —— 若两者都点同一张，后启动的 tween 会把
     *    先启动的顶掉（同一个节点上两条 tween 会互相覆盖属性）。
     */
    private tapTile(t: Tile): void {
        if (this._busy || this._finished) return;
        const hits = this._board.matchTargets(t, this._pair);
        if (hits.length) { this.resolveMatch(t, hits[0]); return; }
        const cands = this._board.allTiles().filter((o) => this._pair.canPair(t, o));
        if (cands.length) {
            // ★★ 这里原来会弹一条两行长提示（「它和「竹」能拼成字／但要先挪到同一行或同一列」）★
            //   2026-10-03 用户真机截图里被红圈圈住的就是它 —— 它挂在屏幕 52% 高度，
            //   正好压在棋盘中部。用户原话：「提示不要放在中间…遮住了页面，可以直接去掉提示」。
            //   现在删掉这条文案，指路改由**牌面上的闪烁**承担（`refreshFlash`）：
            //   闪的是"能和它配的那几张"，画在牌上、不占任何空间，而且比一句话更容易看懂。
            //   `pulseTiles(cands)` 与 `rejectTile(t)` 保留 —— 它们本来就是"该和谁配"与
            //   "这一下没能消"的即时反馈，且都只动牌本身，不弹任何浮层。
            this.pulseTiles(cands);
            this.rejectTile(t);
        } else {
            // 干扰牌（junk）已全线下线，这里只剩"这张牌在本关确实没有搭档"一种情况。
            this.rejectTile(t);
        }
    }

    // ============================================================
    //  高亮
    // ============================================================
    /**
     * 点亮这张牌沿本行/本列能滑到的空格。
     * 设计稿三件套：底色 rgba(206,160,44,.22) + 2px 内描边 + 中心 7px 提示点。
     */
    private drawReach(range: SlideRange, skipR: number, skipC: number): void {
        const C = CFG.COLOR, G = CFG.BOARDGEO;
        const g = this._reachDraw;
        g.clear();
        const s = this._tile;
        const dot = px(G.REACH_DOT);
        const cells: Cell[] = [];
        for (let c = range.left; c <= range.right; c++) if (c !== skipC) cells.push({ r: skipR, c });
        for (let r = range.up; r <= range.down; r++) if (r !== skipR) cells.push({ r, c: skipC });

        const r6 = px(G.REACH_R);
        // ① 底色（一次 fill）
        g.fillColor = hex(C.BOARD_REACH, C.BOARD_REACH_A);
        for (const x of cells) {
            g.roundRect(this.cellX(x.c) - s / 2, this.cellY(x.r) - s / 2, s, s, r6);
        }
        g.fill();
        // ② 内描边（一次 stroke）
        g.strokeColor = hex(C.BOARD_REACH_EDGE, C.BOARD_REACH_EDGE_A);
        g.lineWidth = px(2);
        for (const x of cells) {
            g.roundRect(this.cellX(x.c) - s / 2 + px(1), this.cellY(x.r) - s / 2 + px(1),
                s - px(2), s - px(2), r6);
        }
        g.stroke();
        // ③ 中心提示点（一次 fill）
        g.fillColor = hex(C.BOARD_REACH_DOT, C.BOARD_REACH_DOT_A);
        for (const x of cells) g.circle(this.cellX(x.c), this.cellY(x.r), dot / 2);
        g.fill();
    }

    /**
     * 模拟"把 t 放到 (r,c)"之后能打到谁 —— **不改动任何持久状态**。
     *
     * ★ 拖动中的金色预判圈、松手时"这一手能不能消"、以及严格回弹的判据，
     *   必须是**同一套逻辑**。否则会出现"圈亮着、松手却被弹回"这种最伤手感的
     *   错位。所以三处共用这一个入口。
     *
     * 【为什么不再手写"临时改 t.r/t.c 再还原"】
     * 2026-10-03 推箱之后，落位**不再只是 t 一个人的事** —— 被推的那一串也要
     * 临时挪走，否则 `lineClear` 会在一条挡着牌的线上判"通"。手写那段逻辑
     * 就等于把 `Board` 的推箱规则又抄了一份（而它就是靠"只有一份"才不出错的）。
     * 现在直接用 `dragMoves + applyDrag/undoDrag`：与引擎、与求解器同源。
     */
    private simulateHits(t: Tile, r: number, c: number): Tile[] {
        const mv = this._board.dragMoves(t, r, c);
        this._board.applyDrag(mv);
        const hits = this._board.matchTargets(t, this._pair);
        this._board.undoDrag(mv);
        return hits;
    }

    /** 拖动中实时预判：这个落点能凑成一对吗；推箱时还要看得见"谁在让位" */
    private previewMatch(d: DragState, p: Cell): void {
        const C = CFG.COLOR, G = CFG.BOARDGEO;
        const rg = this._ringDraw, lg = this._linkDraw;
        rg.clear();
        lg.clear();
        if (p.r === d.homeR && p.c === d.homeC) return;

        const hits = this.simulateHits(d.tile, p.r, p.c);
        // ★ 推箱：这一手会推走哪些牌。它们不是"要消掉的"，而是"要让位的" ——
        //   用**淡一档的金圈**区分，免得玩家把被推的牌误认成会被消掉的搭档。
        const shoved = this._board.dragMoves(d.tile, p.r, p.c)
            .filter((m) => m.t !== d.tile).map((m) => m.t);

        if (!hits.length && !shoved.length) return;
        const s = this._tile + px(1);
        if (shoved.length) {
            rg.strokeColor = hex(C.HL_GOLD, C.HL_GOLD_A * 0.45);
            rg.lineWidth = px(2);
            for (const o of shoved) {
                rg.roundRect(this.cellX(o.c) - s / 2, this.cellY(o.r) - s / 2, s, s, px(G.REACH_R));
            }
            rg.stroke();
        }
        if (!hits.length) return;
        // 金圈标出"落点"与"将被打中的牌"（设计稿 .tile.hl 的 2.5px 金边）
        rg.strokeColor = hex(C.HL_GOLD, C.HL_GOLD_A);
        rg.lineWidth = px(2.5);
        rg.roundRect(this.cellX(p.c) - s / 2, this.cellY(p.r) - s / 2, s, s, px(G.REACH_R));
        for (const o of hits) {
            rg.roundRect(this.cellX(o.c) - s / 2, this.cellY(o.r) - s / 2, s, s, px(G.REACH_R));
        }
        rg.stroke();
        this.drawLink(lg, { r: p.r, c: p.c }, { r: hits[0].r, c: hits[0].c }, C.LINK_GOLD, C.LINK_GOLD_A);
    }

    /**
     * 两张牌之间的虚线。
     * ★ 棋盘规则保证这两张牌**必然同行或同列**，所以连线永远是水平或垂直的 ——
     *   于是可以拿圆角矩形当"圆头短棒"来拼虚线，既不用旋转也不用碰 Graphics
     *   没有 dash 这件事（`stroke-dasharray:7 6` / `stroke-width:4` / linecap round）。
     *
     * @param growK 0~1，只画前 `growK` 段（默认 1 = 整条）。
     *              ★ 宝牌"圈住赠品"用它做**金线生长**：调用方 tween 一个 `{k:0→1}`
     *                然后每帧带 `growK=k` 调本函数重画。放在这里而不是在外面裁剪，
     *                是因为只有本函数知道 `pad / dash / step` 这三个量，
     *                在外面按比例截断必然算错一格。
     */
    private drawLink(g: Graphics, a: Cell, b: Cell, color: string, alpha: number,
                     growK = 1): void {
        const x1 = this.cellX(a.c), y1 = this.cellY(a.r);
        const x2 = this.cellX(b.c), y2 = this.cellY(b.r);
        const horiz = a.r === b.r;
        const span = horiz ? x2 - x1 : y2 - y1;
        const len = Math.abs(span);
        if (len <= 0) return;

        const w = px(4), dash = px(7), step = dash + px(6);
        // 两端各让出半个牌宽（再多 2px），线不要压在牌面上
        const pad = this._tile / 2 + px(2);
        const total = len - pad * 2;
        if (total <= dash) return;

        const sign = span > 0 ? 1 : -1;
        const start = (horiz ? x1 : y1) + pad * sign;
        g.fillColor = hex(color, alpha);
        // ★ 判据必须是 `off + dash <= limit`（这一段的**终点**没过线），
        //   不能写成 `off <= limit` —— 后者会让最后一段**整段冒出来**，
        //   生长看上去是"一格一格跳"，而不是"长出来"。
        const limit = total * Math.max(0, Math.min(1, growK));
        let off = 0;
        while (off + dash <= total && off + dash <= limit) {
            const c = start + (off + dash / 2) * sign;
            const x = horiz ? c : x1;
            const y = horiz ? y1 : c;
            if (horiz) g.roundRect(x - dash / 2, y - w / 2, dash, w, w / 2);
            else g.roundRect(x - w / 2, y - dash / 2, w, dash, w / 2);
            off += step;
        }
        g.fill();
    }

    /** 只有一圈描边的牌（提示用：玉青圈） */
    private ringTiles(ts: Tile[], color: string, alpha: number, lineW: number): void {
        const g = this._ringDraw;
        g.clear();
        g.strokeColor = hex(color, alpha);
        g.lineWidth = lineW;
        const s = this._tile + px(1);
        for (const t of ts) {
            g.roundRect(this.cellX(t.c) - s / 2, this.cellY(t.r) - s / 2, s, s, px(CFG.BOARDGEO.REACH_R));
        }
        g.stroke();
    }

    /**
     * ★★ 「多选配对」的呼吸闪烁（2026-10-03 用户拍板）★★
     * 用户原话：「当一个格子与左/右/上/下的格子能满足[凑字]条件，**两个都可以消除的
     *   时候**，闪烁一下提示用户，**让用户来选择消除哪个配对**」。
     *
     * 【判据】某张牌**四方向紧邻**的、能与它配对的搭档 ≥ `FLASH_MIN_PARTNERS` ⇒
     *   它和这些搭档一起呼吸。
     *   · 用"紧邻"而不是 `lineClear`（允许隔着空格）：用户说的就是「左/右/上/下」；
     *     而且紧邻**必然**满足 `lineClear` ⇒ 一定能点消，不会出现"闪了却消不掉"；
     *   · 只有一个搭档时不闪：没有"选择"可言，闪了反而把注意力从唯一那一步引开。
     *
     * 【为什么是"盘面状态的持续表达"而不是一次性提示】
     * 消掉一对之后，原来的多选可能变成单选、别的格子可能新变成多选 —— 所以每次
     * 盘面变化都要重算（见各调用点），而不是玩家点一次才闪一下。
     * 用**呼吸**（而不是常亮）是为了和"拖动时那个实时预判金圈"区分开：
     * 那个是**结果预览**，这个是**待选**，两者的观感必须能一眼分开。
     *
     * 【为什么拖动时要收掉（见 onDown）】
     * 拖动中棋盘上已经有落点圈、连线和让位牌的淡金圈，再叠一层闪烁会糊成一片，
     * 玩家分不清哪个圈是"我现在要消的"。松手后再重算。
     */
    private refreshFlash(): void {
        this.clearFlash();
        if (this._finished || !this._flashDraw || !this._flashDraw.isValid) return;
        const centers: Array<{ t: Tile; ps: Tile[] }> = [];
        for (const t of this._board.allTiles()) {
            const ps = pairedNeighbors(this._board, this._pair, t);
            if (ps.length >= FLASH_MIN_PARTNERS) centers.push({ t, ps });
        }
        // ★ 可测入口：工具链的 `flash:` 动作靠这几行断言"闪的确实是
        //   '有两个以上紧邻搭档'的格子"。没有它，这条规则只能靠人在真机上
        //   碰运气撞到一个多选局面才能看见 —— 而"没看见"和"坏了"长得一模一样。
        // ★★ `seq=` 必须带上，它是这批样本的**盘面归属** ★★
        //   工装按"seq 等于最后一条 STATE 的 seq"来挑样本。只按"STATE 之后的行"
        //   挑会跨盘：洗牌那一路盘面整盘换位、但 `_seq` 不会自己变，
        //   于是旧盘的 FLASH 行会和新盘的一起被收进同一批，断言就该误报了。
        //   带上 seq 之后，"这批闪烁属于哪个盘面"是**日志里写死的**，不靠推断。
        // ⚠️ 只把**日志**放进 `LOG_STATE` 开关里，**不能**在那儿 return ——
        //    下面就是画圈的代码，提前 return 等于"非 debug 构建下闪烁整个不画"，
        //    而这类"只是不闪了"的坏法在真机上和"这个盘面本来没有多选"一样。
        const dbg = CFG.DEBUG.LOG_STATE;
        if (!centers.length) {
            if (dbg) log(`[Diag] FLASH seq=${this._seq} none`);
            return;
        }
        if (dbg) {
            for (const c of centers) {
                log(`[Diag] FLASH seq=${this._seq} 中心=${c.t.char}@${c.t.r},${c.t.c} 搭档数=${c.ps.length} `
                    + c.ps.map((p) => `${p.char}@${p.r},${p.c}`).join(' '));
            }
        }
        // 去重：同一张牌可能既是中心、又是别人的搭档
        const tiles: Tile[] = [];
        const seen = new Set<number>();
        for (const c of centers) {
            if (!seen.has(c.t.id)) { seen.add(c.t.id); tiles.push(c.t); }
            for (const p of c.ps) if (!seen.has(p.id)) { seen.add(p.id); tiles.push(p); }
        }
        const paint = (a: number): void => {
            const g = this._flashDraw;
            if (!g || !g.isValid) return;
            g.clear();
            g.strokeColor = hex(CFG.COLOR.HL_GOLD, Math.round(255 * a));
            g.lineWidth = px(2.6);
            const s = this._tile + px(2);
            for (const t of tiles) {
                g.roundRect(this.cellX(t.c) - s / 2, this.cellY(t.r) - s / 2, s, s,
                    px(CFG.BOARDGEO.REACH_R));
            }
            g.stroke();
        };
        paint(FLASH_HI);
        let phase = 0;
        const half = FLASH_STEPS / 2;
        this._flashId = this.interval(() => {
            phase = (phase + 1) % FLASH_STEPS;
            const k = phase < half ? phase / half : (FLASH_STEPS - phase) / half;
            paint(FLASH_HI - (FLASH_HI - FLASH_LO) * k);
        }, FLASH_MS_STEP);
    }

    /** 收掉闪烁（盘面要变 / 拖动开始 / 收局时必须调，否则会闪在已经消掉的格子上） */
    private clearFlash(): void {
        if (this._flashId) { this.clearInterval(this._flashId); this._flashId = 0; }
        if (this._flashDraw && this._flashDraw.isValid) this._flashDraw.clear();
    }

    private pulseTiles(ts: Tile[]): void {
        for (const t of ts) {
            const n = this.tileNode(t);
            if (!n || !n.isValid) continue;
            Tween.stopAllByTarget(n);
            tween(n)
                .to(0.16, { scale: new Vec3(1.12, 1.12, 1) })
                .to(0.16, { scale: new Vec3(1, 1, 1) })
                .delay(0.85)
                .to(0.16, { scale: new Vec3(1.12, 1.12, 1) })
                .to(0.16, { scale: new Vec3(1, 1, 1) })
                .start();
        }
    }

    /**
     * "被点名"的一挑：1 → 1.14 → 1，一下。
     *
     * 【为什么不复用 `pulseTiles`】
     * 那条是给**提示**用的：脉冲两下、中间还停 0.85s，让玩家看清"该和谁配"。
     * 用在"圈住赠品"这一下上，会把整段演出从 ~0.3s 拖到 1.5s，
     * 而后面的"撞掉"那一段还在等它 —— 玩家会觉得卡了一下。
     * 所以单开一条只有 0.13s 起跳 + `hold` 回落的短促版。
     *
     * ★ 必须 `Tween.stopAllByTarget` 先停：这两张牌可能刚被 `pulseTiles`
     *   提示过（玩家是照提示挪的），不停就会两条 tween 同时写 scale。
     */
    private bumpTiles(ts: Tile[], hold = 0.14): void {
        for (const t of ts) {
            const n = this.tileNode(t);
            if (!n || !n.isValid) continue;
            Tween.stopAllByTarget(n);
            n.setScale(1, 1, 1);
            tween(n)
                .to(0.13, { scale: new Vec3(1.14, 1.14, 1) }, { easing: 'quadOut' })
                .to(hold, { scale: new Vec3(1, 1, 1) }, { easing: 'sineOut' })
                .start();
        }
    }

    /**
     * 点击"点不动"的牌：**一下挤压 + 轻微左右晃**。
     *
     * 【为什么不直接用原来那条 shakeTile】
     * 原来只有位置抖动（±6px 平移），在"点击"这个场景下太吵 —— 牌像是被推了一把。
     * 点击的语义是"这张牌不参与这次操作"，挤压（scale 0.92 再弹回）读起来正好是
     * "按了一下、没按动"，位移只留 ±2px 做点缀。
     *
     * 【挤压与晃动必须写在同一条 tween 链里】
     * 两条独立 tween 同时改同一个节点，属性会互相覆盖；而 `Tween.stopAllByTarget`
     * 又只能停"后启动的那条把先启动的顶掉"。合成一条链就没有这个问题。
     */
    private rejectTile(t: Tile): void {
        // ★ 声音挂在这里（而不是每个调用点各写一次）——
        //   三个入口（点击无搭档 / 干扰牌 / 整张牌被堵死）语义相同，
        //   散着写必然会有一次漏掉，而"漏掉的那一次不响"是查不出来的。
        AudioService.play('reject');
        const n = this.tileNode(t);
        if (!n || !n.isValid) return;
        Tween.stopAllByTarget(n);
        const x = this.cellX(t.c), y = this.cellY(t.r);
        const wob = px(2);
        tween(n)
            .to(TAP_PUNCH_MS, { scale: new Vec3(0.92, 0.92, 1) })
            .to(0.04, { position: new Vec3(x - wob, y, 0), scale: new Vec3(1.03, 1.03, 1) })
            .to(0.04, { position: new Vec3(x + wob, y, 0) })
            .to(0.05, { position: new Vec3(x, y, 0), scale: new Vec3(1, 1, 1) },
                { easing: 'sineOut' })
            .start();
    }

    /**
     * 棋盘微震（合成撞击时的一下）。
     *
     * 【为什么震"棋盘节点"而不是整个页面】
     *  ① 只震棋盘，视觉上就是"案几被撞了一下"，目标条 / 工具栏稳稳不动，
     *     不会读成"整个画面在抖"（那种廉价感到处都是）；
     *  ② 位移峰值只有 ±3 设计px、总时长 200ms，不构成眩晕风险。
     *
     * ⚠️ **棋盘节点位置会被 `toLocal()` 带进坐标换算**（它是牌的父节点），
     *   所以震动期间不要去解析触摸坐标。安全的原因是：撞击发生在 `_busy` 期间，
     *   而 `onDown` 在 `_busy` 时直接 return —— 这条依赖关系一旦被改掉，
     *   表现会是"震动那 200ms 里点到的格子整体偏 3px"。收尾必须精确回到位。
     */
    private shakeBoard(amp = IMPACT_SHAKE): void {
        const bn = this._boardNode;
        if (!bn || !bn.isValid) return;
        const by = this.boardCy;
        const a = px(amp);
        Tween.stopAllByTarget(bn);
        tween(bn)
            .to(0.035, { position: new Vec3(a, by - a * 0.6, 0) })
            .to(0.035, { position: new Vec3(-a, by + a * 0.6, 0) })
            .to(0.045, { position: new Vec3(a * 0.4, by - a * 0.25, 0) })
            .to(0.085, { position: new Vec3(0, by, 0) }, { easing: 'sineOut' })
            .call(() => { if (bn.isValid) bn.setPosition(0, by, 0); })
            .start();
    }

    /**
     * 在棋盘局部坐标 (x, y) 处放一圈扩散波纹（圆角方环，由小放大、边淡出）。
     * 点击的"叮"和合成时的"撞击环"都用它，只是参数不同。
     *
     * 【为什么一个波纹一个节点，而不是共用一个 Graphics】
     * 每个波纹的尺寸/透明度都不同步，共用就得每帧把全部波纹重画一遍、
     * 还要为每个存一份进度。同期的波纹最多 1~2 个，多一两个 draw call
     * 换实现的直白，是划算的。节点在动画结束时自己 destroy。
     *
     * 【为什么用 tween 代理对象 + onUpdate，而不是 tween 一个节点属性】
     * 形状要每帧重画（Graphics 不会插值）。tween 一个 `{k: 0→1}` 的普通对象、
     * 在 onUpdate 里按 k 重画，是 Graphics 做程序化动画的标准写法。
     */
    private rippleAt(x: number, y: number, color: string, alpha: number,
                     from: number, to: number, ms: number): void {
        if (!this._rippleLayer || !this._rippleLayer.isValid) return;
        const s = this._tile;
        const n = mkNode('ripple', this._rippleLayer, s, s);
        setPos(n, x, y);
        const g = n.addComponent(Graphics);
        const r0 = px(CFG.BOARDGEO.REACH_R);
        const st = { k: 0 };
        tween(st)
            .to(ms, { k: 1 }, {
                easing: 'quadOut',
                onUpdate: () => {
                    if (!n.isValid) return;
                    const k = st.k;
                    const side = s * (from + (to - from) * k);
                    g.clear();
                    g.strokeColor = hex(color, Math.max(0, Math.round(alpha * (1 - k))));
                    g.lineWidth = Math.max(1, px(2.5) * (1 - k * 0.55));
                    g.roundRect(-side / 2, -side / 2, side, side,
                        r0 * (from + (to - from) * k));
                    g.stroke();
                },
            })
            .call(() => { if (n.isValid) n.destroy(); })
            .start();
    }

    /**
     * 目标 chip 刚好凑满时脉冲一次。
     * 只动 chip 根节点的 scale —— 它的面/边是 Graphics 画的（由 paintChip 重画），
     * 缩放不碰那两个 Graphics，所以"金底重绘"和"脉冲动画"不会互相干扰。
     */
    private pulseChip(word: string): void {
        const chip = this._chips.get(word);
        if (!chip || !chip.root || !chip.root.isValid) return;
        Tween.stopAllByTarget(chip.root);
        chip.root.setScale(1, 1, 1);
        tween(chip.root)
            .to(0.12, { scale: new Vec3(1.18, 1.18, 1) }, { easing: 'backOut' })
            .to(0.2, { scale: new Vec3(1, 1, 1) }, { easing: 'sineOut' })
            .start();
    }

    // ============================================================
    //  已成字条（拆法展示，不剧透未合成字）
    // ============================================================
    private buildMadeStrip(): void {
        const W = this._visW, H = this._visH, C = CFG.COLOR;
        const stripW = W - 2 * MADE_MX;
        const top = H - BAR_H - MADE_MB - MADE_H;

        const box = mkNode('made', this._root, stripW, MADE_H);
        // ★ 减 _contentTop = 整条**上移**（三段一起挪，见 CONTENT_SHARE）
        setPos(box, 0, topY(H, top + MADE_H / 2 - this._contentTop));
        // 面：半透明白底（`.made-strip{background:rgba(255,255,255,.5)}`）
        mkFace(box, stripW, MADE_H, MADE_R, C.SURFACE, C.SURFACE_A_STRIP);
        // 1px 内描边：设计稿用 `inset 0 0 0 1px` 画在**内侧**，
        // 所以这里把边框画得比条宽小 1px，视觉上正好贴在内沿。
        mkEdge(box, stripW - px(1), MADE_H - px(1), MADE_R, C.EDGE, C.EDGE_A_STRIP, 2);

        // 内容区：左右各让出 9px（设计稿 `padding:0 9px`）
        this._madeInnerW = stripW - 2 * MADE_PAD;
        this._madeLayer = mkNode('made-inner', box, this._madeInnerW, MADE_H);
        setPos(this._madeLayer, 0, 0);
    }

    /**
     * 重画已成字条（设计稿 `renderMade()`）。
     *   · 一个都没合出来 → 两行说明，第 1 行的「本行或本列」是朱砂强调
     *   · 否则每个已合出的字做一张小卡：`偏旁 ＋ 部件 ＝ 字`
     *
     * 【卡片放不下时怎么办 —— 这里和设计稿的唯一差别，说明清楚】
     * 设计稿是 `overflow-x:auto`（并隐藏滚动条），手指左右拖能看全。
     * 本工程**不做横向滚动**，而是"窗口跟着最新的一张走"：
     * 从最近合出的字往前数，装满一条就停，左对齐铺开。
     * 理由：① 免掉遮罩裁剪这一层（Graphics 遮罩在微信端是额外的 stencil pass，
     *          而这条子只是"教学卡片"，不值得为它引一个渲染特性）；
     *       ② 刚合出的那个字必须在视野内，否则"教学"就白做了 ——
     *          自动滚到最右与"窗口跟最新走"是同一个效果，但后者没有滚动状态要维护。
     * 4 字的关卡里一条正好放得下 2 张（4 字卡总宽 513 > 内宽 326），
     * 所以这项差别只影响"同时看得到几张"，不影响任何颜色与排版。
     */
    private renderMade(): void {
        const C = CFG.COLOR;
        this._madeLayer.removeAllChildren();
        const got = this._runWords.filter((x) => x.got > 0);

        if (!got.length) {
            // 两行说明，垂直居中于条内（各行中心正好在 ±行高/2）
            mkRuns(this._madeLayer, [
                { t: '字牌只能沿', color: C.INK3 },
                { t: '本行或本列', color: C.RED, bold: true },
                { t: '滑动，遇到牌即停', color: C.INK3 },
            ], MS_EMPTY_S, MS_EMPTY_LH, MS_EMPTY_LH / 2, MS_EMPTY_LS);
            setPos(mkLabel(this._madeLayer, '把偏旁与部件挪到同一行或同一列（中间无挡）即可合成', {
                size: MS_EMPTY_S, color: C.INK3, font: 'hei', spacing: MS_EMPTY_LS,
                lineHeight: MS_EMPTY_LH,
            }).node, 0, -MS_EMPTY_LH / 2);
            return;
        }

        // 从最新的一张往前数，能装满几条就画几条（左对齐铺开）
        const cards = got.map((rw) => ({ w: rw.w, width: this.madeCardWidth() }));
        let take = 0;
        let used = 0;
        for (let i = cards.length - 1; i >= 0; i--) {
            const add = (take ? MADE_GAP : 0) + cards[i].width;
            if (take && used + add > this._madeInnerW) break;
            used += add;
            take++;
        }
        const shown = cards.slice(cards.length - take);
        let x = -this._madeInnerW / 2;
        for (const c of shown) {
            this.buildMadeCard(c.w, x + c.width / 2);
            x += c.width + MADE_GAP;
        }
    }

    /** 一张小卡的宽度：2×内距 + 3 块 + 2 个运算符 + 4 个 3px 间隙 */
    private madeCardWidth(): number {
        const opW = Math.max(estWidth('＋', MS_OP_S), estWidth('＝', MS_OP_S));
        return MS_CARD_PAD * 2 + MS_P * 3 + opW * 2 + MS_IGAP * 4;
    }

    private buildMadeCard(word: string, cx: number): void {
        const C = CFG.COLOR;
        const w = this.madeCardWidth();
        const h = MS_CARD_PAD * 2 + MS_P;
        // ★ holder / face 要分开：Cocos 先把节点**自身**的渲染组件画完，再画子节点。
        //   我第一版把卡的渐变底画在 holder 自己身上、shadow 挂成它的子节点 ——
        //   于是 shadow 反过来盖住了卡面，`#FFFDF6` 被那层 20% 的金褐影子压暗。
        //   （和棋盘那处是同一个坑：**影子必须真的是最底层**。）
        const holder = mkNode('ms-card', this._madeLayer, w, h);
        setPos(holder, cx, 0);
        // 金渐变底 + 金描边（`.ms-card{background:linear-gradient(160deg,#FFFDF6,#F7EBD2);
        //                            box-shadow:0 2px 7px rgba(200,160,46,.2),0 0 0 1px rgba(200,160,46,.4)}`）
        setPos(mkShadow(holder, w, h, MS_CARD_R, -px(2), px(2), C.DONE_EDGE, 51), 0, 0);
        const face = mkNode('ms-card-face', holder, w, h);
        const g = face.addComponent(Graphics);
        const a = hex(C.DONE_A), b = hex(C.DONE_B);
        const BANDS = 10, bh = h / BANDS;
        for (let i = 0; i < BANDS; i++) {
            const t = (i + 0.5) / BANDS;
            g.fillColor = new Color(
                Math.round(a.r + (b.r - a.r) * t),
                Math.round(a.g + (b.g - a.g) * t),
                Math.round(a.b + (b.b - a.b) * t), 255);
            g.roundRect(-w / 2, h / 2 - (i + 1) * bh, w, bh + 1, MS_CARD_R);
            g.fill();
        }
        g.strokeColor = hex(C.DONE_EDGE, 102);
        g.lineWidth = 2;
        g.roundRect(-w / 2, -h / 2, w, h, MS_CARD_R);
        g.stroke();

        const s = WORDS[word];
        const opW = Math.max(estWidth('＋', MS_OP_S), estWidth('＝', MS_OP_S));
        let x = -w / 2 + MS_CARD_PAD;
        this.buildMadePiece(holder, x + MS_P / 2, 'r', s.a, MS_P_S);
        x += MS_P + MS_IGAP;
        setPos(mkLabel(holder, '＋', {
            size: MS_OP_S, color: C.INK3, font: 'hei',
        }).node, x + opW / 2, 0);
        x += opW + MS_IGAP;
        this.buildMadePiece(holder, x + MS_P / 2, 'p', s.b, MS_P_S);
        x += MS_P + MS_IGAP;
        setPos(mkLabel(holder, '＝', {
            size: MS_OP_S, color: C.INK3, font: 'hei',
        }).node, x + opW / 2, 0);
        x += opW + MS_IGAP;
        this.buildMadePiece(holder, x + MS_P / 2, 'w', word, MS_P_W_S);
    }

    private buildMadePiece(parent: Node, cx: number, kind: 'r' | 'p' | 'w',
                           ch: string, size: number): void {
        const C = CFG.COLOR;
        const pal = kind === 'r'
            ? { a: C.PIECE_R_A, b: C.PIECE_R_B, tx: C.PIECE_R_TX }
            : kind === 'p'
                ? { a: C.PIECE_P_A, b: C.PIECE_P_B, tx: C.PIECE_P_TX }
                : { a: C.PIECE_W_A, b: C.PIECE_W_B, tx: C.PIECE_W_TX };
        const n = mkNode('ms-p', parent, MS_P, MS_P);
        setPos(n, cx, 0);
        const g = n.addComponent(Graphics);
        const ca = hex(pal.a), cb = hex(pal.b);
        const BANDS = 8, bh = MS_P / BANDS;
        for (let i = 0; i < BANDS; i++) {
            const t = (i + 0.5) / BANDS;
            g.fillColor = new Color(
                Math.round(ca.r + (cb.r - ca.r) * t),
                Math.round(ca.g + (cb.g - ca.g) * t),
                Math.round(ca.b + (cb.b - ca.b) * t), 255);
            g.roundRect(-MS_P / 2, MS_P / 2 - (i + 1) * bh, MS_P, bh + 1, MS_P_R);
            g.fill();
        }
        setPos(mkLabel(n, ch, {
            size, color: pal.tx, bold: true, font: 'kai', lineHeight: MS_P,
        }).node, 0, 0);
    }

    // ============================================================
    //  工具条
    // ============================================================
    private buildTools(): void {
        const H = this._visH, W = this._visW;
        const top = H - BAR_H;
        // ★ 2026-10-03：从 3 格改成 **4 格**（用户拍板"道具更换成四个种类"）。
        //   宽度按 4 等分重算 —— 这一步不能漏，否则第 4 个道具会画到屏幕外
        //   （Cocos 不会报错，只是看不见，很容易被当成"没加成功"）。
        const w = (W - 2 * TOOL_PAD_X - 2 * TOOL_GAP) / TOOL_COUNT;
        this._toolW = w;
        const y = topY(H, top + TOOL_PAD_T + TOOL_H / 2 - this._contentTop);
        const x0 = -W / 2 + TOOL_PAD_X + w / 2;

        const items: Array<{ key: ToolKey; label: string; onTap: () => void }> = [
            { key: 'hint', label: '提示', onTap: () => this.useHint() },
            { key: 'bomb', label: '消除', onTap: () => this.useBomb() },
            { key: 'shuffle', label: '洗牌', onTap: () => this.useShuffle(false) },
            { key: 'time', label: '延长时间', onTap: () => this.useTime() },
        ];
        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            const root = mkNode('tool', this._root, w, TOOL_H);
            setPos(root, x0 + i * (w + TOOL_GAP), y);
            const glow = this.paintTool(root, w, TOOL_H);
            // 内容：数字在上、标签在下，整体居中
            const contentH = TOOL_B_LH + TOOL_IGAP + TOOL_LBL_LH;
            const cTop = contentH / 2;
            const num = mkLabel(root, '0', {
                size: TOOL_B_S, color: CFG.COLOR.RED, bold: true, font: 'kai', lineHeight: TOOL_B_LH,
            });
            setPos(num.node, 0, cTop - TOOL_B_LH / 2);
            setPos(mkLabel(root, it.label, {
                size: TOOL_LBL_S, color: CFG.COLOR.TILE_TX, font: 'hei',
                spacing: TOOL_LBL_LS, lineHeight: TOOL_LBL_LH,
            }).node, 0, cTop - TOOL_B_LH - TOOL_IGAP - TOOL_LBL_LH / 2);
            const op = root.addComponent(UIOpacity);
            op.opacity = 255;
            this._tools[it.key] = { root, num, op, glow };
            pressable(root, it.onTap, this);
        }
    }

    /**
     * `.tool`：半透明白底 + 米边 + 圆角 14 + 轻投影（`0 2px 6px rgba(120,100,60,.1)`）。
     * 另外挂一层**光晕**（`.tool.glow` 的 `0 2px 14px rgba(200,160,46,.75)`），
     * 平时透明、死局时由 glowShuffle() 点起来 —— 见它的注释。
     */
    private paintTool(root: Node, w: number, h: number): Graphics {
        const C = CFG.COLOR;
        // 光晕（先建 → 压在最底层；只有一圈金环，靠 alpha 开关）
        const glow = mkNode('glow', root, w, h).addComponent(Graphics);
        glow.strokeColor = new Color(hex(C.DONE_EDGE).r, hex(C.DONE_EDGE).g, hex(C.DONE_EDGE).b, 0);
        glow.lineWidth = px(4);
        glow.roundRect(-w / 2 - px(2), -h / 2 - px(2), w + px(4), h + px(4), TOOL_R + px(2));
        glow.stroke();

        setPos(mkShadow(root, w, h, TOOL_R, -px(2), px(1), C.SHADOW,
            Math.round(255 * 0.1)), 0, 0);

        const face = mkNode('face', root, w, h);
        const g = face.addComponent(Graphics);
        g.fillColor = hex(C.SURFACE, C.SURFACE_A_SOFT);
        g.roundRect(-w / 2, -h / 2, w, h, TOOL_R);
        g.fill();
        g.strokeColor = hex(C.EDGE, C.EDGE_A_TOOL);
        g.lineWidth = 2;
        g.roundRect(-w / 2, -h / 2, w, h, TOOL_R);
        g.stroke();
        return glow;
    }

    private renderTools(): void {
        const set = (v: ToolBtn | null, n: number): void => {
            if (!v) return;
            v.num.string = `${n}`;
            v.op.opacity = n > 0 ? 255 : TOOL_OFF_ALPHA;
        };
        set(this._tools.hint, this._hintLeft);
        set(this._tools.bomb, this._bombLeft);
        set(this._tools.shuffle, this._shuffleLeft);
        set(this._tools.time, this._timeLeft);
    }

    /**
     * 洗牌按钮的金色光晕（`.tool.glow{animation:toolglow 1.6s infinite}`）。
     * 只在"场上没有可立即凑成的挪法、但洗牌还有次数"时亮起来 ——
     * 这时玩家最需要被指路，而设计稿把选择权留给了玩家（不自动消费道具），
     * 所以用光晕说"点我"，而不是替玩家花掉那一次洗牌。
     */
    private glowShuffle(on: boolean): void {
        const t = this._tools.shuffle;
        if (!t || !t.glow || !t.glow.isValid) return;
        const base = hex(CFG.COLOR.DONE_EDGE);
        const paint = (a: number): void => {
            const g = t.glow;
            g.clear();
            g.strokeColor = new Color(base.r, base.g, base.b, Math.round(255 * a));
            g.lineWidth = px(4);
            g.roundRect(-this._toolW / 2 - px(2), -TOOL_H / 2 - px(2),
                this._toolW + px(4), TOOL_H + px(4), TOOL_R + px(2));
            g.stroke();
        };
        if (this._glowId) { this.clearInterval(this._glowId); this._glowId = 0; }
        if (!on) { paint(0); return; }
        let phase = 0;
        paint(0.75);
        // `.toolglow` 只在 50% 处加深，所以是一个 1.6s 的往返，不是闪烁
        this._glowId = this.interval(() => {
            phase = (phase + 1) % 8;
            paint(0.75 - 0.35 * (phase < 4 ? phase / 4 : (8 - phase) / 4));
        }, 200);
    }

    private _glowId = 0;
    private _toolW = 0;

    private toast(msg: string): void {
        if (this._toast) this._toast.show(msg);
    }

    // ============================================================
    //  倒计时
    // ============================================================
    /**
     * 起表。
     * @param seconds 覆盖本关限时（秒）。**只给"看视频复活"用** —— 复活时把 deadline
     *                重置成 `now + 30s`，而不是把整关时间还给玩家。
     *                省略时按本关的 `lv.time`，与原行为一致。
     */
    private startTimer(seconds?: number): void {
        const sec = seconds && seconds > 0 ? seconds : this._timeLimit;
        this._deadline = Date.now() + sec * 1000;
        if (this._tickId) this.clearInterval(this._tickId);
        this.updateTimerLabel();
        this._tickId = this.interval(() => {
            this.updateTimerLabel();
            if (Date.now() >= this._deadline) {
                this.clearInterval(this._tickId);
                this.finishFail();
            }
        }, 150);
    }

    private updateTimerLabel(): void {
        const left = Math.max(0, (this._deadline - Date.now()) / 1000);
        if (!this._timerLb || !this._timerLb.isValid) return;
        this._timerLb.string = fmt(left);
        const warn = left <= CFG.GAME.TIME_WARN_SEC;
        this._timerLb.color = hex(warn ? CFG.COLOR.RED : CFG.COLOR.JADE);
        if (warn && !this._blinkId) {
            // `.timer.warn{animation:blink .85s infinite}` —— 50% 时 opacity:.3
            this._blinkId = this.interval(() => {
                if (!this._timerOp || !this._timerOp.isValid) return;
                this._timerOp.opacity = this._timerOp.opacity > 150 ? 76 : 255;
            }, BLINK_MS);
        } else if (!warn && this._blinkId) {
            this.clearInterval(this._blinkId);
            this._blinkId = 0;
            this._timerOp.opacity = 255;
        }
    }

    // ============================================================
    //  胜负
    // ============================================================
    private finishClear(): void {
        if (this._finished) return;
        this._finished = true;
        this._busy = true;
        this.clearInterval(this._tickId);
        // 收局必须收掉「多选配对」的呼吸闪烁：它的 interval 不会自己停，
        // 结算页/弹层背后会一直有一圈金边在呼吸（且画在马上要被销毁的牌上）。
        this.clearFlash();
        const left = Math.max(0, (this._deadline - Date.now()) / 1000);
        const ratio = left / this._lv.time;
        // ★ 星级只看剩余时间比例（与原型口径一致）：>50% 三星，>20% 两星，其余一星
        const stars = ratio > 0.5 ? 3 : (ratio > 0.2 ? 2 : 1);
        const runWords = this._runWords.map((x) => ({ ...x }));
        const res: ResultParam = {
            win: true, level: this._lv.n,
            leftSec: Math.round(left), totalSec: this._lv.time,
            stars, moves: this._moves,
            words: this._madeWords.length,
            runWords, leftWords: 0,
        };
        Save.recordClear({
            level: this._lv.n, leftSec: res.leftSec, totalSec: this._lv.time,
            stars, moves: res.moves, words: res.words, runWords,
        });
        log(`[GamePage] L${this._lv.n} 通关：${stars} 星，用时 ${Math.round(this._lv.time - left)}s，挪了 ${this._moves} 步`);
        this.diag('通关');

        // ---- 通关动效：金色涟漪荡开 + 棋盘"收势" ----
        //   ★ 为什么是"荡开"而不是"炸开"：这一页的材质是纸 + 墨 + 木，
        //     任何带爆炸/粒子感的东西都会跳出这个体系。两圈错开的涟漪最像
        //     "墨滴落在宣纸上化开"，同时它有明确的**方向性**（由内向外 = 收束完成）。
        AudioService.play('win');
        this.rippleAt(0, 0, CFG.COLOR.GOLD_L, 255, 0.45, WIN_RING_TO, WIN_RING_MS);
        this.timer(() => {
            if (this._finished) this.rippleAt(0, 0, CFG.COLOR.GOLD, 220, 0.35, 2.6, WIN_RING_MS);
        }, 150);
        const bn = this._boardNode;
        if (bn && bn.isValid) {
            Tween.stopAllByTarget(bn);
            tween(bn)
                .to(0.18, { scale: new Vec3(1.045, 1.045, 1) }, { easing: 'quadOut' })
                .to(0.34, { scale: new Vec3(1, 1, 1) }, { easing: 'sineOut' })
                .call(() => { if (bn.isValid) bn.setScale(1, 1, 1); })
                .start();
        }

        this.timer(() => PageManager.goto(PAGE_CLEAR, res), 700);
    }

    /**
     * 时间到。
     *
     * ★★ 2026-10-02 改：**不再切到独立的失败页，改成对局页内的弹层** ★★
     *   原来的写法是 `PageManager.goto(PAGE_FAIL, res)` —— 而 `fail` 从来没被注册过
     *   （`registerPages` 只有 boot/home/chap/map/game），于是这里和 `finishClear`
     *   一样石沉大海：`_finished/_busy` 已置位 → 页面冻死，玩家看着倒计时归零却什么都没发生。
     *
     *   顺带这也是**唯一能把「看视频复活」做对**的形态：独立页会在切页时
     *   `destroy()` 掉整棵对局节点，盘面（每个格、每张牌的 r/c、已成字、步数）
     *   随之消失；弹层则原地保留，复活只需把 deadline 往后推。
     *   详见 ui/FailGate.ts 的文件头。
     */
    private finishFail(): void {
        if (this._finished) return;
        this._finished = true;
        this._busy = true;
        this.clearInterval(this._tickId);
        // 同上：失败弹层背后不能还留着一圈在呼吸的金边。
        this.clearFlash();
        // 顺带收掉"时间将尽"的闪烁，否则弹层背后会一直闪
        if (this._blinkId) {
            this.clearInterval(this._blinkId);
            this._blinkId = 0;
            if (this._timerOp && this._timerOp.isValid) this._timerOp.opacity = 255;
        }
        this.updateTimerLabel();

        const left = this._board.remainingPlayable();
        log(`[GamePage] L${this._lv.n} 时间到：还剩 ${left} 张牌未合，成字 ${this._madeWords.length}`);
        this.diag('失败');

        // ---- 超时动效：墨色涟漪向内收束 + 一记更重的震 ----
        //   ★ 与通关**刻意相反**：通关是金色、向外荡开；超时是墨色、幅度更小、
        //     再配一记比合成撞击重一倍的下沉式震动 —— 读作"盘面塌了"，
        //     而不是"又撞了一下"。两者共用 rippleAt / shakeBoard，
        //     参数不同，玩家不需要学两套语言。
        AudioService.play('fail');
        this.rippleAt(0, 0, CFG.COLOR.INK2, 210, 1.5, FAIL_RING_TO, FAIL_RING_MS);
        this.shakeBoard(FAIL_SHAKE);

        if (!this._failGate || !this._failGate.visible) {
            this._failGate.show(
                { words: this._madeWords.length, left },
                () => this.onReviveAd(),
                () => this.restartLevel(),
                () => PageManager.goto(PAGE_MAP));
        }
    }

    /**
     * 「看视频复活」：拉起激励视频，**看完了才加时**。
     * 四种结果与死局重排一致（rewarded 加成 / degraded 降级也加成 / closed、error 留在弹层上再试）。
     */
    private onReviveAd(): void {
        if (!this._failGate || !this._failGate.visible) return;
        this._failGate.setBusy('广告加载中…');
        log('[GamePage] 请求激励视频（复活 +30 秒）');

        AdService.showReward((r) => {
            // 广告期间玩家可能已经点了「返回地图」→ 节点已销毁，什么都别做
            if (!this._root || !this._root.isValid) return;
            if (r === 'closed' || r === 'error') {
                this._failGate.setBusy(null);
                log(`[GamePage] 复活广告未完成（${r}），留在弹层上可再试`);
                this.toast('广告没看完\n可以再试一次');
                return;
            }

            this._failGate.hide();
            const add = CFG.GAME.REVIVE_SEC;
            // ★ 盘面一个字节都没动过 —— 这就是"原地复活"成立的原因
            this._finished = false;
            this._busy = false;
            this.startTimer(add);
            AudioService.play('revive');
            log(`[GamePage] 复活成功：时间 +${add} 秒，盘面剩余 ${this._board.remainingPlayable()} 张牌`);
            // ★ 玩家可见文案**不提广告**（2026-10-02 拍板）。
            //   过去降级时会在第二行补一句"广告位没接入"的说明 —— 那是给
            //   debug 期的人看的，不是给玩家看的，已删。开发者提醒见 AdService.audit()。
            this.toast(`复活成功，时间 +${add} 秒`);
            this.diag('复活');
            // ★ 复活 = 重新开局（盘面一字未动，但 `finishFail` 已经把闪烁停掉了）。
            //   不补这一句，玩家复活后就再也看不到"多选配对"的提示，直到他动一次手 ——
            //   而这恰恰是他最需要它的时候（时间刚被补上，正在重新找路）。
            this.refreshFlash();
        });
    }

    /** 「重来一局」：同一关重开（新盘面） */
    private restartLevel(): void {
        log(`[GamePage] 重来一局 → L${this._lv.n}`);
        PageManager.goto(PAGE_GAME, { level: this._lv.n });
    }

    // ============================================================
    //  死局兜底 / 工具
    // ============================================================
    /**
     * 卡住检测（原型 checkDeadlock 原式）。
     * ★ 判据必须是"玩家真的做得到"（Board.findSuggest 只从 reachableCells 里找），
     *   否则会把"还有解"误判成卡住、把玩家的路直接堵掉。
     *
     * 【这一版和上一版的区别：不再有"免费重排"兜底】
     * 上一版是「洗牌还有次数 → 闪洗牌按钮；洗牌也用尽 → 免费重排一次」。
     * 玩法改成严格回弹之后，卡住变成了**盘面自己会到的状态**（完整搜索的数据
     * 见 ui/AdService.ts）。免费重排等于把这条路白送掉，玩家既不会意识到
     * 还有「洗牌」这个道具，也永远不会看到广告 —— 兜底形同虚设。
     * 所以现在统一成：**卡住 → 弹「看广告重排」，不限次数**。
     *
     * 「洗牌」道具本身保留（在工具栏里），玩家主动想重排随时可以用。
     */
    private checkDeadlock(): void {
        if (this._finished || this._busy) return;
        if (this._adGate && this._adGate.visible) return;          // 已经弹着，别叠第二层
        if (this._board.hasDirectMatch(this._pair)) return;
        if (this._board.findSuggest(this._pair, this._rng)) return;

        log('[GamePage] 卡住：无可立即凑成的挪法 → 弹「看广告重排」');
        this.showDeadlockGate();
    }

    /** 弹「卡住了」的默认版式 */
    private showDeadlockGate(): void {
        this.openGate({
            title: '卡住了',
            lines: ['场上已经没有一步能凑成字了', '看一段广告，帮你把盘面重排一次'],
            actionText: '看广告重排',
            backText: '返回地图',
        });
    }

    /** 把弹层与两个回调接起来（重试用同一个入口，只换文案） */
    private openGate(opts: AdGateOpts): void {
        if (!this._adGate) return;      // 覆盖层还没挂（理论上不会，防御性）
        this._adGate.show(opts,
            () => this.onAdReward(),
            () => PageManager.goto(PAGE_MAP));
    }

    /**
     * 「看广告重排」被点击：拉一段激励视频，**看完了才重排**。
     *
     * 四种结果的处理：
     *   rewarded → 看完，重排（正常路径）
     *   degraded → 没接广告位（本地调试 / 首版还没申请），直接重排并说明
     *   closed   → 中途关掉，留在弹层上，允许再试（不惩罚，也不给奖励）
     *   error    → 拉取失败，同上
     */
    private onAdReward(): void {
        if (!this._adGate || !this._adGate.visible) return;
        this._adGate.setBusy('广告加载中…');
        log('[GamePage] 请求激励视频（看广告重排）');

        AdService.showReward((r) => {
            // 广告期间玩家可能已经返回地图 → 节点已销毁，什么都别做
            if (!this._adGate || !this._adGate.visible) return;
            this._adGate.setBusy(null);

            if (r === 'rewarded' || r === 'degraded') {
                this._adGate.hide();
                // ★ 降级（没配广告位）**不再给玩家弹任何提示**：
                //   过去这里弹一句 `CFG.AD.DEGRADED_TOAST`，内容是开发者文案
                //   （带变量名），而且同一 tick 就被下面 afterAdReshuffle 里的
                //   「盘面已重排」覆盖掉，玩家根本看不到 —— 一行既无用又外泄的死代码。
                //   结果本身已经说清楚了，开发者提醒走 AdService.audit() 的启动期 error。
                this.afterAdReshuffle();
                return;
            }

            const title = r === 'closed' ? '广告没看完' : '广告没加载出来';
            this.openGate({
                title,
                lines: ['需要看完整段广告', '才能帮你把盘面重排一次'],
                actionText: '再试一次',
                backText: '返回地图',
            });
        });
    }

    /**
     * 重排盘面并收尾。
     * ★ 重排**可能仍然无解**（比如剩下的牌在两两之间全被堵死）。
     *   这时不能把玩家丢在弹层外面 —— 必须把弹层重新立起来，否则他真的无路可走。
     */
    private afterAdReshuffle(): void {
        const ok = this.reshuffleRemaining();
        // 「看广告换来的奖励兑现了」。放在重排**之后**：先有声再看到盘面变化
        // 会读成"奖励先来了"，顺序反了会显得廉价。
        AudioService.play('reward');
        log(`[GamePage] 看广告重排 → ${ok ? '有解' : '仍无解'}`);
        if (ok) {
            this.toast('盘面已重排');
            return;
        }
        this.toast('重排后仍然无解');
        this.openGate({
            title: '还是走不动',
            lines: ['重排后依然没有能凑成的字', '可以再重排一次，或先返回地图'],
            actionText: '再看一次广告',
            backText: '返回地图',
        });
    }


    /**
     * 把剩下的牌重排一遍（格子位置不动、牌换位）。
     *
     * ★ 判据是「**整盘可解**」，不是「至少有一对能消」（2026-10-03 用户拍板方案 A）
     *   区别不在精度，在**承诺**：这是「看广告重排」的兑现环节。
     *   旧判据是 `hasDirectMatch || findSuggest` —— 只保证"现在能动一下"：
     *   玩家消掉那一对之后照样可能是死局，于是又被弹回弹层、再看一次广告。
     *   他按下按钮时读到的是"盘面已重排"，心里记下的是"这下能走通了"，两回事。
     *
     * ★ 判定逻辑**不在本文件**，在 `core/Solver.ts` —— 与 `tools/solve-exact.js`
     *   的离线逐关判定调用**同一个函数**。一套规则写两遍的下场，
     *   上一版原型已经演示过一次（提示给出的走法玩家拖不过去）。
     *
     * ★ 三个结果各自怎么处理（运行期给不起离线那样的算力，见上面的预算常量）：
     *     YES     —— 拿到一条完整走法（贪心撞上）或 DFS 证明了有解 → 就用这个盘面
     *     NO      —— DFS 穷尽，**这是唯一的"真的走不动"证据** → 换下一个顺序
     *     UNKNOWN —— 只跑了便宜档（或 DFS 撞预算）。**没能证明 ≠ 证明不能**，
     *                所以不把它当无解：先记下这个盘面，继续换顺序。
     *   30 个顺序都没 YES 时，**回退到第一个 UNKNOWN 的盘面**并放行 ——
     *   "没能证明可解"不等于"走不动"，而盘面**已经被重排过了**；
     *   把玩家丢回弹层逼他再看一次广告，比放行更糟。
     *   只有 30 个顺序全被 DFS 穷尽证伪（真死局）才返回 false。
     *
     * @returns 重排后是否可解（有证据，或无法反驳）
     */
    private reshuffleRemaining(): boolean {
        // ★ 整盘牌要换位 ⇒ 先把闪烁收掉。
        //   不在这里收的话，那一圈金边会按**旧牌序**的位置继续画，
        //   而它的位置取自 `t.cellX(t.c)` —— 重排后那些都成了别人的格子，
        //   表现是"金框飘在几张不相干的牌上"，比不闪还容易误读。
        //   新闪烁在下面的成功分支里按新盘面重算（两个 return true 都要覆盖）。
        this.clearFlash();
        const tiles = this._board.allTiles();
        const spots = tiles.map((t) => ({ r: t.r, c: t.c }));
        // 整轮共享一个 DFS 窗口：活得比这久，玩家点一下就要卡住
        const dfsDeadline = Date.now() + RESHUFFLE_DFS_MS;
        let fallback: Tile[] | null = null;   // 第一个"没被证伪"的盘面（牌序）

        /**
         * 收尾：给**重排后的新盘面**补一份诊断快照，再按它重算闪烁。
         *
         * ★ 为什么要在这里补 `diag()`：重排是**盘面变化**，但它以前一条 `[Diag]`
         *   都不打 —— 于是日志里最后一份 BOARD/TILES/STATE 还是重排**之前**的。
         *   两个后果：① 事后回放看不到"重排后到底长什么样"（一手证据缺失）；
         *   ② `refreshFlash()` 必须报 `seq=`，而这个 seq 就取自最近一次 diag()，
         *      不补这一下，新盘的 FLASH 行会顶着**旧盘的 seq**，工装的
         *      `flash:` 断言据此把两盘的样本混成一批。
         *   所以这一句同时修掉"证据缺失"和"样本串盘"两件事，不是为测试加的。
         */
        const settle = (): void => {
            this.diag('洗牌');
            this.refreshFlash();
        };

        const layout = (order: Tile[]): void => {
            for (const t of tiles) this._board.removeAt(t);
            for (let i = 0; i < order.length; i++) {
                this._board.setCell(spots[i].r, spots[i].c, order[i]);
            }
            for (const t of order) this.snapTile(t);
        };

        for (let attempt = 0; attempt < RESHUFFLE_TRIES; attempt++) {
            const order = this._rng.shuffled(tiles);
            layout(order);

            // DFS 只在窗口内跑；窗口外 budget 传 0，内核据此**只跑便宜档**
            // （而不是"跑一个 0 节点的搜索然后说无解"，见 solvableInPlace 的注释）
            const inWindow = Date.now() < dfsDeadline;
            const v = solvableInPlace(this._board, this._pair, this._rng, {
                tries: RESHUFFLE_GREEDY_TRIES,
                budget: inWindow ? RESHUFFLE_DFS_NODES : 0,
                boardDeadline: dfsDeadline,
            });

            if (v.verdict === 'YES') {
                log(`[GamePage] 重排第 ${attempt + 1} 轮 → 可解（${v.via}，${v.steps} 手）`);
                settle();
                return true;
            }
            if (v.verdict === 'NO') {
                log(`[GamePage] 重排第 ${attempt + 1} 轮 → 确证无解，换顺序再来`);
                continue;
            }
            if (!fallback) fallback = order.slice();
            log(`[GamePage] 重排第 ${attempt + 1} 轮 → 判定未完成（via=${v.via}），先记下这个盘面`);
        }

        if (fallback) {
            // 见函数头：没能证明可解 ≠ 走不动。收下一个"没被证伪"的盘面。
            layout(fallback);
            log(`[GamePage] 重排 ${RESHUFFLE_TRIES} 轮都没能证明可解，回退到第一个未证伪的盘面并放行`);
            settle();
            return true;
        }
        // ★ 返回 false（30 个顺序全被证伪）时盘面**也已经换过位**了 ——
        //   最后一次 `layout()` 的结果留在棋盘上，所以快照与闪烁一样要补，
        //   否则玩家接下来看到的是一盘"日志里不存在"的牌，闪烁也停在上一盘。
        settle();
        return false;
    }

    /**
     * 提示。
     * 设计稿优先提示「**已经对齐、点一下就能消**」的那一对（正反馈最强），
     * 没有才退回 findSuggest。
     */
    private useHint(): void {
        if (this._busy || this._finished) return;
        if (this._hintLeft <= 0) { this.toast('提示用完了'); return; }

        const ts = this._board.allTiles();
        for (let i = 0; i < ts.length; i++) {
            for (let j = i + 1; j < ts.length; j++) {
                if (!this._pair.canPair(ts[i], ts[j])) continue;
                if (!this._board.lineClear(ts[i], ts[j])) continue;
                const a = ts[i], b = ts[j];
                const word = this._pair.word(a, b);
                this._hintLeft--;
                this.renderTools();
                AudioService.play('hint');
                this.pulseTiles([a, b]);
                this.ringTiles([a, b], CFG.COLOR.HL_JADE, CFG.COLOR.HL_JADE_A, px(2.5));
                this.drawLink(this._linkDraw, { r: a.r, c: a.c }, { r: b.r, c: b.c },
                    CFG.COLOR.LINK_JADE, CFG.COLOR.LINK_JADE_A);
                this.timer(() => {
                    if (this._linkDraw.isValid) this._linkDraw.clear();
                    if (this._ringDraw.isValid) this._ringDraw.clear();
                }, 1900);
                // ★ 宝牌对的 word 是空串 —— 不分开写就会发出「就能拼成「」」这种残句。
                const isTr = this._pair.isTreasurePair(a, b);
                this.toast(isTr
                    ? `两张「${a.char}」已经对齐了\n点一下就能凑成宝牌（还会额外消掉一对）`
                    : `「${a.char}」和「${b.char}」已经对齐了\n点一下就能拼成「${word}」`);
                log(`[GamePage] 提示（已对齐）：${a.char}+${b.char}${isTr ? '（宝牌）' : '=' + word}`);
                return;
            }
        }

        const s = this._board.findSuggest(this._pair, this._rng);
        if (!s) { this.toast('这局已经无可凑成的挪法了，试试洗牌'); return; }
        this._hintLeft--;
        this.renderTools();
        AudioService.play('hint');
        this.pulseTiles([s.tile]);
        // 目标格点亮 —— 与拖动时的「可滑动格」用同一套视觉，玩家一看就懂
        this.drawReach({ up: s.r, down: s.r, left: s.c, right: s.c }, s.r, s.c);
        this.ringTiles([s.hit], CFG.COLOR.HL_JADE, CFG.COLOR.HL_JADE_A, px(2.5));
        this.drawLink(this._linkDraw, { r: s.r, c: s.c }, { r: s.hit.r, c: s.hit.c },
            CFG.COLOR.LINK_JADE, CFG.COLOR.LINK_JADE_A);
        this.timer(() => {
            if (this._reachDraw.isValid) this._reachDraw.clear();
            if (this._linkDraw.isValid) this._linkDraw.clear();
            if (this._ringDraw.isValid) this._ringDraw.clear();
        }, 1800);
        const dir = s.r === s.tile.r ? '横行' : '竖列';
        // ★ 同上：这一步的落位可能是"凑宝牌"，那时 word 是空串。
        const trMove = this._pair.isTreasurePair(s.tile, s.hit);
        this.toast(trMove
            ? `把「${s.tile.char}」沿${dir}滑到亮起的格子\n即可凑成一对宝牌（额外再消掉一对）`
            : `把「${s.tile.char}」沿${dir}滑到亮起的格子\n即可与「${s.hit.char}」拼成「${this._pair.word(s.tile, s.hit)}」`);
        log(`[GamePage] 提示：${s.tile.char} → (${s.r},${s.c})，命中 ${s.hit.char}`
            + `${trMove ? '（宝牌）' : ''}`);
    }

    /** 洗牌。isFree = 死局兜底，不扣次数（原型 useShuffle 的同名参数） */
    private useShuffle(isFree: boolean): void {
        if (this._busy || this._finished) return;
        if (!isFree) {
            if (this._shuffleLeft <= 0) { this.toast('洗牌用完了'); return; }
            this._shuffleLeft--;
        }
        this.glowShuffle(false);
        this.renderTools();
        AudioService.play('shuffle');
        const ok = this.reshuffleRemaining();
        this.toast(ok ? '盘面已重排' : '重排后仍无解，这盘确实走不动了');
        log(`[GamePage] 洗牌（${isFree ? '死局兜底' : '玩家使用'}）→ ${ok ? '有解' : '仍无解'}`);
        this.timer(() => this.checkDeadlock(), 400);
    }

    /**
     * 「消除」：**无视滑动限制**，直接把场上任意一对可合成的牌合掉。
     * （2026-10-03 之前玩家看到的标签是「凑对」，用户拍板改名；效果一字未动。）
     *
     * 这是四个道具里唯一"改规则"的那个 —— 提示 / 洗牌 / 延长时间都是在帮玩家
     * 走规则内的路，而消除是"卡住了就帮你直接成一次"。所以它只有 1 次。
     */
    private useBomb(): void {
        if (this._busy || this._finished) return;
        if (this._bombLeft <= 0) { this.toast('消除用完了'); return; }
        // ★ 宝牌要排除掉：这个道具是"无视滑动限制，直接成一次字"，
        //   拿它去凑一对宝牌等于把道具换成"消一对宝牌" —— 少消一个字，玩家会亏。
        const ts = this._board.allTiles().filter((t) => t.kind !== 'junk' && t.kind !== 'treasure');
        let found: [Tile, Tile] | null = null;
        for (let i = 0; i < ts.length && !found; i++) {
            for (let j = i + 1; j < ts.length; j++) {
                if (this._pair.canPair(ts[i], ts[j])) { found = [ts[i], ts[j]]; break; }
            }
        }
        if (!found) { this.toast('场上没有可合成的两张牌了'); return; }
        this._bombLeft--;
        this.renderTools();
        // ★ 日志里也改成「消除」：它是这个道具唯一的可观测入口，名字与 UI 不一致时，
        //   查日志的人会以为"消除"和"凑对"是两个不同的功能。
        log(`[GamePage] 消除：${found[0].char}+${found[1].char}=${this._pair.word(found[0], found[1])}`);
        this.resolveMatch(found[0], found[1]);
    }

    /**
     * 「延长时间」：在**现有倒计时**上直接加 `CFG.GAME.REVIVE_SEC`（30）秒。
     *
     * 【为什么是"加秒"而不是"重置成 now+30s"】
     * 重置是「看视频复活」的口径 —— 复活发生在时间**已经归零之后**，重置是唯一
     * 说得通的做法。而本道具是在时间还没走完时**主动使用**的，玩家心里的账是
     * "我还剩 20 秒，加 30 秒 ⇒ 50 秒"，加秒才符合预期。
     * 两者共用同一个常量是刻意的：它们都是"把这一关的可用时间延长 30 秒"，
     * 只是触发时机不同（一个是用了道具、一个是看了广告）。
     *
     * ★ 加完必须**把表重新挂上**：计时到点那一刻 `_tickId` 会被清掉，
     *   之后再也没有人来读 `_deadline` —— 只改 `_deadline` 而不重挂表，
     *   表现是"点了没反应"（数字不动），而且不报任何错。
     */
    private useTime(): void {
        if (this._busy || this._finished) return;
        if (this._timeLeft <= 0) { this.toast('延长时间用完了'); return; }
        const add = CFG.GAME.REVIVE_SEC;
        const left = Math.max(0, (this._deadline - Date.now()) / 1000);
        this._timeLeft--;
        this.renderTools();
        AudioService.play('revive');          // 与"看广告复活"同一音色：语义就是同一件事
        this._deadline += add * 1000;
        if (this._tickId) this.updateTimerLabel();
        else this.startTimer(left + add);      // 表已经停了（刚好卡在归零那一帧）→ 重挂
        log(`[GamePage] 延长时间：+${add}s（剩 ${Math.round((this._deadline - Date.now()) / 1000)}s，`
            + `还有 ${this._timeLeft} 次）`);
        this.toast(`时间 +${add} 秒`);
    }

    /**
     * 开局把"本关有宝牌"这件事说清楚。
     *
     * 【为什么必须说】（第 3 关起每关都有，玩家第一次见是在 6×7 上）
     * 一张朱漆牌混在 30 张宣纸牌里，玩家第一反应是"这张牌出错了"或"这是不是不能动"。
     * 一句话把规则交代掉，比让他在那儿试半天便宜得多。
     * 只在 `tr > 0` 时说，且**只在本关首次进入**（每次重进都说会很烦 —— 但重进
     * 本来也是从头开局，说一次的成本可以接受，先不做"说过没说过"的存档位）。
     */
    private announceTreasure(): void {
        const lv = this._lv;
        if (!lv.tr) return;
        const names: string[] = [];
        for (let i = 0; i < lv.tr; i++) {
            const it = treasureOf(lv.ch, i);
            if (names.indexOf(it.name) < 0) names.push(it.name);
        }
        // 延迟到开局提示（"把偏旁与部件挪到同一行…"）之后再弹，别两条挤在一起
        this.timer(() => {
            if (this._finished || !this._root.isValid) return;
            this.toast(`本关有 ${lv.tr} 对宝牌「${names.join('」「')}」\n`
                + '凑成一对，会额外替你消掉一对字牌');
        }, 900);
    }

    private exitToMap(): void {
        PageManager.goto(PAGE_MAP, { chapter: this._lv.ch });
    }
}

// ------------------------------------------------------------
//  小工具
// ------------------------------------------------------------
function fmt(sec: number): string {
    const s = Math.max(0, Math.ceil(sec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    // ★ 原型是 `padStart(2,'0')` 两位全补 → "02:29"；等宽数字下不会左右跳
    return `${m < 10 ? '0' : ''}${m}:${r < 10 ? '0' : ''}${r}`;
}

/** 虚线圆角框（`.tips` 的 `border:1px dashed`）—— 沿已建好的圆角路径画虚线 */
function mkDashedRing(g: Graphics, w: number, h: number, radius: number,
                      color: string, alpha: number, dash = 13, gap = 9): void {
    g.strokeColor = hex(color, alpha);
    g.lineWidth = 2;
    const halfW = w / 2 - radius / 2, halfH = h / 2 - radius / 2;
    const step = px(dash) + px(gap);
    const dLen = px(dash);
    for (let x = -halfW; x < halfW; x += step) {
        const len = Math.min(dLen, halfW - x);
        g.moveTo(x, h / 2); g.lineTo(x + len, h / 2);
        g.moveTo(x, -h / 2); g.lineTo(x + len, -h / 2);
    }
    for (let y = -halfH; y < halfH; y += step) {
        const len = Math.min(dLen, halfH - y);
        g.moveTo(-w / 2, y); g.lineTo(-w / 2, y + len);
        g.moveTo(w / 2, y); g.lineTo(w / 2, y + len);
    }
    g.stroke();
}
