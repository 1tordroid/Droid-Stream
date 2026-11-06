#!/usr/bin/env bash
# One-time release signing setup for Droid Stream (Linux/macOS). See the .ps1
# version for details. Needs gh (signed in) and keytool.
set -euo pipefail
REPO="${REPO:-1tordroid/Droid-Stream}"
ALIAS="${ALIAS:-droidstream}"
KEYSTORE="${KEYSTORE:-$HOME/droid-stream-release.keystore}"

command -v gh >/dev/null || { echo "Install GitHub CLI: https://cli.github.com" >&2; exit 1; }
command -v keytool >/dev/null || { echo "Install a JDK 17 (keytool)" >&2; exit 1; }
gh auth status >/dev/null

read -rsp "Keystore password (8+ characters, write it down): " PASSWORD; echo
[ ${#PASSWORD} -ge 8 ] || { echo "Too short" >&2; exit 1; }
if [ ! -f "$KEYSTORE" ]; then
  read -rsp "Repeat the password: " CONFIRM; echo
  [ "$PASSWORD" = "$CONFIRM" ] || { echo "Passwords do not match" >&2; exit 1; }
  keytool -genkeypair -v -storetype PKCS12 -keystore "$KEYSTORE" -alias "$ALIAS" \
    -keyalg RSA -keysize 4096 -validity 10000 -storepass "$PASSWORD" -keypass "$PASSWORD" \
    -dname "CN=Tordroid, OU=Droid Stream, O=Tordroid, L=Unknown, ST=Unknown, C=IN"
fi

gh api -X PUT "repos/$REPO/environments/nightly" >/dev/null
base64 < "$KEYSTORE" | tr -d '\n' | gh secret set KEYSTORE_BASE64 --repo "$REPO"
base64 < "$KEYSTORE" | tr -d '\n' | gh secret set KEYSTORE_BASE64 --repo "$REPO" --env nightly
for pair in "KEYSTORE_PASSWORD=$PASSWORD" "KEY_ALIAS=$ALIAS" "KEY_PASSWORD=$PASSWORD"; do
  name="${pair%%=*}"; value="${pair#*=}"
  printf '%s' "$value" | gh secret set "$name" --repo "$REPO"
  printf '%s' "$value" | gh secret set "$name" --repo "$REPO" --env nightly
done
echo "Done. Back up $KEYSTORE and the password somewhere safe."
