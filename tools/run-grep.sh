#!/bin/bash
# 在某次排程 log 裡找關鍵字：bash tools/run-grep.sh <run id> <關鍵字(grep -E)>
GH=~/.local/bin/gh; R=YuSheng1386/case-radar
job=$($GH api repos/$R/actions/runs/$1/jobs -q '.jobs[0].id')
$GH api repos/$R/actions/jobs/$job/logs 2>&1 | grep -E "$2" | sed 's/^[0-9T:.Z-]* //' | head -20
