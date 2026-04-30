#!/usr/bin/env node
/* Grant or revoke the {admin: true} custom claim on a Firebase Auth user.

   The Firestore + Storage rules read `request.auth.token.admin` to gate
   admin-only operations. This script provisions that claim once, after
   which the email-allowlist fallback in firestore.rules can be removed.

   Setup (one-time, on a trusted machine):
     1. npm i -g firebase-admin           (or run `npm i firebase-admin` here)
     2. Download a service-account JSON from
        https://console.firebase.google.com/project/onlinefix-repair/settings/serviceaccounts/adminsdk
        Save it locally — `service-account*.json` is gitignored.

   Run:
     GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
     ADMIN_EMAIL=onlinerepairbooking@gmail.com \
     node scripts/set-admin-claim.mjs

   To revoke instead of grant:
     ADMIN_EMAIL=... REVOKE=1 node scripts/set-admin-claim.mjs

   After granting, the admin must sign out and back in (or the dashboard
   will force a token refresh on next sign-in) for the new claim to land
   in their ID token.
*/

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const email = process.env.ADMIN_EMAIL;
if (!email) {
    console.error('ADMIN_EMAIL env var is required.');
    process.exit(1);
}
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('GOOGLE_APPLICATION_CREDENTIALS env var is required (path to service-account JSON).');
    process.exit(1);
}

const revoke = process.env.REVOKE === '1';

initializeApp({ credential: applicationDefault() });

const auth = getAuth();
const user = await auth.getUserByEmail(email);

const existing = user.customClaims || {};
const next = { ...existing };
if (revoke) delete next.admin;
else next.admin = true;

await auth.setCustomUserClaims(user.uid, next);

console.log(`${revoke ? 'Revoked' : 'Granted'} admin claim on ${email} (uid ${user.uid}).`);
console.log('Claims now:', JSON.stringify(next));
console.log('User must sign out and back in to refresh their ID token.');
