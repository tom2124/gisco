use anyhow::{Context, Result};
use std::path::Path;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc;
use tracing::info;

pub struct ComposeRunner;

/// Actions that work on an existing project without a compose file
/// (operate purely on project-labelled resources via `docker compose -p`).
/// `up` and `pull` need service definitions, so they require a compose file.
pub fn project_action_allowed(action: &str) -> bool {
    matches!(action, "down" | "restart" | "stop" | "start")
}

fn action_args(action: &str) -> Result<Vec<&'static str>> {
    match action {
        "up" => Ok(vec!["up", "-d", "--remove-orphans"]),
        "down" => Ok(vec!["down"]),
        "restart" => Ok(vec!["restart"]),
        "pull" => Ok(vec!["pull"]),
        "stop" => Ok(vec!["stop"]),
        "start" => Ok(vec!["start"]),
        _ => anyhow::bail!("Unknown compose action: {}", action),
    }
}

impl ComposeRunner {
    pub async fn run_compose(
        stack_dir: &Path,
        compose_file: &str,
        action: &str,
        tx: Option<mpsc::Sender<String>>,
    ) -> Result<bool> {
        let args = action_args(action)?;

        info!(
            "Running docker compose in {:?} with file '{}' action '{}'",
            stack_dir, compose_file, action
        );

        let mut full_args: Vec<&str> = vec!["compose", "-f", compose_file];
        full_args.extend(args);
        Self::execute(stack_dir, &full_args, action, tx).await
    }

    /// Run a compose action against an external project (no stack directory,
    /// no compose file) via `docker compose -p <project> <action>`.
    pub async fn run_compose_project(
        work_dir: &Path,
        project: &str,
        action: &str,
        tx: Option<mpsc::Sender<String>>,
    ) -> Result<bool> {
        if !project_action_allowed(action) {
            anyhow::bail!(
                "Action '{}' requires a compose file and is not supported for external stacks",
                action
            );
        }
        let args = action_args(action)?;

        info!(
            "Running docker compose -p '{}' action '{}'",
            project, action
        );

        let mut full_args: Vec<&str> = vec!["compose", "-p", project];
        full_args.extend(args);
        Self::execute(work_dir, &full_args, action, tx).await
    }

    async fn execute(
        dir: &Path,
        args: &[&str],
        action: &str,
        tx: Option<mpsc::Sender<String>>,
    ) -> Result<bool> {
        let mut cmd = Command::new("docker");
        cmd.current_dir(dir)
            .args(args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = cmd
            .spawn()
            .with_context(|| format!("Failed to spawn docker compose for action '{}'", action))?;

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        let tx_out = tx.clone();
        let out_task = tokio::spawn(async move {
            if let Some(stdout) = stdout {
                let mut reader = BufReader::new(stdout).lines();
                while let Ok(Some(line)) = reader.next_line().await {
                    if let Some(tx) = &tx_out {
                        let _ = tx.send(line).await;
                    }
                }
            }
        });

        let tx_err = tx.clone();
        let err_task = tokio::spawn(async move {
            if let Some(stderr) = stderr {
                let mut reader = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = reader.next_line().await {
                    if let Some(tx) = &tx_err {
                        let _ = tx.send(line).await;
                    }
                }
            }
        });

        let status = child.wait().await?;
        let _ = tokio::join!(out_task, err_task);

        if status.success() {
            if let Some(tx) = &tx {
                let _ = tx
                    .send(format!(
                        "[gisco] Action '{}' completed successfully.",
                        action
                    ))
                    .await;
            }
            Ok(true)
        } else {
            let code = status.code().unwrap_or(-1);
            if let Some(tx) = &tx {
                let _ = tx
                    .send(format!(
                        "[gisco] Action '{}' failed with code {}.",
                        action, code
                    ))
                    .await;
            }
            anyhow::bail!(
                "Docker compose action '{}' failed with code {}",
                action,
                code
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_project_action_allowed() {
        for action in ["down", "restart", "stop", "start"] {
            assert!(project_action_allowed(action), "{}", action);
        }
        for action in ["up", "pull", "logs", ""] {
            assert!(!project_action_allowed(action), "{}", action);
        }
    }

    #[test]
    fn test_action_args_rejects_unknown() {
        assert!(action_args("up").is_ok());
        assert!(action_args("bogus").is_err());
    }
}
