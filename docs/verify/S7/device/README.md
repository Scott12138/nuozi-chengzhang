# S7 · 真机预览二维码（2026-10-03）

| 项 | 值 |
|---|---|
| 图片 | `真机预览二维码.png`（470×470，31147 B） |
| 解码内容 | `https://mp.weixin.qq.com/a/~~qzFKA-xk2iE~tqck4XpGUEoSeiQlO_iWfg~~` |
| 包体 | **3270727 字节（3.12 MB）** —— 微信首包红线 4MB，余量 0.88MB |
| AppID | `wx817f07150e00efa1` |
| 出码命令 | `bash tools/wechat-preview.sh`（构建 → 出码 → 转真 PNG → 解码自检 → 归档，一条命令） |

## 解码验证用了两套互相独立的实现

生成成功 ≠ 真的能扫，所以脚本第 7 步会自己解一次；本轮又用另一套实现复算了第二次：

```
# ① 脚本内置（wechat-preview.sh 第 7 步）
OK https://mp.weixin.qq.com/a/~~qzFKA-xk2iE~tqck4XpGUEoSeiQlO_iWfg~~

# ② 独立复算：OpenCV
python3 -c "
import cv2; d=cv2.QRCodeDetector()
print(d.detectAndDecode(cv2.imread('真机预览二维码.png'))[0])"
https://mp.weixin.qq.com/a/~~qzFKA-xk2iE~tqck4XpGUEoSeiQlO_iWfg~~
```

两者一致 ✅

## ⚠️ 语义提醒

**预览码只有最新一张有效。** 任何一次重新构建 / 重新出码都会让上一张作废 ——
所以只交当前这一张，不要与 S6 归档里的旧码混用。

## 本轮改了什么（试玩时值得重点看的地方）

1. **干扰字池 10 → 9**（删掉「罒」）。实际摆上棋盘的仍是 `疒 匚 彳 卩` 这 4 个 ——
   **玩法手感零变化**，试玩时不需要特意找差异。
2. **激励视频降级时的玩家文案收口**：死局重排只弹「盘面已重排」；复活只弹
   「复活成功，时间 +30 秒」（过去会多一行"广告位没接入"的开发者说明）。
3. 启动期新增一条 console 自检（源码与产物里的 `REWARD_UNIT_ID` 目前仍是空串 ——
   这是拍板结果，不是漏改）。
