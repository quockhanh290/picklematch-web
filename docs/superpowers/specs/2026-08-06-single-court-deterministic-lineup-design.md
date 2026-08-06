# Single-Court Deterministic Lineup — Design Spec

**Date:** 2026-08-06
**Branch:** feat-quality-cost-model
**Status:** approved (brainstorm) → ready for planning

## Problem

Live single-court refill produces **non-deterministic** suggestions: the same bench/state
can seat a clean lineup on one request and a repeat-3 (degraded) lineup on another. The host
sees a bad suggestion + a "Chờ sân / Chơi luôn" (wait-rescue) panel for a court that could
actually be filled cleanly, then a re-suggest resolves it — with nothing changed in roster/bench.

### Verified root cause (byte-identical state, different output)

Two real dumps for session `1db29119` court 5 (Sân 6), reconstructed and compared:
- 05:00:24 (v228): seated `[Võ Khang, Hồ Uyên] v [Phan Tuấn, Đỗ Thủy]` → `degraded=repeat` (meet 3)
- 06:29:24 (v229): seated `[Vũ Linh, Phan Tuấn] v [Đỗ Thủy, Phạm Dũng]` → clean (meet 1)

Verified **identical** across both: the 7 eligible players, every partner/opponent count, every
priority field (`matches_played=3, consecutive_rest=0` uniform), the 5 live courts, and input order.
Same input, different output ⇒ non-determinism.

**Mechanism (`suggest.ts`):**
- `suggestNextMatch` (live single-court, sets `config.courts=1`) calls `suggestNextRound`, whose
  strategy loop `['fairness','rest','diversity','group']` **breaks on a wall-clock deadline**
  (`timedOut = () => Date.now() >= regularSearchDeadline`). The repeat-avoiding strategies
  (`diversity`/`group`) run **last**.
- When the top alternative is degraded, `suggestNextMatch` should run
  `suggestNextMatchExhaustiveFallback` (a deterministic exhaustive scan) — but it is **skipped when
  `remainingRuntimeMs <= 100`** (`suggest.ts:936`), and the fallback itself has an internal
  wall-clock timeout (`suggest.ts:1024+`).
- The search budget is **dynamic**: `suggestNextMatch` passes the request's *remaining* time. On a
  cold/slow request (auth alone consumed 77–234ms, snapshot 65–224ms of a ~600ms request), little
  budget remains → the exhaustive fallback is skipped → the degraded (repeat-3) greedy result is returned.

So: fast request → fallback runs → clean; slow request → fallback skipped → repeat-3. Flaky by timing.

## Goal

For **single-court** suggestion (`suggestNextMatch`), when the greedy top lineup is degraded, find the
best achievable lineup **deterministically** (independent of wall-clock), so the same state always yields
the same optimal suggestion and never seats a repeat-3 when a cleaner lineup exists at equal fairness.

Out of scope: multi-court / full-board suggestion (larger search space; separate effort).

## Key measurements (this repo, `scratch/bench-*.ts`)

Exhaustive fallback (`makeAlternative` per combination — expensive):

| eligible | C(n,4) | fallback avg | cheap-scan avg |
|---|---|---|---|
| 8  | 70    | 7ms    | 3ms  |
| 12 | 495   | 222ms  | 13ms |
| 16 | 1820  | 2604ms (hits 2500ms cap) | 49ms |
| 20 | 4845  | (>2500ms cap) | 150ms |
| 24 | 10626 | — | 356ms |

The **cheap scan** = enumerate C(n,4)×3 computing only gap + projected-repeat + `computeQualityCost`
(no `makeAlternative` 8-stage pairing). ~50× faster than the exhaustive fallback. This is the lever.

## Design

Add a **deterministic, bounded clean-lineup correction** to `suggestNextMatch`, replacing the
wall-clock-gated exhaustive fallback for the common single-court case.

When the greedy top alternative from `suggestNextRound` is degraded (has repeat/PVNA tradeoffs or
relaxed warnings) **and** the eligible pool size ≤ 20:

1. **Cheap deterministic scan.** Enumerate every 4-subset × 3 splits of the eligible players that
   contains all `requiredPlayerIds` (the fairness hard-filter — players with `consecutive_rest ≥ 1`
   and MUST_PLAY tiers, computed exactly as the existing exhaustive fallback does). For each candidate
   compute gap, projected max-meeting, and `computeQualityCost`. Pick the deterministic minimum
   (lexicographic min-repeat → min-gap → min-cost, matching the tradeoff ranking the sort already uses).
   No `Date.now()`, no `makeAlternative`.
2. **Materialize once.** Run `makeAlternative` on the single winning 4-subset to produce a proper
   `SuggestionAlternative` (preserving pairing/tolerance/warnings semantics).
3. **Pick the better.** Compare against the greedy top via the existing single-match sort
   (`sortSingleMatchAlternatives`); return whichever ranks better.

**Pool cap:** apply steps 1–3 only when eligible ≤ 20 (worst-case ~150ms, deterministic, covers
realistic live single-court pools). For pools > 20 (rare — mostly round-1-with-one-court), keep the
current behavior unchanged.

### Fairness handling

`requiredPlayerIds` (consecutive_rest ≥ 1, MUST_PLAY, forced_required) is applied as a **hard filter**
on the enumerated subsets — a player fairness requires to play is always in the lineup. The scan only
optimizes repeat/balance/cost **within** the fairness-fixed freedom. This matches the approved principle
"fairness is a hard-filter first" and mirrors the existing exhaustive fallback's `requiredPlayerIds` logic.

### Determinism guarantee

The correction path uses no wall-clock dependence: the cheap scan enumerates a fixed set of
combinations for a given state and picks a lexicographic minimum. The one `makeAlternative` call on a
4-player set is exhaustive/deterministic (partition count ≤ max iterations). Therefore identical state ⇒
identical output.

## Testing

1. **Deterministic repro (the bug):** construct a single-court state where the fairness/rest-sorted
   greedy top is a repeat-3 but a clean lineup exists in the eligible pool; drive `suggestNextMatch`
   with a **near-zero remaining budget** (mock clock past the deadline). Assert it seats the **clean**
   lineup (with the fix) rather than the repeat-3. Without the fix this test would seat the repeat-3.
2. **Determinism:** same state, two runs under different simulated clocks → identical seated lineup.
3. **Fairness invariant:** a state with a `consecutive_rest ≥ 1` player → that player is in the seated
   lineup even when excluding them would reduce repeats.
4. **Pool cap:** eligible = 22 (> 20) → correction skipped, behavior identical to current.
5. **Latency guard (bench, not CI):** eligible ≤ 20 correction completes ≤ ~150ms.
6. **Regression:** existing suggester unit/scenario tests unchanged; multi-court path untouched.

## Edge cases & risks

- **Winner materialization diverges from cheap-scan ranking.** `makeAlternative` may relax tolerance or
  add warnings that change the picked lineup's character. Mitigation: only *replace* the greedy top when
  the materialized alternative still ranks better via `sortSingleMatchAlternatives`; otherwise keep greedy.
- **`requiredPlayerIds` over capacity** (more required than 4 slots): the existing fallback clears the
  required set (`MUST_PLAY_OVER_CAPACITY`); the scan must mirror that so it never returns empty.
- **No clean lineup exists (genuinely forced):** the scan's minimum is still a repeat/blowout → behavior
  matches today (degraded seated) and the forced-tradeoff panel correctly fires.
- **Exact single-court predicate:** `suggestNextMatch` always sets `config.courts=1`; confirm the
  correction is scoped to that entry point (not `suggestNextRound` multi-court callers) during planning.

## Files (anticipated; finalized in plan)

- `lib/next-round-suggester/suggest.ts` — `suggestNextMatch` correction (steps 1–3, pool-cap gate);
  reuse `requiredPlayerIds` derivation from `suggestNextMatchExhaustiveFallback`.
- `lib/next-round-suggester/forced-tradeoff.ts` or a small shared helper — the cheap lineup enumeration
  (already exists as `candidateLineups`/`buildFreshestLineup`; may generalize to min-quality-cost).
- `tests/next-round-suggester/unit/` — new determinism + repro tests.
- `lib/next-round-suggester/live-preview.ts` — bump `LIVE_PREVIEW_ALGORITHM_VERSION` on deploy.
