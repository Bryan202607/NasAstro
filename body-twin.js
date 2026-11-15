/* body-twin.js : jumeau numérique 3D (mannequin ou combinaison d'astronaute)
 * Prérequis, chargés avant : three r128, OrbitControls, GLTFLoader, SkeletonUtils (r128), React.
 * Modèles (glTF) : AstroTwin.config = { modelUrl:"Xbot.glb", suitUrl:"astronaut_suit.glb" }
 *                  ou { modelB64:"...", suitB64:"..." } (base64 du .glb, pour un fichier unique).
 * Expose window.AstroTwin : BodyTwin.mount / mountPreview, BodyTwinView, BodyPreview.
 *  - BodyTwinView  : scène interactive (rotation, clic sur une zone), props variant "mannequin" | "suit"
 *  - BodyPreview   : petit aperçu 3D (canvas) ; tous les aperçus partagent UN seul moteur WebGL
 */
(function (global) {
  if (!global.THREE || !global.THREE.GLTFLoader || !global.THREE.OrbitControls || !global.THREE.SkeletonUtils) return; // 3D indisponible : body-fallback.js prend le relais
  // teintes mates (pas de néon), converties en linéaire car le rendu sort en sRGB
  var OK = new THREE.Color("#5f9b86").convertSRGBToLinear(), WARN = new THREE.Color("#d9a830").convertSRGBToLinear(), CRIT = new THREE.Color("#d0443f").convertSRGBToLinear();
  function setupRenderer(r) { r.outputEncoding = THREE.sRGBEncoding; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.9; }
  function riskColor(r, out) {
    r = Math.min(1, Math.max(0, r || 0));
    return r < 0.5 ? out.copy(OK).lerp(WARN, r / 0.5) : out.copy(WARN).lerp(CRIT, (r - 0.5) / 0.5);
  }
  function sstep(a, b, x) { x = Math.min(1, Math.max(0, (x - a) / (b - a))); return x * x * (3 - 2 * x); }
  var ZONES = ["head", "torso", "legs"], HEIGHT = 1.8;
  var SRC = { mannequin: { b64: "modelB64", url: "modelUrl", def: "Xbot.glb" }, suit: { b64: "suitB64", url: "suitUrl", def: "astronaut_suit.glb" } };

  /* ---------- chargement : chaque modèle est analysé une seule fois ---------- */
  var cache = {};
  function getModel(variant, cb) {
    var e = cache[variant];
    if (e && e.gltf) return cb(e.gltf);
    if (e) { e.q.push(cb); return; }
    e = cache[variant] = { q: [cb] };
    var S = SRC[variant], cfg = (global.AstroTwin && global.AstroTwin.config) || {}, L = new THREE.GLTFLoader();
    function done(g) { e.gltf = g; e.q.forEach(function (f) { f(g); }); e.q = []; }
    function bad(x) { console.error("Modèle 3D introuvable (" + variant + ")", x); }
    if (cfg[S.b64]) {
      var bin = atob(cfg[S.b64]), u = new Uint8Array(bin.length), i;
      for (i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      L.parse(u.buffer, "", done, bad);
    } else L.load(cfg[S.url] || S.def, done, undefined, bad);
  }

  function shadowTexture() {
    var c = document.createElement("canvas"); c.width = c.height = 128;
    var x = c.getContext("2d"), g = x.createRadialGradient(64, 64, 4, 64, 64, 62);
    g.addColorStop(0, "rgba(0,0,0,0.55)"); g.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }
  var shadowTex = null;

  /* ---------- une "scène" par astronaute : modèle + éclairage + couleurs de zones ---------- */
  function createRig(variant, init) {
    var scene = new THREE.Scene();
    var st = init || { risks: { head: 0.2, torso: 0.2, legs: 0.2 }, rad: 0.1, sel: null };
    scene.add(new THREE.HemisphereLight(0xdfe6ee, 0x15171c, 0.6));
    var key = new THREE.DirectionalLight(0xfff1e0, 1.0); key.position.set(2.5, 4, 3); scene.add(key);
    var fill = new THREE.DirectionalLight(0x9db4d3, 0.5); fill.position.set(-3, 1.5, 2); scene.add(fill);
    var back = new THREE.DirectionalLight(0xffffff, 0.8); back.position.set(-2, 3, -3); scene.add(back);
    shadowTex = shadowTex || shadowTexture();
    var floor = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = 0.002; scene.add(floor);

    var U = {
      uMin: { value: 0 }, uMax: { value: HEIGHT },
      uC: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
      uS: { value: new THREE.Vector3() }, uSel: { value: new THREE.Vector3() },
      uRad: { value: 0 }, uRadC: { value: new THREE.Vector3() }
    };
    var cur = ZONES.map(function (z) { return riskColor(st.risks[z], new THREE.Color()); });
    var radCur = riskColor(st.rad, new THREE.Color()), tmp = new THREE.Color();
    var rig = { scene: scene, state: st, model: null }, mixer = null, dead = false;

    function patch(model) {
      model.traverse(function (m) {
        if (!m.isMesh) return;
        m.frustumCulled = false;
        var mat, k;
        if (variant === "mannequin") {
          var body = /surface/i.test(m.name);
          mat = new THREE.MeshStandardMaterial(body
            ? { color: new THREE.Color("#aeb0b3").convertSRGBToLinear(), roughness: 0.55, metalness: 0.0, skinning: true }
            : { color: new THREE.Color("#2b2d31").convertSRGBToLinear(), roughness: 0.38, metalness: 0.55, skinning: true });
          k = body ? 1 : 0;
        } else {
          mat = m.material.clone();
          k = /suit|fabric|shell|ivory|harness|webbing/i.test(mat.name || "") ? 1 : 0.2; // tissu et coque colorés, accessoires peu
        }
        mat.onBeforeCompile = function (sh) {
          for (var n in U) sh.uniforms[n] = U[n];
          sh.uniforms.uK = { value: k };
          sh.vertexShader = sh.vertexShader
            .replace("#include <common>", "#include <common>\nvarying float vYn;\nuniform float uMin;\nuniform float uMax;")
            .replace("#include <project_vertex>", "#include <project_vertex>\nvYn=((modelMatrix*vec4(transformed,1.0)).y-uMin)/(uMax-uMin);");
          sh.fragmentShader = sh.fragmentShader
            .replace("#include <common>", "#include <common>\nvarying float vYn;\nuniform vec3 uC[3];\nuniform vec3 uS;\nuniform vec3 uSel;\nuniform float uRad;\nuniform vec3 uRadC;\nuniform float uK;")
            .replace("#include <color_fragment>", "#include <color_fragment>\n" +
              "float hw=smoothstep(0.83,0.88,vYn); float lw=1.0-smoothstep(0.44,0.50,vYn); float tw=max(0.0,1.0-hw-lw);\n" +
              "vec3 zc=uC[0]*hw+uC[1]*tw+uC[2]*lw; float zs=(uS.x*hw+uS.y*tw+uS.z*lw)*uK;\n" +
              "diffuseColor.rgb=mix(diffuseColor.rgb,zc,zs);")
            .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n" +
              "float sl=uSel.x*hw+uSel.y*tw+uSel.z*lw;\n" +
              "totalEmissiveRadiance+=zc*(zs*0.04+sl*0.07*uK);\n" +
              "float fr=pow(1.0-clamp(dot(normalize(vNormal),normalize(vViewPosition)),0.0,1.0),2.5);\n" +
              "totalEmissiveRadiance+=uRadC*fr*uRad*(0.5+0.5*uK)*0.55;");
        };
        m.material = mat;
      });
    }

    getModel(variant, function (g) {
      if (dead) return;
      var model = THREE.SkeletonUtils ? THREE.SkeletonUtils.clone(g.scene) : g.scene.clone(true);
      var skinned = false, minY = Infinity, maxY = -Infinity, k;
      model.traverse(function (m) {
        if (m.isSkinnedMesh) skinned = true;
        if (m.isMesh) { m.geometry.computeBoundingBox(); var b = m.geometry.boundingBox; minY = Math.min(minY, b.min.y); maxY = Math.max(maxY, b.max.y); }
      });
      if (skinned) { // l'échelle de l'armature fausse Box3 : on mesure la géométrie au repos
        k = HEIGHT / (maxY - minY); model.scale.multiplyScalar(k); model.position.y = -minY * k;
      } else {
        var box = new THREE.Box3().setFromObject(model); k = HEIGHT / (box.max.y - box.min.y);
        model.scale.multiplyScalar(k); box.setFromObject(model);
        model.position.set(model.position.x - (box.min.x + box.max.x) / 2, model.position.y - box.min.y, model.position.z - (box.min.z + box.max.z) / 2);
      }
      patch(model);
      scene.add(model); rig.model = model;
      if (skinned && g.animations && g.animations.length) {
        var clip = g.animations.filter(function (c) { return /idle/i.test(c.name); })[0] || g.animations[0];
        mixer = new THREE.AnimationMixer(model); mixer.clipAction(clip).play();
      }
    });

    rig.update = function (dt) {
      if (mixer) mixer.update(dt);
      ZONES.forEach(function (z, i) {
        riskColor(st.risks[z], tmp); cur[i].lerp(tmp, 0.08);
        U.uC.value[i].set(cur[i].r, cur[i].g, cur[i].b);
      });
      U.uS.value.set(sstep(0.12, 0.85, st.risks.head) * 0.5, sstep(0.12, 0.85, st.risks.torso) * 0.5, sstep(0.12, 0.85, st.risks.legs) * 0.5);
      U.uSel.value.set(st.sel === "head" ? 1 : 0, st.sel === "torso" ? 1 : 0, st.sel === "legs" ? 1 : 0);
      riskColor(st.rad, tmp); radCur.lerp(tmp, 0.08);
      U.uRadC.value.set(radCur.r, radCur.g, radCur.b);
      U.uRad.value = sstep(0.08, 0.8, st.rad);
    };
    rig.set = function (d) {
      if (d.risks) ZONES.forEach(function (z) { if (d.risks[z] != null) st.risks[z] = d.risks[z]; });
      if (d.radiation != null) st.rad = d.radiation;
    };
    rig.dispose = function () { dead = true; };
    return rig;
  }

  /* ---------- scène interactive ---------- */
  function mount(el, opts) {
    opts = opts || {};
    var w = el.clientWidth || 320, h = el.clientHeight || 400;
    var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    setupRenderer(renderer);
    renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
    renderer.setSize(w, h);
    var dom = renderer.domElement;
    dom.style.display = "block"; dom.style.touchAction = "none";
    el.appendChild(dom);

    var camera = new THREE.PerspectiveCamera(30, w / h, 0.1, 50);
    camera.position.set(0, 1.0, 4.3);
    var controls = null;
    if (THREE.OrbitControls) {
      controls = new THREE.OrbitControls(camera, dom);
      controls.enablePan = false; controls.minDistance = 3; controls.maxDistance = 7;
      controls.minPolarAngle = 1.1; controls.maxPolarAngle = 1.75;
      controls.target.set(0, 0.92, 0); controls.autoRotate = true; controls.autoRotateSpeed = 0.7;
      controls.update();
    }
    var variant = opts.variant || "mannequin", rig = createRig(variant), clock = new THREE.Clock(), raf;
    function frame() {
      raf = requestAnimationFrame(frame);
      rig.update(clock.getDelta());
      if (controls) controls.update();
      renderer.render(rig.scene, camera);
    }
    frame();

    // sélection par projection écran (fonctionne avec les deux apparences)
    var down = null, v = new THREE.Vector3();
    function sy(y) { v.set(0, y, 0).project(camera); return v.y; }
    function onDown(e) { down = { x: e.clientX, y: e.clientY }; if (controls) controls.autoRotate = false; }
    function onUp(e) {
      if (!down || Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) > 8) return;
      var r = dom.getBoundingClientRect(), nx = ((e.clientX - r.left) / r.width) * 2 - 1, ny = -((e.clientY - r.top) / r.height) * 2 + 1;
      var bot = sy(0), top = sy(HEIGHT), cx = (v.set(0, 0.9, 0).project(camera), v.x), hN = top - bot, z = null;
      if (ny > bot && ny < top && Math.abs(nx - cx) < 0.28 * hN * (r.height / r.width)) {
        var f = (ny - bot) / hN;
        z = f > 0.86 ? "head" : f > 0.5 ? "torso" : "legs";
      }
      rig.state.sel = z; if (opts.onSelect) opts.onSelect(z);
    }
    function resize() {
      var w2 = el.clientWidth || 320, h2 = el.clientHeight || 400;
      renderer.setSize(w2, h2); camera.aspect = w2 / h2; camera.updateProjectionMatrix();
    }
    dom.addEventListener("pointerdown", onDown); dom.addEventListener("pointerup", onUp);
    global.addEventListener("resize", resize);

    return {
      update: function (d) { rig.set(d); },
      select: function (z) { rig.state.sel = z; },
      setVariant: function (nv) {
        if (nv === variant) return;
        var old = rig.state; rig.dispose(); variant = nv; rig = createRig(nv, old);
      },
      dispose: function () {
        rig.dispose(); cancelAnimationFrame(raf);
        dom.removeEventListener("pointerdown", onDown); dom.removeEventListener("pointerup", onUp);
        global.removeEventListener("resize", resize);
        renderer.dispose(); if (dom.parentNode) dom.parentNode.removeChild(dom);
      }
    };
  }

  /* ---------- aperçus : un seul moteur WebGL pour tous les petits canvas ---------- */
  var hub = null;
  function getHub() {
    if (hub) return hub;
    var r = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    setupRenderer(r); r.setPixelRatio(1);
    hub = { r: r, items: [], raf: 0, last: 0 };
    function tick(now) {
      hub.raf = requestAnimationFrame(tick);
      if (now - hub.last < 33) return; // ~30 images/s
      var dt = Math.min((now - hub.last) / 1000, 0.1); hub.last = now;
      hub.items.forEach(function (it) {
        var c = it.canvas, w = c.width, h = c.height;
        if (!c.isConnected || !w || !h) return;
        if (r.domElement.width !== w || r.domElement.height !== h) r.setSize(w, h, false);
        it.cam.aspect = w / h; it.cam.updateProjectionMatrix();
        it.angle += dt * 0.5;
        if (it.rig.model) it.rig.model.rotation.y = it.angle;
        it.rig.update(dt);
        r.render(it.rig.scene, it.cam);
        it.ctx.clearRect(0, 0, w, h); it.ctx.drawImage(r.domElement, 0, 0);
      });
    }
    hub.raf = requestAnimationFrame(tick);
    return hub;
  }

  function mountPreview(canvas, opts) {
    opts = opts || {};
    var H = getHub(), cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    cam.position.set(0, 0.95, 4.1); cam.lookAt(0, 0.9, 0);
    var it = { canvas: canvas, ctx: canvas.getContext("2d"), rig: createRig(opts.variant || "mannequin"), cam: cam, angle: 0.4 };
    H.items.push(it);
    return {
      update: function (d) { it.rig.set(d); },
      dispose: function () {
        it.rig.dispose();
        H.items = H.items.filter(function (x) { return x !== it; });
        if (!H.items.length && hub === H) { cancelAnimationFrame(H.raf); H.r.dispose(); hub = null; }
      }
    };
  }

  var ns = global.AstroTwin = global.AstroTwin || {};
  ns.BodyTwin = { mount: mount, mountPreview: mountPreview, riskColor: riskColor };
  if (global.React) {
    var R = global.React;
    ns.BodyTwinView = function (props) {
      var ref = R.useRef(null), twin = R.useRef(null);
      R.useEffect(function () {
        twin.current = mount(ref.current, { onSelect: props.onSelectZone, variant: props.variant });
        return function () { twin.current.dispose(); };
      }, []);
      R.useEffect(function () { if (twin.current) twin.current.setVariant(props.variant || "mannequin"); }, [props.variant]);
      R.useEffect(function () { if (twin.current) twin.current.update({ risks: props.risks, radiation: props.radiation }); });
      R.useEffect(function () { if (twin.current) twin.current.select(props.selectedZone || null); }, [props.selectedZone]);
      return R.createElement("div", { ref: ref, style: { width: "100%", height: "100%" } });
    };
    ns.BodyPreview = function (props) {
      var ref = R.useRef(null), pv = R.useRef(null);
      R.useEffect(function () {
        var c = ref.current, dpr = Math.min(global.devicePixelRatio || 1, 2);
        c.width = Math.max(1, Math.round(c.clientWidth * dpr)); c.height = Math.max(1, Math.round(c.clientHeight * dpr));
        pv.current = mountPreview(c, { variant: props.variant });
        return function () { pv.current.dispose(); };
      }, [props.variant]);
      R.useEffect(function () { if (pv.current) pv.current.update({ risks: props.risks, radiation: props.radiation }); });
      return R.createElement("canvas", { ref: ref, style: { width: "100%", height: props.height || 220, display: "block" } });
    };
  }
})(window);
