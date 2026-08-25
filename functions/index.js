'use strict';

/* Cloud Functions for the onlinefix.co.uk booking system.
   See docs/booking-api-contract.md for the wire format, and
   docs/setup-booking-calendar.md for the one-time Google setup.

   Deployed to europe-west2 (London) — closest region to the customers and to
   the business, and it keeps booking data in the UK.
*/

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { setGlobalOptions } = require('firebase-functions/v2');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');

const {
    loadSettings, loadOverrides, loadOccupied, computeDays
} = require('./lib/availability');
const { getBusy, listEvents, createBookingEvent, deleteEvent } = require('./lib/calendar');
const mailer = require('./lib/mail');
const {
    londonDateKey, dateKeyRange, addDaysToDateKey, TZ
} = require('./lib/time');

admin.initializeApp();
const db = admin.firestore();

setGlobalOptions({ region: 'europe-west2', maxInstances: 10 });

const ADMIN_EMAILS = ['onlinerepairbooking@gmail.com'];
const MAX_RANGE_DAYS = 62;
const CATEGORIES = ['phone', 'laptop', 'console', 'tablet', 'desktop', 'other'];
const MAX_HELD_PER_EMAIL = 5;

// Bookings taken before this backend existed carry status 'pending' and a
// `preferredAt` rather than slotStart/slotEnd/slotKey. They are real requests
// from real customers, so they stay decidable rather than becoming a dead end
// in the dashboard.
const LEGACY_PENDING = 'pending';
const DECIDABLE = ['held', LEGACY_PENDING];

/* ---- helpers ----------------------------------------------------------- */

function requireAdmin(request) {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Sign in first.');
    const token = auth.token || {};
    if (token.admin === true) return;
    if (token.email && ADMIN_EMAILS.includes(token.email)) return;
    throw new HttpsError('permission-denied', 'Admin only.');
}

/* Deterministic lock id for a slot: 20260825T090000Z. Two requests for the
   same instant therefore contend on the same document, which is what makes
   the transaction below a real mutual exclusion rather than a race. */
function slotKey(date) {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function isDateKey(s) {
    return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function clampRange(fromKey, toKey, settings) {
    const today = londonDateKey(new Date());
    let from = isDateKey(fromKey) ? fromKey : today;
    if (from < today) from = today;
    const horizonKey = addDaysToDateKey(today, Number(settings.maxFutureDays) || 60);
    let to = isDateKey(toKey) ? toKey : horizonKey;
    if (to > horizonKey) to = horizonKey;
    // Never let a caller ask for an unbounded span.
    const cap = addDaysToDateKey(from, MAX_RANGE_DAYS);
    if (to > cap) to = cap;
    if (to < from) to = from;
    return { from, to };
}

/* Everything needed to answer "what is bookable between these dates". */
async function buildAvailability(fromKey, toKey, settings) {
    const dateKeys = dateKeyRange(fromKey, toKey);
    // Widen the calendar window by a day each side so an appointment that
    // butts against midnight still sees the neighbouring commitment.
    const windowStart = new Date(`${addDaysToDateKey(fromKey, -1)}T00:00:00Z`);
    const windowEnd = new Date(`${addDaysToDateKey(toKey, 2)}T00:00:00Z`);

    const [overrides, busyResult, occupied] = await Promise.all([
        loadOverrides(db, dateKeys),
        getBusy({ calendarId: settings.calendarId, timeMin: windowStart, timeMax: windowEnd }),
        loadOccupied(db, windowStart, windowEnd)
    ]);

    if (!busyResult.ok) {
        logger.warn('Calendar freebusy unavailable, showing slots without it', {
            error: busyResult.error, calendarId: settings.calendarId
        });
    }

    const days = computeDays({
        fromKey, toKey, settings, overrides,
        busy: busyResult.busy, occupied, now: new Date()
    });
    return { days, calendarOk: busyResult.ok, calendarError: busyResult.error || null };
}

function str(v, max) {
    return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function validateSubmission(data) {
    const errors = [];
    const customer = data.customer || {};
    const device = data.device || {};

    const name = str(customer.name, 100);
    const email = str(customer.email, 200);
    const phone = str(customer.phone, 30);
    const model = str(device.model, 100);
    const brand = str(device.brand, 50);
    const issue = str(data.issue, 1000);
    const extraNotes = str(data.extraNotes, 500);
    const tempId = str(data.tempId, 99);

    if (!name) errors.push('Name is required.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('A valid email is required.');
    if (!/^(07\d{9}|\+447\d{9}|00447\d{9})$/.test(phone.replace(/[\s()-]/g, ''))) {
        errors.push('A valid UK phone number is required.');
    }
    if (!CATEGORIES.includes(device.category)) errors.push('Unknown device category.');
    if (!model) errors.push('Device model is required.');
    if (!issue) errors.push('A description of the fault is required.');
    if (!tempId) errors.push('Missing submission id.');

    // Photo URLs are echoed into the dashboard and emails, so only accept the
    // Storage hosts we actually upload to.
    const photos = Array.isArray(data.photos) ? data.photos.slice(0, 3) : [];
    const photoPaths = Array.isArray(data.photoPaths) ? data.photoPaths.slice(0, 3) : [];
    const badPhoto = photos.find((u) => typeof u !== 'string'
        || !/^https:\/\/(firebasestorage\.googleapis\.com|[a-z0-9-]+\.firebasestorage\.app)\//i.test(u));
    if (badPhoto) errors.push('Unexpected photo URL.');

    if (errors.length) throw new HttpsError('invalid-argument', errors.join(' '));

    return {
        customer: { name, email, phone },
        device: { category: device.category, brand, model },
        issue: extraNotes ? `${issue}\n\n--- Additional notes ---\n${extraNotes}` : issue,
        photos,
        photoPaths: photoPaths.filter((p) => typeof p === 'string').map((p) => p.slice(0, 200)),
        tempId
    };
}

/* Appointment window for a booking, filling in what the pre-backend
   documents do not carry. Returns Timestamps so callers can write them back. */
function resolveSlot(booking, settings) {
    if (booking.slotStart && booking.slotEnd) {
        return { start: booking.slotStart, end: booking.slotEnd };
    }
    const startTs = booking.slotStart || booking.preferredAt;
    if (!startTs || typeof startTs.toDate !== 'function') {
        throw new HttpsError('failed-precondition',
            'This booking has no appointment time recorded, so it cannot be accepted.');
    }
    const start = startTs.toDate();
    const mins = Number(settings.appointmentMinutes) || Number(settings.slotIntervalMinutes) || 30;
    return {
        start: admin.firestore.Timestamp.fromDate(start),
        end: admin.firestore.Timestamp.fromDate(new Date(start.getTime() + mins * 60000))
    };
}

/* ---- getSlots (public) ------------------------------------------------- */

exports.getSlots = onCall({ cors: true }, async (request) => {
    const data = request.data || {};
    const settings = await loadSettings(db);
    const { from, to } = clampRange(data.from, data.to, settings);
    const { days, calendarOk } = await buildAvailability(from, to, settings);

    return {
        ok: true,
        timezone: TZ,
        calendarOk,
        settings: {
            slotIntervalMinutes: settings.slotIntervalMinutes,
            appointmentMinutes: settings.appointmentMinutes,
            minNoticeHours: settings.minNoticeHours,
            maxFutureDays: settings.maxFutureDays
        },
        days
    };
});

/* ---- submitBooking (public) -------------------------------------------- */

exports.submitBooking = onCall({ cors: true }, async (request) => {
    const data = request.data || {};
    const clean = validateSubmission(data);

    const start = new Date(data.slotStartIso);
    if (isNaN(start.getTime())) {
        throw new HttpsError('invalid-argument', 'Invalid slot.');
    }

    const settings = await loadSettings(db);
    const dateKey = londonDateKey(start);

    // Re-derive availability server-side. The client's opinion about which
    // slots are open is never trusted — this is the check that stops a
    // hand-crafted request booking 3am on a Sunday.
    const { days } = await buildAvailability(dateKey, dateKey, settings);
    const day = days[0];
    const slot = day && day.slots.find((s) => s.startIso === start.toISOString());
    if (!slot) throw new HttpsError('failed-precondition', 'That time is not a bookable slot.');
    if (!slot.available) {
        if (slot.reason === 'taken') throw new HttpsError('already-exists', 'That slot has just been taken.');
        throw new HttpsError('failed-precondition', 'That time is no longer available.');
    }

    // Light abuse brake. App Check is deliberately off on this site (the
    // production CSP blocks the reCAPTCHA token fetch), so cap how many live
    // holds one email address can accumulate.
    const existing = await db.collection('bookings')
        .where('customer.email', '==', clean.customer.email)
        .where('status', '==', 'held')
        .limit(MAX_HELD_PER_EMAIL)
        .get();
    if (existing.size >= MAX_HELD_PER_EMAIL) {
        throw new HttpsError('resource-exhausted',
            'You already have several booking requests waiting. Please call us instead.');
    }

    const end = new Date(slot.endIso);
    const holdHours = Number(settings.holdExpiryHours) || 48;
    const holdExpiresAt = new Date(Date.now() + holdHours * 3600 * 1000);
    const bookingRef = db.collection('bookings').doc();
    const lockRef = db.collection('slotLocks').doc(slotKey(start));

    // The transaction is the double-booking guard. Two submissions for the
    // same instant contend on the same lock document, so exactly one commits.
    await db.runTransaction(async (tx) => {
        const lock = await tx.get(lockRef);
        let staleBookingRef = null;
        if (lock.exists) {
            const l = lock.data() || {};
            const expired = l.status === 'held'
                && l.expiresAt && l.expiresAt.toDate().getTime() < Date.now();
            if (l.status !== 'released' && !expired) {
                throw new HttpsError('already-exists', 'That slot has just been taken.');
            }
            // Taking over an expired hold: the booking that held it must stop
            // being decidable in the same commit, or accepting it later would
            // double-book the slot we are about to hand to this customer.
            if (expired && l.bookingId) {
                staleBookingRef = db.collection('bookings').doc(l.bookingId);
                const staleSnap = await tx.get(staleBookingRef);
                if (!staleSnap.exists || staleSnap.data().status !== 'held') {
                    staleBookingRef = null;
                }
            }
        }
        if (staleBookingRef) {
            tx.update(staleBookingRef, {
                status: 'expired',
                decidedAt: admin.firestore.Timestamp.now()
            });
        }

        tx.set(lockRef, {
            bookingId: bookingRef.id,
            status: 'held',
            slotStart: admin.firestore.Timestamp.fromDate(start),
            slotEnd: admin.firestore.Timestamp.fromDate(end),
            expiresAt: admin.firestore.Timestamp.fromDate(holdExpiresAt),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        tx.set(bookingRef, {
            status: 'held',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            respondedAt: null,
            decidedAt: null,
            linkedRepairId: null,
            adminNotes: '',
            deleted: false,
            tempId: clean.tempId,
            customer: clean.customer,
            device: clean.device,
            issue: clean.issue,
            slotStart: admin.firestore.Timestamp.fromDate(start),
            slotEnd: admin.firestore.Timestamp.fromDate(end),
            // Kept for continuity with the pre-backend documents, which the
            // dashboard still lists.
            preferredAt: admin.firestore.Timestamp.fromDate(start),
            holdExpiresAt: admin.firestore.Timestamp.fromDate(holdExpiresAt),
            slotKey: slotKey(start),
            photos: clean.photos,
            photoPaths: clean.photoPaths,
            calendarEventId: null,
            declineReason: null
        });
    });

    // Email is best-effort: the booking is already safely held, and failing
    // the whole request because the mail queue hiccuped would lose it.
    try {
        const snap = await bookingRef.get();
        await db.collection('mail').add(
            mailer.ownerNotification({ booking: snap.data(), bookingId: bookingRef.id })
        );
    } catch (err) {
        logger.error('Owner notification failed to queue', { bookingId: bookingRef.id, error: err.message });
    }

    logger.info('Booking held', { bookingId: bookingRef.id, slot: start.toISOString() });

    return {
        ok: true,
        bookingId: bookingRef.id,
        reference: mailer.reference(bookingRef.id),
        slotStartIso: start.toISOString(),
        holdExpiresIso: holdExpiresAt.toISOString()
    };
});

/* ---- decideBooking (admin) --------------------------------------------- */

exports.decideBooking = onCall({ cors: true }, async (request) => {
    requireAdmin(request);
    const { bookingId, decision, declineReasonId, declineMessage, note } = request.data || {};

    if (!bookingId || typeof bookingId !== 'string') {
        throw new HttpsError('invalid-argument', 'bookingId is required.');
    }
    if (!['accept', 'decline', 'cancel'].includes(decision)) {
        throw new HttpsError('invalid-argument', 'decision must be accept, decline or cancel.');
    }

    const bookingRef = db.collection('bookings').doc(bookingId);
    const snap = await bookingRef.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Booking not found.');
    const booking = snap.data();

    if (decision === 'accept' && !DECIDABLE.includes(booking.status)) {
        throw new HttpsError('failed-precondition', `Booking is already ${booking.status}.`);
    }
    if (decision === 'decline' && !DECIDABLE.includes(booking.status)) {
        throw new HttpsError('failed-precondition', `Booking is already ${booking.status}.`);
    }
    if (decision === 'cancel' && booking.status !== 'accepted') {
        throw new HttpsError('failed-precondition', 'Only an accepted booking can be cancelled.');
    }

    const settings = await loadSettings(db);
    const slot = resolveSlot(booking, settings);
    // A legacy booking has no lock, so derive its key and start holding the
    // slot properly from the moment it is decided.
    const lockKey = booking.slotKey || slotKey(slot.start.toDate());
    const lockRef = db.collection('slotLocks').doc(lockKey);
    const now = admin.firestore.FieldValue.serverTimestamp();

    // Everything downstream reads slotStart/slotEnd, so hand it a document
    // that has them whichever era the booking came from.
    const resolved = Object.assign({}, booking, { slotStart: slot.start, slotEnd: slot.end });

    if (decision === 'accept') {
        let calendarEventId = null;
        try {
            calendarEventId = await createBookingEvent({
                calendarId: settings.calendarId,
                booking: resolved,
                bookingId,
                addressLine: mailer.BUSINESS_ADDRESS
            });
        } catch (err) {
            logger.error('Calendar event creation failed', { bookingId, error: err.message });
            // Surfaced rather than swallowed: if the event is not in the
            // diary, "accepted" would be a lie and he could double-book.
            throw new HttpsError('internal',
                `Could not create the calendar event: ${err.message}. The booking is unchanged.`);
        }

        // Claim the lock and flip the booking in one transaction, checking
        // the lock still belongs to this booking. If this hold expired and
        // another customer has since taken the slot, accepting the old
        // request would double-book them — refuse it instead.
        try {
            await db.runTransaction(async (tx) => {
                const lockSnap = await tx.get(lockRef);
                if (lockSnap.exists) {
                    const l = lockSnap.data() || {};
                    const activeHold = l.status === 'held'
                        && l.expiresAt && l.expiresAt.toDate().getTime() >= Date.now();
                    if ((l.status === 'accepted' || activeHold)
                        && l.bookingId && l.bookingId !== bookingId) {
                        throw new HttpsError('failed-precondition',
                            'That slot is now held by a different booking request. '
                            + 'Decline this one, or decide the other request first.');
                    }
                }
                tx.set(lockRef, {
                    bookingId,
                    status: 'accepted',
                    slotStart: slot.start,
                    slotEnd: slot.end,
                    expiresAt: null,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
                tx.update(bookingRef, {
                    status: 'accepted',
                    calendarEventId,
                    decidedAt: admin.firestore.FieldValue.serverTimestamp(),
                    respondedAt: admin.firestore.FieldValue.serverTimestamp(),
                    slotStart: slot.start,
                    slotEnd: slot.end,
                    slotKey: lockKey,
                    adminNotes: typeof note === 'string' ? note.slice(0, 500) : (booking.adminNotes || '')
                });
            });
        } catch (err) {
            // The event went in the diary before the claim failed — take it
            // back out so the calendar matches what actually happened.
            await deleteEvent({ calendarId: settings.calendarId, eventId: calendarEventId });
            throw err;
        }

        try {
            const fresh = await bookingRef.get();
            await db.collection('mail').add(
                mailer.customerAccepted({ booking: fresh.data(), bookingId })
            );
        } catch (err) {
            logger.error('Confirmation email failed to queue', { bookingId, error: err.message });
        }

        logger.info('Booking accepted', { bookingId, calendarEventId });
        return { ok: true, status: 'accepted', calendarEventId };
    }

    if (decision === 'cancel') {
        if (booking.calendarEventId) {
            await deleteEvent({ calendarId: settings.calendarId, eventId: booking.calendarEventId });
        }
        await bookingRef.update({ status: 'cancelled', decidedAt: now });
        await lockRef.set({ status: 'released', updatedAt: now }, { merge: true });
        logger.info('Booking cancelled', { bookingId });
        return { ok: true, status: 'cancelled' };
    }

    // decline
    let reasonLabel = 'Not available';
    let reasonBody = typeof declineMessage === 'string' ? declineMessage.slice(0, 1000) : '';
    if (declineReasonId) {
        try {
            const r = await db.collection('declineReasons').doc(String(declineReasonId)).get();
            if (r.exists) {
                const rd = r.data() || {};
                reasonLabel = rd.label || reasonLabel;
                if (!reasonBody) reasonBody = rd.emailBody || '';
            }
        } catch (err) {
            logger.warn('Decline reason lookup failed', { declineReasonId, error: err.message });
        }
    }

    await bookingRef.update({
        status: 'declined',
        decidedAt: now,
        respondedAt: now,
        declineReason: { id: declineReasonId || null, label: reasonLabel, message: reasonBody }
    });
    await lockRef.set({ status: 'released', updatedAt: now }, { merge: true });

    try {
        const fresh = await bookingRef.get();
        await db.collection('mail').add(
            mailer.customerDeclined({
                booking: Object.assign({}, fresh.data(), { slotStart: slot.start, slotEnd: slot.end }),
                bookingId, reasonLabel, reasonBody
            })
        );
    } catch (err) {
        logger.error('Decline email failed to queue', { bookingId, error: err.message });
    }

    logger.info('Booking declined', { bookingId, reasonLabel });
    return { ok: true, status: 'declined' };
});

/* ---- getCalendarEvents (admin) ----------------------------------------- */

exports.getCalendarEvents = onCall({ cors: true }, async (request) => {
    requireAdmin(request);
    const data = request.data || {};
    const settings = await loadSettings(db);
    const { from, to } = clampRange(data.from, data.to, settings);

    const result = await listEvents({
        calendarId: settings.calendarId,
        timeMin: new Date(`${from}T00:00:00Z`),
        timeMax: new Date(`${addDaysToDateKey(to, 1)}T00:00:00Z`)
    });

    return { ok: result.ok, events: result.events, error: result.error || null };
});

/* ---- releaseExpiredHolds (scheduled) ----------------------------------- */

exports.releaseExpiredHolds = onSchedule({
    schedule: 'every 60 minutes',
    timeZone: TZ,
    region: 'europe-west2'
}, async () => {
    const now = admin.firestore.Timestamp.now();
    const stale = await db.collection('bookings')
        .where('status', '==', 'held')
        .where('holdExpiresAt', '<=', now)
        .limit(200)
        .get();

    if (stale.empty) {
        logger.info('No expired holds');
        return;
    }

    // Read each lock before releasing it: an expired hold's slot may have
    // been taken over by a newer booking, and releasing that newer lock
    // would put a held slot back on sale.
    const entries = stale.docs.map((doc) => ({
        doc,
        lockRef: (doc.data() || {}).slotKey
            ? db.collection('slotLocks').doc(doc.data().slotKey)
            : null
    }));
    const lockRefs = entries.filter((e) => e.lockRef).map((e) => e.lockRef);
    const lockSnaps = lockRefs.length ? await db.getAll(...lockRefs) : [];
    const lockById = {};
    lockSnaps.forEach((snap) => { lockById[snap.ref.path] = snap; });

    const batch = db.batch();
    let released = 0;
    entries.forEach(({ doc, lockRef }) => {
        batch.update(doc.ref, { status: 'expired', decidedAt: now });
        if (!lockRef) return;
        const lockSnap = lockById[lockRef.path];
        const l = (lockSnap && lockSnap.exists) ? lockSnap.data() : null;
        if (!l || l.bookingId === doc.id) {
            batch.set(lockRef, { status: 'released', updatedAt: now }, { merge: true });
            released++;
        }
    });
    await batch.commit();
    logger.info('Released expired holds', { expired: stale.size, locksReleased: released });
});
