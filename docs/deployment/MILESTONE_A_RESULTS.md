# WanderMap — Kết quả implementation Mốc A

Ngày 27/10/2026. Audit source baseline `5c5bbf0`; bắt đầu implementation từ `bed9a98` (chỉ thêm tài liệu so với baseline). Thay đổi hiện ở working tree, **chưa commit/push/merge**. Đây là kết quả preparation, không phải báo cáo deployment.

## 1. Kết luận và issue IDs

**Code prepared; locally verified; CI/cloud chưa verified. Chưa kết luận READY FOR MILESTONE B.**

| Issue | Trạng thái hiện tại | File/test truy vết chính |
| --- | --- | --- |
| P0-01 | FIXED, NOT VERIFIED IN CLOUD | StorageService, Cloudinary/local providers, media DB/browser tests; real authenticated asset persistence/delivery cần account thật. |
| P0-02 | FIXED & VERIFIED (local/Linux) | frontend package/lock; clean install/audit/build, native Next optimizer + Sharp tests. |
| P1-01 | FIXED & VERIFIED (local/Linux) | Cả hai package/lock; full và omit-dev audits đều 0 advisories. |
| P1-02 | FIXED & VERIFIED | validate-env.ts/spec; backend .env.example. |
| P1-03 | FIXED, NOT VERIFIED IN CLOUD | Shared frontend environment.mjs, config validation, Node/pg transport tests; cloud URLs/TLS/cookies còn cần smoke test. |
| P1-04 | FIXED, NOT VERIFIED IN CLOUD | MediaImage + 18 consumers; managed media không qua optimizer; Chrome đã decode Blob; real cloud transport chưa thử. |
| P1-05 | FIXED & VERIFIED | 015 + location-search-migration.db-spec.ts: nâng cấp schema có dữ liệu, STORED backfill, ranking/metadata/indexes. |
| P1-06 | PARTIALLY FIXED | proxy-policy.ts/spec, validate-env; explicit CIDRs và spoof boundary test local; peer chain Render/Vercel chưa đo. |
| P1-07 | FIXED, NOT VERIFIED IN CLOUD | ci.yml thay deno.yml; mirror Linux local đạt; GitHub Actions chưa chạy. |
| P1-08 | FIXED & VERIFIED cho DB production mới | migration-artifact.ts/spec, manifest, prepare-migrations.cjs; 001–014 source/history không bị sửa; canonical compiled runner đạt. |
| P1-09 | FIXED, NOT VERIFIED IN CLOUD | 016 ownership triggers, no-store media API, role/visibility DB tests và browser session-switch regression; Cloudinary unsigned rejection/account settings chưa thử. |
| P2-01 | FIXED, NOT VERIFIED IN CLOUD | .node-version, engines, Dockerfile/CI pin 22.23.4, npm ci/non-root/16 SQL artifacts; Vercel managed patch chưa đo. |
| P2-02 | FIXED, NOT VERIFIED IN CLOUD | Swagger production default false, persistAuthorization false; env regression tests. |
| P2-03 | FIXED, NOT VERIFIED IN CLOUD | Validated LOG_LEVEL; requestId + sanitized code thay raw errors; Photon/Sharp logs không chép raw messages; log privacy tests. |
| P2-04 | FIXED & VERIFIED | Lint cả hai app đạt, frontend 0 warnings; sửa types/unused/ARIA nhỏ, không refactor UI lớn. |
| P2-05 | FIXED & VERIFIED | README root/backend, env examples, gitignore, deployment/env/smoke/rollback/media docs. |
| P2-06 | FIXED, NOT VERIFIED IN CLOUD | PHOTON_URL example HTTPS và production validation; không gọi provider thật. |
| P1-10 (mới) | FIXED & VERIFIED | LoginForm/RegisterForm method POST; browser phát hiện native GET trước hydration, hiện fallback không đưa credentials lên query string. |
| P1-11 (mới) | FIXED, NOT VERIFIED IN CLOUD | connection-options.ts + 3 transport tests: chặn TLS override qua URL, production luôn rejectUnauthorized=true. |

Không có issue local được bỏ ở OPEN/BLOCKED hoặc tự chấp nhận rủi ro. Các trạng thái NOT VERIFIED/PARTIALLY FIXED ở trên vẫn là release gates. Audit gốc và bằng chứng cũ được giữ trong [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md).

## 2. Dependencies và runtime

| App | Package/path | Baseline → hiện tại |
| --- | --- | --- |
| frontend | next, eslint-config-next | 15.5.27 → 15.5.28 (giữ major 15) |
| frontend | sharp | 0.33.5 → 0.35.5 |
| frontend | zod | 3.25.76 → 4.6.7 |
| frontend | @hookform/resolvers | 3.10.0 → 5.9.2 |
| frontend | Next nested postcss | 8.4.31 → 8.5.30, scoped override |
| frontend | postcss-selector-parser | 6.1.4 → 6.1.5 |
| backend | body-parser | 2.3.0 → 2.4.0 |
| backend | platform-express/multer | 2.4.0 → 2.5.0, scoped override |
| backend | swagger/js-yaml | 5.3.0 → 5.5.0, scoped override; các dev copies đã an toàn giữ nguyên |
| backend | fast-uri | 3.1.8 → 3.1.9 |
| backend | cloudinary | Thêm 2.11.0, backend-only |

Zod/resolver là major upgrades cần thiết để thoát affected range hiện có; đã kiểm tra Vietnamese validation errors, parsed output/resolver, typecheck, tests và build. Không dùng audit fix --force. Giữ React 19/Nest 11. Backend Sharp đã là 0.35.5.

Node chọn **22.23.4**, security release 21/10/2026; engines `>=22.23.4 <23`, Docker/CI pin đúng patch. [Node release](https://nodejs.org/en/blog/release/v22.23.4). Host Windows 22.21.1 không được sửa global; verification runtime đích dùng Linux 22.23.4/npm 10.9.9. Deprecation warnings của ESLint 9/dev glob/inflight và Node experimental/module-type vẫn xuất hiện; audits không có advisory chưa vá tại thời điểm kiểm tra. Không nâng ESLint major ngoài phạm vi để chỉ xoá deprecation warning.

## 3. Migration và storage architecture

- **015_fix_location_search_normalization.sql** sửa unaccent dùng input, recompute STORED search_text. Lock writers trong transaction, chỉ tạm tắt timestamp trigger và khôi phục mode ban đầu; giữ timestamps/coordinates và indexes. Production DB trống làm chi phí backfill nhỏ; DB nhiều dữ liệu cần maintenance window riêng.
- **016_managed_media.sql** thêm asset metadata/owner/provider/version/canonical URL và reference indexes/ownership triggers cho Post, Journey, avatar, itinerary. Không đổi/xóa URL hoặc files cũ.
- SQL **001–014 không bị chỉnh sửa**, không sửa history/checksum. Manifest từ Git baseline chấp nhận đúng bytes LF hoặc CRLF đã biết rồi đóng gói verified canonical copy vào dist. Compiled artifact chỉ dành cho DB production mới; source runner giữ compatibility checksum DB development. Mismatch trên DB cũ phải dừng/review.
- Production khởi tạo **database trống**: không import development users/posts/locations/media. Migrations chỉ đã chạy trên PostGIS test riêng do lượt này tạo; DB development hiện có không được truy cập/chỉnh sửa.
- Cloudinary nhận sanitized WebP dạng **authenticated**. Small StorageProvider abstraction: put/read; local development dùng private `.private` files. Không global content-hash dedupe giữa các owners.
- Canonical DB URL là `PUBLIC_API_URL/media/:uuid`; signed provider URL chỉ ở server. Backend authorize theo resource visibility, fetch bytes, recheck quyền rồi stream; không redirect hoặc trả provider signature. Không bật public immutable CDN cache cho URL có thể đổi privacy.
- Owner có thể gắn một asset vào nhiều resources; nếu chủ động dùng cùng asset cho avatar/public resource thì asset được public qua reference đó. Upload riêng tạo identity riêng. Bytes đã download không thể thu hồi khỏi thiết bị.

Chi tiết và tradeoff bandwidth/no-store: [MEDIA_SECURITY.md](MEDIA_SECURITY.md). Cloudinary authenticated delivery được thiết kế theo [tài liệu access control](https://cloudinary.com/documentation/control_access_to_media); account thực tế vẫn NOT VERIFIED.

## 4. Security controls và compatibility

Upload JWT auth, memory limits, pixel limits, byte-format validation, WebP/max2048/metadata stripping, response `{url,width,height,bytes}` được giữ. API không lộ đường dẫn file hoặc provider credentials. Production Post/Journey image refs mới phải là managed URLs thuộc owner; DB trigger chặn copied/fake managed references. Đây là thay đổi có chủ đích cho production DB mới; không bulk migrate legacy development URLs.

Managed delivery áp dụng 404 cho không có quyền, private no-store cho cả success/error, không ETag/optimizer/shared cache. Frontend dùng client hiện có để nhận Blob với shared refresh, phân biệt viewer/session, hủy query và revoke Blob khi đổi session/logout/unmount. JWT vẫn memory-only, refresh cookie HttpOnly/rotating; không JWT_REFRESH_SECRET, storage token hoặc token-in-URL.

Production HTTPS/env fail-fast, exact CORS origins, Secure cookie, trust none mặc định/explicit trusted CIDRs, Swagger off mặc định và secret-safe logs. REST vẫn same-origin rewrite, Socket.IO vẫn trực tiếp `/realtime` với JWT, path `/socket.io`, một backend process/instance. Không Redis/microservices/ORM/Supabase runtime.

Pool/LISTEN/migrations dùng cùng TLS policy: production luôn verified TLS kể cả PGSSLMODE blank; consume/remove sslmode trước pg parse, chặn các URL SSL/file overrides. Trust CA riêng qua Node trust store hoặc chọn endpoint verified TLS phù hợp; không no-verify. [pg giải thích URL có thể thay ssl object](https://node-postgres.com/features/ssl).

Legacy `/uploads` chỉ development và vẫn public; managed `.private` không được static serve; production từ chối legacy route/local provider. Không xóa media cũ. Native form fallback login/register dùng POST, không gửi password bằng GET trước hydration.

## 5. Bằng chứng build/test

Kết quả cuối của lần kiểm tra source mới nhất được cập nhật trước khi bàn giao. Linux verification dùng source copy không có .env/node_modules/build outputs; npm ci theo lockfiles, build fixtures example.test/Mapbox pk giả, local provider và database test riêng. Không gọi Cloudinary/Mapbox thật.

| Kiểm tra | Kết quả |
| --- | --- |
| Full npm audit + --omit=dev, cả hai app | PASS: 0 advisories |
| Frontend clean npm ci, lint --max-warnings=0, type-check, production build trên Linux Node 22.23.4 | PASS; kiểm tra lại sau hardening auth form cũng PASS |
| Frontend Node tests, gồm image optimizer/native Sharp/Zod/blob auth | PASS: 143 tests, 0 skipped |
| Backend clean npm ci, lint/type-check/build/unit trên Linux Node 22.23.4 | PASS: 17 suites / 163 unit tests, 0 skipped |
| pg transport policy qua pg Client thật trên Node 22.23.4 Linux | PASS: 3 tests, không mở network |
| Health e2e | PASS: 1 test (mock DB); không thay thế real DB checks |
| PostgreSQL/PostGIS integration suites | PASS: 9 suites, 156 tests, 0 skipped, gồm rerun source cuối qua no-skips CI wrapper |
| Fresh canonical compiled migrations | PASS: 001–016 trên DB test trống, lần hai no-op/status 0 pending |
| Compiled API real DB health + JWT Socket.IO /realtime + SIGTERM Linux | PASS cả clean mirror và final production image; fixture local provider, không Cloudinary |
| Production Docker image Node 22.23.4/non-root/SQL artifacts | PASS; final rebuild chứa TLS/log hardening đạt, pruned runtime audit 0 advisories |
| Chrome + real local Next rewrite/Nest/local private storage/PostGIS | PASS: owner Blob decode; canonical URL alone 404; cross-tab logout/UI removal/Blob revocation; outsider/account switch/public→private/new-read denial; không provider/token URL leak |
| GitHub Actions | NOT RUN — workflow prepared, local mirror không được gọi là CI verified |
| Real Cloudinary/Render/Vercel/Mapbox | NOT VERIFIED — không dùng production credentials hoặc tạo resources trong Mốc A |

Trong quá trình chạy, harness từng lỗi selector/hydration/reload race và một test fixture thiếu DTO defaults; đã sửa rồi chạy lại, không bỏ assertions hoặc security checks. Lệnh cuối mirror qua PowerShell pipe có CRLF khiến npm không nhận tên startup script; startup được chạy riêng trực tiếp bằng Node trong final production image và đạt. Chrome thực tế đã phát hiện native auth form GET trước hydration; source được harden thành POST. Không coi toàn bộ trải nghiệm Phase 1–4 đã verified chỉ từ unit/DB tests.

## 6. Environment variables và việc thủ công

Các biến mới/chuẩn hóa cần review: PUBLIC_API_URL, STORAGE_PROVIDER, CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET, SERVE_LEGACY_UPLOADS, TRUSTED_PROXY_CIDRS, SWAGGER_ENABLED, LOG_LEVEL, NODE_VERSION/.node-version; PGSSLMODE có verified TLS policy. Backend example thêm POSTGRES_PASSWORD cho Compose development. Frontend API_INTERNAL_URL, NEXT_PUBLIC_API_URL, NEXT_PUBLIC_REALTIME_URL, NEXT_PUBLIC_MAPBOX_TOKEN được validate theo production; NEXT_PUBLIC là build-time/public, không đặt secrets vào đó. Xem đầy đủ default/secret/required tại [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md).

Việc người dùng/operator cần làm sau review, trong Mốc B đã được giao:

1. Review working tree, đặc biệt security model, 015–016 và dependency major Zod/resolver; chọn commit triển khai, tự commit/push theo quy trình. Chạy workflow thật và yêu cầu cả hai jobs xanh, DB tests không skip.
2. Cập nhật Node local tối thiểu 22.23.4; xác nhận patch Node 22 do Vercel quản lý và pin Render/Docker. Mốc A không thay global installation.
3. Tạo database production trống và Cloudinary environment đã duyệt, tự quản lý secrets tại host; xác minh extensions/permissions/backup, verified TLS endpoint/CA và connection budget. Không dùng dev/test URLs.
4. Thiết lập giới hạn audience cho cả Vercel và Render; đo trusted proxy peer chain, review rate limits với nhiều client và spoofed XFF trước khi cấu hình CIDRs.
5. Build canonical artifact, migrate một lần trên DB production mới bằng runbook; deploy backend một instance rồi frontend root frontend, đúng build-time API/realtime/Mapbox URLs.
6. Kiểm tra account Cloudinary thật (authenticated original/derived unsigned rejection, upload/delivery/persistence/quota), Vercel rewrite/cookie/cache, WSS/reconnect và full Phase 1–4 browser smoke tests. Upload lớn qua rewrite, Mapbox WebGL/Journey PNG export và restore drill vẫn NOT VERIFIED.
7. Ghi kết quả/host/commit vào smoke checklist và đóng các cloud gates trước khi mở audience. Không rollback về backend cũ thiếu managed media authorization.

Không có deployment, cloud resource, production credential access, migration trên dev/production DB, media deletion hoặc commit/push/merge trong lượt này. Đã dọn containers/database/network test riêng sau verification; PostgreSQL development vẫn healthy và không bị dừng/chỉnh sửa. Giữ local image `wandermap-milestone-a:local` để review, không push.

Runbooks: [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md), [SMOKE_TEST_CHECKLIST.md](SMOKE_TEST_CHECKLIST.md), [ROLLBACK_PLAN.md](ROLLBACK_PLAN.md).

## 7. Files changed

Danh sách dưới đây gồm tracked changes, deleted workflow và new files; build outputs/node_modules/.env thật được ignore. Không bao gồm 001–014 SQL cũ vì các file đó không thay đổi.

Tổng cộng **101 files** trong working tree (gồm deletion).

- [.gitattributes](../../.gitattributes)
- [.github/workflows/ci.yml](../../.github/workflows/ci.yml)
- `.github/workflows/deno.yml` — deleted, thay bằng ci.yml.
- [.node-version](../../.node-version)
- [README.md](../../README.md)
- [backend/.dockerignore](../../backend/.dockerignore)
- [backend/.env.example](../../backend/.env.example)
- [backend/Dockerfile](../../backend/Dockerfile)
- [backend/README.md](../../backend/README.md)
- [backend/package-lock.json](../../backend/package-lock.json)
- [backend/package.json](../../backend/package.json)
- [backend/scripts/historical-migrations.json](../../backend/scripts/historical-migrations.json)
- [backend/scripts/prepare-migrations.cjs](../../backend/scripts/prepare-migrations.cjs)
- [backend/scripts/run-db-tests.cjs](../../backend/scripts/run-db-tests.cjs)
- [backend/scripts/verify-startup.cjs](../../backend/scripts/verify-startup.cjs)
- [backend/src/app.module.ts](../../backend/src/app.module.ts)
- [backend/src/auth/auth.controller.spec.ts](../../backend/src/auth/auth.controller.spec.ts)
- [backend/src/common/filters/api-exception.filter.spec.ts](../../backend/src/common/filters/api-exception.filter.spec.ts)
- [backend/src/common/filters/api-exception.filter.ts](../../backend/src/common/filters/api-exception.filter.ts)
- [backend/src/config/proxy-policy.spec.ts](../../backend/src/config/proxy-policy.spec.ts)
- [backend/src/config/proxy-policy.ts](../../backend/src/config/proxy-policy.ts)
- [backend/src/config/validate-env.spec.ts](../../backend/src/config/validate-env.spec.ts)
- [backend/src/config/validate-env.ts](../../backend/src/config/validate-env.ts)
- [backend/src/database/connection-options.ts](../../backend/src/database/connection-options.ts)
- [backend/src/database/database.service.ts](../../backend/src/database/database.service.ts)
- [backend/src/database/migrate.ts](../../backend/src/database/migrate.ts)
- [backend/src/database/migration-artifact.spec.ts](../../backend/src/database/migration-artifact.spec.ts)
- [backend/src/database/migration-artifact.ts](../../backend/src/database/migration-artifact.ts)
- [backend/src/database/migrations/015_fix_location_search_normalization.sql](../../backend/src/database/migrations/015_fix_location_search_normalization.sql)
- [backend/src/database/migrations/016_managed_media.sql](../../backend/src/database/migrations/016_managed_media.sql)
- [backend/src/journeys/dto/journey.dto.ts](../../backend/src/journeys/dto/journey.dto.ts)
- [backend/src/main.ts](../../backend/src/main.ts)
- [backend/src/places/places.service.spec.ts](../../backend/src/places/places.service.spec.ts)
- [backend/src/places/places.service.ts](../../backend/src/places/places.service.ts)
- [backend/src/posts/dto/create-post.dto.ts](../../backend/src/posts/dto/create-post.dto.ts)
- [backend/src/posts/dto/share-journey.dto.ts](../../backend/src/posts/dto/share-journey.dto.ts)
- [backend/src/uploads/managed-media-url.spec.ts](../../backend/src/uploads/managed-media-url.spec.ts)
- [backend/src/uploads/managed-media-url.ts](../../backend/src/uploads/managed-media-url.ts)
- [backend/src/uploads/media-headers.middleware.ts](../../backend/src/uploads/media-headers.middleware.ts)
- [backend/src/uploads/media.controller.ts](../../backend/src/uploads/media.controller.ts)
- [backend/src/uploads/storage.service.spec.ts](../../backend/src/uploads/storage.service.spec.ts)
- [backend/src/uploads/storage.service.ts](../../backend/src/uploads/storage.service.ts)
- [backend/src/uploads/storage/cloudinary-storage.provider.spec.ts](../../backend/src/uploads/storage/cloudinary-storage.provider.spec.ts)
- [backend/src/uploads/storage/cloudinary-storage.provider.ts](../../backend/src/uploads/storage/cloudinary-storage.provider.ts)
- [backend/src/uploads/storage/local-storage.provider.ts](../../backend/src/uploads/storage/local-storage.provider.ts)
- [backend/src/uploads/storage/storage-provider.ts](../../backend/src/uploads/storage/storage-provider.ts)
- [backend/src/uploads/uploads.controller.ts](../../backend/src/uploads/uploads.controller.ts)
- [backend/src/uploads/uploads.module.ts](../../backend/src/uploads/uploads.module.ts)
- [backend/src/uploads/uploads.service.spec.ts](../../backend/src/uploads/uploads.service.spec.ts)
- [backend/src/uploads/uploads.service.ts](../../backend/src/uploads/uploads.service.ts)
- [backend/test/app.e2e-spec.ts](../../backend/test/app.e2e-spec.ts)
- [backend/test/connection-options.node-test.mjs](../../backend/test/connection-options.node-test.mjs)
- [backend/test/location-search-migration.db-spec.ts](../../backend/test/location-search-migration.db-spec.ts)
- [backend/test/media-security.db-spec.ts](../../backend/test/media-security.db-spec.ts)
- [docs/deployment/DEPLOYMENT_GUIDE.md](../../docs/deployment/DEPLOYMENT_GUIDE.md)
- [docs/deployment/ENVIRONMENT_VARIABLES.md](../../docs/deployment/ENVIRONMENT_VARIABLES.md)
- [docs/deployment/MEDIA_SECURITY.md](../../docs/deployment/MEDIA_SECURITY.md)
- [docs/deployment/MILESTONE_A_RESULTS.md](../../docs/deployment/MILESTONE_A_RESULTS.md)
- [docs/deployment/PRODUCTION_READINESS.md](../../docs/deployment/PRODUCTION_READINESS.md)
- [docs/deployment/ROLLBACK_PLAN.md](../../docs/deployment/ROLLBACK_PLAN.md)
- [docs/deployment/SMOKE_TEST_CHECKLIST.md](../../docs/deployment/SMOKE_TEST_CHECKLIST.md)
- [frontend/.env.example](../../frontend/.env.example)
- [frontend/.gitignore](../../frontend/.gitignore)
- [frontend/next.config.ts](../../frontend/next.config.ts)
- [frontend/package-lock.json](../../frontend/package-lock.json)
- [frontend/package.json](../../frontend/package.json)
- [frontend/src/components/auth/LoginForm.tsx](../../frontend/src/components/auth/LoginForm.tsx)
- [frontend/src/components/auth/RegisterForm.tsx](../../frontend/src/components/auth/RegisterForm.tsx)
- [frontend/src/components/comment/CommentComposer.tsx](../../frontend/src/components/comment/CommentComposer.tsx)
- [frontend/src/components/comment/CommentItem.tsx](../../frontend/src/components/comment/CommentItem.tsx)
- [frontend/src/components/feed/FeedPostCard.tsx](../../frontend/src/components/feed/FeedPostCard.tsx)
- [frontend/src/components/journey/JourneyBuilder.tsx](../../frontend/src/components/journey/JourneyBuilder.tsx)
- [frontend/src/components/journey/JourneyCollection.tsx](../../frontend/src/components/journey/JourneyCollection.tsx)
- [frontend/src/components/journey/JourneyDetail.tsx](../../frontend/src/components/journey/JourneyDetail.tsx)
- [frontend/src/components/journey/JourneyPostContent.tsx](../../frontend/src/components/journey/JourneyPostContent.tsx)
- [frontend/src/components/journey/JourneyPostGridCard.tsx](../../frontend/src/components/journey/JourneyPostGridCard.tsx)
- [frontend/src/components/journey/JourneyShareDialog.tsx](../../frontend/src/components/journey/JourneyShareDialog.tsx)
- [frontend/src/components/layout/MainHeader.tsx](../../frontend/src/components/layout/MainHeader.tsx)
- [frontend/src/components/map/MapTopbar.tsx](../../frontend/src/components/map/MapTopbar.tsx)
- [frontend/src/components/messaging/MessagingPrimitives.tsx](../../frontend/src/components/messaging/MessagingPrimitives.tsx)
- [frontend/src/components/messaging/SharedContentCard.tsx](../../frontend/src/components/messaging/SharedContentCard.tsx)
- [frontend/src/components/notification/NotificationList.tsx](../../frontend/src/components/notification/NotificationList.tsx)
- [frontend/src/components/post/PostCard.tsx](../../frontend/src/components/post/PostCard.tsx)
- [frontend/src/components/post/PostDetail.tsx](../../frontend/src/components/post/PostDetail.tsx)
- [frontend/src/components/post/PostFeedClient.tsx](../../frontend/src/components/post/PostFeedClient.tsx)
- [frontend/src/components/profile/EditProfileDialog.tsx](../../frontend/src/components/profile/EditProfileDialog.tsx)
- [frontend/src/components/profile/ProfileHeader.tsx](../../frontend/src/components/profile/ProfileHeader.tsx)
- [frontend/src/components/ui/MediaImage.tsx](../../frontend/src/components/ui/MediaImage.tsx)
- [frontend/src/constants/index.ts](../../frontend/src/constants/index.ts)
- [frontend/src/hooks/useDebounce.ts](../../frontend/src/hooks/useDebounce.ts)
- [frontend/src/hooks/useRealtimeConnection.ts](../../frontend/src/hooks/useRealtimeConnection.ts)
- [frontend/src/lib/api/client.ts](../../frontend/src/lib/api/client.ts)
- [frontend/src/lib/api/media.ts](../../frontend/src/lib/api/media.ts)
- [frontend/src/lib/api/uploads.ts](../../frontend/src/lib/api/uploads.ts)
- [frontend/src/lib/config/environment.mjs](../../frontend/src/lib/config/environment.mjs)
- [frontend/src/lib/mapbox/index.ts](../../frontend/src/lib/mapbox/index.ts)
- [frontend/tests/api-auth.test.mjs](../../frontend/tests/api-auth.test.mjs)
- [frontend/tests/environment.test.mjs](../../frontend/tests/environment.test.mjs)
- [frontend/tests/image-processing.test.mjs](../../frontend/tests/image-processing.test.mjs)
- [frontend/tests/media-security.browser.mjs](../../frontend/tests/media-security.browser.mjs)
- [frontend/tests/validation-compatibility.test.mjs](../../frontend/tests/validation-compatibility.test.mjs)
