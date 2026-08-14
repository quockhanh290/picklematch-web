# P2-2 — Một optimizer thay cho sáu post-pass

Ngày: 2026-08-13 · Nhánh: `feat-p2-2-optimizer` · Trạng thái: spec, chưa code

## 1. Vấn đề, bằng số

Sau khi greedy per-court dựng xong board, engine chạy sáu pass nối đuôi nhau
(`live-preview.ts:5725–5789`):

```
greedy → ①repairSuggestedPayloadBatch → ②participation → ③repeatPool(bench)
       → ④blowoutPool(bench) → ⑤invariantGuardRevert → ⑥applyJointRepartition
```

Đo trên 20 seed × 12 vòng / 520 batch (`docs/ENGINE_FRAGMENTATION_AUDIT.md` §7.11):

| stage | batch bị đổi | sân viết lại | lệch so với gốc (cộng dồn) |
|---|---|---|---|
| ① repair | 427/520 | 903 | 903 |
| ② participation | 0 | 0 | 903 |
| ③ repeatPool | 243/520 | 366 | 912 |
| ④ blowoutPool | 0 | 0 | 912 |
| ⑤ invariantGuard | 0 | 0 | 912 |
| ⑥ joint | 155/520 | 338 | 934 |

**1607 lượt viết lại để tạo ra 934 sân khác gốc — khoảng 42% công là các pass ghi đè lẫn nhau.**
Mỗi lần ghi đè là một lần metadata phái sinh (`forced_tradeoff`, `tradeoff_choices`,
`degraded_reason`) mô tả một lineup đã chết — gốc của §7.9, hiện đang phải vá bằng
`dropStaleDerivedMetadata`.

Nguyên nhân cấu trúc: sáu pass **không phải sáu bài toán**, mà là cùng một bài "gán N người vào K
sân" bị chẻ làm sáu, mỗi mảnh mang một ý niệm "tốt hơn" riêng và không mảnh nào biết mảnh khác.

## 2. Mục tiêu / ngoài phạm vi

**Mục tiêu**
- Một hàm duy nhất nhận board greedy, trả board cuối, với **một** thước đo và **một** bộ ràng buộc
  tường minh.
- **Tất định**: cùng input → board byte-identical. (Engine hiện không tất định theo ngân sách thời
  gian; đó là một nửa nguyên nhân bug flicker — xem memory `project-suggest-nondeterministic-search-budget`.)
- Xoá `invariantSafePayloads` (#70) — biến nó thành ràng buộc thay vì một pass.
- Không tệ hơn board greedy ở mọi trục cứng, đo được trên corpus 60 phiên.

**Ngoài phạm vi**
- Không đụng tầng **chọn người** (tier MUST_PLAY, required ids, `deferLowViability`). Greedy vẫn sinh
  board gốc; optimizer chỉ cải thiện từ đó.
- Không deploy. Prod giữ ALGO 77, cờ mặc định tắt.
- Không đổi `computeQualityCost`, không đổi trọng số.

## 3. Ràng buộc cứng (H)

Vi phạm một cái là loại ứng viên, không đánh đổi. Tất cả trích từ guard đang chạy.

| | ràng buộc | nguồn trong code |
|---|---|---|
| H1 | không có cặp tránh nhau (hai chiều) | `hasAvoidedPartnerPair` |
| H2 | mỗi sân đúng 4 người · không ai hai sân · chỉ người đủ điều kiện | bất biến chung |
| H3 | **mỗi sân**: intra-team ≤ max(`INTRA_TEAM_PVNA_GAP_LIMIT`, intra của **chính sân đó** ở board gốc) | `repairPayloadBatch*` |
| H4 | cặp (số sân vượt tolerance, tổng mức vượt) không tăng so với board gốc — không vế nào được tăng | `candidateStats.pvnaOver > currentStats.pvnaOver` |
| H5 | không tạo lần gặp thứ 3 mà board gốc chưa có | `candidateMeeting >= 3 && currentMeeting < 3` |
| H6 | đổi ghế chỉ khi người vào nợ ít nhất bằng người ra (nghỉ trước, rồi số trận) | `mayReplace` |
| H7 | rolling-plan target bật → tập người chơi không đổi | thay `invariantGuardRevert` |
| H8 | không bỏ lại một người lệch trình đơn độc trên băng ghế | `hasNearLevelPeer` |

**"Không tệ hơn" luôn so với board gốc greedy**, không phải chuẩn tuyệt đối.

H8 giữ ở mức ràng buộc cứng (không nhét vào thước đo) vì nó chặn đúng triệu chứng host đã báo: một
người yếu bị kẹt lại trên ghế, board vẫn lệch.

## 4. Thước đo — đo cả hai, chọn sau

- **O-lex** (từ điển, sáu bậc, mỗi bậc là một số đếm/tổng cụ thể — so bậc 1 trước, hoà mới xét bậc 2):
  1. số sân ở lần gặp thứ 3 (lặp-3)
  2. số sân vượt tolerance
  3. tổng mức vượt tolerance (độ nặng, không chỉ số lượng)
  4. số người bị bỏ lại băng ghế dù đã quá ngưỡng nghỉ (nợ nghỉ)
  5. tổng phần intra vượt trần
  6. `computeQualityCost`

  Khớp chỉ thị host đã chốt (lặp-3 thắng gender-pref; blowout là phương án cuối). Không cần hiệu chỉnh
  trọng số.
- **O-cost**: `computeQualityCost` sẵn có, một số duy nhất. Đã hiệu chỉnh, nhưng chính nó từng đẻ bug
  gender-gap (phạt bình phương làm băng-qua-tolerance gần miễn phí).

Không chọn bằng lập luận. Chạy corpus với cả hai rồi so bảng.

## 5. Nước đi và cách tìm

**Bốn nguyên tử**

| | nước đi | đổi ai chơi? |
|---|---|---|
| W1 | đổi 2 người trong cùng một sân (chia lại đội) | không |
| W2 | đổi 2 người giữa hai sân | không |
| W3 | đổi một người đang ngồi lấy một người ở băng ghế | có |
| W4 | xoay vòng 3 người giữa 3 sân | không |

W4 tồn tại vì audit ghi rõ *"local 2-opt không với tới re-partition 3+ người"* — chính là luận điểm
gốc của P2-2.

**Ba cấu hình đem đo:** (a) `{W1,W2,W4}` · (b) `{W1,W2,W3,W4}` · (c-cận trên) = (b) bỏ trần vòng lặp.
(c) là **cận trên rẻ tiền** của phương án "chọn lại toàn bộ 4 người mỗi sân": nếu nó không hơn (b) bao
nhiêu thì phương án đó chết bằng số, khỏi phải làm.

**Steepest descent tất định**

1. Điểm xuất phát = board greedy, không đụng vào.
2. Lặp: sinh **toàn bộ** nước đi theo thứ tự cố định (sân tăng dần → ghế → id người); loại ứng viên vi
   phạm H1–H8; chấm điểm phần còn lại; chọn nước tốt nhất; hoà thì lấy nước ra trước.
3. Dừng khi không còn nước cải thiện quá ngưỡng ε, hoặc chạm trần vòng lặp. **ε = 0.01** trên bậc
   cuối (`cost`) — giữ đúng ngưỡng chống-lắc mà hai pass kéo băng ghế đang dùng
   (`candidateScore >= bestScore - 0.01`); các bậc đếm ở trên là số nguyên nên không cần ε.
4. Không cải thiện được gì → trả **đúng board gốc**, byte-identical (metadata không bị khuấy vô ích).

**Ngân sách:** 6 sân = 24 ghế, băng ghế ~20 → ~800 ứng viên/vòng; trần 30 vòng ⇒ tệ nhất ~24k lượt
chấm, dư sức so với `engine_search` đo được 131–785ms. Trần tính bằng **số vòng lặp**, tuyệt đối không
đọc `Date.now()` / `performance.now()` trong optimizer.

## 6. Tích hợp

- Module thuần mới `lib/next-round-suggester/board-optimizer.ts` — không React, không I/O, test độc
  lập. `live-preview.ts` đang ~5.800 dòng, không nhét thêm.
- Thay đúng đoạn `:5725–5789`. Bước chuẩn hoá metadata phía sau (`normalizeRepairedPayload`,
  `dropStaleDerivedMetadata`, `rebuildDerivedMetadataForSeatedLineup`) **giữ nguyên** — và tự tốt lên,
  vì từ nay có đúng MỘT lineup cuối thay vì một chuỗi.
- `degraded_reason` sinh lúc dựng payload (`:5592`) và được tính lại ở bước chuẩn hoá (`:3086`).
  Optimizer nằm gọn giữa hai mốc đó: đọc nhãn của board gốc, bước cuối tự tính lại từ lineup đã chốt.
- Cờ `SESSION_BOARD_OPTIMIZER` + allowlist theo session (khuôn `quality-cost-flag.ts`). Mặc định TẮT.

**Thay đổi hành vi phải nói trước:** pass blowout hiện chỉ động vào sân có nhãn `degraded='blowout'`
hoặc `'both'`. Optimizer không có cổng đó — mọi sân xét bằng cùng một thước. Đúng hướng (chính cổng
này đẻ ra bug ALGO 74 bỏ sót `'both'`) nhưng **mở rộng phạm vi tác động**, nên phải đo riêng: bao
nhiêu board bị đổi mà sáu pass cũ chưa từng đụng tới.

## 7. Kiểm chứng

| tầng | kiểm gì | bắt được gì |
|---|---|---|
| property (fuzz, seeded) | H1–H8 không bao giờ vi phạm | ràng buộc cứng bị rò |
| tất định | 2 lần chạy + đảo thứ tự chèn Map/Set → byte-identical | phụ thuộc thứ tự lặp, sót đồng hồ |
| không-tệ-hơn | mọi board: điểm cứng kết quả ≤ điểm cứng board gốc | optimizer đổi chác sai |
| corpus A/B | `scratch/board-scorecard.ts` 60 phiên | hồi quy chất lượng thật |

**Baseline đã chốt** (chạy trên nhánh này, 60 phiên / 3088 board):

```
board_hash f1b6d8ac0b0c · HARD avoid_partner 0
repeat3 1.98% · over_tol 11.43% · blowout 1.39% · intra_over_cap 19.56% · avg_cost 2.5742 · panel 5.67%
play_spread 1.367 · worst_rest 1.55 · seated_at_or_past_rest 32.43%
```

**Bảo chứng lùi được:** với cờ TẮT, corpus phải ra **đúng** `f1b6d8ac0b0c`. Máy kiểm được, mạnh hơn
lời hứa "không đụng đường cũ".

**Chống ba cái bẫy đã trả giá** (TASK.md):
- Harness phải bật `blowoutRescue: true` — từng đo một tính năng đang tắt rồi kết luận về nó.
- Counter tách `entered` / `changed` / từng lý do từ chối — từng gộp rồi tưởng pass mạnh nhất hệ thống.
- Trước khi tin số: khẳng định optimizer **có chạy** (số lần gọi > 0). Số không đổi sau khi vừa đổi
  cách đo = nghi phép đo hỏng, không phải nghi thay đổi vô dụng.

⚠️ Trong worktree này (nằm dưới `.claude/`), `npm test` **không khớp file nào** vì glob của jest bỏ qua
thư mục bắt đầu bằng dấu chấm. Lệnh gate đúng:
`npx jest --testMatch "**/tests/**/*.test.ts" --testMatch "**/tests/**/*.test.tsx" --forceExit`

## 8. Ma trận báo cáo

Baseline + 6 lượt (3 tập nước đi × 2 thước đo), theo các cột của scorecard, cộng hai cột mới: *số board
bị đổi* và *số board đổi mà sáu pass cũ chưa từng đụng*.

## 9. Điều kiện "xong"

HARD = 0 vi phạm · lặp-3 và over-tol không tệ hơn baseline · test tất định xanh · gate 704 xanh ·
`tsc` 0 · eslint 0 error · cờ tắt cho ra đúng hash baseline. **Không deploy.**

## 10. Rủi ro đã biết

- **Local optimum.** Steepest descent không bảo đảm tối ưu toàn cục. Chấp nhận: thước đo là "không tệ
  hơn baseline và tốt hơn ở các trục ưu tiên", không phải "tối ưu".
- **Mở rộng phạm vi tác động** khi bỏ cổng `degraded_reason` (mục 6) — đo riêng.
- **Corpus không phải production**: luôn bắt đầu từ bàn trắng, không có check-out giữa phiên. Kết luận
  từ corpus phải được xác nhận lại bằng `debug_dumps` kèo thật trước khi bật cờ cho kèo nào.


---

## 11. KẾT QUẢ (2026-08-13) — cấu hình đã chốt: W1–W3 + O-lex

Bảng corpus 60 phiên / 3088 board. HARD `avoid_partner` = **0** ở mọi cấu hình.

| cấu hình | lặp-3 | vượt tol | blowout | intra vượt | avg cost | worst-rest | ms/board (6 sân) |
|---|---|---|---|---|---|---|---|
| baseline (6 pass cũ) | 1.98 | 11.43 | 1.39 | 19.56 | 2.574 | 1.550 | — |
| split (W1,W2,W4) · lex | 11.46 | 12.05 | 2.40 | 19.46 | 2.691 | 1.733 | 753 |
| split · cost | 12.01 | 12.14 | 2.40 | 19.24 | 2.682 | 1.733 | — |
| bench (W1–W4) · lex | 2.01 | 3.37 | 0.97 | 16.68 | 1.769 | 1.167 | 1620 |
| bench · cost | 2.04 | 7.09 | 0.87 | 20.53 | 1.647 | 1.183 | — |
| bench_unbounded · lex/cost | **hash y hệt bench** | | | | | | — |
| **W1–W3 · lex (CHỐT)** | 2.07 | 3.47 | **0.74** | **15.74** | **1.710** | 1.167 | **331** |

**Bốn kết luận, tất cả bằng số:**

1. **Phương án "chọn lại toàn bộ 4 người mỗi sân" chết.** `bench_unbounded` cho ra **đúng cùng hash**
   với `bench` — bỏ trần vòng lặp không đổi một board nào, tức leo dốc đã cạn nước đi trước khi chạm
   trần 30. Không cần làm phương án đó.
2. **Bỏ nước đi đổi-với-băng-ghế là thảm hoạ**: lặp-3 1.98% → 11.46%. Ràng buộc H5 chỉ bảo vệ TỪNG
   board; corpus là replay cả phiên nên đổi board vòng 3 làm lịch sử vòng 7 khác đi. Hiệu ứng này chỉ
   corpus mới thấy, test đơn vị không bao giờ thấy.
3. **W4 (xoay vòng 3 sân) không đáng giá**: ngốn 77% khối lượng (2560/3304 ứng viên mỗi vòng) để mua
   0.1pp vượt-tolerance, trong khi THUA ở blowout, intra và cost. Luận điểm "local 2-opt không với tới
   re-partition 3+ người" trong audit đúng về lý thuyết nhưng không mua được gì đo được ở đây.
4. **Thời gian là ràng buộc thật, không phải chi tiết.** Prod `engine_search` 131–785 ms. Bản đầu tiên
   của tôi mất 2542 ms/board. Đường tới 331 ms: dùng lại số đo sân không bị đụng (−19%, giả thuyết của
   tôi SAI), rồi ĐO xem giờ đi đâu (`computeQualityCost` = 70%, trả cho 79% ứng viên sắp bị vứt) → tính
   cost lười, rồi bỏ W4.

**Điều kiện "xong" (mục 9) đối chiếu:** HARD 0 ✓ · vượt-tol 11.43 → 3.47 ✓ · tất định ✓ (150 test,
gồm 120 board ngẫu nhiên × 3 cấu hình) · cờ tắt cho ra đúng `f1b6d8ac0b0c` ✓ · `tsc` 0 ✓ ·
**lặp-3 1.98 → 2.07 (+3 board/3088) ✗** — trượt tiêu chí "không tệ hơn" đúng 3 board. Chưa nới tiêu
chí, để host quyết.

**Gate:** hai test trong `simulation/full-session.test.ts` (chuỗi nghỉ, gender preference) đỏ — **đã
A/B: đỏ y hệt tại commit gốc `2b756d2` trước toàn bộ P2-2**, nên là lỗi có sẵn trên nhánh, không phải
hồi quy của optimizer. Nhóm `Production Chain Timing` / `Phase A` là assertion đồng hồ thật, đỏ khi máy
tải nặng — cùng loại TASK.md đã từng xoá 4 cái vì không bắt được thứ chúng trông như đang canh.

**Chưa làm, có lý do:** `invariantSafePayloads` (#70) chưa xoá vật lý vì nhánh cờ-tắt còn cần; cột
"board đổi mà 6 pass cũ chưa từng đụng" chưa đo (cần chạy song song hai nhánh trên cùng seed).


## 12. Replay kèo THẬT (2026-08-14) — 53 kèo / 2158 board

Corpus ở §11 là dữ liệu tổng hợp, luôn bắt đầu từ bàn trắng (§10 đã ghi là giới hạn). Phép đo này
dựng lại state THẬT của kèo đã kết thúc từ DB (`buildCompletedLiveCycleRows` + `rebuildStateThroughRound`,
cùng đường `npm run diagnose` dùng), rồi bắn qua engine hai lần trên cùng input.

Không replay từ `debug_dumps` vì chúng ở mức `lite`, không mang khối state đầy đủ — `partner_counts`
phải suy ra từ bản rút gọn, và một con số lặp-3 sai mà trông hợp lệ đúng là lỗi dự án này dính nhiều lần.

| | cờ TẮT | cờ BẬT |
|---|---|---|
| board đo | 2158 | 2158 |
| vượt tolerance | 14 (0.65%) | **0 (0.00%)** |
| tổng mức vượt | 4.14 | **0.00** |
| lặp-3 | 86 (3.99%) | **6 (0.28%)** |
| intra vượt trần | 175.53 | **62.02** |
| thời gian | 340.7s | 342.0s (+0.4%) |

**0/53 kèo xấu đi** ở vượt-tolerance hoặc lặp-3. Mẫu 28 kèo cho cùng xu hướng, nên không phải may mắn
của một nhóm kèo.

**Điều này đính chính con số "+3 board lặp-3" ở §11.** Hai phép đo trả lời hai câu khác nhau: corpus
replay cả phiên nên board vòng 3 đổi làm lịch sử vòng 7 đổi (hiệu ứng cộng dồn); replay kèo thật dựng
lại state từ lịch sử THẬT mỗi vòng nên đo đúng "cho state này, board có tốt hơn không". Trên mọi state
thật gặp phải, optimizer **luôn** ghép ít lặp-3 hơn. "+3" là hệ quả của phiên đi theo đường khác, không
phải ghép tệ hơn.

**Đính chính thứ hai — nỗi lo latency là kịch bản nhân tạo.** 331 ms/board đo trên 6 sân với băng ghế
20 người. Kèo thật băng ghế nhỏ hơn nhiều (33 người / 6 sân = 9 chờ) và W3 sinh ứng viên tỉ lệ thuận
với băng ghế: chênh lệch thật là **+1.3 giây trên 340 giây**. ⚠️ Nhưng kèo 40+ người sẽ về gần kịch bản
20-chờ — chưa có kèo nào cỡ đó trong 53 kèo này để kiểm.

### CHƯA chứng minh (đừng đọc bảng trên thành "đã an toàn tuyệt đối")

1. **Đường rolling chưa hề được đo.** Mọi phép đo tới giờ đều lấp CẢ BÀN một lượt. Kèo thật lấp từng
   sân khi có sân xong — đó là nơi `repeatPool` sống và cũng là nơi bug flicker xảy ra.
2. **Chưa chạy thật lần nào** trên edge (Deno runtime, request thật).
3. **Panel giảm** (corpus: 5.67% → 4.21%) — host sẽ thấy ít lời mời "chờ sân / chơi luôn" hơn. Đúng
   hướng (ít board xấu hơn thì ít phải hỏi hơn) nhưng là thay đổi host nhìn thấy.
