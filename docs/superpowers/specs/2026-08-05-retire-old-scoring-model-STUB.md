# STUB: Retire the old scoring model (post-rollout cleanup)

Status: not started — placeholder for after `SESSION_QUALITY_COST_MODEL` is flipped ON
permanently in prod and the A/B window (see `.superpowers/sdd/2026-08-04-unified-quality-cost-model/`)
closes with a keep decision. Do not start this work while the flag is still being A/B'd —
the old model is the rollback path until then.

Design doc for the model itself: `docs/2026-08-04-unified-quality-cost-model-design.md`.

## Why this exists

Tasks 1–7 of the quality-cost model added a *parallel* scoring path behind
`isQualityCostModelEnabled()` in `lib/next-round-suggester/score.ts`, without removing anything
the old path depended on — by design, so the flag-OFF suite stays byte-identical and the flag is
a real kill-switch. That leaves the old model, its guard rails, and several old-model-specific
repair/detection passes live in the codebase alongside the new one. Once the new model is the
permanent behaviour, that duplication is dead weight and a maintenance hazard (two scoring
mental models to keep in sync). This stub lists what to retire and where to look; it is not an
implementation plan — write one (via `superpowers:writing-plans`) before touching any of this.

## (a) Migrate or remove the ~67 old-model characterization tests

The legacy characterization suite (`tests/host-live/characterization/*`, plus assorted
`tests/next-round-suggester/**` files) asserts old-model behaviour directly against `scoreMatch`
with the flag at its default (OFF) and does not use `__setQualityCostModelOverrideForTests`. Once
the flag is permanently ON these either:
- need to be rewritten to assert against the new model's behaviour (if the scenario still matters), or
- can be deleted (if the scenario was specifically characterizing an old-model quirk, e.g. a hard
  gate or relaxation stage that no longer exists — see (b)).

Find the flag-unaware suite by contrast with the flag-aware files that DO use the override hook
(`tests/next-round-suggester/unit/quality-cost.test.ts`,
`tests/next-round-suggester/unit/score-quality-flag.test.ts`,
`tests/next-round-suggester/unit/live-preview-wait-rescue-quality-cost.test.ts`) — everything else
under `tests/host-live/characterization/` and the older `tests/next-round-suggester/unit/*` files
that predate Task 1 is a candidate.

## (b) Simplify `pair.ts` relaxation stages made redundant by soft gates

`pair.ts` implements an 8-stage PVNA/intra-group relaxation ladder (strict → progressively relaxed)
because the old `scoreMatch` hard-gates (`INFINITY_SCORE` returns) meant a candidate pair either
passed a stage's constraints or was invisible to scoring. The quality-cost model replaces most of
those hard gates with soft cost terms (`computeQualityCost` in `lib/next-round-suggester/quality-cost.ts`)
scored directly — under flag ON, `scoreMatch` already short-circuits before most of the old
tolerance/intra/repeat/rematch gates (see the `isQualityCostModelEnabled()` branch, before the
flag-OFF gate cascade). Once flag ON is permanent, audit which of the 8 stages in `pair.ts` still
change *which pairs get scored at all* (structural pairing candidates) vs. which existed only to
keep hard-gated candidates out of `scoreMatch`'s view — the latter can likely collapse into fewer
stages since the cost model will rank a previously-hard-gated candidate honestly instead of
excluding it.

## (c) Migrate the injected-keys cache + inline duplicate detect/rescue (Decision 1 gap)

Two known gaps from Task 2's Decision 1 (re-splits of a recent foursome are a fresh lineup, not a
rematch) that the flag-ON path bypasses entirely rather than fixing at the source:

- **Injected recent-group-rematch keys cache** — built in
  `lib/next-round-suggester/live-preview.ts` (`getBlockedRecentGroupRematchKeys`, wired via
  `withRecentGroupRematchKeys` around the `suggestionStateForCourt` construction, roughly
  line ~4430 as of ALGO 51) and consumed in `lib/next-round-suggester/pair.ts` (~line 560, the
  `keys.add(getMatchGroupKey(...))` loop) and `score.ts`'s `hasRecentGroupRematch`. Under flag ON,
  `scoreMatch` returns before ever consulting this cache, so it's computed for nothing on every
  live-preview batch once the flag is permanent — dead CPU, and a trap for anyone who thinks it's
  still doing something. Delete the cache-building + injection once flag ON is permanent (or fold
  its still-useful signal, if any, into `computeQualityCost`'s repeat terms directly, keyed by
  partnership rather than player-set — see Decision 1 in `task-2-brief.md`).
- **Inline duplicate blowout/repeat detect + rescue** in `live-preview.ts`, roughly lines 4990–5060
  as of ALGO 51 (the `isBlowout` / `isRepeat` / `degradedReason` block feeding `findRescueCourts`
  inside the per-court suggestion loop). This recomputes blowout/repeat status from `pvnaDiff` and
  `getProjectedRepeatSummary` independently of the cost model's own `gap` / `maxProjectedMeeting`
  (`QualityCostResult`, see `quality-cost.ts`) — the same signal computed twice via two different
  code paths. Once flag ON is permanent, wire the wait-rescue degraded-reason detection off the
  cost result directly instead of recomputing it.

## (d) Retire the ~16 post-pass repairs the cost model subsumes

`live-preview.ts` runs a cascade of post-hoc repair passes over the suggested payload batch —
`repairEarlyPayloadBatchQuality(WithBeam)`, `repairRoundOnePayloadBatchWithCleanPool`,
`repairPayloadBatchRepeatExposure`, `repairPayloadBatchSevereRepeatFromPool`,
`repairPayloadBatchBlowoutFromPool`, `repairAllIdlePayloadBatchParticipation`, and their internal
helpers (`scorePayloadRepeatRepair`, `normalizeRepairedPayload`, the `shouldRepair*` gates), wired
together in `repairSuggestedPayloadBatch` (~line 2897) and its caller (~line 5328). These exist
because the old greedy/hard-gated model could produce a locally-valid-but-globally-bad batch (a
blowout, a severe repeat, an idle player) that only a second pass over the *whole* batch could
catch and fix. The cost model scores gap/repeat/gender/group holistically per-match already, which
should shrink (not necessarily zero out) the set of batch-level defects that need a second pass —
audit each repair pass against A/B data (does it still fire meaningfully under flag ON?) before
deleting; some (e.g. idle-participation repair) may be orthogonal to scoring and stay regardless.

## Suggested order

1. Confirm flag ON is permanent (A/B window closed, decision made — human call, tracked outside
   this repo).
2. (a) first — a green, flag-aware test suite is the safety net for everything else.
3. (d) next, informed by production `debug_dumps` (blowout/repeat/stuck rates) from the rollout —
   don't guess which repairs still matter.
4. (c) — the two Decision-1-gap items are self-contained and low-risk to remove once (a) is clean.
5. (b) last — the relaxation-stage simplification touches the most structural code and benefits
   most from (a)+(c)+(d) already having shrunk the surface area.
