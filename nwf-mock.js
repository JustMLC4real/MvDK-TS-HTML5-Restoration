/* nwf-mock.js
   NWF stub for running Wii U HTML5/NWF titles in a normal browser.*/
(function () {
  "use strict";

  // ---- NWF-MOCK: 60FPS CAP ------------------------------------------------

  // Some NWF titles tie their simulation to requestAnimationFrame() and will run
  // faster on high-refresh monitors (120/144/165Hz). We FORCE rAF to a fixed 60Hz
  // tick, independent of the monitor refresh, by driving frames from setTimeout()
  // (drift-corrected). This is more "hard cap" than throttling via rAF itself.
  (function install60FpsCapHard() {
    try {
      if (window.__nwf60FpsCapInstalled) return;
      window.__nwf60FpsCapInstalled = true;

      const FRAME_MS = 1000 / 60;
      const perfNow = (typeof performance !== "undefined" && performance.now)
        ? () => performance.now()
        : () => Date.now();

      let enabled = true;

      let nextId = 1;
      const cbMap = new Map(); // id -> callback

      let timer = 0;
      let targetReal = 0;
      let simTime = perfNow();

      function clearLoop() {
        if (timer) {
          clearTimeout(timer);
          timer = 0;
        }
      }

      function scheduleLoop() {
        if (timer) return; // Already scheduled
        if (!enabled) { console.warn("[NWF-MOCK] scheduleLoop ignored (enabled=false)"); return; }

        const now = perfNow();
        if (!targetReal) targetReal = now + FRAME_MS;
        const delay = Math.max(0, targetReal - now);
        // console.log("[NWF-MOCK] Scheduling loop in " + delay + "ms");
        timer = setTimeout(loop, delay);
      }

      function loop() {
        timer = 0;
        if (!enabled) return;

        const now = perfNow();
        if (!targetReal) targetReal = now + FRAME_MS;

        // If we were paused / tab slept, resync so we don't try to "catch up" forever.
        if (now - targetReal > FRAME_MS * 10) {
          targetReal = now + FRAME_MS;
          simTime = now;
        }

        // Advance the simulated timeline exactly 1 frame per tick.
        simTime += FRAME_MS;

        // Heartbeat (every ~60 frames)
        if (Math.random() < 0.01) {
          // console.log("[NWF-MOCK] Heartbeat (Game Loop Running)");
        }

        // Snapshot callbacks (match typical rAF behavior: callbacks scheduled for this frame run once)
        // console.log("[NWF-MOCK] Loop Tick. Callbacks pending:", cbMap.size);
        if (cbMap.size) {
          // console.log("[NWF-MOCK] Processing " + cbMap.size + " rAF callbacks...");
          const entries = Array.from(cbMap.entries());
          cbMap.clear();
          for (let i = 0; i < entries.length; i++) {
            const cb = entries[i][1];
            try { cb(simTime); } catch (e) { console.error("[NWF-MOCK] rAF callback error:", e); }
          }
        }

        // Schedule next tick only if something requested another frame.
        // Most game loops re-request inside the callback, so this stays alive naturally.
        if (cbMap.size) {
          targetReal += FRAME_MS;
          scheduleLoop();
        } else {
          // Nothing queued -> stop until the game requests again.
          targetReal = 0;
          clearLoop();
          console.warn("[NWF-MOCK] Game Loop STOPPED (No more rAF callbacks)");
        }
      }

      let __firstFrame = true;
      function wrappedRAF(cb) {
        // console.log("[NWF-MOCK] requestAnimationFrame called");

        // Force system event on first frame if not already fired
        if (__firstFrame && window.nwf && window.nwf.system && window.nwf.system.__inst) {
          __firstFrame = false;
          console.log("[NWF-MOCK] Triggering System Events (Spam Mode)...");
          let spamCount = 0;
          const spammer = setInterval(() => {
            spamCount++;
            if (spamCount > 10) clearInterval(spammer);
            console.log("[NWF-MOCK] Emitting SystemEvent (Attempt " + spamCount + ")");
            const sys = window.nwf.system.__inst;
            sys._emit("OneStep_System_AppStatusChange", { status: "foreground" });
            sys._emit("Native_System_AppStatusChange", { status: "foreground" });
            if (window.nwf.events && window.nwf.events.SystemEvent) {
              try { sys._emit(window.nwf.events.SystemEvent.FOCUS_GAINED, {}); } catch (e) { }
              try { sys._emit(window.nwf.events.SystemEvent.APP_STATUS_CHANGE, { status: "foreground" }); } catch (e) { }
            }
          }, 500);
        }

        if (typeof cb !== "function") cb = function () { };

        // Wrap callback to detect freeze/crash
        const id = nextId++;
        const originalCb = cb;
        const wrappedCb = function (timestamp) {
          // console.log("[NWF-MOCK] Executing Frame Callback ID:", id);
          try {
            originalCb(timestamp);
          } catch (e) {
            console.error("[NWF-MOCK] Frame Callback CRASHED:", e);
            throw e;
          }
          // console.log("[NWF-MOCK] Finished Frame Callback ID:", id);
        };

        cbMap.set(id, wrappedCb);
        scheduleLoop();
        return id;
      }

      function wrappedCAF(id) {
        console.log("[NWF-MOCK] cancelAnimationFrame called for id:", id);
        cbMap.delete(id);
      }

      // Optional runtime toggle for debugging:
      //   window.__nwfSet60FpsCap(true/false)
      window.__nwfSet60FpsCap = function (on) {
        enabled = !!on;
        if (!enabled) {
          cbMap.clear();
          targetReal = 0;
          clearLoop();
        }
      };

      function defineFn(obj, name, fn) {
        try {
          Object.defineProperty(obj, name, { configurable: true, writable: true, value: fn });
        } catch (_) {
          try { obj[name] = fn; } catch (__) { }
        }
      }

      // Patch all common RAF entry points.
      defineFn(window, "requestAnimationFrame", wrappedRAF);
      defineFn(window, "cancelAnimationFrame", wrappedCAF);
      defineFn(window, "webkitRequestAnimationFrame", wrappedRAF);
      defineFn(window, "webkitCancelAnimationFrame", wrappedCAF);
      defineFn(window, "mozRequestAnimationFrame", wrappedRAF);
      defineFn(window, "mozCancelAnimationFrame", wrappedCAF);
      defineFn(window, "msRequestAnimationFrame", wrappedRAF);
      defineFn(window, "msCancelAnimationFrame", wrappedCAF);

      // Also patch the prototype so code that accesses it via prototype still hits the cap.
      if (typeof Window !== "undefined" && Window.prototype) {
        defineFn(Window.prototype, "requestAnimationFrame", wrappedRAF);
        defineFn(Window.prototype, "cancelAnimationFrame", wrappedCAF);
        defineFn(Window.prototype, "webkitRequestAnimationFrame", wrappedRAF);
        defineFn(Window.prototype, "webkitCancelAnimationFrame", wrappedCAF);
        defineFn(Window.prototype, "mozRequestAnimationFrame", wrappedRAF);
        defineFn(Window.prototype, "mozCancelAnimationFrame", wrappedCAF);
        defineFn(Window.prototype, "msRequestAnimationFrame", wrappedRAF);
        defineFn(Window.prototype, "msCancelAnimationFrame", wrappedCAF);
      }

      console.log("[NWF-MOCK] HARD 60FPS cap installed (requestAnimationFrame forced to 60Hz).");
    } catch (e) {
      console.warn("[NWF-MOCK] 60FPS cap install failed:", e);
    }
  })();
  // ------------------------------------------------------------------------



  // ---- Canvas2D Wii U helpers ---------------------------------------------
  // Wii U WebKit (NWF) exposed a few non-standard Canvas2D helpers.
  // This title uses at least ctx.setFillColor() in CutsceneManager.
  (function installCanvas2DHelpers() {
    try {
      const P = (typeof CanvasRenderingContext2D !== "undefined")
        ? CanvasRenderingContext2D.prototype
        : null;
      if (!P) return;

      function toRgba(args) {
        // Accept:
        //  - ("#RRGGBB" | "rgba(...)" | any CSS color string)
        //  - (r,g,b) or (r,g,b,a) with 0..255
        //  - (r,g,b,a) with a in 0..1
        if (args.length === 1 && typeof args[0] === "string") return args[0];
        const r = Number(args[0] ?? 0) | 0;
        const g = Number(args[1] ?? 0) | 0;
        const b = Number(args[2] ?? 0) | 0;
        let a = (args.length >= 4) ? Number(args[3]) : 255;
        if (!Number.isFinite(a)) a = 255;
        // If alpha looks like 0..1, keep it. If 0..255, normalize.
        if (a > 1) a = Math.max(0, Math.min(255, a)) / 255;
        a = Math.max(0, Math.min(1, a));
        return `rgba(${Math.max(0, Math.min(255, r))},${Math.max(0, Math.min(255, g))},${Math.max(0, Math.min(255, b))},${a})`;
      }

      if (typeof P.setFillColor !== "function") {
        P.setFillColor = function (...args) {
          this.fillStyle = toRgba(args);
        };
      }

      if (typeof P.setStrokeColor !== "function") {
        P.setStrokeColor = function (...args) {
          this.strokeStyle = toRgba(args);
        };
      }

      if (typeof P.setLineWidth !== "function") {
        P.setLineWidth = function (w) {
          const v = Number(w);
          if (Number.isFinite(v)) this.lineWidth = v;
        };
      }

      // Used by the title's renderer (InstanceRender / Actor / AnimationCell).
      // Wii U WebKit exposes an instanced draw helper that applies per-instance
      // pivot/scale/rotation and per-instance color/alpha.
      if (typeof P.setImageColor !== "function") {
        P.setImageColor = function (r, g, b, a) {
          const rr = Number(r); const gg = Number(g); const bb = Number(b);
          const aa = (a == null) ? 1 : Number(a);
          this.__nwfImageColor = [
            Number.isFinite(rr) ? rr : 1,
            Number.isFinite(gg) ? gg : 1,
            Number.isFinite(bb) ? bb : 1,
            Number.isFinite(aa) ? aa : 1,
          ];
        };
      }

      if (typeof P.drawImageInstanced !== "function") {
        P.drawImageInstanced = function (count, img, srcRects, dstRects, mat2Ds, colors) {
          count = (count | 0);
          if (!img || !srcRects || !dstRects || count <= 0) return;

          const baseAlpha = this.globalAlpha;
          const baseColor = this.__nwfImageColor || [1, 1, 1, 1];

          // Helper: finite-or-default
          const f = (v, d) => (Number.isFinite(v) ? v : d);

          // Detect whether the currently selected shader is the "parented transform" shader.
          // In real NWF this is a GTX shader that applies uniforms 17/18 (parent transform) to every instance.
          const sm = (typeof lib !== "undefined" && lib.display && lib.display.ShaderManager) ? lib.display.ShaderManager : null;
          const parentShaderId = sm && Number.isFinite(sm.parentedTransform_textureShader_gtx) ? sm.parentedTransform_textureShader_gtx : null;
          const useParent = (parentShaderId != null) && ((this.textureShader | 0) === (parentShaderId | 0));

          // Parent uniforms: 17 = (posX,posY,pivotX,pivotY), 18 = (scaleX,scaleY,rot,saturation)
          const u17 = (this.__nwfVertexUniforms && this.__nwfVertexUniforms[17]) ? this.__nwfVertexUniforms[17] : null;
          const u18 = (this.__nwfVertexUniforms && this.__nwfVertexUniforms[18]) ? this.__nwfVertexUniforms[18] : null;

          const pPosX = useParent ? f(u17 && u17[0], 0) : 0;
          const pPosY = useParent ? f(u17 && u17[1], 0) : 0;
          const pPivotX = useParent ? f(u17 && u17[2], 0) : 0;
          const pPivotY = useParent ? f(u17 && u17[3], 0) : 0;

          let pScaleX = useParent ? f(u18 && u18[0], 1) : 1;
          let pScaleY = useParent ? f(u18 && u18[1], 1) : 1;
          const pRot = useParent ? f(u18 && u18[2], 0) : 0;

          // NWF treats "missing scale" (often encoded as 0) as 1.0
          if (pScaleX === 0) pScaleX = 1;
          if (pScaleY === 0) pScaleY = 1;

          for (let i = 0; i < count; i++) {
            const s4 = i * 4;

            const sx = f(srcRects[s4 + 0], 0);
            const sy = f(srcRects[s4 + 1], 0);
            const sw = f(srcRects[s4 + 2], 0);
            const sh = f(srcRects[s4 + 3], 0);

            let dx = f(dstRects[s4 + 0], 0);
            const dy = f(dstRects[s4 + 1], 0);
            const dw = f(dstRects[s4 + 2], 0);
            const dh = f(dstRects[s4 + 3], 0);


            // Instance transform layout used by this title:
            // - When the parented GTX shader is active (Actor/SharedActor):
            //   [pivotX, pivotY, scaleX, scaleY, rotationRadians, flipX]
            // - Otherwise (AnimationCell / non-parented):
            //   [pivotX, pivotY, scaleX, scaleY, rotationRadians, saturation]
            let pivotX = 0, pivotY = 0, scaleX = 1, scaleY = 1, rot = 0, p5 = 1;
            if (mat2Ds && mat2Ds.length >= (i * 6 + 6)) {
              const s6 = i * 6;
              pivotX = f(mat2Ds[s6 + 0], 0);
              pivotY = f(mat2Ds[s6 + 1], 0);
              scaleX = f(mat2Ds[s6 + 2], 1);
              scaleY = f(mat2Ds[s6 + 3], 1);
              rot = f(mat2Ds[s6 + 4], 0);
              p5 = f(mat2Ds[s6 + 5], 1);
            }

            // NWF default scale is 1, not 0.
            if (scaleX === 0) scaleX = 1;
            if (scaleY === 0) scaleY = 1;

            if (useParent) {
              // Actor/SharedActor path: flip is provided separately (p5).
              let flipX = p5;
              if (flipX === 0) flipX = 1;
              // Wii U shader applies flip to X-translation and rotation sign as well.
              // Without this, multipart rigs (cursed monkey parts) misalign when facing left.
              if (flipX !== 1) {
                dx *= flipX;
                rot *= flipX;
                scaleX *= flipX;
              }
            } else {
              // AnimationCell path: p5 is saturation, not a transform component.
              // Flip is already baked into scaleX and/or rotation by the caller.
            }

            let aMul = 1;
            if (colors && colors.length >= (s4 + 4)) {
              const ca = colors[s4 + 3];
              if (Number.isFinite(ca)) aMul = ca;
            }

            // Apply alpha multiplier.
            this.globalAlpha = baseAlpha * aMul * f(baseColor[3], 1);

            this.save();

            // Reset to identity so transforms never "leak" between instances (fixes flicker/jumps).
            if (typeof this.setTransform === "function") this.setTransform(1, 0, 0, 1, 0, 0);

            // Parent transform (actor-level) when the parented shader is active.
            if (useParent) {
              // NWF-style: world = pos + R*S*(local - pivot)
              this.translate(pPosX, pPosY);
              if (pRot) this.rotate(pRot);
              if (pScaleX !== 1 || pScaleY !== 1) this.scale(pScaleX, pScaleY);
              if (pPivotX || pPivotY) this.translate(-pPivotX, -pPivotY);
            }

            // Instance transform (same convention): local' = R*S*(local - pivot) + pos
            this.translate(dx, dy);
            if (rot) this.rotate(rot);
            if (scaleX !== 1 || scaleY !== 1) this.scale(scaleX, scaleY);
            if (pivotX || pivotY) this.translate(-pivotX, -pivotY);

            try {
              this.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
            } catch (_e) {
              // ignore draw failures
            }

            this.restore();
          }

          this.globalAlpha = baseAlpha;
        };
      }

      // Some code sets this flag on Wii U contexts; allow it.
      if (!('textureShader' in P)) {
        try {
          Object.defineProperty(P, 'textureShader', {
            configurable: true,
            enumerable: false,
            get() { return this.__nwfTextureShader || 0; },
            set(v) { this.__nwfTextureShader = v | 0; }
          });
        } catch (_e) { }
      }
    } catch (_e) {
      // ignore
    }
  })();



  // ---- WebAudio legacy alias (Wii U webkit) ---------------------------------
  // Some games use `webkitAudioContext` (old WebKit name). Modern browsers expose `AudioContext`.
  // If neither exists, we provide a minimal stub so the game can continue without audio.
  (function installWebkitAudioContextPolyfill() {
    try {
      if (typeof window.webkitAudioContext === "undefined") {
        if (typeof window.AudioContext !== "undefined") {
          window.webkitAudioContext = window.AudioContext;

          // Legacy WebAudio method aliases used by older WebKit (Wii U)
          try {
            const ACp = window.AudioContext && window.AudioContext.prototype;
            if (ACp) {
              if (typeof ACp.createGainNode !== "function" && typeof ACp.createGain === "function") {
                ACp.createGainNode = ACp.createGain;
              }
              if (typeof ACp.createJavaScriptNode !== "function" && typeof ACp.createScriptProcessor === "function") {
                ACp.createJavaScriptNode = ACp.createScriptProcessor;
              }
              if (typeof ACp.createOutputDeviceNode !== "function") {
                // Wii U WebKit had output device nodes ("TV", "WII_U_GAMEPAD_0"). In browsers we map this
                // to a GainNode so code can still set .gain.value and connect() it.
                ACp.createOutputDeviceNode = function (deviceName) {
                  const g = (typeof this.createGain === "function")
                    ? this.createGain()
                    : (typeof this.createGainNode === "function")
                      ? this.createGainNode()
                      : { gain: { value: 1 }, connect: function () { }, disconnect: function () { } };

                  try { g._nwfDeviceName = String(deviceName || ""); } catch (e) { }
                  if (typeof g.setDevice !== "function") {
                    g.setDevice = function (name) { try { g._nwfDeviceName = String(name || ""); } catch (e) { } };
                  }
                  return g;
                };
              }

            }
            // BufferSource legacy noteOn/noteOff aliases
            const BSP = (window.AudioBufferSourceNode && window.AudioBufferSourceNode.prototype) || null;
            if (BSP) {
              if (typeof BSP.noteOn !== "function" && typeof BSP.start === "function") BSP.noteOn = BSP.start;
              if (typeof BSP.noteOff !== "function" && typeof BSP.stop === "function") BSP.noteOff = BSP.stop;
            }
          } catch (e) { }

          // decodeAudioData tolerant wrapper:
          // Wii U titles often ship audio in formats browsers can't decode (e.g., DSP/ADPCM),
          // which would normally throw/reject with EncodingError. We fall back to a silent AudioBuffer
          // so the game can keep running (audio may be missing, but no crash/boot-loop).
          try {
            const ACp2 = window.AudioContext && window.AudioContext.prototype;
            if (ACp2 && typeof ACp2.decodeAudioData === "function" && !ACp2.__nwfSafeDecode) {
              const _origDecode = ACp2.decodeAudioData;
              ACp2.decodeAudioData = function (audioData, successCallback, errorCallback) {
                const ctx = this;

                function makeSilentBuffer() {
                  try {
                    const sr = (ctx.sampleRate && isFinite(ctx.sampleRate)) ? ctx.sampleRate : 48000;
                    const len = sr; // 1 second
                    if (typeof ctx.createBuffer === "function") {
                      return ctx.createBuffer(1, len, sr);
                    }
                  } catch (e) { }
                  return null;
                }

                function onOk(buf) {
                  try { if (typeof successCallback === "function") successCallback(buf); } catch (e) { }
                  return buf;
                }

                function onFail(err) {
                  const silent = makeSilentBuffer();
                  if (silent) return onOk(silent);

                  try { if (typeof errorCallback === "function") errorCallback(err); } catch (e) { }
                  throw err;
                }

                const hasCallbacks = (typeof successCallback === "function" || typeof errorCallback === "function");
                if (hasCallbacks) {
                  let ret;
                  try {
                    ret = _origDecode.call(ctx, audioData,
                      function (buf) { try { onOk(buf); } catch (e) { } },
                      function (err) { try { onFail(err); } catch (e) { } }
                    );
                  } catch (err) {
                    try { onFail(err); } catch (e) { }
                    return;
                  }

                  // If browser also returns a Promise, keep it consistent.
                  if (ret && typeof ret.then === "function") {
                    ret.then(onOk).catch(onFail);
                  }
                  return ret;
                }

                // Promise style
                try {
                  return Promise.resolve(_origDecode.call(ctx, audioData)).then(onOk).catch(onFail);
                } catch (err) {
                  try { return Promise.resolve(onFail(err)); } catch (e) { return Promise.reject(err); }
                }
              };
              ACp2.__nwfSafeDecode = true;
            }
          } catch (e) { }

          // Listener legacy setPosition/setOrientation (deprecated in modern browsers)
          try {
            const ALP = (window.AudioListener && window.AudioListener.prototype) || null;
            if (ALP) {
              if (typeof ALP.setPosition !== "function") {
                ALP.setPosition = function (x, y, z) {
                  if (this.positionX) this.positionX.value = x;
                  if (this.positionY) this.positionY.value = y;
                  if (this.positionZ) this.positionZ.value = z;
                };
              }
              if (typeof ALP.setOrientation !== "function") {
                ALP.setOrientation = function (fx, fy, fz, ux, uy, uz) {
                  if (this.forwardX) this.forwardX.value = fx;
                  if (this.forwardY) this.forwardY.value = fy;
                  if (this.forwardZ) this.forwardZ.value = fz;
                  if (this.upX) this.upX.value = ux;
                  if (this.upY) this.upY.value = uy;
                  if (this.upZ) this.upZ.value = uz;
                };
              }
            } else {
              // Some browsers expose these methods directly on context.listener object
              const ctx = window.AudioContext && window.AudioContext.prototype;
              // nothing else to do here
            }

            const PNP = (window.PannerNode && window.PannerNode.prototype) || null;
            if (PNP) {
              if (typeof PNP.setPosition !== "function") {
                PNP.setPosition = function (x, y, z) {
                  if (this.positionX) this.positionX.value = x;
                  if (this.positionY) this.positionY.value = y;
                  if (this.positionZ) this.positionZ.value = z;
                };
              }
              if (typeof PNP.setOrientation !== "function") {
                PNP.setOrientation = function (x, y, z) {
                  if (this.orientationX) this.orientationX.value = x;
                  if (this.orientationY) this.orientationY.value = y;
                  if (this.orientationZ) this.orientationZ.value = z;
                };
              }
            }
          } catch (e) { }

        } else {
          // Minimal stub: enough for constructors + basic calls not to crash.
          window.webkitAudioContext = function MockAudioContext() {
            this.state = "running";
            this.currentTime = 0;
            this.destination = {};
          };
          window.webkitAudioContext.prototype.createGain = function () {
            return { gain: { value: 1 }, connect: function () { }, disconnect: function () { } };
          };

          // legacy aliases
          window.webkitAudioContext.prototype.createGainNode = window.webkitAudioContext.prototype.createGain;
          window.webkitAudioContext.prototype.createOutputDeviceNode = function (deviceName) {
            const g = this.createGain();
            try { g._nwfDeviceName = String(deviceName || ""); } catch (e) { }
            try { g.resetAll = function () { }; } catch (e) { }
            return g;
          };

          window.webkitAudioContext.prototype.createBufferSource = function () {
            return {
              buffer: null, loop: false, resetAll: function () { },
              connect: function () { }, disconnect: function () { }, start: function () { }, stop: function () { }, noteOn: function () { }, noteOff: function () { }
            };
          };
          window.webkitAudioContext.prototype.decodeAudioData = function (_arr, ok, fail) {
            if (typeof ok === "function") ok(null);
            else if (typeof fail === "function") fail(new Error("decodeAudioData not supported in stub"));
          };
          window.webkitAudioContext.prototype.resume = function () { return Promise.resolve(); };
          window.webkitAudioContext.prototype.suspend = function () { return Promise.resolve(); };
          window.webkitAudioContext.prototype.close = function () { return Promise.resolve(); };
        }
      }
    } catch (e) { }
  })();

  const NOOP = function () { };
  const nowISO = () => new Date().toISOString();

  // ---- Browser audio policy + legacy helpers (v1.19) -----------------------
  // Chrome/Edge block autoplay and starting AudioContext until a user gesture.
  // We can't bypass that, but we CAN prevent crashes by:
  //  - swallowing NotAllowedError from play()/resume()
  //  - queueing resume/play until first pointer/keyboard interaction
  (function installAudioUnlockAndLegacyPolyfills() {
    if (window.__nwfAudioUnlockInstalled) return;
    window.__nwfAudioUnlockInstalled = true;

    const contexts = [];
    const pendingMedia = new Set();
    let unlocked = false;

    function markContext(ctx) {
      if (!ctx) return;
      try {
        if (contexts.indexOf(ctx) === -1) contexts.push(ctx);
      } catch (e) { }
      try { if (typeof ctx.resume === "function") ctx.resume().catch(function () { }); } catch (e) { }
    }

    // Wrap AudioContext constructor to track instances (works with `new`)
    try {
      const OrigAC = window.AudioContext || window.webkitAudioContext;
      if (OrigAC && !OrigAC.__nwfWrapped) {
        function WrappedAudioContext() {
          const ctx = new OrigAC(...arguments);
          markContext(ctx);
          return ctx;
        }
        WrappedAudioContext.prototype = OrigAC.prototype;
        try { Object.setPrototypeOf(WrappedAudioContext, OrigAC); } catch (e) { }
        WrappedAudioContext.__nwfWrapped = true;
        WrappedAudioContext.__nwfOrig = OrigAC;
        window.AudioContext = WrappedAudioContext;
        window.webkitAudioContext = WrappedAudioContext;
      }
    } catch (e) { }

    // Swallow NotAllowedError for resume() until unlock
    try {
      const proto = (window.AudioContext && window.AudioContext.prototype) ||
        (window.webkitAudioContext && window.webkitAudioContext.prototype);
      if (proto && typeof proto.resume === "function" && !proto.__nwfSafeResume) {
        const origResume = proto.resume;
        proto.resume = function () {
          try {
            const r = origResume.apply(this, arguments);
            if (r && typeof r.catch === "function") return r.catch(function () { });
            return r;
          } catch (e) {
            return Promise.resolve();
          }
        };
        proto.__nwfSafeResume = true;
      }
    } catch (e) { }

    // Swallow NotAllowedError for play() and retry after unlock
    try {
      const mp = window.HTMLMediaElement && window.HTMLMediaElement.prototype;
      if (mp && typeof mp.play === "function" && !mp.__nwfSafePlay) {
        const origPlay = mp.play;
        mp.play = function () {
          let ret;
          try { ret = origPlay.apply(this, arguments); }
          catch (e) { pendingMedia.add(this); return Promise.resolve(); }

          if (ret && typeof ret.then === "function") {
            return ret.catch(function () {
              pendingMedia.add(this);
              return undefined;
            }.bind(this));
          }
          return ret;
        };
        mp.__nwfSafePlay = true;
      }
    } catch (e) { }

    // Provide resetAll() on real AudioNodes (WiiU API compatibility)
    try {
      const an = window.AudioNode && window.AudioNode.prototype;
      if (an && typeof an.resetAll !== "function") an.resetAll = function () { };
    } catch (e) { }
    try {
      const bs = window.AudioBufferSourceNode && window.AudioBufferSourceNode.prototype;
      if (bs && typeof bs.resetAll !== "function") bs.resetAll = function () { };
    } catch (e) { }
    try {
      const gn = window.GainNode && window.GainNode.prototype;
      if (gn && typeof gn.resetAll !== "function") gn.resetAll = function () { };
    } catch (e) { }

    function unlock() {
      if (unlocked) return;
      unlocked = true;

      for (let i = 0; i < contexts.length; i++) {
        try { if (contexts[i] && contexts[i].resume) contexts[i].resume().catch(function () { }); } catch (e) { }
      }

      try {
        pendingMedia.forEach(function (el) {
          try { if (el && el.play) el.play(); } catch (e) { }
        });
      } catch (e) { }
      pendingMedia.clear();
    }

    window.addEventListener("pointerdown", unlock, { once: true, passive: true });
    window.addEventListener("touchstart", unlock, { once: true, passive: true });
    window.addEventListener("keydown", unlock, { once: true });
  })();


  function log() {
    try { console.log("[NWF-MOCK]", ...arguments); } catch (e) { }
  }

  // ---- SoundPlayer guard ----------------------------------------------------
  // Some titles assume certain arrays exist even when audio decode fails. We patch defensively
  // once SoundPlayer is defined, so missing audio won't crash boot.
  (function installSoundPlayerGuards() {
    let tries = 0;
    const MAX_TRIES = 400;
    const timer = setInterval(function () {
      tries++;
      try {
        const SP = window.SoundPlayer || (window.lib && window.lib.sound && window.lib.sound.SoundPlayer);
        if (SP && SP.prototype && !SP.prototype.__nwfPatched) {
          const orig = SP.prototype.setMusicChannels;
          if (typeof orig === "function") {
            SP.prototype.setMusicChannels = function () {
              try {
                this.musicChannels = this.musicChannels || [];
                this.musicChannelNodes = this.musicChannelNodes || [];
                this.musicBuffers = this.musicBuffers || [];
              } catch (e) { }
              try { return orig.apply(this, arguments); }
              catch (e) {
                try { console.warn("[NWF-MOCK] setMusicChannels guarded:", e); } catch (e2) { }
              }
            };
          }
          SP.prototype.__nwfPatched = true;
          clearInterval(timer);
          return;
        }
      } catch (e) { }
      if (tries >= MAX_TRIES) clearInterval(timer);
    }, 50);
  })();

  // ---- localStorage extras --------------------------------------------------
  try {
    if (window.localStorage && typeof window.localStorage.sync !== "function") {
      window.localStorage.sync = NOOP;
    }
  } catch (e) { }

  // ---- Keep ONE stable nwf object (guard against overwrites) ----------------
  const _nwf = (typeof window !== "undefined" && window.nwf && typeof window.nwf === "object")
    ? window.nwf
    : {};

  try {
    Object.defineProperty(window, "nwf", {
      configurable: false,
      enumerable: true,
      get() { return _nwf; },
      set(v) {
        if (v && typeof v === "object") {
          for (const k in v) _nwf[k] = v[k];
        }
      }
    });
  } catch (e) {
    window.nwf = _nwf;
  }
  try { self.nwf = window.nwf; } catch (e) { }

  // Bump this when shipping new fixes so you can confirm the correct file is loaded.

  if (_nwf.__MOCK_VERSION__ === "1.46") return;

  _nwf.__MOCK__ = true;
  _nwf.__MOCK_VERSION__ = "1.64";

  _nwf.__MOCK_CONFIG__ = _nwf.__MOCK_CONFIG__ || {};
  if (typeof _nwf.__MOCK_CONFIG__.ENABLE_ATLAS_SLICE === "undefined") _nwf.__MOCK_CONFIG__.ENABLE_ATLAS_SLICE = false;

  // Prevent accidental network requests to /null when some code sets img.src = null.
  try {
    if (typeof window !== "undefined" && window.HTMLImageElement && !window.__nwf_imgSrcPatched) {
      const d = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
      if (d && d.set && d.get) {
        Object.defineProperty(HTMLImageElement.prototype, "src", {
          get() { return d.get.call(this); },
          set(v) {
            if (v === null || typeof v === "undefined") return;
            const s = String(v);
            if (!s || s === "null" || s === "undefined") return;
            return d.set.call(this, v);
          }
        });
        window.__nwf_imgSrcPatched = true;
      }
    }
  } catch (e) { }
  _nwf.__BOOT__ = _nwf.__BOOT__ || { started: nowISO(), t0: Date.now() };

  // ---- Mini event emitter ---------------------------------------------------
  function MiniEmitter() { this._listeners = this._listeners || {}; }
  MiniEmitter.prototype.addEventListener = function (type, fn, ctx) {
    if (!this._listeners[type]) this._listeners[type] = [];
    this._listeners[type].push({ fn, ctx: ctx || null });
  };
  MiniEmitter.prototype.removeEventListener = function (type, fn /*, ctx */) {
    const list = this._listeners[type];
    if (!list) return;
    this._listeners[type] = list.filter(x => x.fn !== fn);
  };
  MiniEmitter.prototype.removeAllEventListeners = function () { this._listeners = {}; };
  MiniEmitter.prototype._emit = function (type, evt) {
    const list = this._listeners[type];
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      try { list[i].fn.call(list[i].ctx || null, evt); } catch (e) { }
    }
  };

  // ---- Canvas 2D "WiiU extensions" polyfills --------------------------------
  (function installCanvas2DExtensions() {
    const proto = (typeof CanvasRenderingContext2D !== "undefined") ? CanvasRenderingContext2D.prototype : null;
    if (!proto) return;

    // Shader + uniform stubs (enough for this title)
    // - loadShader(path) returns a stable numeric id per shader path
    // - setVertexUniformFloat / setPixelUniformFloat store uniforms by index on the context
    // - textureShader / patternShader are numeric "active shader" selectors
    (function () {
      const shaderMap = (window.__nwfShaderMap = window.__nwfShaderMap || new Map());
      let nextId = window.__nwfNextShaderId || 1;
      window.__nwfNextShaderId = nextId;

      proto.loadShader = function (path) {
        const p = String(path || "");
        if (shaderMap.has(p)) return shaderMap.get(p);
        const id = window.__nwfNextShaderId++;
        shaderMap.set(p, id);
        return id;
      };

      proto.setVertexUniformFloat = function (index, a, b, c, d) {
        const i = index | 0;
        const arr = [Number(a), Number(b), Number(c), Number(d)];
        this.__nwfVertexUniforms = this.__nwfVertexUniforms || Object.create(null);
        this.__nwfVertexUniforms[i] = arr;
      };

      proto.setPixelUniformFloat = function (index, a, b, c, d) {
        const i = index | 0;
        const arr = [Number(a), Number(b), Number(c), Number(d)];
        this.__nwfPixelUniforms = this.__nwfPixelUniforms || Object.create(null);
        this.__nwfPixelUniforms[i] = arr;
      };

      // Active shaders (numeric ids)
      try {
        Object.defineProperty(proto, "textureShader", {
          configurable: true,
          enumerable: false,
          get() { return this.__nwfTextureShader || 0; },
          set(v) { this.__nwfTextureShader = (v | 0); }
        });
      } catch (e) { }

      try {
        Object.defineProperty(proto, "patternShader", {
          configurable: true,
          enumerable: false,
          get() { return this.__nwfPatternShader || 0; },
          set(v) { this.__nwfPatternShader = (v | 0); }
        });
      } catch (e) { }

      if (!proto.setPixelShader) proto.setPixelShader = NOOP;
      if (!proto.setVertexShader) proto.setVertexShader = NOOP;
    })();
  })();

  // ---- utils ----------------------------------------------------------------
  _nwf.utils = _nwf.utils || {};
  _nwf.utils.log = _nwf.utils.log || function (s) { log(String(s).replace(/\n$/, "")); };

  // ---- events ---------------------------------------------------------------
  _nwf.events = _nwf.events || {};

  _nwf.events.IOEvent = _nwf.events.IOEvent || {
    READ_COMPLETE: "READ_COMPLETE",
    COMPLETE: "READ_COMPLETE",
    SAVE_COMPLETE: "SAVE_COMPLETE",
    ERROR: "ERROR"
  };

  _nwf.events.SystemErrorEvent = _nwf.events.SystemErrorEvent || {
    ERROR: "ERROR",
    CRASH: "CRASH"
  };

  _nwf.events.ControllerEvent = _nwf.events.ControllerEvent || {
    CONTROLLER_CONNECTED: "CONTROLLER_CONNECTED",
    CONTROLLER_DISCONNECTED: "CONTROLLER_DISCONNECTED"
  };

  _nwf.events.SystemEvent = _nwf.events.SystemEvent || {
    FLUSH_STORAGE_COMPLETE: "FLUSH_STORAGE_COMPLETE"
  };

  _nwf.events.MiiverseEvent = _nwf.events.MiiverseEvent || {
    INITIALIZATION_SUCCESS: "INITIALIZATION_SUCCESS",
    INITIALIZATION_FAILED: "INITIALIZATION_FAILED",
    DOWNLOAD_COMMUNITY_SUCCESS: "DOWNLOAD_COMMUNITY_SUCCESS",
    DOWNLOAD_COMMUNITY_FAILED: "DOWNLOAD_COMMUNITY_FAILED",
    DOWNLOAD_USER_DATA_LIST_SUCCESS: "DOWNLOAD_USER_DATA_LIST_SUCCESS",
    DOWNLOAD_USER_DATA_LIST_FAILED: "DOWNLOAD_USER_DATA_LIST_FAILED",
    UPLOAD_POST_SUCCESS: "UPLOAD_POST_SUCCESS",
    UPLOAD_POST_FAILED: "UPLOAD_POST_FAILED",
    DELETE_POST_SUCCESS: "DELETE_POST_SUCCESS",
    DELETE_POST_FAILED: "DELETE_POST_FAILED",
    DOWNLOAD_POST_SUCCESS: "DOWNLOAD_POST_SUCCESS",
    DOWNLOAD_POST_FAILED: "DOWNLOAD_POST_FAILED",
    UPLOAD_COMMENT_SUCCESS: "UPLOAD_COMMENT_SUCCESS",
    UPLOAD_COMMENT_FAILED: "UPLOAD_COMMENT_FAILED",
    DOWNLOAD_COMMENT_SUCCESS: "DOWNLOAD_COMMENT_SUCCESS",
    DOWNLOAD_COMMENT_FAILED: "DOWNLOAD_COMMENT_SUCCESS",
    ADD_EMPATHY_SUCCESS: "ADD_EMPATHY_SUCCESS",
    ADD_EMPATHY_FAILED: "ADD_EMPATHY_FAILED",
    REMOVE_EMPATHY_SUCCESS: "REMOVE_EMPATHY_SUCCESS",
    REMOVE_EMPATHY_FAILED: "REMOVE_EMPATHY_FAILED",
    FOLLOW_USER_SUCCESS: "FOLLOW_USER_SUCCESS",
    FOLLOW_USER_FAILED: "FOLLOW_USER_FAILED",
    UNFOLLOW_USER_SUCCESS: "UNFOLLOW_USER_SUCCESS",
    UNFOLLOW_USER_FAILED: "UNFOLLOW_USER_FAILED"
  };

  _nwf.events.GameServerEvent = _nwf.events.GameServerEvent || {
    DISCONNECTED: "DISCONNECTED",
    LOGIN_SUCCESS: "LOGIN_SUCCESS",
    LOGIN_FAILED: "LOGIN_FAILED"
  };

  _nwf.events.DataStoreEvent = _nwf.events.DataStoreEvent || {
    UPLOAD_DATA_SUCCESS: "UPLOAD_DATA_SUCCESS",
    UPLOAD_DATA_FAILED: "UPLOAD_DATA_FAILED",
    UPDATE_DATA_SUCCESS: "UPDATE_DATA_SUCCESS",
    UPDATE_DATA_FAILED: "UPDATE_DATA_FAILED",
    DELETE_DATA_SUCCESS: "DELETE_DATA_SUCCESS",
    DELETE_DATA_FAILED: "DELETE_DATA_FAILED",
    DOWNLOAD_DATA_SUCCESS: "DOWNLOAD_DATA_SUCCESS",
    DOWNLOAD_DATA_FAILED: "DOWNLOAD_DATA_FAILED",
    DOWNLOAD_BATCH_DATA_SUCCESS: "DOWNLOAD_BATCH_DATA_SUCCESS",
    DOWNLOAD_BATCH_DATA_FAILED: "DOWNLOAD_BATCH_DATA_FAILED",
    SEARCH_SUCCESS: "SEARCH_SUCCESS",
    SEARCH_FAILED: "SEARCH_FAILED",
    RATE_DATA_SUCCESS: "RATE_DATA_SUCCESS",
    RATE_DATA_FAILED: "RATE_DATA_FAILED",
    COMPLETE_SUSPENDED_OBJECT_SUCCESS: "COMPLETE_SUSPENDED_OBJECT_SUCCESS",
    COMPLETE_SUSPENDED_OBJECT_FAILED: "COMPLETE_SUSPENDED_OBJECT_FAILED"
  };

  // ---- system ---------------------------------------------------------------
  _nwf.system = _nwf.system || {};
  _nwf.system.isWiiU = _nwf.system.isWiiU || function () { return true; };

  _nwf.system.WiiURegionCode = _nwf.system.WiiURegionCode || { USA: 0, EUR: 1, JPN: 2 };
  _nwf.system.WiiULanguageCode = _nwf.system.WiiULanguageCode || {
    ENGLISH: 0, FRENCH: 1, SPANISH: 2, GERMAN: 3, ITALIAN: 4,
    DUTCH: 5, PORTUGUESE: 6, RUSSIAN: 7, JAPANESE: 8
  };
  _nwf.system.SystemErrorCode = _nwf.system.SystemErrorCode || { WEBKIT_ASSET_LOAD_FAIL: 1, WEBKIT_MEM_ALLOC_FAIL: 2 };

  // Who launched the title (Miiverse, menu, other applets). Some titles check this.
  _nwf.system.SystemCallerType = _nwf.system.SystemCallerType || {
    CALLER_TYPE_NONE: 0,
    CALLER_TYPE_MIIVERSE: 1
  };


  _nwf.system.Memory = _nwf.system.Memory || {};
  _nwf.system.Memory.setObjectCacheCapacities = _nwf.system.Memory.setObjectCacheCapacities || NOOP;
  _nwf.system.Memory.requestGC = _nwf.system.Memory.requestGC || NOOP;
  _nwf.system.Memory.forceGC = _nwf.system.Memory.forceGC || NOOP;

  _nwf.system.InputFormType = _nwf.system.InputFormType || {
    INPUT_FORM_TYPE_DEFAULT: 0,
    INPUT_FORM_TYPE_PASSWORD: 1,
    INPUT_FORM_TYPE_MONOSPACE: 2
  };

  _nwf.system.Performance = _nwf.system.Performance || {};
  _nwf.system.Performance.elapsedTime = _nwf.system.Performance.elapsedTime || function () {
    return Date.now() - (_nwf.__BOOT__.t0 || Date.now());
  };


  // ---- stats (Wii U WebKit memory stats) -----------------------------------
  _nwf.system.Stats = _nwf.system.Stats || {};

  // Called by ViewStateManager LowMemThreshold checks.
  // We return generous values so the title won't think it's out of memory.
  _nwf.system.Stats.getMemoryAllocSizes = _nwf.system.Stats.getMemoryAllocSizes || function () {
    return {
      wkDefaultMaxAllocSize: 512 * 1024 * 1024,  // 512 MB
      jscDefaultMaxAllocSize: 512 * 1024 * 1024
    };
  };

  _nwf.system.Stats.getMemoryStats = _nwf.system.Stats.getMemoryStats || function (_includeDetailed) {
    return {
      wkDefaultFreeMemory: 1024 * 1024 * 1024,   // 1 GB free
      jscDefaultFreeMemory: 1024 * 1024 * 1024,
      wkDefaultUsedMemory: 128 * 1024 * 1024,
      jscDefaultUsedMemory: 128 * 1024 * 1024
    };
  };

  if (!_nwf.system.__systemInst) {
    const s = new MiniEmitter();
    s.crash = NOOP;
    s.raiseSystemError = function (code, message) {
      s._emit(_nwf.events.SystemErrorEvent.ERROR, { code, message });
    };
    _nwf.system.__systemInst = s;
  }
  _nwf.system.System = _nwf.system.System || {};
  _nwf.system.System.getInstance = _nwf.system.System.getInstance || function () { return _nwf.system.__systemInst; };

  if (!_nwf.system.__wiiuInst) {
    const w = new MiniEmitter();
    w.version = "NWF-MOCK";
    w.homeButtonEnabled = true;
    w.regionCode = _nwf.system.WiiURegionCode.EUR;
    w.languageCode = _nwf.system.WiiULanguageCode.DUTCH;

    // Launch params (used for Miiverse entry checks, etc.)
    // You can simulate Miiverse launch by adding: ?caller=miiverse to the URL.
    w._launchParams = (function () {
      try {
        const q = new URLSearchParams((typeof location !== "undefined" && location.search) ? location.search : "");
        const caller = String(q.get("caller") || "").toLowerCase();
        return {
          caller: (caller === "miiverse") ? _nwf.system.SystemCallerType.CALLER_TYPE_MIIVERSE
            : _nwf.system.SystemCallerType.CALLER_TYPE_NONE
        };
      } catch (e) {
        return { caller: _nwf.system.SystemCallerType.CALLER_TYPE_NONE };
      }
    })();

    w.getLaunchParams = w.getLaunchParams || function () { return w._launchParams; };
    w.setLaunchParams = w.setLaunchParams || function (p) { w._launchParams = p || w._launchParams; };


    // Basic title lifecycle stubs used by some games
    w.returnToMenu = w.returnToMenu || function () {
      try { console.warn("[NWF-MOCK] returnToMenu() called"); } catch (e) { }
      try { alert("returnToMenu() called (mock)"); } catch (e) { }
    };
    w.relaunchTitle = w.relaunchTitle || function () {
      try { console.warn("[NWF-MOCK] relaunchTitle() called"); } catch (e) { }
      try { location.reload(); } catch (e) { }
    };

    w.flushStorageAsync = function () {
      setTimeout(function () {
        w._emit(_nwf.events.SystemEvent.FLUSH_STORAGE_COMPLETE, { ok: true });
      }, 50);
    };

    _nwf.system.__wiiuInst = w;
  }
  _nwf.system.WiiUSystem = _nwf.system.WiiUSystem || {};
  _nwf.system.WiiUSystem.getInstance = _nwf.system.WiiUSystem.getInstance || function () { return _nwf.system.__wiiuInst; };

  // SAFETY PATCH: Ensure flushStorageAsync exists (fixes crash if instance was created early)
  (function () {
    function patchFlush() {
      try {
        var inst = _nwf.system.WiiUSystem.getInstance();
        if (inst && typeof inst.flushStorageAsync !== 'function') {
          console.warn("[NWF-MOCK] Patching missing flushStorageAsync on WiiUSystem instance");
          inst.flushStorageAsync = function () {
            setTimeout(function () {
              if (typeof inst._emit === 'function') {
                inst._emit(_nwf.events.SystemEvent.FLUSH_STORAGE_COMPLETE, { ok: true });
              } else {
                console.warn("[NWF-MOCK] flushStorageAsync: _emit not found on instance");
              }
            }, 50);
          };
        }
      } catch (e) { }
    }
    // Attempt immediately
    patchFlush();
    // And verify periodically to catch race conditions
    var interval = setInterval(patchFlush, 200);
    setTimeout(function () { clearInterval(interval); }, 5000);
  })();

  // ---- display --------------------------------------------------------------
  _nwf.display = _nwf.display || {};

  function MockDisplay(name) {
    this.name = name;
    this._animId = 1;
    this._anims = new Map();
  }
  MockDisplay.prototype.setViewportFilter = NOOP;
  MockDisplay.prototype.setViewport = NOOP;

  MockDisplay.prototype.addAnimation = function (anim, x, y, fadeFrames) {
    const id = this._animId++;
    const rec = {
      anim: anim || null,
      x: (isFinite(Number(x)) ? Number(x) : 0),
      y: (isFinite(Number(y)) ? Number(y) : 0),
      alpha: 1,
      __fadeT: 0,
      __fadeIn: Math.max(0, Number(fadeFrames) || 0),
      __fadeOut: 0,
      __fadingIn: false,
      __fadingOut: false
    };

    if (rec.__fadeIn > 0) {
      rec.alpha = 0;
      rec.__fadingIn = true;
      rec.__fadeT = 0;
    }

    this._anims.set(id, rec);
    return id;
  };

  // Note: some titles pass an extra fade arg; we accept it but only use x/y.
  MockDisplay.prototype.translateAnimation = function (id, x, y /*, fade */) {
    const a = this._anims.get(id);
    if (!a) return;
    if (isFinite(Number(x))) a.x = Number(x);
    if (isFinite(Number(y))) a.y = Number(y);
  };

  // Note: on Wii U this typically fades out before removing. We emulate that when fadeFrames>0.
  MockDisplay.prototype.removeAnimation = function (id, fadeFrames) {
    const a = this._anims.get(id);
    if (!a) return;
    const f = Math.max(0, Number(fadeFrames) || 0);
    if (f > 0) {
      a.__fadingOut = true;
      a.__fadeOut = f;
      a.__fadeT = 0;
    } else {
      this._anims.delete(id);
    }
  };

  // Wii U NWF display API: clear all animations at once (optionally faded)
  MockDisplay.prototype.removeAllAnimations = function (fadeFrames) {
    const f = Math.max(0, Number(fadeFrames) || 0);
    if (!this._anims) return;
    if (f > 0) {
      try {
        this._anims.forEach((rec, id) => {
          if (!rec) return;
          rec.__fadingOut = true;
          rec.__fadeOut = f;
          rec.__fadeT = 0;
        });
      } catch (e) { }
    } else {
      try { this._anims.clear(); } catch (e) { this._anims = new Map(); }
    }
  };


  if (!_nwf.display.__inst) {
    const tv = new MockDisplay("TV");
    const gp = new MockDisplay("GamePad");
    _nwf.display.__inst = {
      getTVDisplay: function () { return tv; },
      getGamePadDisplay: function () { return gp; }
    };
  }
  _nwf.display.DisplayManager = _nwf.display.DisplayManager || {};
  _nwf.display.DisplayManager.getInstance = _nwf.display.DisplayManager.getInstance || function () { return _nwf.display.__inst; };

  // ---- display overlay renderer ---------------------------------------------
  // Many Wii U NWF titles draw "system" loading animations (coins/mini-mario, etc.)
  // via DisplayManager (TV/GamePad). In a normal browser those would be invisible
  // unless we render them. This overlay draws all animations added to the mock
  // displays on top of the game's canvases (if present).
  (function __nwfInstallDisplayOverlayRenderer() {
    const TV_W = 1280, TV_H = 720;
    const GP_W = 854, GP_H = 480;

    const inst = _nwf.display.__inst;
    if (!inst) return;

    const tvDisplay = inst.getTVDisplay();
    const gpDisplay = inst.getGamePadDisplay();

    // Logical (Wii U) coordinate spaces used by DisplayManager animations
    if (tvDisplay) { tvDisplay.__logicalW = TV_W; tvDisplay.__logicalH = TV_H; }
    if (gpDisplay) { gpDisplay.__logicalW = GP_W; gpDisplay.__logicalH = GP_H; }


    // Create overlay canvases and pin them over the most likely TV/GP canvases.
    let tvTarget = null, gpTarget = null;
    let tvOverlay = null, gpOverlay = null;
    let tvCtx = null, gpCtx = null;

    function pickTargets() {
      const list = Array.prototype.slice.call(document.querySelectorAll("canvas") || []);
      if (!list.length) return;

      // Sort by pixel area
      list.sort((a, b) => (b.width * b.height) - (a.width * a.height));

      // Heuristics: TV is biggest 16:9-ish; GP is 854x480-ish.
      tvTarget = list.find(c => c.width >= 1000 && c.height >= 600) || list[0] || null;

      gpTarget = list.find(c =>
        c !== tvTarget &&
        c.width >= 780 && c.width <= 920 &&
        c.height >= 430 && c.height <= 520
      ) || (list.length > 1 ? list[1] : null);
    }

    function ensureOverlay() {
      pickTargets();

      if (tvTarget && !tvOverlay) {
        tvOverlay = document.createElement("canvas");
        tvOverlay.id = "nwf-tv-overlay";
        tvOverlay.style.position = "absolute";
        tvOverlay.style.pointerEvents = "none";
        tvOverlay.style.zIndex = "999999";
        tvOverlay.style.left = "0px";
        tvOverlay.style.top = "0px";
        document.body.appendChild(tvOverlay);
        tvCtx = tvOverlay.getContext("2d");
      }

      if (gpTarget && !gpOverlay) {
        gpOverlay = document.createElement("canvas");
        gpOverlay.id = "nwf-gp-overlay";
        gpOverlay.style.position = "absolute";
        gpOverlay.style.pointerEvents = "none";
        gpOverlay.style.zIndex = "999999";
        gpOverlay.style.left = "0px";
        gpOverlay.style.top = "0px";
        document.body.appendChild(gpOverlay);
        gpCtx = gpOverlay.getContext("2d");
      }

      syncOverlay();
    }

    function syncOne(target, overlay) {
      if (!target || !overlay) return;
      const r = target.getBoundingClientRect();
      const ok = r && isFinite(r.left) && isFinite(r.top) && r.width > 2 && r.height > 2;

      // If the target isn't laid out yet (e.g. during boot), hide overlay and skip drawing
      // to avoid a one-frame "flash" at (0,0).
      overlay.__nwf_ready = !!ok;
      overlay.style.display = ok ? "block" : "none";
      if (!ok) return;

      overlay.style.left = (window.scrollX + r.left) + "px";
      overlay.style.top = (window.scrollY + r.top) + "px";
      overlay.style.width = r.width + "px";
      overlay.style.height = r.height + "px";

      // Match internal resolution to target canvas resolution (not CSS pixels).
      if (overlay.width !== target.width) overlay.width = target.width;
      if (overlay.height !== target.height) overlay.height = target.height;
    }

    function syncOverlay() {
      syncOne(tvTarget, tvOverlay);
      syncOne(gpTarget, gpOverlay);
    }

    window.addEventListener("resize", syncOverlay);
    window.addEventListener("scroll", syncOverlay, { passive: true });

    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

    function drawAnimFrame(ctx, anim, x, y) {
      if (!ctx || !anim) return;

      const img = anim.img;
      if (!img) return;

      const cellW = anim.cellWidth || anim.cellW || 0;
      const cellH = anim.cellHeight || anim.cellH || 0;

      // Frame counter: titles usually set playrate = fps / 60 and call update(1) per tick.
      const t = (anim._t || 0);
      let frameStep = Math.floor(t);

      // If bundle loader returned per-frame canvases, render by indexing.
      if (Array.isArray(img)) {
        const total = img.length || 1;
        const start = (anim.startFrame == null) ? 0 : anim.startFrame;
        const end = (anim.endFrame == null || anim.endFrame === 0) ? (total - 1) : anim.endFrame;
        const len = Math.max(1, (end - start + 1));

        let fi = start + frameStep;
        if (anim.loop) fi = start + ((frameStep % len) + len) % len;
        else fi = clamp(fi, start, end);

        const frame = img[clamp(fi, 0, total - 1)];
        if (!frame) return;

        ctx.drawImage(frame, x, y);
        return;
      }

      // Otherwise treat as sprite sheet (Image or Canvas)
      const w = (img.width || img.naturalWidth || 0);
      const h = (img.height || img.naturalHeight || 0);

      if (cellW > 0 && cellH > 0 && w >= cellW && h >= cellH) {
        const perRow = Math.max(1, Math.floor(w / cellW));
        const rows = Math.max(1, Math.floor(h / cellH));
        const total = Math.max(1, perRow * rows);

        const start = (anim.startFrame == null) ? 0 : anim.startFrame;
        const end = (anim.endFrame == null || anim.endFrame === 0) ? (total - 1) : anim.endFrame;
        const len = Math.max(1, (end - start + 1));

        let fi = start + frameStep;
        if (anim.loop) fi = start + ((frameStep % len) + len) % len;
        else fi = clamp(fi, start, end);

        fi = clamp(fi, 0, total - 1);

        const sx = (fi % perRow) * cellW;
        const sy = Math.floor(fi / perRow) * cellH;

        ctx.drawImage(img, sx, sy, cellW, cellH, x, y, cellW, cellH);
      } else {
        ctx.drawImage(img, x, y);
      }
    }

    function drawDisplay(display, ctx, frameId) {
      if (!display || !ctx) return;
      const canvas = ctx.canvas;

      // If overlay isn't synced to a real target yet, skip drawing (prevents 0,0 flash).
      if (canvas && canvas.__nwf_ready === false) return;

      // Clear in device pixels (reset any transforms first)
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Scale from logical Wii U coords to the actual canvas resolution.
      const lw = Number(display.__logicalW) || canvas.width;
      const lh = Number(display.__logicalH) || canvas.height;
      const sx = canvas.width / lw;
      const sy = canvas.height / lh;

      ctx.save();
      ctx.setTransform(sx, 0, 0, sy, 0, 0);

      // Update and draw all registered animations.
      display._anims && display._anims.forEach(function (rec, id) {
        if (!rec || !rec.anim) return;

        // Fade-in / fade-out emulation (frame-based, like Wii U)
        try {
          if (rec.__fadingIn && rec.__fadeIn > 0) {
            rec.__fadeT = (rec.__fadeT || 0) + 1;
            rec.alpha = Math.min(1, rec.__fadeT / rec.__fadeIn);
            if (rec.alpha >= 0.999) { rec.alpha = 1; rec.__fadingIn = false; }
          }
          if (rec.__fadingOut && rec.__fadeOut > 0) {
            rec.__fadeT = (rec.__fadeT || 0) + 1;
            rec.alpha = Math.max(0, 1 - (rec.__fadeT / rec.__fadeOut));
            if (rec.alpha <= 0.001) {
              display._anims.delete(id);
              return;
            }
          }
        } catch (e) { }

        try {
          // Guard against double-updates in the same frame (e.g. TV + GamePad)
          if (frameId && rec.anim.__nwfLastUpdateFrame === frameId) {
            // already updated this frame
          } else {
            if (typeof rec.anim.update === "function") rec.anim.update(1);
            if (frameId) rec.anim.__nwfLastUpdateFrame = frameId;
          }
        } catch (e) { }

        const x = Number(rec.x);
        const y = Number(rec.y);
        if (!isFinite(x) || !isFinite(y)) return;

        const a = (rec.alpha == null) ? 1 : Number(rec.alpha);
        ctx.globalAlpha = isFinite(a) ? clamp(a, 0, 1) : 1;

        drawAnimFrame(ctx, rec.anim, x, y);

        ctx.globalAlpha = 1;
      });

      ctx.restore();
    }

    let _frameId = 0;
    function tick() {
      _frameId++;
      try { ensureOverlay(); } catch (e) { }
      try { syncOverlay(); } catch (e) { }

      if (tvOverlay && tvCtx) drawDisplay(tvDisplay, tvCtx, _frameId);
      if (gpOverlay && gpCtx) drawDisplay(gpDisplay, gpCtx, _frameId);

      requestAnimationFrame(tick);
    }



    // ---- Mobile "single screen" layout ---------------------------------------
    // On phones/tablets it's nicer to show ONLY the GamePad screen (touch-friendly).
    // We detect "mobile-ish" (touch + mobile UA / small screen) and:
    //  - hide the TV canvas (+ TV overlay)
    //  - center/scale the GamePad canvas to fill the viewport (aspect-correct)
    //  - inject a viewport meta tag (if missing) to reduce browser zoom/scroll
    (function installMobileSingleScreenLayout() {
      try {
        const cfg = _nwf.__MOCK_CONFIG__ = _nwf.__MOCK_CONFIG__ || {};
        // true  = force enabled
        // false = force disabled
        // "auto"= detect (default)
        if (typeof cfg.MOBILE_SINGLE_SCREEN === "undefined") cfg.MOBILE_SINGLE_SCREEN = "auto";

        function isProbablyMobile() {
          try {
            if (cfg.MOBILE_SINGLE_SCREEN === true) return true;
            if (cfg.MOBILE_SINGLE_SCREEN === false) return false;

            const ua = String(navigator.userAgent || "").toLowerCase();
            const mobileUA = /(android|iphone|ipod|ipad|mobile|windows phone|iemobile|opera mini|blackberry|silk|kindle)/.test(ua);
            const touch = ("ontouchstart" in window) || (navigator.maxTouchPoints > 0);
            const w = (window.innerWidth || 0);
            const h = (window.innerHeight || 0);
            const small = Math.min(w, h) <= 900;
            return !!(touch && (mobileUA || small));
          } catch (e) {
            return false;
          }
        }

        function ensureViewportMeta() {
          try {
            if (document.querySelector("meta[name='viewport']")) return;
            if (!document.head) {
              document.addEventListener("DOMContentLoaded", ensureViewportMeta, { once: true });
              return;
            }
            const m = document.createElement("meta");
            m.name = "viewport";
            m.content = "width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover";
            document.head.appendChild(m);
          } catch (e) { }
        }

        function pickCanvases() {
          const list = Array.prototype.slice.call(document.querySelectorAll("canvas") || []);
          if (!list.length) return { tv: null, gp: null };

          list.sort((a, b) => (b.width * b.height) - (a.width * a.height));

          const tv = list.find(c => c.width >= 1000 && c.height >= 600) || list[0] || null;
          const gp = list.find(c =>
            c !== tv &&
            c.width >= 780 && c.width <= 920 &&
            c.height >= 430 && c.height <= 520
          ) || (list.length > 1 ? list[1] : null);

          return { tv, gp };
        }

        function hideTv(tv) {
          try {
            if (tv) {
              tv.style.display = "none";
              tv.style.visibility = "hidden";
              tv.style.pointerEvents = "none";
            }
          } catch (e) { }
          try {
            const tvO = document.getElementById("nwf-tv-overlay");
            if (tvO) tvO.style.display = "none";
          } catch (e) { }
        }

        function applyGpStyles(gp) {
          ensureViewportMeta();

          const root = document.documentElement;
          const body = document.body;
          if (root) {
            root.style.width = "100%";
            root.style.height = "100%";
          }
          if (body) {
            body.style.width = "100%";
            body.style.height = "100%";
            body.style.margin = "0";
            body.style.padding = "0";
            body.style.overflow = "hidden";
            body.style.background = "#000";
          }

          if (!gp) return;

          // Mark for touch mapping helpers
          try { gp.setAttribute("data-nwf-screen", "gamepad"); } catch (e) { }

          const vw = (window.innerWidth || 0);
          const vh = (window.innerHeight || 0);
          const ar = (gp.width && gp.height) ? (gp.width / gp.height) : (854 / 480);

          let w = vw, h = vw / ar;
          if (h > vh) { h = vh; w = vh * ar; }

          gp.style.position = "fixed";
          gp.style.left = "50%";
          gp.style.top = "50%";
          gp.style.transform = "translate(-50%, -50%)";
          gp.style.width = Math.max(1, w) + "px";
          gp.style.height = Math.max(1, h) + "px";
          gp.style.zIndex = "10";

          // Touch UX
          gp.style.touchAction = "none";
          gp.style.userSelect = "none";
          gp.style.webkitUserSelect = "none";

          // Often helps with pixel art scaling
          try { gp.style.imageRendering = "pixelated"; } catch (e) { }
        }

        function applyLayout() {
          if (!isProbablyMobile()) return;

          const c = pickCanvases();
          hideTv(c.tv);
          applyGpStyles(c.gp);

          // Keep GP overlay above GP canvas (it follows via boundingClientRect).
          try {
            const gpO = document.getElementById("nwf-gp-overlay");
            if (gpO) {
              gpO.style.zIndex = "11";
              gpO.style.pointerEvents = "none";
            }
          } catch (e) { }
        }

        // Best-effort fullscreen on first tap (won't work everywhere, but harmless).
        function tryFullscreen(el) {
          try {
            const d = el || document.documentElement;
            const fn = d.requestFullscreen || d.webkitRequestFullscreen || d.msRequestFullscreen;
            if (fn) fn.call(d);
          } catch (e) { }
        }

        // Debug / override knobs
        window.__nwfIsMobileLayout = isProbablyMobile;
        window.__nwfApplyMobileLayout = applyLayout;
        window.__nwfSetMobileSingleScreen = function (v) {
          cfg.MOBILE_SINGLE_SCREEN = v;
          applyLayout();
        };

        if (isProbablyMobile()) {
          // Canvases appear late during boot, so we watch for them.
          try {
            const mo = new MutationObserver(function () { applyLayout(); });
            mo.observe(document.documentElement, { childList: true, subtree: true });
          } catch (e) { }

          window.addEventListener("resize", applyLayout);
          window.addEventListener("orientationchange", applyLayout);
          window.addEventListener("pointerdown", function () { tryFullscreen(document.documentElement); }, { once: true, passive: true });

          applyLayout();
        }
      } catch (e) {
        // ignore
      }
    })();

    requestAnimationFrame(tick);
  })();


  // ---- io -------------------------------------------------------------------
  _nwf.io = _nwf.io || {};

  _nwf.io.IOError = _nwf.io.IOError || {
    ERROR_NONE: 0,
    ERROR_GENERIC: 1,
    ERROR_NOT_FOUND: 2,
    ERROR_IO: 3
  };

  function _lsKey(path) { return "NWF_MOCK::" + String(path); }
  function _trimSlashes(s) { return String(s || "").replace(/^\/+|\/+$/g, ""); }

  function _normalizeDir(p) {
    let s = String(p || "");
    if (!s) return "/";
    s = s.replace(/\\/g, "/");
    if (!s.endsWith("/")) s += "/";
    return s;
  }

  function _dirnameName(dirPath) {
    const p = String(dirPath || "/").replace(/\\/g, "/");
    const t = p.endsWith("/") ? p.slice(0, -1) : p;
    const parts = t.split("/").filter(Boolean);
    return parts.length ? parts[parts.length - 1] : "/";
  }

  function _splitNameExt(fileName) {
    const s = String(fileName || "");
    const base = s.split("/").pop();
    const dot = base.lastIndexOf(".");
    if (dot <= 0 || dot === base.length - 1) return { name: base, ext: "" };
    return { name: base.slice(0, dot), ext: base.slice(dot + 1) };
  }

  function _joinPath(dirSystemPath, fileName) {
    const d = _normalizeDir(dirSystemPath || "/");
    const f = String(fileName || "").replace(/\\/g, "/").replace(/^\/+/, "");
    return d + f;
  }

  // ---- Directory + File -----------------------------------------------------
  (function installDirectoryAndFile() {
    const oldDir = _nwf.io.Directory;

    function Directory(path) {
      this.systemPath = _normalizeDir(path || "/");
      this.directoryName = _dirnameName(this.systemPath);
    }

    Directory.prototype.create = function (name) {
      const n = _trimSlashes(name);
      return new Directory(_joinPath(this.systemPath, n + "/"));
    };

    Directory.prototype.listFiles = function () {
      const out = [];
      const dir = _normalizeDir(this.systemPath);
      const prefix = _lsKey(dir);

      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (!k || !k.startsWith(prefix)) continue;

          const fullPath = k.slice("NWF_MOCK::".length);
          const rest = fullPath.slice(dir.length);

          if (!rest || rest.includes("/")) continue;
          out.push(new _nwf.io.File(rest, this));
        }
      } catch (e) { }
      return out;
    };

    Directory.prototype.listSubDirectories = function () {
      const out = [];
      const seen = new Set();
      const dir = _normalizeDir(this.systemPath);
      const prefix = _lsKey(dir);

      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (!k || !k.startsWith(prefix)) continue;

          const fullPath = k.slice("NWF_MOCK::".length);
          const rest = fullPath.slice(dir.length);
          if (!rest) continue;

          const seg = rest.split("/")[0];
          if (!seg) continue;

          if (!seen.has(seg)) {
            seen.add(seg);
            out.push(new Directory(_joinPath(dir, seg + "/")));
          }
        }
      } catch (e) { }
      return out;
    };

    // Remove a file or (sub)directory from this directory.
    // Wii U NWF exposes Directory.remove(name). The game uses it to delete corrupt save files.
    Directory.prototype.remove = function (name) {
      try {
        // No arg: clear everything under this dir
        if (typeof name === "undefined" || name === null || name === "") {
          const dir = _normalizeDir(this.systemPath);
          const prefix = _lsKey(dir);
          const keys = [];
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith(prefix)) keys.push(k);
          }
          for (let i = 0; i < keys.length; i++) localStorage.removeItem(keys[i]);
          return _nwf.io.IOError.ERROR_NONE;
        }

        const s = String(name).replace(/\\/g, "/");

        // If caller passed a subdir, delete everything under it.
        const looksLikeDir = s.endsWith("/") || (!s.includes(".") && !s.includes("\\") && !s.includes(":"));
        if (looksLikeDir) {
          const subDir = _normalizeDir(_joinPath(this.systemPath, s));
          const prefix = _lsKey(subDir);
          const keys = [];
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith(prefix)) keys.push(k);
          }
          for (let i = 0; i < keys.length; i++) localStorage.removeItem(keys[i]);
          return _nwf.io.IOError.ERROR_NONE;
        }

        // Otherwise treat as a file name inside this directory
        const fullPath = _joinPath(this.systemPath, s.replace(/^\/+/, ""));
        return _nwf.io.File.removeFile(fullPath);
      } catch (e) {
        return _nwf.io.IOError.ERROR_IO;
      }
    };

    _nwf.io.Directory = Directory;

    if (oldDir && typeof oldDir === "object") {
      for (const k in oldDir) {
        try { _nwf.io.Directory[k] = oldDir[k]; } catch (e) { }
      }
    }

    const DEFAULT_SAVE_ACCOUNT = "/mock/save/appAccount/";
    const DEFAULT_SAVE_COMMON = "/mock/save/appCommon/";
    const DEFAULT_APP_ROOT = "/mock/appRoot/";

    _nwf.io.Directory.appAccountSaveDirectory = _nwf.io.Directory.appAccountSaveDirectory || new Directory(DEFAULT_SAVE_ACCOUNT);
    _nwf.io.Directory.appCommonSaveDirectory = _nwf.io.Directory.appCommonSaveDirectory || new Directory(DEFAULT_SAVE_COMMON);
    _nwf.io.Directory.appRootDirectory = _nwf.io.Directory.appRootDirectory || new Directory(DEFAULT_APP_ROOT);

    if (!_nwf.io.File || typeof _nwf.io.File !== "function") {
      _nwf.io.File = function (fileName, dirObj) {
        MiniEmitter.call(this);

        this._dir = (dirObj && typeof dirObj.systemPath === "string") ? dirObj : null;

        const nameStr = String(fileName || "");
        const base = nameStr.split("/").pop();
        const ne = _splitNameExt(base);

        this.fileName = ne.name || base;
        this.fileExtension = ne.ext || "";
        this.exists = false;

        this.systemPath = this._dir
          ? _joinPath(this._dir.systemPath, base)
          : String(fileName || "");

        // NOTE:
        // Many in-game loaders check file.exists synchronously BEFORE calling read/readAsTextureBundle.
        // In a browser we can't sync-check the HTTP server, so for *resource files* we default to exists=true
        // (and let read/readAsTextureBundle report errors asynchronously if needed).
        //
        // For *save files* (our mock save dirs), we keep exists accurate via localStorage.
        try {
          const v = localStorage.getItem(_lsKey(this.systemPath));
          this.exists = (v !== null);
          // Many titles check `file.size` before deciding to read.
          // If it's a localStorage-backed save file, derive size from stored text length.
          this.size = (v !== null) ? String(v).length : 0;
        } catch (e) {
          this.exists = false;
          this.size = 0;
        }

        if (!this.exists) {
          const p = String(this.systemPath || "");
          const isSave = /^\/mock\/save\//.test(p);
          if (!isSave) {
            this.exists = true; // optimistic for packed resources
          }
        }
        // console.log("[NWF-MOCK] New File:", this.systemPath); // too spammy?
      };
      _nwf.io.File.prototype = Object.create(MiniEmitter.prototype);
      _nwf.io.File.prototype.constructor = _nwf.io.File;
    }

    _nwf.io.File.removeFile = _nwf.io.File.removeFile || function (fullPath) {
      const p = String(fullPath || "");
      try {
        const k = _lsKey(p);
        if (localStorage.getItem(k) === null) return _nwf.io.IOError.ERROR_NOT_FOUND;
        localStorage.removeItem(k);
        return _nwf.io.IOError.ERROR_NONE;
      } catch (e) {
        return _nwf.io.IOError.ERROR_IO;
      }
    };

    _nwf.io.File.prototype.read = _nwf.io.File.prototype.read || function () {
      const self = this;
      console.log("[NWF-MOCK] File.read:", self.systemPath);

      function emitBlob(blob) {
        self._emit(_nwf.events.IOEvent.READ_COMPLETE, { target: self, data: blob });
      }

      function emitErr(msg) {
        self._emit(_nwf.events.IOEvent.ERROR, {
          target: self,
          errorID: 997,
          message: msg || ("read failed: " + self.systemPath)
        });
      }

      setTimeout(function () {
        try {
          const txt = localStorage.getItem(_lsKey(self.systemPath));
          if (txt !== null) {
            self.exists = true;
            try { self.size = String(txt).length; } catch (e) { self.size = 0; }
            emitBlob(new Blob([txt], { type: "application/octet-stream" }));
            return;
          }
        } catch (e) { }

        try {
          fetch(self.systemPath, { cache: "no-store" })
            .then(r => {
              if (!r.ok) throw new Error(String(r.status));
              return r.arrayBuffer();
            })
            .then(buf => {
              self.exists = true;
              try { self.size = (buf && buf.byteLength) ? buf.byteLength : 0; } catch (e) { self.size = 0; }
              emitBlob(new Blob([buf], { type: "application/octet-stream" }));
            })
            .catch(() => emitErr("read failed: " + self.systemPath));
        } catch (e) {
          emitErr("read failed: " + self.systemPath);
        }
      }, 0);
    };

    _nwf.io.File.prototype.save = _nwf.io.File.prototype.save || function (data) {
      const self = this;

      function doneStore(text) {
        try {
          localStorage.setItem(_lsKey(self.systemPath), text);
          self.exists = true;
          try { self.size = String(text).length; } catch (e) { self.size = 0; }
          self._emit(_nwf.events.IOEvent.SAVE_COMPLETE, { target: self, data: null });
          return 0;
        } catch (e) {
          self._emit(_nwf.events.IOEvent.ERROR, {
            target: self,
            errorID: 996,
            message: "save failed: " + self.systemPath
          });
          return _nwf.io.IOError.ERROR_IO;
        }
      }

      try {
        if (data instanceof Blob) {
          const r = new FileReader();
          r.onload = function () { doneStore(String(r.result || "")); };
          r.onerror = function () {
            self._emit(_nwf.events.IOEvent.ERROR, {
              target: self,
              errorID: 995,
              message: "save blob read failed: " + self.systemPath
            });
          };
          r.readAsText(data);
          return 0;
        } else if (data instanceof ArrayBuffer) {
          return doneStore(String.fromCharCode.apply(null, new Uint8Array(data)));
        } else if (typeof data === "string") {
          return doneStore(data);
        } else {
          return doneStore(JSON.stringify(data));
        }
      } catch (e) {
        return doneStore(String(data));
      }
    };



    // ---- Texture bundles (GTX/GZip) ------------------------------------------
    // Many Wii U HTML5/NWF titles store textures as GX2Surface inside .gtx (often gzip-compressed).
    // This mock decodes the most common formats used by this title:
    //  - format 26: RGBA8 (unorm)
    //  - format 51: BC3/DXT5
    // Tile mode is assumed to be 4 (2D macro-tiled thin1), which is what this game uses.
    //
    // IMPORTANT:
    // - We keep everything self-contained in this single nwf-mock.js (no external libs required).
    // - Requires a modern browser for gzip (DecompressionStream). If unavailable, you can include pako as fallback.

    const __NWF_TEX_BUNDLE_CACHE = new Map();

    function __nwfNormalizeUrl(path) {
      if (path === null || typeof path === "undefined") return null;
      let p = String(path).replace(/\\/g, "/");
      if (!p || p === "null" || p === "undefined") return null;
      // strip our fake appRoot prefix if present
      p = p.replace(/^\/mock\/appRoot\//, "");
      // allow absolute-ish paths but fetch relative to server root
      p = p.replace(/^\/+/, "");
      return p;
    }

    async function __nwfFetchArrayBuffer(path) {
      const url = __nwfNormalizeUrl(path);
      console.log("[NWF-MOCK] __nwfFetchArrayBuffer:", path, "->", url);
      if (!url) throw new Error("Invalid path for fetch: " + path);
      // Explicitly check for null/undefined strings
      if (url.indexOf("null") !== -1 || url.indexOf("undefined") !== -1) {
        console.error("[NWF-MOCK] __nwfFetchArrayBuffer SUSPICIOUS URL:", url);
      }
      const res = await fetch(url, { cache: "force-cache" });
      if (!res.ok) throw new Error("HTTP " + res.status + " for " + url);
      return await res.arrayBuffer();
    }

    async function __nwfGunzipIfNeeded(arrayBuffer, originalPath) {
      const p = String(originalPath || "").toLowerCase();
      if (!p.endsWith(".gz")) return arrayBuffer;

      // Modern browsers (Chrome/Edge/Firefox) usually support DecompressionStream.
      if (typeof DecompressionStream === "function") {
        const ds = new DecompressionStream("gzip");
        const stream = new Blob([arrayBuffer]).stream().pipeThrough(ds);
        const out = await new Response(stream).arrayBuffer();
        return out;
      }

      // Optional fallback (if user includes pako on the page)
      if (typeof window !== "undefined" && window.pako && typeof window.pako.ungzip === "function") {
        const u8 = new Uint8Array(arrayBuffer);
        const outU8 = window.pako.ungzip(u8);
        return outU8.buffer;
      }

      throw new Error("gzip DecompressionStream not available (include pako or use a modern browser)");
    }

    function __nwfU32BE(u8, off) {
      return ((u8[off] << 24) | (u8[off + 1] << 16) | (u8[off + 2] << 8) | (u8[off + 3])) >>> 0;
    }


    function __nwfParseGTXAll(arrayBuffer) {
      const u8 = new Uint8Array(arrayBuffer);
      if (u8.length < 0x20) throw new Error("GTX too small");

      const magic = String.fromCharCode(u8[0], u8[1], u8[2], u8[3]);
      if (magic !== "Gfx2") throw new Error("Not a GTX (bad magic: " + magic + ")");

      const headerSize = __nwfU32BE(u8, 4);
      let off = headerSize >>> 0;

      /** @type {{surface:any, image:Uint8Array}[]} */
      const pairs = [];
      let currentSurface = null;

      while (
        off + 0x20 <= u8.length &&
        String.fromCharCode(u8[off], u8[off + 1], u8[off + 2], u8[off + 3]) === "BLK{"
      ) {
        const blkHeaderSize = __nwfU32BE(u8, off + 4);
        const blkType = __nwfU32BE(u8, off + 16);     // 0x0b=GX2Surface, 0x0c=image
        const blkDataSize = __nwfU32BE(u8, off + 20);

        const payloadOff = (off + blkHeaderSize) >>> 0;
        const payloadEnd = (payloadOff + blkDataSize) >>> 0;
        if (payloadEnd > u8.length) throw new Error("GTX block overflow");

        const payload = u8.subarray(payloadOff, payloadEnd);

        if (blkType === 0x0b) {
          // GX2Surface is 0x9C bytes (39 u32 BE)
          if (payload.length >= 0x9C) {
            currentSurface = {
              dim: __nwfU32BE(payload, 0x00),
              width: __nwfU32BE(payload, 0x04),
              height: __nwfU32BE(payload, 0x08),
              depth: __nwfU32BE(payload, 0x0c),
              numMips: __nwfU32BE(payload, 0x10),
              format: __nwfU32BE(payload, 0x14),
              aa: __nwfU32BE(payload, 0x18),
              use: __nwfU32BE(payload, 0x1c),
              imageSize: __nwfU32BE(payload, 0x20),
              mipSize: __nwfU32BE(payload, 0x28),
              tileMode: __nwfU32BE(payload, 0x30),
              swizzle: __nwfU32BE(payload, 0x34),
              alignment: __nwfU32BE(payload, 0x38),
              pitch: __nwfU32BE(payload, 0x3c)
            };
          }
        } else if (blkType === 0x0c) {
          // image data for the MOST RECENT surface block
          if (currentSurface) {
            pairs.push({ surface: currentSurface, image: payload });
          }
        }

        off = payloadEnd;
      }

      return pairs;
    }

    function __nwfParseGTX(arrayBuffer) {
      const pairs = __nwfParseGTXAll(arrayBuffer);
      if (!pairs.length) throw new Error("GTX missing GX2Surface/image data block(s)");
      return pairs[0];
    }

    // ---- GX2 tile-mode 4 addressing (macro-tiled thin1) ----------------------
    // Port of the core addressing math from addrlib/decaf for the Wii U's common
    // configuration (2 pipes, 4 banks, 256B pipe interleave).
    // (macro-tiled thin1) ----------------------
    // Port of the core addressing math from addrlib/decaf for the Wii U's common
    // configuration (2 pipes, 4 banks, 256B pipe interleave).
    const __ADDR_M_PIPES = 2;
    const __ADDR_M_BANKS = 4;
    const __ADDR_PIPE_INTERLEAVE_BYTES = 256;

    function __addrBit(v, b) { return (v >>> b) & 1; }

    function __addrPixelIndexWithinMicroTile(x, y, bppBits) {
      // TileType::Displayable (non-depth) ordering
      const x0 = __addrBit(x, 0), x1 = __addrBit(x, 1), x2 = __addrBit(x, 2);
      const y0 = __addrBit(y, 0), y1 = __addrBit(y, 1), y2 = __addrBit(y, 2);

      let pb0, pb1, pb2, pb3, pb4, pb5;

      if (bppBits === 8) {
        pb0 = x0; pb1 = x1; pb2 = x2; pb3 = y1; pb4 = y0; pb5 = y2;
      } else if (bppBits === 16) {
        pb0 = x0; pb1 = x1; pb2 = x2; pb3 = y0; pb4 = y1; pb5 = y2;
      } else if (bppBits === 64) {
        pb0 = x0; pb1 = y0; pb2 = x1; pb3 = x2; pb4 = y1; pb5 = y2;
      } else if (bppBits === 128) {
        pb0 = y0; pb1 = x0; pb2 = x1; pb3 = x2; pb4 = y1; pb5 = y2;
      } else {
        // Default (works for RGBA8 bpp=32 used by this title)
        pb0 = x0; pb1 = x1; pb2 = y0; pb3 = x2; pb4 = y1; pb5 = y2;
      }

      return (pb0 | (pb1 << 1) | (pb2 << 2) | (pb3 << 3) | (pb4 << 4) | (pb5 << 5)) >>> 0;
    }

    function __addrComputePipe(x, y) {
      // M_PIPES=2 => pipeBit0 = y3 ^ x3
      return (__addrBit(y, 3) ^ __addrBit(x, 3)) >>> 0;
    }

    function __addrComputeBank(x, y) {
      // M_BANKS=4, M_PIPES=2
      const ty = (y / __ADDR_M_PIPES) >>> 0;
      const bankBit0 = (__addrBit(ty, 4) ^ __addrBit(x, 3)) >>> 0;
      const bankBit1 = (__addrBit(ty, 3) ^ __addrBit(x, 4)) >>> 0;
      return (bankBit0 | (bankBit1 << 1)) >>> 0;
    }

    function __addrTileMode4_NEW(x, y, bppBits, pitch, heightAligned, surfaceSwizzle) {
      // Deterministic detile address for GX2 tileMode 4 (macro-tiled, thin1) with 2 pipes / 4 banks.
      // This title uses it heavily for UI/actor atlases (RGBA8 + BC1/BC3).
      //
      // We compute a "base" byte address inside the macro-tile, then *replace* bits 8..10
      // with the computed pipe/bank bits (256B pipe interleave; 4 banks => 2 bank bits).
      //
      // The previous implementation mixed units (bytes vs 8-byte groups) and produced
      // unstable pixels (garbage alpha) on many textures -> flicker/missing sprites.

      // Within a micro-tile (8x8), compute element offset.
      const pixelIndex = __addrPixelIndexWithinMicroTile(x, y, bppBits);
      const elemOffset = ((bppBits * pixelIndex) >>> 3) >>> 0; // bytes

      // pipe/bank selection + swizzle
      let pipe = __addrComputePipe(x, y) >>> 0;
      let bank = __addrComputeBank(x, y) >>> 0;

      const pipeSwizzle = (surfaceSwizzle >>> 8) & 1;
      const bankSwizzle = (surfaceSwizzle >>> 9) & 3;
      const swizzle = (pipeSwizzle + (__ADDR_M_PIPES * bankSwizzle)) >>> 0;

      let bankPipe = (pipe + (__ADDR_M_PIPES * bank)) >>> 0;
      bankPipe = (bankPipe ^ swizzle) >>> 0;
      bankPipe = (bankPipe % (__ADDR_M_PIPES * __ADDR_M_BANKS)) >>> 0;

      pipe = (bankPipe % __ADDR_M_PIPES) >>> 0;
      bank = (bankPipe / __ADDR_M_PIPES) >>> 0;

      // macro-tiling (tileMode 4 uses 32x16 pixels for 32bpp; generalized via bppBits)
      const macroTilePitch = 8 * __ADDR_M_BANKS; // 32
      const macroTileHeight = 8 * __ADDR_M_PIPES; // 16

      const macroTilesPerRow = (pitch / macroTilePitch) >>> 0;
      const macroTileBytes = ((macroTileHeight * macroTilePitch * bppBits) >>> 3) >>> 0;

      const macroTileIndexX = (x / macroTilePitch) >>> 0;
      const macroTileIndexY = (y / macroTileHeight) >>> 0;
      const macroTileOffset = (macroTileBytes * (macroTileIndexX + macroTilesPerRow * macroTileIndexY)) >>> 0; // bytes

      // Base address (bytes) inside the surface before pipe/bank bit insertion.
      const base = (macroTileOffset + elemOffset) >>> 0;

      // Replace bits 8..10 (pipe/bank) while keeping the low group (0..7) and the high bits.
      // Group size is 256 bytes => low 8 bits are "offset within group".
      const bankBits = (bank << 9) >>> 0;
      const pipeBits = (pipe << 8) >>> 0;
      return ((base & ~0x7ff) | bankBits | pipeBits | (base & 0xff)) >>> 0;
    }

    function __addrTileMode4_LEGACY(x, y, bppBits, pitch, heightAligned, surfaceSwizzle) {
      // num_group_bits = log2(256) = 8, num_pipe_bits = 1, num_bank_bits = 2
      const groupMask = 0xff;

      const pixelIndex = __addrPixelIndexWithinMicroTile(x, y, bppBits);
      const elemOffset = ((bppBits * pixelIndex) >>> 3) >>> 0;

      // pipe/bank selection and swizzle
      let pipe = __addrComputePipe(x, y) >>> 0;
      let bank = __addrComputeBank(x, y) >>> 0;

      const pipeSwizzle = (surfaceSwizzle >>> 8) & 1;
      const bankSwizzle = (surfaceSwizzle >>> 9) & 3;
      const swizzle = (pipeSwizzle + (__ADDR_M_PIPES * bankSwizzle)) >>> 0;

      // For tileMode 4, rotation = M_PIPES * ((M_BANKS>>1)-1) = 2
      const rotation = 2;
      let bankPipe = (pipe + (__ADDR_M_PIPES * bank)) >>> 0;

      bankPipe = (bankPipe ^ swizzle) >>> 0;
      bankPipe = (bankPipe % (__ADDR_M_PIPES * __ADDR_M_BANKS)) >>> 0;

      pipe = (bankPipe % __ADDR_M_PIPES) >>> 0;
      bank = (bankPipe / __ADDR_M_PIPES) >>> 0;

      // macro-tiling
      const macroTilePitch = 8 * __ADDR_M_BANKS; // 32
      const macroTileHeight = 8 * __ADDR_M_PIPES; // 16

      const macroTilesPerRow = (pitch / macroTilePitch) >>> 0;
      const macroTileBytes = ((macroTileHeight * macroTilePitch * bppBits) >>> 3) >>> 0;

      const macroTileIndexX = (x / macroTilePitch) >>> 0;
      const macroTileIndexY = (y / macroTileHeight) >>> 0;
      const macroTileOffset = (macroTileBytes * (macroTileIndexX + macroTilesPerRow * macroTileIndexY)) >>> 0;

      // For this title, slice/sample are always 0/1; sliceOffset is 0.
      const totalOffset = (elemOffset + (macroTileOffset >>> 3)) >>> 0;

      const offsetHigh = ((totalOffset & ~groupMask) << 3) >>> 0;
      const offsetLow = (totalOffset & groupMask) >>> 0;

      const bankBits = (bank << 9) >>> 0;
      const pipeBits = (pipe << 8) >>> 0;

      return (bankBits | pipeBits | offsetLow | offsetHigh) >>> 0;
    }

    function __nwfSelectTileMode4AddrFn(path, surface) {
      // Some dumps in this title use a slightly different GX2 tileMode4 addressing variant.
      // Empirically:
      //  - layoutData/*, backgroundData/*, stampData/* (menus/title/backgrounds) look correct with the "legacy" mapping (v146)
      //  - actor2dData/* gameplay atlases (mini mario, coins, spikes, etc.) look correct with the "new" mapping (v162+)
      //
      // We pick the mapping per-texture by path prefix + a few known UI atlas exceptions.
      const p = String(path || "").replace(/\\/g, "/").toLowerCase();

      // Legacy groups (title/menu/background/layout)
      if (p.includes("/layoutdata/") || p.includes("/backgrounddata/") || p.includes("/stampdata/")) {
        return __addrTileMode4_LEGACY;
      }

      // UI atlases that still behave like layout textures
      if (
        p.includes("/actor2ddata/wallpaper_") ||
        p.includes("/actor2ddata/snapshot_") ||
        p.includes("/actor2ddata/editor_icons") ||
        p.includes("/actor2ddata/bg_snapshots") ||
        p.includes("/actor2ddata/ui_loadscreen") ||
        // Donkey Kong boss atlases in this title use the legacy tileMode4 variant
        // (otherwise they show up as repeated / shredded strips).
        p.includes("/actor2ddata/circuskong") ||
        p.includes("/actor2ddata/capturekong")
        || p.includes("/actor2ddata/shadow_mini_mario")
      ) {
        return __addrTileMode4_LEGACY;
      }

      // Default: new mapping (actors, gameplay)
      return __addrTileMode4_NEW;
    }



    // ---- BC1 / DXT1 block decode --------------------------------------------
    function __decodeBC1Block(block8) {
      // block layout (DXT1):
      // 0..1 color0 (565 LE), 2..3 color1 (565 LE), 4..7 indices (32 bits LE)
      const c0 = block8[0] | (block8[1] << 8);
      const c1 = block8[2] | (block8[3] << 8);

      const [r0, g0, b0] = __rgb565To888(c0);
      const [r1, g1, b1] = __rgb565To888(c1);

      const colors = new Uint8Array(16); // 4 colors * RGBA
      colors[0] = r0; colors[1] = g0; colors[2] = b0; colors[3] = 255;
      colors[4] = r1; colors[5] = g1; colors[6] = b1; colors[7] = 255;

      if (c0 > c1) {
        colors[8] = ((2 * r0 + r1) / 3) | 0;
        colors[9] = ((2 * g0 + g1) / 3) | 0;
        colors[10] = ((2 * b0 + b1) / 3) | 0;
        colors[11] = 255;
        colors[12] = ((r0 + 2 * r1) / 3) | 0;
        colors[13] = ((g0 + 2 * g1) / 3) | 0;
        colors[14] = ((b0 + 2 * b1) / 3) | 0;
        colors[15] = 255;
      } else {
        // 3-color + transparent
        colors[8] = ((r0 + r1) / 2) | 0;
        colors[9] = ((g0 + g1) / 2) | 0;
        colors[10] = ((b0 + b1) / 2) | 0;
        colors[11] = 255;
        colors[12] = 0; colors[13] = 0; colors[14] = 0; colors[15] = 0;
      }

      const idx = (block8[4] | (block8[5] << 8) | (block8[6] << 16) | (block8[7] << 24)) >>> 0;

      const out = new Uint8Array(4 * 4 * 4);
      for (let i = 0; i < 16; i++) {
        const ci = (idx >>> (2 * i)) & 3;
        out[i * 4 + 0] = colors[ci * 4 + 0];
        out[i * 4 + 1] = colors[ci * 4 + 1];
        out[i * 4 + 2] = colors[ci * 4 + 2];
        out[i * 4 + 3] = colors[ci * 4 + 3];
      }
      return out;
    }

    // ---- BC2 / DXT3 block decode --------------------------------------------
    function __decodeBC2Block(block16) {
      // block layout (DXT3):
      // 0..7 alpha (16x 4-bit values, little-endian, row-major)
      // 8..9 color0 (565 LE), 10..11 color1 (565 LE), 12..15 indices (32 bits LE)
      const out = new Uint8Array(4 * 4 * 4);

      // alpha
      for (let i = 0; i < 16; i++) {
        const byte = block16[(i >> 1)] >>> 0;
        const nibble = (i & 1) ? (byte >>> 4) : (byte & 0x0F);
        out[i * 4 + 3] = (nibble * 17) & 0xFF; // expand 4-bit to 8-bit
      }

      // colors (always 4-color mode in DXT3)
      const c0 = block16[8] | (block16[9] << 8);
      const c1 = block16[10] | (block16[11] << 8);
      const [r0, g0, b0] = __rgb565To888(c0);
      const [r1, g1, b1] = __rgb565To888(c1);

      const colors = new Uint8Array(16);
      colors[0] = r0; colors[1] = g0; colors[2] = b0; colors[3] = 255;
      colors[4] = r1; colors[5] = g1; colors[6] = b1; colors[7] = 255;
      colors[8] = ((2 * r0 + r1) / 3) | 0;
      colors[9] = ((2 * g0 + g1) / 3) | 0;
      colors[10] = ((2 * b0 + b1) / 3) | 0;
      colors[11] = 255;
      colors[12] = ((r0 + 2 * r1) / 3) | 0;
      colors[13] = ((g0 + 2 * g1) / 3) | 0;
      colors[14] = ((b0 + 2 * b1) / 3) | 0;
      colors[15] = 255;

      const idx = (block16[12] | (block16[13] << 8) | (block16[14] << 16) | (block16[15] << 24)) >>> 0;

      for (let i = 0; i < 16; i++) {
        const ci = (idx >>> (2 * i)) & 3;
        out[i * 4 + 0] = colors[ci * 4 + 0];
        out[i * 4 + 1] = colors[ci * 4 + 1];
        out[i * 4 + 2] = colors[ci * 4 + 2];
        // alpha already filled
      }

      return out;
    }

    // ---- BC3 / DXT5 block decode --------------------------------------------
    function __rgb565To888(c) {
      const r = ((c >>> 11) & 0x1f) * 255 / 31;
      const g = ((c >>> 5) & 0x3f) * 255 / 63;
      const b = (c & 0x1f) * 255 / 31;
      return [r | 0, g | 0, b | 0];
    }

    function __decodeBC3Block(block16) {
      // block layout (DXT5):
      // 0: alpha0, 1: alpha1, 2..7 alpha indices (48 bits LE)
      // 8..9 color0 (565 LE), 10..11 color1, 12..15 color indices (32 bits LE)
      const a0 = block16[0], a1 = block16[1];

      // alpha palette
      const alpha = new Array(8);
      alpha[0] = a0; alpha[1] = a1;
      if (a0 > a1) {
        alpha[2] = Math.round((6 * a0 + 1 * a1) / 7);
        alpha[3] = Math.round((5 * a0 + 2 * a1) / 7);
        alpha[4] = Math.round((4 * a0 + 3 * a1) / 7);
        alpha[5] = Math.round((3 * a0 + 4 * a1) / 7);
        alpha[6] = Math.round((2 * a0 + 5 * a1) / 7);
        alpha[7] = Math.round((1 * a0 + 6 * a1) / 7);
      } else {
        alpha[2] = Math.round((4 * a0 + 1 * a1) / 5);
        alpha[3] = Math.round((3 * a0 + 2 * a1) / 5);
        alpha[4] = Math.round((2 * a0 + 3 * a1) / 5);
        alpha[5] = Math.round((1 * a0 + 4 * a1) / 5);
        alpha[6] = 0;
        alpha[7] = 255;
      }

      // alpha indices (48 bits little-endian)
      let alphaBits = 0n;
      for (let i = 0; i < 6; i++) {
        alphaBits |= BigInt(block16[2 + i]) << BigInt(8 * i);
      }

      const c0 = (block16[8] | (block16[9] << 8)) >>> 0;
      const c1 = (block16[10] | (block16[11] << 8)) >>> 0;

      const rgb0 = __rgb565To888(c0);
      const rgb1 = __rgb565To888(c1);

      const colors = new Array(4);
      colors[0] = rgb0;
      colors[1] = rgb1;

      if (c0 > c1) {
        colors[2] = [
          ((2 * rgb0[0] + rgb1[0]) / 3) | 0,
          ((2 * rgb0[1] + rgb1[1]) / 3) | 0,
          ((2 * rgb0[2] + rgb1[2]) / 3) | 0
        ];
        colors[3] = [
          ((rgb0[0] + 2 * rgb1[0]) / 3) | 0,
          ((rgb0[1] + 2 * rgb1[1]) / 3) | 0,
          ((rgb0[2] + 2 * rgb1[2]) / 3) | 0
        ];
      } else {
        colors[2] = [
          ((rgb0[0] + rgb1[0]) / 2) | 0,
          ((rgb0[1] + rgb1[1]) / 2) | 0,
          ((rgb0[2] + rgb1[2]) / 2) | 0
        ];
        colors[3] = [0, 0, 0];
      }

      const colorBits =
        (block16[12] | (block16[13] << 8) | (block16[14] << 16) | (block16[15] << 24)) >>> 0;

      // Output 16 RGBA pixels, row-major (4x4)
      const out = new Uint8ClampedArray(16 * 4);

      for (let i = 0; i < 16; i++) {
        const colorIndex = (colorBits >>> (2 * i)) & 0x03;
        const aIndex = Number((alphaBits >> BigInt(3 * i)) & 0x07n);

        const rgb = colors[colorIndex];
        const o = i * 4;
        out[o + 0] = rgb[0];
        out[o + 1] = rgb[1];
        out[o + 2] = rgb[2];
        out[o + 3] = alpha[aIndex] & 0xff;
      }

      return out;
    }


    function __nwfDecodeSurfaceToCanvas(path, surface, image) {
      const width = (surface.width >>> 0);
      const height = (surface.height >>> 0);
      const __addrT4 = __nwfSelectTileMode4AddrFn(path, surface);

      function placeholderCanvas(w = 1, h = 1) {
        const c = document.createElement("canvas");
        c.width = Math.max(1, w | 0);
        c.height = Math.max(1, h | 0);
        return c;
      }

      if (!width || !height) {
        console.info("[NWF-MOCK] GTX surface has invalid dimensions:", path, surface);
        return placeholderCanvas();
      }

      const fmt = surface.format >>> 0;
      const tileMode = surface.tileMode >>> 0;

      function decodeLinearRGBA8() {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        const imgData = ctx.createImageData(width, height);
        const out = imgData.data;

        const pitchPx = surface.pitch >>> 0; // pixels
        for (let y = 0; y < height; y++) {
          const rowOff = y * pitchPx * 4;
          for (let x = 0; x < width; x++) {
            const src = rowOff + x * 4;
            const dst = (y * width + x) * 4;
            out[dst + 0] = image[src + 0] || 0;
            out[dst + 1] = image[src + 1] || 0;
            out[dst + 2] = image[src + 2] || 0;
            out[dst + 3] = image[src + 3] || 0;
          }
        }
        ctx.putImageData(imgData, 0, 0);
        return canvas;
      }

      function decodeLinearBC(bytesPerBlock, decodeBlockFn) {
        const blocksX = Math.ceil(width / 4);
        const blocksY = Math.ceil(height / 4);

        const pitchBlocks = surface.pitch >>> 0; // blocks
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        const imgData = ctx.createImageData(width, height);
        const out = imgData.data;

        for (let by = 0; by < blocksY; by++) {
          for (let bx = 0; bx < blocksX; bx++) {
            const src = (by * pitchBlocks + bx) * bytesPerBlock;
            const blk = image.subarray(src, src + bytesPerBlock);
            if (blk.length < bytesPerBlock) continue;
            const rgba = decodeBlockFn(blk);
            for (let py = 0; py < 4; py++) {
              for (let px = 0; px < 4; px++) {
                const x = bx * 4 + px;
                const y = by * 4 + py;
                if (x >= width || y >= height) continue;
                const dst = (y * width + x) * 4;
                const s = (py * 4 + px) * 4;
                out[dst + 0] = rgba[s + 0];
                out[dst + 1] = rgba[s + 1];
                out[dst + 2] = rgba[s + 2];
                out[dst + 3] = rgba[s + 3];
              }
            }
          }
        }

        ctx.putImageData(imgData, 0, 0);
        return canvas;
      }

      function decodeTiledRGBA8() {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        const imgData = ctx.createImageData(width, height);
        const out = imgData.data;

        const bppBits = 32;
        const pitch = surface.pitch >>> 0;
        const swizzle = surface.swizzle >>> 0;

        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const addr = __addrT4(x, y, bppBits, pitch, height, swizzle);
            const src = addr;
            const dst = (y * width + x) * 4;
            out[dst + 0] = image[src + 0] || 0;
            out[dst + 1] = image[src + 1] || 0;
            out[dst + 2] = image[src + 2] || 0;
            out[dst + 3] = image[src + 3] || 0;
          }
        }

        ctx.putImageData(imgData, 0, 0);
        return canvas;
      }

      function decodeTiledBC(bytesPerBlock, bppBits, decodeBlockFn) {
        const blocksX = Math.ceil(width / 4);
        const blocksY = Math.ceil(height / 4);

        const pitchBlocks = surface.pitch >>> 0;
        const swizzle = surface.swizzle >>> 0;

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        const imgData = ctx.createImageData(width, height);
        const out = imgData.data;

        for (let by = 0; by < blocksY; by++) {
          for (let bx = 0; bx < blocksX; bx++) {
            const addr = __addrT4(bx, by, bppBits, pitchBlocks, blocksY, swizzle);
            const src = addr;
            const blk = image.subarray(src, src + bytesPerBlock);
            if (blk.length < bytesPerBlock) continue;
            const rgba = decodeBlockFn(blk);
            for (let py = 0; py < 4; py++) {
              for (let px = 0; px < 4; px++) {
                const x = bx * 4 + px;
                const y = by * 4 + py;
                if (x >= width || y >= height) continue;
                const dst = (y * width + x) * 4;
                const s = (py * 4 + px) * 4;
                out[dst + 0] = rgba[s + 0];
                out[dst + 1] = rgba[s + 1];
                out[dst + 2] = rgba[s + 2];
                out[dst + 3] = rgba[s + 3];
              }
            }
          }
        }

        ctx.putImageData(imgData, 0, 0);
        return canvas;
      }

      function decodeLinearRGB565() {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        const imgData = ctx.createImageData(width, height);
        const out = imgData.data;

        const pitchPx = surface.pitch >>> 0; // pixels
        for (let y = 0; y < height; y++) {
          const rowOff = y * pitchPx * 2;
          for (let x = 0; x < width; x++) {
            const src = rowOff + x * 2;
            const v = (image[src + 0] | (image[src + 1] << 8)) >>> 0; // little-endian RGB565
            const r = ((v >> 11) & 0x1F) * 255 / 31;
            const g = ((v >> 5) & 0x3F) * 255 / 63;
            const b = (v & 0x1F) * 255 / 31;
            const dst = (y * width + x) * 4;
            out[dst + 0] = r | 0;
            out[dst + 1] = g | 0;
            out[dst + 2] = b | 0;
            out[dst + 3] = 255;
          }
        }
        ctx.putImageData(imgData, 0, 0);
        return canvas;
      }

      try {
        // Most Wii U UI textures here are tileMode 4 (macro-tiled thin1).
        // tileMode 0/1 behave "linear enough" for our needs.
        const isTiled = (tileMode === 4);

        if (fmt === 7) {
          return decodeLinearRGB565();
        }

        if (fmt === 26) {
          return isTiled ? decodeTiledRGBA8() : decodeLinearRGBA8();
        }

        // 49 = BC1 (DXT1), 51 = BC3 (DXT5). Some layouts use 50/52 variants; treat as BC3.
        if (isTiled) {
          if (fmt === 49) return decodeTiledBC(8, 64, __decodeBC1Block);
          if (fmt === 51 || fmt === 50 || fmt === 52) return decodeTiledBC(16, 128, __decodeBC3Block);
        } else {
          if (fmt === 49) return decodeLinearBC(8, __decodeBC1Block);
          if (fmt === 51 || fmt === 50 || fmt === 52) return decodeLinearBC(16, __decodeBC3Block);
        }

        console.info("[NWF-MOCK] Unsupported GTX surface format:", fmt, "tileMode:", tileMode, "path:", path);
        return placeholderCanvas(width, height);
      } catch (e) {
        console.info("[NWF-MOCK] Failed to decode GTX surface:", path, e);
        return placeholderCanvas(width, height);
      }
    }

    async function __nwfDecodeGtxToCanvas(path, rawArrayBuffer) {
      const buf = await __nwfGunzipIfNeeded(rawArrayBuffer, path);
      const { surface, image } = __nwfParseGTX(buf);
      return __nwfDecodeSurfaceToCanvas(path, surface, image);
    }



    function __nwfNormPathForMatch(p) {
      let s = String(p || "").replace(/\\/g, "/");
      s = s.replace(/^\.\//, "");          // strip leading ./
      s = s.replace(/^\/+/, "");            // strip leading /
      return s.toLowerCase();
    }

    async function __nwfTryBuildFramesFromActor2DJson(gtxPath, atlasCanvas) {
      try {
        if (!_nwf.__MOCK_CONFIG__ || !_nwf.__MOCK_CONFIG__.ENABLE_ATLAS_SLICE) return null;
        const norm = __nwfNormPathForMatch(gtxPath);
        if (!/(^|\/)actor2ddata\//.test(norm)) return null;

        // compute sibling json path
        let jsonPath = String(gtxPath || "");
        jsonPath = jsonPath.replace(/\.gtx\.gz$/i, ".json").replace(/\.gtx$/i, ".json");
        // If caller requested .gtx but we loaded .gtx.gz, normalize:
        if (!/\.json$/i.test(jsonPath)) return null;

        let jsonBuf;
        try {
          const jurl = __nwfNormalizeUrl(jsonPath);
          if (!jurl) return null;
          jsonBuf = await (await fetch(jurl, { cache: "force-cache" })).text();
          if (!jsonBuf) return null;
        } catch (e) {
          return null; // no json, no slicing
        }

        const meta = JSON.parse(jsonBuf);

        // Nintendo actor2d jsons typically: { actorName, imageFile, animations:[{cells:[{size, imageTable:[{x,y}...]}]}...] }
        if (!meta || !Array.isArray(meta.animations) || !meta.animations.length) return null;

        let cell = null;
        for (let a = 0; a < meta.animations.length && !cell; a++) {
          const anim = meta.animations[a];
          if (anim && Array.isArray(anim.cells) && anim.cells.length) {
            for (let c = 0; c < anim.cells.length; c++) {
              const cc = anim.cells[c];
              if (cc && cc.size && Array.isArray(cc.imageTable) && cc.imageTable.length) { cell = cc; break; }
            }
          }
        }
        if (!cell) return null;

        const w = (cell.size && (cell.size.x || cell.size.width)) ? (cell.size.x || cell.size.width) : null;
        const h = (cell.size && (cell.size.y || cell.size.height)) ? (cell.size.y || cell.size.height) : null;
        if (!w || !h) return null;

        const frames = [];
        for (let i = 0; i < cell.imageTable.length; i++) {
          const it = cell.imageTable[i];
          if (!it) continue;
          const sx = it.x | 0;
          const sy = it.y | 0;
          const fc = document.createElement("canvas");
          fc.width = w; fc.height = h;
          const fctx = fc.getContext("2d");
          fctx.drawImage(atlasCanvas, sx, sy, w, h, 0, 0, w, h);
          frames.push(fc);
        }

        return frames.length ? frames : null;
      } catch (e) {
        console.info("[NWF-MOCK] actor2d JSON slicing failed for", gtxPath, e);
        return null;
      }
    }

    async function __nwfLoadTextureBundle(systemPath) {
      const key = String(systemPath || "");

      if (__NWF_TEX_BUNDLE_CACHE.has(key)) return __NWF_TEX_BUNDLE_CACHE.get(key);

      const promise = (async () => {
        const p = String(systemPath || "");
        const lower = p.toLowerCase();

        // PNG fallback (some builds still reference PNGs through the same loader)
        if (/\.(png|jpg|jpeg|webp)$/i.test(lower)) {
          const img = new Image();
          img.crossOrigin = "anonymous";
          const url = __nwfNormalizeUrl(p);
          if (!url) throw new Error("Invalid image path: " + p);
          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = () => reject(new Error("Failed to load image: " + url));
            img.src = url;
          });

          const canvas = document.createElement("canvas");
          canvas.width = img.width;
          canvas.height = img.height;
          canvas.getContext("2d").drawImage(img, 0, 0);
          return [canvas];
        }

        // GTX (possibly .gz). Also try ".gz" if code asks for ".gtx" but dump contains ".gtx.gz".
        let buf;
        let actualPath = p;
        try {
          buf = await __nwfFetchArrayBuffer(p);
        } catch (e1) {
          if (lower.endsWith(".gtx")) {
            actualPath = p + ".gz";
            buf = await __nwfFetchArrayBuffer(actualPath);
          } else {
            throw e1;
          }
        }

        const decompressed = await __nwfGunzipIfNeeded(buf, actualPath);
        const pairs = __nwfParseGTXAll(decompressed);

        if (!pairs.length) {
          throw new Error("No decodeable GX2Surface/image pairs in GTX: " + actualPath);
        }

        const canvases = [];
        for (let i = 0; i < pairs.length; i++) {
          const pair = pairs[i];
          canvases.push(__nwfDecodeSurfaceToCanvas(actualPath + "#" + i, pair.surface, pair.image));
        }

        // actor2dData atlases often require slicing into per-frame canvases for animations (coins/mini-mario).
        // Only attempt for actor2dData; layoutData uses other metadata.
        const sliced = await __nwfTryBuildFramesFromActor2DJson(actualPath, canvases[0]);
        if (sliced && sliced.length) return sliced;

        return canvases;
      })();

      __NWF_TEX_BUNDLE_CACHE.set(key, promise);
      return promise;
    }


    _nwf.io.File.prototype.readAsTextureBundle = function () {
      const self = this;

      // Keep async contract the NWF runtime expects: emit READ_COMPLETE/ERROR.
      (async function () {
        try {
          const canvases = await __nwfLoadTextureBundle(self.systemPath);
          self._emit(_nwf.events.IOEvent.READ_COMPLETE, {
            target: self,
            data: canvases
          });
        } catch (err) {
          console.info("[NWF-MOCK] readAsTextureBundle failed:", self.systemPath, err);
          // Don't hard-fail the title; provide a harmless placeholder and let it continue.
          const c = document.createElement("canvas");
          c.width = 1; c.height = 1;
          self._emit(_nwf.events.IOEvent.READ_COMPLETE, { target: self, data: [c] });
        }
      })();
    };


  })();

  // ---- input ----------------------------------------------------------------
  _nwf.input = _nwf.input || {};

  _nwf.input.ControllerButton = _nwf.input.ControllerButton || {};
  const btn = _nwf.input.ControllerButton;
  const ensureBtn = (k, v) => { if (typeof btn[k] === "undefined") btn[k] = v; };

  ensureBtn("GAMEPAD_A", 0); ensureBtn("GAMEPAD_B", 1); ensureBtn("GAMEPAD_X", 2); ensureBtn("GAMEPAD_Y", 3);
  ensureBtn("GAMEPAD_L", 4); ensureBtn("GAMEPAD_R", 5); ensureBtn("GAMEPAD_ZL", 6); ensureBtn("GAMEPAD_ZR", 7);
  ensureBtn("GAMEPAD_LEFT", 8); ensureBtn("GAMEPAD_RIGHT", 9); ensureBtn("GAMEPAD_UP", 10); ensureBtn("GAMEPAD_DOWN", 11);
  ensureBtn("GAMEPAD_PLUS", 12); ensureBtn("GAMEPAD_MINUS", 13);
  ensureBtn("GAMEPAD_L_STICK", 14); ensureBtn("GAMEPAD_R_STICK", 15);

  _nwf.input.WiiRemote = _nwf.input.WiiRemote || { REMOTE_1: 0, REMOTE_2: 1, REMOTE_3: 2, REMOTE_4: 3 };

  _nwf.input.control = _nwf.input.control || {};
  _nwf.input.control.TouchControl = _nwf.input.control.TouchControl || { TOUCH_VALID: 1, TOUCH_INVALID_XY: 0 };

  if (!_nwf.input.__controller0) {
    const c = new MiniEmitter();
    c.connected = true;
    c.buttons = { buttonValue: 0 };
    c.touchPanel = {
      touch: _nwf.input.control.TouchControl.TOUCH_INVALID_XY,
      screenX: 0,
      screenY: 0,
      setScreenResolution: NOOP
    };
    // Analog sticks (some titles read movementX/movementY)
    c.leftStick = { movementX: 0, movementY: 0 };
    c.rightStick = { movementX: 0, movementY: 0 };
    setTimeout(function () {
      c._emit(_nwf.events.ControllerEvent.CONTROLLER_CONNECTED, { controllerId: 0 });
    }, 0);
    _nwf.input.__controller0 = c;
  }
  _nwf.input.WiiUGamePad = _nwf.input.WiiUGamePad || {};
  _nwf.input.WiiUGamePad.getController = _nwf.input.WiiUGamePad.getController || function () { return _nwf.input.__controller0; };

  _nwf.input.SoftwareKeyboard = _nwf.input.SoftwareKeyboard || {};
  _nwf.input.SoftwareKeyboard.USER_OK = 0;
  _nwf.input.SoftwareKeyboard.USER_CANCEL = 1;
  _nwf.input.SoftwareKeyboard.INPUT_FORM_TYPE_MONOSPACE = 2;

  _nwf.input.SoftwareKeyboardInvalidChars = _nwf.input.SoftwareKeyboardInvalidChars || {
    INVALID_CHAR_LINEFEED: 1 << 0,
    INVALID_CHAR_ATMARK: 1 << 1
  };
  _nwf.input.SoftwareKeyboardFlags = _nwf.input.SoftwareKeyboardFlags || {
    FLAG_ALL: 0xFFFF,
    FLAG_HAND: 1 << 0
  };

  _nwf.input.SoftwareKeyboard.invoke = _nwf.input.SoftwareKeyboard.invoke || function (completeCb, settings, validateCb) {
    setTimeout(function () {
      let text = "";
      try { text = window.prompt("Enter:", (settings && settings.text) ? String(settings.text) : "") || ""; }
      catch (e) { completeCb({ user_select: _nwf.input.SoftwareKeyboard.USER_CANCEL, text: "" }); return; }

      if (validateCb) {
        try { if (!validateCb(text)) { completeCb({ user_select: _nwf.input.SoftwareKeyboard.USER_CANCEL, text }); return; } }
        catch (e) { }
      }
      completeCb({ user_select: _nwf.input.SoftwareKeyboard.USER_OK, text });
    }, 0);
  };

  // ---- mii ------------------------------------------------------------------
  _nwf.mii = _nwf.mii || {};
  _nwf.mii.MiiExpression = _nwf.mii.MiiExpression || {
    NORMAL: 0, HAPPY: 1, ANGRY: 2, SAD: 3, SURPRISED: 4
  };

  // ---- ui -------------------------------------------------------------------
  _nwf.ui = _nwf.ui || {};
  _nwf.ui.InputFormType = _nwf.ui.InputFormType || _nwf.system.InputFormType;

  _nwf.ui.Dialog = _nwf.ui.Dialog || function () {
    this.isOpen = false;
    this._title = "";
    this._text = "";
  };

  _nwf.ui.Dialog.prototype.open = _nwf.ui.Dialog.prototype.open || function () { this.isOpen = true; };
  _nwf.ui.Dialog.prototype.close = _nwf.ui.Dialog.prototype.close || function () { this.isOpen = false; };
  _nwf.ui.Dialog.prototype.setText = _nwf.ui.Dialog.prototype.setText || function (t) { this._text = String(t ?? ""); };
  _nwf.ui.Dialog.prototype.setTitle = _nwf.ui.Dialog.prototype.setTitle || function (t) { this._title = String(t ?? ""); };

  // v1.10: The game expects these
  _nwf.ui.Dialog.prototype.displaySystemError = _nwf.ui.Dialog.prototype.displaySystemError || function () {
    // Typical patterns: (code, message) OR ({code, message}) OR (message)
    let code = null;
    let message = "";

    if (arguments.length === 1 && arguments[0] && typeof arguments[0] === "object") {
      code = ("code" in arguments[0]) ? arguments[0].code : null;
      message = ("message" in arguments[0]) ? arguments[0].message : String(arguments[0]);
    } else if (arguments.length >= 2) {
      code = arguments[0];
      message = String(arguments[1] ?? "");
    } else if (arguments.length === 1) {
      message = String(arguments[0] ?? "");
    }

    const title = (code !== null && code !== undefined)
      ? ("System Error (" + code + ")")
      : "System Error";

    try { this.setTitle(title); } catch (e) { }
    try { this.setText(message); } catch (e) { }
    try { this.open(); } catch (e) { }

    // visible feedback in browser
    try { console.error("[SYSTEM ERROR]", title, message); } catch (e) { }
    try { if (message) alert(title + "\n\n" + message); else alert(title); } catch (e) { }

    // Some implementations return something; keep truthy.
    return true;
  };

  _nwf.ui.Dialog.prototype.displayFatalError = _nwf.ui.Dialog.prototype.displayFatalError || function () {
    // Alias used by some titles
    return this.displaySystemError.apply(this, arguments);
  };



  // v1.10+ hotfix: some titles call these as STATIC functions on nwf.ui.Dialog
  // (e.g. ErrorManager.js: this._Dialog = nwf.ui.Dialog; this._Dialog.displaySystemError(...))
  // Provide a simple static dialog system + DISPLAY_* constants + closeDialog().
  (function installStaticDialogAPI() {
    const DialogCtor = _nwf.ui.Dialog;

    if (!DialogCtor) return;

    // display mask constants (bitmask on Wii U; here just placeholders)
    if (typeof DialogCtor.DISPLAY_TV === "undefined") DialogCtor.DISPLAY_TV = 1;
    if (typeof DialogCtor.DISPLAY_DRC === "undefined") DialogCtor.DISPLAY_DRC = 2; // GamePad
    if (typeof DialogCtor.DISPLAY_ALL === "undefined") DialogCtor.DISPLAY_ALL = DialogCtor.DISPLAY_TV | DialogCtor.DISPLAY_DRC;

    // internal registry of open dialogs
    const reg = DialogCtor.__mockRegistry || { nextId: 1, open: new Map() };
    DialogCtor.__mockRegistry = reg;

    function _safeCall(cb, obj) {
      try { if (typeof cb === "function") cb(obj); } catch (e) { }
    }

    function _closeOne(id) {
      const rec = reg.open.get(id);
      if (!rec) return;
      reg.open.delete(id);
      // mimic "user dismissed dialog"
      _safeCall(rec.callback, { result: 0, dialogId: id });
    }

    // Close a specific dialog id, or all if no id passed.
    DialogCtor.closeDialog = DialogCtor.closeDialog || function (dialogId) {
      if (typeof dialogId === "number") {
        _closeOne(dialogId);
        return;
      }
      // close all
      try {
        const ids = Array.from(reg.open.keys());
        for (let i = 0; i < ids.length; i++) _closeOne(ids[i]);
      } catch (e) { }
    };

    // STATIC: displaySystemError(callback, errorCode, displayMask, pauseWebKit)
    DialogCtor.displaySystemError = DialogCtor.displaySystemError || function (callback, errorCode, display, pauseWebKit) {
      const id = reg.nextId++;
      reg.open.set(id, { callback: callback || null });

      // Build a message (titles often pass numeric codes)
      const code = (errorCode !== undefined && errorCode !== null) ? String(errorCode) : "";
      const msg = code ? ("System Error Code: " + code) : "System Error";

      try { console.error("[SYSTEM ERROR]", { id, errorCode, display, pauseWebKit }); } catch (e) { }

      // Show something user-visible, then resolve callback
      setTimeout(function () {
        try { alert(msg); } catch (e) { }
        _closeOne(id);
      }, 0);

      return id;
    };

    // STATIC alias used by some titles
    DialogCtor.displayFatalError = DialogCtor.displayFatalError || function () {
      return DialogCtor.displaySystemError.apply(DialogCtor, arguments);
    };
  })();
  // Dialog mock (stub)
  _nwf.ui.Dialog = _nwf.ui.Dialog || function Dialog() {
    console.log("[NWF-MOCK] new ui.Dialog() created");
    this.show = function () { console.log("[NWF-MOCK] Dialog.show()"); return true; };
    this.hide = function () { console.log("[NWF-MOCK] Dialog.hide()"); return true; };
    this.setButtonEnabled = function () { };
    this.setButtonFocus = function () { };
    this.setText = function (txt) { console.log("[NWF-MOCK] Dialog.setText:", txt); };
    this.setTitle = function (txt) { console.log("[NWF-MOCK] Dialog.setTitle:", txt); };
  };

  _nwf.ui.DialogManager = _nwf.ui.DialogManager || {};
  _nwf.ui.DialogManager.getInstance = _nwf.ui.DialogManager.getInstance || function () {
    return {
      createDialog: function () { console.log("[NWF-MOCK] DialogManager.createDialog()"); return new _nwf.ui.Dialog(); },
      update: function () { }
    };
  };

  _nwf.ui.Animation = _nwf.ui.Animation || function (_img, _cellW, _cellH, _loop, _startFrame, _endFrame) {
    this.img = _img || null;
    // NWF uses cellWidth/cellHeight naming; keep aliases for compatibility.
    this.cellW = _cellW || 0;
    this.cellH = _cellH || 0;
    this.cellWidth = this.cellW;
    this.cellHeight = this.cellH;
    this.loop = !!_loop;
    this.startFrame = (_startFrame == null) ? 0 : _startFrame;
    this.endFrame = (_endFrame == null) ? 0 : _endFrame;
    this.playrate = 1.0;
    this._t = 0;
  };
  _nwf.ui.Animation.prototype.update = _nwf.ui.Animation.prototype.update || function (dt) {
    this._t += (dt || 0) * this.playrate;
  };

  // ---- boss / PlayReport ----------------------------------------------------
  _nwf.boss = _nwf.boss || {};
  _nwf.boss.PlayReportSendMode = _nwf.boss.PlayReportSendMode || { IMMEDIATE_BACKGROUND: 0 };
  if (!_nwf.boss.__prInst) _nwf.boss.__prInst = { set: NOOP, send: NOOP, flush: NOOP };

  _nwf.boss.PlayReport = _nwf.boss.PlayReport || {};
  _nwf.boss.PlayReport.isReady = _nwf.boss.PlayReport.isReady || function () { return true; };
  _nwf.boss.PlayReport.getInstance = _nwf.boss.PlayReport.getInstance || function () { return _nwf.boss.__prInst; };

  // ---- net/network ----------------------------------------------------------
  _nwf.net = _nwf.net || {};
  _nwf.net.Network = _nwf.net.Network || {};
  _nwf.net.Network.isConnected = _nwf.net.Network.isConnected || function () { return true; };
  _nwf.net.Network.reconnect = _nwf.net.Network.reconnect || function () { return true; };
  _nwf.net.Network.getNatType = _nwf.net.Network.getNatType || function () { return 0; };

  _nwf.network = _nwf.network || {};
  _nwf.network.ConnectionType = _nwf.network.ConnectionType || { NONE: 0, WIFI: 1, WIRED: 2 };

  // FORCE network mock (remove if check)
  // if (!_nwf.network.__inst) {
  const n = new MiniEmitter();
  n.isConnected = function () { console.log("[NWF-MOCK] network.isConnected called -> false"); return false; }; // Force Offline
  n.getConnectionType = function () { console.log("[NWF-MOCK] network.getConnectionType called -> NONE"); return _nwf.network.ConnectionType.NONE; }; // Force Offline
  n.getNatType = function () { return 0; };
  n.getSignalStrength = function () { return 0; }; // Force Offline
  _nwf.network.__inst = n;
  // }
  _nwf.network.Network = _nwf.network.Network || {};
  _nwf.network.Network.getInstance = _nwf.network.Network.getInstance || function () { return _nwf.network.__inst; };

  // ---- account --------------------------------------------------------------
  _nwf.account = _nwf.account || {};
  _nwf.nas = _nwf.nas || {};
  _nwf.act = _nwf.act || {};

  // ---- system (App Status) --------------------------------------------------
  _nwf.system = _nwf.system || {};
  if (!_nwf.system.appStatus) _nwf.system.appStatus = "foreground"; // "foreground", "background", "visible"

  // Missing Stubs for bootstrap.js / index.html
  _nwf.system.isWiiU = function () { return false; };

  _nwf.system.WiiURegionCode = { JPN: 0, USA: 1, EUR: 2 };
  _nwf.system.WiiULanguageCode = { ENGLISH: 0, FRENCH: 1, GERMAN: 3, ITALIAN: 4, SPANISH: 5, DUTCH: 7, RUSSIAN: 9, PORTUGUESE: 10 };
  _nwf.system.SystemCallerType = { CALLER_TYPE_NONE: 0, CALLER_TYPE_MIIVERSE: 1 };

  _nwf.system.WiiUSystem = _nwf.system.WiiUSystem || {};
  if (!_nwf.system.WiiUSystem.__inst) {
    const sys = new MiniEmitter();
    Object.assign(sys, {
      countryCode: "NL",
      languageCode: _nwf.system.WiiULanguageCode.ENGLISH,
      regionCode: _nwf.system.WiiURegionCode.EUR,
      homeButtonEnabled: true,
      version: "1.0",
      getLaunchParams: function () { return { caller: _nwf.system.SystemCallerType.CALLER_TYPE_NONE }; }
    });
    _nwf.system.WiiUSystem.__inst = sys;
  }
  _nwf.system.WiiUSystem.getInstance = function () {
    return _nwf.system.WiiUSystem.__inst;
  };

  _nwf.system.Memory = _nwf.system.Memory || {
    setObjectCacheCapacities: function () { },
    requestGC: function () { },
    forceGC: function () { },
    getHeapSize: function () { return 1024 * 1024 * 64; }
  };
  _nwf.system.LZ77 = _nwf.system.LZ77 || {
    decompress: function (src, dst) { return 0; }
  };

  _nwf.system.getAppStatus = _nwf.system.getAppStatus || function () {
    console.log("[NWF-MOCK] system.getAppStatus called ->", _nwf.system.appStatus);
    return _nwf.system.appStatus;
  };

  // Some games wait for this event to start logic
  // FORCE system mock
  // if (!_nwf.system.__inst) {
  const sys = new MiniEmitter();
  _nwf.system.__inst = sys;

  // Auto-emit foreground event on boot
  setTimeout(function () {
    console.log("[NWF-MOCK] Emitting SystemEvent.FOCUS_GAINED / APP_STATUS_CHANGE");
    // Try both event styles
    sys._emit("OneStep_System_AppStatusChange", { status: "foreground" });
    sys._emit("Native_System_AppStatusChange", { status: "foreground" });

    if (window.nwf && window.nwf.events && window.nwf.events.SystemEvent) {
      try { sys._emit(window.nwf.events.SystemEvent.FOCUS_GAINED, {}); } catch (e) { }
      try { sys._emit(window.nwf.events.SystemEvent.APP_STATUS_CHANGE, { status: "foreground" }); } catch (e) { }
    }
  }, 1000);

  // Commit (NWF equivalent of "flush setup")
  _nwf.system.commit = _nwf.system.commit || function () {
    console.log("[NWF-MOCK] system.commit called");
  };
  // Commit (NWF equivalent of "flush setup")
  _nwf.system.commit = _nwf.system.commit || function () {
    console.log("[NWF-MOCK] system.commit called");
  };
  // }

  function ensureNintendoAccountNS(ns) {
    ns.NintendoAccount = ns.NintendoAccount || {};
    if (typeof ns.NintendoAccount.RESTRICTION_NONE === "undefined") ns.NintendoAccount.RESTRICTION_NONE = 0;
    if (typeof ns.NintendoAccount.RESTRICTION_PARTIAL === "undefined") ns.NintendoAccount.RESTRICTION_PARTIAL = 1;
    if (typeof ns.NintendoAccount.RESTRICTION_FULL === "undefined") ns.NintendoAccount.RESTRICTION_FULL = 2;
  }
  ensureNintendoAccountNS(_nwf.act);
  ensureNintendoAccountNS(_nwf.account);
  ensureNintendoAccountNS(_nwf.nas);

  const mockAccount = {
    id: "mock-account-1",
    nnid: "MockNNID",
    miiName: "MockUser",
    country: "NL",
    language: "nl",
    isChild: false,
    miiverseRestrictionLevel: _nwf.act.NintendoAccount.RESTRICTION_NONE,
    networkCommunicationAllowed: true
  };

  // FORCE account mock
  // if (!_nwf.account.__inst) {
  const m = new MiniEmitter();
  m.isSignedIn = function () { console.log("[NWF-MOCK] account.isSignedIn called"); return true; };
  m.getActiveAccount = function () { console.log("[NWF-MOCK] account.getActiveAccount called"); return mockAccount; };
  m.getCurrentAccount = function () { return mockAccount; };
  m.getAccount = function () { return mockAccount; };
  m.getAccountCount = function () { return 1; };
  m.getAccountIds = function () { return [mockAccount.id]; };
  m.showAccountSelector = function (cb) {
    console.log("[NWF-MOCK] account.showAccountSelector called");
    setTimeout(function () {
      if (typeof cb === "function") cb({ result: 0, account: mockAccount, accountId: mockAccount.id });
    }, 0);
  };
  m.requestLogin = function (cb) {
    console.log("[NWF-MOCK] account.requestLogin called");
    setTimeout(function () {
      if (typeof cb === "function") cb({ result: 0, account: mockAccount });
    }, 0);
  };
  _nwf.account.__inst = m;
  // }

  _nwf.account.NintendoAccountManager = _nwf.account.NintendoAccountManager || {};
  _nwf.account.NintendoAccountManager.getInstance =
    _nwf.account.NintendoAccountManager.getInstance || function () { return _nwf.account.__inst; };

  _nwf.nas.NintendoAccountManager = _nwf.nas.NintendoAccountManager || {};
  _nwf.nas.NintendoAccountManager.getInstance =
    _nwf.nas.NintendoAccountManager.getInstance || function () { return _nwf.account.__inst; };

  _nwf.act.NintendoAccountManager = _nwf.act.NintendoAccountManager || {};
  _nwf.act.NintendoAccountManager.getInstance =
    _nwf.act.NintendoAccountManager.getInstance || function () { return _nwf.account.__inst; };

  // ---- Miiverse -------------------------------------------------------------
  _nwf.mv = _nwf.mv || {};
  if (!_nwf.mv.__inst) {
    const mv = new MiniEmitter();
    mv.appParams = {};

    mv.initialize = function (_maxAlloc) {
      console.log("[NWF-MOCK] mv.initialize called");
      mv._emit(_nwf.events.MiiverseEvent.INITIALIZATION_SUCCESS, { ok: true });
    };
    mv.getCommunityList = function (_param) {
      console.log("[NWF-MOCK] mv.getCommunityList called");
      setTimeout(() => mv._emit(_nwf.events.MiiverseEvent.DOWNLOAD_COMMUNITY_SUCCESS, { communities: [] }), 0);
    };
    mv.downloadUserData = function (_param) {
      console.log("[NWF-MOCK] mv.downloadUserData called");
      setTimeout(() => mv._emit(_nwf.events.MiiverseEvent.DOWNLOAD_USER_DATA_LIST_SUCCESS, { users: [] }), 0);
    };
    mv.sendPost = function (_post, _useApp) {
      console.log("[NWF-MOCK] mv.sendPost called");
      setTimeout(() => mv._emit(_nwf.events.MiiverseEvent.UPLOAD_POST_SUCCESS, { postId: "mock-post" }), 0);
    };
    mv.deletePost = function (_postId) {
      setTimeout(() => mv._emit(_nwf.events.MiiverseEvent.DELETE_POST_SUCCESS, { ok: true }), 0);
    };
    mv.getPostList = function (_param) {
      console.log("[NWF-MOCK] mv.getPostList called");
      setTimeout(() => mv._emit(_nwf.events.MiiverseEvent.DOWNLOAD_POST_SUCCESS, { posts: [] }), 0);
    };
    mv.sendComment = function (_comment, _useApp) {
      setTimeout(() => mv._emit(_nwf.events.MiiverseEvent.UPLOAD_COMMENT_SUCCESS, { ok: true }), 0);
    };
    mv.getCommentList = function (_param) {
      setTimeout(() => mv._emit(_nwf.events.MiiverseEvent.DOWNLOAD_COMMENT_SUCCESS, { comments: [] }), 0);
    };
    mv.addEmpathy = function (_postId) {
      setTimeout(() => mv._emit(_nwf.events.MiiverseEvent.ADD_EMPATHY_SUCCESS, { ok: true }), 0);
    };
    mv.removeEmpathy = function (_postId) {
      setTimeout(() => mv._emit(_nwf.events.MiiverseEvent.REMOVE_EMPATHY_SUCCESS, { ok: true }), 0);
    };
    mv.followUser = function (_principalId) {
      setTimeout(() => mv._emit(_nwf.events.MiiverseEvent.FOLLOW_USER_SUCCESS, { ok: true }), 0);
    };
    mv.unfollowUser = function (_principalId) {
      setTimeout(() => mv._emit(_nwf.events.MiiverseEvent.UNFOLLOW_USER_SUCCESS, { ok: true }), 0);
    };

    _nwf.mv.__inst = mv;
  }
  _nwf.mv.Miiverse = _nwf.mv.Miiverse || {};
  _nwf.mv.Miiverse.getInstance = _nwf.mv.Miiverse.getInstance || function () { return _nwf.mv.__inst; };

  // Missing Constructors
  _nwf.mv.MiiverseCommunitySearchParam = _nwf.mv.MiiverseCommunitySearchParam || function () {
    this.keyword = "";
    this.offset = 0;
    this.limit = 20;
  };

  _nwf.mv.MiiverseUserDataSearchParam = _nwf.mv.MiiverseUserDataSearchParam || function () {
    this.keyword = "";
    this.offset = 0;
    this.limit = 20;
  };

  _nwf.mv.MiiverseSearchParam = _nwf.mv.MiiverseSearchParam || function () {
    this.keyword = "";
    this.offset = 0;
    this.limit = 20;
    this.communityId = 0;
  };

  _nwf.mv.MiiverseCommentSearchParam = _nwf.mv.MiiverseCommentSearchParam || function () {
    this.postId = 0;
    this.offset = 0;
    this.limit = 20;
  };

  _nwf.mv.MiiverseUploadPost = _nwf.mv.MiiverseUploadPost || function () {
    this.body = "";
    this.painting = null;
    this.dataId = 0;
    this.communityId = 0;
  };

  _nwf.mv.MiiverseUploadComment = _nwf.mv.MiiverseUploadComment || function () {
    this.body = "";
    this.painting = null;
    this.dataId = 0;
    this.postId = 0;
  };

  _nwf.mv.MiiversePost = _nwf.mv.MiiversePost || function () {
    this.body = "";
    this.painting = null;
    this.dataId = 0;
  };


  // ---- Mii ------------------------------------------------------------------
  _nwf.mii = _nwf.mii || {};
  _nwf.mii.Mii = _nwf.mii.Mii || {};
  _nwf.mii.Mii.getMyMii = _nwf.mii.Mii.getMyMii || function () {
    console.log("[NWF-MOCK] Mii.getMyMii called");
    return {
      serialize: function () { return new Uint8Array(96); } // Return empty Mii data
    };
  };

  // ---- NEX ------------------------------------------------------------------
  _nwf.nex = _nwf.nex || {};

  // Missing NEX Constructors
  _nwf.nex.DataStoreUploadObject = _nwf.nex.DataStoreUploadObject || function () {
    this.dataId = 0;
    this.accessPermissionStatus = 0;
    this.updatePermissionStatus = 0;
    this.dataType = 0;
    this.metaBinary = null;
    this.name = "";
    this.persistenceSlot = 0;
  };

  _nwf.nex.DataStoreMetaCompareParam = _nwf.nex.DataStoreMetaCompareParam || function () {
    this.comparisonValue = 0;
    this.comparisonType = 0;
  };

  _nwf.nex.DataStoreRatingInitParam = _nwf.nex.DataStoreRatingInitParam || function () {
    this.slot = 0;
    this.value = 0;
  };

  _nwf.nex.DataStoreSearchParam = _nwf.nex.DataStoreSearchParam || function () {
    this.sortColumn = 0;
    this.resultOption = 0;
    this.searchType = 0;
    this.offset = 0;
    this.count = 20;
  };

  // Missing NEX Constants
  _nwf.nex.DataStorePermission = _nwf.nex.DataStorePermission || {
    PUBLIC: 0,
    FRIEND: 1,
    PRIVATE: 2
  };

  _nwf.nex.DataStoreSearchSortColumn = _nwf.nex.DataStoreSearchSortColumn || {
    CREATED_TIME: 0,
    RATING: 1
  };

  _nwf.nex.DataStoreResultOption = _nwf.nex.DataStoreResultOption || {
    GET_METABINARY: 1
  };

  _nwf.nex.DataStoreSearchType = _nwf.nex.DataStoreSearchType || {
    SEARCH_TYPE_PUBLIC: 0
  };

  if (!_nwf.nex.__gsInst) {
    const gs = new MiniEmitter();
    gs.isLoggedIn = false;
    gs.login = function () {
      console.log("[NWF-MOCK] nex.GameServer.login called");
      gs.isLoggedIn = true;
      gs._emit(_nwf.events.GameServerEvent.LOGIN_SUCCESS, { ok: true });
    };
    _nwf.nex.__gsInst = gs;
  }

  if (!_nwf.nex.__dsInst) {
    const ds = new MiniEmitter();
    ds.isBound = false;
    ds.bind = function () { console.log("[NWF-MOCK] nex.DataStore.bind called"); ds.isBound = true; return true; };

    ds.uploadData = function (_obj) { console.log("[NWF-MOCK] nex.DataStore.uploadData called"); setTimeout(() => ds._emit(_nwf.events.DataStoreEvent.UPLOAD_DATA_SUCCESS, { dataID: 1 }), 0); };
    ds.updateData = function (_id, _obj, _cmp) { console.log("[NWF-MOCK] nex.DataStore.updateData called"); setTimeout(() => ds._emit(_nwf.events.DataStoreEvent.UPDATE_DATA_SUCCESS, { dataID: _id }), 0); };
    ds.deleteData = function (_id) { setTimeout(() => ds._emit(_nwf.events.DataStoreEvent.DELETE_DATA_SUCCESS, { dataID: _id }), 0); };
    ds.downloadData = function (_id) { console.log("[NWF-MOCK] nex.DataStore.downloadData called", _id); setTimeout(() => ds._emit(_nwf.events.DataStoreEvent.DOWNLOAD_DATA_SUCCESS, { dataID: _id, data: { metaBinary: null } }), 0); };
    ds.downloadPersistentData = function (_principalId, _slotId) { console.log("[NWF-MOCK] nex.DataStore.downloadPersistentData called", _principalId, _slotId); setTimeout(() => ds._emit(_nwf.events.DataStoreEvent.DOWNLOAD_DATA_SUCCESS, { dataID: 0, data: { metaBinary: null } }), 0); };
    ds.downloadBatchData = function (_ids) { console.log("[NWF-MOCK] nex.DataStore.downloadBatchData called", _ids); setTimeout(() => ds._emit(_nwf.events.DataStoreEvent.DOWNLOAD_BATCH_DATA_SUCCESS, { batchResults: [] }), 0); };
    ds.dataSearch = function (_param) { console.log("[NWF-MOCK] nex.DataStore.dataSearch called"); setTimeout(() => ds._emit(_nwf.events.DataStoreEvent.SEARCH_SUCCESS, { results: [] }), 0); };
    ds.rateData = function (_id, _slot, _value) { setTimeout(() => ds._emit(_nwf.events.DataStoreEvent.RATE_DATA_SUCCESS, { ok: true }), 0); };
    ds.completeSuspendedData = function (_ids) { setTimeout(() => ds._emit(_nwf.events.DataStoreEvent.COMPLETE_SUSPENDED_OBJECT_SUCCESS, { ok: true }), 0); };

    _nwf.nex.__dsInst = ds;
  }

  _nwf.nex.GameServer = _nwf.nex.GameServer || {};
  _nwf.nex.GameServer.getInstance = _nwf.nex.GameServer.getInstance || function () { return _nwf.nex.__gsInst; };

  _nwf.nex.DataStore = _nwf.nex.DataStore || {};
  _nwf.nex.DataStore.getInstance = _nwf.nex.DataStore.getInstance || function () { return _nwf.nex.__dsInst; };

  // ---- PT Storage failsafe (v1.9) ------------------------------------------
  (function installPtStorageFailsafe() {
    let tries = 0;
    const MAX_TRIES = 400;

    function seedUGC(saveData) {
      if (saveData.ugc) return;

      const status = [];
      for (let i = 0; i < 50; i++) {
        status[i] = {
          platformType: 0,
          postID: null,
          body: null,
          dateCreated: null,
          yeahs: 0,
          yeahed: false,
          miiExpression: 0,
          posterID: 0,
          regionID: 0,
          played: false,
          trophy: 0,
          replyCount: 0
        };
      }

      const stampUnlockedStatus = [];
      for (let i = 0; i < 100; i++) stampUnlockedStatus[i] = false;

      saveData.ugc = {
        version: 16,
        status,
        progress: {
          stampoints: 0,
          tipSession: 0,
          starbucks: 0,
          communityEntered: false,
          permissionAsked: false,
          permissionGranted: false
        },
        stampUnlockedStatus
      };
    }

    function seedWorkshop(saveData) {
      if (saveData.workshop) return;

      const status = [];
      for (let i = 0; i < 50; i++) {
        status[i] = {
          shared: false,
          tested: false,
          postID: null,
          levelPrimaryDataID: null,
          levelSecondaryDataID: null,
          body: null,
          dateCreated: null,
          yeahs: 0,
          miiExpression: 0,
          replyCount: 0
        };
      }

      saveData.workshop = {
        version: 14,
        status,
        profile: {
          dataID: null,
          yeahsReceivedCount: 0,
          commentsGivenCount: 0,
          tipsGivenCount: 0,
          levelsSharedCount: 0,
          unsharedYeahCount: 0,
          shopUnlocks: 0,
          newShopUnlocks: 0
        },
        tipBucket: {
          dataID: null
        }
      };
    }

    function tick() {
      tries++;

      // Force create pt if missing (Deadlock Fix)
      if (!window.pt) window.pt = {};
      if (!window.pt.storage) window.pt.storage = { _saveData: {}, _versions: { solo: 9, ugc: 16, workshop: 14 } };

      try {
        if (window.pt && window.pt.storage) {
          console.log("[NWF-MOCK] pt.storage found (or created). Checking seeding...");
          const st = window.pt.storage;

          if (st._saveData == null || typeof st._saveData !== "object") {
            console.log("[NWF-MOCK] Initializing _saveData (was missing)");
            st._saveData = {};
          }

          seedUGC(st._saveData);
          seedWorkshop(st._saveData);

          if (st._versions == null || typeof st._versions !== "object") {
            st._versions = { solo: 9, ugc: 16, workshop: 14 };
          }

          // Also verify saveAllProgress mock exists
          if (typeof st.saveAllProgress !== "function") {
            st.saveAllProgress = function () { console.log("[NWF-MOCK] saveAllProgress called"); };
          }

          console.log("[NWF-MOCK] pt.storage seeding complete.");
          clearInterval(timer);
          return;
        }
      } catch (e) {
        console.error("[NWF-MOCK] pt.storage seeding error:", e);
      }

      // Should not reach here due to force-create above
      if (tries >= MAX_TRIES) {
        console.warn("[NWF-MOCK] pt.storage NOT found after max tries.");
        clearInterval(timer);
      }
    }

    const timer = setInterval(tick, 50);
    tick();
  })();


  // ---- Browser Audio() WiiU extensions -------------------------------------
  // Wii U "Audio" objects in NWF titles often have custom fields like:
  //  - channelVolume[] (per-channel multipliers)
  //  - tvVolume / gamepadVolume
  // In browsers, HTMLAudioElement doesn't have those. Some games crash if missing.
  (function patchAudioConstructorForWiiUFields() {
    try {
      const NativeAudio = window.Audio;
      if (!NativeAudio || NativeAudio.__nwfPatched) return;

      function PatchedAudio(src) {
        // Create a real HTMLAudioElement
        const a = (arguments.length > 0) ? new NativeAudio(src) : new NativeAudio();

        // Add WiiU-ish fields used by SoundPlayer.js
        if (!Array.isArray(a.channelVolume)) a.channelVolume = [];
        // Pre-seed a few channels so index writes never crash
        for (let i = 0; i < 16; i++) {
          if (typeof a.channelVolume[i] !== "number") a.channelVolume[i] = (i < 2) ? 1.0 : 0.0;
        }

        if (typeof a.tvVolume !== "number") a.tvVolume = 1.0;
        if (typeof a.gamepadVolume !== "number") a.gamepadVolume = 1.0;

        // Some engines read these too
        if (typeof a.loopStart !== "number") a.loopStart = 0;
        if (typeof a.loopEnd !== "number") a.loopEnd = 0;

        return a;
      }

      // Keep access to original
      PatchedAudio.__NativeAudio = NativeAudio;
      PatchedAudio.__nwfPatched = true;

      // Replace global Audio factory/ctor.
      // Note: returning the created element is fine for typical game code.
      window.Audio = PatchedAudio;
      window.webkitAudioContext = window.webkitAudioContext || window.AudioContext;

      // Also ensure existing prototype alias methods for legacy engines
      const ACp = window.AudioContext && window.AudioContext.prototype;
      if (ACp && typeof ACp.createGain === "function" && typeof ACp.createGainNode !== "function") {
        ACp.createGainNode = ACp.createGain;
      }
      if (ACp && typeof ACp.createScriptProcessor === "function" && typeof ACp.createJavaScriptNode !== "function") {
        ACp.createJavaScriptNode = ACp.createScriptProcessor;
      }
    } catch (e) { }
  })();

  // ---- SoundPlayer safety net ----------------------------------------------
  // If the title still assumes WiiU-only audio behavior, prevent hard-crash loops.
  (function patchSoundPlayerCrashGuards() {
    function tryPatch() {
      const SP = window.SoundPlayer || (window.lib && window.lib.sound && window.lib.sound.SoundPlayer);
      if (!SP || !SP.prototype) return false;
      if (SP.prototype.__nwfCrashGuardPatched) return true;

      const wrap = (name) => {
        if (typeof SP.prototype[name] !== "function") return;
        const orig = SP.prototype[name];
        SP.prototype[name] = function () {
          try {
            return orig.apply(this, arguments);
          } catch (e) {
            try { console.warn("[NWF-MOCK] " + name + " suppressed:", e); } catch (_) { }
            return null;
          }
        };
      };

      // Ensure a non-null audioElement with channelVolume[] so channel-mix logic can't crash
      if (typeof SP.prototype.changeMusicChannels === "function" && !SP.prototype.__nwfChangeMusicPatched) {
        const _origCMC = SP.prototype.changeMusicChannels;
        SP.prototype.changeMusicChannels = function (musicName, channelsOn) {
          try {
            const obj = this && this.musicObjects ? this.musicObjects[musicName] : null;
            if (obj) {
              if (!obj.audioElement) {
                try { obj.audioElement = new Audio(); } catch (e) { obj.audioElement = { play() { }, pause() { }, load() { }, addEventListener() { }, removeEventListener() { }, volume: 0, tvVolume: 0, gamepadVolume: 0 }; }
              }
              const ae = obj.audioElement;
              if (ae) {
                if (!Array.isArray(ae.channelVolume)) ae.channelVolume = [];
                const n = (window.lib && window.lib.sound && typeof window.lib.sound.NUM_MUSIC_CHANNELS === "number")
                  ? window.lib.sound.NUM_MUSIC_CHANNELS
                  : 16;
                for (let i = 0; i < n; i++) {
                  if (typeof ae.channelVolume[i] !== "number") ae.channelVolume[i] = (i < 2) ? 1.0 : 0.0;
                }
              }
            }
          } catch (e) { }
          try { return _origCMC.apply(this, arguments); }
          catch (e) {
            try { console.warn("[NWF-MOCK] changeMusicChannels suppressed:", e); } catch (_) { }
            return null;
          }
        };
        SP.prototype.__nwfChangeMusicPatched = true;
      }

      // Prefer "keep audio tags alive" on load error: avoids audioElement=null paths in SoundPlayer.js
      try {
        if (window.lib && window.lib.sound && typeof window.lib.sound.CREATE_ALL_AUDIO_TAGS === "boolean") {
          window.lib.sound.CREATE_ALL_AUDIO_TAGS = true;
        }
      } catch (e) { }

      // These are the ones that currently crash for you
      wrap("setMusicChannels");
      wrap("playMusic");
      wrap("changeMusicChannels");

      SP.prototype.__nwfCrashGuardPatched = true;
      return true;
    }

    let tries = 0;
    const timer = setInterval(function () {
      tries++;
      if (tryPatch() || tries > 400) clearInterval(timer);
    }, 50);
    tryPatch();
  })();


  // ---- battery level / charging (Wii U gamepad) ----------------------------
  _nwf.input = _nwf.input || {};
  _nwf.input.BatteryLevel = _nwf.input.BatteryLevel || {
    EMPTY: 0,
    LOW: 1,
    MEDIUM: 2,
    HIGH: 3
  };

  // Ensure controller has expected properties used by ErrorManager._processBatteryWarning
  try {
    const gp = (_nwf.input.WiiUGamePad && typeof _nwf.input.WiiUGamePad.getController === "function")
      ? _nwf.input.WiiUGamePad.getController()
      : (_nwf.input.__controller0 || null);

    if (gp) {
      if (typeof gp.batteryLevel === "undefined") gp.batteryLevel = _nwf.input.BatteryLevel.HIGH;
      if (typeof gp.isCharging === "undefined") gp.isCharging = false;
    }
  } catch (e) { }

  // SystemErrorCode constant referenced by the title
  _nwf.system = _nwf.system || {};
  _nwf.system.SystemErrorCode = _nwf.system.SystemErrorCode || {};
  if (typeof _nwf.system.SystemErrorCode.CMN_MSG_WII_U_GAMEPAD_NO_BATTERY === "undefined") {
    _nwf.system.SystemErrorCode.CMN_MSG_WII_U_GAMEPAD_NO_BATTERY = 10001;
  }

  // Dialog display constant alias used by the title
  _nwf.ui = _nwf.ui || {};
  if (_nwf.ui.Dialog) {
    if (typeof _nwf.ui.Dialog.DISPLAY_GAMEPAD_0 === "undefined") {
      // Treat "gamepad 0" as the DRC / gamepad display
      _nwf.ui.Dialog.DISPLAY_GAMEPAD_0 = _nwf.ui.Dialog.DISPLAY_DRC || 2;
    }
  }

  // ------------------------------------------------------------
  // INPUT HOOKS (Keyboard + Mouse/Touch + Gamepad API)
  // ------------------------------------------------------------
  (function installInputHooks() {
    try {
      const c = (_nwf && _nwf.input && _nwf.input.__controller0) ? _nwf.input.__controller0 : null;
      if (!c) return;

      const BTN = _nwf.input.ControllerButton || {};
      // Fallback bitmasks if the game checks buttonValue against these.
      function def(name, bit) {
        if (typeof BTN[name] === "undefined") BTN[name] = bit;
      }
      def("GAMEPAD_A", 1 << 0);
      def("GAMEPAD_B", 1 << 1);
      def("GAMEPAD_X", 1 << 2);
      def("GAMEPAD_Y", 1 << 3);
      def("GAMEPAD_L", 1 << 4);
      def("GAMEPAD_R", 1 << 5);
      def("GAMEPAD_ZL", 1 << 6);
      def("GAMEPAD_ZR", 1 << 7);
      def("GAMEPAD_PLUS", 1 << 8);
      def("GAMEPAD_MINUS", 1 << 9);
      def("GAMEPAD_UP", 1 << 10);
      def("GAMEPAD_DOWN", 1 << 11);
      def("GAMEPAD_LEFT", 1 << 12);
      def("GAMEPAD_RIGHT", 1 << 13);
      def("GAMEPAD_L_STICK", 1 << 14);
      def("GAMEPAD_R_STICK", 1 << 15);

      const TOUCH = (_nwf.input && _nwf.input.TouchPanel) ? _nwf.input.TouchPanel : { TOUCH_VALID: 1, TOUCH_INVALID_XY: 0 };

      const state = {
        buttons: 0,
        lsx: 0,
        lsy: 0,
        rsx: 0,
        rsy: 0,
        touch: false,
        tx: 0,
        ty: 0,
        touchW: 854,
        touchH: 480,
      };

      function setBtn(bit, down) {
        if (!bit) return;
        if (down) state.buttons |= bit;
        else state.buttons &= ~bit;
      }

      // --- Keyboard mapping (you can tweak this any time)
      const keyMap = {
        ArrowUp: BTN.GAMEPAD_UP,
        ArrowDown: BTN.GAMEPAD_DOWN,
        ArrowLeft: BTN.GAMEPAD_LEFT,
        ArrowRight: BTN.GAMEPAD_RIGHT,

        // A/B (Nintendo layout): J = A, K = B by default
        KeyJ: BTN.GAMEPAD_A,
        KeyK: BTN.GAMEPAD_B,
        KeyU: BTN.GAMEPAD_X,
        KeyI: BTN.GAMEPAD_Y,

        KeyQ: BTN.GAMEPAD_L,
        KeyE: BTN.GAMEPAD_R,
        Digit1: BTN.GAMEPAD_ZL,
        Digit3: BTN.GAMEPAD_ZR,

        Enter: BTN.GAMEPAD_PLUS,
        Backspace: BTN.GAMEPAD_MINUS,
        Escape: BTN.GAMEPAD_MINUS,
      };

      window.addEventListener("keydown", (e) => {
        const bit = keyMap[e.code];
        if (bit) {
          setBtn(bit, true);
          e.preventDefault();
        }
      }, { passive: false });

      window.addEventListener("keyup", (e) => {
        const bit = keyMap[e.code];
        if (bit) {
          setBtn(bit, false);
          e.preventDefault();
        }
      }, { passive: false });

      // --- Mouse / Pointer -> GamePad touch panel
      function __nwfPickGamePadCanvas(fallbackTarget) {
        try {
          // If our mobile layout tagged the canvas, use that.
          const tagged = document.querySelector("canvas[data-nwf-screen='gamepad']");
          if (tagged) return tagged;

          // Heuristic: prefer 854x480-ish canvas (GamePad).
          const list = Array.prototype.slice.call(document.querySelectorAll("canvas") || []);
          if (list.length) {
            let gp = list.find(c =>
              c.width >= 780 && c.width <= 920 &&
              c.height >= 430 && c.height <= 520
            ) || null;

            if (!gp && list.length >= 2) {
              // Fallback: 2nd largest canvas (TV is usually the biggest).
              list.sort((a, b) => (b.width * b.height) - (a.width * a.height));
              gp = list[1] || null;
            }

            if (gp) return gp;
          }
        } catch (e) { }
        return fallbackTarget || null;
      }

      function updateTouchFromEvent(e, down) {
        const target = e.target && (e.target.closest ? e.target.closest("canvas") : null);
        const canvas = __nwfPickGamePadCanvas(target)
          || (document.querySelector("canvas#gamepad") || document.querySelector("canvas.gamepad") || target || null);

        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;

        state.touch = !!down;
        state.tx = Math.max(0, Math.min(state.touchW - 1, Math.round(x * state.touchW)));
        state.ty = Math.max(0, Math.min(state.touchH - 1, Math.round(y * state.touchH)));
      }

      window.addEventListener("pointerdown", (e) => updateTouchFromEvent(e, true), { passive: true });
      window.addEventListener("pointermove", (e) => { if (state.touch) updateTouchFromEvent(e, true); }, { passive: true });
      window.addEventListener("pointerup", (e) => updateTouchFromEvent(e, false), { passive: true });
      window.addEventListener("pointercancel", (e) => updateTouchFromEvent(e, false), { passive: true });

      // --- Gamepad API polling (optional, works if you have a controller connected to the PC)
      function pollNavigatorGamepad() {
        const pads = (navigator.getGamepads && navigator.getGamepads()) ? navigator.getGamepads() : [];
        const gp = pads && pads[0];
        if (!gp) return;

        // Left stick
        state.lsx = gp.axes && gp.axes.length > 0 ? (gp.axes[0] || 0) : 0;
        state.lsy = gp.axes && gp.axes.length > 1 ? (gp.axes[1] || 0) : 0;

        // Map common controller buttons -> Nintendo-like buttons
        const b = (i) => (gp.buttons && gp.buttons[i] && gp.buttons[i].pressed) ? 1 : 0;

        // Standard mapping indices (Xbox-style)
        setBtn(BTN.GAMEPAD_A, !!b(0));
        setBtn(BTN.GAMEPAD_B, !!b(1));
        setBtn(BTN.GAMEPAD_X, !!b(2));
        setBtn(BTN.GAMEPAD_Y, !!b(3));
        setBtn(BTN.GAMEPAD_L, !!b(4));
        setBtn(BTN.GAMEPAD_R, !!b(5));
        setBtn(BTN.GAMEPAD_ZL, !!b(6));
        setBtn(BTN.GAMEPAD_ZR, !!b(7));
        setBtn(BTN.GAMEPAD_MINUS, !!b(8));
        setBtn(BTN.GAMEPAD_PLUS, !!b(9));

        // D-pad (some browsers map these)
        setBtn(BTN.GAMEPAD_UP, !!b(12));
        setBtn(BTN.GAMEPAD_DOWN, !!b(13));
        setBtn(BTN.GAMEPAD_LEFT, !!b(14));
        setBtn(BTN.GAMEPAD_RIGHT, !!b(15));
      }

      function pushToMockController() {
        // Buttons bitmask
        c.buttons.buttonValue = state.buttons;

        // Sticks
        c.leftStick.movementX = state.lsx;
        c.leftStick.movementY = state.lsy;
        c.rightStick.movementX = state.rsx;
        c.rightStick.movementY = state.rsy;

        // Touch
        c.touchPanel.touch = state.touch ? TOUCH.TOUCH_VALID : TOUCH.TOUCH_INVALID_XY;
        c.touchPanel.screenX = state.tx;
        c.touchPanel.screenY = state.ty;
      }

      function tick() {
        pollNavigatorGamepad();
        pushToMockController();
        requestAnimationFrame(tick);
      }
      tick();

      // Make sure WebAudio can start after any user gesture (Chrome autoplay policy).
      function resumeAudio() {
        try {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          if (_nwf.__audioCtx && _nwf.__audioCtx.state === "suspended") _nwf.__audioCtx.resume();
        } catch (_) { }
      }
      window.addEventListener("pointerdown", resumeAudio, { passive: true });
      window.addEventListener("keydown", resumeAudio, { passive: true });
    } catch (e) {
      // do not crash the game
      console.warn("[NWF-MOCK] input hook error", e);
    }
  })();


  log("loaded v" + _nwf.__MOCK_VERSION__);
})();
// ---------------------------------------------------------------------------
// v1.43: Guard/polypatch for SoundPlayer.changeMusicChannels (audioElement null)
// Many Wii U titles assume audioElement always exists; in browsers it may be null.
// We patch after SoundPlayer is defined (polling) and harden the call.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Some titles assume SoundPlayer always has a non-null HTMLAudioElement,
// but in browsers it may be null. We keep a small watchdog that re-patches
// SoundPlayer.prototype.changeMusicChannels even if the game overwrites it later.
// ---------------------------------------------------------------------------
(function __nwfPatchSoundPlayer() {
  function ensureChannelVolume(el) {
    try {
      if (!el) return null;
      if (!el.channelVolume || !Array.isArray(el.channelVolume) || el.channelVolume.length < 16) {
        el.channelVolume = new Array(16).fill(1.0);
      }
      return el;
    } catch (_e) { return el; }
  }

  function makeDummyAudio() {
    try {
      const a = new Audio();
      // prevent autoplay promises from spamming
      a.play = function () { return Promise.resolve(); };
      return a;
    } catch (_e) {
      return {
        paused: true, currentTime: 0, loop: false, muted: false, playbackRate: 1,
        play: function () { return Promise.resolve(); },
        pause: function () { },
        addEventListener: function () { },
        removeEventListener: function () { },
        setAttribute: function () { },
        load: function () { },
        volume: 0
      };
    }
  }

  function patchOnce() {
    const SP = window.SoundPlayer || (window.lib && window.lib.sound && window.lib.sound.SoundPlayer);
    if (!SP || !SP.prototype) return;

    const current = SP.prototype.changeMusicChannels;
    if (typeof current !== "function") return;

    // If already patched, ensure it still behaves
    if (current.__nwf_isPatched) return;

    const orig = current;
    function wrapped(musicName, channelsOn) {
      try {
        if (this && this.musicObjects && musicName && this.musicObjects[musicName]) {
          const mo = this.musicObjects[musicName];
          if (!mo.audioElement) {
            mo.audioElement = makeDummyAudio();
          }
          ensureChannelVolume(mo.audioElement);
        }
      } catch (_e) { }
      try {
        return orig.apply(this, arguments);
      } catch (e) {
        try { console.warn("[NWF-MOCK] changeMusicChannels suppressed:", e); } catch (_e) { }
        return null;
      }
    }
    wrapped.__nwf_isPatched = true;
    wrapped.__nwf_orig = orig;
    SP.prototype.changeMusicChannels = wrapped;
    try { console.info("[NWF-MOCK] Patched SoundPlayer.changeMusicChannels (watchdog)"); } catch (_e) { }
  }

  // Watchdog: keep re-applying if the game overwrites the method later.
  setInterval(patchOnce, 200);
  // Also try immediately
  patchOnce();
})();

// ---------------------------------------------------------------------------
// v1.28: Fix 45° girder slopes being mis-classified as "Slidable" due to
// floating-point epsilon mismatch between threshold (-cos(angle)) and line ny.
// Symptoms: Minis can't walk UP diagonal girders, and slide DOWN instead of walk.
// Patch: add a tiny epsilon tolerance in Classifier comparisons.
// ---------------------------------------------------------------------------
(function __nwfPatchSlopeWalkableEpsilon() {
  const EPS = 1e-6; // big enough to cover JS double rounding, tiny enough to not change gameplay.

  function patch() {
    try {
      const C = (window.pt && pt.game && pt.game.mapcoll && pt.game.mapcoll.Classifier) ? pt.game.mapcoll.Classifier : null;
      const Flags = (window.pt && pt.game && pt.game.mapcoll && pt.game.mapcoll.ClassificationFlag) ? pt.game.mapcoll.ClassificationFlag : null;
      if (!C || !C.prototype || !Flags) return false;
      if (C.prototype.__nwfSlopeEpsPatched) return true;

      const solidCollision = C.solidCollision;
      const le = (a, b) => (a <= (b + EPS));
      const gt = (a, b) => (a > (b + EPS));

      C.prototype.isLineWalkableGround = function (line) {
        return (line.mapCollType & solidCollision) && le(line.ny, this._walkableGroundNormalY);
      };
      C.prototype.isLineSlidableGround = function (line) {
        return (line.mapCollType & solidCollision) && gt(line.ny, this._walkableGroundNormalY) && le(line.ny, this._slidableGroundNormalY);
      };
      C.prototype.isLineFlatWalkableGround = function (line) {
        return (line.mapCollType & solidCollision) && le(line.ny, this._flatGroundNormalY);
      };
      C.prototype.isLineTraversableGround = function (line) {
        return (line.mapCollType & solidCollision) && le(line.ny, this._slidableGroundNormalY);
      };
      C.prototype.isTraversableGround = function (mapCollType, normalY) {
        return (mapCollType & solidCollision) && le(normalY, this._slidableGroundNormalY);
      };
      C.prototype.isLineTraversable = function (line) {
        return le(line.ny, this._slidableGroundNormalY);
      };

      C.prototype.classifyCollision = function (mapCollType, normalY) {
        let ret = Flags.None;
        if (mapCollType & solidCollision) {
          if (le(normalY, this._flatGroundNormalY)) ret |= Flags.Flat;
          if (le(normalY, this._walkableGroundNormalY)) {
            ret |= Flags.Walkable;
          } else if (le(normalY, this._slidableGroundNormalY)) {
            ret |= Flags.Slidable;
          }
          if (!(ret & Flags.Traversable)) {
            if (normalY < 1.0) ret |= Flags.Wall;
            else ret |= Flags.Ceiling;
          }
        }
        return ret;
      };

      C.prototype.classifyCollisionEx = function (mapCollType, normalX, normalY, entityFacingX, entityStateFlags) {
        let ret = Flags.None;
        if (mapCollType & solidCollision) {
          if (le(normalY, this._flatGroundNormalY)) ret |= Flags.Flat;
          if (le(normalY, this._walkableGroundNormalY)) {
            ret |= Flags.Walkable;
          } else if (le(normalY, this._slidableGroundNormalY)) {
            if (entityStateFlags & (pt.game && pt.game.entstate ? pt.game.entstate.SlidingSlope : 0)) {
              if ((entityFacingX > 0 && normalX > 0) || (entityFacingX < 0 && normalX < 0)) {
                ret |= Flags.Slidable;
              }
            } else {
              ret |= Flags.Slidable;
            }
          }
          if (!(ret & Flags.Traversable)) {
            if (normalY < 1.0) ret |= Flags.Wall;
            else ret |= Flags.Ceiling;
          }
        }
        return ret;
      };

      C.prototype.__nwfSlopeEpsPatched = true;
      try { console.info("[NWF-MOCK] Patched mapcoll.Classifier epsilon for 45° slopes"); } catch (_e) { }
      return true;
    } catch (e) {
      try { console.warn("[NWF-MOCK] slope-classifier patch error", e); } catch (_e) { }
      return false;
    }
  }

  // Patch as soon as pt.game.mapcoll is loaded.
  if (patch()) return;
  const t = setInterval(function () {
    if (patch()) clearInterval(t);
  }, 200);
})();

// ---------------------------------------------------------------------------
// v1.44: SFX + DSP fix
// - Proper reusable BufferSource for games that pool AudioBufferSourceNode objects
//   (Mario vs Donkey Kong: Tipping Stars pools MAX_WEB_AUDIO_NODES and expects:
//      - sourceNode.playing boolean
//      - sourceNode.resetAll() returns true once stopped so nodes can be recycled
//      - noteOn/noteOff aliases
//   In browsers, AudioBufferSourceNode is one-shot and lacks playing/resetAll.
// - Add DSP (.dsp) decode support by intercepting AudioContext.decodeAudioData.
//   This prevents the existing "safe decode" wrapper from returning a silent buffer.
// ---------------------------------------------------------------------------
(function __nwfSfxAndDspFix() {
  "use strict";

  function log() { try { console.log("[NWF-MOCK]", ...arguments); } catch (_e) { } }

  // ---------- Big endian helpers ----------
  function _u8view(audioData) {
    if (audioData instanceof ArrayBuffer) return new Uint8Array(audioData);
    if (ArrayBuffer.isView(audioData)) return new Uint8Array(audioData.buffer, audioData.byteOffset, audioData.byteLength);
    return null;
  }
  function be16(u, o) { return ((u[o] << 8) | u[o + 1]) >>> 0; }
  function be32(u, o) { return (((u[o] << 24) | (u[o + 1] << 16) | (u[o + 2] << 8) | u[o + 3]) >>> 0); }
  function se16(u, o) { const v = be16(u, o); return (v & 0x8000) ? (v - 0x10000) : v; }

  // ---------- DSP ADPCM detection + decode ----------
  function looksLikeDspAdpcm(audioData) {
    const u = _u8view(audioData);
    if (!u || u.length < 0x60) return false;

    const sampleCount = be32(u, 0x00);
    const nibbleCount = be32(u, 0x04);
    const sampleRate = be32(u, 0x08);
    const loopFlag = be16(u, 0x0C);
    const format = be16(u, 0x0E);

    if (!sampleCount || !nibbleCount) return false;
    if (sampleRate < 8000 || sampleRate > 96000) return false;
    if (format !== 0) return false;
    if (loopFlag !== 0 && loopFlag !== 1) {
      // some files still store 0/1; reject weird values to avoid false positives
      return false;
    }

    const dataLen = u.length - 0x60;
    const expected = (nibbleCount >>> 1);

    // Nibble count includes frame headers; the relationship is still close for DSP files.
    if (dataLen <= 0) return false;
    if (Math.abs(dataLen - expected) > 128) return false;

    // Coefficients are typically non-zero; use a light sanity check.
    let nonZero = 0;
    for (let i = 0; i < 16; i++) {
      if (se16(u, 0x1C + i * 2) !== 0) { nonZero++; if (nonZero >= 2) break; }
    }
    if (nonZero === 0) return false;

    return true;
  }

  function clamp16(x) {
    if (x < -32768) return -32768;
    if (x > 32767) return 32767;
    return x;
  }

  // Decoder based on common DSP header layout + reference implementation from vgmstream.
  function decodeDspAdpcmToAudioBuffer(ctx, audioData) {
    const u = _u8view(audioData);
    if (!u) throw new Error("DSP decode: invalid audioData");
    if (u.length < 0x60) throw new Error("DSP decode: buffer too small");

    // Standard Nintendo DSP ADPCM header (0x60 bytes)
    const numSamples = be32(u, 0x00) >>> 0;
    const nibbleCount = be32(u, 0x04) >>> 0;
    const sampleRate = be32(u, 0x08) >>> 0;
    const loopFlag = be16(u, 0x0C) >>> 0;

    // Loop points are stored as nibble offsets (per DSP ADPCM framing)
    const loopStartNib = be32(u, 0x10) >>> 0;
    const loopEndNib = be32(u, 0x14) >>> 0;

    // Coefs: 8 predictor pairs (16 x s16) at 0x1C
    const coefs = new Int16Array(16);
    for (let i = 0; i < 16; i++) coefs[i] = se16(u, 0x1C + i * 2);

    // Initial history (s16) at 0x40 / 0x42
    let hist1 = se16(u, 0x40);
    let hist2 = se16(u, 0x42);

    const dataOff = 0x60;

    // Decode frames: 1 byte header (predict/scale) + 7 bytes = 8 bytes per 14 samples
    const maxFramesAvail = Math.floor((u.length - dataOff) / 8);
    const maxSamplesAvail = maxFramesAvail * 14;
    const outSamples = Math.min(numSamples || maxSamplesAvail, maxSamplesAvail);

    const buffer = ctx.createBuffer(1, outSamples, sampleRate || 32000);
    const out = buffer.getChannelData(0);

    let src = dataOff;
    let dst = 0;

    const clamp16 = (v) => (v < -32768 ? -32768 : (v > 32767 ? 32767 : v));

    while (dst < outSamples && (src + 8) <= u.length) {
      const ps = u[src]; // high nibble predictor, low nibble scale
      const predictor = (ps >>> 4) & 0x0F;
      const scale = ps & 0x0F;

      const coef1 = coefs[(predictor & 7) * 2] | 0;
      const coef2 = coefs[(predictor & 7) * 2 + 1] | 0;

      // 14 samples packed as nibbles in the next 7 bytes
      for (let i = 0; i < 14 && dst < outSamples; i++) {
        const b = u[src + 1 + (i >> 1)];
        const nib = (i & 1) === 0 ? (b >>> 4) : (b & 0x0F);

        // sign-extend 4-bit nibble to 32-bit int
        let sample = ((nib << 28) >> 28);

        // scale (left shift)
        sample = sample * (1 << scale);

        // apply predictor filter
        const predicted = ((coef1 * hist1 + coef2 * hist2) + 1024) >> 11;
        sample = clamp16(sample + predicted);

        // update history
        hist2 = hist1;
        hist1 = sample;

        out[dst++] = sample / 32768;
      }

      src += 8;
    }

    // Convert DSP nibble offsets to decoded sample indices.
    // Each frame is 16 nibbles total: 2 nibbles header + 14 nibbles samples.
    function nibbleToSampleIndex(n) {
      const frame = Math.floor(n / 16);
      const intra = n % 16;
      const inFrameSamples = Math.max(0, intra - 2); // header consumes 2 nibbles
      return frame * 14 + inFrameSamples;
    }

    // Attach loop metadata so our buffer source shim can apply it automatically
    try {
      if (loopFlag === 1) {
        const ls = nibbleToSampleIndex(loopStartNib);
        const le = nibbleToSampleIndex(loopEndNib);
        if (le > ls && le <= outSamples + 1) {
          buffer.__nwf_loopStartSamples = ls;
          buffer.__nwf_loopEndSamples = le;
          buffer.__nwf_loopSampleRate = sampleRate;
        }
      }
    } catch (_e) { }

    // basic sanity: if header claimed more samples than we could decode, that's fine;
    // we still return the decoded portion.
    return buffer;
  }

  // Intercept decodeAudioData: if data is DSP, decode ourselves.
  function patchDecodeAudioData(AC) {
    try {
      if (!AC || !AC.prototype || AC.prototype.__nwfDspDecodePatched) return;
      const proto = AC.prototype;
      const prev = proto.decodeAudioData;
      if (typeof prev !== "function") return;

      proto.decodeAudioData = function (audioData, success, error) {
        try {
          if (looksLikeDspAdpcm(audioData)) {
            const buf = decodeDspAdpcmToAudioBuffer(this, audioData);
            if (typeof success === "function") {
              try { success(buf); } catch (_e) { }
            }
            return Promise.resolve(buf);
          }
        } catch (e) {
          if (typeof error === "function") {
            try { error(e); } catch (_e) { }
          }
          return Promise.reject(e);
        }
        const safeError = function (e) {
          console.warn("[NWF-MOCK] decodeAudioData failed, returning silent buffer.");
          try {
            const silent = ctx.createBuffer(1, 1, 22050);
            if (typeof success === "function") success(silent);
          } catch (err) {
            if (typeof error === "function") error(err);
          }
        };
        // Wrap success to ensure we don't double-call if the promise also resolves? 
        // Actually, decodeAudioData spec says it calls callback OR rejects. 
        // We just replace the error callback.
        try {
          return prev.call(this, audioData, success, safeError);
        } catch (e) {
          safeError(e);
          // Return a dummy promise to satisfy modern interface if needed, though audio.js ignores it.
          // Note: native decodeAudioData returns a Promise in modern browsers.
          return Promise.resolve(ctx.createBuffer(1, 1, 22050));
        }
      };

      proto.__nwfDspDecodePatched = true;
      log("DSP decode patched into AudioContext.decodeAudioData");
    } catch (_e) { }
  }

  // ---------- Reusable BufferSource shim ----------
  function makeAudioParamProxy(getParam) {
    let lastValue = null;
    function p() { return getParam(); }
    const proxy = {};
    Object.defineProperty(proxy, "value", {
      get() { const q = p(); return q ? q.value : (lastValue == null ? 1.0 : lastValue); },
      set(v) { lastValue = v; const q = p(); if (q) q.value = v; }
    });
    Object.defineProperty(proxy, "defaultValue", {
      get() { const q = p(); return q ? q.defaultValue : 1.0; }
    });
    proxy.setValueAtTime = function (v, t) { lastValue = v; const q = p(); return q && q.setValueAtTime ? q.setValueAtTime(v, t) : undefined; };
    proxy.linearRampToValueAtTime = function (v, t) { lastValue = v; const q = p(); return q && q.linearRampToValueAtTime ? q.linearRampToValueAtTime(v, t) : undefined; };
    proxy.exponentialRampToValueAtTime = function (v, t) { lastValue = v; const q = p(); return q && q.exponentialRampToValueAtTime ? q.exponentialRampToValueAtTime(v, t) : undefined; };
    proxy.cancelScheduledValues = function (t) { const q = p(); return q && q.cancelScheduledValues ? q.cancelScheduledValues(t) : undefined; };
    proxy.setTargetAtTime = function (v, t, c) { lastValue = v; const q = p(); return q && q.setTargetAtTime ? q.setTargetAtTime(v, t, c) : undefined; };
    proxy.setValueCurveAtTime = function (vals, t, d) { const q = p(); return q && q.setValueCurveAtTime ? q.setValueCurveAtTime(vals, t, d) : undefined; };
    return proxy;
  }

  function patchCreateBufferSource(AC) {
    try {
      if (!AC || !AC.prototype || AC.prototype.__nwfReusableBufferSourcePatched) return;
      const proto = AC.prototype;
      const orig = proto.createBufferSource;
      if (typeof orig !== "function") return;

      proto.createBufferSource = function () {
        const ctx = this;

        // internal one-shot node (real AudioBufferSourceNode)
        let node = orig.call(ctx);

        let started = false;
        let playing = false;

        // track connections so we can re-connect if we must recreate the internal node
        let connections = []; // [dest, output, input]

        // Stored props to re-apply when we recreate the internal node
        let _buffer = null;
        let _loop = false;
        let _loopStart = 0;
        let _loopEnd = 0;
        let _onended = null;

        // generation guard: prevents stale onended handlers from older internal nodes
        let gen = 1;

        function applyLoopFromBuffer() {
          try {
            if (!_buffer) return;
            if (_buffer.__nwf_loopEndSamples != null && _buffer.__nwf_loopStartSamples != null && _buffer.__nwf_loopSampleRate) {
              const sr = _buffer.__nwf_loopSampleRate;
              const ls = _buffer.__nwf_loopStartSamples / sr;
              const le = _buffer.__nwf_loopEndSamples / sr;
              if (isFinite(ls) && isFinite(le) && le > ls) {
                _loopStart = ls;
                _loopEnd = le;
              }
            }
          } catch (_e) { }
        }

        const proxy = {};
        proxy.playing = false;

        function bindOnEnded(localGen) {
          try {
            node.onended = function () {
              // If this is not the latest internal node, ignore.
              if (localGen !== gen) return;

              playing = false;
              try { proxy.playing = false; } catch (_e) { }
              if (typeof _onended === "function") { try { _onended(); } catch (_e) { } }
            };
          } catch (_e) { }
        }

        function syncProps() {
          try { node.buffer = _buffer; } catch (_e) { }
          try { node.loop = !!_loop; } catch (_e) { }
          try { node.loopStart = +_loopStart || 0; } catch (_e) { }
          try { node.loopEnd = +_loopEnd || 0; } catch (_e) { }

          // Restore playbackRate value if it was touched
          try {
            if (proxy.playbackRate && node.playbackRate) {
              node.playbackRate.value = proxy.playbackRate.value;
            }
          } catch (_e) { }
        }

        function recreateInternalNode(preserveConnections) {
          const old = node;

          // Prevent old callbacks from mutating the wrapper state later.
          try { if (old) old.onended = null; } catch (_e) { }

          // Stop/disconnect old node best-effort (avoid it firing later).
          try { if (old) old.disconnect(); } catch (_e) { }
          try { if (old && started) old.stop(0); } catch (_e) { }

          node = orig.call(ctx);
          started = false;
          playing = false;

          gen++;
          const localGen = gen;

          syncProps();
          bindOnEnded(localGen);

          if (preserveConnections) {
            try {
              for (let i = 0; i < connections.length; i++) {
                const c = connections[i];
                try { node.connect(c[0], c[1], c[2]); } catch (_e) { }
              }
            } catch (_e) { }
          } else {
            connections = [];
          }
        }

        // playbackRate is used heavily; expose a proxy AudioParam
        proxy.playbackRate = makeAudioParamProxy(() => node.playbackRate);

        // Initial onended binding
        bindOnEnded(gen);

        // WiiU compat bits expected by SoundPlayer.js
        proxy.resetAll = function () {
          // Only return true once we are really stopped (SoundPlayer polls this).
          if (playing) return false;

          // The title never clears loop when loop=false, so reset it here.
          try { _loop = false; } catch (_e) { }
          try { _loopStart = 0; } catch (_e) { }
          try { _loopEnd = 0; } catch (_e) { }

          try { started = false; } catch (_e) { }
          try { proxy.playing = false; } catch (_e) { }

          // reset internal node and CLEAR connections (matches Wii U behavior better)
          try { recreateInternalNode(false); } catch (_e) { }
          return true;
        };

        // Aliases used by the title
        proxy.noteOn = function (when) { return proxy.start(when || 0); };
        proxy.noteOff = function (when) { return proxy.stop(when || 0); };

        proxy.connect = function (dest, output, input) {
          connections.push([dest, output, input]);
          return node.connect(dest, output, input);
        };
        proxy.disconnect = function () {
          connections = [];
          try { return node.disconnect.apply(node, arguments); } catch (_e) { return undefined; }
        };

        proxy.start = function () {
          // BufferSource in browsers is one-shot; if game tries to reuse, recreate.
          if (started) {
            // preserve already-made connections for this play call
            recreateInternalNode(true);
          }

          started = true;
          playing = true;
          proxy.playing = true;

          syncProps();

          try { return node.start.apply(node, arguments); }
          catch (e) {
            // Some engines call start twice with same node; try one last recreate
            try {
              recreateInternalNode(true);
              started = true;
              playing = true;
              proxy.playing = true;
              syncProps();
              return node.start.apply(node, arguments);
            } catch (_e) {
              playing = false;
              proxy.playing = false;
              throw e;
            }
          }
        };

        proxy.stop = function () {
          // Don't immediately mark as stopped if this is a scheduled stop in the future.
          // SoundPlayer relies on resetAll() staying false until the node actually ends.
          try {
            const when = (arguments.length ? +arguments[0] : 0);
            const now = ctx.currentTime || 0;
            if (!isFinite(when) || when === 0 || when <= now + 0.0005) {
              // immediate stop
              playing = false;
              proxy.playing = false;
            }
          } catch (_e) { }

          try { return node.stop.apply(node, arguments); }
          catch (_e) {
            // ignore; node may already be stopped
            playing = false;
            proxy.playing = false;
            return undefined;
          }
        };

        // Mirror common properties
        Object.defineProperty(proxy, "buffer", {
          get() { return _buffer; },
          set(v) {
            _buffer = v;
            applyLoopFromBuffer();
            try { node.buffer = v; }
            catch (e) {
              // If the title reuses a started one-shot node, browsers throw here.
              // Recreate the internal node immediately so buffer updates ALWAYS stick
              // (prevents "wrong SFX" after heavy spam/voice stealing).
              try { recreateInternalNode(true); } catch (_e) { }
              try { node.buffer = v; } catch (_e) { }
            }
            try {
              // auto-apply loop points to node as well
              node.loopStart = +_loopStart || 0;
              node.loopEnd = +_loopEnd || 0;
            } catch (_e) { }
          }
        });

        Object.defineProperty(proxy, "loop", {
          get() { return _loop; },
          set(v) { _loop = !!v; try { node.loop = _loop; } catch (_e) { } }
        });

        Object.defineProperty(proxy, "loopStart", {
          get() { return _loopStart; },
          set(v) { _loopStart = +v || 0; try { node.loopStart = _loopStart; } catch (_e) { } }
        });

        Object.defineProperty(proxy, "loopEnd", {
          get() { return _loopEnd; },
          set(v) { _loopEnd = +v || 0; try { node.loopEnd = _loopEnd; } catch (_e) { } }
        });

        Object.defineProperty(proxy, "onended", {
          get() { return _onended; },
          set(v) { _onended = v; } // keep our internal guard wrapper as the real onended
        });

        // Best-effort passthrough for other fields the title may poke
        proxy.context = ctx;

        return proxy;
      };

      proto.__nwfReusableBufferSourcePatched = true;
      log("Reusable BufferSource shim patched into AudioContext.createBufferSource");
    } catch (_e) { }
  }

  // Apply patches for both constructors
  try {
    const AC = window.AudioContext;
    const wAC = window.webkitAudioContext;
    patchDecodeAudioData(AC);
    patchDecodeAudioData(wAC);
    patchCreateBufferSource(AC);
    patchCreateBufferSource(wAC);
  } catch (_e) { }

  log("SFX/DSP patch v1.47 loaded (fixes pooled one-shot nodes + .dsp decode + loop reset + spam/voice mixups)");
})();


/* --------------------------------------------------------------------------
 * NWF_MOCK: Dev unlock helpers (browser port)
 * Adds:
 *   - window.nwfUnlockAll({safe:true})
 *   - window.nwfRepairAndUnlock({safe:true})
 *   - Shortcut: Ctrl+Shift+U
 * -------------------------------------------------------------------------- */
(function () {
  "use strict";

  function _lsKey(path) { return "NWF_MOCK::" + String(path); }
  var SAVE_BASE = "/mock/save/appAccount/";
  var SAVE_FILES = ["solo.json", "ugc.json", "workshop.json"];

  function _getPtStorage() {
    try {
      if (window.pt && pt.storage && pt.storage._saveData && typeof pt.storage.saveAllProgress === "function") {
        return pt.storage;
      }
    } catch (e) { }
    return null;
  }

  function _ensureSaveType(storage, type) {
    try {
      if (!storage._saveData[type] && typeof storage._createSaveData === "function") {
        storage._createSaveData(type);
      }
      return storage._saveData[type] || null;
    } catch (e) {
      return null;
    }
  }

  function _getGoldMedalValue() {
    try {
      if (window.pt && pt.Medals && typeof pt.Medals.Gold !== "undefined") return pt.Medals.Gold;
    } catch (e) { }
    // Fallback (most builds map None=0, Bronze=1, Silver=2, Gold=3)
    return 3;
  }

  function _applyUnlockSolo(solo, opts) {
    opts = opts || {};
    var GOLD = _getGoldMedalValue();

    // Ensure correct progress shape: 11 worlds x 8 levels
    var W = 11, L = 8;
    var progress = solo.progress;
    var i, j;

    if (!Array.isArray(progress) || progress.length !== W) {
      progress = [];
      for (i = 0; i < W; i++) progress[i] = [];
    }
    for (i = 0; i < W; i++) {
      if (!Array.isArray(progress[i]) || progress[i].length !== L) {
        var row = [];
        for (j = 0; j < L; j++) row[j] = { locked: true, trophy: 0, highscore: 0 };
        progress[i] = row;
      }
      for (j = 0; j < L; j++) {
        var cell = progress[i][j];
        if (!cell || typeof cell !== "object") cell = progress[i][j] = { locked: true, trophy: 0, highscore: 0 };
        cell.locked = false;
        cell.trophy = GOLD;
        // Use small non-zero values (0 is treated as "unset" in some places)
        if (!cell.highscore || cell.highscore <= 0) cell.highscore = 1;
      }
    }
    solo.progress = progress;

    // Keep "resume" state sane
    if (opts.safe) {
      solo.currentLevel = { world: 0, level: 0 };
      solo.bonusCurrent = { world: 0, level: 0 };
      solo.cutscenes = {};
    }

    solo.unlocks = solo.unlocks || {};
    solo.unlocks.totalGoldTrophies = W * L;
    solo.unlocks.totalLevelsPlayed = Math.max(1, solo.unlocks.totalLevelsPlayed | 0);

    // Don’t force completion popups on boot
    if (opts.safe) {
      solo.unlocks.mainGameCompleteDialogShow = false;
      solo.unlocks.allGoldTrophiesDialogShow = false;
      solo.unlocks.unlockBonusLevelsDialogShow = false;
      solo.unlocks.expertLevelsCompleteDialogShow = false;
    }
  }

  function _applyUnlockUGC(ugc, opts) {
    opts = opts || {};
    // Stamp unlocks: 100 booleans
    var stamps = ugc.stampUnlockedStatus;
    if (!Array.isArray(stamps) || stamps.length !== 100) {
      stamps = new Array(100);
    }
    for (var i = 0; i < 100; i++) stamps[i] = true;
    ugc.stampUnlockedStatus = stamps;

    // Currency (Starbucks)
    try {
      if (window.pt && pt.storage && typeof pt.storage.MAX_STARBUCKS === "number") {
        ugc.starbucks = pt.storage.MAX_STARBUCKS;
      } else {
        ugc.starbucks = 99999;
      }
    } catch (e) {
      ugc.starbucks = 99999;
    }
  }

  function _applyUnlockWorkshop(workshop, opts) {
    opts = opts || {};
    workshop.profile = workshop.profile || {};
    // There are 20 ShopUnlockables (0..19) -> bitmask (1<<20)-1
    var ALL = (1 << 20) - 1; // 1048575
    workshop.profile.shopUnlocks = ALL;
    workshop.profile.newShopUnlocks = 0;
  }

  function _backupSaveKeys() {
    try {
      var stamp = new Date().toISOString();
      for (var i = 0; i < SAVE_FILES.length; i++) {
        var p = SAVE_BASE + SAVE_FILES[i];
        var k = _lsKey(p);
        var v = localStorage.getItem(k);
        if (v != null) {
          localStorage.setItem("NWF_MOCK::BACKUP::" + stamp + "::" + p, v);
        }
      }
    } catch (e) { }
  }

  function _deleteSaveKeys() {
    for (var i = 0; i < SAVE_FILES.length; i++) {
      try { localStorage.removeItem(_lsKey(SAVE_BASE + SAVE_FILES[i])); } catch (e) { }
    }
  }

  function _unlockViaRuntime(opts) {
    var storage = _getPtStorage();
    if (!storage) return null;

    var solo = _ensureSaveType(storage, "solo");
    var ugc = _ensureSaveType(storage, "ugc");
    var workshop = _ensureSaveType(storage, "workshop");

    if (!solo || !ugc || !workshop) return null;

    _applyUnlockSolo(solo, opts);
    _applyUnlockUGC(ugc, opts);
    _applyUnlockWorkshop(workshop, opts);

    // Let the game write correct checksums + versions
    try {
      storage.saveAllProgress();
    } catch (e) {
      // Some builds gate saving; still return ok since in-memory unlock applied
      return { ok: true, wrote: false, via: "pt.storage", note: "saveAllProgress threw", error: String(e && e.message || e) };
    }

    return { ok: true, wrote: true, via: "pt.storage.saveAllProgress" };
  }

  /**
   * Unlock everything and persist it safely.
   *
   * opts:
   *   - safe: true   -> reset resume state + suppress completion popups
   */
  window.nwfUnlockAll = function (opts) {
    opts = opts || {};

    // Backup first (so you can restore manually from DevTools > Application > Local Storage)
    _backupSaveKeys();

    var res = _unlockViaRuntime(opts);
    if (res) return res;

    // Fallback (very early call before pt.storage exists):
    // just set a flag to auto-run once storage is ready.
    try {
      localStorage.setItem("NWF_MOCK::UNLOCK_ON_BOOT", JSON.stringify({ safe: !!opts.safe, t: Date.now() }));
      return { ok: true, wrote: false, via: "deferred", note: "pt.storage not ready yet; will unlock on boot" };
    } catch (e) {
      return { ok: false, error: "pt.storage not ready and failed to defer: " + String(e && e.message || e) };
    }
  };

  /**
   * If you’re stuck after a refresh (corrupt/incompatible save),
   * run this once to wipe the 3 main save files and then unlock cleanly.
   */
  window.nwfRepairAndUnlock = function (opts) {
    opts = opts || {};
    opts.safe = true;

    _backupSaveKeys();
    _deleteSaveKeys();

    // If runtime is ready, rebuild fresh defaults via pt.storage and unlock
    var storage = _getPtStorage();
    if (storage && typeof storage._createSaveData === "function") {
      try {
        storage._createSaveData("solo");
        storage._createSaveData("ugc");
        storage._createSaveData("workshop");
      } catch (e) { }
    }

    return window.nwfUnlockAll(opts);
  };

  // Auto-run deferred unlock once the game storage exists
  (function _installDeferredUnlockPoll() {
    var tries = 0;
    var maxTries = 600; // ~10s @ 60fps
    function tick() {
      tries++;
      try {
        var raw = localStorage.getItem("NWF_MOCK::UNLOCK_ON_BOOT");
        if (raw) {
          var cfg = JSON.parse(raw);
          var storage = _getPtStorage();
          if (storage) {
            localStorage.removeItem("NWF_MOCK::UNLOCK_ON_BOOT");
            _backupSaveKeys();
            var res = _unlockViaRuntime({ safe: !!(cfg && cfg.safe) });
            // no console spam by default
            return;
          }
        }
      } catch (e) { }
      if (tries < maxTries) requestAnimationFrame(tick);
    }
    try { requestAnimationFrame(tick); } catch (e) { }
  })();

  // Shortcut: Ctrl+Shift+U
  document.addEventListener("keydown", function (e) {
    try {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "U" || e.code === "KeyU")) {
        e.preventDefault();
        window.nwfUnlockAll({ safe: true });
      }
    } catch (ex) { }
  }, true);
})();


// ---------------------------------------------------------------------------
// v1.65: Multi-Channel Audio Shim (for level_select_full.ogg - 14 channels)
// Browsers play <audio> by downmixing to stereo/5.1, dropping extra channels.
// Wii U titles use channelVolume[] to mix 14 channels dynamically (music stems).
// We implement a WebAudio-based "Virtual Audio Element" to handle this.
// ---------------------------------------------------------------------------
(function __nwfInstallMultiChannelAudioShim() {
  "use strict";

  // Only apply if AudioContext exists
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;

  function MultiChannelAudio(src) {
    const self = this;

    // Properties expected by HTMLAudioElement / SoundPlayer
    this.src = src || "";
    this.volume = 1.0;
    this.loop = false;
    this.channelVolume = new Array(16).fill(0.0);
    // Defaults for music stems: first 2 on, rest off
    this.channelVolume[0] = 1.0;
    this.channelVolume[1] = 1.0;

    // Wii U fields
    this.tvVolume = 1.0;
    this.gamepadVolume = 1.0;

    // State
    this._ctx = null;
    this._buffer = null;
    this._source = null;
    this._gainNodes = []; // per-channel gains
    this._masterGain = null;
    this._splitter = null;
    this._merger = null;

    this._startTime = 0;
    this._pauseTime = 0; // stored in seconds
    this._playing = false;
    this._loaded = false;

    // EventTarget shim (SoundPlayer expects these)
    this._listeners = {};
    this.addEventListener = function (type, listener) {
      if (!this._listeners[type]) this._listeners[type] = [];
      this._listeners[type].push(listener);
    };
    this.removeEventListener = function (type, listener) {
      if (!this._listeners[type]) return;
      const idx = this._listeners[type].indexOf(listener);
      if (idx !== -1) this._listeners[type].splice(idx, 1);
    };
    this.dispatchEvent = function (event) {
      if (!event.type) return;
      const list = this._listeners[event.type];
      if (list) list.forEach(fn => fn.call(self, event));
      if (typeof self["on" + event.type] === "function") self["on" + event.type](event);
    };

    // Load immediately
    if (src) this.load();
  }

  MultiChannelAudio.prototype.load = function () {
    const self = this;

    // Fix for Resume Issue: Reset time state on load.
    // DO NOT call self.pause() here as it might trigger side effects or race conditions
    // that break the "First Play" logic.
    self._pauseTime = 0;
    self._startTime = 0;

    if (!self.src) return;

    fetch(self.src)
      .then(r => r.arrayBuffer())
      .then(buf => {
        // We need a context to decode.
        // If the global context exists from other patches, use it, else create one.
        const ctx = (window.nwf && window.nwf.__audioCtx) || new AC();
        window.nwf = window.nwf || {};
        window.nwf.__audioCtx = ctx;

        self._ctx = ctx;
        return ctx.decodeAudioData(buf);
      })
      .then(audioBuf => {
        self._buffer = audioBuf;
        self._loaded = true;
        // console.log("[NWF-MOCK] Loaded multi-channel audio:", self.src, "Channels:", audioBuf.numberOfChannels);
        if (self._playing) self.play(); // resume if play() was called before load
      })
      .catch(e => {
        console.error("[NWF-MOCK] Failed to load multi-channel audio:", self.src, e);
      });
  };

  MultiChannelAudio.prototype.play = function () {
    const self = this;
    if (!self._buffer || !self._ctx) {
      self._playing = true; // queue it
      return Promise.resolve();
    }

    if (self._playing && self._source) {
      console.log("[NWF-MOCK] play() called but already playing. State:", self._ctx ? self._ctx.state : "no-ctx");
      return Promise.resolve();
    }

    // If we are "ended" but play is called, we must restart.
    // HTMLAudioElement behavior: if ended, play() restarts from 0 unless currentTime set.
    // We'll trust _pauseTime or reset it if at end.
    if (!self.loop && self._buffer && (self._pauseTime >= self._buffer.duration)) {
      self._pauseTime = 0;
    }

    try {
      // Ensure context is running (user interaction req)
      if (self._ctx.state === "suspended") self._ctx.resume();
    } catch (e) { }

    const ctx = self._ctx;
    const chans = self._buffer.numberOfChannels;

    // Graph: Source -> Splitter -> [Gains] -> Merger -> MasterGain -> Destination
    const source = ctx.createBufferSource();
    source.buffer = self._buffer;
    source.loop = self.loop;

    const splitter = ctx.createChannelSplitter(chans);
    const merger = ctx.createChannelMerger(2); // Stereo output for browser
    const masterGain = ctx.createGain();

    source.connect(splitter);

    self._gainNodes = [];
    for (let i = 0; i < chans; i++) {
      const g = ctx.createGain();
      g.gain.value = (self.channelVolume[i] != null) ? self.channelVolume[i] : 0.0;

      splitter.connect(g, i);

      // Simple downmix: odd->Left, even->Right
      // (Wii U mapping: 0=L, 1=R usually. Game logic controls mixing via volume)
      g.connect(merger, 0, (i % 2));

      self._gainNodes[i] = g;
    }

    merger.connect(masterGain);
    masterGain.connect(ctx.destination);
    masterGain.gain.value = self.volume;

    self._source = source;
    self._splitter = splitter;
    self._merger = merger;
    self._masterGain = masterGain;

    // Handle offset for resume
    const offset = self._pauseTime % self._buffer.duration;

    console.log("[NWF-MOCK] play() starting. Offset:", offset, "Vol:", self.volume, "ChVols:", self.channelVolume.slice(0, 4));

    source.start(0, offset);
    self._startTime = ctx.currentTime - offset;
    self._playing = true;

    // Force volume update immediately
    self._updateVolumes();

    source.onended = function () {
      if (self._playing && !self.loop && (ctx.currentTime - self._startTime >= self._buffer.duration)) {
        self._playing = false;
        self._pauseTime = 0;
        self._startTime = 0;
      }
    };

    return Promise.resolve();
  };

  MultiChannelAudio.prototype.pause = function () {
    if (!this._playing || !this._source) {
      this._playing = false;
      return;
    }
    try {
      this._source.stop();
      this._pauseTime = this._ctx.currentTime - this._startTime;
    } catch (e) { }
    this._source = null;
    this._playing = false;
  };

  // Properties / Accessors to emulate HTMLAudioElement
  Object.defineProperty(MultiChannelAudio.prototype, "currentTime", {
    get: function () {
      if (!this._ctx || !this._startTime) return this._pauseTime;
      if (this._playing) {
        let t = this._ctx.currentTime - this._startTime;
        if (this._buffer && this.loop) t = t % this._buffer.duration;
        return t;
      }
      return this._pauseTime;
    },
    set: function (v) {
      this._pauseTime = v;
      if (this._playing) {
        // If playing, we must restart the source to seek
        this.pause();
        this.play();
      }
    }
  });

  // Polling for volume changes (game changes channelVolume array directly)
  MultiChannelAudio.prototype._updateVolumes = function () {
    if (!this._gainNodes.length) return;
    for (let i = 0; i < this._gainNodes.length; i++) {
      // channelVolume
      const v = (this.channelVolume[i] != null) ? this.channelVolume[i] : 0.0;
      // master volume * tvVolume (approx)
      // wii u audio is quiet, boost it (5.0x)
      const BOOST = 5.0;
      const final = v * (this.volume || 0) * (this.tvVolume || 0) * BOOST;

      // Smooth transition to avoid clicks
      try {
        this._gainNodes[i].gain.setTargetAtTime(final, this._ctx.currentTime, 0.05);
      } catch (e) {
        this._gainNodes[i].gain.value = final;
      }
    }
  };

  // expose class for factory
  window.__nwfMultiChannelAudio = MultiChannelAudio;

  // Add updater to the main loop
  const _origRaf = window.requestAnimationFrame;
  window.requestAnimationFrame = function (cb) {
    if (window.__nwfActiveMultiAudios) {
      window.__nwfActiveMultiAudios.forEach(a => a._updateVolumes());
    }
    return _origRaf(cb);
  };
})();

// Hook into the Audio constructor with a Proxy to handle late .src assignments
(function __nwfHookAudioFactory() {
  const OrigAudio = window.Audio;

  // We need to trap:
  // 1. new Audio(src) -> if src matches, return MultiChannelAudio
  // 2. new Audio() -> return a Proxy that watches for .src = "..."

  window.Audio = function (src) {
    if (src) console.log("[NWF-MOCK] new Audio(" + src + ")");
    else console.log("[NWF-MOCK] new Audio() [no-args]");

    if (src && typeof src === "string" && src.indexOf("level_select_full.ogg") !== -1) {
      console.log("[NWF-MOCK] Audio constructor intercept: level_select_full.ogg detected");
      const m = new window.__nwfMultiChannelAudio(src);
      window.__nwfActiveMultiAudios = window.__nwfActiveMultiAudios || [];
      window.__nwfActiveMultiAudios.push(m);
      return m;
    }

    const realAudio = new OrigAudio(src);

    // Return a proxy to trap future .src assignments
    return new Proxy(realAudio, {
      set: function (target, prop, value) {
        if (prop === "src" && typeof value === "string" && value.indexOf("level_select_full.ogg") !== -1) {
          console.log("[NWF-MOCK] Audio.src intercept: level_select_full.ogg detected");

          // We can't easily "morph" the realAudio object into a MultiChannelAudio object
          // because it was already created. 
          // However, we can create the shim and return it? No, set() must return boolean.
          // We can't change the object identity.

          // Strategy: The Proxy *is* the object held by the game.
          // We need the Proxy to forward calls to EITHER realAudio OR a new shim.
          // This requires a "dynamic delegate" pattern.

          // Since we can't fully swap the target of a proxy after creation, 
          // we will store the shim in the proxy handler state if activated.

          // Initialize shim
          if (!this.shim) {
            this.shim = new window.__nwfMultiChannelAudio(value);
            window.__nwfActiveMultiAudios = window.__nwfActiveMultiAudios || [];
            window.__nwfActiveMultiAudios.push(this.shim);

            // Stop the real audio if it was doing anything
            try { target.pause(); target.src = ""; } catch (e) { }
          } else {
            this.shim.src = value;
            this.shim.load();
          }
          return true;
        }

        // Normal behavior
        // If we have a shim, forward prop set to it
        if (this.shim) {
          this.shim[prop] = value;
          return true;
        }

        target[prop] = value;
        return true;
      },
      get: function (target, prop) {
        // If we have a shim, forward get to it
        if (this.shim) {
          const v = this.shim[prop];
          // If method, bind to shim
          if (typeof v === "function") return v.bind(this.shim);
          return v;
        }

        const v = target[prop];
        if (typeof v === "function") return v.bind(target);
        return v;
      }
    });
  };
  // ---------------------------------------------------------------------------
  // DEBUG: Global Resource Tracer (Image, Fetch, XHR, Script, Link, AV)
  // ---------------------------------------------------------------------------
  (function __nwfResourceTracer() {
    const LOG_PREFIX = "[NWF-TRACE] ";

    function checkNull(v, type) {
      if (String(v).indexOf("null") !== -1) {
        console.warn(LOG_PREFIX + "Suspicious null " + type + "!", v, new Error().stack);
        return true;
      }
      return false;
    }

    // 1. Trace Image.src
    const d = Object.getOwnPropertyDescriptor(Image.prototype, "src");
    if (d && d.set) {
      const origSet = d.set;
      Object.defineProperty(Image.prototype, "src", {
        set: function (v) {
          console.log(LOG_PREFIX + "Image.src = " + v);
          checkNull(v, "Image.src");
          origSet.call(this, v);
        }
      });
    }

    // 2. Trace fetch
    const origFetch = window.fetch;
    window.fetch = function (url, opts) {
      console.log(LOG_PREFIX + "fetch: " + url);
      checkNull(url, "fetch");
      return origFetch.apply(this, arguments);
    };

    // 3. Trace XHR
    // 3. Trace XHR + INTERCEPT DSP
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url) {
      this._nwfUrl = url;
      console.log(LOG_PREFIX + "XHR: " + method + " " + url);
      checkNull(url, "XHR");
      return origOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function (body) {
      return origSend.apply(this, arguments);
    };

    // 4. Trace Other Elements (Script, Link, Audio, Video)
    function traceProp(proto, prop) {
      const d = Object.getOwnPropertyDescriptor(proto, prop);
      if (d && d.set) {
        const origSet = d.set;
        Object.defineProperty(proto, prop, {
          set: function (v) {
            console.log(LOG_PREFIX + proto.constructor.name + "." + prop + " = " + v);
            checkNull(v, proto.constructor.name + "." + prop);
            origSet.call(this, v);
          }
        });
      }
    }

    try { traceProp(HTMLScriptElement.prototype, "src"); } catch (e) { }
    try { traceProp(HTMLLinkElement.prototype, "href"); } catch (e) { }
    try { traceProp(HTMLAudioElement.prototype, "src"); } catch (e) { }
    try { traceProp(HTMLVideoElement.prototype, "src"); } catch (e) { }
    // try { traceProp(HTMLSourceElement.prototype, "src"); } catch (e) { }

    // 5. Global Error Listener (Capture phase to see 404s)
    window.addEventListener("error", function (e) {
      if (e.target && (e.target.src || e.target.href)) {
        console.log(LOG_PREFIX + "Resource Error on:", e.target.tagName, e.target.src || e.target.href);
      }
    }, true);

    // 6. Trace setAttribute (catches indirect src="null")
    const origSetAttr = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, val) {
      if ((name === "src" || name === "href") && String(val).indexOf("null") !== -1) {
        console.log(LOG_PREFIX + "setAttribute(" + name + ", " + val + ") on " + this.tagName);
        console.warn(LOG_PREFIX + "Suspicious null setAttribute!", new Error().stack);
      }
      return origSetAttr.apply(this, arguments);
    };

    // 7. Trace innerHTML (catches <img src=null>)
    const dHTML = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
    if (dHTML && dHTML.set) {
      const origSetHTML = dHTML.set;
      Object.defineProperty(Element.prototype, "innerHTML", {
        set: function (v) {
          if (String(v).indexOf("src=\"null\"") !== -1 || String(v).indexOf("src='null'") !== -1) {
            console.log(LOG_PREFIX + "innerHTML set causing null src!");
            console.warn(LOG_PREFIX + "Suspicious innerHTML!", new Error().stack);
          }
          origSetHTML.call(this, v);
        }
      });
    }

    console.log(LOG_PREFIX + "Installed (Full+DOM).");

    // Self-Test to prove logger works
    setTimeout(function () {
      console.log(LOG_PREFIX + "Running Self-Test...");
      try { const i = new Image(); i.src = "NWF-LOGGER-TEST.png"; } catch (e) { }
    }, 1000);

    // 8. Polling DOM Scanner (Last Resort)
    setInterval(function () {
      try {
        // Check window.nwf
        if (!window.windowNwfLogged) {
          console.log(LOG_PREFIX + "window.nwf exists?", !!window.nwf);
          window.windowNwfLogged = true;
        }

        // Scan for null attributes
        const nulls = document.querySelectorAll('[src*="null"], [href*="null"]');
        if (nulls.length > 0) {
          nulls.forEach(el => {
            if (!el.getAttribute("data-nwf-warned")) {
              console.warn(LOG_PREFIX + "Found DOM Element with null attribute:", el.tagName, el.outerHTML);
              el.setAttribute("data-nwf-warned", "true");
            }
          });
        }

        // Scan for CSS background
        const all = document.querySelectorAll('*');
        for (let i = 0; i < Math.min(all.length, 1000); i++) {
          const s = getComputedStyle(all[i]);
          if (s.backgroundImage && s.backgroundImage.indexOf("null") !== -1) {
            if (!all[i].getAttribute("data-nwf-warned-css")) {
              console.warn(LOG_PREFIX + "Found CSS with null background:", all[i]);
              all[i].setAttribute("data-nwf-warned-css", "true");
            }
          }
        }

      } catch (e) { }
    }, 2000);

    // 7. Global NWF API Tracer (Last resort)
    function __traceNwfAndSub(root, prefix) {
      if (!root || typeof root !== 'object') return;
      if (root.__traced) return;
      try { root.__traced = true; } catch (e) { return; }

      for (const k in root) {
        const v = root[k];
        if (typeof v === 'function') {
          if (k.startsWith("_") || k === "constructor") continue;
          const orig = v;
          root[k] = function () {
            console.log(prefix + "." + k + " called");
            return orig.apply(this, arguments);
          };
          // Restore props
          for (let p in orig) root[k][p] = orig[p];
          Object.assign(root[k], orig);
        } else if (typeof v === 'object' && v !== null) {
          if (k === "events" || k === "__inst") continue;
          __traceNwfAndSub(v, prefix + "." + k);
        }
      }
    }
    // Install immediately
    console.log(LOG_PREFIX + " Installing Global API Tracer on _nwf...");
    if (typeof _nwf !== "undefined") {
      __traceNwfAndSub(_nwf.io, "_nwf.io");
      __traceNwfAndSub(_nwf.system, "_nwf.system");
      __traceNwfAndSub(_nwf.app, "_nwf.app");
      __traceNwfAndSub(_nwf.sys, "_nwf.sys");
      __traceNwfAndSub(_nwf.ui, "_nwf.ui");
    }

  })();
  // ---- Runtime Patches for Game Logic (Fixes for Hangs/Crashes) -------------
  // Since we want to keep original game files intact, we patch the prototypes
  // at runtime once the classes are loaded.
  (function installRuntimePatches() {
    var patches = { MapLoader: false, AssetDefLoader: false, DPadController: false };
    var startTime = Date.now();

    var timer = setInterval(function () {
      // 1. Patch MapLoader to handle 404s (Fixes AssetDef hang)
      if (!patches.MapLoader && window.pt && window.pt.map && window.pt.map.MapLoader) {
        try {
          var ML = window.pt.map.MapLoader;

          // Re-implement load to handle errors gracefully
          ML.prototype.load = function (mapProjectLevelDef, userLoadCallback) {
            var thisRef = this;
            this.mapLoaded = false;
            if (this.isMapLoaded()) this.unload();
            this.mapProjectLevelDef = mapProjectLevelDef;

            // Use lib.curl but trap error
            // We assume lib.curl is available (it is if MapLoader is loaded)
            lib.curl('json!' + ML.mapProjectRootDir + this.mapProjectLevelDef.url, function (data) {
              thisRef.mapLoadedCallback(data, userLoadCallback);
            }, function (e) {
              // PATCH: Don't throw. Log warning and callback with null.
              console.warn('[NWF-MOCK-PATCH] MapLoader 404/Error: ' + (thisRef.mapProjectLevelDef ? thisRef.mapProjectLevelDef.url : 'unknown'));
              if (userLoadCallback) userLoadCallback(null);
            });
          };

          // Also silence mapLoadedError just in case
          ML.prototype.mapLoadedError = function () {
            console.warn('[NWF-MOCK-PATCH] MapLoader.mapLoadedError suppressed.');
          };

          console.log("[NWF-MOCK] Patched MapLoader.prototype.load");
          patches.MapLoader = true;
        } catch (e) { console.error("Failed to patch MapLoader", e); }
      }

      // 2. Patch AssetDefLoader to handle null maps (Fixes AssetDef hang)
      if (!patches.AssetDefLoader && window.pt && window.pt.map && window.pt.map.AssetDefLoader) {
        try {
          var ADL = window.pt.map.AssetDefLoader;

          // We need to re-implement loadMapDef to check for null mapDef in the callback
          ADL.prototype.loadMapDef = function (worldIndex, levelIndex) {
            var mapProjectLevelDef = this.getMapProjectLevelDef(worldIndex, levelIndex);
            var mapLoader = new pt.map.MapLoader();
            var that = this;

            // PATCHED CALLBACK
            var onMapLoad = function (mapDef) {
              // Fix: Handle null mapDef (from failed loads)
              if (!mapDef) {
                console.warn("[NWF-MOCK-PATCH] AssetDefLoader received null map for " + worldIndex + "-" + levelIndex);
              }

              var mapDefs = that.worldMapDefs[worldIndex];
              mapDefs[levelIndex] = mapDef; // It's okay if this is null, as long as we decrement count
              --that.mapDefLoadCount;

              if (that.allMapDefLoadsBegun && that.mapDefLoadCount == 0) {
                that.assetDefFilesLoaded = true;
                console.log("[NWF-MOCK-PATCH] All AssetDefs loaded (via patch).");
              }
            };

            ++this.mapDefLoadCount;
            mapLoader.load(mapProjectLevelDef, onMapLoad);
          };

          console.log("[NWF-MOCK] Patched AssetDefLoader.prototype.loadMapDef");
          patches.AssetDefLoader = true;
        } catch (e) { console.error("Failed to patch AssetDefLoader", e); }
      }

      // 3. Patch DPadController to prevent crash (Fixes Workshop crash)
      if (!patches.DPadController && window.ui && window.ui.DPadController) {
        try {
          var DPad = window.ui.DPadController;
          var origUpdate = DPad.prototype.update;

          DPad.prototype.update = function () {
            // PATCH: Ensure _dpad exists
            if (!this._dpad) {
              this._gamepad = nwf.input.WiiUGamePad.getController();
              if (this._gamepad) this._dpad = this._gamepad.controlPad;
              if (!this._dpad) return; // Skip update if still missing
            }
            // Call original logic (now safe)
            origUpdate.call(this);
          };

          console.log("[NWF-MOCK] Patched DPadController.prototype.update");
          patches.DPadController = true;
        } catch (e) { console.error("Failed to patch DPadController", e); }
      }

      // 4. Patch Theme.preload to handle 404s (Fixes Editor Save Hang)
      if (!patches.Theme && window.pt && window.pt.map && window.pt.map.Theme) {
        try {
          var Theme = window.pt.map.Theme;
          // We completely replace preload because the original doesn't expose the loadCount logic
          Theme.prototype.preload = function (themeDef, callback, errback) {
            this.tileDataCache.clear();
            this.type = themeDef.type;
            var ttCfg;
            var allLoadsBegun = false;
            var i = themeDef.tileTypes.length;

            console.log('[Theme] loading data... (PATCHED)');

            var that = this;
            var loadCount = 0;

            function checkDone() {
              if (allLoadsBegun && loadCount == themeDef.tileTypes.length) {
                that._isReady = true;
                if (callback) callback(that);
              }
            }

            function onSuccess(tileData) {
              ++loadCount;
              checkDone();
            }

            function onError(ex) {
              // FIX: Increment count even on error to prevent hang
              console.warn("[NWF-MOCK-PATCH] Theme asset load failed (ignored):", ex);
              ++loadCount;
              checkDone();
            }

            // Loop backwards as in original
            while (i--) {
              ttCfg = themeDef.tileTypes[i];
              this.tileDataCache.preloadData(ttCfg.tileType, ttCfg.url, null, onSuccess, onError);
            }
            allLoadsBegun = true;
            checkDone();
          };

          console.log("[NWF-MOCK] Patched Theme.prototype.preload");
          patches.Theme = true;
        } catch (e) { console.error("Failed to patch Theme", e); }
      }

      // Stop checking when all are patched
      if (patches.MapLoader && patches.AssetDefLoader && patches.DPadController && patches.Theme) {
        clearInterval(timer);
        console.log("[NWF-MOCK] All runtime patches applied.");
      }

      // Stop after 60 seconds
      if (Date.now() - startTime > 60000) clearInterval(timer);

    }, 50);
  })();

  window.Audio.prototype = OrigAudio.prototype;
})();

/* --------------------------------------------------------------------------
 * DEBUG SUITE (Integrated)
 * -------------------------------------------------------------------------- */
(function () {
  // 1. Console Capture (Must happen immediately and be resilient)

  // Save original methods
  var originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info
  };

  var logs = [];
  var MAX_LOGS = 1000;

  function captureLog(type, args) {
    // Convert args to string for display
    var msg = Array.prototype.slice.call(args).map(function (arg) {
      try {
        return typeof arg === 'object' ? JSON.stringify(arg) : String(arg);
      } catch (e) {
        return String(arg);
      }
    }).join(' ');

    logs.push({ type: type, msg: msg, timestamp: new Date().toLocaleTimeString() });
    if (logs.length > MAX_LOGS) logs.shift();

    // Update UI if it exists
    if (window.debugUpdateConsole) {
      window.debugUpdateConsole();
    }

    // Pass through to original console
    if (originalConsole[type]) {
      originalConsole[type].apply(console, args);
    }
  }

  // Define locking wrappers
  function defineLocked(prop, type) {
    Object.defineProperty(console, prop, {
      get: function () {
        return function () { captureLog(type, arguments); };
      },
      set: function () {
        // Ignore attempts to overwrite
        originalConsole.warn('Blocked attempt to overwrite console.' + prop);
      },
      configurable: false
    });
  }

  defineLocked('log', 'log');
  defineLocked('warn', 'warn');
  defineLocked('error', 'error');
  defineLocked('info', 'info');

  // 2. UI Construction (Wait for DOM)
  window.addEventListener('DOMContentLoaded', function () {
    var style = document.createElement('style');
    style.textContent = '' +
      '#debug-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 99999; font-family: monospace; }' +
      '#debug-toggle { position: absolute; top: 10px; right: 10px; pointer-events: auto; background: rgba(0, 0, 0, 0.7); color: lime; border: 1px solid lime; padding: 5px 10px; cursor: pointer; z-index: 100000; }' +
      '#debug-window { position: absolute; top: 50px; right: 10px; width: 600px; height: 400px; background: rgba(0, 0, 0, 0.9); border: 1px solid lime; pointer-events: auto; display: none; flex-direction: column; }' +
      '#debug-tabs { display: flex; border-bottom: 1px solid lime; height: 30px; }' +
      '.debug-tab { padding: 5px 10px; cursor: pointer; color: #888; border-right: 1px solid lime; }' +
      '.debug-tab.active { color: lime; background: rgba(0, 50, 0, 0.5); }' +
      '#debug-content { flex: 1; overflow: hidden; position: relative; }' +
      '.debug-panel { display: none; width: 100%; height: 100%; overflow: auto; padding: 10px; box-sizing: border-box; color: #ddd; }' +
      '.debug-panel.active { display: block; }' +
      '.log-entry { margin-bottom: 2px; border-bottom: 1px solid #333; font-size: 12px; white-space: pre-wrap; word-wrap: break-word; }' +
      '.log-entry.warn { color: yellow; }' +
      '.log-entry.error { color: red; }' +
      '.log-entry.info { color: cyan; }' +
      '.log-ts { color: #666; margin-right: 5px; }' +
      '.cheat-btn { background: #004400; color: lime; border: 1px solid lime; padding: 10px; margin: 5px; cursor: pointer; display: block; width: 90%; text-align: center; }' +
      '.cheat-btn:hover { background: #006600; }';
    document.head.appendChild(style);

    var overlay = document.createElement('div');
    overlay.id = 'debug-overlay';
    overlay.innerHTML = '' +
      '<div id="debug-toggle">DEBUG</div>' +
      '<div id="debug-window">' +
      '<div id="debug-tabs">' +
      '<div class="debug-tab active" data-tab="console">Console</div>' +
      '<div class="debug-tab" data-tab="cheats">Cheats</div>' +
      '</div>' +
      '<div id="debug-content">' +
      '<div id="panel-console" class="debug-panel active"></div>' +
      '<div id="panel-cheats" class="debug-panel">' +
      '<button class="cheat-btn" id="btn-unlock-all">Unlock All Levels (nwfUnlockAll)</button>' +
      '<button class="cheat-btn" id="btn-mobile-screen">Mobile Screen Mode</button>' +
      '</div>' +
      '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    var toggleBtn = document.getElementById('debug-toggle');
    var debugWindow = document.getElementById('debug-window');
    var tabs = document.querySelectorAll('.debug-tab');
    var panels = document.querySelectorAll('.debug-panel');

    toggleBtn.addEventListener('click', function () {
      debugWindow.style.display = debugWindow.style.display === 'none' ? 'flex' : 'none';
    });

    for (var i = 0; i < tabs.length; i++) {
      (function (tab) {
        tab.addEventListener('click', function () {
          for (var j = 0; j < tabs.length; j++) tabs[j].classList.remove('active');
          for (var k = 0; k < panels.length; k++) panels[k].classList.remove('active');
          tab.classList.add('active');
          document.getElementById('panel-' + tab.dataset.tab).classList.add('active');

          // Force render console if switching to it
          if (tab.dataset.tab === 'console') {
            window.debugUpdateConsole();
          }
        });
      })(tabs[i]);
    }

    var consolePanel = document.getElementById('panel-console');
    window.debugUpdateConsole = function () {
      // Only render if visible
      if (!consolePanel.classList.contains('active') && debugWindow.style.display === 'none') return;

      var html = '';
      var start = Math.max(0, logs.length - 100);
      for (var i = start; i < logs.length; i++) {
        var log = logs[i];
        html += '<div class="log-entry ' + log.type + '"><span class="log-ts">[' + log.timestamp + ']</span>' + log.msg + '</div>';
      }
      // Simple diff: only update if changed length (naive but faster than full re-render every log)
      // But for now, full re-render is safe
      consolePanel.innerHTML = html;
      consolePanel.scrollTop = consolePanel.scrollHeight;
    };

    document.getElementById('btn-unlock-all').addEventListener('click', function () {
      if (window.nwfUnlockAll) {
        window.nwfUnlockAll({ safe: true });
        console.log("Cheat Applied: nwfUnlockAll");
      } else {
        console.error("Cheat Failed: nwfUnlockAll not found");
      }
    });

    document.getElementById('btn-mobile-screen').addEventListener('click', function () {
      if (window.__nwfSetMobileSingleScreen) {
        window.__nwfSetMobileSingleScreen(true);
        console.log("Cheat Applied: __nwfSetMobileSingleScreen");
      } else {
        console.error("Cheat Failed: __nwfSetMobileSingleScreen not found");
      }
    });

  });

})();
