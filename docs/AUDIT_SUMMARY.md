# TỔNG HỢP AUDIT — trạng thái tại `baseline-algo-81`

Gộp từ ba audit đã có, cộng hai lỗi tìm được sau chúng. Mốc: **ALGO 81 / edge v280 / tag
`baseline-algo-81`** (2026-08-16). Cột "kết quả hiện tại" chỉ ghi thứ **đo được**; chỗ nào chưa đo thì
nói là chưa đo.

| nguồn | phạm vi | quy mô | đã sửa | còn mở |
|---|---|---|---|---|
| `ENGINE_FRAGMENTATION_AUDIT.md` | 9 chiều phân mảnh + 43 bug đã verify | 43 bug / 41 root | 39 | 2 (+1 áp-chưa-chạy, 1 không-phải-lỗi) |
| `ENGINE_SCORING_AUDIT.md` | scoring + engine, 8 mảng song song | 71 finding / 7 root cause | 3 root đã trị tại gốc | 4 root còn nguyên |
| `OPERATION_STABILIZATION_AUDIT.md` | state machine host live lane | 9 OPS + 5 ENG finding | phần lớn | xem §4 |
| *(sau audit)* phiên 2026-08-15/16 | sân kẹt trên prod | 2 lỗi | 2 | 0 |

---

## 1. Hai lỗi tìm sau audit — sân kẹt (đã sửa, đã deploy)

Không có trong file audit nào: cả hai chỉ lộ ra khi replay dump production thật.

| lỗi | cơ chế | sửa thế nào | kết quả |
|---|---|---|---|
| **Tìm không ép, lọc thì ép** | `suggestNextMatch` lọc kết quả bằng `forced_required_player_ids` **vô điều kiện**, còn `suggestNextRound` bên trong **xoá rỗng** tập ràng buộc khi `MUST_PLAY_OVER_CAPACITY`. Engine trả lineup thiếu người, bộ lọc giết sạch → sân trống dù có nghiệm | đưa danh sách của caller vào tập ràng buộc lúc **tìm**, ở cả đường chính lẫn đường dự phòng; van xả over-capacity giữ nguyên cho tập suy-từ-tier | trên state prod: **0 → 5 phương án** |
| **Tập bắt buộc phình quá số ghế** | engine tự suy tập bắt buộc từ `consecutive_rest` rồi **cộng chồng** danh sách caller lên; không ai kiểm hợp có vừa một sân không. 4 tự suy + 1 caller ép = 5 người cho 4 ghế → cổng đòi **mỗi** bộ tứ chứa đủ cả 5 → 35/35 ứng viên bị loại | khi hợp vượt `slots`, giữ danh sách caller (thứ bị ép lại ở đầu ra, và đã được cắt vừa sân) rồi mới lấp phần còn lại bằng người engine tự suy | `skipped_required` 175 → 0; bộ tứ chênh **0.12** được ngồi |

**Đo trên 155 lượt xin sân thật của 2 kèo:** sân trả về rỗng **21 → 1 → 0**.

**Đo tác động lên phần còn lại của engine:** scorecard 60 kèo qua đường live, `board_hash`
**fe413c452181 trước = sau**, mọi chỉ số HARD/SOFT y hệt, latency lệch ±1%. Tức hai fix inert với phần
còn lại — **nhưng** cũng có nghĩa corpus không chứa hình dạng gây kẹt, nên scorecard chứng minh "không
gây hại", *không* chứng minh "fix chạy". Hai phép đo phải đi cùng nhau.

Kèm theo: mỗi sân trống giờ mang `outcome` (`no_match_filtered` / `no_match_beam`) và 7 bộ đếm engine
(`candidates`, `evaluated`, `accepted`, `skipped_seen`, `skipped_required`, `failed_partitions`,
`relaxed_partitions`) — vốn đã tính sẵn mà chưa ai đọc. Chính chúng bác bỏ giả thuyết sai về lỗi thứ
hai trong một lần chạy.

---

## 2. Fragmentation audit — 43 bug

### Nhóm theo root, không theo từng bug

| lớp lỗi | root chung | sửa thế nào | kết quả hiện tại |
|---|---|---|---|
| Sân kẹt vì persist/start bị từ chối (#4, #5, #6) | guard "đã chơi vòng này" so `round_no` **xuyên sân**, trong khi INSERT lại per-court | migration `20260811000001/2`: bỏ guard theo `v_round_no` batch, scope round theo court | hết; per-court round number không còn bị thổi |
| Board đứng vĩnh viễn (#3, #27, #28, #35) | client tự huỷ request đang bay rồi không lịch lại; latch không có đường thoát | `abortPreviewRequest` + bump nonce; chỉ tiêu thụ rescue nonce sau khi có replacement | hết; host QA xác nhận trên kèo thật |
| Metadata trận lệch lineup (#2, #8, #12, #19, #30) | `forced_tradeoff` / `tradeoff_choices` chốt **trước** post-pass, rồi post-pass đổi lineup | `dropStaleDerivedMetadata` bỏ đúng phần stale thay vì wipe cả batch; rebuild sau joint | hết wipe cả batch. **Root fix chưa làm:** vẫn không *tính lại* metadata sau post-pass, chỉ bỏ đi |
| Cửa sổ chống-lặp mù (#7, #26) | `round_no` thành per-court nên vòng đã xong mang số lớn hơn bị bỏ như "tương lai" | clamp `Math.max(1, roundNo - round.round_no)` ở cả `score.ts` và `quality-cost.ts` | đo được: cặp từ sân nhanh trước định giá 0.31 thay vì 0.73 |
| Ngân sách theo đồng hồ (#1, #22, #31, #21) | wall-clock trong hot path → cùng input, hai lần bấm ra hai bảng khác nhau | P2-5: ngân sách **đếm được** (`search-budget.ts`), trần đồng hồ chỉ còn là lưới an toàn ở tầng batch | tất định: cùng input → cùng `board_hash`. Prod `engine_search` p50 257ms / p95 653ms / max 972ms |
| Code chết vẫn bundle (#33, #34, #39, #40) | fork engine 448 dòng trong client, `cycle_no` không còn writer, patch unreachable | xoá | `rg` 0 hit cho cả bốn |

### Còn mở

| # | lỗi | vì sao chưa sửa |
|---|---|---|
| ~~14~~ | `last_played_round` per-court | **KHÔNG PHẢI BUG BỎ QUÊN — nhãn audit đã cũ.** `last_played_seq` từng được xây, deploy, đo rồi loại: xếp theo vị trí trong phiên làm `intra>1` 19,66%→22,12% và `repeat3` 11,53%→13,28%, `spread` không đổi (1,433). Số liệu nằm ngay trong comment `select.ts`. Khoảng trống còn lại: corpus luôn bắt đầu từ phiên rỗng, chưa quan sát phiên nối lại giữa chừng từ DB |
| **42** | 0 `accessibilityLabel` trên 376 touchable | UI/UX, không chặn engine |
| 15 | rest bookkeeping | **đã áp, chưa chạy**: cột `rest_seat_misses > 0` ở **0/5657** hàng — không có dữ liệu nào chứng minh nó chạy đúng |
| 23 | rolling-lane ghi đè `playerIdsByRound` | **không phải lỗi** — đã kết luận, đừng điều tra lại |

---

## 3. Scoring audit — 7 root cause, 71 finding

| root | nội dung | trạng thái |
|---|---|---|
| **RC2** generator đẻ ra pool lệch trình trước khi ghép | `classifyPlayer` mù pvna; `mustPlayAt` cố định 1 còn `mustRestAt` co giãn → pool owed phình mỗi vòng; corrector ép MUST_PLAY không kiểm khả thi | **đã trị tại gốc** — ALGO 49→50 generator band-cap, corrector bỏ relax toàn cục |
| **RC6** ngân sách + required quá chặt đẻ ra NO_VALID_MATCH giả | | **đã trị**: budget reserve; và hai lỗi ở §1 chính là phần còn lại của RC6 |
| **RC1** greedy per-court commit không thể cắt lại partition | sân cuối thừa hưởng cặn của các sân trước | **giảm nhẹ**, chưa trị gốc: `repairPayloadBatch*FromPool` kéo người từ ghế dự bị (ALGO 47/48); joint re-partition chỉ chạy khi ≥2 sân |
| **RC3** năm cổng INFINITY định giá cân bằng thấp nhất | `pvnaDiff` weight 1, trong khi recent-repeat 28/80/80, avoid-opponent 300 | **ĐÃ ĐO XONG 16/8 — dư địa bằng không, xem §3.1** |
| **RC4** ~16 repair rời rạc không hội tụ | mỗi cái bảo vệ một metric bằng thang riêng | **một phần**: P2-2 gộp thành 1 optimizer nhưng **cờ đang TẮT**, chưa canary |
| **RC5** dựng lại trạng thái rolling-lane bị trôi | 4 nơi dựng lại logical round, không nơi nào khớp nhau | **CÒN NGUYÊN**, và **magnitude chưa đo** — audit tự ghi là mechanism mạnh, độ lớn chưa chứng minh |
| **RC7** avoid/group/gender vừa là generator vừa là cổng cứng | | **CÒN NGUYÊN** — audit tự ghi là blind spot |

### 3.1 RC3 — đo xong, và kết luận ngược với trực giác

60 kèo / 3088 trận. Chỉ đọc thêm, `board_hash` giữ nguyên `fe413c452181`.

**Độ lớn** (audit chỉ chứng minh cơ chế, chưa ai đo): 31,3% số trận chọn cách chia lệch hơn cách cân
nhất của **cùng bộ tứ**, TB nhường 0,313; 4,15% (128 trận) chọn cách vượt tolerance dù có cách nằm
trong tolerance.

**Nhưng ép chia lại 128 trận đó là LỖ** — không đổi ai chơi, chỉ đổi ai cùng đội:

| được | mất |
|---|---|
| cắt 93,2 tổng chênh đội (TB 0,728/trận) | +86 lặp đối, +17 lặp bạn |
| 1 ca lặp-3 tự khỏi | **27** ca lặp-3 tạo ra mới |
| | gender −12/1002 lượt kiểm |
| | intra +46,6; **61/128** trận vượt trần intra mới |

**Tập con đổi mà trội hơn hoàn toàn** (không sinh lặp-3, không vượt trần intra, gender không giảm, lặp
không tăng): **6 trận / 3088 = 0,19%**, cắt tổng cộng 1,94 chênh đội.

**Kết luận:** trong đúng bộ tứ đã chọn, engine gần như không còn chỗ cải thiện cân bằng — phần lớn các
cuộc đổi là đúng. Không đáng viết bước hậu kiểm, càng không đáng đụng thang điểm. Muốn bảng cân hơn
phải đổi **ai vào bộ tứ** (RC2/RC1), không phải đổi cách chia.

⚠️ Phép đo xét **từng trận độc lập**. Đổi thật thì lịch sử lặp đổi theo và các trận sau nhìn khác đi;
hiệu ứng dây chuyền chưa nằm trong số này. Nhưng với dư địa 0,19% thì không đáng đo tiếp.

Đo bằng: `scratch/board-scorecard.ts`, các chỉ số `split_*` và `resplit_*`.

Kết quả gender hiện tại: tỉ lệ thoả mãn **0.6111**, dưới ngưỡng test 0.7. Đây là **đánh đổi cố ý**
(repeat-3 thắng gender-pref theo chỉ đạo), không phải hồi quy — con số không xê dịch qua mọi thay đổi
của hai phiên gần nhất.

---

## 4. Operation stabilization audit

| finding | trạng thái |
|---|---|
| OPS-P1-01 rolling lane không có round identity chuẩn | đã sửa ở tầng SQL (per-court max+1), tầng engine còn #14 |
| OPS-P1-02 quyền huỷ request preview bị chia sẻ | đã sửa (cùng cụm với #3/#27) |
| OPS-P1-04 xung đột persist thành block vĩnh viễn cho client | đã sửa (`replace_courts` khi fit) |
| ENG-P2-01 full-round search không có ngân sách mặc định | đã sửa bởi P2-5 |
| OPS-P1-03 / P2-01 / P2-02 / P2-03 / P3-01 / REG-01 | xem file gốc — chưa rà lại trong phiên này |

---

## 5. Chỗ đã đo và chỗ chưa

**Đã đo:**

| chỉ số | giá trị |
|---|---|
| sân trống trên dump prod thật | 0 / 155 lượt (trước: 21) |
| `board_hash` corpus 60 kèo | `fe413c452181`, trước = sau |
| test nhanh | 90 suite / 779 test xanh |
| typecheck | 0 lỗi (baseline làm mới tại ALGO 81) |
| prod `engine_search` (33 người / 6 sân, 53 lượt) | p50 257ms · p95 653ms · max 972ms |
| prod `total` | p50 1476ms · p95 2569ms · max 13000ms — lần 13s là **persistence** ghi DB, không phải engine |

**Chưa đo, và cần đo:**

- `tests/next-round-suggester/simulation/{targets,stress,ab-comparison}` — đường `suggestNextRound`
  nhiều sân, chưa phủ.
- Kèo **40 người / 10 sân**. Test `production-chain large` tiêu **20 giây** cho một `suggestNextRound`
  vì gọi không truyền `search_budget` (mặc định 100k đơn vị, **không có trần đồng hồ**). Prod có trần
  `LIVE_PREVIEW_BATCH_TIMEOUT_MS = 3000`, nên ở cỡ đó thứ chặn 20 giây là **cái trần** — search bị cắt
  và bảng đấu tệ đi **âm thầm**, không phải chậm. Dữ liệu hiện có chỉ tới 33 người / 6 sân.
- RC5 magnitude (trôi trạng thái rolling-lane).
- #15 rest bookkeeping: cần một phiên thật chạy qua để có dữ liệu.

---

## 6. Cách đo lại

```bash
# sân trống trên dump prod thật (cần kéo dump về trước — 15MB không giữ trong cây làm việc)
SRK=<service_role_key> node scratch/pull-sweep-dumps.mjs
npx tsx scratch/sweep-stuck-courts.ts

# tác động lên phần còn lại của engine: so board_hash hai bản
npx tsx scratch/board-scorecard.ts 60 scratch/out/sc-after.json
git checkout <commit-truoc> -- lib/next-round-suggester/suggest.ts
npx tsx scratch/board-scorecard.ts 60 scratch/out/sc-before.json
git restore --staged --worktree lib/next-round-suggester/suggest.ts   # xem BẪY GIT bên dưới

# repro từng lỗi
npx tsx scratch/probe-stuck-court2.ts   # lỗi 1
npx tsx scratch/probe-last-why.ts       # lỗi 2
```

---

## 7. Bẫy đo — đã mất thời gian vì chúng, đừng vấp lại

| bẫy | hậu quả | cách tránh |
|---|---|---|
| **`git checkout <commit> -- <file>` stage luôn file đó** | khôi phục bằng `cp` chỉ chữa worktree; index vẫn giữ bản cũ, `git commit` kế tiếp lặng lẽ **lùi fix**. `git diff --stat HEAD -- file` KHÔNG bắt được vì nó mù với index | kiểm bằng `git status --short` (thấy `MM`) hoặc `git diff --cached` |
| **`Bash` timeout không giết tiến trình node; `TaskStop` giết shell chứ không giết worker con** | có lúc 3 suite chạy song song (51 tiến trình) → mọi khẳng định-theo-đồng-hồ đỏ giả; suýt kết luận nhầm "hồi quy 47×" | `Get-Process node \| Stop-Process` trước mọi phép đo thời gian |
| **Mã thoát của `jest \| grep` là của `grep`** | suite đỏ mà báo xanh | ghi ra file rồi đọc dòng `Tests:` của chính jest |
| **Số không đổi sau khi vừa đổi cách đo** | phép đo không chạy | đối chiếu một giá trị đã biết trước khi tin kết quả |
| **Thư mục dump rỗng → "0 lượt, 0 rỗng"** | trông y hệt đã sửa xong | `sweep-stuck-courts.ts` nay dừng hẳn nếu thiếu dump |
| **Scorecard giống hệt nhau** | dễ đọc thành "fix vô hại", trong khi có thể là "corpus không chạm tới đường đã sửa" | luôn đi kèm một phép đo *có* chạm đường đó |
