# Phase 2 — My Travel Map & Journey Builder

Triển khai Step 3 và phần Journey Builder được yêu cầu kèm theo, trên schema 007–008 và API Step 2 hiện có. Không thêm dependency, migration hoặc thay đổi auth/storage. Itineraries tiếp tục là module lập kế hoạch độc lập.

## Trải nghiệm

Mở **Profile → Bản đồ**:

- Mapbox hiển thị các địa điểm đã đến, gom cụm bằng GeoJSON source trên map. Nút zoom, con lăn, pinch và nút xem toàn bộ đều được bật. fitBounds dùng khoảng longitude ngắn nhất khi qua kinh tuyến 180°.
- Danh sách phân trang 20 địa điểm; chọn một dòng để tập trung bản đồ, mở popup hoặc đi đến trang địa điểm. Mobile có danh sách thu gọn dạng bottom sheet.
- Tìm tên/thành phố/quốc gia không phân biệt dấu, lọc năm ghé thăm và quốc gia. Map, danh sách, số địa điểm và số lần ghé cùng dùng bộ lọc.
- Một địa điểm chỉ đếm một lần; mỗi bản ghi ngày ghé thăm đếm một lần. Khi chọn năm, ngày gần nhất/số lần chỉ tính trong năm đó. Điểm chưa có ngày chỉ hiện khi chọn tất cả năm.
- Tổng Journey luôn tính toàn bộ hành trình được phép xem, độc lập bộ lọc địa điểm và có nhãn rõ ràng. Quốc gia dùng metadata hiện hữu, chưa chuẩn hóa địa giới.
- Chủ hồ sơ thấy cả private. Khách/người khác chỉ thấy public; năm, quốc gia và thống kê cũng được lọc quyền ở backend. Query cache tách theo người xem; không tái dùng dữ liệu private khi chuyển tài khoản.

Popup có nút đóng 44 × 44 px, padding 16 px, bo góc và màu theo theme; hỗ trợ Escape và trả focus về map. Nút **Quay lại** trên trang địa điểm trở về trang trước trong WanderMap, giữ tab Bản đồ của Profile qua `?tab=map`, kể cả sau reload/back/forward. Mở link trực tiếp hoặc từ bên ngoài dùng Khám phá làm dự phòng. Chuyển tab thay history entry hiện tại, không thêm một bước quay lại; navigation metadata giữ nguyên state của Next và phân biệt push/replace.

**Tạo hành trình** mở builder:

1. Chọn các địa điểm đã đánh dấu. Tìm kiếm/phân trang trong chính danh sách của mình, tối đa 100 điểm, mỗi địa điểm chỉ một lần.
2. Dùng drag handle hoặc mũi tên lên/xuống để sắp xếp. Bản đồ cập nhật ngay, giữ thứ tự người dùng chọn.
3. Đặt tên/mô tả, tùy chọn tải ảnh bìa qua upload API hiện có. Ảnh upload có URL công khai, có thông báo tại form.
4. Chọn màu, nét liền/nét đứt, hiện tên/số và nền outdoors-v12/dark-v11. Nút hình mắt chuyển sang preview.
5. Lưu bản nháp hoặc hoàn tất hành trình. Draft được phép có 0/1 điểm; published cần ít nhất 2 điểm. Hoàn tất với quyền private vẫn chỉ chủ sở hữu xem được.
6. Công khai có xác nhận: Journey có thể chủ động chia sẻ snapshot điểm/ngày của những đánh dấu vốn private. Quyền Journey độc lập quyền đánh dấu.

Các hành trình hiện dưới bản đồ, có xem/sửa/xóa theo quyền. Route `/journey/:id` hiển thị bản đồ và các stops theo thứ tự; chủ sở hữu mở được bản nháp/private sau khi phục hồi session. Người khác chỉ đọc public + published của tài khoản active.

Builder có focus trap, cảnh báo nội dung chưa lưu và reload, chặn thao tác khi đang lưu/upload. Lỗi mạng/409 giữ nguyên form. Mỗi lần mở lại bản chỉnh sửa chờ phiên bản mới từ server; background refetch không thay form đang nhập. Trình tạo chỉ tải khi cần mở.

Đường nối là minh họa theo thứ tự, không có quãng đường/thời gian lái xe. GeoJSON LineString/MultiLineString tái tạo từ tọa độ locations; cắt đoạn tại ±180°, không vẽ vòng ngang thế giới. Chưa làm đường cong, xuất ảnh (Step 5), Journey Post/Feed (Step 6) hoặc liên kết itinerary.

## API bản đồ và bộ lọc

`GET /api/v1/users/:username/travel-map` nhận `year`, `search` (trim, tối đa 100), `country` (giá trị metadata chính xác), `location_id` tùy chọn. Public endpoint dùng OptionalAccessTokenGuard.

Response:

```text
{
  statistics: { location_count, visit_count, journey_count },
  options: { years: number[], countries: string[] },
  points: [{ id, location_id, name, city, country, coordinates: {lat,lng},
             last_visited_at, visit_count, visibility }]
}
```

`options` lấy từ tất cả đánh dấu được phép xem, không thu hẹp theo bộ lọc hiện tại. Points không chứa note/lịch sử chi tiết. Chỉ trả các đánh dấu của hồ sơ được hỏi; không tải toàn bộ locations toàn hệ thống.

Hai API danh sách visited hiện có cũng nhận `year/search/country` với cùng semantics, giữ nguyên pagination và response contract Step 2. Năm là số nguyên 1–9999. Unknown fields, query/payload sai kiểu bị ValidationPipe từ chối.

## API Journey

Tất cả paths dưới `/api/v1`:

| Method | Path | Contract |
| --- | --- | --- |
| GET | `/journeys` | Optional JWT; username/mine/page/pageSize; mới cập nhật trước, tie-break id DESC. mine=true cần đăng nhập. |
| POST | `/journeys` | JWT; request_id UUID ổn định, title và stops bắt buộc. |
| GET | `/journeys/:id` | Chủ sở hữu hoặc public + published; không được xem trả 404. |
| PATCH | `/journeys/:id` | JWT owner; revision bắt buộc và ít nhất một trường thay đổi. |
| DELETE | `/journeys/:id?revision=N` | JWT owner + revision; xóa aggregate trong transaction. |
| POST | `/journeys/:id/publish` | JWT owner; revision, visibility tùy chọn; tối thiểu 2 stops. |

List mặc định page=1/pageSize=8, tối đa 50, page tối đa 100000; response `{data,count,page,pageSize,hasMore}` cùng snapshot SQL. Owner có draft/private, người khác chỉ thấy public/published. List trả summary `stop_count/preview_names`; GET detail mới tải đầy đủ stops.

Metadata: title trim 1–200, description tối đa 5000, cover_image_url HTTP(S) tối đa 2048 hoặc null, visibility private/public, status draft/published. style_config là object có version=1; allowlist line_color hex6, line_style solid/dashed, show_labels/show_order boolean, map_style outdoors-v12/dark-v11. Unknown keys bị reject.

`stops` là mảng có thứ tự `[{location_id, visit_id?}]`; không nhận user_id, stop_order hay snapshot từ client. Backend đánh thứ tự 1..N. Khi thêm mới: thiếu visit_id chọn lần ghé gần nhất, null để không gắn ngày, UUID chỉ được trỏ đến visit cùng owner + location. Chỉ thêm địa điểm đã đánh dấu.

Tên/ngày chụp từ database khi thêm/chọn lại visit; public response bỏ visit_id và không bao giờ chứa ghi chú visit. Reorder/chỉnh metadata giữ snapshot cũ, kể cả khi đã xóa đánh dấu/visit. Xóa visit chỉ detach visit_id, không xóa stops; tên location và ngày visit thay đổi không tự sửa snapshot. Geometry vẫn lấy locations hiện tại theo thiết kế Step 1.

Ghi dữ liệu khóa owner active rồi Journey FOR UPDATE, kiểm tra revision và transaction cả metadata/stops. Reorder defer unique order; kiểm tra aggregate trước commit. Revision tăng mỗi lần update; revision cũ trả 409 `JOURNEY_REVISION_CONFLICT`, không ghi đè. Tạo mới dùng request_id làm UUID Journey: retry cùng nội dung trả bản đã lưu, đổi nội dung cùng ID trả 409 `JOURNEY_REQUEST_REUSED`; không overwrite. ID thuộc owner khác trả 404.

## Kiểm thử và chạy lại

Backend (từ backend/):

```powershell
npm run type-check
npm run build
npm test -- --runInBand
npm run test:e2e -- --runInBand
# Chỉ đặt URL PostgreSQL/PostGIS dành riêng cho tests:
$env:WANDERMAP_TEST_DATABASE_URL = '<disposable-test-database-url>'
npm run test:db
```

Frontend (từ frontend/):

```powershell
npm run type-check
npm run build
node --experimental-strip-types --test tests/*.test.mjs
# Hai server này phải kết nối database test, tuyệt đối không dùng dữ liệu thật:
$env:WANDERMAP_TEST_WEB_URL = 'http://127.0.0.1:3300'
$env:WANDERMAP_TEST_API_URL = 'http://127.0.0.1:4400/api/v1'
node tests/travel-map.browser.mjs
```

Browser suite cần Node 22+, Chrome và Mapbox token hợp lệ. Có thể đặt WANDERMAP_BROWSER_PATH. Khi build frontend test, API_INTERNAL_URL phải trỏ API test; rewrite được resolve lúc build. Sau test, build lại với API_INTERNAL_URL của môi trường chạy thực tế. Chrome dùng profile tạm riêng; screenshot ở thư mục temp được in cuối suite, không chứa phiên đăng nhập thật.

Đã xác minh: backend type-check/build; 41 unit tests; 1 health e2e (mock DB); 34 SQL/HTTP tests với PostGIS thật (bao gồm regression Step 2); 16 Node tests frontend; production build frontend và browser flow. Browser kiểm tra lỗi mạng, revision, riêng tư, desktop/mobile/dark. Lint backend hiện bị chặn bởi 6 unused imports đã có trong auth.controller.ts; build frontend còn warnings cũ ngoài phạm vi.

Smoke hiệu năng local: 1.001 điểm cá nhân khoảng 259 KB, HTTP khoảng 45 ms trong lượt đo; danh sách 20 dòng. Đây là mẫu thử trên database tạm, chưa phải benchmark production hay xác nhận tải đồng thời lớn. Map dùng native clustering/layers, không tạo DOM marker cho từng địa điểm.

## Chọn giao diện sáng/tối

Nút **Giao diện** (biểu tượng mặt trời/mặt trăng trên mobile) nằm ở thanh trên của Bản tin, Khám phá và Hồ sơ, dùng được cả khi chưa đăng nhập. Chọn **Sáng**, **Tối** hoặc **Theo hệ thống**; lựa chọn được `next-themes` lưu trên trình duyệt, giữ khi chuyển trang/tải lại. Mặc định theo hệ thống. Menu hỗ trợ bàn phím, Escape trả focus và vùng bấm tối thiểu 44px.

Nền bản đồ Khám phá và bản đồ cá nhân theo giao diện. Journey dùng kiểu bản đồ đã lưu trong `style_config`, giữ nguyên thiết kế khi người xem đổi giao diện. Thanh tìm kiếm và các nút ở Khám phá xuống hai hàng trên màn hình nhỏ.

Kiểm tra thủ công: chọn Tối tại Bản tin, tải lại/chuyển sang Hồ sơ; chọn Theo hệ thống rồi đổi chế độ OS; mở menu bằng bàn phím và thử ở chiều rộng 320px. Đổi giao diện trên bản đồ cần giữ vị trí/zoom và các điểm.

## Triển khai

Database cần migrations 001–008 đã có; không có migration mới trong bước này. Kiểm tra `npm run db:migrate:status`, áp dụng các migration còn thiếu theo hướng dẫn Step 2, giữ nguyên checksum/dữ liệu. Restart/redeploy backend và frontend cùng nhau. Không đổi secret, cookie, .env hoặc reset database.
