#!/bin/bash
# 本機看地圖頁：把一份地圖資料（預設 /tmp/rd/lastmap.json）放進本機 KV，開 wrangler dev
# 用法：bash web/test-map.sh [地圖json]  → 開 http://127.0.0.1:8797/m/000000000000000000000000
cd "$(dirname "$0")"
P=/tmp/wr-map; mkdir -p $P
npx wrangler kv key put --local --persist-to $P --binding BLOBS map-000000000000000000000000 --path "${1:-/tmp/rd/lastmap.json}" >/dev/null 2>&1
printf 'INGEST_KEY=k\n' > .dev.vars
npx wrangler dev --local --persist-to $P --port 8797
