# Phase 4 — Feature 4: Frontend Messaging UI

## Phạm vi

- `/messages`: danh sách cuộc trò chuyện; desktop có panel chờ chọn bên phải.
- `/messages/:conversationId`: desktop giữ hai cột; mobile chỉ hiển thị chat và nút quay lại danh sách.
- Navigation social và thanh công cụ bản đồ có mục **Tin nhắn**, badge đếm **cuộc trò chuyện** chưa đọc từ REST. Giữ các mục bản tin, khám phá, đăng bài, thông báo và hồ sơ.
- Hồ sơ người khác có nút **Nhắn tin**, tái sử dụng API tạo direct conversation duy nhất theo cặp user.

Giao diện dùng tiếng Việt, palette xanh lá và surface tokens light/dark hiện có;
không thêm thư viện, migration, biến môi trường hay socket connection mới.
Backend cần migrations 001–014 và messaging/realtime của Features 1–3.

## Danh sách và tạo cuộc trò chuyện

Sidebar có avatar, display name, preview, timestamp, unread badge và active state.
Danh sách phân trang bằng opaque cursor của backend, có nút tải thêm và trạng thái
loading, empty, lỗi API hoặc cập nhật nền thất bại.

Search lọc tên/username trong các cuộc trò chuyện đã tải, hỗ trợ tìm tiếng Việt
không dấu. Người dùng có thể tải thêm để mở rộng danh sách được tìm. Chưa có API
full-text search conversations hoặc tìm kiếm người dùng theo tên gần đúng.

Hộp **Cuộc trò chuyện mới** dùng Radix Dialog với focus trap/Escape và tra cứu
username chính xác qua `GET /users/:username`. Tạo chat qua
`POST /conversations/direct`; không tạo người dùng hoặc dữ liệu tĩnh thay thế.
Nút trên profile dùng cùng mutation và owner/session guard.

## Gửi tin và đối soát optimistic

`useMessaging.ts` dùng các query keys của Feature 3, truyền AbortSignal cho history,
detail và list. Message history dùng exclusive `before_sequence` string, giữ bigint
qua toàn bộ cache và UI, không chuyển sequence sang Number.

1. Nhấn gửi tạo một UUID `client_message_id` và local bubble pending trong store bộ nhớ.
2. REST là đường gửi duy nhất: `POST /conversations/:id/messages`.
3. Khi response hoặc socket lookup xác nhận message, UI đối soát bằng server ID và
   `(sender_id, client_message_id)`. Một message chỉ có một bubble.
4. Socket đến trước REST cũng xác nhận local entry. Entry đã xác nhận được dọn khỏi
   outbox để lần gửi nội dung giống nhau sau đó có thể là một thao tác mới.
5. Request thất bại giữ nguyên bản nháp, hiển thị failed bubble và nút **Thử gửi lại**.
   Retry dùng đúng UUID và nội dung của thao tác cũ; submit lại một draft failed chưa
   được xác nhận cũng dùng lại key đó.
6. Thành công chỉ xóa draft nếu nội dung vẫn khớp thao tác vừa gửi. Response cũ sau
   logout/đổi phiên không được ghi lại cache hoặc bản nháp của phiên mới.

Composer hỗ trợ Enter gửi, Shift+Enter xuống dòng, IME composition, Unicode và tiếng
Việt; vô hiệu hóa khi đang gửi. Tin chỉ có whitespace bị chặn. Giới hạn 4000 ký tự
khớp trim transform và giới hạn Unicode code point của backend/PostgreSQL. Nội dung quá
dài được giữ để người dùng chỉnh sửa, không tự cắt bản nháp.

`messageDraftStore.ts` không persist. AuthProvider theo dõi auth/token trên mọi route:
refresh access token thông thường giữ draft, logout hoặc đổi tài khoản/phiên xóa
toàn bộ draft và outbox. Điều hướng giữa các chat trong cùng phiên giữ draft; reload
trình duyệt không khôi phục nội dung chưa gửi.

## Cuộn, trạng thái đọc và mobile

- Mở chat cuộn về tin mới nhất. Khi đang gần cuối, tin mới tự cuộn theo.
- Đọc lịch sử cũ không bị kéo xuống; nút **Tin nhắn mới** dẫn về cuối. Indicator so
  sánh sequence committed, vẫn hoạt động nếu có local failed ở cuối hoặc đang tải older.
- Tải tin nhắn cũ giữ anchor message và pixel offset; tắt browser scroll anchoring
  trong history để tránh áp dụng bù cuộn hai lần.
- Chỉ PATCH read khi tab visible, window có focus, UI ở cuối và latest committed row
  thực sự nằm trong viewport history. Local pending không có sequence giả để mark read.
- Read receipt **Đã đọc** chỉ dựa trên `recipient_read_state` của server. Không có
  online presence, delivered receipt giả hoặc tự tăng/giảm unread từ socket payload.
- VisualViewport resize/scroll, dynamic viewport height và safe-area inset giữ composer
  trong phần màn hình nhìn thấy khi keyboard thay đổi. Header/composer ngoài vùng cuộn;
  mobile là flow danh sách → chat riêng.

Nội dung được render bằng React text nodes, không dùng `dangerouslySetInnerHTML`.
Chỉ link HTTP(S) tuyệt đối, không credentials/control characters, mới thành anchor;
tab mới dùng `noopener noreferrer nofollow`. Shared messages hiện có có thể mở resource
được REST cho phép, hoặc báo nội dung không khả dụng. Chọn và gửi shared resource
thuộc feature tiếp theo.

## Kết nối và lỗi

UI dùng transport state chung, hiển thị kết nối trực tiếp tạm gián đoạn và polling
REST mỗi 30 giây khi socket offline. Reconnect/foreground dùng reconciliation Feature 3.
Draft vẫn ở bộ nhớ trong quá trình retry; không có hàng đợi tự gửi offline.

Recipient inactive hoặc `can_send=false` có giải thích và khóa composer. Conversation
403/404 có trạng thái không khả dụng và lối về danh sách. Lỗi tải lần đầu, tải older,
metadata nền và read acknowledgment đều có trạng thái cùng thao tác thử lại phù hợp.

## Kiểm tra

Từ `frontend/`:

```powershell
node --experimental-transform-types --test --test-reporter=dot tests/*.test.mjs
npm run type-check
npm run build
# Chỉ dùng web URL local; REST và Socket.IO đều được fixture của browser test kiểm soát.
$env:WANDERMAP_TEST_WEB_URL = 'http://127.0.0.1:3109'
node tests/messaging.browser.mjs
```

`messaging-ui.test.mjs` kiểm tra validation, Unicode, dedup ba nguồn, bigint order,
read receipt, search và safe URLs. `messaging-drafts.test.mjs` chạy Zustand thật với
auth/token/effect registration được mô phỏng để kiểm tra lifecycle, owner/session guard
và cleanup; không thay thế kiểm tra React renderer.

`messaging.browser.mjs` chạy Chrome/CDP, React UI thật và Socket.IO fixture. API mutations
được chặn/đáp ứng trong test, không ghi database ứng dụng. Kiểm tra desktop/mobile,
pending trước response, socket/REST dedup, read receipt server, retry cùng key,
whitespace/4000 ký tự/Enter/Shift+Enter, scroll/older anchor, failed tail indicator,
background read, disconnect/reconnect, recipient unavailable, empty/error states,
dark theme, navigation 320 px và composer khi viewport giảm chiều cao.

Đo viewport giảm chiều cao là kiểm tra mô phỏng keyboard; chưa kiểm thử bàn phím thật
trên thiết bị iOS/Android. Delivery phía server vẫn giữ giới hạn best effort trong
một API process đã nêu ở Feature 3.

### Kết quả xác minh ngày 23/10/2026

- Frontend unit tests: **112/112 PASS**, gồm 12 model/UI helpers và 8 draft lifecycle tests mới.
- TypeScript và ESLint các file messaging mới/thay đổi: PASS. MapTopbar và các module cũ
  vẫn có các cảnh báo đã tồn tại; không thay đổi chính sách lint để bỏ qua chúng.
- Production build: PASS; `/messages` trả HTTP 200 ở cả dev và production sau build.
- Chrome browser test: **13 nhóm PASS** trên dev và production, không Runtime exception.
  Đã xem screenshots desktop/light/dark, mobile 320–390 px và reduced viewport.
- Không chạy lại backend/DB suites trong feature này vì không thay đổi backend hoặc schema.
