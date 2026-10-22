# Phase 2 — Step 6: Share Journey to Feed

Đã nối luồng chia sẻ Journey thật với hệ thống bài đăng. Nút **Chia sẻ lên Feed** nằm trên trang chi tiết của chủ Journey: mở preview → viết caption tùy chọn → chọn ảnh → **Đăng bài**. Lưu Journey, mở preview, xuất PNG hoặc hủy preview đều không tự đăng bài hoặc tự công khai Journey.

## Luồng và giao diện

- Chỉ Journey **public + published** được chia sẻ. Với bản nháp/private, preview giải thích điều kiện và dẫn về chỉnh sửa; người dùng chủ động thay đổi trạng thái qua luồng hiện có.
- Preview mặc định là poster bản đồ 1:1, 1600×1600 từ compositor của Step 5: tuyến/markers là GL layers, chờ tiles/fonts, giữ logo và attribution, có timeout/cancellation. Không chụp DOM Builder.
- Có thể dùng ảnh bìa Journey hoặc chọn JPEG/PNG/WebP tối đa 10 MB. Chờ ảnh decode/load trước khi bật nút đăng; backend upload tiếp tục xác minh định dạng/dung lượng và chuyển WebP.
- Không upload ảnh khi mở preview. Chỉ upload khi nhấn đăng, qua `/uploads/images` và API client hiện có. Retry tái sử dụng URL ảnh đã upload trong cùng preview. Đóng preview giải phóng map/object URLs; không đổi Journey.
- Loading khóa nút đăng và đóng để ngăn gửi lặp ngoài ý muốn. Mất mạng/response giữ caption và ảnh. Trước khi upload/gửi lại, client kiểm tra bài đã có; backend vẫn là nơi quyết định quyền và chống trùng.
- Preview giữ một revision đã lưu. Nếu server trả 409 vì Journey đã đổi, **Tải lại bản xem trước** lấy Journey mới, dựng lại ảnh và giữ caption; không tự ghi đè thay đổi của cửa sổ khác.
- Feed, profile grid và post detail nhận biết `post_type`. Feed/post detail dùng `JourneyPostContent`, hiển thị ảnh, tiêu đề, số điểm, tối đa ba tên điểm và **Xem hành trình** đến `/journey/[id]`, nơi có bản đồ tương tác và các điểm đến hiện hữu. Không tạo bản sao Journey.
- `JourneyPostCard` mặc định tái sử dụng `FeedPostCard`: author, caption, Follow, Like, Comment, Save. Lightbox Radix hỗ trợ phóng ảnh, Escape/đóng và focus. Riêng `PostCard` trong lưới dùng variant `grid` và `JourneyPostGridCard` gọn: ảnh 4:3 object-contain, badge số điểm, author dưới ảnh, tiêu đề một dòng, caption hai dòng, liên kết Journey nhỏ và hàng tương tác. Nhánh bài thường được căn chiều cao phần nội dung/footer tương ứng; không triển khai lại tab Đã lưu của Profile vốn đang là placeholder.
- Post detail và Journey cards trong profile tải lại theo viewer sau phục hồi phiên đăng nhập, để `is_liked/is_saved` không lấy từ response SSR ẩn danh. Cache key tách người xem. Share/edit/delete Journey invalidate các query posts liên quan.

## Card gọn trong lưới Profile

Card Journey gọn giữ toàn bộ poster và attribution trong ảnh, không zoom/crop khi hover. Các liên kết Mapbox/OpenStreetMap/feedback được trình bày nhỏ trong vùng nội dung cố định. Nhấn ảnh/tiêu đề hoặc biểu tượng bình luận mở bài đăng; **Xem hành trình** mở trực tiếp Journey. Like/Save gọi API hiện hữu, không điều hướng; trạng thái được tải theo viewer và cache posts được invalidate sau tương tác. Chuyển private/đổi revision vẫn có chỉ báo gọn, API giữ nguyên quyền xem.

Đã kiểm tra Chrome với lưới public thực tế gồm một Journey và hai bài địa điểm: cả ba card rộng 320px, cao 436px, khung ảnh cao 240px và footer thẳng hàng. Kiểm tra 390px/320px, dark theme, tên/caption dài, Like, Save lỗi rồi thử lại, liên kết điều hướng và Feed vẫn dùng bản đầy đủ. Các mutation trình duyệt trong lúc kiểm tra được chặn bằng fixtures, không sửa dữ liệu thật. Type-check, lint các file sửa và build frontend pass; thay đổi chỉ ở frontend, không thêm migration/env/dependency.

## Schema và lựa chọn

Chọn bổ sung vào `posts`. Bảng quan hệ riêng vẫn đòi nới các cột location/rating/date và thêm join; repository chưa có abstraction attachment đáng tái sử dụng.

Migration mới **009_journey_posts.sql**:

- `post_type NOT NULL DEFAULT 'location'`, `journey_id`, `preview_revision`.
- Location Post vẫn bắt buộc location/rating/visited_at, không có Journey reference. Journey Post bắt buộc journey/revision, không gán location/rating/date giả. CHECK kiểm soát hai shape tại database; rating/images/visibility constraints cũ vẫn còn.
- Caption Journey có thể rỗng; caption bài thường vẫn không được rỗng. Cột và payload bài thường được giữ nguyên.
- Composite FK `(journey_id, author_id) → journeys(id, user_id)` chặn liên kết Journey của người khác ngay trong SQL.
- `UNIQUE(journey_id)` cho phép tối đa một bài đang tồn tại trên mỗi Journey. Share transaction khóa active owner rồi Journey theo cùng thứ tự với Journey update, kiểm tra visibility/status/revision và trả bài cũ khi retry; không ghi đè caption/ảnh cũ. Constraint unique bảo vệ thêm tại DB.
- Xóa Journey cascade bài liên kết, likes/saves/comments/notifications. Triggers hiện hữu duy trì counters; Journey Post không tăng post_count/rating của location nào.

Không sửa migration đã áp dụng. Đã chạy migration 009 trên database development local và kiểm tra **0 pending**. Khi triển khai môi trường khác, chạy `npm run db:migrate` từ `backend/` trước khi phục vụ code dùng schema mới. Không thêm dependency, server renderer hoặc env runtime mới; dùng token Mapbox và pipeline upload hiện hữu.

## API

| Endpoint | Auth và hành vi |
| --- | --- |
| `GET /api/v1/posts/journey/:journeyId` | JWT active; trả `{ post }` với bài của chính chủ hoặc `{ post: null }`. Không tiết lộ bài private của người khác. |
| `POST /api/v1/posts/journey` | JWT active; body `journey_id`, `revision`, `content` tùy chọn mặc định rỗng, `preview_image_url`. Trả `{ post, created }`. Retry trả ID cũ với `created: false`; HTTP 201 cho endpoint này không có nghĩa mỗi request tạo một hàng mới. |
| Feed/following/by-author/by-location/post detail | API cũ, bổ sung post type và Journey summary có quyền xem; LEFT JOIN location cho phép Journey Post không có location. Data/count dùng cùng điều kiện. |
| Like/Save/Comment/Replies/Comment likes | Dùng nguyên endpoints và triggers; kiểm tra quyền Post kết hợp Journey. |

POST `/posts` của bài địa điểm không thay DTO hay ý nghĩa. Frontend dùng union LocationPost/JourneyPost, chấp nhận cả response location cũ chưa có `post_type`. Client cũ vẫn dùng contract bài địa điểm; client hiển thị feed mới cần biết Journey Post có location/rating/date null.

## Quyền riêng tư và cập nhật

| Thay đổi Journey | Quy tắc bài liên kết |
| --- | --- |
| Sửa tên/thứ tự/điểm | Tên/số điểm/tóm tắt/tuyến detail đọc Journey gốc mới nhất. Caption và ảnh giữ tại thời điểm share. `preview_revision` khác revision hiện tại làm card hiện thông báo ảnh cũ. |
| Private hoặc draft | Feed công khai/following ẩn bài, kể cả khi chủ xem feed công khai. Người khác nhận 404 trên post/detail/comments/replies và các mutation liên quan. Chủ vẫn mở bài trực tiếp để quản lý. |
| Public + published trở lại | Bài cũ xuất hiện lại theo quyền Post, giữ ID/Like/Comment/Save, không tự tạo bài mới. |
| Xóa Journey | Xóa bài và tương tác qua FK cascade; không để bài mồ côi. |
| Chủ tài khoản inactive | Không công khai Journey Post hoặc tương tác của nó. |

Điều kiện chung được gom ở `post-access.ts`, dùng trong các đường đọc/count/assertVisible và notification list/unread. Comments service tiếp tục dùng `PostsService.assertVisible`, nên không có đường phụ đọc comment của Journey private.

**Giới hạn media hiện hữu:** upload trả URL public, không phải authenticated media. Đổi private/draft chặn truy cập qua WanderMap nhưng không thu hồi ảnh đã tải hoặc URL ảnh đã biết; điều này được nói rõ trước khi đăng. Upload thành công nhưng POST thất bại có thể để lại ảnh chưa gắn bài; chưa thêm cơ chế dọn media/hạ tầng mới. Ảnh snapshot không phải bản sao dữ liệu Journey và không tự render lại khi sửa Journey. Bài đang mở ở trình duyệt khác không bị thu hồi bằng realtime; lần đọc API tiếp theo áp dụng quyền mới.

## Bản đồ và attribution

Tái sử dụng pipeline xuất ảnh Step 5; giữ logo SDK và source credits trong pixel ảnh, dùng `object-contain` để không cắt attribution. Share preview và card có thêm liên kết Mapbox/OpenStreetMap/feedback gần ảnh. Không dùng ảnh như API tiles hoặc tự xóa credit.

Đã đối chiếu [hướng dẫn attribution của Mapbox](https://docs.mapbox.com/help/dive-deeper/attribution/) và [static maps](https://docs.mapbox.com/help/dive-deeper/static-maps/). Hướng dẫn attribution không tự cấp mọi quyền lưu/tái phân phối ảnh: việc vận hành public phải nằm trong [điều khoản/gói Mapbox của tài khoản](https://www.mapbox.com/legal/product-terms). Không có quyền truy cập hợp đồng tài khoản để xác nhận quyền riêng theo gói; không khẳng định tính năng cấp phép sử dụng ảnh bản đồ tùy ý. Không thêm dịch vụ server hoặc thay nhà cung cấp.

## Xác minh

- Backend type-check và build: **pass**.
- Backend unit: **41/41 pass**; health e2e **1/1 pass**.
- Database/API: **43/43 pass**, gồm **9 tests mới** và hai suites cũ, trên PostgreSQL16/PostGIS riêng chạy Docker. Kiểm tra migration với bài location đã tồn tại, constraints/FK, JWT/inactive/ownership, private/draft, public/profile/following feeds, 6 request share đồng thời chỉ tạo 1 bài/counter +1, stale revision, live Journey update, Like/Comment/Save, thu hồi quyền ở mọi entry point, công khai lại và cascade deletion.
- Frontend type-check, lint các file thay đổi và build production: **pass**. Build trong bản sao kiểm tra, giữ dev server và `.next` hiện tại. Có warnings cũ ở MapTopbar/PostFeedClient/useDebounce/mapbox helper.
- Frontend unit: **27/27 pass**.
- Chrome headless: **7 nhóm pass**, Mapbox/WebGL tạo poster thật 1600×1600; API browser dùng fixtures, không đăng bài vào dữ liệu thật. Kiểm tra private/draft không mutation; preview/caption; lỗi response sau commit rồi retry không upload/post thêm; Like/Save/Comment; Feed trộn hai loại; lightbox; 390px không overflow; bài đã share; lỗi Mapbox; ảnh bìa/file hợp lệ và từ chối SVG; hủy không mất Journey; lỗi 409 bắt buộc tải revision mới và giữ caption trước khi đăng lại.
- Backend lint toàn bộ: **còn 6 lỗi import không dùng đã có trước trong `src/auth/auth.controller.ts`**; lint `src/posts`, notifications service và test mới pass. Không sửa auth ngoài phạm vi.
- Chưa kiểm tra Safari/Firefox hoặc thiết bị mobile thật. Test database khác production; browser HTTP fixtures và integration backend thật là hai lớp kiểm thử riêng, chưa phải hành trình E2E với tài khoản/upload/Mapbox trong môi trường production.

Chạy lại từ `backend/`: `npm run type-check`, `npm test -- --runInBand`, `npm run build`, `npm run test:e2e`. Để chạy DB suite: đặt `WANDERMAP_TEST_DATABASE_URL` đến **database dùng riêng cho test**, có tên chứa `_test` hoặc `test_`, rồi `npm run test:db`. Suite mới commit trong schema ngẫu nhiên để kiểm tra concurrent connections; chỉ dùng DB có thể bỏ sau test, không trỏ production. Từ `frontend/`: `node --experimental-strip-types --test tests/*.test.mjs`; đặt `WANDERMAP_TEST_WEB_URL=http://localhost:3000` rồi `node tests/journey-share.browser.mjs` (Chrome đã cài).
