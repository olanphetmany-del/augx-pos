// scripts/build-site.js decides what goes public on Firebase Hosting. These
// tests build the real repo into a temp folder, then break copies of it.
import { describe, test, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildSite, SITE } from '../scripts/build-site.js';

const REPO = path.resolve(import.meta.dirname, '..');
const dirs = [];
const temp = () => { const d = mkdtempSync(path.join(tmpdir(), 'build-site-')); dirs.push(d); return d; };
afterEach(() => { while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true }); });

// A copy of just the site files, to break in different ways.
function siteCopy() {
    const root = temp();
    for (const f of SITE) copyFileSync(path.join(REPO, f), path.join(root, f));
    return root;
}

describe('build-site', () => {
    test('the real repo builds, and only the site files are published', () => {
        const out = temp();
        const r = buildSite(REPO, out);
        expect(r.problems).toBeUndefined();
        expect(readdirSync(out).sort()).toEqual([...SITE].sort());
        for (const secret of ['package.json', 'AGENTS.md', 'firebase.json', 'database.rules.json', 'tests', 'docs', 'scripts']) {
            expect(readdirSync(out)).not.toContain(secret);
        }
    });

    test('an unlisted root file that looks like a site file fails the build', () => {
        const root = siteCopy();
        writeFileSync(path.join(root, 'notes.js'), '// scratch');
        const r = buildSite(root, temp());
        expect(r.ok).toBe(false);
        expect(r.problems.join('\n')).toMatch(/notes\.js: not in SITE or NOT_SITE/);
    });

    test('a page that loads a file which is not published fails the build', () => {
        const root = siteCopy();
        writeFileSync(path.join(root, 'kitchen.html'), readFileSync(path.join(root, 'kitchen.html'), 'utf8')
            .replace('</body>', '<script src="new-feature.js"></script></body>'));
        const r = buildSite(root, temp());
        expect(r.problems.join('\n')).toMatch(/kitchen\.html: refers to "new-feature\.js"/);
    });

    test('a manifest icon that is not published fails the build', () => {
        const root = siteCopy();
        const m = JSON.parse(readFileSync(path.join(root, 'order.webmanifest'), 'utf8'));
        m.icons.push({ src: 'icon-order-1024.png', sizes: '1024x1024', type: 'image/png' });
        writeFileSync(path.join(root, 'order.webmanifest'), JSON.stringify(m));
        expect(buildSite(root, temp()).problems.join('\n')).toMatch(/order\.webmanifest: refers to "icon-order-1024\.png"/);
    });

    test('a listed file that is missing fails the build', () => {
        const root = siteCopy();
        rmSync(path.join(root, 'theme7.css'));
        expect(buildSite(root, temp()).problems.join('\n')).toMatch(/theme7\.css: listed in SITE but missing/);
    });

    test('data-src and external links are not treated as local files', () => {
        const root = siteCopy();
        writeFileSync(path.join(root, 'shop.html'), readFileSync(path.join(root, 'shop.html'), 'utf8')
            .replace('</body>', '<b data-src="store"></b><a href="https://wa.me/1">x</a><a href="#top">y</a></body>'));
        expect(buildSite(root, temp()).ok).toBe(true);
    });
});
