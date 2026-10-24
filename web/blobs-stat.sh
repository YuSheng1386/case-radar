#!/bin/bash
# 正式 D1 blobs 表概況（LINE 索引、地圖、翻頁、地點快取）
cd "$(dirname "$0")"
npx wrangler d1 execute radar-db --remote --json --command "DELETE FROM blobs WHERE k = 'line-99'; SELECT substr(k,1,instr(k||'-','-')-1) AS kind, COUNT(*) AS n, ROUND(SUM(LENGTH(v))/1024.0) AS kb FROM blobs GROUP BY kind" 2>/dev/null \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);for(const r of j.at(-1).results)console.log(r.kind, r.n+" 筆", r.kb+" KB")})'
