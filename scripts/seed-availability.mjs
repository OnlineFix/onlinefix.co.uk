#!/usr/bin/env node
/* Seed the availability/settings singleton document used by the booking
   page (/book/) and the admin availability manager (/admin/availability.html).

   The booking time picker reads this document to grey out closed days,
   blocked dates, and slots within the minimum-notice window. It must
   exist before /book/ goes live or the picker will refuse to render
   any slots.

   Run once on a trusted machine. Subsequent edits should happen via
   /admin/availability.html (Phase 4), not this script.

   Setup (same as set-admin-claim.mjs):
     1. npm i firebase-admin
     2. Download a service-account JSON from
        https://console.firebase.google.com/project/onlinefix-repair/settings/serviceaccounts/adminsdk
        (`service-account*.json` is gitignored.)

   Run:
     GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
     node scripts/seed-availability.mjs

   To overwrite existing settings (e.g. if you've corrupted the doc and
   want a clean reset):
     OVERWRITE=1 node scripts/seed-availability.mjs
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

const ref = db.collection('availability').doc('settings');
const snap = await ref.get();

if (snap.exists && !overwrite) {
    console.log('availability/settings already exists. Re-run with OVERWRITE=1 to replace it.');
    console.log('Current value:', JSON.stringify(snap.data(), null, 2));
    process.exit(0);
}

const defaults = {
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
    updatedAt: FieldValue.serverTimestamp()
};

await ref.set(defaults);
console.log(`${overwrite ? 'Overwrote' : 'Created'} availability/settings with defaults:`);
console.log(JSON.stringify(defaults, null, 2));
