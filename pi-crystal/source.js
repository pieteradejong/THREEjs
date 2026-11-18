// source.js: where readings come from. Live: an EventSource on the Pi's telemetry.py.
// Mock: mockReading() from mapping.js. The page is never empty: without a live sample in the
// last STALE_MS it shows mock data and says so in the badge, while EventSource keeps retrying.
import { mockReading, piEventsUrl } from './mapping.js';

const STALE_MS = 2500;

export class Source {
    // params: URLSearchParams of the page. ?source=mock skips the Pi; ?pi=host:port picks it.
    constructor(params, now = () => performance.now()) {
        this.now = now;
        this.mockOnly = params.get('source') === 'mock';
        this.url = piEventsUrl(params.get('pi'));
        // ?at=SECONDS shifts mock time (e.g. ?source=mock&at=36 opens on the stress burst).
        const at = Number(params.get('at'));
        this.mockOffset = Number.isFinite(at) ? at : 0;
        this.live = null;       // last live reading
        this.liveAt = -Infinity;
        this.everLive = false;
        this.es = null;
        if (!this.mockOnly && typeof EventSource !== 'undefined') this.open();
    }

    open() {
        this.es = new EventSource(this.url);
        this.es.onmessage = (ev) => {
            try {
                this.live = JSON.parse(ev.data);
                this.liveAt = this.now();
                this.everLive = true;
            } catch (_) {
                // A malformed event is dropped; the next one replaces it.
            }
        };
        // onerror: EventSource reconnects on its own (the server sends retry: 2000).
    }

    // { reading, state } where state is 'live' | 'mock' | 'offline' | 'reconnecting'.
    read(tSeconds) {
        if (this.mockOnly) return { reading: mockReading(tSeconds + this.mockOffset), state: 'mock' };
        if (this.now() - this.liveAt < STALE_MS) return { reading: this.live, state: 'live' };
        return { reading: mockReading(tSeconds + this.mockOffset), state: this.everLive ? 'reconnecting' : 'offline' };
    }
}
