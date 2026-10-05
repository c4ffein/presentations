// build.js — assemble slides/ from src/, no dependencies. Lives in src/ with the
// rest of the tooling (package.json, tests/); the repo root is the site.
//
//   bun build.js           write slides/<name>.html for every src/presentations/<name>.html
//   bun build.js --check   build in memory and fail if slides/ is not exactly that
//   bun build.js --site    copy the SITE (below) to _site/, what GitHub Pages publishes
//
// A presentation is a full HTML page. A file under src/slides/ is one
// <section> or several, and both may embed any file under src/ with
//
//   <!-- @include slides/some-file.html -->
//
// The path is relative to src/ (leaving it with `..` is an error) and the
// directive must be alone on its line.
// The file it names is spliced in VERBATIM (no re-indentation: whitespace
// inside <pre> and <textarea data-template> is content, so write shared
// files at the indentation of the decks they go into) between two marker
// comments at the directive's indentation, so a built deck says where every
// slide came from. Includes nest; a file that includes itself, directly or
// through others, is an error naming the cycle. The same file may be
// included twice.
//
// The build also writes presentations.json at the repo root (published with
// the site: the index of talks is built from it), one entry per deck, read
// from the sources with regexes — nothing is evaluated:
//   title       <title>…</title>
//   lang        <html lang="…">
//   slideLangs  menu: { slideLangs: ['fr', 'en'] } in Reveal.initialize when
//               there is one, else the lang-<code> classes found, else [lang]
//   fragments   the src/slides files included (nested ones too), in order
//   ownSections the <section> tags of the deck's own source, outside includes
//   includes    the other decks that are a sub-presentation of this one: every
//   partOf      fragment of theirs is in this deck and they have fewer sections
//               of their own (the inverse relation)
//   narration   { base, langs, names } from narration: { base: '…', langs: […] }
//               (single-quoted, as the decks write it) and the data-narration
//               names of the expanded deck; null when there is no base
// `--check` fails if it is missing or stale, like a deck.

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, cpSync } from "node:fs";
import path from "node:path";

// What GitHub Pages publishes, and nothing else: a WHITELIST of root entries.
// `bun build.js --site` copies them to _site/ (the pages job uploads that),
// and the e2e server serves only them, so a deck needing a file outside the
// site fails `make verify` before anything is deployed.
export const SITE = ["index.html", "404.html", "presentations.json", "slides", "engine", "resources", "transcripts"];

export function site(root, out = path.join(root, "_site")) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out);
  for (const e of SITE) cpSync(path.join(root, e), path.join(out, e), { recursive: true });
  return out;
}

export const DIRECTIVE = /^([ \t]*)<!--\s*@include\s+(\S+)\s*-->[ \t]*$/;

// expand(text, read, name, stack): resolve every directive in `text`, where
// read(relPath) returns the text of a file under src/ or null when missing.
export function expand(text, read, name = "<input>", stack = []) {
  if (stack.includes(name)) {
    throw new Error("include cycle: " + [...stack, name].join(" -> "));
  }
  const chain = [...stack, name];
  const out = [];
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const m = DIRECTIVE.exec(line);
    if (!m) { out.push(line); continue; }
    const indent = m[1], rel = path.posix.normalize(m[2]);   // markers name the clean path
    if (path.posix.isAbsolute(rel) || rel.split("/")[0] === "..") {
      throw new Error(`include outside src/: ${m[2]} (from ${chain.join(" -> ")})`);
    }
    const inner = read(rel);
    if (inner == null) throw new Error(`missing include ${rel} (from ${chain.join(" -> ")})`);
    out.push(`${indent}<!-- @begin ${rel} -->`);
    out.push(expand(inner, read, rel, chain).replace(/\n+$/, ""));
    out.push(`${indent}<!-- @end ${rel} -->`);
  }
  return out.join("\n");
}

// ---- presentations.json ----
const quoted = (list) => Array.from(list.matchAll(/'([^']*)'|"([^"]*)"/g), (m) => m[1] ?? m[2]);
const unique = (list) => list.filter((x, i) => list.indexOf(x) === i);

// deckMeta(name, source, html): one deck, from its source (the file under
// src/presentations/) and its expanded text.
export function deckMeta(name, source, html) {
  const title = /<title>([^<]*)<\/title>/.exec(html);
  const lang = /<html[^>]*\slang="([^"]+)"/.exec(html);
  const slideLangsCfg = /menu:\s*\{[^}]*slideLangs:\s*\[([^\]]*)\]/.exec(html);
  const classLangs = unique(Array.from(html.matchAll(/class="([^"]*)"/g)).flatMap((m) =>
    m[1].split(/\s+/).map((c) => /^lang-([a-z]{2,3})$/.exec(c)).filter(Boolean).map((m) => m[1])));
  const slideLangs = slideLangsCfg ? quoted(slideLangsCfg[1]) : classLangs.length ? classLangs : lang ? [lang[1]] : [];
  const nar = /narration:\s*\{([^}]*)\}/.exec(html);
  let narration = null;
  if (nar) {
    const base = /base:\s*(?:'([^']*)'|"([^"]*)")/.exec(nar[1]);
    const langs = /langs:\s*\[([^\]]*)\]/.exec(nar[1]);
    if (base) narration = { base: base[1] ?? base[2], langs: langs ? quoted(langs[1]) : [],
                            names: unique(Array.from(html.matchAll(/data-narration="([^"]*)"/g), (m) => m[1])) };
  }
  return {
    file: "slides/" + name + ".html",
    title: title ? title[1].trim() : null,
    lang: lang ? lang[1] : null,
    slideLangs,
    fragments: unique(Array.from(html.matchAll(/<!-- @begin (\S+) -->/g), (m) => m[1])),
    ownSections: (source.match(/<section\b/g) || []).length,
    includes: [], partOf: [],
    narration,
  };
}

// relate(decks): {name: deckMeta} -> the presentations.json object, decks
// sorted by name, includes / partOf filled in.
export function relate(decks) {
  const names = Object.keys(decks).sort();
  const sub = (b, a) => b !== a && decks[b].fragments.length > 0
    && decks[b].fragments.every((f) => decks[a].fragments.includes(f)) && decks[b].ownSections < decks[a].ownSections;
  const out = {};
  for (const a of names) out[a] = { ...decks[a], includes: names.filter((b) => sub(b, a)), partOf: names.filter((b) => sub(a, b)) };
  return { decks: out };
}

export const META = "presentations.json";
const metaText = (decks) => JSON.stringify(relate(decks), null, 2) + "\n";

// meta(root): the content of presentations.json, from src/ alone.
export function meta(root) {
  const src = path.join(root, "src");
  const read = (rel) => { const f = path.join(src, rel); return existsSync(f) ? readFileSync(f, "utf8") : null; };
  const decks = {};
  for (const f of readdirSync(path.join(src, "presentations")).filter((f) => f.endsWith(".html")).sort()) {
    const name = f.replace(/\.html$/, ""), source = read("presentations/" + f);
    decks[name] = deckMeta(name, source, expand(source, read, "presentations/" + f));
  }
  return relate(decks);
}

export function build(root, { check = false } = {}) {
  const src = path.join(root, "src");
  const out = path.join(root, "slides");
  const read = (rel) => {
    const f = path.join(src, rel);
    return existsSync(f) ? readFileSync(f, "utf8") : null;
  };
  const names = readdirSync(path.join(src, "presentations")).filter((f) => f.endsWith(".html")).sort();
  const problems = [];
  const written = [];
  const decks = {};
  for (const name of names) {
    const rel = "presentations/" + name;
    let html;
    try { html = expand(read(rel), read, rel); }
    catch (e) { problems.push(`${rel}: ${e.message}`); continue; }
    decks[name.replace(/\.html$/, "")] = deckMeta(name.replace(/\.html$/, ""), read(rel), html);
    const target = path.join(out, name);
    const current = existsSync(target) ? readFileSync(target, "utf8") : null;
    if (current === html) continue;
    if (check) problems.push(`slides/${name} is ${current == null ? "missing" : "stale"}: run the build`);
    else { mkdirSync(out, { recursive: true }); writeFileSync(target, html); written.push(name); }
  }
  if (existsSync(out)) {
    for (const f of readdirSync(out)) {
      if (f.endsWith(".html") && !names.includes(f)) problems.push(`slides/${f} has no source in src/presentations/`);
    }
  }
  if (Object.keys(decks).length === names.length) {   // every deck expanded: the metadata is complete
    const target = path.join(root, META), text = metaText(decks);
    const current = existsSync(target) ? readFileSync(target, "utf8") : null;
    if (current !== text) {
      if (check) problems.push(`${META} is ${current == null ? "missing" : "stale"}: run the build`);
      else { writeFileSync(target, text); written.push(META); }
    }
  }
  return { problems, written, names };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const root = path.resolve(import.meta.dir, "..");
  if (args.includes("--site")) { console.log("wrote " + path.relative(root, site(root)) + "/ (" + SITE.join(", ") + ")"); process.exit(0); }
  const check = args.includes("--check");
  const { problems, written, names } = build(root, { check });
  for (const p of problems) console.error("error: " + p);
  for (const w of written) console.log("wrote " + (w === META ? w : "slides/" + w));
  if (!problems.length) console.log(check ? `slides/ is current (${names.length} decks)` : `built ${names.length} decks, ${written.length} changed`);
  process.exit(problems.length ? 1 : 0);
}
