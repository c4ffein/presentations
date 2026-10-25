// resources/field.js on a built deck: the living-ink stencil must BE the text.
// Each test screenshots one heading twice — ?field=off (the DOM's own glyphs) and
// ?field=mask (the stencil in flat ink, DOM text transparent) — reduces both to
// ink / paper and compares them. The browser rasters its text with its own
// sub-pixel habits (hinting at the layout size, then reveal's scale), so the two
// may sit up to ~0.7px apart depending on the window size: invisible, the DOM text
// is transparent. Hence: the overlap (intersection over union) at the best shift
// within 1px must be close to 1, and the ink centres within 1px of each other. A
// stencil drawn at the wrong size, baseline, case or font drifts along the line and
// fails both. FIELD_DIFF=1 writes the diff image of each test (unshifted) to
// tests/e2e/screenshots/ (red: only the text has ink there, blue: only the stencil).
//
// Needs WebGPU in the headless Chromium: SwiftShader's Vulkan, through the flags
// below. Without an adapter the plugin stays off and the tests fail saying so.
import { test, expect, beforeAll, afterAll } from "bun:test";
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { startServer } from "./server.js";

const DECK = "slides/vibe-coding-vs-vibe-engineering.html";
const MIN_IOU = 0.9;
let server, browser;

beforeAll(async () => {
  server = startServer();
  browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM || undefined,
    args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-vulkan=swiftshader",
           "--use-angle=swiftshader", "--disable-vulkan-surface", "--ignore-gpu-blocklist"],
  });
});
afterAll(async () => { await browser?.close(); server?.stop(true); });

// One heading of slide `hash` under ?field=<mode>, as a PNG of its box (+ a margin).
// slowFonts: the deck's webfont answers 1.5 s late, after reveal is ready — the race
// that left a stencil in the fallback font (Helvetica's widths, other line breaks).
async function shoot(hash, selector, mode, slowFonts) {
  // a projector's 1080p: reveal scales the slides by ~1.5, so a stencil that ignores the scale shows
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  if (slowFonts) {
    await page.route("**/fonts/source-sans-pro/**", async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
  }
  await page.goto(`http://localhost:${server.port}/${DECK}?theme=light&field=${mode}#/${hash}`);
  await page.waitForFunction(() => window.Reveal && Reveal.isReady());
  await page.evaluate(() => document.fonts.ready);
  if (mode === "mask") {
    const inked = await page.waitForFunction((sel) => {
      const el = Reveal.getCurrentSlide().querySelector(sel);
      return el && el.classList.contains("fc-inked");
    }, selector, { timeout: 10_000 }).then(() => true, () => false);
    if (!inked) {
      const gpu = await page.evaluate(async () => !!(navigator.gpu && await navigator.gpu.requestAdapter()));
      throw new Error(gpu ? "field never inked " + selector : "no WebGPU adapter in this Chromium: the field cannot run");
    }
    // every font in, then two frames: the stencil is uploaded, then drawn
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  }
  // the curtain (theme.js / theme.css) covers the page until the fonts are in: wait it out
  await page.waitForFunction(() => !document.documentElement.classList.contains("curtain"), null, { timeout: 10_000 });
  const box = await page.evaluate((sel) => {
    const r = Reveal.getCurrentSlide().querySelector(sel).getBoundingClientRect();
    return { x: Math.floor(r.left) - 6, y: Math.floor(r.top) - 6, width: Math.ceil(r.width) + 12, height: Math.ceil(r.height) + 12 };
  }, selector);
  const png = await page.screenshot({ clip: box });
  expect(errors).toEqual([]);
  await page.close();
  return png;
}

// Ink / paper per pixel in both, overlap ratio, and the diff as a PNG — computed in a page.
async function compare(textPng, maskPng) {
  const page = await browser.newPage();
  const out = await page.evaluate(async ([a, b]) => {
    const load = (b64) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = "data:image/png;base64," + b64; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const w = ia.width, h = ia.height;
    const px = (img) => { const c = new OffscreenCanvas(w, h), x = c.getContext("2d"); x.drawImage(img, 0, 0); return x.getImageData(0, 0, w, h).data; };
    const da = px(ia), db = px(ib);
    const ink = (d) => { const m = new Uint8Array(w * h); for (let i = 0; i < m.length; i++) m[i] = (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 3 < 128; return m; };
    const A = ink(da), B = ink(db);
    // overlap with the stencil shifted by (dx, dy), away from the borders
    const iouAt = (dx, dy) => {
      let both = 0, either = 0;
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const p = A[y * w + x], q = B[(y + dy) * w + x + dx];
        both += p && q; either += p || q;
      }
      return either ? both / either : 0;
    };
    let iou = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) iou = Math.max(iou, iouAt(dx, dy));
    // ink centre, weighted by darkness
    const centre = (d) => { let sx = 0, sy = 0, sw = 0; for (let i = 0; i < w * h; i++) { const v = 255 - (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 3; sx += v * (i % w); sy += v * Math.floor(i / w); sw += v; } return [sx / sw, sy / sw]; };
    const ca = centre(da), cb = centre(db);
    const c = new OffscreenCanvas(w, h), x = c.getContext("2d"), diff = x.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      diff.data.set(A[i] && B[i] ? [0, 0, 0, 255] : A[i] ? [255, 0, 0, 255] : B[i] ? [0, 0, 255, 255] : [255, 255, 255, 255], i * 4);
    }
    x.putImageData(diff, 0, 0);
    const blob = await c.convertToBlob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = ""; for (const byte of bytes) s += String.fromCharCode(byte);
    return { iou, dx: cb[0] - ca[0], dy: cb[1] - ca[1], diff: btoa(s) };
  }, [textPng.toString("base64"), maskPng.toString("base64")]);
  await page.close();
  return out;
}

async function check(name, hash, selector, slowFonts) {
  const { iou, dx, dy, diff } = await compare(await shoot(hash, selector, "off"), await shoot(hash, selector, "mask", slowFonts));
  if (process.env.FIELD_DIFF) {
    const dir = path.join(import.meta.dir, "screenshots");
    mkdirSync(dir, { recursive: true });
    await Bun.write(path.join(dir, `field-${name}.png`), Buffer.from(diff, "base64"));
  }
  console.log(`field ${name}: overlap ${iou.toFixed(3)}, stencil centre offset ${dx.toFixed(2)}, ${dy.toFixed(2)} px`);
  expect(iou).toBeGreaterThan(MIN_IOU);
  expect(Math.abs(dx)).toBeLessThan(1);
  expect(Math.abs(dy)).toBeLessThan(1);
}

test("title slide: the stencil of the h1 matches its text", async () => {
  await check("title", "0", "h1");
}, 60_000);

test("first slide: the stencil of its title matches the text", async () => {
  await check("first-slide", "1", "h3");
}, 60_000);

test("late webfont: the stencil is redrawn in the real font, not left in the fallback", async () => {
  await check("late-font", "0", "h1", true);
}, 60_000);
