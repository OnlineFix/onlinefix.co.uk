#!/usr/bin/env node
/* Sync Google Business Profile rating + review count into on-page schema.

   Runs in CI (see .github/workflows/sync-gbp-reviews.yml). Calls the Places
   API (New) for the configured place, then rewrites every `aggregateRating`
   JSON-LD block in the repo to match.

   Env:
     GOOGLE_PLACES_API_KEY  - Places API (New) key from Google Cloud Console
     GOOGLE_PLACE_ID        - Canonical Place ID (e.g. "ChIJ...") from
                              https://developers.google.com/maps/documentation/places/web-service/place-id

   Exit codes:
     0  success (with or without changes)
     1  configuration or API error
     2  sanity-check failed (suspicious data, won't overwrite)
*/

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function fetchPlace() {
    const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
    const PLACE_ID = process.env.GOOGLE_PLACE_ID;
    if (!API_KEY || !PLACE_ID) {
        throw new Error('Missing GOOGLE_PLACES_API_KEY or GOOGLE_PLACE_ID');
    }
    // Normalise: accept either "ChIJ..." or "places/ChIJ..."
    const placePath = PLACE_ID.startsWith('places/') ? PLACE_ID : `places/${PLACE_ID}`;
    const url = `https://places.googleapis.com/v1/${placePath}?fields=rating,userRatingCount,displayName`;
    const res = await fetch(url, {
        headers: { 'X-Goog-Api-Key': API_KEY }
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Places API ${res.status}: ${body}`);
    }
    return res.json();
}

function sanityCheck(data) {
    const { rating, userRatingCount } = data;
    if (typeof rating !== 'number' || rating < 1 || rating > 5) {
        throw new Error(`Implausible rating: ${rating}`);
    }
    if (typeof userRatingCount !== 'number' || userRatingCount < 1) {
        throw new Error(`Implausible userRatingCount: ${userRatingCount}`);
    }
    // Guard against accidental resets — we'd rather keep stale data than zero it.
    if (userRatingCount < 10) {
        throw new Error(`Refusing to sync: userRatingCount=${userRatingCount} looks wrong`);
    }
}

async function listHtmlFiles(dir) {
    const out = [];
    async function walk(d) {
        const entries = await readdir(d, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
            const full = join(d, entry.name);
            if (entry.isDirectory()) {
                await walk(full);
            } else if (entry.isFile() && entry.name.endsWith('.html')) {
                out.push(full);
            }
        }
    }
    await walk(dir);
    return out;
}

/* Rewrite aggregateRating blocks in an HTML string.
   Matches the whole `"aggregateRating": { ... }` object (both pretty-printed
   and minified) and replaces ratingValue + reviewCount inside it. */
function rewriteSchema(html, ratingStr, countStr) {
    const pattern = /"aggregateRating"\s*:\s*\{[^}]*\}/g;
    let changed = 0;
    const out = html.replace(pattern, (block) => {
        let next = block
            .replace(/"ratingValue"\s*:\s*"[^"]*"/, `"ratingValue": "${ratingStr}"`)
            .replace(/"reviewCount"\s*:\s*"[^"]*"/, `"reviewCount": "${countStr}"`);
        // Preserve minified style if the original had no spaces after colons
        if (!/"ratingValue"\s*:\s+"/.test(block)) {
            next = next.replace(/"ratingValue":\s+"/, '"ratingValue":"')
                       .replace(/"reviewCount":\s+"/, '"reviewCount":"');
        }
        if (next !== block) changed++;
        return next;
    });
    return { out, changed };
}

async function main() {
    const place = await fetchPlace();
    sanityCheck(place);

    const ratingStr = place.rating.toFixed(1);            // "4.9"
    const countStr = String(Math.round(place.userRatingCount)); // "187"
    const name = place.displayName?.text || 'unknown';

    console.log(`GBP: "${name}" — rating ${ratingStr}, count ${countStr}`);

    const files = await listHtmlFiles(ROOT);
    let totalFiles = 0;
    let totalBlocks = 0;

    for (const file of files) {
        const before = await readFile(file, 'utf8');
        if (!before.includes('"aggregateRating"')) continue;
        const { out, changed } = rewriteSchema(before, ratingStr, countStr);
        if (out !== before) {
            await writeFile(file, out, 'utf8');
            const rel = file.slice(ROOT.length + 1);
            console.log(`  updated ${rel} (${changed} block${changed === 1 ? '' : 's'})`);
            totalFiles++;
            totalBlocks += changed;
        }
    }

    console.log(`Done: ${totalBlocks} block(s) across ${totalFiles} file(s).`);
}

// Only auto-run when invoked as the entry script (not when imported for tests).
const isEntry = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
    main().catch((err) => {
        console.error(err.message || err);
        process.exit(err.message?.startsWith('Refusing') || err.message?.startsWith('Implausible') ? 2 : 1);
    });
}

export { rewriteSchema, sanityCheck };
