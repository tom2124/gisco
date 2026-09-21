use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::response::IntoResponse;
use bollard::container::StatsOptions;
use futures_util::StreamExt;
use tracing::warn;

use crate::docker::stats::calculate_metrics;
use crate::routes::AppState;

pub async fn stats_handler(
    Path(id): Path<String>,
    State(state): State<AppState>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_stats_ws(socket, id, state))
}

async fn handle_stats_ws(mut socket: WebSocket, container_id: String, state: AppState) {
    let options = Some(StatsOptions {
        stream: true,
        one_shot: false,
    });

    let mut stream = state.docker.client.stats(&container_id, options);

    while let Some(stats_res) = stream.next().await {
        match stats_res {
            Ok(stats) => {
                let metrics = calculate_metrics(&container_id, &stats);
                if let Ok(json) = serde_json::to_string(&metrics) {
                    if socket.send(Message::Text(json.into())).await.is_err() {
                        break;
                    }
                }
            }
            Err(e) => {
                warn!("Stats stream error: {:?}", e);
                break;
            }
        }
    }
}
