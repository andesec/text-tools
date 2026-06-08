# PDF2MD — Table Detection Findings

**Context:** When extracting vocabulary tables from tagged-but-poorly-structured
PDFs (like the user's "Werben Sie für sich.pdf"), the struct tree reports a
"Table" role but the cells are emitted as flat paragraphs, not as TR/TD
elements. We need a grid-based detector to recover the table structure.

## Algorithm: Adaptive grid detection (Nurminen 2003)

1. **Sort** all text items by Y (top to bottom of page).
2. **Group** items by Y within an **adaptive tolerance** based on the
   **modal** (most common) Y difference between consecutive items.
3. **Cluster** X positions within each line to find cells, using a per-line
   adaptive gap (60% of the line's own median X gap, clamped to [4, 30]).
4. **Find the modal cell count** across all lines (the column count).
5. **Group consecutive lines with that cell count** into tables.

## Key insight: Y tolerance must be ≥ 1 line height

In tagged PDFs, a cell in column 1 may contain a multi-line German phrase
(e.g. "Bereit für Größeres") while column 2 contains its English translation
("Ready for bigger") on the **second line** of the German cell. This means
cells in the same visual row are ~1 line height apart in Y, not on the same Y.

A tolerance of `0.5 × median line height` (4–5 units in this PDF) splits them
across rows. A tolerance of `0.9 × modal inter-line gap` (24 in this PDF) is
correct: it groups items ≤ 1 line apart, but separates items > 1 line apart.

For the user's PDF:
- Modal inter-line gap: 26.90 (one line height)
- Intra-row offset: 9.42 (one wrapped line)
- Inter-row offset: 26.95
- **Use `yTolerance = 0.9 × 26.90 = 24.21`** — separates rows, groups
  wrapped-cell items.

## Test PDF: "Werben Sie für sich.pdf"

- 4 pages, page 1 has a 3-column vocabulary table spanning multiple table
  segments separated by visual whitespace.
- Cell layout: col 1 starts at x=54.77, col 2 at x=191.88, col 3 at x=304.44.
  Column gaps are large (~110–140 units), so X clustering is easy.
- The struct tree reports a "Table" role heading but no TR/TD children, so
  the walker falls through to "join as paragraphs".
- With the adaptive detector, page 1 now yields 3 table segments matching the
  3 visual sections of the vocabulary.

## Test data point that broke the original detector

"Word / Phrase" @ y=668.13, "Translation" @ y=668.13, "Notes" @ y=668.13
(all headers on the same Y)

"Bereit für Größeres" @ y=632.09 (col 1)
"?" @ y=632.09, x=160 (col 1 gutter, same Y as Bereit)
"Ready for bigger" @ y=641.50 (col 2, 9.4 below)
"?" @ y=623.00, x=225 (col 2, 9.4 above Bereit)
"things" @ y=623.00 (col 2)

The Y=623 / Y=632 / Y=641 items are all part of row 1, but at three different
Y positions due to the German phrase wrapping to 2 lines.
