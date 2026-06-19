# PickleMatch Web — CLAUDE.md

## Stack

- **Framework:** Expo (React Native + Web), Expo Router v2 file-based routing
- **Language:** TypeScript (strict mode), path alias `@/*` → project root
- **Backend:** Supabase — Postgres + Auth + Edge Functions (Deno/TypeScript)
- **Styling:** NativeWind (Tailwind for React Native) + Tailwind CSS on web
- **State / data:** React Query (`@tanstack/react-query`), Supabase client
- **Testing:** Jest + jest-expo (unit/integration), Playwright (e2e web)
- **Linting:** ESLint with `eslint-config-expo/flat` and `@typescript-eslint`

## Directory layout

```
app/                  Expo Router file-based routes (screens)
components/           Shared UI components
features/             Feature-specific screens & logic (e.g. host/session-detail)
lib/                  Pure domain logic (no React)
  next-round-suggester/   Core suggestion algorithm
  i18n/               i18next setup + translations
  eloSystem.ts        ELO rating logic
supabase/
  functions/          Edge Functions (Deno, separate TS config, excluded from main tsc)
  migrations/         SQL migrations (numbered, immutable)
tests/
  next-round-suggester/   unit/, property/, scenario/, simulation/, fairness/
  e2e/                Playwright tests
scripts/              One-off scripts, run with `tsx` or `node`
scratch/              Throwaway benchmarks, not linted
```

## Commands

```bash
# Dev
npm run start              # Expo dev server
npm run web                # Web only

# Tests
npm test                   # All Jest tests
npm run test:suggester     # Suggester tests only
npm run test:suggester:unit
npm run sim                # Simulation sanity + targets
npm run sim:ab             # A/B comparison (slow, 15 min)

# Type checking
npm run typecheck          # tsc --noEmit
npm run typecheck:guard    # Fails if new errors vs baseline
npm run typecheck:baseline # Update baseline

# Lint
npm run lint               # All files
npm run lint:errors        # Errors only

# Edge functions (from supabase/functions/)
# supabase functions serve <name> --env-file .env.server

# Misc checks
npm run check:encoding     # Detect non-UTF-8 files
npm run check:secrets      # No secrets committed
npm run check:artifacts    # No temp artifacts
```

## TypeScript conventions

- `supabase/functions/` is **excluded** from the main `tsconfig.json` — functions have their own TS environment (Deno)
- `scratch/` and `tests/` are also excluded from main tsconfig
- Use `@/` imports (not relative `../..`) for files across feature boundaries
- No file extensions in TS import paths (e.g. `import { foo } from '@/lib/bar'`, not `bar.ts`)
- When adding types to `lib/next-round-suggester/types.ts`, keep `PlayerSessionState`, `SessionState`, and DB row types in sync

## Testing conventions

- Test files live in `tests/` (not colocated), matching Jest config `testMatch`
- Suggester test categories: `unit/` (pure logic), `property/` (invariants), `scenario/` (scripted sessions), `simulation/` (full 8–12 round sessions), `fairness/` (metrics correctness)
- Simulations use seeded random via `seedrandom` — keep seeds stable
- Mock setup in `tests/jest.setup.ts` and `tests/mocks/nativewind.js`

## Next Round Suggester — algorithm overview

Core pipeline (all in `lib/next-round-suggester/`):

```
state.ts → suggest.ts → pair.ts → score.ts → select.ts
                 ↓
          classify.ts (tiers: MUST_PLAY / PLAY / REST / MUST_REST)
                 ↓
       fairness/metrics.ts → fairness/detector.ts
```

Key files:
- `types.ts` — shared types, incl. `PlayerSessionState`, `SessionState`, `AvoidPair`
- `suggest.ts` — orchestrator: 4-pass collection (A strict, C relax skill, B repeat-ok, D open)
- `pair.ts` — 8-stage PVNA/intra-group relaxation
- `score.ts` — match scoring with partner/opponent penalties
- `classify.ts` — tier classification + dynamic thresholds
- `select.ts` — priority sort with `comparePlayersByPriority`
- `avoid.ts` — bidirectional avoid-pair enforcement
- `live-preview.ts` — preview compute; bump `LIVE_PREVIEW_ALGORITHM_VERSION` on deploy
- `fairness/metrics.ts` — `computeSessionFairness()`, diversity, rest scores
- `fairness/detector.ts` — warning/issue detector

Active branch: `feat-next-match-suggester`. Algorithm version constant lives in `live-preview.ts` — increment before deploying a quality change.

## Supabase Edge Functions

- Runtime: Deno (TypeScript), in `supabase/functions/<name>/index.ts`
- Shared code: `supabase/functions/_shared/`
- Each function is a standalone HTTP handler — no cross-function imports
- Migrations: sequential numbered SQL files in `supabase/migrations/`, never edit after merging

## Code style

- No comments unless the WHY is non-obvious
- No multi-line docstrings
- No backwards-compatibility shims for removed code — delete it
- No error handling for scenarios that can't happen inside trusted domain code
- Prefer editing existing files over creating new ones
- Validate only at system boundaries (user input, Supabase responses, edge function requests)

---

# Session & Context Management

## Rules (always follow, no exceptions)

At the START of every session:
1. Check if TASK.md exists in project root
2. If yes → read it, summarize status in 3-5 lines, then proceed
3. If no → ask: "No TASK.md found. What are we working on today?"

During the session:
- After completing each sub-task, update TASK.md immediately
- If you discover a gotcha, workaround, or key decision → append to SCRATCHPAD.md
- Never let more than ~20 turns pass without offering: "Context is getting long — want me to update TASK.md and clear?"

At the END of every session (when user says "done", "stop", "wrap up", "end session"):
1. Update TASK.md with completed items, current status, and next steps
2. Move any new gotchas/decisions to SCRATCHPAD.md
3. Confirm: "TASK.md updated. Safe to /clear or close session."

---

## TASK.md format

```
## Task: [name]
Status: IN PROGRESS | BLOCKED | DONE

### Completed
- [x] item

### In progress
- [ ] item — current state, edge cases

### Next steps
- [ ] item

### Key decisions
- decision and rationale

### Files touched
file1, file2
```

---

## SCRATCHPAD.md format

```
## Gotchas
- issue and fix

## Rejected approaches
- approach — why rejected

## Open questions
- question
```

---

## Token discipline

- Only read files explicitly needed for the current sub-task
- When asked to investigate a bug, read the specific file/function first before exploring broadly
- Prefer partial reads (limit to relevant lines) over full file reads
- If context feels heavy, say so and suggest /clear after updating TASK.md
