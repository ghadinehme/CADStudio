/* Studio CAD — 2D sketcher. Draws closed loops (line polylines, rectangles,
   circles) in sketch (u,v) space and hands them to the app as a sketch feature. */
const Sketcher = (() => {
  let canvas, ctx, onFinish;
  let view = { ox: 0, oy: 0, scale: 24 };
  let tool = "line";
  let loops = [];        // committed: each = list of segments
  let cur = null;        // in-progress
  let mouseW = [0, 0];
  let panning = false, panStart = null;

  function open(planes, cb, initial) {
    onFinish = cb;
    loops = initial && initial.loops ? JSON.parse(JSON.stringify(initial.loops)) : [];
    cur = null; tool = "line";
    document.getElementById("sketch-back").classList.remove("hidden");
    const sel = document.getElementById("sk-plane");
    sel.innerHTML = planes.map(p => `<option value="${p.value}" ${initial && String(initial.plane) === String(p.value) ? "selected" : ""}>${p.label}</option>`).join("");
    canvas = document.getElementById("sk-canvas");
    ctx = canvas.getContext("2d");
    _resize();
    view = { ox: canvas.width / 2, oy: canvas.height / 2, scale: 24 };
    _bind();
    document.addEventListener("keydown", _onKey);
    window.addEventListener("resize", _onResizeWin);
    _setToolBtns();
    draw();
  }
  function close() {
    document.getElementById("sketch-back").classList.add("hidden");
    document.removeEventListener("keydown", _onKey);
    window.removeEventListener("resize", _onResizeWin);
  }

  function _resize() {
    const wrap = document.getElementById("sk-wrap");
    canvas.width = wrap.clientWidth; canvas.height = wrap.clientHeight;
  }
  const W2S = (u, v) => [view.ox + u * view.scale, view.oy - v * view.scale];
  const S2W = (x, y) => [(x - view.ox) / view.scale, (view.oy - y) / view.scale];

  function _snap(u, v) {
    if (!document.getElementById("sk-snap").checked) return [u, v];
    // snap to existing endpoints first
    const th = 8 / view.scale;
    for (const lp of loops) for (const s of lp) {
      for (const pt of _segPts(s)) if (Math.hypot(pt[0] - u, pt[1] - v) < th) return [pt[0], pt[1]];
    }
    if (cur && cur.pts) for (const p of cur.pts) if (Math.hypot(p[0] - u, p[1] - v) < th) return [p[0], p[1]];
    const g = 0.5;
    return [Math.round(u / g) * g, Math.round(v / g) * g];
  }
  function _segPts(s) {
    if (s.type === "line") return [[s.x1, s.y1], [s.x2, s.y2]];
    if (s.type === "arc") return [[s.x1, s.y1], [s.x2, s.y2]];
    if (s.type === "circle") return [[s.cx, s.cy]];
    return [];
  }

  function _bind() {
    canvas.onpointerdown = (e) => {
      if (e.button === 1 || e.shiftKey) { panning = true; panStart = [e.offsetX, e.offsetY, view.ox, view.oy]; return; }
      const [u, v] = _snap(...S2W(e.offsetX, e.offsetY));
      _place(u, v);
    };
    canvas.onpointermove = (e) => {
      if (panning) { view.ox = panStart[2] + (e.offsetX - panStart[0]); view.oy = panStart[3] + (e.offsetY - panStart[1]); draw(); return; }
      mouseW = _snap(...S2W(e.offsetX, e.offsetY));
      document.getElementById("sk-coord").textContent = `${mouseW[0].toFixed(2)}, ${mouseW[1].toFixed(2)}`;
      draw();
    };
    canvas.onpointerup = () => { panning = false; };
    canvas.ondblclick = () => { if (cur && cur.pts && cur.pts.length >= 2) _commitPolyline(true); };
    canvas.onwheel = (e) => {
      e.preventDefault();
      const f = e.deltaY < 0 ? 1.12 : 0.89;
      const [wx, wy] = S2W(e.offsetX, e.offsetY);
      view.scale *= f;
      const [sx, sy] = W2S(wx, wy);
      view.ox += e.offsetX - sx; view.oy += e.offsetY - sy;
      draw();
    };
  }
  function _onKey(e) {
    if (document.getElementById("sketch-back").classList.contains("hidden")) return;
    if (e.key === "Enter" && cur && cur.pts) { e.preventDefault(); _commitPolyline(true); }
    if (e.key === "Escape") { cur = null; draw(); }
  }
  function _onResizeWin() { _resize(); draw(); }

  function _place(u, v) {
    if (tool === "line") {
      if (!cur) cur = { pts: [[u, v]] };
      else {
        const f = cur.pts[0];
        if (cur.pts.length >= 2 && Math.hypot(f[0] - u, f[1] - v) < 8 / view.scale) return _commitPolyline(true);
        cur.pts.push([u, v]);
      }
    } else if (tool === "rect") {
      if (!cur) cur = { a: [u, v] };
      else { _commitRect(cur.a, [u, v]); cur = null; }
    } else if (tool === "circle") {
      if (!cur) cur = { c: [u, v] };
      else { const r = Math.hypot(u - cur.c[0], v - cur.c[1]); if (r > 1e-4) loops.push([{ type: "circle", cx: cur.c[0], cy: cur.c[1], r }]); cur = null; }
    } else if (tool === "arc") {
      if (!cur) cur = { pts: [[u, v]] };
      else if (cur.pts.length === 1) cur.pts.push([u, v]);
      else { // start, end, through -> arc seg as its own (closed by a chord) loop
        const [s, en] = cur.pts;
        loops.push([{ type: "arc", x1: s[0], y1: s[1], mx: u, my: v, x2: en[0], y2: en[1] },
                    { type: "line", x1: en[0], y1: en[1], x2: s[0], y2: s[1] }]);
        cur = null;
      }
    }
    draw();
  }
  function _commitPolyline(closeIt) {
    const p = cur.pts; if (p.length < 2) { cur = null; return draw(); }
    const segs = [];
    for (let i = 0; i < p.length - 1; i++) segs.push({ type: "line", x1: p[i][0], y1: p[i][1], x2: p[i + 1][0], y2: p[i + 1][1] });
    if (closeIt) segs.push({ type: "line", x1: p[p.length - 1][0], y1: p[p.length - 1][1], x2: p[0][0], y2: p[0][1] });
    loops.push(segs); cur = null; draw();
  }
  function _commitRect(a, b) {
    const c = [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]];
    const segs = [];
    for (let i = 0; i < 4; i++) segs.push({ type: "line", x1: c[i][0], y1: c[i][1], x2: c[(i + 1) % 4][0], y2: c[(i + 1) % 4][1] });
    loops.push(segs);
  }

  function draw() {
    if (!ctx) return;
    const css = getComputedStyle(document.documentElement);
    ctx.fillStyle = css.getPropertyValue("--bg"); ctx.fillRect(0, 0, canvas.width, canvas.height);
    // grid
    ctx.strokeStyle = css.getPropertyValue("--border"); ctx.lineWidth = 1;
    const step = view.scale; const x0 = view.ox % step, y0 = view.oy % step;
    ctx.globalAlpha = 0.4;
    for (let x = x0; x < canvas.width; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke(); }
    for (let y = y0; y < canvas.height; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke(); }
    ctx.globalAlpha = 1;
    // axes
    ctx.strokeStyle = "#e74c3c"; ctx.beginPath(); ctx.moveTo(0, view.oy); ctx.lineTo(canvas.width, view.oy); ctx.stroke();
    ctx.strokeStyle = "#2ecc71"; ctx.beginPath(); ctx.moveTo(view.ox, 0); ctx.lineTo(view.ox, canvas.height); ctx.stroke();
    // committed loops
    ctx.strokeStyle = css.getPropertyValue("--accent2"); ctx.lineWidth = 2;
    for (const lp of loops) _drawSegs(lp, true);
    // in-progress
    ctx.strokeStyle = "#fbbf24"; ctx.lineWidth = 2;
    if (cur) {
      if (cur.pts) {
        ctx.beginPath();
        const p0 = W2S(...cur.pts[0]); ctx.moveTo(...p0);
        for (const p of cur.pts.slice(1)) ctx.lineTo(...W2S(...p));
        ctx.lineTo(...W2S(...mouseW)); ctx.stroke();
        for (const p of cur.pts) _dot(p);
      } else if (cur.a) { _previewRect(cur.a, mouseW); }
      else if (cur.c) { const r = Math.hypot(mouseW[0] - cur.c[0], mouseW[1] - cur.c[1]); _circle(cur.c, r); }
    }
    _dot(mouseW, "#fbbf24");
  }
  function _drawSegs(lp, dots) {
    for (const s of lp) {
      ctx.beginPath();
      if (s.type === "line") { ctx.moveTo(...W2S(s.x1, s.y1)); ctx.lineTo(...W2S(s.x2, s.y2)); ctx.stroke(); }
      else if (s.type === "circle") { _circle([s.cx, s.cy], s.r); }
      else if (s.type === "arc") {
        const ps = _arcPts(s, 40);   // true circular arc through the 3 points
        ctx.moveTo(...W2S(ps[0][0], ps[0][1]));
        for (let i = 1; i < ps.length; i++) ctx.lineTo(...W2S(ps[i][0], ps[i][1]));
        ctx.stroke();
      }
    }
  }
  // Circular arc through start → mid → end (a 3-point arc, matching CadQuery's
  // threePointArc); straight chord if the three points are collinear.
  function _arcPts(seg, n) {
    const { x1, y1, mx, my, x2, y2 } = seg;
    const d = 2 * (x1 * (my - y2) + mx * (y2 - y1) + x2 * (y1 - my));
    if (Math.abs(d) < 1e-9) return [[x1, y1], [x2, y2]];
    const s1 = x1 * x1 + y1 * y1, s2 = mx * mx + my * my, s3 = x2 * x2 + y2 * y2;
    const cx = (s1 * (my - y2) + s2 * (y2 - y1) + s3 * (y1 - my)) / d;
    const cy = (s1 * (x2 - mx) + s2 * (x1 - x2) + s3 * (mx - x1)) / d;
    const r = Math.hypot(x1 - cx, y1 - cy);
    const TAU = 2 * Math.PI, norm = a => ((a % TAU) + TAU) % TAU;
    const a1 = Math.atan2(y1 - cy, x1 - cx);
    const am = norm(Math.atan2(my - cy, mx - cx) - a1);
    let sweep = norm(Math.atan2(y2 - cy, x2 - cx) - a1);
    if (am > sweep) sweep -= TAU;
    const out = [];
    for (let i = 0; i <= n; i++) { const a = a1 + sweep * (i / n); out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    return out;
  }
  function _circle(c, r) { const [x, y] = W2S(c[0], c[1]); ctx.beginPath(); ctx.arc(x, y, r * view.scale, 0, 7); ctx.stroke(); }
  function _previewRect(a, b) { const [x1, y1] = W2S(a[0], a[1]), [x2, y2] = W2S(b[0], b[1]); ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)); }
  function _dot(p, col) { const [x, y] = W2S(p[0], p[1]); ctx.fillStyle = col || getComputedStyle(document.documentElement).getPropertyValue("--accent2"); ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fill(); }

  function setTool(t) { tool = t; cur = null; _setToolBtns(); draw(); }
  function _setToolBtns() { document.querySelectorAll("#sk-head .sk").forEach(b => b.classList.toggle("on", b.dataset.tool === tool)); }
  function undo() { if (cur && cur.pts && cur.pts.length > 1) cur.pts.pop(); else if (cur) cur = null; else loops.pop(); draw(); }
  function clear() { loops = []; cur = null; draw(); }
  function finish() {
    if (cur && cur.pts && cur.pts.length >= 2) _commitPolyline(true);
    if (!loops.length) { App.toast("Draw at least one closed loop", "err"); return; }
    const plane = document.getElementById("sk-plane").value;
    close();
    onFinish({ plane, loops });
  }
  function cancel() { close(); }

  return { open, tool: setTool, undo, clear, finish, cancel };
})();
