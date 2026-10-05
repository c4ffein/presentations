import { test, expect } from "bun:test";
import { existsSync } from "node:fs";
import path from "node:path";
import { expand, SITE } from "../build.js";

test("every entry of the published SITE exists at the repo root", () => {
  for (const e of SITE) expect(existsSync(path.join(import.meta.dir, "../..", e))).toBe(true);
});

const files = {
  "slides/one.html": "<section>\n  <h2>One</h2>\n</section>\n",
  "slides/indented.html": "    <section>\n      <h2>In</h2>\n   \n    </section>\n\n\n",
  "slides/set.html": "<section>\n  <!-- @include slides/one.html -->\n</section>\n<!-- @include slides/one.html -->\n",
  "slides/a.html": "<!-- @include slides/b.html -->\n",
  "slides/b.html": "<!-- @include slides/a.html -->\n",
  "slides/self.html": "<section></section>\n<!-- @include slides/self.html -->\n",
};
const read = (p) => (p in files ? files[p] : null);

test("a directive is replaced by the file, verbatim, between markers at the directive's indentation", () => {
  expect(expand("<div>\n    <!-- @include slides/one.html -->\n</div>", read)).toBe(
    "<div>\n    <!-- @begin slides/one.html -->\n<section>\n  <h2>One</h2>\n</section>\n    <!-- @end slides/one.html -->\n</div>");
});

test("the included file's whitespace is untouched (pre / textarea content), only trailing newlines go", () => {
  expect(expand("  <!-- @include slides/indented.html -->", read)).toBe(
    "  <!-- @begin slides/indented.html -->\n    <section>\n      <h2>In</h2>\n   \n    </section>\n  <!-- @end slides/indented.html -->");
});

test("includes nest, and the same file may be included twice", () => {
  const out = expand("<!-- @include slides/set.html -->", read);
  expect(out.split("@begin slides/one.html").length - 1).toBe(2);
  expect(out).toContain("<section>\n  <!-- @begin slides/one.html -->\n<section>\n  <h2>One</h2>\n</section>\n  <!-- @end slides/one.html -->\n</section>");
});

test("text without directives is returned unchanged (CRLF normalized)", () => {
  expect(expand("a\r\nb\n", read)).toBe("a\nb\n");
  expect(expand("<!-- @includes nothing -->", read)).toBe("<!-- @includes nothing -->");
});

test("a missing file names the chain", () => {
  expect(() => expand("<!-- @include slides/nope.html -->", read, "presentations/x.html"))
    .toThrow("missing include slides/nope.html (from presentations/x.html)");
});

test("an include may not leave src/", () => {
  expect(() => expand("<!-- @include ../engine/dist/reveal.js -->", read, "presentations/x.html"))
    .toThrow("include outside src/: ../engine/dist/reveal.js (from presentations/x.html)");
  expect(() => expand("<!-- @include slides/../../x.html -->", read)).toThrow("include outside src/");
  expect(() => expand("<!-- @include /etc/passwd -->", read)).toThrow("include outside src/");
  expect(expand("<!-- @include slides/../slides/one.html -->", read)).toContain("<!-- @begin slides/one.html -->\n<section>\n  <h2>One</h2>");
});

test("a cycle names the path", () => {
  expect(() => expand("<!-- @include slides/a.html -->", read, "presentations/x.html"))
    .toThrow("include cycle: presentations/x.html -> slides/a.html -> slides/b.html -> slides/a.html");
  expect(() => expand(files["slides/self.html"], read, "slides/self.html"))
    .toThrow("include cycle: slides/self.html -> slides/self.html");
});

// ---- presentations.json ----
import { deckMeta, relate, meta, build, META } from "../build.js";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const page = (head, body, init = "") => `<!DOCTYPE html>\n<html lang="fr">\n<head>\n<title>${head}</title>\n</head>\n<body>\n<div class="reveal"><div class="slides">\n${body}\n</div></div>\n<script>Reveal.initialize({ hash: true, ${init} plugins: [] });</script>\n</body>\n</html>\n`;

test("deckMeta reads the title, the lang and the slide languages (config, else lang-* classes, else the page's lang)", () => {
  const plain = page("  Un titre ", "<section><h2>A</h2></section>");
  expect(deckMeta("x", plain, plain)).toMatchObject({ file: "slides/x.html", title: "Un titre", lang: "fr", slideLangs: ["fr"], fragments: [], ownSections: 1, narration: null });
  const classes = page("T", '<section><h2 class="big lang-en">Hi</h2><h2 class="lang-fr big">Salut</h2><p class="lang-en">x</p></section>');
  expect(deckMeta("x", classes, classes).slideLangs).toEqual(["en", "fr"]);
  const cfg = page("T", '<section><h2 class="lang-en">Hi</h2></section>', "menu: { slideLangs: ['fr', 'en'] },");
  expect(deckMeta("x", cfg, cfg).slideLangs).toEqual(["fr", "en"]);
});

test("deckMeta: narration is null without a base, else base + langs + the data-narration names of the expanded deck, deduped in order", () => {
  const off = page("T", '<section data-narration="a/one"></section>', "narration: { base: null, langs: ['fr', 'en'] },");
  expect(deckMeta("x", off, off).narration).toBeNull();
  const src = page("T", '<section data-narration="a/one"></section>\n<!-- @include slides/f.html -->', "narration: { base: 'https://h/p', langs: ['fr', 'en'] },");
  const html = expand(src, (p) => (p === "slides/f.html" ? '<section data-narration="a/two"><p data-narration="a/one"></p></section>\n' : null));
  expect(deckMeta("x", src, html).narration).toEqual({ base: "https://h/p", langs: ["fr", "en"], names: ["a/one", "a/two"] });
});

test("fragments are the included files, nested ones too, deduped in order; ownSections counts the deck's own source only", () => {
  const src = page("T", "<section></section>\n<!-- @include slides/set.html -->\n<section></section>");
  const m = deckMeta("x", src, expand(src, read));
  expect(m.fragments).toEqual(["slides/set.html", "slides/one.html"]);
  expect(m.ownSections).toBe(2);
});

test("relate: a deck whose fragments are all in another's, with fewer sections of its own, is a sub-presentation of it", () => {
  const d = (fragments, ownSections) => ({ fragments, ownSections, includes: [], partOf: [] });
  const out = relate({ big: d(["slides/a.html", "slides/b.html"], 40), sub: d(["slides/a.html"], 2), twin: d(["slides/a.html", "slides/b.html"], 3), other: d([], 10), none: d([], 1) }).decks;
  expect(Object.keys(out)).toEqual(["big", "none", "other", "sub", "twin"]);   // sorted
  expect(out.big).toMatchObject({ includes: ["sub", "twin"], partOf: [] });
  expect(out.twin).toMatchObject({ includes: ["sub"], partOf: ["big"] });   // same fragments as big, fewer own sections: inside it
  expect(out.sub).toMatchObject({ includes: [], partOf: ["big", "twin"] });
  expect(out.other).toMatchObject({ includes: [], partOf: [] });            // no fragment: never a sub-presentation
});

test("the repo's presentations.json is what meta() derives from src/, and --check reports it stale", () => {
  const root = path.join(import.meta.dir, "../..");
  expect(readFileSync(path.join(root, META), "utf8")).toBe(JSON.stringify(meta(root), null, 2) + "\n");
  const tmp = mkdtempSync(path.join(tmpdir(), "presentations-"));
  try {
    mkdirSync(path.join(tmp, "src/presentations"), { recursive: true }); mkdirSync(path.join(tmp, "src/slides"));
    writeFileSync(path.join(tmp, "src/slides/f.html"), "<section></section>\n");
    writeFileSync(path.join(tmp, "src/presentations/a.html"), page("A", "<!-- @include slides/f.html -->"));
    expect(build(tmp, { check: true }).problems).toEqual(["slides/a.html is missing: run the build", `${META} is missing: run the build`]);
    expect(build(tmp)).toMatchObject({ problems: [], written: ["a.html", META] });
    expect(build(tmp, { check: true }).problems).toEqual([]);
    expect(JSON.parse(readFileSync(path.join(tmp, META), "utf8")).decks.a).toMatchObject({ title: "A", fragments: ["slides/f.html"], ownSections: 0 });
    writeFileSync(path.join(tmp, META), "{}\n");
    expect(build(tmp, { check: true }).problems).toEqual([`${META} is stale: run the build`]);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
