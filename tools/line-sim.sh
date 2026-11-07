#!/bin/bash
# LINE 對話模擬：tools/line-sim.txt 每句送正式站（/api/ingest/line-ai，不經 LINE、不回覆、不推管理者），比對期望
# PowerShell：wsl -d Ubuntu --cd /home/YuSheng/仲介開發/radar -- bash -lc "bash tools/line-sim.sh"
#   加 -v 印每句回覆前 3 行；給第二個參數只跑含那個字的分類（例：bash tools/line-sim.sh -v 配對）
cd "$(dirname "$0")/.."
command -v node >/dev/null || export PATH="$HOME/.local/node/bin:/home/uheng/.local/node/bin:$PATH"
KEY=$(cat web/.ingest-key)
URL=${RADAR_URL:-https://case-radar.yusheng1386.workers.dev}
V=0; [ "$1" = "-v" ] && { V=1; shift; }
node -e '
const fs=require("fs"); const [u,k,v,only]=process.argv.slice(1);
const lines=fs.readFileSync("tools/line-sim.txt","utf8").split("\n").filter(l=>l.trim());
let cat="",bad=0,n=0;
(async()=>{
 for(const l of lines){
  if(l.startsWith("#")){cat=l.slice(1).trim(); continue;}
  if(only && !cat.includes(only)) continue;
  const [t,exp="any"]=l.split("|");
  // 慢慢問：連續狂打會超過 Cloudflare 免費方案 CPU 寬限，被擋 503（真的朋友也會跟著沒回應）
  await new Promise(r=>setTimeout(r,4000));
  const j=await fetch(u+"/api/ingest/line-ai",{method:"POST",headers:{"X-Ingest-Key":k,"Content-Type":"application/json"},body:JSON.stringify({text:t})}).then(r=>r.json()).catch(e=>({r:"ERR",out:e.message}));
  const r=j.r, out=String(j.out||j.error||"");
  const got= typeof r==="number"? (r>0?"n":"0") : r==="ai-x"?"x" : r==="ai"?"ai" : r==="chat"?"chat" : r;
  const ok= exp==="any" || got===exp || (exp==="ai" && ["rule","other","help"].includes(r));
  n++; if(!ok) bad++;
  console.log(`${ok?"✓":"✗"} [${cat}] 「${t.slice(0,30)}」 期望 ${exp} → ${r}${j.ai?`｜改寫「${j.ai}」`:""}${j.model?`｜${j.model.split("/").pop()}`:""}｜${j.ms}ms`);
  if(v==="1"||!ok) console.log("    "+out.split("\n").filter(Boolean).slice(0,3).join("\n    ").slice(0,300));
 }
 console.log(`\n${n} 句，不符期望 ${bad} 句`);
})()' "$URL" "$KEY" "$V" "$1"
