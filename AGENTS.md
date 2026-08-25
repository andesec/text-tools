# Dylen Text Tools — Agent Instructions & Guardrails

## Core Instructions

- **No Silent Fallbacks or Assumptions**: Never assume a fallback or default that wasn't discussed. Always check the repository for the source of truth.
- **Clarification**: If any requirement, instruction, or expected behavior is ambiguous or missing, pause and clarify before proceeding.
- **Graceful Error Handling**: Never expose raw system exception traces or technical error dumps to the user in the UI. Return user-friendly, empathetic error messages while logging full diagnostic details to `console.error` internally.
- **No Gaslighting**: Take full responsibility for issues and handle them with empathy and professionalism.
- **No Guesswork or Speculation**: Source of truth is the codebase and context.
- **Token & Research Efficiency**: Be direct and strategic in analysis. Break down large files and avoid redundant reads.
- **Testing**: Do not write, edit, or run automated or browser tests unless explicitly requested. The user verifies functionality manually.
- **No Unrequested Backwards Compatibility**: Do not add unnecessary deprecated fallback shims or legacy paths unless explicitly asked.
- **Do Not Write Normalization Layers**: Emit the correct value at the source instead. When two components disagree on a data shape or name, fix the producer so it emits what the consumer needs. Do not add converters, canonicalizers, alias maps, or `normalize*()` helpers between internal representations.

---

## Styling & Design System Rules

- **Source of Truth**: All colors and theme tokens are defined in [`theme.css`]
- **Strictly No Transparency / Opacity**: Do NOT use `opacity`, `transparency`, `rgba()`, `hsla()`, or `color-mix()` for structural layout. Use `rgb()` for solid colors and semantic CSS variables.
- **Permitted Exceptions**:
  - The `.glass` CSS class (and `var(--glass-bg)` / `var(--border-glass)`) for large panels.
  - `var(--modal-backdrop)` for standard modal overlays.
  - Opacity used strictly within CSS animations/transitions.
- **No Inline Styles**: Never use inline `style="..."` attributes on elements. Always use semantic CSS classes in `<style>` blocks or stylesheets.
- **Progress Bars**: Must use `--bg-progress-track` and `--bg-progress-fill`.

---

## Canonical Widget Classification (Source: Dylen Catalog)

Widgets supported in [`dylen-shorthand.js`] and viewers are partitioned into:

### Passive Widgets (18 types)
`markdown`, `graph`, `flipcards`, `illustration`, `equationviewer`, `stepflow`, `flowdiagram`, `caselet`, `dialogues`, `terminaldemo`, `codeviewer`, `conversation`, `listening`, `table`, `2dplotter`, `3dplotter`, `sectionvisual`, `instrumentdemo`

### Interactive Widgets (26 types)
`translations`, `fillblank`, `swipecards`, `truefalse`, `longanswer`, `shortanswer`, `audiorecording`, `mathsolver`, `roleplay`, `guidedscenario`, `interactiveterminal`, `liveterminal`, `codereview`, `codingchallenge`, `mcqs`, `fenster`, `fusion`, `connections`, `sequences`, `pictureprobe`, `taskcheck`, `livecall`, `checklist`, `offscreentask`, `flashcards`, `instrument`

- **Subsection Architecture**: `illustration` and `markdown` are regular subsection-level widgets in the `WidgetItem` union. The Section model only contains subsections.
- **Legacy Removed Widgets**: Do not introduce `paragraph`, `callouts`, `warn`, `warning`, `success`, `info`, `ol`, `ul`, `error`, `err`, `tip`, or `treeview`.

---

## Agent Workspace (`agent/`)

- Use the `agent/` folder in the project root to persistently store important findings, decisions, next steps, and analysis results (`agent/memory/architecture.md`, `agent/memory/baffling-issues.txt`).
- Check `agent/memory/` first before re-exploring the codebase or investigating recurring symptoms.

---

## Development & Embedding Workflow

- **Zero-build Static Architecture**: Plain HTML/CSS/JS. Run locally with any static HTTP server:
  ```bash
  python3 -m http.server 8000
  # or
  npx serve .
  ```
- **Embedding API & Two-Way Sync**: Tools (`mdv.html`, `jsv.html`, etc.) communicate with host frames (such as Dylen Studio or Dylen Source Capture extension) via bidirectional `postMessage` protocol documented in [`embed.html`] and [`MDV_TWO_WAY_SYNC_SPEC.md`]