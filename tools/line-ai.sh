#!/bin/bash
# 測正式網站的 LINE 智能客服（規則＋AI），不經 LINE、不回覆任何人
# 用法：bash tools/line-ai.sh "西區 雙主臥 四房 三車位 預算8000萬內"   （多句：每行一句從 stdin 餵）
cd "$(dirname "$0")/.."
# 從 PowerShell 直接叫（wsl --cd … -- bash …）不是登入 shell，找不到 node → 補上路徑
command -v node >/dev/null || export PATH="$HOME/.local/node/bin:/home/uheng/.local/node/bin:$PATH"
KEY=$(cat web/.ingest-key)
URL=${RADAR_URL:-https://case-radar.yusheng1386.workers.dev}
ask() {
  node -e 'const [u,k,t]=process.argv.slice(1);fetch(u+"/api/ingest/line-ai",{method:"POST",headers:{"X-Ingest-Key":k,"Content-Type":"application/json"},body:JSON.stringify({text:t})}).then(r=>r.json()).then(j=>{console.log(`=== 「${t.replace(/\n/g," ")}」 → ${j.r}${j.ai?`（AI 改寫：${j.ai}）`:""} ${j.model||""} ${j.ms}ms`);console.log(String(j.out||j.error).split("\n").slice(0,14).join("\n"));console.log()})' "$URL" "$KEY" "$1"
}
if [ $# -gt 0 ]; then ask "$*"; else while IFS= read -r l; do [ -n "$l" ] && ask "$l"; done; fi
