#!/bin/bash
# 看某次（或最近一次）雷達排程的重點與錯誤：bash tools/run-log.sh [run id ...]
#   用 jobs API 抓 log（gh run view --log 對較舊的 run 常拿不到）
GH=~/.local/bin/gh; R=YuSheng1386/case-radar
ids="$@"; [ -z "$ids" ] && ids=$($GH run list -R $R -w radar.yml -L 1 --json databaseId -q '.[].databaseId')
for id in $ids; do
  job=$($GH api repos/$R/actions/runs/$id/jobs -q '.jobs[0].id')
  echo "== run $id（job $job）"
  $GH api repos/$R/actions/jobs/$job/logs 2>&1 | grep -iE 'LINE 索引|路名座標|通知\]|完成：|失敗|error|limit|429|HTTP [45]|上傳 [a-z]' | sed 's/^[0-9T:.Z-]* //' | grep -v '^\s*$' | head -25
done
