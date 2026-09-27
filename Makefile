# Entry point. Every target is a bun one-liner (see package.json "scripts").
.PHONY: help install browsers build check test test-unit test-e2e test-update screenshots verify

help:
	@echo "  make install     - bun install (playwright, dev-only)"
	@echo "  make browsers    - download the Chromium the e2e tests run in (once)"
	@echo "  make build       - assemble slides/ from src/ (src/presentations + src/slides)"
	@echo "  make check       - fail if slides/ is not exactly what src/ builds"
	@echo "  make test        - unit tests of the builder + e2e tests of every built deck"
	@echo "  make test-update - accept the e2e structure goldens (tests/e2e/golden/)"
	@echo "  make screenshots - e2e run that also dumps one PNG per slide (tests/e2e/screenshots/)"
	@echo "  make verify      - what CI runs: check + test"

install:
	bun install --frozen-lockfile

browsers:
	bun run browsers

build:
	bun run build

check:
	bun run check

test-unit:
	bun run test:unit

test-e2e:
	bun run test:e2e

test: test-unit test-e2e

test-update:
	bun run test:update

screenshots:
	bun run test:screenshots

verify: check test
