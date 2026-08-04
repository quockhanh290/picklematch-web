# Design: Unified quality-cost model + host-decidable tradeoffs

Date: 2026-08-04
Status: DRAFT — pending user review
Related: `docs/ENGINE_SCORING_AUDIT.md` (71 findings, RC3/RC4), memory `project-engine-audit-generator-fixes`

## 1. Problem

The audit (RC3/RC4) showed the suggester's scoring is not internally consistent and does not model what a
*social* pickleball session actually wants:

- **Balance is priced last.** `pvna` (team imbalance) weight = 1, while a repeat costs 28–80, avoid-opponent
  300. So the scorer accepts almost any blowout to dodge a repeat/avoid — the opposite of what players want.
- **Rigid hard gates.** Five `INFINITY` gates (intra, tolerance, recent-group-rematch, repeat-overflow,
  avoid-partner) auto-reject a match even when the slightly-over option is the best available.
- **~16 fragmented post-pass repairs**, each defending a different metric with its own scoring, run in a fixed
  order over a partition none can re-cut. Tightening one relocates the failure — the mechanical reason
  point-fixes never converge.

Sim confirms it: across skill distributions the current model produces a **blowout in 30–45% of matches**
(uniform 37%, bimodal 45%, skewed 31%).

## 2. Goal — what an optimal SOCIAL session is

Context is **social, not a tournament**: players come to *play enough* and *meet people*. "Đủ tốt" beats
"hoàn hảo". Priority when things conflict (confirmed with the user):

**Chơi-đủ (participation) > Tránh-blowout (balance) > Đa-dạng (variety) > Pref (gender/group)**

…but expressed as **magnitude tradeoffs, not rigid rules**. The user's calibration intents (all must hold):

1. **Thà lệch trong ngưỡng còn hơn lặp** — a fresh match with imbalance ≤ tolerance beats repeating to shave it.
2. **Không lặp chỉ để bớt 0.1 lệch.**
3. **Blowout = phương án cuối** — accept a repeat rather than a real blowout.
4. Everything comparable **by magnitude**; the host decides the boundary cases, not a hard-coded rule.

**Success criteria:** blowout rate drops sharply across all distributions; fairness (rest spread) and variety
(unique partners) do not regress; the 5 intent-check micro-scenarios (§8) all pass; full test suite green.

Validated in a design spike (`scratch/sim-cost-model.ts`, 300 seeds): the proposed model cuts blowout to
**5–13%** (from 30–45%), avgGap ~1.3–1.9 → **~0.4**, rest spread and unique-partners unchanged.

## 3. Scope

**In scope:** the **quality cost of a single foursome + its team split**, replacing `scoreMatch`'s mis-scaled
sum and softening the 5 hard gates; plus the **3-tier host options** (best / alternative / wait-for-court)
re-anchored to this cost. Applies to BOTH paths that call `scoreMatch`: live rolling
(`buildSuggestedMatchPayloads`) and round-planning (`suggestNextRound`).

**Out of scope (separate work):**
- **Participation / rest / fatigue fairness** stays at the *selection* layer (who is eligible/prioritised into
  the pool). Already tuned in ALGO 49–50 (generator band-cap, corrector no-global-relax, budget reserve).
- **Joint 2–3 court allocation** (Nhánh 3) — a different lever, only for the multi-court-complete moment.
- **Retiring the ~16 redundant post-pass repairs** — a follow-up cleanup (§7), listed but not done here.

## 4. The quality-cost function

For a candidate match with teams `A=[a0,a1]`, `B=[b0,b1]` (pvna = effective PVNA), and session tolerance
`TOL` (default 0.5), hard-intra limit `HARD_INTRA = 1.0`:

```
gap    = |pvna(a0)+pvna(a1) − pvna(b0)−pvna(b1)|         // team imbalance
intraA = |pvna(a0)−pvna(a1)|,  intraB = |pvna(b0)−pvna(b1)|

C = balance + intra + repeat + genderPref + avoidOpp − groupReward
```

All weights below are **illustrative** — final values are set by the A/B calibration (§6). What is fixed is
the **shape** of each term.

### 4.1 Balance (blowout) — HINGE
```
balance = W_TIE · gap  +  W_BAL · max(0, gap − TOL)²
```
- `W_TIE ≈ 0.1`: a mild tie-break so that among equally-fresh options the tighter one wins — small enough that
  it never drives a repeat.
- `W_BAL ≈ 1.3`: over-tolerance grows **quadratically** → a genuine blowout is the last resort. `W_BAL` is the
  **default "switch point"** (see §5.2): with these numbers the engine tolerates a fresh match up to
  gap ≈ 1.0–1.1 before it would rather repeat.
- Imbalance **within tolerance is ~free** → satisfies intents 1 & 2.

### 4.2 Intra (partner mismatch) — HINGE
```
intra = W_ITIE · (intraA + intraB)  +  W_INTRA · (max(0,intraA−HARD_INTRA)² + max(0,intraB−HARD_INTRA)²)
```
- `W_ITIE ≈ 0.1` mild preference for even partners; `W_INTRA ≈ 1.0` heavy only **beyond** the hard cap.
- Removes the hard intra gate: a stacked team (strong+weak partners) is **allowed but costly** — acceptable at
  social play when the pool is tight, penalised otherwise.

### 4.3 Repeat (variety) — recency-weighted, escalating, group-exempt, team-aware
For each partner pair `(a0,a1),(b0,b1)` and each opponent pair `(ai,bj)`:
- **Group-exempt:** skip the pair if both are in the same `group_id` (friends who chose to play together).
- **Recency:** use the recency-decayed prior-meeting count (keep the existing `RECENT_REPEAT_PENALTY_WINDOW`
  + `recentRepeatDecay`) → a rematch last round hurts more than one 6 rounds ago. Let `m` = projected meeting
  number after this match (recency-weighted).
- **Escalating curve** `meet(m)`: `m≤1 → 0` (fresh), `m=2 → 0.8`, `m=3 → 2.5` (severe), `m≥4 → 2.5+2·(m−3)`.
- `repeat = Σ_partnerPairs meet(m)  +  0.7 · Σ_opponentPairs meet(m)` (opponent repeat is milder than partner
  repeat). The dynamic **repeat caps become soft** — the steep `m≥4` region replaces the old `INFINITY` cap.
- **Decision 1 (team-aware exact rematch):** remove the foursome-level "same 4 players → exact4 (+80) /
  `hasRecentGroupRematch` INFINITY" surcharge. It counted a **re-split** of the same four (fresh partners,
  fresh oppositions) as a full rematch. The per-pair costs above are already team-aware: a genuine full
  rematch (same partnerships) pays two partner-repeats + four opponent-repeats (heavy); a re-split pays only
  the shared opponent-pairs (light, correctly "fresher"). `getMatchGroupKey` / the same-4 block are dropped
  from scoring.

### 4.4 Gender preference — soft, lowest tier
```
genderPref = W_GP · partnerPrefViolations  +  W_GO · opponentPrefViolations       (W_GP ≈ 0.4, W_GO ≈ 0.2)
```
No gate; the lowest-weight term — always yields to balance/variety.

### 4.5 Group reward — mild, capped below balance
```
groupReward = min(GROUP_CAP,  W_GROUP · groupedPartnerPairs)                        (W_GROUP ≈ 0.3)
```
Friends are gently preferred as partners (and are repeat-exempt, §4.3), but the reward is **capped** so it can
never make a blowout preferable — addresses the audit warning that `group_bonus` could stack a bimodal friend
group into an intra-gap blowout.

### 4.6 Avoid
- **avoid-partner: HARD** (`INFINITY`) — a "never" wish, kept absolute.
- **avoid-opponent: heavy soft** `avoidOpp = W_AVOID_OPP · avoidOpponentPairs` (`W_AVOID_OPP ≈ 4`, roughly a
  severe repeat) — strongly avoided but tradeable, never at the cost of a real blowout.

### 4.7 Hard invariants (the only absolutes)
1. **avoid-partner** never paired.
2. **Structural:** four distinct players, valid 2v2 (enforced by construction, not scoring).

Everything else that was a hard gate becomes soft: **intra** and **tolerance** become soft cost regions
(§4.1–4.2); the **repeat cap** becomes the steep `m≥4` region (§4.3); the **recent-group-rematch** gate is
*dropped entirely* — its intent is subsumed by the team-aware per-pair repeat costs (§4.3, Decision 1).

## 5. Three-tier host options

Re-anchor the existing `tradeoff_choices` and wait-rescue infra to the new cost.

### 5.1 Best (default)
The engine seats `argmin C` from the eligible pool.

### 5.2 Alternative (host toggle) — generalise `buildOverThresholdRepeatTradeoff`
Currently a "less-repeat" toggle only fires when repeat ≥ 3. Generalise: when a second match `A'` exists with
`C(A')` within a band `ALT_BAND` of `C(best)` AND `A'` trades the **balance↔freshness** axis in the other
direction (best = fresher-but-more-imbalanced, `A'` = more-balanced-but-repeats, or vice versa), surface `A'`
as a host toggle. The default `W_BAL` sets the lean; the host decides the boundary case per match. No universal
switch point is hard-coded.

### 5.3 Wait for Court X
**Definition of "bad" (degraded)** — a match is bad when the *best* `C` from the current pool is dominated by a
heavy region (i.e. the pool cannot yield a decent match):
- **blowout-bad:** `gap` is meaningfully over tolerance (reuse `BLOWOUT_DEGRADE_GAP_FLOOR`), OR
- **repeat-bad:** an unavoidable projected **3rd meeting** (severe).

When **both** best and alternative are bad AND `findRescueCourts` verifies that completing a specific live
court would unlock a match whose `C` clears the bad threshold (strictly better), surface **"Chờ Sân X"**. Only
shows when it genuinely helps — re-anchoring the existing 2-step rescue check to the new cost, replacing the
current standalone `degraded_reason` bookkeeping.

## 6. Calibration & testing

- **Harness:** `scratch/sim-cost-model.ts` (full-session sweep over uniform / tight / bimodal / skewed, 300
  seeds) reporting avgGap, blowout %, repeat-3/session, rest spread, unique partners — proposed vs current.
- **Intent regression:** `scratch/intent-check.ts` — the 5 micro-scenarios (§8) must all pass for any weight set.
- **Acceptance criteria:** blowout % drops sharply on every distribution; rest spread and unique-partners do
  NOT regress vs current; the 5 intent-checks pass; full Jest suite (unit + property + scenario + fairness +
  host-live) green in `--runInBand`.
- **Weights to tune:** `W_BAL` (switch point), `W_AVOID_OPP`, `W_GROUP`/`GROUP_CAP`, gender weights, the
  `meet()` curve, opponent factor 0.7. Shapes are fixed; only magnitudes move.

## 7. Rollout & follow-ups

- **Flag-gate** the new cost behind an env switch; A/B in prod; bump `LIVE_PREVIEW_ALGORITHM_VERSION`.
- **Follow-up (separate spec): retire redundant post-pass repairs.** Once `scoreMatch` seats good matches
  directly, the symptom-patch repairs become redundant/conflicting — including the two pull-from-bench repairs
  added in ALGO 47/48. Enumerate which are subsumed and remove them (dissolves RC4). Not done in this spec.
- **#70** (`rollingPlanTarget` reverting pull-from-bench repairs) remains a prerequisite for Nhánh 3, unchanged.

## 8. Intent-check scenarios (regression anchors)

The proposed shapes pass all five (verified in the spike):

| # | Scenario | Correct pick |
|---|---|---|
| 1 | fresh gap 0.4 vs repeat-2nd balanced | **fresh** (thà lệch trong ngưỡng hơn lặp) |
| 2 | repeat just to shave 0.1 gap | **no repeat** |
| 3 | fresh BLOWOUT gap 2.0 vs repeat-2nd balanced | **repeat** (blowout = last resort) |
| 4 | fresh gap 1.0 vs repeat-2nd balanced | **fresh** (accept ≤ switch point) |
| 5 | severe repeat-3rd vs fresh gap 1.5 | **fresh** (avoid the 3rd meeting) |

## 9. Risks / open items

- Scoring changes ripple through every path → the full suite + sim A/B gate is mandatory before ship.
- Softening the hard gates could, in a genuinely impossible pool, seat a worse-looking match than an outright
  reject would — mitigated by the "bad" definition + wait-rescue surfacing it to the host.
- Final weights are A/B-derived; this spec fixes shapes and relative ordering, not the exact magnitudes.
