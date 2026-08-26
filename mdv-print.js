/* ==========================================================================
   MDV Print, Captions & Image Resize Module
   Modular extension for mdv.html

   Features:
   1. Print / Save to PDF using browser native print system (keeps text native)
   2. Visible image captions (from alt-text or title) rendered below images
   3. 4-step image resizing (small 20%, medium 45% [default], large 75%, full 100%)
   4. Portrait aspect ratio detection with viewport-based height limits
   5. In-memory size persistence across preview re-renders
   6. Clean @media print formatting hiding UI chrome & preserving figures/graphics
   ========================================================================== */

(function () {
	"use strict";

	const SIZES = ["medium", "large", "full", "small"];
	const DEFAULT_SIZE = "medium";

	const SIZE_LABELS = {
		small: "Small (20%)",
		medium: "Medium (45%)",
		large: "Large (75%)",
		full: "Full width (100%)"
	};

	// In-memory persistence for image sizes across preview re-renders
	// Key: image src or unique identifier -> value: size ('small'|'medium'|'large'|'full')
	const imageSizeMap = new Map();

	// Store folded headings during print so they can be restored afterwards
	let foldedHeadingsBeforePrint = [];

	/* ── Inject Stylesheet ─────────────────────────────────────────────── */
	function injectStyles() {
		if (document.getElementById("mdv-print-styles")) return;

		const style = document.createElement("style");
		style.id = "mdv-print-styles";
		style.textContent = `
			/* ── In-Preview Image Container Sizing ── */
			.mdv-image-container {
				max-width: 45%;
				width: 100%;
				transition: max-width var(--transition-base, 0.2s ease);
			}

			.mdv-image-container[data-mdv-size="small"] {
				max-width: 20%;
				width: 100%;
			}

			.mdv-image-container[data-mdv-size="medium"] {
				max-width: 45%;
				width: 100%;
			}

			.mdv-image-container[data-mdv-size="large"] {
				max-width: 75%;
				width: 100%;
			}

			.mdv-image-container[data-mdv-size="full"] {
				max-width: 100%;
				width: 100%;
			}

			/* ── Portrait Aspect Ratio (naturalHeight > naturalWidth) ── */
			.mdv-image-container[data-mdv-portrait="true"] {
				width: fit-content;
				max-width: 100%;
			}

			.mdv-image-container[data-mdv-portrait="true"] img {
				width: auto;
				max-width: 100%;
				object-fit: contain;
			}

			.mdv-image-container[data-mdv-portrait="true"][data-mdv-size="small"] img {
				max-height: 30vh;
			}

			.mdv-image-container[data-mdv-portrait="true"][data-mdv-size="medium"] img {
				max-height: 55vh;
			}

			.mdv-image-container[data-mdv-portrait="true"][data-mdv-size="large"] img {
				max-height: 75vh;
			}

			.mdv-image-container[data-mdv-portrait="true"][data-mdv-size="full"] img {
				max-height: 90vh;
			}

			/* Mobile responsive adjustment */
			@media (max-width: 640px) {
				.mdv-image-container {
					max-width: 100% !important;
				}
				.mdv-image-container[data-mdv-portrait="true"] img {
					max-height: 60vh !important;
				}
			}

			/* ── Resize Overlay Button (positioned beside delete button) ── */
			.mdv-image-resize-btn {
				position: absolute;
				top: 8px;
				right: 40px;
				z-index: 10;
				display: flex;
				align-items: center;
				justify-content: center;
				width: 28px;
				height: 28px;
				padding: 0;
				border-radius: var(--radius-md);
				border: 1px solid var(--border-default);
				background-color: var(--bg-surface-raised);
				color: var(--text-secondary);
				cursor: pointer;
				transition: background-color 0.15s, color 0.15s, border-color 0.15s, transform 0.1s;
			}

			.mdv-image-resize-btn:hover {
				background-color: var(--bg-surface-hover);
				color: var(--text-primary);
				border-color: var(--border-strong);
				transform: scale(1.05);
			}

			.mdv-image-resize-btn:active {
				transform: scale(0.95);
			}

			/* ── Visible Image Caption ── */
			.mdv-image-caption {
				padding: 6px 12px;
				font-size: var(--font-size-xs, 12px);
				line-height: 1.45;
				color: var(--text-secondary);
				background-color: var(--bg-surface);
				border-top: 1px solid var(--border-subtle, var(--border-default));
				text-align: center;
				font-style: italic;
				word-break: break-word;
			}

			/* ── Native Print / PDF Styles ───────────────────────────── */
			@media print {
				@page {
					margin: 1.5cm;
					size: auto;
				}

				/* Hide UI application chrome, toolbars, sidebars, buttons, comments, toasts and modals */
				header,
				footer,
				aside,
				#sidebar,
				.sidebar-resizer,
				#editor-container,
				#tts-player-bar,
				.save-modal,
				dialog,
				.mdv-image-delete-btn,
				.mdv-image-resize-btn,
				.mdv-image-url-bar,
				.btn-run-code,
				.md-fence-toolbar,
				.heading-fold-toggle,
				.anchor,
				.tts-speak-btn,
				#comment-panel,
				.comment-panel,
				#comment-panel-quote,
				.comment-panel-quote,
				#comment-panel-input,
				.comment-panel-textarea,
				.comment-panel-actions,
				#comment-toast,
				.comment-toast,
				#comment-bubble,
				.comment-bubble-btn,
				#comment-tooltip,
				.comment-tooltip,
				#comment-drawer,
				.comment-marker,
				.save-dropdown-menu,
				.open-dropdown-menu,
				.no-print {
					display: none !important;
					visibility: hidden !important;
				}

				/* Strip comment highlight background in print */
				.comment-highlight {
					background-color: transparent !important;
					color: inherit !important;
					border: none !important;
					box-shadow: none !important;
					padding: 0 !important;
				}

				/* Reset root, body, and wrapper containers for unclipped continuous paper output without borders */
				html, body {
					width: 100% !important;
					height: auto !important;
					min-height: 0 !important;
					overflow: visible !important;
					background: rgb(255, 255, 255) !important;
					color: rgb(17, 24, 39) !important;
					font-size: 11pt !important;
					line-height: 1.5 !important;
					border: none !important;
					box-shadow: none !important;
				}

				body > div.flex-1,
				main,
				main.flex-1 {
					display: block !important;
					width: 100% !important;
					height: auto !important;
					overflow: visible !important;
					padding: 0 !important;
					margin: 0 !important;
					border: none !important;
					outline: none !important;
					box-shadow: none !important;
					background: rgb(255, 255, 255) !important;
				}

				#content,
				article#content,
				article {
					display: block !important;
					width: 100% !important;
					max-width: 100% !important;
					height: auto !important;
					overflow: visible !important;
					padding: 0 !important;
					margin: 0 !important;
					color: rgb(17, 24, 39) !important;
					border: none !important;
					border-left: none !important;
					border-right: none !important;
					border-top: none !important;
					border-bottom: none !important;
					outline: none !important;
					box-shadow: none !important;
					background: rgb(255, 255, 255) !important;
				}

				/* Headings */
				h1, h2, h3, h4, h5, h6 {
					break-after: avoid !important;
					page-break-after: avoid !important;
					color: rgb(17, 24, 39) !important;
				}

				h1 {
					border-bottom: 1px solid rgb(229, 231, 235) !important;
					padding-bottom: 4pt !important;
					margin-top: 16pt !important;
					margin-bottom: 10pt !important;
				}

				h2 {
					border-bottom: 1px solid rgb(229, 231, 235) !important;
					padding-bottom: 3pt !important;
					margin-top: 14pt !important;
					margin-bottom: 8pt !important;
				}

				/* Preserve graphics and code blocks without awkward splitting */
				pre, blockquote, table, .markdown-alert, .katex-display, .mermaid {
					break-inside: avoid !important;
					page-break-inside: avoid !important;
				}

				pre {
					background-color: rgb(248, 249, 250) !important;
					color: rgb(17, 24, 39) !important;
					border: 1px solid rgb(229, 231, 235) !important;
					border-radius: 4px !important;
					font-size: 9pt !important;
					line-height: 1.4 !important;
					white-space: pre-wrap !important;
					word-break: break-word !important;
					padding: 8pt 10pt !important;
				}

				.prose :not(pre) > code {
					background-color: rgb(243, 244, 246) !important;
					color: rgb(17, 24, 39) !important;
					border: 1px solid rgb(229, 231, 235) !important;
					font-size: 9pt !important;
					padding: 1pt 3pt !important;
				}

				/* Tables */
				.prose table {
					width: 100% !important;
					border-collapse: collapse !important;
					font-size: 9pt !important;
					margin: 12pt 0 !important;
				}

				.prose th, .prose td {
					border: 1px solid rgb(209, 213, 219) !important;
					padding: 4pt 8pt !important;
				}

				.prose th {
					background-color: rgb(243, 244, 246) !important;
					font-weight: 600 !important;
				}

				.prose tr {
					background-color: rgb(255, 255, 255) !important;
				}

				.prose tr:nth-child(2n) {
					background-color: rgb(249, 250, 251) !important;
				}

				/* Blockquotes */
				.prose blockquote {
					border-left: 3pt solid rgb(209, 213, 219) !important;
					color: rgb(75, 85, 99) !important;
					padding-left: 10pt !important;
					margin: 10pt 0 !important;
				}

				/* Alerts */
				.markdown-alert {
					border-left: 3pt solid rgb(156, 163, 175) !important;
					background-color: rgb(249, 250, 251) !important;
					border-radius: 0 4px 4px 0 !important;
					padding: 8pt 12pt !important;
					margin: 10pt 0 !important;
				}

				.markdown-alert-note {
					border-left-color: rgb(37, 99, 235) !important;
				}

				.markdown-alert-tip {
					border-left-color: rgb(22, 163, 74) !important;
				}

				.markdown-alert-important {
					border-left-color: rgb(130, 80, 223) !important;
				}

				.markdown-alert-warning {
					border-left-color: rgb(217, 119, 6) !important;
				}

				.markdown-alert-caution {
					border-left-color: rgb(220, 38, 38) !important;
				}

				/* Images & Figures in Print — Clean, borderless native document style */
				.mdv-image-container {
					display: block !important;
					margin: 14pt auto !important;
					border: none !important;
					border-radius: 0 !important;
					background: transparent !important;
					background-color: transparent !important;
					break-inside: avoid !important;
					page-break-inside: avoid !important;
					box-shadow: none !important;
					padding: 0 !important;
				}

				.mdv-image-container img {
					display: block !important;
					width: 100% !important;
					height: auto !important;
					margin: 0 auto !important;
					border: none !important;
					box-shadow: none !important;
				}

				/* Sizing presets in print */
				.mdv-image-container[data-mdv-size="small"] {
					max-width: 20% !important;
				}

				.mdv-image-container[data-mdv-size="medium"] {
					max-width: 45% !important;
				}

				.mdv-image-container[data-mdv-size="large"] {
					max-width: 75% !important;
				}

				.mdv-image-container[data-mdv-size="full"] {
					max-width: 100% !important;
				}

				/* Portrait image constraints in print */
				.mdv-image-container[data-mdv-portrait="true"] {
					width: fit-content !important;
				}

				.mdv-image-container[data-mdv-portrait="true"] img {
					width: auto !important;
				}

				.mdv-image-container[data-mdv-portrait="true"][data-mdv-size="small"] img {
					max-height: 2.2in !important;
				}

				.mdv-image-container[data-mdv-portrait="true"][data-mdv-size="medium"] img {
					max-height: 4in !important;
				}

				.mdv-image-container[data-mdv-portrait="true"][data-mdv-size="large"] img {
					max-height: 6in !important;
				}

				.mdv-image-container[data-mdv-portrait="true"][data-mdv-size="full"] img {
					max-height: 8in !important;
				}

				/* Visible Image Caption in Print — Clean, unbordered text */
				.mdv-image-caption {
					display: block !important;
					font-size: 9pt !important;
					line-height: 1.4 !important;
					color: rgb(75, 85, 99) !important;
					text-align: center !important;
					padding: 5pt 0 0 0 !important;
					margin: 0 !important;
					background: transparent !important;
					background-color: transparent !important;
					border: none !important;
					border-top: none !important;
					font-style: italic !important;
				}

				/* Links in print */
				a {
					color: rgb(29, 78, 216) !important;
					text-decoration: underline !important;
				}
			}
		`;
		document.head.appendChild(style);
	}

	/* ── Update button tooltip & container attributes ─────────────────── */
	function applySize(container, resizeBtn, size) {
		container.setAttribute("data-mdv-size", size);
		const label = SIZE_LABELS[size] || size;
		const tooltip = "Image size: " + label + " — Click to cycle";
		resizeBtn.title = tooltip;
		resizeBtn.setAttribute("aria-label", tooltip);
	}

	/* ── Detect Aspect Ratio for Portrait Height Limiting ─────────────── */
	function detectAspectRatio(img, container) {
		if (img.naturalWidth > 0 && img.naturalHeight > 0) {
			if (img.naturalHeight > img.naturalWidth) {
				container.setAttribute("data-mdv-portrait", "true");
			} else {
				container.removeAttribute("data-mdv-portrait");
			}
		}
	}

	/* ── Enhance an Image Container (Captions, Resize, Portrait Detection) ── */
	function enhanceImage(container, img, imgIndex, src, alt) {
		const imageKey = src || ("img-" + imgIndex);

		// 1. Initial size from in-memory persistence (default: medium)
		const savedSize = imageSizeMap.get(imageKey) || DEFAULT_SIZE;

		// 2. Resize button overlay (top-right, placed beside delete button)
		let resizeBtn = container.querySelector(".mdv-image-resize-btn");
		if (!resizeBtn) {
			resizeBtn = document.createElement("button");
			resizeBtn.type = "button";
			resizeBtn.className = "mdv-image-resize-btn";
			// Crisp corner-resize icon SVG
			resizeBtn.innerHTML = '<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><path d="M1.5 1a.5.5 0 0 0-.5.5v4a.5.5 0 0 0 1 0V2.707l3.146 3.147a.5.5 0 0 0 .708-.708L2.707 2H5.5a.5.5 0 0 0 0-1h-4zm13 0a.5.5 0 0 0-.5.5v2.793l-3.146 3.147a.5.5 0 0 0 .708.708L14.707 5H12a.5.5 0 0 0 0 1h4a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 0-.5-.5zM5.354 10.146a.5.5 0 0 0-.708 0L1.5 13.293V10.5a.5.5 0 0 0-1 0v4a.5.5 0 0 0 .5.5h4a.5.5 0 0 0 0-1H2.207l3.147-3.146a.5.5 0 0 0 0-.708zm5.292 0a.5.5 0 0 0 0 .708L13.793 14H11a.5.5 0 0 0 0 1h4a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 0-1 0v2.793l-3.146-3.147a.5.5 0 0 0-.708 0z"/></svg>';

			resizeBtn.onclick = function (e) {
				e.preventDefault();
				e.stopPropagation();
				const currentSize = container.getAttribute("data-mdv-size") || DEFAULT_SIZE;
				const curIdx = SIZES.indexOf(currentSize);
				const nextSize = SIZES[(curIdx + 1) % SIZES.length];

				imageSizeMap.set(imageKey, nextSize);
				applySize(container, resizeBtn, nextSize);

				if (window.MdvComments && typeof window.MdvComments.toast === "function") {
					window.MdvComments.toast("Image size: " + SIZE_LABELS[nextSize]);
				}
			};

			container.appendChild(resizeBtn);
		}

		applySize(container, resizeBtn, savedSize);

		// 3. Image Caption (rendered below image, above url bar)
		const captionText = (alt || img.getAttribute("title") || "").trim();
		let captionEl = container.querySelector(".mdv-image-caption");
		if (captionText) {
			if (!captionEl) {
				captionEl = document.createElement("div");
				captionEl.className = "mdv-image-caption";
				// Insert before url bar if one already exists, else append
				const urlBar = container.querySelector(".mdv-image-url-bar");
				if (urlBar) {
					container.insertBefore(captionEl, urlBar);
				} else {
					container.appendChild(captionEl);
				}
			}
			captionEl.textContent = captionText;
			captionEl.title = captionText;
		} else if (captionEl) {
			captionEl.remove();
		}

		// 4. Portrait aspect ratio detection
		if (img.complete && img.naturalWidth > 0) {
			detectAspectRatio(img, container);
		} else {
			img.addEventListener("load", function () {
				detectAspectRatio(img, container);
			}, { once: true });
		}
	}

	/* ── Prepare Content and Trigger Browser Print ────────────────────── */
	async function printDocument() {
		// 1. Close open save dropdown if active
		if (window.MdvComments && typeof window.MdvComments.closeSaveDropdown === "function") {
			window.MdvComments.closeSaveDropdown();
		}

		// Dismiss comment panel, bubble, tooltip, and toast before printing
		const commentPanel = document.getElementById("comment-panel");
		if (commentPanel) commentPanel.classList.remove("visible");

		const commentToast = document.getElementById("comment-toast");
		if (commentToast) commentToast.classList.remove("visible");

		const commentBubble = document.getElementById("comment-bubble");
		if (commentBubble) commentBubble.style.display = "none";

		const commentTooltip = document.getElementById("comment-tooltip");
		if (commentTooltip) commentTooltip.style.display = "none";

		const contentArea = document.getElementById("content");
		if (!contentArea) return;

		// 2. If in Edit mode or content area is empty, build & enhance preview
		if (window.editor) {
			if (typeof window.updatePreview === "function") {
				window.updatePreview();
			}
			if (typeof window.enhanceContent === "function") {
				window.enhanceContent();
			}
		}

		// 3. Unfold any folded heading sections so complete document prints
		foldedHeadingsBeforePrint = [];
		const foldedHeadings = contentArea.querySelectorAll(".heading-folded");
		foldedHeadings.forEach(function (h) {
			foldedHeadingsBeforePrint.push(h);
			if (typeof window.setHeadingFolded === "function") {
				window.setHeadingFolded(h, false);
			} else {
				h.classList.remove("heading-folded");
				const level = parseInt(h.tagName.substring(1), 10);
				let el = h.nextElementSibling;
				while (el) {
					if (/^H[1-6]$/.test(el.tagName) && parseInt(el.tagName.substring(1), 10) <= level) break;
					el.style.display = "";
					el = el.nextElementSibling;
				}
			}
		});

		// 4. Wait for any pending image loads (up to 1.5s timeout)
		const pendingImgs = Array.from(contentArea.querySelectorAll("img")).filter(function (img) {
			return !img.complete;
		});

		if (pendingImgs.length > 0) {
			await Promise.race([
				Promise.all(pendingImgs.map(function (img) {
					return new Promise(function (resolve) {
						img.addEventListener("load", resolve, { once: true });
						img.addEventListener("error", resolve, { once: true });
					});
				})),
				new Promise(function (resolve) { setTimeout(resolve, 1500); })
			]);
		}

		// 5. Downscale images to match displayed dimensions so output PDF file size stays native & compact
		const imgsToOptimize = Array.from(contentArea.querySelectorAll("img"));
		if (imgsToOptimize.length > 0) {
			await Promise.all(imgsToOptimize.map(downscaleImageForPrint));
		}

		// 6. Trigger browser native print dialog
		document.body.classList.add("mdv-printing");
		window.print();
	}

	/* ── Downscale image to displayed size for print ───────────────────── */
	async function downscaleImageForPrint(img) {
		if (!img.naturalWidth || !img.naturalHeight) return;

		// Calculate target dimensions based on displayed size on page
		const rect = img.getBoundingClientRect();
		const displayW = Math.round(rect.width) || img.clientWidth || 400;
		const displayH = Math.round(rect.height) || img.clientHeight || 300;

		// Use 2x displayed size for crisp 300 DPI print quality, capped by natural size
		const targetW = Math.min(img.naturalWidth, Math.max(displayW * 2, 600));
		const scale = targetW / img.naturalWidth;
		const targetH = Math.round(img.naturalHeight * scale);

		// Only downscale if the original image is noticeably larger than needed (> 1.25x)
		if (img.naturalWidth <= targetW * 1.25 && img.naturalHeight <= targetH * 1.25) {
			return;
		}

		function renderToCanvas(sourceImg) {
			const canvas = document.createElement("canvas");
			canvas.width = targetW;
			canvas.height = targetH;
			const ctx = canvas.getContext("2d");
			ctx.imageSmoothingEnabled = true;
			ctx.imageSmoothingQuality = "high";
			// Solid white background for paper
			ctx.fillStyle = "#ffffff";
			ctx.fillRect(0, 0, targetW, targetH);
			ctx.drawImage(sourceImg, 0, 0, targetW, targetH);
			return canvas.toDataURL("image/jpeg", 0.85);
		}

		try {
			// Attempt direct canvas draw
			const dataUrl = renderToCanvas(img);
			img.setAttribute("data-mdv-orig-src", img.src);
			img.src = dataUrl;
		} catch (err) {
			// If tainted canvas error (cross-origin without CORS attribute), try loading with crossOrigin
			try {
				const corsImg = new Image();
				corsImg.crossOrigin = "anonymous";
				await new Promise(function (resolve, reject) {
					corsImg.onload = resolve;
					corsImg.onerror = reject;
					corsImg.src = img.src;
				});
				const dataUrl = renderToCanvas(corsImg);
				img.setAttribute("data-mdv-orig-src", img.src);
				img.src = dataUrl;
			} catch (corsErr) {
				// Remote server does not allow CORS access — keep original image
			}
		}
	}

	/* ── Cleanup after print dialog dismisses ─────────────────────────── */
	function cleanupAfterPrint() {
		document.body.classList.remove("mdv-printing");

		// Restore any downscaled images back to original src
		const modifiedImgs = document.querySelectorAll("img[data-mdv-orig-src]");
		modifiedImgs.forEach(function (img) {
			const orig = img.getAttribute("data-mdv-orig-src");
			if (orig) {
				img.src = orig;
				img.removeAttribute("data-mdv-orig-src");
			}
		});

		// Restore folded headings
		if (foldedHeadingsBeforePrint.length > 0) {
			foldedHeadingsBeforePrint.forEach(function (h) {
				if (typeof window.setHeadingFolded === "function") {
					window.setHeadingFolded(h, true);
				} else {
					h.classList.add("heading-folded");
					const level = parseInt(h.tagName.substring(1), 10);
					let el = h.nextElementSibling;
					while (el) {
						if (/^H[1-6]$/.test(el.tagName) && parseInt(el.tagName.substring(1), 10) <= level) break;
						el.style.display = "none";
						el = el.nextElementSibling;
					}
				}
			});
			foldedHeadingsBeforePrint = [];
		}
	}

	window.addEventListener("afterprint", cleanupAfterPrint);

	/* ── Keyboard Shortcut: Ctrl+P / Cmd+P ────────────────────────────── */
	window.addEventListener("keydown", function (e) {
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p" && !e.shiftKey && !e.altKey) {
			e.preventDefault();
			printDocument();
		}
	});

	// Inject styles immediately
	injectStyles();

	// Expose public API
	window.MdvPrint = {
		enhanceImage: enhanceImage,
		printDocument: printDocument,
		imageSizeMap: imageSizeMap
	};

	window.mdvPrint = printDocument;
})();
