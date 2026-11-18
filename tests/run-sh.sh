#!/usr/bin/env bash
# tests/run-sh.sh — run.sh's commands against stub ssh and python3 on PATH. Never touches the Pi,
# the network or the real $HOME. Exit 0 = every check passed. Called by ./test.sh (step run-sh).
set -euo pipefail
cd "$(dirname "$0")/.."

TMP="$(mktemp -d "${TMPDIR:-/tmp}/threejs-run-sh.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin" "$TMP/home"

# Stubs: record each argument on its own line, and stdin, then exit 0.
for tool in ssh python3; do
    cat > "$TMP/bin/$tool" <<EOF
#!/usr/bin/env bash
: > "$TMP/$tool.args"
for a in "\$@"; do printf '%s\n' "\$a" >> "$TMP/$tool.args"; done
if [ ! -t 0 ]; then cat > "$TMP/$tool.stdin"; fi
exit 0
EOF
    chmod +x "$TMP/bin/$tool"
done

pass=0; fail=0
ok()  { pass=$((pass + 1)); }
bad() { fail=$((fail + 1)); echo "FAIL: $*"; }
reset() { rm -f "$TMP"/*.args "$TMP"/*.stdin; }
# run_sh <env assignments...> -- <run.sh args...>: output in $TMP/out, exit code in $rc.
run_sh() {
    local envs=()
    while [ "$1" != -- ]; do envs+=("$1"); shift; done
    shift
    reset
    set +e
    env -i PATH="$TMP/bin:/usr/bin:/bin" HOME="$TMP/home" ${envs[@]+"${envs[@]}"} ./run.sh "$@" \
        > "$TMP/out" 2>&1 < /dev/null
    rc=$?
    set -e
}
args() { cat "$TMP/$1.args" 2>/dev/null || true; }
expect_args() {  # expect_args <tool> <label> <expected lines...>
    local tool="$1" label="$2"; shift 2
    local want; want="$(printf '%s\n' "$@")"
    if [ "$(args "$tool")" = "$want" ]; then ok; else
        bad "$label: $tool args"; echo "  want: $(echo "$want" | tr '\n' '|')"; echo "  got:  $(args "$tool" | tr '\n' '|')"; fi
}
expect_rc() { if [ "$rc" -eq "$1" ]; then ok; else bad "$2: exit $rc, want $1 ($(head -c 200 "$TMP/out"))"; fi; }

DEPLOY_CMD='mkdir -p pi-crystal && cat > pi-crystal/telemetry.py && python3 -m py_compile pi-crystal/telemetry.py && echo deployed: $(wc -c < pi-crystal/telemetry.py) bytes'

# pi-deploy: one ssh, the file on stdin, default target.
reset
env -i PATH="$TMP/bin:/usr/bin:/bin" HOME="$TMP/home" ./run.sh pi-deploy > "$TMP/out" 2>&1 && rc=0 || rc=$?
expect_rc 0 "pi-deploy"
expect_args ssh "pi-deploy default" -- pieter@raspberrypi.local "$DEPLOY_CMD"
if cmp -s "$TMP/ssh.stdin" pi-crystal/pi/telemetry.py; then ok; else bad "pi-deploy: stdin is not telemetry.py"; fi

# PI_HOST / PI_USER from the environment.
reset
env -i PATH="$TMP/bin:/usr/bin:/bin" HOME="$TMP/home" PI_HOST=pi-lab.local PI_USER=pi ./run.sh pi-deploy > "$TMP/out" 2>&1 && rc=0 || rc=$?
expect_rc 0 "pi-deploy env"
expect_args ssh "pi-deploy env" -- pi@pi-lab.local "$DEPLOY_CMD"

# pi-serve: ssh -t, args pass through shell-quoted.
run_sh -- pi-serve
expect_rc 0 "pi-serve"
expect_args ssh "pi-serve" -t -- pieter@raspberrypi.local "python3 pi-crystal/telemetry.py"
run_sh -- pi-serve --port 9000 --allow-origin 'http://a b'
expect_args ssh "pi-serve args" -t -- pieter@raspberrypi.local 'python3 pi-crystal/telemetry.py --port 9000 --allow-origin http://a\ b'
if grep -q 'pi-crystal/?pi=raspberrypi.local:8765' "$TMP/out"; then ok; else bad "pi-serve: no page URL hint"; fi

# Hostile or malformed targets: exit 2, ssh never runs.
for h in '-oProxyCommand=touch /tmp/x' '-oProxyCommand=id' '-v' 'a b' 'host;id' '.local' 'evil@host'; do
    run_sh "PI_HOST=$h" -- pi-deploy
    expect_rc 2 "PI_HOST='$h'"
    if [ -z "$(args ssh)" ]; then ok; else bad "PI_HOST='$h' still ran ssh"; fi
done
for u in 'root@x' '-l' 'Pieter' 'a b' "$(printf 'x%.0s' $(seq 1 40))"; do
    run_sh "PI_USER=$u" -- pi-serve
    expect_rc 2 "PI_USER='$u'"
    if [ -z "$(args ssh)" ]; then ok; else bad "PI_USER='$u' still ran ssh"; fi
done

# serve: localhost only, the port from PORT.
run_sh PORT=8123 -- serve
expect_rc 0 "serve"
expect_args python3 "serve" -m http.server 8123 --bind 127.0.0.1
run_sh --
expect_args python3 "default command is serve" -m http.server 8000 --bind 127.0.0.1

# help, unknown command.
run_sh -- help
expect_rc 0 "help"
if grep -q 'pi-deploy' "$TMP/out" && grep -q 'PI_HOST' "$TMP/out"; then ok; else bad "help does not document pi-deploy and PI_HOST"; fi
run_sh -- frobnicate
expect_rc 2 "unknown command"

# Nothing was written to the (fake) home: no ~/.ssh/config, no known_hosts.
if [ -z "$(ls -A "$TMP/home")" ]; then ok; else bad "run.sh wrote into HOME: $(ls -A "$TMP/home")"; fi

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
