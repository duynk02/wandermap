# Nhãn quần đảo dùng chung trên bản đồ

Mọi nơi khởi tạo bản đồ hiện tại dùng cùng hai nhãn **Quần đảo Hoàng Sa (Việt Nam)** và **Quần đảo Trường Sa (Việt Nam)**. Nội dung và tọa độ tâm nhóm đảo được giữ từ implementation Explore trước đó: `[112, 16.5]` và `[114, 10]`; đây là điểm đặt nhãn, không phải polygon ranh giới.

## Phạm vi

| Bản đồ | Tích hợp |
| --- | --- |
| Explore | `VietnamOverlay` dùng `ArchipelagoOverlay`; phần tô màu/viền quốc gia của Explore vẫn riêng tại đây. |
| My Travel Map trong Profile | `TravelMap` dùng `ArchipelagoOverlay`. |
| Journey Builder và Journey Detail | Cùng `TravelMap`, kể cả khi đổi Outdoors/Dark hoặc tải lại map. |
| Preview xuất ảnh, PNG và preview chia sẻ Feed mới | `renderJourneyPoster` cài lớp nhãn trực tiếp vào map WebGL, nên canvas capture có nhãn. |

`frontend/src/lib/mapbox/archipelagos.ts` là nguồn dữ liệu và cấu hình layer dùng chung. `frontend/src/components/map/ArchipelagoOverlay.tsx` chỉ đọc context của map hiện tại qua react-map-gl; không gọi thêm hook `hooks/useMap.ts` của Explore và không tạo map/query/cluster mới.

Nhãn đỏ có viền sáng, được ưu tiên khi va chạm với nhãn khác. Ẩn các tên basemap trùng nhóm đảo bằng cùng bộ lọc đã dùng tại Explore, giữ các điều kiện filter khác; chạy lại khi `style.load`. Overlay không phải điểm đã ghé thăm và không tham gia chọn stops, thống kê, clustering hay fit bounds.

Giữ ngưỡng zoom tương đương Explore (từ zoom 4). Khi người dùng đang xem vùng khác, tọa độ ngoài khung nhìn không xuất hiện; không ép đổi camera/thu nhỏ Journey để chứa hai quần đảo. Bản xuất điều chỉnh zoom/size theo DPR và tăng cỡ chữ tương ứng poster để dễ đọc khi thu nhỏ. Không thay logo/attribution nhà cung cấp.

Ảnh đã xuất hoặc upload trước thay đổi là dữ liệu tĩnh; không tự sửa lại các ảnh cũ. Nhãn được thêm vào ảnh preview/PNG tạo mới nếu khu vực và mức zoom phù hợp. Không có thay đổi backend, database, dependency hoặc env.

## Xác minh

- Frontend type-check, lint các file sửa và 27 unit tests: pass.
- **11 nhóm kiểm tra trình duyệt pass**, dùng Mapbox/WebGL thật và API fixtures: nhãn trên Journey Detail/Builder, đổi Outdoors/Dark không nhân đôi/mất nhãn; PNG chứa điểm ảnh chữ đỏ ở cả hai vùng; xuất vuông/dọc, lỗi/retry, form chưa lưu, mobile DPR2/kinh tuyến 180°, hủy tác vụ; Explore giữ overlay quốc gia; My Travel Map dùng nhãn chung. Script `frontend/tests/journey-export.browser.mjs`.
- Từ `frontend/`: `npm run type-check`; `npx eslint src/lib/mapbox/archipelagos.ts src/components/map/ArchipelagoOverlay.tsx src/components/map/VietnamOverlay.tsx src/components/map/TravelMap.tsx src/lib/journey-export/render.ts`; `node --experimental-strip-types --test tests/*.test.mjs`.
- Chạy browser script với `WANDERMAP_EXPORT_TEST_WEB_URL=http://localhost:3000`. Cần Chrome, dev web/API và token Mapbox hợp lệ. Kiểm tra My Travel Map đọc một profile public có sẵn; đặt `WANDERMAP_TEST_USERNAME` nếu Feed local rỗng. Không ghi dữ liệu thật.
- Build production: **pass**, chạy trong bản sao kiểm tra để không đụng cache `.next` của dev server; có các warnings cũ ngoài phần sửa. Chưa kiểm tra Safari/Firefox hoặc thiết bị thật. Không chạy lại backend/database tests vì thay đổi chỉ ở các lớp hiển thị frontend.
