# Next Round Suggester Tests

Local, in-memory test suite for `lib/next-round-suggester`.

## Layers

- `unit`: module-level behavior for classify, select, pair, score, and commit.
- `property`: deterministic seeded random scenarios for core invariants.
- `scenario`: user-facing flows like late join, early leave, groups, gender prefs, and PVNA imbalance.
- `simulation`: multi-round session runs that measure fairness, diversity, and performance.

## Run

```bash
npm run test:suggester
npm run test:suggester:unit
npm run test:suggester:property
npm run test:suggester:scenario
npm run test:suggester:simulation
```

The suite does not need Supabase, network access, or environment variables. Random inputs are seeded so the same test run produces the same suggestions.
