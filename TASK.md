## Task: Watch script alignment + UX improvements
Status: IN PROGRESS

### Completed
- [x] Fix fairness bug: c_rest=2 false positive từ partial rounds (metrics.ts)
- [x] Fix available pool skipping MUST_PLAY players (live-preview.ts)
- [x] Deploy 2 bug fixes lên 4 Supabase edge functions
- [x] Redesign capacity/tradeoff UX (ScreenComponents.tsx):
  - ℹ info block "Tốt nhất từ X/Y người đang rảnh"
  - startDisabled = busy || hasLockedPlayers (fix: không cho start khi có locked player)
  - "Xem lineup thay thế" dùng hasLockedPlayers thay vì showWaitUI
  - Invalidate suggestions chất lượng kém sau khi sân hoàn thành
- [x] Fix watch script sai mode và thiếu params:
  - Bỏ prefer_available_pool: true
  - Thêm planned_total_rounds và court_preset
  - Fix TypeScript errors
  - Luôn dùng replace_courts (không dùng full_board — UI không bao giờ dùng full_board)
- [x] Điều tra watch script vs UI mismatch (session 7d64d01b-...):
  - Player pool GIỐNG NHAU (34 players, cùng pvna, cùng cr=0/mp=0)
  - Algorithm là stochastic (beamsearch) — không phải simple pvna sort
  - Tìm optimal grouping (ghép 6 trận cân bằng) → nhiều local optima khác nhau
  - Cả hai giải pháp đều valid (pvna_gap=0.00 cho tất cả sân)
  - KẾT LUẬN: Expected behavior — watch script không cần phải exact match UI ở vòng đầu

### In progress
- [ ] Hoàn thiện UX của ScreenComponents.tsx

### Next steps
- [ ] [FUTURE — developer only] Debug view: expose full candidate list từ engine để verify lineup quality

### Key decisions
- Watch script mismatch vs UI là expected khi không có match history (nhiều equally-valid solutions)
- Watch script hữu ích để debug algorithm flow và fairness qua nhiều vòng, không để verify exact lineup

### Files touched
features/host/session-detail/next-round-v2/components/ScreenComponents.tsx
features/host/session-detail/NextRoundSuggesterScreenV2.tsx
lib/next-round-suggester/fairness/metrics.ts
lib/next-round-suggester/live-preview.ts
scripts/watch-court-lane.ts
