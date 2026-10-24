# Phase 4 — Feature 2: Messaging REST API

## Phạm vi

Đã triển khai REST conversations/messages/read state, authorization, idempotency,
cursor pagination, unread summary, rate limit và chặn nhắn tin tối thiểu.
Frontend có API wrappers/types/query keys; chưa có UI chat hoặc messaging socket events.
REST là đường ghi tin duy nhất. Không sửa auth, namespace `/realtime`, singleton
socket hay notification pipeline Phase 3. Không thêm dependency/env ứng dụng.

Schema Feature 1/migration 013 giữ nguyên. Migration **014_messaging_blocks.sql**
thêm quan hệ chặn dành riêng cho messaging; phải migrate trước khi chạy API mới.

## Endpoints và contract

Mọi endpoint dưới `/api/v1` yêu cầu Bearer JWT còn hạn và account active.
Body dùng snake_case, unknown fields bị ValidationPipe từ chối. Không nhận sender,
participants, timestamps, sequence, preview hoặc metadata do client quyết định.

| Method/path | Request | Response |
| --- | --- | --- |
| `GET /conversations` | `limit=20` (1–50), `cursor?` | `{ data: Conversation[], hasMore, next_cursor }` |
| `POST /conversations/direct` | `{ recipient_id }` UUID | `{ conversation, created }`, HTTP 201 cả khi replay |
| `GET /conversations/unread-count` | — | `{ unread_messages, unread_conversations }` |
| `GET /conversations/:id` | — | `Conversation` |
| `GET /conversations/:id/messages` | `limit=30` (1–100), `before_sequence?` | `{ data: ChatMessage[], hasMore, next_cursor }`, newest first |
| `POST /conversations/:id/messages` | `{ client_message_id, message_type, content?, shared_resource_id? }` | `{ message, created }`, HTTP 201 cả khi replay |
| `PATCH /conversations/:id/read` | `{ last_read_sequence: "123" }` | `{ conversation_id, last_read_sequence, last_read_at, unread_count }` |
| `PUT /users/me/message-blocks/:userId` | — | `{ user_id, blocked: true }` |
| `DELETE /users/me/message-blocks/:userId` | — | `{ user_id, blocked: false }` |

`Conversation` gồm ID/type/timestamps, `recipient` (chỉ id, username, display_name,
avatar_url, is_active), `can_send`, `blocked_by_me`, `read_state`,
`recipient_read_state`, `unread_count` và `last_message` an toàn theo viewer.
Không trả email, tokens, password hash hoặc toàn bộ user record.

`ChatMessage` gồm id, conversation_id, sender_id, sequence, client_message_id,
message_type, content, shared_resource và timestamps/deleted_at. Sequence/read cursor
luôn là **decimal string**, tối đa `9223372036854775807`; không ép sang Number.

Message types: `text`, `shared_post`, `shared_location`, `shared_journey`.
Text bắt buộc có content không rỗng, tối đa 4.000 Unicode code points, trim trước
validation/lưu. Shared message bắt buộc có UUID resource thật; caption không bắt
buộc, caption rỗng/whitespace chuẩn hóa NULL. Request text có resource bị từ chối.

### Authorization và privacy

- JWT lấy sender/viewer; mỗi endpoint/query enforce conversation membership.
  Người ngoài và conversation không tồn tại đều nhận 404; không suy ra conversation
  bằng ID. Read chỉ cập nhật participant của JWT, không có tham số user_id.
- MVP cho phép active account bắt đầu chat với active account khác. Không yêu cầu
  follow. Self chat bị 400; missing/inactive recipient khi tạo chat bị 404.
- Khi gửi, kiểm tra lại account trong transaction với row locks. Recipient inactive
  nhận `403 RECIPIENT_UNAVAILABLE`; lịch sử của participant active vẫn đọc được.
- Chỉ gửi shared content khi **cả sender và recipient** có quyền: tái dùng
  `postAccess()` cho posts (kể cả Journey-backed posts); Journey áp dụng owner hoặc
  public/published và owner active; locations hiện là domain public.
- Mỗi lần đọc history/last-message, query lấy preview từ resource thật và đánh giá
  lại quyền của viewer. Private/deleted/draft/inactive-author/unfollowed resource
  trả `shared_resource.available=false`, các trường id/title/image/author/location
  đều NULL. Không cache bản sao nội dung resource trong message. Caption do người
  gửi viết là phần độc lập của tin nhắn, không phải cached preview.
- Message soft-deleted trả content/shared_resource NULL, giữ identity/sequence/key
  để pagination/replay vẫn đúng. Không expose API edit/delete message trong Feature 2.
- Conversation/history/unread và các response chứa conversation/message/read state
  đặt `Cache-Control: private, no-store`.

### Chặn nhắn tin tối thiểu

`messaging_blocks` có PK `(blocker_id, blocked_id)`, FKs tới profiles, CHECK không
chặn chính mình và reverse index. PUT/DELETE idempotent, chỉ thay đổi block của JWT.
Không làm thay đổi follow, posts, profile hoặc notifications.

Nếu một bên chặn, cả hai bị từ chối tạo direct chat hoặc gửi **tin mới** với
`403 MESSAGING_NOT_ALLOWED`. Participant vẫn đọc lịch sử/mark read được. Unblock của
B không xóa block do A tạo. Có thể chặn trước khi từng tạo conversation; có thể chặn
account đã inactive nếu profile còn tồn tại. `blocked_by_me` không expose danh sách
block riêng tư của người khác; `can_send` là quyết định cho cuộc trò chuyện hiện tại.

Block/unblock/create/send cùng dùng advisory transaction lock theo canonical pair;
thứ tự lock là **pair → users (UUID order, FOR SHARE) → conversation**. Quyết định
block/send được tuần tự hóa: block commit trước thì request gửi đang chờ bị từ chối;
send commit trước thì giữ message đó, block ngăn những tin tiếp theo. Hash collision
chỉ tăng contention, không làm bỏ qua authorization. Các writer mới sau này phải giữ
protocol này; raw SQL role chung không có RLS/messaging block trigger.

### Idempotency và transaction

Unique sender/client key và unique direct pair từ migration 013 tiếp tục là hàng
rào database. Pair lock giúp kiểm tra policy/concurrent API requests nhất quán.

Trong send transaction:

1. Kiểm tra membership, pair/accounts/conversation locks.
2. Tìm message theo `(sender_id, client_message_id)`; nếu có, so sánh conversation,
   type, normalized content và immutable resource UUID.
3. Payload trùng trả đúng message đã lưu với `created=false`; payload khác trả
   `409 IDEMPOTENCY_CONFLICT`, không cập nhật tin cũ.
4. Chỉ với tin mới: kiểm tra block/recipient/privacy, INSERT ON CONFLICT DO NOTHING.
   Nếu bị unique conflict do một conversation khác đang dùng cùng key, SELECT lại
   ở **statement mới** rồi so sánh payload. Không dùng fallback CTE cùng snapshot.
5. Message/sequence/last-message commit cùng transaction. Response chỉ về sau commit;
   rollback không giữ message, preview, cursor hay key. Read/create cũng dùng transaction.

Replay là truy xuất kết quả đã commit, nên vẫn trả message cũ sau khi block, recipient
inactive hoặc resource bị xóa, nếu sender còn active và membership vẫn hợp lệ.
Preview luôn được lọc theo quyền hiện tại. Replay không phải gửi một tin mới.

Rate limit dùng storage sẵn có của `@nestjs/throttler`: **30 send requests/60 giây
cho mỗi sender**, gộp mọi conversations/IP, kể cả retry/invalid body; 429 có
`Retry-After`. Global IP limit 120/60 giây hiện có vẫn giữ nguyên. Storage hiện trong
memory của từng API process, chưa phải distributed quota; không bổ sung Redis.

### Pagination và read state

Messages dùng cursor `sequence < before_sequence`, sort DESC và fetch limit+1.
`next_cursor` là sequence cuối trang, NULL khi hết; khi load older, UI dùng
`before_sequence=next_cursor`. Tin mới đến không làm lệch các trang older. Sequence
do database cấp dưới conversation lock; khoảng trống không phải mất message.

Conversation cursor là opaque base64url của `[UTC timestamp đủ 6 số microseconds, UUID]`.
API validate format/date/UUID trước khi truyền SQL. Sort/keyset dùng
`(COALESCE(last_message_at, created_at), id) DESC`, không làm tròn timestamp qua JS Date.
Conversation có hoạt động mới có thể chuyển lên đầu giữa các trang; UI cần refetch
trang đầu/dedup theo conversation ID khi đồng bộ, không coi list như snapshot bất biến.

Read API yêu cầu cursor của message thực sự tồn tại trong chính conversation;
không tồn tại trả `400 INVALID_READ_CURSOR`. Transaction khóa conversation, cập nhật
participant, rồi lấy cursor/unread authoritative. Trigger giữ GREATEST cursor cũ/mới,
stale device/retry không làm read cursor hoặc last_read_at lùi. Unread tính từ SQL,
loại messages của chính viewer và soft-deleted messages. GET/history không tự mark read.

## Frontend và ranh giới Feature 3

`frontend/src/lib/api/messaging.ts` tái dùng `apiFetch`, shared JWT refresh và cookie.
Không tự tạo key mỗi lần retry: caller phải giữ `client_message_id` của submission.
Types ở `frontend/src/types/messaging.ts`; query keys đặt dưới `QUERY_KEYS.messaging`
và có viewer. Chưa mount hooks/cache/UI messaging; Feature 3–4 phải thêm lifecycle
listeners/reconciliation và clear private messaging cache khi logout/đổi account.

Feature 2 **chưa emit Socket.IO events**. Kết quả `created` và transaction boundary
chuẩn bị cho Feature 3 publish sau commit. Không có Socket send command, listener
thứ hai, broker/outbox hay đảm bảo delivery/replay. Thông báo Phase 3 giữ nguyên.

## Triển khai và thử API

Từ `backend/`:

```powershell
npm run db:migrate
npm run db:migrate:status
npm run dev
```

Swagger `/docs` có nhóm Messaging và request DTOs. Có thể dùng Swagger hoặc hai
REST clients với token của A/B từ login flow hiện tại:

1. A POST direct với recipient_id của B; B POST direct ngược lại phải có cùng ID.
2. A POST message với UUID client_message_id; B GET history thấy tin đã lưu.
3. A gửi lại đúng key/payload: ID/sequence giữ nguyên, created=false. Đổi content
   mà giữ key: 409. B gửi tin trả lời bằng token B; sender_id phải là B.
4. B GET unread rồi PATCH read bằng sequence nhìn thấy; GET unread về 0. PATCH
   sequence cũ không làm cursor lùi. User C GET/POST/PATCH conversation A–B nhận 404.
5. A PUT message-blocks/B; hai bên không gửi tin mới được. A DELETE block thì gửi
   lại được; lịch sử vẫn còn. Giữ hoặc retry key cũ phải đối soát cùng message.
6. Phân trang bằng limit nhỏ; shared posts/Journeys chuyển private/xóa phải mất preview.

Chưa có UI chat để kiểm thử hai trình duyệt hoặc realtime delivery ở bước này.

## Kiểm thử

HTTP integration suite `backend/test/messaging-api.db-spec.ts` chạy JWT guard,
ValidationPipe, ApiExceptionFilter, service và PostgreSQL/PostGIS thật, có concurrent
connections/commit. Chỉ chạy trên database disposable có tên chứa `_test`/`test_`;
suite không nạp `.env`, schema UUID riêng và cleanup đúng schema tự tạo.

```powershell
# backend/
$env:WANDERMAP_TEST_DATABASE_URL = '<disposable-postgis-connection-string>'
npm run test:db -- --runTestsByPath test/messaging-api.db-spec.ts
npm run test:db
npm run type-check
npm run lint
npm test -- --runInBand
npm run build
npm run test:e2e -- --runInBand

# frontend/
npm run type-check
npm run build
node --experimental-transform-types --test tests/*.test.mjs
```

Node 22 cần `--experimental-transform-types` cho parameter properties trong API client;
chỉ `--experimental-strip-types` không chạy được suite api-auth. Không thay auth code
để né giới hạn test runner.

Các ca quan trọng: active/missing/expired JWT, membership/forged fields, concurrent
A–B/B–A, cùng key cùng/khác payload và khác conversation, Unicode/size, bigint cursors,
microsecond activity cursors, read multi-device/unread, rollback, sender quota,
block/send race theo cả hai thứ tự, shared resource permissions và unavailable previews.

### Kết quả xác minh ngày 23/10/2026

Chạy trên Node 22.21.1 và PostgreSQL 16/PostGIS 3.5 trong container test riêng,
không dùng volume/database ứng dụng:

| Kiểm tra | Kết quả |
| --- | --- |
| Messaging HTTP integration | PASS: 30/30 tests |
| Toàn bộ `npm run test:db` | PASS: 6/6 suites, 123/123 tests |
| Backend type-check/lint/build | PASS |
| Backend unit tests | PASS: 144 tests / 10 suites |
| Backend e2e health | PASS: 1 test, health/database check mock |
| Frontend type-check/build | PASS; build có warnings cũ ở MapTopbar, PostFeedClient, useDebounce, lib/mapbox |
| Frontend tests (`--experimental-transform-types`) | PASS: 76/76 |
| Migration runner | 001–014 áp dụng thành công, status 0 pending, chạy lại không đổi schema |

Đã khắc phục 18 failures cũ trong `visited-locations-api.db-spec.ts`: fixture JWT
thiếu `exp` khiến các request cần auth nhận 401 trước khi kiểm tra nghiệp vụ.
Fixture hiện dùng `expiresIn: 300` và `skipProcessEnv: true` để cô lập secret test.
Bổ sung kiểm tra token thiếu `exp`/hết hạn vẫn bị từ chối; không thay đổi auth runtime.
Suite visited-locations hiện PASS 19/19; toàn bộ DB tests PASS 123/123 trên PostGIS thật.
DB suites notifications realtime, Journey posts, travel-map và messaging migrations
đều PASS. Lần chạy bản cuối REST còn xác nhận normalization caption trống, rollback
conversation/read/send và private cache headers. Chưa migrate database ứng dụng.

### File thay đổi

- `backend/src/messaging/`: module/controller/service, policy service, sender rate
  guard, DTOs/types và SQL projection lọc quyền resource.
- `backend/src/database/migrations/014_messaging_blocks.sql`.
- `backend/src/app.module.ts`: đăng ký MessagingModule.
- `backend/test/messaging-api.db-spec.ts`: 30 HTTP/PostgreSQL integration tests.
- `backend/test/visited-locations-api.db-spec.ts`: sửa JWT fixture và kiểm tra token
  thiếu expiration/hết hạn vẫn bị từ chối.
- `frontend/src/lib/api/messaging.ts`, `frontend/src/types/messaging.ts` và các barrel
  exports; `frontend/src/constants/index.ts`: viewer-scoped query keys.
- `backend/README.md` và tài liệu này.
