# Kế hoạch Refactor — Next Round Suggester

> Tổng hợp từ session review ngày 2026-06-13. Cập nhật lần cuối: 2026-06-14 (sau review codebase thực tế).
> Toàn bộ là plan — chưa có code nào được thay đổi.

---

## Prompt để Execute

Dùng prompt này khi bắt đầu session implement:

```
Đọc REFACTOR_PLAN.md ở root project trước khi làm bất kỳ thứ gì.

Yêu cầu thực thi:

1. Bắt đầu từ Phase 0 trước khi làm bất kỳ thứ gì khác. Mỗi phase phải hoàn thành
   và pass tests trước khi sang phase tiếp theo.

2. Trước khi sửa một function, đọc toàn bộ function đó trong file thực tế — không
   dựa vào assumptions. Code trong plan là định hướng, không phải copy-paste.
   Nếu code thực tế khác với mô tả trong plan, ưu tiên theo code thực tế.

3. Sau mỗi item hoàn thành: chạy typecheck để đảm bảo không có type error.

4. Sau mỗi phase hoàn thành: chạy toàn bộ test suite trong
   tests/next-round-suggester/. Nếu có test fail, fix trước khi sang phase tiếp
   theo — không bỏ qua.

5. Không làm nhiều item cùng lúc nếu chúng có dependency vào nhau trong cùng file.
   Làm tuần tự.

6. Sau khi hoàn thành toàn bộ một phase: bump LIVE_PREVIEW_ALGORITHM_VERSION
   trong lib/next-round-suggester/live-preview.ts.

7. Lưu ý một số điểm đặc biệt trong plan:
   - rounds_available: KHÔNG cần DB migration, derive từ round history trong
     mapRowsToSessionState()
   - Pass order (Phase 2.2): B/C/D chỉ chạy khi A empty — lazy eval pattern,
     sửa đúng theo cấu trúc hiện tại
   - getMediumPvnaTolerance() (Phase 2.1): function mới cần tạo, khác với
     getSoftPvnaTolerance() đã có sẵn
   - getPvna() (Phase 5.3): function đã có ở score.ts:64, chỉ cần modify,
     không tạo mới

8. Bắt đầu bằng Phase 0.1 (types.ts). Báo cáo những gì sẽ thay đổi trước khi
   thực sự sửa.
```

---

## Dependency Graph

```
Phase 0 (Types + State)
    ├── Phase 1 (Bug fixes)
    ├── Phase 2 (Algorithm core)   ← cần getBenchDepth, getSessionPhase
    │       └── Phase 3 (Groups)   ← cần thresholds từ Phase 2
    │               └── Phase 4 (Fairness) ← cần cross/intra split từ Phase 3
    └── Phase 5 (New features)     ← cần avoid_ids, planned_total_rounds
            └── Phase 6 (Detector) ← cần Phase 3 + Phase 5.1
```

Phase 1 và Phase 5 có thể chạy song song sau khi Phase 0 xong.

---

## Priority Matrix

| Priority | Phase.Item | Ghi chú |
|----------|-----------|---------|
| Critical | 1.1 | Partner overflow bug — group bị block sau 3 trận |
| Critical | 1.2 | Intra-group repeat weight = 0 |
| High | 1.3 | Late arrival MUST_PLAY ngay vòng đầu |
| High | 1.4 + 1.5 | Warmup rest freeze + rest score context-aware |
| High | 2.1 | Relaxation stage order (interleave intra + pvna) |
| High | 2.2 | Pass order A→C→B→D |
| High | 2.3 | Dynamic thresholds (mustRest, mustPlay, repeatCap) |
| High | 3.1–3.4 | Group handling overhaul |
| Medium | 4.1–4.5 | Fairness score overhaul |
| Medium | 5.1 | Avoid preference system |
| Medium | 5.2 | Session-end mode |
| Low | 5.3 | PVNA host override |
| Low | 5.4 | Partial round suggestion |
| Low | 6.x | Detector improvements |

---

## Phase 0 — Nền tảng: Types & State Layer

### 0.1 `lib/next-round-suggester/types.ts`

Thêm vào `PlayerSessionState`:
```typescript
rounds_available: number       // số vòng player có mặt kể từ check-in
effective_pvna?: number        // PVNA do host override cho session này
avoid_ids?: Set<string>        // player IDs cần tránh ghép (bidirectional)
```

Thêm vào `SessionState.config`:
```typescript
planned_total_rounds?: number
session_phase?: 'warmup' | 'mid' | 'closing'  // derived, không lưu DB
```

Thêm vào `SessionPlayerStateRow`:
```typescript
// rounds_available KHÔNG cần DB column — xem Phase 0.2 bên dưới
effective_pvna?: number | null
```

Thêm vào `HostRestRequest`:
```typescript
reason?: 'voluntary' | 'system'
```

Type mới:
```typescript
export type AvoidPair = {
  player_a: string
  player_b: string
  reason?: 'conflict' | 'skill_gap' | 'preference'
}
```

Thêm vào `SessionConfig`:
```typescript
avoid_pairs?: AvoidPair[]
```

### 0.2 `lib/next-round-suggester/state.ts`

- `mapRowsToSessionState`: tính `rounds_available` **từ round history** — `computeAvailabilityMetrics()` đã làm việc này (field `per_player[].rounds_available`). Tuy nhiên cần expose lên `PlayerSessionState` để `classifyPlayer()` dùng được. Cách đơn giản nhất: tính trong `mapRowsToSessionState()` bằng cách đếm số completed rounds mà player có mặt trong roster (dựa vào `round.resting` và `round.matches`). **Không cần DB column**.
- `mapRowsToSessionState`: load `effective_pvna` từ DB, populate `avoid_ids` từ config
- Helper mới `getEffectivePvna(player)`: `player.effective_pvna ?? player.pvna`
- `buildRestPatch`: khi `opted_rest === false && reason === 'voluntary'` → thêm `consecutive_rest: 0`
- Helper mới `getSessionPhase(state)`: `warmup` nếu completed < 3, `closing` nếu planned - completed <= 2, else `mid`
- Helper mới `getBenchDepth(state)`: `max(0, activePlayers - courts * 4)`

### 0.3 DB Migration

```sql
-- rounds_available KHÔNG cần column riêng — được derive từ round history trong code
ALTER TABLE session_player_state
  ADD COLUMN effective_pvna NUMERIC(4,2) NULL;

CREATE TABLE IF NOT EXISTS session_avoid_pairs (
  session_id UUID NOT NULL REFERENCES sessions(id),
  player_a UUID NOT NULL,
  player_b UUID NOT NULL,
  reason TEXT,
  PRIMARY KEY (session_id, player_a, player_b)
);
```

---

## Phase 1 — Critical Bug Fixes

### 1.1 `score.ts` — Intra-group partner overflow cap → Infinity

Function `getProjectedRepeatSummary()`:
```typescript
// Trước: sameGroup ? MAX_PROJECTED_PARTNER_PAIR_COUNT + 1 : MAX_...
// Sau:
const partnerThreshold = sameGroup ? Infinity : MAX_PROJECTED_PARTNER_PAIR_COUNT
```

### 1.2 `score.ts` — Tách intra-group repeat weights

```typescript
export const RECENT_INTRA_GROUP_PARTNER_REPEAT_WEIGHT = 0  // group muốn chơi cùng
export const RECENT_INTRA_GROUP_OPPONENT_REPEAT_WEIGHT = 1 // vs current RECENT_OPPONENT_REPEAT_WEIGHT = 4
```

Trong `scoreMatch()`: check sameGroup trước khi apply weight. Dùng `getEffectivePvna()` thay `player.pvna` ở tất cả PVNA comparisons.

### 1.3 `classify.ts` — Late arrival nhận MUST_PLAY ngay vòng đầu

Trong `classifyPlayer()`, thêm sau check `consecutive_rest >= 1`:
```typescript
if (player.matches_played === 0 && player.rounds_available >= 1) return Tier.MUST_PLAY
```

### 1.4 `metrics.ts` — Freeze rest score trong warmup

```typescript
// Trước: rest: computeRestScore(rest)
// Sau:
rest: isWarmup ? 20 : computeRestScore(rest, getBenchDepth(state))
```

### 1.5 `metrics.ts` — `computeRestScore` nhận bench_depth

```typescript
function computeRestScore(metrics, benchDepth: number): number {
  if (metrics.violations.length === 0) return 20
  const penaltyPerViolation = Math.max(3, 7 - Math.floor(benchDepth / 2))
  return Math.max(0, 20 - metrics.violations.length * penaltyPerViolation)
}
```

---

## Phase 2 — Algorithm Core

_Phụ thuộc: Phase 0_

### 2.1 `pair.ts` — Interleave relaxation stages trong `bestPartitioning()`

Rewrite 9 stages thành 8 stages — không bao giờ `intra=∞` trước khi thử `pvna × 1.5`:

```
Stage 1: intra ≤ 0.75,  pvna ≤ config                     (strict)
Stage 2: intra ≤ 1.0,   pvna ≤ config                     (nới intra nhẹ)
Stage 3: intra ≤ 0.75,  pvna ≤ getMediumPvnaTolerance()   (nới pvna nhẹ) ← MỚI
Stage 4: intra ≤ 1.0,   pvna ≤ getMediumPvnaTolerance()   (cả hai vừa)   ← MỚI
Stage 5: intra ≤ 1.0,   pvna ≤ getSoftPvnaTolerance()
Stage 6: intra = ∞,     pvna ≤ getMediumPvnaTolerance()   (drop intra)   ← MỚI
Stage 7: intra = ∞,     pvna ≤ getSoftPvnaTolerance()
Stage 8: intra = ∞,     pvna = ∞                          (open)
```

Xóa stage cũ `intra=∞, pvna≤config` (tạo ra [2.5,4.5] vs [3.0,4.0] — xấu xã hội).

**Thêm helper mới trong `pair.ts`** (bên cạnh `getSoftPvnaTolerance()` đã có):
```typescript
// getSoftPvnaTolerance() hiện tại: max(1.0, config × 2)  — MIN_SOFT_PVNA_TOLERANCE = 1.0
function getMediumPvnaTolerance(state: SessionState): number {
  return Math.max(0.75, state.config.pvna_tolerance * 1.5)
}
```

### 2.2 `suggest.ts` — Đổi thứ tự 4 pass

**Quan trọng về cấu trúc thực tế** (lines 597–601): Pass B, C, D chỉ chạy khi `alternatives.length === 0` sau Pass A — lazy evaluation, không phải all-4. Fix vẫn apply theo cùng pattern:

```typescript
// Trước:
collectAlternatives(false, false)  // A
if (alternatives.length === 0 && !timedOut()) {
  collectAlternatives(false, true)   // B: strict + repeat_ok  ← sai thứ tự
  if (!timedOut()) collectAlternatives(true, false)   // C
  if (!timedOut()) collectAlternatives(true, true)    // D
}

// Sau:
collectAlternatives(false, false)  // A: strict + no_repeat
if (alternatives.length === 0 && !timedOut()) {
  collectAlternatives(true, false)   // C: relax + no_repeat  ← nới skill trước
  if (!timedOut()) collectAlternatives(false, true)   // B: strict + repeat_ok
  if (!timedOut()) collectAlternatives(true, true)    // D: open
}
```

### 2.3 `classify.ts` + `score.ts` — Dynamic thresholds

Helper mới trong `classify.ts`:
```typescript
export type DynamicThresholds = {
  mustRestAt: number
  mustPlayAt: number
  partnerRepeatCap: number
  opponentRepeatCap: number  // luôn = partnerCap + 1
  rematchBlockRounds: number
}

export function computeDynamicThresholds(benchDepth: number, N: number): DynamicThresholds {
  return {
    mustRestAt: Math.max(2, 1 + Math.ceil(benchDepth / 2)),
    mustPlayAt: Math.max(1, Math.ceil(benchDepth / 3)),
    partnerRepeatCap: Math.max(2, Math.ceil(N / 6)),
    opponentRepeatCap: Math.max(3, Math.ceil(N / 6) + 1),
    rematchBlockRounds: N <= 10 ? 1 : 2,
  }
}
```

`PlayerClassificationContext` thêm `thresholds?: DynamicThresholds`. `suggestNextRound()` compute và thread thresholds vào `classifyPlayer()`, `hasRepeatOverflow()`, `bestPartitioning()`.

**Cũng cần fix `getConsecutivePlayPenalty()` trong `score.ts` (line 55)** — hiện hardcode `if (consecutive >= 2)`. Cần nhận `mustRestAt` từ thresholds:
```typescript
// Trước: if (consecutive >= 2)
// Sau:   if (consecutive >= mustRestAt)  — pass qua options của scoreMatch()
```

### 2.4 `score.ts` — Dynamic rematch constants

**`RECENT_GROUP_REMATCH_BLOCK_ROUNDS`** (hiện = 2, dùng trong `hasRecentGroupRematch()`):
```typescript
export function getRematchBlockRounds(N: number): number {
  return N <= 10 ? 1 : 2
}
```

**`RECENT_GROUP_NEAR_REMATCH_MIN_OVERLAP`** (hiện = 3, hardcoded ở line 31) — cũng cần dynamic. Với N nhỏ, overlap=3 fires quá thường xuyên:
```typescript
export function getNearRematchMinOverlap(N: number): number {
  return N <= 8 ? 4 : 3  // N nhỏ → cần overlap cao hơn để block
}
```

Cập nhật tất cả call sites trong `pair.ts` và `score.ts`. Thêm cả hai vào `DynamicThresholds`.

---

## Phase 3 — Group Player Handling

_Phụ thuộc: Phase 0, Phase 1.1 + 1.2_

### 3.1 `metrics.ts` — Tách intra/cross-group trong diversity

`computePartnerDiversity()` và `computeOpponentDiversity()` thêm fields:
```typescript
cross_group_repeat_pairs: RepeatPair[]   // dùng cho scoring/burden
intra_group_repeat_pairs: RepeatPair[]   // informational only
```

`avg_diversity_ratio` tính trên cross-group only:
- numerator = cross_group_unique_partners
- denominator = matches_played - intra_group_partner_matches

### 3.2 `metrics.ts` — `isBurdenRepeat()` group fix

```typescript
function isBurdenRepeat(player, other, count, type: 'partner' | 'opponent' = 'opponent'): boolean {
  if (count <= 1) return false
  const sameGroup = player?.group_id && player.group_id === other?.group_id
  if (type === 'partner' && sameGroup) return false  // không bao giờ burden
  if (sameGroup) return count > 4                    // opponent group: threshold cao
  return count >= 2
}
```

### 3.3 `metrics.ts` — Active-only repeat counting

```typescript
function getActiveRepeatCount(player, otherId, state, type): number {
  const other = state.players.get(otherId)
  if (!other || other.checked_out_at !== null) return 0  // departed → bỏ qua
  return type === 'partner'
    ? (player.partner_counts.get(otherId) ?? 0)
    : (player.opponent_counts.get(otherId) ?? 0)
}
```

Dùng ở `computePartnerDiversity()`, `computeOpponentDiversity()`, `computeOpponentRepeatBurden()`.

### 3.4 `state.ts` — Nullify group khi partner departed

```typescript
export function getActiveGroupId(player: PlayerSessionState, state: SessionState): string | null {
  if (!player.group_id) return null
  const hasActiveGroupMember = [...state.players.values()].some(
    other =>
      other.player_id !== player.player_id &&
      other.group_id === player.group_id &&
      other.checked_out_at === null,
  )
  return hasActiveGroupMember ? player.group_id : null
}
```

Dùng `getActiveGroupId()` thay `player.group_id` trực tiếp trong `score.ts` và `metrics.ts`.

### 3.5 `metrics.ts` — `group_satisfaction` informational metric

Thêm vào output `computeSessionFairness()` (không tính vào total score):
```typescript
group_satisfaction: {
  total_groups: number
  groups_played_together: number  // ít nhất 1 lần
  rate: number
}
```

---

## Phase 4 — Fairness System Overhaul

_Phụ thuộc: Phase 0, Phase 3_

### 4.1 `metrics.ts` — Diversity ratio normalization

```typescript
function computeAchievableRatio(matchesPlayed: number, crossGroupPoolSize: number): number {
  if (matchesPlayed === 0) return 1
  return Math.min(1, crossGroupPoolSize / matchesPlayed)
}
// normalized_ratio = min(1, actual_ratio / achievable)
```

### 4.2 `metrics.ts` — Reweight partner vs opponent

```typescript
// Trước: partner=20, opponent=15
// Sau:   partner=17, opponent=18  (tổng vẫn 35, phản ánh opponent accumulate 2× nhanh hơn)
partner_diversity: isWarmup ? 17 : computeContextAwareDiversityScore(partner, 17, ...),
opponent_diversity: isWarmup ? 18 : computeContextAwareDiversityScore(opponent, 18, ...),
```

### 4.3 `metrics.ts` — Gender score loại unsatisfiable

```typescript
const satisfiableOpportunities = total_pref_opportunities - unsatisfiable_opportunities
const satisfaction_rate = satisfiableOpportunities === 0
  ? 1
  : satisfied / satisfiableOpportunities
```

### 4.4 `metrics.ts` — Match count dùng availability metrics luôn

Đảm bảo `computeAvailabilityMetrics()` trả về data có nghĩa từ round 1 dựa vào `rounds_available`. `computeAvailabilityMatchCountScore` luôn được dùng song song với raw formula, lấy max.

### 4.5 `metrics.ts` — `contextPenaltyMultiplier` partial cho rest

```typescript
const restContextFactor = Math.max(0.6, availability.penalty_multiplier)
rest: isWarmup ? 20 : computeRestScore(rest, benchDepth) * restContextFactor,
```

---

## Phase 5 — New Features

_Phụ thuộc: Phase 0_

### 5.1 **File mới** `lib/next-round-suggester/avoid.ts`

```typescript
export const AVOID_PARTNER_PENALTY = Infinity   // hard: không bao giờ pair
export const AVOID_OPPONENT_PENALTY = 300       // soft: rất nặng

export function isAvoidPair(player: PlayerSessionState, other: PlayerSessionState): boolean {
  return (player.avoid_ids?.has(other.player_id) ?? false) ||
         (other.avoid_ids?.has(player.player_id) ?? false)
}

export function getAvoidPenalty(player, other, relationship: 'partner' | 'opponent'): number {
  if (!isAvoidPair(player, other)) return 0
  return relationship === 'partner' ? AVOID_PARTNER_PENALTY : AVOID_OPPONENT_PENALTY
}
```

Integrate vào `score.ts` → `scoreMatch()`: check avoid partner trước (return Infinity nếu có), add avoid opponent penalty vào score.

Thêm `detectAvoidViolations()` vào `detector.ts`.

Thêm action type trong `alternatives.ts`:
```typescript
| { type: 'add_avoid_pair'; player_a: string; player_b: string; reason: string }
```

### 5.2 `suggest.ts` + `classify.ts` — Session-end mode

`suggestNextRound()` khi `closing` phase:
- Tăng match_count_excess penalty để close gap tích cực hơn
- Thêm "never_played_together" bonus cho pair chưa từng gặp nhau
- Giảm recent_repeat_cost weight (lặp vòng cuối không ảnh hưởng tương lai)

`classify.ts` khi `closing`: `mustRestAt += 1` (nới MUST_REST).

`computeSessionFairness()` khi `closing`: match_count weight 25 → 30.

### 5.3 `state.ts` + `score.ts` + Edge function — PVNA host override

```typescript
export type HostPvnaOverrideRequest = {
  player_id: string
  effective_pvna: number | null  // null = remove override
}
export function buildPvnaOverridePatch(request: HostPvnaOverrideRequest) {
  return { player_id: request.player_id, effective_pvna: request.effective_pvna }
}
```

**`score.ts` — `getPvna()` function đã tồn tại ở line 64**, chỉ cần sửa để dùng `effective_pvna`:
```typescript
// Trước (line 64-68):
function getPvna(team: Team, state: SessionState): number | null {
  const players = team.map(id => state.players.get(id))
  if (players.some(p => !p)) return null
  return players.reduce((sum, p) => sum + (p?.pvna ?? 3.0), 0)
}

// Sau:
function getPvna(team: Team, state: SessionState): number | null {
  const players = team.map(id => state.players.get(id))
  if (players.some(p => !p)) return null
  return players.reduce((sum, p) => sum + (p?.effective_pvna ?? p?.pvna ?? 3.0), 0)
}
```

**Cũng cần fix `getGroupedTeamPairCount()` ở line 375** — dùng `playerA.pvna` trực tiếp thay vì qua helper:
```typescript
// Trước: Math.abs(playerA.pvna - playerB.pvna) <= INTRA_TEAM_PVNA_GAP_LIMIT
// Sau:   Math.abs((playerA.effective_pvna ?? playerA.pvna) - (playerB.effective_pvna ?? playerB.pvna)) <= ...
```

Thêm route `POST /session/:id/player/:player_id/pvna-override` trong edge function.

`detector.ts` thêm `detectPvnaOutliers()`: heuristic dựa trên player luôn tạo pvna_diff > tolerance × 1.5.

### 5.4 `suggest.ts` — Partial round suggestion

Thêm vào `SuggestNextRoundOptions`:
```typescript
active_courts?: number[]  // chỉ suggest cho các courts này
fixed_courts?: Match[]    // courts đã set, optimize xung quanh
```

Players trong `fixed_courts` bị mark busy. `bestPartitioning()` nhận `fixedCourts` parameter.

### 5.5 `state.ts` + `select.ts` — Waiting time proxy

Thêm `last_rest_started_round?: number` vào `PlayerSessionState`.

Tiebreaker trong `comparePlayersByPriority()`: cùng `consecutive_rest` → ưu tiên `last_rest_started_round` thấp hơn (đã ngồi lâu hơn).

---

## Phase 6 — Detector Improvements

_Phụ thuộc: Phase 3, Phase 5.1_

### 6.1 `detector.ts` — Filter same-group

`detectPartnerIssues()` và `detectOpponentIssues()`: dùng `cross_group_repeat_pairs` thay `repeat_pairs`.

### 6.2 `detector.ts` — Rest violation threshold scale theo bench_depth

```typescript
const benchDepth = getBenchDepth(state)
const violationThreshold = benchDepth <= 1 ? 2 : benchDepth <= 3 ? 3 : 4
const severity = benchDepth === 0 ? 'critical' : 'warning'
const violations = [...state.players.values()]
  .filter(p => p.checked_out_at === null && p.consecutive_rest >= violationThreshold)
```

### 6.3 `detector.ts` — Opponent burden context-aware

```typescript
const warnThreshold = Math.max(3, Math.ceil(N / 4))
const effectiveSeverity = pressure.repeat_risk === 'extreme' ? 'info' : 'warning'
```

### 6.4 `detector.ts` — Normalize "extreme" pressure message

Khi N <= 10: thêm context "Nhóm nhỏ — lặp đối thủ là bình thường" vào message thay vì alarming message.

### 6.5 `detector.ts` — Avoid + PVNA outlier detection

`detectAvoidViolations()`: scan last completed round, warn nếu avoided pair bị ghép (severity: 'warning' cho partner, 'info' cho opponent).

`detectPvnaOutliers()`: warn nếu player luôn tạo pvna_diff > tolerance × 1.5 nhiều lần liên tiếp, severity: 'info', suggest host xem lại PVNA.

---

## Ghi chú quan trọng

- **Branch:** `feat-next-match-suggester`
- **Files chính:** `lib/next-round-suggester/` — suggest.ts, score.ts, pair.ts, classify.ts, select.ts, state.ts, types.ts, fairness/metrics.ts, fairness/detector.ts, fairness/pressure.ts
- **Edge function:** `supabase/functions/session-live-matches-suggest/index.ts`
- **Tests:** `tests/next-round-suggester/` (unit/, property/, simulation/)
- **Bump version** `LIVE_PREVIEW_ALGORITHM_VERSION` trong `live-preview.ts` sau mỗi deploy thay đổi lớn
