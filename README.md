# THREEjs

three.js experiments. Serve the repo root with `./run.sh` and open the demos at `http://localhost:8000/`.

| Demo | What it is |
|---|---|
| [`pi-crystal/`](pi-crystal/) | **Pi Crystal**: a glass crystal that breathes with a Raspberry Pi's live temperature, CPU load, fan and WiFi, streamed to the Mac browser. `?source=mock` runs without a Pi. See [pi-crystal/README.md](pi-crystal/README.md). |
| [`index.html`](index.html) | Geometric carpet (`carpet/carpet.js`), with orbit controls |
| [`cube/`](cube/) | A spinning cube |
| [`square/`](square/) | A square |
| [`stars.html`](stars.html) | White dots on black |

## Commands

```sh
./run.sh                 # serve on http://localhost:8000 (PORT= to change)
./run.sh pi-deploy       # copy pi-crystal's telemetry server to the Pi
./run.sh pi-serve        # run it on the Pi (Ctrl-C stops)
./test.sh                # every check; ./test.sh --list shows them
```

`pi-crystal` uses three.js 0.170.0, vendored in [`vendor/three/`](vendor/three/) (MIT, © the
three.js authors) with checksums. The older demos still load three.js from a CDN.

## License

MIT, see [LICENSE](LICENSE). `vendor/three/` keeps its own MIT license.
