(function (global) {
    'use strict';

    var STORAGE_KEY = 'safeVerificationDemoConfig';
    var memoryStore = {};
    var channel = null;

    function getStorage() {
        if (global.localStorage && typeof global.localStorage.getItem === 'function') {
            return global.localStorage;
        }

        return {
            getItem: function (key) {
                return Object.prototype.hasOwnProperty.call(memoryStore, key) ? memoryStore[key] : null;
            },
            setItem: function (key, value) {
                memoryStore[key] = String(value);
            },
            removeItem: function (key) {
                delete memoryStore[key];
            }
        };
    }

    function getChannel() {
        if (channel || typeof global.BroadcastChannel !== 'function') {
            return channel;
        }

        try {
            channel = new global.BroadcastChannel('safe-verification-demo');
        } catch (error) {
            channel = null;
        }

        return channel;
    }

    function normalizeConfig(raw) {
        if (!raw || typeof raw !== 'object') {
            return null;
        }

        var code = String(raw.code || '').trim();
        var message = String(raw.message || '').trim();
        var updatedAt = String(raw.updatedAt || '').trim();

        if (!code || !message) {
            return null;
        }

        return {
            code: code,
            message: message,
            updatedAt: updatedAt || new Date().toISOString()
        };
    }

    function readConfig() {
        try {
            var rawValue = getStorage().getItem(STORAGE_KEY);
            if (!rawValue) {
                return null;
            }
            return normalizeConfig(JSON.parse(rawValue));
        } catch (error) {
            return null;
        }
    }

    function broadcast(type, payload) {
        var activeChannel = getChannel();
        if (!activeChannel) {
            return;
        }

        try {
            activeChannel.postMessage({ type: type, payload: payload || null });
        } catch (error) {
            // Ignore sync issues in unsupported environments.
        }
    }

    function saveConfig(code, message) {
        var config = normalizeConfig({
            code: code,
            message: message,
            updatedAt: new Date().toISOString()
        });

        if (!config) {
            throw new Error('Both code and message are required.');
        }

        getStorage().setItem(STORAGE_KEY, JSON.stringify(config));
        broadcast('config-saved', config);
        return config;
    }

    function clearConfig() {
        getStorage().removeItem(STORAGE_KEY);
        broadcast('config-cleared', null);
    }

    function verifyCode(inputCode) {
        var config = readConfig();
        var normalizedInput = String(inputCode || '').trim();

        if (!config) {
            return {
                ok: false,
                reason: 'missing-config',
                message: '',
                config: null
            };
        }

        if (!normalizedInput) {
            return {
                ok: false,
                reason: 'missing-input',
                message: '',
                config: config
            };
        }

        if (normalizedInput !== config.code) {
            return {
                ok: false,
                reason: 'mismatch',
                message: '',
                config: config
            };
        }

        return {
            ok: true,
            reason: 'matched',
            message: config.message,
            config: config
        };
    }

    function formatDate(value) {
        if (!value) {
            return 'Not saved yet';
        }

        var date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return 'Not saved yet';
        }

        return date.toLocaleString();
    }

    function setText(node, value) {
        if (node) {
            node.textContent = value;
        }
    }

    function renderAdminState(doc) {
        var config = readConfig();
        var codeValue = doc.getElementById('savedCodeValue');
        var messageValue = doc.getElementById('savedMessageValue');
        var updatedValue = doc.getElementById('savedUpdatedValue');
        var statePill = doc.getElementById('savedStatePill');

        if (!config) {
            setText(codeValue, 'No code saved');
            setText(messageValue, 'No message saved');
            setText(updatedValue, 'Waiting for setup');
            setText(statePill, 'Not configured');
            if (statePill) {
                statePill.dataset.state = 'idle';
            }
            return;
        }

        setText(codeValue, config.code);
        setText(messageValue, config.message);
        setText(updatedValue, formatDate(config.updatedAt));
        setText(statePill, 'Ready');
        if (statePill) {
            statePill.dataset.state = 'ready';
        }
    }

    function renderUserAvailability(doc) {
        var config = readConfig();
        var availability = doc.getElementById('demoAvailability');
        if (!availability) {
            return;
        }

        if (!config) {
            availability.dataset.state = 'idle';
            availability.textContent = 'Demo is not configured yet. Save a code and message in the admin demo first.';
            return;
        }

        availability.dataset.state = 'ready';
        availability.textContent = 'Demo is ready. Enter the saved code to reveal the completion message.';
    }

    function renderUserResult(doc, result) {
        var panel = doc.getElementById('resultPanel');
        var badge = doc.getElementById('resultBadge');
        var title = doc.getElementById('resultTitle');
        var detail = doc.getElementById('resultDetail');
        var message = doc.getElementById('resultMessage');
        var updated = doc.getElementById('resultUpdated');

        if (!panel || !badge || !title || !detail || !message || !updated) {
            return;
        }

        panel.hidden = false;

        if (result.ok) {
            panel.dataset.state = 'success';
            setText(badge, 'Completed');
            setText(title, 'Verification completed');
            setText(detail, 'The entered code matched the current demo configuration.');
            setText(message, result.message);
            setText(updated, 'Saved at: ' + formatDate(result.config && result.config.updatedAt));
            return;
        }

        panel.dataset.state = 'pending';

        if (result.reason === 'missing-config') {
            setText(badge, 'Setup needed');
            setText(title, 'Demo not configured');
            setText(detail, 'Open the admin demo page, save a code and a success message, then try again.');
            setText(message, 'No completion message is available yet.');
            setText(updated, 'Saved at: Not saved yet');
            return;
        }

        if (result.reason === 'missing-input') {
            setText(badge, 'Code needed');
            setText(title, 'Enter a code first');
            setText(detail, 'Type the demo code before running the verification check.');
            setText(message, 'The admin-set message will appear here after a successful match.');
            setText(updated, 'Saved at: ' + formatDate(result.config && result.config.updatedAt));
            return;
        }

        setText(badge, 'Not matched');
        setText(title, 'Verification pending');
        setText(detail, 'The entered code did not match the saved demo code.');
        setText(message, 'No completion message is shown until the code matches.');
        setText(updated, 'Saved at: ' + formatDate(result.config && result.config.updatedAt));
    }

    function initAdminPage(doc) {
        var form = doc.getElementById('adminDemoForm');
        var codeInput = doc.getElementById('demoCodeInput');
        var messageInput = doc.getElementById('demoMessageInput');
        var feedback = doc.getElementById('adminFeedback');
        var clearButton = doc.getElementById('clearDemoBtn');
        var currentConfig = readConfig();

        if (!form || !codeInput || !messageInput) {
            return;
        }

        if (currentConfig) {
            codeInput.value = currentConfig.code;
            messageInput.value = currentConfig.message;
        }

        renderAdminState(doc);

        form.addEventListener('submit', function (event) {
            event.preventDefault();

            try {
                var config = saveConfig(codeInput.value, messageInput.value);
                feedback.textContent = 'Demo saved. Matching code will now show the success message.';
                feedback.dataset.state = 'success';
                codeInput.value = config.code;
                messageInput.value = config.message;
                renderAdminState(doc);
            } catch (error) {
                feedback.textContent = error.message || 'Unable to save the demo right now.';
                feedback.dataset.state = 'error';
            }
        });

        if (clearButton) {
            clearButton.addEventListener('click', function () {
                clearConfig();
                codeInput.value = '';
                messageInput.value = '';
                feedback.textContent = 'Demo cleared. The user page will wait for a new setup.';
                feedback.dataset.state = 'neutral';
                renderAdminState(doc);
            });
        }
    }

    function initUserPage(doc) {
        var form = doc.getElementById('userDemoForm');
        var input = doc.getElementById('userCodeInput');

        if (!form || !input) {
            return;
        }

        renderUserAvailability(doc);
        renderUserResult(doc, verifyCode(''));

        form.addEventListener('submit', function (event) {
            event.preventDefault();
            renderUserAvailability(doc);
            renderUserResult(doc, verifyCode(input.value));
        });
    }

    function refreshDocumentState(doc) {
        var pageType = doc.body && doc.body.dataset ? doc.body.dataset.demoPage : '';
        if (pageType === 'admin') {
            renderAdminState(doc);
        }
        if (pageType === 'user') {
            var input = doc.getElementById('userCodeInput');
            renderUserAvailability(doc);
            renderUserResult(doc, verifyCode(input ? input.value : ''));
        }
    }

    function initDocument(doc) {
        var pageType = doc.body && doc.body.dataset ? doc.body.dataset.demoPage : '';
        if (pageType === 'admin') {
            initAdminPage(doc);
        }
        if (pageType === 'user') {
            initUserPage(doc);
        }
    }

    function attachRealtimeSync(doc) {
        if (typeof global.addEventListener === 'function') {
            global.addEventListener('storage', function (event) {
                if (!event || event.key !== STORAGE_KEY) {
                    return;
                }
                refreshDocumentState(doc);
            });
        }

        var activeChannel = getChannel();
        if (activeChannel) {
            activeChannel.addEventListener('message', function () {
                refreshDocumentState(doc);
            });
        }
    }

    var api = {
        storageKey: STORAGE_KEY,
        readConfig: readConfig,
        saveConfig: saveConfig,
        clearConfig: clearConfig,
        verifyCode: verifyCode,
        formatDate: formatDate,
        initDocument: initDocument
    };

    global.SafeVerificationDemo = api;

    if (typeof document !== 'undefined') {
        document.addEventListener('DOMContentLoaded', function () {
            initDocument(document);
            attachRealtimeSync(document);
        });
    }
}(typeof window !== 'undefined' ? window : globalThis));
