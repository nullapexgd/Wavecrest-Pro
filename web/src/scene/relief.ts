import {
  BufferAttribute, BufferGeometry, CanvasTexture, Color, DoubleSide, LinearFilter, LinearMipmapLinearFilter,
  Mesh, PlaneGeometry, ShaderMaterial, Sphere, SRGBColorSpace, Vector2, Vector3, Vector4,
  type IUniform
} from 'three';
import { VIDEOS, WORLD, type Field } from '../data/sample';
import type { Palette } from './theme';
import {
  reliefFrag, reliefVert, shadowFrag, shadowVert, skirtFrag, skirtVert
} from './shaders';

export type Shared = Record<string, IUniform>;

/** Uniforms every material points at. Updating one object here updates every shader. */
export function createShared(p: Palette): Shared {
  return {
    uPaper: { value: p.paper.clone() }, uPaper2: { value: p.paper2.clone() },
    uLit: { value: p.lit.clone() }, uShade: { value: p.shade.clone() },
    uInk: { value: p.ink.clone() }, uTide: { value: p.tide.clone() }, uSignal: { value: p.signal.clone() },
    uMetalLo: { value: p.metalLo.clone() }, uMetalHi: { value: p.metalHi.clone() },
    uShadowCol: { value: p.shadow.clone() },
    uAmp: { value: 0 }, uTime: { value: 0 }, uSkirt: { value: WORLD.skirt }
  };
}

export function applyPalette(shared: Shared, p: Palette): void {
  const set = (k: string, c: Color) => (shared[k]!.value as Color).copy(c);
  set('uPaper', p.paper); set('uPaper2', p.paper2); set('uLit', p.lit); set('uShade', p.shade);
  set('uInk', p.ink); set('uTide', p.tide); set('uSignal', p.signal);
  set('uMetalLo', p.metalLo); set('uMetalHi', p.metalHi); set('uShadowCol', p.shadow);
}

const BOUNDS = new Sphere(new Vector3(0, 0, 0), 6);

/** Chart marks, baked once into a texture the relief shader samples when it flattens. */
export class Marks {
  readonly texture: CanvasTexture;
  private readonly canvas = document.createElement('canvas');

  constructor(maxAniso: number) {
    this.canvas.width = 1024;
    this.canvas.height = 640;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.minFilter = LinearMipmapLinearFilter;
    this.texture.magFilter = LinearFilter;
    this.texture.anisotropy = Math.min(4, maxAniso);
  }

  draw(p: Palette): void {
    const ctx = this.canvas.getContext('2d')!;
    const { width: W, height: H } = this.canvas;
    ctx.clearRect(0, 0, W, H);
    const css = (c: Color) => `#${c.getHexString()}`;
    for (const v of VIDEOS) {
      const x = v.u * W;
      const y = (1 - v.v) * H; // texture rows run bottom to top
      if (v.crest) {
        ctx.beginPath(); ctx.arc(x, y, 22, 0, Math.PI * 2);
        ctx.lineWidth = 2.5; ctx.strokeStyle = css(p.ink); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2);
        ctx.fillStyle = css(p.signal); ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = css(p.paper2); ctx.stroke();
      } else {
        const r = 4 + Math.min(5, Math.log2(v.rel + 1) * 1.8);
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = css(p.tide); ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = css(p.paper2); ctx.stroke();
      }
    }
    this.texture.needsUpdate = true;
  }
}

export interface Relief {
  tile: Mesh;
  skirt: Mesh;
  shadow: Mesh;
  uniforms: { hover: Vector4; markMix: IUniform; crest: IUniform };
  dispose(): void;
}

export function buildRelief(field: Field, shared: Shared, marks: Marks): Relief {
  const { nx, nz } = field;
  const count = nx * nz;
  const pos = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const aH = new Float32Array(count);
  const aG = new Float32Array(count * 2);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      pos[k * 3] = (i / (nx - 1) - 0.5) * WORLD.w;
      pos[k * 3 + 2] = (j / (nz - 1) - 0.5) * WORLD.d;
      uv[k * 2] = i / (nx - 1);
      uv[k * 2 + 1] = j / (nz - 1);
      aH[k] = field.h[k] as number;
      aG[k * 2] = field.gx[k] as number;
      aG[k * 2 + 1] = field.gz[k] as number;
    }
  }
  const index = new Uint16Array((nx - 1) * (nz - 1) * 6);
  let t = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = (j + 1) * nx + i, c = a + 1, d = b + 1;
      index.set([a, b, c, c, b, d], t);
      t += 6;
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('uv', new BufferAttribute(uv, 2));
  geo.setAttribute('aH', new BufferAttribute(aH, 1));
  geo.setAttribute('aG', new BufferAttribute(aG, 2));
  geo.setIndex(new BufferAttribute(index, 1));
  geo.boundingSphere = BOUNDS; // the shader displaces vertices, so the CPU bounds would lie

  const hover = new Vector4(0.5, 0.5, 0.2, 0);
  const markMix: IUniform = { value: 0 };
  const crest: IUniform = { value: field.crestH };
  const tileMat = new ShaderMaterial({
    vertexShader: reliefVert,
    fragmentShader: reliefFrag,
    uniforms: {
      ...shared,
      uContour: { value: 18 }, uCrestH: crest, uMarkMix: markMix,
      uMarks: { value: marks.texture }, uHover: { value: hover }, uWorld: { value: new Vector2(WORLD.w, WORLD.d) }
    }
  });
  const tile = new Mesh(geo, tileMat);
  tile.frustumCulled = false;

  // Skirt: four walls from the tile's edge down to the plinth, so it reads as an object.
  const sPos: number[] = [], sH: number[] = [], sT: number[] = [], sN: number[] = [], sIdx: number[] = [];
  const wall = (ids: number[], nxn: number, nzn: number) => {
    const base = sPos.length / 3;
    for (const k of ids) for (const tt of [0, 1]) {
      sPos.push(pos[k * 3] as number, 0, pos[k * 3 + 2] as number);
      sH.push(aH[k] as number); sT.push(tt); sN.push(nxn, 0, nzn);
    }
    for (let q = 0; q < ids.length - 1; q++) {
      const o = base + q * 2;
      sIdx.push(o, o + 1, o + 2, o + 2, o + 1, o + 3);
    }
  };
  const row = (j: number) => Array.from({ length: nx }, (_, i) => j * nx + i);
  const col = (i: number) => Array.from({ length: nz }, (_, j) => j * nx + i);
  wall(row(nz - 1), 0, 1); wall(row(0), 0, -1); wall(col(0), -1, 0); wall(col(nx - 1), 1, 0);
  const sGeo = new BufferGeometry();
  sGeo.setAttribute('position', new BufferAttribute(new Float32Array(sPos), 3));
  sGeo.setAttribute('normal', new BufferAttribute(new Float32Array(sN), 3));
  sGeo.setAttribute('aH', new BufferAttribute(new Float32Array(sH), 1));
  sGeo.setAttribute('aT', new BufferAttribute(new Float32Array(sT), 1));
  sGeo.setIndex(sIdx);
  sGeo.boundingSphere = BOUNDS;
  const skirt = new Mesh(sGeo, new ShaderMaterial({
    vertexShader: skirtVert, fragmentShader: skirtFrag, uniforms: { ...shared }, side: DoubleSide
  }));
  skirt.frustumCulled = false;

  // Contact shadow: a signed-distance rounded rectangle, soft, offset away from the light.
  const planeW = WORLD.w * 1.7, planeD = WORLD.d * 2.0;
  const shadowGeo = new PlaneGeometry(planeW, planeD);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadow = new Mesh(shadowGeo, new ShaderMaterial({
    vertexShader: shadowVert, fragmentShader: shadowFrag, transparent: true, depthWrite: false,
    uniforms: {
      ...shared,
      uPlane: { value: new Vector2(planeW, planeD) },
      uHalf: { value: new Vector2(WORLD.w / 2, WORLD.d / 2) },
      uOffset: { value: new Vector2(0.28, -0.2) },
      uStrength: { value: 0.34 }
    }
  }));
  shadow.position.y = -WORLD.skirt - 0.004;
  shadow.renderOrder = -1;

  return {
    tile, skirt, shadow,
    uniforms: { hover, markMix, crest },
    dispose() {
      for (const m of [tile, skirt, shadow]) { m.geometry.dispose(); (m.material as ShaderMaterial).dispose(); }
    }
  };
}
