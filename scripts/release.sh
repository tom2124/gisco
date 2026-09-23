#!/bin/sh
# Build the multi-arch release image and push it to GHCR under a
# user-supplied tag, baking the same tag into the UI About page.
# Usage: ./scripts/release.sh v1.0.0
set -eu

TAG="${1:?usage: $0 <tag>, e.g. $0 v1.0.0}"
IMAGE="ghcr.io/tom2124/gisco:${TAG}"

cd "$(dirname "$0")/.."

echo "=== backend tests ==="
(cd backend && cargo test)

echo "=== frontend tests ==="
(cd frontend && npm test)

echo "=== frontend typecheck + build ==="
(cd frontend && npm run build)

echo "=== release image ${IMAGE} ==="
docker buildx inspect gisco-builder >/dev/null 2>&1 \
  || docker buildx create --name gisco-builder --use

docker buildx build --platform linux/amd64,linux/arm64 \
  --build-arg "APP_VERSION=${TAG}" \
  -t "${IMAGE}" \
  --push .

echo "pushed ${IMAGE}"
