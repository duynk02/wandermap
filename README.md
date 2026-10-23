# 🗺️ WanderMap

> **Khám phá thế giới qua lăng kính của những người đã đi.**

**WanderMap** là ứng dụng mạng xã hội du lịch lấy **bản đồ và trải nghiệm tại địa điểm** làm trung tâm (*map-first travel social network*). Người dùng có thể khám phá điểm đến, chia sẻ bài đăng gắn vị trí, lưu nơi muốn đi, theo dõi người khác và xây dựng dấu ấn du lịch cá nhân.


## Mục lục

- [Tổng quan & trạng thái](#tổng-quan--trạng-thái)
- [Công nghệ sử dụng](#công-nghệ-sử-dụng)
- [Kiến trúc & cấu trúc thư mục](#kiến-trúc--cấu-trúc-thư-mục)
- [Chạy dự án trên máy local](#chạy-dự-án-trên-máy-local)
- [Các chức năng hiện có](#các-chức-năng-hiện-có)
- [API & dữ liệu](#api--dữ-liệu)
- [Roadmap phát triển](#roadmap-phát-triển)
- [Quy ước phát triển và kiểm thử](#quy-ước-phát-triển-và-kiểm-thử)
- [Triển khai & các lưu ý](#triển-khai--các-lưu-ý)

## Tổng quan & trạng thái

WanderMap phát triển quanh ba trải nghiệm:

1. **Explore:** khám phá địa điểm bằng bản đồ, marker, clustering, tìm kiếm và bộ lọc.
2. **Social:** chia sẻ bài đăng/ảnh gắn địa điểm; feed, follow, like, save và bình luận.
3. **Travel identity:** trang cá nhân, các địa điểm đã ghé thăm hoặc muốn đến, hành trình du lịch.

**Kiến trúc hiện tại:** `frontend/` (Next.js) giao tiếp với `backend/` (NestJS REST API); backend sử dụng PostgreSQL + PostGIS.

**Tiến độ hiện tại:** Phase 1 đã được xác nhận hoàn tất; Phase 2 đã có My Travel Map/Journey Builder MVP và xuất ảnh PNG. Phần tiếp theo là chia sẻ Journey lên Feed, sau đó tới realtime notifications và nhắn tin. Xem hướng dẫn Phase 2 bên dưới.

## Công nghệ sử dụng

| Lớp | Công nghệ / cách sử dụng |
|---|---|
| Frontend | Next.js 15 (App Router), React 19, TypeScript |
| UI | Tailwind CSS 3, Radix UI, Framer Motion, Lucide, Sonner |
| Frontend state/data | Zustand, TanStack Query, React Hook Form, Zod |
| Bản đồ | Mapbox GL JS, `react-map-gl`, `supercluster` |
| Backend | NestJS 11, TypeScript, REST API `/api/v1` |
| Database | PostgreSQL 16 + PostGIS (`postgis/postgis:16-3.5` trong Docker Compose) |
| Truy cập database | `pg`, parameterized SQL, SQL migrations (không sử dụng ORM) |
| Authentication | Email/password, JWT access token, rotating refresh token qua HttpOnly cookie |
| Upload ảnh | API NestJS; xử lý bằng `sharp`, lưu trên ổ đĩa backend trong bản hiện tại |
| API documentation | Swagger UI |

> Các phiên bản trên căn cứ `package.json` và Docker Compose

## Kiến trúc & cấu trúc thư mục

```text
wandermap/
├── AGENTS.md                      # Hướng dẫn cho Codex / coding agent (đặt tại root)
├── README.md                      # Tài liệu tổng quan này
├── frontend/
│   ├── .env.example
│   ├── package.json
│   ├── next.config.ts             # Rewrite /api/v1/* sang backend
│   ├── public/
│   └── src/
│       ├── app/
│       │   ├── auth/              # Login, Register
│       │   └── (main)/
│       │       ├── (social)/feed/ # Feed
│       │       ├── (social)/notifications/
│       │       ├── explore/       # Bản đồ khám phá
│       │       ├── location/[id]/
│       │       ├── post/[id]/
│       │       ├── post/new/
│       │       └── profile/[username]/
│       ├── components/
│       │   ├── auth/              # Form xác thực
│       │   ├── feed/              # FeedList, FeedPostCard
│       │   ├── post/              # PostCard, PostGrid, upload ảnh, tạo bài
│       │   ├── comment/           # Bình luận và phản hồi
│       │   ├── notification/      # Chuông và danh sách thông báo
│       │   ├── map/               # MapCanvas, clusters, controls
│       │   ├── profile/           # Header, stats, travel map
│       │   ├── layout/            # Providers, MainHeader
│       │   └── ui/
│       ├── lib/api/               # REST API client theo domain
│       ├── lib/mapbox/
│       ├── hooks/
│       ├── stores/
│       ├── types/
│       └── styles/globals.css
└── backend/
    ├── .env.example
    ├── package.json
    ├── docker-compose.yml
    ├── README.md                  # Tài liệu backend (có mục cũ cần đối chiếu code)
    └── src/
        ├── main.ts
        ├── app.module.ts
        ├── auth/
        ├── users/
        ├── locations/
        ├── posts/
        ├── comments/
        ├── notifications/
        ├── itineraries/
        ├── places/
        ├── uploads/
        ├── health/
        ├── common/
        ├── config/
        └── database/
            ├── migrate.ts
            └── migrations/        # 001–005 trong bản ZIP
```

Luồng dữ liệu thông thường:

```text
Browser (Next.js :3000)
       │
       ├── /api/v1/* (same-origin rewrite qua next.config.ts)
       ▼
NestJS REST API (:4000)
       ├── Domain services ──► PostgreSQL/PostGIS (:5432)
       └── UploadsService ──► Ổ đĩa backend (/uploads)
```

Frontend gọi API qua `frontend/src/lib/api/client.ts`, hỗ trợ xử lý access token và refresh token. `API_INTERNAL_URL` được sử dụng cho các request phía server và mục tiêu rewrite; đây **không phải** biến public.

## Chạy dự án trên máy local

### 1. Yêu cầu

- **Node.js >= 20.19**, khuyến nghị Node.js 22 LTS.
- npm.
- Docker Desktop/Engine và Docker Compose để chạy PostgreSQL + PostGIS (hoặc tự cấu hình PostgreSQL/PostGIS tương thích).
- Mapbox public access token (`pk...`).

### 2. Khởi tạo backend và database

Tại `backend/`:

```bash
cd backend
npm install
```

Tạo file `backend/.env` từ `backend/.env.example` (copy thủ công nếu đang sử dụng Windows PowerShell). **Tạo và điền mật khẩu PostgreSQL local** trong `.env` cùng với connection string tương ứng:

```dotenv
POSTGRES_PASSWORD=<your-local-db-password>
DATABASE_URL=postgresql://wandermap:<your-local-db-password>@localhost:5432/wandermap
JWT_ACCESS_SECRET=<random-secret-at-least-32-characters>
CORS_ORIGINS=http://localhost:3000
```

Các biến khác có thể tham khảo trong `backend/.env.example`. Lệnh tạo secret:

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

> `POSTGRES_PASSWORD` được Docker Compose đọc từ môi trường/`backend/.env`, còn `DATABASE_URL` được NestJS sử dụng. Nếu mật khẩu chứa ký tự đặc biệt, phải URL-encode phần password trong `DATABASE_URL`. Với volume PostgreSQL đã khởi tạo trước đó, đổi `POSTGRES_PASSWORD` trong `.env` **không tự thay đổi** mật khẩu của role trong database đang tồn tại.

Chạy database, migrations và backend:

```bash
docker compose up -d postgres
npm run db:migrate
npm run dev
```

Kiểm tra trạng thái migration:

```bash
npm run db:migrate:status
```

Kết quả dự kiến:

| Dịch vụ | Địa chỉ |
|---|---|
| API | `http://localhost:4000/api/v1` |
| Health check | `http://localhost:4000/api/v1/health` |
| Swagger | `http://localhost:4000/docs` |
| PostgreSQL | `localhost:5432` |

### 3. Khởi tạo frontend

Mở terminal khác, tại `frontend/`:

```bash
cd frontend
npm install
```

Tạo `frontend/.env.local` từ `frontend/.env.example`, điền ít nhất:

```dotenv
NEXT_PUBLIC_API_URL=/api/v1
API_INTERNAL_URL=http://localhost:4000/api/v1
NEXT_PUBLIC_MAPBOX_TOKEN=pk.your-mapbox-public-token
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_APP_NAME=WanderMap
```

Chạy frontend:

```bash
npm run dev
```

Mở **http://localhost:3000**. Nếu thay `API_INTERNAL_URL`, restart hoặc rebuild Next.js vì rewrite được cấu hình theo biến môi trường khi Next.js tạo cấu hình ứng dụng.

### 4. Sự cố thường gặp

| Triệu chứng | Kiểm tra |
|---|---|
| `password authentication failed` | `POSTGRES_PASSWORD`, `DATABASE_URL`, mật khẩu role thực tế, xung đột port 5432 / volume cũ |
| `CORS origin is not allowed` | `CORS_ORIGINS`, frontend origin và việc gọi trực tiếp API thay vì qua rewrite |
| Request `/api/v1/*` thất bại | Backend :4000 đang chạy? `API_INTERNAL_URL` và Next.js rewrite có đúng? |
| Bản đồ không tải | `NEXT_PUBLIC_MAPBOX_TOKEN`, kết nối mạng và Mapbox configuration |
| Ảnh upload không hiển thị | Cấu hình `UPLOAD_DIR`, `UPLOAD_PUBLIC_URL`, thư mục lưu ảnh và đường dẫn truy cập |
| TypeScript báo lỗi CSS import | Kiểm tra đường dẫn CSS và khai báo type `frontend/src/types/css.d.ts` trước khi thêm workaround |

## Các chức năng hiện có

| Nhóm | Đã có trong mã nguồn | Cần hoàn thiện / lưu ý |
|---|---|---|
| Xác thực | Register, login, refresh, logout, `/auth/me` | Google OAuth backend chưa có; kiểm tra flows triển khai thực tế |
| Bản đồ & địa điểm | Mapbox map, marker/clustering, viewport, trending, location detail, tìm địa điểm qua Photon | Kiểm tra độ chính xác dữ liệu, tối ưu tìm kiếm và giao diện |
| Bài đăng | Tạo/xem/sửa/xóa bài, ảnh, rating, gắn location, feed công khai/following | Image Lightbox chưa thấy trong ZIP |
| Tương tác xã hội | Follow/unfollow, like/unlike, save/unsave, bình luận và replies | Tiếp tục hoàn thiện UX và các edge cases |
| Profile | Trang hồ sơ, chỉ số, bản đồ cá nhân; `PATCH /users/me` hỗ trợ tên, avatar URL và bio | Form chỉnh sửa đầy đủ, cover, username, website còn là kế hoạch |
| Travel map & Journey | Visited/wishlist, lịch sử ghé thăm; bản đồ Profile/bộ lọc/thống kê; Journey Builder nháp/công khai; xuất poster PNG 1:1 và 4:5 | Journey Post và Travel Passport chưa có |
| Itineraries | Backend có API itinerary và itinerary stops | Không đồng nghĩa đã có trình dựng hành trình drag-and-drop trên frontend |
| Notifications | Socket.IO sau commit; REST danh sách/unread/đánh dấu nhóm hoặc tất cả; chuông và danh sách đồng bộ nhiều tab | REST là nguồn dữ liệu chuẩn; fallback polling khi realtime không sẵn sàng, chưa có replay bền vững |
| Upload ảnh | API `POST /uploads/images` và xử lý ảnh WebP | Lưu local disk; cần kế hoạch storage bền vững khi deploy nhiều instance |

### Trang / luồng chính

- `/feed` — Bảng tin.
- `/explore` — Bản đồ khám phá.
- `/post/new` — Tạo bài đăng.
- `/post/[id]` — Xem chi tiết bài đăng.
- `/location/[id]` — Chi tiết địa điểm.
- `/profile/[username]` — Hồ sơ người dùng.
- `/notifications` — Danh sách thông báo.
- `/auth/login`, `/auth/register` — Xác thực email/password.

Route groups `(main)` và `(social)` trong mã nguồn Next.js không phải segment URL.

## API & dữ liệu

### REST API

Backend định nghĩa global prefix **`/api/v1`**; xem toàn bộ contract, DTO và khả năng thử endpoint tại [`/docs`](http://localhost:4000/docs) khi backend chạy.

| Domain | Endpoint tiêu biểu |
|---|---|
| Auth | `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`; `GET /auth/me` |
| Users | `GET/PATCH /users/me`, `GET /users/:username`, `POST/DELETE /users/:username/follow` |
| Pins | `GET /users/me/pins`, `PUT/DELETE /users/me/pins/:locationId` |
| Locations | `GET /locations`, `/locations/in-viewport`, `/locations/trending`, `/locations/:id` |
| Places | `GET /places/search` |
| Posts | `GET /posts/feed`, `/posts/following`, `/posts/:id`; `POST/PATCH/DELETE /posts` theo quyền |
| Engagement | `POST/DELETE /posts/:id/like`, `/posts/:id/save` |
| Comments | `GET/POST /posts/:postId/comments`, replies và thao tác sửa/xóa/like bình luận |
| Notifications | `GET /notifications`, `/notifications/unread-count`; `POST /notifications/read`, `/notifications/read-all` |
| Itineraries | `GET/POST /itineraries`, quản lý `/itineraries/:id/stops` |
| Uploads | `POST /uploads/images` |

Các path trong bảng là đường dẫn **sau** `/api/v1`.

### Database & migrations

Migrations chính nằm tại `backend/src/database/migrations/`:

```text
001_initial_schema.sql
002_accent_insensitive_search.sql
003_comments.sql
004_notifications.sql
005_comment_edit.sql
006_profile_editing.sql
007_travel_map_journeys.sql
008_visited_locations_cutover.sql
009_journey_posts.sql
010_notifications_realtime.sql
011_comment_request_id.sql
```

Phase 2 Step 3 đã mở rộng tab bản đồ Profile với danh sách, bộ lọc, thống kê và
Journey Builder: chọn/sắp xếp điểm, preview Mapbox, lưu nháp/công khai, sửa/xóa theo quyền.
Xem [hướng dẫn My Travel Map & Journey](docs/phase-2-step-3.md) và
[xuất ảnh Journey PNG](docs/phase-2-step-5.md). Journey Post/Feed là bước tiếp theo sau export.

Phase 2 Step 1 bổ sung schema đã đến/Journey. Step 2 thêm API và giao diện đánh dấu
ở trang/panel địa điểm, quản lý ngày ghé thăm và quyền riêng tư. Migration 008 chuyển
pins visited cũ thành đánh dấu private, không gán ngày giả; cần deploy cùng backend
Step 2 và dừng writer pins cũ trong lúc cutover. Xem [hướng dẫn API/UI, migration và tests](docs/phase-2-step-2.md)
và [thiết kế kiến trúc](docs/phase-2-architecture.md).

Các domain dữ liệu cốt lõi: `users`, `profiles`, `locations` (tọa độ PostGIS), `posts`, `itineraries`, `itinerary_stops`, `follows`, `likes`, `saves`, cùng những cấu trúc bổ sung trong các migration sau.

**Quy tắc database:** không chỉnh sửa migration đã áp dụng trên môi trường dùng chung; tạo migration mới, kiểm tra khả năng migrate trên database thử nghiệm và backup trước thao tác trên dữ liệu quan trọng.

### Quy tắc bảo mật quan trọng

- Không commit `.env`, `.env.local`, API keys riêng, JWT secret hoặc dữ liệu cá nhân.
- Refresh token lưu trong **HttpOnly cookie**; access token dùng cho request được bảo vệ.
- Endpoint sửa/xóa dữ liệu cần xác thực và kiểm tra quyền sở hữu tại backend.
- Không tin user ID từ client để xác định quyền chỉnh sửa hoặc room thông báo khi bổ sung WebSocket.
- Không hiển thị vị trí hiện tại hoặc lịch sử du lịch của người dùng công khai nếu chưa có lựa chọn quyền riêng tư phù hợp.

## Roadmap phát triển

Roadmap là **kế hoạch**, không phải các tính năng được xác nhận đã triển khai. Thứ tự có thể thay đổi theo tiến độ và phản hồi người dùng.

### Phase 1 — Profile Editing & Feed UX (đã xác nhận hoàn tất)

- [x] **Profile Editing:** cập nhật avatar, cover, display name, username, bio và các trường tùy chọn.
- [x] **Image Lightbox:** xem ảnh Feed toàn màn hình, điều hướng ảnh và giữ trạng thái Feed.
- [x] **Feed polish:** loading, scroll và các trạng thái Feed.

### Phase 2 — Travel Footprint & Journey Flex

- [x] **My Travel Footprint:** bản đồ, danh sách, thống kê và bộ lọc năm/quốc gia/tìm kiếm, có phân quyền trên Profile.
- [x] **Journey Flex MVP:** chọn/sắp xếp điểm đã đến, nối trên Mapbox, tùy chỉnh, preview và lưu nháp/công khai. Export và bài Feed được theo dõi riêng bên dưới.
- [ ] **Journey Post:** chia sẻ bản đồ hành trình như một loại nội dung trên Feed.
- [x] **Xuất ảnh hành trình:** poster PNG 1:1/4:5, preview và tải về; [chi tiết](docs/phase-2-step-5.md).
- [ ] Animated recap/video để giai đoạn mở rộng.

> Đường kết nối điểm đến chỉ là hình biểu diễn thứ tự ghé thăm, **không phải** tuyến đường GPS thực tế nếu không có dữ liệu hành trình.

### Phase 3 — Realtime Notifications

- [x] Gateway Socket.IO và JWT, room riêng theo user, lifecycle auth; [Phase 3 Step 1](docs/phase-3-step-1.md).
- [x] Gửi thay đổi thông báo sau commit đến đúng người dùng, cập nhật unread badge qua REST; [Feature 2](docs/phase-3-step-2.md).
- [ ] Reconnect, đồng bộ lại qua REST API để không bỏ sót sự kiện.
- [ ] Đánh giá Redis adapter nếu backend chạy nhiều instance.

### Phase 4 — Messaging & Social Connections

- [ ] Messaging 1–1, danh sách conversations, lịch sử tin nhắn và read receipts.
- [ ] Chia sẻ bài đăng, địa điểm hoặc hành trình vào cuộc trò chuyện.
- [ ] Bổ sung chặn/báo cáo người dùng và cơ chế chống spam.
- [ ] Nhóm trò chuyện, typing/presence là mở rộng sau MVP.

### Phase 5 — Discovery & Travel Identity

- [ ] Travel Passport: bản đồ tô màu tỉnh/thành/quốc gia đã đến.
- [ ] Bucket List: danh sách địa điểm muốn khám phá.
- [ ] Travel Wrapped: tổng kết hành trình theo năm.
- [ ] Itinerary Builder trực quan; cải thiện tìm kiếm/gợi ý địa điểm.
- [ ] Cân nhắc PWA/offline và tích hợp thời tiết sau khi core trải nghiệm ổn định.

## Quy ước phát triển và kiểm thử

### Hướng dẫn cho AI coding agent

Đọc **[`AGENTS.md`](AGENTS.md)** trước khi dùng Codex/AI agent để sửa dự án. Tài liệu này mô tả nguyên tắc kỹ thuật, phạm vi thay đổi và cách phối hợp frontend/backend. Nếu file chưa có trong bản clone, bổ sung từ tài liệu đã tạo cho dự án.

### Lệnh phát triển

**Frontend** (`cd frontend`):

```bash
npm run dev
npm run type-check
npm run build
```

**Backend** (`cd backend`):

```bash
npm run dev
npm run type-check
npm run lint
npm test
npm run test:e2e
npm run build
npm run db:migrate:status
```

> `frontend/package.json` trong ZIP khai báo `lint` là `next lint`, có thể không tương thích với phiên bản Next.js đang cài. Kiểm tra script và chạy ESLint trực tiếp hoặc cập nhật script trước khi dùng trong CI. Các script `api:*` ở `frontend/package.json` trỏ đến `backend/` tương đối với **frontend/**, nên không được xem là lệnh root/backend hợp lệ nếu chưa sửa.

### Checklist trước khi merge

- TypeScript/build không phát sinh lỗi mới.
- Backend endpoint và frontend client thống nhất response/validation.
- Test các trạng thái loading, empty, error, unauthorized và responsive.
- Migration mới có thể áp dụng an toàn, không phá hủy dữ liệu.
- Không commit secret, upload ảnh thực hoặc các file local không cần thiết.
- Cập nhật README/AGENTS khi thay đổi kiến trúc hoặc contract lớn.

## Triển khai & các lưu ý

Hiện có `backend/Dockerfile` và `backend/docker-compose.yml` phục vụ backend/database. Frontend có thể được deploy lên nền tảng hỗ trợ Next.js như Vercel, còn NestJS/PostgreSQL cần môi trường triển khai độc lập phù hợp. **Chưa có bằng chứng trong ZIP để khẳng định pipeline deploy production đã hoàn thiện**.

Trước khi triển khai production:

1. Cấu hình `API_INTERNAL_URL` cho Next.js **trước khi build**; kiểm tra rewrite và cookie domain/site.
2. Cấu hình HTTPS, CORS, secrets và chính sách cookie chính xác.
3. Chuyển hoặc cấu hình persist storage cho ảnh upload; local disk của container có thể mất khi redeploy.
4. Quản lý backup database, kiểm thử migration trên staging và theo dõi health/logs.
5. Kiểm tra điều kiện sử dụng các dịch vụ bản đồ/tìm kiếm bên thứ ba; không mặc định dùng public Photon instance cho lưu lượng production lớn.
6. Cấu hình kiểm thử tự động và pipeline deploy đúng với scripts/paths thực tế của `frontend/` và `backend/`.

---

**WanderMap** — *Explore places. Share moments. Map your journey.*

*Tài liệu được cập nhật theo bản mã nguồn và kế hoạch phát triển được cung cấp tại thời điểm biên soạn.*
