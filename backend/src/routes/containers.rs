use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::Deserialize;

use crate::docker::stats::get_single_stats;
use crate::routes::error::docker_error;
use crate::routes::AppState;

#[derive(Deserialize)]
pub struct ListContainersQuery {
    pub all: Option<bool>,
}

#[derive(Deserialize)]
pub struct DeleteContainerQuery {
    pub force: Option<bool>,
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(list_containers))
        .route("/{id}", get(inspect_container))
        .route("/{id}", delete(remove_container))
        .route("/{id}/{action}", post(container_action))
        .route("/{id}/metrics", get(container_metrics))
}

async fn list_containers(
    Query(query): Query<ListContainersQuery>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let all = query.all.unwrap_or(true);
    match state.docker.list_containers(all).await {
        Ok(containers) => (StatusCode::OK, Json(serde_json::json!(containers))),
        Err(e) => docker_error(e),
    }
}

async fn inspect_container(
    Path(id): Path<String>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    match state.docker.inspect_container(&id).await {
        Ok(inspect) => (StatusCode::OK, Json(serde_json::json!(inspect))),
        Err(e) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": e.to_string() })),
        ),
    }
}

async fn container_action(
    Path((id, action)): Path<(String, String)>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let res = match action.as_str() {
        "start" => state.docker.start_container(&id).await,
        "stop" => state.docker.stop_container(&id).await,
        "restart" => state.docker.restart_container(&id).await,
        "pause" => state.docker.pause_container(&id).await,
        "unpause" => state.docker.unpause_container(&id).await,
        _ => return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": format!("Unknown container action '{}'", action) })),
        ),
    };

    match res {
        Ok(()) => (
            StatusCode::OK,
            Json(serde_json::json!({ "status": "success", "action": action, "id": id })),
        ),
        Err(e) => docker_error(e),
    }
}

async fn remove_container(
    Path(id): Path<String>,
    Query(query): Query<DeleteContainerQuery>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let force = query.force.unwrap_or(false);
    match state.docker.remove_container(&id, force).await {
        Ok(()) => (
            StatusCode::OK,
            Json(serde_json::json!({ "status": "deleted", "id": id })),
        ),
        Err(e) => docker_error(e),
    }
}

async fn container_metrics(
    Path(id): Path<String>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    match get_single_stats(&state.docker.client, &id).await {
        Ok(metrics) => (StatusCode::OK, Json(serde_json::json!(metrics))),
        Err(e) => docker_error(e),
    }
}
