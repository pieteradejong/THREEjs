# Sessions

Newest first.

## 2026-11-18: Pi Crystal

**Asked:** use the Raspberry Pi to make a three.js animation, driven by the Pi's data, viewed on the MacBook, in this repo, in a "breathing crystal" style. Plus a comprehensive and strict `test.sh`.

**Changed:**
- `pi-crystal/`: the page, the scene, the mapping and mock Pi, and the live/mock source.
- `pi-crystal/pi/telemetry.py`: the SSE server (decision #1).
- three.js 0.170.0 vendored (decision #2).
- `run.sh`: `pi-deploy` and `pi-serve`.
- `test.sh`: rewritten, 14 steps (decision #3).
- `ci.yml`, plus the READMEs.

**Verified:**
- `./test.sh` → `All checks passed  14 step(s), 0 skipped`, and `./test.sh --ci` → 12 passed, 2 skipped (`render`, `gate`).
- `testsh-lint.sh` → `0 FAIL, 0 WARN`.
- 26 deliberate breaks turned their step red (decision #3).
- The mobile audit on `/pi-crystal/?source=mock` exited 0 with 0 FAIL and 0 WARN on iPhone SE (portrait and landscape), iPhone 17 Pro, Pixel 7, iPad mini and a throttled Pixel 7. The screenshots were looked at. They showed the readings panel covering the crystal on phones, so it now starts collapsed there, and `render` checks that.
- Mock mode ran at 60 fps in headless WebKit with no console errors.
- Before the commit, `git status --ignored` showed that `vendor/three/build/` was gitignored by `build/`. It now has an exception, and the `vendor` step checks for it; with the exception removed, the step goes red.

**Open (`TODO.md`):**
- The real-Pi run. `raspberrypi.local` didn't answer twice this session, and login is still by password.
- The first CI run.
- The old demos' CDN loads.
