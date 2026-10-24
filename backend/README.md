# WanderMap API

Backend độc lập cho WanderMap, xây dựng bằng NestJS + TypeScript + PostgreSQL/PostGIS. API được tổ chức theo domain trong một **modular monolith**; PostgreSQL được truy cập qua `pg` và SQL có tham số thay vì ORM, nhằm kiểm soát rõ các truy vấn PostGIS, trigger, constraint và migration SQL hiện có.

Phase 3 Step 1 bổ sung Socket.IO namespace `/realtime` trên cùng HTTP server, JWT
middleware và room riêng theo user. Xem [contract, lifecycle và cấu hình triển khai](../docs/phase-3-step-1.md).
Feature 2 phát thay đổi notification sau commit qua PostgreSQL LISTEN/NOTIFY và socket;
frontend refetch REST cho list/unread. Áp dụng migrations 010–012 trước khi chạy phiên
bản mới; xem [contract, triển khai và kiểm thử](../docs/phase-3-step-2.md). Recovery/replay
chưa triển khai.

Phase 4 Feature 1 bổ sung schema direct conversations/messages, sender-scoped
idempotency key, thứ tự sequence và read cursor. Chạy migration 013 khi triển khai.
Xem [thiết kế, protocol SQL và kiểm thử PostgreSQL](../docs/phase-4-feature-1.md).

Phase 4 Feature 2 có Messaging REST API, cursor pagination, authorization, read/unread,
idempotency và block nhắn tin tối thiểu (migration 014). Frontend có wrappers/types;
xem [API contract, policy và kiểm thử](../docs/phase-4-feature-2.md).

Phase 4 Feature 3 tích hợp message/read/conversation events sau commit vào namespace
`/realtime`, user-room fanout và frontend REST reconciliation khi reconnect.
Xem [event contract, cache synchronization và multi-tab tests](../docs/phase-4-feature-3.md).

Phase 4 Features 4–5 bổ sung [giao diện messaging](../docs/phase-4-feature-4.md) và
[chia sẻ Post/Location/Journey qua chat](../docs/phase-4-feature-5.md). Tái sử dụng
messaging REST và per-viewer resource policy; caption được giới hạn theo Unicode
code points để khớp PostgreSQL `char_length`. Không cần migration sau 014 cho UI/share.

Messaging hiện yêu cầu theo dõi qua lại khi tạo hội thoại hoặc gửi tin mới.
`GET /conversations/contacts` cung cấp bạn bè (`kind=friends`, mặc định), kể cả
người chưa từng chat, hoặc người đang chờ theo dõi lại (`kind=followers`);
API followers/following trả thêm trạng thái quan hệ theo viewer. Hủy theo dõi giữ
lịch sử và khóa gửi mới; xem [hợp đồng, đồng bộ và kiểm thử](../docs/phase-4-mutual-follow.md).

Phase 4 Steps 6–7 hoàn thiện read/unread UX, conversation ordering, scroll restoration
và xác minh frontend qua REST/Socket.IO/PostGIS thật, gồm multi-user/device và hồi
quy Phase 3 Notifications. Xem [kết quả, security review và cách chạy lại](../docs/phase-4-steps-6-7.md).

## Yêu cầu

- Node.js 20.19+ (khuyến nghị Node.js 22 LTS)
- npm
- Docker + Docker Compose nếu muốn chạy PostgreSQL/PostGIS bằng cấu hình local đi kèm

## Chạy local

Từ thư mục `backend/`:

```bash
cp .env.example .env
```

Mở `backend/.env` và thay `JWT_ACCESS_SECRET` bằng secret ngẫu nhiên dài tối thiểu 32 ký tự. Ví dụ để tạo secret cục bộ:

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Không dùng secret mẫu trong production và không commit `.env`.

Khởi động database:

```bash
docker compose up -d postgres
```

Cài dependency, áp dụng migrations và khởi động API:

```bash
npm install
npm run db:migrate
npm run dev
```

Mặc định:

- API: `http://localhost:4000/api/v1`
- Health check: `http://localhost:4000/api/v1/health`
- Swagger UI: `http://localhost:4000/docs`
- PostgreSQL: `localhost:5432`

Kiểm tra trạng thái migration:

```bash
npm run db:migrate:status
```

Chạy kiểm tra chất lượng:

```bash
npm run type-check
npm test
npm run test:e2e
npm run lint
npm run build
```

### Chạy API bằng npm ở repository root

Để thuận tiện, repository gốc có các script `api:dev`, `api:build`, `api:test`, `api:type-check` và `api:db:migrate`. Các lệnh đó chuyển tiếp đến `backend/`; dependency frontend và backend vẫn được cài độc lập.

## Environment variables

| Biến | Ý nghĩa |
|---|---|
| `NODE_ENV` | `development`, `test` hoặc `production` |
| `PORT` | Cổng HTTP API, mặc định `4000` |
| `DATABASE_URL` | PostgreSQL connection string |
| `DB_POOL_MAX` | Giới hạn connection pool, mặc định `10` |
| `JWT_ACCESS_SECRET` | Secret ký access token; tối thiểu 32 ký tự |
| `ACCESS_TOKEN_TTL_SECONDS` | Thời hạn access token, mặc định `900` giây |
| `REFRESH_TOKEN_DAYS` | Thời hạn refresh session, mặc định `30` ngày |
| `CORS_ORIGINS` | Danh sách origin frontend, phân tách bằng dấu phẩy |
| `COOKIE_SECURE` | Đặt `true` khi cần cookie Secure; production luôn bật Secure |
| `COOKIE_SAME_SITE` | `lax` mặc định; dùng `none` chỉ khi frontend/API khác site, bắt buộc HTTPS và `COOKIE_SECURE=true` |
| `PGSSLMODE` | Đặt `require` nếu PostgreSQL từ xa yêu cầu TLS; chứng chỉ được xác minh theo trust store của Node.js |

## Những domain đã triển khai

### Authentication

Ví dụ đăng ký (email/password):

```json
{
  "email": "duy@example.com",
  "password": "replace-this-with-a-strong-password",
  "username": "khac_duy",
  "display_name": "Khắc Duy"
}
```

`POST /auth/login` nhận `{ "email": "...", "password": "..." }`. Response trả `accessToken` và profile; refresh token không nằm trong JSON mà được đặt trong cookie HttpOnly.

- `POST /auth/register` — tạo user + profile trong transaction.
- `POST /auth/login` — xác thực email/password.
- `POST /auth/refresh` — xoay refresh token, đọc token từ HttpOnly cookie.
- `POST /auth/logout` — revoke refresh session.
- `GET /auth/me` — profile của access token hiện tại.

Password được hash bằng bcrypt. Access token JWT có thời hạn ngắn; refresh token ngẫu nhiên chỉ lưu hash trong database, được đặt vào cookie `HttpOnly`, `SameSite=Lax` mặc định, `Secure` trong production. Với frontend/API khác site, cần `COOKIE_SAME_SITE=none`, HTTPS và `COOKIE_SECURE=true`; origin vẫn được kiểm tra theo allowlist. API bảo vệ route bằng guard và kiểm tra user còn active. Google OAuth chưa được chuyển đổi; cần triển khai riêng và cấu hình provider trước khi bật đăng nhập Google trên frontend.

### Locations / PostGIS

- `GET /locations` — lọc category, rating, country, city, search và pagination.
- `GET /locations/in-viewport?west=...&south=...&east=...&north=...` — truy vấn viewport bằng GiST index; hỗ trợ viewport cắt kinh tuyến 180°.
- `GET /locations/trending?limit=50`
- `GET /locations/:id`
- `POST /locations` — tạo hoặc lấy lại location bằng `google_place_id`, yêu cầu Bearer token.

Coordinates được gửi/nhận dưới dạng `{ "lat": 10.77, "lng": 106.70 }`; database lưu `geometry(Point, 4326)`.

### Posts

- `GET /posts/feed` — feed public có pagination và filter `author_id`, `location_id`.
- `GET /posts/following` — feed của người đang follow, yêu cầu đăng nhập.
- `GET /posts/by-location/:locationId`
- `GET /posts/by-author/:username`
- `GET /posts/:id` — áp dụng visibility `public`, `followers`, `private`.
- `POST /posts`, `PATCH /posts/:id`, `DELETE /posts/:id`
- `POST/DELETE /posts/:id/like`
- `POST/DELETE /posts/:id/save`

Like/save là các thao tác idempotent, không phải toggle dựa vào trạng thái không chắc chắn ở client. Database trigger duy trì counters.

### Users / social / pins

- `GET /users/me`, `PATCH /users/me`
- `GET /users/:username`
- `POST/DELETE /users/:username/follow`
- `GET /users/:username/followers`
- `GET /users/:username/following`
- `GET /users/me/pins`, `PUT/DELETE /users/me/pins/:locationId`

#### Chỉnh sửa hồ sơ

`PATCH /api/v1/users/me` yêu cầu Bearer token và chỉ cập nhật hồ sơ của user hiện tại.
Các trường cho phép: `username` (3–30 ký tự chữ cái không dấu, số, `_`),
`display_name` (1–80 ký tự sau khi trim), `bio` (tối đa 500),
`avatar_url` (URL HTTP/HTTPS hoặc `null`) và `home_city` (tối đa 120).
Các trường khác bị ValidationPipe từ chối.
Username duy nhất không phân biệt hoa/thường; trùng trả HTTP 409 với code `USERNAME_TAKEN`.
`bio`, `home_city` có thể gửi chuỗi trống hoặc `null` để xóa giá trị.
Response trả profile đã cập nhật, không chứa email hoặc token.

Chạy `npm run db:migrate` từ `backend/` trước khi khởi động phiên bản này để áp dụng
`006_profile_editing.sql` (thêm hai cột nullable `home_city`, `website`, giữ dữ liệu cũ).
Trường website đã được loại khỏi giao diện và hợp đồng API. Cột `website` trong
migration đã áp dụng được giữ nguyên để bảo toàn dữ liệu và checksum; ứng dụng không sử dụng cột này.
Không cần biến môi trường mới. Avatar dùng lại `POST /api/v1/uploads/images`;
ảnh được chuyển WebP tối đa 2048 px và loại metadata. Không triển khai ảnh bìa.
Frontend cho phép kéo ảnh, thu phóng và xác nhận vùng cắt avatar theo tỷ lệ 1:1
trước khi áp dụng vào form. Ảnh đã cắt có cạnh tối đa 512 px, không phóng lớn ảnh nguồn nhỏ,
và chỉ được upload khi lưu hồ sơ. Hủy thao tác cắt giữ nguyên avatar trước đó.
Đổi username làm đổi URL hồ sơ; URL username cũ không có alias tự động.

### Itineraries

- `GET /itineraries` — danh sách public; `?mine=true` yêu cầu auth.
- `GET /itineraries/:id`
- `POST /itineraries`, `PATCH /itineraries/:id`, `DELETE /itineraries/:id`
- `POST/PATCH/DELETE /itineraries/:id/stops` và `/itineraries/:id/stops/:stopId` (xem Swagger để biết schema request chính xác).

## API conventions & security

- Tất cả API nằm dưới `/api/v1`.
- Validation toàn cục: `transform`, `whitelist`, và `forbidNonWhitelisted`.
- Response lỗi chuẩn hóa với `statusCode`, `code`, `message`, `path`, `timestamp` và request ID.
- Request SQL sử dụng parameter binding; dynamic columns trong PATCH lấy từ allowlist cố định trong code.
- CORS bật credential và allowlist từ `CORS_ORIGINS`; global rate limit cơ bản, Helmet security headers và graceful pool shutdown.
- Các thao tác viết quan trọng được enforce bằng backend authorization; không dựa vào UI để bảo vệ quyền sở hữu.
- Swagger UI ở `/docs`; không gửi token/cookie thật vào tài liệu công khai.

## Database migrations

My Travel Map thêm `GET /users/:username/travel-map` và bộ lọc year/search/country
cho danh sách visited. Module `journeys/` cung cấp list/create/detail/update/delete/publish,
kiểm tra ownership, public + published, stops hợp lệ, revision và transaction.
Tái sử dụng schema 007–008; không có migration mới.
Xem [API, semantics riêng tư và kiểm thử My Travel Map/Journey](../docs/phase-2-step-3.md).

Step 2 bổ sung `008_visited_locations_cutover.sql` cùng API `/users/me/visited-locations`
và `/users/:username/visited-locations`, quản lý visits con qua `/:id/visits`.
Mutation bắt buộc JWT/ownership; public list/counters lọc visibility. Pins visited cũ
được backfill private, không suy ra ngày đến; API pins cũ giữ shape và đọc marks chuẩn.
Deploy migration cùng backend mới khi writer pins cũ đã dừng.
Xem [hợp đồng đầy đủ và hướng dẫn triển khai/test Step 2](../docs/phase-2-step-2.md).

Phase 2 Step 1 thêm `007_travel_map_journeys.sql`: `user_visited_locations`
(đánh dấu duy nhất/user/location), `user_location_visits` (lịch sử theo ngày),
`journeys` và `journey_stops`. Dữ liệu mới mặc định private; Journey mặc định draft.
Migration không chuyển pins cũ, không thay posts/itineraries hoặc API hiện có.
Cutover pins và API được triển khai đồng thời ở Step 2 qua migration 008 và module mới.
Xem [tài liệu kiến trúc](../docs/phase-2-architecture.md) trước khi dùng bảng mới.

Kiểm thử migration/constraints trên DB PostGIS thử nghiệm: đặt
`WANDERMAP_TEST_DATABASE_URL`, chạy `npm run test:db` trong backend/.
Suite không đọc DATABASE_URL ứng dụng; tạo schema tạm trong transaction rồi
rollback toàn bộ. Thiếu biến test URL thì suite được skip. Không cần dependency mới.

SQL migration ở `src/database/migrations/` là append-only. Runner dùng PostgreSQL advisory lock, chạy mỗi migration trong transaction và lưu SHA-256 checksum trong `schema_migrations`. Nếu file migration đã áp dụng bị sửa, runner dừng để tránh drift; hãy tạo migration mới thay vì chỉnh migration cũ.

Nếu messaging báo `relation "conversation_participants" does not exist`, kiểm tra `npm run db:migrate:status` rồi chạy `npm run db:migrate` từ `backend/`; database ứng dụng cần cả migrations 013 và 014. Khởi động backend và chờ health trả thành công trước khi mở frontend để tránh proxy `ECONNREFUSED` trong lúc API chưa lắng nghe.

Một số migration được cố định LF trong `.gitattributes` để giữ nguyên SHA-256 khi checkout trên Windows. Nếu runner báo checksum khác, đối chiếu bytes với bản đã áp dụng; chỉ khôi phục line endings khi đã xác minh nội dung khớp checksum cũ. Không cập nhật checksum trong `schema_migrations` để bỏ qua thay đổi SQL.

`docker compose down` giữ dữ liệu trong volume. Chỉ dùng `docker compose down -v` khi chắc chắn muốn xóa hoàn toàn database local.

## Tình trạng migration từ Supabase

Schema mới đã thay quan hệ `profiles.id -> auth.users.id` bằng bảng `users` do ứng dụng quản lý; các policy dựa vào `auth.uid()` được thay bằng guards và checks ở backend. Không chạy migration cũ trực tiếp lên database mới.

Chưa thực hiện copy dữ liệu thật từ Supabase. Trước khi chuyển production cần backup, xuất/import dữ liệu theo dependency, giữ nguyên UUID cho profiles/posts/follows/likes/saves/pins/itineraries, kiểm tra số lượng hàng và các quan hệ, đồng thời chọn chiến lược cho credentials. Không giả định hash password của Supabase có thể dùng lại an toàn nếu chưa kiểm tra tương thích; có thể yêu cầu password reset hoặc migration auth có kiểm soát.

## Known follow-up work

- Kết nối Next.js API client và gỡ Supabase khỏi từng frontend feature (chưa thực hiện).
- Chuyển Google OAuth và các email flows nếu cần.
- Chuyển dữ liệu ảnh khỏi Supabase Storage hoặc giữ nguyên storage hiện hữu trong giai đoạn chuyển tiếp; backend hiện lưu URL ảnh chứ chưa triển khai upload service.
- Bổ sung integration/e2e tests thực thi trên PostgreSQL + PostGIS thật. Hiện có unit tests cho env validation, truy vấn viewport/PostGIS và một số quy tắc truy cập/idempotency ở posts, cùng một e2e test cho health route (mock DB). Chưa có integration test chạy truy vấn trên PostgreSQL/PostGIS thật; chưa chạy được suite trong môi trường tạo mã này vì không tải được npm dependencies.
- Thêm job scheduler cho `refresh_trending_scores()` nếu cần tự động cập nhật trending.
- Thiết lập CSRF policy phù hợp với domain/cookie khi deploy frontend và API khác site.
- Hoàn thiện quy trình import dữ liệu và chạy thử trên backup staging.
