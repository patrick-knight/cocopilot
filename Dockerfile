# Stage 1: Builder
FROM node:26-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json vite.config.ts ./
COPY src/ ./src/
COPY web/ ./web/
RUN npm run build

# Stage 2: Runtime
FROM node:26-bookworm-slim

WORKDIR /app

# Set HOME explicitly for container
ENV HOME=/root
ENV NPM_CONFIG_PREFIX=/root/.cocopilot/npm-global
ENV PATH=/root/.cocopilot/npm-global/bin:$PATH

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

# Create symlinks so gh and copilot-config resolve into the single volume
RUN mkdir -p /root/.config \
    && ln -s /root/.cocopilot/gh /root/.config/gh \
    && ln -s /root/.cocopilot/copilot-config /root/.config/github-copilot

# Copy and setup the GitHub auth helper scripts
COPY docker/setup-gh.sh /usr/local/bin/setup-gh.sh
COPY docker/check-gh.sh /usr/local/bin/check-gh.sh
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/setup-gh.sh /usr/local/bin/check-gh.sh /usr/local/bin/entrypoint.sh

# Create symlink for coco command
RUN ln -s /app/dist/cli/index.js /usr/local/bin/coco && \
    chmod +x /app/dist/cli/index.js

# Ensure npm global bin is on PATH for login shells (Debian /etc/profile resets PATH)
RUN echo 'export PATH=/root/.cocopilot/npm-global/bin:$PATH' > /etc/profile.d/00-cocopilot-path.sh \
    && chmod +x /etc/profile.d/00-cocopilot-path.sh

# Add check script to shell profiles for interactive sessions
# Source (not execute) so $- interactivity check works in the caller's context
RUN printf '%s\n' 'case $- in *i*) . /usr/local/bin/check-gh.sh ;; esac' > /etc/profile.d/cocopilot-check.sh \
    && chmod +x /etc/profile.d/cocopilot-check.sh \
    && echo 'case $- in *i*) . /usr/local/bin/check-gh.sh ;; esac' >> /etc/bash.bashrc

EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "dist/cli/index.js"]
