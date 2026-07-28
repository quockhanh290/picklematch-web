# Host-Live Logic/UI Separation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rút toàn bộ business logic (preview state-machine, mutation lifecycle, telemetry, schedule generation) ra khỏi các god-component của cụm host-live vào hook/module thuần, để chuẩn bị cho một đợt redesign UI mà không phải chạm logic.

**Architecture:** Áp dụng pattern "house standard" đã tồn tại trong repo — `use*Controller` hook (logic + state) + `api.ts` (I/O) + screen mỏng chỉ render. Cụm next-round-v2 đã tách tốt lớp dưới (`api.ts`, `preview.ts`, `useNextRoundModel.ts`); đợt này tách nốt lớp orchestration đỉnh trong `NextRoundSuggesterScreenV2.tsx` (~4387 dòng) và `HostMatchScreen.tsx` (~1731 dòng). Toàn bộ là refactor **behavior-preserving thuần** — không đổi hành vi, không đổi pixel UI.

**Tech Stack:** React Native + Expo, TypeScript strict, React Query, Jest + jest-expo, React Native Testing Library (`@testing-library/react-native`).

## Global Constraints

- **Behavior-preserving tuyệt đối:** KHÔNG đổi output đề xuất, KHÔNG đổi UI/pixel, KHÔNG đổi thứ tự side-effect. Mỗi task chỉ di chuyển code, không sửa logic. Nếu phát hiện bug trong lúc tách → GHI vào SCRATCHPAD.md, KHÔNG sửa kèm (tách bug fix ra PR riêng để bisect được).
- **KHÔNG chạm engine:** `lib/next-round-suggester/**` không được sửa. Đã verify sạch React (0 import). Nếu một task tưởng cần sửa engine → dừng, xem lại ranh giới.
- **Characterization-test-first:** Phần rủi ro cao (preview orchestrator, mutation) PHẢI có test chụp hành vi hiện tại PASS trên code cũ TRƯỚC khi tách; sau khi tách test vẫn PASS = bằng chứng behavior-preserving.
- **Version guard:** KHÔNG bump `LIVE_PREVIEW_ALGORITHM_VERSION` (refactor không đổi thuật toán).
- **Typecheck guard:** mỗi task kết thúc phải qua `npm run typecheck:guard` (không thêm lỗi type mới vs baseline) và `npm run lint:errors`.
- **Commit nhỏ, thường xuyên:** mỗi task 1 commit. Prefix `refactor(host-live):`.
- **Đường dẫn import:** dùng alias `@/`, không đuôi file, không relative `../..` xuyên feature.

---

## File Structure (đích)

Thư mục làm việc: `features/host/session-detail/`

**Tạo mới:**
- `next-round-v2/preview-helpers.ts` — pure functions gom từ module-scope của screen (signature, pvna-gap, swap). Không React.
- `next-round-v2/hooks/usePreviewTelemetry.ts` — bọc traceClientPreviewEvent + stuck-tracker.
- `next-round-v2/hooks/useLiveMatchMutations.ts` — start/complete/cancel/fetchAvailablePool lifecycle.
- `next-round-v2/hooks/usePreviewOrchestrator.ts` — state-machine preview (effect 1410 dòng + ~20 ref).
- `next-round-v2/hooks/useScrollDebug.ts` — scroll/viewport debug (không nghiệp vụ).
- `host-match/scheduleGenerators.ts` — logic sinh lịch thuần (fixed + round-robin) rút từ HostMatchScreen. Không React.
- `host-match/useHostMatchController.ts` — state + mutation của HostMatchScreen.
- Test tương ứng trong `tests/host-live/` (xem từng task).

**Sửa (mỏng dần):**
- `NextRoundSuggesterScreenV2.tsx` — cuối cùng chỉ còn: gọi các hook + render JSX.
- `HostMatchScreen.tsx` — cuối cùng chỉ còn: gọi `useHostMatchController` + render.

**Không đụng:** `lib/next-round-suggester/**`, `next-round-v2/api.ts`, `next-round-v2/preview.ts`, `next-round-v2/components/ScreenComponents.tsx` (split file để sau, không thuộc đợt này).

---

## Phase A — Lưới an toàn (Safety net)

### Task A1: Dựng hạ tầng test cho screen host-live

**Files:**
- Create: `tests/host-live/helpers/renderHostLive.tsx` (test harness: QueryClientProvider + mock supabase/edge)
- Create: `tests/host-live/helpers/fixtures.ts` (SessionState + live rows mẫu)
- Test: (task này CHÍNH là hạ tầng, verify bằng 1 smoke render)

**Interfaces:**
- Produces: `renderHostLiveScreen(props?: Partial<NextRoundSuggesterV2Props>): RenderResult` — render screen với providers + mock đã cắm.
- Produces: `makeSessionFixture(overrides?): { players, liveRows, snapshot }` — dữ liệu ổn định (seed cố định) cho test.

- [ ] **Step 1: Xác định mock boundary**

Đọc `next-round-v2/api.ts` (23 fn export) để biết các hàm I/O cần mock (edge suggest, replace_courts, complete, cancel). Ghi danh sách hàm + chữ ký vào đầu `renderHostLive.tsx` dưới dạng comment. Mock ở tầng `api.ts` (không mock `supabase` thô) để test ổn định.

- [ ] **Step 2: Viết harness**

```tsx
// tests/host-live/helpers/renderHostLive.tsx
import { render } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextRoundSuggesterScreenV2 } from '@/features/host/session-detail/NextRoundSuggesterScreenV2'

export function renderHostLiveScreen(props = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const defaults = { sessionId: 'test-session', courts: 3 }
  return render(
    <QueryClientProvider client={queryClient}>
      <NextRoundSuggesterScreenV2 {...defaults} {...props} />
    </QueryClientProvider>,
  )
}
```

- [ ] **Step 3: Smoke test render**

```tsx
// tests/host-live/smoke.test.tsx
import { renderHostLiveScreen } from './helpers/renderHostLive'
it('renders host-live screen without crashing', () => {
  const { toJSON } = renderHostLiveScreen()
  expect(toJSON()).toBeTruthy()
})
```

- [ ] **Step 4: Chạy — verify PASS**

Run: `npx jest tests/host-live/smoke.test.tsx`
Expected: PASS (nếu FAIL vì thiếu mock nativewind/gesture → thêm vào `tests/jest.setup.ts` theo mẫu `tests/mocks/`).

- [ ] **Step 5: Commit**

```bash
git add tests/host-live/
git commit -m "test(host-live): add screen test harness + fixtures"
```

### Task A2: Characterization test — happy-path preview + fill 1 sân

**Files:**
- Test: `tests/host-live/characterization/preview-happy-path.test.tsx`

**Interfaces:**
- Consumes: `renderHostLiveScreen`, `makeSessionFixture` (A1).

- [ ] **Step 1: Liệt kê hành vi cần pin (đọc trước)**

Đọc `NextRoundSuggesterScreenV2.tsx:2366-3776` (effect orchestrator) + `1660-1954` (completeLiveMatch). Ghi ra 4 hành vi quan sát được cần chụp: (a) mount → gọi edge preview đúng 1 lần sau debounce 80ms; (b) preview trả full board → render N `SuggestedLiveMatchCard`; (c) complete 1 sân → gọi `replace_courts` (mini-recover) KHÔNG full-board; (d) event `traceClientPreviewEvent` phát ra đúng chuỗi.

- [ ] **Step 2: Viết test chụp hành vi (a)+(b)**

```tsx
import { renderHostLiveScreen, makeSessionFixture } from '../helpers/renderHostLive'
import * as api from '@/features/host/session-detail/next-round-v2/api'

it('mount → requests edge preview once, renders returned board', async () => {
  const fx = makeSessionFixture()
  const spy = jest.spyOn(api, 'requestLiveSuggestionPreview').mockResolvedValue(fx.previewResponse)
  const { findAllByTestId } = renderHostLiveScreen()
  const cards = await findAllByTestId('suggested-live-match-card')
  expect(spy).toHaveBeenCalledTimes(1)
  expect(cards).toHaveLength(fx.previewResponse.matches.length)
})
```
(Tên hàm `requestLiveSuggestionPreview` + testID `suggested-live-match-card` xác định ở Step 1 khi đọc; nếu khác, dùng tên thật.)

- [ ] **Step 3: Chạy — verify PASS trên code CŨ**

Run: `npx jest tests/host-live/characterization/preview-happy-path.test.tsx`
Expected: PASS. Đây là baseline. Nếu không pin được (quá nhiều state ẩn) → đó là tín hiệu component quá coupled; ghi lại và chuyển sang pin ở mức thấp hơn (test `usePreviewOrchestrator` sau khi tách ở E, với vòng lặp: viết test mong đợi → tách → xanh).

- [ ] **Step 4: Commit**

```bash
git add tests/host-live/characterization/
git commit -m "test(host-live): characterize happy-path preview + fill"
```

### Task A3: Characterization test — defer + incomplete-retry + conflict

**Files:**
- Test: `tests/host-live/characterization/preview-retry-defer.test.tsx`

- [ ] **Step 1: Pin retry incomplete**

Đọc `NextRoundSuggesterScreenV2.tsx:3155-3220` (incomplete retry) + hằng `LIVE_PREVIEW_INCOMPLETE_RETRY_MS=900`, `LIVE_PREVIEW_BLOCKED_RETRY_MS=6000`. Test dùng `jest.useFakeTimers()`.

```tsx
it('incomplete board → retries after 900ms, blocks after 2 tries', async () => {
  jest.useFakeTimers()
  const fx = makeSessionFixture()
  const spy = jest.spyOn(api, 'requestLiveSuggestionPreview')
    .mockResolvedValue({ ...fx.previewResponse, previewBatchComplete: false })
  renderHostLiveScreen()
  await jest.advanceTimersByTimeAsync(80)      // debounce
  expect(spy).toHaveBeenCalledTimes(1)
  await jest.advanceTimersByTimeAsync(900)     // retry 1
  await jest.advanceTimersByTimeAsync(900)     // retry 2
  expect(spy).toHaveBeenCalledTimes(3)
  // sau 2 lần → vào blocked cooldown, không spin 900ms nữa
  await jest.advanceTimersByTimeAsync(900)
  expect(spy).toHaveBeenCalledTimes(3)
})
```

- [ ] **Step 2: Chạy — verify PASS trên code cũ**

Run: `npx jest tests/host-live/characterization/preview-retry-defer.test.tsx`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/host-live/characterization/
git commit -m "test(host-live): characterize incomplete-retry + block cooldown"
```

---

## Phase B — Trích pure functions (rủi ro thấp nhất)

### Task B1: Gom pure helpers vào `preview-helpers.ts`

**Files:**
- Create: `features/host/session-detail/next-round-v2/preview-helpers.ts`
- Modify: `NextRoundSuggesterScreenV2.tsx` (xoá 3 định nghĩa module-scope, import lại)
- Test: `tests/host-live/preview-helpers.test.ts`

**Interfaces:**
- Produces:
  - `getSuggestedMatchSignature(match: Pick<SessionLiveMatchRow,'team_a'|'team_b'>): string`
  - `getSuggestedMatchPvnaGap(match: Pick<SessionLiveMatchRow,'team_a'|'team_b'>, state: SessionState): number`
  - `swapPlayersInSuggestedMatch(match: SuggestedLiveMatchRow, fromId: string, toId: string): SuggestedLiveMatchRow`
- Ghi chú: cả 3 HIỆN đã ở module-scope trong screen (dòng 502, 507, 4172) — thuần, không dùng React/closure. Chỉ di chuyển + export + test.

- [ ] **Step 1: Viết test trước (dựa hành vi đã biết)**

```ts
// tests/host-live/preview-helpers.test.ts
import { getSuggestedMatchSignature, swapPlayersInSuggestedMatch } from '@/features/host/session-detail/next-round-v2/preview-helpers'

it('signature is order-independent within a team', () => {
  const a = { team_a: ['1','2'], team_b: ['3','4'] }
  const b = { team_a: ['2','1'], team_b: ['4','3'] }
  expect(getSuggestedMatchSignature(a)).toBe(getSuggestedMatchSignature(b))
})

it('swap exchanges two players across teams and fixes resting', () => {
  const match = { team_a: ['1','2'], team_b: ['3','4'], resting: ['5'] } as any
  const out = swapPlayersInSuggestedMatch(match, '2', '5')
  expect(out.team_a).toContain('5')
  expect(out.team_a).not.toContain('2')
  expect(out.resting).toContain('2')
})
```

- [ ] **Step 2: Chạy — verify FAIL (module chưa tồn tại)**

Run: `npx jest tests/host-live/preview-helpers.test.ts`
Expected: FAIL "Cannot find module preview-helpers".

- [ ] **Step 3: Tạo `preview-helpers.ts`**

Cắt nguyên văn 3 hàm từ screen (dòng 502-505, 507-513, 4172-4190+) vào file mới, thêm `export`, import type cần thiết (`SessionLiveMatchRow`, `SuggestedLiveMatchRow`, `SessionState`).

- [ ] **Step 4: Sửa screen dùng import**

Xoá 3 định nghĩa cũ trong `NextRoundSuggesterScreenV2.tsx`, thêm:
```ts
import { getSuggestedMatchSignature, getSuggestedMatchPvnaGap, swapPlayersInSuggestedMatch } from './next-round-v2/preview-helpers'
```

- [ ] **Step 5: Chạy test + typecheck + lint**

Run: `npx jest tests/host-live/preview-helpers.test.ts && npm run typecheck:guard && npm run lint:errors`
Expected: PASS cả ba. Chạy lại A2/A3 để chắc screen không đổi hành vi.

- [ ] **Step 6: Commit**

```bash
git add features/host/session-detail/next-round-v2/preview-helpers.ts tests/host-live/preview-helpers.test.ts features/host/session-detail/NextRoundSuggesterScreenV2.tsx
git commit -m "refactor(host-live): extract pure preview helpers to preview-helpers.ts"
```

### Task B2: Trích `incrementPair` thành pure (nhận players map)

**Files:**
- Modify: `preview-helpers.ts` (thêm hàm), `NextRoundSuggesterScreenV2.tsx`
- Test: `tests/host-live/preview-helpers.test.ts` (bổ sung)

**Interfaces:**
- Produces: `applyPairIncrement(players: Map<string, PlayerSessionState>, playerAId: string, playerBId: string, type: 'partner'|'opponent'): void` — mutate map truyền vào (giữ nguyên semantics cũ: cập nhật partner/opponent_counts cả 2 chiều).

- [ ] **Step 1: Test**

```ts
it('applyPairIncrement bumps partner counts both directions', () => {
  const players = new Map([
    ['A', { partner_counts: new Map(), opponent_counts: new Map() } as any],
    ['B', { partner_counts: new Map(), opponent_counts: new Map() } as any],
  ])
  applyPairIncrement(players, 'A', 'B', 'partner')
  expect(players.get('A').partner_counts.get('B')).toBe(1)
  expect(players.get('B').partner_counts.get('A')).toBe(1)
})
```

- [ ] **Step 2: Chạy — FAIL**

Run: `npx jest tests/host-live/preview-helpers.test.ts -t applyPairIncrement`
Expected: FAIL.

- [ ] **Step 3: Chuyển hàm** — copy thân `incrementPair` (screen dòng 353), đổi thành nhận `players` làm tham số đầu, export. Trong screen, thay lời gọi `incrementPair(a,b,t)` → `applyPairIncrement(players, a, b, t)`.

- [ ] **Step 4: Chạy test + typecheck + A2/A3**

Run: `npx jest tests/host-live/ && npm run typecheck:guard`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "refactor(host-live): make pair-increment a pure helper"
```

### Task B3: Trích scroll/viewport debug → `useScrollDebug`

**Files:**
- Create: `next-round-v2/hooks/useScrollDebug.ts`
- Modify: `NextRoundSuggesterScreenV2.tsx`
- Test: `tests/host-live/useScrollDebug.test.ts`

**Interfaces:**
- Produces: `useScrollDebug(): { scrollDebugMetrics, updateScrollDebugMetrics, webViewportHeight }` — gom `scrollDebugMetrics` state + `updateScrollDebugMetrics` (screen ~784) + `webViewportHeight`. KHÔNG liên quan nghiệp vụ preview.

- [ ] **Step 1: Đọc + xác định state liên quan** — đọc screen quanh `updateScrollDebugMetrics` (784), `webViewportHeight`, `scrollDebugMetrics` để gom trọn cụm (không sót ref/effect).

- [ ] **Step 2: Test hook bằng renderHook**

```ts
import { renderHook, act } from '@testing-library/react-native'
import { useScrollDebug } from '@/features/host/session-detail/next-round-v2/hooks/useScrollDebug'
it('updates metrics on layout event', () => {
  const { result } = renderHook(() => useScrollDebug())
  act(() => result.current.updateScrollDebugMetrics({ height: 800 } as any))
  expect(result.current.scrollDebugMetrics).toBeTruthy()
})
```

- [ ] **Step 3: FAIL → tạo hook → PASS** (chuyển state+callback vào hook, screen destructure lại).

Run: `npx jest tests/host-live/useScrollDebug.test.ts && npm run typecheck:guard`

- [ ] **Step 4: Commit**

```bash
git commit -am "refactor(host-live): extract scroll-debug into useScrollDebug hook"
```

---

## Phase C — Trích telemetry → `usePreviewTelemetry`

### Task C1: Bọc traceClientPreviewEvent + stuck-tracker vào hook

**Files:**
- Create: `next-round-v2/hooks/usePreviewTelemetry.ts`
- Modify: `NextRoundSuggesterScreenV2.tsx`
- Test: `tests/host-live/usePreviewTelemetry.test.ts`

**Interfaces:**
- Produces: `usePreviewTelemetry(sessionId: string): { trace: (event: string, detail?: object) => void, resolveStuckTracker: (...) => void, stuckHint }` — gom `traceClientPreviewEvent` (screen 607), `stuckTrackerRef` (598), `resolveStuckTracker` (869), `lastStuckHintRef`.
- Consumes: `api.ts` audit-queue push (giữ nguyên đường persist hiện có — chỉ di chuyển, không đổi).

- [ ] **Step 1: Đọc + map** — đọc screen 598-640 + 869-980 để gom trọn ref/callback telemetry; xác định `trace` được gọi ở đâu (grep `traceClientPreviewEvent(` trong screen) để biết interface phải expose.

- [ ] **Step 2: Test hook**

```ts
it('trace forwards event to audit queue with sessionId', () => {
  const push = jest.spyOn(api, 'enqueueClientAuditEvent').mockImplementation(() => {})
  const { result } = renderHook(() => usePreviewTelemetry('s1'))
  act(() => result.current.trace('client_preview_blocked_incomplete_noop', { court: 2 }))
  expect(push).toHaveBeenCalledWith(expect.objectContaining({ session_id: 's1', event_type: 'client_preview_blocked_incomplete_noop' }))
})
```
(Tên `enqueueClientAuditEvent` xác nhận khi đọc `api.ts`.)

- [ ] **Step 3: FAIL → tạo hook → thay mọi lời gọi trong screen bằng `telemetry.trace(...)` → PASS**

Run: `npx jest tests/host-live/ && npm run typecheck:guard`
Expected: PASS + A2/A3 vẫn xanh (chuỗi event không đổi).

- [ ] **Step 4: Commit**

```bash
git commit -am "refactor(host-live): extract preview telemetry + stuck-tracker into hook"
```

---

## Phase D — Trích mutation lifecycle → `useLiveMatchMutations`

### Task D1: Map + interface mutation

**Files:**
- Create: `next-round-v2/hooks/useLiveMatchMutations.ts` (khung + interface, chưa move thân)
- Test: (không — task map)

**Interfaces:**
- Produces (khung, thân move ở D2-D4):
  - `startLiveMatch(match: SuggestedLiveMatchRow, courtIdx: number): Promise<ActionResult>`
  - `completeLiveMatch(matchId: string, scores: ScoreInput): Promise<ActionResult>`
  - `cancelLiveMatch(matchId: string): Promise<ActionResult>`
  - `fetchAvailablePoolPreview(courtIdx: number): Promise<void>`
  - Trả về cả state cờ mutation: `{ startingPreviewIds, endingLiveMatchIds, completingLiveMatchPlaceholders, completedLiveMatchCommitNonce, ... }`

- [ ] **Step 1: Đọc trọn 4 handler** — screen `startLiveMatch` (1205-~1524), `completeLiveMatch` (1660-1954), `cancelLiveMatch`, `fetchAvailablePoolPreview` (1524). Liệt kê: state cờ mỗi handler set, ref đọc, hàm api gọi, thứ tự side-effect (optimistic → edge → reconcile). Ghi bảng dependency vào đầu file hook.

- [ ] **Step 2: Viết khung hook + interface** (chưa move thân, chỉ khai báo + `throw new Error('not moved')`) để chốt chữ ký. Commit.

```bash
git commit -am "refactor(host-live): scaffold useLiveMatchMutations interface"
```

### Task D2: Move `startLiveMatch`

**Files:**
- Modify: `useLiveMatchMutations.ts`, `NextRoundSuggesterScreenV2.tsx`
- Test: `tests/host-live/characterization/start-live-match.test.tsx`

- [ ] **Step 1: Characterization test hành vi start (trên code CŨ trước)**

```tsx
it('start → optimistic add, calls edge start, on success keeps match', async () => {
  const fx = makeSessionFixture()
  const spy = jest.spyOn(api, 'startLiveMatchOnEdge').mockResolvedValue(fx.startOk)
  const { getByTestId, findByTestId } = renderHostLiveScreen()
  fireEvent.press(await findByTestId('start-court-0'))
  expect(spy).toHaveBeenCalledTimes(1)
  await findByTestId('live-match-court-0')   // committed
})
```
Chạy trên screen cũ → PASS (baseline). Commit test.

- [ ] **Step 2: Move thân `startLiveMatch`** vào hook; screen gọi `mutations.startLiveMatch`. Giữ NGUYÊN thứ tự optimistic/edge/reconcile.

- [ ] **Step 3: Chạy — verify test vẫn PASS**

Run: `npx jest tests/host-live/characterization/start-live-match.test.tsx && npm run typecheck:guard`
Expected: PASS (behavior-preserving).

- [ ] **Step 4: Commit**

```bash
git commit -am "refactor(host-live): move startLiveMatch into useLiveMatchMutations"
```

### Task D3: Move `completeLiveMatch`

**Files:** Modify hook + screen. Test: `tests/host-live/characterization/complete-live-match.test.tsx`

- [ ] **Step 1: Characterization test** — complete 1 sân → gọi `replace_courts` (mini-recover), placeholder hiện trong lúc bay, commit-nonce bump. Viết test, chạy PASS trên code cũ, commit.

```tsx
it('complete → mini-recover replace_courts, not full-board', async () => {
  const spy = jest.spyOn(api, 'replaceCourtsOnEdge').mockResolvedValue(makeSessionFixture().replaceOk)
  const fullSpy = jest.spyOn(api, 'requestLiveSuggestionPreview')
  const { findByTestId, getByTestId } = renderHostLiveScreen()
  fireEvent.press(await findByTestId('complete-court-0'))
  fireEvent.press(getByTestId('confirm-scores'))
  await waitFor(() => expect(spy).toHaveBeenCalled())
  expect(fullSpy).not.toHaveBeenCalledWith(expect.objectContaining({ fullBoard: true }))
})
```

- [ ] **Step 2: Move thân** → hook. Screen gọi `mutations.completeLiveMatch`.

- [ ] **Step 3: Test PASS + typecheck + chạy lại A2** — `npx jest tests/host-live/ && npm run typecheck:guard`.

- [ ] **Step 4: Commit** — `refactor(host-live): move completeLiveMatch into useLiveMatchMutations`

### Task D4: Move `cancelLiveMatch` + `fetchAvailablePoolPreview`

**Files:** Modify hook + screen. Test: bổ sung characterization cancel.

- [ ] **Step 1: Test cancel** — cancel → gọi edge cancel, xoá optimistic. PASS trên code cũ. Commit.
- [ ] **Step 2: Move cả 2 handler** vào hook, screen gọi qua `mutations.*`.
- [ ] **Step 3: Test PASS + typecheck + A2/A3 xanh.**
- [ ] **Step 4: Commit** — `refactor(host-live): move cancel + available-pool into useLiveMatchMutations`

---

## Phase E — Trích preview state-machine → `usePreviewOrchestrator` (RỦI RO CAO)

> ⚠️ Đây là ~1410 dòng effect (2366-3776) + ~20 useRef liên khóa (580-595). KHÔNG tách một phát. Đi từng lát mỏng, mỗi lát 1 commit + chạy A2/A3/D-tests. Nếu bất kỳ characterization test đỏ → revert lát đó, xem lại.

### Task E1: Đẩy hết pure predicate ra ngoài effect (chưa tạo hook)

**Files:**
- Modify: `next-round-v2/preview-consistency.ts` (đã có `isPreviewBatchCacheCurrent`, `hasPendingPlanAdoption`) — thêm predicate còn inline.
- Modify: `NextRoundSuggesterScreenV2.tsx`
- Test: `tests/host-live/preview-predicates.test.ts`

**Interfaces:**
- Produces (thuần, không React): các predicate hiện tính inline trong effect — ví dụ `shouldRequestFullBoardPreview(input): boolean`, `hasGenuinePreviewQualityViolation(...)`. Đọc effect 2450-2540 để lấy chữ ký chính xác.

- [ ] **Step 1: Grep predicate inline** trong effect (2366-3776): các biến `const shouldX = ...` / `hasX(...)` là hàm thuần. Liệt kê cái nào không phụ thuộc ref/state (thuần từ input) → ứng viên tách.
- [ ] **Step 2: Với mỗi predicate: viết unit test** (input → bool) trước, FAIL, move ra `preview-consistency.ts`, PASS. Một predicate = một commit.
- [ ] **Step 3: Chạy A2/A3 sau mỗi predicate** — đảm bảo effect vẫn dùng đúng.
- [ ] **Step 4: Commit từng cái** — `refactor(host-live): extract <name> predicate to preview-consistency`

### Task E2: Bọc toàn bộ effect + ref vào `usePreviewOrchestrator` (giữ nguyên internal)

**Files:**
- Create: `next-round-v2/hooks/usePreviewOrchestrator.ts`
- Modify: `NextRoundSuggesterScreenV2.tsx`
- Test: chạy LẠI toàn bộ `tests/host-live/characterization/**` (không viết mới — đây là move thuần).

**Interfaces:**
- Produces: `usePreviewOrchestrator(deps): { suggestedLiveMatches, isSuggestingPreview, courtShortageBreakdown, qualityDeferredCourts, requestPreview }` — bọc trọn ~20 preview-ref + effect 1410 dòng. `deps` gồm: `sessionId`, `state`, `phase`, `previewRequestKey`, `previewLaneCacheKey`, các giá trị từ `useNextRoundModel`, `telemetry` (C1), `mutations` (D). Internal (ref/effect) giữ NGUYÊN VĂN, chỉ chuyển hộ khẩu.

- [ ] **Step 1: Move nguyên khối** — cắt 20 ref (580-595) + effect (2366-3776) + các setState liên quan (suggestedLiveMatches, isSuggestingPreview, courtShortageBreakdown, qualityDeferredCourts) vào hook. KHÔNG sửa logic bên trong. Screen thay bằng:
```ts
const { suggestedLiveMatches, isSuggestingPreview, courtShortageBreakdown, qualityDeferredCourts, requestPreview } =
  usePreviewOrchestrator({ sessionId, state, phase, previewRequestKey, previewLaneCacheKey, model, telemetry, mutations })
```
- [ ] **Step 2: Sửa dep-array** — dep array cũ (dòng 3776) chuyển vào hook nguyên vẹn. Mọi biến effect đọc phải thành `deps` của hook.
- [ ] **Step 3: Chạy TOÀN BỘ characterization**

Run: `npx jest tests/host-live/ && npm run typecheck:guard && npm run lint:errors`
Expected: PASS tất cả (A2 happy-path, A3 retry-defer, D2-D4 mutations). Đây là bằng chứng behavior-preserving cho lát rủi ro nhất.

- [ ] **Step 4: Smoke thủ công** — `npm run web`, mở 1 session host-live thật, xác nhận: fill sân, complete → mini-recover, defer hiển thị, không kẹt. Ghi kết quả smoke.
- [ ] **Step 5: Commit**

```bash
git commit -am "refactor(host-live): extract preview state-machine into usePreviewOrchestrator"
```

### Task E3: Screen mỏng hoá — kiểm tra dư

**Files:** Modify `NextRoundSuggesterScreenV2.tsx`

- [ ] **Step 1: Đo lại** — `wc -l NextRoundSuggesterScreenV2.tsx`. Mục tiêu: từ ~4387 xuống < ~1200 (chỉ còn hook-calls + JSX render). Nếu còn cụm logic lớn → xác định thuộc hook nào, move nốt.
- [ ] **Step 2: Grep còn sót** — `supabase\.`, `Date.now`, `setTimeout` trong screen: nếu còn nghiệp vụ → chưa sạch. Chỉ được còn ở hook.
- [ ] **Step 3: Chạy toàn bộ test + typecheck + lint. Commit** — `refactor(host-live): thin NextRoundSuggesterScreenV2 to render + hooks`

---

## Phase F — HostMatchScreen

### Task F1: Trích logic sinh lịch → `scheduleGenerators.ts` (thuần)

**Files:**
- Create: `features/host/session-detail/host-match/scheduleGenerators.ts`
- Modify: `HostMatchScreen.tsx`
- Test: `tests/host-live/scheduleGenerators.test.ts`

**Interfaces:**
- Produces (thuần, không React, không supabase):
  - `generateFixedSchedule(input: FixedScheduleInput): GeneratedMatch[]`
  - `generateRoundRobinRound(input: RoundRobinInput): GeneratedMatch[]`
- Ghi chú: logic hiện inline `HostMatchScreen.tsx` ~186-380 + 561-691. Rút phần TÍNH (không phần supabase insert) ra hàm thuần.

- [ ] **Step 1: Đọc + tách ranh giới tính vs I/O** — đọc `handleGenerateFixedSchedule` / `handleGenerateRoundRobinRound`. Phần tính lịch (thuần) tách khỏi phần `supabase.from('session_matches').insert` (giữ ở controller F2).
- [ ] **Step 2: Test thuần**

```ts
import { generateFixedSchedule } from '@/features/host/session-detail/host-match/scheduleGenerators'
it('fixed schedule covers all players without duplicate court clashes', () => {
  const out = generateFixedSchedule({ players: mkPlayers(8), courts: 2, rounds: 3 })
  expect(out).toHaveLength(3 * 2)
  // mỗi round không trùng người 2 sân
})
```

- [ ] **Step 3: FAIL → move phần tính → PASS.** Screen tạm gọi hàm mới, giữ phần insert tại chỗ.
- [ ] **Step 4: typecheck + commit** — `refactor(host-match): extract pure schedule generators`

### Task F2: Gom state + mutation → `useHostMatchController`

**Files:**
- Create: `features/host/session-detail/host-match/useHostMatchController.ts`
- Create: `features/host/session-detail/host-match/api.ts` (supabase I/O: insert/delete session_matches)
- Modify: `HostMatchScreen.tsx`
- Test: `tests/host-live/useHostMatchController.test.ts`

**Interfaces:**
- Produces: `useHostMatchController(sessionId): { matches, generateFixed, generateRoundRobin, saveSchedule, deleteMatch, ...uiState }` — gom 21 useState + 4 supabase.* (chuyển vào `api.ts`).

- [ ] **Step 1: Characterization** — test render HostMatchScreen: generate → save → gọi `api.insertMatches` 1 lần. PASS trên code cũ. Commit.
- [ ] **Step 2: Tạo `api.ts`** — move 4 lời gọi `supabase.from('session_matches')` thành hàm export (`insertMatches`, `deleteMatch`, `fetchMatches`). Test mock.
- [ ] **Step 3: Tạo controller hook** — move 21 useState + handler (gọi `scheduleGenerators` + `api.ts`). Screen destructure.
- [ ] **Step 4: Test PASS + typecheck + lint + smoke thủ công màn Host Match.**
- [ ] **Step 5: Commit** — `refactor(host-match): extract useHostMatchController + api layer`

### Task F3: Mỏng hoá HostMatchScreen

- [ ] **Step 1: Đo lại `wc -l`** (mục tiêu < ~600, chỉ render + controller). Grep `supabase\.` trong screen = 0.
- [ ] **Step 2: Toàn bộ test + typecheck + lint. Commit** — `refactor(host-match): thin HostMatchScreen to render + controller`

---

## Phase G — Chốt

### Task G1: Regression toàn cục + cập nhật tài liệu

- [ ] **Step 1: Chạy full suite** — `npm test && npm run typecheck:guard && npm run lint:errors && npm run sim` (sim để CHẮC engine output không đổi — dù không sửa engine, đây là guard cuối). Expected: PASS, sim targets không đổi vs trước refactor.
- [ ] **Step 2: Smoke e2e** — nếu có `npm run test:e2e` cho host-live, chạy; nếu không, smoke thủ công 1 session đầy đủ (fill → complete nhiều vòng → report).
- [ ] **Step 3: Cập nhật `CLAUDE.md`** — mục "Directory layout": thêm `host-match/` + `next-round-v2/hooks/`; ghi pattern controller-hook là chuẩn cho host-live.
- [ ] **Step 4: Cập nhật `SCRATCHPAD.md`** — đóng mục code-quality audit: đánh dấu đã tách; move bug phát hiện (nếu có) sang "Open questions".
- [ ] **Step 5: Commit** — `docs: record host-live logic/ui separation`

---

## Self-Review

**Spec coverage** (đối chiếu concern trong audit):
1. Preview orchestration state-machine → Phase E ✅
2. Mutation lifecycle → Phase D ✅
3. Conflict/retry recovery → nằm trong D (reconcile) + E2 (effect) ✅
4. Telemetry/stuck-tracker → Phase C ✅
5. Helper thuần → Phase B ✅
6. Scroll/viewport debug → Task B3 ✅
7. HostMatchScreen (sinh lịch + supabase inline) → Phase F ✅
8. Lưới an toàn characterization → Phase A + test đi kèm mỗi phase ✅

**Ràng buộc:** mọi task behavior-preserving, không chạm `lib/`, không bump version, mỗi task có typecheck/lint gate + commit. ✅

**Điểm cần lưu ý khi execute:**
- Task E là rủi ro thật — thứ tự BẮT BUỘC: A (test) → B → C → D → E. KHÔNG nhảy vào E khi chưa có characterization xanh.
- Nếu characterization test KHÔNG pin được hành vi (component quá coupled để test từ ngoài) ở A2/A3 → chuyển chiến lược: tách hook TRƯỚC (E2) rồi test Ở MỨC HOOK (`renderHook`), chấp nhận rủi ro cao hơn, smoke thủ công kỹ hơn. Ghi quyết định vào SCRATCHPAD.
- Tên hàm `api.ts` (`requestLiveSuggestionPreview`, `replaceCourtsOnEdge`, `startLiveMatchOnEdge`, `enqueueClientAuditEvent`) là GIẢ ĐỊNH — Step "đọc" mỗi task xác nhận tên thật trước khi viết test.
