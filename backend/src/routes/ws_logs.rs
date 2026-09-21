use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, Query, State};
use axum::response::IntoResponse;
use bollard::container::LogsOptions;
use futures_util::StreamExt;
use serde::Deserialize;
use tracing::warn;

use crate::routes::AppState;

#[derive(Deserialize)]
pub struct LogsQuery {
    pub tail: Option<String>,
    pub timestamps: Option<bool>,
}

pub async fn logs_handler(
    Path(id): Path<String>,
    Query(query): Query<LogsQuery>,
    State(state): State<AppState>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_logs_ws(socket, id, query, state))
}

async fn handle_logs_ws(
    mut socket: WebSocket,
    container_id: String,
    query: LogsQuery,
    state: AppState,
) {
    let options = Some(LogsOptions::<String> {
        stdout: true,
        stderr: true,
        follow: true,
        tail: query.tail.unwrap_or_else(|| "100".to_string()),
        timestamps: query.timestamps.unwrap_or(true),
        ..Default::default()
    });

    let mut stream = state.docker.client.logs(&container_id, options);

    while let Some(msg_res) = stream.next().await {
        match msg_res {
            Ok(output) => {
                let text = output.to_string();
                if socket.send(Message::Text(text.into())).await.is_err() {
                    break;
                }
            }
            Err(e) => {
                warn!("Logs stream error: {:?}", e);
                break;
            }
        }
    }
}
