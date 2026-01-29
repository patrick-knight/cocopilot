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

# Set HOME explicitly for Alpine
ENV HOME=/root

# Install system dependencies: docker-cli, git, github-cli
RUN apk add --no-cache \
    docker-cli \
    git \
    github-cli

# Install GitHub Copilot CLI extension
# Note: This requires gh auth, so it may need to be done at runtime
# RUN gh extension install github/gh-copilot

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-web ./dist-web

# Copy and setup the GitHub auth helper script
COPY docker/setup-gh.sh /usr/local/bin/setup-gh.sh
RUN chmod +x /usr/local/bin/setup-gh.sh

# Create symlink for coco command
RUN ln -s /app/dist/cli/index.js /usr/local/bin/coco && \
    chmod +x /app/dist/cli/index.js

# Add setup script to shell profile for interactive sessions
RUN echo '[ -z "$PS1" ] || /usr/local/bin/setup-gh.sh' >> /etc/profile

EXPOSE 3000

CMD ["node", "dist/cli/index.js"]
