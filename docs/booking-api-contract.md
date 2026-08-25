# Booking backend — API contract

Reference for anything that calls the booking Cloud Functions. Everything
below is deployed from `functions/` to **region `europe-west2`** (London).

Client calls use the Firebase callable SDK, which needs
`firebase-functions-compat.js` loaded alongside the other compat scripts:

```js
const fns = firebase.app().functions('europe-west2');
const res = await fns.httpsCallable('getSlots')({ from: '2026-08-25' });
res.data // the payloads below
```

All times crossing the wire are **ISO 8601 UTC instants** (`startIso`).
All dates are **`YYYY-MM-DD` in Europe/London**. Never send a local-time
string and never rebuild an instant from date + time on the client — the
server owns that conversion because of BST.

---

## `getSlots` — public

Computes genuinely bookable slots: working hours, manual overrides, live
Google Calendar free/busy, and existing holds, all resolved server-side.

**Request** `{ from: 'YYYY-MM-DD', to?: 'YYYY-MM-DD' }`
`to` defaults to `from` + horizon, and the range is capped at 62 days.

**Response**
```jsonc
{
  "ok": true,
  "timezone": "Europe/London",
  "calendarOk": true,          // false = calendar unreachable, slots may be stale
  "settings": { "slotIntervalMinutes": 30, "appointmentMinutes": 30,
                "minNoticeHours": 4, "maxFutureDays": 60 },
  "days": [{
    "date": "2026-08-25",
    "open": true,              // any open interval at all that day
    "hasAvailability": true,   // at least one bookable slot
    "slots": [{
      "time": "10:00",                          // London wall clock, for display
      "startIso": "2026-08-25T09:00:00.000Z",   // send THIS back to book
      "endIso":   "2026-08-25T09:30:00.000Z",
      "available": true,
      "reason": null   // when unavailable: notice | horizon | taken | calendar
    }]
  }]
}
```

## `submitBooking` — public

Takes the slot in a Firestore transaction so two people submitting the same
second cannot both win, then emails Tomas.

**Request**
```jsonc
{
  "slotStartIso": "2026-08-25T09:00:00.000Z",
  "customer": { "name": "...", "email": "...", "phone": "..." },
  "device":   { "category": "phone", "brand": "Apple", "model": "iPhone 13" },
  "issue": "...", "extraNotes": "",
  "photos": ["https://..."], "photoPaths": ["bookings/BK_.../photo-1.jpg"],
  "tempId": "BK_..."
}
```
`category` must be one of `phone laptop console tablet desktop other`.

**Response** `{ ok: true, bookingId, reference: "A1B2C3", slotStartIso, holdExpiresIso }`

**Errors** (`code` on the thrown `HttpsError`)
| code | meaning | show the customer |
|---|---|---|
| `already-exists` | slot taken while they were filling the form | "Just gone — pick another time" |
| `failed-precondition` | slot is not bookable (closed, too soon, calendar clash) | "That time isn't available any more" |
| `invalid-argument` | validation failed | the specific field message |

## `decideBooking` — admin only

**Request** `{ bookingId, decision: 'accept' | 'decline', declineReasonId?, declineMessage?, note? }`

- **accept** — creates the Google Calendar event, sets status `accepted`,
  emails the customer a confirmation with the shop address and an `.ics`
  attachment.
- **decline** — releases the slot, sets status `declined`, emails the chosen
  reason.

**Response** `{ ok: true, status, calendarEventId? }`

## `getCalendarEvents` — admin only

Existing calendar commitments, so the availability screen can show what is
already in the diary. Event titles are private — this is never callable by
the public.

**Request** `{ from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }`
**Response** `{ ok, events: [{ id, summary, start, end, allDay, source }] }`
`source` is `booking` for events this system created, `calendar` for
everything else.

## `releaseExpiredHolds` — scheduled, hourly

Frees slots whose hold expired without a decision and marks the booking
`expired`. Nothing calls this directly.

---

## Firestore collections

| Path | Who can read | Who can write |
|---|---|---|
| `availability/settings` | public | admin |
| `availabilityOverrides/{YYYY-MM-DD}` | admin | admin |
| `declineReasons/{id}` | admin | admin |
| `bookings/{id}` | admin | **functions only** |
| `slotLocks/{slotKey}` | nobody | **functions only** |
| `mail/{id}` | admin | functions + admin |

`bookings` is no longer publicly creatable. That is deliberate: a client that
can write it directly can hold every slot in the diary. All creation goes
through `submitBooking`, which validates the slot server-side.

### `availabilityOverrides/{YYYY-MM-DD}`
```jsonc
{
  "closed": false,                                  // shut the whole day
  "opens":  [{ "start": "12:00", "end": "16:00" }], // add time (can open a Sunday)
  "blocks": [{ "start": "13:00", "end": "14:00" }], // remove time, beats opens
  "ignoreCalendarBusy": false,                      // book over a busy calendar
  "note": "Bank holiday — half day"
}
```

Precedence, highest first: **manual block → manual open → calendar busy →
working hours.**

### `bookings/{id}` status
`held` → `accepted` | `declined` | `expired` | `cancelled`

Bookings taken before this backend existed carry status **`pending`** and a
`preferredAt` instead of `slotStart`/`slotEnd`/`slotKey`. `decideBooking`
accepts them as readily as a `held` one — it derives the appointment window
from `preferredAt` plus `appointmentMinutes`, and writes the missing fields
back on accept. Anything listing bookings should therefore treat `pending`
and `held` as the same "awaiting your decision" bucket, and must not assume
`slotStart` exists.
