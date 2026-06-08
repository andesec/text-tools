// Extract detectGridTables from pdf2md.js (browser code) and run it on the real PDF
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync } from 'fs';
import { createCanvas } from 'canvas';

const pdfPath = '/Users/nd/dev/andesec/text-tools/Werben Sie für sich.pdf';
const data = new Uint8Array(readFileSync(pdfPath));

// The exact function from pdf2md.js (copy-pasted with no changes)
function detectGridTables(items) {
    console.log('[grid] detectGridTables called with', items.length, 'items');
    const txtItems = items.filter(it => it.str && it.str.trim() && it.transform && it.transform.length >= 6);
    console.log('[grid] after filter:', txtItems.length, 'non-empty text items');
    if (txtItems.length === 0) {
        console.log('[grid] BAIL: no text items');
        return [];
    }
    if (txtItems.length < 6) {
        console.log('[grid] BAIL: fewer than 6 items');
        return [];
    }
    console.log('[grid] first 3 items:', txtItems.slice(0, 3).map(it => ({
        str: it.str.slice(0, 30),
        x: it.transform[4]?.toFixed(1),
        y: it.transform[5]?.toFixed(1),
        w: it.width?.toFixed(1)
    })));

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
    console.log('[grid] modal Y diff =', modalDiff, 'yTolerance =', yTolerance);

    const lineGroups = [];
    let currentGroup = [sortedByY[0]];
    let currentY = sortedByY[0].transform[5];
    for (let i = 1; i < sortedByY.length; i++) {
        const item = sortedByY[i];
        const y = item.transform[5];
        if (Math.abs(y - currentY) <= yTolerance) {
            currentGroup.push(item);
        } else {
            lineGroups.push({ y: currentY, items: currentGroup });
            currentGroup = [item];
            currentY = y;
        }
    }
    if (currentGroup.length > 0) lineGroups.push({ y: currentY, items: currentGroup });

    console.log('[grid] line groups:', lineGroups.length);
    if (lineGroups.length < 2) {
        console.log('[grid] BAIL: too few line groups');
        return [];
    }

    const lineCells = lineGroups.map(group => {
        const sorted = group.items.slice().sort((a, b) => a.transform[4] - b.transform[4]);
        const xGaps = [];
        for (let i = 1; i < sorted.length; i++) {
            xGaps.push(sorted[i].transform[4] - sorted[i - 1].transform[4]);
        }
        xGaps.sort((a, b) => a - b);
        const medianXGap = xGaps.length > 0 ? xGaps[Math.floor(xGaps.length / 2)] : 10;
        const localGap = Math.max(4, Math.min(30, medianXGap * 0.6));
        const cells = [];
        let currentCell = [sorted[0]];
        let lastEnd = sorted[0].transform[4] + (sorted[0].width || 0);
        for (let i = 1; i < sorted.length; i++) {
            const item = sorted[i];
            const x = item.transform[4];
            if (x - lastEnd > localGap) {
                cells.push(currentCell);
                currentCell = [item];
            } else {
                currentCell.push(item);
            }
            lastEnd = x + (item.width || 0);
        }
        cells.push(currentCell);
        return {
            y: group.y,
            cells: cells.map(c => c.map(it => (it.str || '').trim()).filter(Boolean).join(' ').trim())
        };
    });

    const cellCounts = lineCells.map(l => l.cells.length);
    const multiCellCounts = cellCounts.filter(c => c > 1);
    console.log('[grid] cell counts per line:', cellCounts.join(','));
    console.log('[grid] multi-cell lines:', multiCellCounts.length);
    if (multiCellCounts.length < 2) {
        console.log('[grid] BAIL: fewer than 2 multi-cell lines');
        return [];
    }

    const counts2 = {};
    let maxCount = 0, modalCellCount = multiCellCounts[0];
    for (const v of multiCellCounts) {
        counts2[v] = (counts2[v] || 0) + 1;
        if (counts2[v] > maxCount) { maxCount = counts2[v]; modalCellCount = v; }
    }
    console.log('[grid] modal cell count =', modalCellCount);
    if (modalCellCount < 2) {
        console.log('[grid] BAIL: modal cell count < 2');
        return [];
    }

    const tables = [];
    let currentTable = [];
    for (let i = 0; i < lineCells.length; i++) {
        if (lineCells[i].cells.length === modalCellCount) {
            currentTable.push(lineCells[i]);
        } else {
            if (currentTable.length >= 2) {
                tables.push({ rows: currentTable.map(l => l.cells) });
            }
            currentTable = [];
        }
    }
    if (currentTable.length >= 2) {
        tables.push({ rows: currentTable.map(l => l.cells) });
    }
    console.log('[grid] FINAL: found', tables.length, 'tables');
    return tables;
}

const doc = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
console.log('Pages:', doc.numPages);

for (let p = 1; p <= doc.numPages; p++) {
    console.log('\n========== PAGE', p, '==========');
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    console.log('Total text items from getTextContent():', tc.items.length);
    const tables = detectGridTables(tc.items);
    console.log('Tables found on page', p, ':', tables.length);
    for (let t = 0; t < tables.length; t++) {
        console.log('  Table', t + 1, ':', tables[t].rows.length, 'rows');
        for (let r = 0; r < Math.min(3, tables[t].rows.length); r++) {
            console.log('    ' + tables[t].rows[r].map(c => `"${c}"`).join(' | '));
        }
    }
}
