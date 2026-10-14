#!/usr/bin/env bash
# test.sh — every check in one place. Exit 0 = green.
#   ./test.sh
# Steps: shell, secrets, js (node --check on every tracked .js), html (root index.html).
set -euo pipefail
cd "$(dirname "$0")"
case "${1:-}" in
    -h|--help) sed -n '2,4p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    "") ;;
    *) echo "Unknown option: $1 (see ./test.sh --help)" >&2; exit 2 ;;
esac

echo "== shell"
for f in ./*.sh; do bash -n "$f"; /bin/bash -n "$f"; done
if command -v shellcheck >/dev/null 2>&1; then
    shellcheck -S warning ./*.sh
else
    echo "shellcheck not installed — syntax-checked only (brew install shellcheck)"
fi

echo "== secrets"
tracked="$(git ls-files | grep -E '(^|/)\.env(\..+)?$' | grep -vE '\.env\.(example|template)$' || true)"
if [ -n "$tracked" ]; then
    echo "env files must never be tracked:"; echo "$tracked"; exit 1
fi
echo "no tracked env files"

echo "== js"
n=0
while IFS= read -r f; do
    [ -n "$f" ] || continue
    node --check "$f"
    n=$((n + 1))
done <<< "$(git ls-files '*.js' '*.mjs' | grep -v '^vendor/' || true)"
echo "$n file(s) parse"

echo "== html"
[ -f index.html ] || { echo "index.html missing" >&2; exit 1; }
echo "index.html present"

echo "== all green"
