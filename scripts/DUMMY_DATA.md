# Dummy Data

Script seed dummy data cho toàn bộ flow test nằm ở:

- `scripts/seed-dummy-data.mjs`

## Cách chạy

PowerShell:

```powershell
$env:SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY"
npm run seed:dummy
```

Tuỳ chọn:

```powershell
$env:SUPABASE_URL="https://YOUR_PROJECT_REF.supabase.co"
$env:DUMMY_PASSWORD="Pickle123!"
npm run seed:dummy
```

## Script sẽ seed gì

- `auth.users`
- `players`
- `courts`
- `court_slots`
- `sessions`
- `session_players`
- `join_requests`
- `notifications`
- `ratings`

Script sẽ reset lại toàn bộ dummy rows liên quan trước khi seed lại, nên có thể chạy nhiều lần.

## Tài khoản test

Mặc định password là:

- `Pickle123!`

Các tài khoản:

- `host.confirmed@picklematch.vn`
- `host.approval@picklematch.vn`
- `player.matched@picklematch.vn`
- `player.lower@picklematch.vn`
- `player.waitlist@picklematch.vn`
- `host.provisional@picklematch.vn`
- `player.social@picklematch.vn`

## Flow test gợi ý

- `openConfirmed`: test kèo mở, sân đã chốt, auto-accept
- `openApproval`: test host duyệt request / smart join / intro note
- `fullConfirmed`: test kèo đầy / waitlist
- `doneRecent`: test rating sau trận
- `cancelled`: test lịch sử kèo đã huỷ
- `provisionalHost`: test host provisional badge
- `doneHistorical`: test profile có rating/badge lịch sử
- `pendingCompletion`: test session đã hết giờ nhưng host chưa submit kết quả
- `resultsPending`: test host đã submit kết quả, player cần confirm
- `resultsDisputed`: test player dispute kết quả
- `autoClosed`: test hệ thống auto-close và ready-for-rating
- `ghostVoided`: test kèo bị void do người chơi báo trận không diễn ra

## Coverage mới trong seed

- `player_stats`
- `player_achievements`
- notification types mới:
  - `achievement_unlocked`
  - `session_pending_completion`
  - `session_results_submitted`
  - `session_results_disputed`
  - `session_auto_closed`
  - `session_ready_for_rating`
  - `ghost_session_voided`
  - `host_unprofessional_reported`

## Lưu ý thực tế

- `Home` hiện vẫn dùng mock UI cứng trong [app/(tabs)/index.tsx](/c:/Users/quock/OneDrive/picklematch-vn/app/(tabs)/index.tsx), nên seed backend này không thay đổi dữ liệu tab Home.
- `Profile` và `Trophy Room` hiện mới được cover dữ liệu backend ở mức bảng `player_stats` / `player_achievements`; một số widget UI vẫn còn mock cứng nên cần đọc review để biết giới hạn test.

## Lưu ý

- Script cần `SUPABASE_SERVICE_ROLE_KEY`, không dùng `anon key`.
- Phần cron auto-finalize rating sau 24h hiện vẫn đang hold, chưa rollout.
