#!/bin/bash
# 累積的問題整理（給 Claude 優化規則用）：最近 N 天朋友問了答不了的、0 件、找不到地點、回報，加上 AI 學到的說法
#   AI 常改寫的說法 → 寫進 web/src/line.mjs parse() 變成規則（更快、不花 AI 額度）
#   答不了的同類問題多了 → 加功能或加進 rules.mjs 說明
# 用法：bash tools/line-review.sh [天數，預設 14]
cd "$(dirname "$0")/.."
KEY=$(cat web/.ingest-key)
URL=${RADAR_URL:-https://case-radar.yusheng1386.workers.dev}
node -e '
const [u,k,d]=process.argv.slice(1);
fetch(`${u}/api/ingest/line-usage?days=${d}`,{headers:{"X-Ingest-Key":k}}).then(r=>r.json()).then(j=>{
  const L={"ai-x":"答不了",x:"看不懂",geo:"找不到地點",0:"0件",fb:"回報"};
  const by={};
  for(const x of j.logs){ const g=x.ai?"AI改寫":L[x.r]; if(!g) continue; (by[g]=by[g]||[]).push(x); }
  for(const [g,xs] of Object.entries(by)){
    console.log(`\n== ${g}（${xs.length}）`);
    for(const x of xs.slice(-25)) console.log(`${x.at.slice(5,16).replace("T"," ")} ${x.u}｜「${x.t.replace(/\n/g," ").slice(0,60)}」${x.ai?` → 「${x.ai}」（${x.r}件${x.m==="learned"?"，學過的":""}）`:""}${x.why?`｜${x.why.slice(0,60)}`:""}${x.last?`｜前一句：${x.last.slice(0,30)}`:""}`);
  }
  console.log(`\n== AI 學到的說法（${(j.learned||[]).length}）`);
  for(const [a,b] of j.learned||[]) console.log(`「${a.slice(0,50)}」→「${b}」`);
})' "$URL" "$KEY" "${1:-14}"
