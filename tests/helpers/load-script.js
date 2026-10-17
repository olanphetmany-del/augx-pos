// Loads the app's classic browser scripts (which declare globals and expect
// Firebase/DOM to exist) into an isolated Node vm context, so tests can call
// their top-level functions without modifying the source files.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

// Minimal stand-in for a Firebase RTDB ref. Records every call in `log` and
// keeps values in `data` (a flat { 'full/path': value } map) so transactions
// can be exercised. Never hits the network.
export function fakeRef(pathStr, log, data) {
    const snap = (v) => ({ val: () => (v === undefined ? null : clone(v)), exists: () => v != null, forEach() {} });
    const ref = {
        path: pathStr,
        key: pathStr.split('/').pop(),
        ref: (p) => fakeRef(pathStr ? pathStr + '/' + p : p, log, data),
        child: (p) => fakeRef(pathStr + '/' + p, log, data),
        on: (...a) => { log.push(['on', pathStr]); return a[1]; },
        once: () => Promise.resolve(snap(data[pathStr])),
        off: () => {},
        set: (v) => { log.push(['set', pathStr, v]); data[pathStr] = clone(v); return Promise.resolve(); },
        update: (v) => { log.push(['update', pathStr, v]); data[pathStr] = { ...(data[pathStr] || {}), ...clone(v) }; return Promise.resolve(); },
        remove: () => { log.push(['remove', pathStr]); delete data[pathStr]; return Promise.resolve(); },
        push: (v) => { log.push(['push', pathStr, v]); const r = fakeRef(pathStr + '/-k', log, data); if (v !== undefined) data[r.path] = clone(v); return r; },
        // Like RTDB: returning undefined aborts; otherwise the result is stored.
        transaction: (fn) => {
            log.push(['transaction', pathStr]);
            const next = fn(data[pathStr] === undefined ? null : clone(data[pathStr]));
            if (next === undefined) return Promise.resolve({ committed: false, snapshot: snap(data[pathStr]) });
            data[pathStr] = clone(next);
            return Promise.resolve({ committed: true, snapshot: snap(next) });
        },
        orderByChild: () => ref, startAt: () => ref, endAt: () => ref, equalTo: () => ref, limitToLast: () => ref,
    };
    return ref;
}

export function makeFirebaseStub(data = {}) {
    const log = [];
    const db = { ref: (p = '') => fakeRef(p, log, data) };
    const firebase = {
        apps: [],
        initializeApp() { this.apps.push({}); },
        database: Object.assign(() => db, { ServerValue: { TIMESTAMP: { '.sv': 'timestamp' } } }),
        auth: () => ({ currentUser: null, onAuthStateChanged() {}, signOut: () => Promise.resolve() }),
    };
    return { firebase, log, data };
}

/**
 * Run the given repo-relative scripts, in order, inside one fresh context.
 * Returns { ctx, get(names), log, data } where get() pulls top-level bindings
 * (including const/let, which vm does not attach to the global object) and
 * `data` is the fake database contents.
 *
 * Timer and Date globals are read when this is called, so call vi.useFakeTimers()
 * / vi.setSystemTime() before loading if a test needs a fixed clock.
 */
export function loadScripts(files, { globals = {}, data = {} } = {}) {
    const { firebase, log } = makeFirebaseStub(data);
    const sandbox = {
        console,
        setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
        setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval,
        Date: globalThis.Date,
        firebase,
        navigator: { userAgent: 'node' },
        ...globals,
    };
    sandbox.window = sandbox;
    sandbox.self = sandbox;
    const ctx = vm.createContext(sandbox);
    for (const f of files) {
        const filename = path.join(ROOT, f);
        vm.runInContext(readFileSync(filename, 'utf8'), ctx, { filename });
    }
    const get = (names) => vm.runInContext('({' + names.join(',') + '})', ctx);
    return { ctx, get, log, data };
}
