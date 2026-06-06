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

// ─── Markdown stripping ──────────────────────────────────────────────────────

/**
 * Convert a KaTeX/LaTeX expression to a rough spoken equivalent.
 * @param {string} expr
 * @returns {string}
 */
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

/**
 * Strip markdown syntax from text before sending to TTS.
 * Converts structural markdown to natural spoken equivalents rather than
 * deleting it — e.g. "# Heading" → "Heading", "**bold**" → "bold".
 * @param {string} text
 * @returns {string}
 */
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

  // Headings — strip # markers, keep the text
  t = t.replace(/^#{1,6}\s+(.+)$/gm, '$1');

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

  // Inline code — keep the content
  t = t.replace(/`([^`]+)`/g, '$1');

  // Links — keep the label, drop the URL
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

// ─── Text normalization ───────────────────────────────────────────────────────

/**
 * Sanitizes input text following the official Supertonic preprocessing spec.
 * Keeps punctuation the model handles natively (colons, semicolons, hyphens).
 * @param {string} text
 * @returns {string}
 */
function normalizeTextForTTS(text) {
  if (!text) return '';
  let p = text;

  // 1. Em-dashes and en-dashes to comma (natural pause)
  p = p.replace(/[–—]/g, ', ');
  // Triple/double hyphens used as em-dash stand-ins
  p = p.replace(/---/g, ', ');
  p = p.replace(/--/g, ', ');

  // 2. Expand common abbreviations the model can't pronounce
  p = p.replace(/\be\.g\.\s*/gi, 'for example, ');
  p = p.replace(/\bi\.e\.\s*/gi, 'that is, ');
  p = p.replace(/@/g, ' at ');

  // 3. Normalize apostrophes: protect contractions, remove decorative quotes.
  // First normalize all apostrophe-like chars between letters to straight apostrophe.
  p = p.replace(/([A-Za-z])[''`ʼ′]([A-Za-z])/g, "$1'$2");
  // Remove decorative/curly quotes that aren't part of contractions (keep straight ')
  p = p.replace(/[''`ʼ′]/g, '');

  // 4. Smart/curly double quotes to remove
  p = p.replace(/[""„‟"]/g, '');

  // 5. Brackets/parentheses to space (NOT commas — avoids artificial split points)
  p = p.replace(/[()[\]{}]/g, ' ');

  // 6. Pipes, slashes, hash, underscores, decorative symbols to space
  p = p.replace(/[|/\\#_*~+←↙❤♥★☆©®™]/g, ' ');

  // 7. Remove emoji (surrogate pairs and common emoji ranges)
  p = p.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, ' ');

  // 8. Collapse whitespace
  p = p.replace(/\s+/g, ' ');

  // 9. Fix punctuation spacing: remove space before . , ! ? ; :
  p = p.replace(/\s+([.,!?;:])/g, '$1');

  // 10. Collapse duplicate commas and fix comma spacing
  p = p.replace(/,+/g, ',');
  p = p.replace(/,\s*/g, ', ');

  // 11. Collapse duplicate periods
  p = p.replace(/\.{2,}/g, '.');

  return p.trim();
}

// ─── Sentence splitting ──────────────────────────────────────────────────────

const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'ave', 'blvd',
  'inc', 'ltd', 'co', 'corp', 'vs', 'vol', 'dept', 'est', 'approx',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
  'fig', 'eq', 'no', 'ref', 'ch', 'sec', 'pt', 'pg',
]);

/**
 * Splits text into synthesis-ready chunks following the official Supertonic
 * chunking spec: sentence-boundary aware, abbreviation-safe, with min/max
 * size constraints and auto-period on every chunk.
 * @param {string} text
 * @returns {string[]}
 */
function splitIntoSentences(text) {
  if (!text) return [];

  const MAX_CHUNK = 250;
  const MIN_CHUNK = 80;

  // Split into raw sentences at . ! ? boundaries, respecting abbreviations
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

      // Single uppercase letter + period = initial (e.g. "J.")
      if (/^[A-Z]\.$/.test(trimmed)) continue;

      // Period followed by lowercase = not a sentence boundary
      const nextToken = tokens[i + 1]?.trim() || tokens[i + 2]?.trim() || '';
      if (nextToken && /^[a-z]/.test(nextToken)) continue;

      // Number + period with digits following = decimal
      if (/\d\.$/.test(trimmed)) {
        const next = tokens[i + 1]?.trim() || tokens[i + 2]?.trim() || '';
        if (/^\d/.test(next)) continue;
      }
    }

    // Real sentence boundary
    const sentence = buffer.trim();
    if (sentence) rawSentences.push(sentence);
    buffer = '';
  }
  const remaining = buffer.trim();
  if (remaining) rawSentences.push(remaining);

  if (rawSentences.length === 0) return [text.trim()];

  // Merge short sentences with neighbors, split long ones at clause boundaries
  const result = [];
  let accumulator = '';

  for (const sentence of rawSentences) {
    if (!accumulator) {
      accumulator = sentence;
    } else {
      const merged = accumulator + ' ' + sentence;
      if (merged.length <= MAX_CHUNK) {
        accumulator = merged;
      } else {
        result.push(accumulator);
        accumulator = sentence;
      }
    }

    if (accumulator.length > MAX_CHUNK) {
      const parts = accumulator.split(/([,;:]\s*)/);
      let current = '';
      for (let j = 0; j < parts.length; j++) {
        const candidate = current + parts[j];
        if (candidate.length > MAX_CHUNK && current.length >= MIN_CHUNK) {
          result.push(current.trim());
          current = parts[j];
        } else {
          current = candidate;
        }
      }
      accumulator = current;
    }
  }

  if (accumulator.trim()) {
    // Merge short final chunk with previous if possible
    if (accumulator.trim().length < MIN_CHUNK && result.length > 0) {
      const prev = result[result.length - 1];
      if ((prev + ' ' + accumulator.trim()).length <= MAX_CHUNK) {
        result[result.length - 1] = prev + ' ' + accumulator.trim();
      } else {
        result.push(accumulator.trim());
      }
    } else {
      result.push(accumulator.trim());
    }
  }

  // Auto-append period — the model performs better with a clear end-of-utterance signal
  for (let i = 0; i < result.length; i++) {
    if (!/[.!?]$/.test(result[i])) {
      result[i] += '.';
    }
  }

  return result.filter((s) => s.length > 0);
}

// ─── Synthesis ────────────────────────────────────────────────────────────────

export async function synthesize(pipe, text, embedding, speed, steps) {
  const cleanedText = normalizeTextForTTS(text);
  const sentences = splitIntoSentences(cleanedText);

  if (sentences.length === 0) {
    return { audio: new Float32Array(0), sampling_rate: 22050 };
  }

  const results = [];
  let samplingRate = 22050;

  for (const sentence of sentences) {
    if (sentence.trim().length === 0) continue;
    const output = await pipe(sentence, {
      speaker_embeddings: embedding,
      num_inference_steps: steps || 10,
      speed: speed || 1.0,
    });
    if (output && output.audio) {
      results.push(output.audio);
      if (output.sampling_rate) {
        samplingRate = output.sampling_rate;
      }
    }
  }

  if (results.length === 0) {
    return { audio: new Float32Array(0), sampling_rate: samplingRate };
  }

  // Concatenate audio arrays with 0.35s silence between chunks
  const silenceDuration = 0.35;
  const silenceLength = Math.round(samplingRate * silenceDuration);
  const silenceBuffer = new Float32Array(silenceLength);

  let totalLength = 0;
  for (let i = 0; i < results.length; i++) {
    totalLength += results[i].length;
    if (i < results.length - 1) {
      totalLength += silenceLength;
    }
  }

  const combinedAudio = new Float32Array(totalLength);
  let offset = 0;
  for (let i = 0; i < results.length; i++) {
    combinedAudio.set(results[i], offset);
    offset += results[i].length;
    if (i < results.length - 1) {
      combinedAudio.set(silenceBuffer, offset);
      offset += silenceLength;
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
