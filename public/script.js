// Main Frontend Script

// Load WhatsApp Numbers on Landing Page
window.loadWhatsAppNumbers = async function() {
    console.log('loadWhatsAppNumbers called');
    const container = document.getElementById('whatsappCardsContainer');
    const heroContainer = document.getElementById('heroWhatsAppContainer');
    if (!container && !heroContainer) {
        console.log('WhatsApp UI blocks are not present on this page. Skipping render.');
        return;
    }
    if (container) {
        console.log('WhatsApp container found:', container);
    }
    
    try {
        const timestamp = new Date().getTime();
        const response = await fetch(`/api/whatsapp-numbers?t=${timestamp}`, {
            cache: 'no-cache',
            headers: {
                'Cache-Control': 'no-cache'
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        
        console.log('WhatsApp numbers API response:', result);
        if (result.success && result.numbers && result.numbers.length > 0) {
            console.log(`Found ${result.numbers.length} WhatsApp numbers`);
            const cardClasses = ['whatsapp-card-1', 'whatsapp-card-2', 'whatsapp-card-3'];
            const numbersToShow = result.numbers.slice(0, 3);
            
            if (container) {
                container.innerHTML = '';
            }
            // Also populate hero widget if available (vertical stacked cards)
            if (heroContainer) {
                heroContainer.innerHTML = '';
                // header inside hero widget
                const header = document.createElement('div');
                header.className = 'hw-header';
                header.innerHTML = `
                    <div class="hw-title"><i class="fab fa-whatsapp"></i> Contact Us</div>
                    <div class="hw-action">WhatsApp</div>
                `;
                heroContainer.appendChild(header);

                const inner = document.createElement('div');
                inner.className = 'hw-inner';
                heroContainer.appendChild(inner);
            }

            numbersToShow.forEach((number, index) => {
                console.log(`Adding WhatsApp card ${index + 1}:`, number.phone_number);
                const card = document.createElement('div');
                card.className = `whatsapp-card ${cardClasses[index] || 'whatsapp-card-1'}`;
                
                const cleanNumber = number.phone_number.replace(/[^0-9]/g, '');
                const displayNumber = number.phone_number.startsWith('+') 
                    ? number.phone_number 
                    : '+' + number.phone_number;
                
                card.innerHTML = `
                    <div class="whatsapp-icon">
                        <i class="fab fa-whatsapp"></i>
                    </div>
                    <div class="whatsapp-label">WHATSAPP:</div>
                    <div class="whatsapp-number">${displayNumber}</div>
                    <a href="https://wa.me/${cleanNumber}" target="_blank" class="whatsapp-btn" onclick="if(typeof window.openWhatsApp === 'function') { window.openWhatsApp('${cleanNumber}'); } else { window.open('https://wa.me/${cleanNumber}', '_blank'); } return false;">WhatsApp Now</a>
                `;
                
                if (container) {
                    container.appendChild(card);
                }
                // hero widget stacked row
                if (heroContainer) {
                    const inner = heroContainer.querySelector('.hw-inner');
                    if (inner) {
                        const row = document.createElement('div');
                        // left accent color variations
                        const accents = ['accent-blue','accent-yellow','accent-pink'];
                        const accentClass = accents[index] || accents[0];
                        row.className = `hw-item ${accentClass}`;
                        row.innerHTML = `
                            <div class="hw-left ${accentClass}"><i class="fab fa-whatsapp"></i></div>
                            <div class="hw-body">
                                <div class="hw-label">WHATSAPP ${index+1}</div>
                                <div class="hw-number">${displayNumber}</div>
                            </div>
                            <a class="hw-arrow" href="https://wa.me/${cleanNumber}" target="_blank" onclick="if(typeof window.openWhatsApp === 'function'){ window.openWhatsApp('${cleanNumber}'); } return false;">→</a>
                        `;
                        inner.appendChild(row);
                    }
                }
            });
        } else {
            if (container) {
                container.innerHTML = '<div style="text-align: center; color: var(--text-gray); padding: 2rem;">No WhatsApp numbers available</div>';
            }
        }
    } catch (error) {
        console.error('Error loading WhatsApp numbers:', error);
    }
};

// Load Support Team options (Floating Support Menu)
window.loadSupportTeam = async function() {
    const fab = document.getElementById('supportFab');
    const menu = document.getElementById('supportFabMenu');
    if (!fab || !menu) {
        return;
    }

    try {
        const timestamp = new Date().getTime();
        const response = await fetch(`/api/support-team?t=${timestamp}`, {
            cache: 'no-cache',
            headers: {
                'Cache-Control': 'no-cache'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        if (!result.success) {
            throw new Error('Support team data not available');
        }

        const items = [];
        const normalizeHttpUrl = (rawValue, fallbackPrefix = 'https://') => {
            const cleaned = String(rawValue || '').trim();
            if (!cleaned) return '';
            if (/^https?:\/\//i.test(cleaned)) return cleaned;
            return `${fallbackPrefix}${cleaned.replace(/^\/+/, '')}`;
        };

        const whatsappNumber = (result.whatsapp_number || '').trim();
        let primaryWhatsAppClean = '';
        if (whatsappNumber) {
            const clean = whatsappNumber.replace(/[^0-9]/g, '');
            primaryWhatsAppClean = clean;
            if (clean) {
                items.push({
                    key: 'whatsapp',
                    label: 'WhatsApp',
                    icon: 'fab fa-whatsapp',
                    href: `https://wa.me/${clean}`
                });
            }
        }

        const whatsappGroupRaw = (result.whatsapp_group_link || '').trim();
        let whatsappGroupLink = normalizeHttpUrl(whatsappGroupRaw);
        if (!whatsappGroupLink && primaryWhatsAppClean) {
            // Fallback so "WhatsApp Group" button is still visible until admin sets group invite link.
            whatsappGroupLink = `https://wa.me/${primaryWhatsAppClean}`;
        }
        if (whatsappGroupLink) {
            items.push({
                key: 'whatsapp-group',
                label: 'WhatsApp Group',
                icon: 'fab fa-whatsapp',
                href: whatsappGroupLink
            });
        }

        const callNumber = (result.call_number || '').trim();
        if (callNumber) {
            const tel = callNumber.replace(/\s+/g, '');
            items.push({
                key: 'call',
                label: 'Call Now',
                icon: 'fas fa-phone-alt',
                href: `tel:${tel}`
            });
        }

        const messengerLinkRaw = (result.messenger_link || '').trim();
        if (messengerLinkRaw) {
            let messengerLink = messengerLinkRaw;
            if (!/^https?:\/\//i.test(messengerLink)) {
                if (messengerLink.startsWith('m.me/') || messengerLink.startsWith('facebook.com/')) {
                    messengerLink = `https://${messengerLink}`;
                } else {
                    messengerLink = `https://m.me/${messengerLink.replace(/^@/, '')}`;
                }
            }
            items.push({
                key: 'messenger',
                label: 'Messenger',
                icon: 'fab fa-facebook-messenger',
                href: normalizeHttpUrl(messengerLink)
            });
        }

        const telegramRaw = (result.telegram_username || '').trim();
        if (telegramRaw) {
            let telegramLink = telegramRaw;
            if (!/^https?:\/\//i.test(telegramLink)) {
                telegramLink = `https://t.me/${telegramLink.replace(/^@/, '')}`;
            }
            items.push({
                key: 'telegram',
                label: 'Telegram',
                icon: 'fab fa-telegram',
                href: normalizeHttpUrl(telegramLink)
            });
        }

        if (items.length === 0) {
            fab.classList.add('hidden');
            menu.innerHTML = '';
            return;
        }

        fab.classList.remove('hidden');
        menu.innerHTML = items.map(item => {
            const isExternal = /^https?:\/\//i.test(item.href);
            const targetAttrs = isExternal ? ' target="_blank" rel="noopener"' : '';
            return `
                <a class="support-item support-${item.key}" href="${item.href}"${targetAttrs}>
                    <span class="support-icon"><i class="${item.icon}"></i></span>
                    <span class="support-label">${item.label}</span>
                </a>
            `;
        }).join('');

        setupSupportFab();
    } catch (error) {
        console.error('Error loading Support Team:', error);
        if (fab) {
            fab.classList.add('hidden');
        }
    }
};

function setupSupportFab() {
    const fab = document.getElementById('supportFab');
    const toggle = document.getElementById('supportFabToggle');
    const menu = document.getElementById('supportFabMenu');
    if (!fab || !toggle || !menu) {
        return;
    }
    if (fab.dataset.ready === '1') {
        return;
    }
    fab.dataset.ready = '1';

    const closeMenu = () => {
        fab.classList.remove('open');
        menu.setAttribute('aria-hidden', 'true');
    };

    toggle.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const isOpen = fab.classList.toggle('open');
        menu.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    });

    document.addEventListener('click', (event) => {
        if (!fab.contains(event.target)) {
            closeMenu();
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeMenu();
        }
    });
}

// Voice Assistant (Landing Page)
window.loadVoiceAssistant = async function() {
    const container = document.getElementById('voiceAssistant');
    const button = document.getElementById('voiceAssistantBtn');
    if (!container || !button || !('speechSynthesis' in window)) {
        if (container) container.classList.add('hidden');
        return;
    }

    try {
        const timestamp = new Date().getTime();
        const response = await fetch(`/api/voice-assistant?t=${timestamp}`, {
            cache: 'no-cache',
            headers: {
                'Cache-Control': 'no-cache'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        if (!result.success) {
            throw new Error('Voice assistant data not available');
        }

        const message = (result.message || '').trim();
        const isActive = !!result.is_active;
        const repeatCount = Math.min(2, Math.max(1, parseInt(result.repeat_count, 10) || 1));
        const language = (result.language || 'auto').trim();

        if (!isActive || !message) {
            container.classList.add('hidden');
            return;
        }

        container.classList.remove('hidden');

    const voiceState = {
        autoplayPending: false,
        autoplayTriggered: false,
        started: false
    };

    const startSpeaking = () => {
        speakVoiceMessage(message, language, repeatCount, container);
    };

    const startAutoplay = () => {
        if (voiceState.autoplayTriggered) return;
        voiceState.autoplayTriggered = true;
        voiceState.autoplayPending = true;
        const prime = new SpeechSynthesisUtterance(' ');
        prime.lang = getLanguageCode(detectVoiceLanguage(message, language));
        prime.rate = 1;
        prime.pitch = 1;
        prime.volume = 0;
        let primed = false;
        prime.onstart = () => { primed = true; };
        prime.onend = () => {
            speakVoiceMessage(message, language, repeatCount, container, {
                onStart: () => {
                    voiceState.started = true;
                    voiceState.autoplayPending = false;
                },
                onBlocked: () => {
                    voiceState.autoplayPending = true;
                }
            });
        };
        prime.onerror = () => {
            speakVoiceMessage(message, language, repeatCount, container, {
                onStart: () => {
                    voiceState.started = true;
                    voiceState.autoplayPending = false;
                },
                onBlocked: () => {
                    voiceState.autoplayPending = true;
                }
            });
        };
        try { window.speechSynthesis.speak(prime); } catch (_) {}
        speakVoiceMessage(message, language, repeatCount, container, {
            onStart: () => {
                voiceState.started = true;
                voiceState.autoplayPending = false;
            },
            onBlocked: () => {
                voiceState.autoplayPending = true;
            }
        });
    };

    const unlockAutoplay = () => {
        try {
            if ('speechSynthesis' in window) {
                window.speechSynthesis.resume();
            }
        } catch (_) {}
        if (!voiceState.started || voiceState.autoplayPending) {
            voiceState.autoplayPending = false;
            speakVoiceMessage(message, language, repeatCount, container, {
                onStart: () => {
                    voiceState.started = true;
                }
            });
        }
    };

        button.onclick = (event) => {
            event.preventDefault();
            startSpeaking();
        };

        if (!window.__voiceAssistantAutoplayed) {
            window.__voiceAssistantAutoplayed = true;
        setTimeout(startAutoplay, 600);
        }

    document.addEventListener('pointerdown', unlockAutoplay, { passive: true });
    document.addEventListener('touchstart', unlockAutoplay, { passive: true });
    document.addEventListener('keydown', unlockAutoplay);
    document.addEventListener('click', unlockAutoplay, { passive: true });
    } catch (error) {
        console.error('Error loading Voice Assistant:', error);
        if (container) container.classList.add('hidden');
    }
};

function detectVoiceLanguage(message, selected) {
    if (selected && selected !== 'auto') return selected;
    const hasBangla = /[\u0980-\u09FF]/.test(message);
    return hasBangla ? 'bn' : 'en';
}

function getLanguageCode(lang) {
    return lang === 'bn' ? 'bn-BD' : 'en-US';
}

function pickVoice(langCode) {
    const voices = window.speechSynthesis.getVoices() || [];
    if (!voices.length) return null;
    const langPrefix = langCode.slice(0, 2).toLowerCase();
    const candidates = voices.filter(v => (v.lang || '').toLowerCase().startsWith(langPrefix));
    if (!candidates.length) return voices[0];
    const preferred = candidates.find(v => /female|woman|girl/i.test(v.name || ''));
    return preferred || candidates[0];
}

function speakVoiceMessage(message, language, repeatCount, container, options) {
    if (!message || !('speechSynthesis' in window)) return;

    const opts = options || {};
    const lang = detectVoiceLanguage(message, language);
    const langCode = getLanguageCode(lang);

    window.speechSynthesis.cancel();

    let played = 0;
    let started = false;
    const playOnce = () => {
        if (played >= repeatCount) {
            if (container) container.classList.remove('speaking');
            return;
        }

        const utterance = new SpeechSynthesisUtterance(message);
        utterance.lang = langCode;

        const voice = pickVoice(langCode);
        if (voice) utterance.voice = voice;
        utterance.rate = 0.95;
        utterance.pitch = 1.05;

        utterance.onstart = () => {
            started = true;
            if (container) container.classList.add('speaking');
            if (typeof opts.onStart === 'function') {
                opts.onStart();
            }
        };
        utterance.onend = () => {
            played += 1;
            if (played < repeatCount) {
                setTimeout(playOnce, 500);
            } else if (container) {
                container.classList.remove('speaking');
            }
        };
        utterance.onerror = () => {
            if (container) container.classList.remove('speaking');
        };

        window.speechSynthesis.speak(utterance);
    };

    if (!window.speechSynthesis.getVoices().length) {
        let triggered = false;
        const trigger = () => {
            if (triggered) return;
            triggered = true;
            window.speechSynthesis.onvoiceschanged = null;
            playOnce();
        };
        window.speechSynthesis.onvoiceschanged = trigger;
        setTimeout(trigger, 350);
    } else {
        playOnce();
    }

    setTimeout(() => {
        if (!started && typeof opts.onBlocked === 'function') {
            opts.onBlocked();
        }
    }, 1200);
}

// Load Site Settings
window.loadSiteSettings = async function() {
    try {
        const timestamp = new Date().getTime();
        const response = await fetch(`/api/settings?t=${timestamp}`, {
            cache: 'no-cache'
        });
        
        if (!response.ok) return;
        
        const result = await response.json();
        
        if (result.success && result.settings) {
            const settings = result.settings;
            
            // Update elements by ID
            const lineOneEl = document.getElementById('hero-title-line-one');
            const lineTwoEl = document.getElementById('hero-title-line-two');
            if ((settings.hero_title_line_one || settings.hero_title_line_two) && lineOneEl && lineTwoEl) {
                lineOneEl.textContent = settings.hero_title_line_one || '';
                lineTwoEl.textContent = settings.hero_title_line_two || '';
            } else if (settings.hero_title && document.getElementById('hero-title')) {
                // fallback: set full title (may contain <br>)
                document.getElementById('hero-title').innerHTML = settings.hero_title;
            }

            if (settings.hero_subtitle && document.getElementById('hero-subtitle')) {
                document.getElementById('hero-subtitle').textContent = settings.hero_subtitle;
            }
            if (settings.hero_description && document.getElementById('hero-description')) {
                document.getElementById('hero-description').textContent = settings.hero_description;
            }
            if (settings.whatsapp_section_title && document.getElementById('whatsapp-section-title')) {
                document.getElementById('whatsapp-section-title').textContent = settings.whatsapp_section_title;
            }
            
            // Services section header
            if (settings.services_section_badge && document.getElementById('services-section-badge')) {
                document.getElementById('services-section-badge').textContent = settings.services_section_badge;
            }
            if (settings.services_section_title && document.getElementById('services-section-title')) {
                document.getElementById('services-section-title').textContent = settings.services_section_title;
            }
            if (settings.services_section_subtitle && document.getElementById('services-section-subtitle')) {
                document.getElementById('services-section-subtitle').textContent = settings.services_section_subtitle;
            }
            
            // Service card titles
            if (settings.service_title_phone && document.getElementById('service-title-phone')) {
                document.getElementById('service-title-phone').textContent = settings.service_title_phone;
            }
            if (settings.service_title_facebook && document.getElementById('service-title-facebook')) {
                document.getElementById('service-title-facebook').textContent = settings.service_title_facebook;
            }
            if (settings.service_title_email && document.getElementById('service-title-email')) {
                document.getElementById('service-title-email').textContent = settings.service_title_email;
            }
            if (settings.service_title_information && document.getElementById('service-title-information')) {
                document.getElementById('service-title-information').textContent = settings.service_title_information;
            }
            if (settings.service_title_social_media && document.getElementById('service-title-social-media')) {
                document.getElementById('service-title-social-media').textContent = settings.service_title_social_media;
            }
            if (settings.service_title_premium_apps && document.getElementById('service-title-premium-apps')) {
                document.getElementById('service-title-premium-apps').textContent = settings.service_title_premium_apps;
            }
            if (settings.service_title_instagram_security && document.getElementById('service-title-instagram-security')) {
                document.getElementById('service-title-instagram-security').textContent = settings.service_title_instagram_security;
            }

            if (settings.proof_section_badge && document.getElementById('proof-section-badge')) {
                document.getElementById('proof-section-badge').textContent = settings.proof_section_badge;
            }
            if (settings.proof_section_title && document.getElementById('proof-section-title')) {
                document.getElementById('proof-section-title').textContent = settings.proof_section_title;
            }
            if (settings.proof_section_subtitle && document.getElementById('proof-section-subtitle')) {
                document.getElementById('proof-section-subtitle').textContent = settings.proof_section_subtitle;
            }

            if (settings.reviews_section_badge && document.getElementById('review-section-badge')) {
                document.getElementById('review-section-badge').textContent = settings.reviews_section_badge;
            }
            if (settings.reviews_section_title && document.getElementById('review-section-title')) {
                document.getElementById('review-section-title').textContent = settings.reviews_section_title;
            }
            if (settings.reviews_section_subtitle && document.getElementById('review-section-subtitle')) {
                document.getElementById('review-section-subtitle').textContent = settings.reviews_section_subtitle;
            }
            if (settings.reviews_stat_1_value && document.getElementById('review-stat-1-value')) {
                document.getElementById('review-stat-1-value').textContent = settings.reviews_stat_1_value;
            }
            if (settings.reviews_stat_1_label && document.getElementById('review-stat-1-label')) {
                document.getElementById('review-stat-1-label').textContent = settings.reviews_stat_1_label;
            }
            if (settings.reviews_stat_2_value && document.getElementById('review-stat-2-value')) {
                document.getElementById('review-stat-2-value').textContent = settings.reviews_stat_2_value;
            }
            if (settings.reviews_stat_2_label && document.getElementById('review-stat-2-label')) {
                document.getElementById('review-stat-2-label').textContent = settings.reviews_stat_2_label;
            }
            if (settings.reviews_stat_3_value && document.getElementById('review-stat-3-value')) {
                document.getElementById('review-stat-3-value').textContent = settings.reviews_stat_3_value;
            }
            if (settings.reviews_stat_3_label && document.getElementById('review-stat-3-label')) {
                document.getElementById('review-stat-3-label').textContent = settings.reviews_stat_3_label;
            }
            if (settings.reviews_stat_4_value && document.getElementById('review-stat-4-value')) {
                document.getElementById('review-stat-4-value').textContent = settings.reviews_stat_4_value;
            }
            if (settings.reviews_stat_4_label && document.getElementById('review-stat-4-label')) {
                document.getElementById('review-stat-4-label').textContent = settings.reviews_stat_4_label;
            }
        }
    } catch (error) {
        console.error('Error loading site settings:', error);
    }
};

// Load Advanced Tools Content
window.loadToolsContent = async function() {
    try {
        const hasTools = document.querySelector('.tool-card[data-tool-key]');
        if (!hasTools) return;

        const timestamp = new Date().getTime();
        const response = await fetch(`/api/tools-content?t=${timestamp}`, {
            cache: 'no-cache'
        });

        if (!response.ok) return;

        const result = await response.json();
        if (!result.success || !result.tools) return;

        const toolsByKey = {};
        result.tools.forEach(tool => {
            toolsByKey[tool.tool_key] = tool;
        });

        document.querySelectorAll('.tool-card[data-tool-key]').forEach(card => {
            const key = card.getAttribute('data-tool-key');
            const tool = toolsByKey[key];
            if (!tool) return;

            const link = (tool.tool_link || '').trim();
            const fileUrl = tool.has_file ? `/api/tools-file/${encodeURIComponent(key)}` : '';

            if (tool.tool_name) {
                const titleEl = card.querySelector('h3');
                if (titleEl) {
                    titleEl.textContent = tool.tool_name;
                }
            }

            if (link || fileUrl) {
                card.classList.add('tool-card-clickable');
                card.onclick = () => {
                    if (link) {
                        window.open(link, '_blank');
                    } else if (fileUrl) {
                        window.open(fileUrl, '_blank');
                    }
                };
            } else {
                card.classList.remove('tool-card-clickable');
                card.onclick = null;
            }

            let downloadLink = card.querySelector('.tool-download');
            if (tool.has_file) {
                if (!downloadLink) {
                    downloadLink = document.createElement('a');
                    downloadLink.className = 'tool-download';
                    downloadLink.textContent = 'Download';
                    downloadLink.addEventListener('click', (e) => {
                        e.stopPropagation();
                    });
                    card.appendChild(downloadLink);
                }
                downloadLink.href = fileUrl;
                downloadLink.setAttribute('download', '');
            } else if (downloadLink) {
                downloadLink.remove();
            }
        });
    } catch (error) {
        console.error('Error loading tools content:', error);
    }
};

// Load App Download Notification
window.loadAppDownloadNotification = async function() {
    try {
        const response = await fetch('/api/app-download', { cache: 'no-cache' });
        if (!response.ok) return;
        const result = await response.json();
        if (!result.success || !result.app) return;

        const app = result.app;
        if (!app.is_active || !app.has_file) return;

        let toast = document.getElementById('appDownloadToast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'appDownloadToast';
            toast.className = 'app-download-toast';
            toast.innerHTML = `
                <button class="app-download-close" aria-label="Close">×</button>
                <div class="app-download-body">
                    <div class="app-download-thumb">
                        <div class="app-download-thumb-inner"></div>
                    </div>
                    <div class="app-download-content">
                        <div class="app-download-title"></div>
                        <div class="app-download-message"></div>
                        <div class="app-download-actions">
                            <a class="app-download-btn" href="/api/app-download/file" download>Download</a>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(toast);
            const closeBtn = toast.querySelector('.app-download-close');
            if (closeBtn) {
                closeBtn.addEventListener('click', () => {
                    toast.classList.remove('show');
                });
            }
        }

        const titleEl = toast.querySelector('.app-download-title');
        const msgEl = toast.querySelector('.app-download-message');
        const thumbInner = toast.querySelector('.app-download-thumb-inner');
        if (titleEl) titleEl.textContent = app.title || 'Download Our App';
        if (msgEl) msgEl.textContent = app.message || '';

        if (thumbInner) {
            if (app.image) {
                thumbInner.style.backgroundImage = `url("${app.image.replace(/"/g, '&quot;')}")`;
                thumbInner.classList.add('has-image');
            } else {
                thumbInner.style.backgroundImage = '';
                thumbInner.classList.remove('has-image');
            }
        }

        setTimeout(() => {
            toast.classList.add('show');
        }, 800);
    } catch (error) {
        console.error('Error loading app download notification:', error);
    }
};

// Broadcast Push Notification Banner
const seenPushNotificationIds = new Set();
let pushBannerAutoHideTimer = null;
let pushPollSinceIso = '';
let pushPollInitialDone = false;
let pushPollInFlight = false;

function loadSeenPushNotificationIds() {
    try {
        const raw = sessionStorage.getItem('seenPushNotificationIds');
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            parsed.forEach((id) => {
                if (id !== undefined && id !== null) {
                    seenPushNotificationIds.add(String(id));
                }
            });
        }
    } catch (error) {
        console.error('Failed to load seen push notification ids:', error);
    }
}

function saveSeenPushNotificationIds() {
    try {
        const compact = Array.from(seenPushNotificationIds).slice(-200);
        sessionStorage.setItem('seenPushNotificationIds', JSON.stringify(compact));
    } catch (error) {
        console.error('Failed to save seen push notification ids:', error);
    }
}

function parsePushDate(rawValue) {
    const raw = String(rawValue || '').trim();
    if (!raw) return null;

    const withT = raw.includes('T') ? raw : raw.replace(' ', 'T');
    const utcGuess = withT.endsWith('Z') ? withT : `${withT}Z`;
    let parsed = new Date(utcGuess);
    if (!Number.isNaN(parsed.getTime())) return parsed;

    parsed = new Date(withT);
    if (!Number.isNaN(parsed.getTime())) return parsed;
    return null;
}

function updatePushPollSince(notification) {
    const candidateDate = parsePushDate(notification.sent_at || notification.created_at);
    if (!candidateDate) return;

    if (!pushPollSinceIso) {
        pushPollSinceIso = candidateDate.toISOString();
        return;
    }

    const current = parsePushDate(pushPollSinceIso);
    if (!current || candidateDate.getTime() > current.getTime()) {
        pushPollSinceIso = candidateDate.toISOString();
    }
}

function markPushNotificationSeen(notificationId) {
    if (notificationId === undefined || notificationId === null) return;
    seenPushNotificationIds.add(String(notificationId));
    saveSeenPushNotificationIds();
}

function hasSeenPushNotification(notificationId) {
    if (notificationId === undefined || notificationId === null) return false;
    return seenPushNotificationIds.has(String(notificationId));
}

window.showPushBanner = function(payload = {}) {
    const notificationId = payload.notification_id || payload.id || null;
    if (notificationId && hasSeenPushNotification(notificationId)) {
        return;
    }

    let banner = document.getElementById('broadcastPushBanner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'broadcastPushBanner';
        banner.className = 'broadcast-push-banner';
        banner.innerHTML = `
            <button class="broadcast-push-close" aria-label="Close">×</button>
            <div class="broadcast-push-body">
                <div class="broadcast-push-thumb">
                    <div class="broadcast-push-thumb-inner"></div>
                </div>
                <div class="broadcast-push-content">
                    <div class="broadcast-push-title"></div>
                    <div class="broadcast-push-message"></div>
                    <div class="broadcast-push-actions">
                        <a class="broadcast-push-action" target="_blank" rel="noopener">Open</a>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(banner);

        const closeBtn = banner.querySelector('.broadcast-push-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                banner.classList.remove('show');
            });
        }
    }

    const titleEl = banner.querySelector('.broadcast-push-title');
    const msgEl = banner.querySelector('.broadcast-push-message');
    const thumbInner = banner.querySelector('.broadcast-push-thumb-inner');
    const actionEl = banner.querySelector('.broadcast-push-action');
    const clickUrl = String(payload.click_url || '').trim();
    const imageUrl = String(payload.image_url || '').trim();

    if (titleEl) {
        titleEl.textContent = String(payload.title || 'Notification');
    }
    if (msgEl) {
        msgEl.textContent = String(payload.message || '');
    }

    if (thumbInner) {
        if (imageUrl) {
            thumbInner.style.backgroundImage = `url("${imageUrl.replace(/"/g, '&quot;')}")`;
            thumbInner.classList.add('has-image');
        } else {
            thumbInner.style.backgroundImage = '';
            thumbInner.classList.remove('has-image');
        }
    }

    if (actionEl) {
        if (clickUrl) {
            actionEl.style.display = 'inline-flex';
            actionEl.href = clickUrl;
        } else {
            actionEl.removeAttribute('href');
            actionEl.style.display = 'none';
        }
    }

    if (pushBannerAutoHideTimer) {
        clearTimeout(pushBannerAutoHideTimer);
    }
    pushBannerAutoHideTimer = setTimeout(() => {
        banner.classList.remove('show');
    }, 10000);

    requestAnimationFrame(() => {
        banner.classList.add('show');
    });

    if (notificationId) {
        markPushNotificationSeen(notificationId);
    }
};

// Android native WebView can call this directly in foreground notification flow.
window.showNativePushBanner = function(payload) {
    window.showPushBanner(payload || {});
};

window.loadLatestBroadcastNotifications = async function(options = {}) {
    if (pushPollInFlight) return;
    pushPollInFlight = true;

    try {
        const isInitial = !!options.initial;
        const params = new URLSearchParams();
        if (!isInitial && pushPollSinceIso) {
            params.set('since', pushPollSinceIso);
        }

        const endpoint = params.toString()
            ? `/api/notifications/latest?${params.toString()}`
            : '/api/notifications/latest';

        const response = await fetch(endpoint, { cache: 'no-cache' });
        if (!response.ok) return;

        const result = await response.json();
        if (!result.success || !Array.isArray(result.notifications)) return;

        const notifications = result.notifications;
        notifications.forEach((item) => updatePushPollSince(item));

        if (!pushPollSinceIso) {
            pushPollSinceIso = new Date().toISOString();
        }

        if (isInitial && !pushPollInitialDone) {
            const latest = notifications.length ? notifications[notifications.length - 1] : null;
            if (latest) {
                window.showPushBanner(latest);
            }
            pushPollInitialDone = true;
            return;
        }

        notifications.forEach((item) => {
            window.showPushBanner(item);
        });
    } catch (error) {
        console.error('Error loading broadcast notifications:', error);
    } finally {
        pushPollInFlight = false;
    }
};

const SAFE_SUBMISSION_STORAGE_KEY = 'safeSubmissionFlowData';
const SAFE_SUBMISSION_STATUS_KEY = 'safeSubmissionFlowStatus';

function safeSubmissionParse(rawValue, fallbackValue) {
    if (!rawValue) return fallbackValue;
    try {
        return JSON.parse(rawValue);
    } catch (error) {
        console.warn('Failed to parse safe submission data:', error);
        return fallbackValue;
    }
}

function safeSubmissionEscapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

window.safeSubmissionFlow = {
    storageKeys: {
        data: SAFE_SUBMISSION_STORAGE_KEY,
        status: SAFE_SUBMISSION_STATUS_KEY
    },
    escapeHtml: safeSubmissionEscapeHtml,
    formatBytes(bytes) {
        const numericValue = Number(bytes) || 0;
        if (!numericValue) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB'];
        const unitIndex = Math.min(
            Math.floor(Math.log(numericValue) / Math.log(1024)),
            units.length - 1
        );
        const size = numericValue / (1024 ** unitIndex);
        const precision = size >= 10 || unitIndex === 0 ? 0 : 1;
        return `${size.toFixed(precision)} ${units[unitIndex]}`;
    },
    formatDateTime(isoValue) {
        if (!isoValue) return 'Not available';
        const dateValue = new Date(isoValue);
        if (Number.isNaN(dateValue.getTime())) return 'Not available';
        return new Intl.DateTimeFormat(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        }).format(dateValue);
    },
    async readImageFile(file) {
        if (!file) return '';
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
            reader.onerror = () => reject(reader.error || new Error('Unable to read file'));
            reader.readAsDataURL(file);
        });
    },
    getData() {
        return safeSubmissionParse(sessionStorage.getItem(SAFE_SUBMISSION_STORAGE_KEY), {});
    },
    setData(data) {
        const nextData = data && typeof data === 'object' ? data : {};
        sessionStorage.setItem(SAFE_SUBMISSION_STORAGE_KEY, JSON.stringify(nextData));
        return nextData;
    },
    clearData() {
        sessionStorage.removeItem(SAFE_SUBMISSION_STORAGE_KEY);
    },
    getStatus() {
        return safeSubmissionParse(sessionStorage.getItem(SAFE_SUBMISSION_STATUS_KEY), {});
    },
    setStatus(status) {
        const nextStatus = status && typeof status === 'object' ? status : {};
        sessionStorage.setItem(SAFE_SUBMISSION_STATUS_KEY, JSON.stringify(nextStatus));
        return nextStatus;
    },
    clearStatus() {
        sessionStorage.removeItem(SAFE_SUBMISSION_STATUS_KEY);
    },
    clearAll() {
        sessionStorage.removeItem(SAFE_SUBMISSION_STORAGE_KEY);
        sessionStorage.removeItem(SAFE_SUBMISSION_STATUS_KEY);
    },
    renderSummary(container, fields, data, options = {}) {
        if (!container || !Array.isArray(fields)) return;
        const emptyLabel = options.emptyLabel || 'Not provided';
        const summaryMarkup = fields.map((field) => {
            const rawValue = data ? data[field.key] : '';
            const hasValue = rawValue !== undefined && rawValue !== null && String(rawValue).trim() !== '';
            const formattedValue = hasValue
                ? (typeof field.format === 'function' ? field.format(rawValue, data) : String(rawValue))
                : emptyLabel;

            return `
                <article class="summary-item">
                    <span class="summary-label">${safeSubmissionEscapeHtml(field.label)}</span>
                    <strong class="summary-value">${safeSubmissionEscapeHtml(formattedValue)}</strong>
                </article>
            `;
        }).join('');

        container.innerHTML = summaryMarkup;
    },
    goBack(fallbackUrl = '/') {
        if (window.history.length > 1) {
            window.history.back();
            return;
        }
        window.location.href = fallbackUrl;
    }
};

loadSeenPushNotificationIds();

// Initialize on page load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
        if (typeof window.loadWhatsAppNumbers === 'function') {
            window.loadWhatsAppNumbers();
        }
        if (typeof window.loadSiteSettings === 'function') {
            window.loadSiteSettings();
        }
        if (typeof window.loadToolsContent === 'function') {
            window.loadToolsContent();
        }
        if (typeof window.loadAppDownloadNotification === 'function') {
            window.loadAppDownloadNotification();
        }
        if (typeof window.loadLatestBroadcastNotifications === 'function') {
            window.loadLatestBroadcastNotifications({ initial: true });
        }
    });
} else {
    if (typeof window.loadWhatsAppNumbers === 'function') {
        window.loadWhatsAppNumbers();
    }
    if (typeof window.loadSiteSettings === 'function') {
        window.loadSiteSettings();
    }
    if (typeof window.loadToolsContent === 'function') {
        window.loadToolsContent();
    }
    if (typeof window.loadAppDownloadNotification === 'function') {
        window.loadAppDownloadNotification();
    }
    if (typeof window.loadLatestBroadcastNotifications === 'function') {
        window.loadLatestBroadcastNotifications({ initial: true });
    }
}

// Hero typing animation
window.startHeroTyping = function(words = ['Secure','Protected','Fast'], speed = 80, pause = 1400) {
    const el = document.getElementById('heroTyping');
    if (!el) return;
    let wordIndex = 0;
    let charIndex = 0;
    let deleting = false;

    el.classList.add('typing-wrap');
    const cursor = document.createElement('span');
    cursor.className = 'typing-cursor';
    cursor.textContent = '█';
    el.appendChild(cursor);

    function tick() {
        const word = words[wordIndex];
        if (!deleting) {
            charIndex++;
            el.innerHTML = `<span class="typing-text">${word.substring(0, charIndex)}</span>`;
            el.appendChild(cursor);
            if (charIndex === word.length) {
                deleting = true;
                setTimeout(tick, pause);
                return;
            }
            setTimeout(tick, speed);
        } else {
            charIndex--;
            el.innerHTML = `<span class="typing-text">${word.substring(0, charIndex)}</span>`;
            el.appendChild(cursor);
            if (charIndex === 0) {
                deleting = false;
                wordIndex = (wordIndex + 1) % words.length;
                setTimeout(tick, 200);
                return;
            }
            setTimeout(tick, speed / 2);
        }
    }
    tick();
};

// Ensure hero typing starts
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
        window.startHeroTyping();
    });
} else {
    window.startHeroTyping();
}

// Auto-refresh
setInterval(() => {
    if (typeof window.loadWhatsAppNumbers === 'function') {
        window.loadWhatsAppNumbers();
    }
    if (typeof window.loadSiteSettings === 'function') {
        window.loadSiteSettings();
    }
}, 2000);

setInterval(() => {
    if (typeof window.loadLatestBroadcastNotifications === 'function') {
        window.loadLatestBroadcastNotifications();
    }
}, 15000);

// WhatsApp Open Function - Universal
window.openWhatsApp = function(phoneNumber) {
    try {
        // Remove any non-digit characters
        const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
        
        // Validate phone number
        if (!cleanNumber || cleanNumber.length < 10) {
            console.error('Invalid WhatsApp number:', phoneNumber);
            alert('Invalid WhatsApp number. Please contact support.');
            return false;
        }
        
        // Construct WhatsApp URL
        const whatsappUrl = `https://wa.me/${cleanNumber}`;
        
        console.log('Opening WhatsApp:', whatsappUrl);
        
        // Open WhatsApp in new tab
        const newWindow = window.open(whatsappUrl, '_blank');
        
        // Check if popup was blocked
        if (!newWindow || newWindow.closed || typeof newWindow.closed == 'undefined') {
            // Fallback: try direct navigation
            window.location.href = whatsappUrl;
        }
        
        return false;
    } catch (error) {
        console.error('Error opening WhatsApp:', error);
        // Fallback: try direct navigation
        const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
        window.location.href = `https://wa.me/${cleanNumber}`;
        return false;
    }
};
