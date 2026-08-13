#!/bin/bash
# 仅以调试端口重启 WorkBuddy（不注入），供手动调试/DevTools 观察 DOM 使用
set -euo pipefail
PORT="${1:-9222}"
APP="/Applications/WorkBuddy.app"
ELECTRON="$APP/Contents/MacOS/Electron"

echo "==> 退出 WorkBuddy…"
osascript -e 'quit app "WorkBuddy"' 2>/dev/null || true
for i in $(seq 1 15); do
  if ! pgrep -f "$APP/Contents/MacOS/Electron" >/dev/null 2>&1; then break; fi
  sleep 1
done
sleep 2

echo "==> 以调试端口 $PORT 重启 WorkBuddy…"
nohup "$ELECTRON" --remote-debugging-port="$PORT" >/dev/null 2>&1 &
disown 2>/dev/null || true

echo "调试地址: http://127.0.0.1:$PORT/json/list"
echo "可在 Chrome 打开 chrome://inspect 查看，或运行: node inject.mjs --port $PORT --list"
