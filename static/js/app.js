/* Studio CAD — application controller. */
const App = (() => {
  let features = [], errors = {}, bodies = [], selected = null;
  let dlg = null;          // { type, id|null, edit }
  let patchTimer = null;
  let planePicking = false;
  let datums = [];
  let measureMode = false, measurePts = [];
  let sectionOn = false;
  let holePicking = false, holeContext = null;

  // Base-plane bases (must match CadQuery's Plane.named so 3D drawing == geometry)
  const NAMED_BASES = {
    XY: { name: "XY", origin: [0, 0, 0], normal: [0, 0, 1], xdir: [1, 0, 0] },
    XZ: { name: "XZ", origin: [0, 0, 0], normal: [0, -1, 0], xdir: [1, 0, 0] },
    YZ: { name: "YZ", origin: [0, 0, 0], normal: [1, 0, 0], xdir: [0, 1, 0] },
  };
  function planeForRef(ref) {
    if (typeof ref === "string") {
      if (NAMED_BASES[ref]) return NAMED_BASES[ref];
      // Datum planes store {base,offset}; the resolved geometry lives in scene.datums.
      const d = datums.find(x => x.id === ref);
      if (d) return { ref: d.id, origin: d.origin, normal: d.normal, xdir: d.xdir || [1, 0, 0] };
      const f = features.find(x => x.id === ref);
      if (f && f.params && f.params.origin) return { ref: f.id, origin: f.params.origin, normal: f.params.normal, xdir: f.params.xdir || [1, 0, 0] };
      return NAMED_BASES.XY;
    }
    if (ref && ref.origin) return { origin: ref.origin, normal: ref.normal, xdir: ref.xdir || [1, 0, 0] };
    return NAMED_BASES.XY;
  }

  const ICON = {
    datum_plane: "layers", sketch: "draw", extrude: "expand", revolve: "cyclone",
    fillet: "rounded_corner", chamfer: "cut", shell: "inventory_2", mirror: "flip",
    linear_pattern: "view_column", circular_pattern: "data_usage", boolean: "join_inner",
    sweep: "gesture", loft: "stacked_line_chart", hole: "circle", import_solid: "view_in_ar",
  };

  // ---- API with delta -------------------------------------------------- //
  async function api(method, path, body) {
    const t0 = performance.now();
    const payload = Object.assign({ known: Viewport.getKnown() }, body || {});
    const opt = { method };
    if (method !== "GET") { opt.headers = { "Content-Type": "application/json" }; opt.body = JSON.stringify(payload); }
    const r = await fetch(path, opt);
    const d = await r.json();
    d._ms = Math.round(performance.now() - t0);
    return d;
  }
  function apply(d, opts = {}) {
    if (!d.ok) { toast(d.error || "Error", "err"); return d; }
    if (d.features) features = d.features;
    if (d.scene) {
      errors = d.scene.errors || {};
      bodies = (d.scene.bodies || []).map(b => ({ id: b.id, name: b.name }));
      if ("datums" in d.scene) datums = d.scene.datums || [];   // keep on display-only scenes
      const r = Viewport.applyScene(d.scene, opts);
      renderBodies(); renderTree();
      document.getElementById("perf").textContent = `${d._ms} ms`;
      if (PM.isOpen()) updateSelectionMarks();   // keep selection highlights through refreshes
      else { showSelInfo(null); updateHoverMode(); }   // idle: enable inspect-hover, drop stale selection
      if (r && r.missing && !opts._resync) refresh({ _resync: true });  // one-shot full resync
    }
    return d;
  }
  async function refresh(opts) { apply(await api("POST", "/api/scene"), opts); }

  // ---- tree + bodies --------------------------------------------------- //
  function renderBodies() {
    const el = document.getElementById("bodies");
    if (!bodies.length) { el.innerHTML = `<div class="tree-empty">No bodies yet</div>`; return; }
    el.innerHTML = bodies.map(b => {
      const hidden = Viewport.bodyHidden(b.id);
      return `<div class="row-item ${selected === b.id ? "sel" : ""} ${hidden ? "bhidden" : ""}"
          onclick="App.selectBody('${b.id}')" oncontextmenu="App.bodyCtx(event,'${b.id}')">
        <span class="material-icons-outlined">view_in_ar</span>
        <span class="nm">${esc(b.name)}</span>
        <span class="material-icons-outlined bodyeye" title="Hide / show" onclick="event.stopPropagation();App.toggleBody('${b.id}')">${hidden ? "visibility_off" : "visibility"}</span>
      </div>`;
    }).join("");
  }
  function toggleBody(id) { Viewport.setBodyVisible(id, Viewport.bodyHidden(id)); renderBodies(); }
  // Wire the colour panel: swatches, R/G/B sliders and a hex field, all live.
  function wireColor(m, id) {
    const cur = (Viewport.getBodyColor && Viewport.getBodyColor(id)) || "#ffa600";
    const rgb = [1, 3, 5].map(i => parseInt(cur.slice(i, i + 2), 16));
    const sliders = [...m.querySelectorAll(".cc-sl input")];
    const vlab = [...m.querySelectorAll(".cc-v")];
    const prev = m.querySelector(".cc-prev"), hexIn = m.querySelector(".cc-hex");
    const toHex = a => "#" + a.map(x => Math.max(0, Math.min(255, x | 0)).toString(16).padStart(2, "0")).join("");
    const fromHex = h => { const s = h.replace("#", ""); rgb[0] = parseInt(s.slice(0, 2), 16); rgb[1] = parseInt(s.slice(2, 4), 16); rgb[2] = parseInt(s.slice(4, 6), 16); };
    const sync = commit => {
      sliders.forEach((s, i) => { s.value = rgb[i]; vlab[i].textContent = rgb[i]; });
      const h = toHex(rgb); prev.style.background = h; if (document.activeElement !== hexIn) hexIn.value = h;
      if (commit) Viewport.setBodyColor(id, h);
    };
    sync(false);
    sliders.forEach((s, i) => s.oninput = () => { rgb[i] = parseInt(s.value) || 0; sync(true); });
    hexIn.oninput = () => { const v = hexIn.value.trim(); if (/^#?[0-9a-fA-F]{6}$/.test(v)) { fromHex(v); sync(true); } };
    m.querySelectorAll(".cc-sw .swatch").forEach(sw => sw.onclick = () => { fromHex(sw.dataset.color); sync(true); });
  }
  // Palette: the actual default colour first, then handy presets.
  const COLORS = ["#ffa600", "#6aa9ff", "#7bd88f", "#f0a868", "#c792ea", "#f07178", "#5fd7d7", "#e6c07b", "#c7ccd4", "#ffffff"];
  function bodyCtx(e, id) {
    e.preventDefault(); e.stopPropagation(); closeCtx();
    const def = (Viewport.defaultBodyColor && Viewport.defaultBodyColor()) || "#ffa600";
    const m = document.createElement("div"); m.id = "ctx";
    m.innerHTML = `
      <div class="ci" data-a="isolate"><span class="material-icons-outlined">filter_center_focus</span>Isolate</div>
      <div class="ci" data-a="showall"><span class="material-icons-outlined">visibility</span>Show all</div>
      <div class="ci" data-a="rename"><span class="material-icons-outlined">edit</span>Rename</div>
      <div class="csep"></div>
      <div class="cc">
        <div class="cc-h"><span class="material-icons-outlined">palette</span>Colour</div>
        <div class="cc-sw">${COLORS.map(c => `<span class="swatch${c.toLowerCase() === def.toLowerCase() ? " def" : ""}" data-color="${c}" style="background:${c}" title="${c.toLowerCase() === def.toLowerCase() ? "Default" : c}"></span>`).join("")}</div>
        <div class="cc-sl">
          ${["R", "G", "B"].map((ch, i) => `<div class="cc-row"><b>${ch}</b><input type="range" min="0" max="255" data-ch="${i}"><span class="cc-v" data-vv="${i}"></span></div>`).join("")}
        </div>
        <div class="cc-f"><span class="cc-prev"></span><input class="cc-hex" type="text" spellcheck="false" maxlength="7"></div>
      </div>
      <div class="csep"></div>
      <div class="ci danger" data-a="delete"><span class="material-icons-outlined">delete</span>Delete body</div>`;
    m.style.left = e.clientX + "px"; m.style.top = e.clientY + "px";
    document.body.appendChild(m);
    wireColor(m, id);
    const onOutside = (ev) => { if (m.contains(ev.target)) return; document.removeEventListener("pointerdown", onOutside, true); closeCtx(); };
    m.onclick = (ev) => {
      const ci = ev.target.closest(".ci"); if (!ci) return;   // color panel handles its own clicks
      const a = ci.dataset.a;
      document.removeEventListener("pointerdown", onOutside, true); closeCtx();
      if (a === "isolate") { Viewport.isolateBody(id); renderBodies(); }
      else if (a === "showall") { Viewport.showAllBodies(); renderBodies(); }
      else if (a === "rename") { const nm = prompt("Rename body", bodies.find(b => b.id === id)?.name || ""); if (nm) api("PATCH", `/api/feature/${id}`, { name: nm }).then(d => apply(d)); }
      else if (a === "delete") del(id);
    };
    setTimeout(() => document.addEventListener("pointerdown", onOutside, true), 0);
  }
  function renderTree() {
    const el = document.getElementById("tree");
    if (!features.length) {
      el.innerHTML = `<div class="tree-empty">Empty.<br>Click <b>Sketch</b> to begin,<br>or import a CadQuery <b>.py</b>.</div>`;
      return;
    }
    el.innerHTML = features.map((f, i) => {
      const err = errors[f.id];
      return `<div class="row-item ${f.suppressed ? "suppressed" : ""} ${err ? "errored" : ""} ${selected === f.id ? "sel" : ""}"
            onclick="App.selectFeature('${f.id}')" ondblclick="App.editFeature('${f.id}')"
            oncontextmenu="App.ctx(event,'${f.id}',${i})">
          <span class="material-icons-outlined">${ICON[f.type] || "category"}</span>
          <span class="nm">${esc(f.name || f.type)}</span>
          ${err ? `<span class="material-icons-outlined err" title="${esc(err)}">error_outline</span>` : ""}
          <span class="material-icons-outlined eye" title="Suppress" onclick="event.stopPropagation();App.toggleSuppress('${f.id}')">${f.suppressed ? "visibility_off" : "visibility"}</span>
        </div>`;
    }).join("");
  }
  function selectBody(id) {
    if (PM.isOpen() && PM.select("body", id)) return;   // PM consumes if a body/edge box is active
    selected = id; Viewport.highlight(id); renderBodies(); renderTree();
  }
  function selectFeature(id) {
    const f = features.find(x => x.id === id);
    if (planePicking && f && f.type === "datum_plane" && sketchOnDatum(id)) return;  // pick a datum from the sidebar
    if (PM.isOpen()) {
      if (f && f.type === "sketch" && PM.select("sketch", id)) return;
      if (bodies.some(b => b.id === id) && PM.select("body", id)) return;
    }
    selected = id; renderBodies(); renderTree();
    if (bodies.some(b => b.id === id)) Viewport.highlight(id);
  }
  function updateHoverMode() {
    let m = null;
    if (PM.isOpen()) {
      const flt = PM.activeFilter();
      const fl = Array.isArray(flt) ? (flt.includes("edge") ? "edge" : flt.includes("face") ? "face" : flt.includes("body") ? "body" : null) : flt;
      if (fl === "edge" || fl === "face" || fl === "body") m = fl;
    } else if (planePicking || holePicking) m = "face";
    else if (!Sketch3D.isActive() && !measureMode && bodies.length) m = "inspect";  // idle → hover-highlight geometry
    if (m !== "inspect") { const el = document.getElementById("sel-info"); if (el && !el.classList.contains("hidden")) { el.classList.add("hidden"); Viewport.clearInspect(); } }
    Viewport.setHoverMode(m);
  }
  // Show / clear the click-selection readout (edge length, face area, vertex xyz).
  function showSelInfo(info) {
    const el = document.getElementById("sel-info");
    if (!info) { el.classList.add("hidden"); Viewport.clearInspect(); return; }
    const ic = { vertex: "scatter_plot", edge: "timeline", face: "crop_square" }[info.kind] || "touch_app";
    const nm = (bodies.find(b => b.id === info.body) || {}).name || "";
    let detail = "";
    if (info.kind === "vertex") detail = `<div class="si-row">x <b>${info.point[0].toFixed(3)}</b> &nbsp; y <b>${info.point[1].toFixed(3)}</b> &nbsp; z <b>${info.point[2].toFixed(3)}</b></div>`;
    else if (info.kind === "edge") detail = `<div class="si-row">Length <b>${info.length.toFixed(4)}</b></div>`;
    else if (info.kind === "face") detail = `<div class="si-row">Area <b>${info.area.toFixed(4)}</b></div>`;
    el.innerHTML = `<div class="si-kind"><span class="material-icons-outlined">${ic}</span>${label(info.kind)}${nm ? ` <span class="si-row">· ${esc(nm)}</span>` : ""}</div>${detail}`;
    el.classList.remove("hidden");
  }
  // Helpers used by the PropertyManager
  function labelFor(kind, id) {
    const f = features.find(x => x.id === id);
    if (f) return f.name || f.type;
    const b = bodies.find(x => x.id === id);
    if (b) return b.name;
    return String(id || "?").slice(0, 6);
  }
  function selectedBody() {
    if (selected && bodies.some(b => b.id === selected)) return selected;
    return bodies.length ? bodies[bodies.length - 1].id : null;
  }
  function applyPreview(scene) { Viewport.applyScene(scene); updateSelectionMarks(); }
  function updateSelectionMarks() { if (PM.isOpen()) Viewport.showSelectionMarks(PM.selectionMarks()); updateHoverMode(); }
  function ensureEdges() { if (Viewport.getDisplayMode() === "shaded") Viewport.setDisplayMode("edges"); }

  // ---- context menu ---------------------------------------------------- //
  function ctx(e, id, i) {
    e.preventDefault(); e.stopPropagation(); closeCtx();
    const m = document.createElement("div"); m.id = "ctx";
    const first = i === 0, last = i === features.length - 1;
    const f = features.find(x => x.id === id);
    m.innerHTML = `
      ${f.type === "datum_plane" ? `<div class="ci" data-a="sketch"><span class="material-icons-outlined">draw</span>Sketch on plane</div><div class="csep"></div>` : ""}
      <div class="ci" data-a="edit"><span class="material-icons-outlined">edit</span>Edit</div>
      <div class="ci ${first ? "disabled" : ""}" data-a="up"><span class="material-icons-outlined">arrow_upward</span>Move up</div>
      <div class="ci ${last ? "disabled" : ""}" data-a="down"><span class="material-icons-outlined">arrow_downward</span>Move down</div>
      <div class="ci" data-a="suppress"><span class="material-icons-outlined">${f.suppressed ? "visibility" : "visibility_off"}</span>${f.suppressed ? "Unsuppress" : "Suppress"}</div>
      <div class="csep"></div>
      <div class="ci danger" data-a="delete"><span class="material-icons-outlined">delete</span>Delete</div>`;
    m.style.left = e.clientX + "px"; m.style.top = e.clientY + "px";
    document.body.appendChild(m);
    const onOutside = (ev) => { if (m.contains(ev.target)) return; document.removeEventListener("pointerdown", onOutside, true); closeCtx(); };
    m.onclick = (ev) => {
      const ci = ev.target.closest(".ci"); if (!ci || ci.classList.contains("disabled")) return;
      const a = ci.dataset.a;
      document.removeEventListener("pointerdown", onOutside, true); closeCtx();
      if (a === "sketch") sketchOnDatum(id);
      else if (a === "edit") editFeature(id);
      else if (a === "up") move(id, i - 1);
      else if (a === "down") move(id, i + 1);
      else if (a === "suppress") toggleSuppress(id);
      else if (a === "delete") del(id);
    };
    setTimeout(() => document.addEventListener("pointerdown", onOutside, true), 0);
  }
  function closeCtx() { const m = document.getElementById("ctx"); if (m) m.remove(); }

  async function move(id, to) { busy(true); apply(await api("POST", `/api/feature/${id}/move`, { to })); busy(false); }
  async function del(id) { busy(true); apply(await api("DELETE", `/api/feature/${id}`)); busy(false); }
  async function toggleSuppress(id) {
    const f = features.find(x => x.id === id); if (!f) return;
    apply(await api("PATCH", `/api/feature/${id}`, { suppressed: !f.suppressed }));
  }

  // ---- feature dialogs ------------------------------------------------- //
  const SPECS = {
    datum_plane: () => [
      sel("base", "Base plane", [["XY", "XY (Top)"], ["XZ", "XZ (Front)"], ["YZ", "YZ (Right)"]]),
      num("offset", "Offset", 10),
    ],
    extrude: () => [
      sel("sketch", "Sketch", sketchOpts()),
      num("distance", "Distance", 10),
      sel("direction", "Direction", [["normal", "Normal"], ["symmetric", "Symmetric"], ["reverse", "Reverse"]]),
      sel("operation", "Operation", opOpts()),
      sel("target", "Target body", bodyOpts(), { dep: "operation", showUnless: "new" }),
    ],
    revolve: () => [
      sel("sketch", "Sketch", sketchOpts()),
      num("angle", "Angle (°)", 360),
      sel("__axis", "Axis", axisOpts()),
      sel("operation", "Operation", opOpts()),
      sel("target", "Target body", bodyOpts(), { dep: "operation", showUnless: "new" }),
    ],
    hole: () => [
      num("diameter", "Diameter", 5),
      chk("through", "Through all"),
      num("depth", "Depth (if blind)", 10),
      chk("counterbore", "Counterbore"),
      num("cbore_diameter", "C'bore diameter", 10),
      num("cbore_depth", "C'bore depth", 4),
    ],
    fillet: () => [sel("target", "Body", bodyOpts()), num("radius", "Radius", 2)],
    chamfer: () => [sel("target", "Body", bodyOpts()), num("distance", "Distance", 1)],
    shell: () => [sel("target", "Body", bodyOpts()), num("thickness", "Thickness", 1)],
    mirror: () => [sel("target", "Body", bodyOpts()), sel("plane", "Mirror plane", [["XY", "XY"], ["XZ", "XZ"], ["YZ", "YZ"]]), chk("merge", "Merge with original")],
    linear_pattern: () => [sel("target", "Body", bodyOpts()), sel("__dir", "Direction", [["x", "X"], ["y", "Y"], ["z", "Z"]]), num("count", "Count", 3), num("spacing", "Spacing", 15)],
    circular_pattern: () => [sel("target", "Body", bodyOpts()), sel("__caxis", "Axis", axisOpts()), num("count", "Count", 6), num("angle", "Total angle (°)", 360)],
    boolean: () => [sel("operation", "Operation", [["union", "Union"], ["cut", "Cut"], ["intersect", "Intersect"]]), sel("target", "Target body", bodyOpts()), multiBody("tools", "Tool bodies")],
  };

  function sketchOpts() { return features.filter(f => f.type === "sketch").map(f => [f.id, f.name]); }
  function bodyOpts() { return bodies.map(b => [b.id, b.name]); }
  function opOpts() { return [["new", "New body"], ["add", "Add (union)"], ["cut", "Cut"], ["intersect", "Intersect"]]; }
  function axisOpts() { return [["keep", "Current axis"], ["y", "Y axis"], ["x", "X axis"], ["z", "Z axis"]]; }
  const AXES = { x: [[0, 0, 0], [1, 0, 0]], y: [[0, 0, 0], [0, 1, 0]], z: [[0, 0, 0], [0, 0, 1]] };
  function near(a, b) { return a && b && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-6); }
  function axisLetter(p) { for (const k of ["x", "y", "z"]) if (near(p.axis_start, AXES[k][0]) && near(p.axis_end, AXES[k][1])) return k; return null; }

  function num(k, label, def) { return { k, label, type: "number", def }; }
  function sel(k, label, opts, extra) { return Object.assign({ k, label, type: "select", opts }, extra || {}); }
  function chk(k, label) { return { k, label, type: "checkbox" }; }
  function multiBody(k, label) { return { k, label, type: "multi", opts: bodyOpts() }; }

  function addOp(type) {
    if ((type === "extrude" || type === "revolve") && !features.some(f => f.type === "sketch")) { toast("Create a sketch first", "err"); return; }
    if (["fillet", "chamfer", "shell", "mirror", "linear_pattern", "circular_pattern", "boolean", "hole"].includes(type) && !bodies.length) { toast("Create a body first", "err"); return; }
    PM.open(type, { onApply: async (params) => { busy(true); apply(await api("POST", "/api/feature", { feature: { type, params } })); busy(false); } });
  }
  function editFeature(id) {
    const f = features.find(x => x.id === id); if (!f) return;
    if (f.type === "sketch") return editSketch(f);
    if (f.type === "import_solid") { toast("Re-import the STEP to change an imported body", "err"); return; }
    PM.open(f.type, { feature: f, onApply: async (params) => apply(await api("PATCH", `/api/feature/${id}`, { params })) });
  }

  function openDialog(type, feat) {
    dlg = { type, id: feat ? feat.id : null, edit: !!feat };
    const specs = (SPECS[type] || (() => []))();
    const p = feat ? feat.params : {};
    document.getElementById("dlg-title").textContent = (feat ? "Edit " : "Add ") + label(type);
    document.getElementById("dlg-ok").textContent = feat ? "Done" : "Add";
    const body = document.getElementById("dlg-body");
    body.innerHTML = specs.map(s => fieldHtml(s, p)).join("");
    document.getElementById("dlg-back").classList.remove("hidden");
    // dependent show/hide + live edit wiring
    const upd = () => {
      specs.forEach(s => {
        if (s.dep) {
          const dv = body.querySelector(`[data-k="${s.dep}"]`).value;
          const wrap = body.querySelector(`[data-wrap="${s.k}"]`);
          if (wrap) wrap.style.display = (dv === s.showUnless) ? "none" : "";
        }
      });
    };
    body.querySelectorAll("[data-k]").forEach(inp => {
      inp.addEventListener("input", () => { upd(); if (dlg.edit) livePatch(); });
      inp.addEventListener("change", () => { upd(); if (dlg.edit) livePatch(); });
    });
    upd();
  }
  function fieldHtml(s, p) {
    const v = pickVal(s, p);
    if (s.type === "number") return `<div class="fld" data-wrap="${s.k}"><label>${s.label}</label><input type="number" step="any" data-k="${s.k}" value="${v}"></div>`;
    if (s.type === "checkbox") return `<div class="fld inline" data-wrap="${s.k}"><input type="checkbox" data-k="${s.k}" ${v ? "checked" : ""}><label>${s.label}</label></div>`;
    if (s.type === "select") return `<div class="fld" data-wrap="${s.k}"><label>${s.label}</label><select data-k="${s.k}">${s.opts.map(o => `<option value="${o[0]}" ${String(o[0]) === String(v) ? "selected" : ""}>${o[1]}</option>`).join("")}</select></div>`;
    if (s.type === "multi") return `<div class="fld" data-wrap="${s.k}"><label>${s.label}</label>${s.opts.map(o => `<label class="fld inline" style="margin:4px 0"><input type="checkbox" data-multi="${s.k}" value="${o[0]}"> ${o[1]}</label>`).join("") || '<span class="dim">no other bodies</span>'}</div>`;
    return "";
  }
  function pickVal(s, p) {
    if (s.k === "__axis" || s.k === "__caxis") {
      if (p.axis_start && p.axis_end) return axisLetter(p) || "keep";
      return s.k === "__caxis" ? "z" : "y";
    }
    if (s.k === "__dir") { if (p.dir) for (const k of ["x", "y", "z"]) if (near(p.dir, AXES[k][1])) return k; return "x"; }
    if (s.k in p) return p[s.k];
    return s.def !== undefined ? s.def : (s.type === "select" && s.opts[0] ? s.opts[0][0] : "");
  }
  function gather() {
    const body = document.getElementById("dlg-body");
    // Start from the existing params on edit so fields not exposed in the dialog
    // (e.g. an imported revolve's custom axis) are preserved on a partial edit.
    const base = dlg && dlg.edit ? Object.assign({}, (features.find(f => f.id === dlg.id) || {}).params) : {};
    const params = base;
    body.querySelectorAll("[data-k]").forEach(inp => {
      const k = inp.dataset.k;
      let val = inp.type === "checkbox" ? inp.checked : (inp.type === "number" ? parseFloat(inp.value) || 0 : inp.value);
      if (k === "__axis" || k === "__caxis") { if (val !== "keep") { params.axis_start = AXES[val][0]; params.axis_end = AXES[val][1]; } }
      else if (k === "__dir") { params.dir = AXES[val][1]; }
      else params[k] = val;
    });
    if (body.querySelector("[data-multi]")) params.tools = [...body.querySelectorAll("[data-multi]:checked")].map(c => c.value);
    // A newly-placed hole carries its picked location/normal/target.
    if (dlg && dlg.type === "hole" && !dlg.edit && holeContext) Object.assign(params, holeContext);
    return params;
  }
  function livePatch() {
    if (!dlg || !dlg.id) return;
    const id = dlg.id, params = gather();
    clearTimeout(patchTimer);
    patchTimer = setTimeout(async () => {
      apply(await api("PATCH", `/api/feature/${id}`, { params, live: true }));
    }, 90);
  }
  async function submitDialog() {
    if (!dlg) return;
    if (dlg.edit) { closeDialog(); return; }
    busy(true);
    apply(await api("POST", "/api/feature", { feature: { type: dlg.type, params: gather() } }));
    busy(false); closeDialog();
  }
  function closeDialog(e) {
    if (e && e.target.id !== "dlg-back") return;
    clearTimeout(patchTimer); patchTimer = null;
    document.getElementById("dlg-back").classList.add("hidden"); dlg = null;
  }

  // ---- sketch flow ----------------------------------------------------- //
  function planeOptions() {
    const opts = [{ value: "XY", label: "XY (Top)" }, { value: "XZ", label: "XZ (Front)" }, { value: "YZ", label: "YZ (Right)" }];
    features.filter(f => f.type === "datum_plane").forEach(f => opts.push({ value: f.id, label: f.name }));
    return opts;
  }
  let _planePickCb = null;
  function startSketch() {
    if (Sketch3D.isActive() || planePicking) return;
    planePicking = true;
    document.getElementById("plane-hint").classList.remove("hidden");
    status("Select a base plane, a model face, or a datum plane in the tree to sketch on");
    updateHoverMode();   // highlight faces under the cursor
    _planePickCb = async (picked) => {  // base plane, face, or a datum plane
      planePicking = false; _planePickCb = null;
      Viewport.setHoverMode(null);
      Viewport.showPlanePickers(false);
      document.getElementById("plane-hint").classList.add("hidden");
      let plane;
      if (picked._facePoint) {
        const d = await api("POST", "/api/face_at", { point: picked._facePoint });
        if (!d.ok) { toast("No face there — try a base plane", "err"); status("Ready"); return; }
        plane = { origin: d.plane.origin, normal: d.plane.normal, xdir: d.plane.xdir };
      } else {
        plane = picked;   // base plane (.name) or datum plane (.ref)
        // A datum could have been deleted while the pickers were on screen; its
        // stale id would resolve to XY. Drop the dead ref and keep the captured
        // geometry so the sketch still lands where the user clicked.
        if (plane.ref && !datums.some(d => d.id === plane.ref)) {
          if (plane.origin && plane.normal) plane = { origin: plane.origin, normal: plane.normal, xdir: plane.xdir };
          else { toast("That plane no longer exists", "err"); status("Ready"); return; }
        }
      }
      status("Sketching — left-drag is disabled, right-drag orbits");
      Sketch3D.start(plane, async ({ plane: ref, loops }) => {
        busy(true);
        apply(await api("POST", "/api/feature", { feature: { type: "sketch", params: { plane: ref, loops } } }));
        busy(false);
        toast("Sketch added — Extrude or Revolve it", "ok"); status("Ready");
      });
    };
    Viewport.showPlanePickers(true, _planePickCb, datums);
  }
  // Start a sketch directly on a datum plane (e.g. from the feature tree).
  function sketchOnDatum(id) {
    const d = datums.find(x => x.id === id); if (!d) return false;
    if (planePicking && _planePickCb) { _planePickCb({ ref: d.id, origin: d.origin, normal: d.normal, xdir: d.xdir }); return true; }
    if (Sketch3D.isActive()) return false;
    Viewport.showPlanePickers(false); Viewport.setHoverMode(null);
    document.getElementById("plane-hint").classList.add("hidden"); planePicking = false;
    status("Sketching on " + (d.name || "plane"));
    Sketch3D.start({ ref: d.id, origin: d.origin, normal: d.normal, xdir: d.xdir }, async ({ plane: ref, loops }) => {
      busy(true); apply(await api("POST", "/api/feature", { feature: { type: "sketch", params: { plane: ref, loops } } })); busy(false);
      toast("Sketch added", "ok"); status("Ready");
    });
    return true;
  }
  function cancelPlanePick() {
    planePicking = false; _planePickCb = null;
    Viewport.setHoverMode(null);
    Viewport.showPlanePickers(false);
    document.getElementById("plane-hint").classList.add("hidden");
    status("Ready");
  }
  function startHole() {
    if (!bodies.length) { toast("Create a body first", "err"); return; }
    holePicking = true;
    document.getElementById("view").style.cursor = "crosshair";
    status("Click a face to place a hole (Esc to cancel)");
    updateHoverMode();   // highlight faces under the cursor
  }
  async function placeHole(bid, point) {
    holePicking = false;
    Viewport.setHoverMode(null);
    document.getElementById("view").style.cursor = "";
    status("Ready");
    const d = await api("POST", "/api/face_at", { point: [point.x, point.y, point.z] });
    const normal = d.ok ? d.plane.normal : [0, 0, 1];
    const prefill = { target: bid, cx: point.x, cy: point.y, cz: point.z, normal };
    PM.open("hole", { prefill, onApply: async (params) => { busy(true); apply(await api("POST", "/api/feature", { feature: { type: "hole", params } })); busy(false); } });
  }
  function editSketch(f) {
    Sketch3D.start(planeForRef(f.params.plane), async ({ plane: ref, loops }) => {
      apply(await api("PATCH", `/api/feature/${f.id}`, { params: { plane: ref, loops } }));
      status("Ready");
    }, f.params.loops || []);
  }

  // ---- import / export ------------------------------------------------- //
  function pickImport(kind) {
    const map = { py: "file-py", mesh: "file-mesh", solid: "file-solid" };
    document.getElementById(map[kind] || "file-py").click();
  }
  async function importSolidFile(file) {
    busy(true);
    const fd = new FormData(); fd.append("file", file);
    try {
      const r = await fetch("/api/import/solid", { method: "POST", body: fd });
      const d = await r.json();
      if (d.ok) { apply(d, { fit: true }); refreshCode(); toast("Imported " + file.name + " as a body", "ok"); }
      else toast(d.error, "err");
    } catch (e) { toast(e.message, "err"); }
    busy(false);
  }

  // ---- measure + section ---------------------------------------------- //
  function toggleMeasure() {
    measureMode = !measureMode;
    document.getElementById("btn-measure").classList.toggle("active", measureMode);
    measurePts = []; Viewport.clearMeasure();
    document.getElementById("measure-readout").classList.toggle("hidden", !measureMode);
    if (measureMode) { document.getElementById("measure-readout").textContent = "Click two points to measure"; status("Measure mode"); }
    else status("Ready");
  }
  function measureClick(pt) {
    measurePts.push(pt); Viewport.addMeasureDot(pt);
    if (measurePts.length === 2) {
      const [a, b] = measurePts;
      Viewport.showMeasure(a, b);
      const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      document.getElementById("measure-readout").innerHTML =
        `Distance <b>${d.toFixed(3)}</b> &nbsp; Δx ${(b[0] - a[0]).toFixed(2)} &nbsp; Δy ${(b[1] - a[1]).toFixed(2)} &nbsp; Δz ${(b[2] - a[2]).toFixed(2)}`;
      measurePts = [];
    }
  }
  function cycleDisplay() {
    const order = ["edges", "shaded", "wire"];
    const next = order[(order.indexOf(Viewport.getDisplayMode()) + 1) % order.length];
    Viewport.setDisplayMode(next);
    toast("Display: " + (next === "edges" ? "Shaded + edges" : next === "shaded" ? "Shaded" : "Wireframe"), "");
  }
  function toggleSection() {
    sectionOn = !sectionOn;
    document.getElementById("btn-section").classList.toggle("active", sectionOn);
    document.getElementById("section-panel").classList.toggle("hidden", !sectionOn);
    if (sectionOn) updateSection(); else Viewport.setSection(false);
  }
  function updateSection() {
    const axis = document.getElementById("sec-axis").value;
    const off = parseFloat(document.getElementById("sec-off").value);
    document.getElementById("sec-val").textContent = off;
    Viewport.setSection(true, axis, off);
  }
  async function importPy(file) {
    busy(true);
    const fd = new FormData(); fd.append("file", file);
    try {
      const r = await fetch("/api/import/script", { method: "POST", body: fd });
      const d = await r.json();
      if (d.ok) { apply(d, { fit: true }); refreshCode(); toast("Imported " + file.name, "ok"); }
      else toast(d.error, "err");
    } catch (e) { toast(e.message, "err"); }
    busy(false);
  }
  async function viewMesh(file) {
    busy(true);
    const fd = new FormData(); fd.append("file", file);
    try {
      const r = await fetch("/api/view_file", { method: "POST", body: fd });
      const d = await r.json();
      if (d.ok) {
        // show as read-only bodies (clears the feature model view, incl. datum squares)
        const bs = d.mesh.bodies.map(b => ({ id: b.id, name: b.name, hash: Math.random().toString(36).slice(2), mesh: b }));
        datums = [];
        Viewport.applyScene({ bodies: bs, sketches: [], datums: [], errors: {} }, { fit: true });
        toast("Viewing " + file.name + " (read-only)", "ok");
      } else toast(d.error, "err");
    } catch (e) { toast(e.message, "err"); }
    busy(false);
  }
  function exp(fmt) { window.location.href = `/api/export/${fmt}`; }

  // ---- code panel ------------------------------------------------------ //
  function toggleCode() {
    const r = document.getElementById("right"); r.classList.toggle("hidden");
    if (!r.classList.contains("hidden")) refreshCode();
    setTimeout(Viewport.onResize, 0);
  }
  async function refreshCode() { const d = await (await fetch("/api/code")).json(); if (d.ok) document.getElementById("code").value = d.code; }
  async function runCode() {
    busy(true);
    const code = document.getElementById("code").value;
    const r = await fetch("/api/run_code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, known: Viewport.getKnown() }) });
    const d = await r.json(); busy(false);
    const st = document.getElementById("code-status");
    if (d.ok) {
      apply(d, { fit: true });
      st.textContent = d.method === "parsed" ? "Parsed into feature tree ✓"
        : d.method === "skipped" ? "Kept feature tree (imported solid)" : "Executed (display only)";
      st.style.color = d.method === "parsed" ? "var(--ok)" : "var(--warn)";
      if (d.warning) toast(d.warning, "err");
    } else { st.textContent = d.error; st.style.color = "var(--err)"; toast(d.error, "err"); }
  }
  function copyCode() { navigator.clipboard.writeText(document.getElementById("code").value); toast("Copied", "ok"); }

  // ---- misc ------------------------------------------------------------ //
  async function reset() { if (!confirm("Start a new model?")) return; apply(await api("POST", "/api/reset")); selected = null; Viewport.fit(); }
  async function undo() { apply(await api("POST", "/api/undo")); }
  async function redo() { apply(await api("POST", "/api/redo")); }
  function toggleTheme() {
    const cur = document.documentElement.getAttribute("data-theme");
    const next = cur === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    document.getElementById("theme-ic").textContent = next === "light" ? "light_mode" : "dark_mode";
    Viewport.setTheme();
  }
  function busy(on) { document.getElementById("busy").classList.toggle("hidden", !on); }
  function toast(msg, type) {
    const t = document.createElement("div"); t.className = "toast " + (type || ""); t.textContent = msg;
    document.getElementById("toasts").appendChild(t); setTimeout(() => t.remove(), 3200);
  }
  // Drag a file anywhere onto the app to load it (.py → CadQuery import,
  // .stl → view, .step/.stp → import as a body).
  function initDropZone() {
    const stage = document.getElementById("stage");
    const dz = document.getElementById("dropzone");
    let depth = 0;
    const show = on => { if (dz) dz.classList.toggle("hidden", !on); };
    window.addEventListener("dragenter", e => { if (!e.dataTransfer || ![...e.dataTransfer.types].includes("Files")) return; e.preventDefault(); depth++; show(true); });
    window.addEventListener("dragover", e => { if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) e.preventDefault(); });
    window.addEventListener("dragleave", e => { if (--depth <= 0) { depth = 0; show(false); } });
    window.addEventListener("drop", e => {
      if (!e.dataTransfer || !e.dataTransfer.files.length) return;
      e.preventDefault(); depth = 0; show(false);
      const file = e.dataTransfer.files[0];
      const ext = (file.name.split(".").pop() || "").toLowerCase();
      if (ext === "py") importPy(file);
      else if (ext === "stl") viewMesh(file);
      else if (ext === "step" || ext === "stp") importSolidFile(file);
      else toast("Drop a .py, .stl, .step or .stp file", "err");
    });
  }

  function status(s) { document.getElementById("status").textContent = s; }
  function label(t) { return (t || "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()); }
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  function init() {
    Viewport.init(document.getElementById("view"));
    Viewport.setPick((bid, hit, ev) => {
      if (planePicking || Sketch3D.isActive()) return;   // plane-pick / sketch own the click
      if (PM.isOpen()) {
        const flt = PM.activeFilter();
        const fl = Array.isArray(flt) ? (flt.includes("edge") ? "edge" : flt.includes("face") ? "face" : flt.includes("body") ? "body" : null) : flt;
        if (fl === "edge") { const e = Viewport.hoverInfo() || (ev && Viewport.pickEdgeAt(ev.clientX, ev.clientY)); if (e) PM.select("edge", e); return; }
        if (fl === "face") { const h = Viewport.hoverInfo() || (hit && hit.point && bid ? { point: [hit.point.x, hit.point.y, hit.point.z], body: bid } : null); if (h) PM.select("face", h); return; }
        if (fl === "body" && bid) { PM.select("body", bid); return; }
        return;   // panel open without a geometry filter -> ignore viewport clicks
      }
      if (holePicking) { if (bid && hit && hit.point) placeHole(bid, hit.point); return; }
      if (measureMode) { if (hit && hit.point) measureClick([hit.point.x, hit.point.y, hit.point.z]); return; }
      // Idle: click highlights the edge / face / vertex under the cursor (CAD-style)
      // and shows its measurement; a click on empty space clears the selection.
      const info = Viewport.inspectCommit();
      showSelInfo(info);
      if (info && info.body) { selected = info.body; renderBodies(); renderTree(); }
      else if (!info) { selected = null; renderBodies(); renderTree(); }
    });
    document.getElementById("file-py").onchange = e => { if (e.target.files[0]) importPy(e.target.files[0]); e.target.value = ""; };
    document.getElementById("file-mesh").onchange = e => { if (e.target.files[0]) viewMesh(e.target.files[0]); e.target.value = ""; };
    document.getElementById("file-solid").onchange = e => { if (e.target.files[0]) importSolidFile(e.target.files[0]); e.target.value = ""; };
    initDropZone();
    document.addEventListener("keydown", e => {
      // PropertyManager: Enter commits, Esc cancels — even from a focused field
      // (but never from the code editor, which keeps Ctrl+Enter to run).
      if (PM.isOpen() && e.target.id !== "code") {
        if (e.key === "Escape") { e.preventDefault(); PM.cancel(); return; }
        if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) { e.preventDefault(); PM.apply(); return; }
      }
      if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT") {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") runCode();
        return;
      }
      if (PM.isOpen()) return;   // suppress global shortcuts while the panel is open
      // Plane-pick / 3D-sketch handle their own keys (Esc to cancel).
      if (e.key === "Escape" && planePicking) { cancelPlanePick(); return; }
      if (e.key === "Escape" && holePicking) { holePicking = false; Viewport.setHoverMode(null); document.getElementById("view").style.cursor = ""; status("Ready"); return; }
      if (Sketch3D.isActive() || planePicking || holePicking) return;
      // Don't let global shortcuts (undo/redo/fit) fire while a modal is open.
      if (!document.getElementById("sketch-back").classList.contains("hidden") ||
          !document.getElementById("dlg-back").classList.contains("hidden")) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((e.ctrlKey || e.metaKey) && (k === "y" || (k === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
      else if (k === "f" && !e.ctrlKey && !e.metaKey) Viewport.fit();
      else if (k === "m" && !e.ctrlKey && !e.metaKey) toggleMeasure();
      else if (k === "escape" && measureMode) toggleMeasure();
      else if ((k === "delete" || k === "backspace") && selected) { e.preventDefault(); del(selected); selected = null; }
      else if (k === "h" && e.shiftKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); status(Viewport.toggleSketches() ? "Sketches shown" : "Sketches hidden"); }
      else if (k === "p" && !e.ctrlKey && !e.metaKey && !e.shiftKey) { e.preventDefault(); status(Viewport.toggleDatums() ? "Planes shown" : "Planes hidden"); }
      else if (k >= "1" && k <= "7" && !e.ctrlKey && !e.metaKey) Viewport.setView(["front", "back", "top", "bottom", "right", "left", "iso"][+k - 1]);
    });
    refresh({ fit: true });
    status("Ready — import a .py or click Sketch");
  }

  return {
    init, addOp, startSketch, editFeature, selectBody, selectFeature, ctx, toggleSuppress,
    submitDialog, closeDialog, sk: Sketcher, sk3d: Sketch3D, pickImport, export: exp,
    toggleCode, refreshCode, runCode, copyCode, reset, undo, redo, toggleTheme, toast,
    toggleBody, bodyCtx, toggleMeasure, toggleSection, updateSection, cycleDisplay, startHole,
    api, applyPreview, refresh, labelFor, selectedBody, updateSelectionMarks, status, busy, ensureEdges, updateHoverMode,
  };
})();
window.addEventListener("DOMContentLoaded", App.init);
