# Viết bài từ địa điểm tìm kiếm

Trong `/explore`, chọn một kết quả tìm kiếm để bản đồ zoom đến điểm đó. Thẻ ghim có nút **Viết bài về địa điểm này**, mở `/post/new` với địa điểm được điền sẵn. Người dùng vẫn có thể chọn địa điểm khác trong form.

Trang viết bài có nút **Quay lại** cạnh tiêu đề để trở về trang đã mở form (Khám phá, Bản tin hoặc trang khác trong ứng dụng), giữ lịch sử điều hướng khi tải lại. Nếu mở trực tiếp hoặc không có trang trước trong ứng dụng, nút đưa về Bản tin.

- Địa điểm WanderMap: URL dùng `location_id`; server đọc lại tên, địa chỉ và dữ liệu hiện tại bằng API, không dùng snapshot từ URL.
- Địa điểm OpenStreetMap: URL dùng `place` chứa metadata tối thiểu đã giới hạn độ dài. Tên, tọa độ, loại, địa chỉ, thành phố, quốc gia và khóa OSM được giữ để dùng luồng tạo địa điểm hiện có.
- Chưa đăng nhập: form chuyển đến đăng nhập với `next` giữ nguyên query. Tải lại hoặc mở liên kết trong tab mới cũng giữ địa điểm.
- JSON, UUID, tọa độ hoặc category sai: hiển thị thông báo trong form để chọn lại. Địa điểm không còn tồn tại hoặc API lỗi cũng cho phép chọn địa điểm khác.
- Không ghi dữ liệu khi tìm kiếm, chọn ghim hoặc mở form. Với kết quả ngoài WanderMap, chỉ gọi API tạo địa điểm khi gửi bài hợp lệ; API tiếp tục dùng khóa OSM để tránh trùng.

Không có API, dependency, migration hoặc biến môi trường mới. Authentication và validation backend tiếp tục được áp dụng qua API hiện có.

## Kiểm tra

Từ `frontend/`:

```powershell
npm run type-check
node --experimental-strip-types --test tests/post-location.test.mjs
npm run build
```

Kiểm tra trình duyệt: chọn lần lượt địa điểm WanderMap và OpenStreetMap ở Khám phá; bấm viết bài; kiểm tra tên/địa chỉ/loại điền sẵn, tải lại, đăng nhập khi cần, thay địa điểm trong form. Khi gửi bài, xác nhận `location_id` đúng địa điểm đã chọn; chỉ tạo địa điểm cho kết quả bên ngoài. Thử query không hợp lệ và UUID không tồn tại để bảo đảm form vẫn sử dụng được. Thử mobile và giao diện tối.

Đã xác minh khi triển khai: TypeScript, production build, 22 unit tests frontend (6 tests mới cho liên kết địa điểm) và Chrome desktop/mobile 320px/dark. Smoke UI dùng profile Chrome tạm, đọc địa điểm public thật; auth/search và các request ghi được giả lập/chặn bằng CDP. Đã kiểm tra payload tạo địa điểm/bài đăng, giữ bản nháp sau lỗi, đổi địa điểm thủ công và quay lại sau đăng nhập; không ghi database thật. Đây là kiểm thử frontend, chưa thay thế e2e ghi dữ liệu với backend thật. ESLint còn hai cảnh báo có sẵn trong MapTopbar (ARIA và ảnh `<img>`).
