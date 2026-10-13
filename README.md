# 🗺️ WanderMap

> Khám phá thế giới qua lăng kính của những người đã đi.

Mạng xã hội du lịch dựa trên bản đồ — check-in, chia sẻ trải nghiệm, khám phá địa điểm mới.

> **Trạng thái:** Frontend Next.js đã được chuyển sang gọi API NestJS tại `backend/` (không còn Supabase ở runtime). Thư mục `supabase/` chỉ còn là tham chiếu cũ cho việc chuyển dữ liệu; **không xóa project Supabase cũ** cho đến khi dữ liệu production được chuyển và xác minh.

---

## Tech Stack

| Layer | Công nghệ |
|---|---|
| Framework | Next.js 15 (App Router) |
| Frontend data/auth | Gọi REST API `/api/v1` qua `src/lib/api` (fetch + tự refresh token) |
| Backend API (mới) | NestJS + TypeScript (`backend/`) |
| Database backend (mới) | PostgreSQL + PostGIS, SQL migrations |
| Map Engine | Mapbox GL JS + react-map-gl |
| Clustering | supercluster |
| State | Zustand + TanStack Query |
| Styling | Tailwind CSS + Framer Motion |
| Validation | Zod + React Hook Form |
| Auth | Email/password, JWT access token + HttpOnly rotating refresh cookie |

---

## Cấu trúc thư mục

```
src/
├── app/                    # Next.js App Router
│   ├── auth/               # Login, Register, OAuth callback
│   ├── main/               # Main app routes
│   │   ├── explore/        # 🗺️  Full-screen map (trang chủ)
│   │   ├── location/[id]/  # Chi tiết địa điểm + danh sách bài đăng
│   │   ├── post/[id]/      # Chi tiết bài đăng
│   │   ├── profile/[username]/ # Trang cá nhân
│   │   └── itinerary/[id]/ # Lộ trình
│   └── api/                # Route Handlers (REST API)
│
├── components/
│   ├── map/                # MapCanvas, ClusterLayer, Pins, Topbar, FilterBar
│   ├── post/               # PostCard, PostGrid, PostFeedClient
│   ├── location/           # LocationHeader, LocationDrawer
│   ├── profile/            # ProfileHeader, ProfileStats, ProfileTravelMap
│   ├── auth/               # LoginForm, RegisterForm
│   ├── ui/                 # Tabs, Button, Dialog... (Radix-based)
│   └── layout/             # Providers (Query, Theme, Auth)
│
├── lib/
│   ├── api/                # client.ts (token + refresh), auth/locations/posts/users
│   ├── mapbox/             # Config, geocoding, utils
│   ├── utils/              # cn(), timeAgo(), formatCount()...
│   └── validations/        # Zod schemas
│
├── hooks/                  # useAuth, useMap, useInfiniteScroll, useDebounce
├── stores/                 # Zustand: mapStore, authStore
├── types/                  # Domain types + database.types.ts
├── constants/              # ROUTES, QUERY_KEYS, categories...
└── styles/                 # globals.css (CSS variables + Tailwind)

supabase/
└── migrations/
    └── 001_initial_schema.sql   # Full schema: tables, RLS, triggers, functions
```

---

## Bắt đầu

### 1. Clone và cài đặt

```bash
git clone https://github.com/your-username/wandermap.git
cd wandermap
npm install
```

### 2. Tạo file môi trường

```bash
cp .env.example .env.local
# Điền các giá trị vào .env.local
```

### 3. Chạy backend API

Xem hướng dẫn chi tiết trong `backend/README.md` (PostgreSQL/PostGIS, migrate, secret JWT). Mặc định API chạy ở `http://localhost:4000/api/v1`.

```bash
npm run api:dev
```

Frontend gọi `/api/v1/*` cùng origin; `next.config.ts` proxy tới `API_INTERNAL_URL` (xem `.env.example`).
Đăng ký tài khoản qua `/auth/register` (Google OAuth chưa có ở backend).

### 4. Setup Mapbox

1. Tạo tài khoản tại [mapbox.com](https://mapbox.com)
2. Tạo Access Token (public token bắt đầu bằng `pk.`)
3. Thêm vào `.env.local`: `NEXT_PUBLIC_MAPBOX_TOKEN=pk.your-token`

### 5. Chạy development server

```bash
npm run dev
# → http://localhost:3000
```

---

## Lộ trình phát triển

### Phase 1 — MVP ✅ (Scaffold sẵn)
- [x] Auth (Email + Google OAuth)
- [x] Map full-screen với marker clustering
- [x] Tạo bài đăng gắn địa điểm
- [x] Trang chi tiết địa điểm
- [x] Trang cá nhân

### Phase 2 — Social
- [ ] Follow / Unfollow
- [ ] Feed theo dõi
- [ ] Like, Save, Comment
- [ ] Notifications

### Phase 3 — Discovery
- [ ] Trending score algorithm (cron job)
- [ ] Filter nâng cao
- [ ] Search toàn văn

### Phase 4 — Advanced
- [ ] Itinerary Builder (kéo thả lộ trình)
- [ ] Heatmap layer
- [ ] OpenWeather integration
- [ ] PWA / Offline mode

---

## Deploy

### Vercel (Recommended)

```bash
npx vercel --prod
```

Thêm environment variables trong Vercel Dashboard → Settings → Environment Variables.

---

## Database

Schema và migrations nằm ở `backend/src/database/migrations/` (PostgreSQL + PostGIS, chạy bằng `npm run api:db:migrate`).
`supabase/migrations/001_initial_schema.sql` chỉ còn là bản gốc tham chiếu.

---

## Đóng góp

PR và Issues luôn được chào đón!
---

## Backend API (đang chuyển đổi)

Repository hiện có backend độc lập trong thư mục `backend/`, dùng NestJS + TypeScript + PostgreSQL/PostGIS. Backend có migrations riêng và không dùng Supabase runtime. Frontend Next.js đã gọi API này; Supabase project cũ chỉ nên tắt sau khi chuyển dữ liệu production.

Khởi tạo backend lần đầu:

```bash
cd backend
cp .env.example .env
# Thay JWT_ACCESS_SECRET bằng secret ngẫu nhiên riêng
npm install
docker compose up -d postgres
npm run db:migrate
npm run dev
```

Mở `http://localhost:4000/docs` để xem/thử REST API; `http://localhost:4000/api/v1/health` để kiểm tra API và kết nối database.

Các lệnh chuyển tiếp ở repository root (sau khi đã cài dependency trong `backend/`): `npm run api:dev`, `npm run api:build`, `npm run api:test`, `npm run api:type-check`, `npm run api:db:migrate`.

Chi tiết endpoint, environment variables, migrations, authentication, known limitations và quy trình chuyển frontend xem tại [`backend/README.md`](backend/README.md).

