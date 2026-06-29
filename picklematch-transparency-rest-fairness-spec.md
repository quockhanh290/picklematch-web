# Spec: Minh bạch ràng buộc + Rest-fairness cho Live Suggester

## NGUYÊN TẮC XUYÊN SUỐT (đọc trước khi làm)

> **Mọi lần engine nới một ràng buộc, host PHẢI thấy.** Engine được phép nới (nới là cần để lấp
> sân), nhưng KHÔNG được nới âm thầm. Host nắm bối cảnh thật (ai muốn nghỉ, ai sắp về) mà engine
> không biết — nên engine đề xuất + cảnh báo rõ, **host quyết**.

Bleed audit đã xác định: **engine minh bạch** (sinh warning cho gần như mọi lần nới), nhưng **UI
nuốt 7 warning quan trọng nhất** (toàn bộ về rest / consecutive-play / lineup thay thế). Spec này
sửa cái đó + thêm cơ chế rest-fairness A/B có host quyết.

---

## KỶ LUẬT THỰC THI (bắt buộc — đã học từ chuỗi 546)

1. **Survey trước, sửa sau.** Mỗi STAGE bắt đầu bằng đọc + báo cáo, DỪNG chờ duyệt trước khi sửa.
2. **An toàn trước, rủi ro sau.** STAGE A & B là client-only (rủi ro ~0) → làm trước. STAGE C đụng
   engine (rủi ro 546/regression) → chỉ làm sau khi A,B ổn + BENCH trước khi deploy.
3. **Commit riêng từng stage.** Để stage sau hỏng không kéo stage trước xuống.
4. **Phân biệt deploy:**
   - Client (ScreenComponents, NextRoundSuggesterScreenV2, useNextRoundModel) → build lại web
     (Vercel) / reload app bundle. **KHÔNG phải** `supabase functions deploy`.
   - Engine (lib/next-round-suggester) bundled vào 6 edge → `supabase functions deploy` cả 6:
     session-live-matches-suggest, session-rounds-suggest, session-rounds-start,
     session-rounds-end, session-summary, session-fairness.
5. **KHÔNG đổi logic chọn match ngoài phạm vi spec.** Không tune weights, không đổi stage ladder
   trừ chỗ spec nói.

---

## STAGE A — Mapper warning trung tâm (CLIENT, an toàn, LÀM TRƯỚC)

**Vấn đề:** client kiểm tay từng warning (`warnings.includes('INTRA_TEAM_GAP_RELAXED')`...), nên
7 warning bị nuốt: `REST_REQUIREMENT_RELAXED`, `MUST_REST_FORCED_PLAY`,
`LIVE_REPLACEMENT_QUOTA_RELAXED`, `LIVE_REPLACEMENT_RECYCLE_RELAXED`,
`LIVE_REPLACEMENT_RECYCLE_HARD_RELAXED`, `REPEAT_CAP_REACHED`, `EXHAUSTIVE_FALLBACK`.

### A0 — Survey
- Grep `'[A-Z_]{6,}'` trong `lib/next-round-suggester/` → liệt kê TẤT CẢ warning code engine sinh.
- Đối chiếu code nào client đang hiển thị (ScreenComponents ~1938-1990).
- IN bảng: code | engine sinh ở đâu | client có hiển thị không. DỪNG chờ duyệt.

### A1 — Mapper + render
- Tạo `WARNING_LABELS: Record<string, { severity: 'info' | 'warning'; text: string }>` phủ HẾT
  code engine sinh. Message tiếng Việt, hướng host, không jargon. Gợi ý:
  - `REST_REQUIREMENT_RELAXED` → warning, "Có người sẽ nghỉ 2 lượt liên tiếp — engine không đủ chỗ xếp họ vào."
  - `MUST_REST_FORCED_PLAY` → warning, "Có người phải chơi tiếp dù đã chơi nhiều lượt liền (thiếu người thay)."
  - `LIVE_REPLACEMENT_QUOTA_RELAXED` → info, "Lineup thay thế: đã nới giới hạn số trận để lấp sân."
  - `LIVE_REPLACEMENT_RECYCLE_RELAXED` → warning, "Lineup thay thế: có người vừa chơi nhiều lượt được xếp lại."
  - `LIVE_REPLACEMENT_RECYCLE_HARD_RELAXED` → warning, "Lineup thay thế: nới giới hạn nghỉ ở mức cao — người chơi liên tục nhiều."
  - `REPEAT_CAP_REACHED` → info, "Cặp đấu/đồng đội đã chạm mức lặp tối đa."
  - `EXHAUSTIVE_FALLBACK` → info, "Trận khó — engine phải duyệt cạn để tìm phương án."
  - Các code đã hiển thị (PVNA_*, INTRA_*, REPEAT_CAP_RELAXED, MUST_PLAY_OVER_CAPACITY,
    PARTIAL_COURTS, NO_VALID_MATCH, NOT_ENOUGH_PRESENT...) → dùng message hiện có, đừng đổi nghĩa.
- Render: mỗi trận suggested → `match.warnings` map qua `WARNING_LABELS` → hiển thị danh sách cảnh
  báo **ngay tại trận đó** (không phải dòng cuối màn). `warning` nổi hơn `info`.
- **FALLBACK quan trọng:** warning code KHÔNG có trong map → vẫn hiển thị raw code + console.warn
  để bổ sung sau. → KHÔNG BAO GIỜ nuốt im lặng nữa, kể cả code thêm trong tương lai.

### A2 — Đảm bảo passthrough edge→client
- Kiểm `SuggestedMatchPayload.warnings` có được edge trả về đầy đủ không (không bị lọc mất các
  code trên). Nếu edge lọc warning → bỏ lọc.

**Commit:** `ux(live): surface all engine relaxation warnings to host (no silent constraint bleed)`
**Deploy:** build lại client. (+ deploy edge nếu A2 phải sửa edge passthrough.)

---

## STAGE B — Cảnh báo rest-risk CÓ TÊN (CLIENT, an toàn)

**Mục tiêu:** chủ động báo host AI sắp nghỉ 2 vòng liên tiếp, để host hành động kịp.

### B0 — Survey
- ScreenComponents ~3506 đã có `mustPlayIds` (consecutive_rest >= 1). EngineConstraintNotice đã có
  gợi ý "thêm sân"/"chấp nhận nghỉ". Manual swap + forced_required_player_ids đã tồn tại.
- Báo cáo: chỗ nào thêm cảnh báo-có-tên + nút hành động. DỪNG chờ duyệt.

### B1 — Cảnh báo + hành động
- Tính rest-risk: player `consecutive_rest >= 1` (late-arrival `matches_played===0` thì `>= 2`),
  không checked_out/opted_rest, KHÔNG nằm trong trận suggested/live lượt tới.
- Hiển thị nổi bật, có tên, gần board:
  - 1 người: "⚠️ [Tên] sẽ nghỉ 2 lượt liên tiếp nếu không xếp vào trận tới."
  - nhiều: "⚠️ [Tên A], [Tên B] sẽ nghỉ 2 lượt liên tiếp nếu không xếp vào."
- Nút hành động (tái dùng cơ chế có sẵn): "Thêm sân" (nếu thêm sân đủ chỗ) / "Xếp [Tên] vào"
  (forced_required / manual swap) / bỏ qua.
- Nếu engine báo `REST_REQUIREMENT_RELAXED` / `MUST_PLAY_OVER_CAPACITY` (bất khả) → đổi message:
  "[Tên] phải nghỉ thêm 1 lượt — không đủ người/sân lúc này" (báo cho biết, không đổ lỗi engine).

**Commit:** `ux(live): named rest-risk warning + quick actions`
**Deploy:** build lại client.

---

## STAGE C — Rest-fairness A/B (ENGINE, RỦI RO — BENCH TRƯỚC KHI DEPLOY)

**Mục tiêu:** "A mặc định + ngoại lệ khi chênh nặng + host lật A/B".
- A = ép người rest-risk vào (rest-fair, có thể chênh hơn).
- B = trận tối ưu (bỏ qua → người đó nghỉ 2 vòng).
- Mặc định A; tự sang B nếu A chênh **quá nặng**; luôn cho host lật.

### C0 — Survey
- `buildLiveTradeoffChoices` / `tradeoff_choices` / `recommended_tradeoff_choice` (live-preview.ts)
  hoạt động thế nào? Tái dùng để present cặp A/B được không?
- `forced_required_player_ids` (suggest.ts) ép 1 người vào trận thế nào?
- Liệt kê MỌI chỗ `requiredPlayerIds` bị bỏ rơi trong relaxation ladder + 5 rescue + force pass.
- IN báo cáo, DỪNG chờ duyệt.

### C1 — Sinh A/B + ngưỡng + recommend
Khi có rest-risk player cho một sân:
1. Sinh A (ép người đó vào qua `forced_required_player_ids`, tìm trận tốt nhất CÓ họ) và B (tối ưu
   bình thường).
2. Tính "độ chênh" của A (intra/inter PVNA gap, số hard-violation).
3. Recommend:
   - A chênh trong ngưỡng → recommend A (rest-fair mặc định). Ngưỡng khởi đầu (hằng số NAMED, vd
     `REST_FAIRNESS_MAX_INTRA_GAP = 2 * tolerance`): A không tạo hard PVNA violation VÀ intra-gap
     A <= ngưỡng.
   - A vượt ngưỡng (chênh quá nặng) → recommend B, NHƯNG vẫn surface A để host lật.
4. Present qua `tradeoff_choices`:
   - A: "Cho [Tên] chơi (trận chênh hơn)"
   - B: "Trận cân hơn ([Tên] nghỉ thêm 1 lượt)"
   - `recommended_tradeoff_choice` theo bước 3.
5. Nếu A bất khả (ép vào cũng không ghép được kể cả nới hết) → chỉ B + warning
   `REST_FAIRNESS_UNAVOIDABLE`. KHÔNG đốt budget/treo → degrade, KHÔNG 546.
- Client: render 2 choice + nút lật một chạm (tái dùng UI tradeoff_choices).
- `REST_FAIRNESS_UNAVOIDABLE` thêm vào WARNING_LABELS (Stage A).

### C2 — required nới CUỐI CÙNG (giảm bleed gốc)
- Trong relaxation ladder + rescue: giữ required filter qua TẤT CẢ tầng nới pvna/gender/repeat;
  required chỉ bỏ ở tầng CUỐI, sau khi đã nới hết mọi thứ khác. (Thứ tự nới: pvna → gender →
  repeat → required.) Mỗi lần bỏ required → emit `REST_REQUIREMENT_RELAXED` (đã có) để Stage A surface.

### C3 — BENCH (bắt buộc trước deploy)
- Sandbox: state có rest-risk player + pool căng (gender dày). Xác nhận:
  (a) sinh được cả A và B; A ép đúng người; recommended đúng ngưỡng.
  (b) wall-clock < 2s (không 546 do sinh 2 phương án + ép required).
  (c) A bất khả → degrade + warning, KHÔNG treo.
  IN số đo. Nếu (b) > 2s → BÁO LẠI, KHÔNG deploy.

**Commit:** tách C1 / C2 riêng. **Deploy:** 6 edge SAU khi bench OK.

---

## STAGE D — Verify invariant + phân biệt host/engine (TOOLING, offline)

**Mục tiêu:** đo được "có ai nghỉ 2 vòng không + tránh được không" và KHÔNG đổ oan engine khi host
chủ động chọn thay thế.

### D1 — Dump ghi đủ + phân biệt quyết định
- debug_dumps thêm cột: `chosen_matches jsonb`, `pvna_tolerance numeric`, `rounds jsonb`,
  `decision_source text`, `request_flags jsonb`.
- `chosen_matches` mỗi trận: `{ court_idx, team_a, team_b, is_replacement (=available_pool_only),
  relaxation_warnings (warnings lọc 'LIVE_REPLACEMENT_*' + 'REST_*'), tradeoffs, warnings }`.
- `decision_source`: 'host_replacement' nếu request có prefer_available_pool/available_pool_only;
  ngược lại 'engine_auto'.
- `rounds` = state.rounds (round_no, status, matches[{team_a,team_b}], resting) → cho recentRepeatCost.
- Ghi cả khi board đầy đủ (gate env VERIFY_DUMP=1). Bọc try/catch. Deploy 6 edge.

### D2 — verify-suggest-quality.ts (đã có) cập nhật
- Đọc thêm decision_source / is_replacement / rounds.
- Phân loại báo cáo:
  - `engine_auto`: delta = chất lượng ENGINE thật.
  - `host_replacement`: lệch tối ưu DO HOST CHỌN → báo riêng, KHÔNG tính engine bỏ lỡ.
- Thêm invariant "không ai nghỉ 2 vòng khi tránh được": với người để nghỉ 2 vòng, brute-force xem
  có phương án A hợp lệ trong ngưỡng không → CÓ mà chọn B = sai logic; KHÔNG = bất khả (phải có
  warning REST_FAIRNESS_UNAVOIDABLE).

---

## THỨ TỰ + CHECKLIST TEST

1. **A** (mapper warning) → build client → kiểm: mỗi trận hiện đủ cảnh báo nới (không nuốt).
2. **B** (rest-risk có tên) → build client → kiểm: ai sắp nghỉ 2 vòng hiện tên + nút hành động.
3. **C** (A/B engine) → BENCH → deploy 6 edge → kiểm: trận rest-risk hiện 2 lựa chọn + recommend
   đúng + lật được + không 546.
4. **D** (verify/dump) → thu vài buổi → chạy verify → đọc engine_auto vs host_replacement vs invariant.

**Nguyên tắc cuối:** sau toàn bộ, mỗi lần engine nới BẤT KỲ ràng buộc nào (pvna/gender/repeat/rest/
recycle/replacement) → host ĐỀU thấy, và với rest-fairness host còn được lật A/B. Không còn "bleed"
âm thầm.
