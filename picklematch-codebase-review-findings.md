# PickleMatch — Sổ Findings Review Toàn Codebase

> **Cách dùng:** file sống, update sau MỖI phase review. Mỗi finding có ID, trạng thái
> (`OPEN` / `FIX-PENDING` / `FIXED <commit>` / `WONTFIX`), mức độ (🔴 nặng / 🟠 vừa / 🔵 nhẹ / ⏳ chưa verify).
> Khi fix xong: đổi trạng thái + ghi commit, KHÔNG xóa dòng (giữ lịch sử).
> Cập nhật lần cuối: 2026-06-29 · 9 phase + PHẦN D (auditability/scalability). Coverage trung thực: ~40-50% từng-dòng theo trọng số rủi ro; phần đuôi liệt kê ở Phase 9. SẴN SÀNG GOM FIX.

---

## TRẠNG THÁI TỔNG QUAN

| Khu | Độ phủ review | Bug mở |
|---|---|---|
| Engine ghép trận (lib/next-round-suggester + live-preview) | ●●●● 4 vòng, cạn | 0 (B1–B4 đóng) |
| Fairness (lib/next-round-suggester/fairness) | ●●● lõi metrics/detector/summary | 4 (F1–F4 chờ fix) |
| Join qua link (app/register/[id].tsx) | ●●● đọc sâu 961 dòng | 4 (R1–R4) |
| Pipeline ratings (eloSystem + process-pending-ratings + SQL) | ●● | 2 (E1–E2) |
| Các khu còn lại | ○ chưa review | — xem Hàng đợi |

---

## PHẦN A — ENGINE (4 vòng review · TẤT CẢ ĐÓNG)

| ID | Bug | Trạng thái |
|---|---|---|
| B1 | Absolute-guard deadlock: cả pool consecutive_play≥4 (full-house/bench mỏng) → guard chặn hết → kẹt sân từ round 4. Tái hiện: cap2 sim 0/10 STUCK. | ✅ FIXED `4ebe47c` — bậc cascade cuối buông absolute khi không có người thay + warning `LIVE_RECYCLE_ABSOLUTE_RELAXED`. Gate: cap2 7/7 PASS (10 & 9 sân), 40-player perfect, <500ms. |
| B2 | current_round kẹt 0 ở court-lane (client synthesis bỏ vòng thiếu sân) → số vòng hiển thị sai (display chunk index/courtCount) + repair round-1 chạy nhầm giữa buổi (trigger round_no===0). | ✅ FIXED `f3dbb39`+`97be743`+`08a025c`+`b1e85fd` — đóng short rounds (client + DB fallback `closable_rounds`), repair guard `isTrueFirstRound` (state.rounds.length===0), display dùng match.round_no. |
| B3 | Warning noise cuối buổi: mọi trận nới hợp lệ → 3-4 banner/card, warning quan trọng chìm. | ✅ FIXED `9ed2c7b` — phân tầng: warning nổi, info gộp "N điều chỉnh nhẹ ▾", dedupe REPEAT_CAP_REACHED board-level. |
| B4 | Effect load-settings deps chứa sessionCourtSetup → đổi setup sân giữa buổi reset tạm tolerance/targetRounds. | ✅ FIXED `2edcdcb` — tách hydration khỏi sessionCourtSetup. |
| — | Bleed: UI nuốt 8 warning engine (REST_REQUIREMENT_RELAXED, MUST_REST_FORCED_PLAY, LIVE_REPLACEMENT_*, REPEAT_CAP_REACHED, EXHAUSTIVE_FALLBACK, PARTIAL_COURTS). | ✅ FIXED `a7b5c66`+`e0b552d` — WARNING_LABELS mapper 16+ code + fallback raw (không bao giờ nuốt im lặng). |
| — | Message REST_REQUIREMENT_RELAXED NGƯỢC nghĩa (nói "ép người cần nghỉ vào" — thực tế "người đáng chơi bị bỏ, nghỉ tiếp"). | ✅ FIXED `ad8e13a`. Bài học: không tin tên/message warning — đọc ngữ cảnh emission. |
| — | Tradeoff choice revert khi board refresh (effect deps rawTradeoffChoices tạo mới mỗi render). | ✅ FIXED `7c0448c` — reset chỉ khi match.id đổi + hostSelectedRef. |
| — | Double-book trong repairRoundOne (pool không lọc busy). | ✅ ĐÃ CÓ MITIGATION sẵn (busy → checked_out tạm ở call site). Không cần làm. |
| — | Rescue paths bốc người bận. | ✅ SẠCH — rescue chỉ chọn trong alternatives đã lọc busy thượng nguồn; findBestAvailablePoolQuality nhận availableIds param. |
| — | Concurrency start/complete 2 thiết bị. | ✅ SẠCH — RPC versioned + expected_live_state_version (optimistic lock). |

**Smell còn nguyên (không phải bug, ghi nhận):** mustPlayAt=1 phình ràng buộc buổi đông · chiến lược diversity sinh candidate vô hiệu pool đông · score chưa chuẩn hóa thang đo, intra-gap/avoid-300 ngoài weights · fairness nặng ~1023 dòng cạnh tranh budget · comparator thứ ba alternatives.ts chưa thống nhất · live-preview.ts ~3700 dòng god-file · snapshot for-share contention.

**Đường cong 4 vòng:** v1 = bleed 8 warning + message ngược · v2 = 4 bug (B1,B2 lớn) · v3 = 0 · v4 = 0. → Review tĩnh engine ĐÃ CẠN; review tiếp theo = dữ liệu buổi thật qua observability.

---

## PHẦN B — FAIRNESS (F1–F4 · CHỜ FIX, prompt đã có trong chat)

| ID | Bug | Mức | Trạng thái |
|---|---|---|---|
| F1 | computeMatchCountMetrics dùng matches_played THÔ, không chuẩn theo rounds_available. Nhánh chuẩn hóa (availability) chỉ sống khi rounds_tracked>0 — TRƯỚC B2a court-lane không đóng vòng → nhánh chết suốt buổi → báo động giả người tới trễ/về sớm. B2a vô tình cứu phần lớn; tồn dư: nhánh fallback + per_player display vẫn thô. | 🟠 | FIX-PENDING |
| F2 | detector rest_violation (detector.ts:244) THIẾU `!opted_rest` → người tự xin nghỉ bị gắn cờ vi phạm + lời hứa sai "engine sẽ ép chơi" treo mãi. | 🟠 | FIX-PENDING |
| F3 | metrics.ts:116 loại opted_rest khỏi match metrics hoàn toàn → người đang tạm nghỉ vô hình trong điểm. | 🔵 | OPEN (chấp nhận được, ghi nhận) |
| F4 | SQL fallback (migration 20260701 + kiểm 20260617) tính `resting` KHÔNG loại opted_rest → run nghỉ lịch sử phồng → max_consecutive_rest sai trong summary/violations. **Bất nhất hai tầng: client synthesis xử đúng, edge (build qua SQL) sai** → hai nơi hai số. | 🔴 | FIX-PENDING |

**Nguyên tắc rút ra:** hệ metrics viết với giả định "check-in = có mặt trọn buổi"; thực tế VN đầy tới trễ/về sớm/xin nghỉ. Và pattern **hai-tầng-lệch** (client xử, edge quên — F1, F4) → mọi logic synthesize round cần một nguồn duy nhất hoặc test đối chiếu client-vs-edge.

---

## PHẦN C — APP COMPONENTS · PHASE 1 (register + ratings)

### Khu 1: Join qua link — app/register/[id].tsx (đọc sâu, 961 dòng)

Nền vững: validate tên/SĐT VN chuẩn, UUID check, timeout 15s, xử cả joinError lẫn data.error, lưu info 24h TTL.

| ID | Vấn đề | Mức | Trạng thái |
|---|---|---|---|
| R1 | Timeout retry → đăng ký đôi? | 🔴→✅ | **ĐÓNG (Phase 2, verified an toàn):** RPC `secure_registration` idempotent cả hai nửa — player lookup theo phone (v_existing_id), join trả `already_joined`. Retry vô hại. |
| R2 | Drop-in checkin fire-and-forget, fail chỉ console.warn → user thấy success nhưng host KHÔNG thấy trong roster. Nên hiện "đã đăng ký, nhờ host check-in giúp" khi fail. | 🟠 | OPEN |
| R3 | Checkin đòi access_token — flow Zalo web thường ẨN DANH → lặng lẽ skip → cùng hệ quả R2, xảy ra MẶC ĐỊNH với drop-in ẩn danh. | 🟠 | OPEN |
| R4 | console.log PII (tên + SĐT) trong production. | 🔵 | OPEN |

### Khu 2: Pipeline ratings (eloSystem.ts 87d · process-pending-ratings 54d · SQL)

Kiến trúc: eloSystem.ts chỉ là BAND MAPPING; toán elo thật trong SQL (upgrade_rating_system.sql:124 `greatest(0, coalesce(current_elo, elo, 1000) + delta)` — floor 0, fallback hợp lý).

| ID | Vấn đề | Mức | Trạng thái |
|---|---|---|---|
| E1 | process-pending-ratings KHÔNG auth check — ai có URL + anon key trigger được. Fix rẻ: đòi cron-secret header / verify service key. | 🔴 | OPEN |
| E2 | Công thức elo | ⏳→✅ | **ĐÓNG (Phase 2):** HAI hệ song song — (a) peer validation ±15 ('weaker'/-15, 'outclass'/+15) trong upgrade_rating_system; (b) pipeline Elo theo trận (20260413_add_match_elo_pipeline.sql, 747d): expected=1/(1+10^(Δ/400)), delta=K×(actual−expected), K biến thiên, ledger lưu k_factor+expected — audit được, công thức chuẩn. |

---

## PHẦN C2 — PHASE 2a: MẠCH KẾT QUẢ → ĐIỂM (mới)

| ID | Vấn đề | Mức | Trạng thái |
|---|---|---|---|
| E3 | **Rating deltas bị vứt lặng lẽ / nondeterministic:** `process_pending_ratings` (upgrade_rating_system.sql:119-128) dùng `UPDATE players ... FROM ready WHERE p.id = ready.rated_id` — `ready` có MỘT DÒNG MỖI RATING. Một người nhận nhiều rating cùng buổi (chuyện thường) → Postgres áp ĐÚNG MỘT dòng bất kỳ, các delta khác bị bỏ; rồi `processed_at=now()` đánh dấu TẤT CẢ đã xử → mất vĩnh viễn. Ảnh hưởng cả reliability_score + host_reputation + elo peer-±15 (no_show_count cùng pattern). FIX: CTE aggregate `sum(delta) group by rated_id` trước UPDATE (+ cân nhắc cap ±15/buổi cho peer-elo). | 🔴 | OPEN |
| E2b | **NGHI VẤN CHƯA CHỐT (Phase 2b):** bước apply set new_elo TUYỆT ĐỐI (elo_before+delta, clamp floor/ceiling) — an toàn TRONG một trận. Nhưng `process_match_elo(p_session_id)` nhận SESSION id, không thấy for-loop → nghi set-based cả buổi. NẾU final_values có nhiều dòng/người (per-match) → dính pattern E3 + MẤT Elo chaining (elo_before không tươi). NẾU là kết quả session-level fixed-team (một dòng/người — hợp với team_no + report_session_outcome) → an toàn. CẦN: đọc keying của CTE player_base/calc để chốt (~10 phút). | 🟠 | OPEN |
| — | report_session_outcome + process_overdue_session_closures: có auth.uid() check, security definer, grant authenticated — bề mặt lành (survey level). | ✅ | — |

**Ghi chú kiến trúc:** hệ điểm là HAI tầng — Elo trận (chuẩn, có ledger) + peer validation ±15 (điều chỉnh xã hội). E1 (edge không auth) càng nặng hơn khi biết nó trigger cả hai.

## PHẦN C3 — PHASE 3: ROSTER EDGES (checkin / checkout / request-rest)

| ID | Vấn đề | Mức | Trạng thái |
|---|---|---|---|
| P3-1 | **NGHI 🔴 CẦN VERIFY:** 3 RPC versioned (checkin/checkout/set_rest) đều `security definer`, KHÔNG thấy guard host/caller — `auth.uid()` chỉ xuất hiện ở audit log (insert_live_mutation_audit_event), không phải chặn quyền. Nếu grant execute cho `authenticated` và không có check membership/host trong body → BẤT KỲ user đăng nhập nào thao túng roster kèo NGƯỜI KHÁC (check-in/out/rest hộ). VERIFY: đọc body 3 RPC trong 20260521000001_live_mutation_rpc_audit.sql (~dòng 42/139/199) tìm guard; kiểm `grant execute ... to authenticated`. | 🔴? | OPEN |
| P3-2 | Edges dùng `createUserClient(request)` (JWT passthrough) — mô hình đúng, KHÁC E1. Input validation (player_ids dedupe, group_with single) gọn. | ✅ | — |

## PHẦN C4 — PHASE 4: CỬA VÀO PLAYER & HOST

| ID | Vấn đề | Mức | Trạng thái |
|---|---|---|---|
| P4-1 | find-session/api.ts chỉ filter `status='open'` — KHÔNG thấy filter start_time tương lai → kèo quá khứ còn 'open' (nếu auto_close hụt) vẫn list cho player. VERIFY + đối chiếu auto_close coverage. | ⏳ | OPEN |
| P4-2 | Không thấy filter full (registered >= max_players) — có thể chủ đích (waitlist/pending ở dòng 26-27). VERIFY ý đồ. | ⏳ | OPEN |
| P4-3 | useHomeFeedData lỗi chỉ `console.error` → user thấy feed trống không lời giải thích. | 🔵 | OPEN |
| — | create-session controller: có validateStart/validateEnd, bề mặt lành (survey). | ✅ | — |

## PHẦN C5 — PHASE 5: COURTS · AUTH · NOTIFICATIONS

| ID | Vấn đề | Mức | Trạng thái |
|---|---|---|---|
| P5-1 | **Claim sân = first-come, KHÔNG verify chủ quyền:** RLS (20240504000002) cho phép bất kỳ authenticated user claim BẤT KỲ sân owner_id=null (USING owner_id IS NULL, WITH CHECK owner_id=auth.uid()) → mass-claim 869 sân bằng vòng lặp là khả thi (squatting). Cùng UPDATE có thể đổi luôn cột khác (name/address) trong một phát. Có thể là chủ đích MVP friction-free — nhưng cần: (a) rate-limit/verify khi mở rộng, (b) WITH CHECK chặt cột được đổi khi claim. QUYẾT ĐỊNH SẢN PHẨM + fix kỹ thuật. | 🟠 | OPEN |
| P5-2 | Notifications RLS view-own ✓ · Auth screens (Login/Onboarding/ProfileSetup) chuẩn survey-level. | ✅ | — |

## PHẦN C6 — PHASE 6: MATCH-RESULT · LIB NỀN · SCHEDULER

| ID | Vấn đề | Mức | Trạng thái |
|---|---|---|---|
| P6-1 | submit_session_results (HostMatchResultScreen:563) — kiểm guard caller=host trong RPC (result forging → elo). respond_to_session_result ĐÃ có guard chuẩn (auth+host+deadline) → kỳ vọng cùng kỷ luật; VERIFY 5 phút trong đợt fix. | ⏳ | OPEN |
| P6-2 | Lib nền (storage 109d, skillAssessment 216d, format/homeFeed/notifications): survey sạch, không smell nổi. roundRobinScheduler* (3 file + lib/scheduler 4 file): NGỦ ĐÔNG — không đường production gọi; review khi bật RR. | ✅ | — |

## PHẦN C7 — PHASE 7: ROSTER UI & QUALITY REPORT UI (bổ sung theo yêu cầu)

| ID | Vấn đề | Mức | Trạng thái |
|---|---|---|---|
| P7-1 | **player-quality-report.tsx (651d) — TIN TỐT:** per-player UI TỰ chuẩn hóa đúng: tính rounds_available (played+benched), expected_matches, giải thích shortfall tách bạch "vào sau vòng đầu" vs "bị xếp nghỉ N vòng có mặt". Tốt hơn nhánh fallback thô của engine (F1). | ✅ | — |
| P7-2 | Hệ quả P7-1: đây là bản cài availability THỨ BA song song (engine availability-metrics · client round-synthesis · report tự tính dòng 128). Ba bản độc lập = rủi ro lệch nhau (cùng họ F1/F4 hai-tầng-lệch). Khi fix F1 nên hợp nhất về MỘT nguồn (engine metrics) hoặc thêm test đối chiếu ba tầng. | 🔵 | OPEN |
| P7-3 | RosterSheet (298d): hiển thị + delegate toggle checkout/rest lên parent (đường mutations đã review & fix); có sẵn testID (tốt cho E2E). HostCheckInScreen (167d) + RosterScreen (463d) + flow-sheets (588d): survey bề mặt lành, CHƯA đọc từng dòng. | ✅/⏳ | — |

**Vùng còn lại CHƯA đọc từng-dòng (ghi nhận trung thực):** RosterScreen/HostCheckInScreen/flow-sheets body · ScheduleCoverageReport · player-side session-detail + my-sessions + rate-session/host-review + NotificationsScreen + CourtDetailScreen body · preview.ts client (846d). Đều đã survey khung; đọc sâu nếu triệu chứng chỉ vào.

## PHẦN C8 — PHASE 8: VÙNG DỒN (preview.ts · roster UI body · rate-session · còn lại)

| ID | Vấn đề | Mức | Trạng thái |
|---|---|---|---|
| P8-1 | preview.ts (912d): MODULE THUẦN — chỉ projection/metrics/comparators, không async/effect → rủi ro thấp. RosterScreen/HostCheckInScreen/flow-sheets: mutation glue chuẩn (invalidateQueries, Alert lỗi rõ, không optimistic rủi ro). | ✅ | — |
| P8-2 | **Rating dedupe chưa chắc:** UI có guard alreadyRated, nhưng KHÔNG tìm thấy unique constraint trên bảng ratings → double-tap/retry có thể tạo rating trùng. TƯƠNG TÁC NGUY HIỂM với E3: sau khi fix E3 (sum deltas), rating trùng sẽ CỘNG ĐÔI. → Fix E3 PHẢI kèm dedupe (unique(rater_id,rated_id,session_id) hoặc upsert trong submit_rating). VERIFY body submit_rating trước. | 🟠 | OPEN |
| P8-3 | **process_final_ratings gọi từ CLIENT sau mỗi lượt rate** (RateSessionScreen:504) → nhiều rater cùng lúc = nhiều run song song. Guard processed_at IS NULL chống xử-lại, nhưng HAI run ĐỒNG THỜI có thể cùng đọc chưa-xử rồi cùng áp (double-apply) nếu không có row-lock (for update skip locked). VERIFY locking trong RPC. Cùng gốc E1 (endpoint xử điểm ai gọi cũng được). | 🟠 | OPEN |
| P8-4 | my-sessions / NotificationsScreen / CourtDetailScreen / ScheduleCoverageReport: display-heavy, survey khung lành — không đọc từng dòng (lợi suất thấp, chờ triệu chứng). | ✅ | — |

## PHẦN C9 — PHASE 9: NỀN AUTH EDGE + CÁC EDGE GHI CÒN LẠI + COVERAGE TRUNG THỰC

| ID | Vấn đề | Mức | Trạng thái |
|---|---|---|---|
| P9-1 | **Nền auth xác nhận:** createUserClient (_shared/live-session.ts:121) = anon key + forward JWT → auth.uid() sống trong RPC. NHƯNG mọi RPC live-mutation là security definer = BỎ QUA RLS → bảo vệ duy nhất là guard trong THÂN hàm. → **P3-1 MỞ RỘNG PHẠM VI: verify guard cho TOÀN BỘ ~8 RPC versioned** (checkin/checkout/rest/create/cancel/sync_roster/set_group/swap_player), không chỉ 3 roster. | 🔴? | OPEN (gộp vào P3-1) |
| P9-2 | 5 edge ghi còn lại (create/cancel/sync-roster/set-group/swap-player): cùng pattern createUserClient + versioned RPC — cấu trúc nhất quán ✓, câu hỏi guard quy về P3-1. rounds-* edges: được V1 screen (legacy, court-lane prod không dùng) tham chiếu — cùng lớp P3-1, ưu tiên thấp. | ⏳ | — |

**COVERAGE TRUNG THỰC (repo ~79k dòng):** đọc từng-dòng ~40-50% theo trọng số rủi ro. Phần đuôi CHƯA đọc: pvnaQuizEngine (139d) + onboardingAssessment (152d) — seed Elo đầu vào, đáng một lượt khi nghi chất lượng seed · body 14 edge còn lại (pattern đã xác nhận nhất quán) · ~40 migration cũ · display screens (my-sessions/notifications/court-detail/profile/onboarding UI) · designSystem/format/utils. Nguyên tắc: review-on-symptom — đọc chay vùng display/legacy cho lợi suất ~0 (đã chứng minh qua đường cong 4 vòng engine).

## HÀNG ĐỢI PHASE TIẾP (theo ưu tiên rủi ro)

- [x] **Phase 2a (xong):** R1 ✅ an toàn · E2 ✅ hai hệ điểm verify · E3 🔴 mới (deltas vứt lặng lẽ).
- [x] **Phase 2b (xong, còn 1 nghi vấn):** apply-step an toàn per-match; E2b 🟠 chờ chốt keying per-session vs per-match · member_result_reporting + auto_close bề mặt lành.
- [x] **Phase 3 (xong):** P3-1 🔴? nghi thiếu guard quyền RPC roster (cần verify body) · P3-2 ✅ JWT passthrough đúng.
- [x] **Phase 4 (xong, survey):** P4-1/P4-2 ⏳ filter kèo quá-khứ/full · P4-3 🔵 feed lỗi câm · create-session lành.
- [x] **Phase 5 (xong):** P5-1 🟠 claim sân không verify · notifications/auth lành. (session-detail ngoài engine dồn sang Phase 6.)
- [x] **Phase 6 (xong):** P6-1 ⏳ verify guard submit_session_results · lib nền sạch · scheduler ngủ đông.\n\n**→ REVIEW 6/6 HOÀN TẤT. Bước kế: GOM TOÀN BỘ BẢNG NỢ THÀNH MỘT ĐỢT FIX (xem tổng hợp cuối file).**

---

## MAP HTML (picklematch-system-explorer.html) — CẦN CẬP NHẬT V2

Đối chiếu xong (map đúng ~60-70%):
- ✅ Khớp 100%: khu 03 Chấm điểm (weights/decay/intra/avoid verify từng số) · khu 07 Anti-FCFS (BEAM_K=3, width 100, ≤24, vòng 1-5) · topology khu 01 · tiers khu 04.
- ❌ Lỗi thời: MỌI bug badge (tất cả đã fix — đổi sang xanh + commit) · khu 06 cap-2 (đã gỡ — giờ min(courtCount, requestedCount) + effectiveCount; viết lại cả khu) · chú thích revert khu 02/09 (đã đóng; poll đã tắt refetchInterval:false) · hero chips.
- ➕ Thiếu component mới: tầng minh bạch (WARNING_LABELS + phân tầng + RestRiskBanner) · absolute-guard bậc buông (B1) · effectiveCount + court-count lock · isTrueFirstRound + closable_rounds (B2a) · hạ tầng quan sát (debug_dumps+decision_source, engine_instrumentation, board_stuck_events, verify-suggest-quality) · khu mới "Vòng đời kèo & người chơi" (register→checkin→play→result→ratings) với badge R1-R4, E1-E2, F1-F4.

---

## PHẦN D — AUDITABILITY & SCALABILITY (đánh giá kiến trúc, từ dữ liệu 9 phase)

**AUDITABILITY: MẠNH** — elo ledger (k_factor+expected mỗi delta) · live-mutation audit (auth.uid) · engine decisions (debug_dumps+decision_source+chosen_matches) · instrumentation + board_stuck_events + verify offline · warning transparency. **3 lỗ:** (1) E3 làm processed_at NÓI DỐI (đánh dấu đã-xử cả delta bị vứt) — trong đợt fix; (2) reliability/host_reputation KHÔNG có ledger (chỉ elo có); (3) P8-3 nhiều run song song → audit không phân biệt run nào áp.

**SCALABILITY: đủ cho vài trăm buổi/tuần.** Runtime ổn (engine per-session độc lập <500ms, cap chặt, polling tắt). **3 nút thắt thật — đều là scale-of-DEVELOPMENT:**
1. Engine bundle 6 edge → mỗi fix 6 deploy · logic nhân bản 2-3 tầng (họ F1/F4/P7-2) · god-file 3.7k dòng.
2. **Authorization không tập trung:** mọi RPC security definer bỏ RLS → mỗi RPC mới tự nhớ guard (gốc P3-1) — API phình = xác suất quên tăng. Fix hệ thống: helper assert_host/assert_member dùng chung thay vì guard chép tay.
3. Kỷ luật schema: 40+ migration, function đè qua nhiều file, apply lẫn kênh → drift risk khi tách staging/prod.

**Khuyến nghị trước platform play (KHÔNG cần rewrite):** đợt fix E3-cụm (audit trung thực) → chuẩn hóa guard tập trung (nâng P3-1 từ vá lẻ thành helper chung) → hợp nhất một nguồn availability/round → thêm ledger cho reliability/reputation khi hướng 1/5 cần.

## BACKLOG TƯƠNG LAI — 6 HƯỚNG SẢN PHẨM (bàn sau khi có dữ liệu buổi thật)

> Nguồn: định hướng Kevin. Mỗi hướng kèm map HẠ TẦNG ĐÃ CÓ trong code (từ review 9 phase) để lúc chọn hướng biết điểm xuất phát.

**1. Vibe & Cộng đồng (network effect)** — feed sau trận, crew/squad, leaderboard khu vực, huy hiệu flex (100 trận, unbeaten streak). *Đã có nền:* eloSystem bands, achievement_system migration, useHomeFeedData, group_id (crew mầm).

**2. Tạo kèo nhanh như nhắn tin** — 1-tap session (tự điền sân gần + giờ + Elo), Zalo/Messenger Mini App (join qua link không cần cài), broadcast kèo 5km. *Đã có nền:* register/[id] link-join ĐANG CHẠY (review Phase 1, R1 idempotent ✅), create-session controller, courts data 869 sân.

**3. AI Coach nhẹ (insight cá nhân)** — "thắng 78% khi partner Elo>1100", pattern thua theo giờ, gợi ý partner cải thiện điểm yếu. *Đã có nền:* match history + elo ledger (k_factor, expected_score — audit được, Phase 2), partner/opponent_counts.

**4. Quản lý tiền minh bạch** — split bill tự động (VNPay/MoMo), deposit chống no-show, lịch sử chi tiêu tháng. *Đã có nền:* KHÔNG CÓ GÌ trong code (xác nhận Phase 4 grep) — hướng tốn build nhất. Ghi chú cũ: PayOS recommended, manual disbursement trước.

**5. Yelp for Courts** — rating sân đa tiêu chí (mặt sân/ánh sáng/giá/vệ sinh/đậu xe), checkin tích điểm, real-time slot (tích hợp CourtReserve/SpeedCourt). *Đã có nền:* CourtDetailScreen, claim-court (⚠️ P5-1: claim chưa verify chủ quyền — PHẢI fix trước khi mở hướng này), courts_FINAL.json 869 sân + popular_times.

**6. Giải mini & nội bộ** — round-robin 8 người app tự xếp lịch + tính điểm + cập nhật Elo chính thức, corporate tournament (B2B). *Đã có nền:* lib/scheduler 4 file RR giữ chủ đích (ngủ đông, Phase 6) + roundRobinScheduler* 3 file, elo pipeline sẵn.

**Platform play (tầm nhìn lớn):** player ↔ sân ↔ kèo — giải đồng thời bài toán chủ sân (sân trống giờ thấp điểm, không kênh push slot, quản lý qua Zalo thủ công) và player (không biết sân nào trống, phải nhắn từng sân). Two-sided marketplace = phase 2 GTM đã ghi trong memory.

**Ràng buộc thứ tự (nguyên tắc đã thống nhất):** mọi hướng trên là retention/expansion — CHỈ chọn hướng sau khi: (1) đợt fix gom xong, (2) buổi test thật chạy, (3) có tín hiệu host/player thật. Riêng P5-1 (claim sân) phải fix TRƯỚC nếu chọn hướng 5.
