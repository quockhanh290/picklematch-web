# PickleMatch VN Overview

## 1. App là gì

PickleMatch VN là ứng dụng mobile giúp người chơi pickleball tại Việt Nam:

- tìm kèo phù hợp theo lịch, sân và trình độ
- tạo và quản lý kèo
- ghép người chơi công bằng hơn
- theo dõi độ tin cậy cộng đồng
- đánh giá sau trận
- tích lũy badge, achievement và win streak

Tech stack chính:

- React Native
- Expo Router
- TypeScript
- NativeWind
- Supabase Auth
- Supabase Postgres + RPC

## 2. Mục tiêu sản phẩm

App được thiết kế để giải quyết 4 bài toán chính:

- giúp người chơi vào đúng kèo, đúng trình, đúng thời điểm
- giúp host quản lý kèo, booking và người tham gia dễ hơn
- giảm no-show, giảm lệch trình, tăng niềm tin trong cộng đồng
- tạo vòng lặp giữ chân người dùng bằng rating, streak, badge và progression

## 3. Nhóm người dùng chính

### Player

Player có thể:

- đăng nhập và tạo hồ sơ
- tự đánh giá trình độ ban đầu
- tìm kèo
- xin vào kèo, tham gia hoặc đăng ký dự bị
- rời kèo
- đánh giá sau trận
- xác nhận hoặc dispute kết quả trận

### Host

Host có thể:

- tạo kèo
- chọn sân, thời gian, số người, mức trình độ
- bật hoặc tắt duyệt tay
- khai báo trạng thái booking sân
- duyệt hoặc từ chối người chơi
- sửa kèo
- hủy kèo
- gửi kết quả trận để người chơi xác nhận

## 4. Luồng chính của app

### Onboarding

Luồng hiện tại:

1. Login
2. Profile Setup
3. Skill Assessment
4. Vào Home

Nếu user chưa có hồ sơ hoặc chưa có self-assessed level, app sẽ tự điều hướng tới bước còn thiếu.

### Tạo và quản lý kèo

Host tạo kèo theo flow nhiều bước:

1. chọn sân
2. chọn ngày và giờ
3. chọn số người tối đa
4. chọn dải trình độ
5. chọn approval mode
6. khai báo trạng thái booking sân
7. review và publish

Sau khi tạo:

- host có thể sửa metadata chính của kèo
- người đã tham gia sẽ nhận notification khi kèo được cập nhật

### Tham gia kèo

Player vào màn chi tiết kèo và có thể rơi vào 1 trong 3 trạng thái:

- `MATCHED`
- `LOWER_SKILL`
- `WAITLIST`

Từ đó app hiển thị flow phù hợp:

- tham gia ngay
- xin vào kèo
- đăng ký dự bị

### Sau trận

Khi kèo đã `done`:

- player có thể rate người chơi khác và host
- host có thể submit kết quả trận
- player có thể xác nhận hoặc dispute kết quả
- khi kết quả được finalize, hệ thống mới cập nhật achievement, streak và calibration

## 5. Các màn hình chính

### Home

- feed chính các kèo
- quick actions
- filter pills
- ưu tiên các kèo đã chốt sân

### Find Session

- tìm kèo nâng cao
- lọc theo nhiều điều kiện

### My Sessions

- xem các kèo đang host
- xem các kèo đang tham gia hoặc đã tham gia

### Session Detail

Đây là màn trung tâm của app, gồm:

- thông tin sân, thời gian, giá, trình độ
- trạng thái booking
- danh sách người chơi
- smart join flow
- host approval flow
- host edit flow
- link sang rating
- submit và xác nhận kết quả trận

### Create Session

- flow tạo kèo nhiều bước
- có logic booking và review trước khi publish

### Notifications

- inbox sự kiện trong app
- deep link về màn liên quan

### Profile

- thông tin cá nhân
- Elo hiện tại
- reliability
- placement progress
- lịch sử kèo
- trophy room

### Edit Profile

- sửa thông tin cơ bản
- đổi self-assessed level
- cập nhật auto-accept
- quản lý sân yêu thích

### Rate Session

- đánh giá player và host sau trận
- nhập skill validation
- phục vụ reliability, host reputation và Elo calibration

## 6. Skill, Elo và Placement

App hiện dùng 5 mức tự đánh giá:

1. Mới bóc tem
2. Biết điều bóng
3. Chiến thần cọ xát
4. Tay vợt phong trào
5. Thợ săn giải thưởng

Mỗi mức map sang Elo khởi điểm.

Khi user mới vào app:

- `current_elo` được set theo self-assessment
- `is_provisional = true`
- `placement_matches_played = 0`

### Skill Calibration

Hệ thống hiện đã có 3 lớp chính:

- `Peer Review / Màng lọc 3`
  - sau trận, người chơi đánh giá đối thủ là `weaker`, `matched` hoặc `outclass`
- `Placement K-factor`
  - trong 5 trận đầu, Elo biến động mạnh hơn để hệ thống đưa người chơi nhanh về đúng trình
- `Đồng bộ nhãn trình độ theo Elo`
  - profile hiện ưu tiên hiển thị level theo `current_elo` thay vì chỉ bám self-assessment ban đầu

### Auto thoát provisional

Khi người chơi hoàn tất đủ 5 trận placement hợp lệ:

- `placement_matches_played` tăng dần
- `is_provisional` tự tắt
- badge placement biến mất trên profile

## 7. Hệ thống booking sân

Booking sân là một phần quan trọng của session.

Session có thể ở 2 trạng thái:

- `confirmed`
- `unconfirmed`

Thông tin booking có thể gồm:

- booking reference
- booking name
- booking phone
- booking notes
- booking confirmed at

Nếu sân đã chốt:

- một số thông tin như ngày/giờ sẽ bị khóa trong flow sửa kèo

## 8. Smart Join Flow

Smart join dựa trên mức chênh trình giữa player và mặt bằng kèo:

- `MATCHED`
- `LOWER_SKILL`
- `WAITLIST`

Flow kết hợp với:

- `auto_accept`
- `require_approval`
- intro note khi xin vào kèo
- host review panel

Host có thể:

- accept
- reject
- reply bằng template

## 9. Rating System

Rating hiện hỗ trợ:

- tag tích cực cho player
- tag cảnh báo cho player
- tag tích cực cho host
- tag cảnh báo cho host
- `skill_validation`
- `no_show`

Rating đang hoạt động theo logic double-blind:

- rating được lưu hidden trước
- chỉ mở khi hai bên đều rate
- hoặc sau 24 giờ

Rating ảnh hưởng đến:

- `reliability_score`
- `host_reputation`
- `no_show_count`
- `current_elo`
- badge cộng đồng

## 10. Reliability và Host Reputation

### Reliability

Người chơi bắt đầu ở mức 100%.

Penalty hiện có thể đến từ:

- no-show
- late
- toxic
- dishonest

### Host Reputation

Host reputation đến từ feedback sau trận:

- good_description
- well_organized
- fair_pairing
- court_mismatch
- poor_organization

## 11. Xác nhận kết quả trận

Đây là lớp bảo vệ để tránh host nhập kết quả sai.

Flow hiện tại:

1. host submit kết quả đề xuất
2. player nhìn thấy proposed result trong session detail
3. player có thể:
   - xác nhận
   - báo sai kết quả
4. khi tất cả player xác nhận hoặc hết deadline mà không có dispute, backend mới finalize kết quả

Chỉ sau khi finalize:

- `match_result` mới được chốt
- achievement, streak và skill calibration mới được tính

## 12. Achievement và Badge

App đã có nền tảng achievement với các nhóm:

### Progression

- Hội viên tích cực
- Chiến thần sân bãi

### Performance

- Giant Slayer
- Tốt nghiệp xuất sắc

### Momentum

- Win Streak

### Conduct

- Đồng hồ Thụy Sĩ
- Host Vàng

Supporting tables:

- `player_stats`
- `player_achievements`

## 13. Win Streak và Decay

Hệ thống đang theo dõi:

- `current_win_streak`
- `max_win_streak`
- `last_match_at`
- `streak_fire_active`
- `streak_fire_level`

Nếu user không chơi quá 14 ngày:

- current streak reset
- fire inactive
- fire level về 0

## 14. Notification System

App có notification nội bộ qua bảng `notifications`.

Các loại notification hiện đã xuất hiện trong app:

- `join_request`
- `join_approved`
- `join_rejected`
- `join_request_reply`
- `player_left`
- `session_cancelled`
- `session_updated`
- `achievement_unlocked`
- `session_results_submitted`
- `session_results_disputed`

## 15. Hồ sơ người chơi

Profile hiện có thể hiển thị:

- avatar initials
- city
- phone
- Elo
- reliability
- số kèo đã tham gia
- số kèo đã host
- placement progress
- lịch sử kèo
- trophy room

Player Profile cho phép xem nhanh:

- trình độ hiện tại
- độ tin cậy
- lịch sử kèo gần đây
- feedback nổi bật từ cộng đồng

## 16. Dummy Data và test support

Codebase hiện đã có:

- seed script
- dummy auth users
- test checklist
- skill calibration checklist

Các file chính:

- [scripts/seed-dummy-data.mjs](/c:/Users/quock/OneDrive/picklematch-vn/scripts/seed-dummy-data.mjs)
- [scripts/DUMMY_DATA.md](/c:/Users/quock/OneDrive/picklematch-vn/scripts/DUMMY_DATA.md)
- [TEST_CHECKLIST.md](/c:/Users/quock/OneDrive/picklematch-vn/TEST_CHECKLIST.md)
- [SKILL_CALIBRATION_TEST.md](/c:/Users/quock/OneDrive/picklematch-vn/SKILL_CALIBRATION_TEST.md)

## 17. Design system

Codebase đã có shared design system để đồng bộ UI:

- buttons
- chips
- badges
- section cards
- headers
- empty state

Tài liệu liên quan:

- [DESIGN_SYSTEM.md](/c:/Users/quock/OneDrive/picklematch-vn/DESIGN_SYSTEM.md)
- [UI_CONTEXT.md](/c:/Users/quock/OneDrive/picklematch-vn/UI_CONTEXT.md)

## 18. Migration quan trọng

Một số migration quan trọng hiện có:

- `20260323_add_skill_assessment_fields.sql`
- `20260323_add_court_booking_status.sql`
- `20260323_add_smart_join_flow.sql`
- `20260324_upgrade_rating_system.sql`
- `20260324_add_achievement_system.sql`
- `20260324_add_result_confirmation_flow.sql`
- `20260324_update_skill_calibration_engine.sql`

## 19. Hạng mục đang hold

Hiện có một phần đã chuẩn bị code nhưng chưa rollout:

- auto-finalize ratings sau 24h bằng cron / Edge Function

Liên quan tới:

- [supabase/functions/process-pending-ratings/index.ts](/c:/Users/quock/OneDrive/picklematch-vn/supabase/functions/process-pending-ratings/index.ts)
- [supabase/migrations/20260324_add_pending_ratings_processor.sql](/c:/Users/quock/OneDrive/picklematch-vn/supabase/migrations/20260324_add_pending_ratings_processor.sql)

## 20. Trạng thái hiện tại của sản phẩm

App hiện đã vượt qua mức MVP đơn giản và đang có:

- matchmaking logic
- booking logic
- smart join flow
- reliability layer
- double-blind rating
- result confirmation chống gian lận từ host
- achievement foundation
- Elo calibration cho placement
- dummy data để test end-to-end

Các bước phát triển hợp lý tiếp theo:

- nối Trophy Room với dữ liệu thật 100%
- hoàn thiện push notification ra thiết bị thật
- thêm analytics
- thêm admin/dispute tools mạnh hơn
- rollout cron auto-finalize ratings khi sẵn sàng
