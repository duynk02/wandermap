# Phase 3 · Feature 2 — Realtime Notifications

## Phạm vi

Notification mới, thay đổi đã đọc và xóa/undo được đẩy đến các kết nối đang online
của đúng người nhận. Danh sách và unread count tiếp tục lấy từ REST/PostgreSQL.
Gateway/JWT, token memory, shared refresh và room isolation của Step 1 được tái sử dụng.

Các loại hiện có là `follow`, `like`, `comment`, `comment_like`, `reply`.
Migration `012_comment_interaction_notifications.sql` bổ sung thông báo cho tác giả
bình luận khi có người thích hoặc trả lời, bao gồm tương tác từ chủ bài viết.
Reply vẫn thông báo cho chủ bài viết nếu đây là một người nhận khác; nếu chủ bài cũng
là tác giả bình luận cha thì chỉ nhận một thông báo `reply`. Tự thích/tự trả lời không
thông báo cho chính người thao tác. Like/comment trên Journey Post dùng cùng business rule.
Không thêm notification riêng cho Journey, save hoặc Messaging.

## Persist → Commit → Emit

```text
Like / Comment / Follow / read / undo
  → SQL + existing notification triggers
  → PostgreSQL COMMIT
  → NOTIFY wandermap_notifications
  → NotificationsListener → NotificationsService
  → RealtimeGateway → user:{recipient_id}
  → viewer-scoped REST query invalidation → list + unread badge
```

Migration `010_notifications_realtime.sql` thêm triggers trên bảng `notifications`
hiện có, không tạo bảng/service nghiệp vụ trùng lặp. Triggers phát metadata cho INSERT,
DELETE và thay đổi thực sự của `read_at`. PostgreSQL chuyển NOTIFY sau commit; rollback
không chuyển event, theo [cơ chế NOTIFY của PostgreSQL 16](https://www.postgresql.org/docs/16/sql-notify.html).
Like/unfollow retry không có thay đổi dữ liệu thì không có event mới.
Cascade delete, unlike, unfollow cũng báo thay đổi để count/list không giữ dữ liệu cũ.

Listener dùng **một kết nối pg.Client riêng**, cấu hình qua DatabaseService, không giữ
slot của request pool và không tạo connection cho mỗi request. Cách này vẫn hoạt động
khi request pool chỉ có một slot. Listener không mở transaction dài, có bounded backoff
khi mất kết nối và đóng connection/timer khi shutdown.

Sau commit, lỗi parse, kiểm tra account hoặc phát Socket.IO được xử lý ở listener;
không thể rollback nghiệp vụ đã lưu. Event offline không nằm trong memory để chờ gửi:
notification vẫn tồn tại trong PostgreSQL và được đọc qua REST.

## Event contract

Namespace/path/auth giữ nguyên Step 1: `/realtime`, `/socket.io`, `auth: { token }`.

`notification:changed` là tín hiệu dữ liệu đã thay đổi:

```ts
interface NotificationChangedEvent {
  notification_id: string; // UUID thật của notifications, ổn định
  recipient_id: string;
  type: 'follow' | 'like' | 'comment' | 'comment_like' | 'reply';
  change: 'created' | 'read' | 'deleted';
}
```

Event không mang email, JWT, refresh cookie, toàn bộ user record hoặc nội dung bài
private. Frontend refetch DTO grouped hiện có, nên cùng một nguồn xử lý visibility,
actors, target links, pagination và unread count. Backend/client đều kiểm tra shape,
allowlist fields/type/change và recipient; không nhận room/user identity từ event client.
Gateway kiểm tra lại account active và expiration ngay trước private delivery.

`notifications:status` có payload `{ available: boolean }`: server gửi khi connect
và khi listener thay đổi trạng thái. Polling chỉ dừng khi socket đã connect **và**
listener sẵn sàng; listener hỏng dù socket còn sống sẽ bật lại fallback.

## Unread và UI

- Giữ NotificationBell, popover responsive và trang thông báo hiện có, gồm loading,
  empty/error, highlight unread, cuộn và pagination.
- Không tự mark-all khi mở danh sách. Có nút **Đánh dấu tất cả đã đọc**; nhấn một row
  đánh dấu nhóm đó rồi điều hướng theo thao tác người dùng. Event mới không điều hướng.
- `POST /api/v1/notifications/read` nhận `{ group_id: string }`, trả `{ updated: number }`.
  `group_id` chính là ID trong DTO list: UUID cho follow/comment-like/reply; `like:<post UUID>` hoặc
  `comment:<post UUID>`. Server lọc recipient từ JWT, unread và post visibility.
  Request đến nhóm không thuộc viewer trả `updated: 0`; retry idempotent.
- `POST /notifications/read-all` tiếp tục hợp đồng cũ. Cả hai mutation phát thay đổi
  qua cùng trigger sau commit nên mọi tab/thiết bị nhận được.
- Grouped row có thể chứa nhiều tương tác. Mark một row sẽ mark toàn bộ unread rows
  của nhóm đó, count giảm theo số tương tác thật, không giả định luôn giảm một.
- Client không cộng/trừ count hoặc chèn event metadata vào list. Query keys theo viewer;
  events được gom 100 ms, dedup theo recipient/notification ID/change với TTL 60 giây,
  tối đa 256 entries. Không giữ lịch sử notification trong memory realtime.
- Refetch hủy query đang chạy trước khi invalidate, kể cả lần fetch đầu chưa có cache,
  để response khởi tạo trước event không ghi đè unread count mới sau event.
- Khi đổi tài khoản/logout, listeners, pending batches, trạng thái health và cache
  viewer cũ được dọn. Event của recipient khác không được chạm cache hiện tại.
- Fallback unread mỗi 30 giây khi transport/listener không sẵn sàng; không polling
  định kỳ khi realtime khỏe. Connect/status-ready refetch tối thiểu đóng gap chuyển chế độ.
- Không thêm toast tự động, Web Push hoặc FCM. Bell/list cung cấp phản hồi hiện có.

## Idempotency của comment

Like/follow đã dùng unique keys và `ON CONFLICT DO NOTHING`. Comment trước đó tạo UUID
mới cho mỗi POST, nên cần khóa thao tác để retry không tạo thêm comment/notification.

Migration `011_comment_request_id.sql` thêm `comments.client_request_id` nullable và
unique partial index `(author_id, client_request_id)`. DTO nhận UUID tùy chọn; frontend
gửi một key cho một thao tác và dùng lại khi retry HTTP/TanStack hoặc nhấn gửi lại
draft bị lỗi. Key được thay khi sửa nội dung, đổi owner/post/parent hoặc gửi thành công.
Backend trả comment cũ cùng counters
hiện tại khi key/payload khớp; dùng lại key với post/parent/content khác trả HTTP 409.
Counter/notification triggers chỉ chạy khi thực sự insert comment mới.

Client cũ không gửi key vẫn hoạt động, nhưng không có bảo đảm dedup HTTP create mà
không cung cấp danh tính thao tác. Không dedup theo nội dung: người dùng vẫn có thể
chủ động gửi hai bình luận cùng nội dung với hai request IDs khác nhau.

## Migration và deployment

Chạy từ `backend/` trước khi dùng backend/frontend mới:

```bash
npm run db:migrate
npm run db:migrate:status
```

Áp dụng `010`, `011` và `012`; không chỉnh sửa migration đã áp dụng. Migration không xóa
dữ liệu cũ. Unique index chỉ áp dụng các key mới không null; tạo index có thể giữ lock
trên bảng comments trong thời gian migration, cần lên lịch phù hợp với bảng lớn.
Kiểm thử migration/nghiệp vụ sử dụng database PostGIS tạm, tách biệt với DB ứng dụng.

`012` không tạo lại thông báo cho tương tác cũ. Comment-like/reply giữ mỗi notification
thành một dòng riêng, dùng UUID ổn định để đọc/dedup, hiển thị nội dung tiếng Việt tương
ứng và mở bài viết khi người nhận nhấn. Bỏ thích xóa notification comment-like; xóa
bình luận/bài viết xóa notification liên quan qua FK cascade. Unique indexes và khóa
request hiện có ngăn thông báo trùng khi retry. Luồng sau commit của `010` được tái sử dụng.

Không có dependency hoặc environment variable bắt buộc mới. Cấu hình socket vẫn theo
Step 1 (`NEXT_PUBLIC_REALTIME_URL`, `CORS_ORIGINS`, HTTPS/proxy upgrade). Cần thêm một
PostgreSQL connection cho listener. PgBouncer transaction pooling không giữ LISTEN
session: triển khai cần kết nối session/direct phù hợp; không đặt listener trong pool
transaction để tránh mất subscription.

## Reliability và giới hạn

NOTIFY là tín hiệu best effort, không phải hàng đợi bền vững hoặc outbox. Khi process
crash, listener mất kết nối hoặc backend chưa LISTEN, dữ liệu vẫn lưu nhưng signal
có thể mất. Status/fallback và refetch khi trở lại ready giúp UI lấy lại dữ liệu hiện
tại; chưa thêm replay cursor, ack, durable retries hoặc recovery protocol của Feature 3.

Transactional Outbox là lựa chọn mở rộng khi cần bảo đảm retry delivery sau crash:
ghi outbox trong cùng transaction, worker phát và đánh dấu đã xử lý. Feature này chưa
cần queue/worker/schema outbox. Với nhiều instance, cần đánh giá adapter/fanout và
chống duplicate toàn hệ thống trước khi scale. JWT revocation giữ giới hạn Step 1.

NOTIFY có hàng đợi tài nguyên trong PostgreSQL; cần tránh listener mở transaction dài
và giám sát queue khi vận hành. Đây là lỗi tài nguyên database có thể làm commit thất
bại, khác với lỗi Socket.IO xảy ra sau commit và đã được tách khỏi nghiệp vụ.

## Kiểm thử

Backend (`backend/`):

```bash
npm run type-check
npm run lint
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run build
```

Database tests yêu cầu `WANDERMAP_TEST_DATABASE_URL` trỏ tới DB test riêng (tên chứa
`_test_`), không tự đọc DATABASE_URL ứng dụng. Suite mới commit thật nên chỉ tạo/xóa
schema fixture có tên ngẫu nhiên trong DB test này:

```bash
npm run test:db -- --runTestsByPath test/notifications-realtime.db-spec.ts
```

Frontend (`frontend/`, Node 22 cho transform TypeScript):

```bash
node --experimental-transform-types --test tests/*.test.mjs
npm run type-check
npm run build
```

Kết quả sau bổ sung tương tác bình luận: backend type-check/lint/build và
**144 unit/integration tests** pass; frontend type-check/build và **76 Node tests** pass.
Build frontend còn 6 warnings hiện hữu ngoài phần thay đổi. **14 PostgreSQL/PostGIS tests thật** pass,
bao gồm actual commit/rollback, 6 comment retries đồng thời, listener/gateway thật,
hai tab người nhận, HTTP mark read và lỗi Socket.IO không làm mất dữ liệu đã commit.
Database tạm được dọn sau kiểm thử. Migration `012` đã áp dụng vào database local;
không bổ sung dữ liệu thông báo cho các tương tác trước migration.

Chrome smoke trên production build cũng **pass 10 kiểm tra**, gồm: event cập nhật badge
không reload/chuyển trang; popover highlight unread và không tự mark-read; mark-all
qua REST đưa badge về 0; mobile 390 px không tràn ngang; nội dung/đường dẫn thích và
trả lời bình luận; reconnect/foreground đồng bộ REST và logout giữa các tab.
REST/Socket.IO trong browser
smoke dùng fixtures; phần DB/commit/delivery thật được kiểm tra riêng trong suite trên.
Chạy `tests/notifications.browser.mjs` khi Next production server local đang chạy và
đã đặt `WANDERMAP_TEST_WEB_URL` tương ứng. Runner cần Chrome, Node 22 và dependencies
cả hai app; không ghi database và không gọi API mutation thật.

## File thay đổi chính

- Backend: migrations `010`, `011`, `012`; `database.service.ts`; notification event/parser,
  listener, DTO read, service/controller/module; gateway/module và tests tương ứng.
- Idempotency: comment DTO/service/unit tests; frontend comment input, types/API và
  các component gửi comment/reply.
- Frontend: lifecycle, realtime notification sync, realtimeStore, notification hook,
  NotificationList và tests (gồm `notifications.browser.mjs`); tái sử dụng bell/header hiện có.
- README root/backend và tài liệu này.
