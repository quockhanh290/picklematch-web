# Rà soát panel alternative — kết quả đo (2026-08-16)

Hợp đồng của đợt này: **chỉ đọc**. Không sửa code, không commit, không chạy lệnh đổi trạng thái.
Mọi con số dưới đây lấy từ **prod thật** (bảng `debug_dumps`, `session_live_matches`, định nghĩa hàm
đang chạy trong Postgres, và Management API), không suy từ code.

Nền đo: `HEAD = d616f54`, tag `baseline-algo-81`. Kênh SQL chỉ-đọc tới project `mzqsxgfvtgmsscbqugni`.

---

## Kết luận một dòng

**Panel đánh đổi không tới tay host, và đã như vậy liên tục từ 25/07.** Engine vẫn dựng nó bình thường,
nhưng cú ghi xuống cơ sở dữ liệu làm rơi mất, và bảng đấu trả về cho ứng dụng được dựng lại **từ chính
những dòng vừa ghi** — nên thứ rơi mất không bao giờ quay lại. Mọi cuộc bàn về "panel nên có mấy hướng"
trong ba tuần qua đều đang bàn về một thứ không hiển thị.

---

## 1. Prod đang chạy gì

| | giá trị đo được | nguồn |
|---|---|---|
| Kèo thật gần nhất | `893b1427…`, 16/08, 53 lượt, kết thúc 04:00:16 UTC | `debug_dumps` |
| Bản engine kèo đó chạy | **ALGO 79**, deployment `…_278` | `payload->engine_build` |
| Bản edge đang ACTIVE | **v280**, cập nhật 16/08 **09:04 UTC** | Management API |

**Chưa có kèo thật nào chạy ALGO 80 hoặc 81.** Hai bản đó lên sau khi kèo cuối kết thúc 5 tiếng. Ghi chú
trong `TASK.md` ("đã deploy v279/ALGO 80") đúng về việc deploy, nhưng dễ đọc nhầm thành "đã chạy thật".

**Cờ** (đọc từ Management API; giá trị trả về là sha256, đã giải bằng đối chiếu):

| cờ | giá trị | hệ quả |
|---|---|---|
| `SESSION_QUALITY_COST_MODEL` | `1` | bật toàn cục… |
| `SESSION_QUALITY_COST_SESSION_IDS` | **rỗng** | …nhưng danh sách rỗng ⇒ **TẮT cho mọi kèo** |
| `SESSION_BOARD_OPTIMIZER` | `1` | bật toàn cục… |
| `SESSION_BOARD_OPTIMIZER_SESSION_IDS` | **không rỗng** | …**đang chạy thật** |
| `SESSION_PLAN_ROLLOUT_SESSION_IDS` | rỗng | plan consumption tắt |

⚠️ **`TASK.md` ghi P2-2 là "cờ TẮT, allowlist rỗng, CHƯA CANARY" — prod nói ngược.** Bộ tối ưu bàn đấu
đã chạy trên **đúng hai kèo gần nhất**: `893b1427` (16/08) và `3e31e9a7` (15/08), với `optimizer:entered`
**105 lần** và `optimizer:changed` **54 lần** trong 12 ngày. Ai đó đã bật canary mà bảng trạng thái chưa
cập nhật. Đây là nhãn trạng thái sai, không phải lỗi code.

---

## 2. Bảng phát hiện

| # | hiện tượng | cơ chế | bằng chứng đo được | mức | đề xuất |
|---|---|---|---|---|---|
| **A1** | Host **không bao giờ** thấy panel đánh đổi, từ 25/07 tới nay | Cú ghi xuống DB chỉ nhận 11 cột và không có ô nào chứa panel. Xong việc ghi, edge **vứt bảng đấu của engine đi và dựng lại từ chính các dòng vừa đọc về** (`session-live-matches-suggest/index.ts:1457`), rồi chỉ gắn lại đúng 3 trường phụ (`_shared/preview-degraded-fields.ts`). Panel không nằm trong 3 trường đó. Bảng trả về cho ứng dụng (`index.ts:1989`) chính là bảng đã bị tước, và ứng dụng đọc thẳng từ đó (`useLiveBoard.ts:871`) | Bảng đấu **sau** khi ghi, từ 25/07: **0 / 58** trận có panel (trước đó: 210/3283). Dòng trong DB có panel: **52 dòng, dừng hẳn ở 24/07**, sau đó **0 / hơn 1200 dòng** | **NGHIÊM TRỌNG** | Sửa ở tầng ghi (xem A2), không vá ở client |
| **A2** | Vì sao nó vỡ đúng ngày đó | Bản vá 12/07 **không viết lại hàm** — nó đọc định nghĩa hàm đang chạy, thay chuỗi văn bản, rồi nạp lại, và tự thoát nếu thấy đã có. Một bản cập nhật hàm sau đó (`20260722000004…`) nạp lại **bản gốc vốn không có panel** → xoá sạch bản vá, không một lời báo. Bản vá đã chạy rồi nên không bao giờ chạy lại | Dòng DB cuối cùng còn panel: **24/07**. Định nghĩa hàm **đang chạy trên prod** không hề nhắc tới ô chứa panel (kiểm trực tiếp trong Postgres) | **NGHIÊM TRỌNG** | Bỏ hẳn lối vá-bằng-chuỗi. Đưa panel vào bản cập nhật hàm tường minh, HOẶC bỏ đường DB và mang panel về thẳng trong câu trả lời của edge |
| **A3** | Thẻ "Chờ sân / Chơi luôn" **chưa từng** ghi được một dòng nào, suốt toàn bộ lịch sử | Chỗ ghi nó (`index.ts:1547`) đọc dữ liệu từ **bảng đã bị tước** ở A1 → luôn rỗng → luôn ghi `{}` | **0 dòng** trên toàn bộ 6214 dòng lịch sử | **CAO** | Sửa A1 là hết; nếu không thì phải đọc từ ảnh chụp trước khi ghi |
| **A4** | Hai trong ba đường sinh "Chờ sân / Chơi luôn" **cấu trúc không thể chạy** trên prod | Cả hai nằm trong một câu điều kiện theo cờ chất lượng (`live-preview.ts:5492`), mà cờ đó có danh sách rỗng ⇒ tắt cho mọi kèo. Đường thứ ba (panel kiệt sức, `:5627`) **không bị cờ chặn** nhưng đòi luật chống-kiệt-sức bị hạ | **0 / 2050** payload trước khi ghi, toàn lịch sử — kể cả trước 25/07 khi panel còn sống | **TRUNG BÌNH** | Đây là câu trả lời cho "0% là do corpus hay do không bao giờ nổ": **do cờ**. Muốn thấy nó thì phải bật canary chất lượng |
| **A5** | Có **bản sao thứ hai** của hàm dựng panel nằm trong ứng dụng, không ai gọi | `features/host/session-detail/next-round-v2/preview.ts:309` trùng tên và trùng việc với bản trong engine (`live-preview.ts:3512`); quét toàn repo chỉ thấy engine được gọi | 0 nơi gọi | **THẤP** | Xoá — đúng nhóm rủi ro ~0 của P3 |
| **A6** | Lời chú thích ngay cạnh chỗ ghi đã lạc hậu | Nó nói cú ghi "chỉ nhận 8 cột"; thực tế trên prod là **11** (3 trường phụ đã được thêm vào hàm từ bản 03/08). Nghĩa là lớp gắn-lại-3-trường ở edge **có thể đã thừa** | Đếm trực tiếp trong định nghĩa hàm đang chạy | **THẤP** | Kiểm rồi bỏ lớp thừa; không gộp chung với A1 |
| **A7** | Điều kiện "vượt số trận" trong cổng lọc của ứng dụng **chưa bao giờ đúng** | Một trong bốn vế của cổng ở `ScreenComponents.tsx:1624-1630` | **0 / 353** lựa chọn, trong khi ba vế kia lần lượt 133 / 92 / 257 | **THẤP** | Nhiều khả năng là vế chết; xác nhận rồi bỏ |

---

## 3. "Ba hướng" hay "bốn hướng" — trả lời dứt khoát, có số prod

Đo trên **157 panel** mà engine đã dựng trên prod (toàn bộ lịch sử dump):

| số lựa chọn mỗi panel | số panel | tỉ lệ |
|---|---|---|
| 2 | 118 | **75,2%** |
| 3 | 39 | **24,8%** |
| 4 | **0** | **chưa bao giờ** |

Các tổ hợp thật sự xuất hiện — đúng **năm** hình dạng:

| tổ hợp | số lần |
|---|---|
| tốt-nhất-tổng-thể + ưu-tiên-cân-sức | 102 |
| tốt-nhất-tổng-thể + ưu-tiên-cân-sức + ít-lặp-hơn | 34 |
| tốt-nhất-tổng-thể + đồng-đội-ngang-trình | 11 |
| tốt-nhất-tổng-thể + ưu-tiên-cân-sức + đồng-đội-ngang-trình | 5 |
| tốt-nhất-tổng-thể + ít-lặp-hơn | 5 |

Đọc ra ba điều:

1. **"Tốt nhất tổng thể" có mặt 157/157** — nó là cái neo, không phải một lựa chọn ngang hàng.
2. **"Đồng đội ngang trình" và "ít lặp hơn" chưa bao giờ cùng xuất hiện.**
3. **Bốn hướng cùng lúc chưa từng xảy ra**, và không phải vì hiếm — mà vì bị chặn có hệ thống.

**Cổng cắt nằm ở đâu** (`live-preview.ts:3542-3605`): engine chọn ra bốn ứng viên theo bốn trục ưu tiên
khác nhau, nhưng bốn trục ấy **thường cùng thắng bởi một đội hình duy nhất**. Bước gộp-trùng (`:3565-3569`)
giữ lại đúng một, ba trục kia biến mất. Phần còn lại bị lọc tiếp: một lựa chọn chỉ được giữ nếu nó thật sự
tốt hơn cái được đề cử ở mặt nào đó (`:3595-3604`). Còn dưới hai thì trả về rỗng, không có panel nào cả.

⇒ **Giả định của host ("phải là 3 hướng") là ký ức đúng một nửa.** Trần thực tế là **3**, thường gặp là **2**.
Bốn tên trong khai báo kiểu là **không gian khai báo**, chưa bao giờ là sản phẩm. Không có chứng cứ nào cho
thấy ai từng thiết kế ra con số 3 — nó là **hệ quả của cách gộp trùng**, không phải một quyết định.

---

## 4. Lựa chọn được đề cử có đáng tin không

| câu hỏi | kết quả |
|---|---|
| Đề cử có luôn nằm trong danh sách? | **157 / 157 có** |
| Có panel nào có lựa chọn mà thiếu đề cử? | **0** |
| Có đề cử nào mồ côi, không kèm danh sách? | **0** |

Phân bố đề cử: ưu-tiên-cân-sức **82** · tốt-nhất-tổng-thể **74** · ít-lặp-hơn **1** ·
đồng-đội-ngang-trình **0** (xuất hiện 16 lần nhưng **chưa bao giờ được đề cử**).

Lý do nó nhất quán: sau khi dựng xong, engine ghi đè đề cử bằng đúng lựa chọn mô tả đội hình sẽ được chốt
(`live-preview.ts:3793-3802`). Nên đề cử không thể trỏ ra ngoài danh sách **về mặt cấu tạo**.

---

## 5. Có mấy đường sinh panel, chúng có cãi nhau không

Bốn, và chúng **loại trừ nhau** chứ không chạy song song (`live-preview.ts:3784-3792`): đường điều kiện
chạy trước nếu đủ điều kiện, không thì tới đường chính, cả hai rỗng thì mới tới đường vét. Đường vét lại
rẽ đôi theo cờ chất lượng:

| | cờ TẮT (prod hôm nay) | cờ BẬT |
|---|---|---|
| hàm | `buildLegacyOverThresholdRepeatTradeoff` (`:3707`) | `buildBalanceFreshnessTradeoff` (`:3643`) |
| số nhánh | đúng 2 | đúng 2 |
| đã chạy trên prod chưa | **có, đây là đường thật** | **chưa bao giờ** |

**Trả lời câu 7: bản legacy KHÔNG phải code chết** — nó chính là đường đang chạy trên prod. Giả thuyết
trong đề bài sai. Code chết có thật, nhưng nằm chỗ khác: bản sao trong ứng dụng (A5).

Về nguy cơ mâu thuẫn: vì bốn đường loại trừ nhau, một trận chỉ có **một** panel. Rủi ro "thẻ nói ngược
các dòng bên dưới" mà `match-compromises.ts` sinh ra để dập là chuyện **giữa panel và phần giải thích**,
không phải giữa các đường sinh panel. Không quan sát được lần nào trên prod — vì không panel nào hiển thị.

---

## 6. Đã loại trừ — đừng đào lại

| thứ trông như lỗi | vì sao không phải |
|---|---|
| Bản legacy là code chết | Nó là nhánh prod đang chạy (`:3704`) |
| Đề cử có thể rỗng trong khi vẫn có lựa chọn | 0/157. Được giữ nhất quán bằng cấu tạo, không bằng may mắn |
| Cổng lọc trong ứng dụng đang bóp chết panel | **157/157 qua cổng**. Phép đo có phân biệt được: bốn vế cho ra 133 / 92 / 257 / **0**, tức nó không trả bừa "đúng" cho mọi thứ |
| "Chờ sân / Chơi luôn" 0% vì corpus không có hình dạng đó | Không. Do **cờ** — xem A4 |
| Panel hiếm vì engine ít khi dựng được | Engine dựng cho **7,66%** số payload (157/2050) trước khi ghi. Chỗ mất **không** nằm ở khâu dựng |
| Bốn hướng bị một ngưỡng nào đó chặn | Không có ngưỡng nào cả — bị **gộp trùng** vì bốn trục cùng thắng một đội hình |

---

## 7. Chưa đo được, và cần gì để đo

1. **Bước hậu kỳ vứt panel bao nhiêu phần trăm HÔM NAY.** Dump prod không có bộ đếm cho bước này —
   đường ghi sự kiện đã có sẵn khuôn (`repair`), chỉ thiếu một mục cho nó. Con số 84% và "935/1160" trong
   chú thích code là **số corpus tổng hợp, không phải prod**.
   ⚠️ Nhưng nó **không còn là câu hỏi chặn**: panel sống sót qua bước hậu kỳ vẫn bị xoá ở khâu ghi. Sửa
   khâu ghi trước, rồi mới đo lại cái này — lúc đó con số mới có nghĩa.
2. **Kèo thật chạy ALGO 80/81.** Chưa có. Mọi khẳng định về hai bản đó hiện là "chưa ai chạy qua".
3. **Kích thước mẫu sau 25/07 còn mỏng:** 58 trận sau khi ghi, 7 payload trước khi ghi (chỉ dump đầy đủ
   mới giữ được). Được củng cố bởi 1200+ dòng DB đều rỗng, và bởi cơ chế đọc thẳng từ code — ba đường
   độc lập cùng chỉ một hướng, nhưng bản thân n của dump thì nhỏ.

---

## 8. Thứ tự sửa đề xuất (chưa làm gì, chờ host duyệt)

1. **A1 + A2 cùng lúc** — một việc, không tách. Hai lựa chọn, cần host chốt:
   - **(a)** mang panel về trong câu trả lời của edge, không đi qua DB — gọn hơn, nhưng panel sẽ không
     sống qua lần tải lại trang;
   - **(b)** đưa panel trở lại đường ghi bằng một bản cập nhật hàm tường minh — bền hơn, nhưng phải bảo
     đảm bản cập nhật hàm sau này không xoá nó lần nữa (đó đúng là cách nó chết lần đầu).
2. **A3** tự hết khi A1 xong — kiểm lại bằng số, đừng suy.
3. **A6, A5, A7** — dọn dẹp, rủi ro thấp, làm sau khi A1 đã đứng.
4. **A4** không phải việc sửa mà là **quyết định sản phẩm**: có bật canary mô hình chất lượng không.

**Không sửa gì trong đợt này.** Ngoài ra, đề nghị host xác nhận việc canary bộ tối ưu bàn đấu đang chạy
trên hai kèo gần nhất có đúng chủ ý không — bảng trạng thái hiện ghi ngược lại.

---

# TRẠNG THÁI SỬA CHỮA (2026-08-16, sau khi host duyệt phạm vi)

Host duyệt: migration + cổng kiểm + dọn chỗ chết. Host xác nhận canary bộ tối ưu bàn đấu **đúng chủ ý**,
giữ nguyên, chỉ sửa nhãn trạng thái.

Trạng thái dưới đây đến từ **phép đo của tôi trong phiên này**, không từ báo cáo của tác nhân nào.

## Đã làm

| # | trạng thái | bằng chứng đo được |
|---|---|---|
| **A1+A2** | **ĐÃ VIẾT, CHƯA ÁP DỤNG LÊN PROD** — migration `20260816000001_restore_suggestion_metadata_on_persist.sql` | Thân hàm so từng dòng với bản **đang chạy trên prod** (lấy bằng `pg_get_functiondef`, không chép từ file cũ): 275 dòng gốc vs 286 dòng mới, **15 dòng khác nhau và toàn bộ 15 dòng đều là phần thêm có chủ ý** ở danh sách cột và giá trị. Không một sai lệch nào ngoài ý muốn. `check:migrations` xanh (167 file) |
| **Cổng kiểm** | **XONG** | Luật "hàm ghi phải nhắc tới ô metadata" được đặt lại lên **cả hai** hàm ghi. Test đỏ-trước-xanh-sau (`Received array: []` → 9/9 xanh). Chạy thật vào prod: **đỏ, mã thoát 1**, đúng lỗi đang tồn tại — tức cổng có nối vào thật, không phải trang trí |
| **A5** | **XONG — đã xoá** | Cả cụm 190 dòng trong `features/.../preview.ts` (từ `getAlternativePvnaGap` tới `buildLiveTradeoffChoices`, kèm 4 hằng số trọng số) không có một nơi gọi nào trong toàn repo. Lint sạch, `typecheck:guard` 0 lỗi |

**Phát hiện kèm theo khi xoá A5, đáng ghi:** bản sao chết đó chỉ có **ba** trục lựa chọn (thiếu hẳn
"đồng đội ngang trình"), nhãn cũ, luật đề cử cũ. Đây nhiều khả năng là **nguồn gốc của ký ức "3 hướng"** —
nó là một nhánh cũ của logic panel bị bỏ lại trong ứng dụng khi engine đi tiếp.

## Đính chính hai finding của chính tôi ở bảng trên

| # | tôi đã viết | sự thật khi kiểm | vì sao tôi sai |
|---|---|---|---|
| **A7** | "nhiều khả năng là vế chết, xác nhận rồi bỏ" | **KHÔNG chết — không được xoá.** Trường hạn ngạch công bằng **có** nơi gán giá trị (`live-preview.ts:1652`), lấy từ nhánh điều kiện | Tôi suy "0/353 trên prod" thành "vô nghĩa". Nó bằng 0 vì **nhánh sinh ra nó chưa chạy trên prod**, không phải vì vế đó thừa. Đúng cái bẫy "corpus không chứa hình dạng ≠ vô hại" |
| **A6** | "lớp gắn-lại 3 trường đã thừa, bỏ đi" | **Thừa có điều kiện — không xoá.** Prod có lưu và trả lại cả ba trường (59/52/61 trên 622 dòng), nên hôm nay nó là no-op | Nó chỉ thừa **trong khi** một lượt tính lại phía sau đang bật. Tắt kill-switch đó thì đường không-đổi-lineup lại cần nó. Xoá bây giờ là tạo một ràng buộc ngầm vào một cờ |

## Chưa làm — cần host quyết

- **Áp migration lên prod.** Đây là thao tác ghi vào production, tôi không tự chạy. Kèm theo là phép
  kiểm vòng-tròn: ghi một trận có panel, đọc lại, đối chiếu panel ra có khớp panel vào không.
- **Sau khi áp:** cổng kiểm phải chuyển từ đỏ sang xanh. Nếu nó vẫn đỏ thì migration chưa ăn.
- **Không cần deploy edge, không cần rebuild ứng dụng.** Cả hai phía đã có sẵn mã trải khoá.

## Nền đo trước/sau

| | trước | sau |
|---|---|---|
| file engine bị đụng (`lib/next-round-suggester/`) | — | **0** |
| `typecheck:guard` | 0 lỗi | **0 lỗi** |
| `tests/next-round-v2` + `host-live` + `scripts` | — | **35 suite / 155 test XANH** (chạy 2 lượt, 21,8s và 22,4s) |
| `unit/live-preview` | — | **73/73 XANH** |
| `check:migrations` | 166 file | **167 file, xanh** |

⚠️ **Một lượt chạy test đầu tiên báo 6 suite đỏ / 9 test đỏ và là ĐỎ GIẢ.** Lượt đó tốn 52,8s so với
21,8s của lượt sạch, và có **54 tiến trình node** của một phiên làm việc song song đang chiếm CPU. Cùng
bộ test (9 đỏ + 146 xanh = 155 = tổng của lượt xanh). Đừng đọc con số đỏ đó thành hồi quy.

⚠️ **Có phiên khác đang sửa `tests/next-round-suggester/simulation/{analysis,runner}.ts`** (thêm bộ đếm
ngân sách tìm kiếm, sửa lúc 07:24). Tôi không đụng và không commit hai file đó.
