"""
Studio CAD — Flask API.

Thin layer over the geometry kernel. Every mutating endpoint accepts an optional
`known` map {body_id: hash} and returns only the meshes that changed, so editing
ships a delta instead of the whole model.
"""
import io
import os
import tempfile
import threading
import traceback

from flask import Flask, jsonify, request, send_file
from flask_cors import CORS

from cadkernel import Document, codegen, cqimport, tessellate

app = Flask(__name__, static_folder="static", static_url_path="")
CORS(app)

doc = Document()

# The geometry kernel (CadQuery/OCCT) is NOT thread-safe and `doc` is shared
# global state. Under threaded=True, an overlapping preview (which temporarily
# rewrites the feature list and restores it) and a committing edit would race and
# corrupt the kernel — which can wedge an OCCT call mid-rebuild and freeze the
# whole server. Serialize every /api/ request so the kernel is only ever touched
# by one request at a time. Static assets (js/css/index) are not gated.
_doc_lock = threading.Lock()


@app.before_request
def _serialize_api():
    if request.path.startswith("/api/"):
        _doc_lock.acquire()
        request.environ["_studio_lock_held"] = True


@app.teardown_request
def _release_api(_exc=None):
    if request.environ.pop("_studio_lock_held", False):
        try:
            _doc_lock.release()
        except RuntimeError:
            pass


def _known():
    body = request.get_json(silent=True) or {}
    return body.get("known") or {}


def respond(known=None, **extra):
    known = known if known is not None else _known()
    out = {"ok": True, "features": doc.features, "scene": doc.scene(known)}
    out.update(extra)
    return jsonify(out)


@app.route("/")
def index():
    return app.send_static_file("index.html")


@app.route("/api/scene", methods=["POST"])
def scene():
    return respond()


@app.route("/api/preview", methods=["POST"])
def preview():
    """Non-committing preview of a candidate feature (add or edit)."""
    try:
        b = request.get_json() or {}
        sc = doc.preview(known=b.get("known") or {}, feature=b.get("feature"),
                         edit_id=b.get("edit_id"), params=b.get("params"))
        return jsonify({"ok": True, "scene": sc})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


@app.route("/api/features", methods=["GET"])
def features():
    return jsonify({"ok": True, "features": doc.features})


@app.route("/api/feature", methods=["POST"])
def add_feature():
    try:
        b = request.get_json() or {}
        feat = b.get("feature")
        doc.add_feature(feat, b.get("index"))
        return respond(b.get("known") or {})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"ok": False, "error": str(e)}), 400


@app.route("/api/feature/<fid>", methods=["PATCH"])
def update_feature(fid):
    try:
        b = request.get_json() or {}
        doc.update_feature(fid, params=b.get("params"), name=b.get("name"),
                           suppressed=b.get("suppressed"), live=bool(b.get("live")))
        return respond(b.get("known") or {})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"ok": False, "error": str(e)}), 400


@app.route("/api/feature/<fid>", methods=["DELETE"])
def delete_feature(fid):
    try:
        doc.remove_feature(fid)
        return respond(_known())
    except Exception as e:
        traceback.print_exc()
        return jsonify({"ok": False, "error": str(e)}), 400


@app.route("/api/feature/<fid>/move", methods=["POST"])
def move_feature(fid):
    try:
        b = request.get_json() or {}
        doc.move_feature(fid, int(b.get("to", 0)))
        return respond(b.get("known") or {})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"ok": False, "error": str(e)}), 400


@app.route("/api/undo", methods=["POST"])
def undo():
    doc.undo()
    return respond(_known())


@app.route("/api/redo", methods=["POST"])
def redo():
    doc.redo()
    return respond(_known())


@app.route("/api/reset", methods=["POST"])
def reset():
    doc.reset()
    return respond({})


@app.route("/api/import/script", methods=["POST"])
def import_script():
    try:
        if "file" in request.files:
            code = request.files["file"].read().decode("utf-8")
        else:
            code = (request.get_json() or {}).get("code", "")
        feats = cqimport.parse_script(code)
        if not feats:
            return jsonify({"ok": False, "error": "No importable CadQuery features found."}), 400
        doc.set_features(feats)
        return respond({}, code=code)
    except Exception as e:
        traceback.print_exc()
        return jsonify({"ok": False, "error": str(e)}), 400


@app.route("/api/code", methods=["GET"])
def get_code():
    return jsonify({"ok": True, "code": codegen.generate(doc.features)})


import re as _re

# Geometry-affecting ops the importer can't recover into features. If any appear
# in the (non-comment, non-export-glue) code, the parse would be lossy.
_LOSSY_TOKENS = (".fillet(", ".chamfer(", ".shell(", ".mirror(", ".cut(",
                 ".intersect(", ".union(", ".loft(", ".sweep(", ".rotate(", ".translate(")


def _parse_is_lossy(code: str) -> bool:
    # Drop the export-combine glue (its .union()/.add() are display compounding),
    # comments, and the pattern blocks (a `_base = X.val()` snapshot + a
    # `for _i in range(...)` loop whose body uses `.add(_base).translate|rotate`),
    # all of which the parser now recovers — then look for unrecoverable ops.
    body = code.split("# Combine bodies and export")[0]
    lines = []
    for ln in body.splitlines():
        s = ln.lstrip()
        if s.startswith("#"):
            continue
        if s.startswith("_base") or ".add(_base)" in ln:   # pattern snapshot / loop body
            continue
        if _re.match(r"for\s+_i\s+in\s+range", s):          # pattern loop header
            continue
        lines.append(ln)
    src = "\n".join(lines)
    if any(tok in src for tok in _LOSSY_TOKENS):
        return True
    if _re.search(r"^\s*for\s", src, _re.M):   # any other (unrecoverable) loop
        return True
    return False


@app.route("/api/run_code", methods=["POST"])
def run_code():
    """Run edited code. If it parses into a feature tree that is GEOMETRY-FAITHFUL
    to executing the code, commit the parametric tree. Otherwise (e.g. the code
    uses fillet/boolean/pattern that the importer can't recover) show the executed
    result without overwriting the tree — never silently dropping features."""
    from cadkernel.kernel import _content_hash
    try:
        code = (request.get_json() or {}).get("code", "")

        # Models containing embedded imported solids can't be edited via code
        # (the binary body isn't in the script) — keep the tree, just refresh.
        if "# Imported solid" in code:
            return respond({}, method="skipped",
                           warning="This model has an imported solid that isn't in the script — edit it via the feature tree.")

        feats = cqimport.parse_script(code)

        # Commit the parametric tree only when the code is fully recoverable.
        if feats and not _parse_is_lossy(code):
            doc.set_features(feats)
            return respond({}, method="parsed")

        # Otherwise execute as ground truth and show the result without touching
        # the tree (so fillet/boolean/pattern features are never silently lost).
        import cadquery as cq
        import numpy as np
        ns = {"cq": cq, "cadquery": cq, "np": np}
        # Strip export/show_object lines so running code never writes files.
        exec_src = "\n".join(ln for ln in code.splitlines()
                             if "cq.exporters.export" not in ln and "show_object" not in ln)
        exec(compile(exec_src, "<user>", "exec"), ns)
        result = ns.get("result")
        if result is None:
            for v in reversed(list(ns.values())):
                if isinstance(v, cq.Workplane):
                    result = v
                    break
        if result is None:
            return jsonify({"ok": False, "error": "Assign your final shape to `result`."}), 400
        m = tessellate.tessellate(result)
        h = _content_hash(m["vertices"], m["faces"], m.get("bbox"))
        return jsonify({"ok": True, "method": "exec", "features": doc.features,
                        "warning": "This code uses features that can't be mapped back to the tree — showing the result only; the feature tree is unchanged.",
                        "scene": {"bodies": [{"id": "exec", "name": "Result", "hash": h, "mesh": m}],
                                  "sketches": [], "errors": {}}})
    except SyntaxError as e:
        return jsonify({"ok": False, "error": f"Syntax error line {e.lineno}: {e.msg}"}), 400
    except Exception as e:
        traceback.print_exc()
        return jsonify({"ok": False, "error": str(e)}), 400


@app.route("/api/face_at", methods=["POST"])
def face_at():
    """Given a 3-D point (a viewport raycast hit), return the plane of the
    nearest face so the client can start a sketch on it."""
    try:
        point = (request.get_json() or {}).get("point", [0, 0, 0])
        plane = doc.face_at(point)
        if plane:
            return jsonify({"ok": True, "plane": plane})
        return jsonify({"ok": False, "error": "No face found"}), 404
    except Exception as e:
        traceback.print_exc()
        return jsonify({"ok": False, "error": str(e)}), 400


@app.route("/api/export/<fmt>", methods=["GET"])
def export(fmt):
    try:
        data = doc.export(fmt)
        mime = "model/stl" if fmt == "stl" else "application/step"
        return send_file(io.BytesIO(data), mimetype=mime, as_attachment=True,
                         download_name=f"model.{fmt}")
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


@app.route("/api/export/script", methods=["GET"])
def export_script():
    code = codegen.generate(doc.features)
    return send_file(io.BytesIO(code.encode()), mimetype="text/x-python",
                     as_attachment=True, download_name="model.py")


@app.route("/api/import/solid", methods=["POST"])
def import_solid():
    """Add an uploaded STEP file as a real body in the model (boolean-able)."""
    try:
        f = request.files.get("file")
        if not f:
            return jsonify({"ok": False, "error": "No file"}), 400
        import base64
        name = os.path.splitext(f.filename)[0]
        data = base64.b64encode(f.read()).decode("ascii")
        doc.add_feature({"type": "import_solid", "name": name,
                         "params": {"format": "step", "data": data}})
        return respond({})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"ok": False, "error": str(e)}), 400


@app.route("/api/view_file", methods=["POST"])
def view_file():
    """Tessellate an uploaded STEP/STL purely for viewing (no feature tree)."""
    try:
        f = request.files.get("file")
        if not f:
            return jsonify({"ok": False, "error": "No file"}), 400
        name = f.filename
        with tempfile.NamedTemporaryFile(suffix=os.path.splitext(name)[1], delete=False) as tmp:
            tmp.write(f.read())
            path = tmp.name
        try:
            return jsonify({"ok": True, "mesh": tessellate.import_mesh_from_file(path, name)})
        finally:
            os.unlink(path)
    except Exception as e:
        traceback.print_exc()
        return jsonify({"ok": False, "error": str(e)}), 400


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    print(f"Studio CAD on http://localhost:{port}")
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
