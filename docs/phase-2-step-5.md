# Phase 2 — Step 5: Export Journey Image

Phần chia sẻ lên Feed đã triển khai tiếp ở [Step 6](phase-2-step-6.md). Luồng xuất PNG dưới đây vẫn độc lập với đăng bài.

Vị trí trong kế hoạch: Phase 1 đã được người dùng xác nhận hoàn tất; Phase 2 đã có dữ liệu Visited Locations, My Travel Map và Journey Flex MVP. Bước này chỉ xuất ảnh. Chia sẻ Journey lên Feed là Step 6 riêng, thực hiện sau khi hoàn tất export.

## Trải nghiệm

- Nút **Xuất ảnh** trên Journey Builder và trang chi tiết của chủ sở hữu.
- Builder xuất snapshot của tên/điểm/thứ tự/thiết kế đang chỉnh sửa, kể cả chưa lưu. Không gọi save/publish/upload; đóng export giữ nguyên form. Bản nháp không có điểm hoặc tên chưa hợp lệ hiển thị lỗi có hướng dẫn.
- Chọn **1:1 — 1600×1600** hoặc **4:5 — 1600×2000**. Poster có bản đồ, đường nối minh họa, markers, tiêu đề, số điểm và branding WanderMap. Ngày chỉ xuất hiện nếu tất cả stops có ngày hợp lệ; lấy min/max, không giả định thứ tự stops là thứ tự ngày.
- Tên và danh sách dài được giới hạn trong vùng chữ. Bản đồ dùng symbol collision để không ép tất cả nhãn chồng nhau. Tối đa năm tên xuất hiện ở phần chú thích.
- Preview chính là PNG được tạo, cùng Blob với file tải về. Đổi tỷ lệ tạo lại ảnh. Nút tải chỉ bật khi ảnh hoàn thành; tên file `wandermap-<ten-hanh-trinh>-1x1.png` hoặc `-4x5.png`.
- Có loading, lỗi cụ thể và thử lại. Đóng/hủy hủy tác vụ, gỡ map và object URL. Timeout toàn bộ tác vụ 45 giây. Thông báo tải xuống phản ánh việc gửi yêu cầu cho trình duyệt; ứng dụng không thể xác nhận người dùng đã lưu file thành công.

## Quyết định kỹ thuật

| Phương án | Đánh giá |
| --- | --- |
| A. Mapbox GL canvas + compositing | **Chọn.** Render bản đồ riêng rồi ghép poster bằng Canvas 2D; không phụ thuộc kích thước/viewport map đang chỉnh sửa. |
| B. Chụp Share Card DOM | Không dùng. HTML capture không tự đảm bảo WebGL, CORS, logo DOM và font được chụp đầy đủ. |
| C. Server render | Chưa cần thêm hạ tầng, endpoint hoặc browser server. Nếu frontend không đáp ứng thiết bị mục tiêu, phải đánh giá chi phí/vận hành/riêng tư trước khi bổ sung. |

Map export chỉ khởi tạo khi mở cửa sổ. Dùng `preserveDrawingBuffer: true` trên instance này, không thay map tương tác hiện có. Chờ style load, thêm GeoJSON sources/layers, fit bounds, rồi chờ `idle` + `loaded()` + `areTilesLoaded()`; `fadeDuration: 0`. Markers/số/nhãn đều là GL layers, không dùng DOM Marker. Dùng lại helpers `[lng,lat]`, fit khoảng longitude ngắn nhất và chia đường tại kinh tuyến 180°.

Kích thước CSS của map chia cho devicePixelRatio để giữ số pixel render hữu hạn và tạo PNG kích thước cố định. Các kích thước overlay/padding được điều chỉnh tương ứng. Không sửa global DPR. Mỗi preview/tỷ lệ/retry tạo instance Mapbox mới, có thể phát sinh map load và dữ liệu mạng theo gói Mapbox của tài khoản.

Chờ các font cần dùng qua FontFaceSet trước khi vẽ chữ; logo SDK phải decode xong. Không đưa avatar/cover URL tùy ý vào poster: nội dung bắt buộc không cần ảnh bìa, tránh đưa ảnh ngoài thiếu CORS vào canvas. Trình render từ chối trả ảnh nếu map tải lỗi, thiếu attribution, mất WebGL hoặc bị canvas SecurityError. Không dùng screenshot DOM, html2canvas, html-to-image hoặc fallback ảnh/bản đồ giả.

## Attribution và giới hạn sử dụng

Canvas WebGL không chứa logo/attribution ở DOM controls. Vì vậy compositor lấy **logo SVG gốc từ CSS Mapbox GL JS đang cài**, giữ hình và tỷ lệ; lấy đầy đủ text attribution do SDK tổng hợp từ sources sau khi map tải xong và vẽ vào dải nền trắng dễ đọc trên ảnh. Thiếu logo/credits hoặc credits quá dài đều làm export thất bại thay vì bỏ qua. Preview có thêm các liên kết Mapbox/OpenStreetMap/Improve this map.

Nguồn chính thức đã đối chiếu:

- [Mapbox Map API — preserveDrawingBuffer](https://docs.mapbox.com/mapbox-gl-js/api/map/).
- [Mapbox attribution — logo, sources và static/print](https://docs.mapbox.com/help/dive-deeper/attribution/).
- [Static/print maps và các lựa chọn API](https://docs.mapbox.com/help/dive-deeper/static-maps/).

Đây là tính năng tải PNG trong ứng dụng, không cấp phép dùng bản đồ tùy ý, không đưa ra quyền in thương mại hoặc tái phân phối dữ liệu bản đồ. Không tự upload ảnh private lên public storage. Không thay chính sách auth, cookie, API hoặc database. Không có dependency, migration hay env runtime mới; dùng NEXT_PUBLIC_MAPBOX_TOKEN hiện có.

## Kiểm thử

Từ `frontend/`:

```powershell
npm run type-check
npm run lint
node --experimental-strip-types --test tests/*.test.mjs
npm run build
# Sau build, chạy web server local có Mapbox token hợp lệ: npm run start -- --port 3330
$env:WANDERMAP_EXPORT_TEST_WEB_URL = 'http://localhost:3330'
node tests/journey-export.browser.mjs
```

Browser suite dùng Chrome với profile tạm, API fixtures được intercept hoàn toàn và không ghi database; Mapbox/WebGL/fonts và tải PNG là thật. Kiểm tra kích thước PNG, map không trống, tỷ lệ, desktop/mobile/DPR 2/dark, nhiều điểm qua antimeridian, Unicode, lỗi mạng + retry, Canvas SecurityError + retry, bản nháp chưa lưu, Escape, hủy lúc font chưa xong và cleanup. Artifacts/screenshot ở thư mục temp được in cuối suite. Đây là kiểm tra frontend, không thay thế database integration hoặc nghiệm thu Safari/Firefox/thiết bị thật.

Kết quả xác minh trên bản production local (Node 22.21.1, Chrome 155):

| Kiểm tra | Kết quả |
| --- | --- |
| Frontend type-check | Pass |
| Frontend Node tests | 27/27 pass, gồm 5 tests mới cho export |
| Frontend lint | Pass với warnings cũ ngoài các file export |
| Frontend production build | Pass |
| Chrome export suite | 7 nhóm kiểm tra pass; bao gồm focus quay về nút xuất ảnh sau Escape |
| PNG thật | 1600×1600 và 1600×2000; đã xem ảnh và screenshot desktop/mobile |
| git diff --check | Pass |

Không chạy lại backend/database integration vì không đổi API/schema/nghiệp vụ lưu dữ liệu. Chưa xác minh Safari/Firefox, thiết bị mobile thật hoặc các cấu hình GPU khác. Artifacts dùng fixture, không chứa dữ liệu tài khoản thật. Không thêm tính năng chia sẻ lên Feed ở bước này.
