# TODO

Open items. Tick, never delete.

- [ ] Run pi-crystal against the real Pi: Pi on the same WiFi, SSH key login (pi-lab `scripts/pi key`), then `./run.sh pi-deploy && ./run.sh pi-serve`, `./run.sh`, open `/pi-crystal/`. Check that the badge says `live · Pi` and that a 30 s four-core `yes` load warms the colour, deepens the breathing and spins up the rings. Also confirm the Pi 5 paths (`cooling_fan/hwmon/*/fan1_input`, `/proc/net/wireless`) give numbers and not `null` — 2026-11-18, decision #1 Verified NOT YET
- [ ] Push the first green CI run of `ci.yml` (needs Node 22 from `setup-node`, shellcheck and `shasum` on the runner); check that the `test` job passes — 2026-11-18, CHANGELOG [Unreleased]
- [ ] Older demos load three.js from CDNs: `stars.html` has no version (`threejs.org/build/three.js`), and `index.html`/`cube`/`square` are pinned (r128) but not vendored. Pin or move them onto `vendor/three`; the `pins` step covers only pi-crystal and CI — 2026-11-18, decision #2
