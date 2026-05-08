# Báo cáo Audit Web (Browser-first)

Ngày cập nhật: 2026-05-05  
Phạm vi: Web app chạy public trên trình duyệt điện thoại và app browser (in-app browser), không giả định mô hình WebView bridge native.

## 1) Tóm tắt điều hành

Mục tiêu "ai cũng mở được bằng phone browser hoặc app browser" là khả thi với kiến trúc hiện tại. Tuy nhiên, có 4 rủi ro ưu tiên cao cần xử lý ngay trước khi mở rộng traffic:

1. CSP quá lỏng, tăng mạnh rủi ro XSS.
2. Lộ lọt secret (đặc biệt service role key) nếu .env bị commit/chia sẻ.
3. AuthGate redirect theo effect, có thể để màn hình protected mount trước khi chuyển hướng.
4. Quick-start owner flow có đường đi bypass OTP và logic placeholder không phù hợp môi trường public.

## 2) Findings theo mức độ nghiêm trọng

## Critical

### F-01: CSP quá permissive cho môi trường web public
- Mức độ: Critical
- Bằng chứng: web/index.html:9
- Mô tả:
  CSP hiện cho phép wildcard source cùng unsafe-inline và unsafe-eval. Với app public qua mobile browser/in-app browser, đây là bề mặt tấn công XSS nghiêm trọng, có thể dẫn tới đánh cắp session/token.
- Khuyến nghị:
  1. Chuyển sang allowlist origin rõ ràng (self + domain API/CDN bắt buộc).
  2. Loại bỏ unsafe-eval và unsafe-inline trên production.
  3. Dùng nonce/hash cho script/style khi cần.

### F-02: Rủi ro lộ service role key
- Mức độ: Critical
- Bằng chứng: .env:3, .gitignore:34
- Mô tả:
  SUPABASE_SERVICE_ROLE_KEY xuất hiện trong .env, nhưng .gitignore chỉ bỏ qua .env*.local, không bỏ qua .env. Nếu .env bị commit hoặc rò rỉ, attacker có thể vượt RLS và truy cập dữ liệu cấp admin.
- Khuyến nghị:
  1. Rotate key ngay lập tức.
  2. Bổ sung ignore cho .env và bật secret scanning trong CI.
  3. Chỉ lưu service role key ở server/edge secret manager, không nằm ở runtime client.

## High

### F-03: Auth redirect chạy sau khi tree protected có thể mount
- Mức độ: High
- Bằng chứng: features/player/auth/AuthGate.tsx:112, features/player/auth/AuthGate.tsx:149
- Mô tả:
  Logic redirect đang ở useEffect, trong khi component vẫn trả children. Điều này có thể khiến một số screen protected kịp mount/chạy side effect trước redirect.
- Khuyến nghị:
  1. Chặn render children nếu unauthenticated và không phải public route.
  2. Đưa guard lên layout/route boundary để ngăn mount từ đầu.
  3. Thêm test direct URL khi chưa đăng nhập.

### F-04: Owner quick-start có đường bypass OTP và logic demo placeholder
- Mức độ: High
- Bằng chứng: app/owner/login.tsx:244, app/owner/web-quick-start.tsx:104, app/owner/web-quick-start.tsx:275
- Mô tả:
  Tồn tại entry "trải nghiệm nhanh" từ login và flow quick-start dùng UUID client-side kiểu placeholder. Trong web public, đây là bề mặt lạm dụng quyền ghi dữ liệu.
- Khuyến nghị:
  1. Gỡ khỏi production hoặc khóa bằng feature flag server-side.
  2. Mọi thao tác owner phải dựa trên identity đã xác thực.
  3. Loại bỏ logic placeholder khỏi runtime public.

## Medium

### F-05: Khả năng chịu lỗi mạng/in-app browser chưa mạnh
- Mức độ: Medium
- Bằng chứng: hooks/useNotifications.ts:66, hooks/useNotifications.ts:76
- Mô tả:
  Một số luồng fetch/mutation chưa có chiến lược retry/backoff/offline rõ ràng. In-app browser thường kém ổn định websocket/network hơn browser full.
- Khuyến nghị:
  1. Bổ sung online/offline listener và reconnect strategy.
  2. Retry có backoff cho thao tác quan trọng.
  3. Có trạng thái UI: pending, retrying, failed.

### F-06: Hiệu năng first-load trên mobile có thể chưa tối ưu
- Mức độ: Medium
- Bằng chứng: app/_layout.tsx:28, app/_layout.tsx:45, app.json:25
- Mô tả:
  App chờ font load trước khi render và web output đang ở chế độ single. Điều này dễ làm tăng TTI trên thiết bị yếu/mạng chậm.
- Khuyến nghị:
  1. Render shell sớm trước khi đủ font.
  2. Chỉ giữ font critical ở initial path.
  3. Tách bundle/chunk phù hợp cho web.

### F-07: Ma trận test chưa phản ánh mục tiêu phân phối thực tế
- Mức độ: Medium
- Bằng chứng: playwright.config.ts:35, e2e/smoke.spec.ts:11
- Mô tả:
  E2E hiện chủ yếu Desktop Chrome smoke. Mục tiêu của bạn là mobile browser + in-app browser nên độ phủ này chưa đủ.
- Khuyến nghị:
  1. Thêm project mobile emulation trong Playwright.
  2. Bổ sung checklist test thật trên iOS Safari, Android Chrome, và app browser chính.
  3. Mở rộng scenario auth/deep-link/offline/reconnect.

## Low

### F-08: State ownership còn phân tán ở level screen
- Mức độ: Low
- Bằng chứng: app/owner/claim-court.tsx:45
- Mô tả:
  Có useAuth/AuthGate nhưng nhiều screen vẫn gọi getUser riêng. Điều này làm tăng khả năng lệch trạng thái và tăng chi phí bảo trì.
- Khuyến nghị:
  1. Tập trung session/role về một nguồn dữ liệu chuẩn.
  2. Chuẩn hóa hook dùng chung cho identity/role.

## 3) Đánh giá theo hạng mục bạn yêu cầu

### 3.1 Architecture & Structure
- Điểm tốt:
  1. Tách được components/hooks/lib tương đối rõ.
  2. Có validate deep-link trước khi điều hướng từ notification.
- Điểm cần cải thiện:
  1. Logic nghiệp vụ còn nằm nhiều trong screen.
  2. Cần chuẩn hóa ranh giới auth/data layer để scale tốt hơn.

### 3.2 WebView Integration (theo context mới)
- Kết luận:
  1. Không cần WebView bridge cho mục tiêu hiện tại.
  2. Nên xem app là browser-first URL-driven.
- Lưu ý:
  1. Cập nhật tài liệu kiến trúc để tránh hiểu nhầm là embedded bridge app.

### 3.3 Performance
- Rủi ro chính:
  1. First load có thể nặng trên mobile.
  2. Chưa thấy chiến lược tối ưu riêng cho in-app browser.

### 3.4 Security
- Rủi ro ưu tiên:
  1. CSP lỏng.
  2. Secret hygiene chưa chặt.
  3. Guard protected route cần harden.
- Điểm cộng:
  1. Deep-link có allowlist validation.

### 3.5 State Management
- Hiện trạng:
  1. Có hướng central auth nhưng chưa áp dụng đồng đều.
- Rủi ro:
  1. Dễ phát sinh multiple sources of truth.

### 3.6 Error Handling
- Hiện trạng:
  1. Có dialog/toast ở nhiều luồng.
  2. Chưa có pattern thống nhất cho offline/retry/recovery.

### 3.7 Code Quality
- Vấn đề:
  1. Flow demo/placeholder còn nằm gần runtime public.
  2. Một số convention chưa thống nhất giữa screen và hook/service.

### 3.8 Testing Coverage
- Hiện trạng:
  1. Có smoke e2e và unit cơ bản.
- Thiếu:
  1. Chưa đủ coverage cho mobile/in-app browser và security regression quan trọng.

## 4) Kế hoạch hành động đề xuất (ưu tiên triển khai)

### P0 (làm ngay)
1. Harden CSP production.
2. Rotate và cô lập secret (đặc biệt service role key).
3. Sửa AuthGate để ngăn mount protected screen khi chưa auth.
4. Gỡ/khóa quick-start bypass khỏi production.

### P1 (ngắn hạn)
1. Thêm test mobile browser matrix.
2. Bổ sung offline/retry/reconnect strategy.
3. Tối ưu first-load (font, chunk, shell).

### P2 (trung hạn)
1. Refactor tách rõ service layer và state ownership.
2. Thiết lập security regression checks trong CI.

## 5) Ghi chú phạm vi

Bản audit này đã được hiệu chỉnh theo context mới: web app public qua phone browser và app browser. Vì vậy, các nhận xét về native WebView bridge được giảm ưu tiên hoặc không áp dụng.
