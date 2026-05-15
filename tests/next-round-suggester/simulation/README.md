# Phase A Simulation Suite

Local, in-memory simulations for the next-round suggester and fairness layer.

## Commands

```bash
npm run sim:sanity
npm run sim:targets
npm run sim:ab
npm run sim:stress
npm run sim:full
npm run sim:report
```

`sim:sanity` is the fast regression pass. `sim:ab` and `sim:stress` are longer
manual checks for corrector comparisons and n=40 edge cases.

`sim:report` generates a standalone HTML report in `simulation-reports/`.
It also writes the raw `SimulationResult` next to the HTML as `.json`.
Default:

```bash
npm run sim:report
```

This runs the real 40-player fixture from the provided session JSON, using PVNA
as the engine score. Synthetic scenarios also generate PVNA-scale values
(`tight`, `wide`, `extreme`, `bimodal`) and use a PVNA team-diff tolerance of
`0.35`.

You can also pass a baseline scenario and seed:

```bash
npm run sim:report -- medium_16 7
```

## Files

- `generators.ts`: deterministic players, genders, groups, preferences.
- `runner.ts`: runs a full synthetic session round by round.
- `scenarios.ts`: baseline scenario configs and targets.
- `analysis.ts`: multi-seed aggregation and corrector A/B comparison.
- `reporter/`: standalone HTML report generator.

## Report Checks

The HTML report includes:

- fairness breakdown and evolution
- per-player PVNA/match/diversity table
- partner/opponent pair-history heatmaps
- round-by-round matches and resting players
- engine warnings
- adjustment timeline with score before, score after, delta, config changes, and tier override count

All runs are deterministic by `seed` and do not touch Supabase.
