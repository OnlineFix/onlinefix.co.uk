/* =====================================================================
   OnlineFix — DYMO LabelWriter 550 device label
   ---------------------------------------------------------------------
   Prints through the ordinary browser print path rather than the DYMO
   Connect SDK. That matters practically: the 550 is USB-only with no
   AirPrint, so labels have to come off the computer it is plugged into,
   and the SDK route would need a local helper service running as well.
   A correctly sized @page rule gets the same result with nothing to
   install.
   ===================================================================== */

(function () {
    'use strict';

    var SITE_URL = 'https://onlinefix.co.uk';

    /* Genuine DYMO rolls the 550 accepts, measured landscape
       (width = the direction the label feeds). */
    var LABEL_SIZES = [
        { id: '11354', name: '11354 / S0722540 — Multipurpose', w: 57, h: 32, scale: 0.78 },
        { id: '99012', name: '99012 / S0722400 — Large address', w: 89, h: 36, scale: 1 },
        { id: '30252', name: '30252 — Address', w: 89, h: 28, scale: 0.9 },
        { id: '30336', name: '30336 — Small multipurpose', w: 54, h: 25, scale: 0.7 },
        { id: '11356', name: '11356 — Name badge', w: 101, h: 54, scale: 1.3 }
    ];

    /* A LabelWriter feeds the label under a fixed-width head, and the Windows
       driver decides which way round that is. When the driver's idea of the
       paper disagrees with the @page rule below, the label prints sideways.
       Rather than send people into Windows print settings, this rotates the
       artwork a quarter turn and swaps the page box, which corrects it from
       the page itself. The choice is remembered per machine. */
    var rotated = false;

    var firebaseConfig = {
        apiKey: 'AIzaSyCKBlO4aHTVSjwyevg1OYZ0NWy3Y62HJuU',
        authDomain: 'onlinefix-repair.firebaseapp.com',
        projectId: 'onlinefix-repair',
        storageBucket: 'onlinefix-repair.firebasestorage.app',
        messagingSenderId: '382934797751',
        appId: '1:382934797751:web:5ac8a9c87d68a17b4cec32'
    };
    var RECAPTCHA_SITE_KEY = '6LdZJRIsAAAAAOx4EZqupxMVvX4B3u3YlK5ez-3r';

    firebase.initializeApp(firebaseConfig);
    try {
        firebase.appCheck().activate(
            new firebase.appCheck.ReCaptchaEnterpriseProvider(RECAPTCHA_SITE_KEY), true);
    } catch (err) {
        console.error('App Check activation failed', err);
    }
    var db = firebase.firestore();
    var auth = firebase.auth();

    function $(sel, root) { return (root || document).querySelector(sel); }

    function escapeHTML(value) {
        if (value === null || value === undefined) return '';
        return String(value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    /* Bench shorthand. The full 128-bit ID is what guards the tracking page;
       the last six characters are plenty to tell two devices apart on a
       shelf, which is all a physical label has to do. */
    function shortRef(repairId) {
        return '#' + String(repairId || '').slice(-6).toUpperCase();
    }

    var repair = null;

    function selectedSize() {
        var id = $('#size').value;
        return LABEL_SIZES.filter(function (s) { return s.id === id; })[0] || LABEL_SIZES[0];
    }

    /* Steps a single line down until it fits its width. The customer name is
       the thing you scan a shelf for, so losing the surname to an ellipsis is
       worse than setting a long name slightly smaller. Bounded by a floor so a
       very long name stays legible rather than shrinking away, and by a guard
       so a zero-width box cannot spin this. */
    function fitLine(el, startMm, floorMm) {
        var mm = startMm;
        el.style.fontSize = mm.toFixed(2) + 'mm';
        for (var i = 0; i < 40 && mm > floorMm; i++) {
            if (fitsWidth(el)) break;
            mm -= startMm * 0.04;
            el.style.fontSize = mm.toFixed(2) + 'mm';
        }
    }

    /* Measures the text itself rather than the box around it. scrollWidth is
       no use here: it never reports less than clientWidth, so an element that
       fills its row always looks exactly full whether the text needs 100px or
       200px — which pinned the phone number to its size floor no matter how
       much room the row actually had.

       The 1px margin is deliberate. text-overflow has to make room for the
       ellipsis glyph, so a single pixel of overrun swallows two or three
       characters: a number one pixel too wide printed as "07376 9122…". */
    function fitsWidth(el) {
        return textWidth(el) <= el.clientWidth - 1;
    }

    /* Measures in a scratch span parked on the body, outside the label. A
       rect read inside the label is no good in turned mode: the container is
       rotated 90deg, so a rect taken there reports the line's height as its
       width and every line "fits" however long it is. clientWidth, being
       layout-space, is unaffected by the rotation and stays comparable. */
    var gauge = null;
    function textWidth(el) {
        if (!gauge) {
            gauge = document.createElement('span');
            gauge.style.cssText =
                'position:absolute;left:-9999px;top:0;white-space:pre;visibility:hidden';
            document.body.appendChild(gauge);
        }
        var cs = window.getComputedStyle(el);
        gauge.style.font = cs.font;
        gauge.style.letterSpacing = cs.letterSpacing;
        gauge.textContent = el.textContent;
        return gauge.getBoundingClientRect().width;
    }

    /* Same idea as fitLine, but for a block that is allowed to wrap: shrink
       until the wrapped text fits inside its clamped height. Truncating the
       job loses what the repair actually is, which is half the point of the
       sticker, so it is worth a smaller size to keep it whole. */
    function fitBlock(el, startMm, floorMm) {
        var mm = startMm;
        el.style.fontSize = mm.toFixed(2) + 'mm';
        for (var i = 0; i < 40 && mm > floorMm; i++) {
            // Width matters as well as height: a single long word cannot wrap
            // away, so "Featherstonehaugh" overran the roll while the block's
            // height stayed within its two lines.
            // No safety margin on width here: a block that wraps fills its
            // width exactly, so scrollWidth == clientWidth is the normal
            // fitting state. Only an unbreakable word overruns it.
            if (el.scrollHeight <= el.clientHeight &&
                el.scrollWidth <= el.clientWidth) break;
            mm -= startMm * 0.05;
            el.style.fontSize = mm.toFixed(2) + 'mm';
        }
    }

    /* Labels show the number a person would actually dial. Intake stores
       E.164 ("+447911123456"), which is both longer than the roll can set at a
       readable size and not how anyone reads a number back over the counter. */
    function phoneForLabel(raw) {
        var text = String(raw || '').trim();
        if (!text) return '';
        var digits = text.replace(/[^\d+]/g, '');
        if (digits.indexOf('+44') === 0) digits = '0' + digits.slice(3);
        if (/^07\d{9}$/.test(digits)) return digits.slice(0, 5) + ' ' + digits.slice(5);
        return digits.indexOf('+') === 0 ? text : digits || text;
    }

    function renderLabel() {
        var size = selectedSize();
        var label = $('#label');
        var inner = $('#label-inner');

        // The page box follows the rotation; the artwork inside never changes
        // shape, it is just turned within that box.
        label.style.width = (rotated ? size.h : size.w) + 'mm';
        label.style.height = (rotated ? size.w : size.h) + 'mm';

        inner.style.width = size.w + 'mm';
        inner.style.height = size.h + 'mm';
        label.classList.toggle('is-rotated', rotated);

        $('#dims').textContent = size.w + ' × ' + size.h + ' mm' + (rotated ? ' · turned' : '');

        // @page has to match the roll or the driver scales or clips the output.
        $('#page-rule').textContent =
            '@page { size: ' + (rotated ? size.h : size.w) + 'mm ' +
            (rotated ? size.w : size.h) + 'mm; margin: 0; }';

        var h = size.h;
        var device = repair.device || [repair.brand, repair.model].filter(Boolean).join(' ') || 'Device';
        var job = repair.issueDescription || device;
        var received = repair.dateReceived && repair.dateReceived.seconds
            ? new Date(repair.dateReceived.seconds * 1000)
            : new Date();

        inner.innerHTML =
            '<div class="lbl-name"></div>' +
            '<div class="lbl-job"></div>' +
            '<div class="lbl-foot">' +
            '<span class="lbl-phone"></span><span class="lbl-date"></span>' +
            '</div>';

        $('.lbl-name', inner).textContent = repair.customerName || '—';
        $('.lbl-phone', inner).textContent = phoneForLabel(repair.customerPhone);

        // "22 Aug 26", not "22/08/2026". Four fewer characters on the row the
        // phone number has to share, and easier to read at a glance besides.
        $('.lbl-date', inner).textContent = received.toLocaleDateString('en-GB', {
            day: 'numeric', month: 'short', year: '2-digit'
        });

        var jobEl = $('.lbl-job', inner);
        jobEl.textContent = job;

        // Each block is measured against its own box. Measuring a row instead
        // was silently useless: the text inside clips itself to an ellipsis,
        // so the row never overflows and the loop exited on its first pass —
        // which is how "Alfie Ri…" reached the roll.
        var nameEl = $('.lbl-name', inner);
        var phoneEl = $('.lbl-phone', inner);

        fitBlock(nameEl, h * 0.205, h * 0.100);
        // The date is set small deliberately. It shares the row with the phone
        // number, and every millimetre it takes is a millimetre the phone
        // loses — at 0.115 the phone was pinned to its floor. A date is read
        // once for reference; a phone number is read across a workbench.
        $('.lbl-date', inner).style.fontSize = (h * 0.093).toFixed(2) + 'mm';
        fitLine(phoneEl, h * 0.190, h * 0.130);

        fitBlock(jobEl, h * 0.145, h * 0.085);

        // Last pass: the three blocks each fit their own box but can still
        // overrun the label together — a name that wrapped to two lines takes
        // the room the job was fitted into. The job is the only one that can
        // give ground without costing legibility of a name or a phone number.
        for (var i = 0; i < 30 && inner.scrollHeight > inner.clientHeight + 1; i++) {
            var mm = parseFloat(jobEl.style.fontSize);
            if (mm <= h * 0.070) break;
            jobEl.style.fontSize = (mm - h * 0.006).toFixed(2) + 'mm';
        }
    }

    function buildSizeOptions() {
        var select = $('#size');
        select.innerHTML = '';
        LABEL_SIZES.forEach(function (size) {
            var option = document.createElement('option');
            option.value = size.id;
            option.textContent = size.name + ' (' + size.w + ' × ' + size.h + ' mm)';
            select.appendChild(option);
        });

        // Remember the roll actually loaded in the shop between visits.
        var saved = null;
        try { saved = localStorage.getItem('onlinefix.labelSize'); } catch (err) { /* private mode */ }
        if (saved && LABEL_SIZES.some(function (s) { return s.id === saved; })) select.value = saved;

        select.addEventListener('change', function () {
            try { localStorage.setItem('onlinefix.labelSize', select.value); } catch (err) { /* private mode */ }
            renderLabel();
        });

        try { rotated = localStorage.getItem('onlinefix.labelRotated') === '1'; } catch (err) { /* private mode */ }
        $('#btn-rotate').addEventListener('click', function () {
            rotated = !rotated;
            try { localStorage.setItem('onlinefix.labelRotated', rotated ? '1' : '0'); } catch (err) { /* private mode */ }
            renderLabel();
        });
    }

    $('#btn-print').addEventListener('click', function () { window.print(); });

    function showError(message) {
        $('#error-text').textContent = message;
        $('#error').hidden = false;
        $('#content').hidden = true;
        $('#gate').hidden = true;
    }

    function load(repairId) {
        db.collection('repairs').where('repairId', '==', repairId).limit(1).get()
            .then(function (snap) {
                if (snap.empty) { showError('No repair matches that reference.'); return; }
                repair = snap.docs[0].data();

                $('#who').textContent = repair.customerName || 'Customer';
                buildSizeOptions();

                // Reveal before rendering. renderLabel measures text to shrink
                // long lines to fit, and an element inside a hidden container
                // has no layout — every measurement comes back 0, so the fit
                // loop exited immediately and long names stayed clipped.
                $('#content').hidden = false;
                renderLabel();
                $('#error').hidden = true;
                $('#gate').hidden = true;
            })
            .catch(function (err) {
                console.error('Lookup failed', err);
                showError('Could not load that ticket. Check your connection and reload.');
            });
    }

    auth.onAuthStateChanged(function (user) {
        var repairId = new URLSearchParams(window.location.search).get('id');

        if (!user) {
            $('#topbar-meta').innerHTML = '<strong>Not signed in</strong>';
            $('#gate').hidden = false;
            $('#content').hidden = true;
            $('#error').hidden = true;
            return;
        }

        $('#topbar-meta').innerHTML = '<strong>' + escapeHTML(user.email || 'Signed in') + '</strong>';
        $('#gate').hidden = true;

        if (!repairId) { showError('No repair reference in the link.'); return; }
        load(repairId);
    });

})();
