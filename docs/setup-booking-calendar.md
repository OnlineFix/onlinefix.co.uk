# Turning on online booking

The `/book/` page and the Cloud Functions behind it are written. This document
is the wiring they need: a Google Calendar API switch, one calendar share, a
deploy, and one Cloudflare change that is easy to miss and breaks production
silently when you do.

Work through the steps in order. Step 4 is the one that catches people —
everything can work perfectly on your machine and still fail on the live site
until it is done.

---

## How the pieces fit

```
Customer opens /book/
   -> getSlots            reads working hours + overrides + your Google
                          Calendar, returns only genuinely free times
Customer submits
   -> submitBooking       takes the slot in a transaction (two people cannot
                          win the same 10:00), writes bookings/ + slotLocks/,
                          queues you an email
You open /admin/
   -> getCalendarEvents   shows what is already in the diary
   -> decideBooking       Accept: writes the event into Google Calendar and
                          emails the customer an .ics
                          Decline: frees the slot, emails the reason
Nobody decides
   -> releaseExpiredHolds runs hourly, frees slots whose hold ran out
```

Three things are worth knowing up front, because they explain most of the
setup below.

**The functions read your calendar as themselves, not as you.** They do not
log in as `onlinerepairbooking@gmail.com`. They have their own identity, and
you grant it access by sharing your calendar with it — the same screen you
would use to share with a colleague. That is the whole of the authentication
setup. There is no key file, no password, and nothing secret stored in the
repo or in the site.

**The customer is not added as a guest on the calendar event.** That needs a
Google Workspace feature your account does not have (more on this in Step 2),
and attempting it fails the entire event creation. So instead the customer
gets an email from us with an `.ics` attachment. Honestly, this is the better
end of the deal: a Gmail guest invite only works properly for Gmail users,
whereas an `.ics` file adds itself to Outlook, Apple Calendar and Android just
as happily.

**Email is not sent by these functions.** They write a document into the
`mail` collection and the "Trigger Email from Firestore" extension — already
installed, already sending your repair confirmations — picks it up. Exactly
the same mechanism `/new-repair/` uses. So booking emails cost whatever your
SMTP provider costs (nothing, on Gmail or Brevo's free tier), and if an email
ever fails to arrive you debug it the same way as before: read `delivery.error`
on the `mail` document. See `setup-notifications.md`.

### What this costs

Blaze is already on this project, so there is nothing to upgrade.

The free allowance is 2 million function calls a month. A booking that gets
accepted uses about four — loading the times, submitting, your decision, and
the hourly sweep ticking over. Even at 500 bookings a month you are using a
couple of thousand of two million. The realistic bill is **£0.00**, plus a few
pence a month for storing the built function images in Artifact Registry.

**Set a £5/month budget alert anyway** if you have not already. Firebase
console -> the gear icon by *Project Overview* -> **Usage and billing** ->
**Details & settings**, and set the budget there. It exists so that if
something ever goes wrong at 3am you find out by email rather than by card
statement.

---

## Step 1 — Turn on the Google Calendar API

Every Google API is off by default on a new project. Turning one on costs
nothing; it just tells Google this project is allowed to call it.

1. Go to the [Google Cloud console](https://console.cloud.google.com/) and
   make sure the project selector at the top says **onlinefix-repair**. It is
   the same project as Firebase — Firebase is a layer on top of Google Cloud,
   not a separate thing.
2. In the search bar at the top, type **Google Calendar API** and open the
   result under *Marketplace* / *APIs & Services*.
3. Press **Enable**.

It takes a few seconds. If the button already says **Manage** instead of
**Enable**, it is on and you are done here.

If you would rather do it in one line and you have `gcloud` installed:

```
gcloud services enable calendar-json.googleapis.com --project=onlinefix-repair
```

---

## Step 2 — Share your calendar with the function's service account

This is the whole authentication setup. Three terms first, one sentence each.

- A **service account** is a Google account that belongs to a program rather
  than a person. It has an email address, but no password and no inbox. You
  cannot log into it, and you do not want to.
- **IAM** is Google's permission system for the project — who is allowed to do
  what. You will only visit it to *read* the service account's address.
- An **OAuth scope** is the list of things a login is allowed to do. These
  functions ask for one scope, "read and change calendars", and nothing else —
  they cannot touch your Gmail, your Drive, or anything on the account.

The functions authenticate using **Application Default Credentials**, which
means the code asks the machine it is running on "who am I?" and gets back a
short-lived token. Nothing is stored. There is no key file to leak and no
refresh token to expire quietly after a week.

### 2a — Find the exact address

It will almost certainly be:

```
onlinefix-repair@appspot.gserviceaccount.com
```

Do not take my word for it — a wrong address here fails silently, in the worst
way: the booking page keeps working, it just offers times you are busy. Check
it:

1. Google Cloud console, project **onlinefix-repair**.
2. **IAM & Admin** -> **Service Accounts** in the left menu.
3. You will see a short list. The one you want is named **App Engine default
   service account**. Copy its email address exactly as shown.

If there is no App Engine default service account in that list, use the one
named **Default compute service account** instead — it looks like
`123456789-compute@developer.gserviceaccount.com` with your project's number
in front. Either is fine; what matters is that it is the one the functions
actually run as.

After you deploy in Step 3, you can confirm you picked the right one for
certain: Google Cloud console -> **Cloud Run** (2nd-gen functions appear
there) or **Cloud Functions** -> click `getSlots` -> its details page lists
the service account it runs as. If it is not the address you shared with, come
back and share with that one too. Sharing with both costs nothing and takes
ten seconds.

### 2b — Share the calendar

1. Open [Google Calendar](https://calendar.google.com/) signed in as
   **onlinerepairbooking@gmail.com**. This matters — it must be that account's
   own primary calendar, because that is what the booking system is configured
   to read (`calendarId` in the settings document, see Step 7).
2. In the left sidebar under **My calendars**, hover the calendar named after
   the account, click the three dots, choose **Settings and sharing**.
3. Scroll to **Share with specific people or groups** -> **Add people and
   groups**.
4. Paste the service account address from 2a.
5. Set the permission dropdown to **Make changes to events**.
6. **Send** / **Share**.

Google may warn you that the address is outside your contacts, or that it
cannot send an invitation. That is expected — service accounts have no inbox
and nothing to accept. The access is granted immediately regardless. Reload
the settings page and you should see the address listed with "Make changes to
events" next to it.

**Why that permission level and not a lesser one:** the system does three
different things with the calendar. It asks for free/busy times, it lists
event titles for the admin availability screen, and it creates and deletes
drop-off events. Only "Make changes to events" covers all three. "See only
free/busy" is enough for the booking page but leaves the admin screen blank
and makes every Accept fail.

### The thing that is not possible, and why

Your account is a consumer `gmail.com` address, not Google Workspace. There is
a Workspace feature called **domain-wide delegation** where an organisation's
admin authorises a service account to act *as* any user in that organisation.
Consumer Gmail has no organisation and no admin console, so that feature does
not exist for you — not "is fiddly", genuinely does not exist.

The only thing it would have bought is the ability to put the customer on the
event as a guest. Google refuses attendee lists from a service account without
it, and refuses them by failing the *whole* event creation, so the code never
sets attendees. The customer gets our own confirmation email with an `.ics`
attachment instead, which works on every calendar app rather than just Gmail.

---

## Step 3 — Deploy

You need the Firebase CLI once:

```
npm install -g firebase-tools
firebase login
```

Then, from the root of the repo:

```
cd functions
npm install
npm test          # optional, runs the availability engine's unit tests
cd ..
firebase deploy --only functions
```

The functions run on **Node 20** on Google's servers no matter what version
you have locally. If the CLI mentions a mismatch with your local Node, it is a
warning, not a failure.

**The first deploy is the slow one.** Expect several minutes, and expect the
CLI to ask permission to enable a handful of supporting APIs — Cloud Build,
Artifact Registry, Cloud Run, Eventarc, Cloud Scheduler. Say yes to all of
them; they are the machinery that builds and runs the functions. Later deploys
take a minute or two.

It will also create one Cloud Scheduler job, for the hourly hold sweep. Google
gives a small number of scheduler jobs free each month and one job sits inside
that.

You are looking for `Deploy complete!` and a list of the functions. If it
fails, `firebase functions:log` (or `npm run logs` inside `functions/`) is
where the real reason lives.

### Then the Firestore rules and indexes

Two more things have to go up, and neither is included in a functions deploy.

```
firebase deploy --only firestore
```

That one command sends both files named in `firebase.json`:
`firestore.rules` and `firestore.indexes.json`. You can split them with
`--only firestore:rules` and `--only firestore:indexes` if you ever need to.

**The rules** decide who may read what. The functions themselves write
`bookings` and `slotLocks` through the Admin SDK, which ignores rules
entirely — but the admin screens read `bookings`, `availabilityOverrides` and
`declineReasons` as a signed-in user, and every one of those reads is refused
until the matching rules are live. The rules also close `bookings` to direct
browser writes, which is the point of routing everything through
`submitBooking` in the first place.

**The indexes** are what make the admin queries possible at all. Firestore
indexes one field automatically but needs to be told in advance about any
query that filters or sorts on two — "held bookings whose hold has expired",
"bookings for this slot", "this customer's bookings", "newest first by
status". Those four are in `firestore.indexes.json`.

Building them takes a few minutes on an empty database and the console shows
the progress. Until they finish, the queries that need them fail. If you ever
see an index error in the logs, it will contain a direct link that creates
exactly the right index in one click — but everything needed today is already
in the file.

### Never run `firebase deploy` bare

**The site is hosted on Cloudflare, not Firebase Hosting.** Always scope the
deploy:

```
firebase deploy --only functions          # yes
firebase deploy --only firestore          # yes, rules + indexes
firebase deploy                           # no
```

A bare `firebase deploy` pushes everything in `firebase.json` in one go —
functions, Firestore rules and Storage rules together — so a half-finished
rules edit goes live alongside the function you meant to ship. And if a
`hosting` block ever gets added to `firebase.json`, a bare deploy would put a
second, Firebase-hosted copy of the site live and you would have two
deployments of onlinefix.co.uk disagreeing with each other. Scope it every
time.

---

## Step 4 — The Cloudflare CSP change (the one that breaks production)

**Read this even if you are skimming.** Everything can be perfect and the
booking page will still fail on the live site until this is done, with no
error anywhere except the browser console.

A **Content-Security-Policy** is a list of addresses the browser is permitted
to talk to on a page. Anything not on the list is blocked before the request
leaves the machine. The booking page now calls a new address —
`europe-west2-onlinefix-repair.cloudfunctions.net` — which is not on any of
our existing lists.

Our CSP is written down in **three** places, and all three are enforced. The
strictest one wins, so missing one is the same as missing all of them.

| Where | What it covers | Who changes it |
|---|---|---|
| `<meta http-equiv="Content-Security-Policy">` in `book/index.html` and `admin/index.html` | those two pages only | in the repo, by code |
| `_headers` | the whole site | in the repo, by code |
| Cloudflare **Transform Rule** on the zone | the whole site, and **overrides `_headers` in production** | you, in the Cloudflare dashboard |

The first two are code changes and ship with the booking work. Confirm they
happened before you touch Cloudflare:

```
grep -c cloudfunctions _headers book/index.html admin/index.html
```

You want a `1` against all three. A `0` means that file's policy has not been
updated, and no amount of Cloudflare fiddling will fix it — a page's own meta
tag is enforced on top of everything else, so one missing entry blocks that
page on its own. **`admin/index.html` is the one to check twice**: the
customer booking page and the admin screens each carry their own separate
policy, and it is easy to update the customer one and forget that Accept and
Decline call the functions too.

The third one is yours, and it is the trap. It lives only in the Cloudflare
dashboard, nothing in the repo can change it, and because it overrides
`_headers`, the site works perfectly on a local server and fails only on
onlinefix.co.uk.

### Doing it

1. Cloudflare dashboard -> the **onlinefix.co.uk** zone -> **Rules** ->
   **Transform Rules** -> **Modify Response Header**. (Cloudflare moves this
   around between redesigns. If those exact words are not there, you are
   looking for the rule that sets response headers on the zone — the existing
   one will have `Content-Security-Policy` in it, which makes it easy to
   spot.)
2. Open the existing rule that sets `Content-Security-Policy`.
3. Find `connect-src` inside the long value. Add `https://*.cloudfunctions.net`
   to the end of that one directive, before its semicolon. Change nothing
   else — this value is one long string and a stray character disables
   security headers for the entire site.
4. Save and deploy the rule. It takes effect within seconds.

### Checking it took

Open onlinefix.co.uk/book/ in a private window, open the browser console
(F12), and load the page. If you see a red message containing "Refused to
connect" and "Content Security Policy", it has not taken — reread the rule.

One hedge worth knowing: depending on how the functions were deployed, the
browser may call a `*.run.app` address rather than `*.cloudfunctions.net`. If
the console shows a blocked request to something ending `.run.app`, add
`https://*.run.app` to `connect-src` as well, in all three places. Same fix,
different hostname.

---

## Step 5 — Seed the decline reasons

The Decline button reads its options from a Firestore collection called
`declineReasons`. If that collection is empty the button has nothing to offer
and the decline flow is unusable. Nothing creates these for you.

1. Firebase console -> **Firestore Database** -> **Start collection**.
2. Collection ID: `declineReasons` — exactly that, capital R.
3. For each reason, add a document. **Set the Document ID yourself** rather
   than taking the auto-generated one: that id is what gets recorded against
   the booking, and `fully-booked` is readable in six months' time where
   `x7Kd92ncQ` is not.

Fields per document:

Two fields per document, both strings, both spelled exactly like this:

| Field | What it is |
|---|---|
| `label` | The short name you pick from in the decline dialog, and what gets recorded against the booking |
| `emailBody` | The wording the customer actually reads in the email |

`emailBody` is the one people get wrong — not `message`, not `body`. If it is
misnamed the reason still appears in the list, and the customer gets an email
with an empty explanation.

Five that cover most of it:

| Document ID | `label` | `emailBody` |
|---|---|---|
| `fully-booked` | Fully booked | Sorry — we are fully booked that day. Please pick another time and we will get you in. |
| `closed-that-day` | Closed that day | Sorry, we are closed that day. Please choose another date. |
| `parts-delay` | Parts not available | We do not have the parts for that repair in stock right now. Get in touch and we will tell you when we do. |
| `not-a-repair-we-do` | Not a repair we take on | Sorry, that is not a repair we are able to take on. |
| `need-more-info` | Need more detail first | Before we book you in we need a bit more detail about the fault. Please reply to this email or give us a ring. |

Write those in your own voice — they go out to customers exactly as typed.

Before you type all five, do one and decline a test booking with it, so you
see the wording land in a real email.

The reasons are stored rather than hard-coded for a reason: changing how a
"sorry, not that day" email reads is a Firestore edit that takes ten seconds,
not a code change and a redeploy. Rewrite them whenever they start sounding
wrong.

---

## Step 6 — Prove it works end to end

Do this in order. Each step proves one thing, so when something breaks you
know exactly which.

**1. The calendar connection.** Open onlinefix.co.uk/book/ in a private
window. Times should appear. If the page shows a warning that it could not
check the calendar, stop — that is Step 1 or Step 2, not a booking bug.

**2. The sharing actually worked.** This is the important one and it takes a
minute. In Google Calendar, create an event tomorrow afternoon, two hours
long, called anything. Reload /book/. Those two hours should have disappeared
from the offered times. Delete the event, reload again, they come back.

If the times do not disappear, the calendar is not shared with the address the
functions run as. Everything else will look like it works — that is exactly
why this test exists.

**3. A real booking.** Book a slot with your own name, email and phone.

**4. What should exist afterwards.** In the Firebase console -> Firestore:

- a document in `bookings` with status `held`, your details, and the slot
- a document in `slotLocks` for that slot
- a document in `mail` addressed to you. Its `delivery.state` should go to
  `SUCCESS` within a minute. If it says `ERROR`, read `delivery.error` — that
  is the email extension, not the booking system.

Reload /book/ and that slot should now be gone for everyone.

**5. Accept it.** In `/admin/`, accept the booking. Then check Google
Calendar: an event titled `Repair drop-off — Your Name (Device)` at the right
time, with the phone number, email and reported fault in the description, the
shop address as the location, and a 30-minute popup reminder.

**There will be no guest on that event.** That is correct and expected — see
Step 2. Do not go hunting for it.

**6. The customer side.** Check the inbox you booked with. The confirmation
should arrive carrying the shop address and an attachment called
`appointment.ics`. Open it on your phone and confirm it adds itself to your
calendar properly. That attachment is the customer's only
calendar copy, so it is worth seeing it work once with your own eyes.

**7. The decline path.** Make a second test booking and decline it. The
customer email should carry the reason wording you wrote in Step 5, and the
slot should be back on /book/ immediately.

Then delete the test bookings and the test `mail` documents.

---

## Day to day

### The weekly pattern

Lives in the Firestore document `availability/settings`. `admin/seed-
availability.html` writes the defaults if that document does not exist yet.

| Setting | Default | What it does |
|---|---|---|
| `workingHours` | Mon–Fri 10:00–18:00, Sat 11:00–16:00, Sun closed | The normal week |
| `slotIntervalMinutes` | 30 | How often a slot starts |
| `appointmentMinutes` | 30 | How long one takes |
| `bufferMinutes` | 0 | Padding either side when checking for clashes. The customer is still booked for `appointmentMinutes` |
| `minNoticeHours` | 4 | Nobody can book less than this far ahead |
| `maxFutureDays` | 60 | How far ahead the diary is open |
| `holdExpiryHours` | 48 | How long a booking sits `held` before the sweep frees it |
| `calendarId` | `onlinerepairbooking@gmail.com` | Which calendar is read and written. Change this and you must share that calendar too |

### One-off changes

Anything that is not the normal week goes in `availabilityOverrides`, one
document per date, named `YYYY-MM-DD`:

```jsonc
{
  "closed": false,                                  // shut the whole day
  "opens":  [{ "start": "12:00", "end": "16:00" }], // add time — opens a Sunday
  "blocks": [{ "start": "13:00", "end": "14:00" }], // remove time
  "ignoreCalendarBusy": false,                      // book over a busy calendar
  "note": "Bank holiday — half day"
}
```

### The precedence rule

Highest wins:

**manual block -> manual open -> calendar busy -> working hours**

In plain terms: working hours describe the normal week. A manual open adds
time the normal week does not cover — it is the only way to open a Sunday.
Your Google Calendar then removes anything already committed. And a manual
block removes time no matter what any of the others say.

Two consequences that surprise people:

- **A manual block beats a manual open on the same day.** Open 12:00–16:00 and
  block 13:00–14:00 and you get two separate windows, not an argument.
- **`ignoreCalendarBusy` only affects that one date.** Use it for the day your
  calendar is full of things that are not actually shop commitments.

### Holds

A submitted booking is `held`, not confirmed. The slot is blocked from the
instant the transaction commits, so nobody else can take it while it waits for
you. If you neither accept nor decline within `holdExpiryHours`, the hourly
sweep marks it `expired` and gives the slot back.

Status only ever goes: `held` -> `accepted` | `declined` | `expired` |
`cancelled`.

### British Summer Time

You never have to think about it, but know where it is handled: everything
crossing the wire is an absolute UTC instant, and the server does every
conversion to and from UK wall-clock time. The one rule that matters is in the
overrides above — `"start": "13:00"` always means one o'clock as you would say
it out loud, in both summer and winter.

---

## When something goes wrong

| What you see | What it means |
|---|---|
| Booking page shows no times at all, on the live site only | The Cloudflare Transform Rule (Step 4). Open the browser console — a "Refused to connect" message confirms it |
| Booking page works locally, fails on onlinefix.co.uk | Same thing. `_headers` is overridden in production; only the Transform Rule counts there |
| Times appear, but slots you are busy in are still offered | The calendar is not shared with the address the functions actually run as. Recheck Step 2a against the function's own details page |
| Booking page warns it could not check the calendar | Google Calendar API not enabled (Step 1), or the share was removed. Slots shown are working-hours only. Bookings still work — you just have to decline the clashes |
| "Missing or insufficient permissions" in `/admin/` | The Firestore rules are not deployed. `firebase deploy --only firestore` |
| `/admin/` cannot reach the functions, but `/book/` can | `admin/index.html` has its own meta CSP and it is missing `https://*.cloudfunctions.net`. Step 4 |
| An admin list is empty and the logs mention an index | The indexes did not deploy, or are still building. `firebase deploy --only firestore`, then watch the Indexes tab in the Firestore console |
| Accept fails and the booking stays `held` | The calendar share is set to "See all event details" or "See only free/busy". It must be **Make changes to events** |
| Decline dialog has no reasons in it | `declineReasons` is empty or misspelled — capital R (Step 5) |
| Customer says the appointment is not in their calendar | Expected. They get an `.ics` attachment to open, not a guest invite. See Step 2 |
| Customer got no email at all | The email extension, not the booking system. Open the `mail` document in Firestore and read `delivery.error`. See `setup-notifications.md` |
| A slot stays blocked after you declined it | Look at the `slotLocks` document for that slot — it should be `released`. The hourly sweep clears stragglers |
| Someone books a time you had blocked | Check the `availabilityOverrides` document is named exactly `YYYY-MM-DD` for the right date. A typo in the name silently does nothing |
| Deploy fails asking to enable APIs | Say yes. First deploys need Cloud Build, Artifact Registry, Cloud Run, Eventarc and Cloud Scheduler |
| Something failed and none of the above fits | `firebase functions:log`, or `npm run logs` inside `functions/`. The real error is always there |

---

## What gets stored, and where

Additions to the table in `setup-notifications.md`, worth knowing for the ICO
registration.

| Data | Where | Who can read it |
|---|---|---|
| Booking requests — name, email, phone, device, fault, photos | Firestore `bookings` | Admins only. Written by the functions, never by the browser |
| Slot reservations | Firestore `slotLocks` | Functions only |
| Working hours and one-off overrides | Firestore `availability`, `availabilityOverrides` | Settings are publicly readable so the booking page can grey out closed days. No customer data in them |
| Decline reasons | Firestore `declineReasons` | Admins only |
| Customer name, phone, email, fault | The Google Calendar event body | Anyone you have shared that calendar with |

That last row is worth a moment. Accepting a booking copies the customer's
contact details into a Google Calendar event. If you ever share that calendar
with anyone else, you are sharing those details too. Share free/busy only, or
use a separate calendar, if that ever comes up.

`bookings` is deliberately not writable from the browser any more. A page that
can write it directly can also hold every slot in your diary, so all creation
goes through `submitBooking`, which validates the slot server-side first.
