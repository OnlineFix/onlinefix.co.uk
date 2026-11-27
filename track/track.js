/* Repair tracking page (/track/). Moved out of an inline <script> so the
   site can drop 'unsafe-inline' from its Content-Security-Policy. Loaded
   without defer, in the same place as before: after the Firebase scripts
   and the photo viewer markup it uses. */

// Utility for escaping HTML to prevent XSS
function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function escapeJSStr(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/"/g, '\\"')
        .replace(/</g, '\\x3c')
        .replace(/>/g, '\\x3e');
}

// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyCKBlO4aHTVSjwyevg1OYZ0NWy3Y62HJuU",
    authDomain: "onlinefix-repair.firebaseapp.com",
    projectId: "onlinefix-repair",
    storageBucket: "onlinefix-repair.firebasestorage.app",
    messagingSenderId: "382934797751",
    appId: "1:382934797751:web:5ac8a9c87d68a17b4cec32"
};

// Initialize Firebase. App Check intentionally not used here: the
// tracking page is a single-doc lookup by an unguessable random
// repair ID, and the tracking copy holds nothing private.
//
// This comment used to cite "firestore.rules restricts public list
// queries to limit <= 1" as the safeguard. That rule was the leak,
// not a protection: rules cannot see a query's filter values, so
// limit(1) with startAfter() walked the whole repairs collection one
// document per request. It is gone, and this page no longer reads
// repairs at all.
//
// App Check kept tripping the production CSP (no
// www.google.com/recaptcha.net in connect-src from the Cloudflare
// Transform Rule), then getting throttled for 24h, which broke every
// customer tracking link. See commit 9aa300b for the same fix on
// admin/index.html.
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Status definitions
const statusConfig = {
    'received': {
        label: 'Received',
        icon: 'fas fa-inbox',
        class: 'status-received'
    },
    'diagnosing': {
        label: 'Diagnosing',
        icon: 'fas fa-search',
        class: 'status-diagnosing'
    },
    // The shop calls this one "Waiting for Customer Decision"; the
    // customer reads it addressed to them.
    'waiting-decision': {
        label: 'Waiting for your decision',
        icon: 'fas fa-user-clock',
        class: 'status-waiting-decision'
    },
    'waiting-parts': {
        label: 'Waiting for Parts',
        icon: 'fas fa-clock',
        class: 'status-waiting-parts'
    },
    'in-repair': {
        label: 'In Repair',
        icon: 'fas fa-tools',
        class: 'status-in-repair'
    },
    'testing': {
        label: 'Testing',
        icon: 'fas fa-vial',
        class: 'status-testing'
    },
    'ready': {
        label: 'Ready for Collection',
        icon: 'fas fa-check-circle',
        class: 'status-ready'
    },
    'completed': {
        label: 'Completed',
        icon: 'fas fa-flag-checkered',
        class: 'status-completed'
    }
};

// Device type icons
const deviceIcons = {
    'iPhone': 'fas fa-mobile-alt',
    'Samsung': 'fas fa-mobile-alt',
    'Android': 'fas fa-mobile-alt',
    'Laptop': 'fas fa-laptop',
    'MacBook': 'fas fa-laptop',
    'iPad': 'fas fa-tablet-alt',
    'Tablet': 'fas fa-tablet-alt',
    'Desktop': 'fas fa-desktop',
    'Gaming Console': 'fas fa-gamepad',
    'Device': 'fas fa-cog'
};

// Get repair ID from URL (validated)
function getRepairId() {
    const urlParams = new URLSearchParams(window.location.search);
    const id = urlParams.get('id');
    // Only allow alphanumeric, underscore, and hyphen characters
    if (id && /^[a-zA-Z0-9_-]+$/.test(id)) {
        return id;
    }
    return null;
}

// The ticket itself is staff only. This page reads the repair's
// tracking copy, which holds only what is shown here, by its code:
// firestore.rules lets anyone open one copy by code but not list
// them. See new-repair/tracking-copy.js.
async function fetchTrackingCopy(repairId) {
    try {
        const doc = await db.collection('tracking').doc(repairId).get();
        return doc.exists ? doc.data() : null;
    } catch (error) {
        // Refused until the new database rules are published.
        return null;
    }
}

// The old lookup, for the switchover only: between this page going
// live and the dashboard publishing a copy of every existing job, a
// job can still be missing its copy. Once the new rules are
// published this query is refused, so it finds nothing and the page
// relies on the copy alone.
async function fetchFromTicket(repairId) {
    try {
        const querySnapshot = await db.collection('repairs')
            .where('repairId', '==', repairId)
            .limit(1)
            .get();
        return querySnapshot.empty ? null : querySnapshot.docs[0].data();
    } catch (error) {
        return null;
    }
}

// Load repair data
async function loadRepairData(repairId) {
    try {
        const data = (await fetchTrackingCopy(repairId)) || (await fetchFromTicket(repairId));

        if (!data) {
            showError();
            return;
        }

        displayRepairData(data);

        // GA4: Track customer viewing their repair
        if (typeof gtag === 'function') {
            gtag('event', 'repair_tracking_viewed', {
                repair_id: data.repairId || repairId,
                repair_status: data.currentStatus,
                device_type: data.deviceType || 'unknown'
            });
        }

    } catch (error) {
        console.error('Error loading repair data:', error);
        showError();
    }
}

// Display repair data
function displayRepairData(data) {
    // Update device info - prioritize device field, then brand/model combination
    let deviceInfo = '';
    if (data.device) {
        deviceInfo = data.device;
    } else if (data.brand || data.model) {
        deviceInfo = `${data.brand || ''} ${data.model || ''}`.trim();
    } else {
        deviceInfo = 'Device';
    }

    document.getElementById('deviceTitle').textContent = deviceInfo;
    document.getElementById('deviceId').textContent = `Repair ID: ${data.repairId}`;

    // Update device icon - use device field to determine icon if possible
    let deviceTypeForIcon = data.deviceType || 'Device';
    if (data.device) {
        const deviceLower = data.device.toLowerCase();
        if (deviceLower.includes('iphone')) deviceTypeForIcon = 'iPhone';
        else if (deviceLower.includes('samsung')) deviceTypeForIcon = 'Samsung';
        else if (deviceLower.includes('android')) deviceTypeForIcon = 'Android';
        else if (deviceLower.includes('ipad')) deviceTypeForIcon = 'iPad';
        else if (deviceLower.includes('tablet')) deviceTypeForIcon = 'Tablet';
        else if (deviceLower.includes('macbook')) deviceTypeForIcon = 'MacBook';
        else if (deviceLower.includes('laptop')) deviceTypeForIcon = 'Laptop';
        else if (deviceLower.includes('desktop')) deviceTypeForIcon = 'Desktop';
        else if (deviceLower.includes('console')) deviceTypeForIcon = 'Gaming Console';
    }
    const iconClass = deviceIcons[deviceTypeForIcon] || deviceIcons['Device'];
    document.getElementById('deviceIcon').innerHTML = `<i class="${iconClass}"></i>`;

    // Update status
    const status = statusConfig[data.currentStatus] || statusConfig['received'];
    const statusBadge = document.getElementById('statusBadge');
    statusBadge.className = `status-badge ${status.class}`;
    statusBadge.innerHTML = `<i class="${status.icon}"></i> ${status.label}`;

    // Update estimated completion
    let completionText = '';
    if (data.estimatedCompletion) {
        const date = new Date(data.estimatedCompletion.seconds * 1000);
        completionText = `Estimated completion: ${date.toLocaleDateString('en-GB')}`;
    }

    // Show estimated cost if available
    if (data.estimatedCost || data.price) {
        const cost = data.estimatedCost || data.price;
        if (completionText) {
            completionText += `<br>`;
        }
        completionText += `Estimated cost: £${escapeHTML(String(cost))}`;
    }

    document.getElementById('estimatedCompletion').innerHTML = completionText;

    // Get initial photos (photos not in progress updates)
    const progressPhotos = new Set();
    if (data.progress) {
        data.progress.forEach(p => {
            if (p.photos) {
                p.photos.forEach(photo => progressPhotos.add(photo));
            }
        });
    }

    const initialPhotos = (data.photos || []).filter(photo => !progressPhotos.has(photo));

    // Build timeline with initial photos
    buildTimeline(data.progress || [], data.currentStatus, initialPhotos, data.dateReceived);

    // Update device details
    updateDeviceDetails(data);

    // Show main content
    document.getElementById('loading').style.display = 'none';
    document.getElementById('main-content').style.display = 'block';

    // Add timeline connectors after DOM renders
    setTimeout(() => {
        const timeline = document.getElementById('timeline');
        const timelineItems = timeline.querySelectorAll('.timeline-item');
        timelineItems.forEach((item, index) => {
            if (index < timelineItems.length - 1) {
                const connector = document.createElement('div');
                connector.className = 'timeline-connector';
                const itemHeight = item.offsetHeight;
                connector.style.height = `${itemHeight - 5}px`;
                item.appendChild(connector);
            }
        });
    }, 100);

    // Trigger animations
    setTimeout(() => {
        document.querySelectorAll('.fade-in').forEach((el, index) => {
            el.style.animationDelay = `${index * 0.1}s`;
        });
    }, 100);
}

// Build progress timeline
function buildTimeline(progress, currentStatus, initialPhotos, dateReceived) {
    const timeline = document.getElementById('timeline');
    timeline.innerHTML = '';
    // The page polls every 30s and rebuilds the timeline, so the
    // groups are rebuilt with it rather than accumulating.
    photoGroups = [];

    // Create a set of statuses that have been used
    const usedStatuses = new Set(['received']); // Always show received
    progress.forEach(p => usedStatuses.add(p.status));
    usedStatuses.add(currentStatus); // Add current status

    // Build timeline only for used statuses
    const statusOrder = ['received', 'diagnosing', 'waiting-decision', 'waiting-parts', 'in-repair', 'testing', 'ready', 'completed'];

    const renderItem = ({ statusKey, iconClass, timeText, notes, photos }) => {
        const status = statusConfig[statusKey];
        // Each update's photos are their own group, so the arrows in
        // the viewer step through that update rather than every photo
        // on the ticket. Index is captured now and baked into the
        // markup below.
        const groupIndex = photoGroups.length;
        if (photos.length > 0) photoGroups.push(photos.slice());
        const timelineItem = document.createElement('div');
        timelineItem.className = 'timeline-item';
        timelineItem.innerHTML = `
            <div class="timeline-icon ${iconClass}">
                <i class="${status.icon}"></i>
            </div>
            <div class="timeline-content">
                <div class="timeline-title">${status.label}</div>
                ${timeText ? `<div class="timeline-time">${timeText}</div>` : ''}
                ${notes ? `<div class="timeline-notes">${escapeHTML(notes)}</div>` : ''}
                ${photos.length > 0 ? `
                    <div class="timeline-photos">
                        ${photos.map((photo, i) => `
                            <div class="timeline-photo" role="button" tabindex="0"
                                aria-label="Open photo ${i + 1} of ${photos.length}"
                                data-group="${groupIndex}" data-photo="${i}">
                                <img src="${escapeHTML(photo)}" alt="Repair photo ${i + 1} of ${photos.length}" loading="lazy">
                                <span class="timeline-photo__zoom" aria-hidden="true"><i class="fas fa-expand"></i></span>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}
            </div>
        `;
        timeline.appendChild(timelineItem);
    };

    statusOrder.forEach((statusKey) => {
        // Skip if this status was never used
        if (!usedStatuses.has(statusKey)) {
            return;
        }

        // Every update for this status, oldest first. A repair can pass
        // through the same status more than once — a second round of
        // work, or an update that adds photos without moving status on
        // — and each of those is its own entry. Rendering only the
        // first (the old .find) silently hid every later update and
        // every photo attached to it.
        const entries = progress
            .filter(p => p.status === statusKey)
            .sort((a, b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0));

        const statusIndex = statusOrder.indexOf(statusKey);
        const currentStatusIndex = statusOrder.indexOf(currentStatus);

        if (entries.length > 0) {
            entries.forEach((entry, i) => {
                const photos = (entry.photos || []).slice();
                // Drop-off photos belong with the first "received" entry.
                if (statusKey === 'received' && i === 0 && initialPhotos && initialPhotos.length > 0) {
                    photos.push(...initialPhotos);
                }
                renderItem({
                    statusKey,
                    iconClass: `completed status-${statusKey}`,
                    timeText: entry.timestamp
                        ? new Date(entry.timestamp.seconds * 1000).toLocaleString('en-GB')
                        : '',
                    notes: entry.notes || '',
                    photos
                });
            });
            return;
        }

        // No recorded entry for this status: it is either where the
        // repair is now, or a stage it passed through unlogged.
        const isCurrent = statusKey === currentStatus;
        const photos = [];
        let timeText = '';
        let notes = '';

        if (statusKey === 'received') {
            timeText = dateReceived
                ? new Date(dateReceived.seconds * 1000).toLocaleString('en-GB')
                : 'Device received';
            notes = 'We\'ve received your device.';
            if (initialPhotos && initialPhotos.length > 0) photos.push(...initialPhotos);
        } else if (isCurrent) {
            timeText = 'In Progress';
        }

        renderItem({
            statusKey,
            iconClass: (isCurrent && statusKey !== 'received')
                ? `current status-${statusKey}`
                : (statusKey === 'received' || statusIndex < currentStatusIndex)
                    ? `completed status-${statusKey}`
                    : 'pending',
            timeText,
            notes,
            photos
        });
    });
}

// Update device details
function updateDeviceDetails(data) {
    const details = [];

    // Show device if available, otherwise show type/brand/model
    if (data.device) {
        details.push({ label: 'Device', value: data.device });
    } else {
        if (data.deviceType) details.push({ label: 'Device Type', value: data.deviceType });
        if (data.brand) details.push({ label: 'Brand', value: data.brand });
        if (data.model) details.push({ label: 'Model', value: data.model });
    }

    if (data.issueDescription) details.push({ label: 'Issue', value: data.issueDescription });
    if (data.dateReceived) {
        details.push({
            label: 'Received Date',
            value: new Date(data.dateReceived.seconds * 1000).toLocaleDateString('en-GB')
        });
    }
    if (data.customerName) details.push({ label: 'Customer', value: data.customerName });

    const detailsContainer = document.getElementById('deviceDetails');
    detailsContainer.innerHTML = '';

    details.forEach(detail => {
        const detailItem = document.createElement('div');
        detailItem.className = 'detail-item';
        detailItem.innerHTML = `
            <span class="detail-label">${detail.label}:</span>
            <span class="detail-value">${escapeHTML(detail.value)}</span>
        `;
        detailsContainer.appendChild(detailItem);
    });
}

// ------------------------------------------------------------------
// Photo viewer
// ------------------------------------------------------------------
let photoGroups = [];
let activeGroup = -1;
let activeIndex = 0;

function showPhotoModal(groupIndex, photoIndex) {
    const group = photoGroups[groupIndex];
    if (!group || !group.length) return;
    activeGroup = groupIndex;
    activeIndex = Math.min(Math.max(photoIndex || 0, 0), group.length - 1);
    renderActivePhoto();
    const modal = document.getElementById('photoModal');
    modal.classList.add('is-open');
    // Stop the page behind scrolling under the viewer on touch.
    document.body.style.overflow = 'hidden';
}

function renderActivePhoto() {
    const group = photoGroups[activeGroup];
    if (!group) return;
    document.getElementById('modalImage').src = group[activeIndex];
    const many = group.length > 1;
    document.getElementById('photoPrev').style.display = many ? 'flex' : 'none';
    document.getElementById('photoNext').style.display = many ? 'flex' : 'none';
    const count = document.getElementById('photoCount');
    count.textContent = many ? `${activeIndex + 1} of ${group.length}` : '';
    count.style.display = many ? 'block' : 'none';
}

function stepPhoto(delta, event) {
    if (event) event.stopPropagation();
    const group = photoGroups[activeGroup];
    if (!group) return;
    activeIndex = (activeIndex + delta + group.length) % group.length;
    renderActivePhoto();
}

function closePhotoModal() {
    document.getElementById('photoModal').classList.remove('is-open');
    document.getElementById('modalImage').src = '';
    document.body.style.overflow = '';
    activeGroup = -1;
}

// The viewer's controls and the timeline thumbnails are wired here, not in
// onclick="" attributes, so the page works under a Content-Security-Policy
// without 'unsafe-inline'. A click anywhere on the dark backdrop (or the x)
// closes the viewer; the photo and the arrows stop their clicks reaching it.
document.getElementById('photoModal').addEventListener('click', closePhotoModal);
document.getElementById('modalImage').addEventListener('click', (e) => e.stopPropagation());
document.getElementById('photoPrev').addEventListener('click', (e) => stepPhoto(-1, e));
document.getElementById('photoNext').addEventListener('click', (e) => stepPhoto(1, e));

// Thumbnails are re-rendered on every refresh, so listen on the document.
function thumbFromEvent(e) {
    return e.target.closest ? e.target.closest('.timeline-photo[data-group]') : null;
}
function openThumb(thumb) {
    showPhotoModal(Number(thumb.dataset.group), Number(thumb.dataset.photo));
}
document.addEventListener('click', (e) => {
    const thumb = thumbFromEvent(e);
    if (thumb) openThumb(thumb);
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
        const thumb = thumbFromEvent(e);
        if (thumb) {
            e.preventDefault();
            openThumb(thumb);
            return;
        }
    }
    if (!document.getElementById('photoModal').classList.contains('is-open')) return;
    if (e.key === 'Escape') closePhotoModal();
    if (e.key === 'ArrowLeft') stepPhoto(-1);
    if (e.key === 'ArrowRight') stepPhoto(1);
});

// Show error state
function showError() {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('error').style.display = 'block';
}

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    const repairId = getRepairId();

    if (!repairId) {
        showError();
        return;
    }

    loadRepairData(repairId);
});

// Auto-refresh every 30 seconds
setInterval(() => {
    const repairId = getRepairId();
    if (repairId && document.getElementById('main-content').style.display !== 'none') {
        loadRepairData(repairId);
    }
}, 30000);
