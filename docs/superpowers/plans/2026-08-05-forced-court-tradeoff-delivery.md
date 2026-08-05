# Forced-Court Tradeoff — Plan 2: Delivery / Persistence

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Carry the engine's `forced_tradeoff` + `wait_rescue_options` (Plan 1) from the edge suggestion through DB persistence to the client's live-match rows, so the 3-way decision survives snapshot hydration / reload — reusing the existing degraded-fields + `suggestion_metadata` machinery.

**Architecture:** The edge already generates `forced_tradeoff`/`wait_rescue_options` on forced-court payloads (Plan 1, flag-gated). This plan persists them into the existing `session_live_matches.suggestion_metadata` jsonb column via a new best-effort sync RPC (mirroring `sync_live_suggestion_degraded_fields`), because the persist INSERT RPC does not write `suggestion_metadata`. The client already returns `suggestion_metadata` in its snapshot and already spreads it onto each row via `mergePersistedSuggestionMetadata` (`{ ...suggestion_metadata, ...row }`), so **no client mapping code is needed** — only a type declaration so `row.forced_tradeoff` / `row.wait_rescue_options` are typed. No repair-drop fix is needed: `normalizeRepairedPayload` and the repair/joint passes spread `{ ...payload }`, so the two new fields ride along (only `tradeoff_choices` is explicitly cleared, and that generic menu is removed in Plan 3).

**Tech Stack:** Postgres migration (SQL RPC), Supabase Edge (Deno/TS), client TS types, Jest for the client-side rehydration test.

## Global Constraints

- **Flag OFF = no-op:** with `SESSION_QUALITY_COST_MODEL` off, no court has `forced_tradeoff`, so nothing is synced and `suggestion_metadata` stays untouched — byte-identical persistence to today.
- **Best-effort, hint-only:** the metadata sync must never fail the suggest response (wrap in try/catch, no `live_state_version` bump), exactly like `sync_live_suggestion_degraded_fields`.
- **Migrations are immutable + sequential:** new numbered file, never edit merged ones.
- **Edge is Deno:** verify with `deno check supabase/functions/session-live-matches-suggest/index.ts`. Do NOT run jest for the edge.
- **Never run the simulation suite** (hangs). Client test runs the specific new file with `--runInBand`.
- **Deploy (migration apply + edge deploy) is the host's decision** — this plan builds + verifies locally; it does NOT deploy.

## Global interfaces (from Plan 1, already shipped)

Payload/engine fields (on `SuggestedMatchPayload`, set only for forced courts under the flag):
```ts
forced_tradeoff?: { acceptRepeat: { team_a: Team; team_b: Team }; acceptImbalance: { team_a: Team; team_b: Team } }
wait_rescue_options?: { court_idx: number; started_at: string | null }[]
```

---

### Task 1: Migration — `sync_live_suggestion_metadata` RPC

**Files:**
- Create: `supabase/migrations/20260805000010_sync_live_suggestion_metadata.sql`

**Interfaces:**
- Produces: `public.sync_live_suggestion_metadata(p_session_id uuid, p_fields jsonb) returns void` — for each `{ court_idx, suggestion_metadata }` entry, sets `session_live_matches.suggestion_metadata` on the currently-`suggested` row for that court, only when it differs. Hint-only: no version bump, no CAS.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260805000010_sync_live_suggestion_metadata.sql` (mirror `20260803000002_sync_live_suggestion_degraded_fields.sql`):

```sql
-- Sync the forced-court 3-way decision data (forced_tradeoff + wait_rescue_options) onto persisted
-- suggested rows, into the existing suggestion_metadata jsonb column. The INSERT-time persist RPC does
-- not write suggestion_metadata, and the board-wide/forced-court computation runs after; without this the
-- host's "Chờ / Chịu lặp / Chịu lệch" panel data never reaches the DB snapshot. Updates only rows that
-- differ (IS DISTINCT FROM). Hint-only: no live_state_version bump, no CAS — slight staleness is fine for
-- an advisory panel, matching sync_live_suggestion_degraded_fields.
create or replace function public.sync_live_suggestion_metadata(
  p_session_id uuid,
  p_fields jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.session_live_matches slm
  set suggestion_metadata = f.suggestion_metadata
  from (
    select
      (e.value ->> 'court_idx')::int as court_idx,
      case when jsonb_typeof(e.value -> 'suggestion_metadata') = 'object'
        then e.value -> 'suggestion_metadata' else null end as suggestion_metadata
    from jsonb_array_elements(coalesce(p_fields, '[]'::jsonb)) as e(value)
    where coalesce(e.value ->> 'court_idx', '') ~ '^-?[0-9]+$'
  ) f
  where slm.session_id = p_session_id
    and slm.status = 'suggested'
    and slm.court_idx = f.court_idx
    and slm.suggestion_metadata is distinct from f.suggestion_metadata;
end;
$$;

revoke all on function public.sync_live_suggestion_metadata(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.sync_live_suggestion_metadata(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Verify SQL parses**

Run: `npm run check:encoding` (confirms file is UTF-8) and eyeball against the mirrored `20260803000002` migration for structural parity. (No local DB apply in this plan; apply is the deploy step.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260805000010_sync_live_suggestion_metadata.sql
git commit -m "feat(migration): sync_live_suggestion_metadata RPC for forced-court decision persist"
```

---

### Task 2: Edge — persist `forced_tradeoff` + `wait_rescue_options` into `suggestion_metadata`

**Files:**
- Modify: `supabase/functions/session-live-matches-suggest/index.ts`

**Interfaces:**
- Consumes: the new `sync_live_suggestion_metadata` RPC (Task 1); `finalPreviewBoard` payloads carrying `forced_tradeoff`/`wait_rescue_options` (Plan 1).

- [ ] **Step 1: Add the metadata sync after the existing degraded sync**

In `index.ts`, immediately AFTER the existing `degradedSyncFields` block (the `try { ... await auth.supabase.rpc('sync_live_suggestion_degraded_fields', ...) } catch {}` around lines 1545-1567), add a parallel best-effort sync:

```ts
    // Persist the forced-court 3-way decision data (forced_tradeoff + wait_rescue_options) into
    // suggestion_metadata so the host panel survives snapshot hydration. Best-effort, hint-only — never
    // fail the suggest response. Only fires when a court is actually forced (flag-gated in the engine).
    try {
      const metadataSyncFields = (finalPreviewBoard as any[])
        .filter(m => m.status === 'suggested' && m.court_idx != null && m.forced_tradeoff)
        .map(m => ({
          court_idx: Number(m.court_idx),
          suggestion_metadata: {
            forced_tradeoff: m.forced_tradeoff,
            wait_rescue_options: Array.isArray(m.wait_rescue_options) ? m.wait_rescue_options : [],
          },
        }))
      if (metadataSyncFields.length > 0) {
        await auth.supabase.rpc('sync_live_suggestion_metadata', {
          p_session_id: sessionId,
          p_fields: metadataSyncFields,
        })
      }
    } catch (_metaSyncError) {
      // hint-only advisory sync; never block the response on it
    }
```

- [ ] **Step 2: deno check**

Run: `deno check supabase/functions/session-live-matches-suggest/index.ts`
Expected: clean (no type errors).

- [ ] **Step 3: Local replay verification (no deploy)**

Verify the sync payload is well-formed against a forced-court dump using a throwaway scratch script (reuse the `repro-tradeoff-gap.ts` loader): build the engine payloads for a forced court with the flag ON, confirm `payload.forced_tradeoff` is present and the `metadataSyncFields` mapping produces a valid `{ court_idx, suggestion_metadata: { forced_tradeoff, wait_rescue_options } }` object. Log it; delete the scratch after. (This checks the shape; the RPC write itself is exercised at deploy time.)

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/session-live-matches-suggest/index.ts
git commit -m "feat(edge): persist forced_tradeoff + wait_rescue_options via suggestion_metadata sync"
```

---

### Task 3: Client — type the fields + confirm generic rehydration

**Files:**
- Modify: the client `SessionLiveMatchRow`/`SuggestedLiveMatchRow` type (find it: `grep -rn "suggestion_metadata" features/host/session-detail/next-round-v2/preview.ts` and the shared row type it references)
- Test: `tests/host-live/forced-tradeoff-rehydrate.test.ts` (create; match an existing `tests/host-live/` test's setup)

**Interfaces:**
- Consumes: `mergePersistedSuggestionMetadata` (`features/host/session-detail/next-round-v2/preview-consistency.ts`) — already spreads `{ ...suggestion_metadata, ...row }`, so any `suggestion_metadata.forced_tradeoff` becomes `row.forced_tradeoff` for free.

- [ ] **Step 1: Add the fields to the client row type**

Add to the client `SuggestedLiveMatchRow`/`SessionLiveMatchRow` type (the same type that already declares `degraded_reason?`, `rescue_court_idxs?`, `suggestion_metadata?`):
```ts
  forced_tradeoff?: { acceptRepeat: { team_a: [string, string]; team_b: [string, string] }; acceptImbalance: { team_a: [string, string]; team_b: [string, string] } }
  wait_rescue_options?: { court_idx: number; started_at: string | null }[]
```

- [ ] **Step 2: Write the failing test**

Create `tests/host-live/forced-tradeoff-rehydrate.test.ts`:

```ts
import { mergePersistedSuggestionMetadata } from '../../features/host/session-detail/next-round-v2/preview-consistency'

describe('mergePersistedSuggestionMetadata — forced-court decision rehydration', () => {
  it('hydrates forced_tradeoff + wait_rescue_options from suggestion_metadata onto the row', () => {
    const row = {
      id: 'm1', court_idx: 2, status: 'suggested', team_a: ['a', 'b'], team_b: ['c', 'd'],
      suggestion_metadata: {
        forced_tradeoff: {
          acceptRepeat: { team_a: ['a', 'c'], team_b: ['b', 'd'] },
          acceptImbalance: { team_a: ['a', 'b'], team_b: ['c', 'd'] },
        },
        wait_rescue_options: [{ court_idx: 3, started_at: '2026-08-05T07:00:00Z' }],
      },
    }
    const merged = mergePersistedSuggestionMetadata(row) as typeof row & {
      forced_tradeoff?: { acceptRepeat: unknown; acceptImbalance: unknown }
      wait_rescue_options?: { court_idx: number }[]
    }
    expect(merged.forced_tradeoff?.acceptRepeat).toEqual({ team_a: ['a', 'c'], team_b: ['b', 'd'] })
    expect(merged.wait_rescue_options).toEqual([{ court_idx: 3, started_at: '2026-08-05T07:00:00Z' }])
    // row's own fields still win over metadata (no clobber)
    expect(merged.court_idx).toBe(2)
  })

  it('leaves the fields undefined when suggestion_metadata has none (flag-OFF / clean court)', () => {
    const row = { id: 'm2', court_idx: 0, status: 'suggested', team_a: ['a', 'b'], team_b: ['c', 'd'], suggestion_metadata: null }
    const merged = mergePersistedSuggestionMetadata(row) as any
    expect(merged.forced_tradeoff).toBeUndefined()
    expect(merged.wait_rescue_options).toBeUndefined()
  })
})
```

- [ ] **Step 3: Run to verify fail then pass**

Run: `npx jest tests/host-live/forced-tradeoff-rehydrate.test.ts --runInBand`
Expected: with the type added and `mergePersistedSuggestionMetadata` unchanged, the test PASSES immediately (the merge is already generic) — this test is a regression guard proving the rehydration path works for the new fields. If it fails, the merge spread order is wrong; investigate before proceeding. (Write the test first and run it to confirm it exercises the real function, per TDD discipline.)

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck:guard`
Expected: no new errors in the touched client files.

- [ ] **Step 5: Commit**

```bash
git add tests/host-live/forced-tradeoff-rehydrate.test.ts <the client type file>
git commit -m "feat(host-live): type forced_tradeoff/wait_rescue_options + rehydration guard test"
```

---

## Self-Review

**Spec coverage:** Task 1 = persistence vehicle (spec §Architecture layer 2: "the two-endpoint payload goes into suggestion_metadata written at persist time"). Task 2 = edge writes it (best-effort sync, matching the degraded pattern). Task 3 = client receives it (types + the already-generic `mergePersistedSuggestionMetadata`). The spec's "fix the drop at 3009" is intentionally NOT needed for these fields (they survive the `{...payload}` spread; only `tradeoff_choices` was explicitly cleared, and that menu is removed in Plan 3) — noted in Architecture.

**Placeholder scan:** Task 2 Step 3 (scratch replay) is a shape-check described against the existing `repro-tradeoff-gap.ts` loader; Task 3 Step 1 references "find the client row type" with a concrete grep — deliberate (the exact type file is located during implementation), assertions are concrete. No TBD.

**Type consistency:** `forced_tradeoff` / `wait_rescue_options` shapes are identical across the migration jsonb, the edge sync payload, the client type, and the test. `mergePersistedSuggestionMetadata`'s `{ ...suggestion_metadata, ...row }` order preserves row-field precedence (asserted in the test).
