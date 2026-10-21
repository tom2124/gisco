use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{delete, get, post, put};
use axum::{Json, Router};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use std::path::{Path as StdPath, PathBuf};
use tokio::sync::mpsc;

use crate::compose::manager::find_compose_file;
use crate::compose::{
    check_bind_mounts, describe_bind_warning, project_action_allowed, valid_path_component,
    valid_stack_name, ComposeRunner,
};
use crate::routes::error::docker_error;
use crate::routes::AppState;

#[derive(Deserialize)]
pub struct CreateStackRequest {
    pub name: String,
    pub compose_content: String,
    pub env_content: Option<String>,
    pub custom_uid: Option<u32>,
    pub custom_gid: Option<u32>,
}

#[derive(Deserialize)]
pub struct UpdateStackRequest {
    pub compose_content: String,
    pub env_content: Option<String>,
    pub custom_uid: Option<u32>,
    pub custom_gid: Option<u32>,
}

#[derive(Deserialize)]
pub struct StackActionRequest {
    pub action: String, // "up", "down", "restart", "pull", "stop", "start"
}

#[derive(Deserialize)]
pub struct ActionStreamQuery {
    pub action: String,
}

/// Resolve how to operate on a stack: via its compose file (managed) or
/// via `docker compose -p` (external project with no stack directory).
enum StackTarget {
    Managed {
        dir: std::path::PathBuf,
        file: String,
    },
    External {
        project: String,
    },
}

async fn resolve_stack_target(state: &AppState, name: &str) -> Option<StackTarget> {
    if !valid_path_component(name) {
        return None;
    }
    let stack_path = state.config.stack_dir.join(name);
    if let Some(compose_file) = find_compose_file(&stack_path) {
        return Some(StackTarget::Managed {
            dir: stack_path,
            file: compose_file
                .file_name()
                .unwrap()
                .to_string_lossy()
                .to_string(),
        });
    }
    // No compose file: external iff containers carry the project label.
    match state.docker.list_containers_for_stack(name).await {
        Ok(conts) if !conts.is_empty() => Some(StackTarget::External {
            project: name.to_string(),
        }),
        _ => None,
    }
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(list_stacks))
        .route("/", post(create_stack))
        .route("/{name}", get(get_stack))
        .route("/{name}", put(update_stack))
        .route("/{name}", delete(delete_stack))
        .route("/{name}/action", post(stack_action))
        .route("/{name}/bind-check", post(check_stack_bind_mounts))
}

async fn list_stacks(State(state): State<AppState>) -> impl IntoResponse {
    match state.stacks.list_stacks(&state.docker).await {
        Ok(stacks) => (StatusCode::OK, Json(serde_json::json!(stacks))),
        Err(e) => docker_error(e),
    }
}

async fn get_stack(Path(name): Path<String>, State(state): State<AppState>) -> impl IntoResponse {
    match state.stacks.get_stack(&name, &state.docker).await {
        Ok(details) => (StatusCode::OK, Json(serde_json::json!(details))),
        Err(e) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": e.to_string() })),
        ),
    }
}

async fn create_stack(
    State(state): State<AppState>,
    Json(payload): Json<CreateStackRequest>,
) -> impl IntoResponse {
    if payload.name.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Stack name cannot be empty" })),
        );
    }
    if !valid_stack_name(&payload.name) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "Invalid stack name: use lowercase letters, digits, dashes and underscores, starting with a letter or digit"
            })),
        );
    }
    if state.stacks.stack_exists(&payload.name).unwrap_or(false) {
        return (
            StatusCode::CONFLICT,
            Json(serde_json::json!({ "error": "Stack already exists" })),
        );
    }

    let project_dir = daemon_project_dir(&state, &state.config.stack_dir.join(&payload.name)).await;
    let warnings = state
        .stacks
        .bind_mount_warnings(&payload.compose_content, &project_dir);
    match state.stacks.save_stack(
        &payload.name,
        &payload.compose_content,
        payload.env_content.as_deref(),
        payload.custom_uid,
        payload.custom_gid,
    ) {
        Ok(()) => (
            StatusCode::CREATED,
            Json(serde_json::json!({
                "status": "created",
                "name": payload.name,
                "warnings": warnings,
            })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        ),
    }
}

async fn update_stack(
    Path(name): Path<String>,
    State(state): State<AppState>,
    Json(payload): Json<UpdateStackRequest>,
) -> impl IntoResponse {
    let stack_path = state.config.stack_dir.join(&name);
    if !valid_path_component(&name) || find_compose_file(&stack_path).is_none() {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Managed stack not found" })),
        );
    }

    let project_dir = daemon_project_dir(&state, &state.config.stack_dir.join(&name)).await;
    let warnings = state
        .stacks
        .bind_mount_warnings(&payload.compose_content, &project_dir);
    match state.stacks.save_stack(
        &name,
        &payload.compose_content,
        payload.env_content.as_deref(),
        payload.custom_uid,
        payload.custom_gid,
    ) {
        Ok(()) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "status": "updated",
                "name": name,
                "warnings": warnings,
            })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        ),
    }
}

/// Check the bind mounts in a compose file without saving it.
///
/// The check the UI runs against the editor contents, so the warning appears
/// while the user is still writing the file rather than only after a save.
async fn check_stack_bind_mounts(
    Path(name): Path<String>,
    State(state): State<AppState>,
    Json(payload): Json<UpdateStackRequest>,
) -> impl IntoResponse {
    if !valid_path_component(&name) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Invalid stack name" })),
        );
    }
    let project_dir = daemon_project_dir(&state, &state.config.stack_dir.join(&name)).await;
    let warnings = state
        .stacks
        .bind_mount_warnings(&payload.compose_content, &project_dir);
    (
        StatusCode::OK,
        Json(serde_json::json!({ "warnings": warnings })),
    )
}

/// A note for the user when gisco's view of the stack directory and the
/// Docker host's disagree.
///
/// Relative bind mounts are translated, so they work. Relative build contexts,
/// `env_file` and `include` paths are not: those are read by the Compose CLI,
/// which runs inside the container and would look for a host path it cannot
/// see. The robust answer is to mount the stacks directory at the same path
/// inside the container as on the host.
fn path_mismatch_note(container_dir: &StdPath, host_dir: &StdPath) -> Option<String> {
    if container_dir == host_dir {
        return None;
    }
    Some(format!(
        "gisco's stack directory {} is mounted from {} on the Docker host. Relative \
         bind mounts are translated automatically, but relative build contexts, \
         env_file and include paths are read by the Compose CLI inside the \
         container and are not translated - mount the stacks directory at the \
         same path inside the container as on the host for those to work.",
        container_dir.display(),
        host_dir.display()
    ))
}

/// The directory the Docker daemon sees for a stack, which is not the same as
/// the one this process sees when gisco runs in a container.
///
/// Compose resolves a relative bind mount against the directory of the compose
/// file — from the *CLI's* point of view — and then hands that path to the
/// daemon, which resolves it in the *host's* namespace. When the two disagree
/// the daemon has never heard of the path, so it creates it as a directory and
/// the container gets a directory where a file was expected: "not a directory".
///
/// Translating the project directory to the daemon's view makes them agree.
async fn daemon_project_dir(state: &AppState, stack_dir: &StdPath) -> PathBuf {
    match state.docker.host_path_for(stack_dir).await {
        Some(host_path) if host_path != stack_dir => host_path,
        _ => stack_dir.to_path_buf(),
    }
}

async fn delete_stack(
    Path(name): Path<String>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    match resolve_stack_target(&state, &name).await {
        // Managed: down via compose file, then remove the directory.
        Some(StackTarget::Managed { dir, file }) => {
            let project_dir = daemon_project_dir(&state, &dir).await;
            if let Err(e) =
                ComposeRunner::run_compose(&dir, &project_dir, &file, "down", None).await
            {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({
                        "error": format!("Failed to stop stack before deletion: {}", e)
                    })),
                );
            }
            match state.stacks.delete_stack(&name) {
                Ok(()) => (
                    StatusCode::OK,
                    Json(serde_json::json!({ "status": "deleted", "name": name })),
                ),
                Err(e) => (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": e.to_string() })),
                ),
            }
        }
        // External: down via project name; there is no directory to remove.
        Some(StackTarget::External { project }) => {
            match ComposeRunner::run_compose_project(
                &state.config.stack_dir,
                &project,
                "down",
                None,
            )
            .await
            {
                Ok(_) => (
                    StatusCode::OK,
                    Json(serde_json::json!({ "status": "deleted", "name": name })),
                ),
                Err(e) => (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": e.to_string() })),
                ),
            }
        }
        // Unknown: nothing to do (idempotent, matches previous behavior).
        None => (
            StatusCode::OK,
            Json(serde_json::json!({ "status": "deleted", "name": name })),
        ),
    }
}

async fn stack_action(
    Path(name): Path<String>,
    State(state): State<AppState>,
    Json(payload): Json<StackActionRequest>,
) -> impl IntoResponse {
    let result = match resolve_stack_target(&state, &name).await {
        Some(StackTarget::Managed { dir, file }) => {
            let project_dir = daemon_project_dir(&state, &dir).await;
            ComposeRunner::run_compose(&dir, &project_dir, &file, &payload.action, None).await
        }
        Some(StackTarget::External { project }) => {
            if !project_action_allowed(&payload.action) {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(
                        serde_json::json!({ "error": format!("Action '{}' requires a compose file and is not supported for external stacks", payload.action) }),
                    ),
                );
            }
            ComposeRunner::run_compose_project(
                &state.config.stack_dir,
                &project,
                &payload.action,
                None,
            )
            .await
        }
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "Stack not found" })),
            );
        }
    };

    match result {
        Ok(_) => (
            StatusCode::OK,
            Json(serde_json::json!({ "status": "success", "action": payload.action })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        ),
    }
}

pub async fn stack_action_ws_handler(
    Path(name): Path<String>,
    Query(query): Query<ActionStreamQuery>,
    State(state): State<AppState>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_action_stream_ws(socket, name, query.action, state))
}

async fn handle_action_stream_ws(
    mut socket: WebSocket,
    stack_name: String,
    action: String,
    state: AppState,
) {
    let target = match resolve_stack_target(&state, &stack_name).await {
        Some(t @ StackTarget::Managed { .. }) => t,
        Some(t @ StackTarget::External { .. }) if project_action_allowed(&action) => t,
        _ => {
            let _ = socket
                .send(Message::Text(
                    "Error: stack not found or action requires a compose file.\r\n".into(),
                ))
                .await;
            return;
        }
    };

    let (tx, mut rx) = mpsc::channel::<String>(100);

    // Warn about bind mounts that will not resolve *before* the action runs.
    // The user often pastes a compose file and hits "Up" without ever saving
    // it, so the save-time warning never fires. Without this the failure
    // surfaces from inside the container as "not a directory", with nothing
    // pointing at the cause.
    if let StackTarget::Managed { dir, file } = &target {
        let project_dir = daemon_project_dir(&state, dir).await;
        if let Some(note) = path_mismatch_note(dir, &project_dir) {
            let _ = tx.send(format!("[gisco] Note: {}\r\n", note)).await;
        }
        if let Ok(content) = std::fs::read_to_string(dir.join(file)) {
            for warning in check_bind_mounts(&content, &project_dir) {
                let _ = tx
                    .send(format!(
                        "[gisco] Warning: {}\r\n",
                        describe_bind_warning(&warning)
                    ))
                    .await;
            }
        }
    }

    // Spawn command runner task. Forward setup/execution errors too; otherwise
    // an invalid action closes the channel without ever showing the failure.
    tokio::spawn(async move {
        let result = match target {
            StackTarget::Managed { dir, file } => {
                let project_dir = daemon_project_dir(&state, &dir).await;
                ComposeRunner::run_compose(&dir, &project_dir, &file, &action, Some(tx.clone()))
                    .await
            }
            StackTarget::External { project } => {
                ComposeRunner::run_compose_project(
                    &state.config.stack_dir,
                    &project,
                    &action,
                    Some(tx.clone()),
                )
                .await
            }
        };
        if let Err(e) = result {
            let _ = tx.send(format!("[gisco] Error: {}", e)).await;
        }
    });

    // Forward lines while also watching the client. A silent compose command
    // must not keep this task alive after the modal is closed.
    let (mut sender, mut receiver) = socket.split();
    loop {
        tokio::select! {
            line = rx.recv() => {
                match line {
                    Some(line) => {
                        let formatted = format!("{}\r\n", line);
                        if sender.send(Message::Text(formatted.into())).await.is_err() {
                            break;
                        }
                    }
                    None => break,
                }
            }
            incoming = receiver.next() => {
                match incoming {
                    Some(Ok(Message::Ping(payload))) => {
                        if sender.send(Message::Pong(payload)).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(_)) => {}
                    Some(Err(_)) => break,
                }
            }
        }
    }
}
