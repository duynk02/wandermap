# Phase 2 — Step 2: Visited Locations API & UI

Cập nhật sau xử lý lỗi local: migrations 007–008 đã được áp dụng lên database local và trang Profile đã được xác minh HTTP 200. Các ghi chú bên dưới về chỉ dùng DB tạm mô tả đợt kiểm thử Step 2 ban đầu; xem mục khắc phục ở cuối cho lần xác minh local này. Không thay đổi database production.

Step 2 triển khai đánh dấu địa điểm đã đến và quản lý từng ngày ghé thăm. Tái sử dụng NestJS REST, DatabaseService, JWT guards, apiFetch, TanStack Query, React Hook Form/Zod và Radix Dialog. Không thêm dependency hoặc thay cách lưu token.

## Cách sử dụng

1. Mở chi tiết địa điểm hoặc panel địa điểm trên bản đồ Explore, chọn **Đánh dấu đã đến**. Khách được nhắc đăng nhập và quay lại trang đang xem.
2. Ngày ghé thăm là tùy chọn, không tự gán hôm nay. Thêm ghi chú nếu muốn, chọn **Chỉ mình tôi** (mặc định) hoặc **Công khai** rồi lưu.
3. Nút chuyển thành **Đã ghé thăm · Chỉnh sửa**. Mở lại để sửa ghi chú/quyền riêng tư hoặc thêm các lần quay lại.
4. Trong lịch sử, thêm/sửa/xóa từng lần ghé thăm. Mỗi địa điểm tối đa một bản ghi/ngày; ngày khác ghi nhận lần mới. Xóa một lần không bỏ đánh dấu địa điểm.
5. **Bỏ đánh dấu địa điểm này** yêu cầu xác nhận và xóa cả lịch sử thuộc đánh dấu. Wishlist, bài đăng và Journey vẫn được giữ.

Dialog có focus trap, khôi phục focus về nút mở, Escape/backdrop để đóng, xác nhận khi có nội dung chưa lưu, cảnh báo khi reload và chặn thao tác trong lúc ghi dữ liệu. Mobile dùng bottom sheet có vùng nội dung cuộn và nút lưu cố định; desktop dùng dialog; hỗ trợ dark theme/reduced motion. Lỗi lưu giữ nội dung để thử lại; lỗi tải không giả định địa điểm chưa được đánh dấu.

My Travel Map, bộ lọc và marker công khai trên Profile đã được mở rộng trong [Step 3](phase-2-step-3.md), đọc marks chuẩn và invalidate sau thay đổi visited. Thống kê địa điểm trên Profile đếm **địa điểm duy nhất được phép xem**, không dùng số bài đăng; chủ tài khoản tải lại thống kê có auth để thấy cả dữ liệu private của mình.

## API

Tất cả đường dẫn dưới `/api/v1`. Các endpoint `me` yêu cầu JWT access token. User ID lấy từ JWT, body không được chứa user_id/owner hoặc các field không được công bố.

| Method | Path | Hành vi |
| --- | --- | --- |
| GET | `/users/me/visited-locations` | Danh sách phân trang, tùy chọn location_id để kiểm tra trạng thái một địa điểm. |
| POST | `/users/me/visited-locations` | Đánh dấu, có thể kèm ngày ghé thăm đầu tiên trong cùng transaction. |
| GET | `/users/me/visited-locations/:id` | Thông tin một đánh dấu thuộc user hiện tại. |
| PATCH | `/users/me/visited-locations/:id` | Sửa note/visibility. |
| DELETE | `/users/me/visited-locations/:id` | Xóa đánh dấu và mọi visit thuộc nó. |
| GET | `/users/me/visited-locations/:id/visits` | Lịch sử phân trang, mới nhất trước. |
| POST | `/users/me/visited-locations/:id/visits` | Thêm/replay một ngày ghé thăm. |
| PATCH | `/users/me/visited-locations/:id/visits/:visitId` | Sửa ngày/note trong đúng đánh dấu. |
| DELETE | `/users/me/visited-locations/:id/visits/:visitId` | Xóa một lần, vẫn giữ đánh dấu. |
| GET | `/users/:username/visited-locations` | Anonymous/người khác chỉ thấy public; chủ tài khoản có JWT thấy cả private. |

Create body:

```json
{
  "location_id": "<location-uuid>",
  "visited_at": "2026-06-12",
  "note": "Một kỷ niệm đẹp",
  "visibility": "private"
}
```

visited_at có thể bỏ qua/null khi tạo đánh dấu. Lần ghé thăm riêng bắt buộc visited_at dạng YYYY-MM-DD thực, năm 0001–9999 (không timestamp/infinity). Không giả lập thời gian di chuyển hoặc GPS. Note trim, tối đa 1000; gửi null/chuỗi trống để xóa. Visibility chỉ public/private, không nhận null/followers. PATCH rỗng bị từ chối.

List query: page từ 1 đến 100000, pageSize từ 1 đến 50 (mặc định 20); list địa điểm nhận thêm location_id UUID. Response `{data,count,page,pageSize,hasMore}`. Page/count dùng cùng snapshot SQL và điều kiện quyền, kể cả page rỗng. Sort created_at/id giảm dần cho đánh dấu; visited_at/id giảm dần cho visits. Date-only trả chuỗi không phụ thuộc múi giờ; timestamp JSON có thể biểu diễn cùng thời điểm bằng Z hoặc offset ISO.

Đánh dấu trả id/user_id/location_id, note, visibility, created_at/updated_at, visit_count, last_visited_at và location summary `{id,name,address,country,city,category,coordinates:{lat,lng}}`. Visit trả id/visited_location_id/visited_at/note/timestamps, không trả geometry hoặc dữ liệu người khác.

POST đánh dấu lặp cùng payload trả bản ghi cũ, không thêm mark/visit trùng. Nếu note/visibility được gửi khác dữ liệu đã có, trả 409 `VISITED_LOCATION_EXISTS`, dùng PATCH để sửa. POST visit cùng ngày và note là replay; khác note trả 409 `VISIT_DATE_EXISTS`. PATCH ngày trùng trả 409, rollback giữ nguyên dữ liệu. Không tự ghi đè dữ liệu do double click hoặc retry.

Các mutation khóa user active trong transaction để serialize ghi cùng owner và cập nhật counters. Kiểm tra ownership cho cả mark và visit (visit phải thuộc đúng mark), trả 404 khi không tồn tại/không thuộc user. Public list/profile lọc visibility và trạng thái active **trước** count. Location không tồn tại trả 404. SQL dùng placeholders. Response lỗi qua ApiExceptionFilter hiện có.

## Migration 008 và tương thích pins

`backend/src/database/migrations/008_visited_locations_cutover.sql` là migration mới, giữ nguyên 001–007. Chỉ backfill pins visited thành đánh dấu private, giữ timestamps, không tạo ngày/visit và không lấy dữ liệu posts. Pins/wishlist gốc không bị xóa. Trigger country_count legacy chuyển sang lấy marks chuẩn; public API tính lại số liệu theo visibility, không để lộ private qua counter. Country text vẫn là metadata hiện có, chưa phải hệ thống địa giới chuẩn hoặc Travel Passport.

Sau cutover, user_visited_locations là nguồn chính cho visited. user_pins chỉ còn được ứng dụng sử dụng cho wishlist; các hàng visited cũ giữ lại để bảo toàn dữ liệu nhưng không còn được dùng để trả trạng thái visited. Không backfill lặp ngoài migration runner và không chạy writer cũ sau cutover.

- GET pins giữ shape Location + status/pinned_at. Hợp nhất marks và wishlist; khi cùng địa điểm có cả hai thì ưu tiên visited, không trả marker trùng.
- PUT pin visited gọi service chuẩn; không thay metadata/visibility đã lưu và không tạo ngày giả.
- PUT wishlist giữ lịch sử đã đến, kể cả khi địa điểm đang visited.
- DELETE pin legacy xóa cả đánh dấu/lịch sử và wishlist ở địa điểm đó trong transaction; giữ semantics “bỏ pin”. DELETE qua API visited mới chỉ bỏ đánh dấu, nên wishlist cũ có thể hiện lại trên map.

Triển khai có kiểm soát, tránh chạy song song bản cũ/bản mới:

1. Dừng/đợi request ghi pins của backend cũ; giữ backup theo quy trình môi trường.
2. Từ backend/, chạy `npm run db:migrate:status`, `npm run db:migrate` (bao gồm 007 nếu còn pending).
3. Khởi động backend Step 2 và frontend tương ứng; kiểm tra health/Swagger, pins cũ và một thao tác đánh dấu.

Không rollback riêng binary backend về writer pins cũ sau khi đã nhận dữ liệu mới. Migration không tự deploy, không sửa cookie/CORS và không thêm env runtime. Trong quá trình triển khai tính năng chỉ chạy migrations trên container test độc lập, không áp dụng database ứng dụng/production.

## Các file chính

- `backend/src/visited-locations/`: module/controller/service, request DTO và response types.
- `backend/src/users/users.module.ts`, `users.service.ts`: tích hợp module, pins compatibility và thống kê theo viewer.
- `backend/src/database/migrations/008_visited_locations_cutover.sql`.
- `frontend/src/lib/api/visited-locations.ts`, `types/index.ts`, `constants/index.ts`, `lib/validations/visited-locations.ts`: contract, wrappers, query keys và validation.
- `frontend/src/components/location/MarkVisitedButton.tsx`, `visited/VisitHistory.tsx`, `visited/shared.tsx`; tích hợp LocationHeader/LocationDrawer, theme CSS.
- `frontend/src/components/profile/ProfileStats.tsx`: số địa điểm duy nhất, cache theo viewer.
- `frontend/src/app/auth/login/page.tsx`: thêm Suspense cho useSearchParams để sửa lỗi prerender chặn production build. `components/auth/LoginForm.tsx` chỉ điều hướng một lần qua authenticated-state effect, tránh push/replace/refresh cạnh tranh khiến request quay lại địa điểm bị hủy.

Cache dữ liệu private có viewer trong query key; mutation kiểm tra phiên còn đúng user trước khi gửi và trước khi cập nhật UI. Invalidate marks/visits/pins/profile liên quan sau ghi. Không sao chép lịch sử vào Zustand hoặc lưu token vào storage.

## Kiểm thử

Backend, từ backend/:

```bash
npm run type-check
npm run lint
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run build
```

PostGIS thử nghiệm (không dùng DATABASE_URL ứng dụng), PowerShell:

```powershell
$env:WANDERMAP_TEST_DATABASE_URL = '<disposable-postgis-connection-string>'
npm run test:db
```

`test/visited-locations-api.db-spec.ts` chạy Nest controllers, ValidationPipe, JWT guards và SQL thật. Schema UUID/fixtures nằm trong transaction rollback; test nested transactions dùng savepoints. Kiểm tra backfill dữ liệu cũ, authentication, ownership, giả user_id, validation, private/public/count, replay/conflict, repeat visits, sửa/xóa, wishlist/pins và profile stats. Suite Step 1 vẫn giữ nguyên. Thiếu test URL thì các suite DB skip rõ ràng.

Frontend, Node 22, từ frontend/:

```bash
npm run type-check
node --experimental-strip-types --test tests/visited-locations.test.mjs tests/avatar-crop.test.mjs
npm run build
```

Browser smoke test dùng Chrome/Chromium và **hai server local trỏ tới database tạm**; không dùng profile Chrome đang đăng nhập:

```powershell
$env:WANDERMAP_TEST_WEB_URL = 'http://localhost:3300'
$env:WANDERMAP_TEST_API_URL = 'http://localhost:4400/api/v1'
# Tùy chọn WANDERMAP_BROWSER_PATH nếu Chrome không ở đường dẫn Windows mặc định.
node tests/visited-locations.browser.mjs
```

Script tạo tài khoản/địa điểm giả trên API test, kiểm tra request đồng thời qua pg pool thật, đăng nhập qua UI, create/update/delete, unsaved warning/focus, responsive/dark và chụp ảnh vào thư mục temp. Chrome có profile tạm riêng được dọn cuối test; screenshots giữ trong temp và in đường dẫn, không in credentials/token. Dừng server/container test sau khi xác minh. Đây là smoke test chức năng, chưa thay thế kiểm thử đa trình duyệt hoặc accessibility audit đầy đủ.

### Kết quả xác minh Step 2

Môi trường: Node 22.21.1, PostgreSQL/PostGIS trong container tạm `postgis/postgis:16-3.5`, backend test cổng 4400, frontend production test cổng 3300, Chrome headless với profile mới. Không gắn volume database ứng dụng.

| Kiểm tra | Kết quả |
| --- | --- |
| Backend/frontend type-check | Pass |
| Backend unit tests | 6 suites, 41 tests pass |
| E2E health hiện có | 1/1 pass (mock DB) |
| PostGIS migration + HTTP API integration | 2 suites, 27/27 tests pass (15 nền tảng Step 1 + 12 HTTP/cutover Step 2) |
| Frontend Node tests | 11/11 pass (3 validation visited + 8 avatar crop regression) |
| Chrome với backend/pool/database thật | 9 nhóm kiểm tra pass: gửi đồng thời không trùng; guest auth; create; add/edit visits; unsaved warning/focus; lỗi mạng giữ form và retry; visibility; mobile/dark; confirmed deletion/invalidation |
| Backend/frontend production build | Pass |
| Lint các file TS/TSX thay đổi | Pass |
| Migration runner 001–008, status và chạy lại | Pass trên DB tạm; 0 pending, checksum giữ nguyên, không apply trùng |
| git diff --check | Pass |
| Lint toàn backend | Còn 6 unused imports có sẵn tại auth.controller.ts; không sửa ngoài phạm vi |

Frontend build còn các warnings có sẵn ở post detail, MapTopbar, PostFeedClient, useDebounce, mapbox helpers và mapStore; không phát sinh warning mới từ UI Step 2. Chưa kiểm thử Safari/Firefox, thiết bị mobile thật, load test hoặc migration trên dữ liệu production. Cần cutover có kiểm soát theo hướng dẫn trước khi dùng backend mới với database ứng dụng. Không có env runtime/dependency mới.

### Khắc phục lỗi Profile trên database local

Lỗi `relation "user_visited_locations" does not exist` xảy ra khi code Step 2 đã chạy nhưng migrations 007–008 chưa được áp dụng. Trong lần xử lý local, runner còn bị chặn tại 006 do checkout CRLF, trong khi checksum đã lưu ứng với bản LF.

Đã đối chiếu checksum với bản HEAD, khôi phục **đúng bytes đã áp dụng** của 006 (không đổi SQL hoặc checksum trong schema_migrations). Cố định LF cho 006–008 bằng `.gitattributes`; giữ nguyên cách xử lý các migration cũ khác vì checksum của chúng có định dạng xuống dòng riêng. Chuẩn hóa LF cho 007–008 khi chúng còn pending, sau đó chạy runner bình thường; không bỏ qua kiểm tra checksum.

Xác minh: migrations 007–008 áp dụng thành công, status 0 pending; API Profile và public visited list HTTP 200; trang Profile Next.js HTTP 200; truy vấn service own profile/visited chạy thành công; số lượng users/profiles/locations/posts/user_pins giữ nguyên. Không reset database hoặc xóa dữ liệu. Không cần restart backend cho thay đổi schema này; tải lại trang để thử lại request đã lỗi.
