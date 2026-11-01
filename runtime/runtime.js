/* Fox-slime Three.js pet runtime. Expects global THREE and THREE.GLTFLoader. */
(function () {
  'use strict';

  var GLB_B64 = '__GLB_BASE64__';

  var TAU = Math.PI * 2;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function damp(cur, target, rate, dt) { return lerp(cur, target, 1 - Math.exp(-rate * dt)); }
  function sstep(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function easeOutBack(t) { var c = 1.70158; var u = t - 1; return 1 + (c + 1) * u * u * u + c * u * u; }
  function easeInOut(t) { return t * t * (3 - 2 * t); }

  function basePose() {
    return {
      y: 0, x: 0, sx: 1, sy: 1, sz: 1,
      pitch: 0, roll: 0, yaw: 0,
      earDroop: 0, earWig: 0.25, earBack: 0,
      tailWag: 0.12, tailSpeed: 1.1,
      eyeY: 1, eyeWide: 1,
      pod: 0, podTap: 0,
      fall: 0, happy: 0, sad: 0, yawn: 0
    };
  }

  // Each state returns a pose for time t (seconds inside the state).
  var STATES = {
    idle: function (t, p) {
      var b = Math.sin(TAU * 0.42 * t);
      p.sy = 1 + 0.030 * b; p.sx = 1 - 0.020 * b; p.sz = 1 - 0.020 * b;
      p.tailWag = 0.15; p.tailSpeed = 1.1; p.earWig = 0.3;
    },
    working: function (t, p) {
      var f = 1.15;
      var b = Math.sin(TAU * f * t);
      p.y = 0.028 * Math.max(0, b);
      p.sy = 1 - 0.045 * Math.sin(TAU * f * t + 1.2);
      p.sx = 1 + 0.030 * Math.sin(TAU * f * t + 1.2);
      p.pitch = 0.14;
      p.roll = 0.05 * Math.sin(TAU * 0.55 * t);
      p.tailWag = 0.10; p.tailSpeed = 0.9; p.earWig = 0.15;
    },
    waiting: function (t, p) {
      var c = t % 2.4;
      p.pitch = 0.20; p.eyeWide = 1.15;
      p.pod = sstep(0.05, 0.35, c) * (1 - sstep(1.9, 2.25, c));
      var tap1 = sstep(0.75, 0.85, c) * (1 - sstep(0.95, 1.05, c));
      var tap2 = sstep(1.20, 1.30, c) * (1 - sstep(1.40, 1.50, c));
      p.podTap = Math.max(tap1, tap2);
      p.y = -0.02 * p.podTap;
      p.tailWag = 0.25; p.tailSpeed = 2.2;
      p.earDroop = -0.15;
    },
    failed: function (t, p) {
      var c = t % 3.6;
      p.sad = 1; p.earDroop = 0.9;
      if (c < 0.4) {                       // wobble
        p.roll = 0.10 * Math.sin(TAU * 6 * c);
      } else if (c < 0.9) {                // fall
        var f = easeInOut((c - 0.4) / 0.5);
        p.fall = f; p.roll = 1.30 * f; p.sy = 1 - 0.30 * f; p.sx = 1 + 0.20 * f;
      } else if (c < 1.8) {                // lying flat
        p.fall = 1; p.roll = 1.30; p.x = -0.15;
        var w = Math.sin(TAU * 1.5 * (c - 0.9));
        p.sy = 0.62 + 0.03 * w; p.sx = 1.25;
      } else if (c < 2.7) {                // recover with overshoot
        var r = easeOutBack((c - 1.8) / 0.9);
        p.fall = 1 - clamp(r, 0, 1.15); p.roll = 1.30 * (1 - clamp(r, 0, 1));
        p.x = -0.15 * (1 - clamp(r, 0, 1));
        p.sy = lerp(0.62, 1.06, clamp(r, 0, 1)); p.sx = lerp(1.25, 0.97, clamp(r, 0, 1));
        p.y = 0.06 * clamp(r, 0, 1);
      } else {                             // settle
        var s = (c - 2.7) / 0.9;
        p.sy = lerp(1.06, 1, s); p.sad = 1 - 0.4 * s;
      }
    },
    running_left: function (t, p) { runPose(t, p, -1); },
    running_right: function (t, p) { runPose(t, p, 1); },
    idle_random_1: function (t, p) {       // yawn + stretch
      var c = t % 4.6;
      if (c < 1.0) {
        p.yawn = sstep(0, 0.9, c); p.sy = 1 - 0.10 * p.yawn; p.sx = 1 + 0.07 * p.yawn;
      } else if (c < 2.2) {
        p.yawn = 1; p.sy = 0.90; p.sx = 1.07;
        p.eyeY = 0.08;
      } else if (c < 3.0) {                // stretch up
        var s = easeInOut((c - 2.2) / 0.8);
        p.yawn = 1 - 0.5 * s; p.sy = lerp(0.90, 1.16, s); p.sx = lerp(1.07, 0.92, s);
        p.y = 0.07 * s; p.earDroop = -0.35 * s; p.eyeY = lerp(0.08, 1, s);
      } else if (c < 3.8) {
        var r = easeInOut((c - 3.0) / 0.8);
        p.sy = lerp(1.16, 1, r); p.sx = lerp(0.92, 1, r); p.y = 0.07 * (1 - r);
        p.earDroop = -0.35 * (1 - r); p.yawn = 0.5 * (1 - r);
      }
      p.tailWag = 0.08; p.tailSpeed = 0.8;
    },
    idle_random_2: function (t, p) {       // look around
      var c = t % 4.2;
      if (c < 0.7) p.yaw = 0.55 * easeInOut(c / 0.7);
      else if (c < 1.5) p.yaw = 0.5;
      else if (c < 2.2) p.yaw = lerp(0.5, -0.55, easeInOut((c - 1.5) / 0.7));
      else if (c < 3.0) p.yaw = -0.55;
      else if (c < 3.7) p.yaw = lerp(-0.55, 0, easeInOut((c - 3.0) / 0.7));
      p.tailWag = 0.3; p.tailSpeed = 1.8; p.earWig = 0.5;
    }
  };

  function runPose(t, p, dir) {
    var f = 2.6;
    var ph = TAU * f * t;
    var sn = Math.sin(ph);
    p.y = 0.11 * Math.max(0, sn);
    p.sy = 1 + 0.06 * Math.max(0, sn) - 0.11 * Math.max(0, -sn);
    p.sx = 1 - 0.05 * Math.max(0, sn) + 0.09 * Math.max(0, -sn);
    p.roll = dir * (-0.10 + 0.05 * Math.sin(ph + 1.3));
    p.pitch = 0.09;
    p.yaw = dir * 0.12;
    p.earBack = 0.5; p.earWig = 0.8;
    p.tailWag = 0.35; p.tailSpeed = f * 0.9;
  }

  function mount(canvas, options) {
    options = options || {};
    var preview = options.preview === true;
    var MODEL_SCALE = 0.5; // уменьшенная в 2 раза модель

    var renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setClearColor(0x000000, 0);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    camera.position.set(0, 1.0, 4.9);
    camera.lookAt(0, 0.82, 0);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x664d3a, 0.85));
    var key = new THREE.DirectionalLight(0xffffff, 1.35); key.position.set(2.5, 4.5, 3.5); scene.add(key);
    var fill = new THREE.DirectionalLight(0xffe6cc, 0.45); fill.position.set(-3, 1.6, 2.5); scene.add(fill);
    var rim = new THREE.DirectionalLight(0xffffff, 0.55); rim.position.set(-0.5, 3.5, -4); scene.add(rim);

    var root = null, parts = {}, ready = false;
    var blushMats = [], blushOpacity = 0;
    var heartBase = new THREE.Vector3(), heartT = -1;
    var bootT = -1, shutdownT = -1, bootDone = [], shutdownDone = [];
    var bootScale = 1, fadeScale = 1;

    // animation state
    var state = 'idle', stateT = 0;
    var prevStateFn = STATES.idle, prevStateT = 0, blend = 1; // blend 0..1 into current
    var cur = basePose();
    var patT = -1;                       // one-shot pat overlay
    var idleTimer = 0, idleVariant = -1, idleVariantT = 0;
    var blinkT = 2 + Math.random() * 3, blinkPhase = -1;
    var cursorNdc = { x: 0, y: 0 }, lookYaw = 0, lookPitch = 0, hovering = false;
    var eyeOpenT = 1; // 1 = open shiny anime eyes (default), 0 = happy closed arcs
    var disposed = false, rafId = 0, last = performance.now();
    var lastBoundsKey = '';

    function decodeGlb() {
      var bin = atob(GLB_B64);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes.buffer;
    }

    new THREE.GLTFLoader().parse(decodeGlb(), '', function (gltf) {
      root = gltf.scene;
      scene.add(root);
      ['Body', 'EarL', 'EarR', 'EarTipL', 'EarTipR', 'EarInnerL', 'EarInnerR',
        'EyeL', 'EyeR', 'ArcEyeL', 'ArcEyeR', 'Muzzle', 'Nose', 'Smile',
        'Tail', 'TailTip', 'Pseudopod', 'BlushL', 'BlushR', 'Heart', 'PawL', 'PawR'].forEach(function (n) {
          parts[n] = root.getObjectByName(n);
        });
      // re-author clean local rotations (three.js Y-up space)
      if (parts.EarL) parts.EarL.rotation.set(0, 0, 0.38);
      if (parts.EarR) parts.EarR.rotation.set(0, 0, -0.38);
      if (parts.Tail) parts.Tail.rotation.set(-0.35, 0, -1.0);
      if (parts.Pseudopod) parts.Pseudopod.rotation.set(0.4, 0, 0.9);
      root.traverse(function (o) {
        if (o.isMesh) {
          o.frustumCulled = false;
          if (o.material) {
            o.material.metalness = 0; o.material.transparent = false;
            if (o.material.vertexColors) o.material.color.setRGB(1.0, 0.90, 0.78); // warm tint, keep cream chest light
            if (o.material.name === 'BlushMat') {
              o.material = o.material.clone();
              o.material.transparent = true;
              o.material.opacity = 0;
              blushMats.push(o.material);
            }
          }
        }
      });
      if (parts.Pseudopod) parts.Pseudopod.position.set(-0.92, 0.30, 0.26);
      if (parts.Heart) heartBase.copy(parts.Heart.position);
      ready = true;
      if (bootT >= 0) bootT = 0;         // restart queued boot now that model exists
      resize();
    }, undefined, function (err) {
      console.error('[fox-slime] GLB load failed', err);
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
      if (!ready || !root) { renderer.clear(); return; }

      stateT += dt;
      if (blend < 1) blend = Math.min(1, blend + dt / 0.35); // 350 ms crossfade

      // ---- idle variants ----
      var activeState = state;
      if (!preview && state === 'idle') {
        if (idleVariant < 0) {
          idleTimer += dt;
          if (idleTimer > 7 + Math.random() * 4) {
            idleVariant = Math.random() < 0.5 ? 1 : 2;
            idleVariantT = 0; idleTimer = 0;
          }
        } else {
          idleVariantT += dt;
          var dur = idleVariant === 1 ? 4.6 : 4.2;
          if (idleVariantT >= dur) { idleVariant = -1; idleTimer = 0; }
        }
      } else { idleVariant = -1; idleTimer = 0; }
      var fn = idleVariant === 1 ? STATES.idle_random_1
        : idleVariant === 2 ? STATES.idle_random_2 : STATES[activeState] || STATES.idle;
      var ft = idleVariant > 0 ? idleVariantT : stateT;

      // ---- pose with smooth crossfade between state functions ----
      var target = poseFor(fn, ft);
      if (blend < 1) {
        var from = poseFor(prevStateFn, prevStateT + (stateT)); // keep old phase running
        for (var k in target) target[k] = lerp(from[k], target[k], easeInOut(blend));
      }
      prevStateFn = fn;

      // damp current pose toward target for extra smoothness
      var rate = 14;
      for (var key2 in cur) cur[key2] = damp(cur[key2], target[key2], rate, dt);

      // ---- pat overlay (one-shot, gentle happy reaction — no jumping/squash) ----
      var pat = basePose();
      if (patT >= 0) {
        patT += dt / 1.6;
        if (patT >= 1) { patT = -1; }
        else {
          var pt = patT;
          var env = Math.sin(Math.PI * pt);          // smooth in-out envelope
          cur.roll += 0.09 * Math.sin(TAU * 2 * pt) * env;
          cur.sy *= 1 + 0.035 * env;
          cur.happy = 1; cur.earDroop = -0.45 * env; cur.tailWag = 0.55; cur.tailSpeed = 6;
        }
      }

      // ---- blink ----
      var blinkScale = 1;
      if (blinkPhase < 0) {
        blinkT -= dt;
        if (blinkT <= 0) { blinkPhase = 0; }
      } else {
        blinkPhase += dt / 0.16;
        if (blinkPhase >= 1) { blinkPhase = -1; blinkT = 2.2 + Math.random() * 3.2; }
        else blinkScale = 1 - 0.92 * Math.sin(Math.PI * blinkPhase);
      }

      // ---- cursor look-at ----
      var ly = hovering ? clamp(cursorNdc.x, -1, 1) * 0.22 : 0;
      var lp = hovering ? clamp(-cursorNdc.y, -1, 1) * 0.10 : 0;
      lookYaw = damp(lookYaw, ly, 8, dt);
      lookPitch = damp(lookPitch, lp, 8, dt);

      // ---- apply pose ----
      var fall = cur.fall;
      var happySquint = cur.happy > 0 ? lerp(1, 0.30, cur.happy) : 1;
      var sadScale = lerp(1, 0.78, cur.sad);
      var eyeY = cur.eyeY * blinkScale * happySquint * sadScale;

      root.position.y = cur.y * MODEL_SCALE + 0.30 * fall * MODEL_SCALE;
      root.position.x = cur.x * MODEL_SCALE;
      root.rotation.set(cur.pitch * (1 - fall) + lookPitch, cur.yaw + lookYaw, cur.roll);
      root.scale.set(
        cur.sx * bootScale * fadeScale * MODEL_SCALE,
        cur.sy * bootScale * fadeScale * MODEL_SCALE,
        (cur.sz || 1) * bootScale * fadeScale * MODEL_SCALE
      );

      var wig = Math.sin(TAU * 2.2 * (stateT + idleVariantT)) * cur.earWig;
      if (parts.EarL) parts.EarL.rotation.set(cur.earBack * -0.45, 0, 0.38 + cur.earDroop * 0.95 + wig * 0.10);
      if (parts.EarR) parts.EarR.rotation.set(cur.earBack * -0.45, 0, -(0.38 + cur.earDroop * 0.95 - wig * 0.10));
      if (parts.EarTipL) parts.EarTipL.rotation.set(0, 0, wig * 0.06);
      if (parts.EarTipR) parts.EarTipR.rotation.set(0, 0, wig * 0.06);

      if (parts.Tail) {
        var wag = Math.sin(TAU * cur.tailSpeed * (stateT + idleVariantT)) * cur.tailWag;
        parts.Tail.rotation.set(-0.35 + 0.1 * wag, wag * 0.8, -1.0 + 0.15 * wag);
      }

      // ---- eyes: open shiny anime eyes by default; happy closed arcs on pat/yawn/sad ----
      var wantOpen = (cur.happy > 0.25 || cur.yawn > 0.3 || cur.sad > 0.5) ? 0 : 1;
      eyeOpenT = damp(eyeOpenT, wantOpen, 9, dt);
      var openS = Math.max(0.02, eyeOpenT);
      var arcS = Math.max(0.02, 1 - eyeOpenT);
      var eyeSX = cur.eyeWide * (cur.happy > 0 ? 1.05 : 1);
      ['EyeL', 'EyeR'].forEach(function (n) {   // glow + highlights are children, they inherit
        var o = parts[n]; if (!o) return;
        o.scale.set(eyeSX * openS, Math.max(0.05, eyeY) * openS, openS);
      });
      ['ArcEyeL', 'ArcEyeR'].forEach(function (n) {
        var o = parts[n]; if (!o) return;
        var happyThick = 1 + 0.25 * cur.happy;
        o.scale.set(arcS * (1 + 0.10 * cur.happy), arcS * happyThick, arcS * happyThick);
        o.rotation.z = Math.PI * cur.sad;  // flip arcs into sad "u" shape
      });

      // ---- blush & heart ----
      var blushTarget = (patT >= 0 || hovering) ? 0.75 : 0;
      blushOpacity = damp(blushOpacity, blushTarget, 6, dt);
      for (var bi = 0; bi < blushMats.length; bi++) blushMats[bi].opacity = blushOpacity;
      if (parts.Heart) {
        if (heartT >= 0) {
          heartT += dt / 1.8;
          if (heartT >= 1) { heartT = -1; parts.Heart.scale.setScalar(0.001); }
          else {
            var hs = heartT < 0.2 ? easeOutBack(heartT / 0.2)
              : heartT > 0.78 ? Math.max(0.001, 1 - (heartT - 0.78) / 0.22) : 1;
            parts.Heart.scale.setScalar(hs);
            parts.Heart.position.y = heartBase.y + 0.4 * easeInOut(heartT);
            parts.Heart.position.x = heartBase.x + 0.06 * Math.sin(TAU * 1.5 * heartT);
            parts.Heart.rotation.z = 0.15 * Math.sin(TAU * 2 * heartT);
          }
        }
      }

      if (parts.Pseudopod) {
        var pd = cur.pod;
        var tap = cur.podTap;
        parts.Pseudopod.scale.set(
          Math.max(0.001, pd * (1 + 0.25 * tap)),
          Math.max(0.001, pd * (1 - 0.15 * tap)),
          Math.max(0.001, pd * (1 + 0.25 * tap)));
        parts.Pseudopod.rotation.set(0.4 + 0.55 * tap, 0, 0.9);
      }

      // ---- boot / shutdown ----
      if (bootT >= 0) {
        bootT += dt / 0.85;
        if (bootT >= 1) { bootT = -1; bootScale = 1; bootDone.splice(0).forEach(function (r) { r(); }); }
        else bootScale = Math.max(0.001, easeOutBack(bootT));
      }
      if (shutdownT >= 0) {
        shutdownT += dt / 0.7;
        if (shutdownT >= 1) { shutdownT = -1; fadeScale = 0.001; shutdownDone.splice(0).forEach(function (r) { r(); }); }
        else { var q = 1 - shutdownT; fadeScale = q * q; root.scale.y *= (0.3 + 0.7 * q); }
      }

      renderer.render(scene, camera);
      reportBounds();
    }

    var boundsBox = new THREE.Box3(), bCorners = [], bVec = new THREE.Vector3();
    for (var ci = 0; ci < 8; ci++) bCorners.push(new THREE.Vector3());
    function computeBounds() {
      if (!ready || !root) return null;
      var rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      boundsBoxFromRoot();
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
    function boundsBoxFromRoot() {
      root.updateWorldMatrix(true, true);
      boundsBox.makeEmpty();
      root.traverse(function (o) {
        if (o.isMesh && o.geometry) {
          if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
          var bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
          if (o === parts.Pseudopod && cur.pod < 0.02) return;
          boundsBox.union(bb);
        }
      });
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
      if (!ready || !root) return false;
      var rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      ndc.set((x - rect.left) / rect.width * 2 - 1, -((y - rect.top) / rect.height * 2 - 1));
      raycaster.setFromCamera(ndc, camera);
      var hits = raycaster.intersectObject(root, true);
      for (var i = 0; i < hits.length; i++) {
        if (hits[i].object !== parts.Pseudopod || cur.pod > 0.3) return true;
      }
      return false;
    }

    function playPat() {
      if (patT < 0) { patT = 0; heartT = 0; }
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
      noteInteraction: function () { if (!disposed) playPat(); },
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
