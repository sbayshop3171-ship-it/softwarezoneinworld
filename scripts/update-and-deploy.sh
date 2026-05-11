#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

if [[ "${1:-}" == "" ]]; then
  COMMIT_MSG="update: $(date +'%Y-%m-%d %H:%M:%S')"
else
  COMMIT_MSG="$*"
fi

git add -A

if git diff --cached --quiet; then
  echo "No changes to commit. Working tree is clean."
  exit 0
fi

git commit -m "${COMMIT_MSG}"
git push origin main

echo
echo "Done: Changes pushed to GitHub (main)."
echo "GitHub Actions will deploy automatically."
