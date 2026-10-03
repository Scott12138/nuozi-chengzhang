#!/usr/bin/env bash
# ============================================================
#  smoke-run.sh · 一条命令跑完「起服务器 → 无头冒烟 → 收服务器」
# ============================================================
#  【为什么必须封装成一整条命令，而不是"先起服务器再跑测试"】
#  Bash 工具的后台进程**在工具调用结束时就会失去权限/被回收**：
#    第一轮：起服务器 → curl 返回 200 ✅
#    第二轮：curl 返回 502 ❌（后台的 http.server 已经没了）
#  表现极具误导性 —— 冒烟脚本报的是
#    "canvas: null / Cannot read properties of null (reading 'left')"，
#  看起来像"游戏白屏"，实际是"静态服务器死了"。
#  所以：服务器必须与测试处在**同一次前台调用**的生命周期内。
#
#  【用法】
#    bash tools/smoke-run.sh <产物目录名> <输出目录> "<动作1>" "<动作2>" ...
#  例：
#    bash tools/smoke-run.sh web-desktop /tmp/t4 "d:0,-118" "d:0,275" "dirty:6"
#  默认产物目录 web-desktop（= build/web-desktop）。
# ============================================================
set -euo pipefail

BUILD_DIR="${1:-web-desktop}"
OUT_DIR="${2:?用法: smoke-run.sh <产物目录> <输出目录> <动作...>}"
shift 2

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT=8123
NODE=/Users/consli/.workbuddy/binaries/node/versions/22.22.2-3/bin/node

# 清掉上一轮可能残留的 Chrome 与服务器（否则 CDP 会连到旧实例上，
# 旧实例里的页面早已失效，报错同样是误导性的 "canvas: null"）
#  ★ 2026-10-02 追加 `cocos-cdp-profile` 这一条：
#    Chrome 用同一个 --user-data-dir 启动时会把新进程委派给已在运行的实例，
#    结果是"改了 SMOKE_VIEW 却读到上一轮的窗口尺寸"，看着像参数没生效。
#    所以除了按端口清，还要按 profile 名清一遍，并把旧的 profile 目录删掉。
#  ★★ 2026-10-02 二次加固：改成**按端口清**，不再按命令行/名字匹配 ★★
#  踩过的坑（本轮实际发生，且极具误导性）：
#    上一次会话残留的 Chrome 仍占着 9333，新实例虽然带了独立的 --user-data-dir，
#    仍被 macOS 上的老实例"委派"复用 —— 于是 CDP 连上的是**老的标签页**。
#    表现：静态服务器确实在服务本工程的产物（/tmp/http8123.log 里全是我们的请求），
#         但 console.log 里全是**另一个项目**的日志、页面断言报"还没有任何切页日志"。
#    按名字 pkill 不可靠 —— 老进程的实际 cmdline / profile 名都可能对不上，
#    但**端口一定对得上**。
CDP_PORT=9333
for p in "$PORT" "$CDP_PORT"; do
    pids=$(lsof -ti "tcp:$p" 2>/dev/null || true)
    if [ -n "$pids" ]; then
        echo "==> 清理占用 :$p 的进程：$(echo $pids | tr '\n' ' ')"
        # shellcheck disable=SC2086
        kill $pids 2>/dev/null || true
    fi
done
sleep 1
pkill -f 'cocos-cdp-profile' 2>/dev/null || true
rm -rf /tmp/cocos-cdp-profile*

/usr/bin/python3 -m http.server "$PORT" --directory "$ROOT/game-5-chaizi/build/$BUILD_DIR" \
    > "/tmp/http${PORT}.log" 2>&1 &
SRV=$!
# 收尾：服务器与 Chrome 都要清。
# ★ 只清服务器是不够的 —— 冒烟脚本若因为异常/超时提前退出（本轮遇到过
#   "unsettled top-level await"），它自己的 chrome.kill 就跑不到，残留的
#   Chrome 会一直占着 9333；下一轮的实例会被它"委派"复用，CDP 连到的是老标签页。
#   所以退出时**按端口**再清一遍，和开头那三道防线对称。
trap 'kill "$SRV" 2>/dev/null || true
      for p in "$PORT" "$CDP_PORT"; do
          pids=$(lsof -ti "tcp:$p" 2>/dev/null || true)
          if [ -n "$pids" ]; then kill $pids 2>/dev/null || true; fi
      done' EXIT

# ★ 服务器**必须是我们的进程还活着**才算就绪。只看 curl 返回 200 是不够的：
#   端口被别人的 server 占着时 curl 一样 200，但它服务的是别人的产物。
if ! kill -0 "$SRV" 2>/dev/null; then
    echo "❌ 静态服务器启动失败（端口 $PORT 被占用？）日志："
    cat "/tmp/http${PORT}.log" 2>/dev/null
    exit 1
fi

# 等服务器真的能应答再往下走（--noproxy：避免本机代理把 127.0.0.1 也劫走）
for _ in 1 2 3 4 5 6 7 8 9 10; do
    code=$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/index.html" || true)
    [ "$code" = "200" ] && break
    sleep 0.5
done
if [ "$code" != "200" ]; then
    echo "❌ 静态服务器未就绪（HTTP $code），产物目录是否构建过？$ROOT/game-5-chaizi/build/$BUILD_DIR"
    exit 1
fi
echo "==> 静态服务器就绪（HTTP 200）"

# ★ 内容自检：确认服务出来的**确实是本工程**的产物。
#   端口被别人占着时 curl 一样 200，但它服务的是别的页面；此时页面断言会失败，
#   报的却是"还没有任何切页日志"，排查方向被完全带偏（本轮就是这么被坑的）。
MARKER="挪字成章"
# ⚠️ 两个都踩过：
#  ① 必须**先落盘再 grep**。写成 `curl … | grep -q` 时，grep 命中后立刻退出会让
#     curl 吃到 SIGPIPE 返回非 0，配上 set -o pipefail 就变成"明明找到了却报没找到"。
#  ② 变量一律写 `${MARKER}`。写成 `$MARKER」` 时，bash 会把紧随其后的全角字符
#     当成变量名的一部分（locale 相关的坑），报 `MARKER」: unbound variable`。
curl -s --noproxy '*' -o "/tmp/smoke-marker-${PORT}.js" \
    "http://127.0.0.1:${PORT}/assets/main/index.js" || true
if ! grep -q "${MARKER}" "/tmp/smoke-marker-${PORT}.js" 2>/dev/null; then
    echo "❌ 产物自检失败：assets/main/index.js 里找不到「${MARKER}」"
    echo "   → 要么端口 $PORT 上跑的是别人的 server，要么 build/$BUILD_DIR 是陈旧/别的工程的产物"
    exit 1
fi
echo "==> 产物自检通过（含标记「${MARKER}」）"

rm -rf "$OUT_DIR"
"$NODE" "$ROOT/tools/web-smoke.mjs" "http://127.0.0.1:${PORT}/index.html" "$OUT_DIR" "$@"
