use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::Deserialize;

use crate::compose::{valid_path_component, valid_stack_name};
use crate::routes::AppState;
use crate::templates::merge::{OnConflict, Slot};

#[derive(Deserialize)]
pub struct InstantiateTemplateRequest {
    pub stack_name: String,
    pub env_content: Option<String>,
    pub custom_uid: Option<u32>,
    pub custom_gid: Option<u32>,
}

#[derive(Deserialize, Debug, Clone)]
pub struct SlotRequest {
    pub template_id: String,
    /// Optional unique name for this instance, e.g. `cache_a`.
    #[serde(default)]
    pub instance: Option<String>,
}

#[derive(Deserialize)]
pub struct MergeTemplatesRequest {
    pub slots: Vec<SlotRequest>,
    /// `error` (default) or `rename`.
    #[serde(default)]
    pub on_conflict: Option<String>,
}

#[derive(Deserialize)]
pub struct InstantiateCompositionRequest {
    pub slots: Vec<SlotRequest>,
    pub stack_name: String,
    pub env_content: Option<String>,
    #[serde(default)]
    pub on_conflict: Option<String>,
    pub custom_uid: Option<u32>,
    pub custom_gid: Option<u32>,
}

fn to_slots(req: &[SlotRequest]) -> Vec<Slot> {
    req.iter()
        .map(|s| Slot {
            template_id: s.template_id.clone(),
            instance: s
                .instance
                .as_ref()
                .map(|i| i.trim())
                .filter(|i| !i.is_empty())
                .map(String::from),
        })
        .collect()
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
        // Multi-template composition. Nested under `/composition/...` so these
        // never collide with the `/{id}` routes above.
        .route("/composition/merge", post(merge_templates))
        .route("/composition/instantiate", post(instantiate_composition))
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

/// Preview the compose file that would result from composing `slots`.
/// Performs no writes — used to drive the "create stack from templates" modal.
async fn merge_templates(
    State(state): State<AppState>,
    Json(payload): Json<MergeTemplatesRequest>,
) -> impl IntoResponse {
    if payload.slots.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Select at least one template" })),
        );
    }
    let on_conflict = OnConflict::parse(payload.on_conflict.as_deref().unwrap_or("error"));
    match state
        .templates
        .compose_templates(&to_slots(&payload.slots), on_conflict)
    {
        Ok(result) => (StatusCode::OK, Json(serde_json::json!(result))),
        Err(e) => (
            StatusCode::CONFLICT,
            Json(serde_json::json!({ "error": e.to_string() })),
        ),
    }
}

/// Compose `slots` into a brand new stack.
async fn instantiate_composition(
    State(state): State<AppState>,
    Json(payload): Json<InstantiateCompositionRequest>,
) -> impl IntoResponse {
    if payload.slots.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Select at least one template" })),
        );
    }
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

    let on_conflict = OnConflict::parse(payload.on_conflict.as_deref().unwrap_or("error"));
    match state.templates.instantiate_composition(
        &to_slots(&payload.slots),
        &payload.stack_name,
        payload.env_content.as_deref(),
        on_conflict,
        payload.custom_uid,
        payload.custom_gid,
    ) {
        Ok(_) => (
            StatusCode::CREATED,
            Json(serde_json::json!({
                "status": "created",
                "stack_name": payload.stack_name
            })),
        ),
        // A name clash is the caller's problem, not a server fault.
        Err(e) if e.to_string().contains("Name conflicts") => (
            StatusCode::CONFLICT,
            Json(serde_json::json!({ "error": e.to_string() })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        ),
    }
}
