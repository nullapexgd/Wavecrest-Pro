export interface TranscriptChunk { start: number; end: number; text: string }
export type ToWorker = { type: 'start'; file: File; language?: string; device?: 'webgpu' | 'wasm'; range?: { start: number; end: number } };
export type FromWorker =
  | { type: 'progress'; stage: 'model' | 'transcribe'; value: number }
  | { type: 'done'; chunks: TranscriptChunk[]; device: 'webgpu' | 'wasm' }
  | { type: 'error'; message: string };

export interface TranscribeOptions { language?: string; range?: { start: number; end: number } /* seconds; default the whole file */; device?: 'webgpu' | 'wasm'; /* default: WebGPU when present, else wasm */ onProgress?: (stage: 'model' | 'transcribe', value: number) => void }

/**
 * Transcribes a file on this device in a Web Worker. Cancelling ends the worker, which frees the
 * model and the decoded audio at once; there is nothing to clean up on the server.
 */
export function transcribe(file: File, o: TranscribeOptions = {}) {
  const worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });
  let settle: { resolve(v: { chunks: TranscriptChunk[]; device: 'webgpu' | 'wasm' }): void; reject(e: Error): void };
  const result = new Promise<{ chunks: TranscriptChunk[]; device: 'webgpu' | 'wasm' }>((resolve, reject) => { settle = { resolve, reject }; });
  worker.onmessage = (e: MessageEvent<FromWorker>) => {
    const m = e.data;
    if (m.type === 'progress') o.onProgress?.(m.stage, m.value);
    else { worker.terminate(); if (m.type === 'done') settle.resolve({ chunks: m.chunks, device: m.device }); else settle.reject(new Error(m.message)); }
  };
  worker.onerror = e => { worker.terminate(); settle.reject(new Error(e.message || 'The transcriber stopped.')); };
  worker.postMessage({ type: 'start', file, language: o.language, device: o.device, range: o.range } satisfies ToWorker);
  return { result, cancel() { worker.terminate(); settle.reject(new Error('Cancelled')); } };
}
