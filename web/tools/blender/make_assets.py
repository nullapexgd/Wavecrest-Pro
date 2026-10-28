"""
Wavecrest 3.0 3D assets, modelled procedurally in Blender and exported as GLB.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --python tools/blender/make_assets.py -- static/models

Two small assets, both chosen because they are the real instruments of the metaphor:

  lead.glb     A sounding lead: the weighted line a surveyor drops to read depth.
               In the page it is the probe that follows the pointer over the relief.
  pennant.glb  A swallow-tailed signal pennant on a pole, planted on the peaks that
               break above the channel's normal range (the "crests").

No materials are exported: the page shades them itself so they match the relief
exactly. Cloth keeps UV.x = 0 at the pole and 1 at the free end, which the page uses
as the flutter weight in its vertex shader.
"""
import math
import sys
from pathlib import Path

import bmesh
import bpy

argv = sys.argv
out_dir = Path(argv[argv.index("--") + 1] if "--" in argv else "static/models").resolve()
out_dir.mkdir(parents=True, exist_ok=True)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def smooth(obj):
    for p in obj.data.polygons:
        p.use_smooth = True


def export(name, objects):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    path = out_dir / f"{name}.glb"
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_materials="NONE",
        export_normals=True,
        export_texcoords=True,
        export_cameras=False,
        export_lights=False,
    )
    return path


def mesh_object(name, bm):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


# ── sounding lead ────────────────────────────────────────────────────────────
def make_lead():
    # (radius, height) profile of a classic lead: blunt tip, full belly, tapered neck.
    profile = [
        (0.000, 0.000), (0.030, 0.008), (0.062, 0.040), (0.090, 0.105), (0.104, 0.185),
        (0.108, 0.255), (0.100, 0.335), (0.080, 0.410), (0.056, 0.470), (0.040, 0.515),
        (0.032, 0.545), (0.030, 0.575),
    ]
    bm = bmesh.new()
    verts = [bm.verts.new((r, 0.0, z)) for r, z in profile]
    edges = [bm.edges.new((verts[i], verts[i + 1])) for i in range(len(verts) - 1)]
    bmesh.ops.spin(
        bm, geom=verts + edges, cent=(0, 0, 0), axis=(0, 0, 1),
        angle=math.tau, steps=40, use_merge=True,
    )
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    body = mesh_object("lead_body", bm)
    smooth(body)

    # Eyelet: a ring standing on the neck, plane facing the viewer's X axis.
    ring = bmesh.new()
    major, minor, seg, tube = 0.052, 0.013, 32, 12
    rings = []
    for i in range(seg):
        a = math.tau * i / seg
        cx, cz = math.cos(a) * major, math.sin(a) * major
        loop = []
        for j in range(tube):
            b = math.tau * j / tube
            # tube cross-section lies in the plane containing the radial direction and Y
            rx, rz = math.cos(a), math.sin(a)
            px = cx + rx * math.cos(b) * minor
            pz = cz + rz * math.cos(b) * minor
            py = math.sin(b) * minor
            loop.append(ring.verts.new((px, py, pz + 0.575 + major)))
        rings.append(loop)
    for i in range(seg):
        a, b = rings[i], rings[(i + 1) % seg]
        for j in range(tube):
            ring.faces.new((a[j], a[(j + 1) % tube], b[(j + 1) % tube], b[j]))
    bmesh.ops.recalc_face_normals(ring, faces=ring.faces)
    eyelet = mesh_object("lead_eyelet", ring)
    smooth(eyelet)

    bpy.ops.object.select_all(action="DESELECT")
    for o in (body, eyelet):
        o.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    joined = bpy.context.view_layer.objects.active
    joined.name = "lead"
    return joined


# ── signal pennant ───────────────────────────────────────────────────────────
def make_pennant():
    nx, ny = 24, 6
    length, half_h = 0.72, 0.17
    notch = 0.15
    z_center = 1.00

    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    grid = []
    for i in range(nx + 1):
        t = i / nx
        hh = half_h * (1.0 - 0.62 * t)  # tapers toward the tail
        col = []
        for j in range(ny + 1):
            v = j / ny
            z = z_center + (v - 0.5) * 2 * hh
            # swallowtail: pull the middle of the free end back toward the pole
            tail = max(0.0, (t - 0.72) / 0.28)
            cut = notch * (1.0 - abs(2 * v - 1)) * tail * tail
            x = 0.012 + t * length - cut
            col.append(bm.verts.new((x, 0.0, z)))
        grid.append(col)
    for i in range(nx):
        for j in range(ny):
            f = bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
            for loop, (u, v) in zip(f.loops, [(i / nx, j / ny), ((i + 1) / nx, j / ny),
                                              ((i + 1) / nx, (j + 1) / ny), (i / nx, (j + 1) / ny)]):
                loop[uv].uv = (u, v)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    cloth = mesh_object("pennant_cloth", bm)
    smooth(cloth)

    pole_bm = bmesh.new()
    bmesh.ops.create_cone(
        pole_bm, cap_ends=True, cap_tris=False, segments=10,
        radius1=0.014, radius2=0.010, depth=1.30,
        matrix=__import__("mathutils").Matrix.Translation((0, 0, 0.65)),
    )
    # finial
    bmesh.ops.create_uvsphere(
        pole_bm, u_segments=10, v_segments=6, radius=0.024,
        matrix=__import__("mathutils").Matrix.Translation((0, 0, 1.32)),
    )
    pole = mesh_object("pennant_pole", pole_bm)
    smooth(pole)
    return cloth, pole


reset()
lead = make_lead()
p_lead = export("lead", [lead])

reset()
cloth, pole = make_pennant()
p_pen = export("pennant", [cloth, pole])

for p in (p_lead, p_pen):
    print(f"WROTE {p} {p.stat().st_size} bytes")
