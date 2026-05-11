(function () {
    'use strict';

    const STYLE_ID = 'serviceVoiceAssistantStyle';
    const ROOT_ID = 'serviceVoiceAssistantWidget';
    const DEFAULT_STAGES = [1, 2, 3, 4, 5];

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            .service-voice-widget {
                position: fixed;
                right: 16px;
                bottom: 18px;
                z-index: 9999;
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 10px;
                border-radius: 14px;
                background: rgba(5, 10, 25, 0.9);
                border: 1px solid rgba(0, 255, 140, 0.35);
                box-shadow: 0 10px 28px rgba(0, 0, 0, 0.4);
                backdrop-filter: blur(8px);
            }
            .service-voice-widget.hidden {
                display: none !important;
            }
            .service-voice-main {
                width: 44px;
                height: 44px;
                border-radius: 999px;
                border: none;
                background: linear-gradient(135deg, #00ff8f, #00b7ff);
                color: #031016;
                cursor: pointer;
                font-size: 17px;
                font-weight: 700;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: transform 0.2s ease, box-shadow 0.2s ease;
                box-shadow: 0 0 0 3px rgba(0, 255, 140, 0.2);
            }
            .service-voice-main:hover {
                transform: translateY(-1px) scale(1.02);
                box-shadow: 0 0 0 3px rgba(0, 255, 140, 0.3), 0 8px 16px rgba(0, 0, 0, 0.25);
            }
            .service-voice-widget.speaking .service-voice-main {
                animation: serviceVoicePulse 1.2s ease-in-out infinite;
            }
            @keyframes serviceVoicePulse {
                0% { box-shadow: 0 0 0 0 rgba(0, 255, 140, 0.55); }
                70% { box-shadow: 0 0 0 12px rgba(0, 255, 140, 0.02); }
                100% { box-shadow: 0 0 0 0 rgba(0, 255, 140, 0); }
            }
            .service-voice-boxes {
                display: flex;
                gap: 6px;
            }
            .service-voice-box-btn {
                min-width: 34px;
                height: 34px;
                border-radius: 10px;
                border: 1px solid rgba(88, 255, 190, 0.35);
                background: rgba(4, 20, 34, 0.95);
                color: #ccffe9;
                font-weight: 700;
                font-size: 13px;
                cursor: pointer;
                transition: background 0.2s ease, transform 0.2s ease, opacity 0.2s ease;
            }
            .service-voice-box-btn:hover:enabled {
                background: rgba(13, 35, 56, 0.98);
                transform: translateY(-1px);
            }
            .service-voice-box-btn:disabled {
                opacity: 0.35;
                cursor: not-allowed;
            }
            .service-voice-box-btn.active-stage {
                border-color: rgba(0, 255, 140, 0.75);
                color: #00ff8f;
            }
            .service-voice-widget.needs-gesture::after {
                content: attr(data-voice-hint);
                position: absolute;
                right: 0;
                bottom: 56px;
                background: rgba(0, 0, 0, 0.85);
                color: #e7fff6;
                padding: 6px 10px;
                border-radius: 10px;
                font-size: 12px;
                font-weight: 600;
                white-space: nowrap;
                box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
            }
        `;

        document.head.appendChild(style);
    }

    function normalizeStages(rawStages) {
        if (!Array.isArray(rawStages) || !rawStages.length) {
            return DEFAULT_STAGES.slice();
        }

        const normalized = rawStages
            .map((stage) => Math.max(1, Math.min(5, parseInt(stage, 10) || 1)))
            .filter((stage, index, arr) => arr.indexOf(stage) === index)
            .sort((a, b) => a - b);

        return normalized.length ? normalized : DEFAULT_STAGES.slice();
    }

    function normalizeStage(rawStage, stages) {
        const activeStages = Array.isArray(stages) && stages.length ? stages : DEFAULT_STAGES;
        const stage = parseInt(rawStage, 10);
        if (!Number.isFinite(stage)) return activeStages[0];
        if (activeStages.includes(stage)) return stage;
        if (stage < activeStages[0]) return activeStages[0];
        return activeStages[activeStages.length - 1];
    }

    function detectVoiceLanguage(message, selectedLanguage) {
        if (selectedLanguage && selectedLanguage !== 'auto') return selectedLanguage;
        return /[\u0980-\u09FF]/.test(message) ? 'bn' : 'en';
    }

    function getLanguageCode(lang) {
        return lang === 'bn' ? 'bn-BD' : 'en-US';
    }

    function pickVoice(langCode) {
        const voices = window.speechSynthesis.getVoices() || [];
        if (!voices.length) return null;

        const prefix = String(langCode || '').slice(0, 2).toLowerCase();
        const matches = voices.filter((voice) => String(voice.lang || '').toLowerCase().startsWith(prefix));
        if (!matches.length) return voices[0];

        const preferred = matches.find((voice) => /female|woman|girl/i.test(String(voice.name || '')));
        return preferred || matches[0];
    }

    function createWidget(stages) {
        let root = document.getElementById(ROOT_ID);
        if (!root) {
            root = document.createElement('div');
            root.id = ROOT_ID;
            root.className = 'service-voice-widget hidden';
            document.body.appendChild(root);
        }

        const stageButtonsMarkup = (stages || []).map((stage) => (
            `<button class="service-voice-box-btn" data-stage="${stage}" type="button" aria-label="Play stage ${stage}">${stage}</button>`
        )).join('');

        root.innerHTML = `
            <button class="service-voice-main" id="serviceVoiceMainBtn" type="button" aria-label="Play voice">
                <i class="fas fa-microphone-alt"></i>
            </button>
            <div class="service-voice-boxes">
                ${stageButtonsMarkup}
            </div>
        `;
        root.setAttribute('data-voice-hint', 'Tap to enable voice');

        return {
            root,
            mainButton: root.querySelector('#serviceVoiceMainBtn'),
            stageButtons: Array.from(root.querySelectorAll('[data-stage]'))
        };
    }

    function normalizeItems(items, stages) {
        const activeStages = Array.isArray(stages) && stages.length ? stages : DEFAULT_STAGES;
        const byStage = {};

        (items || []).forEach((raw) => {
            const stage = parseInt(raw.stage_key || raw.page_key, 10);
            if (!Number.isFinite(stage) || !activeStages.includes(stage)) return;
            const repeatRaw = parseInt(raw.repeat_count, 10);
            const languageRaw = String(raw.language || 'auto').toLowerCase();

            byStage[stage] = {
                stage_key: stage,
                message: String(raw.message || ''),
                language: ['auto', 'bn', 'en'].includes(languageRaw) ? languageRaw : 'auto',
                repeat_count: Number.isFinite(repeatRaw) ? Math.max(1, Math.min(2, repeatRaw)) : 1,
                is_active: raw.is_active ? 1 : 0,
                autoplay: raw.autoplay ? 1 : 0
            };
        });

        activeStages.forEach((stage) => {
            if (!byStage[stage]) {
                byStage[stage] = {
                    stage_key: stage,
                    message: '',
                    language: 'auto',
                    repeat_count: 1,
                    is_active: 1,
                    autoplay: 1
                };
            }
        });

        return byStage;
    }

    function isPlayable(item) {
        return !!(item && item.is_active && String(item.message || '').trim());
    }

    function getPlayableStageItem(state, stageKey) {
        const stage = normalizeStage(stageKey, state.stages);
        const item = state.byStage ? state.byStage[stage] : null;
        return isPlayable(item) ? item : null;
    }

    function updateWidgetButtons(state, currentStage) {
        const hasAnyPlayable = state.stages.some((stage) => !!getPlayableStageItem(state, stage));
        if (!hasAnyPlayable) {
            state.root.classList.add('hidden');
            state.root.classList.remove('speaking');
            return;
        }

        state.root.classList.remove('hidden');

        state.stageButtons.forEach((btn) => {
            const stage = normalizeStage(btn.getAttribute('data-stage'), state.stages);
            const item = getPlayableStageItem(state, stage);
            btn.disabled = !item;
            btn.classList.toggle('active-stage', stage === currentStage);
            if (item && item.message) {
                btn.title = item.message;
            } else {
                btn.removeAttribute('title');
            }
        });
    }

    function speakItem(item, state) {
        if (!item || !('speechSynthesis' in window)) return;

        const message = String(item.message || '').trim();
        if (!message) return;

        const repeatCount = Math.max(1, Math.min(2, parseInt(item.repeat_count, 10) || 1));
        const lang = detectVoiceLanguage(message, item.language || 'auto');
        const langCode = getLanguageCode(lang);

        window.speechSynthesis.cancel();
        state.root.classList.remove('speaking');

        let played = 0;
        const token = `${Date.now()}-${Math.random()}`;
        state.speechToken = token;

        const playOnce = () => {
            if (state.speechToken !== token) return;
            if (played >= repeatCount) {
                state.root.classList.remove('speaking');
                return;
            }

            const utterance = new SpeechSynthesisUtterance(message);
            utterance.lang = langCode;
            utterance.rate = 0.95;
            utterance.pitch = 1.05;
            const voice = pickVoice(langCode);
            if (voice) utterance.voice = voice;

            let started = false;
            const startTimer = setTimeout(() => {
                if (started || state.speechToken !== token) return;
                state.pendingItem = item;
                state.pendingToken = token;
                state.root.classList.add('needs-gesture');
            }, 1200);

            utterance.onstart = () => {
                started = true;
                clearTimeout(startTimer);
                if (state.speechToken === token) state.root.classList.add('speaking');
                if (state.pendingToken === token) {
                    state.pendingItem = null;
                    state.pendingToken = null;
                    state.root.classList.remove('needs-gesture');
                }
            };
            utterance.onend = () => {
                clearTimeout(startTimer);
                if (state.speechToken !== token) return;
                played += 1;
                if (played < repeatCount) {
                    setTimeout(playOnce, 300);
                } else {
                    state.root.classList.remove('speaking');
                }
            };
            utterance.onerror = () => {
                clearTimeout(startTimer);
                if (state.speechToken === token) state.root.classList.remove('speaking');
                if (!state.userInteracted) {
                    state.pendingItem = item;
                    state.pendingToken = token;
                    state.root.classList.add('needs-gesture');
                }
            };

            window.speechSynthesis.speak(utterance);
        };

        if (!window.speechSynthesis.getVoices().length) {
            let playedFallback = false;
            const fallbackTimer = setTimeout(() => {
                playedFallback = true;
                playOnce();
            }, 250);

            window.speechSynthesis.onvoiceschanged = () => {
                if (playedFallback) return;
                clearTimeout(fallbackTimer);
                window.speechSynthesis.onvoiceschanged = null;
                playOnce();
            };
        } else {
            playOnce();
        }
    }

    async function parseServiceVoiceResponse(response) {
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            return response.json();
        }
        const text = (await response.text()).trim();
        return {
            success: false,
            message: text || 'Unexpected server response'
        };
    }

    function buildServiceVoiceError(path, response, result) {
        const rawMessage = String((result && result.message) || '').trim();
        const normalized = rawMessage.replace(/\s+/g, ' ').trim();
        const isHtmlBody = /^<!doctype html>/i.test(normalized) || /^<html/i.test(normalized);
        const isMissingApiRoute = /Cannot (GET|POST|PUT|DELETE) \/api\//i.test(normalized);

        if (isHtmlBody) {
            return `API returned HTML (not JSON) for ${path}. Fix FastPanel/Proxy so /api/* goes to Node app.`;
        }

        if (response && response.status === 404 && isMissingApiRoute) {
            return `API route not found: ${path}. Deploy latest server.js and restart Node app.`;
        }

        if (normalized) return normalized;
        if (response && response.status) return `HTTP ${response.status}`;
        return 'Service voice data unavailable';
    }

    async function fetchServiceVoiceItems(serviceKey) {
        const endpointPath = `/api/service-voice-assistant?service_key=${encodeURIComponent(serviceKey)}&t=${Date.now()}`;
        const response = await fetch(endpointPath, {
            cache: 'no-cache',
            headers: { 'Cache-Control': 'no-cache' }
        });
        const result = await parseServiceVoiceResponse(response);

        if (!response.ok || !result.success) {
            throw new Error(buildServiceVoiceError(endpointPath, response, result));
        }

        return result.items || [];
    }

    function applyStageState(state, stageKey, withAutoplay) {
        const stage = normalizeStage(stageKey, state.stages);
        const changed = state.currentStage !== stage;
        state.currentStage = stage;

        updateWidgetButtons(state, stage);

        if (!changed || !withAutoplay) return;

        const item = getPlayableStageItem(state, stage);
        if (!item || !item.autoplay) return;

        const signature = `${stage}:${item.message}:${item.language}:${item.repeat_count}`;
        if (state.lastAutoplaySignature === signature) return;

        state.lastAutoplaySignature = signature;
        if (!state.userInteracted) {
            state.autoplayPending = item;
        }
        setTimeout(() => {
            try {
                const langCode = getLanguageCode(detectVoiceLanguage(String(item.message || ''), item.language || 'auto'));
                const prime = new SpeechSynthesisUtterance(' ');
                prime.lang = langCode;
                prime.rate = 1;
                prime.pitch = 1;
                prime.volume = 0;
                prime.onend = () => speakItem(item, state);
                prime.onerror = () => speakItem(item, state);
                window.speechSynthesis.speak(prime);
            } catch (_) {
                speakItem(item, state);
            }
        }, 360);
    }

    function initServiceVoiceAssistant(options) {
        const opts = options || {};
        const serviceKey = String(opts.serviceKey || '').trim();
        if (!serviceKey) return null;
        if (!('speechSynthesis' in window)) return null;
        const stages = normalizeStages(opts.stages);

        if (typeof window.__serviceVoiceAssistantDestroy === 'function') {
            try {
                window.__serviceVoiceAssistantDestroy();
            } catch (error) {
                console.error('Service voice assistant cleanup error:', error);
            }
        }

        injectStyles();
        const widget = createWidget(stages);

        const state = {
            root: widget.root,
            mainButton: widget.mainButton,
            stageButtons: widget.stageButtons,
            stages,
            byStage: {},
            currentStage: null,
            speechToken: null,
            lastAutoplaySignature: '',
            userInteracted: false,
            pendingItem: null,
            pendingToken: null,
            autoplayPending: null
        };

        const detectStageKey = typeof opts.detectStageKey === 'function'
            ? () => normalizeStage(opts.detectStageKey(), stages)
            : () => stages[0];

        const unlockFromGesture = () => {
            if (state.userInteracted) return;
            state.userInteracted = true;
            state.root.classList.remove('needs-gesture');
            if ('speechSynthesis' in window) {
                try {
                    window.speechSynthesis.resume();
                } catch (error) {}
            }
            if (state.pendingItem) {
                const pending = state.pendingItem;
                state.pendingItem = null;
                state.pendingToken = null;
                speakItem(pending, state);
                return;
            }
            if (state.autoplayPending) {
                const pending = state.autoplayPending;
                state.autoplayPending = null;
                speakItem(pending, state);
            }
        };

        document.addEventListener('pointerdown', unlockFromGesture, { once: true, passive: true });
        document.addEventListener('touchstart', unlockFromGesture, { once: true, passive: true });
        document.addEventListener('keydown', unlockFromGesture, { once: true });
        document.addEventListener('click', unlockFromGesture, { once: true, passive: true });

        async function refreshData(withAutoplay) {
            try {
                const items = await fetchServiceVoiceItems(serviceKey);
                state.byStage = normalizeItems(items, stages);
                applyStageState(state, detectStageKey(), !!withAutoplay);
            } catch (error) {
                console.error('Error loading service voice assistant:', error);
                state.root.classList.add('hidden');
            }
        }

        function playCurrentStage() {
            const stage = state.currentStage || detectStageKey();
            const item = getPlayableStageItem(state, stage);
            if (item) speakItem(item, state);
        }

        state.mainButton.onclick = (event) => {
            event.preventDefault();
            state.userInteracted = true;
            state.root.classList.remove('needs-gesture');
            playCurrentStage();
        };

        state.stageButtons.forEach((btn) => {
            btn.onclick = (event) => {
                event.preventDefault();
                state.userInteracted = true;
                state.root.classList.remove('needs-gesture');
                const stage = normalizeStage(btn.getAttribute('data-stage'), stages);
                const item = getPlayableStageItem(state, stage);
                if (item) speakItem(item, state);
            };
        });

        const stagePollInterval = Math.max(250, parseInt(opts.pollInterval, 10) || 350);
        const dataRefreshInterval = Math.max(2500, parseInt(opts.dataRefreshInterval, 10) || 8000);

        const stagePoller = setInterval(() => {
            applyStageState(state, detectStageKey(), true);
        }, stagePollInterval);

        const dataPoller = setInterval(() => {
            refreshData(false);
        }, dataRefreshInterval);

        refreshData(true);

        const destroy = () => {
            clearInterval(stagePoller);
            clearInterval(dataPoller);
            state.root.classList.remove('speaking');
            state.root.classList.add('hidden');
            if ('speechSynthesis' in window) {
                window.speechSynthesis.cancel();
            }
        };

        window.__serviceVoiceAssistantDestroy = destroy;

        return {
            destroy,
            refresh: () => refreshData(false)
        };
    }

    window.initServiceVoiceAssistant = initServiceVoiceAssistant;
})();
