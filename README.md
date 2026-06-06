# Text Tools

A collection of lightweight, **fully client-side** tools to edit, view, and format your text and documents — Markdown, JSON, PDF, diffs, Base64, encryption payloads, and high-quality text-to-speech. No backend, no data leaves your browser.

**Live app:** [https://andesec.github.io/text-tools/index.html](https://andesec.github.io/text-tools/index.html)

---

## Tools

| Tool | Description |
| --- | --- |
| 🗂️ **Tabbed Workspace** | Unified interface that opens multiple tools in tabs, preserving context as you switch between them. |
| 📝 **Markdown Viewer** | Preview and render Markdown with live formatting. Write and visualize markdown content effortlessly. |
| 🔊 **Supertonic TTS** | Convert text to high-quality speech **entirely in the browser** using WebGPU, with a WASM fallback. |
| 📋 **JSON Viewer** | View, format, and explore JSON data with an interactive tree viewer. Supports multiple JSON instances. |
| 📄 **PDF Splitter** | Split PDF files into smaller documents based on custom page ranges. Private and fast, runs in the browser. |
| ⚡ **Diff Tool** | Compare two files or text snippets side-by-side with character-level highlighting, move detection, and a live symbol outline. |
| 🔐 **Base64 & URI** | Encode and decode Base64 strings and URIs, with support for special characters. |
| 🔑 **Encryption Utility** | Decrypt payloads with custom keys and IVs. One-click handoff to the JSON viewer for decrypted results. |

## Features

- **100% client-side** — every tool runs in the browser; nothing is uploaded.
- **Privacy-first** — your files, secrets, and text never leave your machine.
- **WebGPU + WASM TTS** — high-quality speech synthesis without any cloud API.
- **Tabbed Workspace** — keep state across tools without losing context.
- **No build step** — plain HTML/CSS/JS. Open `index.html` and you're done.
- **Responsive UI** — works on desktop and mobile, with light/dark theming.

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
├── tts.html           # Supertonic text-to-speech UI
├── tts-engine.js      # TTS engine (WebGPU + WASM)
├── pdf.html           # PDF splitter
├── diff.html          # Diff tool
├── diff2.html         # Alternative diff UI
├── utv.html           # Base64 / URI tool
├── edu.html           # Encryption utility
├── embed.html         # Embed helper
├── theme.css          # Shared theme tokens
├── mdv-comments.*     # Markdown comment styling
├── jsv.css            # JSON viewer styles
├── footer.js          # Shared footer injection
└── vendor/            # Third-party libraries (TTS models, parsers, etc.)
```

## Tech notes

- **TTS:** [Supertonic](https://supertonic.supertone.ai/) ONNX models in `vendor/`, accelerated with WebGPU when available and falling back to WASM (`onnxruntime-web`).
- **Markdown:** rendered client-side with a small custom renderer.
- **JSON:** parsed natively and rendered into an interactive tree.
- **PDF:** parsed and split in-browser using `pdf-lib`.
- **Diff:** character-level diffing with move detection.

## License

[MIT](./LICENSE) — © 2026 Nate.

## Credits

Made with care by [Andesec](https://github.com/andesec).
