#!/usr/bin/env bash
# ============================================================
#  wechat-send.sh · 把一张图片通过微信 Mac 客户端发给指定联系人
# ============================================================
#  【用法】
#    bash tools/wechat-send.sh <图片绝对路径> [联系人名]
#  联系人默认「文件传输助手」。
#
#  【为什么第一步是权限自检，而不是直接发】
#  微信 Mac 没有 AppleScript 字典（`Resources/*.sdef` 不存在），唯一可行的通路是
#  「剪贴板 + System Events 发按键」。而 `keystroke` 需要**辅助功能**授权，
#  授权是发给**宿主 App** 的（在 WorkBuddy 里就是 `com.tencent.workbuddy.mac`），
#  不是发给 osascript 的。
#
#  没授权时的原始报错长这样：
#      System Events 遇到一个错误：osascript 不允许辅助访问。 (-25211)
#  —— 完全看不出"要去哪点哪个开关"。所以脚本自己做一次探针，
#  失败就**把系统设置面板直接打开**并打印三行操作步骤，而不是把天书丢给用户。
#
#  【为什么联系人名和图片要分两次写剪贴板】
#  第一次写的是联系人名，粘进微信的搜索框；第二次换成图片，粘进聊天输入框。
#  全程**不用 keystroke 打字** —— 中文在 keystroke 下会走输入法，
#  打出来什么是听天由命的（可能变成拼音串）。粘贴反而更稳。
#
#  【发送前的安全边界】
#  权限不足时脚本在**动任何窗口之前**就退出（探针是第一步），
#  不会出现"把字打进了用户正在写的文档里"这种事。
# ============================================================
set -uo pipefail

IMG="${1:?用法: bash tools/wechat-send.sh <图片绝对路径> [联系人名]}"
WHO="${2:-文件传输助手}"
PANEL='x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'

if [ ! -f "$IMG" ]; then
    echo "❌ 图片不存在：$IMG"
    exit 2
fi
IMG="$(cd "$(dirname "$IMG")" && pwd)/$(basename "$IMG")"

# ---------- 第 0 步：微信得在跑 ----------
if ! pgrep -x WeChat >/dev/null 2>&1; then
    echo "（微信未运行，正在启动…）"
    open -a WeChat
    for _ in $(seq 1 24); do
        pgrep -x WeChat >/dev/null 2>&1 && break
        sleep 0.5
    done
    pgrep -x WeChat >/dev/null 2>&1 || { echo "❌ 微信没起来，请手动登录后重跑。"; exit 2; }
fi

# ---------- 第 1 步：辅助功能权限探针（必须在动窗口之前） ----------
# ★★ 探针必须**真的去读一个 UI 属性** ★★
#  第一版写的是 `... tell process "WeChat" to return 1` —— 那是个**假通过**：
#  它不触碰任何 UI 元素，TCC 的辅助功能检查根本不会被触发，于是脚本一路往下走，
#  在真正发按键时才炸。而那时已经"激活了微信、按过 ⌘F"了，
#  **半路失败比不开始更糟**（可能把字打进用户正在写的文档里）。
#  实测对照：`return 1` → 成功；`return (count of windows)` → -25211 不允许辅助访问。
if ! osascript -e 'tell application "System Events" to tell process "WeChat" to return (count of windows)' >/dev/null 2>&1; then
    echo "❌ 缺少「辅助功能」授权 —— 这是 macOS 的限制，脚本无法自行绕过。"
    echo
    echo "请做一次下面的设置（只需一次，之后一直有效）："
    echo "  1) 打开：系统设置 → 隐私与安全性 → 辅助功能"
    echo "  2) 勾选 **WorkBuddy**（com.tencent.workbuddy.mac）"
    echo "  3) 回到这里重跑同一条命令"
    echo
    echo "正在为你打开该设置面板…"
    open "$PANEL" 2>/dev/null || echo "（面板没能自动打开，请手动前往）"
    exit 3
fi

# ⚠️ 变量一律写成 ${WHO} 带花括号 —— macOS 自带的是 bash **3.2**，
#    它在 `$WHO」` 这种"变量名后面紧跟多字节字符"的写法上会把 `」` 的字节
#    并进变量名，报 `WHO?: unbound variable`（真实踩过）。
#    本机 bash --version = 3.2.57。
echo "✅ 辅助功能授权正常，开始发送：${IMG} → ${WHO}"

# ---------- 第 2 步：联系人名进剪贴板 ----------
printf '%s' "$WHO" | pbcopy

# ---------- 第 3 步：唤起微信、搜索联系人、进聊天 ----------
osascript <<'APPLESCRIPT' >/dev/null
tell application "WeChat" to activate
delay 0.8
tell application "System Events"
    tell process "WeChat"
        -- ⌘F = 微信 Mac 的「搜索」
        keystroke "f" using command down
        delay 0.7
        keystroke "v" using command down
        delay 0.9
        key code 36          -- 回车，跳到第一个搜索结果 = 该联系人
        delay 0.9
    end tell
end tell
APPLESCRIPT

# ---------- 第 4 步：图片进剪贴板并粘贴发送 ----------
osascript -e "set the clipboard to (read (POSIX file \"$IMG\") as «class PNGf»)" >/dev/null

osascript <<'APPLESCRIPT' >/dev/null
tell application "System Events"
    tell process "WeChat"
        delay 0.5
        keystroke "v" using command down    -- 粘进聊天输入框
        delay 1.2
        key code 36                          -- 回车发送
        delay 0.4
    end tell
end tell
APPLESCRIPT

echo "✅ 已发送。若微信里「回车」被设置成「换行」，图片会留在输入框 —— 手动按一下发送即可。"
