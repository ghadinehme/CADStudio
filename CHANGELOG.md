# Changelog

All notable changes to Studio CAD.

## 1.0.0 — Release

First public release.

### Modeling
- Sketch on base planes, datum planes, and picked model faces.
- Sketch tools: line/polyline, rectangle, circle, 3-point arc, polygon, slot.
- Zoom-adaptive sketch resolution (grid + merge tolerance track on-screen scale).
- Edit sketches by dragging points (Move tool): vertices, arc midpoints, circle
  center/rim; coincident corners move together; per-move undo.
- Features: extrude, revolve (base/edge/sketch axis), fillet & chamfer (all or
  picked edges), shell (uniform or picked faces), hole (through/blind/counterbore),
  mirror, linear & circular pattern (editable axis), boolean, datum planes
  (base+offset or arbitrary origin/normal, fully editable), import STEP as a body.

### Interaction
- CAD-style hover/click inspection of the frontmost vertex/edge/face with
  measurement readout (length / area / coordinates); occlusion-correct picking.
- Onshape-style navigation cube; shaded / edges / wireframe display modes.
- Section view, measure tool, standard views, grid & axes toggles, light/dark theme.
- Drag-and-drop `.py` / `.stl` / `.step` onto the app to load.

### Interoperability
- Import CadQuery `.py` into an editable feature tree (AST parser).
- Faithful CadQuery codegen — including point-picked edges/faces and imported solids.
- Export `.py` / STEP / STL; live code panel with edit-and-run.

### Engine
- Incremental rebuild (only features after the first change recompute).
- Mesh cache + delta transfer (only changed bodies ship triangles).
- Stable feature IDs; transactional edits; per-feature error isolation.
- Correct angular-deflection meshing for smooth curved/revolved faces.
