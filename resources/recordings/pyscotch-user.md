# pyscotch end-user journey — recording notes

Recorded 2026-09-08 (23:46–23:49 UTC) on this machine: Linux 6.12.74+deb13+1-amd64 x86_64,
Debian GNU/Linux 13 (trixie), 8 cpus (Intel Xeon D-2123IT @ 2.20GHz), gcc 14.2.0, OpenMPI 5.0.7
(`mpicc`/`mpirun` from Debian), flex 2.6.4, bison 3.8.2, uv 0.11.22, util-linux `script` 2.41.
Nothing was committed or modified in `/home/dev/workspace/pyscotch` (only read for the docs).
Everything lives under `/home/dev/workspace/builds/pyscotch-user/`: the venv (`.venv`), the isolated build store
(`pyscotch-home/`), the driver scripts (`rec1-install.sh`, `rec2-doctor.sh`, `rec3-build.sh`,
`rec4-doctor-after.sh`, `common.sh`), the raw `script` files (`rec/*.out`, `rec/*.timing`, all
attempts kept) and the two demo scripts (`taste.py`, `dgraph_demo.py`).

Every recording starts with `# ` provenance lines echoed by the driver (date, OS/arch, pyscotch
version installed, Python, mpi4py, MPI, gcc); each user command is echoed with a `$ ` prompt
before it runs, and exit statuses are shown with `$ echo $?`.

## Deliverables

| file | what | wall | chunks / lines |
|---|---|---|---|
| `pyscotch-install.json` | fresh `uv venv`, `uv pip install "pyscotch[parallel]"` from PyPI, `uv pip show`, README quick taste | 1.4 s | 10 / 38 |
| `pyscotch-doctor.json` | `pyscotch doctor` right after the install (bundled wheel libs, exit 0), then `PYSCOTCH_PARALLEL=1 pyscotch doctor` (PT-Scotch missing, exit 1, prints the fix command) | 0.9 s | 8 / 63 |
| `pyscotch-build.json` | `pyscotch scotch list` (empty), `time pyscotch scotch build --parallel --use`, `PYSCOTCH_PARALLEL=1 pyscotch doctor`, `Dgraph` on 2 ranks under `mpirun`, `pyscotch scotch list` | 61.5 s (build itself: **1m00.3s**) | 19 / 91 |
| `pyscotch-doctor-parallel.json` | bonus: both doctors (sequential and `PYSCOTCH_PARALLEL=1`) after the build — shows the selected managed build wins in both modes | 0.9 s | 8 / 69 |
| this file | | | |

Lines are up to 164 columns wide (absolute library paths); the player wraps by default.

The `--command` in each JSON's `meta` is the user-facing command line; provenance keys
(`pyscotch`, `bundled_scotch`/`scotch_built`, `python`, `mpi4py`, `openmpi`, `gcc`, `machine`,
`os`, `build_wall`) render in the player header.

## Versions observed

| what | version | where from |
|---|---|---|
| pyscotch | **7.0.4** | PyPI wheel `py3-none-manylinux` (resolved by uv; `uv pip show pyscotch`) |
| Scotch bundled in the wheel | **7.0.13** (`scotch_version()`), 32- and 64-bit sequential libs in `pyscotch/_libs/lib32,lib64` | inside the wheel |
| Scotch built by the CLI | **7.0.13** = "latest known release" of pyscotch 7.0.4's catalog, tarball `scotch-v7.0.13.tar.gz` from gitlab.inria.fr, 8333 KiB, sha256 OK, **no quickfix needed** | `pyscotch scotch build --parallel --use` |
| Python | 3.14.6 (uv-managed CPython; system `python3` is 3.13.5, uv preferred its own) | `uv venv` |
| numpy | 2.5.3 | PyPI |
| mpi4py | 4.1.2 — came as a **binary wheel** (1.3 MiB), no compile against OpenMPI needed | PyPI (`[parallel]` extra) |
| OpenMPI | 5.0.7 (Debian package), `libmpi.so.40` | system |
| uv | 0.11.22 | `~/.local/bin/uv` |

## Exact commands, as recorded

Recording 1 (`rec1-install.sh`), from `/home/dev/workspace/builds/pyscotch-user`:

```
uv venv .venv
source .venv/bin/activate
uv pip install "pyscotch[parallel]"      # recorded with --no-progress (and NO_COLOR=1) so the spinner does not litter the transcript
uv pip show pyscotch
cat taste.py
python taste.py
```

Recordings 2–4 additionally do `export PYSCOTCH_HOME=$PWD/pyscotch-home` (shown in the
recording). Reason: the default store is `~/.local/share/pyscotch`, and a build selected there
takes precedence over the `scotch-builds/` development layout of the pyscotch checkout on this
machine (discovery order 3 before 5), which would silently change the dev environment. The
store was empty (`~/.local/share/pyscotch` did not exist) so the "fresh" doctor is genuine.

```
pyscotch doctor
PYSCOTCH_PARALLEL=1 pyscotch doctor
```

```
pyscotch scotch list
time pyscotch scotch build --parallel --use
PYSCOTCH_PARALLEL=1 pyscotch doctor
cat dgraph_demo.py
PYSCOTCH_PARALLEL=1 PYSCOTCH_INT_SIZE=64 mpirun -n 2 python dgraph_demo.py
pyscotch scotch list
```

Record/convert (from the deck repo root):

```
script -q --timing=rec/X.timing rec/X.out -c 'bash /home/dev/workspace/builds/pyscotch-user/recN-*.sh'
python3 record_to_json.py rec/X.out rec/X.timing -o resources/recordings/<name>.json --title ... --command ... --meta ...
```

## Timings

| step | wall |
|---|---|
| `uv venv .venv` | < 0.2 s |
| `uv pip install "pyscotch[parallel]"` (numpy 15.9 MiB + mpi4py 1.3 MiB + pyscotch downloaded; uv cache purged for these three beforehand) | ~1 s |
| `python taste.py` | ~0.4 s |
| `pyscotch doctor` | ~0.3 s each |
| `pyscotch scotch build --parallel --use` (preflight + download + extract + `make libscotch` + `make libptscotch` + compat shim + select) | **1m00.3s real, 50.4 s user, 8.4 s sys** (`time` builtin, in the recording). The CLI runs plain `make`, no `-j`. |
| `mpirun -n 2 python dgraph_demo.py` (8×8×8 grid, 4 parts) | ~0.4 s |

## What failed

Nothing. All four recordings exit 0 (the `PYSCOTCH_PARALLEL=1 pyscotch doctor` before the
build exits 1 **by design** — that is the diagnosis being demonstrated). No `--oversubscribe`
was needed (2 ranks on 8 cpus). No quickfix patch was applied (7.0.13 builds pristine;
7.0.12 is the catalog version that needs one).

## Surprising / worth knowing for the slides

- **No compiler output at all**: `pyscotch scotch build` captures `make` output
  (`subprocess.run(..., capture_output=True)` in `scotch_build.py::_run_make`) and only prints
  `make libscotch ...` / `make libptscotch ...`; the log is shown only on failure (last 25
  lines + a diagnosis). So the recording has no `tail`/`grep` filter — the whole build is ~18
  lines and a 60 s silence (capped at 1.5 s per chunk by the converter, so the replay does
  not stall; the `time` line carries the real duration).
- **Import banners on stderr**: every `import pyscotch` prints `✓ Loaded Scotch: 64-bit from
  ...` and `✓ Structure sizes: graph=120, strat=8, arch=96, dgraph=None|296` to stderr — under
  `mpirun -n 2` they appear twice. They are real UX, kept in the recordings.
- **Doctor tells you the fix**: with `PYSCOTCH_PARALLEL=1` on the wheel-only install the
  report says `Loaded NO`, names the missing file (`.../_libs/lib64/libptscotch.so`) and prints
  `→ pyscotch scotch build 7.0.13 --parallel --use  # builds Scotch for you, no root needed`
  plus the apt alternative (`sudo apt install libptscotch-dev`), exit status 1.
- **After `--use`, the managed build wins for sequential runs too**: the parallel build also
  ships `libscotch.so`, so a plain `pyscotch doctor` reports `Source user-built (pyscotch
  scotch use 7.0.13-64-par)` instead of `bundled wheel libraries` (see
  `pyscotch-doctor-parallel.json`). `pyscotch scotch list` says "loaded when its width/variant
  matches the run" — for 64-bit sequential it does match.
- **Version drift between the checkout and PyPI**: the repo HEAD (`1117f7f`, 2026-08-11,
  "7.0.4 missing docs api") *is* the 7.0.4 release; its Scotch submodule pin `9259939` =
  tag v7.0.13 — consistent with what the wheel bundles. The CLI's catalog in 7.0.4 knows
  7.0.10–7.0.13 (7.0.14 exists upstream since 2026-08-27 but is not catalogued, so `build`
  without a version picks 7.0.13).
- **uv picked Python 3.14.6**, its own managed interpreter, not the system 3.13.5 — the
  wheel is `py3-none`, so it does not matter, but the provenance line says so explicitly.
- `mpi4py` no longer needs a compiler: 4.1.2 ships manylinux wheels that dlopen the system
  `libmpi` (doctor shows `libmpi.so.40`, `Open MPI v5.0.7`).
- The Dgraph demo is the docs' snippet (`06_parallel_pyscotch.md`: `build_grid_3d(8, 8, 8)`,
  `part(4)`) plus a per-rank print: each rank holds 256 of the 512 vertices and gets exactly
  `[64 64 64 64]` local part sizes.

## Cleanup

Nothing outside `/home/dev/workspace/builds/pyscotch-user/` was written except uv's cache (`uv cache clean pyscotch numpy mpi4py`
was run once before the second install take, so the recording shows real downloads). To remove
the demo: `rm -rf /home/dev/workspace/builds/pyscotch-user`.

## Full plain-text output of each recording

### `pyscotch-install.json` (`rec/install-2.out`; `rec/install-1.out` is a first take with a misleading Python provenance line and warm uv cache)

```
# 2026-09-08 23:46 UTC  Linux 6.12.74+deb13+1-amd64 x86_64  Debian GNU/Linux 13 (trixie)  8 cpus
# uv 0.11.22 (picks Python 3.14.6; system python3 is 3.13.5)  pyscotch: not installed yet
# system Scotch: none (0 libscotch entries in ldconfig), no Scotch source checkout used
$ uv venv .venv
Using CPython 3.14.6
Creating virtual environment at: .venv
Activate with: source .venv/bin/activate
$ source .venv/bin/activate
$ uv pip install "pyscotch[parallel]"        # [parallel] = + mpi4py, for PT-Scotch later
Resolved 3 packages in 197ms
Downloading numpy (15.9MiB)
Downloading mpi4py (1.3MiB)
 Downloaded mpi4py
 Downloaded numpy
Prepared 3 packages in 503ms
Installed 3 packages in 28ms
 + mpi4py==4.1.2
 + numpy==2.5.3
 + pyscotch==7.0.4
$ uv pip show pyscotch
Name: pyscotch
Version: 7.0.4
Location: /home/dev/workspace/builds/pyscotch-user/.venv/lib/python3.14/site-packages
Requires: numpy
Required-by:
$ cat taste.py                              # the README "Quick Taste"
from pyscotch import Graph, scotch_version

graph = Graph.from_edges([(0, 1), (1, 2), (2, 3), (3, 0)])
parts = graph.partition(2)          # numpy array of part indices
permtab, peritab = graph.order()    # nested-dissection ordering
print("Scotch", ".".join(map(str, scotch_version())), "| parts:", parts, "| permtab:", permtab)
$ python taste.py
✓ Loaded Scotch: 64-bit from /home/dev/workspace/builds/pyscotch-user/.venv/lib/python3.14/site-packages/pyscotch/_libs/lib64/libscotch.so
✓ Structure sizes: graph=120, strat=8, arch=96, dgraph=None
Scotch 7.0.13 | parts: [0 1 1 0] | permtab: [0 1 2 3]
$ echo $?
0
```

### `pyscotch-doctor.json` (`rec/doctor-1.out`)

```
# 2026-09-08 23:47 UTC  Linux 6.12.74+deb13+1-amd64 x86_64  Debian GNU/Linux 13 (trixie)  8 cpus, Intel(R) Xeon(R) D-2123IT CPU @ 2.20GHz
# pyscotch 7.0.4 from PyPI in .venv (Python 3.14.6), mpi4py 4.1.2, mpirun (Open MPI) 5.0.7, gcc 14.2.0
# no Scotch built or installed on this machine yet: only the wheel's bundled libraries
$ export PYSCOTCH_HOME=$PWD/pyscotch-home   # isolated build store for the demo (default: ~/.local/share/pyscotch)
$ pyscotch doctor
✓ Loaded Scotch: 64-bit from /home/dev/workspace/builds/pyscotch-user/.venv/lib/python3.14/site-packages/pyscotch/_libs/lib64/libscotch.so
✓ Structure sizes: graph=120, strat=8, arch=96, dgraph=None
PyScotch environment report
========================================
  PyScotch version       7.0.4
  Python                 3.14.6
  Platform               Linux-6.12.74+deb13+1-amd64-x86_64-with-glibc2.41

Requested (env):
  PYSCOTCH_INT_SIZE      64
  PYSCOTCH_PARALLEL      0

Scotch backend:
  Loaded                 yes
  Version                7.0.13
  Source                 bundled wheel libraries
  Library dir            /home/dev/workspace/builds/pyscotch-user/.venv/lib/python3.14/site-packages/pyscotch/_libs/lib64
  Integer width          64-bit
  Symbol suffix          _64
  Parallel (PT-Scotch)   no
  Context (>=7.0.5)      yes
  Error capture          active

MPI:
  libmpi                 libmpi.so.40
  mpi4py                 4.1.2
  MPI library            Open MPI v5.0.7, package: Debian OpenMPI, ident: 5.0.7, repo rev: v5.0.7, Feb 14, 2025 

No problems detected. ✓
$ echo $?
0
$ PYSCOTCH_PARALLEL=1 pyscotch doctor        # now ask for PT-Scotch (Dgraph, MPI)
✓ Loaded Scotch: 64-bit from /home/dev/workspace/builds/pyscotch-user/.venv/lib/python3.14/site-packages/pyscotch/_libs/lib64/libscotch.so
PyScotch environment report
========================================
  PyScotch version       7.0.4
  Python                 3.14.6
  Platform               Linux-6.12.74+deb13+1-amd64-x86_64-with-glibc2.41

Requested (env):
  PYSCOTCH_INT_SIZE      64
  PYSCOTCH_PARALLEL      1

Scotch backend:
  Loaded                 NO
  Error                  Parallel library not found: /home/dev/workspace/builds/pyscotch-user/.venv/lib/python3.14/site-packages/pyscotch/_libs/lib64/libptscotch.so

MPI:
  libmpi                 libmpi.so.40
  mpi4py                 4.1.2
  MPI library            Open MPI v5.0.7, package: Debian OpenMPI, ident: 5.0.7, repo rev: v5.0.7, Feb 14, 2025 

Problems (1):
  ✗ Scotch failed to load
      → pyscotch scotch build 7.0.13 --parallel --use     # builds Scotch for you, no root needed
        or use a system Scotch:  sudo apt install libptscotch-dev
$ echo $?
1
```

### `pyscotch-build.json` (`rec/build-1.out`)

```
# 2026-09-08 23:47 UTC  Linux 6.12.74+deb13+1-amd64 x86_64  Debian GNU/Linux 13 (trixie)  8 cpus, Intel(R) Xeon(R) D-2123IT CPU @ 2.20GHz
# pyscotch 7.0.4 from PyPI in .venv (Python 3.14.6), mpi4py 4.1.2, mpirun (Open MPI) 5.0.7, gcc 14.2.0
# toolchain: flex 2.6.4, bison 3.8.2, zlib headers, GNU patch, mpicc -> gcc (Debian 14.2.0-19) 14.2.0
$ export PYSCOTCH_HOME=$PWD/pyscotch-home   # isolated build store for the demo (default: ~/.local/share/pyscotch)
$ pyscotch scotch list
No locally built Scotch. Build one with `pyscotch scotch build`.
$ time pyscotch scotch build --parallel --use    # compiler output is kept in a log by the CLI, not printed
No version given — using the latest known release: 7.0.13
Preflight for 7.0.13-64-par:
  ✓ C compiler             /usr/bin/gcc
  ✓ make                   /usr/bin/make
  ✓ flex >= 2.6.4          2.6.4
  ✓ bison                  /usr/bin/bison
  ✓ zlib headers           zlib.h compilable
  ✓ mpicc (for PT-Scotch)  /usr/bin/mpicc
  Downloading https://gitlab.inria.fr/scotch/scotch/-/archive/v7.0.13/scotch-v7.0.13.tar.gz
  Saved 8333 KiB, sha256 OK
  Extracting source
Building Scotch 7.0.13 (64-bit, parallel)
  make libscotch ...
  make libptscotch ...

✓ Built 7.0.13-64-par  ->  /home/dev/workspace/builds/pyscotch-user/pyscotch-home/builds/7.0.13-64-par/lib64
Set 7.0.13-64-par as the default (PyScotch will now load it).

real	1m0.328s
user	0m50.406s
sys	0m8.424s
$ echo $?
0
$ PYSCOTCH_PARALLEL=1 pyscotch doctor
✓ Loaded Scotch: 64-bit from /home/dev/workspace/builds/pyscotch-user/pyscotch-home/builds/7.0.13-64-par/lib64/libscotch.so
✓ Loaded PT-Scotch: 64-bit from /home/dev/workspace/builds/pyscotch-user/pyscotch-home/builds/7.0.13-64-par/lib64/libptscotch.so
✓ Structure sizes: graph=120, strat=8, arch=96, dgraph=296
PyScotch environment report
========================================
  PyScotch version       7.0.4
  Python                 3.14.6
  Platform               Linux-6.12.74+deb13+1-amd64-x86_64-with-glibc2.41

Requested (env):
  PYSCOTCH_INT_SIZE      64
  PYSCOTCH_PARALLEL      1

Scotch backend:
  Loaded                 yes
  Version                7.0.13
  Source                 user-built (pyscotch scotch use 7.0.13-64-par)
  Library dir            /home/dev/workspace/builds/pyscotch-user/pyscotch-home/builds/7.0.13-64-par/lib64
  Integer width          64-bit
  Symbol suffix          _64
  Parallel (PT-Scotch)   yes
  Context (>=7.0.5)      yes
  Error capture          active

MPI:
  libmpi                 libmpi.so.40
  mpi4py                 4.1.2
  MPI library            Open MPI v5.0.7, package: Debian OpenMPI, ident: 5.0.7, repo rev: v5.0.7, Feb 14, 2025 

No problems detected. ✓
$ echo $?
0
$ cat dgraph_demo.py                          # from the "Parallel PyScotch" tutorial
from mpi4py import MPI               # runs MPI_Init on import
from pyscotch import Dgraph, scotch_version
import numpy as np

comm = MPI.COMM_WORLD
dg = Dgraph(comm=comm)
dg.build_grid_3d(8, 8, 8)             # 512-vertex 3D grid, each rank holds a slice
part = dg.part(4)                     # local part assignments on this rank
dg.exit()
print(f"rank {comm.Get_rank()}/{comm.Get_size()}: Scotch {scotch_version()}, "
      f"{part.size} local vertices, part sizes {np.bincount(part, minlength=4)}", flush=True)
$ PYSCOTCH_PARALLEL=1 PYSCOTCH_INT_SIZE=64 mpirun -n 2 python dgraph_demo.py
✓ Loaded Scotch: 64-bit from /home/dev/workspace/builds/pyscotch-user/pyscotch-home/builds/7.0.13-64-par/lib64/libscotch.so
✓ Loaded PT-Scotch: 64-bit from /home/dev/workspace/builds/pyscotch-user/pyscotch-home/builds/7.0.13-64-par/lib64/libptscotch.so
✓ Structure sizes: graph=120, strat=8, arch=96, dgraph=296
✓ Loaded Scotch: 64-bit from /home/dev/workspace/builds/pyscotch-user/pyscotch-home/builds/7.0.13-64-par/lib64/libscotch.so
✓ Loaded PT-Scotch: 64-bit from /home/dev/workspace/builds/pyscotch-user/pyscotch-home/builds/7.0.13-64-par/lib64/libptscotch.so
✓ Structure sizes: graph=120, strat=8, arch=96, dgraph=296
rank 1/2: Scotch (7, 0, 13), 256 local vertices, part sizes [64 64 64 64]
rank 0/2: Scotch (7, 0, 13), 256 local vertices, part sizes [64 64 64 64]
$ echo $?
0
$ pyscotch scotch list
Locally built Scotch libraries:
 * 7.0.13-64-par        64-bit parallel   /home/dev/workspace/builds/pyscotch-user/pyscotch-home/builds/7.0.13-64-par/lib64

* = default (loaded when its width/variant matches the run).
```

### `pyscotch-doctor-parallel.json` (`rec/doctor-after-1.out`)

```
# 2026-09-08 23:49 UTC  Linux 6.12.74+deb13+1-amd64 x86_64  Debian GNU/Linux 13 (trixie)  8 cpus, Intel(R) Xeon(R) D-2123IT CPU @ 2.20GHz
# pyscotch 7.0.4 from PyPI in .venv (Python 3.14.6), mpi4py 4.1.2, mpirun (Open MPI) 5.0.7, gcc 14.2.0
# after: pyscotch scotch build --parallel --use  (managed build 7.0.13-64-par selected in the store)
$ export PYSCOTCH_HOME=$PWD/pyscotch-home   # same isolated build store as before
$ pyscotch doctor                             # sequential run: which Scotch loads now?
✓ Loaded Scotch: 64-bit from /home/dev/workspace/builds/pyscotch-user/pyscotch-home/builds/7.0.13-64-par/lib64/libscotch.so
✓ Structure sizes: graph=120, strat=8, arch=96, dgraph=None
PyScotch environment report
========================================
  PyScotch version       7.0.4
  Python                 3.14.6
  Platform               Linux-6.12.74+deb13+1-amd64-x86_64-with-glibc2.41

Requested (env):
  PYSCOTCH_INT_SIZE      64
  PYSCOTCH_PARALLEL      0

Scotch backend:
  Loaded                 yes
  Version                7.0.13
  Source                 user-built (pyscotch scotch use 7.0.13-64-par)
  Library dir            /home/dev/workspace/builds/pyscotch-user/pyscotch-home/builds/7.0.13-64-par/lib64
  Integer width          64-bit
  Symbol suffix          _64
  Parallel (PT-Scotch)   no
  Context (>=7.0.5)      yes
  Error capture          active

MPI:
  libmpi                 libmpi.so.40
  mpi4py                 4.1.2
  MPI library            Open MPI v5.0.7, package: Debian OpenMPI, ident: 5.0.7, repo rev: v5.0.7, Feb 14, 2025 

No problems detected. ✓
$ echo $?
0
$ PYSCOTCH_PARALLEL=1 pyscotch doctor        # parallel run
✓ Loaded Scotch: 64-bit from /home/dev/workspace/builds/pyscotch-user/pyscotch-home/builds/7.0.13-64-par/lib64/libscotch.so
✓ Loaded PT-Scotch: 64-bit from /home/dev/workspace/builds/pyscotch-user/pyscotch-home/builds/7.0.13-64-par/lib64/libptscotch.so
✓ Structure sizes: graph=120, strat=8, arch=96, dgraph=296
PyScotch environment report
========================================
  PyScotch version       7.0.4
  Python                 3.14.6
  Platform               Linux-6.12.74+deb13+1-amd64-x86_64-with-glibc2.41

Requested (env):
  PYSCOTCH_INT_SIZE      64
  PYSCOTCH_PARALLEL      1

Scotch backend:
  Loaded                 yes
  Version                7.0.13
  Source                 user-built (pyscotch scotch use 7.0.13-64-par)
  Library dir            /home/dev/workspace/builds/pyscotch-user/pyscotch-home/builds/7.0.13-64-par/lib64
  Integer width          64-bit
  Symbol suffix          _64
  Parallel (PT-Scotch)   yes
  Context (>=7.0.5)      yes
  Error capture          active

MPI:
  libmpi                 libmpi.so.40
  mpi4py                 4.1.2
  MPI library            Open MPI v5.0.7, package: Debian OpenMPI, ident: 5.0.7, repo rev: v5.0.7, Feb 14, 2025 

No problems detected. ✓
$ echo $?
0
```
