# Precomputed session planner

Status: SHADOW DEPLOYED - not consumed by live matchmaking

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
5. Keep repeated opponent encounters within two per active court for the cycle.
6. Minimize matches above configured team-gap and intra-team soft thresholds.
7. Minimize opponent repeats inside that budget.
8. Minimize exact average/maximum gaps and preference penalties.
9. During replan, minimize churn in the nearest already-visible lineups.

Partner variety is ranked ahead of opponent variety because repeating a partner
is more visible in a social session. Per-player quality debt prevents one player
from repeatedly absorbing the compromises needed to improve session averages.
Quality debt is compared in `0.5` bands before soft-threshold counts and opponent
variety, then by its exact value. Opponent-repeat overflow above twice the
active-court count is ranked before soft warnings; repeats inside that social budget are
ranked after them. This prevents both dozens of repeat encounters and avoidable
warning-level matches from winning through a tiny improvement elsewhere.

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

### Phase 1 optimization probe

Per-round match and board caches removed repeated calls to the existing engine
scorer without changing the one-pass real-session output. On the same exported
session, one-pass runtime fell from `9.8s` to `1.88s`, and the slowest round fell
from `1.97s` to `263ms`.

The cached one-pass quick matrix measured total/slowest-round wall time as:

| Players / courts / rounds | Total wall | Slowest round |
| --- | ---: | ---: |
| 24 / 4 / 8 | 558ms | 86ms |
| 28 / 6 / 8 | 1.31s | 182ms |
| 32 / 6 / 8 | 1.86s | 318ms |
| 36 / 6 / 8 | 2.00s | 303ms |

All quality and invariant gates from the pre-cache quick run remained clean.
Three cached passes improved the real-session quality further but took `5.45s`,
with the slowest round around `1.01s`. A `400ms` anytime deadline successfully
returned a valid best-so-far plan, but every round reached the deadline and its
quality landed between the one-pass and unbounded three-pass variants.

Decision update: a deterministic one-pass round now meets the local `<500ms`
chunk target. A whole-plan invocation still lacks safe Free Edge headroom. Keep
the Queue/checkpoint option, and require a deployed shadow benchmark before
claiming the hosted CPU gate passes.

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

Progress: cache and anytime-budget behavior are proven in diagnostics. The
deterministic scheduler, pair-swap orchestration, social objective, and live
eligibility validator now live in shared planner modules. The offline builder
reuses the production scorer and state projection and remains disconnected from
the live path.

Shared extraction progress:

- `planner/rest-schedule.ts` owns deterministic balanced rest scheduling and its
  mathematical unavoidable-rest bound.
- `planner/pair-swap-search.ts` owns deterministic two-court candidate ordering,
  bounded court-pair chunks, and serializable resume checkpoints.
- `planner/objective.ts` owns the balanced social objective and explicit repeat
  budget instead of allowing lexicographic tuning to swing between gap warnings
  and excessive opponent repeats.
- `planner/validation.ts` rejects missing, duplicate, checked-out, opted-rest,
  busy, and reserved players and can minimally repair only invalid visible slots.
- `planner/session-plan.ts` is the deployable assembly: it owns rest/seed/search/
  projection orchestration while importing the existing production scorer and
  live state projection. It has no Node file-system or diagnostic dependency.
- Running the search uninterrupted or one court-pair per checkpoint produces
  the same final board.
- Focused planner tests pass 11/11, including exact schedule/summary parity
  between the deployable module and the original diagnostic oracle. The full
  unit gate passes 170/171; the only
  failure is the pre-existing Cap-2 A1 runtime fixture where `suggestNextRound`
  exhausts its 2000ms budget and returns no alternatives.

The planner extraction is not wired into any live function. Existing live-engine
selection and persistence behavior remain unchanged.

The quick and 36-case structural matrices now execute the deployable `lib/`
module directly. The latest one-pass quick run keeps the prior quality output
and measures slowest rounds at `84-190ms`.

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

First real-session mutation gate (`0bbe25c1-...`) passes:

- Resume after three rounds with no mutation changes `0` future lineups.
- Checkout and opted-rest select the unavailable player `0` times and change
  exactly one nearest-visible lineup, the lineup containing that player.
- A late arrival leaves the nearest visible lineup unchanged and enters three of
  the four subsequently replanned rounds.
- One slow court blocks only the planned match containing its four busy players;
  two out-of-order courts block two matches. Remaining matches contain zero busy
  players and can be consumed independently.
- Cancellation can reissue the unchanged valid lineup; a deterministic manual
  replacement remains board-valid.
- Checkout leaves continuously active players at a `6-7` match-count range.
  The late arrival legitimately finishes at three matches while established
  players finish at six, so raw count spread is not used as an availability-
  normalized failure.
- No-mutation suffix runtime was about `2.0s` for five rounds; mutation tails
  were `0.9-1.4s`. Each measured round remained below the local `500ms` gate.

The full 36-case structural matrix still passes after continuation support. The
one-pass quick matrix keeps every round full, hard team/intra violations at zero,
partner repeats at zero, and slowest-round time at `106-237ms`.

The Phase 2 mutation matrix also passes for `24/4/6`, `28/6/6`, `32/6/8`, and
`36/6/6` player/court/round configurations. Across all four: no-mutation churn
is zero; checkout and opted rest select unavailable players zero times and alter
one nearest-visible lineup; late arrival preserves the nearest lineup; slow and
out-of-order courts emit zero busy-player double books; cancellation and manual
replacement remain valid. Maximum per-player quality debt ranges from `0.41` to
`0.92`, with no hard team/intra violations and no partner repeats.

### Phase 3 - Persistence contract

- Add migrations for versioned planning jobs and plan results only after Phase 2
  passes.
- Store compact plan rounds plus input/output hashes; keep full diagnostic detail
  only for anomalies.
- Apply RLS and security-definer guards using authenticated session ownership.
- Make job creation and result publication idempotent.

Schema implementation is staged in
`20260714000001_create_shadow_session_plans.sql`. The three tables are isolated
from live-match state, use composite foreign keys to prevent cross-session plan
rows, and make job/version publication idempotent through unique input and plan
identities. Authenticated users receive host-scoped read access only; there is
no client insert/update/delete policy. Shadow writes require `service_role`
after the Edge function has independently authenticated the session host.

The migration is intentionally not applied until the shadow function can create
and publish a plan end to end in tests. Applying the schema alone would be safe
but would create inert tables with no operational value.

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

`session-plan-shadow` is deployed as an isolated shadow function. It authenticates
the session host, loads the existing engine state, hashes a reproducible input,
runs the deployable one-pass planner, rechecks `live_state_version`, and writes
only `session_plan_*`. A changed session marks the job stale and publishes no
version. `persist:false` runs the same compute path without requiring the shadow
tables, enabling a pre-migration smoke. Strict Deno type-check and server-side
Supabase bundling both pass.

Remote rollout evidence on 2026-07-14:

- Migration `20260714000001_create_shadow_session_plans.sql` is applied; a
  subsequent `db push --dry-run` reports the remote database up to date.
- `session-plan-shadow` is ACTIVE at version 2. No existing live function and no
  client/Vercel bundle was deployed.
- A two-round `persist:false` smoke and persisted smoke both passed on session
  `0bbe25c1-...`; persisted IDs were job `4fb2d0ae-...` and version
  `27f32c1d-...`.
- Repeating the identical persisted request reused the same job ID, confirming
  the idempotent input identity.
- Cold wall time was about `9-10s` on the first invocation and `2.8-5.6s` when
  warm/reused. Reported planner active compute was only `3.4-3.5ms`; the smoke
  session currently exposes one configured court and existing history, so its
  match quality is not used as a six-court quality benchmark.

This deployment still cannot influence live suggestions. Phase 5 advisory
lookup remains intentionally unimplemented.

Six-court checkpoint evidence on 2026-07-14:

- Commit `7080381` added deterministic one-round checkpoints and deployed only
  `session-plan-shadow`; no migration, live function, or client was deployed.
- Session `940399e0-...` completed a 32-player, 6-court, 8-round pass-three plan
  through eight Edge invocations. Every round produced six matches, every
  player received six matches, maximum consecutive rest was one, and no 546 or
  timeout occurred.
- The slowest chunk used `1066ms` active compute, below the `2000ms` per-request
  Edge limit. Planner compute totaled `3303ms`; network/auth/database overhead
  made the eight-request wall time about `47s`, which is acceptable for an
  asynchronous pre-session shadow job but not an inline live request.
- Published quality was average/max team gap `0.160/0.470`, average/max
  intra-team gap `0.638/1.310`, zero partner repeats, 29 weighted opponent
  repeats, and maximum player quality debt `0.310`.
- Repeating the request reused job `9c79984b-...` and plan version
  `3bb1a9e4-...` without recomputing the plan.

Pass three is therefore hosted-runtime viable only in checkpointed mode. The
single-request default remains pass two; checkpoint output remains shadow data
until the Phase 5 validation/fallback path is implemented and gated.

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
| Average team gap | 0.597 | 0.215 |
| Maximum team gap | 4.55 | 0.56 |
| Team gap above 1.0 | 9 | 0 |
| Partner repeats | 6 | 0 |
| Opponent repeats | 41 | 40 |
| Maximum intra-team gap | 2.23 | 1.88 |
| Intra-team gap above 1.0 | 8 | 7 |
| Maximum consecutive rest | 2 | 1 |

The result proves useful planning headroom with a balanced social objective. It
does not yet prove hosted Free-plan runtime or production integration safety.
