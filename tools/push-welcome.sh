#!/bin/bash
# 推播 LINE 使用說明（加好友第一則那份＋範例按鈕）：bash tools/push-welcome.sh [all|broadcast]
#   預設只推給查詢名單第一個人（管理者）；all＝名單所有人；broadcast＝群發所有好友（不在名單的也收到）
#   每個收到的人算 1 則每月推播額度（bash tools/line-status.sh 看剩多少）
cd "$(dirname "$0")/.."
SITE=${RADAR_URL:-https://case-radar.yusheng1386.workers.dev}
case "$1" in all) B='{"all":true}' ;; broadcast) B='{"broadcast":true}' ;; *) B='{}' ;; esac
curl -s -X POST "$SITE/api/ingest/push-welcome" -H "X-Ingest-Key: $(cat web/.ingest-key)" \
  -H 'Content-Type: application/json' -d "$B"; echo
