# Media delivery và privacy — thiết kế Mốc A

Quyết định đã được cung cấp: Cloudinary, bảo vệ bytes của private Posts/Journeys, production DB trống. Thiết kế này được ghi trước implementation schema/provider.

- `media_assets` ghi owner, provider, storage key/version, kích thước và canonical URL. Canonical URL là API URL ổn định, không phải signed URL hoặc Cloudinary URL.
- Upload giữ JWT auth, limits, Sharp/WebP/metadata stripping. Mỗi upload tạo asset ID riêng; không chia sẻ asset record bằng content hash giữa các owners.
- Cloudinary upload dùng delivery type `authenticated`, server-signed upload; không unsigned preset. Original và derived assets không được public tự động. Signed delivery URLs chỉ dùng server-to-provider.
- `GET /api/v1/media/:id` dùng optional bearer auth rồi kiểm tra owner hoặc resource reference còn có quyền xem: avatar public của active owner, Post theo public/followers/private và Journey gate hiện có, Journey public+published hoặc owner, itinerary theo quyền hiện có. Không có resource reference hợp lệ thì anonymous/outsider nhận 404. Owner được preview upload chưa gắn resource.
- Mọi lần đọc managed media đi qua backend; không redirect sang URL provider. `Cache-Control: private, no-store`, CDN/no-store và không ETag/immutable. Khi visibility thay đổi, request mới được kiểm tra lại. Bytes đã tải xuống trước đó không thể bị thu hồi khỏi thiết bị người nhận.
- Bảng media cùng các field URL đã có là quan hệ asset–resource; DB triggers kiểm tra owner khi gắn managed media, ngăn người khác copy canonical URL vào resource public để mở quyền. Không sửa migrations 001–014. Production Posts/Journeys chỉ chấp nhận managed media mới; không nhập development/legacy URLs.
- Frontend tái sử dụng API client/shared refresh để đọc Blob; token không nằm trong URL/storage. Image wrapper dùng Blob URL trong memory, tách query theo viewer/session, cleanup/cancel khi logout/account switch/unmount. Không đưa managed private media qua Next Image optimizer/CDN cache.
- Local provider mới lưu trong `.private` bên dưới upload root, static legacy route có dotfiles deny và bị tắt ở production. Legacy `/uploads` cũ chỉ giữ tương thích development; chúng vẫn public và không được tự migrate, xóa hoặc mô tả là private.
- Cloudinary SDK, access control, timeout và credential config được test bằng mocks, không gọi provider thật trong Mốc A. Real-provider integration và Render/Vercel headers/transport phải kiểm chứng trong private Mốc B trước public release.

Tradeoff: proxy bytes qua backend tăng bandwidth so với redirect CDN. Đây là lựa chọn để bảo đảm authorization tại mỗi request và đổi visibility không để lại bearer delivery URL. Public resources vẫn truy cập bằng HTTPS API URL; chưa bật immutable public CDN cache cho URL có thể đổi privacy. Cùng một asset được owner chủ động gắn cả resource public và private sẽ đọc được qua resource public; upload riêng tạo asset ID riêng.
