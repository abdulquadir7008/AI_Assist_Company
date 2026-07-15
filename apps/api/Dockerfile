# Build from the repository root:
#   docker build -f apps/api/Dockerfile .
FROM node:22-bookworm-slim

RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/database/package.json packages/database/
RUN npm ci

COPY packages/database packages/database
COPY apps/api apps/api

RUN npx prisma generate --schema packages/database/prisma/schema.prisma \
  && npm run build --workspace @company-rag/database \
  && npm run build --workspace @company-rag/api

ENV NODE_ENV=production
ENV UPLOAD_DIR=/app/uploads
RUN mkdir -p /app/uploads

EXPOSE 4000

CMD ["sh", "-c", "npx prisma migrate deploy --schema packages/database/prisma/schema.prisma && node apps/api/dist/server.js"]
