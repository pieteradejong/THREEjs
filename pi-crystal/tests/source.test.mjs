// node --test pi-crystal/tests/: Source switches between live, mock, offline and reconnecting.
// A fake EventSource stands in for the browser's; nothing touches the network.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Source } from '../source.js';
import { DEFAULT_PI, mockReading } from '../mapping.js';

class FakeEventSource {
    static last = null;
    constructor(url) { this.url = url; this.onmessage = null; FakeEventSource.last = this; }
    emit(data) { this.onmessage({ data: typeof data === 'string' ? data : JSON.stringify(data) }); }
}

let saved;
beforeEach(() => { saved = globalThis.EventSource; globalThis.EventSource = FakeEventSource; FakeEventSource.last = null; });
afterEach(() => { globalThis.EventSource = saved; });

const clock = () => { const c = { ms: 0, now: () => c.ms }; return c; };
const params = (q) => new URLSearchParams(q);

test('?source=mock never opens a connection', () => {
    const s = new Source(params('source=mock'), clock().now);
    assert.equal(FakeEventSource.last, null);
    const { reading, state } = s.read(3);
    assert.equal(state, 'mock');
    assert.deepEqual(reading, mockReading(3));
});

test('?at shifts mock time; junk ?at is ignored', () => {
    assert.deepEqual(new Source(params('source=mock&at=36'), clock().now).read(1).reading, mockReading(37));
    assert.deepEqual(new Source(params('source=mock&at=abc'), clock().now).read(1).reading, mockReading(1));
});

test('connects to the default Pi, or to ?pi= when it is a plain host:port', () => {
    new Source(params(''), clock().now);
    assert.equal(FakeEventSource.last.url, `http://${DEFAULT_PI}/events`);
    new Source(params('pi=pi-lab.local:9000'), clock().now);
    assert.equal(FakeEventSource.last.url, 'http://pi-lab.local:9000/events');
    new Source(params('pi=https://evil.example/'), clock().now);
    assert.equal(FakeEventSource.last.url, `http://${DEFAULT_PI}/events`);
});

test('offline -> live -> reconnecting as samples arrive and stop', () => {
    const c = clock();
    const s = new Source(params(''), c.now);
    assert.equal(s.read(0).state, 'offline');
    assert.deepEqual(s.read(5).reading, mockReading(5), 'offline still animates');

    const live = { temp_c: 61.5, load: 0.7 };
    c.ms = 1000;
    FakeEventSource.last.emit(live);
    c.ms = 2000;
    assert.deepEqual(s.read(2), { reading: live, state: 'live' });

    c.ms = 1000 + 2499;
    assert.equal(s.read(3).state, 'live', 'just inside the stale window');
    c.ms = 1000 + 2500;
    const after = s.read(4);
    assert.equal(after.state, 'reconnecting');
    assert.deepEqual(after.reading, mockReading(4));

    c.ms = 9000;
    FakeEventSource.last.emit({ temp_c: 50 });
    assert.equal(s.read(9).state, 'live');
});

test('a malformed event is dropped and does not count as live', () => {
    const c = clock();
    const s = new Source(params(''), c.now);
    FakeEventSource.last.emit('{not json');
    assert.equal(s.read(0).state, 'offline');
    assert.equal(s.live, null);
});

test('no EventSource at all (old browser, node): falls back to mock data quietly', () => {
    globalThis.EventSource = undefined;
    const s = new Source(params(''), clock().now);
    assert.equal(s.es, null);
    assert.equal(s.read(1).state, 'offline');
});
