#!/bin/bash
# 驗收：git 狀態、本機端到端測試、雲端最近執行、正式網站各端點
cd "$(dirname "$0")/.."
echo "== git =="; git status --short | head -5; git log --oneline -4
echo "== 本機端到端測試 =="
OUT=$(bash web/test-local.sh 2>&1)
echo "通過 $(echo "$OUT" | grep -c '✓') 項／失敗 $(echo "$OUT" | grep -c '✗') 項"
echo "$OUT" | grep -E '✗|全部通過|有失敗'
echo "== 雲端最近執行 =="; ~/.local/bin/gh run list -R YuSheng1386/case-radar -L4
echo "== 正式網站 =="
for p in / /api/setup /s/0123456789abcdef01234567 /api/blob/pool /api/blob/cards; do
  echo "$p $(curl -s -o /dev/null -w '%{http_code}' https://case-radar.yusheng1386.workers.dev$p)"
done
