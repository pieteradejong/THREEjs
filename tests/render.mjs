// tests/render.mjs — the page in a real browser (Playwright WebKit), end to end. Exit 0 = pass.
//   node tests/render.mjs
// 1. mock: ?source=mock renders, animates, shows "mock data", no console error.
// 2. hot:  ?source=mock&at=36 shows the stress burst (temperature above 70 °C).
// 3. live: telemetry.py on a fake /proc + /sys tree, on 127.0.0.1, streams into the page; the
//          badge turns "live · Pi" and the HUD shows the fake Pi's numbers.
// 4. down: a ?pi= nobody answers on: badge "Pi not reachable · mock", still animating.
// 5. phone: on a 375 px screen the readings start collapsed and the toggle opens them.
// Playwright comes from PLAYWRIGHT_DIR (default: the mobile-vetting skill's install), so this repo
// has no node_modules. Everything is local: a node static server and telemetry.py on loopback.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { dirname, join, resolve, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PW_DIR = process.env.PLAYWRIGHT_DIR || join(homedir(), '.claude/skills/mobile-vetting');
const { webkit } = createRequire(join(PW_DIR, 'package.json'))('playwright');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };
const server = createServer(async (req, res) => {
    const path = normalize(join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
    const file = path.endsWith(sep) ? join(path, 'index.html') : path;
    if (!file.startsWith(ROOT + sep)) { res.writeHead(403).end(); return; }
    try {
        const body = await readFile(file);
        res.writeHead(200, { 'Content-Type': TYPES[file.slice(file.lastIndexOf('.'))] || 'application/octet-stream' }).end(body);
    } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

// A fake Pi: invented numbers, not from a real device.
const fake = await mkdtemp(join(tmpdir(), 'pi-crystal-render-'));
const put = async (rel, text) => { await mkdir(dirname(join(fake, rel)), { recursive: true }); await writeFile(join(fake, rel), text); };
await put('sys/class/thermal/thermal_zone0/temp', '63700\n');
await put('sys/devices/platform/cooling_fan/hwmon/hwmon2/fan1_input', '3100\n');
await put('proc/meminfo', 'MemTotal: 4000000 kB\nMemAvailable: 2000000 kB\n');
await put('proc/net/wireless', 'h1\nh2\n wlan0: 0000   35.  -60.  -256 0 0 0 0 0 0\n');
await put('proc/stat', 'cpu 10 0 0 90 0 0 0 0\ncpu0 1 0 0 9 0 0 0 0\n');

const py = spawn('python3', ['-I', join(ROOT, 'pi-crystal/pi/telemetry.py'), '--host', '127.0.0.1', '--port', '0',
    '--interval', '0.1', '--root', fake, '--allow-origin', origin], { stdio: ['ignore', 'ignore', 'pipe'] });
const piPort = await new Promise((res, rej) => {
    let buf = '';
    const t = setTimeout(() => rej(new Error(`telemetry.py did not start: ${buf}`)), 10000);
    py.stderr.on('data', (d) => {
        buf += d;
        const m = buf.match(/127\.0\.0\.1:(\d+)\/events/);
        if (m) { clearTimeout(t); res(+m[1]); }
    });
});

const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); };
const browser = await webkit.launch();

async function visit(name, query, { wait = 3000, viewport = { width: 1280, height: 800 }, act } = {}) {
    const page = await browser.newPage({ viewport });
    const errs = [];
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(`${origin}/pi-crystal/${query}`);
    await page.waitForTimeout(wait);
    const a = await page.screenshot();
    await page.waitForTimeout(400);
    const b = await page.screenshot();
    const hud = await page.evaluate(() => Object.fromEntries(
        ['badge', 'v-temp', 'v-load', 'v-fan', 'v-wifi', 'v-mem', 'v-throttle'].map((id) => [id, document.getElementById(id).textContent])));
    const acted = act ? await act(page) : null;
    await page.close();
    // A blank canvas compresses to almost nothing; a still one gives identical frames.
    check(a.length > 40000, `${name}: screenshot only ${a.length} bytes, canvas looks blank`);
    check(Buffer.compare(a, b) !== 0, `${name}: two frames 400 ms apart are identical, nothing animates`);
    return { hud, errs, acted };
}

try {
    const mock = await visit('mock', '?source=mock');
    check(mock.hud.badge === 'mock data', `mock: badge "${mock.hud.badge}"`);
    check(/°C$/.test(mock.hud['v-temp']), `mock: temperature "${mock.hud['v-temp']}"`);
    check(mock.errs.length === 0, `mock: console errors: ${mock.errs.join(' | ')}`);

    const hot = await visit('hot', '?source=mock&at=36');
    check(parseFloat(hot.hud['v-temp']) > 70, `hot: temperature "${hot.hud['v-temp']}" is not above 70 °C`);
    check(parseInt(hot.hud['v-fan'], 10) > 3000, `hot: fan "${hot.hud['v-fan']}" did not spin up`);
    check(hot.errs.length === 0, `hot: console errors: ${hot.errs.join(' | ')}`);

    const live = await visit('live', `?pi=127.0.0.1:${piPort}`);
    check(live.hud.badge === 'live · Pi', `live: badge "${live.hud.badge}"`);
    check(live.hud['v-temp'] === '63.7 °C', `live: temperature "${live.hud['v-temp']}", want the fake Pi's 63.7 °C`);
    check(live.hud['v-fan'] === '3100 rpm', `live: fan "${live.hud['v-fan']}"`);
    check(live.hud['v-wifi'] === '50%', `live: wifi "${live.hud['v-wifi']}"`);
    check(live.hud['v-mem'] === '50%', `live: memory "${live.hud['v-mem']}"`);
    check(live.hud['v-throttle'] === '–', `live: throttle "${live.hud['v-throttle']}" (fake root has no vcgencmd)`);
    check(live.errs.length === 0, `live: console errors: ${live.errs.join(' | ')}`);

    // Port 9 (discard) on loopback: nothing listens, so the connection is refused at once.
    const down = await visit('down', '?pi=127.0.0.1:9');
    check(down.hud.badge === 'Pi not reachable · mock', `down: badge "${down.hud.badge}"`);
    const panel = async (page) => {
        const state = () => page.evaluate(() => ({
            collapsed: document.getElementById('hud').classList.contains('collapsed'),
            expanded: document.getElementById('toggle').getAttribute('aria-expanded'),
            readings: getComputedStyle(document.getElementById('readings')).display,
        }));
        const before = await state();
        await page.click('#toggle');
        return { before, after: await state() };
    };
    const phone = await visit('phone', '?source=mock', { viewport: { width: 375, height: 667 }, act: panel });
    const p = phone.acted;
    check(p.before.collapsed && p.before.expanded === 'false' && p.before.readings === 'none', `phone: panel not collapsed at start: ${JSON.stringify(p.before)}`);
    check(!p.after.collapsed && p.after.expanded === 'true' && p.after.readings !== 'none', `phone: toggle did not open the panel: ${JSON.stringify(p.after)}`);
    check(phone.errs.length === 0, `phone: console errors: ${phone.errs.join(' | ')}`);
    const wide = await visit('wide', '?source=mock', { wait: 1500, act: panel });
    check(!wide.acted.before.collapsed, 'desktop: panel should start open');

    const other = down.errs.filter((e) => !/127\.0\.0\.1:9|EventSource|connect|access control|Load failed/i.test(e));
    check(other.length === 0, `down: console errors besides the refused connection: ${other.join(' | ')}`);
} finally {
    await browser.close();
    py.kill();
    server.close();
    await rm(fake, { recursive: true, force: true });
}

if (failures.length) {
    for (const f of failures) console.error(`FAIL: ${f}`);
    process.exit(1);
}
console.log('mock, hot, live, down, phone and desktop render; live shows the fake Pi; no console errors');
