/* =====================================================================
   OnlineFix — in-store repair intake
   ---------------------------------------------------------------------
   Two-handed workflow, one device — one page per person:

     Step 1  technician, with the device in hand
     Step 2  customer, entering their own details and signing
     Step 3  thank-you, then notifications and label behind a Staff button

   Photos upload the moment they are taken, keyed on a repair ID minted at
   the start of the session, so evidence survives a crash or a closed lid
   long before the Firestore document exists.
   ===================================================================== */

(function () {
    'use strict';

    // ------------------------------------------------------------------
    // Configuration
    // ------------------------------------------------------------------

    var SITE_URL = 'https://onlinefix.co.uk';
    var SHOP_EMAIL = 'hello@onlinefix.uk';
    var SHOP_PHONE = '07940 730537';
    var SHOP_ADDRESS = '13 Quarry Street, Guildford, Surrey, GU1 3UY';

    /* Bump TERMS_VERSION whenever the wording below changes. Every signed
       consent records the version it agreed to, which is the whole point of
       collecting a signature — "which terms did they actually sign?" has to
       be answerable months later. */
    var TERMS_VERSION = 'dropoff-1.1';
    var TERMS_EFFECTIVE = '29 August 2026';

    var MAX_PHOTO_BYTES = 10 * 1024 * 1024;
    var MAX_PHOTOS = 12;
    var ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

    var firebaseConfig = {
        apiKey: 'AIzaSyCKBlO4aHTVSjwyevg1OYZ0NWy3Y62HJuU',
        authDomain: 'onlinefix-repair.firebaseapp.com',
        projectId: 'onlinefix-repair',
        storageBucket: 'onlinefix-repair.firebasestorage.app',
        messagingSenderId: '382934797751',
        appId: '1:382934797751:web:5ac8a9c87d68a17b4cec32'
    };
    var RECAPTCHA_SITE_KEY = '6LdZJRIsAAAAAOx4EZqupxMVvX4B3u3YlK5ez-3r';

    var QUICK_JOBS = [
        { label: 'PS5 HDMI port', category: 'console', brand: 'Sony', model: 'PlayStation 5', issue: 'No display output. HDMI port damaged — replace port and test on 4K set.', price: '' },
        { label: 'Xbox Series X HDMI', category: 'console', brand: 'Microsoft', model: 'Xbox Series X', issue: 'No display output. HDMI port damaged — replace port and test on 4K set.', price: '' },
        { label: 'Console deep clean', category: 'console', brand: '', model: '', issue: 'Overheating / loud fan. Full strip-down, dust removal, new thermal paste and pads.', price: '' },
        { label: 'Phone screen', category: 'phone', brand: '', model: '', issue: 'Cracked screen — replace display assembly and test touch, brightness and front camera.', price: '' },
        { label: 'Phone battery', category: 'phone', brand: '', model: '', issue: 'Battery health degraded / device shutting down. Replace battery and verify charge cycle.', price: '' },
        { label: 'Charging port', category: 'phone', brand: '', model: '', issue: 'Not charging or intermittent connection. Clean or replace charging port, test charge and data.', price: '' },
        { label: 'Laptop diagnostics', category: 'laptop', brand: '', model: '', issue: 'Fault to be identified. Full diagnostics, findings and quote to follow before any chargeable work.', price: '' },
        { label: 'Data recovery', category: 'other', brand: '', model: '', issue: 'Data recovery attempt from device storage. No-fix-no-fee assessment first.', price: '' },
        { label: 'PC build / rebuild', category: 'desktop', brand: '', model: 'Custom PC', issue: 'Full build / rebuild, cable management, BIOS setup and stress test.', price: '' }
    ];

    // ------------------------------------------------------------------
    // Terms text (rendered into the signing step; also inlined into email)
    // ------------------------------------------------------------------

    var TERMS_HTML = [
        '<h3>1. What we will do</h3>',
        '<p>We will diagnose the device, tell you what we find, and quote you before carrying out any chargeable work. We test the device after the repair before handing it back. We use suitable parts for the job — original or quality-matched aftermarket — and we will tell you which.</p>',

        '<h3>2. Your data — back it up</h3>',
        '<p>Repairs sometimes require a factory reset, especially anything involving storage or the motherboard. We take care with your data, but <strong>we cannot guarantee it survives the repair, and we are not liable for data loss.</strong> Please back up anything you cannot lose before leaving the device with us.</p>',

        '<h3>3. Quotes and approval</h3>',
        '<p>Any price recorded today is an estimate based on the fault as described. If we open the device and find something different, we stop and contact you with a revised quote. Work continues only once you confirm. If you decide not to proceed after diagnostics, there is no charge and we hand the device back as it came in.</p>',

        '<h3>4. Payment</h3>',
        '<p>Payment is due on collection, by cash or bank transfer. We do not accept credit or debit cards, Apple Pay or Google Pay. Ask us if you need an invoice for business expenses or an insurance claim.</p>',

        '<h3>5. Warranty</h3>',
        '<p>Our workmanship and the parts we fit are covered for 90 days from collection. The warranty covers the specific repair we carried out. It does not cover new accidental damage, liquid damage, or faults unrelated to our work.</p>',

        '<h3>6. Collecting your device</h3>',
        '<p>We will contact you when the device is ready. Please collect it within 60 days of that message. After 60 days the device may be treated as abandoned and recycled or disposed of, and we may charge reasonable storage costs. Bring photo ID or the confirmation email when you collect.</p>',

        '<h3>7. Condition on arrival</h3>',
        '<p>We photograph every device at drop-off and record any existing damage. Those photos and notes form the agreed record of how the device arrived. Please check the summary above before you sign.</p>',

        '<h3>8. Devices we cannot repair</h3>',
        '<p>Some faults — severe liquid or motherboard damage in particular — cannot be repaired reliably. Where that is the case we will tell you, explain the odds honestly before you commit, and charge nothing beyond any agreed diagnostics fee.</p>',

        '<h3>9. Limit of liability</h3>',
        '<p>Except where the law says otherwise, our maximum liability for any repair is the value of the repair charge itself.</p>',

        '<h3>10. Proof of ownership</h3>',
        '<p>We may ask for proof of ownership, particularly for phones. We reserve the right to decline a repair where ownership cannot reasonably be established.</p>',

        '<h3>11. Your personal information</h3>',
        '<p>We collect your name and contact details to carry out this repair, contact you about it, and keep a record of work done. We keep repair records for six years for warranty, accounting and dispute purposes, then delete them. We do not sell your details or share them with anyone outside the repair. You can ask to see, correct or delete your details at any time — email ' + SHOP_EMAIL + '. Full detail is in our privacy notice at ' + SITE_URL + '/privacy.html.</p>',

        '<h3>12. Contact</h3>',
        '<p>OnlineFix, ' + SHOP_ADDRESS + '. Phone ' + SHOP_PHONE + '. Email ' + SHOP_EMAIL + '.</p>'
    ].join('');

    // ------------------------------------------------------------------
    // Firebase
    // ------------------------------------------------------------------

    firebase.initializeApp(firebaseConfig);
    try {
        firebase.appCheck().activate(
            new firebase.appCheck.ReCaptchaEnterpriseProvider(RECAPTCHA_SITE_KEY), true);
    } catch (err) {
        console.error('App Check activation failed', err);
    }
    var db = firebase.firestore();
    var storage = firebase.storage();
    var auth = firebase.auth();

    // ------------------------------------------------------------------
    // Small helpers
    // ------------------------------------------------------------------

    function $(sel, root) { return (root || document).querySelector(sel); }
    function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

    function escapeHTML(value) {
        if (value === null || value === undefined) return '';
        return String(value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    function randomHex(bytes) {
        var buf = new Uint8Array(bytes);
        crypto.getRandomValues(buf);
        return Array.prototype.map.call(buf, function (b) {
            return b.toString(16).padStart(2, '0');
        }).join('');
    }

    /* The repair ID is the only credential guarding the public tracking page
       (see firestore.rules), so it has to be unguessable rather than
       sequential. 64 bits of CSPRNG gives 1.8e19 possibilities: against a
       few thousand live tickets, reaching even a 1% chance of guessing one
       takes ~1.8e13 attempts, and every attempt is a separate App
       Check-gated Firestore query. Short enough to read out over the phone
       and to fit an email line, which 128 bits was not. */
    function newRepairId() { return 'REP_' + randomHex(8).toUpperCase(); }

    function titleCase(str) {
        return String(str || '').toLowerCase().replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); });
    }

    /* Normalise a UK number to E.164 so a returning customer is recognised
       whether they wrote "07700 900123", "+447700900123" or "44 7700 900123". */
    function normalisePhone(raw) {
        var digits = String(raw || '').replace(/[^\d+]/g, '');
        if (!digits) return '';
        if (digits.indexOf('+') === 0) return '+' + digits.slice(1).replace(/\D/g, '');
        digits = digits.replace(/\D/g, '');
        if (digits.indexOf('44') === 0 && digits.length >= 11) return '+' + digits;
        if (digits.indexOf('0') === 0) return '+44' + digits.slice(1);
        return '+' + digits;
    }

    function isValidPhone(raw) {
        var e164 = normalisePhone(raw);
        return /^\+\d{10,15}$/.test(e164);
    }

    function isValidEmail(raw) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(raw || '').trim());
    }

    function money(value) {
        var n = parseFloat(value);
        return isFinite(n) ? '£' + n.toFixed(2) : null;
    }

    function toast(message, kind) {
        var el = document.createElement('div');
        el.className = 'toast toast--' + (kind || 'info');
        el.textContent = message;
        el.setAttribute('role', 'status');
        document.body.appendChild(el);
        setTimeout(function () {
            el.style.transition = 'opacity .25s';
            el.style.opacity = '0';
            setTimeout(function () { el.remove(); }, 260);
        }, 3600);
    }

    function showOverlay(title, text) {
        $('#overlay-title').textContent = title;
        $('#overlay-text').textContent = text || '';
        $('#overlay').classList.add('is-shown');
    }
    function hideOverlay() { $('#overlay').classList.remove('is-shown'); }

    function setFieldError(name, shown) {
        var el = document.querySelector('[data-error-for="' + name + '"]');
        if (el) el.classList.toggle('is-shown', !!shown);
    }
    function clearAllErrors() {
        $$('.field__error').forEach(function (el) { el.classList.remove('is-shown'); });
        $$('.is-invalid').forEach(function (el) { el.classList.remove('is-invalid'); });
    }

    // ------------------------------------------------------------------
    // State
    // ------------------------------------------------------------------

    var STEPS = ['tech', 'customer', 'done'];

    var state = {
        repairId: newRepairId(),
        stepIndex: 0,
        submitting: false,
        submitted: false,
        user: null,

        category: '',
        unlockType: '',
        accessories: [],
        condition: [],

        photos: [],          // { id, previewUrl, status, url, path, task }
        matchedCustomerId: '',
        matchedCustomer: null,

        signatureStrokes: [] // arrays of {x, y} in CSS pixels
    };

    // ------------------------------------------------------------------
    // Auth gate
    // ------------------------------------------------------------------

    auth.onAuthStateChanged(function (user) {
        state.user = user || null;
        if (user) {
            $('#topbar-meta').innerHTML =
                '<strong>' + escapeHTML(user.email || 'Signed in') + '</strong><br>Ticket ' +
                escapeHTML(state.repairId);
            $('#gate-shell').hidden = true;
            $('#flow').hidden = false;
            $('#actionbar').hidden = false;
            renderStep();
        } else {
            $('#topbar-meta').innerHTML = '<strong>Not signed in</strong>';
            $('#gate-shell').hidden = false;
            $('#flow').hidden = true;
            $('#actionbar').hidden = true;
        }
    });

    // ------------------------------------------------------------------
    // Step navigation
    // ------------------------------------------------------------------

    function currentStep() { return STEPS[state.stepIndex]; }

    function renderStep() {
        var name = currentStep();

        // Drives the CSS that strips staff chrome from the customer's screen.
        document.body.dataset.step = name;

        $$('.step').forEach(function (el) {
            el.classList.toggle('is-active', el.dataset.step === name);
        });

        // Progress rail covers the six input steps; "done" fills it entirely.
        var rail = $('#steprail');
        rail.innerHTML = '';
        var railSegments = STEPS.length - 1;   // every step except 'done'
        for (var i = 0; i < railSegments; i++) {
            var seg = document.createElement('div');
            seg.className = 'steprail__seg' +
                (i < state.stepIndex ? ' is-done' : (i === state.stepIndex ? ' is-current' : ''));
            rail.appendChild(seg);
        }
        rail.setAttribute('aria-valuenow', String(Math.min(state.stepIndex + 1, railSegments)));

        var back = $('#btn-back');
        var next = $('#btn-next');
        var note = $('#actionbar-note');

        back.hidden = (state.stepIndex === 0 || name === 'done');
        note.textContent = '';

        if (name === 'done') {
            $('#actionbar').hidden = true;
        } else {
            $('#actionbar').hidden = false;
        }

        if (name === 'customer') {
            next.innerHTML = 'Agree &amp; create repair <svg class="icon" width="18" height="18"><use href="#i-check"/></svg>';
            renderSummary($('#sign-summary'), true);
            renderSummaryPhotos();
            $('#terms-body').innerHTML = TERMS_HTML;
            $('#terms-version').textContent = 'Version ' + TERMS_VERSION + ' · ' + TERMS_EFFECTIVE;
            sizeSignaturePad();
        } else if (name === 'tech') {
            next.innerHTML = 'Hand to customer <svg class="icon" width="18" height="18"><use href="#i-arrow-right"/></svg>';
            note.textContent = state.photos.length + ' photo' + (state.photos.length === 1 ? '' : 's') + ' captured';
        } else {
            next.innerHTML = 'Continue <svg class="icon" width="18" height="18"><use href="#i-arrow-right"/></svg>';
        }

        window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
    }

    function goNext() {
        clearAllErrors();
        if (!validateStep(currentStep())) return;

        if (currentStep() === 'customer') { submitIntake(); return; }

        state.stepIndex = Math.min(state.stepIndex + 1, STEPS.length - 1);
        renderStep();
    }

    function goBack() {
        clearAllErrors();
        state.stepIndex = Math.max(state.stepIndex - 1, 0);
        renderStep();
    }

    // ------------------------------------------------------------------
    // Validation
    // ------------------------------------------------------------------

    function requireText(id, name, min) {
        var el = $(id);
        var ok = el.value.trim().length >= (min || 1);
        el.classList.toggle('is-invalid', !ok);
        setFieldError(name, !ok);
        return ok;
    }

    function validateStep(name) {
        var ok = true;
        var firstBad = null;

        function fail(el) { if (!firstBad) firstBad = el; ok = false; }

        if (name === 'tech') {
            if (!state.category) { setFieldError('category', true); fail($('[data-chipgroup="category"]')); }
            if (!requireText('#f-brand', 'brand')) fail($('#f-brand'));
            if (!requireText('#f-model', 'model')) fail($('#f-model'));
            if (!requireText('#f-issue', 'issue', 5)) fail($('#f-issue'));

            var settled = state.photos.filter(function (p) { return p.status === 'done'; });
            var inflight = state.photos.some(function (p) { return p.status === 'uploading'; });
            if (inflight) {
                toast('Photos are still uploading — give it a second.', 'info');
                return false;
            }
            if (!settled.length) { setFieldError('photos', true); ok = false; }
        }

        if (name === 'customer') {
            if (!requireText('#f-first', 'firstName')) fail($('#f-first'));
            if (!requireText('#f-last', 'lastName')) fail($('#f-last'));

            var emailEl = $('#f-email');
            if (!isValidEmail(emailEl.value)) {
                emailEl.classList.add('is-invalid'); setFieldError('email', true); fail(emailEl);
            }
            var phoneEl = $('#f-phone');
            if (!isValidPhone(phoneEl.value)) {
                phoneEl.classList.add('is-invalid'); setFieldError('phone', true); fail(phoneEl);
            }

            var acks = ['#f-ack-owner', '#f-ack-backup', '#f-ack-terms'].every(function (id) { return $(id).checked; });
            if (!acks) { setFieldError('acks', true); ok = false; }
            if (!state.signatureStrokes.length) { setFieldError('signature', true); ok = false; }
        }

        if (firstBad && firstBad.scrollIntoView) {
            firstBad.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else if (!ok) {
            var err = $('.step.is-active .field__error.is-shown');
            if (err) err.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        return ok;
    }

    // ------------------------------------------------------------------
    // Chip + checkbox groups
    // ------------------------------------------------------------------

    /* These two setters exist instead of a computed `state[key] = value`.
       A dynamic write means any group name appearing in the markup could
       reach any field on the shared state object — including state.photos,
       which feeds image URLs straight into the DOM. Routing every write
       through an explicit switch keeps a value read out of the page
       confined to the one field it belongs to. */
    function setChoice(key, value) {
        var choice = String(value == null ? '' : value);
        if (key === 'category') state.category = choice;
        else if (key === 'unlockType') state.unlockType = choice;
    }

    function setChecks(key, values) {
        var picked = values.map(function (value) { return String(value == null ? '' : value); });
        if (key === 'accessories') state.accessories = picked;
        else if (key === 'condition') state.condition = picked;
    }

    $$('[data-chipgroup]').forEach(function (group) {
        var key = group.dataset.chipgroup;
        group.addEventListener('click', function (event) {
            var chip = event.target.closest('.chip');
            if (!chip || !group.contains(chip)) return;

            $$('.chip', group).forEach(function (c) {
                var on = (c === chip);
                c.classList.toggle('is-selected', on);
                c.setAttribute('aria-checked', on ? 'true' : 'false');
            });
            setChoice(key, chip.dataset.value);
            setFieldError(key, false);

            if (key === 'unlockType') {
                var needsCode = ['pin', 'pattern', 'password'].indexOf(chip.dataset.value) !== -1;
                $('#unlock-code-field').hidden = !needsCode;
                if (!needsCode) $('#f-unlock').value = '';
            }
        });
    });

    $$('[data-checkgroup]').forEach(function (group) {
        var key = group.dataset.checkgroup;
        group.addEventListener('change', function () {
            var picked = [];
            $$('input[type="checkbox"]', group).forEach(function (input) {
                input.closest('.checkbox').classList.toggle('is-checked', input.checked);
                if (input.checked) picked.push(input.value);
            });
            setChecks(key, picked);
        });
    });

    // Standalone checkboxes (consents, marketing) just mirror their visual state.
    $$('[data-single]').forEach(function (label) {
        var input = $('input', label);
        input.addEventListener('change', function () {
            label.classList.toggle('is-checked', input.checked);
            setFieldError('acks', false);
        });
    });

    // Quick-job chips
    (function buildQuickJobs() {
        var wrap = $('#quickjobs');
        QUICK_JOBS.forEach(function (job, index) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'chip';
            btn.textContent = job.label;
            btn.dataset.jobIndex = String(index);
            wrap.appendChild(btn);
        });
        wrap.addEventListener('click', function (event) {
            var chip = event.target.closest('.chip');
            if (!chip) return;
            applyQuickJob(QUICK_JOBS[parseInt(chip.dataset.jobIndex, 10)]);
            $$('.chip', wrap).forEach(function (c) { c.classList.remove('is-selected'); });
            chip.classList.add('is-selected');
        });
    })();

    function applyQuickJob(job) {
        if (!job) return;
        $('#f-issue').value = job.issue;
        if (job.brand && !$('#f-brand').value.trim()) $('#f-brand').value = job.brand;
        if (job.model && !$('#f-model').value.trim()) $('#f-model').value = job.model;
        if (job.category && !state.category) {
            var chip = document.querySelector('[data-chipgroup="category"] .chip[data-value="' + job.category + '"]');
            if (chip) chip.click();
        }
        setFieldError('issue', false);
        $('#f-issue').classList.remove('is-invalid');
    }

    // ------------------------------------------------------------------
    // Photos — upload immediately, show per-tile state
    // ------------------------------------------------------------------

    $('#btn-camera').addEventListener('click', function () { $('#input-camera').click(); });
    $('#btn-library').addEventListener('click', function () { $('#input-library').click(); });

    $('#input-camera').addEventListener('change', function (e) { intakeFiles(e.target.files); e.target.value = ''; });
    $('#input-library').addEventListener('change', function (e) { intakeFiles(e.target.files); e.target.value = ''; });

    function intakeFiles(fileList) {
        Array.prototype.forEach.call(fileList || [], function (file) {
            if (state.photos.length >= MAX_PHOTOS) {
                toast('Maximum ' + MAX_PHOTOS + ' photos per ticket.', 'error');
                return;
            }
            // HEIC from an iPad camera sometimes arrives with an empty type.
            var typeOk = file.type
                ? ALLOWED_IMAGE_TYPES.indexOf(file.type) !== -1 || file.type.indexOf('image/') === 0
                : /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name || '');
            if (!typeOk) { toast('Skipped "' + file.name + '" — not an image.', 'error'); return; }
            if (file.size > MAX_PHOTO_BYTES) { toast('Skipped "' + file.name + '" — over 10MB.', 'error'); return; }
            addPhoto(file);
        });
        setFieldError('photos', false);
    }

    function addPhoto(file) {
        var ext = (file.name && file.name.indexOf('.') !== -1)
            ? file.name.slice(file.name.lastIndexOf('.')).toLowerCase().slice(0, 6)
            : '.jpg';
        var photo = {
            id: 'p' + randomHex(6),
            path: 'repairs/' + state.repairId + '/' + randomHex(8) + ext,
            previewUrl: URL.createObjectURL(file),
            status: 'uploading',
            url: '',
            file: file
        };
        state.photos.push(photo);
        renderPhotos();
        uploadPhoto(photo);
    }

    function uploadPhoto(photo) {
        photo.status = 'uploading';
        renderPhotos();

        var ref = storage.ref().child(photo.path);
        var task = ref.put(photo.file, { contentType: photo.file.type || 'image/jpeg' });
        photo.task = task;

        task.then(function (snapshot) {
            return snapshot.ref.getDownloadURL();
        }).then(function (url) {
            photo.url = url;
            photo.status = 'done';
            photo.file = null;
            renderPhotos();
        }).catch(function (err) {
            console.error('Photo upload failed', err);
            photo.status = 'failed';
            renderPhotos();
            toast('A photo failed to upload — tap it to retry.', 'error');
        });
    }

    function renderPhotos() {
        var grid = $('#photo-grid');
        grid.innerHTML = '';

        state.photos.forEach(function (photo) {
            var tile = document.createElement('div');
            tile.className = 'photo' + (photo.status === 'uploading' ? ' is-uploading' : '');
            tile.dataset.photoId = photo.id;

            var img = document.createElement('img');
            img.src = photo.previewUrl;
            img.alt = 'Device photo';
            tile.appendChild(img);

            var remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'photo__remove';
            remove.setAttribute('aria-label', 'Remove photo');
            remove.innerHTML = '<svg class="icon" width="16" height="16"><use href="#i-x"/></svg>';
            remove.addEventListener('click', function (e) { e.stopPropagation(); removePhoto(photo.id); });
            tile.appendChild(remove);

            var stateEl = document.createElement('div');
            stateEl.className = 'photo__state is-' + photo.status;
            stateEl.textContent = photo.status === 'uploading' ? 'Uploading…'
                : photo.status === 'done' ? 'Saved'
                    : 'Failed — tap to retry';
            tile.appendChild(stateEl);

            if (photo.status === 'failed') {
                tile.style.cursor = 'pointer';
                tile.addEventListener('click', function () {
                    if (photo.file) uploadPhoto(photo);
                });
            }

            grid.appendChild(tile);
        });

        var note = $('#actionbar-note');
        if (currentStep() === 'tech') {
            note.textContent = state.photos.length + ' photo' + (state.photos.length === 1 ? '' : 's') + ' captured';
        }
    }

    function removePhoto(photoId) {
        var index = state.photos.findIndex(function (p) { return p.id === photoId; });
        if (index === -1) return;
        var photo = state.photos[index];

        if (photo.task && photo.status === 'uploading') {
            try { photo.task.cancel(); } catch (err) { /* already settled */ }
        }
        // Uploaded bytes are removed too, so an abandoned shot leaves nothing behind.
        if (photo.status === 'done') {
            storage.ref().child(photo.path).delete().catch(function (err) {
                console.warn('Could not delete photo from storage', err);
            });
        }
        URL.revokeObjectURL(photo.previewUrl);
        state.photos.splice(index, 1);
        renderPhotos();
    }

    // ------------------------------------------------------------------
    // Returning customer lookup
    // ------------------------------------------------------------------

    var recallTimer = null;

    function scheduleRecall() {
        clearTimeout(recallTimer);
        recallTimer = setTimeout(lookupCustomer, 400);
    }

    $('#f-email').addEventListener('blur', scheduleRecall);
    $('#f-phone').addEventListener('blur', scheduleRecall);

    function lookupCustomer() {
        var email = $('#f-email').value.trim().toLowerCase();
        var phone = normalisePhone($('#f-phone').value);

        var query = null;
        if (isValidEmail(email)) {
            query = db.collection('customers').where('emailLower', '==', email).limit(1);
        } else if (isValidPhone(phone)) {
            query = db.collection('customers').where('phoneE164', '==', phone).limit(1);
        }
        if (!query) return;

        query.get().then(function (snap) {
            if (snap.empty) { hideRecall(); return; }
            var doc = snap.docs[0];
            var data = doc.data();
            state.matchedCustomerId = doc.id;
            state.matchedCustomer = data;

            var count = data.repairCount || 0;
            $('#recall-text').innerHTML =
                '<strong>' + escapeHTML(data.firstName + ' ' + data.lastName) + '</strong> is already on file' +
                (count ? ' — ' + count + ' previous repair' + (count === 1 ? '' : 's') : '') + '.';
            $('#recall').classList.add('is-shown');
        }).catch(function (err) {
            console.warn('Customer lookup failed', err);
        });
    }

    function hideRecall() {
        state.matchedCustomerId = '';
        state.matchedCustomer = null;
        $('#recall').classList.remove('is-shown');
    }

    $('#recall-fill').addEventListener('click', function () {
        var c = state.matchedCustomer;
        if (!c) return;
        if (c.firstName) $('#f-first').value = c.firstName;
        if (c.lastName) $('#f-last').value = c.lastName;
        if (c.email) $('#f-email').value = c.email;
        if (c.phone) $('#f-phone').value = c.phone;
        $('#recall').classList.remove('is-shown');
        clearAllErrors();
        toast('Details filled in — please check they are still right.', 'success');
    });

    // ------------------------------------------------------------------
    // Signature pad
    // ------------------------------------------------------------------

    var sigCanvas = $('#sig-canvas');
    var sigCtx = sigCanvas.getContext('2d');
    var drawing = false;
    var activeStroke = null;

    function sizeSignaturePad() {
        var box = $('#sigpad');
        var ratio = window.devicePixelRatio || 1;
        var width = box.clientWidth;
        var height = box.clientHeight;
        if (!width || !height) return;

        sigCanvas.width = Math.round(width * ratio);
        sigCanvas.height = Math.round(height * ratio);
        sigCanvas.style.width = width + 'px';
        sigCanvas.style.height = height + 'px';
        sigCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
        redrawSignature();
    }

    function redrawSignature() {
        sigCtx.save();
        sigCtx.setTransform(1, 0, 0, 1, 0, 0);
        sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
        sigCtx.restore();

        sigCtx.lineWidth = 2.6;
        sigCtx.lineCap = 'round';
        sigCtx.lineJoin = 'round';
        sigCtx.strokeStyle = '#111827';

        state.signatureStrokes.forEach(function (stroke) {
            if (stroke.length < 2) {
                if (stroke.length === 1) {
                    sigCtx.beginPath();
                    sigCtx.arc(stroke[0].x, stroke[0].y, 1.4, 0, Math.PI * 2);
                    sigCtx.fillStyle = '#111827';
                    sigCtx.fill();
                }
                return;
            }
            sigCtx.beginPath();
            sigCtx.moveTo(stroke[0].x, stroke[0].y);
            for (var i = 1; i < stroke.length - 1; i++) {
                var mid = { x: (stroke[i].x + stroke[i + 1].x) / 2, y: (stroke[i].y + stroke[i + 1].y) / 2 };
                sigCtx.quadraticCurveTo(stroke[i].x, stroke[i].y, mid.x, mid.y);
            }
            sigCtx.lineTo(stroke[stroke.length - 1].x, stroke[stroke.length - 1].y);
            sigCtx.stroke();
        });

        $('#sigpad').classList.toggle('has-ink', state.signatureStrokes.length > 0);
    }

    function pointFrom(event) {
        var rect = sigCanvas.getBoundingClientRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    sigCanvas.addEventListener('pointerdown', function (event) {
        event.preventDefault();
        drawing = true;
        sigCanvas.setPointerCapture(event.pointerId);
        activeStroke = [pointFrom(event)];
        state.signatureStrokes.push(activeStroke);
        setFieldError('signature', false);
        redrawSignature();
    });

    sigCanvas.addEventListener('pointermove', function (event) {
        if (!drawing || !activeStroke) return;
        event.preventDefault();
        activeStroke.push(pointFrom(event));
        redrawSignature();
    });

    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (type) {
        sigCanvas.addEventListener(type, function (event) {
            if (!drawing) return;
            drawing = false;
            activeStroke = null;
            try { sigCanvas.releasePointerCapture(event.pointerId); } catch (err) { /* not captured */ }
            $('#sig-note').textContent = 'Signed. Tap Clear to start again.';
        });
    });

    $('#sig-clear').addEventListener('click', function () {
        state.signatureStrokes = [];
        redrawSignature();
        $('#sig-note').textContent = 'Draw your signature in the white box above.';
    });

    window.addEventListener('resize', function () {
        if (currentStep() === 'customer') sizeSignaturePad();
    });
    window.addEventListener('orientationchange', function () {
        setTimeout(function () { if (currentStep() === 'customer') sizeSignaturePad(); }, 300);
    });

    function signatureBlob() {
        return new Promise(function (resolve, reject) {
            // Flatten onto white so the PNG reads correctly in any viewer.
            var out = document.createElement('canvas');
            out.width = sigCanvas.width;
            out.height = sigCanvas.height;
            var ctx = out.getContext('2d');
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, out.width, out.height);
            ctx.drawImage(sigCanvas, 0, 0);
            out.toBlob(function (blob) {
                blob ? resolve(blob) : reject(new Error('Could not render signature'));
            }, 'image/png');
        });
    }

    // ------------------------------------------------------------------
    // Summaries
    // ------------------------------------------------------------------

    function collectDevice() {
        var brand = $('#f-brand').value.trim();
        var model = $('#f-model').value.trim();
        return {
            category: state.category,
            brand: brand,
            model: model,
            device: (brand + ' ' + model).trim(),
            serial: $('#f-serial').value.trim(),
            colour: $('#f-colour').value.trim(),
            unlockType: state.unlockType,
            unlockCode: $('#f-unlock').value.trim(),
            accessories: state.accessories.slice(),
            condition: state.condition.slice(),
            conditionNotes: $('#f-condition-notes').value.trim(),
            issue: $('#f-issue').value.trim(),
            price: $('#f-price').value.trim(),
            deposit: $('#f-deposit').value.trim(),
            turnaround: $('#f-turnaround').value
        };
    }

    function renderSummaryPhotos() {
        var target = $('#sign-photos');
        var saved = state.photos.filter(function (photo) { return photo.status === 'done'; });

        if (!saved.length) {
            target.hidden = true;
            target.innerHTML = '';
            return;
        }

        target.hidden = false;
        target.innerHTML = '<p class="summary-photos__label">Photos we took of your device</p>' +
            '<div class="summary-photos__grid">' +
            saved.map(function (photo) {
                return '<img class="summary-photos__item" src="' + escapeHTML(photo.previewUrl) +
                    '" alt="Photo of your device">';
            }).join('') +
            '</div>';
    }

    function renderSummary(target, forCustomer) {
        var d = collectDevice();
        var rows = [];

        rows.push(['Device', d.device || '—']);
        if (d.colour) rows.push(['Colour / marks', d.colour]);
        if (d.serial) rows.push(['Serial / IMEI', d.serial]);
        rows.push(['Reported fault', d.issue || '—']);

        if (d.condition.length) rows.push(['Condition noted', d.condition.join(', ')]);
        if (d.conditionNotes) rows.push(['Condition notes', d.conditionNotes]);
        if (d.accessories.length) rows.push(['Left with device', d.accessories.join(', ')]);

        var price = money(d.price);
        rows.push(['Estimated price', price || 'To be quoted after diagnostics', price ? 'is-price' : '']);
        var deposit = money(d.deposit);
        if (deposit) rows.push(['Deposit paid today', deposit]);
        if (d.turnaround) rows.push(['Expected turnaround', d.turnaround]);

        rows.push(['Photos on file', String(state.photos.filter(function (p) { return p.status === 'done'; }).length)]);
        if (!forCustomer && d.unlockType) {
            rows.push(['Unlock', d.unlockType === 'withheld' ? 'Customer withheld' : titleCase(d.unlockType)]);
        }
        rows.push(['Ticket', state.repairId]);

        target.innerHTML = rows.map(function (row) {
            return '<div class="summary__row">' +
                '<div class="summary__key">' + escapeHTML(row[0]) + '</div>' +
                '<div class="summary__val ' + (row[2] || '') + '">' + escapeHTML(row[1]) + '</div>' +
                '</div>';
        }).join('');
    }

    // ------------------------------------------------------------------
    // Submit
    // ------------------------------------------------------------------

    function deviceTypeFor(category, brand) {
        var b = String(brand || '').toLowerCase();
        var isApple = b.indexOf('apple') !== -1;
        switch (category) {
            case 'phone': return isApple ? 'iPhone' : (b.indexOf('samsung') !== -1 ? 'Samsung' : 'Android');
            case 'tablet': return isApple ? 'iPad' : 'Tablet';
            case 'laptop': return isApple ? 'MacBook' : 'Laptop';
            case 'desktop': return 'Desktop';
            case 'console': return 'Gaming Console';
            default: return 'Device';
        }
    }

    async function submitIntake() {
        if (state.submitting) return;
        state.submitting = true;
        $('#btn-next').disabled = true;

        var delivery = [];

        try {
            showOverlay('Saving the signature…');
            var d = collectDevice();

            // 1) Signature into an admin-only Storage path (never public-read).
            var signature = { url: '', path: '' };
            try {
                var blob = await signatureBlob();
                var sigPath = 'consents/' + state.repairId + '/signature.png';
                var sigSnap = await storage.ref().child(sigPath).put(blob, { contentType: 'image/png' });
                signature.url = await sigSnap.ref.getDownloadURL();
                signature.path = sigPath;
            } catch (err) {
                console.error('Signature upload failed', err);
                hideOverlay();
                toast('Could not save the signature. Check the connection and try again.', 'error');
                state.submitting = false;
                $('#btn-next').disabled = false;
                return;
            }

            // 2) The repair document.
            showOverlay('Creating the repair ticket…');

            var firstName = $('#f-first').value.trim();
            var lastName = $('#f-last').value.trim();
            var email = $('#f-email').value.trim();
            var phone = $('#f-phone').value.trim();
            var customerName = (firstName + ' ' + lastName).trim();
            var now = firebase.firestore.Timestamp.now();
            var photoUrls = state.photos.filter(function (p) { return p.status === 'done'; }).map(function (p) { return p.url; });
            var photoPaths = state.photos.filter(function (p) { return p.status === 'done'; }).map(function (p) { return p.path; });

            var repairData = {
                // --- fields the tracking + admin pages already read ---
                repairId: state.repairId,
                customerName: customerName || 'Unknown',
                firstName: firstName,
                lastName: lastName,
                customerEmail: email,
                customerPhone: phone,
                device: d.device,
                brand: d.brand,
                model: d.model,
                deviceType: deviceTypeFor(d.category, d.brand),
                issueDescription: d.issue,
                estimatedCost: d.price ? parseFloat(d.price) : null,
                currentStatus: 'received',
                dateReceived: now,
                photos: photoUrls,
                createdBy: state.user ? state.user.email : 'unknown',
                createdAt: now,
                progress: [{
                    status: 'received',
                    timestamp: now,
                    notes: 'Device received in store, photographed and logged. Terms signed by customer.',
                    technician: state.user ? state.user.email : 'unknown'
                }],

                // --- in-store intake additions ---
                intakeChannel: 'in-store',
                deviceCategory: d.category,
                deviceSerial: d.serial,
                deviceColour: d.colour,
                unlockType: d.unlockType,
                unlockCode: d.unlockCode,
                accessories: d.accessories,
                conditionOnArrival: d.condition,
                conditionNotes: d.conditionNotes,
                depositPaid: d.deposit ? parseFloat(d.deposit) : null,
                turnaround: d.turnaround,
                photoPaths: photoPaths,
                customerId: state.matchedCustomerId || '',
                marketingOptIn: !!$('#f-marketing').checked,
                consent: {
                    termsVersion: TERMS_VERSION,
                    termsEffective: TERMS_EFFECTIVE,
                    signedName: customerName,
                    signedAt: now,
                    signatureUrl: signature.url,
                    signaturePath: signature.path,
                    acknowledgedOwnership: true,
                    acknowledgedBackup: true,
                    acknowledgedTerms: true,
                    witnessedBy: state.user ? state.user.email : 'unknown'
                }
            };

            await db.collection('repairs').add(repairData);

            // 3) Customer record. Non-fatal: the repair is already safe.
            showOverlay('Updating the customer record…');
            try {
                await upsertCustomer({
                    firstName: firstName, lastName: lastName, email: email, phone: phone,
                    marketingOptIn: repairData.marketingOptIn
                });
            } catch (err) {
                console.error('Customer record update failed', err);
                delivery.push(['warn', 'Customer record not updated — the repair itself saved fine.']);
            }

            // 4) Notifications. Also non-fatal.
            showOverlay('Sending the confirmation…');
            var trackUrl = SITE_URL + '/track/?id=' + state.repairId;

            try {
                await queueCustomerEmail(repairData, trackUrl);
                delivery.push(['ok', 'Confirmation email queued to ' + email]);
            } catch (err) {
                console.error('Customer email failed', err);
                delivery.push(['fail', 'Confirmation email could NOT be queued — send it by hand.']);
            }

            try {
                await queueStaffEmail(repairData, trackUrl);
                delivery.push(['ok', 'Text-the-customer link sent to ' + SHOP_EMAIL]);
            } catch (err) {
                console.error('Staff email failed', err);
                delivery.push(['warn', 'Staff copy could not be sent — use the button below instead.']);
            }

            state.submitted = true;
            showDone(repairData, trackUrl, delivery);

        } catch (err) {
            console.error('Intake failed', err);
            hideOverlay();
            toast('Could not create the repair: ' + (err && err.message ? err.message : 'unknown error'), 'error');
            state.submitting = false;
            $('#btn-next').disabled = false;
        }
    }

    async function upsertCustomer(customer) {
        var payload = {
            firstName: customer.firstName,
            lastName: customer.lastName,
            fullName: (customer.firstName + ' ' + customer.lastName).trim(),
            email: customer.email,
            emailLower: customer.email.toLowerCase(),
            phone: customer.phone,
            phoneE164: normalisePhone(customer.phone),
            marketingOptIn: customer.marketingOptIn,
            updatedAt: firebase.firestore.Timestamp.now(),
            lastRepairId: state.repairId,
            repairIds: firebase.firestore.FieldValue.arrayUnion(state.repairId),
            repairCount: firebase.firestore.FieldValue.increment(1)
        };

        var id = state.matchedCustomerId;
        if (!id) {
            // No match found during the lookup — check once more in case the
            // customer edited their email after the debounce fired.
            var snap = await db.collection('customers')
                .where('emailLower', '==', payload.emailLower).limit(1).get();
            if (!snap.empty) id = snap.docs[0].id;
        }

        if (id) {
            await db.collection('customers').doc(id).set(payload, { merge: true });
        } else {
            payload.createdAt = firebase.firestore.Timestamp.now();
            await db.collection('customers').doc('CUS_' + randomHex(12).toUpperCase()).set(payload);
        }
    }

    // ------------------------------------------------------------------
    // Email (Firestore "Trigger Email" extension reads the mail collection)
    // ------------------------------------------------------------------

    function emailShell(bodyHtml) {
        return '<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:600px;margin:0 auto;' +
            'background:#0B0E14;color:#E5E9F0;padding:32px 28px;border-radius:16px;">' +
            '<div style="font-size:22px;font-weight:800;margin-bottom:24px;">Online<span style="color:#00E4FF;">Fix</span></div>' +
            bodyHtml +
            '<hr style="border:none;border-top:1px solid rgba(255,255,255,.12);margin:28px 0;">' +
            '<p style="font-size:12px;color:#94A3B8;line-height:1.6;margin:0;">OnlineFix · ' + escapeHTML(SHOP_ADDRESS) +
            '<br>' + escapeHTML(SHOP_PHONE) + ' · ' + escapeHTML(SHOP_EMAIL) + '</p></div>';
    }

    function queueCustomerEmail(repair, trackUrl) {
        var price = repair.estimatedCost !== null ? '£' + repair.estimatedCost.toFixed(2) : 'To be quoted after diagnostics';

        var html = emailShell(
            '<p style="font-size:16px;margin:0 0 16px;">Hi ' + escapeHTML(repair.firstName) + ',</p>' +
            '<p style="line-height:1.6;margin:0 0 20px;">Thanks for bringing your device in. It is booked into the workshop and here are the details we recorded.</p>' +
            '<table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px;">' +
            row('Repair reference', repair.repairId) +
            row('Device', repair.device) +
            row('Reported fault', repair.issueDescription) +
            row('Estimated price', price) +
            (repair.turnaround ? row('Expected turnaround', repair.turnaround) : '') +
            (repair.accessories.length ? row('Left with device', repair.accessories.join(', ')) : '') +
            '</table>' +
            '<a href="' + escapeHTML(trackUrl) + '" style="display:inline-block;background:#0033FF;color:#fff;' +
            'text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:700;">Track your repair</a>' +
            '<p style="font-size:13px;color:#94A3B8;line-height:1.6;margin:24px 0 0;">Keep this email — the link above is how you check progress at any time. ' +
            'We will contact you before carrying out any chargeable work, and again when the device is ready to collect. ' +
            'Payment on collection is by cash or bank transfer.</p>'
        );

        var text = 'Hi ' + repair.firstName + ',\n\n' +
            'Thanks for bringing your device in. It is booked into the workshop.\n\n' +
            'Repair reference: ' + repair.repairId + '\n' +
            'Device: ' + repair.device + '\n' +
            'Reported fault: ' + repair.issueDescription + '\n' +
            'Estimated price: ' + price + '\n' +
            (repair.turnaround ? 'Expected turnaround: ' + repair.turnaround + '\n' : '') +
            '\nTrack your repair: ' + trackUrl + '\n\n' +
            'We will contact you before any chargeable work, and again when it is ready to collect.\n' +
            'Payment on collection is by cash or bank transfer.\n\n' +
            'OnlineFix · ' + SHOP_ADDRESS + '\n' + SHOP_PHONE + ' · ' + SHOP_EMAIL + '\n';

        return db.collection('mail').add({
            to: [repair.customerEmail],
            replyTo: SHOP_EMAIL,
            message: {
                subject: 'Your repair is booked in — ' + repair.repairId,
                text: text,
                html: html
            },
            meta: { kind: 'repair-created', repairId: repair.repairId, createdAt: firebase.firestore.Timestamp.now() }
        });
    }

    function queueStaffEmail(repair, trackUrl) {
        /* The shop iPad has no SIM, so it cannot send the customer's text.
           This email lands on the owner's phone with a button that opens a
           page which in turn fires the sms: link — an sms: href placed
           directly in an email is stripped by most mail clients. */
        var textPageUrl = SITE_URL + '/new-repair/text.html?id=' + encodeURIComponent(repair.repairId);
        var labelUrl = SITE_URL + '/new-repair/label.html?id=' + encodeURIComponent(repair.repairId);

        var html = emailShell(
            '<p style="font-size:16px;margin:0 0 8px;font-weight:700;">New intake — ' + escapeHTML(repair.repairId) + '</p>' +
            '<p style="color:#94A3B8;margin:0 0 20px;font-size:14px;">Logged by ' + escapeHTML(repair.createdBy) + '</p>' +
            '<table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px;">' +
            row('Customer', repair.customerName) +
            row('Phone', repair.customerPhone) +
            row('Email', repair.customerEmail) +
            row('Device', repair.device) +
            row('Fault', repair.issueDescription) +
            row('Estimate', repair.estimatedCost !== null ? '£' + repair.estimatedCost.toFixed(2) : 'TBC') +
            '</table>' +
            '<p style="font-weight:700;margin:0 0 12px;">Open this on your phone to text the customer:</p>' +
            '<a href="' + escapeHTML(textPageUrl) + '" style="display:inline-block;background:#0033FF;color:#fff;' +
            'text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:700;margin-bottom:16px;">Text the customer</a>' +
            '<p style="font-size:13px;color:#94A3B8;margin:16px 0 0;">' +
            'Print the device label: <a href="' + escapeHTML(labelUrl) + '" style="color:#00E4FF;">' + escapeHTML(labelUrl) + '</a><br>' +
            'Tracking page: <a href="' + escapeHTML(trackUrl) + '" style="color:#00E4FF;">' + escapeHTML(trackUrl) + '</a></p>'
        );

        return db.collection('mail').add({
            to: [SHOP_EMAIL],
            message: {
                subject: 'New intake ' + repair.repairId + ' — ' + repair.customerName + ' — ' + repair.device,
                text: 'New intake ' + repair.repairId + '\n' +
                    repair.customerName + ' · ' + repair.customerPhone + ' · ' + repair.customerEmail + '\n' +
                    repair.device + ' — ' + repair.issueDescription + '\n\n' +
                    'Text the customer: ' + textPageUrl + '\n' +
                    'Print label: ' + labelUrl + '\n' +
                    'Tracking: ' + trackUrl + '\n',
                html: html
            },
            meta: { kind: 'staff-intake', repairId: repair.repairId, createdAt: firebase.firestore.Timestamp.now() }
        });
    }

    function row(key, value) {
        return '<tr>' +
            '<td style="padding:8px 12px 8px 0;color:#94A3B8;vertical-align:top;white-space:nowrap;">' + escapeHTML(key) + '</td>' +
            '<td style="padding:8px 0;font-weight:600;">' + escapeHTML(value) + '</td>' +
            '</tr>';
    }

    // ------------------------------------------------------------------
    // Done screen
    // ------------------------------------------------------------------

    function showDone(repair, trackUrl, delivery) {
        hideOverlay();

        // Customer-facing half. Addressed to them by name, and says nothing
        // about tracking links or what was emailed to whom.
        $('#thanks-title').textContent = repair.firstName
            ? 'Thank you, ' + repair.firstName
            : 'Thank you';
        $('#thanks-text').textContent = 'Your ' + (repair.device || 'device') + ' is booked in with us.';
        $('#thanks-meta').textContent = repair.customerEmail
            ? 'Your confirmation is on its way to ' + repair.customerEmail +
              ", and we'll be in touch as soon as we have news."
            : "We'll be in touch as soon as we have news.";

        // Staff half, hidden until the technician asks for it.
        $('#staff-panel').hidden = true;
        $('#btn-staff').hidden = false;
        $('#done-url').textContent = trackUrl;

        $('#delivery').innerHTML = delivery.map(function (item) {
            var icon = item[0] === 'ok' ? '#i-check' : (item[0] === 'warn' ? '#i-alert' : '#i-x');
            return '<div class="delivery__row is-' + item[0] + '">' +
                '<svg class="icon" width="18" height="18"><use href="' + icon + '"/></svg>' +
                '<span>' + escapeHTML(item[1]) + '</span></div>';
        }).join('');

        $('#btn-text').href = 'text.html?id=' + encodeURIComponent(repair.repairId);
        $('#btn-label').href = 'label.html?id=' + encodeURIComponent(repair.repairId);

        $('#btn-copy-url').onclick = function () { copyText(trackUrl); };

        state.stepIndex = STEPS.indexOf('done');
        renderStep();
    }

    function copyText(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () {
                toast('Link copied.', 'success');
            }).catch(function () { fallbackCopy(text); });
        } else {
            fallbackCopy(text);
        }
    }

    function fallbackCopy(text) {
        var area = document.createElement('textarea');
        area.value = text;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        try {
            document.execCommand('copy');
            toast('Link copied.', 'success');
        } catch (err) {
            toast('Could not copy — select the link by hand.', 'error');
        }
        area.remove();
    }

    // ------------------------------------------------------------------
    // Wiring
    // ------------------------------------------------------------------

    $('#btn-next').addEventListener('click', goNext);
    $('#btn-back').addEventListener('click', goBack);

    $('#btn-staff').addEventListener('click', function () {
        $('#staff-panel').hidden = false;
        $('#btn-staff').hidden = true;
        $('#staff-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    $('#btn-new').addEventListener('click', function () {
        // A fresh ticket means a fresh unguessable ID and a clean slate.
        window.location.reload();
    });

    // Clear a field's error the moment the user starts fixing it.
    $$('.input, .textarea').forEach(function (el) {
        el.addEventListener('input', function () {
            el.classList.remove('is-invalid');
            if (el.name) setFieldError(el.name, false);
        });
    });

    // Guard against a stray swipe binning a half-finished intake.
    window.addEventListener('beforeunload', function (event) {
        if (state.submitted || state.stepIndex === 0) return;
        if (!state.photos.length && !$('#f-issue').value.trim()) return;
        event.preventDefault();
        event.returnValue = '';
    });

})();
