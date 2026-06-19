# Execution Plan — Next Round Suggester Refactor

> Plan chi tiết từng bước để implement REFACTOR_PLAN.md.
> Tham chiếu với REFACTOR_PLAN.md cho context tổng thể.
> Cập nhật: 2026-06-14.

---

## Conventions

- Mỗi item có **prereq** rõ ràng — không làm nếu prereq chưa pass typecheck
- Sau mỗi Phase: chạy `npx tsc --noEmit` + `npx vitest run tests/next-round-suggester/`
- Không làm nhiều item cùng lúc nếu cùng edit 1 file
- Code trong plan là định hướng — đọc file thực tế trước khi sửa

---

## Phase 0 — Types & State

_Làm trước tất cả. Không có code logic thay đổi, chỉ thêm fields và helpers._

### 0.1 — `types.ts`: Thêm fields mới

**File:** `lib/next-round-suggester/types.ts`

**Thêm vào `PlayerSessionState`:**
```typescript
rounds_available: number       // số vòng player đã có mặt kể từ check-in
effective_pvna?: number        // PVNA override của host cho player này trong session
avoid_ids?: Set<string>        // player IDs cần tránh ghép (bidirectional)
```

**Thêm vào `SessionConfig`:**
```typescript
planned_total_rounds?: number                              // từ effectiveTargetRounds của UI
court_preset?: 'balanced' | 'play_more' | 'relaxed'       // từ host settings
// Ghi chú: field `courts` đã có — phải là current-round court count, không phải session constant
```

**Thêm vào `SessionPlayerStateRow`:**
```typescript
effective_pvna?: number | null
```

**Thêm vào `HostRestRequest`:**
```typescript
reason?: 'voluntary' | 'system'
```

**Thêm type mới và extend `SessionConfig`:**
```typescript
export type AvoidPair = {
  player_a: string
  player_b: string
  reason?: 'conflict' | 'skill_gap' | 'preference'
}
// Trong SessionConfig:
avoid_pairs?: AvoidPair[]
```

**Check:** `npx tsc --noEmit` — phải pass (không có code dùng field mới nên không break).

---

### 0.2 — `state.ts`: 5 thay đổi

**File:** `lib/next-round-suggester/state.ts`

**Prereq:** 0.1 pass typecheck.

#### Thay đổi A — Extend signature `mapRowsToSessionState()`

Thêm optional param cuối:
```typescript
export function mapRowsToSessionState(
  rows: SessionPlayerStateRow[],
  // ... params hiện tại giữ nguyên ...
  extraConfig?: {
    planned_total_rounds?: number
    court_preset?: 'balanced' | 'play_more' | 'relaxed'
    avoid_pairs?: AvoidPair[]
    current_courts?: number   // court count của vòng hiện tại — override config.courts
  }
): SessionState
```

Trong body: merge `extraConfig` vào `config` được build. Nếu `current_courts` có giá trị, dùng nó cho `config.courts`.

#### Thay đổi B — Tính `rounds_available` per player

Đọc cấu trúc `completedRounds` thực tế trong file trước khi code. Sau đó:

```typescript
// Sau khi dựng Map players, trước khi return:
const playerRoundsAvailable = new Map<string, number>()
for (const round of completedRounds) {
  // allPresentPlayerIds = tất cả player trong round.matches (flattened) + round.resting
  const presentIds = new Set([
    ...round.matches.flatMap(m => [...m.team_a, ...m.team_b]),
    ...(round.resting ?? []),
  ])
  for (const id of presentIds) {
    playerRoundsAvailable.set(id, (playerRoundsAvailable.get(id) ?? 0) + 1)
  }
}
// Assign:
for (const [id, player] of players) {
  player.rounds_available = playerRoundsAvailable.get(id) ?? 0
}
```

#### Thay đổi C — Load `effective_pvna` và build `avoid_ids`

```typescript
// Trong loop map rows → players:
player.effective_pvna = row.effective_pvna ?? undefined

// Sau khi build state, build avoid_ids per player:
for (const [id, player] of players) {
  player.avoid_ids = new Set(
    (extraConfig?.avoid_pairs ?? [])
      .filter(p => p.player_a === id || p.player_b === id)
      .map(p => p.player_a === id ? p.player_b : p.player_a)
  )
}
```

#### Thay đổi D — `buildRestPatch()`: reset consecutive_rest khi quay lại tự nguyện

Tìm `buildRestPatch()`. Thêm:
```typescript
if (request.opted_rest === false && request.reason === 'voluntary') {
  patch.consecutive_rest = 0
}
```

Lý do: khi player xin nghỉ rồi tự quay lại (không phải system reset), consecutive_rest nên về 0 để không bị classify sai.

#### Thay đổi E — Thêm 3 helper functions

```typescript
export function getEffectivePvna(player: PlayerSessionState): number {
  return player.effective_pvna ?? player.pvna
}

export function getBenchDepth(state: SessionState): number {
  const active = [...state.players.values()].filter(
    p => p.checked_out_at === null && !p.opted_rest
  ).length
  return Math.max(0, active - state.config.courts * 4)
}

export function getSessionPhase(
  state: SessionState,
  completedRounds: number,
): 'warmup' | 'mid' | 'closing' {
  if (completedRounds < 3) return 'warmup'
  const planned = state.config.planned_total_rounds
  if (planned != null && planned - completedRounds <= 2) return 'closing'
  return 'mid'
}
```

**Check:** `npx tsc --noEmit`.

---

### 0.3 — DB Migration

**File mới** trong `supabase/migrations/` (đặt tên theo convention hiện tại):

```sql
-- rounds_available KHÔNG cần column — derive trong code
ALTER TABLE session_player_state
  ADD COLUMN IF NOT EXISTS effective_pvna NUMERIC(4,2) NULL;

CREATE TABLE IF NOT EXISTS session_avoid_pairs (
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  player_a   UUID NOT NULL,
  player_b   UUID NOT NULL,
  reason     TEXT,
  PRIMARY KEY (session_id, player_a, player_b),
  CONSTRAINT chk_avoid_order CHECK (player_a < player_b)
);
```

Constraint `player_a < player_b` để đảm bảo bidirectional lookup chỉ cần 1 row (không duplicate (a,b) và (b,a)).

---

## Phase 1 — Critical Bug Fixes

_Prereq: Phase 0 pass typecheck._
_Phase 1 và Phase 5 có thể chạy song song sau Phase 0._

### 1.1 — `score.ts`: Group partner overflow cap → Infinity

**File:** `lib/next-round-suggester/score.ts`

Tìm `getProjectedRepeatSummary()` (khoảng line 275). Tìm đoạn check partner threshold.

Thêm helper local (hoặc inline):
```typescript
function areSameGroup(
  a: PlayerSessionState | undefined,
  b: PlayerSessionState | undefined,
): boolean {
  return !!a?.group_id && a.group_id === b?.group_id
}
```

Sửa threshold:
```typescript
// Trước: threshold = MAX_PROJECTED_PARTNER_PAIR_COUNT (= 2)
// Sau:
const pA = state.players.get(idA)
const pB = state.players.get(idB)
const partnerThreshold = areSameGroup(pA, pB) ? Infinity : MAX_PROJECTED_PARTNER_PAIR_COUNT
if (projectedCount > partnerThreshold) { /* overflow logic */ }
```

> Trong Phase 1, dùng `player.group_id` trực tiếp. Phase 3.4 sẽ thay bằng `getActiveGroupId()`.

### 1.2 — `score.ts`: Intra-group repeat weights

**File:** `lib/next-round-suggester/score.ts`

Thêm constants mới gần `RECENT_PARTNER_REPEAT_WEIGHT`:
```typescript
export const RECENT_INTRA_GROUP_PARTNER_REPEAT_WEIGHT = 0   // group muốn chơi cùng nhau — không penalty
export const RECENT_INTRA_GROUP_OPPONENT_REPEAT_WEIGHT = 1  // nhẹ hơn non-group (= 4)
```

Trong `scoreMatch()`, khi tính repeat penalty cho partner và opponent:
```typescript
const pA = state.players.get(idA)
const pB = state.players.get(idB)
const partnerWeight = areSameGroup(pA, pB)
  ? RECENT_INTRA_GROUP_PARTNER_REPEAT_WEIGHT
  : RECENT_PARTNER_REPEAT_WEIGHT
```

Tương tự cho opponent weight khi tính cross-team repeats.

**Đồng thời:** Grep `\.pvna` trong `score.ts`. Thay tất cả `player.pvna` (khi dùng để tính toán, không phải type check) → `getEffectivePvna(player)`. Import `getEffectivePvna` từ `state.ts`.

**Run tests sau 1.1 + 1.2.**

---

### 1.3 — `classify.ts`: Late arrival → MUST_PLAY ngay

**File:** `lib/next-round-suggester/classify.ts`

Tìm `classifyPlayer()`. Sau block `if (player.consecutive_rest >= 1) return Tier.MUST_PLAY`, thêm:

```typescript
// Late arrival: đã có mặt ít nhất 1 vòng nhưng chưa được chơi vòng nào
if (player.matches_played === 0 && player.rounds_available >= 1) {
  return Tier.MUST_PLAY
}
```

Lý do: `consecutive_rest` của late arrival = 0 vì họ chưa từng trong roster trước đó → không trigger MUST_PLAY hiện tại → bị FLEXIBLE → có thể nghỉ thêm vòng nữa.

---

### 1.4 + 1.5 — `metrics.ts`: Warmup rest freeze + bench-aware rest penalty

**File:** `lib/next-round-suggester/fairness/metrics.ts`

Import `getBenchDepth`, `getSessionPhase` từ `state.ts`.

Tìm `computeSessionFairness()`. Thêm vào đầu:
```typescript
const phase = getSessionPhase(state, completedRounds)
const isWarmup = phase === 'warmup'
const benchDepth = getBenchDepth(state)
```

Sửa dòng tính rest score:
```typescript
// Trước: rest: computeRestScore(rest)
// Sau:
rest: isWarmup ? 20 : computeRestScore(rest, benchDepth),
```

Sửa `computeRestScore()`:
```typescript
function computeRestScore(metrics: RestMetrics, benchDepth: number): number {
  if (metrics.violations.length === 0) return 20
  // benchDepth cao → bench sâu → vi phạm ít nghiêm trọng hơn
  const penaltyPerViolation = Math.max(3, 7 - Math.floor(benchDepth / 2))
  return Math.max(0, 20 - metrics.violations.length * penaltyPerViolation)
}
```

**Run full test suite sau Phase 1.**

---

## Phase 2 — Algorithm Core

_Prereq: Phase 0 pass typecheck._

### 2.1 — `pair.ts`: Interleave relaxation stages

**File:** `lib/next-round-suggester/pair.ts`

Đọc toàn bộ `bestPartitioning()` trước khi sửa. Hiểu cấu trúc từng stage.

**Thêm helper** ngay cạnh `getSoftPvnaTolerance()`:
```typescript
function getMediumPvnaTolerance(state: SessionState): number {
  // Giữa strict (×1.0) và soft (×2.0)
  return Math.max(0.75, state.config.pvna_tolerance * 1.5)
}
```

**Rewrite 9 stages → 8 stages** — mỗi stage là một lần thử `bestPartitioningOnce(players, intraGap, pvnaTol)`:

| Stage | intra gap | PVNA tolerance | Ghi chú |
|-------|-----------|----------------|---------|
| 1 | ≤ 0.75 | ≤ config | Strict |
| 2 | ≤ 1.0  | ≤ config | Nới intra nhẹ |
| 3 | ≤ 0.75 | ≤ medium | Nới PVNA nhẹ ← MỚI |
| 4 | ≤ 1.0  | ≤ medium | Cả hai vừa ← MỚI |
| 5 | ≤ 1.0  | ≤ soft   | |
| 6 | = ∞    | ≤ medium | Drop intra, PVNA vẫn bounded ← MỚI |
| 7 | = ∞    | ≤ soft   | |
| 8 | = ∞    | = ∞      | Open fallback |

Stage cũ #3 (`intra=∞, pvna≤config`) bị xóa — đây là source của vấn đề tạo team [2.5, 4.5] vs [3.0, 4.0].

```typescript
const stages = [
  { intraGap: 0.75, pvnaTol: config },
  { intraGap: 1.0,  pvnaTol: config },
  { intraGap: 0.75, pvnaTol: getMediumPvnaTolerance(state) },
  { intraGap: 1.0,  pvnaTol: getMediumPvnaTolerance(state) },
  { intraGap: 1.0,  pvnaTol: getSoftPvnaTolerance(state) },
  { intraGap: Infinity, pvnaTol: getMediumPvnaTolerance(state) },
  { intraGap: Infinity, pvnaTol: getSoftPvnaTolerance(state) },
  { intraGap: Infinity, pvnaTol: Infinity },
]
for (const { intraGap, pvnaTol } of stages) {
  const result = bestPartitioningOnce(players, intraGap, pvnaTol, ...)
  if (result.length > 0) return result
  if (timedOut()) break
}
```

---

### 2.2 — `suggest.ts`: Đổi thứ tự 4 pass (A → C → B → D)

**File:** `lib/next-round-suggester/suggest.ts`

Tìm đoạn gọi `collectAlternatives` (khoảng line 597–601). Sửa:

```typescript
// TRƯỚC:
collectAlternatives(false, false)  // A
if (alternatives.length === 0 && !timedOut()) {
  collectAlternatives(false, true)              // B: strict + repeat_ok  ← sai
  if (!timedOut()) collectAlternatives(true, false)   // C
  if (!timedOut()) collectAlternatives(true, true)    // D
}

// SAU:
collectAlternatives(false, false)  // A: strict PVNA, no repeat
if (alternatives.length === 0 && !timedOut()) {
  collectAlternatives(true, false)              // C: relax PVNA, no repeat ← ưu tiên nới skill
  if (!timedOut()) collectAlternatives(false, true)   // B: strict PVNA, repeat ok
  if (!timedOut()) collectAlternatives(true, true)    // D: all relaxed
}
```

Lý do: nới PVNA (C) thường cho kết quả tốt hơn chấp nhận lặp (B). Lặp tạo ra trải nghiệm xấu, skill mismatch có thể chấp nhận hơn.

---

### 2.3 — `suggest.ts`: `should_end` từ target rounds

**File:** `lib/next-round-suggester/suggest.ts`

Trong `suggestNextRound()`, sau khi tính `completedRounds` (trước mọi logic khác):

```typescript
if (
  state.config.planned_total_rounds != null &&
  completedRounds >= state.config.planned_total_rounds
) {
  return {
    alternatives: [],
    warnings: ['TARGET_ROUNDS_REACHED'],
    should_end: true,
  }
}
```

UI layer đã có `reportReady` và `targetReached` — đây là tín hiệu xác nhận độc lập từ suggester, không phụ thuộc UI state.

---

### 2.4 — `classify.ts` + `score.ts`: Dynamic thresholds

**File:** `lib/next-round-suggester/classify.ts`

Thêm type và function:
```typescript
export type DynamicThresholds = {
  mustRestAt: number         // consecutive_play >= mustRestAt → MUST_REST
  mustPlayAt: number         // consecutive_rest >= mustPlayAt → MUST_PLAY
  partnerRepeatCap: number   // max lần ghép partner trước khi overflow
  opponentRepeatCap: number  // max lần ghép opponent
  rematchBlockRounds: number // số round gần nhất block rematch
}

export function computeDynamicThresholds(
  benchDepth: number,
  N: number,
  preset: 'balanced' | 'play_more' | 'relaxed' = 'balanced',
): DynamicThresholds {
  // relaxed preset → host muốn nghỉ nhiều hơn → ngưỡng phải nghỉ cao hơn
  const presetRestBonus = preset === 'relaxed' ? 1 : 0
  return {
    mustRestAt: Math.max(2, 1 + Math.ceil(benchDepth / 2)) + presetRestBonus,
    mustPlayAt: Math.max(1, Math.ceil(benchDepth / 3)),
    partnerRepeatCap: Math.max(2, Math.ceil(N / 6)),
    opponentRepeatCap: Math.max(3, Math.ceil(N / 6) + 1),
    rematchBlockRounds: N <= 10 ? 1 : 2,
  }
}
```

**Trong `suggestNextRound()`:**
```typescript
const benchDepth = getBenchDepth(state)
const N = activePlayers.length
const thresholds = computeDynamicThresholds(
  benchDepth,
  N,
  state.config.court_preset,
)
```

Thread `thresholds` vào:
- `classifyPlayer(player, { ..., thresholds })` — thêm `thresholds` vào `PlayerClassificationContext`
- Trong `classifyPlayer()`: replace `consecutive_play >= 2` → `>= thresholds.mustRestAt`, `consecutive_rest >= 1` → `>= thresholds.mustPlayAt`
- `hasRepeatOverflow()` — replace hardcoded caps bằng `thresholds.partnerRepeatCap / opponentRepeatCap`
- `getConsecutivePlayPenalty()` trong `score.ts` — thêm `mustRestAt` vào options, replace hardcoded `>= 2`

**Lưu ý:** `getConsecutivePlayPenalty()` được gọi từ `scoreMatch()`. Thêm `mustRestAt` vào `ScoreMatchOptions` type.

---

### 2.5 — `score.ts`: Dynamic rematch constants

**File:** `lib/next-round-suggester/score.ts`

```typescript
export function getRematchBlockRounds(N: number): number {
  return N <= 10 ? 1 : 2
}

export function getNearRematchMinOverlap(N: number): number {
  return N <= 8 ? 4 : 3  // N nhỏ → cần overlap cao hơn để kích block
}
```

Thêm `rematchBlockRounds` và `nearRematchMinOverlap` vào `DynamicThresholds`. Grep tìm tất cả call sites dùng `RECENT_GROUP_REMATCH_BLOCK_ROUNDS` và `RECENT_GROUP_NEAR_REMATCH_MIN_OVERLAP` → replace.

**Run full test suite sau Phase 2.**

---

## Phase 3 — Group Player Handling

_Prereq: Phase 0, Phase 1.1 + 1.2._

### 3.1 — `metrics.ts`: Tách intra/cross-group trong diversity

**File:** `lib/next-round-suggester/fairness/metrics.ts`

Trong `computePartnerDiversity()` và `computeOpponentDiversity()`, tách repeat pairs thành 2 lists:

```typescript
// Return type thêm:
cross_group_repeat_pairs: RepeatPair[]   // dùng cho scoring và burden detection
intra_group_repeat_pairs: RepeatPair[]   // informational only — không penalty
```

`avg_diversity_ratio` tính trên cross-group only:
```typescript
const intraGroupMatches = /* đếm số match với group members */
const crossGroupMatches = matches_played - intraGroupMatches
const ratio = crossGroupMatches === 0
  ? 1
  : cross_group_unique_partners / crossGroupMatches
```

Lý do: player trong group chơi nhiều với nhau → diversity ratio thấp giả tạo nếu tính cả intra.

---

### 3.2 — `metrics.ts`: `isBurdenRepeat()` — group-aware

Tìm `isBurdenRepeat()` (khoảng line 341–351). Rewrite:

```typescript
function isBurdenRepeat(
  player: PlayerSessionState,
  other: PlayerSessionState,
  count: number,
  type: 'partner' | 'opponent',
): boolean {
  if (count <= 1) return false
  const sameGroup = player.group_id && player.group_id === other.group_id
  if (type === 'partner' && sameGroup) return false  // partner cùng group không bao giờ là burden
  if (sameGroup) return count > 4                    // opponent cùng group: threshold cao hơn bình thường
  return count >= 2
}
```

---

### 3.3 — `metrics.ts`: Active-only repeat counting

Thêm helper:
```typescript
function getActiveRepeatCount(
  player: PlayerSessionState,
  otherId: string,
  state: SessionState,
  type: 'partner' | 'opponent',
): number {
  const other = state.players.get(otherId)
  if (!other || other.checked_out_at !== null) return 0  // departed → bỏ qua
  return type === 'partner'
    ? (player.partner_counts.get(otherId) ?? 0)
    : (player.opponent_counts.get(otherId) ?? 0)
}
```

Replace tất cả `.partner_counts.get(id)` và `.opponent_counts.get(id)` trong các hàm tính diversity và burden bằng `getActiveRepeatCount(player, id, state, type)`.

---

### 3.4 — `state.ts`: `getActiveGroupId()`

**File:** `lib/next-round-suggester/state.ts`

```typescript
export function getActiveGroupId(
  player: PlayerSessionState,
  state: SessionState,
): string | null {
  if (!player.group_id) return null
  const hasActiveGroupMember = [...state.players.values()].some(
    p =>
      p.player_id !== player.player_id &&
      p.group_id === player.group_id &&
      p.checked_out_at === null,
  )
  return hasActiveGroupMember ? player.group_id : null
}
```

Replace `player.group_id` trực tiếp trong `score.ts` và `metrics.ts` (khi dùng để check group membership) bằng `getActiveGroupId(player, state)`. Đặc biệt trong `areSameGroup()` helper từ Phase 1.1.

---

### 3.5 — `metrics.ts`: `group_satisfaction` informational metric

Thêm vào output `computeSessionFairness()` (không tính vào total score, chỉ để report):

```typescript
group_satisfaction: {
  total_groups: number                          // số group distinct
  groups_played_together_at_least_once: number  // group có ít nhất 1 match cùng nhau
  rate: number                                  // = played_together / total_groups
}
```

Tính bằng cách scan `partner_counts` của tất cả group members. Một group "played together" nếu bất kỳ cặp member nào có `partner_counts > 0`.

**Run full test suite sau Phase 3.**

---

## Phase 4 — Fairness System Overhaul

_Prereq: Phase 0, Phase 3._

### 4.1 — Diversity ratio normalization

**File:** `lib/next-round-suggester/fairness/metrics.ts`

```typescript
function computeAchievableRatio(
  matchesPlayed: number,
  crossGroupPoolSize: number,
): number {
  if (matchesPlayed === 0) return 1
  // Tối đa bao nhiêu unique partner có thể đạt được với số matches đó?
  return Math.min(1, crossGroupPoolSize / matchesPlayed)
}

// Trong computePartnerDiversity():
const achievable = computeAchievableRatio(crossGroupMatches, crossGroupPoolSize)
const normalizedRatio = achievable === 0 ? 1 : Math.min(1, actualRatio / achievable)
// Dùng normalizedRatio thay raw actualRatio trong scoring
```

Lý do: N=8, 2 sân → mỗi vòng gặp 3 partner → sau 4 vòng đã không còn partner mới → raw ratio giảm dù player không có lỗi gì.

---

### 4.2 — Reweight partner vs opponent

```typescript
// Trước: partner_diversity: 20, opponent_diversity: 15
// Sau:
const PARTNER_DIVERSITY_WEIGHT = 17
const OPPONENT_DIVERSITY_WEIGHT = 18
// Tổng = 35 (giữ nguyên). Opponent weight cao hơn vì accumulate 2× nhanh (4 opponent vs 1 partner/match)
```

---

### 4.3 — Gender score loại unsatisfiable opportunities

Tìm `computeGenderScore()`. Thêm logic:

```typescript
// Nếu cơ cấu giới tính không cho phép thỏa preference → không penalty
const satisfiableOpportunities = total_pref_opportunities - unsatisfiable_opportunities
const satisfaction_rate = satisfiableOpportunities === 0
  ? 1  // không thể thỏa được → score hoàn hảo (không phải lỗi của player)
  : satisfied / satisfiableOpportunities
```

---

### 4.4 — Match count normalization dựa trên `rounds_available`

Đảm bảo expected match count của player tính từ `rounds_available` (số vòng họ thực sự có mặt), không phải `completedRounds` tổng:

```typescript
// Target matches = rounds_available × (courts × 4 / N_active_trung_bình)
// Không phải: completedRounds × ratio
```

`computeAvailabilityMetrics()` đã tính `rounds_available` per player — dùng nó.

---

### 4.5 — `contextPenaltyMultiplier` partial cho rest

```typescript
// Trong computeSessionFairness():
const restContextFactor = Math.max(0.6, availability.penalty_multiplier)
rest: isWarmup
  ? 20
  : computeRestScore(rest, benchDepth) * restContextFactor,
```

Lý do: late arrival có `penalty_multiplier` thấp → nếu apply toàn bộ thì rest score bị giảm quá nhiều, nhưng rest vẫn là metric quan trọng → cap tối thiểu 0.6.

**Run full test suite sau Phase 4.**

---

## Phase 5 — New Features

_Prereq: Phase 0. Có thể làm song song với Phase 1 sau Phase 0._

### 5.1 — File mới `avoid.ts`

**Tạo file mới:** `lib/next-round-suggester/avoid.ts`

```typescript
import type { PlayerSessionState } from './types'

export const AVOID_PARTNER_PENALTY = Infinity  // hard block
export const AVOID_OPPONENT_PENALTY = 300      // soft — rất nặng nhưng không impossible

export function isAvoidPair(
  a: PlayerSessionState,
  b: PlayerSessionState,
): boolean {
  return (a.avoid_ids?.has(b.player_id) ?? false) ||
         (b.avoid_ids?.has(a.player_id) ?? false)
}

export function getAvoidPenalty(
  a: PlayerSessionState,
  b: PlayerSessionState,
  relationship: 'partner' | 'opponent',
): number {
  if (!isAvoidPair(a, b)) return 0
  return relationship === 'partner' ? AVOID_PARTNER_PENALTY : AVOID_OPPONENT_PENALTY
}
```

**Integrate vào `scoreMatch()` trong `score.ts`:**

Thêm vào đầu `scoreMatch()` (trước tất cả tính toán khác):

```typescript
// 1. Hard block: avoid partner
for (const team of [teamA, teamB]) {
  for (let i = 0; i < team.length - 1; i++) {
    for (let j = i + 1; j < team.length; j++) {
      const pA = state.players.get(team[i])
      const pB = state.players.get(team[j])
      if (pA && pB && isAvoidPair(pA, pB)) return Infinity
    }
  }
}

// 2. Soft penalty: avoid opponent
let avoidOpponentPenalty = 0
for (const pa of teamA) {
  for (const pb of teamB) {
    const pA = state.players.get(pa)
    const pB = state.players.get(pb)
    if (pA && pB) {
      avoidOpponentPenalty += getAvoidPenalty(pA, pB, 'opponent')
    }
  }
}
// Cộng avoidOpponentPenalty vào total score
```

**Thêm action type** (tìm file `alternatives.ts` hoặc nơi định nghĩa action types):
```typescript
| { type: 'add_avoid_pair'; player_a: string; player_b: string; reason: string }
```

**Thêm `detectAvoidViolations()`** vào `detector.ts` (xem Phase 6.5).

---

### 5.2 — `suggest.ts` + `classify.ts`: Session-end (closing) mode

**File:** `lib/next-round-suggester/suggest.ts`

Sau khi tính `phase`, nếu `phase === 'closing'`:

```typescript
if (phase === 'closing') {
  // Tăng weight match count để đóng gap tích cực hơn
  weights = {
    ...weights,
    match_count_excess: (weights.match_count_excess ?? 1) * 1.5,
    // Giảm repeat penalty — lặp ở vòng cuối không ảnh hưởng tương lai
    recent_partner_repeat: (weights.recent_partner_repeat ?? 1) * 0.7,
    recent_opponent_repeat: (weights.recent_opponent_repeat ?? 1) * 0.7,
  }
}
```

**File:** `lib/next-round-suggester/classify.ts`

Trong `classifyPlayer()`, thêm closing phase context:
```typescript
// Khi closing phase: nới MUST_REST để tăng số người eligible chơi vòng cuối
if (context?.phase === 'closing') {
  thresholds = { ...thresholds, mustRestAt: thresholds.mustRestAt + 1 }
}
```

**File:** `lib/next-round-suggester/fairness/metrics.ts`

Khi `phase === 'closing'`, tăng weight match_count trong `computeSessionFairness()`:
```typescript
match_count: phase === 'closing'
  ? computeMatchCountScore(matchCount) * (30 / 25)   // 25→30 relative weight
  : computeMatchCountScore(matchCount),
```

---

### 5.3 — PVNA host override

**File:** `lib/next-round-suggester/state.ts`

```typescript
export type HostPvnaOverrideRequest = {
  player_id: string
  effective_pvna: number | null  // null = remove override
}

export function buildPvnaOverridePatch(
  request: HostPvnaOverrideRequest,
): Partial<SessionPlayerStateRow> {
  return {
    player_id: request.player_id,
    effective_pvna: request.effective_pvna,
  }
}
```

**File:** `lib/next-round-suggester/score.ts`

Hàm `getPvna()` đã có ở line 64. Chỉ cần sửa 1 dòng:
```typescript
// Trước:
return players.reduce((sum, p) => sum + (p?.pvna ?? 3.0), 0)
// Sau:
return players.reduce((sum, p) => sum + (p?.effective_pvna ?? p?.pvna ?? 3.0), 0)
```

Tìm `getGroupedTeamPairCount()` (khoảng line 375). Sửa:
```typescript
// Trước: Math.abs(playerA.pvna - playerB.pvna)
// Sau:
Math.abs(getEffectivePvna(playerA) - getEffectivePvna(playerB))
```

**Edge function** `supabase/functions/session-live-matches-suggest/index.ts`:
Thêm route `POST /session/:id/player/:player_id/pvna-override` → gọi `buildPvnaOverridePatch()`.

---

### 5.4 — `suggest.ts`: Partial round suggestion

**File:** `lib/next-round-suggester/suggest.ts`

Thêm vào `SuggestNextRoundOptions`:
```typescript
active_courts?: number    // chỉ dùng số sân này thay vì config.courts
fixed_courts?: Match[]    // các court đã được assign, optimize phần còn lại
```

Trong `suggestNextRound()`:
```typescript
// Players trong fixed_courts bị mark busy → không eligible
const busyPlayerIds = new Set(
  (options.fixed_courts ?? []).flatMap(m => [...m.team_a, ...m.team_b])
)
const eligiblePlayers = activePlayers.filter(p => !busyPlayerIds.has(p.player_id))

// Số courts để suggest = active_courts - fixed_courts.length
const courtsToSuggest = (options.active_courts ?? state.config.courts)
  - (options.fixed_courts?.length ?? 0)
```

Alignment với UI: `CourtSuggestionOptions` cho phép host chọn ít sân → `courtCountOverride` giảm → rebuild state với `courts` mới → `suggestNextRound()` suggest ít sân hơn. Phase 5.4 là extension cho case đặc biệt hơn (giữ vài court cố định).

---

### 5.5 — `state.ts` + `select.ts`: Waiting time proxy

**File:** `lib/next-round-suggester/types.ts`

Thêm vào `PlayerSessionState`:
```typescript
last_rest_started_round?: number  // round number khi bắt đầu chuỗi nghỉ hiện tại
```

**File:** `lib/next-round-suggester/state.ts`

Trong `buildRestPatch()`: khi `opted_rest = true` (bắt đầu nghỉ), set `last_rest_started_round = currentRound`.

**File:** `lib/next-round-suggester/select.ts`

Trong `comparePlayersByPriority()`, thêm tiebreaker cuối:
```typescript
// Cùng consecutive_rest → ưu tiên người đã ngồi từ round sớm hơn
if (a.consecutive_rest === b.consecutive_rest) {
  const aStart = a.last_rest_started_round ?? Infinity
  const bStart = b.last_rest_started_round ?? Infinity
  return aStart - bStart  // round nhỏ hơn = đã ngồi lâu hơn → ưu tiên hơn
}
```

**Run full test suite sau Phase 5.**

---

## Phase 6 — Detector Improvements

_Prereq: Phase 3, Phase 5.1._

### 6.1 — Filter same-group khỏi partner/opponent warnings

**File:** `lib/next-round-suggester/fairness/detector.ts`

Trong `detectPartnerIssues()`:
```typescript
// Trước: dùng partner_counts tất cả
// Sau: dùng cross_group_repeat_pairs từ metrics (Phase 3.1)
const burdenPairs = metrics.partner_diversity.cross_group_repeat_pairs.filter(
  pair => isBurdenRepeat(pair.playerA, pair.playerB, pair.count, 'partner')
)
```

Tương tự cho `detectOpponentIssues()`.

---

### 6.2 — Rest violation threshold scale theo bench_depth

```typescript
// Trước: consecutive_rest >= 2 → critical (hardcoded)
// Sau:
const benchDepth = getBenchDepth(state)
const violationThreshold = benchDepth <= 1 ? 2 : benchDepth <= 3 ? 3 : 4
const severity: 'critical' | 'warning' = benchDepth === 0 ? 'critical' : 'warning'

const violations = [...state.players.values()].filter(
  p => p.checked_out_at === null && p.consecutive_rest >= violationThreshold
)
```

---

### 6.3 — Opponent burden context-aware

```typescript
// Trước: repeated_opponents >= 3 → always warning
// Sau:
const warnThreshold = Math.max(3, Math.ceil(N / 4))
// N=8 → threshold=3, N=16 → threshold=4, N=20 → threshold=5
const effectiveSeverity = repeatPressure.repeat_risk === 'extreme' ? 'info' : 'warning'
```

---

### 6.4 — Small group context trong messages

Khi N <= 10, thêm context message thay vì alarming:
```typescript
if (N <= 10) {
  message = `${message} (Nhóm nhỏ — lặp đối thủ là bình thường)`
  severity = 'info'  // downgrade từ warning
}
```

---

### 6.5 — Avoid + PVNA outlier detection

**`detectAvoidViolations()`** mới:
```typescript
export function detectAvoidViolations(
  lastCompletedRound: Round,
  state: SessionState,
): DetectorIssue[] {
  const issues: DetectorIssue[] = []
  for (const match of lastCompletedRound.matches) {
    // Check partner avoid
    for (let i = 0; i < match.team_a.length; i++) {
      for (let j = i + 1; j < match.team_a.length; j++) {
        const pA = state.players.get(match.team_a[i])
        const pB = state.players.get(match.team_a[j])
        if (pA && pB && isAvoidPair(pA, pB)) {
          issues.push({ type: 'avoid_partner_violation', severity: 'warning', ... })
        }
      }
    }
    // Check opponent avoid (severity: info)
  }
  return issues
}
```

**`detectPvnaOutliers()`** mới:
```typescript
export function detectPvnaOutliers(state: SessionState): DetectorIssue[] {
  // Player luôn tạo pvna_diff > tolerance × 1.5 trong nhiều matches gần đây
  // → suggest host xem lại PVNA rating
}
```

**Run full test suite sau Phase 6.**

---

## Sau khi hoàn thành tất cả Phases

1. **Bump version:** `LIVE_PREVIEW_ALGORITHM_VERSION` trong `lib/next-round-suggester/live-preview.ts`
2. **Update UI callers:** `useNextRoundModel.ts` — truyền `effectiveTargetRounds`, `courtPreset`, `courtCountOverride` vào `mapRowsToSessionState()` qua `extraConfig`
3. **Run simulation tests:** `tests/next-round-suggester/simulation/` để verify behavior thực tế
4. **Deploy edge function** với migration đã viết
5. **Smoke test** với session thực: check suggest quality, fairness score, group handling

---

## Ước lượng effort

| Phase | Complexity | Số files thay đổi | Ghi chú |
|-------|------------|-------------------|---------|
| 0 | Thấp | 2 core + migration | Chỉ thêm types + helpers |
| 1 | Trung bình | 2–3 | Bug fixes rõ ràng |
| 2 | Cao | 3 | Algorithm logic phức tạp |
| 3 | Trung bình | 2 | Group logic tương đối isolated |
| 4 | Trung bình | 1 | Cùng file metrics.ts |
| 5 | Cao | 4–5 + file mới | Multiple new features |
| 6 | Thấp | 1 | Detector improvements |

Phase 0 → Phase 1 + Phase 5 (song song) → Phase 2 → Phase 3 → Phase 4 → Phase 6
