#!/bin/bash
# 最近幾次排程的推播紀錄：bash tools/run-notify.sh [幾次]
GH=~/.local/bin/gh; R=YuSheng1386/case-radar
for id in $($GH run list -R $R -w radar.yml -L "${1:-6}" --json databaseId -q '.[].databaseId'); do
  t=$($GH api repos/$R/actions/runs/$id -q '.created_at')
  echo "== $id $t"
  bash "$(dirname "$0")/run-grep.sh" "$id" '通知'
done
