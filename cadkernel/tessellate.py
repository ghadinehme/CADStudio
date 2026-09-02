"""
Tessellation + mesh/STEP/STL import-export for Studio CAD.

Kept deliberately small and fast:
  * One correct BRepMesh call (linear tolerance for chord error, a FIXED
    angular deflection so curved/revolved faces never explode into millions of
    triangles — the single most important meshing-speed lesson).
  * Per-face groups so the UI can hover/select faces.
  * Edge polylines for the wireframe overlay.

All functions operate on a CadQuery Workplane or a raw OCP shape, so the kernel
can cache results by object identity.
"""
from __future__ import annotations

import math
import os
import tempfile
from pathlib import Path

import cadquery as cq

# A fixed angular deflection (radians). ~0.4 rad caps facet count on curves
# while the linear tolerance keeps them smooth. Never pass the tiny linear
# tolerance here — that is what makes revolves generate >1e6 triangles.
ANGULAR_DEFLECTION = 0.4


def _raw_shape(obj):
    """Return an OCP TopoDS_Shape from a Workplane / Shape / raw shape, or None."""
    try:
        val = obj.val() if hasattr(obj, "val") else obj
    except Exception:
        val = obj
    shp = getattr(val, "wrapped", val)
    from OCP.TopoDS import TopoDS_Shape
    return shp if isinstance(shp, TopoDS_Shape) else None


def _auto_tol(shape) -> float:
    try:
        bb = shape.BoundingBox()
        diag = math.sqrt((bb.xmax - bb.xmin) ** 2 + (bb.ymax - bb.ymin) ** 2 + (bb.zmax - bb.zmin) ** 2)
        return max(min(diag * 0.0025, 0.05), 0.0005)
    except Exception:
        return 0.01


def tessellate(workplane, tolerance: float | None = None) -> dict:
    """Triangulate a workplane into {vertices, faces, face_groups, edges, bbox}."""
    data = {"vertices": [], "faces": [], "face_groups": [], "edges": [], "bbox": None}
    if workplane is None:
        return data
    try:
        shp = workplane.val()
    except Exception:
        return data
    wrapped = _raw_shape(shp)
    if wrapped is None:
        return data

    from OCP.TopoDS import TopoDS_Shape
    raw = shp.wrapped if hasattr(shp, "wrapped") else wrapped
    if not isinstance(raw, TopoDS_Shape):
        return data

    if tolerance is None:
        tolerance = _auto_tol(shp)

    try:
        from OCP.BRepMesh import BRepMesh_IncrementalMesh
        from OCP.TopExp import TopExp_Explorer
        from OCP.TopAbs import TopAbs_FACE, TopAbs_REVERSED
        from OCP.BRep import BRep_Tool
        from OCP.TopLoc import TopLoc_Location
        from OCP.TopoDS import TopoDS

        # (shape, linDeflection, isRelative, angDeflection, isInParallel)
        BRepMesh_IncrementalMesh(raw, tolerance, False, ANGULAR_DEFLECTION, True)

        verts: list[float] = []
        faces: list[int] = []
        groups: list[list[int]] = []
        voff = 0
        tri = 0
        ex = TopExp_Explorer(raw, TopAbs_FACE)
        while ex.More():
            face = TopoDS.Face_s(ex.Current())
            loc = TopLoc_Location()
            t = BRep_Tool.Triangulation_s(face, loc)
            if t is not None:
                gi: list[int] = []
                trsf = loc.Transformation()
                ident = loc.IsIdentity()
                for i in range(1, t.NbNodes() + 1):
                    p = t.Node(i)
                    if not ident:
                        p = p.Transformed(trsf)
                    verts.extend((p.X(), p.Y(), p.Z()))
                rev = face.Orientation() == TopAbs_REVERSED
                for i in range(1, t.NbTriangles() + 1):
                    n1, n2, n3 = t.Triangle(i).Get()
                    if rev:
                        n1, n2 = n2, n1
                    faces.extend((n1 - 1 + voff, n2 - 1 + voff, n3 - 1 + voff))
                    gi.append(tri)
                    tri += 1
                groups.append(gi)
                voff += t.NbNodes()
            ex.Next()
        data["vertices"] = verts
        data["faces"] = faces
        data["face_groups"] = groups
    except Exception:
        try:
            tess = shp.tessellate(tolerance)
            for v in tess[0]:
                data["vertices"].extend((v.x, v.y, v.z))
            for f in tess[1]:
                data["faces"].extend((f[0], f[1], f[2]))
        except Exception:
            pass

    # Edge polylines for the wireframe overlay
    try:
        from OCP.BRepAdaptor import BRepAdaptor_Curve
        from OCP.GCPnts import GCPnts_QuasiUniformDeflection
        for edge in workplane.edges().vals():
            try:
                curve = BRepAdaptor_Curve(edge.wrapped)
                disc = GCPnts_QuasiUniformDeflection(curve, max(tolerance, 0.002))
                if disc.IsDone():
                    pts: list[float] = []
                    for i in range(1, disc.NbPoints() + 1):
                        p = disc.Value(i)
                        pts.extend((p.X(), p.Y(), p.Z()))
                    if len(pts) >= 6:
                        data["edges"].append(pts)
            except Exception:
                pass
    except Exception:
        pass

    try:
        bb = shp.BoundingBox()
        data["bbox"] = [bb.xmin, bb.ymin, bb.zmin, bb.xmax, bb.ymax, bb.zmax]
    except Exception:
        pass
    return data


def has_solid(workplane) -> bool:
    """True if the workplane contains at least one solid (not just wires)."""
    shp = _raw_shape(workplane)
    if shp is None:
        return False
    try:
        from OCP.TopExp import TopExp_Explorer
        from OCP.TopAbs import TopAbs_SOLID
        return TopExp_Explorer(shp, TopAbs_SOLID).More()
    except Exception:
        return False


# --------------------------------------------------------------------------- #
#  Export
# --------------------------------------------------------------------------- #
def export_bytes(workplane, fmt: str) -> bytes:
    """Export a workplane to STL or STEP and return the bytes."""
    fmt = fmt.lower()
    suffix = ".stl" if fmt == "stl" else ".step"
    exp = "STL" if fmt == "stl" else "STEP"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
        name = f.name
    try:
        cq.exporters.export(workplane, name, exportType=exp)
        return Path(name).read_bytes()
    finally:
        try:
            os.unlink(name)
        except OSError:
            pass


# --------------------------------------------------------------------------- #
#  Import (STEP / STL) for the file viewer
# --------------------------------------------------------------------------- #
def import_mesh_from_file(path: str, name: str) -> dict:
    """Load a STEP or STL file into a list of tessellated bodies for viewing."""
    low = name.lower()
    if low.endswith((".step", ".stp")):
        shape = cq.importers.importStep(path)
        return {"bodies": _explode_solids(shape)}
    if low.endswith(".stl"):
        return {"bodies": _stl_bodies(path)}
    raise ValueError("Unsupported file type (use .step or .stl)")


def _explode_solids(shape) -> list[dict]:
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopAbs import TopAbs_SOLID
    from OCP.TopoDS import TopoDS
    wrapped = shape.val().wrapped
    bodies = []
    ex = TopExp_Explorer(wrapped, TopAbs_SOLID)
    idx = 0
    while ex.More():
        solid = cq.Workplane(obj=cq.Solid(TopoDS.Solid_s(ex.Current())))
        m = tessellate(solid, 0.1)
        m["id"] = f"solid_{idx}"
        m["name"] = f"Solid {idx + 1}"
        bodies.append(m)
        idx += 1
        ex.Next()
    if not bodies:
        m = tessellate(shape, 0.1)
        m["id"] = "solid_0"
        m["name"] = "Solid 1"
        bodies = [m]
    return bodies


def _stl_bodies(path: str) -> list[dict]:
    from OCP.RWStl import RWStl
    tri = RWStl.ReadFile_s(path)
    verts: list[float] = []
    faces: list[int] = []
    for i in range(1, tri.NbNodes() + 1):
        p = tri.Node(i)
        verts.extend((p.X(), p.Y(), p.Z()))
    for i in range(1, tri.NbTriangles() + 1):
        a, b, c = tri.Triangle(i).Get()
        faces.extend((a - 1, b - 1, c - 1))
    xs = verts[0::3] or [0]
    ys = verts[1::3] or [0]
    zs = verts[2::3] or [0]
    return [{
        "id": "stl_0", "name": "Mesh",
        "vertices": verts, "faces": faces,
        "face_groups": [list(range(len(faces) // 3))], "edges": [],
        "bbox": [min(xs), min(ys), min(zs), max(xs), max(ys), max(zs)],
    }]
