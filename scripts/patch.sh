#!/usr/bin/env bash

# Antigravity Linux / macOS 语言切换与汉化脚本
# Usage:
#   ./scripts/patch.sh zh
#   ./scripts/patch.sh en
#   ./scripts/patch.sh status

set -e

LANG_TARGET="${1:-zh}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# If node is available, delegate to Node.js CLI
if command -v node >/dev/null 2>&1; then
    node "$PROJECT_ROOT/bin/cli.js" "$LANG_TARGET" "${@:2}"
    exit 0
fi

echo "Node.js not found in PATH. Please install Node.js (>=16) to run this script."
exit 1
