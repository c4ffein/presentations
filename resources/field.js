/* field.js — reveal.js plugin: the site's "living ink" on a deck's headings.
 *
 * The writings site paints its chrome (nav, headings, rules) with a WebGPU field:
 * the real text goes transparent and a shader fills the glyphs' shapes with a
 * slowly moving grey marble. This plugin puts the same field on the slides'
 * headings. The shader and the glyph raster are NOT copied here: they come from
 * resources/field-gpu.js, the writings repo's own engine, curled from its build
 * like index.html (see README). That file defines window.__fieldGPUCore = { WGSL,
 * drawTextGlyphs }; its strip engine (made for a scrolling page) is unused here.
 *
 * Same principle as the site's strips, which is why its scrolling is smooth: the
 * canvas lives IN the moving content and is never redrawn while it moves. Here,
 * one canvas per inked slide, inside its <section>: reveal's transitions transform
 * the section, the compositor carries the canvas with the text (translation, fade,
 * the overview's zoom) — no script in the loop, nothing can trail. The stencil is
 * rastered once, at rest, for the present slide and its neighbours (the ones a
 * keypress brings in), so a slide arrives already inked; far slides release their
 * swapchain and keep their stencil, like the site's far strips.
 *
 * Inked: config `selector` (default h1, h2, h3, blockquote) inside the slides, except in a
 * fragment (its own fade would need its own stencil timing) or in a code block /
 * terminal transcript. Never runs in the speaker view's copies (?receiver), in
 * PDF export (?print-pdf), with ?field=off, or without WebGPU: the headings then
 * keep their ink.
 *
 * ?field=mask paints the stencil in flat ink instead of the marble: the e2e tests
 * (src/tests/e2e/field.test.js) compare it pixel by pixel with the real text.
 *
 * Every deck gets it: resources/theme.js (in every deck's <head>) loads field-gpu.js
 * and this file, which attaches itself to the deck (see the end). A deck can set, in
 * its Reveal.initialize:
 *   field: { selector: "h1, h2, h3, blockquote" },   // what to ink (this is the default)
 *   field: false,                                    // no field on this deck
 */
(function () {
  "use strict";

  // ink bleed past the section's sides (antialiasing). Sides only: reveal centres a slide
  // from its scrollHeight, and a canvas sticking out below would shift the slide.
  var PAD = 8;

  var MASK_WGSL = `
@fragment
fn fmask(@builtin(position) fc : vec4f) -> @location(0) vec4f {
  let a = textureSample(atlasTex, smp, fc.xy / u.size).a;
  return vec4f(vec3f(u.dark * a), a); // black on light, white on dark, premultiplied
}
`;

  function RevealField() {
    var deck, cfg, core, mask;
    var device, pipeline, sampler, format, scratch, sctx;
    var strips = new Map(); // section -> strip
    var settleToken = 0, dead = false;
    var tBase = 0, tNow = 0, t0 = null;
    var reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    var uf = new Float32Array(8);

    function init(d) {
      deck = d;
      if (deck.getConfig().field === false) return; // a deck that opts out
      cfg = Object.assign({ selector: "h1, h2, h3, blockquote" }, deck.getConfig().field || {});
      var q = new URLSearchParams(location.search);
      if (q.get("field") === "off" || q.has("print-pdf") || /receiver/i.test(location.search)) return;
      mask = q.get("field") === "mask";
      core = window.__fieldGPUCore;
      if (!navigator.gpu || !core) return;
      // not returned: reveal would wait for the GPU before showing the deck
      boot().catch(function () { teardown(); });
    }

    async function boot() {
      var adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return;
      device = await adapter.requestDevice();
      format = navigator.gpu.getPreferredCanvasFormat();
      // mask: one more entry point on the core's own bindings (u, atlasTex, smp)
      var module = device.createShaderModule({ code: core.WGSL + (mask ? MASK_WGSL : "") });
      pipeline = device.createRenderPipeline({
        layout: "auto",
        vertex: { module: module, entryPoint: "vmain" },
        fragment: { module: module, entryPoint: mask ? "fmask" : "fmain",
          targets: [{ format: format,
            blend: { color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
                     alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" } } }] },
        primitive: { topology: "triangle-list" },
      });
      sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });
      scratch = document.createElement("canvas");
      sctx = scratch.getContext("2d", { willReadFrequently: true });
      var st = document.createElement("style");
      st.textContent = ".fc-inked, .fc-inked * { color: transparent !important; }";
      document.head.appendChild(st);

      // same clock as the site (sessionStorage, same origin): from the index to a deck,
      // the marble goes on where it was
      try { tBase = parseFloat(sessionStorage.getItem("fc-clock")) || 0; } catch (_) {}
      if (!isFinite(tBase) || tBase < 0 || tBase > 1e5) tBase = 0;
      window.addEventListener("pagehide", function () {
        try { sessionStorage.setItem("fc-clock", String(tNow)); } catch (_) {}
      });

      // Prepare at rest only: rastering costs a frame or two, never spend it mid-transition.
      deck.on("slidechanged", function () {
        var token = ++settleToken;
        var speed = { fast: 400, slow: 1200 }[deck.getConfig().transitionSpeed] || 800;
        setTimeout(function () { settle(token); }, speed + 150); // backs slidetransitionend
      });
      deck.on("slidetransitionend", function () { settle(settleToken); });
      deck.on("resize", function () {
        strips.forEach(function (s) { s.rastered = false; });
        settle(++settleToken);
      });
      device.lost.then(function () { teardown(); });

      // Fonts: a stencil rastered before the webfont arrives is drawn in the fallback
      // (Source Sans Pro -> Helvetica: wider, other line breaks) and stays so. Wait for the
      // fonts in use, and redraw everything whenever one finishes later (a quote's italic).
      if (document.fonts) {
        await document.fonts.ready;
        document.fonts.addEventListener("loadingdone", function () {
          strips.forEach(function (s) { if (s) s.rastered = false; });
          settle(++settleToken);
        });
      }
      if (deck.isReady()) settle(++settleToken); else deck.on("ready", function () { settle(++settleToken); });
      requestAnimationFrame(frame);
    }

    function teardown() {
      dead = true;
      strips.forEach(function (s) { unink(s); s.canvas.remove(); });
      strips.clear();
    }

    function targets(slide) {
      return Array.prototype.filter.call(slide.querySelectorAll(cfg.selector), function (el) {
        return el.closest("section") === slide && !el.closest(".fragment, pre, .claude-terminal");
      });
    }

    // The present slide and the ones a single keypress brings in.
    function near() {
      var out = [], cur = deck.getCurrentSlide();
      if (!cur) return out;
      var idx = deck.getIndices(), hs = deck.getHorizontalSlides();
      out.push(cur);
      [idx.h - 1, idx.h + 1].forEach(function (h) {
        var s = hs[h];
        if (!s) return;
        var leaf = s.querySelector(":scope > section.present") || s.querySelector(":scope > section") || s;
        out.push(leaf);
      });
      if (cur.parentElement && cur.parentElement.tagName === "SECTION") {
        if (cur.previousElementSibling) out.push(cur.previousElementSibling);
        if (cur.nextElementSibling) out.push(cur.nextElementSibling);
      }
      return out;
    }

    function settle(token) {
      if (dead || token !== settleToken) return;
      var want = near();
      strips.forEach(function (s, slide) {
        if (!s || want.indexOf(slide) !== -1) return; // null = a slide with nothing to ink
        if (s.configured) {
          s.gctx.unconfigure(); // release the swapchain; the stencil texture stays
          s.configured = false;
        }
        unink(s); // a far slide (overview) shows its own ink, not an unrendered canvas
      });
      want.forEach(function (slide) {
        var s = strips.get(slide);
        if (s === null) return; // known: nothing to ink
        if (!s) {
          var els = targets(slide);
          if (!els.length) { strips.set(slide, null); return; }
          s = make(slide, els);
        }
        if (!s.rastered) raster(s);
        if (!s.configured) {
          s.gctx.configure({ device: device, format: format, alphaMode: "premultiplied" });
          s.configured = true;
        }
        if (s.texReady) s.els.forEach(function (el) { el.classList.add("fc-inked"); });
      });
    }

    function make(slide, els) {
      var c = document.createElement("canvas");
      c.className = "fc-field";
      c.setAttribute("aria-hidden", "true");
      c.style.cssText = "position:absolute;pointer-events:none;z-index:1;margin:0;max-width:none;max-height:none;" +
        "left:" + -PAD + "px;top:0;width:calc(100% + " + 2 * PAD + "px);height:100%";
      slide.appendChild(c);
      var idx = deck.getIndices(slide);
      var s = { slide: slide, els: els, canvas: c, gctx: c.getContext("webgpu"),
                tex: null, ubuf: null, bindGroup: null, ratio: 1,
                // each slide its own patch of the field
                seed: [(idx.h || 0) * 1237 + 311, (idx.v || 0) * 911 + 97],
                configured: false, rastered: false, texReady: false };
      strips.set(slide, s);
      return s;
    }

    function unink(s) { if (s) s.els.forEach(function (el) { el.classList.remove("fc-inked"); }); }

    // Stencil in the canvas's own pixels: glyph rects (screen space, whatever transform
    // the slide has right now) mapped through the canvas's screen rect, which the same
    // transform moved — so it is exact at rest, wherever the slide sits.
    function raster(s) {
      var c = s.canvas, cr = c.getBoundingClientRect();
      if (cr.width <= 0 || c.offsetWidth <= 0) return; // display:none (beyond viewDistance)
      var screenScale = cr.width / c.offsetWidth;       // reveal's scale, as rendered
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      s.ratio = screenScale * dpr;                      // canvas px per slide px
      var w = Math.max(1, Math.round(c.offsetWidth * s.ratio));
      var h = Math.max(1, Math.round(c.offsetHeight * s.ratio));
      if (c.width !== w || c.height !== h || !s.tex) {
        c.width = w; c.height = h;
        if (s.tex) s.tex.destroy();
        s.tex = device.createTexture({ size: [w, h], format: "rgba8unorm",
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
        if (!s.ubuf) s.ubuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        s.bindGroup = device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: s.ubuf } },
            { binding: 1, resource: s.tex.createView() },
            { binding: 2, resource: sampler },
          ],
        });
        if (s.configured) { s.gctx.unconfigure(); s.configured = false; } // new size: reconfigure
      }
      scratch.width = w; scratch.height = h; // also clears
      var k = w / cr.width;
      sctx.setTransform(k, 0, 0, k, -cr.left * k, -cr.top * k);
      s.els.forEach(function (el) { core.drawTextGlyphs(sctx, el, screenScale); });
      var img = sctx.getImageData(0, 0, w, h);
      device.queue.writeTexture({ texture: s.tex }, img.data,
        { bytesPerRow: w * 4, rowsPerImage: h }, [w, h]);
      s.rastered = true;
      s.texReady = true;
    }

    function frame(now) {
      if (dead) return;
      if (t0 === null) t0 = now;
      tNow = reduced ? tBase : tBase + ((now - t0) / 1000) * 4;
      var dark = document.documentElement.getAttribute("data-theme") === "dark" ? 1 : 0;
      var enc = null;
      strips.forEach(function (s) {
        if (!s || !s.configured || !s.texReady) return;
        uf[0] = s.seed[0] * s.ratio; uf[1] = s.seed[1] * s.ratio;
        uf[2] = s.canvas.width; uf[3] = s.canvas.height;
        uf[4] = tNow; uf[5] = dark; uf[6] = s.ratio;
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
      requestAnimationFrame(frame);
    }

    return { id: "field", init: init };
  }

  window.RevealField = RevealField;

  // Auto-start: resources/theme.js loads this file into every deck, so no deck lists it
  // in its plugins. Reveal.initialize runs in the body's last script, i.e. before
  // DOMContentLoaded: from then on, attach to the page's deck once it is ready.
  function start() {
    var R = window.Reveal;
    if (!R || !R.isReady || (R.hasPlugin && R.hasPlugin("field"))) return; // no deck / registered by hand
    var go = function () { RevealField().init(R); };
    if (R.isReady()) go(); else R.on("ready", go);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
