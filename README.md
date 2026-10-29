# 🗺️ WanderMap

> **Khám phá thế giới qua lăng kính của những người đã đi.**

WanderMap là mạng xã hội du lịch dựa trên bản đồ: khám phá địa điểm, chia sẻ trải nghiệm, lưu dấu những nơi đã đến và kết nối với những người cùng sở thích.

## Mục lục

- [Chức năng và ảnh demo](#chức-năng-và-ảnh-demo)
- [Công nghệ và cấu trúc](#công-nghệ-và-cấu-trúc)
- [Chạy dự án local](#chạy-dự-án-local)
- [Kiểm thử và tài liệu kỹ thuật](#kiểm-thử-và-tài-liệu-kỹ-thuật)

## Chức năng và ảnh demo

Các mục dưới đây mô tả chức năng đã có trong mã nguồn. Ảnh demo sẽ được bổ sung từ giao diện thực tế.


### 1. Khám phá bản đồ

Tìm kiếm điểm đến, xem các cụm địa điểm và chọn địa điểm ngay trên bản đồ tại `/explore`.

> **Ảnh demo:** toàn cảnh bản đồ, ô tìm kiếm và các điểm đánh dấu.

Tìm kiếm
![image](https://files.catbox.moe/2d2evo.png)
Chức năng liên quan đến địa điểm: Viết bài, đánh dấu đã đi qua
![image](https://files.catbox.moe/oaiifb.png)
Những bài viết liên quan đến địa điểm (nếu có)
![image](https://files.catbox.moe/5oxq5t.png)

### 2. Chi tiết địa điểm

Xem thông tin, ảnh và bài viết tại `/location/[id]`. Lưu nơi muốn đến hoặc đánh dấu đã đến; với nơi đã đến, có thể quản lý ngày ghé thăm và quyền riêng tư.

> **Ảnh demo:** trang chi tiết địa điểm và thao tác đánh dấu đã đến/muốn đến.

Trang chi tiết địa điểm hiển thị những bài đăng liên quan đến địa điểm đó.
![image](https://files.catbox.moe/eb1ri2.png)
Chức năng đánh dấu địa điểm đã đến, có tiện ích tự điền thông tin từ bài đăng của bạn.
![image](https://files.catbox.moe/n8kssl.png)

### 3. Bảng tin và bài đăng

Khám phá bài viết trên `/feed` hoặc xem nội dung từ người đang theo dõi. Tạo bài tại `/post/new` với ảnh, địa điểm và đánh giá; xem chi tiết tại `/post/[id]` và mở ảnh toàn màn hình.

> **Ảnh demo:** bảng tin và biểu mẫu tạo bài có ảnh, địa điểm, đánh giá.

Tại trang bảng tin có thể nhìn thấy các bài đăng từ mọi người, người dùng có thể tương tác, bình luận,...
![image](https://files.catbox.moe/07k1b3.png)
Người dùng có thể đăng bài viết bằng tùy chọn đăng bài ở trang khám phá hoặc chức năng đăng bài.
![image](https://files.catbox.moe/wnwep2.png)


### 4. Hồ sơ và kết nối

Trang `/profile/[username]` hiển thị bài viết, thống kê và dấu ấn du lịch. Người dùng có thể sửa avatar, tên hiển thị, username, giới thiệu, thành phố; theo dõi người khác và xem danh sách người theo dõi/đang theo dõi.

> **Ảnh demo:** trang hồ sơ và hộp thoại chỉnh sửa thông tin.

Trang hồ sơ người dùng hiển thị danh sách bài viết, thống kê
![image](https://files.catbox.moe/i5e05l.png)

Các chức năng liên quan đến tài khoản
![image](https://files.catbox.moe/8jonxx.png)
![image](https://files.catbox.moe/vk2tf1.png)

Danh sách các liên hệ
![image](https://files.catbox.moe/smd191.png)

### 5. Bản đồ du lịch cá nhân

Xem các địa điểm đã ghé thăm trên bản đồ và danh sách trong hồ sơ, kèm thống kê, tìm kiếm và bộ lọc theo năm/quốc gia. Nội dung hiển thị theo quyền riêng tư đã chọn.

> **Ảnh demo:** tab bản đồ cá nhân với thống kê và bộ lọc đang sử dụng.
Bản đồ du lịch cá nhân
![image](https://files.catbox.moe/dm36i8.png)

### 6. Hành trình Journey

Chọn và sắp xếp các điểm đã đến, xem trước trên bản đồ, lưu nháp hoặc công khai hành trình. Xem chi tiết tại `/journey/[id]`; chủ hành trình có thể xuất poster PNG và chia sẻ lên bảng tin. Hành trình cũng có thể được gửi qua tin nhắn.

Đường nối giữa các điểm biểu diễn thứ tự ghé thăm, không thể hiện tuyến đường GPS thực tế.

> **Ảnh demo:** trình dựng hành trình và poster PNG sau khi xuất.

Tạo hành trình từ những nơi đã đi qua
![image](https://files.catbox.moe/6hkw62.png)
Xuất ảnh hành trình
![image](https://files.catbox.moe/ae2nbw.png)
Chia sẻ qua tin nhắn với bạn bè
![image](https://files.catbox.moe/ujufd6.png)
Chia sẻ lên bảng tin
![image](https://files.catbox.moe/p55sc8.png)

### 7. Tin nhắn

Trò chuyện riêng tại `/messages` khi hai người theo dõi lẫn nhau. Xem danh bạ bạn bè/người theo dõi, trạng thái đã đọc và chia sẻ bài viết, địa điểm hoặc hành trình trong cuộc trò chuyện.

> **Ảnh demo:** danh sách hội thoại và đoạn chat có thẻ nội dung được chia sẻ.

Trò chuyện với bạn bè
![image](https://files.catbox.moe/svp5hh.png)

### 8. Thông báo

Nhận cập nhật về lượt theo dõi, lượt thích, bình luận và phản hồi. Xem danh sách tại `/notifications`, nhận biết nội dung chưa đọc và đánh dấu đã đọc.

> **Ảnh demo:** danh sách thông báo có cả trạng thái đã đọc và chưa đọc.

Xem thông báo về các hoạt động
![image](https://files.catbox.moe/klx438.png)

### 09. Đăng ký và đăng nhập

Tạo tài khoản bằng email/mật khẩu tại `/auth/register` và đăng nhập tại `/auth/login` để đăng bài, tương tác, quản lý bản đồ cá nhân và nhắn tin.

> **Ảnh demo:** giao diện đăng ký hoặc đăng nhập.

Giao diện đăng ký và đăng nhập
![image](https://files.catbox.moe/c8htx6.png)
![image](https://files.catbox.moe/f2oca9.png)

## Công nghệ và cấu trúc

| Thành phần | Công nghệ chính |
| --- | --- |
| Frontend | Next.js 15, React 19, TypeScript, Tailwind CSS |
| State và dữ liệu | Zustand, TanStack Query, React Hook Form, Zod |
| Bản đồ | Mapbox GL JS, react-map-gl, supercluster |
| Backend | NestJS 11, REST API, Socket.IO |
| Database | PostgreSQL 16 + PostGIS, SQL trực tiếp qua `pg` |
| Xác thực | JWT access token trong memory, refresh token qua HttpOnly cookie |
| Ảnh | Sharp/WebP; lưu local khi phát triển, Cloudinary authenticated khi triển khai |

```text
wandermap/
├── frontend/   # Next.js: giao diện, bản đồ, API client
├── backend/    # NestJS: API, realtime, SQL migrations
├── docs/       # Tài liệu tính năng và triển khai
└── AGENTS.md   # Quy ước dành cho coding agent
```

Frontend gọi `/api/v1` qua Next.js rewrite tới backend. Mỗi ứng dụng có `package.json` riêng; chạy npm trong `frontend/` hoặc `backend/`.

## Chạy dự án local

**Yêu cầu:** Node.js 22.23.4 (xem [`.node-version`](.node-version)), npm, Docker Compose và Mapbox public token (`pk...`).

### Backend

Từ root, cài dependencies và tạo `backend/.env` bằng cách sao chép [`backend/.env.example`](backend/.env.example):

```bash
cd backend
npm ci
```

Điền `POSTGRES_PASSWORD`, `DATABASE_URL` với cùng mật khẩu, và `JWT_ACCESS_SECRET` ngẫu nhiên dài tối thiểu 32 ký tự. Giữ các cấu hình local còn lại theo file mẫu.

> Nếu mật khẩu có ký tự đặc biệt, URL-encode phần mật khẩu trong `DATABASE_URL`. Với database đã có dữ liệu, đổi `.env` không tự đổi mật khẩu role PostgreSQL.

```bash
docker compose up -d postgres
npm run db:migrate
npm run dev
```

API: `http://localhost:4000/api/v1` · Health: `http://localhost:4000/api/v1/health` · Swagger: `http://localhost:4000/docs`.

### Frontend

Mở terminal khác từ root, cài dependencies và sao chép [`frontend/.env.example`](frontend/.env.example) thành `frontend/.env.local`:

```bash
cd frontend
npm ci
```

Cấu hình kết nối local và điền Mapbox token:

```dotenv
NEXT_PUBLIC_API_URL=/api/v1
API_INTERNAL_URL=http://localhost:4000/api/v1
NEXT_PUBLIC_REALTIME_URL=http://localhost:4000
NEXT_PUBLIC_MAPBOX_TOKEN=pk.your-mapbox-public-token
```

```bash
npm run dev
```

Mở **http://localhost:3000** (trang mặc định chuyển tới `/feed`). Khi thay `API_INTERNAL_URL`, khởi động lại hoặc build lại Next.js để cập nhật rewrite.

## Kiểm thử và tài liệu kỹ thuật

Chạy trong từng thư mục ứng dụng:

| Thư mục | Lệnh kiểm tra |
| --- | --- |
| `frontend/` | `npm run type-check`, `npm run lint`, `npm test`, `npm run build` |
| `backend/` | `npm run type-check`, `npm run lint`, `npm test -- --runInBand`, `npm run build` |
| `backend/` (cần môi trường phù hợp) | `npm run test:e2e`, `npm run test:db`, `npm run db:migrate:status` |

| Nội dung | Tài liệu |
| --- | --- |
| Quy ước phát triển | [AGENTS.md](AGENTS.md) |
| Backend và API | [Backend README](backend/README.md), Swagger tại `http://localhost:4000/docs` |
| Bản đồ cá nhân và Journey | [Bản đồ và trình dựng](docs/phase-2-step-3.md), [xuất PNG](docs/phase-2-step-5.md), [chia sẻ lên Feed](docs/phase-2-step-6.md) |
| Tin nhắn và kết nối | [Giao diện](docs/phase-4-feature-4.md), [chia sẻ nội dung](docs/phase-4-feature-5.md), [theo dõi qua lại](docs/phase-4-mutual-follow.md) |
| Triển khai | [Hướng dẫn](docs/deployment/DEPLOYMENT_GUIDE.md), [biến môi trường](docs/deployment/ENVIRONMENT_VARIABLES.md), [bảo mật ảnh](docs/deployment/MEDIA_SECURITY.md) |
| Kiểm chứng phát hành | [Production Readiness](docs/deployment/PRODUCTION_READINESS.md), [smoke tests](docs/deployment/SMOKE_TEST_CHECKLIST.md), [rollback](docs/deployment/ROLLBACK_PLAN.md) |

Tình trạng kiểm chứng local/CI/cloud được ghi riêng trong Production Readiness. Khi triển khai, không commit secrets và không sửa migration đã áp dụng.

---

**WanderMap** — *Explore places. Share moments. Map your journey.*
