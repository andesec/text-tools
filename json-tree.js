/**
 * json-tree.js — Collapsible JSON tree view.
 *
 * Usage:
 *   const treeView = window.createJsonTreeView({
 *       roots: [treeRootEl, treeMobileEl],
 *       getEditor: () => editor,        // returns current CM EditorView
 *       EditorView: EditorView           // the CM EditorView class
 *   });
 *
 *   treeView.buildTree(text);
 *   treeView.debouncedBuildTree(text);
 *   treeView.expandAll();
 *   treeView.collapseAll();
 *
 * Depends on: json-repair.js (window.JsonRepair)
 */
(function () {
	'use strict';

	window.createJsonTreeView = function (config) {
		const { roots, getEditor, EditorView } = config;

		let currentOffsetMap = null;
		let currentTreeText = null;
		let buildTreeTimer = null;

		// ── buildTree ────────────────────────────────────────────────

		function buildTree(text) {
			const empty = '<div class="json-empty-message">Editor is empty. Paste or type JSON to see the tree view.</div>';
			roots.forEach(r => r.innerHTML = '');

			if (!text || text.trim() === '') {
				currentOffsetMap = null;
				currentTreeText = null;
				roots.forEach(r => r.innerHTML = empty);
				return;
			}

			try {
				const data = window.JsonRepair.safeJsonParse(text);
				currentTreeText = text;
				currentOffsetMap = window.JsonRepair.buildOffsetMap(text);
				roots.forEach(r => r.appendChild(
					renderNode(null, data, true, null, [], currentOffsetMap)
				));
			} catch (e) {
				currentOffsetMap = null;
				currentTreeText = null;
				const errHtml = `<div class="json-error-container">
					<div class="json-error-title">Invalid JSON</div>
					<div class="json-error-message">${e.message}</div>
					<button onclick="repairJsonAction()" class="json-error-btn">Try to Auto-Fix JSON</button>
				</div>`;
				roots.forEach(r => r.innerHTML = errHtml);
			}
		}

		function debouncedBuildTree(text) {
			if (buildTreeTimer) clearTimeout(buildTreeTimer);
			buildTreeTimer = setTimeout(() => buildTree(text), 300);
		}

		// ── renderNode ───────────────────────────────────────────────

		function renderNode(key, value, isLast, index, path, offsetMap) {
			const node = document.createElement('div');
			node.className = 'json-node collapsed';

			const currentPath = index !== null ? [...path, index] : (key !== null ? [...path, key] : path);
			const pathKey = JSON.stringify(currentPath);
			node.dataset.path = pathKey;

			const content = document.createElement('span');
			content.className = 'json-node-content';

			if (index !== null) {
				const indexSpan = document.createElement('span');
				indexSpan.className = 'json-index';
				indexSpan.textContent = `[${index}]`;
				content.appendChild(indexSpan);
			}

			if (key !== null) {
				const keySpan = document.createElement('span');
				keySpan.className = 'json-key';
				keySpan.textContent = `"${key}": `;
				content.appendChild(keySpan);
			}

			const isObject = value !== null && typeof value === 'object';

			if (isObject) {
				const isArray = Array.isArray(value);
				const openBracket = isArray ? '[' : '{';
				const closeBracket = isArray ? ']' : '}';
				const count = isArray ? value.length : Object.keys(value).length;

				const label = document.createElement('span');
				label.textContent = openBracket;
				content.appendChild(label);

				const ellipsis = document.createElement('span');
				ellipsis.className = 'json-ellipsis collapsed-only';
				ellipsis.textContent = '...';
				content.appendChild(ellipsis);

				const closeLabel = document.createElement('span');
				closeLabel.className = 'collapsed-only';
				closeLabel.textContent = closeBracket + (isLast ? '' : ',');
				content.appendChild(closeLabel);

				const meta = document.createElement('span');
				meta.className = 'json-meta';
				meta.textContent = `${count} ${isArray ? 'item' : 'field'}${count !== 1 ? 's' : ''}`;
				content.appendChild(meta);

				const toggle = document.createElement('div');
				toggle.className = 'json-toggle';
				toggle.onclick = (e) => { e.stopPropagation(); node.classList.toggle('collapsed'); };
				node.appendChild(toggle);

				const children = document.createElement('div');
				children.className = 'json-children';

				const keys = Object.keys(value);
				keys.forEach((k, i) => {
					children.appendChild(renderNode(
						isArray ? null : k, value[k],
						i === keys.length - 1,
						isArray ? i : null,
						currentPath, offsetMap
					));
				});
				node.appendChild(content);
				node.appendChild(children);

				const footer = document.createElement('div');
				footer.className = 'json-bracket-closing expanded-only';
				footer.textContent = closeBracket + (isLast ? '' : ',');
				node.appendChild(footer);
			} else {
				const valSpan = document.createElement('span');
				const type = value === null ? 'null' : typeof value;
				valSpan.className = `json-value-${type}`;
				valSpan.textContent = type === 'string'
					? (value.length > 200 ? `"${value.substring(0, 200)}..."` : `"${value}"`)
					: String(value);
				content.appendChild(valSpan);

				const badge = document.createElement('span');
				badge.className = `json-type-badge json-type-${type}`;
				badge.textContent = type === 'string' ? `str·${value.length}` : type;
				content.appendChild(badge);

				if (!isLast) content.appendChild(document.createTextNode(','));
				node.appendChild(content);
			}

			// ── Click → scroll editor to this path ───────────────────
			content.onclick = (e) => {
				e.stopPropagation();
				const editor = getEditor();
				if (!editor) return;

				const editorText = editor.state.doc.toString();
				let activeMap = currentOffsetMap;
				if (!activeMap || currentTreeText !== editorText) {
					try {
						activeMap = window.JsonRepair.buildOffsetMap(editorText);
						currentOffsetMap = activeMap;
						currentTreeText = editorText;
					} catch (err) { return; }
				}

				if (!activeMap.has(pathKey)) return;

				const offset = activeMap.get(pathKey);
				if (offset < 0 || offset >= editorText.length) return;

				let end = offset;
				if (editorText[offset] === '"') {
					end++;
					while (end < editorText.length && editorText[end] !== '"') {
						if (editorText[end] === '\\') end++;
						end++;
					}
					end++;
				} else if (editorText[offset] === '{' || editorText[offset] === '[') {
					end = offset + 1;
				} else {
					while (end < editorText.length && /[^,\]\}\s]/.test(editorText[end])) end++;
				}

				editor.dispatch({
					selection: { anchor: offset, head: end },
					effects: EditorView.scrollIntoView(offset, { y: 'center' }),
					scrollIntoView: true
				});
				requestAnimationFrame(() => editor.focus());

				node.classList.add('tree-node-active');
				setTimeout(() => node.classList.remove('tree-node-active'), 600);
			};

			return node;
		}

		// ── Expand / Collapse ────────────────────────────────────────

		function expandAll() {
			roots.forEach(root => {
				root.querySelectorAll('.json-node').forEach(n => n.classList.remove('collapsed'));
			});
		}

		function collapseAll() {
			roots.forEach(root => {
				root.querySelectorAll('.json-node').forEach(n => n.classList.add('collapsed'));
			});
		}

		// ── Public API ───────────────────────────────────────────────

		return { buildTree, debouncedBuildTree, expandAll, collapseAll };
	};
})();
