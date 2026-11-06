#!/bin/bash
# 管理者專屬 LINE 選單：只綁在 LINE_ALLOW 第一位（你）的對話底下，朋友看不到。按鈕：待核准／問題／成員／管理
#   bash tools/admin-menu.sh（網站部署新版之後跑一次就好；圖在 tools/admin-menu.png，2500×843）
cd "$(dirname "$0")/.."
SITE=${RADAR_URL:-https://case-radar.yusheng1386.workers.dev}
curl -s -X POST "$SITE/api/ingest/admin-menu" -H "X-Ingest-Key: $(cat web/.ingest-key)" \
  -H 'Content-Type: image/png' --data-binary @tools/admin-menu.png; echo
