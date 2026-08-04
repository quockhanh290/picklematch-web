# BUGS PHÁT HIỆN TRONG REFACTOR host-live (KHÔNG fix trong đợt tách logic — PR riêng)

- **Hydrate-stomp sau mini-recover** (phát hiện task A2, 2026-07-28): effect hydrate `suggestedLiveMatches` từ DB rows (NextRoundSuggesterScreenV2.tsx:2185-2247) unconditionally overwrite state khi computed key khác, có `activeLiveMatches` trong deps → sau khi mini-recover (replace_courts) fetch bản ephemeral cho sân vừa trống, effect này có thể ĐÈ mất bản đó (chỉ giữ DB-persisted rows). Hệ quả: sân vừa trống có thể không hiện gợi ý thay thế vừa fetch. Chưa verify mức độ ảnh hưởng thật (test A2 chỉ pin request shape, không pin nội dung sân trống). Cần điều tra riêng.
- **LiveMatchBoard dead code**: `ScreenComponents.tsx` export `LiveMatchBoard` nhưng screen render `CourtLaneLiveMatchBoard` (NextRoundSuggesterScreenV2.tsx:168). Xác nhận trước khi task split ScreenComponents di chuyển code board. [ĐÃ XOÁ ở CL1 commit d974f72]
- **buildProjectedStateAfterLiveMatch INCONSISTENCY** (phát hiện FU2, 2026-07-29): 4 bản, nhánh `existingRound` (thêm match vào round đã tồn tại) LỆCH — ScreenComponents.tsx:227 ≡ useLiveBoard.ts:79 GIỮ `r.status`; preview.ts:108 ≡ lib/next-round-suggester/live-preview.ts:586 ÉP `status:'completed'`. Cần quyết bản nào đúng: khi thêm 1 match vào round đang có, round đó nên completed hay giữ status? Bản chạy ở live board = useLiveBoard (giữ r.status). Chưa dedup được tới khi thống nhất behavior. CHƯA fix.
- **`SuggestedLiveMatchRow` bị duplicate 4 lần** (phát hiện task B1, 2026-07-28): screen (cục bộ, không export), `next-round-v2/preview.ts:43` (export), `next-round-v2/components/ScreenComponents.tsx:383` (cục bộ), `lib/next-round-suggester/live-preview.ts:302` (export) — 4 bản khai báo cấu trúc gần giống nhau, không import chéo. TS structural typing khiến chúng "vô tình" tương thích nên chưa gây lỗi biên dịch, nhưng là rủi ro drift (sửa field ở 1 chỗ không tự lan). Task B1 thêm 1 bản thứ 5 trong `preview-helpers.ts` (chỉ dùng nội bộ cho `swapPlayersInSuggestedMatch`) theo đúng tiền lệ hiện có — KHÔNG hợp nhất, ngoài phạm vi B1. Nên gộp về 1 nguồn (`live-preview.ts` có vẻ là source hợp lý nhất, đã export) ở 1 task dọn riêng.
- **`isRecentSuggestedLiveMatch` không được export từ `live-preview.ts`** (phát hiện task B1, 2026-07-28, đã verify pre-existing bằng `git stash` + `tsc --noEmit` trên cây sạch): `next-round-v2/preview.ts:15` import tên này nhưng `lib/next-round-suggester/live-preview.ts` không export nó → `npm run typecheck:guard` báo lỗi TS2305 mới (chưa có trong baseline). Không thuộc phạm vi B1 (không đụng `preview.ts`/`live-preview.ts`), không fix.
- **`getPayloadPvnaGap is not defined`** ở `scripts/diagnostics/simulate-live-preview-policy.ts:430` (phát hiện task B1, 2026-07-28): `npm run lint:errors` báo `no-undef`, pre-existing, ngoài phạm vi B1.
- **E2 BLOCKER — effect-order không bảo toàn được khi gom vào 1 hook** (task E2, 2026-07-28): ~14 effect preview/mutation nằm XEN KẼ với 5 effect ở lại (shell-paint 598, autoRepair 701, focus 798, autoSync 904, AppState 924). Gom hết vào 1 `usePreviewOrchestrator()` → đổi thứ tự đăng ký effect toàn cục. Tương tác nhạy thứ tự cụ thể: session-reset effect (630, move) set `autoRepairStateAttemptedRef.current=false`; autoRepair (701, ở lại) đọc ref đó để quyết fire repair. Khi đổi session vào recap-inconsistent lúc ref đã `true` → thứ tự cũ (reset→autoRepair) fire repair, thứ tự mới (autoRepair→reset) SKIP. Không có vị trí đặt hook nào bảo toàn được (moved effects nằm 2 phía của staying effects). Chỉ cách bảo toàn = kéo cả autoRepair/autoSync/AppState/focus vào hook (runAction/scheduleReconcile/syncRoster giữ ở screen, thread vào deps). → OWNER CHỌN HƯỚNG NÀY (option A: hook rộng `useLiveBoard`). ĐÃ LÀM: gom TẤT CẢ 18 effect vào hook theo ĐÚNG thứ tự nguồn → screen 0 effect → registration order byte-identical. Screen 4148→1155 dòng. Test 5×44 xanh warm, tsc 0 lỗi mới, no-BOM. Verbatim move (hydrate-stomp move nguyên trạng). Deps/output + APP QA CHECKLIST đầy đủ ở `task-E2-report.md`. Owner QA app thật sau rebuild (đặc biệt: session-switch → auto-repair, mục #1 checklist).

---

# SWEEP AUDIT — Scalability & Auditability (2026-07-27)

Phương pháp: 6 agent điều tra song song (đọc code + đo thực `npx tsx` + đọc schema/migration). Các finding CONFIRMED trọng yếu đã tự verify lại bằng đọc code trực tiếp. Read-only, CHƯA sửa gì.

Định nghĩa "đụng engine":
- **Engine core** = `lib/next-round-suggester/{suggest,pair,score,select,classify}.ts` — quyết định ghép trận. Đổi ở đây = ĐỔI OUTPUT → BẮT BUỘC chạy lại `npm run sim` + fairness.
- **Lớp fairness/report** = `lib/next-round-suggester/fairness/` — trong thư mục engine nhưng chỉ tính cảnh báo/điểm, KHÔNG đổi trận ghép.
- **Ngoài engine** = edge functions, migration DB, React client, script → sửa an toàn, không ảnh hưởng thuật toán.

## Bảng ưu tiên (fix nào an toàn?)

| # | Fix | Đụng engine core? | Cần sim? | Rủi ro | Severity |
|---|---|---|---|---|---|
| S1 | Rotate service_role key | ❌ | ❌ | Thấp | 🔴 bảo mật |
| S5 | Bulk-insert instrumentation | ❌ | ❌ | Thấp | 🟠 |
| S4 | Tái dùng snapshot cho audit | ❌ | ❌ | Thấp | 🟠 |
| A1 | Bỏ gate anomaly-dump | ❌ | ❌ | Thấp | 🟡 |
| A2 | Thêm cột timing/correlation + court_unfilled | ⚠️ chỉ thêm log ở live-preview | ❌ | Thấp | 🟡 |
| A3 | Persist client latency | ❌ | ❌ | Thấp | 🟡 |
| A4 | Version → invalidate persisted | ⚠️ logic persist, không đổi output | ❌ | Vận hành | 🟡 |
| A5 | Sync-warning theo phân bố | ⚠️ lớp fairness, không đổi output | ❌ (test cảnh báo riêng) | TB | 🟡 |
| A6a | Persist alternatives để replay | ❌ | ❌ | Thấp | 🟡 |
| **S2** | Deadline-check trong walk | ✅ pair.ts core | ✅ bắt buộc | TB-cao | 🟠 |
| **S3** | Top-K combo fallback | ✅ suggest.ts core | ✅ A/B | Cao | 🟠 |
| A6b | Đổi cắt search sang candidate-count | ✅ core | ✅ | Cao | 🟡 |

→ 9/12 fix KHÔNG đụng engine core (làm ngay được). Chỉ S2/S3/A6b động thuật toán. Nghịch lý: 2 cliff latency nặng nhất (S2, S3) lại chính là 2 cái đụng engine.

## 🔴 SEVERITY 1 — Bảo mật

**S1. Service_role JWT sống bị commit** · active-bug/security · CONFIRMED (tự đọc)
- `scripts/diagnose-session.ts:17` nhúng cứng JWT role=service_role, exp 2089, đã vào git history. Bypass TOÀN BỘ RLS prod.
- Fix: (1) rotate key trên Supabase NGAY; (2) đọc `process.env.SUPABASE_SERVICE_ROLE_KEY`; (3) cân nhắc scrub git history. Đụng engine: ❌.

## 🟠 SEVERITY 2 — Scalability cliff (có ngưỡng đo được)

**S2. Exhaustive partition n=12 KHÔNG interruptible (~4s)** · CONFIRMED (đo 3719ms dù budget 50ms + tự đọc code)
- `pair.ts:702-739`: hàm `walk` chỉ dừng theo `iterations >= maxIterations`, KHÔNG check `maxRuntimeMs`. Deadline chỉ có ở nhánh sampled (`pair.ts:751`). Ngưỡng chính xác: 12 người / 3 sân đủ, cuối buổi (history dày) → 5775 partition không cắt được.
- Ảnh hưởng: full-board suggest treo ~4s (khớp board_stuck 5-8s cũ).
- Fix: thêm vào đầu `walk` dòng `if (options.maxRuntimeMs != null && Date.now() - partitionStartMs >= options.maxRuntimeMs) return` (copy dòng 751).
- Đụng engine: ✅ pair.ts core. Cắt sớm → bỏ partition tối ưu → ĐỔI OUTPUT session 12-người → BẮT BUỘC sim+fairness. Code 1 dòng nhưng verify đắt.

**S3. Per-court fallback O(E⁴): sinh+sort toàn bộ combo trước timeout (~3s ở E≥32)** · CONFIRMED (đo E=48→3095ms + tự đọc)
- `suggest.ts:1104-1112`: `getAllCombinations(eligible,4).sort(...)` tạo+sắp TẤT CẢ C(E,4) TRƯỚC vòng `for` có `timedOut()` (dòng 1112). Phần này không ngắt được.
- Ngưỡng: eligible ≥ ~24-32 (sân vừa mở, busy-set nhỏ, đông người). Sân đầu ăn hết batch-budget 3800ms → sân sau ép về 350ms → gợi ý kém/trống.
- Fix: top-K quanh cửa sổ pvna-sorted (E→~K·E), hoặc cắt sinh combo khi vượt ngưỡng + check timeout trong lúc sinh.
- Đụng engine: ✅ suggest.ts core. Giảm không gian tìm → bỏ combo tối ưu pool rộng → ĐỔI OUTPUT → cần `npm run sim:ab`. Rủi ro TB-cao.

**S4. Audit snapshot_after = 2× snapshot RPC + ghi full jsonb mỗi mutation** · CONFIRMED (tự đọc)
- `supabase/functions/_shared/live-session.ts:173-220`: cờ `includeSnapshotAfter` (bật ~11 edge fn) gọi LẠI `get_live_session_snapshot_versioned` (snapshot đầy đủ lần 2, gồm CTE derive) rồi nhét nguyên jsonb vào `session_audit_events` (append vô hạn).
- Ảnh hưởng: mỗi mutation = 2× RPC nặng + 1 row jsonb O(N²). Tải đọc-ghi gấp đôi khi nhiều session đồng thời; bảng audit phình nhanh.
- Fix: (a) `suggest` đã có `authoritativeSnapshot` (index.ts:854) — tái dùng thay vì gọi RPC lần 2; (b) lưu diff/hash; (c) TTL/partition. Đụng engine: ❌ thuần edge+DB.

**S5. engine_instrumentation insert từng-event, không batch/index/TTL** · CONFIRMED (tự đọc)
- `supabase/functions/session-live-matches-suggest/index.ts:1069-1087`: `onInstrumentEvent` ĐÃ push vào `instrumentEvents[]` (dòng 1070) rồi VẪN fire 1 insert riêng (dòng 1071). Full-board → O(C)-O(3C) insert song song/request. Bảng chỉ có PK, không index session_id, không dọn.
- Fix (RẺ & AN TOÀN NHẤT): bỏ insert-per-event, dùng 1 bulk insert `instrumentEvents` cuối request; + index `(session_id, created_at)` + cron dọn. Đụng engine: ❌ thuần edge.

Cliff phụ (phần lớn PLAUSIBLE/lịch sử, không confirm nặng): client escalate full-board pool rộng (đã nhiều fix trước — `hasHardPreviewQualityViolation` live-preview.ts:515); CTE derive round_rows tính lại mỗi snapshot load khi `session_rounds` rỗng (R>15, migration 20260617000002:117-173); monolith `NextRoundSuggesterScreenV2.tsx` 4388 dòng ~8-12 setState/cycle; O(P²) fingerprint/fairness build ở P≥40 (useNextRoundModel.ts:396-416).

## 🟡 SEVERITY 3 — Auditability gap

**A1. Không reproduce quyết định engine nếu VERIFY_DUMP tắt** · CONFIRMED
- `index.ts:1465`: anomaly-dump nằm TRONG `if (verifyDumpEnabled)`. Prod tắt cờ → không snapshot player-state → không tái tạo "vì sao court X ghép A+B". `scripts/diagnostics/replay-live-engine-session.ts` chạy engine thật được nhưng phụ thuộc dump.
- Fix: tách anomaly-dump khỏi VERIFY_DUMP (luôn dump khi shortfall/incomplete/limited-courts) hoặc sampling 1/N. Đụng engine: ❌.

**A2. engine_instrumentation thiếu timing-ms + correlation-id + court-idx** · CONFIRMED
- Bảng chỉ `(event, detail, court_count, available)`. Timing thật chỉ ở `debug_dumps` (gated) / `slow_diagnostic` (≥3s, index.ts:1442). Không có `suggestion_request_id`/`court_idx` (biến có sẵn nhưng chỉ dùng cho console.warn).
- Ảnh hưởng: court chậm 1.5s (dưới 3s) → không biết stage nào tốn ms; 5 request liên tiếp → không tách event theo request/sân.
- Fix: thêm cột `timing_ms jsonb`, `suggestion_request_id`, `court_idx`; emit event `court_unfilled{reason,block_key}` tại `live-preview.ts:4284` (nơi hiện chỉ `continue`).
- Đụng engine: ⚠️ BÊN LỀ — thêm 1 callback log ở live-preview, KHÔNG đổi logic quyết định → không cần sim.

**A3. Latency client (markNextRoundStage) không persist** · CONFIRMED
- `features/host/session-detail/next-round-v2/telemetry.ts`: chỉ RAM + console.log khi `__DEV__` → mất khi đóng app. `getNextRoundTelemetry` không upload đi đâu.
- Ảnh hưởng: host báo "4s mới ra board" → không tách chậm client-render vs edge.
- Fix: flush `stageDurationsMs` vào `session_audit_events` (event client_latency_snapshot) khi preview_ready/hide. Đụng engine: ❌.
- (traceClientPreviewEvent thì persist TỐT trên web — api.ts:531; native lifecycle-flush là rủi ro PLAUSIBLE vì guard `typeof window==='undefined'` api.ts:560.)

**A4. Bump LIVE_PREVIEW_ALGORITHM_VERSION KHÔNG invalidate persisted preview + không phát hiện edge/client skew** · CONFIRMED (tự đọc)
- Version (=26, live-preview.ts:72) chỉ dùng: key cache RAM client (preview.ts:225, live-preview.ts:726) + ghi audit diagnostic (index.ts:632). Persisted preview gate DUY NHẤT bởi `live_state_version`, không so algorithm_version. Grep `features/` xác nhận không có so client-vs-edge version.
- Ảnh hưởng: sau deploy quality-fix, gợi ý cũ vẫn treo tới khi state đổi; rollout window client(v cũ) vs edge-persisted(v mới) lệch, không guard. Trái kỳ vọng ngầm CLAUDE.md "increment before deploying".
- Fix: lưu `algorithm_version` vào persisted row; client refresh khi row.version < của mình. Đụng engine: ⚠️ hằng số ở live-preview nhưng thay đổi ở logic persist/invalidate (edge+client+DB), KHÔNG đổi scoring/pairing. Rủi ro vận hành: bump → re-suggest loạt sau deploy.

**A5. Sync-warning false-negative** · CONFIRMED (tự đọc)
- (a) `lib/next-round-suggester/fairness/audit.ts:133-137` so TỔNG partner/opponent → `{A:2}` vs `{B:1,C:1}` (cùng tổng, khác đối tác) không flag.
- (b) `useNextRoundModel.ts:531`: `hasCompletedLiveMatchOverflow ? [] : buildMatchCountConsistencyRows(...)` → khi overflow (lúc live/replay CHẮC CHẮN lệch) ép `[]` → tắt cảnh báo + chặn auto-repair (`NextRoundSuggesterScreenV2.tsx:928-941`) đúng lúc cần nhất.
- Ảnh hưởng: cảnh báo "live khác replay" có thể im khi thật ra lệch. LƯU Ý: report dùng replay nên SỐ REPORT VẪN ĐÚNG — chỉ gap của cảnh báo, không phải sai fairness.
- Fix: so thêm phân bố (hash sorted của partner_counts); thay `[]` bằng dòng "đang overflow, chưa đối chiếu" + cho auto-repair chạy sau overflow (giữ guard `!activeRound`).
- Đụng engine: ⚠️ chạm `fairness/` nhưng KHÔNG core → không đổi output, không cần sim suggester. Cẩn thận false-positive async churn → test cảnh báo riêng.

**A6. Non-determinism dưới áp lực thời gian** · CONFIRMED
- `suggest.ts:575-680` + `pair.ts:751`: điểm cắt search theo `Date.now()` không seed được → cùng input, khác tốc-độ-máy → khác tập alternatives → có thể ra lineup khác. Tie-break có preview_seed (deterministic khi KHÔNG timeout) nhưng điểm cắt wall-clock thì không.
- Ảnh hưởng: không "chứng minh lại" tất định 1 quyết định live; diagnose offline có thể khác cái đã persist.
- Fix (a) AN TOÀN (khuyên): persist tập alternatives đã duyệt (hoặc seed + số candidate) vào audit → replay đối chiếu, KHÔNG đổi thuật toán, đụng engine ❌. Fix (b) RỦI RO: đổi cắt search từ wall-clock sang đếm-candidate → đụng engine ✅ core, rủi ro cao. → Chọn (a).

## ⚪ Latent / by-design (KHÔNG sửa mù)

- **Forced-rescue engine "chết" ở live** · CONFIRMED · `suggest.ts:583`: `regularBudgetMs = maxRuntimeMs>1000 ? 100 : maxRuntimeMs`. Live truyền budget ≤900 (LIVE_PREVIEW_MAX_COURT_TIMEOUT_MS=900) → <1000 → regular ăn hết → forced pass (712) bị skip vì `overallTimedOut()`. KHÔNG sai vì rescue làm lại ở tầng live-preview (7 pass, 3907-4234). Chỉ nên tài liệu hóa. Đụng engine nếu sửa: ✅.
- **session-rounds-suggest thiếu max_runtime_ms** · CONFIRMED · `supabase/functions/session-rounds-suggest/index.ts:38-40`: không truyền → default 1000 → dead-rescue (F3) + dính cliff F1 với full court count. Fix = truyền thêm param ở EDGE (❌ không đụng engine) nhưng cần biết endpoint còn dùng prod không (live-board là primary).
- **consecutive_rest/play order-fragile không trigger warning** · KNOWN by-design (audit.ts:126-137), không sửa. Xác nhận lại chứ không phải phát hiện mới.
- **NO_VALID_MATCH giả khi deadline hết** · ✅ CONFIRMED + REPRODUCED (2026-07-29) · `suggest.ts:839-846`: hai chốt rescue (712, 800) đều guard thời gian; nếu regular ăn hết budget thì bị skip → trả NO_VALID_MATCH dù stage-8 còn nghiệm. Path live che bởi rescue tầng ngoài; API trần (sim/session-rounds-suggest) là false-negative tiềm ẩn.
  - REPRO: `npx jest .../simulation/sanity.test.ts -t "medium_12 runs to completion"` (seed 42) → stall ở R2 (12 người/3 sân = exact-fill, strict vô nghiệm nhưng relaxed CÓ nghiệm). Sim chạy 1/8 vòng.
  - Cơ chế chính xác: budget=DEFAULT(1000) → `regularBudgetMs = maxRuntimeMs>1000 ? 100 : maxRuntimeMs` = 1000 → `regularSearchDeadline == runtimeDeadline` (trùng, 0 headroom). Exhaustive `walk` (pair.ts 702-721) KHÔNG check wall-clock → overshoot budget (elapsed 1150>1000). Regular xong thì `overallTimedOut()` đã true → forced rescue (712) bị skip (xác nhận: onInstrumentEvent KHÔNG có `forced_pass` ở budget 1000, CÓ ở budget 5000).
  - Bằng chứng nghiệm tồn tại: `bestPartitioning(elig, state, {deadlineRescue:true})` → CÓ nghiệm; `suggestNextRound(state,{max_runtime_ms:5000})` → alts=1 no warning. Nghịch lý: budget CÀNG LỚN (>1000) càng dễ ra vì regular bị cắt còn 100ms, chừa chỗ cho rescue.
  - KHÔNG phải "harness limitation" như memory cũ (sim exact-fill): nghiệm THẬT tồn tại, engine bug budget-alloc. Live board (primary) dùng `suggestNextMatch` per-court + rescue riêng (live-preview 3907-4234) → KHÔNG dính. `session-rounds-suggest` không có client caller (endpoint chết). `previewSetupChange` (what-if) degrade → null, không vỡ board.
- **Không có catch{} nuốt lỗi ở critical path** · OK CONFIRMED · các catch{} rỗng đều Haptics/Location benign; edge top-level catch log console.error + 500; background write đều console.warn.
- **Tradeoff/repeat/blowout/under-fill CÓ surface cho host** · OK · `tradeoff_choices` + `explanation` + `approval_required` (preview.ts:360-431,867), warning PVNA_TOLERANCE_RELAXED, courtShortageBreakdown + qualityDeferredCourts + banner PARTIAL_COURTS.
- **Polling 4s / version-churn / 409 CAS / index pair_history+live_matches** · by-design, scale tốt (1000 session ≈ 250 QPS PK-lookup nhẹ). Index đủ. Realtime chỉ 1 channel notifications/user, không nhân theo session.

## PLAUSIBLE khác (chưa reproduce — KHÔNG confirm)
- retryKey-reset spin 900ms khi board con dao động (NextRoundSuggesterScreenV2.tsx:3173-3182).
- Cold-start import nặng (index.ts:1-54 import cả live-preview ~4670 dòng + planner).
- diagnose-session.ts thiếu `session_players.metadata` gender-pref (diagnose-session.ts:84-86; session_player_state dùng `*` nên vẫn bắt metadata table đó — gap chỉ nếu override ở session_players.metadata).
- defer-noop giữ lane im lặng không kèm limited-courts (index.ts:1336-1341, ScreenV2:3097-3171 chỉ trace, không message host-visible riêng).

## Đề xuất thứ tự xử lý (rẻ→đắt, gặt quả thấp trước)
1. S1 rotate key (bảo mật, ngay).
2. S5 bulk-insert instrumentation (~5 dòng, rủi ro thấp) + index/TTL.
3. S4 tái dùng snapshot cho audit.
4. A2/A1 correlation-id + timing + tách anomaly-dump.
5. A6a persist alternatives.
6. (đụng engine, cân nhắc kỹ + sim) S2 deadline-check walk → S3 top-K fallback.

---

# CODE-QUALITY AUDIT — God Components & Tách UI/Logic (2026-07-27)

→ ĐÃ REFACTOR (2026-07-28): NextRoundSuggesterScreenV2 4148→1061 (useLiveBoard+telemetry+scrollDebug+predicates), HostMatchScreen 1754→1222 (controller+api+scheduleGenerators). Chi tiết: `.superpowers/sdd/2026-07-27-host-live-logic-ui-separation/` (progress.md = ledger, task-*-brief/report.md per task).

Phương pháp: đo line-count toàn repo + 2 agent soi sâu + tự verify (grep React trong lib/, đếm component export). Read-only.

## Câu 1: Có god component không? → CÓ 3 cái thật

| File | Dòng | Vì sao god | Bằng chứng |
|---|---|---|---|
| NextRoundSuggesterScreenV2.tsx | ~4387 | NẶNG NHẤT. 1 hàm component (export dòng 549) ôm ~115 hooks (22 useState/39 useRef/20 useEffect); **1 useEffect 1410 dòng (2366-3776)** = state-machine preview; mutation handler inline ~300 dòng/cái | verified: 1 export duy nhất |
| HostMatchScreen.tsx | ~1731 | sinh lịch ~200 dòng business logic + **4 supabase.* inline** + mutation session_matches thẳng + 21 useState | verified 4 supabase inline |
| OnboardingScreen.tsx | ~1085 | wizard nhiều bước 1 component, supabase.auth.* inline (L258-326), 14 useState | — |

KHÔNG phải god (lớn nhưng tách TỐT — dùng làm CHUẨN tham chiếu):
- ScreenComponents.tsx (4426): ~60 component nhỏ presentational/1 file. Chỉ nên SPLIT FILE. verified 60 def.
- SessionActionButtons.tsx (921): 16 sub-component thuần, 0 state 0 supabase.
- ScheduleCoverageReport.tsx, HostRosterSection.tsx: props-driven, useMemo, không fetch.

## Câu 2: UI tách khỏi logic chưa? → Một phần ~55%, KHÔNG đồng đều (2 thế giới)

🟢 Thế giới "MỚI" tách tốt (controller-hook + api.ts + screen mỏng): player/create-session, host/create-session, find-session, home, my-sessions, profile, court. 7/7 feature player-side có api.ts riêng. Screen chỉ destructure từ use*Controller.

🔴 Thế giới "CŨ" trộn logic vào screen (supabase inline, không controller): toàn cụm host/session-detail (trừ HostRosterSection), cụm player/session/* (MatchResult/RateSession/Confirm/Review — mỗi file 3 supabase inline), auth/OnboardingScreen, app/host/dashboard.

Điểm sáng — DOMAIN LOGIC TÁCH 100%:
- `lib/next-round-suggester/` = **0 import React** (verified). Thuật toán đề xuất thuần, không nhiễm UI. 7 file React trong lib/ đều context/hook hợp lệ (useAuth/theme/navigation).
- Cụm next-round-v2: api.ts (0 React, 23 fn IO), preview.ts (0 React, 17 fn logic), useNextRoundModel.ts (hook model đúng nghĩa). Lớp data/logic/IO tách ~90%.

Nghịch lý: cụm next-round vừa có lớp dưới tách xuất sắc, vừa có lớp orchestration đỉnh TỆ NHẤT repo — ~1410 dòng effect + ~600 dòng mutation handler inline trong 1 component.

Mức tách theo lớp: domain lib/ ~95% ✅ · data/derivation/IO ~90% ✅ · orchestration/mutation/preview-machine (screen đỉnh) ~20% ❌.

## Concern bị TRỘN trong NextRoundSuggesterScreenV2 (cần tách)
1. Preview orchestration state-machine (effect 2366-3776 + ~20 preview-ref 580-595) → `usePreviewOrchestrator`.
2. Mutation lifecycle startLiveMatch/completeLiveMatch/cancelLiveMatch/fetchAvailablePoolPreview (1205-1954) → `useLiveMatchMutations`.
3. Conflict/retry recovery (scheduleReconcile 981, classifyPersistAssignmentConflict, *RetryRef) → gộp orchestrator.
4. Telemetry/stuck-tracker (traceClientPreviewEvent 607, resolveStuckTracker 869, stuckTrackerRef 598) → `usePreviewTelemetry`.
5. Helper thuần incrementPair(353)/getTeamPvna(508)/replaceInTeam(4173) → preview.ts/helpers.ts (dễ, rủi ro thấp).
6. Scroll/viewport debug (scrollDebugMetrics, updateScrollDebugMetrics 784) → `useScrollDebug`.

## ĐỤNG ENGINE? ❌ KHÔNG cái nào. Thuần refactor lớp React/screen. lib/next-round-suggester đã sạch, KHÔNG động tới. An toàn hơn hẳn scalability S2/S3.

---

## Gotchas (phiên f2fd04b4 / sweep audit)

- **Client fix cần rebuild**: fix trong React component (NextRoundSuggesterScreenV2, dashboard, useNextRoundModel) chỉ có hiệu lực khi rebuild/hard-refresh app. localhost dev Metro hot-reload KHÔNG xoá `useRef` (block/retry state kẹt) → phải hard-refresh (Ctrl+Shift+R) hoặc restart `npm run web`.
- **`'finished'` là status NỬA VỜI**: host dashboard nhận nhưng player side KHÔNG (`resolveTab` chỉ 'done'/'cancelled' → history; RateSessionScreen/home mapping loại 'finished'; submit_session_results chặn). → dùng 'done' (chơi thật) hoặc 'cancelled' (bỏ hoang).
- **`effectiveTargetRounds = targetRounds ?? recommended.total_rounds`**: session KHÔNG set target vẫn bị recommendation làm hard target → edge should_end + report tự pop. Chỉ gửi edge `planned_total_rounds` khi có EXPLICIT target.
- **Board-stuck coupling CỐ Ý**: 1 sân intra>1.0 → escalate re-suggest CẢ bảng (full-board). Với pool rộng intra>1.0 không tránh được → thrash. Loại persisted khỏi trigger + nới ngưỡng intra theo round.
- **sessions KHÔNG có cột `updated_at`** (chỉ created_at/start_time/end_time/status/pending_completion_marked_at). Update kèm updated_at → lỗi 42703.
- **court_slots** (KHÔNG phải `slots`) là bảng slot FK của sessions.slot_id. Session V2 thường start_time NULL.
- **Test-transaction prod** (khi không có Docker chạy pgTAP): DO block + host/player_id THẬT (thỏa FK) + `raise exception 'RESULT :: %'` (auto-rollback + trả kết quả qua error message). KHÔNG set `session_replication_role` (Management role bị cấm). Gửi qua curl `--data-binary @file` (urllib bị Cloudflare 1010 chặn).
- **INTRA_OVERFLOW_WEIGHT=1** làm engine ưu tiên blowout (intra thấp) hơn balanced (intra cao) cho foursome cực bimodal — không phải weight-tuning DEAD, mà là guard Stage 5.5/6.

## Rejected approaches
- Fix #2 (cap expected_round_matches ở distinct-courts): test-transaction chứng minh under-fill đã reset đúng → #2 không phải bug. Fix naive còn gây complete-sớm.
- Sửa blowout bằng "re-split foursome min-gap": bản cân bị intra hard-cap 0.75 chặn → không phải re-split đơn thuần, là tradeoff gap↔intra ở relaxation order.
- Blunt fix async single-court (add slots vào futureBatchSlots / minReq=0): phá anti-starvation (guard over-protect pool). Dùng deferLowViability floor thay thế.

## Open questions
- Drift consecutive_play thật (Tùng=5 vs 2): compound out-of-order/churn, #3 là 1 phần, không map 1-1. Nguồn (board-stuck churn) đã fix → không tái diễn. Session cũ tự lành.
- Edge còn hở hiếm: foursome 3-mạnh-1-yếu (fix B chưa cứu vì bản cân vẫn >medium-tol), blowout nhẹ dưới margin. Trần cấu trúc.
