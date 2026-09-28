// resources/menu.js against tests/e2e/fixtures/menu.html (which also has
// narration.js, recordings = silent WAVs the test server makes up).
import { test, expect, beforeAll, afterAll } from "bun:test";
import { chromium } from "playwright";
import { startServer, silentWav } from "./server.js";

let server, browser;
beforeAll(async () => {
  server = startServer((url) => /^\/narration-fixture\/[\w-]+\.\w+\.wav$/.test(url.pathname)
    ? new Response(silentWav(), { headers: { "Content-Type": "audio/wav" } }) : null);
  browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ["--autoplay-policy=no-user-gesture-required"] });
});
afterAll(async () => { await browser?.close(); server?.stop(true); });

const fixture = (q = "") => `http://localhost:${server.port}/src/tests/e2e/fixtures/menu.html${q}`;
const menu = (page) => page.evaluate(() => Reveal.getPlugin("menu").state());
const narration = (page) => page.evaluate(() => Reveal.getPlugin("narration").state());
const ready = (page) => page.waitForFunction(() => window.Reveal && Reveal.isReady());
const langs = (page) => page.evaluate(() => Array.from(document.querySelectorAll(".menu-lang")).map((l) => l.getAttribute("data-lang")));
const shown = (page, sel) => page.evaluate((s) => Array.from(document.querySelectorAll(s)).map((e) => e.style.display !== "none"), sel);

test("the burger shows on mouse move, fades after hideDelay, opens with a click or M, closes with Esc", async () => {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, locale: "fr-FR" });
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(fixture()); await ready(page);
  const burger = page.locator(".menu-burger"), panel = page.locator(".menu-panel");
  expect(await burger.isVisible()).toBe(false);
  await page.mouse.move(400, 300); await page.mouse.move(420, 310);
  await burger.waitFor({ state: "visible", timeout: 2000 });
  await burger.waitFor({ state: "hidden", timeout: 5000 });   // the fade is a CSS transition, then hideDelay

  await page.keyboard.press("m");
  await panel.waitFor({ state: "visible", timeout: 2000 });
  await burger.waitFor({ state: "visible", timeout: 2000 });   // shows with the panel, not after the fade
  expect(await page.locator(".menu-item").allTextContents()).toEqual(expect.arrayContaining([expect.stringContaining("Langues"), expect.stringContaining("Aide"), expect.stringContaining("Retour à la liste")]));
  // the list of talks is the deck's parent folder, wherever the site is served from
  expect(await page.locator("a.menu-index").getAttribute("href")).toBe(`http://localhost:${server.port}/src/tests/e2e/`);
  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "hidden", timeout: 2000 });
  await page.mouse.move(430, 320);
  await burger.click();
  await panel.waitFor({ state: "visible", timeout: 2000 });
  await page.mouse.click(700, 500);   // outside
  await panel.waitFor({ state: "hidden", timeout: 2000 });
  // not stuck: awake while open, then it fades again
  await burger.waitFor({ state: "hidden", timeout: 5000 });
  expect(errors).toEqual([]);
  await page.close();
});

test("language preferences: the window reorders, applies to slides and narration, persists across reloads", async () => {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, locale: "fr-FR" });
  await page.goto(fixture("?narration")); await ready(page);
  await page.waitForFunction(() => Reveal.getPlugin("narration").state().status === "ready");
  expect((await menu(page))).toMatchObject({ uiLang: "fr", slideLang: "fr", slideLangs: ["fr", "en"], audioLang: "fr", prefs: [], follows: { slides: true, audio: true } });
  expect(await shown(page, ".lang-fr")).toEqual([true, true]);
  expect(await shown(page, ".lang-en")).toEqual([false, false]);

  await page.keyboard.press("m");
  await page.locator(".menu-item", { hasText: "Langues" }).click();
  const win = page.locator('.menu-win[data-win="langs"]');
  expect(await win.isVisible()).toBe(true);
  expect(await page.locator(".menu-tab-on").getAttribute("data-tab")).toBe("interface");
  expect(await langs(page)).toEqual(["fr", "en"]);
  await page.locator('.menu-lang[data-lang="en"] .menu-up').click();
  expect(await langs(page)).toEqual(["en", "fr"]);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("presentations.langs")))).toEqual(["en", "fr"]);
  // slides and audio follow the interface by default
  expect(await menu(page)).toMatchObject({ uiLang: "en", slideLang: "en", audioLang: "en", follows: { slides: true, audio: true } });
  expect(await shown(page, ".lang-en")).toEqual([true, true]);
  expect(await shown(page, ".lang-fr")).toEqual([false, false]);
  await page.waitForFunction(() => Reveal.getPlugin("narration").state().src === "/narration-fixture/intro.en.wav");
  expect(await page.locator(".menu-win-title").textContent()).toBe("Preferred languages, in order");   // the window speaks the preferred language too
  // it floats: the keys still drive the deck; Esc closes it
  await page.keyboard.press("ArrowRight");
  expect(await page.evaluate(() => Reveal.getIndices().h)).toBe(1);
  await page.keyboard.press("Escape");
  expect(await win.count()).toBe(0);
  expect(await page.evaluate(() => Reveal.getIndices().h)).toBe(1);   // that Esc closed the window, not the deck's overview

  await page.reload(); await ready(page);
  expect(await menu(page)).toMatchObject({ slideLang: "en", audioLang: "en", prefs: ["en", "fr"] });
  expect(await shown(page, ".lang-en")).toEqual([true, true]);
  await page.waitForFunction(() => Reveal.getPlugin("narration").state().lang === "en");
  // the narration panel's own language button is an audio choice: audio gets its own list, the rest stays
  await page.locator(".nar-lang[data-lang=fr]").click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("presentations.langs.audio")))).toEqual(["fr", "en"]);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("presentations.langs")))).toEqual(["en", "fr"]);
  expect(await menu(page)).toMatchObject({ uiLang: "en", slideLang: "en", audioLang: "fr", follows: { slides: true, audio: false } });
  await page.close();
});

test("the Slides tab: untick 'same as the interface' to give the slides their own order", async () => {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, locale: "fr-FR" });
  await page.goto(fixture()); await ready(page);
  await page.evaluate(() => Reveal.getPlugin("menu").openWindow("langs"));
  await page.locator('.menu-tab[data-tab="slides"]').click();
  expect(await page.locator(".menu-follow-box").isChecked()).toBe(true);
  expect(await page.locator('.menu-lang[data-lang="en"] .menu-up').isDisabled()).toBe(true);   // following: read-only
  await page.locator(".menu-follow-box").uncheck();
  expect(await page.locator('.menu-lang[data-lang="en"] .menu-up').isDisabled()).toBe(false);
  await page.locator('.menu-lang[data-lang="en"] .menu-up').click();
  expect(await menu(page)).toMatchObject({ uiLang: "fr", slideLang: "en", audioLang: "fr", follows: { slides: false, audio: true } });
  expect(await shown(page, ".lang-en")).toEqual([true, true]);
  expect(await page.locator(".menu-win-title").textContent()).toBe("Langues préférées, dans l'ordre");   // the interface stayed French
  await page.reload(); await ready(page);
  expect(await menu(page)).toMatchObject({ uiLang: "fr", slideLang: "en", follows: { slides: false, audio: true } });
  await page.evaluate(() => Reveal.getPlugin("menu").follow("slides", true));   // back to following
  expect(await menu(page)).toMatchObject({ slideLang: "fr", follows: { slides: true, audio: true } });
  await page.close();
});

test("with no preference, the interface speaks the browser's language; slides keep the deck's default", async () => {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, locale: "en-US" });
  await page.goto(fixture()); await ready(page);
  expect(await menu(page)).toMatchObject({ uiLang: "en", slideLang: "fr", prefs: [] });
  await page.keyboard.press("m");
  expect(await page.locator(".menu-item").allTextContents()).toEqual(expect.arrayContaining([expect.stringContaining("Languages"), expect.stringContaining("Help")]));
  await page.close();
});

test("the windows drag by their header and remember their place; two open ones do not overlap", async () => {
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 }, locale: "fr-FR" });   // room below the help window
  await page.goto(fixture()); await ready(page);
  await page.keyboard.press("?");
  const help = page.locator('.menu-win[data-win="help"]');
  expect(await help.isVisible()).toBe(true);
  const before = await help.boundingBox(), head = await help.locator(".menu-win-head").boundingBox();
  await page.mouse.move(head.x + 60, head.y + head.height / 2);
  await page.mouse.down();
  await page.mouse.move(head.x + 60 + 250, head.y + head.height / 2 + 120, { steps: 5 });
  await page.mouse.up();
  const after = await help.boundingBox();
  expect(Math.round(after.x)).toBe(Math.round(before.x + 250));
  expect(Math.round(after.y)).toBe(Math.round(before.y + 120));
  await page.evaluate(() => Reveal.getPlugin("menu").openWindow("langs"));
  const langsWin = await page.locator('.menu-win[data-win="langs"]').boundingBox();
  expect(langsWin.x !== after.x || langsWin.y !== after.y).toBe(true);
  expect((await menu(page)).windows).toEqual(["help", "langs"]);
  await page.keyboard.press("Escape");   // closes the last opened
  expect((await menu(page)).windows).toEqual(["help"]);
  await page.reload(); await ready(page);
  await page.keyboard.press("?");
  const again = await help.boundingBox();
  expect(Math.round(again.x)).toBe(Math.round(after.x));
  expect(Math.round(again.y)).toBe(Math.round(after.y));
  await page.close();
});

test("narration items: turn on, auto, the pause between slides; help lists the keys in the deck's terms", async () => {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, locale: "fr-FR" });
  await page.goto(fixture()); await ready(page);
  expect((await narration(page)).active).toBe(false);
  await page.keyboard.press("m");
  await page.locator(".menu-item", { hasText: "Écouter" }).click();
  expect((await narration(page)).active).toBe(true);
  expect(await page.locator(".nar-panel").isVisible()).toBe(true);
  expect(await page.locator(".menu-panel").isVisible()).toBe(false);
  await page.keyboard.press("m");
  await page.locator(".menu-item", { hasText: "Mode auto" }).click();
  expect((await narration(page)).auto).toBe(true);
  expect(await page.locator(".menu-item", { hasText: "Mode auto" }).textContent()).toContain("oui");
  expect((await narration(page)).gap).toBe(0);
  await page.locator(".menu-item", { hasText: "Pause entre" }).click();
  expect((await narration(page)).gap).toBe(1000);
  expect(await page.locator(".menu-item", { hasText: "Pause entre" }).textContent()).toContain("1 s");
  await page.locator(".menu-item", { hasText: "Aide" }).click();
  const help = page.locator('.menu-win[data-win="help"]');
  expect(await help.isVisible()).toBe(true);
  expect(await help.locator(".menu-win-title").textContent()).toBe("Raccourcis clavier");
  const keys = await help.locator(".menu-keys-key").allTextContents();
  expect(keys).toContain("N");            // narration is on in this deck: N is the narration key…
  expect(keys[0]).not.toContain("N");     // …so it is no longer listed as "next slide"
  expect(keys).toContain("M");
  expect(await page.locator(".r-overlay-help").count()).toBe(0);   // reveal's own overlay is not used
  await page.keyboard.press("Escape");
  expect(await help.count()).toBe(0);
  await page.close();
});
