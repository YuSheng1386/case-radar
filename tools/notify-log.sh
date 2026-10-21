#!/bin/bash
# 看最近幾次雲端執行的推播紀錄：bash tools/notify-log.sh [幾次]
GH=~/.local/bin/gh; R=YuSheng1386/case-radar
for id in $($GH run list -R $R -w radar.yml -L ${1:-4} --json databaseId --jq '.[].databaseId'); do
  echo "== $($GH run view $id -R $R --json createdAt,event --jq '.createdAt+" "+.event')"
  $GH run view $id -R $R --log 2>/dev/null | grep '通知' | sed 's/^.*Z //'
done
