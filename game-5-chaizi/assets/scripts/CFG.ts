/**
 * ============================================================
 *  CFG.ts · 全局配置常量（唯一真源）
 * ============================================================
 *  规矩：凡是"两处都要用到"的数字/颜色/字符串，一律放这里。
 *  散落在各文件里的字面量是 bug 的温床 —— 改一处漏一处不会报错。
 *
 *  ★★ 色板与标尺全部来自设计稿 prototype/index.html（v2.2）★★
 *    · 颜色 = 设计稿 `:root` 里的 CSS 变量，一个不改（含半透明 alpha）。
 *    · 尺寸 = 设计稿里的 px 值；页面侧统一用 `px(v)` 换算（见 LAYOUT.SCALE）。
 *    页面文件里**不允许**再出现裸的 '#rrggbb' 或"看起来是拍脑袋"的像素数。
 *
 *  【上一版为什么整体返工】
 *    我误把「深墨案几」当成了全局主题。设计稿里深墨**只给棋盘用**：
 *      .board{background:#23262c}
 *    其余所有界面一律是宣纸浅底（#F8F3E7 系）+ 白卡 + 墨字 + 朱砂强调。
 *    于是"对局页对、其他页全错"—— 看起来像风格没统一，实际是主题搞反了。
 * ============================================================
 */

export const CFG = {

    /** 设计分辨率：与 settings/v2/packages/project.json 必须一致。
     *  web-smoke.mjs 会把视口锁成这个尺寸，之后所有"设计坐标"点击才 1:1 可信。 */
    DESIGN: { W: 720, H: 1280 },

    /**
     * 设计稿标尺。
     *
     * ★★ 设计稿的**真实视口是 372×762**，不是 390×780 ★★
     *   设计稿写的是 `.phone{width:390px;height:780px;border:9px solid #241F1A}`，
     *   而全局又有 `*{box-sizing:border-box}` —— 于是 390 把**左右各 9px 的边框**
     *   也算进去了，`.screen{position:absolute;inset:0}` 真正拿到的内容盒只有
     *       390 − 9×2 = 372 宽，780 − 9×2 = 762 高。
     *   这不是猜的：`tools/design-geometry.mjs` 用 getComputedStyle 量出来的
     *   `.screen.clientWidth/Height` 就是 372×762（像素探针也复核过 ——
     *   手机外框在截图里正好 780px 宽，向内 9px 才是屏幕）。
     *
     *   本工程宽恒为 720（fitWidth）→ 比例取
     *       720 / 372 = 1.9355
     *   这样**横向比例与设计稿逐像素一致**（章节卡左右各留 16px →
     *   16/372 = 4.30% 屏宽；本工程里就是 31/720 = 4.30%）。
     *
     *   ⚠️ 上一版这里写的是 390 与 1.846 —— 只读了 CSS 的属性值，没意识到
     *      border-box 把边框算进了 width。差 4.8%，全页每个尺寸都偏小一点点，
     *      单看一页都"差不多"，摆在一起才看得出整体比设计稿紧。
     *      教训：**尺寸要量渲染结果，不要从 CSS 字面值推。**
     *
     * 【纵向为什么不是也逐像素一致】
     * 设计稿舞台是 372:762，本工程可见高度随机型变：
     *      设计稿画廊渲染时   ≈ 745 设计px
     *      无头冒烟（600×1260）≈ 781 设计px ← 与真机同比例
     * 纵向**元素尺寸与间距仍然精确**（同样 ×1.9355），差别只在"弹性空白" ——
     * 设计稿用 `margin:auto` / `flex:1` 分配的那几处空隙，这里按
     * 可用高度 − 内容总高 实际算（见 HomePage 的 F/2 与 UIFactory.centerBlockTop）。
     * 舞台矮就少一点留白，高就多一点，元素本身不会被压扁。
     *
     * ⚠️ 舞台比例必须与真机一致，否则"只在长屏上暴露"的问题会漏检。
     *    ★ 2026-10-02 踩过的坑：冒烟曾固定跑 720×1280（aspect 1.778 → 可见 661.3
     *    设计px），比设计舞台 745 还矮 —— 于是"顶锚 + 底部留白"的页面
     *    （章节选择/设置/图鉴…）在真机上多出来的空白，自动截图里全被挤没了。
     *    现在工装默认 600×1260（aspect 2.1 → 可见 781），见 tools/web-smoke.mjs。
     *    （另一条弯路：想直接开 720×1512 的窗口 —— 本机窗口高被钳在 1280，
     *      canvas 跟窗口走、不跟 emulate 的视口，结果是"截图 1512、画布 1280"。
     *      改成**等比缩小**即可：fitWidth 下可见高只跟比例有关，与像素数无关。）
     *
     * 用法：页面里 `import { px } from '../CFG'`，然后 `const T_TITLE = px(30);`
     *      —— 设计稿上写的 30px 直接看得见，换算只发生在一处。
     */
    SPEC: { W: 372, H: 762, SCALE: 720 / 372 },

    DEBUG: {
        /** 引擎性能面板（左下角 FPS/dc）。构建模板把 showFPS 写死成 true，只能运行期收掉 */
        STATS: false,
        /** 状态日志：命令行链路下这是**唯一**的可观测性来源，别关 */
        LOG_STATE: true,
    },

    /** 存档键。★ 改这里必须同步改 tools/web-smoke.mjs 的同名常量 */
    SAVE: {
        KEY: 'cz_nd_cocos_v1',
        /**
         * 「静音」单独一个键，**不进存档体**。
         *
         * ★ 为什么宁可多一个键也不往 SaveData 里加字段：
         *   Save.load() 有一道 `o.version === VERSION` 的闸门 —— 版本不符就整档回空。
         *   而"静音"是个纯偏好，加进 SaveData 必须把 VERSION 提到 2，
         *   于是**所有老玩家的通关记录当场清空**（`版本不符 → blank()`）。
         *   为一个开关付这个代价不划算。偏好与进度分家，各自独立演进。
         */
        AUDIO_KEY: 'cz_nd_cocos_v1_audio',
    },

    /**
     * 音频（S6）。
     *
     * 【素材的"出生证明"】
     *   · 13 段音效 —— `tools/make-sfx.py` 程序化合成（Python → WAV → afconvert → m4a），
     *     与 `ui/AudioService` 里的 `SfxId` **一一对应**，改名必须两边同步。
     *   · BGM 1 段 —— `tools/make-bgm.py` 合成（4 段候选里用户选的 C《点将》）。
     *     🔴 换 BGM **只改那个脚本顶部的 `CHOSEN` 一行**再跑 `--install`，
     *        别手工拷文件 —— 手工拷会丢 `.meta` 的 uuid，Cocos 里表现为
     *        "音频莫名为空"，而且不报错。
     *
     * 【★ 响度分级是硬约定：音效 > BGM】
     *   BGM 与音效的波形峰值**都归一到 0.70**，数字上一样响。差别在
     *   **持续音与瞬态音的可容忍度完全不同**：
     *     · 一段连续不断的旋律，给到音效 1/3 的响度就已经"占满"整个听觉；
     *     · 而音效是几十毫秒的瞬态，必须够响才听得见"这一下发生了什么"。
     *   所以 BGM_GAIN 取 0.30（≈ 比 clash 的 0.95 低 10dB）。
     *   ⚠️ 试听页里那 4 段是**拍板用的合成 demo**，比游戏里响得多 ——
     *      别按试听页的响度去判断"BGM 吵不吵"。
     */
    AUDIO: {
        /** 总开关（false = 全部静默）。想静音跑一遍冒烟测试就关它 */
        ENABLED: true,
        /** 主音量 0~1（音效与 BGM 都会再乘它） */
        MASTER: 0.85,
        /**
         * 同一个音效的最短重放间隔（毫秒）。
         * 连点时不节流会叠成一片噪声；45ms ≈ 每秒最多 22 次，人耳已分辨不出"多次"。
         * ⚠️ `bead`（珠子滑过格子）是**唯一要更宽松**的：它在一次拖动里连着响，
         *    45ms 会把"过了一格"的颗粒感糊成一串，所以它走 60ms（见 AudioService）。
         */
        MIN_GAP_MS: 45,
        /** 并发声道数。撞击 + 消散 + 通关会重叠，8 条留足余量 */
        VOICES: 8,

        BGM_ENABLED: true,
        /** BGM 音量倍率（还会再乘 MASTER）。0.30 ≈ 比 clash 低 10dB，理由见上 */
        BGM_GAIN: 0.30,
        /**
         * 停止时的淡出时长（毫秒），0 = 直接掐断。
         * 【为什么 BGM 要淡出、音效不要】音效是瞬态，断在半路听不出来；
         * BGM 是持续音，突然静音会被立刻察觉。
         */
        BGM_FADE_MS: 420,

        /**
         * 各音效的独立音量。
         * 【为什么要分开调】原始波形都归一到同一个峰值，但人耳对不同频率的
         * 响度感知差别很大。这张表是把它们拉回同一个**主观响度**，
         * 而不是同一个数字音量。
         */
        GAIN: {
            /** 珠子滑过格子。**全局最轻** —— 一次拖动最多连响 6 下，稍响就吵 */
            bead: 0.34,
            tap: 0.42,      // 通用点击
            pick: 0.50,     // 拎起
            land: 0.62,     // 落位
            reject: 0.48,   // 这一步不成立
            /** ★ 撞击 —— 本作最响的一击（与 clear 组成"咚—唰"二连） */
            clash: 0.95,
            clear: 0.82,    // 撞击之后的消散
            win: 0.90,      // 通关
            fail: 0.85,     // 超时
            revive: 0.80,   // 看视频复活
            reward: 0.78,   // 重排奖励 / 死局兜底
            hint: 0.55,     // 提示
            shuffle: 0.70,  // 洗牌
        },
    },

    /**
     * 配色。逐条对应设计稿 prototype/index.html 的 :root。
     * 命名后缀 `_A` 的是 alpha（0~255）—— 设计稿用 rgba() 的地方，
     * 拆成「十六进制 + alpha」两个常量，因为 Graphics 的 fillColor 要 Color(r,g,b,a)。
     */
    COLOR: {
        // ── 宣纸 ──
        PAPER: '#f8f3e7',           // --paper
        PAPER_D: '#ede4d2',         // --paper-d
        /** 页面底：radial-gradient(120% 80% at 50% 0%, #FCF8EF, #F6F0E2 45%, #EDE4D2 100%) */
        BG_TOP: '#fcf8ef',
        BG_MID: '#f6f0e2',
        BG_BOT: '#ede4d2',
        /** 对局页底：#s-play 的 radial-gradient(120% 70% ...) 略暖 */
        BG_GAME_TOP: '#fcf8ef',
        BG_GAME_MID: '#f3ecdc',
        BG_GAME_BOT: '#eae0cb',

        // ── 墨色阶 ──
        INK: '#2b2620',             // --ink   标题 / 正文
        INK2: '#8b8478',            // --ink2  次要文字
        INK3: '#b3ac9f',            // --ink3  最淡提示

        // ── 国画颜料 ──
        RED: '#b5352a',             // --red   朱砂：主强调（大标题 em / 统计数字 / 工具数字 / 印章）
        RED_D: '#8e281f',           // --red-d
        GOLD: '#c8a02e',            // --gold  藤黄：**只用于星级与「已完成」态**
        GOLD_L: '#e5cb74',          // --gold-l
        JADE: '#2e7a70',            // --jade  玉青：计时器 / 开关打开
        JADE_L: '#57a79b',
        LINE: '#ded3bb',            // --line
        CELL: '#e7ddc8',            // --cell

        // ── 白卡（半透明，必须能透出底下的宣纸渐变）──
        SURFACE: '#ffffff',
        SURFACE_A_STRONG: 219,      // rgba(255,255,255,.86) 章节卡
        SURFACE_A: 210,             // rgba(255,255,255,.82) 通用 .card
        SURFACE_A_SOFT: 204,        // rgba(255,255,255,.80) 工具条 / 图鉴格
        SURFACE_A_CHIP: 184,        // rgba(255,255,255,.72) 目标 chip
        SURFACE_A_BACK: 179,        // rgba(255,255,255,.70) 圆形返回键
        SURFACE_A_STRIP: 128,       // rgba(255,255,255,.50) 已成字条
        SURFACE_A_DEMO: 214,        // rgba(255,255,255,.84) 首页小字牌

        // ── 米色描边（rgba(150,130,95,x)）──
        EDGE: '#96825f',
        EDGE_A: 33,                 // .13 章节卡 / 设置行
        EDGE_A_AW: 36,              // .14 图鉴格
        EDGE_A_SOFT: 41,            // .16 已成字条内描边 / 结算 showcase
        EDGE_A_NODE: 46,            // .18 地图默认节点
        EDGE_A_STRIP: 38,           // .15 已成字条内描边
        EDGE_A_MID: 51,             // .20 返回键 / ghost 按钮
        EDGE_A_LINE: 56,            // .22 目标 chip
        EDGE_A_TOOL: 61,            // .24 对局工具条
        EDGE_A_BACK: 77,            // .30 返回键（设计稿 .btn-back）

        // ── 案几（棋盘）★ 全稿唯一的深色区 ──
        BOARD: '#23262c',
        /** 可达格：rgba(206,160,44,.22) + inset 2px rgba(190,144,32,.62) */
        BOARD_REACH: '#cea02c',
        BOARD_REACH_A: 56,
        BOARD_REACH_EDGE: '#be9020',
        BOARD_REACH_EDGE_A: 158,
        /** 可达格中心提示点：rgba(172,126,20,.48) */
        BOARD_REACH_DOT: '#ac7e14',
        BOARD_REACH_DOT_A: 122,
        /** 案几内阴影 `inset 0 0 64px rgba(0,0,0,.55)` 与投影 `0 6px 20px rgba(40,30,15,.28)` */
        BOARD_VIG: '#000000',
        BOARD_VIG_A: 140,
        BOARD_VIG_DEPTH: 64,
        BOARD_SHADOW: '#281e0f',
        BOARD_SHADOW_A: 71,
        /** 拖动中预判可消：牌的描边 0 0 0 2.5px rgba(206,160,44,.95) */
        HL_GOLD: '#cea02c', HL_GOLD_A: 242,
        /** 提示：牌的描边 0 0 0 2.5px rgba(70,150,140,.9) */
        HL_JADE: '#46968c', HL_JADE_A: 230,
        /** 两牌之间的虚线：拖动预判是藤黄，提示是玉青（原型 drawLink 的两个色） */
        LINK_GOLD: '#c8a02e', LINK_GOLD_A: 230,
        LINK_JADE: '#2e7a70', LINK_JADE_A: 242,

        // ── 主按钮 / 印章（朱砂渐变）──
        BTN_A: '#c4412f',           // linear-gradient(168deg,#C4412F,#9E2C21)
        BTN_B: '#9e2c21',
        SEAL_A: '#c4412f',          // linear-gradient(148deg,#C4412F,#8E281F)
        SEAL_B: '#8e281f',
        BTN_TX: '#ffffff',
        /** 启动页进度条底槽：rgba(140,120,85,.16) */
        BAR_TRACK: '#8c7855',
        BAR_TRACK_A: 41,
        /** 印章内圈白线：rgba(255,255,255,.42) */
        SEAL_RING: '#ffffff',
        SEAL_RING_A: 107,

        // ── 字块三色（偏旁 / 部件 / 合成字）★ 与玩法无关，纯视觉分组 ──
        PIECE_R_A: '#fdefd6', PIECE_R_B: '#f2d9ae', PIECE_R_TX: '#8a4715',  // 赭石（偏旁）
        PIECE_P_A: '#e8f4f1', PIECE_P_B: '#cde5df', PIECE_P_TX: '#1c5a50',  // 玉青（部件）
        PIECE_W_A: '#c4412f', PIECE_W_B: '#93291e', PIECE_W_TX: '#ffffff',  // 朱砂（合成字）
        /**
         * 字块的"厚度"：设计稿用两条 box-shadow 让纸片立起来 ——
         *   inset 0 -2px 0 rgba(***)  ← 底边内阴影（纸的厚度）
         *   0 Npx Mpx rgba(...)       ← 落在纸面上的投影
         * Graphics 没有内阴影，用一条贴底的细圆角条近似底边；投影由 mkShadow 画。
         */
        PIECE_R_INSET: '#aa732d', PIECE_R_INSET_A: 64,
        PIECE_P_INSET: '#1e6e64', PIECE_P_INSET_A: 51,
        PIECE_R_SHADOW: '#8c642d', PIECE_R_SHADOW_A: 56,
        PIECE_P_SHADOW: '#2d5f55', PIECE_P_SHADOW_A: 51,
        PIECE_W_SHADOW: '#a03223', PIECE_W_SHADOW_A: 87,

        // ── 「已完成」金底 ──
        DONE_A: '#fffdf6', DONE_B: '#f7ebd2',       // linear-gradient(160deg) 已得关卡 / 图鉴已点亮
        DONE_A2: '#fdf3d8', DONE_B2: '#f5e0a8',     // 目标 chip 完成态
        DONE_EDGE: '#c8a02e',
        DONE_TX: '#96751a',

        // ── 结构提示条（金底 + 虚线金边）──
        TIP_BG: '#c8a02e', TIP_BG_A: 33,            // rgba(200,160,46,.13)
        TIP_EDGE: '#c8a02e', TIP_EDGE_A: 128,       // rgba(200,160,46,.50)
        TIP_TX: '#7a5f14',

        // ── 未点亮 / 禁用 ──
        OFF_WORD: '#c4bcad',        // 图鉴未点亮字
        OFF_LOCK: '#cfc7b7',        // 图鉴锁
        OFF_STAR: '#dcd5c6',        // 结算未得星
        OFF_STAR2: '#d8d1c3',       // 章节星级未得
        OFF_SWITCH: '#cfc8b9',      // 开关底

        // ── 小字牌 / 目标 chip 的文字色（设计稿 .hi-tiles span / .tool span / .g-word）──
        TILE_TX: '#5c5245',
        /** 图鉴已点亮时拼音的颜色（设计稿 .aw.lit .py） */
        ATLAS_ON_TX: '#9a7a1e',

        // ── 遮罩 / 弹窗 / 飘字 ──
        MASK: '#2b2620', MASK_A: 128,               // rgba(43,38,32,.50)
        DLG_BG: '#fbf7ee',
        TOAST_BG: '#2b2620', TOAST_BG_A: 235,       // rgba(43,38,32,.92)
        TOAST_TX: '#f6f0e2',                        // #F6F0E2

        // ── 阴影（设计稿用 box-shadow 表达"纸浮起来"，这里拆成两层近似）──
        SHADOW: '#786432',                          // rgba(120,100,60,x)
        SHADOW_A: 26,                               // .10
        SHADOW_A_SOFT: 15,
    },

    /**
     * 字体。设计稿：标题/数字/字牌走楷体（--kai），正文走黑体（--hei）。
     * ⚠️ 小游戏里 fontFamily 是**建议**不是保证：iOS 有 Kaiti SC，Android 多数没有，
     *    Web 端看系统。取不到时会自动回落到默认字体（正文字形不会乱，只是少一点楷味）。
     *    所以：任何"必须长得像楷体"的信息都不能只靠字体，字号/字距/色彩层级要独立成立。
     */
    FONT: {
        /** --kai:"STKaiti","Kaiti SC","KaiTi","楷体",serif */
        KAI: 'Kaiti SC,STKaiti,KaiTi,KaiSC',
        /** --hei:-apple-system,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif */
        HEI: 'PingFang SC,Hiragino Sans GB,Microsoft YaHei',
    },

    /** 对局的节奏与手感（单位：秒 / 设计像素） */
    GAME: {
        /** 拖动超过这个位移才算"真的在拖"，否则松开时当作点击 */
        DRAG_SLOP: 6,
        /** 牌从抬起变大时的手感倍率 */
        LIFT_SCALE: 1.1,
        /**
         * 合成动画的"清理并判定"时点。原型 resolveMatch 的 setTimeout 是 480ms：
         *   0ms   两张牌飞向中点（transition .17s）+ 变淡（.2s）
         *   0ms   合成字从中点以 scale 1.42 浮现
         *   360ms 合成字放大到 1.9 并淡出
         *   480ms 摘掉两张牌 → 刷新目标条与已成字条 → 判胜负 / 判死局
         */
        MATCH_CLEANUP_MS: 480,
        /** 剩余时间低于这个值，计时器转朱砂并闪烁（原型 `.timer.warn` 判的也是 15s） */
        TIME_WARN_SEC: 15,
        /**
         * 严格回弹：拖出去的牌凑不成字时，**沿原路滑回原格**的时长。
         *
         * 取值 170ms 的理由：设计稿里两张牌飞向中点的合成动画是 170ms
         * （`.tile.melt{transition:transform .17s}`）。回弹用得一样快，
         * 玩家会有"这个手势被弹回来了"的一致手感 —— 属于**失败反馈**，
         * 不该比成功动画还慢，否则会显得很拖沓。
         */
        REBOUND_MS: 170,
        /**
         * 「看视频复活」加多少秒。
         *
         * 取 30 的理由：本关限时 122~150s，30s 约等于**再打三分之一关** ——
         * 足够把"差最后两三对"的局面收掉（这正是最想复活的那种局面），
         * 又不足以让"还剩十几张牌"的崩盘白捡一次通关。
         *
         * ⚠️ 复活不是「重开」：`GamePage.onReviveAd` 只把 deadline 推到 `now + 30s`，
         *   盘面/步数/已成字一个字节都不动（这也是失败做成页内弹层的主要原因）。
         */
        REVIVE_SEC: 30,
    },

    /**
     * 对局棋盘几何。★ 格距是**算**出来的，不是写死的 ——
     * 原型 `computeCell()` 原式（prototype/index.html 6.3）：
     *     cell = clamp( min(floor((availW−4)/cols), floor((availH−4)/rows)), 32, 62 )
     *     gap  = max(3, round(cell × 0.09))
     *     tile = cell − gap
     * 其中 availW/availH 是 `.board-wrap` 的**内容盒**（padding 2px 10px 已扣掉）。
     *
     * 【为什么必须照搬这个"算"法，而不能挑一个好看的格宽写死】
     *  ① 棋盘尺寸随章变化：一/二章 6 列（cell 58 → 棋盘 348×290），
     *     三/四章 7 列（cell 49 → 棋盘 343×343）。写死一个值必然有一章不合身。
     *  ② 62 的上限是设计稿刻意的：再大就不是"棋格"而是"贴纸"了。
     *  ③ 实测复核 L1：availW=352 → floor(348/6)=58；availH=476 → floor(472/5)=94；
     *     min→58；gap=round(5.22)=5 → tile 53，棋盘 348×290 —— 与盒模型量到的
     *     `.tile 53×53` / `#board 348×290` 逐值吻合。
     *
     * ⚠️ 本结构里**所有数值的单位都是设计 px**（就是设计稿上写的数），
     *    页面侧要么先把可用尺寸换算到设计 px 再算、最后一步才 px()，
     *    要么对每个值单独 px()。**绝不可以把它当本工程像素直接用** ——
     *    CELL_MAX=62 直接用就等于设计 32px，格子会被压到一半。
     */
    BOARDGEO: {
        CELL_MIN: 32, CELL_MAX: 62,
        /** gap = max(GAP_MIN, round(cell × GAP_RATIO)) */
        GAP_RATIO: 0.09, GAP_MIN: 3,
        /** `.board-wrap{padding:2px 10px}` */
        WRAP_PAD_Y: 2, WRAP_PAD_X: 10,
        /** `.board{border-radius:8px}` 与 `.cellbg{border-radius:6px}` */
        R: 8, REACH_R: 6,
        /** 可达格中心提示点 `.cellbg.reach::after`：7×7 */
        REACH_DOT: 7,
    },

    /** 工具次数。★ 与设计稿 S05 工具栏的「提示 3 / 洗牌 1 / 凑对 1」逐一对齐 */
    TOOL: { HINT: 3, SHUFFLE: 1, BOMB: 1 },

    /**
     * 激励视频广告位。
     *
     * 【它为什么存在】
     * 玩法改成**严格回弹**（拖了凑不成字就滑回原位）之后，盘面会真的走进死局 ——
     * 用 `tools/solve-exact.js` 对 38 关做过完整搜索：**只有 71.9% 的局面存在通关路径**，
     * 还有 8 关会触到搜索上限、2 关完全无解。所以"卡住 → 看广告重排"是**必需**的
     * 兜底，不是可选体验优化。
     *
     * 【填哪里】
     * 微信小游戏后台「流量主 → 激励式广告」创建广告位后，把广告单元 ID 填进 REWARD_UNIT_ID。
     * 留空时 `ui/AdService` 会**降级**成"直接回调成功"（本地调试 / web 端跑得通），
     * 但会打一条 warning —— 上架前必须填真值，否则等于把兜底白送给玩家。
     */
    AD: {
        /**
         * 激励视频广告单元 ID。空串 = 未接入 → 两处（死局重排 / 看视频复活）
         * 都走 `AdService` 的**降级直接发放**。
         *
         * ⚠️ 2026-10-02 拍板：首版**就让它空着**。理由是它现在填不了 ——
         *   微信流量主要求「累计独立访客 UV ≥ 1000 且无严重违规记录」才能开通，
         *   开通后才有「流量主 → 激励式广告」可创建广告位拿到 adunit-xxxx。
         *   首版达不到量，填不了真值；先用降级把玩法闭环跑通。
         *   等够资格了**必须回来填**，否则兜底等于白送（见下方 DEGRADED 说明）。
         */
        REWARD_UNIT_ID: '',
        // ─────────────────────────────────────────────────────────
        //  ★ 这里曾经有一条 `DEGRADED_TOAST` 常量，内容是「广告位未接入 + 直接重排
        //    ＋ 提醒去填 REWARD_UNIT_ID」这样一句 —— 它被 `GamePage.onAdReward` 弹给了玩家。
        //    两个问题，故整条删掉（**不再逐字保留原句**：debug 构建会把注释打进包，
        //    留着原句会让后续用关键字搜包的人误判成"文案没清掉"，白绕一圈）：
        //
        //    ① **它是弹给玩家的，但写的是给我们自己看的话**。
        //       `CFG.AD.REWARD_UNIT_ID` 这种变量名不该出现在玩家眼前。
        //    ② 它其实**从来没显示过**：同一个 tick 里紧跟一句 `盘面已重排`
        //       （Toast 是单实例、直接覆写 Label），前一句当场被盖掉。
        //       结论：它是一行既没用又危险的死代码。
        //
        //  现在的分工：
        //    · 玩家侧 —— 只看到结果本身（「盘面已重排」/「复活成功，时间 +30 秒」），
        //               一个字都不提广告。
        //    · 开发侧 —— 走 console（`AdService.showReward` 的 warn）
        //               ＋ 启动期自检（`AdService.audit()` 在微信环境发现空串 → error）。
        // ─────────────────────────────────────────────────────────
    },

    /**
     * 版式常量。
     * ⚠️ **单位不统一，用时看清每一条自己写的**：PAD/TOP/BOTTOM 是历史遗留的
     *    实现px（全项目已无引用点），SAFE_TOP 是设计px（用时过 px()）。
     */
    LAYOUT: {
        /** 页面左右安全边距（**实现px**）。★ 无引用点 —— 棋盘左右留白已由
         *  BOARDGEO.WRAP_PAD_X 接管。保留仅为不动不属于本次任务的常量。 */
        PAD: 26,
        /** 内容区顶部 / 底部（**实现px**）。★ 无引用点，已被 SAFE_TOP 取代。 */
        TOP: 96,
        BOTTOM: 64,
        /**
         * ★ 顶部安全区（**设计px**）：顶栏**第一行内容**距屏幕顶的距离。
         *
         * 设计稿的顶栏 `.topbar{padding:16px 16px 8px}` 只有 16px —— 那是画在
         * 浏览器"手机壳"里的，真机上这段高度落在状态栏 / 灵动岛内，
         * 微信右上角的**胶囊**也压在同一行（真机截图实测：屏 620×1302 图px，
         * 胶囊纵向约在设计 y 36..55；对局页的 `.timer` 恰好在右侧同一行）。
         *
         * 取 56：（a）iPhone 安全区上沿典型值 59 CSS px ≈ 56 设计px；
         *        （b）顶栏内容从 56 起排，返回键占 56..88，正好落在胶囊下方。
         * 代价是偏离设计稿的 16px —— 已与用户确认（2026-10-02 拍板"下移到安全区"）。
         *
         * 用法：页面里 `const TOP_PAD_T = safeTop();`（**替换**掉原来的 px(16)，
         *      不是叠加），见 ui/UIFactory.safeTop()。
         */
        SAFE_TOP: 56,
    },
} as const;

export type Cfg = typeof CFG;

/** 设计稿 px → 本工程设计像素。写法见 CFG.SPEC 的说明 */
export function px(v: number): number {
    return Math.round(v * CFG.SPEC.SCALE);
}
