# presentations
Archive of my past presentations

## index.html
The `index.html` is generated from the [writings](https://github.com/c4ffein/writings) repo to keep a unified theme.

To update after theme changes:
```bash
curl -o index.html https://c4ffein.github.io/writings/presentations-index.html
curl -o 404.html https://c4ffein.github.io/writings/404.html
```

## Sources and build
The repo root is the SITE (`index.html`, `404.html`, `slides/`, `engine/`,
`resources/`, `transcripts/`); everything that makes it lives in `src/`:
the deck sources, the builder (`build.js`, `package.json`, `tests/`) and the
recording / transcript tools (`record_to_json.py`, `export_transcript.py`).
`slides/` is BUILT: never edit it by hand.

- `src/presentations/<name>.html` — one full page per deck, built to `slides/<name>.html` (same URL as before)
- `src/slides/*.html` — one `<section>` or several, shared between decks

Both may embed any file under `src/` (and only there: a path leaving `src/` is
an error) with a directive alone on its line:

```html
<!-- @include slides/mental-model-llm.html -->
```

The file is spliced in verbatim (no re-indentation: whitespace inside
`<pre>` and markdown `<textarea>`s is content, so write a shared file at the
indentation of the decks it goes into) between `@begin` / `@end` marker
comments, so a built deck says where every slide came from
(`grep '@begin' slides/*.html` = who uses what). Includes nest; a cycle is
an error naming the path. `make build` writes `slides/`, `make check` (in
CI) fails if it is not current. `make` lists every target — each one is a
bun one-liner from `src/package.json`, so `cd src && bun run build` works
without make.

## Narration (audio per slide)
`resources/narration.js` is a reveal plugin that plays a recording per slide,
in the viewer's language, from any static file server. A slide embeds the
NAME of a recording in a tag — `data-narration="<name>"` on the section, on
any element inside it, or on a fragment — and the plugin plays
`<base>/<name>.<lang>[.<variant>].mp3`, trying the deck's variant first and
falling back to the plain file — so a deck can re-record a few slides and
share the rest. Slides are not named: the name is the recording's, it goes
with the slide into every deck it is built into (the recordings of
`src/slides/mental-model-llm.html` are `mental-model/<slug>`).

Nothing loads until narration is turned on: with `?narration` in the URL (a
shared link; `?narration=<base>` tries another server without rebuilding),
or by pressing `N` (reveal's `N` = next slide is redundant with Space) — N
then puts `narration` in the URL so a reload stays on. Turning it on
preloads every recording of the deck for the language into memory, current
slide first, so the talk survives losing the connection (the panel header
shows `↓ 12/34`; a failed file streams and can be retried). Afterwards `N`
shows / hides the floating panel (draggable, collapsible, place remembered):
language buttons, play / pause, a seek bar and `auto` = "hear me talk": each
recording ends on `Reveal.next()`, a slide without one lasts `silentDelay`.
Configure it in the deck's `Reveal.initialize` (`narration: { base, langs,
variant, active, preload, … }`, see the header of narration.js).

## Tests
`make test` = unit tests of the builder + `src/tests/e2e/` (every built deck
opened in headless Chromium and compared to a structure golden, see
[src/tests/e2e/README.md](src/tests/e2e/README.md)). `make verify` is what
CI runs.

## Publishing
GitHub Pages gets the site and nothing else: `SITE` in [src/build.js](src/build.js)
lists what is published (`index.html`, `404.html`, `slides/`, `engine/`,
`resources/`, `transcripts/`), a whitelist, so a new root file stays offline
until listed. The e2e server serves only that list, so a deck needing a file
outside the site fails `make verify` before anything is deployed. On every push
to `master`, once `verify` passed, the `pages` job of
[verify.yml](.github/workflows/verify.yml) runs `make site` (= `_site/`) and
deploys it — so what is online is exactly what `make check` proved built from
`src/` and what the e2e tests ran on. Then `pages-check` is a smoke test of the
live site (`E2E_BASE=https://…/ make test-live`): every live deck must be
byte-for-byte the built `slides/` file (retried for up to two minutes while the
deploy shows), then each is opened from the live URL with the same checks as
locally. One-time setup on the repo: Settings → Pages → Build and deployment →
Source: **GitHub Actions**.

## License
- [MIT](LICENSE) for my [slides](slides)
- Mainly [MIT](https://github.com/hakimel/reveal.js/blob/master/LICENSE) for [reveal.js](https://github.com/hakimel/reveal.js/) in [engine](engine)
  - [MIT](https://github.com/mudgen/runcss/blob/master/LICENSE) for [runcss](https://github.com/mudgen/runcss/) in [engine/runcss](engine/runcss)
  - other files under other licenses: see headers
