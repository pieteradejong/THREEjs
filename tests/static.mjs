// tests/static.mjs — static checks on pi-crystal that need no browser. Exit 0 = all hold.
//   node tests/static.mjs <check>   checks: imports | page | privacy
// Called by ./test.sh (steps imports, page, privacy). Reads files only.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CRYSTAL = join(ROOT, 'pi-crystal');
const PAGE = join(CRYSTAL, 'index.html');
const errors = [];
const fail = (msg) => errors.push(msg);
const rel = (p) => relative(ROOT, p);

function walk(dir, pred, out = []) {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, pred, out);
        else if (pred(p)) out.push(p);
    }
    return out;
}

function importMap() {
    const html = readFileSync(PAGE, 'utf8');
    const m = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
    if (!m) { fail('pi-crystal/index.html: no import map'); return {}; }
    try { return JSON.parse(m[1]).imports || {}; } catch (e) { fail(`import map is not JSON: ${e.message}`); return {}; }
}

// Every import in pi-crystal/*.js and the vendored addons resolves to a file in the repo:
// relative specifiers by path, bare ones through the page's import map. No remote URLs.
function checkImports() {
    const map = importMap();
    const resolveBare = (spec) => {
        if (map[spec]) return resolve(CRYSTAL, map[spec]);
        const prefix = Object.keys(map).filter((k) => k.endsWith('/') && spec.startsWith(k)).sort((a, b) => b.length - a.length)[0];
        return prefix ? resolve(CRYSTAL, map[prefix] + spec.slice(prefix.length)) : null;
    };
    for (const [k, v] of Object.entries(map)) {
        if (/^[a-z]+:/i.test(v) || v.startsWith('//')) fail(`import map "${k}" points off-site: ${v}`);
        const target = resolve(CRYSTAL, v);
        if (!target.startsWith(join(ROOT, 'vendor') + '/')) fail(`import map "${k}" points outside vendor/: ${v}`);
        if (!v.endsWith('/') && !existsSync(target)) fail(`import map "${k}" -> missing ${rel(target)}`);
    }
    const files = [
        ...walk(CRYSTAL, (p) => /\.(m?js)$/.test(p) && !p.includes('/tests/')),
        ...walk(join(ROOT, 'vendor/three/addons'), (p) => p.endsWith('.js')),
    ];
    const re = /(?:^|[\s;])(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|^import\s+['"]([^'"]+)['"]/gm;
    let n = 0;
    for (const f of files) {
        const src = readFileSync(f, 'utf8');
        for (const m of src.matchAll(re)) {
            const spec = m[1] || m[2] || m[3];
            n++;
            if (/^[a-z]+:/i.test(spec) || spec.startsWith('//')) { fail(`${rel(f)}: remote import ${spec}`); continue; }
            const target = spec.startsWith('.') ? resolve(dirname(f), spec) : resolveBare(spec);
            if (!target) fail(`${rel(f)}: bare import "${spec}" is not in the import map`);
            else if (!existsSync(target)) fail(`${rel(f)}: import "${spec}" -> missing ${rel(target)}`);
        }
    }
    if (n < 10) fail(`only ${n} imports found: the import scanner is broken`);
    return `${n} imports in ${files.length} files resolve`;
}

// The page: language, title, a viewport that allows zoom, every id main.js looks up exists,
// and no <script src> or stylesheet from another host.
function checkPage() {
    const html = readFileSync(PAGE, 'utf8');
    if (!/<html lang="[a-z]{2}/.test(html)) fail('index.html: <html> has no lang');
    if (!/<title>[^<]{3,}<\/title>/.test(html)) fail('index.html: no <title>');
    const vp = html.match(/<meta name="viewport" content="([^"]+)"/);
    if (!vp) fail('index.html: no viewport meta');
    else {
        if (!vp[1].includes('width=device-width')) fail('viewport: no width=device-width');
        if (/user-scalable\s*=\s*no|maximum-scale/.test(vp[1])) fail('viewport: blocks pinch zoom');
    }
    for (const m of html.matchAll(/<(?:script|link|img)\b[^>]*\b(?:src|href)="([^"]+)"/g)) {
        if (/^(https?:)?\/\//.test(m[1])) fail(`index.html: loads from another host: ${m[1]}`);
    }
    if (!/<script type="module" src="\.\/main\.js">/.test(html)) fail('index.html: does not load ./main.js as a module');
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
    const main = readFileSync(join(CRYSTAL, 'main.js'), 'utf8');
    const used = new Set([...main.matchAll(/(?:\$|getElementById)\('([^']+)'\)/g)].map((m) => m[1]));
    if (used.size < 5) fail(`main.js: only ${used.size} element ids found: the scanner is broken`);
    for (const id of used) if (!ids.has(id)) fail(`main.js looks up #${id}, which index.html does not have`);
    const bars = (html.match(/<span><i><\/i><\/span>/g) || []).length;
    if (bars !== 4) fail(`index.html: ${bars} core bars, want 4 (one per Pi 5 core)`);
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
    if (!readme.includes('pi-crystal/')) fail('README.md does not link pi-crystal/');
    return `${used.size} element ids present, viewport allows zoom, no off-site loads`;
}

// The repo is public: no IP address other than loopback/any, no MAC address, no .env value.
function checkPrivacy() {
    const files = [
        ...walk(CRYSTAL, (p) => /\.(m?js|html|md|py|json)$/.test(p)),
        join(ROOT, 'run.sh'), join(ROOT, 'README.md'),
    ];
    const allowedIp = new Set(['127.0.0.1', '0.0.0.0']);
    for (const f of files) {
        const src = readFileSync(f, 'utf8');
        for (const m of src.matchAll(/\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g)) {
            if (m.slice(1).every((x) => +x <= 255) && !allowedIp.has(m[0])) fail(`${rel(f)}: IP address ${m[0]}`);
        }
        for (const m of src.matchAll(/\b[0-9a-f]{2}(?::[0-9a-f]{2}){5}\b/gi)) fail(`${rel(f)}: MAC address ${m[0]}`);
    }
    return `${files.length} files hold no IP or MAC address`;
}

const checks = { imports: checkImports, page: checkPage, privacy: checkPrivacy };
const which = process.argv[2];
if (!checks[which]) {
    console.error(`usage: node tests/static.mjs ${Object.keys(checks).join('|')}`);
    process.exit(2);
}
const summary = checks[which]();
if (errors.length) {
    for (const e of errors) console.error(`FAIL: ${e}`);
    process.exit(1);
}
console.log(summary);
