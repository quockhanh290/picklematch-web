# QA Checklist

Password chung cho toàn bộ account test:

`Pickle123!`

## Tài khoản test

- `player.fresh@picklematch.vn`
- `host.confirmed@picklematch.vn`
- `host.approval@picklematch.vn`
- `player.matched@picklematch.vn`
- `player.lower@picklematch.vn`
- `player.waitlist@picklematch.vn`
- `player.social@picklematch.vn`

## Session mẫu

- `openConfirmed`: `55555555-5555-5555-5555-555555555551`
- `openApproval`: `55555555-5555-5555-5555-555555555552`
- `fullConfirmed`: `55555555-5555-5555-5555-555555555553`
- `doneHistorical`: `55555555-5555-5555-5555-555555555557`
- `resultsPending`: `55555555-5555-5555-5555-555555555558`
- `resultsDisputed`: `55555555-5555-5555-5555-555555555559`
- `pendingCompletion`: `55555555-5555-5555-5555-555555555560`
- `autoClosed`: `55555555-5555-5555-5555-555555555561`
- `ghostVoided`: `55555555-5555-5555-5555-555555555562`

## Smoke

- [ ] `player.fresh@picklematch.vn`
  Login -> `profile-setup` -> `onboarding` -> vào app.
  Kỳ vọng: user mới đi đúng first-run flow, không bị vào thẳng app.

- [ ] `host.confirmed@picklematch.vn`
  Mở `openConfirmed`.
  Kỳ vọng: vào được session detail, thấy roster và host controls.

- [ ] `player.matched@picklematch.vn`
  Mở `openConfirmed`.
  Kỳ vọng: session detail load ổn cho player matched.

## Join Flow

- [ ] `host.approval@picklematch.vn`
  Mở `openApproval`.
  Kỳ vọng: thấy join requests, test được accept / reject / quick reply.

- [ ] `player.lower@picklematch.vn`
  Mở `openConfirmed`.
  Kỳ vọng: không auto-join nếu không đủ trình, đi đúng nhánh `Xin vào kèo`.

- [ ] `player.waitlist@picklematch.vn`
  Mở `fullConfirmed`.
  Kỳ vọng: session đầy chỗ, vào đúng nhánh waitlist/request.

## Host Post-Match

- [ ] `host.confirmed@picklematch.vn`
  Mở `openConfirmed`, vào `Sắp xếp đội`, đổi đội và `Lưu thay đổi`.
  Kỳ vọng: save thành công, quay lại session detail không lỗi.

- [ ] `host.approval@picklematch.vn`
  Mở `pendingCompletion`.
  Kỳ vọng: thấy đúng state hậu trận dành cho host, chỉ host mới vào được flow nhập kết quả.

- [ ] `host.confirmed@picklematch.vn`
  Mở `resultsDisputed`.
  Kỳ vọng: session detail phản ánh đúng trạng thái `disputed`.

## Player Post-Match

- [ ] `player.matched@picklematch.vn`
  Mở `resultsPending`, rồi vào `confirm-result`.
  Kỳ vọng: thấy `Xác nhận kết quả`, `Hạn xác nhận`, và gửi confirm thành công.

- [ ] `player.matched@picklematch.vn`
  Mở `doneHistorical`, vào `rate-session`.
  Kỳ vọng: rating mở được vì session đã `finalized`.

- [ ] `player.matched@picklematch.vn`
  Với một session chưa `finalized`, thử vào `rate-session`.
  Kỳ vọng: bị chặn đúng cách.

- [ ] `player.social@picklematch.vn`
  Mở `ghostVoided`.
  Kỳ vọng: session đã `void`, không vào flow rating/confirm như session thường.

## Profile UX

- [ ] `host.confirmed@picklematch.vn`
  Mở `profile`.
  Kỳ vọng: thấy copy về `mức khởi điểm hiện tại`.

- [ ] `host.confirmed@picklematch.vn`
  Mở `edit-profile`.
  Kỳ vọng: không còn chọn level trực tiếp, chỉ còn `Làm lại bài đánh giá`.

## Ops Verification

- [ ] Chạy `npm run smoke:backend`
  Kỳ vọng: script pass toàn bộ.

- [ ] Chạy `npm run test:e2e:web`
  Kỳ vọng: Playwright web smoke pass.

- [ ] Chạy SQL:
  ```sql
  select status, return_message, start_time, end_time
  from cron.job_run_details
  where jobid = 3
  order by start_time desc
  limit 5;
  ```
  Kỳ vọng: có các dòng `succeeded`.
