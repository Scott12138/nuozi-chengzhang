# S11 · 贴图管线重做：128px + 按章分包 + 全库 248 张重烘（2026-10-03）

用户拍板 → 实测 → 落地 → 自证的完整链条。
**数值口径的权威文档是 `docs/关卡设计_S11-10x12定稿与贴图体积复核.md`（尤其 §八）。**

## 一、拍板原话

> **「我要重新拍板：1、最多出现两个=2组（4张牌）；2、偏旁不超过 4 张=盘面牌数 ≤4（=4 组）；**
> **3、扩库范围=按稿全补 42 字；4、尺寸最多是10*12（10列，12行，避免超出屏幕）；**
> **5、贴图方案=降贴图分辨率；6、从6*7即可出现宝牌。」**

第 5 条的二次拍板（选项卡片）：

| 问题 | 用户选择 |
|---|---|
| 贴图路线（降分辨率到哪一档 / 要不要分包） | **128px + 按章分包** |
| 末章 L34~L38 是否在顶格档内再加密 | **保持一样** |

## 二、这一轮做了什么

| # | 动作 | 结果 |
|---|---|---|
| 1 | 字形库重建（`build-glyphs.py`） | 272 → **352 字**，缺 **0**，`songti: 0` |
| 2 | 关卡数据重生成 | `WORDS` 103→145、38 关、4 章；字频三条硬断言通过 |
| 3 | 贴图管线重写（`make-tile-atlas.py`） | **128px**、**按章输出**、字单来自 JSON（不再手写） |
| 4 | 全库重烘 | **248 张**（46 / 71 / 63 / 68），4.38 MB，单张均值 17.7 KB |
| 5 | 分包落地（`make-chapter-bundles.py`） | `ch02` / `ch03` / `ch04` 三个小游戏分包 |
| 6 | 构建 + 体积体检 | **主包 3.11 MB** ✅（红线 4MB，余 0.89 MB） |
| 7 | 核心自检 | 断言 86 → **102 条**，失败 0 |
| 8 | 无头冒烟（进 L3 实测） | 硬断言全过、**贴图加载失败 0 条** |
| 9 | 真机试玩码 | 已生成并解码验证 |

## 三、体积（★ 两个数字，别混）

| 口径 | 数值 | 说明 |
|---|---|---|
| 本仓体检脚本 `tools/build-size-report.py` | 主包 **3,262,718 B = 3.11 MB** | 按真实字节累加（`st_size`） |
| 微信开发者工具 `preview-info.json` | main **3,230,703 B = 3.08 MB** | mp 后台看到的口径，略有差异属正常 |
| 全部分包 | 3,826,646 B = 3.65 MB | 单个普通分包不限大小 |
| 合计（主包 + 分包） | **7,089,364 B = 6.76 MB** | 上限 30 MB ✅ |

> ⚠️ **不要用 `du -sh build/wechatgame` 判断主包** —— 它给的是含分包的 **9.3M**（块对齐 + 含分包），
> 拿它跟 4MB 比会得出"超了 5.3MB"的错误结论。

分包明细：`ch02` 1.29 MB / `ch03` 1.15 MB / `ch04` 1.21 MB。
`build/wechatgame/game.json` 已出现：

```json
"subpackages": [
  { "name": "ch04", "root": "subpackages/ch04/" },
  { "name": "ch03", "root": "subpackages/ch03/" },
  { "name": "ch02", "root": "subpackages/ch02/" }
]
```

## 四、★ 落地时挖出的真问题：**62 个字根本没有字形**

扩库 42 字只改了 `WORDS`，**没有重跑字形抽取** → `design/glyphs-data.js` 停在 272 字。

后果完全静默：`InkGlyphs.path()` 对缺失字返回空串，烘出来是「有纸、有印、就是没字」的空白牌，
而烘焙自检只判"浅色纸底够不够多"，**照样通过**。

缺 62 字（第 2 章 30 / 第 4 章 22 / 第 1、3 章各 5），其中 **`弦`、`炮` 是第 3 关顶栏的目标字**
—— 也就是说，**已经发给用户试玩的包里就有两个空字**。

- ✅ 已修：重跑 `build-glyphs.py`，352 个目标字**全部命中马善政字体**，无系统字体尾巴
- ✅ 新增闸门：`tools/check-glyph-coverage.js` 从字单读字、逐章报缺字，有缺即退出码 1
- ⚠️ 副作用：并集包围盒变了 → **全部字形都跟着微调了一次尺度**（设计使然，防止"艹和木一样大"）

## 五、自证证据

| 文件 | 内容 |
|---|---|
| `device/真机预览二维码.png` | 真机试玩码（470×470），已用 Vision 框架解码验证 `https://mp.weixin.qq.com/a/~~FZivYMAMF3Q~...` |
| `device/preview-info.json` | 微信口径的包体明细（main 3,230,703 B） |
| `smoke/L3-盘面.png` | 第 3 关 6×7 实拍：**30 张牌面全部有字**，顶栏「弦 / 炮」也正常显形（就是上面那两个以前没字形的字） |
| `smoke/地图页.png` | 关卡地图页零回归（奖杯 / Q 版锁 / 虚线路径） |
| `smoke/console.log` | 冒烟全量控制台，搜 `贴图加载失败` 为 **0 条** |
| `smoke/体积体检.txt` | `build-size-report.py` 原始输出 |

## 六、复现（按顺序，每步都有自检）

```bash
# ── 数据链（改了字表就必须从第 1 步开始）──
python3 tools/build-glyphs.py                     # 字体 → 字形轮廓（缺 0 才算过）
node tools/check-glyph-coverage.js                # 每个要用的字都有非空轮廓
node tools/gen-cocos-leveldata.js                 # 字单 → LevelData.ts + /private/tmp/chaizi-tile-chars.json

# ── 贴图链 ──
python3 tools/make-chapter-bundles.py             # 建分包目录 + 写 builder.json（幂等）
python3 tools/make-tile-atlas.py                  # 128px 按章烘；只烘第 1 章可写 `1`
bash tools/cocos-build.sh wechatgame release      # 首轮让 asset-db 导入
node tools/fix-tile-meta.js                       # 改成 sprite-frame + 清孤儿 meta
bash tools/cocos-build.sh wechatgame release      # 二轮才是真产物
python3 tools/build-size-report.py                # ★ 验收：主包 ≤ 4MB
node tools/core-selftest.js                       # 102 条断言

# ── 冒烟与真机码 ──
bash tools/cocos-build.sh web-desktop debug       # ★ 必须 debug，release 剥掉日志
bash tools/smoke-run.sh web-desktop /tmp/s11-l3 \
  "unlock:3:3" "wait:2500" "d:0,-534" "p:chap" "d:0,335" "p:map" \
  "wait:1400" "d:255,77" "p:game" "wait:3800"
bash tools/wechat-preview.sh game-5-chaizi release docs/verify/S11/device
```

> 🔴 `d:` 用的是 **720 设计空间**的坐标（原点=屏幕中心、y 向上），而页面里的 `[Layout]` 日志
> 打的是 **372 单位**的坐标。换算：`x720 = (X372 − 186) × 1.9355 ÷ (画布宽/720)`，
> 冒烟里画布宽 600 → `x720 = (X372 − 186) × 1.6129`。
> 本轮就在这上面栽了一次：把 `[Layout] .node[2] x=283.7` 直接当成 `d:132`，点击落空、断言失败。

## 七、没做的（下一轮的入口）

1. **`core/Board.ts` 发宝牌** —— `LevelDef.tr` 已就位、贴图已备齐，机制没接。**这是 L3 起"可玩"的真正阻塞点。**
2. **`junk` 全线下线** —— `JUNK_CHARS` / `buildDeck` 的 junk 循环 / `texNameOf` 的 junk 分支还在
   （`JUNK_TEX` 已生成成空表）。
3. **`TileAtlas` 按章加载** —— 目前只查 `resources/`（第 1 章够用）；进第 2 章前要 `loadBundle('ch0N')`，
   配合 `wx.preloadSubpackage` 预拉。
4. **宝牌素材出图** —— 花瓶 / 水盆 + 特殊配色，按约定先定用途与约束再出图。
5. **求解器 `tools/solve-exact.js` 仍缺失** —— 「开局确定有解」无从验证。
