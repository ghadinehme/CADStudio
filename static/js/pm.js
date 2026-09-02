/* Studio CAD — PropertyManager.
   A SolidWorks/Onshape-style panel docked top-left. Feature inputs are
   "selection boxes" you activate then click geometry (sketch in the tree, a
   body, an edge or face in the viewport) — plus numeric/toggle fields — with a
   live preview of the result. Green check commits, red X cancels. */
const PM = (() => {
  // ---- feature definitions ------------------------------------------- //
  // field.kind: ref (single) | refmulti | num | toggle | chk
  // field.filter (for ref/refmulti): sketch | body | edge | face
  const F = {
    extrude: {
      title: "Extrude", icon: "expand", fields: [
        { key: "sketch", kind: "ref", filter: "sketch", label: "Sketch", required: true },
        { key: "distance", kind: "num", label: "Distance", def: 10 },
        { key: "direction", kind: "toggle", label: "Direction", def: "normal", options: [["normal", "Up"], ["symmetric", "Both"], ["reverse", "Down"]] },
        { key: "operation", kind: "toggle", label: "Result", def: "new", options: [["new", "New body"], ["add", "Add"], ["cut", "Cut"], ["intersect", "Intersect"]] },
        { key: "target", kind: "ref", filter: "body", label: "Merge into", showIf: v => v.operation !== "new" },
      ],
    },
    revolve: {
      title: "Revolve", icon: "cyclone", fields: [
        { key: "sketch", kind: "ref", filter: "sketch", label: "Profile", required: true },
        { key: "axis", kind: "ref", filter: ["edge", "sketch"], label: "Axis (click an edge or a sketched line)",
          assemble: (v, p) => { if (!v) return; if (v.kind === "edge") p.axis_edge = v.value.point; else p.axis_sketch = v.value; } },
        { key: "angle", kind: "num", label: "Angle (°)", def: 360 },
        { key: "operation", kind: "toggle", label: "Result", def: "new", options: [["new", "New body"], ["add", "Add"], ["cut", "Cut"], ["intersect", "Intersect"]] },
        { key: "target", kind: "ref", filter: "body", label: "Merge into", showIf: v => v.operation !== "new" },
      ],
    },
    fillet: {
      title: "Fillet", icon: "rounded_corner", fields: [
        { key: "target", kind: "ref", filter: "body", label: "Body", required: true },
        { key: "edges", kind: "refmulti", filter: "edge", label: "Edges (none = all edges)" },
        { key: "radius", kind: "num", label: "Radius", def: 2 },
      ],
    },
    chamfer: {
      title: "Chamfer", icon: "cut", fields: [
        { key: "target", kind: "ref", filter: "body", label: "Body", required: true },
        { key: "edges", kind: "refmulti", filter: "edge", label: "Edges (none = all edges)" },
        { key: "distance", kind: "num", label: "Distance", def: 1 },
      ],
    },
    shell: {
      title: "Shell", icon: "inventory_2", fields: [
        { key: "target", kind: "ref", filter: "body", label: "Body", required: true },
        { key: "faces", kind: "refmulti", filter: "face", label: "Faces to remove (open)" },
        { key: "thickness", kind: "num", label: "Thickness", def: 1 },
      ],
    },
    mirror: {
      title: "Mirror", icon: "flip", fields: [
        { key: "target", kind: "ref", filter: "body", label: "Body", required: true },
        { key: "plane", kind: "toggle", label: "Mirror plane", def: "XZ", options: [["XY", "XY"], ["XZ", "XZ"], ["YZ", "YZ"]] },
        { key: "merge", kind: "chk", label: "Merge with original" },
      ],
    },
    linear_pattern: {
      title: "Linear Pattern", icon: "view_column", fields: [
        { key: "target", kind: "ref", filter: "body", label: "Body", required: true },
        { key: "__dir", kind: "toggle", label: "Direction", def: "x", options: [["x", "X"], ["y", "Y"], ["z", "Z"]] },
        { key: "count", kind: "num", label: "Count", def: 3 },
        { key: "spacing", kind: "num", label: "Spacing", def: 15 },
      ],
    },
    circular_pattern: {
      title: "Circular Pattern", icon: "data_usage", fields: [
        { key: "target", kind: "ref", filter: "body", label: "Body", required: true },
        { key: "__caxis", kind: "toggle", label: "Axis direction", def: "z", options: [["z", "Z"], ["x", "X"], ["y", "Y"]] },
        { key: "__cx", kind: "num", label: "Axis through X", def: 0 },
        { key: "__cy", kind: "num", label: "Axis through Y", def: 0 },
        { key: "__cz", kind: "num", label: "Axis through Z", def: 0 },
        { key: "count", kind: "num", label: "Count", def: 6 },
        { key: "angle", kind: "num", label: "Total angle (°)", def: 360 },
      ],
    },
    boolean: {
      title: "Boolean", icon: "join_inner", fields: [
        { key: "operation", kind: "toggle", label: "Operation", def: "union", options: [["union", "Union"], ["cut", "Cut"], ["intersect", "Intersect"]] },
        { key: "target", kind: "ref", filter: "body", label: "Target (kept)", required: true },
        { key: "tools", kind: "refmulti", filter: "body", label: "Tool bodies" },
      ],
    },
    datum_plane: {
      title: "Datum Plane", icon: "layers",
      // A plane created from a base is edited as base + offset. A plane that
      // carries an explicit origin/normal (e.g. imported from a .py) is edited
      // as an origin you can move plus an offset along its own normal.
      seed: (p, v) => {
        const custom = !!(p && p.origin && p.normal);
        v.__custom = custom;
        if (custom) { v.__ox = p.origin[0]; v.__oy = p.origin[1]; v.__oz = p.origin[2]; if (!("offset" in p)) v.offset = 0; }
      },
      assemble: (v, p) => {
        if (v.__custom) { p.origin = [parseFloat(v.__ox) || 0, parseFloat(v.__oy) || 0, parseFloat(v.__oz) || 0]; delete p.base; }
        else { delete p.origin; delete p.normal; delete p.xdir; }
        ["__ox", "__oy", "__oz", "__custom"].forEach(k => delete p[k]);
      },
      fields: [
        { key: "base", kind: "toggle", label: "Base plane", def: "XY", options: [["XY", "XY"], ["XZ", "XZ"], ["YZ", "YZ"]], showIf: v => !v.__custom },
        { key: "__ox", kind: "num", label: "Origin X", def: 0, showIf: v => v.__custom },
        { key: "__oy", kind: "num", label: "Origin Y", def: 0, showIf: v => v.__custom },
        { key: "__oz", kind: "num", label: "Origin Z", def: 0, showIf: v => v.__custom },
        { key: "offset", kind: "num", label: "Offset along normal", def: 10 },
      ],
    },
    hole: {
      title: "Hole", icon: "circle", fields: [
        { key: "diameter", kind: "num", label: "Diameter", def: 5 },
        { key: "through", kind: "chk", label: "Through all" },
        { key: "depth", kind: "num", label: "Depth (if blind)", def: 10 },
        { key: "counterbore", kind: "chk", label: "Counterbore" },
        { key: "cbore_diameter", kind: "num", label: "C'bore diameter", def: 10 },
        { key: "cbore_depth", kind: "num", label: "C'bore depth", def: 4 },
      ],
    },
  };
  const AXES = { x: [[0, 0, 0], [1, 0, 0]], y: [[0, 0, 0], [0, 1, 0]], z: [[0, 0, 0], [0, 0, 1]] };

  let type = null, spec = null, feature = null, prefill = null, onApply = null;
  let values = {}, active = null, pvTimer = null, open_ = false, pvState = null;

  function open(featureType, opts = {}) {
    type = featureType; spec = F[featureType]; if (!spec) return;
    feature = opts.feature || null; prefill = opts.prefill || null; onApply = opts.onApply;
    values = {}; pvState = null;
    for (const f of spec.fields) {
      if (f.kind === "refmulti") values[f.key] = { items: [], allBody: null };
      else if (feature && feature.params && f.key in feature.params) values[f.key] = feature.params[f.key];
      else if (f.kind === "num" || f.kind === "toggle") values[f.key] = f.def;
      else if (f.kind === "chk") values[f.key] = !!(feature && feature.params && feature.params[f.key]);
      else values[f.key] = null;
    }
    // sensible default body for body-targeting features
    if (!feature) {
      const def = App.selectedBody();
      for (const f of spec.fields) if (f.kind === "ref" && f.filter === "body" && f.key === "target" && def && values[f.key] == null) values[f.key] = def;
    }
    if (feature) restoreFromFeature();
    if (spec.seed) spec.seed(feature ? (feature.params || {}) : null, values);   // spec-specific value seeding
    if (spec.fields.some(f => f.filter === "edge") && App.ensureEdges) App.ensureEdges();  // so edges are pickable
    active = firstEmptyRef();
    open_ = true;
    document.getElementById("pm").classList.remove("hidden");
    render();
    preview();
  }
  function restoreFromFeature() {
    const p = feature.params || {};
    // refmulti edges/faces stored as points / "all"
    for (const f of spec.fields) {
      if (f.kind === "refmulti" && f.filter === "edge") {
        if (p.edges === "all") values[f.key] = { items: [], allBody: p.target || null };
        else if (Array.isArray(p.edges)) values[f.key] = { items: p.edges.map(pt => ({ point: pt, body: p.target })), allBody: null };
      } else if (f.kind === "refmulti" && f.filter === "face") {
        if (Array.isArray(p.faces)) values[f.key] = { items: p.faces.map(pt => ({ point: pt })), allBody: p.target };
      } else if (f.kind === "refmulti" && f.filter === "body" && Array.isArray(p[f.key])) {
        values[f.key] = { items: p[f.key].map(id => ({ id })), allBody: null };
      }
      if (f.key === "__dir" && p.dir) values[f.key] = letterFromVec(p.dir) || f.def;
      if (f.key === "__caxis" && p.axis_end) {
        const s = p.axis_start || [0, 0, 0];
        values[f.key] = letterFromVec([p.axis_end[0] - s[0], p.axis_end[1] - s[1], p.axis_end[2] - s[2]]) || f.def;
      }
      if (f.key === "__cx" && p.axis_start) values[f.key] = p.axis_start[0];
      if (f.key === "__cy" && p.axis_start) values[f.key] = p.axis_start[1];
      if (f.key === "__cz" && p.axis_start) values[f.key] = p.axis_start[2];
      if (f.key === "axis") {
        if (p.axis_edge) values.axis = { kind: "edge", value: { point: p.axis_edge } };
        else if (p.axis_sketch) values.axis = { kind: "sketch", value: p.axis_sketch };
      }
    }
  }
  function letterFromVec(v) { for (const k of ["x", "y", "z"]) if (v && Math.abs(v[0] - AXES[k][1][0]) < 1e-6 && Math.abs(v[1] - AXES[k][1][1]) < 1e-6 && Math.abs(v[2] - AXES[k][1][2]) < 1e-6) return k; return null; }
  function firstEmptyRef() {
    for (const f of spec.fields) if ((f.kind === "ref" || f.kind === "refmulti") && visible(f) && refEmpty(f)) return f.key;
    return null;
  }
  function refEmpty(f) { const v = values[f.key]; return f.kind === "refmulti" ? (!v || (!v.items.length && !v.allBody)) : (v == null || v === ""); }
  function visible(f) { return !f.showIf || f.showIf(values); }

  function close() { open_ = false; active = null; clearTimeout(pvTimer); document.getElementById("pm").classList.add("hidden"); Viewport.clearSelectionMarks(); Viewport.clearHover(); }

  // ---- selection from app -------------------------------------------- //
  function activeFilter() { if (!open_ || !active) return null; const f = spec.fields.find(x => x.key === active); return f ? f.filter : null; }
  function isOpen() { return open_; }
  // value: for sketch/body -> id; for edge -> {point, body}; for face -> {point, body}
  function select(kind, value) {
    if (!open_ || !active) return false;
    const f = spec.fields.find(x => x.key === active);
    if (!f) return false;
    const inFilter = Array.isArray(f.filter) ? f.filter.includes(kind) : f.filter === kind;
    // an edge box also accepts a body click (from the list) = "all edges of it"
    const accepts = inFilter || (f.kind === "refmulti" && f.filter === "edge" && kind === "body");
    if (!accepts) return false;
    if (f.kind === "refmulti") {
      if (kind === "body" && f.filter === "edge") { values[f.key].allBody = value; values[f.key].items = []; }
      else if (kind === "body") {                       // body multi (boolean tools): toggle, exclude target
        if (value === values.target) return false;
        const arr = values[f.key].items, i = arr.findIndex(x => x.id === value);
        if (i >= 0) arr.splice(i, 1); else arr.push({ id: value });
      } else if (kind === "edge") { values[f.key].items.push({ point: value.point, body: value.body }); values[f.key].allBody = null; }
      else if (kind === "face") { values[f.key].items.push({ point: value.point, body: value.body }); }
      // refmulti stays active to keep picking
    } else {
      values[f.key] = Array.isArray(f.filter) ? { kind, value } : value;
      active = firstEmptyRef();   // single ref: advance to next empty box
    }
    render(); preview();
    return true;
  }
  function clearBox(key) {
    const f = spec.fields.find(x => x.key === key);
    if (f.kind === "refmulti") values[key] = { items: [], allBody: null }; else values[key] = null;
    render(); preview();
  }

  // ---- params assembly ----------------------------------------------- //
  function getParams() {
    // On edit, seed from the existing params so fields the panel doesn't expose
    // (hole placement, a revolve's explicit axis, etc.) are never dropped.
    const p = Object.assign({}, (feature && feature.params) || {}, prefill || {});
    for (const f of spec.fields) {
      if (!visible(f)) continue;
      const v = values[f.key];
      // "__"-prefixed fields are virtual UI controls assembled into real params
      // (e.g. __caxis/__cx → axis_start/axis_end); never persist them verbatim.
      if (f.key.startsWith("__") && f.kind !== "toggle") continue;
      if (f.kind === "num") p[f.key] = parseFloat(v) || 0;
      else if (f.kind === "chk") p[f.key] = !!v;
      else if (f.kind === "toggle") {
        if (f.key === "__dir") p.dir = AXES[v][1];
        else if (f.key === "__caxis") {
          const dir = AXES[v][1];
          const o = [parseFloat(values.__cx) || 0, parseFloat(values.__cy) || 0, parseFloat(values.__cz) || 0];
          p.axis_start = o;
          p.axis_end = [o[0] + dir[0], o[1] + dir[1], o[2] + dir[2]];   // axis through O, along the chosen direction
        } else p[f.key] = v;
      } else if (f.kind === "ref") { if (f.assemble) f.assemble(v, p); else if (v != null) p[f.key] = v; }
      else if (f.kind === "refmulti") {
        if (f.filter === "edge") {
          if (v.allBody) { p.edges = "all"; p.target = v.allBody; }
          else if (v.items.length) { p.edges = v.items.map(x => x.point); p.target = v.items[0].body || p.target; }
        } else if (f.filter === "face") {
          if (v.items.length) { p.faces = v.items.map(x => x.point); p.target = v.items[0].body || p.target; }
        } else if (f.filter === "body") {
          p[f.key] = v.items.map(x => x.id);
        }
      }
    }
    if (spec.assemble) spec.assemble(values, p);   // spec-specific param assembly
    return p;
  }
  function ready() {
    for (const f of spec.fields) if (f.required && visible(f) && refEmpty(f)) return false;
    return true;
  }

  // ---- preview / apply ----------------------------------------------- //
  function preview() {
    clearTimeout(pvTimer);
    pvTimer = setTimeout(async () => {
      if (!open_) return;
      if (!ready()) {                              // not enough selected yet -> show real model
        if (pvState !== "real") { pvState = "real"; App.refresh(); }
        return;
      }
      pvState = "preview";
      const params = getParams();
      const body = feature ? { edit_id: feature.id, params } : { feature: { type, params } };
      const d = await App.api("POST", "/api/preview", body);
      if (open_ && d.ok) App.applyPreview(d.scene);
    }, 110);
  }
  async function apply() {
    if (!ready()) { App.toast("Select the required references", "err"); return; }
    const params = getParams();
    const fn = onApply; close();
    await fn(params);
  }
  function cancel() { close(); App.refresh(); App.status("Ready"); }

  // ---- render --------------------------------------------------------- //
  function render() {
    if (active) { const af = spec.fields.find(x => x.key === active); if (!af || !visible(af)) active = firstEmptyRef(); }
    if (!active) active = firstEmptyRef();   // auto-activate a newly revealed empty ref
    document.getElementById("pm-title").innerHTML = `<span class="material-icons-outlined">${spec.icon || "tune"}</span> ${feature ? "Edit " : ""}${spec.title}`;
    const host = document.getElementById("pm-body");
    host.innerHTML = spec.fields.filter(visible).map(fieldHtml).join("");
    host.querySelectorAll("[data-act]").forEach(el => {
      const k = el.dataset.act;
      if (el.dataset.kind === "num") el.oninput = () => { values[k] = el.value; preview(); };
      else if (el.dataset.kind === "chk") el.onchange = () => { values[k] = el.checked; render(); preview(); };
    });
    host.querySelectorAll("[data-toggle]").forEach(el => el.onclick = () => { values[el.dataset.toggle] = el.dataset.val; render(); preview(); });
    host.querySelectorAll("[data-box]").forEach(el => el.onclick = (e) => { if (e.target.closest("[data-clear]")) return; active = el.dataset.box; render(); App.status("Click " + filterHint(el.dataset.box)); });
    host.querySelectorAll("[data-clear]").forEach(el => el.onclick = (e) => { e.stopPropagation(); clearBox(el.dataset.clear); });
    document.getElementById("pm-ok").classList.toggle("disabled", !ready());
    App.updateSelectionMarks();
  }
  function filterHint(key) { const f = spec.fields.find(x => x.key === key); const flt = Array.isArray(f.filter) ? f.filter[0] : f.filter; return { sketch: "a sketch in the tree", body: "a body", edge: "an edge in the 3D view", face: "a face in the 3D view" }[flt] || "a reference"; }
  function fieldHtml(f) {
    if (f.kind === "num") return `<div class="pm-f"><label>${f.label}</label><input type="number" step="any" data-act="${f.key}" data-kind="num" value="${values[f.key] ?? f.def ?? 0}"></div>`;
    if (f.kind === "chk") return `<div class="pm-f pm-chk"><label><input type="checkbox" data-act="${f.key}" data-kind="chk" ${values[f.key] ? "checked" : ""}> ${f.label}</label></div>`;
    if (f.kind === "toggle") return `<div class="pm-f"><label>${f.label}</label><div class="pm-toggle">${f.options.map(o => `<button class="${values[f.key] === o[0] ? "on" : ""}" data-toggle="${f.key}" data-val="${o[0]}">${o[1]}</button>`).join("")}</div></div>`;
    // ref / refmulti -> selection box
    const act = active === f.key;
    const chips = boxChips(f);
    return `<div class="pm-f"><label>${f.label}${f.required ? ' <span class="req">*</span>' : ""}</label>
      <div class="pm-box ${act ? "active" : ""} ${chips ? "" : "empty"}" data-box="${f.key}">
        ${chips || `<span class="ph">${act ? "Selecting… click " + filterHint(f.key) : "Click to select"}</span>`}
        ${chips ? `<span class="material-icons-outlined pm-x" data-clear="${f.key}">close</span>` : ""}
      </div></div>`;
  }
  function boxChips(f) {
    const v = values[f.key];
    if (f.kind === "ref") {
      if (v == null) return "";
      if (Array.isArray(f.filter)) return `<span class="chip">${v.kind === "edge" ? "Edge" : App.labelFor("sketch", v.value)}</span>`;
      return `<span class="chip">${App.labelFor(f.filter, v)}</span>`;
    }
    if (f.kind === "refmulti") {
      if (f.filter === "edge" && v.allBody) return `<span class="chip">All edges of ${App.labelFor("body", v.allBody)}</span>`;
      if (!v.items.length) return "";
      if (f.filter === "body") return v.items.map(x => `<span class="chip">${App.labelFor("body", x.id)}</span>`).join("");
      return `<span class="chip">${v.items.length} ${f.filter}${v.items.length > 1 ? "s" : ""}</span>`;
    }
    return "";
  }

  // expose selection marks for the viewport highlight
  function selectionMarks() {
    const marks = { edges: [], faces: [], bodies: [], sketches: [] };
    for (const f of spec.fields) {
      const v = values[f.key]; if (!v) continue;
      if (f.kind === "refmulti" && f.filter === "edge") { v.items.forEach(i => marks.edges.push(i.point)); if (v.allBody) marks.bodies.push(v.allBody); }
      else if (f.kind === "refmulti" && f.filter === "face") v.items.forEach(i => marks.faces.push(i.point));
      else if (f.kind === "ref" && f.filter === "body" && v) marks.bodies.push(v);
      else if (f.kind === "ref" && f.filter === "sketch" && v) marks.sketches.push(v);
      else if (f.kind === "ref" && Array.isArray(f.filter) && v) { if (v.kind === "edge" && v.value.point) marks.edges.push(v.value.point); else if (v.kind === "sketch") marks.sketches.push(v.value); }
      else if (f.kind === "refmulti" && f.filter === "body") v.items.forEach(i => marks.bodies.push(i.id));
    }
    return marks;
  }

  return { open, close, isOpen, activeFilter, select, apply, cancel, getParams, selectionMarks };
})();
