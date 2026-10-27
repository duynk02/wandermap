# Rollback và recovery

Không chạy reset/drop/truncate, sửa checksum history hoặc xóa media để chữa release. Mốc A chỉ chuẩn bị runbook; không rollback/deploy/restore tài nguyên thật.

## Trước release

1. Lưu commit/artifact frontend/backend, env revision (tên biến và version secret, không chép secret vào repo), Node version và canonical migration hashes.
2. Với DB trống, xác nhận chưa có tài khoản/dữ liệu thật. Khi đã có người dùng, backup database và verify restore trên DB riêng trước schema/data changes.
3. Lưu asset metadata/provider inventory và retention policy. Cloudinary bytes là phần của recovery, không chỉ database URLs.
4. Chọn phiên bản rollback có managed-media authorization tương thích schema 016. Không tự quay về backend cũ lưu public local uploads sau khi nhận dữ liệu private.

## Khi có lỗi

- Hạn chế audience/đặt maintenance tại tầng đã chuẩn bị; dừng nhận writes nếu dữ liệu hoặc privacy đang bị ảnh hưởng. Không dựa riêng vào CORS/Vercel gate để bảo vệ Render.
- Xác định lỗi frontend, backend, env, provider hay schema; lưu request IDs và thông tin đã redact. Không copy tokens/cookies/private messages vào incident notes.
- Frontend: chọn deployment tốt trước đó trên Vercel, xác nhận API/realtime build-time URLs và managed-media support tương thích. Đổi env cần build lại.
- Backend: revert artifact/env revision đã kiểm chứng; giữ cùng schema nếu tương thích. Render restart sẽ ngắt sockets; client phải reconnect/REST reconcile.
- Nếu release đầu chưa có bản tốt, giữ maintenance và sửa forward; không tuyên bố đã rollback thành công chỉ vì service start được.

## Database/migrations

- Runner transaction theo file: file lỗi rollback, file trước có thể đã commit. Kiểm kê `schema_migrations`, schema và logs trước khi hành động.
- 015 backfill search có lock và giữ timestamps; không có automatic down. Ưu tiên forward migration được review nếu cần sửa tiếp.
- 016 thêm assets/ownership checks; bỏ table/triggers có thể làm mất liên kết hoặc làm yếu privacy. Không chạy down SQL suy đoán.
- Artifact canonical LF khác raw CRLF của một số DB development. Mismatch phải dừng; không sửa SQL cũ hoặc history để ép chạy.
- Restore backup chỉ khi thật sự cần: chọn restore point, tính writes mới sẽ mất, thông báo/được cho phép cho thao tác có mất dữ liệu, restore sang DB riêng rồi verify trước chuyển kết nối. Kiểm tra counts/FKs/extensions/auth sessions/asset URLs.

## Media

- Không xóa authenticated assets khi rollback ứng dụng. Canonical URL phải tiếp tục được backend có authorization phục vụ.
- Không đổi Cloudinary authenticated type thành public hoặc dùng URL signed cố định để chữa ảnh lỗi.
- Nếu metadata insert thất bại sau upload, có thể có authenticated orphan; không tự xóa hàng loạt. Chỉ cleanup bằng inventory/ownership/retention job được review.
- Các bản sao bytes đã download không thể bị thu hồi; chặn request mới, không đưa private provider URLs vào response/cache.

## Xác nhận recovery

Health/DB/TLS, login-refresh-logout, private media, Post/Journey/search, notifications/messaging/reconnect và cache headers phải đạt smoke tests. Ghi artifact/version và những kiểm chứng còn thiếu; mở lại writes/audience có kiểm soát.
