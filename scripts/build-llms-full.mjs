#!/usr/bin/env node
// Builds llms-full.txt — the single-file companion to llms.txt — from the
// structured data (JSON-LD) already embedded in each page, so answer engines
// that fetch one document get the full picture: services, prices, FAQs,
// policies and rating. Regenerate after content/schema changes:
//   node scripts/build-llms-full.mjs
// The update-freshness workflow also runs this on every push, so the file
// stays in lockstep with the pages (including the nightly GBP rating sync).

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://onlinefix.co.uk';

// Public, indexable pages in reading order (mirrors llms.txt).
const PAGES = [
    'index.html',
    'services.html',
    'console-repair.html',
    'playstation-repair.html',
    'xbox-repair.html',
    'iphone-repair.html',
    'macbook-repair.html',
    'laptop-repair.html',
    'pc-repair.html',
    'tablet-repair.html',
    'data-recovery.html',
    'about.html',
    'reviews.html',
    'contact.html',
];

function jsonLdBlocks(html) {
    const blocks = [];
    const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
    let m;
    while ((m = re.exec(html)) !== null) {
        try {
            blocks.push(JSON.parse(m[1]));
        } catch {
            throw new Error('Unparseable JSON-LD block');
        }
    }
    return blocks;
}

// Walk a JSON-LD graph and collect every node of a given @type.
function collect(node, type, out = []) {
    if (Array.isArray(node)) {
        node.forEach((n) => collect(n, type, out));
    } else if (node && typeof node === 'object') {
        if (node['@type'] === type) out.push(node);
        Object.values(node).forEach((v) => collect(v, type, out));
    }
    return out;
}

function pageTitle(html) {
    const m = html.match(/<title>([\s\S]*?)<\/title>/);
    return m ? m[1].replace(/\s+/g, ' ').replace(/&amp;/g, '&').trim() : '';
}

function metaDescription(html) {
    const m = html.match(/<meta name="description"\s+content="([\s\S]*?)">/);
    return m ? m[1].replace(/\s+/g, ' ').replace(/&amp;/g, '&').trim() : '';
}

function offerLine(offer) {
    const item = offer.itemOffered || {};
    const spec = offer.priceSpecification || {};
    const unit = spec.unitText === 'starts from' ? 'from ' : '';
    const price = spec.price ? ` — ${unit}£${spec.price}` : '';
    const desc = item.description ? `. ${item.description}` : '';
    return `- ${item.name}${price}${desc}`;
}

const out = [];

// ---- Header: business facts, kept verbatim from llms.txt (single source) ----
const llmsTxt = readFileSync(`${root}/llms.txt`, 'utf8');
const headerEnd = llmsTxt.indexOf('## Services');
out.push(llmsTxt.slice(0, headerEnd).trim().replace('# OnlineFix', '# OnlineFix — full reference'));
out.push('');
out.push(
    'This document is generated from the structured data on onlinefix.co.uk and ' +
    'contains the full service catalogue, prices and FAQs in one file. ' +
    `A shorter index lives at ${SITE}/llms.txt.`
);

// ---- Live rating (the GBP sync workflow keeps this current on-page) ----
const indexHtml = readFileSync(`${root}/index.html`, 'utf8');
const agg = collect(jsonLdBlocks(indexHtml), 'AggregateRating')[0];
if (agg) {
    out.push('');
    out.push(`Current Google rating: ${agg.ratingValue} stars from ${agg.reviewCount} reviews.`);
}

// ---- Per-page sections ----
for (const page of PAGES) {
    const html = readFileSync(`${root}/${page}`, 'utf8');
    const blocks = jsonLdBlocks(html);
    const url = page === 'index.html' ? `${SITE}/` : `${SITE}/${page}`;

    out.push('');
    out.push(`## ${pageTitle(html)}`);
    out.push('');
    out.push(`URL: ${url}`);
    const desc = metaDescription(html);
    if (desc) {
        out.push('');
        out.push(desc);
    }

    const offers = collect(blocks, 'Offer').filter((o) => o.itemOffered);
    if (offers.length) {
        out.push('');
        out.push('### Prices');
        out.push('');
        offers.forEach((o) => out.push(offerLine(o)));
    }

    const faqs = collect(blocks, 'Question');
    if (faqs.length) {
        out.push('');
        out.push('### Frequently asked questions');
        faqs.forEach((q) => {
            out.push('');
            out.push(`**${q.name}**`);
            out.push('');
            out.push(q.acceptedAnswer?.text ?? '');
        });
    }

    const reviews = collect(blocks, 'Review');
    if (reviews.length) {
        out.push('');
        out.push('### Sample customer reviews');
        reviews.forEach((r) => {
            const author = r.author?.name ?? 'Customer';
            const rating = r.reviewRating?.ratingValue;
            out.push('');
            out.push(`- ${author}${rating ? ` (${rating}/5)` : ''}: "${r.reviewBody}"`);
        });
    }
}

out.push('');
writeFileSync(`${root}/llms-full.txt`, out.join('\n'));
console.log(`llms-full.txt: ${out.join('\n').length} bytes from ${PAGES.length} pages`);
