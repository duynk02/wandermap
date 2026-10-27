FROM node:22.23.4-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --include=dev --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22.23.4-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/package*.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
# Production uses authenticated Cloudinary storage; this directory supports local test/dev only.
RUN mkdir -p /data/uploads && chown node:node /data/uploads
ENV UPLOAD_DIR=/data/uploads
USER node
EXPOSE 4000
CMD ["node", "dist/main.js"]
