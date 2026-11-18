"""Tests for telemetry.py: parsers, the sampler on a fake /proc + /sys tree, and the server end
to end (a subprocess on a free localhost port). Fixtures are invented, not copied from a real Pi.

    python3 -I -m unittest discover -s pi-crystal/pi -v
"""
import ast
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
import urllib.error
import urllib.request
from http.client import HTTPConnection

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import telemetry as tm  # noqa: E402

STAT_A = """cpu  1000 0 500 8000 100 0 0 0 0 0
cpu0 250 0 125 2000 25 0 0 0 0 0
cpu1 250 0 125 2000 25 0 0 0 0 0
cpu2 250 0 125 2000 25 0 0 0 0 0
cpu3 250 0 125 2000 25 0 0 0 0 0
intr 12345
ctxt 678
"""
# cpu0: +100 busy, +0 idle -> 1.0; cpu1: +0 busy, +100 idle -> 0.0;
# cpu2: +50 busy, +50 idle -> 0.5; cpu3: +25 busy, +75 idle -> 0.25. Total: 175 / 400.
STAT_B = """cpu  1175 0 500 8225 100 0 0 0 0 0
cpu0 350 0 125 2000 25 0 0 0 0 0
cpu1 250 0 125 2100 25 0 0 0 0 0
cpu2 300 0 125 2050 25 0 0 0 0 0
cpu3 275 0 125 2075 25 0 0 0 0 0
"""
MEMINFO = """MemTotal:        4000000 kB
MemFree:          500000 kB
MemAvailable:    3000000 kB
Buffers:           10000 kB
"""
WIRELESS = """Inter-| sta-|   Quality        |   Discarded packets               | Missed | WE
 face | tus | link level noise |  nwid  crypt   frag  retry   misc | beacon | 22
 wlan0: 0000   56.  -54.  -256        0      0      0      0      0        0
"""
EXPECTED_KEYS = {"t", "temp_c", "load", "cores", "mem", "fan_rpm", "wifi", "throttled"}


def write_tree(root, stat=STAT_A, temp="52300\n", fan="2400\n", meminfo=MEMINFO, wireless=WIRELESS):
    """A fake Pi under root. A None argument leaves that file out."""
    files = {
        "proc/stat": stat,
        "sys/class/thermal/thermal_zone0/temp": temp,
        "sys/devices/platform/cooling_fan/hwmon/hwmon3/fan1_input": fan,
        "proc/meminfo": meminfo,
        "proc/net/wireless": wireless,
    }
    for rel, text in files.items():
        if text is None:
            continue
        path = os.path.join(root, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)


class Parsers(unittest.TestCase):
    def test_temp(self):
        self.assertEqual(tm.parse_temp("52300\n"), 52.3)
        self.assertEqual(tm.parse_temp("-1000"), -1.0)
        with self.assertRaises(ValueError):
            tm.parse_temp("hot")

    def test_stat_columns(self):
        s = tm.parse_stat(STAT_A)
        self.assertEqual(sorted(s), ["cpu", "cpu0", "cpu1", "cpu2", "cpu3"])
        self.assertEqual(s["cpu"], (8100, 9600))  # idle+iowait, sum of 8 columns
        self.assertEqual(tm.parse_stat("cpu 1 2 3 4\n")["cpu"], (4, 10))  # short line padded

    def test_busy_fraction(self):
        a, b = tm.parse_stat(STAT_A), tm.parse_stat(STAT_B)
        got = [tm.busy_fraction(a[k], b[k]) for k in ("cpu0", "cpu1", "cpu2", "cpu3")]
        self.assertEqual(got, [1.0, 0.0, 0.5, 0.25])
        self.assertAlmostEqual(tm.busy_fraction(a["cpu"], b["cpu"]), 175 / 400)
        self.assertIsNone(tm.busy_fraction((5, 10), (5, 10)))   # no time passed
        self.assertIsNone(tm.busy_fraction((5, 10), (5, 9)))    # counter went back
        self.assertEqual(tm.busy_fraction((0, 0), (50, 10)), 0.0)  # clamped, never negative

    def test_meminfo(self):
        self.assertAlmostEqual(tm.parse_meminfo(MEMINFO), 0.25)
        self.assertIsNone(tm.parse_meminfo("MemFree: 1 kB\n"))
        self.assertIsNone(tm.parse_meminfo("MemTotal: 0 kB\nMemAvailable: 0 kB\n"))

    def test_wireless(self):
        self.assertAlmostEqual(tm.parse_wireless(WIRELESS), 0.8)
        self.assertIsNone(tm.parse_wireless(WIRELESS, "wlan1"))
        self.assertIsNone(tm.parse_wireless(WIRELESS.splitlines()[0]))  # header only: no wifi
        self.assertEqual(tm.parse_wireless(" wlan0: 0000   90.  -30.  -256 0 0 0 0 0 0"), 1.0)

    def test_throttled(self):
        self.assertEqual(tm.parse_throttled("throttled=0x0\n"), {"raw": 0, "flags": []})
        got = tm.parse_throttled("throttled=0x50005")
        self.assertEqual(got["raw"], 0x50005)
        self.assertEqual(got["flags"], ["under_voltage", "throttled",
                                        "under_voltage_occurred", "throttled_occurred"])
        with self.assertRaises((ValueError, IndexError)):
            tm.parse_throttled("error=1")


class SamplerOnFakeRoot(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name

    def tearDown(self):
        self.tmp.cleanup()

    def test_first_sample_has_no_load_then_deltas(self):
        write_tree(self.root)
        s = tm.Sampler(self.root)
        first = s.sample()
        self.assertEqual(set(first), EXPECTED_KEYS)
        self.assertIsNone(first["load"])
        self.assertIsNone(first["cores"])
        self.assertEqual(first["temp_c"], 52.3)
        self.assertEqual(first["fan_rpm"], 2400)
        self.assertAlmostEqual(first["mem"], 0.25)
        self.assertAlmostEqual(first["wifi"], 0.8)
        self.assertIsNone(first["throttled"])  # fake root never calls vcgencmd
        write_tree(self.root, stat=STAT_B)
        second = s.sample()
        self.assertEqual(second["cores"], [1.0, 0.0, 0.5, 0.25])
        self.assertAlmostEqual(second["load"], 175 / 400)
        json.dumps(second)  # serialisable as sent

    def test_missing_and_garbled_files_become_null(self):
        write_tree(self.root, temp="garbage\n", fan=None, wireless=None, meminfo="nonsense")
        r = tm.Sampler(self.root).sample()
        for key in ("temp_c", "fan_rpm", "wifi", "mem"):
            self.assertIsNone(r[key], key)

    def test_empty_root_does_not_raise(self):
        r = tm.Sampler(self.root).sample()
        self.assertEqual(set(r), EXPECTED_KEYS)
        self.assertTrue(all(r[k] is None for k in EXPECTED_KEYS - {"t"}))

    def test_cores_sorted_numerically(self):
        many = "".join(f"cpu{i} {i} 0 0 10 0 0 0 0\n" for i in (10, 2, 1, 0))
        more = "".join(f"cpu{i} {i + 10} 0 0 10 0 0 0 0\n" for i in (10, 2, 1, 0))
        write_tree(self.root, stat=many)
        s = tm.Sampler(self.root)
        s.sample()
        write_tree(self.root, stat=more)
        self.assertEqual(len(s.sample()["cores"]), 4)


class StatusLine(unittest.TestCase):
    def test_nulls_and_throttle(self):
        r = {k: None for k in EXPECTED_KEYS}
        self.assertIn("temp   --C", tm.status_line(r, 0))
        r["throttled"] = {"raw": 0x50004, "flags": ["throttled", "under_voltage_occurred", "throttled_occurred"]}
        line = tm.status_line(r, 2)
        self.assertIn("THROTTLE throttled", line)
        self.assertNotIn("occurred", line)
        self.assertIn("clients 2", line)


class StdlibOnly(unittest.TestCase):
    """The Pi gets no pip install: every import must be standard library."""

    def test_imports(self):
        with open(os.path.join(HERE, "telemetry.py"), encoding="utf-8") as f:
            tree = ast.parse(f.read())
        names = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                names.update(a.name.split(".")[0] for a in node.names)
            elif isinstance(node, ast.ImportFrom):
                names.add(node.module.split(".")[0])
        self.assertEqual(sorted(n for n in names if n not in sys.stdlib_module_names), [])


class ServerEndToEnd(unittest.TestCase):
    """telemetry.py as a real process on 127.0.0.1, port picked by the OS, fake root."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        write_tree(cls.tmp.name)
        cls.proc = subprocess.Popen(
            [sys.executable, "-I", os.path.join(HERE, "telemetry.py"), "--host", "127.0.0.1",
             "--port", "0", "--interval", "0.05", "--root", cls.tmp.name,
             "--allow-origin", "http://localhost:8000"],
            stderr=subprocess.PIPE, stdout=subprocess.DEVNULL, text=True)
        line = cls.proc.stderr.readline()
        m = re.search(r"http://127\.0\.0\.1:(\d+)/events", line)
        if not m:
            cls.proc.kill()
            raise AssertionError(f"no ready line from telemetry.py: {line!r}")
        cls.port = int(m.group(1))

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        try:
            cls.proc.wait(timeout=5)
        finally:
            cls.proc.stderr.close()
            cls.tmp.cleanup()

    def _events(self, origin=None, n=2):
        conn = HTTPConnection("127.0.0.1", self.port, timeout=5)
        conn.request("GET", "/events", headers={"Origin": origin} if origin else {})
        resp = conn.getresponse()
        events = []
        while len(events) < n:
            line = resp.fp.readline().decode()
            self.assertNotEqual(line, "", "stream closed early")
            if line.startswith("data: "):
                events.append(json.loads(line[6:]))
        conn.close()
        return resp, events

    def test_stream_shape_and_headers(self):
        resp, events = self._events(origin="http://localhost:8000", n=3)
        self.assertEqual(resp.status, 200)
        self.assertEqual(resp.getheader("Content-Type"), "text/event-stream")
        self.assertEqual(resp.getheader("Cache-Control"), "no-store")
        self.assertEqual(resp.getheader("Access-Control-Allow-Origin"), "http://localhost:8000")
        for ev in events:
            self.assertEqual(set(ev), EXPECTED_KEYS)
            self.assertEqual(ev["temp_c"], 52.3)
        self.assertLess(events[0]["t"], events[-1]["t"])  # fresh samples, not one repeated
        # The fake /proc/stat never changes, so after the first sample load is "no time passed".
        self.assertIsNone(events[-1]["load"])

    def test_other_origin_gets_no_cors_header(self):
        resp, _ = self._events(origin="http://evil.example", n=1)
        self.assertIsNone(resp.getheader("Access-Control-Allow-Origin"))
        resp, _ = self._events(origin=None, n=1)
        self.assertIsNone(resp.getheader("Access-Control-Allow-Origin"))

    def test_index_and_404(self):
        base = f"http://127.0.0.1:{self.port}"
        with urllib.request.urlopen(base + "/", timeout=5) as r:
            self.assertIn(b"GET /events", r.read())
        for path in ("/nope", "/events?x=1", "/../etc/passwd"):
            with self.assertRaises(urllib.error.HTTPError) as cm:
                urllib.request.urlopen(base + path, timeout=5)
            self.assertEqual(cm.exception.code, 404, path)
            cm.exception.close()

    def test_post_not_allowed(self):
        conn = HTTPConnection("127.0.0.1", self.port, timeout=5)
        conn.request("POST", "/events", body=b"x")
        self.assertEqual(conn.getresponse().status, 501)
        conn.close()


class Cli(unittest.TestCase):
    def test_help_and_bad_args(self):
        run = lambda *a: subprocess.run([sys.executable, "-I", os.path.join(HERE, "telemetry.py"), *a],
                                        capture_output=True, text=True, timeout=10)
        self.assertEqual(run("--help").returncode, 0)
        self.assertEqual(run("--port", "notanumber").returncode, 2)
        self.assertEqual(run("--bogus").returncode, 2)


if __name__ == "__main__":
    unittest.main()
