# TÌNH TRẠNG DEFRAG (cập nhật 2026-08-14) — đọc mục này trước

Nguồn gốc: `docs/ENGINE_FRAGMENTATION_AUDIT.md` (roadmap P0→P4). Bảng dưới là trạng thái THẬT, đã
kiểm bằng code trong phiên 14/08 — nhãn trong file audit có chỗ sai (P2-5, P2-7).

| | việc | trạng thái |
|---|---|---|
| **P0** | 5 việc chặn máu | XONG |
| **P1** | hợp nhất định nghĩa (12 mục) | XONG 12/12 |
| P2-1 | chọn 1 model scoring | **CHƯA** — 8 điểm rẽ nhánh `isQualityCostModelEnabled` còn sống; chờ host chạy canary |
| P2-2 | gộp post-pass thành 1 optimizer | **XONG** 13-14/08, cờ TẮT, đã merge, chưa canary |
| P2-3 | hợp nhất options edge | XONG (`a79f88b`) |
| P2-4 | bộ máy "Chờ Sân X" | XONG |
| P2-5 | **bỏ wall-clock khỏi hot path** | **XONG + ĐÃ DEPLOY 14/08** — ngân sách đếm được (`search-budget.ts`), engine tất định. Edge v269 / ALGO 78. Chờ kèo thật để đọc `timing_ms` Deno |
| P2-6 | gộp đường ghi hint | XONG |
| P2-7 | gộp rest bookkeeping | XONG SẴN (báo cáo gốc sai, chưa từng hỏng) |
| **P3** | xoá code chết | **PHẦN LỚN ĐÃ XONG TỪ TRƯỚC** — kiểm 14/08: BUG #40, #33, #34, #39, `fixedTeamPairing.ts` đều **0 hit, đã bị xoá ở phiên nào đó mà danh sách chưa cập nhật**. Xoá nốt 11 khai báo chết trong `ScreenComponents.tsx` (`7765b17`). ⚠️ `repeatPool` **KHÔNG xoá** — xem ghi chú dưới. ⚠️ Sáu post-pass cũ CHƯA xoá được: nhánh cờ-tắt còn dùng |
| **P4** | UI/UX (không chặn engine) | **mục đáng nhất XONG 14/08** — `match-compromises.ts` (hàm thuần) suy ra một danh sách đánh đổi duy nhất; thẻ "Chơi luôn" và các dòng dưới cùng render từ nó nên không thể mâu thuẫn. Kèm 2 lỗ hổng: cost line trước đây KHÔNG có từ nào cho intra-team, và hai bên dùng hai nguồn pvna khác nhau. **⚠️ client-only → phải rebuild app mới thấy** |

**Ngoài roadmap, đã xong trong hai phiên 13-14/08:** bug flicker (3 fix client, xác nhận trên kèo thật,
host QA xong) và bug "Gợi ý vừa cũ sau khi có trận kết thúc".

**Còn treo, không thuộc defrag:**
- `full-session.test.ts`: **chuỗi nghỉ ĐÃ XANH** (14/08, sàn cân bằng số trận — xem mục riêng).
  **gender preference vẫn đỏ và là đánh đổi cố ý, không phải bug** — xem mục riêng.
- Quyết định canary/deploy P2-2 — chờ host, không có hạn.
- Supabase trả HTTP 522 lúc cuối phiên 14/08 — kiểm dashboard nếu app hỏng.

---

## P2-5 — XONG + **ĐÃ DEPLOY** (2026-08-14): edge v269, **ALGO 78**

⚠️ **P2-5 KHÔNG có cờ** — không như P2-2 (`SESSION_BOARD_OPTIMIZER`) hay quality-cost (allowlist). Deploy
là đổi cho MỌI kèo ngay lập tức, không canary được. Cố ý không thêm cờ: muốn có cờ thì phải giữ song song
cả đường-đồng-hồ lẫn đường-đếm, đúng thứ phân mảnh mà defrag đang gỡ.
**Đường lùi:** `git checkout 9c7d226 -- lib supabase` rồi deploy lại = về ALGO 77.

**CHƯA ĐO:** độ trễ thật trên Deno. Chất lượng đã cố định giữa các máy, nên thứ đổi theo máy giờ là THỜI
GIAN. Kèo thật đầu tiên sau deploy → đọc `debug_dumps.timing_ms` để có số.

**BẪY vừa vấp, đáng nhớ:** deploy lần đầu FAIL ở bước bundle — `board-optimizer/index.ts` import
`'./constraints'` thiếu đuôi `.ts`, Deno không tìm được module. P2-2 merge sau cờ tắt nên **chưa ai bắt
Deno bundle nó bao giờ** (đúng mục "chưa chạy thật lần nào trên edge" trong danh sách CHƯA-chứng-minh).
Edge bundle CẢ lib bất kể cờ bật hay tắt → code sau cờ tắt vẫn phải bundle được. Đã sửa (`f82efba`).


**Đã làm:** `lib/next-round-suggester/search-budget.ts` — ngân sách đếm được (1 đơn vị = 1 partition
được đánh giá), lồng nhau được (con tiêu cả vào cha), không đọc đồng hồ. Thay TOÀN BỘ ngân sách
theo-đồng-hồ trong: `pair.ts` (vòng lấy mẫu), `suggest.ts` (regular / rescue reserve / exhaustive
fallback), `live-preview.ts` (batch, per-court, beam, wait-rescue, strict rescue), `planner/`
(rolling-horizon, pair-swap-search, session-plan), và edge `session-live-matches-suggest` (pass rescue
toàn bàn). Tỉ giá `SEARCH_UNITS_PER_LEGACY_MS = 100` là **đo được**, không phải đoán (≈100 partition/ms
trên corpus thật) — mọi hằng số ms cũ được viết lại nguyên giá trị nhân tỉ giá đó.

**Bốn con số mua bằng phép đo:**

| câu hỏi | cách đo | kết quả |
|---|---|---|
| engine có còn phụ thuộc máy? | scorecard `REALCLOCK=1` chạy 2 lần (20 kèo) | **CŨ: `d6a489a0e263` vs `7673f82e9aa3` — KHÁC NHAU.** MỚI: `84fd9b05424d` cả hai lần |
| chất lượng có tệ đi? | scorecard 60 kèo | **`board_hash f1b6d8ac0b0c`** = ĐÚNG baseline. cost 2.5742 · vượt-tol 11.43% · lặp-3 1.98% · blowout 1.39% · intra 19.56% — trùng khít bảng "lấp 1 sân · cờ TẮT" |
| núm có nối vào đâu không? | hạ tỉ giá 100→3 | hash đổi `1ef417fec081`, chất lượng xấu đi (cost 2.70, intra 22.12%) → **có nối** |
| đắt hơn bao nhiêu? | scorecard 20 kèo, đo p50/p90/p99/max mỗi lần gọi | CŨ p50 126 · p90 301 · p99 766 · max 1243 ms → MỚI p50 125 · p90 407 · p99 880 · **max 1388** |

Vì sao hash 60-kèo KHÔNG đổi dù người ta dự kiến nó đổi: harness luôn **đóng băng đồng hồ**, tức là
nó vẫn luôn đo đường "tìm kiếm đầy đủ". Ngân sách đếm được ở tỉ giá 100 **không cắt gì trên corpus
này** → cho ra đúng đường tìm-kiếm-đầy-đủ đó. Cái đổi là đường THẬT (đồng hồ chạy) giờ cũng ra kết quả
ấy, thay vì một kết quả khác mỗi lần.

**Giả thuyết BỊ BÁC BỎ, đừng điều tra lại:** 2 test đỏ `full-session.test.ts` KHÔNG phải do wall-clock.
Chạy lại đúng hai kịch bản đó với đồng hồ đóng băng (`scratch/p25-frozen-probe.ts`) cho **con số y hệt**
(0.6667 và 0.6667) — pool 9/12 người quá nhỏ, deadline 800ms không bao giờ chạm tới. Chúng vẫn đỏ, với
đúng giá trị cũ, và giờ là giá trị TẤT ĐỊNH.

### Phát hiện phụ, đáng giá hơn cả việc chính: beam rolling-horizon xưa nay là đồ trang trí

Đo `rolling_horizon` instrument event trên `rolling-horizon-chain.test.ts`:

| | evaluated | calls | exhausted | mỗi lần gọi |
|---|---|---|---|---|
| CŨ | **1** | 6 | **1** (luôn hết giờ) | ~330ms beam / ~420ms tổng |
| MỚI, không trần | 2–3 | 29–30 | 0 | ~1.3–2.5s |
| MỚI, trần 12 lượt nhìn trước | 2–3 | 12 | 1 | ~600–1100ms |

Beam **luôn** cạn ngân sách 300ms sau khi xét ĐÚNG MỘT ứng viên, tức là nó chưa bao giờ so sánh gì —
tính năng nằm im vì chính ngân sách của nó. Bỏ đồng hồ ra thì nó chạy thật và tốn tiền thật. Đã thêm
trần đếm được `DEFAULT_MAX_FUTURE_SEARCHES = 12` (đơn vị không đủ tính đúng giá một lượt nhìn trước:
một lượt dựng lại state + sort lại cả pool nhưng chỉ bị tính vài đơn vị).

### Tăng tốc engine (2026-08-14, sau P2-5) — trả xong phần độ trễ

Hai chỗ nóng lấy từ CPU profile, cả hai **không đổi một byte lineup nào** (hash vẫn `f1b6d8ac0b0c`):

1. **`getProjectedRepeatSummary` thôi clone 8 map.** Nó chạy mỗi lần chia đội (hàng chục nghìn lần/board)
   và clone 8 map đếm chỉ để tăng 6 ô. Một map chiếu khác map gốc đúng ở các ô trận này đụng tới, và một
   ô chỉ vượt ngưỡng "lặp" khi nó đang ở 1 → tính thẳng, không dựng.
2. **Hoist object spread trong `pair.ts`.** Options cho `scoreMatch` dựng lại 3 lần mỗi split; options cho
   `evaluatePartition` dựng lại mỗi partition. Cả hai bất biến trong một lượt search.

| | p50 | p90 | p99 | max | 60 kèo |
|---|---|---|---|---|---|
| CŨ (đồng hồ) | 126 | 301 | 766 | 1243 | — |
| P2-5 | 125 | 407 | 880 | 1388 | 516s |
| **+ tăng tốc** | **116** | **364** | **792** | **1215** | **424s** |

→ đã **nhanh hơn cả mã cũ dùng đồng hồ** ở p99/max, và `elapsedMs < 2000` trong
`rolling-horizon-chain` **hết đỏ**.

**ĐÃ LOẠI — khoá cache lượt-nhìn-trước theo đường đi:** khoá cũ (serialize toàn bộ count map + lịch sử)
đắt và gần như không trúng (cache=0/12). Thay bằng khoá "candidate + chuỗi sân đã xong" thì đúng và rẻ,
NHƯNG mất loại trúng mà khoá cũ có: hai thứ tự KHÁC nhau dẫn tới cùng một state
(`rolling-horizon.test.ts` có test đúng ca đó, chuyển đỏ). Khoá theo TẬP thay vì chuỗi thì cần chứng
minh `projectMatch` giao hoán — chưa chứng minh nên không làm. Đã revert.

### Beam rolling-horizon — ĐÃ ĐO ĐƯỢC LẦN ĐẦU (2026-08-14)

**Đã chốt cho lần ship này: `DEFAULT_MAX_FUTURE_SEARCHES = 6`** = đúng hành vi prod xưa nay, toàn bộ
test rolling xanh trở lại (18/18). P2-5 vì thế là thay đổi THUẦN tất định, không kèm bật tính năng nào —
canary có gì lạ thì quy được trách nhiệm.

Đo A/B được là nhờ chính P2-5: trước đó engine chạy 2 lần ra 2 kết quả nên so beam bật/tắt là vô nghĩa.
Rig: `ROLLING=1 BEAM=<n> npx tsx scratch/board-scorecard.ts 20` (20 kèo, 1008 trận, đường rolling).

| trần | board_hash | cost | vượt-tol | intra | blowout | panel | play-spread | worst-rest | p50 | p90 |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 (nằm im) | `947878949cd3` | 2.7054 | 9.42% | 21.13% | 1.49% | 6.45% | 1.40 | 1.65 | **46** | 234 |
| **6 (đang ship)** | `947878949cd3` | 2.7054 | 9.42% | 21.13% | 1.49% | 6.45% | 1.40 | 1.65 | **139** | 389 |
| 12 (chạy thật) | `86723000f4ce` | **2.6657** | 10.32% | 21.83% | 1.79% | 7.54% | **1.35** | **1.55** | **239** | 594 |

**Ba điều bảng này nói:**
1. **Ở trần 6, beam so sánh ứng viên rồi chọn ra ĐÚNG board như khi nó nằm im** (cùng hash, 1008/1008
   trận) — mà tốn thêm ~93ms/sân. Đây là chi phí prod ĐANG trả hôm nay, không phải cái P2-5 tạo ra.
2. **Ở trần 12 nó đổi board thật, và đánh đổi rõ:** tốt hơn ở cost tổng và ở CÔNG BẰNG (play-spread
   1.40→1.35, worst-rest 1.65→1.55 — đúng thứ một bước nhìn xa nên mua được), xấu hơn ở chất lượng bàn
   (vượt-tol +0.9pp, intra +0.7pp, blowout +0.3pp) và host thấy nhiều panel đánh đổi hơn (+1.1pp).
3. **Giá của nó là 5× thời gian trung vị** (46→239ms mỗi lần lấp sân).
4. Trần 1 làm đỏ unit test `prefers a slightly weaker immediate match...` — tức trần 1 = tắt beam, không
   phải "beam gọn nhẹ".

**Tôi đoán SAI một nửa:** tôi cược beam là đồ bỏ. Nó có mua được thứ thật (công bằng), chỉ là mua đắt và
đồng thời làm xấu chất lượng bàn. Không phải "chắc chắn xoá", mà là "đánh đổi thật, cần host cân".

### HOST ĐÃ CHỐT (14/08): GIỮ BEAM. Chưa verify xong — đọc phần này trước khi đụng vào.

Giữ code, giữ trần **6** = đúng hành vi prod hôm nay. **Không xoá, không nâng.** P2-5 vì thế ship sạch:
một thay đổi tất định, không kèm bật tính năng nào.

⚠️ **Ba thứ CHƯA verify — đừng coi beam là đã xong:**

1. **Chưa biết beam làm gì trên prod thật.** Mọi số ở trên đo trên corpus tổng hợp + fixture test. Ở trần
   6 nó đổi 0/1008 board trong corpus, nhưng corpus không phải kèo thật. **Cần:** một kèo chạy edge v269,
   đọc instrument event `rolling_horizon` trong `debug_dumps` → xem `evaluated`, `calls`, `exhausted`,
   `pick`. Nếu `pick` luôn = 0 thì beam đang tiêu ~93ms/sân cho không.
2. **Chưa biết 93ms đó trên Deno là bao nhiêu.** Đo trên máy dev Node. Edge chậm hơn thì con số này lớn
   hơn, và nó nằm ngay trên đường host đang chờ.
3. **`invariantGuardRevert` vẫn chưa kết luận được** — nó cần rolling plan target đang TẮT, nên chưa
   quan sát được lần nào.

**Nếu sau này ai đó muốn đổi trần, phải chạy lại ĐÚNG bộ này (rig đã có sẵn):**
- `ROLLING=1 BEAM=<n> npx tsx scratch/board-scorecard.ts 20` — so board_hash + cost + play-spread +
  worst-rest + p50/p90 với bảng trên
- `npx jest tests/next-round-suggester/simulation/rolling-horizon-chain.test.ts
  tests/next-round-suggester/simulation/rolling-horizon-matrix.test.ts
  tests/next-round-suggester/unit/rolling-horizon.test.ts --runInBand` — 18/18 phải xanh ở trần 6;
  ở trần 12 thì 2 assertion `totalTeamGap/totalMatches ≤ 0.15` chuyển đỏ (0.163) — đó là hệ quả ĐÃ BIẾT
  của việc beam hoạt động, không phải hồi quy mới
- Trần **1 làm đỏ** unit test `prefers a slightly weaker immediate match...` → trần 1 = tắt beam, đừng
  dùng nó như "beam gọn nhẹ"

**Chỗ chỉnh:** `DEFAULT_MAX_FUTURE_SEARCHES` trong `lib/next-round-suggester/planner/rolling-horizon.ts`.
Hook đo: `__setRollingBeamMaxFutureSearchesForTests`.

**Đã thử và LOẠI:** chỉnh tỉ giá (100→50→10) KHÔNG sửa được độ trễ — ở cả ba mức ca chậm vẫn ~2.2–2.6s
→ chi phí nằm ở phần việc ngân sách không tính, không phải ở tìm kiếm (đúng, và tối ưu ở trên mới là
thứ sửa được nó). Và **tính 1 đơn vị mỗi SÂN thay vì mỗi partition làm tỉ giá lệch TỆ HƠN** (92→682
đơn vị/ms thay vì 40→110) → đã revert.

### Gate sau P2-5

- `unit` + `property` + `scenario` + `fairness`: **89 suite / 774 test XANH**
- `host-live` + `production-live-chain`: **24 suite / 76 test XANH**
- `full-session`: 2 đỏ CÓ SẴN (giá trị không đổi, nay tất định)
- `production-chain-timing`: 4 đỏ CÓ SẴN — `await import()` cần `--experimental-vm-modules`; **đã A/B
  trên mã cũ: đỏ y hệt 4/4**, không dính gì tới P2-5
- `rolling-horizon-chain` + `rolling-horizon-matrix` + `unit/rolling-horizon`: **18/18 XANH** (sau khi
  đặt trần beam về 6 = hành vi prod)
- `tsc` 0 lỗi · eslint 0 error trên các file đã sửa

### Trạng thái bàn giao P2-2 (2026-08-14)

- **ĐÃ MERGE** vào `feat-quality-cost-model` (fast-forward `2b756d2` → `e741e0f`, 14/08). Worktree
  `.claude/worktrees/p2-2-optimizer` còn trên đĩa nhưng đã thừa — xoá được.
- **Kiểm sau merge: `board_hash f1b6d8ac0b0c`** = đúng baseline trước P2-2 → toàn bộ code mới nằm sau
  cờ tắt, đường cũ chạy y nguyên từng bit. `tsc` sạch.
- Cờ `SESSION_BOARD_OPTIMIZER` **TẮT**, allowlist rỗng. Chưa canary, chưa deploy. Prod vẫn ALGO 77.
- Gate ở repo chính: `npm test` chạy bình thường. (Lưu ý lịch sử: trong worktree dưới `.claude/` thì
  `npm test` khớp 0 file — chỉ đúng khi làm trong worktree, không phải ở đây.)
- ⚠️ **Supabase trả HTTP 522 lúc cuối phiên** (Cloudflare không tới được origin, query bảng timeout 20s).
  Không phải do thay đổi nào của chúng ta. Nếu còn 522 thì app của host cũng hỏng — kiểm dashboard trước
  khi kết luận bug.

### Việc tiếp theo

- **Quyết định beam rolling-horizon** (3 lựa chọn ở mục P2-5 trên) — chặn việc deploy P2-5.
- **P2-1**: chọn 1 model scoring (8 điểm rẽ nhánh còn sống) — chờ host chạy canary.
- **P3 xoá code chết**: nhóm rủi ro ~0 làm được ngay (BUG #40, #33, #34, #39, `fixedTeamPairing.ts`).
  **Thêm `repairPayloadBatchRepeatExposure`/`repeatPool`** — đã đo được là đổi 0 board ở đúng hình dạng
  nó sinh ra để xử (REFILL_BATCH=2), không còn là "chưa đo được".
  ⚠️ Sáu post-pass cũ CHƯA xoá được: nhánh cờ-tắt còn dùng. Chỉ xoá sau khi optimizer bật mặc định.
- **P4 UI/UX**: gộp `playCostText` + `capacityInfoLines` thành một hàm thuần (lỗi hiển thị host thấy).

## HAI TEST ĐỎ `full-session.test.ts` — ĐÃ ĐÀO TỚI GỐC (2026-08-14)

Cả hai đều KHÔNG phải do wall-clock (đã bác bỏ bằng phép thử đóng băng đồng hồ). Đào riêng ra thì là
**hai bệnh khác nhau ở hai tầng khác nhau**, không phải một.

### (a) chuỗi nghỉ — LÀ BUG THẬT, ĐÃ SỬA (`581a7bf`)

9 người / 2 sân / 9 vòng có lịch hoàn hảo (72 ghế = 9 người × 8 trận). Engine ra std 0.667.

Vòng 4, engine dựng ra CẢ HAI phương án rồi tự chọn cái tệ hơn:

| | recentRepeat.partner | matchCount excess |
|---|---|---|
| cho p09 nghỉ (**ít trận nhất**) | 0 | **1.000** |
| cho p02 nghỉ (đang dẫn) | 1 | 0.000 |

Bộ so sánh phân định ở **nấc 3** (`recentRepeat.partner`); cân bằng số trận là **nấc 6**, không tới lượt.
Tức là **một cặp lặp partner đủ thắng mọi mức lệch, dù lớn tới đâu** — không có sàn. p09 kết thúc 7 trận
trong khi p02/p08 có 9.

**Fix:** so `matchCount.excess` TRƯỚC `recentRepeatCost`. `excess` vốn đã bằng 0 khi độ lệch còn trong
biên ±1 trận, nên trên bàn cân bằng đây là no-op; chỉ cắn khi lệch thật sự rộng. std 0.667 → **0.471**.
Corpus 60 kèo: mọi chỉ số xê dịch trong nhiễu, lặp-3 còn TỐT hơn (1.98% → 1.91%), play-spread và
worst-rest không đổi. Hash `f1b6d8ac0b0c` → `fe413c452181`.

### (b) gender preference — KHÔNG phải bug, là đánh đổi có chủ ý

Fixture: 6 người F đều đòi partner là F. 3 cặp F-F mỗi vòng × 6 vòng = **18 lần ghép** trong khi chỉ có
**C(6,2) = 15 cặp F-F khác nhau** → lặp là BẮT BUỘC về mặt cấu trúc, không phải do engine kém.

⚠️ **Tôi đã kết luận SAI giữa chừng rồi tự đính chính — ghi lại để không ai đi lại:** phép đo đầu tiên
cho ra `score=Infinity` cả hai bàn (cổng cứng repeat-overflow chặn), tôi so hai `Infinity` và tuyên bố
"bàn gender tốt hơn → lỗi TÌM KIẾM". Sai. Hỏi thẳng `bestPartitioning` với đúng options từng pass thì:

| | score | gender |
|---|---|---|
| pass C engine tự tìm | **507.86** | 4/6 |
| bàn F-F dựng tay (hoàn hảo về gender) | 828.31 | 6/6 |

Bàn 6/6 **đắt hơn 320 điểm** vì nó gánh 7 cặp lặp partner thay vì 1. Engine loại nó là ĐÚNG theo thang
điểm hiện tại. Nới ngân sách 500× chỉ kéo 22/36 → 24/36 (0.611 → 0.667), vẫn dưới bar 0.7 → không phải
đói ngân sách.

### ĐÃ ĐO TIẾP (14/08) — gender-pref trên KÈO THẬT, và vì sao nâng trọng số là sai lever

Câu hỏi ban đầu là "bar 0.7 của fixture có hợp lý không". Đo ra thì fixture chỉ đang phóng to một điểm
yếu CÓ THẬT, nhưng lever để sửa lại không phải cái ai cũng nghĩ.

**1. Tính năng này KHÔNG hiếm:** 1455/2215 lượt người chơi (**65,69%**) có đặt ý muốn giới tính đồng đội,
**60/60 kèo** đều có, mỗi kèo 16–33 người. Giới tính chia gần đúng 50/50 (1093 F / 1122 M), **không ai bỏ
trống**, ý muốn chia đều (737 muốn F · 718 muốn M · 760 'any'). Nền so sánh sạch.

**2. Engine chỉ hơn ngẫu nhiên 6 điểm.** Corpus 60 kèo, 8100 lượt kiểm:

| | tỉ lệ thoả |
|---|---|
| ghép BỪA (tính toán giải tích) | **49,54%** |
| engine hiện tại | **55,28%** |
| đối thủ: ngẫu nhiên ~50% · engine | 52,00% |

**3. Núm trọng số CÓ nối nhưng gần như bất lực.** Quét `partner_gender_pref` 4 → 6 → 8 → 12 → 24 → 1000
(20 kèo): tỉ lệ thoả đi từ 56,79% → 58,70%. Ép **250 lần** chỉ mua được **1,9 điểm**. Board có đổi (hash
đổi, cost/lặp-3 đổi) nên núm không hỏng — nó chỉ không với tới được chỗ cần với.

**4. Vì sao: chỗ mất nằm ở tầng TRÊN, không phải ở thang điểm.**

| | tỉ lệ thoả |
|---|---|
| thực tế | 56,79% |
| trần khi cân bằng **không tệ hơn** cái engine đã chọn | **56,87%** |
| trần khi bỏ qua cân bằng, cùng bộ tứ đó | **74,26%** |

Engine **đã vắt gần hết phần miễn phí** — chỉ còn 0,08 điểm lấy được mà không phải trả gì. 17,5 điểm còn
lại **chỉ mua được bằng cách chấp nhận đội lệch hơn**. Trong một bộ tứ chỉ có 3 cách chia đội, và cách
chia gần như bị cân-bằng quyết định xong trước khi gender kịp lên tiếng.

**Hệ quả cho quyết định:**
- **Nâng trọng số là lever SAI** — đã đo, ép 250× vẫn không nhúc nhích.
- Muốn hơn thì chỉ có hai đường: **(a)** chấp nhận đội lệch hơn một cách có chủ ý, hoặc **(b)** can thiệp
  SỚM hơn — ở tầng chọn ai ngồi chung sân, để người hợp gu rơi vào cùng bộ tứ ngay từ đầu. (b) mới là chỗ
  17,5 điểm kia nằm, và nó chưa từng được thử.
- **Bar 0.7 của fixture:** hạ nó xuống tức là đóng dấu chấp nhận mức gần-ngẫu-nhiên trên một tính năng
  2/3 người chơi đang dùng. Nhưng giữ nó mà không làm (b) thì engine không đạt được.

⚠️ **Một phép đo TÔI ĐÃ LÀM SAI rồi tự sửa, ghi lại để đừng lặp:** lần đầu tôi so trần với *tolerance danh
nghĩa* và ra 50,35% — THẤP HƠN cả số thực tế. Lý do: trận vốn đã vượt tolerance thì không cách chia nào
"hợp lệ", bị tính 0, kéo tụt trung bình. Phải so với **cân bằng engine THỰC SỰ đã chọn**, không phải với
ngưỡng danh nghĩa.

**Rig:** `GPREF=<n> OPREF=<n> npx tsx scratch/board-scorecard.ts 20` — scorecard giờ in cả ba dòng
(thực tế · trần-không-tệ-hơn · trần-bỏ-qua-cân-bằng).

### ĐÃ ĐO HƯỚNG (b): +21 điểm gender mà MỌI chỉ số khác đều TỐT HƠN

`scratch/p-gender-foursome.ts` (20 kèo · 1008 trận · 2578 lượt kiểm). Giữ NGUYÊN tập người ngồi mỗi vòng
(không đụng luân phiên nghỉ, không đụng số trận), chỉ xếp lại họ vào sân/đội bằng leo dốc đổi-chỗ, và
**chỉ nhận nước đi nào không làm xấu đi BẤT KỲ thứ gì**: vượt-tol, đội vượt intra, tổng lặp, lặp-3.

| | thoả ý muốn | vượt-tol | đội vượt intra | tổng lặp | lặp-3 |
|---|---|---|---|---|---|
| thực tế (engine) | 52,13% | 2,88% | 83 | 799 | 88 |
| **(b) xếp lại, không xấu đi thứ nào** | **73,27%** | **1,69%** | **73** | **664** | **62** |
| xếp lại tự do, giữ intra | 93,25% | 32,14% | — | — | — |
| xếp lại tự do, bỏ hết | 97,13% | 32,54% | — | — | — |

**Đây không phải đánh đổi — là Pareto.** +21 điểm gender, đồng thời vượt-tol giảm, intra giảm, lặp giảm,
lặp-3 giảm. Engine đang bỏ lại từng đó trên bàn.

Hai dòng dưới cùng cho thấy phần CÒN LẠI (73% → 93%) mới là phần phải trả giá: nó đẩy vượt-tol từ 2,88%
lên 32%. Nên điểm dừng hợp lý nằm quanh 73%, không phải 93%.

⚠️ **Ba giới hạn của phép đo này, đọc trước khi hứa hẹn:**
- Đây là xếp lại HẬU KỲ trên bàn engine đã dựng, **nhìn thấy cả vòng**. Engine thật lấp từng sân một
  (rolling), nhiều lúc không có tầm nhìn cả vòng đó.
- Replay dùng shape **lấp cả bàn mỗi vòng** — shape dễ hơn đường live.
- Leo dốc greedy = **cận dưới**: tối ưu tử tế còn tìm được hơn.

**Gợi ý triển khai — có thể KHÔNG cần máy móc mới:** hình dạng của (b) đúng là thứ `board-optimizer`
(P2-2) đã làm — leo dốc cả bàn với guard ràng buộc, đã viết xong, đã test, đang nằm sau cờ
`SESSION_BOARD_OPTIMIZER`. Thêm gender vào hàm mục tiêu của nó nhiều khả năng rẻ hơn hẳn viết tầng mới.
**Chưa thử — đây là giả thuyết, không phải kết quả đo.**

## GOM SÂN (REFILL_BATCH) — ĐÃ ĐO, HOST CHỐT KHÔNG LÀM (2026-08-14)

Sửa `scratch/board-scorecard.ts` để giữ lại k sân xong trước khi lấp (`REFILL_BATCH=k`) — đây là thứ
cờ `MULTI=1` trước đây không làm được, vì vòng lặp cũ lấp ngay sau mỗi sân xong nên `idle.length` không
bao giờ > 1. Mặc định k=1 vẫn ra đúng `board_hash f1b6d8ac0b0c`.

| | lặp-3 | vượt tol | blowout | intra vượt | cost |
|---|---|---|---|---|---|
| lấp 1 sân · cờ TẮT | 1.98 | 11.43 | 1.39 | 19.56 | 2.574 |
| lấp 1 sân · cờ BẬT | 2.07 | 3.47 | 0.74 | 15.74 | 1.710 |
| lấp 2 sân · cờ TẮT | **1.13** | **4.63** | 0.45 | 26.36 | 2.387 |
| lấp 2 sân · cờ BẬT | **0.97** | **2.07** | 0.65 | **14.54** | 1.648 |

**HOST CHỐT: KHÔNG làm cơ chế chờ-để-gộp.** Lý do: không ai muốn để sân trống chờ tới khi có 2–3 sân
cùng rảnh. Số liệu hậu thuẫn quyết định đó — khoảng cách giữa hai lần kết thúc có trung vị **8.9s**
(1725 mẫu/53 kèo), nên muốn gộp 45% số lần phải chờ ~8s, cộng 3–5s engine = sân trống 11–13s.
→ **Đừng mở lại hướng này.** Nếu ai đó thấy bảng trên và muốn "gom sân", đây là câu trả lời.

**Đính chính kèm theo:** trần `LIVE_PREVIEW_REPLACEMENT_MAX_COUNT = 2` KHÔNG phải thứ chặn việc gộp.
Nó làm hai việc: giới hạn số sân của `replace_courts`, VÀ quyết định leo lên `full_board` khi
missing > 2. Client đã gộp sẵn: 1 sân trống → replace 1; 2 → replace cả 2 một request; ≥3 → full_board
một request (dump prod có `[2,1]`, `[5,4]`). Nâng trần không tạo thêm lần gộp nào, chỉ đổi nhãn request
— mà comment tại `preview-consistency.ts:299-303` cảnh báo full_board khi có sân đang chạy dễ đụng
"already assigned". **Đã KHÔNG sửa.**

**Thu hoạch phụ, đáng giá hơn: `repeatPool` chết thật.** Ở `REFILL_BATCH=2` cờ TẮT — đúng hình dạng
"lấp ≥2 sân trong khi sân khác đang chạy" mà nó sinh ra để xử — nó đổi **0 board** (`chg=0`). Câu hỏi
treo từ 2026-08-11 ("không kết luận được vì harness không tạo được hình dạng đó") giờ có câu trả lời:
nó là ứng viên **XOÁ** của P3, không phải "chưa đo được".

## P2-2 — XONG (2026-08-13/14), CỜ TẮT, ĐÃ MERGE, CHƯA CANARY

Nhánh `feat-p2-2-optimizer` (worktree `.claude/worktrees/p2-2-optimizer`). Spec + kế hoạch:
`docs/superpowers/{specs,plans}/2026-08-13-board-optimizer*`.

**Một optimizer thay sáu post-pass**: `lib/next-round-suggester/board-optimizer/` (constraints H1–H8 /
objective lex+cost / moves W1–W4 / steepest descent tất định), cắm sau cờ `SESSION_BOARD_OPTIMIZER`
(khuôn allowlist của quality-cost, mặc định TẮT).

**Cấu hình đã chốt bằng số: W1–W3 + O-lex.**

| kiểm ở đâu | phạm vi | kết quả |
|---|---|---|
| test | 150 test, 120 board ngẫu nhiên × 3 cấu hình | xanh |
| corpus tổng hợp | 60 phiên / 3088 board | vượt-tol 353→107 board · lặp-3 61→64 · cost 2.574→1.710 |
| **replay kèo THẬT** | **53 kèo / 2158 board** | **vượt-tol 14→0 · lặp-3 86→6 · intra 175→62 · 0/53 kèo xấu đi** |

**Bảo chứng lùi được:** cờ TẮT cho ra đúng `board_hash f1b6d8ac0b0c` = byte-identical với đường cũ.
Merge với cờ tắt KHÔNG đổi hành vi prod.

**Bốn kết luận mua bằng phép đo, đừng làm lại:**
- Phương án "chọn lại toàn bộ 4 người/sân" **chết**: bỏ trần vòng lặp cho ra hash y hệt → leo dốc đã
  cạn nước đi trước khi chạm trần 30.
- Bỏ W3 (đổi với băng ghế) → lặp-3 nổ 1.98% → 11.46%. H5 chỉ bảo vệ TỪNG board; corpus replay cả phiên.
- **W4 (xoay vòng 3 sân) không đáng**: 77% khối lượng (2560/3304 ứng viên) để mua 0.1pp, còn thua ở
  blowout/intra/cost.
- Tôi ĐOÁN SAI chỗ tốn thời gian: cache sân-không-đụng chỉ −19%; đo ra `computeQualityCost` chiếm 70%,
  trả cho 79% ứng viên sắp bị vứt → tính lười. 2542 → 331 ms.

**CHƯA chứng minh:**
- [ ] **Đường rolling chưa hề đo** — mọi phép đo đều lấp cả bàn một lượt; kèo thật lấp từng sân. Đó là
      nơi `repeatPool` sống và nơi flicker xảy ra.
- [ ] Chưa chạy thật lần nào trên edge (Deno).
- [ ] Kèo 40+ người chưa kiểm — latency tỉ lệ thuận với băng ghế (331ms ở băng ghế 20).
- [ ] Panel giảm 5.67% → 4.21%: host thấy ít lời mời "chờ sân/chơi luôn" hơn.
- [ ] `invariantSafePayloads` (#70) chưa xoá vật lý — nhánh cờ-tắt còn cần.

## RÀ SOÁT P2 (2026-08-14) — còn đúng hai mục

| mục | bằng chứng | trạng thái |
|---|---|---|
| P2-1 chọn 1 model scoring | **8 điểm rẽ nhánh** `isQualityCostModelEnabled` còn sống | CHƯA — chờ host quyết canary |
| P2-2 gộp post-pass | xem trên | xong, cờ tắt |
| P2-3 hợp nhất options edge | rescue toàn bàn `:1273` dùng chung `runEngine` với `:1212` | XONG (a79f88b) |
| P2-4 bộ máy "Chờ Sân X" | `rescue_search_truncated` có và được truyền | XONG |
| P2-5 mở rộng miền tất định | replay 2 lần ra cùng board (cũ: 2 hash khác nhau) | **XONG 14/08** — `search-budget.ts`; còn 1 quyết định beam |
| P2-6 gộp đường ghi hint | đúng 1 call site `sync_live_suggestion_hints` | XONG |
| P2-7 gộp rest bookkeeping | migration `20260809000001` helper dùng chung | XONG SẴN (báo cáo gốc sai) |

**P2-5 đã xong 14/08** — xem mục riêng ở trên. Bằng chứng đóng lại: `REALCLOCK=1` chạy scorecard hai
lần cho hai hash khác nhau trên mã cũ (`d6a489a0e263` / `7673f82e9aa3`) và một hash duy nhất trên mã
mới (`84fd9b05424d`).

**Gate:** 2 test trong `simulation/full-session.test.ts` (chuỗi nghỉ, gender preference) vẫn đỏ, **và
KHÔNG phải do đồng hồ** (đã bác bỏ bằng phép thử đóng băng đồng hồ — cùng con số). Chúng nói engine
đang thua thật ở hai chỉ số công bằng; giờ ít nhất chúng đỏ một cách tất định.


## NỢ DỌN DẸP (đừng để thành phân mảnh mới — đây chính là thứ audit đang đo)
- [ ] **2 RPC chết trên prod:** `sync_live_suggestion_metadata`, `sync_live_suggestion_degraded_fields` — từ edge v249 không ai gọi nữa. CỐ Ý giữ để còn đường lui nếu phải rollback edge. **Xoá sau vài ngày chạy ổn**, kèm kiểm lại `grep` trong `supabase/functions/` + client trước khi drop.
- [x] **`npm run typecheck` 936 lỗi → 0.** Ba việc, không cái nào vá triệu chứng:
  - **Gốc thật: `tsconfig.json` KHÔNG loại trừ `scratch/`** dù CLAUDE.md ghi là có → mọi file nháp bị typecheck. Tôi đã định sửa import trong 18 file scratch — **sai chỗ**. Sửa 1 dòng `exclude` (thêm `scratch/**/*`, `tmp/**/*`).
  - **File lạc `C:tmptest-suggest.ts`** ngay gốc repo từ 2026-06-20 (ai đó ghi ra `C:\tmp\...` trên Windows, shell tạo file tên đúng như vậy). `ls`/`Glob` KHÔNG thấy vì dấu hai chấm — phải dùng `tsc --listFilesOnly` mới lòi ra. Chuyển vào `scratch/` chứ không xoá vì nó untracked.
  - **4 script mồ côi** (`test-session-suggest`, `sim-per-court-beam`, `sim-beam-vs-greedy`, `eval-weights`) — không được `package.json` tham chiếu, type đã trôi. `git mv` sang `scratch/` (rename, hoàn tác 1 lệnh). `npm run diagnose` dùng `scripts/diagnose-session.ts`, khác hẳn, vẫn sạch.
- [~] **Backfill trong migration `20260809000001`: KHÔNG sửa, cố ý.** Đã kết luận không cần chạy (counter tự lành ở trận kế tiếp — xem `scratch/sim-session-p07.sql`). Nhưng migration đã APPLY và đã commit, mà quy ước dự án là **file migration bất biến sau khi merge**. Sửa kể cả comment cũng tạo tiền lệ xấu. Khối comment ở lại; ghi ở đây là ĐỦ để người sau biết không phải chạy nó.
- [x] **4 test `projected live match state`: ĐÃ XANH, không phải nợ.** Mục này từng ghi "lỗi thời từ ALGO 53, cần viết lại" — **SAI**. Chúng đỏ vì **bug thật** (fast-path gọi `makeAlternative` với `allowRecentGroupRematch` cố định false → sân trống khi 4 người rảnh duy nhất vừa đánh với nhau), và commit `95b2da5` (ALGO 58) đã sửa bằng retry relaxed. Chạy lại ở HEAD: **35/35 xanh**. Bài học: đừng mặc định "test cũ thì bỏ" — hai lần trong đợt này test cũ hoá ra đang chỉ đúng bug.
- [x] **~~`repeatPool` là ứng viên xoá~~ — SAI, ĐÃ ĐO LẠI 14/08. KHÔNG được xoá.** Chạy lại chính harness
  đó ở `REFILL_BATCH=2`: **`repeatPool:entered` 482 lần, `repeatPool:changed` 34 lần** (20 kèo). Nó bắn và
  nó ĐỔI BOARD. Con số "chg=0" trong ghi chú cũ là sai. Thêm một lý do độc lập: post-pass này gọi
  `repairPayloadBatchSevereRepeatFromPool` = bản FIX đã ship (ALGO47) cho bug host báo thật ("sân 2 vòng 5
  không cứu được lặp 3").
- [x] **~~3 post-pass không bắn phát nào~~ — SAI với 2/3.** Cùng lượt đo: **`participation:changed` 150**,
  **`blowoutPool:changed` 7**. Cả hai đều đang làm việc. Chỉ `invariantGuardRevert` là không thấy bắn, và
  nó cần rolling plan target vốn đang TẮT nên vẫn chưa kết luận được.
- ⚠️ **Vì sao hai ghi chú trên sai:** cả hai đều bắt nguồn từ một lượt đo mà pass KHÔNG VÀO (`entered=0`)
  rồi đọc thành "vào mà không đổi gì". Trước khi tin `changed=0`, phải nhìn `entered` trước — đúng luật đã
  ghi ở mục BẪY ĐO LƯỜNG.
- **Dữ liệu prod trên đĩa KHÔNG dùng để xác nhận post-pass được:** `tmp/session-*/engine_instrumentation.jsonl`
  chỉ có `stage_resolved` / `repair` / `rescue` và có từ 2026-07-12, tức là TRƯỚC khi `instrumentPostPass`
  tồn tại. Quét 156 file trong `tmp/` cho 0 hit với MỌI tên post-pass — kể cả những pass chắc chắn có bắn.
- [x] **`ab-comparison.test.ts` + `stress.test.ts` đã tách khỏi vòng kiểm nhanh** (14/08, `cd55484`).
  `jest.config.js` loại đúng hai file đó; `jest.slow.config.js` = cùng config trừ dòng loại trừ, để
  `npm run sim:ab` / `npm run sim:stress` vẫn chạy mà không đẻ nguồn sự thật thứ hai.
- [ ] **Vùng gate đúng cho thay đổi đường live** = `unit/property/scenario/fairness` + `host-live` + `production-chain-timing` + `production-live-chain`. Phần simulation còn lại gọi thẳng `suggestNextRound`, KHÔNG đi qua `buildSuggestedMatchPayloads` → chạy 60 phút mà không phủ được gì.


## Trạng thái prod
- edge `session-plan-shadow` **v42** (deploy 14/08 10:03) — khớp nhánh, tham số đổi tên
  `max_round_runtime_ms` → `max_round_search_candidates`. Shadow, ngoài đường live.
- edge `session-live-matches-suggest` **v269, ALGO 78** (deploy 2026-08-14 08:49, status ACTIVE qua
  Management API). ⚠️ Chưa xác minh bằng `debug_dumps.engine_build.algorithm_version` của kèo thật —
  làm việc đó ở kèo đầu tiên sau deploy, cùng lúc đọc `timing_ms` để có số độ trễ Deno.
- Canary quality-cost **TẮT** — allowlist rỗng. **BẪY:** `SESSION_QUALITY_COST_MODEL` vẫn `="1"`;
  thứ giữ nó dormant là allowlist, KHÔNG phải master flag. Đừng đọc flag rồi kết luận "đang tắt".
- Nhánh `feat-quality-cost-model` đã push lên remote; P2-2 đã merge vào đây (ff `2b756d2` → `e741e0f`).
- `tsc` 0 · corpus với cờ optimizer TẮT ra đúng `board_hash f1b6d8ac0b0c` = đường cũ byte-identical.
- ⚠️ Gate KHÔNG phải 753/753 nữa: **2 test đỏ CÓ SẴN** trong `simulation/full-session.test.ts`
  (chuỗi nghỉ, gender preference) — đã A/B với `2b756d2`, đỏ y hệt TRƯỚC P2-2. Nhóm
  `production-chain-timing` / `Phase A` là assertion đồng hồ thật, đỏ khi máy tải nặng.


## BẪY ĐO LƯỜNG — đã trả giá nhiều lần, đọc trước khi tin bất kỳ con số nào

**Đóng băng đồng hồ trong harness = đo một đường mà prod không chạy.** `scratch/board-scorecard.ts` ghi
đè `Date.now`/`performance.now` ngay dòng đầu, nên mọi con số của nó xưa nay là đường "tìm kiếm đầy đủ",
còn prod thì bị deadline cắt. Đó là lý do baseline `f1b6d8ac0b0c` không đổi sau P2-5 dù hành vi prod đổi
hẳn. Có `REALCLOCK=1` để chạy với đồng hồ thật.

**Số không đổi sau khi đã sửa phép đo = phép đo KHÔNG CHẠY, không phải thay đổi vô tác dụng.**
Biến thể đã gặp: núm vặn không nối vào đâu (`force_budget_ms` nằm trong `Math.min`); nhiễu để lâu
thành chỗ trốn cho lỗi thật (16 lỗi lint rác che 1 lỗi thật); đo một tính năng đang TẮT rồi kết luận
về hiệu quả của nó (`blowoutRescue` chưa bao giờ được bật trong harness).

- Đếm bằng `limit` lớn trên PostgREST: nó cắt âm thầm. Dùng `Prefer: count=exact`.
- Mã thoát của `jest | grep` là của **grep**, không phải của jest.
- Đừng chạy gate song song với scorecard: máy tải nặng làm 9 suite host-live đỏ oan.
- Trước khi tin số của một pass: khẳng định nó CÓ CHẠY (counter `entered` > 0), và tách
  `entered` / `changed` / lý do từ chối.
- Test cũ đỏ không mặc định là "test lỗi thời": hai lần trong đợt này nó đang chỉ đúng bug thật.

## LỊCH SỬ

Nhật ký từng phiên (2026-08-08 → 2026-08-13), gồm cả bug flicker đã đóng và các đợt sàng lọc audit,
đã chuyển sang `docs/TASK_ARCHIVE_2026-08.md` để file này giữ đúng phần đang dùng. Không xoá gì.
