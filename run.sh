#!/usr/bin/env bash
# run.sh — serve the repo root so every demo is browsable, and drive the Pi for pi-crystal.
#   ./run.sh [serve]        http://localhost:${PORT:-8000} (default); pi-crystal: /pi-crystal/
#   ./run.sh pi-deploy      copy pi-crystal/pi/telemetry.py to the Pi (~/pi-crystal/), over ssh
#   ./run.sh pi-serve [..]  run it on the Pi in the foreground (Ctrl-C stops); args pass through
#   ./run.sh test           delegates to ./test.sh
#   ./run.sh help
# The Pi: PI_HOST (default raspberrypi.local) and PI_USER (default pieter), from the environment.
# Uses plain ssh; never reads or writes ~/.ssh/config.
set -euo pipefail
cd "$(dirname "$0")"
usage() { sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; }

PI_HOST="${PI_HOST:-raspberrypi.local}"
PI_USER="${PI_USER:-pieter}"
REMOTE_DIR=pi-crystal

# Refuse anything ssh could read as an option or a second argument (a leading "-", spaces, "@").
pi_target() {
    if ! printf '%s' "$PI_HOST" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$'; then
        echo "PI_HOST is not a plain host name: '$PI_HOST'" >&2; exit 2
    fi
    if ! printf '%s' "$PI_USER" | grep -Eq '^[a-z_][a-z0-9_-]{0,31}$'; then
        echo "PI_USER is not a plain user name: '$PI_USER'" >&2; exit 2
    fi
    printf '%s@%s' "$PI_USER" "$PI_HOST"
}

cmd="${1:-serve}"
if [ $# -gt 0 ]; then shift; fi
case "$cmd" in
    serve)
        echo "Serving on http://localhost:${PORT:-8000} (Ctrl+C to stop)"
        echo "pi-crystal: http://localhost:${PORT:-8000}/pi-crystal/  (mock: add ?source=mock)"
        exec python3 -m http.server "${PORT:-8000}" --bind 127.0.0.1 ;;
    pi-deploy)
        target="$(pi_target)"
        echo "Copying telemetry.py to $target:$REMOTE_DIR/"
        # One ssh connection: the file goes over stdin, so a password is asked at most once.
        ssh -- "$target" "mkdir -p $REMOTE_DIR && cat > $REMOTE_DIR/telemetry.py && python3 -m py_compile $REMOTE_DIR/telemetry.py && echo deployed: \$(wc -c < $REMOTE_DIR/telemetry.py) bytes" \
            < pi-crystal/pi/telemetry.py ;;
    pi-serve)
        target="$(pi_target)"
        remote="python3 $REMOTE_DIR/telemetry.py"
        for a in "$@"; do remote="$remote $(printf '%q' "$a")"; done
        echo "On $target: $remote"
        echo "Then open http://localhost:${PORT:-8000}/pi-crystal/?pi=$PI_HOST:8765 while ./run.sh serves"
        exec ssh -t -- "$target" "$remote" ;;
    test) exec ./test.sh "$@" ;;
    help|-h|--help) usage ;;
    *) echo "Unknown command: $cmd" >&2; usage >&2; exit 2 ;;
esac
