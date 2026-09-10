/* =====================================================================
   OnlineFix — device label page
   ---------------------------------------------------------------------
   The page around the label: sign-in, ticket lookup, roll picker and the
   turn control. The sticker itself is drawn by label-render.js, which the
   dashboard's Print label button also uses, so there is one design rather
   than two that drift apart.
   ===================================================================== */

(function () {
    'use strict';

    var Label = window.OnlineFixLabel;

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

    var repair = null;
    var rotated = false;

    function selectedSize() {
        return Label.sizeById($('#size').value);
    }

    function draw() {
        var size = selectedSize();
        Label.render($('#label'), repair, { size: size, rotated: rotated });
        Label.applyPageRule(document, size, rotated);
        $('#dims').textContent = size.w + ' × ' + size.h + ' mm' + (rotated ? ' · turned' : '');
    }

    function buildSizeOptions() {
        var select = $('#size');
        select.innerHTML = '';
        Label.SIZES.forEach(function (size) {
            var option = document.createElement('option');
            option.value = size.id;
            option.textContent = size.name + ' (' + size.w + ' × ' + size.h + ' mm)';
            select.appendChild(option);
        });

        // The roll loaded in the shop and the turn that came out right way up
        // are properties of this machine, and the dashboard's Print label
        // button reads the same two settings.
        select.value = Label.savedSizeId();
        rotated = Label.savedRotated();

        select.addEventListener('change', function () {
            Label.saveSizeId(select.value);
            draw();
        });

        $('#btn-rotate').addEventListener('click', function () {
            rotated = !rotated;
            Label.saveRotated(rotated);
            draw();
        });
    }

    $('#btn-print').addEventListener('click', function () {
        Label.printLabel($('#label'), {
            repair: repair, size: selectedSize(), rotated: rotated
        });
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

                $('#who').textContent = repair.customerName || 'Customer';
                buildSizeOptions();

                // Reveal before drawing. The renderer measures text to shrink
                // long lines to fit, and an element inside a hidden container
                // has no layout — every measurement comes back 0, so the fit
                // loops exit immediately and long names stay clipped.
                $('#content').hidden = false;
                draw();
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
