/* ============================================
   MDV Comments System — Logic
   Depends on globals from mdv.html:
     contentArea, editor, currentFileName,
     isEditing, updatePreview()
   ============================================ */

(function () {
	"use strict";

	// ── State ──────────────────────────────────────
	let comments = [];
	let pendingSelection = null;

	// Expose for mdv.html integration
	window.MdvComments = {
		init,
		applyHighlights,
		parseFromMarkdown,
		getComments: () => comments,
		setComments: (c) => { comments = c; },
		clearComments: () => { comments = []; },
	};

	// ── DOM refs (set in init) ─────────────────────
	let contentEl, bubbleEl, panelEl, panelQuoteEl,
		panelInputEl, tooltipEl, tooltipTextEl,
		tooltipMetaEl, toastEl;

	// ── Initialisation ─────────────────────────────
	function init() {
		contentEl = document.getElementById("content");
		bubbleEl = document.getElementById("comment-bubble");
		panelEl = document.getElementById("comment-panel");
		panelQuoteEl = document.getElementById("comment-panel-quote");
		panelInputEl = document.getElementById("comment-panel-input");
		tooltipEl = document.getElementById("comment-tooltip");
		tooltipTextEl = document.getElementById("comment-tooltip-text");
		tooltipMetaEl = document.getElementById("comment-tooltip-meta");
		toastEl = document.getElementById("comment-toast");

		setupSelectionListener();
		setupPanelButtons();
		setupTooltipButtons();
		setupSaveDropdown();
	}

	// ── Selection → Bubble ─────────────────────────
	function setupSelectionListener() {
		contentEl.addEventListener("mouseup", handleTextSelection);
		contentEl.addEventListener("touchend", () => {
			setTimeout(handleTextSelection, 150);
		});

		document.addEventListener("mousedown", (e) => {
			if (!bubbleEl.contains(e.target)) {
				bubbleEl.style.display = "none";
			}
			if (!tooltipEl.contains(e.target) &&
				!e.target.classList.contains("comment-highlight")) {
				hideTooltip();
			}
		});

		bubbleEl.addEventListener("click", () => {
			bubbleEl.style.display = "none";
			if (pendingSelection) openPanel(pendingSelection.quote);
		});
	}

	function handleTextSelection() {
		if (typeof isEditing !== "undefined" && isEditing) return;
		const sel = window.getSelection();
		if (!sel || sel.isCollapsed || !sel.rangeCount) return;

		const range = sel.getRangeAt(0);
		if (!contentEl.contains(range.commonAncestorContainer)) return;

		const quote = sel.toString().trim();
		if (!quote) return;

		pendingSelection = { quote };
		const rect = range.getBoundingClientRect();
		bubbleEl.style.top = (rect.bottom + window.scrollY + 6) + "px";
		bubbleEl.style.left = (rect.left + rect.width / 2 - 50) + "px";
		bubbleEl.style.display = "block";
	}

	// ── Comment Panel ──────────────────────────────
	function openPanel(quote) {
		panelQuoteEl.textContent = `"${quote.length > 120 ? quote.slice(0, 120) + "…" : quote}"`;
		panelInputEl.value = "";
		panelEl.classList.add("visible");
		setTimeout(() => panelInputEl.focus(), 350);
	}

	function closePanel() {
		panelEl.classList.remove("visible");
		pendingSelection = null;
	}

	function setupPanelButtons() {
		document.getElementById("comment-cancel-btn").addEventListener("click", closePanel);
		document.getElementById("comment-save-btn").addEventListener("click", () => {
			const text = panelInputEl.value.trim();
			if (text && pendingSelection) {
				addComment(pendingSelection.quote, text);
				toast("Comment added");
			}
			closePanel();
		});

		// Ctrl+Enter to save
		panelInputEl.addEventListener("keydown", (e) => {
			if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
				document.getElementById("comment-save-btn").click();
			}
		});
	}

	// ── Comment CRUD ───────────────────────────────
	function addComment(quote, text) {
		const comment = {
			id: "c" + Date.now() + Math.random().toString(36).slice(2, 6),
			quote,
			text,
			createdAt: new Date().toISOString(),
		};
		comments.push(comment);
		window.getSelection().removeAllRanges();
		applyHighlights();
		updateBadge();
	}

	function deleteComment(id) {
		comments = comments.filter((c) => c.id !== id);
		applyHighlights();
		updateBadge();
		toast("Comment removed");
	}

	// ── Highlight Application ──────────────────────
	function applyHighlights() {
		if (!contentEl || contentEl.classList.contains("hidden")) return;

		// Strip existing marks
		contentEl.querySelectorAll("mark.comment-highlight").forEach((m) => {
			const parent = m.parentNode;
			while (m.firstChild) parent.insertBefore(m.firstChild, m);
			parent.removeChild(m);
			parent.normalize();
		});

		comments.forEach((c) => highlightQuote(c.quote, c.id));
	}

	function highlightQuote(quote, commentId) {
		const walker = document.createTreeWalker(contentEl, NodeFilter.SHOW_TEXT);
		const textNodes = [];
		let node;
		while ((node = walker.nextNode())) textNodes.push(node);

		let fullText = "";
		const nodeMap = [];
		textNodes.forEach((tn) => {
			const start = fullText.length;
			fullText += tn.textContent;
			nodeMap.push({ node: tn, start, end: fullText.length });
		});

		const idx = fullText.indexOf(quote);
		if (idx === -1) return; // orphaned

		const qEnd = idx + quote.length;
		const range = document.createRange();
		let startSet = false;

		for (const nm of nodeMap) {
			if (!startSet && nm.end > idx) {
				range.setStart(nm.node, idx - nm.start);
				startSet = true;
			}
			if (nm.end >= qEnd) {
				range.setEnd(nm.node, qEnd - nm.start);
				break;
			}
		}

		const mark = document.createElement("mark");
		mark.className = "comment-highlight";
		mark.dataset.commentId = commentId;

		try {
			range.surroundContents(mark);
		} catch (_) {
			const frag = range.extractContents();
			mark.appendChild(frag);
			range.insertNode(mark);
		}

		mark.addEventListener("click", (e) => {
			e.stopPropagation();
			const c = comments.find((x) => x.id === commentId);
			if (c) showTooltip(c, mark);
		});
	}

	// ── Tooltip ────────────────────────────────────
	function showTooltip(comment, anchorEl) {
		tooltipTextEl.textContent = comment.text;
		tooltipMetaEl.textContent = new Date(comment.createdAt).toLocaleString();
		tooltipEl.dataset.commentId = comment.id;
		tooltipEl.style.display = "block";

		const rect = anchorEl.getBoundingClientRect();

		// Position after display so we can measure
		requestAnimationFrame(() => {
			const tw = tooltipEl.offsetWidth;
			const th = tooltipEl.offsetHeight;
			let top = rect.bottom + 8;
			let left = rect.left;

			if (top + th > window.innerHeight) top = rect.top - th - 8;
			if (left + tw > window.innerWidth) left = window.innerWidth - tw - 10;
			if (left < 10) left = 10;

			tooltipEl.style.top = top + "px";
			tooltipEl.style.left = left + "px";
		});
	}

	function hideTooltip() {
		tooltipEl.style.display = "none";
	}

	function setupTooltipButtons() {
		document.getElementById("comment-tooltip-close").addEventListener("click", () => {
			const id = tooltipEl.dataset.commentId;
			if (id) deleteComment(id);
			hideTooltip();
		});
	}

	// ── Markdown Serialisation ─────────────────────
	const START_TAG = "<!-- mdv-comments:start -->";
	const END_TAG = "<!-- mdv-comments:end -->";

	function parseFromMarkdown(text) {
		const si = text.indexOf(START_TAG);
		const ei = text.indexOf(END_TAG);
		if (si !== -1 && ei !== -1 && ei > si) {
			const json = text.substring(si + START_TAG.length, ei).trim();
			try {
				const parsed = JSON.parse(json);
				const md = text.substring(0, si).trimEnd();
				return { markdown: md, comments: parsed };
			} catch (e) {
				console.error("Failed to parse embedded comments:", e);
			}
		}
		return { markdown: text, comments: [] };
	}

	function serializeComments(mdText) {
		if (!comments.length) return mdText;
		return mdText.trimEnd() + "\n\n" +
			START_TAG + "\n" +
			JSON.stringify(comments, null, 2) + "\n" +
			END_TAG + "\n";
	}

	// ── Save / Export ──────────────────────────────
	function downloadFile(content, name, type) {
		const blob = new Blob([content], { type });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = name;
		a.click();
		URL.revokeObjectURL(url);
	}

	window.saveMarkdownOnly = function () {
		if (!window.editor || !window.currentFileName) return;
		downloadFile(window.editor.state.doc.toString(), window.currentFileName, "text/markdown");
		closeSaveDropdown();
		toast("Markdown saved");
	};

	window.saveMarkdownWithComments = function () {
		if (!window.editor || !window.currentFileName) return;
		const md = window.editor.state.doc.toString();
		const output = serializeComments(md);
		downloadFile(output, window.currentFileName, "text/markdown");
		closeSaveDropdown();
		toast(comments.length ? "Saved with " + comments.length + " comment(s)" : "Markdown saved");
	};

	window.exportComments = function (withQuotes) {
		if (!comments.length) {
			toast("No comments to export");
			closeSaveDropdown();
			return;
		}
		let output = "# Comments — " + (window.currentFileName || "Untitled") + "\n";
		output += "# Exported " + new Date().toLocaleString() + "\n\n";

		comments.forEach((c, i) => {
			output += "---\n";
			output += "### Comment " + (i + 1) + "\n";
			if (withQuotes) {
				output += "> \"" + c.quote + "\"\n\n";
			}
			output += c.text + "\n\n";
		});

		const baseName = (window.currentFileName || "Untitled").replace(/\.\w+$/, "");
		downloadFile(output, baseName + "-comments.md", "text/markdown");
		closeSaveDropdown();
		toast("Comments exported");
	};

	async function copyToClipboard(text, successMsg) {
		try {
			await navigator.clipboard.writeText(text);
			toast(successMsg || "Copied to clipboard");
		} catch (err) {
			console.error("Failed to copy:", err);
			toast("Copy failed");
		}
		closeSaveDropdown();
	}

	window.copyMarkdownOnly = function () {
		if (!window.editor) return;
		copyToClipboard(window.editor.state.doc.toString(), "Markdown copied");
	};

	window.copyMarkdownWithComments = function () {
		if (!window.editor) return;
		const md = window.editor.state.doc.toString();
		const output = serializeComments(md);
		copyToClipboard(output, "Markdown + Comments copied");
	};

	window.copyCommentsToClipboard = function (withQuotes) {
		if (!comments.length) {
			toast("No comments to copy");
			closeSaveDropdown();
			return;
		}
		let output = "# Comments — " + (window.currentFileName || "Untitled") + "\n\n";
		comments.forEach((c, i) => {
			output += "---\n";
			output += "### Comment " + (i + 1) + "\n";
			if (withQuotes) {
				output += "> \"" + c.quote + "\"\n\n";
			}
			output += c.text + "\n\n";
		});
		copyToClipboard(output.trim(), "Comments copied");
	};

	// ── Save Dropdown ──────────────────────────────
	function setupSaveDropdown() {
		const chevron = document.getElementById("save-chevron-btn");
		const mainBtn = document.getElementById("save-main-btn");
		const menu = document.getElementById("save-dropdown-menu");

		chevron.addEventListener("click", (e) => {
			e.stopPropagation();
			menu.classList.toggle("visible");
		});

		mainBtn.addEventListener("click", () => {
			window.saveMarkdownOnly();
		});

		document.addEventListener("click", (e) => {
			if (!menu.contains(e.target) && !chevron.contains(e.target)) {
				menu.classList.remove("visible");
			}
		});
	}

	function closeSaveDropdown() {
		document.getElementById("save-dropdown-menu").classList.remove("visible");
	}

	// ── Badge ──────────────────────────────────────
	function updateBadge() {
		let badge = document.getElementById("comment-count-badge");
		if (comments.length > 0) {
			if (!badge) {
				badge = document.createElement("span");
				badge.id = "comment-count-badge";
				badge.className = "comment-count-badge";
				document.getElementById("save-main-btn").appendChild(badge);
			}
			badge.textContent = comments.length;
		} else if (badge) {
			badge.remove();
		}
	}

	// ── Toast ──────────────────────────────────────
	function toast(msg) {
		toastEl.textContent = msg;
		toastEl.classList.add("visible");
		setTimeout(() => toastEl.classList.remove("visible"), 2000);
	}
})();
