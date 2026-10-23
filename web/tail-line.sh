#!/bin/bash
# 看正式網站即時請求（查 LINE webhook 有沒有打進來）：bash web/tail-line.sh [秒數]
cd "$(dirname "$0")"
timeout "${1:-90}" npx wrangler tail --format pretty 2>&1 | grep -v -E 'npm notice|update to the latest'
