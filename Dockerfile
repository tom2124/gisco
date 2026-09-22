# Stage 1: Build React frontend
FROM node:22-alpine AS frontend-builder
# Baked into the UI About section (tag or commit hash); release CI passes this.
ARG APP_VERSION
ENV APP_VERSION=${APP_VERSION}
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: Build Rust backend
FROM rust:1.88-slim-bookworm AS backend-builder
WORKDIR /app
COPY Cargo.toml ./
COPY backend/Cargo.toml ./backend/
RUN mkdir -p backend/src && echo "fn main() {}" > backend/src/main.rs
RUN cargo build --release || true
COPY backend/src ./backend/src
RUN touch backend/src/main.rs && cargo build --release

# Stage 3: Minimal production runtime
FROM debian:bookworm-slim
WORKDIR /app

# Install ca-certificates, curl, and docker CLI + compose plugin
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gnupg \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
    && chmod a+r /etc/apt/keyrings/docker.gpg \
    && echo "deb [arch="$(dpkg --print-architecture)" signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian "$(. /etc/os-release && echo "$VERSION_CODENAME")" stable" > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
    docker-ce-cli \
    docker-compose-plugin \
    && rm -rf /var/lib/apt/lists/*

COPY --from=backend-builder /app/target/release/gisco-backend /usr/local/bin/gisco
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

# Default directories
RUN mkdir -p /stacks /templates
COPY templates/ /templates/

ENV GISCO_PORT=8080
ENV GISCO_STACK_DIR=/stacks
ENV GISCO_TEMPLATE_DIR=/templates
ENV GISCO_STATIC_DIR=/app/frontend/dist
ENV GISCO_DEFAULT_UID=1000
ENV GISCO_DEFAULT_GID=1000

EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/gisco"]
