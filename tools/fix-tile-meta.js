/* ============================================================
 *  fix-tile-meta.js · 牌面贴图的两个"编辑器里点一下就完事"的落盘动作
 * ============================================================
 *  ① 把导入类型改成 `sprite-frame`
 *  ② 清掉"孤儿 meta"（对应 PNG 已被删掉的那些 *.png.meta）
 *
 *  【① 为什么必须做 —— 一个完全静默的失败】
 *  Cocos 把贴图默认导入成 `type: "texture"`，也就是**只生成 Texture2D，
 *  不生成 SpriteFrame 子资源**。而游戏侧写的是
 *      resources.load('tiles/t_67aa/spriteFrame', SpriteFrame, cb)
 *  这个路径根本不存在 → 回调 err → 牌面不画。
 *
 *  它的可怕之处在于：
 *    · 构建**成功**、体积**正常**、贴图**确实在包里**；
 *    · 棋盘、计时、目标条、页面跳转**全部正常**，只是牌是空的；
 *    · 唯一的线索是一行 console.warn，而 release 构建又把 log 剥掉了。
 *  于是命令行下看到的就是"格子画出来了，牌没画出来"，完全指不到原因。
 *
 *  【② 为什么要清孤儿 meta】
 *  重烘贴图会先删旧 PNG 再写新的。字单变小（或改分辨率换了文件名）时，
 *  会有一些 PNG 不再生成，但它们的 `.meta` 留在盘上 —— asset-db 会把它们
 *  记成 `missing` 并**每次构建都报一遍**，久了没人再看得见真正的警告。
 *
 *  【为什么要写成脚本而不是手改】
 *  重烘贴图（tools/make-tile-atlas.py）会删掉旧 PNG 重建，新 PNG 又变回
 *  texture 类型 → 又坏一次。所以这步必须可重复执行。
 *
 *  目录是**扫出来**的（`assets/resources/tiles` + `assets/<bundle>/tiles`），
 *  不是写死的：2026-10-03 起贴图按章分到 ch02/ch03/ch04 三个小游戏分包里，
 *  写死一个目录就会漏掉三个 —— 而漏掉的后果正是上面那个静默失败。
 *
 *  用法： node tools/fix-tile-meta.js
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);
const ASSETS = path.join(ROOT, 'game-5-chaizi', 'assets');

function tileDirs() {
    const out = [];
    const fixed = path.join(ASSETS, 'resources', 'tiles');
    if (fs.existsSync(fixed)) out.push(fixed);
    for (const name of fs.readdirSync(ASSETS)) {
        if (!name.startsWith('ch')) continue;
        const d = path.join(ASSETS, name, 'tiles');
        if (fs.existsSync(d)) out.push(d);
    }
    return out;
}

let changed = 0;
let already = 0;
let orphans = 0;

for (const dir of tileDirs()) {
    const files = fs.readdirSync(dir);
    const pngs = new Set(files.filter((f) => f.endsWith('.png')));

    // ② 先清孤儿 meta
    for (const f of files) {
        if (!f.endsWith('.png.meta')) continue;
        if (pngs.has(f.slice(0, -'.meta'.length))) continue;
        fs.unlinkSync(path.join(dir, f));
        orphans++;
    }

    // ① 再把剩下的改成 sprite-frame
    // ⚠️ 必须**重新列一遍目录**：上面刚删掉的孤儿 meta 仍在最初那份 `files` 里，
    //    照着旧清单读会 ENOENT（本脚本 2026-10-03 真的这么崩过一次）。
    for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.png.meta')) continue;
        const p = path.join(dir, f);
        const m = JSON.parse(fs.readFileSync(p, 'utf8'));
        const type = m.userData && m.userData.type;
        if (type === 'sprite-frame') { already++; continue; }

        m.userData = m.userData || {};
        m.userData.type = 'sprite-frame';
        // 清掉旧的子资源登记 + 标记未导入 —— 逼 asset-db 重新走一遍 importer，
        // 生成 spriteFrame 子资源（uuid@xxxxx 那一份）。
        delete m.subMetas;
        m.imported = false;
        // 主资源不再重定向到 texture 子资源（改成 sprite-frame 后重定向目标会变）
        delete m.userData.redirect;
        fs.writeFileSync(p, JSON.stringify(m, null, 2) + '\n', 'utf8');
        changed++;
    }
    console.log(`  ${path.relative(ROOT, dir)}：${pngs.size} 张 PNG`);
}

console.log(`✓ 贴图 meta：改成 sprite-frame 的 ${changed} 个，本来就是的 ${already} 个`);
console.log(`✓ 清理孤儿 meta：${orphans} 个`);
if (changed > 0) {
    console.log('  下一步必须重跑一次构建，让 asset-db 重新导入并生成 spriteFrame 子资源。');
    console.log('  验证：构建产物对应 bundle 下每个贴图应出现 2 个 json（texture + spriteFrame）。');
}
