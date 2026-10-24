#!/bin/bash
# 本機看地圖頁：把一份地圖資料（預設 /tmp/rd/lastmap.json）放進本機 D1 blobs，開 wrangler dev
# 用法：bash web/test-map.sh [地圖json]  → 開 http://127.0.0.1:8797/m/000000000000000000000000
cd "$(dirname "$0")"
P=/tmp/wr-map; mkdir -p $P
npx wrangler d1 execute radar-db --local --persist-to $P --file=schema.sql >/dev/null 2>&1
node -e 'const v=require("fs").readFileSync(process.argv[1],"utf8").replace(/\x27/g,"\x27\x27");require("fs").writeFileSync("/tmp/wr-map.sql",`INSERT OR REPLACE INTO blobs (k, v, exp) VALUES (\x27map-000000000000000000000000\x27, \x27${v}\x27, NULL);`)' "${1:-/tmp/rd/lastmap.json}"
npx wrangler d1 execute radar-db --local --persist-to $P --file=/tmp/wr-map.sql >/dev/null 2>&1
printf 'INGEST_KEY=k\n' > .dev.vars
npx wrangler dev --local --persist-to $P --port 8797
