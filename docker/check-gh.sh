#!/bin/sh
# GitHub CLI and Copilot check for CoCoPilot container
# This script runs on every shell login to ensure gh auth and copilot are available
# If either is missing, it re-runs the full setup script

# Only run for interactive shells
case $- in
    *i*) ;;
    *) exit 0 ;;
esac

NEEDS_SETUP=0

# Check gh auth status (quietly)
if ! gh auth status >/dev/null 2>&1; then
    echo "⚠️  GitHub CLI not authenticated"
    NEEDS_SETUP=1
fi

# Check if copilot CLI is installed
if ! command -v copilot >/dev/null 2>&1; then
    echo "⚠️  GitHub Copilot CLI not installed"
    NEEDS_SETUP=1
fi

# If either check failed, remove marker and re-run setup
if [ "$NEEDS_SETUP" = "1" ]; then
    echo ""
    echo "🔧 Running CoCoPilot setup..."
    echo ""
    # Remove the setup marker so setup-gh.sh will run fully
    rm -f /root/.cocopilot/gh-setup-complete
    # Run the setup script
    /usr/local/bin/setup-gh.sh
fi

# Check if coco daemon is running
if ! curl -s http://localhost:3000/api/v1/status >/dev/null 2>&1; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "⚠️  CoCoPilot daemon is not running!"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "Start the daemon with:"
    echo "  coco start"
    echo ""
    echo "Or run in foreground:"
    echo "  coco start --foreground"
    echo ""
fi
