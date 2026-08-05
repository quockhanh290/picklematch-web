# Forced-Court Tradeoff Decision — Design Spec

**Date:** 2026-08-05
**Branch:** `feat-quality-cost-model` (continues the quality-cost engine work)
**Status:** Design approved (host confirmed "đủ rồi")

## Problem

On the live canary session (ae50a374, quality-cost engine on), the host reported:
- "Sân 5 lệch 1.2, không hiện alternatives" — an imbalanced court with no way to
  see/choose a different lineup.
- "Sân kẹt, complete sân khác không gỡ được, phải chờ lâu" — the wait-rescue
  ("Chờ Sân X") flow stalled.

Root cause (traced end-to-end, reproduced):
1. When a court **cannot be cleanly filled** (every lineup either repeats or is
   imbalanced), the engine **silently picks one** (its cost-optimal). The host
   never sees the tradeoff and cannot override it. The gap-1.2 lineup was the
   cost-optimal — but the host wanted to decide whether to accept that imbalance
   or accept a repeat instead.
2. The engine mostly produces **one lineup per court** (`finalAlts=1` on
   single-court refills), so there is nothing to offer even when the delivery
   works. Multi-court choices that ARE built get **dropped** by
   `repairSuggestedPayloadBatch` (live-preview.ts:3009 calls
   `normalizeRepairedPayload` without `{ clearTradeoffChoices: false }`).
3. `rescue_court_idxs` is a **hint** (its own migration comment says so): the host
   waits for a listed court, it finishes, and a clean lineup still isn't possible
   → wasted wait.

The current generic 4-option tradeoff menu (`buildLiveTradeoffChoices`:
balanced / keep_pvna / reduce_intra / reduce_repeat) is the wrong abstraction —
it is fuzzy, rarely populated, and not what the host reasons about.

## Goal

At a court that **cannot be cleanly filled**, hand the host a clear **3-way
decision** instead of a silent engine pick:

1. **Chờ Sân Y** — wait for a specific live court whose completion is
   **simulation-verified** to make a clean lineup possible (not a hint list).
2. **Chịu lặp** *(default)* — the least-imbalanced lineup (accepts a repeat).
3. **Chịu lệch** — the least-repeat lineup (accepts imbalance, even a blowout).

Default policy unchanged: **accept repeat, avoid blowout**. The host may override.

## Definitions

**"Cannot be cleanly filled" (bad court):** no lineup over the current pool is
both within tolerance (gap ≤ pvna_tolerance) AND repeat-free (max projected
meeting < 3), without breaking a hard invariant. Equivalently: the two Pareto
endpoints below are distinct (a genuine tradeoff exists).

**The two Pareto endpoints** — computed over the **full eligible pool (idle +
this court's own returning players + bench)**, respecting hard invariants
(avoid-partner, rest requirements, no double-booking):

- **① Chịu lặp** = lexicographic **minimize gap, then minimize repeat**. The most
  balanced lineup possible; among equally-balanced, the freshest. Avoids blowout.
  **This is the default.**
- **② Chịu lệch** = lexicographic **minimize repeat, then minimize gap**. The
  freshest lineup possible; among equally-fresh, the least imbalanced. May be a
  blowout (host explicitly accepts it).

If ① and ② are the same lineup, the court is not "bad" — no decision is surfaced.

**Simulation-verified wait (Chờ Sân Y):** for each live court Y currently
playing, simulate Y completing → its 4 players return to the pool → attempt a
**clean** fill of court X (gap ≤ tolerance AND repeat-free AND invariant-safe)
from the enlarged pool.
- If some Y yields a clean fill → offer "Chờ Sân Y", guaranteed-clean-on-finish.
  Among qualifying Y, hint the one running longest (`started_at` earliest →
  likeliest to finish soonest). Timing is never guaranteed — only the quality
  of the eventual fill.
- If no single Y yields a clean fill → **do not** offer a wait; the host sees
  only ② / ③ (and, optionally, a note that waiting won't help).

## Architecture

Three layers, all behind the existing `SESSION_QUALITY_COST_MODEL` per-session
flag (so it ships dark and A/Bs on the canary session only):

### 1. Engine (`lib/next-round-suggester/`)

- **Bad-court detector + endpoint builder:** for a court being filled, when the
  primary suggestion is not clean, compute the two Pareto endpoints ① and ②
  (each a lexicographic optimum over the eligible pool). Emit them as the court's
  two host-facing options, with ① as the default lineup. Reuse/extend the
  existing alternative search (which already searches up to
  `LIVE_TRADEOFF_ALTERNATIVE_LIMIT` candidates) rather than a second search where
  possible; the endpoints are the two extreme candidates by the two lexicographic
  orders.
- **Simulation-verified wait:** replace the board-relative `rescue_court_idxs`
  hint with a per-live-court simulation (add Y's players → attempt clean fill →
  keep Y only if clean). Output the verified court list + the longest-running
  hint. Reuse the existing per-court clean-fill search under a "clean only"
  threshold.
- Both are computed only for bad courts (clean courts are untouched — no toggle,
  no extra search cost in the common case).

### 2. Delivery (edge + persistence)

- Carry the two endpoint lineups + the verified-wait list on the payload.
- **Fix the drop:** `repairSuggestedPayloadBatch` (live-preview.ts:3009) must not
  strip the decision data when a repair fires — preserve it for courts whose
  lineup is unchanged, and recompute/re-attach for courts the repair changed
  (stale endpoints for a changed lineup are worse than none).
- **Persist so it survives snapshot hydration:** the host decision data (two
  endpoints + wait list + which one is shown) must round-trip through
  `get_live_session_snapshot_versioned`. `degraded_reason` / `rescue_court_idxs`
  / `match_explanations` already have columns; the two-endpoint payload goes into
  `suggestion_metadata` (jsonb, already returned by the snapshot) written at
  persist time (RPC insert or a best-effort sync, matching the degraded-fields
  pattern). No new column if `suggestion_metadata` suffices.

### 3. Client (`features/host/session-detail/next-round-v2/`)

- Render the 3-way panel on a bad court's card: **① Chờ Sân Y** (only if a
  verified wait exists) / **② Chịu lặp** (default, selected) / **③ Chịu lệch**.
- Each option shows its concrete consequence: ② "cân (gap X.X), [người] gặp lại
  lần N"; ③ "tươi, đội lệch X.X"; ① "Sân Y xong sẽ xếp sạch (đã chơi M phút)".
- Selecting ② / ③ swaps the displayed lineup; selecting ① triggers the existing
  wait-rescue re-suggest against Y. The host confirms with **Bắt đầu**.
- **Persist the host's choice** (survives reload). Default (Bắt đầu without
  choosing) = ② Chịu lặp.
- Retire the generic 4-option tradeoff menu; this 3-way decision replaces it for
  bad courts. Clean courts keep the plain single-lineup card.

## Non-goals

- Multi-court waits (waiting for two courts together to enable a clean fill) —
  v1 checks single-court completion only; note the limitation, defer.
- Changing the default weights (host rejected weight-tuning; default policy
  "accept repeat, avoid blowout" stays — the decision is surfaced, not forced).
- A middle Pareto point — only the two endpoints (+ wait) are offered.
- Predicting when a court will finish (impossible); only quality is guaranteed.

## Open decisions (to resolve in the plan)

- Exact "clean" threshold for the wait simulation and the bad-court detector
  (gap ≤ tolerance and max-meeting < 3 — confirm against existing degraded
  thresholds so this doesn't double-define "bad").
- Whether the two endpoints reuse the existing alternative-search output (pick
  the two extremes) or need a dedicated lexicographic pass.
- Persistence vehicle: `suggestion_metadata` jsonb vs a small dedicated column
  set (favor `suggestion_metadata` to avoid a migration if size is acceptable).
- Wording of the panel copy (Vietnamese, host-facing).

## Testing approach

- Engine unit: given a hand-built bad court (pool where clean is impossible),
  assert ① is the min-gap/then-min-repeat lineup and ② is the
  min-repeat/then-min-gap lineup, and that they differ; assert a clean court
  yields no decision.
- Engine unit: wait-simulation — a pool where adding court Y's players enables a
  clean fill → Y is offered; a pool where no single court helps → no wait.
- Delivery: the two endpoints + wait list survive `repairSuggestedPayloadBatch`
  and the snapshot round-trip (flag ON); flag OFF byte-identical.
- Replay: on the canary dumps, confirm the previously-silent gap-1.2 / repeat-3
  courts now emit a 3-way decision with the correct endpoints.
- Client: the panel renders the available options, defaults to ② , swaps lineup
  on selection, and persists the choice.

## Rollout

Behind `SESSION_QUALITY_COST_MODEL` (per-session). Ships dark; validated on the
canary session before wider rollout. Migration (if any) + edge deploy + client
are the host's decision, as before.
