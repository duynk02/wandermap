# Profile Editing — Báo cáo Bước 3

Ngày kiểm tra: 20/10/2026. Phạm vi: chỉnh sửa avatar/tên/username/bio/thành phố,
crop avatar; không bao gồm website, ảnh bìa hoặc Feed Lightbox.

## Kết quả lần kiểm thử Bước 3

Bảng dưới ghi nhận lần kiểm thử ban đầu. Việc xử lý hai blocker được cập nhật
ở cuối tài liệu.

| Kiểm tra                                     | Kết quả                                                                                             |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Backend type-check                           | Đạt                                                                                                 |
| Backend unit tests                           | 7 suites, 47 tests đạt                                                                              |
| Backend HTTP e2e, database giả lập           | 2 suites, 27 tests đạt                                                                              |
| Backend build                                | Đạt                                                                                                 |
| Frontend type-check                          | Đạt                                                                                                 |
| Frontend validation/crop tests               | 12 tests đạt                                                                                        |
| API + Chrome headless, PostgreSQL local thật | 14 nhóm kiểm tra đạt                                                                                |
| Lint các file Profile/crop và test mới       | Đạt                                                                                                 |
| Frontend lint toàn ứng dụng                  | Đạt, còn 11 warnings ngoài phạm vi Profile                                                          |
| Backend lint toàn ứng dụng                   | Không đạt: 6 import không sử dụng có sẵn trong `backend/src/auth/auth.controller.ts`                |
| Frontend production build                    | Biên dịch và type-check qua; prerender dừng tại `/auth/login` vì `useSearchParams()` thiếu Suspense |
| Migrations                                   | 001–006 đã áp dụng, checksum hợp lệ, không có migration chờ                                         |

Chưa thể kết luận build/lint toàn repository đều đạt. Không sửa các lỗi có sẵn
ngoài phạm vi Profile Editing trong bước kiểm thử này.

## Đã xác minh trên luồng thật

- API từ chối request không đăng nhập, tên trắng, username sai định dạng và các trường
  `id`, `role`, `website`, `cover_url`; HTTP e2e kiểm tra thêm tài khoản inactive,
  access token hết hạn, `password`, `email`, giới hạn độ dài và URL avatar không hợp lệ.
- PostgreSQL từ chối username trùng không phân biệt hoa/thường, trả `USERNAME_TAKEN`.
  Thử cập nhật không làm thay đổi hồ sơ tài khoản khác.
- Tên/bio/thành phố được trim, lưu và xóa chính xác; response cập nhật không có email/website.
- Chỉ hồ sơ của chính mình có nút chỉnh sửa. Form nạp thông tin hiện tại,
  giữ focus trong dialog, khóa scroll nền và trả focus khi đóng.
- Tên trắng và username trùng có lỗi tại trường; dữ liệu nháp được giữ.
  Xác nhận bỏ thay đổi có cả hành vi tiếp tục sửa và bỏ bản nháp.
- Ảnh quá 10 MB hoặc không giải mã được bị từ chối. Hủy crop giữ avatar trước đó.
- Crop có zoom, đặt lại, kéo chuột, phím mũi tên và kéo cảm ứng; chưa upload khi mới áp dụng.
- Upload lỗi hoặc PATCH lỗi giữ dữ liệu và dialog. Retry PATCH dùng lại ảnh đã upload;
  bấm lưu lặp khi pending không gửi thêm request.
- Ảnh đã lưu là WebP vuông, đúng kích thước vùng cắt, không có EXIF; tên/avatar trên Profile
  cập nhật, username mới đổi URL; reload và Navbar dùng thông tin mới. Xóa avatar được lưu.
- Một JWT hết hạn thật tạo đúng một request refresh rồi retry cập nhật thành công.
  Nếu refresh thất bại, dialog giữ bản nháp, nút lưu bị khóa, database không nhận thay đổi.
- Local storage chỉ chứa profile công khai; không chứa token/password/email.
  Refresh cookie là HttpOnly và không xuất hiện trong `document.cookie`.
- Dialog/crop nằm trong viewport desktop và mobile mô phỏng 390×844; không tràn ngang.
  Không ghi nhận exception JavaScript trong luồng kiểm thử.

## Chạy lại

Backend, từ `backend/`:

```sh
npm run type-check
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run lint
npm run build
npm run db:migrate:status
```

Frontend, từ `frontend/` (runner test `.ts` trực tiếp cần Node.js 22+):

```sh
npm run type-check
node --experimental-strip-types --test tests/avatar-crop.test.mjs tests/profile-validation.test.mjs
npm run lint
node tests/build-snapshot.mjs
node tests/profile-editing.live.mjs
```

`build-snapshot.mjs` build cùng mã nguồn trong `frontend/build/profile-build-*`, dùng
dependency đã cài và tự dọn bản sao; giữ nguyên `.next` của dev server đang chạy.
Thư mục build tạm nằm cùng ổ đĩa với ứng dụng để tránh lỗi đường dẫn Windows.

Live tests cần web/API/PostgreSQL local đang chạy (mặc định 3000/4000), `backend/.env`
được cấu hình và Chrome hoặc Edge. Có thể chỉ định `WANDERMAP_TEST_BROWSER`,
`WANDERMAP_TEST_WEB`, `WANDERMAP_TEST_API` cho môi trường local tương ứng.
Runner dùng tài khoản có email ngẫu nhiên riêng và browser profile tạm; dọn đúng các
tài khoản, session, ảnh thử và thư mục tạm của lần chạy, không thay đổi tài khoản có sẵn.
Không in JWT, cookie, mật khẩu hoặc DATABASE_URL.

## Giới hạn

- Phiên browser được chuẩn bị qua API login thật và hint profile công khai; AuthProvider
  khôi phục access token bằng cookie khi điều hướng. Đây là kiểm thử Profile, không nghiệm
  thu thao tác form/redirect của trang Login hoặc Register.
- Mobile là mô phỏng Chrome; chưa xác minh trên điện thoại thật, Safari/iOS hay screen reader.
- Node có cảnh báo `MODULE_TYPELESS_PACKAGE_JSON` khi chạy trực tiếp các file TypeScript;
  cảnh báo không làm test thất bại và không cần đổi cấu hình module của ứng dụng.
- Ảnh chụp kiểm tra: `frontend/build/profile-test-artifacts/profile-crop-mobile.png`
  (artifact local được Git bỏ qua).

Dừng sau Bước 3; chưa triển khai Feed Image Lightbox.

## Cập nhật xử lý hai blocker

Đã áp dụng theo yêu cầu tiếp theo của người dùng:

- Xóa sáu import không sử dụng trong `backend/src/auth/auth.controller.ts`, không đổi endpoints hoặc auth flow.
- Bọc `LoginForm` trong React `Suspense` tại `frontend/src/app/auth/login/page.tsx`, có fallback tiếng Việt.
  Giữ page là Server Component và giữ logic đọc query `next` trong form.
- Trang register không dùng `useSearchParams()` nên không cần sửa.

Sau thay đổi: backend type-check đạt; 27 HTTP e2e đạt; lint riêng trang login đạt.
Hai lệnh lint toàn backend và production build frontend đã bị từ chối cấp quyền
thực thi, nên chưa có kết quả chạy lại sau sửa. Chưa thể xác nhận hai kiểm tra này
đã đạt dù đã áp dụng thay đổi mã nguồn tương ứng.
