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

export async function synthesize(pipe, text, embedding, speed, steps) {
  const result = await pipe(text, {
    speaker_embeddings: embedding,
    num_inference_steps: steps || 5,
    speed: speed || 1.0,
  });
  return result;
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
