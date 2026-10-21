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

/// Build the `docker compose` argument list.
///
/// When the daemon's view of the project directory differs from this process's
/// view — which is the case whenever gisco runs in a container — the project
/// directory is pointed at the daemon's path so that relative paths in the
/// compose file resolve to something the daemon can actually see. Without it,
/// the daemon is handed a container-only path, creates it as a directory, and
/// the container ends up with a directory where a file was expected.
///
/// The `.env` file is passed explicitly, because moving the project directory
/// would otherwise leave Compose looking for it in a directory this process
/// cannot read.
fn compose_args(
    stack_dir: &Path,
    project_dir: &Path,
    compose_file: &str,
    action_args: &[&str],
) -> Vec<String> {
    let mut args: Vec<String> = vec!["compose".to_string()];
    if project_dir != stack_dir {
        args.push("--project-directory".to_string());
        args.push(project_dir.to_string_lossy().to_string());
        let env_file = stack_dir.join(".env");
        if env_file.exists() {
            args.push("--env-file".to_string());
            args.push(env_file.to_string_lossy().to_string());
        }
    }
    args.push("-f".to_string());
    args.push(compose_file.to_string());
    args.extend(action_args.iter().map(|a| a.to_string()));
    args
}

impl ComposeRunner {
    /// Run a compose action, resolving relative paths against `project_dir`.
    ///
    /// `project_dir` is the directory the *Docker daemon* sees for this stack,
    /// which differs from `stack_dir` when gisco runs in a container: the
    /// Compose CLI resolves relative paths in the compose file against its own
    /// filesystem, but the daemon resolves the bind mounts it is handed. Pointing
    /// Compose at the daemon's view of the directory makes the two agree.
    ///
    /// `stack_dir` is still the working directory, so the project name and the
    /// `.env` lookup are unchanged.
    pub async fn run_compose(
        stack_dir: &Path,
        project_dir: &Path,
        compose_file: &str,
        action: &str,
        tx: Option<mpsc::Sender<String>>,
    ) -> Result<bool> {
        let args = action_args(action)?;

        info!(
            "Running docker compose in {:?} (project dir {:?}) with file '{}' action '{}'",
            stack_dir, project_dir, compose_file, action
        );

        let owned = compose_args(stack_dir, project_dir, compose_file, &args);
        let full_args: Vec<&str> = owned.iter().map(|s| s.as_str()).collect();
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

    #[test]
    fn test_compose_args_are_plain_when_the_views_agree() {
        let args = compose_args(
            Path::new("/data/stacks/demo"),
            Path::new("/data/stacks/demo"),
            "compose.yml",
            &["up", "-d"],
        );
        assert_eq!(args, vec!["compose", "-f", "compose.yml", "up", "-d"]);
    }

    #[test]
    fn test_compose_args_point_at_the_daemons_view_when_it_differs() {
        let args = compose_args(
            Path::new("/stacks/demo"),
            Path::new("/home/user/stacks/demo"),
            "compose.yml",
            &["up", "-d"],
        );
        assert_eq!(
            args,
            vec![
                "compose",
                "--project-directory",
                "/home/user/stacks/demo",
                "-f",
                "compose.yml",
                "up",
                "-d",
            ]
        );
    }

    #[test]
    fn test_compose_args_pass_the_env_file_explicitly() {
        let dir = std::env::temp_dir().join(format!(
            "gisco_envfile_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(".env"), "A=1\n").unwrap();

        let args = compose_args(
            &dir,
            Path::new("/home/user/stacks/demo"),
            "compose.yml",
            &["up"],
        );
        assert_eq!(args[1], "--project-directory");
        assert_eq!(args[3], "--env-file");
        assert!(args[4].ends_with(".env"));

        let _ = std::fs::remove_dir_all(dir);
    }
}
