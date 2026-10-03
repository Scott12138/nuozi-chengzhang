#!/usr/bin/env bash
# 挪字成章 · 打印版页面画廊 → PDF
# 用法： tools/make-pdf.sh <输入html绝对路径> <输出pdf绝对路径> [宽mm] [高mm]
#
# 为什么要单独一个脚本：tools/shot.sh 走的是 --screenshot（栅格图），
# 而 PDF 要走 Chrome 的打印管线（--print-to-pdf）。两者的分页行为完全不同 ——
# 打印管线认 @page 与 page-break，所以打印版 HTML 里用固定高度的 .sheet 定死页码。
set -euo pipefail
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
IN="$1"; OUT="$2"

[ -f "$IN" ] || { echo "找不到输入文件：$IN"; exit 1; }
ABS="$(cd "$(dirname "$IN")" && pwd)/$(basename "$IN")"

mkdir -p "$(dirname "$OUT")"

# --virtual-time-budget 要够大：22 张 JPEG 要先解码完，否则会截到还没画完的页
# --no-pdf-header-footer 去掉页眉页脚（Chrome 111+；老版本是 --print-to-pdf-no-header）
"$CHROME" --headless --disable-gpu --no-sandbox \
  --no-pdf-header-footer \
  --virtual-time-budget=30000 \
  --print-to-pdf="$OUT" \
  "file://$ABS" >/dev/null 2>&1

[ -s "$OUT" ] || { echo "输出失败（文件为空）：$OUT"; exit 1; }
echo "✓ $OUT  $(du -h "$OUT" | cut -f1)"
