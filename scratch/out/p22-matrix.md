# P2-2 — Ma trận đo optimizer: 3 tập nước đi × 2 thước đo (Task 7)

> **HARD (`avoid_partner`) khác 0 ở BẤT KỲ cấu hình nào là HỒI QUY, không phải đánh đổi.**
> Nó là ràng buộc duy nhất engine không mặc cả (`Infinity` trong `scoreMatch`, không có tầng nới nào
> gỡ). Một vi phạm là đủ để loại cấu hình đó, bất kể mọi cột còn lại đẹp thế nào.

Corpus: 60 phiên, 3088 board, 8 vòng/sân, replay qua đúng đường live (`buildSuggestedMatchPayloads`).
Mọi lượt: `fill_rate = 100%`, `seated = requested = 3088` — không cấu hình nào làm hụt ghế.

Cách chạy (tuần tự, không song song):

```bash
OPT=1 OPT_MOVES=<split|bench|bench_unbounded> OPT_OBJ=<lex|cost> \
  npx tsx scratch/board-scorecard.ts 60 scratch/out/p22-<...>.json
```

Cờ bật qua `__setBoardOptimizerOverrideForTests(true)`; `moveSet`/`objective`/`maxIterations` đi qua
`__setBoardOptimizerTuningForTests` (hook mới trong `board-optimizer/index.ts`). Không đụng biến môi
trường thật, không đụng allowlist. `bench_unbounded` = tập `MOVE_SET_WITH_BENCH` với trần vòng lặp
10000 thay vì 30.

**Bảo chứng phép đo có chạy:** `optimizer_invoked > 0` ở cả 6 lượt (2762 mỗi lượt — bằng số request
mà board có đủ `court_idx`; 3088 board đến từ 2762 request vì request đầu phiên lấp nhiều sân).
**Bảo chứng nhánh tắt còn nguyên:** `OPT=0` 60 phiên → `board_hash = f1b6d8ac0b0c`, đúng baseline
(`scratch/out/p22-optoff-recheck.json`).

## Bảng

| cấu hình | board_hash | repeat3_pct | over_tol_pct | blowout_pct | intra_over_cap_pct | avg_cost | panel_pct | avg_play_spread | avg_worst_rest | seated_at_or_past_rest_pct | HARD avoid_partner | optimizer_invoked | optimizer_changed |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline (6 pass cũ, cờ TẮT) | `f1b6d8ac0b0c` | **1.98** (61) | **11.43** (353) | 1.39 (43) | 19.56 | 2.5742 | 5.67 | 1.367 | 1.550 | 32.43 | **0** | — | — |
| split · lex | `8f501a9fdbe9` | 11.46 (354) | 12.05 (372) | 2.40 (74) | 19.46 | 2.6907 | 6.99 | 1.400 | 1.733 | 31.94 | **0** | 2762 | 336 |
| split · cost | `29ce1fb26d94` | 12.01 (371) | 12.14 (375) | 2.40 (74) | 19.24 | 2.6820 | 7.74 | 1.433 | 1.733 | 31.91 | **0** | 2762 | 269 |
| bench · lex | `c77ddcadd431` | 2.01 (62) | 3.37 (104) | 0.97 (30) | 16.68 | 1.7690 | 3.56 | 1.217 | 1.167 | 34.28 | **0** | 2762 | 2162 |
| bench · cost | `4fe7d310240f` | 2.04 (63) | 7.09 (219) | 0.87 (27) | 20.53 | 1.6474 | 4.92 | 1.250 | 1.183 | 34.42 | **0** | 2762 | 2145 |
| bench_unbounded · lex | `c77ddcadd431` | 2.01 (62) | 3.37 (104) | 0.97 (30) | 16.68 | 1.7690 | 3.56 | 1.217 | 1.167 | 34.28 | **0** | 2762 | 2162 |
| bench_unbounded · cost | `4fe7d310240f` | 2.04 (63) | 7.09 (219) | 0.87 (27) | 20.53 | 1.6474 | 4.92 | 1.250 | 1.183 | 34.42 | **0** | 2762 | 2145 |

Số trong ngoặc = số board tuyệt đối, để đọc chênh lệch nhỏ mà phần trăm che mất (1 board ≈ 0.032 pp).

## Ba lý do từ chối nhiều nhất, theo cấu hình

| cấu hình | #1 | #2 | #3 |
|---|---|---|---|
| split · lex | `intra_cap` 1 156 722 | `over_tol_increase` 350 402 | `new_repeat3` 410 |
| split · cost | `intra_cap` 1 156 716 | `over_tol_increase` 350 290 | `new_repeat3` 394 |
| bench · lex | `intra_cap` 1 905 602 | `over_tol_increase` 638 749 | `seat_integrity` 51 960 |
| bench · cost | `intra_cap` 1 906 770 | `over_tol_increase` 633 435 | `seat_integrity` 50 442 |
| bench_unbounded · lex | `intra_cap` 1 905 602 | `over_tol_increase` 638 749 | `seat_integrity` 51 960 |
| bench_unbounded · cost | `intra_cap` 1 906 770 | `over_tol_increase` 633 435 | `seat_integrity` 50 442 |

Đuôi còn lại của hai cấu hình `bench`: `owed_rank` 16 921 / 16 232 · `stranded_outlier` 6 618 / 6 398
· `new_repeat3` 4 486 / 4 169. Hai cấu hình `split` chỉ có ba lý do (W3 tắt nên `seat_integrity`,
`owed_rank`, `stranded_outlier` không bao giờ kích được — không nước đi nào đổi tập người chơi).

## Quan sát thô (không phải quyết định — chốt cấu hình là Task 8)

- **HARD = 0 ở cả 6 cấu hình.** Không cấu hình nào hồi quy trên trục không mặc cả.
- **`bench_unbounded` giống `bench` từng byte** (cùng `board_hash`, cùng mọi con số, cùng mọi counter).
  Trần 30 vòng chưa bao giờ bị chạm trên corpus này, nên cận trên "chọn lại toàn bộ 4 người mỗi sân"
  **không mua thêm được gì** — theo spec §10 đó là điều kiện để phương án đó chết bằng số.
- **`split` (tắt W3) làm repeat3 nổ 1.98% → 11.46/12.01%** (61 → 354/371 board). Tắt băng ghế nghĩa là
  optimizer thay sáu pass cũ *nhưng không có cách nào kéo người mới vào* để phá lặp-3, trong khi hai
  pass bench cũ (`repeatPool`, `blowoutPool`) đã bị nó thay mất. Không phải optimizer kém — là tập
  nước đi thiếu đúng nước duy nhất sửa được lặp-3.
- **`bench · lex` và `bench · cost` cùng thua baseline ở repeat3 đúng 1–2 board** (61 → 62 / 63), tức
  +0.03 / +0.06 pp. Điều kiện "không tệ hơn" ở Task 8 đọc con số này là thắng hay thua thì tôi không
  tự chốt; ghi nguyên số để người quyết định thấy quy mô thật.
- `lex` mua over_tol (3.37% vs 7.09%) và intra_over_cap (16.68% vs 20.53%); `cost` mua avg_cost
  (1.6474 vs 1.7690). Đúng như thiết kế hai thước đo.
- Cả hai cấu hình `bench` **tốt hơn baseline rõ** ở over_tol (11.43 → 3.37/7.09), blowout
  (1.39 → 0.97/0.87), avg_cost (2.57 → 1.65/1.77), play_spread (1.367 → 1.217/1.250) và worst_rest
  (1.550 → 1.167/1.183), nhưng **trả bằng** `seated_at_or_past_rest` (32.43 → 34.28/34.42): kéo người
  từ băng ghế vào để cân sân đồng nghĩa ngồi thêm vài người đã chơi liên tiếp ≥2.
- `panel_pct` giảm ở `bench` (5.67 → 3.56/4.92) vì board cuối vi phạm ít ngưỡng hơn nên panel
  tradeoff ít có cớ hiện; ở `split` lại tăng (6.99/7.74) — cùng lý do, ngược chiều.

## Điều CHƯA đo trong lượt này

- Cột "board đổi mà sáu pass cũ chưa từng đụng" (spec §6) chưa có: đo nó cần chạy song song hai nhánh
  trên cùng một seed và so từng board, không phải một biến đếm. `optimizer_changed` chỉ trả lời "bao
  nhiêu board bị đổi", không trả lời "sáu pass cũ có đụng board đó không".
- Corpus luôn bắt đầu từ bàn trắng, không có check-out giữa phiên (spec §10). Mọi kết luận ở đây phải
  được xác nhận lại bằng `debug_dumps` kèo thật trước khi bật cờ cho bất kỳ kèo nào.
