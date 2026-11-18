#!/usr/bin/env python3
"""telemetry.py: stream a Raspberry Pi's live readings as Server-Sent Events.

Runs on the Pi, standard library only. One background thread samples the
readings every --interval seconds; every client on GET /events receives the
latest sample as one `data: {json}` line per interval. Nothing is written and
no request parameter is read, so the server has no input surface.

    python3 telemetry.py                    # :8765, all interfaces
    python3 telemetry.py --port 9000
    python3 telemetry.py --root /tmp/fake   # tests: read /proc and /sys from a fake tree

Readings (Pi 5 paths, relative to --root):
    temp_c     sys/class/thermal/thermal_zone0/temp           millidegrees -> degrees C
    cores      proc/stat                                       per-core busy fraction, from deltas
    load       proc/stat                                       all-core busy fraction
    mem        proc/meminfo                                    1 - MemAvailable/MemTotal
    fan_rpm    sys/devices/platform/cooling_fan/hwmon/*/fan1_input
    wifi       proc/net/wireless                               wlan0 link quality / 70
    throttled  `vcgencmd get_throttled` (only when --root is /) bitmask, see THROTTLE_BITS
A reading that cannot be read is null; the page then holds it at a neutral level.
"""
import argparse
import glob
import json
import os
import shutil
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DEFAULT_ORIGINS = ("http://localhost:8000", "http://127.0.0.1:8000")

# vcgencmd get_throttled bits (Raspberry Pi docs, "vcgencmd" page).
THROTTLE_BITS = {
    0: "under_voltage",
    1: "freq_capped",
    2: "throttled",
    3: "soft_temp_limit",
    16: "under_voltage_occurred",
    17: "freq_capped_occurred",
    18: "throttled_occurred",
    19: "soft_temp_limit_occurred",
}


# --- parsers: pure functions of a file's text --------------------------------

def parse_temp(text):
    """thermal_zone temp file ("52300\\n") -> 52.3 (degrees C)."""
    return int(text.strip()) / 1000.0


def parse_stat(text):
    """/proc/stat -> {"cpu": (idle, total), "cpu0": (idle, total), ...}.

    Columns after the name: user nice system idle iowait irq softirq steal ...
    idle counts idle + iowait; total sums the first 8 columns (guest time is
    already inside user/nice).
    """
    out = {}
    for line in text.splitlines():
        parts = line.split()
        if not parts or not parts[0].startswith("cpu"):
            continue
        nums = [int(x) for x in parts[1:9]]
        nums += [0] * (8 - len(nums))
        out[parts[0]] = (nums[3] + nums[4], sum(nums))
    return out


def busy_fraction(prev, cur):
    """Two (idle, total) samples -> busy fraction 0..1, or None if no time passed."""
    d_total = cur[1] - prev[1]
    if d_total <= 0:
        return None
    return max(0.0, min(1.0, 1.0 - (cur[0] - prev[0]) / d_total))


def parse_meminfo(text):
    """/proc/meminfo -> used fraction 0..1 (1 - MemAvailable/MemTotal)."""
    vals = {}
    for line in text.splitlines():
        key, _, rest = line.partition(":")
        if rest:
            vals[key.strip()] = int(rest.split()[0])
    total = vals.get("MemTotal")
    avail = vals.get("MemAvailable")
    if not total or avail is None:
        return None
    return max(0.0, min(1.0, 1.0 - avail / total))


def parse_wireless(text, iface="wlan0"):
    """/proc/net/wireless -> link quality 0..1 for iface, or None if it is absent.

    Data lines look like: " wlan0: 0000   58.  -52.  -256 ...": status, link, level, noise.
    The kernel scales link quality to 70 on the Pi's brcmfmac driver.
    """
    for line in text.splitlines():
        name, sep, rest = line.partition(":")
        if sep and name.strip() == iface:
            fields = rest.split()
            link = float(fields[1].rstrip("."))
            return max(0.0, min(1.0, link / 70.0))
    return None


def parse_throttled(text):
    """vcgencmd output "throttled=0x50000" -> {"raw": int, "flags": [names]}."""
    key, sep, value = text.strip().partition("=")
    if key != "throttled" or not sep:
        raise ValueError(f"not vcgencmd get_throttled output: {text!r}")
    raw = int(value, 16)
    flags = [name for bit, name in sorted(THROTTLE_BITS.items()) if raw & (1 << bit)]
    return {"raw": raw, "flags": flags}


# --- sampler -------------------------------------------------------------------

class Sampler:
    """Reads every source from root; keeps the previous /proc/stat for the deltas."""

    def __init__(self, root="/"):
        self.root = root
        self.prev_stat = None

    def _read(self, rel):
        with open(os.path.join(self.root, rel), encoding="utf-8") as f:
            return f.read()

    def _try(self, fn):
        try:
            return fn()
        except (OSError, ValueError, IndexError, subprocess.SubprocessError):
            return None

    def _fan(self):
        pattern = os.path.join(self.root, "sys/devices/platform/cooling_fan/hwmon/*/fan1_input")
        for path in sorted(glob.glob(pattern)):
            with open(path, encoding="utf-8") as f:
                return int(f.read().strip())
        return None

    def _throttled(self):
        # vcgencmd reads the real firmware, so a fake root never calls it.
        if self.root != "/" or not shutil.which("vcgencmd"):
            return None
        out = subprocess.run(["vcgencmd", "get_throttled"], capture_output=True,
                             text=True, timeout=1, check=True).stdout
        return parse_throttled(out)

    def sample(self):
        cores, load = None, None
        stat = self._try(lambda: parse_stat(self._read("proc/stat")))
        if stat and self.prev_stat:
            names = sorted((k for k in stat if k != "cpu" and k in self.prev_stat),
                           key=lambda k: int(k[3:]))
            cores = [busy_fraction(self.prev_stat[k], stat[k]) for k in names]
            if "cpu" in stat and "cpu" in self.prev_stat:
                load = busy_fraction(self.prev_stat["cpu"], stat["cpu"])
        if stat:
            self.prev_stat = stat
        return {
            "t": round(time.time(), 3),
            "temp_c": self._try(lambda: parse_temp(self._read("sys/class/thermal/thermal_zone0/temp"))),
            "load": load,
            "cores": cores,
            "mem": self._try(lambda: parse_meminfo(self._read("proc/meminfo"))),
            "fan_rpm": self._try(self._fan),
            "wifi": self._try(lambda: parse_wireless(self._read("proc/net/wireless"))),
            "throttled": self._try(self._throttled),
        }


# --- server --------------------------------------------------------------------

class Hub:
    """Latest sample plus a condition variable that wakes every client per sample."""

    def __init__(self):
        self.cond = threading.Condition()
        self.latest = None
        self.seq = 0
        self.clients = 0

    def publish(self, reading):
        with self.cond:
            self.latest = reading
            self.seq += 1
            self.cond.notify_all()

    def wait_next(self, seen, timeout):
        with self.cond:
            self.cond.wait_for(lambda: self.seq != seen, timeout=timeout)
            return self.seq, self.latest


def make_handler(hub, origins, interval):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt, *args):  # quiet: the status line shows clients
            pass

        def _cors(self):
            origin = self.headers.get("Origin")
            if origin in origins:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")

        def do_GET(self):
            if self.path == "/events":
                self._events()
            elif self.path == "/":
                body = b"pi-crystal telemetry: GET /events (text/event-stream)\n"
                self.send_response(200)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            else:
                self.send_error(404)

        def _events(self):
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "keep-alive")
            self._cors()
            self.end_headers()
            with hub.cond:
                hub.clients += 1
            seen = 0
            try:
                self.wfile.write(b"retry: 2000\n\n")
                while True:
                    seen, reading = hub.wait_next(seen, timeout=interval * 8)
                    if reading is None:
                        self.wfile.write(b": waiting\n\n")
                    else:
                        self.wfile.write(b"data: " + json.dumps(reading).encode() + b"\n\n")
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass
            finally:
                with hub.cond:
                    hub.clients -= 1

    return Handler


def fmt(v, scale=1.0, unit="", nd=0):
    return "  --" + unit if v is None else f"{v * scale:5.{nd}f}{unit}"


def status_line(r, clients):
    th = r.get("throttled")
    th_s = ",".join(f for f in th["flags"] if not f.endswith("occurred")) if th else ""
    return (f"temp {fmt(r['temp_c'], 1, 'C', 1)}  load {fmt(r['load'], 100, '%')}  "
            f"mem {fmt(r['mem'], 100, '%')}  fan {fmt(r['fan_rpm'], 1, 'rpm')}  "
            f"wifi {fmt(r['wifi'], 100, '%')}  clients {clients}"
            + (f"  THROTTLE {th_s}" if th_s else ""))


def sample_loop(sampler, hub, interval, stop, tty):
    while not stop.is_set():
        reading = sampler.sample()
        hub.publish(reading)
        if tty:
            sys.stderr.write("\r" + status_line(reading, hub.clients) + "\033[K")
            sys.stderr.flush()
        stop.wait(interval)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--host", default="0.0.0.0", help="bind address (default: all interfaces)")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--interval", type=float, default=0.25, help="seconds between samples")
    ap.add_argument("--root", default="/", help="read /proc and /sys under this directory (tests)")
    ap.add_argument("--allow-origin", action="append", metavar="URL",
                    help="page origin allowed to read the stream (repeatable; default: "
                         + ", ".join(DEFAULT_ORIGINS) + ")")
    args = ap.parse_args(argv)
    origins = frozenset(args.allow_origin or DEFAULT_ORIGINS)

    hub = Hub()
    sampler = Sampler(args.root)
    stop = threading.Event()
    server = ThreadingHTTPServer((args.host, args.port), make_handler(hub, origins, args.interval))
    server.daemon_threads = True
    threading.Thread(target=sample_loop, args=(sampler, hub, args.interval, stop,
                                               sys.stderr.isatty()), daemon=True).start()
    port = server.server_address[1]  # the real port, also when --port 0 picked a free one
    print(f"pi-crystal telemetry on http://{args.host}:{port}/events "
          f"(every {args.interval}s, origins: {', '.join(sorted(origins))}); Ctrl-C stops",
          file=sys.stderr, flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        server.server_close()
        print("\nstopped", file=sys.stderr)


if __name__ == "__main__":
    main()
