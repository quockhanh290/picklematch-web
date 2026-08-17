# Persistence chậm — chẩn đoán và việc cần làm (2026-08-16)

Triệu chứng: `timing_ms.persistence` p50 450 ms nhưng **max 11 467 ms**, kéo `total` lên 13 giây.

## 1. Không phải lỗi trong code mình — sáu giả thuyết bị loại bằng số

| giả thuyết | số đo | kết luận |
|---|---|---|
| Engine chậm | `engine_search` max 972 ms | loại |
| SQL của RPC chậm | Postgres tự ghi: `replace_live_session_suggestions_versioned` max **1 610 ms**, `sync_live_suggestion_hints` max **753 ms** (`pg_stat_statements`, `track=top` nên đã gồm cả chờ khoá trong thân hàm) | loại |
| Chờ fsync / commit | `COMMIT` max **0,0 ms** | loại |
| Tranh khoá giữa các suggest | 19/20 lượt chậm có **0** request khác đang bay | loại |
| Khoá do host start/complete trận | 25% vs 10% ở nhóm đối chứng, và **hai lượt tệ nhất không có sự kiện trận nào** | loại |
| Isolate đói CPU | trên chính các lượt chậm: `state_build` **1,0x**, `postprocess` 1,2x | loại |

**Còn lại:** tầng giữa edge và Postgres (Kong → PostgREST → pooler). Trên các lượt chậm, **mọi** khâu
chạm mạng phình cùng lúc — persistence 12,6x, snapshot 3,7x, auth 3,6x — trong khi khâu thuần CPU đứng
yên. Postgres chạy xong trong 1,6 giây, edge đo 11,5 giây; chín giây đó không có trong đồng hồ nào của
Postgres.

Quy mô: **3,3%** trong 600 lượt vượt 3 giây; p99 6,2 s; max 11,5 s. Rải trên **7 kèo, 5 ngày**, và lượt
tệ nhất xảy ra **sau** khi nâng gói Pro — nâng RAM không chữa được nó.

## 2. Phần sửa được trong tầm mình: bớt một lượt đi-về

Cửa sổ `persistence` gói **hai** lời gọi PostgREST nối tiếp
(`index.ts:1423` và `:1554`). Ước lượng chi phí một lượt đi-về, lấy từ khâu chỉ có **một** RPC:

```
snapshot_load  p50 345ms (edge)  −  209ms (Postgres tự ghi)  =  ~136ms/lượt đi-về
dự báo persistence = 2×136 + 67 + 30 = 368ms   |   thực tế p50 450ms
```

→ Gộp hai RPC làm một tiết kiệm **~136 ms p50** (30% khâu persistence) và bỏ **một lần rút thăm** với
cái đuôi 9 giây. Cả request hiện có 4+ lượt đi-về nối tiếp, mỗi lượt là một vé số.

⚠️ **CHƯA LÀM, và cố ý chưa làm.** Phiên rà soát panel alternative đang sửa đúng hàm đó
(`20260816000001_restore_suggestion_metadata_on_persist.sql`, chưa áp lên prod). Hai người cùng viết lại
một hàm là hỏng chắc. **Trình tự đúng:** để migration của họ lên trước, rồi đo lại — sau khi hàm persist
tự ghi metadata, `sync_live_suggestion_hints` có thể đã thừa hẳn, và khi đó việc này không còn là "gộp"
mà là "xoá".

## 3. Ticket gửi Supabase

> **Tiêu đề:** Edge Function → PostgREST latency spikes to 11s while Postgres reports <1.7s
>
> Project `mzqsxgfvtgmsscbqugni`, region as provisioned. Plan: Pro, compute Micro (upgraded 2026-08-15).
>
> An Edge Function calls three PostgREST RPCs per request. It times each stage itself. In 3.3% of 600
> sampled requests one stage exceeds 3s, worst case 11.5s — while `pg_stat_statements` reports the same
> function completing in at most 1.6s, and `COMMIT` at 0.0ms.
>
> Evidence that it is not the database and not our code:
> - `pg_stat_statements` (`track=top`, so lock waits inside the function are included):
>   `replace_live_session_suggestions_versioned` — 219 calls, mean 67ms, **max 1610ms**;
>   `sync_live_suggestion_hints` — 178 calls, mean 30ms, max 753ms;
>   `get_live_session_snapshot_versioned` — 418 calls, mean 209ms, max 6438ms.
> - `COMMIT` — 1287 calls, max 0.0ms. Not a WAL/fsync stall.
> - On the slow requests, CPU-only stages inside the same isolate are flat (1.0x), while every
>   network-bound stage inflates together (12.6x / 3.7x / 3.6x). The isolate is not starved.
> - 19 of the 20 slowest requests had **zero** concurrent requests from this app.
> - Spread over 7 different sessions and 5 days, including after the Pro upgrade.
>
> Question: where does the ~9s go between the Edge Function issuing the request and PostgREST executing
> the statement? Is the connection pool (Supavisor) queueing, and can we see pool-wait metrics?
>
> Reproduction data: timestamps of the 20 slowest requests available on request.

## 4. Đo lại thế nào

```bash
# keo timing tu debug_dumps (chia lo 100 dong — 1000 dong lam Postgres het gio)
SRK=<service_role_key> node scratch/pull-sweep-dumps.mjs   # hoac truy van truc tiep

# so voi thoi gian Postgres tu ghi
curl -s -X POST "https://api.supabase.com/v1/projects/mzqsxgfvtgmsscbqugni/database/query" \
  -H "Authorization: Bearer $(tr -d '\r\n' < ~/.supabase/access-token)" \
  -H "Content-Type: application/json" \
  -d '{"query":"select query, calls, mean_exec_time, max_exec_time from pg_stat_statements where query ilike '"'"'%pgrst_call%'"'"' order by max_exec_time desc limit 10"}'
```

⚠️ `pg_stat_statements` gói mọi RPC dưới cùng một khuôn PostgREST; muốn phân biệt phải trích tên hàm
bằng `regexp_match` trên `query`. Mốc reset hiện tại: 2026-08-14 21:58.
