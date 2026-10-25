// The curtain (resources/theme.js + theme.css) on a built deck: it covers the page
// until the fonts are in, then slides away and is removed; the fonts are made 1.5 s
// late here so "until" is observable. ?curtain=off never puts it up.
import { test, expect, beforeAll, afterAll } from "bun:test";
import { chromium } from "playwright";
import { startServer } from "./server.js";

const DECK = "slides/vibe-coding-vs-vibe-engineering.html";
let server, browser;

beforeAll(async () => {
  server = startServer();
  browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
});
afterAll(async () => { await browser?.close(); server?.stop(true); });

// What the curtain looks like right now: its classes, and where its box is.
const state = (page) => page.evaluate(() => ({
  cls: ["curtain", "curtain-open"].filter((c) => document.documentElement.classList.contains(c)),
  content: document.body ? getComputedStyle(document.body, "::before").content : "none",
  fontsIn: [...document.fonts].filter((f) => f.family.includes("Source Sans") && f.status === "loaded").length,
}));

test("holds until the fonts arrive, then opens and goes away", async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // only the font files, not the stylesheet next to them
  await page.route(/source-sans-pro-[\w-]+\.(woff|ttf|eot)/, async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await page.goto(`http://localhost:${server.port}/${DECK}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.Reveal && Reveal.isReady());

  let s = await state(page);
  expect(s.cls).toEqual(["curtain"]);   // up, not opening: the fonts are not in
  expect(s.content).toBe('""');         // and actually drawn
  expect(s.fontsIn).toBe(0);

  await page.waitForFunction(() => document.documentElement.classList.contains("curtain-open"), null, { timeout: 10_000 });
  s = await state(page);
  expect(s.fontsIn).toBeGreaterThan(0); // opened BECAUSE the fonts came

  await page.waitForFunction(() => !document.documentElement.classList.contains("curtain"), null, { timeout: 5_000 });
  expect((await state(page)).content).toBe("none");
  expect(errors).toEqual([]);
  await page.close();
}, 30_000);

test("?curtain=off: never up", async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  let seen = false;
  await page.exposeFunction("__curtainSeen", () => { seen = true; });
  await page.addInitScript(() => {
    new MutationObserver(() => { if (document.documentElement.classList.contains("curtain")) window.__curtainSeen(); })
      .observe(document, { attributes: true, subtree: true, attributeFilter: ["class"] });
  });
  await page.goto(`http://localhost:${server.port}/${DECK}?curtain=off`);
  await page.waitForFunction(() => window.Reveal && Reveal.isReady());
  expect(seen).toBe(false);
  await page.close();
}, 30_000);
