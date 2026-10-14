#!/usr/bin/env bash
# init.sh — nothing to install: three.js demos, one directory each; open them through ./run.sh.
# Checks the tools the other scripts need are present. Idempotent; exit 0 = ready.
#   ./init.sh
set -euo pipefail
cd "$(dirname "$0")"
case "${1:-}" in -h|--help) sed -n '2,4p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;; esac
for t in python3 node; do
    command -v "$t" >/dev/null 2>&1 || { echo "$t not found" >&2; exit 1; }
done
echo "ready: ./test.sh, then ./run.sh (serves on http://localhost:${PORT:-8000})"
