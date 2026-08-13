# Board Optimizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thay sáu post-pass của engine bằng một optimizer tất định, có một thước đo và một bộ ràng buộc cứng tường minh.

**Architecture:** Module thuần mới dưới `lib/next-round-suggester/board-optimizer/`, gồm bốn phần tách bạch (ràng buộc / thước đo / nước đi / vòng tìm). Nó nhận board greedy làm điểm xuất phát, leo dốc theo nước đi sinh ra theo thứ tự cố định, loại mọi ứng viên vi phạm ràng buộc cứng, và trả về board gốc byte-identical nếu không cải thiện được gì. Cắm vào `buildSuggestedMatchPayloads` sau một cờ theo session; cờ tắt thì đường cũ chạy nguyên vẹn.

**Tech Stack:** TypeScript strict, Jest (jest-expo), `tsx` cho script đo. Không thêm dependency nào.

**Spec:** `docs/superpowers/specs/2026-08-13-board-optimizer-design.md`

## Global Constraints

- Ràng buộc cứng H1–H8 (spec §3) áp cho **mọi** ứng viên; vi phạm là loại, không đánh đổi.
- "Không tệ hơn" luôn so với **board gốc greedy**, từng sân so với chính sân đó.
- Tất định tuyệt đối: không đọc `Date.now()` / `performance.now()` / `Math.random()` trong optimizer; ngân sách tính bằng **số vòng lặp** (trần 30).
- ε = 0.01, chỉ áp cho bậc `cost`; các bậc đếm là số nguyên.
- Cờ `SESSION_BOARD_OPTIMIZER` mặc định **TẮT**; cờ tắt phải cho ra đúng `board_hash = f1b6d8ac0b0c`.
- **Không deploy.** Prod giữ ALGO 77.
- Gate trong worktree này: `npx jest --testMatch "**/tests/**/*.test.ts" --testMatch "**/tests/**/*.test.tsx" --forceExit` (`npm test` khớp 0 file vì worktree nằm dưới `.claude/`).
- Mỗi task kết thúc bằng một commit.

---

### Task 1: Tách helper đo board ra module chung

Ba helper optimizer cần đều là **module-private** trong `live-preview.ts`. Import trực tiếp sẽ tạo vòng (`live-preview` → `board-optimizer` → `live-preview`). Tách trước, không đổi hành vi.

**Files:**
- Create: `lib/next-round-suggester/board-metrics.ts`
- Modify: `lib/next-round-suggester/live-preview.ts` (xoá 3 định nghĩa, thêm import)
- Test: `tests/next-round-suggester/unit/board-metrics.test.ts`

**Interfaces:**
- Produces:
  - `getPayloadIntraTeamGap(payload: SuggestedMatchPayload, state: SessionState): number`
  - `getPayloadProjectedMaxMeeting(payload: SuggestedMatchPayload, state: SessionState): number`
  - `hasAvoidedPartnerPair(payloads: SuggestedMatchPayload[], state: SessionState): boolean`

- [ ] **Step 1: Tạo module mới bằng cách di chuyển nguyên văn**

Copy nguyên ba hàm (và các hàm phụ chỉ chúng dùng: `getPayloadPairKey`, `getPayloadMaxHistoricalPairCount`) từ `live-preview.ts` sang `board-metrics.ts`, thêm `export` cho ba hàm trên. Không sửa một dòng logic nào.

- [ ] **Step 2: Viết test khẳng định hành vi không đổi**

```ts
// tests/next-round-suggester/unit/board-metrics.test.ts
import { getPayloadIntraTeamGap, getPayloadProjectedMaxMeeting } from '@/lib/next-round-suggester/board-metrics'
import { makeStateWithPlayers } from '../helpers/state'   // helper sẵn có trong tests/

test('intra gap là chênh lệch trong đội lớn nhất của hai đội', () => {
  const state = makeStateWithPlayers([['a', 4.0], ['b', 2.0], ['c', 3.0], ['d', 3.1]])
  const payload = { court_idx: 0, team_a: ['a', 'b'], team_b: ['c', 'd'] } as any
  expect(getPayloadIntraTeamGap(payload, state)).toBeCloseTo(2.0, 5)
})

test('projected max meeting = số lần đã gặp nhiều nhất + 1', () => {
  const state = makeStateWithPlayers([['a', 3], ['b', 3], ['c', 3], ['d', 3]])
  state.players.get('a')!.partner_counts.set('b', 2)
  const payload = { court_idx: 0, team_a: ['a', 'b'], team_b: ['c', 'd'] } as any
  expect(getPayloadProjectedMaxMeeting(payload, state)).toBe(3)
})
```

Nếu `tests/next-round-suggester/helpers/state.ts` không có hàm dựng state, dùng khuôn dựng state của `tests/next-round-suggester/unit/live-preview.test.ts` (copy phần `makeState`).

- [ ] **Step 3: Chạy test, xác nhận ĐỎ trước khi sửa `live-preview.ts`**

Run: `npx jest --testMatch "**/tests/**/board-metrics.test.ts" --forceExit`
Expected: FAIL — `Cannot find module '@/lib/next-round-suggester/board-metrics'` (nếu chưa tạo file) hoặc PASS ngay nếu Step 1 đã xong; trường hợp PASS là hợp lệ vì đây là task di chuyển thuần.

- [ ] **Step 4: Sửa `live-preview.ts` dùng module mới**

Xoá ba định nghĩa cũ, thêm:

```ts
import { getPayloadIntraTeamGap, getPayloadProjectedMaxMeeting, hasAvoidedPartnerPair } from './board-metrics'
```

- [ ] **Step 5: Xác nhận không đổi hành vi — corpus phải ra đúng hash cũ**

Run: `npx tsx scratch/board-scorecard.ts 60 scratch/out/p22-task1.json`
Expected: `board_hash` = `f1b6d8ac0b0c` (bằng đúng baseline). Lệch một ký tự nghĩa là di chuyển đã đổi hành vi — dừng lại, tìm chỗ lệch.

- [ ] **Step 6: Gate + commit**

```bash
npx jest --testMatch "**/tests/**/*.test.ts" --testMatch "**/tests/**/*.test.tsx" --forceExit
npx tsc --noEmit
git add lib/next-round-suggester/board-metrics.ts lib/next-round-suggester/live-preview.ts tests/next-round-suggester/unit/board-metrics.test.ts
git commit -m "refactor(suggester): extract board metric helpers so the optimizer can import them"
```

---

### Task 2: Ràng buộc cứng H1–H8

**Files:**
- Create: `lib/next-round-suggester/board-optimizer/constraints.ts`
- Test: `tests/next-round-suggester/unit/board-optimizer-constraints.test.ts`

**Interfaces:**
- Consumes: `board-metrics.ts` (Task 1)
- Produces:

```ts
export type BoardSnapshot = { court_idx: number; team_a: [string, string]; team_b: [string, string] }[]
export type ConstraintContext = {
  state: SessionState
  pvnaTolerance: number
  seed: BoardSnapshot
  benchIds: string[]
  lockPlayerSet: boolean          // H7: rolling-plan target đang bật
}
export type ConstraintRejection =
  | 'avoid_pair' | 'seat_integrity' | 'intra_cap' | 'over_tol_increase'
  | 'new_repeat3' | 'owed_rank' | 'player_set_locked' | 'stranded_outlier'
export function firstViolation(candidate: BoardSnapshot, ctx: ConstraintContext): ConstraintRejection | null
```

- [ ] **Step 1: Viết test đỏ cho từng ràng buộc**

```ts
// tests/next-round-suggester/unit/board-optimizer-constraints.test.ts
import { firstViolation, type BoardSnapshot, type ConstraintContext } from '@/lib/next-round-suggester/board-optimizer/constraints'
import { makeState } from '../helpers/make-state'   // tạo ở Step 1b nếu chưa có

// PVNA: a=4.0 b=2.0 c=3.0 d=3.0 e=3.1 f=2.9
const state = makeState([['a', 4.0], ['b', 2.0], ['c', 3.0], ['d', 3.0], ['e', 3.1], ['f', 2.9]])
const ctx: ConstraintContext = {
  state, pvnaTolerance: 0.5, benchIds: ['e', 'f'], lockPlayerSet: false,
  seed: [{ court_idx: 0, team_a: ['a', 'b'], team_b: ['c', 'd'] }],   // tổng 6.0 vs 6.0 → trong tol
}

test('H4: chia lại thành lệch quá tolerance thì bị loại', () => {
  // a+c = 7.0 vs b+d = 5.0 → gap 2.0 > tol 0.5, trong khi seed gap 0
  const candidate: BoardSnapshot = [{ court_idx: 0, team_a: ['a', 'c'], team_b: ['b', 'd'] }]
  expect(firstViolation(candidate, ctx)).toBe('over_tol_increase')
})

test('H6: đưa người nợ ít vào thay người nợ nhiều thì bị loại', () => {
  state.players.get('b')!.consecutive_rest = 2     // b đang bị nợ nghỉ
  state.players.get('e')!.consecutive_rest = 0     // e vừa chơi xong
  const candidate: BoardSnapshot = [{ court_idx: 0, team_a: ['a', 'e'], team_b: ['c', 'd'] }]
  expect(firstViolation(candidate, ctx)).toBe('owed_rank')
})

test('board gốc luôn hợp lệ với chính nó', () => {
  expect(firstViolation(ctx.seed, ctx)).toBeNull()
})
```

- [ ] **Step 1b: Nếu `tests/next-round-suggester/helpers/make-state.ts` chưa có, tạo nó**

```ts
// tests/next-round-suggester/helpers/make-state.ts
import type { SessionState } from '@/lib/next-round-suggester/types'

export function makeState(players: [string, number][], config: Partial<SessionState['config']> = {}): SessionState {
  return {
    players: new Map(players.map(([player_id, pvna]) => [player_id, {
      player_id, pvna, effective_pvna: pvna, matches_played: 0, consecutive_rest: 0, consecutive_play: 0,
      opted_rest: false, checked_out_at: null, group_id: null, rest_seat_misses: 0, last_played_round: 0,
      partner_counts: new Map(), opponent_counts: new Map(),
    } as any]]),
    rounds: [],
    config: { courts: 1, pvna_tolerance: 0.5, avoid_pairs: [], ...config } as any,
  } as SessionState
}
```

Nếu file đã tồn tại với chữ ký khác, dùng cái đang có thay vì tạo trùng.

- [ ] **Step 2: Chạy, xác nhận đỏ**

Run: `npx jest --testMatch "**/tests/**/board-optimizer-constraints.test.ts" --forceExit`
Expected: FAIL — module chưa tồn tại.

- [ ] **Step 3: Cài đặt**

Thứ tự kiểm theo đúng bảng H (rẻ trước, đắt sau) và trả về vi phạm ĐẦU TIÊN để counter phân loại được:

```ts
export function firstViolation(candidate: BoardSnapshot, ctx: ConstraintContext): ConstraintRejection | null {
  if (!hasSeatIntegrity(candidate, ctx)) return 'seat_integrity'                       // H2
  if (ctx.lockPlayerSet && playerSetKey(candidate) !== playerSetKey(ctx.seed)) return 'player_set_locked'  // H7
  if (hasAvoidedPartnerPair(toPayloads(candidate), ctx.state)) return 'avoid_pair'      // H1
  for (const court of candidate) {                                                      // H3, từng sân
    const seedCourt = ctx.seed.find(c => c.court_idx === court.court_idx)!
    const cap = Math.max(INTRA_TEAM_PVNA_GAP_LIMIT, getPayloadIntraTeamGap(toPayload(seedCourt), ctx.state))
    if (getPayloadIntraTeamGap(toPayload(court), ctx.state) > cap) return 'intra_cap'
  }
  const before = overTolStats(ctx.seed, ctx), after = overTolStats(candidate, ctx)      // H4
  if (after.courts > before.courts || after.total > before.total + 1e-9) return 'over_tol_increase'
  for (const court of candidate) {                                                      // H5
    const seedCourt = ctx.seed.find(c => c.court_idx === court.court_idx)!
    if (getPayloadProjectedMaxMeeting(toPayload(court), ctx.state) >= 3
      && getPayloadProjectedMaxMeeting(toPayload(seedCourt), ctx.state) < 3) return 'new_repeat3'
  }
  if (!respectsOwedRank(candidate, ctx)) return 'owed_rank'                             // H6
  if (strandsLoneOutlier(candidate, ctx)) return 'stranded_outlier'                     // H8
  return null
}
```

`respectsOwedRank` dùng đúng thứ tự của `mayReplace` đang chạy: người vào phải có `consecutive_rest` lớn hơn, hoặc bằng thì `matches_played` không lớn hơn. `strandsLoneOutlier` dùng đúng `hasNearLevelPeer` của `repairPayloadBatchBlowoutFromPool`.

- [ ] **Step 4: Chạy test, xác nhận xanh**

Run: `npx jest --testMatch "**/tests/**/board-optimizer-constraints.test.ts" --forceExit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/next-round-suggester/board-optimizer/constraints.ts tests/next-round-suggester/unit/board-optimizer-constraints.test.ts
git commit -m "feat(optimizer): hard constraints H1-H8 lifted from the current pass guards"
```

---

### Task 3: Hai thước đo

**Files:**
- Create: `lib/next-round-suggester/board-optimizer/objective.ts`
- Test: `tests/next-round-suggester/unit/board-optimizer-objective.test.ts`

**Interfaces:**
- Consumes: `BoardSnapshot`, `ConstraintContext` từ `board-optimizer/constraints.ts` (Task 2) — đây là
  nguồn khai báo DUY NHẤT của hai kiểu này; ba module còn lại import từ đó, không tự khai báo lại.
- Produces:

```ts
export type BoardScore = number[]          // vector từ điển, so theo thứ tự phần tử
export type ObjectiveName = 'lex' | 'cost'
export function scoreBoard(board: BoardSnapshot, ctx: ConstraintContext, objective: ObjectiveName): BoardScore
export function isBetter(a: BoardScore, b: BoardScore, epsilon: number): boolean
```

`scoreBoard(..., 'lex')` trả sáu phần tử theo spec §4: `[repeat3Courts, overTolCourts, overTolTotal, restDebt, intraExcessTotal, qualityCost]`.
`scoreBoard(..., 'cost')` trả `[qualityCost]` — một phần tử, để `isBetter` dùng chung một đường code.

- [ ] **Step 1: Test đỏ**

```ts
test('lex: ít lặp-3 hơn luôn thắng, dù cost cao hơn', () => {
  const worseRepeat = [1, 0, 0, 0, 0, 1.0]
  const betterRepeat = [0, 3, 2.5, 0, 0, 9.9]
  expect(isBetter(betterRepeat, worseRepeat, 0.01)).toBe(true)
})

test('cost: chênh dưới epsilon không tính là tốt hơn', () => {
  expect(isBetter([2.500], [2.505], 0.01)).toBe(false)
})
```

- [ ] **Step 2: Chạy, xác nhận đỏ.** Run lệnh jest tương ứng; Expected: FAIL (module chưa có).

- [ ] **Step 3: Cài đặt**

```ts
export function isBetter(a: BoardScore, b: BoardScore, epsilon: number): boolean {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] ?? 0, bv = b[i] ?? 0
    const isLastCostTier = i === a.length - 1
    const margin = isLastCostTier ? epsilon : 0
    if (av < bv - margin) return true
    if (av > bv + margin) return false
  }
  return false
}
```

- [ ] **Step 4: Chạy test, xác nhận xanh.**

- [ ] **Step 5: Commit**

```bash
git add lib/next-round-suggester/board-optimizer/objective.ts tests/next-round-suggester/unit/board-optimizer-objective.test.ts
git commit -m "feat(optimizer): lexicographic and cost objectives behind one comparator"
```

---

### Task 4: Bốn nước đi, thứ tự cố định

**Files:**
- Create: `lib/next-round-suggester/board-optimizer/moves.ts`
- Test: `tests/next-round-suggester/unit/board-optimizer-moves.test.ts`

**Interfaces:**
- Consumes: `BoardSnapshot` từ `board-optimizer/constraints.ts` (Task 2)
- Produces:

```ts
export type MoveKind = 'W1' | 'W2' | 'W3' | 'W4'
export type MoveSet = readonly MoveKind[]
export const MOVE_SET_SPLIT_ONLY: MoveSet = ['W1', 'W2', 'W4']
export const MOVE_SET_WITH_BENCH: MoveSet = ['W1', 'W2', 'W3', 'W4']
export function* generateMoves(board: BoardSnapshot, benchIds: string[], moveSet: MoveSet): Generator<BoardSnapshot>
```

- [ ] **Step 1: Test đỏ — thứ tự phải tất định và không phụ thuộc thứ tự chèn**

```ts
test('cùng board, hai thứ tự chèn khác nhau vào Set băng ghế → cùng dãy nước đi', () => {
  const a = [...generateMoves(board, ['x', 'y', 'z'], MOVE_SET_WITH_BENCH)].map(key)
  const b = [...generateMoves(board, ['z', 'y', 'x'], MOVE_SET_WITH_BENCH)].map(key)
  expect(a).toEqual(b)
})

test('W3 bị tắt thì không nước đi nào đổi tập người chơi', () => {
  const seedSet = playerSetKey(board)
  for (const candidate of generateMoves(board, ['x'], MOVE_SET_SPLIT_ONLY)) {
    expect(playerSetKey(candidate)).toBe(seedSet)
  }
})
```

- [ ] **Step 2: Chạy, xác nhận đỏ.**

- [ ] **Step 3: Cài đặt** — sinh theo thứ tự: sân tăng dần → vị trí ghế tăng dần → id người tăng dần (sort `benchIds` một lần ở đầu, không dùng thứ tự truyền vào).

- [ ] **Step 4: Chạy test, xác nhận xanh.**

- [ ] **Step 5: Commit**

```bash
git add lib/next-round-suggester/board-optimizer/moves.ts tests/next-round-suggester/unit/board-optimizer-moves.test.ts
git commit -m "feat(optimizer): four move atoms generated in a fixed, insertion-order-independent sequence"
```

---

### Task 5: Vòng tìm steepest descent

**Files:**
- Create: `lib/next-round-suggester/board-optimizer/index.ts`
- Test: `tests/next-round-suggester/unit/board-optimizer-search.test.ts`
- Test: `tests/next-round-suggester/property/board-optimizer-invariants.test.ts`

**Interfaces:**
- Consumes: `firstViolation`, `BoardSnapshot`, `ConstraintContext`, `ConstraintRejection` (Task 2);
  `scoreBoard`, `isBetter`, `ObjectiveName` (Task 3); `generateMoves`, `MoveSet` (Task 4)
- Produces:

```ts
export type OptimizeOptions = {
  objective: ObjectiveName
  moveSet: MoveSet
  maxIterations: number        // mặc định 30
  onReject?: (reason: ConstraintRejection) => void
  onAccept?: (iteration: number) => void
}
export type OptimizeResult = { board: BoardSnapshot; iterations: number; changed: boolean }
export function optimizeBoard(seed: BoardSnapshot, ctx: ConstraintContext, opts: OptimizeOptions): OptimizeResult
```

- [ ] **Step 1: Test đỏ — ba tính chất**

```ts
test('không cải thiện được thì trả về đúng board gốc (cùng tham chiếu nội dung)', () => {
  const res = optimizeBoard(seed, ctx, { objective: 'lex', moveSet: MOVE_SET_WITH_BENCH, maxIterations: 30 })
  expect(res.changed).toBe(false)
  expect(res.board).toEqual(seed)
})

test('tất định: chạy hai lần cho kết quả giống hệt', () => {
  const a = optimizeBoard(seed, ctx, opts).board
  const b = optimizeBoard(seed, ctx, opts).board
  expect(JSON.stringify(a)).toBe(JSON.stringify(b))
})

test('không bao giờ trả board vi phạm ràng buộc cứng', () => {
  const res = optimizeBoard(seed, ctx, opts)
  expect(firstViolation(res.board, ctx)).toBeNull()
})
```

Property test (fuzz có seed, 200 board sinh ngẫu nhiên bằng `seedrandom`, đúng khuôn `tests/next-round-suggester/property/`): với mọi board, `firstViolation(result) === null` **và** `isBetter(scoreBoard(seed), scoreBoard(result))` là `false` — tức kết quả không bao giờ tệ hơn seed.

- [ ] **Step 2: Chạy, xác nhận đỏ.**

- [ ] **Step 3: Cài đặt**

```ts
export function optimizeBoard(seed, ctx, opts): OptimizeResult {
  let current = seed
  let currentScore = scoreBoard(current, ctx, opts.objective)
  for (let iteration = 0; iteration < opts.maxIterations; iteration++) {
    let best: BoardSnapshot | null = null
    let bestScore = currentScore
    for (const candidate of generateMoves(current, ctx.benchIds, opts.moveSet)) {
      const rejection = firstViolation(candidate, ctx)
      if (rejection) { opts.onReject?.(rejection); continue }
      const score = scoreBoard(candidate, ctx, opts.objective)
      if (!isBetter(score, bestScore, EPSILON)) continue
      best = candidate; bestScore = score
    }
    if (!best) return { board: current, iterations: iteration, changed: current !== seed }
    current = best; currentScore = bestScore
    opts.onAccept?.(iteration)
  }
  return { board: current, iterations: opts.maxIterations, changed: current !== seed }
}
```

- [ ] **Step 4: Chạy cả hai test file, xác nhận xanh.**

- [ ] **Step 5: Commit**

```bash
git add lib/next-round-suggester/board-optimizer/index.ts tests/next-round-suggester/unit/board-optimizer-search.test.ts tests/next-round-suggester/property/board-optimizer-invariants.test.ts
git commit -m "feat(optimizer): deterministic steepest descent with a per-iteration budget"
```

---

### Task 6: Cờ và chỗ cắm vào engine

**Files:**
- Create: `lib/next-round-suggester/board-optimizer-flag.ts`
- Modify: `lib/next-round-suggester/live-preview.ts:5725-5789`
- Test: `tests/next-round-suggester/unit/board-optimizer-integration.test.ts`

**Interfaces:**
- Consumes: `optimizeBoard` (Task 5)
- Produces: `isBoardOptimizerEnabled(state?): boolean`, `resolveBoardOptimizerEnabledForSession(sessionId: string): boolean`

Copy nguyên khuôn `quality-cost-flag.ts` (đọc `SESSION_BOARD_OPTIMIZER` + allowlist `SESSION_BOARD_OPTIMIZER_SESSION_IDS`, allowlist rỗng = không session nào, có `__setBoardOptimizerOverrideForTests`).

- [ ] **Step 1: Test đỏ — cờ tắt không đổi gì, cờ bật thì optimizer chạy**

```ts
test('cờ TẮT: board ra y hệt đường cũ', () => {
  __setBoardOptimizerOverrideForTests(false)
  expect(buildSuggestedMatchPayloads(args)).toEqual(baselineBoard)
})

test('cờ BẬT: optimizer được gọi và board vẫn hợp lệ', () => {
  __setBoardOptimizerOverrideForTests(true)
  const board = buildSuggestedMatchPayloads(args)
  expect(board).toHaveLength(baselineBoard.length)
  expect(hasAvoidedPartnerPair(board, state)).toBe(false)
})
```

- [ ] **Step 2: Chạy, xác nhận đỏ.**

- [ ] **Step 3: Cắm vào**

Tại `:5725–5789`, bọc toàn bộ chuỗi sáu pass:

```ts
const optimizedPayloads = isBoardOptimizerEnabled(state)
  ? runBoardOptimizer(payloads, repairState, pvnaTolerance, { rollingPlanTarget: options.rollingPlanTarget, onInstrument: onRepairInstrument })
  : /* nguyên xi chuỗi 6 pass hiện tại, không sửa một dòng */ jointRepartitionedPayloads
```

Bước chuẩn hoá metadata phía sau (`normalizeRepairedPayload` → `dropStaleDerivedMetadata` → `rebuildDerivedMetadataForSeatedLineup`) **giữ nguyên**, áp cho cả hai nhánh.

- [ ] **Step 4: Chạy test, xác nhận xanh.**

- [ ] **Step 5: Chứng minh nhánh TẮT không bị đụng**

Run: `npx tsx scratch/board-scorecard.ts 60 scratch/out/p22-flagoff.json`
Expected: `board_hash` = `f1b6d8ac0b0c`. Lệch = nhánh cũ đã bị đụng, phải sửa trước khi đi tiếp.

- [ ] **Step 6: Gate + commit**

```bash
npx jest --testMatch "**/tests/**/*.test.ts" --testMatch "**/tests/**/*.test.tsx" --forceExit
npx tsc --noEmit
git add lib/next-round-suggester/board-optimizer-flag.ts lib/next-round-suggester/live-preview.ts tests/next-round-suggester/unit/board-optimizer-integration.test.ts
git commit -m "feat(optimizer): wire behind a per-session flag, default off"
```

---

### Task 7: Đo ma trận 3 tập nước đi × 2 thước đo

**Files:**
- Modify: `scratch/board-scorecard.ts` (đọc biến môi trường + đếm)
- Create: `scratch/out/p22-matrix.md` (bảng kết quả)

- [ ] **Step 1: Cho harness nhận tham số và đếm**

`board-scorecard.ts` đọc `OPT=1|0`, `OPT_MOVES=split|bench|bench_unbounded`, `OPT_OBJ=lex|cost`; in thêm: số board optimizer **được gọi**, số board **bị đổi**, và bảng lý do từ chối theo `ConstraintRejection`.

- [ ] **Step 2: Khẳng định phép đo có chạy trước khi tin số**

Chạy một lượt `OPT=1` và kiểm `optimizer_invoked > 0`. Nếu bằng 0 thì phép đo hỏng — dừng, đừng ghi số. (Đây đúng cái bẫy đã trả giá bốn lần trong TASK.md.)

- [ ] **Step 3: Chạy bảy lượt**

```bash
npx tsx scratch/board-scorecard.ts 60 scratch/out/p22-before.json                      # baseline, đã có
OPT=1 OPT_MOVES=split           OPT_OBJ=lex  npx tsx scratch/board-scorecard.ts 60 scratch/out/p22-split-lex.json
OPT=1 OPT_MOVES=split           OPT_OBJ=cost npx tsx scratch/board-scorecard.ts 60 scratch/out/p22-split-cost.json
OPT=1 OPT_MOVES=bench           OPT_OBJ=lex  npx tsx scratch/board-scorecard.ts 60 scratch/out/p22-bench-lex.json
OPT=1 OPT_MOVES=bench           OPT_OBJ=cost npx tsx scratch/board-scorecard.ts 60 scratch/out/p22-bench-cost.json
OPT=1 OPT_MOVES=bench_unbounded OPT_OBJ=lex  npx tsx scratch/board-scorecard.ts 60 scratch/out/p22-unbounded-lex.json
OPT=1 OPT_MOVES=bench_unbounded OPT_OBJ=cost npx tsx scratch/board-scorecard.ts 60 scratch/out/p22-unbounded-cost.json
```

- [ ] **Step 4: Viết bảng so vào `scratch/out/p22-matrix.md`**

Cột: `repeat3 · over_tol · blowout · intra_over_cap · avg_cost · panel · play_spread · worst_rest · seated_at_or_past_rest · board đổi · board đổi mà 6 pass cũ không đụng`. Hàng: baseline + 6 cấu hình.

- [ ] **Step 5: Commit**

```bash
git add scratch/board-scorecard.ts scratch/out/p22-matrix.md
git commit -m "test(optimizer): corpus matrix over three move sets and two objectives"
```

---

### Task 8: Chốt cấu hình và ghi lại kết luận

**Files:**
- Modify: `lib/next-round-suggester/board-optimizer/index.ts` (đặt mặc định theo bảng)
- Modify: `TASK.md`
- Modify: `docs/superpowers/specs/2026-08-13-board-optimizer-design.md` (ghi kết quả thật vào spec)

- [ ] **Step 1: Chọn cấu hình bằng bảng, không bằng lập luận**

Điều kiện: HARD = 0 vi phạm · `repeat3` và `over_tol` không tệ hơn baseline · trong số cấu hình đạt, lấy cấu hình tốt nhất theo thứ tự `repeat3 → over_tol → worst_rest → avg_cost`.

- [ ] **Step 2: Nếu `bench_unbounded` không hơn `bench` quá 1 điểm phần trăm ở mọi cột**

Ghi vào spec §10: phương án "chọn lại toàn bộ 4 người mỗi sân" **chết bằng số**, không làm. Nếu hơn rõ, ghi lại con số và để lại thành mục treo, không mở rộng phạm vi trong lần này.

- [ ] **Step 3: Ghi rõ điều CHƯA chứng minh**

`invariantSafePayloads` (#70) **chưa xoá vật lý** — nhánh cờ-tắt vẫn cần nó. Chỉ xoá được sau khi cờ bật mặc định, và việc đó nằm ngoài lần này (không deploy).

- [ ] **Step 4: Commit**

```bash
git add lib/next-round-suggester/board-optimizer/index.ts TASK.md docs/superpowers/specs/2026-08-13-board-optimizer-design.md
git commit -m "docs(optimizer): pick the shipped configuration from the corpus matrix"
```

---

## Ghi chú cho người thực thi

- **Đừng tin một con số không đổi.** Nếu sau khi bật cờ mà scorecard ra đúng hash baseline, đó gần như chắc chắn là optimizer không chạy, không phải optimizer vô dụng. Kiểm `optimizer_invoked` trước.
- **Đừng chạy gate song song với scorecard.** Suite host-live dùng đồng hồ thật; máy tải nặng làm chín suite đỏ oan (đã gặp trong chính phiên này). Chạy tuần tự khi cần kết luận.
- **Đừng sửa nhánh cờ-tắt.** Nó là bảo chứng lùi được duy nhất, và được kiểm bằng hash `f1b6d8ac0b0c`.
