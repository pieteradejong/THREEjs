#!/usr/bin/env bash
# Every check in one place. Exit 0 = all green = safe to commit.
# CI runs `./test.sh --ci`; `./run.sh test` runs this script.
#
#   ./test.sh               everything; the browser step runs when Playwright is installed
#   ./test.sh --no-browser  skip the browser render step (about 20 s)
#   ./test.sh --ci          skip the local security gate (CI runs it in its own job) and the browser step
#   ./test.sh --list        print each step and what it proves; run nothing
#   ./test.sh <step>        run one step by name
#
# Every step runs even after an earlier failure; a summary table lists them all.
# Nothing here touches the Pi or the network: run.sh's ssh is a stub, the "Pi" is a fake /proc tree.
# Colour only on a terminal; NO_COLOR=1 turns it off, FORCE_COLOR=1 turns it on.
set -euo pipefail
cd "$(dirname "$0")"

CI_MODE=0; BROWSER=1; LIST=0; ONLY=""; SEEN=0; MODE="${*:-default}"
for arg in "$@"; do
    case "$arg" in
        --ci) CI_MODE=1 ;;
        --no-browser) BROWSER=0 ;;
        --list) LIST=1 ;;
        -h|--help) awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"; exit 0 ;;
        -*) echo "Unknown option: $arg (see ./test.sh --help)"; exit 2 ;;
        *) ONLY="$arg" ;;
    esac
done

# Colour: on for a terminal, off when piped. NO_COLOR turns it off, FORCE_COLOR turns it on
# (https://no-color.org); GitHub Actions renders ANSI without being a terminal.
if [ -n "${NO_COLOR:-}" ]; then COLOR=0
elif [ "${FORCE_COLOR:-0}" != 0 ] || [ "${GITHUB_ACTIONS:-}" = true ]; then COLOR=1
elif [ -t 1 ] && [ "${TERM:-dumb}" != dumb ]; then COLOR=1
else COLOR=0; fi
if [ "$COLOR" -eq 1 ]; then
    BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'
    YELLOW=$'\033[33m'; CYAN=$'\033[36m'; RESET=$'\033[0m'
else
    BOLD=''; DIM=''; RED=''; GREEN=''; YELLOW=''; CYAN=''; RESET=''
fi

LOG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/threejs-test.XXXXXX")"
KEEP_LOGS=0   # a failed step sets this: its full log is worth reading
trap '[ "$KEEP_LOGS" -eq 1 ] || rm -rf "$LOG_DIR"' EXIT
T0=$(date +%s)

# Parallel indexed arrays (bash 3.2 has no associative arrays).
NAMES=(); RESULTS=(); SECONDS_TAKEN=()
record() { NAMES+=("$1"); RESULTS+=("$2"); SECONDS_TAKEN+=("$3"); }

# What each step proves, in one line: shown as the step starts and by --list.
step_what() {
    case "$1" in
        tools)    echo "node >= 22 and python3 >= 3.10 are there (node --test, ES modules, sys.stdlib_module_names)" ;;
        shell)    echo "every script parses under bash and macOS bash 3.2; shellcheck -S warning is clean" ;;
        secrets)  echo "no env file is tracked or about to be" ;;
        pins)     echo "third-party actions are SHA-pinned; pi-crystal has no dependencies to pin" ;;
        vendor)   echo "vendored three.js matches SHA256SUMS, nothing unlisted, and is the version the README names" ;;
        js)       echo "every own .js/.mjs file parses (node --check)" ;;
        js-unit)  echo "mapping.js and source.js unit tests pass (node --test)" ;;
        imports)  echo "every import resolves to a repo file via path or the import map; nothing off-site" ;;
        page)     echo "pi-crystal page: lang, title, zoomable viewport, every id main.js uses, README links it" ;;
        privacy)  echo "public repo: no IP (except loopback/any) or MAC address in pi-crystal, run.sh, README" ;;
        py)       echo "telemetry.py: parsers, fake-root sampler, live server end to end, stdlib only (warnings = errors)" ;;
        run-sh)   echo "run.sh pi-deploy/pi-serve/serve call stub ssh/python3 right and refuse hostile PI_HOST/PI_USER" ;;
        render)   echo "WebKit: mock, hot, live (fake Pi via telemetry.py), unreachable and phone states render, no console error" ;;
        gate)     echo "the security gate finds no secret, personal value or forbidden file in the tree" ;;
        *)        echo "(no description: add one to step_what)" ;;
    esac
}

# wanted <name> <skip reason or "">: false when the step should not run -- another step was asked
# for by name, or --list is on, in which case the step is printed here instead.
wanted() {
    [ -z "$ONLY" ] || [ "$ONLY" = "$1" ] || return 1
    SEEN=$((SEEN + 1))
    [ "$LIST" -eq 1 ] || return 0
    printf '%s%-9s%s %s%s\n' "$BOLD" "$1" "$RESET" "$(step_what "$1")" \
        "${2:+  ${YELLOW}(skipped: $2)${RESET}}"
    return 1
}

# run_step <name> <command...>: says what the step proves and what it runs, runs it with the output
# captured, reports the result. Never aborts the script.
run_step() {
    local name="$1"; shift
    wanted "$name" "" || return 0
    local log="$LOG_DIR/$name.log" start rc took last=""
    printf '\n%s▶ %s%s  %s\n' "$BOLD$CYAN" "$name" "$RESET" "$(step_what "$name")"
    if [ "$(type -t "$1")" != function ]; then
        local a cmd=""
        for a in "$@"; do case "$a" in *[[:space:]]*) cmd="$cmd '$a'" ;; *) cmd="$cmd $a" ;; esac; done
        printf '  %s$%s%s\n' "$DIM" "$cmd" "$RESET"
    fi
    start=$(date +%s)
    # The subshell turns errexit back on: without it, a step function would inherit the `set +e`
    # below and only its last command's status would count (a broken file mid-loop would pass).
    set +e
    ( set -e; "$@" ) > "$log" 2>&1
    rc=$?
    set -e
    took=$(( $(date +%s) - start ))
    if [ "$rc" -eq 0 ]; then
        record "$name" PASS "$took"
        last="$(awk 'NF { l = $0 } END { print l }' "$log" | cut -c1-100)"
        printf '  %s✓ pass%s  %s%ss%s%s\n' "$GREEN" "$RESET" "$DIM" "$took" "${last:+ · $last}" "$RESET"
    else
        record "$name" FAIL "$took"
        KEEP_LOGS=1
        printf '  %s✗ FAIL%s  exit %s after %ss, last 40 lines:\n' "$BOLD$RED" "$RESET" "$rc" "$took"
        tail -n 40 "$log" | sed "s/^/  ${RED}│${RESET} /"
        printf '  %sfull log: %s\n  rerun:    ./test.sh %s%s\n' "$DIM" "$log" "$name" "$RESET"
    fi
}

# skip_step <name> <reason>: the reason names the flag or the tool that would enable the step.
skip_step() {
    wanted "$1" "$2" || return 0
    printf '\n%s▷ %s%s  %s\n  %sskipped: %s%s\n' "$YELLOW" "$1" "$RESET" "$(step_what "$1")" "$DIM" "$2" "$RESET"
    record "$1" "SKIP: $2" 0
}

# Own files, tracked or new (not ignored); vendor/ is third-party and checked by `vendor`.
own_files() { git ls-files -co --exclude-standard -- "$@" | grep -v '^vendor/' || true; }

# --- step bodies -------------------------------------------------------------------------------

check_tools() {
    command -v node > /dev/null || { echo "node not found (nvm install 26)"; return 1; }
    node -e 'const m = +process.versions.node.split(".")[0]; if (m < 22) { console.error(`node ${m} < 22`); process.exit(1) } console.log(`node ${process.versions.node}`)'
    python3 -c 'import sys; assert sys.version_info >= (3, 10), sys.version; print("python", sys.version.split()[0])'
}

check_shell() {
    local f n=0
    command -v shellcheck > /dev/null || { echo "shellcheck not installed (brew install shellcheck)"; return 1; }
    for f in ./*.sh tests/*.sh; do
        bash -n "$f"; /bin/bash -n "$f"
        n=$((n + 1))
    done
    shellcheck -S warning ./*.sh tests/*.sh
    echo "$n scripts parse; shellcheck clean"
}

check_secrets() {
    local tracked
    tracked="$(git ls-files -co --exclude-standard | grep -E '(^|/)\.env(\..+)?$' | grep -vE '\.env\.(example|template)$' || true)"
    if [ -n "$tracked" ]; then echo "env files must never be tracked:"; echo "$tracked"; return 1; fi
    echo "no env files tracked or untracked-unignored"
}

check_pins() {
    local bad
    # Third-party actions by 40-hex SHA; the workspace's own reusable workflow may ride @main.
    bad="$(grep -hE '^[[:space:]]*-?[[:space:]]*uses:' .github/workflows/*.yml \
        | sed -E 's/^[[:space:]]*-?[[:space:]]*uses:[[:space:]]*//; s/[[:space:]]+#.*$//' \
        | grep -vE '^pieteradejong/' | grep -vE '@[0-9a-f]{40}$' || true)"
    if [ -n "$bad" ]; then echo "actions not pinned by SHA:"; echo "$bad"; return 1; fi
    node -e '
        const p = require("./pi-crystal/package.json");
        const deps = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].filter((k) => p[k]);
        if (deps.length) { console.error("pi-crystal/package.json declares " + deps.join(", ") + ": pin exactly and justify, or remove"); process.exit(1) }
        if (p.type !== "module" || p.license !== "MIT" || p.private !== true) { console.error("pi-crystal/package.json: want private, type module, license MIT"); process.exit(1) }
    '
    echo "actions SHA-pinned; pi-crystal has no dependencies"
}

check_vendor() {
    local listed actual
    ( cd vendor/three && shasum -a 256 -c SHA256SUMS --quiet ) || { echo "vendor/three: checksum mismatch"; return 1; }
    listed="$(awk '{ print $2 }' vendor/three/SHA256SUMS | LC_ALL=C sort)"
    actual="$(cd vendor/three && find . -type f ! -name SHA256SUMS ! -name README.md | sed 's|^\./||' | LC_ALL=C sort)"
    if [ "$listed" != "$actual" ]; then
        echo "vendor/three: files and SHA256SUMS differ:"; diff <(echo "$listed") <(echo "$actual") || true; return 1
    fi
    # A generic ignore rule (build/) once hid three.module.min.js: on disk, but never committed.
    local ignored
    ignored="$(cd vendor/three && echo "$listed" | git check-ignore --stdin || true)"
    if [ -n "$ignored" ]; then echo "vendor/three: gitignored, so a clone would miss them:"; echo "$ignored"; return 1; fi
    grep -q '`three@0.170.0`' vendor/three/README.md || { echo "vendor/three/README.md does not name three@0.170.0"; return 1; }
    grep -q '"170"' vendor/three/build/three.module.min.js || { echo "three.module.min.js is not REVISION 170"; return 1; }
    grep -q 'MIT License' vendor/three/LICENSE || { echo "vendor/three/LICENSE is not the MIT text"; return 1; }
    echo "$(echo "$listed" | wc -l | tr -d ' ') files match SHA256SUMS; three r170"
}

check_js() {
    local f n=0
    while IFS= read -r f; do
        [ -n "$f" ] || continue
        node --check "$f"
        n=$((n + 1))
    done <<< "$(own_files '*.js' '*.mjs')"
    [ "$n" -ge 9 ] || { echo "only $n JS files found: the file list is broken"; return 1; }
    echo "$n file(s) parse"
}

check_py() {
    python3 -I -W error -m unittest discover -s pi-crystal/pi -v 2>&1
}

# --- run -----------------------------------------------------------------------------------------

if [ "$LIST" -eq 0 ]; then
    printf '%sTHREEjs%s  test suite  %smode: %s%s\n' "$BOLD" "$RESET" "$DIM" "$MODE" "$RESET"
fi

run_step tools check_tools
run_step shell check_shell
run_step secrets check_secrets
run_step pins check_pins
run_step vendor check_vendor
run_step js check_js
run_step js-unit node --test pi-crystal/tests/mapping.test.mjs pi-crystal/tests/source.test.mjs
run_step imports node tests/static.mjs imports
run_step page node tests/static.mjs page
run_step privacy node tests/static.mjs privacy
run_step py check_py
run_step run-sh tests/run-sh.sh

PW_DIR="${PLAYWRIGHT_DIR:-$HOME/.claude/skills/mobile-vetting}"
if [ "$CI_MODE" -eq 1 ]; then
    skip_step render "--ci (no browser in CI; run ./test.sh locally)"
elif [ "$BROWSER" -eq 0 ]; then
    skip_step render "--no-browser"
elif [ ! -d "$PW_DIR/node_modules/playwright" ]; then
    skip_step render "Playwright not found in $PW_DIR (set PLAYWRIGHT_DIR)"
else
    run_step render node tests/render.mjs
fi

GATE="$HOME/dev/dotfiles/security/gate.sh"
if [ "$CI_MODE" -eq 1 ]; then
    skip_step gate "--ci (CI runs the gate in its security job)"
elif [ ! -x "$GATE" ]; then
    skip_step gate "security gate not installed"
else
    run_step gate "$GATE" scan-tree
fi

# --- summary -------------------------------------------------------------------------------------

if [ "$SEEN" -eq 0 ]; then
    echo "No step named '$ONLY' (see ./test.sh --list)"; exit 2
fi
[ "$LIST" -eq 0 ] || exit 0

failed=0; skipped=0
printf '\n%b%-9s %-6s %s%b\n' "$BOLD" "STEP" "TIME" "RESULT" "$RESET"
i=0
while [ "$i" -lt "${#NAMES[@]}" ]; do
    case "${RESULTS[$i]}" in
        PASS) color="$GREEN" ;;
        FAIL) color="$RED"; failed=$((failed + 1)) ;;
        *) color="$YELLOW"; skipped=$((skipped + 1)) ;;
    esac
    printf '%-9s %-6s %b%s%b\n' "${NAMES[$i]}" "${SECONDS_TAKEN[$i]}s" "$color" "${RESULTS[$i]}" "$RESET"
    i=$((i + 1))
done

total=$(( $(date +%s) - T0 ))
if [ "$failed" -gt 0 ]; then
    printf '\n%s%s step(s) failed%s of %s, in %ss. Logs kept in %s\n' \
        "$BOLD$RED" "$failed" "$RESET" "${#NAMES[@]}" "$total" "$LOG_DIR"
    exit 1
fi
printf '\n%sAll checks passed%s  %s%s step(s), %s skipped, in %ss%s\n' \
    "$BOLD$GREEN" "$RESET" "$DIM" "${#NAMES[@]}" "$skipped" "$total" "$RESET"
