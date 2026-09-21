use anyhow::{Context, Result};
use bollard::models::ContainerSummary;
use nix::unistd::{chown, Gid, Uid};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use tracing::{debug, info};

use crate::docker::DockerService;

const COMPOSE_FILENAMES: &[&str] = &[
    "compose.yml",
    "compose.yaml",
    "docker-compose.yml",
    "docker-compose.yaml",
];

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub enum StackStatus {
    Running,
    Partial,
    Stopped,
    Empty,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct StackSummary {
    pub name: String,
    pub path: String,
    pub compose_file: String,
    pub status: StackStatus,
    pub total_services: usize,
    pub running_services: usize,
    pub has_env: bool,
    pub updated_at: String,
    /// True when the project runs on the daemon but has no directory in
    /// `stack_dir` (not managed by gisco; operated via `docker compose -p`).
    #[serde(default)]
    pub external: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct StackContainerInfo {
    pub id: String,
    pub name: String,
    pub service: Option<String>,
    pub state: String,
    pub status: String,
    pub image: String,
    pub ports: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct StackDetails {
    pub name: String,
    pub path: String,
    pub compose_file: String,
    pub compose_content: String,
    pub env_content: Option<String>,
    pub status: StackStatus,
    pub services: Vec<String>,
    pub containers: Vec<StackContainerInfo>,
    pub file_uid: u32,
    pub file_gid: u32,
    pub file_mode: u32,
    /// True when the project has no directory in `stack_dir`.
    #[serde(default)]
    pub external: bool,
}

#[derive(Clone)]
pub struct StacksManager {
    stack_dir: PathBuf,
    default_uid: u32,
    default_gid: u32,
}

impl StacksManager {
    pub fn new(stack_dir: PathBuf, default_uid: u32, default_gid: u32) -> Self {
        Self {
            stack_dir,
            default_uid,
            default_gid,
        }
    }

    pub async fn list_stacks(&self, docker: &DockerService) -> Result<Vec<StackSummary>> {
        let mut summaries = Vec::new();

        if !self.stack_dir.exists() {
            return Ok(summaries);
        }

        // Pre-fetch all containers to match against stack compose projects
        let all_containers = docker.list_containers(true).await.unwrap_or_default();
        let mut containers_by_project: HashMap<String, Vec<&ContainerSummary>> = HashMap::new();

        for c in &all_containers {
            if let Some(labels) = &c.labels {
                if let Some(proj) = labels.get("com.docker.compose.project") {
                    containers_by_project.entry(proj.clone()).or_default().push(c);
                }
            }
        }

        let entries = fs::read_dir(&self.stack_dir).context("Reading stack dir")?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let stack_name = match path.file_name().and_then(|s| s.to_str()) {
                    Some(n) => n.to_string(),
                    None => continue,
                };

                // Find compose file
                let compose_file = find_compose_file(&path);
                if let Some(c_file) = compose_file {
                    let compose_filename = c_file.file_name().unwrap().to_string_lossy().to_string();
                    let has_env = path.join(".env").exists();

                    let metadata = fs::metadata(&c_file).ok();
                    let updated_at = metadata
                        .and_then(|m| m.modified().ok())
                        .map(|t| {
                            let dt: chrono::DateTime<chrono::Utc> = t.into();
                            dt.to_rfc3339()
                        })
                        .unwrap_or_default();

                    let stack_containers = containers_by_project.get(&stack_name);
                    let (status, running_count, total_count) = if let Some(conts) = stack_containers {
                        let total = conts.len();
                        let running = conts
                            .iter()
                            .filter(|c| c.state.as_deref() == Some("running"))
                            .count();
                        (stack_status(total, running), running, total)
                    } else {
                        (StackStatus::Stopped, 0, 0)
                    };

                    summaries.push(StackSummary {
                        name: stack_name,
                        path: path.to_string_lossy().to_string(),
                        compose_file: compose_filename,
                        status,
                        total_services: total_count,
                        running_services: running_count,
                        has_env,
                        updated_at,
                        external: false,
                    });
                }
            }
        }

        // External stacks: compose projects visible on the daemon that have no
        // directory in stack_dir. They are read-only in gisco (operated via
        // `docker compose -p <project>`), but listed so they can be managed.
        for (proj, conts) in &containers_by_project {
            if summaries.iter().any(|s| &s.name == proj) {
                continue;
            }
            let total = conts.len();
            let running = conts
                .iter()
                .filter(|c| c.state.as_deref() == Some("running"))
                .count();
            let status = stack_status(total, running);
            summaries.push(StackSummary {
                name: proj.clone(),
                path: String::new(),
                compose_file: String::new(),
                status,
                total_services: total,
                running_services: running,
                has_env: false,
                updated_at: String::new(),
                external: true,
            });
        }

        summaries.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(summaries)
    }

    pub async fn get_stack(&self, name: &str, docker: &DockerService) -> Result<StackDetails> {
        let stack_path = self.stack_dir.join(name);

        // External stack: no directory, but containers carry the project label.
        // Serve a read-only view (no compose content, no file metadata).
        if !stack_path.is_dir() {
            let stack_containers = docker.list_containers_for_stack(name).await.unwrap_or_default();
            if stack_containers.is_empty() {
                anyhow::bail!("Stack '{}' not found", name);
            }
            let (containers_info, running_count) = container_infos(&stack_containers);
            let services = external_services(&stack_containers);
            let total = containers_info.len();
            let status = stack_status(total, running_count);
            return Ok(StackDetails {
                name: name.to_string(),
                path: String::new(),
                compose_file: String::new(),
                compose_content: String::new(),
                env_content: None,
                status,
                services,
                containers: containers_info,
                file_uid: 0,
                file_gid: 0,
                file_mode: 0,
                external: true,
            });
        }

        let compose_file_path = find_compose_file(&stack_path)
            .ok_or_else(|| anyhow::anyhow!("No compose file found in stack '{}'", name))?;
        let compose_file_name = compose_file_path
            .file_name()
            .unwrap()
            .to_string_lossy()
            .to_string();

        let compose_content = fs::read_to_string(&compose_file_path)
            .context("Reading compose file content")?;

        let env_path = stack_path.join(".env");
        let env_content = if env_path.exists() {
            fs::read_to_string(&env_path).ok()
        } else {
            None
        };

        let meta = fs::metadata(&compose_file_path)?;
        let file_uid = meta.uid();
        let file_gid = meta.gid();
        let file_mode = meta.mode();

        // Extract services defined in YAML
        let services = extract_services_from_yaml(&compose_content);

        // Correlate with running containers
        let stack_containers = docker.list_containers_for_stack(name).await.unwrap_or_default();
        let (containers_info, running_count) = container_infos(&stack_containers);

        let total = containers_info.len();
        let status = stack_status(total, running_count);

        Ok(StackDetails {
            name: name.to_string(),
            path: stack_path.to_string_lossy().to_string(),
            compose_file: compose_file_name,
            compose_content,
            env_content,
            status,
            services,
            containers: containers_info,
            file_uid,
            file_gid,
            file_mode,
            external: false,
        })
    }

    pub fn save_stack(
        &self,
        name: &str,
        compose_content: &str,
        env_content: Option<&str>,
        custom_uid: Option<u32>,
        custom_gid: Option<u32>,
    ) -> Result<()> {
        let stack_path = self.stack_dir.join(name);

        let is_new = !stack_path.exists();
        if is_new && !valid_stack_name(name) {
            anyhow::bail!(
                "Invalid stack name '{}': use lowercase letters, digits, dashes and underscores, starting with a letter or digit (docker compose project name rules)",
                name
            );
        }
        if is_new {
            fs::create_dir_all(&stack_path)
                .with_context(|| format!("Creating stack directory for '{}'", name))?;
        }

        // Determine compose filename
        let compose_file = find_compose_file(&stack_path)
            .unwrap_or_else(|| stack_path.join("compose.yml"));

        // Check if existing file permissions need to be preserved
        let (target_uid, target_gid, target_mode) = if compose_file.exists() {
            let meta = fs::metadata(&compose_file)?;
            (meta.uid(), meta.gid(), Some(meta.permissions()))
        } else {
            let uid = custom_uid.unwrap_or(self.default_uid);
            let gid = custom_gid.unwrap_or(self.default_gid);
            (uid, gid, None)
        };

        // Write compose file
        fs::write(&compose_file, compose_content)
            .with_context(|| format!("Writing compose file to {:?}", compose_file))?;

        if let Some(mode) = target_mode {
            let _ = fs::set_permissions(&compose_file, mode);
        }

        // Preserve / apply UID and GID
        apply_ownership(&compose_file, target_uid, target_gid);
        if is_new {
            apply_ownership(&stack_path, target_uid, target_gid);
        }

        // Handle .env file
        let env_path = stack_path.join(".env");
        if let Some(env_str) = env_content {
            if !env_str.trim().is_empty() {
                fs::write(&env_path, env_str)?;
                apply_ownership(&env_path, target_uid, target_gid);
            } else if env_path.exists() {
                let _ = fs::remove_file(&env_path);
            }
        }

        info!("Successfully saved stack '{}' at {:?}", name, compose_file);
        Ok(())
    }

    pub fn delete_stack(&self, name: &str) -> Result<()> {
        let stack_path = self.stack_dir.join(name);
        if stack_path.exists() {
            fs::remove_dir_all(&stack_path)
                .with_context(|| format!("Deleting stack directory {:?}", stack_path))?;
            info!("Deleted stack directory '{}'", name);
        }
        Ok(())
    }
}

fn stack_status(total: usize, running: usize) -> StackStatus {
    if total == 0 {
        StackStatus::Stopped
    } else if running == total {
        StackStatus::Running
    } else if running > 0 {
        StackStatus::Partial
    } else {
        StackStatus::Stopped
    }
}

fn container_infos(containers: &[ContainerSummary]) -> (Vec<StackContainerInfo>, usize) {
    let mut infos = Vec::new();
    let mut running_count = 0;

    for c in containers {
        let id = c.id.as_deref().unwrap_or("").to_string();
        let c_name = c
            .names
            .as_ref()
            .and_then(|names| names.first())
            .map(|n| n.trim_start_matches('/').to_string())
            .unwrap_or_else(|| id[..12.min(id.len())].to_string());

        let service = c
            .labels
            .as_ref()
            .and_then(|l| l.get("com.docker.compose.service").cloned());

        let state = c.state.clone().unwrap_or_default();
        if state == "running" {
            running_count += 1;
        }
        let status = c.status.clone().unwrap_or_default();
        let image = c.image.clone().unwrap_or_default();

        let ports = c
            .ports
            .as_ref()
            .map(|ports| {
                ports
                    .iter()
                    .map(|p| {
                        format!(
                            "{}:{}->{}/{}",
                            p.ip.as_deref().unwrap_or("0.0.0.0"),
                            p.public_port.unwrap_or(0),
                            p.private_port,
                            p.typ.as_ref().map(|t| t.to_string()).as_deref().unwrap_or("tcp")
                        )
                    })
                    .collect()
            })
            .unwrap_or_default();

        infos.push(StackContainerInfo {
            id,
            name: c_name,
            service,
            state,
            status,
            image,
            ports,
        });
    }

    (infos, running_count)
}

/// Distinct compose service names from container labels (external stacks have
/// no compose file to parse services from).
fn external_services(containers: &[ContainerSummary]) -> Vec<String> {
    let mut services: Vec<String> = containers
        .iter()
        .filter_map(|c| {
            c.labels
                .as_ref()
                .and_then(|l| l.get("com.docker.compose.service").cloned())
        })
        .collect();
    services.sort();
    services.dedup();
    services
}

/// Docker compose project names must be lowercase (compose silently
/// lowercases anything else, which would split a gisco stack from its
/// containers: dir `Foo` vs project label `foo`).
pub fn valid_stack_name(name: &str) -> bool {
    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| regex::Regex::new("^[a-z0-9][a-z0-9_-]*$").unwrap());
    re.is_match(name)
}

pub fn find_compose_file(dir: &Path) -> Option<PathBuf> {    for filename in COMPOSE_FILENAMES {
        let p = dir.join(filename);
        if p.exists() && p.is_file() {
            return Some(p);
        }
    }
    None
}

fn apply_ownership(path: &Path, uid: u32, gid: u32) {
    if let Err(e) = chown(path, Some(Uid::from_raw(uid)), Some(Gid::from_raw(gid))) {
        debug!(
            "Could not chown {:?} to {}:{}: {} (may run as non-root)",
            path, uid, gid, e
        );
    }
}

fn extract_services_from_yaml(yaml_content: &str) -> Vec<String> {
    let mut services = Vec::new();
    if let Ok(val) = serde_yaml::from_str::<serde_json::Value>(yaml_content) {
        if let Some(svc_map) = val.get("services").and_then(|s| s.as_object()) {
            for k in svc_map.keys() {
                services.push(k.clone());
            }
        }
    }
    services
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_stack_name() {
        for ok in ["foo", "a-1_b", "0abc", "ignition-1", "x"] {
            assert!(valid_stack_name(ok), "{}", ok);
        }
        for bad in ["", "Ignition-1", "Foo", "a b", "-a", "_a", "a/b", "a.b"] {
            assert!(!valid_stack_name(bad), "{}", bad);
        }
    }

    #[test]
    fn test_stack_status() {
        assert_eq!(stack_status(0, 0), StackStatus::Stopped);
        assert_eq!(stack_status(3, 3), StackStatus::Running);
        assert_eq!(stack_status(3, 1), StackStatus::Partial);
        assert_eq!(stack_status(3, 0), StackStatus::Stopped);
    }

    #[test]
    fn test_extract_services_from_yaml() {
        let yaml = r#"
version: '3.8'
services:
  web:
    image: nginx
  database:
    image: postgres
  redis:
    image: redis
"#;
        let mut svcs = extract_services_from_yaml(yaml);
        svcs.sort();
        assert_eq!(svcs, vec!["database", "redis", "web"]);
    }

    #[test]
    fn test_find_compose_file() {
        let temp_dir = std::env::temp_dir().join(format!("gisco_test_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(&temp_dir).unwrap();

        assert!(find_compose_file(&temp_dir).is_none());

        let compose_file = temp_dir.join("compose.yaml");
        fs::write(&compose_file, "services:\n  test:\n    image: alpine").unwrap();

        let found = find_compose_file(&temp_dir);
        assert_eq!(found, Some(compose_file));

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn test_save_and_preserve_stack() {
        let temp_dir = std::env::temp_dir().join(format!("gisco_stack_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let manager = StacksManager::new(temp_dir.clone(), 1000, 1000);

        let initial_yaml = "version: '3.8'\nservices:\n  app:\n    image: node";
        manager.save_stack("my-test-stack", initial_yaml, Some("FOO=bar"), None, None).unwrap();

        let stack_path = temp_dir.join("my-test-stack");
        assert!(stack_path.exists());
        let compose_path = stack_path.join("compose.yml");
        assert!(compose_path.exists());
        let env_path = stack_path.join(".env");
        assert!(env_path.exists());

        // Update stack
        let updated_yaml = "version: '3.8'\nservices:\n  app:\n    image: node:alpine";
        manager.save_stack("my-test-stack", updated_yaml, Some("FOO=baz"), None, None).unwrap();

        let read_yaml = fs::read_to_string(&compose_path).unwrap();
        assert_eq!(read_yaml, updated_yaml);

        let _ = fs::remove_dir_all(temp_dir);
    }
}
