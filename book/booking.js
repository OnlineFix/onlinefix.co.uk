/* /book/ — Customer booking flow.
   Vanilla JS, no build step, Firebase compat v9.22.0 (matches the rest of the
   site), used here only to read the availability settings. The page never
   writes to Firestore or Storage: submitBooking() posts the booking, photos
   included, to the submitBooking Cloud Function (server/submit-booking/),
   which checks every field, rate-limits, and writes the booking, its photos
   and the shop's email with the admin SDK. App Check is not used on this
   page (see the note below and in /book/index.html).

   State lives in `state` and survives validation errors (intentional — the
   user spec is explicit that we never lose form data on error).

   Steps 1-5 are the form. Step 6 is the post-submit confirmation. The fields
   array on each step lists what gets validated when the user clicks Next.
*/
(function () {
    'use strict';

    // If the Firebase SDK failed to load (CDN unreachable, blocked, etc.)
    // the rest of this module would throw and leave the page stuck on
    // "Loading the booking form...". Swap that for clear contact options.
    function showBookingUnavailable() {
        var note = document.getElementById('booking-loading');
        if (!note) return;
        note.innerHTML = 'The online booking form couldn\'t load right now. '
            + 'Please call <a href="tel:+447940730537">07940 730537</a> or '
            + '<a href="https://wa.me/447940730537" target="_blank" rel="noopener noreferrer">message us on WhatsApp</a> '
            + 'to book your drop-off.';
    }

    if (typeof firebase === 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', showBookingUnavailable);
        } else {
            showBookingUnavailable();
        }
        return;
    }

    // ---- Firebase --------------------------------------------------------
    const firebaseConfig = {
        apiKey: 'AIzaSyCKBlO4aHTVSjwyevg1OYZ0NWy3Y62HJuU',
        authDomain: 'onlinefix-repair.firebaseapp.com',
        projectId: 'onlinefix-repair',
        storageBucket: 'onlinefix-repair.firebasestorage.app',
        messagingSenderId: '382934797751',
        appId: '1:382934797751:web:5ac8a9c87d68a17b4cec32'
    };

    try {
        if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    } catch (err) {
        showBookingUnavailable();
        return;
    }

    // App Check is intentionally not enabled here — see the matching note
    // in /book/index.html for the full reasoning. Short version: production
    // Cloudflare CSP blocks the reCAPTCHA Enterprise token fetch, repeated
    // failures hit Google's 24h throttle, and after that every public
    // Firestore call fails. The booking function validates every field
    // and limits how many bookings one visitor and the whole site can send,
    // and admin approval is a manual gate before anything chargeable
    // happens.

    const db = firebase.firestore();

    // Where bookings go: the submitBooking Cloud Function
    // (server/submit-booking/). Its host is in connect-src in the page's
    // CSP, in _headers and in the Cloudflare Transform Rule.
    const BOOKING_ENDPOINT = 'https://europe-west2-onlinefix-repair.cloudfunctions.net/submitBooking';

    // ---- Constants -------------------------------------------------------
    const BRANDS = {
        phone:   ['Apple', 'Samsung', 'Google', 'Xiaomi', 'OnePlus', 'Huawei', 'Sony', 'Motorola', 'Nokia', 'Other'],
        laptop:  ['Apple', 'Dell', 'HP', 'Lenovo', 'ASUS', 'Acer', 'MSI', 'Microsoft', 'Razer', 'Other'],
        console: ['Sony PlayStation', 'Microsoft Xbox', 'Nintendo', 'Steam Deck', 'Other'],
        tablet:  ['Apple iPad', 'Samsung', 'Microsoft Surface', 'Lenovo', 'Amazon', 'Other'],
        desktop: ['Custom Build', 'Apple iMac/Mac', 'Dell', 'HP', 'Lenovo', 'Other'],
        other:   ['Other']
    };

    const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

    const DEFAULT_AVAILABILITY = {
        // Drop-offs by appointment, 7 days, 10am to 10pm, as every page
        // says. The last slot offered is 21:30. Used only while the
        // availability/settings doc does not exist: when it does, it wins.
        // admin/seed-availability.html writes these same values.
        workingHours: {
            mon: { open: '10:00', close: '22:00', closed: false },
            tue: { open: '10:00', close: '22:00', closed: false },
            wed: { open: '10:00', close: '22:00', closed: false },
            thu: { open: '10:00', close: '22:00', closed: false },
            fri: { open: '10:00', close: '22:00', closed: false },
            sat: { open: '10:00', close: '22:00', closed: false },
            sun: { open: '10:00', close: '22:00', closed: false }
        },
        blockedDates: [],
        minNoticeHours: 4,
        maxFutureDays: 60,
        slotIntervalMinutes: 30
    };

    // ---- DOM helpers -----------------------------------------------------
    const $  = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
    const clearChildren = (el) => { while (el.firstChild) el.removeChild(el.firstChild); };

    // ---- State -----------------------------------------------------------
    const state = {
        step: 1,
        availability: null,
        photos: [],          // [{ id, file, sizeKB }]
        tempId: null,
        sentAs: null,        // what tempId was last sent with (see submitBooking)
        submitting: false,
        // form values (mirrored from inputs to survive re-renders)
        category: '',
        brand: '',
        model: '',
        issue: '',
        preferredDate: '',
        preferredTime: '',
        extraNotes: '',
        customerName: '',
        customerEmail: '',
        customerPhone: '',
        consent: false
    };

    // ---- Init ------------------------------------------------------------
    document.addEventListener('DOMContentLoaded', init);

    // A CSPRNG booking id, sent as the booking's requestId. The booking
    // function uses it as the booking's document id, its notice's id and
    // its photo folder, so a retry after a lost reply is recognised as the
    // same booking. Kept while the same details are retried; a new one for
    // a new booking, or when the details were changed before a retry.
    function newTempId() {
        const idBytes = new Uint8Array(16);
        crypto.getRandomValues(idBytes);
        return 'BK_' + Array.from(idBytes, b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    }

    function init() {
        const form = $('#booking-form');
        const fallback = $('#booking-fallback');
        if (!form) return;

        // The id this booking is sent under (see newTempId).
        state.tempId = newTempId();

        // Reveal the form (and hide the fallback paragraph since the form is here)
        form.hidden = false;
        if (fallback) fallback.hidden = true;

        wireSteps();
        wireDeviceCategory();
        wireBrandSelect();
        wireIssue();
        wirePhotos();
        wireDatePicker();
        wireContact();
        wireForm();

        loadAvailability();
        showStep(1);
    }

    // ---- Step navigation -------------------------------------------------
    function wireSteps() {
        $$('.btn[data-action]').forEach((btn) => {
            const action = btn.dataset.action;
            if (action === 'next') btn.addEventListener('click', () => goNext());
            else if (action === 'back') btn.addEventListener('click', () => goBack());
            else if (action === 'reset') btn.addEventListener('click', () => resetForm());
        });
        // Edit links inside the review summary.
        document.addEventListener('click', (e) => {
            const editBtn = e.target.closest('.review-edit');
            if (!editBtn) return;
            const target = parseInt(editBtn.dataset.editStep, 10);
            if (target >= 1 && target <= 4) showStep(target);
        });
    }

    function goNext() {
        if (!validateStep(state.step)) return;
        if (typeof window.gtag === 'function') {
            window.gtag('event', 'booking_step_complete', { step: state.step });
        }
        if (state.step < 5) showStep(state.step + 1);
    }

    function goBack() {
        if (state.step > 1) showStep(state.step - 1);
    }

    function showStep(n) {
        state.step = n;
        $$('.step').forEach((el) => {
            el.hidden = parseInt(el.dataset.step, 10) !== n;
        });
        const total = 5;
        const label = $('#progress-label');
        const fill = $('#progress-fill');
        if (n <= total) {
            if (label) label.textContent = `STEP ${n} / ${total}`;
            if (fill) fill.style.width = ((n / total) * 100) + '%';
        } else {
            if (label) label.textContent = 'BOOKED';
            if (fill) fill.style.width = '100%';
        }
        if (n === 5) renderReview();
        // Scroll the active step into view on mobile so users don't lose context.
        const formEl = $('#booking-form');
        if (formEl && window.matchMedia('(max-width: 768px)').matches) {
            formEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    // ---- Step 1: device --------------------------------------------------
    function wireDeviceCategory() {
        $$('input[name="category"]').forEach((input) => {
            input.addEventListener('change', (e) => {
                state.category = e.target.value;
                state.brand = '';
                populateBrands(state.category);
                clearError('category');
            });
        });
    }

    function populateBrands(category) {
        const sel = $('#brand');
        if (!sel) return;
        // Empty out via DOM to avoid innerHTML round-trip flagged by CodeQL
        // (js/xss-through-dom). This is a defense-in-depth choice — BRANDS
        // is hard-coded — but keeping every render path on createElement
        // means new contributors can't accidentally drop tainted data into
        // an HTML string here.
        while (sel.firstChild) sel.removeChild(sel.firstChild);
        const list = BRANDS[category] || [];
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = list.length ? 'Choose…' : 'Pick category first…';
        sel.appendChild(placeholder);
        list.forEach((b) => {
            const opt = document.createElement('option');
            opt.value = b;
            opt.textContent = b;
            sel.appendChild(opt);
        });
    }

    function wireBrandSelect() {
        const sel = $('#brand');
        if (!sel) return;
        sel.addEventListener('change', (e) => {
            state.brand = e.target.value;
            clearError('brand');
        });
        const model = $('#model');
        if (model) model.addEventListener('input', (e) => {
            state.model = e.target.value;
            clearError('model');
        });
    }

    // ---- Step 2: issue + photos ------------------------------------------
    function wireIssue() {
        const issue = $('#issue');
        const counter = $('#issue-count');
        if (!issue) return;
        issue.addEventListener('input', (e) => {
            state.issue = e.target.value;
            if (counter) counter.textContent = e.target.value.length;
            clearError('issue');
        });
    }

    function wirePhotos() {
        const drop = $('#photo-drop');
        const input = $('#photo-input');
        const preview = $('#photo-preview');
        if (!drop || !input || !preview) return;

        // Click on drop area triggers the hidden file input. The <label for>
        // attribute does this for free for keyboard users.
        drop.addEventListener('click', (e) => {
            // Prevent double-trigger: <label for=...> already opens the picker.
            // The browser fires both the label-click and our handler; let the
            // label do its native job, no manual click() needed.
        });

        drop.addEventListener('dragover', (e) => {
            e.preventDefault();
            drop.classList.add('dragover');
        });
        drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
        drop.addEventListener('drop', (e) => {
            e.preventDefault();
            drop.classList.remove('dragover');
            handleFiles(e.dataTransfer.files);
        });

        input.addEventListener('change', (e) => handleFiles(e.target.files));
    }

    async function handleFiles(fileList) {
        clearError('photos');
        const remaining = 3 - state.photos.length;
        if (remaining <= 0) {
            showError('photos', 'Maximum 3 photos. Remove one first.');
            return;
        }
        const files = Array.from(fileList).slice(0, remaining);
        for (const file of files) {
            if (!file.type.startsWith('image/')) {
                showError('photos', `"${file.name}" isn't an image, skipped.`);
                continue;
            }
            try {
                const resized = await resizeImage(file, 1600);
                if (resized.size > 5 * 1024 * 1024) {
                    showError('photos', `"${file.name}" is over 5MB even after resize. Try a smaller photo.`);
                    continue;
                }
                addPhoto(resized);
            } catch (err) {
                showError('photos', `Couldn't process "${file.name}": ${err.message}`);
            }
        }
        // Reset the input so the same file can be re-selected after a removal
        const input = $('#photo-input');
        if (input) input.value = '';
        updatePhotoDropState();
    }

    function addPhoto(file) {
        const idBytes = new Uint8Array(4);
        crypto.getRandomValues(idBytes);
        const id = 'p_' + Array.from(idBytes, b => b.toString(16).padStart(2, '0')).join('');
        const sizeKB = Math.round(file.size / 1024);
        // Stored without a blob URL deliberately: previews are drawn into
        // a <canvas> via createImageBitmap, which CodeQL doesn't trace as
        // an HTML/URL sink (avoids the js/xss-through-dom alert chain that
        // FileList → URL.createObjectURL → img.src would otherwise trip).
        state.photos.push({ id, file, sizeKB });
        renderPhotos();
    }

    function removePhoto(id) {
        const idx = state.photos.findIndex((p) => p.id === id);
        if (idx === -1) return;
        state.photos.splice(idx, 1);
        renderPhotos();
        updatePhotoDropState();
    }

    // Draw a File into a canvas at a target square size, cover-fit. Async
    // because createImageBitmap is — but callers don't have to await; the
    // canvas mounts blank then fills in once decoded. Worth swallowing
    // errors silently: a failed preview just means a blank tile, not a
    // failed booking.
    function paintPhotoCanvas(canvas, file) {
        if (typeof createImageBitmap !== 'function') return; // very old browser; preview is decorative
        createImageBitmap(file).then((bitmap) => {
            const ctx = canvas.getContext('2d');
            if (!ctx) { bitmap.close(); return; }
            const cw = canvas.width;
            const ch = canvas.height;
            const scale = Math.max(cw / bitmap.width, ch / bitmap.height);
            const w = bitmap.width * scale;
            const h = bitmap.height * scale;
            ctx.drawImage(bitmap, (cw - w) / 2, (ch - h) / 2, w, h);
            bitmap.close();
        }).catch(() => { /* preview is decorative */ });
    }

    function renderPhotos() {
        const preview = $('#photo-preview');
        if (!preview) return;
        clearChildren(preview);
        state.photos.forEach((p) => {
            const wrap = document.createElement('div');
            wrap.className = 'photo-thumb';
            wrap.dataset.photoId = p.id;

            const canvas = document.createElement('canvas');
            canvas.width = 240;
            canvas.height = 240;
            canvas.setAttribute('role', 'img');
            canvas.setAttribute('aria-label', 'Repair photo preview');
            paintPhotoCanvas(canvas, p.file);

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'photo-remove';
            removeBtn.setAttribute('aria-label', 'Remove photo');
            removeBtn.textContent = '×';
            removeBtn.addEventListener('click', () => removePhoto(p.id));

            const meta = document.createElement('span');
            meta.className = 'photo-thumb-meta';
            meta.textContent = p.sizeKB + ' KB';

            wrap.appendChild(canvas);
            wrap.appendChild(removeBtn);
            wrap.appendChild(meta);
            preview.appendChild(wrap);
        });
    }

    function updatePhotoDropState() {
        const drop = $('#photo-drop');
        const input = $('#photo-input');
        if (!drop || !input) return;
        const full = state.photos.length >= 3;
        drop.setAttribute('aria-disabled', full ? 'true' : 'false');
        input.disabled = full;
    }

    // Canvas-based resize. Images are scaled to fit within `maxDim` on the
    // longest side, JPEG-encoded at 0.85 quality. Keeps the file under the
    // booking function's 5MB-per-photo cap and avoids sending 12MP raw
    // camera blobs.
    // Resize via createImageBitmap, not FileReader + Image.src. Same end
    // result (a JPEG-encoded File scaled to maxDim on the longest side)
    // but the file taint chain never touches a `.src` attribute, which
    // keeps CodeQL's js/xss-through-dom rule clean.
    function resizeImage(file, maxDim) {
        if (typeof createImageBitmap !== 'function') {
            return Promise.reject(new Error('Browser too old for in-page resize'));
        }
        return createImageBitmap(file).then((bitmap) => {
            let width = bitmap.width;
            let height = bitmap.height;
            if (width > maxDim || height > maxDim) {
                if (width > height) {
                    height = Math.round(height * (maxDim / width));
                    width = maxDim;
                } else {
                    width = Math.round(width * (maxDim / height));
                    height = maxDim;
                }
            }
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) { bitmap.close(); throw new Error('Could not get 2d context'); }
            ctx.drawImage(bitmap, 0, 0, width, height);
            bitmap.close();
            return new Promise((resolve, reject) => {
                canvas.toBlob((blob) => {
                    if (!blob) return reject(new Error('Could not encode image'));
                    // Constant filename. Don't carry file.name through — it's a
                    // DOM-derived string and we don't need it (the booking
                    // function names the stored files itself).
                    resolve(new File([blob], 'photo.jpg', { type: 'image/jpeg' }));
                }, 'image/jpeg', 0.85);
            });
        });
    }

    // ---- Step 3: date + time ---------------------------------------------
    async function loadAvailability() {
        try {
            const snap = await db.collection('availability').doc('settings').get();
            state.availability = snap.exists ? snap.data() : DEFAULT_AVAILABILITY;
        } catch (err) {
            console.warn('Could not load availability/settings, using defaults:', err);
            state.availability = DEFAULT_AVAILABILITY;
        }
        const a = state.availability;
        const dateInput = $('#preferred-date');
        if (dateInput) {
            const min = ukIsoDate(0);
            const max = ukIsoDate(a.maxFutureDays || 60);
            dateInput.min = min;
            dateInput.max = max;
        }
        // If a date was already picked before availability finished loading,
        // re-render slots with the now-loaded settings.
        if (state.preferredDate) renderTimeSlots(state.preferredDate);
    }

    function wireDatePicker() {
        const dateInput = $('#preferred-date');
        if (!dateInput) return;
        dateInput.addEventListener('change', (e) => {
            state.preferredDate = e.target.value;
            state.preferredTime = '';
            clearError('preferred-date');
            renderTimeSlots(state.preferredDate);
        });
    }

    function renderTimeSlots(dateStr) {
        const container = $('#time-slots');
        if (!container) return;
        clearChildren(container);

        const renderEmpty = (msg) => {
            const p = document.createElement('p');
            p.className = 'time-slots-empty';
            p.textContent = msg;
            container.appendChild(p);
        };

        if (!state.availability) return renderEmpty('Loading availability…');
        if (!dateStr) return renderEmpty('Pick a date first.');

        const a = state.availability;
        // Compare on dates only (ignore time component) — JS Date parsing is
        // a minefield, so build it from the YYYY-MM-DD parts directly.
        const [y, m, d] = dateStr.split('-').map((n) => parseInt(n, 10));
        const date = new Date(y, m - 1, d);
        if (isNaN(date.getTime())) return renderEmpty('Invalid date.');

        if ((a.blockedDates || []).includes(dateStr)) {
            return renderEmpty("We're closed that day. Pick another.");
        }

        const dayKey = DAY_KEYS[date.getDay()];
        const hours = (a.workingHours || {})[dayKey];
        if (!hours || hours.closed) {
            return renderEmpty("We're closed that day. Pick another.");
        }

        const slots = generateSlots(hours.open, hours.close, a.slotIntervalMinutes || 30);
        if (!slots.length) return renderEmpty('No slots available.');

        const minNoticeMs = (a.minNoticeHours || 0) * 60 * 60 * 1000;
        const earliest = new Date(Date.now() + minNoticeMs);

        slots.forEach((slot) => {
            // Slots are the shop's hours, so compare them as UK times (the
            // same way submitBooking stores the one picked), not as times on
            // the visitor's own clock.
            const slotDate = ukTime(y, m, d, slot.h, slot.min);
            const disabled = slotDate < earliest;
            const isSelected = state.preferredTime === slot.label;

            const label = document.createElement('label');
            label.className = 'time-slot' + (disabled ? ' disabled' : '') + (isSelected ? ' selected' : '');
            label.dataset.slot = slot.label;

            const input = document.createElement('input');
            input.type = 'radio';
            input.name = 'preferred-time';
            input.value = slot.label;
            if (disabled) input.disabled = true;
            if (isSelected) input.checked = true;

            label.appendChild(input);
            label.appendChild(document.createTextNode(slot.label));

            if (!disabled) {
                label.addEventListener('click', () => {
                    state.preferredTime = slot.label;
                    $$('label.time-slot', container).forEach((s) => s.classList.remove('selected'));
                    label.classList.add('selected');
                    clearError('preferred-time');
                });
            }
            container.appendChild(label);
        });
    }

    function generateSlots(openStr, closeStr, intervalMin) {
        const out = [];
        const [oh, om] = openStr.split(':').map(Number);
        const [ch, cm] = closeStr.split(':').map(Number);
        let cur = oh * 60 + om;
        const end = ch * 60 + cm;
        while (cur < end) {
            const h = Math.floor(cur / 60);
            const min = cur % 60;
            out.push({ h, min, label: `${pad(h)}:${pad(min)}` });
            cur += intervalMin;
        }
        return out;
    }

    function pad(n) { return String(n).padStart(2, '0'); }

    // ---- Step 4: contact -------------------------------------------------
    function wireContact() {
        const fields = [
            ['#customer-name', 'customerName', 'customer-name'],
            ['#customer-email', 'customerEmail', 'customer-email'],
            ['#customer-phone', 'customerPhone', 'customer-phone'],
            ['#extra-notes', 'extraNotes', 'extra-notes']
        ];
        fields.forEach(([sel, key, errKey]) => {
            const el = $(sel);
            if (!el) return;
            el.addEventListener('input', (e) => {
                state[key] = e.target.value;
                clearError(errKey);
            });
        });
        const consent = $('#consent');
        if (consent) consent.addEventListener('change', (e) => {
            state.consent = e.target.checked;
            clearError('consent');
        });
    }

    // ---- Validation ------------------------------------------------------
    function validateStep(step) {
        clearAllErrors();
        let ok = true;
        const fail = (key, msg) => { showError(key, msg); ok = false; };

        if (step === 1) {
            if (!state.category) fail('category', 'Pick the kind of device.');
            if (!state.brand) fail('brand', 'Choose a brand.');
            if (!state.model || !state.model.trim()) fail('model', 'Tell us the model.');
            else if (state.model.length > 99) fail('model', 'Model name is too long (max 99 characters).');
        }
        if (step === 2) {
            if (!state.issue || !state.issue.trim()) fail('issue', 'Tell us briefly what\'s wrong.');
            else if (state.issue.length > 999) fail('issue', 'Description is too long (max 999 characters).');
        }
        if (step === 3) {
            if (!state.preferredDate) fail('preferred-date', 'Pick a date.');
            // A date typed past the picker's range: the booking function
            // would refuse it, so ask again here instead.
            else if (state.preferredDate < ukIsoDate(0)
                || state.preferredDate > ukIsoDate((state.availability && state.availability.maxFutureDays) || 60)) {
                fail('preferred-date', 'Pick a date.');
            }
            if (!state.preferredTime) fail('preferred-time', 'Pick a time slot.');
            // The description and these notes are saved as one text, which
            // the booking function holds to 999 characters: say so rather
            // than cut it.
            const over = issueWithNotes().length - 999;
            if (state.extraNotes && over > 0) {
                fail('extra-notes', 'Together with your description this is ' + over
                    + ' characters too long. Please shorten one of them.');
            }
        }
        if (step === 4) {
            if (!state.customerName || !state.customerName.trim()) fail('customer-name', 'Your name please.');
            else if (state.customerName.length > 99) fail('customer-name', 'Name is too long.');

            // One plain address, the shape the booking function requires:
            // no list of addresses and no display name ('"Name" <a@b.com>').
            if (!state.customerEmail || !/^[^\s@,;:<>()"\[\]\\]+@[^\s@,;:<>()"\[\]\\]+\.[^\s@,;:<>()"\[\]\\]{2,}$/.test(state.customerEmail)) {
                fail('customer-email', 'A valid email so we can reach you.');
            }
            if (!isUkPhone(state.customerPhone)) {
                fail('customer-phone', 'A UK number, e.g. 07xxx xxxxxx or +44 7xxx xxxxxx.');
            }
            if (!state.consent) fail('consent', 'Please tick the box to continue.');
        }
        return ok;
    }

    // The description as saved: the issue, then any extra notes under a
    // heading. The booking function allows fewer than 1000 characters in all.
    function issueWithNotes() {
        return (state.extraNotes
            ? `${state.issue}\n\n--- Additional notes ---\n${state.extraNotes}`
            : state.issue).trim();
    }

    function isUkPhone(s) {
        if (!s) return false;
        const trimmed = s.replace(/[\s()-]/g, '');
        // Accept 07xxxxxxxxx, +447xxxxxxxxx, 00447xxxxxxxxx. Be lenient on
        // total length (10-15) so we don't reject legitimate variations.
        return /^(07\d{9}|\+447\d{9}|00447\d{9})$/.test(trimmed);
    }

    function showError(key, msg) {
        const el = document.querySelector(`[data-error="${key}"]`);
        if (!el) return;
        el.textContent = msg;
        el.classList.add('show');
        const field = el.closest('.field');
        if (field) field.classList.add('has-error');
    }

    function clearError(key) {
        const el = document.querySelector(`[data-error="${key}"]`);
        if (!el) return;
        el.textContent = '';
        el.classList.remove('show');
        const field = el.closest('.field');
        if (field) field.classList.remove('has-error');
    }

    function clearAllErrors() {
        $$('.field-error').forEach((el) => { el.textContent = ''; el.classList.remove('show'); });
        $$('.field.has-error').forEach((f) => f.classList.remove('has-error'));
    }

    // ---- Step 5: review --------------------------------------------------
    function renderReview() {
        const root = $('#review-summary');
        if (!root) return;
        clearChildren(root);

        // Each row is { key, edit, build(valEl) } so we can either set
        // textContent for plain values or append DOM children for the
        // photo grid — never building HTML strings.
        const noneSpan = () => {
            const span = document.createElement('span');
            span.style.fontFamily = 'monospace';
            span.style.color = '#777';
            span.textContent = 'None';
            return span;
        };

        const rows = [
            { key: 'Device', edit: 1, build: (v) => { v.textContent = `${capitalize(state.category)} - ${state.brand} ${state.model}`; } },
            { key: 'Issue', edit: 2, build: (v) => { v.textContent = state.issue; } },
            { key: 'Photos', edit: 2, valClass: 'review-photos', build: (v) => {
                if (!state.photos.length) { v.appendChild(noneSpan()); return; }
                state.photos.forEach((p) => {
                    // Same canvas-not-img approach as renderPhotos to keep
                    // the file taint chain off any HTML/URL sink.
                    const canvas = document.createElement('canvas');
                    canvas.width = 60;
                    canvas.height = 60;
                    canvas.setAttribute('role', 'img');
                    canvas.setAttribute('aria-label', 'Booked photo');
                    paintPhotoCanvas(canvas, p.file);
                    v.appendChild(canvas);
                });
            }},
            { key: 'When', edit: 3, build: (v) => { v.textContent = `${state.preferredDate} at ${state.preferredTime}`; } },
            { key: 'Notes', edit: 3, build: (v) => {
                if (state.extraNotes) v.textContent = state.extraNotes;
                else v.appendChild(noneSpan());
            }},
            { key: 'Name', edit: 4, build: (v) => { v.textContent = state.customerName; } },
            { key: 'Email', edit: 4, build: (v) => { v.textContent = state.customerEmail; } },
            { key: 'Phone', edit: 4, build: (v) => { v.textContent = state.customerPhone; } }
        ];

        rows.forEach((r) => {
            const row = document.createElement('div');
            row.className = 'review-row';

            const keyEl = document.createElement('span');
            keyEl.className = 'review-key';
            keyEl.textContent = r.key;

            const valEl = document.createElement('span');
            valEl.className = 'review-val' + (r.valClass ? ' ' + r.valClass : '');
            r.build(valEl);

            const editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.className = 'review-edit';
            editBtn.dataset.editStep = String(r.edit);
            editBtn.textContent = 'Edit';

            row.appendChild(keyEl);
            row.appendChild(valEl);
            row.appendChild(editBtn);
            root.appendChild(row);
        });
    }

    function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

    // ---- Submit ----------------------------------------------------------
    function wireForm() {
        const form = $('#booking-form');
        if (!form) return;
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (state.submitting) return;
            // Final guard — re-run validation for steps 1-4 in case the user
            // edited something then navigated forward without re-validating.
            for (let i = 1; i <= 4; i++) {
                if (!validateStep(i)) {
                    showStep(i);
                    return;
                }
            }
            await submitBooking();
        });
    }

    async function submitBooking() {
        state.submitting = true;
        const submitBtn = $('#submit-btn');
        const errEl = $('#submit-error');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Submitting…'; }
        if (errEl) errEl.hidden = true;

        try {
            // The whole booking goes to the booking function in one request,
            // photos included (the resized JPEGs, as base64). The function
            // checks it, stores the photos, and saves the booking and the
            // shop's email notice; the page writes nothing itself.
            //
            // requestId is this booking's id (state.tempId), and it stays the
            // same when the visitor tries again after a failure with the
            // same details. If an earlier try was saved but its reply was
            // lost, the function finds the booking already there and
            // answers with the same reference, so a retry never makes a
            // second booking. That answer says nothing about what was
            // saved, so when anything (photos included) was changed since
            // the last try, this one goes under a new id: at worst staff
            // see the booking twice, but never the old details alone.
            const details = {
                category: state.category,
                brand: state.brand,
                model: state.model,
                // The function wants fewer than 1000 characters.
                issue: issueWithNotes().slice(0, 999),
                date: state.preferredDate,
                time: state.preferredTime,
                name: state.customerName,
                email: state.customerEmail,
                phone: state.customerPhone
            };
            const sentAs = JSON.stringify([details, state.photos.map((p) => p.id)]);
            if (state.sentAs !== null && state.sentAs !== sentAs) state.tempId = newTempId();
            state.sentAs = sentAs;

            const photos = [];
            for (const p of state.photos) photos.push(await fileToBase64(p.file));

            const payload = Object.assign({ requestId: state.tempId }, details, { photos: photos });

            let res;
            try {
                res = await fetch(BOOKING_ENDPOINT, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    credentials: 'omit',
                    cache: 'no-store'
                });
            } catch (err) {
                const netErr = new Error('Could not reach the booking service');
                netErr.code = 'network';
                throw netErr;
            }
            let answer = null;
            try { answer = await res.json(); } catch (err) { /* not JSON: handled below */ }
            if (!res.ok || !answer || answer.ok !== true || typeof answer.reference !== 'string') {
                const refused = new Error('Booking not accepted (HTTP ' + res.status + ')');
                refused.status = res.status;
                throw refused;
            }

            // Show confirmation
            const refId = answer.reference.slice(-6).toUpperCase();
            const refEl = $('#reference-id');
            if (refEl) refEl.textContent = refId;
            if (typeof window.gtag === 'function') {
                window.gtag('event', 'booking_submitted', { category: state.category });
            }
            showStep(6);
        } catch (err) {
            console.error('Booking submit failed:', err);
            if (errEl) {
                errEl.hidden = false;
                errEl.textContent = friendlyError(err) + ' Your details are still here — try again, or call 07940 730537.';
            }
        } finally {
            state.submitting = false;
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Request Booking'; }
        }
    }

    // A photo File as base64, without the "data:image/jpeg;base64," prefix.
    function fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const s = String(reader.result || '');
                const comma = s.indexOf(',');
                if (comma === -1) reject(new Error('Could not read photo'));
                else resolve(s.slice(comma + 1));
            };
            reader.onerror = () => reject(reader.error || new Error('Could not read photo'));
            reader.readAsDataURL(file);
        });
    }

    // Parts of a moment as a UK clock shows them.
    function ukParts(date, options) {
        const parts = {};
        new Intl.DateTimeFormat('en-GB', Object.assign({ timeZone: 'Europe/London' }, options))
            .formatToParts(date)
            .forEach(p => { parts[p.type] = p.value; });
        return parts;
    }

    // The moment a UK clock reads y-m-d hh:mm. Starts from that reading as
    // if it were UTC, then takes off however far the UK is ahead of UTC then
    // (nothing in winter, an hour in summer).
    function ukTime(y, m, d, hh, mm) {
        const asUtc = Date.UTC(y, m - 1, d, hh, mm);
        const p = ukParts(new Date(asUtc), {
            year: 'numeric', month: 'numeric', day: 'numeric',
            hour: 'numeric', minute: 'numeric', hourCycle: 'h23'
        });
        const ukAsUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
        return new Date(asUtc - (ukAsUtc - asUtc));
    }

    // The booking function answers 400 when it refuses the details, and
    // anything else (busy, a server fault) gets the general message.
    function friendlyError(err) {
        if (err && err.status === 400) return 'The server rejected the booking — most likely a validation issue.';
        if (err && err.code === 'network') return 'Network issue — couldn\'t reach the server.';
        return 'Something went wrong submitting your booking.';
    }

    // ---- Reset for "Book another" ---------------------------------------
    function resetForm() {
        state.photos = [];
        Object.assign(state, {
            step: 1,
            category: '',
            brand: '',
            model: '',
            issue: '',
            preferredDate: '',
            preferredTime: '',
            extraNotes: '',
            customerName: '',
            customerEmail: '',
            customerPhone: '',
            consent: false,
            submitting: false
        });
        // New tempId for the next booking
        state.tempId = newTempId();
        state.sentAs = null;

        const form = $('#booking-form');
        if (form) form.reset();
        renderPhotos();
        updatePhotoDropState();
        const counter = $('#issue-count');
        if (counter) counter.textContent = '0';
        const slots = $('#time-slots');
        if (slots) {
            clearChildren(slots);
            const empty = document.createElement('p');
            empty.className = 'time-slots-empty';
            empty.textContent = 'Pick a date first.';
            slots.appendChild(empty);
        }
        clearAllErrors();
        showStep(1);
    }

    // ---- Date helpers ----------------------------------------------------
    // Today's date in the UK, plus n days, as YYYY-MM-DD.
    function ukIsoDate(n) {
        const p = ukParts(new Date(), { year: 'numeric', month: '2-digit', day: '2-digit' });
        return new Date(Date.UTC(+p.year, +p.month - 1, +p.day + n)).toISOString().slice(0, 10);
    }
})();
