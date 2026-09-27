import { test, expect } from "bun:test";
import { expand } from "../build.js";

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

test("a cycle names the path", () => {
  expect(() => expand("<!-- @include slides/a.html -->", read, "presentations/x.html"))
    .toThrow("include cycle: presentations/x.html -> slides/a.html -> slides/b.html -> slides/a.html");
  expect(() => expand(files["slides/self.html"], read, "slides/self.html"))
    .toThrow("include cycle: slides/self.html -> slides/self.html");
});
