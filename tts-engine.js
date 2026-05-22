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
    if (device === 'wasm') {
      env.backends.onnx.wasm.numThreads = 8;
      env.backends.onnx.wasm.simd = true;
    }

    const opts = { device };
    if (onProgress) opts.progress_callback = onProgress;

    try {
      cachedPipeline = await pipeline('text-to-speech', MODEL_ID, opts);
    } catch (firstErr) {
      if (device === 'webgpu') {
        env.backends.onnx.wasm.numThreads = 8;
        env.backends.onnx.wasm.simd = true;
        try {
          cachedPipeline = await pipeline('text-to-speech', MODEL_ID, {
            device: 'wasm',
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
  if (!response.ok) throw new Error(`Voice file not found: ${voice}`);
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

function normalizeTextForTTS(text) {
  if (!text) return "";
  let processed = text;
  
  // 1. Normalize em-dashes and en-dashes to a comma for natural pausing
  processed = processed.replace(/[\u2013\u2014]/g, ', ');
  
  // 2. Replace hyphens with spaces to prevent word bonding
  processed = processed.replace(/-/g, ' ');
  
  // 3. Replace colons and semicolons with commas for natural pauses
  processed = processed.replace(/[:;]/g, ',');
  
  // 4. Normalize internal apostrophes (contractions/possessives) to standard ASCII apostrophe
  processed = processed.replace(/([A-Za-z])['’‘`\u02BC]([A-Za-z])/g, "$1__APOSTROPHE__$2");
  // Remove all other standalone single quotes/apostrophes
  processed = processed.replace(/['’‘`\u02BC]/g, '');
  // Restore internal apostrophes as standard ASCII apostrophe
  processed = processed.replace(/__APOSTROPHE__/g, "'");
  
  // 5. Remove double quotes
  processed = processed.replace(/["“”]/g, '');
  
  // 6. Replace parentheses/brackets with commas/spaces for pacing
  processed = processed.replace(/[()\[\]{}]/g, ' , ');
  
  // 7. Clean up slashes, underscores, and other non-standard punctuation
  processed = processed.replace(/[\/\\#@_*~+]/g, ' ');
  
  // 8. Collapse multiple spaces
  processed = processed.replace(/\s+/g, ' ');
  
  // 9. Collapse multiple commas and clean up comma spacing
  processed = processed.replace(/,+/g, ',');
  processed = processed.replace(/\s*,\s*/g, ', ');
  
  // 10. Clean up space before punctuation
  processed = processed.replace(/\s+\./g, '.');
  processed = processed.replace(/\s+,/g, ',');
  processed = processed.replace(/\s+\?/g, '?');
  processed = processed.replace(/\s+\!/g, '!');
  return processed.trim();
}

function splitIntoSentences(text) {
  if (!text) return [];
  // First pass: split on sentence-ending punctuation
  const regex = /[^.!?]+(?:[.!?]+(?:\s+|$)|$)/g;
  const matches = text.match(regex);
  if (!matches) return [text];
  const sentences = matches.map(s => s.trim()).filter(s => s.length > 0);

  // Second pass: break long sentences at comma boundaries
  const MAX_CHUNK = 60;
  const result = [];
  for (const sentence of sentences) {
    if (sentence.length <= MAX_CHUNK) {
      result.push(sentence);
      continue;
    }
    // Split at commas, then re-group into chunks under MAX_CHUNK
    const parts = sentence.split(/,\s*/);
    let current = parts[0];
    for (let i = 1; i < parts.length; i++) {
      const candidate = current + ', ' + parts[i];
      if (candidate.length > MAX_CHUNK && current.length > 0) {
        result.push(current);
        current = parts[i];
      } else {
        current = candidate;
      }
    }
    if (current.length > 0) result.push(current);
  }
  return result;
}

export async function synthesize(pipe, text, embedding, speed, steps) {
  const cleanedText = normalizeTextForTTS(text);
  const sentences = splitIntoSentences(cleanedText);
  
  if (sentences.length === 0) {
    return { audio: new Float32Array(0), sampling_rate: 44100 };
  }

  const results = [];
  let samplingRate = 44100;

  for (const sentence of sentences) {
    if (sentence.trim().length === 0) continue;
    const output = await pipe(sentence, {
      speaker_embeddings: embedding,
      num_inference_steps: steps || 20,
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

  // Concatenate audio arrays with a brief silence in between sentences
  const silenceDuration = 0.2; // seconds
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

export function audioToWavBlob(float32, sampleRate) {
  const numCh = 1, bps = 2;
  const dataLen = float32.length * bps;
  const buf = new ArrayBuffer(44 + dataLen);
  const view = new DataView(buf);
  const ws = (off, str) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); };
  ws(0, 'RIFF'); view.setUint32(4, 36 + dataLen, true);
  ws(8, 'WAVE'); ws(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numCh * bps, true);
  view.setUint16(32, numCh * bps, true); view.setUint16(34, bps * 8, true);
  ws(36, 'data'); view.setUint32(40, dataLen, true);
  const pcm = new Int16Array(buf, 44);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    pcm[i] = s < 0 ? s * 32768 : s * 32767;
  }
  return new Blob([view], { type: 'audio/wav' });
}

export function formatTime(seconds) {
  if (isNaN(seconds) || !isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
