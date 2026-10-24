# Phase 4 — Steps 6–7: Read State, UX & Final Verification

Phạm vi: hoàn thiện messaging/share MVP trên REST NestJS, PostgreSQL và namespace
Socket.IO `/realtime` hiện có. Không thêm migration, dependency hoặc biến môi trường
cho ứng dụng. Môi trường kiểm thử: Windows, Node 22, Chrome headless và PostGIS 16.

## Step 6 — Hành vi đã hoàn thiện

- Badge navigation đếm **cuộc trò chuyện** chưa đọc; badge từng dòng đếm tin chưa đọc.
  Cả hai lấy số liệu REST; socket chỉ báo cần đồng bộ. Gửi/đọc không tự cộng trừ
  counter theo số sự kiện nhận được.
- Bubble chỉ hiện `Đã đọc` khi sequence nằm trong read cursor của người nhận đã được
  backend xác nhận. Cursor là bigint dạng string; backend không cho lùi cursor khi
  hai thiết bị đọc đồng thời.
- Chỉ gửi PATCH read khi tab hiển thị, có focus, đang ở cuối chat, lịch sử đã tải xong
  và bubble server mới nhất thực sự nằm trong viewport. GET/background/reconnect
  không tự đánh dấu đọc. Pending/failed bubble không tạo read cursor.
- Khi PATCH thất bại, giữ unread và cho thử lại; nút thử lại bị khóa nếu đang đọc tin
  cũ hoặc tab không có focus. Hủy detail GET đang chạy trước khi áp dụng read response
  để snapshot cũ không ghi đè cursor vừa xác nhận, rồi revalidate detail để không mất
  thay đổi quyền gửi đang diễn ra đồng thời. Browser test giữ/nhả hai response để
  kiểm tra trực tiếp tình huống đua này.
- Danh sách chat và người nhận chia sẻ sắp theo `last_message_at ?? created_at` giảm
  dần, giữ microsecond và UUID tie-breaker của API. Các trang bị chồng lặp giữ snapshot
  ở trang đầu thay vì để trang cũ ghi đè unread/preview mới.
- Nhớ vị trí đọc theo message key, sequence và offset trong phiên đăng nhập. Chuyển
  chat rồi quay lại giữ vị trí, báo `Tin nhắn mới` khi có tin mới ngoài màn hình;
  load older và preview thay đổi chiều cao cũng giữ anchor.
- Nếu refetch đẩy anchor ra ngoài các trang đang có, tải bù lịch sử qua REST, có
  loading/error/retry riêng và ngăn đánh dấu đọc trong lúc khôi phục. Không giữ lại
  response cũ để né kiểm tra quyền của shared content.
- Query list/detail/history/unread kiểm tra lại owner và session sau khi HTTP trả
  thành công. Response đến muộn sau logout, đổi tài khoản hoặc đăng nhập phiên mới
  bị loại; token refresh bình thường vẫn giữ dữ liệu cùng phiên.
- Empty/loading/error, gửi thất bại/retry, mất kết nối, người nhận không khả dụng,
  bạn bè/người theo dõi và shared-content tombstones tiếp tục dùng UI/API thật.

Vị trí cuộn chỉ nằm trong memory, tối đa 100 chat, xóa cùng session/drafts; không lưu
vào localStorage/sessionStorage và không phục hồi sau full reload. Tải bù tự động
giới hạn 10 trang mỗi lần mount chat để tránh kéo vô hạn lịch sử; nếu anchor đã mất
hoặc nằm ngoài giới hạn, dùng vị trí khả dụng. Người dùng vẫn có thể tải tin cũ.

## Step 7 — Kết quả xác minh

| Kiểm tra | Kết quả |
| --- | --- |
| Frontend unit tests | 136 pass: model/dedup/bigint/ordering, drafts/scroll/session, auth, share và realtime |
| Backend unit tests | 144 pass / 10 suites |
| PostgreSQL integration | 148 pass / 7 suites; áp dụng migrations 001–014 trên PostGIS riêng |
| Backend health e2e | 1 pass |
| Messaging browser fixtures | 16 nhóm kịch bản; có scroll restoration qua refetch, unread và read retry |
| Share/contact/profile browser fixtures | 13 nhóm kịch bản |
| Notifications browser regression | 10 nhóm kịch bản, gồm outage/reconnect/foreground/logout |
| Browser với backend/DB thật | 7 nhóm kịch bản; ba tài khoản, bốn tab chat trên ba phiên thiết bị, thêm phiên người ngoài |
| Typecheck/lint/build | Hai ứng dụng pass; frontend còn 6 lint warnings cũ ngoài messaging |

Các browser fixture tests giả lập REST/socket để kiểm tra lỗi và timing chủ động.
`frontend/tests/messaging-phase4.browser.mjs` bổ sung đường đi thật: đăng ký/đăng nhập,
refresh HttpOnly cookie, REST persistence, Socket.IO user rooms, database triggers
và PostgreSQL LISTEN/NOTIFY. Runner dùng local reverse proxy và chuyển địa chỉ
WebSocket đến backend test; không giả lập payload hoặc chèn access token vào UI.

Luồng thật kiểm tra A gửi B; cả hai phiên thiết bị B có unread; B mở chat trên mobile
thì cursor lưu ở DB, receipt xuất hiện ở A và badge biến mất trên desktop B. B trả
lời thì cả hai tab A nhận unread, đọc ở một tab đồng bộ tab còn lại. Có đúng một
conversation, hai message rows và một bubble cho mỗi message. Tài khoản C không
thấy conversation và bị 404 khi giả mạo detail/history/send.

Hồi quy Phase 3 với backend thật: C follow B tạo notification từ SQL trigger, hai
thiết bị B cập nhật bell/list qua socket; đánh dấu tất cả đã đọc qua UI đồng bộ cả
hai thiết bị. Notification unread và messaging unread độc lập.

Đã xem screenshots desktop/mobile, kiểm tra layout không tràn ngang và browser
không có runtime/hydration exceptions trong các lượt kiểm tra cuối.

## Security review

| Ranh giới | Mã nguồn / bằng chứng kiểm thử |
| --- | --- |
| REST authentication và IDOR | Guard JWT active cho mọi endpoint; membership trước list/detail/history/single-message/send/read; outsider tests trả 404 |
| Quyền gửi | Mutual follows, active accounts, block hai chiều; pair/account locks dùng chung với follow/unfollow; server suy ra sender từ JWT |
| Duplicate/concurrency | Unique canonical pair + sender/client UUID; đồng thời retry chỉ một row/event; payload khác cùng key bị conflict; transaction rollback không phát sự kiện |
| Read/cursor | DTO whitelist, sequence hợp lệ và tồn tại trong đúng conversation; monotonic cursor theo participant; concurrent-device/read-later-send tests |
| Share privacy | Server resolve resource, kiểm tra cả sender/recipient, kiểm tra lại visibility khi đọc; private/deleted/inactive trở thành tombstone; không nhận client preview metadata |
| Socket | JWT/origin/expiry/active-account checks, room suy ra từ JWT; client không join room khác hoặc tạo/giả mạo message/read events |
| Nội dung và credentials | Render text, URL chỉ HTTP(S) hợp lệ; không dangerouslySetInnerHTML; access token memory, refresh cookie HttpOnly/path/SameSite được kiểm tra qua CDP; không có token trong browser storage |
| Cache/session | Per-viewer keys, hủy/reset khi đổi session; thử successful delayed response sau logout/account switch/same-user new login |
| Abuse/errors | Global throttle + sender rate limit; DTO giới hạn Unicode; SQL có tham số; API error envelope không lộ SQL/message content; event không chứa private preview |

Không phát hiện lỗi bảo mật chặn hoàn thành MVP trong phạm vi review này. Đây là
review mã nguồn và kiểm thử tự động; không phải một đợt pentest độc lập.

## Chạy lại

Chạy trong `backend/`:

```powershell
npm run type-check
npm run lint
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run build
# Chỉ trỏ tới database kiểm thử PostgreSQL/PostGIS riêng.
$env:WANDERMAP_TEST_DATABASE_URL = 'postgresql://TEST_USER:TEST_PASSWORD@127.0.0.1:5548/wandermap_integration_test'
npm run test:db
```

Chạy trong `frontend/`, Node 22 trở lên:

```powershell
npm run type-check
node --experimental-transform-types --test --test-reporter=dot tests/*.test.mjs
npm run lint
npm run build
```

`lint` đã đổi từ `next lint` không được Next 15 hỗ trợ sang `eslint src`. Sáu warning
cũ nằm ở MapTopbar (aria/img), PostFeedClient (unused), useDebounce và lib/mapbox
(any); không có lint error.

Sau build, giữ một Next production server riêng (không build lại khi server đó đang
phục vụ `.next`). Với messaging/notification fixtures, chỉ định URL local rõ ràng:

```powershell
$env:WANDERMAP_TEST_WEB_URL = 'http://127.0.0.1:3214'
node tests/messaging.browser.mjs
node tests/notifications.browser.mjs
node tests/messaging-share.browser.mjs # Tự khởi động Next riêng.
```

Smoke test thật tự khởi động/dừng backend, Next, gateway và Chrome. Cần Chrome ở
đường dẫn mặc định hoặc `WANDERMAP_BROWSER_PATH`, backend đã build và **một DB local
rỗng mới có tên kết thúc `_test`** cho mỗi lượt chạy:

```powershell
$env:WANDERMAP_TEST_DATABASE_URL = 'postgresql://TEST_USER:TEST_PASSWORD@127.0.0.1:5548/wandermap_browser_test'
node tests/messaging-phase4.browser.mjs
```

Runner từ chối DB có bảng ứng dụng, áp dụng migrations bằng runner chuẩn, chỉ tạo
tài khoản `@example.test`, giữ DB để điều tra và không DROP/TRUNCATE/reset dữ liệu.
Không dùng `DATABASE_URL` mặc định của ứng dụng. Screenshots/log fixture nằm trong
thư mục temp do runner in ra.

## Giới hạn còn lại

- Multi-device đã kiểm tra bằng các browser context/cookie jar độc lập và viewport
  desktop/mobile Chrome; chưa chạy trên điện thoại iOS/Android vật lý hoặc Safari.
- Messaging socket publisher hiện phục vụ một backend instance. Chưa có distributed
  adapter/outbox/replay; socket là best effort, REST/reconnect/foreground phục hồi dữ
  liệu bền vững. Không coi đây là xác minh triển khai nhiều backend instances.
- Không thêm presence/typing/group chat/push notifications hoặc moderation UI trong
  hai bước này. Block/rate limit backend có sẵn; các mở rộng đó vẫn ngoài MVP.
