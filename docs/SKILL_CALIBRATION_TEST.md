# Skill Calibration Test

Checklist này dùng để test cụm:

- Peer Review / `skill_validation`
- Placement K-factor cho 5 trận đầu
- Auto thoát `is_provisional`
- Đồng bộ nhãn trình độ theo Elo

## 1. Chuẩn bị

Chạy các migration liên quan:

- [supabase/migrations/20260323_add_skill_assessment_fields.sql](/c:/Users/quock/OneDrive/picklematch-vn/supabase/migrations/20260323_add_skill_assessment_fields.sql)
- [supabase/migrations/20260324_upgrade_rating_system.sql](/c:/Users/quock/OneDrive/picklematch-vn/supabase/migrations/20260324_upgrade_rating_system.sql)
- [supabase/migrations/20260324_update_skill_calibration_engine.sql](/c:/Users/quock/OneDrive/picklematch-vn/supabase/migrations/20260324_update_skill_calibration_engine.sql)

Nếu test full flow kết quả trận:

- [supabase/migrations/20260324_add_result_confirmation_flow.sql](/c:/Users/quock/OneDrive/picklematch-vn/supabase/migrations/20260324_add_result_confirmation_flow.sql)

Seed data:

```powershell
$env:SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY"
npm run seed:dummy
```

## 2. Tài khoản nên dùng

- `host.provisional@picklematch.vn`
- `player.matched@picklematch.vn`
- `player.lower@picklematch.vn`
- `player.social@picklematch.vn`

Password mặc định:

- `Pickle123!`

## 3. Kiểm tra state ban đầu

Vào `Profile` của user provisional và xác nhận:

- `is_provisional = true`
- `placement_matches_played = 0` hoặc nhỏ hơn `5`
- profile đang hiển thị badge `Placement`
- level hiển thị đang bám theo `current_elo`

## 4. Test Peer Review

Mục tiêu: xác nhận `skill_validation` đã ảnh hưởng Elo.

1. Dùng một session `done`.
2. Vào [app/rate-session/[id].tsx](/c:/Users/quock/OneDrive/picklematch-vn/app/rate-session/[id].tsx).
3. Rate cùng một player với các trường hợp:
   - `weaker`
   - `matched`
   - `outclass`
4. Gọi flow finalize rating hiện tại.
5. Kiểm tra trong `players`:
   - `current_elo` giảm khi bị đánh giá `weaker`
   - `current_elo` gần như giữ nguyên khi `matched`
   - `current_elo` tăng khi bị đánh giá `outclass`

SQL gợi ý:

```sql
select id, name, current_elo, elo, skill_label, is_provisional, placement_matches_played
from public.players
where email is null or id is not null;
```

## 5. Test Placement K-factor

Mục tiêu: xác nhận 5 trận đầu biến động mạnh hơn bình thường.

1. Chọn một player còn `is_provisional = true`.
2. Cho player này hoàn tất một trận có `match_result = win`.
3. Rate kèm `outclass`.
4. Finalize rating.
5. Ghi lại mức tăng Elo.
6. Làm tương tự với một player đã ổn định (`is_provisional = false`).
7. So sánh delta Elo.

Kỳ vọng:

- provisional tăng/giảm mạnh hơn rõ rệt
- stable player biến động nhẹ hơn

## 6. Test Auto thoát Provisional

Mục tiêu: xác nhận đủ 5 trận placement thì user thoát provisional.

1. Chọn một player đang `is_provisional = true`.
2. Lặp 5 session đã `done` với `match_result` khác nhau.
3. Mỗi trận đều phải đi hết flow rating để `process_final_ratings(...)` chạy.
4. Sau trận thứ 5, kiểm tra:

- `placement_matches_played = 5`
- `is_provisional = false`
- profile không còn badge `Placement`

## 7. Test Đồng bộ nhãn trình độ theo Elo

Mục tiêu: xác nhận profile không còn bám cứng self-assessment ban đầu.

Rule đang dùng:

- `< 900` => `Mới bóc tem`
- `900 - 1074` => `Biết điều bóng`
- `1075 - 1249` => `Chiến thần cọ xát`
- `1250 - 1449` => `Tay vợt phong trào`
- `>= 1450` => `Thợ săn giải thưởng`

Các bước:

1. Đẩy `current_elo` của một user lên/xuống qua các mốc trên.
2. Mở:
   - [app/(tabs)/profile.tsx](/c:/Users/quock/OneDrive/picklematch-vn/app/(tabs)/profile.tsx)
   - [app/player/[id].tsx](/c:/Users/quock/OneDrive/picklematch-vn/app/player/[id].tsx)
3. Xác nhận title trình độ thay đổi theo Elo hiện tại.

## 8. Test Match Result + Peer Review cùng lúc

Mục tiêu: xác nhận Elo bị ảnh hưởng bởi cả kết quả trận lẫn peer review.

Case gợi ý:

1. `win + outclass`
   - Elo tăng mạnh nhất
2. `win + matched`
   - Elo tăng vừa
3. `loss + weaker`
   - Elo giảm mạnh
4. `draw + matched`
   - Elo gần như ổn định

## 9. Test Regression

Sau khi test calibration, xác nhận các phần sau vẫn ổn:

- `Profile` mở bình thường
- `Player Profile` mở bình thường
- `Rate Session` submit được
- `Session Detail` không lỗi query
- `My Sessions` vẫn nhìn thấy kèo đã tham gia

## 10. Dấu hiệu pass

Bạn có thể coi cụm này pass khi:

- `skill_validation` thật sự làm đổi Elo
- 5 trận đầu biến động mạnh hơn các trận sau
- user tự thoát provisional sau đủ 5 trận
- nhãn trình độ trên profile đổi theo Elo mới
- không có lỗi lint/type-check/runtime cơ bản

## 11. Ghi chú

- Flow cron auto-finalize rating sau 24h vẫn đang hold, chưa rollout.
- Nếu muốn test calibration ngay lập tức, nên dùng flow finalize rating hiện tại thay vì chờ 24h.
