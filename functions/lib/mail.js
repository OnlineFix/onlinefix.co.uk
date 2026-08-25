'use strict';

/* Outbound email.

   These functions never talk to an SMTP server. They write a document into
   the `mail` collection and the already-installed "Trigger Email from
   Firestore" extension does the sending — the same mechanism /new-repair/
   has been using. So switching email provider later is extension config,
   never a code change here.
*/

const { friendlyLondon } = require('./time');

const BUSINESS_NAME = 'OnlineFix';
const BUSINESS_EMAIL = 'hello@onlinefix.uk';
const BUSINESS_PHONE = '07940 730537';
const BUSINESS_ADDRESS = '13 Quarry Street, Guildford, Surrey GU1 3UY';
const SITE = 'https://onlinefix.co.uk';

function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ---- iCalendar ---------------------------------------------------------

   Sent as an attachment because the business account is consumer Gmail: a
   service account cannot invite guests without domain-wide delegation, so
   Google will not send its own invite. An .ics is arguably better anyway —
   it opens in Apple Calendar and Outlook as readily as in Google, and the
   customer gets exactly one email from us rather than two.
*/

function icsEscape(s) {
    return String(s == null ? '' : s)
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\r?\n/g, '\\n');
}

function icsStamp(date) {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/* RFC 5545 caps a content line at 75 octets; longer lines are continued with
   a leading space. Mail clients that enforce this reject unfolded files. */
function fold(line) {
    if (Buffer.byteLength(line, 'utf8') <= 75) return line;
    const out = [];
    let cur = '';
    for (const ch of line) {
        const candidate = cur + ch;
        // 74 leaves room for the leading space on continuation lines.
        if (Buffer.byteLength(candidate, 'utf8') > (out.length ? 74 : 75)) {
            out.push(cur);
            cur = ch;
        } else {
            cur = candidate;
        }
    }
    if (cur) out.push(cur);
    return out.join('\r\n ');
}

function buildIcs({ uid, start, end, summary, description, location }) {
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        `PRODID:-//${BUSINESS_NAME}//Booking//EN`,
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTAMP:${icsStamp(new Date())}`,
        `DTSTART:${icsStamp(start)}`,
        `DTEND:${icsStamp(end)}`,
        `SUMMARY:${icsEscape(summary)}`,
        `DESCRIPTION:${icsEscape(description)}`,
        `LOCATION:${icsEscape(location)}`,
        `ORGANIZER;CN=${icsEscape(BUSINESS_NAME)}:mailto:${BUSINESS_EMAIL}`,
        'STATUS:CONFIRMED',
        'BEGIN:VALARM',
        'TRIGGER:-PT2H',
        'ACTION:DISPLAY',
        'DESCRIPTION:Repair drop-off reminder',
        'END:VALARM',
        'END:VEVENT',
        'END:VCALENDAR'
    ];
    return lines.map(fold).join('\r\n') + '\r\n';
}

/* ---- shared layout ----------------------------------------------------- */

function shell(title, bodyHtml) {
    return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e3e6ea;">
<tr><td style="background:#0033FF;padding:18px 24px;">
<span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:0.5px;">${esc(BUSINESS_NAME)}</span>
</td></tr>
<tr><td style="padding:24px;">
<h1 style="margin:0 0 16px;font-size:20px;color:#0b0e14;">${esc(title)}</h1>
${bodyHtml}
</td></tr>
<tr><td style="padding:16px 24px;background:#fafbfc;border-top:1px solid #e3e6ea;color:#5b6472;font-size:12px;line-height:1.6;">
${esc(BUSINESS_ADDRESS)}<br>
<a href="tel:+447940730537" style="color:#0033FF;text-decoration:none;">${esc(BUSINESS_PHONE)}</a> &middot;
<a href="mailto:${BUSINESS_EMAIL}" style="color:#0033FF;text-decoration:none;">${esc(BUSINESS_EMAIL)}</a><br>
<a href="${SITE}" style="color:#0033FF;text-decoration:none;">onlinefix.co.uk</a>
</td></tr>
</table></td></tr></table></body></html>`;
}

function rows(pairs) {
    return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin:0 0 16px;">${
        pairs.filter(([, v]) => v != null && v !== '').map(([k, v]) => `<tr>
<td style="padding:7px 0;color:#5b6472;font-size:13px;width:34%;vertical-align:top;">${esc(k)}</td>
<td style="padding:7px 0;color:#0b0e14;font-size:14px;font-weight:600;">${esc(v)}</td></tr>`).join('')
    }</table>`;
}

function deviceLabel(device) {
    const d = device || {};
    return [d.brand, d.model].filter(Boolean).join(' ') || d.category || 'Device';
}

function reference(bookingId) {
    return String(bookingId).slice(-6).toUpperCase();
}

/* ---- the three messages ------------------------------------------------ */

/* To Tomas, the moment a request comes in. */
function ownerNotification({ booking, bookingId }) {
    const c = booking.customer || {};
    const when = friendlyLondon(booking.slotStart.toDate());
    const ref = reference(bookingId);
    const body = `
<p style="margin:0 0 16px;color:#3d4552;font-size:14px;line-height:1.6;">
A new booking request is holding a slot. It stays held until you accept or
decline it in the dashboard.</p>
${rows([
    ['Requested slot', when],
    ['Reference', ref],
    ['Name', c.name],
    ['Phone', c.phone],
    ['Email', c.email],
    ['Device', deviceLabel(booking.device)],
    ['Category', (booking.device || {}).category]
])}
<p style="margin:0 0 6px;color:#5b6472;font-size:13px;">Reported fault</p>
<p style="margin:0 0 20px;padding:12px;background:#f4f5f7;border-radius:6px;color:#0b0e14;font-size:14px;line-height:1.6;white-space:pre-wrap;">${esc(booking.issue)}</p>
${(booking.photos || []).length ? `<p style="margin:0 0 20px;color:#5b6472;font-size:13px;">${booking.photos.length} photo(s) attached to the booking &mdash; view them in the dashboard.</p>` : ''}
<p style="margin:0;"><a href="${SITE}/admin/#bookings" style="display:inline-block;background:#0033FF;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:600;font-size:14px;">Open the dashboard</a></p>`;

    return {
        to: [BUSINESS_EMAIL],
        replyTo: c.email || BUSINESS_EMAIL,
        message: {
            subject: `New booking request — ${c.name || 'Customer'}, ${when} (#${ref})`,
            text: [
                'New booking request (slot is held until you decide).',
                '', `Slot:      ${when}`, `Reference: ${ref}`,
                `Name:      ${c.name || '-'}`, `Phone:     ${c.phone || '-'}`,
                `Email:     ${c.email || '-'}`, `Device:    ${deviceLabel(booking.device)}`,
                '', 'Fault:', booking.issue || '-',
                '', `Decide: ${SITE}/admin/#bookings`
            ].join('\n'),
            html: shell('New booking request', body)
        }
    };
}

/* To the customer, once Tomas accepts. Carries the address — deliberately
   not sent before acceptance, since the shop is appointment-only. */
function customerAccepted({ booking, bookingId }) {
    const c = booking.customer || {};
    const start = booking.slotStart.toDate();
    const end = booking.slotEnd.toDate();
    const when = friendlyLondon(start);
    const ref = reference(bookingId);
    const dev = deviceLabel(booking.device);

    const ics = buildIcs({
        uid: `booking-${bookingId}@onlinefix.co.uk`,
        start,
        end,
        summary: `${BUSINESS_NAME} — repair drop-off (${dev})`,
        description: `Booking reference ${ref}\nDevice: ${dev}\n\nBring the device, its charger, and any passcode we will need to test it.\n\n${BUSINESS_PHONE}`,
        location: BUSINESS_ADDRESS
    });

    const body = `
<p style="margin:0 0 16px;color:#3d4552;font-size:14px;line-height:1.6;">
Hi ${esc(c.name || 'there')}, your appointment is confirmed. We have attached a
calendar file so you can add it to your phone in one tap.</p>
${rows([
    ['When', when],
    ['Where', BUSINESS_ADDRESS],
    ['Device', dev],
    ['Reference', ref]
])}
<p style="margin:0 0 6px;color:#5b6472;font-size:13px;">Please bring</p>
<ul style="margin:0 0 20px;padding-left:20px;color:#0b0e14;font-size:14px;line-height:1.7;">
<li>The device and its charger</li>
<li>Any passcode or password we will need to test it</li>
<li>This reference: <strong>${esc(ref)}</strong></li>
</ul>
<p style="margin:0 0 16px;color:#3d4552;font-size:14px;line-height:1.6;">
We are appointment-only, so please let us know as early as you can if you need
to change the time &mdash; just reply to this email or call
<a href="tel:+447940730537" style="color:#0033FF;">${esc(BUSINESS_PHONE)}</a>.</p>`;

    return {
        to: [c.email],
        replyTo: BUSINESS_EMAIL,
        message: {
            subject: `Appointment confirmed — ${when} (#${ref})`,
            text: [
                `Hi ${c.name || 'there'},`, '',
                'Your appointment is confirmed.', '',
                `When:      ${when}`, `Where:     ${BUSINESS_ADDRESS}`,
                `Device:    ${dev}`, `Reference: ${ref}`, '',
                'Please bring the device, its charger, and any passcode we will need to test it.',
                '', `Need to change it? Reply to this email or call ${BUSINESS_PHONE}.`
            ].join('\n'),
            html: shell('Appointment confirmed', body),
            attachments: [{
                filename: 'appointment.ics',
                content: Buffer.from(ics, 'utf8').toString('base64'),
                encoding: 'base64',
                contentType: 'text/calendar; charset=utf-8; method=PUBLISH'
            }]
        }
    };
}

/* To the customer, when Tomas declines. `reasonBody` is editable in the
   dashboard so wording can be tuned without a redeploy. */
function customerDeclined({ booking, bookingId, reasonLabel, reasonBody }) {
    const c = booking.customer || {};
    const when = friendlyLondon(booking.slotStart.toDate());
    const ref = reference(bookingId);
    const explanation = reasonBody
        || 'Unfortunately we are not able to take this appointment.';

    const body = `
<p style="margin:0 0 16px;color:#3d4552;font-size:14px;line-height:1.6;">
Hi ${esc(c.name || 'there')}, thanks for your request for <strong>${esc(when)}</strong>.
We are sorry &mdash; we cannot take that appointment.</p>
<p style="margin:0 0 20px;padding:12px;background:#f4f5f7;border-radius:6px;color:#0b0e14;font-size:14px;line-height:1.6;white-space:pre-wrap;">${esc(explanation)}</p>
<p style="margin:0 0 16px;color:#3d4552;font-size:14px;line-height:1.6;">
That slot is free again for someone else, and you are very welcome to pick a
different time.</p>
<p style="margin:0 0 20px;"><a href="${SITE}/book/" style="display:inline-block;background:#0033FF;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:600;font-size:14px;">Choose another time</a></p>
<p style="margin:0;color:#5b6472;font-size:13px;">Reference ${esc(ref)}</p>`;

    return {
        to: [c.email],
        replyTo: BUSINESS_EMAIL,
        message: {
            subject: `About your booking request for ${when} (#${ref})`,
            text: [
                `Hi ${c.name || 'there'},`, '',
                `Thanks for your request for ${when}. We are sorry - we cannot take that appointment.`,
                '', explanation, '',
                `You are welcome to pick another time: ${SITE}/book/`,
                '', `Reference ${ref}`
            ].join('\n'),
            html: shell('About your booking request', body)
        }
    };
}

module.exports = {
    BUSINESS_ADDRESS, BUSINESS_EMAIL, BUSINESS_NAME, BUSINESS_PHONE,
    buildIcs, ownerNotification, customerAccepted, customerDeclined,
    deviceLabel, reference
};
