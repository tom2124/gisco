use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::response::IntoResponse;
use bollard::container::StatsOptions;
use futures_util::{SinkExt, StreamExt};
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

async fn handle_stats_ws(socket: WebSocket, container_id: String, state: AppState) {
    let options = Some(StatsOptions {
        stream: true,
        one_shot: false,
    });

    let mut stream = state.docker.client.stats(&container_id, options);
    let (mut sender, mut receiver) = socket.split();

    loop {
        tokio::select! {
            stats_res = stream.next() => {
                match stats_res {
                    Some(Ok(stats)) => {
                        let metrics = calculate_metrics(&container_id, &stats);
                        match serde_json::to_string(&metrics) {
                            Ok(json) => {
                                if sender.send(Message::Text(json.into())).await.is_err() {
                                    break;
                                }
                            }
                            Err(e) => {
                                warn!("Failed to serialize container metrics: {:?}", e);
                                break;
                            }
                        }
                    }
                    Some(Err(e)) => {
                        warn!("Stats stream error: {:?}", e);
                        break;
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
                    Some(Err(e)) => {
                        warn!("Stats WebSocket receive error: {:?}", e);
                        break;
                    }
                }
            }
        }
    }
}
