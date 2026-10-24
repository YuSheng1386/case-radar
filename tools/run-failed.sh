#!/bin/bash
# 看某次失敗排程的錯誤：bash tools/run-failed.sh <run id>
~/.local/bin/gh run view "$1" -R YuSheng1386/case-radar --log-failed > /tmp/run-failed.log 2>&1
echo "lines: $(wc -l < /tmp/run-failed.log)"
grep -vE 'npm notice|^\s*$' /tmp/run-failed.log | tail -20 | sed 's/^[^	]*	[^	]*	[^ ]* //' | cut -c1-260
