import bpy
import math
import os

WS = r"C:\Users\User\Documents\kimi\tasks\2026-11-01\01-44-41-6bb42a9c"
GLB = os.path.join(WS, "generated", "fox-slime.glb")
PREVIEW = os.path.join(WS, "generated", "model-preview.png")

# ---------- clean scene ----------
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

# ---------- materials ----------
def mat_principled(name, color, rough=0.25, metallic=0.0, emission=None, estr=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metallic
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = estr
    return m

MAT_BODY = mat_principled("BodyMat", (1.0, 1.0, 1.0), rough=0.35)
bsdf = MAT_BODY.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Coat Weight"].default_value = 0.35
bsdf.inputs["Coat Roughness"].default_value = 0.25
_col_node = MAT_BODY.node_tree.nodes.new("ShaderNodeVertexColor")
_col_node.layer_name = "Col"
MAT_BODY.node_tree.links.new(_col_node.outputs["Color"], bsdf.inputs["Base Color"])
MAT_DARK = mat_principled("DarkMat", (0.05, 0.02, 0.015), rough=0.4)
MAT_CREAM = mat_principled("CreamMat", (0.99, 0.94, 0.85), rough=0.55)
MAT_EYE = mat_principled("EyeMat", (0.10, 0.04, 0.008), rough=0.06)
MAT_EYEGLOW = mat_principled("EyeGlowMat", (0.55, 0.20, 0.02), rough=0.10, emission=(0.95, 0.42, 0.05), estr=0.7)
MAT_WHITE = mat_principled("WhiteMat", (1, 1, 1), rough=0.05, emission=(1, 1, 1), estr=0.6)
MAT_NOSE = mat_principled("NoseMat", (0.03, 0.015, 0.015), rough=0.2)
MAT_BLUSH = mat_principled("BlushMat", (1.0, 0.42, 0.50), rough=0.6, emission=(1.0, 0.35, 0.45), estr=0.25)
MAT_HEART = mat_principled("HeartMat", (0.95, 0.10, 0.25), rough=0.2, emission=(0.95, 0.12, 0.30), estr=0.5)

# ---------- helpers ----------
def smooth(obj):
    if obj.type == 'MESH':
        for p in obj.data.polygons:
            p.use_smooth = True

def add_sphere(name, loc, scale, mat, r=1.0, seg=48, rings=32):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, radius=r, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = scale
    bpy.ops.object.transform_apply(scale=True)
    if mat: o.data.materials.append(mat)
    smooth(o)
    return o

def add_cone(name, loc, r1, r2, depth, mat, rot=(0, 0, 0), base_origin=False):
    bpy.ops.mesh.primitive_cone_add(vertices=48, radius1=r1, radius2=r2, depth=depth, location=(0, 0, 0))
    o = bpy.context.active_object
    o.name = name
    if base_origin:
        for v in o.data.vertices:
            v.co.z += depth / 2.0
    o.location = loc
    o.rotation_euler = rot
    if mat: o.data.materials.append(mat)
    smooth(o)
    return o

def smoothstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)

def mixc(c1, c2, t):
    return tuple(c1[k] + (c2[k] - c1[k]) * t for k in range(3))

ORANGE_TOP = (0.94, 0.25, 0.005)
ORANGE_LOW = (0.99, 0.48, 0.08)
CREAM = (0.99, 0.95, 0.87)

def tube_curve(name, pts, bevel, mat, loc):
    cu = bpy.data.curves.new(name + "Curve", 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = bevel
    cu.bevel_resolution = 3
    sp = cu.splines.new('BEZIER')
    sp.bezier_points.add(len(pts) - 1)
    for bp, co in zip(sp.bezier_points, pts):
        bp.co = co
        bp.handle_left_type = 'AUTO'
        bp.handle_right_type = 'AUTO'
    ob = bpy.data.objects.new(name, cu)
    bpy.context.collection.objects.link(ob)
    ob.location = loc
    ob.data.materials.append(mat)
    return ob

# ---------- root ----------
root = bpy.data.objects.new("SlimeRoot", None)
bpy.context.collection.objects.link(root)

# ---------- body: round fluffy ball, origin at ground ----------
body = add_sphere("Body", (0, 0, 0), (1.12, 1.00, 0.92), MAT_BODY)
for v in body.data.vertices:
    v.co.z += 0.92
mesh = body.data
attr = mesh.color_attributes.new(name="Col", type='FLOAT_COLOR', domain='POINT')
for i, v in enumerate(mesh.vertices):
    z = v.co.z            # 0..1.84
    y = v.co.y            # negative = front (face at -Y)
    front = smoothstep(0.10, -0.50, y)
    chest = smoothstep(1.18, 0.45, z)
    belly = smoothstep(0.55, 0.10, z) * 0.55
    white = min(1.0, front * chest + belly * (0.35 + 0.65 * front))
    base = mixc(ORANGE_LOW, ORANGE_TOP, smoothstep(0.15, 1.45, z))
    c = mixc(base, CREAM, white)
    attr.data[i].color = (*c, 1.0)
body.parent = root

# ---------- ears: big triangles, orange, cream inner ----------
def make_ear(side):
    x = 0.50 * side
    tilt = -0.38 * side
    ear = add_cone("EarL" if side < 0 else "EarR", (x, 0.06, 1.50), 0.38, 0.14, 0.85, MAT_BODY,
                   rot=(0, tilt, 0), base_origin=True)
    a = ear.data.color_attributes.new(name="Col", type='FLOAT_COLOR', domain='POINT')
    for i, d in enumerate(a.data):
        z = ear.data.vertices[i].co.z
        c = mixc(ORANGE_LOW, ORANGE_TOP, smoothstep(0.0, 0.6, z))
        d.color = (*c, 1.0)
    inner = add_cone(("EarInnerL" if side < 0 else "EarInnerR"), (0, -0.26, 0.34), 0.20, 0.09, 0.45, MAT_CREAM,
                     base_origin=False)
    inner.scale = (1, 0.40, 1)
    bpy.context.view_layer.objects.active = inner
    bpy.ops.object.transform_apply(scale=True)
    inner.parent = ear
    ear.parent = root
    return ear

earL = make_ear(-1)
earR = make_ear(1)

# ---------- face (front = -Y) ----------
def parent_at(obj, parent, offset):
    obj.parent = parent
    obj.location = offset
    return obj

# open anime eyes (default look)
eyeL = add_sphere("EyeL", (-0.33, -0.88, 1.00), (0.24, 0.125, 0.31), MAT_EYE)
eyeR = add_sphere("EyeR", (0.33, -0.88, 1.00), (0.24, 0.125, 0.31), MAT_EYE)
for eye, sx in ((eyeL, -1), (eyeR, 1)):
    eye.parent = root
    glow = add_sphere(("EyeGlowL" if sx < 0 else "EyeGlowR"),
                      (0, 0, 0), (0.15, 0.075, 0.22), MAT_EYEGLOW, seg=32, rings=24)
    parent_at(glow, eye, (0, -0.065, -0.01))
    hl1 = add_sphere(("HighlightL" if sx < 0 else "HighlightR"),
                     (0, 0, 0), (0.085, 0.045, 0.11), MAT_WHITE, seg=24, rings=16)
    parent_at(hl1, eye, (-0.07, -0.09, 0.12))
    hl2 = add_sphere(("HighlightS_L" if sx < 0 else "HighlightS_R"),
                     (0, 0, 0), (0.045, 0.028, 0.05), MAT_WHITE, seg=16, rings=12)
    parent_at(hl2, eye, (0.075, -0.09, -0.11))

# happy closed arcs (default look, like the reference)
ARC_PTS = [(-0.14, 0, -0.02), (-0.07, 0, 0.055), (0, 0, 0.075), (0.07, 0, 0.055), (0.14, 0, -0.02)]
arcL = tube_curve("ArcEyeL", ARC_PTS, 0.028, MAT_EYE, (-0.33, -0.95, 1.02))
arcR = tube_curve("ArcEyeR", ARC_PTS, 0.028, MAT_EYE, (0.33, -0.95, 1.02))
arcL.parent = root
arcR.parent = root

muzzle = add_sphere("Muzzle", (0, -0.85, 0.62), (0.36, 0.20, 0.22), MAT_CREAM)
nose = add_sphere("Nose", (0, -1.03, 0.75), (0.07, 0.05, 0.05), MAT_NOSE, seg=24, rings=16)
blushL = add_sphere("BlushL", (-0.56, -0.82, 0.72), (0.13, 0.06, 0.09), MAT_BLUSH, seg=24, rings=16)
blushR = add_sphere("BlushR", (0.56, -0.82, 0.72), (0.13, 0.06, 0.09), MAT_BLUSH, seg=24, rings=16)
for o in (muzzle, nose, blushL, blushR):
    o.parent = root

# gentle cat smile
smile = tube_curve("Smile", [(-0.11, 0, 0.02), (-0.05, 0, -0.03), (0, 0, 0.008),
                             (0.05, 0, -0.03), (0.11, 0, 0.02)], 0.018, MAT_NOSE, (0, -1.02, 0.52))
smile.parent = root

# ---------- tiny front paws ----------
for sx in (-1, 1):
    paw = add_sphere("PawL" if sx < 0 else "PawR", (0.33 * sx, -0.58, 0.12), (0.16, 0.18, 0.11), MAT_BODY, seg=32, rings=24)
    a = paw.data.color_attributes.new(name="Col", type='FLOAT_COLOR', domain='POINT')
    for d in a.data:
        d.color = (*CREAM, 1.0)
    paw.rotation_euler = (0.15, 0, -0.1 * sx)
    paw.parent = root

# ---------- heart (hidden until pat) ----------
heart = bpy.data.objects.new("Heart", None)
bpy.context.collection.objects.link(heart)
heart.location = (0.45, 0.0, 2.45)
hl1 = add_sphere("HeartLobeL", (0, 0, 0), (0.095, 0.085, 0.095), MAT_HEART, seg=24, rings=16)
parent_at(hl1, heart, (-0.075, 0, 0.06))
hl2 = add_sphere("HeartLobeR", (0, 0, 0), (0.095, 0.085, 0.095), MAT_HEART, seg=24, rings=16)
parent_at(hl2, heart, (0.075, 0, 0.06))
htip = add_cone("HeartTip", (0, 0, 0), 0.155, 0.0, 0.20, MAT_HEART, rot=(math.pi, 0, 0))
parent_at(htip, heart, (0, 0, -0.07))
heart.scale = (0.001, 0.001, 0.001)
heart.parent = root

# ---------- fluffy tail at right side, pivot at base ----------
tail = add_sphere("Tail", (0, 0, 0), (0.37, 0.33, 0.58), MAT_BODY)
for v in tail.data.vertices:
    v.co.z += 0.58
ta = tail.data.color_attributes.new(name="Col", type='FLOAT_COLOR', domain='POINT')
for i, v in enumerate(tail.data.vertices):
    t = smoothstep(0.0, 0.9, v.co.z - 0.58)
    c = mixc(ORANGE_LOW, ORANGE_TOP, t)
    ta.data[i].color = (*c, 1.0)
tail.location = (0.85, 0.35, 0.30)
tail.rotation_euler = (0, 1.0, 0)
tailtip = add_sphere("TailTip", (0, 0, 1.10), (0.19, 0.18, 0.26), MAT_DARK, seg=24, rings=16)
tailtip.parent = tail
tail.parent = root

# ---------- pseudopod arm (waiting tap), starts invisible ----------
pod = add_sphere("Pseudopod", (0, 0, 0), (0.20, 0.16, 0.30), MAT_BODY)
for v in pod.data.vertices:
    v.co.z += 0.30
pa = pod.data.color_attributes.new(name="Col", type='FLOAT_COLOR', domain='POINT')
for d in pa.data:
    d.color = (0.97, 0.50, 0.10, 1.0)
pod.location = (-0.90, -0.30, 0.42)
pod.rotation_euler = (0, -0.5, 0)
pod.scale = (0.001, 0.001, 0.001)
pod.parent = root

# ---------- ground marker ----------
bpy.ops.object.empty_add(type='PLAIN_AXES', location=(0, 0, 0))
g = bpy.context.active_object
g.name = "GroundMarker"
g.parent = root

# ---------- preview scene ----------
def look_at(obj, target):
    import mathutils
    direction = mathutils.Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()

bpy.ops.object.camera_add(location=(0, -5.6, 1.35))
cam = bpy.context.active_object
look_at(cam, (0, 0, 0.95))
cam.data.lens = 55
bpy.context.scene.camera = cam

def area(name, loc, energy, size):
    bpy.ops.object.light_add(type='AREA', location=loc)
    l = bpy.context.active_object
    l.name = name
    l.data.energy = energy
    l.data.shape = 'DISK'
    l.data.size = size
    look_at(l, (0, 0, 0.95))
    return l

area("Key", (-3.5, -4.0, 6.0), 900, 4.0)
area("Fill", (4.0, -2.5, 3.0), 600, 3.0)
area("Rim", (1.5, 3.5, 4.5), 1000, 3.0)

sc = bpy.context.scene
try:
    sc.render.engine = 'BLENDER_EEVEE_NEXT'
except Exception:
    sc.render.engine = 'BLENDER_EEVEE'
sc.render.resolution_x = 640
sc.render.resolution_y = 640
sc.render.film_transparent = True
sc.render.filepath = PREVIEW
sc.render.image_settings.file_format = 'PNG'
world = bpy.data.worlds.new("W")
sc.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.8, 0.8, 0.8, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 0.6
bpy.ops.render.render(write_still=True)
print("PREVIEW_SAVED", PREVIEW)

# ---------- export GLB ----------
for o in list(bpy.context.scene.objects):
    if o.type in ('CAMERA', 'LIGHT'):
        bpy.data.objects.remove(o, do_unlink=True)

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(
    filepath=GLB,
    export_format='GLB',
    export_apply=False,
    export_animations=False,
    export_yup=True,
    export_attributes=True,
)
print("GLB_SAVED", GLB)
