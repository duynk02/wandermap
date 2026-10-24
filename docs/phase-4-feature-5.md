# Phase 4 — Feature 5: Share Content

## Phạm vi và các lối vào

Share Dialog dùng chung cho một người nhận mỗi lần, recent conversations có phân
trang, lọc tên/username, tra username chính xác, preview và lời nhắn tùy chọn.
Sau khi server xác nhận, dialog báo thành công và có link mở chat. Việc gửi không
tự chuyển trang khỏi Feed, Post Detail, Map/Explore hoặc Journey Detail.

Các action đã nối:

- PostCard, FeedPostCard, Post Detail và grid bài chia sẻ hành trình: `shared_post`.
- Location Detail và Location Drawer trên bản đồ: `shared_location`.
- Journey Detail: `shared_journey`; giữ riêng chức năng **Chia sẻ lên Feed** hiện có.

Share button chờ khôi phục phiên đăng nhập trước khi hoạt động. Khách dùng auth UX
hiện có để đăng nhập. Nguồn private hoặc journey chưa public/published có giải thích
và khóa gửi; backend vẫn kiểm tra lại tại thời điểm request.

## Hợp đồng và idempotency

Tái sử dụng REST `POST /conversations/:id/messages` và namespace `/realtime` của
Features 2–3. Không có endpoint tạo message thứ hai, socket send handler hoặc
client preview metadata trong payload:

```json
{
  "client_message_id": "<UUID>",
  "message_type": "shared_post",
  "shared_resource_id": "<post UUID>",
  "content": "Lời nhắn tùy chọn"
}
```

Người nhận mới được resolve bằng `POST /conversations/direct`, dựa vào unique pair
đã có trong DB. Chọn recent conversation kiểm tra lại `GET /conversations/:id` trước
khi gửi. Account/block/membership/resource policy cuối cùng được backend thực thi
trong cùng transaction tạo message.

Điều kiện gửi mới hiện bao gồm theo dõi qua lại. Dialog cũng có mutual contacts
chưa từng chat; xem [cập nhật chính sách và danh sách theo dõi](phase-4-mutual-follow.md).

`useShareContent.ts` giữ payload/key cho failed hoặc pending attempt trong
`messageDraftStore`, chỉ ở bộ nhớ và trong cùng auth session. Retry sau mất response
giữ nguyên UUID, resource và caption; chọn lại cùng người bằng recent chat hoặc
username cũng dùng chung attempt. Success dọn attempt để lần gửi chủ ý tiếp theo có
UUID mới. Chỉnh caption tạo operation mới. Logout/đổi tài khoản hoặc phiên xóa
attempts, token refresh thông thường giữ lại.

Response REST và socket lookup đối soát bằng server ID hoặc
`(sender_id, client_message_id)` qua helper Feature 3. Chỉ message projection từ REST
được ghi vào cache; preview nguồn trong dialog không được sao chép vào lịch sử chat.
Không tạo cache lịch sử chỉ có một row với cursor/hasMore giả khi history chưa tải.
Owner/session được kiểm tra trước/sau các await để response phiên cũ không gửi tiếp
hoặc ghi dữ liệu vào phiên mới.

## Thẻ nội dung trong chat

`SharedContentCard.tsx` hiển thị:

- Bài viết: thumbnail, tác giả, caption preview, địa điểm nếu có; mở Post Detail.
- Địa điểm: tên, địa chỉ và category; mở Location Detail hoặc **Xem trên bản đồ**.
- Hành trình: cover, tác giả, tên; mở Journey Detail.

Nút bản đồ resolve tọa độ hiện tại qua location API, dùng map store và route Explore
hiện có. Message chỉ giữ reference, không tin tọa độ/tên từ payload client; không
mở Google Maps. Ảnh lỗi có fallback. Observer theo dõi cả content và viewport history
để ảnh/preview thay đổi chiều cao vẫn giữ ở cuối nếu người dùng đang đọc tin mới.

Nội dung được render bằng React text nodes. URL ảnh chỉ dùng HTTP(S) an toàn. Thẻ
unavailable không có title/author/image/link cũ. Khi history đang được revalidate
hoặc lỗi, thẻ không hiển thị cached preview; mở lại chat hoặc quay lại tab luôn
refetch history để kiểm tra lại quyền.

## Quyền xem và giới hạn caption

Tái sử dụng policy đã có ở backend:

- Post tồn tại, tác giả active, sender và recipient đều được `postAccess` cho xem.
  Followers-only cần đủ quyền của cả hai; post của journey còn phụ thuộc journey
  public/published.
- Location phải tồn tại. Locations hiện chưa có visibility/private policy riêng;
  tính năng không thêm hoặc giả định cờ private cho location.
- Journey có owner active và phải public/published cho người dùng khác.
- Membership, account active và messaging blocks được kiểm tra tại backend.
- Projection mỗi REST request kiểm tra lại visibility/resource tồn tại theo viewer;
  resource bị xóa hoặc mất quyền chỉ trả `available:false` cùng metadata null.

DTO whitelist từ chối metadata preview/tọa độ giả do client gửi. Shared reference
đã xóa vẫn có thể replay cùng key như Features 1–2, nhưng projection trả tombstone.
Không lưu snapshot preview vào bảng messages và không sửa migrations đã áp dụng.

Caption trim, tối đa 4000 Unicode code points theo PostgreSQL `char_length`.
Feature này sửa chênh lệch cũ giữa validator.js và database với variation selectors:
API dùng Unicode regex cùng giới hạn, frontend đếm code points. Ví dụ 2000 ký tự
`🗺️` có 4000 code points; 2001 ký tự được trả 400 trước INSERT, thay vì lỗi DB 500.
Áp dụng cùng validation cho text messages để contract nhất quán.

## Triển khai và kiểm thử

Không có migration, dependency hay env mới. Backend/database cần migrations 001–014;
runner vẫn dùng checksum/advisory lock/transactions hiện có. Frontend dev và production
build giữ output riêng như Feature 4.

Từ `frontend/`:

```powershell
node --experimental-transform-types --test tests/*.test.mjs
npm run type-check
npm run build
node tests/messaging-share.browser.mjs
```

Browser runner mới tự khởi động Next production server ở port local trống và fixture
API cho SSR/REST/Socket.IO, dùng Chrome/CDP, chặn mutations ngoài fixture và tự dọn
tiến trình. Không đọc/ghi database ứng dụng. Test kiểm tra Feed/Post Detail,
Location Detail/Drawer, Journey, retry sau lost acknowledgment, permission recheck,
thẻ unavailable, map navigation, mobile 320 px và dark theme.

`messaging-share.test.mjs` kiểm tra payload/target/idempotency helpers;
`messaging-share-mutation.test.mjs` chạy production hook options với MutationObserver
và QueryClient thật, transport/auth được mô phỏng; kiểm tra late response, đổi owner,
không cache source preview và không tạo history cursor giả. Draft lifecycle suite
kiểm tra giữ/xóa share attempts theo phiên.

Từ `backend/`, đặt `WANDERMAP_TEST_DATABASE_URL` trỏ vào disposable PostGIS database có
tên chứa `_test`, không dùng `DATABASE_URL` ứng dụng:

```powershell
npm run test:db -- --runTestsByPath test/messaging-api.db-spec.ts test/messaging-realtime.db-spec.ts
npm run type-check
npm run lint
npm test -- --runInBand
npm run build
```

DB tests kiểm tra private/followers posts, cả sender/recipient, journey status,
deletion/tombstone, block, metadata giả, idempotent retry và Unicode boundary.
Nội dung đã hiển thị trước khi quyền thay đổi không thể thu hồi; UI xác minh lại qua
REST khi đọc/refetch, không có resource privacy push event mới trong feature này.

### Kết quả xác minh ngày 24/10/2026

- Frontend unit tests: **127/127 PASS**.
- Backend unit tests: **144/144 PASS**; messaging REST/realtime integration trên PostGIS
  tạm riêng: **46/46 PASS**, gồm các case permissions/metadata giả và Unicode mới.
- Production Chrome tests: **9 nhóm Share Content PASS**, cùng **13 nhóm hồi quy chat
  Feature 4 PASS**, không Runtime exception. Đã xem screenshots desktop/mobile/light/dark.
- Type-check, backend lint, ESLint scoped frontend và build hai ứng dụng: PASS.
  Frontend build vẫn báo các warning cũ trong MapTopbar/PostFeedClient/useDebounce/mapbox.
- Các container/Next servers/Chrome profiles dùng cho test đã được dọn. Database và
  dữ liệu ứng dụng không thay đổi trong lần triển khai Feature 5 này.
