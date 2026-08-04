# Suggest Quality — Repeat-First Selection (Action 1)

Status: READY for implementation (hand-off to Codex; audited against the corpus gate)
Date: 2026-07-20
Branch: `feat-next-match-suggester`
Supersedes: `docs/SUGGEST_QUALITY_SATISFICE_SPEC.md` (the pure satisfice-weight approach — proven insufficient; see §2).

---

## 0. TL;DR

Change the engine's lineup-selection objective from **"minimize PVNA gap"** to
**"minimize repeats among the lineups that are already balanced enough (gap ≤ tolerance)."**
Keep every hard gate. Bake in a **fixed diversity-first** tradeoff (gender stays a small
soft term — no host setting this pass).

Validated expected effect (faithful sim, n=60, real engine `scoreMatch`, both completion
orders): **opponent-repeat ~40% → ~34% (−6-7pt), partner-repeat ~10-12% → ~5-6% (halved),
team-balance / match-count-fairness / rest unchanged, gender-pref slightly worse (soft).**

This is a **structural** change to selection (not a weight tweak — that was tried and
failed). Acceptance = a 60-session replay gate.

---

## 1. Why (validated findings — condensed)

Established through: real-session dumps, a 60-session DB corpus, a CP-SAT oracle, and a
faithful rolling-lane sim that scores every candidate with the **real engine `scoreMatch`**.

1. **Opponent-repeat ~40% is NOT a physical floor.** A CP-SAT oracle found, on every
   round of every corpus session tried (tight 32-player and large 40-player, early and late
   rounds), a board with **0 opponent-repeats + 0 partner-repeats + near-zero team-gap
   simultaneously**. The engine's ~40% opp-repeat is an artifact of it **optimizing PVNA
   gap** instead of minimizing repeats.
2. **A repeat-first per-court fill captures most of the headroom LIVE**, inside the real
   rolling-lane model (fill one court at a time from the idle pool as courts complete). No
   precompute needed. Faithful n=60: opp 40.5→33.8 (inorder), 40.6→34.6 (random); partner
   ~halved. Consistent (opp better in ~48-49/60; partner not-worse in ~57-58/60).
3. **Weight-tuning alone does NOT achieve this.** Cranking `weights.opponent_repeat` to 30×
   on the real engine only moved opp 51→46%; a prior satisfice-weight change failed its
   gate. The engine's candidate generation + partition-search + alternative-sort stay
   PVNA-oriented regardless of weights. The fix must make the **selection structurally
   repeat-first**.
4. **The only real cost is a soft one: gender-pref.** Reducing opponent-repeats trades
   against gender-preference satisfaction (they compete for the same freedom). Gender is a
   SOFT penalty (no hard gate; `weights.partner_gender_pref=4` ≪ `partner_repeat` 28), and
   the engine already leaves it imperfect. Diversity-first accepts a small gender regression.
5. **Phase-based rotation does NOT escape the tradeoff** (tested faithfully, both
   directions) — it only picks a different point on the same opp↔gender line, at added
   complexity. A single fixed weight is simpler and sufficient. Do NOT implement phases.

Reference harness (not shipped): `scratch/rolling-sim-faithful.ts` (faithful metric
definitions), `scratch/data/*.json` (the 60-session corpus: real PVNA/gender from DB).

---

## 2. The change

### 2.1 Objective (within the tolerance-feasible set)
Rank candidate lineups lexicographically:

1. **Hard gates (unchanged, reject-if-violated):** `gap ≤ tolerance`, `intra ≤ limit`,
   not `hasRecentGroupRematch`, not `hasRepeatOverflow`, avoid-pair-not-partner,
   available/required players.
2. **Fairness / rest** (required + under-played players) — unchanged priority.
3. **Partner-repeat avoidance** (all-history) — high.
4. **Opponent-repeat avoidance** (all-history) — high.
5. **Gender-pref** — SOFT, small fixed weight (diversity-first). This is the tradeoff dial;
   it stays low and constant this pass.
6. **PVNA gap** — tie-break only.

The defining inversion vs today: **PVNA gap moves from primary minimand to tie-break; repeats
become primary within the balanced set.** Balance is still guaranteed by the hard gate (a
lineup is never allowed to exceed tolerance), so games stay competitive.

### 2.2 Where (files) — implementer decides the minimal structural change that passes §4
- `lib/next-round-suggester/score.ts` — `scoreMatch`:
  - Make the PVNA-gap contribution ~flat within tolerance (so it stops dominating). The
    existing `pvnaSatisficePenalty` can be reused, or the pvna term made tiny.
  - Make opponent-repeat avoidance an **all-history, strong** term (today
    `opponentRepeatScore` uses `weights.opponent_repeat` ≈ 1.5, plus a recent-only
    component weighted 4 — too weak). Partner-repeat is already strong; keep it.
  - Keep `genderPenalty` a soft term with a small fixed weight.
- `lib/next-round-suggester/pair.ts` — `shouldReplaceBestPartition` /
  `bestTeamSplitWithTolerance`: the comparison must genuinely prefer lower-repeat partitions
  (not fall back to PVNA-first via the score window).
- `lib/next-round-suggester/suggest.ts` — the alternative sort (≈ lines 720-798) and, if
  needed, candidate generation (`getPriorityCandidates`): must surface and prefer
  low-repeat lineups. **This is the crux — weight changes failed precisely because these
  stayed PVNA-first.** For the single-court live path (`suggestNextMatch`, the production
  rolling fill) the pool is small; ensure it evaluates enough candidates to find the
  low-repeat lineup.

### 2.3 Do NOT touch
Hard gates, `planner/`, rolling lookahead, commit/stale path, edge functions, DB, client UI.
No host setting for the tradeoff (that is a later, optional step — "Cách 2").

---

## 3. Invariants to preserve (must hold on the gate)
- **I1 PVNA balance:** relaxed-rate (matches with `gap > tolerance`) must not increase by
  more than +2pt vs baseline on any corpus session; no new tolerance-overflow behavior.
- **I2 Hard gates unchanged:** no increase in recent-group-rematch or repeat-overflow
  violations; hard gates still reject exactly as today.
- **I3 Fairness/rest not worse:** match-count spread and max-consecutive-rest not worse
  than baseline.
- **I4 No unfilled boards:** no increase in NO_VALID_MATCH / short boards.
- **I5 Determinism + runtime:** same input+seed → same output; per-call runtime within the
  existing budget.
- **I6 Gender is soft, bounded:** gender-pref penalty may rise, but bounded (see §4); it
  must never become a hard gate.

Partner-diversity is expected to **improve**, not regress.

---

## 4. Acceptance gate

Extend the existing gate (`scripts/diagnostics/suggest-quality-gate.ts`, Phase 0) to replay
the **60-session corpus** (data in `scratch/data/`, or re-pulled via the documented SQL)
through the **real production selection path**, comparing the modified engine to the current
baseline. Use the faithful metric definitions from `scratch/rolling-sim-faithful.ts`.

**Pass criteria (n=60, both `inorder` and `random` completion orders):**
- `opponent_repeat_rate`: **average decrease ≥ 5pt**; better on ≥ 45/60 sessions.
- `partner_repeat_rate`: **decrease or equal**; not-worse on ≥ 55/60 sessions.
- `gender_pref_penalty/match`: increase ≤ **+0.7** on average (diversity-first budget).
- I1 relaxed-rate: ≤ +2pt on every session.
- I2/I3/I4: no regression on hard gates, match-count spread, rest, or unfilled boards.
- Existing unit/property/scenario suites green (update only tests that assert exact lineups
  or "near-zero PVNA gap as quality" — those encode the old objective; keep genuine invariant
  tests).

**Tuning:** the opponent-repeat strength (and the small gender weight) are **tuned against
this gate**, not guessed. Adjust until opp hits the target without breaking I1-I4. The gate
is the tuning instrument and the merge contract.

---

## 5. Expected outcome (faithful, honest)

| Metric | Now (engine) | After (diversity-first repeat-first) |
|---|---|---|
| Opponent-repeat rate | ~40% | ~34% (−6-7pt) |
| Partner-repeat rate | ~10-12% | ~5-6% (halved) |
| Team balance (PVNA) | within tolerance | within tolerance (unchanged) |
| Match-count spread | ~2 | ~2 (unchanged) |
| Max consecutive rest | ~1.5 | ~1.4 (same/better) |
| Relaxed (over-tolerance) | ~3-4% | ~3% (same/better) |
| Gender-pref satisfaction | baseline | slightly worse (soft, ~+0.6 mismatch/match) |

In plain terms for a ~48-match session: **~3 fewer matches with a repeated opponent, partner
repeats cut in half, games just as balanced, everyone still plays a fair number** — at the
cost of a few more soft gender-pref misses. **A real, visible, modest improvement — not a
dramatic one.**

**Caveat:** the sim omits nothing in `scoreMatch` (it uses the real function) but does not
model live mutations (checkout/opt-rest/late-arrival). The gate on the real engine is the
final judge of the exact number.

---

## 6. Non-goals (deferred)
- **Precompute / CP-SAT plan consumption** (approaches ~0 repeats but is async/mutation-
  fragile) — separate, later.
- **Host-facing tradeoff control** ("Cách 2": a session setting to slide diversity↔gender) —
  only if demand appears; this pass hard-codes diversity-first.
- **Phase-based invariant rotation** — tested, does not escape the tradeoff; do not build.

---

## 7. Risks
- Touches selection/search — the hard-won-stable core. Mitigate with the gate + converting
  brittle exact-lineup tests to invariant/quality-bound tests.
- Structural change may need candidate-generation edits, not just scoring — budget for that;
  the gate reveals whether the change actually found the low-repeat lineups.
- The improvement is modest (~7pt). Confirm the team accepts that ROI before investing.

---

## 8. Audit checklist (reviewer)
- [ ] Hard gates byte-for-byte unchanged; balance still guaranteed (I1/I2).
- [ ] Selection is genuinely repeat-first within tolerance (verify the sort/search keys, not
      just a weight change).
- [ ] Gender remains a soft term with a single small fixed weight (no hard gate, no host UI).
- [ ] Gate green on n=60 both orders per §4; no session regresses a hard invariant.
- [ ] Partner-repeat down, opponent-repeat down; relaxed/spread/rest not worse.
- [ ] No touch to planner/rolling/commit/edge/DB/UI.
- [ ] Tests updated only where they encoded the old "minimize gap" objective.
- [ ] PR reports the final weights + the gate before/after table (n=60, both orders).
