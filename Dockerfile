# Stage 1: Builder
FROM node:23-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json vite.config.ts ./
COPY src/ ./src/
COPY web/ ./web/
RUN npm run build

# Stage 2: Runtime
FROM node:23-bookworm-slim

WORKDIR /app

# Set HOME explicitly for container
ENV HOME=/root
ENV NPM_CONFIG_PREFIX=/root/.npm-global
ENV PATH=/root/.npm-global/bin:$PATH

# Install system dependencies: Docker CLI, git, GitHub CLI, tmux, and CA certs
RUN rm -rf /var/lib/apt/lists/* \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        gnupg \
        lsb-release \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
    && chmod a+r /etc/apt/keyrings/docker.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(lsb_release -cs) stable" \
        > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        docker-ce-cli \
        git \
        gh \
        tmux \
    && rm -rf /var/lib/apt/lists/* \
    || (rm -rf /var/lib/apt/lists/* \
        && apt-get update \
        && apt-get install -y --no-install-recommends \
            ca-certificates \
            curl \
            gnupg \
            lsb-release \
        && install -m 0755 -d /etc/apt/keyrings \
        && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
        && chmod a+r /etc/apt/keyrings/docker.gpg \
        && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(lsb_release -cs) stable" \
            > /etc/apt/sources.list.d/docker.list \
        && apt-get update \
        && apt-get install -y --no-install-recommends \
            docker-ce-cli \
            git \
            gh \
            tmux \
        && rm -rf /var/lib/apt/lists/*)

# Install GitHub Copilot CLI extension
# Note: This requires gh auth, so it may need to be done at runtime
# RUN gh extension install github/gh-copilot

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-web ./dist-web

# Copy and setup the GitHub auth helper scripts
COPY docker/setup-gh.sh /usr/local/bin/setup-gh.sh
COPY docker/check-gh.sh /usr/local/bin/check-gh.sh
RUN chmod +x /usr/local/bin/setup-gh.sh /usr/local/bin/check-gh.sh

# Create symlink for coco command
RUN ln -s /app/dist/cli/index.js /usr/local/bin/coco && \
    chmod +x /app/dist/cli/index.js

# Add check script to shell profiles for interactive sessions
# This runs on every login and re-runs setup if gh auth or copilot is missing
RUN printf '%s\n' '/usr/local/bin/check-gh.sh' > /etc/profile.d/cocopilot-check.sh \
    && chmod +x /etc/profile.d/cocopilot-check.sh \
    && echo '/usr/local/bin/check-gh.sh' >> /etc/bash.bashrc

EXPOSE 3000

CMD ["node", "dist/cli/index.js"]
