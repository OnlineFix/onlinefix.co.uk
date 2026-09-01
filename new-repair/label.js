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
            if (el.scrollWidth <= el.clientWidth + 1) break;
            mm -= startMm * 0.04;
            el.style.fontSize = mm.toFixed(2) + 'mm';
        }
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

        /* Three things only — who, what, and the number to ring — so each can
           be set large enough to read at arm's length on a shelf. Sized from
           the label's own height so it fills whichever roll is loaded. */
        var h = size.h;
        var mm = function (factor) { return (h * factor).toFixed(2) + 'mm'; };

        var device = repair.device || [repair.brand, repair.model].filter(Boolean).join(' ') || 'Device';
        var job = repair.issueDescription || device;

        inner.innerHTML =
            '<div class="lbl-name">' + escapeHTML(repair.customerName || '—') + '</div>' +
            '<div class="lbl-job" style="font-size:' + mm(0.155) + '">' +
            escapeHTML(job) + '</div>' +
            '<div class="lbl-phone">' + escapeHTML(repair.customerPhone || '') + '</div>';

        // Both of these are single lines that must survive intact.
        fitLine($('.lbl-name', inner), h * 0.215, h * 0.135);
        fitLine($('.lbl-phone', inner), h * 0.20, h * 0.135);
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
