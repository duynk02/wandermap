# Feature 4 — Reconnect & Synchronization

## Phương án

Giữ singleton Manager của Feature 3 và nguồn dữ liệu REST/PostgreSQL của Feature 2.
Mỗi lần namespace connect thành công đã qua JWT middleware sẽ refetch unread và
invalidate/refetch danh sách theo viewer. Khi listener PostgreSQL trở lại ready cũng
đối soát lại. Các trang infinite query đã tải được refetch cùng pageParams; cache
inactive được đánh dấu stale và tải lại khi mở. Không cần cursor, replay hoặc lịch sử
notification trong memory realtime.

Event ID vẫn được validate/dedup; reconciliation không phụ thuộc event có đến hay không.
Query cũ bị cancel trước refetch để snapshot trước reconnect không ghi đè dữ liệu mới.
REST giữ visibility/ownership và quyết định count, không dùng phép cộng/trừ frontend.

## Lifecycle và backoff

`realtimeStore.phase` ghi nhận `connecting`, `connected`, `disconnected`, `reconnecting`,
`authentication-failed`, `session-expired`; không thêm thông báo UI gây nhiễu.

- Transport mất mạng: Socket.IO Manager hiện có retry exponential backoff với jitter,
  base 1 giây, delay max cấu hình 10 giây và timeout 10 giây. Không tạo Manager mới
  hoặc chạy setInterval song song với Manager.
- Namespace `SERVICE_UNAVAILABLE`, server chủ động disconnect hoặc `auth:unavailable`:
  Socket.IO không tự retry các trường hợp namespace từ chối, nên lifecycle dùng một
  timeout có backoff base 1–30 giây, jitter tối đa 50%, để connect lại trên cùng Manager.
- JWT hết hạn: gọi shared REST refresh một lần rồi handshake credentials mới. Token
  mới tiếp tục bị từ chối thì dừng, không refresh loop.
- Refresh lỗi mạng/5xx: giữ session và retry qua backoff; khác với cookie 401/invalid
  JWT/account inactive là lỗi xác thực dừng retry.
- Backend revalidation lỗi hạ tầng phát `auth:unavailable`; account không hợp lệ vẫn
  phát `auth:invalidated`. Cả hai đều đóng socket cũ; chỉ lỗi tạm thời được retry.
- Logout/đổi owner/dispose dọn retry timer, listeners, credentials và pending batches.
  Token memory/session generation ngăn response refresh cũ hồi sinh phiên đã logout.

Reload khi offline hoặc backend lỗi tạm thời: AuthProvider giữ persisted public-profile
hint và retry refresh/getMe với backoff 1–30 giây. Không buộc nhập mật khẩu lại chỉ vì
lỗi mạng. Cookie invalid/expired vẫn reset phiên theo cơ chế hiện có. Đóng tab dừng
runtime; mở lại tab khôi phục qua HttpOnly cookie như reload bình thường.

## Foreground và online/offline

Một observer dùng visibility/online để yêu cầu kiểm tra và REST reconciliation, tối
đa một lần mỗi 15 giây cho các browser hints liên tiếp. Query notification không tự
refetch thêm qua focus handler riêng của TanStack Query. Event mới và connect/ready
vẫn có thể refetch ngay theo batch 100 ms hiện có.

Không coi `navigator.onLine` hoặc event `online` là bằng chứng backend hoạt động.
Connection/REST response thật quyết định health. Khi chưa xác thực xong, browser hints
cũng hỗ trợ phục hồi auth; fallback polling chỉ chạy khi realtime chưa sẵn sàng.

## Multi-tab và cookie session

Notifications/read events vẫn fanout từ server đến mọi socket trong room người nhận.
Không truyền notification data hay access token qua BroadcastChannel.

Refresh trước đây chỉ single-flight trong mỗi tab. Hai tab refresh đồng thời có thể
dùng lại cùng rotating cookie và kích hoạt phát hiện replay của backend. Bây giờ
`navigator.locks` tuần tự hóa refresh/login/logout cookie operations trong cùng origin.
Request chờ lock kiểm tra lại credential version trước khi gọi API.
Auth network requests có timeout 15 giây để tránh giữ cookie lock vô thời hạn khi
backend không phản hồi; timeout được coi là lỗi tạm thời.

BroadcastChannel `wandermap-session` chỉ mang chuỗi `signed-in`/`signed-out` sau thao
tác auth thành công. Tab nhận tín hiệu xóa token/identity cũ, đóng socket và dọn cache;
signed-in phục hồi identity qua REST, signed-out dừng. Nếu shared cookie đã đổi account
trước khi message đến, refresh không được publish JWT có subject khác vào UI owner cũ.

Các API này cần browser hỗ trợ và Web Locks cần secure context (HTTPS; localhost
được hỗ trợ). Nếu thiếu Web Locks/BroadcastChannel, fallback là single-flight mỗi tab
và semantics JWT/refresh hiện có, không có bảo đảm tuần tự hóa/invalidation tức thì
giữa các tab. Không đổi schema session, lưu token vào storage hoặc kéo dài JWT TTL.

## Connection-state recovery

Socket.IO 4.x đang dùng hỗ trợ connection-state recovery, nhưng không bật trong bước
này. Recovery có thể phục hồi rooms/socket.data và có tùy chọn bỏ middleware; xem
[tài liệu Socket.IO](https://socket.io/docs/v4/connection-state-recovery/).
Ứng dụng dùng JWT ngắn hạn, rotation và account checks; REST reconciliation đơn giản
hơn và vẫn đúng sau backend restart, khi recovery trong memory không còn. Mọi kết nối
mới luôn qua middleware xác minh JWT; không bỏ authorization khi phục hồi.

## File và kiểm thử

- Backend: gateway và regression test phân biệt account invalidation/DB outage.
- Frontend: `lib/realtime/lifecycle.ts`, `socket-client.ts`, `browser-resume.ts`,
  `hooks/useAuth.ts`, `useRealtimeConnection.ts`, notification focus options,
  `lib/api/client.ts` (cookie lock/session signals), `stores/realtimeStore.ts`.
- Tests: auth race/lock/channel, namespace/network retry/logout cleanup, browser
  visibility throttle, Chrome notification/reconnect smoke.

Chạy frontend type-check, ESLint các file sửa, `node --experimental-transform-types
--test tests/*.test.mjs`, build; backend type-check/lint/unit tests/build. Chrome smoke
`tests/notifications.browser.mjs` cần production Next local và `WANDERMAP_TEST_WEB_URL`.
Browser API/Socket.IO là fixtures, không ghi DB hay sửa phiên thật.

Không cần migration, dependency hay env mới. Cookie path/CORS/HTTPS và URL realtime
giữ nguyên. Không thêm durable queue/outbox hay thay đổi lịch sử notification.

Kết quả xác minh:

- Backend: type-check, lint, **142 tests** và build pass. Không thay SQL nên không
  chạy lại migration/database suite trong feature này.
- Frontend: type-check, ESLint các file sửa, **76 Node tests** và build pass;
  build còn 6 warnings hiện hữu ngoài phạm vi thay đổi.
- Chrome trên production build: **9 kiểm tra pass**, gồm hai lần refresh 503 khi
  khôi phục trang, server chủ động ngắt kết nối, mất transport đột ngột, đối soát
  dữ liệu bị lỡ qua REST, foreground và tín hiệu logout từ channel khác. Không
  runtime exception; REST/Socket.IO fixtures, không ghi database ứng dụng.
- Browser test dùng channel thứ hai trong cùng browser context để kiểm tra logout;
  Web Locks có unit test serialization. Chưa chạy ma trận nhiều browser/devices
  thật hoặc proxy HTTPS production. Thiết kế cần deploy đồng thời client/server
  hiểu lifecycle event `auth:unavailable` mới.
