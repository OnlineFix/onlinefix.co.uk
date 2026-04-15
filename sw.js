/* OnlineFix Service Worker
   - Precaches the app shell so navigation feels instant on repeat visits
   - Network-first for HTML so SEO/schema edits ship without stale pages
   - Stale-while-revalidate for static assets (CSS/JS/images)
   - Never intercepts cross-origin requests (Firebase, GA, Cloudflare, cdnjs)
   - Never caches /admin/ (auth-gated, always fresh)
*/

const SW_VERSION = 'onlinefix-v1';
const SHELL_CACHE = `shell-${SW_VERSION}`;
const RUNTIME_CACHE = `runtime-${SW_VERSION}`;

const SHELL_URLS = [
    '/',
    '/index.html',
    '/css/core.css',
    '/css/icons.css',
    '/js/core.js',
    '/images/onlinefix-logo.webp',
    '/favicon-192x192.png',
    '/favicon-512x512.png',
    '/manifest.webmanifest',
    '/404.html'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(SHELL_CACHE)
            .then((cache) => cache.addAll(SHELL_URLS).catch(() => {}))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((names) => Promise.all(
                names
                    .filter((n) => n !== SHELL_CACHE && n !== RUNTIME_CACHE)
                    .map((n) => caches.delete(n))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('message', (event) => {
    if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

function isHtmlRequest(req) {
    if (req.mode === 'navigate') return true;
    const accept = req.headers.get('accept') || '';
    return accept.includes('text/html');
}

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);

    // Never intercept cross-origin (Firebase, Google Analytics, Cloudflare, cdnjs, reCAPTCHA)
    if (url.origin !== self.location.origin) return;

    // Never cache admin or booking-creation areas — always go to network
    if (url.pathname.startsWith('/admin/') || url.pathname.startsWith('/new-repair/')) return;

    // HTML navigations: network-first, fall back to cache, then offline fallback
    if (isHtmlRequest(req)) {
        event.respondWith(
            fetch(req)
                .then((res) => {
                    if (res && res.status === 200 && res.type === 'basic') {
                        const copy = res.clone();
                        caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, copy));
                    }
                    return res;
                })
                .catch(() =>
                    caches.match(req)
                        .then((cached) => cached || caches.match('/') || caches.match('/404.html'))
                )
        );
        return;
    }

    // Static assets: stale-while-revalidate
    event.respondWith(
        caches.match(req).then((cached) => {
            const fetchPromise = fetch(req)
                .then((res) => {
                    if (res && res.status === 200 && res.type === 'basic') {
                        const copy = res.clone();
                        caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, copy));
                    }
                    return res;
                })
                .catch(() => cached);
            return cached || fetchPromise;
        })
    );
});
