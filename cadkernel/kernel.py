"""
Studio CAD geometry kernel.

Design goals (in priority order): correctness, then *editing speed*.

Key ideas that make editing fast:
  * Features form a linear history. Each feature gets a cumulative *fingerprint*
    fp[i] = hash(feature[i], fp[i-1]). On any edit we find the longest unchanged
    prefix and only recompute features after it — the unchanged prefix is reused
    from a cheap reference snapshot (CadQuery's API is functional, so prior
    Workplane objects are never mutated and can be shared, not copied).
  * Bodies that don't change keep the *same* Workplane object, so their
    tessellation is reused from a mesh cache keyed by object identity.
  * to_mesh(known=...) returns triangle data only for bodies whose hash changed,
    so an edit ships a delta, not the whole model.

Everything references other features by a stable *id*, never by list index, so
reordering or deleting a feature can never silently retarget another one.
"""
from __future__ import annotations

import copy
import hashlib
import json
import math
import uuid
from collections import OrderedDict

import numpy as np

from . import tessellate as tess

NAMED_PLANES = {"XY", "XZ", "YZ", "front", "top", "right", "bottom", "left", "back"}
SOLID_TYPES = {"extrude", "revolve", "sweep", "loft"}


def new_id() -> str:
    return uuid.uuid4().hex[:12]


def _import_cq():
    import cadquery as cq
    return cq


# --------------------------------------------------------------------------- #
#  Geometry helpers
# --------------------------------------------------------------------------- #
def _plane_from_params(p: dict):
    """Build a cq.Plane from a datum_plane feature's params."""
    cq = _import_cq()
    origin = p.get("origin")
    normal = p.get("normal")
    if origin and normal:
        n = np.array([float(v) for v in normal], dtype=float)
        o = np.array([float(v) for v in origin], dtype=float)
        offset = float(p.get("offset", 0) or 0)      # move the plane along its own normal
        if offset:
            o = o + (n / (np.linalg.norm(n) or 1.0)) * offset
        xd = p.get("xdir")
        if xd:
            x = tuple(float(v) for v in xd)
        else:
            ref = np.array([1.0, 0, 0]) if abs(n[0]) < 0.9 else np.array([0, 1.0, 0])
            perp = np.cross(n, ref)
            x = tuple((perp / (np.linalg.norm(perp) or 1.0)).tolist())
        return cq.Plane(origin=tuple(o.tolist()), xDir=x, normal=tuple(n.tolist()))
    base = p.get("base", "XY")
    valid = {"XY", "XZ", "YZ", "front", "back", "left", "right", "top", "bottom"}
    pl = cq.Plane.named(base if base in valid else "XY")
    offset = float(p.get("offset", 0) or 0)
    if offset:
        n = np.array([pl.zDir.x, pl.zDir.y, pl.zDir.z])
        o = np.array([pl.origin.x, pl.origin.y, pl.origin.z]) + n * offset
        return cq.Plane(origin=tuple(o.tolist()),
                        xDir=(pl.xDir.x, pl.xDir.y, pl.xDir.z),
                        normal=(pl.zDir.x, pl.zDir.y, pl.zDir.z))
    return pl


def _resolve_plane(ctx: dict, plane_ref):
    """A sketch's plane ref is a datum_plane feature id, a named plane, or an
    inline {origin, normal, xdir} dict (e.g. derived from a picked face)."""
    cq = _import_cq()
    if isinstance(plane_ref, dict) and plane_ref.get("origin") and plane_ref.get("normal"):
        return _plane_from_params(plane_ref)
    if isinstance(plane_ref, str) and plane_ref in ctx["planes"]:
        return ctx["planes"][plane_ref]
    if isinstance(plane_ref, str) and plane_ref in {"XY", "XZ", "YZ", "front", "top", "right", "bottom", "left", "back"}:
        return cq.Plane.named(plane_ref if plane_ref in {"XY", "XZ", "YZ"} else plane_ref)
    return cq.Plane.named("XY")


def _seg_start(s):
    t = s["type"]
    if t in ("line", "arc"):
        return float(s["x1"]), float(s["y1"])
    if t == "spline":
        pts = s.get("points") or []
        return (float(pts[0][0]), float(pts[0][1])) if pts else None
    return None


def build_sketch_wp(plane, loops):
    """Build a *fresh* workplane with the sketch's closed wires as pending wires."""
    cq = _import_cq()
    wp = cq.Workplane(plane)
    for loop in loops:
        if not loop:
            continue
        if len(loop) == 1 and loop[0]["type"] == "circle":
            s = loop[0]
            wp = wp.moveTo(float(s["cx"]), float(s["cy"])).circle(float(s["r"]))
            continue
        start = _seg_start(loop[0])
        if start is None:
            continue
        wp = wp.moveTo(*start)
        for s in loop:
            t = s["type"]
            if t == "line":
                wp = wp.lineTo(float(s["x2"]), float(s["y2"]))
            elif t == "arc":
                wp = wp.threePointArc((float(s["mx"]), float(s["my"])), (float(s["x2"]), float(s["y2"])))
            elif t == "spline":
                pts = [(float(a), float(b)) for a, b in s["points"]]
                wp = wp.spline(pts)
            elif t == "circle":
                wp = wp.circle(float(s["r"]))
        wp = wp.close()
    return wp


def _sketch_display_wires(plane, loops):
    """Sample loops into 3-D polylines (world space) for the sketch overlay."""
    O = np.array([plane.origin.x, plane.origin.y, plane.origin.z])
    X = np.array([plane.xDir.x, plane.xDir.y, plane.xDir.z])
    Y = np.array([plane.yDir.x, plane.yDir.y, plane.yDir.z])

    def to3d(u, v):
        p = O + X * u + Y * v
        return [float(p[0]), float(p[1]), float(p[2])]

    def arc_pts(x1, y1, mx, my, x2, y2, n=24):
        # True circular arc through the 3 points — a threePointArc IS a circular
        # arc through start/mid/end, so sampling its circle keeps the overlay
        # identical to the built geometry (and to the in-app sketcher). Falls back
        # to a straight chord when the three points are collinear.
        d = 2 * (x1 * (my - y2) + mx * (y2 - y1) + x2 * (y1 - my))
        if abs(d) < 1e-9:
            return [(x1, y1), (x2, y2)]
        s1, s2, s3 = x1 * x1 + y1 * y1, mx * mx + my * my, x2 * x2 + y2 * y2
        cx = (s1 * (my - y2) + s2 * (y2 - y1) + s3 * (y1 - my)) / d
        cy = (s1 * (x2 - mx) + s2 * (x1 - x2) + s3 * (mx - x1)) / d
        r = math.hypot(x1 - cx, y1 - cy)
        tau = 2 * math.pi
        nrm = lambda a: (a % tau + tau) % tau
        a1 = math.atan2(y1 - cy, x1 - cx)
        am = nrm(math.atan2(my - cy, mx - cx) - a1)   # mid as CCW offset from start
        sweep = nrm(math.atan2(y2 - cy, x2 - cx) - a1)  # end as CCW offset
        if am > sweep:                                  # mid not on the CCW path → go CW
            sweep -= tau
        return [(cx + r * math.cos(a1 + sweep * i / n), cy + r * math.sin(a1 + sweep * i / n))
                for i in range(n + 1)]

    wires = []
    for loop in loops:
        if not loop:
            continue
        if len(loop) == 1 and loop[0]["type"] == "circle":
            s = loop[0]
            cx, cy, r = float(s["cx"]), float(s["cy"]), float(s["r"])
            flat = []
            for i in range(49):
                a = 2 * np.pi * i / 48
                flat += to3d(cx + r * np.cos(a), cy + r * np.sin(a))
            wires.append(flat)
            continue
        flat = []
        for s in loop:
            t = s["type"]
            if t == "line":
                flat += to3d(float(s["x1"]), float(s["y1"]))
                flat += to3d(float(s["x2"]), float(s["y2"]))
            elif t == "arc":
                for (u, v) in arc_pts(float(s["x1"]), float(s["y1"]), float(s["mx"]),
                                      float(s["my"]), float(s["x2"]), float(s["y2"])):
                    flat += to3d(u, v)
            elif t == "spline":
                for a, b in s["points"]:
                    flat += to3d(float(a), float(b))
        if len(flat) >= 6:
            wires.append(flat)
    return wires


# --------------------------------------------------------------------------- #
#  Feature application
# --------------------------------------------------------------------------- #
def _axis_from_sketch(sk):
    """Resolve a sketch's first line/spline into a world-space (start, end) axis."""
    plane = sk["plane"]
    O = np.array([plane.origin.x, plane.origin.y, plane.origin.z])
    X = np.array([plane.xDir.x, plane.xDir.y, plane.xDir.z])
    Y = np.array([plane.yDir.x, plane.yDir.y, plane.yDir.z])
    u1 = v1 = u2 = v2 = None
    for loop in sk["loops"]:
        for s in loop:
            if s["type"] == "line":
                u1, v1, u2, v2 = float(s["x1"]), float(s["y1"]), float(s["x2"]), float(s["y2"])
                break
            if s["type"] == "spline" and len(s.get("points", [])) >= 2:
                u1, v1 = float(s["points"][0][0]), float(s["points"][0][1])
                u2, v2 = float(s["points"][-1][0]), float(s["points"][-1][1])
                break
        if u1 is not None:
            break
    if u1 is None:
        raise ValueError("Axis sketch has no line to use as the axis")
    start = O + u1 * X + v1 * Y
    end = O + u2 * X + v2 * Y
    return tuple(start.tolist()), tuple(end.tolist())


def _axis_from_edge_point(ctx, point):
    """Resolve the model edge nearest a picked point into a world (start, end)
    axis (used as a revolve axis)."""
    edges = []
    for rec in ctx["bodies"].values():
        try:
            edges += rec["wp"].edges().vals()
        except Exception:
            pass
    near = _subshapes_near(edges, [point])
    if not near:
        raise ValueError("No edge near the picked axis")
    e = near[0]
    sp, ep = e.startPoint(), e.endPoint()
    return (sp.x, sp.y, sp.z), (ep.x, ep.y, ep.z)


def _subshapes_near(cq_objs, points):
    """Return the cq shapes (edges/faces) nearest each picked 3-D point.

    Geometry-based selection avoids the persistent-topological-naming problem:
    the user clicks near an edge/face and we resolve the closest one each rebuild.
    """
    if not cq_objs or not points:
        return []
    from OCP.BRepExtrema import BRepExtrema_DistShapeShape
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeVertex
    from OCP.gp import gp_Pnt
    chosen = []
    for pt in points:
        try:
            vtx = BRepBuilderAPI_MakeVertex(gp_Pnt(*[float(v) for v in pt])).Shape()
        except Exception:
            continue
        best, bestd = None, float("inf")
        for o in cq_objs:
            try:
                dss = BRepExtrema_DistShapeShape(vtx, o.wrapped)
                if dss.IsDone() and dss.NbSolution() > 0 and dss.Value() < bestd:
                    bestd, best = dss.Value(), o
            except Exception:
                continue
        if best is not None and best not in chosen:
            chosen.append(best)
    return chosen


def _resolve_body(ctx: dict, target_id):
    bodies = ctx["bodies"]
    if target_id and target_id in bodies:
        return target_id
    if ctx["active"] and ctx["active"] in bodies:
        return ctx["active"]
    if bodies:
        return next(reversed(bodies))
    return None


def _apply(ctx: dict, feat: dict):
    """Apply one feature to the build context. Raises on failure (caller isolates)."""
    cq = _import_cq()
    t = feat["type"]
    fid = feat["id"]
    p = feat.get("params", {})

    if t == "datum_plane":
        ctx["planes"][fid] = _plane_from_params(p)
        return

    if t == "import_solid":
        import base64
        import os
        import tempfile
        data = p.get("data")
        if not data:
            raise ValueError("Imported solid has no data")
        raw = base64.b64decode(data)
        with tempfile.NamedTemporaryFile(suffix=".step", delete=False) as tf:
            tf.write(raw)
            path = tf.name
        try:
            shape = cq.importers.importStep(path)
        finally:
            try:
                os.unlink(path)
            except OSError:
                pass
        ctx["bodies"][fid] = {"name": feat.get("name", "Imported"), "wp": shape}
        ctx["active"] = fid
        return

    if t == "sketch":
        plane = _resolve_plane(ctx, p.get("plane", "XY"))
        loops = p.get("loops", [])
        ctx["sketches"][fid] = {"plane": plane, "loops": loops,
                                "wires": _sketch_display_wires(plane, loops)}
        return

    if t in SOLID_TYPES:
        solid = _make_solid(ctx, feat)
        op = p.get("operation", "new")
        if op == "new" or not ctx["bodies"]:
            ctx["bodies"][fid] = {"name": feat.get("name", t), "wp": solid}
            ctx["active"] = fid
        else:
            tgt = _resolve_body(ctx, p.get("target"))
            if tgt is None:
                ctx["bodies"][fid] = {"name": feat.get("name", t), "wp": solid}
                ctx["active"] = fid
            else:
                cur = ctx["bodies"][tgt]["wp"]
                if op == "cut":
                    res = cur.cut(solid)
                elif op == "intersect":
                    res = cur.intersect(solid)
                else:
                    res = cur.union(solid)
                nb = OrderedDict(ctx["bodies"])
                nb[tgt] = {**nb[tgt], "wp": res}
                ctx["bodies"] = nb
                ctx["active"] = tgt
        return

    if t == "hole":
        tgt = _resolve_body(ctx, p.get("target"))
        if tgt is None:
            raise ValueError("No body to put a hole in")
        wp = ctx["bodies"][tgt]["wp"]
        c = (float(p.get("cx", 0)), float(p.get("cy", 0)), float(p.get("cz", 0)))
        nv = np.array([float(v) for v in p.get("normal", [0, 0, 1])], dtype=float)
        nv = nv / (np.linalg.norm(nv) or 1.0)
        r = float(p.get("diameter", 5)) / 2.0
        if p.get("through"):
            bb = wp.val().BoundingBox()
            depth = math.sqrt((bb.xmax - bb.xmin) ** 2 + (bb.ymax - bb.ymin) ** 2 + (bb.zmax - bb.zmin) ** 2) * 1.2 + 1
        else:
            depth = float(p.get("depth", 5))
        plane = cq.Plane(origin=c, normal=tuple(nv.tolist()))
        tool = cq.Workplane(plane).circle(r).extrude(-abs(depth))
        if p.get("counterbore"):
            cbr = float(p.get("cbore_diameter", r * 4)) / 2.0
            cbd = float(p.get("cbore_depth", r))
            tool = tool.union(cq.Workplane(plane).circle(cbr).extrude(-abs(cbd)))
        res = wp.cut(tool)
        nb = OrderedDict(ctx["bodies"])
        nb[tgt] = {**nb[tgt], "wp": res}
        ctx["bodies"] = nb
        ctx["active"] = tgt
        return

    if t in ("fillet", "chamfer", "shell"):
        tgt = _resolve_body(ctx, p.get("target"))
        if tgt is None:
            raise ValueError("No body to modify")
        wp = ctx["bodies"][tgt]["wp"]
        sel = p.get("edges")   # "all" / None, or a list of picked points
        if t == "fillet":
            if sel and sel != "all":
                eds = _subshapes_near(wp.edges().vals(), sel)
                res = wp.newObject(eds).fillet(float(p["radius"])) if eds else wp.edges().fillet(float(p["radius"]))
            else:
                res = wp.edges().fillet(float(p["radius"]))
        elif t == "chamfer":
            if sel and sel != "all":
                eds = _subshapes_near(wp.edges().vals(), sel)
                res = wp.newObject(eds).chamfer(float(p["distance"])) if eds else wp.edges().chamfer(float(p["distance"]))
            else:
                res = wp.edges().chamfer(float(p["distance"]))
        else:  # shell — optional faces to remove (open the shell)
            faces_sel = p.get("faces")
            if faces_sel:
                fcs = _subshapes_near(wp.faces().vals(), faces_sel)
                res = wp.newObject(fcs).shell(-abs(float(p["thickness"]))) if fcs else wp.shell(-abs(float(p["thickness"])))
            else:
                res = wp.shell(-abs(float(p["thickness"])))
        nb = OrderedDict(ctx["bodies"])
        nb[tgt] = {**nb[tgt], "wp": res}
        ctx["bodies"] = nb
        ctx["active"] = tgt
        return

    if t == "mirror":
        tgt = _resolve_body(ctx, p.get("target"))
        if tgt is None:
            raise ValueError("No body to mirror")
        wp = ctx["bodies"][tgt]["wp"]
        plane = p.get("plane", "XZ")
        mirrored = wp.mirror(plane)
        nb = OrderedDict(ctx["bodies"])
        if p.get("merge"):
            nb[tgt] = {**nb[tgt], "wp": wp.union(mirrored)}
            ctx["active"] = tgt
        else:
            nb[fid] = {"name": feat.get("name", "Mirror"), "wp": mirrored}
            ctx["active"] = fid
        ctx["bodies"] = nb
        return

    if t == "linear_pattern":
        tgt = _resolve_body(ctx, p.get("target"))
        if tgt is None:
            raise ValueError("No body to pattern")
        wp = ctx["bodies"][tgt]["wp"]
        base = wp.val()
        dx, dy, dz = (p.get("dir", [1, 0, 0]) + [0, 0, 0])[:3]
        count = max(1, int(p.get("count", 2)))
        spacing = float(p.get("spacing", 10))
        res = wp
        for i in range(1, count):
            res = res.union(cq.Workplane().add(base).translate(
                (dx * spacing * i, dy * spacing * i, dz * spacing * i)))
        nb = OrderedDict(ctx["bodies"])
        nb[tgt] = {**nb[tgt], "wp": res}
        ctx["bodies"] = nb
        ctx["active"] = tgt
        return

    if t == "circular_pattern":
        tgt = _resolve_body(ctx, p.get("target"))
        if tgt is None:
            raise ValueError("No body to pattern")
        wp = ctx["bodies"][tgt]["wp"]
        base = wp.val()
        count = max(1, int(p.get("count", 4)))
        total = float(p.get("angle", 360))
        a_s = tuple(float(v) for v in p.get("axis_start", [0, 0, 0]))
        a_e = tuple(float(v) for v in p.get("axis_end", [0, 0, 1]))
        res = wp
        for i in range(1, count):
            res = res.union(cq.Workplane().add(base).rotate(a_s, a_e, total / count * i))
        nb = OrderedDict(ctx["bodies"])
        nb[tgt] = {**nb[tgt], "wp": res}
        ctx["bodies"] = nb
        ctx["active"] = tgt
        return

    if t == "boolean":
        op = p.get("operation", "union")
        tgt = p.get("target")
        tools = p.get("tools", [])
        if tgt not in ctx["bodies"]:
            raise ValueError("Boolean target body not found")
        res = ctx["bodies"][tgt]["wp"]
        nb = OrderedDict(ctx["bodies"])
        for tool in tools:
            if tool in nb and tool != tgt:
                tw = nb[tool]["wp"]
                res = res.cut(tw) if op == "cut" else (res.intersect(tw) if op == "intersect" else res.union(tw))
                del nb[tool]
        nb[tgt] = {**nb[tgt], "wp": res}
        ctx["bodies"] = nb
        ctx["active"] = tgt
        return

    raise ValueError(f"Unknown feature type: {t}")


def _make_solid(ctx: dict, feat: dict):
    """Produce a solid Workplane from a solid feature (no body bookkeeping)."""
    cq = _import_cq()
    t = feat["type"]
    p = feat.get("params", {})

    if t == "extrude":
        sk = ctx["sketches"].get(p.get("sketch"))
        if not sk:
            raise ValueError("Extrude has no sketch")
        wp = build_sketch_wp(sk["plane"], sk["loops"])
        dist = float(p.get("distance", 1))
        direction = p.get("direction", "normal")
        both = direction == "symmetric"
        if direction == "reverse":
            dist = -abs(dist)
        return wp.extrude(dist, both=both, combine=False)

    if t == "revolve":
        sk = ctx["sketches"].get(p.get("sketch"))
        if not sk:
            raise ValueError("Revolve has no sketch")
        wp = build_sketch_wp(sk["plane"], sk["loops"])
        angle = float(p.get("angle", 360))
        # Axis can come from a picked model edge, a selected sketch line, or coords.
        axis_edge = p.get("axis_edge")
        axis_sk = p.get("axis_sketch")
        if axis_edge:
            a_s, a_e = _axis_from_edge_point(ctx, axis_edge)
        elif axis_sk and axis_sk in ctx["sketches"]:
            a_s, a_e = _axis_from_sketch(ctx["sketches"][axis_sk])
        else:
            a_s = tuple(float(v) for v in p.get("axis_start", [0, 0, 0]))
            a_e = tuple(float(v) for v in p.get("axis_end", [0, 1, 0]))
        return wp.revolve(angle, a_s, a_e)

    if t == "sweep":
        prof = ctx["sketches"].get(p.get("sketch"))
        path = ctx["sketches"].get(p.get("path"))
        if not prof or not path:
            raise ValueError("Sweep needs a profile and a path sketch")
        pw = build_sketch_wp(prof["plane"], prof["loops"])
        path_wp = build_sketch_wp(path["plane"], path["loops"])
        return pw.sweep(path_wp)

    if t == "loft":
        secs = p.get("sections", [])
        if len(secs) < 2:
            raise ValueError("Loft needs at least two section sketches")
        wp = None
        for sid in secs:
            sk = ctx["sketches"].get(sid)
            if not sk:
                continue
            sw = build_sketch_wp(sk["plane"], sk["loops"])
            wp = sw if wp is None else wp.add(sw)
        return wp.loft(ruled=bool(p.get("ruled", False)))

    raise ValueError(f"Unknown solid type: {t}")


# --------------------------------------------------------------------------- #
#  Document
# --------------------------------------------------------------------------- #
def _content_hash(verts, faces, bbox) -> str:
    # Hash the full geometry (fast binary) so two distinct shapes can't collide
    # to the same hash and serve stale triangles through the delta.
    import array
    h = hashlib.sha1()
    h.update(str(len(verts)).encode())
    h.update(str(len(faces)).encode())
    if verts:
        h.update(array.array("d", verts).tobytes())
    if faces:
        h.update(array.array("i", faces).tobytes())
    return h.hexdigest()[:16]


class Document:
    def __init__(self):
        self.features: list[dict] = []
        self.bodies: "OrderedDict[str, dict]" = OrderedDict()
        self.errors: dict[str, str] = {}
        self._fps: list[str] = []
        self._snaps: list[dict] = []
        self._mesh_cache: dict[int, tuple] = {}
        self._undo: list[list[dict]] = []
        self._redo: list[list[dict]] = []
        self._live_fid = None   # feature id of the in-progress live edit (undo coalescing)
        self.sketches: dict = {}
        self.planes: dict = {}
        self.rebuild()

    # ---- fingerprints / snapshots ------------------------------------- #
    @staticmethod
    def _feat_fp(feat: dict, prev: str) -> str:
        core = {"id": feat["id"], "type": feat["type"],
                "suppressed": feat.get("suppressed", False),
                "params": feat.get("params", {})}
        return hashlib.sha1((prev + json.dumps(core, sort_keys=True)).encode()).hexdigest()

    @staticmethod
    def _empty_ctx() -> dict:
        return {"planes": {}, "sketches": {}, "bodies": OrderedDict(), "active": None}

    @staticmethod
    def _snap(ctx: dict) -> dict:
        return {"planes": dict(ctx["planes"]), "sketches": dict(ctx["sketches"]),
                "bodies": OrderedDict(ctx["bodies"]), "active": ctx["active"]}

    @staticmethod
    def _restore(snap: dict) -> dict:
        return {"planes": dict(snap["planes"]), "sketches": dict(snap["sketches"]),
                "bodies": OrderedDict(snap["bodies"]), "active": snap["active"]}

    # ---- incremental rebuild ------------------------------------------ #
    def rebuild(self):
        new_fps: list[str] = []
        prev = ""
        for feat in self.features:
            prev = self._feat_fp(feat, prev)
            new_fps.append(prev)

        # longest unchanged prefix
        match = 0
        for i, fp in enumerate(new_fps):
            if i < len(self._fps) and self._fps[i] == fp and i < len(self._snaps):
                match = i + 1
            else:
                break

        ctx = self._restore(self._snaps[match - 1]) if match > 0 else self._empty_ctx()
        errors = {f["id"]: self.errors[f["id"]]
                  for f in self.features[:match] if f["id"] in self.errors}
        snaps = self._snaps[:match]

        for feat in self.features[match:]:
            fid = feat["id"]
            if feat.get("suppressed"):
                snaps.append(self._snap(ctx))
                continue
            try:
                _apply(ctx, feat)
            except Exception as e:  # isolate: one bad feature never breaks the rest
                errors[fid] = str(e)
            snaps.append(self._snap(ctx))

        self._fps = new_fps
        self._snaps = snaps
        self.errors = errors
        self.bodies = ctx["bodies"]
        self.sketches = ctx["sketches"]
        self.planes = ctx["planes"]
        self._prune_mesh_cache()

    def _prune_mesh_cache(self):
        live = {id(b["wp"]) for b in self.bodies.values()}
        # keep a reference so ids stay valid
        self._mesh_cache = {k: v for k, v in self._mesh_cache.items() if k in live}

    # ---- meshing + delta ---------------------------------------------- #
    def body_mesh(self, wp):
        key = id(wp)
        cached = self._mesh_cache.get(key)
        if cached:
            return cached
        m = tess.tessellate(wp)
        h = _content_hash(m["vertices"], m["faces"], m.get("bbox"))
        self._mesh_cache[key] = (m, h)
        return self._mesh_cache[key]

    def scene(self, known: dict | None = None) -> dict:
        """Return the full scene; omit triangle data for bodies the client already
        has (known: {body_id: hash})."""
        known = known or {}
        # Body display names follow the current feature names (renaming a feature
        # must not require a geometry rebuild, so the name isn't in the fingerprint).
        name_by_id = {f["id"]: f.get("name") for f in self.features}
        bodies = []
        for bid, rec in self.bodies.items():
            mesh, h = self.body_mesh(rec["wp"])
            entry = {"id": bid, "name": name_by_id.get(bid) or rec["name"], "hash": h}
            if known.get(bid) != h:
                entry["mesh"] = mesh
            bodies.append(entry)
        wires = []
        for sid, sk in self.sketches.items():
            wires.append({"id": sid, "wires": sk["wires"]})
        # Datum planes (so the UI can draw + sketch on them)
        datums = []
        for f in self.features:
            if f["type"] == "datum_plane" and not f.get("suppressed"):
                pl = self.planes.get(f["id"])
                if pl is not None:
                    datums.append({"id": f["id"], "name": name_by_id.get(f["id"]) or "Plane",
                                   "origin": [pl.origin.x, pl.origin.y, pl.origin.z],
                                   "normal": [pl.zDir.x, pl.zDir.y, pl.zDir.z],
                                   "xdir": [pl.xDir.x, pl.xDir.y, pl.xDir.z]})
        return {"bodies": bodies, "sketches": wires, "datums": datums,
                "errors": {k: v for k, v in self.errors.items()}}

    # ---- editing (transactional via undo snapshots) ------------------- #
    def _push_undo(self):
        self._undo.append(copy.deepcopy(self.features))
        if len(self._undo) > 100:
            self._undo.pop(0)
        self._redo.clear()
        self._live_fid = None

    def _auto_name(self, ftype: str) -> str:
        n = sum(1 for f in self.features if f["type"] == ftype) + 1
        label = {"datum_plane": "Plane", "sketch": "Sketch", "extrude": "Extrude",
                 "revolve": "Revolve", "fillet": "Fillet", "chamfer": "Chamfer",
                 "shell": "Shell", "mirror": "Mirror", "linear_pattern": "Linear Pattern",
                 "circular_pattern": "Circular Pattern", "boolean": "Boolean",
                 "sweep": "Sweep", "loft": "Loft"}.get(ftype, ftype.title())
        return f"{label} {n}"

    def add_feature(self, feat: dict, index: int | None = None) -> dict:
        self._push_undo()
        feat = dict(feat)
        feat.setdefault("id", new_id())
        feat.setdefault("suppressed", False)
        feat.setdefault("params", {})
        if not feat.get("name"):
            feat["name"] = self._auto_name(feat["type"])
        if index is None or index >= len(self.features):
            self.features.append(feat)
        else:
            self.features.insert(max(0, index), feat)
        self.rebuild()
        return feat

    def update_feature(self, fid: str, params: dict = None, name: str = None,
                       suppressed: bool = None, live: bool = False) -> bool:
        for f in self.features:
            if f["id"] == fid:
                # Coalesce a run of live (debounced) edits to the same feature
                # into a single undo step.
                if live and self._live_fid == fid:
                    pass
                else:
                    self._push_undo()
                    self._live_fid = fid if live else None
                if params is not None:
                    f["params"] = params
                if name is not None:
                    f["name"] = name
                if suppressed is not None:
                    f["suppressed"] = bool(suppressed)
                self.rebuild()
                return True
        return False

    def remove_feature(self, fid: str) -> bool:
        for i, f in enumerate(self.features):
            if f["id"] == fid:
                self._push_undo()
                self.features.pop(i)
                self.rebuild()
                return True
        return False

    def move_feature(self, fid: str, new_index: int) -> bool:
        idx = next((i for i, f in enumerate(self.features) if f["id"] == fid), None)
        if idx is None:
            return False
        self._push_undo()
        feat = self.features.pop(idx)
        new_index = max(0, min(new_index, len(self.features)))
        self.features.insert(new_index, feat)
        self.rebuild()
        return True

    def set_features(self, feats: list[dict]):
        self._push_undo()
        out = []
        for f in feats:
            f = dict(f)
            f.setdefault("id", new_id())
            f.setdefault("suppressed", False)
            f.setdefault("params", {})
            if not f.get("name"):
                f["name"] = f.get("type", "feature")
            out.append(f)
        self.features = out
        self.rebuild()

    def reset(self):
        self._push_undo()
        self.features = []
        self.rebuild()

    def undo(self) -> bool:
        if not self._undo:
            return False
        self._live_fid = None
        self._redo.append(copy.deepcopy(self.features))
        self.features = self._undo.pop()
        self.rebuild()
        return True

    def redo(self) -> bool:
        if not self._redo:
            return False
        self._live_fid = None
        self._undo.append(copy.deepcopy(self.features))
        self.features = self._redo.pop()
        self.rebuild()
        return True

    # ---- live preview (non-committing) -------------------------------- #
    def preview(self, known: dict | None = None, feature: dict | None = None,
                edit_id: str | None = None, params: dict | None = None) -> dict:
        """Build the model with a candidate feature (added at the end, or one
        feature's params replaced) WITHOUT committing it, return the scene, then
        restore. The incremental cache makes this cheap (only the tail rebuilds).
        A preview-added feature gets the stable id '__preview__' so the client can
        delta it across edits and drop it on cancel."""
        saved = self.features
        if edit_id is not None and params is not None:
            self.features = [dict(f, params=params) if f["id"] == edit_id else f for f in saved]
        elif feature is not None:
            feat = dict(feature)
            feat["id"] = "__preview__"
            feat.setdefault("params", {})
            feat.setdefault("suppressed", False)
            feat.setdefault("name", "Preview")
            self.features = list(saved) + [feat]
        try:
            self.rebuild()
            scene = self.scene(known or {})
        finally:
            self.features = saved
            self.rebuild()
        return scene

    # ---- export ------------------------------------------------------- #
    def combined_workplane(self):
        cq = _import_cq()
        wps = [b["wp"] for b in self.bodies.values() if tess.has_solid(b["wp"])]
        if not wps:
            raise RuntimeError("No solid geometry to export — add an extrude, "
                               "revolve, sweep or loft first.")
        result = wps[0]
        for wp in wps[1:]:
            try:
                result = result.union(wp)
            except Exception:
                try:
                    result = result.add(wp)
                except Exception:
                    pass
        return result

    def export(self, fmt: str) -> bytes:
        return tess.export_bytes(self.combined_workplane(), fmt)

    def face_at(self, point):
        """Return the plane {origin, normal, xdir} of the face nearest a 3-D
        point across all bodies (used to start a sketch on a picked face)."""
        if not self.bodies:
            return None
        try:
            from OCP.TopExp import TopExp_Explorer
            from OCP.TopAbs import TopAbs_FACE, TopAbs_REVERSED
            from OCP.BRepAdaptor import BRepAdaptor_Surface
            from OCP.gp import gp_Pnt, gp_Vec
            from OCP.BRepExtrema import BRepExtrema_DistShapeShape
            from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeVertex
            from OCP.TopoDS import TopoDS

            target = gp_Pnt(*[float(v) for v in point])
            vtx = BRepBuilderAPI_MakeVertex(target).Shape()
            best_face, best_dist = None, float("inf")
            for rec in self.bodies.values():
                try:
                    shape = rec["wp"].val().wrapped
                except Exception:
                    continue
                ex = TopExp_Explorer(shape, TopAbs_FACE)
                while ex.More():
                    face = ex.Current()
                    try:
                        dss = BRepExtrema_DistShapeShape(vtx, face)
                        if dss.IsDone() and dss.NbSolution() > 0 and dss.Value() < best_dist:
                            best_dist = dss.Value()
                            best_face = TopoDS.Face_s(face)
                    except Exception:
                        pass
                    ex.Next()
            if best_face is None:
                return None
            surf = BRepAdaptor_Surface(best_face)
            u = (surf.FirstUParameter() + surf.LastUParameter()) / 2
            v = (surf.FirstVParameter() + surf.LastVParameter()) / 2
            pnt, d1u, d1v = gp_Pnt(), gp_Vec(), gp_Vec()
            surf.D1(u, v, pnt, d1u, d1v)
            nv = d1u.Crossed(d1v)
            if nv.Magnitude() > 1e-10:
                nv.Normalize()
            if best_face.Orientation() == TopAbs_REVERSED:
                nv.Reverse()
            xv = gp_Vec(d1u.X(), d1u.Y(), d1u.Z())
            if xv.Magnitude() > 1e-10:
                xv.Normalize()
            else:
                ref = gp_Vec(1, 0, 0) if abs(nv.X()) < 0.9 else gp_Vec(0, 1, 0)
                xv = ref.Crossed(gp_Vec(nv.X(), nv.Y(), nv.Z()))
                xv.Normalize()
            # Use the picked point projected onto the face as the plane origin so
            # the sketch grid sits where the user clicked.
            return {
                "origin": [float(pnt.X()), float(pnt.Y()), float(pnt.Z())],
                "normal": [float(nv.X()), float(nv.Y()), float(nv.Z())],
                "xdir": [float(xv.X()), float(xv.Y()), float(xv.Z())],
            }
        except Exception:
            return None
