# Studio CAD — API & feature reference

The backend is a thin Flask layer over a single in-memory `Document`. Requests and responses are JSON.
Mesh transfer is **delta-based**: include `"known"` (a map of `body_id → content_hash`, which the client
gets from a previous scene) and the response carries triangles only for bodies whose hash changed.

## Common response shape

```jsonc
{
  "ok": true,
  "features": [ { "id": "...", "type": "extrude", "name": "Extrude 1", "params": { ... } }, ... ],
  "scene": {
    "bodies":  [ { "id": "...", "name": "Extrude 1", "hash": "...", "mesh": { "vertices": [...], "faces": [...], "face_groups": [...], "edges": [...], "bbox": [...] } } ],
    "datums":  [ { "id": "...", "name": "Plane 1", "origin": [x,y,z], "normal": [x,y,z], "xdir": [x,y,z] } ],
    "sketches":[ ... ],
    "errors":  { "<feature_id>": "message" }
  }
}
```

A body whose hash is already in `known` comes back **without** `mesh` (the client keeps its copy).

## Endpoints

| Method & path | Body | Notes |
|---|---|---|
| `GET  /` | — | The single-page app. |
| `POST /api/scene` | `{known}` | Current scene as a delta. |
| `POST /api/preview` | `{feature｜edit_id, params, known}` | Non-committing rebuild used by live panels. |
| `GET  /api/features` | — | Feature list only. |
| `POST /api/feature` | `{feature:{type,params}, known}` | Append a feature. |
| `PATCH /api/feature/<id>` | `{params}` or `{name}` | Edit or rename. |
| `DELETE /api/feature/<id>` | `{known}` | Remove. |
| `POST /api/feature/<id>/move` | `{to, known}` | Reorder to index `to`. |
| `POST /api/undo` \| `/api/redo` \| `/api/reset` | `{known}` | History / clear. |
| `POST /api/import/script` | `{code}` | CadQuery `.py` → features. |
| `GET  /api/code` | — | `{code}` — generated CadQuery. |
| `POST /api/run_code` | `{code, known}` | Run edited code back into the model. |
| `POST /api/face_at` | `{point:[x,y,z]}` | → `{plane:{origin,normal,xdir}}` for sketch-on-face. |
| `POST /api/import/solid` | `{name, format:"step", data:<base64>}` | STEP → a body. |
| `POST /api/view_file` | multipart file | Read-only STEP/STL display. |
| `GET  /api/export/stl` \| `/step` \| `/script` | — | File download. |

## Feature `params` by type

> Picked geometry (edge/face) is stored as **3-D points**; the kernel resolves the nearest sub-shape on
> every rebuild, so selections survive edits and reorders.

| Type | params |
|---|---|
| `sketch` | `plane` (`"XY"｜"XZ"｜"YZ"`, a datum-plane id, or `{origin,normal,xdir}`), `loops` (list of loops; each loop a list of segments `{type:"line"｜"arc"｜"circle"｜"spline", ...}`) |
| `datum_plane` | `{base, offset}` **or** `{origin, normal, xdir, offset?}` — `offset` shifts the plane along its normal |
| `extrude` | `sketch`, `distance`, `direction` (`"normal"｜"symmetric"｜"reverse"`), `operation` (`"new"｜"add"｜"cut"｜"intersect"`), `target?` |
| `revolve` | `sketch`, `angle`, and an axis: `axis_start`+`axis_end` \| `axis_edge`(point) \| `axis_sketch`(id); `operation`, `target?` |
| `fillet` | `target`, `edges` (`"all"` or `[[x,y,z], …]`), `radius` |
| `chamfer` | `target`, `edges` (`"all"` or `[[x,y,z], …]`), `distance` |
| `shell` | `target`, `faces` (`[[x,y,z], …]`, optional → uniform), `thickness` |
| `hole` | `target`, `cx,cy,cz`, `normal`, `diameter`, `through`, `depth`, `counterbore`, `cbore_diameter`, `cbore_depth` |
| `mirror` | `target`, `plane` (`"XY"｜"XZ"｜"YZ"`), `merge` |
| `linear_pattern` | `target`, `dir` `[x,y,z]`, `count`, `spacing` |
| `circular_pattern` | `target`, `axis_start`, `axis_end`, `count`, `angle` |
| `boolean` | `operation` (`"union"｜"cut"｜"intersect"`), `target`, `tools` (`[body_id, …]`) |
| `import_solid` | `name`, `format:"step"`, `data` (base64 STEP) |

## Example — build a plate and export it

```bash
B=localhost:5001
# reset, add a sketch (a 40x30 rectangle on XY)
curl -s $B/api/reset -d '{}' -H 'Content-Type: application/json'
SID=$(curl -s $B/api/feature -H 'Content-Type: application/json' -d '{
  "feature":{"type":"sketch","params":{"plane":"XY","loops":[[
    {"type":"line","x1":0,"y1":0,"x2":40,"y2":0},
    {"type":"line","x1":40,"y1":0,"x2":40,"y2":30},
    {"type":"line","x1":40,"y1":30,"x2":0,"y2":30},
    {"type":"line","x1":0,"y1":30,"x2":0,"y2":0}]]}}}' | python -c 'import sys,json;print([f["id"] for f in json.load(sys.stdin)["features"] if f["type"]=="sketch"][-1])')
# extrude it 8mm, then download the STEP
curl -s $B/api/feature -H 'Content-Type: application/json' -d "{\"feature\":{\"type\":\"extrude\",\"params\":{\"sketch\":\"$SID\",\"distance\":8}}}" >/dev/null
curl -s $B/api/export/step -o plate.step
```
