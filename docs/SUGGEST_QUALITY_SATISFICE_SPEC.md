# Suggest Quality — Satisfice + Fairness Spec

Status: DRAFT for implementation (hand-off to implementer, audited against the corpus gate)
Date: 2026-07-19
Branch: `feat-next-match-suggester`
Owner: engine (`lib/next-round-suggester`)

---

## 0. TL;DR for the implementer

Ship three things, in order, each gated by an offline replay of a fixed real-session
corpus:

1. **Phase 0 — Quality gate** (`scripts/diagnostics/suggest-quality-gate.ts`): replay a
   fixed corpus of exported real sessions through the production fill path and print a
   fixed metric set vs a committed baseline. No engine change. This is the audit backbone.
2. **Phase 1 — Satisfice PVNA** (`lib/next-round-suggester/score.ts`): stop rewarding
   PVNA gap *below* a comfort band; spend the freed selection pressure on opponent
   diversity. Keep the hard tolerance gate unchanged.
3. **Phase 2 — Match-count fairness** (`lib/next-round-suggester/live-preview.ts` +
   `select.ts`): ensure no present player trails the field by ≥2 games when a fairer
   assignment is feasible.

Phase 3 (rework rolling lookahead objective) and Phase 4 (host PVNA↔diversity control)
are **conditional / deferred** — see §7. Do not implement them in this pass.

**Golden rule:** never regress the two things the engine already does well — PVNA held
within tolerance, and near-zero partner repeats. Every phase must pass the gate (§3)
before merge.

---

## 1. Why (validated findings)

Measured on 3 fully-completed real sessions (32–33 players, 6 courts, 6–7 rounds, all
players present from round 0), reconstructed from exported dumps under
`diagnostics/session-replay/`:

| Finding | Evidence | Verdict |
|---|---|---|
| Opponent repeats pervasive | 32–43% of real matches have ≥1 repeated opponent pair, concentrated in late rounds | **#1 quality leak** |
| Match-count unfairness | 2/3 sessions: some players 3 games, others 6, when spread 1 was achievable (excess +2) | **fails user's #1 priority** |
| Late-round degradation (myopia) | intra-gap and opp-repeat rise round-over-round (opp-rep 0 early → 1.0–1.33 late) | real |
| Tail collapse (hogging) | 2/3 sessions: last-filled court ~2× worse than first | real, session-dependent |
| PVNA held well | only 0–5% of matches exceed tolerance 0.5 | **do not break** |
| Partner diversity held | ~0 partner repeats everywhere | **do not break** |

Key mechanism (why opp-repeat is stubborn): PVNA-feasible partitions are scarce under a
tight tolerance on a bimodal skill spread, so PVNA-balance and opponent-diversity trade
off directly. The engine currently *minimizes* PVNA gap (`score += pvnaDiff * weights.pvna`),
which over-consumes the scarce well-balanced groupings early → forced repeats late.

Config-only replays (weights, tolerance) on the same corpus showed:
- Lowering the PVNA weight (a crude satisfice) reduces opponent repeats consistently
  (~4–6 pts overall, ~3–11 pts late) across 4/4 sessions, at a small balance cost.
- Loosening tolerance alone did **not** reliably reduce repeats and cost balance — so the
  freedom must be *directed* at diversity via the objective, not merely permitted. This is
  why Phase 1 changes the objective shape, and Phase 4 (tolerance) is deferred.
- Enabling the current rolling lookahead **worsened** late opponent repeats (4/4) because
  its objective optimizes PVNA balance — hence Phase 3 is deferred pending an objective
  rework.

Full analysis scripts live under `scratch/` (`analyze-real-hogging.js`,
`confirm-engine-issues.js`, `analyze-opp-repeat-avoidable.js`, `test-satisfice.ts`,
`expected-outcome.ts`) — reference only; not part of the shipped change.

---

## 2. Scope & invariants

**In scope:** Phase 0, 1, 2.

**Out of scope this pass:** the rolling planner (`planner/`), the rolling lookahead
(`chooseRollingHorizonAlternative`), commit/stale path, edge functions, client UI, DB.

**Hard invariants (must hold on the corpus gate, every phase):**
- I1. PVNA hard gate unchanged: a match with `pvnaDiff > effective tolerance` is still
  rejected/flagged exactly as today. The **relaxed-match rate** (matches with
  `team_gap > configured tolerance`) must not increase by more than **+3 percentage points**
  vs the committed baseline on any corpus session.
- I2. Partner-repeat rate must not increase vs baseline on any corpus session.
- I3. No increase in unfulfilled boards: number of `NO_VALID_MATCH` / short boards must not
  increase vs baseline.
- I4. Determinism preserved: same input + same `preview_seed` → same output (seedable).
- I5. Runtime: per single-court `buildSuggestedMatchPayloads` call stays under the existing
  budget (no new asymptotic cost; satisfice is O(1) in scoring).

---

## 3. Phase 0 — Quality gate (audit backbone) — BUILD FIRST

### 3.1 Deliverable
`scripts/diagnostics/suggest-quality-gate.ts`, runnable as `npx tsx
scripts/diagnostics/suggest-quality-gate.ts` and wired to an npm script
`"gate:suggest-quality"`.

### 3.2 Corpus (fixed, committed)
Reconstruct initial `SessionState` from the exported dumps of these sessions (already in
repo under `diagnostics/session-replay/<id>/`):
- `341faad1-cbd0-4e86-99a5-0d897f83ea38`
- `9485bd3a-d6e7-4597-9d04-ab682fe750f5`
- `967e6682-207d-4d92-aec9-dbe56b54ca2b`

Reconstruction (see `scratch/replay-real-fix.ts` for a working reference):
- Player roster (pvna/gender/group/prefs) = the first `debug_dumps` payload's `players[]`
  where every `matches_played === 0`. PVNA is only in the dumps, not `session_player_state`.
- Config (`courts`, `pvna_tolerance`, `court_preset`, `weights`, `planned_total_rounds`) =
  `payload.derived_state_summary.config` from any dump.
- Start from empty history (`rounds: []`, no partner/opponent counts).

### 3.3 Simulation harness
Replay a full session through the **production fill path**
`buildSuggestedMatchPayloads` (from `lib/next-round-suggester/live-preview.ts`), with a
staggered completion loop mirroring
`scripts/diagnostics/simulate-real-session-completion-orders.ts` (initial batch board of
`courts`, then complete one court at a time and refill `count === 1`, projecting state via
`buildProjectedStateAfterLiveMatch` / `buildProjectedStateAfterCompletedLiveRound`).
- `options.rollingHorizon = false`, `options.rollingPlanTarget = null` (isolate the engine
  objective; the rolling layer is out of scope).
- Run each session under **2 completion orders**: forward and reverse.
- `ROUNDS = 7`.

### 3.4 Metrics (per session, averaged over the 2 orders)
- `opp_repeat_rate` — % of filled matches with ≥1 repeated opponent pair.
- `late_opp_repeat_rate` — same, for rounds ≥ 4.
- `partner_repeat_rate` — % with a repeated partner pair. (invariant I2)
- `relaxed_rate` — % with `team_gap > configured pvna_tolerance`. (invariant I1)
- `intra_gap_avg`.
- `match_count_spread` — max − min appearances across present players.
- `tail_last_fill_quality` — avg composite `q = team_gap*7 + intra_gap*7 + pr*4 + or*2`
  at the last fill rank within a round (hogging proxy).
- `incomplete_fills` — count of `count===1` requests that returned ≠1 payload. (I3)

### 3.5 Baseline
On first run (current engine), write results to
`diagnostics/suggest-quality-baseline.json` and commit it. The gate compares later runs
against this file. **The gate asserts DELTAS through the same harness, not absolute values**
(the harness is intentionally pessimistic in absolute terms; only relative movement is
trusted).

### 3.6 Output & exit code
Print a table (baseline vs current, with delta) and exit non-zero if any invariant (§2
I1–I3) fails. A `--update-baseline` flag rewrites the baseline file.

### 3.7 Acceptance (Phase 0)
- Gate runs green against the current engine (baseline == current ⇒ all deltas 0).
- Committed baseline file present.
- Deterministic across two runs (I4).

---

## 4. Phase 1 — Satisfice PVNA

### 4.1 Intent
Within the acceptable PVNA band, treat all gaps as equally good, so the remaining
selection pressure (opponent diversity, fairness) decides. Keep balance a *constraint*,
not a *minimand*.

### 4.2 Change — `lib/next-round-suggester/score.ts`, `scoreMatch`
Today (≈ line 616):
```
const score = pvnaDiff * weights.pvna + partnerRepeatScore + opponentRepeatScore
  - stats.group_bonus * weights.group_bonus + stats.gender_pref_penalty
  + stats.consecutive_play_penalty + recentRepeatCost.total + avoidOpponentPenalty
  + intraGapSoftPenalty + intraOverflowPenalty
```
Replace the `pvnaDiff * weights.pvna` term with a **satisficing penalty**:
```
pvnaSatisficePenalty(pvnaDiff, effectiveTolerance) * weights.pvna
```
where, with a new tunable `PVNA_COMFORT_RATIO` (default `0.6`):
```
comfort = PVNA_COMFORT_RATIO * effectiveTolerance
penalty = pvnaDiff <= comfort ? 0 : (pvnaDiff - comfort)
```
- `effectiveTolerance` = the tolerance in force for this scoring call
  (`options.tolerance ?? state.config.pvna_tolerance`). The **hard gate** above
  (`pvnaDiff > tolerance → INFINITY`) is unchanged — satisfice only reshapes the *soft*
  reward inside the feasible band.
- Apply the same comfort-band treatment to `intraGapSoftPenalty`: flat below
  `PVNA_COMFORT_RATIO * INTRA_TEAM_PVNA_GAP_LIMIT`, linear above. Keep `intraOverflowPenalty`
  (the > `INTRA_TEAM_PVNA_GAP_LIMIT` region) unchanged.
- Do **not** change the hard-gate constants, `hasRepeatOverflow`, recent-repeat logic, or
  the partition search structure.

`PVNA_COMFORT_RATIO` must be a single exported const (tunable against the gate). Expose it
so a future config field can override it, but a config field is **not** required this pass.

> Implementer note on I1: the config-only sim that motivated this used a *flat low* PVNA
> weight everywhere (`0.2`), which under-penalizes even large gaps and drove the
> relaxed-rate up ~+11 pts on one session — that would fail I1. The satisfice shape here is
> deliberately different: **0 below comfort, but the FULL original slope above comfort**, so
> large gaps are penalized at full strength and the engine relaxes tolerance no more than
> today. Start at `PVNA_COMFORT_RATIO = 0.6` and raise it toward `1.0` if the gate shows
> `relaxed_rate` creeping past the I1 bound; lower it toward `0.4` if opp-repeat is not
> moving. This one knob is the primary tuning surface.

### 4.3 Diversity emphasis (paired with 4.2)
Within the now-flat band, opponent diversity must be the 1st-order differentiator. Two
allowed levers (pick the minimal one that passes the gate; prefer the first):
- (a) Raise the effective opponent-repeat influence so it dominates sub-comfort PVNA
  differences — e.g. bump `RECENT_OPPONENT_REPEAT_WEIGHT` and/or the default
  `weights.opponent_repeat` path — tuned against the gate.
- (b) Leave weights, rely on the existing `compareRecentRepeatCost` / opponent-burden
  tie-breaks in `suggest.ts` now that PVNA no longer dominates.

Document the chosen lever + final constants in the PR.

### 4.4 Acceptance (Phase 1) — via the Phase 0 gate
On ≥ 3/3 complete corpus sessions (341, 9485, 967), vs the committed baseline:
- `opp_repeat_rate`: average decrease **≥ 3 pts**; no session increases by > 1 pt.
- `late_opp_repeat_rate`: not worse than baseline on average.
- `relaxed_rate`: increase ≤ **+3 pts** on every session (I1).
- `partner_repeat_rate`: not increased on any session (I2).
- `match_count_spread`: not worsened on any session.
- `incomplete_fills`: not increased (I3).
- Existing unit/property/scenario suites: green, except pre-existing documented
  baseline failures. Update any test that asserted *near-zero PVNA gap* as a quality signal
  to assert *within-tolerance* instead (these encode the old minimand and are expected to
  change; do not weaken genuine invariant tests).

---

## 5. Phase 2 — Match-count fairness

### 5.1 Intent
No present player should trail the field by ≥ 2 games when a fairer, still-feasible
assignment exists. Target availability-adjusted spread ≤ 1.

### 5.2 Where
- `lib/next-round-suggester/live-preview.ts` — `buildSuggestedMatchPayloads`:
  `getRoundRequiredIds`, `softUnderplayedOverrides`, `softOverplayedOverrides` (≈ lines
  589–730). The under-played bias currently uses `avgMatchesForBias - 0.25` /
  `+0.75`; the greedy per-court fill still lets a player drift to −2.
- `lib/next-round-suggester/select.ts` — `getMatchBalanceFromAvailabilityMetrics` /
  `comparePlayersByPriority` (the `matchBalance` tier input).

### 5.3 Change (implementer chooses the minimal change that passes the gate)
Strengthen under-played prioritization so a player who is ≥ 1.5 games below the
availability-adjusted expected count is treated as effectively required before any player
at/above expected receives an additional game. Reuse the existing
`computeAvailabilityMetrics` / `delta_from_expected` — do **not** add a new fairness model.
Keep it satisfice-compatible: the freed PVNA slack from Phase 1 should absorb the balance
cost of pulling under-played players in.

### 5.4 Acceptance (Phase 2) — via the gate
- `match_count_spread` ≤ **1** on all 3 complete corpus sessions.
- No regression vs the post-Phase-1 numbers on `opp_repeat_rate`, `relaxed_rate` (I1),
  `partner_repeat_rate` (I2), `incomplete_fills` (I3).
- Rest fairness (add to the gate: `max_consecutive_rest`) must not increase.

---

## 6. Test & CI

- The gate (§3) is the primary acceptance instrument for Phases 1–2.
- Add a focused unit test for `pvnaSatisficePenalty` (flat below comfort, linear above,
  hard-gate untouched) and for the strengthened under-played requirement.
- Run `npm run typecheck:guard`, `npm run lint:errors`, `npm run test:suggester`.
- No migration, edge deploy, or client deploy. Nothing here touches production runtime
  paths beyond `score.ts` / `select.ts` / `live-preview.ts` logic that already runs both
  client- and edge-side; the gate proves behavior offline before any deploy is considered.

---

## 7. Deferred / conditional (DO NOT implement this pass)

- **Phase 3 — rolling lookahead objective rework.** Only revisit if, after Phases 1–2,
  the gate still shows `tail_last_fill_quality` materially worse than the round average.
  Requires rewriting `chooseRollingHorizonAlternative`'s objective to satisfice PVNA and
  preserve fresh-opponent options (current objective minimizes gap and *worsens* late
  diversity — proven on the corpus). High churn risk; own spec.
- **Phase 4 — host PVNA↔diversity control.** A product setting (tolerance / preference).
  Config-only replays showed loosening tolerance alone is not a reliable diversity lever,
  so this is a UX affordance, not an auto-improvement. Own spec + design review.

---

## 8. Expected outcome (honest, from the corpus)

After Phases 1–2 (data-backed where simmable, estimated where noted):
- Opponent repeats: **down meaningfully** (Phase 1 simmed ~5 pts overall / 3–11 pts late;
  a true satisfice shape should meet or beat that). **Not near zero** — a hard floor exists
  (the PVNA-balance ↔ diversity trade-off under scarce feasible partitions).
- Match-count spread: **3 → 1** (estimated; 9485 already achieves 1, so it is feasible).
- PVNA balance & partner diversity: **preserved** (enforced by I1/I2).
- Tail/late-round: **improved** by the freed diversity pressure; the residual is a Phase 3
  question.

There is no configuration that simultaneously drives PVNA imbalance and opponent repeats to
zero — that is a physical trade-off, not a code defect. This spec buys the largest, safest,
cheapest share of the achievable improvement.

---

## 9. Audit checklist (for the reviewer)

- [ ] Phase 0 gate exists, runs, is deterministic, baseline committed.
- [ ] Phase 1: hard PVNA gate byte-for-byte unchanged; only the soft term reshaped;
      `PVNA_COMFORT_RATIO` a single tunable const.
- [ ] Phase 1 gate deltas meet §4.4; I1–I3 hold on every session.
- [ ] Phase 2: reuses existing availability metrics (no new fairness model); spread ≤ 1;
      no regression vs Phase 1 (§5.4).
- [ ] No touch to `planner/`, rolling lookahead, commit/stale path, edge, DB, UI.
- [ ] Tests updated only where they encoded the old "minimize gap" signal; genuine
      invariant tests untouched.
- [ ] PR documents chosen §4.3 lever and final constants, with the gate table before/after.
