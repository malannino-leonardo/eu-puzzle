/**
 * supabase-client.js
 *
 * Supabase integration: auth (magic-link), profiles, and leaderboard.
 *
 * REQUIRES (loaded before this script in HTML):
 *   1. https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js
 *   2. scripts/supabase-config.js  (gitignored — see supabase-config.example.js)
 *
 * Exposes:
 *   window.SupabaseClient   — public API object
 *   window.initLeaderboardSubmit(difficulty, elapsedMs)  — called by app.js
 */

(function () {
    'use strict';

    /* ------------------------------------------------------------------ */
    /*  Client initialisation                                              */
    /* ------------------------------------------------------------------ */

    let db = null;

    if (
        window.SUPABASE_URL &&
        window.SUPABASE_ANON_KEY &&
        window.SUPABASE_URL !== 'https://your-project-id.supabase.co' &&
        window.supabase
    ) {
        try {
            db = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, {
                auth: {
                    // Replace the Web Locks API with a no-op to prevent the
                    // "lock not released within 5000ms" stall on live-reload.
                    // The lock serialises token refreshes; without it, concurrent
                    // refreshes are possible but harmless for a single-user game.
                    lock: (_name, _timeout, fn) => fn()
                }
            });
        } catch (e) {
            console.warn('[SupabaseClient] Failed to initialise:', e);
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Helpers                                                            */
    /* ------------------------------------------------------------------ */

    function escHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function t(key, vars) {
        return window.i18n ? window.i18n.t(key, vars) : key;
    }

    const DIFFICULTIES = ['easy', 'medium', 'hard'];

    function getAuthErrorMessage(error) {
        const status = Number(error && error.status);
        const raw = String(
            (error && (error.message || error.error_description || error.code)) || ''
        ).toLowerCase();

        if (status === 429 || raw.includes('rate') || raw.includes('too many')) {
            return t('auth.magicLinkRateLimit');
        }

        if (
            status >= 500 ||
            raw.includes('failed to fetch') ||
            raw.includes('network') ||
            raw.includes('timeout') ||
            raw.includes('internal')
        ) {
            return t('auth.magicLinkTemporaryError');
        }

        return t('auth.magicLinkGenericError');
    }

    function getLeaderboardResultMessage(result) {
        const rankNum = Number(result && result.rank);
        const hasRank = Number.isFinite(rankNum) && rankNum > 0;

        if (result && result.improved) {
            return hasRank
                ? t('stats.submittedWithRank', { rank: rankNum })
                : t('stats.submitted');
        }

        return hasRank
            ? t('stats.notImprovedWithRank', { rank: rankNum })
            : t('stats.notImproved');
    }

    function getLocalBestTime(diff) {
        const raw = localStorage.getItem('bestTime_' + diff);
        if (!raw) return null;
        const parsed = parseInt(raw, 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }

    function setLocalBestTime(diff, timeMs) {
        if (!Number.isFinite(timeMs) || timeMs <= 0) return;
        localStorage.setItem('bestTime_' + diff, String(Math.floor(timeMs)));
    }

    /* ------------------------------------------------------------------ */
    /*  Guest identity                                                     */
    /* ------------------------------------------------------------------ */

    function getGuestIdentity() {
        try {
            const stored = localStorage.getItem('guestIdentity');
            if (stored) {
                const parsed = JSON.parse(stored);
                if (parsed && parsed.id && parsed.name) return parsed;
            }
        } catch (_) {}

        const id   = crypto.randomUUID();
        const num  = String(Math.floor(1000 + Math.random() * 9000));
        const name = 'Guest_' + num;
        const identity = { id, name };
        try { localStorage.setItem('guestIdentity', JSON.stringify(identity)); } catch (_) {}
        return identity;
    }

    /* ------------------------------------------------------------------ */
    /*  Auth                                                               */
    /* ------------------------------------------------------------------ */

    /** Reject a promise after ms milliseconds */
    function withTimeout(promise, ms) {
        const timer = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), ms)
        );
        return Promise.race([promise, timer]);
    }

    async function getCurrentUser() {
        if (!db) return null;
        try {
            const { data: { user } } = await withTimeout(db.auth.getUser(), 10000);
            return user || null;
        } catch (_) { return null; }
    }

    async function signInWithMagicLink(email) {
        if (!db) {
            const error = { message: 'Supabase not configured' };
            return { error, message: getAuthErrorMessage(error) };
        }

        const baseRedirect = window.location.href.split('?')[0].split('#')[0];
        const preferredLang = (
            (window.i18n && window.i18n.currentLang) ||
            (document.documentElement.lang || 'en')
        ).slice(0, 2).toLowerCase();

        let redirectTo = baseRedirect;
        try {
            const redirectUrl = new URL(baseRedirect, window.location.origin);
            redirectUrl.searchParams.set('lang', preferredLang);
            redirectTo = redirectUrl.toString();
        } catch (_) {}

        const { error } = await db.auth.signInWithOtp({
            email,
            options: {
                emailRedirectTo: redirectTo,
                data: { preferred_lang: preferredLang }
            }
        });
        return { error, message: error ? getAuthErrorMessage(error) : null };
    }

    async function signOut() {
        if (!db) return;
        await db.auth.signOut();
    }

    function onAuthStateChange(callback) {
        if (!db) return () => {};
        const { data: { subscription } } = db.auth.onAuthStateChange(callback);
        return () => subscription.unsubscribe();
    }

    /* ------------------------------------------------------------------ */
    /*  Profiles                                                           */
    /* ------------------------------------------------------------------ */

    async function getProfile(userId) {
        if (!db || !userId) return null;
        try {
            const { data, error } = await withTimeout(db
                .from('profiles')
                .select('id, username, player_country')
                .eq('id', userId)
                .maybeSingle(), 10000);
            if (error) return null;
            return data;
        } catch (_) { return null; }
    }

    async function upsertProfile(userId, username, playerCountry) {
        if (!db) return { error: { message: 'Supabase not configured' } };
        const { data, error } = await db
            .from('profiles')
            .upsert(
                { id: userId, username: username.trim(), player_country: playerCountry || null },
                { onConflict: 'id' }
            );
        return { data, error };
    }

    async function isUsernameTaken(username) {
        if (!db) return false;
        try {
            const { data } = await db
                .from('profiles')
                .select('id')
                .ilike('username', username.trim())
                .maybeSingle();
            return data !== null;
        } catch (_) { return false; }
    }

    /* ------------------------------------------------------------------ */
    /*  Leaderboard                                                        */
    /* ------------------------------------------------------------------ */

    /**
     * Submit a score via the upsert_score DB function.
     * Returns { improved, rank } or { improved: false, rank: null, error }
     */
    async function submitScore(difficulty, timeMs) {
        if (!db) return { improved: false, rank: null, error: 'not_configured' };

        const user = await getCurrentUser();
        let userId       = null;
        let guestId      = null;
        let displayName  = '';
        let playerCountry = null;

        if (user) {
            const profile  = await getProfile(user.id);
            displayName    = profile?.username || user.email.split('@')[0];
            playerCountry  = profile?.player_country || null;
            userId         = user.id;
        } else {
            const guest   = getGuestIdentity();
            displayName   = guest.name;
            guestId       = guest.id;
        }

        try {
            const { data, error } = await withTimeout(db.rpc('upsert_score', {
                p_user_id:        userId,
                p_guest_id:       guestId,
                p_display_name:   displayName,
                p_player_country: playerCountry,
                p_difficulty:     difficulty,
                p_time_ms:        timeMs
            }), 15000);
            if (error) {
                console.error('[SupabaseClient] upsert_score error:', error);
                return { improved: false, rank: null, error };
            }
            return data; // { improved, rank }
        } catch (e) {
            console.error('[SupabaseClient] submitScore failed:', e);
            return { improved: false, rank: null, error: e };
        }
    }

    /**
     * Fetch leaderboard rows.
     * Returns array of { display_name, player_country, time_ms, created_at }
     */
    async function fetchLeaderboard(difficulty, limit, offset) {
        if (!db) return [];
        limit  = limit  || 50;
        offset = offset || 0;
        try {
            const { data, error } = await withTimeout(db
                .from('leaderboard')
                .select('display_name, player_country, time_ms, created_at')
                .eq('difficulty', difficulty)
                .order('time_ms', { ascending: true })
                .range(offset, offset + limit - 1), 12000);
            if (error) return [];
            return data || [];
        } catch (_) { return []; }
    }

    async function fetchUserBestTimes(userId) {
        if (!db || !userId) return {};
        try {
            const { data, error } = await withTimeout(db
                .from('leaderboard')
                .select('difficulty, time_ms')
                .eq('user_id', userId), 12000);
            if (error || !Array.isArray(data)) return {};

            const bests = {};
            data.forEach(row => {
                if (!row || !DIFFICULTIES.includes(row.difficulty)) return;
                const current = bests[row.difficulty];
                if (current === undefined || row.time_ms < current) {
                    bests[row.difficulty] = row.time_ms;
                }
            });
            return bests;
        } catch (_) {
            return {};
        }
    }

    async function syncPersonalBestsForCurrentUser() {
        if (!db) return { synced: false, reason: 'not_configured' };

        const user = await getCurrentUser();
        if (!user) return { synced: false, reason: 'not_logged_in' };

        const remoteBests = await fetchUserBestTimes(user.id);

        for (const diff of DIFFICULTIES) {
            const localBest = getLocalBestTime(diff);
            const remoteBest = Number.isFinite(remoteBests[diff]) ? remoteBests[diff] : null;

            if (remoteBest !== null && (localBest === null || remoteBest < localBest)) {
                setLocalBestTime(diff, remoteBest);
            }

            if (localBest !== null && (remoteBest === null || localBest < remoteBest)) {
                await submitScore(diff, localBest);
            }
        }

        const bests = {};
        DIFFICULTIES.forEach(diff => {
            bests[diff] = getLocalBestTime(diff);
        });

        document.dispatchEvent(new CustomEvent('personalbestsynced', { detail: bests }));
        return { synced: true, bests };
    }

    async function deleteCurrentUser() {
        if (!db) return { error: { message: 'Supabase not configured' } };

        const user = await getCurrentUser();
        if (!user) return { error: { message: 'No user is currently signed in' } };

        try {
            const { error } = await withTimeout(db.rpc('delete_my_account'), 15000);
            if (error) {
                return { error };
            }

            await db.auth.signOut();
            return { error: null };
        } catch (e) {
            return { error: e };
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Completion Overlay Widget  (called by app.js)                     */
    /* ------------------------------------------------------------------ */

    /**
     * Render a leaderboard submit widget inside #leaderboard-submit-widget.
     * Called by showCompletionOverlay() in app.js.
     */
    window.initLeaderboardSubmit = async function (difficulty, elapsedMs) {
        const container = document.getElementById('leaderboard-submit-widget');
        if (!container) return;

        if (!db) {
            container.innerHTML = '';
            return;
        }

        container.innerHTML = '<div class="lb-widget lb-loading"><span class="lb-spinner"></span></div>';

        const user = await getCurrentUser();

        if (user) {
            const profile = await getProfile(user.id);
            if (!profile) {
                container.innerHTML = _renderUsernameSetup();
                _attachWidgetListeners(container, difficulty, elapsedMs);
            } else {
                container.innerHTML = _renderAutoSubmitting(profile.username);
                const result = await submitScore(difficulty, elapsedMs);
                container.innerHTML = result.error ? _renderError(result.error) : _renderResult(result);
            }
        } else {
            const guest = getGuestIdentity();
            container.innerHTML = _renderAutoSubmitting(guest.name);
            const result = await submitScore(difficulty, elapsedMs);
            container.innerHTML = result.error ? _renderError(result.error) : _renderGuestResult(result);
        }

        _attachWidgetListeners(container, difficulty, elapsedMs);
    };

    /* --- widget templates --- */

    function _renderAutoSubmitting(username) {
        return `<div class="lb-widget">
            <span class="lb-result-msg">${escHtml(t('stats.submitting'))}</span>
            <span class="lb-as">${escHtml(t('stats.asUser', { name: username }))}</span>
            <a href="stats.html#global" class="lb-link">${escHtml(t('stats.viewLeaderboard'))}</a>
        </div>`;
    }

    function _renderGuestResult(result) {
        const msg = getLeaderboardResultMessage(result);
        const cls = result.improved ? 'lb-success' : 'lb-neutral';
        return `<div class="lb-widget ${cls}">
            <span class="lb-result-msg">${escHtml(msg)}</span>
            <a href="stats.html#global" class="lb-link">${escHtml(t('stats.viewLeaderboard'))}</a>
            <a href="login.html?ref=game" class="lb-btn lb-btn-ghost">${escHtml(t('auth.signInForRecord'))}</a>
        </div>`;
    }

    function _renderUsernameSetup() {
        return `<div class="lb-widget lb-setup">
            <p class="lb-setup-label">${escHtml(t('auth.setUsername'))}</p>
            <input type="text" id="lb-username-input" class="lb-input"
                placeholder="${escHtml(t('auth.usernamePlaceholder'))}" maxlength="30" autocomplete="off">
            <button class="lb-btn lb-btn-primary" data-action="setup-submit">${escHtml(t('auth.saveAndSubmit'))}</button>
        </div>`;
    }

    function _renderResult(result) {
        const msg = getLeaderboardResultMessage(result);
        const cls = result.improved ? 'lb-success' : 'lb-neutral';
        return `<div class="lb-widget ${cls}">
            <span class="lb-result-msg">${escHtml(msg)}</span>
            <a href="stats.html#global" class="lb-link">${escHtml(t('stats.viewLeaderboard'))}</a>
        </div>`;
    }

    function _renderError(err) {
        const msg = (err && err.message) ? err.message : String(err);
        return `<div class="lb-widget lb-error"><span>${escHtml(t('stats.submitError'))}: ${escHtml(msg)}</span></div>`;
    }

    /* --- event wiring --- */

    function _attachWidgetListeners(container, difficulty, elapsedMs) {
        container.addEventListener('click', async function handler(e) {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;
            const action = btn.dataset.action;

            if (action === 'setup-submit') {
                const input = container.querySelector('#lb-username-input');
                if (!input || !input.value.trim()) return;
                const username = input.value.trim();
                btn.disabled = true;
                btn.textContent = t('auth.saving');

                const taken = await isUsernameTaken(username);
                if (taken) {
                    btn.disabled = false;
                    btn.textContent = t('auth.saveAndSubmit');
                    input.value = '';
                    input.placeholder = t('auth.usernameTaken');
                    return;
                }

                const user = await getCurrentUser();
                if (!user) {
                    container.removeEventListener('click', handler);
                    container.innerHTML = _renderLoginForm();
                    _attachWidgetListeners(container, difficulty, elapsedMs);
                    return;
                }

                await upsertProfile(user.id, username, null);
                const result = await submitScore(difficulty, elapsedMs);
                container.removeEventListener('click', handler);
                container.innerHTML = result.error ? _renderError(result.error) : _renderResult(result);
            }
        });
    }

    if (db) {
        getCurrentUser().then(user => {
            if (user) syncPersonalBestsForCurrentUser();
        });

        onAuthStateChange((event) => {
            if (event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'TOKEN_REFRESHED') {
                syncPersonalBestsForCurrentUser();
            }
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Public API                                                         */
    /* ------------------------------------------------------------------ */

    window.SupabaseClient = {
        isConfigured:        () => db !== null,
        getGuestIdentity,
        getCurrentUser,
        signInWithMagicLink,
        getAuthErrorMessage,
        signOut,
        onAuthStateChange,
        getProfile,
        upsertProfile,
        isUsernameTaken,
        fetchUserBestTimes,
        syncPersonalBestsForCurrentUser,
        deleteCurrentUser,
        submitScore,
        fetchLeaderboard
    };

})();
