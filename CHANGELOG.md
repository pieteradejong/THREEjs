# Changelog

All notable changes to this repo. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- `pi-crystal/`: Pi Crystal, a three.js glass crystal driven by a Raspberry Pi's live readings. Temperature sets the colour, total load the breathing, per-core load the four shards, fan speed the rings, WiFi the sparkle, memory the haze, throttling a red flicker. `?source=mock` runs without a Pi, and the page falls back to mock data with a badge when the Pi can't be reached. On phones the readings panel starts collapsed.
- `pi-crystal/pi/telemetry.py`: the Pi-side Server-Sent Events server, standard library only, CORS limited to the page's origin (decision #1).
- `vendor/three/`: three.js 0.170.0 and the addons pi-crystal uses, with checksums in `SHA256SUMS` (decision #2). `.gitignore` gets an exception for `vendor/three/build/` (the generic `build/` rule hid it), and the `vendor` step fails if a vendored file is ignored.
- `./run.sh pi-deploy` and `./run.sh pi-serve`: copy the telemetry server to the Pi and run it over ssh. `PI_HOST`/`PI_USER` are validated so they can't become ssh options.
- CI: `.github/workflows/ci.yml` runs `./test.sh --ci`.

### Changed
- `./test.sh`: rewritten to the workspace standard with 14 named steps, `--list`, `<step>`, `--ci`, `--no-browser`, `NO_COLOR` and a summary table. New steps cover the vendored files, imports, the page, privacy, the telemetry server end to end, `run.sh` against stub ssh, and a WebKit render of the live path. Each step runs with errexit on (decision #3).
- README: lists the demos and the commands.
