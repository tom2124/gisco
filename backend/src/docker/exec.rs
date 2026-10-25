use anyhow::{Context, Result};
use axum::extract::ws::{Message, WebSocket};
use bollard::exec::{CreateExecOptions, ResizeExecOptions, StartExecOptions, StartExecResults};
use bollard::Docker;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use std::sync::Arc;
use tokio::io::{AsyncWrite, AsyncWriteExt};
use tracing::warn;

#[derive(Deserialize, Debug)]
#[serde(tag = "type")]
pub enum TerminalClientMessage {
    #[serde(rename = "resize")]
    Resize { cols: u16, rows: u16 },
    #[serde(rename = "input")]
    Input { data: String },
}

async fn write_exec_input<W: AsyncWrite + Unpin>(
    input: &mut W,
    data: &[u8],
) -> std::io::Result<()> {
    input.write_all(data).await?;
    input.flush().await
}

pub async fn handle_exec_terminal(
    docker: Arc<Docker>,
    container_id: String,
    cmd: Option<String>,
    interactive: Option<bool>,
    user: Option<String>,
    mut ws: WebSocket,
) -> Result<()> {
    let use_tty = interactive.unwrap_or(true);
    // Empty user = container default (usually root, or the image USER).
    let exec_user = user.and_then(|u| {
        let trimmed = u.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    });

    // No explicit shell requested: prefer bash, fall back to POSIX sh.
    // Runs under /bin/sh -c so a single exec covers both cases.
    let exec_cmd = if use_tty {
        match cmd.as_deref().map(str::trim) {
            Some(shell) if !shell.is_empty() => vec![shell.to_string()],
            _ => vec![
                "/bin/sh".to_string(),
                "-c".to_string(),
                "if command -v bash >/dev/null 2>&1; then exec bash; else exec sh; fi".to_string(),
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

    // Docker exec allocates the pty but does not set TERM for us. Without it,
    // shells and common tools disable colored prompts/output even though the
    // browser terminal is fully capable of rendering ANSI sequences.
    let exec_env = use_tty.then(|| {
        vec![
            "TERM=xterm-256color".to_string(),
            "COLORTERM=truecolor".to_string(),
        ]
    });

    let create_options = CreateExecOptions {
        attach_stdin: Some(true),
        attach_stdout: Some(true),
        attach_stderr: Some(true),
        tty: Some(use_tty),
        env: exec_env,
        cmd: Some(exec_cmd),
        user: exec_user,
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
        .start_exec(
            &exec_id,
            Some(StartExecOptions {
                detach: false,
                tty: use_tty,
                ..Default::default()
            }),
        )
        .await
        .context("Failed to start exec session")?;

    match start_res {
        StartExecResults::Attached {
            mut output,
            mut input,
        } => {
            let docker_resize = docker.clone();
            let exec_id_resize = exec_id.clone();

            let (mut ws_sender, mut ws_receiver) = ws.split();

            // Drive both directions in one task so a browser disconnect also
            // drops the exec input/output streams. Previously logs/stats-style
            // long-lived streams could remain blocked on Docker output forever.
            'session: loop {
                tokio::select! {
                    output_msg = output.next() => {
                        match output_msg {
                            Some(Ok(log_output)) => {
                                if let Err(e) = ws_sender.send(Message::Binary(log_output.into_bytes())).await {
                                    warn!("Error sending exec output to WS: {:?}", e);
                                    break;
                                }
                            }
                            Some(Err(e)) => {
                                warn!("Exec output stream error: {:?}", e);
                                break;
                            }
                            None => break,
                        }
                    }
                    input_msg = ws_receiver.next() => {
                        match input_msg {
                            Some(Ok(Message::Text(text))) => {
                                if let Ok(client_msg) = serde_json::from_str::<TerminalClientMessage>(&text) {
                                    match client_msg {
                                        TerminalClientMessage::Resize { cols, rows } => {
                                            if cols > 0 && rows > 0 {
                                                let options = ResizeExecOptions { height: rows, width: cols };
                                                if let Err(e) = docker_resize.resize_exec(&exec_id_resize, options).await {
                                                    warn!("Failed to resize exec session: {:?}", e);
                                                }
                                            }
                                        }
                                        TerminalClientMessage::Input { data } => {
                                            if let Err(e) = write_exec_input(&mut input, data.as_bytes()).await {
                                                warn!("Failed to write exec input: {:?}", e);
                                                break 'session;
                                            }
                                        }
                                    }
                                } else if let Err(e) = write_exec_input(&mut input, text.as_bytes()).await {
                                    warn!("Failed to write exec input: {:?}", e);
                                    break 'session;
                                }
                            }
                            Some(Ok(Message::Binary(bin))) => {
                                if let Err(e) = write_exec_input(&mut input, &bin).await {
                                    warn!("Failed to write exec input: {:?}", e);
                                    break;
                                }
                            }
                            Some(Ok(Message::Close(_))) | None => break,
                            Some(Ok(Message::Ping(payload))) => {
                                if let Err(e) = ws_sender.send(Message::Pong(payload)).await {
                                    warn!("Failed to send WebSocket pong: {:?}", e);
                                    break;
                                }
                            }
                            Some(Ok(Message::Pong(_))) => {}
                            Some(Err(e)) => {
                                warn!("WS receive error: {:?}", e);
                                break;
                            }
                        }
                    }
                }
            }
        }
        StartExecResults::Detached => {
            warn!("Exec was started detached unexpectedly");
        }
    }

    Ok(())
}

/// The result of running a command to completion in a container.
#[derive(Clone, Debug, Default)]
pub struct CommandOutcome {
    /// The command's exit code, if Docker reported one.
    pub exit_code: Option<i64>,
    /// Combined stdout and stderr.
    pub output: String,
}

impl CommandOutcome {
    pub fn succeeded(&self) -> bool {
        self.exit_code == Some(0)
    }
}

/// Run a command in a container and wait for it to finish.
///
/// Unlike the terminal path this is not interactive: no TTY, no stdin, and the
/// output is collected so the caller can report what happened. Used by module
/// actions, where the result matters more than the stream.
pub async fn run_command(
    docker: &Docker,
    container_id: &str,
    command: &str,
    user: Option<&str>,
) -> Result<CommandOutcome> {
    let create_options = CreateExecOptions {
        attach_stdin: Some(false),
        attach_stdout: Some(true),
        attach_stderr: Some(true),
        tty: Some(false),
        cmd: Some(vec![
            "/bin/sh".to_string(),
            "-c".to_string(),
            command.to_string(),
        ]),
        user: user.map(|u| u.to_string()),
        ..Default::default()
    };

    let exec = docker
        .create_exec(container_id, create_options)
        .await
        .with_context(|| format!("Failed to create exec for container {}", container_id))?;
    let exec_id = exec.id.clone();

    let start = docker
        .start_exec(
            &exec_id,
            Some(StartExecOptions {
                detach: false,
                tty: false,
                ..Default::default()
            }),
        )
        .await
        .with_context(|| format!("Failed to start exec in container {}", container_id))?;

    let mut output = String::new();
    match start {
        StartExecResults::Attached {
            output: mut stream, ..
        } => {
            // Read to end of stream, then ask Docker for the exit code.
            while let Some(Ok(chunk)) = stream.next().await {
                // LogOutput is an enum (stdout/stderr/stdin) with a Display
                // impl that yields the message.
                output.push_str(&chunk.to_string());
            }
        }
        StartExecResults::Detached => {
            output.push_str("Command detached unexpectedly; no output captured.");
        }
    }

    // The exit code only appears on the exec once it has finished.
    let exit_code = docker
        .inspect_exec(&exec_id)
        .await
        .ok()
        .and_then(|i| i.exit_code);

    Ok(CommandOutcome { exit_code, output })
}
