use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::Deserialize;

use crate::network_graph::NetworkGraphBuilder;
use crate::routes::error::docker_error;
use crate::routes::AppState;

#[derive(Deserialize)]
pub struct CreateNetworkRequest {
    pub name: String,
    pub driver: Option<String>,
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(list_networks))
        .route("/", post(create_network))
        .route("/topology", get(get_topology))
        .route("/{id}", get(inspect_network))
        .route("/{id}", delete(remove_network))
}

async fn list_networks(State(state): State<AppState>) -> impl IntoResponse {
    match state.docker.list_networks().await {
        Ok(networks) => (StatusCode::OK, Json(serde_json::json!(networks))),
        Err(e) => docker_error(e),
    }
}

async fn get_topology(State(state): State<AppState>) -> impl IntoResponse {
    match NetworkGraphBuilder::build(&state.docker).await {
        Ok(graph) => (StatusCode::OK, Json(serde_json::json!(graph))),
        Err(e) => docker_error(e),
    }
}

async fn inspect_network(
    Path(id): Path<String>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    match state.docker.inspect_network(&id).await {
        Ok(network) => (StatusCode::OK, Json(serde_json::json!(network))),
        Err(e) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": e.to_string() })),
        ),
    }
}

async fn create_network(
    State(state): State<AppState>,
    Json(payload): Json<CreateNetworkRequest>,
) -> impl IntoResponse {
    if payload.name.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Network name cannot be empty" })),
        );
    }

    match state.docker.create_network(&payload.name, payload.driver.as_deref()).await {
        Ok(resp) => (
            StatusCode::CREATED,
            Json(serde_json::json!(resp)),
        ),
        Err(e) => docker_error(e),
    }
}

async fn remove_network(
    Path(id): Path<String>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    match state.docker.remove_network(&id).await {
        Ok(()) => (
            StatusCode::OK,
            Json(serde_json::json!({ "status": "deleted", "id": id })),
        ),
        Err(e) => docker_error(e),
    }
}
