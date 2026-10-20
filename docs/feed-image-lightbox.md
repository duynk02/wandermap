# Feed Image Lightbox — Bước 4

## Phạm vi triển khai

- `frontend/src/components/ui/ImageLightbox.tsx`: component tái sử dụng, dùng Radix Dialog Portal, focus trap và khóa cuộn nền. Nhận `images`, `initialIndex`, `isOpen`, `onClose` và phần tử cần trả focus khi đóng.
- `frontend/src/components/feed/FeedList.tsx`: giữ một phiên Lightbox duy nhất cho toàn bộ Feed, lưu danh sách ảnh và nút đã mở. Mở/đóng không điều hướng, invalidate query hoặc remount danh sách bài đăng.
- `frontend/src/components/feed/FeedPostCard.tsx`: đổi ảnh từ link sang button, ngăn click lan lên parent. Giữ nguyên bố cục tối đa bốn ảnh và lớp `+N`; Lightbox nhận toàn bộ danh sách ảnh. Nút “Xem chi tiết” vẫn đi tới bài đăng.

## Hành vi đã triển khai

- Nền đen 90%, ảnh căn giữa giữ tỷ lệ, bộ đếm, hiệu ứng hiện ảnh ngắn và hỗ trợ reduced motion.
- Previous/Next, ArrowLeft/ArrowRight và vuốt ngang. Điều hướng quay vòng ở hai đầu; bài một ảnh ẩn điều hướng.
- Đóng bằng nút Close, Escape hoặc chạm nền ngoài ảnh. Dùng `preventScroll` khi đặt/trả focus; Radix quản lý khóa cuộn và focus trap.
- Loading, lỗi ảnh và thử lại; danh sách rỗng không mở overlay. Chỉ preload tối đa hai URL ảnh liền kề, dọn preload khi chuyển ảnh/đóng.
- Dùng URL ảnh hiện có từ API. Chất lượng phóng lớn phụ thuộc ảnh gốc đã lưu; không tạo URL độ phân giải cao giả định. Không bổ sung pinch-to-zoom.
- Không thay đổi API, backend, database, dependency hoặc environment.

## Xác minh và bước tiếp theo

- Đã chạy thành công `npm run type-check` tại `frontend/`.
- Đã chạy ESLint riêng `ImageLightbox.tsx`, `FeedList.tsx`, `FeedPostCard.tsx`, không có lỗi/cảnh báo.
- Rà soát diff, không có lỗi khoảng trắng trong phần thay đổi.
- Chưa chạy build hoặc kiểm thử trình duyệt/nghiệm thu Lightbox. Phần đó thuộc Bước 5: kiểm tra index và `+N`, một/nhiều/ảnh lỗi, phím và focus trap/restoration, cuộn nền/vị trí Feed, vuốt cảm ứng và các tương tác bài đăng.
