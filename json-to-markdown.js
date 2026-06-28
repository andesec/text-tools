/**
 * json-to-markdown.js — Transform JSON data into readable Markdown.
 *
 * Exposes window.J2MD with:
 *   toMarkdown(value, opts)
 *   pickTitle(obj)
 *   slugify(s)
 *   deriveFilename(data, currentFileName)
 *
 * Walks any JSON value and emits readable markdown. Smart about:
 *  - top-level title fields (becomes H1)
 *  - frontmatter (scalar/short fields → bullets at the top)
 *  - arrays of objects (becomes sections with H2/H3 titles)
 *  - widget-wrapper pattern: { widgetName: { ... } } (unwraps and
 *    uses the inner title for the section heading)
 *  - depth-based heading levels (capped at H6)
 */
(function () {
	'use strict';

	const TITLE_KEYS = ['title', 'name', 'heading', 'label'];

	const META_KEYS = new Set([
		'study_duration', 'duration_seconds', 'align', 'karut',
		'keywords', 'lang', 'ai_prompt', 'grader_prompt',
		'wordlist_csv', 'criteria', 'hint', 'explanation',
		'structure', 'match', 'id', 'roleplay'
	]);

	const NO_LABEL_FIELDS = new Set([
		'markdown', 'content', 'text', 'html', 'description', 'body',
		'question', 'q', 'answer', 'a', 'explanation', 'e', 'hint',
		'prompt', 'rows', 'flow', 'wordlist_csv', 'criteria',
		'grader_prompt', 'ai_prompt', 'lang', 'structure', 'choices',
		'fillblank', 'match_pairs'
	]);

	// ── Predicates ────────────────────────────────────────────────────

	function isScalar(v) {
		return v === null || v === undefined || typeof v === 'boolean' ||
			(typeof v !== 'object' && typeof v !== 'string');
	}

	function isShortString(v) {
		return typeof v === 'string' && v.length < 100 && !v.includes('\n');
	}

	function isPrimitiveArray(v) {
		return Array.isArray(v) && v.length > 0 &&
			v.every(x => isScalar(x) || typeof x === 'string');
	}

	function isSmallObject(obj) {
		if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
		const keys = Object.keys(obj);
		if (keys.length === 0 || keys.length > 6) return false;
		return keys.every(k => {
			const v = obj[k];
			return isScalar(v) || isShortString(v) || isPrimitiveArray(v);
		});
	}

	function isTable(v) {
		if (!Array.isArray(v) || v.length < 2) return false;
		if (!v.every(row => Array.isArray(row))) return false;
		const colCount = v[0].length;
		if (colCount === 0) return false;
		return v.every(row =>
			row.length === colCount &&
			row.every(cell => cell === null || ['string', 'number', 'boolean'].includes(typeof cell))
		);
	}

	function isWidgetWrapper(obj) {
		if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
		const keys = Object.keys(obj);
		if (keys.length !== 1) return false;
		const v = obj[keys[0]];
		return v && typeof v === 'object' && !Array.isArray(v);
	}

	function looksLikeCode(s) {
		if (s.length > 150 && /[{};]/.test(s) && /\n/.test(s)) return true;
		if (/(^|\n)\s*(function|const|let|var|class|import|export|if|for|while|return|def)\b/.test(s)) return true;
		return false;
	}

	// ── Helpers ───────────────────────────────────────────────────────

	function humanizeKey(key) {
		return String(key)
			.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
			.replace(/[_-]+/g, ' ')
			.replace(/\s+/g, ' ')
			.trim()
			.replace(/\b\w/g, c => c.toUpperCase());
	}

	function pickTitle(obj) {
		if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
		for (const k of TITLE_KEYS) {
			if (typeof obj[k] === 'string' && obj[k].trim()) return obj[k].trim();
		}
		return null;
	}

	function stripTitle(obj) {
		const t = pickTitle(obj);
		if (!t) return obj;
		const out = {};
		for (const k of Object.keys(obj)) {
			if (TITLE_KEYS.includes(k) && typeof obj[k] === 'string' && obj[k].trim() === t) continue;
			out[k] = obj[k];
		}
		return out;
	}

	function unwrapWidget(obj) {
		const k = Object.keys(obj)[0];
		return { key: k, value: obj[k] };
	}

	function autoLink(s) {
		return s.replace(/(https?:\/\/\S+)/g, '[$1]($1)');
	}

	function renderString(s) {
		if (looksLikeCode(s)) return '```\n' + s + '\n```';
		const linked = autoLink(s);
		return linked.split(/\n\s*\n+/).map(p => p.trim()).filter(Boolean).join('\n\n');
	}

	// ── Renderers ────────────────────────────────────────────────────

	function renderObjectList(arr) {
		return arr.map(v => {
			const parts = Object.keys(v).map(k => {
				const val = v[k];
				if (isPrimitiveArray(val)) {
					return `**${humanizeKey(k)}:** ${val.join(', ')}`;
				}
				return `**${humanizeKey(k)}:** ${val}`;
			});
			return `- ${parts.join(' · ')}`;
		}).join('\n');
	}

	function renderTable(arr) {
		const colCount = arr[0].length;
		const escape = s => String(s == null ? '' : s)
			.replace(/\|/g, '\\|')
			.replace(/\r?\n/g, ' ');
		const header = `| ${arr[0].map(escape).join(' | ')} |`;
		const sep = `| ${Array(colCount).fill('---').join(' | ')} |`;
		const rows = arr.slice(1)
			.map(row => `| ${row.map(escape).join(' | ')} |`)
			.join('\n');
		return [header, sep, rows].join('\n');
	}

	function renderKeyBlock(key, value, opts) {
		if (value === null || value === undefined || value === '') return '';
		if (Array.isArray(value) && value.length === 0) return '';
		if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) return '';
		const humanKey = humanizeKey(key);
		const depth = opts && opts.depth || 0;
		const sectionDepth = opts && opts.sectionDepth || 0;

		if (isScalar(value)) return `- **${humanKey}:** ${value}`;
		if (isShortString(value)) return `- **${humanKey}:** ${value}`;
		if (isPrimitiveArray(value)) {
			const items = value.map(v => `  - ${v}`).join('\n');
			return `**${humanKey}:**\n${items}`;
		}
		if (typeof value === 'string') {
			return `**${humanKey}:**\n\n${renderString(value)}`;
		}

		const isTopLevelArray = opts.isTopLevel &&
			Array.isArray(value) && value.length > 0 &&
			value.every(v => v && typeof v === 'object' && !Array.isArray(v));
		const headingLevel = isTopLevelArray
			? Math.min(6, 2)
			: Math.min(6, sectionDepth + 2 + depth);
		const body = toMarkdown(value, { ...opts, depth: depth + 1 });
		if (!body) return '';
		return `${'#'.repeat(headingLevel)} ${humanKey}\n\n${body}`;
	}

	function renderWidgetSection(item, opts) {
		const { key: widgetKey, value: cfg } = unwrapWidget(item);
		const widgetLabel = humanizeKey(widgetKey);
		const title = pickTitle(cfg);
		const headingLevel = Math.min(6, opts.sectionDepth + 2);

		const meta = {};
		const content = {};
		for (const k of Object.keys(cfg)) {
			if (TITLE_KEYS.includes(k)) continue;
			if (META_KEYS.has(k)) meta[k] = cfg[k];
			else content[k] = cfg[k];
		}

		let out = '';
		const heading = title
			? (widgetKey && widgetKey.toLowerCase() !== title.toLowerCase()
				? `${title} _(${widgetLabel})_`
				: title)
			: widgetLabel;
		out += `${'#'.repeat(headingLevel)} ${heading}\n\n`;

		const metaParts = [];
		if (meta.study_duration != null) metaParts.push(`*Duration: ${meta.study_duration} min*`);
		if (meta.duration_seconds != null) metaParts.push(`*Duration: ${meta.duration_seconds} sec*`);
		if (meta.align) metaParts.push(`*Align: ${meta.align}*`);
		if (meta.lang) metaParts.push(`*Lang: ${meta.lang}*`);
		if (Array.isArray(meta.karut) && meta.karut.length) metaParts.push(`*KARUT: ${meta.karut.join(', ')}*`);
		if (Array.isArray(meta.keywords) && meta.keywords.length) metaParts.push(`*Keywords: ${meta.keywords.join(', ')}*`);
		if (Array.isArray(meta.criteria) && meta.criteria.length) metaParts.push(`*Criteria: ${meta.criteria.length} items*`);
		if (metaParts.length) out += metaParts.join(' · ') + '\n\n';

		for (const k of Object.keys(content)) {
			const v = content[k];
			if (v === null || v === undefined || v === '') continue;
			if (NO_LABEL_FIELDS.has(k)) {
				const rendered = toMarkdown(v, { ...opts, depth: 1 });
				if (rendered) out += rendered + '\n\n';
			} else {
				const block = renderKeyBlock(k, v, { ...opts, depth: 1 });
				if (block) out += block + '\n\n';
			}
		}
		return out.trim();
	}

	function renderSectionItem(item, idx, opts) {
		if (isWidgetWrapper(item)) return renderWidgetSection(item, opts);
		const title = pickTitle(item);
		const cleanItem = stripTitle(item);
		const headingLevel = Math.min(6, opts.sectionDepth + 2);
		const heading = title || `Item ${idx + 1}`;
		const body = toMarkdown(cleanItem, { ...opts, depth: 1 });
		if (!body) return `${'#'.repeat(headingLevel)} ${heading}`;
		return `${'#'.repeat(headingLevel)} ${heading}\n\n${body}`;
	}

	function renderTopLevel(obj, opts) {
		const keys = Object.keys(obj);
		if (keys.length === 0) return '';
		const titleKey = keys.find(k =>
			TITLE_KEYS.includes(k) && typeof obj[k] === 'string' && obj[k].trim());
		const title = titleKey ? obj[titleKey].trim() : null;

		if (!title) {
			const nonEmptyKeys = keys.filter(k => {
				const v = obj[k];
				return !(v === null || v === undefined || v === '' ||
					(Array.isArray(v) && v.length === 0));
			});
			if (nonEmptyKeys.length === 1) {
				const k = nonEmptyKeys[0];
				const v = obj[k];
				if (Array.isArray(v) && v.length > 0 &&
					v.every(x => x && typeof x === 'object' && !Array.isArray(x))) {
					if (v.every(isSmallObject)) {
						return renderObjectList(v);
					}
					return v
						.map((item, i) => renderSectionItem(item, i, { ...opts, sectionDepth: 0 }))
						.filter(Boolean)
						.join('\n\n---\n\n')
						.trim();
				}
			}
		}

		const scalarKeys = keys.filter(k => {
			if (k === titleKey) return false;
			const v = obj[k];
			return isScalar(v) || isShortString(v) || isPrimitiveArray(v);
		});
		const complexKeys = keys.filter(k => k !== titleKey && !scalarKeys.includes(k));

		let out = '';
		if (title) out += `# ${title}\n\n`;
		if (scalarKeys.length) {
			const lines = scalarKeys.map(k => {
				const v = obj[k];
				if (isPrimitiveArray(v)) return `- **${humanizeKey(k)}:** ${v.join(', ')}`;
				return `- **${humanizeKey(k)}:** ${v}`;
			});
			out += lines.join('\n') + '\n\n';
		}
		if (complexKeys.length) {
			out += complexKeys
				.map(k => renderKeyBlock(k, obj[k], { ...opts, depth: 1, sectionDepth: 0, isTopLevel: true }))
				.filter(Boolean)
				.join('\n\n');
		}
		return out.trim();
	}

	function renderNestedObject(obj, opts) {
		const keys = Object.keys(obj);
		if (keys.length === 0) return '';
		const safeOpts = opts.sectionDepth === undefined
			? { ...opts, sectionDepth: 0 }
			: opts;
		return keys
			.map(k => renderKeyBlock(k, obj[k], safeOpts))
			.filter(Boolean)
			.join('\n\n');
	}

	// ── Main entry point ─────────────────────────────────────────────

	function toMarkdown(value, opts) {
		opts = opts || {};
		const depth = opts.depth || 0;
		const sectionDepth = opts.sectionDepth || 0;
		const seen = opts.seen || new WeakSet();

		if (value === null || value === undefined) return '';
		if (typeof value === 'object') {
			if (seen.has(value)) return '_(circular)_';
			seen.add(value);
		}
		if (typeof value === 'boolean') return value ? 'true' : 'false';
		if (typeof value === 'number') return String(value);
		if (typeof value === 'string') return renderString(value);

		if (Array.isArray(value)) {
			if (value.length === 0) return '';
			if (isTable(value)) return renderTable(value);
			if (value.every(v => v && typeof v === 'object' && !Array.isArray(v))) {
				if (value.every(isSmallObject)) {
					return renderObjectList(value);
				}
				const sep = '\n\n---\n\n';
				return value
					.map((v, i) => renderSectionItem(v, i, { ...opts, sectionDepth: sectionDepth + 1 }))
					.filter(Boolean)
					.join(sep);
			}
			return value.map(v => {
				const inner = toMarkdown(v, { ...opts, depth: depth + 1, sectionDepth });
				const flat = inner.replace(/\n/g, ' ').trim();
				return `- ${flat}`;
			}).join('\n');
		}

		if (depth === 0) return renderTopLevel(value, opts);
		return renderNestedObject(value, opts);
	}

	// ── Filename helpers ─────────────────────────────────────────────

	function slugify(s) {
		return String(s)
			.toLowerCase()
			.replace(/[^\w\s-]/g, '')
			.replace(/[\s_-]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 80);
	}

	function deriveFilename(data, currentFileName) {
		if (data && typeof data === 'object') {
			const t = pickTitle(data);
			if (t) {
				const slug = slugify(t);
				if (slug) return `${slug}.md`;
			}
		}
		const fn = (currentFileName || '').trim();
		if (fn && !/^scratchpad-\d+\.json$/i.test(fn)) {
			return fn.replace(/\.json$/i, '.md');
		}
		return 'output.md';
	}

	// ── Public API ───────────────────────────────────────────────────

	window.J2MD = {
		toMarkdown,
		pickTitle,
		slugify,
		deriveFilename
	};
})();
