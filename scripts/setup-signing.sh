#!/bin/bash
set -euo pipefail

# One-time setup for signed + notarized CI releases: export the Developer ID
# certificate from the login keychain and push the five STAFF_SIGN_* secrets
# to the GitHub repo. Run it on the Mac that holds the certificate; it reads
# STAFF_SIGN_IDENTITY / STAFF_SIGN_APPLE_ID / STAFF_SIGN_APP_PASSWORD from the
# local .env (see .env.example) and never writes a secret anywhere but the
# GitHub secret store. Usage: ./scripts/setup-signing.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

REPO="$(git remote get-url origin | sed 's/.*://;s/\.git$//')"

set -a
# shellcheck source=/dev/null
source .env
set +a
: "${STAFF_SIGN_IDENTITY:?Set STAFF_SIGN_IDENTITY in .env first}"
: "${STAFF_SIGN_APPLE_ID:?Set STAFF_SIGN_APPLE_ID in .env first}"
: "${STAFF_SIGN_APP_PASSWORD:?Set STAFF_SIGN_APP_PASSWORD in .env first}"

echo "Exporting \"$STAFF_SIGN_IDENTITY\" from the login keychain."
echo "Pick a password for the export when prompted — it protects the .p12 in"
echo "transit and becomes the STAFF_SIGN_CERT_PASSWORD secret."
read -r -s -p "Export password: " CERT_PASSWORD
echo

P12="$(mktemp -d)/signing.p12"
trap 'rm -rf "$(dirname "$P12")"' EXIT
# macOS will ask for the login keychain password to release the private key.
security export -t identities -f pkcs12 -P "$CERT_PASSWORD" -o "$P12"

echo "Setting secrets on $REPO..."
gh secret set STAFF_SIGN_CERT_P12 --repo "$REPO" --body "$(base64 -i "$P12")"
gh secret set STAFF_SIGN_CERT_PASSWORD --repo "$REPO" --body "$CERT_PASSWORD"
gh secret set STAFF_SIGN_IDENTITY --repo "$REPO" --body "$STAFF_SIGN_IDENTITY"
gh secret set STAFF_SIGN_APPLE_ID --repo "$REPO" --body "$STAFF_SIGN_APPLE_ID"
gh secret set STAFF_SIGN_APP_PASSWORD --repo "$REPO" --body "$STAFF_SIGN_APP_PASSWORD"

echo
gh secret list --repo "$REPO"
echo
echo "✅ Done. The next tagged release (pnpm release:patch) builds signed and notarized."
