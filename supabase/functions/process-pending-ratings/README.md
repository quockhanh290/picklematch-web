# Process Pending Ratings

Edge Function này dùng để tự động finalize các rating đã đến hạn mở hoặc đã đủ cặp đánh giá song phương.

## Deploy

```bash
supabase functions deploy process-pending-ratings
```

## Chạy thử thủ công

```bash
supabase functions serve process-pending-ratings
```

Hoặc invoke sau khi deploy:

```bash
curl -X POST "https://<project-ref>.functions.supabase.co/process-pending-ratings" \
  -H "Authorization: Bearer <service-role-or-scheduled-secret>"
```

## Schedule khuyến nghị

Trong Supabase Dashboard:

1. Vào `Edge Functions`
2. Chọn `process-pending-ratings`
3. Tạo scheduled invoke
4. Chạy mỗi `15 phút` hoặc `1 giờ`

## Điều kiện cần

Chạy trước các migration:

- `20260324_upgrade_rating_system.sql`
- `20260324_add_pending_ratings_processor.sql`

Function này gọi RPC:

- `public.process_pending_ratings()`

RPC sẽ:

- tìm các `session_id` có rating chưa xử lý
- mở rating nếu đã đủ điều kiện
- cập nhật `reliability_score`
- cập nhật `host_reputation`
- cập nhật `elo/current_elo`
- cấp badge nếu đủ ngưỡng
