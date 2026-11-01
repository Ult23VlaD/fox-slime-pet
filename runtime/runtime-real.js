/* Fox pet runtime for a monolithic (single-mesh) GLB model.
   Whole-body smooth motion only: breathing, sway, tilt, look-at, happy wiggle + heart.
   Expects global THREE and THREE.GLTFLoader. */
(function () {
  'use strict';

  var GLB_B64 = '__GLB_BASE64__';

  var TAU = Math.PI * 2;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function damp(cur, target, rate, dt) { return lerp(cur, target, 1 - Math.exp(-rate * dt)); }
  function easeInOut(t) { return t * t * (3 - 2 * t); }
  function easeOutBack(t) { var c = 1.70158; var u = t - 1; return 1 + (c + 1) * u * u * u + c * u * u; }

  function basePose() {
    return { y: 0, pitch: 0, roll: 0, yaw: 0, breathe: 1, breathePh: 0, swayAmp: 0.012, swaySpeed: 0.5 };
  }

  // Whole-body poses; t = seconds inside state. Deliberately slow and readable.
  var STATES = {
    idle: function (t, p) { /* pure breathing + gentle sway from defaults */ },
    working: function (t, p) {
      p.pitch = 0.06;
      p.breathePh = TAU * 0.9 * t;
      p.breathe = 1.015;
      p.swayAmp = 0.008; p.swaySpeed = 1.1;
    },
    waiting: function (t, p) {
      p.yaw = 0.18 * Math.sin(TAU * 0.35 * t);   // curious slow head-turn of the whole body
      p.pitch = 0.03;
      p.swayAmp = 0.006;
    },
    failed: function (t, p) {
      p.roll = 0.10; p.pitch = 0.10; p.swayAmp = 0.004; p.swaySpeed = 0.25;
    },
    running_left: function (t, p) { runPose(t, p, -1); },
    running_right: function (t, p) { runPose(t, p, 1); },
    idle_random_1: function (t, p) {             // slow happy stretch
      var c = (t % 4.5) / 4.5;
      var e = Math.sin(Math.PI * c);
      p.breathe = 1 + 0.05 * e;                  // grows taller, then settles
      p.pitch = -0.05 * e;
    },
    idle_random_2: function (t, p) {             // look around
      var c = t % 5.0;
      if (c < 1.2) p.yaw = 0.35 * easeInOut(c / 1.2);
      else if (c < 2.2) p.yaw = 0.35;
      else if (c < 3.4) p.yaw = lerp(0.35, -0.35, easeInOut((c - 2.2) / 1.2));
      else if (c < 4.4) p.yaw = -0.35;
      else p.yaw = lerp(-0.35, 0, easeInOut((c - 4.4) / 0.6));
    }
  };

  function runPose(t, p, dir) {
    var ph = TAU * 1.4 * t;
    p.y = 0.05 * Math.max(0, Math.sin(ph));
    p.yaw = dir * 0.5;
    p.roll = dir * -0.08;
    p.pitch = 0.05;
  }

  function mount(canvas, options) {
    options = options || {};
    var preview = options.preview === true;
    var MODEL_SCALE = 0.5; // уменьшенная в 2 раза модель

    var renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setClearColor(0x000000, 0);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    camera.position.set(0, 0.95, 4.6);
    camera.lookAt(0, 0.85, 0);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a6f55, 0.9));
    var key = new THREE.DirectionalLight(0xffffff, 1.5); key.position.set(2.5, 4.5, 3.5); scene.add(key);
    var fill = new THREE.DirectionalLight(0xffe6cc, 0.5); fill.position.set(-3, 1.6, 2.5); scene.add(fill);
    var rim = new THREE.DirectionalLight(0xfff4e0, 0.7); rim.position.set(-0.5, 3.5, -4); scene.add(rim);

    var root = new THREE.Group();          // normalized model container
    scene.add(root);
    var model = null, ready = false;
    var modelH = 1.8;

    // ---- procedural heart (no Blender needed) ----
    var heart = null, heartT = -1;
    (function makeHeart() {
      var s = new THREE.Shape();
      s.moveTo(0, 0.10);
      s.bezierCurveTo(0, 0.16, -0.10, 0.22, -0.14, 0.14);
      s.bezierCurveTo(-0.19, 0.05, -0.10, -0.05, 0, -0.14);
      s.bezierCurveTo(0.10, -0.05, 0.19, 0.05, 0.14, 0.14);
      s.bezierCurveTo(0.10, 0.22, 0, 0.16, 0, 0.10);
      var g = new THREE.ExtrudeGeometry(s, { depth: 0.06, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2 });
      g.center();
      var m = new THREE.MeshStandardMaterial({ color: 0xf22a45, roughness: 0.35, emissive: 0xa01030, emissiveIntensity: 0.4 });
      heart = new THREE.Mesh(g, m);
      heart.scale.setScalar(0.001);
      heart.position.set(0.55, 2.1, 0.3);
      scene.add(heart);
    })();

    // ---- animation state ----
    var state = 'idle', stateT = 0;
    var prevStateFn = STATES.idle, blend = 1;
    var cur = basePose();
    var patT = -1;
    var idleTimer = 0, idleVariant = -1, idleVariantT = 0;
    var cursorNdc = { x: 0, y: 0 }, lookYaw = 0, lookPitch = 0, hovering = false;
    var bootT = -1, shutdownT = -1, bootDone = [], shutdownDone = [];
    var bootScale = 1, fadeScale = 1;
    var disposed = false, rafId = 0, last = performance.now();
    var lastBoundsKey = '';

    function decodeGlb() {
      var bin = atob(GLB_B64);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes.buffer;
    }

    new THREE.GLTFLoader().parse(decodeGlb(), '', function (gltf) {
      model = gltf.scene;
      // normalize: center XZ, feet on y=0, height = modelH
      var box = new THREE.Box3().setFromObject(model);
      var size = new THREE.Vector3(); box.getSize(size);
      var center = new THREE.Vector3(); box.getCenter(center);
      var s = modelH / size.y;
      model.scale.setScalar(s);
      model.position.set(-center.x * s, -box.min.y * s, -center.z * s);
      model.rotation.y = -Math.PI / 2;   // модель смотрит в +X, разворачиваем к камере (+Z)
      root.add(model);
      model.traverse(function (o) {
        if (o.isMesh) {
          o.frustumCulled = false;
          if (o.material) { o.material.metalness = 0; }
        }
      });
      ready = true;
      if (bootT >= 0) bootT = 0;
      resize();
    }, undefined, function (err) {
      console.error('[fox] GLB load failed', err);
    });

    function resize() {
      var w = canvas.clientWidth || 256, h = canvas.clientHeight || 256;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }

    function poseFor(fn, t) { var p = basePose(); fn(t, p); return p; }

    function tick(now) {
      if (disposed) return;
      rafId = requestAnimationFrame(tick);
      var dt = clamp((now - last) / 1000, 0.0005, 0.05);
      last = now;
      if (!ready || !model) { renderer.clear(); return; }

      stateT += dt;
      if (blend < 1) blend = Math.min(1, blend + dt / 0.6); // 600 ms crossfade — extra gentle

      // ---- idle variants ----
      if (!preview && state === 'idle') {
        if (idleVariant < 0) {
          idleTimer += dt;
          if (idleTimer > 8 + Math.random() * 5) {
            idleVariant = Math.random() < 0.5 ? 1 : 2;
            idleVariantT = 0; idleTimer = 0;
          }
        } else {
          idleVariantT += dt;
          var dur = idleVariant === 1 ? 4.5 : 5.0;
          if (idleVariantT >= dur) { idleVariant = -1; idleTimer = 0; }
        }
      } else { idleVariant = -1; idleTimer = 0; }
      var fn = idleVariant === 1 ? STATES.idle_random_1
        : idleVariant === 2 ? STATES.idle_random_2 : STATES[state] || STATES.idle;
      var ft = idleVariant > 0 ? idleVariantT : stateT;

      // ---- crossfade + heavy damping = visibly smooth motion ----
      var target = poseFor(fn, ft);
      if (blend < 1) {
        var from = poseFor(prevStateFn, stateT);
        for (var k in target) target[k] = lerp(from[k], target[k], easeInOut(blend));
      }
      prevStateFn = fn;
      for (var k2 in cur) cur[k2] = damp(cur[k2], target[k2], 5, dt);

      // ---- pat: gentle happy wiggle, no jumping, no squash ----
      if (patT >= 0) {
        patT += dt / 1.8;
        if (patT >= 1) patT = -1;
        else {
          var env = Math.sin(Math.PI * patT);
          cur.roll += 0.06 * Math.sin(TAU * 1.5 * patT) * env;
          cur.breathe *= 1 + 0.02 * env;
          cur.pitch -= 0.03 * env;
        }
      }

      // ---- cursor look-at (whole-body, subtle) ----
      var ly = hovering ? clamp(cursorNdc.x, -1, 1) * 0.15 : 0;
      var lp = hovering ? clamp(-cursorNdc.y, -1, 1) * 0.05 : 0;
      lookYaw = damp(lookYaw, ly, 4, dt);
      lookPitch = damp(lookPitch, lp, 4, dt);

      // ---- breathing & sway ----
      var br = 1 + (cur.breathe - 1) * Math.sin(cur.breathePh + TAU * 0.30 * stateT);
      var sway = cur.swayAmp * Math.sin(TAU * cur.swaySpeed * stateT);

      root.position.y = cur.y * MODEL_SCALE;
      root.rotation.set(cur.pitch + lookPitch, cur.yaw + lookYaw, cur.roll + sway);
      root.scale.set(
        MODEL_SCALE * bootScale * fadeScale / Math.sqrt(br),
        MODEL_SCALE * bootScale * fadeScale * br,
        MODEL_SCALE * bootScale * fadeScale / Math.sqrt(br)
      );

      // ---- heart ----
      if (heartT >= 0) {
        heartT += dt / 1.8;
        if (heartT >= 1) { heartT = -1; heart.scale.setScalar(0.001); }
        else {
          var hs = heartT < 0.2 ? easeOutBack(heartT / 0.2)
            : heartT > 0.75 ? Math.max(0.001, 1 - (heartT - 0.75) / 0.25) : 1;
          heart.scale.setScalar(hs * MODEL_SCALE * 1.6);
          heart.position.y = (2.1 + 0.35 * easeInOut(heartT)) * MODEL_SCALE;
          heart.position.x = (0.55 + 0.05 * Math.sin(TAU * heartT)) * MODEL_SCALE;
          heart.rotation.y = stateT * 1.5;
        }
      }

      // ---- boot / shutdown ----
      if (bootT >= 0) {
        bootT += dt / 0.9;
        if (bootT >= 1) { bootT = -1; bootScale = 1; bootDone.splice(0).forEach(function (r) { r(); }); }
        else bootScale = Math.max(0.001, easeOutBack(bootT));
      }
      if (shutdownT >= 0) {
        shutdownT += dt / 0.8;
        if (shutdownT >= 1) { shutdownT = -1; fadeScale = 0.001; shutdownDone.splice(0).forEach(function (r) { r(); }); }
        else { var q = 1 - shutdownT; fadeScale = q * q; }
      }

      renderer.render(scene, camera);
      reportBounds();
    }

    // ---- bounds & hit test (whole model) ----
    var boundsBox = new THREE.Box3(), bCorners = [], bVec = new THREE.Vector3();
    for (var ci = 0; ci < 8; ci++) bCorners.push(new THREE.Vector3());
    function computeBounds() {
      if (!ready || !model) return null;
      var rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      root.updateWorldMatrix(true, true);
      boundsBox.setFromObject(root);
      var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
      for (var i = 0; i < 8; i++) {
        bCorners[i].set(
          i & 1 ? boundsBox.max.x : boundsBox.min.x,
          i & 2 ? boundsBox.max.y : boundsBox.min.y,
          i & 4 ? boundsBox.max.z : boundsBox.min.z);
        bVec.copy(bCorners[i]).project(camera);
        var px = rect.left + (bVec.x + 1) * rect.width / 2;
        var py = rect.top + (1 - bVec.y) * rect.height / 2;
        if (px < minX) minX = px; if (px > maxX) maxX = px;
        if (py < minY) minY = py; if (py > maxY) maxY = py;
      }
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }
    function reportBounds() {
      if (typeof options.onBodyBoundsChange !== 'function') return;
      var b = computeBounds();
      if (!b) return;
      var key = [b.x, b.y, b.width, b.height].map(Math.round).join(',');
      if (key !== lastBoundsKey) { lastBoundsKey = key; options.onBodyBoundsChange(b); }
    }

    var raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();
    function hitTest(x, y) {
      if (!ready || !model) return false;
      var rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      ndc.set((x - rect.left) / rect.width * 2 - 1, -((y - rect.top) / rect.height * 2 - 1));
      raycaster.setFromCamera(ndc, camera);
      return raycaster.intersectObject(root, true).length > 0;
    }

    rafId = requestAnimationFrame(tick);

    return {
      setState: function (s) {
        if (disposed || preview) return;
        if (!STATES[s]) s = 'idle';
        if (s === state && idleVariant < 0) return;
        prevStateFn = idleVariant === 1 ? STATES.idle_random_1
          : idleVariant === 2 ? STATES.idle_random_2 : STATES[state] || STATES.idle;
        state = s; stateT = 0; blend = 0; idleVariant = -1; idleTimer = 0;
      },
      setDragging: function () {},
      noteInteraction: function () { if (!disposed && patT < 0) { patT = 0; heartT = 0; } },
      noteActivity: function () {},
      playBoot: function () {
        return new Promise(function (resolve) {
          bootDone.push(resolve);
          fadeScale = 1; bootScale = 0.001;
          bootT = ready ? 0 : 0.0001;
        });
      },
      playShutdown: function () {
        return new Promise(function (resolve) {
          shutdownDone.push(resolve);
          shutdownT = 0;
        });
      },
      setCursor: function (x, y, hov) {
        var rect = canvas.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          cursorNdc.x = (x - rect.left) / rect.width * 2 - 1;
          cursorNdc.y = -((y - rect.top) / rect.height * 2 - 1);
        }
        hovering = !!hov;
      },
      getBodyBounds: computeBounds,
      hitTest: hitTest,
      resize: function () { if (!disposed) resize(); },
      refreshDockLayout: function () {},
      dispose: function () {
        disposed = true;
        cancelAnimationFrame(rafId);
        bootDone.splice(0).forEach(function (r) { r(); });
        shutdownDone.splice(0).forEach(function (r) { r(); });
        renderer.dispose();
      }
    };
  }

  window.DaimonPetThree = { mount: mount };
})();
