#!/bin/bash
# 檢查網站 KV 裡 LINE 索引與案件清單的更新時間（看寫入有沒有被額度擋）
cd "$(dirname "$0")/.."
K=$(cat web/.ingest-key); U=https://case-radar.yusheng1386.workers.dev/api/ingest/blob
echo "line-meta at: $(curl -s -H "X-Ingest-Key: $K" $U/line-meta | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).at)}catch{console.log("讀不到：",s.slice(0,80))}})')"
echo "cards at:     $(curl -s -H "X-Ingest-Key: $K" $U/cards | gunzip 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).generatedAt)}catch{console.log("讀不到")}})')"
code=$(curl -s -o /tmp/kvput.txt -w '%{http_code}' -X PUT -H "X-Ingest-Key: $K" --data-binary '{"probe":1}' $U/line-99)
echo "寫入測試 line-99: HTTP $code $(head -c 200 /tmp/kvput.txt)"
