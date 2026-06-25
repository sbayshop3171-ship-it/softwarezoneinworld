(function (global) {
    'use strict';

    var DEMO_CODES = [
        {
            slot: 'Demo Code 1',
            code: 'DEMO-1001',
            title: 'Sample Verification A',
            message: 'Sample verification completed. This result stays inside the standalone demo flow.',
            fields: [
                { label: 'Demo Field 1', value: 'Ready for showcase' },
                { label: 'Demo Field 2', value: 'Stage Alpha' },
                { label: 'Demo Field 3', value: 'Placeholder Value 210' },
                { label: 'Demo Result', value: 'Sample verification passed' }
            ]
        },
        {
            slot: 'Demo Code 2',
            code: 'DEMO-2002',
            title: 'Sample Verification B',
            message: 'Neutral placeholder values are now visible for this fixed demo code.',
            fields: [
                { label: 'Demo Field 1', value: 'Preview unlocked' },
                { label: 'Demo Field 2', value: 'Stage Beta' },
                { label: 'Demo Field 3', value: 'Placeholder Value 320' },
                { label: 'Demo Result', value: 'Sample verification complete' }
            ]
        },
        {
            slot: 'Demo Code 3',
            code: 'DEMO-3003',
            title: 'Sample Verification C',
            message: 'This code demonstrates a successful match without using any real account data.',
            fields: [
                { label: 'Demo Field 1', value: 'Workflow active' },
                { label: 'Demo Field 2', value: 'Stage Gamma' },
                { label: 'Demo Field 3', value: 'Placeholder Value 430' },
                { label: 'Demo Result', value: 'Harmless sample revealed' }
            ]
        },
        {
            slot: 'Demo Code 4',
            code: 'DEMO-4004',
            title: 'Sample Verification D',
            message: 'A second neutral result set is available for training, QA, or client walkthroughs.',
            fields: [
                { label: 'Demo Field 1', value: 'Review in progress' },
                { label: 'Demo Field 2', value: 'Stage Delta' },
                { label: 'Demo Field 3', value: 'Placeholder Value 540' },
                { label: 'Demo Result', value: 'Demo response delivered' }
            ]
        },
        {
            slot: 'Demo Code 5',
            code: 'DEMO-5005',
            title: 'Sample Verification E',
            message: 'The fixed code matched and loaded another safe placeholder combination.',
            fields: [
                { label: 'Demo Field 1', value: 'Training mode' },
                { label: 'Demo Field 2', value: 'Stage Epsilon' },
                { label: 'Demo Field 3', value: 'Placeholder Value 650' },
                { label: 'Demo Result', value: 'Safe demo state confirmed' }
            ]
        },
        {
            slot: 'Demo Code 6',
            code: 'DEMO-6006',
            title: 'Sample Verification F',
            message: 'This is the final fixed demo code in the standalone neutral verification set.',
            fields: [
                { label: 'Demo Field 1', value: 'Presentation ready' },
                { label: 'Demo Field 2', value: 'Stage Zeta' },
                { label: 'Demo Field 3', value: 'Placeholder Value 760' },
                { label: 'Demo Result', value: 'Safe demo workflow finished' }
            ]
        }
    ];

    function normalizeCode(value) {
        return String(value || '').trim().toUpperCase();
    }

    function cloneFields(fields) {
        return (fields || []).map(function (field) {
            return {
                label: String(field.label || '').trim(),
                value: String(field.value || '').trim()
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
                fields: cloneFields(item.fields)
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
                    fields: cloneFields(item.fields)
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

    function createFieldCard(doc, label, value) {
        var card = doc.createElement('div');
        card.className = 'demo-field-card';

        var heading = doc.createElement('strong');
        heading.textContent = label;

        var content = doc.createElement('span');
        content.textContent = value;

        card.appendChild(heading);
        card.appendChild(content);
        return card;
    }

    function renderFieldGrid(doc, fields, isSuccess) {
        var container = doc.getElementById('resultFields');
        if (!container) {
            return;
        }

        container.innerHTML = '';
        if (isSuccess) {
            (fields || []).forEach(function (field) {
                container.appendChild(createFieldCard(doc, field.label, field.value));
            });
            return;
        }

        container.appendChild(
            createFieldCard(doc, 'Demo Field 1', 'Hidden until a fixed demo code matches')
        );
        container.appendChild(
            createFieldCard(doc, 'Demo Result', 'Sample values appear here after a successful match')
        );
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

    function renderUserAvailability(doc) {
        var availability = doc.getElementById('demoAvailability');
        if (!availability) {
            return;
        }

        availability.dataset.state = 'ready';
        availability.textContent = 'Six fixed demo codes are active. Enter any one of them to reveal harmless placeholder values.';
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

        if (result.ok && result.match) {
            panel.dataset.state = 'success';
            setText(badge, 'Matched');
            setText(title, result.match.title);
            setText(detail, 'The entered code matched one of the six fixed demo configurations.');
            setText(message, result.match.message);
            setText(updated, result.match.slot + ' | ' + result.match.code);
            renderFieldGrid(doc, result.match.fields, true);
            return;
        }

        panel.dataset.state = 'pending';
        renderFieldGrid(doc, [], false);

        if (result.reason === 'missing-input') {
            setText(badge, 'Code needed');
            setText(title, 'Enter a demo code first');
            setText(detail, 'Use one of the fixed demo codes from the reference page to run the showcase flow.');
            setText(message, 'A neutral completion message will appear here after a successful match.');
            setText(updated, 'Available set: 6 fixed demo codes');
            return;
        }

        setText(badge, 'Not matched');
        setText(title, 'Try another demo code');
        setText(detail, 'The entered code did not match any fixed demo code in this standalone showcase.');
        setText(message, 'No placeholder values are revealed until a fixed demo code matches.');
        setText(updated, 'Available set: 6 fixed demo codes');
    }

    function initAdminPage(doc) {
        renderAdminCatalog(doc);
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
            renderUserResult(doc, verifyCode(input.value));
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
