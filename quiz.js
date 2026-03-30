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
        currentIndex: 0,
        score: 0,
        answered: false,
        selectedAnswer: -1,
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
        const baseQuestions = ensureQuestionCount(categoryKey);
        return shuffleArray(baseQuestions).map((question) => {
            const options = Array.isArray(question && question.options) ? question.options.slice() : [];
            const answerIndex = Number(question && question.answer);
            const safeAnswerIndex = Number.isInteger(answerIndex) && answerIndex >= 0 && answerIndex < options.length
                ? answerIndex
                : 0;

            const optionEntries = options.map((text, idx) => ({
                text,
                isCorrect: idx === safeAnswerIndex
            }));
            const shuffledOptions = shuffleArray(optionEntries);
            const shuffledAnswerIndex = shuffledOptions.findIndex((entry) => entry.isCorrect);

            return {
                ...question,
                options: shuffledOptions.map((entry) => entry.text),
                answer: shuffledAnswerIndex >= 0 ? shuffledAnswerIndex : 0
            };
        });
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
            <button class="quiz-action-btn quiz-top-action" type="button" id="quiz-back-to-categories-top">${escapeHtml(t('quiz.chooseAnotherCategory'))}</button>
        `;

        const backToCategoriesBtn = mount.querySelector('#quiz-back-to-categories-top');
        if (backToCategoriesBtn) {
            backToCategoriesBtn.addEventListener('click', () => {
                state.categoryKey = null;
                render();
            });
        }
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
                state.categoryKey = categoryKey;
                state.sessionQuestions = buildSessionQuestions(categoryKey);
                state.currentIndex = 0;
                state.score = 0;
                state.answered = false;
                state.selectedAnswer = -1;
                state.resultCommitted = false;
                render();
            });
        });
    }

    function renderQuestion(stage, questions, question) {
        const style = CATEGORY_STYLES[state.categoryKey] || CATEGORY_STYLES.whatIsEu;
        const total = questions.length;
        const current = state.currentIndex + 1;

        const optionsMarkup = (question.options || []).map((optionText, idx) => {
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
                    <h2 class="quiz-question-title">${escapeHtml(question.question || '')}</h2>
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
            loadQuestionImage(imageElement, question, state.categoryKey, current);
        }

        const nextBtn = stage.querySelector('#quiz-next-btn');
        const prevBtn = stage.querySelector('#quiz-prev-btn');

        if (prevBtn) {
            prevBtn.addEventListener('click', () => {
                if (state.currentIndex > 0) {
                    state.currentIndex -= 1;
                    state.answered = false;
                    state.selectedAnswer = -1;
                    render();
                    return;
                }
                state.categoryKey = null;
                state.sessionQuestions = [];
                render();
            });
        }

        const optionButtons = stage.querySelectorAll('[data-option-index]');
        if (state.answered) {
            applyAnsweredQuestionUI(question, nextBtn, optionButtons);
            attachWrongOptionHelp(question, optionButtons);
        }

        optionButtons.forEach((btn) => {
            btn.addEventListener('click', () => {
                if (state.answered) return;
                const selected = Number(btn.getAttribute('data-option-index'));
                handleAnswer(selected, question, nextBtn, optionButtons);
            });
        });

        nextBtn.addEventListener('click', () => {
            state.currentIndex += 1;
            state.answered = false;
            state.selectedAnswer = -1;
            render();
        });
    }

    function handleAnswer(selected, question, nextBtn, optionButtons) {
        state.answered = true;
        state.selectedAnswer = selected;

        const answer = Number(question.answer);
        const isCorrect = selected === answer;
        if (isCorrect) state.score += 1;

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

        if (nextBtn) nextBtn.disabled = false;
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

        const existing = document.getElementById('quiz-wrong-answer-modal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.className = 'quiz-wrong-modal';
        modal.id = 'quiz-wrong-answer-modal';
        modal.innerHTML = `
            <div class="quiz-wrong-modal-card" role="dialog" aria-modal="true" aria-labelledby="quiz-wrong-title">
                <h3 id="quiz-wrong-title" class="quiz-wrong-title">${escapeHtml(t('quiz.feedbackWrong'))}</h3>
                <p class="quiz-wrong-modal-row"><strong class="quiz-correct-answer-label">${escapeHtml(t('quiz.correctAnswerLabel'))}</strong> <span class="quiz-correct-answer-value">${escapeHtml(correctAnswer)}</span></p>
                <p class="quiz-wrong-modal-row">${escapeHtml(explanation)}</p>
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
        stage.className = 'quiz-stage';
        stage.innerHTML = `
            <div class="quiz-result">
                <h2>${escapeHtml(t(titleKey))}</h2>
                <p class="quiz-result-score">${escapeHtml(t('quiz.resultScore', { score: state.score, total }))}</p>
                <div class="quiz-score-badge ${scoreBadgeClass}">${state.score}/${total}</div>
                <div class="quiz-result-actions">
                    <button class="quiz-action-btn primary" type="button" id="quiz-restart-category">${escapeHtml(t('quiz.retryCategory'))}</button>
                    <button class="quiz-action-btn" type="button" id="quiz-change-category">${escapeHtml(t('quiz.chooseAnotherCategory'))}</button>
                </div>
            </div>
        `;

        stage.querySelector('#quiz-restart-category').addEventListener('click', () => {
            state.sessionQuestions = buildSessionQuestions(state.categoryKey);
            state.currentIndex = 0;
            state.score = 0;
            state.answered = false;
            state.selectedAnswer = -1;
            state.resultCommitted = false;
            render();
        });

        stage.querySelector('#quiz-change-category').addEventListener('click', () => {
            state.categoryKey = null;
            state.sessionQuestions = [];
            state.currentIndex = 0;
            state.score = 0;
            state.answered = false;
            state.selectedAnswer = -1;
            state.resultCommitted = false;
            render();
        });

        renderTopStats();
    }

    function getScoreBadgeClass(score, total) {
        if (score === total) return 'is-green';
        if (score > 5) return 'is-orange';
        return 'is-red';
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

    function loadQuestionImage(imageEl, question, categoryKey, number) {
        const explicit = typeof question.image === 'string' ? question.image : '';
        const folder = CATEGORY_FOLDERS[categoryKey] || categoryKey;
        const fallbackBase = 'assets/quiz-images/' + folder + '/q' + String(number).padStart(2, '0');

        const candidates = [];
        if (explicit) candidates.push(explicit);
        candidates.push(fallbackBase + '.jpg', fallbackBase + '.jpeg', fallbackBase + '.png', fallbackBase + '.webp');

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
        initBackgroundSlideshow();
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
    }

    if (window.i18nReady) {
        window.i18nReady.then(init);
    } else if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
