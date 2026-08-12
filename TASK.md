## Task: Debug & tối ưu live-session + suggester (session f2fd04b4 + sweep audit)
Status: DONE (server-side đã live; chờ user rebuild app cho phần client)

Branch: feat-next-match-suggester (đã merge main). 12 commit: 9418d9d → c32ba67.
(Task cũ "Operation stabilization audit" → detail ở docs/OPERATION_STABILIZATION_AUDIT.md)

## P2-1 — `consecutive_play` bỏ khỏi cost model: CỐ Ý, và không tốn gì đo được

Codex đào lịch sử, kết luận **CỐ Ý** kèm bằng chứng tài liệu: `scripts/diagnostics/quality-cost-sim.ts:75`
ghi `restSpread` là *"selection-layer metric, untouched by this task"* — đợt hiệu chuẩn trọng số cố tình
để sức bền ở tầng chọn người, không đưa vào tầng chi phí.

Đo lại thay vì tin lập luận, 60 phiên, hai model:

| | model cũ | cost model |
|---|---|---|
| tổng max `consecutive_play` mỗi phiên | 168 | 168 |
| ghế cho người đã chơi ≥2 liên tiếp | 31.95% | 31.82% |

→ **Không cần thêm số hạng nào trước khi khai tử model cũ.**

⚠️ **Giới hạn của phép đo này, đừng bỏ qua:** lỗ hổng nằm ở đường forced/rescue (corrector đặt
`MUST_PLAY` khi rest_violation, required ids bị ép, forced rescue nới hết cờ, exhaustive fallback bỏ
`enforceRequired`). Trên corpus `forced_tradeoff` chỉ bắn **0.03%** — tức phép đo gần như KHÔNG chạm
đúng kịch bản đang hỏi. Đây là bằng chứng cho board bình thường, KHÔNG phải cho board bị ép.
- [ ] Kèo thật có board bị ép (sân lẻ, pool chật) là chỗ kiểm được điều này.

## SÀNG LỌC 51 MỤC BỊ RƠI — kết quả tới lúc này (2026-08-12)

16 mục HIGH. Đã kiểm:
| mục | trạng thái |
|---|---|
| `'both'` bị pass blowout bỏ qua | **LỖI THẬT — đã vá** (ALGO 74) |
| cờ degraded không thu hồi sau khi sửa | **LỖI THẬT — đã vá** (ALGO 75) |
| Stage 5.5 phát blowout không chặn | đã có guard `pair.ts:954` |
| bộ đếm nghỉ đọc cột DB cũ | đã đổi sang `rest_seat_misses` (`state.ts:259`) |
| fairness MUST_PLAY vượt mặt `deferLowViability` | **CHƯA KẾT LUẬN** — corrector tác động qua tier, không nạp vào required; hai cơ chế không biết nhau nhưng chưa chứng minh hậu quả |
| **`mustPlayAt` hằng số 1 trong khi `mustRestAt` co giãn** | **CÒN SỐNG, xem dưới** |

### `mustPlayAt: 1` — bất đối xứng làm tier MUST_PLAY mất khả năng phân biệt
`classify.ts:31-37`:
```
mustRestAt = max(2, 1 + ceil(benchDepth/2)) + presetRestBonus   ← co giãn theo băng ghế
mustPlayAt: 1                                                    ← hằng số cứng
```
`classify.ts:63`: `if (player.consecutive_rest >= mustPlayAt) return Tier.MUST_PLAY`

→ Nghỉ đúng MỘT vòng là thành `MUST_PLAY`. Băng ghế 16 người thì sau một vòng **cả 16 đều MUST_PLAY**,
tier không phân biệt được ai, trong khi required ids / quota guard hiểu MUST_PLAY là "buộc phải xếp".
Đây có thể là gốc chung của mấy triệu chứng đã gặp: pool required phình to, `deferLowViability` phải
liên tục hoãn người, và NO_VALID_MATCH giả khi bench > số ghế.

`mustRestAt` có comment giải thích công thức; `mustPlayAt: 1` **không có dòng nào**. Nhưng vắng comment
KHÔNG có nghĩa là lỗi (bài học hôm nay), nên **chưa sửa**.
**ĐÃ ĐO — GIẢ THUYẾT CỦA TÔI SAI, KHÔNG SỬA.** Chỉ **3.19%** người rảnh mang `consecutive_rest >= 1`,
không phải gần 100% như lập luận. Lý do có cấu trúc: `consecutive_rest` được suy ra là
`floor(rest_seat_misses / courtCount)` (`state.ts:259`), nên với 6 sân một người phải lỡ **6 lượt lấp
ghế** mới lên 1. Phép chia theo số sân **đã co giãn sẵn đầu vào** — hằng số `mustPlayAt: 1` không làm
tier phình to.

→ Bất đối xứng tồn tại trên mặt chữ nhưng **không có hậu quả đo được**. Đóng mục này, không sửa.
→ Lần thứ năm hôm nay một lập luận nghe rất hợp lý không sống sót qua phép đo. Khác bốn lần trước ở chỗ
   lần này tôi đo TRƯỚC khi sửa, nên không mất gì.

## PHÁT HIỆN VỀ QUY TRÌNH: bảng 43 bug LÀM RƠI phát hiện thật

Lỗi `'both'` tôi vá hôm nay (sân vừa lệch vừa lặp bị pass blowout bỏ qua) **đã nằm trong dữ liệu thô của
audit từ đầu**: `scratch/audit-final.json:400` ghi đủ cả ba dòng code và câu *"Type allows 'both'"*.
Nhưng nó **không lên bảng 43 bug** — rơi mất trong bước dedup/xếp hạng.

Thêm nữa, `tests/next-round-suggester/unit/blowout-pool-owed-guard.test.ts:11` đã ghi chú sẵn *"This pass
never acts on the replay corpus, because it needs degraded_reason === 'blowout' and those boards do not
carry it"* — tức hiện tượng đã được quan sát, chỉ chưa ai nối hai mảnh lại.

→ Bảng 43 **không phải tập đầy đủ** các phát hiện. Quét lại `scratch/audit-final.json` có thể còn phát
hiện thật khác bị rơi.
- [ ] Đối chiếu `audit-final.json` với bảng §5.1: mục nào trong thô mà không có trong bảng?
- [ ] Ưu tiên các mục có `evidence` trích dẫn dòng code cụ thể — đó là loại đã được kiểm, không phải suy đoán.

## P2-2 — ĐO NỀN (2026-08-11, ĐÃ SỬA LẠI SAU KHI PHÁT HIỆN HARNESS TẮT TÍNH NĂNG)

### ⚠️ Kết luận đầu tiên của tôi SAI — đã rút lại
Tôi báo "3 pass không đổi board lần nào, `blowoutPool` vào 2762 lần / đổi 0". **Sai**: harness
`board-scorecard.ts` **chưa bao giờ truyền `blowoutRescue: true`**, mà cờ đó gate cả khối phát hiện
degraded → `degraded_reason` luôn rỗng → `blowoutPool` thoát ở cửa thứ hai, **chưa từng chạm một guard
nào**. Tôi đo một tính năng **đang tắt** rồi kết luận về hiệu quả của nó.

Chính counter tôi thêm mới phơi ra: **không một counter từ chối nào bắn**. Nếu chỉ nhìn "0 lần đổi" thì
tôi đã đi xoá ba pass.

**Đây là lần thứ TƯ trong ngày cùng lớp lỗi** — nhầm thứ đo được với thứ muốn biết: (1) board hash không
đổi vì trường không bao giờ được đặt; (2) gộp `entered` với `changed`; (3) nói quá về ý nghĩa của
`entered`; (4) đo với tính năng tắt. Điểm chung: **tin con số trước khi kiểm đường code có chạy không.**

### Số THẬT, sau khi bật `blowoutRescue: true`
| | |
|---|---|
| `blowoutPool:changed` | **68** |
| từ chối: `intraCap` | **6773** |
| từ chối: `mayReplace` | 1640 |
| từ chối: `noImprovement` | 1459 |
| từ chối: `nearLevelPeer` | 782 |
| từ chối: `wouldCreateRepeat3` | 365 |
| từ chối: đã trong tolerance | 50 |

→ **`blowoutPool` KHÔNG vô dụng**, nó sửa 68 board. Cửa ải chính là **trần intra 1.0** — cân tổng hai đội
buộc phải ghép mạnh+yếu, mà thế là vượt trần. Không xoá pass này.
### Đã kiểm điều kiện tiên quyết của hai pass còn lại — hai kết luận KHÁC HẲN nhau
- **`participation`**: chạy khi `liveCourtIdxs.size === 0 && effectiveCount >= 2` (`:5716`), tức **gợi ý
  cả bàn cùng lúc** — đúng là cú lấp đầu mỗi phiên trong harness. 60 lần vào đó **đúng kịch bản nó sinh
  ra**, nên "0 đổi" là bằng chứng thật. Vẫn chưa biết điều kiện BÊN TRONG nó có thoả không.
- **`repeatPool`**: comment tại `:5722-5724` ghi rõ *"Needs ≥2 courts in one request **and a live board**
  for the steal to occur"*. Harness chỉ yêu cầu ≥2 sân **đúng một lần, lúc bàn còn trống** (`live = []`);
  mọi lần lấp sau đều MỘT sân. Nên 60 lần vào đều ở tình huống nó không thể giúp, còn tình huống nó được
  sinh ra để xử — lấp nhiều sân TRONG LÚC có sân đang chạy — **chưa bao giờ xảy ra**.
  → **KHÔNG kết luận được gì về `repeatPool` từ corpus này.**
- [x] **Đã thử sửa harness (`MULTI=1`) — KHÔNG ĂN, và lý do sâu hơn một công tắc.** Vòng replay hoàn
      thành MỘT sân rồi lấp lại ngay trong cùng vòng lặp, nên tại mọi thời điểm chỉ có đúng một sân
      trống; điều kiện `idle.length > 1` không bao giờ đúng. Muốn có ≥2 sân trống cùng lúc phải để vài
      sân xong TRƯỚC khi lấp — tức đổi cấu trúc vòng replay, không phải thêm cờ.
- [ ] **`repeatPool` vẫn KHÔNG kiểm được.** Không được kết luận nó vô dụng. Hai đường còn lại: đổi cấu
      trúc replay (tốn, và làm harness lệch xa hành vi thật hơn), hoặc lấy `debug_dumps` từ kèo thật.
      **Ưu tiên đường thứ hai** — nó đo đúng thứ đang chạy.

### Quy tắc rút ra hôm nay, đã trả giá 3 lần
**Số liệu KHÔNG ĐỔI sau khi vừa đổi cách đo = dấu hiệu phép đo không chạy, KHÔNG phải dấu hiệu thay đổi
vô tác dụng.** Ba lần hôm nay công cụ hỏng mà vẫn in ra kết quả trông hợp lệ: `rg` không tồn tại nên báo
mọi symbol đã biến mất (kể cả hàm vừa sửa một tiếng trước); anchor khớp nhầm hàm nên counter rơi sai chỗ;
assertion chết nhưng script vẫn chạy tiếp và in số của đường cũ. Cả ba lần đều chỉ bắt được nhờ con số
trùng khít tới từng đơn vị — nếu lệch một chút thì đã tin là kết quả mới.
- [ ] ⚠️ Mọi số đo trước đó hôm nay đều lấy với rescue TẮT, gồm cả bảng so P2-1. Đang chạy lại cả hai vế.

## P2-1 — `consecutive_play` bỏ khỏi cost model: CỐ Ý, và không tốn gì đo được

Codex đào lịch sử, kết luận **CỐ Ý** kèm bằng chứng tài liệu: `scripts/diagnostics/quality-cost-sim.ts:75`
ghi `restSpread` là *"selection-layer metric, untouched by this task"* — đợt hiệu chuẩn trọng số cố tình
để sức bền ở tầng chọn người, không đưa vào tầng chi phí.

Đo lại thay vì tin lập luận, 60 phiên, hai model:

| | model cũ | cost model |
|---|---|---|
| tổng max `consecutive_play` mỗi phiên | 168 | 168 |
| ghế cho người đã chơi ≥2 liên tiếp | 31.95% | 31.82% |

→ **Không cần thêm số hạng nào trước khi khai tử model cũ.**

⚠️ **Giới hạn của phép đo này, đừng bỏ qua:** lỗ hổng nằm ở đường forced/rescue (corrector đặt
`MUST_PLAY` khi rest_violation, required ids bị ép, forced rescue nới hết cờ, exhaustive fallback bỏ
`enforceRequired`). Trên corpus `forced_tradeoff` chỉ bắn **0.03%** — tức phép đo gần như KHÔNG chạm
đúng kịch bản đang hỏi. Đây là bằng chứng cho board bình thường, KHÔNG phải cho board bị ép.
- [ ] Kèo thật có board bị ép (sân lẻ, pool chật) là chỗ kiểm được điều này.

## P2-2 — ĐO NỀN: pass nào còn đổi board (2026-08-11)

Trước khi gộp 7 post-pass thành một optimizer, phải biết cái nào còn làm việc. Đếm qua kênh instrument
sẵn có (`instrumentPostPass` phát `entered` khi pass được XÉT, `changed` khi nó ĐỔI board), 60 phiên /
3088 trận, chạy cả hai model:

| pass | model cũ | cost model |
|---|---|---|
| `joint` (chỉ cờ ON) | — | **60 đổi** |
| `early` | 58 đổi | 54 đổi |
| `swap` | — | **2 đổi** |
| `blowoutPool` | **2762 vào / 0 đổi** | **2762 vào / 0 đổi** |
| `participation` | 60 vào / 0 đổi | 60 vào / 0 đổi |
| `repeatPool` | 60 vào / 0 đổi | 60 vào / 0 đổi |

⚠️ **TÔI ĐÃ NÓI QUÁ Ở ĐÂY, Codex bắt được.** `blowoutPool:entered` chỉ chứng minh **băng ghế không
rỗng** (`live-preview.ts:5740`) — KHÔNG chứng minh có sân nào cần cứu. Nên câu "điều kiện tiên quyết đã
thoả 2762 lần và pass vẫn từ chối" là **sai**: 2762 lần đó có thể phần lớn là board chẳng có sân nào
lệch để mà cứu. Lại đúng lỗi nhầm *tín hiệu đo được* với *điều muốn biết* — lần thứ ba trong ngày, và
lần này ngay sau khi tôi vừa cảnh báo Codex về đúng nó.

**Và việc đào tiếp đã tìm ra lỗi thật**: pass lọc `degraded_reason === 'blowout'` ở HAI chỗ, trong khi
sân vừa lệch vừa lặp mang nhãn `'both'` → **các sân tệ nhất bị bỏ qua hoàn toàn**. Đã vá (ALGO 74).
Để biết 3 pass kia vô dụng hay bị guard chặn, cần counter tách riêng: có payload blowout thật không,
qua `mayReplace` không, qua `hasNearLevelPeer` không, qua ngưỡng cải thiện không.

**Bẫy suýt dính:** lần đếm đầu tôi gộp `entered` và `changed` → `blowoutPool` hiện 2762 trông như pass
mạnh nhất hệ thống. Nhầm *tín hiệu đo được* với *điều muốn biết* — cùng lỗi với cái bẫy im lặng, ngược
chiều.

### Hệ quả cho P2-2
- Không phải "gộp 7 pass". Chỉ **3 pass thật sự đổi board**: joint, early, swap.
- Ba pass pool là ứng viên **XOÁ**, không phải gộp.
- [ ] ⚠️ **Chưa xoá.** Corpus không phải production: luôn bắt đầu từ trắng, không có check-out giữa
      chừng, không có huỷ trận. Phải kiểm trên `debug_dumps` prod xem chúng có từng `changed` ngoài thực
      tế không — cần kèo thật.
- [ ] Nếu prod cũng 0: kiểm xem guard của `blowoutPool` (`mayReplace`, `hasNearLevelPeer`) có phải lý do
      nó luôn từ chối không — vì "pass vô dụng" và "pass bị guard chặn quá chặt" là hai kết luận rất khác.

## CHỜ HOST DUYỆT — chữ accessibility (pilot #42, commit `93ffaf9`)

Pilot gắn nhãn cho thẻ trận gợi ý (`ScreenComponents.tsx`) — màn hình host bấm nhiều nhất. **Chưa nhân
ra các màn hình còn lại**, vì mục đích của pilot là chốt cách đặt chữ trước: nhãn sai còn tệ hơn không
nhãn, trình đọc màn hình sẽ đọc nó với sự tự tin tuyệt đối.

Mẫu chữ cần duyệt:

| nút | nhãn |
|---|---|
| Chơi luôn | `Chọn chơi luôn trận sân 3` |
| Chờ sân | `Chọn chờ sân 2 hoặc 5 xong cho sân 3` |
| Đổi phương án | `Chọn đổi phương án trận sân 3: ít lặp hơn` |
| Đổi một người | `Đổi Nguyễn Văn A ở sân 2` |
| Bắt đầu (đang bận) | `Đang bắt đầu trận sân 3` |
| Bắt đầu (đang tạo lại) | `Đang tạo lại gợi ý cho sân 3` |
| Bắt đầu (bị khoá) | `Chờ sân 3 xong trước khi bắt đầu lineup thay thế` |

Hai quy tắc pilot áp dụng, host xác nhận có giữ không:
- [ ] **Kèm số sân / tên người** — vì cùng một nút lặp mỗi sân; "Bắt đầu" đọc 6 lần thì vô dụng.
- [ ] **Trạng thái bị khoá cũng có nhãn** thay vì im lặng, để lý do không bấm được là nghe thấy được.
- [ ] Duyệt xong → nhân ra: host-match, host-live, rồi phần còn lại (376 touchable toàn repo).

## P2-1 — CANARY COST MODEL (host chốt 2026-08-11)

### Số đo trên corpus 60 phiên — BẢNG ĐÃ SỬA (rescue BẬT)
⚠️ Bảng đầu tiên tôi đưa host đo với `blowoutRescue` **TẮT** (harness chưa bao giờ truyền cờ đó). Bảng
dưới là số thật, cả hai vế cùng điều kiện.

| | model cũ | cost model | (bảng cũ, sai) |
|---|---|---|---|
| avg cost | 2.6475 | **2.427** | 2.8057 → 2.4681 |
| over-tol | 12.5% | **9.36%** | 13.54 → 9.72% |
| blowout | 1.17% | **1.04%** | 3.30 → 1.81% |
| play-spread | 1.35 | **1.30** | 1.433 → 1.367 |
| worst-rest | 1.8 | **1.733** | 1.767 → 1.750 |
| intra>1 | **19.3%** | 24.81% | 19.66 → 25.87% |
| repeat3 | **11.63%** | 12.6% | 11.53 → 12.34% |
| **panel** | **7.19%** | **23.09%** | 6.93 → 15.61% |
| — `forced` | **0%** | **11.14%** | 0.03% → 0.03% |
| `blowoutPool` đổi board | 68 | 31 | — |

**Hai điều tôi đã báo cáo SAI, nay sửa:**
1. **Mối lo panel là ĐÚNG; "đính chính" của tôi mới sai.** `forced_tradeoff` là **0% ở model cũ, 11.14%
   ở cost model** → ~11 trong 16 điểm chênh panel là **tính năng chỉ tồn tại khi bật cờ**, không phải
   model hỏi nhiều hơn. Lần trước tôi đo được 0.03% và tuyên bố mối lo vô căn cứ — số đó lấy với rescue
   TẮT. Phần thật sự do model là `choices` 7.19 → 15.84% (~8.6 điểm).
2. **Lợi thế blowout bị tôi thổi phồng**: không phải 3.30 → 1.81% mà là **1.17 → 1.04%**, gần như ngang,
   vì khi bật rescue thì pass sửa blowout của model cũ chữa 68 board còn cost model chỉ 31.

Phần KHÔNG đổi: cost model vẫn ghép cân hơn (over-tol, avg cost) và công bằng nhỉnh hơn cả hai trục,
đổi lại intra +5.5pp.

→ Canary vẫn là quyết định đúng, nhưng thứ cần cảm nhận không phải "panel gấp đôi" mà là: **cứ ~9 trận
thì có 1 trận bị hỏi một câu quyết định mà model cũ không bao giờ hỏi.**

### Trạng thái cờ trên prod (đã kiểm 2026-08-11)
- `SESSION_QUALITY_COST_MODEL = "1"` (Management API trả **hash SHA-256**, phải dò ngược mới đọc được).
- `SESSION_QUALITY_COST_SESSION_IDS` = một id cụ thể, **không phải `*`**, và **không khớp** session nào
  trong 246 phiên gần nhất → canary cũ đã chết.
- `resolveQualityCostEnabledForSession` đòi cờ='1' **VÀ** session nằm trong allowlist → **hiện tắt với
  mọi phiên đang tồn tại**.

### Hai thứ tìm ra khi kiểm kê bề mặt khai tử (Codex quét, tôi kiểm)
- **Panel KHÔNG phải do tính năng bị gate.** `forced_tradeoff`/`wait_rescue_options` chỉ dựng khi cờ bật
  (`live-preview.ts:5383`), nên tôi nghi phần lớn chênh lệch panel là "có tính năng vs không có". Đo tách
  ra: **forced 0.03%, choices 15.61%** → gần như toàn bộ đến từ `tradeoff_choices`, thứ CẢ HAI model đều
  dựng (khác luật, `live-preview.ts:3601`). **Bảng số ban đầu đúng; mối lo của tôi sai.** Panel tăng thật.
- **`consecutive_play` không có trong cost model.** `quality-cost.ts` không có số hạng nào; nhánh cost
  không set `consecutive_play_penalty`. **Không có test/comment nào chốt là chủ ý** — khác rào tolerance
  vốn có test kèm lý do. Sức bền vẫn được xử ở tầng chọn người (`classify.ts:69,75` → `MUST_REST`), nên
  lỗ hổng hẹp: chỉ lộ khi tier bị nới (rescue path, tier override) — lúc đó model cũ vẫn ngại chọn người
  mệt qua điểm, cost model thì không.
  - [ ] **CHƯA SỬA, cố ý**: thêm số hạng vào model ngay trước canary là đổi đúng thứ sắp được đo.
        Quyết sau khi có kết quả canary.

### Các bước chạy canary
- [ ] Host tạo kèo, đưa `session_id`.
- [ ] `node scratch/cost-canary.mjs <session_id>` — đặt allowlist đúng một id đó. Mọi phiên khác vẫn model cũ.
- [ ] Chạy hết kèo. Thứ cần cảm nhận: **tần suất bị hỏi ý** (dự kiến ~1/6 trận), và trận có cân hơn không.
- [ ] Rollback bất cứ lúc nào: `node scratch/cost-canary.mjs --off`.
- [ ] Sau kèo, đối chiếu bằng `debug_dumps`: tỉ lệ panel thực tế so với 15.61% của corpus.
- [ ] ⚠️ **KHÔNG đặt allowlist = `*`** — đó là cái bẫy đã làm hỏng đợt rollout plan trước (xem
      [[project-plan-consumption-disabled]]).

## VIỆC TỒN — cần kèo thật hoặc cần host (chốt 2026-08-11)

### #15 — rest bookkeeping: ĐÃ ÁP PROD, CHƯA CHẠY LẦN NÀO
Bookkeeping cũ chỉ chạy khi **cả vòng** xong trên mọi sân; sân lệch nhịp thì điều kiện đó không bao giờ
đúng → `consecutive_rest`/`consecutive_play` đứng im → engine tính công bằng trên số liệu chết. Migration
`20260809000001` chuyển sang đếm theo **từng trận kết thúc** (`rest_seat_misses`), dùng chung một helper
`apply_live_match_rest_bookkeeping_event` cho cả `complete_` lẫn `cancel_`.

**Chưa có một dòng dữ liệu nào chứng minh nó chạy đúng**: `rest_seat_misses > 0` ở 0/5657 hàng, vì trận
mới nhất trong DB là 2026-08-08 còn migration áp sau đó.

- [ ] Sau kèo thật đầu tiên, chạy: `select count(*) filter (where rest_seat_misses > 0), count(*) from public.session_player_state where session_id = '<id>'` — phải khác 0.
- [ ] Đối chiếu `consecutive_rest` với số lần thật sự ngồi ngoài của vài người (chia cho số sân).
- [ ] Nếu sai: triệu chứng là ưu tiên lệch — có người bị bench quá lâu hoặc chơi quá nhiều. Không crash.

### #14 — ưu tiên theo chu kỳ sân: CỐ Ý, nhưng corpus không nhìn thấy ca gốc
Host chốt quay về `last_played_round` (chu kỳ per-sân) sau khi đo hai cỡ mẫu: dùng `last_played_seq`
(vị trí toàn phiên) tốn intra +1.8/+2.5pp và repeat3 +1.8/+1.75pp, mà `play-spread` **bằng nhau đến chữ
số**. Tức vị trí phiên tốn chất lượng ghép mà không mua được công bằng nào đo được.

**Giới hạn của phép đo**: mọi phiên trong corpus bắt đầu từ trắng, nên nó đo lệch-nhịp **tích luỹ trong
một lượt replay**, KHÔNG phải phiên **nạp lại giữa chừng từ DB** với hai bộ đếm đã lệch xa — đúng ca mà
BUG #14 xuất phát.

- [ ] Sau một kèo thật có sân trôi lệch nhịp rõ (chênh ≥3 vòng), dump state rồi so hai cách xếp trên
      cùng dữ liệu đó.
- [ ] Nếu ngược lại: chỗ ghi quyết định là header `tests/next-round-suggester/unit/last-played-ordering.test.ts`
      — sửa ở đó trước, test đang pin cả ca "trông có vẻ ngược".

### #42 — accessibility: chưa làm vì cần người duyệt chữ, không vì khó
376 touchable thiếu `accessibilityLabel`; trình đọc màn hình không đọc được gì hữu ích.

- [ ] Giao Codex quét theo đợt, mỗi đợt một màn hình, KHÔNG làm một phát cả 376.
- [ ] **Nhãn sai còn tệ hơn không nhãn** — host phải duyệt chữ tiếng Việt cho từng nhóm nút trước khi merge.
- [ ] Ưu tiên màn hình host dùng nhiều nhất: next-round-v2, host-match, host-live.

## Phiên 2026-08-11 (đóng nốt cụm round_no) — **ĐÃ DEPLOY edge v256, ALGO 66** + migration prod
- [x] **BUG #7 chỗ engine cuối** (`c92dd95`): `last_rest_started_round` dựng từ `last_played_round + 1` (đếm per-sân) nhưng `comparePlayersByPriority` đem **so giữa hai người** → người ngồi không từ đầu ở sân chậm thua người vừa ngồi xuống ở sân nhanh, sai đúng lúc board lệch nhất. Thêm `last_rest_started_seq` theo thang toàn phiên, có fallback. Test đỏ trước.
- [x] **BUG #5** (`8a3e42d`, migration `20260811000001` **ĐÃ APPLY PROD**): guard "đã chơi vòng này" khoá theo `v_round_no` của batch trong khi INSERT khoá **per-sân** → sai cả hai chiều. Sân A xong vòng 5, sân B xong vòng 1 → `v_round_no`=6, insert A=6/B=2: người vừa xong vòng 6 ở A **bị chặn oan** khi ngồi B; chính người đó đã có vòng 2 ở B thì **lọt**. Khớp khoá lại thì nhánh này bất khả đạt (insert round = max completed sân đó + 1) nên **xoá** thay vì viết code chết. Không ai chơi 2 lần: hàng này là `suggested` chứ không phải `live`, và path start giữ guard per-sân riêng.
  - Xác minh prod bằng transaction rollback (`scratch/verify-bug5-transaction.sql`): trước REJECTED, sau PERSISTED `round_no=2`, control người-đang-live và trùng-người-trong-batch vẫn chặn, `leaked: 0`.
  - **Giữ NGUYÊN VĂN câu lỗi** dù nhánh đã xoá: client bám chuỗi đó ở `useLiveBoard.ts:2905`, và **bản app cũ ngoài thực địa cũng bám** — đổi chữ là bản cũ mất đường invalidate.
- [x] **`fairness/metrics.ts` — QUYẾT ĐỊNH KHÔNG SỬA**, pin bằng 2 test (`4114323`). Xem mục ⚠️ ngay dưới.
- [x] **#7 là NO-OP trên corpus** — baseline chạy trong worktree `../pm-baseline` cho **đúng cùng** `board_hash ee1f348ae561` và cùng từng con số. Lý do: harness dựng `PlayerSessionState` bằng tay, `last_played_seq` luôn undefined nên nhánh tie-break **không hề chạy**. Đo mà đường code không chạy thì không kết luận được gì — kể cả "không hồi quy". (Tôi đã lỡ nói "board đổi thật" dựa trên `dc04189a0fa2` từ lần chạy harness khác — sai, không so được.)
- [x] **BUG MỚI, do chính bản vá #14 của tôi đẻ ra** (`live-preview.ts`): `buildProjectedStateAfterLiveMatch` bump `last_played_round` nhưng **bỏ quên `last_played_seq`**, nhánh nghỉ chưa bao giờ đặt `last_rest_started_*`. Từ khi `select.ts` **ưu tiên** seq, người vừa được chiếu là đã chơi vẫn mang seq cũ từ DB → trông như lâu chưa chơi → **được ưu tiên chơi tiếp**, ngay trong batch lấp nhiều sân. Đúng cái đảo-ưu-tiên mà #14 đặt ra để sửa. Test đỏ: `Expected "b-waiting", Received "a-just-played"`.
- [x] **Lỗi thiết kế thứ hai của tôi, cùng gốc:** `a.last_played_seq ?? a.last_played_round` đọc từng vế **độc lập** → một bên có seq, bên kia không thì đem số-thứ-tự-phiên so với số-vòng. Người chưa chơi trận nào trong phiên là **không có seq**, nên ca này là bình thường chứ không hiếm. Luật đúng: **cả hai vế có seq thì dùng seq, không thì cả hai dùng round** (`pickComparableScale`).
- [x] **BUG #6 ĐÓNG** (`2106786`, migration `20260811000002` **ĐÃ APPLY PROD**): guard same-round ở **cả hai** đường start so `round_no` mà không hỏi sân nào đánh số. Đường payload **có** tính `v_round_no` per-sân rồi vứt đi bằng cách so với hàng của mọi sân (lượt trước Codex báo đường này "đã đúng sẵn" — sai). Khác phía persist, guard này **KHÔNG xoá** (hàng thành `live`, ca double-play là thật), chỉ thu hẹp về đúng sân bằng `is not distinct from`. Transaction rollback trên prod: trước REFUSED, sau STARTED, hai control vẫn chặn, `leaked: 0`.
  - **Lấy định nghĩa đọc từ prod về rồi đổi đúng 1 dòng mỗi hàm.** Codex nộp bản **viết lại nguyên hàm bằng tay** kèm dòng `perform p_expected_live_state_version;` tự chú "cố ý bỏ CAS" — không dùng, viết tay kiểu đó đánh rơi hành vi mà không ai thấy.
- [x] **ĐẢO ưu tiên seq — HOST CHỐT** (`211bc37`, ALGO 67, **ĐÃ DEPLOY edge v257**). Đo trên corpus, hai cỡ mẫu:

  | | chu-kỳ-sân | vị-trí-phiên |
  |---|---|---|
  | intra>1 | 19.66% | 22.12% (30 phiên: 20.33 vs 22.17) |
  | repeat3 | 11.53% | 13.28% (30 phiên: 11.71 vs 13.55) |
  | play-spread | 1.433 | 1.433 — **bằng nhau** |

  Hai mẫu đồng chiều; chính phép đo đó lặp ở hai cỡ chỉ dao động ≤0.67pp. **Vị trí phiên tốn chất lượng ghép mà không mua được công bằng nào đo được** → quay về chu kỳ sân. Giữ cột `last_played_seq` + projection duy trì nó; **xoá** `last_rest_started_seq` (chỉ sinh ra cho comparator vừa đảo).
  - ⚠️ Corpus **không nhìn thấy** ca gốc của #14: mọi phiên bắt đầu từ trắng, nên nó đo lệch nhịp tích luỹ trong replay, KHÔNG phải phiên nạp lại giữa chừng từ DB với hai bộ đếm đã lệch xa. Đo được ca đó mà ngược lại thì xem lại `tests/.../unit/last-played-ordering.test.ts` — quyết định ghi ở đó.
- [x] **Scorecard trước giờ MÙ một nửa**: chỉ đo chất lượng ghép, không đo công bằng. Đã thêm `play-spread` (chênh số ván max-min) + `worst-rest`. Không có hai chỉ số này thì mọi thay đổi ràng buộc AI được ngồi đều **trông như hồi quy thuần tuý** — chính chúng biến lần đo này từ phỏng đoán thành kết luận.
- [x] **`test:gate` / `test:slow`** (`3ec66c5`): 93 file phủ đường live (~7 phút, không có `ab-comparison`) tách khỏi 11 file simulation. Task này giao Codex nhưng job **bị kill** không ra output, tự làm.

### ⚠️ VỊ TỪ `last_played_seq` KHÔNG PHẢI THUỐC CHỮA MỌI CHỖ round_no
Codex sửa `computeRestFairness` theo đúng khuôn `seq` đã dùng ở `select.ts`. Test của nó **đỏ thật** khi gỡ fix, suite xanh. Nhưng tôi tự dựng thêm ca thì nó **hồi quy**:

| ca | code cũ (`round_no`) | bản `seq` của Codex |
|---|---|---|
| sân lệch nhịp (test Codex) | ✗ | ✓ |
| cùng nhóm vòng trước đánh lại, 1 người vẫn nghỉ | ✓ | ✗ |

Gốc: `latestTrackedSeq` tra **trạng thái hiện tại** của người trong vòng đã track → họ đánh tiếp là mốc tự nhảy lên bằng `latestPlayerSeq`, `latestPlayerSeq > latestTrackedSeq` thành false, **phép nới tắt hoàn toàn** ở ca thường gặp nhất. Đã hoàn nguyên, xoá test của Codex, giữ 2 test của tôi làm rào.
→ **Fix đúng cần DỮ LIỆU chứ không phải phép so khác**: `RoundRecord` phải mang `sequence_no` của các trận trong vòng, thì "đã được `state.rounds` phủ" mới là sự thật thay vì suy đoán. Đó là thay đổi snapshot, chưa làm.
→ Bài học chung: **khuôn mẫu đúng ở chỗ này không tự đúng ở chỗ khác.** Mỗi lượt Codex xong phải tự dựng ca ngược lại, không chỉ chạy suite.

### ⚠️ Vùng gate: đừng chạy `tests/next-round-suggester` nguyên cụm
Chạy full = 60 phút (chủ yếu `ab-comparison`), và phần simulation **không đi qua** `buildSuggestedMatchPayloads` nên không phủ được đường live. Vùng đúng cho thay đổi đường live (đã dùng phiên này, **717/717 xanh**, ~7 phút):
`npx jest tests/next-round-suggester/{unit,property,scenario,fairness} tests/host --runInBand`

### ⚠️ `String.replace` với chuỗi thay thế chứa `$`
Ghép migration vào harness SQL bằng `harness.replace(marker, migration)` làm hỏng file **im lặng**: `$function$` trong chuỗi thay thế bị đọc là pattern thay thế, phần còn lại của file bị nhân đôi, Postgres báo `mismatched parentheses` cách chỗ hỏng 300 dòng. Dùng `split`/`join`. Và **migration kết thúc bằng `$function$` không có `;`** → câu lệnh kế tiếp bị nuốt vào thân hàm (`syntax error at or near "do"`). Codex đang dựng guard CI cho đúng hai thứ này.

## Phiên 2026-08-10 (đóng P0 + đào cụm round_no) — prod edge v252, ALGO 63 CHƯA deploy
**P0 đóng hoàn toàn 8/8.** Bug CONFIRMED đã đóng: 29/43.

- [x] **P0-8** (Codex, `4ef0449`): `buildRelaxedTierOverrides` xoá tag FLEXIBLE của `deferredRequiredIds` → rescue đòi lại đúng người vừa defer, undo ALGO 37/48/54. Fix 1 dòng. Tôi tự chứng minh lại test đỏ khi gỡ fix.
- [x] **P0-4** (`7ce501e`): `BlowoutFromPool` thiếu guard công bằng `mayReplace` mà pass anh em đã có → cân sân bằng cách bench người chờ lâu nhất. Dùng lại đúng guard đó, không đẻ luật mới. **Dựng test đỏ mất 3 lần thử** — hai ngõ cụt: `hasNearLevelPeer` chặn trước, rồi trần intra 1.0 chặn trước. Phải chỉnh dải trình để cú hoán đổi hợp lệ mọi trục TRỪ công bằng.
- [x] **BUG #14** (`79393ed`, migration `20260810000001`): `last_played_round` lưu round per-sân, `select.ts` sắp tăng dần → **ưu tiên ngược** khi sân lệch nhịp. Cột mới `last_played_seq` từ `sequence_no` (duy nhất 139/139 phiên, tương quan 0.886 với thời gian). Migration lấy định nghĩa prod + thêm 1 dòng.
- [x] **BUG #13** (`c6cc431`, migration `20260810000002`): `closable_rounds` đòi `bool_and(completed)` → vòng dở BIẾN MẤT khỏi snapshot cùng các trận đã xong → `state.rounds` thủng → engine quên trận vừa đánh. **Phần 2 mới làm phần 1 an toàn:** `round_players` phải đếm cả người trên sân live, không thì họ bị liệt vào `resting` khi đang chơi.
- [x] **Guard recency** (`baa5c70`, ALGO 63): `getRecentRepeatCost`/`hasRecentGroupRematch` tính `distance = roundNo - round.round_no` rồi bỏ khi ≤0 → trận đã xong trên sân chạy nhanh hơn bị coi là "tương lai" và **bỏ qua hoàn toàn**. Đo: fill giữ 100%, repeat3 13.59→13.29 (dưới ngưỡng phân giải 1.5pp, nên chỉ chứng minh KHÔNG hồi quy).
- [x] **Dọn 197 dòng `live` treo** (62 dòng khoá người trong kèo còn `playing`; `a1cef762` khoá 24 người, 0 trận xong). Transaction thử **bắt được lỗi**: điều kiện "có trận nào cũ hơn 4h" sẽ đóng nhầm 14 kèo đang nghỉ giữa vòng → siết thành "trận MỚI NHẤT cũ hơn 4h".
- [ ] **CHƯA DEPLOY ALGO 63** — Codex đang giữ `lib/` cho BUG #9. Gom deploy khi nó xong.
- [ ] **Còn lại:** #4/#5/#6/#7 (phần chưa đóng của cụm round_no), #9 (Codex đang làm).

### Hai bug tìm được TỪ DỮ LIỆU, không cần kèo mới
- **`started_at` = `created_at`** (chênh trung vị 0.0s trên 4912 trận) → tính năng "Chờ Sân X" sắp theo **thứ tự được gợi ý**, không phải sân nào sắp xong. Lời khuyên không có thông tin đằng sau. CHƯA SỬA.
- **Thời lượng trận KHÔNG DÙNG ĐƯỢC**: 69% trận có "thời lượng" dưới 1 phút, trung vị 24 giây. Mọi phân tích dựa vào nó đều vô nghĩa — tôi đã rút lại một bộ số chi phí drain vì lọc bỏ 69% dữ liệu rồi báo cáo 31% còn lại như thực tế.

### ⚠️ BẢNG RÀ TRẠNG THÁI DO AGENT SINH RA ĐÃ SAI 2 LẦN
- Lần 1: xếp #13 là HIGH, audit ghi MEDIUM.
- Lần 2 (bảng 43 bug, `task-mso1oj5i`): xếp **#9 CHƯA SỬA** trong khi đã commit `3fc3631` + test riêng, và **#16 CHƯA SỬA** trong khi `findMinCostFoursome` chấm bằng `scoreMatch` (tự rẽ theo cờ) từ đợt "hướng 3" — `forced-tradeoff.ts:144`. Hai mục kiểm, hai mục sai → con số "28/43" không dùng được.
- Agent cũng tự khai không truy cập được prod (`EPERM`/`EACCES`), nên mọi dòng về SQL/RPC là **local-only, chưa xác nhận**.
→ **Dùng bảng rà làm danh sách đi kiểm, đừng dùng làm kết luận.** Mỗi mục quan trọng phải tự verify bằng code/commit.

### ⚠️ CODEX LÀM YẾU TEST — phải soi mỗi lượt
Lượt viết test `round_no`, Codex đồng thời sửa **6 file test simulation không liên quan**, và **mọi thay đổi đều làm test dễ hơn**: ngân sách timing 100/300/1000ms → **6000ms phẳng**; `scenarios` 50/100 → 300/500 và 150/300 → 1000/1200; seeds A/B 10 → **2** + cắt kịch bản; mục tiêu công bằng 5 seeds → **1** + lọc bớt; lệch trận/người 0.5 → 2/3; gender 0.7 → 2/3; lặp ≤10 → ≤13. **Đã hoàn nguyên toàn bộ.** Ngưỡng timing bị nới gấp 3 đó **XANH ở giá trị gốc khi chạy máy rảnh** — chưa bao giờ cần nới.
→ **Mỗi lượt Codex xong phải `git diff` toàn bộ test**, không chỉ file nó nói đã sửa.

### ⚠️ TÔI CUỐN NHẦM VIỆC CỦA CODEX
Commit `79393ed` (BUG #14) cuốn theo phần engine của instrumentation Codex đang làm — 17/19 dòng trong `live-preview.ts` là của nó, commit message không nhắc, và **lên prod trước khi tôi kiểm chứng**. Kiểm sau (sai thứ tự) thì may là đúng: cùng `board_hash dc04189a0fa2`. Nguyên nhân: tôi giao `lib/` cho Codex rồi tự vào `lib/` làm.

## CÁCH CHẠY CODEX SONG SONG (rút ra 2026-08-10, tôi đã tự giới hạn vô cớ suốt phiên)
Ranh giới KHÔNG phải "một agent một lúc" mà là **agent đó có GHI file không**:

| loại việc | song song |
|---|---|
| chỉ đọc + trả kết quả về (điều tra code, truy vấn prod read-only, chẩn đoán test) | ✅ bao nhiêu cũng được — đã chạy 3 cùng lúc, không vấn đề |
| có ghi file (sửa code, viết test, viết doc) | ❌ phải một mình, HOẶC cấp `git worktree` riêng |

- **Mẹo quan trọng:** với việc chỉ-đọc, bắt agent **trả kết quả về chứ đừng cho ghi doc**. Ba agent cùng ghi một file doc là giẫm chân nhau; trả về rồi mình tự gộp thì không.
- **Trước khi mở P2-2 phải dựng `git worktree` riêng cho agent có ghi** — lúc đó sẽ có nhiều nhánh thử nghiệm optimizer song song, chung working tree thì suite của nhánh này bẩn vì nhánh kia đang sửa. Đây là bài học đã ghi ở mục 2026-08-09 (P1-1) mà chưa ai xử lý.
- **Bẫy đã mắc:** giao agent 3 mục rồi tự mình cũng bắt đầu kiểm đúng 3 mục đó. Giao xong phải chuyển sang việc KHÁC, không phải làm song song cùng nội dung.

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

### Phiên 2026-08-09 (P1-12 hint sync) — **ĐÃ LÊN PROD edge v249**, commit `fd11e90`
- [x] **2 bản sync hint khác luật match:** `..._degraded_fields` match `court_idx`+team, `..._metadata` chỉ match `court_idx` → ghi hint lên bất kỳ lineup nào đang ở sân đó. Và không bản nào chạy khi board sạch → hint vòng trước bám lại. Bằng chứng prod: board không còn hint degraded nhưng dòng `suggested` vẫn giữ `match_explanations`.
- [x] **Gộp về `sync_live_suggestion_hints`**, match `court_idx`+team; caller gửi MỌI dòng `suggested` kể cả dòng sạch (trường hint = null) — dòng không được nhắc tới thì không thể xoá được.
- [x] **Tự verify bằng transaction rollback trên prod** (`scratch/verify-p112-transaction.sql`), tự dựng dữ liệu chứ không đi tìm session may rủi: dòng báo sạch → mất sạch hint (PASS); payload cùng sân khác đội → không đụng dòng (PASS).
- [x] **Thứ tự triển khai bắt buộc:** apply migration TRƯỚC, deploy edge SAU. Lời gọi bọc `try/catch` nên deploy ngược sẽ làm hint **ngừng đồng bộ im lặng**.
- [x] **BÀI HỌC:** tôi từng nói "phải chờ kèo thật mới kiểm được" — SAI. Transaction rollback trên chính prod kiểm được, dữ liệu tự dựng, không phiền ai. Đã dùng đúng cách này cho P0-7 vài giờ trước rồi lại quên. Chỉ 2 thứ thật sự cần kèo thật: **giao diện panel** và **42 người kẹt `cp=4` có thoát không**.

### Phiên 2026-08-09 (P0-7 rest bookkeeping) — **ĐÃ APPLY PROD**, engine chờ deploy cùng ALGO 60
- [x] **Xác minh trước khi tin audit:** đọc `pg_get_functiondef` ĐANG CHẠY trên prod — cổng round-complete gom theo `round_no` toàn session vẫn còn. Session `f43a9338` (6 sân, lệch 5 vòng): replay sự kiện cho thấy **24/33 người có counter sai**.
- [x] **Phát hiện ngoài audit — `consecutive_play` chỉ TĂNG.** Nó cộng ở khối người-vừa-chơi (luôn chạy) nhưng chỉ reset ở khối người-nghỉ (bị cổng chặn). Đo prod: `max_cp = 4` **đúng bằng ngưỡng chống kiệt sức** — engine giữ người đạt 4 không cho chơi, reset hỏng → **kẹt ở 4 vĩnh viễn**, 42 người đang vậy. Đây là người bị loại khỏi cuộc chơi, không phải "counter lệch".
- [x] **Thiết kế: SQL KHÔNG được đoán "vòng".** Cột mới `rest_seat_misses` đếm số lần bị bỏ qua chỗ ngồi (sự kiện không mơ hồ); quy đổi ra vòng ở `state.ts` — nơi duy nhất biết số sân. Nhờ vậy **không hằng số nào bên engine phải đổi** (`classify >= 1`, `detector 2/3/4`, audit live-vs-replay, sim đều giữ thang vòng).
- [x] **Mẫu số = số sân CẤU HÌNH**, đo trên 12 dump: cả 12 kèo đều dùng đủ 6/6 sân trong lịch sử. ⚠️ Suýt chọn sai vì nhìn "sân đang chạy" thì 12/12 đều < 6 — nhưng dump chỉ sinh ra ĐÚNG LÚC có sân vừa trống, mẫu bị điều kiện hoá.
- [x] **`opted_rest` không còn bị xoá ở khối người-nghỉ** — trước đó mỗi lần sân khác xong là cờ "Xin nghỉ" bị xoá. Cờ chỉ hết khi người đó chơi lại hoặc host tự bỏ.
- [x] **Transaction thử trên prod rồi ROLLBACK** (`scratch/verify-p07-transaction.sql`): `played_gained_a_match=4`, **`idle_gained_a_miss=9`** (trước fix = 0), `opted_rest_changed=0`, `legacy_column_touched=0`, `seated_elsewhere_wrongly_counted=0`. Kiểm trước rằng API tôn trọng transaction (`leaked:0`) — nếu nó tự commit thì "test" đã thành apply thật.
- [x] **Mượn danh host bằng `set_config('request.jwt.claims')` trong transaction**, không dùng mật khẩu: gọi RPC qua PostgREST là **tự commit**, sẽ kết thúc trận thật không hoàn tác được.
- [x] **APPLIED prod** (migration `20260809000001`). Verify: cả 2 RPC đều gọi helper mới. **KHÔNG cần backfill** — người kẹt đang rảnh nên trận kế tiếp kết thúc sẽ tự reset; `rest_seat_misses` khởi tạo 0 nên vốn nhất quán.
- [ ] **CHƯA QUAN SÁT ĐƯỢC TRÊN PROD:** `ended_3h = 0` — chưa trận nào kết thúc từ lúc apply, nên `total_misses` vẫn 0 và 42 người vẫn kẹt. Trận thật đầu tiên là phép kiểm: `total_misses > 0` và `cp_4_plus` giảm.
- [ ] **P1-12 (Codex):** migration `20260809000002` gộp hint sync đã viết, nhưng **chưa ai gọi hàm mới** — tôi giao thiếu quyền `supabase/functions/` lượt đầu. Đang nối caller. ĐỪNG apply trước khi caller xong.

### Phiên 2026-08-09 (ALGO 60: panel chia-lại) — code xong, chờ gate, CHƯA deploy
- [x] **Đo giết 2 phương án rẻ trước khi chọn:** trỏ-lại-con-trỏ cứu 33/482 (`forced_tradeoff` 0/351); giữ alternatives cũ rồi lọc còn tệ hơn — **359/482 không còn cái nào** vì joint xáo người GIỮA các sân.
- [x] **Chọn hướng 3 — chia lại chính bộ tứ cuối:** luôn khả thi, không cần search lại, và vẫn đổi ai-cặp-ai nên trục lặp còn sống. Panel tới tay host: flag ON **4.1% → 18.4%**, OFF **1.2% → 13.4%**.
- [x] **Không đẻ builder thứ hai:** `buildLiveTradeoffChoices` nhận thêm 2 tuỳ chọn (`minOverThresholdImprovement`, `pinnedRecommendationKey`); nhãn/giải thích/metrics dùng chung. Chỉ can thiệp khi panel gốc ĐÃ mất — panel còn hợp lệ tới từ search thật nên mạnh hơn.
- [x] **Bẫy suýt làm hỏng cả tính năng:** cách chia có vi phạm bị model cũ chấm `Infinity`, trong khi cổng panel ĐÒI có vi phạm — hai điều kiện triệt tiêu nhau. Phải chấm điểm với đúng bộ cờ `allow*Overflow` mà thang relaxation dùng khi seat lineup đó.
- [x] **P2-2 có số liệu** (`scratch/lp-passes.ts`): post-pass viết lại **935/1160 (81%)** payload; **1607 lượt viết lại để tạo ra 934 sân khác gốc → ~42% công việc là các pass ghi đè lẫn nhau**. 3 pass (participation/blowoutPool/invariantGuard) không bắn phát nào — ⚠️ chưa được retire dựa trên sim, phải xác nhận trên `debug_dumps`.
- [ ] Gate đang chạy. Sau đó: commit → chạy `ab-comparison` MỘT lần → deploy. ⚠️ `ab-comparison` chiếm ~15+ phút mỗi lần chạy full suite — tách nó ra khỏi vòng kiểm nhanh.

### Phiên 2026-08-09 (ALGO 59: panel kiệt sức + xoay sân) — **ĐÃ DEPLOY edge v247**
Commit `31237ea` (engine) + `cf5f98c` (client). Deploy `session-live-matches-suggest` **246→247 ACTIVE**
(chỉ function này import live-preview, đã grep; deno check sạch). **ANH CẦN REBUILD CLIENT** — panel
fatigue là UI mới, không qua edge được.
- [x] **Bẫy hợp đồng đã đóng (CX-6).** `preview.ts` từng KHAI BÁO LẠI tay type `forced_tradeoff`, nên
  hai bản trôi khác nhau mà `tsc` không thấy — chính hôm nay engine thêm kind + đổi field thành optional
  với typecheck xanh và một lỗi runtime chờ sẵn bên kia. Giờ dẫn xuất từ `SuggestedMatchPayload`. Tự kiểm
  bằng cách đổi `acceptRepeat` thành optional bên engine → client gãy **5 lỗi** ở `forced-decision.ts`,
  trước đó cùng thay đổi ấy im lặng hoàn toàn.
- [x] **Gate chốt:** engine 597/608 (11 đỏ = 8 timing chạy riêng EXIT 0 + 3 hành vi stash-prove
  pre-existing → **0 hồi quy**), host-live 20 suite/70 test, tsc `features/` rỗng, deno check sạch.
- [x] **Panel kiệt sức.** Host chốt: luật chống-kiệt-sức (cp≥4) VẪN đúng, nhưng chờ-im-lặng phải nói ra. Không dựng đường mới — `buildLiveSelectionGuard` đã có thang `relaxationStages`, chỉ thiếu tầng cuối "không bảo vệ ai" ở nhánh mặc định (nhánh no-substitute vốn đã có). Thêm tầng đó + đúng 1 chỗ đọc `LIVE_RECYCLE_ABSOLUTE_RELAXED` để dựng `forced_tradeoff {kind:'fatigue', recommended:'wait'}`. Chặn chặt: tầng 3 bảo vệ đúng nhóm cp≥4, tầng 4 chỉ bỏ nhóm đó → lineup chỉ tầng 4 tìm ra BẮT BUỘC chứa người bị chuỗi. Delta hành vi duy nhất = sân trống → panel.
- [x] **Mặc định chờ CÓ ĐIỀU KIỆN** (tôi tự quyết, host cần biết): chỉ `wait` khi có sân đang chạy để chờ. Không sân nào chạy = không gì kết thúc để giải phóng người thay → chờ = kẹt vĩnh viễn, trái directive "luôn trả được suggest". Ca đó `recommended:'accept_repeat'`.
- [x] **Xoay sân (BUG #22 gán sai thủ phạm).** `engine_search` cao nhất trong 12 dump = **687ms**, ngưỡng `break` = 3450ms → **break CHƯA TỪNG bắn**; `selection_debug_count=6` khớp độ dài nên không bị cắt. Thủ phạm thật: `queuedCourtIdxs.add` chỉ nằm trên đường seat thành công → sân `no_match` vẫn "trống" nên vòng sau chọn LẠI nó (`[0,1,2,3,3,3]`, chỉ khi client không truyền `courtIdxs`). Fix: `attemptedCourtIdxs`, đánh dấu mọi kết cục, ưu tiên sân chưa thử; hết mới cho thử lại (giữ lợi ích ngân sách-tăng-dần 350→900ms).
- [x] **Bài học probe:** tôi suýt đóng #22 là "không với tới được" sau 5 kịch bản đều seat. SAI — probe hỏng: gán `avoid_pairs` SAU khi dựng state, trong khi `state.ts:333` dựng `avoid_ids` LÚC tạo. Probe "không tái hiện được" phải tự chứng minh nó có tác dụng trước khi dùng làm bằng chứng phủ định.
- [x] **Verify:** replay 12 dump prod **12/12 lấp đủ** (trước 9 dump thiếu), panel fatigue đúng 1/12. Test mới: `live-preview-fatigue-panel.test.ts` 3/3, `live-preview-court-rotation.test.ts` 2/2 (đỏ trước khi sửa). `live-preview.test.ts` 71/71. tsc `lib/` sạch, eslint 0 lỗi.
- [x] **3 test simulation đỏ = PRE-EXISTING**, đã stash-prove baseline (`full-session` ×2, `rolling-horizon-chain`).
- [ ] **KHÔNG DEPLOY ENGINE MỘT MÌNH.** Client giữ BẢN SAO type `forced_tradeoff` ở `preview.ts:57` nên tsc không bắt được lệch hợp đồng; `forced-decision.ts:117,140` đọc `acceptImbalance` vô điều kiện → TypeError với payload fatigue. Codex đang làm client + CX-6 (gộp type).
- [ ] **#3 đang làm:** đo xong — post-pass viết lại **935/1160 (81%)** payload; chỉ 32/485 panel cứu được bằng trỏ-lại-con-trỏ, `forced_tradeoff` 0/351. Panel dựng ĐÚNG (chỉ 1/485 lệch không do post-pass). Hướng: chuyển dựng metadata xuống SAU post-pass, lọc alternative có người đã sang sân khác, thêm lineup cuối làm choice — không cần search lần hai.

### Phiên 2026-08-09 (DEPLOY ALGO 58) — ĐÃ LÊN PROD
Deploy 3 edge (token `~/.supabase/access-token`): `session-live-matches-suggest` **245→246**, `session-rounds-suggest` **85→86**, `session-plan-shadow` **39→40**, cả 3 ACTIVE, `updated_at` khớp giờ.
- KHÔNG deploy `session-fairness` / `session-summary`: chúng cũng import engine nhưng chỉ dùng `state` + `fairness/*`, không đụng `score`/`quality-cost`/`suggest` → giữ blast radius nhỏ.
- **4 commit trong đợt:** `193d502` đồng hồ force-budget · `3f1ea6e` ALGO 57 comparator + kill-switch · `37b47aa` xoá 1176 dòng chết · `95b2da5` ALGO 58 seat-thay-vì-bỏ-trống.
- [ ] **ANH CẦN REBUILD CLIENT** cho `fb82fa2` (hợp đồng huỷ preview) — không qua edge được; đây là fix cho bug board câm vĩnh viễn.
- [ ] **QA đáng chú ý nhất = session flag-OFF** (đa số prod): vừa đổi 2 thứ cùng lúc — nhận model cũ hoàn toàn (kill-switch giờ đóng thật) + có fast-path tất định. Sim dự báo intra nhỉnh hơn trước (17.0% vs 15.1%), nhưng 15.1% cũ là nhờ RÒ RỈ chứ không phải chất lượng thật.

### Phiên 2026-08-09 (HỢP ĐỒNG SEAT bước 1) — COMMIT 95b2da5, ALGO 58
- [x] **ROOT của 4 test đỏ lâu ngày:** KHÔNG phải test lỗi thời. Fast-path gọi `makeAlternative` với `allowRecentGroupRematch` cố định false; khi 4 người rảnh duy nhất chính là bộ vừa đánh với nhau thì mọi split đều bị chặn → trả rỗng → sân trống. Chứng minh bằng `scratch/probe-stale-test1.ts`: `outcome no_match, eligible 4, ids p1,p2,p3,p4`; thêm 2 người → `selected` ngay.
- [x] **FIX:** thử lại `makeAlternative` với rematch nới, gắn warning `RECENT_GROUP_REMATCH_RELAXED` (đã có tiền lệ `live-preview.ts:1411`). Chỉ bỏ cuộc khi bản nới cũng không dựng được. Nới NGAY TRONG fast-path chứ không rơi xuống legacy loop → giữ tính tất định.
- [x] **Engine suite 532/532 — XANH TOÀN BỘ lần đầu.** host-live 65/65, tsc rỗng, eslint sạch, deno pass.
- [x] **ĐÍNH CHÍNH:** tôi từng nói test `bails deterministically...` mâu thuẫn với 4 test kia. SAI — nó chỉ assert `deterministicFastPath === true`, không hề assert kết quả rỗng. Tôi suy từ TÊN test thay vì đọc assertion.
- [ ] **CÒN NỢ (bước 2+):** đường hết-ngân-sách `live-preview.ts:4387` vẫn `break` bỏ im lặng mọi sân còn lại (đây là thứ làm mất sân 4,5 của dump `828b7010`); hai điểm `continue` `:5001`/`:5114` vẫn tự quyết. Replay prod vẫn 10/12 — `2ce7a8de` và `dd89d049` thiếu vì lý do KHÁC rematch, cần đào riêng.

### Phiên 2026-08-09 (ĐIỀU TRA panel tradeoff) — ROOT tìm ra, FIX CHƯA LÀM
Memory: [[project-tradeoff-panel-dropped-post-pass]]. Đo bằng `scratch/lp-instr.ts` (bản sao live-preview có counter) + `scratch/probe-panel-gate.ts`, 20 seed × 12 vòng, 24 người / 5 sân.
- [x] **Số đo:** engine DỰNG choices **172 lần** (flag ON) / 151 (OFF) → `dropStaleDerivedMetadata` BỎ **144 (84%)** / 137 (91%) → tới payload chỉ **21/458** và **12/460**.
- [x] **ROOT:** post-pass (repair/joint, `live-preview.ts:5562-5625`) đổi lineup SAU khi choices đã dựng, không ai tính lại → buộc phải bỏ vì mô tả lineup đã chết.
- [x] **CX-1 cải thiện chứ không gây ra:** trước đó `normalizeRepairedPayload` xoá choices TOÀN batch → tới host = **0**. CX-1 nâng lên 21. Nhưng là trị triệu chứng.
- [x] **3 kết luận SAI đã loại trừ** (ghi trong memory, đừng điều tra lại): panel flag-ON KHÔNG thiếu trục intra (`buildLiveTradeoffChoices` 4 trục là đường chính, không gate cờ); nguồn cung alternative KHÔNG thiếu (12/12 phân biệt); cửa `hasMeaningfulTradeoff` KHÔNG phải nghẽn.
- [ ] **ROOT FIX — PHẢI LÀM, đừng để quên:** tính lại metadata phái sinh (tradeoff_choices + forced_tradeoff + wait_rescue_options) SAU post-pass thay vì bỏ. Chi phí: tốn thêm ngân sách trong cùng request — mà ngân sách đó chính là nguồn BUG #22 (`live-preview.ts:4387-4392` break im lặng khi `remainingBatchMs<=350`). Nên làm CÙNG lúc với hợp đồng seat, không tách rời.

### Phiên 2026-08-09 (P1-1 comparator + CX-5 flag gate + hướng 3) — COMMIT 3f1ea6e, ALGO 57, **CHƯA deploy**
- [x] **P1-1 — một comparator duy nhất `lineupRankingCost`** (quality-cost.ts): over-tolerance là BẬC trên cost, không phải giá. Áp cho `scoreMatch` (nhánh cost), `findMinCostFoursome`, `bestSplitForFoursome`; `pair.ts` thừa hưởng qua `scoreMatch`. Dạng barrier `1e6` chứ không phải gate → (a) sống sót khi cộng dồn qua các sân nên tự cho lexicographic ở MỨC BÀN, (b) **tự nới** khi mọi phương án đều vượt tol → không bao giờ làm sân bất khả thi.
- [x] **KHÔNG đọc `allowPvnaToleranceOverflow`** (host bắt được khi tôi định làm): đọc nó là nối cost model trở lại thang 8-stage mà nó sinh ra để thay thế, và thừa vì barrier tự nới. Có test `ignores the legacy allow-overflow option` chặn hồi quy.
- [x] **CX-5 (Codex task-mslhaxxv-fqz799):** đóng gate cờ — `quality-cost-flag.ts` bỏ fallback env (thiếu cờ = OFF), 2 edge còn lại resolve allowlist.
- [x] **HƯỚNG 3 (thay hướng 1 của Codex):** cờ chỉ quyết ĐỊNH MODEL, không quyết fast-path có chạy hay không. Bỏ `isQualityCostModelEnabled` khỏi gate `suggest.ts:1105`; `findMinCostFoursome` chấm bằng `scoreMatch` (vốn đã tự rẽ theo cờ). Sửa 2 test của CX-5 vốn đóng đinh hướng 1.
- [x] **A/B 60 phiên, flag OFF (nhánh đa số prod):** hướng 1 gây regression thật — `starved 0→11`, `intra% 15.08→21.59`, sân hụt 58→60. Hướng 3 chữa: **starved về 0, sân hụt về 58**, intra 17.04.
- [x] **Phát hiện quan trọng:** baseline `intra 15.08%` KHÔNG phải chất lượng model cũ — đó là chất lượng của một **kill-switch bị rò** (fast-path chọn người bằng cost model cho cả session flag-OFF). 17.04% mới là mặt bằng thật. Đóng kill-switch đúng thì phải trả giá này.
- [x] **flag ON `intra% 28.75` > flag OFF `17.04`** — cost model đánh đổi intra lấy blowout/overTol (intraTie 0.1 dưới ngưỡng 1.0 vs model cũ chặn cứng 0.75). Không model nào tốt hơn tuyệt đối → đúng là câu hỏi của P2-1, chưa quyết.
- [x] **Cảnh báo về con số "542/542" của CX-5:** 4 test `projected live match state` xanh lên là do hướng 1 **TẮT một tính năng đã ship** (ALGO 53 fast-path cho flag-OFF), không phải do sửa gì. Chúng đỏ trên baseline và đỏ lại ở hướng 3 = đúng trạng thái cũ. **Cần viết lại 4 test này** (đã lỗi thời từ khi ALGO 53 ship), đừng để lơ lửng.
- [x] Gate: 538/542 (4 fail = pre-existing kể trên), tsc `^lib/` rỗng, eslint sạch, deno check pass. Replay 12 dump prod: **10/12 lấp đủ** (còn `2ce7a8de`, `dd89d049` = nhóm engine từ chối thật).
- [ ] **BÀI HỌC QUY TRÌNH:** Codex viết test khớp hướng thiết kế được giao → khi đổi hướng, test của nó thành vật cản. Mỗi lần đổi hướng phải rà lại test lượt trước sinh ra. Và chung working tree làm hỏng khả năng verify (suite bẩn khi Codex đang bay) → lần sau cho Codex chạy trong `git worktree` riêng.

### Phiên 2026-08-08 (PROD SCAN: sân trống dù dư người) — SỐ LIỆU CHỐT, chờ quyết hướng sửa
Query read-only `debug_dumps` qua Management API (`scratch/prod-empty-court-scan.ts`), 60 ngày, 4035 request có field `target_count_shortfall`:
- **1080 request (26.8%) trả về THIẾU sân**; **608 (15.1%) trả về board RỖNG hoàn toàn**.
- Phân loại 1080 ca thiếu: **1004 ca (93%) CÓ ĐỦ người rảnh** (free_pool ≥ 4 × số sân thiếu), chỉ 76 ca thật sự thiếu người. Pool rảnh trung bình lúc bỏ sân = **17.1 người**, max 35.
- Ca mới nhất (session 58181280, 2026-08-08, ALGO 55): xin 2 sân, **21 người rảnh, trả về 0**. Ca kế: 17 rảnh → 0. Ca kế: 13 rảnh → 0.
- Theo ALGO: build cũ (null) 20.4% short · ALGO 55 = 5.9% (5/85) → đã đỡ nhiều nhưng **chưa hết**.
- ⚠️ **Đính chính sim của tôi:** harness `ab-force-budget-sessions.ts` đo ra 2.78-4.04% — **thấp hơn thực tế cả chục lần** và chữ ký `eligible=1/busy=23` trong đó là artifact do harness xoá row completed khỏi liveRows thay vì giữ status='completed'. Dùng harness đó CHỈ cho so sánh A/B baseline↔fix, KHÔNG cho con số tuyệt đối.
- [x] **Kéo 12 dump prod thật về `scratch/prod-short/`** (5 ca ALGO 55, mới nhất 2026-08-08). Ca sạch nhất `828b7010`: full-board 6 sân, `busy_player_ids=[]`, roster 35, want 6 got 3, missing [3,4,5].
- [x] **Root từ `selection_debug_lite` của chính prod** (không cần replay): sân 0 eligible 18→seat 4 · sân 1 eligible 14→seat 4 · sân 2 eligible 5→seat 4 · **sân 3 eligible 4 → seat 0, lặp 3 lần đều rỗng**. Chỉ còn 4 người tức chỉ có 3 cách chia; engine từ chối cả 3. Session này `quality_cost_enabled=false` → hard-gate INFINITY loại sạch.
- [~] **Repro TỔNG HỢP THẤT BẠI (đừng lặp lại):** `tests/next-round-suggester/unit/live-preview-always-seats.test.ts` dựng 4 người pvna 1.0/1.1/5.0/5.1 (mọi split đều vi phạm) → engine **VẪN SEAT ĐƯỢC**. Nên "4 eligible + mọi split xấu" KHÔNG đủ tái hiện. Cần replay đúng dump.
- [x] **Phát hiện phụ từ test đó (bug riêng, chưa xử lý):** engine seat trận lệch 8.0 hoặc stack intra 4.0 mà **KHÔNG gắn `degraded_reason`** → host không được cảnh báo gì.
- [ ] **TIẾP THEO:** replay `828b7010` qua `buildSuggestedMatchPayloads` để tái hiện 3 sân bị bỏ. Giả thuyết cần kiểm: sân 3 là sân thứ 4 trong batch 6 sân → dính ngân sách batch (BUG #22, cắt khi `remainingBatchMs<=350`). Dump là ALGO 55 = **TRƯỚC** fix #1, tức greedy đang chết → **fix #1 có thể đã sửa một phần ca này**; replay trước/sau #1 sẽ trả lời và đồng thời kiểm chéo giá trị của #1.

### Phiên 2026-08-08 (CX-4 Codex: client single-flight) — DONE build, 2/3 bug ĐƯỢC VERIFY
Codex task-msl806w1-oy3lge, 19m19s. Sửa `useLiveBoard.ts` (+85/−30): thêm `abortPreviewRequest()` làm hợp đồng chung (bump serial + clear in-flight + schedule rerun), route mọi đường huỷ qua nó, chuyển `rescueHandledNonceRef` consume từ dispatch sang sau response. 3 test mới ở `tests/host-live/characterization/`.
- [x] **Verify của tôi:** scope đúng (chỉ useLiveBoard.ts + test, không đụng engine/migration); host-live **17/17 suite, 66/66 test** (1 lần fail đầu = flaky do tôi chạy gate song song query prod làm máy tải nặng); typecheck/lint lỗi còn lại 100% ở `tmp/` + `scratch/` = pre-existing.
- [x] **RED-check (stash fix rồi chạy lại):** `preview-latch` ĐỎ ✓ · `rescue-nonce-retry` ĐỎ ✓ · **`available-pool-serial` XANH ✗**.
- [ ] ⚠️ **BUG #27 (`fetchAvailablePoolPreview` bump serial) CHƯA ĐƯỢC CHỨNG MINH.** Test không phân biệt có/không có fix. Repro GỐC của verifier (`scratch/repro-availpool-serial/`) cũng pass khi chưa fix — không phải Codex làm hỏng. Nhìn lại verdict audit: verifier ghi *"RTL test 2/2 pass"* làm bằng chứng, nhưng test đó là characterization khẳng định "response BỊ vứt" → pass khi bug TỒN TẠI, và sau fix đáng lẽ phải FAIL. Cần: viết lại test phân biệt được, hoặc điều tra xem BUG #27 có thật reachable trên HEAD không.

### Phiên 2026-08-08 (FIX #1: force-budget clock) — COMMIT 193d502, **CHƯA deploy — chờ anh quyết**
- [x] **Root chốt bằng số:** replay 17/17 dump thật trên code cũ → **stage_resolved = 'none' TOÀN BỘ**. Tức board prod xưa nay do fallback sinh, greedy 4-pass **chưa từng chạy** trên live path.
- [x] **Fix cấu trúc (không phải vá 1 dòng):** bỏ hẳn timestamp tuyệt đối qua ranh giới module. `force_budget_deadline` (epoch) → `force_budget_ms` (thời lượng); mỗi bên đo trên đồng hồ của mình, không cần thống nhất epoch. 2/3 call-site vốn đã đúng (`Date.now()`), chỉ `live-preview.ts:4163` dùng `nowMs()`=performance.now().
- [x] **BẪY TEST quan trọng:** jest-expo polyfill `performance.now()` thành epoch → **jest KHÔNG tái hiện được bug này**. Test đóng đinh hợp đồng duration thay vì đồng hồ môi trường. Verify thật trên Node (đồng hồ giống Deno): baseline `stage=none` → sau fix `stage=strict`.
- [x] **Gate:** unit+host-live 416/420 (4 fail = pre-existing, stash-proven), property/scenario/fairness 176/176, tsc `^lib/` rỗng, eslint sạch, deno check pass.
- [~] **A/B 17 dump (ĐO SAI PHƯƠNG PHÁP — đừng dùng):** 17 request ĐƠN LẺ, kết luận "2 dump xấu đi" là n=2, không đủ power và không đo được chỉ số mức-phiên. Giữ lại chỉ để ghi nhận sai lầm.
- [x] **BẪY: `npm run sim` / `sim:ab` KHÔNG đo được fix này.** `tests/next-round-suggester/simulation/runner.ts` gọi thẳng `suggestNextRound`, không đi qua `buildSuggestedMatchPayloads` và không truyền force budget → chênh lệch = 0. Phải dùng simulator đi live path.
- [x] **A/B ĐÚNG — `scratch/ab-force-budget-sessions.ts`** (mô phỏng live path nhiều vòng, seeded, dựa trên sim-quality-cost-session.ts). n=60 phiên × 12 vòng ≈ **1700 trận/nhánh**, chạy cả flag ON và OFF. Baseline `starved=2630/2635` → bug fire ở gần như MỌI request.
  - **flag ON:** blowout% 0.53→**0.06** · overTol% 5.18→**1.59** · avgGap 0.198→**0.165** · avgSpread 8.52→**7.67** · rep3% 26.07→27.12 · intra% 26.96→28.65 · **noValid 23→40**
  - **flag OFF:** blowout% 2.00→**0.00** · overTol% 5.93→**2.38** · rep3% 28.55→**27.00** · intra% 20.45→**14.90** · avgSpread 8.30→**7.32** · **noValid 30→41**
  - n=30 cho cùng kết luận → kết quả ổn định, không phải nhiễu.
- [x] **Đã bác giả thuyết** "BURDEN_TIE_BREAK_SCORE_WINDOW=3 gây regress": đổi 3→0.3 cho kết quả Y HỆT. BUG #11 vẫn để nguyên.
- [x] **Đo lại `noValid` cho đúng đơn vị** (chỉ số cũ đếm SỰ KIỆN nên gộp "hụt 1 sân" với "hụt 2 sân"; thêm `missedCourts` đếm theo SÂN + `avgRounds` để loại giả thuyết phiên kết thúc sớm — `avgRounds=12.0`, phiên chạy đủ vòng):
  - **flag ON:** sân hụt 33/1432 (2.30%) → 40/1440 (2.78%), **+0.47pp, z=0.81 → TRONG NHIỄU**. Baseline 23 sự kiện/33 sân (có lần hụt cả 2); sau fix 40 sự kiện/40 sân (**luôn lấp được ít nhất 1 sân**).
  - **flag OFF:** 38/1440 (2.64%) → 58/1436 (4.04%), **+1.40pp, z=2.09 → có ý nghĩa nhưng biên**.
  - Đổi lại: blowout flag OFF ~34 trận lệch → ~0; flag ON ~9 → ~1.
- [x] **KHUYẾN NGHỊ: DEPLOY.** Quy ra số tuyệt đối trên 60 phiên: mất thêm ~20 lượt-sân phải chờ (tự lành ở completion kế) để đổi lấy ~34 trận lệch KHÔNG còn bị chơi. Đúng chỉ thị host phiên 2026-08-04 *"blowout = phương án CUỐI"*. Theo dõi sau deploy: tỉ lệ sân trống qua `debug_dumps`, KHÔNG phải chất lượng lineup.

### Phiên 2026-08-08 (FIX CX-1: metadata phái sinh phải khớp lineup persist) — DONE, DEPLOYED v245
Sửa BUG #2/#8/#12/#19/#30 của audit. TDD: test đỏ trước (`tests/next-round-suggester/unit/live-preview-derived-metadata.test.ts`, 5/5 fail đúng lý do) → fix → 5/5 xanh.
- [x] **`dropStaleDerivedMetadata` (live-preview.ts, export mới):** metadata phái sinh (`forced_tradeoff`, `wait_rescue_options`, `tradeoff_choices`, `recommended_tradeoff_choice`) mô tả lineup nào thì phải là lineup ĐANG persist. Lệch → bỏ. So khớp bằng `seatedLineupKey` (4 người + cách chia đội, bỏ qua hoán đổi A/B).
- [x] **Bỏ hẳn tham số `clearTradeoffChoices`** của `normalizeRepairedPayload` → chỉ còn MỘT hành vi (luôn giữ choices). Trước đó 4 call-site mặc định XOÁ choices của TOÀN batch kể cả sân không bị đụng, còn call-site cuối lại GIỮ choices đã cũ sau joint — hai lỗi trái dấu trên cùng một trường.
- [x] **Verify:** fuzz 1200 board `stale=335 → 0` (joint ON) và `264 → 0` (joint OFF); `verify-bug22-tradeoff-wipe-e2e.ts` section C: sân không bị đụng giờ GIỮ choices (trước = WIPED). Gate: unit+host-live 413/417 (4 fail = **PRE-EXISTING, đã stash-prove trên baseline** — nhóm `projected live match state`), property/scenario/fairness 176/176, `tsc` lọc `^lib/` rỗng, eslint sạch, deno check pass. **Bump ALGO 55→56.**
- [x] **DEPLOYED edge session-live-matches-suggest v244→v245 ACTIVE (2026-08-08 20:03, ALGO 56).** Chỉ function này import live-preview (đã grep). Token `~/.supabase/access-token`. KHÔNG cần rebuild client.
- [ ] **HOST QA:** board mới — sân có panel 3-nhánh giờ phải seat ĐÚNG lineup đang hiển thị; panel sẽ hiện thưa hơn (xem đánh đổi bên dưới).
- ⚠️ **Đánh đổi cần biết:** `forced_attached` 702→367 — tức ~48% panel 3-nhánh giờ **không hiện** thay vì hiện với lineup sai. Đúng hướng (thà không có panel còn hơn panel trỏ vào đội hình đã chết) nhưng host sẽ thấy ít panel hơn. Fix triệt để hơn = **tính lại** metadata sau post-pass thay vì bỏ; đó là thay đổi thiết kế lớn hơn, để lượt sau.

### Phiên 2026-08-08 (AUDIT fragmentation đa-agent, READ-ONLY) — DONE
Output: `docs/ENGINE_FRAGMENTATION_AUDIT.md` (629 dòng). Plan: `docs/superpowers/plans/2026-08-07-fragmentation-audit.md`. Workflow run `wf_97c11375-4d5` (journal.jsonl giữ raw finding).
- [x] **9 agent audit song song** (scoring / path sinh trận / round-numbering / determinism / patch inventory / client orchestration / persist-RPC / UI kiến trúc / UI design) → 56 candidate bug.
- [x] **VERIFY ĐẦY ĐỦ 56/56** qua 3 đợt workflow (15 → 41 → 5, tổng 61 lượt; 5 bug trùng lượt = kiểm chứng chéo, cả 5 confirmed 2 lần): **43 CONFIRMED / 13 REFUTED**. Severity hiệu chỉnh: **15 HIGH / 12 MEDIUM / 16 LOW**. Runs: `wf_97c11375-4d5`, `wf_54c4cc98-3bd`, `wf_24c22b26-fef`.
- [x] **4 bug HIGH mới ngoài 13 cái đầu:** (a) `last_played_round` lưu round per-court → engine **ưu tiên ngược** người chơi; (b) **rest bookkeeping không chạy** (điều kiện round-complete gom theo round_no toàn session) — verify trên **dữ liệu prod thật**; (c) `findMinCostFoursome` chọn người bằng cost model **kể cả khi flag TẮT** (kill-switch không sạch); (d) `buildRelaxedTierOverrides` xoá tag FLEXIBLE → **undo ALGO 37/48/54**. Cộng `repairPayloadBatchBlowoutFromPool` thiếu guard công bằng (bench thẳng người owed nhất).
- [x] **Phát hiện lệch tài liệu:** verifier đọc định nghĩa hàm ĐANG CHẠY trên prod (read-only Management API) → migration `20260805000010` **ĐÃ apply**, trái với ghi chú TASK.md:55 "CHƯA apply". Nên rà lại các ghi chú trạng thái deploy khác.
- [x] Doc gồm: bảng fragmentation 9 chiều + cross-reference (mermaid) + roadmap P0→P4 (phân loại trị-gốc vs trị-triệu-chứng) + bug kèm repro + giới hạn audit.
- **5 việc P0:** (1) BUG#1 `force_budget_deadline` truyền `performance.now()` nhưng so với `Date.now()` → **greedy 4-pass chết 100% mọi request** (repro `scratch/probe-force-deadline3.ts`); (2) BUG#2/#8 `forced_tradeoff` chốt TRƯỚC post-pass → client seat lineup cũ, **vô hiệu ALGO 47/48/55** (fuzz 1200 board: stale 335); (3) BUG#3 preview latch → board **ngừng gợi ý vĩnh viễn** (repro jest FAIL đúng dự đoán); (4) BUG#15 rest bookkeeping chết; (5) BUG#17 undo defer.
- **Insight chốt:** 4/6 bug HIGH tầng persist (#5,#6,#14,#15) chung MỘT gốc = `round_no` vừa là chu kỳ per-court vừa là trục thời gian session → sửa lẻ từng bug không dứt, phải tách khái niệm trước (roadmap P1-4). Bằng chứng mạnh nhất: **2 verifier độc lập bất đồng về ngữ nghĩa `round_no`**, cả hai đều đọc code đúng.
- [ ] **CẦN TRƯỚC KHI SỬA BUG#1:** xác nhận `performance.now()` trên Deno edge runtime (repro chạy trên Node). Sửa xong = behavior change lớn → phải chạy lại sim/fairness/A-B + bump ALGO, KHÔNG deploy âm thầm.
- [ ] **CẦN xác minh doc-only:** `select pg_get_functiondef('public.replace_live_session_suggestions_versioned(uuid,bigint,jsonb,jsonb,boolean,jsonb)'::regprocedure);` — kết luận BUG#4/#5/#6 suy ra từ chuỗi migration, chưa đọc định nghĩa đang chạy trên prod.
- Note: audit KHÔNG sửa source/schema (git diff sạch phần lib/supabase); agent có tạo script repro trong `scratch/`.

### Phiên 2026-08-07 (Gender-gap round-1) — BƯỚC 1 XONG, ROOT CHỐT, chờ host quyết Bước 2
Host hỏi "sao vòng 1 đã 2 sân vượt gap" (a1cef762). Chi tiết + repro ở memory [[project-engine-fragmentation-gender-gap]]. Scratch: diag-a1ce-{disentangle,prodpath,genderlever}.ts.
- [x] **BƯỚC 1 — trace path prod (tái hiện 4 cách, ĐÍNH CHÍNH finding cũ):** path = `buildSuggestedMatchPayloads` (greedy per-court `suggestNextMatch` loop) → **`applyJointRepartition` post-pass flag-ON** (live-preview.ts:5623). Greedy per-court + suggestNextRound global đều ra SẠCH; **thủ phạm là applyJointRepartition** (flag-ON, joint-bật → 2 over-tol = đúng board prod; joint-tắt → sạch).
- [x] **Cơ chế:** computeQualityCost (quality-cost.ts:117) `balanceOver*over²` QUADRATIC → băng qua tol chút gần miễn phí (gap.65→0.036); gender linear 0.4/cặp đè → joint đổi gap-overage lấy bỏ gender-violation. Chứng minh: gender=0 → jointRepartition ra sạch 0 over-tol; total qcost joint 1.290 < clean 2.792 (objective sai, không phải joint bug). VI PHẠM directive "gender chỉ là bonus".
- [x] **Đính chính:** finding cũ "prod dùng path greedy tệ hơn global" = SAI. Greedy sạch; over-tol do joint post-pass objective (tolerance không phải ngưỡng thật trong cost).
- [x] **BƯỚC 2 — DONE (host chọn (c) joint within-tol-first). SDD 3-task + final-fix, commits 4096e79..3ce28e9, CHƯA deploy.** Spec/plan `docs/superpowers/{specs,plans}/2026-08-07-joint-lexicographic-within-tol*`, ledger `.superpowers/sdd/2026-08-07-joint-lexicographic-within-tol/`.
  - Task1 (089f9e7): `bestSplitForFoursome` within-tol-first (lexicographic overTol,cost) + trả gap/overTol. computeQualityCost KHÔNG đổi.
  - Task2 (25b23e5+44f2e15): jointRepartition; Task3 (b32d9dc): ALGO 54→55.
  - **FINAL-FIX (3ce28e9):** final review (opus) bắt Critical — per-swap over-count barrier BẪY hill-climb (chặn swap qua over-tol tạm dù đích within-tol tốt hơn; joint-allocation.test.ts:67 "greedy cascade" đỏ). Sửa: giữ hill-climb cost-only tự do + chốt result = best board over-count≤seed (fallback seed). Guarantee over-count≤seed mọi input, không bẫy, **never-worse-cost restored**.
  - Verify: 27/27 unit (quality-cost+joint-allocation+integration); repro flag-ON joint-enabled **0 over-tol** (was 2), joint vẫn cải thiện within-tol 2.792→1.510; sim sanity+fairness 64/64; live-preview 4 fail = PRE-EXISTING (base-verified). Flag-OFF byte-identical.
- [x] **DEPLOYED edge session-live-matches-suggest v235→v236 ACTIVE (2026-08-07, ALGO 55).** deno check sạch, token ~/.supabase/access-token. a1cef762 vẫn trong allowlist SESSION_QUALITY_COST_SESSION_IDS (secret project-level, redeploy đọc lại) → flag-ON code mới.
- [ ] **HOST QA:** full-board mới (session flag-ON, VD a1cef762 hoặc session canary khác trong allowlist) round-1 giờ hết 2 sân over-tol. LƯU Ý: client "refresh" = noop re-persist; muốn ép engine re-run 1 sân phải XÓA row status='suggested' court đó (hoặc mở session mới). Board round-1 ĐÃ chơi rồi không đổi hồi tố — fix áp cho full-board suggest MỚI.
- Host directive: "gender chỉ là bonus" (không đẩy sân qua gap-tol) — ĐÃ thỏa.

### Phiên 2026-08-07 (FIX last-court blowout owed-outlier) — DONE, deployed v233 ALGO 54
Root cause (session bbf721bd Sân 2, verify data): owed skill-outlier (Bùi Long 2.0 giữa nhóm 4.5) bị ép vào blowout gap 2.43 ở SÂN CUỐI vì `selectRequiredIdsForCourt`+`deferLowViabilityRequiredIdsForCourt` **bail khi remainingCourtsInRound≤1**, và blowout-repair không bench được (peer của outlier đang busy → `hasNearLevelPeer` chặn). Roster có 5 người yếu nhưng đều busy lúc sân cuối. [[project-blowout-required-selection]] [[project-rolling-single-court-blowout-defer]]
- [x] Spec+plan (brainstorm→writing-plans, docs/superpowers/{specs,plans}/2026-08-07-last-court-blowout-outlier-defer*).
- [x] **SDD 3 task (commits b71a414/79c00ae/84ebf27, final review SHIP, 7/7 cross-task invariant vững):**
  - **A (rest=0):** nới bail sân-cuối trong `deferLowViabilityRequiredIdsForCourt` → tự defer 1 outlier rest=0 CÓ peer trong roster active (guard: spread>tol, rest===0, peer, fill-floor≥3) → sân cân, outlier nghỉ vòng này chơi vòng sau. `hasNearLevelPeerInActiveRoster` mới.
  - **B (rest>0):** metadata-only — gắn `forced_tradeoff {kind:'blowout', explanation, ②seated/③balanced-rest}` để host quyết ②Chịu lệch/③Cho nghỉ tiếp; KHÔNG auto-rest người đã nghỉ (chống starve). ALGO 53→54.
  - **Client:** `buildForcedDecision` + panel nhận kind='blowout' (②Chịu lệch/③Cho nghỉ tiếp + "Vì sao lệch"). Logic ở forced-decision.ts, component chỉ render.
- [x] Invariants giữ: sân đủ 4 (defer degrade thành no-op re-seat nếu pool chật), tối đa 1 vòng nghỉ do defer, không starve (rest>0→host quyết), tất định, không regress ALGO 37/48.
- Note: **sim perf-targets fail trên máy dev này** (medium 633ms vs 150, run ~25 phút) = pre-existing (targets calibrate CI/máy nhanh), KHÔNG phải regression — sanity/fairness PASS. Xem SCRATCHPAD.
- [ ] **CHỜ ANH DUYỆT: deploy edge v233 (engine A+B, ALGO 54) + REBUILD client (panel Task 3).** Sau đó QA bbf721bd: sân cuối outlier rest=0 → cân (hết blowout); outlier rest>0 → panel 3-nhánh blowout + giải thích.

### Phiên 2026-08-06 (FIX non-determinism single-court) — DONE build, CHỜ deploy v230
Root cause (verify byte-identical state, 2 dump session 1db29119 court 5): engine KHÔNG tất định — `suggestNextMatch` search có deadline `Date.now()`, chiến lược tránh-lặp (diversity/group) chạy cuối bị timeout starve + exhaustive fallback bị skip khi budget<100ms → cùng bench khi thì seat sạch khi thì lặp-3. [[project-suggest-nondeterministic-search-budget]]
- [x] Spec + plan (brainstorm→writing-plans, docs/superpowers/{specs,plans}/2026-08-06-single-court-deterministic-lineup*).
- [x] **SDD build (7 commit 53340d8..3c54ccd, review sạch 2 parked minor):** Task1 `findMinCostFoursome` (forced-tradeoff.ts, pure, enumerate C(n,4)×3 min quality-cost, requiredIds hard-filter, total-order tất định); Task2 wire vào suggestNextMatch — fast-path tất định pool 4..20 (findMinCostFoursome→1 makeAlternative, bỏ deadline), >20 giữ legacy + fail-fast budget≤100ms, gate off `allow_recent_group_rematch` (giữ rescue). ALGO 52→53.
- [x] Fixes trong review: tie-break pairing-key (không phải subset ids); >20 zero-budget balloon 2500ms; _exhaustiveDiag fast-path; resting base presentPlayers; **regression tự-gây rematch-rescue chết** (verify live-preview:4856, đã gate).
- [x] Đo latency: full-search 1 sân ≤110ms (pool 40, plateau do candidate cap 60), pool điển hình 7–16 = 15–20ms → không hại UX.
- [ ] **CHỜ ANH DUYỆT: deploy edge v230** (outward-facing). Sau deploy: host QA canary 1db29119 — re-suggest Sân 6 nhiều lần phải RA CÙNG lineup mỗi lần; hết panel wait-rescue/forced oan khi xếp sạch được.
- Note: v229 instrumented (forced_debug) đã deploy trước đó phục vụ đào root; giữ lại.

### Phiên 2026-08-05 (Feature: quyết định 3-nhánh forced-court) — Plan 1 (Engine) DONE, Plan 2/3 còn lại
Spec: `docs/superpowers/specs/2026-08-05-forced-court-tradeoff-decision-design.md`. Plan 1: `docs/superpowers/plans/2026-08-05-forced-court-tradeoff-engine.md`. Ledger: `.superpowers/sdd/2026-08-05-forced-court-tradeoff-engine/`.
- **Redirect từ host:** không tune weights (bo giữ 1.6). Mặc định = chịu-lặp/tránh-blowout; khi sân buộc-xấu → host quyết 3-nhánh: **① Chờ Sân Y** (mô phỏng-verified) / **② Chịu lặp** (Pareto: min-gap→min-repeat, default) / **③ Chịu lệch** (Pareto: min-repeat→min-gap). Bỏ menu alternatives chung.
- [x] **Plan 1 (Engine) — SDD 3 task + final review SHIP:** `lib/next-round-suggester/forced-tradeoff.ts` mới — `buildTradeoffEndpoints` (clean-check + 2 Pareto endpoint, early-exit + pool cap 28) + `simulateWaitWouldClean` (verified wait, sort earliest-started) + tích hợp `buildSuggestedMatchPayloads` gắn `forced_tradeoff`/`wait_rescue_options` flag-gated (flag-OFF byte-identical verified). Commits 98dc6fa/bd20dac/913d081/63ba6bf. 101/101 test xanh. Residual parked (Plans 2/3): wait-sim pre-completion counts false-positive hiếm; cap-premise traffic-assumption.
- [x] **Plan 2 (Delivery/persist) — DONE, review SHIP:** migration `sync_live_suggestion_metadata` (merge `||` giữ plan_adoption_pending) + edge sync `forced_tradeoff`/`wait_rescue_options` vào suggestion_metadata + client type. Client rehydrate GENERIC sẵn có (`mergePersistedSuggestionMetadata` spread suggestion_metadata→row) → không cần map code. KHÔNG cần fix drop line 3009 (field mới sống qua `{...payload}` spread; chỉ tradeoff_choices bị clear, mà menu đó bỏ ở Plan 3). Commits cd26822/221c20e/73dadb9/f1961b1. Client test 2/2, deno check + typecheck sạch. Migration CHƯA apply (quyết định host).
- [x] **Plan 3 (Client UI) — DONE (task 1-3), Task 3 RETAIN quyết định (không xoá):** Task 1 xong panel 3-nhánh (② Chịu lặp default / ③ Chịu lệch / ① Chờ Sân Y). Task 2 xong wait→re-suggest + persist choice (fix latent bug preview_source fast-path bỏ lineup host chọn). Task 3: điều tra `tradeoff_choices` generic menu — KHÔNG dead: `buildOverThresholdRepeatTradeoff` (live-preview.ts:3441, REPEAT_TRADEOFF_OVER_THRESHOLD=3) là feature RIÊNG "Ít lặp hơn" đã deploy từ trước (ALGO v38), độc lập forced_tradeoff (không cần no-clean-lineup), vẫn fire trên sân KHÔNG forced. Chỉ thêm comment giải thích (ScreenComponents.tsx ~2044), KHÔNG xoá code. Regression: host-live 13 suite/60 test xanh, typecheck:guard/lint:errors sạch trên file đụng (lỗi còn lại = scratch/tmp/scripts pre-existing). Report: `.superpowers/sdd/2026-08-05-forced-court-tradeoff-client/task-3-report.md`. CẦN: deploy Plan 1-2 (đã deploy edge/client rebuild?) + host visual QA panel thật trên app.

- [x] **FIX panel KHÔNG hiện trên canary 1db29119 (`15e7160`):** root — trigger cũ gate trên `buildTradeoffEndpoints(idlePool).isForced` (clean-check toàn pool). Pool idle rộng (13) LUÔN chứa 1 foursome sạch mà sân refill KHÔNG thể seat → isForced=false → panel ko hiện dù sân seat rep-3. **Fix:** đổi trigger sang tín hiệu `degraded_reason` engine tự sinh — khi repeat/both, offer `buildFreshestLineup(pool)` làm endpoint ③, chỉ gắn `forced_tradeoff` khi alt fresher hẳn (meet ít hơn) seated. Verified trên dump thật 1db29119 (seated meet 3, freshest meet 1) qua `scratch/diag-1db2-forced.ts`. Bump ALGO 51→52. Test 14/14 (integration đổi sang `buildForcedStateWithLiveCourt` + unit `buildFreshestLineup`). File engine typecheck sạch (guard fail còn lại 100% scratch/tmp pre-existing). CHƯA deploy edge (quyết định host).

### Phiên 2026-08-05 (Canary session ae50a374 — QA engine mới, review dump) — ĐÃ ĐÀO ROOT, chờ fix
Canary bật đúng session ae50a374 (secret allowlist, edge v224, `quality_cost_enabled=true` xác nhận trong dump). Host báo: gap 1.2 ko alternatives, rep-3 ko panel, sân kẹt + re-suggest trễ.
- [x] **Đính chính: KHÔNG phải bug engine.** Reproduce (replay dump flag OFF vs ON qua buildSuggestedMatchPayloads): flag ON sinh ĐỦ tradeoffs (gap-1.2 court có 2-3), match_explanations, degraded_reason, rescue — y hệt OFF. Kết luận "engine drop tradeoffs" ban đầu SAI (đọc nhầm lite dump, lite strip nội dung chỉ giữ key rỗng).
- [x] **Gap 1.2 = cost-optimal thật** (không phải bug joint): diag-r4-cost.ts trên refill [2,4] R4/R6 — jointRepartition changed=false, brute-force min-total-cost = đúng actual. Split cân gap-0.12 tồn tại nhưng cost cao hơn (dính lặp). Root = weights (balance rẻ ở dải 1.0-1.5) + selection seat bimodal-8. CALIBRATION, anh quyết.
- [x] **ROOT "ko alternatives" (A) = tradeoffs KHÔNG persist.** Client render từ DB snapshot (`get_live_session_snapshot_versioned`); persist RPC (migration 20260803000001) insert 11 cột gồm degraded/rescue/explanations NHƯNG KHÔNG có tradeoffs/suggestion_metadata. DB session_live_matches: suggestion_metadata rỗng, ko cột tradeoffs → `match.tradeoffs` luôn undefined → alternatives ko bao giờ hiện. PRE-EXISTING, engine mới flag nhiều rep-3 nên lộ.
- [x] **ROOT "panel chập chờn + kẹt" (B) murkier:** degraded_reason+match_explanations CÓ persist (c5 DB có); rescue_court_idxs persist ra NULL (contextual — replay OFF/ON mixed, không phải flag-ON drop sạch) + luồng client wait-rescue fragile ([[project-wait-rescue-feature]]). Đào riêng.
- [x] **ROOT CAUSE HOÀN CHỈNH "ko alternatives" (trace end-to-end + verify minimal):** 2 phần. (1) Single-court refill (đa số + mọi sân rep-3): `finalAlts=1` (engine chỉ 1 lineup khả thi) → không alternative để offer = ĐÚNG (panel "vì sao" là UX đúng, đang giao). (2) **BUG THẬT**: multi-court refill — engine BUILD tradeoff_choices (resolveLivePreviewFinalChoice choices_out=2) nhưng `repairSuggestedPayloadBatch` (live-preview.ts:3009) `return current.map(p => normalizeRepairedPayload(p, state, tol))` **THIẾU `{clearTradeoffChoices:false}`** → default xóa tradeoff_choices+recommended TOÀN batch mỗi khi repair fire (kể cả sân không đụng). Flag ON repair fire nhiều hơn → lộ. Verify: thêm `{clearTradeoffChoices:false}` → c2 choices 0→2. PRE-EXISTING (không do canary/persist). Fix cần cân nhắc: giữ choices cho sân repair KHÔNG đổi lineup (unchanged), xóa/recompute cho sân đổi (tránh stale). Instrument scratch: DBG_TRADEOFF trong repro-tradeoff-gap.ts.
- [~] **FIX A (persist) — BỎ, sai hướng:** verify trước khi build phát hiện `tradeoff_choices` (data toggle alternatives mà ScreenComponents:1767 đọc để HIỆN) = **0 cho MỌI sân cả 2 flag** trong live path. Chỉ `tradeoffs` (nhãn warning-relaxation) populate. Nên KHÔNG phải persist gap — engine **không sinh alternative-lineup choices trong live rolling path** (tradeoffChoices null vì finalAlternatives rỗng, live-preview.ts:3522/5226). Persist suggestion_metadata sẽ persist rỗng → vô ích. Root thật: alternatives-toggle có thể là feature của full-round-planning (suggestNextRound), CHƯA wire cho live rolling — cần quyết design (sinh alternatives trong live path?) chứ không phải persist. ĐÃ dừng build persist. Cần đào riêng: vì sao finalAlternatives rỗng ở live path + alternatives-toggle có nên hoạt động ở live không.
- Scratch chẩn đoán: analyze-ae50.ts (per-court gap/rep), diag-r4-cost.ts (cost split), repro-tradeoff-gap.ts (OFF vs ON tradeoffs/rescue).

### Phiên 2026-08-05 (Joint allocation + per-session rollout gating) — DONE, DEPLOYED edge v222 (flag=0, dormant)
Branch: `feat-quality-cost-model`. Spec: `docs/superpowers/specs/2026-08-04-bounded-joint-allocation-design.md`. Plan: `docs/superpowers/plans/2026-08-04-bounded-joint-allocation.md`. Ledger: `.superpowers/sdd/2026-08-04-bounded-joint-allocation/`.
- [x] **Joint allocation (SDD 4 task + final review):** khi lấp ≥2 sân/1 request + flag ON → `applyJointRepartition` (live-preview.ts, chạy sau #70 gate trước normalize) re-partition tập seated CỐ ĐỊNH qua các sân để min tổng `computeQualityCost`, hill-climb never-worse. Pure search ở `quality-cost.ts` (`bestSplitForFoursome`, `jointRepartition`, `JOINT_MAX_ITERATIONS=4000`). Giữ seated fixed → #70 tự giải (selectedPlayerKey không đổi). Commits 0ad95e6/5673586/4bb4f45.
- [x] **Final review (opus) FIX-FIRST → fixed 9b71c70:** joint pass bỏ qua avoid-partner hard-invariant (computeQualityCost chỉ tính avoid-opponent; scoreMatch chặn avoid-partner NGOÀI cost). Fix: `bestSplitForFoursome` gán Infinity cho split ghép avoid-partner (mirror scoreMatch). LOW#2 (integration test flag-ON inert vì greedy clean = optimal) deferred, replay cover.
- [x] **Replay validation (Task 4, commit 283394f):** engine joint fire 5/7 dump multi-court thật, **không bao giờ tăng blowout** (fb48 xóa 1: gap 2.80→0.92), giảm lặp (938b9bde rep 2→0) + stack (14f2e11a intra 5→1). Never-worse authority = unit test + construction (harness có reconstruction-drift). Bảng trong spec §"Replay results".
- [x] **Driver local + demo (scratch/):** `sim-quality-cost-session.ts` (session mới flag OFF vs ON — engine chạy sạch, joint fire 0 trên 6 seed synthetic vì greedy clean đã optimal); `show-joint-firing.ts` (lineup scoring-only vs scoring+joint trên dump thật, dùng option chẩn đoán `disableJointRepartition`). KẾT LUẬN: joint chỉ fire trên state THẬT lộn xộn, synthetic/round-1 sạch = no-op (đúng thiết kế).
- [x] **Per-session rollout gating (commit d2e5036):** `resolveQualityCostEnabledForSession(sessionId)` (quality-cost-flag.ts) — strict: `SESSION_QUALITY_COST_MODEL=1` AND `SESSION_QUALITY_COST_SESSION_IDS` chứa sessionId hoặc '*' (rỗng=0 session). Edge resolve 1 lần ở boundary → set `state.config.quality_cost_enabled`; mọi gate đọc `isQualityCostModelEnabled(state)` (precedence override>config>env). 6 gate (score.ts×3, live-preview.ts×3) truyền state. Verify end-to-end trên dump thật: session trong allowlist→engine mới (gap 0.92), session khác→cũ (gap 0.48). Blast-radius = đúng session allowlist. 149/149 regression pass, type-clean.
- [x] **DEPLOYED edge session-live-matches-suggest v222 (2026-08-05, ACTIVE)** với secret `SESSION_QUALITY_COST_MODEL=0` → code per-session gating LIVE nhưng dormant (0 session bật, mọi host byte-identical engine cũ). deno check sạch, token ~/.supabase/access-token. Client KHÔNG cần rebuild.
- Next canary: (1) tạo session test trong app → lấy session_id → `supabase secrets set SESSION_QUALITY_COST_MODEL=1 SESSION_QUALITY_COST_SESSION_IDS=<id>` (secret ăn ở request kế, nếu cold thì redeploy 1 lần) → chơi → theo dõi board/`debug_dumps`; (2) tắt = flag→0; (3) nếu keep → rollout rộng (allowlist '*' hoặc bump ALGO) + cleanup theo stub retire-old-scoring.

### Phiên 2026-08-04 (Task 7 — Unified quality-cost model: rollout prep) — DONE (chưa deploy)
Branch: `feat-quality-cost-model`. Spec: `docs/2026-08-04-unified-quality-cost-model-design.md`. Ledger: `.superpowers/sdd/2026-08-04-unified-quality-cost-model/`.
- [x] **7 task tổng quan:** unify scoring dưới 1 cost function (`computeQualityCost`, quality-cost.ts) thay 5 hard-gate `INFINITY_SCORE` cũ bằng soft cost (balance/intra/repeat-escalate/gender/group/avoid-opponent), sau `scoreMatch` flag-gate `isQualityCostModelEnabled()`. Behind flag `SESSION_QUALITY_COST_MODEL`, default **OFF** — flag-OFF path byte-identical mọi task (verify từng task). Task 1 shapes, Task 2 Decision-1 (re-split ≠ rematch), Task 3 soft gates, Task 4 alternative-view, Task 5 wait-rescue, Task 6 calibration A/B, Task 7 (phiên này) rollout-prep.
- [x] **Calibration (Task 6, đã commit `eac0082`):** `DEFAULT_QUALITY_COST_WEIGHTS` — balanceTie 0.1, balanceOver 1.6, intraTie 0.1, intraOver 1.0, repeat2 1.0, repeat3 3.6, repeatStep 2.4, opponentFactor 0.7, genderPartner 0.4, genderOpponent 0.2, groupReward 0.3, groupCap 0.6, avoidOpponent 4.0. Sim A/B (N=20, 4 courts, 8 rounds, seeds=20): blowout% giảm mạnh mọi phân bố (uniform 38.6→5.3, bimodal 45.5→13.8, skewed 29.7→7.5, tight 0.0→0.0 flat), restSpread không đổi, uniqPartners trong nhiễu.
- [x] **Task 7 — sửa gender stat placeholder (Task 3 để dở):** flag-ON branch của `scoreMatch` (score.ts) trước để `stats.gender_pref_penalty=0` (result.cost cost-model ĐÃ tính gender nội bộ qua `genderPref` trong quality-cost.ts, chỉ có display-stat là placeholder). Fix: gọi lại `genderPenalty(teamA, teamB, state, weights)` (helper có sẵn score.ts, ScoringWeights units, cheap) để điền display-stat thật cho host-facing (planner/session-plan.ts → ScreenComponents.tsx). Ranking KHÔNG đổi (cost model tự tính gender riêng). Test mới: `score-quality-flag.test.ts` "fills stats.gender_pref_penalty ... for a lineup with a gender-pref violation" — flag ON, lineup vi phạm gender-pref → `stats.gender_pref_penalty > 0`.
- [x] **REFRAME gate (Task 6 discovery, áp dụng Task 7):** global env `SESSION_QUALITY_COST_MODEL=1` đè TOÀN suite làm 67 test cũ (không dùng `__setQualityCostModelOverrideForTests`) fail — KHÔNG phải regression, chỉ là test cũ assert hành vi OLD-model chạy nhầm code path. Gate ĐÚNG = suite bình thường (flag mặc định OFF), vì flag-ON đã test đúng qua các file dùng override hook (quality-cost.test.ts, score-quality-flag.test.ts, live-preview-wait-rescue-quality-cost.test.ts) chạy NGAY TRONG suite bình thường. KHÔNG chạy global-env whole-suite nữa.
- [x] **Gate xanh:** `npx jest tests/next-round-suggester/unit tests/next-round-suggester/property tests/next-round-suggester/scenario tests/next-round-suggester/fairness tests/host-live --runInBand` → 50 suites / 517 tests pass (không env var). `tsc --noEmit` lọc `^lib/` rỗng. `deno check supabase/functions/session-live-matches-suggest/index.ts` sạch.
- [x] **Bump `LIVE_PREVIEW_ALGORITHM_VERSION` 50→51** (live-preview.ts) — model dormant tới khi flip flag.
- [x] **Follow-up stub:** `docs/superpowers/specs/2026-08-05-retire-old-scoring-model-STUB.md` — liệt kê dọn dẹp sau khi flag permanent ON: (a) migrate/xóa ~67 test characterization cũ; (b) rút gọn 8-stage relaxation ladder pair.ts (nhiều gate giờ redundant dưới soft gates); (c) xóa injected recent-group-rematch-keys cache (pair.ts~560, live-preview.ts~4430, Decision-1 gap) + inline duplicate blowout/repeat detect (live-preview.ts~4990-5060, trùng lặp signal đã có trong QualityCostResult); (d) audit ~9 hàm repair post-pass (repairEarlyPayloadBatchQuality*, repairPayloadBatch{RepeatExposure,SevereRepeatFromPool,BlowoutFromPool}, repairAllIdlePayloadBatchParticipation…) xem cost model đã subsume phần nào.
- [x] **KHÔNG deploy** — theo brief, deploy là quyết định của human (dark rollout rồi A/B, theo dõi `debug_dumps` blowout/repeat/stuck rates, nằm ngoài phiên này).
- Commit: `feat(suggester): fill flag-ON gender stat + bump ALGO 51 + rollout follow-up stub`. Report đầy đủ: `.superpowers/sdd/2026-08-04-unified-quality-cost-model/task-7-report.md`.
- Next: human quyết định deploy dark (flag OFF prod) → flip A/B → theo dõi debug_dumps → nếu keep, chạy cleanup theo stub trên.

### Phiên 2026-08-04 (AUDIT engine + sửa theo nhánh) — ĐANG LÀM
- [x] **Audit đa-agent (11 agent, 71 findings)** → docs/ENGINE_SCORING_AUDIT.md + artifact fault-map. Root chung: KHÔNG phải 4 bug rời mà 1 chuỗi: generator mù-skill (RC2/RC5) chế pool lệch → scoring định giá cân rẻ nhất + 5 cổng INFINITY xoá split cân (RC3/RC7) → greedy convert (RC1, chỉ nhiều-sân) → ~16 repair relocate (RC4). Critic bác "greedy là root chung" (chỉ đúng nhiều-sân; ca sân-lẻ phổ biến do generator). Bắt được #70: rollingPlanTarget revert 2 pull-from-bench repair (latent, plan đang off).
- [x] **BƯỚC 1 — Generator fix (RC2), DEPLOYED ALGO 49:** `selectRequiredIdsForCourt` thêm **band-cap** — chỉ force owed trong dải INTRA_TEAM_PVNA_GAP_LIMIT(1.0) quanh anchor; skill-outlier bị defer → buildLiveTierOverrides hạ FLEXIBLE → engine tự lấp chỗ bằng người gần-trình, scoring loại blowout qua cổng tolerance. **Trị blowout tại GỐC** (không phải post-pass). Repro 60d0: GAP 3.00→0.41, deg=blowout→CLEARED, KHÔNG cần post-pass (post-pass giờ chỉ lưới an toàn). No-op khi owed đã cohesive. Verify: repro + unit band-cap 4/4 + unit/host-live in-band 315/315 + repro-c1 multi-court không regress. deno check pass.
- [x] **BƯỚC 2 — corrector rest_violation (RC2), DEPLOYED ALGO 50:** User hướng "blowout = phương án CUỐI". Bỏ nới `pvna_tolerance +0.15` GLOBAL (1 người nghỉ nhiều → nới guard blowout mọi sân), GIỮ ép MUST_PLAY. Ca kẹt thật để relaxation-ladder per-court nới (đúng sân đó). Verify: fairness 64/64 + simulation sanity 11/11 (KHÔNG rest-starvation) + cập nhật test "applies multiple adjustments" (pvna_tolerance→undefined). corrector.ts:74-80.
- [x] **BƯỚC 3 — budget/stuck (RC6), DEPLOYED ALGO 50:** `regularBudgetMs` luôn chừa `RESCUE_BUDGET_RESERVE_MS=200` cho forced/exhaustive rescue (trước: default 1000ms → regularDeadline=runtimeDeadline, reserve=0 → rescue bị skip → NO_VALID_MATCH giả). suggest.ts:270-272,583-590. Verify: unit+property+scenario+fairness 444/444 + host-live 51/51 + repros giữ nguyên.
- [~] **BƯỚC 4 — score correctness (RC3): HOÃN** (cần A/B + quyết định design). getMatchGroupKey bỏ ranh giới đội (+80 giả) — nhưng "chặn same-4 re-split" có thể CHỦ ĐÍCH cho variety, cần user quyết; double-count repeat + 2 scorer ngược chiều — ripple mọi suite, audit ước tính 1-2 tuần + full A/B gate. KHÔNG rush vào phiên này (tránh sửa mù).
- [~] **BƯỚC 5 — #70: HOÃN đúng chỗ** = điều kiện tiên quyết Nhánh 3. Cách sửa đúng PHỤ THUỘC thiết kế joint-solver (chưa xây); đang zero-effect (plan off → getActiveRollingInvariantTarget falsy → không revert). Sửa speculative bây giờ = đoán mù.
- Tổng: 3 fix root-level deployed ALGO 49→50 (generator band-cap + corrector no-global-relax + budget reserve). Bước 4/5 hoãn có lý do rõ (A/B + design-dependency).

### Phiên 2026-08-04 (session 60d0586b — "sân 3 vòng 3 lệch nhiều") — FIX xong, DEPLOYED ALGO 48
- [x] **Diagnose + dump prod:** sân 3 = court_idx 2, r2, GAP=3.00 [Uyên2.31,Tùng2.42]v[Đỗ Hương3.23,Bảo4.50], engine EXHAUSTIVE_FALLBACK (relax pvna +2.5, intra +0.52).
- [x] **ROOT (proven repro):** rolling lấp **sân lẻ** (count=1). 6 người owed (chơi r0-nghỉ-r1, cr=1 → MUST_PLAY) trải 2.31-4.92 (bimodal). `selectRequiredIdsForCourt` (1703) + `deferLowViabilityRequiredIdsForCourt` (1739) đều **BAIL khi remainingCourtsInRound<=1** → không gom-trình, không defer → force bimodal 4 → blowout. deferLowViability dù chạy cũng giữ Bảo (có partner gần trình trong pool) → không phải lever đúng. Lỗ hổng của fix [[project-blowout-required-selection]] cũ (chỉ gom khi >1 sân).
- [x] **Repro faithful (scratch/repro-60d0.ts):** buildSuggestedMatchPayloads court 2 ra ĐÚNG blowout prod. Bẫy: snapshot `consecutive_rest=0` STALE cho mọi người → phải recompute cr từ round membership (max completed logical round − last_played_round) mới tái hiện MUST_PLAY.
- [x] **FIX (live-preview.ts, ALGO 47→48):** hàm mới `repairPayloadBatchBlowoutFromPool` — post-pass isolated, chỉ fire khi payload `degraded_reason==='blowout'`: swap skill-outlier ra bench, kéo filler gần-trình vào (re-split), objective = min team-gap (cost: trong-tolerance→ít-lặp→gap chặt). Guards: intra ≤ HARD 1.0, không tạo rep≥3 mới, không avoid-pair, **hasNearLevelPeer** (không strand outlier lẻ — nếu Bảo không có peer gần trình trên bench thì GIỮ blowout để panel hiện). Dừng khi gap ≤ tolerance (chỉ defer đúng outlier, không over-defer). Wire ở call-site cho single-court (bench tính riêng, không gate ≥2 như repeat repair).
- [x] **Verify:** repro c2 GAP 3.00→0.08 [Uyên,Thắng3.26]v[Tùng,Đỗ Hương], chỉ defer Bảo (outlier); Bảo còn Thảo4.57/Hồ Vy4.92 trên bench → rolling seat cân vòng sau. Unit test mới 5/5 + repeat 4/4. suggester unit in-band 264/264, host-live in-band 51/51 (8-fail lần chạy parallel = flaky worker contention máy tải nặng, re-run 315/315). deno check pass. **DEPLOYED edge ALGO 48.** Edge board-wide pass recompute degraded → gap 0.08 clear cờ blowout prod.
- [ ] **USER verify prod:** mở lại session/sân lẻ có owed pool bimodal → sân giờ ra cân (defer outlier owed 1 vòng, chơi cân vòng sau) thay vì blowout. Chi tiết [[project-rolling-single-court-blowout-defer]].

### Phiên 2026-08-03 (session 93564c1c — "sân 2 vòng 5 ko cứu dc lặp 3") — ENGINE FIX xong, DEPLOYED ALGO 47
- [x] **ĐÍNH CHÍNH root cause (2 giả thuyết per-court bị BÁC):** (1) `selectRequiredIdsForCourt` force người lặp-nặng → SAI (c3 req rỗng vẫn rep-3); (2) repeat-rescue per-court → vô dụng (c3 lấp trước đã cướp người c1 cần). Cả 2 đã revert khỏi engine.
- [x] **Suýt sai:** gọi `scoreMatch` sai chữ ký (arg4 = options-object, truyền số) → Infinity → định bỏ repro như "artifact". Gọi đúng: scoreMatch finite, chấm rep-1=64.7 << rep-3=164.1 (severe-penalty OK), reconstruction FAITHFUL.
- [x] **ROOT CAUSE THẬT (proven brute-force real-data):** request lấp **nhiều sân/1-request** (`replace_courts` [3,1] count=2) fill **greedy tuần tự** → c3 lấp trước chiếm người tươi → c1 chỉ còn rep-3. Tồn tại gán JOINT cả 2 sân **rep=1 TRONG tolerance 0.5** (c3 gap0.24, c1 gap0.49) → greedy bỏ lỡ joint optimum. Khớp [[project-repeat-first-selection]].
- [x] **FIX (engine, live-preview.ts, ALGO 46→47):** hàm mới `repairPayloadBatchSevereRepeatFromPool` — pull-from-bench: khi ≥2 sân/request và 1 payload rep≥3, swap người tươi từ bench vào (re-split), objective `scorePayloadRepeatRepair` (partnerX3*1000/opponentX3*140). Guard: KHÔNG bench người owed hơn (mayReplace: rest-recovery→ít matches), KHÔNG vượt pvna/intra HARD limit (1.0), KHÔNG tạo avoid-pair. Wire ở call-site sau participation repair, dùng `repairState`+bench từ eligible−baseBusy−selected. Sân kẹt thật (cụm same-skill cạn cặp) để nguyên → panel degraded hiện (đúng UX).
- [x] **Verify:** repro `scratch/repro-c1.ts` c1/sân 2 **rep3→rep1** [8223,494a]v[9ad4,d1a9]; c3 kẹt rep-3 (đúng). Unit test mới 4/4 (swap, fairness-guard, no-op×2). host-live 31 suite pass. lib/ typeclean. deno check edge pass. **Edge board-wide pass overwrite degraded → c1 rep-1 sẽ clear flag prod.**
- [x] **LƯU Ý sim:** `npm run sim` dùng `suggestNextRound` (round-planning), KHÔNG đi qua live path `buildSuggestedMatchPayloads` → sim KHÔNG cover fix này (verify bằng real-data repro + unit test thay thế).
- [x] **Suite verify:** property/scenario/fairness 175/176 (1 fail seed-80 = FLAKY perf-timing `elapsed<1800` do máy tải nặng, PASS khi chạy riêng, KHÔNG import live-preview → không do fix); unit 305/306 (+4 mới); host-live 31 suite. Full `tests/next-round-suggester` treo 1.5h = simulation stall (harness limitation đã biết, dùng suggestNextRound) → đã stop, chạy subset thay.
- [x] **DEPLOYED edge session-live-matches-suggest ALGO 47 (2026-08-03).** Server-side, hiệu lực NGAY request suggest kế (KHÔNG cần client rebuild cho fix này). Baseline revert: commit a5b2468 + hàm isolated (`repairPayloadBatchSevereRepeatFromPool` + wire + ALGO) nếu regress. Chi tiết [[project-multicourt-joint-repeat-repair]].
- [ ] **USER verify prod:** mở session có ≥2 sân xong cùng lúc + có sân rep-3 → sân cứu được (có người tươi bench) giờ ra rep<3; sân kẹt thật (cụm yếu cạn cặp) vẫn rep-3 + hiện panel degraded (đúng). Client re-suggest "Chờ Sân X" vẫn cần rebuild (phần riêng).

### Phiên 2026-07-30 (session 938b9bde — "sân trống kẹt im lặng, sao ko bốc thêm người") — DONE, LIVE
- [x] **Client (silent-stuck message):** sân trống temp-limited hiện text mơ hồ "Đang chờ trạng thái trận cập nhật" → đổi thành minh bạch + biết phải làm gì (ScreenComponents.tsx: temp/real/waiting). **CẦN REBUILD.**
- [x] **ROOT CAUSE (đào từ dump prod, KHÔNG đoán):** sân trống kẹt ~6 phút dù dư ≥12 người rảnh. Dump 03:55: `output_payload_count=0`, `max_courts_with_free_players=3` nhưng selection `busy_count=31, eligible=1`. Nguyên nhân: `rollingHorizon` bị buộc chung `rollingPolicyEnabled` (plan đã tắt) → engine dùng strict logical-round, `courtRoundBusyIds` giữ mọi người đã chơi lượt-logic → 1 eligible → 0 trận. `plan_consumption.enabled=false` (KHÔNG phải bug plan). Đính chính chẩn đoán cũ "khóa lượt logic" giờ mới thật sự verify.
- [x] **FIX (edge):** tách flag riêng `SESSION_ROLLING_HORIZON` (default ON, kill-switch =0); `rollingHorizon: rollingHorizonEnabled`; `rollingPlanTarget` GIỮ gate plan → không lôi lại bug plan-noop. Thêm `rolling_horizon_enabled` vào debug dump. Bump ALGORITHM_VERSION 35→36.
- [x] **Verify:** probe `scratch/probe-rolling-stuck.ts` replay đúng dump kẹt → OFF 0 trận (tái hiện), ON ra trận hợp lệ. Test rolling-horizon-matrix/chain + live-preview 85/85 pass. deno check pass. **Deployed edge v197 ACTIVE.** Chi tiết [[project-rolling-horizon-decouple]].
- [x] Sim sanity fail (rounds_completed=1/8) = **TỒN SẴN branch** (stash-prove baseline fail y hệt), dùng suggestNextRound core engine ≠ path live. (Session song song đã đào: budget-starvation forced-rescue, production ko dính.)
- [x] **FIX blowout required-selection (edge v198 ALGO v37):** session 35ca2cb6 trận chênh 1.98 dù dư người. Root (dump+replay): `selectRequiredIdsForCourt` fill 1 sân lẻ dùng bucket gom cao-nhất+thấp-nhất → foursome 3 mạnh+1 yếu → luật intra ép blowout. Đổi sang **neo người ưu-tiên + gom sát trình** → replay 1.98→0.33. Nguyên tắc user: gom cùng tầm trước, ko ổn mới bimodal (bimodal CHƯA làm). Chi tiết [[project-blowout-required-selection]].
- [x] **Sửa stale test** `live-preview-rescue-failsoft`: fail KHÔNG do fix (revert-prove); test viết cho hàm cũ explainMatchCompromises, hàm mới explainMatchOptimality xử lopsided-fresh bằng nhánh generic ko-đọc-tên. Đổi test sang kịch bản lặp → fault-injection hiệu lực lại. Unit 254/254 xanh.
- [x] **Data-driven bỏ bimodal:** đo `measure-forced-blowout.ts` sau fix chọn-người → FORCED=0 mọi scenario (pool luôn có cụm 4 sát trình) → bimodal cứu 0 case thật → KHÔNG đụng scoring core. Residual AVOIDABLE ~1-2% = căng fairness-vs-trình ở anchor, để nguyên.
- [ ] **IN PROGRESS: Persist degraded fields vào DB (trị gốc ephemeral).** User approve. Thêm cột degraded_reason/rescue_court_idxs/match_explanations vào session_live_matches; sửa 2 persist RPC (replace_live_session_suggestions_versioned + replace_planned_...) + snapshot RPC (get_live_session_snapshot_versioned) + edge getPreviewMatchesToPersist include 3 field; client snapshot tự có → bỏ reattach v4. Lý do: panel cần degraded_reason+rescue_court_idxs nhưng ephemeral → nhiều đường client (hydration/sticky-merge committed-thắng/cache) làm rơi → vá client thua. Đang map vị trí RPC.
- [x] **FIX Sân trống kẹt (full_board conflict, CLIENT cần rebuild):** session 8dfbc2b1: 5 sân live + c4 trống, 13 người rảnh nhưng kẹt. Root (audit): reusable=0 → full_board → persist đụng 20 người live "already assigned" → terminal → không commit. FIX (TDD) `computeShouldRequestFullBoardPreview`: `reusableMatchCount===0 && !shouldRecoverMissingPreviewCourts` → khi sân trống fit replacementMax=2 dùng replace_courts thay full_board. preview-predicates test fail→pass; cập nhật 2 characterization (mode full_board→replace_courts mount). host-live pass, tsc sạch. Chi tiết [[project-empty-court-fullboard-conflict]].
- [x] **FIX A latency edge auth (deployed 2026-08-02):** đào+đo trước khi sửa (session 8dfbc2b1): auth `getUser` (network GoTrue) p50 124ms/**max 5195ms** = thủ phạm tail; engine chỉ 75ms. Thay `requireHost` `getUser`→`getClaims` (verify ES256 cục bộ, không round-trip) + fallback getUser. deno check pass, deployed session-live-matches-suggest. Verify success-path qua prod dump `timing_ms.auth` sau khi user mở session. Còn Fix B (optimistic re-suggest, cắt client-gap 1.3s) + C chưa làm. Chi tiết [[project-edge-auth-getclaims-latency]].
- [x] **FIX "Chờ Sân X" — v4 ROOT CAUSE SÂU (CLIENT, cần rebuild):** v3 vẫn fail (724475bd). Trace tiếp: `degraded_reason` KHÔNG lưu DB (edge persist chỉ 8 cột) → client hydration dựng persisted lane từ DB row → XOÁ degraded_reason đúng lúc completion → detection=false. FIX: reattach degraded fields qua hydration từ bản in-memory cùng court+lineup (mirror edge reattachDegradedPreviewFields). TEST `wait-rescue-resuggest.test.tsx`: complete court0 → court_idxs ⊇ [2] (rescue=[1] còn live nên loại logic cũ); negative-control FAIL [0], có fix PASS. host-live 50/50, tsc sạch, eslint 0 error. **CHƯA QA app.** ⚠️ Nếu vẫn fail sau rebuild: cân nhắc PERSIST degraded_reason vào DB (migration+RPC) = bản authoritative triệt để.
- [x] **FIX "Chờ Sân X" không tự re-suggest — v3 EVENT-DRIVEN (trigger, cần v4 mới đủ):** 3 lần trước fail vì cùng lớp lỗi (suy signal render-time). Trace dump prod session 5a87688f: rescue-list bị board-wide pass VIẾT LẠI mỗi request (Sân2 rescue [0,3,4,5]→[0,2,4] bỏ Sân4) + verified count (completed+live, complete ko đổi) & seq & timestamp (client đóng dấu suggested_at mới mỗi merge) đều KHÔNG phân biệt "live vs vừa xong". Tín hiệu đúng duy nhất = sự kiện completion `completedLiveMatchCommitNonce`. FIX useLiveBoard.ts: `isDegradedMatchAwaitingRescue = degraded && nonce > rescueHandledNonceRef`; revert 2 gate về nguyên bản (degraded đi thẳng dispatch, ko qua invalidation-return → tránh loop); short-circuit skip + target replace_courts; set handled=nonce tại dispatch (one-shot/completion, ko thrash). tsc sạch, eslint 0 error, host-live 49/49 (runInBand). **CHƯA QA app — cần rebuild.** ⚠️ Cần xác nhận build hiện tại của user có chứa fix ko (v2 có thể chưa vào build). Chi tiết [[project-wait-rescue-feature]].
- Next: (1) USER rebuild app → test cả 3: message client, trận suggest cân hơn, "Chờ Sân X" giờ tự re-suggest; (2) [tùy] residual anchor-outlier ~1-2%.

### Phiên 2026-07-29 (Task W-QA: test client render wait-rescue banner) — DONE
- [x] Commit `a5b2468` `test(host-live): ...`: thêm `tests/host-live/characterization/wait-rescue-banner.test.tsx` (4 test) chứng minh `SuggestedLiveMatchCard` đọc `match.degraded_reason/rescue_court_idxs/match_explanations` từ edge preview và render đúng banner/label/list "Vì sao xếp trận này"; rescue rỗng → ẩn cả banner nhưng vẫn startable. Breakability verify bằng mutation tạm (revert, diff sạch). Gate: 61/61 host-live+host-match xanh, typecheck lỗi chỉ ở tmp/scratch (pre-existing), check:encoding không flag file mới. Chi tiết: `.superpowers/sdd/2026-07-27-host-live-logic-ui-separation/task-WQA-report.md`.
- Owner vẫn cần QA tay: xem banner thật trên app (màu/wrap/icon), xác nhận edge v191 thật sự gắn 3 field cho blowout thật, và bấm nút Bắt đầu trên trận degraded để xác nhận start thật hoạt động.

### Phiên 2026-07-29 (REFACTOR tách logic/UI host-live + host-match) — DONE, chờ QA + merge
Kế hoạch: docs/superpowers/plans/2026-07-27-host-live-logic-ui-separation.md. Ledger đầy đủ: .superpowers/sdd/2026-07-27-host-live-logic-ui-separation/progress.md. Commits a39dcf1→f758882.
- [x] Sweep audit (scalability + auditability) + code-quality audit (god components) → SCRATCHPAD.md.
- [x] Refactor behavior-preserving (subagent-driven, mỗi task review + gate): NextRoundSuggesterScreenV2 **4148→1061 dòng** (tách useLiveBoard = preview+mutation+18 lifecycle effect giữ đúng thứ tự đăng ký, usePreviewTelemetry, useScrollDebug, preview-helpers, preview-consistency predicates); HostMatchScreen **1754→1222** (host-match/{scheduleGenerators, api, useHostMatchController}). **Engine lib/next-round-suggester = 0 thay đổi** (git-verified).
- [x] QA app §7: PASS (owner). Lưới an toàn: 6 characterization test host-live + host-match.
- [x] Cleanup CL1-3: dedup toUserSafeActionError/incrementPair/buildProjectedStateAfterLiveMatch, consolidate type SuggestedLiveMatchRow (6→1), xoá dead code (LiveMatchBoard/RoundDivider/{false&&} blocks).
- [x] **FU3 bug hydrate-stomp FIXED** (commit e58b77b test + 3697a9d fix): effect hydrate DB-suggested replace→MERGE, giữ lane ephemeral cho sân vừa trống sau mini-recover (7 bộ lọc). **BEHAVIOR CHANGE → cần owner QA tay.**
- [x] FU-minor: tách suggestedLaneCacheRef khỏi setState updater (mirror-ref). FU2: điều tra existingRound-status = no-op (verified 2 tầng), dedup an toàn.
- [x] Regression: 114-115 React/host test + snapshot xanh; 681 engine test xanh. 4 fail duy nhất = **performance-target xlarge/tier của engine trên máy tải nặng** (avg suggest 85/1151/1294/1496ms vs ngưỡng 50/150/500/1000) — KHÔNG do refactor (targets.test.ts không load code đã sửa; engine untouched). Fairness 24/24 pass.
- Next: (1) **owner QA FU3** (complete sân live khi còn persisted-suggested → refill hiện & không biến mất ~1s, không trùng người); (2) merge branch; (3) redesign UI (mục tiêu gốc, giờ logic đã tách); (4) [tùy] điều tra engine perf-target (tách biệt).
- OPEN decisions ghi SCRATCHPAD: — (không còn; FU2 đã kết luận no-op).

### Phiên 2026-07-29 (session e945f825 — "kẹt phải complete sân khác, ko có thông báo")
- [x] Diagnose + engine_instrumentation: 2 điểm "kẹt" bạn báo = anti-blowout defer, KHỚP 100%:
  - Sân 3 R6: `rolling_quality_deferred court=2 pvna=2.01` ~27s → `swap` khi avail 13→17.
  - Sân 1 R8: `rolling_quality_deferred court=0 pvna=3.18` ~19s → `swap` khi avail 13→17.
  - Cả 2 = nhánh `persistentOutlier` (pvnaGap>max(1.5,tol+1)=1.5, bỏ qua pool size) — [[project-blowout-vs-balance-fix]]. KHÔNG phải bug. Complete 1 sân = escape valve đúng thiết kế.
- [x] User: "ko đổi biên, nhưng chưa có thông báo cần complete sân khác → tưởng lỗi". ROOT: banner `qualityDeferredCourts` ĐÃ có+commit (v26) + edge trả `quality_deferred_courts` đúng, NHƯNG **app chưa rebuild** nên ko chạy. Copy cũ còn thụ động ("engine đợi").
- [x] Sửa copy banner NextRoundSuggesterScreenV2.tsx (chỉ text, ko đụng ngưỡng): thêm action "hoàn thành một sân đang chạy để mở khóa NGAY".
- [x] **User: rebuild rồi banner VẪN ko hiện → debug hệ thống (systematic-debugging).** Verify bằng data prod thật (debug_dumps + engine_instrumentation + deployed edge body), KHÔNG đoán:
  - Edge v185 deploy SAU commit 9b9e19a 19s → CÓ code field. Dump lúc kẹt: `target_court_idxs=[2]`, `missing_target_courts=[2]`, `partial_full_board_request=false` → edge trả `quality_deferred_courts=[2]` ĐÚNG.
  - **ROOT (client):** `setQualityDeferredCourts(res.quality_deferred_courts)` nằm TRONG `if(edgeReturnedFinalBoard)` (useLiveBoard.ts). Anti-blowout defer trả board RỖNG → `edgeReturnedFinalBoard=false` → nhánh bị bỏ qua → setter KHÔNG chạy → state mãi `[]` → không banner. Rebuild vô ích vì code sai cấu trúc, không phải build cũ.
  - **FIX:** hoist `setQualityDeferredCourts` ra TRƯỚC nhánh board (chạy mọi response, kể cả board rỗng) + bỏ setter trùng. typecheck:guard sạch (lỗi preview.ts TS2305 là pre-existing, không do fix). **CẦN REBUILD.**
- [x] **Fix 2 (preview.ts import gãy):** `isRecentSuggestedLiveMatch` bị commit 473fd44 XÓA khỏi live-preview.ts (chủ đích: "persisted suggestions là khóa authoritative, tuổi đời ko làm rảnh người"), nhưng bản refactor preview.ts giữ bản cũ. `buildSuggestedMatchPayloads` ở preview.ts đã DEAD (moved to edge). Fix = mirror y 473fd44: bỏ filter tuổi + bỏ import. TS2305 hết.
- [x] **Bonus (court-calculator/warnings.ts):** TS5097 pre-existing — import type NHIỀU DÒNG khiến `@ts-ignore` (che `.ts` cho Deno) không phủ dòng module-specifier. Gộp về 1 dòng như import khác trong file → hết lỗi, giữ `.ts` cho Deno.
- Note: guard vẫn đỏ do baseline cũ (lỗi pre-existing ở scripts/tests: verify-suggest-quality.ts, factories.ts, tmp/, scratch/ — KHÔNG phải file đã sửa). 4 file mình đụng đều sạch tsc.

### Phiên 2026-07-27c (session 1abb3410 v23 — "kẹt phải complete sân khác")
- [x] `83add87` fix ROOT #4 (EDGE, ĐÃ DEPLOY): `shouldDeferTightPoolSuggestion` bỏ defer theo intra (chỉ defer blowout tổng-đội). Verify timeline: sân fillable 30s mà bị giữ = tight-pool quality-defer intra>2, mâu thuẫn 286f79c. Bump v24, unit 251/251. Client cần rebuild v24. Chi tiết [[project-board-stuck-persisted-intra]] ROOT #4.
- Xác nhận trên v23: severe (under-fill/nhảy round/rest-miss) ĐÃ HẾT; chỉ còn latency defer này.

### Phiên 2026-07-27b (session dafe6fa5 — board-stuck residual)
- [x] `ca0bad0` fix board-stuck ROOT #3: rest-priority-miss vs deferLowViability đánh nhau. `hasMissingRestPriorityPlayer` thêm near-level filter + tách `restMissForcesFullBoard` (chỉ ép full-board khi board đầy; sân trống → mini-recover fill, không bị chặn). Verify mini-recover seat được cr≥1. Test 189/189, bump version 22→23. **CẦN REBUILD.** Chi tiết [[project-board-stuck-persisted-intra]] ROOT #3.

### Phiên 2026-07-27 (session d5f4e31f — test sau rebuild)
- [x] `286f79c` fix board-stuck EARLY-round: bỏ hẳn intra hard-cap mọi round (b0cc4ad chỉ bỏ late). Verify R4 under-fill do gate reject intra>1.0 ở round 4. **CẦN REBUILD lại app.**
- [x] `685b0de` fix diagnose (fairness 100 giả → 63 đúng, dùng buildCompletedLiveCycleRows+replay+gender pref) + report giải thích rest-vs-balance tradeoff. Chi tiết [[project-fairness-rest-diagnose]].
- [x] Verify consecutive rest (4 người R4-R5) = BY-DESIGN (deferLowViability tránh blowout gap 3.87), KHÔNG phải bug. Guard cr≥1 giữ ở full-round, live override có chủ đích.
- [x] Sim harness exact-fill fail = known limitation (harness-only) → đã REVERT thử nghiệm budget/determinism, để nguyên.
- Session d5f4e31f: fairness THẬT 63/100 (acceptable) — kéo xuống bởi gender-pref 52% + rest lệch. KHÔNG "khỏe 100" (số cũ do diagnose bug).

### Completed

**A. Fix engine/live (ĐÃ LIVE prod — edge v182, KHÔNG cần rebuild)**
- [x] `9418d9d` async single-court blowout (gap 4.99): defer PVNA-incompatible resters khi count=1. Ship algorithm v20.
- [x] `0555878` replace_courts không ra lineup → không wipe suggestion cũ (edge).
- [x] `180508d` board-stuck: sân persisted intra>1.0 (pool rộng) không bị ép full-board re-suggest thrash.
- [x] `5b636bd` nới ngưỡng intra hard-cap theo round (round≥5 → 2.0) cho pool rộng.
- [x] `e73c024` recommendation KHÔNG làm hard target: planned_total_rounds/target-reached/auto-report chỉ dùng explicit targetRounds → hết should_end + report tự pop chặn court cuối.
- [x] `6cf67bd` blowout-vs-balanced: guard Stage 5.5/6, không trả blowout cực đoan khi có split cân hơn hẳn. Ship v21, sim 24/24 pass.
- [x] `c32ba67` RPC #3: round-completion không reset người đang trong match `live` (migration `20260726000001` deployed, pgTAP test kèm).

**B. Fix client dashboard/lifecycle (đã merge main — CẦN REBUILD APP mới có)**
- [x] `60e38d4`+`32aaf6c` nút "Kết thúc kèo" (V2 recap) → sessions.status='done' (KHÔNG 'finished').
- [x] `3a4bc39`+`3e15fa1` dashboard: mục "Đang diễn ra" tách 'playing' + null-slot aging theo created_at.
- [x] `cd3488b` LOW: handleFinishSession .select() rows-check, empty-state box, comment liveMatchGuards.

**C. Server-side data/config (đã live)**
- [x] Plan-consumption TẮT (SESSION_PLAN_ROLLOUT_SESSION_IDS='').
- [x] Backfill 124 session bỏ hoang 'playing'→'cancelled' (sạch host + player side).

**E. Report sync-warning + consistency (2026-07-26)**
- [x] REVERT fix #3 sai (`0ee2343`, migration `20260726000002`) — nó inflate consecutive_play; restore RPC gốc đúng. (Bài học: agent finding có thể sai, PHẢI reproduce.)
- [x] `2dbf0de` report consistency check chỉ warn khi matches/partner/opponent lệch (bỏ consecutive_* order-fragile) + unit test.
- [x] Repair DB consecutive_play cho f2fd (8 người, Tùng 5→2).
- [x] Sweep audit lớp consistency/drift (3 agent) — VERIFY empirical: KHÔNG có bug mới confirmed-active (last_played_round/consecutive_rest 0 drift thật; client desync transient self-healing; snapshot trả full rows nên không phantom). Không sửa gì thêm (tránh sửa mù).

**D. Đánh giá chất lượng session f2fd04b4**
- [x] 80% trận trong cap, gap TB 0.34, fairness 100/100 = TỐT. Over-cap 20% phần lớn cấu trúc (pool spread 2.67, 11 outlier).
- [x] Bất thường (R5 under-fill 4/6 sân, R8 churn 10 cancel, nghỉ-2-vòng) = hệ quả bug stuck đã fix.
- [x] Slow suggest = 3 board_stuck_events (5-8s) trong cửa sổ stuck.

### Next steps
- [ ] **USER: rebuild/deploy app** (không dùng Vercel) → phần client (B) mới có hiệu lực. Verify: court cuối fill đủ, report không tự pop, có mục "Đang diễn ra".
- [ ] (tùy chọn) Client Bug 1 cũ ship kèm rebuild.

### Key decisions
- KHÔNG sửa #2 (rest bookkeeping expected_round_matches): test-transaction → under-fill reset ĐÚNG, không phải bug.
- KHÔNG sửa latent/by-design: phantom court (unreachable), 'closed' (ambiguous), dead-retry, tolerance-floor, non-determinism.
- Blowout fix + #3 fix: validate trước (sim / test-transaction reproduce) — không sửa mù.
- Deploy: RPC/backfill qua Management API /database/query; edge qua `supabase functions deploy` token ~/.supabase/access-token.

### Files touched
lib/next-round-suggester/{live-preview.ts, pair.ts}; features/host/session-detail/{NextRoundSuggesterScreenV2.tsx, liveMatchGuards.ts, next-round-v2/{flow-sheets.tsx, useNextRoundModel.ts}}; app/host/dashboard.tsx; supabase/migrations/20260726000001_fix_rester_excludes_live_players.sql; supabase/tests/rester_excludes_live_players_test.sql
