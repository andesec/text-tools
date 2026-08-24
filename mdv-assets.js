/* ============================================
   MDV Asset Export
   Depends on globals from mdv.html:
     window.editor, window.currentFileName
   Depends on vendor/jszip.min.js (JSZip) and
   mdv-comments.js (window.MdvComments.toast)
   ============================================ */

(function () {
	"use strict";

	// Allow this file to be require()'d under Node for unit-testing the pure
	// text-processing helpers (_scanMarkdownAssets/_rewriteMarkdown) without a DOM.
	const root = typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : {});

	// ── Regexes ─────────────────────────────────────
	// Markdown image: ![alt](url "optional title"). The URL alternation allows one
	// level of balanced parens so Wikimedia-style paths like img_(1).png survive.
	// Angle-bracket URLs and reference-style images are out of scope and skipped.
	const IMAGE_RE = /!\[((?:[^\[\]\\]|\\.)*)\]\(\s*((?:[^\s()\\]|\\.|\([^\s()]*\))+)(\s+"[^"]*")?\s*\)/g;
	// Plain link: [text](url "optional title") — used only to catch data: links
	const LINK_RE = /(?<!!)\[((?:[^\[\]\\]|\\.)*)\]\(\s*((?:[^\s()\\]|\\.|\([^\s()]*\))+)(\s+"[^"]*")?\s*\)/g;
	const REMOTE_URL_RE = /^https?:\/\//i;
	const DATA_URI_RE = /^data:([a-zA-Z0-9.+\/-]+);base64,([A-Za-z0-9+\/=]+)$/;

	const MIME_EXT_MAP = {
		"image/png": "png",
		"image/jpeg": "jpg",
		"image/gif": "gif",
		"image/webp": "webp",
		"image/svg+xml": "svg",
		"application/pdf": "pdf",
		"text/plain": "txt",
		"application/json": "json",
		"application/zip": "zip",
	};

	function extFromMime(mime) {
		if (!mime) return "bin";
		const clean = mime.split(";")[0].trim().toLowerCase();
		return MIME_EXT_MAP[clean] || "bin";
	}

	function sanitizeName(name) {
		return name.replace(/[^A-Za-z0-9._-]/g, "-");
	}

	// ── Scan markdown text for assets ──────────────────
	// Returns { assets: Map<key, {kind, url|dataUri, mime}>, matches: [{index, length, fullMatch, prefix, urlText, suffix, key}] }
	function _scanMarkdownAssets(text) {
		const assets = new Map(); // key (url or dataUri) -> { kind: 'remote'|'data', url, mime }
		const matches = [];

		function consider(re, isImage) {
			re.lastIndex = 0;
			let m;
			while ((m = re.exec(text)) !== null) {
				const alt = m[1];
				const urlToken = m[2];
				const titlePart = m[3] || "";
				let kind = null;
				let mime = null;
				let key = null;

				if (REMOTE_URL_RE.test(urlToken)) {
					if (!isImage) continue; // plain hyperlinks to http(s) are never touched
					kind = "remote";
					key = urlToken;
				} else {
					const dataMatch = DATA_URI_RE.exec(urlToken);
					if (dataMatch) {
						kind = "data";
						mime = dataMatch[1];
						key = urlToken;
					} else {
						continue; // not an asset we handle
					}
				}

				if (!assets.has(key)) {
					assets.set(key, kind === "remote" ? { kind, url: urlToken } : { kind, url: urlToken, mime });
				}

				matches.push({
					index: m.index,
					length: m[0].length,
					fullMatch: m[0],
					isImage,
					alt,
					urlToken,
					titlePart,
					key,
				});
			}
		}

		consider(IMAGE_RE, true);
		consider(LINK_RE, false);

		// Sort matches by position so rewriting via split-reassembly works left-to-right
		matches.sort((a, b) => a.index - b.index);

		return { assets, matches };
	}

	// Build the rewritten markdown text given the original text, the ordered
	// matches (with assigned `key`), and a Map<key, assetName>.
	function _rewriteMarkdown(text, matches, keyToName) {
		let out = "";
		let cursor = 0;
		for (const m of matches) {
			out += text.slice(cursor, m.index);
			const name = keyToName.get(m.key);
			const prefix = m.isImage ? "![" : "[";
			out += prefix + m.alt + "](assets/" + name + m.titlePart + ")";
			cursor = m.index + m.length;
		}
		out += text.slice(cursor);
		return out;
	}

	// ── Download helper (blob-based, distinct from mdv-comments' text downloadFile) ──
	function downloadBlob(blob, name) {
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = name;
		a.click();
		URL.revokeObjectURL(url);
	}

	function notify(msg) {
		if (window.MdvComments && typeof window.MdvComments.toast === "function") {
			window.MdvComments.toast(msg);
		} else {
			alert(msg);
		}
	}

	// ── Main entry point ────────────────────────────────
	root.exportWithAssets = async function (btnEl) {
		if (!window.editor || !window.currentFileName) return;

		if (typeof JSZip === "undefined") {
			notify("Cannot export: JSZip library failed to load.");
			return;
		}

		if (btnEl) btnEl.disabled = true;
		try {
			const mdText = window.editor.state.doc.toString();
			const { assets, matches } = _scanMarkdownAssets(mdText);

			if (assets.size === 0) {
				notify("No embedded assets or remote images found.");
				return;
			}

			// Materialize assets: fetch remote, decode data URIs
			const keys = Array.from(assets.keys());
			const remoteKeys = keys.filter((k) => assets.get(k).kind === "remote");
			const dataKeys = keys.filter((k) => assets.get(k).kind === "data");

			const fetchResults = await Promise.allSettled(
				remoteKeys.map((key) => fetch(assets.get(key).url))
			);

			const failedUrls = [];
			const remoteBlobs = new Map(); // key -> { blob, contentType }

			for (let i = 0; i < remoteKeys.length; i++) {
				const key = remoteKeys[i];
				const result = fetchResults[i];
				if (result.status !== "fulfilled" || !result.value.ok) {
					failedUrls.push(key);
					continue;
				}
				try {
					const res = result.value;
					const blob = await res.blob();
					remoteBlobs.set(key, { blob, contentType: res.headers.get("content-type") || "" });
				} catch (e) {
					failedUrls.push(key);
				}
			}

			if (failedUrls.length > 0) {
				notify("Export aborted — failed to fetch:\n" + failedUrls.join("\n"));
				return;
			}

			const dataBytes = new Map(); // key -> { bytes: Uint8Array, mime }
			let malformedKeys = [];
			for (const key of dataKeys) {
				const asset = assets.get(key);
				const commaIdx = asset.url.indexOf(",");
				const b64 = asset.url.slice(commaIdx + 1);
				try {
					const binary = atob(b64);
					const bytes = new Uint8Array(binary.length);
					for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
					dataBytes.set(key, { bytes, mime: asset.mime });
				} catch (e) {
					malformedKeys.push(key);
				}
			}

			if (malformedKeys.length > 0) {
				notify("Export aborted — malformed base64 data URI(s) found (" + malformedKeys.length + ").");
				return;
			}

			// Assign names
			const keyToName = new Map();
			const usedNames = new Set();
			let counter = 0;

			function uniqueName(base) {
				let name = base;
				let n = 2;
				while (usedNames.has(name)) {
					const dot = base.lastIndexOf(".");
					if (dot > 0) {
						name = base.slice(0, dot) + "-" + n + base.slice(dot);
					} else {
						name = base + "-" + n;
					}
					n++;
				}
				usedNames.add(name);
				return name;
			}

			for (const key of remoteKeys) {
				counter++;
				const { blob, contentType } = remoteBlobs.get(key);
				let base = "";
				try {
					const u = new URL(assets.get(key).url);
					const basename = decodeURIComponent(u.pathname.split("/").pop() || "");
					base = sanitizeName(basename);
				} catch (e) {
					base = "";
				}
				if (!base || !/\.[A-Za-z0-9]+$/.test(base)) {
					base = "asset-" + counter + "." + extFromMime(contentType || blob.type);
				}
				keyToName.set(key, uniqueName(base));
			}

			for (const key of dataKeys) {
				counter++;
				const { mime } = dataBytes.get(key);
				const base = "asset-" + counter + "." + extFromMime(mime);
				keyToName.set(key, uniqueName(base));
			}

			// Rewrite markdown (copy — editor doc untouched)
			const rewritten = _rewriteMarkdown(mdText, matches, keyToName);

			// Build ZIP
			const zip = new JSZip();
			const baseName = (window.currentFileName || "Untitled").replace(/\.\w+$/, "");
			zip.file(baseName + ".md", rewritten);
			const assetsFolder = zip.folder("assets");
			for (const key of remoteKeys) {
				assetsFolder.file(keyToName.get(key), remoteBlobs.get(key).blob);
			}
			for (const key of dataKeys) {
				assetsFolder.file(keyToName.get(key), dataBytes.get(key).bytes);
			}

			const zipBlob = await zip.generateAsync({ type: "blob" });
			downloadBlob(zipBlob, baseName + "-export.zip");

			notify("Exported with " + assets.size + " asset" + (assets.size === 1 ? "" : "s"));
		} finally {
			if (btnEl) btnEl.disabled = false;
			if (window.MdvComments && typeof window.MdvComments.closeSaveDropdown === "function") {
				window.MdvComments.closeSaveDropdown();
			}
		}
	};

	// Exposed for testing (Node environment via module.exports; browser keeps it namespaced)
	if (typeof module !== "undefined" && module.exports) {
		module.exports = { _scanMarkdownAssets, _rewriteMarkdown };
	}
})();
