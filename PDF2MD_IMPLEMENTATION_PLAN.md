# PDF → Markdown — Implementation Plan & Investigation Report

> **Date:** 2026-06-08
> **Scope:** `pdf2md.html`, `pdf2md.js`, `pdf2md.css`
> **Companion doc:** [PDF_TO_MD_RESEARCH.md](PDF_TO_MD_RESEARCH.md) — algorithm survey & references

This document captures the three user-reported issues, the root cause of each, and a phased plan to fix them. Nothing here is code yet — this is the design / investigation phase.

---

## 1. Investigation Summary

### 1.1 Screenshot evidence (from the report)

The output area of pdf2md.html shows the **Markdown Preview** header, the **Download ZIP** button, and the statistics (4 pp, 0 img, 4.8 KB) — but the iframe below the header is **completely empty / invisible**. This confirms that the `outputSection` is being shown, but the `md-preview-iframe` inside it is staying hidden.

### 1.2 Output sample evidence (from the report)

The user shared a 4-page PDF ("Werben Sie für sich.pdf") containing a single vocabulary table that spans all 4 pages. The text output starts with:

```
March 29,
## Glossary
2026
### Table: Vocabulary Table
Word / Phrase
Translation
Notes
Ready for bigger
Bereit für Größeres
?
Phrase, idiom
things?
...
```

Key observations:

- The conversion **did** use the Struct Tree path (we see `## Glossary` and `### Table: Vocabulary Table` headings, which are struct-tree roles).
- The Struct Tree emitted the table **caption** but no `TR` / `TH` / `TD` rows (the fallback "Flat TH/TD children without TR wrapper" branch in [pdf2md.js:447-470](pdf2md.js#L447-L470) was triggered but found zero `TH`/`TD` items, so it fell through to the "just join as paragraphs" fallback at the end).
- The actual table content is being read by the **heuristic path** (`reconstructLines`) and emitted as raw text lines.
- A `---` page separator is inserted between every page, splitting the table mid-row.

---

## 2. Issue #1 — Pages panel has no left margin

### 2.1 Root cause

The class `.sidebar-thumb-item` is referenced in [pdf2md.js:315](pdf2md.js#L315) (`sItem.className = 'sidebar-thumb-item'`) but **no CSS rule exists for it** — confirmed by `grep_search` returning zero matches in `pdf2md.css`.

The container `.sidebar-thumb-list` has `padding: 4px var(--space-2)` (4px top/bottom, 8px left/right), but the items themselves have no padding, no border, no flex layout. They render as bare `<div>` blocks with a canvas and a span, hugging the left edge.

### 2.2 Fix

Add a `.sidebar-thumb-item` style block to `pdf2md.css` mirroring the patterns in `.sidebar-setting` / `.sidebar-hf-item`:

- Horizontal flex layout (canvas left, label right, or label below)
- Padding `4px 8px` so the thumbnail isn't flush to the panel body edge
- Hover/active states
- Optional `border-radius` for the canvas so it looks like a page tile

### 2.3 Effort

~10 minutes. ~15 lines of CSS.

---

## 3. Issue #2 — mdv iframe is not opening after conversion

### 3.1 Root cause

Three interacting bugs in [pdf2md.js](pdf2md.js):

1. **The iframe is hidden by default.** The CSS rule `.md-preview-iframe { display: none; }` ([pdf2md.css:332-339](pdf2md.css#L332-L339)) means the iframe is invisible unless it also has `.visible` (`.md-preview-iframe.visible { display: block; }`).

2. **No code adds `.visible` after conversion.** The convert handler in [pdf2md.js:851-940](pdf2md.js#L851-L940) sets `outputSection.style.display = 'block'`, but never adds `.visible` to the iframe. The only place `.visible` is added is the `previewToggle.onclick` handler at [pdf2md.js:1043-1053](pdf2md.js#L1043-L1053).

3. **`previewToggle` is `null`.** The element `#preview-toggle` is queried at [pdf2md.js:33](pdf2md.js#L33) but **does not exist in `pdf2md.html`** — it was removed in a previous refactor. The `if (previewToggle) { ... }` guard at [pdf2md.js:1043](pdf2md.js#L1043) silently skips the only path that ever added `.visible`.

4. **`sendMarkdownToIframe()` is never called after conversion.** Even if `.visible` were added, the iframe would still be empty until the markdown is posted. The only call sites are inside the dead `previewToggle.onclick` and the `ready`-message listener, which depends on the iframe first being visible enough to load mdv.html (chicken-and-egg in some browsers, though the `src="mdv.html"` means it does load).

5. **Reset on `newPdfBtn` removes `.visible`.** At [pdf2md.js:83](pdf2md.js#L83), `mdPreviewFrame.classList.remove('visible')` and `mdPreviewFrame.src = 'mdv.html'` resets the iframe. After a successful conversion, we never re-add `.visible`.

### 3.2 Fix

1. In `convertBtn.onclick`, after the output section is shown ([pdf2md.js:929](pdf2md.js#L929) approximately), add:
   - `mdPreviewFrame.classList.add('visible');`
   - `previewVisible = true;`
   - `sendMarkdownToIframe();`
2. In the `message` listener for the `ready` event, do **not** gate on `previewVisible` (it should always re-send on `ready`).
3. Optionally remove the dead `previewToggle` query and `if (previewToggle) { ... }` block, or reintroduce a UI button if the toggle is desired.

### 3.3 Effort

~5 minutes. ~6 lines changed.

---

## 4. Issue #3 — Table structure not preserved (4-page table collapsed into lines)

### 4.1 Root cause

Three layered bugs:

#### a) Struct Tree emits a "Table" role with no `TR`/`TH`/`TD` children

The PDF is *partially* tagged (so `getStructTree()` returns a tree, not `null`), but the table was authored without full `TR`/`TH`/`TD` structure — likely Microsoft Word's "Table" style applied as a layout grid with paragraphs in cells. The walker at [pdf2md.js:418-470](pdf2md.js#L418-L470) detects this case ("Flat TH/TD children without TR wrapper") but **only handles the case where flat `TH`/`TD` exist** — when they don't, it falls through to the "just join as paragraphs" fallback at the bottom of the branch.

This is the exact bug class documented in [mozilla/pdf.js#20324](https://github.com/mozilla/pdf.js/issues/20324) and partially fixed in [mozilla/pdf.js#20327](https://github.com/mozilla/pdf.js/pull/20327) (Oct 2025). Vendored `pdf.worker.min.js` may predate that fix.

#### b) Heuristic path doesn't detect tables

`reconstructLines` at [pdf2md.js:495-535](pdf2md.js#L495-L535) builds a list of lines from text items, with column detection by X-clustering. But:
- It does *not* recognise that a row with several large X-gaps is a **table row** spanning multiple cells.
- `detectTableRow` at [pdf2md.js:660-688](pdf2md.js#L660-L688) does exist, but it requires *neighbors* to also have multi-column layout, which is true only for one or two rows of the table (and false for the rest). The neighbor check is too strict.

Even when table rows are detected, they're emitted as Markdown tables **per page** — see `linesToMarkdown` at [pdf2md.js:716-770](pdf2md.js#L716-L770). A 4-page table becomes 4 separate Markdown tables.

#### c) `---` page separator splits tables

`assembleMarkdown` at [pdf2md.js:1005-1018](pdf2md.js#L1005-L1018) inserts `---` between every page (when `opts.pageSeps` is on, which is the default). This breaks a multi-page table that happens to be the only content on those pages.

### 4.2 Fix strategy (3-phase)

The research document recommends a hybrid two-pass pipeline. Adapted to the codebase:

#### Phase 1 — Multi-page table continuation detector (highest ROI)

Add a post-page-assembly step that detects when a Markdown table on page N+1 is a **continuation** of a table on page N, and merges them.

Detection signals (in priority order):

1. **Column-count match** — both halves have the same number of `|`-delimited columns.
2. **X-range overlap** — the X-positions of the leftmost/rightmost columns overlap within a tolerance.
3. **Repeated header suppression** — if the first 1–3 rows of page N+1's "table" exactly match the header rows of page N's table, drop them.
4. **"(cont.)" marker** — regex `/\b(cont\.?|continued|cont'd)\b/i` in the last 2 lines of page N or first 2 lines of page N+1.
5. **Y-gap heuristic** — if the last row of page N is near the bottom margin and the first row of page N+1 is near the top margin, merge.

Implementation: a new `mergeContinuationTables(md)` function called inside `assembleMarkdown` after the page loop, before the final newline normalisation.

#### Phase 2 — Improve heuristic table detection (medium ROI)

Replace the strict `detectTableRow` neighbor check with a more permissive rule: a line is a table row if it has ≥2 large X-gaps **and** at least 3 of the 5 surrounding lines also have ≥1 large X-gap (down from "same number of gaps" to "any gaps"). This catches the 4-page vocabulary table, which has many non-tabular paragraphs interleaved with tabular rows.

Also add a **row-coalescing** step: after detecting a sequence of "table row" lines, group them by the number of cells (the most common count wins), and emit the table. If the per-row cell count varies, the most common count is the "true" column count; the other rows are misaligned and should be re-segmented.

#### Phase 3 — Struct Tree: route empty-table cases to grid detection (longer term)

If the Struct Tree reports `Table` roles but the walker finds zero `TR`/`TH`/`TD` children, run the grid-based detector on that page's `TextItem`s and splice the results into the page markdown. This is a port of [pdfplumber's `TableFinder`](https://github.com/jsvine/pdfplumber/blob/stable/pdfplumber/table.py) (Nurminen 5-step algorithm), which is the gold standard for browser-compatible table detection.

Algorithm outline:
1. Extract ruling lines from the page operator list (`re` / `l` ops).
2. If no ruling lines, infer edges from word left/right/centre X-positions and word tops/bottoms.
3. Snap-and-join edges within `snap_tolerance=3`.
4. Compute all (x, y) intersections of vertical × horizontal edges.
5. Find the most-granular set of axis-aligned rectangles whose vertices are intersections.
6. Group cells into connected components (one per table).
7. Assign each text item to a cell by bounding-box test.
8. Emit as Markdown table.

### 4.3 Effort estimates

| Phase | What | Effort | Win |
|-------|------|--------|-----|
| 1 | Multi-page continuation detector | 1 day | High — fixes the reported bug |
| 2 | Better heuristic table row detection | 1 day | High — fixes untagged PDFs |
| 3 | Struct Tree → grid fallback (Nurminen) | 3 days | Medium — full coverage |

### 4.4 Risk / fallback

- The 3-phase plan is additive. Phase 1 can ship independently. If Phase 2's looser neighbor rule causes false-positive table detection on prose-with-gaps, add a confidence check (require ≥3 consecutive table-row lines to start a table).
- Phase 3 should be guarded by a feature flag so it can be disabled per-PDF if the grid detector misbehaves on noisy scans.

---

## 5. Recommended Implementation Order

1. **Quick wins first** (issues #1 and #2 — total ~15 minutes):
   - Add `.sidebar-thumb-item` CSS.
   - Wire the iframe `.visible` toggle into `convertBtn.onclick`.
   - Verify by re-running the failing PDF and confirming both: thumbnails are visible in the panel, and the iframe shows the converted markdown.

2. **Multi-page table detector** (issue #3, Phase 1 — ~1 day):
   - Add `mergeContinuationTables(md)`.
   - Test with the supplied 4-page PDF.
   - Add a "Tables stitched" stat to the output header (small UX improvement so the user can see the merger did something).

3. **Heuristic table detection** (issue #3, Phase 2 — ~1 day):
   - Loosen `detectTableRow` neighbor check.
   - Add row-coalescing by modal cell count.
   - Test with several table-heavy PDFs.

4. **Struct Tree grid fallback** (issue #3, Phase 3 — ~3 days):
   - Port Nurminen 5-step algorithm from pdfplumber.
   - Add the `hasIncompleteTables` check.
   - Test with the supplied PDF and 2–3 other PDFs with similar structure.

---

## 6. Files to change

| File | Change |
|------|--------|
| [pdf2md.css](pdf2md.css) | Add `.sidebar-thumb-item` rule (issue #1) |
| [pdf2md.js](pdf2md.js) | Add `.visible` to iframe in convert handler (issue #2) |
| [pdf2md.js](pdf2md.js) | Remove dead `previewToggle` query (cleanup) |
| [pdf2md.js](pdf2md.js) | Add `mergeContinuationTables()` (issue #3, phase 1) |
| [pdf2md.js](pdf2md.js) | Loosen `detectTableRow`, add row coalescing (issue #3, phase 2) |
| [pdf2md.js](pdf2md.js) | Add grid detector + struct-tree fallback (issue #3, phase 3) |
| [pdf2md.html](pdf2md.html) | Add "Tables stitched" stat (small UX win) |

No new dependencies are needed — the Nurminen algorithm runs purely on `TextItem` geometry already exposed by PDF.js.

---

## 7. Test plan

| Test | Input | Expected output |
|------|-------|-----------------|
| Thumbnails render | 4-page PDF | 4 thumbnail tiles, indented from the sidebar's left edge |
| Iframe shows after convert | any PDF | mdv.html loaded with converted markdown, rendered headings/lists visible |
| Multi-page table | "Werben Sie für sich.pdf" (4-page vocabulary table) | one Markdown table with all rows, no `---` between pages |
| Single-page table | 1-page table PDF | one Markdown table, with `---` after it |
| Page separator off | "page-seps" unchecked | no `---` between any pages |
| Struct tree + complete TR/TD | tagged PDF from Word | full table from struct tree, no fallback needed |
| Struct tree + incomplete TR/TD | partially-tagged PDF | grid detector fills in the missing rows |
