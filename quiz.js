(function () {
    'use strict';

    const CATEGORY_ORDER = ['whatIsEu', 'howEuWorks', 'euInDailyLife', 'euAgenda'];

    const CATEGORY_STYLES = {
        whatIsEu: { ticketClass: 'quiz-ticket-what', themeClass: 'quiz-theme-what' },
        howEuWorks: { ticketClass: 'quiz-ticket-how', themeClass: 'quiz-theme-how' },
        euInDailyLife: { ticketClass: 'quiz-ticket-life', themeClass: 'quiz-theme-life' },
        euAgenda: { ticketClass: 'quiz-ticket-agenda', themeClass: 'quiz-theme-agenda' }
    };

    const CATEGORY_FOLDERS = {
        whatIsEu: 'what-is-eu',
        howEuWorks: 'how-eu-works',
        euInDailyLife: 'eu-daily-life',
        euAgenda: 'eu-agenda'
    };

    const state = {
        categoryKey: null,
        sessionQuestions: [],
        userAnswers: [],
        reviewVisible: false,
        currentIndex: 0,
        score: 0,
        answered: false,
        selectedAnswer: -1,
        pendingFinishTimeoutId: null,
        resultCommitted: false,
        categoryRenderToken: 0,
        stats: null,
        userId: null,
        isAccountSynced: false
    };

    const QUIZ_STATS_KEY = 'quizStatsV1';

    function t(key, vars) {
        return (window.i18n && typeof window.i18n.t === 'function') ? window.i18n.t(key, vars) : key;
    }

    function getQuizConfig() {
        const quiz = window.i18n && window.i18n.translations ? window.i18n.translations.quiz : null;
        return quiz && typeof quiz === 'object' ? quiz : {};
    }

    function getCategoryTitle(categoryKey) {
        return t('quiz.categories.' + categoryKey + '.title');
    }

    function getCategoryDescription(categoryKey) {
        return t('quiz.categories.' + categoryKey + '.description');
    }

    function getQuestions(categoryKey) {
        const quiz = getQuizConfig();
        const list = quiz.questions && quiz.questions[categoryKey];
        return Array.isArray(list) ? list : [];
    }

    function ensureQuestionCount(categoryKey) {
        const questions = getQuestions(categoryKey);
        return questions.slice(0, 10);
    }

    function buildSourceKey(categoryKey, index) {
        const safeCategory = String(categoryKey || '').trim();
        const safeIndex = Number(index) + 1;
        if (!safeCategory || !Number.isFinite(safeIndex) || safeIndex <= 0) return '';
        return safeCategory + '.q' + String(safeIndex).padStart(2, '0');
    }

    function shuffleArray(list) {
        const out = Array.isArray(list) ? list.slice() : [];
        for (let i = out.length - 1; i > 0; i -= 1) {
            const j = Math.floor(Math.random() * (i + 1));
            const tmp = out[i];
            out[i] = out[j];
            out[j] = tmp;
        }
        return out;
    }

    function buildSessionQuestions(categoryKey) {
        const baseQuestions = ensureQuestionCount(categoryKey).map((question, index) => ({
            question,
            sourceKey: buildSourceKey(categoryKey, index)
        }));
        return shuffleArray(baseQuestions).map((entry) => {
            const question = entry && entry.question ? entry.question : {};
            const options = Array.isArray(question && question.options) ? question.options.slice() : [];
            const answerIndex = Number(question && question.answer);
            const safeAnswerIndex = Number.isInteger(answerIndex) && answerIndex >= 0 && answerIndex < options.length
                ? answerIndex
                : 0;

            const optionEntries = options.map((text, idx) => ({
                text,
                originalIndex: idx,
                isCorrect: idx === safeAnswerIndex
            }));
            const shuffledOptions = shuffleArray(optionEntries);
            const shuffledAnswerIndex = shuffledOptions.findIndex((entry) => entry.isCorrect);

            return {
                ...question,
                sourceKey: entry && entry.sourceKey ? entry.sourceKey : '',
                optionOrder: shuffledOptions.map((item) => item.originalIndex),
                options: shuffledOptions.map((entry) => entry.text),
                answer: shuffledAnswerIndex >= 0 ? shuffledAnswerIndex : 0
            };
        });
    }

    function getInlineQuestionSource(question) {
        if (!question || typeof question !== 'object') return null;

        const objectSource = question.source && typeof question.source === 'object'
            ? {
                url: typeof question.source.url === 'string' ? question.source.url : '',
                label: typeof question.source.label === 'string' ? question.source.label : ''
            }
            : null;

        const rawUrl = objectSource && objectSource.url
            ? objectSource.url
            : (question.sourceUrl || question.referenceUrl || question.link || (typeof question.source === 'string' ? question.source : ''));
        const rawLabel = objectSource && objectSource.label
            ? objectSource.label
            : (question.sourceLabel || question.sourceTitle || question.reference || '');

        if (!rawUrl && !rawLabel) return null;
        return { url: rawUrl, label: rawLabel };
    }

    function getQuestionIndexFromSourceKey(sourceKey) {
        const match = String(sourceKey || '').match(/^.+\.q(\d{2})$/i);
        if (!match) return -1;
        const index = Number(match[1]) - 1;
        if (!Number.isInteger(index) || index < 0) return -1;
        return index;
    }

    function readGameSettings() {
        try {
            return JSON.parse(localStorage.getItem('gameSettings') || '{}') || {};
        } catch (_) {
            return {};
        }
    }

    function writeGameSettingsPatch(patch) {
        try {
            const current = readGameSettings();
            localStorage.setItem('gameSettings', JSON.stringify({ ...current, ...patch }));
        } catch (_) {}
    }

    function applyFontSizeSetting(fontSize) {
        const allowed = new Set(['small', 'medium', 'large', 'xlarge']);
        const safeSize = allowed.has(fontSize) ? fontSize : 'medium';
        document.documentElement.setAttribute('data-font-size', safeSize);
    }

    const DEFAULT_AUDIO_SETTINGS = {
        masterVolume: 0.8,
        masterMuted: false,
        sfxVolume: 0.8,
        sfxMuted: false,
        musicVolume: 0.3,
        musicMuted: false,
        musicEnabled: true
    };

    function readAudioSettings() {
        try {
            const parsed = JSON.parse(localStorage.getItem('audioSettings') || '{}') || {};
            return { ...DEFAULT_AUDIO_SETTINGS, ...parsed };
        } catch (_) {
            return { ...DEFAULT_AUDIO_SETTINGS };
        }
    }

    const quizAudio = {
        settings: { ...DEFAULT_AUDIO_SETTINGS },
        correctSound: null,
        wrongSound: null,
        music: {
            tracks: [
                'assets/soundtracks/soundtrack1.mp3',
                'assets/soundtracks/soundtrack2.mp3',
                'assets/soundtracks/soundtrack3.mp3',
                'assets/soundtracks/soundtrack4.mp3'
            ],
            order: [],
            index: 0,
            current: null
        },

        init() {
            this._loadSettings();
            this.correctSound = new Audio('assets/sound-effects/correct.mp3');
            this.correctSound.preload = 'auto';
            this.wrongSound = new Audio('assets/sound-effects/wrong.mp3');
            this.wrongSound.preload = 'auto';
            this._shuffleTracks();
            this._applyMusicVolume();
        },

        _effectiveVolume(category) {
            const s = this.settings;
            if (s.masterMuted) return 0;
            const master = s.masterVolume;
            if (category === 'sfx') return s.sfxMuted ? 0 : master * s.sfxVolume;
            if (category === 'music') return s.musicMuted ? 0 : master * s.musicVolume;
            return master;
        },

        _shuffleTracks() {
            const order = this.music.tracks.map((_, i) => i);
            for (let i = order.length - 1; i > 0; i -= 1) {
                const j = Math.floor(Math.random() * (i + 1));
                const tmp = order[i];
                order[i] = order[j];
                order[j] = tmp;
            }
            this.music.order = order;
            this.music.index = 0;
        },

        startMusic() {
            if (!this.settings.musicEnabled) return;
            this.stopMusic();
            this._playNextTrack();
        },

        stopMusic() {
            if (!this.music.current) return;
            this.music.current.pause();
            this.music.current.src = '';
            this.music.current = null;
        },

        _playNextTrack() {
            if (!this.settings.musicEnabled) return;

            const { order, tracks } = this.music;
            const trackPath = tracks[order[this.music.index]];
            const audio = new Audio(trackPath);
            audio.muted = true;
            audio.volume = this._effectiveVolume('music');
            this.music.current = audio;

            audio.addEventListener('ended', () => {
                this.music.index = (this.music.index + 1) % order.length;
                if (this.music.index === 0) this._shuffleTracks();
                this._playNextTrack();
            }, { once: true });

            audio.play().catch(() => {
                const resume = () => {
                    audio.play().catch(() => {});
                    document.removeEventListener('pointerdown', resume);
                    document.removeEventListener('keydown', resume);
                };
                document.addEventListener('pointerdown', resume, { once: true });
                document.addEventListener('keydown', resume, { once: true });
            }).then(() => {
                audio.muted = false;
            });
        },

        _applyMusicVolume() {
            const vol = this._effectiveVolume('music');
            if (this.music.current) this.music.current.volume = vol;
        },

        _playSfx(baseAudio) {
            if (!baseAudio) return;
            const vol = this._effectiveVolume('sfx');
            if (vol === 0) return;
            const clone = baseAudio.cloneNode();
            clone.volume = vol;
            clone.play().catch(() => {});
        },

        playCorrect() {
            this._playSfx(this.correctSound);
        },

        playWrong() {
            this._playSfx(this.wrongSound);
        },

        setMasterVolume(v) {
            this.settings.masterVolume = v;
            this._applyMusicVolume();
            this._saveSettings();
        },

        setSfxVolume(v) {
            this.settings.sfxVolume = v;
            this._saveSettings();
        },

        setMusicVolume(v) {
            this.settings.musicVolume = v;
            this._applyMusicVolume();
            this._saveSettings();
        },

        setMasterMuted(muted) {
            this.settings.masterMuted = muted;
            this._applyMusicVolume();
            this._saveSettings();
        },

        setSfxMuted(muted) {
            this.settings.sfxMuted = muted;
            this._saveSettings();
        },

        setMusicMuted(muted) {
            this.settings.musicMuted = muted;
            this._applyMusicVolume();
            this._saveSettings();
        },

        setMusicEnabled(enabled) {
            this.settings.musicEnabled = enabled;
            if (enabled) {
                this.startMusic();
            } else {
                this.stopMusic();
            }
            this._saveSettings();
        },

        _saveSettings() {
            try {
                localStorage.setItem('audioSettings', JSON.stringify(this.settings));
            } catch (_) {}
        },

        _loadSettings() {
            this.settings = readAudioSettings();
        }
    };

    function initSettingsModal() {
        const openBtn = document.getElementById('btn-settings');
        const closeBtn = document.getElementById('btn-close-settings');
        const modal = document.getElementById('settings-modal');
        const fontButtons = document.querySelectorAll('#settings-modal .font-size-btn[data-size]');
        if (!openBtn || !closeBtn || !modal) return;

        const syncActiveButton = () => {
            const settings = readGameSettings();
            const selected = settings.fontSize || document.documentElement.getAttribute('data-font-size') || 'medium';
            fontButtons.forEach((btn) => {
                const isActive = btn.dataset.size === selected;
                btn.classList.toggle('active', isActive);
            });
        };

        const applyMuteState = (id, muted) => {
            const btn = document.getElementById(id);
            if (!btn) return;
            btn.classList.toggle('muted', muted);
            btn.setAttribute('aria-pressed', String(muted));
        };

        const syncAudioUI = () => {
            quizAudio._loadSettings();
            const a = quizAudio.settings;

            const masterSlider = document.getElementById('slider-master-volume');
            const sfxSlider = document.getElementById('slider-sfx-volume');
            const musicSlider = document.getElementById('slider-music-volume');
            const masterVal = document.getElementById('val-master-volume');
            const sfxVal = document.getElementById('val-sfx-volume');
            const musicVal = document.getElementById('val-music-volume');

            if (masterSlider) masterSlider.value = Math.round(a.masterVolume * 100);
            if (sfxSlider) sfxSlider.value = Math.round(a.sfxVolume * 100);
            if (musicSlider) musicSlider.value = Math.round(a.musicVolume * 100);
            if (masterVal && masterSlider) masterVal.textContent = masterSlider.value + '%';
            if (sfxVal && sfxSlider) sfxVal.textContent = sfxSlider.value + '%';
            if (musicVal && musicSlider) musicVal.textContent = musicSlider.value + '%';

            applyMuteState('btn-mute-master', a.masterMuted);
            applyMuteState('btn-mute-sfx', a.sfxMuted);
            applyMuteState('btn-mute-music', a.musicMuted);
        };

        const openModal = () => {
            syncActiveButton();
            syncAudioUI();
            modal.classList.remove('hidden');
        };

        const closeModal = () => {
            modal.classList.add('hidden');
        };

        openBtn.addEventListener('click', openModal);
        closeBtn.addEventListener('click', closeModal);
        modal.addEventListener('click', (event) => {
            if (event.target === modal) closeModal();
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !modal.classList.contains('hidden')) {
                closeModal();
            }
        });

        fontButtons.forEach((btn) => {
            btn.addEventListener('click', () => {
                const size = btn.dataset.size || 'medium';
                applyFontSizeSetting(size);
                writeGameSettingsPatch({ fontSize: size });
                syncActiveButton();
            });
        });

        const wireSlider = (sliderId, valueId, onChange) => {
            const slider = document.getElementById(sliderId);
            const value = document.getElementById(valueId);
            if (!slider) return;
            slider.addEventListener('input', () => {
                if (value) value.textContent = slider.value + '%';
                onChange(parseInt(slider.value, 10) / 100);
            });
        };

        wireSlider('slider-master-volume', 'val-master-volume', (v) => quizAudio.setMasterVolume(v));
        wireSlider('slider-sfx-volume', 'val-sfx-volume', (v) => quizAudio.setSfxVolume(v));
        wireSlider('slider-music-volume', 'val-music-volume', (v) => {
            quizAudio.setMusicVolume(v);
            if (!quizAudio.settings.musicEnabled) {
                quizAudio.setMusicEnabled(true);
            }
            if (quizAudio.settings.musicMuted) {
                quizAudio.setMusicMuted(false);
                applyMuteState('btn-mute-music', false);
            }
        });

        const wireMuteButton = (id, getter, setter) => {
            const btn = document.getElementById(id);
            if (!btn) return;
            btn.addEventListener('click', () => {
                const next = !getter();
                setter(next);
                applyMuteState(id, next);
            });
        };

        wireMuteButton('btn-mute-master', () => !!quizAudio.settings.masterMuted, (muted) => quizAudio.setMasterMuted(muted));
        wireMuteButton('btn-mute-sfx', () => !!quizAudio.settings.sfxMuted, (muted) => quizAudio.setSfxMuted(muted));
        wireMuteButton('btn-mute-music', () => !!quizAudio.settings.musicMuted, (muted) => {
            if (muted) {
                quizAudio.setMusicMuted(true);
            } else {
                if (!quizAudio.settings.musicEnabled) quizAudio.setMusicEnabled(true);
                quizAudio.setMusicMuted(false);
            }
        });

        syncActiveButton();
        syncAudioUI();
    }

    function createDefaultStats() {
        return {
            overall: {
                quizzesPlayed: 0,
                totalCorrect: 0,
                totalQuestions: 0,
                updatedAt: null
            },
            categories: {
                whatIsEu: { attempts: 0, bestScore: 0, totalCorrect: 0, totalQuestions: 0, lastScore: 0 },
                howEuWorks: { attempts: 0, bestScore: 0, totalCorrect: 0, totalQuestions: 0, lastScore: 0 },
                euInDailyLife: { attempts: 0, bestScore: 0, totalCorrect: 0, totalQuestions: 0, lastScore: 0 },
                euAgenda: { attempts: 0, bestScore: 0, totalCorrect: 0, totalQuestions: 0, lastScore: 0 }
            }
        };
    }

    function normalizeStats(stats) {
        const base = createDefaultStats();
        const src = stats && typeof stats === 'object' ? stats : {};
        const normalized = {
            overall: {
                quizzesPlayed: toInt(src.overall && src.overall.quizzesPlayed),
                totalCorrect: toInt(src.overall && src.overall.totalCorrect),
                totalQuestions: toInt(src.overall && src.overall.totalQuestions),
                updatedAt: src.overall && typeof src.overall.updatedAt === 'string' ? src.overall.updatedAt : null
            },
            categories: {}
        };

        CATEGORY_ORDER.forEach((key) => {
            const item = src.categories && src.categories[key] ? src.categories[key] : {};
            normalized.categories[key] = {
                attempts: toInt(item.attempts),
                bestScore: toInt(item.bestScore),
                totalCorrect: toInt(item.totalCorrect),
                totalQuestions: toInt(item.totalQuestions),
                lastScore: toInt(item.lastScore)
            };
        });

        return deepMerge(base, normalized);
    }

    function deepMerge(base, patch) {
        const out = { ...base };
        if (!patch || typeof patch !== 'object') return out;
        Object.keys(patch).forEach((k) => {
            const val = patch[k];
            if (val && typeof val === 'object' && !Array.isArray(val)) {
                out[k] = deepMerge(base[k] || {}, val);
            } else {
                out[k] = val;
            }
        });
        return out;
    }

    function mergeStats(localStats, cloudStats) {
        const local = normalizeStats(localStats);
        const cloud = normalizeStats(cloudStats);
        const merged = createDefaultStats();

        merged.overall.quizzesPlayed = Math.max(local.overall.quizzesPlayed, cloud.overall.quizzesPlayed);
        merged.overall.totalCorrect = Math.max(local.overall.totalCorrect, cloud.overall.totalCorrect);
        merged.overall.totalQuestions = Math.max(local.overall.totalQuestions, cloud.overall.totalQuestions);
        merged.overall.updatedAt = local.overall.updatedAt || cloud.overall.updatedAt;

        CATEGORY_ORDER.forEach((key) => {
            const l = local.categories[key];
            const c = cloud.categories[key];
            merged.categories[key] = {
                attempts: Math.max(l.attempts, c.attempts),
                bestScore: Math.max(l.bestScore, c.bestScore),
                totalCorrect: Math.max(l.totalCorrect, c.totalCorrect),
                totalQuestions: Math.max(l.totalQuestions, c.totalQuestions),
                lastScore: Math.max(l.lastScore, c.lastScore)
            };
        });

        return normalizeStats(merged);
    }

    function toInt(value) {
        const n = Number(value);
        return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    }

    function loadLocalStats() {
        try {
            const raw = localStorage.getItem(QUIZ_STATS_KEY);
            if (!raw) return createDefaultStats();
            return normalizeStats(JSON.parse(raw));
        } catch (_) {
            return createDefaultStats();
        }
    }

    function saveLocalStats() {
        try {
            localStorage.setItem(QUIZ_STATS_KEY, JSON.stringify(state.stats || createDefaultStats()));
        } catch (_) {}
    }

    async function hydrateAccountStats() {
        state.stats = loadLocalStats();

        if (!window.SupabaseClient || typeof window.SupabaseClient.getCurrentUser !== 'function') {
            return;
        }

        try {
            const user = await window.SupabaseClient.getCurrentUser();
            if (!user) return;

            state.userId = user.id;
            state.isAccountSynced = true;

            if (typeof window.SupabaseClient.getSettings !== 'function') return;
            const cloud = await window.SupabaseClient.getSettings(user.id);
            if (cloud && cloud.quizStats) {
                state.stats = mergeStats(state.stats, cloud.quizStats);
                saveLocalStats();
            } else {
                await syncStatsToAccount();
            }

            if (typeof window.SupabaseClient.getQuizCategoryProgress === 'function') {
                const records = await window.SupabaseClient.getQuizCategoryProgress(user.id);
                if (Array.isArray(records) && records.length > 0) {
                    state.stats = mergeStats(state.stats, mapProgressRecordsToStats(records));
                    saveLocalStats();
                }
            }
        } catch (_) {}
    }

    async function syncStatsToAccount() {
        if (!state.isAccountSynced || !state.userId) return;
        if (!window.SupabaseClient || typeof window.SupabaseClient.updateSettings !== 'function') return;

        try {
            await window.SupabaseClient.updateSettings(state.userId, {
                quizStats: state.stats
            });
        } catch (_) {}
    }

    function mapProgressRecordsToStats(records) {
        const mapped = createDefaultStats();
        if (!Array.isArray(records)) return mapped;

        records.forEach((row) => {
            if (!row || !CATEGORY_ORDER.includes(row.category_key)) return;
            const key = row.category_key;
            mapped.categories[key] = {
                attempts: toInt(row.attempts),
                bestScore: toInt(row.best_correct_questions),
                totalCorrect: toInt(row.last_correct_questions),
                totalQuestions: toInt(row.total_questions),
                lastScore: toInt(row.last_correct_questions)
            };
        });

        return normalizeStats(mapped);
    }

    async function syncCategoryProgressToAccount(categoryKey) {
        if (!state.isAccountSynced || !state.userId || !categoryKey) return;
        if (!window.SupabaseClient || typeof window.SupabaseClient.upsertQuizCategoryProgress !== 'function') return;

        const stats = state.stats || createDefaultStats();
        const cat = stats.categories[categoryKey];
        if (!cat) return;

        try {
            await window.SupabaseClient.upsertQuizCategoryProgress(state.userId, categoryKey, {
                attempts: toInt(cat.attempts),
                bestCorrectQuestions: toInt(cat.bestScore),
                lastCorrectQuestions: toInt(cat.lastScore),
                totalQuestions: toInt(cat.totalQuestions || 10)
            });
        } catch (_) {}
    }

    function renderTopStats() {
        const mount = document.getElementById('quiz-top-stats');
        if (!mount) return;

        const stats = state.stats || createDefaultStats();
        if (!state.categoryKey) {
            mount.innerHTML = '';
            return;
        }

        const categoryStats = stats.categories[state.categoryKey] || { bestScore: 0 };
        mount.innerHTML = `
            <span class="quiz-stat-pill"><strong>${escapeHtml(t('quiz.statsBestAttempt'))}:</strong> ${categoryStats.bestScore}/10</span>
        `;
    }

    function render() {
        const stage = document.getElementById('quiz-stage');
        if (!stage) return;
        renderTopStats();

        if (!state.categoryKey) {
            renderCategorySelection(stage);
            return;
        }

        const questions = (state.sessionQuestions && state.sessionQuestions.length)
            ? state.sessionQuestions
            : buildSessionQuestions(state.categoryKey);
        if (!state.sessionQuestions || !state.sessionQuestions.length) {
            state.sessionQuestions = questions;
        }
        if (state.currentIndex >= questions.length) {
            renderResult(stage, questions.length);
            return;
        }

        renderQuestion(stage, questions, questions[state.currentIndex]);
    }

    function renderCategorySelection(stage) {
        clearQuizReviewPanel(stage);
        stage.className = 'quiz-stage';

        const skeletonCards = CATEGORY_ORDER.map(() => {
            return `
                <div class="quiz-category-skeleton" aria-hidden="true">
                    <div class="quiz-category-skeleton-icon"></div>
                    <div class="quiz-category-skeleton-line lg"></div>
                    <div class="quiz-category-skeleton-line"></div>
                    <div class="quiz-category-skeleton-line sm"></div>
                </div>
            `;
        }).join('');

        stage.innerHTML = `<div class="quiz-categories-grid">${skeletonCards}</div>`;

        const renderToken = Date.now();
        state.categoryRenderToken = renderToken;
        window.setTimeout(() => {
            if (state.categoryRenderToken !== renderToken || state.categoryKey) return;
            renderCategorySelectionCards(stage);
        }, 180);
    }

    function renderCategorySelectionCards(stage) {
        const stats = state.stats || createDefaultStats();
        const cards = CATEGORY_ORDER.map((categoryKey) => {
            const style = CATEGORY_STYLES[categoryKey] || CATEGORY_STYLES.whatIsEu;
            const icon = 'assets/quiz-images/icons/' + (CATEGORY_FOLDERS[categoryKey] || categoryKey) + '.svg';
            const bestScore = toInt(stats.categories && stats.categories[categoryKey] && stats.categories[categoryKey].bestScore);
            return `
                <button class="quiz-category-card" data-category="${categoryKey}">
                    <div class="quiz-ticket ${style.ticketClass}">
                        <div class="quiz-ticket-icon">
                            <img src="${icon}" alt="${escapeHtml(t('quiz.iconAlt', { category: getCategoryTitle(categoryKey) }))}">
                        </div>
                        <div class="quiz-ticket-copy">
                            <h3>${escapeHtml(getCategoryTitle(categoryKey))}</h3>
                            <p class="quiz-ticket-desc">${escapeHtml(getCategoryDescription(categoryKey))}</p>
                        </div>
                        <div class="quiz-category-best-badge" title="${escapeHtml(t('quiz.statsBestAttempt'))}: ${bestScore}/10">
                            <span class="quiz-category-best-icon" aria-hidden="true">🏅</span>
                            <span class="quiz-category-best-text">${bestScore}/10</span>
                        </div>
                    </div>
                </button>
            `;
        }).join('');

        stage.innerHTML = `
            <div class="quiz-categories-grid">${cards}</div>
        `;

        stage.querySelectorAll('[data-category]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const categoryKey = btn.getAttribute('data-category');
                if (!categoryKey) return;
                clearPendingFinishTimeout();
                state.categoryKey = categoryKey;
                state.sessionQuestions = buildSessionQuestions(categoryKey);
                state.userAnswers = [];
                state.currentIndex = 0;
                state.score = 0;
                state.answered = false;
                state.selectedAnswer = -1;
                state.reviewVisible = false;
                state.resultCommitted = false;
                render();
            });
        });
    }

    function getSourceIndexFromKey(sourceKey) {
        const match = String(sourceKey || '').match(/^.+\.q(\d{2})$/i);
        if (!match) return -1;
        const index = Number(match[1]);
        if (!Number.isInteger(index) || index <= 0) return -1;
        return index - 1;
    }

    function getLocalizedQuestionVariant(sessionQuestion) {
        const sourceIndex = getSourceIndexFromKey(sessionQuestion && sessionQuestion.sourceKey ? sessionQuestion.sourceKey : '');
        const localizedQuestions = getQuestions(state.categoryKey);
        const localizedQuestion = sourceIndex >= 0 ? localizedQuestions[sourceIndex] : null;
        if (!localizedQuestion || typeof localizedQuestion !== 'object') return sessionQuestion || {};

        const fallbackOptions = Array.isArray(sessionQuestion && sessionQuestion.options) ? sessionQuestion.options.slice() : [];
        const localizedOptions = Array.isArray(localizedQuestion.options) ? localizedQuestion.options : [];
        const optionOrder = Array.isArray(sessionQuestion && sessionQuestion.optionOrder) ? sessionQuestion.optionOrder : [];

        const remappedOptions = optionOrder.length
            ? optionOrder.map((originalIndex, shuffledIndex) => {
                const translated = localizedOptions[Number(originalIndex)];
                return typeof translated === 'string' ? translated : fallbackOptions[shuffledIndex];
            })
            : fallbackOptions;

        return {
            ...sessionQuestion,
            ...localizedQuestion,
            sourceKey: sessionQuestion && sessionQuestion.sourceKey ? sessionQuestion.sourceKey : '',
            optionOrder,
            options: remappedOptions,
            answer: sessionQuestion && sessionQuestion.answer !== undefined ? sessionQuestion.answer : 0
        };
    }

    function renderQuestion(stage, questions, question) {
        clearQuizReviewPanel(stage);
        const localizedQuestion = getLocalizedQuestionVariant(question);
        const style = CATEGORY_STYLES[state.categoryKey] || CATEGORY_STYLES.whatIsEu;
        const total = questions.length;
        const current = state.currentIndex + 1;
        const answerRecord = state.userAnswers[state.currentIndex] || null;

        state.answered = !!answerRecord;
        state.selectedAnswer = answerRecord ? Number(answerRecord.selected) : -1;

        const source = buildQuestionSource(localizedQuestion);
        const sourceMarkup = source
            ? `
                <div class="quiz-question-meta${state.answered ? '' : ' is-hidden'}" id="quiz-source-meta">
                    <span class="quiz-source-label">${escapeHtml(t('quiz.sourceLabel'))}</span>
                    <a class="quiz-source-link" href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.label)}</a>
                </div>
            `
            : '';

        const optionsMarkup = (localizedQuestion.options || []).map((optionText, idx) => {
            return `
                <button class="quiz-option" type="button" data-option-index="${idx}">
                    ${escapeHtml(optionText)}
                </button>
            `;
        }).join('');

        stage.className = 'quiz-stage ' + style.themeClass;
        stage.innerHTML = `
            <div class="quiz-live">
                <div class="quiz-question-panel">
                    <span class="quiz-category-chip">${escapeHtml(getCategoryTitle(state.categoryKey))}</span>
                    <div class="quiz-progress">${escapeHtml(t('quiz.progress', { current, total }))}</div>
                    <h2 class="quiz-question-title">${escapeHtml(localizedQuestion.question || '')}</h2>
                    ${sourceMarkup}
                    <div class="quiz-options">${optionsMarkup}</div>
                    <div class="quiz-actions">
                        <button class="quiz-action-btn" type="button" id="quiz-prev-btn">${escapeHtml(t('quiz.back'))}</button>
                        <button class="quiz-action-btn primary" type="button" id="quiz-next-btn" disabled>${escapeHtml(current === total ? t('quiz.finishQuiz') : t('quiz.nextQuestion'))}</button>
                    </div>
                </div>
                <div class="quiz-media-panel">
                    <img id="quiz-question-image" alt="${escapeHtml(t('quiz.imageAlt', { category: getCategoryTitle(state.categoryKey), number: current }))}">
                    <div class="quiz-media-caption">${escapeHtml(t('quiz.imageCaption'))}</div>
                </div>
            </div>
        `;

        const imageElement = stage.querySelector('#quiz-question-image');
        if (imageElement) {
            loadQuestionImage(imageElement, localizedQuestion, state.categoryKey);
        }

        const nextBtn = stage.querySelector('#quiz-next-btn');
        const prevBtn = stage.querySelector('#quiz-prev-btn');

        if (prevBtn) {
            prevBtn.addEventListener('click', () => {
                clearPendingFinishTimeout();
                if (state.currentIndex > 0) {
                    state.currentIndex -= 1;
                    render();
                    return;
                }
                state.categoryKey = null;
                state.sessionQuestions = [];
                state.userAnswers = [];
                render();
            });
        }

        const optionButtons = stage.querySelectorAll('[data-option-index]');
        if (state.answered) {
            applyAnsweredQuestionUI(localizedQuestion, nextBtn, optionButtons);
            attachWrongOptionHelp(localizedQuestion, optionButtons);
        }

        optionButtons.forEach((btn) => {
            btn.addEventListener('click', () => {
                if (state.answered) return;
                const selected = Number(btn.getAttribute('data-option-index'));
                handleAnswer(selected, localizedQuestion, nextBtn, optionButtons, total);
            });
        });

        nextBtn.addEventListener('click', () => {
            clearPendingFinishTimeout();
            state.currentIndex += 1;
            state.answered = false;
            state.selectedAnswer = -1;
            render();
        });
    }

    function handleAnswer(selected, question, nextBtn, optionButtons, totalQuestions) {
        clearPendingFinishTimeout();
        state.answered = true;
        state.selectedAnswer = selected;

        const answer = Number(question.answer);
        const isCorrect = selected === answer;
        if (isCorrect) {
            quizAudio.playCorrect();
        } else {
            quizAudio.playWrong();
        }
        if (isCorrect) state.score += 1;
        state.userAnswers[state.currentIndex] = { selected, isCorrect };

        if (isCorrect) {
            const selectedBtn = Array.from(optionButtons).find((btn) => Number(btn.getAttribute('data-option-index')) === selected);
            playConfettiBurst(selectedBtn || null);
        }

        optionButtons.forEach((btn) => {
            const idx = Number(btn.getAttribute('data-option-index'));
            btn.disabled = true;
            if (idx === answer) {
                btn.classList.add('is-correct');
            } else if (idx === selected) {
                btn.classList.add('is-wrong');
            }
        });

        if (!isCorrect) {
            showWrongAnswerModal(question);
            attachWrongOptionHelp(question, optionButtons);
        }

        const sourceMeta = document.getElementById('quiz-source-meta');
        if (sourceMeta) sourceMeta.classList.remove('is-hidden');

        if (nextBtn) nextBtn.disabled = false;

        const isLastQuestion = state.currentIndex === totalQuestions - 1;
        if (isLastQuestion && isCorrect && nextBtn) {
            nextBtn.disabled = false;
            nextBtn.textContent = escapeHtml(t('quiz.finishQuiz'));
        }
    }

    function applyAnsweredQuestionUI(question, nextBtn, optionButtons) {
        const answer = Number(question.answer);
        optionButtons.forEach((btn) => {
            const idx = Number(btn.getAttribute('data-option-index'));
            btn.disabled = true;
            if (idx === answer) {
                btn.classList.add('is-correct');
            } else if (idx === state.selectedAnswer) {
                btn.classList.add('is-wrong');
            }
        });
        if (nextBtn) nextBtn.disabled = false;
    }

    function showWrongAnswerModal(question) {
        const answerIndex = Number(question && question.answer);
        const options = Array.isArray(question && question.options) ? question.options : [];
        const correctAnswer = options[answerIndex] || '';
        const detailedAnswer = question && question.correctAnswerDetail ? question.correctAnswerDetail : '';
        const explanation = sanitizeDetailedAnswer(detailedAnswer, question && question.explanation ? question.explanation : '');
        const source = buildQuestionSource(question);
        const sourceRow = source
            ? `<p class="quiz-wrong-modal-row"><strong class="quiz-correct-answer-label">${escapeHtml(t('quiz.sourceLabel'))}</strong> <a class="quiz-source-link" href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.label)}</a></p>`
            : '';

        const existing = document.getElementById('quiz-wrong-answer-modal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.className = 'quiz-wrong-modal';
        modal.id = 'quiz-wrong-answer-modal';
        modal.innerHTML = `
            <div class="quiz-wrong-modal-card is-error" role="dialog" aria-modal="true" aria-labelledby="quiz-wrong-title">
                <h3 id="quiz-wrong-title" class="quiz-wrong-title"><span class="quiz-wrong-icon" aria-hidden="true">!</span>${escapeHtml(t('quiz.feedbackWrong'))}</h3>
                <p class="quiz-wrong-modal-row"><strong class="quiz-correct-answer-label">${escapeHtml(t('quiz.correctAnswerLabel'))}</strong> <span class="quiz-correct-answer-value">${escapeHtml(correctAnswer)}</span></p>
                <p class="quiz-wrong-modal-row">${escapeHtml(explanation)}</p>
                ${sourceRow}
                <div class="quiz-wrong-modal-actions">
                    <button class="quiz-action-btn primary" type="button" id="quiz-wrong-close-btn">${escapeHtml(t('quiz.gotIt'))}</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const close = () => {
            modal.remove();
        };

        const closeBtn = modal.querySelector('#quiz-wrong-close-btn');
        if (closeBtn) closeBtn.addEventListener('click', close);
        modal.addEventListener('click', (event) => {
            if (event.target === modal) close();
        });
    }

    function sanitizeDetailedAnswer(detail, fallback) {
        const text = String(detail || fallback || '').trim();
        if (!text) return '';
        return text
            .replace(/^The correct answer is\s+"?[^"]+"?\.\s*/i, '')
            .replace(/^La risposta corretta\s+e\s+"?[^"]+"?\.\s*/i, '')
            .replace(/^La risposta corretta\s+è\s+"?[^"]+"?\.\s*/i, '');
    }

    function attachWrongOptionHelp(question, optionButtons) {
        const answer = Number(question.answer);
        const selected = Number(state.selectedAnswer);
        if (!state.answered || selected === answer) return;

        const wrongBtn = Array.from(optionButtons).find((btn) => Number(btn.getAttribute('data-option-index')) === selected);
        if (!wrongBtn) return;

        const existingIcon = wrongBtn.querySelector('.quiz-option-help-icon');
        if (existingIcon) existingIcon.remove();

        wrongBtn.classList.add('has-help-icon');
        wrongBtn.disabled = false;
        wrongBtn.title = t('quiz.reopenExplanation');
        wrongBtn.setAttribute('aria-label', t('quiz.reopenExplanation'));

        const help = document.createElement('span');
        help.className = 'quiz-option-help-icon';
        help.setAttribute('aria-hidden', 'true');
        help.textContent = '?';
        wrongBtn.appendChild(help);

        if (wrongBtn.dataset.helpBound !== '1') {
            wrongBtn.addEventListener('click', () => {
                showWrongAnswerModal(question);
            });
            wrongBtn.dataset.helpBound = '1';
        }
    }

    function renderResult(stage, total) {
        if (!state.resultCommitted) {
            updateStatsOnCategoryEnd(state.categoryKey, state.score, total);
            state.resultCommitted = true;
        }
        const titleKey = state.score === total ? 'quiz.resultTitle' : 'quiz.resultTitleQuizCompleted';
        const scoreBadgeClass = getScoreBadgeClass(state.score, total);
        const main = getQuizMainContainer(stage);
        stage.className = 'quiz-stage is-result';
        stage.innerHTML = `
            <div class="quiz-result">
                <h2>${escapeHtml(t(titleKey))}</h2>
                <div class="quiz-score-badge ${scoreBadgeClass}">${state.score}/${total}</div>
                <div class="quiz-result-main">
                    <div class="quiz-result-actions">
                        <button class="quiz-action-btn" type="button" id="quiz-review-toggle">${escapeHtml(state.reviewVisible ? t('quiz.hideReview') : t('quiz.reviewAnswers'))}</button>
                        <button class="quiz-action-btn primary" type="button" id="quiz-restart-category">${escapeHtml(t('quiz.retryCategory'))}</button>
                        <button class="quiz-action-btn" type="button" id="quiz-change-category">${escapeHtml(t('quiz.chooseAnotherCategory'))}</button>
                    </div>
                    <div class="quiz-share-block">
                        <h3 class="quiz-share-title">${escapeHtml(t('quiz.shareTitle'))}</h3>
                        <p class="quiz-share-hint">${escapeHtml(t('quiz.shareHint', { score: state.score, total }))}</p>
                        <div class="quiz-share-actions">
                            <button class="quiz-action-btn quiz-share-btn" type="button" id="quiz-share-native" aria-label="${escapeHtml(t('quiz.shareNative'))}" title="${escapeHtml(t('quiz.shareNative'))}">${getShareButtonIcon('native')}</button>
                            <button class="quiz-action-btn quiz-share-btn" type="button" data-share-platform="x" aria-label="${escapeHtml(t('quiz.shareX'))}" title="${escapeHtml(t('quiz.shareX'))}">${getShareButtonIcon('x')}</button>
                            <button class="quiz-action-btn quiz-share-btn" type="button" data-share-platform="facebook" aria-label="${escapeHtml(t('quiz.shareFacebook'))}" title="${escapeHtml(t('quiz.shareFacebook'))}">${getShareButtonIcon('facebook')}</button>
                            <button class="quiz-action-btn quiz-share-btn" type="button" data-share-platform="whatsapp" aria-label="${escapeHtml(t('quiz.shareWhatsApp'))}" title="${escapeHtml(t('quiz.shareWhatsApp'))}">${getShareButtonIcon('whatsapp')}</button>
                            <button class="quiz-action-btn quiz-share-btn" type="button" data-share-platform="telegram" aria-label="${escapeHtml(t('quiz.shareTelegram'))}" title="${escapeHtml(t('quiz.shareTelegram'))}">${getShareButtonIcon('telegram')}</button>
                            <button class="quiz-action-btn quiz-share-btn primary" type="button" id="quiz-share-copy" aria-label="${escapeHtml(t('quiz.copyResult'))}" title="${escapeHtml(t('quiz.copyResult'))}">${getShareButtonIcon('copy')}</button>
                        </div>
                        <p class="quiz-share-status" id="quiz-share-status" role="status" aria-live="polite"></p>
                    </div>
                </div>
            </div>
        `;

        const reviewPanel = main ? ensureQuizReviewPanel(main) : null;
        const reviewToggle = stage.querySelector('#quiz-review-toggle');
        const reviewClose = reviewPanel ? reviewPanel.querySelector('#quiz-review-close') : null;
        const syncReviewPanelState = () => {
            if (!main || !reviewPanel) {
                return;
            }

            main.classList.toggle('is-review-open', state.reviewVisible);
            reviewPanel.classList.toggle('is-hidden', !state.reviewVisible);
        };

        if (reviewToggle) {
            reviewToggle.addEventListener('click', () => {
                state.reviewVisible = !state.reviewVisible;
                reviewToggle.textContent = state.reviewVisible ? t('quiz.hideReview') : t('quiz.reviewAnswers');
                syncReviewPanelState();
            });
            reviewToggle.textContent = state.reviewVisible ? t('quiz.hideReview') : t('quiz.reviewAnswers');
        }

        if (reviewClose) {
            reviewClose.addEventListener('click', () => {
                state.reviewVisible = false;
                if (reviewToggle) reviewToggle.textContent = t('quiz.reviewAnswers');
                syncReviewPanelState();
            });
        }

        syncReviewPanelState();

        stage.querySelector('#quiz-restart-category').addEventListener('click', () => {
            clearPendingFinishTimeout();
            state.sessionQuestions = buildSessionQuestions(state.categoryKey);
            state.userAnswers = [];
            state.currentIndex = 0;
            state.score = 0;
            state.answered = false;
            state.selectedAnswer = -1;
            state.reviewVisible = false;
            state.resultCommitted = false;
            render();
        });

        stage.querySelector('#quiz-change-category').addEventListener('click', () => {
            clearPendingFinishTimeout();
            state.categoryKey = null;
            state.sessionQuestions = [];
            state.userAnswers = [];
            state.currentIndex = 0;
            state.score = 0;
            state.answered = false;
            state.selectedAnswer = -1;
            state.reviewVisible = false;
            state.resultCommitted = false;
            render();
        });

        setupShareActions(stage, total);

        renderTopStats();
    }

    function getScoreBadgeClass(score, total) {
        if (score === total) return 'is-green';
        if (score > 5) return 'is-orange';
        return 'is-red';
    }

    function buildReviewMarkup() {
        const questions = Array.isArray(state.sessionQuestions) ? state.sessionQuestions : [];
        return questions.map((question, idx) => {
            const localizedQuestion = getLocalizedQuestionVariant(question);
            const answerRecord = state.userAnswers[idx] || null;
            const selectedIndex = answerRecord ? Number(answerRecord.selected) : -1;
            const correctIndex = Number(localizedQuestion && localizedQuestion.answer);
            const selectedText = selectedIndex >= 0 && Array.isArray(localizedQuestion.options) ? localizedQuestion.options[selectedIndex] : t('quiz.notAnswered');
            const correctText = correctIndex >= 0 && Array.isArray(localizedQuestion.options) ? localizedQuestion.options[correctIndex] : '';
            const itemClass = answerRecord && answerRecord.isCorrect ? 'is-correct' : 'is-wrong';
            const source = buildQuestionSource(localizedQuestion);
            const sourceMarkup = source
                ? `<a class="quiz-source-link" href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.label)}</a>`
                : '';

            return `
                <article class="quiz-review-item ${itemClass}">
                    <h3>${escapeHtml(t('quiz.reviewQuestionLabel', { number: idx + 1 }))}</h3>
                    <p class="quiz-review-question">${escapeHtml(localizedQuestion && localizedQuestion.question ? localizedQuestion.question : '')}</p>
                    <p class="quiz-review-line"><strong>${escapeHtml(t('quiz.yourAnswer'))}</strong> ${escapeHtml(selectedText || '')}</p>
                    <p class="quiz-review-line"><strong>${escapeHtml(t('quiz.correctAnswerLabel'))}</strong> ${escapeHtml(correctText || '')}</p>
                    <p class="quiz-review-line"><strong>${escapeHtml(t('quiz.sourceLabel'))}</strong> ${sourceMarkup}</p>
                </article>
            `;
        }).join('');
    }

    function getQuizMainContainer(stage) {
        if (stage && typeof stage.closest === 'function') {
            return stage.closest('.quiz-main');
        }
        return document.querySelector('.quiz-main');
    }

    function clearQuizReviewPanel(stage) {
        const main = getQuizMainContainer(stage);
        if (main) {
            main.classList.remove('is-review-open');
        }

        const reviewPanel = document.getElementById('quiz-review-panel');
        if (reviewPanel) {
            reviewPanel.remove();
        }
    }

    function ensureQuizReviewPanel(main) {
        let reviewPanel = document.getElementById('quiz-review-panel');
        if (!reviewPanel) {
            reviewPanel = document.createElement('aside');
            reviewPanel.id = 'quiz-review-panel';
            reviewPanel.className = 'quiz-review-panel is-hidden';
        }

        reviewPanel.innerHTML = `
            <div class="quiz-review-panel-header">
                <h3>${escapeHtml(t('quiz.reviewAnswers'))}</h3>
                <button class="quiz-action-btn quiz-review-close-btn" type="button" id="quiz-review-close" aria-label="${escapeHtml(t('quiz.hideReview'))}" title="${escapeHtml(t('quiz.hideReview'))}">&times;</button>
            </div>
            <div class="quiz-review" id="quiz-review">${buildReviewMarkup()}</div>
        `;

        if (main && reviewPanel.parentElement !== main) {
            main.appendChild(reviewPanel);
        }

        return reviewPanel;
    }

    function buildQuestionSource(question) {
        const sourceFromQuestion = getInlineQuestionSource(question);
        const picked = sourceFromQuestion || {};

        const sourceUrl = normalizeExternalUrl(picked.url) || 'https://european-union.europa.eu/';
        const rawLabel = picked.label || (question && (question.sourceLabel || question.sourceTitle || question.reference));
        const label = String(rawLabel || '').trim() || t('quiz.sourceDefaultLabel');
        return {
            url: sourceUrl,
            label
        };
    }

    function getShareTargetUrl() {
        const fallbackUrl = 'https://malannino-leonardo.github.io/eu-puzzle/';
        try {
            const current = new URL(window.location.href);
            if (!/^https?:$/i.test(current.protocol)) return fallbackUrl;
            current.pathname = current.pathname.replace(/\/quiz\.html$/i, '/index.html');
            current.search = '';
            current.hash = '';
            return current.toString();
        } catch (_) {
            return fallbackUrl;
        }
    }

    function getShareMessage(total) {
        return t('quiz.shareMessage', {
            score: state.score,
            total,
            category: getCategoryTitle(state.categoryKey || '')
        });
    }

    function buildShareUrls(total) {
        const targetUrl = getShareTargetUrl();
        const message = getShareMessage(total);
        const encodedUrl = encodeURIComponent(targetUrl);
        const encodedText = encodeURIComponent(message);
        return {
            targetUrl,
            message,
            x: 'https://twitter.com/intent/tweet?text=' + encodedText + '&url=' + encodedUrl,
            facebook: 'https://www.facebook.com/sharer/sharer.php?u=' + encodedUrl + '&quote=' + encodedText,
            whatsapp: 'https://wa.me/?text=' + encodeURIComponent(message + ' ' + targetUrl),
            telegram: 'https://t.me/share/url?url=' + encodedUrl + '&text=' + encodedText
        };
    }

    function getShareButtonIcon(kind) {
        if (kind === 'native') {
            return '<i class="fa-solid fa-share-from-square" aria-hidden="true"></i>';
        }
        if (kind === 'x') {
            return '<i class="fa-brands fa-x-twitter" aria-hidden="true"></i>';
        }
        if (kind === 'facebook') {
            return '<i class="fa-brands fa-facebook-f" aria-hidden="true"></i>';
        }
        if (kind === 'whatsapp') {
            return '<i class="fa-brands fa-whatsapp" aria-hidden="true"></i>';
        }
        if (kind === 'telegram') {
            return '<i class="fa-brands fa-telegram" aria-hidden="true"></i>';
        }
        return '<i class="fa-solid fa-copy" aria-hidden="true"></i>';
    }

    function openSharePopup(url) {
        const popup = window.open(url, '_blank', 'noopener,noreferrer,width=700,height=640');
        return !!popup;
    }

    async function copyShareResult(total) {
        const share = buildShareUrls(total);
        const payload = share.message + '\n' + share.targetUrl;

        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            await navigator.clipboard.writeText(payload);
            return;
        }

        const textarea = document.createElement('textarea');
        textarea.value = payload;
        textarea.setAttribute('readonly', 'readonly');
        textarea.style.position = 'absolute';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
    }

    function setupShareActions(stage, total) {
        const shareStatus = stage.querySelector('#quiz-share-status');
        const setStatus = (text, isError) => {
            if (!shareStatus) return;
            shareStatus.textContent = text;
            shareStatus.classList.toggle('is-error', !!isError);
        };

        const nativeBtn = stage.querySelector('#quiz-share-native');
        if (nativeBtn) {
            if (!navigator.share) {
                nativeBtn.hidden = true;
            } else {
                nativeBtn.addEventListener('click', async () => {
                    try {
                        const share = buildShareUrls(total);
                        await navigator.share({
                            title: t('quiz.pageTitle'),
                            text: share.message,
                            url: share.targetUrl
                        });
                        setStatus(t('quiz.shareNativeSuccess'));
                    } catch (_) {
                        setStatus('');
                    }
                });
            }
        }

        stage.querySelectorAll('[data-share-platform]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const platform = btn.getAttribute('data-share-platform');
                if (!platform) return;
                const share = buildShareUrls(total);
                const target = share[platform];
                if (!target) return;
                const opened = openSharePopup(target);
                if (!opened) setStatus(t('quiz.sharePopupBlocked'), true);
            });
        });

        const copyBtn = stage.querySelector('#quiz-share-copy');
        if (copyBtn) {
            copyBtn.addEventListener('click', async () => {
                try {
                    await copyShareResult(total);
                    setStatus(t('quiz.shareCopied'));
                } catch (_) {
                    setStatus(t('quiz.shareCopyFailed'), true);
                }
            });
        }
    }

    function normalizeExternalUrl(url) {
        const value = String(url || '').trim();
        if (!value) return '';
        if (/^https?:\/\//i.test(value)) return value;
        return '';
    }

    function clearPendingFinishTimeout() {
        if (!state.pendingFinishTimeoutId) return;
        window.clearTimeout(state.pendingFinishTimeoutId);
        state.pendingFinishTimeoutId = null;
    }

    function playConfettiBurst(anchorElement) {
        if (!anchorElement || typeof anchorElement.getBoundingClientRect !== 'function') return;

        const rect = anchorElement.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.height <= 0) return;

        const burst = document.createElement('div');
        burst.className = 'quiz-confetti-layer';
        const colors = ['#facc15', '#38bdf8', '#34d399', '#f472b6', '#fb7185', '#a78bfa'];
        const pieces = 36;

        for (let i = 0; i < pieces; i += 1) {
            const piece = document.createElement('span');
            piece.className = 'quiz-confetti-piece';
            const localX = rect.left + (Math.random() * rect.width);
            const localY = rect.top + (Math.random() * rect.height);
            const tx = (Math.random() * 180) - 90;
            const ty = (Math.random() * 180) - 90;

            piece.style.left = Math.max(0, Math.round(localX)) + 'px';
            piece.style.top = Math.max(0, Math.round(localY)) + 'px';
            piece.style.background = colors[Math.floor(Math.random() * colors.length)];
            piece.style.setProperty('--tx', tx.toFixed(0) + 'px');
            piece.style.setProperty('--ty', ty.toFixed(0) + 'px');
            piece.style.setProperty('--rot', (Math.random() * 540).toFixed(0) + 'deg');
            piece.style.setProperty('--delay', (Math.random() * 120).toFixed(0) + 'ms');
            burst.appendChild(piece);
        }

        document.body.appendChild(burst);
        window.setTimeout(() => {
            burst.remove();
        }, 1050);
    }

    function updateStatsOnCategoryEnd(categoryKey, score, total) {
        if (!categoryKey) return;

        const stats = state.stats || createDefaultStats();
        const cat = stats.categories[categoryKey] || { attempts: 0, bestScore: 0, totalCorrect: 0, totalQuestions: 0, lastScore: 0 };

        cat.attempts += 1;
        cat.totalCorrect += score;
        cat.totalQuestions += total;
        cat.lastScore = score;
        cat.bestScore = Math.max(cat.bestScore, score);
        stats.categories[categoryKey] = cat;

        stats.overall.quizzesPlayed += 1;
        stats.overall.totalCorrect += score;
        stats.overall.totalQuestions += total;
        stats.overall.updatedAt = new Date().toISOString();

        state.stats = stats;
        saveLocalStats();
        syncStatsToAccount();
        syncCategoryProgressToAccount(categoryKey);
    }

    function loadQuestionImage(imageEl, question, categoryKey) {
        const normalizeToPngPath = (value) => {
            if (typeof value !== 'string') return '';
            const trimmed = value.trim();
            if (!trimmed) return '';

            const match = trimmed.match(/^([^?#]*)(\?[^#]*)?(#.*)?$/);
            if (!match) return trimmed;

            let base = match[1] || '';
            const query = match[2] || '';
            const hash = match[3] || '';

            if (/\.[^/.]+$/.test(base)) {
                base = base.replace(/\.[^/.]+$/, '.png');
            } else {
                base += '.png';
            }

            return base + query + hash;
        };

        const explicitImageLink = normalizeToPngPath(question.imageLink);
        const explicitLegacy = normalizeToPngPath(question.image);
        const folder = CATEGORY_FOLDERS[categoryKey] || categoryKey;
        const sourceIndex = getQuestionIndexFromSourceKey(question && question.sourceKey ? question.sourceKey : '');
        const fallbackNumber = sourceIndex >= 0 ? sourceIndex + 1 : 1;
        const fallbackBase = 'assets/quiz-images/' + folder + '/q' + String(fallbackNumber).padStart(2, '0');

        const candidates = [];
        if (explicitImageLink) candidates.push(explicitImageLink);
        if (explicitLegacy) candidates.push(explicitLegacy);
        candidates.push(fallbackBase + '.png');

        let index = 0;
        const tried = new Set();

        const tryNext = () => {
            while (index < candidates.length && tried.has(candidates[index])) {
                index += 1;
            }
            if (index >= candidates.length) {
                imageEl.style.opacity = '0.3';
                imageEl.alt = t('quiz.imageMissingAlt');
                imageEl.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500"><rect width="800" height="500" fill="%23111827"/><g fill="%239ca3af" font-family="Segoe UI, Arial, sans-serif" text-anchor="middle"><text x="400" y="240" font-size="36">Image coming soon</text><text x="400" y="286" font-size="22">assets/quiz-images</text></g></svg>';
                return;
            }
            const candidate = candidates[index];
            index += 1;
            tried.add(candidate);
            imageEl.onerror = tryNext;
            imageEl.src = candidate;
        };

        imageEl.onerror = tryNext;
        tryNext();
    }

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function initBackgroundSlideshow() {
        const images = [
            'assets/backgrounds/bg1.jpg',
            'assets/backgrounds/bg2.jpeg',
            'assets/backgrounds/bg3.jpg',
            'assets/backgrounds/bg4.jpg',
            'assets/backgrounds/bg5.jpg',
            'assets/backgrounds/bg6.jpg'
        ];
        const layers = [
            document.querySelector('.menu-bg-a'),
            document.querySelector('.menu-bg-b')
        ];
        if (!layers[0] || !layers[1]) return;

        let current = 0;
        let active = 0;
        layers[0].style.backgroundImage = 'url("' + images[0] + '")';
        layers[0].style.opacity = '1';
        layers[1].style.opacity = '0';

        setInterval(function () {
            current = (current + 1) % images.length;
            const next = 1 - active;
            layers[next].style.backgroundImage = 'url("' + images[current] + '")';
            layers[next].style.opacity = '1';
            layers[active].style.opacity = '0';
            active = next;
        }, 5000);
    }

    async function init() {
        quizAudio.init();
        quizAudio.startMusic();
        initBackgroundSlideshow();
        initSettingsModal();
        render();
        await hydrateAccountStats();
        render();
        document.addEventListener('languagechange', () => {
            render();
        });

        if (window.SupabaseClient && typeof window.SupabaseClient.onAuthStateChange === 'function') {
            window.SupabaseClient.onAuthStateChange(async () => {
                await hydrateAccountStats();
                renderTopStats();
            });
        }

        window.addEventListener('beforeunload', () => {
            quizAudio.stopMusic();
        });
    }

    if (window.i18nReady) {
        window.i18nReady.then(init);
    } else if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
