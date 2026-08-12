import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';

const MODEL_ID = 'onnx-community/Supertonic-TTS-ONNX';
const VOICES_BASE = `https://huggingface.co/${MODEL_ID}/resolve/main/voices/`;

env.allowLocalModels = false;

let cachedPipeline = null;
let pipelineLoadPromise = null;
let embeddingCache = {};

export async function detectDevice() {
  if (navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) return 'webgpu';
    } catch (_) {
    }
  }
  return 'wasm';
}

export async function initPipeline(device, onProgress) {
  if (cachedPipeline) return cachedPipeline;
  if (pipelineLoadPromise) return pipelineLoadPromise;

  pipelineLoadPromise = (async () => {
    // Multi-threaded WASM needs crossOriginIsolated (COOP/COEP). Only request
    // multiple threads when SharedArrayBuffer is actually usable.
    const canMultiThread = typeof self !== 'undefined' && self.crossOriginIsolated === true;
    if (device === 'wasm') {
      env.backends.onnx.wasm.numThreads = canMultiThread ? 8 : 1;
      env.backends.onnx.wasm.simd = true;
    }

    const opts = { device, session_options: { logSeverityLevel: 3 } };
    if (onProgress) opts.progress_callback = onProgress;

    try {
      cachedPipeline = await pipeline('text-to-speech', MODEL_ID, opts);
    } catch (firstErr) {
      if (device === 'webgpu') {
        const canMultiThreadFallback = typeof self !== 'undefined' && self.crossOriginIsolated === true;
        env.backends.onnx.wasm.numThreads = canMultiThreadFallback ? 8 : 1;
        env.backends.onnx.wasm.simd = true;
        try {
          cachedPipeline = await pipeline('text-to-speech', MODEL_ID, {
            device: 'wasm',
            session_options: { logSeverityLevel: 3 },
            ...(onProgress ? { progress_callback: onProgress } : {}),
          });
        } catch (secondErr) {
          throw new Error(`WebGPU failed: ${firstErr.message}. WASM fallback also failed: ${secondErr.message}`);
        }
      } else {
        throw firstErr;
      }
    }

    return cachedPipeline;
  })();

  return pipelineLoadPromise;
}

export async function loadEmbedding(voice) {
  if (embeddingCache[voice]) return embeddingCache[voice];
  const url = `${VOICES_BASE}${voice}.bin`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Voice file not found: ${voice} (${response.status})`);
  const buffer = await response.arrayBuffer();
  const embedding = new Float32Array(buffer);
  embeddingCache[voice] = embedding;
  return embedding;
}

export function clearEmbeddingCache() {
  embeddingCache = {};
}

export function clearPipeline() {
  cachedPipeline = null;
  pipelineLoadPromise = null;
}

// ─── Language Detection ───────────────────────────────────────────────────────

const SCRIPT_RANGES = [
  { lang: 'ja', ranges: [[0x3040, 0x309f], [0x30a0, 0x30ff]] }, // Hiragana + Katakana
  { lang: 'ko', ranges: [[0xac00, 0xd7af], [0x1100, 0x11ff]] }, // Hangul
  { lang: 'ar', ranges: [[0x0600, 0x06ff]] },
  { lang: 'ru', ranges: [[0x0400, 0x04ff]] }, // Cyrillic → Russian
  { lang: 'el', ranges: [[0x0370, 0x03ff]] }, // Greek
  { lang: 'he', ranges: [[0x0590, 0x05ff]] }, // Hebrew
  { lang: 'hi', ranges: [[0x0900, 0x097f]] }, // Devanagari → Hindi
  { lang: 'th', ranges: [[0x0e00, 0x0e7f]] }, // Thai
  { lang: 'zh', ranges: [[0x4e00, 0x9fff]] }  // CJK
];

const LATIN_LANG_MARKERS = {
  de: /\b(ich|nicht|eine|einem|eines|einer|einen|habe|haben|hatte|hatten|sein|seinen|seiner|seinem|wird|wurden|wurde|können|möchte|möchten|kaufen|sprechen|lernen|schreiben|verstehen|schon|bereits|jedoch|obwohl|trotzdem|deshalb|deswegen|nämlich|eigentlich|warum|wohin|woher|womit|worüber|darüber|damit|dafür|dagegen|dabei|dazu|daran|danach|davor|darum|doch|dann|denn|wenn|weil|dass|wäre|hätte|würde|könnten|müssen|sollen|dürfen|wollen|machen|gehen|kommen|wissen|stellen|nehmen|bringen|lassen|halten|heißen|bleiben|fragen|antworten|arbeiten|spielen|trinken|essen|lesen|schlafen|fahren|fliegen|schwimmen|laufen|lachen|weinen|denken|glauben|fühlen|lieben|hassen|brauchen|suchen)\b/gi,
  fr: /\b(je|tu|il|elle|nous|vous|ils|elles|très|aussi|encore|toujours|jamais|voici|voilà|être|avoir|faire|aller|venir|voir|savoir|dire|pouvoir|vouloir|donc|mais|parce|bonjour|merci|cette|cela|celui|celle|ceux|celles|notre|votre|leur|leurs|même|autre|autres|après|avant|pendant|depuis|jusqu|chez|vers|sans|sous|avec|dans|pour|sur|par|tout|tous|toute|toutes|bien|moins|beaucoup|souvent|parfois|surtout|comment|pourquoi|quand|combien)\b/gi,
  es: /\b(yo|tú|él|ella|nosotros|vosotros|ellos|también|siempre|nunca|aquí|allí|está|están|estoy|estás|estamos|hablar|escribir|trabajar|vivir|comer|beber|caminar|correr|dormir|comprar|vender|aprender|enseñar|jugar|cantar|bailar|mirar|escuchar|esperar|llegar|salir|volver|poder|querer|saber|conocer|decir|hacer|tener|venir|poner|traer|llevar|seguir|creer|pensar|sentir|gustar|haber|muy|más|pero|porque|cuando|donde|tanto|todo|todos|toda|todas|algo|alguien|nadie|nada|otro|otros|otra|otras|mismo|misma|sobre|después|antes|ahora|luego|con|en|la|el|de|un|una|del|las|los|por|para|es|mi|amigo|escuela)\b/gi,
  it: /\b(io|lui|lei|noi|voi|loro|anche|già|ancora|sempre|mai|essere|avere|fare|andare|venire|vedere|sapere|dire|potere|volere|dovere|molto|poco|tanto|bene|male|così|però|oppure|quando|dove|perché|cosa|questo|questa|questi|queste|quello|quella|quelli|quelle|nostro|vostro|stesso|stessa|ogni|tutto|tutti|tutta|tutte|altro|altra|altri|altre|certo|certa|nuovo|nuova|grande|piccolo|buono|cattivo|bello|brutto|caldo|freddo|veloce|lento|forte|debole)\b/gi,
  pt: /\b(eu|nós|vós|eles|elas|também|ainda|sempre|nunca|aqui|ser|estar|ter|fazer|vir|ver|saber|dizer|poder|querer|muito|pouco|tanto|bem|mas|porque|quando|onde|como|isso|esse|essa|aquele|aquela|nosso|vosso|mesmo|mesma|todo|todos|toda|todas|outro|outros|outra|outras|novo|nova|grande|pequeno|bom|mau|bonito|feio|quente|frio|forte|fraco|falar|escrever|trabalhar|viver|comer|beber|andar|correr|dormir|comprar|vender|aprender|ensinar|jogar|cantar|dançar)\b/gi,
  nl: /\b(ik|jij|hij|zij|wij|jullie|zijn|hebben|worden|kunnen|willen|moeten|mogen|zullen|gaan|komen|zien|weten|zeggen|maken|doen|nemen|geven|staan|liggen|zitten|lopen|rijden|werken|leren|spelen|eten|drinken|slapen|leven|wonen|denken|voelen|horen|spreken|schrijven|lezen|kopen|verkopen|betalen|ook|niet|maar|want|omdat|als|toch|hier|daar|altijd|nooit|vaak|soms|zeker|misschien|heel|erg|veel|weinig|meer|minder|samen|alleen|graag|goed|slecht|groot|klein|lang|kort|snel|langzaam|sterk|zwak)\b/gi,
  tr: /\b(için|çok|daha|gibi|kadar|sonra|önce|değil|bilmek|gelmek|gitmek|görmek|yapmak|vermek|almak|söylemek|istemek|olmak|etmek|ama|evet|hayır|neden|nasıl|nerede|şimdi|artık|hala|henüz|zaten|belki|tabii|elbette|ayrıca|özellikle|ancak|fakat|lakin|yani|yalnız|sadece|bile|hiç|çünkü|madem|sanki)\b/gi,
  pl: /\b(jest|nie|tak|jak|ale|już|też|przez|przy|bez|między|przed|się|być|mieć|móc|chcieć|wiedzieć|mówić|iść|przyjść|widzieć|robić|pracować|mieszkać|żyć|czuć|myśleć|wierzyć|lubić|kochać|nienawidzić|potrzebować|szukać|znaleźć|kupować|sprzedawać|uczyć|grać|śpiewać|tańczyć|jeść|pić|spać|czytać|pisać|rozumieć|słuchać|patrzeć|bardzo|dobrze|źle|teraz|potem|zawsze|nigdy|często|czasem|może|chyba|właśnie|jednak|przecież|dlatego|więc|dość|tylko|nawet|jeszcze)\b/gi,
  sv: /\b(jag|hon|och|är|inte|för|när|här|där|också|redan|alltid|aldrig|vara|göra|gå|komma|veta|säga|kunna|vilja|måste|ska|borde|heter|finns|har|hade|blir|blev|kan|vill|behöver|arbetar|bor|lever|tänker|tror|känner|hör|ser|talar|skriver|läser|köper|säljer|lär|spelar|sjunger|dansar|äter|dricker|sover|förstår|lyssnar|tittar|mycket|lite|bra|dåligt|gammal|stor|liten|lång|kort|snabb|långsam|stark|svag|hög|låg|varm|kall)\b/gi
};

const LATIN_MATCH_THRESHOLD = 3;

/**
 * Detect the primary language of a text string.
 * @param {string} text
 * @param {string} [fallback='en']
 * @returns {string} Language code
 */
export function detectLanguage(text, fallback = 'en') {
  if (!text || text.trim().length === 0) return fallback;

  // 1. Check non-Latin script ranges first
  const scriptScores = {};
  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0;
    for (const { lang, ranges } of SCRIPT_RANGES) {
      for (const [start, end] of ranges) {
        if (cp >= start && cp <= end) {
          scriptScores[lang] = (scriptScores[lang] ?? 0) + 1;
        }
      }
    }
  }

  if (Object.keys(scriptScores).length > 0) {
    const topLang = Object.entries(scriptScores).sort(([, a], [, b]) => b - a)[0][0];
    const langMap = { zh: 'zh', he: 'na' };
    return langMap[topLang] ?? topLang;
  }

  // 2. Latin-script function word frequency check
  const latinScores = {};
  for (const [lang, pattern] of Object.entries(LATIN_LANG_MARKERS)) {
    const matches = text.match(pattern);
    if (matches && matches.length >= LATIN_MATCH_THRESHOLD) {
      latinScores[lang] = matches.length;
    }
  }

  if (Object.keys(latinScores).length > 0) {
    return Object.entries(latinScores).sort(([, a], [, b]) => b - a)[0][0];
  }

  return fallback;
}

// ─── Markdown & Structural Parsing ───────────────────────────────────────────

export function splitTextLines(text) {
  const blocks = [];
  let paragraph = '';

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      if (paragraph.trim()) blocks.push(paragraph.trim());
      paragraph = '';
      continue;
    }

    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      if (paragraph.trim()) blocks.push(paragraph.trim());
      blocks.push(heading[1].trim());
      paragraph = '';
      continue;
    }

    paragraph = paragraph ? `${paragraph} ${line}` : line;
  }

  if (paragraph.trim()) blocks.push(paragraph.trim());
  return blocks;
}

export function splitMarkdownStructure(text) {
  if (!text) return [];
  const blocks = [];
  const blockPattern = /(```[\s\S]*?```|\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$[^$\n]{1,500}\$)/g;
  let lastIndex = 0;
  let match;

  while ((match = blockPattern.exec(text)) !== null) {
    const before = text.slice(lastIndex, match.index);
    if (before.trim()) blocks.push(...splitTextLines(before));
    if (match[0].trim()) blocks.push(match[0].trim());
    lastIndex = blockPattern.lastIndex;
  }

  const tail = text.slice(lastIndex);
  if (tail.trim()) blocks.push(...splitTextLines(tail));
  return blocks.length > 0 ? blocks : splitTextLines(text);
}

export function splitBracketedSegments(text) {
  const segments = [];
  const pattern = /(\([^)\n]{1,300}\)|\[[^\]\n]{1,300}\]|\{[^}\n]{1,300}\}|'[^'\n]{1,200}'|"[^"\n]{1,200}")/g;
  let last = 0;
  let match;
  let pendingPrefix = '';

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      const outer = text.slice(last, match.index).trim();
      if (outer) {
        if (outer.length <= 10 && /^[A-Za-z0-9]+[:\-–—.,]?\s*$/.test(outer)) {
          pendingPrefix = outer + ' ';
        } else {
          if (pendingPrefix) {
            segments.push({ text: pendingPrefix + outer, isDelimited: false });
            pendingPrefix = '';
          } else {
            segments.push({ text: outer, isDelimited: false });
          }
        }
      }
    }
    const inner = match[0].slice(1, -1).trim();
    if (inner) {
      segments.push({ text: pendingPrefix + inner, isDelimited: true });
      pendingPrefix = '';
    }
    last = pattern.lastIndex;
  }

  const tail = text.slice(last).trim();
  if (tail) {
    segments.push({ text: pendingPrefix + tail, isDelimited: false });
  } else if (pendingPrefix) {
    segments.push({ text: pendingPrefix.trim(), isDelimited: false });
  }
  return segments.length > 0 ? segments : [{ text, isDelimited: false }];
}

// ─── Markdown stripping ──────────────────────────────────────────────────────

function katexToSpoken(expr) {
  let s = expr.trim();
  s = s.replace(/\\text\{([^}]+)\}/g, '$1');
  s = s.replace(/\\times/g, ' times ');
  s = s.replace(/\\div/g, ' divided by ');
  s = s.replace(/\\pm/g, ' plus or minus ');
  s = s.replace(/\\cdot/g, ' times ');
  s = s.replace(/\\leq/g, ' less than or equal to ');
  s = s.replace(/\\geq/g, ' greater than or equal to ');
  s = s.replace(/\\neq/g, ' not equal to ');
  s = s.replace(/\\approx/g, ' approximately ');
  s = s.replace(/\\infty/g, ' infinity ');
  s = s.replace(/\\sqrt\{([^}]+)\}/g, 'square root of $1');
  s = s.replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '$1 over $2');
  s = s.replace(/\^{([^}]+)}/g, ' to the power of $1');
  s = s.replace(/\^(\d)/g, ' to the power of $1');
  s = s.replace(/_{([^}]+)}/g, ' sub $1');
  s = s.replace(/\\[a-zA-Z]+/g, ' ');
  s = s.replace(/[{}]/g, '');
  s = s.replace(/=/g, ' equals ');
  s = s.replace(/\s+/g, ' ').trim();
  return s || 'math expression';
}

export function stripMarkdownForTTS(text) {
  if (!text || typeof text !== 'string') return '';

  let t = text;

  // KaTeX display math — replace with spoken label
  t = t.replace(/\$\$([^$]+)\$\$/g, (_, expr) => katexToSpoken(expr));
  // KaTeX inline math
  t = t.replace(/\$([^$\n]+)\$/g, (_, expr) => katexToSpoken(expr));

  // Fenced code blocks — replace with brief spoken label
  t = t.replace(/```[\w]*\n([\s\S]*?)```/g, 'code block. ');
  t = t.replace(/~~~[\w]*\n([\s\S]*?)~~~/g, 'code block. ');

  // Headings — strip # markers, keep text, append period for distinct sentence boundary
  t = t.replace(/^#{1,6}\s+(.+)$/gm, '$1.');

  // Bold + italic combined
  t = t.replace(/\*\*\*(.+?)\*\*\*/g, '$1');
  t = t.replace(/___(.+?)___/g, '$1');

  // Bold
  t = t.replace(/\*\*(.+?)\*\*/g, '$1');
  t = t.replace(/__(.+?)__/g, '$1');

  // Italic
  t = t.replace(/\*(.+?)\*/g, '$1');
  t = t.replace(/_(.+?)_/g, '$1');

  // Strikethrough
  t = t.replace(/~~(.+?)~~/g, '$1');

  // Inline code — keep content
  t = t.replace(/`([^`]+)`/g, '$1');

  // Links — keep label, drop URL
  t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  // Bare URLs
  t = t.replace(/https?:\/\/\S+/g, '');

  // Images — use alt text
  t = t.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');

  // Blockquotes
  t = t.replace(/^>\s*/gm, '');

  // Horizontal rules
  t = t.replace(/^[-*_]{3,}\s*$/gm, '');

  // Unordered list markers
  t = t.replace(/^[\s]*[-*+]\s+/gm, '');

  // Ordered list markers
  t = t.replace(/^[\s]*\d+\.\s+/gm, '');

  // Table pipes and alignment rows
  t = t.replace(/^\|?[-:\s|]+\|$/gm, '');
  t = t.replace(/\|/g, ' ');

  // HTML tags
  t = t.replace(/<[^>]+>/g, '');

  // Collapse multiple blank lines
  t = t.replace(/\n{3,}/g, '\n\n');

  // Trim and collapse excess whitespace within lines
  t = t
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();

  return t;
}

// ─── Text Normalization ───────────────────────────────────────────────────────

export function normalizeTextForTTS(text) {
  if (!text) return '';
  let p = text;

  // Em/en dashes → comma pause
  p = p.replace(/[–—]/g, ', ');
  p = p.replace(/---/g, ', ');
  p = p.replace(/--/g, ', ');

  // Expand abbreviations
  p = p.replace(/\be\.g\.\s*/gi, 'for example, ');
  p = p.replace(/\bi\.e\.\s*/gi, 'that is, ');
  p = p.replace(/@/g, ' at ');

  // Colon as label/heading separator (e.g. "A: text", "Note: text") → comma pause
  p = p.replace(/\b(\w{1,8}):\s+/g, '$1, ');

  // Normalize apostrophes: protect contractions (I've, i'm, don't) with placeholder
  p = p.replace(/([A-Za-zÀ-öø-ÿ])['’‘`\u02BCʼ′]([A-Za-zÀ-öø-ÿ])/g, "$1__APOSTROPHE__$2");
  // Remove standalone decorative single quotes
  p = p.replace(/['’‘`\u02BCʼ′]/g, '');
  // Restore internal contraction apostrophes as standard ASCII single quote '
  p = p.replace(/__APOSTROPHE__/g, "'");

  // Smart double quotes
  p = p.replace(/[""„‟"]/g, '');

  // Brackets to space
  p = p.replace(/[()[\]{}]/g, ' ');

  // Pipes, slashes, hash, underscores, decorative symbols
  p = p.replace(/[|/\\#_*~+←↙❤♥★☆©®™]/g, ' ');

  // Remove emoji
  p = p.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, ' ');

  // Collapse whitespace
  p = p.replace(/\s+/g, ' ');

  // Fix punctuation spacing
  p = p.replace(/\s+([.,!?;:])/g, '$1');
  p = p.replace(/,+/g, ',');
  p = p.replace(/,\s*/g, ', ');
  p = p.replace(/\.{2,}/g, '.');

  return p.trim();
}

// ─── Sentence & Clause Splitting ─────────────────────────────────────────────

export const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'ave', 'blvd',
  'inc', 'ltd', 'co', 'corp', 'vs', 'vol', 'dept', 'est', 'approx',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
  'fig', 'eq', 'no', 'ref', 'ch', 'sec', 'pt', 'pg'
]);

const LIST_CONJUNCTIONS = new Set(['and', 'or', 'nor', 'but', 'yet', 'so', 'as', 'plus', 'then']);

function nextNonEmpty(toks, i) {
  for (let j = i + 1; j < toks.length; j++) {
    const t = toks[j].trim();
    if (t) return t.toLowerCase();
  }
  return '';
}

/**
 * Split text into TTS chunks with boundary tags ('sentence' | 'clause')
 * @param {string} text
 * @returns {Array<{text: string, boundaryType: 'sentence'|'clause'}>}
 */
export function splitIntoSentences(text) {
  if (!text) return [];

  const MAX_CHUNK = 250;
  const MIN_CHUNK = 80;

  const rawSentences = [];
  let buffer = '';
  const tokens = text.split(/(\s+)/);

  for (let i = 0; i < tokens.length; i++) {
    buffer += tokens[i];
    const trimmed = tokens[i].trim();
    if (!trimmed) continue;

    const endsWithPunct = /[.!?]$/.test(trimmed);
    if (!endsWithPunct) continue;

    if (trimmed.endsWith('.')) {
      const word = trimmed.replace(/\.$/, '').toLowerCase();
      if (ABBREVIATIONS.has(word)) continue;
      // Single capital letter followed by period (initials like "J.")
      if (/^[A-Z]\.$/.test(trimmed)) continue;
      const nextToken = tokens[i + 1]?.trim() || tokens[i + 2]?.trim() || '';
      // Next word starts lowercase — continuation of sentence
      if (nextToken && /^[a-z]/.test(nextToken)) continue;
      // Short honorific title (≤3 chars) before capital letter (Dr. Smith, St. John)
      if (nextToken && /^[A-Z]/.test(nextToken) && word.length <= 3) continue;
      if (/\d\.$/.test(trimmed)) {
        const next = tokens[i + 1]?.trim() || tokens[i + 2]?.trim() || '';
        if (/^\d/.test(next)) continue;
      }
    }
    const sentence = buffer.trim();
    if (sentence) rawSentences.push(sentence);
    buffer = '';
  }
  const remaining = buffer.trim();
  if (remaining) rawSentences.push(remaining);
  if (rawSentences.length === 0) return [{ text: text.trim(), boundaryType: 'sentence' }];

  const clauses = [];
  for (const sentence of rawSentences) {
    const wordTokens = sentence.split(/(\s+)/);
    let clause = '';

    for (let i = 0; i < wordTokens.length; i++) {
      clause += wordTokens[i];
      const word = wordTokens[i].trim();
      if (!word) continue;

      const endsComma = word.endsWith(',');
      if (!endsComma) continue;

      // Don't split if next word is a list conjunction ("momma, daddy and baby")
      const next = nextNonEmpty(wordTokens, i);
      if (LIST_CONJUNCTIONS.has(next.replace(/[^a-z]/g, ''))) continue;
      // Only split on comma if clause is already long enough
      if (clause.trim().length < MIN_CHUNK) continue;

      const trimmed = clause.trim();
      if (trimmed) clauses.push({ text: trimmed, boundaryType: 'clause' });
      clause = '';
    }

    const tail = clause.trim();
    if (tail) clauses.push({ text: tail, boundaryType: 'sentence' });
  }

  const result = [];
  let accumulator = '';
  let accumulatorBoundary = 'clause';
  for (const { text: clauseText, boundaryType: clauseBoundary } of clauses) {
    if (!accumulator) {
      accumulator = clauseText;
    } else {
      const merged = accumulator + ' ' + clauseText;
      if (merged.length <= MAX_CHUNK) {
        accumulator = merged;
      } else {
        result.push({ text: accumulator, boundaryType: accumulatorBoundary });
        accumulator = clauseText;
      }
    }
    accumulatorBoundary = clauseBoundary;
    if (accumulator.length > MAX_CHUNK) {
      const parts = accumulator.split(/([,;:]\s*)/);
      let current = '';
      for (let j = 0; j < parts.length; j++) {
        current += parts[j];
        if (j % 2 === 1 && parts[j].trimEnd().endsWith(',')) {
          const nextText = (parts[j + 1] ?? '').trimStart();
          const nextWord = nextText.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '') ?? '';
          if (LIST_CONJUNCTIONS.has(nextWord)) continue;
          if (current.length >= MIN_CHUNK) {
            result.push({ text: current.trim(), boundaryType: 'clause' });
            current = '';
          }
        } else if (j % 2 === 1) {
          if (current.length >= MIN_CHUNK) {
            result.push({ text: current.trim(), boundaryType: 'clause' });
            current = '';
          }
        }
      }
      accumulator = current;
    }
  }

  if (accumulator.trim()) {
    if (accumulator.trim().length < MIN_CHUNK && result.length > 0) {
      const prev = result[result.length - 1];
      if ((prev.text + ' ' + accumulator.trim()).length <= MAX_CHUNK) {
        result[result.length - 1] = { text: prev.text + ' ' + accumulator.trim(), boundaryType: accumulatorBoundary };
      } else {
        result.push({ text: accumulator.trim(), boundaryType: accumulatorBoundary });
      }
    } else {
      result.push({ text: accumulator.trim(), boundaryType: accumulatorBoundary });
    }
  }

  for (const entry of result) {
    const trimmed = entry.text.trim();
    if (/[.!?…]$/.test(trimmed)) {
      entry.boundaryType = 'sentence';
    } else {
      entry.boundaryType = 'clause';
    }
  }
  return result.filter((entry) => entry.text.length > 0);
}

// ─── Audio Helpers ───────────────────────────────────────────────────────────

export function trimTrailingSilence(wav, sampleRate, threshold = 0.01, marginSec = 0.035) {
  let end = wav.length;
  while (end > 0 && Math.abs(wav[end - 1]) < threshold) end--;
  const margin = Math.round(sampleRate * marginSec);
  return wav.slice(0, Math.min(wav.length, end + margin));
}

function protectContractions(txt) {
  return txt.replace(/([A-Za-zÀ-öø-ÿ])['’‘`\u02BCʼ′]([A-Za-zÀ-öø-ÿ])/g, "$1__APOSTROPHE__$2");
}

function restoreContractions(txt) {
  return txt.replace(/__APOSTROPHE__/g, "'");
}

/**
 * Main chunking orchestration pipeline
 * @param {string} text
 * @returns {Array<{text: string, boundaryType: 'sentence'|'clause'|'paragraph'}>}
 */
export function chunkNarrationText(text) {
  const protectedText = protectContractions(text);
  const chunks = [];
  const blocks = splitMarkdownStructure(protectedText);
  for (let bIndex = 0; bIndex < blocks.length; bIndex++) {
    const block = blocks[bIndex];
    const isLastBlock = bIndex === blocks.length - 1;
    const bracketSegments = splitBracketedSegments(block);
    for (let sIndex = 0; sIndex < bracketSegments.length; sIndex++) {
      const seg = bracketSegments[sIndex].text;
      const isLastSeg = sIndex === bracketSegments.length - 1;
      const cleaned = normalizeTextForTTS(seg);
      if (!cleaned) continue;
      // Skip segments that are only punctuation after normalization
      if (/^[^a-zA-ZÀ-öø-ÿͰ-ϿЀ-ӿ؀-ۿ一-鿿぀-ヿ가-힯0-9_]+$/.test(cleaned)) continue;
      const sentences = splitIntoSentences(cleaned);
      for (let i = 0; i < sentences.length; i++) {
        const isLastSentence = i === sentences.length - 1;
        let boundary = sentences[i].boundaryType;
        if (isLastSentence && isLastSeg && !isLastBlock && boundary === 'sentence') {
          boundary = 'paragraph';
        }
        chunks.push({
          text: restoreContractions(sentences[i].text),
          boundaryType: boundary
        });
      }
    }
  }
  return chunks;
}

// ─── Synthesis ────────────────────────────────────────────────────────────────

export async function synthesize(pipe, text, embedding, speed, steps) {
  const strippedText = stripMarkdownForTTS(text);
  const chunks = chunkNarrationText(strippedText);

  if (chunks.length === 0) {
    return { audio: new Float32Array(0), sampling_rate: 22050 };
  }

  const results = [];
  const boundaryTypes = [];
  let samplingRate = 22050;

  for (const chunk of chunks) {
    const chunkText = chunk.text;
    if (!chunkText || chunkText.trim().length === 0) continue;
    const output = await pipe(chunkText, {
      speaker_embeddings: embedding,
      num_inference_steps: steps || 10,
      speed: speed || 1.0,
    });
    if (output && output.audio) {
      const trimmedAudio = trimTrailingSilence(output.audio, output.sampling_rate || samplingRate);
      results.push(trimmedAudio);
      boundaryTypes.push(chunk.boundaryType);
      if (output.sampling_rate) {
        samplingRate = output.sampling_rate;
      }
    }
  }

  if (results.length === 0) {
    return { audio: new Float32Array(0), sampling_rate: samplingRate };
  }

  // Concatenate audio arrays with boundary-aware silence pauses
  // Paragraph: 0.50s, Sentence (.!?): 0.35s, Clause (,;:): 0.10s
  const PAUSE_PARAGRAPH_SEC = 0.50;
  const PAUSE_SENTENCE_SEC = 0.35;
  const PAUSE_CLAUSE_SEC = 0.10;

  let totalLength = 0;
  const gaps = [];

  for (let i = 0; i < results.length; i++) {
    totalLength += results[i].length;
    if (i < results.length - 1) {
      const boundary = boundaryTypes[i] || 'sentence';
      let pauseSec = PAUSE_SENTENCE_SEC;
      if (boundary === 'paragraph') pauseSec = PAUSE_PARAGRAPH_SEC;
      else if (boundary === 'clause') pauseSec = PAUSE_CLAUSE_SEC;

      const pauseSamples = Math.round(samplingRate * pauseSec);
      gaps.push(pauseSamples);
      totalLength += pauseSamples;
    }
  }

  const combinedAudio = new Float32Array(totalLength);
  let offset = 0;
  for (let i = 0; i < results.length; i++) {
    combinedAudio.set(results[i], offset);
    offset += results[i].length;
    if (i < results.length - 1) {
      const boundary = boundaryTypes[i] || 'sentence';
      let pauseSec = PAUSE_SENTENCE_SEC;
      if (boundary === 'paragraph') pauseSec = PAUSE_PARAGRAPH_SEC;
      else if (boundary === 'clause') pauseSec = PAUSE_CLAUSE_SEC;
      const pauseSamples = Math.round(samplingRate * pauseSec);
      offset += pauseSamples;
    }
  }

  return { audio: combinedAudio, sampling_rate: samplingRate };
}

// ─── WAV encoding ─────────────────────────────────────────────────────────────

export function audioToWavBlob(float32, sampleRate) {
  const numCh = 1, bitsPerSample = 16;
  const dataLen = float32.length * 2;
  const buf = new ArrayBuffer(44 + dataLen);
  const view = new DataView(buf);
  const ws = (off, str) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); };
  ws(0, 'RIFF'); view.setUint32(4, 36 + dataLen, true);
  ws(8, 'WAVE'); ws(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, (sampleRate * numCh * bitsPerSample) / 8, true);
  view.setUint16(32, (numCh * bitsPerSample) / 8, true); view.setUint16(34, bitsPerSample, true);
  ws(36, 'data'); view.setUint32(40, dataLen, true);
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? Math.floor(s * 32768) : Math.floor(s * 32767);
  }
  new Uint8Array(buf, 44).set(new Uint8Array(int16.buffer));
  return new Blob([view], { type: 'audio/wav' });
}

export function formatTime(seconds) {
  if (isNaN(seconds) || !isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
