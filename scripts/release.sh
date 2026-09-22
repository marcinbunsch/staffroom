#!/bin/bash
set -euo pipefail

# Cut a release: bump the version everywhere, commit, tag, push. Pushing the
# tag is what triggers the Release workflow (the signed macOS build).
# Usage: ./scripts/release.sh <patch|minor|major>

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

BUMP_TYPE="${1:-}"

if [[ ! "$BUMP_TYPE" =~ ^(patch|minor|major)$ ]]; then
  echo "Usage: ./scripts/release.sh <patch|minor|major>"
  exit 1
fi

cd "$PROJECT_DIR"

# Check for uncommitted changes
if ! git diff-index --quiet HEAD --; then
  echo "Error: You have uncommitted changes. Please commit or stash them first."
  exit 1
fi

# Bump the root version, then keep every workspace package on the same one
# (the standalone examples are their own projects and stay at 0.0.0).
echo "Bumping version ($BUMP_TYPE)..."
NEW_VERSION=$(npm version "$BUMP_TYPE" --no-git-tag-version | sed 's/^v//')
for pkg in packages/*/package.json; do
  (cd "$(dirname "$pkg")" && npm pkg set version="$NEW_VERSION")
done

# Commit version bump
echo "Committing version bump..."
git add package.json packages/*/package.json
git commit -m "Release $NEW_VERSION"

# Create and push tag
echo "Creating tag v$NEW_VERSION..."
git tag -a "v$NEW_VERSION" -m "Release v$NEW_VERSION"

echo "Pushing to origin..."
git push origin main
git push origin "v$NEW_VERSION"

echo ""
echo "✅ Release v$NEW_VERSION created and pushed!"
echo "   The Release workflow is building the macOS app:"
echo "   https://github.com/$(git remote get-url origin | sed 's/.*://;s/\.git$//')/actions"
