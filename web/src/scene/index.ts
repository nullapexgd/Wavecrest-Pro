import {
  BufferGeometry, Group, Line, LineBasicMaterial, Mesh, PerspectiveCamera, Scene, Vector2, Vector3,
  Float32BufferAttribute, WebGLRenderer
} from 'three';
import { CRESTS, GRID, WORLD, buildField, formatViews, heightAt, nearestVideo, type Video } from '../data/sample';
import { applyPalette, buildRelief, createShared, Marks, type Shared } from './relief';
import { buildPennants, leadMaterial, loadProps } from './props';
import { readPalette, watchPalette } from './theme';
import { createUI } from './ui';

export interface SceneOptions {
  canvas: HTMLCanvasElement;
  stage: HTMLElement;
  pin: HTMLElement;
  /** reduced motion, or the visitor opted in from a constrained context: no auto motion */
  staticMode: boolean;
  base: string;
}

export interface SceneHandle {
  dispose(): void;
  setPaused(paused: boolean): void;
  step(dir: 1 | -1): void;
  /** static mode only: jump the story to the hero (0) or chart (1) state */
  setState(p: number): void;
}

const ease = (t: number) => t * t * t * (t * (t * 6 - 15) + 10); // smootherstep
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const FOV = 26;
const TAN = Math.tan((FOV * Math.PI) / 360);

interface Pose { yaw: number; pitch: number; fit: number; shiftX: number; shiftY: number; amp: number }

/** Where the camera sits at the two ends of the story, for this canvas shape. */
function poses(w: number, h: number): { hero: Pose; chart: Pose } {
  const narrow = w < 960;
  return narrow
    ? {
        hero: { yaw: 0.4, pitch: 0.62, fit: 0.8, shiftX: 0, shiftY: 0.2, amp: 1 },
        chart: { yaw: 0, pitch: 1.36, fit: 0.86, shiftX: 0, shiftY: 0.12, amp: 0.035 }
      }
    : {
        hero: { yaw: 0.42, pitch: 0.6, fit: 0.5, shiftX: 0.18, shiftY: 0.03, amp: 1 },
        chart: { yaw: 0, pitch: 1.37, fit: 0.62, shiftX: 0.15, shiftY: 0.02, amp: 0.035 }
      };
}

export async function mountScene(o: SceneOptions): Promise<SceneHandle> {
  const { canvas, stage, pin, staticMode } = o;
  const ui = createUI(stage, pin);

  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'default' });
  } catch (e) {
    throw new Error('WebGL unavailable');
  }
  renderer.setClearColor(0x000000, 0);

  const field = buildField(GRID.nx, GRID.nz);
  let palette = readPalette();
  const shared: Shared = createShared(palette);
  const marks = new Marks(renderer.capabilities.getMaxAnisotropy());
  marks.draw(palette);
  const relief = buildRelief(field, shared, marks);
  const props = await loadProps(o.base);
  const pennants = buildPennants(props, field, shared);

  // The sounding lead hangs from a pivot, so tilting the pivot swings the weight like a pendulum.
  const LEAD_H = 0.5;
  const leadMesh = new Mesh(props.lead, leadMaterial(shared));
  leadMesh.scale.setScalar(LEAD_H / 0.68);
  leadMesh.frustumCulled = false;
  const pivot = new Group();
  leadMesh.position.y = -LEAD_H; // tip at the group origin's foot
  pivot.add(leadMesh);
  pivot.visible = false;
  const cordGeo = new BufferGeometry();
  cordGeo.setAttribute('position', new Float32BufferAttribute(new Float32Array(6), 3));
  const cordMat = new LineBasicMaterial({ color: palette.inkSoft });
  const cord = new Line(cordGeo, cordMat);
  cord.frustumCulled = false;
  cord.visible = false;

  const scene = new Scene();
  // No three.js lights: every surface is shaded by the shared studio light in the shaders.
  scene.add(relief.shadow, relief.skirt, relief.tile, pennants.cloth, pennants.pole, pivot, cord);

  const camera = new PerspectiveCamera(FOV, 1, 0.1, 80);
  const target = new Vector3(0, 0.12, 0);

  // ── state ───────────────────────────────────────────────────────────────────
  let paused = false;
  let visible = true;
  let hidden = document.hidden;
  let raf = 0;
  let dirty = true;
  let width = 1, height = 1;
  let pixelRatio = Math.min(devicePixelRatio, o.stage.clientWidth < 960 ? 1.5 : 1.75);
  const maxPixelRatio = pixelRatio;

  let pStory = staticMode ? 0 : readProgress(); // smoothed
  let pTarget = pStory;
  let intro = staticMode ? 1 : 0;
  let introStart = 0;
  let plant = staticMode ? 1 : 0;

  let orbitYaw = 0, orbitPitch = 0;
  let dragVx = 0, dragVy = 0;
  let dragging = false, down = false, moved = false;
  let startX = 0, startY = 0, lastX = 0, lastY = 0;
  let lastInteraction = performance.now();

  let hoverVideo: Video | null = null;
  let pinned: Video | null = null;
  let hoverPoint: Vector3 | null = null;
  const leadTarget = new Vector3();
  const leadPos = new Vector3();
  const leadVel = new Vector3();
  const anchor = new Vector3();
  let leadOn = 0; // 0..1 presence
  let crestIdx = -1;

  function readProgress(): number {
    const r = stage.getBoundingClientRect();
    const span = Math.max(1, r.height - innerHeight);
    return clamp(-r.top / span, 0, 1);
  }

  // ── layout ─────────────────────────────────────────────────────────────────
  function resize() {
    width = Math.max(1, pin.clientWidth);
    height = Math.max(1, pin.clientHeight);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    dirty = true;
  }

  const outerR = (aspect: number, fit: number) => (WORLD.w / 2) / (TAN * aspect * fit);

  function applyCamera() {
    const { hero, chart } = poses(width, height);
    const e = ease(pStory);
    const aspect = width / height;
    const yaw = lerp(hero.yaw, chart.yaw, e) + orbitYaw * (1 - e);
    const pitch = lerp(hero.pitch, chart.pitch, e) + orbitPitch * (1 - e);
    // distance at which the tile spans `fit` of the canvas width, blended across the story
    const dist = lerp(outerR(aspect, hero.fit), outerR(aspect, chart.fit), e);
    camera.position.set(
      target.x + dist * Math.sin(yaw) * Math.cos(pitch),
      target.y + dist * Math.sin(pitch),
      target.z + dist * Math.cos(yaw) * Math.cos(pitch)
    );
    camera.lookAt(target);
    const sx = lerp(hero.shiftX, chart.shiftX, e), sy = lerp(hero.shiftY, chart.shiftY, e);
    camera.setViewOffset(width, height, -sx * width, -sy * height, width, height);
    camera.updateMatrixWorld();
    return lerp(hero.amp, chart.amp, e);
  }

  // ── picking: march a ray down onto the heightfield ─────────────────────────
  const ndc = new Vector2();
  const origin = new Vector3();
  const dir = new Vector3();
  function pick(clientX: number, clientY: number, amp: number): { p: Vector3; u: number; v: number } | null {
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -(((clientY - r.top) / r.height) * 2 - 1));
    origin.setFromMatrixPosition(camera.matrixWorld);
    dir.set(ndc.x, ndc.y, 0.5).unproject(camera).sub(origin).normalize();
    const hx = WORLD.w / 2, hz = WORLD.d / 2;
    const top = WORLD.amp * 1.05 * amp + 0.05;
    let prev = -1;
    for (let t = 1; t < 30; t += 0.025) {
      const x = origin.x + dir.x * t, y = origin.y + dir.y * t, z = origin.z + dir.z * t;
      if (x < -hx || x > hx || z < -hz || z > hz || y > top + 2) { prev = -1; continue; }
      const u = x / WORLD.w + 0.5, v = z / WORLD.d + 0.5;
      const hy = heightAt(field, u, v) * WORLD.amp * amp;
      if (y <= hy) {
        // refine between the previous sample and this one
        let a = prev > 0 ? prev : t - 0.025, b = t;
        for (let i = 0; i < 6; i++) {
          const m = (a + b) / 2;
          const mx = origin.x + dir.x * m, my = origin.y + dir.y * m, mz = origin.z + dir.z * m;
          const mh = heightAt(field, mx / WORLD.w + 0.5, mz / WORLD.d + 0.5) * WORLD.amp * amp;
          if (my <= mh) b = m; else a = m;
        }
        const px = origin.x + dir.x * b, pz = origin.z + dir.z * b;
        const pu = px / WORLD.w + 0.5, pv = pz / WORLD.d + 0.5;
        return { p: new Vector3(px, heightAt(field, pu, pv) * WORLD.amp * amp, pz), u: pu, v: pv };
      }
      prev = t;
    }
    return null;
  }

  const projected = new Vector3();
  function toScreen(p: Vector3): { x: number; y: number } {
    projected.copy(p).project(camera);
    return { x: (projected.x * 0.5 + 0.5) * width, y: (-projected.y * 0.5 + 0.5) * height };
  }

  function peakPoint(v: Video, amp: number): Vector3 {
    return new Vector3((v.u - 0.5) * WORLD.w, heightAt(field, v.u, v.v) * WORLD.amp * amp, (v.v - 0.5) * WORLD.d);
  }

  // ── interaction ────────────────────────────────────────────────────────────
  let curAmp = 1;
  function onMove(e: PointerEvent) {
    lastInteraction = performance.now();
    if (down) {
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      if (!dragging && Math.hypot(e.clientX - startX, e.clientY - startY) > 6) dragging = true;
      if (dragging) {
        moved = true;
        dragVx = dx * 0.0052; dragVy = dy * 0.004;
        orbitYaw = clamp(orbitYaw - dragVx, -0.55, 0.55);
        orbitPitch = clamp(orbitPitch + dragVy, -0.22, 0.3);
      }
      lastX = e.clientX; lastY = e.clientY;
    }
    if (!dragging) {
      const hit = pick(e.clientX, e.clientY, curAmp);
      if (hit) {
        hoverPoint = hit.p;
        hoverVideo = nearestVideo(hit.u, hit.v);
      } else { hoverPoint = null; hoverVideo = null; }
    }
    dirty = true; wake();
  }
  function onDown(e: PointerEvent) {
    down = true; dragging = false; moved = false;
    startX = lastX = e.clientX; startY = lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    lastInteraction = performance.now();
    if (e.pointerType !== 'mouse') onMove(e); // touch has no hover: a press is the first read
  }
  function onUp(e: PointerEvent) {
    if (!down) return;
    down = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    if (!moved) {
      pinned = hoverVideo && pinned?.id !== hoverVideo.id ? hoverVideo : null;
      if (pinned) ui.announce(describe(pinned));
    }
    dragging = false; dirty = true; wake();
  }
  function onLeave() {
    if (down) return;
    hoverPoint = null; hoverVideo = null; dirty = true; wake();
  }
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && pinned) { pinned = null; dirty = true; wake(); } };

  function describe(v: Video): string {
    return `${v.title}. ${v.rel.toFixed(1)} times the channel median, ${formatViews(v.views)} views. Sample data.`;
  }

  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointerleave', onLeave);
  addEventListener('keydown', onKey);

  // ── loop ───────────────────────────────────────────────────────────────────
  let last = performance.now();
  let tick = 0;
  let frameMs = 16;
  let slow = 0;

  function wake() { if (!raf && visible && !hidden) raf = requestAnimationFrame(frame); }

  function frame(now: number) {
    raf = 0;
    // rAF timestamps can precede a performance.now() taken in a handler, so dt can come out
    // negative; a negative dt runs the smoothing backwards and diverges. Never allow it.
    const dt = clamp((now - last) / 1000, 0, 0.05);
    last = now;
    // Scrolling counts as interaction: scrubbing the story must never drop to the idle frame rate.
    if (!staticMode) {
      const pNow = readProgress();
      if (Math.abs(pNow - pTarget) > 0.0004) lastInteraction = now;
      pTarget = pNow;
    }
    const idle = now - lastInteraction > 3000 && !down;

    // 30fps while idle: the ambient motion is slow, and the GPU deserves the rest
    tick++;
    if (!staticMode && !paused && idle && tick % 2 === 1 && !dirty) { raf = requestAnimationFrame(frame); return; }

    // intro: the relief rises once
    if (intro < 1) {
      if (!introStart) introStart = now;
      intro = clamp((now - introStart) / 760, 0, 1);
    }
    const rise = 1 - Math.pow(1 - intro, 3);
    if (intro >= 1 && plant < 1) plant = clamp(plant + dt / 0.55, 0, 1);

    // story progress
    if (staticMode) pStory = pTarget;
    else {
      pStory += (pTarget - pStory) * (1 - Math.exp(-dt * 9));
      if (Math.abs(pTarget - pStory) < 0.0004) pStory = pTarget;
      pStory = clamp(pStory, 0, 1);
    }
    stage.style.setProperty('--p', pStory.toFixed(4));

    // orbit inertia
    if (!down && (Math.abs(dragVx) > 1e-4 || Math.abs(dragVy) > 1e-4)) {
      orbitYaw = clamp(orbitYaw - dragVx, -0.55, 0.55);
      orbitPitch = clamp(orbitPitch + dragVy, -0.22, 0.3);
      dragVx *= 0.92; dragVy *= 0.92;
    }

    const heroAmp = applyCamera();
    curAmp = heroAmp * rise;
    shared.uAmp!.value = WORLD.amp * curAmp;
    shared.uTime!.value = paused || staticMode ? 0 : now / 1000;
    // Seen from above the flagpoles are just scribbles, and the marks already say "crest":
    // the pennants fold away as the relief flattens.
    pennants.plant.value = plant * (1 - 0.94 * clamp((pStory - 0.2) / 0.5, 0, 1));
    relief.uniforms.markMix.value = clamp((pStory - 0.35) / 0.5, 0, 1);

    // what the probe is on
    const subject = hoverVideo ?? pinned;
    const point = hoverPoint ?? (pinned ? peakPoint(pinned, curAmp) : null);
    if (hoverVideo && hoverPoint) leadTarget.copy(hoverPoint);
    else if (pinned) leadTarget.copy(peakPoint(pinned, curAmp));
    else if (hoverPoint) leadTarget.copy(hoverPoint);
    const want = point && !dragging ? 1 : 0;
    leadOn += (want - leadOn) * (1 - Math.exp(-dt * 14));
    if (point) {
      if (leadOn < 0.05) {
        // first appearance: start at the target instead of flying in from the origin
        leadPos.copy(leadTarget); leadVel.set(0, 0, 0); anchor.set(leadTarget.x, leadTarget.y + 1.7, leadTarget.z);
      }
      // critically damped spring toward the target, so the weight lags and settles like a real one
      const k = 150, c = 2 * Math.sqrt(k) * 0.82;
      for (let i = 0; i < 3; i++) {
        const comp = (['x', 'y', 'z'] as const)[i]!;
        const a = (leadTarget[comp] - leadPos[comp]) * k - leadVel[comp] * c;
        leadVel[comp] += a * dt;
        leadPos[comp] += leadVel[comp] * dt;
      }
      anchor.lerp(new Vector3(leadTarget.x, leadTarget.y + 1.7, leadTarget.z), 1 - Math.exp(-dt * 6));
    } else {
      leadVel.multiplyScalar(0.9);
    }
    const showLead = leadOn > 0.02;
    pivot.visible = showLead; cord.visible = showLead;
    if (showLead) {
      pivot.position.set(leadPos.x, leadPos.y + LEAD_H * leadOn + 0.05 * (1 - leadOn), leadPos.z);
      pivot.scale.setScalar(Math.max(0.001, leadOn));
      pivot.rotation.z = clamp(-leadVel.x * 0.1, -0.5, 0.5);
      pivot.rotation.x = clamp(leadVel.z * 0.1, -0.5, 0.5);
      const a = cordGeo.attributes.position as Float32BufferAttribute;
      a.setXYZ(0, anchor.x, anchor.y, anchor.z);
      a.setXYZ(1, pivot.position.x, pivot.position.y, pivot.position.z); // the eyelet is the pivot
      a.needsUpdate = true;
    }

    // inspector follows the probe in screen space
    if (subject && point) {
      const s = toScreen(point);
      ui.show(subject, s.x, s.y, !!pinned && subject.id === pinned.id);
      relief.uniforms.hover.set((point.x / WORLD.w) + 0.5, (point.z / WORLD.d) + 0.5, 0.2, 0.85);
    } else {
      ui.hide();
      relief.uniforms.hover.w = 0;
    }

    // projected annotations for the crests, shown as the relief flattens
    if (pStory > 0.55) {
      ui.place(CRESTS.map((c, i) => {
        const s = toScreen(peakPoint(c, curAmp));
        return { index: i, x: s.x, y: s.y };
      }));
    }

    renderer.render(scene, camera);
    if (!stage.classList.contains('is-3d')) ui.ready();
    dirty = false;

    // quality governor: shed resolution before the page ever feels heavy
    frameMs += ((performance.now() - now) - frameMs) * 0.05;
    if (frameMs > 12 && pixelRatio > 1) { if (++slow > 40) { pixelRatio = Math.max(1, pixelRatio - 0.25); slow = 0; resize(); } }
    else slow = Math.max(0, slow - 1);

    const animating = intro < 1 || plant < 1 || Math.abs(pTarget - pStory) > 0.0004 || down
      || Math.abs(dragVx) > 1e-4 || Math.abs(dragVy) > 1e-4 || leadOn > 0.02 && (leadVel.length() > 0.01 || want === 0 && leadOn > 0.03)
      || Math.abs(leadOn - want) > 0.02;
    const ambient = !staticMode && !paused; // pennants flutter and the scroll is scrubbed
    if (visible && !hidden && (ambient || animating || dirty)) raf = requestAnimationFrame(frame);
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────
  const ro = new ResizeObserver(() => { resize(); wake(); });
  ro.observe(pin);
  const io = new IntersectionObserver(([en]) => {
    visible = !!en?.isIntersecting;
    if (visible) { last = performance.now(); wake(); }
  });
  io.observe(stage);
  const onVis = () => { hidden = document.hidden; if (!hidden) { last = performance.now(); wake(); } };
  document.addEventListener('visibilitychange', onVis);
  const stopTheme = watchPalette(() => {
    palette = readPalette();
    applyPalette(shared, palette);
    cordMat.color.copy(palette.inkSoft);
    marks.draw(palette);
    dirty = true; wake();
  });
  const onLost = (e: Event) => { e.preventDefault(); ui.lost(); };
  const onRestored = () => { dirty = true; ui.ready(); wake(); };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  resize();
  wake();

  return {
    dispose() {
      cancelAnimationFrame(raf); raf = 0; visible = false;
      ro.disconnect(); io.disconnect(); stopTheme();
      document.removeEventListener('visibilitychange', onVis);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      removeEventListener('keydown', onKey);
      relief.dispose(); pennants.dispose(); props.lead.dispose(); cordGeo.dispose(); cordMat.dispose();
      (leadMesh.material as { dispose(): void }).dispose(); marks.texture.dispose();
      renderer.dispose();
      ui.lost();
    },
    setPaused(p) { paused = p; dirty = true; wake(); },
    setState(p) { pTarget = p; dirty = true; wake(); },
    step(dir) {
      lastInteraction = performance.now();
      crestIdx = (crestIdx + dir + CRESTS.length) % CRESTS.length;
      const v = CRESTS[crestIdx]!;
      pinned = v; hoverVideo = null; hoverPoint = null;
      ui.announce(describe(v));
      dirty = true; wake();
    }
  };
}
