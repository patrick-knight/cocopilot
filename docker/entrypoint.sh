#!/bin/sh
# Ensure volume subdirectories exist before anything runs.
# These must be created at runtime (after the volume is mounted),
# not at build time, because the volume mount replaces the directory.
mkdir -p /root/.cocopilot/gh \
         /root/.cocopilot/copilot-config \
         /root/.cocopilot/npm-global \
         /root/.cocopilot/repos

# Setup git credentials using gh if authenticated
if gh auth status >/dev/null 2>&1; then
  gh auth setup-git 2>/dev/null || true
fi

# Setup git user identity if not already configured
if ! git config --global user.email >/dev/null 2>&1; then
  git config --global user.email "cocopilot@localhost"
  git config --global user.name "CoCoPilot"
fi

exec "$@"
