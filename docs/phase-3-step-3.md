# Feature 3 — Socket Client Architecture

## Ownership và singleton

`AuthProvider` tại root layout gọi `useRealtimeConnection`; Navbar, Bell, Feed và
Profile không khởi tạo socket. Hook lấy một lease từ registry module `realtime/session.ts`.
Mọi consumer trong cùng tab/QueryClient dùng chung lifecycle, auth subscriptions,
notification subscriptions và pending invalidation batch. Hai QueryClient đang hoạt
động đồng thời không được chiếm cùng private session.

Registry gộp setup/cleanup qua microtask: Strict Mode setup → cleanup → setup chỉ
khởi tạo một resource. Khi lease cuối mất, microtask dọn lifecycle/listeners; remount
cùng tick giữ resource hiện có. Logout vẫn disconnect đồng bộ qua auth/token subscription,
không đợi microtask. Rerender với cùng QueryClient không chạy lại effect.

`socket-client.ts` tạo Socket.IO client lazily khi có authenticated user và token
khớp owner. Mỗi lifecycle chỉ tạo một Manager/Socket, kể cả khi refresh credentials.
Token đổi làm disconnect, gỡ listeners, xóa auth/buffer cũ, rồi handshake lại với
credentials mới trên cùng Manager. Generation của từng lượt kết nối ngăn callback
cũ tác động đến phiên mới khi Socket object được tái sử dụng.

Module imports không mở kết nối. Effect chỉ chạy trong client component; registry
không khởi tạo resource trên server và socket factory từ chối chạy ngoài browser.
Token vẫn chỉ nằm trong memory, không dùng URL hoặc persisted storage. Shared REST
refresh và bounded auth retry của Feature 1 được giữ nguyên.

## TanStack Query và event contract

Tái sử dụng `notification:changed` của Feature 2, với `change` là `created`, `read`
hoặc `deleted`, thay vì thêm tên event trùng chức năng. ID/recipient/type được validate;
dedup có giới hạn và TTL, events được gom 100 ms trước khi refetch REST list/unread.

Query keys vẫn theo viewer. Refetch cancel query cũ trước khi invalidate; infinite
query giữ pageParams và tải lại các trang đã load để tránh lặp/mất row tại ranh giới
trang khi có notification mới. REST quyết định cả trạng thái đã đọc và unread count;
không cộng/trừ count hoặc tạo notification store thứ hai.

`realtimeStore` chỉ giữ owner, connection và listener availability để chọn fallback
polling. Logout/đổi tài khoản dọn cache owner cũ và pending batches. Không thêm replay,
durable recovery, backend endpoint, migration, dependency hay biến môi trường mới.

## File và kiểm thử

- Thêm `frontend/src/lib/realtime/session.ts` và `socket-client.ts`.
- Hook hiện có dùng registry/socket factory; lifecycle bổ sung generation guard và
  xóa credentials khi disconnect.
- Thêm `frontend/tests/realtime-session.test.mjs`, mở rộng test infinite pagination
  trong `realtime-notifications.test.mjs`.

Chạy từ `frontend/`:

```bash
npm run type-check
node --experimental-transform-types --test tests/*.test.mjs
npm run build
```

Kiểm thử bao gồm SSR, Strict Mode effect replay, nhiều leases/remount/cleanup, Manager
identity qua đổi token, callback cũ trên Socket tái sử dụng, logout và infinite-query
created/read. Browser smoke notification có sẵn dùng Chrome và API/Socket.IO fixtures;
không ghi DB. Các test này không thay thế kiểm thử HTTPS/proxy production.

Kết quả: **68/68 Node tests**, frontend type-check, ESLint các file sửa và production
build đều pass. Chrome smoke trên build mới pass 4 kiểm tra desktop/mobile với
REST/Socket.IO fixtures, không có runtime exception. Build còn 6 warnings hiện hữu
ngoài phạm vi thay đổi. Backend không thay đổi nên không chạy lại suite backend.
