# PDF → Markdown Research: Best Algorithms for Browser-Based Conversion with PDF.js

> Research compiled for the `pdf2md.js` engine in this repo. Last updated: 2026-06-08.

This document surveys the state of the art for converting PDFs to Markdown **fully in the browser** using PDF.js. It is organised around the five hardest sub-problems: multi-page table reconstruction, Struct Tree limits, grid-based table detection, header/footer stripping, and heading detection. For each problem it lists the strongest known algorithms (with pseudocode), reference implementations, and concrete recommendations for what to ship in [pdf2md.js](pdf2md.js).

---

## TL;DR — Prioritised Recommendations

| # | Problem | Recommended approach for browser/PDF.js | Effort | Win |
|---|---------|------------------------------------------|--------|-----|
| 1 | Multi-page tables | **Nurminen line+intersection table finder** + a *continuation detector* (column-count match + repeated header recognition + Y-gap heuristic) | M | High |
| 2 | Struct Tree gaps | **Two-pass conversion**: try `getStructTree()` first, fall back to grid detection for any Table/TR/TH/TD role that returns null/empty | M | High |
| 3 | Grid detection (fallback) | Adapted from `pdfplumber`'s `TableFinder` — line-based + text-alignment hybrid, ported to JS | M | High |
| 4 | Header/footer stripping | Existing approach is solid; upgrade with **fuzzy text match + position zone** (top/bottom 8–12 % of page, with a per-line `y` check, not a single global threshold) | S | Medium |
| 5 | Heading detection | Existing global-font-map is good; layer in **pattern-based** detection for non-tagged PDFs (numbered headings, "§", ALL-CAPS, leading-bold) | S | Medium |

The single biggest practical win is a **two-pass pipeline** that lets the Struct Tree do what it's good at (paragraphs, lists, true headings) while routing real-world borderless tables through a Nurminen-style grid detector. The Struct Tree will *not* solve tables for the majority of PDFs in the wild.

---

## 1. Multi-Page Table Detection and Reconstruction

### 1.1 Why this is hard

A table that crosses a page boundary is *not* a single PDF object. It is two (or more) visually-aligned table fragments whose row counts and column counts agree. There is no PDF operator that says "this table continues here". Detection must be inferred from layout cues.

### 1.2 Heuristics used in production systems

#### a) Column-count matching (Camelot, Tabula)

Both [Camelot](https://github.com/camelot-dev/camelot) and [tabula-java](https://github.com/tabulapdf/tabula-java) treat table continuation as a downstream problem: they extract a table from each page, then a **stitcher** checks if the last row(s) of page *N*'s table and the first row(s) of page *N+1*'s table share:

- the same column count
- the same column X-positions (within a tolerance)
- the same row height (within a tolerance)

Camelot exposes this as [`TableList.stack_contiguous()`](https://camelot-py.readthedocs.io/). Tabula simply concatenates the row lists when a per-page run produces multiple tables at the same Y-baseline area.

#### b) Repeated-header detection (most academic and commercial systems)

Look for the first 1–3 rows of page *N+1*'s "table" to match the *header* rows of page *N*'s table exactly (text + font + weight). If they match, treat the repeated header as a continuation marker and drop it. This is the single most reliable signal in practice.

#### c) Y-gap / whitespace heuristic

In tagged scientific papers, the table area on page *N* ends close to the bottom margin and the table area on page *N+1* begins close to the top margin. A simple rule that works for ~80 % of academic PDFs: *if the last non-empty line on page N is a table row, and the first non-empty line on page N+1 is also a table row with matching column count, merge*.

#### d) Caption / "(continued)" / "Table 1 (cont.)" markers

Many academic publishers insert a literal "Table 1 (continued)" or "continued on next page" hint. Regex match `/\b(cont\.?|continued|cont\'d)\b/i` in the last 3 lines of the page is a cheap pre-filter.

### 1.3 Algorithm — Continuation Detector (recommended)

````text
function detectContinuation(prevPageTable, currPageTable, pageHeight, opts):
    if prevPageTable is null or currPageTable is null: return false

    colsPrev = len(prevPageTable.columns)
    colsCurr = len(currPageTable.columns)
    if colsPrev != colsCurr: return false

    # X-alignment: every column on the new page must overlap a column on the old
    for colNew in currPageTable.columns:
        if not any(xRangesOverlap(colPrev.xRange, colNew.xRange, tol=3)
                   for colPrev in prevPageTable.columns):
            return false

    # Repeated-header suppression
    headerNew = currPageTable.rows[:prevPageTable.headerRowCount]
    if textEqual(headerNew, prevPageTable.headerRows):
        currPageTable.rows = currPageTable.rows[len(headerNew):]
        # merge
        prevPageTable.rows.extend(currPageTable.rows)
        return true

    # Continued-marker
    lastLinesPrev = prevPageTable.tailLines(2)
    firstLinesCurr = currPageTable.headLines(2)
    if any(re.search(r'\bcont', ln, re.I) for ln in lastLinesPrev + firstLinesCurr):
        prevPageTable.rows.extend(currPageTable.rows)
        return true

    # Y-position heuristic
    yPrev = prevPageTable.bbox.bottom
    yCurr = currPageTable.bbox.top
    margin = pageHeight * 0.10
    if yPrev > pageHeight - margin and yCurr < margin:
        prevPageTable.rows.extend(currPageTable.rows)
        return true

    return false
````

### 1.4 Reference implementations

- **Camelot `stack_contiguous()`** — Python, lattice + stream; stitching is row-by-row with column-count match. Source: [`camelot/core.py`](https://github.com/camelot-dev/camelot).
- **tabula-java `SpreadsheetExtractionAlgorithm`** — Java, lattice mode, no native stitching but produces per-page tables; stitching is a 30-line wrapper (see [issue #16](https://github.com/tabulapdf/tabula-extractor/issues/16) for the original Tabula design discussion).
- **pdfplumber** — Python, `TableFinder` returns per-page tables; no built-in stitching, but `Table.bbox` and `Table.cells` make post-hoc stitching trivial (see [pdfplumber/table.py](https://github.com/jsvine/pdfplumber/blob/stable/pdfplumber/table.py)).

### 1.5 Status in current `pdf2md.js`

**Missing.** Tables are emitted per-page in [pdf2md.js:418-468](pdf2md.js#L418-L468) with no continuation detection. To ship, add a `mergeContinuationTables(prevMd, currMd)` step at the end of `tryStructTreeConversion` *and* the grid-based fallback, before joining pages.

---

## 2. PDF.js Struct Tree — Why It Fails (or Returns Incomplete Data)

### 2.1 What `getStructTree()` actually returns

The API is documented in the [Mozilla PDF.js API draft](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html). For each page it returns a tree of nodes with `role` (e.g. `Document`, `Sect`, `P`, `H1`–`H6`, `L`, `LI`, `Lbl`, `LBody`, `Table`, `TR`, `TH`, `TD`, `Caption`, `Figure`, `Formula`, `Span`) and `children`. The role map at [struct_tree_layer_builder.js:0-50](https://github.com/mozilla/pdf.js/blob/master/web/struct_tree_layer_builder.js) lists the canonical mappings. Crucially, it returns `null` for **non-tagged** PDFs.

The text content lives in `getTextContent({ includeMarkedContent: true })`, which interleaves `beginMarkedContentProps` / `beginMarkedContent` / `endMarkedContent` markers with `TextItem`s, each marked item carrying a string `id` (e.g. `"p19R_mc0"`) that matches the `children[].id` in the struct tree.

### 2.2 Why conversion via Struct Tree often misses tables

Five concrete reasons, all confirmed by reading the PDF.js source and recent issue tracker:

1. **Most PDFs are not tagged.** Acrobat's "Make Accessible" workflow and Office's "tag on export" are opt-in. Scans and LaTeX output (the most common academic-PDF pipeline) almost never carry a `StructTreeRoot`. `page.getStructTree()` returns `null` and the function should bail out.
2. **Tagged PDFs frequently have `Table` roles with no `TR`/`TH`/`TD` children.** A common shortcut in Microsoft Word is to add a `<w:tbl>` for layout without the full `<w:tr>`/`<w:tc>` tree; the role is preserved but the children are flat paragraphs. [`walkStructTree` in pdf2md.js:418-468](pdf2md.js#L418-L468) handles this case ("Flat TH/TD children without TR wrapper") but only with a best-guess column count.
3. **Empty / merged cells are dropped.** Until the [Oct 2025 PR #20327](https://github.com/mozilla/pdf.js/pull/20327) ("Collect all child nodes of lists and tables in StructTree", merged 30 Oct 2025, fixing [issue #20324](https://github.com/mozilla/pdf.js/issues/20324)), PDF.js silently dropped empty `Table`/`TR`/`LI` children during struct-tree collection. If you are pinned to an older `pdfjs-dist`, you *will* get garbled tables.
4. **Cell-spanning rows and columns lose their geometry.** The struct tree has no notion of `colspan`/`rowspan`. A "merged cell" looks like a single `TD` containing multiple `P`s, indistinguishable from a long paragraph.
5. **Marked-content IDs are page-local, not document-local.** Two different cells on different pages can have the same `id`. The `idMap` in [pdf2md.js:347-362](pdf2md.js#L347-L362) is correct because it's rebuilt per page, but any cross-page table stitching must be done on the emitted markdown, not on the struct tree.

### 2.3 Algorithm — When to trust Struct Tree vs. when to fall back

````text
function tryStructTreeConversion(page, opts):
    tree = await page.getStructTree()
    if tree is null:
        return { used: 'grid', reason: 'untagged' }

    tc = await page.getTextContent({ includeMarkedContent: true })
    idMap = buildIdMap(tc)

    # Walk tree, collect a per-role hit/miss map
    roleStats = walkAndCount(tree)        # { 'Table': 2, 'P': 47, 'TR': 0, ... }

    # If the page claims to have a Table but emitted zero TR/TH/TD nodes,
    # the struct tree is incomplete → fall back to grid detection for tables.
    if roleStats['Table'] > 0 and roleStats['TR'] == 0 and roleStats['TD'] == 0:
        tablesViaStruct = []
        for tblRole in walkFinding(tree, role='Table'):
            text = renderTable(tblRole, idMap)
            if looksLikeRealTable(text) and columnCountConsistent(text):
                tablesViaStruct.append(text)
            else:
                tablesViaStruct.append(None)   # mark for fallback
        return { used: 'hybrid', structMd: ..., missing: tablesViaStruct }

    return { used: 'struct', md: walkStructTree(tree, idMap) }
````

### 2.4 Reference implementation

- Source: [`src/core/struct_tree.js`](https://github.com/mozilla/pdf.js/blob/master/src/core/struct_tree.js) — `StructTreePage.serializable` at line 897 is what `getStructTree()` returns.
- Tests / role examples: [`test/unit/struct_tree_spec.js`](https://github.com/mozilla/pdf.js/blob/master/test/unit/struct_tree_spec.js) — see especially the "should collect all list and table items in StructTree" test that documents the now-fixed bug.

### 2.5 Status in current `pdf2md.js`

[pdf2md.js:334-348](pdf2md.js#L334-L348) calls `getStructTree()` and bails on `null`, but it does *not* detect the "Table role with no TR/TH/TD children" case. Adding the `roleStats` check above would route that case to a grid detector and recover most real-world borderless tables.

---

## 3. Grid-Based Table Detection (Fallback Path)

When Struct Tree is absent or incomplete, the only signal we have is the geometry of the text on the page. The gold-standard algorithm in this space is the **Nurminen master-thesis algorithm** (2003, Tampere), as adapted by `pdfplumber` and used (with modifications) by Camelot's `lattice` and `network` parsers.

### 3.1 The Nurminen / pdfplumber algorithm in five steps

1. **Find vertical and horizontal lines** (vector strokes from the PDF content stream, or — if absent — implicit lines inferred from word alignment).
2. **Snap and join** — merge lines that are nearly parallel and within a small `snap_tolerance` (default 3 pt) of each other.
3. **Intersect** — compute all (x, y) intersections of vertical × horizontal edges.
4. **Cells** — find the most-granular set of axis-aligned rectangles whose vertices are intersections.
5. **Tables** — group cells into connected components (cells sharing at least one corner form one table).

Source: [`pdfplumber/table.py`](https://github.com/jsvine/pdfplumber/blob/stable/pdfplumber/table.py) is a clean, well-commented reference (~700 lines). See `TableFinder.get_edges()`, `edges_to_intersections()`, `intersections_to_cells()`, `cells_to_tables()`.

### 3.2 Strategy selector — `lines` vs. `text` vs. `lines_strict`

`pdfplumber` exposes four `vertical_strategy` and `horizontal_strategy` options:

| Strategy | Use when | Notes |
|----------|----------|-------|
| `lines` | The PDF has visible ruling lines (Excel-style exports, formal reports) | Includes the sides of `rect` objects |
| `lines_strict` | Same, but you want to ignore rectangle borders | Avoids mistaking coloured backgrounds for cells |
| `text` | Borderless tables (most academic PDFs, most Word→PDF exports) | Infers lines from word left/right/centre X-positions |
| `explicit` | User-supplied coordinates | For cropping |

The best heuristic for the browser is **`lines` on the horizontal axis + `text` on the vertical axis** when no ruling lines are detected on that axis. This matches the combination that Camelot's `engine="combined"` uses (Camelot's own docs at [camelot-py](https://github.com/camelot-dev/camelot)).

### 3.3 The "text" strategy in detail (for borderless tables)

For the vertical axis, the question is: "if I draw a vertical line at X, how many words does it touch?" Words are PDF.js `TextItem`s with `transform[4]` (X) and `transform[5]` (Y) in device space.

````text
function wordsToVerticalEdges(words, threshold=3):
    # For each word, project to (x0, x1, x_center)
    points = []
    for w in words:
        points += [w.x0, w.x1, (w.x0 + w.x1)/2]
    # Cluster the points with tolerance=threshold
    clusters = cluster1D(points, threshold)
    # Keep clusters that contain >= 3 distinct words
    edges = []
    for c in clusters where len(c.words) >= 3:
        # Edge spans the full height of the page
        edges.append({ x0: c.xMean, x1: c.xMean, top: 0, bottom: pageHeight,
                       orientation: 'v' })
    return edges
````

The horizontal axis uses the *tops* of words (since rows are aligned by top in PDF).

### 3.4 Header detection (inside a table)

Once you have a table, the first row is the header if **any** of:

- The first row uses a different (typically larger or bolder) font than the rest of the table.
- The cells in the first row are short, label-like, and do not contain numeric data.
- The cells in the first row contain no internal whitespace (i.e. they look like column names).

A simple rule that works for ~85 % of cases: *the first row whose cells all have font-size ≥ 1.05× the body font size of the table is the header*.

### 3.5 Algorithm — full grid-based table finder (pseudocode for browser)

````text
async function detectTablesGrid(pdfPage, items, pageHeight):
    # 1. Get ruling lines from the page operator list (PDF.js doesn't expose
    #    this directly; you must walk the content stream via
    #    page.getOperatorList() and look for 're' (rectangle) and 'l' (line)
    #    operators).
    ops = await pdfPage.getOperatorList()
    hLines, vLines = extractRulingLines(ops, pageHeight)

    # 2. If we have ANY ruling lines, use the 'lines' strategy.
    if hLines.length + vLines.length > 0:
        strategy = 'lines'
        hEdges = snapAndJoin(hLines)
        vEdges = snapAndJoin(vLines)
    else:
        # 3. Otherwise infer edges from text alignment.
        strategy = 'text'
        vEdges = wordsToVerticalEdges(items)
        hEdges = wordsToHorizontalEdges(items)

    # 4. Intersect.
    intersections = edgesToIntersections(hEdges, vEdges)

    # 5. Cells and tables.
    cells = intersectionsToCells(intersections)
    tables = cellsToTables(cells)

    # 6. Extract text per cell.
    for t in tables:
        t.rows = cellsToRows(t.cells, items)   # group by Y
        t.headerRowCount = detectHeaderRows(t.rows, items)
    return tables
````

### 3.6 Reference implementations

- **`pdfplumber`** (Python, ~700 LOC, clean): [pdfplumber/table.py](https://github.com/jsvine/pdfplumber/blob/stable/pdfplumber/table.py).
- **Camelot lattice + network** (Python, Rust core): [camelot/core.py](https://github.com/camelot-dev/camelot).
- **Tabula-java `SpreadsheetExtractionAlgorithm`** (Java): [tabula-java](https://github.com/tabulapdf/tabula-java).
- **Anssi Nurminen, "A Algorithm for Table Detection and Extraction in PDF Documents"** (MSc thesis, 2003): [trepo.tuni.fi/.../Nurminen.pdf](https://trepo.tuni.fi/bitstream/handle/123456789/21520/Nurminen.pdf?sequence=3) (note: behind Anubis bot challenge as of 2026-06).

### 3.7 Status in current `pdf2md.js`

`reconstructLines` at [pdf2md.js:490-535](pdf2md.js#L490-L535) does column detection (X-clustering) but does *not* produce explicit tables — it interleaves columns and treats them as a multi-column page layout. A proper `detectTablesGrid` (above) would replace/augment the column path.

---

## 4. Header / Footer Detection Across Pages

### 4.1 What the current code does

[pdf2md.js:246-273](pdf2md.js#L246-L273) implements a per-page first pass:

1. Group all text items by exact string.
2. Decide if a string is a header if it appears in the **top 8 %** of the page; footer if it appears in the **bottom 8 %**.
3. Promote a string to "header/footer pattern" if it appears on >50 % of pages.

### 4.2 What's wrong with the current approach

Two limitations:

1. **Hard-coded 8 % zone** doesn't adapt to documents with large top margins (e.g. book chapters) or those that put page numbers in the middle.
2. **Exact-string matching** misses headers that change slightly per page (e.g. "Chapter 3 — continued", running headers that include chapter title + page number).

### 4.3 Robust algorithm — fingerprint + position zone

````text
function detectRepeatedHeadersFooters(allPages, opts):
    HEADER_ZONE = 0.12   # top 12% of page
    FOOTER_ZONE = 0.12   # bottom 12% of page
    MIN_PAGES   = 0.5    # must appear on >= 50% of pages

    fingerprints = {}   # normalised_text -> { pages, yValues, fontSizes }
    for (i, page) in enumerate(allPages):
        for item in page.textContent.items:
            if item.str is empty: continue
            y = item.transform[5]
            if y > page.height * (1 - FOOTER_ZONE):
                zone = 'footer'
            elif y < page.height * HEADER_ZONE:
                zone = 'header'
            else:
                continue
            # Normalise: strip digits, lowercase, collapse whitespace
            norm = normaliseForMatch(item.str)
            key = (zone, norm)
            fingerprints.setdefault(key, []).append({
                page: i, y, fontSize: item.height
            })

    out = { headers: [], footers: [] }
    for (zone, norm), occurrences in fingerprints.items():
        pagesSeen = set(o.page for o in occurrences)
        if len(pagesSeen) >= len(allPages) * MIN_PAGES:
            out[zone + 's'].append({
                fingerprint: norm,
                example: occurrences[0].text,
                pages: sorted(pagesSeen),
                meanY: mean(o.y for o in occurrences),
                meanFontSize: mean(o.fontSize for o in occurrences),
            })
    return out
````

The fingerprint step is what makes the detector tolerant of "Section 3.1", "Section 3.2", etc. — they all normalise to `section \d+\.\d+`. This is the same idea as the popular Python tool [`pdfminer.six`](https://github.com/pdfminer/pdfminer.six)'s `high_level.extract_pages` and the algorithm used by [Apache Tika](https://tika.apache.org/) for repeated-region detection.

### 4.4 Reference implementations

- **Apache Tika** uses a *content-similarity* (n-gram shingling) approach for repeated regions in its `PDF2XHTML` parser.
- **pdfminer.six** uses bounding-box clustering.
- **Current `pdf2md.js`** uses exact-string + zone. The `normaliseForMatch` upgrade is a ~30-line change.

### 4.5 Status in current `pdf2md.js`

Mostly correct, missing only the **normalisation step** (digit stripping, whitespace collapsing) and the **per-line y-threshold** (currently done at the zone level only).

---

## 5. Heading Detection

### 5.1 Three orthogonal signals

| Signal | Strength | Weakness |
|--------|----------|----------|
| **Font size** (from `TextItem.height`) | Strong in academic PDFs; weak in 1-column magazine layouts | Body text in 2-col layouts may be 8 pt while headings in figure captions are 10 pt |
| **Font weight / family** (from `fontName`) | Strong in Word-origin PDFs | Inherited font names (e.g. `Arial,Bold`) need substring matching |
| **Patterns** (numbered, ALL-CAPS, "§", "Chapter N") | Strong across all PDF types | Misses unstyled headings |
| **Position** (indented? left-aligned? centred?) | Weak alone | Useful as a tie-breaker |
| **Struct tree role** (`H1`–`H6`) | Authoritative when present | Absent in untagged PDFs |

### 5.2 The existing `pdf2md.js` algorithm

[pdf2md.js:140-198](pdf2md.js#L140-L198) builds a **global font-size histogram** across all pages, then assigns the top N sizes to H1…H6. This is the approach used by `pdf2htmlEX` and most academic-PDF tools. It works extremely well when the document is internally consistent.

### 5.3 Improvements to layer on top

1. **Pattern-based detection** — for each line, check:
   - `^\d+(\.\d+)*\s+\S` → numbered heading (e.g. "3.1 Methods", "Chapter 4")
   - `^§\s*\d+` → legal/regulation heading
   - `^[A-Z][A-Z\s]{4,}$` → ALL-CAPS heading
   - First line of a paragraph following a blank line, with bold font, with a colon at the end → definition heading
2. **Font-weight detection** — PDF.js doesn't directly expose weight, but `fontName` strings like `Arial,Bold`, `Arial-Bold`, `Arial-BoldMT` are detectable via regex. Treat those as "bold" and check size against body.
3. **Struct-tree role override** — if a Struct Tree is present, trust `H1`–`H6` roles and *replace* the font-size-based level for that span.
4. **De-collision** — when two distinct font sizes both round to the same value within ±0.5 pt, prefer the *larger* one (catches a common PDF quirk where H4 in section A is set in the same size as H5 in section B).

### 5.4 Algorithm — combined heading detection

````text
function classifyHeadings(items, structTree, globalFontMap):
    headings = []
    for line in groupByLine(items):
        # 1. Pattern-based: numbered, all-caps, "§"
        pattern = matchHeadingPattern(line)
        if pattern:
            headings.append({ line, level: pattern.level, source: 'pattern' })
            continue

        # 2. Struct tree: if any item in the line is in an H1..H6 role
        structRole = lookupStructRole(line, structTree)
        if structRole:
            headings.append({ line, level: int(structRole[1]), source: 'struct' })
            continue

        # 3. Font-size: only if line is also visually distinct
            # (bold OR larger than body OR centred)
        size = dominantFontSize(line)
        bold = isBoldFont(line)
        if (size > bodyFont * 1.08 or bold) and len(line.text.strip()) > 0:
            level = globalFontMap.get(size) or 7
            if level <= 6:
                headings.append({ line, level, source: 'font' })

    return headings
````

### 5.5 Reference implementations

- **`pdf2htmlEX`** — C++, font-size clustering. See [artifacts](https://github.com/dzavalishin/pdf2htmlEX).
- **Marker** (the modern Python tool by Vik Paruchuri) — combines font size, bold, position, and pattern detection: [marker-pdf](https://github.com/datalab-to/marker).
- **Unstructured.io** — pattern + ML-based.
- **DocLayNet / DiT** (Document Image Transformer by Microsoft) — 2022-2023 SOTA, but requires GPU.
- **Nougat** (Meta, 2023) — end-to-end transformer for scientific PDFs.

### 5.6 Status in current `pdf2md.js`

The global font-size approach is in place. The biggest missing piece is **pattern-based fallback** for documents with consistent font sizes across all heading levels (surprisingly common in older government/regulatory PDFs).

---

## 6. Reference Implementations — Curated List

| Tool | Lang | Browser? | Tables | H/F | Headings | Multi-page tables |
|------|------|----------|--------|-----|----------|-------------------|
| **[pdfplumber](https://github.com/jsvine/pdfplumber)** | Python | No | ★★★★★ (Nurminen) | ★★ | ★ | No native stitching |
| **[Camelot](https://github.com/camelot-dev/camelot)** | Python | No | ★★★★★ (5 parsers, ML) | ★★★ (`header_text`/`footer_text`) | ★ | `stack_contiguous()` |
| **[tabula-java](https://github.com/tabulapdf/tabula-java)** | Java | No | ★★★★ (lattice + stream) | ★ | ★ | Manual |
| **[pdfminer.six](https://github.com/pdfminer/pdfminer.six)** | Python | No | ★ (LTLine-based) | ★★ | ★ | No |
| **[pdf2htmlEX](https://github.com/dzavalishin/pdf2htmlEX)** | C++ | No | ★★ (HTML output, not MD) | ★★ | ★★★ | No |
| **[Marker](https://github.com/datalab-to/marker)** | Python | No | ★★★★ (uses surya + layout) | ★★★ | ★★★★ | No native stitching |
| **[Unstructured](https://github.com/Unstructured-IO/unstructured)** | Python | No | ★★★★ | ★★★ | ★★★ | No |
| **[Nougat](https://github.com/facebookresearch/nougat)** | Python (PyTorch) | No | N/A (scientific papers) | N/A | N/A | N/A |
| **[pdftotext (Poppler)](https://poppler.freedesktop.org/)** | C | No | ★ | ★★ | ★ | No |
| **[PDF.js `getStructTree`](https://mozilla.github.io/pdf.js/)** | JS | **Yes** | ★★ (when present) | ★ | ★★★★ (when present) | No |
| **`pdf2md.js` (this repo)** | JS | **Yes** | ★★ (column detection) | ★★★ (zone + count) | ★★★ (global font map) | **No** ← biggest gap |

---

## 7. Algorithm Pseudocode — The Complete Recommended Pipeline

````text
async function convertPdfToMarkdown(pdfDoc, opts):
    md = []
    allPages = await loadAllPages(pdfDoc)

    # 1. Pass 1: pre-analyse for H/F and font-size histogram
    hfPatterns = detectRepeatedHeadersFooters(allPages, opts)
    fontMap    = buildGlobalFontMap(allPages)

    # 2. Per-page conversion
    for page in allPages:
        structTree = await page.getStructTree()
        text       = await page.getTextContent({ includeMarkedContent: true })

        # 2a. Try Struct Tree first
        if structTree is not null:
            pageMd = walkStructTree(structTree, buildIdMap(text), 0)
            # 2b. If the struct tree has Table roles with no TR/TD, top up with grid
            if hasIncompleteTables(structTree):
                gridTables = detectTablesGrid(page, text.items, page.viewport.height)
                pageMd = spliceInGridTables(pageMd, gridTables)
        else:
            # 2c. Pure fallback: detect tables from text positions
            lines   = reconstructLines(text, page.viewport.height, hfPatterns, excludedTexts)
            tables  = detectTablesGrid(page, text.items, page.viewport.height)
            pageMd  = weaveLinesAndTables(lines, tables, fontMap)

        md.append(pageMd)

    # 3. Pass 2: stitch multi-page tables
    md = mergeContinuationTables(md)

    return joinAndNormalise(md)
````

---

## 8. Key References and Further Reading

### Papers
- **Anssi Nurminen**, *A Algorithm for Table Detection and Extraction in PDF Documents*, MSc thesis, Tampere University of Technology, 2003. [trepo.tuni.fi/.../Nurminen.pdf](https://trepo.tuni.fi/bitstream/handle/123456789/21520/Nurminen.pdf?sequence=3) — the original table-detection algorithm.
- **Pivovarov & El-Hakim** — *Table extraction from PDF: a systematic review* (2022).
- **Microsoft DocLayNet / DiT** (2022) — large-scale dataset and model for layout analysis.
- **Meta Nougat** (2023) — neural end-to-end academic-PDF OCR.

### Library docs and code
- [pdf.js getStructTree API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html)
- [pdf.js struct_tree.js source](https://github.com/mozilla/pdf.js/blob/master/src/core/struct_tree.js)
- [pdf.js struct_tree_layer_builder.js](https://github.com/mozilla/pdf.js/blob/master/web/struct_tree_layer_builder.js) — role map.
- [pdfplumber README](https://github.com/jsvine/pdfplumber) — best modern writeup of the Nurminen algorithm.
- [Camelot README](https://github.com/camelot-dev/camelot) — five parsers comparison table.
- [Tabula wiki](https://github.com/tabulapdf/tabula) — lattice/stream explanation.
- [PDF 32000-1:2008 spec, § 14.7 (Tagged PDF)](https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/PDF32000_2008.pdf) — the underlying tagged-PDF model.

### Recent PDF.js issues
- [mozilla/pdf.js#20324](https://github.com/mozilla/pdf.js/issues/20324) — *Missing empty struct nodes via getStructTree* (closed by PR #20327, Oct 2025). Confirms the "struct tree may be missing empty cells" problem.
- [mozilla/pdf.js#20327](https://github.com/mozilla/pdf.js/pull/20327) — *Collect all child nodes of lists and tables in StructTree* (merged).
- [mozilla/pdf.js#13423](https://github.com/mozilla/pdf.js/issues/13423) — *getStructTree not available on ES5 build?* (closed 2021).

### Deep-learning table extractors (if you ever want to drop the heuristic)
- **TableNet** (TCS, 2019) — semantic segmentation, F1 0.96.
- **DeepDeSRT** (DFKI, 2017) — Fast R-CNN + VGG-16.
- **Table Transformer (TATR)** by IBM (2021) — the basis for Camelot's `flavor="ml"`.
- **DocLayNet / DiT** (Microsoft, 2022) — 1M-document dataset, layout-aware.

---

## 9. What to Ship — A 3-Sprint Plan

### Sprint 1 (1–2 days) — Continuation detector
- Add `mergeContinuationTables()` to the post-page loop.
- Implement column-count + X-range + repeated-header + "cont" marker checks.
- **Result:** tables that span pages become one Markdown table.

### Sprint 2 (3–5 days) — Hybrid Struct Tree + grid fallback
- Port `wordsToVerticalEdges` / `wordsToHorizontalEdges` from pdfplumber (JavaScript, ~200 LOC).
- Add the `hasIncompleteTables` check and route to grid detection only when the Struct Tree role coverage is suspicious.
- **Result:** untagged PDFs (the majority) get real tables.

### Sprint 3 (1 day) — Heading and H/F polish
- Add `normaliseForMatch` to the header/footer detector (digit stripping).
- Add the pattern-based heading detector (numbered, ALL-CAPS, "§").
- **Result:** documents with consistent font sizes and quirky headers/footers are cleaner.

Sprints 1 + 2 give the largest improvement-to-effort ratio; Sprint 3 is polish. Anything beyond Sprint 3 (ML-based table detection, neural layout analysis) is probably out of scope for a client-side-only conversion tool — TATR is GPU-only, and shipping a 100 MB ONNX runtime to the browser is rarely worth it.
