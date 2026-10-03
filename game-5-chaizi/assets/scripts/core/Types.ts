/**
 * ============================================================
 *  Types.ts · 玩法层的数据类型
 * ============================================================
 *  ★ 本目录（core/）**一律不 import 'cc'**。
 *
 *  为什么把这条当硬规矩：
 *  玩法规则（滑动范围、对齐判定、死局检测）是纯算术，跟引擎毫无关系。
 *  一旦 import 了 cc，就必须"构建 → 跑起来 → 看截图"才能验证，
 *  而"规则写错了"和"引擎没跑起来"在截图上长得一模一样 ——
 *  排查成本翻十倍。保持零引擎依赖后，规则可以直接用 node 跑断言
 *  （见 tools/core-selftest.mjs），把两类问题彻底分开。
 * ============================================================
 */

/**
 * 牌的种类。
 *   radical / part —— 普通牌，合成**只发生在两者之间**（一偏旁 + 一部件）；
 *   treasure       —— 宝牌，**同款互配**（同 char 才能配成一对），与普通牌永不互配；
 *   junk           —— 纯干扰牌。★ **已下线**（2026-10-03 由宝牌取代，`LEVELS` 里一律 0），
 *                     类型与代码路径保留到"确认线上包体里确实没有 junk 贴图"之后再删。
 */
export type TileKind = 'radical' | 'part' | 'junk' | 'treasure';

/** 棋盘上的一张牌 */
export interface Tile {
    /** 同一关内唯一，用于日志与调试定位 */
    id: number;
    /**
     * 普通牌 = 那个字/偏旁（单字）；宝牌 = **展示名**（如「铁砧」，两个字）。
     *
     * ⚠️ 宝牌的 char **故意不放进 `WORDS`**：`WORDS` 是拆字表，键必须是单字，
     *    塞进去会让 `PairTable` 的 `a|b` 组合表被污染（宝牌就变成"能拼成字"了）。
     *    宝牌之间靠 `char` 相等互配，与 `WORDS` 无关。
     */
    char: string;
    kind: TileKind;
    /**
     * 宝牌专用贴图键（`x_ch1_01` 这种，见 `core/Treasure.ts`）。
     * 普通牌留空 —— 贴图由 `char` 查 `TileManifest.TILE_TEX`。
     * ★ 为什么不复用 char 查表：宝牌名是给玩家看的（「铁砧」），
     *   而贴图得按**章 + 第几件**区分（第 2 章的「花瓶」不在第 1 章里出现）。
     */
    tex?: string;
    r: number;
    c: number;
}

/** 一个合成字的拆法 */
export interface WordSplit {
    /** 形旁（左/上） */
    a: string;
    /** 声旁 / 部件（右/下） */
    b: string;
}

/** 一关的定义（由 tools/gen-cocos-leveldata.js 从原型生成） */
export interface LevelDef {
    /** 全局关号，1 起连续 */
    n: number;
    /** 章号 1~4 */
    ch: number;
    cols: number;
    rows: number;
    /** 限时（秒） */
    time: number;
    /** 本关目标字（★ 顺序有意义：发牌按 i % words.length 轮转，靠前的字多拿一对） */
    words: string[];
    /** 配对数（每对 2 张牌） */
    pairs: number;
    /**
     * ★ 宝牌对数（2026-10-03 拍板：宝牌取代干扰牌）。
     *
     * 盘面张数 = `2 × pairs + 2 × tr`；`tr` 的取值由尺寸决定（6×7 起 1 对、9×9 起 2 对、10×12 3 对）。
     * 宝牌是**两张同款的独立牌**，凑成一对时**额外随机消掉盘面上一对普通牌** ——
     * 所以它对总操作次数是中性的（每凑一对宝牌就替玩家省掉一对普通对），
     * 价值在视觉减负与节奏爽点，不在数值减负。
     *
     * ★ 2026-10-03 已接入 `core/Board.ts`（`buildDeck` 按本字段发牌、
     *   `PairTable.canPair` 认同款互配、`Board.randomNormalPair` 供"额外消一对"）。
     */
    tr: number;
    /**
     * 干扰牌张数。★ **已全线归零** —— 宝牌取代了它（`LEVELS` 里一律 0）。
     * 保留字段是为了不动 `Board.buildDeck` 的循环与旧的贴图链路；junk 贴图也随之停烘。
     */
    junk: number;
    /** 拆法提示（如「木 + 仓 = 枪」），首关才有 */
    tip?: string;
    /** 这一关有什么不一样（给玩家看的变化说明） */
    note: string;
}

/** 目标条上的一格：某个字还要合几个 */
export interface RunWord {
    w: string;
    need: number;
    got: number;
}

/** 一格坐标 */
export interface Cell {
    r: number;
    c: number;
}

/**
 * 一次拖动里**某一张牌从哪到哪**。
 *
 * ★ 2026-10-03 新增（用户拍板"允许推着相邻的格子一起动"）。
 *   在这之前，一次拖动只可能动一张牌，所以"落点"这一个 Cell 就是全部信息；
 *   有了推箱之后，被推的那一串牌**每张都要换格**，光靠落点描述不了盘面怎么变。
 *
 * 用法：`Board.dragMoves(t, r, c)` 一次算全（含被推的），
 *       `Board.applyDrag/undoDrag` 成对落地与还原。
 *       它同时是"落位动画要动哪些节点"与"求解器撤销一步"的唯一依据 ——
 *       两边各算一套的话，"计划里的落点"与"真机按下去的结果"又会分叉。
 */
export interface CellMove {
    t: Tile;
    /** 拖动前所在的格 */
    from: Cell;
    /** 拖动后所在的格 */
    to: Cell;
}

/** 滑动范围：这张牌沿本行/本列最远能到的行列号（含自身） */
export interface SlideRange {
    up: number;
    down: number;
    left: number;
    right: number;
}

/** findSuggest 给出的一步可行解 */
export interface Suggestion {
    tile: Tile;
    /** 落点 */
    r: number;
    c: number;
    /** 落位后能与之合成的牌 */
    hit: Tile;
}

/**
 * 一步「玩家做得到、但落位**凑不成字**」的挪法。
 * 只给严格回弹的自动化验证用：冒烟的 `rebound:` 动作要拿一对**确定**的坐标，
 * 才能用真事件去断言"牌弹回原位、步数不变"。没有它，这条规则就只能靠人手拖。
 */
export interface NonMatchMove {
    tile: Tile;
    /** 落点 */
    r: number;
    c: number;
}

/**
 * 一步「推着相邻牌一起走」的走法（2026-10-03 推箱上线时加）。
 *
 * 【为什么要为它单开一个类型 —— 用 Suggestion 不够吗】
 * 不够，而且差得关键：`Suggestion` 只描述了「把 tile 挪到 (r,c)」，
 * 而推箱的**全部新行为**恰恰在"被推的那一串牌会去哪儿"上：
 *   · 凑成字 → 整段位移**永久留在新位置**；
 *   · 凑不成 → 整段**沿原路弹回**。
 * 这两句话都要靠 `shoved` 才能断言。缺了它，冒烟就只能验"拖动牌到位了"，
 * 而拖动牌到位这件事推箱前后一模一样 —— 等于没验。
 *
 * 【shoved 的次序】
 * 从离被拖那张牌**最近**的一张排起（就是 `dragMoves` 的产出顺序）。
 * 冒烟断言"牌永久停在新位置"时要按这个次序去 TILES 里找。
 */
export interface PushMove {
    tile: Tile;
    /** 落点 */
    r: number;
    c: number;
    /** 被推着走的牌（不含被拖的那张本身），至少一张 —— 否则不成其为推箱 */
    shoved: CellMove[];
    /** 落位后能与之合成的牌；凑不成字时为 undefined */
    hit?: Tile;
}

/**
 * `Board.findPush` 的扫描结果：一次扫出两种样本，供冒烟的两条断言各取所需。
 * 两者都可能为 null（盘面上未必存在推箱走法，或未必存在"推了凑不成"的走法）。
 */
export interface PushScan {
    /** 推着走、且落位凑成了字 */
    match: PushMove | null;
    /** 推着走、但落位凑不成字（严格回弹要拿它来验） */
    nomatch: PushMove | null;
}

/** 一次拖动的轴（谁拖得多听谁的；锁定后整段只在一条轴上行进） */
export type DragAxis = 'h' | 'v';

/** 通关结算数据（写进存档的那一份） */
export interface ClearResult {
    level: number;
    /** 剩余秒数 */
    leftSec: number;
    totalSec: number;
    /** 1~3 */
    stars: number;
    moves: number;
    /** 本关合出的不同字数 */
    words: number;
    /** 本关全部目标字（结算页展示拆法） */
    runWords: RunWord[];
}

/**
 * 传给结算页的参数（成功/失败共用一张页）。
 * ★ 成功与失败共用一页，而不是做两张：两者的版式骨架完全一样
 *   （大标题 / 星 / 三格数据 / 拆法展示 / 按钮），差异只在文案与按钮。
 *   做两张页 = 两处版式要同步改，迟早会分叉。
 */
export interface ResultParam {
    win: boolean;
    level: number;
    leftSec: number;
    totalSec: number;
    /** 1~3（失败时为 0，页面不画星） */
    stars: number;
    moves: number;
    /** 本关合出的不同字数 */
    words: number;
    runWords: RunWord[];
    /** 失败时还没合出来的字数（用于"还差多少"的文案） */
    leftWords: number;
}
