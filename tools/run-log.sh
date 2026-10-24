#!/bin/bash
# 看某次（或最近 N 次）雷達排程的重點與錯誤：bash tools/run-log.sh [run id ...]
GH=~/.local/bin/gh; R=YuSheng1386/case-radar
ids="$@"; [ -z "$ids" ] && ids=$($GH run list -R $R -w radar.yml -L 1 --json databaseId -q '.[].databaseId')
for id in $ids; do
  echo "== $id"
  $GH run view "$id" -R $R --log 2>/dev/null | grep -iE 'LINE 索引|路名座標|通知\]|失敗|error|limit|429|HTTP [45]' | sed 's/^.*Z //' | head -20
done
