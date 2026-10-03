/**
 * ============================================================
 *  Bootstrap.ts · 启动自举
 * ============================================================
 *  【为什么需要它 —— 一个真实踩过的工程坑】
 *  用命令行做无头构建（tools/cocos-build.sh）时，asset-db 导入场景的时机
 *  **早于**脚本类注册，于是场景里挂载的自定义组件会被判定为
 *  「Script "xxx" attached to "Canvas" ... is missing or invalid」并被**静默丢弃**。
 *
 *  实测现象（很能说明问题）：
 *      · 脚本 bundle 是成功的 —— 产物 assets/main/index.js 里模块一个不少；
 *      · 但场景的 import json 里，脚本引用计数 = 0（组件没了）；
 *      · 结果：构建"成功"、体积正常，但运行起来一片空白 —— 没有任何入口。
 *
 *  【解法】
 *  让 Main.scene 保持「零脚本引用」的纯舞台（只有 Canvas + Camera），
 *  改由本模块在脚本被加载执行时，主动把 GameRoot 挂到 Canvas 上。
 *
 *  【为什么可以确定本文件一定会被执行】
 *  构建产物里所有项目脚本都会被 "chunks:///_virtual/main" 模块依赖，
 *  而该模块又被 "virtual:///prerequisite-imports/main" 引用 ——
 *  加载 main bundle 时即全部执行，因此顶层代码必然会跑。
 * ============================================================
 */

import { Director, director, log, profiler, warn } from 'cc';
import { CFG } from './CFG';
import { GameRoot } from './GameRoot';
import { AdService } from './ui/AdService';

/** 场景里承载一切 UI 的根节点名（见 assets/scenes/Main.scene） */
const CANVAS_NODE_NAME = 'Canvas';

/**
 * 按 CFG.DEBUG.STATS 决定是否显示引擎性能面板。
 *
 * 【为什么必须由项目代码来关】
 * web 模板里的 `Application` 类把 `showFPS` **写死成 true**，项目设置里也没有开关，
 * 所以只能运行期收掉。
 *
 * 【为什么不能直接放在模块顶层调用】
 * `profiler.hideStats()` 第一件事是 `director.root.pipeline.profiler = null`，
 * 而 `director.root` 是**引擎第一次 tick 时才创建**的；项目脚本模块的执行时机比它早，
 * 于是顶层调用会抛 TypeError。真正致命的不是这一行，而是**异常中断了整个模块** ——
 * 后面的 mountGameRoot() 一行都不会执行，表现是"整个游戏白屏"，
 * 而报错指向 profiler，与"游戏起不来"毫无因果关系。
 *
 * 所以定下三条规矩：
 *   ① 整个函数包 try/catch —— 它失败也**绝不允许**影响启动主流程；
 *   ② 用返回值告诉调用方"这次没成"，由调用方在更晚的时机重试；
 *   ③ 真正的收口放在"场景启动完成"之后（那时 root 一定已经就位）。
 */
function applyStats(): boolean {
    try {
        if (CFG.DEBUG.STATS) {
            profiler.showStats();
        } else {
            profiler.hideStats();
        }
        return true;
    } catch (e) {
        return false;   // 引擎还没准备好，交给下一次机会
    }
}

/** 幂等挂载：Scene 就绪后把 GameRoot 挂到 Canvas 上 */
function mountGameRoot(): void {
    const scene = director.getScene();
    if (!scene) {
        return;   // 场景尚未加载，交给事件回调再试
    }

    const canvas = scene.getChildByName(CANVAS_NODE_NAME);
    if (!canvas) {
        warn(`[Bootstrap] 场景里找不到 "${CANVAS_NODE_NAME}" 节点，游戏无法启动`);
        return;
    }
    if (canvas.getComponent(GameRoot)) {
        return;   // 已挂载过，保证幂等
    }

    // 用 try/catch 包住：即使挂载过程中抛异常，也要把原因打出来，
    // 而不是让小游戏静默白屏（命令行构建时看不到调试器，这条日志很关键）
    try {
        canvas.addComponent(GameRoot);
        if (CFG.DEBUG.LOG_STATE) log('[Bootstrap] GameRoot 已挂载到 Canvas');
    } catch (e) {
        warn('[Bootstrap] 挂载 GameRoot 失败：', e);
    }

    // 场景起来了 → director.root 一定已就位 → 这是关性能面板的最佳时机
    if (applyStats() && CFG.DEBUG.LOG_STATE) {
        log(`[Bootstrap] 引擎性能面板：${CFG.DEBUG.STATS ? '已开启' : '已关闭'}`);
    }

    // 广告位自检（2026-10-02 拍板新增）。
    // 放在这里的理由：本函数有"已挂载就 return"的幂等闸（上面那条），
    // 所以这段**整个生命周期只跑一次**，不会刷屏。
    // 放在启动期（而不是首次弹广告时）的理由：`CFG.AD.REWARD_UNIT_ID` 为空是
    // **静默**故障 —— 只有玩家真的卡住 / 真的失败才会走到那条分支，
    // 命令行构建与刚打开游戏时完全看不到任何异常。必须提前顶出来。
    // ★ 用 try/catch 包住，遵循本文件的老规矩：自检再重要也只是"旁路功能"，
    //   绝不允许它抛异常把启动主流程带走（那会把"少赚点钱"变成"白屏"）。
    try {
        AdService.audit();
    } catch (e) {
        warn('[Bootstrap] 广告位自检失败（不影响启动）：', e);
    }
}

// ------------------------------------------------------------
//  ⓪ 收掉引擎性能面板（见 applyStats 的注释）
// ------------------------------------------------------------
// 模块顶层这一发通常会失败（root 未创建），失败也不影响任何东西；
// 真正生效的是下面 mountGameRoot 里那一发（场景启动完成之后）。
if (!applyStats()) {
    setTimeout(() => applyStats(), 0);
    setTimeout(() => applyStats(), 300);
}

// ------------------------------------------------------------
//  双保险：两条路径都试
// ------------------------------------------------------------
// ① 常规路径：脚本在场景加载【之前】执行，此时监听"场景启动完成"事件
director.on(Director.EVENT_AFTER_SCENE_LAUNCH, mountGameRoot);

// ② 兜底路径：万一脚本执行时机【晚于】场景加载（事件已经错过），立即尝试一次。
//    两种时机在真机与开发者工具上都可能出现，所以两条都要留。
mountGameRoot();
