# PROMPT — Audit panel alternative (dán nguyên khối này vào phiên mới)

## Việc

Audit toàn bộ phần "panel alternative" của app: **production đang thật sự chạy gì**, và có vấn đề gì.
**KHÔNG sửa bất cứ thứ gì** cho tới khi có bảng kết luận và host duyệt. Đã có quá nhiều thay đổi chồng
lên nhau, nên mục tiêu của phiên này là *xác lập sự thật*, không phải cải tiến.

Giả định của host cần kiểm chứng, không được coi là đúng: *"alternative phải là 3 hướng cho host quyết"*.
Đọc code trước đã thấy mâu thuẫn — `types.ts:246` khai **bốn** id:
`'balanced' | 'keep_pvna' | 'reduce_intra' | 'reduce_repeat'`. Nhiệm vụ đầu tiên là làm rõ con số thật,
và "3 hướng" đó là ý định sản phẩm hay là ký ức sai.

## Ba khái niệm khác nhau, rất hay bị lẫn — tách bạch trước khi đo

| khái niệm | là gì | nơi sinh |
|---|---|---|
| `alternatives` | danh sách lineup ứng viên engine tự xếp hạng, **nội bộ**, không hiện cho host | `suggest.ts`, giới hạn bởi `LIVE_TRADEOFF_ALTERNATIVE_LIMIT = 12` (`live-preview.ts:98`), và `LIVE_TRADEOFF_DEEP_ALTERNATIVE_LIMIT`, `LIVE_QUOTA_RESCUE_ALTERNATIVE_LIMIT` |
| `tradeoff_choices` + `recommended_tradeoff_choice` | **panel host nhìn thấy** — các hướng để chọn | `live-preview.ts` |
| `forced_tradeoff` + `wait_rescue_options` | quyết định *chờ sân* vs *chơi luôn*, một loại panel khác hẳn | `live-preview.ts`, `forced-decision.ts` |

Trộn ba cái này là cách nhanh nhất để ra kết luận sai. Trong mọi báo cáo phải gọi đúng tên.

## Bản đồ code

**Engine (`lib/next-round-suggester/`)**
- `live-preview.ts` (5900 dòng) — nơi mọi thứ hội tụ:
  - `buildLiveTradeoffChoices` (:3512) — builder chính
  - `buildConditionalLiveQualityTradeoffChoices` (:1643) — nhánh điều kiện
  - `buildOverThresholdRepeatTradeoff` (:3695) — fallback khi hai cái trên trả `null`
  - `buildLegacyOverThresholdRepeatTradeoff` (:3708) — **bản legacy còn nằm đó**, kiểm xem ai còn gọi
  - `buildBalanceFreshnessTradeoff` (:3644)
  - Chuỗi quyết định thật nằm ở **:3785-3792** — đọc kỹ, nó là `(A ? B : C) ?? D`
  - `pickRecommendedTradeoffChoice` (:3271), `compareChoiceMetrics` (:3259),
    `isReasonableTradeoffChoice` (:3351), `getTradeoffChoiceMetrics` (:1299)
  - `dropStaleDerivedMetadata` (:3069) — **xoá** `tradeoff_choices` khi lineup đã đổi; đường dựng lại ở :3056
  - `resolveLivePreviewFinalChoice`
- `forced-tradeoff.ts`, `alternatives.ts`, `verdict.ts`

**Edge:** `supabase/functions/session-live-matches-suggest/index.ts`

**Client (`features/host/session-detail/next-round-v2/`)**
- `components/ScreenComponents.tsx` (4390 dòng) — render panel
- `hooks/useLiveBoard.ts` — máy trạng thái, nơi host bấm chọn
- `forced-decision.ts` (236 dòng)
- `match-compromises.ts` (79 dòng) — hàm thuần suy ra danh sách đánh đổi hiển thị
- `preview.ts`

## Đã đo rồi — ĐỪNG đo lại, chỉ xác nhận còn đúng không

1. **Panel hiếm hơn tưởng rất nhiều.** Scorecard 60 kèo (`scratch/out/sc-after.json`):
   `panel_pct 5.7` · `panel_choices_pct 5.7` · `panel_forced_pct 0`.
   Tức chỉ 5,7% số trận có panel, và loại `forced_tradeoff` **không xuất hiện lần nào** trong corpus.
2. **84% panel bị vứt sau post-pass.** Engine dựng `choices` 172 lần, `dropStaleDerivedMetadata` bỏ 144
   vì post-pass đổi lineup mà không ai tính lại metadata. Bản vá CX-1 nâng 0→21 — **trị triệu chứng**.
   **ROOT FIX chưa làm: tính lại metadata sau post-pass.** Xem comment tại `live-preview.ts:3006`
   ("935 of 1160 payloads") — kiểm con số đó còn đúng không.
3. Ba kết luận SAI đã bị loại trừ trước đây về chủ đề này — tra `docs/ENGINE_FRAGMENTATION_AUDIT.md`
   mục #2/#8/#12/#19/#30 trước khi mở lại bất kỳ hướng nào trong đó.
4. `docs/AUDIT_SUMMARY.md` là ảnh chụp trạng thái tổng tại `baseline-algo-81`.

## Câu hỏi phải trả lời

1. **Prod đang chạy gì?** ALGO nào, edge version nào, cờ nào bật. Đừng đọc code rồi suy — đọc
   `debug_dumps` thật và `engine_build` trong đó.
2. Trên kèo thật gần nhất: bao nhiêu % trận có `tradeoff_choices`? Mỗi panel có **mấy** lựa chọn?
   Phân bố theo id (`balanced`/`keep_pvna`/`reduce_intra`/`reduce_repeat`) ra sao?
3. Bốn id đó có bao giờ **cùng xuất hiện** không, hay thực tế chỉ ra 2? Nếu chỉ 2 thì cổng nào cắt?
4. `recommended_tradeoff_choice` có luôn nằm trong `choices` không? Có bao giờ null trong khi có choices?
5. Host bấm chọn thì điều gì xảy ra — đường đi từ `useLiveBoard` tới persist, và lựa chọn đó có thật sự
   được tôn trọng không, hay bị post-pass ghi đè (đây đúng là hình dạng của bug #2/#8).
6. `dropStaleDerivedMetadata` hôm nay còn bỏ bao nhiêu %? Root fix (tính lại sau post-pass) khả thi không,
   giá bao nhiêu?
7. `buildLegacyOverThresholdRepeatTradeoff` còn ai gọi không? Nếu không, nó là code chết.
8. Có bao nhiêu đường sinh panel chạy song song, và chúng có thể **mâu thuẫn** nhau không? Nhắc lại rằng
   `match-compromises.ts` được viết chính vì thẻ "Chơi luôn" và các dòng dưới cùng từng nói ngược nhau.
9. `forced_tradeoff` 0% trong corpus — là do corpus không có hình dạng đó, hay do nó **không bao giờ** nổ
   trên prod? Phân biệt hai cái bằng dump prod, đừng suy từ corpus.

## Thước đo có sẵn

- `scratch/board-scorecard.ts` — corpus 60 kèo, đã có `panel_pct` / `panel_forced_pct` /
  `panel_choices_pct`. Baseline hiện tại `board_hash = fe413c452181`. Thêm chỉ số đọc-thuần thì hash
  **phải không đổi**; hash đổi nghĩa là bạn vừa đổi hành vi.
- `scratch/sweep-stuck-courts.ts` + `scratch/pull-sweep-dumps.mjs` — replay dump prod thật.
- Kênh SQL chỉ-đọc tới prod (dùng token `~/.supabase/access-token`):
  `POST https://api.supabase.com/v1/projects/mzqsxgfvtgmsscbqugni/database/query` với `{"query": "..."}`.
  `pg_stat_statements` đang bật.
- `debug_dumps.payload` chứa `final_preview_board_lite`, `selection_debug_lite`, `engine_build`,
  `timing_ms`, và `engine_instrumentation_events`.

## Bẫy đo — đã mất thời gian vì chúng, đừng vấp lại

| bẫy | hậu quả |
|---|---|
| `git checkout <commit> -- <file>` **stage** luôn file; `cp` khôi phục chỉ chữa worktree | commit kế tiếp lặng lẽ lùi fix. `git diff --stat HEAD -- file` mù với index — kiểm bằng `git status --short` hoặc `git diff --cached` |
| `Bash` timeout không giết node; `TaskStop` giết shell chứ không giết worker con | nhiều suite chạy song song → mọi khẳng định-theo-đồng-hồ đỏ giả |
| Mã thoát của `jest \| grep` là của `grep` | suite đỏ mà báo xanh |
| Số không đổi sau khi vừa đổi cách đo | phép đo không chạy |
| Corpus không chứa hình dạng đang xét | "giống hệt nhau" đọc thành "vô hại", trong khi đúng ra là "không chạm tới" |
| Nhãn trạng thái trong file audit | đã sai nhiều lần theo **cả hai chiều**. Dùng làm danh sách đi kiểm, không dùng làm kết luận |

## Kết quả cần giao

Một bảng, mỗi dòng một phát hiện, gồm: **hiện tượng / cơ chế (kèm file:dòng) / bằng chứng đo được /
mức độ / đề xuất**. Kèm:

- Câu trả lời dứt khoát cho "3 hướng hay 4 hướng", có số liệu prod.
- Danh sách **đã loại trừ** — thứ trông như lỗi mà không phải, kèm lý do, để phiên sau khỏi đào lại.
- Cái gì **chưa đo được** và cần gì để đo.

Không sửa gì trong phiên này. Sau khi host duyệt bảng mới bàn tới việc sửa.
