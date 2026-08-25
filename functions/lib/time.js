'use strict';

/* Europe/London time handling.
   
   Everything the customer sees is UK wall-clock time ("Thursday 14:30").
   Everything Firestore and Google Calendar store is an absolute instant.
   Converting between the two is the single most common source of bugs in a
   booking system, because the UK is UTC+0 in winter and UTC+1 in summer, and
   the changeover lands mid-year. The business calendar is also set to UTC
   rather than Europe/London, so we cannot lean on the calendar's own zone.

   The rule in this file: never construct a Date from local server time.
   Cloud Functions run in UTC, a developer's laptop does not, and any code
   that relies on the host zone will behave differently in the two places.
*/

const TZ = 'Europe/London';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/* Milliseconds that must be added to a UTC instant to get the wall-clock
   reading in `timeZone` at that instant. +3600000 during BST, 0 in GMT. */
function tzOffsetMs(date, timeZone = TZ) {
    const dtf = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const p = {};
    for (const part of dtf.formatToParts(date)) p[part.type] = part.value;
    // en-GB with hour12:false renders midnight as "24" in some ICU versions.
    const hour = p.hour === '24' ? 0 : Number(p.hour);
    const asUTC = Date.UTC(
        Number(p.year), Number(p.month) - 1, Number(p.day),
        hour, Number(p.minute), Number(p.second)
    );
    return asUTC - date.getTime();
}

/* London wall-clock ("2026-08-25", "14:30") -> absolute UTC Date.

   Solved by iteration rather than a lookup table: guess that the wall-clock
   reading is UTC, measure the offset actually in force at that guess, and
   correct. Two passes converge everywhere except inside the one-hour gap in
   spring, where the requested time does not exist at all; a third pass keeps
   that case stable rather than oscillating. */
function londonToUtc(dateStr, timeStr, timeZone = TZ) {
    const [y, m, d] = String(dateStr).split('-').map(Number);
    const [hh, mm] = String(timeStr).split(':').map(Number);
    if (!Number.isFinite(y) || !Number.isFinite(hh)) return null;
    const naive = Date.UTC(y, m - 1, d, hh, mm, 0, 0);
    let ts = naive;
    for (let i = 0; i < 3; i++) ts = naive - tzOffsetMs(new Date(ts), timeZone);
    return new Date(ts);
}

/* Absolute instant -> London wall-clock pieces. */
function londonParts(date, timeZone = TZ) {
    const dtf = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit'
    });
    const p = {};
    for (const part of dtf.formatToParts(date)) p[part.type] = part.value;
    const hour = p.hour === '24' ? '00' : p.hour;
    return {
        date: `${p.year}-${p.month}-${p.day}`,
        time: `${hour}:${p.minute}`
    };
}

function londonDateKey(date, timeZone = TZ) {
    return londonParts(date, timeZone).date;
}

function londonTimeLabel(date, timeZone = TZ) {
    return londonParts(date, timeZone).time;
}

/* Day-of-week key for a plain YYYY-MM-DD. Uses UTC arithmetic on the date
   parts alone, so it is not affected by any zone. */
function dayKeyForDate(dateStr) {
    const [y, m, d] = String(dateStr).split('-').map(Number);
    return DAY_KEYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/* Add whole days to a YYYY-MM-DD, staying in calendar-date space. */
function addDaysToDateKey(dateStr, n) {
    const [y, m, d] = String(dateStr).split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d));
    t.setUTCDate(t.getUTCDate() + n);
    return isoDateKey(t);
}

function isoDateKey(date) {
    return [
        date.getUTCFullYear(),
        String(date.getUTCMonth() + 1).padStart(2, '0'),
        String(date.getUTCDate()).padStart(2, '0')
    ].join('-');
}

/* Inclusive list of YYYY-MM-DD between two date keys. */
function dateKeyRange(fromKey, toKey) {
    const out = [];
    let cur = fromKey;
    // Hard ceiling so a bad input cannot spin forever inside a function.
    for (let i = 0; i < 400 && cur <= toKey; i++) {
        out.push(cur);
        cur = addDaysToDateKey(cur, 1);
    }
    return out;
}

/* "HH:MM" -> minutes since midnight. */
function toMinutes(timeStr) {
    const [h, m] = String(timeStr).split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m;
}

function fromMinutes(mins) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/* Human label for emails and the dashboard: "Thursday 27 August, 2:30pm". */
function friendlyLondon(date, timeZone = TZ) {
    const dtf = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        weekday: 'long', day: 'numeric', month: 'long',
        hour: 'numeric', minute: '2-digit', hour12: true
    });
    return dtf.format(date).replace(/\s?[ap]m/i, (s) => s.trim().toLowerCase());
}

module.exports = {
    TZ,
    DAY_KEYS,
    tzOffsetMs,
    londonToUtc,
    londonParts,
    londonDateKey,
    londonTimeLabel,
    dayKeyForDate,
    addDaysToDateKey,
    isoDateKey,
    dateKeyRange,
    toMinutes,
    fromMinutes,
    friendlyLondon
};
