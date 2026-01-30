# Stage 1: Builder
FROM node:23-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json vite.config.ts tailwind.config.js ./
COPY src/ ./src/
COPY web/ ./web/
RUN npm run build

# Stage 2: Runtime
FROM node:23-bookworm-slim

WORKDIR /app

# Set HOME explicitly for container
ENV HOME=/root

# Install system dependencies: docker CLI, git, GitHub CLI, and CA certs
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        docker.io \
        git \
        gh \
    && rm -rf /var/lib/apt/lists/*

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

# Add setup script to shell profiles for interactive sessions
RUN printf '%s\n' 'case $- in *i*) /usr/local/bin/setup-gh.sh ;; esac' > /etc/profile.d/cocopilot-setup.sh \
    && chmod +x /etc/profile.d/cocopilot-setup.sh \
    && echo 'case $- in *i*) /usr/local/bin/setup-gh.sh ;; esac' >> /etc/profile \
    && echo 'case $- in *i*) /usr/local/bin/setup-gh.sh ;; esac' >> /etc/bash.bashrc

EXPOSE 3000

CMD ["node", "dist/cli/index.js"]
