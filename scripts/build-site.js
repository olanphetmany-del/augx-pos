#!/usr/bin/env node
// Builds public/ for Firebase Hosting: copies ONLY the site files listed below.
//
// The site files sit in the repo root next to tests, configs and notes, and
// Hosting publishes everything it's given. An allowlist means a new non-site
// file can never be published by accident. To keep the list honest, the build
// fails when:
//   - a root file looks like it could be part of the site (.html .js .css .png
//     .jpg .svg .webmanifest .json) but isn't listed as SITE or NOT_SITE
//   - a listed page or manifest refers to a local file that isn't in SITE
//
// Adding a file to the site? Add it to SITE below.
//
// Usage: node scripts/build-site.js [--root <dir>] [--out <dir>]
//   defaults: repo root → <root>/public (--root/--out are used by tests)
import { readFileSync, readdirSync, statSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SITE = [
    // pages
    'index.html', 'order.html', 'cashier.html', 'kitchen.html', 'shop.html', 'admin.html',
    // scripts and styles
    'shared.js', 'augustx-menu.js', 'i18n.js', 'i18n-dict.js', 'old-ios.js', 'online-cashier.js', 'preorder.js', 'theme7.js', 'theme7.css',
    // installable apps
    'order.webmanifest', 'cashier.webmanifest', 'kitchen.webmanifest', 'shop.webmanifest', 'admin.webmanifest',
    'icon-order-192.png', 'icon-order-512.png', 'icon-cashier-192.png', 'icon-cashier-512.png', 'icon-kitchen-192.png', 'icon-kitchen-512.png',
    'icon-shop-192.png', 'icon-shop-512.png', 'icon-admin-192.png', 'icon-admin-512.png', 'apple-touch-icon.png',
    // link preview card
    'og-image.png',
];

// Root files that look like site files but must never be published.
export const NOT_SITE = [
    'eslint.config.js', 'vitest.config.js', 'vitest.rules.config.js', 'playwright.config.js',
    'package.json', 'package-lock.json', 'firebase.json',
    'database.rules.json', 'database.rules.live.json',
];

const LOOKS_LIKE_SITE = /\.(html|js|css|png|jpe?g|svg|webmanifest|json)$/i;

// Local files a page or manifest refers to (src/href attributes, manifest icons).
function localRefs(file, text) {
    const refs = [];
    if (file.endsWith('.webmanifest')) {
        for (const icon of JSON.parse(text).icons || []) refs.push(icon.src);
    } else {
        // (?<![\w-]): a real src/href attribute, not data-src="…"
        for (const m of text.matchAll(/(?<![\w-])(?:src|href)\s*=\s*["']([^"']+)["']/gi)) refs.push(m[1]);
    }
    return refs
        .filter((r) => !/^(?:[a-z]+:|\/\/|#|\$\{)/i.test(r)) // external, data:, anchors, template strings
        .map((r) => r.replace(/[?#].*$/, '').replace(/^\.?\//, ''))
        .filter(Boolean);
}

export function buildSite(root, out) {
    const problems = [];
    const rootFiles = readdirSync(root).filter((f) => statSync(path.join(root, f)).isFile());
    for (const f of rootFiles) {
        if (LOOKS_LIKE_SITE.test(f) && !SITE.includes(f) && !NOT_SITE.includes(f)) {
            problems.push(`${f}: not in SITE or NOT_SITE in scripts/build-site.js (add it to SITE to publish it)`);
        }
    }
    for (const f of SITE) {
        if (!rootFiles.includes(f)) { problems.push(`${f}: listed in SITE but missing`); continue; }
        if (!/\.(html|webmanifest)$/.test(f)) continue;
        for (const ref of localRefs(f, readFileSync(path.join(root, f), 'utf8'))) {
            if (!SITE.includes(ref)) problems.push(`${f}: refers to "${ref}", which isn't published (add it to SITE)`);
        }
    }
    if (problems.length) return { ok: false, problems };

    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    for (const f of SITE) copyFileSync(path.join(root, f), path.join(out, f));
    return { ok: true, files: SITE.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? path.resolve(process.argv[i + 1]) : null; };
    const root = arg('--root') || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const out = arg('--out') || path.join(root, 'public');
    const r = buildSite(root, out);
    if (!r.ok) {
        console.error('Site build failed:\n  ' + r.problems.join('\n  '));
        process.exit(1);
    }
    console.log(`Built ${path.relative(process.cwd(), out) || out}: ${r.files} files.`);
}
