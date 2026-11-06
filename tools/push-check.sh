#!/bin/bash
# 推播健康檢查（只讀，不發訊息）：今天推了幾則、佇列剩幾件、額度、名單、最新部署、朋友使用狀況
#   bash tools/push-check.sh
cd "$(dirname "$0")/.."
TODAY=$(TZ=Asia/Taipei date +%Y-%m-%d)
echo "== 推播佇列（網站 D1 nq）"
(cd web && npx wrangler d1 execute radar-db --remote --json --command "SELECT v FROM blobs WHERE k='nq'" 2>/dev/null) | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s).at(-1).results[0]?.v;if(!v)return console.log("  （沒有佇列資料）");
const q=JSON.parse(v),t=process.argv[1];const days=Object.entries(q.pushes||{});
console.log(`  今天（${t}）推了 ${q.pushes?.[t]||0} 則（每推一次×人數）；最近：${days.map(([d,n])=>d.slice(5)+" "+n+"則").join("、")||"無"}`);
console.log(`  佇列還累積 ${(q.cards||[]).length} 件（白天滿 5 件或 85 分以上才推，20:00 收尾、隔天 9:00 推整晚的）`);})' "$TODAY"
echo "== 額度與名單"
bash tools/line-status.sh | sed 's/^/  /'
echo "== 最新部署"
(cd web && npx wrangler deployments list 2>/dev/null | grep -E "^Created" | tail -1 | sed 's/^/  /')
echo "== 朋友使用（最近 1 天）"
bash tools/line-usage.sh 1 | sed 's/^/  /' | head -30
