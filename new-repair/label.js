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
        { id: '99012', name: '99012 / S0722400 — Large address', w: 89, h: 36, scale: 1 },
        { id: '30252', name: '30252 — Address', w: 89, h: 28, scale: 0.9 },
        { id: '11354', name: '11354 / S0722540 — Multipurpose', w: 57, h: 32, scale: 0.8 },
        { id: '30336', name: '30336 — Small multipurpose', w: 54, h: 25, scale: 0.7 },
        { id: '11356', name: '11356 — Name badge', w: 101, h: 54, scale: 1.3 }
    ];

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

    function $(sel) { return document.querySelector(sel); }

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

    function renderLabel() {
        var size = selectedSize();
        var label = $('#label');

        label.style.width = size.w + 'mm';
        label.style.height = size.h + 'mm';
        label.style.fontSize = (2.4 * size.scale) + 'mm';

        $('#dims').textContent = size.w + ' × ' + size.h + ' mm';

        // @page has to match the roll or the driver scales or clips the output.
        $('#page-rule').textContent =
            '@page { size: ' + size.w + 'mm ' + size.h + 'mm; margin: 0; }';

        var received = repair.dateReceived && repair.dateReceived.seconds
            ? new Date(repair.dateReceived.seconds * 1000)
            : new Date();

        var price = (typeof repair.estimatedCost === 'number' && isFinite(repair.estimatedCost))
            ? '£' + repair.estimatedCost.toFixed(2)
            : 'TBC';

        var device = repair.device || [repair.brand, repair.model].filter(Boolean).join(' ') || 'Device';

        label.innerHTML =
            '<div class="label__top">' +
            '<span class="label__brand" style="font-size:' + (2.9 * size.scale) + 'mm">OnlineFix</span>' +
            '<span class="label__ref" style="font-size:' + (3.4 * size.scale) + 'mm">' + escapeHTML(shortRef(repair.repairId)) + '</span>' +
            '</div>' +
            '<div class="label__name" style="font-size:' + (3.1 * size.scale) + 'mm">' + escapeHTML(repair.customerName || '—') + '</div>' +
            '<div class="label__device" style="font-size:' + (2.6 * size.scale) + 'mm">' + escapeHTML(device) + '</div>' +
            '<div class="label__issue" style="font-size:' + (2.2 * size.scale) + 'mm">' + escapeHTML(repair.issueDescription || '') + '</div>' +
            '<div class="label__foot" style="font-size:' + (2 * size.scale) + 'mm">' +
            '<span>' + escapeHTML(repair.customerPhone || '') + '</span>' +
            '<span>' + escapeHTML(price) + '</span>' +
            '<span>' + received.toLocaleDateString('en-GB') + '</span>' +
            '</div>';
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
                renderLabel();

                $('#content').hidden = false;
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
