'use strict';

/* The availability engine.

   One question, asked a lot: "is this slot bookable?" Four things have to
   agree before the answer is yes, and they are layered deliberately so that
   the admin dashboard always has the last word:

     manual block  >  manual open  >  calendar busy  >  working hours

   Read that as: working hours describe the normal week; a manual open can add
   time the normal week does not cover (a Sunday, a late evening); the live
   Google Calendar removes anything already committed; and a manual block
   removes time regardless of everything else.

   All arithmetic happens in minutes-since-midnight in London wall-clock time,
   and only converts to absolute instants at the very end. Doing it the other
   way round makes the BST changeover shift the working day by an hour.
*/

const {
    dayKeyForDate, dateKeyRange, londonToUtc, toMinutes, fromMinutes
} = require('./time');

const DEFAULT_SETTINGS = {
    workingHours: {
        mon: { open: '10:00', close: '18:00', closed: false },
        tue: { open: '10:00', close: '18:00', closed: false },
        wed: { open: '10:00', close: '18:00', closed: false },
        thu: { open: '10:00', close: '18:00', closed: false },
        fri: { open: '10:00', close: '18:00', closed: false },
        sat: { open: '11:00', close: '16:00', closed: false },
        sun: { open: '00:00', close: '00:00', closed: true }
    },
    blockedDates: [],
    minNoticeHours: 4,
    maxFutureDays: 60,
    slotIntervalMinutes: 30,
    appointmentMinutes: 30,
    bufferMinutes: 0,
    holdExpiryHours: 48,
    calendarId: 'onlinerepairbooking@gmail.com'
};

async function loadSettings(db) {
    let stored = {};
    try {
        const snap = await db.collection('availability').doc('settings').get();
        if (snap.exists) stored = snap.data() || {};
    } catch (err) {
        // Fall through to defaults; the caller surfaces the degraded state.
    }
    const merged = Object.assign({}, DEFAULT_SETTINGS, stored);
    merged.workingHours = Object.assign({}, DEFAULT_SETTINGS.workingHours, stored.workingHours || {});
    // appointmentMinutes was added after the first release; older settings
    // documents only carry slotIntervalMinutes.
    if (!stored.appointmentMinutes) merged.appointmentMinutes = merged.slotIntervalMinutes;
    return merged;
}

async function loadOverrides(db, dateKeys) {
    const out = {};
    if (!dateKeys.length) return out;
    // getAll is one round trip regardless of range width, and the horizon can
    // legitimately be 60+ days.
    const refs = dateKeys.map((k) => db.collection('availabilityOverrides').doc(k));
    const snaps = await db.getAll(...refs);
    snaps.forEach((snap) => {
        if (snap.exists) out[snap.id] = snap.data() || {};
    });
    return out;
}

/* ---- interval maths (minutes since midnight, [start, end)) ------------- */

function normalise(intervals) {
    const clean = intervals
        .filter((i) => i && Number.isFinite(i.start) && Number.isFinite(i.end) && i.end > i.start)
        .sort((a, b) => a.start - b.start);
    const out = [];
    clean.forEach((i) => {
        const last = out[out.length - 1];
        if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
        else out.push({ start: i.start, end: i.end });
    });
    return out;
}

function subtract(intervals, cuts) {
    let work = normalise(intervals);
    normalise(cuts).forEach((cut) => {
        const next = [];
        work.forEach((iv) => {
            if (cut.end <= iv.start || cut.start >= iv.end) { next.push(iv); return; }
            if (cut.start > iv.start) next.push({ start: iv.start, end: cut.start });
            if (cut.end < iv.end) next.push({ start: cut.end, end: iv.end });
        });
        work = next;
    });
    return work;
}

function parseIntervalList(list) {
    if (!Array.isArray(list)) return [];
    return list.map((r) => {
        const start = toMinutes(r && r.start);
        const end = toMinutes(r && r.end);
        return (start === null || end === null) ? null : { start, end };
    }).filter(Boolean);
}

/* Open intervals for one calendar date, before the live calendar is consulted. */
function openIntervalsForDate(dateKey, settings, override) {
    const ov = override || {};

    // A whole-day manual close beats everything.
    if (ov.closed === true) return [];

    const manualOpens = parseIntervalList(ov.opens);
    const manualBlocks = parseIntervalList(ov.blocks);

    let base = [];
    const blockedByLegacyList = (settings.blockedDates || []).includes(dateKey);
    if (!blockedByLegacyList) {
        const hours = (settings.workingHours || {})[dayKeyForDate(dateKey)];
        if (hours && !hours.closed) {
            const start = toMinutes(hours.open);
            const end = toMinutes(hours.close);
            if (start !== null && end !== null && end > start) base.push({ start, end });
        }
    }

    // Manual opens extend the day, and are the only way to open a date the
    // weekly pattern (or the legacy blockedDates list) says is shut.
    base = normalise(base.concat(manualOpens));

    // Manual blocks are applied last so they win over an open on the same day.
    return subtract(base, manualBlocks);
}

/* ---- the main computation --------------------------------------------- */

/* Returns availability per date across [fromKey, toKey].

   `busy` is the list of {start, end} Dates from Google Calendar; `occupied`
   is the same shape for slots already held or booked in Firestore. Both are
   absolute instants, so they are compared after the slot has been converted
   out of wall-clock time. */
function computeDays({ fromKey, toKey, settings, overrides, busy, occupied, now }) {
    const interval = Math.max(5, Number(settings.slotIntervalMinutes) || 30);
    const appointment = Math.max(5, Number(settings.appointmentMinutes) || interval);
    const buffer = Math.max(0, Number(settings.bufferMinutes) || 0);
    const minNoticeMs = (Number(settings.minNoticeHours) || 0) * 3600 * 1000;
    const earliest = new Date(now.getTime() + minNoticeMs);
    const horizon = new Date(now.getTime() + (Number(settings.maxFutureDays) || 60) * 86400000);

    const overlaps = (aStart, aEnd, list) => list.some((b) => aStart < b.end && aEnd > b.start);

    return dateKeyRange(fromKey, toKey).map((dateKey) => {
        const override = overrides[dateKey];
        const ignoreCalendar = Boolean(override && override.ignoreCalendarBusy);
        const intervals = openIntervalsForDate(dateKey, settings, override);

        const slots = [];
        intervals.forEach((iv) => {
            for (let m = iv.start; m + appointment <= iv.end; m += interval) {
                const time = fromMinutes(m);
                const start = londonToUtc(dateKey, time);
                if (!start) continue;
                const end = new Date(start.getTime() + appointment * 60000);

                // Buffer widens the window we test for clashes, not the
                // appointment itself — the customer is still booked for
                // `appointment` minutes.
                const guardStart = new Date(start.getTime() - buffer * 60000);
                const guardEnd = new Date(end.getTime() + buffer * 60000);

                let reason = null;
                if (start < earliest) reason = 'notice';
                else if (start > horizon) reason = 'horizon';
                else if (overlaps(guardStart, guardEnd, occupied)) reason = 'taken';
                else if (!ignoreCalendar && overlaps(guardStart, guardEnd, busy)) reason = 'calendar';

                slots.push({
                    time,
                    startIso: start.toISOString(),
                    endIso: end.toISOString(),
                    available: reason === null,
                    reason
                });
            }
        });

        return {
            date: dateKey,
            open: intervals.length > 0,
            hasAvailability: slots.some((s) => s.available),
            manualOpen: Boolean(override && Array.isArray(override.opens) && override.opens.length),
            manualBlock: Boolean(override && (override.closed === true
                || (Array.isArray(override.blocks) && override.blocks.length))),
            ignoreCalendarBusy: ignoreCalendar,
            slots
        };
    });
}

/* Slots already spoken for, read from the lock collection rather than from
   `bookings`, so a held slot blocks the calendar the instant the transaction
   commits. */
async function loadOccupied(db, fromDate, toDate) {
    const snap = await db.collection('slotLocks')
        .where('slotStart', '>=', fromDate)
        .where('slotStart', '<=', toDate)
        .get();
    const now = Date.now();
    const out = [];
    snap.forEach((doc) => {
        const d = doc.data() || {};
        if (d.status === 'released') return;
        // A hold whose expiry has passed but which the sweep has not yet
        // collected must not keep blocking the slot.
        if (d.status === 'held' && d.expiresAt && d.expiresAt.toDate().getTime() < now) return;
        if (!d.slotStart || !d.slotEnd) return;
        out.push({ start: d.slotStart.toDate(), end: d.slotEnd.toDate() });
    });
    return out;
}

module.exports = {
    DEFAULT_SETTINGS,
    loadSettings,
    loadOverrides,
    loadOccupied,
    openIntervalsForDate,
    computeDays,
    normalise,
    subtract,
    parseIntervalList
};
