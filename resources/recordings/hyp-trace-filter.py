#!/usr/bin/env python3
"""Compact Hypothesis --hypothesis-verbosity=debug output to one line per test case.
Kept verbatim: provenance lines before the run, the FAILURES/summary tail.
Collapsed: each "Test case:" block + its "N choices -> Status.X" verdict -> one line
"#k graph_data=(...) -> VALID|INTERESTING (assertion)|INVALID|OVERRUN"; consecutive
OVERRUN/INVALID probes are counted instead of listed; shrink pass names are printed once
when they change; choice tuples and tracebacks are dropped."""
import sys, re
out = sys.stdout
def emit(s): out.write(s + "\n"); out.flush()
PASSES = re.compile(r'^(try_trivial_spans|minimize_individual_choices|node_program_X+|redistribute_numeric_pairs|lower_integers_together|[a-z_]+)$')
STATUS = re.compile(r'^(\d+) choices -> Status\.(\w+)')
k = 0; case = None; in_case = False; buf = []; assertion = None; last_pass = None
run = None; run_n = 0; tail = False; started = False; explain = False
def flush_run():
    global run, run_n
    if run and run_n: emit(f"        … {run_n} essai{'s' if run_n>1 else ''} {run}")
    run = None; run_n = 0
for line in sys.stdin:
    line = line.rstrip("\n")
    if tail:
        # Hypothesis' "explain" phase re-runs dozens of cases after the report; keep the E-lines, skip the rest
        if line.startswith("E   Explanation:"): explain = True; emit(line); continue
        if explain:
            if line.startswith("Shrink pass profiling"): explain = False; emit(line); continue
            if line.startswith("E ") or line.startswith("E\t"): emit(line)
            continue
        if STATUS.match(line) or line.startswith("\t") or line.startswith("exit_with("): continue
        emit(line); continue
    if re.match(r'^=+ FAILURES =+', line): flush_run(); tail = True; emit(line); continue
    if not started:
        if line == "Generating new test cases": started = True; emit("── génération ──"); continue
        emit(line); continue
    if line == "Shrinking failing test cases": flush_run(); emit("── réduction (shrinking) ──"); continue
    m = re.match(r'^Shrinking InterestingOrigin.*?: (\(.*\))$', line)
    if m: emit(f"   départ : choix {m.group(1)[:60]}…"); continue
    if line.startswith("Shrinking made a total") or line.startswith("  * "): flush_run(); emit(line); continue
    if line.startswith("Test case:"): in_case = True; buf = []; continue
    if in_case:
        if line.startswith(")"):
            in_case = False
            txt = " ".join(x.strip() for x in buf)
            mm = re.search(r'graph_data=(\(.*\))\s*,?$', txt)
            case = re.sub(r'\s+', ' ', mm.group(1)) if mm else txt[:80]
            if len(case) > 70:
                nv = re.match(r'\((\d+),', case); ne = case.count("(") - 1
                case = f"({nv.group(1) if nv else '?'}, {ne} arêtes)"
        else: buf.append(line)
        continue
    if line.startswith("E   AssertionError:"): assertion = line[len("E   AssertionError: "):]; continue
    ms = STATUS.match(line)
    if ms:
        st = ms.group(2); k += 1
        if st in ("OVERRUN", "INVALID") and case is None:
            if run != st: flush_run(); run = st
            run_n += 1; continue
        flush_run()
        if case is None: case = "(rejeu du minimum)"
        if st == "INTERESTING": emit(f"#{k:<4} graph_data={case}  -> FAIL  {assertion or ''}")
        elif st == "VALID": emit(f"#{k:<4} graph_data={case}  -> ok")
        else: emit(f"#{k:<4} graph_data={case}  -> {st}")
        case = None; assertion = None; continue
    if line.startswith("\t") or line.startswith("overrun because") or not line.strip(): continue
    if PASSES.match(line) and not line.startswith(("tests/", "E ", "F", "..")):
        if line != last_pass: flush_run(); emit(f"   passe : {line}"); last_pass = line
        continue
