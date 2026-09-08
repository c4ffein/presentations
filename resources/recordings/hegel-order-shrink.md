# hegel-c vs `SCOTCH_graphOrder` — recording notes

Recorded 2026-09-08 on this machine (Linux 6.12, gcc, cargo 1.96.0, util-linux `script` 2.41).
Nothing was committed anywhere. The hegel-c working tree is untouched except for build
products (`build/`, the `deps/hegel-rust` submodule checkout); the upstream Scotch clone is
untouched (two worktrees were added under `/home/dev/workspace/builds/`, which only writes
metadata in `.git/worktrees/`). Everything else lives under `/home/dev/workspace/builds/`.

## Deliverables

- `resources/recordings/hegel-order-shrink.json` — hegel-c against Scotch **v7.0.11** (before the
  fix): 5 random graphs, failure on case #6, the shrinker runs 10,175 cases and lands on
  `MINIMAL nvert=3 nedges=1 edges=[(1,2)]` (one isolated vertex + one K2 pair). Exit status 1.
  17.0 s, 49 chunks, 77 lines (the raw trace is ~10,200 lines; filter below).
- `resources/recordings/hegel-order-shrink-fixed.json` — same test binary rebuilt against Scotch
  **v7.0.14 = master** (after the fix): 205 cases (200 ok + 5 engine discards), no MINIMAL line, no
  failure, exit status 0. 0.6 s.
- `resources/recordings/hegel-order-shrink-plain.json` — bonus: the **unpatched** hegel-c test binary
  (no trace) against v7.0.11, exactly what `make test-local` runs. 16 s of silence, then the
  `MINIMAL nvert=3 nedges=1 edges=[(1,2)]` note and the failure report, exit status 1.
- this file.

Raw `script` files (all attempts kept): `/home/dev/workspace/builds/rec/{buggy-1,buggy-2,fixed-1,fixed-2,plain-1}.{out,timing}`.
Driver scripts: `/home/dev/workspace/builds/rec-shrink.sh`, `rec-fixed.sh`, `rec-plain.sh`; filter `/home/dev/workspace/builds/trace-filter.awk`.

## Commits / versions

| what | commit / tag | date | note |
|---|---|---|---|
| Scotch, buggy | tag `v7.0.11` = `626b88c` (626b88ce70edabb993bbee463f6c28ae2899af69) | tag 2026-02-11 (commit itself dated 2025-12-31) | `hgraph_order_cp.c:478` has `finevsizsum = 0` |
| Scotch, the fix | `0642921` (064292127f79a394105f7bc872eb51f2c03ead2f) | 2026-04-15 | "Bugfix: make `hgraphOrderCp()` work on (disconnected) subgraphs [report C. Pellegrini]" — NOT an ancestor of v7.0.11, IS an ancestor of v7.0.14 (checked with `git merge-base --is-ancestor`) |
| Scotch, fixed | tag `v7.0.14` = master = `162c408` (162c4081e0e51b9ca39f3d7e7542f39e14a1d081) | 2026-08-27 | `hgraph_order_cp.c:480` has `finevsizsum = ordenum` |
| hegel-c | `ce16904` (ce16904c11bb760a5b02d26a2891a3ef9ccc550c), master | 2026-07-03 | "make tests more reproducible" |
| hegel-rust (engine, submodule `deps/hegel-rust`) | `68087d5` = tag `v0.17.4` | | builds `libhegel.so` (crates `hegeltest` + `hegeltest-c` 0.17.4) |

## Build steps actually run

### 1. hegel-c (pure-C runtime + Rust engine cdylib)

```
cd /home/dev/workspace/hegel-c
git submodule update --init --recursive          # deps/hegel-rust -> 68087d5 (v0.17.4)
export PATH=$HOME/.cargo/bin:$PATH
make lib                                          # build/libhegel_c.a (gcc -Wall -Wextra -O2)
make libhegel                                     # cargo build -p hegeltest-c --release -> build/libhegel.so (2.3 MB)
```
Log: `/home/dev/workspace/builds/hegel-c-build.log`. The cargo build worked first time (network to
crates.io was available). The runtime dlopens `libhegel.so`; every run below passes
`HEGEL_LIBHEGEL_PATH=/home/dev/workspace/hegel-c/build/libhegel.so` and cds to the hegel-c root
(either alone would do).

### 2. Scotch, sequential library only, twice

```
mkdir -p /home/dev/workspace/builds
git -C /home/dev/workspace/scotch worktree add /home/dev/workspace/builds/scotch-7.0.11 v7.0.11
git -C /home/dev/workspace/scotch worktree add /home/dev/workspace/builds/scotch-7.0.14 v7.0.14
# in each <worktree>/src:
cp Make.inc/Makefile.inc.x86-64_pc_linux2 Makefile.inc
make scotch                                       # -> ../lib/libscotch.a libscotcherr.a ..., ../include/scotch.h
```
Flags are the stock ones from that Makefile.inc (`-O3 -fPIC ... -DSCOTCH_PTHREAD -DSCOTCH_RENAME
-DIDXSIZE64`; `SCOTCH_Num` stays a 32-bit int). Static libraries, so each test binary is bound to
exactly one Scotch version. Logs: `/home/dev/workspace/builds/scotch-7.0.1{1,4}-build.log`.

### 3. Test binaries (`/home/dev/workspace/builds/bin/`)

`make test-local` was NOT used: it `clean`s and rebuilds every test in `tests/irl/scotch/`, including
`test_dgraph_part`, which needs PT-Scotch + `mpicc` (not built), and it hardcodes
`inspiration/targets/scotch`. The shrink test was compiled by hand with the exact flags of that
Makefile (`CFLAGS`/`LDFLAGS` lines), against each Scotch tree:

```
cd /home/dev/workspace/hegel-c
for v in 7.0.11 7.0.14; do S=/home/dev/workspace/builds/scotch-$v
  gcc -Wall -Wextra -O2 -I. -I$S/include -funwind-tables -fexceptions \
      -o /home/dev/workspace/builds/bin/test_graph_order_shrink-$v tests/irl/scotch/test_graph_order_shrink.c \
      -Lbuild -L$S/lib -lhegel_c -lscotch -lscotcherr -lz -lm -lpthread -ldl -lrt
done
```
`test_graph_order_shrink-7.0.11` (unpatched) is what `hegel-order-shrink-plain.json` shows.
The two `-trace` variants used by the other two recordings are built the same way from the patched
copy in `/home/dev/workspace/builds/hegel-c-trace/` (see next section).

### 4. Runtime env

`MALLOC_PERTURB_=170` on every run (the value `tests/irl/scotch/Makefile` sets in `HEGEL_SHRINK_ENV`:
the bug reads uninitialised heap, glibc's perturb byte makes the outcome of a given input
deterministic across replays, otherwise the engine's flakiness detector aborts the shrink).
`ulimit -c 0` (the failing children die by SIGSEGV; no core files were produced anyway).

## What did not work, and what was done about it

1. **`HEGEL_VERBOSE_TRACE` does not exist in hegel-c `ce16904`.** `docs/shrinking.md` ("Watching the
   shrinker work") describes `[hegel] case_start #N` / `case_end #N ok|fail|eof` lines, but that text
   dates from the Rust-bridge era (it even links `design_rust_bridge.md`); the pure-C runtime's only
   `getenv` is `HEGEL_LIBHEGEL_PATH` (`grep -rn getenv core/`). Setting the variable changes nothing:
   the first trial run printed only the final replay (`Draw 1..4`, `MINIMAL ...`, report).
   Rather than modify the hegel-c tree, a copy of `core/`, `hegel_gen.*`, `hegel_c.h` and the test was
   made in `/home/dev/workspace/builds/hegel-c-trace/` and given a 30-line trace patch (full diff at
   the end of this file): when `HEGEL_VERBOSE_TRACE` is set, the fork parent prints `[hegel] #N ` before
   each case, the child prints the graph it drew (the same text the test already builds for its
   `MINIMAL` note, minus the `MINIMAL ` prefix), and the parent finishes the line with the verdict it
   reports to the engine: `-> ok`, `-> FAIL  <origin>` (invalid permutation caught by the test's
   check), `-> CRASH  crash: signal 11` (SIGSEGV inside Scotch), `-> discard (overrun)` (engine cut
   the case short). The final replay gets its own line. Nothing about generation or shrinking is
   changed: the plain recording (unpatched library and test) reaches the same minimum.
2. **The raw trace is ~10,000 lines**, not the ~100 the docs suggest: the engine spends ~10,000 cases
   shrinking (most are `ok` or `discard` probes). Filter, applied live in the recording and
   reproduced in full at the end of this file: every case until the first failure; afterwards a
   failing case is printed only if its `(nvert, nedges, edge list)` is a new lexicographic minimum
   among the failing cases printed so far (numbers compared numerically); plus every 250th case,
   whatever its verdict, to show the probing rhythm; non-case lines (final replay, `MINIMAL`, report)
   pass through. 10,175 case lines -> 77 lines.
3. **mawk buffers piped input.** Debian's `awk` is mawk; the first buggy recording (`buggy-1`, which
   also reached `nvert=3 nedges=1 edges=[(1,2)]`, 8,947 cases) came out as two bursts 8 s apart
   instead of a stream. Fixed with `awk -W interactive`; `buggy-2` streams (68 timing entries).
   Cosmetic leftover: the `$ ...` line echoed inside the recordings shows `awk -f trace-filter.awk`
   without `-W interactive`; the JSON `meta.command` has the exact pipeline.
4. **Date of v7.0.11:** the tag object is dated 2026-02-11 (as in the brief); the commit it points to,
   `626b88c` "Generate documentation for v7.0.11", is dated 2025-12-31. Both are before the fix.
5. The engine treats the two symptoms of the same bug as two failure origins (`hegel_fail` = the
   permutation check fired; `crash: signal 11` = Scotch segfaulted first). With
   `report_multiple_failures=false` it shrinks and reports one of them — the crash, in every run here.

## Attempts

Every run of the shrink test made during this session, in order (all against v7.0.11):

| # | run | under `script`? | cases | result |
|---|---|---|---|---|
| 1 | trial, unpatched binary, output only grepped | no | ? (no trace) | `MINIMAL nvert=3 nedges=1 edges=[(1,2)]`, 16.7 s |
| 2 | trial, unpatched binary, raw output kept | no | ? (no trace) | `MINIMAL nvert=3 nedges=1 edges=[(1,2)]` |
| 3 | trial, trace build, full trace to a file (8,926 lines) | no | 8,914 | `MINIMAL nvert=3 nedges=1 edges=[(1,2)]` |
| 4 | `buggy-1` (recording, mawk buffering, discarded) | yes | 8,947 | `MINIMAL nvert=3 nedges=1 edges=[(1,2)]`, 15.7 s |
| 5 | **`buggy-2` = `hegel-order-shrink.json`** | yes | 10,175 | `MINIMAL nvert=3 nedges=1 edges=[(1,2)]`, 17.0 s |
| 6 | **`plain-1` = `hegel-order-shrink-plain.json`** (unpatched binary) | yes | ? (no trace) | `MINIMAL nvert=3 nedges=1 edges=[(1,2)]`, 16.3 s |

5 of 5 runs with a visible result landed on the theoretical minimum (the brief expected ~2 in 5, with
`nvert=4` or `nedges=2` otherwise); no attempt had to be retried for shrink quality. Against
v7.0.14 the test was run three times (one trial, `fixed-1`, `fixed-2`): 205 cases each time
(200 ok + 5 `discard (overrun)`), exit 0, no MINIMAL line.

## Recording commands

```
cd /home/dev/workspace/builds/rec
script -q --timing=buggy-2.timing buggy-2.out -c "/home/dev/workspace/builds/rec-shrink.sh '<label>' /home/dev/workspace/builds/bin/test_graph_order_shrink-7.0.11-trace"
script -q --timing=fixed-2.timing fixed-2.out -c "/home/dev/workspace/builds/rec-fixed.sh  '<label>' /home/dev/workspace/builds/bin/test_graph_order_shrink-7.0.14-trace"
script -q --timing=plain-1.timing plain-1.out -c "/home/dev/workspace/builds/rec-plain.sh  '<label>' /home/dev/workspace/builds/bin/test_graph_order_shrink-7.0.11"
```
The pipeline inside `rec-shrink.sh` (cwd = hegel-c root):
```
MALLOC_PERTURB_=170 HEGEL_VERBOSE_TRACE=1 HEGEL_LIBHEGEL_PATH=$HEGEL_C/build/libhegel.so "$bin" 2>&1 | awk -W interactive -f trace-filter.awk
```
Conversion (from the deck repo root):
```
python3 record_to_json.py /home/dev/workspace/builds/rec/buggy-2.out /home/dev/workspace/builds/rec/buggy-2.timing -o resources/recordings/hegel-order-shrink.json \
    --title "hegel-c vs SCOTCH_graphOrder (Scotch v7.0.11, avant 0642921)" --command "..." \
    --meta scotch_commit=v7.0.11=626b88c --meta scotch_date=2026-02-11 --meta hegel_c_commit=ce16904 --meta hegel_rust=v0.17.4 \
    --meta scotch_fix_commit=0642921 --meta scotch_fix_date=2026-04-15 --meta minimal="MINIMAL nvert=3 nedges=1 edges=[(1,2)]"
```
(same for `-fixed` with `scotch_commit=v7.0.14=162c408 scotch_date=2026-08-27`, and `-plain`).

## Complete text of `hegel-order-shrink.json` (buggy-2.out, `Script started/done` lines removed)

```
# scotch  : v7.0.11 (626b88c, tagged 2026-02-11) -- BEFORE bugfix 0642921 (2026-04-15) in hgraph_order_cp.c
# hegel-c : ce16904 (2026-07-03) + 30-line trace patch (see hegel-order-shrink.md); engine libhegel = hegel-rust v0.17.4
# test    : tests/irl/scotch/test_graph_order_shrink.c — random graph (3..20 vertices, 0..30 edges),
#           property: SCOTCH_graphOrder(SCOTCH_STRATDISCONNECTED) writes a valid permutation
# trace   : one line per test case:  [hegel] #N <drawn graph> -> ok | FAIL | CRASH | discard
# filter  : awk — all cases up to the first failure; then only failing cases that are a new
#           minimum in (nvert, nedges, edges) + every 250th case; final replay & report unfiltered
$ MALLOC_PERTURB_=170 HEGEL_VERBOSE_TRACE=1 ./test_graph_order_shrink 2>&1 | awk -f trace-filter.awk
[hegel] #1 nvert=3 nedges=0 edges=[] -> ok
[hegel] #2 nvert=8 nedges=17 edges=[(7,14),(7,15),(6,2),(16,0),(11,8),(3,13),(5,6),(3,8),(6,5),(16,16),(15,15),(14,19),(1,17),(10,7),(9,19),(9,8),(8,5)] -> ok
[hegel] #3 nvert=19 nedges=11 edges=[(13,0),(17,9),(15,5),(5,11),(8,17),(5,14),(17,5),(1,10),(7,13),(18,1),(16,1)] -> ok
[hegel] #4 nvert=3 nedges=1 edges=[(9,2)] -> ok
[hegel] #5 nvert=5 nedges=13 edges=[(12,19),(10,12),(9,9),(19,18),(16,17),(3,1),(5,13),(1,19),(13,18),(6,7),(2,2),(10,1),(2,4)] -> ok
[hegel] #6 nvert=20 nedges=3 edges=[(10,14),(14,12),(2,7)] -> FAIL  hegel_fail
[hegel] #18 nvert=20 nedges=2 edges=[(14,14),(11,10)] -> FAIL  hegel_fail
[hegel] #22 nvert=3 nedges=2 edges=[(14,14),(11,10)] -> CRASH  crash: signal 11 (Segmentation fault)
[hegel] #29 nvert=3 nedges=2 edges=[(0,0),(11,10)] -> CRASH  crash: signal 11 (Segmentation fault)
[hegel] #61 nvert=3 nedges=1 edges=[(10,11)] -> CRASH  crash: signal 11 (Segmentation fault)
[hegel] #181 nvert=3 nedges=1 edges=[(2,4)] -> CRASH  crash: signal 11 (Segmentation fault)
[hegel] #185 nvert=3 nedges=1 edges=[(2,1)] -> CRASH  crash: signal 11 (Segmentation fault)
[hegel] #250 -> discard (overrun)
[hegel] #500 -> discard (overrun)
[hegel] #750 -> discard (overrun)
[hegel] #1000 nvert=4 nedges=0 edges=[] -> ok
[hegel] #1250 -> discard (overrun)
[hegel] #1500 nvert=4 nedges=1 edges=[(6,7)] -> CRASH  crash: signal 11 (Segmentation fault)
[hegel] #1750 nvert=4 nedges=1 edges=[(2,11)] -> CRASH  crash: signal 11 (Segmentation fault)
[hegel] #2000 nvert=6 nedges=0 edges=[] -> ok
[hegel] #2250 -> discard (overrun)
[hegel] #2500 -> discard (overrun)
[hegel] #2750 nvert=4 nedges=1 edges=[(5,1)] -> ok
[hegel] #3000 nvert=4 nedges=1 edges=[(2,4)] -> ok
[hegel] #3250 nvert=6 nedges=1 edges=[(2,7)] -> ok
[hegel] #3500 -> discard (overrun)
[hegel] #3750 -> discard (overrun)
[hegel] #4000 nvert=4 nedges=1 edges=[(0,1)] -> ok
[hegel] #4250 nvert=4 nedges=1 edges=[(2,10)] -> ok
[hegel] #4500 -> discard (overrun)
[hegel] #4750 -> discard (overrun)
[hegel] #5000 -> discard (overrun)
[hegel] #5250 nvert=4 nedges=1 edges=[(1,1)] -> ok
[hegel] #5500 nvert=4 nedges=1 edges=[(2,6)] -> ok
[hegel] #5750 nvert=5 nedges=1 edges=[(14,16)] -> CRASH  crash: signal 11 (Segmentation fault)
[hegel] #5845 nvert=3 nedges=1 edges=[(1,5)] -> CRASH  crash: signal 11 (Segmentation fault)
[hegel] #6000 -> discard (overrun)
[hegel] #6068 nvert=3 nedges=1 edges=[(1,2)] -> CRASH  crash: signal 11 (Segmentation fault)
[hegel] #6250 nvert=3 nedges=1 edges=[(1,4)] -> ok
[hegel] #6500 -> discard (overrun)
[hegel] #6750 nvert=3 nedges=1 edges=[(0,1)] -> ok
[hegel] #7000 -> discard (overrun)
[hegel] #7250 -> discard (overrun)
[hegel] #7500 nvert=3 nedges=1 edges=[(1,3)] -> ok
[hegel] #7750 -> discard (overrun)
[hegel] #8000 nvert=3 nedges=1 edges=[(2,3)] -> ok
[hegel] #8250 -> discard (overrun)
[hegel] #8500 -> discard (overrun)
[hegel] #8750 nvert=3 nedges=1 edges=[(5,1)] -> CRASH  crash: signal 11 (Segmentation fault)
[hegel] #9000 -> discard (overrun)
[hegel] #9250 -> discard (overrun)
[hegel] #9500 nvert=3 nedges=1 edges=[(1,6)] -> ok
[hegel] #9750 -> discard (overrun)
[hegel] #10000 nvert=3 nedges=1 edges=[(3,7)] -> ok
Draw 1: 3
Draw 2: 1
Draw 3: 1
Draw 4: 2
MINIMAL nvert=3 nedges=1 edges=[(1,2)]
[hegel] #10175 (final replay of the minimal example) -> CRASH

=== hegel-c: property test FAILED ===
origin: crash: signal 11 (Segmentation fault)
Failure reported by C caller: crash: signal 11 (Segmentation fault)

reproduce blob: AXicY2EAAi5GIMEMoRhRKCYAA80AOA==
Property test failed: test case crashed with signal 11 (Segmentation fault)
$ echo $?   # exit status of test_graph_order_shrink
1
```

## Complete text of `hegel-order-shrink-fixed.json` (fixed-2.out)

```
# scotch  : v7.0.14 = master (162c408, 2026-08-27) -- AFTER bugfix 0642921
# hegel-c : ce16904 (2026-07-03) + 30-line trace patch (see hegel-order-shrink.md); engine libhegel = hegel-rust v0.17.4
# test    : tests/irl/scotch/test_graph_order_shrink.c — same test, same property, 200 cases max
# filter  : awk — first 10 cases, then every 10th case, then a count of cases per verdict
$ MALLOC_PERTURB_=170 HEGEL_VERBOSE_TRACE=1 ./test_graph_order_shrink 2>&1 | awk '...'
[hegel] #1 nvert=3 nedges=0 edges=[] -> ok
[hegel] #2 nvert=10 nedges=7 edges=[(11,7),(1,15),(16,16),(2,16),(11,5),(19,3),(15,6)] -> ok
[hegel] #3 nvert=3 nedges=10 edges=[(2,0),(5,3),(2,14),(11,8),(15,15),(18,17),(14,19),(7,16),(2,19),(4,14)] -> ok
[hegel] #4 nvert=9 nedges=12 edges=[(2,15),(7,6),(1,7),(3,15),(7,17),(9,16),(17,14),(2,0),(11,10),(12,8),(3,12),(1,7)] -> ok
[hegel] #5 nvert=20 nedges=17 edges=[(15,13),(11,9),(0,19),(15,15),(14,9),(6,6),(18,13),(11,17),(9,11),(7,3),(0,8),(15,12),(2,13),(1,15),(9,9),(6,9),(13,7)] -> ok
[hegel] #6 nvert=7 nedges=22 edges=[(16,16),(17,14),(8,8),(1,5),(5,5),(8,5),(5,17),(19,0),(3,10),(4,12),(9,17),(1,9),(8,5),(6,19),(13,1),(19,12),(19,17),(14,16),(5,14),(12,2),(4,6),(11,13)] -> ok
[hegel] #7 nvert=16 nedges=17 edges=[(0,17),(7,5),(16,0),(11,3),(1,5),(9,6),(19,16),(0,16),(7,11),(17,10),(0,15),(8,16),(17,5),(6,4),(7,3),(12,5),(1,9)] -> ok
[hegel] #8 nvert=14 nedges=14 edges=[(15,3),(0,0),(14,1),(16,1),(8,1),(19,10),(18,19),(0,3),(10,7),(17,5),(8,6),(9,0),(1,4),(3,9)] -> ok
[hegel] #9 nvert=18 nedges=27 edges=[(8,13),(19,17),(0,8),(17,19),(14,12),(13,12),(13,10),(10,16),(16,0),(17,19),(5,1),(1,3),(1,10),(17,10),(15,12),(4,14),(1,3),(7,0),(16,0),(13,16),(17,2),(17,10),(4,4),(6,0),(13,1),(1,17),(12,18)] -> ok
[hegel] #10 nvert=11 nedges=10 edges=[(19,3),(10,19),(1,15),(17,8),(11,3),(19,14),(8,12),(7,1),(4,10),(17,7)] -> ok
[hegel] #20 nvert=20 nedges=22 edges=[(7,1),(16,17),(14,8),(16,5),(8,3),(12,1),(4,18),(5,14),(16,17),(11,17),(3,16),(6,1),(3,16),(8,12),(14,8),(16,0),(14,11),(13,4),(15,4),(13,16),(9,18),(13,2)] -> ok
[hegel] #30 nvert=11 nedges=18 edges=[(16,0),(16,0),(16,16),(0,18),(15,12),(14,2),(1,16),(7,13),(18,18),(16,0),(6,0),(8,12),(8,19),(4,0),(0,12),(10,17),(6,3),(12,12)] -> ok
[hegel] #40 nvert=18 nedges=14 edges=[(8,10),(3,1),(9,11),(19,3),(1,4),(2,1),(19,12),(10,15),(14,15),(17,12),(13,1),(8,14),(1,6),(7,12)] -> ok
[hegel] #50 nvert=15 nedges=16 edges=[(9,11),(14,16),(1,1),(1,19),(11,13),(2,6),(1,16),(2,13),(17,7),(9,11),(8,12),(2,8),(15,4),(15,6),(8,1),(0,2)] -> ok
[hegel] #60 nvert=11 nedges=24 edges=[(4,18),(14,4),(10,2),(14,17),(5,5),(17,10),(11,10),(9,1),(15,15),(15,3),(2,16),(7,4),(3,4),(17,10),(0,0),(0,0),(15,0),(3,6),(8,6),(7,16),(4,9),(2,13),(7,19),(16,3)] -> ok
[hegel] #70 -> discard (overrun)
[hegel] #80 nvert=15 nedges=24 edges=[(17,0),(8,11),(5,8),(18,5),(3,5),(19,3),(4,7),(9,5),(15,17),(13,9),(17,18),(14,11),(13,1),(4,9),(0,12),(8,19),(5,7),(12,14),(16,13),(2,4),(9,12),(19,3),(15,8),(19,15)] -> ok
[hegel] #90 nvert=8 nedges=9 edges=[(1,11),(0,19),(11,8),(16,9),(18,8),(12,15),(16,9),(3,13),(14,1)] -> ok
[hegel] #100 nvert=15 nedges=17 edges=[(10,0),(6,16),(6,6),(9,13),(15,0),(0,17),(6,14),(16,5),(11,8),(12,14),(3,7),(18,9),(19,11),(10,13),(16,5),(15,18),(17,9)] -> ok
[hegel] #110 nvert=19 nedges=12 edges=[(17,6),(10,3),(5,1),(7,13),(8,7),(5,2),(2,12),(19,0),(19,12),(16,7),(10,18),(12,10)] -> ok
[hegel] #120 nvert=15 nedges=14 edges=[(13,13),(6,18),(14,6),(7,17),(1,14),(6,2),(11,4),(19,0),(19,15),(6,2),(1,1),(11,19),(19,16),(11,7)] -> ok
[hegel] #130 nvert=9 nedges=6 edges=[(7,2),(3,19),(11,7),(9,13),(2,19),(5,16)] -> ok
[hegel] #140 nvert=12 nedges=10 edges=[(0,12),(18,5),(9,19),(16,7),(13,3),(18,4),(10,17),(14,3),(3,5),(12,16)] -> ok
[hegel] #150 nvert=12 nedges=15 edges=[(4,1),(13,6),(14,6),(9,15),(17,1),(12,9),(6,11),(1,13),(12,15),(0,18),(2,18),(0,18),(16,13),(5,16),(14,7)] -> ok
[hegel] #160 nvert=11 nedges=1 edges=[(11,6)] -> ok
[hegel] #170 nvert=8 nedges=8 edges=[(4,4),(7,17),(0,18),(4,4),(0,13),(19,6),(4,16),(3,16)] -> ok
[hegel] #180 nvert=5 nedges=25 edges=[(5,16),(19,1),(6,9),(15,11),(4,4),(10,19),(3,0),(18,0),(18,10),(12,8),(0,1),(7,15),(9,0),(16,14),(12,18),(3,12),(7,15),(12,19),(8,6),(1,0),(10,19),(9,0),(10,7),(13,12),(14,18)] -> ok
[hegel] #190 nvert=15 nedges=13 edges=[(18,6),(17,9),(7,0),(2,12),(12,8),(19,1),(18,14),(0,2),(12,5),(18,14),(6,0),(17,15),(4,5)] -> ok
[hegel] #200 nvert=20 nedges=25 edges=[(0,2),(18,1),(7,17),(13,12),(14,16),(18,0),(5,8),(4,3),(4,1),(1,15),(17,11),(4,17),(0,15),(2,6),(4,5),(4,3),(10,5),(0,11),(14,6),(4,9),(10,19),(2,13),(1,9),(1,12),(5,18)] -> ok
# 202 cases run:  ok x200  discard (overrun) x2   (no MINIMAL line, no failure)
$ echo $?   # exit status of test_graph_order_shrink
0
```

## Complete text of `hegel-order-shrink-plain.json` (plain-1.out)

```
# scotch  : v7.0.11 (626b88c, tagged 2026-02-11) -- BEFORE bugfix 0642921 (2026-04-15) in hgraph_order_cp.c
# hegel-c : ce16904 unpatched; engine libhegel = hegel-rust v0.17.4
# test    : tests/irl/scotch/test_graph_order_shrink.c, 200 cases max
$ MALLOC_PERTURB_=170 ./test_graph_order_shrink
Draw 1: 3
Draw 2: 1
Draw 3: 1
Draw 4: 2
MINIMAL nvert=3 nedges=1 edges=[(1,2)]
Property test failed: test case crashed with signal 11 (Segmentation fault)

=== hegel-c: property test FAILED ===
origin: crash: signal 11 (Segmentation fault)
Failure reported by C caller: crash: signal 11 (Segmentation fault)

reproduce blob: AXicY2EAAi5GIMEMoRhRKCYAA80AOA==
$ echo $?
1
```

## The filter (`/home/dev/workspace/builds/trace-filter.awk`)

```awk
# Filter applied to the trace for the recording (documented in hegel-order-shrink.md):
#  - every case until (and including) the first FAIL/CRASH (generation phase),
#  - afterwards a failing case is shown only if its (nvert, nedges, edge list) is lexicographically
#    smaller than every failing case shown before (the shrinker's new bests),
#    plus every 250th case whatever its verdict (to show the probing rhythm: ok / FAIL / discard),
#  - lines that are not "[hegel] #N ... -> verdict" (final replay, MINIMAL, report) pass unchanged.
# key: every number zero-padded to 3 digits so string order == numeric order, field by field
function key(line,   a, k, m) { match(line, /nvert=[0-9]+ nedges=[0-9]+ edges=\[[^]]*\]/); a = substr(line, RSTART, RLENGTH); k = ""
                                while (match(a, /[0-9]+/)) { k = k substr(a, 1, RSTART - 1) sprintf("%03d", substr(a, RSTART, RLENGTH)); a = substr(a, RSTART + RLENGTH) }
                                return k a }
/^\[hegel\] #[0-9]+ (nvert=|-> discard)/ {
  n++
  failing = ($0 ~ /-> (FAIL|CRASH)/)
  if (!seen_fail) { print; fflush(); if (failing) { seen_fail = 1; best = key($0) }; next }
  if (failing && key($0) < best) { best = key($0); print; fflush(); next }
  if (n % 250 == 0) { print; fflush() }
  next
}
{ print; fflush() }
```

## The trace patch (`/home/dev/workspace/builds/hegel-c-trace/trace.patch`, against hegel-c ce16904)

```diff
--- core/hegel_runner.c	2026-09-08 16:08:28.795839065 +0000
+++ /home/dev/workspace/builds/hegel-c-trace/core/hegel_runner.c	2026-09-08 19:21:11.767227410 +0000
@@ -40,6 +40,19 @@
   char msg[1024];
 } case_outcome;
 
+/* TRACE PATCH (deck recording, not upstream): HEGEL_VERBOSE_TRACE=1 prints one
+** stderr line per test case: "[hegel] #N <input from hegel__trace_input> -> verdict". */
+int      hegel__trace    = 0;
+uint64_t hegel__trace_no = 0;
+static const char * trace_kind (const case_outcome * out)
+{
+  if (out->status == HG_STATUS_VALID)       return "ok";
+  if (out->status == HG_STATUS_INTERESTING) return strncmp (out->origin, "crash:", 6) == 0 ? "CRASH" : "FAIL";
+  if (out->status == HG_STATUS_OVERRUN)     return "discard (overrun)";
+  return "discard (assume)";
+}
+
+
 /* ---- Fork-mode parent: serve one child's requests ---- */
 
 /* Map an engine-layer draw result (0 ok / 1 stop / 2 assume) to a
@@ -398,6 +411,7 @@
   eng->settings_verbosity (s, HG_VERBOSITY_QUIET);
   eng->settings_database (s, "");           /* no example DB — match old behavior */
   eng->settings_report_multiple_failures (s, false);
+  hegel__trace = getenv ("HEGEL_VERBOSE_TRACE") != NULL;   /* TRACE PATCH */
 
   hg_run * run = eng->run_start (s);
   if (!run) {
@@ -413,10 +427,16 @@
     int final_replay = eng->tc_is_final_replay (htc);
     case_outcome out;
 
+    hegel__trace_no++;                                        /* TRACE PATCH */
+    if (hegel__trace && !final_replay) fprintf (stderr, "[hegel] #%llu ", (unsigned long long) hegel__trace_no);
     if (use_fork)
       run_case_forked (eng, htc, test_fn, final_replay, &out);
     else
       run_case_inproc (eng, htc, test_fn, final_replay, &out);
+    if (hegel__trace) {                                       /* TRACE PATCH */
+      if (final_replay) fprintf (stderr, "[hegel] #%llu (final replay of the minimal example) -> %s\n", (unsigned long long) hegel__trace_no, trace_kind (&out));
+      else fprintf (stderr, "-> %s%s%s\n", trace_kind (&out), out.status == HG_STATUS_INTERESTING ? "  " : "", out.status == HG_STATUS_INTERESTING ? out.origin : "");
+    }
 
     eng->mark_complete (htc, out.status,
                         out.status == HG_STATUS_INTERESTING ? out.origin : NULL);
--- core/hegel_runtime.c	2026-09-08 16:08:28.795839065 +0000
+++ /home/dev/workspace/builds/hegel-c-trace/core/hegel_runtime.c	2026-09-08 19:20:43.398724206 +0000
@@ -689,6 +689,13 @@
 
 /* ---- Notes, assume, fail ---- */
 
+/* TRACE PATCH (deck recording, not upstream) */
+extern int hegel__trace;
+void hegel__trace_input (hegel_testcase * tc, const char * msg)
+{
+  if (hegel__trace && !tc->final_replay) { fprintf (stderr, "%s ", msg); fflush (stderr); }
+}
+
 void hegel_note (hegel_testcase * tc, const char * msg)
 {
   if (tc->final_replay) {
--- tests/irl/scotch/test_graph_order_shrink.c	2026-09-08 16:08:28.803839209 +0000
+++ /home/dev/workspace/builds/hegel-c-trace/test_graph_order_shrink.c	2026-09-08 19:20:43.398724206 +0000
@@ -60,6 +60,8 @@
 #include "hegel_c.h"
 #include "hegel_gen.h"
 
+void hegel__trace_input (hegel_testcase * tc, const char * msg);   /* TRACE PATCH */
+
 /* ---- Layer 1: types + CSR builder ---- */
 
 typedef struct EdgePair {
@@ -220,6 +222,7 @@
                        (i + 1 < g->nedges) ? "," : "");
     }
     snprintf (note_buf + off, sizeof (note_buf) - off, "]");
+    hegel__trace_input (tc, note_buf + 8);   /* TRACE PATCH: same text minus "MINIMAL " */
     hegel_note (tc, note_buf);
   }
```
