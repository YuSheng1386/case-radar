#!/bin/bash
# LINE 官方帳號狀態：本月推播額度／已用、好友數、查詢名單上每個人的名稱：bash tools/line-status.sh
cd "$(dirname "$0")/.."
SITE=${RADAR_URL:-https://case-radar.yusheng1386.workers.dev}
curl -s "$SITE/api/ingest/line-status" -H "X-Ingest-Key: $(cat web/.ingest-key)" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);
console.log(`帳號：${j.bot}`);
console.log(`本月推播：已用 ${j.used} / ${j.quota}，剩 ${typeof j.quota==="number"?j.quota-j.used:"不限"} 則（回覆不算）`);
const f=j.followers;console.log(f.friends!=null?`好友：${f.friends} 人（${f.date} 統計，封鎖 ${f.blocks}）`:`好友數：LINE 統計還沒好（${JSON.stringify(f)}，隔天才有）`);
console.log("查詢名單：");for(const a of j.allow)console.log(`  ${a.name}  ${a.id}${a.push?"（收推播）":""}`);})'
