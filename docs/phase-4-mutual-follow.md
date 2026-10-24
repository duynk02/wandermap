# Messaging — Bạn bè và người theo dõi

Hai bộ đếm trên profile mở bảng Người theo dõi / Đang theo dõi, có avatar,
liên kết hồ sơ, phân trang, loading, empty và retry. Nút nhắn tin chỉ hiện khi
người đang đăng nhập và người trong danh sách theo dõi qua lại, không bị chặn
và tài khoản còn hoạt động. Người theo dõi mình một chiều có nút **Theo dõi lại**.
Khi xem profile người khác, hành động vẫn tính theo người đang đăng nhập.

Sidebar Tin nhắn có ba mục: **Cuộc trò chuyện**, **Bạn bè**, **Người theo dõi**.
Bạn bè là những người theo dõi nhau, bao gồm cả người đã có hội thoại và chưa từng
chat. Không tạo trước hội thoại khi tải danh sách. Chọn người mới gọi REST direct
API; database tiếp tục bảo đảm một conversation cho một cặp. Danh sách hỗ trợ tìm
theo tên/username có hoặc không dấu và tải thêm. Dialog tạo chat/chia sẻ cũng dùng
nhãn Bạn bè; dialog chia sẻ loại trùng với các cuộc trò chuyện đang hiển thị.

Mục Người theo dõi chỉ gồm những người đang theo dõi mình mà mình chưa theo dõi
lại. Nút Theo dõi lại giữ trạng thái pending trong khi cập nhật hai danh sách;
sau khi server xác nhận thành công, người đó rời danh sách Người theo dõi và xuất
hiện trong Bạn bè. Request thất bại giữ nguyên liên hệ và có thể thử lại. Thao tác
này không tạo hội thoại hoặc tự mở chat. Danh sách có thể thu gọn/mở rộng bằng
button có `aria-expanded`/`aria-controls`; khi thu gọn ngừng polling mục này.

Biểu tượng hồ sơ trong header chat mở menu **Mở hồ sơ** / **Hủy theo dõi**.
Trạng thái theo dõi được tải khi mở menu; hủy theo dõi dùng API hiện có, có xác
nhận và có thể thử lại khi lỗi. Sau thành công, ô soạn tin bị khóa ngay, các danh
sách/quyền được cập nhật lại; lịch sử và bản nháp vẫn được giữ. Khi không theo dõi
người nhận hoặc tài khoản không khả dụng, mục Hủy theo dõi bị vô hiệu hóa.

API bổ sung/cập nhật:

- `GET /conversations/contacts`: bắt buộc đăng nhập; `page` mặc định 1,
  `pageSize` mặc định 20, tối đa 50, `search` tối đa 100 ký tự. Response có
  `data: [{ id, username, display_name, avatar_url, conversation_id }]`,
  `hasMore`, `next_page`. `kind=friends` (mặc định) trả bạn bè được phép nhắn tin;
  `kind=followers` trả người theo dõi chưa được theo dõi lại. Cả hai loại lọc tài
  khoản inactive và chặn tin nhắn hai chiều; dùng cùng pagination/search.
- `GET /users/:username/followers|following`: giữ response phân trang cũ,
  thêm `is_following`, `follows_you`, `is_mutual`, `can_message` theo viewer.
  Khách vẫn xem danh sách nhưng không có quyền nhắn tin. Bỏ tài khoản inactive.
- Profile detail có cùng các trường quan hệ; conversation có `is_mutual`
  và `can_send` phản ánh quyền hiện tại. Response cá nhân hóa dùng private/no-store.
- Direct và gửi tin mới yêu cầu mutual follow, nếu thiếu trả 403
  `MUTUAL_FOLLOW_REQUIRED`. Áp dụng cho text và mọi loại shared content.

Hủy theo dõi giữ nguyên lịch sử, unread và read cursor. Tin đã commit được replay
với cùng idempotency key; không tạo message mới. Theo dõi lại khôi phục gửi trong
conversation cũ. Follow/unfollow dùng cùng transaction advisory pair lock với
send/direct/block để tránh thay đổi quyền giữa lúc tạo tin. Khi conversation đã
tồn tại, thay đổi quan hệ phát `conversation:updated` reason `policy` sau commit
tới mọi tab của cả hai người. Các tab refetch quyền/contacts qua REST. Contacts
chưa có conversation và bảng quan hệ cập nhật khi focus hoặc mỗi 30 giây;
mutation tại tab hiện tại invalidate cache ngay. Không bổ sung socket send handler.

Không cần migration, biến môi trường hay dependency mới. Database phải có các
migrations hiện hành đến 014. Menu cài đặt profile chờ session restore để tránh
hydration mismatch từ profile lưu tạm trong browser.

Kiểm thử: unit frontend/backend; integration HTTP và Socket.IO trên PostGIS riêng,
gồm follow-back, một chiều, hủy theo dõi, chia sẻ, idempotency, race send/unfollow,
phân trang/search, quyền viewer và fanout nhiều tab. Browser fixtures kiểm tra
hai bảng profile, điều hướng nhắn tin và mutual contacts chưa có history,
đồng thời chạy lại luồng chia sẻ hiện có. Xem lệnh kiểm tra trong
[Feature 4](phase-4-feature-4.md) và [Feature 5](phase-4-feature-5.md).

Kết quả xác minh: 144 backend unit tests, 128 frontend unit tests và 74 integration
tests (Messaging REST/Socket.IO + Users/visited regression) đều pass. Browser pass
13 nhóm share/relationships và 14 nhóm chat, không có JavaScript exception ở lượt
cuối. Một lượt trước gặp React hydration #418 không ổn định; hai lượt chạy lại
không tái hiện. Browser runner bổ sung thông tin route khi ghi nhận exception để
chẩn đoán nếu tái diễn.
TypeScript, backend lint và build cả hai ứng dụng pass; frontend giữ các lint
warnings cũ ở MapTopbar, PostFeedClient, useDebounce và mapbox.
Fixture Users/visited vẫn kiểm tra cutover 008, sau đó áp dụng các migration mới
hơn để kiểm tra profile API với schema hiện hành. Không thay assertions cũ.
