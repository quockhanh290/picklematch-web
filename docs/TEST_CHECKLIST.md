# Test Checklist

Checklist này dùng cùng với:

- [scripts/DUMMY_DATA.md](/c:/Users/quock/OneDrive/picklematch-vn/scripts/DUMMY_DATA.md)
- `npm run seed:dummy`

## 1. Seed dữ liệu

```powershell
$env:SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY"
npm run seed:dummy
```

## 2. Tài khoản test

Password mặc định:

- `Pickle123!`

Accounts:

- `host.confirmed@picklematch.vn`
- `host.approval@picklematch.vn`
- `host.provisional@picklematch.vn`
- `player.matched@picklematch.vn`
- `player.lower@picklematch.vn`
- `player.waitlist@picklematch.vn`
- `player.social@picklematch.vn`

## 3. Flow nên test

### Home / Feed

- đăng nhập `host.confirmed@picklematch.vn`
- kiểm tra kèo `openConfirmed`
- kiểm tra kèo `fullConfirmed`
- kiểm tra sorting: kèo `Sân đã chốt` lên trước

### Smart Join

- đăng nhập `player.matched@picklematch.vn`
- mở session `openConfirmed`
- xác nhận nút join phù hợp flow matched

- đăng nhập `player.lower@picklematch.vn`
- mở session trình cao hơn
- xác nhận flow `Xin vào kèo`

- đăng nhập `player.waitlist@picklematch.vn`
- mở session `fullConfirmed`
- xác nhận flow `Đăng ký dự bị`

### Approval Flow

- đăng nhập `host.approval@picklematch.vn`
- mở session `openApproval`
- kiểm tra pending requests
- test accept / reject / reply template

### Notifications

- dùng các account host/player khác nhau
- mở tab notifications
- kiểm tra các loại:
  - `join_request`
  - `join_approved`
  - `join_rejected`
  - `player_left`
  - `session_cancelled`
  - `session_updated`
  - `join_request_reply`

### Booking / Session Detail

- đăng nhập `host.confirmed@picklematch.vn`
- mở `openConfirmed`
- kiểm tra badge `Sân đã chốt`
- vào sửa kèo, xác nhận giờ bị khóa nếu sân đã xác nhận

- đăng nhập `host.approval@picklematch.vn`
- mở `openApproval`
- kiểm tra badge `Sân chưa xác nhận`
- test block xác nhận đặt sân riêng

### Provisional / Placement

- đăng nhập `host.provisional@picklematch.vn`
- kiểm tra badge provisional ở profile / session

### Rating

- đăng nhập `player.matched@picklematch.vn`
- mở session `doneRecent`
- test màn rate-session

- mở profile/public profile để xem dữ liệu historical từ `doneHistorical`

### Completion / Result Confirmation

- đăng nhập `host.approval@picklematch.vn`
- mở `pendingCompletion`
- xác nhận host nhìn thấy session đang chờ submit kết quả

- đăng nhập `player.matched@picklematch.vn`
- mở `resultsPending`
- xác nhận trạng thái chờ confirm kết quả

- đăng nhập `host.confirmed@picklematch.vn`
- mở `resultsDisputed`
- xác nhận thấy dispute note từ player

- đăng nhập `host.approval@picklematch.vn`
- mở `autoClosed`
- xác nhận session đã finalized do auto-close

- đăng nhập `host.confirmed@picklematch.vn`
- mở `ghostVoided`
- xác nhận session bị void / ghost-report

### Achievements / Notifications mở rộng

- đăng nhập `player.matched@picklematch.vn`
- mở profile + notifications
- kiểm tra `achievement_unlocked`

- đăng nhập `host.approval@picklematch.vn`
- mở notifications
- kiểm tra:
  - `session_pending_completion`
  - `session_auto_closed`
  - `host_unprofessional_reported`

- đăng nhập `host.confirmed@picklematch.vn`
- mở notifications
- kiểm tra:
  - `session_results_disputed`
  - `ghost_session_voided`

## 4. Session IDs mẫu

- `openConfirmed`: `55555555-5555-5555-5555-555555555551`
- `openApproval`: `55555555-5555-5555-5555-555555555552`
- `fullConfirmed`: `55555555-5555-5555-5555-555555555553`
- `doneRecent`: `55555555-5555-5555-5555-555555555554`
- `cancelled`: `55555555-5555-5555-5555-555555555555`
- `provisionalHost`: `55555555-5555-5555-5555-555555555556`
- `doneHistorical`: `55555555-5555-5555-5555-555555555557`
- `resultsPending`: `55555555-5555-5555-5555-555555555558`
- `resultsDisputed`: `55555555-5555-5555-5555-555555555559`
- `pendingCompletion`: `55555555-5555-5555-5555-555555555560`
- `autoClosed`: `55555555-5555-5555-5555-555555555561`
- `ghostVoided`: `55555555-5555-5555-5555-555555555562`

## 5. Lưu ý

- Cron auto-finalize rating sau 24h vẫn đang hold, chưa rollout.
- Nếu test TypeScript bằng `tsc`, hiện phần Edge Function Deno cần cấu hình riêng, không thuộc app runtime Expo.
- Tab `Home` hiện vẫn có mock UI riêng nên không phản ánh toàn bộ seed backend.
