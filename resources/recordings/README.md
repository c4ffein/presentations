# Terminal recordings

Replayable terminal sessions for the decks, played by `resources/term-player.js`
(vanilla JS, no dependencies) styled by `resources/term-player.css`.

## Files

| file | what |
|---|---|
| `demo.json` | 5-chunk sample with one `\r` overwrite |
| `test-seq.json`, `test-progress.json`, `test-pytest.json` | **throwaway** fixtures made with fake commands, only used by `resources/term-player-demo.html`; delete freely |
| `hypothesis-coloring.json`, `hypothesis-coloring-fixed.json` | the real pyscotch/Hypothesis recordings for the Inria talk (notes: `hypothesis-coloring.md`) |
| `hegel-order-shrink.json`, `hegel-order-shrink-fixed.json`, `hegel-order-shrink-plain.json` | the real hegel-c recordings for the Inria talk (notes: `hegel-order-shrink.md`) |

## JSON contract (from `record_to_json.py`)

```
{
  "meta": { "title": str, "command": str, "recorded_at": iso8601, "duration_s": float,
            "chunks": int, ...any --meta key=value pairs... },
  "chunks": [ [delay_ms:int, text:str], ... ]     # delay is time since the previous chunk
}
```

`text` is plain UTF-8: ANSI escape sequences are stripped, `\r\n` becomes `\n`, a lone
`\r` is kept and the player treats it as "return to the start of the current line and
overwrite from column 0" (progress-bar style; a shorter rewrite leaves the tail of the
old line, exactly like a terminal). Delays are capped at `--max-delay` ms (default 1500)
so a long silence never stalls the replay, and chunks closer than `--merge` ms
(default 15) are merged to keep the file small.

Every `meta` key other than `title`, `command`, `recorded_at`, `duration_s`, `chunks`
is shown small in the player header as provenance, e.g.
`--meta scotch_commit=34ea137 --meta pyscotch_commit=1117f7f` renders
"scotch_commit 34ea137 · pyscotch_commit 1117f7f".

## Record

util-linux `script` with a timing file (works with both the classic and the
"advanced" timing format):

```sh
script -q --timing=run.timing run.out -c 'python -m pytest tests/ -x'
```

Tips: use a fixed terminal width (`stty cols 80` or `COLUMNS=80`) so lines fit the
slide; disable colours if the tool does not detect the pipe (`NO_COLOR=1`, `--color=no`),
ANSI is stripped anyway but cursor-movement tricks (spinners, `tqdm` multi-line bars)
only survive as `\r` rewrites.

## Convert

```sh
python3 record_to_json.py run.out run.timing -o resources/recordings/NAME.json \
    --title "..." --command 'python -m pytest tests/ -x' \
    --meta scotch_commit=abc1234 --meta pyscotch_commit=def5678
```

## Use in a reveal deck

In `<head>` (next to `claude-terminal.css`):

```html
<link rel="stylesheet" href="../resources/term-player.css">
```

In a slide, wrapped in the usual terminal mock:

```html
<div class="claude-terminal">
  <div class="term-replay" data-recording="../resources/recordings/demo.json" data-autoplay="1"></div>
</div>
```

At the end of `<body>`, after `reveal.js` (before or after `Reveal.initialize`, both work):

```html
<script src="../resources/term-player.js"></script>
```

Optional attributes on `.term-replay`:

- `data-autoplay="1"` — start when the slide becomes current, pause when it is left.
  Never plays on page load.
- `data-speed="0.5|1|2|4"` — initial speed (default 1)
- `data-max-delay="1200"` — cap per-chunk delay in ms (default 1200)
- `data-line-delay="80"` — ms between the lines of a multi-line chunk (default 0 =
  whole chunk at once). pytest writes in bursts (`hypothesis-coloring.json` is 4 chunks,
  one of them 34 lines), this keeps the replay feel; scaled by speed, ⏭ fin flushes all
- `data-max-lines="22"` — body height in lines, scrolls beyond (default 22)
- `data-wrap="0"` — no wrapping, horizontal scroll instead

Controls: ▶/⏸ (also: click on the body), ⏭ fin (jump to the end), ↺ (restart),
speed select. No keyboard bindings, on purpose: space and arrows stay reveal's.

Static fallback for print / no JS: put a `<pre class="term-replay-static">` inside
the `.term-replay` (or right after it) with the final text; it is hidden on screen
once the player is mounted and shown when printing.

Programmatic: `TermPlayer.mount(el, recordingObject)`, `TermPlayer.mountUrl(el, url)`.

The recording is loaded with `fetch()`, which browsers block on `file://`:
serve the repo (`python3 -m http.server` from the repo root, then
`http://localhost:8000/slides/...`), like the transcript viewer already needs.

Try everything at `http://localhost:8000/resources/term-player-demo.html`.
