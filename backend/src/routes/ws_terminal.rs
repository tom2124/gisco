use axum::extract::ws::WebSocketUpgrade;
use axum::extract::{Path, Query, State};
use axum::response::IntoResponse;
use serde::Deserialize;

use crate::docker::exec::handle_exec_terminal;
use crate::routes::AppState;

#[derive(Deserialize)]
pub struct TerminalQuery {
    pub cmd: Option<String>,
    pub interactive: Option<bool>,
}

pub async fn terminal_handler(
    Path(id): Path<String>,
    Query(query): Query<TerminalQuery>,
    State(state): State<AppState>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| async move {
        let _ = handle_exec_terminal(state.docker.client.clone(), id, query.cmd, query.interactive, socket).await;
    })
}
