import { ALL_FORMATS, AudioSampleSink, BlobSource, Input } from 'mediabunny';

export const WHISPER_RATE = 16000;

/**
 * Decodes [start, end) of the first audio track to 16 kHz mono Float32 for Whisper.
 * Channels are averaged and each output sample is the mean of the input span it covers
 * (fractional edges are weighted), carried across buffers so the rate is exactly 16 kHz. Memory stays at one window.
 */
export async function decodeWindow(file: Blob, start: number, end: number): Promise<Float32Array> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const track = await input.getPrimaryAudioTrack();
  if (!track) throw new Error('This file has no audio track.');
  const out = new Float32Array(Math.ceil((end - start) * WHISPER_RATE));
  let n = 0, acc = 0, filled = 0; // `filled` is how much of the current output sample's window (`step` inputs wide) is covered
  // AudioSample (WebCodecs) rather than AudioBuffer (Web Audio): this runs in a worker, which has no AudioBuffer.
  for await (const sample of new AudioSampleSink(track).samples(start, end)) {
    const ch = sample.numberOfChannels, len = sample.numberOfFrames, step = sample.sampleRate / WHISPER_RATE;
    // samples are whole codec frames, so the first can begin before `start` and the last can run past `end`
    const from = Math.max(0, Math.round((start - sample.timestamp) * sample.sampleRate));
    const planes = Array.from({ length: ch }, (_, c) => {
      const p = new Float32Array(len);
      sample.copyTo(p, { planeIndex: c, format: 'f32-planar' });
      return p;
    });
    sample.close();
    for (let i = from; i < len && n < out.length; i++) {
      let s = 0;
      for (let c = 0; c < ch; c++) s += planes[c]![i]!;
      s /= ch;
      for (let left = 1; left > 1e-9;) { // an input sample can straddle two output samples
        const take = Math.min(left, step - filled);
        acc += s * take; filled += take; left -= take;
        if (filled >= step - 1e-9) { out[n++] = acc / step; acc = 0; filled = 0; }
      }
    }
  }
  return out.subarray(0, n);
}

export async function audioDuration(file: Blob): Promise<number> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const track = await input.getPrimaryAudioTrack();
  if (!track) throw new Error('This file has no audio track.');
  return track.computeDuration();
}
