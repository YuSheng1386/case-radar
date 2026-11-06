#!/bin/bash
# LINE 使用紀錄：每人查幾次、查不到／看不懂／找不到地點的句子、回報。用來優化解析：bash tools/line-usage.sh [天數，預設 7]
#   紀錄在網站 D1 blobs lg-*（90 天）；朋友名單 lm-members（LINE 裡打「待核准」「核准 1」管理）
cd "$(dirname "$0")/.."
SITE=${RADAR_URL:-https://case-radar.yusheng1386.workers.dev}
curl -s "$SITE/api/ingest/line-usage?days=${1:-7}" -H "X-Ingest-Key: $(cat web/.ingest-key)" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);
const L={fb:"📝回報",x:"❓看不懂",geo:"📍找不到地點",other:"⚠️其他",help:"說明",welcome:"歡迎",join:"✅開通"};
console.log(`最近 ${j.days} 天，核准過的朋友：${j.members.map(m=>m.name+(m.push?"（收推播）":"")).join("、")||"（無）"}`);
const by={};for(const x of j.logs)(by[x.u]??=[]).push(x);
for(const [u,xs] of Object.entries(by)){const q=xs.filter(x=>typeof x.r==="number");
  console.log(`\n== ${u}：查詢 ${q.length} 次，0 件 ${q.filter(x=>x.r===0).length}，看不懂 ${xs.filter(x=>x.r==="x").length}，回報 ${xs.filter(x=>x.r==="fb").length}`);
  for(const x of xs)console.log(`  ${x.at.slice(5,16).replace("T"," ")} ${typeof x.r==="number"?String(x.r).padStart(4)+"件":(L[x.r]||x.r).padEnd(5)}｜${x.t}${x.last?`（前一句：${x.last}）`:""}${x.ms?`  ${x.ms}ms`:""}`);}
if(!j.logs.length)console.log("（沒有紀錄）");})'
