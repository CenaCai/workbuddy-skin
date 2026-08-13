#!/bin/bash
# 一键换肤：退出 WorkBuddy → 带调试端口重启 → 注入背景
# 用法:
#   ./apply-skin.sh --image /path/to/bg.png            # 注入指定背景图
#   ./apply-skin.sh --image bg.png --opacity 0.6       # 自定义遮罩
#   ./apply-skin.sh --css my-theme.css                 # 使用自定义 CSS
#   WB_SKIN_PORT=9333 ./apply-skin.sh --image bg.png   # 自定义端口
#
# 注意: 会重启 WorkBuddy（当前对话会中断），请在系统终端中运行本脚本。

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${WB_SKIN_PORT:-9222}"
APP="/Applications/WorkBuddy.app"
ELECTRON="$APP/Contents/MacOS/Electron"

NODE="$(command -v node 2>/dev/null || true)"
if [ -z "$NODE" ]; then
  NODE="/Users/cenacai/.workbuddy/binaries/node/versions/22.22.2/bin/node"
fi

if [ ! -x "$ELECTRON" ]; then
  echo "✗ 未找到 WorkBuddy.app，请确认安装路径。"
  exit 1
fi

echo "==> [1/5] 退出 WorkBuddy…"
osascript -e 'quit app "WorkBuddy"' 2>/dev/null || true
for i in $(seq 1 15); do
  if ! pgrep -f "$APP/Contents/MacOS/Electron" >/dev/null 2>&1; then break; fi
  sleep 1
done
sleep 2

echo "==> [2/5] 以调试端口 $PORT 重启 WorkBuddy…"
nohup "$ELECTRON" --remote-debugging-port="$PORT" >/dev/null 2>&1 &
disown 2>/dev/null || true

echo "==> [3/5] 等待调试端口就绪…"
READY=0
for i in $(seq 1 60); do
  if curl -s "http://127.0.0.1:$PORT/json/list" >/dev/null 2>&1; then READY=1; break; fi
  sleep 1
done
if [ "$READY" -ne 1 ]; then
  echo "✗ 调试端口 $PORT 未在 60 秒内就绪，请检查 WorkBuddy 是否成功启动。"
  exit 1
fi

echo "==> [4/5] 等待界面渲染…"
sleep 6

echo "==> [5/5] 注入背景…"
# 若用户未指定 --image / --css，则默认使用项目内置的 background.png
if [ -f "$SCRIPT_DIR/background.png" ]; then
  HAS_CUSTOM=0
  for _a in "$@"; do
    case "$_a" in
      --image|--css) HAS_CUSTOM=1; break ;;
    esac
  done
  if [ "$HAS_CUSTOM" -eq 0 ]; then
    set -- --image "$SCRIPT_DIR/background.png" "$@"
  fi
fi
"$NODE" "$SCRIPT_DIR/inject.mjs" --port "$PORT" "$@"

echo ""
echo "完成。如需恢复官方外观，正常退出并用普通方式重启 WorkBuddy 即可；"
echo "或运行 ./restore.sh（需 WorkBuddy 仍带调试端口运行）。"
