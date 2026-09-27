// resources/narration.js against tests/e2e/fixtures/narration.html: the
// recordings are silent WAVs the test server makes up. The variant file
// exists for "two" only, so "intro" must fall back to its plain file.
// Narration is off until ?narration is in the URL or N is pressed.
import { test, expect, beforeAll, afterAll } from "bun:test";
import { chromium } from "playwright";
import { startServer, silentWav } from "./server.js";

let server, browser;
const served = [];

beforeAll(async () => {
  server = startServer((url) => {
    const m = /^\/narration-fixture\/([\w-]+)\.(\w+)(?:\.(\w+))?\.wav$/.exec(url.pathname);
    if (!m) return null;
    const [, id, , variant] = m;
    if (variant && !(variant === "special" && id === "two")) return new Response("no variant", { status: 404 });
    served.push(url.pathname);
    return new Response(silentWav(), { headers: { "Content-Type": "audio/wav" } });
  });
  browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM || undefined,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
});
afterAll(async () => { await browser?.close(); server?.stop(true); });

const state = (page) => page.evaluate(() => Reveal.getPlugin("narration").state());

test("plays each recording in auto mode, variant first with fallback, silent slides skipped", async () => {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://localhost:${server.port}/tests/e2e/fixtures/narration.html?narration`);
  await page.waitForFunction(() => window.Reveal && Reveal.isReady());
  await page.waitForFunction(() => Reveal.getPlugin("narration").state().status === "ready");

  let s = await state(page);
  expect(s.id).toBe("intro");
  expect(s.src).toBe("/narration-fixture/intro.fr.wav");
  expect(s.attempts).toEqual(["/narration-fixture/intro.fr.special.wav", "/narration-fixture/intro.fr.wav"]);
  expect(s.paused).toBe(true);
  expect(await page.locator(".nar-panel").isVisible()).toBe(true);
  expect(await page.locator(".nar-status").textContent()).toBe("intro · ready");

  // Everything of the language is preloaded, current slide first.
  await page.waitForFunction(() => { const p = Reveal.getPlugin("narration").state().preload; return p && p.done === p.total; });
  expect((await state(page)).preload).toMatchObject({ lang: "fr", total: 4, done: 4, failed: 0 });
  expect(await page.locator(".nar-preload").textContent()).toBe("");

  await page.locator(".nar-auto-box").check();
  await page.waitForFunction(() => {
    const st = Reveal.getPlugin("narration").state();
    return Reveal.isLastSlide() && st.status === "ended" && !st.auto;
  }, null, { timeout: 30_000 });
  s = await state(page);
  expect(s.history).toEqual([
    "/narration-fixture/intro.fr.wav",
    "/narration-fixture/two.fr.special.wav",
    "/narration-fixture/two-more.fr.wav",
    "/narration-fixture/end.fr.wav",
  ]);
  expect(await page.evaluate(() => Reveal.getIndices())).toMatchObject({ h: 2 });

  // Language switch reloads the current slide's recording.
  await page.locator(".nar-lang[data-lang=en]").click();
  await page.waitForFunction(() => Reveal.getPlugin("narration").state().src === "/narration-fixture/end.en.wav");
  expect(await page.evaluate(() => localStorage.getItem("narration.lang"))).toBe('"en"');

  // Play button on a slide, no auto: plays that one only.
  await page.evaluate(() => Reveal.slide(0));
  await page.waitForFunction(() => Reveal.getPlugin("narration").state().src === "/narration-fixture/intro.en.wav");
  await page.locator(".nar-play").click();
  await page.waitForFunction(() => Reveal.getPlugin("narration").state().status === "ended");
  expect(await page.evaluate(() => Reveal.getIndices())).toMatchObject({ h: 0 });

  expect(errors).toEqual([]);
  await page.close();
});

test("the panel drags, collapses and remembers its place", async () => {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  await page.goto(`http://localhost:${server.port}/tests/e2e/fixtures/narration.html?narration`);
  await page.waitForFunction(() => window.Reveal && Reveal.isReady());
  const panel = page.locator(".nar-panel"), head = page.locator(".nar-head");
  const before = await panel.boundingBox();
  const hb = await head.boundingBox();
  await page.mouse.move(hb.x + 40, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + 40 - 200, hb.y + hb.height / 2 - 150, { steps: 5 });
  await page.mouse.up();
  const after = await panel.boundingBox();
  expect(Math.round(after.x)).toBe(Math.round(before.x - 200));
  expect(Math.round(after.y)).toBe(Math.round(before.y - 150));
  await page.locator(".nar-collapse").click();
  expect(await page.locator(".nar-body").isHidden()).toBe(true);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("narration.panel")));
  expect(saved.collapsed).toBe(true);
  expect(Math.round(saved.left)).toBe(Math.round(after.x));

  await page.reload();
  await page.waitForFunction(() => window.Reveal && Reveal.isReady());
  const again = await panel.boundingBox();
  expect(Math.round(again.x)).toBe(Math.round(after.x));
  expect(await page.locator(".nar-body").isHidden()).toBe(true);
  await page.close();
});

test("N hides and shows the panel, and no longer changes slide", async () => {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  await page.goto(`http://localhost:${server.port}/tests/e2e/fixtures/narration.html?narration`);
  await page.waitForFunction(() => window.Reveal && Reveal.isReady());
  const panel = page.locator(".nar-panel");
  expect(await panel.isVisible()).toBe(true);
  const h0 = await page.evaluate(() => Reveal.getIndices().h);
  await page.keyboard.press("n");
  expect(await panel.isVisible()).toBe(false);
  expect(await page.evaluate(() => Reveal.getIndices().h)).toBe(h0);
  expect((await state(page)).panelHidden).toBe(true);
  expect((await page.evaluate(() => JSON.parse(localStorage.getItem("narration.panel")))).hidden).toBe(true);
  await page.reload();
  await page.waitForFunction(() => window.Reveal && Reveal.isReady());
  expect(await panel.isVisible()).toBe(false);
  await page.keyboard.press("n");
  expect(await panel.isVisible()).toBe(true);
  await page.close();
});

test("nothing loads until N: N activates, writes ?narration, preloads; then the talk plays offline", async () => {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  const before = served.length;
  await page.goto(`http://localhost:${server.port}/tests/e2e/fixtures/narration.html`);
  await page.waitForFunction(() => window.Reveal && Reveal.isReady());
  expect(await page.locator(".nar-panel").count()).toBe(0);
  expect((await state(page)).active).toBe(false);
  expect(served.length).toBe(before);

  await page.keyboard.press("n");
  expect((await state(page)).active).toBe(true);
  expect(await page.locator(".nar-panel").isVisible()).toBe(true);
  expect(new URL(page.url()).searchParams.has("narration")).toBe(true);
  expect(await page.evaluate(() => Reveal.getIndices().h)).toBe(0);
  await page.waitForFunction(() => { const p = Reveal.getPlugin("narration").state().preload; return p && p.done === p.total; });
  expect(served.length - before).toBe(4);

  // Connection lost: every recording still plays, from memory.
  await page.route("**/narration-fixture/**", (route) => route.abort());
  await page.locator(".nar-auto-box").check();
  await page.waitForFunction(() => {
    const st = Reveal.getPlugin("narration").state();
    return Reveal.isLastSlide() && st.status === "ended" && !st.auto;
  }, null, { timeout: 30_000 });
  expect((await state(page)).history).toEqual([
    "/narration-fixture/intro.fr.wav",
    "/narration-fixture/two.fr.special.wav",
    "/narration-fixture/two-more.fr.wav",
    "/narration-fixture/end.fr.wav",
  ]);
  await page.close();
});
