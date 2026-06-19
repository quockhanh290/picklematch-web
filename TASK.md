## Task: Fix 6-circles bug + "Bắt Đầu Ngay" not working
Status: IN PROGRESS

### Completed
- [x] Fix 6-circles bug in `buildCompletedLiveCycleRows` — deduplicate live matches against legacyRoundRows
  - File: `features/host/session-detail/next-round-v2/live-cycle-rows.ts`
  - Thêm `legacyRoundNos` set, filter completedLive để loại match có `round_no` đã có trong legacyRoundRows
- [x] Run tests — 135 unit tests pass, 13 next-round-v2 tests pass
- [x] Investigate "Bắt Đầu Ngay" không hoạt động trên sân 1 vòng 5
  - Root cause: `buildFinalPreviewBoard` trong `replace_courts` mode lock các sân khác trong `currentPreviewBoard`, đánh dấu players của họ là "used". Court 0's available-pool suggestion bị reject vì players cũng dùng trong locked courts.
- [x] Fix "Bắt Đầu Ngay" — 2 thay đổi trong `startMatchNow`:
  1. `current_preview_board: []` thay vì `getCurrentPreviewBoardForEdge()` — cho phép edge function suggest court 0 mà không bị block bởi other courts' previews
  2. `previewRequestSerialRef.current += 1` — cancel in-flight background batch để tránh race condition overwrite

### In progress
- [ ] Chờ typecheck:guard pass

### Next steps
- [ ] Bump `LIVE_PREVIEW_ALGORITHM_VERSION` trước khi deploy
- [ ] Test thực tế trên UI

### Key decisions
- `current_preview_board: []` trong startMatchNow: chỉ cần gợi ý cho 1 sân, không cần giữ preview sân khác vì chỉ update court 0 trong UI; sân khác sẽ được background batch re-suggest sau
- Increment serial trước await: đảm bảo old batch stale TRƯỚC khi bắt đầu edge call của startMatchNow

### Files touched
features/host/session-detail/next-round-v2/live-cycle-rows.ts
features/host/session-detail/NextRoundSuggesterScreenV2.tsx
