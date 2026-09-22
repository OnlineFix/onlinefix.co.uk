/* =====================================================================
   OnlineFix — the public tracking copy of a repair
   ---------------------------------------------------------------------
   The customer's tracking page is open to anyone holding the link, so it
   must never read the repair ticket itself: the ticket carries the
   customer's phone, email and address, the device's unlock code and the
   signed agreement. Each repair instead has a copy at tracking/{code},
   holding only what that page shows, and firestore.rules lets a visitor
   open one copy by its code but never ask which codes exist.

   This file decides what goes in that copy. It is shared by the intake
   page, which publishes the copy when a job is created, and the
   dashboard, which keeps every copy in step with its ticket, so there is
   one list rather than two that drift apart.

   FIELDS is mirrored by the key list on tracking/{code} in
   firestore.rules, which refuses any other key. A field added here has
   to be added there too, or every publish is refused.
   ===================================================================== */

(function (global) {
    'use strict';

    var COLLECTION = 'tracking';

    // Everything track/index.html reads, and nothing else.
    var FIELDS = ['repairId', 'device', 'deviceType', 'brand', 'model',
        'issueDescription', 'customerName', 'currentStatus', 'dateReceived',
        'estimatedCompletion', 'estimatedCost', 'price', 'photos', 'progress'];

    var TEXT_FIELDS = ['device', 'deviceType', 'brand', 'model',
        'issueDescription', 'customerName', 'currentStatus'];
    var DATE_FIELDS = ['dateReceived', 'estimatedCompletion'];
    var MONEY_FIELDS = ['estimatedCost', 'price'];

    // The tracking page accepts only codes of this shape, and a Firestore
    // document id cannot hold a slash, so anything else gets no copy.
    var CODE_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

    function isCode(value) {
        return typeof value === 'string' && CODE_PATTERN.test(value);
    }

    function isString(value) { return typeof value === 'string'; }

    function isTimestamp(value) {
        return !!value && typeof value === 'object' &&
            typeof value.seconds === 'number' && typeof value.nanoseconds === 'number';
    }

    // Progress entries keep what the timeline shows. The technician's email
    // is the part that goes: it is staff detail, and the page never showed it.
    function publicEntry(entry) {
        var out = {};
        if (isString(entry.status)) out.status = entry.status;
        if (isTimestamp(entry.timestamp)) out.timestamp = entry.timestamp;
        if (isString(entry.notes)) out.notes = entry.notes;
        out.photos = Array.isArray(entry.photos) ? entry.photos.filter(isString) : [];
        return out;
    }

    // Built field by field from a list rather than by copying the ticket and
    // deleting the private parts, so a field added to tickets later stays
    // private until someone decides otherwise.
    function publicView(repair) {
        var view = { repairId: repair.repairId };

        TEXT_FIELDS.forEach(function (key) {
            if (isString(repair[key])) view[key] = repair[key];
        });
        DATE_FIELDS.forEach(function (key) {
            if (isTimestamp(repair[key])) view[key] = repair[key];
        });
        MONEY_FIELDS.forEach(function (key) {
            var value = repair[key];
            if ((typeof value === 'number' && isFinite(value)) || (isString(value) && value !== '')) {
                view[key] = value;
            }
        });

        if (Array.isArray(repair.photos)) view.photos = repair.photos.filter(isString);
        if (Array.isArray(repair.progress)) {
            view.progress = repair.progress
                .filter(function (entry) { return !!entry && typeof entry === 'object'; })
                .map(publicEntry);
        }
        return view;
    }

    // Key order and Timestamp objects both vary with where a copy came from
    // (built here, or read back from Firestore), so two copies are compared
    // on this rather than on the objects themselves.
    function canonical(value) {
        if (isTimestamp(value)) return { t: value.seconds + '.' + value.nanoseconds };
        if (Array.isArray(value)) return value.map(canonical);
        if (value && typeof value === 'object') {
            var out = {};
            Object.keys(value).sort().forEach(function (key) { out[key] = canonical(value[key]); });
            return out;
        }
        return value;
    }

    function fingerprint(view) {
        return JSON.stringify(canonical(view));
    }

    global.OnlineFixTracking = {
        COLLECTION: COLLECTION,
        FIELDS: FIELDS,
        isCode: isCode,
        publicView: publicView,
        fingerprint: fingerprint
    };
})(window);
