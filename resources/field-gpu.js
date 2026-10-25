/*
 * field-gpu.js — the WebGPU tier of the living-ink chrome (see field-chrome.js, which
 * loads this when navigator.gpu exist, and falls back to basic colors when init returns false for any reason).
 *
 * Architecture (strip engine):
 *   - The real DOM text stays in place (made transparent, still selectable/SEO/a11y);
 *     box-type helpers (slabs, rules, rings, bullets) are made invisible. The shader
 *     paints their ink on pointer-transparent canvas overlays.
 *   - The document is divided into a FIXED grid of horizontal strips (~3/4 viewport
 *     tall), anchored to document coordinates. Strips containing no ink are never
 *     created; the rest each get their own small WebGPU canvas, absolutely positioned
 *     once and NEVER moved, resized, or reconfigured while visible. (This replaced a
 *     single 3-viewport canvas that jumped at scroll edges: its mid-scroll churn —
 *     style.top moves + swapchain reconfigures — made the ink visibly trail the page
 *     on some Windows compositors. Static surfaces cannot trail by construction.)
 *   - Strip width is MEASURED: the horizontal bounding box of all targets plus bleed,
 *     not the viewport — content-width pages pay content-width memory, and future side
 *     content widens the measurement on its own.
 *   - An IntersectionObserver (1-viewport margin) wakes strips as they approach:
 *     configure + stencil raster happen OFF-SCREEN, where swapchain churn is invisible
 *     by definition. Far strips are unconfigured to release their swapchains; their
 *     stencil textures are kept, so re-waking is render-only.
 *   - STENCILS: per-strip alpha textures holding the union of every target's alpha —
 *     glyphs drawn per text-fragment rect (Range.getClientRects, so kerning/wrapping
 *     are the browser's own), boxes drawn as geometry. Rasterized once per strip;
 *     re-done only when layout truly changes (resize, content swap, late images).
 *   - FRAGMENT SHADER: per pixel — sample stencil alpha; if inked, evaluate domain-
 *     warped fBm at DOCUMENT coordinates with a TRUE TIME AXIS (3D noise sliced over
 *     t). Palette = the exact zigzag tables from the old SVG engine, as a WGSL
 *     function. Document-anchored coords make the unified field a triviality: each
 *     strip carries only an offset uniform — continuity across strips is arithmetic.
 */
(function () {
  "use strict";

  var WGSL = `
struct U {
  scroll : vec2f,
  size   : vec2f,
  time   : f32,
  dark   : f32,
  dpr    : f32,
  pad1   : f32,
};
@group(0) @binding(0) var<uniform> u : U;
@group(0) @binding(1) var atlasTex : texture_2d<f32>;
@group(0) @binding(2) var smp : sampler;

fn hash3(p : vec3f) -> f32 {
  var q = fract(p * 0.3183099 + vec3f(0.1, 0.2, 0.3));
  q = q * 17.0;
  return fract(q.x * q.y * q.z * (q.x + q.y + q.z));
}
fn vnoise(p : vec3f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let w = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3(i + vec3f(0,0,0)), hash3(i + vec3f(1,0,0)), w.x),
        mix(hash3(i + vec3f(0,1,0)), hash3(i + vec3f(1,1,0)), w.x), w.y),
    mix(mix(hash3(i + vec3f(0,0,1)), hash3(i + vec3f(1,0,1)), w.x),
        mix(hash3(i + vec3f(0,1,1)), hash3(i + vec3f(1,1,1)), w.x), w.y),
    w.z);
}
fn fbm4(p : vec3f) -> f32 {
  var f = 0.0; var a = 0.5; var q = p;
  for (var k = 0; k < 4; k++) {
    f += a * vnoise(q);
    q = q * 2.02; a *= 0.5;
  }
  return f / 0.9375;
}
fn fbm2(p : vec3f) -> f32 {
  return (0.5 * vnoise(p) + 0.25 * vnoise(p * 2.03)) / 0.75;
}
// the SVG engine's six-stop zigzag table, input folded over stops at 0,.2,.4,.6,.8,1
fn zigzag(v : f32, s0 : f32, s1 : f32, s2 : f32, s3 : f32, s4 : f32, s5 : f32) -> f32 {
  let x = clamp(v, 0.0, 1.0) * 5.0;
  let i = floor(x);
  let f = x - i;
  if (i < 1.0) { return mix(s0, s1, f); }
  if (i < 2.0) { return mix(s1, s2, f); }
  if (i < 3.0) { return mix(s2, s3, f); }
  if (i < 4.0) { return mix(s3, s4, f); }
  return mix(s4, s5, f);
}

@vertex
fn vmain(@builtin(vertex_index) vi : u32) -> @builtin(position) vec4f {
  var pos = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(-1.0, 1.0), vec2f(3.0, 1.0));
  return vec4f(pos[vi], 0.0, 1.0);
}

@fragment
fn fmain(@builtin(position) fc : vec4f) -> @location(0) vec4f {
  let a = textureSample(atlasTex, smp, fc.xy / u.size).a;
  if (a < 0.004) { return vec4f(0.0); }
  // document-space coords in CSS px (dpr-normalized): the unified field, by construction,
  // with the same feature scale on every display
  let p = (fc.xy + u.scroll) / max(u.dpr, 1.0);
  let t = u.time;
  // gentle scale wander baked into the shader (two incommensurate sines, as ever)
  let wander = 1.0 + 0.18 * sin(t * 0.61) + 0.10 * sin(t * 1.41);
  // warp field with its own slow time
  let w = vec2f(
    fbm2(vec3f(p * 0.03, 11.3 + t * 0.16)),
    fbm2(vec3f(p * 0.03, 27.7 + t * 0.16)));
  let q = p + (w - vec2f(0.5)) * 60.0 * wander;
  // base marble, evolving on the time axis — the thing feTurbulence never had
  let f = fbm4(vec3f(q * 0.012, t * 0.09));
  var g : f32;
  if (u.dark > 0.5) {
    g = zigzag(f, 0.467, 1.0, 0.667, 0.867, 0.533, 1.0); // #777777 – #ffffff on black
  } else {
    g = zigzag(f, 0.533, 0.0, 0.333, 0.133, 0.467, 0.0); // #000000 – #888888 on white
  }
  return vec4f(vec3f(g) * a, a); // premultiplied
}
`;

  // Per-font metrics cache: anchoring glyphs to the true BASELINE (rect bottom minus the
  // font's descent) instead of textBaseline:"top" — canvas's "top" and the DOM line box
  // disagree by a few px of ascent bookkeeping, which read as "everything slightly low".
  var fontMetrics = {};
  function metricsFor(ctx) {
    var key = ctx.font;
    var m = fontMetrics[key];
    if (!m) {
      var t = ctx.measureText("Hgjp");
      m = fontMetrics[key] = {
        desc: (t.fontBoundingBoxDescent !== undefined) ? t.fontBoundingBoxDescent : null,
      };
    }
    return m;
  }

  // Glyphs of one element, per text-fragment rect (kerning/wrap are the DOM's own),
  // anchored to the true baseline via measured font descent. `scale` is for text under a
  // CSS transform (the presentations' reveal decks scale their slides): the rects come back
  // transformed, the computed font-size does not. text-transform is applied by hand —
  // nodeValue is the source text, the DOM shows the transformed one.
  function drawTextGlyphs(ctx, el, scale) {
    scale = scale || 1;
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    var range = document.createRange();
    for (var n; (n = walker.nextNode()); ) {
      if (!n.nodeValue.trim()) continue;
      var pcs = getComputedStyle(n.parentElement);
      ctx.font = pcs.fontStyle + " " + pcs.fontWeight + " " + (parseFloat(pcs.fontSize) * scale) + "px " + pcs.fontFamily;
      var tt = pcs.textTransform;
      var text = n.nodeValue;
      // iterate by GRAPHEME CLUSTER, not char: splitting a Range inside a cluster
      // (variation selectors — the ☀︎ toggle! — surrogate pairs, combining marks) yields
      // zero rects on platforms that shape atomically, and the glyph silently vanishes.
      // Extend the range until the browser hands us a box, then draw the whole cluster.
      var i = 0;
      while (i < text.length) {
        var j = i + 1;
        if (text[i] === " " || text[i] === "\n" || text[i] === "\t") { i = j; continue; }
        range.setStart(n, i); range.setEnd(n, j);
        var cr = range.getClientRects()[0];
        while ((!cr || cr.width <= 0) && j < text.length) {
          j++;
          range.setEnd(n, j);
          cr = range.getClientRects()[0];
        }
        if (cr && cr.width > 0) {
          ctx.fillStyle = "#000";
          var fm = metricsFor(ctx);
          if (fm.desc !== null) {
            ctx.textBaseline = "alphabetic";
            ctx.fillText(cased(text, i, j, tt), cr.left, cr.bottom - fm.desc);
          } else { // ancient browser: the old approximation
            ctx.textBaseline = "top";
            ctx.fillText(cased(text, i, j, tt), cr.left, cr.top);
          }
        }
        i = j;
      }
    }
  }

  function cased(text, i, j, tt) {
    var c = text.slice(i, j);
    if (tt === "uppercase") return c.toUpperCase();
    if (tt === "lowercase") return c.toLowerCase();
    if (tt === "capitalize" && (i === 0 || /\s/.test(text[i - 1]))) return c.toUpperCase();
    return c;
  }

  // Draw one element's alpha into a stencil. Coordinates are viewport-space; the caller's
  // transform maps them into the document-anchored strip. cullTop/cullBottom bound the
  // strip in viewport space.
  function drawElementAlpha(ctx, el, cullTop, cullBottom) {
    var isBox = el.classList && (el.classList.contains("fc-slab") || el.classList.contains("fc-ring") ||
                el.classList.contains("fc-bullet") || el.tagName === "HR");
    var r = el.getBoundingClientRect();
    if (r.bottom < cullTop || r.top > cullBottom || r.width <= 0) return;
    var cs = getComputedStyle(el);
    if (isBox) {
      // border-radius 50% (the bullet discs) parses as NaN px — draw a true circle
      if (el.classList.contains("fc-bullet")) {
        ctx.fillStyle = "#000";
        ctx.beginPath();
        ctx.arc(r.left + r.width / 2, r.top + r.height / 2, r.width / 2, 0, 7);
        ctx.fill();
        return;
      }
      var rad = parseFloat(cs.borderRadius) || 0;
      if (el.classList.contains("fc-ring")) { // frame only: stroke, transparent interior
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#000";
        ctx.beginPath();
        ctx.roundRect(r.left + 1, r.top + 1, r.width - 2, r.height - 2, Math.max(0, rad - 1));
        ctx.stroke();
      } else {
        ctx.fillStyle = "#000";
        ctx.beginPath();
        ctx.roundRect(r.left, r.top, r.width, r.height, rad);
        ctx.fill();
      }
      // tag slabs: punch the label's glyphs OUT of the marble — the true knockout (the
      // DOM label underneath is page-coloured, so the holes read as the page itself)
      if (el.classList.contains("fc-slab")) {
        var label = el.nextElementSibling;
        if (label && !label.classList.contains("fc-slab")) {
          ctx.globalCompositeOperation = "destination-out";
          drawTextGlyphs(ctx, label);
          ctx.globalCompositeOperation = "source-over";
        }
      }
      return;
    }
    // heading underline (h1 keeps its rule): draw the border band
    var bw = parseFloat(cs.borderBottomWidth);
    if (bw > 0) ctx.fillRect(r.left, r.bottom - bw, r.width, bw);
    // blockquote's left border
    var blw = parseFloat(cs.borderLeftWidth);
    if (blw > 0) ctx.fillRect(r.left, r.top, blw, r.height);
    drawTextGlyphs(ctx, el);
  }

  // The shader and the glyph raster, for other engines on the same field: the
  // presentations repo's reveal plugin (resources/field.js there) gets this file through
  // the build's public/field-gpu.js, like it gets presentations-index.html.
  window.__fieldGPUCore = { WGSL: WGSL, drawTextGlyphs: drawTextGlyphs };

  var DIAG = window.__fieldGPUDiag = [];
  function diag(m) { DIAG.push(m); }

  window.__fieldGPUInit = async function (cfg) {
    var cleanup = [];
    try {
      diag("init start, els=" + cfg.els.length);
      if (!navigator.gpu) { diag("no navigator.gpu"); return false; }
      var adapter = await navigator.gpu.requestAdapter();
      if (!adapter) { diag("adapter: null"); return false; }
      diag("adapter ok" + (adapter.info ? " (" + (adapter.info.description || adapter.info.vendor || "?") + ")" : ""));
      var device = await adapter.requestDevice();
      diag("device ok");
      device.addEventListener && device.addEventListener("uncapturederror", function (e) {
        diag("UNCAPTURED: " + (e.error && e.error.message ? e.error.message.slice(0, 300) : e.error));
      });

      var format = navigator.gpu.getPreferredCanvasFormat();
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var module = device.createShaderModule({ code: WGSL });
      module.getCompilationInfo && module.getCompilationInfo().then(function (info) {
        info.messages.forEach(function (m) {
          diag("WGSL " + m.type + " L" + m.lineNum + ": " + m.message.slice(0, 200));
        });
      });
      var pipeline = device.createRenderPipeline({
        layout: "auto",
        vertex: { module: module, entryPoint: "vmain" },
        fragment: { module: module, entryPoint: "fmain",
          targets: [{ format: format,
            blend: { color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
                     alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" } } }] },
        primitive: { topology: "triangle-list" },
      });
      var sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });

      // One scratch 2D canvas, reused for every strip's stencil raster.
      // willReadFrequently: getImageData is this canvas's whole job — keep it CPU-backed
      // so each read isn't a GPU readback stall.
      var scratch = document.createElement("canvas");
      var sctx = scratch.getContext("2d", { willReadFrequently: true });

      var reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      var strips = [], observer = null;
      var frames = 0, dead = false;

      function destroyStrips() {
        if (observer) { observer.disconnect(); observer = null; }
        strips.forEach(function (s) {
          try { if (s.tex) s.tex.destroy(); } catch (_) {}
          s.canvas.remove();
        });
        strips = [];
      }
      cleanup.push(destroyStrips);

      // Fixed document-space grid; a canvas only where ink exists. Strips are clamped to
      // the document's natural size (measured with no strips in the DOM, so we never
      // measure our own overhang — an absolutely-positioned box that sticks out past the
      // page EXTENDS the scrollable area).
      function buildStrips() {
        destroyStrips();
        var docH = document.documentElement.scrollHeight;
        var docW = document.documentElement.scrollWidth;
        var sx = window.scrollX, sy = window.scrollY;
        var PAD = 8; // ink bleed: descenders/antialiasing at strip and side edges
        var rects = [];
        var left = Infinity, right = -Infinity, bottom = 0;
        cfg.els.forEach(function (el) {
          var r = el.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) return;
          var d = { top: r.top + sy, bottom: r.bottom + sy };
          rects.push(d);
          left = Math.min(left, r.left + sx);
          right = Math.max(right, r.right + sx);
          bottom = Math.max(bottom, d.bottom);
        });
        if (!rects.length) { diag("no target rects"); return; }
        left = Math.max(0, Math.floor(left - PAD));
        right = Math.min(docW, Math.ceil(right + PAD)); // never widen the scrollable area
        var w = Math.max(1, right - left);
        var H = Math.max(512, Math.min(1024, Math.round(innerHeight * 0.75)));
        var n = Math.ceil(Math.min(bottom + PAD, docH) / H);
        observer = new IntersectionObserver(onNear, { rootMargin: "100% 0px" });
        var made = 0;
        for (var i = 0; i < n; i++) {
          var top = i * H;
          var h = Math.min(H, docH - top);
          if (h <= 0) break;
          var inked = rects.some(function (r) { return r.bottom + PAD > top && r.top - PAD < top + h; });
          if (!inked) continue;
          var c = document.createElement("canvas");
          c.width = Math.max(1, Math.floor(w * dpr));
          c.height = Math.max(1, Math.floor(h * dpr));
          c.style.cssText = "position:absolute;pointer-events:none;z-index:4;" +
            "left:" + left + "px;top:" + top + "px;width:" + w + "px;height:" + h + "px";
          c.setAttribute("aria-hidden", "true");
          document.body.appendChild(c);
          var s = { left: left, top: top, w: w, h: h, canvas: c, gctx: null,
                    ubuf: null, tex: null, bindGroup: null,
                    configured: false, rastered: false, near: false };
          c.__fcStrip = s;
          strips.push(s);
          observer.observe(c);
          made++;
        }
        diag("strips " + made + "/" + n + " inked, " + w + "x" + H + " @x" + left);
      }

      // Wake = configure the swapchain (cheap churn, but OFF-SCREEN thanks to the
      // observer margin) and, first time only, raster this strip's stencil.
      function wake(s) {
        if (!s.configured) {
          if (!s.gctx) s.gctx = s.canvas.getContext("webgpu");
          if (!s.gctx) return;
          s.gctx.configure({ device: device, format: format, alphaMode: "premultiplied" });
          s.configured = true;
        }
        if (!s.rastered) rasterStrip(s);
      }

      function rasterStrip(s) {
        scratch.width = s.canvas.width;  // also resets state + clears
        scratch.height = s.canvas.height;
        var sx = window.scrollX, sy = window.scrollY;
        // map viewport-space drawing into this strip's document window
        sctx.setTransform(dpr, 0, 0, dpr, (sx - s.left) * dpr, (sy - s.top) * dpr);
        var cullTop = s.top - sy, cullBottom = cullTop + s.h;
        cfg.els.forEach(function (el) { drawElementAlpha(sctx, el, cullTop, cullBottom); });
        // raw-bytes upload (writeTexture), not copyExternalImageToTexture: the blit path
        // kills software WebGPU implementations, and the data path is universal
        var img = sctx.getImageData(0, 0, scratch.width, scratch.height);
        s.tex = device.createTexture({
          size: [scratch.width, scratch.height],
          format: "rgba8unorm",
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
        device.queue.writeTexture({ texture: s.tex }, img.data,
          { bytesPerRow: scratch.width * 4, rowsPerImage: scratch.height },
          [scratch.width, scratch.height]);
        s.ubuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        s.bindGroup = device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: s.ubuf } },
            { binding: 1, resource: s.tex.createView() },
            { binding: 2, resource: sampler },
          ],
        });
        s.rastered = true;
      }

      function onNear(entries) {
        entries.forEach(function (en) {
          var s = en.target.__fcStrip;
          if (!s) return;
          s.near = en.isIntersecting;
          if (s.near) wake(s);
          else if (s.configured && s.gctx && s.gctx.unconfigure) {
            s.gctx.unconfigure(); // release the swapchain; stencil texture stays
            s.configured = false;
          }
        });
        if (reduced) requestAnimationFrame(frame); // render freshly-woken strips once
      }

      // The observer fires asynchronously — at boot and after swaps, wake in-view strips
      // by geometry so the very next painted frame has ink (the swap must be atomic).
      function wakeVisible() {
        var sy = window.scrollY, vh = innerHeight;
        strips.forEach(function (s) {
          if (s.top < sy + 2 * vh && s.top + s.h > sy - vh) { s.near = true; wake(s); }
        });
      }

      // originals go invisible-but-real: text keeps layout/selection, boxes keep geometry
      function inkEls(els) {
        els.forEach(function (el) {
          var prev = el.getAttribute("style") || "";
          cleanup.push(function () { el.setAttribute("style", prev); });
          if (el.classList.contains("fc-slab") || el.classList.contains("fc-ring") ||
              el.classList.contains("fc-bullet") || el.tagName === "HR") {
            el.style.opacity = "0";
          } else {
            el.style.color = "transparent";
            el.style.borderColor = "transparent";
          }
        });
      }
      inkEls(cfg.els);

      // Adopt a new element set after a content swap (spa-nav.js): ink only the newcomers
      // (re-inking a survivor would capture our own transparent style as its "restore"
      // state), then rebuild the grid — the document layout changed.
      window.__fieldGPURefresh = function (els) {
        if (dead) return;
        inkEls(els.filter(function (el) { return cfg.els.indexOf(el) === -1; }));
        cfg.els = els;
        rebuild(); // hoisted: defined below with the resize plumbing
      };

      // Full rebuild: re-capture dpr FIRST — browser zoom changes devicePixelRatio, and
      // rastering at the stale ratio leaves the ink blurry at the new zoom level.
      function rebuild() {
        if (dead) return;
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        buildStrips();
        wakeVisible();
        if (reduced) requestAnimationFrame(frame);
      }

      buildStrips();
      wakeVisible();
      diag("built, dpr" + dpr);

      // LEADING-EDGE throttle, not a debounce: a discrete resize (zoom step, maximize)
      // rebuilds on THIS event — no visible settle lag. Continuous drags rebuild at most
      // every 150ms, plus a trailing pass so the final size always lands exact.
      var resizeT = null, lastBuild = 0;
      window.addEventListener("resize", function () {
        clearTimeout(resizeT);
        var now = performance.now();
        if (now - lastBuild > 150) {
          lastBuild = now;
          rebuild();
        } else {
          resizeT = setTimeout(function () { lastBuild = performance.now(); rebuild(); }, 150);
        }
      });
      // Late layout shifts (images without reserved height) move the ink after boot;
      // one rebuild when everything has arrived covers it.
      if (document.readyState !== "complete") {
        window.addEventListener("load", function () { rebuild(); }, { once: true });
      }
      new MutationObserver(function () {
        // theme is a shader uniform, not a stencil property — reduced mode just needs
        // one frame to repaint with the other palette
        if (reduced) requestAnimationFrame(frame);
      }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

      // Field clock: resumes at the phase the PREVIOUS page saved (sessionStorage), so a
      // navigation freezes the ink mid-pattern and the next page picks it up exactly there.
      // Frozen, not wall-clock-advanced: the last rendered frame is what a view transition
      // holds on screen during the switch, so resuming AT it (t0 anchors to our first
      // frame, load time excluded) is the seamless choice — advancing by elapsed time
      // would visibly jump. The 1e5 cap (~7h of animation) keeps t in f32-friendly range.
      var tBase = 0, tNow = 0, t0 = null;
      try { tBase = parseFloat(sessionStorage.getItem("fc-clock")) || 0; } catch (_) {}
      if (!isFinite(tBase) || tBase < 0 || tBase > 1e5) tBase = 0;
      window.addEventListener("pagehide", function () {
        try { sessionStorage.setItem("fc-clock", String(tNow)); } catch (_) {}
      });

      var uf = new Float32Array(8);
      function frame(now) {
        if (dead) return; // device lost: stop submitting to a corpse
        frames++;
        if (frames === 1 || frames === 60) diag("frame " + frames + " @" + Math.round(now) + "ms");
        var dark = document.documentElement.getAttribute("data-theme") === "dark" ? 1 : 0;
        if (t0 === null) t0 = now;
        tNow = tBase + ((now - t0) / 1000) * 4;
        var enc = null;
        strips.forEach(function (s) {
          if (!s.near || !s.configured || !s.rastered) return;
          uf[0] = s.left * dpr; uf[1] = s.top * dpr;
          uf[2] = s.canvas.width; uf[3] = s.canvas.height;
          uf[4] = tNow; uf[5] = dark; uf[6] = dpr;
          device.queue.writeBuffer(s.ubuf, 0, uf);
          if (!enc) enc = device.createCommandEncoder();
          var pass = enc.beginRenderPass({ colorAttachments: [{
            view: s.gctx.getCurrentTexture().createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }] });
          pass.setPipeline(pipeline);
          pass.setBindGroup(0, s.bindGroup);
          pass.draw(3);
          pass.end();
        });
        if (enc) device.queue.submit([enc.finish()]);
        if (!reduced) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);

      device.lost.then(function (info) {
        // GPU went away mid-flight (driver reset, tab eviction, software-renderer giving
        // up): restore the DOM ink and hand control back — never leave a bare page.
        dead = true;
        diag("DEVICE LOST after " + frames + " frames: " + info.reason + " " + (info.message || "").slice(0, 200));
        cleanup.forEach(function (f) { try { f(); } catch (_) {} });
        if (cfg.onLost) cfg.onLost();
      });
      diag("init complete");
      return true;
    } catch (e) {
      diag("THREW: " + (e && e.message ? e.message.slice(0, 300) : e));
      cleanup.forEach(function (f) { try { f(); } catch (_) {} });
      return false;
    }
  };
})();
