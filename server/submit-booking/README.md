# submitBooking

The Cloud Function behind the public booking form (`/book/`). The page POSTs
each booking here as JSON, photos included. The function:

- checks every field (the same checks as the page, and stricter than the old
  Firestore rules) and refuses anything else with `400`. Compressed bodies,
  bodies over 22 MB and bodies with thousands of JSON values are refused
  before they are parsed (see `tightenBodyParsers` in `index.js`);
- limits accepted bookings to 3 an hour and 6 a UK day per visitor, and 40 a
  UK day for the whole site (`429` over any limit). Visitors are counted in
  `bookingLimits` under a salted hash of their address, never the address,
  and old counts are deleted after about two days;
- stores up to three JPEG photos at `bookings/<id>/photo-1.jpg` to
  `photo-3.jpg`, then writes `bookings/<id>` and the shop's email notice
  `mail/<id>` together with the admin SDK.

Visitors cannot write to Firestore or Storage directly any more:
`firestore.rules` and `storage.rules` allow bookings, booking photos and mail
to staff only. The wording of the shop's notice lives in `index.js`.

It is deployed separately, from Google Cloud Shell. (Cloudflare Pages
publishes the whole repository, so these files can also be fetched from the
website; they hold no secrets.)

## Deploy

Everything below runs in Google Cloud Shell (console.cloud.google.com, the
`>_` button), signed in as the project owner. Answer `y` whenever gcloud
offers to turn on an API.

Get the code and go to this folder:

```sh
git clone --depth 1 https://github.com/OnlineFix/onlinefix.co.uk.git
cd onlinefix.co.uk/server/submit-booking
gcloud config set project onlinefix-repair
```

(Before this folder is merged into `main`, clone the branch that holds it:
add `-b <branch>` to the `git clone`.)

One-time setup: a service account that can use Firestore and create (but
not read, replace or delete) Storage objects, and a TTL policy that deletes
old rate-limit counts within a few days even when no booking comes in (each
booking also makes the function delete the ones from before yesterday).
If a binding command says the account does not exist, wait a minute (new
accounts take a moment to appear) and run it again.

```sh
gcloud iam service-accounts create booking-form --project=onlinefix-repair --display-name="Booking form function"
gcloud projects add-iam-policy-binding onlinefix-repair --member=serviceAccount:booking-form@onlinefix-repair.iam.gserviceaccount.com --role=roles/datastore.user --condition=None
gcloud storage buckets add-iam-policy-binding gs://onlinefix-repair.firebasestorage.app --member=serviceAccount:booking-form@onlinefix-repair.iam.gserviceaccount.com --role=roles/storage.objectCreator --condition=None
gcloud firestore fields ttls update expireAt --collection-group=bookingLimits --enable-ttl --project=onlinefix-repair
```

Deploy (again after any change to `index.js`), from this folder:

```sh
gcloud functions deploy submitBooking --project=onlinefix-repair --gen2 --region=europe-west2 --runtime=nodejs22 --source=. --entry-point=submitBooking --trigger-http --allow-unauthenticated --service-account=booking-form@onlinefix-repair.iam.gserviceaccount.com --max-instances=3 --memory=512Mi --timeout=60s
```

If the deploy asks whether to continue because the default build service
account is missing `roles/cloudbuild.builds.builder`, answer `N`, run the
command below with the address from that message, wait a minute, and
deploy again:

```sh
gcloud projects add-iam-policy-binding onlinefix-repair --member=serviceAccount:<the address from the message> --role=roles/cloudbuild.builds.builder --condition=None
```

URL: `https://europe-west2-onlinefix-repair.cloudfunctions.net/submitBooking`

Check it after each deploy: open that URL in a browser. It answers
`{"ok":true,"you":"<address>"}`. Open it on a phone on mobile data too: the
two `you` values must differ (that is the address each visitor is counted
under). If they are the same, or `null`, stop there and do not switch over:
the per-visitor limit would count every visitor as one, or not at all.

Also worth setting once: a budget alert (Billing, Budgets & alerts), so a
flood of refused requests, which each cost a few Firestore reads, shows up
as an email rather than on the bill.

### Switching over from the old direct writes

1. Deploy the function as above and check the URL.
2. Add `https://europe-west2-onlinefix-repair.cloudfunctions.net` to
   `connect-src` in the Cloudflare Transform Rule that sets the site's
   Content-Security-Policy (see the note in `_headers`), or the booking page
   cannot reach the function (every booking then fails with the page's
   "Network issue" message, and nothing shows in the function's logs).
3. Publish the site change (the new `book/booking.js`).
4. Make one real booking at https://onlinefix.co.uk/book/ with a photo.
   Check that it appears on the dashboard with its photo and that the shop's
   email arrives, then remove it on the dashboard.
5. Wait a day, so booking pages opened before step 3 have been closed
   (such a page still writes bookings directly, which the new rules refuse;
   reloading it fixes that). Then paste the new `firestore.rules` and
   `storage.rules` into the Firebase console. Until then the old rules
   still let visitors write bookings directly.
6. The old `throttle/bookingNotice` document is no longer used and can be
   deleted in the Firestore console.

## Environment variables

None are needed in production. For local runs and tests:

| Variable | Default | Use |
|---|---|---|
| `STORAGE_BUCKET` | `onlinefix-repair.firebasestorage.app` | Bucket for the photos |
| `ALLOWED_ORIGINS` | `https://onlinefix.co.uk,https://www.onlinefix.co.uk` | Comma list of page origins allowed to post |
| `GCLOUD_PROJECT`, `FIRESTORE_EMULATOR_HOST`, `FIREBASE_STORAGE_EMULATOR_HOST` | (unset) | Point the admin SDK at the Firebase emulators |

Local run against the emulators:

```sh
npm ci
GCLOUD_PROJECT=demo-local FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199 STORAGE_BUCKET=demo-local.appspot.com \
ALLOWED_ORIGINS=http://localhost:8931 \
npx functions-framework --target=submitBooking --port=8090
```
