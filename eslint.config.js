// ESLint for the app's classic browser scripts and the inline <script>s in the
// HTML pages. Deliberately limited to rules that catch real breakage (typo'd
// names, unreachable code, duplicate keys), not style. Duplicate let/const
// are parse errors, so no-redeclare (which only adds harmless var cases) is off.
//
// The pages share one global scope across files, so every top-level name any
// app script declares is treated as a known global. scripts/check-pages.js
// separately checks the per-page load order and collisions.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as espree from 'espree';
import globals from 'globals';
import html from 'eslint-plugin-html';
import { builtinRules } from 'eslint/use-at-your-own-risk';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const APP_FILES = readdirSync(ROOT).filter((f) => /\.(js|html)$/.test(f) && !/^(eslint|vitest|playwright)\.config\.js$/.test(f));

function appGlobals() {
    const names = {};
    for (const file of APP_FILES) {
        const text = readFileSync(path.join(ROOT, file), 'utf8');
        const chunks = file.endsWith('.html')
            ? [...text.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1])
            : [text];
        for (const code of chunks) {
            for (const m of code.matchAll(/\b(?:window|root)\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)) names[m[1]] = 'writable';
            let ast;
            try { ast = espree.parse(code, { ecmaVersion: 'latest', sourceType: 'script' }); } catch { continue; } // reported by the lint itself
            for (const node of ast.body) {
                if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') names[node.id.name] = 'writable';
                if (node.type === 'VariableDeclaration') for (const d of node.declarations) if (d.id.type === 'Identifier') names[d.id.name] = 'writable';
            }
        }
    }
    return names;
}

const breakageRules = {
    'no-undef': 'error',
    'no-dupe-keys': 'error',
    'no-dupe-args': 'error',
    'no-dupe-class-members': 'error',
    'no-dupe-else-if': 'error',
    'no-duplicate-case': 'error',
    'no-unreachable': 'warn',
    'no-const-assign': 'error',
    'no-func-assign': 'error',
    'no-import-assign': 'error',
    'no-self-assign': 'error',
    'no-unsafe-finally': 'error',
    'no-unsafe-negation': 'error',
    'use-isnan': 'error',
    'valid-typeof': 'error',
    'getter-return': 'error',
    'no-setter-return': 'error',
};

// Warnings only (reported, never fail CI) for the app's own code.
const appWarnings = {
    // `.catch(() => {})` hides failed database writes (e.g. stock updates).
    'no-restricted-syntax': ['warn', {
        selector: "CallExpression[callee.property.name='catch'] > :matches(FunctionExpression, ArrowFunctionExpression)[body.type='BlockStatement'][body.body.length=0]",
        message: 'Promise error silently ignored. Log it or tell the user, unless failure really is harmless.',
    }],
    // Local leftovers only: top-level functions are often called from onclick=
    // attributes the rule can't see. `exports` is the bundled QR library's.
    'no-unused-vars': ['warn', { vars: 'local', args: 'none', caughtErrors: 'none', varsIgnorePattern: '^exports$' }],
};

// The oldest staff device is an iPad on iOS 12 (Safari 12), so app code must
// stay within ES2018 syntax (ecmaVersion below) and avoid these newer built-ins.
// A miss here doesn't fail one feature: a syntax error stops the whole script.
const oldSafari = (what, since) => `${what} needs ${since}; the shop's iOS 12 iPad doesn't have it.`;
// A second copy of no-restricted-syntax, so these can be errors while the
// silent-catch check above stays a warning (one severity per rule name).
const ios12 = { rules: { 'no-restricted-syntax': builtinRules.get('no-restricted-syntax') } };
const ios12Rules = {
    'ios12/no-restricted-syntax': ['error',
        ...['replaceAll', 'matchAll', 'at', 'findLast', 'findLastIndex'].map((m) => ({
            selector: `CallExpression[callee.property.name='${m}']`, message: oldSafari(`.${m}()`, 'iOS 13+'),
        })),
        { selector: "CallExpression[callee.object.name='Object'][callee.property.name=/^(fromEntries|hasOwn)$/]", message: oldSafari('Object.fromEntries / Object.hasOwn', 'iOS 12.2+ / 15.4+') },
        { selector: "CallExpression[callee.object.name='Promise'][callee.property.name=/^(allSettled|any)$/]", message: oldSafari('Promise.allSettled / Promise.any', 'iOS 13+ / 14+') },
        { selector: 'Literal[regex.pattern=/\\(\\?<[=!]/]', message: oldSafari('Regex lookbehind (?<= / (?<!', 'iOS 16.4+') },
    ],
    'no-restricted-globals': ['error',
        { name: 'structuredClone', message: oldSafari('structuredClone', 'iOS 15.4+') },
        { name: 'globalThis', message: oldSafari('globalThis', 'iOS 12.2+') },
    ],
};

export default [
    {
        ignores: ['node_modules/**', 'coverage/**', 'playwright-report/**', 'test-results/**', 'i18n-dict.js'],
    },
    {
        files: ['*.js', '*.html'],
        ignores: ['*.config.js'],
        plugins: { html, ios12 },
        languageOptions: {
            ecmaVersion: 2018, // iOS 12 floor; see ios12Rules
            sourceType: 'script',
            globals: {
                ...globals.browser,
                firebase: 'readonly', // Firebase v8 SDK from gstatic
                L: 'readonly', // Leaflet, loaded at runtime by order.html
                module: 'readonly', // UMD export check in augustx-menu.js
                onReceiptSettings: 'readonly', // optional hook called by shared.js:610; no page defines it today
                ...appGlobals(),
            },
        },
        rules: { ...breakageRules, ...appWarnings, ...ios12Rules },
    },
    {
        files: ['*.config.js', 'scripts/**/*.js', 'tests/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: { ...globals.node },
        },
        rules: breakageRules,
    },
    {
        // Playwright specs pass callbacks that run in the page.
        files: ['tests/e2e/**/*.js'],
        languageOptions: { globals: { ...globals.node, ...globals.browser } },
    },
    {
        files: ['tests/e2e/fake-firebase.js'],
        languageOptions: { sourceType: 'script', globals: { ...globals.browser } },
    },
];
