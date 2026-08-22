/* =====================================================================
   OnlineFix — text-the-customer handoff
   ---------------------------------------------------------------------
   The shop iPad has no SIM, so it can never send the customer's text.
   Instead the intake emails hello@onlinefix.uk a link to this page; the
   owner opens it on their phone and taps once.

   An sms: href placed directly in an email body gets stripped by most
   mail clients, which is exactly why this bounce page exists: the email
   carries an ordinary https link, and the sms: URI is only ever built
   inside a real web page where it works.
   ===================================================================== */

(function () {
    'use strict';

    var SITE_URL = 'https://onlinefix.co.uk';
    var SHOP_PHONE = '07940 730537';

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

    function normalisePhone(raw) {
        var digits = String(raw || '').replace(/[^\d+]/g, '');
        if (!digits) return '';
        if (digits.indexOf('+') === 0) return '+' + digits.slice(1).replace(/\D/g, '');
        digits = digits.replace(/\D/g, '');
        if (digits.indexOf('44') === 0 && digits.length >= 11) return '+' + digits;
        if (digits.indexOf('0') === 0) return '+44' + digits.slice(1);
        return '+' + digits;
    }

    function toast(message, kind) {
        var el = document.createElement('div');
        el.className = 'toast toast--' + (kind || 'info');
        el.textContent = message;
        el.setAttribute('role', 'status');
        el.style.bottom = '1.5rem';
        document.body.appendChild(el);
        setTimeout(function () { el.remove(); }, 3200);
    }

    var repair = null;
    var templates = [];
    var activeIndex = 0;

    function buildTemplates(r) {
        var name = r.firstName || (r.customerName || '').split(' ')[0] || 'there';
        var device = r.device || [r.brand, r.model].filter(Boolean).join(' ') || 'your device';
        var track = SITE_URL + '/track/?id=' + r.repairId;
        var price = (typeof r.estimatedCost === 'number' && isFinite(r.estimatedCost))
            ? '£' + r.estimatedCost.toFixed(2) : null;

        return [
            {
                label: 'Booked in',
                body: 'Hi ' + name + ', your ' + device + ' is booked in at OnlineFix. ' +
                    'Track it any time here: ' + track + ' — OnlineFix, ' + SHOP_PHONE
            },
            {
                label: 'Quote ready',
                body: 'Hi ' + name + ', we\'ve had a look at your ' + device + '. ' +
                    (price ? 'The repair comes to ' + price + '. ' : 'We\'ve got a quote for you. ') +
                    'Let us know if you\'re happy for us to go ahead: ' + track + ' — OnlineFix, ' + SHOP_PHONE
            },
            {
                label: 'Ready to collect',
                body: 'Hi ' + name + ', good news — your ' + device + ' is repaired and ready to collect ' +
                    'from 13 Quarry Street, Guildford GU1 3UY. ' +
                    (price ? 'Balance due is ' + price + ', cash or bank transfer. ' : 'Cash or bank transfer on collection. ') +
                    'Details: ' + track + ' — OnlineFix, ' + SHOP_PHONE
            },
            {
                label: 'Chasing collection',
                body: 'Hi ' + name + ', just a reminder that your ' + device + ' is repaired and waiting ' +
                    'for you at OnlineFix, 13 Quarry Street, Guildford GU1 3UY. ' +
                    'Give us a ring on ' + SHOP_PHONE + ' if you need a different time.'
            }
        ];
    }

    function renderTemplates() {
        var wrap = $('#templates');
        wrap.innerHTML = '';
        templates.forEach(function (tpl, index) {
            var chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'chip' + (index === activeIndex ? ' is-selected' : '');
            chip.textContent = tpl.label;
            chip.addEventListener('click', function () {
                activeIndex = index;
                renderTemplates();
                renderMessage();
            });
            wrap.appendChild(chip);
        });
    }

    function renderMessage() {
        var body = templates[activeIndex].body;
        $('#preview').textContent = body;

        var to = normalisePhone(repair.customerPhone);

        /* "sms:NUMBER?&body=..." is the one form both iOS and Android accept:
           iOS expects the first parameter after "&", Android after "?". */
        $('#btn-sms').href = 'sms:' + to + '?&body=' + encodeURIComponent(body);
        $('#btn-call').href = 'tel:' + to;
    }

    $('#btn-copy').addEventListener('click', function () {
        var body = templates[activeIndex].body;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(body)
                .then(function () { toast('Message copied.', 'success'); })
                .catch(function () { toast('Could not copy — select the text instead.', 'error'); });
        } else {
            toast('Copying is not supported here — select the text instead.', 'error');
        }
    });

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

                if (!repair.customerPhone) {
                    showError('That ticket has no phone number on it.');
                    return;
                }

                $('#who').textContent = repair.customerName || 'Customer';
                $('#what').innerHTML = escapeHTML(repair.device || '') +
                    ' · <span style="color:var(--accent-cyan)">' + escapeHTML(normalisePhone(repair.customerPhone)) + '</span>';

                templates = buildTemplates(repair);
                renderTemplates();
                renderMessage();

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
