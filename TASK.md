## Task: Debug & tối ưu live-session + suggester (session f2fd04b4 + sweep audit)
Status: DONE (server-side đã live; chờ user rebuild app cho phần client)

Branch: feat-next-match-suggester (đã merge main). 12 commit: 9418d9d → c32ba67.
(Task cũ "Operation stabilization audit" → detail ở docs/OPERATION_STABILIZATION_AUDIT.md)

### Phiên 2026-07-29 (REFACTOR tách logic/UI host-live + host-match) — DONE, chờ QA + merge
Kế hoạch: docs/superpowers/plans/2026-07-27-host-live-logic-ui-separation.md. Ledger đầy đủ: .superpowers/sdd/2026-07-27-host-live-logic-ui-separation/progress.md. Commits a39dcf1→f758882.
- [x] Sweep audit (scalability + auditability) + code-quality audit (god components) → SCRATCHPAD.md.
- [x] Refactor behavior-preserving (subagent-driven, mỗi task review + gate): NextRoundSuggesterScreenV2 **4148→1061 dòng** (tách useLiveBoard = preview+mutation+18 lifecycle effect giữ đúng thứ tự đăng ký, usePreviewTelemetry, useScrollDebug, preview-helpers, preview-consistency predicates); HostMatchScreen **1754→1222** (host-match/{scheduleGenerators, api, useHostMatchController}). **Engine lib/next-round-suggester = 0 thay đổi** (git-verified).
- [x] QA app §7: PASS (owner). Lưới an toàn: 6 characterization test host-live + host-match.
- [x] Cleanup CL1-3: dedup toUserSafeActionError/incrementPair/buildProjectedStateAfterLiveMatch, consolidate type SuggestedLiveMatchRow (6→1), xoá dead code (LiveMatchBoard/RoundDivider/{false&&} blocks).
- [x] **FU3 bug hydrate-stomp FIXED** (commit e58b77b test + 3697a9d fix): effect hydrate DB-suggested replace→MERGE, giữ lane ephemeral cho sân vừa trống sau mini-recover (7 bộ lọc). **BEHAVIOR CHANGE → cần owner QA tay.**
- [x] FU-minor: tách suggestedLaneCacheRef khỏi setState updater (mirror-ref). FU2: điều tra existingRound-status = no-op (verified 2 tầng), dedup an toàn.
- [x] Regression: 114-115 React/host test + snapshot xanh; 681 engine test xanh. 4 fail duy nhất = **performance-target xlarge/tier của engine trên máy tải nặng** (avg suggest 85/1151/1294/1496ms vs ngưỡng 50/150/500/1000) — KHÔNG do refactor (targets.test.ts không load code đã sửa; engine untouched). Fairness 24/24 pass.
- Next: (1) **owner QA FU3** (complete sân live khi còn persisted-suggested → refill hiện & không biến mất ~1s, không trùng người); (2) merge branch; (3) redesign UI (mục tiêu gốc, giờ logic đã tách); (4) [tùy] điều tra engine perf-target (tách biệt).
- OPEN decisions ghi SCRATCHPAD: — (không còn; FU2 đã kết luận no-op).

### Phiên 2026-07-29 (session e945f825 — "kẹt phải complete sân khác, ko có thông báo")
- [x] Diagnose + engine_instrumentation: 2 điểm "kẹt" bạn báo = anti-blowout defer, KHỚP 100%:
  - Sân 3 R6: `rolling_quality_deferred court=2 pvna=2.01` ~27s → `swap` khi avail 13→17.
  - Sân 1 R8: `rolling_quality_deferred court=0 pvna=3.18` ~19s → `swap` khi avail 13→17.
  - Cả 2 = nhánh `persistentOutlier` (pvnaGap>max(1.5,tol+1)=1.5, bỏ qua pool size) — [[project-blowout-vs-balance-fix]]. KHÔNG phải bug. Complete 1 sân = escape valve đúng thiết kế.
- [x] User: "ko đổi biên, nhưng chưa có thông báo cần complete sân khác → tưởng lỗi". ROOT: banner `qualityDeferredCourts` ĐÃ có+commit (v26) + edge trả `quality_deferred_courts` đúng, NHƯNG **app chưa rebuild** nên ko chạy. Copy cũ còn thụ động ("engine đợi").
- [x] Sửa copy banner NextRoundSuggesterScreenV2.tsx (chỉ text, ko đụng ngưỡng): thêm action "hoàn thành một sân đang chạy để mở khóa NGAY".
- [x] **User: rebuild rồi banner VẪN ko hiện → debug hệ thống (systematic-debugging).** Verify bằng data prod thật (debug_dumps + engine_instrumentation + deployed edge body), KHÔNG đoán:
  - Edge v185 deploy SAU commit 9b9e19a 19s → CÓ code field. Dump lúc kẹt: `target_court_idxs=[2]`, `missing_target_courts=[2]`, `partial_full_board_request=false` → edge trả `quality_deferred_courts=[2]` ĐÚNG.
  - **ROOT (client):** `setQualityDeferredCourts(res.quality_deferred_courts)` nằm TRONG `if(edgeReturnedFinalBoard)` (useLiveBoard.ts). Anti-blowout defer trả board RỖNG → `edgeReturnedFinalBoard=false` → nhánh bị bỏ qua → setter KHÔNG chạy → state mãi `[]` → không banner. Rebuild vô ích vì code sai cấu trúc, không phải build cũ.
  - **FIX:** hoist `setQualityDeferredCourts` ra TRƯỚC nhánh board (chạy mọi response, kể cả board rỗng) + bỏ setter trùng. typecheck:guard sạch (lỗi preview.ts TS2305 là pre-existing, không do fix). **CẦN REBUILD.**
- [x] **Fix 2 (preview.ts import gãy):** `isRecentSuggestedLiveMatch` bị commit 473fd44 XÓA khỏi live-preview.ts (chủ đích: "persisted suggestions là khóa authoritative, tuổi đời ko làm rảnh người"), nhưng bản refactor preview.ts giữ bản cũ. `buildSuggestedMatchPayloads` ở preview.ts đã DEAD (moved to edge). Fix = mirror y 473fd44: bỏ filter tuổi + bỏ import. TS2305 hết.
- [x] **Bonus (court-calculator/warnings.ts):** TS5097 pre-existing — import type NHIỀU DÒNG khiến `@ts-ignore` (che `.ts` cho Deno) không phủ dòng module-specifier. Gộp về 1 dòng như import khác trong file → hết lỗi, giữ `.ts` cho Deno.
- Note: guard vẫn đỏ do baseline cũ (lỗi pre-existing ở scripts/tests: verify-suggest-quality.ts, factories.ts, tmp/, scratch/ — KHÔNG phải file đã sửa). 4 file mình đụng đều sạch tsc.

### Phiên 2026-07-27c (session 1abb3410 v23 — "kẹt phải complete sân khác")
- [x] `83add87` fix ROOT #4 (EDGE, ĐÃ DEPLOY): `shouldDeferTightPoolSuggestion` bỏ defer theo intra (chỉ defer blowout tổng-đội). Verify timeline: sân fillable 30s mà bị giữ = tight-pool quality-defer intra>2, mâu thuẫn 286f79c. Bump v24, unit 251/251. Client cần rebuild v24. Chi tiết [[project-board-stuck-persisted-intra]] ROOT #4.
- Xác nhận trên v23: severe (under-fill/nhảy round/rest-miss) ĐÃ HẾT; chỉ còn latency defer này.

### Phiên 2026-07-27b (session dafe6fa5 — board-stuck residual)
- [x] `ca0bad0` fix board-stuck ROOT #3: rest-priority-miss vs deferLowViability đánh nhau. `hasMissingRestPriorityPlayer` thêm near-level filter + tách `restMissForcesFullBoard` (chỉ ép full-board khi board đầy; sân trống → mini-recover fill, không bị chặn). Verify mini-recover seat được cr≥1. Test 189/189, bump version 22→23. **CẦN REBUILD.** Chi tiết [[project-board-stuck-persisted-intra]] ROOT #3.

### Phiên 2026-07-27 (session d5f4e31f — test sau rebuild)
- [x] `286f79c` fix board-stuck EARLY-round: bỏ hẳn intra hard-cap mọi round (b0cc4ad chỉ bỏ late). Verify R4 under-fill do gate reject intra>1.0 ở round 4. **CẦN REBUILD lại app.**
- [x] `685b0de` fix diagnose (fairness 100 giả → 63 đúng, dùng buildCompletedLiveCycleRows+replay+gender pref) + report giải thích rest-vs-balance tradeoff. Chi tiết [[project-fairness-rest-diagnose]].
- [x] Verify consecutive rest (4 người R4-R5) = BY-DESIGN (deferLowViability tránh blowout gap 3.87), KHÔNG phải bug. Guard cr≥1 giữ ở full-round, live override có chủ đích.
- [x] Sim harness exact-fill fail = known limitation (harness-only) → đã REVERT thử nghiệm budget/determinism, để nguyên.
- Session d5f4e31f: fairness THẬT 63/100 (acceptable) — kéo xuống bởi gender-pref 52% + rest lệch. KHÔNG "khỏe 100" (số cũ do diagnose bug).

### Completed

**A. Fix engine/live (ĐÃ LIVE prod — edge v182, KHÔNG cần rebuild)**
- [x] `9418d9d` async single-court blowout (gap 4.99): defer PVNA-incompatible resters khi count=1. Ship algorithm v20.
- [x] `0555878` replace_courts không ra lineup → không wipe suggestion cũ (edge).
- [x] `180508d` board-stuck: sân persisted intra>1.0 (pool rộng) không bị ép full-board re-suggest thrash.
- [x] `5b636bd` nới ngưỡng intra hard-cap theo round (round≥5 → 2.0) cho pool rộng.
- [x] `e73c024` recommendation KHÔNG làm hard target: planned_total_rounds/target-reached/auto-report chỉ dùng explicit targetRounds → hết should_end + report tự pop chặn court cuối.
- [x] `6cf67bd` blowout-vs-balanced: guard Stage 5.5/6, không trả blowout cực đoan khi có split cân hơn hẳn. Ship v21, sim 24/24 pass.
- [x] `c32ba67` RPC #3: round-completion không reset người đang trong match `live` (migration `20260726000001` deployed, pgTAP test kèm).

**B. Fix client dashboard/lifecycle (đã merge main — CẦN REBUILD APP mới có)**
- [x] `60e38d4`+`32aaf6c` nút "Kết thúc kèo" (V2 recap) → sessions.status='done' (KHÔNG 'finished').
- [x] `3a4bc39`+`3e15fa1` dashboard: mục "Đang diễn ra" tách 'playing' + null-slot aging theo created_at.
- [x] `cd3488b` LOW: handleFinishSession .select() rows-check, empty-state box, comment liveMatchGuards.

**C. Server-side data/config (đã live)**
- [x] Plan-consumption TẮT (SESSION_PLAN_ROLLOUT_SESSION_IDS='').
- [x] Backfill 124 session bỏ hoang 'playing'→'cancelled' (sạch host + player side).

**E. Report sync-warning + consistency (2026-07-26)**
- [x] REVERT fix #3 sai (`0ee2343`, migration `20260726000002`) — nó inflate consecutive_play; restore RPC gốc đúng. (Bài học: agent finding có thể sai, PHẢI reproduce.)
- [x] `2dbf0de` report consistency check chỉ warn khi matches/partner/opponent lệch (bỏ consecutive_* order-fragile) + unit test.
- [x] Repair DB consecutive_play cho f2fd (8 người, Tùng 5→2).
- [x] Sweep audit lớp consistency/drift (3 agent) — VERIFY empirical: KHÔNG có bug mới confirmed-active (last_played_round/consecutive_rest 0 drift thật; client desync transient self-healing; snapshot trả full rows nên không phantom). Không sửa gì thêm (tránh sửa mù).

**D. Đánh giá chất lượng session f2fd04b4**
- [x] 80% trận trong cap, gap TB 0.34, fairness 100/100 = TỐT. Over-cap 20% phần lớn cấu trúc (pool spread 2.67, 11 outlier).
- [x] Bất thường (R5 under-fill 4/6 sân, R8 churn 10 cancel, nghỉ-2-vòng) = hệ quả bug stuck đã fix.
- [x] Slow suggest = 3 board_stuck_events (5-8s) trong cửa sổ stuck.

### Next steps
- [ ] **USER: rebuild/deploy app** (không dùng Vercel) → phần client (B) mới có hiệu lực. Verify: court cuối fill đủ, report không tự pop, có mục "Đang diễn ra".
- [ ] (tùy chọn) Client Bug 1 cũ ship kèm rebuild.

### Key decisions
- KHÔNG sửa #2 (rest bookkeeping expected_round_matches): test-transaction → under-fill reset ĐÚNG, không phải bug.
- KHÔNG sửa latent/by-design: phantom court (unreachable), 'closed' (ambiguous), dead-retry, tolerance-floor, non-determinism.
- Blowout fix + #3 fix: validate trước (sim / test-transaction reproduce) — không sửa mù.
- Deploy: RPC/backfill qua Management API /database/query; edge qua `supabase functions deploy` token ~/.supabase/access-token.

### Files touched
lib/next-round-suggester/{live-preview.ts, pair.ts}; features/host/session-detail/{NextRoundSuggesterScreenV2.tsx, liveMatchGuards.ts, next-round-v2/{flow-sheets.tsx, useNextRoundModel.ts}}; app/host/dashboard.tsx; supabase/migrations/20260726000001_fix_rester_excludes_live_players.sql; supabase/tests/rester_excludes_live_players_test.sql
