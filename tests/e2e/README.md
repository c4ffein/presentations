# Deck e2e tests

`bun test tests/e2e` opens every `slides/*.html` (the BUILT decks: `make build`
first) in headless Chromium (served over HTTP by `Bun.serve`) and checks it
against `golden/<deck>.json`. See the
header of `decks.test.js` for exactly what is asserted.

```sh
bun install                          # playwright, dev-only
bunx playwright install chromium     # once, or PW_CHROMIUM=/path/to/chrome
bun test tests/e2e                   # or: make test-e2e
UPDATE_GOLDEN=1 bun test tests/e2e   # accept a structure change (make test-update)
SCREENSHOTS=1 bun test tests/e2e     # one PNG per slide in screenshots/ (make screenshots)
```

A golden diff is the review: editing a deck changes `title` / `text` / the
slide count for the slides you touched and nothing else. A refactor that
moves markup around (a slide moved to `src/slides/` and included back) must
leave the golden untouched.
