# Execution Plan Supplement — Deployment & Integration

> Bổ sung cho EXECUTION_PLAN.md — các phần bị thiếu liên quan đến deploy.
> Làm sau khi hoàn thành Phase 5 của EXECUTION_PLAN.md.
> Cập nhật: 2026-06-14.

---

## Tổng quan những gì cần thêm

| Item | File | Ghi chú |
|------|------|---------|
| S.1 | DB migration | RLS policies cho `session_avoid_pairs` |
| S.2 | Edge function | Update request body schema nhận settings từ client |
| S.3 | UI | `useNextRoundModel` pass settings vào suggest call |
| S.4 | Edge function | CRUD routes cho avoid pairs |
| S.5 | Edge function | PVNA override route (chi tiết hơn Phase 5.3) |

Thứ tự: S.1 → S.2 + S.3 (song song) → S.4 → S.5

---

## S.1 — RLS Policies cho `session_avoid_pairs`

**File:** thêm vào migration đã tạo ở Phase 0.3

```sql
-- Enable RLS
ALTER TABLE session_avoid_pairs ENABLE ROW LEVEL SECURITY;

-- Host của session có thể đọc avoid pairs của session mình
CREATE POLICY "session_avoid_pairs_select"
  ON session_avoid_pairs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM sessions
      WHERE sessions.id = session_avoid_pairs.session_id
        AND sessions.host_id = auth.uid()
    )
  );

-- Host có thể thêm avoid pairs vào session mình
CREATE POLICY "session_avoid_pairs_insert"
  ON session_avoid_pairs FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM sessions
      WHERE sessions.id = session_avoid_pairs.session_id
        AND sessions.host_id = auth.uid()
    )
  );

-- Host có thể xóa avoid pairs của session mình
CREATE POLICY "session_avoid_pairs_delete"
  ON session_avoid_pairs FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM sessions
      WHERE sessions.id = session_avoid_pairs.session_id
        AND sessions.host_id = auth.uid()
    )
  );

-- Edge function (service role) bypass RLS — không cần policy riêng
```

> Kiểm tra tên column `host_id` trong table `sessions` — có thể là `created_by` hoặc `owner_id` tùy schema hiện tại. Đọc migration cũ trước khi copy.

---

## S.2 — Edge Function: Update Request Body Schema

**File:** `supabase/functions/session-live-matches-suggest/index.ts`

Đọc toàn bộ file này trước khi sửa. Tìm chỗ parse request body và chỗ gọi `mapRowsToSessionState()`.

**Thêm vào request body schema:**

```typescript
type SuggestRequestBody = {
  session_id: string
  // --- fields mới ---
  planned_total_rounds?: number       // từ effectiveTargetRounds của client
  court_preset?: 'balanced' | 'play_more' | 'relaxed'
  current_courts?: number             // courtCountOverride ?? recommended.courts
  avoid_pairs?: Array<{
    player_a: string
    player_b: string
    reason?: string
  }>
}
```

**Khi gọi `mapRowsToSessionState()`**, thêm `extraConfig`:

```typescript
const body = await req.json() as SuggestRequestBody

const state = mapRowsToSessionState(rows, roundHistory, {
  planned_total_rounds: body.planned_total_rounds,
  court_preset: body.court_preset,
  current_courts: body.current_courts,
  avoid_pairs: body.avoid_pairs,
})
```

> Tất cả fields đều optional — nếu client không truyền, behavior giống như trước (backward compatible).

---

## S.3 — UI: `useNextRoundModel` Pass Settings vào Suggest Call

**File:** `features/host/session-detail/next-round-v2/useNextRoundModel.ts`

Tìm chỗ gọi edge function suggest (search `session-live-matches-suggest` hoặc `supabase.functions.invoke`).

Thêm settings vào payload:

```typescript
const { data, error } = await supabase.functions.invoke(
  'session-live-matches-suggest',
  {
    body: {
      session_id: sessionId,
      // --- thêm vào ---
      planned_total_rounds: effectiveTargetRounds ?? undefined,
      court_preset: courtPreset,
      current_courts: courtCountOverride ?? courtCalculator.recommended.courts,
      avoid_pairs: avoidPairs,   // xem note bên dưới
    },
  },
)
```

**Về `avoidPairs`:** Cần load từ DB lúc init session (1 lần duy nhất), giữ trong state.

```typescript
// Trong useEffect init:
const { data: avoidPairsData } = await supabase
  .from('session_avoid_pairs')
  .select('player_a, player_b, reason')
  .eq('session_id', sessionId)

const [avoidPairs, setAvoidPairs] = useState<AvoidPair[]>(avoidPairsData ?? [])
```

Khi host thêm/xóa avoid pair → update cả DB lẫn local state để không cần reload.

---

## S.4 — Edge Function: CRUD Routes cho Avoid Pairs

**File:** `supabase/functions/session-live-matches-suggest/index.ts`

Đọc cách routing hiện tại trong file (có thể là switch trên `req.method` + URL path, hoặc dùng một router đơn giản).

**Thêm 2 routes:**

### POST `/session/:id/avoid-pairs` — Thêm avoid pair

```typescript
if (req.method === 'POST' && url.pathname.endsWith('/avoid-pairs')) {
  const { player_a, player_b, reason } = await req.json()

  // Đảm bảo constraint player_a < player_b
  const [a, b] = [player_a, player_b].sort()

  const { error } = await supabase
    .from('session_avoid_pairs')
    .upsert(
      { session_id, player_a: a, player_b: b, reason },
      { onConflict: 'session_id,player_a,player_b' },
    )

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  return new Response(JSON.stringify({ ok: true }), { status: 200 })
}
```

### DELETE `/session/:id/avoid-pairs` — Xóa avoid pair

```typescript
if (req.method === 'DELETE' && url.pathname.endsWith('/avoid-pairs')) {
  const { player_a, player_b } = await req.json()
  const [a, b] = [player_a, player_b].sort()

  const { error } = await supabase
    .from('session_avoid_pairs')
    .delete()
    .eq('session_id', session_id)
    .eq('player_a', a)
    .eq('player_b', b)

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  return new Response(JSON.stringify({ ok: true }), { status: 200 })
}
```

> Sort `[player_a, player_b]` trước khi insert/delete để match constraint `player_a < player_b` trong DB.

---

## S.5 — Edge Function: PVNA Override Route (chi tiết)

**File:** `supabase/functions/session-live-matches-suggest/index.ts`

Phase 5.3 của EXECUTION_PLAN đề cập route này nhưng chưa spec đủ. Thêm:

### POST `/session/:id/player/:player_id/pvna-override`

```typescript
if (req.method === 'POST' && url.pathname.includes('/pvna-override')) {
  const player_id = url.pathname.split('/').at(-2)  // segment trước 'pvna-override'
  const { effective_pvna } = await req.json()       // null = remove override

  // Validate: effective_pvna phải trong range hợp lý nếu không null
  if (effective_pvna !== null && (effective_pvna < 1.0 || effective_pvna > 6.0)) {
    return new Response(
      JSON.stringify({ error: 'effective_pvna must be between 1.0 and 6.0' }),
      { status: 400 },
    )
  }

  const { error } = await supabase
    .from('session_player_state')
    .update({ effective_pvna })
    .eq('session_id', session_id)
    .eq('player_id', player_id)

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  return new Response(JSON.stringify({ ok: true }), { status: 200 })
}
```

**Validation range 1.0–6.0:** dựa trên PVNA scale thực tế trong codebase (check `FALLBACK_NEWBIE_PVNA = 2.1` và max player PVNA trong data để confirm range phù hợp).

---

## Checklist Deploy

Sau khi hoàn thành tất cả items trên:

```
[ ] Migration chạy thành công (effective_pvna column + session_avoid_pairs table + RLS)
[ ] Edge function deploy với routes mới
[ ] Test POST /avoid-pairs → pair xuất hiện trong DB
[ ] Test DELETE /avoid-pairs → pair bị xóa
[ ] Test POST /pvna-override với giá trị hợp lệ → effective_pvna updated
[ ] Test POST /pvna-override với null → column về NULL
[ ] Test suggest call với planned_total_rounds = số vòng đã chơi → should_end: true
[ ] Test suggest call không có extra fields → behavior giống trước (backward compat)
```
