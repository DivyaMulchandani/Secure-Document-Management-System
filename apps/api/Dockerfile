FROM node:20-alpine

WORKDIR /app

# Copy workspace manifests first for better layer caching.
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm install --workspaces --if-present --include-workspace-root

# Now copy source.
COPY apps/api apps/api
COPY packages/shared packages/shared

RUN mkdir -p /data/storage

ENV NODE_ENV=production
ENV STORAGE_ROOT_PATH=/data/storage
ENV PORT=4000

EXPOSE 4000

CMD ["node", "apps/api/src/index.js"]
