#!/usr/bin/env node
// Regenerates css/*.min.css from css/*.css.
// Run: node scripts/minify-css.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const cssDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'css');

function minify(css) {
    return css
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\s+/g, ' ')
        .replace(/\s*([{};:,>~])\s*/g, '$1')
        .replace(/;}/g, '}')
        .trim();
}

for (const name of ['core', 'icons']) {
    const src = `${cssDir}/${name}.css`;
    const dst = `${cssDir}/${name}.min.css`;
    const original = readFileSync(src, 'utf8');
    const minified = minify(original);
    writeFileSync(dst, minified);
    const pct = Math.round((1 - minified.length / original.length) * 100);
    console.log(`${name}.css: ${original.length} -> ${minified.length} bytes (${pct}% reduction)`);
}
