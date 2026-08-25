'use strict';

/* Google Calendar access for the booking system.

   AUTH MODEL (important, and different from what the design brief assumed).
   The business account is a consumer gmail.com address, so domain-wide
   delegation does not exist for it. Instead, Tomas shares his calendar with
   this function's own service account, exactly as he would share it with a
   colleague. The function then authenticates as itself using Application
   Default Credentials, which Cloud Functions provides automatically.

   Two consequences worth knowing:
     - No key file. Nothing secret is stored in the repo or in config, so
       there is no refresh token to silently expire after seven days, which
       was the main risk with the OAuth route.
     - No guest invitations. A service account cannot invite attendees
       without domain-wide delegation; attempting it fails the whole insert.
       So we never set `attendees`. The customer's details go in the event
       body, and they receive an .ics attachment from us instead.
*/

const { google } = require('googleapis');
const { TZ } = require('./time');

const SCOPES = ['https://www.googleapis.com/auth/calendar'];

let cachedClient = null;

async function getCalendarClient() {
    if (cachedClient) return cachedClient;
    const auth = new google.auth.GoogleAuth({ scopes: SCOPES });
    const authClient = await auth.getClient();
    cachedClient = google.calendar({ version: 'v3', auth: authClient });
    return cachedClient;
}

/* Busy intervals on the business calendar between two instants.

   Returns [] rather than throwing when the calendar is unreachable. That is a
   deliberate trade: freebusy is one input to slot availability, and Tomas
   confirms every booking by hand before it becomes real. Failing open shows a
   few slots he may have to decline; failing closed shows an empty calendar to
   every customer and silently kills the booking page. The caller is told via
   the returned `ok` flag so it can surface the problem in the dashboard. */
async function getBusy({ calendarId, timeMin, timeMax }) {
    try {
        const cal = await getCalendarClient();
        const res = await cal.freebusy.query({
            requestBody: {
                timeMin: timeMin.toISOString(),
                timeMax: timeMax.toISOString(),
                timeZone: TZ,
                items: [{ id: calendarId }]
            }
        });
        const cals = (res.data && res.data.calendars) || {};
        const entry = cals[calendarId];
        if (!entry) return { ok: false, busy: [], error: 'Calendar not present in freebusy response' };
        if (entry.errors && entry.errors.length) {
            return { ok: false, busy: [], error: entry.errors.map((e) => e.reason).join(', ') };
        }
        const busy = (entry.busy || []).map((b) => ({
            start: new Date(b.start),
            end: new Date(b.end)
        }));
        return { ok: true, busy };
    } catch (err) {
        return { ok: false, busy: [], error: err.message || String(err) };
    }
}

/* Events with their titles, for the admin availability screen only. This is
   never exposed to a public caller — event summaries are private. */
async function listEvents({ calendarId, timeMin, timeMax, maxResults = 250 }) {
    try {
        const cal = await getCalendarClient();
        const res = await cal.events.list({
            calendarId,
            timeMin: timeMin.toISOString(),
            timeMax: timeMax.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
            maxResults,
            timeZone: TZ
        });
        const items = (res.data.items || []).map((e) => ({
            id: e.id,
            summary: e.summary || '(no title)',
            start: e.start && (e.start.dateTime || e.start.date),
            end: e.end && (e.end.dateTime || e.end.date),
            allDay: Boolean(e.start && e.start.date && !e.start.dateTime),
            source: (e.extendedProperties
                && e.extendedProperties.private
                && e.extendedProperties.private.onlinefixBookingId) ? 'booking' : 'calendar'
        }));
        return { ok: true, events: items };
    } catch (err) {
        return { ok: false, events: [], error: err.message || String(err) };
    }
}

/* Create the drop-off event on the business calendar.

   Note the absence of `attendees` — see the auth note at the top of this file.
   The booking id is stamped into private extended properties so the event can
   be found and cancelled later without storing a second mapping. */
async function createBookingEvent({ calendarId, booking, bookingId, addressLine }) {
    const cal = await getCalendarClient();
    const c = booking.customer || {};
    const d = booking.device || {};
    const deviceLabel = [d.brand, d.model].filter(Boolean).join(' ') || d.category || 'Device';

    const description = [
        `Booking reference: ${bookingId.slice(-6).toUpperCase()}`,
        '',
        `Customer: ${c.name || '-'}`,
        `Phone: ${c.phone || '-'}`,
        `Email: ${c.email || '-'}`,
        '',
        `Device: ${deviceLabel}`,
        `Category: ${d.category || '-'}`,
        '',
        'Reported fault:',
        booking.issue || '-',
        '',
        `Booked via onlinefix.co.uk/book/`
    ].join('\n');

    const res = await cal.events.insert({
        calendarId,
        sendUpdates: 'none',
        requestBody: {
            summary: `Repair drop-off — ${c.name || 'Customer'} (${deviceLabel})`,
            description,
            location: addressLine,
            start: { dateTime: booking.slotStart.toDate().toISOString(), timeZone: TZ },
            end: { dateTime: booking.slotEnd.toDate().toISOString(), timeZone: TZ },
            extendedProperties: { private: { onlinefixBookingId: bookingId } },
            reminders: {
                useDefault: false,
                overrides: [{ method: 'popup', minutes: 30 }]
            }
        }
    });
    return res.data.id;
}

async function deleteEvent({ calendarId, eventId }) {
    try {
        const cal = await getCalendarClient();
        await cal.events.delete({ calendarId, eventId, sendUpdates: 'none' });
        return { ok: true };
    } catch (err) {
        // A already-deleted event is not an error worth failing a decline over.
        const code = err && err.code;
        if (code === 404 || code === 410) return { ok: true };
        return { ok: false, error: err.message || String(err) };
    }
}

module.exports = { getCalendarClient, getBusy, listEvents, createBookingEvent, deleteEvent };
