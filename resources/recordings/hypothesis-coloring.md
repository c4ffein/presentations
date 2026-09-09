# Hypothesis vs `SCOTCH_graphColor` — recording notes

Recorded 2026-09-08 on this machine (Linux, gcc, util-linux `script` 2.41). Nothing was
committed anywhere; the upstream Scotch clone and the pyscotch clone were not modified
(git worktrees were added under `/home/dev/workspace/builds/`, which only registers
metadata in `.git/worktrees/`).

## Deliverables

- `resources/recordings/hypothesis-coloring.json` — the test FAILS against the buggy Scotch
  (commit before the fix), Hypothesis shrinks to 11 vertices, single edge `(1, 10)`.
- `resources/recordings/hypothesis-coloring-fixed.json` — same test, same seed, PASSES
  against current upstream master (v7.0.14).
- this file.

Raw `script` output/timing files: `/home/dev/workspace/builds/recordings/{buggy,fixed}.{out,timing}`,
driver script `/home/dev/workspace/builds/recordings/run.sh`.

## Commits

| what | commit | date | subject |
|---|---|---|---|
| Scotch, buggy (= `e0a90c7^`) | `34ea137` (34ea137f3083c48a63d105445d6417be9bcb749a) | 2026-01-14 | Add coloring checking routine in test_scotch_graph_color.c |
| Scotch, the fix | `e0a90c7` (e0a90c76235f8b70025ec0f5220b8e4648e6a209) | 2026-01-15 | Bugfix: sequential coloring now considers neighbors colored in same pass |
| Scotch, fixed (master, tag v7.0.14) | `162c408` (162c4081e0e51b9ca39f3d7e7542f39e14a1d081) | 2026-08-27 | Generate documentation for v7.0.14 |
| pyscotch used for BOTH recordings | `a32f242` (a32f242aae8dec0cb909755a338d09bd98533bf6) | 2025-12-09 | added missing test updates |
| pyscotch `main` HEAD (checked, not recorded — see "What did not work") | `1117f7f` | 2026-08-11 | 7.0.4 missing docs api |

The buggy library reports `SCOTCH_version()` = 7.0.10; master reports 7.0.14.

Versions: Python 3.13.5, hypothesis 6.168.0, pytest 9.1.1, numpy 2.5.3 (venvs made with uv 0.11.22).

## Steps actually run

### 1. Scotch worktrees and builds (sequential libscotch only, 64-bit ints, `_64` symbol suffix)

```
mkdir -p /home/dev/workspace/builds
git -C /home/dev/workspace/scotch worktree add          /home/dev/workspace/builds/scotch-precolorfix e0a90c7^
git -C /home/dev/workspace/scotch worktree add --detach /home/dev/workspace/builds/scotch-master      master
# (plain `worktree add ... master` is refused because master is checked out in the main clone)

# for each of the two worktrees, in <worktree>/src :
cp /home/dev/workspace/pyscotch/patches/Makefile.inc.default Makefile.inc
make libscotch CFLAGS="$(grep '^CFLAGS' Makefile.inc | cut -d= -f2-) -DINTSIZE64 -DSCOTCH_NAME_SUFFIX=_64 -DSCOTCH_RENAME_ALL"
```

These are exactly the flags pyscotch's own `make build-seq-64` target uses, just run on the
upstream worktree instead of pyscotch's `build/scotch-src` copy (pyscotch's Scotch submodule was
not initialised and I did not want to touch its tree; no quickfix patch was needed for either
commit — both built cleanly). Build logs: `/home/dev/workspace/builds/build-{precolorfix,master}.log`.

Library directories handed to pyscotch (libscotch.so + libscotcherr*.so copied from
`<worktree>/lib/`, plus pyscotch's compat shim compiled with
`gcc -shared -fPIC -O2 -o libpyscotch_compat.so pyscotch/native/file_compat.c`):

- `/home/dev/workspace/builds/lib64-precolorfix/`  (buggy, 34ea137)
- `/home/dev/workspace/builds/lib64-master/`       (fixed, 162c408 / v7.0.14)

### 2. Sanity check of the known counterexample, straight through the wrapper

```
Graph.from_edges([(1, 10)], num_vertices=11).color()
  buggy lib : num_colors=1, all vertices colour 0  -> INVALID (1 and 10 adjacent, same colour)
  master lib: num_colors=2                         -> VALID
Graph.from_edges([(0, 10)], num_vertices=11).color()
  both libs : num_colors=2                         -> VALID
```

Identical result with pyscotch master (1117f7f) and pyscotch a32f242.

### 3. pyscotch environment used for the recordings

```
git -C /home/dev/workspace/pyscotch worktree add --detach /home/dev/workspace/builds/pyscotch-a32f242 a32f242
uv venv /home/dev/workspace/builds/venv-a32f242 --python 3.13
uv pip install -e /home/dev/workspace/builds/pyscotch-a32f242 pytest hypothesis numpy
# a32f242's loader only looks in <package>/../scotch-builds/lib<INT_SIZE>/ (no PYSCOTCH_LIB_DIR yet):
mkdir -p /home/dev/workspace/builds/pyscotch-a32f242/scotch-builds
ln -sfn /home/dev/workspace/builds/lib64-precolorfix /home/dev/workspace/builds/pyscotch-a32f242/scotch-builds/lib64   # buggy run
ln -sfn /home/dev/workspace/builds/lib64-master      /home/dev/workspace/builds/pyscotch-a32f242/scotch-builds/lib64   # fixed run
```

Env vars: `PYSCOTCH_INT_SIZE=64` (a32f242 defaults to 32), `PYTHONUNBUFFERED=1`, `COLUMNS=100`.
`--runxfail` is required because at a32f242 the test carries
`@pytest.mark.xfail(reason="Upstream Scotch bug with sparse graphs ...")`; with it, the buggy run
reports a real FAILED and the fixed run a real PASSED (instead of xfail / XPASS).

### 4. Seed choice

`.hypothesis/` was deleted before every run (no example database replay). Against the buggy
library, seeds 0–12 ALL fail and all shrink to a single-edge graph; the shrunk example depends on
the seed, e.g. seed 4 and 10 give `(10, [(7, 9)])`. **Seed 1** gives the historical example
`(11, [(1, 10)])` in under a second, so it was used for both recordings.

### 5. Recording and conversion

```
cd /home/dev/workspace/builds/recordings
script -q --timing=buggy.timing buggy.out -c "./run.sh /home/dev/workspace/builds/scotch-precolorfix /home/dev/workspace/builds/pyscotch-a32f242 /home/dev/workspace/builds/venv-a32f242 1"
script -q --timing=fixed.timing fixed.out -c "./run.sh /home/dev/workspace/builds/scotch-master      /home/dev/workspace/builds/pyscotch-a32f242 /home/dev/workspace/builds/venv-a32f242 1"
```

`run.sh` prints the provenance lines (live `git log -1 --format='%h %ad %s' --date=short` of the
Scotch worktree and of pyscotch, Python/hypothesis/pytest versions, resolved libscotch path),
echoes the command, then runs

```
rm -rf .hypothesis && PYSCOTCH_INT_SIZE=64 pytest tests/hypothesis/test_graph_properties.py -k coloring_no_adjacent -p no:cacheprovider -q --tb=short --runxfail --hypothesis-seed=1 --hypothesis-show-statistics
```

Conversion (from the deck repo root):

```
python3 record_to_json.py /home/dev/workspace/builds/recordings/buggy.out /home/dev/workspace/builds/recordings/buggy.timing -o resources/recordings/hypothesis-coloring.json \
  --title "Hypothesis vs SCOTCH_graphColor (Scotch avant e0a90c7)" --command "<the pytest command above>" \
  --meta scotch_commit=34ea137 --meta scotch_date=2026-01-14 --meta pyscotch_commit=a32f242 --meta hypothesis_version=6.168.0 --meta hypothesis_seed=1 ...
python3 record_to_json.py /home/dev/workspace/builds/recordings/fixed.out /home/dev/workspace/builds/recordings/fixed.timing -o resources/recordings/hypothesis-coloring-fixed.json \
  --title "Hypothesis vs SCOTCH_graphColor (Scotch v7.0.14, corrigé)" --meta scotch_commit=162c408 --meta scotch_date=2026-08-27 --meta scotch_tag=v7.0.14 ...
```

Both recordings are short (about 1.5–2 s wall clock, 3–4 chunks after merging): the test fails
and shrinks in under a second, and provenance echoes are instantaneous.

## Output of the buggy run (plain text, exactly as stored in hypothesis-coloring.json)

```
# scotch    : 34ea137 2026-01-14 Add coloring checking routine in test_scotch_graph_color.c
# pyscotch  : a32f242 2025-12-09 added missing test updates
# python    : 3.13.5   hypothesis 6.168.0   pytest 9.1.1
# libscotch : /home/dev/workspace/builds/lib64-precolorfix/libscotch.so

$ rm -rf .hypothesis && PYSCOTCH_INT_SIZE=64 pytest tests/hypothesis/test_graph_properties.py -k coloring_no_adjacent -p no:cacheprovider -q --tb=short --runxfail --hypothesis-seed=1 --hypothesis-show-statistics
F                                                                                            [100%]
============================================= FAILURES =============================================
___________________ TestColoringProperties.test_coloring_no_adjacent_same_color ____________________
tests/hypothesis/test_graph_properties.py:226: in test_coloring_no_adjacent_same_color
    @given(graph_data=simple_graph(min_vertices=2, max_vertices=20))
               ^^^^^^^
tests/hypothesis/test_graph_properties.py:245: in test_coloring_no_adjacent_same_color
    assert coloring[u] != coloring[v], \
E   AssertionError: Adjacent vertices 1 and 10 have same color 0
E   assert np.int64(0) != np.int64(0)
E   Failing test case: test_coloring_no_adjacent_same_color(
E       self=<tests.hypothesis.test_graph_properties.TestColoringProperties object at 0x7f1bda175090>,
E       graph_data=(11, [(1, 10)]),
E   )
E   Explanation:
E       These lines were always and only run by failing test cases:
E           /home/dev/workspace/builds/pyscotch-a32f242/tests/hypothesis/test_graph_properties.py:246
====================================== Hypothesis Statistics =======================================
tests/hypothesis/test_graph_properties.py::TestColoringProperties::test_coloring_no_adjacent_same_color:

  - during generate phase (0.43 seconds):
    - Typical runtimes: ~ 0-32 ms, of which ~ 0-8 ms in data generation
    - 4 passing, 17 failing, and 17 invalid test cases
    - Found 1 distinct error in this phase
    - Events:
      * 36.84%, gave up because: failed to satisfy assume() in simple_graph (line 63)

  - during shrink phase (0.30 seconds):
    - Typical runtimes: ~ 0-12 ms, of which ~ 0-1 ms in data generation
    - 24 passing, 13 failing, and 32 invalid test cases
    - Tried 69 shrinks of which 16 were successful

  - Stopped because nothing left to do


===================================== short test summary info ======================================
FAILED tests/hypothesis/test_graph_properties.py::TestColoringProperties::test_coloring_no_adjacent_same_color - AssertionError: Adjacent vertices 1 and 10 have same color 0
1 failed, 9 deselected in 0.99s
```

## Output of the fixed run (plain text, exactly as stored in hypothesis-coloring-fixed.json)

```
# scotch    : 162c408 2026-08-27 Generate documentation for v7.0.14
# pyscotch  : a32f242 2025-12-09 added missing test updates
# python    : 3.13.5   hypothesis 6.168.0   pytest 9.1.1
# libscotch : /home/dev/workspace/builds/lib64-master/libscotch.so

$ rm -rf .hypothesis && PYSCOTCH_INT_SIZE=64 pytest tests/hypothesis/test_graph_properties.py -k coloring_no_adjacent -p no:cacheprovider -q --tb=short --runxfail --hypothesis-seed=1 --hypothesis-show-statistics
.                                                                                            [100%]
====================================== Hypothesis Statistics =======================================
tests/hypothesis/test_graph_properties.py::TestColoringProperties::test_coloring_no_adjacent_same_color:

  - during generate phase (0.66 seconds):
    - Typical runtimes: ~ 0-7 ms, of which ~ 0-6 ms in data generation
    - 100 passing, 0 failing, and 42 invalid test cases
    - Events:
      * 9.86%, gave up because: failed to satisfy assume() in simple_graph (line 63)

  - Stopped because settings.max_examples=100


1 passed, 9 deselected in 0.84s
```

## What did not work / caveats

- **Current pyscotch `main` (1117f7f) cannot produce a clean shrunk example against the buggy
  library.** Its `Graph.color()` no longer calls `SCOTCH_randomReset()` (the API moved to an
  explicit `pyscotch.random_reset()`), and the property test does not call it either, so Scotch's
  PRNG state carries across examples. The same graph then fails on the first call and passes on
  Hypothesis's re-execution, and Hypothesis aborts with `FlakyFailure` /
  "Stopped because test was flaky" after one shrink step (e.g. seed 1 -> `(7, [(5, 6), (3, 4), (0, 5)])`,
  seed 7 -> `(2, [(0, 1)])` flagged flaky). It still FAILS on every seed tried (0–9), so the bug is
  detected, but the output is a 65-line exception-group traceback rather than a shrunk example.
  That is why the recordings use pyscotch a32f242 (December 2025, the version that actually found
  the bug), where `color(reset_random=True)` is the default and the run is deterministic. The
  fixed-library run was recorded with the same pyscotch a32f242 for a like-for-like contrast;
  pyscotch `main` (1117f7f) + Scotch master was also checked and passes (`1 passed, 9 deselected`).
- hypothesis 6.168.0 prints the shrunk example as `Failing test case:` (inside the assertion
  block) rather than the older `Falsifying example:` label. Same information.
- `cmake` is not installed; the classic `Makefile.inc` build was used instead (no problem).
- pyscotch's `external/scotch` submodule is not initialised in `/home/dev/workspace/pyscotch`; not
  needed since the libraries were built from the upstream worktrees.
- `script` without `-e` exits 0 regardless of the child's status — irrelevant for the recording,
  just do not read its return code as the test result.
- The pytest "Explanation" line shows the absolute path
  `/home/dev/workspace/builds/pyscotch-a32f242/tests/...` — cosmetic.


## Third recording (2026-09-08, added by Claude): `hypothesis-coloring-shrink.json` — the shrink, step by step

Same buggy library (34ea137), same pyscotch (a32f242), same seed (1), but `--hypothesis-verbosity=debug -s`
instead of `--hypothesis-show-statistics`, piped through `hyp-trace-filter.py` (copied next to this file).
Debug verbosity prints every test case with its verdict (`N choices -> Status.VALID|INTERESTING|INVALID|OVERRUN`)
and the shrinker's pass names; the filter collapses each case to one line
`#k graph_data=(...) -> ok | FAIL <assertion> | OVERRUN | INVALID`, counts consecutive OVERRUN/INVALID probes
instead of listing them, prints a pass name once when it changes, and drops choice tuples and tracebacks.
Hypothesis' "explain" phase (dozens of re-runs after the report) is skipped except for its `E` lines.
Driver: `/home/dev/workspace/builds/recordings/run-shrink.sh`. Raw `script` files: `shrink.out` / `shrink.timing`.

Result (230 lines, 3.0 s): generation finds 17-vertex / 38-edge failures within ~20 cases; the shrinker then
drops edges one by one (17 vertices, 7 edges → 1 edge), finds `(17, [(5, 10)])`, then `(17, [(1, 10)])`,
then lowers the vertex count 17 → 15 → 13 → 11 and stops at `(11, [(1, 10)])`: "Run complete after 107 test
cases (28 valid) and 16 shrinks". The filtered output is a faithful projection of the debug log, not a re-ordering.

```
# scotch    : 34ea137 2026-01-14 Add coloring checking routine in test_scotch_graph_color.c
# pyscotch  : a32f242 2025-12-09 added missing test updates
# python    : 3.13.5   hypothesis 6.168.0   pytest 9.1.1
# libscotch : /home/dev/workspace/builds/lib64-precolorfix/libscotch.so
# filtre    : hyp-trace-filter.py — une ligne par cas (graph_data -> ok | FAIL | OVERRUN | INVALID), passes de réduction, tuples de choix et tracebacks omis

$ rm -rf .hypothesis && PYSCOTCH_INT_SIZE=64 pytest tests/hypothesis/test_graph_properties.py -k coloring_no_adjacent -p no:cacheprovider -q --tb=short --runxfail --hypothesis-seed=1 --hypothesis-verbosity=debug -s 2>&1 | python3 -u hyp-trace-filter.py
✓ Loaded Scotch: 64-bit from /home/dev/workspace/builds/pyscotch-a32f242/scotch-builds/lib64/libscotch.so
✓ Structure sizes: graph=120, strat=8, arch=96, dgraph=None
── génération ──
        … 5 essais INVALID
#6    graph_data=(2, [(0, 1)])  -> ok
#7    graph_data=(2, [(0, 1)])  -> ok
        … 4 essais INVALID
#12   graph_data=(2, [(0, 1)])  -> ok
        … 5 essais INVALID
#18   graph_data=(6, [(2, 4), (3, 4), (1, 5), (0, 3), (0, 2), (2, 5), (1, 3)])  -> ok
#19   graph_data=(17, 38 arêtes)  -> FAIL  Adjacent vertices 7 and 13 have same color 1
#20   graph_data=(17, 38 arêtes)  -> FAIL  Adjacent vertices 7 and 13 have same color 1
#21   graph_data=(17, 38 arêtes)  -> FAIL  Adjacent vertices 7 and 13 have same color 1
#22   graph_data=(17, [(3, 14), (0, 4), (5, 8), (7, 10), (1, 14), (3, 9), (7, 8)])  -> FAIL  Adjacent vertices 7 and 10 have same color 1
#23   graph_data=(17, [(13, 14), (3, 14), (5, 8), (7, 10), (1, 14), (3, 9), (7, 8)])  -> FAIL  Adjacent vertices 7 and 10 have same color 1
        … 1 essai OVERRUN
#25   graph_data=(17, [(13, 14), (5, 8), (3, 7), (7, 10), (1, 14), (3, 9), (7, 8)])  -> FAIL  Adjacent vertices 7 and 10 have same color 1
#26   graph_data=(16, 44 arêtes)  -> FAIL  Adjacent vertices 3 and 10 have same color 4
#27   graph_data=(16, 44 arêtes)  -> FAIL  Adjacent vertices 3 and 10 have same color 4
#28   graph_data=(16, 44 arêtes)  -> FAIL  Adjacent vertices 3 and 10 have same color 4
        … 1 essai OVERRUN
#30   graph_data=(16, 44 arêtes)  -> FAIL  Adjacent vertices 3 and 10 have same color 4
#31   graph_data=(16, 44 arêtes)  -> FAIL  Adjacent vertices 3 and 10 have same color 4
#32   graph_data=(16, 44 arêtes)  -> FAIL  Adjacent vertices 3 and 10 have same color 4
#33   graph_data=(11, 35 arêtes)  -> FAIL  Adjacent vertices 1 and 10 have same color 4
#34   graph_data=(11, 35 arêtes)  -> FAIL  Adjacent vertices 1 and 10 have same color 4
#35   graph_data=(11, 35 arêtes)  -> FAIL  Adjacent vertices 1 and 10 have same color 4
        … 1 essai OVERRUN
#37   graph_data=(11, 35 arêtes)  -> FAIL  Adjacent vertices 1 and 10 have same color 4
#38   graph_data=(11, 35 arêtes)  -> FAIL  Adjacent vertices 1 and 10 have same color 4
── réduction (shrinking) ──
#39   graph_data=(17, [(13, 14), (5, 8), (3, 7), (7, 10), (1, 14), (3, 9), (7, 8)])  -> FAIL  Adjacent vertices 7 and 10 have same color 1
   départ : choix (17, 7, 8, 7, 7, 3, 8, 5, 10, 7, 3, 9, 14, 13, 14, 1)…
#40   graph_data=(17, [(0, 7), (13, 14), (5, 8), (7, 10), (3, 7), (1, 14), (3, 9)])  -> FAIL  Adjacent vertices 7 and 10 have same color 0
        … 1 essai OVERRUN
#42   graph_data=(17, [(0, 7), (13, 14), (5, 8), (7, 10), (0, 3), (1, 14), (3, 9)])  -> FAIL  Adjacent vertices 7 and 10 have same color 0
        … 1 essai OVERRUN
#44   graph_data=(17, [(0, 7), (13, 14), (7, 10), (0, 3), (1, 14), (3, 9), (0, 5)])  -> FAIL  Adjacent vertices 7 and 10 have same color 0
        … 2 essais OVERRUN
#47   graph_data=(17, [(0, 7), (13, 14), (0, 10), (0, 3), (1, 14), (3, 9), (0, 5)])  -> ok
#48   graph_data=(17, [(0, 7), (13, 14), (7, 10), (0, 3), (0, 9), (1, 14), (0, 5)])  -> FAIL  Adjacent vertices 7 and 10 have same color 0
        … 1 essai OVERRUN
#50   graph_data=(17, [(0, 7), (13, 14), (7, 10), (0, 3), (0, 9), (0, 5), (0, 14)])  -> FAIL  Adjacent vertices 7 and 10 have same color 0
   passe : try_trivial_spans
        … 2 essais OVERRUN
#53   graph_data=(17, [(0, 7), (7, 10), (0, 13), (0, 3), (0, 9), (0, 5), (0, 14)])  -> FAIL  Adjacent vertices 7 and 10 have same color 0
        … 1 essai OVERRUN
#55   graph_data=(17, [(0, 7), (0, 10), (0, 13), (0, 3), (0, 9), (0, 5), (0, 14)])  -> ok
        … 4 essais OVERRUN
#60   graph_data=(17, [(0, 7)])  -> ok
        … 1 essai INVALID
        … 2 essais OVERRUN
   passe : node_program_XXXXX
        … 8 essais OVERRUN
#72   graph_data=(17, [(5, 10)])  -> FAIL  Adjacent vertices 5 and 10 have same color 0
   passe : node_program_XX
        … 2 essais OVERRUN
   passe : node_program_X
        … 2 essais OVERRUN
   passe : minimize_individual_choices
#77   graph_data=(17, [(0, 5)])  -> ok
#78   graph_data=(17, [(1, 5)])  -> ok
#79   graph_data=(17, [(2, 5)])  -> ok
        … 1 essai OVERRUN
#81   graph_data=(17, [(1, 8)])  -> ok
#82   graph_data=(17, [(5, 8)])  -> ok
#83   graph_data=(17, [(5, 9)])  -> ok
#84   graph_data=(17, [(0, 10)])  -> ok
#85   graph_data=(17, [(1, 10)])  -> FAIL  Adjacent vertices 1 and 10 have same color 0
#86   graph_data=(8, [(0, 1)])  -> ok
#87   graph_data=(15, [(1, 10)])  -> FAIL  Adjacent vertices 1 and 10 have same color 0
#88   graph_data=(13, [(1, 10)])  -> FAIL  Adjacent vertices 1 and 10 have same color 0
#89   graph_data=(11, [(1, 10)])  -> FAIL  Adjacent vertices 1 and 10 have same color 0
#90   graph_data=(9, [(0, 1)])  -> ok
#91   graph_data=(10, [(0, 1)])  -> ok
#92   graph_data=(3, [(0, 1)])  -> ok
#93   graph_data=(5, [(0, 1)])  -> ok
#94   graph_data=(11, [(0, 1)])  -> ok
        … 1 essai OVERRUN
#96   graph_data=(11, [(7, 9)])  -> FAIL  Adjacent vertices 7 and 9 have same color 0
#97   graph_data=(11, [(1, 2)])  -> ok
#98   graph_data=(11, [(1, 5)])  -> ok
#99   graph_data=(11, [(1, 8)])  -> ok
#100  graph_data=(11, [(1, 9)])  -> ok
#101  graph_data=(11, [(0, 10)])  -> ok
   passe : redistribute_numeric_pairs
#102  graph_data=(10, [(0, 2)])  -> ok
        … 1 essai OVERRUN
   passe : lower_integers_together
#104  graph_data=(11, [(0, 9)])  -> ok
#105  graph_data=(10, [(1, 9)])  -> ok
   passe : node_program_XX
        … 1 essai OVERRUN
   passe : node_program_X
        … 1 essai OVERRUN
Shrinking made a total of 68 calls of which 11 shrank and 8 were misaligned. This deleted 12 choices out of 16.
  * minimize_individual_choices made 25 calls of which 4 shrank and 5 were misaligned, deleting 0 choices.
  * try_trivial_spans made 13 calls of which 1 shrank and 0 were misaligned, deleting 0 choices.
  * node_program_XXXXX made 9 calls of which 1 shrank and 1 were misaligned, deleting 12 choices.
  * node_program_XX made 3 calls of which 0 shrank and 0 were misaligned, deleting 0 choices.
  * node_program_X made 3 calls of which 0 shrank and 0 were misaligned, deleting 0 choices.
  * redistribute_numeric_pairs made 2 calls of which 0 shrank and 2 were misaligned, deleting 0 choices.
  * lower_integers_together made 2 calls of which 0 shrank and 0 were misaligned, deleting 0 choices.
#108  graph_data=(rejeu du minimum)  -> FAIL  
============================================= FAILURES =============================================
___________________ TestColoringProperties.test_coloring_no_adjacent_same_color ____________________
tests/hypothesis/test_graph_properties.py:226: in test_coloring_no_adjacent_same_color
    @given(graph_data=simple_graph(min_vertices=2, max_vertices=20))
               ^^^^^^^
../venv-a32f242/lib/python3.13/site-packages/hypothesis/core.py:1691: in _raise_to_user
    raise the_error_hypothesis_found
../venv-a32f242/lib/python3.13/site-packages/hypothesis/core.py:1161: in execute_once
    result = self.test_runner(data, run)
             ^^^^^^^^^^^^^^^^^^^^^^^^^^^
../venv-a32f242/lib/python3.13/site-packages/hypothesis/core.py:828: in default_executor
    return function(data)
           ^^^^^^^^^^^^^^
../venv-a32f242/lib/python3.13/site-packages/hypothesis/core.py:1118: in run
    return test(*args, **kwargs)
           ^^^^^^^^^^^^^^^^^^^^^
tests/hypothesis/test_graph_properties.py:226: in test_coloring_no_adjacent_same_color
    @given(graph_data=simple_graph(min_vertices=2, max_vertices=20))
               ^^^^^^^^^^^^^^^^^^^
../venv-a32f242/lib/python3.13/site-packages/hypothesis/core.py:1025: in test
    result = self.test(*args, **kwargs)
             ^^^^^^^^^^^^^^^^^^^^^^^^^^
tests/hypothesis/test_graph_properties.py:245: in test_coloring_no_adjacent_same_color
    assert coloring[u] != coloring[v], \
E   AssertionError: Adjacent vertices 1 and 10 have same color 0
E   assert np.int64(0) != np.int64(0)
E   Failing test case: test_coloring_no_adjacent_same_color(
E       self=<tests.hypothesis.test_graph_properties.TestColoringProperties object at 0x7fabb6b80b90>,
E       graph_data=(11, [(1, 10)]),
E   )
E   Explanation:
E       These lines were always and only run by failing test cases:
E           /home/dev/workspace/builds/pyscotch-a32f242/tests/hypothesis/test_graph_properties.py:246
E   AssertionError: Adjacent vertices 7 and 13 have same color 1
E   assert np.int64(1) != np.int64(1)
E   AssertionError: Adjacent vertices 7 and 13 have same color 1
E   assert np.int64(1) != np.int64(1)
E   AssertionError: Adjacent vertices 7 and 13 have same color 1
E   assert np.int64(1) != np.int64(1)
E   AssertionError: Adjacent vertices 7 and 10 have same color 1
E   assert np.int64(1) != np.int64(1)
E   AssertionError: Adjacent vertices 7 and 10 have same color 1
E   assert np.int64(1) != np.int64(1)
E   AssertionError: Adjacent vertices 7 and 10 have same color 1
E   assert np.int64(1) != np.int64(1)
E   AssertionError: Adjacent vertices 3 and 10 have same color 4
E   assert np.int64(4) != np.int64(4)
E   AssertionError: Adjacent vertices 3 and 10 have same color 4
E   assert np.int64(4) != np.int64(4)
E   AssertionError: Adjacent vertices 3 and 10 have same color 4
E   assert np.int64(4) != np.int64(4)
E   AssertionError: Adjacent vertices 3 and 10 have same color 4
E   assert np.int64(4) != np.int64(4)
E   AssertionError: Adjacent vertices 3 and 10 have same color 4
E   assert np.int64(4) != np.int64(4)
E   AssertionError: Adjacent vertices 3 and 10 have same color 4
E   assert np.int64(4) != np.int64(4)
E   AssertionError: Adjacent vertices 1 and 10 have same color 4
E   assert np.int64(4) != np.int64(4)
E   AssertionError: Adjacent vertices 1 and 10 have same color 4
E   assert np.int64(4) != np.int64(4)
E   AssertionError: Adjacent vertices 1 and 10 have same color 4
E   assert np.int64(4) != np.int64(4)
E   AssertionError: Adjacent vertices 1 and 10 have same color 4
E   assert np.int64(4) != np.int64(4)
E   AssertionError: Adjacent vertices 1 and 10 have same color 4
E   assert np.int64(4) != np.int64(4)
E   AssertionError: Adjacent vertices 7 and 10 have same color 1
E   assert np.int64(1) != np.int64(1)
E   AssertionError: Adjacent vertices 7 and 10 have same color 0
E   assert np.int64(0) != np.int64(0)
E   AssertionError: Adjacent vertices 7 and 10 have same color 0
E   assert np.int64(0) != np.int64(0)
E   AssertionError: Adjacent vertices 7 and 10 have same color 0
E   assert np.int64(0) != np.int64(0)
E   AssertionError: Adjacent vertices 7 and 10 have same color 0
E   assert np.int64(0) != np.int64(0)
E   AssertionError: Adjacent vertices 7 and 10 have same color 0
E   assert np.int64(0) != np.int64(0)
E   AssertionError: Adjacent vertices 7 and 10 have same color 0
E   assert np.int64(0) != np.int64(0)
E   AssertionError: Adjacent vertices 5 and 10 have same color 0
E   assert np.int64(0) != np.int64(0)
E   AssertionError: Adjacent vertices 1 and 10 have same color 0
E   assert np.int64(0) != np.int64(0)
E   AssertionError: Adjacent vertices 1 and 10 have same color 0
E   assert np.int64(0) != np.int64(0)
E   AssertionError: Adjacent vertices 1 and 10 have same color 0
E   assert np.int64(0) != np.int64(0)
E   AssertionError: Adjacent vertices 1 and 10 have same color 0
E   assert np.int64(0) != np.int64(0)
E   AssertionError: Adjacent vertices 7 and 9 have same color 0
E   assert np.int64(0) != np.int64(0)
Shrink pass profiling
---------------------

Shrinking made a total of 68 calls of which 11 shrank and 8 were misaligned. This deleted 12 choices out of 16.

Useful passes:

  * minimize_individual_choices made 25 calls of which 4 shrank and 5 were misaligned, deleting 0 choices.
  * try_trivial_spans made 13 calls of which 1 shrank and 0 were misaligned, deleting 0 choices.
  * node_program_XXXXX made 9 calls of which 1 shrank and 1 were misaligned, deleting 12 choices.

Useless passes:

  * node_program_XX made 3 calls of which 0 shrank and 0 were misaligned, deleting 0 choices.
  * node_program_X made 3 calls of which 0 shrank and 0 were misaligned, deleting 0 choices.
  * redistribute_numeric_pairs made 2 calls of which 0 shrank and 2 were misaligned, deleting 0 choices.
  * lower_integers_together made 2 calls of which 0 shrank and 0 were misaligned, deleting 0 choices.

Run complete after 107 test cases (28 valid) and 16 shrinks
===================================== short test summary info ======================================
FAILED tests/hypothesis/test_graph_properties.py::TestColoringProperties::test_coloring_no_adjacent_same_color
1 failed, 9 deselected in 2.26s

```
