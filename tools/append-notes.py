# -*- coding: utf-8 -*-
"""追加：① skill 踩坑记录 ② 工作记忆日志"""
import io, os

SKILL = '/Users/consli/.workbuddy/skills/minigame-gdd-prototype/SKILL.md'
MEM = '/Users/consli/WorkBuddy/2026-10-01-19-57-04/.workbuddy/memory/2026-10-01.md'

APPEND_SKILL = """

---

## 附：挪对/拖拽类玩法的踩坑记录（v2 实测）

### 1. TDZ 陷阱 —— 这类原型最容易踩、最难查的一个
页面里若有 `boot()` IIFE 负责"评审直达参数"（`?s=play` 直接进关卡），**boot 调用到的所有 `let`/`const` 必须写在 boot 之前**。
`function` 声明会提升，`let`/`const` 不会 —— 报错是：

```
Uncaught ReferenceError: Cannot access 'X' before initialization
```

**症状极具误导性**：截图只显示"页面停在启动页"，看起来像跳转逻辑写错。
**排查方法**（记牢）：

```bash
"$CHROME" --headless=new --disable-gpu --no-sandbox --virtual-time-budget=4000 \\
  --enable-logging=stderr --log-level=0 --dump-dom "file://$PWD/index.html?s=play" \\
  2>&1 >/dev/null | grep -iE "Uncaught|SyntaxError|is not"
```

### 2. `clientWidth` 包含 padding
用 `wrap.clientWidth / cols` 算格子边长，会把棋盘撑出容器（右侧被裁掉一列）。必须减掉左右 padding：

```js
const cs = getComputedStyle(wrap);
availW = wrap.clientWidth  - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
availH = wrap.clientHeight - parseFloat(cs.paddingTop)  - parseFloat(cs.paddingBottom);
```

### 3. 首帧 `clientHeight` 可能是 0
元素刚由 `display:none` 切到 `flex` 时量不到高度。用**两次** rAF 再量，或给兜底值：

```js
requestAnimationFrame(() => requestAnimationFrame(() => { 量尺寸 + 渲染 }));
```

### 4. 死局检测必须先排除「已有可直接消除的对」
否则会把「场上明明有一对已经对齐、点一下就消」的局面误报成死局，玩家会认定游戏坏了。
必须单独写 `hasDirectMatch()` 并**先判它**：`死局 = !hasDirectMatch() && !findSuggest()`。

### 5. 关卡配比必须程序化生成 + 自测断言
手写关卡表极易出现「牌数 > 棋盘格数」→ 挤到没有空格 → 牌根本挪不动 → 玩法直接失效。
用 `pairs = min(目标值, floor((总格 − 3 − junk) / 2))` 硬夹，并在自测里对**全部关卡**断言「剩余空格 ≥ 3」。

### 6. 拖拽类玩法的自测方法（沿用 v1 的 vm 注入法，但 DOM 桩要补）
判定逻辑（`canPair` / `lineClear` / `matchTargets` / `findSuggest`）是纯数据运算，用「抽 script + 注入 DOM 桩 + vm 执行 + 末尾注入 `__EXPORT`」可全覆盖，**不用起浏览器**。
DOM 桩需额外提供：`getComputedStyle`、`setPointerCapture`、`getBoundingClientRect`，否则 `startLevel()` 会在拖拽相关代码上抛错。
导出 `let` 变量要用 getter（`getRunWords: () => runWords`），不能直接导出值。

### 7. 拖动跟手的实现要点
- 拖动期间必须 `el.style.transition = 'none'`，直接改 `left/top`（用 transform 跟手会让落点计算变麻烦）
- 松手后恢复 transition，位置吸附会自然补上归位动画
- 拖动中**每帧**做一次落点预判（模拟落位 → 调 `matchTargets` → 还原），这是"玩家能看懂规则"的关键
"""

APPEND_MEM = """
- **【拆字游戏 v2 重做：玩法从「连线」改为「挪对」】** 用户指正我上一版理解错了玩法——不是画线连线，而是参考《麻将挪对对》：**牌可以挪动**，拖动一张牌后，若它与另一张可配对的牌处于「同行或同列且中间无阻挡」，即配对合成汉字。
  - 查证到《麻将挪对对》**开发者自己写的规则原文**（16p.com）：① 相邻同款可直接点击消除；② 挪动牌 A 后若横向/纵向存在"直接连成一条线"的同款牌 B，则 A、B 一同消除。据此重写。
  - 关键改动：作废 0/1/2 折点判定与绕外圈；棋盘由"留大量空格"改为**接近铺满**（空置率 10%~30%，每关至少 3 空格）；道具改为 提示/洗牌/凑对；新增挪动求解器 `findSuggest`（提示、死局检测、自动演示三处共用）；新增"死局误报防护"（先判 `hasDirectMatch`）与连锁消除。
  - 原型视觉全面重做：国风宣纸底、赭黄（偏旁）/青玉（部件）双色牌、木牌玉牌质感、拖动跟手+倾斜+落点实时预判+金色虚线、合成汉字浮现动画。截图存 `shots/`。
  - 自测 32/32 通过（`tests/logic-test.js`），含 32 关全量配比校验。
  - 文档重写并改名：`docs/拆字挪对_游戏开发规格说明书.md`（原 v1 连线版内容已同步清理，v1 原型归档在 `prototype/_archive/v1-连线版.html`）。
  - 踩坑（已写入 skill `minigame-gdd-prototype`）：★ **TDZ 陷阱**——boot() 直达逻辑调用到的 `let/const` 必须声明在 boot 之前，否则报 `Cannot access 'X' before initialization`，表现为"页面停在启动页"，极易误判；★ `clientWidth` 含 padding 导致棋盘右侧被裁；★ 首帧 clientHeight 为 0 需双 rAF。
- **【待用户拍板】** ① 游戏名（候选：挪字成章 / 拆字挪对 / 一字千挪）；② 是否进入 M1（写小游戏工程代码）——建议先让 3~5 个真人玩原型。
- **【提醒】** 我的理解又偏了一次（连着两版玩法方向不同）。教训：用户说"参考某个现成游戏"时，**先把这个游戏的规则原文查到并复述给用户确认**，再动手做，不要凭品类名推测。
"""

with io.open(SKILL, 'a', encoding='utf-8') as f:
    f.write(APPEND_SKILL)
print('skill 已追加，当前行数 =', sum(1 for _ in io.open(SKILL, encoding='utf-8')))

os.makedirs(os.path.dirname(MEM), exist_ok=True)
with io.open(MEM, 'a', encoding='utf-8') as f:
    f.write(APPEND_MEM)
print('记忆日志已追加')
