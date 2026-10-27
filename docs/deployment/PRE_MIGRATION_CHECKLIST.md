# PRE-MIGRATION CHECKLIST — Milestone B

Ngày kiểm tra: **27/10/2026, Asia/Saigon**. Phạm vi: PostgreSQL production mới trên Render, database `wandermap`, role `wandermap_app`. **HOLD — chưa phê duyệt/chạy migration.** Báo cáo này không cấp quyền chạy bất kỳ lệnh kết nối production nào.

## Cập nhật Resolve Migration Preflight Blockers

Release candidate **đã được người dùng duyệt để kiểm tra**: `818d5f88c2169ca5dc3e5f59e90888c1bcf2d20a`. Không thay SHA ứng dụng. Người dùng xác nhận **Render PostgreSQL Free**; managed PITR/managed logical exports không được xem là có sẵn. Windows Node global giữ nguyên; dùng worker Docker.

Quyền thực thi được tách rõ:

- **A — Read-only inspection:** chưa cấp. Chưa chạy inspector production.
- **B — Backup:** chưa cấp. Chưa chạy pg_dump production.
- **C — Migration:** chưa cấp. Không chạy cả `--status`, migrations hoặc verification có runner.

Docker runtime đã kiểm tra trực tiếp với `--pull=never --platform linux/amd64 --network none`, không mounts: Node **v22.23.4**, npm **10.9.9**, process platform `linux/x64`, `uname -m=x86_64`, Git 2.39.5. Docker Desktop context `desktop-linux`, Engine 29.8.2 `linux/amd64`. Image local có RepoDigest đúng `node@sha256:63538dfe497cc29dfafdda25ada09b46db68a3f4cc205abf1f5d6bf0913f3384`. **Docker runtime verified** là bằng chứng riêng với **release worker/artifact verified** ở bảng sau; không suy PASS artifact từ `node --version`.

Worker được build bằng [release-worker.Dockerfile](preflight/release-worker.Dockerfile), context riêng `docs/deployment/preflight/` và [.dockerignore allowlist](preflight/.dockerignore). Không mount repository Windows, `.env`, npm cache, node_modules, artifact cũ, DB volumes, Docker socket hoặc secrets. Clone/fetch Git public bên trong container, detached checkout đúng SHA; build nhận network để tải Git/npm, không vào Compose network của PostgreSQL local. Helpers ở `/opt/wandermap-ops`, application checkout ở `/release`. Chỉ helpers được thay đổi trong lượt này; application release, migrations và historical manifest giữ nguyên.

**Release worker/artifact VERIFIED**: `npm ci` sạch (738 packages), type-check PASS, transport tests **3 PASS / 0 skipped**, artifact unit tests **2 PASS**, backend production build PASS. Detached checkout `/release` đúng approved SHA, Git status sạch; không có backend node_modules/dist trước install/build. Verifier đối chiếu đủ **16 SQL canonical LF** với release Git + baseline + historical manifest. Có **308 compiled files** trong inventory. Lần chạy verifier sau build bằng user `node`, `--read-only --network none --cap-drop ALL --security-opt no-new-privileges` cũng PASS; archive/evidence checksums đều OK. Không chạy production inspector hoặc migration runner để kiểm tra artifact.

| Artifact/provenance | Identity / SHA-256 |
| --- | --- |
| Worker image ID immutable (local, chưa push) | `sha256:2c922743183258df0fb974df6bf3681069c4528249d9fc65677d56a241c9d704` |
| Tag tham chiếu | `wandermap-preflight:818d5f8-ops-v2` |
| Compiled `backend-release.tar` | `09b6e111fee8a3ff0996e4ea867b236def0a0b66ec03ff16df794c44805f2b5b` |
| Historical manifest LF | `54b55d66d7ef1220128d237cdcdd3ac8d955d143809ceee8b37b9dd37aac25ac` |
| Release backend package-lock | `bf400af771b44b375a488b0b9ee61172f40cce4410de6af6b0845e9dfdad05b1` |
| Compiled inventory JSON file | `765cb2e13772a34ec15fc12943e049803001c1fe7467631737fafb3db289015c` |
| Worker verification JSON | `718c54c7a394a92f5562a7e5b47eeb03772d63f82f429af0a641f9e51f320077` |

Evidence lưu ở [worker-verification.json](preflight/evidence/worker-verification.json), [build-provenance.json](preflight/evidence/build-provenance.json), [compiled-files.json](preflight/evidence/compiled-files.json), [SHA256SUMS](preflight/evidence/SHA256SUMS). Compiled tar lưu local tại `preflight/evidence/backend-release.tar`, được `.gitignore` để không đưa binary vào Git; nó không phải database backup. Image và tar chưa upload/push. `compiledInventorySha256` trong JSON hash danh sách compact trong bộ nhớ, khác hash của JSON file được pretty-print; hai trường có mục đích riêng.

PostgreSQL Docker local trước/sau vẫn container `5a34f8ebe19b1738547a52c841191cf9621213f6f5f5ff8fb34f98acad947acb`, `wandermap-postgres`, healthy, cùng uptime (Up 6 hours tại lúc kiểm tra). Không stop/restart/exec vào container DB, không mount volume `backend_wandermap_pgdata`, không tham gia `backend_default` hoặc chạy Compose.

### Review operational helpers v2

Các helpers không thuộc approved application release và không kế thừa CI của application. Version vận hành **ops-v2**, provenance bằng SHA-256 riêng trong `preflight/evidence/worker-verification.json`; Dockerfile/context có bảng hash riêng. Không tự commit helper vào release hoặc gọi source đã sửa là release SHA cũ.

| Operational file ops-v2 | SHA-256 bytes đã build |
| --- | --- |
| verify-artifact.cjs | `06f7246ef240679404c2dba3ec47a65109c8eda96d67e1fb95d01a2b23cfc807` |
| inspect-production.cjs | `367fe944cc0ac26d58e4c10205f2687fd05218be215313208f8219ba70a510ae` |
| runtime-inspect.sh | `577c6af3de9c09844e5bd16fc052933dc5734223af0217283480faeb38b65802` |
| record-worker.cjs | `4ef2d8acefc50fed6a74f4f3a7f9e358acde8a3d02e24e8f460c26fbd406ce37` |
| release-worker.Dockerfile | `af4e189f1f0ed0a93c1a039b8e7125cc7bfcc22b4e5398efceb676c28501bd02` |
| .dockerignore | `675023d7f0f9b5806a11636771372f12d4ee8e846988c9fbf8168b221129a8cb` |

Dependencies helpers: Node core modules, Git executable; inspector còn dùng `pg` từ **release backend node_modules theo lockfile** và compiled `database/connection-options.js` cùng release. Runtime prompt dùng Bash trong pinned image. Không thêm npm dependency, ORM hoặc application module bootstrap.

- `verify-artifact.cjs`: offline, chỉ đọc Git/files; yêu cầu exact HEAD approved release, tree pin, không drift application/config, 14 historical entries và đủ 16 SQL artifact canonical. Root lấy từ `WANDERMAP_RELEASE_ROOT` để không phải chèn helpers vào checkout. Không import runner hoặc mở DB.
- `inspect-production.cjs`: chỉ chuẩn bị, chưa thực thi production. Shared compiled TLS policy + socket encrypted/authorized + explicit hostname certificate check; cố định PG16/database/user/extension versions. Có kiểm tra CONNECT/USAGE/CREATE, public schema, session user, absent application objects/history. Connection mặc định read-only và transaction `BEGIN READ ONLY`; chỉ SELECT catalog/known extension functions, SET LOCAL timeout và ROLLBACK. Không DDL/DML/advisory lock/status. Lỗi chỉ in tên gate cố định, không raw Error/URL/password/SQL/stack. Không tự sửa DB, endpoint hoặc TLS.
- `runtime-inspect.sh`: nhập hostname và URL qua terminal container; URL dùng `read -s`, không có credential trong Docker args/config, image layers, file, build args hay history. Chỉ gọi inspector `before`; không có backup/migration entry point. Chỉ được chạy sau approval A.
- `record-worker.cjs`: ghi non-secret evidence/hashes của release, lockfile, manifest, compiled files và helper versions; không chạy database code.

Chưa chứng minh inspector PASS trên server thật bằng syntax-check/unit tests. Không sửa `.env` để bỏ qua gate. Backup được chuẩn bị riêng bằng PostgreSQL client 16.15 hiện có trên Windows, không cần Node global.

## Kết quả preflight

Đã đọc AGENTS.md và toàn bộ 7 tài liệu hiện có trong `docs/deployment/`. Các đoạn audit baseline trong PRODUCTION_READINESS.md và câu “chưa commit/push/merge” trong MILESTONE_A_RESULTS.md là lịch sử; Git và CI hiện tại bên dưới mới là bằng chứng cho release này. Không sửa tài liệu lịch sử để thay đổi bằng chứng cũ.

| Điều kiện | Bằng chứng / kết quả hiện tại | Điều kiện PASS trước khi migrate |
| --- | --- | --- |
| Working tree ban đầu | **PASS**: sạch; branch local `chore/production-hardening` | Application source/config không drift so với release |
| HEAD local | **PASS**: `50d49845201df6991a987748ee7a212b0344db6d` | Ghi rõ SHA dùng build |
| Release candidate | **APPROVED FOR PREFLIGHT**: `818d5f88c2169ca5dc3e5f59e90888c1bcf2d20a`, merge PR #9 | Giữ nguyên SHA này, không dùng `main/latest` thay đổi ngầm |
| Source tree | **PASS**: local HEAD và merge commit cùng tree `3a8e0e2c461a9a79449c900ed9c921ab4048fe1f` | Release worker checkout đúng SHA; build từ lockfile |
| CI release merge | **PASS**: [run 40460489986](https://github.com/duynk02/wandermap/actions/runs/40460489986), event push, SHA đúng, completed/success | Frontend/backend jobs đều success; không chỉ kiểm tra badge branch |
| CI PR head | **PASS**: [run 40459793460](https://github.com/duynk02/wandermap/actions/runs/40459793460), SHA `50d4984`, success | Bằng chứng bổ sung, không thay CI commit release |
| CI DB gate | **PASS theo jobs/steps API + workflow**: PostGIS suites, fresh canonical migrations, startup và Docker steps success; wrapper fail nếu skipped/pending tests hoặc thiếu test URL | Không bỏ qua DB suites. API tải raw logs trả 403, nên lượt này không xác nhận lại số test từ raw CI logs |
| Migrations 001–014 | **PASS**: bytes Git không đổi so với baseline `5c5bbf0`; cả canonical/windows hashes khớp manifest 14 entries | Không sửa source/history/checksum |
| Migrations 015–016 | **PASS**: chỉ hai migrations mới so với baseline; artifact khớp bytes release | Hash đúng bảng bên dưới |
| Release worker / compiled artifact | **PASS DOCKER**: clean exact checkout, npm ci/build, 16 SQL LF khớp release, 308 compiled files; offline read-only non-root verification PASS | Giữ immutable worker image + hashes đã ghi; không thay artifact giữa preflight và migration |
| Script production | **PASS**: `db:migrate:prod` = `node dist/database/migrate.js`; SQL từ `dist/database/migrations` theo `__dirname` | Chạy từ `backend/`, dùng compiled runner |
| Docker runtime | **PASS**: pinned digest, linux/amd64, Node `22.23.4`, npm `10.9.9` | Dùng Docker worker; Windows Node `22.21.1` không còn là blocker và không cần nâng global |
| DB trống, extensions | **USER VERIFIED**: chỉ bảng `public.spatial_ref_sys`; postgis `3.6.2`, pg_trgm `1.6`, unaccent `1.1` trong public | Kiểm tra lại qua đúng external URL bằng inspector chỉ đọc trước lần chạy đầu |
| Server PostgreSQL major | **NOT VERIFIED** | Xác nhận PG16; nếu khác, dừng review compatibility/client tools thay vì tự nâng/hạ database |
| Verified TLS trong code | **PASS**: pool/LISTEN/runner dùng cùng helper; production luôn `rejectUnauthorized: true`; chặn URL TLS overrides | Không `no-verify`, `disable`, TLS bypass hoặc trust CA không rõ nguồn |
| TLS/network/target thực tế | **BLOCKER — NOT VERIFIED**: chưa dùng production URL hay mở kết nối Render | Exact external hostname, database/user, TLS authorization, certificate hostname/chain và allowlist phải đạt |
| Quyền role/search_path | **NOT VERIFIED** | CONNECT thành công, public là current schema, USAGE/CREATE public, dùng được extensions; runtime role sở hữu objects mới |
| Backup/recovery | **BLOCKER — BACKUP NOT EXECUTED**: user xác nhận Render Free; không managed PITR/exports | Approval B, logical export verified TLS ngoài repository + archive check/hash; không coi `--list` là restore drill |
| Cô lập local/development | **PASS**: chỉ worker build/verify Docker riêng, không DB/Compose commands, không sửa `.env` | Shell production riêng; không dùng dev/test URL; không ghép migrate vào startup/CI |
| Phê duyệt migration | **PENDING** theo yêu cầu người dùng | Duyệt rõ SHA, target và phạm vi status + migrate một lần + verify |

**FAIL hoặc NOT VERIFIED tại release SHA/CI, target/TLS, runtime, artifact, quyền, backup hay approval đều chặn migration.** Hiện release SHA và CI đã xác minh được; nếu đổi SHA, kiểm tra lại và coi là blocker đến khi CI của SHA mới xanh.

## Artifact và runner đã kiểm tra

Lượt đầu đã kiểm tra local bằng Windows Node thấp hơn baseline; bằng chứng đó không chứng nhận worker. **Lượt Resolve Blockers đã chạy lại trong clean Docker worker Node 22.23.4/npm 10.9.9**: `npm ci --include=dev --no-audit --no-fund`, `npm run type-check` (PASS), `npm run test:transport` (3 PASS, 0 skipped, không network), artifact unit suite (2 PASS), `npm run build` (PASS). Sau build và sau image export đã verify lại đủ 16 canonical migrations. Có npm deprecation notices (ESLint/glob/inflight) và Node experimental/module-type warnings; không đổi dependencies để xoá warning. Không chạy lại toàn bộ frontend/backend/DB suites; không khẳng định audit mới từ lệnh npm ci có `--no-audit`. Bằng chứng CI release được ghi riêng ở trên.

| Migration | SHA-256 canonical LF |
| --- | --- |
| 001 | `4a56f755f2262ae770d4cb258b04e320e4a3f0754b0993ea3be5981326c23c25` |
| 002 | `0f2674cfb5bafe6564dafe77b74810faa5597ff40cd9ff944c0221b540087751` |
| 003 | `4c6d4e4ef1bc8ce6ce690bca86ad1f90918733848adc9d512c4baa8531edf7ba` |
| 004 | `12a6492101a6991ed6851ca372800b43a333e2df65cd79fb481a470927c189d1` |
| 005 | `a9577d816f0cd83973110d44305abbd521114bc78505973782c495340c52be35` |
| 006 | `276721c0fb13a6055a387e2de924c0bd0c56a1a8cc002959827edec96d339f76` |
| 007 | `578529024a06cbba16d4e6315ca7ea20a5338b7d51c2b4fd8e95df49ee1c12d1` |
| 008 | `9dd68e795b5f49925b761a1b5c9f46cc8a85ec73f299e0f2aaaf6ded7f11ea75` |
| 009 | `580983f33d2c0cb9803ae38b93fee2c3ae7cfe21f2fa3ca8f65953a30e4311b1` |
| 010 | `b3f0913e4dfcbb20d173bc9622184ae9c04ac2c9631c2a392ec132c45777156d` |
| 011 | `2bff4994f01b77678543b32b08490184089c12fdd7891f19589a6e6bd50bdc75` |
| 012 | `9cc09831e1203dc71396de976ebb906fb332c6a14e89099b10d4c267dca5e453` |
| 013 | `59dbf52b2060808a1ce8d44dd695c48ed63ef1a10795064ea0be6a052206fb77` |
| 014 | `caecb250cbcf5062a0feae58ef36feb9a0f47d7005664fb05e6ef0d790f2d719` |
| 015 | `5924b3f529f0f321b3040162b166c055e8810017fc1c98ca194ca39e32f1a284` |
| 016 | `779db1fe74df3279d74d8c46b457da856e58d907e55ff14ad8d62819d21644d8` |

Working-tree 002–005 và 011 có CRLF đã biết; artifact là bản sao LF được kiểm tra hash. Không normalize source cũ hoặc đưa artifact này vào DB development đã ghi raw CRLF checksums.

Runner lấy advisory lock và **CREATE TABLE IF NOT EXISTS schema_migrations ngay cả với `--status`**. Mỗi file có transaction riêng: lỗi file 010 có thể để 001–009 đã commit. Có lock/backfill trong 008/015, DDL/ownership triggers trong 016; đây là migration đã review, không phải các thao tác được phép thực hiện trong preflight. Không có automatic down hoặc rollback nguyên batch.

## Chuẩn bị worker và secrets

Chỉ dùng terminal/operator environment riêng. Không sửa `backend/.env`, frontend env, Docker Compose, dev volumes, hoặc đặt production URL vào `WANDERMAP_TEST_DATABASE_URL`. Không đưa URL vào command arguments, chat, screenshots, `Write-Output`, transcript, shell history, CI PR secrets hay file Git theo dõi. Chỉ nhập bằng secure prompt hoặc secret store được duyệt. Environment process vẫn chứa plaintext trong bộ nhớ; đóng shell khi xong.

Ở Render backend/release worker, lưu `DATABASE_URL` bằng secret environment setting của đúng service; `NODE_ENV=production`, `PGSSLMODE=verify-full`, Node theo `.node-version`. Chọn **External Database URL** của đúng instance trên Dashboard, không internal hostname/IP, không tự dựng lại password URL. Nếu tự dựng, percent-encode user/password đúng một lần. URL không có các override `ssl`, `sslcert`, `sslkey`, `sslrootcert`, `uselibpqcompat`, `sslnegotiation`. `sslmode=require` do Dashboard cung cấp được helper consume/remove trước pg parse; verified TLS vẫn bật.

Pool, LISTEN và runner cùng dùng `databaseConnectionOptions`. node-postgres cảnh báo URL SSL params có thể thay thế explicit ssl object; code hiện tại xử lý rủi ro đó. Thực tế certificate chain/hostname vẫn cần handshake thành công, không thể suy ra từ unit test. Nếu cần CA riêng, chỉ dùng CA đã xác thực qua `NODE_EXTRA_CA_CERTS` trước khi khởi động Node; dừng nếu trust không rõ. Không đặt `NODE_TLS_REJECT_UNAUTHORIZED=0` hoặc Node options tắt TLS checks. [node-postgres SSL](https://node-postgres.com/features/ssl), [Render external connections](https://render.com/docs/postgresql-creating-connecting).

Các helper trong `preflight/` chỉ là tài liệu vận hành mới, chưa nằm trong release CI. `verify-artifact.cjs` chạy offline; `inspect-production.cjs` đã syntax-check nhưng **chưa chạy trên database**, chỉ SELECT trong `BEGIN READ ONLY`, không import runner hay tạo history. Inspector yêu cầu Node baseline, exact external hostname, database/user cố định, TLS socket authorized, public schema và PG16. Không thêm flag bypass khi check thất bại.

### Chuẩn bị Docker worker (không cần production secret)

Từ repository root, có thể tái tạo bằng lệnh sau. Build context chỉ chứa helpers được allowlist, không cần mount checkout host. Dockerfile fetch exact SHA và dùng lockfile của SHA đó. Không chạy `npm ci`/build bằng Windows Node để thay thế worker.

```powershell
docker build --pull=false --no-cache --platform linux/amd64 --progress plain `
  --file docs/deployment/preflight/release-worker.Dockerfile `
  --tag wandermap-preflight:818d5f8-ops-v2 docs/deployment/preflight
if ($LASTEXITCODE -ne 0) { throw 'Worker build failed' }
```

Tag chỉ giúp tìm image; trước thao tác có production approval phải dùng immutable **worker image ID** được ghi cùng evidence, không rebuild/thay tag rồi dùng bằng chứng cũ. Image chứa compiled build và Linux dependencies; `/artifacts/backend-release.tar` lưu compiled output, package/lock và historical manifest, không kèm node_modules. Dependency runtime Linux vẫn nằm trong worker image. SQL artifact hash canonical được đối chiếu Git; đây là clean operator build, không phải CI artifact download hay tuyên bố reproducible toàn bộ image.

Lệnh verify offline đã chạy PASS, có thể chạy lại mà không kết nối database:

```powershell
$workerImage = 'sha256:2c922743183258df0fb974df6bf3681069c4528249d9fc65677d56a241c9d704'
docker run --rm --pull=never --platform linux/amd64 --network none `
  --read-only --cap-drop ALL --security-opt no-new-privileges --env GIT_OPTIONAL_LOCKS=0 `
  $workerImage bash -c 'sha256sum --check /artifacts/SHA256SUMS && exec node /opt/wandermap-ops/verify-artifact.cjs'
if ($LASTEXITCODE -ne 0) { throw 'Offline worker verification failed' }
```

Verifier v2 yêu cầu exact release HEAD. Working tree Windows ở `50d4984` có source tree giống release nhưng không được dùng thay worker checkout `818d5f8`.

### Nhập secret trong PowerShell riêng cho backup B (chưa chạy)

Đây là session Windows chỉ dành cho **backup B sau A PASS**, dùng pg_dump/pg_restore 16.15 đã có; không chạy Node hoặc migration ở Windows. Chạy từ `backend/` để kiểm tra đường dẫn backup ngoài repository. Nếu biến DB đã có sẵn, mở shell riêng không kế thừa credentials development; không ghi đè session đang chạy development. Không chuyển secret của session này sang Docker bằng `--env DATABASE_URL`, env-file hoặc build args.

```powershell
if ($env:DATABASE_URL) { throw 'Use an isolated operator shell without an inherited DATABASE_URL' }
if ($env:WANDERMAP_TEST_DATABASE_URL) { throw 'Do not mix test and production sessions' }
if ($env:NODE_OPTIONS -or $env:NODE_TLS_REJECT_UNAUTHORIZED -eq '0') { throw 'Review Node TLS environment' }
$env:NODE_ENV = 'production'
$env:PGSSLMODE = 'verify-full'
$env:WANDERMAP_PROD_HOST = Read-Host 'Exact EXTERNAL hostname from the intended Render database Info page'
$secureDatabaseUrl = Read-Host 'Production External Database URL (hidden)' -AsSecureString
$secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureDatabaseUrl)
try {
    $env:DATABASE_URL = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
    $secureDatabaseUrl.Dispose()
    Remove-Variable secureDatabaseUrl,secretPointer
}
```

Không paste URL vào câu lệnh gán `$env:DATABASE_URL='...'`. Không chạy `Get-ChildItem Env:` hoặc log environment. Không cần JWT/Cloudinary secrets để chạy riêng compiled migration CLI.

## Thứ tự sau khi được phê duyệt — không tự thực thi

### 1. Approval A — Kiểm tra chỉ đọc trước migration

Chỉ sau khi operator cho phép A: từ PowerShell tương tác, dùng worker image ID immutable ở evidence (đặt biến `$workerImage` theo ID thực tế). Không mount secrets hoặc chuyển URL trên command line. Script yêu cầu nhập host/URL bên trong terminal container, không echo URL:

```powershell
$workerImage = 'sha256:2c922743183258df0fb974df6bf3681069c4528249d9fc65677d56a241c9d704'
docker run --rm -it --pull=never --platform linux/amd64 --network bridge `
  --read-only --cap-drop ALL --security-opt no-new-privileges `
  --env GIT_OPTIONAL_LOCKS=0 --tmpfs /tmp:rw,noexec,nosuid,size=16m `
  $workerImage bash /opt/wandermap-ops/runtime-inspect.sh before
if ($LASTEXITCODE -ne 0) { throw 'STOP: read-only production preflight failed' }
```

PASS phải chứng minh đúng host đã nhập, session/current user và database, PG16, TLS encrypted/authorized + explicit certificate hostname match + `pg_stat_ssl.ssl=true`, CONNECT và public CREATE/USAGE, extensions trong public và chưa có non-extension relations/functions. Inspector không tạo `schema_migrations` và không gọi migration status. Versions phải đúng postgis 3.6.2, pg_trgm 1.6, unaccent 1.1. PostGIS khác phiên bản CI 3.5 là khác biệt môi trường cần ghi nhận; kiểm tra schema/search/spatial sau migration và smoke tests trước mở app.

Nếu có bất kỳ bảng ứng dụng/history hoặc object không rõ nguồn, **dừng** fresh-DB procedure. Không xoá object để ép PASS. Duyệt/lưu backup baseline tại bước 2 trước khi chạy status.

### 2. Approval B — Backup/recovery cho database mới

Vì chưa có users/posts/media, không có dữ liệu development cần import và không có rollback application tốt trước release đầu. Phương án ưu tiên là giữ DB hiện tại, dừng release khi lỗi, kiểm kê các file đã commit rồi sửa forward có review. Không chạy down/reset/drop/truncate; không tạo database thay thế tự động.

Trước status đầu tiên, lưu SHA/artifact/hashes, extension/server versions, inventory DB trống, thời điểm UTC, env revision/chỉ version secret và bằng chứng Recovery page. Lấy logical export baseline vào vùng lưu trữ riêng được mã hoá/giới hạn truy cập ngoài repository; kiểm tra archive bằng `pg_restore --list`. Với DB mới trống, archive + inventory là bằng chứng baseline; restore drill đầy đủ trên DB riêng phải hoàn tất trước nhận dữ liệu thật. `--list` không chứng minh restore thành công.

**Plan thực tế được user xác nhận: Free.** Render không cung cấp managed PITR hoặc managed logical backup trên Free. Phương án cho instance này là `pg_dump` 16 + verified TLS + file backup được bảo vệ ngoài repository. Chưa có export/archive check/checksum/restore drill thực tế. Workspace plan không làm Free database có PITR. Nếu tương lai dùng paid, recovery window phải kiểm tra lại theo plan/Recovery page; không tự nâng gói hoặc tạo resource. [Render backup/recovery](https://render.com/docs/postgresql-backups).

Lệnh export mẫu chính xác cho PG16, **chỉ sau approval backup và inspector trước migration PASS**, dùng password từ environment thay vì process arguments. `PGSSLROOTCERT` là file CA bundle tin cậy dành cho libpq; Node trust store không tự cấu hình libpq. Không dùng `sslmode=require` thay `verify-full` để né root CA error:

```powershell
# Chỉ sau A PASS + approval B; dùng session Windows backup riêng ở trên.
if ($env:PGSERVICE -or $env:PGSERVICEFILE -or $env:PGOPTIONS) { throw 'Use a clean libpq environment without service/options overrides' }
$backupDirectory = Read-Host 'Existing protected absolute backup directory OUTSIDE repository'
$backupDirectory = (Resolve-Path -LiteralPath $backupDirectory -ErrorAction Stop).Path
$repositoryDirectory = (Resolve-Path ..).Path.TrimEnd([IO.Path]::DirectorySeparatorChar)
if (-not [IO.Path]::IsPathRooted($backupDirectory) -or
    $backupDirectory.Equals($repositoryDirectory, [StringComparison]::OrdinalIgnoreCase) -or
    $backupDirectory.StartsWith($repositoryDirectory + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Backup must stay outside repository'
}
$trustedCa = Read-Host 'Absolute path to verified libpq root CA bundle (from trusted source)'
if (-not (Test-Path -LiteralPath $trustedCa -PathType Leaf)) { throw 'Trusted CA file required' }
$connection = $null
if (-not [Uri]::TryCreate($env:DATABASE_URL, [UriKind]::Absolute, [ref]$connection)) { throw 'Invalid PostgreSQL URL; no connection attempted' }
if ($connection.Scheme -notin @('postgres','postgresql') -or
    $connection.DnsSafeHost -ne $env:WANDERMAP_PROD_HOST -or
    $connection.DnsSafeHost -notmatch '^[a-z0-9-]+(\.[a-z0-9-]+)*\.render\.com$' -or
    $connection.AbsolutePath -ne '/wandermap' -or
    $connection.Port -notin @(-1,5432) -or $connection.Fragment -or
    $connection.Query -notmatch '^(\?sslmode=(require|verify-full))?$' -or
    ($connection.UserInfo -split ':',2)[0] -ne 'wandermap_app' -or
    -not ($connection.UserInfo -split ':',2)[1]) { throw 'Target differs from approved inspection; stop without connecting' }
$env:PGHOST = $connection.DnsSafeHost
$env:PGPORT = '5432'
$env:PGDATABASE = 'wandermap'
$env:PGUSER = 'wandermap_app'
$env:PGPASSWORD = [Uri]::UnescapeDataString(($connection.UserInfo -split ':',2)[1])
$env:PGSSLROOTCERT = (Resolve-Path -LiteralPath $trustedCa).Path
$env:PGCONNECT_TIMEOUT = '10'
$backupFile = Join-Path $backupDirectory ('wandermap-before-001-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '.dump')
try {
    pg_dump --format=custom --no-owner --no-acl --file=$backupFile
    if ($LASTEXITCODE -ne 0) { throw 'Backup failed; stop release' }
    pg_restore --list $backupFile
    if ($LASTEXITCODE -ne 0) { throw 'Backup archive unreadable; stop release' }
    Get-FileHash -LiteralPath $backupFile -Algorithm SHA256
} finally {
    'PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGSSLROOTCERT','PGCONNECT_TIMEOUT' |
        ForEach-Object { Remove-Item -LiteralPath ('Env:' + $_) -ErrorAction SilentlyContinue }
    Remove-Variable connection -ErrorAction SilentlyContinue
}
```

Client `pg_dump/psql` local đã xác định là 16.15; nếu server khác major, dừng review và dùng tools phù hợp trước export. Chưa chạy export/restore trong lượt này. Recovery sau khi có người dùng: backup/PITR và authenticated media inventory, RPO/RTO cụ thể, restore vào database riêng được duyệt, verify checksums/schema/FKs/counts/auth/media rồi mới chuyển kết nối; giữ database nguồn. Không đưa restore có `--clean` vào runbook production.

### 3. Status có thể ghi history — cần approval migration riêng

Chỉ khi tất cả gates PASS và operator duyệt rõ C **status có CREATE history + apply 16 migrations + verify**, từ `/release/backend` trong worker runtime riêng được cấu hình sau approval C. Đây là các lệnh bên trong worker, không chạy trên Windows host hoặc trong session backup. Runtime A chỉ inspect rồi thoát, không giữ secret để tái dùng cho C.

```powershell
npm run db:migrate:prod -- --status
if ($LASTEXITCODE -ne 0) { throw 'STOP: migration status failed' }
```

Kỳ vọng: đúng 16 tên 001–016 pending. Nếu không đúng, dừng review. Lệnh này có thể tạo history trống và không còn đáp ứng precondition của inspector `before`; muốn chạy lại chỉ đọc sau status cần kiểm kê history đã tạo, không xoá history để chạy lại inspector.

### 4. Áp dụng đúng một lần

```powershell
npm run db:migrate:prod
if ($LASTEXITCODE -ne 0) { throw 'STOP: migration failed; preserve DB and inspect partial history' }
```

Kỳ vọng `Applied 16 migration(s).` Không chạy lần hai để chứng minh no-op trên production trong phạm vi phê duyệt này; CI đã kiểm tra rerun trên DB test. Không tự retry khi lỗi, không thêm migrate vào startup hoặc chạy từ nhiều terminals/instances.

### 5. Xác minh sau migration

```powershell
npm run db:migrate:prod -- --status
if ($LASTEXITCODE -ne 0) { throw 'STOP: post-migration status failed' }
node /opt/wandermap-ops/inspect-production.cjs after
if ($LASTEXITCODE -ne 0) { throw 'STOP: post-migration verification failed' }
```

PASS: status 0 pending; 16 history rows tên/checksum khớp từng artifact; đúng các application tables, tất cả chưa có data; indexes valid/ready, có spatial GiST/search GIN và các indexes media chính; constraints validated; 015 normalize ĐÀ LẠT/Đà Nẵng thành da lat/da nang; timestamp trigger enabled; đủ 4 media ownership triggers enabled; coordinates POINT/SRID 4326. Đây là kiểm tra catalog/SELECT; không tạo fixture production để test privacy/spatial/search. Sau đó mới deploy đúng backend artifact và kiểm tra health/smoke riêng theo SMOKE_TEST_CHECKLIST.md. Migration PASS không tương đương toàn bộ Milestone B hay public release PASS.

Kết thúc hoặc khi bất kỳ bước nào lỗi: xoá process secrets rồi đóng shell riêng. Không dùng session này chạy ứng dụng development:

```powershell
'DATABASE_URL','WANDERMAP_PROD_HOST','NODE_ENV','PGSSLMODE','PGPASSWORD' |
    ForEach-Object { Remove-Item -LiteralPath ('Env:' + $_) -ErrorAction SilentlyContinue }
# Đóng terminal operator; không lưu session/transcript có dữ liệu nhạy cảm.
```

## Phạm vi thực tế của lượt này

Lượt đầu: đọc GitHub public/metadata và kiểm tra local. Lượt Resolve Blockers: runtime check và clean checkout/build/verify trong Docker riêng; review/version helpers tách biệt application. Không checkout/reset working tree Windows, commit/push/merge, migration runner/status, inspector database, psql query, pg_dump, Docker Compose hoặc tạo cloud resources. Không đọc/ghi production URL, `.env` hay production data. Application code, dependencies, migrations và scripts backend hiện hữu không thay đổi.

Cần operator cung cấp/chốt: exact external hostname (không credentials), public outbound IP/allowlist phù hợp; thư mục backup ngoài repo đã bảo vệ và CA bundle tin cậy dành cho libpq. Approval A và B tách biệt; kết quả của A/B vẫn đang BLOCKED chờ quyền và kiểm tra thật. Chỉ GO cho migration sau khi mọi gate thực tế PASS và có approval C riêng. Không xin hoặc gửi production password/URL trong chat.
