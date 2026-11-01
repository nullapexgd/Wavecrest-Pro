import {
  ALL_FORMATS, BlobSource, BufferTarget, CanvasSink, CanvasSource, EncodedAudioPacketSource,
  EncodedPacketSink, Input, Mp4OutputFormat, Output
} from 'mediabunny';

/** One caption line, in seconds from the start of the SOURCE file. */
export interface Caption { start: number; end: number; text: string }
export interface RenderOptions {
  start: number;
  duration: number;
  layout: 'blur' | 'fit';
  captions?: Caption[];
  onProgress?: (done: number) => void;
}

const W = 1080;
const H = 1920;
const FPS = 30;

/**
 * Cuts one vertical clip out of a file the user picked, entirely on their device.
 * The file is read lazily through the Blob (never loaded whole) and the audio packets are
 * copied, not re-encoded. Measured in the spike: a 35 s clip from a 1.1 GB source in about 5 s.
 */
export async function renderClip(file: Blob, o: RenderOptions): Promise<{ bytes: Uint8Array; width: number; height: number; frames: number }> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const vt = await input.getPrimaryVideoTrack();
  if (!vt) throw new Error('This file has no video track.');
  const at = await input.getPrimaryAudioTrack();
  const end = o.start + o.duration;

  const out = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d')!;
  const vsrc = new CanvasSource(canvas, { codec: 'avc', bitrate: 6e6 });
  out.addVideoTrack(vsrc, { frameRate: FPS });
  const asrc = at ? new EncodedAudioPacketSource(at.codec ?? 'aac') : null;
  if (asrc) out.addAudioTrack(asrc);
  await out.start();

  const sw = vt.displayWidth, sh = vt.displayHeight;
  const fh = Math.round((W * sh) / sw);
  let frames = 0;
  for await (const { canvas: frame, timestamp } of new CanvasSink(vt, { poolSize: 3 }).canvases(o.start, end)) {
    if (o.layout === 'blur') {
      const s = H / sh;
      ctx.filter = 'blur(40px) brightness(0.6)';
      ctx.drawImage(frame, (W - sw * s) / 2, 0, sw * s, H);
      ctx.filter = 'none';
    } else {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
    }
    ctx.drawImage(frame, 0, (H - fh) / 2, W, fh);
    const cap = o.captions?.find(c => timestamp >= c.start && timestamp < c.end);
    if (cap) drawCaption(ctx, cap.text);
    await vsrc.add(timestamp - o.start, 1 / FPS);
    frames++;
    o.onProgress?.(Math.min(1, (timestamp - o.start) / o.duration));
  }

  if (asrc && at) {
    const sink = new EncodedPacketSink(at);
    const decoderConfig = await at.getDecoderConfig();
    let first = true;
    for (let p = await sink.getPacket(o.start); p && p.timestamp < end; p = await sink.getNextPacket(p)) {
      if (p.timestamp < o.start) continue;
      await asrc.add(p.clone({ timestamp: p.timestamp - o.start }), first ? { decoderConfig: decoderConfig ?? undefined } : undefined);
      first = false;
    }
  }

  await out.finalize();
  return { bytes: new Uint8Array(out.target.buffer!), width: W, height: H, frames };
}

function drawCaption(ctx: OffscreenCanvasRenderingContext2D, text: string) {
  ctx.fillStyle = 'rgba(0,0,0,.55)';
  ctx.fillRect(60, 1500, W - 120, 160);
  ctx.fillStyle = '#fff';
  ctx.font = '800 64px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text, W / 2, 1600, W - 160);
}
