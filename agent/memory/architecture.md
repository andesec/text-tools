# Dylen Text Tools — Architecture & Memory

## Overview
Dylen Text Tools is a zero-build, 100% client-side web application and embedding toolkit that runs entirely in the browser. It provides text, markdown, JSON, speech, PDF, diffing, encoding, and encryption utilities with native dark/light themes.

## Tool Registry & File Mapping

| Tool | HTML File | Purpose |
| :--- | :--- | :--- |
| **Tabbed Workspace** | `workspace.html` | Multi-tab shell hosting tools in iframes, managing state via `localStorage` (`dylen_workspace_tabs`) |
| **Tool Picker** | `tools.html` | Tab launcher menu displayed inside empty workspace tabs |
| **Markdown Viewer** | `mdv.html` | GitHub-flavored markdown editor, previewer, KaTeX, Mermaid, runnable code blocks, outline, export |
| **JSON Viewer** | `jsv.html` | Interactive multi-instance JSON tree explorer with repair, search, and Dylen Shorthand conversion |
| **Supersonic TTS** | `tts.html` | In-browser text-to-speech engine using WebGPU ONNX models with WASM fallback (`tts-engine.js`) |
| **PDF Splitter** | `pdf.html` | Client-side PDF page range splitting and extraction (`pdf-lib`) |
| **PDF → Markdown** | `pdf2md.html` | PDF text and table extraction to markdown with embedded image extraction and ZIP packaging (`pdf2md.js`) |
| **Diff Explorer** | `diff.html` | Character-level side-by-side diffing, move detection, and symbol outline |
| **Base64 & URI Utility** | `utv.html` | URL/Base64 encoder, decoder, escape/unescape, hex viewer |
| **Encryption Utility** | `edu.html` | AES/GCM decryption utility with one-click payload forwarding to `jsv.html` |
| **Embedding API** | `embed.html` | Documentation and interactive sandbox for iframe integration and two-way postMessage sync |

## Brand Assets
- Favicon & Icon: `favicon.ico`, `favicon.png`, `apple-touch-icon.png`.

## Dylen Shorthand & Widget System
- File: `dylen-shorthand.js`
- Converts between full Dylen lesson objects and shorthand syntax.
- Strictly adheres to the **Passive** (18) and **Interactive** (26) widget catalog from `dylen/src/lib/utils/widgetCatalog.js`.
- Section model only contains subsections; `illustration` and `markdown` are regular subsection-level widgets.

## Communication Protocols
- Two-way postMessage API used when embedded inside Dylen (e.g. agent playground, source capture, lesson reviewer).
- Supports streaming chunks (`load_streaming_chunk`), asset exports, ready signals, and full sync (`MDV_TWO_WAY_SYNC_SPEC.md`).
