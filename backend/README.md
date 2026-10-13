# WanderMap API

Backend độc lập cho WanderMap, xây dựng bằng NestJS + TypeScript + PostgreSQL/PostGIS. API được tổ chức theo domain trong một **modular monolith**; PostgreSQL được truy cập qua `pg` và SQL có tham số thay vì ORM, nhằm kiểm soát rõ các truy vấn PostGIS, trigger, constraint và migration SQL hiện có.

> **Trạng thái tích hợp:** backend được thêm vào repository nhưng frontend Next.js hiện tại vẫn còn Supabase imports/API routes. Chưa chuyển frontend sang API mới trong phạm vi này. Không xóa Supabase project cũ cho đến khi hoàn tất đồng bộ frontend và kế hoạch chuyển dữ liệu.

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

SQL migration ở `src/database/migrations/` là append-only. Runner dùng PostgreSQL advisory lock, chạy mỗi migration trong transaction và lưu SHA-256 checksum trong `schema_migrations`. Nếu file migration đã áp dụng bị sửa, runner dừng để tránh drift; hãy tạo migration mới thay vì chỉnh migration cũ.

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
