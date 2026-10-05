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
recording ends, then after `gap` ms `Reveal.next()`; a slide without one lasts
`silentDelay`. `?narration&auto&gap=2000` is a link that plays itself. The
language is the first of the viewer's preferred languages (see Menu) the deck
has; the panel's language buttons update that preference.
Configure it in the deck's `Reveal.initialize` (`narration: { base, langs,
variant, active, preload, … }`, see the header of narration.js).

## Theme (light / dark)
Every deck follows the site's theme: `resources/theme.js`, loaded in `<head>`
before the stylesheets, reads the `preferred-theme` cookie the site's ☀︎ / ⏾
button writes (light, dark, or default = the OS) and puts `data-theme` on
`<html>` before the first paint; `?theme=dark` / `?theme=light` forces one page
without touching the cookie (a link, a screenshot). The menu toggles it (`D`),
writing the same cookie. `resources/theme.css` paints both themes: the dark
values of reveal's `--r-*` variables, the `--c-<light value>` variables the
slides use inline (`color:var(--c-444)` = "the #444 of the light deck", dark
twin in the file), the `--ui-*` palette of the menu and the narration panel,
and, because SVG presentation attributes cannot take `var()`, one rule per
`fill="#…"` / `stroke="#…"` value the diagrams use — a new grey in a diagram is
one more line there. `engine/dist/plugin/highlight/c4ffein-dark.css` is the
dark twin of the light highlight theme, loaded after it.

## Menu (burger, top left)
`resources/menu.js` is a reveal plugin in every deck: a burger appears when the
mouse moves, the screen is touched or the page scrolls, and fades 3 s later
(`M` opens it too, Esc closes). Its bars are drawn in the stroke of the bar reveal itself shows,
so it sits with the deck's own chrome at every size: on desktop the controls
arrows (5 px, a 46 × 40 burger), on a phone in portrait — where reveal switches
to its scroll view, hides the arrows and draws a scrollbar — that scrollbar's
width (3 px, a 24 × 21 burger painted like the scrollbar: its grey at rest,
solid when open); everything else (length, offset, the gap to the panel) is
a multiple of the bar, see the head of `menu.css`. It holds the
narration controls (turn on, play / pause, auto, the pause between slides, the
panel), **Languages…**, **Help** (`?` too: the keys, in the viewer's language),
**Theme** (`D` too, see above) and **Back to the list of talks** (a link to
`../`, the site's index from any deck URL). A deck with narration also greets a
viewer who has not seen the greeting for a month (localStorage `menu.welcome`):
a window in the middle of the screen saying the talk is recorded and can play
itself, **Try it** = narration on, auto mode and the panel — not when the URL
already carries `?narration` (`menu: { welcome: 30 }` is the number of days,
`false` turns it off). Languages and Help are floating windows: they drag by their header,
remember their place, the keys keep driving the deck, Esc or ✕ closes them.
Languages has three tabs, Interface / Slides / Audio, each an ordered list of
the viewer's preferred languages; Slides and Audio follow the Interface list
unless "same as the interface" is unticked on their tab (the narration
panel's language buttons untick Audio). The lists are saved in localStorage
(`presentations.langs`, `.slides`, `.audio`) for the
whole site, and each deck picks the first one it has, per channel, falling
back to its own first language (the interface falls back to the browser's).
The plugins' own labels are translated the same way: a table per plugin,
`t(key)`, no library. Slide
languages are `lang-<code>` classes on elements (`<h2 class="lang-en">` /
`<h2 class="lang-fr">`): the plugin shows the chosen one and hides the others
(`menu: { slideLangs: ['fr', 'en'] }` sets the order, else they are detected).

## Tests
`make test` = unit tests of the builder + `src/tests/e2e/` (every built deck
opened in headless Chromium and compared to a structure golden, see
[src/tests/e2e/README.md](src/tests/e2e/README.md)). `make verify` is what
CI runs.

## Metadata (presentations.json)
`presentations.json` at the repo root is written by the build, one entry per
deck, read from the sources with regexes (nothing is evaluated), and published
with the site: the index of talks (generated in the writings repo, see above)
is built from it. Per deck: `title` (`<title>`), `lang` (`<html lang>`),
`slideLangs` (`menu: { slideLangs: [...] }` if configured, else the `lang-<code>`
classes found, else `[lang]`), `fragments` (the `src/slides/` files included,
nested ones too, in order), `ownSections` (the `<section>` tags of the deck's own
source), `includes` / `partOf` (another deck is a sub-presentation of this one
when every fragment of its is in this deck and it has fewer sections of its
own — `mental-model-of-llms` is part of `claude-on-scotch`), and `narration`
(`{ base, langs, names }` from the deck's `narration: { base: '…', langs: [...] }`
and its `data-narration` names; `null` without a base). Which recordings exist
on the host is not in the file: the index generator checks that at its own
build. `make check` fails if the file is missing or stale, like a deck.

## Publishing
GitHub Pages gets the site and nothing else: `SITE` in [src/build.js](src/build.js)
lists what is published (`index.html`, `404.html`, `presentations.json`,
`slides/`, `engine/`, `resources/`, `transcripts/`), a whitelist, so a new root file stays offline
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
