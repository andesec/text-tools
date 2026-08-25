/*
 * Dylen object-to-shorthand converter.
 * Mirrors the client-facing output() contracts in dylen-engine/app/schema/widget_models.py.
 */
(function () {
    'use strict';

    const WIDGET_ALIASES = {
        chart: 'graph',
        graphs: 'graph',
        flip: 'flipcards',
        flipcard: 'flipcards',
        tr: 'translations',
        translation: 'translations',
        longanswer: 'longAnswer',
        shortanswer: 'shortAnswer',
        audiorecording: 'audioRecording',
        audio_recording: 'audioRecording',
        equationviewer: 'equationviewer',
        'equation viewer': 'equationviewer',
        stepflow: 'stepFlow',
        step_flow: 'stepFlow',
        asciidiagram: 'asciiDiagram',
        ascii_diagram: 'asciiDiagram',
        flowdiagram: 'flowDiagram',
        flow_diagram: 'flowDiagram',
        'flow diagram': 'flowDiagram',
        interactiveterminal: 'interactiveTerminal',
        interactive_terminal: 'interactiveTerminal',
        liveterminal: 'liveterminal',
        live_terminal: 'liveterminal',
        terminaldemo: 'terminalDemo',
        terminal_demo: 'terminalDemo',
        codeviewer: 'codeViewer',
        code_viewer: 'codeViewer',
        codeeditor: 'codeEditor',
        code_editor: 'codeEditor',
        codereview: 'codeReview',
        code_review: 'codeReview',
        codingchallenge: 'codingchallenge',
        coding_challenge: 'codingchallenge',
        mathsolver: 'mathsolver',
        math_solver: 'mathsolver',
        guidedscenario: 'guidedscenario',
        guided_scenario: 'guidedscenario',
        conversation: 'conversation',
        listening: 'listening',
        dialogue: 'dialogues',
        dialogs: 'dialogues',
        caselets: 'caselet',
        caselet: 'caselet',
        roleplays: 'roleplay',
        roleplay: 'roleplay',
        connection: 'connections',
        matching: 'connections',
        sequence: 'sequences',
        ordering: 'sequences',
        pictureprobe: 'pictureProbe',
        picture_probe: 'pictureProbe',
        taskcheck: 'taskCheck',
        task_check: 'taskCheck',
        offscreentask: 'offscreenTask',
        offscreen_task: 'offscreenTask',
        flashcards: 'flashcards',
        flashcard: 'flashcards',
        instrument: 'instrument',
        instrumentdemo: 'instrumentdemo',
        '2dplotter': '2dplotter',
        '3dplotter': '3dplotter',
        sectionvisual: 'sectionvisual',
        fusion: 'fusion',
        livecall: 'livecall',
        'live call': 'livecall'
    };

    const WIDGET_KEYS = [
        'markdown',
        'graph',
        'flipcards',
        'translations',
        'fillblank',
        'table',
        'compare',
        'swipecards',
        'truefalse',
        'longAnswer',
        'shortAnswer',
        'audioRecording',
        'equationviewer',
        'stepFlow',
        'asciiDiagram',
        'flowDiagram',
        'checklist',
        'caselet',
        'roleplay',
        'dialogues',
        'interactiveTerminal',
        'liveterminal',
        'terminalDemo',
        'codeViewer',
        'codeReview',
        'codeEditor',
        'codingchallenge',
        'mathsolver',
        'guidedscenario',
        'conversation',
        'listening',
        '2dplotter',
        '3dplotter',
        'sectionvisual',
        'instrumentdemo',
        'instrument',
        'flashcards',
        'fusion',
        'mcqs',
        'fenster',
        'illustration',
        'connections',
        'sequences',
        'pictureProbe',
        'taskCheck',
        'offscreenTask',
        'livecall'
    ];

    const WIDGET_KEY_SET = new Set(WIDGET_KEYS);
    const LOWER_KEY_MAP = Object.fromEntries(WIDGET_KEYS.map((key) => [key.toLowerCase(), key]));

    function isPlainObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function valueOrNull(value) {
        return value === undefined ? null : value;
    }

    function arrayOrEmpty(value) {
        return Array.isArray(value) ? value : [];
    }

    function resolveWidgetKey(key) {
        if (WIDGET_KEY_SET.has(key)) return key;

        const lower = String(key || '').trim().toLowerCase();

        if (WIDGET_ALIASES[lower]) return WIDGET_ALIASES[lower];

        return LOWER_KEY_MAP[lower] || null;
    }

    function normalizeDuration(value) {
        if (value === undefined || value === null || value === '') return null;

        const parsed = Number(value);

        if (!Number.isFinite(parsed)) return null;

        return Math.max(1, Math.min(300, Math.ceil(parsed)));
    }

    function mapArray(items, mapper) {
        return arrayOrEmpty(items).map((item) => mapper(isPlainObject(item) ? item : {}));
    }

    function convertGraphOptions(options) {
        if (!isPlainObject(options)) return null;

        return {
            x_label: valueOrNull(options.x_label),
            y_label: valueOrNull(options.y_label),
            show_legend: options.show_legend === undefined ? true : options.show_legend,
            value_prefix: valueOrNull(options.value_prefix),
            value_suffix: valueOrNull(options.value_suffix)
        };
    }

    function convertGraphVariable(variable) {
        return {
            key: variable.key,
            label: variable.label,
            type: variable.type,
            default: valueOrNull(variable.default),
            min: valueOrNull(variable.min),
            max: valueOrNull(variable.max),
            step: valueOrNull(variable.step),
            options: valueOrNull(variable.options)
        };
    }

    function convertWidgetPayload(widgetKey, payload) {
        if (Array.isArray(payload)) return payload;

        const p = isPlainObject(payload) ? payload : {};

        switch (widgetKey) {
            case 'markdown':
                return [p.title, p.markdown, p.align ?? 'left', valueOrNull(p.id), arrayOrEmpty(p.karut), arrayOrEmpty(p.keywords)];

            case 'illustration':
                return [p.title, valueOrNull(p.resource_id), p.caption, valueOrNull(p.id), arrayOrEmpty(p.karut), arrayOrEmpty(p.keywords)];

            case 'flipcards':
                return [
                    p.title,
                    mapArray(p.cards, (card) => [card.front, card.back]),
                    valueOrNull(p.id),
                    arrayOrEmpty(p.karut),
                    arrayOrEmpty(p.keywords)
                ];

            case 'translations':
                return [
                    p.title,
                    mapArray(p.entries, (entry) => [entry.source, entry.target]),
                    valueOrNull(p.id),
                    arrayOrEmpty(p.karut),
                    arrayOrEmpty(p.keywords)
                ];

            case 'fillblank':
                return [
                    p.title,
                    p.structure,
                    mapArray(p.items, (item) => [
                        item.prompt,
                        item.answer,
                        item.hint,
                        item.explanation,
                        arrayOrEmpty(item.karut),
                        arrayOrEmpty(item.keywords)
                    ]),
                    valueOrNull(p.id)
                ];

            case 'longAnswer':
                return [
                    p.title,
                    p.prompt,
                    p.seed_locked,
                    p.lang,
                    p.wordlist_csv,
                    valueOrNull(p.id),
                    arrayOrEmpty(p.karut),
                    arrayOrEmpty(p.keywords)
                ];

            case 'shortAnswer':
                return [
                    p.title,
                    mapArray(p.items, (item) => [
                        item.prompt,
                        item.lang,
                        item.wordlist_csv
                    ]),
                    valueOrNull(p.id)
                ];

            case 'audioRecording':
                return [
                    p.title,
                    mapArray(p.items, (item) => [
                        item.prompt,
                        item.duration_seconds,
                        item.criteria,
                        item.grader_prompt,
                        arrayOrEmpty(item.karut),
                        arrayOrEmpty(item.keywords)
                    ]),
                    valueOrNull(p.id)
                ];

            case 'equationviewer':
                return [
                    p.title,
                    p.description,
                    mapArray(p.steps, (step) => {
                        const explanation =
                            typeof step.explanation === 'string' ? step.explanation.trim() : step.explanation;

                        return explanation ? [step.katex, step.explanation] : [step.katex];
                    }),
                    valueOrNull(p.id),
                    arrayOrEmpty(p.karut),
                    arrayOrEmpty(p.keywords)
                ];

            case 'asciiDiagram':
                return [p.title, p.diagram, valueOrNull(p.id), arrayOrEmpty(p.karut), arrayOrEmpty(p.keywords)];

            case 'flowDiagram':
                return [p.title, p.description, p.code, valueOrNull(p.id), arrayOrEmpty(p.karut), arrayOrEmpty(p.keywords)];

            case 'interactiveTerminal':
                return [
                    p.title,
                    mapArray(p.rules, (rule) => [rule.regex, rule.level, rule.output]),
                    mapArray(p.guided, (task) => [task.task_markdown, task.solution_string]),
                    valueOrNull(p.id),
                    arrayOrEmpty(p.karut),
                    arrayOrEmpty(p.keywords)
                ];

            case 'terminalDemo':
                return [
                    p.title,
                    mapArray(p.rules, (rule) => [rule.command, rule.delay_ms, rule.output]),
                    valueOrNull(p.id),
                    arrayOrEmpty(p.karut),
                    arrayOrEmpty(p.keywords)
                ];

            case 'codeViewer':
                return [
                    p.title,
                    p.code,
                    p.language,
                    valueOrNull(p.highlighted_lines),
                    valueOrNull(p.id),
                    arrayOrEmpty(p.karut),
                    arrayOrEmpty(p.keywords)
                ];

            case 'codeReview':
                return [
                    p.title,
                    p.code,
                    p.language,
                    Array.isArray(p.annotations)
                        ? p.annotations.map((a) => [a.line, a.text])
                        : null,
                    valueOrNull(p.diff_code),
                    valueOrNull(p.id),
                    arrayOrEmpty(p.karut),
                    arrayOrEmpty(p.keywords)
                ];

            case 'codeEditor':
                return [p.title, valueOrNull(p.resource_id), valueOrNull(p.id), arrayOrEmpty(p.karut), arrayOrEmpty(p.keywords)];

            case 'swipecards':
                return [
                    p.title,
                    [p.buckets?.left, p.buckets?.right],
                    mapArray(p.cards, (card) => [
                        card.text,
                        card.correct_bucket_index,
                        card.feedback,
                        arrayOrEmpty(card.karut),
                        arrayOrEmpty(card.keywords)
                    ]),
                    valueOrNull(p.id)
                ];

            case 'truefalse':
                return [
                    p.title,
                    [p.labels?.false_label, p.labels?.true_label],
                    mapArray(p.cards, (card) => [
                        card.text,
                        card.correct_answer_index,
                        card.feedback,
                        arrayOrEmpty(card.karut),
                        arrayOrEmpty(card.keywords)
                    ]),
                    valueOrNull(p.id)
                ];

            case 'stepFlow':
                return [p.title, p.flow, valueOrNull(p.id), arrayOrEmpty(p.karut), arrayOrEmpty(p.keywords)];

            case 'checklist':
                return [p.title, p.tree, valueOrNull(p.id), arrayOrEmpty(p.karut), arrayOrEmpty(p.keywords)];

            case 'caselet':
                return [p.title, p.cards, valueOrNull(p.id), arrayOrEmpty(p.karut), arrayOrEmpty(p.keywords)];

            case 'roleplay':
                return [p.title, p.mentor_persona, p.description, valueOrNull(p.id), arrayOrEmpty(p.karut), arrayOrEmpty(p.keywords)];

            case 'dialogues':
                return [
                    p.title,
                    mapArray(p.participants, (participant) => [
                        participant.participant_id,
                        participant.display_name
                    ]),
                    mapArray(p.sequence, (turn) =>
                        turn.type === 'message'
                            ? [turn.type, String(turn.participant_id), turn.text]
                            : [turn.type, turn.text]
                    ),
                    valueOrNull(p.id),
                    arrayOrEmpty(p.karut),
                    arrayOrEmpty(p.keywords)
                ];

            case 'mcqs':
                return [
                    p.title,
                    mapArray(p.questions, (question) => [
                        question.q,
                        question.c,
                        question.a,
                        question.e,
                        arrayOrEmpty(question.karut),
                        arrayOrEmpty(question.keywords)
                    ]),
                    valueOrNull(p.id)
                ];

            case 'fenster':
                return [p.title, p.description, valueOrNull(p.resource_id), valueOrNull(p.id), arrayOrEmpty(p.karut), arrayOrEmpty(p.keywords)];

            case 'graph':
                return [
                    p.title,
                    p.description,
                    p.graph_type,
                    p.labels,
                    mapArray(p.datasets, (dataset) => [dataset.label, dataset.data]),
                    convertGraphOptions(p.options),
                    Array.isArray(p.variables)
                        ? p.variables.map((variable) => convertGraphVariable(isPlainObject(variable) ? variable : {}))
                        : null,
                    valueOrNull(p.id),
                    arrayOrEmpty(p.karut),
                    arrayOrEmpty(p.keywords)
                ];

            case 'table':
                return [p.title, arrayOrEmpty(p.rows), valueOrNull(p.id), arrayOrEmpty(p.karut), arrayOrEmpty(p.keywords)];

            case 'compare':
                return [
                    p.title,
                    mapArray(p.rows, (row) => [row.left, row.right]),
                    valueOrNull(p.id),
                    arrayOrEmpty(p.karut),
                    arrayOrEmpty(p.keywords)
                ];

            case 'connections':
                return [
                    p.title,
                    p.prompt,
                    mapArray(p.left_items, (item) => [
                        item.id,
                        item.match,
                        item.label,
                        arrayOrEmpty(item.karut),
                        arrayOrEmpty(item.keywords)
                    ]),
                    mapArray(p.right_items, (item) => [item.id, item.label]),
                    valueOrNull(p.id)
                ];

            case 'sequences':
                return [
                    p.title,
                    p.prompt,
                    mapArray(p.items, (item) => [
                        item.id,
                        item.label,
                        item.explanation,
                        arrayOrEmpty(item.karut),
                        arrayOrEmpty(item.keywords)
                    ]),
                    p.correct_order,
                    arrayOrEmpty(p.hints),
                    p.mode ?? 'list',
                    valueOrNull(p.id)
                ];

            case 'pictureProbe':
                return [
                    p.title,
                    valueOrNull(p.resource_id),
                    p.caption,
                    p.prompt,
                    p.image_source,
                    valueOrNull(p.image_url),
                    valueOrNull(p.id),
                    arrayOrEmpty(p.karut),
                    arrayOrEmpty(p.keywords)
                ];

            case 'taskCheck':
                return [p.title, p.instructions, p.capture_guidance, valueOrNull(p.id), arrayOrEmpty(p.karut), arrayOrEmpty(p.keywords)];

            case 'offscreenTask':
                return [
                    p.title,
                    p.instructions,
                    p.recommended_approach,
                    p.reflection_prompt,
                    valueOrNull(p.id),
                    arrayOrEmpty(p.karut),
                    arrayOrEmpty(p.keywords)
                ];

            case 'livecall':
                return [
                    p.title,
                    p.scenario,
                    p.learner_role,
                    p.model_role,
                    p.goal,
                    p.primary_language,
                    valueOrNull(p.translation_language),
                    p.duration_minutes,
                    valueOrNull(p.id),
                    arrayOrEmpty(p.karut),
                    arrayOrEmpty(p.keywords)
                ];

            default:
                return convertToShorthand(payload);
        }
    }

    function convertWidgetItem(item) {
        if (!isPlainObject(item)) return item;

        const output = {};
        let convertedCount = 0;

        for (const [key, value] of Object.entries(item)) {
            const canonical = resolveWidgetKey(key);

            if (canonical) {
                output[canonical] = convertWidgetPayload(canonical, value);
                convertedCount += 1;
            }
        }

        if (convertedCount > 0) return output;

        return convertToShorthand(item);
    }

    function convertTitleItemsContainer(object) {
        const result = {
            title: object.title,
            items: arrayOrEmpty(object.items).map(convertWidgetItem)
        };

        if (Object.prototype.hasOwnProperty.call(object, 'learning_duration')) {
            result.learning_duration = normalizeDuration(object.learning_duration);
        }

        if (Object.prototype.hasOwnProperty.call(object, 'skills')) {
            result.skills = arrayOrEmpty(object.skills);
        }

        return result;
    }

    function convertLessonSection(block) {
        const result = {
            sections: arrayOrEmpty(block.sections).map((section) =>
                isPlainObject(section) ? convertTitleItemsContainer(section) : section
            )
        };

        if (Object.prototype.hasOwnProperty.call(block, 'glossary_id')) {
            result.glossary_id = valueOrNull(block.glossary_id);
        }

        return result;
    }

    function convertObject(object) {
        const widgetKeys = Object.keys(object).filter((key) => resolveWidgetKey(key));

        if (widgetKeys.length > 0) {
            const result = {};

            for (const key of widgetKeys) {
                const canonical = resolveWidgetKey(key);
                result[canonical] = convertWidgetPayload(canonical, object[key]);
            }

            return result;
        }

        if (Array.isArray(object.items) && Object.prototype.hasOwnProperty.call(object, 'title')) {
            return convertTitleItemsContainer(object);
        }

        if (Array.isArray(object.sections)) {
            const result = {};

            if (Object.prototype.hasOwnProperty.call(object, 'title')) {
                result.title = object.title;
            }

            result.sections = object.sections.map((section) =>
                isPlainObject(section) ? convertTitleItemsContainer(section) : section
            );

            if (Object.prototype.hasOwnProperty.call(object, 'glossary_id')) {
                result.glossary_id = valueOrNull(object.glossary_id);
            }

            return result;
        }

        if (Array.isArray(object.blocks)) {
            return {
                title: object.title,
                blocks: object.blocks.map((block) => (isPlainObject(block) ? convertLessonSection(block) : block))
            };
        }

        const result = {};

        for (const [key, value] of Object.entries(object)) {
            if (key === 'keywords' || key === 'study_duration') continue;

            result[key] = convertToShorthand(value);
        }

        return result;
    }

    function convertToShorthand(value) {
        if (Array.isArray(value)) return value.map(convertToShorthand);
        if (isPlainObject(value)) return convertObject(value);

        return value;
    }

    function parseJsonInput(text) {
        try {
            return JSON.parse(text);
        } catch (error) {
            const cleaned = String(text || '')
                .trim()
                .replace(/\/\*[\s\S]*?\*\/|([^:]|^)\/\/.*$/gm, '$1')
                .replace(/([{,]\s*)([a-zA-Z0-9_$]+)\s*:/g, '$1"$2":')
                .replace(/,\s*([\]}])/g, '$1');

            return JSON.parse(cleaned);
        }
    }

    function getEditorView() {
        const EditorView = window.CM_JS && window.CM_JS.EditorView;

        if (!EditorView || typeof EditorView.findFromDOM !== 'function') return null;

        const editorNode = document.querySelector('#editor .cm-editor') || document.getElementById('editor');

        return editorNode ? EditorView.findFromDOM(editorNode) : null;
    }

    function setEditorText(text) {
        const view = getEditorView();

        if (!view) throw new Error('Could not find the active editor.');

        view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: text },
            selection: { anchor: text.length }
        });

        view.focus();
    }

    function showToast(message, isError) {
        const toast = document.getElementById('copy-toast');

        if (!toast) {
            if (isError) alert(message);
            return;
        }

        toast.textContent = message;
        toast.style.background = isError ? '#ef4444' : '#333';
        toast.style.opacity = '1';

        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => {
                toast.style.background = '#333';
            }, 300);
        }, isError ? 3000 : 2000);
    }

    function convertCurrentEditorToSecondJson() {
        try {
            const view = getEditorView();

            if (!view) throw new Error('Could not find the active editor.');

            const sourceText = view.state.doc.toString();
            const parsed = parseJsonInput(sourceText);
            const shorthand = convertToShorthand(parsed);
            const outputText = JSON.stringify(shorthand, null, 2);

            if (typeof window.switchInstance === 'function') {
                window.switchInstance(1);
                setTimeout(() => setEditorText(outputText), 0);
            } else {
                setEditorText(outputText);
            }

            showToast('Converted to Dylen shorthand in JSON 2');
        } catch (error) {
            showToast(`Shorthand conversion failed: ${error.message}`, true);
        }
    }

    function installButton() {
        if (document.getElementById('dylen-shorthand-btn')) return;

        const toolbarGroups = document.querySelectorAll('.app-header-toolbar > div');
        const targetGroup = toolbarGroups[toolbarGroups.length - 1];

        if (!targetGroup) return;

        const button = document.createElement('button');
        button.id = 'dylen-shorthand-btn';
        button.type = 'button';
        button.className = 'btn btn-sm';
        button.style.color = 'var(--accent-text)';
        button.textContent = 'Shorthand';
        button.title = 'Convert Dylen object JSON to shorthand JSON 2';
        button.addEventListener('click', convertCurrentEditorToSecondJson);

        const formatButton = Array.from(targetGroup.querySelectorAll('button')).find(
            (candidate) => candidate.textContent.trim() === 'Format'
        );

        if (formatButton) targetGroup.insertBefore(button, formatButton);
        else targetGroup.appendChild(button);
    }

    window.DylenShorthand = {
        toShorthand: convertToShorthand,
        convertCurrentEditorToSecondJson,
        installButton,
        resolveWidgetKey
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', installButton);
    } else {
        installButton();
    }
})();