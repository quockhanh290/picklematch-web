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
| P2-5 | **bỏ wall-clock khỏi hot path** | **CHƯA — VIỆC TIẾP THEO.** 19 chỗ đọc đồng hồ; audit ghi "gần như xong sẵn" là SAI |
| P2-6 | gộp đường ghi hint | XONG |
| P2-7 | gộp rest bookkeeping | XONG SẴN (báo cáo gốc sai, chưa từng hỏng) |
| **P3** | xoá code chết | **CHƯA** — nhóm rủi ro ~0 làm được ngay: BUG #40, #33, #34, #39, `lib/scheduler/fixedTeamPairing.ts`. **MỚI: `repeatPool`/`repairPayloadBatchRepeatExposure` đã đo được là đổi 0 board ở đúng hình dạng nó sinh ra để xử** → hết "chưa đo được". ⚠️ Sáu post-pass cũ CHƯA xoá được: nhánh cờ-tắt còn dùng, chỉ xoá sau khi optimizer bật mặc định |
| **P4** | UI/UX (không chặn engine) | **CHƯA** — đáng nhất: gộp `playCostText` + `capacityInfoLines` thành một hàm thuần (lỗi hiển thị host thấy: "không đánh đổi gì" mâu thuẫn với "hai đội chênh nhau hơn bình thường") |

**Ngoài roadmap, đã xong trong hai phiên 13-14/08:** bug flicker (3 fix client, xác nhận trên kèo thật,
host QA xong) và bug "Gợi ý vừa cũ sau khi có trận kết thúc".

**Còn treo, không thuộc defrag:**
- 2 test đỏ `simulation/full-session.test.ts` (chuỗi nghỉ, gender preference) — đã A/B: đỏ có sẵn
  trước P2-2. Nhiều khả năng là triệu chứng của P2-5.
- Quyết định canary/deploy P2-2 — chờ host, không có hạn.
- Supabase trả HTTP 522 lúc cuối phiên 14/08 — kiểm dashboard nếu app hỏng.

---

## VIỆC TIẾP THEO — P2-5: bỏ wall-clock khỏi hot path (ưu tiên 1)

Prompt mở phiên (dán nguyên):

```
Làm P2-5: bỏ ngân sách-theo-đồng-hồ khỏi hot path của engine, thay bằng ngân sách đếm được.

Đọc TASK.md mục "RÀ SOÁT P2" và "P2-2 — XONG" trước. ĐỪNG đo lại những gì đã có số.

Vì sao đáng làm, bằng chứng đã có:
- 19 chỗ đọc Date.now()/performance.now() trong lib/next-round-suggester/ (ngoài board-optimizer).
  suggest.ts:601-602 cắt tìm kiếm theo deadline; pair.ts:772 break khi hết maxRuntimeMs.
- Đây là NỬA SAU của bug flicker: cùng bench, xin lại cùng sân ra đội hình khác
  (memory project-suggest-nondeterministic-search-budget).
- Nó làm nhiễu MỌI phép đo A/B: replay cùng một kèo hai lần cho hai kết quả khác nhau ở
  nhánh cờ-tắt (intra 2.42->2.84 lần một, 3.4->2.8 lần hai).
- Hai test đỏ có sẵn (simulation/full-session.test.ts: chuỗi nghỉ, gender preference) rất
  có thể là triệu chứng của chính nó — engine bị cắt tìm kiếm sớm khi máy chậm. Đã A/B với
  commit 2b756d2: đỏ y hệt trước P2-2, nên KHÔNG phải hồi quy.

Khuôn đã có sẵn để bắt chước: board-optimizer dùng trần SỐ VÒNG LẶP, không đọc đồng hồ, và
được đóng đinh bằng test tất định.

Thước đo: scratch/board-scorecard.ts (hash baseline f1b6d8ac0b0c với cờ optimizer TẮT).
Thay ngân sách xong thì hash SẼ đổi — đó là dự kiến; cái phải chứng minh là chất lượng không
tệ đi và hai test kia hết đỏ.

KHÔNG deploy. Prod đang ALGO 77.
```

### Trạng thái bàn giao (2026-08-14)

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

### Sau P2-5

- **P2-1**: chọn 1 model scoring (8 điểm rẽ nhánh còn sống) — chờ host chạy canary.
- **P3 xoá code chết**: nhóm rủi ro ~0 làm được ngay (BUG #40, #33, #34, #39, `fixedTeamPairing.ts`).
  **Thêm `repairPayloadBatchRepeatExposure`/`repeatPool`** — đã đo được là đổi 0 board ở đúng hình dạng
  nó sinh ra để xử (REFILL_BATCH=2), không còn là "chưa đo được".
  ⚠️ Sáu post-pass cũ CHƯA xoá được: nhánh cờ-tắt còn dùng. Chỉ xoá sau khi optimizer bật mặc định.
- **P4 UI/UX**: gộp `playCostText` + `capacityInfoLines` thành một hàm thuần (lỗi hiển thị host thấy).

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
| P2-5 mở rộng miền tất định | **19 chỗ đọc đồng hồ**; `suggest.ts:601` cắt theo `Date.now()`, `pair.ts:772` break khi hết `maxRuntimeMs` | **CHƯA — nhãn "gần như xong sẵn" trong audit là SAI** |
| P2-6 gộp đường ghi hint | đúng 1 call site `sync_live_suggestion_hints` | XONG |
| P2-7 gộp rest bookkeeping | migration `20260809000001` helper dùng chung | XONG SẴN (báo cáo gốc sai) |

**P2-5 nên là việc tiếp theo**, không phải P3. Lý do đo được ngay trong phiên này: replay cùng một kèo
hai lần cho hai kết quả khác nhau ở nhánh cờ-TẮT (intra 2.42→2.84 lần một, 3.4→2.8 lần hai). Engine
không tất định làm nhiễu MỌI phép đo A/B trên nó, và host thấy nó dưới dạng "cùng bench mà đội hình
khác" — nửa sau bug flicker.

**Gate:** 2 test trong `simulation/full-session.test.ts` (chuỗi nghỉ, gender preference) đỏ. **Đã A/B
với commit `2b756d2` trước toàn bộ P2-2 — đỏ y hệt**, nên là lỗi CÓ SẴN trên nhánh, không phải hồi quy.
Đáng đào vì nó nói engine đang thua ở hai chỉ số công bằng thật.


## NỢ DỌN DẸP (đừng để thành phân mảnh mới — đây chính là thứ audit đang đo)
- [ ] **2 RPC chết trên prod:** `sync_live_suggestion_metadata`, `sync_live_suggestion_degraded_fields` — từ edge v249 không ai gọi nữa. CỐ Ý giữ để còn đường lui nếu phải rollback edge. **Xoá sau vài ngày chạy ổn**, kèm kiểm lại `grep` trong `supabase/functions/` + client trước khi drop.
- [x] **`npm run typecheck` 936 lỗi → 0.** Ba việc, không cái nào vá triệu chứng:
  - **Gốc thật: `tsconfig.json` KHÔNG loại trừ `scratch/`** dù CLAUDE.md ghi là có → mọi file nháp bị typecheck. Tôi đã định sửa import trong 18 file scratch — **sai chỗ**. Sửa 1 dòng `exclude` (thêm `scratch/**/*`, `tmp/**/*`).
  - **File lạc `C:tmptest-suggest.ts`** ngay gốc repo từ 2026-06-20 (ai đó ghi ra `C:\tmp\...` trên Windows, shell tạo file tên đúng như vậy). `ls`/`Glob` KHÔNG thấy vì dấu hai chấm — phải dùng `tsc --listFilesOnly` mới lòi ra. Chuyển vào `scratch/` chứ không xoá vì nó untracked.
  - **4 script mồ côi** (`test-session-suggest`, `sim-per-court-beam`, `sim-beam-vs-greedy`, `eval-weights`) — không được `package.json` tham chiếu, type đã trôi. `git mv` sang `scratch/` (rename, hoàn tác 1 lệnh). `npm run diagnose` dùng `scripts/diagnose-session.ts`, khác hẳn, vẫn sạch.
- [~] **Backfill trong migration `20260809000001`: KHÔNG sửa, cố ý.** Đã kết luận không cần chạy (counter tự lành ở trận kế tiếp — xem `scratch/sim-session-p07.sql`). Nhưng migration đã APPLY và đã commit, mà quy ước dự án là **file migration bất biến sau khi merge**. Sửa kể cả comment cũng tạo tiền lệ xấu. Khối comment ở lại; ghi ở đây là ĐỦ để người sau biết không phải chạy nó.
- [x] **4 test `projected live match state`: ĐÃ XANH, không phải nợ.** Mục này từng ghi "lỗi thời từ ALGO 53, cần viết lại" — **SAI**. Chúng đỏ vì **bug thật** (fast-path gọi `makeAlternative` với `allowRecentGroupRematch` cố định false → sân trống khi 4 người rảnh duy nhất vừa đánh với nhau), và commit `95b2da5` (ALGO 58) đã sửa bằng retry relaxed. Chạy lại ở HEAD: **35/35 xanh**. Bài học: đừng mặc định "test cũ thì bỏ" — hai lần trong đợt này test cũ hoá ra đang chỉ đúng bug.
- [ ] **3 post-pass không bắn phát nào** (participation / blowoutPool / invariantGuard, đo ở §7.11). ⚠️ CHƯA ĐƯỢC XOÁ dựa trên sim — blowoutPool cần bench, invariantGuard cần plan đang tắt. Phải xác nhận trên `debug_dumps` prod trước.
- [ ] **`ab-comparison.test.ts` chiếm ~15+ phút** mỗi lần chạy full suite. Tách khỏi vòng kiểm nhanh; chỉ chạy khi thay đổi THỰC SỰ đụng lineup.
- [ ] **Vùng gate đúng cho thay đổi đường live** = `unit/property/scenario/fairness` + `host-live` + `production-chain-timing` + `production-live-chain`. Phần simulation còn lại gọi thẳng `suggestNextRound`, KHÔNG đi qua `buildSuggestedMatchPayloads` → chạy 60 phút mà không phủ được gì.


## Trạng thái prod
- edge `session-live-matches-suggest` **v268, ALGO 77** (xác minh qua `debug_dumps.engine_build.algorithm_version` của kèo thật, không phải suy đoán)
- Canary quality-cost **TẮT** — allowlist rỗng. **BẪY:** `SESSION_QUALITY_COST_MODEL` vẫn `="1"`;
  thứ giữ nó dormant là allowlist, KHÔNG phải master flag. Đừng đọc flag rồi kết luận "đang tắt".
- Nhánh `feat-quality-cost-model` đã push lên remote; P2-2 đã merge vào đây (ff `2b756d2` → `e741e0f`).
- `tsc` 0 · corpus với cờ optimizer TẮT ra đúng `board_hash f1b6d8ac0b0c` = đường cũ byte-identical.
- ⚠️ Gate KHÔNG phải 753/753 nữa: **2 test đỏ CÓ SẴN** trong `simulation/full-session.test.ts`
  (chuỗi nghỉ, gender preference) — đã A/B với `2b756d2`, đỏ y hệt TRƯỚC P2-2. Nhóm
  `production-chain-timing` / `Phase A` là assertion đồng hồ thật, đỏ khi máy tải nặng.


## BẪY ĐO LƯỜNG — đã trả giá nhiều lần, đọc trước khi tin bất kỳ con số nào

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
