#!/usr/bin/env node
// Keeps freshness metadata truthful, from git history:
//   - <lastmod> in sitemap.xml
//   - "dateModified" in each page's WebPage/AboutPage/ContactPage JSON-LD
// A page's date is its last commit that wasn't a freshness sync commit
// (message starting "chore: freshness"), so the bot's own stamps never
// count as content changes. Run: node scripts/update-freshness.mjs
// The update-freshness workflow runs this on every push to main.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://onlinefix.co.uk';
const today = new Date().toISOString().slice(0, 10);

function lastContentDate(file) {
    try {
        const out = execSync(
            `git log -1 --format=%cs --invert-grep --grep='^chore: freshness' -- "${file}"`,
            { cwd: root, encoding: 'utf8' }
        ).trim();
        return out || today;
    } catch {
        return today;
    }
}

// ---- sitemap.xml <lastmod> ----
let sitemap = readFileSync(`${root}/sitemap.xml`, 'utf8');
let sitemapChanges = 0;
sitemap = sitemap.replace(
    /(<loc>([^<]+)<\/loc>\s*<lastmod>)(\d{4}-\d{2}-\d{2})(<\/lastmod>)/g,
    (all, head, loc, oldDate, tail) => {
        const path = loc.replace(`${SITE}/`, '') || 'index.html';
        if (!existsSync(`${root}/${path}`)) return all;
        const date = lastContentDate(path);
        if (date !== oldDate) sitemapChanges += 1;
        return `${head}${date}${tail}`;
    }
);
writeFileSync(`${root}/sitemap.xml`, sitemap);

// ---- JSON-LD dateModified stamps ----
const stamped = execSync(
    `grep -l '"dateModified"' *.html`,
    { cwd: root, encoding: 'utf8' }
).trim().split('\n');

let stampChanges = 0;
for (const file of stamped) {
    const date = lastContentDate(file);
    const src = readFileSync(`${root}/${file}`, 'utf8');
    const next = src.replace(
        /("dateModified"\s*:\s*")\d{4}-\d{2}-\d{2}(")/g,
        `$1${date}$2`
    );
    if (next !== src) {
        writeFileSync(`${root}/${file}`, next);
        stampChanges += 1;
    }
}

console.log(`sitemap lastmod updates: ${sitemapChanges}; dateModified updates: ${stampChanges}`);
