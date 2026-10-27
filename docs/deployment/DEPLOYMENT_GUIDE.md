# Mốc B — Private deployment trên Vercel + Render

Đây là runbook cho lần triển khai tiếp theo; không có tài nguyên cloud nào được tạo trong Mốc A. Production khởi tạo **trống**, không import database, tài khoản hoặc media development. Hoàn tất CI và review báo cáo readiness trước khi chạy các bước này.

## 1. Điều kiện đầu vào

- Chọn commit/artifact đã review; CI phải có frontend/backend build, unit/health tests và PostGIS suites không skip.
- Node baseline **22.23.4**, ghi trong `.node-version`; Render native dùng `NODE_VERSION=22.23.4`, Dockerfile đã pin cùng patch. Vercel chọn Node 22 và kiểm tra patch thực tế trong build/runtime logs; nền tảng quản lý việc cập nhật patch.
- Có phương án giới hạn người dùng thử nghiệm cho cả frontend **và backend**. Vercel deployment protection không tự bảo vệ Render API. CORS không phải cơ chế chặn native clients hoặc thay thế authorization.
- Chuẩn bị các biến theo [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md). Không commit hoặc gửi secrets vào PR logs.

## 2. Tạo Render PostgreSQL riêng cho production

1. Khi đã được giao Mốc B, tạo database PostgreSQL 16 trong cùng region với backend, chọn gói có backup/restore đáp ứng yêu cầu đã review.
2. Xác nhận database mới trống. Không dùng connection URL development hoặc `WANDERMAP_TEST_DATABASE_URL` làm production URL.
3. Xác minh hỗ trợ/quyền enable `postgis`, `unaccent`, `pg_trgm`; enable trong schema `public` nếu cần. Migration 001/002 cũng dùng CREATE EXTENSION IF NOT EXISTS, nhưng điều đó không thay thế kiểm tra permissions.
4. Kiểm tra `SELECT version()`, `SELECT postgis_full_version()` và `pg_extension` sau bootstrap. Không giả định Render đã enable extensions tự động. [Render extensions](https://render.com/docs/postgresql-extensions).
5. Chọn connection endpoint có kiểm soát. External endpoint dùng TLS certificate do Render quản lý; internal endpoint có đặc điểm TLS/trust khác. Production luôn bật certificate verification, kể cả PGSSLMODE blank. `sslmode=require` trong URL được consume/remove trước khi pg parse để không ghi đè cấu hình `rejectUnauthorized:true`. Không dùng `no-verify`, `rejectUnauthorized:false` hoặc tắt TLS để che lỗi; nếu internal endpoint cần CA riêng, cấu hình Node trust store và xác minh CA trước, hoặc chọn endpoint verified TLS phù hợp. Pool, LISTEN và migration runner dùng chung policy. [Render connections](https://render.com/docs/postgresql-creating-connecting), [node-postgres SSL configuration](https://node-postgres.com/features/ssl).
6. Hạn chế external access phù hợp release operator. Không cho CI/PR workflows dùng database này.

## 3. Cloudinary và delivery policy

1. Chỉ ở Mốc B mới cấu hình account/product environment đã được duyệt; chuẩn bị cloud name, API key và API secret trong Render secret store.
2. Backend dùng `STORAGE_PROVIDER=cloudinary`, upload sanitized WebP dạng **authenticated**, không unsigned preset. API secret không nằm ở Vercel hoặc NEXT_PUBLIC variables.
3. Canonical URL trong DB là `https://YOUR-API.onrender.com/api/v1/media/:id`. Backend ký provider URL ở server, đọc bytes và kiểm tra quyền trước khi trả; không redirect browser tới signed URL.
4. Không mở Next Image optimizer cho authenticated provider URLs. Mọi media mới từ Post/Journey phải đi qua managed endpoint; xem [MEDIA_SECURITY.md](MEDIA_SECURITY.md).
5. Kiểm chứng trên account thật: original/derived URL không signature phải bị từ chối; canonical API URL private phải 404 với outsider/anonymous; public→private và follower revocation phải chặn request mới. Kiểm tra quota/timeouts/failure handling.

## 4. Build backend và chạy migrations một lần

Từ `backend/`, trên release worker/operator environment đã chỉ định:

```bash
npm ci --include=dev
npm run build
# Chỉ sau khi đã cấu hình NODE_ENV=production, DATABASE_URL đúng và backup/review:
npm run db:migrate:prod -- --status
npm run db:migrate:prod
npm run db:migrate:prod -- --status
```

`--status` có advisory lock và có thể tạo `schema_migrations`; không coi là lệnh tuyệt đối read-only. Migration dùng transaction theo file, không rollback cả batch nếu một file sau thất bại. Không gắn migrate vào startup của mỗi instance.

Artifact build chứa `dist/database/migrations`, xác minh theo `scripts/historical-migrations.json` từ Git baseline. Các file SQL 001–014 trong source không bị sửa; Windows CRLF chỉ được chuyển thành **bản sao artifact đã khớp hash canonical**. Database production mới ghi checksum canonical LF. Database development đã áp dụng raw CRLF tiếp tục dùng source runner `npm run db:migrate`; không sửa history để ép nó khớp release artifact. Khi nâng cấp database cũ, dừng và review mismatch thay vì reset.

Migration 015 sửa function search và backfill STORED values; có lock writers, giữ timestamps và trạng thái timestamp trigger. Migration 016 thêm managed assets/ownership triggers/indexes; không chuyển/xóa file hoặc URL cũ. Production trống không cần backfill dữ liệu development.

## 5. Deploy NestJS lên Render

- Root directory: `backend`.
- Native build: `npm ci --include=dev && npm run build`; start: `npm run start:prod`.
- Hoặc dùng Dockerfile đã chuẩn bị: Node 22.23.4, npm ci, non-root runtime, SQL assets trong dist; không cần disk để giữ production uploads.
- Một instance, một Node process; chưa autoscale/PM2 cluster/Redis.
- Health check: `/api/v1/health`. Backend đọc PORT của host, bind `0.0.0.0`.
- `NODE_ENV=production`, `SERVE_LEGACY_UPLOADS=false`, `SWAGGER_ENABLED=false`; cấu hình Cloudinary, database/JWT và public API URL trước startup.
- `CORS_ORIGINS` chứa đúng origin Vercel đã biết, không path/wildcard. Xác định các peer CIDRs thực tế trước khi bật `TRUSTED_PROXY_CIDRS`; không dùng `true`, hop counts hoặc mọi X-Forwarded-For. Kiểm tra nhiều client và spoofed headers.

Socket.IO chạy cùng HTTP server: namespace `/realtime`, HTTP path `/socket.io`. Render hỗ trợ WebSocket; vẫn phải kiểm tra WSS/reconnect thực tế. Không đổi polling theo suy đoán. [Render WebSocket](https://render.com/docs/websocket).

## 6. Deploy Next.js lên Vercel

- Root directory: `frontend`; preset Next.js; install `npm ci`; build `npm run build`.
- `NEXT_PUBLIC_API_URL=/api/v1`.
- `API_INTERNAL_URL=https://YOUR-API.onrender.com/api/v1`.
- `NEXT_PUBLIC_REALTIME_URL=https://YOUR-API.onrender.com` — không thêm namespace/path.
- `NEXT_PUBLIC_MAPBOX_TOKEN` là public `pk.*` token thật, scopes và allowed URLs đã giới hạn. Không dùng secret Mapbox token.
- Đặt biến đúng environment **trước build**. NEXT_PUBLIC values và rewrite destination cần rebuild khi thay đổi. Không dùng Render private hostname từ Vercel.
- Không dùng static export; có SSR/dynamic routes. Tách Preview deployments khỏi production data/origins.

## 7. Kiểm tra cookies, cache và realtime

Browser gửi REST tới host Vercel qua external rewrite; refresh cookie phải là host-only trên host frontend, HttpOnly/Secure/SameSite=Lax và Path=/api/v1/auth. Kiểm tra Set-Cookie được forward, cookie được gửi ở refresh, rotation và logout clear cùng host/path. Không đổi SameSite=None hoặc bỏ Secure/HttpOnly để chữa lỗi.

Socket kết nối Render bằng memory JWT; không cần refresh cookie cross-site. Kiểm tra một lifecycle, nhiều tab/devices, account switching, JWT expiry, backend restart và missed events được REST reconcile. In-memory rooms chỉ hỗ trợ một instance; shared adapter là công việc riêng khi scale.

REST/media responses không được shared-cache; kiểm tra Cache-Control/CDN-Cache-Control/Vercel-CDN-Cache-Control thực tế sau rewrite, cả 200/401/404. Media private dùng authorized Blob URLs, không cache qua optimizer. Đã tải bytes thì không thể thu hồi khỏi thiết bị; policy áp dụng với request mới.

## 8. Nghiệm thu private rollout

Chạy [SMOKE_TEST_CHECKLIST.md](SMOKE_TEST_CHECKLIST.md), ghi kết quả/commit/host. Đặc biệt kiểm tra upload gần 9–10 MiB qua external rewrite, grid/detail/lightbox/avatar/Journey/share cards, real Cloudinary unsigned rejection, Mapbox/WebGL/export/attribution và private bytes.

Không lấy giới hạn của Vercel Functions áp cho external rewrite mà chưa đo topology. Nếu phải đổi upload transport, giữ backend authorization và Sharp validation; không mở unsigned cloud upload.

Nếu lỗi, áp dụng [ROLLBACK_PLAN.md](ROLLBACK_PLAN.md); không reset/drop/truncate hoặc xoá media. Chưa mở public trước khi các release gates trong readiness report được đóng.
