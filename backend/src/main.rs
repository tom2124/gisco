use std::net::SocketAddr;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;
use tracing::{error, info};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod compose;
mod config;
mod docker;
mod network_graph;
mod routes;
mod templates;

use compose::StacksManager;
use config::Config;
use docker::DockerService;
use routes::{api_routes, AppState};
use templates::TemplatesManager;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize tracing
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "gisco_backend=info,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    info!("=== Starting gisco (Docker & Compose Manager) ===");

    let config = Config::from_env();
    if let Err(e) = config.ensure_directories() {
        error!("Failed to ensure stack/template directories: {:?}", e);
        return Err(e.into());
    }

    info!("Configuration:");
    info!("  Port:             {}", config.port);
    info!("  Stack Dir:        {:?}", config.stack_dir);
    info!("  Template Dir:     {:?}", config.template_dir);
    info!(
        "  Default UID/GID:  {}:{}",
        config.default_uid, config.default_gid
    );
    info!("  Docker Socket:    {}", config.docker_socket);

    // Initialize Docker client
    let docker = match DockerService::new(&config.docker_socket) {
        Ok(d) => {
            if d.ping().await {
                info!(
                    "Successfully connected to Docker daemon at {}",
                    config.docker_socket
                );
            } else {
                tracing::warn!(
                    "Docker daemon at {} did not respond to ping. Will keep retrying on request.",
                    config.docker_socket
                );
            }
            d
        }
        Err(e) => {
            tracing::warn!(
                "Failed to initialize Docker client ({:?}). Endpoints will report disconnect until socket is ready.",
                e
            );
            DockerService::new("unix:///var/run/docker.sock")
                .unwrap_or_else(|_| panic!("Failed fallback initialization"))
        }
    };

    let stacks = StacksManager::new(
        config.stack_dir.clone(),
        config.default_uid,
        config.default_gid,
    );
    let templates = TemplatesManager::new(config.template_dir.clone(), stacks.clone());

    let state = AppState {
        config: config.clone(),
        docker,
        stacks,
        templates,
    };

    // The UI is served same-origin and Vite proxies `/api` in development.
    // Avoid permissive CORS on an unauthenticated Docker management API.
    let mut app = api_routes(state).layer(TraceLayer::new_for_http());

    // Serve static files if frontend build is available
    if let Some(static_path) = &config.static_dir {
        if static_path.exists() {
            info!("Serving frontend static files from {:?}", static_path);
            let index_file = static_path.join("index.html");
            let serve_dir =
                ServeDir::new(static_path).not_found_service(ServeFile::new(index_file));
            app = app.fallback_service(serve_dir);
        }
    }

    let addr = SocketAddr::from(([0, 0, 0, 0], config.port));
    info!("gisco server listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
