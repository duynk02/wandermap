# This operational build context contains only the allowlisted helpers, never app .env or Windows artifacts.
FROM node@sha256:63538dfe497cc29dfafdda25ada09b46db68a3f4cc205abf1f5d6bf0913f3384
LABEL org.opencontainers.image.revision="818d5f88c2169ca5dc3e5f59e90888c1bcf2d20a"
LABEL com.wandermap.purpose="milestone-b-preflight-no-migrations"
ENV WANDERMAP_RELEASE_ROOT=/release
RUN test "$(node --version)" = v22.23.4 && test "$(uname -m)" = x86_64
RUN git init /release \
    && git -C /release remote add origin https://github.com/duynk02/wandermap.git \
    && git -C /release fetch --no-tags origin 818d5f88c2169ca5dc3e5f59e90888c1bcf2d20a \
    && git -C /release -c advice.detachedHead=false checkout --detach 818d5f88c2169ca5dc3e5f59e90888c1bcf2d20a \
    && test "$(git -C /release rev-parse HEAD)" = 818d5f88c2169ca5dc3e5f59e90888c1bcf2d20a \
    && test -z "$(git -C /release status --porcelain)" \
    && test ! -d /release/backend/node_modules && test ! -d /release/backend/dist
COPY verify-artifact.cjs inspect-production.cjs runtime-inspect.sh record-worker.cjs /opt/wandermap-ops/
WORKDIR /release/backend
RUN test ! -f .env && test -z "${DATABASE_URL:-}" && test -z "${WANDERMAP_TEST_DATABASE_URL:-}" \
    && npm ci --include=dev --no-audit --no-fund
RUN npm run type-check \
    && npm run test:transport \
    && npm test -- --runInBand --runTestsByPath src/database/migration-artifact.spec.ts \
    && npm run build
RUN node --check /opt/wandermap-ops/inspect-production.cjs \
    && bash -n /opt/wandermap-ops/runtime-inspect.sh \
    && node /opt/wandermap-ops/record-worker.cjs \
    && tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner -cf /artifacts/backend-release.tar \
       dist package.json package-lock.json scripts/historical-migrations.json \
    && sha256sum /artifacts/backend-release.tar /artifacts/compiled-files.json /artifacts/worker-verification.json > /artifacts/SHA256SUMS \
    && chown -R node:node /release /artifacts /opt/wandermap-ops
USER node
CMD ["node", "/opt/wandermap-ops/verify-artifact.cjs"]
