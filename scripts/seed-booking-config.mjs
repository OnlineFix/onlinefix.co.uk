#!/usr/bin/env node
/* Seed everything the booking backend needs that nothing else creates:

     availability/settings   the fields added alongside the Cloud Functions
                             (appointment length, buffer, hold expiry,
                             which calendar to read)
     declineReasons/*        the options behind the Decline button — without
                             these the decline flow has nothing to offer

   Safe to re-run. Existing values are left alone unless you ask for them to
   be replaced, so this will not overwrite working hours you have already
   tuned in the dashboard.

   Setup (same as set-admin-claim.mjs):
     1. npm i firebase-admin
     2. Download a service-account JSON from
        https://console.firebase.google.com/project/onlinefix-repair/settings/serviceaccounts/adminsdk
        (`service-account*.json` is gitignored.)

   Run:
     GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
     node scripts/seed-booking-config.mjs

   To rewrite the decline reasons back to these defaults, discarding any
   edits you made in Firestore:
     OVERWRITE=1 node scripts/seed-booking-config.mjs
*/

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('GOOGLE_APPLICATION_CREDENTIALS env var is required (path to service-account JSON).');
    process.exit(1);
}

const overwrite = process.env.OVERWRITE === '1';

initializeApp({ credential: applicationDefault() });
const db = getFirestore();

/* ---- availability/settings -------------------------------------------- */

// Only the fields the backend added. Working hours, blocked dates and the
// notice window are deliberately absent: seed-availability.mjs creates those,
// and by now they are probably set the way he wants them.
const NEW_SETTINGS = {
    appointmentMinutes: 30,   // how long one appointment actually lasts
    bufferMinutes: 0,         // gap required either side of an appointment
    holdExpiryHours: 48,      // how long a request holds its slot undecided
    calendarId: 'onlinerepairbooking@gmail.com'
};

const settingsRef = db.collection('availability').doc('settings');
const settingsSnap = await settingsRef.get();

if (!settingsSnap.exists) {
    console.error('availability/settings does not exist yet.');
    console.error('Run scripts/seed-availability.mjs first, then re-run this.');
    process.exit(1);
}

const current = settingsSnap.data() || {};
const missing = Object.fromEntries(
    Object.entries(NEW_SETTINGS).filter(([k]) => current[k] === undefined)
);

if (Object.keys(missing).length) {
    await settingsRef.set({ ...missing, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    console.log('Added to availability/settings:', JSON.stringify(missing, null, 2));
} else {
    console.log('availability/settings already has every backend field. Left alone.');
}

/* ---- declineReasons ---------------------------------------------------- */

// Document ids are chosen rather than auto-generated: the id is what gets
// recorded against the booking, and `fully-booked` still reads clearly in six
// months where an auto id does not.
const REASONS = {
    'fully-booked': {
        label: 'Fully booked',
        emailBody: 'Sorry — we are fully booked that day. Please pick another time and we will get you in.'
    },
    'closed-that-day': {
        label: 'Closed that day',
        emailBody: 'Sorry, we are closed that day. Please choose another date.'
    },
    'parts-delay': {
        label: 'Parts not available',
        emailBody: 'We do not have the parts for that repair in stock right now. Get in touch and we will tell you when we do.'
    },
    'not-a-repair-we-do': {
        label: 'Not a repair we take on',
        emailBody: 'Sorry, that is not a repair we are able to take on.'
    },
    'need-more-info': {
        label: 'Need more detail first',
        emailBody: 'Before we book you in we need a bit more detail about the fault. Please reply to this email or give us a ring.'
    }
};

let created = 0;
let kept = 0;
for (const [id, data] of Object.entries(REASONS)) {
    const ref = db.collection('declineReasons').doc(id);
    const snap = await ref.get();
    if (snap.exists && !overwrite) { kept++; continue; }
    await ref.set({ ...data, updatedAt: FieldValue.serverTimestamp() });
    created++;
}

console.log(`declineReasons: ${created} written, ${kept} left as they are.`);
if (kept && !overwrite) {
    console.log('Re-run with OVERWRITE=1 to reset them to the defaults above.');
}
console.log('\nDone. Edit the wording any time in Firestore — it is read fresh on every decline.');
