#!/usr/bin/env python3
"""Export a Claude Code session transcript (.jsonl) to a shareable, PII-scrubbed JSON.

Claude Code stores each session as line-delimited JSON under
  ~/.claude/projects/<encoded-project-path>/<session-id>.jsonl
This tool keeps only the human-readable conversation — your typed prompts and
Claude's replies — drops the bookkeeping/tool-output noise, and scrubs obvious
PII (emails, home paths, API keys, session URLs). It does NOT polish: your
typos, "wdyt", and rough phrasing are preserved on purpose.

    python3 export_transcript.py INPUT.jsonl -o transcripts/making-of.json \
        --title "Claude on Scotch — making of"

Options:
  -o/--output PATH        where to write (default: transcripts/transcript.json)
  --title TEXT            title stored in the JSON meta
  --include-thinking      also export Claude's visible reasoning (off by default)
  --tools / --no-tools    include compact tool-call markers (default: on)

REVIEW THE OUTPUT before publishing — the scrubber is best-effort, not a
guarantee. Add project-specific patterns to REDACTIONS below as needed.
The input is read-only; if the session is still live the export is a snapshot
up to now, so re-run once the session ends for the complete transcript.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

# (pattern, replacement) — applied to every exported string. Extend freely.
REDACTIONS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"), "[email]"),
    (re.compile(r"https://claude\.ai/code/session_[A-Za-z0-9]+"), "[session-url]"),
    (re.compile(r"sk-ant-[A-Za-z0-9_-]{10,}"), "[api-key]"),
    (re.compile(r"\bhf_[A-Za-z0-9]{10,}"), "[api-key]"),
    (re.compile(r"\bsk-[A-Za-z0-9]{20,}"), "[api-key]"),
    (re.compile(r"/tmp/claude-[A-Za-z0-9/_-]+"), "[scratch]"),
    (re.compile(r"/home/[^/\s]+"), "~"),
]

# Strip these harness-injected wrappers out of user messages entirely.
WRAPPER_RE = re.compile(
    r"<system-reminder>.*?</system-reminder>"
    r"|<command-[a-z-]+>.*?</command-[a-z-]+>"
    r"|<local-command-stdout>.*?</local-command-stdout>",
    re.DOTALL,
)

_redaction_count = 0


def scrub(text: str) -> str:
    global _redaction_count
    if not text:
        return text
    for pat, repl in REDACTIONS:
        text, n = pat.subn(repl, text)
        _redaction_count += n
    return text


def clean_user_text(raw: str) -> str:
    text = WRAPPER_RE.sub("", raw).strip()
    if not text:
        return ""
    # Drop harness-generated background/system events that arrive as user role.
    if "[SYSTEM NOTIFICATION - NOT USER INPUT]" in text:
        return ""
    if text.startswith("<") and text.endswith(">"):
        return ""
    return text


def tool_target(inp: object) -> str:
    """Pick one short, representative argument to label a tool call."""
    if not isinstance(inp, dict):
        return ""
    for key in ("file_path", "path", "notebook_path", "url", "pattern"):
        val = inp.get(key)
        if val:
            return shorten(str(val))
    for key in ("command", "query", "prompt", "description"):
        val = inp.get(key)
        if val:
            return shorten(" ".join(str(val).split()), 70)
    return ""


def shorten(text: str, limit: int = 90) -> str:
    text = text.strip()
    return text if len(text) <= limit else text[: limit - 1] + "…"


def load_lines(path: Path):
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                try:
                    yield json.loads(line)
                except json.JSONDecodeError:
                    continue


def build_turns(entries, include_thinking: bool, include_tools: bool):
    turns: list[dict] = []
    cur_items: list[dict] = []
    cur_req = None

    def flush():
        nonlocal cur_items, cur_req
        if cur_items:
            turns.append({"role": "assistant", "items": cur_items})
        cur_items = []
        cur_req = None

    for o in entries:
        typ = o.get("type")
        msg = o.get("message")
        if typ == "user":
            content = msg.get("content") if isinstance(msg, dict) else None
            if not isinstance(content, str) or o.get("isMeta"):
                continue  # arrays are tool results; meta is injected noise
            text = clean_user_text(content)
            if not text:
                continue
            flush()
            turns.append({"role": "user", "text": scrub(text)})
        elif typ == "assistant" and isinstance(msg, dict):
            req = o.get("requestId") or o.get("messageId")
            if req != cur_req:
                flush()
                cur_req = req
            content = msg.get("content")
            if not isinstance(content, list):
                continue
            for b in content:
                if not isinstance(b, dict):
                    continue
                bt = b.get("type")
                if bt == "text" and b.get("text", "").strip():
                    cur_items.append({"t": "text", "text": scrub(b["text"].strip())})
                elif bt == "thinking" and include_thinking and b.get("thinking", "").strip():
                    cur_items.append({"t": "thinking", "text": scrub(b["thinking"].strip())})
                elif bt == "tool_use" and include_tools:
                    cur_items.append(
                        {"t": "tool", "name": b.get("name", "?"),
                         "target": scrub(tool_target(b.get("input")))}
                    )
    flush()
    # Drop assistant turns that ended up empty (e.g. tools-only when --no-tools).
    return [t for t in turns if t["role"] == "user" or t["items"]]


def main() -> int:
    ap = argparse.ArgumentParser(description="Export a Claude Code .jsonl transcript to shareable JSON.")
    ap.add_argument("input", type=Path, help="path to the session .jsonl")
    ap.add_argument("-o", "--output", type=Path, default=Path("transcripts/transcript.json"))
    ap.add_argument("--title", default="Making of")
    ap.add_argument("--include-thinking", action="store_true")
    ap.add_argument("--tools", dest="tools", action="store_true", default=True)
    ap.add_argument("--no-tools", dest="tools", action="store_false")
    ap.add_argument("--stamp", action="store_true",
                    help="add a coarse (year-month) export marker to meta")
    args = ap.parse_args()

    if not args.input.exists():
        print(f"error: {args.input} not found", file=sys.stderr)
        return 1

    turns = build_turns(load_lines(args.input), args.include_thinking, args.tools)
    n_user = sum(1 for t in turns if t["role"] == "user")
    n_asst = sum(1 for t in turns if t["role"] == "assistant")

    out = {
        "meta": {
            "title": args.title,
            "source": "claude-code",
            # No timestamps on purpose: per-message timing is never exported, and
            # the export moment is omitted so the transcript reveals no work-time
            # pattern (how long it took, gaps between prompts). Pass --stamp to add
            # a coarse (date-only) export marker if you want provenance.
            "turns": len(turns),
            "user_turns": n_user,
            "assistant_turns": n_asst,
            "thinking_included": args.include_thinking,
            "note": "PII-scrubbed export; review before publishing. Not polished on purpose.",
        },
        "turns": turns,
    }
    if args.stamp:
        out["meta"]["exported_on"] = datetime.now(timezone.utc).strftime("%Y-%m")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {args.output}  ({len(turns)} turns: {n_user} user / {n_asst} assistant)")
    print(f"redactions applied: {_redaction_count}  —  please review the output before sharing")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
