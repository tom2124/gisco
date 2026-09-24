use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::Deserialize;

use crate::compose::{valid_path_component, valid_stack_name};
use crate::routes::AppState;

#[derive(Deserialize)]
pub struct InstantiateTemplateRequest {
    pub stack_name: String,
    pub env_content: Option<String>,
    pub custom_uid: Option<u32>,
    pub custom_gid: Option<u32>,
}

#[derive(Deserialize)]
pub struct SaveTemplateRequest {
    pub content: String,
    /// Defaults to true for API compatibility; the UI sends false for new
    /// templates and true when editing an existing one.
    #[serde(default = "default_true")]
    pub overwrite: bool,
}

fn default_true() -> bool {
    true
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(list_templates))
        .route("/{id}", get(get_template))
        .route("/{id}", post(save_template))
        .route("/{id}", delete(delete_template))
        .route("/{id}/instantiate", post(instantiate_template))
}

async fn list_templates(State(state): State<AppState>) -> impl IntoResponse {
    match state.templates.list_templates() {
        Ok(templates) => (StatusCode::OK, Json(serde_json::json!(templates))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        ),
    }
}

async fn get_template(Path(id): Path<String>, State(state): State<AppState>) -> impl IntoResponse {
    match state.templates.get_template(&id) {
        Ok(details) => (StatusCode::OK, Json(serde_json::json!(details))),
        Err(e) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": e.to_string() })),
        ),
    }
}

async fn save_template(
    Path(id): Path<String>,
    State(state): State<AppState>,
    Json(payload): Json<SaveTemplateRequest>,
) -> impl IntoResponse {
    if !valid_path_component(&id) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Invalid template id" })),
        );
    }
    if !payload.overwrite {
        let yml_path = state.config.template_dir.join(format!("{}.yml", id));
        let yaml_path = state.config.template_dir.join(format!("{}.yaml", id));
        if yml_path.exists() || yaml_path.exists() {
            return (
                StatusCode::CONFLICT,
                Json(serde_json::json!({ "error": "Template already exists" })),
            );
        }
    }

    match state
        .templates
        .save_template(&id, &payload.content, payload.overwrite)
    {
        Ok(()) => (
            StatusCode::OK,
            Json(serde_json::json!({ "status": "saved", "id": id })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        ),
    }
}

async fn delete_template(
    Path(id): Path<String>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    match state.templates.delete_template(&id) {
        Ok(()) => (
            StatusCode::OK,
            Json(serde_json::json!({ "status": "deleted", "id": id })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        ),
    }
}

async fn instantiate_template(
    Path(id): Path<String>,
    State(state): State<AppState>,
    Json(payload): Json<InstantiateTemplateRequest>,
) -> impl IntoResponse {
    if payload.stack_name.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Stack name cannot be empty" })),
        );
    }
    if !valid_stack_name(&payload.stack_name) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "Invalid stack name: use lowercase letters, digits, dashes and underscores, starting with a letter or digit"
            })),
        );
    }

    match state.templates.instantiate_template(
        &id,
        &payload.stack_name,
        payload.env_content.as_deref(),
        payload.custom_uid,
        payload.custom_gid,
    ) {
        Ok(()) => (
            StatusCode::CREATED,
            Json(serde_json::json!({
                "status": "created",
                "stack_name": payload.stack_name
            })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        ),
    }
}
