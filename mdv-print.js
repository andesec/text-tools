/* ==========================================================================
   MDV Print, Captions, Image Resize & Optimizer Module
   Modular extension for mdv.html

   Features:
   1. Print / Save to PDF using browser native print system (keeps text native)
   2. Visible image captions (from alt-text or title) rendered below images
   3. 4-step image resizing (small 20%, medium 45% [default], large 75%, full 100%)
   4. Option to resize ALL images at once from the Pictures sidebar panel
   5. Dylen image optimizer: downsamples images to displayed dimensions & converts
      format (JPEG 0.80 for opaque, PNG for alpha) to drastically reduce PDF file size
   6. Portrait aspect ratio detection with viewport-based height limits
   7. In-memory size persistence across preview re-renders
   8. Clean @media print formatting hiding UI chrome & removing all borders
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

	// Store active blob URLs generated during print optimization so they can be revoked
	const activeBlobUrls = [];

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

			/* ── Sidebar Pictures Panel Resize Toolbar ── */
			.sidebar-images-toolbar {
				display: flex;
				align-items: center;
				justify-content: space-between;
				padding: 8px 12px;
				border-bottom: 1px solid var(--border-default);
				background-color: var(--bg-surface);
				gap: 6px;
				flex-shrink: 0;
			}

			.sidebar-images-toolbar-label {
				font-size: 11px;
				font-weight: 600;
				color: var(--text-secondary);
				text-transform: uppercase;
				letter-spacing: 0.04em;
				white-space: nowrap;
			}

			.sidebar-images-size-group {
				display: flex;
				align-items: center;
				gap: 4px;
			}

			.sidebar-images-size-btn {
				padding: 2px 7px;
				font-size: 11px;
				font-weight: 500;
				font-family: var(--font-mono, monospace);
				border-radius: var(--radius-sm, 4px);
				border: 1px solid var(--border-default);
				background-color: var(--bg-surface-raised);
				color: var(--text-secondary);
				cursor: pointer;
				transition: background-color 0.15s, color 0.15s, border-color 0.15s;
			}

			.sidebar-images-size-btn:hover {
				background-color: var(--bg-surface-hover);
				color: var(--text-primary);
				border-color: var(--border-strong);
			}

			.sidebar-images-size-btn.active {
				background-color: var(--accent);
				color: rgb(255, 255, 255);
				border-color: var(--accent);
				font-weight: 600;
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
		if (resizeBtn) {
			resizeBtn.title = tooltip;
			resizeBtn.setAttribute("aria-label", tooltip);
		}
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

	/* ── Resize All Images in Document ─────────────────────────────────── */
	function resizeAllImages(size) {
		const validSizes = ["small", "medium", "large", "full"];
		if (!validSizes.includes(size)) size = "medium";

		const contentArea = document.getElementById("content");
		if (!contentArea) return;

		const imgs = contentArea.querySelectorAll(".mdv-image-container img");
		imgs.forEach(function (img, idx) {
			const src = img.getAttribute("src") || "";
			const origSrc = img.getAttribute("data-mdv-orig-src") || src;
			const key = origSrc || ("img-" + idx);
			imageSizeMap.set(key, size);
			if (src) imageSizeMap.set(src, size);
		});

		const containers = contentArea.querySelectorAll(".mdv-image-container");
		containers.forEach(function (container) {
			const resizeBtn = container.querySelector(".mdv-image-resize-btn");
			if (resizeBtn) {
				applySize(container, resizeBtn, size);
			} else {
				container.setAttribute("data-mdv-size", size);
			}
		});

		// Update active button state in sidebar pictures panel
		document.querySelectorAll(".sidebar-images-size-btn").forEach(function (btn) {
			if (btn.getAttribute("data-size") === size) {
				btn.classList.add("active");
			} else {
				btn.classList.remove("active");
			}
		});

		if (window.MdvComments && typeof window.MdvComments.toast === "function") {
			window.MdvComments.toast("All images resized to " + SIZE_LABELS[size]);
		}
	}

	/* ── Dylen Image Optimizer Algorithm ─────────────────────────────── */
	// Reused from dylen/src/lib/utils/imageOptimizer.js:
	// 1. Detect meaningful alpha (transparency)
	// 2. Compute dimension scaling based on display width
	// 3. Convert format: JPEG 0.82 for opaque images (massive reduction), PNG for alpha
	// 4. Decode via Canvas surface and wait for img.decode()

	async function detectMeaningfulAlpha(source, width, height) {
		const sampleSize = Math.min(64, Math.max(width, height));
		const canvas = document.createElement("canvas");
		canvas.width = sampleSize;
		canvas.height = sampleSize;
		const ctx = canvas.getContext("2d");
		if (!ctx) return false;
		try {
			ctx.clearRect(0, 0, sampleSize, sampleSize);
			ctx.drawImage(source, 0, 0, sampleSize, sampleSize);
			const data = ctx.getImageData(0, 0, sampleSize, sampleSize).data;
			for (let i = 3; i < data.length; i += 4) {
				if (data[i] < 250) return true; // Real transparency detected
			}
			return false;
		} catch (e) {
			return false;
		} finally {
			canvas.width = 0;
			canvas.height = 0;
		}
	}

	function createCanvasSurface(width, height) {
		if (typeof OffscreenCanvas !== "undefined") {
			try {
				const canvas = new OffscreenCanvas(width, height);
				const ctx = canvas.getContext("2d", { alpha: true });
				if (ctx) {
					return {
						ctx: ctx,
						exportBlob: function (type, quality) {
							return canvas.convertToBlob({ type: type, quality: quality });
						},
						destroy: function () {}
					};
				}
			} catch (e) {}
		}

		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext("2d", { alpha: true });
		return {
			ctx: ctx,
			exportBlob: function (type, quality) {
				return new Promise(function (resolve, reject) {
					canvas.toBlob(function (blob) {
						if (blob) resolve(blob);
						else reject(new Error("Canvas export failed"));
					}, type, quality);
				});
			},
			destroy: function () {
				canvas.width = 0;
				canvas.height = 0;
			}
		};
	}

	async function decodeSourceImage(src) {
		if (typeof createImageBitmap === "function") {
			try {
				const response = await fetch(src, { mode: "cors" });
				if (response.ok) {
					const blob = await response.blob();
					const bitmap = await createImageBitmap(blob);
					return {
						width: bitmap.width,
						height: bitmap.height,
						draw: function (ctx, w, h) { ctx.drawImage(bitmap, 0, 0, w, h); },
						close: function () { bitmap.close && bitmap.close(); }
					};
				}
			} catch (e) {}
		}

		const image = new Image();
		if (!src.startsWith("data:")) {
			image.crossOrigin = "anonymous";
		}
		await new Promise(function (resolve, reject) {
			image.onload = resolve;
			image.onerror = reject;
			image.src = src;
		});
		if (typeof image.decode === "function") {
			await image.decode().catch(function () {});
		}
		return {
			width: image.naturalWidth || image.width,
			height: image.naturalHeight || image.height,
			draw: function (ctx, w, h) { ctx.drawImage(image, 0, 0, w, h); },
			close: function () {}
		};
	}

	async function optimizeImageElement(img) {
		const src = img.getAttribute("data-mdv-orig-src") || img.getAttribute("src") || "";
		if (!src) return;

		// Calculate target dimensions from displayed size
		const rect = img.getBoundingClientRect();
		const container = img.closest(".mdv-image-container");
		const containerRect = container ? container.getBoundingClientRect() : null;

		const displayW = Math.round(rect.width) || (containerRect ? Math.round(containerRect.width) : 0) || 400;
		const displayH = Math.round(rect.height) || (containerRect ? Math.round(containerRect.height) : 0) || 300;

		try {
			const decoded = await decodeSourceImage(src);
			try {
				const naturalW = decoded.width;
				const naturalH = decoded.height;
				if (!naturalW || !naturalH) return;

				// Scale to displayed dimensions (1.5x - 2x for print DPI, capped at 1200px max)
				const maxDesiredW = Math.min(naturalW, Math.max(Math.round(displayW * 1.75), 500));
				const scale = maxDesiredW / naturalW;
				const targetW = Math.round(naturalW * scale);
				const targetH = Math.round(naturalH * scale);

				// Detect transparency using the Dylen approach
				const hasAlpha = await detectMeaningfulAlpha(decoded, targetW, targetH);

				const outputType = hasAlpha ? "image/png" : "image/jpeg";
				const quality = hasAlpha ? undefined : 0.82;

				const surface = createCanvasSurface(targetW, targetH);
				try {
					surface.ctx.imageSmoothingEnabled = true;
					surface.ctx.imageSmoothingQuality = "high";

					if (!hasAlpha) {
						surface.ctx.fillStyle = "#ffffff";
						surface.ctx.fillRect(0, 0, targetW, targetH);
					}

					decoded.draw(surface.ctx, targetW, targetH);
					const blob = await surface.exportBlob(outputType, quality);

					if (blob && blob.size > 0) {
						const blobUrl = URL.createObjectURL(blob);
						activeBlobUrls.push(blobUrl);

						if (!img.getAttribute("data-mdv-orig-src")) {
							img.setAttribute("data-mdv-orig-src", src);
						}

						await new Promise(function (resolve) {
							img.onload = resolve;
							img.onerror = resolve;
							img.src = blobUrl;
						});
						if (typeof img.decode === "function") {
							await img.decode().catch(function () {});
						}
					}
				} finally {
					surface.destroy && surface.destroy();
				}
			} finally {
				decoded.close && decoded.close();
			}
		} catch (err) {
			// Cross-origin restriction: leave as original
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

		// 4. Wait for any pending initial image loads (up to 1.5s timeout)
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

		// 5. Optimize image sizes using the Dylen optimizer approach to shrink PDF size
		const imgsToOptimize = Array.from(contentArea.querySelectorAll("img"));
		if (imgsToOptimize.length > 0) {
			await Promise.all(imgsToOptimize.map(optimizeImageElement));
		}

		// 6. Trigger browser native print dialog
		document.body.classList.add("mdv-printing");
		window.print();
	}

	/* ── Cleanup after print dialog dismisses ─────────────────────────── */
	function cleanupAfterPrint() {
		document.body.classList.remove("mdv-printing");

		// Restore any optimized images back to original src
		const modifiedImgs = document.querySelectorAll("img[data-mdv-orig-src]");
		modifiedImgs.forEach(function (img) {
			const orig = img.getAttribute("data-mdv-orig-src");
			if (orig) {
				img.src = orig;
				img.removeAttribute("data-mdv-orig-src");
			}
		});

		// Revoke created blob URLs to free memory
		while (activeBlobUrls.length > 0) {
			const url = activeBlobUrls.pop();
			URL.revokeObjectURL(url);
		}

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
		resizeAllImages: resizeAllImages,
		imageSizeMap: imageSizeMap
	};

	window.mdvPrint = printDocument;
})();
