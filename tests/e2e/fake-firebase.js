// In-browser stand-in for the Firebase v8 SDK (app + database + auth), served
// by the Playwright tests in place of the gstatic scripts. Covers only the API
// surface this app uses. Configure before page scripts run via:
//   window.__FAKE_DB   initial database contents (plain JSON tree)
//   window.__FAKE_USER signed-in user ({ uid, email }) or null
// Every write is recorded in window.__FAKE_WRITES for assertions.
(function () {
    'use strict';
    if (window.firebase && window.firebase.__fake) return;

    var data = JSON.parse(JSON.stringify(window.__FAKE_DB || {}));
    var listeners = []; // { path, query, cb, last }
    var writes = (window.__FAKE_WRITES = []);
    var pushCounter = 0;

    function parts(path) { return String(path || '').split('/').filter(Boolean); }
    function join(a, b) { return parts(a).concat(parts(b)).join('/'); }
    function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
    function getAt(path) {
        if (path === '.info/connected') return true;
        var node = data;
        var p = parts(path);
        for (var i = 0; i < p.length; i++) {
            if (node == null || typeof node !== 'object') return null;
            node = node[p[i]];
        }
        return node === undefined ? null : node;
    }
    function resolveServerValues(v) {
        if (v && typeof v === 'object') {
            if (v['.sv'] === 'timestamp') return Date.now();
            Object.keys(v).forEach(function (k) { v[k] = resolveServerValues(v[k]); });
        }
        return v;
    }
    function prune(v) {
        if (v && typeof v === 'object') {
            Object.keys(v).forEach(function (k) { v[k] = prune(v[k]); if (v[k] == null) delete v[k]; });
            if (!Object.keys(v).length) return null;
        }
        return v;
    }
    function setAt(path, value) {
        value = resolveServerValues(clone(value));
        var p = parts(path);
        if (!p.length) { data = value || {}; return; }
        var node = data;
        for (var i = 0; i < p.length - 1; i++) {
            if (node[p[i]] == null || typeof node[p[i]] !== 'object') node[p[i]] = {};
            node = node[p[i]];
        }
        if (value == null) delete node[p[p.length - 1]]; else node[p[p.length - 1]] = value;
        data = prune(data) || {};
    }
    function applyQuery(v, q) {
        if (!q || !v || typeof v !== 'object') return v;
        var keys = Object.keys(v);
        if (q.orderBy) {
            var by = function (k) { return q.orderBy === '$key' ? k : (v[k] && typeof v[k] === 'object' ? v[k][q.orderBy] : undefined); };
            keys = keys.filter(function (k) {
                var x = by(k);
                if (q.equalTo !== undefined && x !== q.equalTo) return false;
                if (q.startAt !== undefined && !(x >= q.startAt)) return false;
                if (q.endAt !== undefined && !(x <= q.endAt)) return false;
                return true;
            }).sort(function (a, b) { var x = by(a), y = by(b); return x < y ? -1 : x > y ? 1 : 0; });
        }
        if (q.limitToLast) keys = keys.slice(-q.limitToLast);
        if (q.limitToFirst) keys = keys.slice(0, q.limitToFirst);
        if (!keys.length) return null;
        var out = {};
        keys.forEach(function (k) { out[k] = v[k]; });
        return out;
    }

    function snapshot(path, value) {
        var v = value === undefined ? getAt(path) : value;
        var p = parts(path);
        return {
            key: p.length ? p[p.length - 1] : null,
            ref: makeRef(path),
            val: function () { return clone(v); },
            exists: function () { return v != null; },
            child: function (c) { return snapshot(join(path, c), v && typeof v === 'object' ? (getChild(v, c)) : null); },
            hasChild: function (c) { return getChild(v, c) != null; },
            numChildren: function () { return v && typeof v === 'object' ? Object.keys(v).length : 0; },
            forEach: function (cb) {
                if (!v || typeof v !== 'object') return false;
                var ks = Object.keys(v);
                for (var i = 0; i < ks.length; i++) if (cb(snapshot(join(path, ks[i]), v[ks[i]])) === true) return true;
                return false;
            },
        };
    }
    function getChild(v, c) {
        var p = parts(c), node = v;
        for (var i = 0; i < p.length; i++) { if (node == null || typeof node !== 'object') return null; node = node[p[i]]; }
        return node === undefined ? null : node;
    }

    function notify() {
        listeners.slice().forEach(function (l) {
            var v = applyQuery(getAt(l.path), l.query);
            var json = JSON.stringify(v);
            if (json === l.last) return;
            l.last = json;
            try { l.cb(snapshot(l.path, v)); } catch (e) { setTimeout(function () { throw e; }); }
        });
    }
    function later(fn) { return new Promise(function (res) { setTimeout(function () { res(fn()); }, 0); }); }

    function makeRef(path, query) {
        var ref = {
            key: parts(path).length ? parts(path)[parts(path).length - 1] : null,
            path: path,
            child: function (c) { return makeRef(join(path, c)); },
            orderByChild: function (c) { return makeRef(path, Object.assign({}, query, { orderBy: c })); },
            orderByKey: function () { return makeRef(path, Object.assign({}, query, { orderBy: '$key' })); },
            startAt: function (v) { return makeRef(path, Object.assign({}, query, { startAt: v })); },
            endAt: function (v) { return makeRef(path, Object.assign({}, query, { endAt: v })); },
            equalTo: function (v) { return makeRef(path, Object.assign({}, query, { equalTo: v })); },
            limitToLast: function (n) { return makeRef(path, Object.assign({}, query, { limitToLast: n })); },
            limitToFirst: function (n) { return makeRef(path, Object.assign({}, query, { limitToFirst: n })); },
            on: function (event, cb) {
                var l = { path: path, query: query, cb: cb, last: undefined };
                listeners.push(l);
                setTimeout(function () {
                    if (listeners.indexOf(l) < 0) return;
                    var v = applyQuery(getAt(path), query);
                    l.last = JSON.stringify(v);
                    try { cb(snapshot(path, v)); } catch (e) { setTimeout(function () { throw e; }); }
                }, 0);
                return cb;
            },
            off: function (event, cb) {
                listeners = listeners.filter(function (l) { return !(l.path === path && (!cb || l.cb === cb)); });
            },
            once: function () { return later(function () { return snapshot(path, applyQuery(getAt(path), query)); }); },
            set: function (v) { writes.push(['set', path, clone(v)]); setAt(path, v); notify(); return later(function () {}); },
            update: function (obj) {
                writes.push(['update', path, clone(obj)]);
                Object.keys(obj).forEach(function (k) { setAt(join(path, k), obj[k]); });
                notify();
                return later(function () {});
            },
            remove: function () { writes.push(['remove', path]); setAt(path, null); notify(); return later(function () {}); },
            push: function (v) {
                var child = makeRef(join(path, '-fake' + String(++pushCounter).padStart(4, '0')));
                var p = v === undefined ? Promise.resolve() : child.set(v);
                child.then = p.then.bind(p);
                child.catch = p.catch.bind(p);
                return child;
            },
            transaction: function (fn, onComplete) {
                return later(function () {
                    var next = fn(clone(getAt(path)));
                    var committed = next !== undefined;
                    if (committed) { writes.push(['transaction', path, clone(next)]); setAt(path, next); notify(); }
                    var res = { committed: committed, snapshot: snapshot(path) };
                    if (onComplete) onComplete(null, committed, res.snapshot);
                    return res;
                });
            },
        };
        return ref;
    }

    var db = { ref: function (p) { return makeRef(p || ''); } };

    var user = window.__FAKE_USER || null;
    var authListeners = [];
    var auth = {
        get currentUser() { return user; },
        onAuthStateChanged: function (cb) { authListeners.push(cb); setTimeout(function () { cb(user); }, 0); return function () {}; },
        signInWithEmailAndPassword: function (email) {
            return later(function () {
                user = { uid: 'fake-' + email, email: email };
                authListeners.forEach(function (cb) { cb(user); });
                return { user: user };
            });
        },
        signOut: function () { return later(function () { user = null; authListeners.forEach(function (cb) { cb(null); }); }); },
    };

    var database = function () { return db; };
    database.ServerValue = { TIMESTAMP: { '.sv': 'timestamp' } };
    window.firebase = {
        __fake: true,
        apps: [],
        initializeApp: function (cfg) { this.apps.push({ options: cfg }); return this.apps[this.apps.length - 1]; },
        database: database,
        auth: function () { return auth; },
    };
    window.__fakeDb = { get: getAt, set: function (p, v) { setAt(p, v); notify(); } };
})();
