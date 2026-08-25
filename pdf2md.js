/* ============================================
   PDF -> Markdown — Conversion Engine v2
   Client-side PDF-to-Markdown with:
   - struct tree support  - column detection
   - grid-based tables    - global heading normalization
   - iframe mdv preview   - section breaks
   ============================================ */

(function () {
    'use strict';

    if (typeof pdfjsLib !== 'undefined') {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
    }

    // ── DOM References ──
    const $ = (s) => document.querySelector(s);
    const dropZone = $('#drop-zone');
    const fileInput = $('#file-input');
    const fileInfo = $('#file-info');
    const fileNameEl = $('#file-name');
    const fileSizeEl = $('#file-size');
    const pageCountEl = $('#page-count');
    const convertBtn = $('#convert-btn');
    const newPdfBtn = $('#new-pdf-btn');
    const pageCountBadge = $('#page-count-badge');
    const progressInline = $('#progress-inline');
    const progressSection = $('#progress-section');
    const progressBar = $('#progress-bar');
    const progressText = $('#progress-text');
    const outputSection = $('#output-section');
    const downloadBtn = $('#download-btn');
    const mdPreviewFrame = $('#md-preview-iframe');
    const hfPanel = $('#hf-panel');
    const hfPatterns = $('#hf-patterns');
    const hfCountBadge = $('#hf-count-badge');
    const hfAutoStatus = $('#hf-auto-status');
    const pagesPanel = $('#pages-panel');
    const sidebarThumbList = $('#sidebar-thumb-list');
    const sidebarToggleBtn = $('#sidebar-toggle-btn');
    const sidebar = $('#settings-sidebar');
    const backdrop = $('#mobile-sidebar-backdrop');

    const toastEl = $('#toast');

    // ── State ──
    let originalPdfBytes = null;
    let pdfJsDoc = null;
    let totalPages = 0;
    let fileName = 'document';
    let detectedHeaders = [];
    let detectedFooters = [];
    let excludedPatterns = new Set();
    let generatedMarkdown = '';
    let generatedImages = {};
    let isConverting = false;
    let globalFontMap = null; // size->level map from cross-page analysis
    let bodyFontSize = 12;

    // ═══════════════════════════════════════════════════
    // FILE HANDLING
    // ═══════════════════════════════════════════════════

    dropZone.onclick = () => fileInput.click();
    dropZone.ondragover = (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); };
    dropZone.ondragleave = () => dropZone.classList.remove('drag-over');
    dropZone.ondrop = (e) => {
        e.preventDefault(); dropZone.classList.remove('drag-over');
        if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
    };
    fileInput.onchange = (e) => { if (e.target.files.length > 0) handleFile(e.target.files[0]); };

    newPdfBtn.onclick = () => {
        originalPdfBytes = null; pdfJsDoc = null; totalPages = 0; fileName = 'document';
        detectedHeaders = []; detectedFooters = []; excludedPatterns = new Set();
        generatedMarkdown = ''; generatedImages = {}; globalFontMap = null;
        isConverting = false;
        fileInfo.style.display = 'none';
        // page preview already removed from main content
        progressSection.style.display = 'none';
        outputSection.style.display = 'none';
        outputSection.classList.remove('flex-grow');
        mdPreviewFrame.classList.remove('visible');
        mdPreviewFrame.src = 'mdv.html';
        // sidebarThumbList cleared above
        hfPatterns.innerHTML = '';
        hfPanel.classList.add('collapsed');
        hfCountBadge.style.display = 'none';
        hfAutoStatus.textContent = 'Auto-detecting…';
        pagesPanel.classList.add('collapsed');
        sidebarThumbList.innerHTML = '';
        pageCountEl.textContent = '0 Pages';
        pageCountBadge.style.display = 'none';
        pageCountBadge.textContent = '0 Pages';
        $('#stat-pages').textContent = '0 pp';
        $('#stat-images').textContent = '0 img';
        $('#stat-tables').textContent = '0 tbl';
        $('#stat-size').textContent = '0 KB';
        convertBtn.style.display = 'none';
        newPdfBtn.classList.add('hidden');
        progressInline.style.display = 'none';
        $('#opt-include-hf').checked = false;
        dropZone.style.display = '';
        dropZone.classList.remove('drag-over');
        progressBar.style.width = '0%';
    };

    async function handleFile(file) {
        if (file.type !== 'application/pdf') { showToast('Please upload a PDF file.', true); return; }
        if (isConverting) { showToast('Conversion in progress — please wait.', true); return; }

        newPdfBtn.onclick(); // full reset first
        fileName = file.name.replace(/\.pdf$/i, '');
        fileNameEl.textContent = file.name;
        fileSizeEl.textContent = (file.size / (1024 * 1024)).toFixed(2) + ' MB';

        try {
            originalPdfBytes = await file.arrayBuffer();
            pdfJsDoc = await pdfjsLib.getDocument({ data: new Uint8Array(originalPdfBytes) }).promise;
            totalPages = pdfJsDoc.numPages;
            pageCountEl.textContent = totalPages + (totalPages === 1 ? ' Page' : ' Pages');
            pageCountBadge.textContent = totalPages + (totalPages === 1 ? ' Page' : ' Pages');
            pageCountBadge.style.display = 'inline';

            fileInfo.style.display = 'flex';
            // page preview removed — thumbnails in sidebar only
            convertBtn.style.display = '';
            newPdfBtn.classList.remove('hidden');
            dropZone.style.display = 'none';

            // Global font analysis (pass 1)
            await globalFontAnalysis();

            // Pre-analyze for headers/footers
            await preAnalyze();

            // Render thumbnails
            await renderThumbnails();
        } catch (err) {
            console.error(err);
            showToast('Error loading PDF. It may be encrypted or corrupted.', true);
            newPdfBtn.onclick();
        }
    }

    // ═══════════════════════════════════════════════════
    // GLOBAL FONT ANALYSIS (Cross-page normalization)
    // ═══════════════════════════════════════════════════

    async function globalFontAnalysis() {
        const sizeCharCount = {};
        let totalChars = 0;

        for (let i = 1; i <= totalPages; i++) {
            const page = await pdfJsDoc.getPage(i);
            const tc = await page.getTextContent();
            for (const item of tc.items) {
                if (!item.str || !item.str.trim()) continue;
                const size = Math.round(item.height * 10) / 10;
                const chars = item.str.trim().length;
                sizeCharCount[size] = (sizeCharCount[size] || 0) + chars;
                totalChars += chars;
            }
        }

        // Body font = size with most characters
        bodyFontSize = 12;
        let maxCount = 0;
        for (const [size, count] of Object.entries(sizeCharCount)) {
            if (count > maxCount) { maxCount = count; bodyFontSize = parseFloat(size); }
        }

        // Collect heading candidates (>= 1.08x body)
        let headingSizes = Object.keys(sizeCharCount)
            .map(Number)
            .filter(s => s > bodyFontSize * 1.08)
            .sort((a, b) => b - a);

        // Merge nearby sizes (+-3%)
        headingSizes = mergeSizes(headingSizes, 0.03);
        headingSizes = headingSizes.slice(0, 6); // max 6 heading levels

        // Map sizes to heading levels
        globalFontMap = {};
        const levels = ['#', '##', '###', '####', '#####', '######'];
        headingSizes.forEach((size, i) => {
            globalFontMap[size] = levels[i];
        });
    }

    function mergeSizes(sizes, tolerance) {
        if (sizes.length <= 1) return sizes;
        const merged = [sizes[0]];
        for (let i = 1; i < sizes.length; i++) {
            const prev = merged[merged.length - 1];
            if (Math.abs(sizes[i] - prev) / prev < tolerance) continue; // skip, keep prev
            merged.push(sizes[i]);
        }
        return merged;
    }

    function getHeadingLevel(fontSize) {
        if (!globalFontMap) return null;
        // Find closest mapped size
        let bestSize = null;
        let bestDiff = Infinity;
        for (const sizeStr of Object.keys(globalFontMap)) {
            const size = parseFloat(sizeStr);
            const diff = Math.abs(fontSize - size);
            if (diff < bestDiff) { bestDiff = diff; bestSize = size; }
        }
        if (bestSize !== null && bestDiff / bodyFontSize < 0.1) {
            return globalFontMap[bestSize];
        }
        return null;
    }

    // ═══════════════════════════════════════════════════
    // PRE-ANALYSIS: Headers & Footers
    // ═══════════════════════════════════════════════════

    async function preAnalyze() {
        const allPageContents = [];
        let pageHeight = 0;
        for (let i = 1; i <= totalPages; i++) {
            const page = await pdfJsDoc.getPage(i);
            const vp = page.getViewport({ scale: 1.0 });
            if (i === 1) pageHeight = vp.height;
            allPageContents.push({ textContent: await page.getTextContent(), pageHeight: vp.height, pageNum: i });
        }
        const result = detectRepeatedHeadersFooters(allPageContents, pageHeight);
        detectedHeaders = result.headers;
        detectedFooters = result.footers;

        const totalPatterns = detectedHeaders.length + detectedFooters.length;
        if (totalPatterns > 0) {
            $('#opt-include-hf').checked = false;
            hfAutoStatus.textContent = totalPatterns + ' pattern' + (totalPatterns > 1 ? 's' : '') + ' found';
            hfPanel.classList.remove('collapsed');
            hfCountBadge.textContent = totalPatterns;
            hfCountBadge.style.display = '';
            renderHFPreview();
        } else {
            hfAutoStatus.textContent = 'None detected';
            hfPanel.classList.add('collapsed');
            hfCountBadge.style.display = 'none';
        }
    }

    function detectRepeatedHeadersFooters(allPageContents, pageHeight) {
        const threshold = 0.4;
        const topZone = pageHeight * 0.92;
        const bottomZone = pageHeight * 0.08;
        const headerItems = {}, footerItems = {};

        for (const { textContent, pageNum } of allPageContents) {
            for (const item of textContent.items) {
                if (!item.str || !item.str.trim()) continue;
                const y = item.transform[5], text = item.str.trim();
                if (y > topZone) {
                    if (!headerItems[text]) headerItems[text] = [];
                    headerItems[text].push(pageNum);
                } else if (y < bottomZone) {
                    if (!footerItems[text]) footerItems[text] = [];
                    footerItems[text].push(pageNum);
                }
            }
        }

        const headers = Object.entries(headerItems)
            .filter(([, pages]) => pages.length / totalPages >= threshold)
            .map(([text, pages]) => ({ text, pages, zone: 'header' }));
        const footers = Object.entries(footerItems)
            .filter(([, pages]) => pages.length / totalPages >= threshold)
            .map(([text, pages]) => ({ text, pages, zone: 'footer' }));

        return { headers, footers };
    }

    function renderHFPreview() {
        hfPatterns.innerHTML = '';
        const allPatterns = [...detectedHeaders, ...detectedFooters];
        if (allPatterns.length === 0) return;

        allPatterns.forEach((p, idx) => {
            const isExcluded = !$('#opt-include-hf').checked;
            excludedPatterns.add(idx);
            const div = document.createElement('div');
            div.className = 'sidebar-hf-item';
            div.innerHTML = '<span class="hf-zone-badge ' + p.zone + '">' + p.zone + '</span>'
                + '<span class="sidebar-hf-text" title="' + escHtml(p.text) + '">' + escHtml(p.text) + '</span>'
                + '<span class="toggle"><input type="checkbox" data-hf-idx="' + idx + '" ' + (isExcluded ? '' : 'checked') + '><span class="toggle-slider"></span></span>';
            hfPatterns.appendChild(div);
        });

        hfPatterns.querySelectorAll('input[data-hf-idx]').forEach(input => {
            input.addEventListener('change', () => {
                const idx = parseInt(input.dataset.hfIdx);
                if (input.checked) excludedPatterns.delete(idx); else excludedPatterns.add(idx);
            });
        });
    }

    // ═══════════════════════════════════════════════════
    // THUMBNAILS (sidebar only)
    // ═══════════════════════════════════════════════════

    async function renderThumbnails() {
        sidebarThumbList.innerHTML = '';
        const maxThumbs = Math.min(totalPages, 50);

        for (let i = 1; i <= maxThumbs; i++) {
            const page = await pdfJsDoc.getPage(i);
            const viewport = page.getViewport({ scale: 0.2 });
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width; canvas.height = viewport.height;
            const ctx = canvas.getContext('2d');
            await page.render({ canvasContext: ctx, viewport }).promise;
            const sCanvas = document.createElement('canvas');
            sCanvas.width = 40; sCanvas.height = 56;
            const sCtx = sCanvas.getContext('2d');
            sCtx.drawImage(canvas, 0, 0, 40, 56);
            const sItem = document.createElement('div'); sItem.className = 'sidebar-thumb-item';
            sItem.innerHTML = '<span>' + i + '</span>';
            sItem.insertBefore(sCanvas, sItem.firstChild);
            sItem.title = 'Page ' + i;
            sidebarThumbList.appendChild(sItem);
        }

        if (totalPages > 0) pagesPanel.classList.remove('collapsed');
    }


    // ═══════════════════════════════════════════════════
    // STRUCT TREE CONVERSION (primary path)
    // ═══════════════════════════════════════════════════

    async function tryStructTreeConversion(pdfDoc, pageNum) {
        const page = await pdfDoc.getPage(pageNum);
        const structTree = await page.getStructTree();
        if (!structTree) return null;

        const tc = await page.getTextContent({ includeMarkedContent: true });
        const idMap = buildIdMap(tc);
        const md = walkStructTree(structTree, idMap, 0);
        return md ? md.trim() : null;
    }

    function buildIdMap(textContent) {
        const map = {};
        let currentId = null;
        for (const item of textContent.items) {
            if (item.type === 'beginMarkedContentProps' || item.type === 'beginMarkedContent') {
                currentId = item.id || null;
            } else if (item.type === 'endMarkedContent') {
                currentId = null;
            } else if (currentId && item.str !== undefined) {
                if (!map[currentId]) map[currentId] = '';
                map[currentId] += item.str;
            } else if (item.str !== undefined) {
                // Unmarked content — append to last known id
                if (currentId) { if (!map[currentId]) map[currentId] = ''; map[currentId] += item.str; }
            }
        }
        return map;
    }

    function walkStructTree(node, idMap, depth) {
        if (!node) return '';
        if (depth > 120) return ''; // safety limit
        if (node.type === 'content') {
            return (idMap[node.id] || '').replace(/\s+/g, ' ').trim();
        }

        const children = node.children || [];
        const childTexts = children.map(c => walkStructTree(c, idMap, depth + 1)).filter(Boolean);
        const text = childTexts.join(' ');
        if (!text) return '';

        const role = node.role || '';
        // Section boundaries
        if (/^(Sect|Part|Art|Div)$/i.test(role)) {
            let result = '';
            for (const c of children) {
                const ct = walkStructTree(c, idMap, depth + 1);
                if (ct) result += ct + '\n\n';
            }
            return '\n---\n\n' + result.trim();
        }
        // Headings
        const hMatch = role.match(/^H(\d)$/i);
        if (hMatch) {
            const level = parseInt(hMatch[1]);
            return '#'.repeat(Math.min(level, 6)) + ' ' + text + '\n';
        }
        // Lists
        if (/^L$/i.test(role)) {
            let result = '';
            for (const c of children) {
                const ct = walkStructTree(c, idMap, depth + 1);
                if (ct) result += ct + '\n';
            }
            return result.trim();
        }
        if (/^LI$/i.test(role)) {
            let marker = '-';
            let body = '';
            for (const c of children) {
                const childRole = (c.role || '');
                if (/^Lbl$/i.test(childRole)) {
                    const lbl = walkStructTree(c, idMap, depth + 1);
                    marker = lbl || '-';
                } else if (/^LBody$/i.test(childRole)) {
                    body = walkStructTree(c, idMap, depth + 1);
                } else {
                    const ct = walkStructTree(c, idMap, depth + 1);
                    if (ct) body += (body ? ' ' : '') + ct;
                }
            }
            return '  '.repeat(depth) + marker.trim() + ' ' + body.trim();
        }
        // Tables
        if (/^(THead|TBody|TFoot)$/i.test(role)) {
            const rows = [];
            for (const c of children) {
                const ct = walkStructTree(c, idMap, depth + 1);
                if (ct) rows.push(ct);
            }
            return rows.join('\n');
        }
        if (/^Table$/i.test(role)) {
            // Walk all children and collect cell/row data
            const rawResults = [];
            for (const c of children) {
                const childRole = (c.role || '');
                // Skip Caption/Title children
                if (/^(Caption|Title|TOC|TOCI)$/i.test(childRole)) continue;
                const ct = walkStructTree(c, idMap, depth + 1);
                if (ct) rawResults.push({ text: ct, role: childRole });
            }
            if (rawResults.length === 0) return '';

            // Check if results contain pipe-delimited rows (from TR children)
            const pipeRows = rawResults.flatMap(r => r.text.split('\n').filter(l => l.trim().startsWith('|')));
            if (pipeRows.length >= 2) {
                const headerCells = pipeRows[0].split('|').filter(c => c.trim()).length;
                const sep = '| ' + Array(headerCells || 1).fill('---').join(' | ') + ' |';
                return pipeRows[0] + '\n' + sep + '\n' + pipeRows.slice(1).join('\n');
            }

            // Flat TH/TD children without TR wrapper — group by TH header row then TD data rows
            const thItems = rawResults.filter(r => /^TH$/i.test(r.role));
            const tdItems = rawResults.filter(r => /^TD$/i.test(r.role));
            if (thItems.length > 0 || tdItems.length > 0) {
                // Estimate column count from TH items
                const colCount = thItems.length || 3;
                let md = '';
                if (thItems.length > 0) {
                    md += '| ' + thItems.map(r => r.text.trim()).join(' | ') + ' |\n';
                    md += '| ' + Array(thItems.length).fill('---').join(' | ') + ' |\n';
                }
                // Group TD items into rows
                for (let i = 0; i < tdItems.length; i += colCount) {
                    const rowCells = tdItems.slice(i, i + colCount);
                    md += '| ' + rowCells.map(r => r.text.trim()).join(' | ') + ' |\n';
                }
                return md.trim();
            }

            // Fallback: just join as paragraphs
            return rawResults.map(r => r.text).join('\n');
        }
        if (/^TR$/i.test(role)) {
            const cells = children.map(c => walkStructTree(c, idMap, depth + 1)).filter(Boolean);
            if (cells.length === 0) return '';
            return '| ' + cells.map(c => c.replace(/\|/g, '\\|').trim()).join(' | ') + ' |';
        }
        if (/^(TH|TD)$/i.test(role)) {
            const parts = children.map(c => walkStructTree(c, idMap, depth + 1)).filter(Boolean);
            return parts.join(' ').trim();
        }
        // Caption/Title/TOC — skip decorative labels
        if (/^(Caption|Title|TOC|TOCI)$/i.test(role)) return '';
        // Figure
        if (/^Figure$/i.test(role)) return '![Figure](' + text + ')';
        // Formula
        if (/^Formula$/i.test(role)) return '$$\n' + text + '\n$$';

        // Default: paragraph
        return text + '\n';
    }

    // ═══════════════════════════════════════════════════
    // LINE RECONSTRUCTION (with column detection)
    // ═══════════════════════════════════════════════════

    function reconstructLines(textContent, pageHeight, excludeHFGlobals, excludedTexts) {
        const items = textContent.items.filter(it => it.str !== undefined);
        if (items.length === 0) return [];

        const excludedSet = excludedTexts instanceof Set ? excludedTexts : new Set();

        const filtered = items.filter(item => {
            const y = item.transform[5];
            const text = (item.str || '').trim();
            if (!text) return false;
            if (excludeHFGlobals) {
                if (y > pageHeight * 0.92 || y < pageHeight * 0.08) return false;
            }
            if (excludedSet.size > 0 && excludedSet.has(text)) return false;
            return true;
        });
        if (filtered.length === 0) return [];

        // ── Column detection ──
        const xPositions = filtered.map(it => Math.round(it.transform[4] / 5) * 5);
        const xClusters = clusterValues(xPositions, 5);
        const columns = xClusters.filter(c => c.count >= 2 && c.items.length >= 3)
            .sort((a, b) => a.center - b.center);

        let itemsByColumn;
        if (columns.length >= 2) {
            itemsByColumn = columns.map(() => []);
            filtered.forEach(item => {
                const x = item.transform[4];
                let bestCol = 0, bestDist = Infinity;
                columns.forEach((col, ci) => {
                    const dist = Math.abs(x - col.center);
                    if (dist < bestDist) { bestDist = dist; bestCol = ci; }
                });
                itemsByColumn[bestCol].push(item);
            });
        } else {
            itemsByColumn = [filtered];
        }

        // Build lines per column, then interleave
        const allColumnLines = itemsByColumn.map(colItems => buildLines(colItems));
        return interleaveColumns(allColumnLines);
    }

    function clusterValues(values, tolerance) {
        const sorted = [...values].sort((a, b) => a - b);
        const clusters = [];
        for (const v of sorted) {
            let found = false;
            for (const c of clusters) {
                if (Math.abs(v - c.center) <= tolerance) {
                    c.count++; c.items.push(v); c.center = Math.round(c.items.reduce((a, b) => a + b, 0) / c.items.length);
                    found = true; break;
                }
            }
            if (!found) clusters.push({ center: v, count: 1, items: [v] });
        }
        // Merge nearby clusters
        for (let i = clusters.length - 1; i >= 0; i--) {
            for (let j = i - 1; j >= 0; j--) {
                if (Math.abs(clusters[i].center - clusters[j].center) < 20) {
                    clusters[j].count += clusters[i].count;
                    clusters[j].items.push(...clusters[i].items);
                    clusters[j].center = Math.round(clusters[j].items.reduce((a, b) => a + b, 0) / clusters[j].items.length);
                    clusters.splice(i, 1); break;
                }
            }
        }
        return clusters;
    }

    function buildLines(items) {
        if (items.length === 0) return [];
        const sorted = items.slice().sort((a, b) => {
            const yA = a.transform[5], yB = b.transform[5];
            if (Math.abs(yA - yB) > 2) return yB - yA;
            return a.transform[4] - b.transform[4];
        });

        const lines = [];
        let currentLine = [sorted[0]];
        let currentY = sorted[0].transform[5];

        for (let i = 1; i < sorted.length; i++) {
            const y = sorted[i].transform[5];
            if (Math.abs(y - currentY) > 2) {
                lines.push(buildLineString(currentLine));
                currentLine = [sorted[i]]; currentY = y;
            } else { currentLine.push(sorted[i]); }
        }
        if (currentLine.length > 0) lines.push(buildLineString(currentLine));
        return lines.filter(l => l.text.trim().length > 0);
    }

    function buildLineString(items) {
        if (items.length === 0) return { text: '', x: 0, y: 0, fontSize: 0, items };
        items.sort((a, b) => a.transform[4] - b.transform[4]);
        let text = '', lastEnd = null;
        for (const item of items) {
            const x = item.transform[4];
            if (lastEnd !== null) { const gap = x - lastEnd; if (gap > 2.5) text += ' '; }
            text += item.str;
            lastEnd = x + (item.width || 0);
        }
        return { text, x: items[0].transform[4], y: items[0].transform[5], fontSize: items[0].height, items };
    }

    function interleaveColumns(columnLines) {
        if (columnLines.length === 1) return columnLines[0];
        // Simple strategy: sort all lines across all columns by Y, output top-to-bottom
        const allLines = [];
        columnLines.forEach((lines, colIdx) => {
            lines.forEach(line => { allLines.push({ ...line, _col: colIdx }); });
        });
        allLines.sort((a, b) => b.y - a.y); // descending Y = top first
        return allLines;
    }

    // ═══════════════════════════════════════════════════
    // STRUCTURE DETECTION (heuristic fallback)
    // ═══════════════════════════════════════════════════

    function detectLineType(line, prevLine, prevStructured, allLines, idx) {
        const text = line.text.trim();
        if (!text) return { type: 'empty' };

        const fontSize = line.fontSize;
        const ratio = fontSize / bodyFontSize;

        // ── Heading (global font map) ──
        const globalLevel = getHeadingLevel(fontSize);
        if (globalLevel && text.length < 120) {
            return { type: 'heading', level: globalLevel, text };
        }

        // ── Heading (ratio-based fallback) ──
        if (ratio > 1.3 && text.length < 120) {
            if (ratio >= 2.0) return { type: 'heading', level: '#', text };
            if (ratio >= 1.6) return { type: 'heading', level: '##', text };
            if (ratio >= 1.35) return { type: 'heading', level: '###', text };
            return { type: 'heading', level: '####', text };
        }

        // ── Section break (large gap) ──
        if (prevLine) {
            const gap = prevLine.y - line.y - line.fontSize;
            const normalGap = bodyFontSize * 1.4;
            if (gap > normalGap * 2.5) {
                return { type: 'section-break' };
            }
        }

        // ── Chapter marker ──
        if (/^(Chapter|Section|Part)\s+\d+/i.test(text)) {
            return { type: 'heading', level: '##', text };
        }

        // ── Horizontal rule ──
        if (/^[\-\*_]{3,}\s*$/.test(text)) return { type: 'hr' };

        // ── Lists ──
        const bulletMatch = text.match(/^([\u2022\u25CF\u25A0\u25AA\u25E6\u2023\u2043\-\u2013\u2014\*])\s+(.+)/);
        if (bulletMatch) {
            return { type: 'bullet', marker: '-', text: bulletMatch[2], indent: getIndentLevel(line) };
        }
        const numMatch = text.match(/^(\d{1,3}[.)]\s+)(.+)/);
        if (numMatch) {
            return { type: 'numbered', marker: numMatch[1].trim(), text: numMatch[2], indent: getIndentLevel(line) };
        }
        const letterMatch = text.match(/^([a-z][.)]\s+)(.+)/i);
        if (letterMatch) {
            return { type: 'numbered', marker: letterMatch[1].trim(), text: letterMatch[2], indent: getIndentLevel(line) };
        }

        // ── Grid-based table detection ──
        if (detectTableRow(line, allLines, idx)) {
            return { type: 'table-grid-row', text: line.text, x: line.x, y: line.y, items: line.items };
        }

        return { type: 'paragraph', text };
    }

    function getIndentLevel(line) {
        const typicalIndent = 36; // PDF units per indent level
        return Math.max(0, Math.floor((line.x - 60) / typicalIndent));
    }

    function detectTableRow(line, allLines, idx) {
        if (!line.items || line.items.length < 2) return false;
        // Count distinct X-cluster groups in this line
        const xs = line.items.map(it => it.transform[4]);
        const gaps = [];
        for (let i = 1; i < xs.length; i++) {
            gaps.push(xs[i] - xs[i - 1]);
        }
        // Large horizontal gaps between items suggest table cells
        const largeGaps = gaps.filter(g => g > 10).length;
        if (largeGaps < 1) return false;
        // Loosened: any 1 of the 4 neighbors with ANY multi-column layout counts
        // This catches tables in mixed pages (e.g. 4-page vocabulary tables with
        // occasional single-column paragraphs between rows).
        let neighborMatch = 0;
        for (let j = Math.max(0, idx - 2); j <= Math.min(allLines.length - 1, idx + 2); j++) {
            if (j === idx) continue;
            const nline = allLines[j];
            if (nline.items && nline.items.length >= 2) {
                const nxs = nline.items.map(it => it.transform[4]);
                const ngaps = [];
                for (let k = 1; k < nxs.length; k++) ngaps.push(nxs[k] - nxs[k - 1]);
                if (ngaps.filter(g => g > 10).length >= 1) neighborMatch++;
            }
        }
        return neighborMatch >= 1;
    }

    // ═══════════════════════════════════════════════════
    // MARKDOWN GENERATION
    // ═══════════════════════════════════════════════════

    function linesToMarkdown(lines) {
        const structured = [];
        for (let i = 0; i < lines.length; i++) {
            const prev = i > 0 ? lines[i - 1] : null;
            structured.push(detectLineType(lines[i], prev, null, lines, i));
        }

        const md = [];
        let paraLines = [];
        let lastOutput = '';

        function flushPara() {
            if (paraLines.length > 0) {
                const p = paraLines.join('\n');
                if (lastOutput !== '---' || p.trim()) md.push(p);
                paraLines = [];
            }
        }

        for (let i = 0; i < structured.length; i++) {
            const s = structured[i];

            if (s.type === 'empty') { flushPara(); continue; }
            if (s.type === 'section-break') { flushPara(); if (lastOutput !== '---') { md.push('---'); lastOutput = '---'; } continue; }
            if (s.type === 'heading') { flushPara(); md.push(s.level + ' ' + s.text); lastOutput = s.level; continue; }
            if (s.type === 'hr') { flushPara(); md.push('---'); lastOutput = '---'; continue; }
            if (s.type === 'bullet') { flushPara(); const ind = '  '.repeat(s.indent || 0); md.push(ind + '- ' + s.text); lastOutput = 'bullet'; continue; }
            if (s.type === 'numbered') { flushPara(); const ind = '  '.repeat(s.indent || 0); md.push(ind + s.marker + ' ' + s.text); lastOutput = 'numbered'; continue; }

            // Grid-based table rows — collect consecutive table rows
            if (s.type === 'table-grid-row') {
                flushPara();
                const tableRows = [];
                let j = i;
                while (j < structured.length && structured[j].type === 'table-grid-row') {
                    const line = structured[j];
                    // Split items into cells by X gaps
                    const items = (line.items || []).slice().sort((a, b) => a.transform[4] - b.transform[4]);
                    const cells = [];
                    let cellText = '';
                    let lastEnd = null;
                    for (const it of items) {
                        const x = it.transform[4];
                        if (lastEnd !== null && x - lastEnd > 10) {
                            cells.push(cellText.trim());
                            cellText = '';
                        }
                        cellText += it.str;
                        lastEnd = x + (it.width || 0);
                    }
                    if (cellText.trim()) cells.push(cellText.trim());
                    tableRows.push(cells);
                    j++;
                }
                // Emit as markdown table
                if (tableRows.length > 0) {
                    const colCount = Math.max(...tableRows.map(r => r.length));
                    // First row as header
                    const padded = tableRows[0].concat(Array(Math.max(0, colCount - tableRows[0].length)).fill(''));
                    md.push('| ' + padded.join(' | ') + ' |');
                    md.push('| ' + Array(colCount).fill('---').join(' | ') + ' |');
                    for (let r = 1; r < tableRows.length; r++) {
                        const padded = tableRows[r].concat(Array(Math.max(0, colCount - tableRows[r].length)).fill(''));
                        md.push('| ' + padded.join(' | ') + ' |');
                    }
                }
                i = j - 1;
                continue;
            }

            // paragraph
            paraLines.push(s.text);
            lastOutput = 'para';
        }
        flushPara();

        return md;
    }

    // ═══════════════════════════════════════════════════
    // GRID-BASED TABLE DETECTOR (Nurminen-style fallback)
    // ═══════════════════════════════════════════════════
    // This is the fallback used when the Struct Tree fails to produce proper
    // table rows (e.g. PDFs that report a "Table" role but ship flat
    // paragraphs in the cell positions, or untagged PDFs altogether).
    //
    // Adapted from pdfplumber's TableFinder (Nurminen 2003 algorithm):
    //   1. Group text items by Y to form lines.
    //   2. Cluster X positions within each line to find cells.
    //   3. Find the modal cell count (the column count of the table).
    //   4. Group consecutive lines with that cell count into tables.
    //   5. Emit as Markdown tables.
    //
    // Returns an array of { lines: string[][], startY, endY }.

    function detectGridTables(items) {
        console.log('[grid] detectGridTables called with', items.length, 'items');
        // Filter to text items with non-empty strings
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
        // Log first 3 items so we can see the actual shape
        console.log('[grid] first 3 items:', txtItems.slice(0, 3).map(it => ({
            str: it.str.slice(0, 30),
            x: it.transform[4]?.toFixed(1),
            y: it.transform[5]?.toFixed(1),
            w: it.width?.toFixed(1)
        })));
        console.log('[pdf2md] detectGridTables: processing', txtItems.length, 'text items');

        // Sort by Y descending (top of page first)
        const sortedByY = txtItems.slice().sort((a, b) => b.transform[5] - a.transform[5]);

        // Adaptive Y tolerance: find the modal (most common) Y diff between
        // consecutive items. This is the dominant line height in the page.
        // The tolerance is set to slightly less than the modal inter-line
        // gap, which lets us group items in the same visual row (which can
        // be 1 line height apart when one column wraps) while still
        // separating consecutive table rows.
        const yDiffs = [];
        for (let i = 1; i < sortedByY.length; i++) {
            const diff = Math.abs(sortedByY[i].transform[5] - sortedByY[i - 1].transform[5]);
            if (diff > 0.1) yDiffs.push(diff);
        }
        // Round to 1 decimal place so similar diffs cluster.
        const rounded = yDiffs.map(d => Math.round(d * 10) / 10);
        const counts = {};
        let modalDiff = 0, modalCount = 0;
        for (const d of rounded) {
            counts[d] = (counts[d] || 0) + 1;
            if (counts[d] > modalCount) { modalCount = counts[d]; modalDiff = d; }
        }
        // Tolerance: 0.9 × modal diff. This groups items that are within
        // ~1 line of each other (intra-row), but separates items >1 line
        // apart (inter-row). The 0.9 leaves a small safety margin.
        const yTolerance = Math.max(2, modalDiff * 0.9);
        console.log('[pdf2md] detectGridTables: modal Y diff =', modalDiff.toFixed(2), 'yTolerance =', yTolerance.toFixed(2));

        // Step 1: group by Y (within tolerance)
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

        if (lineGroups.length < 2) {
            console.log('[pdf2md] detectGridTables: too few line groups');
            console.log('[pdf2md] First 10 Y values:', sortedByY.slice(0, 10).map(i => i.transform[5].toFixed(1)).join(','));
            return [];
        }

        // Step 2: cluster X positions per line to find cells.
        // We use a per-line adaptive gap: 60% of the median X gap between
        // consecutive items in the line, clamped to [4, 30]. This means
        // adjacent items are different cells only if there's a "big" gap
        // relative to the line's own spacing.
        const lineCells = lineGroups.map(group => {
            const sorted = group.items.slice().sort((a, b) => a.transform[4] - b.transform[4]);
            // Compute per-line adaptive gap threshold.
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

        // Step 3: find modal cell count (excluding single-cell lines)
        const cellCounts = lineCells.map(l => l.cells.length);
        const multiCellCounts = cellCounts.filter(c => c > 1);
        console.log('[pdf2md] detectGridTables:', lineGroups.length, 'line groups, cell counts:', cellCounts.join(','));
        if (multiCellCounts.length < 2) {
            console.log('[pdf2md] detectGridTables: fewer than 2 multi-cell lines, bailing');
            return [];
        }

        const modalCellCount = mode(multiCellCounts);
        console.log('[pdf2md] detectGridTables: modal cell count =', modalCellCount);
        if (modalCellCount < 2) return [];

        // Step 4: group consecutive lines with modal count into tables
        const tables = [];
        let currentTable = [];
        for (let i = 0; i < lineCells.length; i++) {
            if (lineCells[i].cells.length === modalCellCount) {
                currentTable.push(lineCells[i]);
            } else {
                if (currentTable.length >= 2) {
                    tables.push({
                        rows: currentTable.map(l => l.cells),
                        startY: currentTable[0].y,
                        endY: currentTable[currentTable.length - 1].y
                    });
                }
                currentTable = [];
            }
        }
        if (currentTable.length >= 2) {
            tables.push({
                rows: currentTable.map(l => l.cells),
                startY: currentTable[0].y,
                endY: currentTable[currentTable.length - 1].y
            });
        }

        return tables;
    }

    function mode(arr) {
        if (!arr || arr.length === 0) return null;
        const counts = {};
        let maxCount = 0;
        let maxVal = arr[0];
        for (const v of arr) {
            counts[v] = (counts[v] || 0) + 1;
            if (counts[v] > maxCount) {
                maxCount = counts[v];
                maxVal = v;
            }
        }
        return maxVal;
    }

    // Render grid-detected tables as a list of markdown table strings.
    function gridTablesToMarkdown(tables) {
        return tables.map(t => {
            if (t.rows.length === 0) return '';
            const colCount = t.rows[0].length;
            const md = [];
            // First row as header
            const headerRow = t.rows[0].concat(Array(Math.max(0, colCount - t.rows[0].length)).fill(''));
            md.push('| ' + headerRow.map(c => String(c || '').replace(/\|/g, '\\|').trim()).join(' | ') + ' |');
            md.push('| ' + Array(colCount).fill('---').join(' | ') + ' |');
            for (let r = 1; r < t.rows.length; r++) {
                const padded = t.rows[r].concat(Array(Math.max(0, colCount - t.rows[r].length)).fill(''));
                md.push('| ' + padded.map(c => String(c || '').replace(/\|/g, '\\|').trim()).join(' | ') + ' |');
            }
            return md.join('\n');
        });
    }

    // Replace the broken "joined as paragraphs" cell text in a struct
    // tree page with grid-detected tables, preserving all other content
    // (prose, headings, etc.) in their original order.
    //
    // Strategy: find each `### Table: ...` heading (or similar). The
    // broken-as-paragraphs cell text is the long block of single-item
    // lines between this heading and the next heading. Replace that
    // region with the next grid table(s). If multiple grid tables were
    // detected, they go in their natural order, separated by blank
    // lines.
    function replaceTableRegionInStructMd(structMd, gridTables) {
        if (!structMd || !gridTables || gridTables.length === 0) return structMd;
        const tableMd = gridTablesToMarkdown(gridTables);
        if (tableMd.length === 0) return structMd;

        const lines = structMd.split('\n');
        const TABLE_HEADING_RE = /^\s*#{1,6}\s+.*\btable\b/i;
        const HEADING_RE = /^\s*#{1,6}\s+/;

        // Find indices of all headings and the table-bearing ones.
        const headingIdxs = [];
        for (let i = 0; i < lines.length; i++) {
            if (HEADING_RE.test(lines[i])) headingIdxs.push(i);
        }
        const tableHeadingIdxs = headingIdxs.filter(i => TABLE_HEADING_RE.test(lines[i]));

        // For each table-bearing heading, find the next heading. The
        // region between the table-heading+1 and the next heading is
        // the "joined as paragraphs" cell text. Replace it with the
        // first grid table.
        const linesToRemove = new Set();
        const replacement = new Map(); // line index → grid table markdown
        let tableIdx = 0;
        for (const thIdx of tableHeadingIdxs) {
            const nextIdx = headingIdxs.find(h => h > thIdx);
            const endIdx = nextIdx !== undefined ? nextIdx : lines.length;
            // Find the first non-empty line after the heading.
            let contentStart = thIdx + 1;
            while (contentStart < endIdx && !lines[contentStart].trim()) contentStart++;
            // Mark content lines for removal.
            for (let i = contentStart; i < endIdx; i++) linesToRemove.add(i);
            // Map the table-heading line index to the replacement markdown.
            if (tableIdx < tableMd.length) {
                replacement.set(thIdx, tableMd[tableIdx]);
                tableIdx++;
            }
        }

        // Rebuild the markdown.
        const out = [];
        for (let i = 0; i < lines.length; i++) {
            if (linesToRemove.has(i)) continue;
            out.push(lines[i]);
            // After a table heading, insert the replacement (if any).
            if (replacement.has(i)) {
                out.push('');
                out.push(replacement.get(i));
            }
        }

        // Append any remaining grid tables at the very end of the page
        // (this shouldn't normally happen, but it's a safety net).
        let result = out.join('\n');
        if (tableIdx < tableMd.length) {
            result = result.trimEnd() + '\n\n' + tableMd.slice(tableIdx).join('\n\n') + '\n';
        }
        return result;
    }

    // Splice grid-detected tables into a struct-tree markdown page.
    // Strategy: when the struct tree has a Table role with no proper TR/TD
    // children, the walker falls through to "join as paragraphs", producing
    // one cell per line. We rebuild the page by:
    //   1. Extracting all headings (and any non-table content like dates)
    //      from the struct tree.
    //   2. Inserting the grid tables after headings that mention "table"
    //      (or simply after all extracted content if no table heading).
    //   3. Returning the rebuilt markdown.
    function spliceGridTablesIntoStructMd(structMd, gridTables) {
        if (!structMd || !gridTables || gridTables.length === 0) return structMd;
        const tableMd = gridTablesToMarkdown(gridTables);
        if (tableMd.length === 0) return structMd;

        const lines = structMd.split('\n');

        // Step 1: collect all non-empty lines and identify which headings
        // are table-bearing. Non-table content (paragraphs that aren't
        // table cells) is preserved verbatim. Table content (long stretches
        // of single-word lines under a "Table" heading) is replaced.
        const TABLE_HEADING_RE = /^\s*#{1,6}\s+.*\btable\b/i;

        // Find the indices of table-bearing headings.
        const tableHeadingIdxs = [];
        const headingIdxs = [];
        for (let i = 0; i < lines.length; i++) {
            if (/^\s*#{1,6}\s+/.test(lines[i])) {
                headingIdxs.push(i);
                if (TABLE_HEADING_RE.test(lines[i])) tableHeadingIdxs.push(i);
            }
        }

        // For each table-bearing heading, find the region of content under
        // it (until the next heading). Replace the table-region content
        // (the long block of single-line cells) with grid tables.
        const regionsToReplace = new Map(); // startIdx → count of lines to remove
        for (const startIdx of tableHeadingIdxs) {
            // Find the next heading index.
            const nextIdx = headingIdxs.find(h => h > startIdx);
            const endIdx = nextIdx !== undefined ? nextIdx : lines.length;
            // Find the first non-empty line after the heading.
            let contentStart = startIdx + 1;
            while (contentStart < endIdx && !lines[contentStart].trim()) contentStart++;
            // Skip leading content (e.g. the date "2026" line that might
            // appear right after the heading). We treat the region from
            // contentStart to endIdx as table content.
            if (contentStart < endIdx) {
                regionsToReplace.set(contentStart, endIdx - contentStart);
            }
        }

        // Step 2: rebuild the markdown.
        // We iterate through lines. When we hit a region to replace, we
        // emit grid tables (one per detected table, or as many as fit).
        const out = [];
        let tableIdx = 0;
        let i = 0;
        while (i < lines.length) {
            if (regionsToReplace.has(i)) {
                const len = regionsToReplace.get(i);
                // Emit all remaining grid tables for this region, each
                // separated by a blank line so the markdown stays valid.
                while (tableIdx < tableMd.length) {
                    if (out.length > 0 && out[out.length - 1] !== '') {
                        out.push('');
                    }
                    out.push(tableMd[tableIdx]);
                    tableIdx++;
                }
                i += len;
            } else {
                out.push(lines[i]);
                i++;
            }
        }

        // Append any leftover grid tables at the end.
        let result = out.join('\n');
        if (tableIdx < tableMd.length) {
            result = result.trimEnd() + '\n\n' + tableMd.slice(tableIdx).join('\n\n') + '\n';
        }
        return result;
    }

    // ═══════════════════════════════════════════════════
    // IMAGE EXTRACTION
    // ═══════════════════════════════════════════════════

    async function extractImages(pdfDoc, pageNum, pageHeight, scale, minSize) {
        const page = await pdfDoc.getPage(pageNum);
        const opList = await page.getOperatorList();
        const images = [], seen = new Set();
        const OPS = pdfjsLib.OPS;

        for (let i = 0; i < opList.fnArray.length; i++) {
            const fn = opList.fnArray[i];
            if (fn !== OPS.paintImageXObject && fn !== OPS.paintJpegXObject && fn !== OPS.paintInlineImageXObject) continue;

            let transform = null;
            for (let j = i - 1; j >= Math.max(0, i - 20); j--) {
                if (opList.fnArray[j] === OPS.transform) { transform = opList.argsArray[j]; break; }
            }
            if (!transform) continue;

            const imgW = Math.abs(transform[0]) + Math.abs(transform[2]);
            const imgH = Math.abs(transform[1]) + Math.abs(transform[3]);
            if (imgW < minSize && imgH < minSize) continue;
            if (imgW > pageHeight * 1.5 || imgH > pageHeight * 1.5) continue;

            const posKey = Math.round(transform[4]) + '_' + Math.round(transform[5]) + '_' + Math.round(imgW) + '_' + Math.round(imgH);
            if (seen.has(posKey)) continue; seen.add(posKey);

            images.push({
                x: transform[4], y: pageHeight - transform[5] - imgH, w: imgW, h: imgH,
                pageIndex: pageNum, name: 'page' + pageNum + '_img' + (images.length + 1) + '.png'
            });
        }
        return images;
    }

    async function renderImageRegion(pdfDoc, pageNum, img, pageHeight, scale) {
        const page = await pdfDoc.getPage(pageNum);
        const vp = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = vp.width; canvas.height = vp.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;

        const cropX = img.x * scale, cropY = img.y * scale, cropW = img.w * scale, cropH = img.h * scale;
        if (cropW < 1 || cropH < 1) return null;

        const crop = document.createElement('canvas');
        crop.width = Math.round(cropW); crop.height = Math.round(cropH);
        try { crop.getContext('2d').drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH); }
        catch (e) { return null; }

        return new Promise(resolve => crop.toBlob(resolve, 'image/png'));
    }

    // ═══════════════════════════════════════════════════
    // MAIN CONVERSION
    // ═══════════════════════════════════════════════════

    convertBtn.onclick = async () => {
        if (isConverting || !pdfJsDoc) return;
        isConverting = true; convertBtn.disabled = true;
        outputSection.style.display = 'none';
        outputSection.classList.remove('flex-grow');
        mdPreviewFrame.classList.remove('visible');
        mdPreviewFrame.src = 'mdv.html';
        progressSection.style.display = 'block';
        progressInline.style.display = '';

        const opts = {
            extractImages: $('#opt-extract-images').checked,
            includeHF: $('#opt-include-hf').checked,
            pageSeps: $('#opt-page-seps').checked,
            toc: $('#opt-toc').checked,
            imageScale: parseInt($('#opt-image-quality').value) || 3,
            minImageSize: parseInt($('#opt-min-image').value) || 20
        };

        generatedImages = {};
        const allPageLines = [];
        const allImages = [];
        let usedStructTree = false;

        // Build excluded text set
        const excludedTexts = new Set();
        if (!opts.includeHF) {
            detectedHeaders.forEach(h => excludedTexts.add(h.text));
            detectedFooters.forEach(f => excludedTexts.add(f.text));
        } else {
            const allPatterns = [...detectedHeaders, ...detectedFooters];
            excludedPatterns.forEach(idx => { if (allPatterns[idx]) excludedTexts.add(allPatterns[idx].text); });
        }

        console.log('[pdf2md] Starting conversion of', totalPages, 'pages');
        for (let i = 1; i <= totalPages; i++) {
            console.log('[pdf2md] Processing page', i, '/', totalPages);
            progressText.textContent = 'Page ' + i + ' of ' + totalPages;
            progressBar.style.width = Math.round((i / totalPages) * 100) + '%';
            progressInline.textContent = i + '/' + totalPages;

            const page = await pdfJsDoc.getPage(i);
            const vp = page.getViewport({ scale: 1.0 });
            const pageHeight = vp.height;

            // Try struct tree first (with 3s timeout)
            let structMd = null;
            try {
                structMd = await Promise.race([
                    tryStructTreeConversion(pdfJsDoc, i),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
                ]);
            } catch (e) { /* fall through to heuristic */ }

            if (structMd) {
                usedStructTree = true;
                let finalPageMd = structMd;
                // Run the grid detector and replace the broken "joined as
                // paragraphs" cell text that the struct tree walker emits
                // when a "Table" role has no proper TR/TD children. We do
                // this by finding the "### Table:" heading, then looking
                // for the first heading after it — the cell text between
                // those two anchors is the broken Table role content. We
                // replace that region with the grid-detected tables. All
                // other content (including prose sections like "Language
                // Notes") is preserved verbatim in the original order.
                try {
                    const tcForGrid = await page.getTextContent();
                    const gridTables = detectGridTables(tcForGrid.items);
                    console.log('[pdf2md] Page', i, 'grid detector found', gridTables.length, 'tables');
                    if (gridTables.length > 0) {
                        finalPageMd = replaceTableRegionInStructMd(structMd, gridTables);
                    }
                } catch (e) {
                    console.warn('[pdf2md] Grid detector failed for page', i, e);
                }
                allPageLines.push({
                    // Use the raw finalPageMd (a string), not a filtered
                    // list of lines, so blank lines between tables are
                    // preserved when assembled.
                    lines: finalPageMd.split('\n'),
                    pageNum: i,
                    images: [],
                    structMode: true,
                    rawMd: finalPageMd
                });
            } else {
                try {
                    const tc = await page.getTextContent();
                    // Try the grid detector here too — the heuristic path
                    // doesn't use it, so without this we'd miss tables
                    // on pages where the struct tree failed entirely.
                    const gridTables = detectGridTables(tc.items);
                    if (gridTables.length > 0) {
                        const tableMd = gridTablesToMarkdown(gridTables);
                        const lines = reconstructLines(tc, pageHeight, !opts.includeHF, excludedTexts);
                        const headingLines = linesToMarkdown(lines).filter(l => /^#{1,6}\s/.test(l));
                        const pageMd = headingLines.join('\n') + '\n\n' + tableMd.join('\n\n');
                        allPageLines.push({ lines: pageMd.split('\n').filter(l => l.trim()), pageNum: i, images: [], structMode: false });
                    } else {
                        const lines = reconstructLines(tc, pageHeight, !opts.includeHF, excludedTexts);
                        const pageMd = linesToMarkdown(lines);
                        allPageLines.push({ lines: pageMd, pageNum: i, images: [], structMode: false });
                    }
                } catch (e) {
                    console.warn('[pdf2md] Heuristic conversion failed for page', i, e);
                    allPageLines.push({ lines: ['*[Page ' + i + ' conversion failed]*'], pageNum: i, images: [], structMode: false });
                }
            }

            // Extract images (with timeout safety)
            if (opts.extractImages) {
                try {
                    const images = await Promise.race([
                        extractImages(pdfJsDoc, i, pageHeight, opts.imageScale, opts.minImageSize),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('img timeout')), 5000))
                    ]);
                    for (const img of (images || [])) {
                        try {
                            const blob = await renderImageRegion(pdfJsDoc, i, img, pageHeight, opts.imageScale);
                            if (blob && blob.size > 100) {
                                generatedImages['images/' + img.name] = blob;
                                allImages.push(img);
                            }
                        } catch (imgErr) { /* skip bad image */ }
                    }
                } catch (e) { console.warn('[pdf2md] Image extraction failed for page', i, e); }
            }

            if (i % 5 === 0) await sleep(5);
        }

        progressText.textContent = 'Assembling…';
        const md = assembleMarkdown(allPageLines, opts, allImages);
        generatedMarkdown = md;

        const mdSize = new Blob([md]).size;
        const imgCount = Object.keys(generatedImages).length;
        const tableCount = (md.match(/^\s*\|[\s\-:|]+\|\s*$/gm) || []).length;
        $('#stat-pages').textContent = totalPages;
        $('#stat-images').textContent = imgCount;
        $('#stat-tables').textContent = Math.max(0, tableCount) + ' tbl';
        $('#stat-size').textContent = formatBytes(mdSize);
        console.log('[pdf2md] FINAL markdown (first 2000):', JSON.stringify(md.slice(0, 2000)));
        console.log('[pdf2md] FINAL markdown (last 2000):', JSON.stringify(md.slice(-2000)));

        progressSection.style.display = 'none';
        progressInline.style.display = 'none';
        outputSection.style.display = 'flex';
        outputSection.classList.add('flex-grow');
        // Show the iframe and push markdown into it (issue #2)
        mdPreviewFrame.classList.add('visible');
        previewVisible = true;
        sendMarkdownToIframe();
        isConverting = false; convertBtn.disabled = false;
    };

    // ═══════════════════════════════════════════════════
    // MULTI-PAGE TABLE CONTINUATION DETECTOR
    // ═══════════════════════════════════════════════════
    // When a Markdown table spans a page boundary (e.g. a 4-page vocabulary
    // table), the per-page conversion emits one table per page, separated by
    // the '---' page break. This post-processor detects that case and stitches
    // the tables back together.
    //
    // Signals used (in priority order):
    //   1. Column-count match between the two tables.
    //   2. Repeated header — if the header of page N+1's first table matches
    //      the header of page N's last table, drop the duplicate header.
    //   3. "(cont.)" / "continued" marker in surrounding text (camelot-style).
    //
    // Implementation: split the joined markdown by the '---' page separator
    // (blank-line-anchored to avoid false positives with thematic breaks),
    // then walk adjacent page pairs.

    function mergeContinuationTables(md) {
        if (!md) return md;
        const PAGE_SEP = '\n\n---\n\n';
        const parts = md.split(PAGE_SEP);
        if (parts.length < 2) return md;

        let result = parts[0];
        for (let i = 1; i < parts.length; i++) {
            const merged = tryMergeAtBoundary(result, parts[i]);
            if (merged !== null) {
                result = merged;
            } else {
                result = result + PAGE_SEP + parts[i];
            }
        }
        return result;
    }

    function tryMergeAtBoundary(prevMd, currMd) {
        const lastTbl = findLastTable(prevMd);
        if (!lastTbl) return null;
        const firstTbl = findFirstTable(currMd);
        if (!firstTbl) return null;

        // Column count must match.
        if (lastTbl.cols !== firstTbl.cols) return null;
        if (lastTbl.cols < 2) return null;

        // Only merge if the first table of the next page is at the very
        // beginning of that page (no heading or paragraph between the page
        // break and the table). Otherwise, the table is a separate table
        // that just happens to share the same column count, and the page
        // break should be preserved.
        const beforeFirstTbl = currMd.substring(0, firstTbl.start);
        if (beforeFirstTbl.trim() !== '') return null;

        // Drop firstTbl's header + separator (markdown table format:
        //   | h1 | h2 |
        //   | --- | --- |
        //   | d1 | d2 |
        // The header and separator are the first two lines.)
        const dataRows = firstTbl.lines.slice(2);

        // If curr table is header-only (no data rows), the merge is a no-op
        // — return null so we don't accidentally lose the page separator.
        if (dataRows.length === 0) return null;

        // Stitch: append curr's data rows to prev's table.
        const newLastTblText = lastTbl.lines.join('\n') + '\n' + dataRows.join('\n');
        const newPrev = prevMd.substring(0, lastTbl.start) + newLastTblText;
        const afterTbl = currMd.substring(firstTbl.end).replace(/^\n+/, '');

        if (!afterTbl.trim()) return newPrev;
        return newPrev + '\n\n' + afterTbl;
    }

    // Find the LAST markdown table in `md` (or null if none).
    // Returns { start, end, lines, cols }.
    function findLastTable(md) {
        const lines = md.split('\n');
        let last = null;
        let i = 0;
        while (i < lines.length) {
            if (isTableRow(lines[i])) {
                const startIdx = i;
                const startOffset = charOffsetOf(lines, i);
                let endIdx = i;
                while (endIdx < lines.length && isTableRow(lines[endIdx])) endIdx++;
                const tblLines = lines.slice(startIdx, endIdx);
                const cols = countTableColumns(tblLines);
                last = {
                    start: startOffset,
                    end: charOffsetOf(lines, endIdx),
                    lines: tblLines,
                    cols: cols
                };
                i = endIdx;
            } else {
                i++;
            }
        }
        return last;
    }

    // Find the FIRST markdown table in `md` (or null if none).
    function findFirstTable(md) {
        const lines = md.split('\n');
        let i = 0;
        while (i < lines.length) {
            if (isTableRow(lines[i])) {
                const startOffset = charOffsetOf(lines, i);
                let endIdx = i;
                while (endIdx < lines.length && isTableRow(lines[endIdx])) endIdx++;
                const tblLines = lines.slice(i, endIdx);
                const cols = countTableColumns(tblLines);
                return {
                    start: startOffset,
                    end: charOffsetOf(lines, endIdx),
                    lines: tblLines,
                    cols: cols
                };
            }
            i++;
        }
        return null;
    }

    function isTableRow(line) {
        // A line is a table row if it starts with '|' (with optional leading
        // whitespace) AND contains at least one more '|' (the closing pipe is
        // optional because some downstream renderers drop it). Separator
        // lines (| --- | --- |) also qualify.
        return /^\s*\|/.test(line) && line.indexOf('|', 1) !== -1;
    }

    function countTableColumns(tableLines) {
        if (tableLines.length === 0) return 0;
        // Use the first non-separator line.
        for (const line of tableLines) {
            // Skip separator lines.
            if (/^\s*\|[\s\-:|]+\|\s*$/.test(line)) continue;
            // Split by '|', filter empty leading/trailing, count cells.
            const cells = line.split('|').slice(1, -1);
            if (cells.length > 0) return cells.length;
        }
        // All separator — fall back to counting from the separator itself.
        for (const line of tableLines) {
            const cells = line.split('|').slice(1, -1);
            if (cells.length > 0) return cells.length;
        }
        return 0;
    }

    function charOffsetOf(lines, idx) {
        let offset = 0;
        for (let i = 0; i < idx; i++) offset += lines[i].length + 1; // +1 for '\n'
        return offset;
    }

    function assembleMarkdown(allPageLines, opts) {
        const sections = [];

        // TOC
        if (opts.toc) {
            const headings = [];
            for (const { lines } of allPageLines) {
                for (const line of lines) {
                    if (typeof line !== 'string') continue;
                    if (!line.trim()) continue;
                    const m = line.match(/^(#{1,6})\s+(.+)/);
                    if (m) {
                        const text = m[2]; const slug = text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
                        headings.push({ level: m[1].length, text, slug });
                    }
                }
            }
            if (headings.length > 0) {
                sections.push('## Table of Contents\n');
                headings.forEach(h => sections.push('  '.repeat(Math.max(0, h.level - 1)) + '- [' + h.text + '](#' + h.slug + ')'));
                sections.push('');
            }
        }

        for (let pi = 0; pi < allPageLines.length; pi++) {
            const { lines, pageNum, structMode } = allPageLines[pi];

            // Insert images
            const pageImages = Object.entries(generatedImages)
                .filter(([path]) => path.includes('page' + pageNum + '_img'));
            for (const [path] of pageImages) {
                sections.push('![' + path.replace('images/', '') + '](' + path + ')');
                sections.push('');
            }

            if (structMode) {
                // Use the raw markdown string to preserve blank-line
                // separators between tables and headings.
                const rawMd = allPageLines[pi].rawMd;
                console.log('[pdf2md] assemble page', pi, 'rawMd first 200:', JSON.stringify((rawMd || '').slice(0, 200)));
                sections.push(rawMd || lines.join('\n'));
            } else {
                sections.push(lines.join('\n'));
            }

            if (opts.pageSeps && pi < allPageLines.length - 1) {
                sections.push(''); sections.push('---'); sections.push('');
            }
        }

        let md = sections.join('\n');
        // TEMP: disabled mergeContinuationTables to debug table layout
        // md = mergeContinuationTables(md);
        md = md.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+$/gm, '');
        return md.trimEnd() + '\n';
    }

    // ═══════════════════════════════════════════════════
    // ZIP BUNDLE
    // ═══════════════════════════════════════════════════

    downloadBtn.onclick = async () => {
        if (!generatedMarkdown) return;
        const hasImages = Object.keys(generatedImages).length > 0;
        if (hasImages) {
            // ZIP with markdown + images
            const zip = new JSZip();
            zip.file('document.md', generatedMarkdown);
            const imgFolder = zip.folder('images');
            for (const [path, blob] of Object.entries(generatedImages)) {
                imgFolder.file(path.replace('images/', ''), blob);
            }
            const blob = await zip.generateAsync({ type: 'blob' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = fileName + '_markdown.zip'; a.click();
            setTimeout(() => URL.revokeObjectURL(url), 200);
        } else {
            // Just download the markdown file directly
            const blob = new Blob([generatedMarkdown], { type: 'text/markdown' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = fileName + '.md'; a.click();
            setTimeout(() => URL.revokeObjectURL(url), 200);
        }
    };

    // ═══════════════════════════════════════════════════
    // IFRAME PREVIEW (mdv.html)
    // ═══════════════════════════════════════════════════

    let previewVisible = false;
    let iframeReady = false;

    function sendMarkdownToIframe() {
        if (!generatedMarkdown || !mdPreviewFrame) return;
        const payload = { type: 'loadContent', text: generatedMarkdown, filename: fileName + '.md' };
        const trySend = () => {
            try { mdPreviewFrame.contentWindow.postMessage(payload, '*'); } catch (e) { }
        };
        trySend();
        // Retry multiple times to handle iframe load race
        setTimeout(trySend, 300);
        setTimeout(trySend, 800);
        setTimeout(trySend, 1500);
    }

    // Listen for mdv.html ready message — always re-send (do not gate on previewVisible)
    window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'ready') {
            iframeReady = true;
            if (previewVisible) sendMarkdownToIframe();
        }
    });

    // ═══════════════════════════════════════════════════
    // SIDEBAR TOGGLE & RESIZER
    // ═══════════════════════════════════════════════════

    if (localStorage.getItem('sidebar_collapsed') === 'true') {
        document.body.classList.add('sidebar-collapsed');
    }

    sidebarToggleBtn.onclick = () => {
        if (window.innerWidth <= 768) {
            sidebar.classList.toggle('visible');
            backdrop.classList.toggle('visible');
        } else {
            const collapsed = document.body.classList.toggle('sidebar-collapsed');
            localStorage.setItem('sidebar_collapsed', collapsed ? 'true' : 'false');
        }
    };
    backdrop.onclick = () => {
        sidebar.classList.remove('visible');
        backdrop.classList.remove('visible');
    };

    // Panel collapse toggle
    sidebar.querySelectorAll('.sidebar-panel-header').forEach(header => {
        header.addEventListener('click', () => {
            const panel = header.closest('.sidebar-panel');
            if (panel) {
                const isCollapsed = panel.classList.toggle('collapsed');
                if (isCollapsed) panel.style.flex = '';
            }
        });
    });

    // Resizer drag
    sidebar.querySelectorAll('.sidebar-resizer').forEach(r => {
        r.addEventListener('mousedown', (e) => {
            const prev = r.previousElementSibling;
            const next = r.nextElementSibling;
            if (!prev || !next) return;
            const startY = e.clientY;
            const prevH = prev.getBoundingClientRect().height;
            const nextH = next.getBoundingClientRect().height;
            const onMove = (ev) => {
                const delta = ev.clientY - startY;
                prev.style.flex = '0 0 ' + Math.max(28, prevH + delta) + 'px';
                next.style.flex = '0 0 ' + Math.max(28, nextH - delta) + 'px';
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    });

    // ═══════════════════════════════════════════════════
    // UI HELPERS
    // ═══════════════════════════════════════════════════

    function showToast(msg, isError) {
        toastEl.textContent = msg;
        toastEl.style.background = isError ? 'var(--danger)' : 'var(--bg-surface-raised)';
        toastEl.style.color = isError ? '#fff' : 'var(--text-primary)';
        toastEl.style.display = 'block'; toastEl.style.opacity = '1';
        setTimeout(() => { toastEl.style.opacity = '0'; setTimeout(() => { toastEl.style.display = 'none'; }, 200); }, 3000);
    }

    function formatBytes(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    }

    function escHtml(s) {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    // ═══════════════════════════════════════════════════
    // POSTMESSAGE API (workspace + embed integration)
    // ═══════════════════════════════════════════════════

    window.addEventListener('message', function (event) {
        const msg = event.data;
        if (!msg || msg.type !== 'loadContent') return;
        if (!msg.bytes) {
            showToast('pdf2md requires binary PDF bytes — use "bytes" field', true);
            return;
        }
        const f = new File([msg.bytes], msg.filename || 'document.pdf', { type: 'application/pdf' });
        handleFile(f);
        if (event.source) {
            event.source.postMessage({ type: 'loadContentAck', filename: msg.filename || 'document.pdf', format: 'pdf' }, event.origin || '*');
        }
    });

    if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'toolSelection', url: window.location.pathname.split('/').pop() + window.location.search }, '*');
    }

})();
