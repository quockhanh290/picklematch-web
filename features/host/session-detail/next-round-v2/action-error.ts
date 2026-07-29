export function toUserSafeActionError(error: unknown): string {
  const message = error instanceof Error
    ? error.message
    : error && typeof error === 'object' && 'message' in error
      ? String((error as { message?: unknown }).message ?? '')
      : String(error ?? '')
  const code = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : ''

  // DB type errors (PostgREST cast failures — usually a client-side bug)
  if (code === '22P02') return `Lỗi kiểu dữ liệu khi gọi DB [${code}]: ${message}`

  // Auth
  if (message.includes('Not authenticated')) return 'Vui lòng đăng nhập lại.'
  if (message.includes('Could not read login session')) return 'Không thể đọc phiên đăng nhập. Vui lòng mở bằng Safari/Chrome hoặc đăng nhập lại.'

  // Session state
  if (message.includes('Session not found')) return 'Không tìm thấy buổi chơi. Vui lòng làm mới trang.'
  if (message.includes('Session changed')) return 'Buổi chơi đã thay đổi. Vui lòng làm mới và kiểm tra vòng đấu đã đổi trước khi bắt đầu.'

  // Live match actions
  if (message.includes('Live match not found')) return 'Không tìm thấy trận live. Vui lòng làm mới.'
  if (message.includes('Only live matches can be completed')) return 'Trận này không còn ở trạng thái live. Vui lòng làm mới.'
  if (message.includes('Only suggested/live matches can be cancelled')) return 'Trận không thể hủy ở trạng thái hiện tại.'
  if (message.includes('Only the host can complete live match')
    || message.includes('Only the host can cancel live match')
    || message.includes('Only the host can start live match')
    || message.includes('Only the host can manage live session')) return 'Chỉ host mới có thể thực hiện thao tác này.'
  if (message.includes('A player is already in a live match') || message.includes('Player is in a live match')) return 'Người này đang trong trận live. Hãy kết thúc hoặc hủy trận trước.'
  if (message.includes('Court already has a live match')) return 'Sân này đã có trận live đang diễn ra.'
  if (message.includes('Live match must use available checked-in players')
    || message.includes('Suggested match must use available checked-in players')) return 'Trận phải dùng người chơi đã check-in và còn trong buổi.'
  if (message.includes('Missing expected round match count')) return 'Thiếu thông tin số sân vòng hiện tại. Vui lòng làm mới trang.'
  if (message.includes('Match payload is required') || message.includes('Court is required')) return 'Dữ liệu trận không hợp lệ. Vui lòng thử lại.'

  // Round / commit
  if (message.includes('A round is already active')) return 'Đang có vòng đấu đang diễn ra.'
  if (message.includes('A player can only be assigned once per round')) return 'Mỗi người chơi chỉ có thể xếp lịch 1 lần trong mỗi vòng.'
  if (message.includes('Invalid manual matches')) return 'Các trận đấu tự chọn không hợp lệ.'
  if (message.includes('Manual match has invalid court index')) return 'Trận đấu tự chọn có số sân không hợp lệ.'
  if (message.includes('Manual matches cannot reuse the same court')) return 'Các trận đấu tự chọn không thể trùng sân.'
  if (message.includes('Manual matches exceed court count')) return 'Số trận đấu tự chọn vượt quá số lượng sân.'
  if (message.includes('Manual matches must use checked-in players')) return 'Trận đấu tự chọn phải sử dụng người chơi đã check-in.'
  if (message.includes('Round commit audit failed')) return 'Đánh giá lưu vòng thất bại. Vui lòng làm mới trước khi tiếp tục.'

  // Preview / network
  if (message.includes('Preview is stale') || message.includes('Preview version')) return 'Gợi ý vừa được cập nhật. Bấm bắt đầu lại nhé.'
  if (message.includes('Request timed out')) return 'Yêu cầu quá hạn. Vui lòng kiểm tra kết nối mạng và thử lại.'
  if (message.includes('Temporary network issue')) return 'Lỗi kết nối mạng tạm thời. Vui lòng thử lại.'

  if (message.startsWith('Could not ')) return 'Không thể thực hiện thao tác: ' + message
  return `Thao tác thất bại${code ? ` [${code}]` : ''}: ${message}`
}
