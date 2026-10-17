// Proves scripts/check-pages.js catches the breakages it exists for, using
// small throwaway sites in a temp directory.
import { describe, test, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = path.resolve(import.meta.dirname, '../scripts/check-pages.js');
let dir;
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

function site(files, ...flags) {
    dir = mkdtempSync(path.join(tmpdir(), 'check-pages-'));
    for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, name), text);
    const r = spawnSync(process.execPath, [SCRIPT, '--root', dir, ...flags], { encoding: 'utf8' });
    return { code: r.status, out: r.stdout + r.stderr };
}
const page = (body) => `<!doctype html><html><head></head><body>${body}</body></html>`;

describe('check-pages', () => {
    test('passes on a healthy page', () => {
        const r = site({
            'a.js': 'const shared = 1;\nfunction helper() {}\n',
            'index.html': page('<script src="a.js"></script><script>function go() { helper(); }</script><button onclick="go()">x</button>'),
        });
        expect(r.out).toContain('0 error(s)');
        expect(r.code).toBe(0);
    });

    test('missing script file', () => {
        const r = site({ 'index.html': page('<script src="shared.js"></script>') });
        expect(r.out).toMatch(/index\.html:1: script "shared\.js" not found/);
        expect(r.code).toBe(1);
    });

    test('syntax error in an external script reports the file and line', () => {
        const r = site({ 'a.js': 'ok();\nfunction (\n', 'index.html': page('<script src="a.js"></script>') });
        expect(r.out).toMatch(/a\.js:2: syntax error/);
        expect(r.code).toBe(1);
    });

    test('syntax error in an inline script reports the HTML line', () => {
        const r = site({ 'index.html': '<html>\n<body>\n<script>\nlet a = ;\n</script>\n</body></html>' });
        expect(r.out).toMatch(/index\.html:4: syntax error/);
    });

    test('top-level const declared in two scripts on one page', () => {
        const r = site({ 'a.js': 'const money = 1;', 'b.js': 'function money() {}', 'index.html': page('<script src="a.js"></script><script src="b.js"></script>') });
        expect(r.out).toMatch(/b\.js:1: "money" is already declared at a\.js:1/);
        expect(r.code).toBe(1);
    });

    test('duplicate function across scripts is a warning (error with --strict)', () => {
        const files = { 'a.js': 'function esc() {}', 'index.html': page('<script src="a.js"></script><script>function esc() {}</script>') };
        const r = site(files);
        expect(r.out).toMatch(/warning .*"esc" redefines a\.js:1/);
        expect(r.code).toBe(0);
        expect(site(files, '--strict').code).toBe(1);
    });

    test('handler calling an undefined function', () => {
        const r = site({ 'index.html': page('<script>function save() {}</script><button onclick="savee()">x</button>') });
        expect(r.out).toMatch(/handler calls "savee\(\)"/);
        expect(r.code).toBe(1);
    });

    test('handlers may call browser globals and window.X assignments', () => {
        const r = site({
            'index.html': page('<script>window.openThing = function () {};</script><button onclick="openThing(); alert(1)">x</button><a onclick="if (x) y()">z</a>'),
        });
        expect(r.code).toBe(0);
    });

    test('missing manifest icon', () => {
        const r = site({
            'app.webmanifest': JSON.stringify({ start_url: 'index.html', icons: [{ src: 'icon.png' }] }),
            'index.html': '<html><head><link rel="manifest" href="app.webmanifest"></head></html>',
        });
        expect(r.out).toMatch(/app\.webmanifest: icon "icon\.png" not found/);
    });
});
