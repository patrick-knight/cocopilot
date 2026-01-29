# Stage 1: Builder
FROM node:23-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json vite.config.ts tailwind.config.js ./
COPY src/ ./src/
COPY web/ ./web/
RUN npm run build

# Stage 2: Runtime
FROM node:23-alpine

WORKDIR /app

RUN apk add --no-cache docker-cli

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-web ./dist-web

EXPOSE 3000

CMD ["node", "dist/cli/index.js"]
