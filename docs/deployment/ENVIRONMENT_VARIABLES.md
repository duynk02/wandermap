# Environment variables

Mốc A không truy cập production credentials. Development dùng `frontend/.env.local` và `backend/.env`; production đặt biến tại host. Không đặt secrets trong NEXT_PUBLIC, repo, URL hoặc CI PR workflows. Optional values để blank sẽ nhận default; required values vẫn fail fast.

## Frontend — Vercel

| Biến | Development | Production | Bắt buộc / secret |
| --- | --- | --- | --- |
| NEXT_PUBLIC_API_URL | `/api/v1` | `/api/v1` | Có cho strategy; public. Production từ chối absolute cross-site base. |
| API_INTERNAL_URL | `http://localhost:4000/api/v1` | `https://YOUR-API.onrender.com/api/v1` | Có; server-only config, không chứa credentials. SSR + rewrite destination. |
| NEXT_PUBLIC_REALTIME_URL | `http://localhost:4000` | `https://YOUR-API.onrender.com` | Có; public origin, code thêm `/realtime`, path `/socket.io`. |
| NEXT_PUBLIC_MAPBOX_TOKEN | Public `pk.*` token | Public token thật, restricted URLs/scopes | Có cho map; không dùng secret `sk.*`. Syntactic validation không chứng minh provider access. |
| NEXT_TELEMETRY_DISABLED | Tuỳ chọn `1` | Tuỳ chọn `1` | Không secret; CI đặt 1. |

URL production phải HTTPS, không localhost/credentials/query/fragment. NEXT_PUBLIC values và rewrite được resolve khi build. CI chỉ dùng build fixtures ở example.test và token fixture, không gọi provider; đó không phải Mapbox/cloud verification.

## Backend — Render

| Biến | Default development | Production / nơi cấu hình | Bắt buộc / secret |
| --- | --- | --- | --- |
| NODE_ENV | development | production | Có; Render env. Test mode không đọc `.env`. |
| NODE_VERSION | `.node-version`: 22.23.4 | 22.23.4 cho Render native; Dockerfile pin cùng patch | Runtime config, không secret. Vercel chọn Node 22 rồi xác minh managed patch. |
| PORT | 4000 | Do Render cấp | Không cần override; bind 0.0.0.0. |
| DATABASE_URL | Local PostgreSQL/PostGIS | Managed production URL đúng endpoint | Required secret; không dùng test/development database. |
| PGSSLMODE | Blank cho local | Blank/require/verify-full đều bắt buộc verified TLS | Production luôn xác minh certificate. Không no-verify/disable hoặc URL SSL overrides. Trust CA qua Node trust store nếu endpoint yêu cầu. |
| DB_POOL_MAX | 10 | Theo budget DB | Optional; tính thêm 1 LISTEN connection và release/admin connections. |
| JWT_ACCESS_SECRET | Tự tạo >=32 ký tự | Random secret trong Render secret store | Required secret; không có JWT_REFRESH_SECRET trong kiến trúc hiện tại. |
| ACCESS_TOKEN_TTL_SECONDS | 900 | 900 hoặc giá trị 60–86400 đã review | Optional; token memory-only. |
| REFRESH_TOKEN_DAYS | 30 | 1–180 | Optional; refresh random token lưu hash, rotating cookie. |
| CORS_ORIGINS | http://localhost:3000 | Danh sách exact HTTPS origins, phân cách dấu phẩy | Required production; không wildcard preview domains/path. |
| COOKIE_SECURE | false | true; production từ chối false | Optional; bắt buộc HTTPS production. |
| COOKIE_SAME_SITE | lax | lax cho REST qua rewrite | Optional; none chỉ khi đã thiết kế cross-site/CSRF riêng. |
| TRUSTED_PROXY_CIDRS | Blank: trust none | Explicit peer IPv4/IPv6 CIDRs sau xác minh topology | Optional/config; không boolean, hop count hoặc universal /0. Cloud forwarding chưa được xác minh ở Mốc A. |
| STORAGE_PROVIDER | local | cloudinary | Required theo policy; production từ chối local. |
| PUBLIC_API_URL | http://localhost:4000/api/v1 | https://YOUR-API.onrender.com/api/v1 | Required production; canonical managed URLs, không provider delivery URL. |
| CLOUDINARY_CLOUD_NAME | Blank | Cloud name của app | Required khi cloudinary; server-only identifier. |
| CLOUDINARY_API_KEY | Blank | Render secret store | Required khi cloudinary; identifier cần quản lý, không publish cùng secret. |
| CLOUDINARY_API_SECRET | Blank | Render secret store | Required secret; không Vercel/NEXT_PUBLIC. |
| UPLOAD_DIR | ./uploads | Không cần persistent filesystem khi cloudinary | Local provider ghi vào `.private`; không publish folder này. |
| SERVE_LEGACY_UPLOADS | true | false | Production từ chối true. Legacy URLs development vẫn public, không được tự migrate. |
| UPLOAD_PUBLIC_URL | Legacy config | Không dùng cho managed upload mới | Giữ tương thích env cũ; không tự sửa URL trong DB. |
| PHOTON_URL | https://photon.komoot.io | HTTPS provider được duyệt | Optional; public instance fair-use, không có SLA được xác minh. |
| PLACES_USER_AGENT | WanderMap/1.0 (place search) | UA/contact phù hợp provider | Optional, không secret. |
| LOG_LEVEL | log,warn,error,debug | log,warn,error | Optional, danh sách Nest levels hợp lệ. Không log raw SQL/provider errors/private message content. |
| SWAGGER_ENABLED | true | false mặc định | Optional bool. Nếu operator bật production, phải đánh giá audience; persistAuthorization luôn false. |

`POSTGRES_PASSWORD`, `POSTGRES_PORT` chỉ cho Docker Compose development; user `wandermap` và password URL-encoded trong DATABASE_URL phải khớp. Không reset volume để thay password.

## Tests và CI

- `WANDERMAP_TEST_DATABASE_URL`: explicit isolated database có tên chứa segment `test`; không fallback DATABASE_URL. `npm run test:db:ci` từ chối missing config hoặc skipped suites/tests.
- `npm run test:startup` chỉ dùng database test đã migrate, test credentials mới sinh và local storage; không gọi Cloudinary. Linux verification kiểm tra compiled server, real DB health, authenticated socket và SIGTERM.
- `npm run test:transport` kiểm tra cấu hình thực tế của pg Client, không mở network: URL sslmode không thể ghi đè certificate verification; production luôn bật verified TLS.
- Browser suites dùng `WANDERMAP_TEST_WEB_URL`, `WANDERMAP_TEST_API_URL`, `WANDERMAP_BROWSER_PATH` theo từng script. `tests/media-security.browser.mjs` còn yêu cầu `WANDERMAP_BROWSER_ALLOW_MUTATIONS=isolated-test`, chỉ nhận localhost/127.0.0.1; script tạo fixture users/posts/uploads. Chỉ chạy với DB test riêng, đã migrate; một số suite cũ yêu cầu DB mới trống.
- CI dùng PostGIS service và fixtures công khai; không lấy secrets production hoặc URL cloud app thật.
