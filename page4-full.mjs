import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync, existsSync } from 'fs';

const pdfPath = process.argv[2] || './uploads/test.pdf';
if (!existsSync(pdfPath)) {
    console.log(`Test PDF not found at ${pdfPath}. Place a PDF in ./uploads/ or pass as an argument.`);
    process.exit(0);
}
const data = new Uint8Array(readFileSync(pdfPath));
const doc = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
const page = await doc.getPage(4);
const tc = await page.getTextContent();

const txtItems = tc.items.filter(it => it.str && it.str.trim() && it.transform && it.transform.length >= 6);
const sortedByY = txtItems.slice().sort((a, b) => b.transform[5] - a.transform[5]);
const yDiffs = [];
for (let i = 1; i < sortedByY.length; i++) {
    const diff = Math.abs(sortedByY[i].transform[5] - sortedByY[i - 1].transform[5]);
    if (diff > 0.1) yDiffs.push(diff);
}
const rounded = yDiffs.map(d => Math.round(d * 10) / 10);
const counts = {};
let modalDiff = 0, modalCount = 0;
for (const d of rounded) {
    counts[d] = (counts[d] || 0) + 1;
    if (counts[d] > modalCount) { modalCount = counts[d]; modalDiff = d; }
}
const yTolerance = Math.max(2, modalDiff * 0.9);

const lineGroups = [];
let cg = [sortedByY[0]]; let cy = sortedByY[0].transform[5];
for (let i = 1; i < sortedByY.length; i++) {
    const item = sortedByY[i];
    const y = item.transform[5];
    if (Math.abs(y - cy) <= yTolerance) cg.push(item);
    else { lineGroups.push({ y: cy, items: cg }); cg = [item]; cy = y; }
}
if (cg.length > 0) lineGroups.push({ y: cy, items: cg });

const lineCells = lineGroups.map(group => {
    const sorted = group.items.slice().sort((a, b) => a.transform[4] - b.transform[4]);
    const xGaps = [];
    for (let i = 1; i < sorted.length; i++) xGaps.push(sorted[i].transform[4] - sorted[i - 1].transform[4]);
    xGaps.sort((a, b) => a - b);
    const medianXGap = xGaps.length > 0 ? xGaps[Math.floor(xGaps.length / 2)] : 10;
    const localGap = Math.max(4, Math.min(30, medianXGap * 0.6));
    const cells = [];
    let currentCell = [sorted[0]];
    let lastEnd = sorted[0].transform[4] + (sorted[0].width || 0);
    for (let i = 1; i < sorted.length; i++) {
        const item = sorted[i];
        const x = item.transform[4];
        if (x - lastEnd > localGap) { cells.push(currentCell); currentCell = [item]; }
        else currentCell.push(item);
        lastEnd = x + (item.width || 0);
    }
    cells.push(currentCell);
    return {
        y: group.y,
        cells: cells.map(c => c.map(it => (it.str || '').trim()).filter(Boolean).join(' ').trim())
    };
});

console.log('=== ALL LINE CELLS (page 4) ===');
lineCells.forEach((l, i) => {
    console.log(`  ${i} y=${l.y.toFixed(1)} [${l.cells.length} cells]: ${l.cells.map(c => `"${c.slice(0, 40)}"`).join(' | ')}`);
});
