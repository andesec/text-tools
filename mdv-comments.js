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
		renderSidebarComments,
		getComments: () => comments,
		setComments: (c) => { comments = c; renderSidebarComments(); updateBadge(); },
		clearComments: () => { comments = []; renderSidebarComments(); updateBadge(); if (window.saveMdvState) window.saveMdvState(); },
		toast,
		closeSaveDropdown,
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
		bubbleEl.style.top = (rect.bottom + 6) + "px";
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
		renderSidebarComments();
		if (window.saveMdvState) {
			window.saveMdvState();
		}
	}

	function deleteComment(id) {
		comments = comments.filter((c) => c.id !== id);
		applyHighlights();
		updateBadge();
		renderSidebarComments();
		toast("Comment removed");
		if (window.saveMdvState) {
			window.saveMdvState();
		}
	}

	// ── Highlight Application ──────────────────────
	function applyHighlights() {
		if (!contentEl || contentEl.classList.contains("hidden")) {
			console.log("[MDV Comments] applyHighlights skipped: contentEl hidden or missing");
			return;
		}

		// Strip existing marks
		contentEl.querySelectorAll("mark.comment-highlight").forEach((m) => {
			const parent = m.parentNode;
			while (m.firstChild) parent.insertBefore(m.firstChild, m);
			parent.removeChild(m);
			parent.normalize();
		});

		console.log("[MDV Comments] Applying highlights for", comments.length, "comments");
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

		// Try exact match first
		let idx = fullText.indexOf(quote);
		let matchLen = quote.length;

		// Fallback: regex with flexible whitespace between words
		if (idx === -1) {
			const words = quote.trim().split(/\s+/).filter(Boolean);
			if (words.length >= 2) {
				const pattern = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
				const re = new RegExp(pattern);
				const m = fullText.match(re);
				if (m) {
					idx = m.index;
					matchLen = m[0].length;
				}
			}
		}

		if (idx === -1) {
			console.log("[MDV Comments] Quote not found in DOM:", quote.substring(0, 60));
			return; // orphaned
		}

		const qEnd = idx + matchLen;
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

	function fallbackCopy(text) {
		const ta = document.createElement("textarea");
		ta.value = text;
		ta.style.position = "fixed";
		ta.style.left = "-9999px";
		document.body.appendChild(ta);
		ta.select();
		try { document.execCommand("copy"); } catch { /* silent */ }
		document.body.removeChild(ta);
	}

	async function copyToClipboard(text, successMsg) {
		try {
			if (navigator.clipboard && window.isSecureContext) {
				await navigator.clipboard.writeText(text);
			} else {
				fallbackCopy(text);
			}
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
		if (!chevron || !mainBtn || !menu) return;

		const originalParent = menu.parentNode;

		function mountToBody() {
			if (menu.parentNode !== document.body) {
				document.body.appendChild(menu);
			}
		}

		function unmountFromBody() {
			if (originalParent && menu.parentNode !== originalParent) {
				originalParent.appendChild(menu);
			}
		}

		function measureMenu() {
			// Briefly show the menu off-screen so we can read its real size
			const prevVisible = menu.classList.contains("visible");
			const prevVisibility = menu.style.visibility;
			if (!prevVisible) {
				menu.style.visibility = "hidden";
				menu.classList.add("visible");
			}
			const width = menu.offsetWidth || 220;
			const height = menu.offsetHeight || 0;
			if (!prevVisible) {
				menu.classList.remove("visible");
				menu.style.visibility = prevVisibility;
			}
			return { width, height };
		}

		function positionMenu() {
			const r = chevron.getBoundingClientRect();
			const vw = window.innerWidth;
			const vh = window.innerHeight;
			const { width: measuredWidth, height } = measureMenu();

			// Constrain width so a fixed-position menu doesn't stretch to fill the viewport
			const width = Math.min(Math.max(measuredWidth, 220), vw - 16);
			menu.style.width = `${width}px`;

			let left = r.right - width;
			if (left < 8) left = 8;
			if (left + width > vw - 8) left = Math.max(8, vw - width - 8);

			let top = r.bottom + 4;
			// If the menu would overflow the bottom, open it upward when there is room
			if (top + height > vh - 8 && r.top - height - 4 > 8) {
				top = r.top - height - 4;
			}

			menu.style.position = "fixed";
			menu.style.top = `${top}px`;
			menu.style.left = `${left}px`;
		}

		function openMenu() {
			if (typeof closeOpenDropdown === "function") closeOpenDropdown();
			mountToBody();
			positionMenu();
			menu.classList.add("visible");
			chevron.setAttribute("aria-expanded", "true");
		}

		function closeMenu() {
			menu.classList.remove("visible");
			chevron.setAttribute("aria-expanded", "false");
			// Move back so it stays with the component when hidden
			unmountFromBody();
			menu.style.width = "";
		}

		function toggleFromPointer(e) {
			e.stopPropagation();
			if (menu.classList.contains("visible")) {
				closeMenu();
			} else {
				openMenu();
				// Force a reflow so iOS reliably renders the fixed menu
				void menu.offsetHeight;
			}
		}

		chevron.addEventListener("click", toggleFromPointer);

		// iOS PWA / Safari sometimes swallows click inside scroll containers;
		// also listen to touch end and deduplicate against the click.
		let touchHandled = false;
		chevron.addEventListener("touchend", (e) => {
			e.preventDefault();
			if (!touchHandled) {
				touchHandled = true;
				toggleFromPointer(e);
				setTimeout(() => { touchHandled = false; }, 300);
			}
		});

		chevron.addEventListener("keydown", (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				if (menu.classList.contains("visible")) {
					closeMenu();
				} else {
					openMenu();
				}
			}
		});

		mainBtn.addEventListener("click", () => {
			window.saveMarkdownOnly();
		});

		document.addEventListener("click", (e) => {
			if (!menu.contains(e.target) && !chevron.contains(e.target)) {
				closeMenu();
			}
		});

		document.addEventListener("keydown", (e) => {
			if (e.key === "Escape") closeMenu();
		});
	}

	function closeSaveDropdown() {
		const menu = document.getElementById("save-dropdown-menu");
		const chevron = document.getElementById("save-chevron-btn");
		const wrapper = document.getElementById("save-dropdown-wrapper");
		if (menu) {
			menu.classList.remove("visible");
			menu.style.width = "";
			if (wrapper && menu.parentNode !== wrapper) wrapper.appendChild(menu);
		}
		if (chevron) chevron.setAttribute("aria-expanded", "false");
	}

	// ── Sidebar Comments Panel ─────────────────────
	function renderSidebarComments() {
		const listEl = document.getElementById("sidebar-comments-list");
		const countEl = document.getElementById("sidebar-comment-count");
		if (!listEl) return;

		if (countEl) countEl.textContent = comments.length > 0 ? comments.length : "";

		if (comments.length === 0) {
			listEl.innerHTML = '<div class="text-gray-400 text-xs italic p-8 text-center">No comments yet.</div>';
			return;
		}

		listEl.innerHTML = "";
		comments.forEach((c) => {
			const item = document.createElement("div");
			item.className = "sidebar-comment-item";
			item.dataset.commentId = c.id;

			const quoteEl = document.createElement("div");
			quoteEl.className = "sidebar-comment-item-quote";
			quoteEl.textContent = c.quote.length > 80 ? c.quote.slice(0, 80) + "…" : c.quote;

			const textEl = document.createElement("div");
			textEl.className = "sidebar-comment-item-text";
			textEl.textContent = c.text;

			const metaEl = document.createElement("div");
			metaEl.className = "sidebar-comment-item-meta";
			metaEl.textContent = new Date(c.createdAt).toLocaleString();

			item.appendChild(quoteEl);
			item.appendChild(textEl);
			item.appendChild(metaEl);

			item.addEventListener("click", () => navigateToComment(c));
			listEl.appendChild(item);
		});
	}

	function navigateToComment(comment) {
		// Switch to view mode if in editor mode
		if (typeof isEditing !== "undefined" && isEditing) {
			const toggleBtn = document.getElementById("toggle-edit-btn");
			if (toggleBtn) toggleBtn.click();
			// Wait for preview to render before scrolling
			setTimeout(() => scrollToCommentMark(comment), 120);
		} else {
			scrollToCommentMark(comment);
		}

		// Close sidebar on mobile devices to reveal the comment/preview
		if (window.innerWidth < 768) {
			if (document.body.classList.contains("mobile-sidebar-active")) {
				document.body.classList.remove("mobile-sidebar-active");
			}
		}
	}

	function scrollToCommentMark(comment) {
		const mark = document.querySelector(`.comment-highlight[data-comment-id="${comment.id}"]`);
		if (mark) {
			mark.scrollIntoView({ behavior: "smooth", block: "center" });
			// Brief flash to draw attention
			mark.classList.add("comment-highlight-flash");
			setTimeout(() => mark.classList.remove("comment-highlight-flash"), 1000);
			showTooltip(comment, mark);
		} else {
			toast("Comment not found in current view");
		}
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
