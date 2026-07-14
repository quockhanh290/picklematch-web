# Precomputed session planner

Status: PROPOSED - shadow diagnostic only

## Architecture decision

Do not build a second matchmaking engine.

Keep `lib/next-round-suggester` as the only source of truth for player state,
effective PVNA, match scoring, fairness, repeat history, and live invariants. Add a
multi-round planner above that kernel. The planner may choose future rest groups
and lineups, but it must use the same scoring and state-projection primitives as
the live engine.

The production live path remains authoritative:

1. The planner proposes a versioned schedule.
2. The live Edge function validates the next planned match against current busy,
   check-in, check-out, opted-rest, avoid-pair, and version state.
3. A valid planned match is persisted through the existing suggested-match path.
4. An invalid plan never blocks a court. The current live engine immediately
   supplies the fallback and the remaining plan is marked for replan.

This makes the planner an optional optimizer, not another operational state
machine.

## Social-pickleball objective order

Use lexicographic objectives. A lower-priority gain must never purchase a
higher-priority violation.

### Hard invariants

1. Four unique, currently eligible players per match; no player appears twice in
   one logical cycle.
2. No busy, checked-out, or opted-rest player is selected.
3. No player rests more than one consecutive eligible cycle when avoidable.
4. Match-count spread is at most one when mathematically feasible.
5. No persisted plan may bypass live version and assignment-conflict guards.

### Quality objectives

1. Minimize matches with team gap above `1.0`.
2. Minimize matches with intra-team gap above `2.0`.
3. Minimize partner repeats.
4. Minimize the maximum per-player quality debt.
5. Minimize average team gap and matches above configured tolerance.
6. Minimize intra-team gap, opponent repeats, and preference penalties.
7. During replan, minimize churn in the nearest already-visible lineups.

Partner variety is ranked ahead of opponent variety because repeating a partner
is more visible in a social session. Per-player quality debt prevents one player
from repeatedly absorbing the compromises needed to improve session averages.

## Free-plan execution decision

Do not run the current full-session TypeScript search in one Supabase Edge
request. The first 32-player, 6-court, 8-round shadow benchmark took about 91
seconds while evaluating all comparison variants. It is suitable evidence for
quality potential, not a production runtime design.

Measure the isolated planner after caching and incremental-search work, then use
this decision gate:

| Measured result | Execution model |
| --- | --- |
| Full plan safely below Edge CPU budget | One asynchronous shadow invocation |
| Each resumable chunk below 500 ms CPU | Supabase Queue + checkpointed Edge chunks |
| A round cannot reliably fit in 500 ms CPU | Host-device or external worker; Supabase stores and validates plans |

Regardless of the compute location, Supabase remains the source of truth for job
identity, plan versions, validation results, and audit history. Do not perform the
combinatorial search inside Postgres functions.

## Version and invalidation contract

Every plan is bound to:

- `session_id`
- authoritative `live_state_version`
- canonical roster/config fingerprint
- engine/scoring version
- planned round count and court count
- effective PVNA, preference, group, and avoid-pair inputs

Check-in, check-out, opted-rest, group/preference/config changes, completed or
cancelled matches, and host replacements invalidate affected future rounds. A
replan freezes any started match and preserves the nearest visible suggestion
unless it has become invalid.

## Implementation phases

### Phase 0 - Offline proof and measurement

- [x] Generate one shadow plan from a real 32-player session.
- [x] Verify 48/48 matches, six matches per player, no consecutive rest, and no
  duplicate player in a cycle.
- [x] Record the first trade-off: zero partner/opponent repeats and no team gap
  above `1.0`, with higher intra-team compromise than the actual session.
- [x] Separate timing for rest scheduling, seed construction, per-round search,
  state projection, and output serialization.
- [x] Add a reusable quick quality matrix and a full 36-case structural matrix for
  24/28/32/36 players, 4/5/6 courts, and 6/8/10 rounds.
- [ ] Run the full matrix with production-quality search passes after Phase 1
  removes the current rescoring bottleneck.

No Supabase token, migration, or deployment is needed in this phase.

### Phase 0 runtime findings

The isolated real-session shadow planner took `32.2s` with three local-search
passes and `9.8s` with one pass. Rest scheduling took about `1ms`, seed creation
was below `1ms` per round, and state projection was normally around `1-4ms` per
round. Candidate local search owns effectively all runtime.

The one-pass quick synthetic matrix produced:

| Players / courts / rounds | Total wall | Slowest round | Hard quality violations |
| --- | ---: | ---: | ---: |
| 24 / 4 / 8 | 1.4s | 281ms | 0 |
| 28 / 6 / 8 | 8.2s | 1.78s | 0 |
| 32 / 6 / 8 | 9.9s | 2.07s | 0 |
| 36 / 6 / 8 | 9.7s | 2.10s | 0 |

All quick cases filled every court, kept match-count spread at most one, avoided
consecutive rest where feasible, and had no team gap above `1.0` or intra-team
gap above `2.0`. A zero-search 36-case structural run covered all player/court/
round combinations. It exposed and then locked the unavoidable-rest case: 36
players on four courts now caps the prototype at two consecutive rests instead
of three; because 20 of 36 players must rest each cycle, a cap of one is
mathematically impossible there.

Decision: reject both a single Edge invocation and the current one-round chunk
implementation for Supabase Free. Several one-round chunks consume the entire
two-second envelope before network, auth, serialization, or cold-start overhead.
Phase 1 must target a measured chunk below `500ms` before any shadow deploy.

### Phase 1 - Shared planning kernel

- Extract reusable objective comparison, invariant validation, effective-PVNA
  access, and state projection from the existing engine modules.
- Add `lib/next-round-suggester/planner/`; do not fork `score.ts`, fairness, or
  player-state types.
- Make search resumable and deterministic from a seed/checkpoint.
- Cache team and four-player match metrics to avoid rescoring identical
  candidates.
- Replace full-board rescoring inside pair swaps with score deltas for the two
  changed courts.
- Add a strict time budget and always return the best valid plan found so far.

Gate: existing live-engine outputs and all operation tests remain unchanged when
the planner feature flag is off.

### Phase 2 - Session and mutation simulation

- Compare live-only, precomputed, and hybrid-replan modes.
- Simulate late arrival, checkout, opted rest, roster changes, slow courts,
  out-of-order completion, cancellation, and manual replacement.
- Prove replan never changes started matches or double-books a player.
- Measure quality by session and by player, not only board averages.

Gate: no invariant regression, match-count spread at most one when feasible,
bounded runtime, and no visible-lineup churn without a real invalidating event.

### Phase 3 - Persistence contract

- Add migrations for versioned planning jobs and plan results only after Phase 2
  passes.
- Store compact plan rounds plus input/output hashes; keep full diagnostic detail
  only for anomalies.
- Apply RLS and security-definer guards using authenticated session ownership.
- Make job creation and result publication idempotent.

Candidate ownership model:

```text
session_plan_jobs       one requested optimization and its checkpoint/status
session_plan_versions   immutable input fingerprint and aggregate quality
session_plan_rounds     compact ordered rest IDs and four-player lineups
```

### Phase 4 - Supabase shadow execution

- Deploy a separate `session-plan-shadow` function. It must not write live
  matches or increment `live_state_version`.
- Invoke it only with cloned/dump inputs first.
- Capture wall time, active compute, memory/shutdown reason, checkpoint count,
  and result quality.
- Use a queue only if the measured chunk budget is safe on the Free Plan.

Gate: no 546/timeout across the benchmark matrix and no measurable latency impact
on live suggest/start/complete functions.

### Phase 5 - Advisory integration

- Add a feature-flagged plan lookup to `session-live-matches-suggest`.
- Validate planned matches with the existing live invariant path before persist.
- Fall back immediately to current live suggestion on missing, stale, invalid, or
  unfinished plans.
- Record shadow planned-vs-live quality and invalidation reasons.

Gate: a planner outage or disabled flag is behaviorally identical to production
today.

### Phase 6 - Host opt-in and rollout

- Show pre-session planning progress outside the live court workflow.
- Permit starting before planning finishes; live engine remains available.
- Roll out to internal sessions, then a small opt-in cohort.
- Promote only after multiple real sessions improve per-player and board quality
  without operation regressions.

## Rollback

One server-side feature flag disables plan consumption. Existing persisted plans
then become inert audit data; no migration rollback and no client release is
required to restore live-only behavior.

## Current evidence

Real-session shadow result for `0bbe25c1-095e-444e-986d-f1e4fa11b132`:

| Metric | Actual | Shadow plan |
| --- | ---: | ---: |
| Completed matches | 48 | 48 |
| Match-count range | 5-7 | 6-6 |
| Average team gap | 0.597 | 0.263 |
| Maximum team gap | 4.55 | 0.62 |
| Team gap above 1.0 | 9 | 0 |
| Partner repeats | 6 | 0 |
| Opponent repeats | 41 | 0 |
| Maximum intra-team gap | 2.23 | 1.99 |
| Intra-team gap above 1.0 | 8 | 15 |
| Maximum consecutive rest | 2 | 1 |

The result proves useful planning headroom. It does not yet prove production
runtime suitability or a globally optimal social objective balance.
