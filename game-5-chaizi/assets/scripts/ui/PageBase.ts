/**
 * ============================================================
 *  PageBase.ts · 页面基类
 * ============================================================
 *  约定：
 *    · 子类只写 onCreate()（建界面、挂事件）；
 *    · 一定要清的东西（定时器、schedule、全局事件监听）写在 onExit()，
 *      **基类不会替你猜** —— 上一轮项目里"切页后旧页的 setTimeout 还在跑"
 *      这类幽灵 bug 全部源于漏清。
 * ============================================================
 */

import { Node } from 'cc';
import { fill, mkNode } from './UIFactory';

export abstract class PageBase {

    protected _root!: Node;
    /** 一次性定时器（setTimeout），onExit 时统一收口 */
    private _timers: number[] = [];
    /**
     * 重复定时器（setInterval）。
     * ★ 必须与 setTimeout 分开存：`clearTimeout` 清理不掉 interval id，
     *   混在一个数组里清，表现是"页面已经切走但计时器还在跑、还在改已销毁的节点"。
     */
    private _intervals: number[] = [];

    /** 页面名（用于日志） */
    abstract readonly pageName: string;

    /** 由 PageManager 调用，别自己调 */
    build(parent: Node, param?: any): void {
        this._root = mkNode('page-' + this.pageName, parent);
        fill(this._root);
        this.onCreate(param);
    }

    get node(): Node {
        return this._root;
    }

    /** 子类实现：建界面 + 绑定交互 */
    protected abstract onCreate(param?: any): void;

    /** 子类可覆写：清自己的资源。父类会在之后销毁整棵节点 */
    onExit(): void {
        this.clearTimers();
    }

    // --------------------------------------------------------
    //  定时器收口
    // --------------------------------------------------------
    /** 登记一个定时器；页面退出时会被自动清掉 */
    protected timer(fn: () => void, ms: number): number {
        const id = setTimeout(() => {
            // 页面已销毁就不执行 —— 否则回调里访问 this._root 会炸
            if (!this._root || !this._root.isValid) return;
            fn();
        }, ms) as unknown as number;
        this._timers.push(id);
        return id;
    }

    /**
     * 登记一个重复定时器；页面退出时会被自动清掉。
     * 对局的倒计时、呼吸动画都走它。
     */
    protected interval(fn: () => void, ms: number): number {
        const id = setInterval(() => {
            if (!this._root || !this._root.isValid) return;
            fn();
        }, ms) as unknown as number;
        this._intervals.push(id);
        return id;
    }

    /** 停掉某个重复定时器（例如通关那一刻就要停表，不必等页面退出） */
    protected clearInterval(id: number): void {
        clearInterval(id as unknown as number);
        const i = this._intervals.indexOf(id);
        if (i >= 0) this._intervals.splice(i, 1);
    }

    /** 清掉全部登记过的定时器 */
    protected clearTimers(): void {
        for (const id of this._timers) clearTimeout(id as unknown as number);
        this._timers = [];
        for (const id of this._intervals) clearInterval(id as unknown as number);
        this._intervals = [];
    }
}
