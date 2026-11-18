// node --test pi-crystal/tests/: the pure mapping from Pi readings to drive channels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    NEUTRAL, CORES, FAN_MAX_RPM, TEMP_COOL_C, TEMP_HOT_C, DEFAULT_PI,
    clamp01, normalize, smoothFactor, Smoother, heatColor, ringSpeed, breathAmplitude,
    breathRate, piEventsUrl, mockReading,
} from '../mapping.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('clamp01', () => {
    assert.deepEqual([-1, 0, 0.3, 1, 7].map(clamp01), [0, 0, 0.3, 1, 1]);
});

test('normalize: a full reading', () => {
    const n = normalize({
        temp_c: (TEMP_COOL_C + TEMP_HOT_C) / 2, load: 0.4, cores: [0, 0.5, 1, 2],
        mem: 0.3, fan_rpm: FAN_MAX_RPM / 4, wifi: 0.9, throttled: { raw: 0, flags: [] },
    });
    close(n.heat, 0.5);
    assert.equal(n.load, 0.4);
    assert.deepEqual(n.cores, [0, 0.5, 1, 1]);
    close(n.fan, 0.25);
    assert.equal(n.wifi, 0.9);
    assert.equal(n.mem, 0.3);
    assert.equal(n.throttle, 0);
});

test('normalize: temperature is clamped at both ends', () => {
    assert.equal(normalize({ temp_c: 10 }).heat, 0);
    assert.equal(normalize({ temp_c: 120 }).heat, 1);
});

test('normalize: missing, null and junk fields become null', () => {
    for (const r of [undefined, null, {}, { temp_c: null, load: 'x', fan_rpm: NaN, wifi: Infinity, cores: 'no' }]) {
        const n = normalize(r);
        for (const k of ['heat', 'load', 'fan', 'wifi', 'mem', 'throttle']) assert.equal(n[k], null, `${k} of ${JSON.stringify(r)}`);
        assert.equal(n.cores.length, CORES);
        assert.ok(n.cores.every((c) => c === null));
    }
});

test('normalize: only current throttle flags count, not history', () => {
    assert.equal(normalize({ throttled: { raw: 0x50000, flags: ['under_voltage_occurred', 'throttled_occurred'] } }).throttle, 0);
    for (const f of ['throttled', 'under_voltage', 'freq_capped']) {
        assert.equal(normalize({ throttled: { flags: [f] } }).throttle, 1, f);
    }
    assert.equal(normalize({ throttled: { flags: ['soft_temp_limit'] } }).throttle, 0);
});

test('normalize: fewer cores than 4 pads with null, more are cut', () => {
    assert.deepEqual(normalize({ cores: [0.5] }).cores, [0.5, null, null, null]);
    assert.equal(normalize({ cores: [1, 1, 1, 1, 1, 1] }).cores.length, CORES);
});

test('smoothFactor is frame-rate independent', () => {
    close(smoothFactor(0.5, 0.5), 1 - Math.exp(-1));
    // Two half steps land where one full step does.
    const k1 = smoothFactor(0.2, 0.5), k2 = smoothFactor(0.1, 0.5);
    close(1 - (1 - k2) * (1 - k2), k1);
    assert.equal(smoothFactor(0.1, 0), 1);
    assert.equal(smoothFactor(-1, 0.5), 0);
});

test('Smoother: starts neutral, converges to the target, holds neutral for null', () => {
    const s = new Smoother(0.5);
    assert.deepEqual(s.value.cores, [...NEUTRAL.cores]);
    assert.equal(s.value.heat, NEUTRAL.heat);
    const target = normalize({ temp_c: TEMP_HOT_C, load: 1, cores: [1, 1, 1, 1], wifi: 1, mem: 1, fan_rpm: FAN_MAX_RPM });
    const v1 = s.step(target, 0.1).heat;
    assert.ok(v1 > NEUTRAL.heat && v1 < 1, 'moves part of the way');
    for (let i = 0; i < 100; i++) s.step(target, 0.1);
    close(s.value.heat, 1, 1e-6);
    close(s.value.cores[3], 1, 1e-6);
    for (let i = 0; i < 100; i++) s.step(normalize({}), 0.1);
    close(s.value.load, NEUTRAL.load, 1e-6);
    // NEUTRAL itself is never mutated by the smoother.
    assert.equal(NEUTRAL.cores[0], 0.15);
});

test('Smoother: throttle snaps on and eases off', () => {
    const s = new Smoother(0.5);
    assert.equal(s.step({ ...normalize({}), throttle: 1 }, 0.016).throttle, 1);
    const off = s.step({ ...normalize({}), throttle: 0 }, 0.016).throttle;
    assert.ok(off > 0.9 && off < 1);
});

test('heatColor: cyan when cool, amber in the middle, red when hot, clamped', () => {
    const rgb = (h, want) => heatColor(h).forEach((c, i) => close(c, want[i], 1e-12));
    rgb(0, [0.25, 0.85, 1.0]);
    rgb(0.5, [1.0, 0.66, 0.22]);
    rgb(1, [1.0, 0.16, 0.1]);
    assert.deepEqual(heatColor(-3), heatColor(0));
    assert.deepEqual(heatColor(9), heatColor(1));
    const q = heatColor(0.25);
    close(q[0], 0.625);
    for (let h = 0; h <= 1; h += 0.05) assert.ok(heatColor(h).every((c) => c >= 0 && c <= 1));
});

test('drive curves rise with their input and have a floor', () => {
    assert.ok(ringSpeed(0) > 0, 'rings drift even with the fan off');
    assert.ok(ringSpeed(1) > ringSpeed(0.5) && ringSpeed(0.5) > ringSpeed(0));
    assert.equal(ringSpeed(5), ringSpeed(1));
    assert.ok(breathAmplitude(1) > breathAmplitude(0) && breathAmplitude(0) > 0);
    assert.ok(breathRate(1) > breathRate(0) && breathRate(0) > 0);
});

test('piEventsUrl: default, valid hosts, and refusal of anything else', () => {
    assert.equal(piEventsUrl(null), `http://${DEFAULT_PI}/events`);
    assert.equal(piEventsUrl(''), `http://${DEFAULT_PI}/events`);
    assert.equal(piEventsUrl('pi-lab.local:9000'), 'http://pi-lab.local:9000/events');
    assert.equal(piEventsUrl(' raspberrypi.local '), 'http://raspberrypi.local/events');
    for (const bad of ['http://evil.example', 'evil.example/x', 'user@host', 'host:port', '.local',
        '-x', 'a b', 'host:123456', 'javascript:alert(1)', '//evil']) {
        assert.equal(piEventsUrl(bad), `http://${DEFAULT_PI}/events`, bad);
    }
});

test('mockReading: shape, ranges, and a stress burst that reaches every extreme', () => {
    let maxTemp = 0, maxLoad = 0, maxFan = 0, sawThrottle = false, minTemp = 99;
    for (let t = 0; t < 90; t += 0.25) {
        const r = mockReading(t);
        const n = normalize(r);
        for (const k of ['heat', 'load', 'fan', 'wifi', 'mem', 'throttle']) {
            assert.ok(n[k] !== null && n[k] >= 0 && n[k] <= 1, `${k} at t=${t}`);
        }
        assert.equal(r.cores.length, CORES);
        maxTemp = Math.max(maxTemp, r.temp_c);
        minTemp = Math.min(minTemp, r.temp_c);
        maxLoad = Math.max(maxLoad, r.load);
        maxFan = Math.max(maxFan, r.fan_rpm);
        sawThrottle ||= r.throttled.flags.includes('throttled');
    }
    assert.ok(minTemp < 50 && maxTemp > 80, `temp range ${minTemp}..${maxTemp}`);
    assert.ok(maxLoad > 0.9, `max load ${maxLoad}`);
    assert.ok(maxFan > FAN_MAX_RPM * 0.6, `max fan ${maxFan}`);
    assert.ok(sawThrottle, 'the burst throttles');
    assert.deepEqual(mockReading(12.5), mockReading(12.5), 'deterministic');
    assert.doesNotThrow(() => JSON.stringify(mockReading(1)));
});
