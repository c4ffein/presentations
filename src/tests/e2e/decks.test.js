// End-to-end checks for every deck in slides/, run by `bun test tests/e2e`.
//
// For each deck the test serves the repo over HTTP (Bun.serve, no-store),
// opens it in headless Chromium, waits for Reveal to be ready and then:
//   - records the deck STRUCTURE (every slide's h/v index, id, first heading,
//     the start of its text and its fragment count) and compares it to the
//     golden file tests/e2e/golden/<deck>.json — UPDATE_GOLDEN=1 rewrites it
//   - fails on any console error, uncaught page error, failed request or
//     4xx/5xx response, while loading and while stepping through every slide
//     and fragment with Reveal.next(). Requests to other origins are blocked
//     (the run is hermetic: an <iframe> of an external site just stays blank)
//     and net::ERR_ABORTED is ignored — that is Reveal cancelling a lazy
//     data-src iframe it unloaded, not a missing file (a missing file is a 404)
//   - checks every terminal recording (.term-replay[data-recording]) mounted
//     without an error line
//   - opens the first transcript link (a[data-transcript]) and checks the
//     modal shows the viewer with the transcript loaded, without moving the
//     deck to another slide
//
// SCREENSHOTS=1 additionally dumps one PNG per slide under
// tests/e2e/screenshots/<deck>/ (gitignored) — a review aid, never asserted.
// PW_CHROMIUM=/path/to/chrome runs a locally installed Chromium instead of
// the one Playwright downloads (`bunx playwright install chromium`).
//
// E2E_BASE=https://host/path/ runs the same checks against a DEPLOYED site
// (the pages-check smoke test, after every deploy) instead of a local server:
// no Bun.serve, that base counts as local, and first every built deck is
// fetched from it and compared to the local slides/ file — retried briefly
// while Pages propagates — so a green run also says the live decks are
// byte-for-byte the built ones. The whitelist itself is enforced earlier, by
// the local server (see server.js).

import { test, expect, beforeAll, afterAll } from "bun:test";
import { chromium } from "playwright";
import { readdirSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT, startServer } from "./server.js";

const GOLDEN_DIR = path.join(import.meta.dir, "golden");
const SHOTS_DIR = path.join(import.meta.dir, "screenshots");
const UPDATE = !!process.env.UPDATE_GOLDEN;
const SCREENSHOTS = !!process.env.SCREENSHOTS;
const TIMEOUT_MS = 90_000;
const LIVE = process.env.E2E_BASE ? process.env.E2E_BASE.replace(/\/?$/, "/") : null;
const LIVE_WAIT_MS = 2 * 60_000;   // deploy-pages returns once live; this only covers propagation

const decks = readdirSync(path.join(ROOT, "slides"))
  .filter((f) => f.endsWith(".html"))
  .sort();

let server, browser;

beforeAll(async () => {
  if (LIVE) await waitLive(); else server = startServer();
  browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
}, LIVE_WAIT_MS + 30_000);

afterAll(async () => {
  await browser?.close();
  server?.stop(true);
});

const norm = (s) => (s || "").replace(/\s+/g, " ").trim();

// Every live deck must be the built one, byte for byte; a fresh deploy can
// take a little while to show, so keep asking (no cache-buster: what the
// browser is about to load is what must have changed).
async function waitLive() {
  const t0 = Date.now();
  for (const deck of decks) {
    const url = LIVE + "slides/" + deck, want = readFileSync(path.join(ROOT, "slides", deck), "utf8");
    for (let tries = 1; ; tries++) {
      const r = await fetch(url, { cache: "no-store" }).catch(() => null);
      const got = r && r.ok ? await r.text() : null;
      if (got === want) break;
      const why = !r ? "unreachable" : !r.ok ? "HTTP " + r.status : "not the built slides/" + deck;
      if (Date.now() - t0 > LIVE_WAIT_MS) throw new Error(`${url}: ${why} after ${tries} tries`);
      if (tries === 1) console.warn(`${url}: ${why}, waiting for the deploy to show`);
      await new Promise((f) => setTimeout(f, 10_000));
    }
  }
}

function structure() {
  // Runs in the page. Reveal has processed data-markdown sections by now.
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const root = document.querySelector(".reveal .slides");
  const sections = (el) => Array.from(el.children).filter((c) => c.tagName === "SECTION");
  const slides = [];
  sections(root).forEach((h, hi) => {
    const vs = sections(h);
    (vs.length ? vs : [h]).forEach((s, vi) => {
      const head = s.querySelector("h1, h2, h3, h4");
      // Terminal replays stream their text in: leave them out so the snapshot
      // never depends on playback timing.
      const copy = s.cloneNode(true);
      copy.querySelectorAll(".term-replay").forEach((el) => el.remove());
      slides.push({
        h: hi,
        v: vs.length ? vi : null,
        id: s.id || null,
        title: head ? clean(head.textContent) : null,
        text: clean(copy.textContent).slice(0, 100),
        fragments: s.querySelectorAll(".fragment").length,
      });
    });
  });
  return { total: Reveal.getTotalSlides(), slides };
}

function walk() {
  // Runs in the page: step through every slide and fragment.
  let steps = 0;
  while (steps < 5000) {
    if (Reveal.isLastSlide() && !Reveal.availableFragments().next) break;
    Reveal.next();
    steps++;
  }
  const i = Reveal.getIndices();
  return { steps, end: { h: i.h, v: i.v ?? null } };
}

for (const deck of decks) {
  const name = deck.replace(/\.html$/, "");
  test(name, async () => {
    const problems = [];
    const base = LIVE || `http://localhost:${server.port}/`;
    const local = (url) => url.startsWith(base);
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.route(() => true, (route) => local(route.request().url()) ? route.continue() : route.abort());
    page.on("console", (m) => { if (m.type() === "error") problems.push("console: " + m.text() + " @ " + (m.location()?.url || "")); });
    page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
    page.on("requestfailed", (r) => {
      const err = r.failure()?.errorText || "";
      if (local(r.url()) && err !== "net::ERR_ABORTED") problems.push("requestfailed: " + r.url() + " " + err);
    });
    page.on("response", (r) => { if (r.status() >= 400) problems.push("HTTP " + r.status() + ": " + r.url()); });

    await page.goto(`${base}slides/${deck}`, { waitUntil: "load" });
    await page.waitForFunction(() => window.Reveal && Reveal.isReady(), null, { timeout: 30_000 });

    // Terminal recordings: mounted, no error line.
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll(".term-replay[data-recording]"))
        .every((el) => el._termPlayer || el.querySelector(".tp-error-msg")), null, { timeout: 30_000 });
    const termErrors = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".term-replay[data-recording]"))
        .filter((el) => el.querySelector(".tp-error-msg"))
        .map((el) => el.getAttribute("data-recording") + ": " + (el.querySelector(".tp-fin")?.textContent || "error")));
    expect(termErrors).toEqual([]);

    // Structure vs golden.
    const actual = await page.evaluate(structure);
    actual.walk = await page.evaluate(walk);
    const goldenFile = path.join(GOLDEN_DIR, name + ".json");
    const text = JSON.stringify(actual, null, 2) + "\n";
    if (UPDATE || !existsSync(goldenFile)) {
      if (!UPDATE && !existsSync(goldenFile)) console.warn(`golden missing for ${name}: writing ${path.relative(ROOT, goldenFile)}`);
      mkdirSync(GOLDEN_DIR, { recursive: true });
      writeFileSync(goldenFile, text);
    }
    const golden = JSON.parse(readFileSync(goldenFile, "utf8"));
    if (JSON.stringify(golden) !== JSON.stringify(actual)) {
      console.error(`${name}: structure differs from ${path.relative(ROOT, goldenFile)} — UPDATE_GOLDEN=1 bun test tests/e2e to accept`);
    }
    expect(actual).toEqual(golden);

    // Transcript modal: the first link opens the viewer, deck stays put.
    const transcript = await page.evaluate(() => {
      const a = document.querySelector("a[data-transcript]");
      if (!a) return null;
      const i = Reveal.getIndices(a.closest("section"));
      Reveal.slide(i.h, i.v);
      return { file: a.getAttribute("data-transcript"), h: i.h, v: i.v ?? null };
    });
    if (transcript) {
      await page.locator("a[data-transcript]").first().click();
      await page.waitForFunction(() => {
        const f = document.querySelector('iframe[title="Transcript"]');
        const d = f && f.contentDocument;
        if (!d || d.readyState !== "complete") return false;
        const status = d.getElementById("status");
        return d.getElementById("main") && (!status || !/Chargement/.test(status.textContent));
      }, null, { timeout: 30_000 });
      const state = await page.evaluate(() => {
        const f = document.querySelector('iframe[title="Transcript"]');
        const d = f.contentDocument;
        const i = Reveal.getIndices();
        return {
          src: f.getAttribute("src"),
          title: d.getElementById("title")?.textContent,
          status: d.getElementById("status")?.textContent || "",
          h: i.h, v: i.v ?? null,
        };
      });
      expect(state.src).toContain("viewer.html?t=" + encodeURIComponent(transcript.file));
      expect(state.status).not.toMatch(/erreur|error|HTTP/i);
      expect(norm(state.title)).not.toBe("");
      expect({ h: state.h, v: state.v }).toEqual({ h: transcript.h, v: transcript.v });
      await page.keyboard.press("Escape");
    }

    if (SCREENSHOTS) {
      const dir = path.join(SHOTS_DIR, name);
      mkdirSync(dir, { recursive: true });
      for (const [n, s] of actual.slides.entries()) {
        await page.evaluate(([h, v]) => Reveal.slide(h, v ?? undefined), [s.h, s.v]);
        await page.waitForTimeout(150);
        await page.screenshot({ path: path.join(dir, `${String(n).padStart(3, "0")}-${s.h}-${s.v ?? 0}.png`) });
      }
    }

    const ignored = /favicon\.ico/;
    expect(problems.filter((p) => !ignored.test(p))).toEqual([]);
    await page.close();
  }, TIMEOUT_MS);
}
