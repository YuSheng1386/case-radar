#!/bin/bash
# 正式 D1 最近的 LINE 查詢痕跡（翻頁 lq-、地圖 map-、地點快取 geo-），看 webhook 有沒有真的跑到最後：bash web/line-recent.sh
cd "$(dirname "$0")"
npx wrangler d1 execute radar-db --remote --json --command "SELECT k, datetime(exp,'unixepoch','+8 hours') AS exp8, substr(v,1,90) AS v FROM blobs WHERE k LIKE 'lq-%' OR k LIKE 'geo-%' OR k LIKE 'map-%' ORDER BY exp DESC LIMIT 15" 2>/dev/null \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const r of JSON.parse(s).at(-1).results)console.log(r.k.replace(/^lq-U\w+/,"lq-(用戶)"),"到期",r.exp8,"｜",r.v)})'
