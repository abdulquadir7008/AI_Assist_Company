# Build from the repository root:
#   docker build -f apps/web/Dockerfile .
FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/database/package.json packages/database/
RUN npm ci

COPY apps/web apps/web

# NEXT_PUBLIC_* values are inlined at build time. The browser calls the API
# from the host machine, so this must be the host-published API URL.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

RUN npm run build --workspace @company-rag/web

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "run", "start", "--workspace", "@company-rag/web"]
