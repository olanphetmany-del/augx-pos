#!/usr/bin/env node
// Page integrity check for this no-build site.
//
// Every page loads several classic <script>s that share one global scope, so a
// bad upload can break a page in ways no single file shows. For each *.html
// page this checks, in load order:
//   - local files referenced by <script src>, <link href> and manifests exist
//   - every script (external and inline) parses
//   - no top-level let/const/class collides with another script's top-level
//     name (the browser throws SyntaxError and the later script never runs)
//   - functions defined twice across scripts (later one silently wins) [warning]
//   - inline handlers like onclick="foo()" call a function the page defines
//
// Usage: node scripts/check-pages.js [--strict] [--root <dir>]
//   --strict fails on warnings; --root checks another directory (used by tests)
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as espree from 'espree';
import globals from 'globals';

const argRoot = process.argv.indexOf('--root');
const ROOT = argRoot > 0 ? path.resolve(process.argv[argRoot + 1]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const strict = process.argv.includes('--strict');
const BROWSER = new Set([...Object.keys(globals.browser), ...Object.keys(globals.builtin), 'event', 'this']);
const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'return', 'typeof', 'void', 'new', 'delete', 'await', 'function']);

const errors = [];
const warnings = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);
const warn = (where, msg) => warnings.push(`${where}: ${msg}`);

const isLocal = (url) => url && !/^(https?:)?\/\//.test(url) && !/^(data|mailto|tel|javascript|#)/.test(url);
const lineAt = (text, index) => text.slice(0, index).split('\n').length;

// Returns [{ file, line, code }] for each script on the page, in load order.
function pageScripts(page, html) {
    const out = [];
    const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(html))) {
        const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(m[1]);
        if (src) {
            if (!isLocal(src[1])) continue;
            const file = src[1].split(/[?#]/)[0];
            const full = path.join(ROOT, file);
            if (!existsSync(full)) { err(`${page}:${lineAt(html, m.index)}`, `script "${file}" not found`); continue; }
            out.push({ file, line: 1, code: readFileSync(full, 'utf8') });
        } else if (!/\btype\s*=\s*["'](?!text\/javascript|module)/i.test(m[1])) {
            const codeStart = m.index + m[0].indexOf('>') + 1;
            out.push({ file: page, line: lineAt(html, codeStart), code: m[2] });
        }
    }
    return out;
}

function checkLinks(page, html) {
    const re = /<link\b([^>]*)>/gi;
    let m;
    while ((m = re.exec(html))) {
        const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(m[1]);
        if (!href || !isLocal(href[1])) continue;
        const file = href[1].split(/[?#]/)[0];
        const where = `${page}:${lineAt(html, m.index)}`;
        if (!existsSync(path.join(ROOT, file))) { err(where, `linked file "${file}" not found`); continue; }
        if (/\brel\s*=\s*["']manifest["']/i.test(m[1])) checkManifest(file);
    }
}

const checkedManifests = new Set();
function checkManifest(file) {
    if (checkedManifests.has(file)) return;
    checkedManifests.add(file);
    let json;
    try { json = JSON.parse(readFileSync(path.join(ROOT, file), 'utf8')); } catch (e) { err(file, `invalid JSON: ${e.message}`); return; }
    for (const icon of json.icons || []) {
        if (isLocal(icon.src) && !existsSync(path.join(ROOT, path.dirname(file), icon.src))) err(file, `icon "${icon.src}" not found`);
    }
    if (json.start_url && isLocal(json.start_url) && !existsSync(path.join(ROOT, json.start_url.split(/[?#]/)[0]))) {
        err(file, `start_url "${json.start_url}" not found`);
    }
}

// Top-level declarations of one script: { name: kind } where kind is
// 'lexical' (let/const/class) or 'var' (var/function).
function topLevel(ast) {
    const names = new Map();
    const add = (n, kind, node) => n && !names.has(n) && names.set(n, { kind, line: node.loc.start.line });
    const addPattern = (p, kind, node) => {
        if (!p) return;
        if (p.type === 'Identifier') add(p.name, kind, node);
        else if (p.type === 'ObjectPattern') p.properties.forEach((q) => addPattern(q.value || q.argument, kind, node));
        else if (p.type === 'ArrayPattern') p.elements.forEach((q) => addPattern(q, kind, node));
        else if (p.type === 'RestElement') addPattern(p.argument, kind, node);
        else if (p.type === 'AssignmentPattern') addPattern(p.left, kind, node);
    };
    for (const node of ast.body) {
        if (node.type === 'FunctionDeclaration') add(node.id.name, 'function', node);
        else if (node.type === 'ClassDeclaration') add(node.id.name, 'lexical', node);
        else if (node.type === 'VariableDeclaration') node.declarations.forEach((d) => addPattern(d.id, node.kind === 'var' ? 'var' : 'lexical', node));
    }
    return names;
}

// Names scripts publish on purpose via `window.X =` (or `root.X =` in UMD wrappers).
function explicitGlobals(code) {
    const out = new Set();
    for (const m of code.matchAll(/\b(?:window|root|self|globalThis)\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)) out.add(m[1]);
    return out;
}

function checkPage(page) {
    const html = readFileSync(path.join(ROOT, page), 'utf8');
    checkLinks(page, html);
    const scripts = pageScripts(page, html);
    const declared = new Map(); // name -> { where, kind }
    const defined = new Set();

    for (const s of scripts) {
        let ast;
        try {
            ast = espree.parse(s.code, { ecmaVersion: 'latest', sourceType: 'script', loc: true });
        } catch (e) {
            err(`${s.file}:${s.line + (e.lineNumber || 1) - 1}`, `syntax error: ${e.message}${s.file !== page ? ` (loaded by ${page})` : ''}`);
            continue;
        }
        for (const [name, { kind, line }] of topLevel(ast)) {
            const where = `${s.file}:${s.line + line - 1}`;
            const prev = declared.get(name);
            if (prev) {
                if (kind === 'lexical' || prev.kind === 'lexical') {
                    err(where, `"${name}" is already declared at ${prev.where} — on ${page} the browser throws SyntaxError and this script does not run`);
                } else {
                    warn(where, `"${name}" redefines ${prev.where} on ${page} (the later definition silently wins)`);
                }
            } else {
                declared.set(name, { where, kind });
            }
            defined.add(name);
        }
        explicitGlobals(s.code).forEach((n) => defined.add(n));
    }

    // Inline handlers in the page's HTML and in markup built by its scripts.
    const sources = [{ file: page, text: html, base: 1 }, ...scripts.filter((s) => s.file !== page).map((s) => ({ file: s.file, text: s.code, base: 1 }))];
    const seen = new Set();
    for (const src of sources) {
        for (const m of src.text.matchAll(/\bon[a-z]+\s*=\s*\\?["'`]\s*(?:return\s+)?([A-Za-z_$][\w$]*)\s*\(/g)) {
            const name = m[1];
            if (defined.has(name) || BROWSER.has(name) || KEYWORDS.has(name)) continue;
            const where = `${src.file}:${lineAt(src.text, m.index)}`;
            const key = where + name;
            if (seen.has(key)) continue;
            seen.add(key);
            const msg = `handler calls "${name}()" but ${page} never defines it`;
            if (src.file === page) err(where, msg); else warn(where, msg + ' (handler is in a shared script)');
        }
    }
}

const pages = readdirSync(ROOT).filter((f) => f.endsWith('.html')).sort();
pages.forEach(checkPage);

for (const w of warnings) console.log(`warning  ${w}`);
for (const e of errors) console.log(`error    ${e}`);
console.log(`\nChecked ${pages.length} pages: ${errors.length} error(s), ${warnings.length} warning(s).`);
if (errors.length || (strict && warnings.length)) process.exit(1);
