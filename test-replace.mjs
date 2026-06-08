// Test the new replaceTableRegionInStructMd
function gridTablesToMarkdown(tables) {
    return tables.map(t => {
        if (t.rows.length === 0) return '';
        const colCount = t.rows[0].length;
        const md = [];
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

function replaceTableRegionInStructMd(structMd, gridTables) {
    if (!structMd || !gridTables || gridTables.length === 0) return structMd;
    const tableMd = gridTablesToMarkdown(gridTables);
    if (tableMd.length === 0) return structMd;

    const lines = structMd.split('\n');
    const TABLE_HEADING_RE = /^\s*#{1,6}\s+.*\btable\b/i;
    const HEADING_RE = /^\s*#{1,6}\s+/;

    const headingIdxs = [];
    for (let i = 0; i < lines.length; i++) {
        if (HEADING_RE.test(lines[i])) headingIdxs.push(i);
    }
    const tableHeadingIdxs = headingIdxs.filter(i => TABLE_HEADING_RE.test(lines[i]));

    const linesToRemove = new Set();
    const replacement = new Map();
    let tableIdx = 0;
    for (const thIdx of tableHeadingIdxs) {
        const nextIdx = headingIdxs.find(h => h > thIdx);
        const endIdx = nextIdx !== undefined ? nextIdx : lines.length;
        let contentStart = thIdx + 1;
        while (contentStart < endIdx && !lines[contentStart].trim()) contentStart++;
        for (let i = contentStart; i < endIdx; i++) linesToRemove.add(i);
        if (tableIdx < tableMd.length) {
            replacement.set(thIdx, tableMd[tableIdx]);
            tableIdx++;
        }
    }

    const out = [];
    for (let i = 0; i < lines.length; i++) {
        if (linesToRemove.has(i)) continue;
        out.push(lines[i]);
        if (replacement.has(i)) {
            out.push('');
            out.push(replacement.get(i));
        }
    }

    let result = out.join('\n');
    if (tableIdx < tableMd.length) {
        result = result.trimEnd() + '\n\n' + tableMd.slice(tableIdx).join('\n\n') + '\n';
    }
    return result;
}

// Page 4 actual struct tree output (with Language Notes)
const page4StructMd = `## Glossary
### Table: Vocabulary Table
qualifizierte
Schulungsprogramme
qualified training programs
Noun phrase, n, Schulungsprogramm
Schulungsprogramme
Mitarbeiter fit
to make
machen
employees fit
Verb phrase, infinitive: Mitarbeiter fit
machen
ein Erfolg wird
becomes a
success
present
Auszüge
excerpts
Noun, m, Auszug
Auszüge
employment
Arbeitsvertrag
Noun, m, Arbeitsvertrag
contract
Arbeitsverträge
kreuzen Sie an
mark / tick off
Verb phrase, imperative, infinitive:
ankreuzen, separable
Aussagen
statements
Noun, f, Aussage
Aussagen
nächste Seite
next page
Noun phrase, f, Seite
Seiten
richtig oder falsch
right or wrong
Adjective phrase
### Language Notes
Original:
Sie haben es satt, jeden Tag das Gleiche zu machen und sich in Ihrem
Beruf zu langweilen
?
What it teaches:
Idiom "es satt haben" (to be fed up) and
reflexive "sich langweilen". Shows infinitive clause with "zu".
Paraphrase /
equivalent:
Are you tired of doing the same thing every day and being bored at
your job
?
Original:
in welchen Betrieb sie „reingeschnuppert" haben
What it teaches:
Colloquial, separable verb "reinschnuppern" (to get a taste/insight) in present
perfect.
Paraphrase / equivalent:
in which company they gained an insight`;

const gridTables = [
    {
        rows: [
            ['Word / Phrase', 'Translation', 'Notes'],
            ['qualifizierte Schulungsprogramme', 'qualified training programs', 'Noun phrase, n, Schulungsprogramm Schulungsprogramme'],
            ['Mitarbeiter fit machen', 'to make employees fit', 'Verb phrase, infinitive: Mitarbeiter fit machen'],
            ['ein Erfolg wird', 'becomes a success', 'Verb phrase, infinitive: ein Erfolg werden, present'],
            ['Auszüge', 'excerpts', 'Noun, m, Auszug ↔ Auszüge'],
            ['Arbeitsvertrag', 'employment contract', 'Noun, m, Arbeitsvertrag ↔ Arbeitsverträge'],
            ['kreuzen Sie an', 'mark / tick off', 'Verb phrase, imperative, infinitive: ankreuzen, separable'],
            ['Aussagen', 'statements', 'Noun, f, Aussage ↔ Aussagen'],
            ['nächste Seite', 'next page', 'Noun phrase, f, Seite ↔ Seiten'],
            ['richtig oder falsch', 'right or wrong', 'Adjective phrase']
        ]
    }
];

console.log('=== INPUT (page 4) ===');
console.log(page4StructMd);
console.log('\n=== OUTPUT ===');
console.log(replaceTableRegionInStructMd(page4StructMd, gridTables));
