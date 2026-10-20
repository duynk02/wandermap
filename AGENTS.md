# AGENTS.md — WanderMap

> Hướng dẫn dành cho Codex và các coding agent khi làm việc trong repository WanderMap.
> **Phạm vi:** toàn bộ repository. Đọc file này trước khi phân tích hoặc chỉnh sửa mã nguồn.

## 1. Mục tiêu sản phẩm

WanderMap là mạng xã hội du lịch dựa trên bản đồ: khám phá địa điểm, xem bản đồ và các điểm check-in, đăng bài chia sẻ trải nghiệm, quản lý hồ sơ, tương tác xã hội và lưu các địa điểm muốn đến/đã đến. Giao diện chính sử dụng tiếng Việt.

Ưu tiên phát triển **trên kiến trúc đang có**, thay vì tái tạo scaffold hay làm theo kế hoạch cũ một cách máy móc.

### Nguồn sự thật (theo thứ tự ưu tiên)

1. Mã nguồn, cấu hình và SQL migrations **hiện có trong repository**.
2. `AGENTS.md` này, nhằm duy trì các quy ước khi coding.
3. `backend/README.md` và `README.md` để hiểu bối cảnh và mục tiêu ban đầu.

**Lưu ý:** README ở giai đoạn trước không phản ánh hoàn toàn cấu trúc/trạng thái trong ZIP. Nếu tài liệu và code mâu thuẫn, kiểm tra code thực tế trước, không tự động sửa code để khớp README cũ. Khi nhiệm vụ có liên quan, cập nhật tài liệu sau khi triển khai.

## 2. Cấu trúc repository thực tế

```text
wandermap/
├── AGENTS.md                         # Hướng dẫn agent (file này; đặt tại root)
├── README.md                         # Mô tả và lịch sử dự án (có phần đã cũ)
├── frontend/                         # Next.js 15 App Router + React 19
│   ├── package.json
│   ├── .env.example
│   ├── next.config.ts                 # Proxy /api/v1 tới NestJS
│   └── src/
│       ├── app/                      # Routes; có route groups (main), (social)
│       ├── components/               # auth, map, feed, post, comment, ...
│       ├── hooks/
│       ├── lib/api/                  # HTTP client và các module API
│       ├── lib/mapbox/               # Cấu hình và helpers bản đồ
│       ├── lib/validations/          # Zod schemas phía frontend
│       ├── stores/                   # Zustand stores
│       ├── constants/                # ROUTES, QUERY_KEYS, categories
│       ├── types/                    # Types của frontend/API
│       └── styles/
├── backend/                          # NestJS 11 modular monolith
│   ├── package.json
│   ├── .env.example
│   ├── docker-compose.yml            # PostgreSQL + PostGIS local
│   ├── README.md
│   ├── test/                          # Jest e2e
│   └── src/
│       ├── main.ts                   # Bootstrap, prefix, CORS, Swagger
│       ├── app.module.ts
│       ├── auth/ users/ locations/ posts/
│       ├── comments/ notifications/ itineraries/
│       ├── places/ uploads/ health/
│       ├── common/                   # Auth guards, decorators, error filter
│       ├── config/                   # Kiểm tra env
│       └── database/                 # pg pool, transactions, SQL migrations
└── .github/
```

Không có `package.json` ở repository root trong snapshot được cung cấp. **Chạy npm trong đúng thư mục `frontend/` hoặc `backend/`**. Các đường dẫn `src/...` trong README root cũ thực chất thuộc `frontend/src/...`.

## 3. Tech stack và nguyên tắc kiến trúc

| Thành phần | Công nghệ và vị trí |
| --- | --- |
| Web | Next.js 15 App Router, React 19, TypeScript; `frontend/` |
| Giao diện | Tailwind CSS 3, Framer Motion, Radix UI, Lucide, Sonner |
| State | Zustand (client state), TanStack Query (server state) |
| Form/validation | React Hook Form, Zod phía web |
| Bản đồ | Mapbox GL JS 3, `react-map-gl` 7, `supercluster` |
| Backend | NestJS 11 + TypeScript; REST `/api/v1` |
| Dữ liệu | PostgreSQL 16 + PostGIS; `pg`, **SQL viết trực tiếp**, không ORM |
| Auth | Email/password, JWT access token, rotating refresh token trong HttpOnly cookie |
| Upload | NestJS upload ảnh, Sharp chuyển WebP và loại bỏ metadata |
| Tìm kiếm địa điểm bên ngoài | Photon (dữ liệu OpenStreetMap) qua backend `places/` |
| Tests backend | Jest, unit tests và e2e giới hạn |

Đây là **hai ứng dụng riêng biệt**, không phải một ứng dụng Next.js kiêm backend chính. Không thêm Supabase client/runtime, Supabase Auth, Supabase Edge Functions hoặc ORM để thực hiện các tính năng mới trừ khi người dùng yêu cầu rõ ràng. Tài liệu nhắc đến Supabase chỉ phản ánh lịch sử chuyển đổi; snapshot hiện tại đã dùng API NestJS.

## 4. Chạy dự án ở local

Yêu cầu: **Node.js >= 20.19**, npm và Docker + Docker Compose cho PostgreSQL/PostGIS local. Cài dependency độc lập trong từng ứng dụng (ưu tiên `npm ci` khi có lockfile).

### Backend — chạy từ `backend/`

```bash
cd backend
npm ci
cp .env.example .env
# Điền JWT_ACCESS_SECRET an toàn (>=32 ký tự).
# Thêm POSTGRES_PASSWORD vào .env để Docker Compose có mật khẩu DB.
# DATABASE_URL phải dùng đúng mật khẩu đó.
docker compose up -d postgres
npm run db:migrate
npm run dev
```

Mặc định API: `http://localhost:4000/api/v1`.
Health: `http://localhost:4000/api/v1/health`.
Swagger: `http://localhost:4000/docs`.
Kiểm tra migrations: `npm run db:migrate:status` (từ `backend/`).

**Quan trọng:** `backend/docker-compose.yml` đọc `${POSTGRES_PASSWORD}`, nhưng biến này **không được khai báo trong** `backend/.env.example` của snapshot. Phải đặt biến này trong `backend/.env` hoặc môi trường shell, rồi đảm bảo `DATABASE_URL` khớp. Không đổi hoặc reset mật khẩu database đang có dữ liệu một cách tùy tiện.

### Frontend — chạy từ `frontend/`

```bash
cd frontend
npm ci
cp .env.example .env.local
# Khai báo NEXT_PUBLIC_MAPBOX_TOKEN (public pk.* token).
# Giữ NEXT_PUBLIC_API_URL=/api/v1 và API_INTERNAL_URL=http://localhost:4000/api/v1 cho local.
npm run dev
```

Web mặc định `http://localhost:3000`.

Frontend browser gọi cùng origin `/api/v1/*`, `frontend/next.config.ts` rewrite sang backend. `API_INTERNAL_URL` là biến phía server (bao gồm hậu tố `/api/v1`) dùng cho server fetch và rewrite; đổi biến này trước khi build/deploy. Backend `CORS_ORIGINS` dùng allowlist nếu truy cập API cross-origin.

**Cảnh báo script cũ:** `frontend/package.json` có các script `api:*` chạy `npm --prefix backend ...`; trong layout repo hiện tại `backend/` lại **nằm cạnh** `frontend/`, không nằm bên trong `frontend/`. Vì vậy, cho đến khi các script này được sửa đúng, hãy chạy script backend **trực tiếp tại `backend/`**, không giả định `npm run api:*` trong `frontend/` hoạt động. Root `README.md` cũng mô tả các script chạy từ root không tồn tại trong snapshot.

## 5. Đường đi của dữ liệu và quy ước frontend

```text
React / Next.js page or component
  -> frontend/src/lib/api/<domain>.ts
  -> frontend/src/lib/api/client.ts (apiFetch)
  -> /api/v1/* (Next rewrite cho browser)
  -> NestJS controller -> service -> DatabaseService -> PostgreSQL/PostGIS
```

- Tạo và cập nhật API wrapper trong `frontend/src/lib/api/`; **không rải `fetch()` trực tiếp** ở nhiều component hoặc tạo client HTTP thứ hai không cần thiết.
- `apiFetch()` xử lý base URL, JSON/FormData, auth bearer header, cookie, lỗi `ApiError`, refresh token và thử lại sau 401. Tái sử dụng nó; kiểm tra đường dẫn API thực sự có trong controllers.
- Giữ đồng bộ request/response của `frontend/src/types/`, `frontend/src/lib/validations/` và DTO/backend controller. Payload hiện có thường dùng tên `snake_case` (ví dụ `location_id`, `display_name`); không tự đổi casing của contract.
- Ưu tiên **Server Components** để tải dữ liệu public khi thích hợp; chỉ thêm `"use client"` khi cần browser APIs, hooks hay tương tác. Server-side API fetch không có access token từ bộ nhớ browser.
- Sử dụng **TanStack Query** để fetch/cache/invalidate dữ liệu server; dùng `QUERY_KEYS` trong `frontend/src/constants/index.ts`. Sau mutation, cập nhật hoặc invalidate query liên quan thay vì để UI hiển thị dữ liệu cũ.
- Sử dụng **Zustand** cho state UI dùng chung (`authStore`, `mapStore`, `followStore`), tránh lặp state vốn thuộc TanStack Query.
- Sử dụng Tailwind và các component/UI patterns đang có. Giữ giao diện tiếng Việt, responsive, hỗ trợ light/dark theme và accessible interactions.
- Dùng alias `@/*` (trỏ tới `frontend/src/*`) và TypeScript types rõ ràng; không thêm `any` chỉ để né type errors.
- Các route đang tồn tại gồm `/feed`, `/explore`, `/notifications`, `/auth/login`, `/auth/register`, `/location/[id]`, `/post/[id]`, `/post/new`, `/profile/[username]`. Root `/` redirect tới `/feed`, **không phải** trang bản đồ. Các nhóm `(main)`, `(social)` là route groups, không phải URL segments.
- `ROUTES.itinerary()` đã được khai báo, nhưng snapshot **chưa có** frontend page `app/.../itinerary/[id]`; không mô tả nó như route đã hoàn thiện.

### Bản đồ — tránh làm hỏng các bất biến hiện tại

- `MapCanvas.tsx` dùng `react-map-gl`; hook `useMap()` tại `frontend/src/hooks/useMap.ts` được gọi **một lần trong MapCanvas**. Không gọi lại hook này trong component con vì nó tạo map ref, query observer và supercluster index khác.
- Backend trả tọa độ dưới dạng `{ lat, lng }`; Mapbox / GeoJSON dùng thứ tự `[lng, lat]`; database lưu PostGIS `geometry(Point, 4326)`.
- Vùng bản đồ lấy qua `GET /locations/in-viewport` bằng bounds `west/south/east/north`; sử dụng logic `normalizeBounds()` để xử lý kinh tuyến 180° và `snapBounds()`/query cache để tránh fetch liên tục khi pan.
- Cluster ở frontend qua `supercluster`; PostGIS xử lý spatial queries ở backend. Không chuyển mọi location về client chỉ để lọc thủ công.
- Giữ `maxZoom`, expansion zoom, trending-pin fallback và query invalidation phù hợp logic hiện có; tránh làm pin nhấp nháy khi di chuyển bản đồ.

## 6. Quy ước backend và API

- Mỗi domain theo module NestJS hiện hữu: `*.module.ts`, `*.controller.ts`, `*.service.ts`, các DTO trong `dto/` khi cần.
- Controller tiếp nhận request/response và khai báo guards/validation; service chứa nghiệp vụ, truy vấn và transaction. Tái sử dụng `DatabaseService` (`backend/src/database/database.service.ts`), **không** tạo connection pool cho mỗi request.
- API global prefix đặt ở `backend/src/main.ts` là `api/v1` (không bật thêm URI versioning để thành `/api/v1/v1`). Swagger tại `/docs`.
- DTO backend dùng `class-validator`/`class-transformer`. Global ValidationPipe bật `transform`, `whitelist`, `forbidNonWhitelisted`; khi thêm query/body fields, cập nhật DTO chứ không bỏ qua validation.
- `AccessTokenGuard` bảo vệ mutation/private endpoints; `OptionalAccessTokenGuard` cho endpoint public cần tùy biến theo người xem. Kiểm tra quyền sở hữu, visibility (`public`, `followers`, `private`) và trạng thái user **ở backend**, không tin UI/client.
- Giữ response lỗi nhất quán thông qua `ApiExceptionFilter`, gồm `statusCode`, `code`, `message`, `path`, `timestamp`, `requestId`. Tránh lộ thông tin nội bộ, SQL, JWT, cookie, dữ liệu nhạy cảm trong lỗi/log.
- Sử dụng SQL parameter placeholders `$1`, `$2`, ... cho mọi giá trị do người dùng cung cấp. Với cột/bảng dynamic, chỉ dùng allowlist xác định trong code. Dùng `DatabaseService.transaction()` cho cập nhật nhiều bảng cần atomicity.
- Schema có triggers duy trì counters (`likes`, `saves`, `follows`, posts, comments), thông báo theo tương tác và các ràng buộc dữ liệu. Không cập nhật counters bằng logic frontend hoặc tự viết trùng logic trigger khi chưa kiểm tra SQL schema.
- Phần bình luận có **một cấp trả lời** (replies); giữ ràng buộc API/SQL. Thông báo được tạo bởi trigger database, backend phục vụ đọc/trạng thái đã đọc.
- Upload file đi qua `uploads/`, áp dụng xác thực, kiểm tra dung lượng/định dạng, xử lý Sharp, và trả URL công khai. Không đưa đường dẫn file server hoặc file bí mật vào response. Search Photon là external provider: xử lý timeout, rate limiting và lỗi dịch vụ phù hợp với hiện trạng.

## 7. Authentication và bảo mật — không được phá vỡ

- Email/password được xác thực qua NestJS. `JWT access token` chỉ giữ **trong memory** ở `frontend/src/lib/api/client.ts`; **không** lưu token vào `localStorage`, `sessionStorage`, Zustand persisted state hay URL.
- Refresh token nằm trong cookie **HttpOnly** do backend quản lý; backend lưu hash, rotate token. `refreshAccessToken()` có cơ chế một request chung khi nhiều request cùng 401, ngăn refresh race/reuse. Giữ cơ chế này khi sửa auth.
- `authStore` chỉ persist profile không nhạy cảm; `AuthProvider` phục hồi session qua cookie. Các thao tác yêu cầu đăng nhập nên dùng auth guard UX hiện có (`useRequireAuth`) kết hợp auth enforcement tại API.
- Các endpoints auth đang hoạt động: `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`. `GET /users/me` là endpoint hiện được frontend sử dụng để lấy hồ sơ; `GET /auth/me` **đang bị comment trong controller**, dù README cũ có nhắc tới.
- Google OAuth **chưa triển khai** trong backend snapshot; không giả định nút/flow OAuth hoạt động.
- Không hardcode secrets hoặc log thông tin đăng nhập. Giữ CORS origin allowlist, cookies phù hợp environment, Helmet, throttle và auth guards. Không sửa chính sách cookie/CORS chỉ để che lỗi triển khai mà không phân tích hệ quả.

## 8. Database và migrations

- Schema chuẩn nằm trong `backend/src/database/migrations/`: `001_initial_schema.sql` tới `005_comment_edit.sql` tại thời điểm snapshot. Có PostGIS, `unaccent`, `pg_trgm`, geometry/index, trigger, constraints và views/functions hỗ trợ truy vấn.
- Runner `backend/src/database/migrate.ts` chạy migration theo thứ tự file, dùng `schema_migrations` + SHA-256 checksum, advisory lock và transaction.
- **Không chỉnh sửa migration đã áp dụng.** Thay đổi schema bằng migration SQL mới, tên tăng số thứ tự, ví dụ `006_<ten_thay_doi>.sql`. Khi thêm cột/bảng/index: cập nhật backend query/DTO, frontend types/API wrappers khi liên quan, và tests.
- Không chạy `DROP`, `TRUNCATE`, reset volume, `docker compose down -v`, hay migration phá hủy dữ liệu nếu không có yêu cầu/đồng ý rõ ràng.
- Không chạy SQL schema Supabase cũ trong database NestJS. Không giả định dữ liệu production đã được chuyển từ Supabase chỉ vì chức năng đã có mã nguồn.
- Mọi thay đổi PostGIS phải xem xét hệ tọa độ SRID 4326, index GiST, anti-meridian, pagination và hiệu năng truy vấn.

## 9. Kiểm thử và xác minh thay đổi

Chạy từ thư mục ứng dụng tương ứng:

**Backend (`backend/`):**

```bash
npm run type-check
npm run lint
npm test -- --runInBand
npm run build
# npm run test:e2e       # Khi môi trường/phụ thuộc phù hợp
# npm run db:migrate:status  # Khi database đã chạy
```

**Frontend (`frontend/`):**

```bash
npm run type-check
npm run build
# npm run lint            # Script hiện tại dùng `next lint`; nếu toolchain không hỗ trợ, báo lỗi thực tế
```

- Không khẳng định tests/build đều pass nếu chưa chạy. Nếu chưa cài dependencies, thiếu env, network, Docker/PostGIS hay Mapbox token, ghi rõ kiểm tra nào chưa thực hiện và lý do.
- Backend có một số unit tests và e2e (health); chưa xem đó là coverage toàn bộ feature. Khi sửa nghiệp vụ, bổ sung hoặc chỉnh test sát với thay đổi. Không bỏ test đang fail bằng cách xóa/sửa assertion vô lý.
- Với thay đổi API, xác nhận **đồng thời** controller/DTO/service, frontend wrapper/type và luồng login/permissions; với thay đổi database, kiểm tra tính tương thích migration trên dữ liệu có sẵn.
- `frontend/src/app/layout.tsx` import `mapbox-gl/dist/mapbox-gl.css` và `@/styles/globals.css`; tránh chuyển CSS import phân tán. Nếu TypeScript báo thiếu type declaration cho side-effect CSS, kiểm tra cấu hình TS, cài đặt dependency và type declarations hiện có (ví dụ `frontend/src/types/css.d.ts`) trước khi áp dụng workaround.

## 10. Trạng thái tính năng — kiểm tra code, không dựa vào roadmap cũ

**Đã có implementation trong snapshot:** bản đồ/clustering, tìm kiếm và chi tiết địa điểm, feed, bài đăng, email/password auth, hồ sơ người dùng, follow/unfollow, like/save bài, bình luận/replies/comment likes, notification list/unread, visited/wishlist pins, backend itineraries, upload ảnh và tìm kiếm external places. Có implementation **không đồng nghĩa** đã được kiểm thử hoàn chỉnh hoặc production-ready.

**Chưa hoàn thiện hoặc cần xác minh:** frontend itinerary builder/page; Google OAuth; đồng bộ dữ liệu/ảnh production từ Supabase (nếu có); scheduled trending refresh; full integration/e2e testing với PostgreSQL/PostGIS thật; PWA offline, weather, heatmap và các ý tưởng roadmap khác. Kiểm tra trạng thái mới nhất trước khi kết luận một tính năng thiếu.

## 11. Cách Codex nên thực hiện yêu cầu

1. Xác định phạm vi: frontend, backend, SQL hay xuyên nhiều lớp. Đọc file hiện hữu và các module liên quan **trước** khi viết code.
2. Với tác vụ nhiều bước hoặc thay đổi lớn, trình bày ngắn gọn phương án và file dự kiến sửa; ưu tiên một thay đổi tối thiểu, dễ review.
3. Tuân theo coding style cục bộ (frontend thường double quotes, backend thường single quotes). Không format lại cả repository hay thay dependency/kiến trúc khi nhiệm vụ chỉ yêu cầu sửa tính năng nhỏ.
4. Tái sử dụng utilities, hooks, API client, DTO, guards, stores, query keys và SQL patterns hiện có. Không tạo mock data/static fallback trong production flow nếu user yêu cầu kết nối API thật.
5. Giữ backward compatibility của API và database, hoặc giải thích rõ breaking changes. Không tự động thay cấu trúc auth/storage/deploy.
6. Chạy checks sát phạm vi thay đổi; báo rõ **đã chạy**, **kết quả**, **chưa chạy**. Không âm thầm che lỗi hoặc bỏ qua lỗi types/lint.
7. Khi trả lời, dùng **tiếng Việt**; nêu ngắn gọn files đã sửa, thay đổi chính, các test đã chạy, tác động/migration/env cần thiết và rủi ro còn lại.

## 12. Điều tuyệt đối tránh

- Không làm theo các đường dẫn/shell commands root đã cũ mà không đối chiếu layout thực tế.
- Không chuyển ứng dụng quay lại Supabase hay thêm ORM nếu không có yêu cầu rõ.
- Không lưu access/refresh tokens vào storage có thể đọc từ JavaScript.
- Không tin dữ liệu client để xác định quyền truy cập hoặc quyền sở hữu.
- Không sửa migration đã chạy; không xóa dữ liệu/volume để "chữa" migration.
- Không tạo endpoint frontend Next Route Handler để thay thế NestJS REST API hiện hữu nếu không có lý do được yêu cầu.
- Không thay đổi đồng thời nhiều phần không liên quan hoặc tạo refactor lớn ngoài phạm vi.
- Không đưa bí mật trong `.env`, token, mật khẩu, dữ liệu thật vào commit, log hoặc câu trả lời.

---

**Mục tiêu của agent:** phát triển WanderMap bám sát mã nguồn hiện có, giữ nhất quán hợp đồng frontend/backend, ưu tiên bảo mật, đúng dữ liệu, hiệu năng bản đồ, khả năng kiểm thử và thay đổi nhỏ dễ bảo trì.
