#!/usr/bin/env node
/* Sync Google Business Profile rating + review count into on-page schema,
   and into the visible "N+ reviews" wording.

   Runs in CI (see .github/workflows/sync-gbp-reviews.yml). Calls the Places
   API (New) for the configured place, then rewrites every `aggregateRating`
   JSON-LD block in the repo to match, plus every visible "170+ reviews"
   style count (HTML pages and llms.txt), rounded down to the nearest 10 so
   the wording stays true until the next ten. The visible "5.0" / "five-star"
   wording is hand-written; see rewriteVisibleCount.

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

/* Rewrite the visible review count people read: "170+ reviews",
   "170+ Google reviews", "READ 170+ REVIEWS", "170+ five-star reviews",
   "170+ 5-star reviews", and the animated "Google Reviews" counter on
   reviews.html (data-target="150" data-suffix="+"). plusStr is the count
   rounded down to the nearest 10, shown with a "+" after it. The count
   covers reviews of every star rating, so the "five-star" phrases are only
   updated while the rating is 5.0; otherwise they are left for a person. */
function rewriteVisibleCount(text, plusStr, fiveStar = true) {
    let changed = 0;
    const phrase = fiveStar
        ? /\b\d{2,}(?=\+\s*(?:five-star\s+|5-star\s+|Google\s+)?reviews\b)/gi
        : /\b\d{2,}(?=\+\s*(?:Google\s+)?reviews\b)/gi;
    const out = text
        .replace(phrase, (num) => {
            if (num !== plusStr) changed++;
            return plusStr;
        })
        .replace(/(data-target=")\d+("\s+data-suffix="\+">[^<]*<\/span>\s*<div class="stat-label">Google Reviews<)/g,
            (block, head, tail) => {
                const next = `${head}${plusStr}${tail}`;
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
    const plusStr = String(Math.floor(place.userRatingCount / 10) * 10); // "180", shown as "180+"
    const name = place.displayName?.text || 'unknown';

    console.log(`GBP: "${name}" — rating ${ratingStr}, count ${countStr}`);
    const fiveStar = ratingStr === '5.0';
    if (!fiveStar) {
        console.warn(`Rating is ${ratingStr}: leaving "five-star reviews" and "Rated 5.0" wording for a person to update.`);
    }

    // Every HTML page, plus llms.txt (the hand-written summary for AI assistants).
    const files = [...await listHtmlFiles(ROOT), join(ROOT, 'llms.txt')];
    let totalFiles = 0;
    let totalBlocks = 0;

    for (const file of files) {
        const before = await readFile(file, 'utf8');
        const schema = rewriteSchema(before, ratingStr, countStr);
        const visible = rewriteVisibleCount(schema.out, plusStr, fiveStar);
        const out = visible.out;
        const changed = schema.changed + visible.changed;
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

export { rewriteSchema, rewriteVisibleCount, sanityCheck };
