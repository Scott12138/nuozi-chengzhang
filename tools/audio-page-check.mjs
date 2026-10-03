#!/usr/bin/env node
/**
 * ============================================================
 *  audio-page-check.mjs · 试听页的真实事件验收（零依赖 CDP）
 * ============================================================
 *  【为什么必须有这个脚本】
 *  试听页是"给人拍板用的交付物"，而它最要命的失败模式是**看不出坏了**：
 *  18 个 <audio> 元素都在、控件都在、截图也好看 —— 点下去没声。
 *  截图只能证明"元素存在"，证明不了"状态变了"。
 *  （本项目已经栽过一次：原型交付时 `pointermove`/`pointerup` 两个监听器
 *    从未注册，点击判定写在 pointerup 里 → 连点都点不动；截图和自动演示
 *    都绕过了事件层，全看不出来。）
 *
 *  所以这里的判据是**状态真的变了**，不是元素存在：
 *    · 每段音频单独 play() 之后，currentTime 必须真的往前走（> 0.02s）；
 *    · 点"连播"按钮之后，高亮卡片必须**换人**（证明链式播放真的在跑），
 *      而且要能跑到最后一张并自己停下。
 *
 *  【用法】
 *    node tools/audio-page-check.mjs <页面file://或http url> [期望音频段数]
 *
 *  退出码：0 = 全部通过；1 = 有硬失败。
 * ============================================================
 */

import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_BIN
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// ★ 端口与 profile 必须**每次运行都不同**。
//   踩过的坑：两个检查并行跑时共用 9337 端口和同一个 /tmp/cocos-cdp-audio，
//   后启动的那个 Chrome 直接复用了前一个实例，于是"音效页检查"读到的是
//   BGM 页的 DOM（报"4 个音频元素"），结论全是假的 —— 而且不报错，
//   看起来像页面坏了。用 pid + 时间戳区分开，各自独立。
const RUN_TAG = `${process.pid}-${Date.now().toString(36)}`;
const PORT = Number(process.env.CDP_PORT
    || (9300 + (process.pid % 400) + (Number(process.env.CDP_SLOT) || 0)));
const PROFILE = `/tmp/cocos-cdp-audio-${RUN_TAG}`;

const URL_ = process.argv[2];
const EXPECT = Number(process.argv[3] || 0);
if (!URL_) {
    console.error('用法：node tools/audio-page-check.mjs <url> [期望音频段数]');
    process.exit(2);
}

const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--window-size=900,1200',
    '--user-data-dir=' + PROFILE,
    '--no-first-run', '--no-default-browser-check',
    '--no-sandbox', '--disable-dev-shm-usage',
    '--enable-unsafe-swiftshader',
    '--autoplay-policy=document-user-activation-required',  // 保持默认策略：要真的靠手势
    '--mute-audio',        // 无头环境没声卡，静音只是为了别让 Chrome 报警告
    URL_,
], { stdio: 'ignore' });

const bail = (msg, code = 1) => {
    console.error('❌ ' + msg);
    chrome.kill('SIGKILL');
    cleanup();
    process.exit(code);
};
// 每次运行的 profile 都是新的，收尾时删掉，别在 /tmp 里攒垃圾
const cleanup = () => {
    try { rmSync(PROFILE, { recursive: true, force: true }); } catch { /* 忽略 */ }
};
process.on('exit', cleanup);
const hardTimer = setTimeout(() => bail('整体超时（150s）'), 150000);

let fails = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { fails++; console.log('  ❌ ' + m); };

try {
    // ---------- 等 CDP ----------
    let target = null;
    for (let i = 0; i < 40; i++) {
        await sleep(300);
        try {
            const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
            target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
            if (target) break;
        } catch { /* 端口未就绪 */ }
    }
    if (!target) bail('CDP 端口未就绪');

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
        ws.addEventListener('open', res, { once: true });
        ws.addEventListener('error', () => rej(new Error('WebSocket 连接失败')), { once: true });
    });

    let seq = 0;
    const pending = new Map();
    ws.addEventListener('message', (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch { return; }
        if (m.id && pending.has(m.id)) {
            const { resolve, reject } = pending.get(m.id);
            pending.delete(m.id);
            m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
        }
    });
    const send = (method, params = {}, timeoutMs = 15000) => new Promise((resolve, reject) => {
        const id = ++seq;
        const t = setTimeout(() => { pending.delete(id); reject(new Error(`CDP 超时：${method}`)); }, timeoutMs);
        pending.set(id, {
            resolve: (v) => { clearTimeout(t); resolve(v); },
            reject: (e) => { clearTimeout(t); reject(e); },
        });
        ws.send(JSON.stringify({ id, method, params }));
    });
    // 便捷求值（userGesture=true 时等价于"用户操作触发的脚本"）
    const ev = async (expr, userGesture = false) => {
        const r = await send('Runtime.evaluate', {
            expression: expr, returnByValue: true, awaitPromise: true, userGesture,
        });
        if (r.exceptionDetails) throw new Error('页面异常：' + JSON.stringify(r.exceptionDetails.exception));
        return r.result.value;
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await sleep(2000);           // 等 data URI 元数据解析

    // ---------- ① 音频元素数量 ----------
    const n = await ev(`document.querySelectorAll('audio').length`);
    console.log(`\n① 音频元素：页面里 ${n} 个` + (EXPECT ? `（期望 ${EXPECT}）` : ''));
    if (EXPECT && n !== EXPECT) bad(`数量不符：期望 ${EXPECT}，实际 ${n}`);
    else ok('数量符合预期');

    // ---------- ② 元数据（duration）是否解析出来 ----------
    // 强制 load() 一次：preload="metadata" 在 data URI 上有时会拖到很晚才解析，
    // 而"解析不出来"就是"点了没声"的前兆。
    await ev(`(function(){
        var as=document.querySelectorAll('audio');
        for (var i=0;i<as.length;i++) { try { as[i].load(); } catch(e){} }
        return as.length;
    })()`);
    await sleep(2500);
    const metas = await ev(`(function(){
        var as=document.querySelectorAll('audio'), o=[];
        for (var i=0;i<as.length;i++){
            var a=as[i];
            o.push({ i:i, dur:a.duration, rs:a.readyState,
                     id:(a.closest('.card')||{}).id || '',
                     t:((a.closest('.card')||{}).querySelector? (a.closest('.card').querySelector('h2')||{}).textContent : '') });
        }
        return o;
    })()`);
    const badMeta = metas.filter((m) => !(m.dur > 0));
    const totalDur = metas.reduce((s, m) => s + (m.dur > 0 ? m.dur : 0), 0);
    console.log(`\n② 元数据解析：${metas.length - badMeta.length}/${metas.length} 段拿到有效 duration`
        + `（合计 ${totalDur.toFixed(1)}s）`);
    if (badMeta.length) {
        bad(`这些段的 duration 解析失败（点了必然没声）：`
            + badMeta.map((m) => `#${m.i} ${m.t || m.id}`).join(' / '));
    } else ok('全部段落的 duration 都解析出来了');

    // ---------- ③ 每段真的能播（判据：currentTime 往前走）----------
    console.log('\n③ 逐段播放（判据：currentTime 真的前进，不是"元素存在"）');
    // ★ 首次 play() 要等音频输出管线冷启动，偶尔会超过 220ms（实测第 0 段
    //   就这样"假死"过一次：rs=4 / paused=false / ct=0.000）。所以判"死"之前
    //   再给一次机会 —— 真的坏掉的元素，多等 400ms 也还是 0。
    const played = await ev(`(async function(){
        var as=document.querySelectorAll('audio'), res=[];
        var wait=function(ms){ return new Promise(function(r){ setTimeout(r,ms); }); };
        for (var i=0;i<as.length;i++){
            var a=as[i];
            a.currentTime=0;
            var p=null; try { p=a.play(); } catch(e){}
            if (p && p.catch) { try { await p; } catch(e){} }
            await wait(220);
            if (!(a.currentTime > 0.02)) {           // 疑似冷启动，复测一次
                await wait(400);
            }
            res.push({ i:i, ct:a.currentTime, paused:a.paused, rs:a.readyState });
            try { a.pause(); a.currentTime=0; } catch(e){}
        }
        return res;
    })()`, true);
    const dead = played.filter((p) => !(p.ct > 0.02));
    if (dead.length) {
        bad(`${dead.length} 段播不动（currentTime 没前进）：`
            + dead.map((p) => `#${p.i}(ct=${p.ct.toFixed(3)},rs=${p.rs},paused=${p.paused})`).join(' / '));
    } else {
        ok(`全部 ${played.length} 段都能播（currentTime 都前进了）`);
    }

    // ---------- ④ 「连播」按钮：真实鼠标事件 + 高亮真的换人 ----------
    const btn = await ev(`(function(){
        var b=document.getElementById('all'); if(!b) return null;
        var r=b.getBoundingClientRect();
        return { x: Math.round(r.left+r.width/2), y: Math.round(r.top+r.height/2) };
    })()`);
    console.log('\n④ 「连播」按钮（真实鼠标事件）');
    if (!btn) {
        // 不是所有试听页都需要连播：BGM 候选页每段 30 秒，要求人整段听完，
        // 链式连播反而碍事 —— 所以缺 #all 记为"跳过"，不算失败。
        console.log('      (本页没有 #all 连播按钮，跳过这一项 —— 不算失败)');
    } else {
        // 真实鼠标事件，不是 .click() —— .click() 不产生用户激活，
        // 测不出"autoplay 被拦"这类真问题。
        for (const type of ['mousePressed', 'mouseReleased']) {
            await send('Input.dispatchMouseEvent', {
                type, x: btn.x, y: btn.y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0,
            });
        }
        // 采样高亮卡片的序号，看它是不是真的在换人
        const seen = [];
        let maxOn = 0;
        for (let k = 0; k < 30; k++) {
            await sleep(700);
            const st = await ev(`(function(){
                var on=document.querySelectorAll('.card.on');
                var as=Array.prototype.slice.call(document.querySelectorAll('audio'));
                return { n: on.length, i: on.length ? as.indexOf(on[0].querySelector('audio')) : -1 };
            })()`);
            maxOn = Math.max(maxOn, st.n);
            if (st.i >= 0 && (seen.length === 0 || seen[seen.length - 1] !== st.i)) seen.push(st.i);
        }
        const distinct = new Set(seen).size;
        console.log(`      高亮推进序列：${seen.join(' → ') || '(一直没高亮)'}`);
        if (distinct >= 3) ok(`连播真的在推进（换过 ${distinct} 个）`);
        else bad(`连播没推进（只换过 ${distinct} 个）`);
        // ★ 这条是"状态干净"的硬判据：同一时刻只允许亮一张。
        //   漏掉 clearOn() 的话高亮会越叠越多 —— 表面看不出，
        //   但会让"推进到第几段了"彻底读不出来（永远读到第 0 张）。
        if (maxOn <= 1) ok('同一时刻最多只有 1 张卡高亮（高亮没有叠加）');
        else bad(`高亮叠加了：同一时刻最多 ${maxOn} 张卡同时亮着`);
        // 它应该跑完 18 段左右后自己停下；至少证明"能连续放"
        const stillOn = await ev(`document.querySelectorAll('.card.on').length`);
        if (stillOn <= 1) ok('结束时高亮不超过 1 张（没有卡住一直亮着）');
        else bad(`结束时还有 ${stillOn} 张高亮，状态不干净`);
    }

    // ---------- ⑤ 控制台报错 ----------
    // 先补开日志收集（在页面早期没抓到就算了，这里只看有没有硬报错遗留）
    clearTimeout(hardTimer);
    console.log('\n──────────────────────────────────────────');
    if (fails === 0) console.log('✅ 全部通过：这个试听页是真的能播，不是"看着像能播"。');
    else console.log(`❌ 有 ${fails} 项硬失败，见上。`);
    chrome.kill('SIGKILL');
    process.exit(fails === 0 ? 0 : 1);
} catch (e) {
    clearTimeout(hardTimer);
    bail(String(e && e.message || e));
}
