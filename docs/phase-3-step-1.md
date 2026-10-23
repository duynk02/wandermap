# Phase 3 · Step 1 — Gateway & JWT

## Phạm vi và kiến trúc

Step này thiết lập Socket.IO transport, authentication, room isolation và lifecycle.
Không phát notification/unread count, không thay REST, không thêm Messaging hoặc cơ chế
recovery/replay/cache synchronization của Step 2–3. Polling thông báo hiện tại vẫn chạy
vì chưa có notification delivery qua socket.

Hiện trạng được đối chiếu từ mã nguồn:

- `004_notifications.sql` tạo bảng/index và triggers cho follow, like, comment;
  self-interaction bị loại, un-follow/un-like xóa notification tương ứng.
- `NotificationsService` và controller đã có list nhóm theo post, unread count theo
  tương tác và `POST /notifications/read-all`. Chưa có mark-read từng mục.
- HTTP guards verify JWT, kiểm tra `users.is_active`. Step này gom logic trùng thành
  `AccessTokenService` để HTTP/Socket.IO dùng cùng chính sách.
- Access token chỉ nằm trong memory của API client. Refresh token là cookie HttpOnly,
  được rotate qua REST với một promise dùng chung cho các callers trong cùng tab.
- Browser REST dùng Next rewrite `/api/v1/*`; socket kết nối trực tiếp NestJS qua URL
  riêng, cùng HTTP server/cổng với API. Không giả định Next rewrite hỗ trợ upgrade.

Gateway dùng namespace chung `/realtime`, phù hợp mở rộng transport cho Messaging
sau này mà không dựng thêm socket server. Business logic vẫn thuộc domain modules.
Không có bảng, migration, endpoint REST hoặc notification service mới.

## Contract kết nối

| Thành phần | Giá trị |
| --- | --- |
| Namespace | `/realtime` |
| Engine.IO path | `/socket.io` (không nằm dưới `/api/v1`) |
| Credentials | `auth: { token: accessToken }` |
| Room riêng | `user:{verifiedJwt.sub}` |
| Live expiry signal | `auth:expired`, payload `{}`, sau đó server disconnect |
| Account/DB invalidation | `auth:invalidated`, payload `{}`, sau đó server disconnect |
| Handshake error | `connect_error.data.code` như bảng dưới |

| Code | Ý nghĩa / client behavior |
| --- | --- |
| `TOKEN_EXPIRED` | Dùng shared REST refresh một lần, kết nối với token mới |
| `UNAUTHORIZED` | Thiếu/sai token, claims không hợp lệ hoặc account unavailable; dừng socket |
| `ORIGIN_NOT_ALLOWED` | Namespace từ chối Origin ngoài allowlist; dừng socket |
| `SERVICE_UNAVAILABLE` | Không xác minh được do lỗi hạ tầng/shutdown; không coi là refreshable JWT error |

Origin bị chặn ở Engine.IO `allowRequest` có thể trả transport error thay vì namespace
error code. Client không refresh token cho transport error.

Server chỉ nhận access token qua auth payload, không dùng query string/cookie để xác
thực socket. Middleware hoàn tất verify chữ ký HS256, expiration, UUID subject, email
claim và kiểm tra tài khoản active **trước** khi chấp nhận connection. Kiểm tra lại
expiration sau DB await để không nhận token vừa hết hạn trong handshake.

Không có event cho client join room hoặc truyền userId quyết định danh tính. Mỗi
connection chỉ join room theo JWT; nhiều tab/thiết bị của một user cùng tham gia room
đó. Socket.IO tự xóa room membership khi disconnect. Timer expiry/revalidation được
dọn riêng khi disconnect và shutdown; không lưu online/offline vào database.

Chưa có application event handler ở Step 1. Khi thêm handler sau này, vẫn phải kiểm
tra quyền/danh tính và thời hạn tại handler; không dựa riêng vào lifecycle hook.
Không bật connection-state recovery có khả năng phục hồi membership cũ/bỏ middleware.

## Lifecycle và giới hạn session hiện có

| Tình huống | Hành vi |
| --- | --- |
| JWT còn hạn | Verify rồi join room theo server identity |
| JWT hết hạn trước handshake | Từ chối với `TOKEN_EXPIRED`; client dùng shared refresh |
| JWT hết hạn khi đang kết nối | Timer emit `auth:expired`, đóng transport; client refresh một lần |
| Refresh thành công | Token memory thay đổi, socket cũ được đóng, kết nối mới phải qua middleware |
| Refresh trả 401 | Clear token, gọi session-expired handler, xóa phiên/cache qua auth lifecycle |
| Refresh lỗi mạng/server | Dừng lần refresh socket đó; REST/polling giữ hành vi hiện tại |
| Token mới tiếp tục bị từ chối | Không refresh vô hạn; chờ credentials/session thay đổi bên ngoài |
| Logout | Reset viewer/cache và disconnect ngay; chờ refresh đang chạy trước khi revoke cookie qua REST |
| Đổi tài khoản | Dọn transport/cache owner cũ; kết nối mới dùng credentials mới |
| Account bị vô hiệu hóa / DB outage | Revalidation mỗi 30 giây, fail closed và disconnect |
| Server restart | Kết nối cũ mất; transport reconnect qua handshake xác thực mới; chưa có REST recovery |

JWT hiện chỉ chứa `sub`, `email`, `iat`, `exp`; chưa có session ID/JTI hoặc danh sách
thu hồi access token. `auth_sessions.revoked_at` hiện thu hồi **refresh session**.
Step này giữ model đó: revocation được nhận biết khi refresh; JWT đã cấp có thể tiếp
tục hợp lệ đến `exp` (mặc định tối đa 15 phút sau phát hành), không tồn tại vô hạn.
Logout đóng socket của tab hiện tại ngay. Không tuyên bố đã thu hồi tức thì mọi JWT
trên mọi thiết bị; muốn khả năng đó cần thiết kế session binding riêng.

API client và socket dùng chung `refreshInFlight`; không có refresh cookie hoặc token
storage mới. Credential version ngăn refresh đang chờ ghi đè token sau logout/đổi
tài khoản. Dữ liệu thông báo dùng query keys theo viewer và bị cancel/remove khi đổi
viewer; chưa có listener notification hoặc đồng bộ lại dữ liệu qua socket.

Request REST ghi nhận phiên và credential version lúc bắt đầu: response 401 của phiên
cũ không được refresh hoặc replay dưới phiên mới; request cùng phiên dùng lại token
đã refresh mà không rotate thêm lần nữa. Chuyển trạng thái login/register/logout
chặn refresh mới và chờ refresh đã chạy hoàn tất trước khi thay cookie; việc chỉ bỏ
qua access token trả muộn không đủ vì browser vẫn áp dụng header `Set-Cookie`.

## Environment và triển khai

Frontend thêm vào `.env.local` trước khi build:

```dotenv
NEXT_PUBLIC_REALTIME_URL=http://localhost:4000
```

Đây là origin public của backend (không thêm `/api/v1`, namespace hoặc token). Local
mặc định dùng cổng 4000; production cần URL HTTPS backend truy cập được từ browser.
`API_INTERNAL_URL` vẫn dành cho REST server fetch/rewrite, không được đưa ra client.

Backend tiếp tục dùng `JWT_ACCESS_SECRET`, `ACCESS_TOKEN_TTL_SECONDS` và
`CORS_ORIGINS`; không có biến backend bắt buộc mới. Frontend origin phải có trong
`CORS_ORIGINS`. Adapter áp dụng cùng allowlist cho CORS polling và `allowRequest`
của WebSocket upgrade; namespace kiểm tra lại Origin. Native/server clients không
gửi Origin vẫn phải có JWT hợp lệ, theo chính sách HTTP hiện tại.

Proxy trước NestJS cần chuyển `/socket.io/*`, hỗ trợ HTTP polling và WebSocket
upgrade, đồng thời giữ Origin thật. Không đổi cookie path/SameSite/CORS thành wildcard.
Refresh cookie vẫn chỉ dùng REST qua `/api/v1/auth`.

Step này chạy một backend instance. Chưa có Redis adapter, cross-instance rooms hoặc
sticky sessions cho polling; phải thiết kế các phần đó trước khi scale nhiều instance.
Không dùng memory của gateway lưu lịch sử notification.

Dependencies thêm:

- Backend runtime: `@nestjs/websockets`, `@nestjs/platform-socket.io` nhánh 11 tương
  thích NestJS hiện có; `socket.io` nhánh 4.
- Backend dev: `socket.io-client` cho integration tests.
- Frontend runtime: `socket.io-client` nhánh 4.

## Xác minh

Chạy trong `backend/`:

```bash
npm run type-check
npm run lint
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run build
```

Integration test gateway dùng HTTP listener và Socket.IO client/server thật, JWT ký
thật, `DatabaseService` stub; không cần DB/env ứng dụng hoặc migration. Bao phủ missing,
forged, expired/invalid-claims JWT, inactive user, lỗi DB được ẩn chi tiết, async handshake
gating, A/B isolation, multi-tab fanout, spoof room, Origin cả hai transports, live
expiry, active-account revalidation và disconnect cleanup. Shared verifier có tests
riêng và regression cho cả hai HTTP guards.

Frontend có tests cho refresh single-flight, stale refresh, socket teardown/owner
switch, bounded auth refresh và invalidation. Xem `frontend/tests/realtime*.test.mjs`
và `frontend/tests/api-auth.test.mjs`, chạy từ `frontend/`:

```bash
node --experimental-transform-types --test tests/*.test.mjs
```

Chạy thêm `npm run type-check`, `npm run build`
trong `frontend/`. Node test suite dùng flag transform TypeScript, cần Node hỗ trợ
`--experimental-transform-types` (đã chạy với Node 22).

Kết quả kiểm tra triển khai:

- Backend: type-check, lint, build, 78 unit/integration tests và 1 health e2e đều pass.
- Frontend: type-check, ESLint các file auth/realtime đã sửa, 47 Node tests và build
  đều pass. Build vẫn có 6 warnings hiện hữu trong MapTopbar, PostFeedClient,
  useDebounce và lib/mapbox, ngoài phạm vi thay đổi này.
- `git diff --check` pass. `npm audit` backend còn báo 31 findings ở dependency tree
  hiện tại (2 moderate, 29 high); không tự nâng major Jest/toolchain trong Step này.

Chưa thay cho kiểm thử browser nhiều thiết bị/HTTPS production proxy và DB thật.
Step này không thay SQL nên không chạy migration trên database ứng dụng.

## File thay đổi

- Backend auth: thêm `src/auth/access-token.service.ts` và test; đăng ký/export tại
  `auth.module.ts`, tái sử dụng trong hai `common/guards/*access-token.guard.ts`;
  dọn unused imports của `auth.controller.ts` để lint qua.
- Backend transport: thêm `src/realtime/realtime.module.ts`, `realtime.gateway.ts`,
  `realtime-io.adapter.ts`, `realtime.gateway.spec.ts`; đăng ký tại `app.module.ts`
  và gắn adapter tại `main.ts`.
- Frontend: thêm `src/lib/realtime/lifecycle.ts`, `src/hooks/useRealtimeConnection.ts`;
  gắn một lần tại `components/layout/AuthProvider.tsx`; cập nhật `lib/api/client.ts`,
  `lib/api/auth.ts`, `hooks/useAuth.ts` và comment logout tại `ProfileHeaderActions.tsx`.
- Frontend tests: `tests/api-auth.test.mjs`, `tests/realtime-lifecycle.test.mjs`.
- Cấu hình/tài liệu: `frontend/.env.example`, package/lockfiles hai app, README root,
  backend README và tài liệu này.
