import {
  BufferGeometry, InstancedBufferAttribute, InstancedMesh, Matrix4, Quaternion, ShaderMaterial, DoubleSide, Vector3
} from 'three';
import { WORLD, heightAt, type Field, type Video } from '../data/model';
import { loadGlb, type GlbMesh } from './glb';
import { modelUrls } from './modelUrls';
import { pennantFrag, pennantVert, leadFrag, leadVert } from './shaders';
import type { Shared } from './relief';

/** Geometry modelled in Blender (tools/blender/make_assets.py), not primitives. */
export interface PropGeometry { lead: BufferGeometry; cloth: BufferGeometry; pole: BufferGeometry }

function named(meshes: GlbMesh[], part: string): BufferGeometry {
  const m = meshes.find(x => x.name.includes(part));
  if (!m) throw new Error(`model is missing the "${part}" mesh`);
  return m.geometry;
}

export async function loadProps(base: string): Promise<PropGeometry> {
  const urls = await modelUrls(base);
  const [lead, pennant] = await Promise.all([loadGlb(urls.lead), loadGlb(urls.pennant)]);
  const first = lead[0];
  if (!first) throw new Error('lead model is empty');
  return { lead: first.geometry, cloth: named(pennant, 'cloth'), pole: named(pennant, 'pole') };
}

export interface Pennants {
  cloth: InstancedMesh;
  pole: InstancedMesh;
  plant: { value: number };
  /** world position of each pennant's foot, for annotations */
  feet: Vector3[];
  dispose(): void;
}

/** One pennant planted on every crest, standing on the surface wherever the surface is. */
export function buildPennants(g: PropGeometry, field: Field, shared: Shared, crests: readonly Video[]): Pennants {
  const n = crests.length;
  const plant = { value: 0 };
  const own = { uFlutter: { value: 1 }, uScale: { value: 0.46 }, uPlant: plant };
  const mk = (geo: BufferGeometry, isPole: number) => {
    const m = new InstancedMesh(
      geo.clone(), new ShaderMaterial({
        vertexShader: pennantVert, fragmentShader: pennantFrag, side: DoubleSide,
        uniforms: { ...shared, ...own, uIsPole: { value: isPole } }
      }), n
    );
    m.frustumCulled = false;
    return m;
  };
  const cloth = mk(g.cloth, 0);
  const pole = mk(g.pole, 1);
  const peak = new Float32Array(n);
  const phase = new Float32Array(n);
  const feet: Vector3[] = [];
  const m4 = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  crests.forEach((c, i) => {
    const x = (c.u - 0.5) * WORLD.w;
    const z = (c.v - 0.5) * WORLD.d;
    peak[i] = heightAt(field, c.u, c.v);
    phase[i] = i * 1.9;
    q.setFromAxisAngle(up, -0.35 + i * 0.12);
    m4.compose(new Vector3(x, 0, z), q, new Vector3(1, 1, 1));
    cloth.setMatrixAt(i, m4);
    pole.setMatrixAt(i, m4);
    feet.push(new Vector3(x, 0, z));
  });
  for (const m of [cloth, pole]) {
    m.geometry.setAttribute('aPeak', new InstancedBufferAttribute(peak, 1));
    m.geometry.setAttribute('aPhase', new InstancedBufferAttribute(phase, 1));
    m.instanceMatrix.needsUpdate = true;
  }
  return {
    cloth, pole, plant, feet,
    dispose() { for (const m of [cloth, pole]) { m.geometry.dispose(); (m.material as ShaderMaterial).dispose(); } }
  };
}

export function leadMaterial(shared: Shared): ShaderMaterial {
  return new ShaderMaterial({ vertexShader: leadVert, fragmentShader: leadFrag, uniforms: { ...shared } });
}
