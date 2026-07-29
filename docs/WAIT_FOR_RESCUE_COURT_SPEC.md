# Spec: Nút "Chờ Sân X / Chơi luôn" khi lineup người-rảnh bị tệ

Status: PHASE 1 CODE XONG — **mặc định BẬT cho mọi session**; kill-switch secret `SESSION_BLOWOUT_RESCUE=0` để tắt. Chờ deploy edge + rebuild client.
Branch: feat-next-match-suggester

## Tiến độ
- [x] **Phase 1 (blowout)** — code xong, flag-gated OFF:
  - Engine `live-preview.ts`: `findRescueCourts` + tại defer, khi `blowoutRescue` bật → seat lineup lệch (không `continue`) + gắn `degraded_reason='blowout'` + `rescue_court_idxs`. Flag off → defer cũ y nguyên.
  - Edge `index.ts`: flag `SESSION_BLOWOUT_RESCUE` → truyền `blowoutRescue`; field flow qua `final_preview_board`. `deno check` pass.
  - Client `preview.ts` + `ScreenComponents.tsx`: banner "⏳ Trận hơi lệch — Chờ Sân X sẽ cân hơn, hoặc bấm Bắt đầu để chơi luôn" (Start vẫn bật = "Chơi luôn").
  - Verify: OFF defer ✓ / ON seat+rescue ✓ (probe deterministic); 86/86 unit test pass; typecheck 4 file sạch.
  - **Best-effort (by-design):** rescue verify chạy trong budget bounded → khi CPU tải/hết budget có thể KHÔNG tìm ra rescue (banner ẩn) nhưng blowout VẪN seat. Có thể chưa tìm HẾT sân cứu (tối thiểu 1). Tinh chỉnh budget sau nếu cần.
- [x] **Phase 2 (lặp)** — code xong, cùng flag `SESSION_BLOWOUT_RESCUE`:
  - Engine: thêm phát hiện lặp (`getProjectedRepeatSummary` max_opp/partner ≥ 3) cạnh blowout; `isFixed` phải sửa MỌI vấn đề (lệch VÀ/HOẶC trùng); `degraded_reason` = blowout|repeat|both. Cùng `findRescueCourts`.
  - Client: banner label theo reason (lệch→"cân hơn", trùng→"đỡ trùng", both→"tốt hơn").
  - Verify: probe rolling — repeat được phát hiện (extreme: 20 repeat), rescue tìm được ở một số ca; **KHÔNG có rescue → banner tự ẩn** (không lừa host). typecheck sạch, 81 test pass, deno check pass. Bump version 28.
  - **Chưa deploy** (chờ user) — cần re-deploy edge + rebuild client.
- [x] **Phase 3 (giải thích per-match)** — code xong, cùng flag:
  - Engine: `explainMatchCompromises` (pure, không gọi engine) — nêu CỤ THỂ mọi compromise (tên + số): lặp đối thủ/đồng đội **mọi mức kể cả lần 2**, intra (mạnh+yếu), blowout (chênh + lý do pool skew). Kèm lý do **dẫn xuất** (ít-trận-nhất, pool lệch trình, cân-tổng). Gắn `match_explanations` vào payload (sau flag).
  - Client: list "Vì sao xếp trận này" trên card.
  - Verify: probe — sinh đúng ("X(4.8)+Y(2.0) cùng đội để cân tổng", "Trận lệch 2.5 — vì người rảnh phần lớn trình cao"); typecheck sạch, 81 test pass, deno check pass. Bump version 29.
  - **Độ sâu (chốt): chỉ cần nói ĐÚNG lý do engine, không cần phản-chứng đầy đủ (Phase 3b BỎ).** Các lý do đều tie vào cơ chế THẬT của engine:
    - Lặp → "vì lúc này ít người rảnh, khó tránh" **chỉ khi pool nhỏ** (≤6) — gốc cấu trúc thật; pool lớn thì chỉ nêu sự-thật, không đoán.
    - Intra "để cân tổng 2 đội" **chỉ khi tổng 2 đội thật cân** (nếu blowout thì dòng blowout lo, không nói sai).
    - Blowout → "vì người rảnh phần lớn trình cao/thấp" **chỉ khi pool thật sự lệch**.
  - **Deployed** edge v188 (cùng v186/v187 cho Phase 1/2). LIVE_PREVIEW_ALGORITHM_VERSION=29.

## Trạng thái deploy
- Edge: **v190 ACTIVE**, flag `SESSION_BLOWOUT_RESCUE` **default ON** (kill-switch `=0`). LIVE_PREVIEW_ALGORITHM_VERSION=31.
- Live: Phase 1 (blowout seat+rescue) + Phase 2 (lặp) + Phase 3 (giải thích cụ thể) + **Phase 3b (phản-chứng cho trận lặp)**.
- **Client: CHƯA rebuild** — banner "Chờ Sân X / Chơi luôn" + list "Vì sao xếp trận này" (gồm phản-chứng) chỉ hiện sau khi rebuild app.

---


## 1. Mục tiêu

Khi refill **1 sân lẻ** giữa vòng (các sân khác đang live) mà lineup ghép từ người-đang-rảnh
bị **tệ** (lệch trình hoặc trùng người), cho host **quyết định**:
- **Chơi luôn** (mặc định) — chơi trận tệ đó ngay, giữ nhịp.
- **Chờ Sân X** (tùy chọn) — đợi một sân cụ thể xong để ghép được trận tốt hơn.

Không bao giờ ép chờ. Ưu tiên tinh thần **pickleball giao lưu**: giữ người vận động > tối ưu chất lượng.

## 2. Quyết định đã chốt

1. **Mặc định = "Chơi luôn"**; "Chờ" là tùy chọn (áp cho CẢ blowout lẫn lặp).
2. Làm **cả 2 phase** (blowout + lặp).
3. Ngưỡng: **blowout = chênh tổng-đội > 1.5**; **lặp = `max_opponent_pair_count ≥ 3` hoặc `max_partner_pair_count ≥ 3`** (lần thứ 3 gặp lại; khớp cap engine = 2).

### Hệ quả của (1) — thay đổi hành vi hiện tại
Blowout hiện **tự động defer** (`shouldDeferTightPoolSuggestion` → giữ sân trống chờ 30s).
Mặc định "Chơi luôn" ⇒ **bỏ auto-defer**, thay bằng **seat trận lệch (startable) + nút Chờ**.
- Blowout & lặp dùng **chung một cơ chế**: seat trận tệ + nút "Chờ" host tự bấm.
- Bonus: hết các ca "sân kẹt vì defer giữ trống".

### Trần cực đoan — ĐÃ CHỐT: **bỏ hẳn (không trần)**
Mọi blowout đều seat-được-ngay + nút Chờ tùy chọn. (Để cấu trúc dễ bật lại nếu sau cần.)

## 2b. Yêu cầu bổ sung: GIẢI THÍCH per-match cho MỌI compromise

Mọi trận có nhượng bộ — **kể cả lặp trong ngưỡng (lần 2)** — phải hiển thị **giải thích cụ thể
vì sao xếp như vậy**, không chỉ code chung chung.

Hiện trạng (gap): đã có `warnings`/`tradeoffs`/`fairness_reason_details` + `WARNING_LABELS`,
nhưng **generic** ("Engine vượt cap lặp"), chưa nêu **ai / chênh bao nhiêu / lần mấy**; và
**lặp lần-2 (trong cap) KHÔNG có warning** nên hiện không giải thích gì.

Yêu cầu — mỗi trận liệt kê cụ thể nhượng bộ + lý do, ví dụ:
- Lặp: *"Anh & Bình đấu lại lần 2"* (kể cả trong ngưỡng); *"…lần 3 — vì là 2 người ít trận nhất còn rảnh"*.
- Blowout/intra: *"Mạnh(4.8)+Yếu(2.1) cùng đội để cân tổng"*; *"lệch 1.8 vì người rảnh lúc này lệch trình"*.
- Must-play: *"Cường phải vào vì đã nghỉ 2 vòng"*.

Chi tiết ở **Phase 3**.

## 3. Cơ chế cốt lõi: verify "sân cứu" (dùng chung 2 loại)

Khi lineup người-rảnh `A` bị tệ, với **mỗi sân đang live** `X`:
1. Giả lập "X xong" → thả 4 người của X vào pool.
2. Gọi lại `suggestNextMatch` cho sân đang trống → được `B_X`.
3. `X` là **"sân cứu"** nếu `B_X` **hết tệ** (cân nếu A lệch / hết trùng nếu A trùng) **VÀ** `B_X` dùng ≥1 người của X.

- ≥1 sân cứu → hiện nút "Chờ Sân X (hoặc Y)".
- 0 sân cứu → **không hiện nút Chờ**, chỉ "Chơi luôn" (tệ cấu trúc, chờ vô ích).

**Invariant an toàn TỰ ĐỘNG:** verify bằng chính engine (`suggestNextMatch`) vốn ép mọi invariant
(no double-book, availability, must-play/rest, guard nghỉ-2-vòng, avoid-pairs, PVNA/repeat caps).
Nếu phá-tệ mà buộc phạm luật → engine không đẻ lineup đó → `B_X` vẫn tệ → không thành sân cứu.
Ta **chỉ offer lineup engine tự sinh**, không bao giờ tự bịa.

**Độ tin cậy (sim):** sân-cứu đích-danh đúng ~79–93% tại thời điểm chụp; drift làm giảm chút.
Nên UI ghi *"có thể cân/đỡ trùng hơn"* (khả năng), không hứa chắc.

## 4. Phân loại tệ (2 trục độc lập, tính trên lineup A)

| Loại | Đo | Ngưỡng |
|---|---|---|
| Blowout | `pvna_diff = |tổng A − tổng B|` | > 1.5 |
| Lặp | `getProjectedRepeatSummary(...).max_opponent_pair_count` / `max_partner_pair_count` | ≥ 3 |

Một lineup có thể dính 1, cả 2, hoặc không. `degraded_reason` = `'blowout' | 'repeat' | 'both'`.

## 5. UX

- Lineup A (chỉ gồm người-rảnh) **luôn startable ngay** = nút **"Chơi luôn"** (mặc định).
- Nếu có sân cứu → thêm nút **"Chờ Sân X"**:
  - Blowout: *"⏳ Chờ Sân X xong → trận cân hơn"*
  - Lặp: *"⏳ Chờ Sân X xong → đỡ trùng"*
  - Nhiều sân cứu → liệt kê: *"Chờ Sân 3 hoặc 5"*.
- Bấm "Chờ Sân X" → **giữ sân này** (không seat A); khi X xong → preview tự chạy lại → ra lineup tốt hơn.
- Host không bấm gì → seat A ngay (mặc định).
- Cho host **tắt tính năng** (chỉ muốn app tự chạy).

## 6. Điểm sửa (theo audit)

### Engine — `lib/next-round-suggester/live-preview.ts`
- Thêm helper `findRescueCourts(...)`: vòng qua live courts, verify sân cứu (mục 3).
- Tại chỗ defer hiện tại (~4425–4442): **bỏ `continue`**; thay bằng: tính tệ (blowout/lặp) →
  nếu tệ, chạy `findRescueCourts` → gắn metadata + **giữ lineup A** (không vứt).
- Thêm check **lặp** (hiện defer không check) trên lineup đã chọn.
- Payload thêm: `degraded_reason`, `rescue_court_idxs: number[]`.
- Bounded: chỉ verify khi A tệ; cắt theo `getRemainingCourtBudgetMs` (hết budget → seat A, bỏ verify).

### Edge — `supabase/functions/session-live-matches-suggest/index.ts`
- Pass-through `degraded_reason`, `rescue_court_idxs` (giống `quality_deferred_courts`).

### Client
- `hooks/useLiveBoard.ts`: đọc field mới; thêm state "sân đang được host giữ chờ".
- `components/ScreenComponents.tsx` (`SuggestedLiveMatchCard`): tái dùng wait-UI (`showWaitUI`,
  `lockedWaitLabel`, `availablePoolPreview`) → 2 nút "Chờ Sân X" / "Chơi luôn"; label theo `degraded_reason`.
- Cơ chế **giữ-sân-theo-yêu-cầu**: host bấm Chờ → đánh dấu court held; khi sân cứu xong → tự refresh.

## 7. Phase

- **Phase 1 — Blowout:** bỏ auto-defer → seat + verify sân cứu + 2 nút. Sim trước/sau (không under-fill), unit test, thử session thật.
- **Phase 2 — Lặp:** thêm trigger lặp + dùng chung verify + cơ chế giữ-sân. Sim xác nhận ~80% verify đúng; test hold; đảm bảo không bấm → seat ngay.

- **Phase 3 — Giải thích per-match cho mọi compromise (yêu cầu 2b):**
  - Engine: hàm `explainMatchCompromises(teamA, teamB, state, ...)` → trả list lý do **cụ thể** (nêu tên + số):
    - Lặp partner/opponent **mọi mức** (kể cả lần 2): dùng `getProjectedRepeatSummary` + `affected_pairs` → "A & B lần N".
    - Intra: nêu cặp mạnh+yếu + số chênh → "để cân tổng".
    - Blowout: nêu số chênh tổng-đội + lý do pool.
    - Must-play / rest / quota: từ `consecutive_rest`, tier.
  - **Độ sâu: SÂU (đã chốt) — bằng phản-chứng (counterfactual), KHÔNG chém lý do:**
    Với mỗi nhượng bộ, engine **tính thử phương án TRÁNH nó** rồi báo phương án đó **tốn gì thật**:
    - Tránh lặp A-B → best lineup không-trùng → báo nó tốn gì ("tạo trận lệch 2.3" / "buộc Cường nghỉ tiếp").
    - Blowout → phân tích pool: "5 người rảnh đều >4.5, không đủ người yếu để cân".
    - Must-rest forced → từ `consecutive_rest`.
    - Số liệu **lấy từ alternative THẬT engine sinh** (đã có `max_alternatives`), không bịa.
  - **Caveat trung thực:** optimizer đa-yếu-tố; ta giải thích qua **phản-chứng trội nhất** (phương án tốt nhất tránh đúng nhượng bộ đó) — đúng số nhưng là **rút gọn** của toàn cảnh score. Ghi rõ, không tuyệt-đối-hoá.
  - Payload: field mới `match_explanations: string[]` (hoặc mở rộng `fairness_reason_details` phủ mọi compromise).
  - Client: `SuggestedLiveMatchCard` render list (mở rộng chỗ warning), **luôn hiện khi có compromise** — kể cả trận seat bình thường.
  - **Chi phí:** mỗi nhượng bộ cần 1 lượt tính phản-chứng → chỉ chạy khi có compromise, trong budget edge; nếu hết budget → hạ về giải-thích-nông (nêu nhượng bộ, bỏ phản-chứng).

## 8. Guard / rủi ro
- **Bound chờ:** không để người *must-play* lỡ lượt vì chờ; cap thời gian như defer (30s).
- **Compute:** verify thêm N lượt `suggestNextMatch` (N = số sân live), chỉ khi A tệ, trong budget edge.
- **Feature flag** để A/B + tắt an toàn.
- **Drift:** phrasing "có thể", không hứa chắc.
- **Bỏ auto-defer:** kiểm hồi quy các session từng bị blowout — giờ sẽ seat thay vì chờ; xác nhận host chấp nhận.

## 9. Verify / test mỗi phase
- Sim harness (`scripts/diagnostics/probe-*.ts`, `tests/.../simulation`): under-fill, opponent_repeat, blowout rate trước/sau.
- Unit test path seat+rescue + hold.
- Session thật + engine_instrumentation.
