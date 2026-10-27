# Smoke tests — private Mốc B

Ghi commit/artifact, host/origin, thời gian, browser/device và kết quả thực tế. Local/unit/CI/cloud là các mức kiểm chứng khác nhau; ô trống là NOT VERIFIED, không phải PASS.

## Runtime và data

- [ ] Backend Node 22 đạt patch tối thiểu 22.23.4, start compiled output; một instance/process.
- [ ] Production DB mới trống, PostgreSQL/PostGIS/extensions/TLS và connection budget đúng; không có dữ liệu development.
- [ ] Canonical 001–016 có checksum đúng; migrate một lần, lần hai no-op, status 0 pending.
- [ ] Search `da lat`, `ĐÀ LẠT`, `da nang`, typo ranking đúng; viewport/anti-meridian và visited/Journey hoạt động.
- [ ] Health 200; DB unavailable trả 503 không connection string/stack. SIGTERM ngắt socket/drain hợp lý, restart phục hồi qua REST.
- [ ] Swagger disabled production; logs có request ID nhưng không JWT/cookie/password/SQL/private content.

## Auth và proxy

- [ ] Register/login/get-me/logout đúng; access token chỉ memory, refresh chỉ HttpOnly cookie/hash.
- [ ] Vercel rewrite forward Set-Cookie; host frontend, Path=/api/v1/auth, Secure, SameSite=Lax, expiry và clear đúng.
- [ ] Refresh rotation không race khi REST/socket đồng thời 401, nhiều tab restore, account switch và logout trong lúc refresh.
- [ ] Hai người dùng không nhận dữ liệu/cache của nhau; response 200/401/404 không shared-cache.
- [ ] Origin xấu/preflight bị xử lý đúng; preview không được allow tuỳ ý.
- [ ] TRUSTED_PROXY_CIDRS khớp measured peer chain; hai client không bị gom rate limit, forged X-Forwarded-For không bypass được.

## Media bytes và UI

- [ ] Avatar, Post grid/feed/detail/lightbox, Journey cover/poster và share cards đọc được managed images.
- [ ] Cloudinary upload authenticated; unsigned original/derived URLs bị từ chối, signed provider URL không có trong API JSON/browser traffic.
- [ ] Upload chưa gắn resource: chỉ owner xem được; anonymous/outsider canonical URL 404.
- [ ] Private Post: owner đọc được; follower/outsider/anonymous 404. Followers Post: chỉ owner và followers hợp lệ đọc được.
- [ ] Private/draft Journey cover chỉ owner xem; public+published xem được; chuyển private hoặc draft chặn request mới.
- [ ] Public→private, unfollow, xoá resource và inactive user không để lại đường đọc bytes mới qua cache/optimizer/provider URL.
- [ ] Không thể gắn canonical asset của người khác vào Post/Journey/avatar để public hoá nó; URL fake host/missing asset bị từ chối.
- [ ] Session switch/logout huỷ requests và private Blob URLs, không hiển thị ảnh tài khoản trước. Đã tải xuống bytes không thể thu hồi khỏi thiết bị.
- [ ] SVG, MIME giả, corrupt image, pixel/file quá giới hạn bị từ chối; WebP không EXIF/GPS.
- [ ] Multipart gần 9–10 MiB qua Vercel external rewrite đạt hoặc trả 413 rõ ràng; không suy diễn từ Function limit.
- [ ] Production không có legacy `/uploads` route hoặc local persistence dependency; không chuyển development media.

## Phase 1–4

- [ ] Profile editing, username/avatar crop và cancel; feed like/save/comment/reply không regression.
- [ ] My Travel Map, visited dates/privacy, Journey Builder/reorder/save/publish hoạt động.
- [ ] Journey PNG 1:1/4:5, fonts tiếng Việt, WebGL, download, Mapbox logo và attribution đúng; token restricted origins hợp lệ.
- [ ] Notifications/unread/read-all đồng bộ nhiều tab, listener mất kết nối dùng REST fallback rồi phục hồi.
- [ ] Messaging mutual follow/block/membership, sender spoof rejection, idempotency, read receipts và shared resource permissions đúng.
- [ ] Một socket lifecycle; reconnect/network offline/backend restart/JWT expiry không nhân đôi message hoặc mất trạng thái REST.
- [ ] Desktop/mobile, light/dark, clipboard, upload/download và keyboard interactions đạt kiểm tra browser thật.

## Release gate

- [ ] GitHub Actions của commit triển khai xanh, DB suites không skip; dependency audits sạch hoặc residual risks đã được người dùng duyệt.
- [ ] Cloudinary/proxy/cookie/WSS/Mapbox checks có bằng chứng trên deployment thật, không dùng kết quả mocked provider thay thế.
- [ ] Đã review rollback và diễn tập restore; giới hạn audience private ở cả frontend/backend trước mở rộng.
