use anyhow::{Context, Result};
use axum::extract::ws::{Message, WebSocket};
use bollard::exec::{CreateExecOptions, ResizeExecOptions, StartExecOptions, StartExecResults};
use bollard::Docker;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use std::sync::Arc;
use tokio::io::AsyncWriteExt;
use tracing::warn;

#[derive(Deserialize, Debug)]
#[serde(tag = "type")]
pub enum TerminalClientMessage {
    #[serde(rename = "resize")]
    Resize { cols: u16, rows: u16 },
    #[serde(rename = "input")]
    Input { data: String },
}

pub async fn handle_exec_terminal(
    docker: Arc<Docker>,
    container_id: String,
    cmd: Option<String>,
    interactive: Option<bool>,
    mut ws: WebSocket,
) -> Result<()> {
    let use_tty = interactive.unwrap_or(true);

    // No explicit shell requested: prefer bash, fall back to POSIX sh.
    // Runs under /bin/sh -c so a single exec covers both cases.
    let exec_cmd = if use_tty {
        match cmd.as_deref().map(str::trim) {
            Some(shell) if !shell.is_empty() => vec![shell.to_string()],
            _ => vec![
                "/bin/sh".to_string(),
                "-c".to_string(),
                "if command -v bash >/dev/null 2>&1; then exec bash; else exec sh; fi"
                    .to_string(),
            ],
        }
    } else {
        // For non-interactive commands, wrap in shell to support command strings like "echo 1"
        vec![
            "/bin/sh".to_string(),
            "-c".to_string(),
            cmd.unwrap_or_else(|| "/bin/sh".to_string()),
        ]
    };

    let create_options = CreateExecOptions {
        attach_stdin: Some(true),
        attach_stdout: Some(true),
        attach_stderr: Some(true),
        tty: Some(use_tty),
        cmd: Some(exec_cmd),
        ..Default::default()
    };

    let exec_res = match docker.create_exec(&container_id, create_options).await {
        Ok(res) => res,
        Err(e) => {
            let err_msg = format!("Failed to create exec session: {}\r\n", e);
            let _ = ws.send(Message::Text(err_msg.into())).await;
            return Err(e.into());
        }
    };

    let exec_id = exec_res.id;
    let start_res = docker
        .start_exec(&exec_id, Some(StartExecOptions { detach: false, tty: use_tty, ..Default::default() }))
        .await
        .context("Failed to start exec session")?;

    match start_res {
        StartExecResults::Attached {
            mut output,
            mut input,
        } => {
            let docker_resize = docker.clone();
            let exec_id_resize = exec_id.clone();

            // Task to read from container exec output and forward to WebSocket
            let (mut ws_sender, mut ws_receiver) = ws.split();

            let forward_out = async move {
                while let Some(msg_res) = output.next().await {
                    match msg_res {
                        Ok(log_output) => {
                            let bytes = log_output.into_bytes();
                            if let Err(e) = ws_sender.send(Message::Binary(bytes)).await {
                                warn!("Error sending exec output to WS: {:?}", e);
                                break;
                            }
                        }
                        Err(e) => {
                            warn!("Exec output stream error: {:?}", e);
                            break;
                        }
                    }
                }
            };

            // Task to read from WebSocket and forward to container stdin or handle resize
            let forward_in = async move {
                while let Some(msg_res) = ws_receiver.next().await {
                    match msg_res {
                        Ok(Message::Text(text)) => {
                            // Could be JSON control message (like resize) or raw input
                            if let Ok(client_msg) = serde_json::from_str::<TerminalClientMessage>(&text) {
                                match client_msg {
                                    TerminalClientMessage::Resize { cols, rows } => {
                                        let options = ResizeExecOptions {
                                            height: rows,
                                            width: cols,
                                        };
                                        let _ = docker_resize.resize_exec(&exec_id_resize, options).await;
                                    }
                                    TerminalClientMessage::Input { data } => {
                                        let _ = input.write_all(data.as_bytes()).await;
                                        let _ = input.flush().await;
                                    }
                                }
                            } else {
                                // Raw string
                                let _ = input.write_all(text.as_bytes()).await;
                                let _ = input.flush().await;
                            }
                        }
                        Ok(Message::Binary(bin)) => {
                            let _ = input.write_all(&bin).await;
                            let _ = input.flush().await;
                        }
                        Ok(Message::Close(_)) => break,
                        Ok(Message::Ping(_)) | Ok(Message::Pong(_)) => {}
                        Err(e) => {
                            warn!("WS receive error: {:?}", e);
                            break;
                        }
                    }
                }
            };

            tokio::select! {
                _ = forward_out => {},
                _ = forward_in => {},
            }
        }
        StartExecResults::Detached => {
            warn!("Exec was started detached unexpectedly");
        }
    }

    Ok(())
}
