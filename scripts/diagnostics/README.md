# scripts/diagnostics

Reusable benchmarks, simulations, and probes for the PickleMatch session algorithm.
Moved from `scratch/` — all files are self-contained and can be re-run to verify behaviour.

Requires `.env` or `.env.server` with Supabase credentials (unless noted as synthetic).

---

## Synthetic simulations (no Supabase required)

```bash
# 40-player / 10-court session — board-stuck repro (strict gender prefs)
npx tsx scripts/diagnostics/simulate-40-player-session.ts
npx tsx scripts/diagnostics/simulate-40-player-session.ts --rounds=12

# Dynamic pool: rolling check-in/out, group assignments, courts 4-6
npx tsx scripts/diagnostics/simulate-dynamic-pool-session.ts
```

## Next-round simulations (live Supabase)

```bash
npx tsx scripts/diagnostics/simulate-next-round-session.ts <session-id>
npx tsx scripts/diagnostics/simulate-next-match-session.ts <session-id>
npx tsx scripts/diagnostics/simulate-live-preview-policy.ts <session-id>
npx tsx scripts/diagnostics/simulate-rolling-lane-quota-cache.ts --session-id=<id>
npx tsx scripts/diagnostics/simulate-round-quota-planner.ts --session-id=<id>
npx tsx scripts/diagnostics/simulate-preview-replacement-orchestration.ts --session-id=<id> [--courts=6] [--iterations=5]
```

## Benchmarks (live Supabase)

```bash
# Full E2E flows (also wired in package.json bench:*)
npx tsx scripts/diagnostics/bench-live-session-flow.ts
npx tsx scripts/diagnostics/bench-v2-full-flow.ts

# Per-action latency
npx tsx scripts/diagnostics/bench-live-match-start-complete.ts
npx tsx scripts/diagnostics/bench-live-mutations-edge-p95.ts
npx tsx scripts/diagnostics/bench-live-state-version-guard.ts
npx tsx scripts/diagnostics/bench-live-round-rpc-direct.ts
npx tsx scripts/diagnostics/bench-live-round-versioned-rpc.ts
npx tsx scripts/diagnostics/bench-live-action-edge-latency.ts

# Cloned-session flows
npx tsx scripts/diagnostics/bench-cloned-live-match-edge-flow.ts
npx tsx scripts/diagnostics/bench-cloned-live-match-flow.ts
npx tsx scripts/diagnostics/bench-cloned-round-flow.ts
npx tsx scripts/diagnostics/bench-human-live-edge-flow.ts
npx tsx scripts/diagnostics/bench-live-checkin-first-suggest.ts
```

## Load tests (live Supabase)

```bash
# 1. Seed sessions, 2. Run load test, 3. Summarize
npx tsx scripts/diagnostics/seed-live-load-test-sessions.ts
npx tsx scripts/diagnostics/load-test-versioned-rounds-concurrent.ts
npx tsx scripts/diagnostics/summarize-live-load-test-sessions.ts
```

## Measurements (live Supabase)

```bash
npx tsx scripts/diagnostics/measure-live-flow-step-breakdown.ts <session-id>
npx tsx scripts/diagnostics/measure-live-mutations-edge-vs-rpc.ts
npx tsx scripts/diagnostics/measure-live-snapshot-load.ts
npx tsx scripts/diagnostics/measure-next-round-full-flow.ts <session-id>
```

## Comparisons / A-B (live Supabase)

```bash
npx tsx scripts/diagnostics/compare-next-round-benchmark.ts <session-id>
npx tsx scripts/diagnostics/compare-next-round-synthetic.ts <session-id>
npx tsx scripts/diagnostics/compare-actual-live-to-current-suggest.ts <session-id>
```

## Offline precomputed-plan shadow

Uses an exported session directory and the existing engine scoring/state
projection. It writes `shadow-precomputed-plan.json` beside the export and does
not call or mutate Supabase.

```bash
npx tsx scripts/diagnostics/evaluate-session-quality-counterfactual.ts <export-directory>
npx tsx scripts/diagnostics/evaluate-session-quality-counterfactual.ts <export-directory> --shadow-only --passes=3
npx tsx scripts/diagnostics/benchmark-precomputed-shadow.ts
npx tsx scripts/diagnostics/benchmark-precomputed-shadow.ts --players=32 --courts=6 --rounds=8 --passes=1
npx tsx scripts/diagnostics/benchmark-precomputed-shadow.ts --passes=3 --round-budget-ms=400
npx tsx scripts/diagnostics/benchmark-precomputed-shadow.ts --players=32 --courts=6 --rounds=8 --passes=3 --chunked
npx tsx scripts/diagnostics/benchmark-precomputed-shadow.ts --full --passes=3
npx tsx scripts/diagnostics/simulate-precomputed-mutations.ts <export-directory>
npx tsx scripts/diagnostics/benchmark-precomputed-mutations.ts
npx tsx scripts/diagnostics/smoke-session-plan-shadow.ts [--session-id=<id>] [--rounds=<count>] [--passes=1|2|3] [--persist]
npx tsx scripts/diagnostics/smoke-session-plan-shadow.ts --session-id=<id> --rounds=8 --passes=3 --chunked
npx tsx scripts/diagnostics/probe-session-plan-advisory.ts --session-id=<id>
npx tsx scripts/diagnostics/compare-phase5b-session-quality.ts --live=<trace.json> --hybrid=<trace.json>
npx tsx scripts/diagnostics/evaluate-session-plan-shadow.ts --session-id=<id> [--passes=1,2,3,5] [--round-budget-ms=<ms>]
npx tsx scripts/diagnostics/evaluate-session-plan-shadow.ts --session-id=<id> --passes=2,3 --played-rounds=3 --mutation=checkout
```

`--chunked` persists one optimized round per Edge invocation and resumes the
same deterministic job until publication. It is shadow-only and requires an
explicit session ID; the script performs all resume calls automatically.

Architecture and rollout gates: `docs/PRECOMPUTED_SESSION_PLANNER.md`.

## Algorithm probes (live Supabase)

```bash
# Beam-search board-recovery probe
npx tsx scripts/diagnostics/sim-early-batch-beam.ts <session-id>

# REST invariant probe
npx tsx scripts/diagnostics/inspect-rest-violations.ts <session-id>
npx tsx scripts/diagnostics/inspect-session-rest-state.ts <session-id>

# Zero-play / empty-pool probe
npx tsx scripts/diagnostics/evaluate-zero-play-engine-options.ts <session-id>

# Diagnosis
npx tsx scripts/diagnostics/diagnose-live-preview-empty.ts <session-id>
npx tsx scripts/diagnostics/diagnose-live-repeat-tradeoff.ts <session-id>
npx tsx scripts/diagnostics/diagnose-round-suggest.ts <session-id>
```

## Offline full-board quality oracle

The oracle uses Google OR-Tools CP-SAT outside the Expo/Edge bundle. It compares
an engine dump with a lexicographically optimized full board and reports
`OPTIMAL` only when every objective stage is proven optimal.

```bash
python -m venv tmp/oracle-venv
tmp/oracle-venv/Scripts/python.exe -m pip install -r scripts/diagnostics/requirements-oracle.txt
npx tsx scripts/diagnostics/solve-session-quality-oracle.ts --input=<dump.json>
npx tsx scripts/diagnostics/solve-session-quality-oracle.ts --input=<dumps.jsonl> --line=-1 --time-limit=60
tmp/oracle-venv/Scripts/python.exe scripts/diagnostics/quality-oracle-solver.py scripts/diagnostics/fixtures/quality-oracle-small.json --time-limit=10 --workers=1
```

Objective order: recover all players who already rested once, minimize projected
match-count spread, max player quality debt, max team gap, max/total opponent
repeat burden, max/total partner repeat burden, max intra-team gap, avoid-pair
opponent exposure, partner gender-preference penalty, then total quality debt.
Opponent gender preference remains a reported diagnostic and is not included in
the current optimality proof.

The proof covers one replayable scheduling checkpoint. It does not by itself
prove that an entire asynchronous rolling-court session is globally optimal.

## Regression checks (live Supabase)

These map directly to known bugs and can serve as manual regression probes:

```bash
# Stale preview revert bug (fixed in feat-next-match-suggester)
npx tsx scripts/diagnostics/test-stale-preview-guard.ts --session-id=<id>

# Live state version mutation paths
npx tsx scripts/diagnostics/test-live-state-version-mutation-paths.ts [--session-id=<id>]
```
