/* Studio CAD — in-viewport 3D sketcher. Draws closed loops directly on a plane
   in the 3D scene (Onshape-style), then hands them to the app as a sketch. */
const Sketch3D = (() => {
  let plane = null, onFinish = null, tool = "line";
  let loops = [], cur = null, mouseUV = [0, 0], active = false;
  let drag = null, hoverH = null;          // select-tool: handle being dragged / hovered
  let history = [], pendingSnap = null;    // select-tool: per-move undo stack
  let selSegs = new Set(), hoverSeg = null, boxSel = null;   // select-tool: primitive selection + rubber-band box
  const canvas = () => document.getElementById("view");

  function start(p, cb, initial) {
    plane = p; onFinish = cb; tool = "line";
    loops = initial ? JSON.parse(JSON.stringify(initial)) : [];
    cur = null; drag = null; hoverH = null; history = []; pendingSnap = null; active = true;
    Viewport.orbitForSketch(true);
    Viewport.hideAllForSketch(true);    // hide solids so the sketch is unobstructed
    if (window.App && App.updateHoverMode) App.updateHoverMode();   // turn off idle inspect-hover while sketching
    Viewport.lookNormalTo(plane);
    document.getElementById("sk3d-bar").classList.remove("hidden");
    // Editing an existing sketch → start in move mode so points are draggable.
    _setTool(loops.length ? "select" : "line");
    _bind();
    render();
  }

  function _bind() {
    const c = canvas();
    c.addEventListener("pointerdown", _down);
    c.addEventListener("pointermove", _move);
    c.addEventListener("pointerup", _up);
    c.addEventListener("pointercancel", _up);
    c.addEventListener("dblclick", _dbl);
    document.addEventListener("keydown", _key);
  }
  function _unbind() {
    const c = canvas();
    c.removeEventListener("pointerdown", _down);
    c.removeEventListener("pointermove", _move);
    c.removeEventListener("pointerup", _up);
    c.removeEventListener("pointercancel", _up);
    c.removeEventListener("dblclick", _dbl);
    document.removeEventListener("keydown", _key);
  }

  function _segPts(s) {
    if (s.type === "line" || s.type === "arc") return [[s.x1, s.y1], [s.x2, s.y2]];
    if (s.type === "circle") return [[s.cx, s.cy]];
    return [];
  }
  // uv-units per CSS pixel on the sketch plane at the current zoom — drives all
  // tolerances so the drawing resolution tracks zoom (finer as you zoom in) and
  // stays uniform across the canvas / at any plane tilt.
  function _scale() {
    if (!Viewport.planePixelScale || !plane) return 0.12;
    return Viewport.planePixelScale(plane) || 0.12;
  }
  // Vertex-merge / loop-close radius: ~8px on screen, never below a hair.
  function _tol() { return Math.max(1e-4, _scale() * 8); }
  // Handle grab radius for the select/move tool: a touch larger than merge.
  function _grab() { return Math.max(1e-4, _scale() * 12); }
  // Grid step for snap-to-grid: a 1/2/5·10ᵏ value near ~10px, so the grid
  // refines as you zoom instead of staying locked at 1 unit.
  function _gridStep() {
    const target = Math.max(1e-4, _scale() * 10);
    const p = Math.pow(10, Math.floor(Math.log10(target)));
    const m = target / p;
    return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
  }
  // Readout precision: always one digit finer than the active grid step.
  function _coordStr(uv) {
    const dec = Math.min(6, Math.max(2, -Math.floor(Math.log10(_gridStep()))));
    return `${uv[0].toFixed(dec)}, ${uv[1].toFixed(dec)}`;
  }
  function _snap(uv) {
    if (!uv) return uv;
    let [u, v] = uv;
    const tol = _tol();
    for (const lp of loops) for (const s of lp) for (const pt of _segPts(s))
      if (Math.hypot(pt[0] - u, pt[1] - v) < tol) return [pt[0], pt[1]];
    if (cur && cur.pts) for (const p of cur.pts) if (Math.hypot(p[0] - u, p[1] - v) < tol) return [p[0], p[1]];
    if (document.getElementById("sk3d-snap").checked) { const g = _gridStep(); return [Math.round(u / g) * g, Math.round(v / g) * g]; }
    return [u, v];
  }

  // ---- select / move tool: draggable handles over the committed geometry ---- //
  // A handle groups every (segment, x/y key) reference that sits on one point, so
  // dragging a shared corner moves all the segments meeting there and the loop
  // stays closed. Circles get a center handle (move) and a rim handle (resize).
  // Each handle carries a stable structural `key` (loop:seg:role) so the renderer
  // can match the hovered/dragged handle by identity instead of by position —
  // coincident points (concentric centers, shared corners) then stay distinct.
  function _handles() {
    const hs = [], eps = Math.max(1e-6, _tol() * 0.05);
    const addVertex = (x, y, ref, key) => {
      let h = hs.find(g => g.kind === "vertex" && Math.hypot(g.pos[0] - x, g.pos[1] - y) < eps);
      if (!h) { h = { pos: [x, y], refs: [], kind: "vertex", key }; hs.push(h); }
      h.refs.push(ref);
    };
    loops.forEach((lp, li) => lp.forEach((s, si) => {
      const k = `${li}:${si}`;
      if (s.type === "line" || s.type === "arc") {
        addVertex(s.x1, s.y1, { s, kx: "x1", ky: "y1" }, `${k}:1`);
        addVertex(s.x2, s.y2, { s, kx: "x2", ky: "y2" }, `${k}:2`);
        if (s.type === "arc") hs.push({ pos: [s.mx, s.my], refs: [{ s, kx: "mx", ky: "my" }], kind: "mid", key: `${k}:m` });
      } else if (s.type === "circle") {
        hs.push({ pos: [s.cx, s.cy], refs: [{ s, kx: "cx", ky: "cy" }], kind: "center", s, key: `${k}:c` });
        hs.push({ pos: [s.cx + s.r, s.cy], refs: [], kind: "rim", s, key: `${k}:r` });
      }
    }));
    return hs;
  }
  function _handleAt(uv) {
    const r = _grab(); let best = null, bd = r;
    for (const h of _handles()) { const d = Math.hypot(h.pos[0] - uv[0], h.pos[1] - uv[1]); if (d < bd) { bd = d; best = h; } }
    return best;
  }
  // Snap a dragged handle to grid + to OTHER segments' vertices (never its own,
  // which would pin it in place and defeat fine moves).
  function _snapDrag(uv, h) {
    let [u, v] = uv;
    // A rim handle only resizes its circle — snapping it onto another vertex
    // would be meaningless, so it just grid-snaps.
    if (h.kind !== "rim") {
      const tol = _tol(), own = new Set(h.refs.map(r => r.s));
      if (h.s) own.add(h.s);
      for (const lp of loops) for (const s of lp) {
        if (own.has(s)) continue;
        for (const pt of _segPts(s)) if (Math.hypot(pt[0] - u, pt[1] - v) < tol) return [pt[0], pt[1]];
      }
    }
    if (document.getElementById("sk3d-snap").checked) { const g = _gridStep(); return [Math.round(u / g) * g, Math.round(v / g) * g]; }
    return [u, v];
  }
  function _applyDrag(h, u, v) {
    if (h.kind === "vertex" || h.kind === "mid") {
      const shifted = new Set();   // shift each arc's control point at most once per drag
      for (const r of h.refs) {
        // Move an arc's control point with its endpoint (half the delta) so the
        // arc keeps its shape instead of kinking around a fixed control point.
        if (r.s.type === "arc" && (r.kx === "x1" || r.kx === "x2") && !shifted.has(r.s)) {
          r.s.mx += (u - r.s[r.kx]) * 0.5; r.s.my += (v - r.s[r.ky]) * 0.5; shifted.add(r.s);
        }
        r.s[r.kx] = u; r.s[r.ky] = v;
      }
    } else if (h.kind === "center") {
      h.s.cx = u; h.s.cy = v;
    } else if (h.kind === "rim") {
      h.s.r = Math.max(_tol(), Math.hypot(u - h.s.cx, v - h.s.cy));
    }
    h.pos = [u, v];
  }

  // ---- primitive selection (select tool) ----------------------------------- //
  // uv-space sample points along a segment, used both for hit-testing a click and
  // for the rubber-band box test. Reuses the same circular-arc sampling as render.
  function _segUV(seg) {
    if (seg.type === "line") return [[seg.x1, seg.y1], [seg.x2, seg.y2]];
    if (seg.type === "arc") return _arcUV(seg, 14);
    if (seg.type === "circle") { const a = []; for (let i = 0; i <= 24; i++) { const t = 2 * Math.PI * i / 24; a.push([seg.cx + seg.r * Math.cos(t), seg.cy + seg.r * Math.sin(t)]); } return a; }
    return [];
  }
  function _ptSeg(p, a, b) {   // distance from point p to segment a-b
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1e-12;
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2; t = Math.max(0, Math.min(1, t));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  }
  function _segDist(uv, seg) {
    const pts = _segUV(seg); let d = Infinity;
    for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, _ptSeg(uv, pts[i], pts[i + 1]));
    return d;
  }
  // The primitive nearest the cursor within the grab radius, or null.
  function _segAt(uv) {
    let best = null, bd = _grab();
    for (const lp of loops) for (const s of lp) { const d = _segDist(uv, s); if (d < bd) { bd = d; best = s; } }
    return best;
  }
  // Every primitive with a sample point inside the box (crossing-style select).
  function _segsInBox(a, b) {
    const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]);
    const y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
    const out = [];
    for (const lp of loops) for (const s of lp)
      if (_segUV(s).some(p => p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1)) out.push(s);
    return out;
  }
  function _deleteSelected() {
    if (!selSegs.size) return;
    _snapHist();
    loops = loops.map(lp => lp.filter(s => !selSegs.has(s))).filter(lp => lp.length);
    selSegs = new Set(); hoverSeg = null; drag = null;
    render();
  }
  function _clearSel() { selSegs = new Set(); hoverSeg = null; boxSel = null; }

  function _move(e) {
    if (!active) return;
    const uv = Viewport.screenToPlane(plane, e.clientX, e.clientY);
    if (!uv) return;
    if (tool === "select") {
      if (drag) {
        if (pendingSnap) { history.push(pendingSnap); if (history.length > 50) history.shift(); pendingSnap = null; }
        const [u, v] = _snapDrag(uv, drag); _applyDrag(drag, u, v); mouseUV = [u, v];
      } else if (boxSel) {
        boxSel.b = uv; mouseUV = uv;
      } else {
        hoverH = _handleAt(uv); hoverSeg = hoverH ? null : _segAt(uv); mouseUV = uv;
      }
      document.getElementById("sk3d-coord").textContent = _coordStr(mouseUV);
      render(); return;
    }
    mouseUV = _snap(uv);
    document.getElementById("sk3d-coord").textContent = _coordStr(mouseUV);
    render();
  }
  function _down(e) {
    if (!active || e.button !== 0) return;
    const uv = Viewport.screenToPlane(plane, e.clientX, e.clientY);
    if (!uv) return;
    if (tool === "select") {
      // 1) a vertex/handle under the cursor → drag it (move geometry, as before).
      drag = _handleAt(uv);
      if (drag) {
        pendingSnap = JSON.parse(JSON.stringify(loops));   // first move of the drag is undoable
        try { canvas().setPointerCapture(e.pointerId); } catch (_) {}
        render(); return;
      }
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      // 2) a primitive under the cursor → select it (Shift/Ctrl toggles).
      const seg = _segAt(uv);
      if (seg) {
        if (additive) { selSegs.has(seg) ? selSegs.delete(seg) : selSegs.add(seg); }
        else selSegs = new Set([seg]);
        render(); return;
      }
      // 3) empty space → start a rubber-band box (clears selection unless additive).
      if (!additive) selSegs = new Set();
      boxSel = { a: uv, b: uv, add: additive };
      try { canvas().setPointerCapture(e.pointerId); } catch (_) {}
      render(); return;
    }
    const [u, v] = _snap(uv);
    _place(u, v);
  }
  function _up(e) {
    if (boxSel) {
      const hits = _segsInBox(boxSel.a, boxSel.b);
      if (boxSel.add) hits.forEach(s => selSegs.add(s)); else selSegs = new Set(hits);
      boxSel = null; try { canvas().releasePointerCapture(e.pointerId); } catch (_) {}
      render(); return;
    }
    pendingSnap = null;
    if (drag) { drag = null; hoverH = null; try { canvas().releasePointerCapture(e.pointerId); } catch (_) {} render(); }
  }
  function _dbl() { if (cur && cur.pts && cur.pts.length >= 2) _commitPoly(true); }
  function _key(e) {
    if (!active) return;
    const k = (e.key || "").toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === "z") { e.preventDefault(); undo(); }
    else if ((e.key === "Delete" || e.key === "Backspace") && tool === "select" && selSegs.size) { e.preventDefault(); _deleteSelected(); }
    else if (e.key === "Enter" && cur && cur.pts) { e.preventDefault(); _commitPoly(true); }
    else if (e.key === "Escape") { if (cur) { cur = null; render(); } else if (selSegs.size) { _clearSel(); render(); } else cancel(); }
  }

  // Push a pre-mutation snapshot so undo() can revert exactly one step in ANY
  // tool (draw or move). Keeps the stack tool-agnostic and capped.
  function _snapHist() { history.push(JSON.parse(JSON.stringify(loops))); if (history.length > 50) history.shift(); }

  function _place(u, v) {
    if (tool === "line") {
      if (!cur) cur = { pts: [[u, v]] };
      else {
        const f = cur.pts[0];
        if (cur.pts.length >= 2 && Math.hypot(f[0] - u, f[1] - v) < _tol()) return _commitPoly(true);
        cur.pts.push([u, v]);
      }
    } else if (tool === "rect") {
      if (!cur) cur = { a: [u, v] }; else { _commitRect(cur.a, [u, v]); cur = null; }
    } else if (tool === "circle") {
      if (!cur) cur = { c: [u, v] };
      else { const r = Math.hypot(u - cur.c[0], v - cur.c[1]); if (r > 1e-3) { _snapHist(); loops.push([{ type: "circle", cx: cur.c[0], cy: cur.c[1], r }]); } cur = null; }
    } else if (tool === "arc") {
      if (!cur) cur = { pts: [[u, v]] };
      else if (cur.pts.length === 1) cur.pts.push([u, v]);
      else {
        const [s, en] = cur.pts; _snapHist();
        loops.push([{ type: "arc", x1: s[0], y1: s[1], mx: u, my: v, x2: en[0], y2: en[1] },
                    { type: "line", x1: en[0], y1: en[1], x2: s[0], y2: s[1] }]);
        cur = null;
      }
    } else if (tool === "polygon") {
      if (!cur) cur = { c: [u, v] };
      else { _snapHist(); loops.push(_ngon(cur.c, [u, v])); cur = null; }
    } else if (tool === "slot") {
      if (!cur) cur = { a: [u, v] };
      else if (!cur.b) cur.b = [u, v];
      else { _snapHist(); loops.push(_slot(cur.a, cur.b, Math.max(_perpDist([u, v], cur.a, cur.b) * 2, _tol()))); cur = null; }
    }
    render();
  }
  function _perpDist(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    return Math.abs((p[0] - a[0]) * (-dy) + (p[1] - a[1]) * dx) / L;
  }
  function _slot(a, b, w) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    const ux = dx / L, uy = dy / L, px = -uy, py = ux, r = w / 2;
    const a1 = [a[0] + px * r, a[1] + py * r], a2 = [a[0] - px * r, a[1] - py * r];
    const b1 = [b[0] + px * r, b[1] + py * r], b2 = [b[0] - px * r, b[1] - py * r];
    const bt = [b[0] + ux * r, b[1] + uy * r], at = [a[0] - ux * r, a[1] - uy * r];
    return [
      { type: "line", x1: a1[0], y1: a1[1], x2: b1[0], y2: b1[1] },
      { type: "arc", x1: b1[0], y1: b1[1], mx: bt[0], my: bt[1], x2: b2[0], y2: b2[1] },
      { type: "line", x1: b2[0], y1: b2[1], x2: a2[0], y2: a2[1] },
      { type: "arc", x1: a2[0], y1: a2[1], mx: at[0], my: at[1], x2: a1[0], y2: a1[1] },
    ];
  }
  function _ngon(c, vtx) {
    const n = Math.max(3, parseInt((document.getElementById("sk3d-ngon") || {}).value) || 6);
    const cx = c[0], cy = c[1], r = Math.hypot(vtx[0] - cx, vtx[1] - cy), a0 = Math.atan2(vtx[1] - cy, vtx[0] - cx);
    const p = []; for (let i = 0; i < n; i++) { const a = a0 + 2 * Math.PI * i / n; p.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    const segs = []; for (let i = 0; i < n; i++) segs.push({ type: "line", x1: p[i][0], y1: p[i][1], x2: p[(i + 1) % n][0], y2: p[(i + 1) % n][1] });
    return segs;
  }
  function _commitPoly(closeIt) {
    const p = cur.pts; if (p.length < 2) { cur = null; return render(); }
    const segs = [];
    for (let i = 0; i < p.length - 1; i++) segs.push({ type: "line", x1: p[i][0], y1: p[i][1], x2: p[i + 1][0], y2: p[i + 1][1] });
    if (closeIt) segs.push({ type: "line", x1: p[p.length - 1][0], y1: p[p.length - 1][1], x2: p[0][0], y2: p[0][1] });
    _snapHist(); loops.push(segs); cur = null; render();
  }
  function _commitRect(a, b) {
    const c = [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]];
    const segs = [];
    for (let i = 0; i < 4; i++) segs.push({ type: "line", x1: c[i][0], y1: c[i][1], x2: c[(i + 1) % 4][0], y2: c[(i + 1) % 4][1] });
    _snapHist(); loops.push(segs);
  }

  // ---- 3D rendering ---- //
  // Sample the true circular arc through start → mid → end. These are a 3-point
  // arc (CadQuery's threePointArc), so all three lie on one circle — render the
  // circular arc, not a Bézier through the mid as a control point. Falls back to
  // a straight chord when the points are collinear (degenerate circle).
  function _arcUV(seg, n) {
    const { x1, y1, mx, my, x2, y2 } = seg;
    const d = 2 * (x1 * (my - y2) + mx * (y2 - y1) + x2 * (y1 - my));
    if (Math.abs(d) < 1e-9) return [[x1, y1], [x2, y2]];
    const s1 = x1 * x1 + y1 * y1, s2 = mx * mx + my * my, s3 = x2 * x2 + y2 * y2;
    const cx = (s1 * (my - y2) + s2 * (y2 - y1) + s3 * (y1 - my)) / d;
    const cy = (s1 * (x2 - mx) + s2 * (x1 - x2) + s3 * (mx - x1)) / d;
    const r = Math.hypot(x1 - cx, y1 - cy);
    const TAU = 2 * Math.PI, norm = a => ((a % TAU) + TAU) % TAU;
    const a1 = Math.atan2(y1 - cy, x1 - cx);
    const am = norm(Math.atan2(my - cy, mx - cx) - a1);   // mid, as CCW offset from start
    let sweep = norm(Math.atan2(y2 - cy, x2 - cx) - a1);  // end, as CCW offset from start
    if (am > sweep) sweep -= TAU;                          // mid not on CCW path → go CW
    const out = [];
    for (let i = 0; i <= n; i++) { const a = a1 + sweep * (i / n); out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    return out;
  }
  function _segWorld(seg) {
    const W = (u, v) => Viewport.uvToWorld(plane, u, v);
    if (seg.type === "line") return [W(seg.x1, seg.y1), W(seg.x2, seg.y2)];
    if (seg.type === "circle") { const a = []; for (let i = 0; i <= 48; i++) { const t = 2 * Math.PI * i / 48; a.push(W(seg.cx + seg.r * Math.cos(t), seg.cy + seg.r * Math.sin(t))); } return a; }
    if (seg.type === "arc") return _arcUV(seg, 32).map(p => W(p[0], p[1]));
    return [];
  }
  function render() {
    Viewport.clearSketchOverlay();
    // committed geometry — selected primitives in amber, the hovered one lighter.
    for (const lp of loops) for (const s of lp) {
      const col = selSegs.has(s) ? 0xfbbf24 : (s === hoverSeg ? 0x93c5fd : 0x60a5fa);
      Viewport.addSketchLine(_segWorld(s), col, col === 0x60a5fa ? 2 : 3);
    }
    const W = (u, v) => Viewport.uvToWorld(plane, u, v);
    if (tool === "select") {
      if (boxSel) {   // rubber-band selection rectangle on the plane
        const a = boxSel.a, b = boxSel.b;
        Viewport.addSketchLine([[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]], [a[0], a[1]]].map(p => W(p[0], p[1])), 0x9aa5b1, 1);
      }
      const act = drag || hoverH;
      for (const h of _handles()) {
        const isDragged = drag && h.key === drag.key;
        const pos = isDragged ? drag.pos : h.pos;   // dragged handle follows the cursor live (e.g. off-axis rim)
        const on = act && h.key === act.key;        // match by identity, not position
        const col = h.kind === "rim" ? 0x34d399 : (on ? 0xfbbf24 : 0x60a5fa);
        Viewport.addSketchDot(W(pos[0], pos[1]), col);
      }
      return;
    }
    if (cur) {
      if (cur.pts) {
        if (tool === "arc" && cur.pts.length === 2) {
          // both ends placed → the cursor is the through-point: preview the real
          // circular arc, not a straight start→end→cursor polyline.
          const [s, en] = cur.pts;
          Viewport.addSketchLine(_segWorld({ type: "arc", x1: s[0], y1: s[1], mx: mouseUV[0], my: mouseUV[1], x2: en[0], y2: en[1] }), 0xfbbf24, 2);
        } else {
          const pts = cur.pts.map(p => W(p[0], p[1])); pts.push(W(mouseUV[0], mouseUV[1]));
          Viewport.addSketchLine(pts, 0xfbbf24, 2);
        }
        cur.pts.forEach(p => Viewport.addSketchDot(W(p[0], p[1]), 0x60a5fa));
      } else if (cur.a && tool === "slot") {
        if (!cur.b) Viewport.addSketchLine([W(cur.a[0], cur.a[1]), W(mouseUV[0], mouseUV[1])], 0xfbbf24, 2);
        else for (const s of _slot(cur.a, cur.b, Math.max(_perpDist(mouseUV, cur.a, cur.b) * 2, _tol()))) Viewport.addSketchLine(_segWorld(s), 0xfbbf24, 2);
      } else if (cur.a) {
        Viewport.addSketchLine(_segWorld({ type: "line", x1: cur.a[0], y1: cur.a[1], x2: mouseUV[0], y2: cur.a[1] }).concat(
          _segWorld({ type: "line", x1: mouseUV[0], y1: cur.a[1], x2: mouseUV[0], y2: mouseUV[1] })).concat(
            _segWorld({ type: "line", x1: mouseUV[0], y1: mouseUV[1], x2: cur.a[0], y2: mouseUV[1] })).concat(
              _segWorld({ type: "line", x1: cur.a[0], y1: mouseUV[1], x2: cur.a[0], y2: cur.a[1] })), 0xfbbf24, 2);
      } else if (cur.c) {
        if (tool === "polygon") {
          for (const s of _ngon(cur.c, mouseUV)) Viewport.addSketchLine(_segWorld(s), 0xfbbf24, 2);
        } else {
          const r = Math.hypot(mouseUV[0] - cur.c[0], mouseUV[1] - cur.c[1]);
          Viewport.addSketchLine(_segWorld({ type: "circle", cx: cur.c[0], cy: cur.c[1], r }), 0xfbbf24, 2);
        }
      }
    }
    Viewport.addSketchDot(W(mouseUV[0], mouseUV[1]), 0xfbbf24);
  }

  function _setTool(t) { tool = t; cur = null; drag = null; hoverH = null; _clearSel(); document.querySelectorAll("#sk3d-bar .sk").forEach(b => b.classList.toggle("on", b.dataset.tool === t)); render(); }
  function undo() {
    // Drawing: step back through the in-progress polyline first.
    if (cur && cur.pts && cur.pts.length > 1) { cur.pts.pop(); render(); return; }
    if (cur) { cur = null; render(); return; }
    // Otherwise revert the last committed change — a draw, a delete, a clear, or a
    // move — by restoring the snapshot. Never a bare loops.pop() (that ate whole loops).
    if (history.length) loops = history.pop();
    drag = null; hoverH = null; pendingSnap = null; _clearSel();   // restored segs are new objects
    render();
  }
  function clear() { if (loops.length) _snapHist(); loops = []; cur = null; _clearSel(); render(); }
  function finish() {
    if (cur && cur.pts && cur.pts.length >= 2) _commitPoly(true);
    if (!loops.length) { App.toast("Draw at least one closed loop", "err"); return; }
    const ref = plane.ref ? plane.ref : (plane.name ? plane.name
      : { origin: plane.origin, normal: plane.normal, xdir: plane.xdir });
    const out = loops; _cleanup();
    onFinish({ plane: ref, loops: out });
  }
  function cancel() { _cleanup(); App.toast("Sketch cancelled", ""); }
  function _cleanup() {
    active = false; _unbind(); _clearSel();
    Viewport.clearSketchOverlay();
    Viewport.orbitForSketch(false);
    Viewport.hideAllForSketch(false);   // bring the solids back (kept at the current viewpoint)
    document.getElementById("sk3d-bar").classList.add("hidden");
    if (window.App && App.updateHoverMode) App.updateHoverMode();   // restore idle inspect-hover
  }

  return { start, tool: _setTool, undo, clear, finish, cancel, deleteSelection: _deleteSelected, normalView: () => Viewport.lookNormalTo(plane), isActive: () => active };
})();
