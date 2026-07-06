# PickleMatch Web Codebase Map

This repo is an Expo Router / React Native Web app for pickleball sessions, with Supabase as the database, auth provider, RPC layer, and Edge Function runtime.

## High-Level Shape

```mermaid
flowchart TD
  Routes["app/\nExpo Router screens"] --> Features["features/\nPlayer, Host, Auth UI"]
  Features --> Lib["lib/\nShared domain logic, hooks, clients"]
  Features --> SupabaseClient["lib/supabase.ts\nSupabase JS client"]
  SupabaseClient --> DB["Supabase Postgres\nTables, RLS, RPCs"]
  Features --> Edge["supabase/functions/*\nEdge Functions"]
  Edge --> DB
  Edge --> Suggester["lib/next-round-suggester\nPure scheduling engine"]
  Tests["tests/\nUnit, scenario, simulation, e2e"] --> Lib
  Tests --> Features
```

## Main Frontend Areas

```mermaid
flowchart LR
  Root["app/_layout.tsx\nProviders + AuthGate"] --> Auth["app/(auth)\nlogin, onboarding, profile setup"]
  Root --> PlayerHub["app/player-hub\nplayer routes"]
  Root --> Host["app/host\nhost routes"]

  PlayerHub --> PlayerFeatures["features/player\nhome, find session, my sessions,\nprofile, session details, results"]
  Host --> HostFeatures["features/host\ncourt/session management,\ncheck-in, roster, match control"]
  HostFeatures --> NRV2["features/host/session-detail/next-round-v2\nlive next-round UI model"]
```

## Next-Round / Live Match Flow

This is the most sophisticated part of the app.

```mermaid
sequenceDiagram
  participant HostUI as Host NextRound V2 UI
  participant Model as useNextRoundModel
  participant API as next-round-v2/api.ts
  participant Fn as session-live-matches-suggest
  participant Engine as lib/next-round-suggester
  participant DB as Supabase DB/RPC

  HostUI->>Model: read live state, roster, rounds, settings
  Model->>API: fetchLiveMatchesPreview(...)
  API->>Fn: POST Edge Function with local rows
  Fn->>Engine: mapRowsToSessionState + buildSuggestedMatchPayloads
  Engine-->>Fn: candidate matches, fairness warnings, debug events
  Fn-->>API: final_preview_board + diagnostics
  API-->>Model: preview payloads
  Model-->>HostUI: suggested/live/completed court lanes
  HostUI->>API: start / complete / cancel / check-in
  API->>DB: RPC or Edge Function mutation
```

## Important Directories

| Path | Role |
|---|---|
| `app/` | File-based routes. Mostly thin route wrappers around feature screens. |
| `features/player/` | Player-facing flows: home feed, find session, profile, session details, reviews/results. |
| `features/host/` | Host-facing flows: dashboard, court management, session detail, roster, check-in, live match controls. |
| `features/host/session-detail/next-round-v2/` | UI/model layer for live next-round board: queries, mutations, court lanes, preview, sheets, controls. |
| `lib/next-round-suggester/` | Pure scheduling engine: state mapping, player selection, pairing, scoring, fairness, live preview, commit/history. |
| `lib/court-calculator/` | Court capacity, preset, feasibility, and warning calculations. |
| `supabase/functions/` | Edge Functions for live session actions, roster sync, fairness, summaries, ratings, and rest requests. |
| `supabase/migrations/` | Database schema, RLS, RPCs, live-session tables, debug/instrumentation migrations. |
| `tests/next-round-suggester/` | Deep engine coverage: unit, property, scenario, fairness, and simulation tests. |
| `tests/e2e-ui/` | Playwright web UI coverage. |

## Core Concepts

| Concept | Source Of Truth |
|---|---|
| Auth/session client | `lib/supabase.ts`, `lib/useAuth.ts` |
| Global providers | `app/_layout.tsx` |
| Host session detail | `features/host/session-detail/HostSessionDetailScreen.tsx` |
| Next round screen | `features/host/session-detail/NextRoundSuggesterScreenV2.tsx` |
| Live round model | `features/host/session-detail/next-round-v2/useNextRoundModel.ts` |
| Live function API wrapper | `features/host/session-detail/next-round-v2/api.ts` |
| Suggester state model | `lib/next-round-suggester/types.ts`, `state.ts` |
| Match generation | `lib/next-round-suggester/suggest.ts`, `pair.ts`, `score.ts`, `select.ts` |
| Fairness | `lib/next-round-suggester/fairness/*` |
| Live preview building | `lib/next-round-suggester/live-preview.ts` |
| Preview Edge Function | `supabase/functions/session-live-matches-suggest/index.ts` |

## Database / Backend Shape

```mermaid
flowchart TD
  Migrations["supabase/migrations\nschema + RLS + RPCs"] --> Tables["Postgres tables\nsessions, session_players,\nsession_player_state,\nsession_live_matches,\nsession_rounds,\npair history, settings"]
  Migrations --> RPC["RPCs\nversioned start/end/checkin/checkout,\nrepair, sync, summaries"]
  EdgeFunctions["supabase/functions"] --> RPC
  EdgeFunctions --> Tables
  Client["React Native app"] --> RPC
  Client --> EdgeFunctions
  Client --> Tables
```

Recent active migration work includes debug/instrumentation support:

- `debug_dumps.chosen_matches`
- `debug_dumps.pvna_tolerance`
- `debug_dumps.rounds`
- `engine_instrumentation` table with authenticated insert policy

Replay/audit model for live-lane stabilization:

- `debug_dumps.payload` is the replay source of truth for reconstructing a live suggestion request.
- `session_audit_events` is the timeline/index layer that links client preview attempts, edge requests, and outcomes by request IDs.
- `engine_instrumentation` stores lightweight engine-side events for search pressure and fallback diagnostics.
- When `VERIFY_DUMP=1`, `session-live-matches-suggest` should register debug dump writes with `EdgeRuntime.waitUntil` so a returned response does not race the replay capture.

## Testing Strategy

```mermaid
flowchart LR
  Unit["unit\nmodule behavior"] --> Engine["next-round-suggester"]
  Property["property\nseeded invariants"] --> Engine
  Scenario["scenario\nlate join, early leave,\ngroups, gender prefs"] --> Engine
  Simulation["simulation\nmulti-round fairness + performance"] --> Engine
  E2E["e2e-ui\nhost session flows"] --> App["Expo web app"]
```

Useful commands:

```bash
npm run typecheck
npm run test:suggester
npm run test:suggester:unit
npm run test:suggester:fairness
npm run test:suggester:simulation
npm run build:web
```

## Mental Model

The app has two broad products inside one codebase:

1. Player marketplace: find, join, review, and manage pickleball sessions.
2. Host operations console: create/manage sessions, check players in, run live matches, and optimize next-round pairings.

The host live-match system is where most complexity lives. The frontend keeps a rich local model of live rows, settings, and optimistic mutations. Preview generation is delegated to a Supabase Edge Function, but that function mostly runs pure TypeScript from `lib/next-round-suggester`, which makes the scheduling engine highly testable without Supabase.
