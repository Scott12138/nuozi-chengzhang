/**
 * ============================================================
 *  PageManager.ts · 极简页面状态机
 * ============================================================
 *  只做三件事：注册页面类 / 切到某页 / 让旧页自己收拾干净。
 *
 *  【为什么不做"页面栈"】
 *  本作是「首页 → 对局 → 结算 → 回首页」的浅层级，没有 A→B→C→回B→回A 的需求。
 *  多一个栈就多一类"切页后旧页没销毁、定时器还在跑"的幽灵 bug。
 *  真要回退就直接 goto 目标页，状态由存档决定，比维护栈更不容易错。
 *
 *  【它为什么在 ui/ 而不在 core/】
 *  它 import 了 'cc'（日志）和 PageBase。而 core/ 的硬规矩是**零引擎依赖**，
 *  好让玩法规则能用 tsc + node 直接跑断言（见 core/Types.ts 的说明）。
 *  切页是 UI 关注点，不是玩法规则，放 ui/ 才对。
 * ============================================================
 */

import { log, Node } from 'cc';
import { CFG } from '../CFG';
import { PageBase } from './PageBase';

type PageCtor = new () => PageBase;

export class PageManager {

    private static _uiRoot: Node | null = null;
    private static _registry: Record<string, PageCtor> = {};
    private static _cur: PageBase | null = null;
    private static _curName = '';

    /** 由 GameRoot 在启动时注入 UI 根容器 */
    static init(uiRoot: Node): void {
        this._uiRoot = uiRoot;
    }

    static register(name: string, ctor: PageCtor): void {
        this._registry[name] = ctor;
    }

    static get current(): string {
        return this._curName;
    }

    /** 切页。旧页 onExit 后整棵节点销毁 —— 定时器必须由页面自己在 onExit 里清 */
    static goto(name: string, param?: any): void {
        if (!this._uiRoot) {
            log('[PageManager] 尚未 init，切页被忽略：' + name);
            return;
        }
        const ctor = this._registry[name];
        if (!ctor) {
            log('[PageManager] 未注册的页面：' + name);
            return;
        }

        if (this._cur) {
            this._cur.onExit();
            this._cur.node.destroy();
            this._cur = null;
        }

        const page = new ctor();
        page.build(this._uiRoot, param);
        this._cur = page;
        this._curName = name;

        if (CFG.DEBUG.LOG_STATE) log(`[PageManager] 进入页面 ${name}`);
    }
}
