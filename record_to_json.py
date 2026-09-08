#!/usr/bin/env python3
"""Turn a `script --timing` terminal recording into a replayable JSON for the deck.

Record:
    script -q --timing=run.timing run.out -c 'the command'     # util-linux script
Convert:
    python3 record_to_json.py run.out run.timing -o resources/recordings/NAME.json \
        --title "..." --command "the command" --meta scotch_commit=abc1234 --meta tool=pyscotch@def5678

Output contract (consumed by resources/term-player.js):
{
  "meta": { "title": str, "command": str, "recorded_at": iso8601, "duration_s": float,
            "chunks": int, ...any --meta key=value pairs... },
  "chunks": [ [delay_ms:int, text:str], ... ]     # delay is time since the previous chunk
}
Text is plain UTF-8: ANSI escape sequences are stripped, "\\r\\n" -> "\\n", lone "\\r"
kept (the player treats it as "return to start of current line"). Delays are capped at
--max-delay ms (default 1500) so a long silence never stalls the replay, and consecutive
chunks closer than --merge ms (default 15) are merged to keep the file small.
"""
from __future__ import annotations
import argparse, json, re, sys
from datetime import datetime, timezone
from pathlib import Path

ANSI = re.compile(r'\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\x1b[()][A-Za-z0-9]|\x1b[=>]')
CTRL = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]')

def clean(b: bytes) -> str:
    t = b.decode('utf-8', 'replace')
    t = ANSI.sub('', t).replace('\r\n', '\n')
    return CTRL.sub('', t)

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('out', type=Path, help='typescript output file from `script`')
    ap.add_argument('timing', type=Path, help='timing file from `script --timing`')
    ap.add_argument('-o', '--output', type=Path, required=True)
    ap.add_argument('--title', default='')
    ap.add_argument('--command', default='')
    ap.add_argument('--meta', action='append', default=[], metavar='KEY=VALUE')
    ap.add_argument('--max-delay', type=int, default=1500)
    ap.add_argument('--merge', type=int, default=15)
    ap.add_argument('--skip-header', action='store_true', default=True,
                    help='drop the "Script started" first line that `script` writes (default on)')
    a = ap.parse_args()

    data = a.out.read_bytes()
    pos = 0
    if a.skip_header and data.startswith(b'Script started'):
        nl = data.find(b'\n'); pos = nl + 1 if nl >= 0 else 0
    chunks: list[list] = []
    total = 0.0
    for line in a.timing.read_text().split('\n'):
        if not line.strip():
            continue
        parts = line.split()
        # classic format: "<delay_s> <nbytes>"; advanced format: "O <delay_s> <nbytes>" (only O = output)
        if parts[0] in ('O', 'I', 'H', 'S'):
            if parts[0] != 'O':
                continue
            delay, n = float(parts[1]), int(parts[2])
        else:
            delay, n = float(parts[0]), int(parts[1])
        text = clean(data[pos:pos + n]); pos += n
        total += delay
        d = min(int(delay * 1000), a.max_delay)
        if not text:
            if chunks: chunks[-1][0] += d
            continue
        if chunks and d < a.merge:
            chunks[-1][1] += text
        else:
            chunks.append([d, text])
    # strip the trailing "Script done" line if present
    if chunks and 'Script done' in chunks[-1][1]:
        chunks[-1][1] = chunks[-1][1].split('Script done')[0].rstrip()
        if not chunks[-1][1]:
            chunks.pop()
    meta = {'title': a.title, 'command': a.command,
            'recorded_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
            'duration_s': round(total, 2), 'chunks': len(chunks)}
    for kv in a.meta:
        k, _, v = kv.partition('='); meta[k] = v
    a.output.parent.mkdir(parents=True, exist_ok=True)
    a.output.write_text(json.dumps({'meta': meta, 'chunks': chunks}, ensure_ascii=False, indent=None))
    print(f'{a.output}: {len(chunks)} chunks, {total:.1f}s, {a.output.stat().st_size} bytes')
    return 0

if __name__ == '__main__':
    sys.exit(main())
