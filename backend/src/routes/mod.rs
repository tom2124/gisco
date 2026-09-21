pub mod containers;
pub mod error;
pub mod images;
pub mod networks;
pub mod stacks;
pub mod system;
pub mod templates;
pub mod volumes;
pub mod ws_logs;
pub mod ws_stats;
pub mod ws_terminal;

use axum::Router;

use crate::config::Config;
use crate::compose::StacksManager;
use crate::docker::DockerService;
use crate::templates::TemplatesManager;

#[derive(Clone)]
pub struct AppState {
    pub config: Config,
    pub docker: DockerService,
    pub stacks: StacksManager,
    pub templates: TemplatesManager,
}

pub fn api_routes(state: AppState) -> Router {
    Router::new()
        .nest("/api/system", system::routes())
        .nest("/api/stacks", stacks::routes())
        .nest("/api/containers", containers::routes())
        .nest("/api/templates", templates::routes())
        .nest("/api/networks", networks::routes())
        .nest("/api/images", images::routes())
        .nest("/api/volumes", volumes::routes())
        .nest("/api/ws", ws_routes())
        .with_state(state)
}

fn ws_routes() -> Router<AppState> {
    Router::new()
        .route("/containers/{id}/terminal", axum::routing::get(ws_terminal::terminal_handler))
        .route("/containers/{id}/logs", axum::routing::get(ws_logs::logs_handler))
        .route("/containers/{id}/stats", axum::routing::get(ws_stats::stats_handler))
        .route("/stacks/{name}/action-stream", axum::routing::get(stacks::stack_action_ws_handler))
}
