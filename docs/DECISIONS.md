# Decisions

Numbered, newest last. Each entry names the alternative that was rejected and ends with `Verified:`.

## 1. Pi → browser over Server-Sent Events, served by a stdlib-only Python script (2026-11-18)

- **Context:** pi-crystal needs the Pi's readings in a browser on the Mac, a few times a second, in one direction.
- **Decision:** `pi-crystal/pi/telemetry.py` serves `GET /events` as `text/event-stream` using `http.server`. One thread samples the readings and every client gets the latest sample. CORS is limited to the page's origins. The page uses the browser's `EventSource`, which reconnects on its own.
  - Rejected: WebSocket. The data flows one way, and WebSocket needs a library on the Pi (`websockets`) and reconnect code in the page.
  - Rejected: the Pi serving the page as well. The page would then live on the Pi and every change would need a deploy. Serving it from the Mac with `./run.sh` keeps the Pi side to one file.
- **Tradeoff:** browsers cap HTTP/1.1 connections per host at 6, so at most 6 tabs. That is plenty here.
- **Verified:** `./test.sh py` passes 17 tests. Among them, `ServerEndToEnd` starts the script on 127.0.0.1 with a fake `/proc` tree and checks the event shape, the `text/event-stream` header and the CORS allow/deny. `./test.sh render` → `live shows the fake Pi` (the HUD reads the fake 63.7 °C through `EventSource`). On a real Pi: **NOT YET**, because the Pi is offline (`TODO.md`).

## 2. Vendor three.js 0.170.0 with checksums instead of loading it from a CDN (2026-11-18)

- **Context:** pi-crystal uses three.js as ES modules plus postprocessing addons. The older demos load it from CDNs, one of them (`stars.html`) with no version at all.
- **Decision:** copy `three@0.170.0` (`build/three.module.min.js` and the 11 addons used) unmodified into `vendor/three/`, together with its MIT LICENSE, a README stating the package integrity, and `SHA256SUMS`. The page loads them through an import map.
  - Rejected: an import map pointing at a CDN with an exact version. It is smaller in git, but the page breaks offline (a Pi demo on a LAN), and the code that runs isn't in version control or checked.
  - Rejected: npm plus a bundler. That means a build step and `node_modules` for a static page.
- **Tradeoff:** 768 KB of third-party code in git, and upgrades are by hand (steps in `vendor/three/README.md`).
- **Verified:** the npm tarball's sha512 matched `npm view three@0.170.0 dist.integrity` (`sha512-FQK+LEpY…PZBhuQ==`). `./test.sh vendor` → `14 files match SHA256SUMS; three r170`. `./test.sh imports` → `34 imports in 16 files resolve`.

## 3. `run_step` turns errexit back on inside each step (2026-11-18)

- **Context:** the `run_step` copied from the workspace reference (`forparents/test.sh`) runs `set +e; ( "$@" )`. A step function inherits `set +e`, so only its last command's status counts. Mutation testing caught it: a syntax error in `crystal.js` left the `js` step green, because a later file still parsed.
- **Decision:** `( set -e; "$@" )`.
  - Rejected: adding `|| return 1` to every command in every step function. It is easy to forget in the next step someone writes.
- **Verified:** 26 deliberate breaks, each in a fresh copy of the repo (`scratchpad/mutrepo`), one per behaviour across all 12 local steps that test this repo's code. All 26 turned their step red, including the `crystal.js` syntax error that passed before the fix. `./test.sh` → `All checks passed  14 step(s), 0 skipped`.
