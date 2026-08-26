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

	// ── Heading path for a character offset ─────────────
	// Scans backwards over ATX heading lines (# .. ######) already present in the
	// text, building the active heading stack outermost-to-innermost. Setext
	// headings and headings inside fenced code blocks are out of scope, matching
	// the scanner's existing simplifications.
	const ATX_RE = /^(#{1,6})\s+(.*)$/;

	function _headingPathAt(text, offset) {
		const before = text.slice(0, offset);
		const lines = before.split("\n");
		// stack[level-1] holds the most recent heading text seen at that level
		const stack = [];
		for (const line of lines) {
			const m = ATX_RE.exec(line);
			if (!m) continue;
			const level = m[1].length;
			const title = m[2].replace(/\s+#+\s*$/, "").trim();
			stack.length = level - 1;
			stack[level - 1] = title;
		}
		return stack.filter((t) => typeof t === "string");
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

	// ── Bundle builder ──────────────────────────────────
	// Scans, materializes (fetch remote / decode data URIs), names, and rewrites.
	// Returns { markdown, assets: [{ name, mime, bytes: ArrayBuffer, alt,
	// charOffset, headingPath }] } — everything up to (but not including) the
	// zip. Throws on any failed fetch or malformed base64: the export is
	// all-or-nothing, matching the original behavior.
	//
	// Bytes are ArrayBuffer for every asset, remote and data-URI alike. That is
	// the structured-cloneable type the postMessage host needs, and JSZip accepts
	// it as a first-class input, so the zip written by exportWithAssets is
	// unchanged. `mime` carries the HTTP content-type (or the data-URI's own
	// media type) so the extension fallback below no longer needs blob.type.
	function isAllowedRemoteAssetUrl(urlStr) {
		try {
			const parsed = new URL(urlStr, window.location.href);
			if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
				return false;
			}
			const hostname = parsed.hostname.toLowerCase();
			if (
				hostname === 'localhost' ||
				hostname === '127.0.0.1' ||
				hostname === '0.0.0.0' ||
				hostname === '::1' ||
				hostname.endsWith('.localhost') ||
				hostname.endsWith('.local') ||
				/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
				/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
				/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
				/^169\.254\.\d{1,3}\.\d{1,3}$/.test(hostname)
			) {
				if (parsed.origin === window.location.origin) {
					return true;
				}
				return false;
			}
			return true;
		} catch (e) {
			return false;
		}
	}

	async function _buildAssetBundle(mdText, fileName) {
		const { assets, matches } = _scanMarkdownAssets(mdText);

		if (assets.size === 0) {
			const err = new Error("No embedded assets or remote images found.");
			err.code = "no_assets";
			throw err;
		}

		const keys = Array.from(assets.keys());
		const remoteKeys = keys.filter((k) => assets.get(k).kind === "remote");
		const dataKeys = keys.filter((k) => assets.get(k).kind === "data");

		const failedUrls = [];
		const allowedRemoteKeys = [];
		for (const key of remoteKeys) {
			const asset = assets.get(key);
			if (isAllowedRemoteAssetUrl(asset.url)) {
				allowedRemoteKeys.push(key);
			} else {
				console.warn('[mdv-assets] Blocked fetching from restricted or local address:', asset.url);
				failedUrls.push(key);
			}
		}

		// Materialize remote assets
		const fetchResults = await Promise.allSettled(
			allowedRemoteKeys.map((key) => fetch(assets.get(key).url))
		);

		const remoteBytes = new Map(); // key -> { bytes: ArrayBuffer, mime }

		for (let i = 0; i < allowedRemoteKeys.length; i++) {
			const key = allowedRemoteKeys[i];
			const result = fetchResults[i];
			if (result.status !== "fulfilled" || !result.value.ok) {
				failedUrls.push(key);
				continue;
			}
			try {
				const res = result.value;
				const bytes = await res.arrayBuffer();
				remoteBytes.set(key, { bytes, mime: res.headers.get("content-type") || "" });
			} catch (e) {
				failedUrls.push(key);
			}
		}

		if (failedUrls.length > 0) {
			const err = new Error("Export aborted — failed to fetch:\n" + failedUrls.join("\n"));
			err.code = "fetch_failed";
			err.urls = failedUrls;
			throw err;
		}

		// Materialize data URIs
		const dataBytes = new Map(); // key -> { bytes: ArrayBuffer, mime }
		const malformedKeys = [];
		for (const key of dataKeys) {
			const asset = assets.get(key);
			const commaIdx = asset.url.indexOf(",");
			const b64 = asset.url.slice(commaIdx + 1);
			try {
				const binary = atob(b64);
				const u8 = new Uint8Array(binary.length);
				for (let i = 0; i < binary.length; i++) u8[i] = binary.charCodeAt(i);
				dataBytes.set(key, { bytes: u8.buffer, mime: asset.mime });
			} catch (e) {
				malformedKeys.push(key);
			}
		}

		if (malformedKeys.length > 0) {
			const err = new Error("Export aborted — malformed base64 data URI(s) found (" + malformedKeys.length + ").");
			err.code = "malformed_base64";
			throw err;
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
			const { mime } = remoteBytes.get(key);
			let base = "";
			try {
				const u = new URL(assets.get(key).url);
				const basename = decodeURIComponent(u.pathname.split("/").pop() || "");
				base = sanitizeName(basename);
			} catch (e) {
				base = "";
			}
			if (!base || !/\.[A-Za-z0-9]+$/.test(base)) {
				base = "asset-" + counter + "." + extFromMime(mime);
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
		const markdown = _rewriteMarkdown(mdText, matches, keyToName);

		// Emit one entry per unique asset, in the order names were assigned
		// (remote first, then data URIs), carrying the location metadata of the
		// FIRST occurrence of that asset in the document.
		const firstMatch = new Map(); // key -> match (matches are position-sorted)
		for (const m of matches) {
			if (!firstMatch.has(m.key)) firstMatch.set(m.key, m);
		}

		const out = [];
		for (const key of remoteKeys.concat(dataKeys)) {
			const src = remoteBytes.get(key) || dataBytes.get(key);
			const m = firstMatch.get(key);
			out.push({
				name: keyToName.get(key),
				mime: src.mime,
				bytes: src.bytes,
				alt: m ? m.alt : "",
				charOffset: m ? m.index : -1,
				headingPath: m ? _headingPathAt(mdText, m.index) : [],
			});
		}

		return { markdown, assets: out, fileName: fileName };
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
			const baseName = (window.currentFileName || "Untitled").replace(/\.\w+$/, "");

			let bundle;
			try {
				bundle = await _buildAssetBundle(mdText, baseName);
			} catch (e) {
				notify(e.message);
				return;
			}

			// Build ZIP
			const zip = new JSZip();
			zip.file(baseName + ".md", bundle.markdown);
			const assetsFolder = zip.folder("assets");
			for (const asset of bundle.assets) {
				assetsFolder.file(asset.name, asset.bytes);
			}

			const zipBlob = await zip.generateAsync({ type: "blob" });
			downloadBlob(zipBlob, baseName + "-export.zip");

			const n = bundle.assets.length;
			notify("Exported with " + n + " asset" + (n === 1 ? "" : "s"));
		} finally {
			if (btnEl) btnEl.disabled = false;
			if (window.MdvComments && typeof window.MdvComments.closeSaveDropdown === "function") {
				window.MdvComments.closeSaveDropdown();
			}
		}
	};

	// Expose the bundle builder for the postMessage host API in mdv.html
	root.MdvAssets = { buildAssetBundle: _buildAssetBundle };

	// Exposed for testing (Node environment via module.exports; browser keeps it namespaced)
	if (typeof module !== "undefined" && module.exports) {
		module.exports = { _scanMarkdownAssets, _rewriteMarkdown, _headingPathAt, _buildAssetBundle };
	}
})();
