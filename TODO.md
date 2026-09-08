# TODO — claude-on-scotch : material to dig up

Written 2026-09-08 after tracing the Scotch arc through git. Everything below is
what the deck still needs and that is **not** in pyscotch, hegel-c, the fork
(c4ffein/scotch), playground, or upstream Scotch. Probably unpublished sessions
or email. Repos are cloned in `~/workspace/{pyscotch,hegel-c,scotch,c4ffein-scotch,playground}`.

Not on this machine: `~/.claude/projects/` only holds presentations / writings /
workspace sessions — no pyscotch, hegel-c or fork sessions. They were done
elsewhere (web sessions, another box, or the phone).

## 1. Épilogue — the email from François

- [ ] François's verdict email (extract to quote on the "Le verdict" slide)
- [x] His OK to say it in public — confirmed on the phone, 2026-09-08. The engineer's version of the task is now a
      public upstream commit under their full name: `adb2b64`, authored
      2026-08-24 21:18 (+0200), pushed 2026-08-27. Anyone at Inria can match it.
      Your Fable session was 2026-08-25 11:55–12:09 Paris time (09:55–10:09 UTC), so neither side saw the other.
- [x] Comparison written by Claude for a live discussion: `notes/treetab-deux-patchs.md`. Framing facts: The two patches are functionally the
      same fix (`dblkglbnum + baseval`, then `tax = tab - baseval` based pointers).
      Differences: the engineer dropped the unused `grafptr` parameter and read
      `ordeptr->baseval`; Fable kept `grafptr->baseval` as the task text said,
      and shipped an MPI test + REPORT.md. François then refactored both
      routines on 2026-08-25 (`2b1a9d8`) and documented `dorderTreeDist()` in
      the maintenance manual on 2026-08-26 (`410cd12`). Released in v7.0.14 (2026-08-27).

## 2. The archDecoArchBuild report — source unknown

Upstream `911ebdf` (2026-08-18) "use proper domains for distance computations
in `archDecoArchBuild()` [report C. Pellegrini]". Not found in any repo, doc,
changelog or transcript. Need:
- [ ] which session / tool found it (hegel-bughunt? pyscotch 7.0.4 dgord/dgpart work of 2026-08-11? email?)
- [ ] the repro or the message sent to François
- [ ] the transcript, if it exists

## 3. Transcripts for the terminal slides

- [x] Hypothesis finds the coloring bug (2025-12-05) — already committed:
      `pyscotch/docs/SAVED_CONTEXT_FOR_NEXT_FP.md` (ends with you saying you'll show François)
- [~] module.h rename-macro bug (2025-11-11, first upstream credit `f7cd80c`) — dropped for now (2026-09-08): the slide links the report (patches/README.md @1b632ef) and the fix instead. The session was local, on the Nov 2025 machine; the 7 web sessions are day 1-2 only (checked `improve-as`).
      Early pyscotch was Claude Code **web** sessions; the ids are in the PR
      branch names, e.g. `claude/pt-scotch-python-wrapper-011CUoRzBTZ4NsvEsa2Xh5pi`
      (7 ids total, `git log --format=%s | grep -o 'claude/[^ ]*'`). The bug was
      found by commit `1b632ef` "En roue libre mon pote" — check whether that
      session is still listed on claude.ai/code.
- [ ] hgraphOrderCp discovery on the fork's `hegel` branch (2026-04-02 → 04-05):
      `38ad659` "hegel report" (Claude's root cause = "obv just a wild guess"),
      `7ef5a40` "gaslighted again by me good Claude", `ff403d4` real 1-char fix.
      That session is the best "lire le C" material in the whole arc. Where is it?
- [ ] Optional: the `add-output-validity-checks` session (2026-03-22, 23 upstream
      C tests given assertions) — nice "Claude reads the C tests" moment.

## 4. Reçus slide — the maintainer side

- [ ] Exchanges with François for: coloring (Dec 2025 → fix `e0a90c7` 2026-01-15,
      checker added the day before `34ea137`), hgraphOrderCp (Apr 2026 → fix
      `0642921` + test `010974e` same day), the July 2026 sweep (memFree /
      meshBuildElem fixed the next day, uncredited `770f26e` `eef80bd`).
- [ ] The "SLA du mainteneur : le dîner de famille" line — your call.
- [ ] hegel-c commit `29c1e40` "review from my dad lol" (2026-04-20) — TODO.md
      section "From FP" — usable as-is if you want.

## 5. Still open upstream at v7.0.14 (for the honest rows of the bilan)

- `SCOTCH_contextOptionSetNum` still does `switch (optival)` (library_context.c:306)
- `SCOTCH_contextAlloc` still absent from module.h rename table
- `libscotch.so` still under-declares NEEDED (no `-Wl,--no-undefined`)
- 8 public functions still undocumented in the manuals (not re-verified)

## 6. Deck fixes already known

- [ ] 3-vertex SVG is wrong: real minimum is one isolated vertex + one K2 edge
      (`MINIMAL nvert=3 nedges=1 edges=[(1,2)]`), not a path 0-1-2
- [ ] Ladder order ≠ chronology: differential tests (gpart byte-identity) are
      2026-07-30, after Hypothesis (Dec 2025) and hegel (Apr 2026)
- [ ] "vague Mythos" date for the "~6 mois" on the Agentic PBT slide
- [ ] QR asset `qr-claude-on-scotch.svg`
- [ ] truncated bullet "Claude peut reframe mes " in "Ce que ça change pour moi"
