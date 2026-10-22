# Đánh dấu đã đến từ kết quả tìm kiếm Khám phá

Luồng: **Khám phá → tìm kiếm → chọn kết quả → Đánh dấu đã đến → Lưu dấu chân**. Không yêu cầu bài đăng, ảnh hoặc đánh giá. Có thể giữ trống ngày ghé thăm nếu không nhớ; ghi chú cũng tùy chọn. Mặc định chỉ mình tôi, hoặc chọn công khai trong form hiện có.

Sau khi lưu, địa điểm thuộc danh sách đã đến và xuất hiện trong My Travel Map/Journey Builder kể cả có `post_count = 0`. Người dùng có thể chọn điểm này để tạo hành trình. Nút viết bài trên cùng thẻ vẫn hoạt động độc lập.

## Cách triển khai

- Kết quả WanderMap mở trực tiếp `MarkVisitedButton`, dùng lại query trạng thái, form, lịch sử và quyền hiện có.
- Kết quả OpenStreetMap chỉ gọi `POST /locations` sau thao tác đánh dấu của người đã đăng nhập; gửi khóa OSM qua `google_place_id` để backend tạo hoặc lấy lại địa điểm đã có. Không tạo location khi tìm kiếm/chọn kết quả.
- Khi có ID chính thức, mở tự động form đánh dấu hiện có. `POST /users/me/visited-locations` chỉ thực hiện sau khi người dùng lưu. Hai thao tác độc lập: nếu hủy form hoặc lưu đánh dấu thất bại, location có thể đã được thêm vào danh mục, nhưng không tự tạo visit, bài đăng hoặc ảnh. Retry tiếp tục dùng cùng location.
- Tình trạng đã đánh dấu được đọc lại trước khi mở editor, nên chọn lại kết quả OSM đã lưu mở lịch sử hiện có thay vì tạo dấu trùng. Không tự gán ngày hôm nay.
- Đổi kết quả tìm kiếm hoặc đổi tài khoản tạo instance thao tác riêng; phản hồi chậm của lựa chọn cũ không mở form cho lựa chọn/tài khoản mới.
- Dùng nguyên `apiFetch`, JWT/ownership backend và cơ chế invalidation của Visited Locations: làm mới visited lists, My Travel Map, Journey picker và profile. Khi resolve location, làm mới cache locations/place-search.

Các file chính: `SearchPin.tsx`, `SearchVisitedButton.tsx`, `MarkVisitedButton.tsx`, `lib/api/locations.ts`. Không có endpoint, schema/migration, dependency hoặc env mới. Backend Journey hiện chọn từ `user_visited_locations` và không đòi hỏi bài đăng; không cần đổi nghiệp vụ backend.

## Kiểm tra

Từ `frontend/`:

```powershell
npm run type-check
node --experimental-strip-types --test tests/*.test.mjs
npm run lint
npm run build
# Web/API local đang chạy; Chrome dùng profile tạm, API browser được mock và không ghi DB:
$env:WANDERMAP_TEST_WEB_URL = 'http://localhost:3000'
node tests/explore-visited.browser.mjs
```

Browser suite kiểm tra không ghi khi tìm kiếm/chọn ghim, guard chưa đăng nhập, tạo/lấy location theo khóa OSM, lưu private không ngày/ảnh/bài, lỗi resolve/lưu và retry giữ form, đánh dấu đã tồn tại, kết quả WanderMap không tạo location, đổi pin khi response cũ còn chậm, mobile/dark và chọn điểm không có bài trong Journey Builder. Server render của Explore chỉ đọc trending public qua backend đã cấu hình; mọi request browser tới `/api/v1` được intercept bằng fixtures. Đây là kiểm thử frontend, không thay thế integration với database thật.

Kết quả xác minh:

- Frontend type-check: pass.
- 27 Node tests hiện có: pass.
- Lint: pass, còn các warnings cũ ngoài phạm vi; lint riêng bốn file chức năng thay đổi không có lỗi/cảnh báo.
- Production build: pass trên bản sao nguồn/cấu hình tạm; thư mục tạm được dọn, không ghi đè cache `.next` của server dev đang chạy.
- Chrome: 6 nhóm kiểm tra browser nêu trên pass; đã xem screenshot desktop/mobile 320px/dark. Đã xác nhận payload private, `visited_at: null`, không có request tạo bài/upload/Journey và điểm `post_count = 0` được chọn trong Builder.
- `git diff --check`: pass.

Không chạy lại backend/database integration vì không đổi backend/schema. Chưa xác minh Safari/Firefox hoặc mobile thật. Fixtures/screenshots ở thư mục temp không chứa dữ liệu tài khoản thật.
