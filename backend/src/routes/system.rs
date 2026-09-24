use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use serde::Serialize;

use crate::routes::AppState;

#[derive(Serialize)]
pub struct SystemStatus {
    pub docker_connected: bool,
    pub docker_version: Option<String>,
    pub docker_api_version: Option<String>,
    pub os: Option<String>,
    pub arch: Option<String>,
    pub containers_total: Option<usize>,
    pub containers_running: Option<usize>,
    pub containers_paused: Option<usize>,
    pub containers_stopped: Option<usize>,
    pub images_count: Option<usize>,
    pub host_name: Option<String>,
    pub storage_driver: Option<String>,
    pub cpu_count: Option<usize>,
    pub memory_total: Option<u64>,
    pub docker_root_dir: Option<String>,
    pub stack_dir: String,
    pub template_dir: String,
    pub default_uid: u32,
    pub default_gid: u32,
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/status", get(get_status))
        .route("/ping", get(ping_docker))
}

async fn get_status(State(state): State<AppState>) -> impl IntoResponse {
    let ping = state.docker.ping().await;
    let version = if ping {
        state.docker.version().await.ok()
    } else {
        None
    };
    let info = if ping {
        state.docker.info().await.ok()
    } else {
        None
    };

    let status = SystemStatus {
        docker_connected: ping,
        docker_version: version.as_ref().and_then(|v| v.version.clone()),
        docker_api_version: version.as_ref().and_then(|v| v.api_version.clone()),
        os: info.as_ref().and_then(|i| i.operating_system.clone()),
        arch: info.as_ref().and_then(|i| i.architecture.clone()),
        containers_total: info.as_ref().and_then(|i| i.containers.map(|c| c as usize)),
        containers_running: info
            .as_ref()
            .and_then(|i| i.containers_running.map(|c| c as usize)),
        containers_paused: info
            .as_ref()
            .and_then(|i| i.containers_paused.map(|c| c as usize)),
        containers_stopped: info
            .as_ref()
            .and_then(|i| i.containers_stopped.map(|c| c as usize)),
        images_count: info.as_ref().and_then(|i| i.images.map(|c| c as usize)),
        host_name: info.as_ref().and_then(|i| i.name.clone()),
        storage_driver: info.as_ref().and_then(|i| i.driver.clone()),
        cpu_count: info
            .as_ref()
            .and_then(|i| i.ncpu.map(|c| c.max(0) as usize)),
        memory_total: info
            .as_ref()
            .and_then(|i| i.mem_total)
            .map(|memory| memory.max(0) as u64),
        docker_root_dir: info.as_ref().and_then(|i| i.docker_root_dir.clone()),
        stack_dir: state.config.stack_dir.to_string_lossy().to_string(),
        template_dir: state.config.template_dir.to_string_lossy().to_string(),
        default_uid: state.config.default_uid,
        default_gid: state.config.default_gid,
    };

    Json(status)
}

async fn ping_docker(State(state): State<AppState>) -> impl IntoResponse {
    let ok = state.docker.ping().await;
    if ok {
        (StatusCode::OK, Json(serde_json::json!({ "status": "ok" })))
    } else {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({ "status": "disconnected" })),
        )
    }
}
