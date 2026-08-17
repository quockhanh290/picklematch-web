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
| 15 | rest bookkeeping | **ĐÃ CHẠY** (cập nhật 16/8): `rest_seat_misses > 0` ở **180/5887** hàng. Trước đây 0/5657 nên bị ghi là chưa chạy; giờ có dữ liệu. Chưa kiểm giá trị có ĐÚNG không, chỉ biết nó có ghi |
| 23 | rolling-lane ghi đè `playerIdsByRound` | **không phải lỗi** — đã kết luận, đừng điều tra lại |

---

## 3. Scoring audit — 7 root cause, 71 finding

| root | nội dung | trạng thái |
|---|---|---|
| **RC2** generator đẻ ra pool lệch trình trước khi ghép | `classifyPlayer` mù pvna; `mustPlayAt` cố định 1 còn `mustRestAt` co giãn → pool owed phình mỗi vòng; corrector ép MUST_PLAY không kiểm khả thi | **đã trị tại gốc** — ALGO 49→50 generator band-cap, corrector bỏ relax toàn cục |
| **RC6** ngân sách + required quá chặt đẻ ra NO_VALID_MATCH giả | | **đã trị**: budget reserve; và hai lỗi ở §1 chính là phần còn lại của RC6 |
| **RC1** greedy per-court commit không thể cắt lại partition | sân cuối thừa hưởng cặn của các sân trước | **giảm nhẹ**, chưa trị gốc: `repairPayloadBatch*FromPool` kéo người từ ghế dự bị (ALGO 47/48); joint re-partition chỉ chạy khi ≥2 sân |
| **RC3** năm cổng INFINITY định giá cân bằng thấp nhất | `pvnaDiff` weight 1, trong khi recent-repeat 28/80/80, avoid-opponent 300 | **ĐÃ ĐO XONG 16/8 — dư địa bằng không, xem §3.1** |
| **RC4** ~16 repair rời rạc không hội tụ | mỗi cái bảo vệ một metric bằng thang riêng | **một phần**: P2-2 gộp thành 1 optimizer, cờ vẫn TẮT — nhưng **đã có bảng quyết định canary, xem §3.4** |
| **RC5** dựng lại trạng thái rolling-lane bị trôi | 4 nơi dựng lại logical round, không nơi nào khớp nhau | **ĐÃ ĐO 16/8 — không thấy drift, xem §3.2** |
| **RC7** avoid/group/gender vừa là generator vừa là cổng cứng | | **ĐÃ ĐO 16/8 — hai cổng cứng nó nêu tên đều chết trên prod, xem §3.3** |

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

### 3.2 RC5 — đo xong, không thấy drift

Audit tự ghi: "cơ chế được verify bằng code, nhưng ĐỘ LỚN của drift trong một phiên thật thì không có
replay nào chứng minh". Đo 16/8 trên **104 dump prod / 2 kèo**, và mở rộng ra toàn bộ `session_player_state`.

**Nửa thứ nhất — `matches_played` engine lấy từ snapshot DB có lệch với sự thật trong các dòng trận không?**

| | |
|---|---|
| lượt kiểm | 3 380 (người × dump) |
| lệch | **0 (0,0%)** |
| dump có thứ tự ưu tiên đổi | **0/104** |

Kiểm chứng phép đo có chạy: mẫu in ra `db=6 / tính-lại=6` trên 48 dòng completed. Không phải harness rỗng.

**Nửa thứ hai — bộ đếm nghỉ có "chết đứng" như RC5 mô tả không?** Không. Toàn bộ 5 887 hàng
`session_player_state`: 0 → 76,0% · 1 → 20,6% · 2 → 1,9% · 3 → 0,6% · 4-6 → 0,9%, **max 6**.
Bộ đếm tăng bình thường. (Mẫu 2 kèo của tôi max 1 chỉ vì hai kèo đó xoay vòng tốt — đừng đọc mẫu hẹp
thành kết luận.)

**Kết luận:** trên dữ liệu hiện có, RC5 không quan sát được. ⚠️ Chưa chứng minh là *không tồn tại*:
tôi so `matches_played` chứ chưa tự tính lại chuỗi nghỉ từ round records, và hai kèo mẫu đều khoẻ. Mối
lo gốc của audit là phiên **dài / nối lại giữa chừng** — chưa có dữ liệu ở hình dạng đó.

Đo bằng: `scratch/measure-rc5-drift.ts`.

### 3.3 RC7 — đo xong, gộp ba thứ có sức nặng rất khác nhau

Audit tự gọi RC7 là blind spot: avoid-pair / group / gender vừa là bộ sinh vừa là **cổng cứng** làm teo
tập nghiệm. Đo trên prod 16/8:

| modality | dùng thật | vai trò trong scoring |
|---|---|---|
| **avoid-pair** | **0 hàng / 0 kèo** trong `session_avoid_pairs` — chưa từng bật | avoid-partner = **Infinity** (cổng cứng), avoid-opponent = 300× |
| **group** | **6 / 5 887** hàng `session_player_state` (0,1%), 2 nhóm | `hasRecentGroupRematch` = **Infinity** (cổng cứng), group_bonus 6 |
| **gender** | **66,2%** đòi hỏi về bạn, **60,4%** về đối thủ (11 534 người) | phạt **mềm** 4/2 — KHÔNG phải cổng |

**Kết luận:** hai cổng cứng mà RC7 nêu tên đều gần như không bao giờ nổ trên production. Thứ duy nhất có
sức nặng thật là gender, và nó là phạt mềm. Cơ chế "cổng cứng làm teo tập nghiệm" vì thế **không vận
hành** ở dữ liệu hiện tại.

Gender thì đã đo riêng: thoả mãn 55,28%, trần đạt được **mà không làm xấu cân bằng** là 55,48% — tức chỉ
còn **0,2pp** dư địa miễn phí. Nó đã sát trần không-tốn-gì.

⚠️ avoid-pair và group là tính năng **có tồn tại**. Nếu host bật chúng lên thì lo ngại của RC7 thành
thật, và lúc đó phải đo lại — kết luận này gắn với thực tế sử dụng hôm nay, không phải với code.

### 3.4 P2-2 / RC4 — bảng quyết định canary (đo 16/8, corpus 60 kèo)

`OPT=1` so với nền cờ-tắt. Optimizer can thiệp **2 157 / 2 762 bàn (78%)**.
`board_hash` fe413c452181 → c5f00de4017f (đổi là đúng — nó có việc phải làm).

| | TẮT | BẬT | |
|---|---|---|---|
| **HARD** avoid_partner | 0 | **0** | không vi phạm mới |
| sân lấp | 3088/3088 | **3088/3088** | không mất sân |
| over_tol_pct | 11,46 | **3,47** | **−70%** |
| avg_cost | 2,576 | **1,746** | −32% |
| blowout_pct | 1,42 | **0,97** | −32% |
| intra_over_cap_pct | 19,56 | **16,42** | −16% |
| avg_play_spread | 1,367 | **1,217** | tốt hơn |
| avg_worst_rest | 1,55 | **1,167** | tốt hơn |
| owed_share_of_idle_pct | 4,5 | **2,92** | tốt hơn |
| repeat3_pct | 1,91 | 2,01 | +0,1pp |
| **summed_max_consecutive_play** | 195 | **254** | **+30% — xấu rõ** |
| seated_at_or_past_rest_pct | 32,46 | 34,29 | +1,8pp |

**Đánh đổi một dòng:** chất lượng bàn đấu tốt lên nhiều, ràng buộc cứng sạch, không mất sân — đổi lại
người chơi **bị đá liền nhiều hơn 30%**. Đúng trục mà panel chống-kiệt-sức (ALGO 59) sinh ra để bảo vệ.

**Nếu canary:** bật 1 kèo qua allowlist, và thứ phải theo dõi là **mệt**, không phải cân bằng — cân bằng
chắc chắn tốt lên. Hỏi host sau kèo: có ai kêu bị xếp liên tục không.

⚠️ Không so độ trễ ở lần chạy này: máy đang chạy suite song song. Các chỉ số trên miễn nhiễm với tải.

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
- ~~Kèo 40 người / 10 sân~~ — **ĐÃ ĐO 16/8, nỗi lo bị bác bỏ.** Chạy đúng đường live
  (`buildSuggestedMatchPayloads`), 40 người / 10 sân / 8 vòng, hai lượt trên cùng đầu vào — đồng hồ thật
  (trần 3000ms nổ như prod) và đồng hồ đóng băng (trần không thể nổ, vì trần kiểm bằng `Date.now()`):

  | | không trần | có trần 3s |
  |---|---|---|
  | sân lấp được | 80/80 | 80/80 |
  | vượt tolerance | 0% | 0% |
  | chênh TB | 0.111 | 0.111 |
  | `board_hash` | **db9bcfe** | **db9bcfe** |

  Bảng đấu **giống hệt** → trần không cắt gì. Cả bàn 10 sân giải xong ~571ms/vòng.

  **Vì sao con số 13.5s của sim không mâu thuẫn:** sim gọi `suggestNextRound` giải **10 sân cùng lúc**,
  production **chỉ** dùng `suggestNextMatch` lấp từng sân. Đường prod nhanh hơn ~24 lần ở cùng cỡ. Mấy
  test `PERFORMANCE_TARGETS` đang đỏ vì thế đang đo **một đường production không đi** khi lấp bàn.

  ⚠️ Giới hạn: pool của fixture hẹp (pvna 2.53–4.48), 8 vòng chứ không phải 15, lấp đồng bộ cả bàn chứ
  không phải rolling async như prod, và chạy trên máy dev chứ không phải Deno. Pool lệch hai cực hoặc
  nhiều avoid-pair có thể vẫn chạm trần.
  Đo bằng: `scratch/scale-40x10.ts`.
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
