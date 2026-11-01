import { env, pipeline } from '@huggingface/transformers';
import gpuMjs from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs?url';
import gpuWasm from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm?url';
import plainMjs from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url';
import plainWasm from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url';
import { audioDuration, decodeWindow } from './audio';
import type { FromWorker, ToWorker, TranscriptChunk } from './transcribe';

// Pinned: a changed model must be a reviewed change, not whatever the hub serves today.
const MODEL = 'onnx-community/whisper-base';
const REVISION = '1846881b6b3a3024392c1eea3ad983695bc23925';
const WINDOW = 600; // seconds decoded and transcribed at a time, so a 100 minute file never sits in memory whole

env.allowLocalModels = false;
const send = (m: FromWorker) => postMessage(m);

async function load(device: 'webgpu' | 'wasm') {
  // The runtime comes from our own origin (CSP: script-src 'self'), never a CDN.
  env.backends.onnx.wasm!.wasmPaths = device === 'webgpu' ? { mjs: gpuMjs, wasm: gpuWasm } : { mjs: plainMjs, wasm: plainWasm };
  const files = new Map<string, { loaded: number; total: number }>();
  return pipeline('automatic-speech-recognition', MODEL, {
    revision: REVISION, device,
    dtype: device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8',
    progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status !== 'progress' || !p.file) return;
      files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
      let l = 0, t = 0;
      for (const f of files.values()) { l += f.loaded; t += f.total; }
      if (t) send({ type: 'progress', stage: 'model', value: l / t });
    }
  });
}

async function run(file: File, language: string | undefined, want: 'webgpu' | 'wasm' | undefined, range: { start: number; end: number } | undefined) {
  // A browser can expose navigator.gpu and still have no adapter (blocklisted GPU, headless). Ask first:
  // once the runtime has failed to start WebGPU in this worker it will not start wasm either.
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  const device: 'webgpu' | 'wasm' = want ?? ((await gpu?.requestAdapter().catch(() => null)) ? 'webgpu' : 'wasm');
  const asr = await load(device);
  const total = Math.min(range?.end ?? Infinity, await audioDuration(file));
  const from = Math.max(0, range?.start ?? 0);
  const chunks: TranscriptChunk[] = [];
  for (let t = from; t < total; t += WINDOW) {
    const end = Math.min(total, t + WINDOW);
    const audio = await decodeWindow(file, t, end);
    if (audio.length < 16000) break; // under a second left
    const r = await asr(audio, { chunk_length_s: 30, stride_length_s: 5, return_timestamps: true, ...(language ? { language } : {}) });
    for (const c of (Array.isArray(r) ? r[0] : r).chunks ?? []) {
      const [s, e] = c.timestamp;
      const text = String(c.text).trim();
      if (text) chunks.push({ start: t + s, end: t + (e ?? s + 2), text });
    }
    send({ type: 'progress', stage: 'transcribe', value: (end - from) / (total - from) });
  }
  send({ type: 'done', chunks, device });
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  if (e.data.type !== 'start') return;
  run(e.data.file, e.data.language, e.data.device, e.data.range).catch(err => send({ type: 'error', message: err instanceof Error ? err.message : String(err) }));
};
