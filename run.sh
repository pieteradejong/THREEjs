#!/usr/bin/env bash
# run.sh — serve the repo root so every demo is browsable.
#   ./run.sh [serve]   http://localhost:${PORT:-8000} (default)
#   ./run.sh test      delegates to ./test.sh
#   ./run.sh help
set -euo pipefail
cd "$(dirname "$0")"
usage() { sed -n '2,5p' "$0" | sed 's/^# \{0,1\}//'; }
cmd="${1:-serve}"
if [ $# -gt 0 ]; then shift; fi
case "$cmd" in
    serve)
        echo "Serving on http://localhost:${PORT:-8000} (Ctrl+C to stop)"
        exec python3 -m http.server "${PORT:-8000}" --bind 127.0.0.1 ;;
    test) exec ./test.sh "$@" ;;
    help|-h|--help) usage ;;
    *) echo "Unknown command: $cmd" >&2; usage >&2; exit 2 ;;
esac
