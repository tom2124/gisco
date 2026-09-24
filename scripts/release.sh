#!/bin/sh
# Build the multi-arch release image and push it to GHCR under a
# user-supplied tag, baking the same tag into the UI About page.
# Usage: ./scripts/release.sh v1.0.0
set -eu

TAG="${1:?usage: $0 <tag>, e.g. $0 v1.0.0}"
PACKAGE="ghcr.io/tom2124/gisco"

cd "$(dirname "$0")/.."

echo "=== backend tests ==="
(cd backend && cargo test)

echo "=== frontend tests ==="
(cd frontend && npm test)

echo "=== frontend typecheck + build ==="
(cd frontend && npm run build)

echo "=== release package ${PACKAGE} version ${TAG} ==="
docker buildx inspect gisco-builder >/dev/null 2>&1 ||
  docker buildx create --name gisco-builder --use

docker buildx build --platform linux/amd64,linux/arm64 \
  --build-arg "APP_VERSION=${TAG}" \
  -t "${PACKAGE}:${TAG}" \
  -t "${PACKAGE}:latest" \
  --push .

echo "pushed ${PACKAGE}:${TAG} and ${PACKAGE}:latest"
