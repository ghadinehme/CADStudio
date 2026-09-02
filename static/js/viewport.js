/* Studio CAD — 3D viewport. Applies scene deltas: only bodies whose hash
   changed carry mesh data, so an edit rebuilds just those Three meshes. */
const Viewport = (() => {
  let scene, camera, renderer, controls, gridHelper, axes, raycaster, mouse;
  const bodyGroup = new THREE.Group();
  const wireGroup = new THREE.Group();
  const edgeGroup = new THREE.Group();
  const sketchOverlay = new THREE.Group();   // live sketch geometry (3D sketching)
  const pickGroup = new THREE.Group();        // plane-pick gizmos
  let bodies = {};          // id -> { hash, mesh, edges, name }
  let bodyPrefs = {};       // id -> { hidden, color } (persist across rebuilds)
  let clipPlanes = [];      // section view
  let displayMode = "edges"; // shaded | edges | wire
  const DEFAULT_BODY = 0xffa600;   // default solid colour (also offered as a swatch)
  const measureGroup = new THREE.Group();
  const selMarkGroup = new THREE.Group();   // PropertyManager selection markers
  const hoverGroup = new THREE.Group();     // pre-highlight under the cursor
  const datumGroup = new THREE.Group();     // datum planes shown as squares
  const inspectGroup = new THREE.Group();   // persistent inspect/select highlight
  let datumsVisible = false, _pickActive = false;   // datum planes hidden by default
  let _sketchHidden = false;   // bodies temporarily hidden while sketching
  let hoverMode = null;                     // null | edge | face | body
  let hovered = null;                       // current hovered entity
  let selected = null;
  let onPick = null;
  const PALETTE = [0x6aa9ff, 0x7bd88f, 0xf0a868, 0xc792ea, 0xf07178, 0x5fd7d7, 0xe6c07b, 0x82aaff];

  function init(canvas) {
    scene = new THREE.Scene();
    const w = canvas.clientWidth, h = canvas.clientHeight;
    camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 100000);
    camera.up.set(0, 0, 1);
    camera.position.set(35, -45, 30);
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setSize(w, h, false);
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.12;
    controls.rotateSpeed = 0.9; controls.zoomSpeed = 1.1;
    // Normal viewing uses a custom continuous arcball (below) instead of the
    // OrbitControls turntable, which locks at the top/bottom poles. OrbitControls
    // still drives pan (right) + zoom (wheel) + damping. Sketch mode re-enables
    // OrbitControls rotation (it wants a plane-locked turntable).
    controls.enableRotate = false;

    scene.add(new THREE.AmbientLight(0xffffff, 0.62));
    const key = new THREE.DirectionalLight(0xffffff, 0.85); key.position.set(1, -1, 2); scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.35); fill.position.set(-2, 1, -1); scene.add(fill);

    gridHelper = new THREE.GridHelper(200, 40, 0x3a4250, 0x232a33);
    gridHelper.rotation.x = Math.PI / 2; scene.add(gridHelper);
    axes = new THREE.AxesHelper(8); scene.add(axes);
    scene.add(bodyGroup); scene.add(wireGroup); scene.add(edgeGroup);
    scene.add(sketchOverlay); scene.add(pickGroup); scene.add(measureGroup); scene.add(selMarkGroup); scene.add(hoverGroup); scene.add(datumGroup); scene.add(inspectGroup);
    // Default to a clean view: grid, axes, sketch wires and datum planes all start
    // hidden (toggle with the toolbar or G/Shift+H/P · axes button).
    gridHelper.visible = false; axes.visible = false; wireGroup.visible = false; datumGroup.visible = false;
    renderer.localClippingEnabled = true;
    renderer.domElement.addEventListener("pointermove", _hover);

    raycaster = new THREE.Raycaster(); mouse = new THREE.Vector2();
    renderer.domElement.addEventListener("pointerdown", _down);
    renderer.domElement.addEventListener("pointerdown", _arcDown);
    window.addEventListener("pointermove", _arcMove);
    window.addEventListener("pointerup", _arcUp);
    window.addEventListener("resize", onResize);
    initNavCube(document.getElementById("navcube-canvas"));
    setTheme();
    animate();
  }

  let downXY = null;
  function _down(e) { downXY = [e.clientX, e.clientY]; }
  function _click(e) {
    if (!onPick) return;
    const r = renderer.domElement.getBoundingClientRect();
    mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const hit = raycaster.intersectObjects(bodyGroup.children, true)[0];
    onPick(hit ? hit.object.userData.bid : null, hit, e);
  }
  function _edgeLines() {
    const lines = [];
    edgeGroup.children.forEach(eg => { if (!eg.visible) return; eg.children.forEach(l => { l.userData._bid = eg.userData.bid; lines.push(l); }); });
    return lines;
  }
  const _tmpV = new THREE.Vector3();
  const _auxRay = new THREE.Raycaster();   // occlusion tests for vertex picking
  function _projDist(worldPt) {            // screen-space distance from cursor to a world point
    _tmpV.copy(worldPt).project(camera);
    return Math.hypot(_tmpV.x - mouse.x, _tmpV.y - mouse.y);
  }
  // The visible edge nearest the cursor: among candidates within the ray
  // threshold, drop ones hidden behind the solid, then take the one whose
  // intersection projects closest to the cursor on screen. (raycaster must
  // already be set from the camera + current mouse NDC.)
  function _bestEdgeHit() {
    raycaster.params.Line = raycaster.params.Line || {};
    raycaster.params.Line.threshold = Math.max(0.05, _modelSize() * 0.02);
    const hits = raycaster.intersectObjects(_edgeLines(), false);
    if (!hits.length) return null;
    const fh = raycaster.intersectObjects(bodyGroup.children, true)[0];
    const faceDepth = fh ? fh.distance : Infinity;
    const tol = Math.max(0.1, _modelSize() * 0.02);
    let best = null, bestD = Infinity;
    for (const h of hits) {
      if (h.distance > faceDepth + tol) continue;     // edge is behind the front face -> hidden
      const d = _projDist(h.point);
      if (d < bestD) { bestD = d; best = h; }
    }
    return best;
  }
  // Pick the visible edge nearest a screen point -> {point, body, object} or null.
  function pickEdgeAt(cx, cy) {
    _ndc(cx, cy);
    raycaster.setFromCamera(mouse, camera);
    const hit = _bestEdgeHit();
    if (!hit) return null;
    return { point: [hit.point.x, hit.point.y, hit.point.z], body: hit.object.userData._bid };
  }

  // ---- hover pre-highlight (CAD-style) -------------------------------- //
  function setHoverMode(mode) { if (mode !== hoverMode) { hoverMode = mode; _clearHover(); hovered = null; if (!mode) renderer.domElement.style.cursor = ""; } }
  function hoverInfo() { return hovered; }
  function clearHover() { hoverMode = null; hovered = null; _clearHover(); }
  function _clearHover() { while (hoverGroup.children.length) { const o = hoverGroup.children.pop(); if (o.geometry && !o.userData.shared) o.geometry.dispose(); if (o.material) o.material.dispose(); } }
  function _hover(e) {
    if (!hoverMode) { if (hovered) { hovered = null; _clearHover(); } return; }
    _ndc(e.clientX, e.clientY); raycaster.setFromCamera(mouse, camera);
    _clearHover();
    if (hoverMode === "edge") {
      const hit = _bestEdgeHit();
      if (hit) { _hlEdge(hit.object); hovered = { point: [hit.point.x, hit.point.y, hit.point.z], body: hit.object.userData._bid }; } else hovered = null;
    } else if (hoverMode === "face") {
      const hit = raycaster.intersectObjects(bodyGroup.children, true)[0];
      if (hit && hit.faceIndex != null) { _hlFace(hit.object, hit.faceIndex); hovered = { point: [hit.point.x, hit.point.y, hit.point.z], body: hit.object.userData.bid }; } else hovered = null;
    } else if (hoverMode === "body") {
      const hit = raycaster.intersectObjects(bodyGroup.children, true)[0];
      if (hit) { _hlBody(hit.object); hovered = hit.object.userData.bid; } else hovered = null;
    } else if (hoverMode === "inspect") {
      const p = _inspectPick();
      if (p) { _drawInspectHi(p, hoverGroup, 0xffd166); hovered = p; } else hovered = null;
    }
    renderer.domElement.style.cursor = hovered ? "pointer" : "";
  }

  // ---- general inspect / select (edges, faces, vertices) -------------- //
  // Under the cursor pick, CAD-style, the most specific *visible* thing: a vertex
  // if the cursor is right on one, else an edge only if the cursor is within a few
  // pixels of it, else the front face. Screen-pixel gates keep the face pickable in
  // the interior instead of edges winning everywhere on an edge-dense model.
  function _inspectPick() {
    const px = n => n / (renderer.domElement.clientHeight || 1) * 2;   // px → NDC
    const mkEdge = eh => ({ kind: "edge", point: [eh.point.x, eh.point.y, eh.point.z], body: eh.object.userData._bid, object: eh.object });
    const vx = _vertexAt();
    if (vx) return vx;
    const eh = _bestEdgeHit();                       // already occlusion-filtered (front only)
    const near = eh ? _projDist(eh.point) : Infinity;
    if (eh && near <= px(7)) return mkEdge(eh);       // cursor right on an edge → edge
    const fh = raycaster.intersectObjects(bodyGroup.children, true)[0];
    if (fh && fh.faceIndex != null) return { kind: "face", point: [fh.point.x, fh.point.y, fh.point.z], body: fh.object.userData.bid, object: fh.object, faceIndex: fh.faceIndex };
    if (eh && near <= px(12)) return mkEdge(eh);      // over empty space near a silhouette edge
    return null;
  }
  // Nearest edge endpoint to the cursor (within ~12px) that is NOT hidden behind
  // the solid — the topmost visible vertex from the mouse's point of view.
  function _vertexAt() {
    const thr = 9 / renderer.domElement.clientHeight * 2;   // px → NDC (y span is 2)
    const cands = [];
    for (const line of _edgeLines()) {
      const pos = line.geometry.attributes.position; if (!pos) continue;
      for (const i of [0, pos.count - 1]) {
        _tmpV.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(line.matrixWorld);
        const wp = _tmpV.clone(); _tmpV.project(camera);
        const d = Math.hypot(_tmpV.x - mouse.x, _tmpV.y - mouse.y);
        if (d < thr) cands.push({ d, wp, bid: line.userData._bid });
      }
    }
    if (!cands.length) return null;
    cands.sort((a, b) => a.d - b.d);
    const tol = Math.max(0.05, _modelSize() * 0.01);
    for (const c of cands) {   // pick the nearest one that isn't occluded by a nearer face
      _tmpV.copy(c.wp).project(camera);
      _auxRay.setFromCamera(_tmpV, camera);
      const fh = _auxRay.intersectObjects(bodyGroup.children, true)[0];
      if (!fh || camera.position.distanceTo(c.wp) <= fh.distance + tol)
        return { kind: "vertex", point: [c.wp.x, c.wp.y, c.wp.z], body: c.bid };
    }
    return null;
  }
  function _drawInspectHi(hit, group, color) {
    if (hit.kind === "vertex") {
      const p = new THREE.Vector3(hit.point[0], hit.point[1], hit.point[2]);
      const r = worldPerPixel(p) * 4.5;   // ~4.5px on screen, constant regardless of zoom
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 14), new THREE.MeshBasicMaterial({ color, depthTest: false }));
      m.position.copy(p); m.renderOrder = 1000; group.add(m);
    } else if (hit.kind === "edge") {
      const l = new THREE.Line(hit.object.geometry.clone(), new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true }));
      l.applyMatrix4(hit.object.matrixWorld); l.renderOrder = 999; group.add(l);
    } else if (hit.kind === "face") {
      _hlFace(hit.object, hit.faceIndex, group, color);
    }
  }
  // Length of a tessellated edge (sum of its polyline segments).
  function _edgeLength(line) {
    const pos = line.geometry.attributes.position; if (!pos || pos.count < 2) return 0;
    let L = 0; const a = new THREE.Vector3(), b = new THREE.Vector3();
    a.set(pos.getX(0), pos.getY(0), pos.getZ(0)).applyMatrix4(line.matrixWorld);
    for (let i = 1; i < pos.count; i++) { b.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(line.matrixWorld); L += a.distanceTo(b); a.copy(b); }
    return L;
  }
  // Area of a picked face (sum of its triangle areas).
  function _faceArea(mesh, faceIndex) {
    const grp = _faceGroupOf(mesh, faceIndex); if (!grp) return 0;
    const idx = mesh.geometry.index, pos = mesh.geometry.attributes.position;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), ab = new THREE.Vector3(), ac = new THREE.Vector3();
    let A = 0;
    for (const t of grp) {
      a.fromBufferAttribute(pos, idx.getX(3 * t)).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(pos, idx.getX(3 * t + 1)).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(pos, idx.getX(3 * t + 2)).applyMatrix4(mesh.matrixWorld);
      A += ab.subVectors(b, a).cross(ac.subVectors(c, a)).length() * 0.5;
    }
    return A;
  }
  // Commit the current inspect hover as a persistent selection; returns readout
  // info { kind, body, length? , area?, point } or null when nothing is hovered.
  function inspectCommit() {
    while (inspectGroup.children.length) { const o = inspectGroup.children.pop(); if (o.geometry && !o.userData.shared) o.geometry.dispose(); if (o.material) o.material.dispose(); }
    if (!hovered || !hovered.kind) return null;
    _drawInspectHi(hovered, inspectGroup, 0xff8c42);
    const info = { kind: hovered.kind, body: hovered.body, point: hovered.point };
    if (hovered.kind === "edge" && hovered.object) info.length = _edgeLength(hovered.object);
    if (hovered.kind === "face" && hovered.object) info.area = _faceArea(hovered.object, hovered.faceIndex);
    return info;
  }
  function clearInspect() { while (inspectGroup.children.length) { const o = inspectGroup.children.pop(); if (o.geometry && !o.userData.shared) o.geometry.dispose(); if (o.material) o.material.dispose(); } }
  function _hlEdge(line) {
    const l = new THREE.Line(line.geometry.clone(), new THREE.LineBasicMaterial({ color: 0xffd166, depthTest: false, transparent: true }));
    l.renderOrder = 999; hoverGroup.add(l);
  }
  function _faceGroupOf(mesh, faceIndex) {
    const fg = mesh.userData.faceGroups; if (!fg) return null;
    if (!mesh.userData.triToFace) { const map = {}; fg.forEach((grp, fi) => grp.forEach(t => { map[t] = fi; })); mesh.userData.triToFace = map; }
    const fi = mesh.userData.triToFace[faceIndex];
    return fi != null ? fg[fi] : null;
  }
  function _hlFace(mesh, faceIndex, group, color) {
    const grp = _faceGroupOf(mesh, faceIndex); if (!grp) return;
    const idx = mesh.geometry.index, pos = mesh.geometry.attributes.position, verts = [];
    for (const t of grp) for (let k = 0; k < 3; k++) { const vi = idx.getX(3 * t + k); verts.push(pos.getX(vi), pos.getY(vi), pos.getZ(vi)); }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: color || 0x60a5fa, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthTest: false, depthWrite: false, clippingPlanes: clipPlanes }));
    m.applyMatrix4(mesh.matrixWorld); m.renderOrder = 998; (group || hoverGroup).add(m);
  }
  function _hlBody(mesh) {
    const m = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({ color: 0x60a5fa, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false, clippingPlanes: clipPlanes }));
    m.userData.shared = true;   // geometry belongs to the body — don't dispose it
    m.renderOrder = 997; hoverGroup.add(m);
  }
  // ---- selection markers (PropertyManager) ---------------------------- //
  function clearSelectionMarks() {
    while (selMarkGroup.children.length) { const o = selMarkGroup.children.pop(); o.geometry.dispose(); o.material.dispose(); }
    for (const id in bodies) { if (bodies[id].mesh) { bodies[id].mesh.material.emissive = new THREE.Color(0x000000); bodies[id].mesh.material.emissiveIntensity = 0; } }
  }
  function showSelectionMarks(marks) {
    clearSelectionMarks();
    const r = _handleR() * 1.5;
    (marks.edges || []).forEach(p => _selMark(p, r, 0x60a5fa));
    (marks.faces || []).forEach(p => _selMark(p, r, 0x34d399));
    const set = new Set(marks.bodies || []);
    for (const id in bodies) { const m = bodies[id].mesh; if (!m) continue; const on = set.has(id); m.material.emissive = new THREE.Color(on ? 0x1c3a26 : 0x000000); m.material.emissiveIntensity = on ? 0.7 : 0; }
  }
  function _selMark(p, r, color) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 12), new THREE.MeshBasicMaterial({ color, depthTest: false }));
    m.position.set(p[0], p[1], p[2]); m.renderOrder = 999; selMarkGroup.add(m);
  }

  function animate() {
    requestAnimationFrame(animate);
    if (camAnim) _stepCamAnim(); else if (!_arcball) controls.update();
    _renderNavCube();
    renderer.render(scene, camera);
  }

  // ---- continuous arcball rotation (normal viewing) ------------------- //
  // A free tumble around the orbit target with no pole clamp, so rotation never
  // blocks at top/bottom. Yaw spins about the current up axis, pitch about the
  // camera's right axis — so dragging straight up rolls smoothly over the top.
  let _arcball = null, _arcballOn = true;
  function _arcDown(e) { if (_arcballOn && e.button === 0) _arcball = { x: e.clientX, y: e.clientY }; }
  function _arcMove(e) {
    if (!_arcball) return;
    const dx = e.clientX - _arcball.x, dy = e.clientY - _arcball.y;
    if (!dx && !dy) return;
    _arcball.x = e.clientX; _arcball.y = e.clientY;
    _tumble(dx, dy);
  }
  function _arcUp() { if (_arcball) { _arcball = null; controls.update(); } }   // resync OrbitControls state
  function _tumble(dx, dy) {
    const speed = (2 * Math.PI) / (renderer.domElement.clientHeight || 800);   // ~full turn per viewport-height drag
    const offset = camera.position.clone().sub(controls.target);
    const up = camera.up.clone().normalize();
    const forward = offset.clone().multiplyScalar(-1).normalize();
    let right = new THREE.Vector3().crossVectors(forward, up);
    right = right.lengthSq() < 1e-9 ? new THREE.Vector3(1, 0, 0) : right.normalize();
    const q = new THREE.Quaternion().setFromAxisAngle(up, -dx * speed)
      .multiply(new THREE.Quaternion().setFromAxisAngle(right, -dy * speed));
    offset.applyQuaternion(q); up.applyQuaternion(q);
    camera.position.copy(controls.target).add(offset);
    camera.up.copy(up.normalize());
    camera.lookAt(controls.target);
  }

  // ---- smooth camera reorientation (used by the nav cube) ------------- //
  let camAnim = null;
  function _animateCamera(toPos, toUp, dur = 320) {
    camAnim = {
      fp: camera.position.clone(), tp: toPos.clone(),
      fu: camera.up.clone(), tu: toUp.clone(), tg: controls.target.clone(),
      t0: performance.now(), dur,
    };
  }
  function _stepCamAnim() {
    const a = camAnim;
    const k = Math.min(1, (performance.now() - a.t0) / a.dur);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;   // easeInOut
    camera.position.lerpVectors(a.fp, a.tp, e);
    camera.up.copy(a.fu).lerp(a.tu, e).normalize();
    camera.lookAt(a.tg);
    if (k >= 1) { camAnim = null; controls.update(); }
  }

  function onResize() {
    const c = renderer.domElement;
    const w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h; camera.updateProjectionMatrix();
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setSize(w, h, false);
  }

  function _buildMesh(b, idx) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(b.mesh.vertices), 3));
    if (b.mesh.faces && b.mesh.faces.length) g.setIndex(b.mesh.faces);
    g.computeVertexNormals();
    const pref = bodyPrefs[b.id] || {};
    // Default solid color matches the DaVinci visualiser CAD color (#ffa600).
    const color = pref.color || DEFAULT_BODY;
    const mat = new THREE.MeshStandardMaterial({ color, metalness: 0.1, roughness: 0.55, side: THREE.DoubleSide, clippingPlanes: clipPlanes, clipShadows: true, wireframe: displayMode === "wire" });
    const mesh = new THREE.Mesh(g, mat);
    mesh.visible = !_sketchHidden && pref.hidden !== true;
    mesh.userData.bid = b.id;
    mesh.userData.faceGroups = b.mesh.face_groups || null;   // for face hover/select
    // edges (inherit the body's hidden state + the section clip)
    const eg = new THREE.Group();
    eg.userData.bid = b.id;
    eg.visible = !_sketchHidden && pref.hidden !== true;
    if (b.mesh.edges) {
      const em = new THREE.LineBasicMaterial({ color: 0x0a0e14, transparent: true, opacity: 0.45, clippingPlanes: clipPlanes });
      for (const ep of b.mesh.edges) {
        if (ep.length < 6) continue;
        const pts = [];
        for (let i = 0; i < ep.length; i += 3) pts.push(new THREE.Vector3(ep[i], ep[i + 1], ep[i + 2]));
        eg.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), em));
      }
    }
    return { mesh, eg };
  }

  function _dispose(rec) {
    if (rec.mesh) { bodyGroup.remove(rec.mesh); rec.mesh.geometry.dispose(); rec.mesh.material.dispose(); }
    if (rec.eg) { edgeGroup.remove(rec.eg); rec.eg.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }
  }

  // Apply a scene delta. Returns the known-hash map for the next request.
  function applyScene(sc, opts = {}) {
    const seen = new Set();
    const list = sc.bodies || [];
    let missing = false;
    list.forEach((b, idx) => {
      seen.add(b.id);
      const cur = bodies[b.id];
      if (b.mesh) {                       // changed → rebuild this body only
        if (cur) _dispose(cur);
        const built = _buildMesh(b, idx);
        bodyGroup.add(built.mesh); edgeGroup.add(built.eg);
        bodies[b.id] = { hash: b.hash, name: b.name, mesh: built.mesh, eg: built.eg };
      } else if (cur) {                   // unchanged → keep, refresh hash/name
        cur.hash = b.hash; cur.name = b.name;
      } else {                            // server thinks we have it but we don't
        missing = true;
      }
    });
    for (const id of Object.keys(bodies)) {
      if (!seen.has(id)) { _dispose(bodies[id]); delete bodies[id]; }
    }
    _drawWires(sc.sketches || []);
    if ("datums" in sc) showDatums(sc.datums);   // persistent plane squares (and the live preview)
    if (selected) highlight(selected);
    _applyDisplay();
    if (opts.fit) fit();
    return { missing };   // caller can re-request a full scene if out of sync
  }
  function _applyDisplay() {
    edgeGroup.visible = displayMode === "edges";
    for (const k in bodies) bodies[k].mesh.material.wireframe = displayMode === "wire";
  }
  function setDisplayMode(mode) { displayMode = mode; _applyDisplay(); }
  function getDisplayMode() { return displayMode; }

  function _drawWires(sketches) {
    while (wireGroup.children.length) {
      const o = wireGroup.children.pop();
      o.geometry.dispose(); o.material.dispose(); wireGroup.remove(o);
    }
    const mat = new THREE.LineBasicMaterial({ color: 0xfbbf24 });
    for (const s of sketches) for (const w of s.wires) {
      if (w.length < 6) continue;
      const pts = [];
      for (let i = 0; i < w.length; i += 3) pts.push(new THREE.Vector3(w[i], w[i + 1], w[i + 2]));
      wireGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat.clone()));
    }
  }

  function getKnown() { const k = {}; for (const id in bodies) if (id !== "__preview__") k[id] = bodies[id].hash; return k; }

  // Frame the visible model WITHOUT changing the view direction: keep the
  // current camera orientation (and up) and just dolly along the view axis so
  // the whole model fills the viewport. Uses the bounding sphere so the fit is
  // rotation-invariant.
  function fit() {
    const box = new THREE.Box3();
    bodyGroup.children.forEach(m => { if (m.visible) box.expandByObject(m); });
    const dir = camera.position.clone().sub(controls.target);
    if (dir.lengthSq() < 1e-9) dir.set(0.7, -1, 0.7);   // degenerate → default iso axis
    dir.normalize();
    if (box.isEmpty()) {                                 // nothing to frame: keep orientation
      controls.target.set(0, 0, 0);
      camera.position.copy(dir.multiplyScalar(40));
      controls.update(); return;
    }
    const sph = box.getBoundingSphere(new THREE.Sphere());
    const r = sph.radius || 1;
    const vFov = camera.fov * Math.PI / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    const dist = Math.max(r / Math.sin(vFov / 2), r / Math.sin(hFov / 2)) * 1.08;   // pad slightly
    controls.target.copy(sph.center);
    camera.position.copy(sph.center).addScaledVector(dir, dist);
    controls.update();
  }

  function highlight(id) {
    selected = id;
    for (const bid in bodies) {
      const m = bodies[bid].mesh; if (!m) continue;
      m.material.emissive = new THREE.Color(bid === id ? 0x244 : 0x000000);
      m.material.emissiveIntensity = bid === id ? 0.6 : 0;
    }
  }

  function setTheme() {
    const light = document.documentElement.getAttribute("data-theme") === "light";
    renderer.setClearColor(light ? 0xeef1f5 : 0x0e1116, 1);
    const wasG = gridHelper.visible;
    scene.remove(gridHelper);
    if (gridHelper.geometry) gridHelper.geometry.dispose();
    (Array.isArray(gridHelper.material) ? gridHelper.material : [gridHelper.material]).forEach(m => m && m.dispose());
    gridHelper = new THREE.GridHelper(200, 40, light ? 0xc2ccd8 : 0x3a4250, light ? 0xdde3ea : 0x232a33);
    gridHelper.rotation.x = Math.PI / 2; gridHelper.visible = wasG; scene.add(gridHelper);
  }
  function toggleGrid() { gridHelper.visible = !gridHelper.visible; }
  function toggleAxes() { axes.visible = !axes.visible; }
  // Show / hide every sketch wire at once. The flag lives on the group, so it
  // persists across rebuilds (_drawWires only swaps the group's children).
  function toggleSketches() { wireGroup.visible = !wireGroup.visible; return wireGroup.visible; }
  function sketchesVisible() { return wireGroup.visible; }
  function cameraDir() { const d = new THREE.Vector3(); camera.getWorldDirection(d); return [d.x, d.y, d.z]; }

  // ---- plane / sketch infrastructure ---------------------------------- //
  function planeBasis(plane) {
    const O = new THREE.Vector3(plane.origin[0], plane.origin[1], plane.origin[2]);
    const N = new THREE.Vector3(plane.normal[0], plane.normal[1], plane.normal[2]).normalize();
    const X = new THREE.Vector3(plane.xdir[0], plane.xdir[1], plane.xdir[2]).normalize();
    const Y = new THREE.Vector3().crossVectors(N, X).normalize();   // matches CadQuery yDir = N×X
    return { O, X, Y, N };
  }
  function uvToWorld(plane, u, v) {
    const b = planeBasis(plane);
    return b.O.clone().addScaledVector(b.X, u).addScaledVector(b.Y, v);
  }
  function _ndc(cx, cy) {
    const r = renderer.domElement.getBoundingClientRect();
    mouse.x = ((cx - r.left) / r.width) * 2 - 1;
    mouse.y = -((cy - r.top) / r.height) * 2 + 1;
  }
  // Screen point -> (u,v) on the given plane, or null if the ray is parallel.
  function screenToPlane(plane, cx, cy) {
    _ndc(cx, cy); raycaster.setFromCamera(mouse, camera);
    const b = planeBasis(plane);
    const pl = new THREE.Plane().setFromNormalAndCoplanarPoint(b.N, b.O);
    const hit = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(pl, hit)) return null;
    const d = hit.clone().sub(b.O);
    return [d.dot(b.X), d.dot(b.Y)];
  }
  // Screen point -> world hit on a body (for face picking), or null.
  function rayHitPoint(cx, cy) {
    _ndc(cx, cy); raycaster.setFromCamera(mouse, camera);
    const h = raycaster.intersectObjects(bodyGroup.children, true)[0];
    return h ? [h.point.x, h.point.y, h.point.z] : null;
  }
  function lookNormalTo(plane) {
    const b = planeBasis(plane);
    const dist = camera.position.distanceTo(controls.target) || 60;
    camera.up.copy(b.Y);
    camera.position.copy(b.O.clone().addScaledVector(b.N, dist));
    controls.target.copy(b.O); controls.update();
  }
  function orbitForSketch(on) {
    if (on) {
      // Sketch: left draws, right orbits (OrbitControls turntable locked to the plane).
      controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
      controls.enableRotate = true; _arcball = null; _arcballOn = false;
    } else {
      // Normal: right pans, wheel zooms; rotation handled by the custom arcball.
      controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
      controls.enableRotate = false; _arcballOn = true; camera.up.set(0, 0, 1);
    }
  }

  // Sketch overlay (live geometry while 3D-sketching)
  function clearSketchOverlay() {
    while (sketchOverlay.children.length) {
      const o = sketchOverlay.children.pop();
      if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose();
    }
  }
  const SKETCH_LW = 2;   // sketch line width (px)
  function addSketchLine(ptsWorld, color, width) {
    const g = new THREE.BufferGeometry().setFromPoints(ptsWorld);
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: color || 0xfbbf24, linewidth: width || SKETCH_LW }));
    sketchOverlay.add(l); return l;
  }
  // Keep handle dots small relative to the sketch lines so a dense run of points
  // doesn't bury the curve: ~3× the line width (a 6px dot, i.e. 3px radius). Sized
  // in screen space (px → world) so it stays constant as you zoom.
  function addSketchDot(ptWorld, color) {
    const r = 1.5 * SKETCH_LW * worldPerPixel(ptWorld);   // 3px radius = 6px ≈ 3× line width
    const g = new THREE.SphereGeometry(r, 10, 10);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: color || 0xfbbf24 }));
    m.position.copy(ptWorld); sketchOverlay.add(m); return m;
  }
  function _handleR() { return Math.max(0.05, camera.position.distanceTo(controls.target) * 0.006); }
  // World-space length of one CSS pixel at a given world point (perspective
  // camera). Lets callers keep on-screen tolerances constant as the user zooms.
  function worldPerPixel(atWorld) {
    if (!renderer || !camera || !controls) return 0.12;
    const h = renderer.domElement.clientHeight || 1;
    const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
    const p = atWorld ? atWorld.clone() : controls.target.clone();
    const dist = Math.abs(p.sub(camera.position).dot(dir)) || camera.position.distanceTo(controls.target);
    return (2 * Math.tan((camera.fov * Math.PI / 180) / 2) * dist) / h;
  }
  // uv-space world units per CSS pixel ON a sketch plane, at the current zoom.
  // Uses the orbit distance (the zoom level) so the value is uniform across the
  // canvas — not the cursor's perspective depth, which would collapse at grazing
  // angles — and divides by the plane's foreshortening so the on-screen snap
  // radius stays ~constant even when the plane is rotated away from fronto-parallel.
  function planePixelScale(plane) {
    if (!renderer || !camera || !controls) return 0.12;
    const h = renderer.domElement.clientHeight || 1;
    const dist = camera.position.distanceTo(controls.target) || 60;
    const wpp = (2 * Math.tan((camera.fov * Math.PI / 180) / 2) * dist) / h;
    const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
    const cos = Math.abs(planeBasis(plane).N.dot(dir));   // 1 fronto-parallel → 0 edge-on
    return wpp / Math.max(0.15, cos);
  }

  // Plane pickers (base planes + body faces). onPick(plane) where plane is
  // {name?, origin, normal, xdir}; name set only for the standard base planes.
  let _pickHandler = null;
  function _modelSize() {
    const box = new THREE.Box3(); bodyGroup.children.forEach(m => box.expandByObject(m));
    if (box.isEmpty()) return 30;
    const s = box.getSize(new THREE.Vector3());
    return Math.max(s.x, s.y, s.z, 20) * 1.3;
  }
  const BASE_PLANES = [
    { name: "XY", origin: [0, 0, 0], normal: [0, 0, 1], xdir: [1, 0, 0], color: 0x3b82f6 },
    { name: "XZ", origin: [0, 0, 0], normal: [0, -1, 0], xdir: [1, 0, 0], color: 0x34d399 },
    { name: "YZ", origin: [0, 0, 0], normal: [1, 0, 0], xdir: [0, 1, 0], color: 0xf87171 },
  ];
  function showPlanePickers(on, onPick, datums) {
    _clearPick();
    _pickActive = on;
    datumGroup.visible = datumsVisible && !on;   // the clickable pickers stand in while picking
    if (!on) { renderer.domElement.style.cursor = ""; return; }
    const size = _modelSize();
    const all = BASE_PLANES.concat((datums || []).map(d => ({
      name: undefined, ref: d.id, label: d.name, origin: d.origin, normal: d.normal, xdir: d.xdir, color: 0xa78bfa,
    })));
    for (const p of all) {
      const b = planeBasis(p);
      const geo = new THREE.PlaneGeometry(size, size);
      const mat = new THREE.MeshBasicMaterial({ color: p.color, transparent: true, opacity: 0.10, side: THREE.DoubleSide, depthWrite: false });
      const mesh = new THREE.Mesh(geo, mat);
      const m4 = new THREE.Matrix4().makeBasis(b.X, b.Y, b.N);
      mesh.position.copy(b.O);
      mesh.quaternion.setFromRotationMatrix(m4);
      mesh.userData.plane = p; mesh.userData.base = mat;
      pickGroup.add(mesh);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: p.color, transparent: true, opacity: 0.6 }));
      edges.position.copy(b.O); edges.quaternion.copy(mesh.quaternion); pickGroup.add(edges);
    }
    renderer.domElement.style.cursor = "copy";
    let hovered = null;
    const move = (e) => {
      _ndc(e.clientX, e.clientY); raycaster.setFromCamera(mouse, camera);
      const hit = raycaster.intersectObjects(pickGroup.children.filter(o => o.userData.plane), false)[0];
      pickGroup.children.forEach(o => { if (o.userData.base) o.userData.base.opacity = 0.10; });
      hovered = hit ? hit.object : null;
      if (hovered) hovered.userData.base.opacity = 0.28;
    };
    const click = (e) => {
      if (downXY && Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]) > 5) return; // was a drag
      _ndc(e.clientX, e.clientY); raycaster.setFromCamera(mouse, camera);
      const phit = raycaster.intersectObjects(pickGroup.children.filter(o => o.userData.plane), false)[0];
      if (phit) { onPick(phit.object.userData.plane); return; }
      const bhit = raycaster.intersectObjects(bodyGroup.children, true)[0];
      if (bhit) onPick({ _facePoint: [bhit.point.x, bhit.point.y, bhit.point.z] });
    };
    renderer.domElement.addEventListener("pointermove", move);
    renderer.domElement.addEventListener("click", click);
    _pickHandler = () => {
      renderer.domElement.removeEventListener("pointermove", move);
      renderer.domElement.removeEventListener("click", click);
    };
  }
  function _clearPick() {
    if (_pickHandler) { _pickHandler(); _pickHandler = null; }
    while (pickGroup.children.length) {
      const o = pickGroup.children.pop();
      if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose();
    }
  }
  function setPick(fn) {
    onPick = fn;
    renderer.domElement.onclick = (e) => {
      if (downXY && Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]) < 5) _click(e);
    };
  }

  // ---- datum planes shown as squares ---------------------------------- //
  function clearDatums() {
    while (datumGroup.children.length) { const o = datumGroup.children.pop(); if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); }
  }
  function showDatums(datums) {
    clearDatums();
    if (datums) for (const d of datums) {
      const b = planeBasis(d);
      const s = Math.max(_modelSize() * 0.6, 16);
      const geo = new THREE.PlaneGeometry(s, s);
      const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(b.X, b.Y, b.N));
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xa78bfa, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }));
      mesh.position.copy(b.O); mesh.quaternion.copy(q); mesh.renderOrder = -1;
      datumGroup.add(mesh);
      const border = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xa78bfa, transparent: true, opacity: 0.6 }));
      border.position.copy(b.O); border.quaternion.copy(q);
      datumGroup.add(border);
    }
    datumGroup.visible = datumsVisible && !_pickActive;
  }
  function toggleDatums() { datumsVisible = !datumsVisible; datumGroup.visible = datumsVisible && !_pickActive; return datumsVisible; }

  // ---- standard views -------------------------------------------------- //
  function setView(name) {
    const box = new THREE.Box3(); bodyGroup.children.forEach(m => { if (m.visible) box.expandByObject(m); });
    const c = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
    const sz = box.isEmpty() ? 40 : (Math.max(...box.getSize(new THREE.Vector3()).toArray()) * 1.9 || 40);
    const V = { // dir(3) + up(3)
      front: [0, -1, 0, 0, 0, 1], back: [0, 1, 0, 0, 0, 1], top: [0, 0, 1, 0, 1, 0],
      bottom: [0, 0, -1, 0, -1, 0], right: [1, 0, 0, 0, 0, 1], left: [-1, 0, 0, 0, 0, 1],
      iso: [0.8, -1, 0.7, 0, 0, 1],
    }[name] || [0.8, -1, 0.7, 0, 0, 1];
    const dir = new THREE.Vector3(V[0], V[1], V[2]).normalize();
    camera.up.set(V[3], V[4], V[5]);
    camera.position.copy(c.clone().addScaledVector(dir, sz));
    controls.target.copy(c); controls.update();
  }

  // ---- navigation cube (Onshape-style) -------------------------------- //
  // A small WebGL widget that mirrors the main camera's orientation. Clicking a
  // face / edge / corner reorients the model to look from that direction. The
  // cube lives in world axes (X→right, Y→back, Z→up) so its faces line up with
  // the named views. Each face is its own plane, oriented so its label reads
  // upright when that face is viewed head-on.
  let navRenderer, navScene, navCamera, navFaces = [], navHiGroup, navDownXY = null;
  const NAV_R = 3.35;   // cube-camera distance (frames a unit cube at fov 30)
  const NAV_T = 0.37;   // outer band of a face → snaps to an edge/corner view
  const navRay = new THREE.Raycaster(), navMouse = new THREE.Vector2();
  // label, in-plane X (text right), in-plane Y (text up), outward normal
  const NAV_FACES = [
    { label: "FRONT",  x: [1, 0, 0],  y: [0, 0, 1],  n: [0, -1, 0] },
    { label: "BACK",   x: [-1, 0, 0], y: [0, 0, 1],  n: [0, 1, 0] },
    { label: "RIGHT",  x: [0, 1, 0],  y: [0, 0, 1],  n: [1, 0, 0] },
    { label: "LEFT",   x: [0, -1, 0], y: [0, 0, 1],  n: [-1, 0, 0] },
    { label: "TOP",    x: [1, 0, 0],  y: [0, 1, 0],  n: [0, 0, 1] },
    { label: "BOTTOM", x: [1, 0, 0],  y: [0, -1, 0], n: [0, 0, -1] },
  ];
  function _navTexture(text) {
    const s = 128, cv = document.createElement("canvas"); cv.width = cv.height = s;
    const x = cv.getContext("2d");
    x.fillStyle = "#e9edf3"; x.fillRect(0, 0, s, s);
    x.strokeStyle = "#b7c0cd"; x.lineWidth = 5; x.strokeRect(2.5, 2.5, s - 5, s - 5);
    x.fillStyle = "#27313f"; x.font = "600 24px system-ui, Arial, sans-serif";
    x.textAlign = "center"; x.textBaseline = "middle";
    x.fillText(text, s / 2, s / 2 + 1);
    const t = new THREE.CanvasTexture(cv); t.anisotropy = 4; return t;
  }
  function initNavCube(canvas) {
    if (!canvas || !canvas.getContext) return;
    navRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    navRenderer.setPixelRatio(window.devicePixelRatio || 1);
    navRenderer.setSize(canvas.clientWidth || 104, canvas.clientHeight || 104, false);
    navScene = new THREE.Scene();
    navCamera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    navCamera.up.set(0, 0, 1);
    const cube = new THREE.Group();
    for (const f of NAV_FACES) {
      const X = new THREE.Vector3(...f.x), Y = new THREE.Vector3(...f.y), N = new THREE.Vector3(...f.n);
      const mat = new THREE.MeshBasicMaterial({ map: _navTexture(f.label) });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.99, 0.99), mat);
      mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, N));
      mesh.position.copy(N).multiplyScalar(0.5);
      cube.add(mesh); navFaces.push(mesh);
    }
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: 0x59647a }));
    cube.add(edges);
    navScene.add(cube);
    navHiGroup = new THREE.Group(); navScene.add(navHiGroup);
    canvas.addEventListener("pointermove", _navHover);
    canvas.addEventListener("pointerleave", () => { _navClearHi(); navRenderer.domElement.style.cursor = ""; });
    canvas.addEventListener("pointerdown", e => { navDownXY = [e.clientX, e.clientY]; });
    canvas.addEventListener("click", _navClick);
  }
  function _renderNavCube() {
    if (!navRenderer) return;
    const off = camera.position.clone().sub(controls.target);
    if (off.lengthSq() < 1e-9) off.set(0, -1, 0.6);
    off.normalize().multiplyScalar(NAV_R);
    navCamera.position.copy(off);
    navCamera.up.copy(camera.up);
    navCamera.lookAt(0, 0, 0);
    navRenderer.render(navScene, navCamera);
  }
  function _navPick(e) {
    const r = navRenderer.domElement.getBoundingClientRect();
    navMouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    navMouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    navRay.setFromCamera(navMouse, navCamera);
    return navRay.intersectObjects(navFaces, false)[0] || null;
  }
  // Snap a hit point on the cube surface (coords in [-0.5, 0.5]) to the view it
  // selects: a unit vector with 1 nonzero component → face, 2 → edge, 3 → corner.
  function _navSnap(p) {
    const d = new THREE.Vector3(
      Math.abs(p.x) > NAV_T ? Math.sign(p.x) : 0,
      Math.abs(p.y) > NAV_T ? Math.sign(p.y) : 0,
      Math.abs(p.z) > NAV_T ? Math.sign(p.z) : 0);
    return d.lengthSq() === 0 ? null : d;
  }
  function _navClearHi() {
    while (navHiGroup.children.length) { const o = navHiGroup.children.pop(); o.geometry.dispose(); o.material.dispose(); }
  }
  // Highlight exactly the region the snapped direction maps to: the center square
  // of one face (face view), a strip wrapping an edge across its two faces (edge
  // view), or three squares meeting at a corner (corner view).
  function _navShowZone(dir) {
    _navClearHi();
    const comp = [dir.x, dir.y, dir.z];
    const rng = d => d > 0 ? [NAV_T, 0.5] : d < 0 ? [-0.5, -NAV_T] : [-NAV_T, NAV_T];
    for (let a = 0; a < 3; a++) {
      if (comp[a] === 0) continue;                      // this face is part of the zone
      const [b, c] = [0, 1, 2].filter(i => i !== a);
      const rb = rng(comp[b]), rc = rng(comp[c]), n = comp[a] * 0.505;   // just proud of the face
      const pt = (bv, cv) => { const v = [0, 0, 0]; v[a] = n; v[b] = bv; v[c] = cv; return v; };
      const verts = [
        ...pt(rb[0], rc[0]), ...pt(rb[1], rc[0]), ...pt(rb[1], rc[1]),
        ...pt(rb[0], rc[0]), ...pt(rb[1], rc[1]), ...pt(rb[0], rc[1]),
      ];
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
        color: 0x6aa9ff, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
      m.renderOrder = 10; navHiGroup.add(m);
    }
  }
  function _navHover(e) {
    const hit = _navPick(e);
    const dir = hit && _navSnap(hit.point);
    if (dir) _navShowZone(dir); else _navClearHi();
    navRenderer.domElement.style.cursor = dir ? "pointer" : "";
  }
  function _navClick(e) {
    if (navDownXY && Math.hypot(e.clientX - navDownXY[0], e.clientY - navDownXY[1]) > 4) return;   // a drag
    const hit = _navPick(e); if (!hit) return;
    const dir = _navSnap(hit.point);
    if (!dir) return;
    _orientCameraTo(dir);
  }
  // Reorient the model so the camera looks from `dir` (a snapped cube direction),
  // preserving the current zoom (distance to target). Top/bottom get a Y-up so
  // they match Viewport.setView; everything else keeps world-Z up.
  function _orientCameraTo(dir) {
    const tg = controls.target.clone();
    const dist = camera.position.distanceTo(tg) || 60;
    const d = dir.clone().normalize();
    const up = (dir.x === 0 && dir.y === 0)
      ? new THREE.Vector3(0, dir.z > 0 ? 1 : -1, 0)
      : new THREE.Vector3(0, 0, 1);
    _animateCamera(tg.clone().addScaledVector(d, dist), up);
  }

  // ---- per-body visibility / color / isolation ------------------------ //
  function setBodyVisible(id, vis) {
    bodyPrefs[id] = Object.assign({}, bodyPrefs[id], { hidden: !vis });
    if (bodies[id]) { bodies[id].mesh.visible = vis; if (bodies[id].eg) bodies[id].eg.visible = vis; }
  }
  function setBodyColor(id, hex) {
    bodyPrefs[id] = Object.assign({}, bodyPrefs[id], { color: hex });
    if (bodies[id]) bodies[id].mesh.material.color.set(hex);
  }
  // Current colour of a body as a #rrggbb string (its override, or the default).
  function getBodyColor(id) {
    const p = bodyPrefs[id] || {};
    return "#" + new THREE.Color(p.color != null ? p.color : DEFAULT_BODY).getHexString();
  }
  function defaultBodyColor() { return "#" + new THREE.Color(DEFAULT_BODY).getHexString(); }
  function isolateBody(id) { for (const k in bodies) setBodyVisible(k, id === null || k === id); }
  function showAllBodies() { for (const k in bodies) setBodyVisible(k, true); }
  function bodyHidden(id) { return !!(bodyPrefs[id] && bodyPrefs[id].hidden); }
  // Temporarily hide every body while sketching so the sketch is unobstructed,
  // without disturbing each body's persistent visibility pref — restored on
  // finish/cancel (and honoured by _buildMesh if a rebuild happens meanwhile).
  function hideAllForSketch(on) {
    _sketchHidden = on;
    for (const id in bodies) {
      const vis = !on && (!bodyPrefs[id] || bodyPrefs[id].hidden !== true);
      if (bodies[id].mesh) bodies[id].mesh.visible = vis;
      if (bodies[id].eg) bodies[id].eg.visible = vis;
    }
  }

  // ---- section view (clipping) ---------------------------------------- //
  function setSection(on, axis, offset) {
    if (!on) { clipPlanes = []; }
    else {
      const n = { x: [-1, 0, 0], y: [0, -1, 0], z: [0, 0, -1] }[axis] || [0, 0, -1];
      clipPlanes = [new THREE.Plane(new THREE.Vector3(n[0], n[1], n[2]), offset || 0)];
    }
    for (const k in bodies) {
      bodies[k].mesh.material.clippingPlanes = clipPlanes;
      if (bodies[k].eg) bodies[k].eg.traverse(o => { if (o.material) o.material.clippingPlanes = clipPlanes; });
    }
  }

  // ---- measure --------------------------------------------------------- //
  function clearMeasure() {
    while (measureGroup.children.length) { const o = measureGroup.children.pop(); if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }
  }
  function showMeasure(p1, p2) {
    clearMeasure();
    const a = new THREE.Vector3(p1[0], p1[1], p1[2]), b = new THREE.Vector3(p2[0], p2[1], p2[2]);
    measureGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 1, gapSize: 0.5 })).computeLineDistances());
    [a, b].forEach(pt => { const m = new THREE.Mesh(new THREE.SphereGeometry(_handleR(), 10, 10), new THREE.MeshBasicMaterial({ color: 0xffd166 })); m.position.copy(pt); measureGroup.add(m); });
  }
  function addMeasureDot(p) { const m = new THREE.Mesh(new THREE.SphereGeometry(_handleR(), 10, 10), new THREE.MeshBasicMaterial({ color: 0xffd166 })); m.position.set(p[0], p[1], p[2]); measureGroup.add(m); }

  return {
    init, applyScene, getKnown, fit, highlight, setTheme, toggleGrid, toggleAxes, toggleSketches, sketchesVisible, cameraDir, setPick, onResize,
    // 3D sketching + plane selection
    screenToPlane, uvToWorld, planeBasis, rayHitPoint, lookNormalTo, orbitForSketch,
    clearSketchOverlay, addSketchLine, addSketchDot, showPlanePickers, handleR: _handleR, worldPerPixel, planePixelScale,
    // views / bodies / section / measure
    setView, setBodyVisible, setBodyColor, getBodyColor, defaultBodyColor, isolateBody, showAllBodies, bodyHidden, hideAllForSketch,
    setSection, showMeasure, clearMeasure, addMeasureDot, setDisplayMode, getDisplayMode,
    pickEdgeAt, showSelectionMarks, clearSelectionMarks, setHoverMode, hoverInfo, clearHover,
    showDatums, toggleDatums, inspectCommit, clearInspect,
  };
})();
