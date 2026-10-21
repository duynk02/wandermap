# WanderMap Phase 1 — Tổng hợp Bước 7

Ngày tổng hợp: 20/10/2026. Nguồn: mã nguồn hiện tại và kết quả kiểm tra đã ghi nhận trong Bước 3–4. Bước này chỉ tổng hợp, không thực hiện thay Bước 5–6.

## Trạng thái bàn giao

| Bước | Trạng thái |
| --- | --- |
| 1. Khảo sát và kế hoạch | Đã thực hiện |
| 2. Profile Editing | Đã triển khai; loại ảnh bìa và website theo yêu cầu, bổ sung crop avatar |
| 3. Kiểm thử Profile Editing | Đã thực hiện; kết quả và giới hạn ở bên dưới |
| 4. Feed Image Lightbox | Đã triển khai, type-check và lint các file thay đổi đạt |
| 5. Kiểm thử Lightbox | Chưa thực hiện kiểm thử tương tác/nghiệm thu |
| 6. Tích hợp, responsive, regression | Chưa thực hiện đợt kiểm tra tổng thể sau khi thêm Lightbox |
| 7. Tổng hợp | Tài liệu này |

Hai tính năng đã có mã triển khai. Chưa đủ kết quả để xác nhận toàn bộ Phase 1 đã nghiệm thu hoặc sẵn sàng production.

## Profile Editing

- Người dùng chỉnh sửa hồ sơ của mình: avatar, tên hiển thị, username, bio và thành phố. Giữ gradient, thống kê và các tab hiện có; không có ảnh bìa hoặc trường website trong UI/API chỉnh sửa.
- Dialog có validation, lỗi cạnh trường, xác nhận bỏ thay đổi và giữ bản nháp khi upload/lưu thất bại. Chỉ thông báo thành công sau phản hồi API.
- Chọn avatar rồi crop vuông với preview tròn: kéo căn chỉnh, zoom 1–4, đặt lại, áp dụng hoặc hủy. Ảnh crop được upload khi lưu hồ sơ.
- Sau lưu, cập nhật profile/auth state và cache liên quan; Navbar nhận tên/avatar mới. Đổi username cập nhật URL Profile.
- Backend chỉ cập nhật tài khoản được xác thực, whitelist trường, trim dữ liệu và trả `USERNAME_TAKEN` khi username trùng. Giữ cơ chế access token trong memory và refresh cookie HttpOnly.

Các file chính: `frontend/src/components/profile/{ProfileHeader,EditProfileDialog,AvatarCropDialog}.tsx`, `frontend/src/lib/utils/avatarCrop.ts`, `frontend/src/lib/api/users.ts`, `frontend/src/lib/validations/index.ts`, `frontend/src/types/index.ts`; `backend/src/users/{users.controller,users.service}.ts`, `backend/src/users/dto/update-profile.dto.ts`, `backend/src/auth/auth.service.ts`.

## Feed Image Lightbox

- Nhấn ảnh trong gallery mở đúng index, không điều hướng hoặc chủ động invalidate/refetch Feed. Một Lightbox dùng chung tại `FeedList`, nhận toàn bộ ảnh kể cả phần vượt quá bốn ảnh đang hiển thị.
- Overlay đen 90%, ảnh giữ tỷ lệ, bộ đếm, chuyển ảnh quay vòng bằng nút/phím/vuốt ngang. Bài một ảnh ẩn điều hướng.
- Đóng bằng Close, Escape hoặc vùng nền ngoài ảnh. Radix Dialog cung cấp Portal, focus trap và khóa cuộn; trả focus về nút mở với `preventScroll`.
- Có loading, lỗi/thử lại, preload tối đa hai ảnh liền kề và reduced motion. Giữ các tương tác còn lại của bài đăng.
- Dùng URL ảnh sẵn có; chất lượng xem lớn phụ thuộc ảnh đã lưu. Không bổ sung pinch-to-zoom.

File thêm: `frontend/src/components/ui/ImageLightbox.tsx`. File sửa: `frontend/src/components/feed/FeedList.tsx`, `frontend/src/components/feed/FeedPostCard.tsx`.

Các hành vi Lightbox trên mô tả implementation; chưa được xác minh bằng bộ kiểm thử trình duyệt ở Bước 5.

## API, migration và cấu hình

- Tái sử dụng `PATCH /api/v1/users/me`; đồng bộ dữ liệu profile với các API đọc hồ sơ và response auth. Tái sử dụng upload hiện có, không tạo API dành riêng cho Lightbox.
- Migration `backend/src/database/migrations/006_profile_editing.sql` bổ sung `home_city` và `website`. Theo lần kiểm tra Bước 3, migrations 001–006 đã áp dụng, checksum hợp lệ, không có migration chờ.
- Website đã bị loại khỏi chức năng theo yêu cầu; cột `website` không sử dụng vẫn được giữ trong database vì migration 006 đã áp dụng. Không sửa lại migration cũ hoặc xóa dữ liệu.
- Không thêm dependency, dịch vụ hoặc biến môi trường mới. Môi trường khác cần áp dụng migration 006 bằng runner hiện có trước khi dùng mã Profile mới.

## Kết quả kiểm tra đã ghi nhận

| Kiểm tra | Kết quả |
| --- | --- |
| Backend type-check, build tại Bước 3 | Đạt |
| Backend unit tests | 7 suites, 47 tests đạt |
| Backend HTTP e2e, database giả lập | 2 suites, 27 tests đạt |
| Frontend type-check | Đạt tại Bước 3 và Bước 4 |
| Frontend validation/crop | 12 tests đạt |
| API + Chrome headless + PostgreSQL local thật, Profile | 14 nhóm kiểm tra đạt |
| Lint file Profile/crop/test mới và ba file Lightbox/Feed | Đạt |
| Lint frontend toàn ứng dụng tại Bước 3 | Đạt, còn 11 cảnh báo ngoài phạm vi Profile |
| Backend lint toàn ứng dụng | Lần đầu lỗi sáu import thừa; đã sửa mã, chưa có kết quả chạy lại toàn backend |
| Frontend production build | Lần đầu dừng prerender `/auth/login`; đã bọc `LoginForm` bằng Suspense, chưa có kết quả build lại |
| Kiểm thử Lightbox và regression tổng thể | Chưa thực hiện Bước 5–6 |

Hai sửa lỗi build/lint nằm tại `backend/src/auth/auth.controller.ts` và `frontend/src/app/auth/login/page.tsx`. Sau sửa, backend type-check, 27 HTTP e2e và lint riêng trang login đạt. Lệnh lint toàn backend và build frontend chưa được xác minh lại do yêu cầu quyền thực thi trước đó bị từ chối.

Các kiểm tra Profile bao gồm quyền sở hữu, username trùng, validation, upload/lưu lỗi giữ bản nháp, crop, đồng bộ Navbar/Profile, reload, refresh token và mobile mô phỏng. Đây không phải coverage toàn bộ ứng dụng; HTTP e2e dùng database giả lập, còn live tests dùng PostgreSQL thật. Mobile chưa xác minh trên thiết bị thật, Safari/iOS hoặc screen reader; live Profile tests không nghiệm thu thao tác form Login/Register.

## Phần còn lại để nghiệm thu

1. Bước 5: xác minh Lightbox mở đúng index/`+N`, chuyển và đóng ảnh, focus trap/restoration, khóa cuộn và giữ vị trí Feed, ảnh một/nhiều/lỗi, swipe trên cảm ứng.
2. Bước 6: kiểm tra tích hợp, responsive, light/dark theme và regression các thao tác Like/Comment/Follow/chi tiết bài/địa điểm, lưu bài ở các luồng đang có và infinite scroll.
3. Chạy lại backend lint và frontend production build sau hai sửa lỗi; chưa kết luận hai blocker đã được giải quyết hoàn toàn bằng kết quả thực thi.

## Tài liệu và công cụ kiểm tra

- [Báo cáo Profile Editing](profile-editing-test-report.md): kết quả, giới hạn và lệnh chạy lại.
- [Bàn giao Lightbox](feed-image-lightbox.md): implementation và phạm vi kiểm tra Bước 4.
- Backend: `backend/src/users/users.service.spec.ts`, `backend/test/profile-editing.e2e-spec.ts`.
- Frontend: `frontend/tests/avatar-crop.test.mjs`, `frontend/tests/profile-validation.test.mjs`, `frontend/tests/profile-editing.live.mjs`, `frontend/tests/helpers/local-browser.mjs`, `frontend/tests/build-snapshot.mjs`.

Bước 7 không chạy lại tests/build, không thay đổi mã tính năng, không commit hoặc triển khai ứng dụng.
