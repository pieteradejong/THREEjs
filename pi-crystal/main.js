// main.js: renderer, camera, bloom, the HUD and the frame loop.
// Data flow per frame: Source.read() -> normalize() -> Smoother.step() -> Crystal.update().
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Crystal } from './crystal.js';
import { Source } from './source.js';
import { normalize, Smoother } from './mapping.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('scene');
const pixelRatio = () => Math.min(window.devicePixelRatio || 1, 2);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(pixelRatio());
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x04060c);
scene.fog = new THREE.FogExp2(0x04060c, 0.03);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 100);
const fitCamera = () => {
    // Narrow (portrait) screens step back so the outer ring still fits.
    const aspect = window.innerWidth / window.innerHeight;
    camera.position.set(0, 0.8, aspect < 1 ? 7.6 / Math.max(aspect, 0.45) : 7.6);
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
};
fitCamera();

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 3.5;
controls.maxDistance = 22;
controls.autoRotate = !matchMedia('(prefers-reduced-motion: reduce)').matches;
controls.autoRotateSpeed = 0.4;

const crystal = new Crystal(scene, { pixelRatio: pixelRatio() });

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.5, 0.5, 0.55);
composer.addPass(bloom);
composer.addPass(new OutputPass());

window.addEventListener('resize', () => {
    fitCamera();
    renderer.setPixelRatio(pixelRatio());
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setPixelRatio(pixelRatio());
    composer.setSize(window.innerWidth, window.innerHeight);
    crystal.setPixelRatio(pixelRatio());
});

// --- HUD -----------------------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const hud = $('hud');
const badge = $('badge');
const BADGE = {
    live: ['live · Pi', 'live'],
    mock: ['mock data', 'mock'],
    offline: ['Pi not reachable · mock', 'offline'],
    reconnecting: ['reconnecting · mock', 'offline'],
};
const pct = (x) => (typeof x === 'number' ? `${Math.round(x * 100)}%` : '–');
const setCollapsed = (collapsed) => {
    hud.classList.toggle('collapsed', collapsed);
    $('toggle').setAttribute('aria-expanded', String(!collapsed));
};
$('toggle').addEventListener('click', () => setCollapsed(!hud.classList.contains('collapsed')));
// On a phone the full panel would cover the crystal: start with just the title and badge.
setCollapsed(matchMedia('(max-width: 600px), (max-height: 500px)').matches);
function renderHud(r, state, source) {
    const [text, cls] = BADGE[state];
    badge.textContent = text;
    badge.className = `badge ${cls}`;
    badge.title = state === 'mock' ? '' : source.url;
    $('v-temp').textContent = typeof r.temp_c === 'number' ? `${r.temp_c.toFixed(1)} °C` : '–';
    $('v-load').textContent = pct(r.load);
    $('v-fan').textContent = typeof r.fan_rpm === 'number' ? `${r.fan_rpm} rpm` : '–';
    $('v-wifi').textContent = pct(r.wifi);
    $('v-mem').textContent = pct(r.mem);
    const flags = r.throttled && r.throttled.flags ? r.throttled.flags.filter((f) => !f.endsWith('occurred')) : null;
    $('v-throttle').textContent = flags === null ? '–' : flags.length ? flags.join(', ') : 'no';
    $('v-throttle').classList.toggle('alarm', Boolean(flags && flags.length));
    const bars = $('v-cores').children;
    for (let i = 0; i < bars.length; i++) {
        const c = r.cores && typeof r.cores[i] === 'number' ? r.cores[i] : 0;
        bars[i].firstElementChild.style.transform = `scaleY(${Math.max(0.04, c)})`;
    }
}

// --- loop ----------------------------------------------------------------------------------------
const source = new Source(params);
const smoother = new Smoother(0.5);
const clock = new THREE.Clock();
let hudAt = 0;

renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    const t = clock.elapsedTime;
    const { reading, state } = source.read(t);
    const ch = smoother.step(normalize(reading), dt);
    crystal.update(ch, t, dt);
    scene.fog.density = 0.02 + ch.mem * 0.06;
    bloom.strength = 0.35 + ch.heat * 0.5 + ch.throttle * 0.4;
    controls.autoRotateSpeed = 0.3 + ch.load * 1.2;
    controls.update(dt);
    composer.render(dt);
    if (t - hudAt > 0.25) {
        hudAt = t;
        renderHud(reading, state, source);
    }
});
