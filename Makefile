# Entry point. The tooling lives in src/ (build.js, package.json, tests/): every
# target is a bun one-liner run there (see src/package.json "scripts").
.PHONY: help install browsers browsers-deps build check test test-unit test-e2e test-update screenshots site test-live verify

help:
	@echo "  make install       - bun install (playwright, dev-only)"
	@echo "  make browsers      - download the Chromium the e2e tests run in (once)"
	@echo "  make browsers-deps - only the OS packages Chromium needs (CI, when the download is cached)"
	@echo "  make build         - assemble slides/ from src/ (src/presentations + src/slides)"
	@echo "  make check         - fail if slides/ is not exactly what src/ builds"
	@echo "  make test          - unit tests of the builder + e2e tests of every built deck"
	@echo "  make test-update   - accept the e2e structure goldens (src/tests/e2e/golden/)"
	@echo "  make screenshots   - e2e run that also dumps one PNG per slide (src/tests/e2e/screenshots/)"
	@echo "  make verify        - what CI runs: check + test"
	@echo "  make site          - copy the site (SITE in src/build.js, what Pages publishes) to _site/"
	@echo "  make test-live     - the deck e2e tests against a deployed site: E2E_BASE=https://host/path/ make test-live"

install:
	cd src && bun install --frozen-lockfile

browsers:
	cd src && bun run browsers

browsers-deps:
	cd src && bun run browsers:deps

build:
	cd src && bun run build

check:
	cd src && bun run check

test-unit:
	cd src && bun run test:unit

test-e2e:
	cd src && bun run test:e2e

test: test-unit test-e2e

test-update:
	cd src && bun run test:update

screenshots:
	cd src && bun run test:screenshots

site:
	cd src && bun run site

# E2E_BASE=https://c4ffein.github.io/presentations/ make test-live
test-live:
	@test -n "$(E2E_BASE)" || { echo "usage: E2E_BASE=https://host/path/ make test-live"; exit 2; }
	cd src && E2E_BASE="$(E2E_BASE)" bun run test:live

verify: check test
