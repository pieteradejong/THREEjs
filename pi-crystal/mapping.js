// mapping.js: pure functions from Pi readings to the crystal's 0..1 drive channels.
// No three.js, no DOM, so `node --test` covers it (tests/mapping.test.mjs).
//
// A reading (one SSE event from pi/telemetry.py, or mockReading()) looks like
//   { temp_c: 52.3, load: 0.21, cores: [0.1, 0.3, 0.2, 0.25], mem: 0.34,
//     fan_rpm: 2400, wifi: 0.83, throttled: { raw: 0, flags: [] } }
// Any field may be null (not readable on that machine). A null holds at NEUTRAL.

export const TEMP_COOL_C = 40;    // heat 0: cool cyan
export const TEMP_HOT_C = 85;     // heat 1: red (the Pi 5 starts throttling near 85 °C)
export const FAN_MAX_RPM = 8000;  // the official Active Cooler tops out around here
export const CORES = 4;

// Where each channel rests when its reading is missing.
export const NEUTRAL = Object.freeze({
    heat: 0.25, load: 0.15, fan: 0, wifi: 0.6, mem: 0.3, throttle: 0,
    cores: Object.freeze([0.15, 0.15, 0.15, 0.15]),
});

export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

// reading -> target channels, every value 0..1 or null (null = use NEUTRAL).
export function normalize(r) {
    r = r || {};
    const t = num(r.temp_c), rpm = num(r.fan_rpm);
    const cores = Array.isArray(r.cores) ? r.cores : [];
    const th = r.throttled && Array.isArray(r.throttled.flags) ? r.throttled.flags : null;
    return {
        heat: t === null ? null : clamp01((t - TEMP_COOL_C) / (TEMP_HOT_C - TEMP_COOL_C)),
        load: num(r.load) === null ? null : clamp01(r.load),
        fan: rpm === null ? null : clamp01(rpm / FAN_MAX_RPM),
        wifi: num(r.wifi) === null ? null : clamp01(r.wifi),
        mem: num(r.mem) === null ? null : clamp01(r.mem),
        // Only what is happening now counts; the "*_occurred" bits are history.
        throttle: th === null ? null
            : th.some((f) => f === 'throttled' || f === 'under_voltage' || f === 'freq_capped') ? 1 : 0,
        cores: Array.from({ length: CORES }, (_, i) => (num(cores[i]) === null ? null : clamp01(cores[i]))),
    };
}

// Fraction of the way to the target after dt seconds with time constant tau (frame-rate independent).
export const smoothFactor = (dt, tau) => (tau <= 0 ? 1 : 1 - Math.exp(-Math.max(0, dt) / tau));

// Eases every channel toward its target, so a 4 Hz stream still moves smoothly at 60 fps.
export class Smoother {
    constructor(tau = 0.5) {
        this.tau = tau;
        this.value = { ...NEUTRAL, cores: [...NEUTRAL.cores] };
    }

    step(target, dt) {
        const k = smoothFactor(dt, this.tau);
        const v = this.value;
        for (const key of ['heat', 'load', 'fan', 'wifi', 'mem', 'throttle']) {
            const goal = target[key] === null || target[key] === undefined ? NEUTRAL[key] : target[key];
            // Throttling snaps on (it is an alarm) and eases off.
            v[key] = key === 'throttle' && goal > v[key] ? goal : v[key] + (goal - v[key]) * k;
        }
        for (let i = 0; i < CORES; i++) {
            const c = target.cores ? target.cores[i] : null;
            const goal = c === null || c === undefined ? NEUTRAL.cores[i] : c;
            v.cores[i] += (goal - v.cores[i]) * k;
        }
        return v;
    }
}

// heat 0..1 -> [r, g, b] in sRGB 0..1: cyan -> amber -> red.
const STOPS = [
    [0.0, [0.25, 0.85, 1.0]],
    [0.5, [1.0, 0.66, 0.22]],
    [1.0, [1.0, 0.16, 0.1]],
];
export function heatColor(heat) {
    const h = clamp01(heat);
    for (let i = 1; i < STOPS.length; i++) {
        const [p1, c1] = STOPS[i];
        if (h <= p1) {
            const [p0, c0] = STOPS[i - 1];
            const f = (h - p0) / (p1 - p0);
            return c0.map((x, j) => x + (c1[j] - x) * f);
        }
    }
    return [...STOPS[STOPS.length - 1][1]];
}

// Ring spin in radians per second: a slow idle drift even when the fan is stopped.
export const ringSpeed = (fan) => 0.15 + clamp01(fan) * 4.0;

// Breathing: facets drift out further and faster as the load rises.
export const breathAmplitude = (load) => 0.04 + clamp01(load) * 0.32;
export const breathRate = (load) => 0.6 + clamp01(load) * 2.6;

// Safe "host[:port]" from ?pi=, or the default. Anything else (a scheme, a path, a user) is refused.
export const DEFAULT_PI = 'raspberrypi.local:8765';
export function piEventsUrl(param) {
    const p = (param || '').trim();
    const ok = /^[A-Za-z0-9.-]{1,253}(:\d{1,5})?$/.test(p) && !p.startsWith('.') && !p.startsWith('-');
    return `http://${ok ? p : DEFAULT_PI}/events`;
}

// A plausible Pi, as a pure function of time in seconds. Every 45 s a 12 s "stress burst"
// pushes the load to the top, so mock mode shows the whole range: heat, fan, throttle.
export function mockReading(t) {
    const cycle = t % 45;
    const burst = cycle > 30 && cycle < 42 ? Math.sin(((cycle - 30) / 12) * Math.PI) : 0;
    const base = 0.18 + 0.1 * Math.sin(t / 6.3) + 0.05 * Math.sin(t / 1.7);
    const load = clamp01(base + 0.8 * burst);
    const cores = Array.from({ length: CORES }, (_, i) =>
        clamp01(load + 0.15 * Math.sin(t * (0.9 + i * 0.37) + i * 1.9)));
    // Temperature lags the load: use the burst shifted a few seconds later.
    const lagCycle = (t - 4) % 45;
    const heatBurst = lagCycle > 30 && lagCycle < 45 ? Math.sin(((lagCycle - 30) / 15) * Math.PI) : 0;
    const temp = 47 + 6 * base + 34 * heatBurst;
    const fan = temp < 50 ? 0 : Math.min(FAN_MAX_RPM, (temp - 50) * 220);
    return {
        t,
        temp_c: Math.round(temp * 10) / 10,
        load,
        cores,
        mem: 0.34 + 0.04 * Math.sin(t / 11),
        fan_rpm: Math.round(fan),
        wifi: clamp01(0.74 + 0.12 * Math.sin(t / 4.1)),
        throttled: { raw: temp > 82 ? 4 : 0, flags: temp > 82 ? ['throttled'] : [] },
    };
}
