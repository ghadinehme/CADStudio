"""Import a CadQuery script into Studio's structured feature list using AST.

Handles the "sketch / extrude / revolve" family these generators emit, in any
argument order and whether plane values are inline literals or variables:

    origin = (...); normal = (...); xdir = (...)
    plane_1  = cq.Plane(origin=..., normal=..., xDir=...)
    sketch_1 = cq.Workplane(plane_1)                # or cq.Workplane("XY")
    loop_1   = sketch_1.moveTo(x, y).lineTo(...).threePointArc((..),(..)).close()
    loop_2   = sketch_1.moveTo(cx, cy).circle(r)
    sketch_1 = sketch_1.add(loop_1).add(loop_2)
    tool_1   = sketch_1.extrude(dist, combine=False) # or .revolve(angleDegrees=, axisStart=, axisEnd=)
    body_1   = body_1.cut(tool_1)                    # combine: cut / union / intersect
    result   = solid_1; result = result.add(solid_2)   # display compound

Each datum plane -> a datum_plane feature; each Workplane(...) + its loops -> a
sketch feature; each extrude/revolve -> a solid feature referencing the sketch. A
`body = body.<cut|union|intersect>(tool)` line folds the tool solid back into the
target body as an add/cut/intersect operation instead of a stray separate body.
"""
from __future__ import annotations

import ast
from collections import OrderedDict

from .kernel import new_id

SOLID_METHODS = {"extrude": "extrude", "revolve": "revolve", "sweep": "sweep", "loft": "loft"}
# body = body.<method>(tool) → the combine operation Studio stores on the tool solid.
COMBINE_OPS = {"cut": "cut", "intersect": "intersect", "union": "add", "add": "add"}


def _eval_const(n, i=0.0):
    """Evaluate a constant arithmetic expression, treating the loop var `_i` as `i`.
    Handles the `dir*spacing*_i` / `angle/count*_i` forms Studio emits for patterns."""
    if isinstance(n, ast.Constant):
        return n.value
    if isinstance(n, ast.Name) and n.id == "_i":
        return i
    if isinstance(n, ast.UnaryOp):
        v = _eval_const(n.operand, i)
        return -v if isinstance(n.op, ast.USub) else v
    if isinstance(n, ast.BinOp):
        a, b = _eval_const(n.left, i), _eval_const(n.right, i)
        if isinstance(n.op, ast.Mult): return a * b
        if isinstance(n.op, ast.Div): return a / b
        if isinstance(n.op, ast.Add): return a + b
        if isinstance(n.op, ast.Sub): return a - b
    raise ValueError("non-constant expression")


def parse_script(code: str) -> list[dict]:
    try:
        tree = ast.parse(code)
    except SyntaxError:
        return []

    env: dict = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            try:
                env[node.targets[0].id] = ast.literal_eval(node.value)
            except Exception:
                pass

    def lit(n):
        if isinstance(n, ast.Name) and n.id in env:
            return env[n.id]
        return ast.literal_eval(n)

    def num(n):
        return float(lit(n))

    def vec(n):
        return [round(float(v), 6) for v in lit(n)]

    def pair(n):
        t = lit(n)
        return float(t[0]), float(t[1])

    def unwind(call):
        chain = []
        node = call
        while isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            recv = node.func.value
            if isinstance(recv, ast.Name) and recv.id in ("cq", "cadquery"):
                break
            chain.append((node.func.attr, node.args, node.keywords))
            node = node.func.value
        chain.reverse()
        return node, chain

    features: list[dict] = []
    plane_feat: dict[str, str] = {}      # plane var -> datum_plane feature id
    sketch_plane_ref: dict[str, str] = {}  # sketch var -> plane ref (feature id or named)
    body_vars: dict[str, dict] = {}      # body/tool var -> the solid feature that produced it
    loops: "OrderedDict[str, dict]" = OrderedDict()  # loop var -> {segs, pen}
    active_sketch_var = None

    def fresh():
        return {"loops": [], "segs": [], "pen": None}

    def _flush(st):
        if st["segs"]:
            st["loops"].append(st["segs"])
            st["segs"] = []
        st["pen"] = None

    def process_chain(st, chain):
        for method, a, _kw in chain:
            if method == "moveTo":
                _flush(st)  # a moveTo begins a new sub-loop
                st["pen"] = pair(a[0]) if len(a) == 1 else (num(a[0]), num(a[1]))
            elif method == "lineTo":
                x, y = (pair(a[0]) if len(a) == 1 else (num(a[0]), num(a[1])))
                px, py = st["pen"] if st["pen"] else (x, y)
                st["segs"].append({"type": "line", "x1": px, "y1": py, "x2": x, "y2": y})
                st["pen"] = (x, y)
            elif method == "threePointArc":
                mx, my = pair(a[0])
                x2, y2 = pair(a[1])
                px, py = st["pen"] if st["pen"] else (mx, my)
                st["segs"].append({"type": "arc", "x1": px, "y1": py, "mx": mx, "my": my, "x2": x2, "y2": y2})
                st["pen"] = (x2, y2)
            elif method == "circle":
                r = num(a[0])
                cx, cy = st["pen"] if st["pen"] else (0.0, 0.0)
                _flush(st)  # a circle is its own closed loop
                st["loops"].append([{"type": "circle", "cx": cx, "cy": cy, "r": r}])
            elif method == "spline":
                pts = [[float(x), float(y)] for x, y in lit(a[0])]
                if pts:
                    st["segs"].append({"type": "spline", "points": pts})
                    st["pen"] = (pts[-1][0], pts[-1][1])
            elif method == "close":
                _flush(st)

    def finalize_sketch(order=None):
        keys = order if order else list(loops.keys())
        out_loops = []
        for k in keys:
            if k not in loops:
                continue
            st = loops[k]
            _flush(st)
            out_loops.extend(lp for lp in st["loops"] if lp)
        loops.clear()
        return out_loops

    def emit_pattern(node):
        """Recover a linear/circular pattern from the for-loop Studio's codegen emits:
            _base = body_N.val()
            for _i in range(1, count):
                body_N = body_N.union(cq.Workplane().add(_base).translate((..)) | .rotate((..),(..),ang))
        """
        it = node.iter
        if not (isinstance(it, ast.Call) and isinstance(it.func, ast.Name) and it.func.id == "range" and it.args):
            return
        try:
            count = int(_eval_const(it.args[1] if len(it.args) >= 2 else it.args[0]))
        except Exception:
            return
        assign = next((s for s in node.body if isinstance(s, ast.Assign) and len(s.targets) == 1
                       and isinstance(s.targets[0], ast.Name)), None)
        if assign is None or not isinstance(assign.value, ast.Call):
            return
        bodyvar = assign.targets[0].id
        tgt = body_vars.get(bodyvar)
        if tgt is None:
            return
        val = assign.value
        if not (isinstance(val.func, ast.Attribute) and val.func.attr in ("union", "add") and val.args):
            return
        _r, achain = unwind(val.args[0])                     # cq.Workplane().add(_base).translate|rotate(...)
        amethods = {m: a for m, a, _ in achain}
        if "translate" in amethods and amethods["translate"]:
            tup = amethods["translate"][0]
            if not (isinstance(tup, ast.Tuple) and len(tup.elts) == 3):
                return
            try:
                step = [_eval_const(e, 1.0) for e in tup.elts]    # per-step translation
            except Exception:
                return
            av = [abs(x) for x in step]
            if max(av) < 1e-9:
                return
            ax = av.index(max(av))
            if all(av[k] < 1e-6 for k in range(3) if k != ax):   # axis-aligned → unit axis + signed spacing
                direction = [0.0, 0.0, 0.0]; direction[ax] = 1.0; spacing = step[ax]
            else:                                                # arbitrary direction → raw dir, unit spacing
                mag = sum(x * x for x in step) ** 0.5; direction = [x / mag for x in step]; spacing = mag
            k = sum(1 for f in features if f["type"] == "linear_pattern") + 1
            features.append({"id": new_id(), "type": "linear_pattern", "name": f"Linear Pattern {k}",
                             "params": {"target": tgt["id"], "dir": [round(d, 6) for d in direction],
                                        "spacing": round(spacing, 6), "count": count}})
        elif "rotate" in amethods and len(amethods["rotate"]) >= 3:
            ra = amethods["rotate"]
            try:
                a_s = [round(float(v), 6) for v in ast.literal_eval(ra[0])]
                a_e = [round(float(v), 6) for v in ast.literal_eval(ra[1])]
                ang_step = _eval_const(ra[2], 1.0)
            except Exception:
                return
            k = sum(1 for f in features if f["type"] == "circular_pattern") + 1
            features.append({"id": new_id(), "type": "circular_pattern", "name": f"Circular Pattern {k}",
                             "params": {"target": tgt["id"], "axis_start": a_s, "axis_end": a_e,
                                        "count": count, "angle": round(ang_step * count, 6)}})

    for node in tree.body:
        if isinstance(node, ast.For):
            emit_pattern(node)
            continue
        if not isinstance(node, ast.Assign) or len(node.targets) != 1 or not isinstance(node.targets[0], ast.Name):
            continue
        target = node.targets[0].id
        rhs = node.value
        if not isinstance(rhs, ast.Call):
            continue
        root, chain = unwind(rhs)
        methods = [m for m, _, _ in chain]

        # cq.Plane(...) -> datum_plane feature
        if isinstance(rhs.func, ast.Attribute) and rhs.func.attr == "Plane":
            kw = {k.arg: k.value for k in rhs.keywords}
            try:
                origin = vec(kw["origin"]) if "origin" in kw else [0, 0, 0]
                normal = vec(kw["normal"]) if "normal" in kw else [0, 0, 1]
                xdir = vec(kw["xDir"]) if "xDir" in kw else None
            except Exception:
                continue
            fid = new_id()
            params = {"origin": origin, "normal": normal}
            if xdir is not None:
                params["xdir"] = xdir
            features.append({"id": fid, "type": "datum_plane", "name": f"Plane {len(plane_feat)+1}", "params": params})
            plane_feat[target] = fid
            continue

        # cq.Workplane(plane) -> begin a sketch
        if isinstance(root, ast.Call) and isinstance(root.func, ast.Attribute) and root.func.attr == "Workplane":
            arg = root.args[0] if root.args else None
            if isinstance(arg, ast.Name) and arg.id in plane_feat:
                sketch_plane_ref[target] = plane_feat[arg.id]
            elif isinstance(arg, ast.Call) and isinstance(arg.func, ast.Attribute) and arg.func.attr == "Plane":
                # inline cq.Plane(origin=, xDir=, normal=) -> keep as an inline plane
                kw = {k.arg: k.value for k in arg.keywords}
                try:
                    inline = {"origin": vec(kw["origin"]), "normal": vec(kw["normal"]),
                              "xdir": vec(kw["xDir"]) if "xDir" in kw else [1, 0, 0]}
                    sketch_plane_ref[target] = inline
                except Exception:
                    sketch_plane_ref[target] = "XY"
            else:
                ref = "XY"
                try:
                    v = lit(arg) if arg is not None else None
                    if isinstance(v, str):
                        ref = v
                except Exception:
                    pass
                sketch_plane_ref[target] = ref
            active_sketch_var = target
            loops.clear()
            if chain:
                st = fresh()
                process_chain(st, chain)
                loops[target] = st
            continue

        if not isinstance(root, ast.Name):
            continue
        rootname = root.id

        # solid op terminates the sketch -> emit sketch + solid features
        solid_method = next((m for m in methods if m in SOLID_METHODS), None)
        if solid_method:
            sketch_loops = finalize_sketch()
            plane_ref = sketch_plane_ref.get(rootname, "XY")
            sketch_id = new_id()
            features.append({"id": sketch_id, "type": "sketch",
                             "name": f"Sketch {sum(1 for f in features if f['type']=='sketch')+1}",
                             "params": {"plane": plane_ref, "loops": sketch_loops}})
            sm_args, sm_kw = [], {}
            for m, a, kw in chain:
                if m == solid_method:
                    sm_args = a
                    sm_kw = {k.arg: k.value for k in kw}
                    break
            sp = {"sketch": sketch_id, "operation": "new"}
            if solid_method == "extrude":
                sp["distance"] = num(sm_args[0]) if sm_args else (num(sm_kw["distance"]) if "distance" in sm_kw else 1.0)
                sp["direction"] = "normal"
                ftype = "extrude"
            else:  # revolve — axis from axisStart=/axisEnd= kwargs OR positional
                   # revolve(angle, axisStart, axisEnd), the form Studio's codegen emits.
                sp["angle"] = num(sm_kw["angleDegrees"]) if "angleDegrees" in sm_kw else (num(sm_args[0]) if sm_args else 360.0)
                if "axisStart" in sm_kw:
                    sp["axis_start"] = vec(sm_kw["axisStart"])
                elif len(sm_args) >= 2:
                    sp["axis_start"] = vec(sm_args[1])
                else:
                    sp["axis_start"] = [0, 0, 0]
                if "axisEnd" in sm_kw:
                    sp["axis_end"] = vec(sm_kw["axisEnd"])
                elif len(sm_args) >= 3:
                    sp["axis_end"] = vec(sm_args[2])
                else:
                    sp["axis_end"] = [0, 1, 0]
                ftype = "revolve"
            nname = sum(1 for f in features if f["type"] == ftype) + 1
            solid_feat = {"id": new_id(), "type": ftype, "name": f"{ftype.title()} {nname}", "params": sp}
            features.append(solid_feat)
            body_vars[target] = solid_feat   # remember which var carries this solid (body or tool)
            active_sketch_var = None
            continue

        # body = body.<cut|union|intersect|add>(tool) → fold the tool solid into the
        # target body. Studio emits this for any extrude/revolve whose operation
        # isn't "new" (it builds the tool with combine=False, then combines it), so
        # recovering it turns those back into add/cut/intersect ops instead of
        # leaving the tool as a stray separate body.
        combine_op = next((COMBINE_OPS[m] for m in methods if m in COMBINE_OPS), None)
        if combine_op and rootname in body_vars:
            call_args = next((a for m, a, _ in chain if m in COMBINE_OPS), None)
            tool_var = call_args[0].id if call_args and isinstance(call_args[0], ast.Name) else None
            tgt_feat = body_vars.get(rootname)
            tool_feat = body_vars.get(tool_var)
            if tool_feat is not None and tgt_feat is not None and tool_feat is not tgt_feat:
                tool_feat["params"]["operation"] = combine_op
                tool_feat["params"]["target"] = tgt_feat["id"]
                body_vars[target] = tgt_feat   # the combined result is still the target body
            continue

        # sketch_N = sketch_N.add(loop_a).add(loop_b)...
        if "add" in methods and rootname == active_sketch_var:
            order = [a[0].id for m, a, _ in chain if m == "add" and a and isinstance(a[0], ast.Name)]
            kept = finalize_sketch(order if order else None)
            # stash back so the subsequent extrude can pick them up
            for i, lp in enumerate(kept):
                loops[f"__loop_{i}"] = {"loops": [lp], "segs": [], "pen": None}
            continue

        # loop building
        if rootname in loops:
            st = loops[rootname]
        elif rootname == active_sketch_var:
            st = fresh()
        else:
            continue
        process_chain(st, chain)
        loops[target] = st

    return features
