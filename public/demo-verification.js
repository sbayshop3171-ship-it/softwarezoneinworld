(function (global) {
    'use strict';

    var LOCKED_VALUE = '••••••••••••';
    var DEFAULT_LOCKED_NOTE = 'Sample value stays hidden until a valid demo code is confirmed.';
    var DEFAULT_ACTIVE_NOTE = 'This harmless placeholder value is now visible for the safe demo flow.';
    var CARD_SHELLS = [
        {
            label: 'Demo Field 1',
            description: 'Neutral sample card for safe UX walkthroughs.'
        },
        {
            label: 'Demo Field 2',
            description: 'A second placeholder card with the same verification style.'
        },
        {
            label: 'Demo Field 3',
            description: 'A third placeholder card for complete background reveal testing.'
        },
        {
            label: 'Demo Result',
            description: 'Shows a harmless summary result after a successful demo match.'
        },
        {
            label: 'Sample Button',
            description: 'Demonstrates the action area switching from locked to active.'
        }
    ];
    var DEMO_CODES = [
        {
            slot: 'Demo Code 1',
            code: 'DEMO-110',
            title: 'Sample Verification A',
            message: 'Demo code matched successfully. Close this dialog to activate all background sample cards.',
            cards: [
                {
                    label: 'Demo Field 1',
                    description: 'Neutral sample card for safe UX walkthroughs.',
                    value: 'Alpha Preview Ready'
                },
                {
                    label: 'Demo Field 2',
                    description: 'A second placeholder card with the same verification style.',
                    value: 'Stage One Active'
                },
                {
                    label: 'Demo Field 3',
                    description: 'A third placeholder card for complete background reveal testing.',
                    value: 'Neutral Value 110'
                },
                {
                    label: 'Demo Result',
                    description: 'Shows a harmless summary result after a successful demo match.',
                    value: 'Safe reveal completed'
                },
                {
                    label: 'Sample Button',
                    description: 'Demonstrates the action area switching from locked to active.',
                    value: 'Button Ready'
                }
            ]
        },
        {
            slot: 'Demo Code 2',
            code: 'DEMO-220',
            title: 'Sample Verification B',
            message: 'A second fixed demo code matched. Close the dialog to switch every neutral card into its active state.',
            cards: [
                {
                    label: 'Demo Field 1',
                    description: 'Neutral sample card for safe UX walkthroughs.',
                    value: 'Beta Preview Ready'
                },
                {
                    label: 'Demo Field 2',
                    description: 'A second placeholder card with the same verification style.',
                    value: 'Stage Two Active'
                },
                {
                    label: 'Demo Field 3',
                    description: 'A third placeholder card for complete background reveal testing.',
                    value: 'Neutral Value 220'
                },
                {
                    label: 'Demo Result',
                    description: 'Shows a harmless summary result after a successful demo match.',
                    value: 'Safe showcase running'
                },
                {
                    label: 'Sample Button',
                    description: 'Demonstrates the action area switching from locked to active.',
                    value: 'Button Enabled'
                }
            ]
        },
        {
            slot: 'Demo Code 3',
            code: 'DEMO-330',
            title: 'Sample Verification C',
            message: 'The final fixed demo code matched. Close the dialog to reveal every harmless placeholder field in the background.',
            cards: [
                {
                    label: 'Demo Field 1',
                    description: 'Neutral sample card for safe UX walkthroughs.',
                    value: 'Gamma Preview Ready'
                },
                {
                    label: 'Demo Field 2',
                    description: 'A second placeholder card with the same verification style.',
                    value: 'Stage Three Active'
                },
                {
                    label: 'Demo Field 3',
                    description: 'A third placeholder card for complete background reveal testing.',
                    value: 'Neutral Value 330'
                },
                {
                    label: 'Demo Result',
                    description: 'Shows a harmless summary result after a successful demo match.',
                    value: 'Safe preview finished'
                },
                {
                    label: 'Sample Button',
                    description: 'Demonstrates the action area switching from locked to active.',
                    value: 'Button Live'
                }
            ]
        }
    ];

    function normalizeCode(value) {
        return String(value || '').trim().toUpperCase();
    }

    function cloneCards(cards) {
        return (cards || []).map(function (card) {
            return {
                label: String(card.label || '').trim(),
                description: String(card.description || '').trim(),
                value: String(card.value || '').trim(),
                activeNote: String(card.activeNote || DEFAULT_ACTIVE_NOTE).trim(),
                lockedNote: String(card.lockedNote || DEFAULT_LOCKED_NOTE).trim()
            };
        });
    }

    function getDemoCodes() {
        return DEMO_CODES.map(function (item) {
            return {
                slot: item.slot,
                code: item.code,
                title: item.title,
                message: item.message,
                cards: cloneCards(item.cards)
            };
        });
    }

    function buildLockedCards() {
        return CARD_SHELLS.map(function (item) {
            return {
                label: item.label,
                description: item.description,
                value: LOCKED_VALUE,
                activeNote: DEFAULT_ACTIVE_NOTE,
                lockedNote: DEFAULT_LOCKED_NOTE
            };
        });
    }

    function findDemoCode(inputCode) {
        var normalized = normalizeCode(inputCode);
        if (!normalized) {
            return null;
        }

        for (var index = 0; index < DEMO_CODES.length; index += 1) {
            var item = DEMO_CODES[index];
            if (normalizeCode(item.code) === normalized) {
                return {
                    slot: item.slot,
                    code: item.code,
                    title: item.title,
                    message: item.message,
                    cards: cloneCards(item.cards)
                };
            }
        }

        return null;
    }

    function verifyCode(inputCode) {
        var normalizedInput = normalizeCode(inputCode);
        if (!normalizedInput) {
            return {
                ok: false,
                reason: 'missing-input',
                match: null
            };
        }

        var matched = findDemoCode(normalizedInput);
        if (!matched) {
            return {
                ok: false,
                reason: 'mismatch',
                match: null
            };
        }

        return {
            ok: true,
            reason: 'matched',
            match: matched
        };
    }

    function setText(node, value) {
        if (node) {
            node.textContent = value;
        }
    }

    function setBodyModalState(doc, open) {
        if (!doc || !doc.body || !doc.body.classList) {
            return;
        }
        doc.body.classList[open ? 'add' : 'remove']('demo-modal-open');
    }

    function renderInlineFeedback(doc, state, message) {
        var feedback = doc.getElementById('demoInlineFeedback');
        if (!feedback) {
            return;
        }

        feedback.dataset.state = state;
        feedback.textContent = message;
    }

    function renderAvailability(doc) {
        var availability = doc.getElementById('demoAvailability');
        if (!availability) {
            return;
        }

        availability.dataset.state = 'ready';
        availability.textContent = 'Three fixed demo codes are active. A valid match opens a success dialog, and closing that dialog reveals all background sample cards.';
    }

    function createVerifyCard(doc, card, isActive) {
        var item = doc.createElement('article');
        item.className = 'demo-verify-card';
        item.dataset.state = isActive ? 'active' : 'locked';

        var top = doc.createElement('div');
        top.className = 'demo-verify-top';

        var titleWrap = doc.createElement('div');
        titleWrap.className = 'demo-verify-heading';

        var title = doc.createElement('h3');
        title.textContent = card.label;

        var description = doc.createElement('p');
        description.textContent = card.description;

        titleWrap.appendChild(title);
        titleWrap.appendChild(description);

        var badge = doc.createElement('span');
        badge.className = 'demo-verify-badge';
        badge.textContent = isActive ? 'Verified' : 'Protected';

        top.appendChild(titleWrap);
        top.appendChild(badge);

        var row = doc.createElement('div');
        row.className = 'demo-verify-row';

        var value = doc.createElement('div');
        value.className = 'demo-verify-value';
        value.textContent = isActive ? card.value : LOCKED_VALUE;

        var action = doc.createElement('button');
        action.className = 'demo-verify-action';
        action.type = 'button';
        action.textContent = isActive ? 'Sample Button' : 'Verify Status';
        action.disabled = !isActive;

        row.appendChild(value);
        row.appendChild(action);

        var helper = doc.createElement('p');
        helper.className = 'demo-verify-helper';
        helper.textContent = isActive ? card.activeNote : card.lockedNote;

        item.appendChild(top);
        item.appendChild(row);
        item.appendChild(helper);
        return item;
    }

    function renderVerificationCards(doc, match) {
        var container = doc.getElementById('demoVerificationCards');
        if (!container) {
            return;
        }

        var cards = match ? match.cards : buildLockedCards();
        container.innerHTML = '';
        cards.forEach(function (card) {
            container.appendChild(createVerifyCard(doc, card, !!match));
        });
    }

    function renderStatusPanel(doc, config) {
        var panel = doc.getElementById('demoStatusPanel');
        var badge = doc.getElementById('demoStatusBadge');
        var title = doc.getElementById('demoStatusTitle');
        var detail = doc.getElementById('demoStatusDetail');
        var code = doc.getElementById('demoStatusCode');

        if (!panel || !badge || !title || !detail || !code) {
            return;
        }

        if (config.state === 'active' && config.match) {
            panel.dataset.state = 'active';
            setText(badge, 'Verified');
            setText(title, config.match.title);
            setText(detail, 'Success dialog was closed and every neutral demo card is now active in the background.');
            setText(code, config.match.slot + ' | ' + config.match.code);
            return;
        }

        if (config.state === 'error') {
            panel.dataset.state = 'error';
            setText(badge, 'Not matched');
            setText(title, 'Try one of the three fixed demo codes');
            setText(detail, 'The entered code did not match the safe demo set. Background cards stay neutral until a valid code succeeds.');
            setText(code, 'Available set: 3 fixed demo codes');
            return;
        }

        panel.dataset.state = 'locked';
        setText(badge, 'Locked');
        setText(title, 'Cards are waiting for a valid demo code');
        setText(detail, 'Enter one of the three fixed demo codes. A success dialog appears first, and closing it reveals every neutral sample card.');
        setText(code, 'Available set: 3 fixed demo codes');
    }

    function openSuccessDialog(doc, match) {
        var dialog = doc.getElementById('demoSuccessDialog');
        if (!dialog || !match) {
            return;
        }

        setText(doc.getElementById('demoDialogTitle'), match.title);
        setText(doc.getElementById('demoDialogMessage'), match.message);
        setText(doc.getElementById('demoDialogMeta'), match.slot + ' | ' + match.code);
        dialog.hidden = false;
        setBodyModalState(doc, true);
    }

    function closeSuccessDialog(doc) {
        var dialog = doc.getElementById('demoSuccessDialog');
        if (!dialog) {
            return;
        }

        dialog.hidden = true;
        setBodyModalState(doc, false);
    }

    function renderAdminCatalog(doc) {
        var container = doc.getElementById('demoCodeCatalog');
        if (!container) {
            return;
        }

        container.innerHTML = '';
        getDemoCodes().forEach(function (item) {
            var card = doc.createElement('article');
            card.className = 'demo-code-card';

            var slot = doc.createElement('span');
            slot.className = 'demo-code-slot';
            slot.textContent = item.slot;

            var title = doc.createElement('h3');
            title.textContent = item.title;

            var code = doc.createElement('div');
            code.className = 'demo-code-value';
            code.textContent = item.code;

            var message = doc.createElement('p');
            message.textContent = item.message;

            card.appendChild(slot);
            card.appendChild(title);
            card.appendChild(code);
            card.appendChild(message);
            container.appendChild(card);
        });
    }

    function initAdminPage(doc) {
        renderAdminCatalog(doc);
    }

    function initUserPage(doc) {
        var form = doc.getElementById('userDemoForm');
        var input = doc.getElementById('userCodeInput');
        var closeButton = doc.getElementById('demoDialogCloseBtn');
        var state = {
            pendingMatch: null,
            revealedMatch: null
        };

        if (!form || !input || !closeButton) {
            return;
        }

        renderAvailability(doc);
        renderVerificationCards(doc, null);
        renderStatusPanel(doc, { state: 'locked' });
        renderInlineFeedback(doc, 'neutral', 'Enter one of the three fixed demo codes to begin the safe placeholder reveal flow.');

        form.addEventListener('submit', function (event) {
            event.preventDefault();

            var result = verifyCode(input.value);
            if (!result.ok) {
                state.pendingMatch = null;
                closeSuccessDialog(doc);
                if (state.revealedMatch) {
                    renderStatusPanel(doc, {
                        state: 'active',
                        match: state.revealedMatch
                    });
                } else {
                    renderStatusPanel(doc, {
                        state: result.reason === 'missing-input' ? 'locked' : 'error'
                    });
                }
                renderInlineFeedback(
                    doc,
                    result.reason === 'missing-input' ? 'neutral' : 'error',
                    result.reason === 'missing-input'
                        ? 'Enter a fixed demo code first.'
                        : 'That code did not match the safe demo set. Try one of the three fixed demo codes from the demo board.'
                );

                if (!state.revealedMatch) {
                    renderVerificationCards(doc, null);
                }
                return;
            }

            state.pendingMatch = result.match;
            renderInlineFeedback(doc, 'success', 'Code matched. Close the success dialog to activate every background demo card.');
            openSuccessDialog(doc, result.match);
        });

        closeButton.addEventListener('click', function () {
            if (!state.pendingMatch) {
                closeSuccessDialog(doc);
                return;
            }

            state.revealedMatch = state.pendingMatch;
            state.pendingMatch = null;
            closeSuccessDialog(doc);
            renderStatusPanel(doc, {
                state: 'active',
                match: state.revealedMatch
            });
            renderVerificationCards(doc, state.revealedMatch);
            renderInlineFeedback(doc, 'success', 'All neutral background demo cards are now active.');
        });
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

    global.SafeVerificationDemo = {
        getDemoCodes: getDemoCodes,
        verifyCode: verifyCode,
        initDocument: initDocument
    };

    if (typeof document !== 'undefined') {
        document.addEventListener('DOMContentLoaded', function () {
            initDocument(document);
        });
    }
}(typeof window !== 'undefined' ? window : globalThis));
