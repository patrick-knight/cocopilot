#!/bin/sh
# Interactive GitHub CLI and Copilot setup for CoCoPilot container
# This script runs on first shell login to ensure gh auth and gh-copilot extension are configured

set -e

SETUP_MARKER="/root/.cocopilot/gh-setup-complete"

# Check if setup has already been completed
if [ -f "$SETUP_MARKER" ]; then
    exit 0
fi

echo ""
echo "🍫 Welcome to CoCoPilot!"
echo ""

# Check gh auth status
if ! gh auth status >/dev/null 2>&1; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "📝 GitHub CLI Authentication Required"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "CoCoPilot needs GitHub authentication to work with repositories"
    echo "and spawn Copilot agents."
    echo ""
    echo "Starting GitHub authentication..."
    echo ""
    
    if ! gh auth login; then
        echo ""
        echo "⚠️  GitHub authentication failed. You can try again later with:"
        echo "    gh auth login"
        echo ""
        exit 1
    fi
    
    echo ""
    echo "✅ GitHub authentication successful!"
    echo ""
else
    echo "✅ GitHub CLI already authenticated"
    echo ""
fi

# Install GitHub Copilot CLI via npm
if ! command -v copilot >/dev/null 2>&1; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "🤖 GitHub Copilot CLI Setup"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "Installing GitHub Copilot CLI (npm)..."
    echo "This enables AI-powered code assistance for workers."
    echo ""

    if npm install -g @github/copilot; then
        echo ""
        echo "✅ GitHub Copilot CLI installed!"
        echo ""
    else
        echo ""
        echo "Retrying with OpenSSL legacy provider..."
        echo ""
        if NODE_OPTIONS=--openssl-legacy-provider npm install -g @github/copilot; then
            echo ""
            echo "✅ GitHub Copilot CLI installed!"
            echo ""
        else
            echo ""
            echo "⚠️  Failed to install GitHub Copilot CLI. You can try again with:"
            echo "    NODE_OPTIONS=--openssl-legacy-provider npm install -g @github/copilot"
            echo ""
            exit 1
        fi
    fi
else
    echo "✅ GitHub Copilot CLI already installed"
    echo ""
fi

# Mark setup as complete
mkdir -p "$(dirname "$SETUP_MARKER")"
touch "$SETUP_MARKER"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎉 Setup Complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "You're ready to use CoCoPilot!"
echo ""
echo "Quick commands:"
echo "  coco status                    - Check daemon status"
echo "  coco init <repo-url>           - Initialize a repository"
echo "  copilot                        - Start Copilot CLI"
echo ""
echo "Web dashboard: http://localhost:3000"
echo ""
