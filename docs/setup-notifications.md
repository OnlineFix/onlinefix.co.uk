# Turning on emails and texts

Everything in `/new-repair/` already builds and queues the messages. This
document is the wiring it needs behind the scenes: an email service, and the
one-tap route for texts.

Work through Part 1 first — it is the only part with any setup. Part 2 needs
nothing installed. Part 3 is the label printer.

---

## Part 1 — Email

### How it works

The intake page never talks to an email provider directly. When a repair is
created it writes two documents into a Firestore collection called `mail`:

| Document | Goes to | Contains |
|---|---|---|
| Customer confirmation | The customer | Repair reference, device, fault, price, tracking link |
| Staff copy | `hello@onlinefix.uk` | Everything above, plus a **Text the customer** button |

A Firebase extension watches that collection and sends anything that lands in
it. So the website's only job is "write a row"; the extension does the sending.

Two things follow from that. If the extension is ever uninstalled the repair
still saves — you just get an on-screen warning that the email did not go. And
switching email provider later means changing extension settings, never
touching the website.

### Step 1 — Put the project on the Blaze plan

The extension runs a Cloud Function, and Cloud Functions need the pay-as-you-go
plan.

1. Open the [Firebase console](https://console.firebase.google.com/) and pick
   the **onlinefix-repair** project.
2. Bottom-left, click the plan name (it will say **Spark**) → **Upgrade** →
   **Blaze**.
3. Add a card.
4. **Set a budget alert while you are there** — £5/month is plenty. Firebase
   will email you long before anything costs real money.

**What this actually costs you:** the free monthly allowance is 2 million
function invocations. One repair uses two. At even 500 repairs a month you are
using 1,000 of 2,000,000. The realistic bill is **£0.00**, and the card exists
so Google has someone to charge if the site is ever hammered. That is why the
budget alert matters more than the plan itself.

### Step 2 — Choose who physically sends the mail

The extension needs an SMTP mailbox to send through. Pick one:

**Option A — Brevo (recommended).** Free tier is 300 emails/day, and it lets
you send properly as `hello@onlinefix.uk` with SPF and DKIM set up on your
domain. That is the difference between landing in the inbox and landing in
spam. Takes about 20 minutes because of the DNS records.

**Option B — Gmail (fastest).** You already have
`onlinerepairbooking@gmail.com`. About 5 minutes. The catch: emails will
visibly come **from that Gmail address**, not from `hello@onlinefix.uk`, unless
you first add `hello@onlinefix.uk` as a verified *Send mail as* alias in Gmail
settings. Gmail also caps free accounts at roughly 500 messages a day.

Start with B if you want it working this afternoon. Move to A when you have a
quiet hour — the switch is four fields in the extension config.

#### If you picked Brevo

1. Sign up at [brevo.com](https://www.brevo.com/) with your onlinefix address.
2. Find **Senders, Domains & Dedicated IPs** → **Domains** → add
   `onlinefix.uk`.
3. Brevo shows you DNS records to add. Add them wherever `onlinefix.uk` DNS
   lives (Cloudflare, most likely). Wait for Brevo to show the domain as
   verified — usually minutes, occasionally hours.
4. Go to **SMTP & API** → **SMTP**. Write down the **server**, **port**,
   **login**, and **master password**. You need all four next.

#### If you picked Gmail

1. Google account → **Security** → turn on **2-Step Verification** if it is not
   already on. App passwords do not exist without it.
2. Same page → **App passwords** → create one, name it `OnlineFix website`.
3. Google shows a 16-character password **once**. Copy it now.
4. Server is `smtp.gmail.com`, port `465`, login is the full Gmail address,
   password is that 16-character string — *not* your normal Gmail password.

### Step 3 — Install the extension

1. Firebase console → **Extensions** (left sidebar) → **Explore Extensions**.
2. Search for **Trigger Email from Firestore** and install it into
   **onlinefix-repair**.
3. Fill in the configuration:

   | Field | Value |
   |---|---|
   | SMTP connection URI | `smtps://LOGIN@SERVER:465` — see note below |
   | SMTP password | The app password / Brevo master password |
   | Email documents collection | `mail` |
   | Default FROM address | `OnlineFix <hello@onlinefix.uk>` |
   | Default REPLY-TO address | `hello@onlinefix.uk` |

   The URI has a fiddly detail: the login itself contains an `@`, and it is not
   the separator. For Gmail the whole thing reads
   `smtps://onlinerepairbooking@gmail.com@smtp.gmail.com:465`. Two `@` signs,
   and that is correct.

4. Leave everything else at its default and install. It takes 3–5 minutes.

### Step 4 — Prove it works

Do not test by booking a fake customer in. Test the plumbing directly:

1. Firebase console → **Firestore Database** → **Start collection** → name it
   `mail`.
2. Add a document with these fields:
   - `to` — type **array**, one string: your own email address
   - `message` — type **map**, containing two strings:
     `subject` = `Test`, `text` = `Testing the extension`
3. Save. Within about a minute the extension adds a `delivery` field to that
   same document.

Read the `delivery.state` field:

- **SUCCESS** — done. Check your inbox, and your spam folder.
- **ERROR** — `delivery.error` says exactly what is wrong. Almost always the
  SMTP URI or the password. Fix the extension config and it retries.
- **Nothing appears at all** — the extension is watching a different collection
  name. It must be `mail`, lowercase.

Once you see SUCCESS, delete the test document and run one real intake.

---

## Part 2 — Texts

### Why there is no SMS service to set up

Being straight with you: **there is no free SMS API in the UK.** Every provider
charges per message once trial credit runs out — Twilio is around 4p a text.
For 200 repairs a month that is roughly £8/month for something your phone
already does for nothing.

There is also a hard blocker: the shop iPad has no SIM, so it physically cannot
send a text no matter what software is on it.

So the flow does this instead:

1. Repair is created on the iPad.
2. A staff email lands at `hello@onlinefix.uk` with a **Text the customer**
   button.
3. You open that email **on your phone** and tap the button.
4. `onlinefix.co.uk/new-repair/text.html` opens, showing the message ready to
   go.
5. Tap **Open Messages** — your Messages app opens with the customer's number
   and the full text already filled in.
6. Press send.

Cost: £0, it comes from your own number, and customers can reply to a human.

**Why the extra page instead of putting the text link straight in the email:**
mail apps strip `sms:` links out of email bodies for security. An ordinary
`https://` link always survives, and once you are on a real web page the `sms:`
link works properly. That bounce is the whole reason `text.html` exists.

### What you get on that page

Four ready-written messages, switchable with one tap:

- **Booked in** — device logged, here is your tracking link
- **Quote ready** — we have looked at it, here is the price
- **Ready to collect** — repaired, come and get it, here is the balance
- **Chasing collection** — friendly nudge

Plus **Copy message** if you would rather paste it into WhatsApp, and **Call
instead**.

You can reach this page for *any* repair, not just a new one, at:

```
https://onlinefix.co.uk/new-repair/text.html?id=REP_...
```

Sign in once on your phone and it stays signed in.

### If you later want it fully automatic

Twilio is the usual choice. Budget ~4p per UK text, and note that it needs a
Cloud Function — the API token must never sit in a web page where anyone
viewing source can read it. Worth doing at maybe 50+ texts a week. Below that,
tapping send yourself is genuinely faster than the setup would be.

---

## Part 3 — DYMO LabelWriter 550

### The one thing to know before buying labels

The 550 range reads a **chip in the label roll** and refuses anything that is
not a genuine DYMO roll. Third-party labels will not feed, whatever the listing
claims. Budget for real DYMO rolls.

### Setting it up

1. Plug the 550 into the **computer**, not the iPad. The 550 is USB-only with
   no AirPrint, so the iPad cannot print to it at all.
2. Install the DYMO driver from dymo.com for that computer.
3. Load a roll. **99012 (89 × 36 mm)** is the size the label page defaults to
   and the one that fits a device best.

### Printing a label

From the confirmation screen, **Print device label**. Or open it directly:

```
https://onlinefix.co.uk/new-repair/label.html?id=REP_...
```

First time only, in the print dialog:

- Printer: **DYMO LabelWriter 550**
- Paper size: the roll you have loaded
- Scale: **100%**
- Margins: **off** / none

Both Safari and Chrome remember these afterwards. The page also remembers which
roll you picked.

The label carries the short reference (`#28FAEB`), customer name, device,
fault, phone, price and date — enough to identify any device on the shelf
without opening the system.

**Not on the label yet:** a QR code. It was left out deliberately rather than
shipped unverified — a QR that scans to the wrong place is worse than no QR.
Worth adding as a small follow-up.

---

## When something goes wrong

| What you see | What it means |
|---|---|
| "Confirmation email could NOT be queued" on the done screen | Firestore rejected the write. The repair itself is saved. Check the extension is installed and the `mail` collection exists. |
| Repair saves, no email arrives, no error | The extension is installed but not sending. Open the `mail` document in Firestore and read `delivery.error`. |
| Emails arrive in spam | Expected on Gmail sending as a different domain. This is what Brevo plus SPF/DKIM fixes. |
| Photo tile says "Failed — tap to retry" | Wi-Fi dropped mid-upload. Tap the tile. You cannot leave the photos step until at least one has saved. |
| "Sign in first" on your phone | Sign in at `onlinefix.co.uk/admin/` once; it persists. |
| Labels will not feed | Non-genuine roll, or the driver is not installed on that computer. |

---

## What gets stored, and where

Worth knowing given the ICO registration.

| Data | Where | Who can read it |
|---|---|---|
| Repair details, customer name, contact, address | Firestore `repairs` | Admins; the customer sees their own via the tracking link |
| Customer directory + repair history | Firestore `customers` | Admins only |
| Device photos | Storage `repairs/{id}/` | Anyone with the link — the tracking page needs this |
| **Signature images** | Storage `consents/{id}/` | **Admins only** |
| Queued emails | Firestore `mail` | Admins only |

The signature is deliberately kept out of the photos folder. Photos have to be
publicly readable so the tracking page can show them; a signature must never
be, so it lives on a separate path that the security rules lock to signed-in
staff.

Each signed agreement records which version of the terms was agreed
(`dropoff-1.0`), so "which terms did they actually sign?" stays answerable
later. **If you change the terms wording in `new-repair/intake.js`, bump
`TERMS_VERSION` in the same file** — otherwise old and new agreements become
indistinguishable.

Unlock codes are stored on the ticket so the repair can be tested. Clear them
from the ticket once the device goes back; there is no reason to keep a
customer's PIN after the job is done.
