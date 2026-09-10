/* =====================================================================
   OnlineFix — device label renderer
   ---------------------------------------------------------------------
   One label implementation, shared by the standalone label page and by
   the dashboard's Print label button. Deliberately free of Firebase: the
   caller passes a repair object, so the dashboard prints from the record
   it already holds without a second lookup, and without a second copy of
   this layout drifting away from the first.

   Printing goes through the ordinary browser print path rather than the
   DYMO Connect SDK. The 550 is USB-only with no AirPrint, so labels have
   to come off the computer it is plugged into either way, and the SDK
   route would need a local helper service running as well. A correctly
   sized @page rule gets the same result with nothing to install.
   ===================================================================== */

(function (global) {
    'use strict';

    /* Genuine DYMO rolls the 550 accepts, measured landscape
       (width = the direction the label feeds). */
    var SIZES = [
        { id: '11354', name: '11354 / S0722540 — Multipurpose', w: 57, h: 32 },
        { id: '99012', name: '99012 / S0722400 — Large address', w: 89, h: 36 },
        { id: '30252', name: '30252 — Address', w: 89, h: 28 },
        { id: '30336', name: '30336 — Small multipurpose', w: 54, h: 25 },
        { id: '11356', name: '11356 — Name badge', w: 101, h: 54 }
    ];

    var SIZE_KEY = 'onlinefix.labelSize';
    var ROTATED_KEY = 'onlinefix.labelRotated';

    function sizeById(id) {
        for (var i = 0; i < SIZES.length; i++) {
            if (SIZES[i].id === id) return SIZES[i];
        }
        return SIZES[0];
    }

    /* The roll loaded in the shop and the turn that came out the right way
       up are properties of the machine, not of a ticket, so both are
       remembered per browser. Wrapped because storage throws outright in
       private mode rather than returning null. */
    function savedSizeId() {
        try { return localStorage.getItem(SIZE_KEY) || SIZES[0].id; }
        catch (err) { return SIZES[0].id; }
    }

    function saveSizeId(id) {
        try { localStorage.setItem(SIZE_KEY, id); } catch (err) { /* private mode */ }
    }

    function savedRotated() {
        try { return localStorage.getItem(ROTATED_KEY) === '1'; }
        catch (err) { return false; }
    }

    function saveRotated(on) {
        try { localStorage.setItem(ROTATED_KEY, on ? '1' : '0'); }
        catch (err) { /* private mode */ }
    }

    /* --- measurement -------------------------------------------------- */

    /* Measures in a scratch span parked on the body, outside the label. A
       rect read inside the label is no good in turned mode: the container is
       rotated 90deg, so a rect taken there reports the line's height as its
       width and every line "fits" however long it is. clientWidth, being
       layout-space, is unaffected by the rotation and stays comparable. */
    var gauge = null;
    function textWidth(el) {
        if (!gauge || !gauge.isConnected) {
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

    /* scrollWidth is no use for a single line: it never reports less than
       clientWidth, so an element that fills its row always looks exactly full
       whether the text needs 100px or 200px — which pinned the phone number
       to its size floor no matter how much room the row actually had.

       The 1px margin is deliberate. text-overflow has to make room for the
       ellipsis glyph, so a single pixel of overrun swallows two or three
       characters: a number one pixel too wide printed as "07376 9122…". */
    function fitsWidth(el) {
        return textWidth(el) <= el.clientWidth - 1;
    }

    /* Steps a single line down until it fits its width. The phone number is
       read across a workbench, so setting it slightly smaller beats losing
       its last digits to an ellipsis. Bounded by a floor so it stays legible
       rather than shrinking away, and by a guard so a zero-width box cannot
       spin this. */
    function fitLine(el, startMm, floorMm) {
        var mm = startMm;
        el.style.fontSize = mm.toFixed(2) + 'mm';
        for (var i = 0; i < 40 && mm > floorMm; i++) {
            if (fitsWidth(el)) break;
            mm -= startMm * 0.04;
            el.style.fontSize = mm.toFixed(2) + 'mm';
        }
    }

    /* Same idea, for a block that is allowed to wrap: shrink until the
       wrapped text fits inside its clamped height. Truncating the job loses
       what the repair actually is, which is half the point of the sticker, so
       it is worth a smaller size to keep it whole. */
    function fitBlock(el, startMm, floorMm) {
        var mm = startMm;
        el.style.fontSize = mm.toFixed(2) + 'mm';
        for (var i = 0; i < 40 && mm > floorMm; i++) {
            // Width matters as well as height: a single long word cannot wrap
            // away, so "Featherstonehaugh" overran the roll while the block's
            // height stayed within its two lines. No safety margin on width
            // here — a block that wraps fills its width exactly, so
            // scrollWidth == clientWidth is the normal fitting state.
            if (el.scrollHeight <= el.clientHeight &&
                el.scrollWidth <= el.clientWidth) break;
            mm -= startMm * 0.05;
            el.style.fontSize = mm.toFixed(2) + 'mm';
        }
    }

    /* --- content ------------------------------------------------------ */

    /* Labels show the number a person would actually dial. Intake stores
       E.164 ("+447911123456"), which is both longer than the roll can set at
       a readable size and not how anyone reads a number back over the
       counter. */
    function phoneForLabel(raw) {
        var text = String(raw || '').trim();
        if (!text) return '';
        var digits = text.replace(/[^\d+]/g, '');
        if (digits.indexOf('+44') === 0) digits = '0' + digits.slice(3);
        if (/^07\d{9}$/.test(digits)) return digits.slice(0, 5) + ' ' + digits.slice(5);
        return digits.indexOf('+') === 0 ? text : digits || text;
    }

    function receivedDate(repair) {
        var stamp = repair && repair.dateReceived;
        if (stamp && typeof stamp.seconds === 'number') return new Date(stamp.seconds * 1000);
        if (stamp && typeof stamp.toDate === 'function') return stamp.toDate();
        if (stamp) {
            var parsed = new Date(stamp);
            if (!isNaN(parsed.getTime())) return parsed;
        }
        return new Date();
    }

    function jobText(repair) {
        var device = repair.device ||
            [repair.brand, repair.model].filter(Boolean).join(' ') ||
            'Device';
        return repair.issueDescription || device;
    }

    /* --- rendering ---------------------------------------------------- */

    /* @page has to match the roll or the driver scales or clips the output —
       with no rule at all Windows falls back to A4 and turns a 57x32mm box
       sideways to fit, which is what printed the first labels on their side. */
    function pageRuleText(size, rotated) {
        return '@page { size: ' +
            (rotated ? size.h : size.w) + 'mm ' +
            (rotated ? size.w : size.h) + 'mm; margin: 0; }';
    }

    /* Renders a repair into a `.label` element, sized for the given roll.
       The element must be laid out — off-screen is fine, display:none is not,
       because every measurement below comes back 0 without layout and each
       fit loop then exits on its first pass with the text still oversized. */
    function render(labelEl, repair, options) {
        var opts = options || {};
        var size = opts.size || sizeById(savedSizeId());
        var rotated = typeof opts.rotated === 'boolean' ? opts.rotated : savedRotated();
        var doc = labelEl.ownerDocument;

        var inner = labelEl.querySelector('.label__inner');
        if (!inner) {
            inner = doc.createElement('div');
            inner.className = 'label__inner';
            labelEl.appendChild(inner);
        }

        // The page box follows the rotation; the artwork inside never changes
        // shape, it is just turned within that box.
        labelEl.style.width = (rotated ? size.h : size.w) + 'mm';
        labelEl.style.height = (rotated ? size.w : size.h) + 'mm';
        labelEl.classList.toggle('is-rotated', rotated);

        inner.style.width = size.w + 'mm';
        inner.style.height = size.h + 'mm';

        inner.innerHTML =
            '<div class="lbl-name"></div>' +
            '<div class="lbl-job"></div>' +
            '<div class="lbl-foot">' +
            '<span class="lbl-phone"></span><span class="lbl-date"></span>' +
            '</div>';

        var nameEl = inner.querySelector('.lbl-name');
        var jobEl = inner.querySelector('.lbl-job');
        var phoneEl = inner.querySelector('.lbl-phone');
        var dateEl = inner.querySelector('.lbl-date');

        nameEl.textContent = repair.customerName || '—';
        jobEl.textContent = jobText(repair);
        phoneEl.textContent = phoneForLabel(repair.customerPhone);

        // "22 Aug 26", not "22/08/2026". Four fewer characters on the row the
        // phone number has to share, and easier to read at a glance besides.
        dateEl.textContent = receivedDate(repair).toLocaleDateString('en-GB', {
            day: 'numeric', month: 'short', year: '2-digit'
        });

        // Each block is measured against its own box. Measuring a row instead
        // was silently useless: the text inside clips itself to an ellipsis,
        // so the row never overflows and the loop exited on its first pass —
        // which is how "Alfie Ri…" reached the roll.
        var h = size.h;
        fitBlock(nameEl, h * 0.205, h * 0.100);

        // The date is set small deliberately. It shares the row with the phone
        // number, and every millimetre it takes is a millimetre the phone
        // loses — at 0.115 the phone was pinned to its floor. A date is read
        // once for reference; a phone number is read across a workbench.
        dateEl.style.fontSize = (h * 0.093).toFixed(2) + 'mm';
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

        return { size: size, rotated: rotated };
    }

    /* --- printing ----------------------------------------------------- */

    function applyPageRule(doc, size, rotated) {
        var style = doc.getElementById('onlinefix-label-page-rule');
        if (!style) {
            style = doc.createElement('style');
            style.id = 'onlinefix-label-page-rule';
            doc.head.appendChild(style);
        }
        style.textContent = pageRuleText(size, rotated);
    }

    /* The element every print renders into: one `.label`, always a direct
       child of <body>. That position is load-bearing, not tidiness — the
       print stylesheet clears the page by hiding body's other children, and
       it can only do that if the label is not buried inside them.

       Off-screen rather than hidden, because the fit loops measure text and
       an element with no layout measures 0. */
    function ensureHost() {
        var host = document.getElementById('onlinefix-label-host');
        if (!host) {
            host = document.createElement('div');
            host.id = 'onlinefix-label-host';
            host.className = 'label-print-host';
            host.innerHTML = '<div class="label"></div>';
            document.body.appendChild(host);
        }
        return host;
    }

    /* Renders a repair and prints it, and nothing else on the page with it.
       This is the whole of what the dashboard's Print label button needs. */
    function printRepair(repair, options) {
        var host = ensureHost();
        var applied = render(host.querySelector('.label'), repair || {}, options);
        applyPageRule(document, applied.size, applied.rotated);

        var root = document.documentElement;
        root.classList.add('printing-label');

        // The class has to stay for as long as the print session lasts, not
        // for a fixed spell. Chrome re-renders the preview when a setting is
        // changed in the dialog, so dropping it on a timer while the dialog is
        // still open would reprint the whole dashboard onto the roll.
        var media = window.matchMedia && window.matchMedia('print');

        var cleanup = function () {
            root.classList.remove('printing-label');
            window.removeEventListener('afterprint', cleanup);
            if (media && media.removeEventListener) media.removeEventListener('change', onMedia);
        };

        function onMedia(event) { if (!event.matches) cleanup(); }

        window.addEventListener('afterprint', cleanup);
        if (media && media.addEventListener) media.addEventListener('change', onMedia);

        window.print();

        return applied;
    }

    global.OnlineFixLabel = {
        SIZES: SIZES,
        sizeById: sizeById,
        savedSizeId: savedSizeId,
        saveSizeId: saveSizeId,
        savedRotated: savedRotated,
        saveRotated: saveRotated,
        phoneForLabel: phoneForLabel,
        pageRuleText: pageRuleText,
        applyPageRule: applyPageRule,
        render: render,
        printRepair: printRepair
    };

})(window);
