// build.js — assemble slides/ from src/, no dependencies.
//
//   bun build.js           write slides/<name>.html for every src/presentations/<name>.html
//   bun build.js --check   build in memory and fail if slides/ is not exactly that
//
// A presentation is a full HTML page. A file under src/slides/ is one
// <section> or several, and both may embed any file under src/ with
//
//   <!-- @include slides/some-file.html -->
//
// The path is relative to src/ and the directive must be alone on its line.
// The file it names is spliced in VERBATIM (no re-indentation: whitespace
// inside <pre> and <textarea data-template> is content, so write shared
// files at the indentation of the decks they go into) between two marker
// comments at the directive's indentation, so a built deck says where every
// slide came from. Includes nest; a file that includes itself, directly or
// through others, is an error naming the cycle. The same file may be
// included twice.

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

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
    const [, indent, rel] = m;
    const inner = read(rel);
    if (inner == null) throw new Error(`missing include ${rel} (from ${chain.join(" -> ")})`);
    out.push(`${indent}<!-- @begin ${rel} -->`);
    out.push(expand(inner, read, rel, chain).replace(/\n+$/, ""));
    out.push(`${indent}<!-- @end ${rel} -->`);
  }
  return out.join("\n");
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
  for (const name of names) {
    const rel = "presentations/" + name;
    let html;
    try { html = expand(read(rel), read, rel); }
    catch (e) { problems.push(`${rel}: ${e.message}`); continue; }
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
  return { problems, written, names };
}

if (import.meta.main) {
  const check = process.argv.includes("--check");
  const root = path.resolve(import.meta.dir);
  const { problems, written, names } = build(root, { check });
  for (const p of problems) console.error("error: " + p);
  for (const w of written) console.log("wrote slides/" + w);
  if (!problems.length) console.log(check ? `slides/ is current (${names.length} decks)` : `built ${names.length} decks, ${written.length} changed`);
  process.exit(problems.length ? 1 : 0);
}
