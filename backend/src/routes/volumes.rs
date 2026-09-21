use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{delete, get};
use axum::{Json, Router};
use serde::Deserialize;

use crate::routes::error::docker_error;
use crate::routes::AppState;

#[derive(Deserialize)]
pub struct DeleteVolumeQuery {
    pub force: Option<bool>,
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(list_volumes))
        .route("/{name}", delete(remove_volume))
}

async fn list_volumes(State(state): State<AppState>) -> impl IntoResponse {
    match state.docker.list_volumes().await {
        Ok(vols) => (StatusCode::OK, Json(serde_json::json!(vols.volumes.unwrap_or_default()))),
        Err(e) => docker_error(e),
    }
}

async fn remove_volume(
    Path(name): Path<String>,
    Query(query): Query<DeleteVolumeQuery>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let force = query.force.unwrap_or(false);
    match state.docker.remove_volume(&name, force).await {
        Ok(()) => (
            StatusCode::OK,
            Json(serde_json::json!({ "status": "deleted", "name": name })),
        ),
        Err(e) => docker_error(e),
    }
}
