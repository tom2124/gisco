use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::Deserialize;

use crate::routes::error::docker_error;
use crate::routes::AppState;

#[derive(Deserialize)]
pub struct PullImageRequest {
    pub image: String,
    pub tag: Option<String>,
}

#[derive(Deserialize)]
pub struct DeleteImageQuery {
    pub force: Option<bool>,
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(list_images))
        .route("/pull", post(pull_image))
        .route("/{id}", get(inspect_image))
        .route("/{id}", delete(remove_image))
}

async fn list_images(State(state): State<AppState>) -> impl IntoResponse {
    match state.docker.list_images().await {
        Ok(images) => (StatusCode::OK, Json(serde_json::json!(images))),
        Err(e) => docker_error(e),
    }
}

async fn inspect_image(Path(id): Path<String>, State(state): State<AppState>) -> impl IntoResponse {
    match state.docker.inspect_image(&id).await {
        Ok(img) => (StatusCode::OK, Json(serde_json::json!(img))),
        Err(e) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": e.to_string() })),
        ),
    }
}

async fn pull_image(
    State(state): State<AppState>,
    Json(payload): Json<PullImageRequest>,
) -> impl IntoResponse {
    if payload.image.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Image name cannot be empty" })),
        );
    }

    match state
        .docker
        .pull_image(&payload.image, payload.tag.as_deref())
        .await
    {
        Ok(()) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "status": "success",
                "image": payload.image,
                "tag": payload.tag.unwrap_or_else(|| "latest".to_string())
            })),
        ),
        Err(e) => docker_error(e),
    }
}

async fn remove_image(
    Path(id): Path<String>,
    Query(query): Query<DeleteImageQuery>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let force = query.force.unwrap_or(false);
    match state.docker.remove_image(&id, force).await {
        Ok(()) => (
            StatusCode::OK,
            Json(serde_json::json!({ "status": "deleted", "id": id })),
        ),
        Err(e) => docker_error(e),
    }
}
