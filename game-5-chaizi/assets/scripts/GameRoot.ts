/**
 * ============================================================
 *  GameRoot.ts · 游戏入口组件
 * ============================================================
 *  它是整个游戏的"总装车间"：所有界面都由它在运行时创建。
 *
 *  ⚠️ 注意它**不是**挂在场景里的：Main.scene 保持零脚本引用，
 *  由 Bootstrap.ts 在运行时把它挂到 Canvas 上（原因见 Bootstrap 的注释）。
 *
 *  启动顺序：
 *     ① 建 UIRoot 容器（铺满 Canvas）
 *     ② 初始化页面状态机 PageManager
 *     ③ 注册所有页面（集中在此，页面之间因此不需要互相 import）
 *     ④ 进入首屏
 *
 *  为什么 UIRoot 尺寸用 view.getVisibleSize() 显式设置一次、同时还挂 Widget？
 *    · 显式设置 —— 保证首帧尺寸就是对的（不依赖组件 onLoad 时序）；
 *    · Widget   —— 保证之后屏幕旋转 / 尺寸变化时自动跟随。
 * ============================================================
 */

import { _decorator, Component, Layers, log, Node, UITransform, view, Widget } from 'cc';
import { CFG } from './CFG';
import { BootPage } from './ui/BootPage';
import { ChapterPage } from './ui/ChapterPage';
import { GamePage } from './ui/GamePage';
import { HomePage } from './ui/HomePage';
import { initDump } from './ui/LayoutDump';
import { MapPage } from './ui/MapPage';
import { PAGE_BOOT, PAGE_CHAP, PAGE_CLEAR, PAGE_GAME, PAGE_HOME, PAGE_MAP } from './ui/PAGES';
import { AudioService } from './ui/AudioService';
import { PageManager } from './ui/PageManager';
import { ResultPage } from './ui/ResultPage';

const { ccclass } = _decorator;

@ccclass('GameRoot')
export class GameRoot extends Component {

    /** UI 根容器（所有页面的父亲） */
    private _uiRoot: Node | null = null;
    /** UIRoot 的 UITransform（尺寸变化时更新用） */
    private _uiTransform: UITransform | null = null;

    start(): void {
        this._uiRoot = this.makeUIRoot();
        initDump();
        PageManager.init(this._uiRoot);
        // ★ 音频必须在**建页面之前**就绪：音效是异步加载的，
        //   等玩家点第一张牌才去 load，那一下一定播不出来
        //   （加载未完成时的策略是"静默跳过、绝不补播"，见 AudioService 文件头）。
        //   宿主挂在 UIRoot 下而不是某个页面下 —— 页面切走会被整棵销毁，
        //   声道跟着没了，那才是"切一次页声音就坏一次"的根源。
        AudioService.init(this._uiRoot);
        // ★ 用户拍板：「BGM 从进入游戏就可以一直播放，不需要进入到关卡」。
        //
        //   这里是**表达意图**（"全局都要有 BGM"），不是"立刻响" ——
        //   此刻还在启动流程里，**没有用户手势**，直接发 play() 会被 autoplay
        //   静默拦掉。真正把它带起来的是 AudioService 里那个
        //   "玩家第一次触摸屏幕就起播"的一次性监听（hookFirstGesture）。
        //
        //   拆成"意图"和"时机"两件事，是这个需求的唯一正解：
        //   只写意图不挂时机 ⇒ 永远不响；只挂时机不写意图 ⇒ 又退回"进关才有音乐"。
        //   配好之后 BGM 起来就**全程不停**（不淡出、不重启），
        //   菜单、地图、对局、结算都接着走。
        AudioService.playBgm();
        this.registerPages();
        PageManager.goto(PAGE_BOOT);

        if (CFG.DEBUG.LOG_STATE) {
            const vs = view.getVisibleSize();
            log(`[GameRoot] 启动完成，可见尺寸 ${Math.round(vs.width)}×${Math.round(vs.height)}`);
        }
    }

    // --------------------------------------------------------
    //  ① UI 根容器
    // --------------------------------------------------------
    private makeUIRoot(): Node {
        const n = new Node('UIRoot');
        n.layer = Layers.Enum.UI_2D;
        this._uiTransform = n.addComponent(UITransform);
        this.node.addChild(n);
        this.syncUIRootSize();

        const widget = n.addComponent(Widget);
        widget.isAlignTop = widget.isAlignBottom = true;
        widget.isAlignLeft = widget.isAlignRight = true;
        widget.top = widget.bottom = widget.left = widget.right = 0;
        widget.alignMode = Widget.AlignMode.ALWAYS;

        return n;
    }

    private syncUIRootSize(): void {
        if (!this._uiTransform) return;
        const vs = view.getVisibleSize();
        this._uiTransform.setContentSize(vs.width, vs.height);
    }

    // --------------------------------------------------------
    //  ② 页面注册
    // --------------------------------------------------------
    /**
     * 页面注册表。
     * ★ 页面之间因此**不需要互相 import**，只认 PAGES.ts 里的字符串常量 ——
     *   否则「首页 ⇄ 选关」这种互跳必然形成循环 import。
     *
     * ⚠️⚠️ **这张表和 PAGES.ts 必须成对维护，少注册一个就是一次线上事故** ⚠️⚠️
     *   2026-10-02 真踩过：PAGES.ts 声明了 9 个页面名，这张表只注册了 5 个，
     *   而 `PageManager.goto()` 遇到未注册的名字**不抛错、不降级、只打一行 log**
     *   （`[PageManager] 未注册的页面：clear`）就返回了。
     *   症状是：玩家把字全合完（目标 4/4 全满）、却没有任何反应，也没有「下一关」——
     *   看起来像"胜负判定坏了"，实际是结算页从来没被注册过。
     *   新增页面时，请顺手在这张表里加一行，并在 PAGES.ts 里确认常量已声明。
     */
    private registerPages(): void {
        PageManager.register(PAGE_BOOT, BootPage);
        PageManager.register(PAGE_HOME, HomePage);
        PageManager.register(PAGE_CHAP, ChapterPage);
        PageManager.register(PAGE_MAP, MapPage);
        PageManager.register(PAGE_GAME, GamePage);
        PageManager.register(PAGE_CLEAR, ResultPage);
        // 剩余 3 页在改版过程中逐个接回（失败/图鉴/设置）。
        // ★ 失败（PAGE_FAIL）**刻意为空**：它已经改成对局页内的弹层（ui/FailGate），
        //   因为独立页做不到"看视频复活"—— 切页会把盘面一起销毁。详见 FailGate 文件头。
    }
}
