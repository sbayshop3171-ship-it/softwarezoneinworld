#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${ROOT_DIR}/dist"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_FILE="${DIST_DIR}/mehedi-deploy-${STAMP}.zip"

required_items=(
  "server.js"
  "package.json"
  "package-lock.json"
  "database.db"
  "public"
  "scripts/verify-live-api.sh"
  "LIVE_DEPLOY_CHECKLIST.md"
)

cd "${ROOT_DIR}"

missing=0
for item in "${required_items[@]}"; do
  if [[ ! -e "${item}" ]]; then
    echo "Missing required item: ${item}" >&2
    missing=1
  fi
done

if [[ "${missing}" -ne 0 ]]; then
  exit 1
fi

mkdir -p "${DIST_DIR}"
rm -f "${OUT_FILE}" "${OUT_FILE}.sha256"

zip -rq "${OUT_FILE}" "${required_items[@]}"
shasum -a 256 "${OUT_FILE}" > "${OUT_FILE}.sha256"

echo "Deploy package created:"
echo "  ${OUT_FILE}"
echo "Checksum:"
echo "  ${OUT_FILE}.sha256"
echo
echo "Next:"
echo "1) Upload zip and extract in your FastPanel app root"
echo "2) Run: npm install --omit=dev"
echo "3) Restart Node app"
echo "4) Run: ./scripts/verify-live-api.sh https://softwarezoneinworld.store"
