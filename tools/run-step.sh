#!/bin/bash
# 看某次排程某一步的最後幾行：bash tools/run-step.sh <run id> <步驟名稱關鍵字> [行數]
~/.local/bin/gh run view "$1" -R YuSheng1386/case-radar --log 2>&1 | grep -F "$2" | tail -"${3:-15}" | sed 's/^[^	]*	[^	]*	[^ ]* //' | cut -c1-260
