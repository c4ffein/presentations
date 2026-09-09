# pyscotch CI pipeline — factual summary for a diagram

Source: `/home/dev/workspace/pyscotch/.github/workflows/*.yml` and `Makefile` at commit
`1117f7f` (2026-08-11, "7.0.4 missing docs api" = the 7.0.4 release; Scotch submodule pin
`9259939` = tag **v7.0.13**). Job names are quoted exactly as in the yml (`jobs.<id>` and, when
set, `name:`). None of the workflows states a duration or `timeout-minutes`; the only timeout
in the tree is the 600 s per stage in `scripts/golden_walkthrough.py`. Rough durations below
are therefore *my* estimates, marked "est.", derived from what the job compiles (a full
Scotch build through plain `make` took 1m00s on this 8-cpu box, see `pyscotch-user.md`;
GitHub runners are 2–4 cpus).

## Workflows (8 files)

| workflow (`name:`) | file | trigger | jobs (exact ids / names) | matrix | Scotch version(s) exercised | what it verifies | duration |
|---|---|---|---|---|---|---|---|
| **Test PyScotch** | `test.yml` | push `main`, `develop`; PR to `main` | `test` | `python-version: ['3.9', '3.10', '3.11', '3.12']`, `fail-fast: false` (4 jobs) | submodule pin (v7.0.13), built via `make build-all` = 32 & 64-bit × sequential & parallel | apt toolchain + OpenMPI; `make build-all`; asserts the 4 `.so` (`lib32/libscotch.so`, `lib32/libptscotch.so`, `lib64/...`) + 2 `libpyscotch_compat.so`; `pip install -e .` with pytest/hypothesis/mpi4py; import smoke (32-seq, 64-par); **`make test-quadrant`** (all 4 variants, hypothesis included, `PYSCOTCH_MPI_OVERSUBSCRIBE=1`); **`make build-reference-tools`** then asserts `gpart gord gmap dgpart dgord` + `libptscotch.so` exist; **`make test-differential`** (byte-compare vs upstream tools); codecov upload on 3.12 only | not stated (est. tens of minutes per job: 4 Scotch variants + 4 full test runs + reference tools) |
| **Build Scotch from CLI (end-to-end)** | `scotch-build.yml` | cron `30 6 * * 1` (Mondays 06:30 UTC, "upstream-tarball drift watchdog"); push `main` and PR on paths `pyscotch/scotch_build.py`, `pyscotch/_store.py`, `pyscotch/libscotch.py`, `pyscotch/native/**`, `pyscotch/_patches/**`, the yml; `workflow_dispatch` | `build-scotch`, name `"Scotch ${{ matrix.scotch }} (quickfix: ${{ matrix.quickfix }})"` | `include:` **7.0.13** (quickfix `no`), **7.0.12** (quickfix `yes`, `symbol: SCOTCH_meshBuildElem_64`, `pristine_grep: SCOTCH_meshBuildElem`), **7.0.11** (quickfix `no`); `fail-fast: false` (3 jobs); Python 3.12; 64-bit ints only | 7.0.13, 7.0.12, 7.0.11 from the gitlab.inria.fr tarballs (sha256 pinned in `scotch_build.py`) | REPO-side: no submodule, `rm -rf pyscotch/_libs`, `pip install .` like a user, isolated `PYSCOTCH_HOME`; `pyscotch doctor` on the empty env; quickfix catalog lists the version (`pyscotch scotch patches`); `scotch build <v> --sequential --use` and asserts "Applied quickfix" present/absent per matrix; `scotch list` + `doctor`; `nm -D` proves the patched symbol is exported (7.0.12); load + `partition(2)` + `scotch_version()` assert through the managed seq build; `scotch build <v> --parallel --use` + `dgraph_smoke.py` (6×6×6 grid, `part(3)`) under `mpirun --oversubscribe -n 2`; `scotch use <v>-64-seq` switches the loaded lib, `scotch rm`; `--pristine --force` 7.0.12 must FAIL and name `SCOTCH_meshBuildElem` | not stated (est. ~5–10 min per job: two full Scotch builds each) |
| **Verify published PyPI release** | `pypi-verify.yml` | `workflow_dispatch` only, input `version` (empty = latest); "run manually after a release lands on PyPI" | `wheel-smoke`, name `"Bundled wheel libraries — API + CLI smoke"`; `scotch-matrix`, name `"Scotch ${{ matrix.scotch }} from tarball (quickfix: ${{ matrix.quickfix }})"` | `scotch-matrix`: `include:` **7.0.13** (quickfix `no`), **7.0.12** (quickfix `yes`); `fail-fast: false`; Python 3.12 | wheel: bundled 7.0.13; matrix: 7.0.13, 7.0.12 tarballs | PYPI-side twin of `scotch-build.yml`, "no repo checkout anywhere": `pip install pyscotch` (or `==version`); `wheel-smoke` asserts the lib dir contains `_libs`, builds a 6-vertex ring, `partition(2)`, `order()`, `save`, then `pyscotch doctor` and `pyscotch partition smoke.grf -n 2 -o smoke.map`; `scotch-matrix` installs `pyscotch numpy mpi4py`, `scotch build <v> --parallel --use` with the quickfix assertion + `[quickfix]` tag in `scotch list`, `scotch_version()` assert, `doctor`, `dgraph_smoke.py` under `mpirun --oversubscribe -n 2` | not stated (est. 1–2 min for `wheel-smoke`; ~5 min per matrix job) |
| **Golden master (sdist user journey)** | `golden-master.yml` | push `main` and PR on paths `pyscotch/**`, `setup.py`, `scripts/golden_walkthrough.py`, `tests/golden/**`, `examples/hello_pyscotch.py`, the yml; `workflow_dispatch` | `golden` | none; Python 3.12 | the CLI's latest catalog version, built sequential AND parallel from the tarball (no submodule) | builds the sdist (`python -m build --sdist`), runs `scripts/golden_walkthrough.py`: clean venv, no Scotch, 14 stages compared **byte-for-byte** to `tests/golden/` — `01-doctor-empty`, `02-partition-no-scotch`, `03-build-seq`, `04-doctor-seq`, `05-partition-ok`, `06-order-ok`, `07-python-api`, `08-import-ptscotch-missing`, `09-doctor-parallel-missing`, `10-build-par`, `11-scotch-list`, `12-hello-mpirun`, `13-dgraph-no-mpi-init`, `14-doctor-parallel-ok`, plus `ring.part.golden` / `ring.ord.golden` result files; exit codes and error texts are first-class outputs; drifted outputs uploaded as artifact `golden-actual-outputs` on failure | not stated (each stage ≤ 600 s; est. ~5 min total) |
| **Verify install methods** | `verify-packages.yml` | push tags `v*`; `workflow_dispatch`; cron `0 6 * * 1` (Mondays 06:00 UTC) | `build`, name `"Build wheel + sdist"`; `verify`, name `"${{ matrix.method }}"` (`needs: build`) | `verify`: `method: [pip-wheel, uv-wheel, pip-sdist-system, conda-scotch-sdist]`, `fail-fast: false` (4 jobs); Python 3.12 | wheel: submodule pin (v7.0.13) via `scripts/build_wheel_libs.sh`; `pip-sdist-system`: Debian `libscotch-dev` (32-bit ints, `PYSCOTCH_SYSTEM=1 PYSCOTCH_INT_SIZE=32`); `conda-scotch-sdist`: conda-forge `scotch` (64-bit) via micromamba | stamps the version from the tag; builds wheel (with `_libs`) and sdist (pure); each method installs into a clean venv/conda env and runs `scripts/install_smoke_test.py` from **outside** the repo (`PYSCOTCH_PARALLEL=0`) — proves every documented install path, incl. unsuffixed-symbol/width-check logic against distro and conda Scotch | not stated (est. a few min each) |
| **Build wheels** | `wheels.yml` | push tags `v*`; `workflow_dispatch` | `build_wheels`, name `"Build wheel (${{ matrix.arch }})"`; `test_wheels`, name `"Test wheel (${{ matrix.arch }})"` (`needs: build_wheels`); `build_sdist`, name `"Build sdist"`; `publish`, name `"Publish to PyPI"` (`needs: [test_wheels, build_sdist]`, `if: startsWith(github.ref, 'refs/tags/v')`, environment `pypi`) | `arch: x86_64` on `ubuntu-latest`, `arch: aarch64` on `ubuntu-24.04-arm` (for both build and test jobs), `fail-fast: false` | submodule pin (v7.0.13), **sequential only**, 32 + 64-bit suffixed libs (`CIBW_BEFORE_ALL: scripts/build_wheel_libs.sh`) | `pypa/cibuildwheel@v2.23.3`, `CIBW_BUILD: cp312-manylinux_<arch>`, `manylinux_2_28`, wheel tagged `py3-none-<platform>` (ctypes only); `CIBW_TEST_COMMAND` = `scripts/wheel_smoke_test.py` at `PYSCOTCH_INT_SIZE=32` and `64` (`PARALLEL=0`); `test_wheels` re-installs the wheel in a clean venv outside the checkout and re-runs the smoke at both widths; `build_sdist` checks the tarball contains no `external/`, `scotch-builds/`, `_libs/`, `.so`, `.a`; `publish` uploads via PyPI Trusted Publishing (OIDC, `pypa/gh-action-pypi-publish@release/v1`) | not stated (est. ~10 min: sequential build in the manylinux container per arch; aarch64 native runner) |
| **Verify docs API data** | `docs-verify.yml` | push `main` and PR on paths `pyscotch/**`, `docs/site/gen_api.py`, `docs/site/api_data.json` (+ the yml on push); `workflow_dispatch` | `verify` | none; **Python 3.14** (annotation stringification) | submodule pin (v7.0.13), `make build-64` = 64-bit sequential + parallel | regenerates `docs/site/api_data.json` with `python docs/site/gen_api.py --dump` under `PYSCOTCH_INT_SIZE=64 PYSCOTCH_PARALLEL=1` and fails on `git diff --exit-code` — the committed API catalog (incl. Dgraph binding coverage and embedded Scotch version) must not be stale; never deploys | not stated (est. ~3 min: one 64-bit seq+par build) |
| **Deploy docs to GitHub Pages** | `docs.yml` | push `main` on paths `docs/site/**`, the yml; `workflow_dispatch`; `concurrency: group: pages` | `build`; `deploy` (`needs: build`, environment `github-pages`) | none; Python 3.12 | none — no Scotch build, no submodule | `pip install markdown jinja2 pygments`, `python docs/site/build.py`, `upload-pages-artifact` of `docs/out`, `deploy-pages@v4` | not stated (est. ~1 min) |

### Relationships worth drawing

- Pre-release vs post-release twins (stated in the yml comments): `scotch-build.yml` (installs
  pyscotch **from the checkout**, gates the code) ↔ `pypi-verify.yml` (installs **from PyPI**,
  certifies the published package); `verify-packages.yml` gates the artifacts built **from the
  tag** around publication.
- Release path on a `v*` tag: `wheels.yml` (`build_wheels` ×2 arch → `test_wheels` ×2, plus
  `build_sdist`) → `publish`; `verify-packages.yml` runs on the same tag independently.
- Weekly drift watchdogs: `scotch-build.yml` (Mon 06:30 UTC, upstream tarball regenerated/moved
  → checksum pins) and `verify-packages.yml` (Mon 06:00 UTC, new distro/conda Scotch).
- Catalog consistency: the matrices of `scotch-build.yml` and `pypi-verify.yml` must stay in
  sync with `_KNOWN_VERSIONS`/`_PATCHES` in `pyscotch/scotch_build.py` (catalog in 7.0.4:
  7.0.10, 7.0.11, 7.0.12, 7.0.13; quickfix only for 7.0.12: `scotch-7.0.12-rename-all-fix.patch`).
- Docs: `docs-verify.yml` guards the committed `api_data.json`; `docs.yml` renders from it
  without building Scotch.

### Certification matrix, condensed

| dimension | values |
|---|---|
| int size | 32 and 64 (`test.yml` quadrant, wheels smoke); 64 only for the CLI-build workflows and docs |
| sequential / parallel | both in `test.yml`, `scotch-build.yml`, `pypi-verify.yml` (matrix jobs), `golden-master.yml`, `docs-verify.yml`; sequential only in wheels, `verify-packages.yml`, `wheel-smoke` |
| Scotch source | git submodule pin v7.0.13 (`test`, `wheels`, `verify-packages`, `docs-verify`); upstream tarballs 7.0.13 / 7.0.12 / 7.0.11 (`scotch-build`), 7.0.13 / 7.0.12 (`pypi-verify`), catalog latest (`golden-master`); Debian `libscotch-dev` and conda-forge `scotch` (`verify-packages`) |
| Python | 3.9–3.12 (`test`); 3.12 everywhere else; 3.14 for `docs-verify` |
| arch | x86_64 everywhere; + aarch64 for wheels (`ubuntu-24.04-arm`) |
| oracle | upstream `gpart`/`gord`/`gmap`/`dgpart`/`dgord` byte-identity (`make test-differential` in `test.yml`); golden files in `tests/golden/` (`golden-master.yml`) |

## Makefile targets — the developer loop

From `/home/dev/workspace/pyscotch/Makefile` (there is no `verify` target; the README's dev loop is
`make build-all` → `uv pip install -e ".[dev]"` → `make test` / `test-full` / `test-quadrant`,
and CI wires `build-reference-tools` + `test-differential` and `docs-api`). Note: `CONTRIBUTING.md`
still refers to `make build-scotch`, `make build-ptscotch`, `make all` — only `all` exists
(alias of `build-all`); the other two are stale names.

| target | what it does |
|---|---|
| `help` | prints the target list |
| `all` = `build-all` | `build-32` + `build-64`: all 4 variants into `scotch-builds/{lib32,lib64,inc32,inc64}` |
| `build-32` / `build-64` | `check-submodule`, `make realclean`, then `make scotch` and `make ptscotch` in the patched copy with `-DSCOTCH_NAME_SUFFIX=_32|_64 -DSCOTCH_RENAME_ALL` (`-DINTSIZE64` for 64), compile `libpyscotch_compat.so` from `pyscotch/native/file_compat.c`, copy `lib*scotch*.so/.a` + headers. **Failures of the Scotch makes are swallowed** (`|| true`) |
| `build-seq-only` = `build-seq-32` + `build-seq-64` | sequential-only `libscotch` (no MPI), failures NOT swallowed — what the wheels use (`scripts/build_wheel_libs.sh`) |
| `build-reference-tools` | builds upstream's `gpart gord gmap` (`make scotch`) and `dgpart dgord` (`make ptscotch`, lenient) with stock unsuffixed flags into `scotch-builds/bin/` as differential oracles |
| `check-submodule` | `git submodule update --init --recursive` if missing, then `python -m pyscotch.cli scotch prepare --source external/scotch --dest build/scotch-src` (disposable quickfix-patched copy; the submodule is never built in place), default `Makefile.inc` from `patches/Makefile.inc.default` |
| `install` | `pip install -e .` |
| `test` | `PYSCOTCH_INT_SIZE=64 PYSCOTCH_PARALLEL=1 pytest tests/ -v --ignore=tests/hypothesis/` |
| `test-full` | same, hypothesis included |
| `test-quadrant` | `pytest tests/ -v` × {32,64} × {seq,par}, hypothesis included (what `test.yml` runs) |
| `test-differential` | `PYSCOTCH_INT_SIZE=32 PYSCOTCH_PARALLEL=0 SCOTCH_PTHREAD_NUMBER=1 SCOTCH_DETERMINISTIC=1` + `PYSCOTCH_GPART/GORD/GMAP/DGPART/DGORD` + `PYSCOTCH_PAR_LIB_DIR=scotch-builds/lib32` + `PYSCOTCH_MPI_OVERSUBSCRIBE=1`, runs `tests/pyscotch_base/test_differential.py` and `tests/scotch_ports_mpi/test_differential_parallel.py` (byte-identity with the reference tools; tests skip, never silently pass, when a binary is missing) |
| `docs-api` | `build-64`, then `PYSCOTCH_INT_SIZE=64 PYSCOTCH_PARALLEL=1 PYSCOTCH_LIB_DIR=scotch-builds/lib64 $(DOCS_PYTHON) docs/site/gen_api.py --dump` — regenerates the committed `docs/site/api_data.json` exactly like `docs-verify.yml` (needs Python ≥ 3.14, the uv `.venv`) |
| `clean` | Python build artifacts |
| `clean-scotch` | `build/scotch-src` + `scotch-builds/` (submodule untouched) |
| `distclean` | `clean` + `clean-scotch` |

Test tiers the targets run (from the README): `tests/scotch_ports/`, `tests/scotch_ports_mpi/`
(ports of Scotch's C tests, MPI ones via mpirun), `tests/pyscotch_base/`, `tests/hypothesis/`,
`tests/pyscotch_integration/`, `tests/golden/` + `scripts/golden_walkthrough.py`,
`docs/site/examples/` (every doc example runs as a test).
