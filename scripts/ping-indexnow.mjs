#!/usr/bin/env node
// Submits every sitemap URL to IndexNow (Bing, DuckDuckGo, Seznam, Yandex —
// and via Bing, the index behind ChatGPT search and Copilot), so content
// changes get recrawled within minutes instead of on the crawlers' schedule.
// The key file at /<key>.txt proves ownership; the key being public is by
// design (see indexnow.org). Run: node scripts/ping-indexnow.mjs

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOST = 'onlinefix.co.uk';
const KEY = '853b17bce2555929b47a15e6111147f2';

const sitemap = readFileSync(`${root}/sitemap.xml`, 'utf8');
const urlList = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

const res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
        host: HOST,
        key: KEY,
        keyLocation: `https://${HOST}/${KEY}.txt`,
        urlList,
    }),
});

console.log(`IndexNow: submitted ${urlList.length} URLs — HTTP ${res.status}`);
if (!res.ok && res.status !== 202) {
    console.error(await res.text());
    process.exit(1);
}
