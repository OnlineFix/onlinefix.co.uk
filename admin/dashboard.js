// Staff dashboard (/admin/). This used to sit inside admin/index.html as
// one big <script> block, with onclick="" and similar attributes on the
// buttons. Both need 'unsafe-inline' in the content policy, which would also
// let a script slipped into the page run. Now the code lives here, and the
// buttons carry data-do-click="name" (and data-do-change, data-do-input, and
// so on) instead. The ACTIONS table near the end of this file says what each
// name does. Keep it that way: no inline code in admin/index.html.
//
// A classic script, loaded at the end of <body> as the block was, so the
// order of everything else on the page is unchanged.
        // Phone-only filter disclosure. The panel is CSS-hidden below 640px
        // only, so this class is inert at every other width and the filters
        // stay open on tablet and desktop regardless of what was toggled.
        function toggleRepairFilters() {
            const panel = document.getElementById('repair-filters');
            const btn = document.getElementById('filters-toggle');
            const open = panel.classList.toggle('is-open');
            btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        }

        // Collapsed filters must never silently hide results, so the toggle
        // carries a count of how many are currently narrowing the list.
        function updateFilterCount() {
            const ids = ['common-repair-filter', 'status-filter', 'priority-filter'];
            const active = ids.filter(id => (document.getElementById(id)?.value || '') !== '').length;
            const badge = document.getElementById('filters-active-count');
            if (!badge) return;
            badge.textContent = active;
            badge.classList.toggle('hidden', active === 0);
        }

        // Mobile sidebar toggle
        function toggleSidebar() {
            document.getElementById('sidebar').classList.toggle('show');
            document.getElementById('sidebar-overlay').classList.toggle('show');
        }

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

        // Escape for JavaScript string context (inside onclick attributes)
        function escapeJSStr(str) {
            if (str === null || str === undefined) return '';
            return String(str)
                .replace(/\\/g, '\\\\')
                .replace(/'/g, "\\'")
                .replace(/"/g, '\\"')
                .replace(/\n/g, '\\n')
                .replace(/\r/g, '\\r')
                .replace(/</g, '\\x3c')
                .replace(/>/g, '\\x3e');
        }

        // Safe window.open - prevents tabnabbing by nullifying opener
        function safeOpen(url) {
            const win = window.open(url, '_blank', 'noopener,noreferrer');
            if (win) win.opener = null;
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

        // Initialize Firebase
        firebase.initializeApp(firebaseConfig);
        const db = firebase.firestore();
        const auth = firebase.auth();
        const storage = firebase.storage();

        // Persist auth across reloads/navigations so users don't have to re-login
        // when bouncing between admin pages or refreshing.
        auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch((err) => {
            console.warn('Auth persistence set failed:', err);
        });

        // Global variables
        let currentUser = null;
        let allRepairs = [];
        let updatePhotos = [];

        // Status configuration. customerLabel is what the customer reads for
        // that stage, in the WhatsApp and email updates and on the invoice,
        // when it differs from the shop's name for it. It matches statusConfig
        // in track/index.html.
        const statusConfig = {
            'received': { label: 'Received', class: 'status-received' },
            'diagnosing': { label: 'Diagnosing', class: 'status-diagnosing' },
            'waiting-decision': { label: 'Waiting for Customer Decision', customerLabel: 'Waiting for your decision', class: 'status-waiting-decision' },
            'waiting-parts': { label: 'Waiting for Parts', class: 'status-waiting-parts' },
            'in-repair': { label: 'In Repair', class: 'status-in-repair' },
            'testing': { label: 'Testing', class: 'status-testing' },
            'ready': { label: 'Ready for Collection', class: 'status-ready' },
            'completed': { label: 'Completed', class: 'status-completed' }
        };

        // Status update templates
        const statusTemplates = {
            'diagnosing': [
                'Initial diagnosis in progress. We are examining your device to identify all issues.',
                'Running diagnostic tests to determine the exact cause of the problem.',
                'Device diagnosis complete. We have identified the issues and will proceed with repairs.'
            ],
            'waiting-decision': [
                'We\'ve finished checking your device and sent you a quote. Just let us know if you\'d like us to go ahead.',
                'We\'re waiting to hear back from you before we carry on with the repair. Get in touch whenever you\'re ready.',
                'We\'ve tried to reach you about your repair. Please give us a call or send us a message when you can.'
            ],
            'waiting-parts': [
                'We need to order replacement parts for your device. Expected arrival within 2-3 business days.',
                'Waiting for specific components to arrive. We\'ll update you once parts are received.',
                'Additional parts required for complete repair. Order has been placed with our supplier.'
            ],
            'in-repair': [
                'Repair work has begun on your device. Our technician is working on fixing the identified issues.',
                'Your device is currently being repaired. We expect to complete the work within 24-48 hours.',
                'Repair in progress. Additional issues were discovered that require attention.'
            ],
            'testing': [
                'Repair completed. Now conducting thorough testing to ensure everything works perfectly.',
                'Running quality checks and stress tests on your repaired device.',
                'Final testing phase. Verifying all functions are working as expected.'
            ],
            'ready': [
                'Great news! Your device is repaired and ready for collection. Please bring your receipt.',
                'Repair completed successfully. Your device is ready to be picked up at your convenience.',
                'Your device has been fully repaired and tested. Ready for collection during business hours.'
            ],
            'completed': [
                'Repair completed and device collected. Thank you for choosing OnlineFix!',
                'Service completed. We hope you\'re satisfied with our repair service.',
                'Device successfully repaired and delivered to customer.'
            ]
        };

        // Authentication state observer
        // The addresses the rules treat as staff. Keep in step with isAdmin()
        // in firestore.rules and storage.rules.
        const ADMIN_EMAILS = ['onlinerepairbooking@gmail.com'];

        function isAllowListed(email) {
            return ADMIN_EMAILS.indexOf(email) !== -1;
        }

        /* Is this account staff?

           Signing in is not the same as being staff: anyone with an account on
           the Firebase project could sign in, and the dashboard used to open
           for them. The rules refused every read, so the screen came up empty
           rather than leaking anything, but an empty dashboard is not an
           answer to "should you be here".

           Deliberately one notch looser than the rules, so that this can never
           lock the shop out of its own dashboard: the allow-listed address is
           admitted whether or not it is confirmed, and an account is only
           turned away when its claims were actually read and say no.

           The label is worked out from the token's claims when there are any,
           because the token is what the rules check. The account's own copy of
           the address (user.email, user.emailVerified) is used only when no
           token could be read at all. */
        function describeAdminAccess(user, read) {
            const claims = read.claims;
            // The database and photo rules also want the 6-digit code in this
            // sign-in. Without it the dashboard still opens, so the code can
            // be linked from the menu, but the records stay locked.
            if (claims && claims.admin === true) {
                const usedCode = !!(claims.firebase && claims.firebase.sign_in_second_factor);
                return { allowed: true, state: usedCode ? 'claim' : 'claim-no-code' };
            }

            const verified = claims ? claims.email_verified === true : user.emailVerified === true;
            if (isAllowListed(user.email) || (claims && isAllowListed(claims.email))) {
                return { allowed: true, state: verified ? 'email-verified' : 'email-unverified' };
            }

            // Not the shop's address, and no claims to go on. Opening leaves it
            // to the rules, as before this check existed, rather than turning
            // away a claim-only admin because a network call failed.
            if (!claims) return { allowed: true, state: 'unknown' };
            return { allowed: false, state: 'none' };
        }

        /* The custom claim is the only part of this that needs the ID token,
           and the token is the only part that can fail.

           A forced refresh goes to Google's Token Service. When that is
           refused the whole check used to give up, which is why this line read
           "could not be checked". It is refused on the live site as of
           2026-09-22: the browser API key's list of allowed Google APIs leaves
           the Token Service out, so sign-ins cannot be renewed at all. That is
           a Google Cloud setting, not something code here can fix, so the
           failure is reported on screen (see renewalNote) rather than
           swallowed. */
        async function readAdminClaims(user) {
            // Fresh first, so a claim granted since sign-in counts today
            // rather than after the next sign-out.
            try {
                const token = await user.getIdTokenResult(true);
                return { claims: token.claims || null, refreshError: null };
            } catch (refreshError) {
                console.warn('Could not refresh the ID token:', refreshError);
                // Then the token already in hand, which needs no network while
                // it is still in date.
                try {
                    const token = await user.getIdTokenResult();
                    return { claims: token.claims || null, refreshError };
                } catch (cachedError) {
                    console.warn('Could not read the cached ID token:', cachedError);
                    return { claims: null, refreshError };
                }
            }
        }

        /* A request that hangs, rather than failing, holds the SDK for 30
           seconds, and falling back to the cached token can start a second
           one. Nobody should stare at a blank page for that. */
        function withTimeout(promise, ms) {
            return Promise.race([promise, new Promise(resolve => setTimeout(
                () => resolve({ claims: null, refreshError: { code: 'timeout' } }), ms))]);
        }

        const ACCESS_NOTES = {
            'claim': 'Admin access: security claim and 6-digit code.',
            'claim-no-code': 'This sign-in did not use the 6-digit code, so the records stay locked. Log out and sign in again with the code. No code yet? Link one under Login code first.',
            'email-verified': 'Admin access: confirmed email. A security claim would be better.',
            'email-unverified': 'Admin access: email, not confirmed. The new rules refuse this account.',
            'unknown': 'Admin access: could not be checked just now.',
            'pending': 'Admin access: checking…'
        };

        /* Google names the refused API in the error code when the key itself
           blocks it, e.g. auth/requests-to-this-api-securetoken...-are-blocked. */
        function renewalNote(refreshError) {
            if (!refreshError) return { text: '', alarm: false };
            if (/are[-\s]blocked|api[-_\s]key|service[-_\s]blocked/i.test(String(refreshError.code || refreshError.message || ''))) {
                return {
                    text: 'Sign-in renewal is blocked by a Google setting, so the dashboard stops working about an hour after signing in.',
                    alarm: true
                };
            }
            return { text: 'Sign-in could not be renewed just now.', alarm: false };
        }

        function showAccessNote(state, refreshError) {
            const note = document.getElementById('admin-access-note');
            if (!note) return;
            const renewal = renewalNote(refreshError);
            note.textContent = (ACCESS_NOTES[state] || ACCESS_NOTES.unknown) + (renewal.text ? ' ' + renewal.text : '');
            note.style.color = (state === 'email-unverified' || state === 'claim-no-code' || renewal.alarm) ? '#F87171' : '';
        }

        function openDashboard(user) {
            currentUser = user;
            document.getElementById('user-email').textContent = user.email;
            const loginError = document.getElementById('login-error');
            if (loginError) loginError.classList.add('hidden');
            showDashboard();
            loadDashboardData();
        }

        function hideSplash() {
            const splash = document.getElementById('auth-loading');
            if (splash) splash.style.display = 'none';
        }

        auth.onAuthStateChanged(async (user) => {
            if (!user) {
                hideSplash();
                stopListening();
                showLogin();
                return;
            }

            /* The shop's own address needs no network to recognise, so its
               dashboard opens straight away and the note fills in after.
               Anyone else waits behind the splash until the claims are read. */
            const shopAddress = isAllowListed(user.email);
            if (shopAddress) {
                hideSplash();
                openDashboard(user);
                showAccessNote('pending', null);
            }

            let read;
            try {
                read = await withTimeout(readAdminClaims(user), 8000);
            } catch (error) {
                // readAdminClaims swallows its own failures; this is a backstop.
                console.warn('Could not work out admin access:', error);
                read = { claims: null, refreshError: error };
            }

            // Someone signed out, or in as someone else, while this was
            // waiting. Acting on it now would open the dashboard for a
            // signed-out page, or sign out the account that replaced this one.
            if (!auth.currentUser || auth.currentUser.uid !== user.uid) return;

            const access = describeAdminAccess(user, read);
            hideSplash();

            if (!access.allowed) {
                stopListening();
                showLogin();
                showLoginError('This account does not have access to the dashboard. If access was granted recently, sign in again.');
                auth.signOut();
                return;
            }

            if (!shopAddress) openDashboard(user);
            showAccessNote(access.state, read.refreshError);
            if (access.state === 'claim-no-code') {
                showAlert(ACCESS_NOTES['claim-no-code'], 'error', { sticky: true });
            }
        });

        // Force ID token refresh so any newly-set custom claims
        // (e.g. {admin: true} from set-admin-claim.mjs) are picked
        // up immediately, instead of after a stale-token expiry.
        async function refreshStaffClaims() {
            if (auth.currentUser) {
                try { await auth.currentUser.getIdToken(true); } catch (_) {}
            }
        }

        // The sign-in waiting for its 6-digit code (a Firebase resolver).
        let pendingCodeSignIn = null;

        function showCodeStep(resolver) {
            pendingCodeSignIn = resolver;
            document.getElementById('login-error').classList.add('hidden');
            document.getElementById('login-form').classList.add('hidden');
            document.getElementById('login-code-form').classList.remove('hidden');
            const input = document.getElementById('login-code');
            input.value = '';
            input.focus();
        }

        function showPasswordStep() {
            pendingCodeSignIn = null;
            document.getElementById('login-code-form').classList.add('hidden');
            document.getElementById('login-form').classList.remove('hidden');
            document.getElementById('login-password').value = '';
        }

        // Login form submission
        document.getElementById('login-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('login-email').value;
            const password = document.getElementById('login-password').value;

            try {
                await auth.signInWithEmailAndPassword(email, password);
                await refreshStaffClaims();
            } catch (error) {
                if (window.StaffMfa && StaffMfa.needsCode(error)) {
                    showCodeStep(error.resolver);
                    return;
                }
                showLoginError(error.message);
            }
        });

        document.getElementById('login-code-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const input = document.getElementById('login-code');
            const button = document.getElementById('login-code-submit');
            const code = StaffMfa.cleanCode(input.value);
            if (code.length !== 6) {
                showLoginError('Type the 6-digit code from the app.');
                return;
            }
            button.disabled = true;
            try {
                await StaffMfa.finishSignIn(pendingCodeSignIn, code);
                showPasswordStep();
                await refreshStaffClaims();
            } catch (error) {
                if (StaffMfa.isExpired(error)) showPasswordStep();
                else input.select();
                showLoginError(StaffMfa.describe(error) || error.message);
            } finally {
                button.disabled = false;
            }
        });

        document.getElementById('login-code-back').addEventListener('click', () => {
            document.getElementById('login-error').classList.add('hidden');
            showPasswordStep();
        });

        // Navigation
        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const section = e.target.closest('.nav-link').dataset.section;
                if (section) {
                    showSection(section);
                }
                // Close sidebar on mobile after navigation
                document.getElementById('sidebar').classList.remove('show');
                document.getElementById('sidebar-overlay').classList.remove('show');
            });
        });

        // Status filter
        document.getElementById('status-filter').addEventListener('change', () => {
            loadAllRepairs();
        });

        // Common repair filter
        document.getElementById('common-repair-filter').addEventListener('change', () => {
            loadAllRepairs();
        });

        // Show/hide screens
        function showLogin() {
            document.getElementById('login-screen').classList.remove('hidden');
            document.getElementById('dashboard').classList.add('hidden');
        }

        function showDashboard() {
            document.getElementById('login-screen').classList.add('hidden');
            document.getElementById('dashboard').classList.remove('hidden');
        }

        function showLoginError(message) {
            const errorDiv = document.getElementById('login-error');
            errorDiv.textContent = message;
            errorDiv.classList.remove('hidden');
        }

        // Logout
        function logout() {
            stopListening();
            /* Reload once signed out. Sign-out only hides the dashboard: the
               job list, customer details and rendered tables all stay in the
               page's memory, readable from the browser's developer tools by
               the next person at the shop computer. A reload is the one clear
               that cannot miss anything. */
            auth.signOut().finally(() => window.location.reload());
        }

        // The live listeners are refused the moment the account signs out,
        // which showed "Error loading data" on every sign-out, so they stop
        // first. The job list they filled is now out of date, and the
        // tracking sync must not publish from it after the next sign-in:
        // a job deleted on another device meanwhile would get its tracking
        // page back.
        function stopListening() {
            stopTrackingSync();
            if (unsubscribeRepairs) unsubscribeRepairs();
            unsubscribeRepairs = null;
            repairsLoaded = false;
            stopBookings();
        }

        // Navigation
        function showSection(sectionName) {
            // Update active nav link
            document.querySelectorAll('.nav-link').forEach(link => {
                link.classList.remove('active');
                if (link.dataset.section === sectionName) {
                    link.classList.add('active');
                }
            });

            // Hide all sections
            document.querySelectorAll('.content-section').forEach(section => {
                section.classList.add('hidden');
            });

            // Show selected section
            const section = document.getElementById(`${sectionName}-section`);
            if (section) {
                section.classList.remove('hidden');
            }

            // Update page title
            const titles = {
                'overview': 'Dashboard Overview',
                'repairs': 'All Repairs',
                'bookings': 'Online Bookings',
                'analytics': 'Business Analytics'
            };
            document.getElementById('page-title').textContent = titles[sectionName] || 'Dashboard';

            // Load section-specific data
            if (sectionName === 'repairs') {
                loadAllRepairs();
            } else if (sectionName === 'overview') {
                updateStats();
                renderKanban('overview-kanban-container');
            } else if (sectionName === 'analytics') {
                renderAnalytics();
            } else if (sectionName === 'bookings') {
                renderBookings();
            }
        }

        // Real-time dashboard data with Firestore onSnapshot
        let unsubscribeRepairs = null;
        let repairsLoaded = false;

        let emailLayoutWarned = false;

        function loadDashboardData() {
            document.getElementById('loading').style.display = 'block';

            // Unsubscribe previous listener if any
            if (unsubscribeRepairs) unsubscribeRepairs();

            // Set up real-time listener
            unsubscribeRepairs = db.collection('repairs').onSnapshot((snapshot) => {
                allRepairs = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));
                repairsLoaded = true;

                // Update everything
                updateStats();
                loadAllRepairs();

                // Re-render any visible kanban so drag-drop and status changes
                // reflect immediately without manual section switching.
                if (document.getElementById('overview-kanban-container')?.offsetParent) {
                    renderKanban('overview-kanban-container');
                }

                document.getElementById('loading').style.display = 'none';

                syncTrackingCopies();
                clearFinishedUnlockCodes();
            }, (error) => {
                unsubscribeRepairs = null;
                repairsLoaded = false;
                document.getElementById('loading').style.display = 'none';
                if (!auth.currentUser) return;   // signed out, nothing to report
                console.error('Error listening to repairs:', error);
                showAlert('Error loading data: ' + error.message, 'error');
            });

            startBookings();

            if (!window.OnlineFixTracking) {
                showAlert('Tracking page script did not load — reload the page', 'error');
            } else if (!unsubscribeTracking) {
                startTrackingSync();
            }
            // Sticky, so shown once: this runs again after each deleted repair.
            if (!window.OnlineFixEmail && !emailLayoutWarned) {
                emailLayoutWarned = true;
                showAlert('Email layout script did not load — reload the page. Until then emails go as plain text, and Confirm booking cannot email the customer.', 'error', { sticky: true });
            }
        }

        // === ONLINE BOOKINGS ===
        // Requests from the public /book/ page land in `bookings`, written,
        // with an email to the shop about each one, by the submitBooking
        // Cloud Function (server/submit-booking/). This board lays them out
        // by the day and time the customer asked to drop off. Opening one
        // lets staff correct the details, confirm it, and book it in, which
        // turns it into a job on the jobs board.
        //
        // A booking moves pending (New) -> confirmed -> booked, or to
        // removed. Older ones may say 'responded', from before this board,
        // and count as confirmed. Removing one also sets its `deleted` flag.
        let unsubscribeBookings = null;
        let allBookings = [];
        let bookingsLoaded = false;
        let bookingsTruncated = false;

        const BOOKING_CATEGORIES = {
            phone: 'Phone', laptop: 'Laptop', tablet: 'Tablet',
            console: 'Games console', desktop: 'Desktop', other: 'Other'
        };
        const OPEN_BOOKING_STATUSES = ['pending', 'confirmed', 'responded'];
        const BOOKINGS_LIMIT = 300;
        let bookingsLimit = BOOKINGS_LIMIT;   // raised by "Show more"
        let bookingsUnordered = false;        // the index below is missing

        /* Only the bookings still waiting on the shop are fetched. Fetching
           the newest few hundred of every kind and filtering here let removed
           and booked-in ones take up the window: a burst of junk bookings
           would push every real one out of it, and removing the junk would
           not bring them back.

           They are fetched newest first. With no order the window was
           filled in document id order, and anyone can make bookings: a
           script filed 400 under ids sorting before "BK_" and no real
           booking made it onto the board. (The rules now also tie each
           booking's id to its own BK_ id.) Newest first, a booking made
           after a burst of junk is still shown, and "Show more" widens the
           window to reach older ones. A script that keeps on booking can
           still bury real bookings; only App Check or a server in front of
           the bookings would stop that.

           "status in [...]" with an order on createdAt needs a composite
           index (bookings: status Ascending, createdAt Descending). Until it
           is created in the Firebase console the ordered query is refused
           with failed-precondition, and the board falls back to the old
           unordered query so it keeps working; the console warning carries
           Firebase's link that creates the index. */
        function startBookings() {
            if (unsubscribeBookings) unsubscribeBookings();
            let q = db.collection('bookings').where('status', 'in', OPEN_BOOKING_STATUSES);
            if (!bookingsUnordered) q = q.orderBy('createdAt', 'desc');
            const limit = bookingsLimit;
            unsubscribeBookings = q.limit(limit)
                .onSnapshot((snapshot) => {
                    allBookings = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    bookingsTruncated = snapshot.size >= limit;
                    bookingsLoaded = true;
                    updateBookingsBadge();
                    if (isBookingsBoardShown()) renderBookings();
                }, (error) => {
                    unsubscribeBookings = null;
                    if (!bookingsUnordered && error && error.code === 'failed-precondition' && auth.currentUser) {
                        console.warn('Online bookings: the index for newest-first order is missing, so the board shows them unordered until it is created. ' + error.message);
                        bookingsUnordered = true;
                        startBookings();
                        return;
                    }
                    bookingsLoaded = false;
                    if (!auth.currentUser) return;   // signed out, nothing to report
                    console.warn('Online bookings unavailable:', error);
                    const board = document.getElementById('bookings-board');
                    if (board) board.innerHTML = '<p class="empty-state">Online bookings could not be loaded: ' + escapeHTML(error.message) + '</p>';
                });
        }

        function stopBookings() {
            if (unsubscribeBookings) unsubscribeBookings();
            unsubscribeBookings = null;
            if (closePhotoViewer) closePhotoViewer();
            bookingPhotoUrls.clear();
            bookingsLoaded = false;
            allBookings = [];
            bookingsLimit = BOOKINGS_LIMIT;
        }

        // "Show more" under the board: the next BOOKINGS_LIMIT older ones.
        document.getElementById('bookings-more')?.addEventListener('click', () => {
            bookingsLimit += BOOKINGS_LIMIT;
            startBookings();
        });

        function isBookingsBoardShown() {
            return !!document.getElementById('bookings-board')?.offsetParent;
        }

        // Still waiting on the shop: not removed and not yet a job.
        function isOpenBooking(b) {
            return b.deleted !== true && OPEN_BOOKING_STATUSES.includes(b.status || 'pending') && !b.linkedRepairId;
        }

        function isNewBooking(b) {
            return isOpenBooking(b) && (!b.status || b.status === 'pending');
        }

        // What the customer was shown as their reference on the booking page.
        function bookingReference(b) {
            return String(b.id || '').slice(-6).toUpperCase();
        }

        function updateBookingsBadge() {
            const badge = document.getElementById('nav-bookings-badge');
            if (!badge) return;
            const count = allBookings.filter(isNewBooking).length;
            badge.textContent = count;
            badge.classList.toggle('hidden', count === 0);
        }

        function bookingDate(ts) {
            return ts && typeof ts.toDate === 'function' ? ts.toDate() : null;
        }

        function formatBookingTime(ts, withDate = true) {
            const d = bookingDate(ts);
            if (!d) return 'Not given';
            return d.toLocaleString('en-GB', withDate
                ? { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
                : { hour: '2-digit', minute: '2-digit' });
        }

        function startOfDay(d) {
            return new Date(d.getFullYear(), d.getMonth(), d.getDate());
        }

        // Whole calendar days from a to b, counted on the calendar so a clock
        // change in between does not shift a booking into the wrong column.
        function daysBetween(a, b) {
            return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())
                - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000);
        }

        /* One column per day the customers asked for, starting today.
           Today and Tomorrow always show, so the board keeps its shape when
           they are empty; any other day shows only when something is booked
           on it. Earlier holds bookings whose day has passed without being
           booked in, which usually means a no-show or a job someone forgot
           to book in. */
        function bookingColumns(bookings) {
            const today = startOfDay(new Date());
            const columns = new Map();
            const add = (key, label, order, booking, withDate) => {
                if (!columns.has(key)) columns.set(key, { label, order, withDate, bookings: [] });
                if (booking) columns.get(key).bookings.push(booking);
            };
            add('today', 'Today', 1, null, false);
            add('tomorrow', 'Tomorrow', 2, null, false);

            bookings.forEach(b => {
                const d = bookingDate(b.preferredAt);
                if (!d) return add('undated', 'No time given', 99, b, true);
                const offset = daysBetween(today, d);
                if (offset < 0) return add('earlier', 'Earlier, not booked in', 0, b, true);
                if (offset === 0) return add('today', 'Today', 1, b, false);
                if (offset === 1) return add('tomorrow', 'Tomorrow', 2, b, false);
                if (offset < 7) {
                    return add('d' + offset, d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }), 1 + offset, b, false);
                }
                return add('later', 'Later', 50, b, true);
            });

            return [...columns.values()]
                .sort((a, b) => a.order - b.order)
                .map(col => ({
                    ...col,
                    bookings: col.bookings.sort((x, y) =>
                        (bookingDate(x.preferredAt) || 0) - (bookingDate(y.preferredAt) || 0))
                }));
        }

        function renderBookings() {
            const board = document.getElementById('bookings-board');
            if (!board) return;
            if (!bookingsLoaded) {
                if (!board.innerHTML.trim()) board.innerHTML = '<p class="empty-state">Loading online bookings…</p>';
                return;
            }
            const open = allBookings.filter(isOpenBooking);
            const newCount = open.filter(isNewBooking).length;
            document.getElementById('bookings-count').textContent =
                open.length ? `(${open.length} waiting, ${newCount} new)` : '';
            const note = document.getElementById('bookings-truncated');
            if (note) note.classList.toggle('hidden', !bookingsTruncated);

            board.innerHTML = bookingColumns(open).map(col => `
                <div class="kanban-column">
                    <div class="kanban-column-header">
                        <span>${escapeHTML(col.label)}</span>
                        <span class="kanban-column-count">${col.bookings.length}</span>
                    </div>
                    <div class="kanban-cards">
                        ${col.bookings.map(b => renderBookingCard(b, col.withDate)).join('')}
                    </div>
                </div>
            `).join('');
        }

        // Today and Tomorrow are worked out when the board is drawn, so a
        // dashboard left open overnight would otherwise keep yesterday's
        // columns until a booking changed.
        function scheduleBookingsMidnightRedraw() {
            const now = new Date();
            const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
            setTimeout(() => {
                if (isBookingsBoardShown()) renderBookings();
                scheduleBookingsMidnightRedraw();
            }, next - now);
        }
        scheduleBookingsMidnightRedraw();
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && isBookingsBoardShown()) renderBookings();
        });

        // === BOOKING HOURS ===
        // The drop-off times the public /book/ page offers come from
        // availability/settings: workingHours holds each day's opening and
        // closing time and whether it is closed. The booking page offers a
        // slot every slotIntervalMinutes from opening, the last one starting
        // before closing, so 10:00 to 22:00 every 15 minutes offers 10:00 up
        // to 21:45, and none sooner than minNoticeHours from now. It reads
        // the doc each time it is opened, so a saved change reaches the next
        // customer who opens it. The booking function (server/submit-booking/)
        // reads slotIntervalMinutes too, to tell which times are taken.
        //
        // workingHours, minNoticeHours and slotIntervalMinutes are edited
        // here. The doc's other settings (how far ahead, closed dates) are
        // left as they are; when the doc does not exist yet, saving creates
        // it with the booking page's own defaults for them.
        const BOOKING_HOURS_DAYS = [
            ['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'],
            ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']
        ];
        // Must match DEFAULT_AVAILABILITY in book/booking.js, which the
        // booking page uses while the doc does not exist.
        const BOOKING_AVAILABILITY_DEFAULTS = {
            workingHours: Object.fromEntries(BOOKING_HOURS_DAYS.map(([key]) =>
                [key, { open: '10:00', close: '22:00', closed: false }])),
            blockedDates: [],
            minNoticeHours: 1,
            maxFutureDays: 60,
            slotIntervalMinutes: 15
        };
        const HOURS_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
        // The choices offered for how soon a customer can book (hours) and
        // the minutes between drop-off times. A saved value not listed is
        // added, so opening the box never changes it unseen.
        const HOURS_NOTICE_CHOICES = [0.5, 1, 2, 3, 4, 6, 12, 24, 48];
        const HOURS_INTERVAL_CHOICES = [10, 15, 20, 30, 45, 60];

        // The minutes between drop-off times, read the way book/booking.js
        // and the booking function read them (slotMinutes, readSettings).
        function bookingSlotMinutes(a) {
            const v = a && a.slotIntervalMinutes;
            return Number.isInteger(v) && v >= 5 && v <= 240 ? v : BOOKING_AVAILABILITY_DEFAULTS.slotIntervalMinutes;
        }

        function noticeText(hours) {
            if (hours <= 0) return 'Any time from now';
            if (hours < 1) return `${Math.round(hours * 60)} minutes`;
            return hours === 1 ? '1 hour' : `${hours} hours`;
        }

        function intervalText(minutes) {
            return minutes === 60 ? '1 hour' : `${minutes} minutes`;
        }

        function choiceOptions(choices, selected, text) {
            const list = choices.includes(selected) ? choices : choices.concat(selected).sort((x, y) => x - y);
            return list.map(v => `<option value="${v}"${v === selected ? ' selected' : ''}>${escapeHTML(text(v))}</option>`).join('');
        }

        function hoursToMinutes(t) {
            const [h, m] = String(t).split(':').map(Number);
            return h * 60 + m;
        }

        function minutesToHours(n) {
            return String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
        }

        // Every half hour of the day, plus the saved time if it is not on
        // the half hour, so opening the box never changes it unseen.
        function hoursTimeOptions(selected) {
            const times = [];
            for (let m = 0; m < 24 * 60; m += 30) times.push(minutesToHours(m));
            if (HOURS_TIME_RE.test(selected) && !times.includes(selected)) times.push(selected);
            return times.sort().map(t =>
                `<option value="${t}"${t === selected ? ' selected' : ''}>${t}</option>`).join('');
        }

        // What a day offers, worked out the way the booking page does it.
        function hoursRowNote(open, close, closed, interval) {
            if (closed) return { text: 'Closed: no drop-off times offered.', wrong: false };
            const start = hoursToMinutes(open);
            const end = hoursToMinutes(close);
            if (end <= start) return { text: 'The closing time must be after the opening time.', wrong: true };
            const count = Math.ceil((end - start) / interval);
            if (count === 1) return { text: `One drop-off time, ${open}.`, wrong: false };
            return { text: `Drop-off times ${open} to ${minutesToHours(start + (count - 1) * interval)} (${count} slots).`, wrong: false };
        }

        async function openBookingHours() {
            if (document.getElementById('hours-modal')) return;
            const modal = document.createElement('div');
            modal.className = 'modal show';
            modal.id = 'hours-modal';
            modal.setAttribute('role', 'dialog');
            modal.setAttribute('aria-modal', 'true');
            modal.setAttribute('aria-labelledby', 'hours-modal-title');
            modal.innerHTML = `
                <div class="modal-content modal-content--job" style="max-width: 680px;">
                    <div class="modal-header">
                        <h2 class="modal-title" id="hours-modal-title">Booking hours</h2>
                        <button type="button" class="close-btn" data-hours-close aria-label="Close">&times;</button>
                    </div>
                    <form id="hours-form" novalidate>
                        <div class="job-body" id="hours-body">
                            <p class="hours-intro">Loading the current hours…</p>
                        </div>
                        <div class="alert alert-error hidden" id="hours-error" style="margin: 1rem 0 0;"></div>
                        <div class="modal-actions hours-actions">
                            <span class="modal-actions__spacer"></span>
                            <button type="button" class="btn btn-secondary" data-hours-close>Cancel</button>
                            <button type="submit" class="btn btn-primary" id="hours-save" disabled><i class="fas fa-save"></i> Save</button>
                        </div>
                    </form>
                </div>`;
            document.body.appendChild(modal);
            // Not closed by a tap outside it: on an iPad that is easy to do
            // by accident, and it would throw away the changes.
            modal.addEventListener('click', (e) => {
                if (!modal.dataset.busy && e.target.closest('[data-hours-close]')) modal.remove();
            });

            let settings;
            try {
                const snap = await db.collection('availability').doc('settings').get();
                settings = snap.exists ? snap.data() : null;
            } catch (error) {
                if (modal.isConnected) {
                    modal.querySelector('#hours-body').innerHTML =
                        `<p class="hours-intro">The current hours could not be loaded, so nothing can be changed yet: ${escapeHTML(error.message)}</p>`;
                }
                return;
            }
            if (modal.isConnected) fillBookingHours(modal, settings);
        }

        function fillBookingHours(modal, settings) {
            // Read the doc the way book/booking.js does, so the box shows what
            // customers are actually offered: no doc means its defaults, and
            // a day missing from a saved doc means closed.
            const a = settings || BOOKING_AVAILABILITY_DEFAULTS;
            const saved = a.workingHours || {};
            const interval = bookingSlotMinutes(a);
            const notice = Number(a.minNoticeHours) || 0;
            const ahead = Number(a.maxFutureDays) || 60;
            const savedAt = settings && bookingDate(settings.updatedAt) ? formatBookingTime(settings.updatedAt) : '';

            const body = modal.querySelector('#hours-body');
            body.innerHTML = `
                <p class="hours-intro">The drop-off times customers can pick on the online booking page.
                    A time is offered every <span data-hours-interval-text>${escapeHTML(intervalText(interval))}</span> from opening; the last one is that long before closing.
                    A time you have confirmed a booking for shows as booked.</p>
                ${settings ? '' : `<p class="hours-intro">These have never been saved, so the booking page is using its built-in hours, shown here. Saving stores them.</p>`}
                <div class="hours-rules">
                    <label class="hours-row__time">
                        <span>Earliest booking, from now</span>
                        <select class="form-input" id="hours-notice">${choiceOptions(HOURS_NOTICE_CHOICES, notice, noticeText)}</select>
                    </label>
                    <label class="hours-row__time">
                        <span>A drop-off time every</span>
                        <select class="form-input" id="hours-interval">${choiceOptions(HOURS_INTERVAL_CHOICES, interval, intervalText)}</select>
                    </label>
                </div>
                ${BOOKING_HOURS_DAYS.map(([key, label]) => {
                    const h = saved[key] || {};
                    const closed = !saved[key] || !!h.closed;
                    const open = HOURS_TIME_RE.test(h.open) ? h.open : '10:00';
                    const close = HOURS_TIME_RE.test(h.close) ? h.close : '22:00';
                    return `
                        <div class="hours-row" data-day="${key}">
                            <span class="hours-row__day">${label}</span>
                            <label class="hours-row__open">
                                <input type="checkbox" data-hours-open aria-label="Open on ${label}"${closed ? '' : ' checked'}>
                                Open
                            </label>
                            <label class="hours-row__time">
                                <span>Opens</span>
                                <select class="form-input" data-hours-from aria-label="${label} opens">${hoursTimeOptions(open)}</select>
                            </label>
                            <label class="hours-row__time">
                                <span>Closes</span>
                                <select class="form-input" data-hours-to aria-label="${label} closes">${hoursTimeOptions(close)}</select>
                            </label>
                            <p class="hours-row__note" aria-live="polite"></p>
                        </div>`;
                }).join('')}
                <p class="hours-other">Customers can book up to ${ahead} days ahead.
                    This changes the booking page only: the opening hours written on the rest of the website, and on Google, stay as they are.</p>
                ${savedAt ? `<p class="hours-other">Last saved ${escapeHTML(savedAt)}.</p>` : ''}`;

            const intervalSelect = body.querySelector('#hours-interval');
            const noticeSelect = body.querySelector('#hours-notice');
            const refreshRow = (row) => {
                const closed = !row.querySelector('[data-hours-open]').checked;
                const from = row.querySelector('[data-hours-from]');
                const to = row.querySelector('[data-hours-to]');
                from.disabled = closed;
                to.disabled = closed;
                const note = hoursRowNote(from.value, to.value, closed, Number(intervalSelect.value));
                const el = row.querySelector('.hours-row__note');
                el.textContent = note.text;
                el.classList.toggle('is-wrong', note.wrong);
            };
            body.querySelectorAll('.hours-row').forEach(row => {
                refreshRow(row);
                row.addEventListener('change', () => refreshRow(row));
            });
            intervalSelect.addEventListener('change', () => {
                body.querySelector('[data-hours-interval-text]').textContent = intervalText(Number(intervalSelect.value));
                body.querySelectorAll('.hours-row').forEach(refreshRow);
            });

            const save = modal.querySelector('#hours-save');
            save.disabled = false;
            modal.querySelector('#hours-form').addEventListener('submit', async (e) => {
                e.preventDefault();
                if (modal.dataset.busy) return;
                const err = modal.querySelector('#hours-error');
                const fail = (msg) => {
                    err.textContent = msg;
                    err.classList.remove('hidden');
                };
                err.classList.add('hidden');

                const workingHours = {};
                for (const [key, label] of BOOKING_HOURS_DAYS) {
                    const row = body.querySelector(`.hours-row[data-day="${key}"]`);
                    const closed = !row.querySelector('[data-hours-open]').checked;
                    const open = row.querySelector('[data-hours-from]').value;
                    const close = row.querySelector('[data-hours-to]').value;
                    if (!HOURS_TIME_RE.test(open) || !HOURS_TIME_RE.test(close)) return fail(`${label}: pick an opening and a closing time.`);
                    if (!closed && hoursToMinutes(close) <= hoursToMinutes(open)) {
                        return fail(`${label} closes before it opens. Pick a later closing time, or untick Open.`);
                    }
                    workingHours[key] = { open, close, closed };
                }
                const minNoticeHours = Number(noticeSelect.value);
                const slotIntervalMinutes = Number(intervalSelect.value);
                if (!(minNoticeHours >= 0 && minNoticeHours <= 168)) return fail('Pick how soon customers can book.');
                if (!(Number.isInteger(slotIntervalMinutes) && slotIntervalMinutes >= 5 && slotIntervalMinutes <= 240)) {
                    return fail('Pick how often a drop-off time is offered.');
                }
                if (Object.values(workingHours).every(d => d.closed)
                    && !confirm('Every day is closed, so nobody will be able to book online. Save anyway?')) return;

                modal.dataset.busy = '1';
                save.disabled = true;
                save.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
                try {
                    const ref = db.collection('availability').doc('settings');
                    const snap = await ref.get();
                    // Anyone can read this doc (the booking page does,
                    // without signing in), so it must not say who saved it:
                    // that is a staff sign-in address. Earlier saves stored
                    // one as updatedBy; this removes it.
                    const payload = {
                        workingHours,
                        minNoticeHours,
                        slotIntervalMinutes,
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                        updatedBy: firebase.firestore.FieldValue.delete()
                    };
                    // A first save also stores the booking page's defaults
                    // for the settings not edited here, so they stay as
                    // customers see them now.
                    if (!snap.exists) {
                        ['blockedDates', 'maxFutureDays']
                            .forEach(k => { payload[k] = BOOKING_AVAILABILITY_DEFAULTS[k]; });
                    }
                    await ref.set(payload, { merge: true });
                    modal.remove();
                    showAlert('Booking hours saved. The booking page offers them from the next time it is opened.', 'success');
                } catch (error) {
                    delete modal.dataset.busy;
                    save.disabled = false;
                    save.innerHTML = '<i class="fas fa-save"></i> Save';
                    fail('Could not save: ' + error.message);
                }
            });
        }

        document.getElementById('booking-hours-btn')?.addEventListener('click', openBookingHours);

        function bookingDeviceText(b) {
            const device = b.device || {};
            return [bookingBrandForJob(device.brand), device.model].filter(Boolean).join(' ')
                || BOOKING_CATEGORIES[device.category] || 'Device not given';
        }

        /* True once the missed-appointment email has gone for the drop-off
           time the booking holds now. A booking moved to a new time after
           the email is no longer marked missed. */
        function missedEmailSent(b) {
            const sent = bookingDate(b.missedEmailedAt);
            const when = bookingDate(b.preferredAt);
            return !!(sent && when && when <= sent);
        }

        function renderBookingCard(b, withDate) {
            const isNew = isNewBooking(b);
            const photos = Array.isArray(b.photoPaths) ? b.photoPaths.length : 0;
            return `
                <div class="kanban-card booking-card${isNew ? ' booking-card--new' : ''}" role="button" tabindex="0"
                     data-booking-open="${escapeHTML(b.id)}">
                    <div class="booking-card-time">${escapeHTML(formatBookingTime(b.preferredAt, withDate))}</div>
                    <div class="kanban-card-customer">${escapeHTML((b.customer && b.customer.name) || 'No name')}</div>
                    <div class="kanban-card-device">${escapeHTML(bookingDeviceText(b))}</div>
                    <div class="kanban-card-footer">
                        <span class="booking-card-chips">
                            <span class="booking-chip${isNew ? ' booking-chip--new' : ''}">${isNew ? 'New' : 'Confirmed'}</span>
                            ${missedEmailSent(b) ? '<span class="booking-chip booking-chip--missed">Missed, emailed</span>' : ''}
                        </span>
                        ${photos ? `<span class="kanban-card-age"><i class="fas fa-image"></i> ${photos}</span>` : ''}
                    </div>
                </div>`;
        }

        document.addEventListener('click', (e) => {
            const card = e.target.closest('[data-booking-open]');
            if (card) openBooking(card.dataset.bookingOpen);
            // Booking photos, in the booking box and on a booked-in job. The
            // path is carried in a data attribute, never written into an
            // onclick: it came from the booking form, and older bookings
            // were not held to a fixed shape. The viewer steps through the
            // other photos in the same group.
            const photo = e.target.closest('[data-booking-photo]');
            if (photo) {
                const group = photo.closest('[data-booking-gallery]');
                const tiles = group ? [...group.querySelectorAll('[data-booking-photo]')] : [photo];
                openPhotoViewer(tiles.map(t => t.dataset.bookingPhoto), Math.max(0, tiles.indexOf(photo)), photo);
            }
        });
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            // Not while a booking is open: the card underneath still has
            // focus, and reopening it would throw away what was typed.
            if (document.getElementById('booking-modal')) return;
            const card = e.target.closest && e.target.closest('[data-booking-open]');
            if (!card) return;
            e.preventDefault();
            openBooking(card.dataset.bookingOpen);
        });

        // <input type="datetime-local"> wants local time with no zone.
        function toLocalInputValue(d) {
            if (!d) return '';
            const pad = n => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
        }

        /* The booking form's brand list mixes in product lines ("Apple
           iPad"), which would make the job read "Apple iPad iPad Air". Cards
           and the box show the plain maker instead, and the booking keeps
           what the customer picked until the box is saved. */
        const BOOKING_BRAND_MAKERS = {
            'Apple iPad': 'Apple', 'Apple iMac/Mac': 'Apple',
            'Microsoft Xbox': 'Microsoft', 'Microsoft Surface': 'Microsoft',
            'Sony PlayStation': 'Sony', 'Amazon': 'Amazon', 'Custom Build': '', 'Other': ''
        };

        function bookingBrandForJob(brand) {
            const b = String(brand || '');
            return Object.prototype.hasOwnProperty.call(BOOKING_BRAND_MAKERS, b) ? BOOKING_BRAND_MAKERS[b] : b;
        }

        /* The booking box. It opens as a page to read: the drop-off time,
           the customer's photos, what they wrote and how to reach them, with
           the buttons that act on the booking. Edit turns the same box into
           the form to correct the details, Save or Cancel turns it back.

           Both halves are drawn at once, and the buttons always act on what
           the form holds. On the page to read that is the booking as shown,
           because leaving the form (Cancel, or Save) draws the box again
           from the booking. opts.booking: the copy to draw (after a save,
           before the board has caught up); opts.mode: 'edit' to open on
           the form. */
        function openBooking(bookingId, opts = {}) {
            const booking = opts.booking || allBookings.find(b => b.id === bookingId);
            if (!booking) return;
            document.getElementById('booking-modal')?.remove();

            const customer = booking.customer || {};
            const device = booking.device || {};
            const parts = String(customer.name || '').trim().split(/\s+/);
            const first = parts[0] || '';
            const last = parts.slice(1).join(' ');
            const isNew = isNewBooking(booking);
            const email = String(customer.email || '');
            const phone = String(customer.phone || '');
            const photos = Array.isArray(booking.photoPaths) ? booking.photoPaths : [];
            const cost = typeof booking.estimatedCost === 'number' ? booking.estimatedCost : '';
            const emailedAt = bookingDate(booking.confirmationEmailedAt) ? formatBookingTime(booking.confirmationEmailedAt) : '';
            const emailedTo = String(booking.confirmationEmailedTo || '');
            const missedAt = bookingDate(booking.missedEmailedAt) ? formatBookingTime(booking.missedEmailedAt) : '';
            const missedTo = String(booking.missedEmailedTo || '');
            const when = bookingDate(booking.preferredAt);
            const passed = !!when && when <= new Date();
            const statusChip = `<span class="booking-chip${isNew ? ' booking-chip--new' : ''}">${isNew ? 'New, not yet confirmed' : 'Confirmed'}</span>`;
            const emailLink = email
                ? `<a href="mailto:${escapeHTML(mailtoAddress(email))}">${escapeHTML(email)}</a>`
                : 'None';
            const phoneLink = phone
                ? `<a href="tel:${escapeHTML(phone.replace(/[^0-9+]/g, ''))}">${escapeHTML(phone)}</a>`
                : 'None';
            const confirmationFact = emailedAt
                ? `<div><span>Confirmation email</span>Sent ${escapeHTML(emailedAt)}${emailedTo ? ' to ' + escapeHTML(emailedTo) : ''}</div>` : '';
            const missedFact = missedAt
                ? `<div><span>Missed appointment email</span>Sent ${escapeHTML(missedAt)}${missedTo ? ' to ' + escapeHTML(missedTo) : ''}</div>` : '';

            const modal = document.createElement('div');
            modal.className = 'modal show';
            modal.id = 'booking-modal';
            modal.dataset.mode = opts.mode === 'edit' ? 'edit' : 'view';
            modal.setAttribute('role', 'dialog');
            modal.setAttribute('aria-modal', 'true');
            modal.setAttribute('aria-labelledby', 'booking-modal-title');
            modal.innerHTML = `
                <div class="modal-content modal-content--job booking-modal-content" tabindex="-1">
                    <div class="modal-header">
                        <h2 class="modal-title" id="booking-modal-title">Booking: ${escapeHTML(customer.name || 'No name')}</h2>
                        <button type="button" class="close-btn" data-booking-close aria-label="Close">&times;</button>
                    </div>
                    <form id="booking-edit-form" novalidate>
                        <div class="job-body">
                            <!-- The booking to read. Everything the customer
                                 typed goes through escapeHTML. -->
                            <div class="bk-view-only">
                                <div class="bk-chips">
                                    ${statusChip}
                                    ${missedEmailSent(booking) ? '<span class="booking-chip booking-chip--missed">Missed, emailed</span>' : ''}
                                </div>
                                <div class="bk-when">
                                    <span class="bk-label">Drop-off</span>
                                    ${when ? `
                                        <span class="bk-when__day">${escapeHTML(when.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</span>
                                        <span class="bk-when__time">${escapeHTML(when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))}</span>
                                        ${passed ? '<span class="bk-when__note">This time has passed.</span>' : ''}`
                                    : '<span class="bk-when__day">No time given</span>'}
                                </div>
                                <span class="bk-label">${photos.length ? `Photos from the customer (${photos.length})` : 'Photos'}</span>
                                ${photos.length ? bookingPhotoTiles(photos) : '<p class="bk-none">No photos were sent with this booking.</p>'}
                                <span class="bk-label">Fault, as the customer wrote it</span>
                                <div class="bk-fault">${escapeHTML(booking.issue || 'Not given')}</div>
                                <div class="booking-facts">
                                    <div><span>Name</span>${escapeHTML(customer.name || 'Not given')}</div>
                                    <div><span>Phone</span>${phoneLink}</div>
                                    <div><span>Email</span>${emailLink}</div>
                                    <div><span>Device type</span>${escapeHTML(BOOKING_CATEGORIES[device.category] || 'Not given')}</div>
                                    <div><span>Brand</span>${escapeHTML(bookingBrandForJob(device.brand) || 'Not given')}</div>
                                    <div><span>Model</span>${escapeHTML(device.model || 'Not given')}</div>
                                    ${cost !== '' ? `<div><span>Estimated price</span>£${escapeHTML(cost.toFixed(2))}</div>` : ''}
                                    <div><span>Reference</span>${escapeHTML(bookingReference(booking))}</div>
                                    <div><span>Requested</span>${escapeHTML(formatBookingTime(booking.createdAt))}</div>
                                    ${confirmationFact}
                                    ${missedFact}
                                </div>
                            </div>
                            <!-- The form, as the box used to open. -->
                            <div class="bk-edit-only">
                                <div class="booking-facts">
                                    <div><span>Status</span>${statusChip}</div>
                                    <div><span>Reference</span>${escapeHTML(bookingReference(booking))}</div>
                                    <div><span>Requested</span>${escapeHTML(formatBookingTime(booking.createdAt))}</div>
                                    ${confirmationFact}
                                </div>
                                ${photos.length ? bookingPhotoTiles(photos) : ''}
                                <div class="form-grid booking-form-grid">
                                    <div class="form-group">
                                        <label class="form-label" for="bk-first">First name</label>
                                        <input type="text" class="form-input" id="bk-first" maxlength="60" autocomplete="off" autocapitalize="words" value="${escapeHTML(first)}">
                                    </div>
                                    <div class="form-group">
                                        <label class="form-label" for="bk-last">Last name</label>
                                        <input type="text" class="form-input" id="bk-last" maxlength="60" autocomplete="off" autocapitalize="words" value="${escapeHTML(last)}">
                                    </div>
                                    <div class="form-group">
                                        <label class="form-label" for="bk-email">Email</label>
                                        <input type="email" class="form-input" id="bk-email" maxlength="200" inputmode="email" autocapitalize="off" spellcheck="false" value="${escapeHTML(email)}">
                                    </div>
                                    <div class="form-group">
                                        <label class="form-label" for="bk-phone">Mobile number</label>
                                        <input type="tel" class="form-input" id="bk-phone" maxlength="24" inputmode="tel" value="${escapeHTML(phone)}">
                                    </div>
                                    <div class="form-group">
                                        <label class="form-label" for="bk-when">Drop-off</label>
                                        <input type="datetime-local" class="form-input" id="bk-when" value="${escapeHTML(toLocalInputValue(when))}">
                                    </div>
                                    <div class="form-group">
                                        <label class="form-label" for="bk-category">Device type</label>
                                        <select class="form-input" id="bk-category">
                                            ${Object.entries(BOOKING_CATEGORIES).map(([value, label]) =>
                                                `<option value="${value}"${device.category === value ? ' selected' : ''}>${label}</option>`).join('')}
                                        </select>
                                    </div>
                                    <div class="form-group">
                                        <label class="form-label" for="bk-brand">Brand</label>
                                        <input type="text" class="form-input" id="bk-brand" maxlength="50" autocomplete="off" value="${escapeHTML(bookingBrandForJob(device.brand))}">
                                    </div>
                                    <div class="form-group">
                                        <label class="form-label" for="bk-model">Model</label>
                                        <input type="text" class="form-input" id="bk-model" maxlength="100" autocomplete="off" value="${escapeHTML(device.model || '')}">
                                    </div>
                                </div>
                                <div class="form-group">
                                    <label class="form-label" for="bk-issue">Fault</label>
                                    <textarea class="form-input form-textarea" id="bk-issue" maxlength="1000">${escapeHTML(booking.issue || '')}</textarea>
                                    <small style="color: var(--text-muted);">Shown to the customer on their tracking page once booked in.</small>
                                </div>
                                <div class="form-group">
                                    <label class="form-label" for="bk-cost">Estimated price (£, optional)</label>
                                    <input type="number" class="form-input" id="bk-cost" min="0" step="0.01" inputmode="decimal" value="${escapeHTML(cost)}">
                                </div>
                            </div>
                            <!-- What Confirm booking and Book in also send. -->
                            <div class="bk-view-only bk-options">
                                ${isNew ? `<label class="booking-check">
                                    <input type="checkbox" id="bk-confirm-email">
                                    <span>When confirming, email the customer that their booking is confirmed, with the drop-off time, address and reference. <small id="bk-confirm-email-note"></small></span>
                                </label>` : ''}
                                <label class="booking-check">
                                    <input type="checkbox" id="bk-send-email"${isValidEmail(email) ? ' checked' : ''}>
                                    <span>When booking in, email the customer their tracking link (the same email as the Send tracking email button).</span>
                                </label>
                            </div>
                        </div>
                        <!-- Outside the scrolling part, so a message shows
                             beside the buttons however far down the box is. -->
                        <div class="alert alert-error hidden" id="bk-error" style="margin: 1rem 0 0;"></div>
                        <div class="modal-actions booking-actions">
                            <button type="button" class="btn btn-danger bk-view-only" data-booking-action="remove"><i class="fas fa-trash"></i> Remove</button>
                            <button type="button" class="btn btn-secondary bk-edit-only" data-booking-action="cancel-edit">Cancel</button>
                            <span class="modal-actions__spacer"></span>
                            <button type="button" class="btn btn-secondary bk-view-only" data-booking-action="edit"><i class="fas fa-pen"></i> Edit details</button>
                            ${passed ? `<button type="button" class="btn btn-secondary bk-view-only" data-booking-action="missed"><i class="fas fa-envelope"></i> Missed appointment email</button>` : ''}
                            <button type="button" class="btn btn-secondary bk-view-only" data-booking-action="${isNew ? 'confirm' : 'unconfirm'}">
                                <i class="fas ${isNew ? 'fa-check' : 'fa-rotate-left'}"></i> ${isNew ? 'Confirm booking' : 'Mark as new'}
                            </button>
                            <button type="button" class="btn btn-primary bk-view-only" data-booking-action="book-in"><i class="fas fa-tools"></i> Book in as job</button>
                            <button type="button" class="btn btn-primary bk-edit-only" data-booking-action="save"><i class="fas fa-save"></i> Save changes</button>
                        </div>
                    </form>
                </div>`;
            modal.dataset.bookingId = booking.id;
            document.body.appendChild(modal);
            fillBookingThumbs(modal);
            // Not a text box: on the iPad that would bring the keyboard up
            // over a page that is there to be read.
            modal.querySelector('.booking-modal-content').focus({ preventScroll: true });

            // A message already showing stays: a button on the page to read
            // can switch to the form to show the box its message is about.
            const setMode = (mode) => {
                modal.dataset.mode = mode;
                modal.querySelector('.job-body').scrollTop = 0;
            };

            /* The booking confirmation email box (only with Confirm). It
               follows the email and drop-off boxes as they are edited: it
               cannot be ticked without a valid address and a drop-off time
               still to come, and says why. Otherwise it is ticked, unless a
               confirmation was already emailed (Mark as new, then Confirm
               again, must not send a second by accident) or staff have
               ticked or unticked it themselves. */
            const confirmBox = modal.querySelector('#bk-confirm-email');
            if (confirmBox) {
                const note = modal.querySelector('#bk-confirm-email-note');
                const sentNote = emailedAt
                    ? `A confirmation email was already sent${emailedTo ? ' to ' + emailedTo : ''} on ${emailedAt}.`
                    : '';
                let choice = null;
                confirmBox.addEventListener('change', () => { choice = confirmBox.checked; });
                const refresh = () => {
                    const whenValue = modal.querySelector('#bk-when').value;
                    const why = confirmEmailBlocker(modal.querySelector('#bk-email').value, whenValue ? new Date(whenValue) : null);
                    confirmBox.disabled = !!why;
                    if (why) confirmBox.checked = false;
                    else confirmBox.checked = choice !== null ? choice : !emailedAt;
                    note.textContent = why || sentNote;
                };
                ['#bk-email', '#bk-when'].forEach(sel => {
                    modal.querySelector(sel).addEventListener('input', refresh);
                    modal.querySelector(sel).addEventListener('change', refresh);
                });
                refresh();
            }

            const BUSY_LABELS = { save: 'Saving…', confirm: 'Saving…', unconfirm: 'Saving…', remove: 'Removing…', 'book-in': 'Booking in…', missed: 'Sending…' };
            modal.addEventListener('click', async (e) => {
                if (modal.dataset.busy) return;
                if (e.target === modal || e.target.closest('[data-booking-close]')) { modal.remove(); return; }
                const actionBtn = e.target.closest('[data-booking-action]');
                if (!actionBtn || actionBtn.disabled) return;
                const action = actionBtn.dataset.bookingAction;
                if (action === 'edit') {
                    modal.querySelector('#bk-error').classList.add('hidden');
                    setMode('edit');
                    return;
                }
                if (action === 'cancel-edit') {
                    openBooking(booking.id, { booking: allBookings.find(b => b.id === booking.id) || booking });
                    return;
                }
                const buttons = modal.querySelectorAll('[data-booking-action]');
                const label = actionBtn.innerHTML;
                const setBusy = (busy) => {
                    if (busy) modal.dataset.busy = '1'; else delete modal.dataset.busy;
                    buttons.forEach(b => { b.disabled = busy; });
                    actionBtn.innerHTML = busy ? `<i class="fas fa-spinner fa-spin"></i> ${BUSY_LABELS[action] || 'Saving…'}` : label;
                };
                try {
                    await runBookingAction(booking, action, modal, setBusy, setMode);
                } finally {
                    if (modal.isConnected) setBusy(false);
                }
            });
        }

        /* === BOOKING PHOTOS ===
           Each photo is drawn by an <img> from its download link, never by
           sending a tab to that link (see openPhotoViewer). The links are
           kept for the session, so a photo seen once opens at once. */
        const bookingPhotoUrls = new Map();

        function bookingPhotoUrl(path) {
            if (!bookingPhotoUrls.has(path)) {
                const url = storage.ref(path).getDownloadURL();
                bookingPhotoUrls.set(path, url);
                // A link that could not be fetched is asked for again next time.
                url.catch(() => { if (bookingPhotoUrls.get(path) === url) bookingPhotoUrls.delete(path); });
            }
            return bookingPhotoUrls.get(path);
        }

        // The photos as tiles; fillBookingThumbs puts the pictures in once
        // the tiles are on the page.
        function bookingPhotoTiles(paths) {
            return `<div class="booking-thumbs" data-booking-gallery>${paths.map((path, i) => `
                <button type="button" class="booking-thumb" data-booking-photo="${escapeHTML(path)}" aria-label="Open photo ${i + 1} of ${paths.length} large">
                    <span class="booking-thumb__label"><i class="fas fa-image"></i> Photo ${i + 1}</span>
                    <span class="booking-thumb__zoom" aria-hidden="true"><i class="fas fa-magnifying-glass-plus"></i></span>
                </button>`).join('')}</div>`;
        }

        function fillBookingThumbs(root) {
            root.querySelectorAll('.booking-thumb[data-booking-photo]').forEach(tile => {
                if (tile.dataset.filled) return;
                tile.dataset.filled = '1';
                const label = tile.querySelector('.booking-thumb__label');
                const failed = () => {
                    tile.classList.remove('is-loaded');
                    label.textContent = 'Photo could not be loaded. Tap to try again.';
                };
                bookingPhotoUrl(tile.dataset.bookingPhoto).then(url => {
                    if (!tile.isConnected) return;
                    const img = document.createElement('img');
                    img.alt = '';
                    img.decoding = 'async';
                    img.draggable = false;
                    img.addEventListener('load', () => tile.classList.add('is-loaded'));
                    img.addEventListener('error', () => { img.remove(); failed(); });
                    img.src = url;
                    tile.prepend(img);
                }, failed);
            });
        }

        /* The photo viewer: the photos over the whole screen, one at a time.
           Swipe, the arrows or the arrow keys for the next one; pinch,
           double-tap, the scroll wheel or the magnifier to zoom; drag to look
           round a zoomed photo. It sits above the booking box, which stays
           as it was underneath, and Escape closes the viewer only.

           A booking photo is shown by an <img>, never by sending a tab to
           the file's download link. Whoever uploads the file also chooses
           how that link hands it out, and a "photo" set to download as
           Booking-details.html (HTML inside, labelled a JPEG) arrived as a
           web page on the staff computer's own disk. An <img> only ever
           draws an image, whatever the file's settings say. */
        let closePhotoViewer = null;
        const PHOTO_MAX_ZOOM = 5;
        const PHOTO_TAP_ZOOM = 2.5;

        function openPhotoViewer(paths, start, returnFocus) {
            if (closePhotoViewer) closePhotoViewer();
            if (!paths.length) return;

            const touch = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
            const viewer = document.createElement('div');
            viewer.className = 'photo-viewer';
            viewer.id = 'photo-viewer';
            viewer.setAttribute('role', 'dialog');
            viewer.setAttribute('aria-modal', 'true');
            viewer.setAttribute('aria-label', 'Customer photos');
            viewer.innerHTML = `
                <div class="photo-viewer__stage">
                    <img class="photo-viewer__img" alt="" draggable="false" hidden>
                    <p class="photo-viewer__msg" role="status"></p>
                </div>
                <div class="photo-viewer__bar">
                    <span class="photo-viewer__count"></span>
                    <span class="photo-viewer__hint">${touch ? 'Pinch or double-tap to zoom. Swipe for the next photo.' : 'Scroll or double-click to zoom. Drag to move round.'}</span>
                    <button type="button" class="photo-viewer__btn" data-pv="zoom"></button>
                    <button type="button" class="photo-viewer__btn photo-viewer__btn--close" data-pv="close" aria-label="Close photos">&times;</button>
                </div>
                <button type="button" class="photo-viewer__nav photo-viewer__nav--prev" data-pv="prev" aria-label="Previous photo">&#8249;</button>
                <button type="button" class="photo-viewer__nav photo-viewer__nav--next" data-pv="next" aria-label="Next photo">&#8250;</button>`;
            document.body.appendChild(viewer);

            const stage = viewer.querySelector('.photo-viewer__stage');
            const img = viewer.querySelector('.photo-viewer__img');
            const msg = viewer.querySelector('.photo-viewer__msg');
            const count = viewer.querySelector('.photo-viewer__count');
            const zoomBtn = viewer.querySelector('[data-pv="zoom"]');
            const prevBtn = viewer.querySelector('[data-pv="prev"]');
            const nextBtn = viewer.querySelector('[data-pv="next"]');
            let index = 0;
            let scale = 1, tx = 0, ty = 0;   // zoom, and how far the photo is moved from the centre
            let loading = 0;
            let zoomedIcon = null;

            const apply = (animate) => {
                viewer.classList.toggle('is-animating', !!animate);
                img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
                const zoomed = scale > 1.01;
                stage.classList.toggle('is-zoomed', zoomed);
                if (zoomedIcon !== zoomed) {
                    zoomedIcon = zoomed;
                    zoomBtn.setAttribute('aria-label', zoomed ? 'Zoom out' : 'Zoom in');
                    zoomBtn.innerHTML = `<i class="fas ${zoomed ? 'fa-magnifying-glass-minus' : 'fa-magnifying-glass-plus'}"></i>`;
                }
            };
            // Keeps a zoomed photo over the screen: it can be moved until its
            // edge reaches the screen's edge, and no further.
            const clamp = () => {
                if (scale <= 1) { scale = 1; tx = 0; ty = 0; return; }
                const maxX = Math.max(0, (img.offsetWidth * scale - stage.clientWidth) / 2);
                const maxY = Math.max(0, (img.offsetHeight * scale - stage.clientHeight) / 2);
                tx = Math.min(maxX, Math.max(-maxX, tx));
                ty = Math.min(maxY, Math.max(-maxY, ty));
            };
            const centre = () => {
                const r = stage.getBoundingClientRect();
                return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
            };
            // Zooms to `next`, keeping the point at (x, y) on the screen where it is.
            const zoomAt = (next, x, y, animate) => {
                next = Math.min(PHOTO_MAX_ZOOM, Math.max(1, next));
                const c = centre();
                const dx = x - c.x, dy = y - c.y;
                tx = dx - (next / scale) * (dx - tx);
                ty = dy - (next / scale) * (dy - ty);
                scale = next;
                clamp();
                apply(animate);
            };
            const resetZoom = (animate) => { scale = 1; tx = 0; ty = 0; apply(animate); };

            const show = (i) => {
                index = Math.max(0, Math.min(paths.length - 1, i));
                resetZoom(false);
                count.textContent = paths.length > 1 ? `Photo ${index + 1} of ${paths.length}` : 'Photo';
                prevBtn.hidden = nextBtn.hidden = paths.length < 2;
                prevBtn.disabled = index === 0;
                nextBtn.disabled = index === paths.length - 1;
                img.hidden = true;
                img.removeAttribute('src');
                msg.textContent = 'Loading photo…';
                const ticket = ++loading;
                bookingPhotoUrl(paths[index]).then(url => {
                    if (ticket !== loading || !viewer.isConnected) return;
                    img.onload = () => {
                        if (ticket !== loading) return;
                        msg.textContent = '';
                        img.hidden = false;
                    };
                    img.onerror = () => {
                        if (ticket === loading) msg.textContent = 'This photo could not be loaded. Check the connection and open it again.';
                    };
                    img.src = url;
                }, error => {
                    if (ticket === loading) msg.textContent = 'This photo could not be loaded: ' + errorText(error) + '.';
                });
            };

            /* Touch, pen and mouse, through pointer events. One pointer drags:
               a zoomed photo moves with it, an unzoomed one follows the finger
               sideways and a long enough swipe changes photo. Two pointers
               pinch: the point of the photo under the fingers stays under
               them as they spread and move. */
            const pointers = new Map();
            let gesture = null;
            let pinched = false;   // this touch has pinched, so lifting a finger is not a tap
            let lastTap = null;

            const beginGesture = () => {
                const pts = [...pointers.values()];
                if (pts.length >= 2) {
                    const [a, b] = pts;
                    pinched = true;
                    gesture = {
                        kind: 'pinch', scale, tx, ty,
                        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
                        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
                    };
                } else if (pts.length === 1) {
                    gesture = { kind: 'drag', x: pts[0].x, y: pts[0].y, tx, ty, moved: false };
                } else {
                    gesture = null;
                }
            };

            const onTap = (x, y) => {
                const now = Date.now();
                if (lastTap && now - lastTap.time < 350 && Math.hypot(x - lastTap.x, y - lastTap.y) < 40) {
                    lastTap = null;
                    if (scale > 1.01) resetZoom(true);
                    else zoomAt(PHOTO_TAP_ZOOM, x, y, true);
                } else {
                    lastTap = { time: now, x, y };
                }
            };

            stage.addEventListener('pointerdown', (e) => {
                if (e.pointerType === 'mouse' && e.button !== 0) return;
                e.preventDefault();
                try { stage.setPointerCapture(e.pointerId); } catch (err) { /* not needed to work */ }
                pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
                beginGesture();
            });

            stage.addEventListener('pointermove', (e) => {
                const p = pointers.get(e.pointerId);
                if (!p || !gesture) return;
                p.x = e.clientX;
                p.y = e.clientY;
                if (gesture.kind === 'pinch' && pointers.size >= 2) {
                    const [a, b] = [...pointers.values()];
                    const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
                    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
                    const c = centre();
                    // Where on the photo (unzoomed, from its centre) the pinch began.
                    const ux = (gesture.mid.x - c.x - gesture.tx) / gesture.scale;
                    const uy = (gesture.mid.y - c.y - gesture.ty) / gesture.scale;
                    scale = Math.min(PHOTO_MAX_ZOOM, Math.max(1, gesture.scale * dist / gesture.dist));
                    tx = mid.x - c.x - scale * ux;
                    ty = mid.y - c.y - scale * uy;
                    clamp();
                    apply(false);
                } else if (gesture.kind === 'drag') {
                    const dx = p.x - gesture.x, dy = p.y - gesture.y;
                    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) gesture.moved = true;
                    if (scale > 1.01) {
                        tx = gesture.tx + dx;
                        ty = gesture.ty + dy;
                        clamp();
                    } else {
                        // Unzoomed: follow the finger sideways, with drag at
                        // the first and last photo.
                        const edge = (dx > 0 && index === 0) || (dx < 0 && index === paths.length - 1);
                        tx = edge ? dx / 3 : dx;
                        ty = 0;
                    }
                    apply(false);
                }
            });

            const endPointer = (e) => {
                const p = pointers.get(e.pointerId);
                if (!p) return;
                pointers.delete(e.pointerId);
                const g = gesture;
                if (pointers.size > 0) { beginGesture(); return; }
                gesture = null;
                const wasPinch = pinched;
                pinched = false;
                // A pinch ends where it was let go, unless it was let go
                // almost unzoomed. It is never a tap or a swipe.
                if (!g || g.kind !== 'drag' || wasPinch) {
                    if (scale < 1.05) resetZoom(true);
                    return;
                }
                const tapped = !g.moved && e.type === 'pointerup';
                if (scale > 1.01) {
                    if (tapped) onTap(p.x, p.y);
                    return;
                }
                const dx = p.x - g.x, dy = p.y - g.y;
                if (g.moved && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
                    const to = index + (dx < 0 ? 1 : -1);
                    if (to >= 0 && to < paths.length) { show(to); return; }
                }
                resetZoom(true);
                if (tapped) onTap(p.x, p.y);
            };
            stage.addEventListener('pointerup', endPointer);
            stage.addEventListener('pointercancel', endPointer);
            stage.addEventListener('lostpointercapture', endPointer);

            // Mouse wheel, and a trackpad pinch (which arrives as a wheel with ctrlKey).
            stage.addEventListener('wheel', (e) => {
                e.preventDefault();
                zoomAt(scale * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)), e.clientX, e.clientY, false);
            }, { passive: false });
            // Older iPad browsers send their own pinch events; keep them off the page.
            viewer.addEventListener('gesturestart', (e) => e.preventDefault());

            viewer.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-pv]');
                if (!btn || btn.disabled) return;
                const what = btn.dataset.pv;
                if (what === 'close') close();
                else if (what === 'prev') show(index - 1);
                else if (what === 'next') show(index + 1);
                else if (what === 'zoom') {
                    if (scale > 1.01) resetZoom(true);
                    else { const c = centre(); zoomAt(PHOTO_TAP_ZOOM, c.x, c.y, true); }
                }
            });

            // Ahead of the page's own keys (Escape there closes every box),
            // and kept inside the viewer while it is open.
            const onKey = (e) => {
                if (e.key === 'Escape') close();
                else if (e.key === 'ArrowLeft') { if (index > 0) show(index - 1); }
                else if (e.key === 'ArrowRight') { if (index < paths.length - 1) show(index + 1); }
                else if (e.key === '+' || e.key === '=') { const c = centre(); zoomAt(scale * 1.5, c.x, c.y, true); }
                else if (e.key === '-') { const c = centre(); zoomAt(scale / 1.5, c.x, c.y, true); }
                else if (e.key === 'Tab') {
                    const stops = [...viewer.querySelectorAll('button')].filter(b => !b.disabled && !b.hidden);
                    const at = stops.indexOf(document.activeElement);
                    const to = e.shiftKey ? (at <= 0 ? stops.length - 1 : at - 1) : (at + 1) % stops.length;
                    if (stops[to]) stops[to].focus();
                } else return;
                e.preventDefault();
                e.stopPropagation();
            };
            const onResize = () => { clamp(); apply(false); };
            window.addEventListener('keydown', onKey, true);
            window.addEventListener('resize', onResize);

            function close() {
                window.removeEventListener('keydown', onKey, true);
                window.removeEventListener('resize', onResize);
                loading++;
                viewer.remove();
                closePhotoViewer = null;
                if (returnFocus && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
            }
            closePhotoViewer = close;

            apply(false);
            show(start || 0);
            viewer.querySelector('[data-pv="close"]').focus({ preventScroll: true });
        }

        /* Removing a booking deletes its photos: the booking terms tell
           customers their photos are "deleted when the booking is closed or
           declined", and Remove used to leave them in Storage for good.
           Everything in the booking's folder goes, not just the photos the
           booking lists: a photo from a submit that failed and was retried
           with fewer photos is left in the same folder. If the folder cannot
           be listed, every name the rules allow there (photo-1.jpg to
           photo-3.jpg) is tried instead. Called after the booking is marked
           removed, so a booking booked in meanwhile keeps its photos.
           Returns '' when none is left, else why. The booking itself, and
           the shop's notice at mail/<id>, keep the customer's details: how
           long to keep those is the owner's call.

           The folder is named by the booking's tempId. That is also its
           document id now, but bookings made before 23 Sep 2026 were given
           a random document id, with their photos still under the tempId. */
        function bookingPhotoFolder(booking) {
            const tempId = String(booking.tempId || '');
            return 'bookings/' + (/^BK_[0-9A-F]{32}$/.test(tempId) ? tempId : booking.id);
        }

        async function deleteBookingPhotos(booking) {
            const folder = bookingPhotoFolder(booking);
            let paths;
            try {
                paths = (await storage.ref(folder).listAll()).items.map(item => item.fullPath);
            } catch (error) {
                paths = [1, 2, 3].map(i => `${folder}/photo-${i}.jpg`);
            }
            const failures = [];
            for (const path of paths) {
                try {
                    await storage.ref(path).delete();
                } catch (error) {
                    if (error && error.code === 'storage/object-not-found') continue;
                    failures.push(errorText(error));
                }
            }
            return failures.join('; ');
        }

        // What the form says now, checked. Returns null (and shows why) when
        // it is not good enough to save.
        function readBookingForm(modal, forBookIn) {
            const val = id => modal.querySelector('#' + id).value.trim();
            const err = modal.querySelector('#bk-error');
            const fail = (msg) => { err.textContent = msg; err.classList.remove('hidden'); return null; };

            const firstName = val('bk-first');
            const lastName = val('bk-last');
            const email = val('bk-email');
            const phone = val('bk-phone');
            const when = val('bk-when');
            const category = val('bk-category');
            const brand = val('bk-brand');
            const model = val('bk-model');
            const issue = val('bk-issue');
            const costRaw = val('bk-cost');

            if (!firstName) return fail('A first name is needed.');
            if (email && !isValidEmail(email)) return fail('That email address does not look right.');
            if (!email && !phone) return fail('Give at least an email address or a mobile number.');
            const preferredAt = when ? new Date(when) : null;
            if (when && isNaN(preferredAt)) return fail('That drop-off time does not look right.');
            if (!BOOKING_CATEGORIES[category]) return fail('Pick a device type.');
            if (forBookIn && !issue) return fail('Describe the fault before booking in. The customer sees it on their tracking page.');
            let estimatedCost = null;
            if (costRaw) {
                estimatedCost = Math.round(parseFloat(costRaw) * 100) / 100;
                if (!isFinite(estimatedCost) || estimatedCost < 0) return fail('The estimated price should be a number, like 49.99.');
            }
            err.classList.add('hidden');

            return {
                firstName, lastName, email, phone, category, brand, model, issue, estimatedCost, preferredAt,
                customerName: (firstName + ' ' + lastName).trim()
            };
        }

        // The form's edits, in the booking's own shape. An emptied drop-off
        // box clears the time, which puts the booking under No time given.
        function bookingEdits(form) {
            return {
                customer: { name: form.customerName, email: form.email, phone: form.phone },
                device: { category: form.category, brand: form.brand, model: form.model },
                issue: form.issue,
                estimatedCost: form.estimatedCost,
                preferredAt: form.preferredAt ? firebase.firestore.Timestamp.fromDate(form.preferredAt) : null,
                updatedAt: firebase.firestore.Timestamp.now(),
                updatedBy: currentUser ? currentUser.email : 'unknown'
            };
        }

        /* Every change to a booking checks, in the same transaction, that it
           is still waiting. A box left open in another tab could otherwise
           set a booked-in booking back to confirmed, or write over its
           details after the job was made.
           A booking confirmation email (`mail`, from
           buildBookingConfirmedMail) is written in the same transaction, so
           the booking is confirmed and its email queued together or not at
           all: no email for a booking removed or booked in elsewhere, and no
           booking marked as emailed when the email was refused.
           The email also goes only if the booking is still as it was when
           its box was opened (`opened`): not confirmed (for the
           confirmation email, still New), emailed or edited since in
           another tab or on another device. Otherwise a box left open
           would email the customer a second time, perhaps with an old
           drop-off time. The missed appointment email (from
           buildMissedAppointmentMail) is held to the same. */
        async function updateOpenBooking(bookingId, changes, mail, opened) {
            const ref = db.collection('bookings').doc(bookingId);
            const millis = ts => { const d = bookingDate(ts); return d ? d.getTime() : 0; };
            const confirming = !!mail && mail.data.meta.kind === 'booking-confirmed';
            await db.runTransaction(async (tx) => {
                const fresh = await tx.get(ref);
                const data = fresh.exists ? { id: fresh.id, ...fresh.data() } : null;
                if (!data || data.deleted === true || data.status === 'removed') throw new Error('this booking has been removed.');
                if (data.status === 'booked' || data.linkedRepairId) throw new Error('this booking is already booked in.');
                if (mail && (!opened || (confirming && data.status && data.status !== 'pending')
                    || String(data.confirmationMailId || '') !== String(opened.confirmationMailId || '')
                    || String(data.missedMailId || '') !== String(opened.missedMailId || '')
                    || millis(data.updatedAt) !== millis(opened.updatedAt))) {
                    throw new Error('this booking was changed in another tab or on another device after this box was opened. Close this box and open the booking again');
                }
                tx.update(ref, changes);
                if (mail) tx.set(mail.ref, mail.data);
            });
        }

        // Firebase messages already end in a full stop.
        function errorText(error) {
            return String((error && error.message) || error || 'unknown error').replace(/\.\s*$/, '');
        }

        // Another booking already confirmed for this drop-off time, or null.
        // The booking page shows a confirmed booking's time as booked, and
        // the booking function refuses new requests for it; two requests
        // that came in for the same time before either was confirmed are
        // caught here instead.
        function confirmedClash(bookingId, when) {
            if (!when || isNaN(when)) return null;
            return allBookings.find(b => b.id !== bookingId && isOpenBooking(b) && b.status && b.status !== 'pending'
                && (bookingDate(b.preferredAt) || 0).valueOf() === when.valueOf()) || null;
        }

        function clashText(clash) {
            const who = (clash.customer && clash.customer.name) || 'Another customer';
            return `${who}'s booking (${bookingReference(clash)}) is already confirmed for ${formatBookingTime(clash.preferredAt)}.`;
        }

        // Why Confirm booking cannot email the customer, or '' if it can.
        // when: the drop-off time as a Date, or null.
        function confirmEmailBlocker(email, when) {
            if (!window.OnlineFixEmail) return 'The email layout did not load. Reload the page to send this email.';
            if (!isValidEmail(email)) return 'Needs a valid email address.';
            if (!when || isNaN(when)) return 'Needs a drop-off time.';
            if (when <= new Date()) return 'The drop-off time has already passed.';
            return '';
        }

        // The device as a booking email names it: as Book in does, but
        // "Other" says nothing, so then the row is left out, as it is for a
        // device that holds a link (see looksLikeLink).
        function bookingEmailDevice(form) {
            const typed = [form.brand, form.model].filter(Boolean).join(' ');
            return (looksLikeLink(typed) ? '' : typed)
                || (form.category !== 'other' ? BOOKING_CATEGORIES[form.category] || '' : '');
        }

        /* The email telling a customer their online booking is confirmed,
           sent by Confirm booking when its box is ticked. The owner approved
           the wording on 27 Sep 2026; any change to it needs their OK too. The HTML is drawn by the shared
           email layout (new-repair/email-layout.js), which also gives the
           time as UK clocks show it, whatever the zone of this device. There
           is no plain-text fallback here: confirmEmailBlocker keeps the box
           off when the layout did not load.

           Returns the mail document and where it goes, for
           updateOpenBooking to write with the booking. The id is made here,
           before the transaction, so a retried transaction writes the same
           document, not a second one. It is never mail/{bookingId}: that is
           the shop's own notice of the booking. */
        function buildBookingConfirmedMail(booking, form) {
            const E = window.OnlineFixEmail;
            if (!E) throw new Error('the email layout did not load; reload the page');
            const w = E.ukWhen(form.preferredAt);
            if (!w) throw new Error('the booking has no drop-off time');

            // The name and device come from whoever filled in the booking
            // form, and may not carry a message of their own: see
            // greetingName and looksLikeLink.
            const name = greetingName(form.firstName) || 'there';
            const device = bookingEmailDevice(form);
            const reference = bookingReference(booking);
            const shop = { name: 'OnlineFix™', address: BOOKING_SHOP_ADDRESS, phone: SHOP_PHONE, email: SHOP_EMAIL };
            const mapsUrl = E.mapsUrl(shop.address);
            const termsUrl = SITE_URL + '/booking-terms.html';
            // "13 Quarry Street" over "Guildford, Surrey, GU1 3UY".
            const street = shop.address.split(', ')[0];
            const town = shop.address.slice(street.length + 2);

            // ---- Wording (approved by the owner; ask before changing) ----
            const subject = `Your booking is confirmed — ${w.full}`;
            const preheader = `Drop-off at 13 Quarry Street, Guildford. Your reference: ${reference}.`;
            const hi = `Hi ${name},`;
            const lead = 'Thanks for booking with us. We\'ve confirmed your drop-off, and the details are below.';
            const before = [
                'Back up your data. Some repairs need a factory reset. We\'ll do our best to keep your data, but we can\'t guarantee it.',
                'We\'ll check the device and quote you before doing any repair work. Diagnostics cost £20 for phones, tablets, consoles and laptops, or £40 for desktop PCs.',
                'Payment is on collection, by cash or bank transfer. We don\'t take cards, Apple Pay or Google Pay.'
            ];
            const change = phone => `You can do this any time before drop-off. Just reply to this email or call us on ${phone} (7 days, 10am to 10pm). There's no cancellation fee.`;

            const html = E.layout({
                subject,
                preheader,
                body: [
                    E.heading('Booking confirmed', { accent: 'confirmed', gap: 12 }),
                    E.chip('Drop-off booking // Guildford'),
                    E.paragraph(hi, { gap: 8 }),
                    E.paragraph(lead, { gap: 22 }),
                    E.factCard([
                        E.row('When', E.when(w.date, w.time)),
                        E.row('Where', E.join(E.strong(shop.name), E.br(), street, E.br(), E.keepPostcode(town))),
                        device && E.row('Device', device, { kind: 'strong' }),
                        E.row('Your reference', reference, { kind: 'ref' })
                    ], { gap: 20 }),
                    E.button(mapsUrl, 'Get directions', { gap: 30 }),
                    E.subheading('Before you come in'),
                    E.list(before, { gap: 18 }),
                    E.subheading('Need to change or cancel?'),
                    // No-break spaces keep the phone number on one line.
                    E.paragraph(change(shop.phone.replace(/ /g, '\u00a0'))),
                    E.button(E.telHref(shop.phone), 'Call ' + shop.phone, { variant: 'secondary', gap: 26 }),
                    E.paragraph(E.join('See you soon,', E.br(), E.strong(shop.name)), { gap: 18 })
                ],
                footer: E.shopFooter(shop, [E.link(termsUrl, 'Booking terms', { color: E.colors.footText, bold: false, tap: true })])
            });

            const text = `${hi}\n\n${lead}\n\n` +
                `When: ${w.full}\n` +
                `Where: ${shop.name}, ${shop.address}\n` +
                (device ? `Device: ${device}\n` : '') +
                `Your reference: ${reference}\n\n` +
                `Get directions: ${mapsUrl}\n\n` +
                'Before you come in:\n' + before.map(line => '- ' + line).join('\n') + '\n\n' +
                'Need to change or cancel? ' + change(shop.phone) + '\n\n' +
                `See you soon,\n${shop.name}\n\n` +
                `${shop.name} · ${shop.address}\n${shop.phone} · ${shop.email}\n` +
                `Booking terms: ${termsUrl}\n`;

            return {
                ref: db.collection('mail').doc(),
                when: w.full,
                // For the prompt before it goes (runBookingAction).
                greeting: hi,
                device,
                data: {
                    to: [form.email],
                    replyTo: SHOP_EMAIL,
                    message: { subject, text, html },
                    meta: {
                        kind: 'booking-confirmed',
                        bookingId: booking.id,
                        reference,
                        sentBy: currentUser ? currentUser.email : 'unknown',
                        createdAt: firebase.firestore.Timestamp.now()
                    }
                }
            };
        }

        // Why the missed appointment email cannot go, or '' if it can.
        // when: the drop-off time as a Date, or null.
        function missedEmailBlocker(email, when, phone) {
            if (!window.OnlineFixEmail) return 'The email layout did not load. Reload the page to send this email.';
            if (!isValidEmail(email)) {
                return 'This booking has no valid email address, so the customer cannot be emailed.' +
                    (phone ? ` Call or text them on ${phone} instead.` : '');
            }
            if (!when || isNaN(when)) return 'This booking has no drop-off time.';
            if (when > new Date()) return 'The drop-off time has not passed yet.';
            return '';
        }

        /* The email to a customer who did not come to their drop-off, sent
           by the booking box's Missed appointment email button once the
           drop-off time has passed. It is the one follow-up the booking
           terms promise: "If you don't show up at the agreed slot and don't
           get in touch, we'll send one follow-up email. If we still don't
           hear from you, the booking lapses, and we reserve the right not
           to accept future bookings from you."

           The wording was approved by the owner on 16 Oct 2026, including
           the firmer opening and the line about future bookings, so any
           change to what the customer reads needs their OK again.
           Built and written like buildBookingConfirmedMail: the same
           layout, the same care with the words taken from the booking, and
           the same transaction, which also marks the booking as emailed. */
        function buildMissedAppointmentMail(booking, form) {
            const E = window.OnlineFixEmail;
            if (!E) throw new Error('the email layout did not load; reload the page');
            const w = E.ukWhen(form.preferredAt);
            if (!w) throw new Error('the booking has no drop-off time');

            const name = greetingName(form.firstName) || 'there';
            const device = bookingEmailDevice(form);
            const reference = bookingReference(booking);
            const shop = { name: 'OnlineFix™', address: BOOKING_SHOP_ADDRESS, phone: SHOP_PHONE, email: SHOP_EMAIL };
            const bookUrl = SITE_URL + '/book/';
            const termsUrl = SITE_URL + '/booking-terms.html';

            // ---- Wording (draft; the owner approves it before it is used) ----
            const subject = `We missed you on ${w.date}`;
            const preheader = `Your drop-off was booked for ${w.full}. Book a new time, or let us know.`;
            const hi = `Hi ${name},`;
            const lead = `You had a drop-off appointment with us on ${w.full}, and we haven't heard from you about cancelling or rescheduling it.`;
            const rebook = phone => `Book a new time online, or reply to this email or call us on ${phone} (7 days, 10am to 10pm) and we'll find a time that suits you.`;
            const lapse = 'If we don\'t hear from you, this booking will lapse. Please be aware that we reserve the right not to accept future bookings.';

            const html = E.layout({
                subject,
                preheader,
                body: [
                    E.heading('We missed you', { accent: 'missed', gap: 12 }),
                    E.chip('Drop-off booking // Guildford'),
                    E.paragraph(hi, { gap: 8 }),
                    E.paragraph(lead, { gap: 22 }),
                    E.factCard([
                        E.row('Your drop-off was', E.when(w.date, w.time)),
                        device && E.row('Device', device, { kind: 'strong' }),
                        E.row('Your reference', reference, { kind: 'ref' })
                    ], { gap: 20 }),
                    E.subheading('Still need a repair?'),
                    // No-break spaces keep the phone number on one line.
                    E.paragraph(rebook(shop.phone.replace(/ /g, '\u00a0')), { gap: 18 }),
                    E.button(bookUrl, 'Book a new time', { gap: 12 }),
                    E.button(E.telHref(shop.phone), 'Call ' + shop.phone, { variant: 'secondary', gap: 26 }),
                    E.paragraph(lapse, { gap: 18 }),
                    E.paragraph(E.join('Thanks,', E.br(), E.strong(shop.name)), { gap: 18 })
                ],
                footer: E.shopFooter(shop, [E.link(termsUrl, 'Booking terms', { color: E.colors.footText, bold: false, tap: true })])
            });

            const text = `${hi}\n\n${lead}\n\n` +
                `Your drop-off was: ${w.full}\n` +
                (device ? `Device: ${device}\n` : '') +
                `Your reference: ${reference}\n\n` +
                'Still need a repair? ' + rebook(shop.phone) + '\n\n' +
                `Book a new time: ${bookUrl}\n\n` +
                `${lapse}\n\n` +
                `Thanks,\n${shop.name}\n\n` +
                `${shop.name} · ${shop.address}\n${shop.phone} · ${shop.email}\n` +
                `Booking terms: ${termsUrl}\n`;

            return {
                ref: db.collection('mail').doc(),
                when: w.full,
                // For the prompt before it goes (runBookingAction).
                greeting: hi,
                device,
                data: {
                    to: [form.email],
                    replyTo: SHOP_EMAIL,
                    message: { subject, text, html },
                    meta: {
                        kind: 'booking-missed',
                        bookingId: booking.id,
                        reference,
                        sentBy: currentUser ? currentUser.email : 'unknown',
                        createdAt: firebase.firestore.Timestamp.now()
                    }
                }
            };
        }

        async function runBookingAction(opened, action, modal, setBusy, setMode) {
            // The board only holds bookings still waiting, so one booked in or
            // removed elsewhere drops out of it while its box is open here.
            // Carry on with the copy the box was opened from: every write
            // below re-reads the booking and says what happened to it.
            // After a save or an email the box is drawn from what it wrote,
            // which the board may not have caught up with yet: then the
            // box's copy is the newer one.
            const listed = allBookings.find(b => b.id === opened.id);
            const millis = ts => { const d = bookingDate(ts); return d ? d.getTime() : 0; };
            const booking = listed && millis(listed.updatedAt) >= millis(opened.updatedAt) ? listed : opened;
            const bookingId = booking.id;
            const name = (booking.customer && booking.customer.name) || 'this customer';
            let emailing = false;   // Confirm booking with its email

            try {
                if (action === 'remove') {
                    const hasPhotos = Array.isArray(booking.photoPaths) && booking.photoPaths.length > 0;
                    if (!confirm(`Remove the booking from ${name}? It leaves the board and cannot be booked in afterwards.${hasPhotos ? ' Its photos are deleted.' : ''} The customer is not told.`)) return;
                    setBusy(true);
                    await updateOpenBooking(bookingId, { status: 'removed', deleted: true, deletedAt: firebase.firestore.Timestamp.now() });
                    modal.remove();
                    const photosLeft = await deleteBookingPhotos(booking);
                    if (photosLeft) showAlert(`Booking removed, but its photos could not be deleted (${photosLeft}). They are in Firebase Storage under ${bookingPhotoFolder(booking)}/.`, 'error', { sticky: true });
                    else showAlert('Booking removed.', 'success');
                    return;
                }

                const form = readBookingForm(modal, action === 'book-in');
                if (!form) {
                    // The message is about a box on the form, so show the form.
                    if (modal.dataset.mode !== 'edit') setMode('edit');
                    return;
                }

                if (action === 'save') {
                    // Moving a confirmed booking onto another one's time.
                    const moved = (bookingDate(booking.preferredAt) || 0).valueOf() !== (form.preferredAt || 0).valueOf();
                    const clash = moved && booking.status && booking.status !== 'pending'
                        ? confirmedClash(bookingId, form.preferredAt) : null;
                    if (clash && !confirm(`${clashText(clash)}\n\nMove this booking to the same time anyway?`)) return;
                    setBusy(true);
                    const changes = bookingEdits(form);
                    await updateOpenBooking(bookingId, changes);
                    // Back to the booking to read, as saved. Drawn from the
                    // saved changes: the board may not have caught up yet.
                    openBooking(bookingId, { booking: { ...booking, ...changes } });
                    showAlert('Booking saved.', 'success');
                } else if (action === 'missed') {
                    const err = modal.querySelector('#bk-error');
                    const why = missedEmailBlocker(form.email, form.preferredAt, form.phone);
                    if (why) {
                        err.textContent = why;
                        err.classList.remove('hidden');
                        return;
                    }
                    // As with the confirmation email, the prompt quotes the
                    // words taken from the booking before they are sent in
                    // the shop's name.
                    const mail = buildMissedAppointmentMail(booking, form);
                    const before = bookingDate(booking.missedEmailedAt)
                        ? `\n\nA missed appointment email was already sent on ${formatBookingTime(booking.missedEmailedAt)}` +
                          `${booking.missedEmailedTo ? ' to ' + booking.missedEmailedTo : ''}. This sends another one.`
                        : '';
                    if (!confirm(`Email ${form.customerName} that they missed their drop-off on ${mail.when}?\n\n` +
                        `It goes to ${form.email}, starts "${mail.greeting}"` +
                        (mail.device ? ` and gives the device as "${mail.device}".` : ' and names no device.') +
                        ' It offers a new time, and says the booking lapses if they don\'t get in touch and that future bookings may be refused.' + before)) return;
                    setBusy(true);
                    const now = firebase.firestore.Timestamp.now();
                    const changes = {
                        missedEmailedAt: now,
                        missedEmailedTo: form.email,
                        missedMailId: mail.ref.id,
                        updatedAt: now,
                        updatedBy: currentUser ? currentUser.email : 'unknown'
                    };
                    await updateOpenBooking(bookingId, changes, mail, opened);
                    // The box stays open, now saying the email went.
                    openBooking(bookingId, { booking: { ...booking, ...changes } });
                    showAlert(`The missed appointment email is queued to ${form.email}. The booking stays on the board until you remove it or book it in.`, 'success');
                } else if (action === 'confirm') {
                    const box = modal.querySelector('#bk-confirm-email');
                    emailing = !!box && box.checked && !box.disabled && !confirmEmailBlocker(form.email, form.preferredAt);
                    // Drawn before anything is saved, so a problem with the
                    // email stops the confirm too.
                    //
                    // The prompt quotes the email's greeting and device line.
                    // Anyone can book with anyone's address, and this email
                    // goes from the shop's own Gmail, so staff see the words
                    // taken from the booking before they are sent in the
                    // shop's name.
                    const mail = emailing ? buildBookingConfirmedMail(booking, form) : null;
                    const clash = confirmedClash(bookingId, form.preferredAt);
                    if (clash && !mail && !confirm(`${clashText(clash)}\n\nConfirm this one for the same time anyway?`)) return;
                    if (mail && !confirm((clash ? clashText(clash) + '\n\n' : '') + `Confirm ${form.customerName}'s booking for ${mail.when}?\n\n` +
                        `The confirmation email will be sent to ${form.email}. It starts "${mail.greeting}"` +
                        (mail.device ? ` and gives the device as "${mail.device}".` : ' and names no device.'))) return;
                    setBusy(true);
                    const now = firebase.firestore.Timestamp.now();
                    const changes = { ...bookingEdits(form), status: 'confirmed', confirmedAt: now };
                    // Kept on the booking so its box can say the email went,
                    // and does not tick the box again. Mark as new keeps them.
                    if (mail) Object.assign(changes, { confirmationEmailedAt: now, confirmationEmailedTo: form.email, confirmationMailId: mail.ref.id });
                    await updateOpenBooking(bookingId, changes, mail, opened);
                    modal.remove();
                    showAlert(mail
                        ? `Booking confirmed. The confirmation email is queued to ${form.email}.`
                        : 'Booking confirmed. No email was sent; reply to their email or call them.', 'success');
                } else if (action === 'unconfirm') {
                    setBusy(true);
                    await updateOpenBooking(bookingId, { ...bookingEdits(form), status: 'pending', confirmedAt: null });
                    modal.remove();
                    showAlert('Booking marked as new.', 'success');
                } else if (action === 'book-in') {
                    const sendEmail = modal.querySelector('#bk-send-email').checked && isValidEmail(form.email);
                    const device = [form.brand, form.model].filter(Boolean).join(' ') || BOOKING_CATEGORIES[form.category];
                    const mailNote = sendEmail ? `\n\nTheir tracking link will be emailed to ${form.email}.` : '';
                    if (!confirm(`Book in ${form.customerName}'s ${device} as a job?\n\nDo this when the device is handed in: it goes on the jobs board, and on the customer's tracking page, as Received.${mailNote}`)) return;
                    setBusy(true);
                    const repair = await bookInBooking(booking, form);
                    modal.remove();
                    const notes = [];
                    if (!repair.customerSaved) notes.push('The customer record was not updated.');
                    let failed = false;
                    if (sendEmail) {
                        try {
                            await queueTrackingEmail(repair, form.email);
                            notes.push(`The tracking email is queued to ${form.email}.`);
                        } catch (error) {
                            failed = true;
                            notes.push(`The tracking email could not be queued (${errorText(error)}). Open the job and use Send tracking email.`);
                        }
                    }
                    showAlert(`Booked in as ${repair.repairId}. It is on the jobs board. ${notes.join(' ')}`.trim(),
                        failed ? 'error' : 'success', { sticky: failed || !repair.customerSaved });
                }
            } catch (error) {
                // With the email, say plainly that it did not go, and how to
                // confirm without it (unless the booking has gone, or this
                // box is out of date).
                const message = action === 'missed'
                    ? `Could not send the missed appointment email: ${errorText(error)}. Nothing was sent.`
                    : emailing
                    ? `Could not confirm: ${errorText(error)}. Nothing was saved or sent.` +
                      (/has been removed|already booked in|another tab or on another device/.test(errorText(error)) ? '' : ' To confirm without the email, untick the email box and press Confirm booking again.')
                    : '';
                const err = modal.isConnected && modal.querySelector('#bk-error');
                if (err) {
                    err.textContent = message || 'Could not save: ' + errorText(error) + '.';
                    err.classList.remove('hidden');
                } else {
                    showAlert(message || 'Could not update that booking: ' + errorText(error) + '.', 'error', { sticky: true });
                }
            }
        }

        function randomHex(bytes) {
            const buf = new Uint8Array(bytes);
            crypto.getRandomValues(buf);
            return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
        }

        // Same shape and strength as the intake page's codes (see
        // newRepairId in new-repair/intake.js): the code is all that guards
        // the customer's tracking page.
        function newRepairCode() {
            return 'REP_' + randomHex(8).toUpperCase();
        }

        // Mirrors deviceTypeFor in new-repair/intake.js.
        function deviceTypeFor(category, brand) {
            const b = String(brand || '').toLowerCase();
            const isApple = b.indexOf('apple') !== -1;
            switch (category) {
                case 'phone': return isApple ? 'iPhone' : (b.indexOf('samsung') !== -1 ? 'Samsung' : 'Android');
                case 'tablet': return isApple ? 'iPad' : 'Tablet';
                case 'laptop': return isApple ? 'MacBook' : 'Laptop';
                case 'desktop': return 'Desktop';
                case 'console': return 'Gaming Console';
                default: return 'Device';
            }
        }

        // Mirrors normalisePhone in new-repair/intake.js, so a customer booked
        // in here is recognised when they next come through the iPad.
        function normalisePhone(raw) {
            let digits = String(raw || '').replace(/[^\d+]/g, '');
            if (!digits) return '';
            if (digits.indexOf('+') === 0) return '+' + digits.slice(1).replace(/\D/g, '');
            digits = digits.replace(/\D/g, '');
            if (digits.indexOf('44') === 0 && digits.length >= 11) return '+' + digits;
            if (digits.indexOf('0') === 0) return '+44' + digits.slice(1);
            return '+' + digits;
        }

        /* Turns a booking into a job, shaped like one from the iPad intake
           (new-repair/intake.js) so every screen that reads jobs treats it
           the same. What differs: no signed drop-off agreement and no unlock
           code or condition notes, because none were taken; intakeChannel
           says where it came from; and the booking's photos stay where they
           are, private, rather than joining the job's photos, which the
           tracking page shows.

           The progress entry has no note on purpose: notes appear word for
           word on the customer's tracking page.

           The job and the booking's "booked" mark are written together, so
           a booking can never become two jobs. The tracking page copy is
           published by the dashboard's own sync as soon as the job appears. */
        async function bookInBooking(booking, form) {
            const now = firebase.firestore.Timestamp.now();
            const by = currentUser ? currentUser.email : 'unknown';
            const repairRef = db.collection('repairs').doc();
            const bookingRef = db.collection('bookings').doc(booking.id);
            const repair = {
                repairId: newRepairCode(),
                customerName: form.customerName,
                firstName: form.firstName,
                lastName: form.lastName,
                customerEmail: form.email,
                customerPhone: form.phone,
                device: [form.brand, form.model].filter(Boolean).join(' ') || BOOKING_CATEGORIES[form.category],
                brand: form.brand,
                model: form.model,
                deviceType: deviceTypeFor(form.category, form.brand),
                issueDescription: form.issue,
                estimatedCost: form.estimatedCost,
                currentStatus: 'received',
                dateReceived: now,
                photos: [],
                createdBy: by,
                createdAt: now,
                progress: [{ status: 'received', timestamp: now, notes: '', technician: by }],
                intakeChannel: 'online-booking',
                deviceCategory: form.category,
                bookingId: booking.id,
                bookingPhotoPaths: Array.isArray(booking.photoPaths) ? booking.photoPaths : [],
                customerId: ''
            };

            await db.runTransaction(async (tx) => {
                const fresh = await tx.get(bookingRef);
                const data = fresh.exists ? fresh.data() : null;
                if (!data || data.deleted === true || data.status === 'removed') throw new Error('this booking has been removed.');
                if (data.status === 'booked' || data.linkedRepairId) throw new Error('this booking is already booked in.');
                repair.bookingPhotoPaths = Array.isArray(data.photoPaths) ? data.photoPaths : [];
                tx.set(repairRef, repair);
                tx.update(bookingRef, {
                    ...bookingEdits(form),
                    status: 'booked',
                    linkedRepairId: repairRef.id,
                    repairCode: repair.repairId,
                    bookedInAt: now,
                    bookedInBy: by
                });
            });

            // Customer directory, as the intake page keeps it. Non-fatal: the
            // job is already safe.
            let customerSaved = false;
            try {
                const customerId = await upsertBookedCustomer(form, repair.repairId);
                if (customerId) await repairRef.update({ customerId });
                customerSaved = true;
            } catch (error) {
                console.warn('Customer record not updated:', error);
            }

            return { id: repairRef.id, ...repair, customerSaved };
        }

        /* Links the job to the customer's record, or starts one. A booking's
           details were typed by whoever filled in the form, not checked
           face to face as the iPad intake's are, so an existing record is
           never overwritten from them: the new job is added to it, and only
           boxes the record has empty are filled in. Otherwise anyone who
           knew a customer's email address could change that customer's
           name and number by booking with it.

           Matched by email when there is one, else by mobile number. */
        async function upsertBookedCustomer(form, repairCode) {
            const now = firebase.firestore.Timestamp.now();
            const details = {
                firstName: form.firstName,
                lastName: form.lastName,
                fullName: form.customerName,
                email: form.email,
                emailLower: form.email.toLowerCase(),
                phone: form.phone,
                phoneE164: normalisePhone(form.phone)
            };
            const link = {
                updatedAt: now,
                lastRepairId: repairCode,
                repairIds: firebase.firestore.FieldValue.arrayUnion(repairCode),
                repairCount: firebase.firestore.FieldValue.increment(1)
            };

            const customers = db.collection('customers');
            const match = details.emailLower
                ? await customers.where('emailLower', '==', details.emailLower).limit(1).get()
                : details.phoneE164
                    ? await customers.where('phoneE164', '==', details.phoneE164).limit(1).get()
                    : null;

            if (match && !match.empty) {
                const existing = match.docs[0].data();
                const fill = {};
                Object.keys(details).forEach(key => {
                    if (details[key] && !existing[key]) fill[key] = details[key];
                });
                await customers.doc(match.docs[0].id).update({ ...fill, ...link });
                return match.docs[0].id;
            }
            const id = 'CUS_' + randomHex(12).toUpperCase();
            await customers.doc(id).set({ ...details, ...link, marketingOptIn: false, createdAt: now });
            return id;
        }

        // === CUSTOMER TRACKING PAGES ===
        // The customer's tracking page never reads a ticket. It reads the
        // job's copy at tracking/{code}, which holds only what that page
        // shows (new-repair/tracking-copy.js has the list and the reasons).
        // This keeps every copy in step with its ticket: whenever a ticket or
        // a copy changes, any copy that no longer matches its ticket is written
        // again. So every route that changes a ticket - Update Repair, the
        // board, bulk changes, deleting a status entry, an edit made in the
        // Firebase console - reaches the customer without each one having to
        // remember to publish, and a job booked in while no dashboard was open
        // gets its copy as soon as one is.
        //
        // It never deletes a copy. A copy with no ticket to match is left
        // alone, because a dashboard that had loaded only some tickets would
        // otherwise take down live tracking links. deleteRepair removes the
        // copy of the job it deletes.
        let unsubscribeTracking = null;
        let trackingCopies = null;     // code -> copy, as last read
        let trackingRetryTimer = null;
        let trackingSyncBusy = false;
        let trackingSyncAgain = false;
        let trackingSyncRuns = 0;
        let trackingRulesNoticeShown = false;
        let trackingWriteNoticeShown = false;
        // code -> fingerprint of the copy this page last sent. A write the
        // server refuses is rolled back locally, which fires the listener
        // again; without this the same refused write would go straight back out.
        const trackingSent = new Map();

        function startTrackingSync() {
            clearTimeout(trackingRetryTimer);
            if (unsubscribeTracking) unsubscribeTracking();
            trackingCopies = null;
            unsubscribeTracking = db.collection(OnlineFixTracking.COLLECTION).onSnapshot((snapshot) => {
                trackingCopies = new Map(snapshot.docs.map(doc => [doc.id, doc.data()]));
                syncTrackingCopies();
            }, (error) => {
                unsubscribeTracking = null;
                trackingCopies = null;
                if (!auth.currentUser) return;   // signed out, nothing to report
                console.warn('Tracking copies unavailable:', error);
                if (!trackingRulesNoticeShown) {
                    trackingRulesNoticeShown = true;
                    showAlert(error.code === 'permission-denied'
                        ? 'Customer tracking pages are waiting for the new database rules to be published.'
                        : 'Could not load customer tracking pages: ' + error.message, 'info');
                }
                // The rules could be published at any moment, so look again.
                trackingRetryTimer = setTimeout(startTrackingSync, 60000);
            });
        }

        function stopTrackingSync() {
            clearTimeout(trackingRetryTimer);
            if (unsubscribeTracking) unsubscribeTracking();
            unsubscribeTracking = null;
            trackingCopies = null;
        }

        // One copy per code, wherever the copy on file differs from what the
        // ticket says now.
        function trackingWritesNeeded() {
            // Should two tickets ever share a code, publish the one the old
            // lookup showed: the lowest document id.
            const byCode = new Map();
            allRepairs.forEach(repair => {
                if (!OnlineFixTracking.isCode(repair.repairId)) return;
                const seen = byCode.get(repair.repairId);
                if (!seen || repair.id < seen.id) byCode.set(repair.repairId, repair);
            });

            const writes = [];
            byCode.forEach((repair, code) => {
                const view = OnlineFixTracking.publicView(repair);
                const print = OnlineFixTracking.fingerprint(view);
                const onFile = trackingCopies.get(code);
                if (onFile && OnlineFixTracking.fingerprint(onFile) === print) return;
                if (trackingSent.get(code) === print) return;
                writes.push({ code, view, print });
            });
            return writes;
        }

        async function syncTrackingCopies() {
            if (!repairsLoaded || !trackingCopies) return;
            if (trackingSyncBusy) { trackingSyncAgain = true; return; }
            trackingSyncBusy = true;
            const firstRun = trackingSyncRuns++ === 0;
            try {
                const writes = trackingWritesNeeded();
                if (writes.length === 0) return;

                writes.forEach(w => trackingSent.set(w.code, w.print));
                const results = await Promise.allSettled(writes.map(w =>
                    db.collection(OnlineFixTracking.COLLECTION).doc(w.code).set(w.view)));

                const failed = writes.filter((w, i) => results[i].status === 'rejected');
                const written = writes.length - failed.length;
                if (firstRun && written > 0) {
                    showAlert(`Tracking pages updated for ${written} job${written === 1 ? '' : 's'}`, 'success');
                }
                if (failed.length > 0) {
                    console.error('Tracking copies not written:', failed.map(w => w.code),
                        results.find(r => r.status === 'rejected').reason);
                    if (!trackingWriteNoticeShown) {
                        trackingWriteNoticeShown = true;
                        showAlert(`Could not update ${failed.length} customer tracking page${failed.length === 1 ? '' : 's'}. Trying again in a minute.`, 'error');
                    }
                    setTimeout(() => {
                        failed.forEach(w => {
                            if (trackingSent.get(w.code) === w.print) trackingSent.delete(w.code);
                        });
                        syncTrackingCopies();
                    }, 60000);
                }
            } finally {
                trackingSyncBusy = false;
                if (trackingSyncAgain) {
                    trackingSyncAgain = false;
                    syncTrackingCopies();
                }
            }
        }

        // === UNLOCK CODES ===
        // A device's unlock code is only needed while the repair is being
        // tested, so it comes off the ticket once the job is Completed,
        // whichever way it got there: Update Repair, the board, a bulk
        // change, the Firebase console, or a job completed before this
        // existed. Watching the job list covers every route at once, the
        // same way the tracking pages are kept in step. It cannot be undone;
        // if a device comes back, ask the customer for the code again.
        const unlockClearAsked = new Set();   // ticket ids this page has cleared
        let unlockClearNoticeShown = false;

        function hasUnlockCode(repair) {
            return repair.unlockCode !== undefined && repair.unlockCode !== null
                && String(repair.unlockCode).trim() !== '';
        }

        async function clearFinishedUnlockCodes() {
            if (!repairsLoaded) return;
            const due = allRepairs.filter(r =>
                r.currentStatus === 'completed' && hasUnlockCode(r) && !unlockClearAsked.has(r.id));
            if (due.length === 0) return;

            due.forEach(r => unlockClearAsked.add(r.id));
            const results = await Promise.allSettled(due.map(r =>
                db.collection('repairs').doc(r.id).update({
                    unlockCode: firebase.firestore.FieldValue.delete()
                })));

            const failed = due.filter((r, i) => results[i].status === 'rejected');
            const cleared = due.length - failed.length;
            if (cleared > 0) {
                showAlert(`Passcode cleared from ${cleared} completed job${cleared === 1 ? '' : 's'}`, 'success');
            }
            if (failed.length > 0) {
                console.error('Passcodes not cleared:', failed.map(r => r.repairId),
                    results.find(r => r.status === 'rejected').reason);
                if (!unlockClearNoticeShown) {
                    unlockClearNoticeShown = true;
                    showAlert(`Could not clear the passcode from ${failed.length} completed job${failed.length === 1 ? '' : 's'}. Trying again in a minute.`, 'error');
                }
                setTimeout(() => {
                    failed.forEach(r => unlockClearAsked.delete(r.id));
                    clearFinishedUnlockCodes();
                }, 60000);
            }
        }

        // Utility: calculate time ago
        function timeAgo(seconds) {
            if (!seconds) return '';
            const now = Date.now();
            const diff = now - (seconds * 1000);
            const days = Math.floor(diff / (1000 * 60 * 60 * 24));
            if (days === 0) return 'Today';
            if (days === 1) return '1 day ago';
            if (days < 7) return `${days} days ago`;
            if (days < 14) return '1 week ago';
            if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
            if (days < 60) return '1 month ago';
            return `${Math.floor(days / 30)} months ago`;
        }

        // When the repair entered the status it is sitting in now. Read off the
        // progress log rather than dateReceived, which is the whole point: a job
        // booked in three weeks ago but moved to Testing yesterday is fine, and
        // one booked in last week that never left Diagnosing is not. Entries are
        // not guaranteed to be in order, so take the latest match.
        function statusSinceSeconds(repair) {
            let latest = 0;
            (repair.progress || []).forEach(p => {
                if (p && p.status === repair.currentStatus && p.timestamp && p.timestamp.seconds > latest) {
                    latest = p.timestamp.seconds;
                }
            });
            return latest || repair.dateReceived?.seconds || 0;
        }

        function daysInStatus(repair) {
            const since = statusSinceSeconds(repair);
            if (!since) return null;
            return Math.floor((Date.now() - since * 1000) / 86400000);
        }

        function getAgeClass(seconds) {
            if (!seconds) return '';
            const days = Math.floor((Date.now() - seconds * 1000) / (1000 * 60 * 60 * 24));
            if (days >= 14) return 'age-danger';
            if (days >= 7) return 'age-warning';
            return '';
        }

        // Overdue counter. The totals this used to publish (repairs, active,
        // ready, customers) went with the stats row: a running count of every
        // customer the shop has ever had is not something anyone acts on
        // mid-shift, whereas an overdue count is.
        function updateStats() {
            const overdueRepairs = allRepairs.filter(r =>
                r.estimatedCompletion &&
                !['completed', 'ready'].includes(r.currentStatus) &&
                new Date(r.estimatedCompletion.seconds * 1000) < new Date()
            ).length;

            // Update overdue badges
            const navBadge = document.getElementById('nav-overdue-badge');
            const headerBadge = document.getElementById('header-overdue-badge');
            const headerCount = document.getElementById('header-overdue-count');

            if (overdueRepairs > 0) {
                navBadge.textContent = overdueRepairs;
                navBadge.classList.remove('hidden');
                headerCount.textContent = overdueRepairs;
                headerBadge.classList.remove('hidden');
            } else {
                navBadge.classList.add('hidden');
                headerBadge.classList.add('hidden');
            }
        }


        // Status progression order
        const statusOrder = ['received', 'diagnosing', 'waiting-decision', 'waiting-parts', 'in-repair', 'testing', 'ready', 'completed'];

        function getNextStatus(currentStatus) {
            const idx = statusOrder.indexOf(currentStatus);
            if (idx === -1 || idx >= statusOrder.length - 1) return null;
            return statusOrder[idx + 1];
        }

        // Quick status advance
        async function quickAdvanceStatus(repairId, e) {
            e.stopPropagation();
            const repair = allRepairs.find(r => r.id === repairId);
            if (!repair) return;

            const nextStatus = getNextStatus(repair.currentStatus);
            if (!nextStatus) {
                showAlert('This repair is already completed.', 'info');
                return;
            }

            const nextLabel = statusConfig[nextStatus]?.label || nextStatus;
            if (!confirm(`Advance status to "${nextLabel}"?`)) return;

            try {
                const progressEntry = {
                    status: nextStatus,
                    timestamp: firebase.firestore.Timestamp.now(),
                    // Left empty on purpose: the customer's tracking page
                    // shows the new stage and the time, and adding "Status
                    // advanced to Testing" only spoke to them in shop words.
                    // Use Update Repair when there is something to tell them.
                    notes: '',
                    technician: currentUser.email,
                    photos: []
                };

                await db.collection('repairs').doc(repairId).update({
                    currentStatus: nextStatus,
                    progress: firebase.firestore.FieldValue.arrayUnion(progressEntry)
                });

                showAlert(`Status advanced to "${nextLabel}"`, 'success');
            } catch (error) {
                console.error('Error advancing status:', error);
                showAlert('Error updating status: ' + error.message, 'error');
            }
        }

        // Create repair table row

        // View repair details
        function viewRepair(repairId) {
            const repair = allRepairs.find(r => r.id === repairId);
            if (!repair) return;

            const modal = document.createElement('div');
            modal.className = 'modal show';
            modal.innerHTML = `
                <div class="modal-content modal-content--job" style="max-width: 800px;">
                    <div class="modal-header">
                        <h2 class="modal-title">Repair Details - ${escapeHTML(repair.repairId)}</h2>
                        <button class="close-btn" data-do-click="closeModal">&times;</button>
                    </div>
                    <div class="job-body">
                        <div class="form-grid" style="margin-bottom: 2rem;">
                            <div style="background: var(--bg-surface); border: 1px solid var(--border-color); padding: 1.5rem; border-radius: var(--radius-lg);">
                                <h3 style="color: var(--text-main); margin-bottom: 1rem;">Customer</h3>
                                <p><strong>Name:</strong> <span style="color: var(--text-muted);">${escapeHTML(repair.customerName)}</span></p>
                                ${repair.customerAddress ? `<p><strong>Address:</strong> <span style="color: var(--text-muted);">${escapeHTML(repair.customerAddress)}</span></p>` : ''}
                                <!-- Tap to ring or mail. This screen gets opened
                                     mid-shift to chase someone, so the contact
                                     details are actions rather than text to
                                     copy out by hand. -->
                                <div class="contact-actions">
                                    ${repair.customerPhone ? `
                                        <a class="btn btn-secondary" href="tel:${escapeHTML(String(repair.customerPhone).replace(/[^+\d]/g, ''))}">
                                            <i class="fas fa-phone"></i> ${escapeHTML(repair.customerPhone)}
                                        </a>` : ''}
                                    ${repair.customerEmail ? `
                                        <!-- The address is URL-encoded (mailtoAddress): raw,
                                             "a@b.com?subject=...&body=..." filled in the
                                             email's subject and text. -->
                                        <a class="btn btn-secondary" href="mailto:${escapeHTML(mailtoAddress(repair.customerEmail))}">
                                            <i class="fas fa-envelope"></i> ${escapeHTML(repair.customerEmail)}
                                        </a>` : ''}
                                </div>
                            </div>
                            <div style="background: var(--bg-surface); border: 1px solid var(--border-color); padding: 1.5rem; border-radius: var(--radius-lg);">
                                <h3 style="color: var(--text-main); margin-bottom: 1rem;">Device Information</h3>
                                <p><strong>Type:</strong> <span style="color: var(--text-muted);">${escapeHTML(repair.deviceType)}</span></p>
                                <p><strong>Brand:</strong> <span style="color: var(--text-muted);">${escapeHTML(repair.brand)}</span></p>
                                <p><strong>Model:</strong> ${escapeHTML(repair.model)}</p>
                                ${repair.serialNumber ? `<p><strong>Serial:</strong> ${escapeHTML(repair.serialNumber)}</p>` : ''}
                                <p><strong>Condition:</strong> ${escapeHTML(repair.deviceCondition) || 'Not specified'}</p>
                            </div>
                        </div>
                        <div style="background: var(--bg-surface); border: 1px solid var(--border-color); padding: 1.5rem; border-radius: var(--radius-lg); margin-bottom: 2rem;">
                            <h3 style="color: var(--text-main); margin-bottom: 1rem;">Repair Details</h3>
                            <p><strong>Issue:</strong> <span style="color: var(--text-muted);">${escapeHTML(repair.issueDescription)}</span></p>
                            <p><strong>Current Status:</strong> <span class="status-badge ${statusConfig[repair.currentStatus]?.class || 'status-received'}">${escapeHTML(statusConfig[repair.currentStatus]?.label || 'Received')}</span>${(() => {
                                const d = daysInStatus(repair);
                                if (d === null) return '';
                                return ` <span class="status-dwell ${d >= 7 ? 'is-stale' : d >= 3 ? 'is-warn' : ''}">${d} day${d === 1 ? '' : 's'} in this status</span>`;
                            })()}</p>
                            <p><strong>Date Received:</strong> <span style="color: var(--text-muted);">${repair.dateReceived ? new Date(repair.dateReceived.seconds * 1000).toLocaleString('en-GB') : 'N/A'}</span></p>
                            ${repair.estimatedCompletion ? `<p><strong>Est. Completion:</strong> <span style="color: var(--text-muted);">${new Date(repair.estimatedCompletion.seconds * 1000).toLocaleDateString('en-GB')}</span></p>` : ''}
                            ${repair.estimatedCost ? `<p><strong>Est. Cost:</strong> <span style="color: var(--text-muted);">£${escapeHTML(repair.estimatedCost)}</span></p>` : ''}
                            ${repair.additionalNotes ? `<p><strong>Notes:</strong> <span style="color: var(--text-muted);">${escapeHTML(repair.additionalNotes)}</span></p>` : ''}
                            ${Array.isArray(repair.bookingPhotoPaths) && repair.bookingPhotoPaths.length ? `
                                <!-- Photos the customer sent with an online
                                     booking. They stay private: the job's own
                                     photos are shown on the tracking page, so
                                     these are opened from here instead. -->
                                <p><strong>Booking photos:</strong> <span style="color: var(--text-muted);">sent by the customer, staff only</span></p>
                                ${bookingPhotoTiles(repair.bookingPhotoPaths)}` : ''}
                        </div>
                        ${repair.progress && repair.progress.length > 0 ? `
                            <div style="background: var(--bg-surface); border: 1px solid var(--border-color); padding: 1.5rem; border-radius: var(--radius-lg); margin-bottom: 2rem;">
                                <h3 style="color: var(--text-main); margin-bottom: 1rem;">Progress History</h3>
                                ${repair.progress.map((p, i) => `
                                    <div style="padding: 1rem; background: var(--bg-base); border: 1px solid var(--border-color); border-radius: var(--radius-md); margin-bottom: 1rem;">
                                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; gap: 0.5rem;">
                                            <strong style="color: var(--text-main);">${escapeHTML(statusConfig[p.status]?.label || p.status)}</strong>
                                            <div style="display: flex; align-items: center; gap: 0.75rem;">
                                                <small style="color: var(--text-muted);">${p.timestamp ? new Date(p.timestamp.seconds * 1000).toLocaleString('en-GB') : 'N/A'}</small>
                                                <button class="btn btn-secondary progress-remove" data-do-click="removeProgressEntry" data-id="${escapeHTML(repairId)}" data-index="${i}" title="Remove this status entry">
                                                    <i class="fas fa-trash"></i>
                                                </button>
                                            </div>
                                        </div>
                                        ${p.notes ? `<p style="color: var(--text-muted); margin: 0;">${escapeHTML(p.notes)}</p>` : ''}
                                        ${p.technician ? `<p style="color: var(--text-dark); font-size: 0.9rem; margin: 0.5rem 0 0 0;">By: ${escapeHTML(p.technician)}</p>` : ''}
                                        ${p.photos && p.photos.length > 0 ? `
                                            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 0.5rem; margin-top: 0.5rem;">
                                                ${p.photos.map(photo => `
                                                    <img src="${escapeHTML(photo)}" alt="Progress photo" style="width: 100%; height: 80px; object-fit: cover; border-radius: 8px; cursor: pointer; border: 1px solid var(--border-color);" data-do-click="openPhoto" data-url="${escapeHTML(photo)}">
                                                `).join('')}
                                            </div>
                                        ` : ''}
                                    </div>
                                `).join('')}
                            </div>
                        ` : ''}
                    </div>
                    <!-- The board opens this screen, so everything a job needs
                         has to be reachable from it. It used to offer Edit and
                         Close, and anything else meant finding the row again in
                         All Repairs. -->
                    <div class="job-actions">
                        <button class="btn btn-primary" data-do-click="editRepairAndClose" data-id="${escapeHTML(repairId)}">
                            <i class="fas fa-edit"></i> Update status
                        </button>
                        <button class="btn btn-secondary" data-do-click="editCustomerAndClose" data-id="${escapeHTML(repairId)}">
                            <i class="fas fa-user-pen"></i> Customer details
                        </button>
                        <button class="btn btn-copy" data-do-click="openTrackingLink" data-repair-id="${escapeHTML(repair.repairId)}">
                            <i class="fas fa-external-link-alt"></i> Tracking page
                        </button>
                        <button class="btn btn-secondary" data-do-click="reprintLabel" data-id="${escapeHTML(repairId)}">
                            <i class="fas fa-tag"></i> Print label
                        </button>
                        <button class="btn btn-secondary" data-do-click="generateInvoice" data-id="${escapeHTML(repairId)}">
                            <i class="fas fa-file-invoice"></i> Invoice
                        </button>
                        <span class="job-actions__spacer"></span>
                        <button class="btn btn-secondary" data-do-click="closeModal">Close</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            fillBookingThumbs(modal);
        }

        // Remove a single entry from a repair's progress history.
        // Index-based so the snapshotted Timestamp doesn't have to round-trip
        // through arrayRemove, which compares by deep-equality.
        //
        // Removing the entry is only half of it. The customer's tracking page
        // headlines currentStatus and uses the history only for the detail
        // underneath (track/index.html, buildTimeline), so deleting the entry
        // that put the repair in its current stage used to leave that stage on
        // their page with "In Progress" where the note had been - the stage
        // stayed, only the wording changed. So the repair moves back with it,
        // to whatever the newest remaining entry says, or to received once the
        // history is empty.
        async function removeProgressEntry(repairId, index) {
            const repair = allRepairs.find(r => r.id === repairId);
            if (!repair || !Array.isArray(repair.progress) || !repair.progress[index]) return;

            const entry = repair.progress[index];
            const label = statusConfig[entry.status]?.label || entry.status;

            const newProgress = repair.progress.slice();
            newProgress.splice(index, 1);

            const update = { progress: newProgress };
            let movedBackLabel = '';
            // Only when this entry is the one holding the repair's current
            // stage: removing an older entry corrects the history and should
            // leave the repair where it is.
            if (entry.status === repair.currentStatus) {
                // Newest by timestamp rather than last in the array - entries
                // arrive through arrayUnion and are not guaranteed to be in
                // order. >= keeps the later of two entries sharing a second.
                const newest = newProgress.reduce((latest, p) => (
                    !latest || (p.timestamp?.seconds || 0) >= (latest.timestamp?.seconds || 0) ? p : latest
                ), null);
                update.currentStatus = newest ? newest.status : 'received';
                // A repair can hold the same status twice, so removing one of
                // them leaves it where it was. Only say it moved when it did.
                if (update.currentStatus !== repair.currentStatus) {
                    movedBackLabel = statusConfig[update.currentStatus]?.label || update.currentStatus;
                }
            }

            const question = movedBackLabel
                ? `Remove the "${label}" entry?\n\nThe customer stops seeing it on their tracking page, and this repair moves back to "${movedBackLabel}".`
                : `Remove the "${label}" entry from this repair's history? The customer stops seeing it on their tracking page.`;
            if (!confirm(question)) return;

            try {
                await db.collection('repairs').doc(repairId).update(update);
                showAlert(movedBackLabel
                    ? `Entry removed, repair moved back to "${movedBackLabel}"`
                    : 'Status entry removed', 'success');

                // Re-open the view modal so it shows the updated history.
                const modal = document.querySelector('.modal.show');
                if (modal) modal.remove();
                viewRepair(repairId);
            } catch (error) {
                showAlert('Error removing entry: ' + error.message, 'error');
            }
        }

        // ------------------------------------------------------------------
        // Correcting customer details after intake.
        //
        // The intake form is filled in at the counter, often by the customer
        // on the iPad, so a mistyped email is common and used to be
        // uncorrectable — the update modal showed the name and device as
        // read-only text. A wrong address means the confirmation and its
        // tracking link never arrive, so this also offers to send that email
        // again once the address is fixed.
        // ------------------------------------------------------------------

        // Shop details for outgoing mail. The intake page holds its own copy;
        // these two files are the only places they appear.
        const SHOP_EMAIL = 'hello@onlinefix.uk';
        const SHOP_PHONE = '07940 730537';
        const SHOP_ADDRESS = '13 Quarry Street, Guildford GU1 3UY';
        // The booking confirmation email spells the address as the booking
        // page and the booking terms do, and links to those terms on the
        // live site (not this page's address).
        const BOOKING_SHOP_ADDRESS = '13 Quarry Street, Guildford, Surrey, GU1 3UY';
        const SITE_URL = 'https://onlinefix.co.uk';

        /* One plain address, the shape the booking function
           (server/submit-booking/) holds a booking's address to. The old
           check only barred spaces and a second @, so it passed a display
           name ('"Pay_at_evil.example"<someone@x.com>'), which Confirm
           booking then put in the customer email's To line as the name it
           is addressed to. */
        /* An address for a mailto: link. Encoded, so a "?" or "&" in it
           cannot start the subject or text, but with the @ left as it is,
           which every mail app reads. */
        function mailtoAddress(email) {
            return encodeURIComponent(String(email || '')).replace(/%40/g, '@');
        }

        function isValidEmail(raw) {
            const v = String(raw || '').trim();
            return v.length > 3 && v.length < 200 && /^[^\s@,;:<>()"\[\]\\]+@[^\s@,;:<>()"\[\]\\]+\.[^\s@,;:<>()"\[\]\\]{2,}$/.test(v);
        }

        /* Customer emails repeat the name and device from the job or the
           booking, and a booking's were typed by whoever filled in the
           public form, with whatever address they liked: Confirm booking
           then sends them, from the shop's own Gmail, to that address. So
           the words taken from a booking must not be able to carry a
           message of their own ("Pay the £20 deposit at evil-pay.example").

           looksLikeLink: a web address ("https:", "www.", "//"), an email
           address, or a domain in any alphabet ("evil-pay.example",
           "bit.ly/x", "payé.com", "оплата.рф"). Much the same test as
           looksLikeLink in server/submit-booking/index.js, which has no need
           to look for email addresses.

           greetingName: the first of the names given that reads as a name,
           for "Hi <name>,": letters (any alphabet), spaces, apostrophes,
           dots and hyphens, 40 characters at most, and no link. '' if none
           does, and the email then says "Hi there,", as it always has when
           there is no name. No new wording: an odd name or device just
           gets the words used when there is none. */
        function looksLikeLink(s) {
            return /(https?:|www\.|\/\/|@|[\p{L}\p{N}-]\.\p{L}{2,})/iu.test(String(s || ''));
        }

        function greetingName(...names) {
            for (const n of names) {
                const v = String(n || '').trim();
                if (v && v.length <= 40 && /^[\p{L}\p{M}' ’.-]+$/u.test(v) && !looksLikeLink(v)) return v;
            }
            return '';
        }

        function editCustomer(repairId) {
            const repair = allRepairs.find(r => r.id === repairId);
            if (!repair) return;

            // Older tickets predate firstName/lastName, so fall back to
            // splitting the display name rather than showing empty fields.
            const parts = String(repair.customerName || '').trim().split(/\s+/);
            const first = repair.firstName || parts[0] || '';
            const last = repair.lastName || parts.slice(1).join(' ') || '';

            const modal = document.createElement('div');
            modal.className = 'modal show';
            modal.innerHTML = `
                <div class="modal-content" style="max-width: 560px;">
                    <div class="modal-header">
                        <h2 class="modal-title">Customer details - ${escapeHTML(repair.repairId)}</h2>
                        <button class="close-btn" data-do-click="closeModal">&times;</button>
                    </div>
                    <!-- novalidate: the checks below are richer than the
                         browser's (either an email or a phone will do) and the
                         inline message stays on screen, where a native bubble
                         on a tablet is easy to miss. -->
                    <form id="edit-customer-form" data-repair-id="${escapeHTML(repairId)}" novalidate>
                        <div class="form-grid">
                            <div class="form-group">
                                <label class="form-label" for="ec-first">First name</label>
                                <input type="text" class="form-input" id="ec-first" name="firstName" maxlength="60"
                                    autocomplete="off" autocapitalize="words" value="${escapeHTML(first)}" required>
                            </div>
                            <div class="form-group">
                                <label class="form-label" for="ec-last">Last name</label>
                                <input type="text" class="form-input" id="ec-last" name="lastName" maxlength="60"
                                    autocomplete="off" autocapitalize="words" value="${escapeHTML(last)}">
                            </div>
                        </div>
                        <div class="form-group">
                            <label class="form-label" for="ec-email">Email</label>
                            <input type="email" class="form-input" id="ec-email" name="customerEmail" maxlength="200"
                                inputmode="email" autocapitalize="off" spellcheck="false"
                                value="${escapeHTML(repair.customerEmail || '')}" placeholder="jane@example.com">
                            <small style="color: var(--text-muted);">Where the confirmation and tracking link go.</small>
                        </div>
                        <div class="form-group">
                            <label class="form-label" for="ec-phone">Mobile number</label>
                            <input type="tel" class="form-input" id="ec-phone" name="customerPhone" maxlength="24"
                                inputmode="tel" value="${escapeHTML(repair.customerPhone || '')}" placeholder="07700 900123">
                        </div>
                        <div class="alert alert-error hidden" id="ec-error" style="margin-bottom: 1rem;"></div>
                        <div class="modal-actions">
                            <button type="button" class="btn btn-email" data-do-click="resendTrackingEmail" data-id="${escapeHTML(repairId)}"
                                title="Email the tracking link to the address above">
                                <i class="fas fa-paper-plane"></i>
                                <span>Send tracking email</span>
                            </button>
                            <span class="modal-actions__spacer"></span>
                            <button type="button" class="btn btn-secondary" data-do-click="closeModal">Cancel</button>
                            <button type="submit" class="btn btn-primary">
                                <i class="fas fa-save"></i>
                                Save changes
                            </button>
                        </div>
                    </form>
                </div>
            `;

            document.body.appendChild(modal);

            document.getElementById('edit-customer-form').addEventListener('submit', async (e) => {
                e.preventDefault();
                const err = document.getElementById('ec-error');
                const firstName = document.getElementById('ec-first').value.trim();
                const lastName = document.getElementById('ec-last').value.trim();
                const email = document.getElementById('ec-email').value.trim();
                const phone = document.getElementById('ec-phone').value.trim();

                const fail = (msg) => {
                    err.textContent = msg;
                    err.classList.remove('hidden');
                };

                if (!firstName) return fail('A first name is needed.');
                if (email && !isValidEmail(email)) return fail('That email address does not look right.');
                if (!email && !phone) return fail('Give at least an email address or a mobile number.');
                err.classList.add('hidden');

                const customerName = (firstName + ' ' + lastName).trim();
                try {
                    await db.collection('repairs').doc(repairId).update({
                        firstName: firstName,
                        lastName: lastName,
                        customerName: customerName,
                        customerEmail: email,
                        customerPhone: phone,
                        customerUpdatedAt: firebase.firestore.Timestamp.now(),
                        customerUpdatedBy: currentUser ? currentUser.email : 'unknown'
                    });

                    // Keep the customer directory in step where the ticket is
                    // linked to one. Non-fatal: the ticket itself is corrected
                    // either way, and that is what the tracking page reads.
                    if (repair.customerId) {
                        try {
                            await db.collection('customers').doc(repair.customerId).update({
                                firstName: firstName,
                                lastName: lastName,
                                email: email,
                                emailLower: email.toLowerCase(),
                                phone: phone
                            });
                        } catch (err2) {
                            console.warn('Customer directory not updated:', err2);
                        }
                    }

                    modal.remove();
                    showAlert('Customer details updated. Send the tracking email if the address changed.', 'success');
                } catch (error) {
                    fail('Could not save: ' + error.message);
                }
            });
        }

        // Queue the confirmation email again, to whatever address is currently
        // on the ticket. Reads the live field rather than the form so it can
        // never send to an address that was typed but not saved.
        async function resendTrackingEmail(repairId, btn) {
            const repair = allRepairs.find(r => r.id === repairId);
            if (!repair) return;

            const email = (repair.customerEmail || '').trim();
            if (!isValidEmail(email)) {
                showAlert('Save a valid email address first, then send.', 'error');
                return;
            }
            if (!confirm(`Send the tracking link to ${email}?`)) return;

            const original = btn ? btn.innerHTML : '';
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>Sending…</span>';
            }

            try {
                await queueTrackingEmail(repair, email);
                showAlert('Tracking email queued to ' + email, 'success');
            } catch (error) {
                showAlert('Could not queue the email: ' + error.message, 'error');
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = original;
                }
            }
        }

        /* The HTML part of an email, drawn by the shared email layout
           (new-repair/email-layout.js) in the site's look. If that script
           did not load (a warning shows at sign-in), or drawing fails, this
           gives null and the email goes as plain text: its text part has
           the same words and link, and a plain email beats none. */
        function emailHtml(draw) {
            if (!window.OnlineFixEmail) return null;
            try {
                return draw(window.OnlineFixEmail);
            } catch (error) {
                console.error('Email layout failed; sending plain text only', error);
                return null;
            }
        }

        // The tracking-link email itself. Shared by the Send tracking email
        // button and by booking in an online booking, so both send the same
        // wording.
        function queueTrackingEmail(repair, email) {
            const trackUrl = `${window.location.origin}/track/?id=${encodeURIComponent(repair.repairId)}`;
            // A job booked in from an online booking carries the words typed
            // on the public form: see greetingName and looksLikeLink.
            const typed = [repair.brand, repair.model].filter(Boolean).join(' ');
            const device = (looksLikeLink(typed) ? '' : typed) || repair.deviceType || 'your device';
            const greeting = greetingName(repair.firstName, repair.customerName) || 'there';
            const subject = 'Your repair tracking link — ' + repair.repairId;

            const html = emailHtml(E => E.layout({
                subject,
                body: [
                    E.paragraph('Hi ' + greeting + ',', { gap: 12 }),
                    E.paragraph('Here is the tracking link for your repair with us.', { gap: 22 }),
                    E.details([
                        E.row('Repair reference', repair.repairId, { kind: 'ref' }),
                        E.row('Device', device, { kind: 'strong' })
                    ]),
                    E.button(trackUrl, 'Track your repair', { gap: 20 }),
                    E.note('Keep this email — the link above is how you check progress at any time.', { gap: 18 })
                ],
                footer: E.shopFooter({ name: 'OnlineFix™', address: SHOP_ADDRESS, phone: SHOP_PHONE, email: SHOP_EMAIL })
            }));

            const text = 'Hi ' + greeting + ',\n\n' +
                'Here is the tracking link for your repair with us.\n\n' +
                'Repair reference: ' + repair.repairId + '\n' +
                'Device: ' + device + '\n\n' +
                'Track your repair: ' + trackUrl + '\n\n' +
                'OnlineFix™ · ' + SHOP_ADDRESS + '\n' + SHOP_PHONE + ' · ' + SHOP_EMAIL + '\n';

            const message = { subject, text };
            if (html) message.html = html;

            return db.collection('mail').add({
                to: [email],
                replyTo: SHOP_EMAIL,
                message,
                meta: {
                    kind: 'tracking-link-resend',
                    repairId: repair.repairId,
                    sentBy: currentUser ? currentUser.email : 'unknown',
                    createdAt: firebase.firestore.Timestamp.now()
                }
            });
        }

        // Edit repair - show status update modal
        function editRepair(repairId) {
            const repair = allRepairs.find(r => r.id === repairId);
            if (!repair) return;

            // Reset update photos
            updatePhotos = [];

            const modal = document.createElement('div');
            modal.className = 'modal show';
            modal.innerHTML = `
                <div class="modal-content" style="max-width: 700px;">
                    <div class="modal-header">
                        <h2 class="modal-title">Update Repair - ${escapeHTML(repair.repairId)}</h2>
                        <button class="close-btn" data-do-click="closeModal">&times;</button>
                    </div>
                    <form id="update-repair-form" data-repair-id="${repairId}">
                        <div class="form-group" style="background: var(--bg-surface); border: 1px solid var(--border-color); padding: 1rem; border-radius: var(--radius-md); margin-bottom: 1.5rem;">
                            <label class="form-label">Customer: <span style="color: var(--text-main); font-weight: 400;">${escapeHTML(repair.customerName)}</span></label>
                            <label class="form-label" style="margin-bottom: 0;">Device: <span style="color: var(--text-main); font-weight: 400;">${escapeHTML(repair.brand)} ${escapeHTML(repair.model)}</span></label>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Update Status</label>
                            <select class="form-input" name="newStatus" id="status-select" data-do-change="showTemplates">
                                <option value="received" ${repair.currentStatus === 'received' ? 'selected' : ''}>Received</option>
                                <option value="diagnosing" ${repair.currentStatus === 'diagnosing' ? 'selected' : ''}>Diagnosing</option>
                                <option value="waiting-decision" ${repair.currentStatus === 'waiting-decision' ? 'selected' : ''}>Waiting for Customer Decision</option>
                                <option value="waiting-parts" ${repair.currentStatus === 'waiting-parts' ? 'selected' : ''}>Waiting for Parts</option>
                                <option value="in-repair" ${repair.currentStatus === 'in-repair' ? 'selected' : ''}>In Repair</option>
                                <option value="testing" ${repair.currentStatus === 'testing' ? 'selected' : ''}>Testing</option>
                                <option value="ready" ${repair.currentStatus === 'ready' ? 'selected' : ''}>Ready for Collection</option>
                                <option value="completed" ${repair.currentStatus === 'completed' ? 'selected' : ''}>Completed</option>
                            </select>
                        </div>
                        <div class="template-selector" id="template-selector" style="display: none;">
                            <label class="form-label">Quick Templates:</label>
                            <div id="template-buttons"></div>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Progress Notes</label>
                            <textarea class="form-input form-textarea" name="progressNotes" id="progress-notes" placeholder="Add notes about this status update..."></textarea>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Add Photos (Optional)</label>
                            <div class="photo-upload-small" data-do-click="pickUpdatePhotos">
                                <i class="fas fa-camera" style="font-size: 1.5rem; color: var(--gray-400); margin-bottom: 0.5rem; display: block;"></i>
                                <span style="color: var(--gray-600); font-size: 0.9rem;">Click to add photos</span>
                                <input type="file" id="update-photo-input" multiple accept="image/*" style="display: none;" data-do-change="handleUpdatePhotos">
                            </div>
                            <div class="photo-preview-small" id="update-photo-preview"></div>
                        </div>
                        <div class="form-grid">
                            <div class="form-group">
                                <label class="form-label">Estimated Completion Date</label>
                                <input type="date" class="form-input" name="estimatedCompletion"
                                    value="${repair.estimatedCompletion ? new Date(repair.estimatedCompletion.seconds * 1000).toISOString().split('T')[0] : ''}">
                            </div>
                            <div class="form-group">
                                <label class="form-label">Estimated Cost (£)</label>
                                <input type="number" class="form-input" name="estimatedCost" step="0.01"
                                    value="${repair.estimatedCost || ''}">
                            </div>
                        </div>
                        <div class="form-grid">
                            <div class="form-group">
                                <label class="form-label">Priority</label>
                                <select class="form-input" name="priority">
                                    <option value="normal" ${(repair.priority || 'normal') === 'normal' ? 'selected' : ''}>Normal</option>
                                    <option value="urgent" ${repair.priority === 'urgent' ? 'selected' : ''}>Urgent</option>
                                    <option value="low" ${repair.priority === 'low' ? 'selected' : ''}>Low</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label class="form-label">Warranty (days from completion)</label>
                                <input type="number" class="form-input" name="warrantyDays" min="0"
                                    value="${repair.warrantyDays || 30}" placeholder="30">
                            </div>
                        </div>
                        <div class="upload-progress" hidden>
                            <div class="upload-progress__label">
                                <span class="upload-progress__text" aria-live="polite"></span>
                                <span class="upload-progress__pct"></span>
                            </div>
                            <div class="upload-progress__track" role="progressbar" aria-label="Upload progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
                                <div class="upload-progress__fill"></div>
                            </div>
                        </div>
                        <div style="display: flex; gap: 0.75rem; flex-wrap: wrap; justify-content: space-between; margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid var(--border-color);">
                            <div style="display: flex; gap: 0.5rem;">
                                <button type="button" class="btn btn-whatsapp" data-do-click="sendWhatsApp" data-id="${escapeHTML(repair.id)}" title="Send WhatsApp update to customer">
                                    <i class="fab fa-whatsapp"></i> WhatsApp
                                </button>
                                <button type="button" class="btn btn-email" data-do-click="sendEmailUpdate" data-id="${escapeHTML(repair.id)}" title="Send email update to customer">
                                    <i class="fas fa-envelope"></i> Email
                                </button>
                            </div>
                            <div style="display: flex; gap: 0.5rem;">
                                <button type="button" class="btn btn-secondary" data-do-click="closeModal">Cancel</button>
                                <button type="submit" class="btn btn-primary">
                                    <i class="fas fa-save"></i>
                                    Update Repair
                                </button>
                            </div>
                        </div>
                    </form>
                </div>
            `;

            document.body.appendChild(modal);

            // Show templates for current status
            showTemplates(repair.currentStatus);

            // Handle form submission
            document.getElementById('update-repair-form').addEventListener('submit', async (e) => {
                e.preventDefault();
                const repairId = e.target.dataset.repairId;
                // Closes only once saved. On a failure the form stays up with
                // the notes and photos still in it, ready to try again.
                if (await updateRepairStatus(repairId, e.target)) modal.remove();
            });
        }

        // ------------------------------------------------------------------
        // Photos are shrunk in the browser before they upload.
        //
        // A photo off an iPad is 12 megapixels and several megabytes, and it
        // was stored like that: slow to send from the shop, and slow for the
        // customer, whose tracking page downloads every original just to
        // show a thumbnail. 2000px on the long side is still sharp enough to
        // show a scratch, at a few hundred KB.
        //
        // Best effort. If the browser cannot decode the file (HEIC on a
        // desktop browser, say) or the result is no smaller, the original
        // goes up exactly as it did before. The intake page carries its own
        // copy of this in new-repair/intake.js.
        // ------------------------------------------------------------------
        const PHOTO_MAX_EDGE = 2000;
        const PHOTO_JPEG_QUALITY = 0.85;

        // One at a time: a dozen 12-megapixel photos decoded at once is
        // more memory than an iPad tab will give a page.
        let photoShrinkQueue = Promise.resolve();

        // Always resolves, to the smaller file or the original.
        function shrinkPhoto(file) {
            const run = photoShrinkQueue.then(() => shrinkPhotoNow(file)).catch(() => file);
            photoShrinkQueue = run;
            return run;
        }

        async function shrinkPhotoNow(file) {
            const url = URL.createObjectURL(file);
            const canvas = document.createElement('canvas');
            try {
                const img = new Image();
                img.src = url;
                await img.decode();
                // naturalWidth/Height are after the photo's EXIF rotation, and
                // drawImage draws it rotated, so a portrait shot stays upright.
                const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
                // Already small and already a JPEG: a second compression
                // would only cost quality.
                if (scale === 1 && file.type === 'image/jpeg' && file.size <= 1024 * 1024) return file;

                canvas.width = Math.round(img.naturalWidth * scale);
                canvas.height = Math.round(img.naturalHeight * scale);
                const ctx = canvas.getContext('2d');
                // JPEG has no transparency, so a clear PNG would turn black.
                ctx.fillStyle = '#fff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', PHOTO_JPEG_QUALITY));
                if (!blob || blob.size >= file.size) return file;

                const name = (file.name || 'photo').replace(/\.[^.]*$/, '') + '.jpg';
                return new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified });
            } catch (error) {
                console.warn('Could not shrink photo; uploading the original', error);
                return file;
            } finally {
                URL.revokeObjectURL(url);
                // iPad browsers hold a canvas's memory until it is sized to
                // nothing, whatever the garbage collector thinks.
                canvas.width = 0;
                canvas.height = 0;
            }
        }

        // Storage only accepts image/* (storage.rules), and a photo with no
        // type would otherwise go up as a generic file and be refused.
        function photoContentType(file) {
            if (file.type) return file.type;
            const ext = ((file.name || '').match(/\.([^.]+)$/) || [])[1] || '';
            return {
                heic: 'image/heic', heif: 'image/heif', png: 'image/png',
                webp: 'image/webp', gif: 'image/gif'
            }[ext.toLowerCase()] || 'image/jpeg';
        }

        // ------------------------------------------------------------------
        // Photo upload progress in Update Repair.
        //
        // Photos go up when the form is saved, and a photo off an iPad is
        // several megabytes, so a save with a few of them could sit for a
        // long time with nothing on screen to say it was working - and
        // nothing to stop a second tap saving it twice. A photo that failed
        // was skipped without a word and the save still reported success.
        // Now the form locks while it works, each thumbnail fills as it
        // uploads, a bar by the buttons shows the whole job, and a failure
        // stops the save with the form left as it was.
        // ------------------------------------------------------------------

        // Locks the form while it saves, so a second tap cannot send it
        // twice and the modal cannot be closed out from under the upload.
        function setUpdateBusy(modal, busy) {
            if (!modal) return;
            if (busy) modal.dataset.busy = 'true';
            else delete modal.dataset.busy;
            modal.querySelectorAll('button, input, select, textarea').forEach(el => { el.disabled = busy; });

            const submit = modal.querySelector('button[type="submit"]');
            if (submit) {
                if (!submit.dataset.label) submit.dataset.label = submit.innerHTML;
                submit.innerHTML = busy
                    ? '<i class="fas fa-spinner fa-spin"></i> Saving…'
                    : submit.dataset.label;
            }
            if (!busy) {
                const box = modal.querySelector('.upload-progress');
                if (box) box.hidden = true;
            }
        }

        // fraction is 0-1, or null for work with no measurable amount (the
        // save itself), which fills the bar and drops the percentage.
        function showUpdateProgress(modal, label, fraction) {
            const box = modal && modal.querySelector('.upload-progress');
            if (!box) return;
            const pct = fraction === null ? 100 : Math.max(0, Math.min(100, Math.round(fraction * 100)));
            box.hidden = false;
            box.querySelector('.upload-progress__text').textContent = label;
            box.querySelector('.upload-progress__pct').textContent = fraction === null ? '' : pct + '%';
            box.querySelector('.upload-progress__fill').style.width = pct + '%';
            box.querySelector('.upload-progress__track').setAttribute('aria-valuenow', String(pct));
        }

        function setPhotoTileState(photo, state, fraction) {
            const tile = document.querySelector(`#update-photo-preview [data-photo-id="${photo.id}"]`);
            if (!tile) return;
            tile.dataset.state = state;
            tile.style.setProperty('--upload-progress', String(fraction || 0));
            const label = tile.querySelector('.photo-state-small');
            if (label) {
                label.textContent = state === 'queued' ? 'Waiting'
                    : state === 'uploading' ? Math.round((fraction || 0) * 100) + '%'
                        : state === 'done' ? '✓'
                            : state === 'failed' ? 'Failed' : '';
            }
        }

        // Sends whatever in updatePhotos has not gone up yet, one at a time.
        // A photo that made it keeps its URL, so trying again after a
        // failure only sends the ones that failed. False if any failed.
        async function uploadUpdatePhotos(repair, modal) {
            const pending = updatePhotos.filter(p => !p.url);
            if (pending.length === 0) return true;

            // Normally long finished by the time Update Repair is tapped.
            showUpdateProgress(modal, 'Preparing photos', 0);
            await Promise.all(pending.map(p => p.ready));

            const totalBytes = pending.reduce((sum, p) => sum + (p.file.size || 0), 0) || 1;
            let doneBytes = 0;
            let failed = 0;

            pending.forEach(p => setPhotoTileState(p, 'queued', 0));

            for (let i = 0; i < pending.length; i++) {
                const photo = pending[i];
                const label = pending.length === 1
                    ? 'Uploading photo'
                    : `Uploading photo ${i + 1} of ${pending.length}`;
                setPhotoTileState(photo, 'uploading', 0);
                showUpdateProgress(modal, label, doneBytes / totalBytes);
                try {
                    const photoRef = storage.ref().child(`repairs/${repair.repairId}/updates/${Date.now()}_${photo.id}`);
                    const task = photoRef.put(photo.file, { contentType: photoContentType(photo.file) });
                    task.on('state_changed', (snap) => {
                        const own = snap.totalBytes ? snap.bytesTransferred / snap.totalBytes : 0;
                        setPhotoTileState(photo, 'uploading', own);
                        showUpdateProgress(modal, label, (doneBytes + snap.bytesTransferred) / totalBytes);
                    }, () => { /* reported by the await below */ });
                    const snapshot = await task;
                    photo.url = await snapshot.ref.getDownloadURL();
                    setPhotoTileState(photo, 'done', 1);
                } catch (error) {
                    console.error('Error uploading photo:', error);
                    failed++;
                    setPhotoTileState(photo, 'failed', 0);
                }
                doneBytes += photo.file.size || 0;
            }

            if (failed) {
                showAlert(failed === 1
                    ? "A photo didn't upload, so nothing has been saved yet. Tap Update Repair to try it again, or remove it to save without it."
                    : `${failed} photos didn't upload, so nothing has been saved yet. Tap Update Repair to try them again, or remove them to save without them.`,
                    'error');
                return false;
            }
            return true;
        }

        // Update repair status. True once saved; false leaves the form open
        // with everything still in it, so a failed photo or a rejected cost
        // does not throw away the notes that were typed.
        async function updateRepairStatus(repairId, form) {
            const formData = new FormData(form);
            const data = Object.fromEntries(formData);
            const modal = form.closest('.modal');

            try {
                const updateData = {
                    currentStatus: data.newStatus,
                };

                // Add optional fields if provided
                if (data.estimatedCompletion) {
                    updateData.estimatedCompletion = firebase.firestore.Timestamp.fromDate(new Date(data.estimatedCompletion));
                }
                if (data.estimatedCost) {
                    const cost = parseFloat(data.estimatedCost);
                    if (isNaN(cost) || cost < 0 || cost > 50000) {
                        showAlert('Invalid cost: must be between £0 and £50,000', 'error');
                        return false;
                    }
                    updateData.estimatedCost = cost;
                }
                if (data.priority) {
                    updateData.priority = data.priority;
                }
                if (data.warrantyDays !== undefined) {
                    updateData.warrantyDays = parseInt(data.warrantyDays) || 30;
                }

                setUpdateBusy(modal, true);

                // Upload photos if any
                const photoUrls = [];
                if (updatePhotos.length > 0) {
                    const repair = allRepairs.find(r => r.id === repairId);
                    if (!(await uploadUpdatePhotos(repair, modal))) {
                        setUpdateBusy(modal, false);
                        return false;
                    }
                    photoUrls.push(...updatePhotos.map(p => p.url));

                    // Add new photos to existing photos array
                    updateData.photos = firebase.firestore.FieldValue.arrayUnion(...photoUrls);
                }

                showUpdateProgress(modal, 'Saving the update', null);

                // Add progress entry
                const progressEntry = {
                    status: data.newStatus,
                    timestamp: firebase.firestore.Timestamp.now(),
                    // Empty means no message, not a generated one. See the
                    // note in quickAdvanceStatus.
                    notes: data.progressNotes || '',
                    technician: currentUser.email,
                    photos: photoUrls
                };

                updateData.progress = firebase.firestore.FieldValue.arrayUnion(progressEntry);

                // Update in Firestore
                await db.collection('repairs').doc(repairId).update(updateData);

                showAlert('Repair updated successfully!', 'success');
                trackEvent('repair_status_updated', {
                    repair_id: allRepairs.find(r => r.id === repairId)?.repairId,
                    new_status: data.newStatus,
                    has_photos: photoUrls.length > 0
                });

                // Reset update photos
                updatePhotos = [];
                return true;

            } catch (error) {
                console.error('Error updating repair:', error);
                showAlert('Error updating repair: ' + error.message, 'error');
                setUpdateBusy(modal, false);
                return false;
            }
        }

        // Sorting state
        let currentSort = { field: 'dateReceived', direction: 'desc' };

        // Column sorting click handler
        document.querySelectorAll('th.sortable').forEach(th => {
            th.addEventListener('click', () => {
                const field = th.dataset.sort;
                if (currentSort.field === field) {
                    currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
                } else {
                    currentSort.field = field;
                    currentSort.direction = 'asc';
                }
                // Update sort indicators
                document.querySelectorAll('th.sortable').forEach(h => {
                    h.classList.remove('sort-asc', 'sort-desc');
                });
                th.classList.add(currentSort.direction === 'asc' ? 'sort-asc' : 'sort-desc');
                loadAllRepairs();
            });
        });

        // Show/hide search clear button
        document.getElementById('repair-search').addEventListener('input', function () {
            document.getElementById('search-clear').style.display = this.value ? 'block' : 'none';
        });

        // Pagination state
        let currentPage = 1;
        const ITEMS_PER_PAGE = 20;
        let lastFilteredRepairs = [];

        // Get filtered repairs (shared logic for table + export)
        function getFilteredRepairs() {
            const statusFilter = document.getElementById('status-filter').value;
            const commonFilter = document.getElementById('common-repair-filter').value;
            const priorityFilter = document.getElementById('priority-filter')?.value || '';
            const searchQuery = (document.getElementById('repair-search')?.value || '').toLowerCase().trim();

            let filteredRepairs = allRepairs;

            // Apply text search
            if (searchQuery) {
                filteredRepairs = filteredRepairs.filter(r => {
                    const searchText = `${r.repairId || ''} ${r.customerName || ''} ${r.customerPhone || ''} ${r.customerEmail || ''} ${r.brand || ''} ${r.model || ''} ${r.deviceType || ''} ${r.issueDescription || ''}`.toLowerCase();
                    return searchQuery.split(' ').every(term => searchText.includes(term));
                });
            }

            if (statusFilter) filteredRepairs = filteredRepairs.filter(r => r.currentStatus === statusFilter);
            if (priorityFilter) filteredRepairs = filteredRepairs.filter(r => (r.priority || 'normal') === priorityFilter);

            if (commonFilter) {
                filteredRepairs = filteredRepairs.filter(r => {
                    const text = `${r.deviceType || ''} ${r.brand || ''} ${r.model || ''} ${r.issueDescription || ''}`.toLowerCase();
                    if (commonFilter === 'hdmi') return text.includes('hdmi');
                    if (commonFilter === 'cleaning') return text.includes('clean') || text.includes('dust');
                    if (commonFilter === 'pc-rebuild') return text.includes('rebuild') || text.includes('build') || text.includes('assembly');
                    if (commonFilter === 'laptop-diag') return (text.includes('laptop') || text.includes('macbook')) && (text.includes('diag') || text.includes('check') || text.includes('inspect'));
                    return true;
                });
            }

            // Apply sorting
            filteredRepairs.sort((a, b) => {
                let valA, valB;
                switch (currentSort.field) {
                    case 'repairId': valA = (a.repairId || '').toLowerCase(); valB = (b.repairId || '').toLowerCase(); break;
                    case 'customerName': valA = (a.customerName || '').toLowerCase(); valB = (b.customerName || '').toLowerCase(); break;
                    case 'device': valA = `${a.brand || ''} ${a.model || ''}`.toLowerCase(); valB = `${b.brand || ''} ${b.model || ''}`.toLowerCase(); break;
                    case 'currentStatus':
                        valA = statusOrder.indexOf(a.currentStatus); valB = statusOrder.indexOf(b.currentStatus); break;
                    case 'dateReceived': valA = a.dateReceived?.seconds || 0; valB = b.dateReceived?.seconds || 0; break;
                    case 'estimatedCompletion': valA = a.estimatedCompletion?.seconds || 0; valB = b.estimatedCompletion?.seconds || 0; break;
                    default: valA = 0; valB = 0;
                }
                if (valA < valB) return currentSort.direction === 'asc' ? -1 : 1;
                if (valA > valB) return currentSort.direction === 'asc' ? 1 : -1;
                return 0;
            });

            return filteredRepairs;
        }

        // Load all repairs with search, filter, sort, and pagination
        function loadAllRepairs(resetPage) {
            if (resetPage !== false) currentPage = 1;
            updateFilterCount();
            const filteredRepairs = getFilteredRepairs();
            lastFilteredRepairs = filteredRepairs;

            const tbody = document.querySelector('#all-repairs-table tbody');
            const emptyState = document.getElementById('empty-state');
            const table = document.getElementById('all-repairs-table');
            const resultsCount = document.getElementById('results-count');
            tbody.innerHTML = '';

            const hasFilters = document.getElementById('status-filter').value || document.getElementById('common-repair-filter').value || (document.getElementById('repair-search')?.value || '').trim() || (document.getElementById('priority-filter')?.value || '');
            resultsCount.textContent = hasFilters ? `(${filteredRepairs.length} of ${allRepairs.length})` : `(${allRepairs.length})`;

            if (filteredRepairs.length === 0) {
                table.style.display = 'none';
                emptyState.classList.remove('hidden');
                document.getElementById('pagination').innerHTML = '';
            } else {
                table.style.display = '';
                emptyState.classList.add('hidden');

                // Pagination
                const totalPages = Math.ceil(filteredRepairs.length / ITEMS_PER_PAGE);
                if (currentPage > totalPages) currentPage = totalPages;
                const start = (currentPage - 1) * ITEMS_PER_PAGE;
                const paged = filteredRepairs.slice(start, start + ITEMS_PER_PAGE);

                paged.forEach(repair => {
                    const row = createDetailedRepairRow(repair);
                    tbody.appendChild(row);
                });

                renderPagination(totalPages, filteredRepairs.length);
            }
        }

        function renderPagination(totalPages, totalItems) {
            const pag = document.getElementById('pagination');
            if (totalPages <= 1) { pag.innerHTML = ''; return; }

            let html = `<button class="pagination-btn" data-do-click="goToPage" data-page="${currentPage - 1}" ${currentPage === 1 ? 'disabled' : ''}><i class="fas fa-chevron-left"></i></button>`;

            const maxVisible = 5;
            let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
            let endPage = Math.min(totalPages, startPage + maxVisible - 1);
            if (endPage - startPage < maxVisible - 1) startPage = Math.max(1, endPage - maxVisible + 1);

            if (startPage > 1) html += `<button class="pagination-btn" data-do-click="goToPage" data-page="1">1</button><span class="pagination-info">...</span>`;

            for (let i = startPage; i <= endPage; i++) {
                html += `<button class="pagination-btn ${i === currentPage ? 'active' : ''}" data-do-click="goToPage" data-page="${i}">${i}</button>`;
            }

            if (endPage < totalPages) html += `<span class="pagination-info">...</span><button class="pagination-btn" data-do-click="goToPage" data-page="${totalPages}">${totalPages}</button>`;

            html += `<button class="pagination-btn" data-do-click="goToPage" data-page="${currentPage + 1}" ${currentPage === totalPages ? 'disabled' : ''}><i class="fas fa-chevron-right"></i></button>`;
            html += `<span class="pagination-info">${totalItems} repairs</span>`;
            pag.innerHTML = html;
        }

        function goToPage(page) {
            currentPage = page;
            loadAllRepairs(false);
        }

        function createDetailedRepairRow(repair) {
            const row = document.createElement('tr');
            row.dataset.repairId = repair.id;
            const status = statusConfig[repair.currentStatus] || statusConfig['received'];
            const dateReceived = repair.dateReceived ? new Date(repair.dateReceived.seconds * 1000).toLocaleDateString('en-GB') : 'N/A';
            const estCompletion = repair.estimatedCompletion ? new Date(repair.estimatedCompletion.seconds * 1000).toLocaleDateString('en-GB') : 'TBD';
            const age = timeAgo(repair.dateReceived?.seconds);
            const ageClass = getAgeClass(repair.dateReceived?.seconds);

            // Priority badge
            const priority = repair.priority || 'normal';
            const priorityBadge = priority !== 'normal' ? ` <span class="priority-badge priority-${priority}"><i class="fas ${priority === 'urgent' ? 'fa-bolt' : 'fa-arrow-down'}"></i> ${priority}</span>` : '';

            // Warranty badge for completed repairs
            let warrantyTag = '';
            if (repair.currentStatus === 'completed' && repair.warrantyDays) {
                const completedProgress = repair.progress?.slice().reverse().find(p => p.status === 'completed');
                if (completedProgress?.timestamp) {
                    const warrantyEnd = new Date(completedProgress.timestamp.seconds * 1000 + repair.warrantyDays * 86400000);
                    const isActive = warrantyEnd > new Date();
                    warrantyTag = ` <span class="warranty-badge ${isActive ? 'warranty-active' : 'warranty-expired'}"><i class="fas fa-shield-alt"></i> ${isActive ? 'Warranty' : 'Expired'}</span>`;
                }
            }

            // Repair timer
            let timerHTML = '';
            if (!['completed', 'ready'].includes(repair.currentStatus) && repair.dateReceived) {
                const elapsed = getElapsedTime(repair.dateReceived.seconds);
                timerHTML = `<span class="repair-timer"><i class="fas fa-stopwatch"></i> ${elapsed}</span>`;
            }

            // Check if overdue
            const isOverdue = repair.estimatedCompletion &&
                !['completed', 'ready'].includes(repair.currentStatus) &&
                new Date(repair.estimatedCompletion.seconds * 1000) < new Date();
            const overdueTag = isOverdue ? ' <span class="overdue-badge"><i class="fas fa-exclamation-triangle"></i> Overdue</span>' : '';

            // HTML-escaped for data-* attributes; the ACTIONS table reads them back.
            const attrId = escapeHTML(repair.id);
            const attrRepairId = escapeHTML(repair.repairId);
            const attrCustomerKey = escapeHTML(repair.customerEmail || repair.customerPhone);
            const canAdvance = repair.currentStatus !== 'completed';
            const statusClickable = canAdvance ? 'clickable-status' : '';
            const statusOnclick = canAdvance ? `data-do-click="quickAdvanceStatus" data-id="${attrId}"` : '';
            const statusTitle = canAdvance ? `title="Click to advance to ${escapeHTML(statusConfig[getNextStatus(repair.currentStatus)]?.label || 'next')}"` : '';

            row.innerHTML = `
                <td class="cell-select"><input type="checkbox" class="bulk-checkbox row-checkbox" data-repair-id="${escapeHTML(repair.id)}" data-do-change="updateBulkSelection"></td>
                <td class="cell-id" data-label="Repair ID"><strong>${escapeHTML(repair.repairId)}</strong>${priorityBadge}</td>
                <td class="cell-customer" data-label="Customer"><a href="#" data-do-click="showCustomerHistory" data-customer="${attrCustomerKey}" style="color: var(--text-main); text-decoration: underline dashed var(--text-dark); text-underline-offset: 4px;">${escapeHTML(repair.customerName)}</a><br><a class="cell-customer__phone" href="tel:${escapeHTML((repair.customerPhone || '').replace(/[^+\d]/g, ''))}">${escapeHTML(repair.customerPhone)}</a></td>
                <td class="cell-device" data-label="Device">${escapeHTML(repair.deviceType)}<br><small style="color: var(--text-muted);">${escapeHTML(repair.brand)} ${escapeHTML(repair.model)}</small></td>
                <td class="cell-issue" data-label="Issue" title="${escapeHTML(repair.issueDescription)}">${escapeHTML(repair.issueDescription).substring(0, 50)}${(repair.issueDescription || '').length > 50 ? '...' : ''}</td>
                <td class="cell-status" data-label="Status"><span class="status-badge ${status.class} ${statusClickable}" ${statusOnclick} ${statusTitle}>${status.label}</span>${overdueTag}${warrantyTag}</td>
                <td class="cell-received" data-label="Received">${dateReceived}<span class="repair-age ${ageClass}">${age}</span>${timerHTML}</td>
                <td class="cell-est" data-label="Due">${estCompletion}</td>
                <td class="cell-actions" data-label="">
                    <button class="btn btn-secondary btn-action" data-do-click="viewRepair" data-id="${attrId}" title="View details">
                        <i class="fas fa-eye"></i><span class="btn-action__label">View</span>
                    </button>
                    <button class="btn btn-primary btn-action" data-do-click="editRepair" data-id="${attrId}" title="Update status, notes and photos">
                        <i class="fas fa-edit"></i><span class="btn-action__label">Update</span>
                    </button>
                    <button class="btn btn-secondary btn-action" data-do-click="editCustomer" data-id="${attrId}" title="Correct name, email or phone">
                        <i class="fas fa-user-pen"></i><span class="btn-action__label">Customer</span>
                    </button>
                    <button class="btn btn-copy btn-action" data-do-click="openTrackingLink" data-repair-id="${attrRepairId}" title="Open tracking page">
                        <i class="fas fa-external-link-alt"></i><span class="btn-action__label">Track</span>
                    </button>
                    <button class="btn btn-secondary btn-action" data-do-click="generateInvoice" data-id="${attrId}" title="Generate invoice">
                        <i class="fas fa-file-invoice"></i><span class="btn-action__label">Invoice</span>
                    </button>
                    <button class="btn btn-secondary btn-action" data-do-click="reprintLabel" data-id="${attrId}" title="Print label">
                        <i class="fas fa-tag"></i><span class="btn-action__label">Label</span>
                    </button>
                    <button class="btn btn-danger btn-action" data-do-click="deleteRepair" data-id="${attrId}" data-repair-id="${attrRepairId}" title="Delete repair">
                        <i class="fas fa-trash"></i><span class="btn-action__label">Delete</span>
                    </button>
                </td>
            `;
            return row;
        }

        // Copy tracking link to clipboard
        // Opens the customer's tracking page in a new tab. This used to copy the
        // URL to the clipboard, which meant a second manual step every time —
        // on the iPad in particular, pasting it somewhere to open it.
        function openTrackingLink(repairId) {
            safeOpen(`${window.location.origin}/track/?id=${repairId}`);
        }

        // Toast notification system
        // opts.sticky keeps the message up until it is closed, for a problem
        // that needs doing something about rather than a passing note.
        function showAlert(message, type, opts = {}) {
            const container = document.getElementById('toast-container');
            const toast = document.createElement('div');
            const iconMap = { success: 'fa-check-circle', error: 'fa-exclamation-circle', info: 'fa-info-circle' };
            toast.className = `toast toast-${type}`;
            toast.innerHTML = `
                <i class="fas ${iconMap[type] || iconMap.info}"></i>
                <span>${escapeHTML(message)}</span>
                <button class="toast-close" data-do-click="dismissToast">&times;</button>
            `;
            container.appendChild(toast);
            if (!opts.sticky) setTimeout(() => dismissToast(toast), 5000);
        }

        function dismissToast(toast) {
            if (!toast || toast.classList.contains('toast-removing')) return;
            toast.classList.add('toast-removing');
            setTimeout(() => toast.remove(), 300);
        }

        // Close modals when clicking outside or pressing Escape
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                // Not while it is saving: the upload would carry on unseen.
                if (e.target.dataset.busy) return;
                if (e.target.id) {
                    e.target.classList.remove('show');
                } else {
                    e.target.remove();
                }
            }
        });

        // Keyboard shortcuts handled in dedicated section below

        // Show templates for selected status with preview text
        function showTemplates(status) {
            const templates = statusTemplates[status];
            const selector = document.getElementById('template-selector');
            const buttonsContainer = document.getElementById('template-buttons');

            if (templates && templates.length > 0) {
                selector.style.display = 'block';
                buttonsContainer.innerHTML = '';

                templates.forEach((template) => {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'template-btn-improved';
                    // Show first ~60 chars as preview
                    const preview = template.length > 60 ? template.substring(0, 60) + '...' : template;
                    btn.textContent = preview;
                    btn.title = template;
                    btn.onclick = () => {
                        document.getElementById('progress-notes').value = template;
                    };
                    buttonsContainer.appendChild(btn);
                });
            } else {
                selector.style.display = 'none';
            }
        }

        // Handle photo upload for updates
        function handleUpdatePhotos(event) {
            const files = Array.from(event.target.files);
            const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
            const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif'];

            files.forEach(file => {
                // A photo from an iPad sometimes arrives with no type at all,
                // so an untyped file is judged by its name - the way the
                // intake page already does. It used to be refused here.
                const typeOk = file.type
                    ? ALLOWED_TYPES.includes(file.type)
                    : /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(file.name || '');
                if (!typeOk) {
                    showAlert(`Skipped "${file.name}": not a valid image type`, 'error');
                    return;
                }
                if (file.size > MAX_FILE_SIZE) {
                    showAlert(`Skipped "${file.name}": exceeds 10MB limit (${(file.size / 1024 / 1024).toFixed(1)}MB)`, 'error');
                    return;
                }
                const reader = new FileReader();
                reader.onload = (e) => {
                    addUpdatePhotoPreview(e.target.result, file);
                };
                reader.readAsDataURL(file);
            });
        }

        function addUpdatePhotoPreview(src, file) {
            const preview = document.getElementById('update-photo-preview');
            const photoItem = document.createElement('div');
            photoItem.className = 'photo-item-small';

            const photoId = 'photo_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            photoItem.innerHTML = `
                <img src="${escapeHTML(src)}" alt="Update photo">
                <span class="photo-progress-small" aria-hidden="true"><span></span></span>
                <span class="photo-state-small"></span>
                <button type="button" class="photo-remove-small" data-do-click="removeUpdatePhoto" data-photo-id="${escapeHTML(photoId)}">×</button>
            `;

            photoItem.dataset.photoId = photoId;
            preview.appendChild(photoItem);

            const photo = { id: photoId, file, src };
            // Starts now, while the rest of the form is filled in, so it is
            // usually done before Update Repair is tapped.
            photo.ready = shrinkPhoto(file).then(small => { photo.file = small; });
            updatePhotos.push(photo);
        }

        function removeUpdatePhoto(photoId) {
            const photoElement = document.querySelector(`[data-photo-id="${photoId}"]`);
            if (photoElement) {
                photoElement.remove();
            }
            updatePhotos = updatePhotos.filter(photo => photo.id !== photoId);
        }

        // === ELAPSED TIME / REPAIR TIMER ===
        function getElapsedTime(receivedSeconds) {
            if (!receivedSeconds) return '';
            const diff = Date.now() - receivedSeconds * 1000;
            const hours = Math.floor(diff / 3600000);
            const days = Math.floor(hours / 24);
            const h = hours % 24;
            if (days > 0) return `${days}d ${h}h`;
            return `${hours}h`;
        }

        // === KANBAN BOARD ===
        function renderKanban(containerId = 'overview-kanban-container') {
            const container = document.getElementById(containerId);
            if (!container) return;
            const columns = ['received', 'diagnosing', 'waiting-decision', 'waiting-parts', 'in-repair', 'testing', 'ready'];

            container.innerHTML = columns.map(status => {
                const repairs = allRepairs.filter(r => r.currentStatus === status);
                const config = statusConfig[status];
                return `
                    <div class="kanban-column">
                        <div class="kanban-column-header">
                            <span style="color: ${getStatusColor(status)};">${config.label}</span>
                            <span class="kanban-column-count">${repairs.length}</span>
                        </div>
                        <div class="kanban-cards" data-status="${status}"
                             data-do-dragover="kanbanDragOver"
                             data-do-dragleave="kanbanDragLeave"
                             data-do-drop="kanbanDrop">
                            ${repairs.map(r => renderKanbanCard(r)).join('')}
                        </div>
                    </div>
                `;
            }).join('');
        }

        function getStatusColor(status) {
            const colors = {
                'received': '#60A5FA', 'diagnosing': '#FBBF24', 'waiting-decision': '#F472B6', 'waiting-parts': '#F87171',
                'in-repair': '#A78BFA', 'testing': '#38BDF8', 'ready': '#34D399', 'completed': '#94A3B8'
            };
            return colors[status] || '#94A3B8';
        }

        function renderKanbanCard(repair) {
            const age = timeAgo(repair.dateReceived?.seconds);
            const priority = repair.priority || 'normal';
            const priorityHTML = priority === 'urgent' ? '<span class="priority-badge priority-urgent"><i class="fas fa-bolt"></i></span>' :
                                 priority === 'low' ? '<span class="priority-badge priority-low"><i class="fas fa-arrow-down"></i></span>' : '';

            // Days sitting in this column. A week in Diagnosing means nobody
            // has touched it, which total age alone will not tell you.
            const stuck = daysInStatus(repair);
            let flagHTML = '';
            let flagClass = '';
            if (stuck !== null && stuck >= 3) {
                flagClass = stuck >= 7 ? 'is-stale' : 'is-warn';
                flagHTML = `<div class="kanban-card-stuck">
                        <i class="fas fa-triangle-exclamation"></i>
                        ${stuck} day${stuck === 1 ? '' : 's'} in this status
                    </div>`;
            }

            // Opens the job sheet, not the status box. Reading a customer's
            // number off the board used to mean leaving it for All Repairs.
            return `
                <div class="kanban-card ${flagClass}" draggable="true" data-id="${escapeHTML(repair.id)}"
                     role="button" tabindex="0"
                     data-do-dragstart="kanbanDragStart"
                     data-do-dragend="kanbanDragEnd"
                     data-do-click="viewRepair"
                     data-do-keydown="viewRepairOnKey">
                    <div class="kanban-card-id">${escapeHTML(repair.repairId)} ${priorityHTML}</div>
                    <div class="kanban-card-customer">${escapeHTML(repair.customerName)}</div>
                    <div class="kanban-card-device">${escapeHTML(repair.brand)} ${escapeHTML(repair.model)}</div>
                    ${flagHTML}
                    <!-- Age since booked in. The running stopwatch that sat
                         beside it measured the same thing to the hour, so a
                         flagged card carried three readings of time. -->
                    <div class="kanban-card-footer">
                        <span class="kanban-card-age">${age}</span>
                    </div>
                </div>
            `;
        }

        // A drop no longer writes anything on its own. Dragging a card was
        // stamping "Moved to X via Kanban board" onto the customer's tracking
        // timeline, which read as shop-floor chatter to the person waiting on
        // their device. The drop now opens this box instead: pick the wording
        // the customer gets, send the move with no message at all, or cancel.
        // Nothing reaches Firestore until the button in here is pressed.
        function handleKanbanDrop(event, newStatus) {
            event.preventDefault();
            event.currentTarget.classList.remove('drag-over');
            const repairId = event.dataTransfer.getData('text/plain');
            const repair = allRepairs.find(r => r.id === repairId);
            if (!repair || repair.currentStatus === newStatus) return;
            showKanbanMoveModal(repair, newStatus);
        }

        function showKanbanMoveModal(repair, newStatus) {
            const fromLabel = statusConfig[repair.currentStatus]?.label || repair.currentStatus;
            const toLabel = statusConfig[newStatus]?.label || newStatus;
            const templates = statusTemplates[newStatus] || [];

            const modal = document.createElement('div');
            modal.className = 'modal show';
            modal.innerHTML = `
                <div class="modal-content" style="max-width: 560px;">
                    <div class="modal-header">
                        <h2 class="modal-title">Move to ${escapeHTML(toLabel)}?</h2>
                        <button class="close-btn" data-do-click="closeModal">&times;</button>
                    </div>
                    <div class="form-group" style="background: var(--bg-surface); border: 1px solid var(--border-color); padding: 1rem; border-radius: var(--radius-md); margin-bottom: 1.25rem;">
                        <label class="form-label">${escapeHTML(repair.repairId)} &mdash; <span style="color: var(--text-main); font-weight: 400;">${escapeHTML(repair.customerName)}</span></label>
                        <label class="form-label" style="margin-bottom: 0.5rem;">Device: <span style="color: var(--text-main); font-weight: 400;">${escapeHTML(repair.brand)} ${escapeHTML(repair.model)}</span></label>
                        <span style="color: var(--text-dark); font-size: 0.85rem;">
                            ${escapeHTML(fromLabel)} <i class="fas fa-arrow-right" style="margin: 0 0.35rem;"></i> <span style="color: ${getStatusColor(newStatus)};">${escapeHTML(toLabel)}</span>
                        </span>
                    </div>
                    ${templates.length > 0 ? `
                        <div class="template-selector">
                            <label class="form-label">Quick Templates:</label>
                            <div id="kanban-move-templates"></div>
                        </div>
                    ` : ''}
                    <div class="form-group">
                        <label class="form-label" for="kanban-move-notes">Message on the customer's tracking page</label>
                        <textarea class="form-input form-textarea" id="kanban-move-notes"
                            placeholder="Leave blank to move the job without writing anything to the customer."></textarea>
                        <span style="color: var(--text-dark); font-size: 0.8rem;">
                            Blank is fine. The tracking page still shows the new stage and the time, just with no message under it.
                        </span>
                    </div>
                    <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; justify-content: flex-end; margin-top: 1.5rem; padding-top: 1.25rem; border-top: 1px solid var(--border-color);">
                        <button type="button" class="btn btn-secondary" data-do-click="closeModal">Cancel</button>
                        <button type="button" class="btn btn-primary" id="kanban-move-confirm">
                            <i class="fas fa-arrow-right"></i>
                            Move job
                        </button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            const notes = modal.querySelector('#kanban-move-notes');
            const templateBox = modal.querySelector('#kanban-move-templates');
            if (templateBox) {
                templates.forEach((template) => {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'template-btn-improved';
                    btn.textContent = template.length > 60 ? template.substring(0, 60) + '...' : template;
                    btn.title = template;
                    // Tapping the same template again clears it, so a tap made
                    // by mistake on the shop iPad does not need the keyboard.
                    btn.onclick = () => {
                        notes.value = notes.value === template ? '' : template;
                    };
                    templateBox.appendChild(btn);
                });
            }

            modal.querySelector('#kanban-move-confirm').onclick = (e) =>
                confirmKanbanMove(repair.id, newStatus, notes.value.trim(), e.currentTarget);

            notes.focus();
        }

        async function confirmKanbanMove(repairId, newStatus, noteText, btn) {
            const repair = allRepairs.find(r => r.id === repairId);
            if (!repair) return;

            const original = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Moving...';

            try {
                const progressEntry = {
                    status: newStatus,
                    timestamp: firebase.firestore.Timestamp.now(),
                    // Whatever was typed, and nothing if nothing was. The
                    // tracking page hides the note line when this is empty.
                    notes: noteText,
                    technician: currentUser.email,
                    photos: []
                };
                await db.collection('repairs').doc(repairId).update({
                    currentStatus: newStatus,
                    progress: firebase.firestore.FieldValue.arrayUnion(progressEntry)
                });
                btn.closest('.modal')?.remove();
                showAlert(`Moved to ${statusConfig[newStatus]?.label}`, 'success');
                trackEvent('kanban_status_change', {
                    repair_id: repair.repairId,
                    new_status: newStatus,
                    has_note: noteText.length > 0
                });
            } catch (error) {
                btn.disabled = false;
                btn.innerHTML = original;
                showAlert('Error moving repair: ' + error.message, 'error');
            }
        }

        // === CUSTOMER HISTORY ===
        function showCustomerHistory(identifier, event) {
            if (event) event.preventDefault();
            const customerRepairs = allRepairs.filter(r =>
                (r.customerEmail && r.customerEmail === identifier) ||
                (r.customerPhone && r.customerPhone === identifier)
            );

            if (customerRepairs.length === 0) return;

            const customer = customerRepairs[0];
            const totalSpend = customerRepairs.reduce((sum, r) => sum + (r.estimatedCost || 0), 0);
            const completedCount = customerRepairs.filter(r => r.currentStatus === 'completed').length;

            const modal = document.createElement('div');
            modal.className = 'modal show';
            modal.innerHTML = `
                <div class="modal-content" style="max-width: 650px;">
                    <div class="modal-header">
                        <h2 class="modal-title"><i class="fas fa-user" style="margin-right: 0.5rem;"></i>${escapeHTML(customer.customerName)}</h2>
                        <button class="close-btn" data-do-click="closeModal">&times;</button>
                    </div>
                    <div style="padding: 1.5rem;">
                        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem; margin-bottom: 1.5rem;">
                            <div class="customer-stat">
                                <div class="customer-stat-value">${customerRepairs.length}</div>
                                <div class="customer-stat-label">Total Repairs</div>
                            </div>
                            <div class="customer-stat">
                                <div class="customer-stat-value">£${totalSpend.toLocaleString()}</div>
                                <div class="customer-stat-label">Total Spend</div>
                            </div>
                            <div class="customer-stat">
                                <div class="customer-stat-value">${completedCount}</div>
                                <div class="customer-stat-label">Completed</div>
                            </div>
                        </div>
                        <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.75rem;">
                            <i class="fas fa-phone" style="margin-right: 0.5rem;"></i>${escapeHTML(customer.customerPhone || 'N/A')}
                            <span style="margin: 0 0.75rem;">|</span>
                            <i class="fas fa-envelope" style="margin-right: 0.5rem;"></i>${escapeHTML(customer.customerEmail || 'N/A')}
                        </p>
                        <h3 style="font-size: 0.9rem; color: var(--text-dark); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.75rem;">Repair History</h3>
                        <div class="customer-history-list">
                            ${customerRepairs.sort((a, b) => (b.dateReceived?.seconds || 0) - (a.dateReceived?.seconds || 0)).map(r => {
                                const status = statusConfig[r.currentStatus] || statusConfig['received'];
                                const date = r.dateReceived ? new Date(r.dateReceived.seconds * 1000).toLocaleDateString('en-GB') : 'N/A';
                                return `
                                    <div class="customer-history-item" data-do-click="closeAndEditRepair" data-id="${escapeHTML(r.id)}">
                                        <div style="flex: 1;">
                                            <strong style="color: var(--accent-cyan); font-size: 0.8rem;">${escapeHTML(r.repairId)}</strong>
                                            <div style="font-size: 0.9rem; color: var(--text-main);">${escapeHTML(r.brand)} ${escapeHTML(r.model)}</div>
                                            <div style="font-size: 0.75rem; color: var(--text-dark);">${date}</div>
                                        </div>
                                        <span class="status-badge ${status.class}" style="font-size: 0.7rem; padding: 0.2rem 0.6rem;">${status.label}</span>
                                        ${r.estimatedCost ? `<span style="color: var(--text-muted); font-size: 0.85rem;">£${escapeHTML(r.estimatedCost)}</span>` : ''}
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }

        // === INVOICE GENERATION ===
        function generateInvoice(repairId) {
            const repair = allRepairs.find(r => r.id === repairId);
            if (!repair) return;

            const date = repair.dateReceived ? new Date(repair.dateReceived.seconds * 1000).toLocaleDateString('en-GB') : 'N/A';
            const statusLabel = statusConfig[repair.currentStatus]?.customerLabel || statusConfig[repair.currentStatus]?.label || repair.currentStatus;

            // NOTE: no 'noopener' here. window.open() returns null when noopener
            // is set — that is what the flag does — and this window has to be
            // written into, so the handle is required. The opener reference is
            // severed on the next line instead, which is the correct pattern
            // when you need the handle back.
            const invoiceWindow = window.open('', '_blank');
            if (!invoiceWindow) { showAlert('Pop-up blocked. Please allow pop-ups for this site.', 'error'); return; }
            invoiceWindow.opener = null;
            invoiceWindow.document.write(`
                <!DOCTYPE html>
                <html>
                <head>
                    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline';">
                    <!-- Without this a phone or tablet lays the page out at about
                         980px and scales it down to fit, which arrived at roughly
                         40% size. Every other page on the site sets it; this one
                         is built in a string and was missed. -->
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Invoice - ${escapeHTML(repair.repairId)}</title>
                    <style>
                        * { margin: 0; padding: 0; box-sizing: border-box; }
                        body { font-family: 'Segoe UI', Tahoma, sans-serif; padding: 2rem; color: #1a1a1a; max-width: 800px; margin: 0 auto; }
                        .invoice-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 2rem; padding-bottom: 1.5rem; border-bottom: 3px solid #0033FF; }
                        .company-name { font-size: 2rem; font-weight: 800; color: #0033FF; letter-spacing: -1px; }
                        .tm { font-size: 0.5em; line-height: 0; vertical-align: 0.75em; margin-left: 1px; }
                        .company-details { font-size: 0.85rem; color: #666; line-height: 1.6; text-align: right; }
                        .invoice-title { font-size: 1.5rem; font-weight: 700; color: #333; margin-bottom: 0.5rem; }
                        .invoice-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; margin-bottom: 2rem; }
                        .meta-group h3 { font-size: 0.8rem; color: #999; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 0.5rem; }
                        .meta-group p { font-size: 0.95rem; line-height: 1.6; }
                        table { width: 100%; border-collapse: collapse; margin: 1.5rem 0; }
                        th { background: #f8f9fa; padding: 0.75rem 1rem; text-align: left; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: #666; border-bottom: 2px solid #e9ecef; }
                        td { padding: 0.75rem 1rem; border-bottom: 1px solid #e9ecef; font-size: 0.95rem; }
                        .total-row { font-weight: 700; font-size: 1.1rem; background: #f0f4ff; }
                        .total-row td { border-bottom: 3px solid #0033FF; }
                        .footer { text-align: center; margin-top: 3rem; padding-top: 1.5rem; border-top: 1px solid #e9ecef; color: #999; font-size: 0.85rem; }
                        .status-tag { display: inline-block; padding: 0.25rem 0.75rem; border-radius: 20px; font-size: 0.8rem; font-weight: 600; background: #e8f5e9; color: #2e7d32; }
                        .print-btn { position: fixed; top: 1rem; right: 1rem; padding: 0.5rem 1.5rem; background: #0033FF; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 0.9rem; }
                        .meta-group--right { text-align: right; }
                        @media print { .print-btn { display: none; } }

                        /* The sheet is 800px wide and centred, so a Print
                           button pinned to the top right corner only clears it
                           on a wide screen. Below that it came down on the shop
                           address — on an iPad in portrait it covered it. Sits
                           in the flow instead, at a size worth tapping. */
                        @media (max-width: 1100px) {
                            .print-btn { position: static; display: block; width: 100%; min-height: 44px; margin-bottom: 1.25rem; font-size: 1rem; }
                        }

                        /* Phone. The header and the two meta groups are
                           side-by-side blocks with no room to be side by side. */
                        @media (max-width: 700px) {
                            body { padding: 1rem; }
                            .invoice-header { flex-direction: column; gap: 1rem; }
                            .company-details { text-align: left; }
                            .invoice-meta { grid-template-columns: 1fr; gap: 1.25rem; }
                            .meta-group--right { text-align: left; }
                            th, td { padding: 0.6rem 0.5rem; font-size: 0.9rem; }
                        }
                    </style>
                </head>
                <body>
                    <button class="print-btn" type="button">Print Invoice</button>
                    <div class="invoice-header">
                        <div>
                            <div class="company-name">OnlineFix<span class="tm">™</span></div>
                            <div style="color: #666; font-size: 0.9rem;">Device Repair Specialists</div>
                        </div>
                        <div class="company-details">
                            OnlineFix™<br>
                            13 Quarry Street, Guildford, Surrey GU1 3UY<br>
                            07940 730537<br>
                            hello@onlinefix.uk
                        </div>
                    </div>
                    <div class="invoice-title">INVOICE</div>
                    <p style="color: #666; margin-bottom: 1.5rem;">Repair ID: <strong>${escapeHTML(repair.repairId)}</strong> &nbsp; | &nbsp; Status: <span class="status-tag">${escapeHTML(statusLabel)}</span></p>
                    <div class="invoice-meta">
                        <div class="meta-group">
                            <h3>Bill To</h3>
                            <p><strong>${escapeHTML(repair.customerName)}</strong><br>
                            ${escapeHTML(repair.customerPhone || '')}<br>
                            ${escapeHTML(repair.customerEmail || '')}<br>
                            ${escapeHTML(repair.customerAddress || '')}</p>
                        </div>
                        <div class="meta-group meta-group--right">
                            <h3>Invoice Details</h3>
                            <p>Date: ${date}<br>
                            Invoice #: INV-${escapeHTML(repair.repairId.replace('REPAIR_', ''))}</p>
                        </div>
                    </div>
                    <table>
                        <thead>
                            <tr><th>Description</th><th>Details</th><th style="text-align: right;">Amount</th></tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td><strong>Device Repair Service</strong></td>
                                <td>${escapeHTML(repair.brand)} ${escapeHTML(repair.model)} (${escapeHTML(repair.deviceType)})</td>
                                <td style="text-align: right;">£${(repair.estimatedCost || 0).toFixed(2)}</td>
                            </tr>
                            <tr>
                                <td colspan="2" style="color: #666;">${escapeHTML(repair.issueDescription || 'Repair service')}</td>
                                <td></td>
                            </tr>
                            <tr class="total-row">
                                <td colspan="2" style="text-align: right;"><strong>TOTAL</strong></td>
                                <td style="text-align: right;"><strong>£${(repair.estimatedCost || 0).toFixed(2)}</strong></td>
                            </tr>
                        </tbody>
                    </table>
                    <div class="footer">
                        <p>Thank you for choosing OnlineFix!</p>
                        <p style="margin-top: 0.5rem;">onlinefix.co.uk &nbsp; | &nbsp; hello@onlinefix.uk &nbsp; | &nbsp; 07940 730537</p>
                    </div>
                </body>
                </html>
            `);
            invoiceWindow.document.close();
            // The invoice runs no script of its own (its policy above says
            // script-src 'none'), so the Print button is wired from here.
            const printBtn = invoiceWindow.document.querySelector('.print-btn');
            if (printBtn) printBtn.addEventListener('click', () => invoiceWindow.print());
            trackEvent('invoice_generated', { repair_id: repair.repairId });
        }

        // === PRINT LABEL FROM ADMIN ===
        // Prints straight from here. The label page is still the place to
        // change which roll is loaded or to turn the artwork a quarter turn,
        // but those settings barely ever change, so routing every print
        // through it meant opening a tab and clicking Print for a sticker
        // whose settings were already correct.
        //
        // The drawing itself comes from label-render.js, shared with that
        // page — writing a second label here is what once printed a 57x32mm
        // box sideways on A4, because the copy had no @page rule at all.
        function reprintLabel(repairId) {
            const repair = allRepairs.find(r => r.id === repairId);
            if (!repair) return;

            if (!window.OnlineFixLabel) {
                showAlert('Label printer script did not load — reload the page', 'error');
                return;
            }

            try {
                const { size, rotated } = OnlineFixLabel.printRepair(repair);
                showAlert(`Label sent — ${size.w} × ${size.h} mm${rotated ? ', turned' : ''}`, 'success');
            } catch (err) {
                console.error('Label print failed', err);
                showAlert('Could not print that label', 'error');
            }
        }

        // === DATE RANGE FILTER FOR ANALYTICS ===
        let analyticsDateRange = 'all';

        function setAnalyticsRange(range, btn) {
            analyticsDateRange = range;
            // Update active button
            if (btn) {
                document.querySelectorAll('.date-range-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            }
            renderAnalytics();
        }

        function getAnalyticsRepairs() {
            if (analyticsDateRange === 'all') return allRepairs;

            let fromDate;
            const now = new Date();

            if (analyticsDateRange === 'custom') {
                const from = document.getElementById('analytics-date-from').value;
                const to = document.getElementById('analytics-date-to').value;
                if (!from) return allRepairs;
                fromDate = new Date(from);
                const toDate = to ? new Date(to + 'T23:59:59') : now;
                return allRepairs.filter(r => {
                    if (!r.dateReceived) return false;
                    const d = new Date(r.dateReceived.seconds * 1000);
                    return d >= fromDate && d <= toDate;
                });
            }

            const daysMap = { '7d': 7, '30d': 30, '90d': 90 };
            const days = daysMap[analyticsDateRange] || 0;
            fromDate = new Date(now.getTime() - days * 86400000);

            return allRepairs.filter(r => {
                if (!r.dateReceived) return false;
                return new Date(r.dateReceived.seconds * 1000) >= fromDate;
            });
        }

        // === KEYBOARD SHORTCUTS ===
        let selectedRowIndex = -1;

        document.addEventListener('keydown', (e) => {
            // Don't trigger shortcuts when typing in inputs
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
                if (e.key === 'Escape') {
                    e.target.blur();
                }
                return;
            }

            // Don't trigger when modal is open (except Escape)
            const modalOpen = document.querySelector('.modal.show');
            if (modalOpen && e.key !== 'Escape') return;

            switch (e.key) {
                case 'n':
                case 'N':
                    e.preventDefault();
                    window.location.href = '../new-repair/';
                    break;
                case '/':
                    e.preventDefault();
                    showSection('repairs');
                    setTimeout(() => document.getElementById('repair-search')?.focus(), 100);
                    break;
                case 'j':
                case 'J':
                    e.preventDefault();
                    navigateRow(1);
                    break;
                case 'k':
                case 'K':
                    e.preventDefault();
                    navigateRow(-1);
                    break;
                case 'e':
                case 'E':
                    e.preventDefault();
                    if (selectedRowIndex >= 0) {
                        const rows = document.querySelectorAll('#all-repairs-table tbody tr');
                        const row = rows[selectedRowIndex];
                        if (row) {
                            const id = row.dataset.repairId;
                            if (id) editRepair(id);
                        }
                    }
                    break;
                case 'v':
                case 'V':
                    e.preventDefault();
                    if (selectedRowIndex >= 0) {
                        const rows = document.querySelectorAll('#all-repairs-table tbody tr');
                        const row = rows[selectedRowIndex];
                        if (row) {
                            const id = row.dataset.repairId;
                            if (id) viewRepair(id);
                        }
                    }
                    break;
                case 'b':
                case 'B':
                    e.preventDefault();
                    showSection('overview');
                    break;
                case 'Escape':
                    const modals = document.querySelectorAll('.modal.show');
                    modals.forEach(modal => { if (!modal.dataset.busy) modal.remove(); });
                    break;
            }
        });

        function navigateRow(direction) {
            const rows = document.querySelectorAll('#all-repairs-table tbody tr');
            if (rows.length === 0) return;

            // Remove previous selection
            rows.forEach(r => r.style.outline = '');

            selectedRowIndex += direction;
            if (selectedRowIndex < 0) selectedRowIndex = 0;
            if (selectedRowIndex >= rows.length) selectedRowIndex = rows.length - 1;

            const row = rows[selectedRowIndex];
            row.style.outline = '2px solid var(--accent-cyan)';
            row.style.outlineOffset = '-2px';
            row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }

        // === GA4 CUSTOM EVENT TRACKING ===
        function trackEvent(eventName, params) {
            if (typeof gtag === 'function') {
                gtag('event', eventName, params);
            }
        }

        // === WHATSAPP NOTIFICATION ===
        function sendWhatsApp(repairId) {
            const repair = allRepairs.find(r => r.id === repairId);
            if (!repair) return;

            const phone = (repair.customerPhone || '').replace(/\D/g, '');
            if (!phone) {
                showAlert('No phone number found for this customer.', 'error');
                return;
            }

            // Get the currently selected status from the modal (if open)
            const statusSelect = document.getElementById('status-select');
            const currentStatus = statusSelect ? statusSelect.value : repair.currentStatus;
            const statusLabel = statusConfig[currentStatus]?.customerLabel || statusConfig[currentStatus]?.label || currentStatus;

            const message = `Hi ${repair.firstName || repair.customerName},\n\nThis is an update from OnlineFix regarding your repair (${repair.repairId}).\n\nStatus: ${statusLabel}\nDevice: ${repair.brand} ${repair.model}\n\nTracking link: ${window.location.origin}/track/?id=${repair.repairId}\n\nThank you for choosing OnlineFix!`;

            // UK phone format: ensure starts with country code
            let formattedPhone = phone;
            if (formattedPhone.startsWith('0')) {
                formattedPhone = '44' + formattedPhone.substring(1);
            } else if (!formattedPhone.startsWith('44')) {
                formattedPhone = '44' + formattedPhone;
            }

            safeOpen(`https://wa.me/${formattedPhone}?text=${encodeURIComponent(message)}`);
            trackEvent('whatsapp_notification_sent', { repair_id: repair.repairId, status: currentStatus });
            showAlert('WhatsApp opened with pre-filled message', 'info');
        }

        // === EMAIL NOTIFICATION ===
        function sendEmailUpdate(repairId) {
            const repair = allRepairs.find(r => r.id === repairId);
            if (!repair) return;

            const email = repair.customerEmail;
            if (!email) {
                showAlert('No email address found for this customer.', 'error');
                return;
            }

            // Get the currently selected status from the modal (if open)
            const statusSelect = document.getElementById('status-select');
            const currentStatus = statusSelect ? statusSelect.value : repair.currentStatus;
            const statusLabel = statusConfig[currentStatus]?.customerLabel || statusConfig[currentStatus]?.label || currentStatus;

            const subject = `Repair Update: ${repair.repairId} - ${statusLabel}`;
            const body = `Hi ${repair.firstName || repair.customerName},\n\nThis is an update from OnlineFix regarding your repair.\n\nRepair ID: ${repair.repairId}\nDevice: ${repair.brand} ${repair.model}\nStatus: ${statusLabel}\n\nTrack your repair online: ${window.location.origin}/track/?id=${repair.repairId}\n\nThank you for choosing OnlineFix!\nOnlineFix™ - Device Repair Specialists\nPhone: 07940 730537`;

            // Use mailto as fallback (works without EmailJS setup). The
            // address is encoded too, so a "?subject=" inside it cannot set
            // the subject or text.
            safeOpen(`mailto:${mailtoAddress(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
            trackEvent('email_notification_sent', { repair_id: repair.repairId, status: currentStatus });
            showAlert('Email client opened with pre-filled message', 'info');
        }

        // === ANALYTICS PANEL ===
        function renderAnalytics() {
            if (allRepairs.length === 0) return;

            const analyticsData = getAnalyticsRepairs();

            // --- Key metrics ---
            // Average repair time (for completed repairs)
            const completedRepairs = analyticsData.filter(r => r.currentStatus === 'completed' && r.dateReceived);
            let avgDays = '--';
            if (completedRepairs.length > 0) {
                const totalDays = completedRepairs.reduce((sum, r) => {
                    const lastProgress = r.progress?.slice().reverse().find(p => p.status === 'completed');
                    if (lastProgress && r.dateReceived) {
                        const completed = lastProgress.timestamp?.seconds || 0;
                        const received = r.dateReceived.seconds || 0;
                        return sum + (completed - received) / 86400;
                    }
                    return sum;
                }, 0);
                avgDays = Math.round(totalDays / completedRepairs.length * 10) / 10;
            }
            document.getElementById('avg-repair-time').textContent = avgDays;

            // Total estimated revenue
            const totalRev = analyticsData.reduce((sum, r) => sum + (r.estimatedCost || 0), 0);
            document.getElementById('total-revenue').textContent = '£' + totalRev.toLocaleString('en-GB', { minimumFractionDigits: 0 });

            // Completion rate
            const completionRate = analyticsData.length > 0 ? Math.round((completedRepairs.length / analyticsData.length) * 100) : 0;
            document.getElementById('completion-rate').textContent = completionRate + '%';

            // Repairs this month
            const now = new Date();
            const thisMonth = analyticsData.filter(r => {
                if (!r.dateReceived) return false;
                const d = new Date(r.dateReceived.seconds * 1000);
                return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
            }).length;
            document.getElementById('this-month-count').textContent = thisMonth;

            // --- Monthly repairs chart (last 6 months) ---
            renderMonthlyChart();

            // --- Revenue per month chart ---
            renderRevenueChart();

            // --- Device type chart ---
            renderDeviceChart();

            // --- Status distribution ---
            renderStatusChart();
        }

        function renderMonthlyChart() {
            const chart = document.getElementById('monthly-chart');
            const data = getAnalyticsRepairs();
            const months = [];
            const now = new Date();

            for (let i = 5; i >= 0; i--) {
                const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                const count = data.filter(r => {
                    if (!r.dateReceived) return false;
                    const rd = new Date(r.dateReceived.seconds * 1000);
                    return rd.getMonth() === d.getMonth() && rd.getFullYear() === d.getFullYear();
                }).length;
                months.push({
                    label: d.toLocaleDateString('en-GB', { month: 'short' }),
                    value: count
                });
            }

            const maxVal = Math.max(...months.map(m => m.value), 1);
            chart.innerHTML = months.map(m => `
                <div class="bar-group">
                    <div class="bar-value">${m.value}</div>
                    <div class="bar" style="height: ${Math.max((m.value / maxVal) * 100, 3)}%; background: linear-gradient(180deg, var(--accent-cyan), var(--primary-blue));"></div>
                    <div class="bar-label">${m.label}</div>
                </div>
            `).join('');
        }

        function renderRevenueChart() {
            const chart = document.getElementById('revenue-chart');
            const data = getAnalyticsRepairs();
            const months = [];
            const now = new Date();

            for (let i = 5; i >= 0; i--) {
                const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                const revenue = data.filter(r => {
                    if (!r.dateReceived) return false;
                    const rd = new Date(r.dateReceived.seconds * 1000);
                    return rd.getMonth() === d.getMonth() && rd.getFullYear() === d.getFullYear();
                }).reduce((sum, r) => sum + (r.estimatedCost || 0), 0);
                months.push({
                    label: d.toLocaleDateString('en-GB', { month: 'short' }),
                    value: revenue
                });
            }

            const maxVal = Math.max(...months.map(m => m.value), 1);
            chart.innerHTML = months.map(m => `
                <div class="bar-group">
                    <div class="bar-value">£${m.value}</div>
                    <div class="bar" style="height: ${Math.max((m.value / maxVal) * 100, 3)}%; background: linear-gradient(180deg, #34D399, #059669);"></div>
                    <div class="bar-label">${m.label}</div>
                </div>
            `).join('');
        }

        function renderDeviceChart() {
            const chart = document.getElementById('device-chart');
            const data = getAnalyticsRepairs();
            const deviceCounts = {};
            data.forEach(r => {
                const type = r.deviceType || 'Other';
                deviceCounts[type] = (deviceCounts[type] || 0) + 1;
            });

            const sorted = Object.entries(deviceCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);
            const maxVal = sorted.length > 0 ? sorted[0][1] : 1;
            const colors = ['#60A5FA', '#A78BFA', '#FBBF24', '#34D399', '#F87171', '#38BDF8'];

            chart.innerHTML = sorted.map(([type, count], i) => `
                <div class="h-bar-row">
                    <div class="h-bar-label">${escapeHTML(type)}</div>
                    <div class="h-bar-track">
                        <div class="h-bar-fill" style="width: ${(count / maxVal) * 100}%; background: ${colors[i % colors.length]};">
                            <span>${count}</span>
                        </div>
                    </div>
                </div>
            `).join('');
        }

        function renderStatusChart() {
            const chart = document.getElementById('status-chart');
            const data = getAnalyticsRepairs();
            const statusCounts = {};
            data.forEach(r => {
                const status = r.currentStatus || 'received';
                statusCounts[status] = (statusCounts[status] || 0) + 1;
            });

            const statusColors = {
                'received': '#60A5FA',
                'diagnosing': '#FBBF24',
                'waiting-decision': '#F472B6',
                'waiting-parts': '#F87171',
                'in-repair': '#A78BFA',
                'testing': '#38BDF8',
                'ready': '#34D399',
                'completed': '#94A3B8'
            };

            // Visual bar showing proportions
            const total = data.length || 1;
            let barHTML = '<div style="display: flex; border-radius: 8px; overflow: hidden; height: 28px; margin-bottom: 1rem;">';
            Object.entries(statusCounts).forEach(([status, count]) => {
                const pct = (count / total) * 100;
                barHTML += `<div style="width: ${pct}%; background: ${statusColors[status] || '#64748B'};" title="${escapeHTML(statusConfig[status]?.label || status)}: ${count}"></div>`;
            });
            barHTML += '</div>';

            // Legend
            let legendHTML = '<div class="status-distribution">';
            Object.entries(statusCounts).forEach(([status, count]) => {
                legendHTML += `
                    <div class="status-dot-group">
                        <div class="status-dot" style="background: ${statusColors[status] || '#64748B'};"></div>
                        <span class="status-dot-label">${escapeHTML(statusConfig[status]?.label || status)}</span>
                        <span class="status-dot-count">${count}</span>
                    </div>
                `;
            });
            legendHTML += '</div>';

            chart.innerHTML = barHTML + legendHTML;
        }

        // Bulk selection management
        function toggleSelectAll(masterCheckbox) {
            const checkboxes = document.querySelectorAll('.row-checkbox');
            checkboxes.forEach(cb => cb.checked = masterCheckbox.checked);
            updateBulkSelection();
        }

        function updateBulkSelection() {
            const checked = document.querySelectorAll('.row-checkbox:checked');
            const bulkBar = document.getElementById('bulk-actions-bar');
            const countEl = document.getElementById('bulk-selected-count');

            if (checked.length > 0) {
                bulkBar.classList.remove('hidden');
                countEl.textContent = checked.length;
            } else {
                bulkBar.classList.add('hidden');
            }

            // Update master checkbox state
            const allCheckboxes = document.querySelectorAll('.row-checkbox');
            const masterCb = document.getElementById('select-all-checkbox');
            if (masterCb) {
                masterCb.checked = allCheckboxes.length > 0 && checked.length === allCheckboxes.length;
                masterCb.indeterminate = checked.length > 0 && checked.length < allCheckboxes.length;
            }
        }

        function clearBulkSelection() {
            document.querySelectorAll('.row-checkbox').forEach(cb => cb.checked = false);
            const masterCb = document.getElementById('select-all-checkbox');
            if (masterCb) masterCb.checked = false;
            document.getElementById('bulk-actions-bar').classList.add('hidden');
            document.getElementById('bulk-status-select').value = '';
        }

        async function applyBulkStatusUpdate() {
            const newStatus = document.getElementById('bulk-status-select').value;
            if (!newStatus) {
                showAlert('Please select a status first.', 'error');
                return;
            }

            const selectedIds = Array.from(document.querySelectorAll('.row-checkbox:checked'))
                .map(cb => cb.dataset.repairId);

            if (selectedIds.length === 0) return;

            const statusLabel = statusConfig[newStatus]?.label || newStatus;
            if (!confirm(`Update ${selectedIds.length} repair(s) to "${statusLabel}"?`)) return;

            try {
                const batch = db.batch();
                selectedIds.forEach(id => {
                    const ref = db.collection('repairs').doc(id);
                    const progressEntry = {
                        status: newStatus,
                        timestamp: firebase.firestore.Timestamp.now(),
                        // Same reasoning as quickAdvanceStatus: "Bulk status
                        // update to Ready for Collection" was being printed on
                        // every one of these customers' tracking pages.
                        notes: '',
                        technician: currentUser.email,
                        photos: []
                    };
                    batch.update(ref, {
                        currentStatus: newStatus,
                        progress: firebase.firestore.FieldValue.arrayUnion(progressEntry)
                    });
                });

                await batch.commit();
                showAlert(`${selectedIds.length} repair(s) updated to "${statusLabel}"`, 'success');
                clearBulkSelection();
            } catch (error) {
                console.error('Bulk update error:', error);
                showAlert('Error updating repairs: ' + error.message, 'error');
            }
        }

        // CSV Export
        function exportToCSV() {
            const data = getFilteredRepairs();

            if (data.length === 0) {
                showAlert('No repairs to export.', 'info');
                return;
            }

            const csvHeader = ['Repair ID', 'Customer Name', 'Phone', 'Email', 'Device Type', 'Brand', 'Model', 'Issue', 'Status', 'Date Received', 'Est. Completion', 'Est. Cost'];
            const csvRows = data.map(r => [
                r.repairId || '',
                r.customerName || '',
                r.customerPhone || '',
                r.customerEmail || '',
                r.deviceType || '',
                r.brand || '',
                r.model || '',
                r.issueDescription || '',
                statusConfig[r.currentStatus]?.label || r.currentStatus || '',
                r.dateReceived ? new Date(r.dateReceived.seconds * 1000).toLocaleDateString('en-GB') : '',
                r.estimatedCompletion ? new Date(r.estimatedCompletion.seconds * 1000).toLocaleDateString('en-GB') : '',
                r.estimatedCost ? `£${r.estimatedCost}` : ''
            ]);

            /* Two separate problems with writing a cell as "…".

               Quoting: only the fault description used to have its quotes
               doubled, so a customer name or model containing a double quote
               ended the cell early and shifted the rest of the row into the
               wrong columns.

               Formulas: a spreadsheet reads a cell opening with = + - or @
               as a formula, quotes or not. A fault description typed as
               =HYPERLINK(...) becomes a live formula in Excel the moment the
               export is opened, which is how an ordinary-looking export
               turns into something that acts on its own. Prefixing a single
               quote makes the spreadsheet treat it as text; the leading
               quote is not shown in the cell. */
            const csvCell = (value) => {
                const text = String(value === null || value === undefined ? '' : value);
                const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
                return `"${safe.replace(/"/g, '""')}"`;
            };

            const csvContent = [csvHeader, ...csvRows]
                .map(row => row.map(csvCell).join(','))
                .join('\r\n');

            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            const dateStr = new Date().toISOString().split('T')[0];
            link.download = `onlinefix-repairs-${dateStr}.csv`;
            link.click();
            URL.revokeObjectURL(link.href);

            showAlert(`Exported ${data.length} repairs to CSV`, 'success');
        }

        // Delete repair
        async function deleteRepair(repairId, repairIdNumber) {
            const booked = allRepairs.find(r => r.id === repairId);
            const bookingId = booked && booked.bookingId;
            const bookingNote = bookingId ? ' It came from an online booking, which goes back on the Online Bookings board.' : '';
            if (confirm(`Are you sure you want to delete repair ${repairIdNumber}? This action cannot be undone.${bookingNote}`)) {
                try {
                    // Delete from Firestore
                    await db.collection('repairs').doc(repairId).delete();

                    // A job booked in from an online booking hands the booking
                    // back, so it is not left marked as booked in to a job that
                    // no longer exists. Only if it still points at this job.
                    if (bookingId) {
                        try {
                            const bookingRef = db.collection('bookings').doc(bookingId);
                            await db.runTransaction(async (tx) => {
                                const fresh = await tx.get(bookingRef);
                                if (!fresh.exists || fresh.data().linkedRepairId !== repairId) return;
                                tx.update(bookingRef, {
                                    status: 'confirmed',
                                    linkedRepairId: null,
                                    repairCode: firebase.firestore.FieldValue.delete(),
                                    bookedInAt: firebase.firestore.FieldValue.delete(),
                                    bookedInBy: firebase.firestore.FieldValue.delete(),
                                    updatedAt: firebase.firestore.Timestamp.now(),
                                    updatedBy: currentUser ? currentUser.email : 'unknown'
                                });
                            });
                        } catch (error) {
                            console.warn('Booking not handed back:', error);
                        }
                    }

                    // And the customer's tracking page for it. After the
                    // ticket, so the dashboard's sync has nothing left to
                    // publish it again from.
                    if (window.OnlineFixTracking && OnlineFixTracking.isCode(repairIdNumber)) {
                        try {
                            await db.collection(OnlineFixTracking.COLLECTION).doc(repairIdNumber).delete();
                        } catch (error) {
                            console.warn('Tracking copy not deleted:', error);
                        }
                    }

                    // Delete photos from Storage if any
                    const repair = allRepairs.find(r => r.id === repairId);
                    if (repair && repair.photos && repair.photos.length > 0) {
                        // Note: You might want to delete photos from storage here
                        // This requires parsing the photo URLs to get the storage paths
                    }

                    showAlert(`Repair ${repairIdNumber} deleted successfully!`, 'success');

                    // Reload data
                    loadDashboardData();

                } catch (error) {
                    console.error('Error deleting repair:', error);
                    showAlert('Error deleting repair: ' + error.message, 'error');
                }
            }
        }

        // === BUTTON WIRING ===
        // Buttons and fields name what they do in data-do-<event>="name"
        // (data-do-click, data-do-change, ...) and this table holds the code,
        // in place of the onclick="" attributes they used to carry. Each
        // action gets the event and the element it is on (what "this" was).
        // Values go in data-* attributes, escaped with escapeHTML.
        const ACTIONS = {
            // Page furniture
            toggleSidebar: () => toggleSidebar(),
            logout: () => logout(),
            toggleKeyboardHelp: () => document.getElementById('kbd-panel').classList.toggle('hidden'),
            dismissToast: (e, el) => dismissToast(el.parentElement),
            closeModal: (e, el) => el.closest('.modal').remove(),

            // All Repairs list
            showOverdueRepairs: () => {
                showSection('repairs');
                document.getElementById('status-filter').value = '';
                document.getElementById('common-repair-filter').value = '';
                loadAllRepairs();
            },
            loadAllRepairs: () => loadAllRepairs(),
            clearRepairSearch: (e, el) => {
                document.getElementById('repair-search').value = '';
                el.style.display = 'none';
                loadAllRepairs();
            },
            toggleRepairFilters: () => toggleRepairFilters(),
            exportToCSV: () => exportToCSV(),
            applyBulkStatusUpdate: () => applyBulkStatusUpdate(),
            clearBulkSelection: () => clearBulkSelection(),
            toggleSelectAll: (e, el) => toggleSelectAll(el),
            updateBulkSelection: () => updateBulkSelection(),
            goToPage: (e, el) => goToPage(Number(el.dataset.page)),
            quickAdvanceStatus: (e, el) => quickAdvanceStatus(el.dataset.id, e),
            showCustomerHistory: (e, el) => showCustomerHistory(el.dataset.customer, e),

            // One job
            viewRepair: (e, el) => viewRepair(el.dataset.id),
            viewRepairOnKey: (e, el) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    viewRepair(el.dataset.id);
                }
            },
            editRepair: (e, el) => editRepair(el.dataset.id),
            editCustomer: (e, el) => editCustomer(el.dataset.id),
            editRepairAndClose: (e, el) => {
                editRepair(el.dataset.id);
                el.closest('.modal').remove();
            },
            editCustomerAndClose: (e, el) => {
                editCustomer(el.dataset.id);
                el.closest('.modal').remove();
            },
            closeAndEditRepair: (e, el) => {
                el.closest('.modal').remove();
                editRepair(el.dataset.id);
            },
            openTrackingLink: (e, el) => openTrackingLink(el.dataset.repairId),
            reprintLabel: (e, el) => reprintLabel(el.dataset.id),
            generateInvoice: (e, el) => generateInvoice(el.dataset.id),
            deleteRepair: (e, el) => deleteRepair(el.dataset.id, el.dataset.repairId),
            removeProgressEntry: (e, el) => removeProgressEntry(el.dataset.id, Number(el.dataset.index)),
            openPhoto: (e, el) => safeOpen(el.dataset.url),
            resendTrackingEmail: (e, el) => resendTrackingEmail(el.dataset.id, el),

            // Update box
            showTemplates: (e, el) => showTemplates(el.value),
            pickUpdatePhotos: () => document.getElementById('update-photo-input').click(),
            handleUpdatePhotos: (e) => handleUpdatePhotos(e),
            removeUpdatePhoto: (e, el) => removeUpdatePhoto(el.dataset.photoId),
            sendWhatsApp: (e, el) => sendWhatsApp(el.dataset.id),
            sendEmailUpdate: (e, el) => sendEmailUpdate(el.dataset.id),

            // Workflow board: drag a card to another column
            kanbanDragStart: (e, el) => {
                e.dataTransfer.setData('text/plain', el.dataset.id);
                el.classList.add('dragging');
            },
            kanbanDragEnd: (e, el) => el.classList.remove('dragging'),
            kanbanDragOver: (e, el) => {
                e.preventDefault();
                el.classList.add('drag-over');
            },
            kanbanDragLeave: (e, el) => el.classList.remove('drag-over'),
            kanbanDrop: (e, el) => handleKanbanDrop(e, el.dataset.status),

            // Analytics date range
            setAnalyticsRange: (e, el) => setAnalyticsRange(el.dataset.range, el),
            setAnalyticsRangeCustom: () => setAnalyticsRange('custom', null)
        };

        // The listener goes on the element itself, as onclick="" did, so
        // events run in the same order and stopPropagation() still keeps a
        // click on a row's button from opening the row. Elements added later
        // (modals, table rows, board cards) are wired by the observer as soon
        // as they appear, before anyone can click them.
        const ACTION_EVENTS = ['click', 'change', 'input', 'keydown', 'dragstart', 'dragend', 'dragover', 'dragleave', 'drop'];
        const ACTION_SELECTOR = ACTION_EVENTS.map(type => `[data-do-${type}]`).join(',');
        const wiredActions = new WeakMap();

        function wireActions(el) {
            let wired = wiredActions.get(el);
            for (const type of ACTION_EVENTS) {
                if (!el.hasAttribute('data-do-' + type) || (wired && wired.has(type))) continue;
                el.addEventListener(type, (e) => {
                    const name = el.getAttribute('data-do-' + type);
                    const action = ACTIONS[name];
                    if (action) action(e, el);
                    else if (name) console.warn('No dashboard action called', name);
                });
                if (!wired) { wired = new Set(); wiredActions.set(el, wired); }
                wired.add(type);
            }
        }

        function wireActionsIn(node) {
            if (node.nodeType !== Node.ELEMENT_NODE) return;
            if (node.matches(ACTION_SELECTOR)) wireActions(node);
            node.querySelectorAll(ACTION_SELECTOR).forEach(wireActions);
        }

        wireActionsIn(document.body);
        new MutationObserver((records) => {
            for (const record of records) record.addedNodes.forEach(wireActionsIn);
        }).observe(document.body, { childList: true, subtree: true });
