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
    /// From a top-level `# desc: ...` comment in the compose file, if any.
    #[serde(default)]
    pub description: Option<String>,
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
    #[serde(default)]
    pub interfaces: Vec<crate::network_graph::builder::ContainerInterface>,
    /// Container labels (drives Traefik detection on the frontend).
    #[serde(default)]
    pub labels: std::collections::HashMap<String, String>,
    /// Host port mappings derived from published ports.
    #[serde(default)]
    pub host_ports: Vec<crate::network_graph::builder::HostPortNode>,
    #[serde(default)]
    pub hostname: Option<String>,
    #[serde(default)]
    pub domainname: Option<String>,
    /// The modules that apply to this container.
    #[serde(default)]
    pub modules: Vec<crate::modules::DetectedModule>,
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
    /// From a top-level `# desc: ...` comment in the compose file, if any.
    #[serde(default)]
    pub description: Option<String>,
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
                    containers_by_project
                        .entry(proj.clone())
                        .or_default()
                        .push(c);
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
                    let compose_filename =
                        c_file.file_name().unwrap().to_string_lossy().to_string();
                    let has_env = path.join(".env").exists();

                    let metadata = fs::metadata(&c_file).ok();
                    let updated_at = metadata
                        .and_then(|m| m.modified().ok())
                        .map(|t| {
                            let dt: chrono::DateTime<chrono::Utc> = t.into();
                            dt.to_rfc3339()
                        })
                        .unwrap_or_default();

                    let compose_content = fs::read_to_string(&c_file).unwrap_or_default();
                    // Count the services the compose file *declares*, not the
                    // containers that happen to exist. Counting containers made
                    // the denominator shrink when one was deleted out-of-band,
                    // so a stack missing a service still read as fully Running.
                    let declared_services = extract_services_from_yaml(&compose_content).len();

                    let stack_containers = containers_by_project.get(&stack_name);
                    let (status, running_count, total_count) = if let Some(conts) = stack_containers
                    {
                        let running = conts
                            .iter()
                            .filter(|c| c.state.as_deref() == Some("running"))
                            .count();
                        // If the file could not be parsed we do not know the
                        // real total, so fall back to what is running.
                        let total = if declared_services > 0 {
                            declared_services
                        } else {
                            conts.len()
                        };
                        (stack_status(total, running), running, total)
                    } else {
                        (stack_status(declared_services, 0), 0, declared_services)
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
                        description: description(&compose_content),
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
                description: None,
            });
        }

        summaries.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(summaries)
    }

    pub async fn get_stack(&self, name: &str, docker: &DockerService) -> Result<StackDetails> {
        if !valid_path_component(name) {
            anyhow::bail!("Invalid stack name '{}'", name);
        }
        let stack_path = self.stack_dir.join(name);

        // External stack: no directory, but containers carry the project label.
        // Serve a read-only view (no compose content, no file metadata).
        if !stack_path.is_dir() {
            let stack_containers = docker
                .list_containers_for_stack(name)
                .await
                .unwrap_or_default();
            if stack_containers.is_empty() {
                anyhow::bail!("Stack '{}' not found", name);
            }
            let inspected = inspect_containers(docker, &stack_containers).await;
            let envs: HashMap<String, HashMap<String, String>> = inspected
                .iter()
                .map(|(id, i)| (id.clone(), i.env.clone()))
                .collect();
            let detected = crate::modules::detect_modules(&stack_containers, &envs);
            let (containers_info, running_count) =
                container_infos(&stack_containers, &inspected, &detected);
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
                description: None,
            });
        }

        let compose_file_path = find_compose_file(&stack_path)
            .ok_or_else(|| anyhow::anyhow!("No compose file found in stack '{}'", name))?;
        let compose_file_name = compose_file_path
            .file_name()
            .unwrap()
            .to_string_lossy()
            .to_string();

        let compose_content =
            fs::read_to_string(&compose_file_path).context("Reading compose file content")?;

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
        let stack_containers = docker
            .list_containers_for_stack(name)
            .await
            .unwrap_or_default();
        let inspected = inspect_containers(docker, &stack_containers).await;
        let envs: HashMap<String, HashMap<String, String>> = inspected
            .iter()
            .map(|(id, i)| (id.clone(), i.env.clone()))
            .collect();
        let detected = crate::modules::detect_modules(&stack_containers, &envs);
        let (containers_info, running_count) =
            container_infos(&stack_containers, &inspected, &detected);

        let total = containers_info.len();
        let status = stack_status(total, running_count);
        let description = description(&compose_content);

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
            description,
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
        if !valid_path_component(name) {
            anyhow::bail!("Invalid stack name '{}'", name);
        }
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
        let compose_file =
            find_compose_file(&stack_path).unwrap_or_else(|| stack_path.join("compose.yml"));

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

    /// Bind-mount warnings for a compose file that is about to be saved.
    /// `project_dir` is the directory the Docker daemon sees for the stack.
    pub fn bind_mount_warnings(
        &self,
        compose_content: &str,
        project_dir: &Path,
    ) -> Vec<BindMountWarning> {
        check_bind_mounts(compose_content, project_dir)
    }

    pub fn stack_exists(&self, name: &str) -> Result<bool> {
        if !valid_path_component(name) {
            anyhow::bail!("Invalid stack name '{}'", name);
        }
        Ok(self.stack_dir.join(name).exists())
    }

    pub fn delete_stack(&self, name: &str) -> Result<()> {
        if !valid_path_component(name) {
            anyhow::bail!("Invalid stack name '{}'", name);
        }
        let stack_path = self.stack_dir.join(name);
        if stack_path.exists() {
            fs::remove_dir_all(&stack_path)
                .with_context(|| format!("Deleting stack directory {:?}", stack_path))?;
            info!("Deleted stack directory '{}'", name);
        }
        Ok(())
    }
}

/// Hostname/domainname plus per-network aliases per container id, fetched
/// concurrently. The container list endpoint omits endpoint aliases, so they
/// are only available from inspect. Failures map to absent entries.
struct ContainerInspectInfo {
    hostname: Option<String>,
    domainname: Option<String>,
    /// Aliases per network name and per network id.
    aliases: HashMap<String, Vec<String>>,
    /// The container's environment.
    env: HashMap<String, String>,
}

async fn inspect_containers(
    docker: &DockerService,
    containers: &[ContainerSummary],
) -> HashMap<String, ContainerInspectInfo> {
    futures_util::future::join_all(containers.iter().map(|c| {
        let id = c.id.clone().unwrap_or_default();
        let docker = docker.clone();
        async move {
            let info = docker.inspect_container(&id).await.ok().map(|insp| {
                // Read the environment before the inspect response is moved
                // apart below.
                let env = crate::modules::env_from_inspect(&insp);
                let hostname = insp.config.as_ref().and_then(|cfg| cfg.hostname.clone());
                let domainname = insp.config.as_ref().and_then(|cfg| cfg.domainname.clone());
                // Key aliases by both network name and id; interface lookups
                // use whichever identifier the list endpoint provided.
                let mut aliases: HashMap<String, Vec<String>> = HashMap::new();
                if let Some(settings) = insp.network_settings {
                    if let Some(networks) = settings.networks {
                        for (net_name, endpoint) in networks {
                            let endpoint_aliases = endpoint.aliases.unwrap_or_default();
                            if endpoint_aliases.is_empty() {
                                continue;
                            }
                            aliases
                                .entry(net_name.clone())
                                .or_default()
                                .extend(endpoint_aliases.clone());
                            if let Some(net_id) = endpoint.network_id {
                                aliases.entry(net_id).or_default().extend(endpoint_aliases);
                            }
                        }
                    }
                }
                ContainerInspectInfo {
                    hostname,
                    domainname,
                    aliases,
                    env,
                }
            });
            (id, info)
        }
    }))
    .await
    .into_iter()
    .filter_map(|(id, info)| info.map(|i| (id, i)))
    .collect()
}

fn stack_status(total: usize, running: usize) -> StackStatus {
    if total == 0 {
        StackStatus::Stopped
    } else if running >= total {
        // `>=` because one service can run several containers (`deploy.replicas`
        // or `--scale`), so running containers may legitimately exceed the
        // number of declared services.
        StackStatus::Running
    } else if running > 0 {
        StackStatus::Partial
    } else {
        StackStatus::Stopped
    }
}

fn container_infos(
    containers: &[ContainerSummary],
    inspected: &HashMap<String, ContainerInspectInfo>,
    detected: &HashMap<String, Vec<crate::modules::DetectedModule>>,
) -> (Vec<StackContainerInfo>, usize) {
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

        let mut host_ports = Vec::new();
        let ports = c
            .ports
            .as_ref()
            .map(|ports| {
                ports
                    .iter()
                    .map(|p| {
                        if let Some(hp) = p.public_port {
                            let hip = p.ip.clone().unwrap_or_else(|| "0.0.0.0".to_string());
                            let proto = p
                                .typ
                                .as_ref()
                                .map(|t| t.to_string())
                                .unwrap_or_else(|| "tcp".to_string());
                            host_ports.push(crate::network_graph::builder::HostPortNode {
                                id: format!("host_port_{}_{}_{}", hip, hp, proto),
                                host_ip: hip.clone(),
                                host_port: hp,
                                protocol: proto.clone(),
                                target_container_id: id.clone(),
                                target_container_port: p.private_port,
                            });
                        }
                        format!(
                            "{}:{}->{}/{}",
                            p.ip.as_deref().unwrap_or("0.0.0.0"),
                            p.public_port.unwrap_or(0),
                            p.private_port,
                            p.typ
                                .as_ref()
                                .map(|t| t.to_string())
                                .as_deref()
                                .unwrap_or("tcp")
                        )
                    })
                    .collect()
            })
            .unwrap_or_default();

        let mut interfaces = Vec::new();
        if let Some(settings) = &c.network_settings {
            if let Some(nets) = &settings.networks {
                for (net_name, endpoint) in nets {
                    let network_id = endpoint
                        .network_id
                        .clone()
                        .unwrap_or_else(|| net_name.clone());
                    // Union the list aliases (usually empty) with the inspect
                    // aliases, keyed by both network id and name.
                    let mut aliases = endpoint.aliases.clone().unwrap_or_default();
                    if let Some(inspected_aliases) = inspected.get(&id).map(|i| &i.aliases) {
                        for key in [&network_id, net_name] {
                            if let Some(extra) = inspected_aliases.get(key) {
                                aliases.extend(extra.iter().cloned());
                            }
                        }
                    }
                    aliases.sort();
                    aliases.dedup();
                    interfaces.push(crate::network_graph::builder::ContainerInterface {
                        network_id,
                        network_name: net_name.clone(),
                        ip_address: endpoint.ip_address.clone().unwrap_or_default(),
                        mac_address: endpoint.mac_address.clone().unwrap_or_default(),
                        gateway: endpoint.gateway.clone().unwrap_or_default(),
                        aliases,
                    });
                }
            }
        }
        interfaces.sort_by(|a, b| {
            crate::network_graph::builder::ip_sort_key(&a.ip_address)
                .cmp(&crate::network_graph::builder::ip_sort_key(&b.ip_address))
        });

        let (hostname, domainname) = inspected
            .get(&id)
            .map(|i| (i.hostname.clone(), i.domainname.clone()))
            .unwrap_or((None, None));

        let modules = detected.get(&id).cloned().unwrap_or_default();
        infos.push(StackContainerInfo {
            id,
            name: c_name,
            service,
            state,
            status,
            image,
            ports,
            interfaces,
            labels: c.labels.clone().unwrap_or_default(),
            host_ports,
            hostname,
            domainname,
            modules,
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

/// Reject values that could escape their configured parent directory. Existing
/// stack directories may use characters outside Docker's new-name rules, but a
/// request name must always remain one filesystem path component.
pub fn valid_path_component(name: &str) -> bool {
    !name.is_empty() && name != "." && name != ".." && !name.contains('/') && !name.contains('\\')
}

/// Docker compose project names must be lowercase (compose silently
/// lowercases anything else, which would split a gisco stack from its
/// containers: dir `Foo` vs project label `foo`).
pub fn valid_stack_name(name: &str) -> bool {
    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| regex::Regex::new("^[a-z0-9][a-z0-9_-]*$").unwrap());
    re.is_match(name)
}

/// The top-level extension field carrying a description.
///
/// One key for both stacks and templates. A separate key per role would only
/// pay off if one compose file could need two different descriptions at once,
/// and it cannot: templates are discovered solely in the template directory and
/// stacks solely in the stack directory, and instantiating a template strips
/// the description before writing the stack. Sharing the key also keeps the
/// migration name-preserving — `# desc:` becomes `x-desc` rather than splitting
/// one concept into two names.
///
/// Compose ignores every top-level `x-` field by design — the one place it
/// tolerates unrecognised keys (compose-spec, "Extension"). That makes this safe
/// to add to any compose file: no warning, no validation error, and it survives
/// `docker compose config` untouched.
pub const DESC_KEY: &str = "x-desc";

/// Read the top-level `x-desc` extension field from compose text.
///
/// Parsed as YAML rather than pattern-matched on lines. A line scan would also
/// match an `x-desc` nested under a service, or one inside a comment.
///
/// Two channels, tried in order:
///
/// 1. **YAML parse** — handles quoted strings, block scalars, and everything
///    else serde_yaml accepts. Only a string value counts; a number or mapping
///    under the key is treated as absent, so a stray `x-desc: 3.10` falls
///    through to the deprecated comment instead of printing "3.1".
///
/// 2. **Line-based fallback** — only when the document does not parse as YAML
///    at all (custom tags such as `!reset`, which serde_yaml rejects). serde_yaml
///    also rejects unquoted plain scalars that contain `: ` (colon-space),
///    e.g. `x-desc: this is traefik :)`. Quoting fixes those (`x-desc: "this is
///    traefik :)"`), but users shouldn't have to quote a description, so the
///    line scan rescues them. A key must start at column 0, so a nested
///    `x-desc:` under a service or inside a block scalar is not matched.
///
/// A document that does not parse as YAML and has no top-level `x-desc:` line
/// yields None rather than an error: a description is optional metadata and
/// must never stop a stack from being read.
fn extension_description(content: &str) -> Option<String> {
    let doc: serde_json::Value = serde_yaml::from_str(content).ok()?;
    let text = doc.get(DESC_KEY)?.as_str()?.trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

/// Extract a `# desc: ...` top-level comment (column 0) from compose text.
///
/// **Deprecated.** Superseded by `x-desc`, which takes precedence when present.
/// Retained so compose files already in the wild keep their description; only the
/// first match counts, and empty descriptions yield None.
pub fn extract_description(content: &str) -> Option<String> {
    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| regex::Regex::new(r"^#[ \t]*desc[ \t]*:(.*)$").unwrap());
    content.lines().find_map(|line| {
        if !line.starts_with('#') {
            return None;
        }
        re.captures(line).and_then(|caps| {
            let desc = caps[1].trim().to_string();
            if desc.is_empty() {
                None
            } else {
                Some(desc)
            }
        })
    })
}

/// A compose file's description: `x-desc` wins, `# desc:` is the deprecated
/// fallback. Identical for stacks and templates.
pub fn description(content: &str) -> Option<String> {
    extension_description(content).or_else(|| extract_description(content))
}

/// Drop the top-level `x-desc:` line, and the indented body if it opens a block
/// scalar (`|` or `>`). Without the body handling, stripping `x-desc: >` would
/// leave its continuation lines behind and corrupt the file.
fn strip_extension_key(content: &str) -> String {
    let mut out: Vec<&str> = Vec::new();
    let mut lines = content.lines().peekable();
    while let Some(line) = lines.next() {
        // A top-level key starts at column 0, so a match here cannot be inside a
        // block scalar or a service body — those are indented.
        let matched = line
            .strip_prefix(DESC_KEY)
            .and_then(|tail| tail.trim_start_matches([' ', '\t']).strip_prefix(':'));
        match matched {
            Some(value) => {
                let value = value.trim_start_matches([' ', '\t']);
                if value.starts_with('|') || value.starts_with('>') {
                    while let Some(next) = lines.peek() {
                        if next.trim().is_empty() || next.starts_with([' ', '\t']) {
                            lines.next();
                        } else {
                            break;
                        }
                    }
                }
            }
            // `x-desc-something:` shares a prefix but is not our key.
            None => out.push(line),
        }
    }
    let mut joined = out.join("\n");
    if content.ends_with('\n') {
        joined.push('\n');
    }
    joined
}

/// Remove description metadata — the deprecated top-level `# desc:` comments and
/// the `x-desc` field — used when instantiating a template so the deployed
/// compose file doesn't carry the blurb.
///
/// Line-based on purpose. Re-serialising the parsed YAML would rewrite the
/// user's entire file and discard every comment, which is the one thing a tool
/// editing someone's compose file must not do.
pub fn strip_description(content: &str) -> String {
    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| regex::Regex::new(r"^#[ \t]*desc[ \t]*:.*$").unwrap());
    let without_comments = content
        .lines()
        .filter(|line| !(line.starts_with('#') && re.is_match(line)))
        .collect::<Vec<_>>()
        .join("\n");
    let mut out = strip_extension_key(&without_comments);
    // The intermediate joins drop a trailing newline; restore the original one.
    if content.ends_with('\n') && !out.ends_with('\n') {
        out.push('\n');
    }
    out
}

pub fn find_compose_file(dir: &Path) -> Option<PathBuf> {
    for filename in COMPOSE_FILENAMES {
        let p = dir.join(filename);
        if p.exists() && p.is_file() {
            return Some(p);
        }
    }
    None
}

/// A one-line explanation of a bind-mount warning, for the action stream and
/// the API.
pub fn describe_bind_warning(w: &BindMountWarning) -> String {
    if w.is_directory {
        format!(
            "bind mount '{}' resolves to {}, which is a directory. Docker creates a \
             missing mount source as a directory, so a file bind mount silently \
             becomes a directory mount and the container reports 'not a \
             directory'. Remove that directory and put the file there, or mount \
             an absolute path.",
            w.source, w.resolved
        )
    } else {
        format!(
            "bind mount '{}' resolves to {}, which does not exist. Docker creates \
             a missing mount source as a directory, so a file bind mount silently \
             becomes a directory mount and the container reports 'not a \
             directory'. Put the file in the stack directory, or mount an \
             absolute path.",
            w.source, w.resolved
        )
    }
}

/// A relative bind-mount source that will not resolve the way it reads.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct BindMountWarning {
    /// The source exactly as written, e.g. `./config.ini`.
    pub source: String,
    /// Where it resolves on the host, e.g. `/data/stacks/demo/config.ini`.
    pub resolved: String,
    /// The path exists but is a directory. This is the state a failed attempt
    /// leaves behind, because Docker creates a missing mount source as a
    /// directory — owned by root, so the user cannot simply overwrite it.
    pub is_directory: bool,
    /// A full explanation, so the UI does not have to restate it.
    pub message: String,
}

/// Does this path look like it names a file rather than a directory?
///
/// Only used to decide whether a missing source is worth complaining about: a
/// missing *directory* mount source is fine, because Docker creates it as a
/// directory and the mount works. A missing *file* source is not, because Docker
/// creates it as a directory too and the container then gets a directory where
/// the application expects a file — which surfaces as "not a directory".
fn looks_like_file(path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path);
    // A dot in the final segment, and not a leading dot ("./config" is a
    // directory, ".env" is a file, but a bare "." is a directory).
    match name.rfind('.') {
        Some(0) | None => false,
        Some(_) => true,
    }
}

/// Extract the host source of a volume spec, if it names one.
fn volume_source(vol: &serde_yaml::Value) -> Option<String> {
    match vol {
        // Long syntax: { type: bind, source: ..., target: ... }
        serde_yaml::Value::Mapping(m) => {
            let is_bind = m
                .get(serde_yaml::Value::String("type".into()))
                .and_then(|v| v.as_str())
                == Some("bind");
            if !is_bind {
                return None;
            }
            m.get(serde_yaml::Value::String("source".into()))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        }
        // Short syntax: "source:target[:mode]". A spec with no source is an
        // anonymous volume and names no host path.
        serde_yaml::Value::String(spec) => {
            let mut parts = spec.split(':');
            let source = parts.next().unwrap_or("");
            if source.is_empty() {
                None
            } else {
                Some(source.to_string())
            }
        }
        _ => None,
    }
}

/// The target of a volume spec, used only to guess whether the author meant a
/// file.
fn volume_target(vol: &serde_yaml::Value) -> Option<String> {
    match vol {
        serde_yaml::Value::Mapping(m) => m
            .get(serde_yaml::Value::String("target".into()))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        serde_yaml::Value::String(spec) => spec.split(':').nth(1).map(|s| s.to_string()),
        _ => None,
    }
}

/// Check the bind mounts in a compose file against the stack directory.
///
/// A relative bind mount resolves against the *project directory* — the
/// directory holding the compose file, which for gisco is the stack directory.
/// gisco only ever writes `compose.yml` and `.env` there, so a file the author
/// expected to be alongside their compose file is simply absent, and Docker
/// responds by creating the missing source as a **directory**. The container
/// then gets a directory where the application expects a file, and the failure
/// surfaces as "not a directory" — long after the stack is saved, and only
/// inside the container.
///
/// Reporting this at save time turns a confusing runtime error into something
/// actionable. A document that does not parse yields no warnings rather than
/// an error: this is advice, not validation.
pub fn check_bind_mounts(compose_content: &str, stack_dir: &Path) -> Vec<BindMountWarning> {
    let doc: serde_yaml::Value = match serde_yaml::from_str(compose_content) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    let services = match doc.get("services").and_then(|s| s.as_mapping()) {
        Some(s) => s,
        None => return Vec::new(),
    };

    let mut warnings: Vec<BindMountWarning> = Vec::new();
    for (_name, svc) in services {
        let volumes = match svc.get("volumes").and_then(|v| v.as_sequence()) {
            Some(v) => v,
            None => continue,
        };
        for vol in volumes {
            let source = match volume_source(vol) {
                Some(s) => s,
                None => continue,
            };
            // Only relative sources are checked. An absolute path may legitimately
            // not exist from the daemon's point of view — Docker Desktop shares
            // only part of the host filesystem — so warning about it would be
            // a false positive.
            if !source.starts_with("./") && !source.starts_with("../") {
                continue;
            }
            // A mount of a named volume ("config.ini:/app/x") is not a bind
            // mount at all and never touches the host path.
            let target = volume_target(vol);
            let fileish =
                looks_like_file(&source) || target.as_deref().map(looks_like_file).unwrap_or(false);
            if !fileish {
                continue;
            }

            let resolved = stack_dir.join(source.trim_start_matches("./"));
            let resolved = normalize_path(&resolved);
            if resolved.is_dir() {
                let warning = BindMountWarning {
                    source: source.clone(),
                    resolved: resolved.to_string_lossy().to_string(),
                    is_directory: true,
                    message: String::new(),
                };
                let message = describe_bind_warning(&warning);
                warnings.push(BindMountWarning { message, ..warning });
            } else if !resolved.exists() {
                let warning = BindMountWarning {
                    source: source.clone(),
                    resolved: resolved.to_string_lossy().to_string(),
                    is_directory: false,
                    message: String::new(),
                };
                let message = describe_bind_warning(&warning);
                warnings.push(BindMountWarning { message, ..warning });
            }
        }
    }
    warnings
}

/// Collapse `..` segments so a warning shows the path Docker will actually
/// use. `Path::canonicalize` cannot be used: the path usually does not exist.
fn normalize_path(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::ParentDir => {
                out.pop();
            }
            std::path::Component::CurDir => {}
            other => out.push(other),
        }
    }
    out
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
    fn test_container_infos() {
        use bollard::models::{
            ContainerSummary, ContainerSummaryNetworkSettings, EndpointSettings, Port,
        };
        use std::collections::HashMap;

        let mut labels = HashMap::new();
        labels.insert("com.docker.compose.service".to_string(), "web".to_string());
        let mut networks = HashMap::new();
        networks.insert(
            "demo_default".to_string(),
            EndpointSettings {
                network_id: Some("net123".to_string()),
                ip_address: Some("10.0.0.2".to_string()),
                mac_address: Some("aa:bb:cc".to_string()),
                gateway: Some("10.0.0.1".to_string()),
                aliases: Some(vec!["web".to_string()]),
                ..Default::default()
            },
        );
        let containers = vec![
            ContainerSummary {
                id: Some("abc123def456".to_string()),
                names: Some(vec!["/myapp-web-1".to_string()]),
                image: Some("nginx:latest".to_string()),
                state: Some("running".to_string()),
                status: Some("Up 5 minutes".to_string()),
                ports: Some(vec![Port {
                    ip: Some("0.0.0.0".to_string()),
                    private_port: 80,
                    public_port: Some(8080),
                    typ: None,
                }]),
                labels: Some(labels),
                network_settings: Some(ContainerSummaryNetworkSettings {
                    networks: Some(networks),
                }),
                ..Default::default()
            },
            ContainerSummary {
                id: Some("deadbeef".to_string()),
                names: None,
                image: None,
                state: Some("exited".to_string()),
                status: None,
                ports: None,
                labels: None,
                ..Default::default()
            },
        ];

        // The list endpoint omits aliases; inspect supplies them keyed by
        // network name, and they are merged with the list values.
        let mut inspected_aliases = HashMap::new();
        inspected_aliases.insert(
            "demo_default".to_string(),
            vec!["api".to_string(), "web".to_string()],
        );
        let mut inspected = HashMap::new();
        inspected.insert(
            "abc123def456".to_string(),
            ContainerInspectInfo {
                hostname: None,
                domainname: None,
                aliases: inspected_aliases,
                env: HashMap::new(),
            },
        );

        let (infos, running) = container_infos(&containers, &inspected, &HashMap::new());
        assert_eq!(running, 1);
        assert_eq!(infos.len(), 2);
        assert_eq!(infos[0].name, "myapp-web-1");
        assert_eq!(infos[0].service.as_deref(), Some("web"));
        assert_eq!(infos[0].ports, vec!["0.0.0.0:8080->80/tcp"]);
        assert_eq!(infos[0].interfaces.len(), 1);
        assert_eq!(infos[0].interfaces[0].network_id, "net123");
        assert_eq!(infos[0].interfaces[0].network_name, "demo_default");
        assert_eq!(infos[0].interfaces[0].ip_address, "10.0.0.2");
        assert_eq!(infos[0].interfaces[0].aliases, vec!["api", "web"]);
        assert_eq!(
            infos[0]
                .labels
                .get("com.docker.compose.service")
                .map(String::as_str),
            Some("web")
        );
        assert_eq!(infos[0].host_ports.len(), 1);
        assert_eq!(infos[0].host_ports[0].host_port, 8080);
        assert_eq!(infos[0].host_ports[0].target_container_port, 80);
        assert_eq!(infos[0].hostname, None);
        // Missing name falls back to the short id; missing service is None.
        assert_eq!(infos[1].name, "deadbeef");
        assert_eq!(infos[1].service, None);
        assert!(infos[1].ports.is_empty());
        assert!(infos[1].interfaces.is_empty());
    }

    #[test]
    fn test_external_services() {
        use bollard::models::ContainerSummary;
        use std::collections::HashMap;

        let labelled = |svc: &str| {
            let mut labels = HashMap::new();
            labels.insert("com.docker.compose.service".to_string(), svc.to_string());
            ContainerSummary {
                labels: Some(labels),
                ..Default::default()
            }
        };
        let containers = vec![
            labelled("worker"),
            labelled("web"),
            labelled("web"),
            ContainerSummary {
                labels: None,
                ..Default::default()
            },
        ];
        assert_eq!(external_services(&containers), vec!["web", "worker"]);
    }

    #[test]
    fn test_extract_description() {
        assert_eq!(
            extract_description("# desc: My cool stack\nservices:\n  a:\n    image: x\n"),
            Some("My cool stack".to_string())
        );
        // Indented comments are nested, not top-level.
        assert_eq!(
            extract_description("services:\n  a:\n    # desc: nested\n    image: x\n"),
            None
        );
        // First match wins; empty descs are ignored.
        assert_eq!(
            extract_description("# desc:\n# desc: Second\n"),
            Some("Second".to_string())
        );
        assert_eq!(extract_description("# description: nope\n"), None);
        assert_eq!(extract_description("services: {}\n"), None);
        // No space after # is fine; uppercase DESC does not match.
        assert_eq!(
            extract_description("#desc:nospace\n"),
            Some("nospace".to_string())
        );
        assert_eq!(extract_description("# DESC: loud\n"), None);
        // Colons inside the value are preserved.
        assert_eq!(
            extract_description("# desc: a: b\n"),
            Some("a: b".to_string())
        );
    }

    #[test]
    fn test_strip_description() {
        let stripped = strip_description("# desc: Blurb\nservices:\n  a:\n    image: x\n");
        assert_eq!(stripped, "services:\n  a:\n    image: x\n");
        // Nested desc comments are left alone.
        let nested = "services:\n  a:\n    # desc: keep me\n    image: x\n";
        assert_eq!(strip_description(nested), nested);
        // No trailing newline in, none out; every desc line is removed.
        assert_eq!(
            strip_description("# desc: one\nservices: {}\n# desc: two"),
            "services: {}"
        );
    }

    #[test]
    fn test_description_prefers_extension_field() {
        // The supported form.
        assert_eq!(
            description("x-desc: A neat stack\nservices: {}\n"),
            Some("A neat stack".to_string())
        );
        // Quoted, and with interior colons preserved.
        assert_eq!(
            description("x-desc: \"Web: the front end\"\nservices: {}\n"),
            Some("Web: the front end".to_string())
        );
        // Block scalar.
        assert_eq!(
            description("x-desc: >\n  spans two\n  lines\nservices: {}\n"),
            Some("spans two lines".to_string())
        );
        // x- wins when the deprecated comment is also present.
        assert_eq!(
            description("# desc: old\nx-desc: new\nservices: {}\n"),
            Some("new".to_string())
        );
        // Deprecated comment still works on its own.
        assert_eq!(
            description("# desc: old\nservices: {}\n"),
            Some("old".to_string())
        );
        // Surrounding whitespace on the value is trimmed.
        assert_eq!(
            description("x-desc: \"  padded  \"\nservices: {}\n"),
            Some("padded".to_string())
        );
        // A nested x-desc is not top level and must be ignored.
        assert_eq!(description("services:\n  web:\n    x-desc: sneaky\n"), None);
        // A commented-out key is a comment, not a field.
        assert_eq!(description("# x-desc: commented out\n"), None);
        // Non-string and empty values fall back rather than printing junk.
        assert_eq!(
            description("# desc: kept\nx-desc: 3.10\nservices: {}\n"),
            Some("kept".to_string())
        );
        assert_eq!(
            description("# desc: kept\nx-desc:\nservices: {}\n"),
            Some("kept".to_string())
        );
        assert_eq!(
            description("# desc: kept\nx-desc:\n  nested: map\nservices: {}\n"),
            Some("kept".to_string())
        );
        // Unquoted strings parse fine, including colons and close-parens.
        assert_eq!(
            description("x-desc: this is traefik :)\nservices: {}\n"),
            Some("this is traefik :)".to_string())
        );
        assert_eq!(
            description("x-desc: value: with colon\nservices: {}\n"),
            None
        );
        // Unparseable YAML must not error — this is optional metadata. A
        // top-level `x-desc:` line is still readable even if the rest of the
        // document is broken.
        assert_eq!(
            description("x-desc: bad\nservices:\n  a: !reset null\n"),
            None
        );
        assert_eq!(description("services:\n  a: !reset null\n"), None);
    }

    #[test]
    fn test_description_is_the_same_for_stacks_and_templates() {
        // Templates and stacks read the identical key, so a single call covers
        // both. These are the shapes each population actually holds.
        let template = "x-desc: Reusable demo\nservices:\n  app:\n    image: alpine\n";
        let stack = "x-desc: this is traefik :)\nservices:\n  traefik:\n    image: traefik\n";
        assert_eq!(description(template), Some("Reusable demo".to_string()));
        assert_eq!(description(stack), Some("this is traefik :)".to_string()));
    }

    #[test]
    fn test_strip_description_removes_extension_field() {
        assert_eq!(
            strip_description("x-desc: Blurb\nservices:\n  a:\n    image: x\n"),
            "services:\n  a:\n    image: x\n"
        );
        // The key and the deprecated comment go together.
        assert_eq!(
            strip_description("# desc: old\nx-desc: new\nservices: {}\n"),
            "services: {}\n"
        );
        // A block scalar's body must go with its key, or the file is corrupted.
        assert_eq!(
            strip_description("x-desc: >\n  line one\n  line two\nservices: {}\n"),
            "services: {}\n"
        );
        assert_eq!(
            strip_description("x-desc: |\n  line one\nservices: {}\n"),
            "services: {}\n"
        );
        // A key sharing our prefix is not our key.
        let prefixed = "x-describe: keep\nservices: {}\n";
        assert_eq!(strip_description(prefixed), prefixed);
        // Other x- fields belong to the user and must survive.
        let other_ext = "x-custom:\n  foo: bar\nx-desc: Blurb\nservices: {}\n";
        assert_eq!(
            strip_description(other_ext),
            "x-custom:\n  foo: bar\nservices: {}\n"
        );
        // Nested keys are not top level and are left alone.
        let nested = "services:\n  a:\n    x-desc: keep\n    image: x\n";
        assert_eq!(strip_description(nested), nested);
        // Stripping must not disturb other comments or formatting.
        let preserved = "# a normal comment\nservices: {}\n\n# trailing note\n";
        assert_eq!(strip_description(preserved), preserved);
        // A stripped file must still parse as YAML.
        let stripped = strip_description("x-desc: >\n  one\n  two\nservices:\n  a: {}\n");
        assert!(serde_yaml::from_str::<serde_json::Value>(&stripped).is_ok());
    }

    #[test]
    fn test_check_bind_mounts_flags_missing_relative_file_sources() {
        let dir = std::env::temp_dir().join(format!(
            "gisco_bind_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();

        // A file source that is not in the stack directory. Docker creates a
        // missing source as a directory, so this silently becomes a directory
        // mount and the container gets a directory where a file was expected.
        let compose = "services:\n  app:\n    image: alpine\n    volumes:\n      - ./config.ini:/app/config.ini\n";
        let warnings = check_bind_mounts(compose, &dir);
        assert_eq!(warnings.len(), 1);
        assert_eq!(warnings[0].source, "./config.ini");
        assert!(warnings[0].resolved.ends_with("config.ini"));
        assert!(!warnings[0].is_directory);

        // A file that IS there is fine.
        fs::write(dir.join("config.ini"), "hello").unwrap();
        assert!(check_bind_mounts(compose, &dir).is_empty());

        // A missing *directory* source is not worth reporting: Docker creates
        // it as a directory and the mount works.
        let dir_mount =
            "services:\n  app:\n    image: alpine\n    volumes:\n      - ./confdir:/app/confdir\n";
        assert!(check_bind_mounts(dir_mount, &dir).is_empty());

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn test_check_bind_mounts_flags_a_source_docker_turned_into_a_directory() {
        let dir = std::env::temp_dir().join(format!(
            "gisco_bind_dir_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        // The state a failed attempt leaves behind: Docker created the missing
        // source as a root-owned directory.
        fs::create_dir(dir.join("config.ini")).unwrap();

        let compose = "services:\n  app:\n    image: alpine\n    volumes:\n      - ./config.ini:/app/config.ini\n";
        let warnings = check_bind_mounts(compose, &dir);
        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].is_directory);

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn test_check_bind_mounts_ignores_other_volume_kinds() {
        let dir = std::env::temp_dir().join(format!(
            "gisco_bind_other_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();

        // A named volume names no host path.
        let named = "services:\n  app:\n    image: alpine\n    volumes:\n      - config.ini:/app/config.ini\n";
        assert!(check_bind_mounts(named, &dir).is_empty());

        // An absolute path is outside gisco's control and may legitimately not
        // exist from the daemon's point of view.
        let absolute =
            "services:\n  app:\n    image: alpine\n    volumes:\n      - /opt/config.ini:/app/config.ini\n";
        assert!(check_bind_mounts(absolute, &dir).is_empty());

        // Long syntax is understood too.
        let long = "services:\n  app:\n    image: alpine\n    volumes:\n      - type: bind\n        source: ./config.ini\n        target: /app/config.ini\n";
        assert_eq!(check_bind_mounts(long, &dir).len(), 1);

        // A long-syntax volume that is not a bind mount names no host path.
        let named_long = "services:\n  app:\n    image: alpine\n    volumes:\n      - type: volume\n        source: config\n        target: /app/data\n";
        assert!(check_bind_mounts(named_long, &dir).is_empty());

        // A document that does not parse yields no warnings, not an error.
        assert!(check_bind_mounts("services:\n  a: !reset null\n", &dir).is_empty());
        assert!(check_bind_mounts("not yaml at all: [", &dir).is_empty());

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn test_valid_stack_name() {
        for ok in ["foo", "a-1_b", "0abc", "ignition-1", "x"] {
            assert!(valid_stack_name(ok), "{}", ok);
        }
        for bad in ["", "Ignition-1", "Foo", "a b", "-a", "_a", "a/b", "a.b"] {
            assert!(!valid_stack_name(bad), "{}", bad);
        }
        // Existing names are grandfathered, but filesystem path components
        // must never be able to escape the configured stack directory.
        for bad in ["", ".", "..", "a/b", "a\\b"] {
            assert!(!valid_path_component(bad), "{}", bad);
        }
        for ok in ["Foo", "legacy stack", "a.b"] {
            assert!(valid_path_component(ok), "{}", ok);
        }
    }

    #[test]
    fn test_extract_services_with_fragments() {
        // Anchors, aliases and `<<` merge keys are Compose "fragments". They
        // only affect values, never the top-level service keys, so the count
        // must be unaffected -- but only if the YAML actually parses.
        let yaml = r#"
x-envs: &envs
  LOG_LEVEL: debug
  REGION: eu
x-volume: &default-volume
  driver: local
services:
  first:
    image: alpine
    environment:
      <<: *envs
      EXTRA: yes
  second:
    image: alpine
    environment: *envs
volumes:
  shared-a:
    <<: *default-volume
  shared-b: *default-volume
"#;
        let mut svcs = extract_services_from_yaml(yaml);
        svcs.sort();
        assert_eq!(svcs, vec!["first", "second"]);
    }

    #[test]
    fn test_extract_services_with_alias_only() {
        // A bare alias with no merge key, as in Docker's own docs.
        let yaml = r#"
services:
  first:
    image: alpine
    environment: &env
      - CONFIG_KEY
  second:
    image: alpine
    environment: *env
"#;
        let mut svcs = extract_services_from_yaml(yaml);
        svcs.sort();
        assert_eq!(svcs, vec!["first", "second"]);
    }

    #[test]
    fn test_stack_status() {
        assert_eq!(stack_status(0, 0), StackStatus::Stopped);
        assert_eq!(stack_status(3, 3), StackStatus::Running);
        assert_eq!(stack_status(3, 1), StackStatus::Partial);
        assert_eq!(stack_status(3, 0), StackStatus::Stopped);
        // A declared service with its container deleted: one of three still up.
        assert_eq!(stack_status(3, 2), StackStatus::Partial);
        // One service running two containers (replicas/--scale) is still Running.
        assert_eq!(stack_status(1, 2), StackStatus::Running);
        // A stopped stack still reports how many services it declares.
        assert_eq!(stack_status(4, 0), StackStatus::Stopped);
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
        let temp_dir = std::env::temp_dir().join(format!(
            "gisco_test_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
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
        let temp_dir = std::env::temp_dir().join(format!(
            "gisco_stack_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let manager = StacksManager::new(temp_dir.clone(), 1000, 1000);

        let initial_yaml = "version: '3.8'\nservices:\n  app:\n    image: node";
        manager
            .save_stack("my-test-stack", initial_yaml, Some("FOO=bar"), None, None)
            .unwrap();

        let stack_path = temp_dir.join("my-test-stack");
        assert!(stack_path.exists());
        let compose_path = stack_path.join("compose.yml");
        assert!(compose_path.exists());
        let env_path = stack_path.join(".env");
        assert!(env_path.exists());

        // Update stack
        let updated_yaml = "version: '3.8'\nservices:\n  app:\n    image: node:alpine";
        manager
            .save_stack("my-test-stack", updated_yaml, Some("FOO=baz"), None, None)
            .unwrap();

        let read_yaml = fs::read_to_string(&compose_path).unwrap();
        assert_eq!(read_yaml, updated_yaml);

        // An explicitly empty env body removes the file; None means "leave it
        // unchanged" for callers that do not manage the env file.
        manager
            .save_stack("my-test-stack", updated_yaml, Some(""), None, None)
            .unwrap();
        assert!(!env_path.exists());

        let _ = fs::remove_dir_all(temp_dir);
    }
}
