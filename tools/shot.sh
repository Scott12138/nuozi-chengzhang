#!/usr/bin/env bash
# 挪字成章 · 无头截图
# 用法： tools/shot.sh <输入html绝对路径 | http(s):// | file:// | 带查询参数的路径> <输出png绝对路径> <宽> <高> [倍数]
#
# 支持带查询参数的 URL（如 prototype/index.html?s=play&lv=1 直达关卡）——
# 这种路径不能用 [ -f ] 判断存在，所以先识别 scheme，否则会误报「找不到输入文件」。
set -euo pipefail
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
IN="$1"; OUT="$2"; W="${3:-1200}"; H="${4:-900}"; SCALE="${5:-2}"

case "$IN" in
  http://*|https://*|file://*) URL="$IN" ;;
  *)
    BASE="${IN%%\?*}"                       # 去掉查询串再做存在性检查
    [ -f "$BASE" ] || { echo "找不到输入文件：$BASE"; exit 1; }
    # ★ 必须转成绝对路径：相对路径拼出的 file://prototype/index.html 不是合法 URL，
    #   Chrome 不报错，直接截出一张空图（表现为「截图失败（文件为空）」）。
    ABS="$(cd "$(dirname "$BASE")" && pwd)/$(basename "$BASE")"
    URL="file://$ABS${IN#"$BASE"}"          # 保留 ?s=play&lv=1 这类查询串
    ;;
esac

mkdir -p "$(dirname "$OUT")"
"$CHROME" --headless --disable-gpu --hide-scrollbars --no-sandbox \
  --force-device-scale-factor="$SCALE" \
  --window-size="$W,$H" \
  --virtual-time-budget=4000 \
  --screenshot="$OUT" \
  "$URL" >/dev/null 2>&1
[ -s "$OUT" ] || { echo "截图失败（文件为空）：$OUT"; exit 1; }
echo "✓ $OUT"
