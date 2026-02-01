#!/bin/sh
# Ensure volume subdirectories exist before anything runs.
# These must be created at runtime (after the volume is mounted),
# not at build time, because the volume mount replaces the directory.
mkdir -p /root/.cocopilot/gh \
         /root/.cocopilot/copilot-config \
         /root/.cocopilot/npm-global
exec "$@"
