#!/bin/bash
# 從網站下載最新的案件清單／案件池到 /tmp/rd（本機測 LINE 查詢用；需要 web/.ingest-key 跟網站一致）
cd "$(dirname "$0")/.."
mkdir -p /tmp/rd
for n in pool cards; do
  code=$(curl -s -o /tmp/rd/$n.gz -w '%{http_code}' -H "X-Ingest-Key: $(cat web/.ingest-key)" "https://case-radar.yusheng1386.workers.dev/api/ingest/blob/$n")
  [ "$code" = 200 ] && gunzip -f /tmp/rd/$n.gz && echo "$n OK" || echo "$n HTTP $code"
done
[ -f /tmp/rd/cards ] && mv /tmp/rd/cards /tmp/rd/data.json; [ -f /tmp/rd/pool ] && mv /tmp/rd/pool /tmp/rd/pool.json
ls -la /tmp/rd
