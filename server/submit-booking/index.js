'use strict';
/* submitBooking: the only way a booking from the public /book/ page gets in.

   The page POSTs the form as JSON, photos included (base64 JPEG). This
   function checks every field, keeps one visitor (and the whole site) to a
   few bookings a day, stores the photos, then writes the booking and the
   shop's email notice with the admin SDK. firestore.rules and storage.rules
   give visitors no write access at all; the admin SDK does not go through
   them.

   Deployed from Google Cloud Shell, see README.md. It runs as the
   booking-form service account, which holds only roles/datastore.user and
   roles/storage.objectCreator on the bucket: so this code must never need
   to read, replace or delete a Storage object. Photos go up with
   ifGenerationMatch: 0 (create only).

   The booking id is the page's own CSPRNG id (requestId). It names the
   booking, its notice and its photo folder, so a retry after a lost reply
   finds the booking already there and gets the same answer back. */

const crypto = require('node:crypto');
const net = require('node:net');
const path = require('node:path');
const functions = require('@google-cloud/functions-framework');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');

// Three photos of just under 5 MB are about 20 MB as base64.
const MAX_BODY_BYTES = 22 * 1024 * 1024;
// Most "[", "{", "," and ":" characters a body may hold (see below).
const MAX_JSON_PUNCTUATION = 4096;

// ---- Request bodies -------------------------------------------------------
// Functions Framework reads and parses every request body before this
// function is called, with body-parser, allowing 1 GB and unpacking
// gzip/deflate/br bodies first. Left like that, one small request kills an
// instance before any check below runs: under 1 MB of gzip unpacks to
// 900 MB, and 21 MB of "[[[[..." or "[],[],..." makes JSON.parse build far
// more than the function's 512 MiB.
//
// The framework loads this file before it builds its server, so the
// parsers it is about to create are tightened here: no compressed bodies
// (415), at most MAX_BODY_BYTES (413), and at most MAX_JSON_PUNCTUATION of
// the characters that open or separate JSON values, counted before the
// body is parsed (400). A real booking has at most about 1,400 of them,
// nearly all in what the customer typed; base64 photos have none. A body
// refused here gets the same JSON answer and headers as any other refusal.
//
// This relies on the framework's internals (written against
// functions-framework 5.0.5 with body-parser 2.3.0, pinned by
// package-lock.json). If body-parser cannot be found, loading fails and the
// deploy with it; if the framework stops building its parsers through it,
// every request is answered 500 (the GET check shows it) rather than served
// without these limits.
let tightenedParsers = 0;
(function tightenBodyParsers() {
    const ffDir = path.dirname(require.resolve('@google-cloud/functions-framework'));
    const bodyParser = require(require.resolve('body-parser', { paths: [ffDir] }));
    for (const kind of ['json', 'raw', 'text', 'urlencoded']) {
        const original = bodyParser[kind];
        if (typeof original !== 'function') throw new Error('body-parser has no ' + kind + '()');
        bodyParser[kind] = function tightened(opts) {
            const theirVerify = opts && opts.verify;
            const middleware = original(Object.assign({}, opts, {
                limit: MAX_BODY_BYTES,
                inflate: false,
                verify(req, res, buf, encoding) {
                    let n = 0;
                    for (let i = 0; i < buf.length; i++) {
                        const c = buf[i];
                        if ((c === 0x5B || c === 0x7B || c === 0x2C || c === 0x3A) && ++n > MAX_JSON_PUNCTUATION) {
                            const err = new Error('too many JSON values');
                            err.status = 400;
                            throw err;
                        }
                    }
                    if (theirVerify) theirVerify(req, res, buf, encoding);
                }
            }));
            tightenedParsers++;
            return function (req, res, next) {
                middleware(req, res, (err) => (err ? refuseBody(req, res, err) : next()));
            };
        };
    }
})();

// A body the parsers refused. Only the error's type is logged: a JSON
// syntax error's message quotes part of the body.
function refuseBody(req, res, err) {
    if (res.headersSent) return;
    commonHeaders(req, res);
    const status = err && err.status;
    console.warn('submitBooking: body refused (' + String((err && err.type) || status || 'error') + ')');
    if (status === 413) return reply(res, 413, { ok: false, error: 'too-large' });
    if (status === 415) return reply(res, 415, { ok: false, error: 'type' });
    return reply(res, 400, { ok: false, error: 'invalid' });
}

// The project comes from the environment (and the emulators in tests).
const app = initializeApp({
    storageBucket: process.env.STORAGE_BUCKET || 'onlinefix-repair.firebasestorage.app'
});
const db = getFirestore(app);
const bucket = getStorage(app).bucket();

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://onlinefix.co.uk,https://www.onlinefix.co.uk')
    .split(',').map(s => s.trim()).filter(Boolean);

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;   // each photo must be smaller than this
const MAX_PHOTOS = 3;

// Accepted bookings. Per visitor: 3 in any hour and 6 in a UK day. For the
// whole site: 40 in a UK day. Over any of them the booking is refused (429)
// and the page shows its usual "something went wrong ... call" message.
const LIMITS = Object.freeze({ perClientHour: 3, perClientDay: 6, siteDay: 40 });
const HOUR_MS = 60 * 60 * 1000;

// The shop's Gmail. The notice is sent through that same account, so it
// goes to itself (a copy to hello@onlinefix.uk came back through hello@'s
// forwarding and Gmail kept it under Sent, out of the inbox).
const SHOP_INBOX = 'onlinerepairbooking@gmail.com';

const FIELDS = ['requestId', 'category', 'brand', 'model', 'issue', 'date', 'time',
    'name', 'email', 'phone', 'photos'];
const CATEGORIES = ['phone', 'laptop', 'console', 'tablet', 'desktop', 'other'];
const REQUEST_ID_RE = /^BK_[0-9A-F]{32}$/;
// One plain address: no list, no display name ("Shop" <someone@else>). The
// notice makes it the Reply-To. Same shape as the page and the dashboard.
const EMAIL_RE = /^[^\s@,;:<>()"\[\]\\]+@[^\s@,;:<>()"\[\]\\]+\.[^\s@,;:<>()"\[\]\\]{2,}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
// A field printed on one labelled line of the notice must stay on it: no
// line break of any kind, and no other control character (tab is fine).
const NOT_SINGLE_LINE_RE = /[\u0000-\u0008\u000A-\u001F\u007F\u0085\u2028\u2029]/;
// The same characters less CR and LF (see oneLine).
const STRAY_CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u0085\u2028\u2029]/g;

functions.http('submitBooking', submitBooking);

async function submitBooking(req, res) {
    const originAllowed = commonHeaders(req, res);
    if (!tightenedParsers) {
        // The framework no longer builds its body parsers through the
        // tightened body-parser (see tightenBodyParsers): refuse to run
        // without the body limits.
        console.error('submitBooking: request body limits are not in place; refusing requests');
        return reply(res, 500, { ok: false, error: 'server' });
    }

    if (req.method === 'OPTIONS') {
        if (!originAllowed) return reply(res, 403, { ok: false, error: 'forbidden' });
        res.set('Access-Control-Allow-Methods', 'POST');
        res.set('Access-Control-Allow-Headers', 'Content-Type');
        res.set('Access-Control-Max-Age', '3600');
        return reply(res, 200, { ok: true });
    }
    if (req.method === 'GET') {
        // Health check. "you" is the address this visitor is counted under,
        // so after a deploy the owner can check that two devices on
        // different networks get different ones.
        const client = clientAddress(req);
        return reply(res, 200, { ok: true, you: client });
    }
    if (req.method !== 'POST') {
        res.set('Allow', 'GET, POST, OPTIONS');
        return reply(res, 405, { ok: false, error: 'method' });
    }
    if (!originAllowed) return reply(res, 403, { ok: false, error: 'forbidden' });
    const type = String(req.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const encoding = String(req.get('content-encoding') || 'identity').trim().toLowerCase();
    if (type !== 'application/json' || encoding !== 'identity') {
        return reply(res, 415, { ok: false, error: 'type' });
    }
    const declared = Number(req.get('content-length'));
    const received = Buffer.isBuffer(req.rawBody) ? req.rawBody.length : 0;
    if (declared > MAX_BODY_BYTES || received > MAX_BODY_BYTES) {
        return reply(res, 413, { ok: false, error: 'too-large' });
    }

    try {
        const now = new Date();
        const booking = readBooking(req.body);
        if (!booking) return reply(res, 400, { ok: false, error: 'invalid' });
        if (!await dateAllowed(booking.date, now)) return reply(res, 400, { ok: false, error: 'invalid' });

        const id = booking.requestId;
        const reference = id.slice(-6);
        const client = clientAddress(req);
        if (!client) console.warn('submitBooking: no usable client address; only the site-wide limit applies');

        const verdict = await admit(id, client, now);
        if (verdict === 'exists') return reply(res, 200, { ok: true, reference });
        if (verdict === 'busy') return reply(res, 429, { ok: false, error: 'busy' });

        await writeBooking(booking, now);
        try {
            await removeOldLimits(now);
        } catch (err) {
            logError('cleanup failed', err);
        }
        return reply(res, 200, { ok: true, reference });
    } catch (err) {
        logError('failed', err);
        return reply(res, 500, { ok: false, error: 'server' });
    }
}

// Headers on every answer. Returns whether the request's Origin is the
// site's, in which case it is echoed for CORS.
function commonHeaders(req, res) {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Vary', 'Origin');
    const origin = req.get('origin');
    const originAllowed = typeof origin === 'string' && ALLOWED_ORIGINS.includes(origin);
    if (originAllowed) res.set('Access-Control-Allow-Origin', origin);
    return originAllowed;
}

function reply(res, status, body) {
    return res.status(status).json(body);
}

// Codes and messages only: never the request, which holds customer details.
function logError(what, err) {
    const code = err && err.code !== undefined ? String(err.code) : '';
    const message = String((err && err.message) || err || '').slice(0, 300);
    console.error('submitBooking: ' + what + (code ? ' [' + code + ']' : '') + ': ' + message);
}

// ---- Validation -----------------------------------------------------------
// At least as strict as the page's own checks and as the rules that held
// public bookings before this function (isValidBookingCreate and the
// notice's single-line checks in the old firestore.rules). Returns the
// cleaned booking, or null for anything wrong: the reply never says which
// field.
function readBooking(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    const keys = Object.keys(body);
    if (keys.length !== FIELDS.length || !keys.every(k => FIELDS.includes(k))) return null;
    for (const k of FIELDS) {
        // isWellFormed: no half of an emoji's surrogate pair on its own,
        // which Firestore refuses. Refused here, before anything is counted
        // or stored.
        if (k !== 'photos' && (typeof body[k] !== 'string' || !body[k].isWellFormed())) return null;
    }
    const { requestId, category, issue, date, time, email, photos } = body;
    const name = oneLine(body.name);
    const phone = oneLine(body.phone);
    const brand = oneLine(body.brand);
    const model = oneLine(body.model);

    if (!REQUEST_ID_RE.test(requestId)) return null;

    const nameT = name.trim();
    if (name.length > 99 || nameT.length < 1 || !singleLine(name)) return null;

    if (email.length >= 200 || !EMAIL_RE.test(email) || !singleLine(email)) return null;

    const phoneT = phone.trim();
    if (phone.length > 29 || phoneT.length < 6 || !singleLine(phone) || !isUkPhone(phone)) return null;

    if (!CATEGORIES.includes(category)) return null;
    if (brand.length >= 50 || brand.trim().length < 1 || !singleLine(brand)) return null;

    const modelT = model.trim();
    if (model.length > 99 || modelT.length < 1 || !singleLine(model)) return null;

    const issueT = issue.trim();
    if (issue.length > 999 || issueT.length < 1) return null;

    if (!isRealDate(date) || !TIME_RE.test(time)) return null;

    if (!Array.isArray(photos) || photos.length > MAX_PHOTOS) return null;
    const jpegs = [];
    for (const p of photos) {
        const buf = decodeJpeg(p);
        if (!buf) return null;
        jpegs.push(buf);
    }

    return {
        requestId, category, brand, date, time, jpegs,
        model: modelT, issue: issueT,
        name: nameT, email: email.trim(), phone: phoneT
    };
}

function singleLine(s) {
    return !NOT_SINGLE_LINE_RE.test(s);
}

// The page's one-line inputs drop CR and LF but let the other characters
// singleLine() refuses through (a pasted U+2028, a stray control
// character), and the booking rules this function replaced saved them. So
// in the name, phone, brand and model those become a space, and a real
// customer is not refused over one; CR and LF, which the page cannot send
// there, are still refused. The email is left as sent: an address with one
// of these in it is refused.
function oneLine(s) {
    return s.replace(STRAY_CONTROL_RE, ' ');
}

// Same test as isUkPhone in book/booking.js.
function isUkPhone(s) {
    if (!s) return false;
    const trimmed = s.replace(/[\s()-]/g, '');
    return /^(07\d{9}|\+447\d{9}|00447\d{9})$/.test(trimmed);
}

function isRealDate(s) {
    if (!DATE_RE.test(s)) return false;
    const [y, m, d] = s.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// A base64 JPEG of 1 byte up to just under 5 MB, or null.
function decodeJpeg(p) {
    if (typeof p !== 'string' || p.length === 0 || p.length % 4 !== 0) return null;
    if (p.length > Math.ceil(MAX_PHOTO_BYTES / 3) * 4) return null;
    if (!BASE64_RE.test(p)) return null;
    const buf = Buffer.from(p, 'base64');
    if (buf.length < 1 || buf.length >= MAX_PHOTO_BYTES) return null;
    if (buf.length < 3 || buf[0] !== 0xFF || buf[1] !== 0xD8 || buf[2] !== 0xFF) return null;
    return buf;
}

// The drop-off day must be between today and the last day the page offers
// (availability/settings.maxFutureDays, 60 when unset), in UK dates, with a
// day's grace for a page left open over midnight.
async function dateAllowed(date, now) {
    const snap = await db.collection('availability').doc('settings').get();
    const v = snap.exists ? snap.get('maxFutureDays') : undefined;
    const maxDays = (typeof v === 'number' && Number.isFinite(v) && v > 0) ? Math.min(Math.floor(v), 3650) : 60;
    return date >= ukIsoDate(0, now) && date <= ukIsoDate(maxDays + 1, now);
}

// ---- Who is asking --------------------------------------------------------
// The visitor's address as the rate limit counts it: an IPv4 address, or an
// IPv6 /56 ("2001:db8:1:200::/56"). A phone or a household usually holds a
// /64 or a /56 of its own, and a free IPv6 tunnel hands out a /48 (65,536
// /64s), so counting by /64 would let one person book past the per-visitor
// limit just by changing address. Counting by /56 makes that 256 times
// harder while two real customers in the same /56 on the same day stay
// very unlikely. null when there is no address worth counting.
//
// X-Forwarded-For is read from the RIGHT. A client can send the header
// itself and put anything in it, but Google's front end appends the address
// it actually saw, so only the right-hand end can be trusted. Entries that
// cannot be a visitor (private, loopback, link-local, unique-local, and
// Google's own front-end and health-check ranges) are skipped. With no
// X-Forwarded-For at all, the socket's address is used with the same test.
function clientAddress(req) {
    const header = req.headers['x-forwarded-for'];
    if (header !== undefined) {
        const entries = [].concat(header).join(',').split(',');
        for (let i = entries.length - 1; i >= 0; i--) {
            const a = usableAddress(entries[i]);
            if (a) return a;
        }
        return null;
    }
    return usableAddress(req.socket && req.socket.remoteAddress);
}

function usableAddress(raw) {
    let s = String(raw || '').trim();
    const zone = s.indexOf('%');
    if (zone !== -1) s = s.slice(0, zone);
    const kind = net.isIP(s);
    if (kind === 4) return usableIPv4(s.split('.').map(Number));
    if (kind !== 6) return null;
    const g = ipv6Groups(s);
    if (!g) return null;
    // ::ffff:a.b.c.d is an IPv4 address.
    if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) {
        return usableIPv4([g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff]);
    }
    if (g.every(x => x === 0)) return null;                                   // ::
    if (g.slice(0, 7).every(x => x === 0) && g[7] === 1) return null;         // ::1
    if ((g[0] & 0xfe00) === 0xfc00) return null;                              // fc00::/7
    if ((g[0] & 0xffc0) === 0xfe80) return null;                              // fe80::/10
    return [g[0], g[1], g[2], g[3] & 0xff00].map(x => x.toString(16)).join(':') + '::/56';
}

function usableIPv4([a, b, c, d]) {
    if (a === 0 || a === 10 || a === 127) return null;                        // 0/8, 10/8, 127/8
    if (a === 169 && b === 254) return null;                                  // 169.254/16
    if (a === 172 && b >= 16 && b <= 31) return null;                         // 172.16/12
    if (a === 192 && b === 168) return null;                                  // 192.168/16
    if (a === 35 && b === 191) return null;                                   // Google front end
    if (a === 130 && b === 211 && c <= 3) return null;                        // 130.211.0.0/22
    return a + '.' + b + '.' + c + '.' + d;
}

// The eight 16-bit groups of an address net.isIP() already accepted as IPv6.
function ipv6Groups(addr) {
    let s = addr.toLowerCase();
    const v4 = s.match(/^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (v4) {
        const [p0, p1, p2, p3] = v4.slice(2).map(Number);
        s = v4[1] + ((p0 << 8) | p1).toString(16) + ':' + ((p2 << 8) | p3).toString(16);
    }
    const halves = s.split('::');
    if (halves.length > 2) return null;
    const head = halves[0] ? halves[0].split(':') : [];
    const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
    const missing = 8 - head.length - tail.length;
    if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
    const groups = head.concat(new Array(halves.length === 2 ? missing : 0).fill('0'), tail)
        .map(h => parseInt(h, 16));
    return groups.length === 8 && groups.every(x => x >= 0 && x <= 0xffff) ? groups : null;
}

// ---- Rate limits ------------------------------------------------------------
// bookingLimits/{day}_all: the UK day's accepted-booking count and a random
// salt made on the day's first booking. bookingLimits/{day}_{hash}: one
// visitor's accepted bookings that day (times in milliseconds), where hash
// is HMAC-SHA256(salt, address), cut to 32 hex characters. No address is
// ever stored, and removeOldLimits deletes a day's documents, salt
// included, two days on. No client can read or write this collection (the
// rules' final deny-all).
//
// Returns 'exists' (this booking is already saved: a retry), 'busy' (over a
// limit; nothing written) or 'ok' (counted).
async function admit(id, client, now) {
    const nowMs = now.getTime();
    const day = ukIsoDate(0, now);
    const limits = db.collection('bookingLimits');
    const bookingRef = db.collection('bookings').doc(id);
    const dayRef = limits.doc(day + '_all');
    const expireAt = Timestamp.fromMillis(Date.parse(ukIsoDate(3, now) + 'T00:00:00Z'));

    return db.runTransaction(async (tx) => {
        const [bookingSnap, daySnap] = await tx.getAll(bookingRef, dayRef);
        if (bookingSnap.exists) return 'exists';

        let salt = daySnap.exists ? daySnap.get('salt') : null;
        if (typeof salt !== 'string' || !/^[0-9a-f]{64}$/.test(salt)) salt = crypto.randomBytes(32).toString('hex');
        const dayCount = daySnap.exists && Number.isInteger(daySnap.get('count')) ? daySnap.get('count') : 0;
        if (dayCount >= LIMITS.siteDay) return 'busy';

        let clientRef = null;
        let times = [];
        if (client) {
            const hash = crypto.createHmac('sha256', Buffer.from(salt, 'hex')).update(client).digest('hex').slice(0, 32);
            clientRef = limits.doc(day + '_' + hash);
            const clientSnap = await tx.get(clientRef);
            const stored = clientSnap.exists ? clientSnap.get('times') : null;
            times = Array.isArray(stored) ? stored.filter(t => typeof t === 'number') : [];
            const lastHour = times.filter(t => t > nowMs - HOUR_MS).length;
            if (times.length >= LIMITS.perClientDay || lastHour >= LIMITS.perClientHour) return 'busy';
        }

        tx.set(dayRef, { day, salt, count: dayCount + 1, expireAt });
        if (clientRef) tx.set(clientRef, { day, times: times.concat(nowMs), expireAt });
        return 'ok';
    });
}

// Best effort, after each accepted booking: delete up to 50 limit documents
// from before yesterday (UK), so no visitor's record outlives about two days.
async function removeOldLimits(now) {
    const snap = await db.collection('bookingLimits')
        .where('day', '<', ukIsoDate(-1, now)).limit(50).get();
    if (snap.empty) return;
    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
}

// ---- Writing the booking ----------------------------------------------------
async function writeBooking(b, now) {
    const id = b.requestId;
    const photoPaths = b.jpegs.map((_, i) => 'bookings/' + id + '/photo-' + (i + 1) + '.jpg');
    for (let i = 0; i < b.jpegs.length; i++) await storePhoto(photoPaths[i], b.jpegs[i]);

    const [y, m, d] = b.date.split('-').map(Number);
    const [hh, mm] = b.time.split(':').map(Number);
    // The slots are the shop's hours, so the time picked is UK time.
    const preferredAt = ukTime(y, m, d, hh, mm);

    // Exactly the shape the booking page used to write, which the dashboard
    // reads. photos stays empty (staff open photos from photoPaths).
    const doc = {
        createdAt: FieldValue.serverTimestamp(),
        status: 'pending',
        respondedAt: null,
        linkedRepairId: null,
        adminNotes: '',
        deleted: false,
        tempId: id,
        customer: { name: b.name, email: b.email, phone: b.phone },
        device: { category: b.category, brand: b.brand, model: b.model },
        issue: b.issue,
        preferredAt: Timestamp.fromDate(preferredAt),
        photos: [],
        photoPaths
    };

    // The booking and its notice land together or not at all. create()
    // never replaces anything: if the booking is already there, an earlier
    // attempt at this same request saved it (and its notice).
    const batch = db.batch();
    batch.create(db.collection('bookings').doc(id), doc);
    batch.create(db.collection('mail').doc(id), shopNotice(id, doc, preferredAt));
    try {
        await batch.commit();
    } catch (err) {
        if (!err || err.code !== 6) throw err;   // 6 = ALREADY_EXISTS
    }
}

// Create only: the service account may not replace or read objects. A 412
// means an earlier attempt at this booking already stored this photo.
async function storePhoto(path, buf) {
    try {
        await bucket.file(path).save(buf, {
            resumable: false,
            contentType: 'image/jpeg',
            metadata: {
                contentType: 'image/jpeg',
                // What the dashboard's getDownloadURL() hands out.
                metadata: { firebaseStorageDownloadTokens: crypto.randomUUID() }
            },
            preconditionOpts: { ifGenerationMatch: 0 }
        });
    } catch (err) {
        if (err && (err.code === 412 || err.code === '412')) return;
        throw err;
    }
}

// ---- The shop's email -------------------------------------------------------
// Approved wording: keep byte for byte (it is what book/booking.js sent
// before this function, and what the old rules held it to). The "Trigger
// Email from Firestore" extension sends it from the shop's Gmail to itself.
function shopNotice(id, doc, preferredAt) {
    const reference = id.slice(-6);
    const when = ukWhen(preferredAt);
    const text = 'New booking request from the website booking form.\n\n'
        + 'Reference: ' + reference + '\n'
        + 'Customer: ' + doc.customer.name + '\n'
        + 'Email: ' + doc.customer.email + '\n'
        + 'Phone: ' + doc.customer.phone + '\n'
        + 'Wants to drop off: ' + when + '\n'
        + 'Device type: ' + doc.device.category + '\n'
        + 'Brand: ' + doc.device.brand + '\n'
        + 'Model: ' + doc.device.model + '\n'
        + 'Photos: ' + doc.photoPaths.length + '\n\n'
        + 'What the customer wrote:\n' + doc.issue + '\n\n'
        + 'Reply to this email to answer the customer. The booking is on the '
        + 'dashboard under Online Bookings: https://onlinefix.co.uk/admin/';
    const notice = {
        to: [SHOP_INBOX],
        replyTo: doc.customer.email,
        message: {
            subject: 'Booking request ' + reference + ': ' + doc.customer.name + ', ' + when,
            text: text
        },
        meta: { kind: 'booking-request', bookingId: id, reference: reference, when: when }
    };
    // The notice goes from the shop's Gmail to itself, so it skips the spam
    // filter, and Gmail makes any address in it clickable. When anything
    // the customer typed looks like a link (a real customer can type one
    // too: "cracked.The screen"), the short notice goes instead: reference
    // and time only, none of the customer's words. The email line is not
    // tested (an address always has a domain); it is one plain address.
    const fields = [doc.customer.name, doc.customer.phone, doc.device.brand, doc.device.model, doc.issue];
    if (fields.some(looksLikeLink)) {
        notice.message = {
            subject: 'Booking request ' + reference + ', ' + when,
            text: 'New booking request from the website booking form.\n\n'
                + 'Reference: ' + reference + '\n'
                + 'Wants to drop off: ' + when + '\n\n'
                + 'Part of what the customer typed looks like a web address, so it is '
                + 'left out of this email. Read the booking on the dashboard under '
                + 'Online Bookings: https://onlinefix.co.uk/admin/\n\n'
                + 'Replying to this email answers the address the booking gave.'
        };
    }
    return notice;
}

// A web address ("https:", "www.", "//") or a domain in any alphabet
// ("bit.ly/x", "payé.com", "оплата.рф").
const LINK_RE = /https?:|www\.|\/\/|[\p{L}\p{N}-]\.\p{L}{2,}/iu;
function looksLikeLink(s) {
    return LINK_RE.test(String(s || ''));
}

// ---- UK time ------------------------------------------------------------------
// Parts of a moment as a UK clock shows it.
function ukParts(date, options) {
    const parts = {};
    new Intl.DateTimeFormat('en-GB', Object.assign({ timeZone: 'Europe/London' }, options))
        .formatToParts(date)
        .forEach(p => { parts[p.type] = p.value; });
    return parts;
}

// The moment a UK clock reads y-m-d hh:mm. Starts from that reading as if
// it were UTC, then takes off however far the UK is ahead of UTC then
// (nothing in winter, an hour in summer). Same as book/booking.js.
function ukTime(y, m, d, hh, mm) {
    const asUtc = Date.UTC(y, m - 1, d, hh, mm);
    const p = ukParts(new Date(asUtc), {
        year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', hourCycle: 'h23'
    });
    const ukAsUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
    return new Date(asUtc - (ukAsUtc - asUtc));
}

// "Friday 25 September at 11:00", in UK time.
function ukWhen(date) {
    const p = ukParts(date, {
        weekday: 'long', day: 'numeric', month: 'long',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    });
    return `${p.weekday} ${p.day} ${p.month} at ${p.hour}:${p.minute}`;
}

// The UK date n days from now, as YYYY-MM-DD.
function ukIsoDate(n, now) {
    const p = ukParts(now, { year: 'numeric', month: '2-digit', day: '2-digit' });
    return new Date(Date.UTC(+p.year, +p.month - 1, +p.day + n)).toISOString().slice(0, 10);
}
