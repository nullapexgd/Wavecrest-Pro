import { BufferAttribute, BufferGeometry, Matrix4, Quaternion, Vector3 } from 'three';

/*
  A minimal GLB reader for our own exported props: triangle meshes with positions, normals,
  UVs and indices, no materials, animation or compression. It replaces GLTFLoader, which
  would add ~15 KB (gzip) of general-purpose machinery to read two 30 KB files. If a future
  asset needs more (Draco, skins, textures), switch back to GLTFLoader deliberately.
*/

export interface GlbMesh { name: string; geometry: BufferGeometry }

interface Accessor { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string }
interface Node { name?: string; mesh?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }
interface Gltf {
  scene?: number;
  scenes: { nodes: number[] }[];
  nodes: Node[];
  meshes: { name?: string; primitives: { attributes: Record<string, number>; indices?: number; mode?: number }[] }[];
  accessors: Accessor[];
  bufferViews: { byteOffset?: number; byteLength: number; byteStride?: number }[];
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3 };

function read(json: Gltf, bin: ArrayBuffer, index: number): { data: ArrayLike<number>; size: number } {
  const a = json.accessors[index]!;
  const v = json.bufferViews[a.bufferView]!;
  const size = COMPONENTS[a.type];
  if (!size) throw new Error(`unsupported accessor type ${a.type}`);
  if (v.byteStride && v.byteStride !== size * (a.componentType === 5126 || a.componentType === 5125 ? 4 : 2)) {
    throw new Error('interleaved buffers are not supported');
  }
  const offset = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const n = a.count * size;
  if (a.componentType === 5126) return { data: new Float32Array(bin, offset, n), size };
  if (a.componentType === 5125) return { data: new Uint32Array(bin, offset, n), size };
  if (a.componentType === 5123) return { data: new Uint16Array(bin, offset, n), size };
  throw new Error(`unsupported component type ${a.componentType}`);
}

function fromDataUrl(url: string): ArrayBuffer {
  const bin = atob(url.slice(url.indexOf(',') + 1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export async function loadGlb(url: string): Promise<GlbMesh[]> {
  let buf: ArrayBuffer;
  if (url.startsWith('data:')) buf = fromDataUrl(url); // the single-file build embeds its models
  else {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`could not load ${url} (${res.status})`);
    buf = await res.arrayBuffer();
  }
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB file');

  let json: Gltf | null = null;
  let bin: ArrayBuffer | null = null;
  for (let off = 12; off + 8 <= buf.byteLength;) {
    const len = dv.getUint32(off, true);
    const type = dv.getUint32(off + 4, true);
    const start = off + 8;
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, start, len))) as Gltf;
    else if (type === 0x004e4942) bin = buf.slice(start, start + len);
    off = start + len;
  }
  if (!json || !bin) throw new Error('GLB is missing its JSON or binary chunk');

  const out: GlbMesh[] = [];
  const visit = (id: number, parent: Matrix4) => {
    const node = json!.nodes[id]!;
    const m = new Matrix4();
    if (node.matrix) m.fromArray(node.matrix);
    else m.compose(
      new Vector3().fromArray(node.translation ?? [0, 0, 0]),
      new Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]),
      new Vector3().fromArray(node.scale ?? [1, 1, 1])
    );
    const world = parent.clone().multiply(m);
    if (node.mesh !== undefined) {
      const mesh = json!.meshes[node.mesh]!;
      for (const prim of mesh.primitives) {
        if (prim.mode !== undefined && prim.mode !== 4) continue; // triangles only
        const g = new BufferGeometry();
        const pos = read(json!, bin!, prim.attributes.POSITION!);
        g.setAttribute('position', new BufferAttribute(new Float32Array(pos.data as Float32Array), 3));
        if (prim.attributes.NORMAL !== undefined) {
          g.setAttribute('normal', new BufferAttribute(new Float32Array(read(json!, bin!, prim.attributes.NORMAL).data as Float32Array), 3));
        }
        if (prim.attributes.TEXCOORD_0 !== undefined) {
          g.setAttribute('uv', new BufferAttribute(new Float32Array(read(json!, bin!, prim.attributes.TEXCOORD_0).data as Float32Array), 2));
        }
        if (prim.indices !== undefined) g.setIndex(new BufferAttribute(Uint32Array.from(read(json!, bin!, prim.indices).data), 1));
        g.applyMatrix4(world); // bake the exporter's Y-up conversion and any node transform
        out.push({ name: (node.name || mesh.name || '').toLowerCase(), geometry: g });
      }
    }
    for (const c of node.children ?? []) visit(c, world);
  };
  const root = json.scenes[json.scene ?? 0]!;
  for (const n of root.nodes) visit(n, new Matrix4());
  return out;
}
