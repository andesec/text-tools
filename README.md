# Dylen Text Tools

A collection of lightweight, **fully client-side** tools to edit, view, and format your text and documents — Markdown, JSON, PDF, diffs, Base64, encryption payloads, and high-quality text-to-speech. Zero build steps, private, fast, runs 100% in your browser.

**Live app:** [https://andesec.github.io/text-tools/index.html](https://andesec.github.io/text-tools/index.html)

---

## Tools

| Tool | Description |
| --- | --- |
| 🗂️ **Tabbed Workspace** | Unified interface that opens multiple tools in tabs, preserving context as you switch between them. |
| 📝 **Markdown Viewer** | Preview and render Markdown with live formatting, math (KaTeX), diagrams (Mermaid), and code execution. |
| 🔊 **Supersonic TTS** | Convert text to high-quality speech **entirely in the browser** using WebGPU, with a WASM fallback. |
| 📋 **JSON Viewer** | View, format, repair, and explore JSON data with an interactive tree viewer and Dylen Shorthand conversion. |
| 📄 **PDF Splitter** | Split PDF files into smaller documents based on custom page ranges. Private and fast, runs in the browser. |
| 📑 **PDF → Markdown** | Convert PDFs to clean Markdown with extracted images. Auto-detects headers, footers, tables, and lists. |
| ⚡ **Diff Explorer** | Compare two files or text snippets side-by-side with character-level highlighting, move detection, and a live symbol outline. |
| 🔐 **Base64 & URI** | Encode and decode Base64 strings and URIs, with support for special characters. |
| 🔑 **Encryption Utility** | Decrypt payloads with custom keys and IVs. One-click handoff to the JSON viewer for decrypted results. |
| 🔌 **Embedding API** | Embed tools into host web applications via iframe with two-way `postMessage` synchronization and streaming. |

## Features

- **100% client-side** — every tool runs in the browser; nothing is uploaded.
- **Privacy-first** — your files, secrets, and text never leave your machine.
- **WebGPU + WASM TTS** — high-quality speech synthesis without any cloud API.
- **Tabbed Workspace** — keep state across tools without losing context.
- **No build step** — plain HTML/CSS/JS. Open `index.html` and you're done.
- **Responsive UI** — works on desktop and mobile, with light/dark theming and Dylen design tokens.

## Getting started

### Use it online

Just open the live app:

> [https://andesec.github.io/text-tools/index.html](https://andesec.github.io/text-tools/index.html)

Enable GitHub Pages for this repo (Settings → Pages → `Deploy from a branch` → `main` / root) to publish it under your own fork.

### Run it locally

This project has no dependencies and no build step. Just clone and serve the directory:

```bash
git clone https://github.com/andesec/text-tools.git
cd text-tools

# any static server works; a few options:
python3 server.py 8000
# or
python3 -m http.server 8000
# or
npx serve .
```

Then open <http://localhost:8000/index.html> in your browser.

> Some browser APIs (e.g. WebGPU, module workers, ES module imports) require a real HTTP server rather than a `file://` URL.

## Project layout

```
text-tools/
├── index.html         # Landing page with all tool cards
├── workspace.html     # Tabbed workspace shell (loads tools in iframes)
├── tools.html         # In-frame tool picker for the workspace
├── mdv.html           # Markdown viewer
├── jsv.html           # JSON viewer
├── tts.html           # Supersonic text-to-speech UI
├── tts-engine.js      # TTS engine (WebGPU + WASM)
├── pdf.html           # PDF splitter
├── pdf2md.html        # PDF → Markdown converter
├── pdf2md.css         # PDF → Markdown styles
├── pdf2md.js          # PDF → Markdown conversion engine
├── diff.html          # Diff tool
├── utv.html           # Base64 / URI tool
├── edu.html           # Encryption utility
├── embed.html         # Embedding API & docs
├── theme.css          # Shared Dylen design tokens & theme
├── mdv-comments.*     # Markdown comment styling
├── jsv.css            # JSON viewer styles
├── dylen-shorthand.js # Dylen lesson/widget shorthand converter
├── footer.js          # Shared footer injection
├── favicon.png        # Dylen brand icon
└── vendor/            # Third-party libraries (TTS models, parsers, etc.)
```

## Tech notes

- **TTS:** [Supertonic](https://supertonic.supertone.ai/) ONNX models in `vendor/`, accelerated with WebGPU when available and falling back to WASM (`onnxruntime-web`).
- **Markdown:** rendered client-side with marked, KaTeX, Prism, and Mermaid.
- **JSON:** parsed natively and rendered into an interactive tree with auto-repair and Dylen shorthand formatting.
- **PDF:** parsed and split in-browser using `pdf-lib`.
- **PDF → Markdown:** text extraction and image capture via `pdf.js`, ZIP bundling via `JSZip`.
- **Diff:** character-level diffing with move detection.

## License

[MIT](./LICENSE) — © 2026 Dylen.

## Credits

Made with care for [Dylen](https://github.com/andesec).
