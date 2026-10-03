/* 校验「要烘的贴图」对应的字形是否都在 design/glyphs-data.js 里。
 *
 * 为什么必须有这一步：**缺字形不报错**。InkGlyphs.path() 会返回空串，
 * 渲染出来是一张"有纸有印、就是没字"的空白牌 —— 烘焙自检也只看到"浅色纸底"，
 * 照样通过。只有在这里拦住，才知道是字库缺字。
 *
 * 字单从 tools/gen-cocos-leveldata.js 吐出的 /private/tmp/chaizi-tile-chars.json 读
 * （先跑：node tools/gen-cocos-leveldata.js）。
 *
 * 用法： node tools/check-glyph-coverage.js
 * 退出码：0 = 全都有；1 = 有缺字或空轮廓
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.dirname(__dirname);

const CHARS_JSON = '/private/tmp/chaizi-tile-chars.json';
if (!fs.existsSync(CHARS_JSON)) {
    console.error('✗ 找不到字单 ' + CHARS_JSON + '\n  先跑： node tools/gen-cocos-leveldata.js');
    process.exit(1);
}
const data = JSON.parse(fs.readFileSync(CHARS_JSON, 'utf8'));

const src = fs.readFileSync(path.join(ROOT, 'design', 'glyphs-data.js'), 'utf8');

// ⚠️ 不要用 `new Function('root', body)`：该文件结尾是
//     (function (root) { ... })(typeof window !== "undefined" ? window : this);
//   它会用 `window`/`globalThis` 当 root，把传进去的形参 root 整个遮蔽掉，
//   于是 sandbox.InkGlyphs 永远是 undefined（报错栈却指向 loader，看着像模块加载失败）。
// 正解：造一个 `window === 自身` 的 vm 上下文，让它按浏览器路径正常挂载。
const sandbox = { console };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'glyphs-data.js' });

const IG = sandbox.window.InkGlyphs;
if (!IG) throw new Error('InkGlyphs 未挂载 —— glyphs-data.js 的导出口径变了，去核对它的 IIFE 尾巴');

console.log('InkGlyphs.count =', IG.count);

let bad = 0;
const all = new Set();
for (const ch of data.chapters) {
    const miss = ch.chars.filter((c) => !IG.has(c));
    // 顺带确认每个字的轮廓非空（空轮廓 = 空白牌，不报错，极难发现）
    const empty = ch.chars.filter((c) => { const d = IG.path(c); return !d || d.length < 10; });
    ch.chars.forEach((c) => all.add(c));
    const ok = ch.chars.length - miss.length - empty.length;
    console.log(`  第 ${ch.id} 章 ${ch.name} → ${ch.bundle}/`
        + `  要 ${String(ch.chars.length).padStart(3)} 字，有 ${String(ok).padStart(3)}，`
        + `缺 ${miss.length}，空轮廓 ${empty.length}`
        + (miss.length ? '  缺：' + miss.join('') : '')
        + (empty.length ? '  空：' + empty.join('') : ''));
    bad += miss.length + empty.length;
}
console.log(`全库去重 ${all.size} 字；问题合计 ${bad}`);
process.exit(bad ? 1 : 0);
