# Bản đồ route panel quyết định — rà soát lần 2 (2026-08-16)

Lần rà đầu khoanh sai phạm vi: nó audit **một** trong sáu kênh dữ liệu rồi gọi đó là "panel".
Bản này đi theo đúng khung của host: panel là **một khối UI duy nhất được lắp từ nhiều nguồn độc lập**,
và chính chỗ lắp ghép đó là phân mảnh.

Nền đo: `HEAD d616f54`, tag `baseline-algo-81`. Prod chạy ALGO 79 / edge deployment 278 ở kèo gần nhất.

---

## 1. Tầng trên cùng: client lắp panel theo HAI chế độ loại trừ nhau

`ScreenComponents.tsx:1933-1976` dựng đúng một mảng `decisionCards`:

```
if (forcedDecision)          -> toàn bộ thẻ lấy từ forced-decision.ts     (chế độ A)
else if (showDecisionPanel)  -> "Chơi luôn" + N x "Đổi sang" + "Chờ sân khác"  (chế độ B)
```

`showDecisionPanel = !đang-xem-pool-rảnh && (swapChoices.length > 0 || isDegradedRescue)` (`:1901`)

**Chế độ A — forced**, `forced-decision.ts:102-236`, ba biến thể theo `forced_tradeoff.kind`:

| kind | thẻ | ghi chú |
|---|---|---|
| `fatigue` | [Chờ Sân X] + "Cho đánh tiếp" | 1 hoặc 2 thẻ; thẻ chờ đứng TRƯỚC |
| `blowout` | "Chịu lệch" + "Cho nghỉ tiếp" + [Chờ Sân X] | 2 hoặc 3 thẻ |
| mặc định (repeat) | "Chịu lặp" + "Chịu lệch" + [Chờ Sân X] | 2 hoặc 3 thẻ |

**Đây chính là "panel 3 lựa chọn" host nhớ:** chờ sân / chơi luôn / hy sinh một ràng buộc.

**Chế độ B — thường:**

| thẻ | điều kiện | nguồn |
|---|---|---|
| "Chơi luôn" | luôn có khi panel hiện | đội hình đã xếp |
| "Đổi sang: …" × N | `swapChoices` = `tradeoff_choices` bỏ cái được đề cử | `tradeoff_choices` |
| "Chờ sân khác xong" | `rescue_court_idxs` không rỗng | `degraded_reason` + `rescue_court_idxs` |

---

## 2. Tầng dữ liệu: SÁU kênh, BA số phận khác nhau qua cùng một cú ghi

Đây là gốc của mọi chuyện. Cú ghi xuống DB chỉ nhận 11 cột; edge sau đó **thay bảng đấu bằng chính các
dòng đọc lại** (`session-live-matches-suggest/index.ts:1457`). Kênh nào có cột thì sống, không có thì chết.

| kênh | ai dựng | có cột thật? | trạng thái | bằng chứng prod |
|---|---|---|---|---|
| `degraded_reason` | engine, **edge tính lại toàn bàn** `:1492-1514` | **có** | **SỐNG** | 59 / 622 dòng trong 12 ngày |
| `rescue_court_idxs` | như trên | **có** | **SỐNG** | 52 / 622 |
| `match_explanations` | edge tính lại `:1520-1529` | **có** | **SỐNG** | 61 / 622 |
| `tradeoff_choices` + `recommended_tradeoff_choice` | 4 builder trong engine | không | **CHẾT 25/07** | 0/58 trận sau khi ghi; trong DB 52 dòng, dừng đúng 24/07 |
| `forced_tradeoff` + `wait_rescue_options` | 3 nhánh engine | không | **CHẾT** | 0 dòng trong toàn bộ 6214 dòng lịch sử |
| `warnings`, `tradeoffs`, `approval_required`, `fairness_reasons`, `live_availability_context`, `configured/effective_pvna_tolerance` | engine | không | **CHẾT 25/07** | `live_availability_context` có 396 dòng, dừng 24/07 |

**Vì sao không ai nhận ra:** panel không vỡ hẳn, nó **vỡ từng mảnh**. Ba kênh sống giữ cho thẻ "Chơi
luôn" và "Chờ sân khác" vẫn hiện, nên panel trông vẫn hoạt động — chỉ thiếu thẻ giữa. Và thẻ giữa vốn
chỉ xuất hiện ~6% số lần, nên vắng nó trông y hệt "vòng này không có gì để mời".

### Thiệt hại phụ chưa từng được báo

Ngoài các thẻ, cú ghi còn nuốt mất một lớp giải thích:

- `live_availability_context` chết ⇒ khối `capacityInfoLines` (`:1983-1992`) **không bao giờ render**:
  mất dòng "Tốt nhất từ X/Y người đang rảnh", mất các dòng đánh đổi, mất dòng "Tự cập nhật khi sân … xong".
- `warnings` chết ⇒ dãy chip cảnh báo (`:1993-2004`) **luôn rỗng**.
- `tradeoffs` chết ⇒ `repeatTradeoff`/`pvnaTradeoff` (`:1724-1725`) luôn undefined, nên dòng giá của thẻ
  "Chơi luôn" mất phần lặp (`repeatOverBy` luôn 0).

Ba thứ này client **không tự tính lại**, khác với `pvnaDiff` và `matchVerdict` vốn tính tại chỗ.

---

## 3. Tầng builder: bốn đường sinh `tradeoff_choices`, loại trừ nhau

`live-preview.ts:3784-3792`, hình dạng `(A ? B : C) ?? D`:

| # | hàm | điều kiện | ra mấy nhánh |
|---|---|---|---|
| B | `buildConditionalLiveQualityTradeoffChoices` `:1643` | có tradeoff điều kiện VÀ baseline trùng đội hình chốt | — |
| C | `buildLiveTradeoffChoices` `:3512` | mặc định | dựng 4 trục rồi **gộp trùng** còn 2–3 |
| D | `buildOverThresholdRepeatTradeoff` `:3695` | khi B/C trả rỗng | rẽ theo cờ ↓ |
| D1 | `buildBalanceFreshnessTradeoff` `:3643` | cờ quality-cost **BẬT** | đúng 2 |
| D2 | `buildLegacyOverThresholdRepeatTradeoff` `:3707` | cờ **TẮT** — **đường prod** | đúng 2 |

Vì sao chưa bao giờ ra 4 nhánh: C chọn ứng viên tốt nhất theo 4 trục ưu tiên, nhưng 4 trục **thường cùng
thắng một đội hình**, nên bước gộp trùng `:3565-3569` xoá bớt; phần còn lại bị lọc "phải tốt hơn cái được
đề cử" `:3595-3604`; dưới 2 thì trả rỗng.

Đo trên 157 panel prod: 2 lựa chọn **75,2%** · 3 lựa chọn **24,8%** · 4 lựa chọn **0**.

---

## 4. Tầng builder: ba nhánh sinh `forced_tradeoff`

`live-preview.ts:5489-5654`:

| # | nhánh | cổng | trạng thái prod |
|---|---|---|---|
| 1 | repeat (`:5531`) | **trong** `if (isQualityCostModelEnabled)` `:5492` | cờ TẮT từ ~08-13 |
| 2 | blowout (`:5598`) | **trong** cùng cờ đó | cờ TẮT từ ~08-13 |
| 3 | fatigue (`:5627`) | **KHÔNG bị cờ chặn**; cần `LIVE_RECYCLE_ABSOLUTE_RELAXED` | chưa quan sát được lần nào |

**Đo được từ `selection_debug_lite.forced_debug`:**

| ngày | ALGO | bản ghi | nhánh quality-cost chạy | dựng được panel |
|---|---|---|---|---|
| 06–08/08 | 52–55 | 135 | **116** | **7** |
| 13–16/08 | 77–79 | 450 | **0** | 0 |

Cờ quality-cost bật đầu tháng 8, **bị tắt trong khoảng 08–13/08**, và tắt tới giờ (allowlist rỗng).
7 panel dựng được ngày 08/08 đều bị cú ghi nuốt mất — host không thấy lần nào.

---

## 5. Phân mảnh thật nằm ở đâu — sáu điểm

| # | phân mảnh | bằng chứng | hậu quả |
|---|---|---|---|
| **F1** | **Cùng một quyết định "chờ sân" có hai đường độc lập**: `wait_rescue_options` (chế độ A) và `rescue_court_idxs` (chế độ B) | client phải tự dập một cái bằng `!forced` ở `:1781`, kèm comment thừa nhận "cả hai trường có thể cùng xuất hiện" | hai nguồn có thể chỉ vào **hai sân khác nhau** cho cùng một quyết định; không có gì đối soát |
| **F2** | **Cùng một quyết định "hy sinh ràng buộc" có hai đường**: `forced_tradeoff.acceptImbalance` và `tradeoff_choices` | loại trừ bằng `if/else` ở `:1934-1950` | cùng một ý niệm, hai bộ chữ, hai cách tính giá |
| **F3** | **Ba lớp đặt nhãn chồng nhau cho cùng một thẻ** | engine `getTradeoffChoiceLabel :3321` → client `describeChoice :1841` → client `swapResultCost :1916` | nhãn engine **chưa bao giờ hiện** (0/353); hai lớp client cùng mô tả một thẻ, một cái ra tiêu đề, một cái ra dòng kết quả |
| **F4** | **Sáu kênh dữ liệu, ba số phận khác nhau qua cùng một cú ghi** | bảng mục 2 | panel vỡ từng mảnh, không ai nhận ra; đây là gốc của toàn bộ sự việc |
| **F5** | **`forced_tradeoff` có 3 `kind` dùng chung 2 khoá thẻ** (`accept_repeat`/`accept_imbalance`) với ý nghĩa khác nhau | `forced-decision.ts:160-222` — comment nói rõ "same slot mapping, only the copy differs" | `accept_repeat` lúc nghĩa là "chịu lặp", lúc là "chịu lệch", lúc là "cho đánh tiếp" |
| **F6** | **Bản sao chết của logic panel trong client** | `preview.ts:190-380`, 3 trục, nhãn cũ, 0 nơi gọi | **đã xoá trong phiên này**; nhiều khả năng là nguồn của ký ức "3 hướng" |

---

## 6. Kế hoạch defrag — thứ tự, cổng kiểm, ràng buộc

**Ràng buộc xuyên suốt: không đụng `lib/next-round-suggester/` cho tới bước 4.**

### Bước 1 — trả kênh dữ liệu về một đường (ĐÃ CHUẨN BỊ, chờ áp)

Migration `20260816000001` đưa 4 khoá panel vào cột `suggestion_metadata`. Sửa **F4** cho các thẻ.
- Cổng: `npm run check:rpc-markers` đỏ → xanh; kèo thật có 4–6% dòng gợi ý mang panel.
- Đã đo trước: 157/157 panel thật ra byte-identical, hash vào = hash ra.

### Bước 2 — quyết định phạm vi cứu: chỉ thẻ, hay cả lớp giải thích?

Ba kênh `warnings` / `tradeoffs` / `live_availability_context` cũng chết cùng ngày và **chưa ai biết**.
Cứu chúng làm sống lại các dòng "Tốt nhất từ X/Y người rảnh", chip cảnh báo, và phần lặp trong dòng giá.
- Rủi ro: `live_availability_context` đi kèm các trường đánh dấu phiên bản preview; lưu bản cũ có thể
  làm sống lại chuyện nhấp nháy. **Cần đo trước khi làm**, không gộp vào bước 1.
- Cổng: so số lần request bị huỷ vì "stale" trước/sau, trên kèo thật.

### Bước 3 — hợp nhất hai đường "chờ sân" (F1)

Chọn một nguồn duy nhất cho quyết định chờ. Đề xuất: giữ `rescue_court_idxs` (có cột thật, đã sống,
edge tính lại toàn bàn nên luôn khớp đội hình hiện tại), và cho nhánh forced **đọc lại từ đó** thay vì
mang danh sách riêng.
- Cổng: một test ghim rằng hai nguồn không bao giờ chỉ vào hai sân khác nhau; hiện **không có** test nào.

### Bước 4 — hợp nhất hai đường "hy sinh ràng buộc" (F2)

`forced_tradeoff` và `tradeoff_choices` đang là hai cách nói cùng một chuyện. Đây là bước **chạm engine**,
nên chỉ làm sau khi bước 1 cho số liệu thật về việc host dùng thẻ nào.
- Cổng: `board_hash` không đổi (đây là dẫn xuất chỉ-đọc, đã kiểm: engine không nơi nào đọc
  `tradeoff_choices` để quyết định xếp ai vào sân).

### Bước 5 — gộp ba lớp đặt nhãn còn một (F3)

Xoá `getTradeoffChoiceLabel` (nhãn nó sinh ra chưa bao giờ hiện — 0/353), gộp `describeChoice` và
`swapResultCost` thành một hàm thuần trả `{tiêu đề, được gì, mất gì}`, đúng khuôn `match-compromises.ts`
đã làm cho dòng giá.
- Cổng: test đối chiếu tiêu đề + dòng kết quả sinh từ cùng một nguồn.

### Bước 6 — đặt tên lại các khoá thẻ theo ý nghĩa (F5)

`accept_repeat`/`accept_imbalance` mang ba nghĩa khác nhau theo `kind`. Tách thành khoá theo nghĩa.
- Cổng: test đảm bảo mỗi `kind` sinh đúng bộ khoá của nó.

### Việc kèm theo, không thuộc defrag nhưng chặn mọi đánh giá

**Không có gì ghi lại việc host bấm chọn thẻ nào.** Không có sự kiện nào trong
`suggester_decision_events`. Không thêm cái này thì sau bước 1 vẫn không ai trả lời được "panel có đáng
giữ không" — chính là câu hỏi đã kéo dài suốt.

---

## 7. Ba khẳng định của lần rà đầu bị bác bỏ ở lần này

| lần 1 tôi viết | lần 2 đo ra | vì sao sai |
|---|---|---|
| "`forced_tradeoff` cấu trúc không thể nổ trên prod" | Nổ **7 lần ngày 08/08**; cờ bật đầu tháng 8 rồi bị tắt | Đọc cờ ở trạng thái hôm nay rồi phát biểu như sự thật lịch sử |
| "3 hướng hay 4 hướng" trả lời bằng `tradeoff_choices` | Câu hỏi của host là về bộ ba **forced** | Trả lời đúng số nhưng sai câu hỏi |
| "Panel = `tradeoff_choices`" | Panel là **một khối lắp từ 6 kênh**, `tradeoff_choices` chỉ là một | Khoanh phạm vi theo tên khoá thay vì theo thứ host nhìn thấy |
