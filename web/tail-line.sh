#!/bin/bash
# 看正式網站即時請求（查 LINE webhook 有沒有打進來）：bash web/tail-line.sh [秒數]
#   不要接 grep：被 timeout 砍掉時 grep 緩衝的內容不會寫出來（10/24 兩次 10 分鐘都是空檔）
cd "$(dirname "$0")"
timeout "${1:-90}" npx wrangler tail --format pretty 2>&1 | stdbuf -oL grep -v -E 'npm notice|update to the latest|out-of-date|update available'
