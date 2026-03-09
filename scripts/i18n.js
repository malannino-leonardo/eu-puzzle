/**
 * =====================================================
 * i18n — Internationalisation module
 * Supported languages: Italian (it), English (en)
 * =====================================================
 */
(function () {
    'use strict';

    const SUPPORTED_LANGS = ['it', 'en'];
    const DEFAULT_LANG    = 'it';

    const FLAG_MAP = {
        it: 'assets/flags/ITA_landscape.svg',
        en: 'assets/flags/UK_landscape.svg'
    };

    const i18n = {
        currentLang: DEFAULT_LANG,
        translations: {},

        /**
         * Resolve a dot-path key with optional {var} substitutions.
         * Returns the key itself if no translation is found.
         */
        t(key, vars) {
            const parts = key.split('.');
            let val = this.translations;
            for (const p of parts) {
                if (val && typeof val === 'object') { val = val[p]; }
                else { val = undefined; break; }
            }
            if (typeof val !== 'string') return key;
            if (vars) {
                return val.replace(/\{(\w+)\}/g, (_, k) =>
                    vars[k] !== undefined ? vars[k] : '{' + k + '}'
                );
            }
            return val;
        },

        /** Load and apply a language; save choice to localStorage */
        async setLanguage(lang) {
            if (!SUPPORTED_LANGS.includes(lang)) return;
            this.currentLang = lang;
            try { localStorage.setItem('appLanguage', lang); } catch (_) {}
            await this._load(lang);
            this._applyAll();
            this._updateDropdowns();
            document.dispatchEvent(
                new CustomEvent('languagechange', { detail: { lang } })
            );
        },

        /** Fetch translation JSON for the given language code */
        async _load(lang) {
            try {
                const resp = await fetch('data/i18n/' + lang + '.json');
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                this.translations = await resp.json();
            } catch (e) {
                console.warn('[i18n] Could not load translations for', lang, e);
                this.translations = {};
            }
        },

        /** Apply data-i18n* attributes across the whole document */
        _applyAll() {
            // Plain text
            document.querySelectorAll('[data-i18n]').forEach(el => {
                el.textContent = this.t(el.dataset.i18n);
            });
            // Inner HTML (allows <kbd>, <em>, <br> etc.)
            document.querySelectorAll('[data-i18n-html]').forEach(el => {
                el.innerHTML = this.t(el.dataset.i18nHtml);
            });
            // aria-label
            document.querySelectorAll('[data-i18n-aria]').forEach(el => {
                el.setAttribute('aria-label', this.t(el.dataset.i18nAria));
            });
            // placeholder
            document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
                el.placeholder = this.t(el.dataset.i18nPlaceholder);
            });
            // Update <html lang="...">
            document.documentElement.lang = this.currentLang;
            // Update loading text if visible
            const loadingText = document.querySelector('.loading-text');
            if (loadingText) loadingText.textContent = this.t('loading.map');
        },

        /** Sync all .lang-selector widgets to the current language */
        _updateDropdowns() {
            document.querySelectorAll('.lang-selector').forEach(selector => {
                const img  = selector.querySelector('.lang-flag-current');
                const span = selector.querySelector('.lang-code-current');
                if (img)  img.src = FLAG_MAP[this.currentLang] || '';
                if (span) span.textContent = this.currentLang.toUpperCase();
                selector.querySelectorAll('.lang-option').forEach(opt => {
                    opt.classList.toggle('active', opt.dataset.lang === this.currentLang);
                    opt.setAttribute('aria-selected', opt.dataset.lang === this.currentLang);
                });
            });
        }
    };

    window.i18n = i18n;

    // ---- Bootstrap ----

    function _init() {
        let saved;
        try { saved = localStorage.getItem('appLanguage'); } catch (_) {}
        const lang = (saved && SUPPORTED_LANGS.includes(saved)) ? saved : DEFAULT_LANG;
        i18n.currentLang = lang;
        const ready = i18n._load(lang).then(() => {
            i18n._applyAll();
            i18n._updateDropdowns();
        });
        window.i18nReady = ready;
        return ready;
    }

    // Attach dropdown behaviour (idempotent — safe to call multiple times)
    function _bindDropdowns() {
        document.querySelectorAll('.lang-selector').forEach(selector => {
            if (selector.dataset.i18nBound) return;
            selector.dataset.i18nBound = '1';

            const btn      = selector.querySelector('.lang-btn');
            const dropdown = selector.querySelector('.lang-dropdown');
            if (!btn || !dropdown) return;

            btn.addEventListener('click', e => {
                e.stopPropagation();
                const isOpen = dropdown.classList.contains('open');
                // Close all other open dropdowns
                document.querySelectorAll('.lang-dropdown.open').forEach(d => {
                    if (d !== dropdown) d.classList.remove('open');
                });
                dropdown.classList.toggle('open', !isOpen);
            });

            dropdown.querySelectorAll('.lang-option').forEach(opt => {
                opt.addEventListener('click', async () => {
                    await i18n.setLanguage(opt.dataset.lang);
                    dropdown.classList.remove('open');
                });
            });
        });

        // Close on outside click
        document.addEventListener('click', () => {
            document.querySelectorAll('.lang-dropdown.open').forEach(d =>
                d.classList.remove('open')
            );
        }, { capture: false });
    }

    if (document.readyState === 'loading') {
        window.i18nReady = new Promise(resolve => {
            document.addEventListener('DOMContentLoaded', () => {
                _init().then(resolve);
                _bindDropdowns();
            });
        });
    } else {
        window.i18nReady = _init();
        _bindDropdowns();
    }
})();
