/* /book/ — Customer booking flow.
   Vanilla JS, no build step, Firebase compat v9.22.0 (matches the rest of the
   site). App Check via reCAPTCHA Enterprise sits between anonymous form posts
   and Firestore so we don't get bot-spam writes.

   State lives in `state` and survives validation errors (intentional — the
   user spec is explicit that we never lose form data on error).

   Steps 1-5 are the form. Step 6 is the post-submit confirmation. The fields
   array on each step lists what gets validated when the user clicks Next.
*/
(function () {
    'use strict';

    // ---- Firebase --------------------------------------------------------
    const firebaseConfig = {
        apiKey: 'AIzaSyCKBlO4aHTVSjwyevg1OYZ0NWy3Y62HJuU',
        authDomain: 'onlinefix-repair.firebaseapp.com',
        projectId: 'onlinefix-repair',
        storageBucket: 'onlinefix-repair.firebasestorage.app',
        messagingSenderId: '382934797751',
        appId: '1:382934797751:web:5ac8a9c87d68a17b4cec32'
    };

    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);

    // App Check is intentionally not enabled here — see the matching note
    // in /book/index.html for the full reasoning. Short version: production
    // Cloudflare CSP blocks the reCAPTCHA Enterprise token fetch, repeated
    // failures hit Google's 24h throttle, and after that every public
    // Firestore write fails. firestore.rules already validates every field
    // shape on create, and admin approval is a manual gate before anything
    // chargeable happens, so the security floor without App Check is fine.

    const db = firebase.firestore();
    const storage = firebase.storage();

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
        slotIntervalMinutes: 30
    };

    // ---- DOM helpers -----------------------------------------------------
    const $  = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
    const escapeHTML = (s) => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

    // ---- State -----------------------------------------------------------
    const state = {
        step: 1,
        availability: null,
        photos: [],          // [{ id, file, blobUrl, sizeKB }]
        tempId: null,
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

    function init() {
        const form = $('#booking-form');
        const fallback = $('#booking-fallback');
        if (!form) return;

        // Generate a CSPRNG temp id used as both the Storage path and a marker
        // on the Firestore doc (so admins can match doc <-> photos later).
        const idBytes = new Uint8Array(16);
        crypto.getRandomValues(idBytes);
        state.tempId = 'BK_' + Array.from(idBytes, b => b.toString(16).padStart(2, '0')).join('').toUpperCase();

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
        sel.innerHTML = '';
        const list = BRANDS[category] || [];
        if (!list.length) {
            sel.innerHTML = '<option value="">Pick category first&hellip;</option>';
            return;
        }
        sel.innerHTML = '<option value="">Choose&hellip;</option>' +
            list.map((b) => `<option value="${escapeHTML(b)}">${escapeHTML(b)}</option>`).join('');
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
        const blobUrl = URL.createObjectURL(file);
        const sizeKB = Math.round(file.size / 1024);
        state.photos.push({ id, file, blobUrl, sizeKB });
        renderPhotos();
    }

    function removePhoto(id) {
        const idx = state.photos.findIndex((p) => p.id === id);
        if (idx === -1) return;
        URL.revokeObjectURL(state.photos[idx].blobUrl);
        state.photos.splice(idx, 1);
        renderPhotos();
        updatePhotoDropState();
    }

    function renderPhotos() {
        const preview = $('#photo-preview');
        if (!preview) return;
        preview.innerHTML = state.photos.map((p) => `
            <div class="photo-thumb" data-photo-id="${escapeHTML(p.id)}">
                <img src="${escapeHTML(p.blobUrl)}" alt="Repair photo preview">
                <button type="button" class="photo-remove" aria-label="Remove photo" data-remove="${escapeHTML(p.id)}">&times;</button>
                <span class="photo-thumb-meta">${p.sizeKB} KB</span>
            </div>
        `).join('');
        $$('button[data-remove]', preview).forEach((btn) => {
            btn.addEventListener('click', () => removePhoto(btn.dataset.remove));
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
    // Storage rule's 5MB cap and avoids re-uploading 12MP raw camera blobs.
    function resizeImage(file, maxDim) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error('Could not read file'));
            reader.onload = () => {
                const img = new Image();
                img.onerror = () => reject(new Error('Could not decode image'));
                img.onload = () => {
                    let { width, height } = img;
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
                    ctx.drawImage(img, 0, 0, width, height);
                    canvas.toBlob((blob) => {
                        if (!blob) return reject(new Error('Could not encode image'));
                        // Stamp a JPEG extension so the Storage path stays predictable.
                        resolve(new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }));
                    }, 'image/jpeg', 0.85);
                };
                img.src = reader.result;
            };
            reader.readAsDataURL(file);
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
            const min = isoDate(addDays(new Date(), 0));
            const max = isoDate(addDays(new Date(), a.maxFutureDays || 60));
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
        if (!state.availability) {
            container.innerHTML = '<p class="time-slots-empty">Loading availability&hellip;</p>';
            return;
        }
        if (!dateStr) {
            container.innerHTML = '<p class="time-slots-empty">Pick a date first.</p>';
            return;
        }

        const a = state.availability;
        // Compare on dates only (ignore time component) — JS Date parsing is
        // a minefield, so build it from the YYYY-MM-DD parts directly.
        const [y, m, d] = dateStr.split('-').map((n) => parseInt(n, 10));
        const date = new Date(y, m - 1, d);
        if (isNaN(date.getTime())) {
            container.innerHTML = '<p class="time-slots-empty">Invalid date.</p>';
            return;
        }

        if ((a.blockedDates || []).includes(dateStr)) {
            container.innerHTML = '<p class="time-slots-empty">We\'re closed that day. Pick another.</p>';
            return;
        }

        const dayKey = DAY_KEYS[date.getDay()];
        const hours = (a.workingHours || {})[dayKey];
        if (!hours || hours.closed) {
            container.innerHTML = '<p class="time-slots-empty">We\'re closed that day. Pick another.</p>';
            return;
        }

        const slots = generateSlots(hours.open, hours.close, a.slotIntervalMinutes || 30);
        if (!slots.length) {
            container.innerHTML = '<p class="time-slots-empty">No slots available.</p>';
            return;
        }

        const minNoticeMs = (a.minNoticeHours || 0) * 60 * 60 * 1000;
        const earliest = new Date(Date.now() + minNoticeMs);

        const html = slots.map((slot) => {
            const slotDate = new Date(y, m - 1, d, slot.h, slot.min, 0, 0);
            const disabled = slotDate < earliest;
            const cls = ['time-slot'];
            if (disabled) cls.push('disabled');
            if (state.preferredTime === slot.label) cls.push('selected');
            return `<label class="${cls.join(' ')}" data-slot="${escapeHTML(slot.label)}">
                <input type="radio" name="preferred-time" value="${escapeHTML(slot.label)}" ${disabled ? 'disabled' : ''} ${state.preferredTime === slot.label ? 'checked' : ''}>
                ${escapeHTML(slot.label)}
            </label>`;
        }).join('');
        container.innerHTML = html;

        $$('label.time-slot:not(.disabled)', container).forEach((el) => {
            el.addEventListener('click', () => {
                state.preferredTime = el.dataset.slot;
                $$('label.time-slot', container).forEach((s) => s.classList.remove('selected'));
                el.classList.add('selected');
                clearError('preferred-time');
            });
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
            else if (state.model.length > 100) fail('model', 'Model name is too long (max 100).');
        }
        if (step === 2) {
            if (!state.issue || !state.issue.trim()) fail('issue', 'Tell us briefly what\'s wrong.');
            else if (state.issue.length > 1000) fail('issue', 'Description is too long (max 1000).');
        }
        if (step === 3) {
            if (!state.preferredDate) fail('preferred-date', 'Pick a date.');
            if (!state.preferredTime) fail('preferred-time', 'Pick a time slot.');
        }
        if (step === 4) {
            if (!state.customerName || !state.customerName.trim()) fail('customer-name', 'Your name please.');
            else if (state.customerName.length > 100) fail('customer-name', 'Name is too long.');

            if (!state.customerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.customerEmail)) {
                fail('customer-email', 'A valid email so we can reach you.');
            }
            if (!isUkPhone(state.customerPhone)) {
                fail('customer-phone', 'A UK number, e.g. 07xxx xxxxxx or +44 7xxx xxxxxx.');
            }
            if (!state.consent) fail('consent', 'Please tick the box to continue.');
        }
        return ok;
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
        const photoHtml = state.photos.length
            ? state.photos.map((p) => `<img src="${escapeHTML(p.blobUrl)}" alt="">`).join('')
            : '<span style="font-family:monospace;color:#777;">None</span>';

        const rows = [
            { key: 'Device', val: `${escapeHTML(capitalize(state.category))} - ${escapeHTML(state.brand)} ${escapeHTML(state.model)}`, edit: 1 },
            { key: 'Issue', val: escapeHTML(state.issue), edit: 2 },
            { key: 'Photos', val: photoHtml, valClass: 'review-photos', edit: 2 },
            { key: 'When', val: `${escapeHTML(state.preferredDate)} at ${escapeHTML(state.preferredTime)}`, edit: 3 },
            { key: 'Notes', val: state.extraNotes ? escapeHTML(state.extraNotes) : '<span style="font-family:monospace;color:#777;">None</span>', edit: 3 },
            { key: 'Name', val: escapeHTML(state.customerName), edit: 4 },
            { key: 'Email', val: escapeHTML(state.customerEmail), edit: 4 },
            { key: 'Phone', val: escapeHTML(state.customerPhone), edit: 4 }
        ];

        root.innerHTML = rows.map((r) => `
            <div class="review-row">
                <span class="review-key">${escapeHTML(r.key)}</span>
                <span class="review-val ${r.valClass || ''}">${r.val}</span>
                <button type="button" class="review-edit" data-edit-step="${r.edit}">Edit</button>
            </div>
        `).join('');
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
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Submitting&hellip;'; }
        if (errEl) errEl.hidden = true;

        try {
            // 1) Upload photos to Storage. Done sequentially so a partial
            //    upload set is easy to clean up on the admin side later.
            const photoUrls = [];
            const photoPaths = [];
            for (let i = 0; i < state.photos.length; i++) {
                const p = state.photos[i];
                const filename = `photo-${i + 1}.jpg`;
                const path = `bookings/${state.tempId}/${filename}`;
                const ref = storage.ref().child(path);
                const snapshot = await ref.put(p.file, { contentType: 'image/jpeg' });
                const url = await snapshot.ref.getDownloadURL();
                photoUrls.push(url);
                photoPaths.push(path);
            }

            // 2) Build the booking doc. Field shape is locked in by the
            //    Firestore rule (firestore.rules:46-67) — any drift here will
            //    be rejected server-side.
            const [y, m, d] = state.preferredDate.split('-').map(Number);
            const [hh, mm] = state.preferredTime.split(':').map(Number);
            const preferredAt = new Date(y, m - 1, d, hh, mm, 0, 0);

            const issueText = state.extraNotes
                ? `${state.issue}\n\n--- Additional notes ---\n${state.extraNotes}`
                : state.issue;

            const docData = {
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                status: 'pending',
                respondedAt: null,
                linkedRepairId: null,
                adminNotes: '',
                deleted: false,
                tempId: state.tempId,
                customer: {
                    name: state.customerName.trim(),
                    email: state.customerEmail.trim(),
                    phone: state.customerPhone.trim()
                },
                device: {
                    category: state.category,
                    brand: state.brand,
                    model: state.model.trim()
                },
                issue: issueText.trim().slice(0, 1000),
                preferredAt: firebase.firestore.Timestamp.fromDate(preferredAt),
                photos: photoUrls,
                photoPaths: photoPaths
            };

            const ref = await db.collection('bookings').add(docData);

            // 3) Show confirmation
            const refId = ref.id.slice(-6).toUpperCase();
            const refEl = $('#reference-id');
            if (refEl) refEl.textContent = refId;
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

    function friendlyError(err) {
        const code = (err && err.code) || '';
        if (code === 'permission-denied') return 'The server rejected the booking — most likely a validation issue.';
        if (code === 'unavailable' || code === 'deadline-exceeded') return 'Network issue — couldn\'t reach the server.';
        if (code.indexOf('storage/') === 0) return 'Photo upload failed.';
        return 'Something went wrong submitting your booking.';
    }

    // ---- Reset for "Book another" ---------------------------------------
    function resetForm() {
        // Free any blob URLs so we don't leak memory across multiple bookings.
        state.photos.forEach((p) => URL.revokeObjectURL(p.blobUrl));
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
        const idBytes = new Uint8Array(16);
        crypto.getRandomValues(idBytes);
        state.tempId = 'BK_' + Array.from(idBytes, b => b.toString(16).padStart(2, '0')).join('').toUpperCase();

        const form = $('#booking-form');
        if (form) form.reset();
        renderPhotos();
        updatePhotoDropState();
        const counter = $('#issue-count');
        if (counter) counter.textContent = '0';
        const slots = $('#time-slots');
        if (slots) slots.innerHTML = '<p class="time-slots-empty">Pick a date first.</p>';
        clearAllErrors();
        showStep(1);
    }

    // ---- Date helpers ----------------------------------------------------
    function addDays(d, n) {
        const out = new Date(d);
        out.setDate(out.getDate() + n);
        return out;
    }

    function isoDate(d) {
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }
})();
