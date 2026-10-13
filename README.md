# 🗺️ WanderMap

> Khám phá thế giới qua lăng kính của những người đã đi.

Mạng xã hội du lịch dựa trên bản đồ — check-in, chia sẻ trải nghiệm, khám phá địa điểm mới.

> **Trạng thái chuyển đổi backend:** Backend NestJS + PostgreSQL độc lập đã được thêm tại `backend/`. Frontend Next.js vẫn còn dùng Supabase ở một số luồng và chưa được tích hợp với API mới. Không xóa project Supabase hoặc chạy migration chuyển dữ liệu production cho đến khi hoàn tất các bước tích hợp và xác minh dữ liệu.

---

## Tech Stack

| Layer | Công nghệ |
|---|---|
| Framework | Next.js 15 (App Router) |
| Frontend data/auth (hiện tại) | Supabase — đang chờ chuyển API client |
| Backend API (mới) | NestJS + TypeScript (`backend/`) |
| Database backend (mới) | PostgreSQL + PostGIS, SQL migrations |
| Map Engine | Mapbox GL JS + react-map-gl |
| Clustering | supercluster |
| State | Zustand + TanStack Query |
| Styling | Tailwind CSS + Framer Motion |
| Validation | Zod + React Hook Form |
| Auth frontend hiện tại | Supabase Auth (Email + Google OAuth) |
| Auth backend mới | Email/password, JWT access token + HttpOnly rotating refresh cookie |

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
│   ├── supabase/           # client.ts, server.ts, queries.*.ts
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

### 3. Setup Supabase

```bash
# Cài Supabase CLI nếu chưa có
npm install -g supabase

# Đăng nhập
supabase login

# Link với project của bạn
supabase link --project-ref YOUR_PROJECT_REF

# Chạy migration
npm run db:migrate

# Generate TypeScript types (quan trọng!)
npm run db:generate
```

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

### Supabase Edge Functions (cho trending cron)

```bash
supabase functions deploy refresh-trending
```

---

## Database

Schema đầy đủ trong `supabase/migrations/001_initial_schema.sql`:

- **PostGIS** cho geospatial queries (viewport, radius)
- **RLS** (Row Level Security) bảo vệ toàn bộ data
- **Triggers** tự động cập nhật `post_count`, `avg_rating`, `likes_count`, `followers_count`
- **Functions** `get_locations_in_viewport`, `get_following_feed`, `refresh_trending_scores`

---

## Đóng góp

PR và Issues luôn được chào đón!
---

## Backend API (đang chuyển đổi)

Repository hiện có backend độc lập trong thư mục `backend/`, dùng NestJS + TypeScript + PostgreSQL/PostGIS. Backend có migrations riêng và không dùng Supabase runtime. Tuy nhiên, **frontend Next.js chưa được chuyển sang API mới**; các phần UI hiện tại vẫn còn Supabase imports, vì vậy chưa nên tắt hoặc xóa Supabase project cũ.

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

