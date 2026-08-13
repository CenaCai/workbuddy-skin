#!/bin/bash
# 恢复官方外观：移除运行时注入的样式（不重启，仅当 WorkBuddy 仍带调试端口运行时有效）
# 最彻底的方式：正常退出 WorkBuddy 并用普通方式（Dock/启动台）重新打开，注入即自动消失。
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${WB_SKIN_PORT:-9222}"

NODE="$(command -v node 2>/dev/null || true)"
if [ -z "$NODE" ]; then
  NODE="/Users/cenacai/.workbuddy/binaries/node/versions/22.22.2/bin/node"
fi

echo "==> 移除注入的样式…"
"$NODE" "$SCRIPT_DIR/inject.mjs" --port "$PORT" --restore

echo ""
echo "若界面未立即恢复，正常重启 WorkBuddy（不带调试端口）即可彻底还原。"
