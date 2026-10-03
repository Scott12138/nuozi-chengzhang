# S7 · 干扰字清理 + 广告降级文案收口（2026-10-03）

用户拍板 → 事实核对 → 落地 → 自证的完整链条。

## 一、拍板原话

> **「1、首页顶部小字「文·字·拆·合」不动，图页未开放节点的「待」字去掉，已经有锁标志来表示了；**
> **2、CFG.AD.REWARD_UNIT_ID 仍是空串，激励视频两处走直接发放降级，这是什么意思，你具体解释一下，我再拍板；**
> **3、5 个生僻字换成不那么生僻的，常见的，能授权的字体的字」**

对第 2 条解释后的二次拍板（选项卡片）：

| 问题 | 用户选择 |
|---|---|
| `CFG.AD.REWARD_UNIT_ID` 怎么处理 | **维持空串 + 修掉外泄文案** |
| 「罒」换成什么 | **直接删掉，不替换（池子 10→9）** |

## 二、三条拍板的事实核对（**两条与预想不一样**）

### ①-a 首页小字「文·字·拆·合」不动
无操作。首页本来就那一行，未触碰。

### ①-b 地图页未开放节点去掉「待」字 —— **已经没有了，无需改**
`MapPage.buildLockedNode()` 现在是「淡底盘 + Q 版锁」，**全项目 `assets/scripts` 里没有任何一处渲染「待」字**
（Grep `待` 只命中注释里的"待开发"）。

实拍佐证：`docs/verify/S7/01-地图页三态复核.png`（L4~L8 全是锁，无文字）。
与 S6 归档图逐像素比对：**平均差 0.12/255，差异 >24 的像素仅 0.21%**（来自贴图重烘的边缘 AA）。

> ⚠️ 教训：用户提的"要改的东西"**先确认它在不在**。否则会白改一遍，还多出一次构建 + 一次真机码。

### ② 激励视频：空串 + 两处降级，究竟是什么意思

**两处调用点**（都走 `ui/AdService.showReward()` 这一个出口）：

| 触发 | 位置 | 玩家看到 |
|---|---|---|
| 死局 → 看广告重排 | `GamePage.onAdReward()` | 弹层「卡住了 / 看广告重排」 |
| 失败 → 看视频复活 | `GamePage.onReviveAd()` | 失败弹层「看视频复活」 |

`showReward` 读 `CFG.AD.REWARD_UNIT_ID`：
- **空串 或 非微信环境** → 直接回调 `'degraded'`，调用方把 `degraded` 与 `rewarded` **同等对待** → **白送奖励**；
- 填了真值 → 真拉 `wx.createRewardedVideoAd`，只有 `isEnded` 才给奖励。

**为什么会让它空着（已用 WebSearch 核实，来源 `ad.weixin.qq.com/docs/280` + 腾讯广告培训材料）**：
微信小游戏流量主开通门槛 = **累计独立访客 UV ≥ 1000 且无严重违规记录**；开通后才有
「推广 → 流量主 → 激励式广告」可创建广告位拿到 `adunit-xxxx`。首版达不到量 → **填不了真值**。
所以空串在首版不是"忘了填"，是**唯一现实选择**。

**发现并修掉的真问题（用户拍板"A"）**：
过去 `CFG.AD.DEGRADED_TOAST = '未接入广告位，直接为你重排（上线前请填 CFG.AD.REWARD_UNIT_ID）'`
是**弹给玩家看的** —— 玩家会在游戏里读到变量名。而且它同一 tick 就被 `afterAdReshuffle()` 里的
「盘面已重排」覆盖（Toast 是单实例、直接覆写 Label），**从来没显示过**。
→ 一行既外泄又无效的死代码。已整条删除。

### ③ 「5 个生僻字」—— **实际只有 1 个字真进过贴图，而且它从没被摆上棋盘**

`tools/build-glyphs.py --dry`（改前的真源）实测：

```
目标字符 274 个 / 命中 274 / 缺 0
  msj: 272 字      songti: 2 字
⚠️ 由系统宋体补的字：匸 罒
```

代码注释里写的「5 个生僻字（匊 夆 戉 枼 罒）」是**旧版残留**：

| 字 | 改前状态 | 38 关里出现过吗 | 本轮处理 |
|---|---|---|---|
| **罒** | 在 `JUNK_CHARS`(第 7 位) + 烘了贴图 `j_7f52.png` | ❌ **一次都没摆上棋盘** | 从 5 处 JUNK 清单删除 |
| **匸** | 只在 `build-glyphs.py` 的 `JUNK_POOL` 候选池 | ❌ 连贴图都没烘 | 从池子删除 |
| 匊 夆 戉 枼 | 只在旧的 `design/glyphs-data.js` 里 | ❌ 游戏代码零引用 | 重跑生成器后**自动消失** |

> **为什么「罒」38 关都用不到**：`Board.buildDeck()` 用
> `JUNK_CHARS[i % JUNK_CHARS.length]` 取字，而 38 关的 `junk` 取值只有 3（8 关）和 4（30 关）
> → **只取前 4 个：疒 匚 彳 卩**。`冫 屮 罒 丬 廾 弋` 这 6 个永远取不到。
>
> 换句话说：**「罒」从来没有以一个"能看见的问题"的形式存在过**。
> 它的唯一真实危害是让字形库一直挂着一条"用了不可分发的系统字体"的尾巴。

拍板选「直接删掉，不替换」→ 池子 10 → 9。

## 三、落地清单

### A. 干扰字清理（一条链，改一处要同步 5 个文件）

| 文件 | 角色 | 改动 |
|---|---|---|
| `prototype/index.html` | **真源** `JUNK_CHARS` | 删 `罒` |
| `tools/gen-cocos-leveldata.js` | 生成器（从真源抽） | 顺手把写死的"10 干扰"改成从数据算 |
| `game-5-chaizi/assets/scripts/core/LevelData.ts` | 生成物 | 重新生成 → `["疒","匚","彳","卩","冫","屮","丬","廾","弋"]` |
| `tools/make-tile-atlas.py` | 烘贴图 + 出 `TileManifest.ts` | `JUNK` 删 `罒`，重烘 |
| `tools/check-glyph-coverage.js` | 字形自检 | `JUNK` 删 `罒` |
| `tools/level-design-check.js` | 关卡设计自检 | `JUNK_CHARS` 删 `罒` |
| `tools/build-glyphs.py` | 字形轮廓生成 | `JUNK_POOL` 删 `罒` **和 `匸`** |
| `design/glyphs-data.js` | 生成物 | 重新生成 |
| `game-5-chaizi/assets/resources/tiles/j_7f52.png` + `.meta` | 贴图 | **删除**（含 `library/`+`temp/` 里的 uuid 缓存） |

**重跑后 `build-glyphs.py` 的输出**：
```
目标字符 272 个 / 命中 272 / 缺 0
  msj: 272 字          ← songti 归零，那行 ⚠️ 不再出现
```

`design/glyphs-data.js` 头部也**自动改写**（来源段按 `songti` 是否为空动态生成）：
```
 *   · 马善政毛笔楷书 (Ma Shan Zheng) — SIL OFL 1.1 …
 *   ·（无系统字体补字 —— 全部字形都出自上面这支 OFL 字体，可随产品分发）
```
`origin` 取值只剩 `msj`，`source` 字段 = `MaShanZheng(OFL)`。

### B. 广告降级文案收口

| 文件 | 改动 |
|---|---|
| `CFG.ts` | 删掉 `DEGRADED_TOAST`；补一段"玩家可见文案里不许出现开发者字样"的规则说明 |
| `ui/AdService.ts` | 新增 `static audit()`：**在微信环境里发现空串 → `error` 级**；非微信环境只打 log |
| `ui/GamePage.ts` | `onAdReward` 删掉那次 toast；`onReviveAd` 的第二行「（…直接发放）」删掉 |
| `Bootstrap.ts` | 在 `mountGameRoot()` 末尾调 `AdService.audit()`（该函数有幂等闸，全生命周期只跑一次），用 try/catch 包住 |

> ★ `audit()` 为什么**在 web 端不报**：无头冒烟与本地预览都跑 web-desktop，那里本来就没有 `wx`，
> 空串是正常态。不加这层判断，每次冒烟都刷一条 error，很快被当噪声 —— **噪声化的告警等于没有告警**。

## 四、自证

### 1. 源码与产物双向清场（grep 判据）

| 判据 | 结果 |
|---|---|
| 源码里 `j_7f52` / `罒` 残留 | **0** |
| 产物里旧贴图 uuid `03893159` | **0** |
| 产物里 `上线前请填` / `未接入广告位` / `直接发放）` / `REWARD_UNIT_ID）` | **全部 0** |

> ⚠️ 这里踩过一个自己的坑：第一版"删掉旧文案"的**注释里逐字引用了旧文案**，
> debug 构建会把注释打进包 → grep 判据当场自打脸。已改成"描述原句"而不是"引用原句"。
> **debug 构建的产物 grep 会把注释算进去 —— 写注释时别把要清掉的字符串原样抄一遍。**

### 2. 三条冒烟链路（`bash tools/smoke-run.sh …`）

```bash
# ① 地图页三态（确认删贴图后页面零回归）
bash tools/smoke-run.sh web-desktop /tmp/s7-map \
  "unlock:2:3" "wait:2500" "d:0,-534" "p:chap" "d:0,335" "p:map" "wait:1400"

# ② 失败 → 看视频复活
bash tools/smoke-run.sh web-desktop /tmp/s7-revive \
  "unlock:1" "wait:2200" "seed:4" "time:6" \
  "d:0,-534" "p:chap" "d:0,335" "p:map" "d:-252,359" "p:game" \
  "wait:9000" "gate:时间到了" "wait:900" "d:0,-90" "wait:2600" "t:复活成功，时间 +30 秒"

# ③ 死局 → 看广告重排（seed:7 / seed:13 都能稳定卡住）
bash tools/smoke-run.sh web-desktop /tmp/s7-reshuffle \
  "unlock:1" "wait:2000" "seed:7" \
  "d:0,-534" "p:chap" "d:0,335" "p:map" "d:3,208" "p:game" "wait:2000" \
  "drag:80@120" "gate:卡住了" "wait:800" "d:0,-74" "wait:2200" "t:重排"
```

三条全部 ✅。关键控制台原文（存档见 `smoke/`）：

```
②  [FailGate] 弹出：时间到了 / 看视频复活
    [AdService] 未接入激励视频（CFG.AD.REWARD_UNIT_ID 为空 / 非微信环境）→ 直接发放
    [Toast] 复活成功，时间 +30 秒                      ← 单行，第二行已删 ✅

③  [AdGate] 弹出：卡住了 / 看广告重排
    [GamePage] 请求激励视频（看广告重排）
    [AdService] 未接入激励视频（…）→ 直接发放
    [AdGate] 关闭
    [GamePage] 看广告重排 → 有解
    [Toast] 盘面已重排                                 ← 全场只有这一条 Toast ✅
    旧开发者文案命中数 = 0

①②③ [AdService] 广告位自检：非微信环境（web / 本地预览），跳过   ← 新自检已生效
```

盘面取字复核（②③ 的 `[Diag] TILES` 里都只有 `疒 匚 彳`，**没有 `罒`**）。

### 3. 版式回归（`layout-diff.py` 关注项）

地图页 dump 与 S6 逐项对齐，**一行没动**：

| 项 | S6 | S7 |
|---|---|---|
| `.topbar` h | 123.5 | **123.5** |
| `.map-info` y | 123.5 | **123.5** |
| 节点三列 x | 20.2 / 151.9 / 283.7 | **20.2 / 151.9 / 283.7** |
| 行步距 | 78.0 | **78.0** |

### 4. 包体与真机码

| 项 | 上版（S6） | 本版（S7） | 差 |
|---|---|---|---|
| 微信包 | 3291568 B | **3270727 B** | **−20841**（≈ 少掉那张 192×192 干扰牌贴图） |
| web 产物贴图 | 30 张 | **29 张** | −1 |

真机预览码：`docs/verify/S7/device/真机预览二维码.png`（470×470，31147 B）

**用两个互相独立的解码器交叉验证**（生成成功 ≠ 真的能扫）：

| 解码器 | 结果 |
|---|---|
| `tools/wechat-preview.sh` 第 7 步（脚本内置） | `OK https://mp.weixin.qq.com/a/~~qzFKA-xk2iE~tqck4XpGUEoSeiQlO_iWfg~~` |
| `cv2.QRCodeDetector()`（另一套实现，独立复算） | `https://mp.weixin.qq.com/a/~~qzFKA-xk2iE~tqck4XpGUEoSeiQlO_iWfg~~` |

> ⚠️ **预览码只有最新一张有效**，重跑构建 / 重跑出码脚本都会让上一张失效。

## 五、仍未决

- 真机试玩后拍板（本轮唯一需要用户手感确认的点：干扰字只剩 9 个，实际摆上棋盘的还是 `疒 匚 彳 卩` —— 玩法手感**零变化**）
- 微信发送链路仍卡在 **macOS 辅助功能授权**（`-25211`），详见 `tools/wechat-send.sh` 与用户级记忆
- 历史遗留：图鉴页 / 设置页 / 路由（#68–#76）、5 个生僻字之外的字体授权问题（现已清零）
