//! Application-specific modules.
//!
//! A module recognises a kind of application by its container metadata and
//! offers a small menu of operations for it. The mssql case: recognise a
//! Microsoft SQL Server container, and offer "enable SQL Server Agent", which
//! runs `mssql-conf` inside the container.
//!
//! Detection is **metadata only**. A predicate looks at what Docker already
//! knows about a container — its image, labels, name, state, mounts — never at
//! the inside of the container. Nothing here runs a command in the container to
//! decide whether it matches; the only thing that runs a command is an action
//! the user explicitly picked.
//!
//! A module is a Rust type implementing [`Module`], registered in
//! [`registry`]. Nothing about the set of modules is configurable at runtime.

use bollard::models::ContainerSummary;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::OnceLock;

/// One entry in a module's menu.
///
/// The command never leaves the backend: the client asks for a module and an
/// action by id, and the registry decides what that means. A client cannot ask
/// the backend to run an arbitrary command in a container.
#[derive(Clone, Copy, Debug, Serialize)]
pub struct ModuleAction {
    /// Stable id, unique within the module.
    pub id: &'static str,
    /// Text shown in the menu.
    pub label: &'static str,
    /// The command to run in the container.
    pub command: &'static str,
    /// Prompt to show before running, for anything that cannot be undone.
    pub confirm: Option<&'static str>,
    /// Style the entry as destructive.
    pub dangerous: bool,
}

/// The container metadata a predicate may look at.
pub struct DetectCtx<'a> {
    summary: &'a ContainerSummary,
    env: Option<&'a HashMap<String, String>>,
}

// The context is the API module authors write against. Nothing calls it until
// the first module is registered, which is why it looks dead to the compiler.
#[allow(dead_code)]
impl<'a> DetectCtx<'a> {
    pub fn new(summary: &'a ContainerSummary, env: Option<&'a HashMap<String, String>>) -> Self {
        Self { summary, env }
    }

    pub fn id(&self) -> &str {
        self.summary.id.as_deref().unwrap_or_default()
    }

    /// The container's names, without Docker's leading slash.
    pub fn names(&self) -> Vec<String> {
        self.summary
            .names
            .as_ref()
            .map(|n| {
                n.iter()
                    .map(|s| s.trim_start_matches('/').to_string())
                    .collect()
            })
            .unwrap_or_default()
    }

    /// The first name, without Docker's leading slash.
    pub fn name(&self) -> &str {
        self.summary
            .names
            .as_ref()
            .and_then(|n| n.first())
            .map(|s| s.trim_start_matches('/'))
            .unwrap_or_default()
    }

    /// The image reference as recorded when the container was created, e.g.
    /// `mcr.microsoft.com/mssql/server:2022-latest`.
    pub fn image(&self) -> &str {
        self.summary.image.as_deref().unwrap_or_default()
    }

    /// The image's content id.
    pub fn image_id(&self) -> &str {
        self.summary.image_id.as_deref().unwrap_or_default()
    }

    /// The command the container was started with.
    pub fn command(&self) -> &str {
        self.summary.command.as_deref().unwrap_or_default()
    }

    /// Creation time, seconds since the epoch.
    pub fn created(&self) -> i64 {
        self.summary.created.unwrap_or_default()
    }

    pub fn labels(&self) -> &HashMap<String, String> {
        static EMPTY: OnceLock<HashMap<String, String>> = OnceLock::new();
        self.summary
            .labels
            .as_ref()
            .unwrap_or_else(|| EMPTY.get_or_init(HashMap::new))
    }

    pub fn label(&self, key: &str) -> Option<&str> {
        self.labels().get(key).map(|s| s.as_str())
    }

    /// "running", "exited", ...
    pub fn state(&self) -> &str {
        self.summary.state.as_deref().unwrap_or_default()
    }

    /// Docker's human-readable status, e.g. "Up 3 hours (healthy)".
    pub fn status(&self) -> &str {
        self.summary.status.as_deref().unwrap_or_default()
    }

    pub fn is_running(&self) -> bool {
        self.state() == "running"
    }

    /// The container's environment.
    ///
    /// Only present for modules that ask for it: the container list does not
    /// carry the environment, so supplying it costs an inspect per container.
    pub fn env(&self) -> Option<&HashMap<String, String>> {
        self.env
    }

    pub fn env_var(&self, key: &str) -> Option<&str> {
        self.env.and_then(|e| e.get(key)).map(|s| s.as_str())
    }

    /// Host paths the container has bind-mounted.
    pub fn mount_sources(&self) -> Vec<String> {
        self.summary
            .mounts
            .as_ref()
            .map(|m| m.iter().filter_map(|mount| mount.source.clone()).collect())
            .unwrap_or_default()
    }

    /// Does the image or any of the names contain `needle`, case-insensitively?
    ///
    /// A convenience for the common "is this the image I expect" test, which
    /// every module needs and which is easy to get subtly wrong by hand.
    pub fn image_or_name_contains(&self, needle: &str) -> bool {
        let needle = needle.to_lowercase();
        if self.image().to_lowercase().contains(&needle) {
            return true;
        }
        self.names()
            .iter()
            .any(|n| n.to_lowercase().contains(&needle))
    }
}

/// A module recognises a kind of application and offers operations for it.
pub trait Module: Send + Sync {
    /// Stable id, unique across the registry.
    fn id(&self) -> &'static str;

    /// Human-readable name, e.g. "SQL Server".
    fn label(&self) -> &'static str;

    /// Name of a lucide icon, e.g. "database". The frontend maps it to a
    /// component; an unknown name falls back to a generic one.
    fn icon(&self) -> &'static str;

    /// Does the predicate need the container's environment?
    ///
    /// The container list carries labels, image, names, command, state, status,
    /// mounts and ports, but not the environment. A module that needs it says
    /// so, and the detection pass then fetches the environment — one inspect
    /// per container, only when some module asks for it.
    fn needs_env(&self) -> bool {
        false
    }

    /// Does this container match the module?
    fn detect(&self, ctx: &DetectCtx<'_>) -> bool;

    /// The operations offered for a matching container.
    fn actions(&self) -> &'static [ModuleAction];

    /// Priority for selection when multiple modules match. Higher wins.
    fn priority(&self) -> i32 {
        0
    }

    /// If Some, this is a submodule extending the named parent module.
    fn parent_id(&self) -> Option<&'static str> {
        None
    }

    /// Whether this submodule inherits its parent's actions (merged with
    /// overrides/additions from `actions()`). Only meaningful when
    /// `parent_id()` is Some.
    fn inherits_actions(&self) -> bool {
        true
    }
}

/// A module that matched a container, as sent to the client.
///
/// The action commands are deliberately absent: the client shows labels and
/// asks the backend to run an action by id.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DetectedModule {
    pub id: String,
    pub label: String,
    pub icon: String,
    pub actions: Vec<DetectedModuleAction>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DetectedModuleAction {
    pub id: String,
    pub label: String,
    pub confirm: Option<String>,
    pub dangerous: bool,
}

/// The built-in modules.
///
/// Empty for now: the framework is in place, and modules are added here.
/// Ignition module: detects containers running Inductive Automation's Ignition
/// by checking for the IGNITION_INSTALL_LOCATION environment variable.
struct IgnitionModule;

impl Module for IgnitionModule {
    fn id(&self) -> &'static str { "ignition" }
    fn label(&self) -> &'static str { "Ignition" }
    fn icon(&self) -> &'static str { "ignition-standard" }
    fn needs_env(&self) -> bool { true }
    fn detect(&self, ctx: &DetectCtx<'_>) -> bool {
        ctx.env_var("IGNITION_INSTALL_LOCATION").is_some()
    }
    fn actions(&self) -> &'static [ModuleAction] {
        &[ModuleAction {
            id: "reset-password",
            label: "[gwcmd] reset password",
            command: "\"$IGNITION_INSTALL_LOCATION/gwcmd.sh\" -p && \"$IGNITION_INSTALL_LOCATION/gwcmd.sh\" -r",
            confirm: None,
            dangerous: false,
        }]
    }
    fn priority(&self) -> i32 { 0 }
}

struct IgnitionEdgeModule;
impl Module for IgnitionEdgeModule {
    fn id(&self) -> &'static str { "ignition-edge" }
    fn label(&self) -> &'static str { "Ignition Edge" }
    fn icon(&self) -> &'static str { "ignition-edge" }
    fn needs_env(&self) -> bool { true }
    fn detect(&self, ctx: &DetectCtx<'_>) -> bool {
        ctx.env_var("IGNITION_EDITION").map_or(false, |v| v == "edge")
    }
    fn actions(&self) -> &'static [ModuleAction] { &[] }
    fn parent_id(&self) -> Option<&'static str> { Some("ignition") }
    fn priority(&self) -> i32 { 0 }
}

struct IgnitionMakerModule;
impl Module for IgnitionMakerModule {
    fn id(&self) -> &'static str { "ignition-maker" }
    fn label(&self) -> &'static str { "Ignition Maker" }
    fn icon(&self) -> &'static str { "ignition-maker" }
    fn needs_env(&self) -> bool { true }
    fn detect(&self, ctx: &DetectCtx<'_>) -> bool {
        ctx.env_var("IGNITION_EDITION").map_or(false, |v| v == "maker")
    }
    fn actions(&self) -> &'static [ModuleAction] { &[] }
    fn parent_id(&self) -> Option<&'static str> { Some("ignition") }
    fn priority(&self) -> i32 { 0 }
}

struct IgnitionCloudModule;
impl Module for IgnitionCloudModule {
    fn id(&self) -> &'static str { "ignition-cloud" }
    fn label(&self) -> &'static str { "Ignition Cloud" }
    fn icon(&self) -> &'static str { "ignition-cloud" }
    fn needs_env(&self) -> bool { true }
    fn detect(&self, ctx: &DetectCtx<'_>) -> bool {
        ctx.env_var("IGNITION_EDITION").map_or(false, |v| v == "cloud")
    }
    fn actions(&self) -> &'static [ModuleAction] { &[] }
    fn parent_id(&self) -> Option<&'static str> { Some("ignition") }
    fn priority(&self) -> i32 { 0 }
}

fn built_in() -> Vec<Box<dyn Module>> {
    vec![
        Box::new(IgnitionModule),
        Box::new(IgnitionEdgeModule),
        Box::new(IgnitionMakerModule),
        Box::new(IgnitionCloudModule),
    ]
}

/// The module registry.
pub fn registry() -> &'static [Box<dyn Module>] {
    static REGISTRY: OnceLock<Vec<Box<dyn Module>>> = OnceLock::new();
    REGISTRY.get_or_init(built_in)
}

/// Resolve the full action list for a module, handling submodule inheritance.
/// Searches `registry` for the parent when inheritance is requested.
pub fn resolve_actions(module: &dyn Module, registry: &[Box<dyn Module>]) -> Vec<ModuleAction> {
    if let Some(parent_id) = module.parent_id() {
        if module.inherits_actions() {
            if let Some(parent) = registry.iter().find(|m| m.id() == parent_id).map(|m| m.as_ref()) {
                let mut actions: Vec<ModuleAction> = parent.actions().to_vec();
                for sub_action in module.actions() {
                    if let Some(pos) = actions.iter().position(|a| a.id == sub_action.id) {
                        actions[pos] = *sub_action;
                    } else {
                        actions.push(*sub_action);
                    }
                }
                return actions;
            }
        }
    }
    module.actions().to_vec()
}

/// Find a module by id.
pub fn find_module(id: &str) -> Option<&'static dyn Module> {
    registry().iter().find(|m| m.id() == id).map(|m| m.as_ref())
}

/// Does any registered module need the container environment?
pub fn any_module_needs_env() -> bool {
    registry().iter().any(|m| m.needs_env())
}

/// Which modules apply to each container, keyed by container id.
pub fn detect_modules(
    containers: &[ContainerSummary],
    env: &HashMap<String, HashMap<String, String>>,
) -> HashMap<String, Vec<DetectedModule>> {
    detect_with(registry(), containers, env)
}

/// As [`detect_modules`], against a given set of modules.
pub fn detect_with(
    modules: &[Box<dyn Module>],
    containers: &[ContainerSummary],
    env: &HashMap<String, HashMap<String, String>>,
) -> HashMap<String, Vec<DetectedModule>> {
    let mut out: HashMap<String, Vec<DetectedModule>> = HashMap::new();
    for container in containers {
        let id = container.id.clone().unwrap_or_default();
        if id.is_empty() {
            continue;
        }
        let mut matched_base = Vec::new();
        for module in modules {
            let ctx = DetectCtx::new(container, env.get(&id));
            if !module.detect(&ctx) {
                continue;
            }
            if module.parent_id().is_some() {
                continue; // Submodules evaluated only after parent check
            }
            matched_base.push(module.as_ref());
        }

        let parent_ids: std::collections::HashSet<&str> = matched_base
            .iter()
            .map(|m| m.id())
            .collect();

        let mut matched_sub = Vec::new();
        for module in modules {
            let parent = module.parent_id();
            if parent.is_none() {
                continue;
            }
            if !parent_ids.contains(parent.unwrap()) {
                continue; // Only check submodules when parent matched
            }
            let ctx = DetectCtx::new(container, env.get(&id));
            if module.detect(&ctx) {
                matched_sub.push(module.as_ref());
            }
        }

        // Submodules replace their parent when matched; pick by priority.
        let mut matched = Vec::new();
        if !matched_sub.is_empty() {
            matched_sub.sort_by_key(|m| -(m.priority() as i32));
            let best = matched_sub[0];
            matched.push(DetectedModule {
                id: best.id().to_string(),
                label: best.label().to_string(),
                icon: best.icon().to_string(),
                actions: resolve_actions(best, modules)
                    .iter()
                    .map(|a| DetectedModuleAction {
                        id: a.id.to_string(),
                        label: a.label.to_string(),
                        confirm: a.confirm.map(|c| c.to_string()),
                        dangerous: a.dangerous,
                    })
                    .collect(),
            });
        } else if !matched_base.is_empty() {
            matched_base.sort_by_key(|m| -(m.priority() as i32));
            let best = matched_base[0];
            matched.push(DetectedModule {
                id: best.id().to_string(),
                label: best.label().to_string(),
                icon: best.icon().to_string(),
                actions: best
                    .actions()
                    .iter()
                    .map(|a| DetectedModuleAction {
                        id: a.id.to_string(),
                        label: a.label.to_string(),
                        confirm: a.confirm.map(|c| c.to_string()),
                        dangerous: a.dangerous,
                    })
                    .collect(),
            });
        }
        if !matched.is_empty() {
            out.insert(id, matched);
        }
    }
    out
}

/// The environment of a container, as Docker reports it: a list of "KEY=VALUE".
pub fn env_from_inspect(
    insp: &bollard::models::ContainerInspectResponse,
) -> HashMap<String, String> {
    let mut env = HashMap::new();
    if let Some(cfg) = insp.config.as_ref() {
        for entry in cfg.env.as_deref().unwrap_or_default() {
            if let Some((key, value)) = entry.split_once('=') {
                env.insert(key.to_string(), value.to_string());
            }
        }
    }
    env
}

/// The container list, with the modules that apply to each container attached.
///
/// The environment is only fetched when a registered module asks for it: the
/// container list does not carry it, and supplying it costs an inspect per
/// container.
pub async fn containers_with_modules(
    docker: &crate::docker::client::DockerService,
    containers: Vec<ContainerSummary>,
) -> Vec<serde_json::Value> {
    let env = if any_module_needs_env() {
        let mut env = HashMap::new();
        for container in &containers {
            let Some(id) = container.id.as_ref() else {
                continue;
            };
            if let Ok(insp) = docker.inspect_container(id).await {
                env.insert(id.clone(), env_from_inspect(&insp));
            }
        }
        env
    } else {
        HashMap::new()
    };

    let detected = detect_modules(&containers, &env);
    containers
        .into_iter()
        .map(|container| {
            let id = container.id.clone().unwrap_or_default();
            let mut value = serde_json::to_value(&container).unwrap_or(serde_json::Value::Null);
            if let Some(object) = value.as_object_mut() {
                let modules = detected.get(&id).cloned().unwrap_or_default();
                object.insert(
                    "modules".to_string(),
                    serde_json::to_value(modules).unwrap_or_default(),
                );
            }
            value
        })
        .collect()
}

/// Does this container match the module?
///
/// Used to check an action request against the container it names, so a client
/// cannot run a module's command against a container the module does not
/// apply to.
pub async fn container_matches(
    docker: &crate::docker::client::DockerService,
    module: &dyn Module,
    container_id: &str,
) -> bool {
    let Ok(containers) = docker.list_containers(true).await else {
        return false;
    };
    let Some(container) = containers
        .iter()
        .find(|c| c.id.as_deref() == Some(container_id))
    else {
        return false;
    };
    let env = if module.needs_env() {
        docker
            .inspect_container(container_id)
            .await
            .ok()
            .map(|insp| env_from_inspect(&insp))
    } else {
        None
    };
    module.detect(&DetectCtx::new(container, env.as_ref()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use bollard::models::ContainerSummary;

    fn summary(image: &str, labels: &[(&str, &str)]) -> ContainerSummary {
        let mut labels_map = HashMap::new();
        for (k, v) in labels {
            labels_map.insert(k.to_string(), v.to_string());
        }
        ContainerSummary {
            id: Some("abc123".to_string()),
            names: Some(vec!["/mssql-1".to_string()]),
            image: Some(image.to_string()),
            image_id: Some("sha256:deadbeef".to_string()),
            command: Some("sqlservr".to_string()),
            created: Some(1_700_000_000),
            labels: Some(labels_map),
            state: Some("running".to_string()),
            status: Some("Up 3 hours".to_string()),
            ..Default::default()
        }
    }

    struct Fake {
        want_env: bool,
    }

    impl Module for Fake {
        fn id(&self) -> &'static str {
            "fake"
        }
        fn label(&self) -> &'static str {
            "Fake App"
        }
        fn icon(&self) -> &'static str {
            "database"
        }
        fn needs_env(&self) -> bool {
            self.want_env
        }
        fn detect(&self, ctx: &DetectCtx<'_>) -> bool {
            if self.want_env {
                ctx.env_var("FAKE_ENABLED").is_some()
            } else {
                ctx.image_or_name_contains("fake")
            }
        }
        fn actions(&self) -> &'static [ModuleAction] {
            &[]
        }
    }

    /// A module used only by the tests.
    struct TestModule {
        id: &'static str,
        needle: &'static str,
        want_env: bool,
    }

    impl Module for TestModule {
        fn id(&self) -> &'static str {
            self.id
        }
        fn label(&self) -> &'static str {
            "Test Module"
        }
        fn icon(&self) -> &'static str {
            "database"
        }
        fn needs_env(&self) -> bool {
            self.want_env
        }
        fn detect(&self, ctx: &DetectCtx<'_>) -> bool {
            if self.want_env {
                ctx.env_var("APP_ENABLED").is_some()
            } else {
                ctx.image_or_name_contains(self.needle)
            }
        }
        fn actions(&self) -> &'static [ModuleAction] {
            &[ModuleAction {
                id: "run",
                label: "Run it",
                command: "echo hi",
                confirm: Some("Sure?"),
                dangerous: true,
            }]
        }
    }

    fn registry_of(module: TestModule) -> Vec<Box<dyn Module>> {
        vec![Box::new(module)]
    }

    #[test]
    fn detect_matches_only_matching_containers() {
        let containers = vec![
            summary("registry/thing:1", &[]),
            summary("registry/other:1", &[]),
        ];
        let modules = registry_of(TestModule {
            id: "thing",
            needle: "thing",
            want_env: false,
        });
        let detected = detect_with(&modules, &containers, &HashMap::new());
        assert_eq!(detected.len(), 1);
        assert!(detected.contains_key("abc123"));
    }

    #[test]
    fn detected_module_carries_its_actions_without_the_commands() {
        let containers = vec![summary("registry/thing:1", &[])];
        let modules = registry_of(TestModule {
            id: "thing",
            needle: "thing",
            want_env: false,
        });
        let detected = detect_with(&modules, &containers, &HashMap::new());
        let found = &detected["abc123"][0];
        assert_eq!(found.id, "thing");
        assert_eq!(found.label, "Test Module");
        assert_eq!(found.icon, "database");
        assert_eq!(found.actions.len(), 1);
        assert_eq!(found.actions[0].id, "run");
        assert_eq!(found.actions[0].confirm.as_deref(), Some("Sure?"));
        assert!(found.actions[0].dangerous);
        // The command itself must not reach the client.
        let json = serde_json::to_string(found).unwrap();
        assert!(!json.contains("echo hi"));
    }

    #[test]
    fn a_module_that_needs_env_matches_on_it() {
        let containers = vec![summary("registry/thing:1", &[])];
        let modules = registry_of(TestModule {
            id: "thing",
            needle: "",
            want_env: true,
        });
        // Without the environment, no match.
        assert!(detect_with(&modules, &containers, &HashMap::new()).is_empty());
        // With it, a match.
        let mut env = HashMap::new();
        env.insert("abc123".to_string(), HashMap::new());
        let mut one = HashMap::new();
        one.insert("APP_ENABLED".to_string(), "1".to_string());
        env.insert("abc123".to_string(), one);
        assert_eq!(detect_with(&modules, &containers, &env).len(), 1);
    }

    #[test]
    fn an_empty_registry_matches_nothing() {
        let containers = vec![summary("registry/thing:1", &[])];
        assert!(detect_modules(&containers, &HashMap::new()).is_empty());
    }

    #[test]
    fn find_module_locates_a_registered_module() {
        // The shipped registry is empty for now.
        assert!(find_module("anything").is_none());
    }

    #[test]
    fn detection_never_looks_inside_the_container() {
        // The predicate is given metadata only: there is no way for it to run a
        // command, so a module cannot detect a container by probing it.
        let containers = vec![summary("registry/thing:1", &[])];
        let modules = registry_of(TestModule {
            id: "thing",
            needle: "thing",
            want_env: false,
        });
        // The context offers no exec facility at all.
        let ctx = DetectCtx::new(&containers[0], None);
        let ctx_ref = &ctx;
        assert!(ctx_ref.image_or_name_contains("thing"));
        // And the module's command is the only thing that ever runs.
        assert_eq!(
            modules[0].actions()[0].command,
            "echo hi",
            "the only command a module contributes is its action's"
        );
    }

    #[test]
    fn ctx_exposes_container_metadata() {
        let containers = vec![summary(
            "registry/fake:1",
            &[("com.docker.compose.project", "demo")],
        )];
        let ctx = DetectCtx::new(&containers[0], None);
        assert_eq!(ctx.id(), "abc123");
        assert_eq!(ctx.name(), "mssql-1");
        assert_eq!(ctx.image(), "registry/fake:1");
        assert_eq!(ctx.state(), "running");
        assert!(ctx.is_running());
        assert_eq!(ctx.label("com.docker.compose.project"), Some("demo"));
        assert_eq!(ctx.label("missing"), None);
        assert!(ctx.image_or_name_contains("FAKE"));
        assert!(ctx.image_or_name_contains("mssql"));
        assert!(!ctx.image_or_name_contains("postgres"));
        assert!(ctx.env().is_none());
    }

    #[test]
    fn ctx_env_is_populated_when_supplied() {
        let containers = vec![summary("registry/fake:1", &[])];
        let mut env = HashMap::new();
        env.insert("FAKE_ENABLED".to_string(), "1".to_string());
        let ctx = DetectCtx::new(&containers[0], Some(&env));
        assert_eq!(ctx.env_var("FAKE_ENABLED"), Some("1"));
        assert_eq!(ctx.env_var("MISSING"), None);
    }

    #[test]
    fn image_or_name_contains_is_case_insensitive() {
        let containers = vec![summary("MCR.Microsoft.com/MSSQL/Server:2022", &[])];
        let ctx = DetectCtx::new(&containers[0], None);
        assert!(ctx.image_or_name_contains("mssql"));
        assert!(ctx.image_or_name_contains("MSSQL"));
        assert!(!ctx.image_or_name_contains("postgres"));
    }

    /// A submodule test structure.
    struct SubTestModule {
        id: &'static str,
        parent: Option<&'static str>,
        needle: &'static str,
        priority: i32,
        actions_override: &'static [ModuleAction],
        inherit: bool,
    }

    impl Module for SubTestModule {
        fn id(&self) -> &'static str { self.id }
        fn label(&self) -> &'static str { "Sub Test" }
        fn icon(&self) -> &'static str { "sparkles" }
        fn detect(&self, ctx: &DetectCtx<'_>) -> bool {
            ctx.image_or_name_contains(self.needle)
        }
        fn actions(&self) -> &'static [ModuleAction] {
            self.actions_override
        }
        fn priority(&self) -> i32 { self.priority }
        fn parent_id(&self) -> Option<&'static str> { self.parent }
        fn inherits_actions(&self) -> bool { self.inherit }
    }

    #[test]
    fn submodule_replaces_parent_when_matched() {
        let containers = vec![summary("ignition:8.3", &[])];
        let parent = TestModule {
            id: "ignition",
            needle: "ignition",
            want_env: false,
        };
        let sub = SubTestModule {
            id: "ignition-v83",
            parent: Some("ignition"),
            needle: "ignition:8.3",
            priority: 10,
            actions_override: &[ModuleAction {
                id: "upgrade",
                label: "Upgrade",
                command: "upgrade",
                confirm: None,
                dangerous: false,
            }],
            inherit: true,
        };
        let modules: Vec<Box<dyn Module>> = vec![
            Box::new(parent),
            Box::new(sub),
        ];
        let detected = detect_with(&modules, &containers, &HashMap::new());
        assert_eq!(detected.len(), 1);
        let found = &detected["abc123"][0];
        assert_eq!(found.id, "ignition-v83");
        assert_eq!(found.actions.len(), 2); // parent "run" + sub "upgrade"
    }

    #[test]
    fn submodule_priority_selects_highest() {
        let containers = vec![summary("ignition:8.3", &[])];
        let parent = TestModule { id: "ignition", needle: "ignition", want_env: false };
        let sub_low = SubTestModule {
            id: "ignition-v81",
            parent: Some("ignition"),
            needle: "ignition:8.1",
            priority: 1,
            actions_override: &[],
            inherit: false,
        };
        let sub_high = SubTestModule {
            id: "ignition-v83",
            parent: Some("ignition"),
            needle: "ignition:8.3",
            priority: 5,
            actions_override: &[],
            inherit: false,
        };
        let modules: Vec<Box<dyn Module>> = vec![
            Box::new(parent),
            Box::new(sub_low),
            Box::new(sub_high),
        ];
        let detected = detect_with(&modules, &containers, &HashMap::new());
        assert_eq!(detected["abc123"][0].id, "ignition-v83");
    }

    #[test]
    fn base_module_priority_selects_highest() {
        let containers = vec![summary("ignition:8.3", &[])];
        let low_base = SubTestModule {
            id: "low",
            parent: None,
            needle: "low",
            priority: 1,
            actions_override: &[],
            inherit: false,
        };
        let high_sub = SubTestModule {
            id: "high",
            parent: None,
            needle: "ignition",
            priority: 5,
            actions_override: &[],
            inherit: false,
        };
        let modules: Vec<Box<dyn Module>> = vec![Box::new(low_base), Box::new(high_sub)];
        let detected = detect_with(&modules, &containers, &HashMap::new());
        assert!(detected.contains_key("abc123"));
        assert_eq!(detected["abc123"][0].id, "high");
    }

    #[test]
    fn resolve_actions_merges_submodule_override() {
        let parent = TestModule { id: "ignition", needle: "x", want_env: false };
        let sub = SubTestModule {
            id: "ignition-v83",
            parent: Some("ignition"),
            needle: "x",
            priority: 1,
            actions_override: &[ModuleAction {
                id: "run",
                label: "Run v8.3",
                command: "run-v83",
                confirm: None,
                dangerous: false,
            }],
            inherit: true,
        };
        let registry: Vec<Box<dyn Module>> = vec![Box::new(parent)];
        let actions = resolve_actions(&sub, &registry);
        assert!(actions.iter().any(|a| a.id == "run" && a.command == "run-v83"));
        assert!(actions.iter().any(|a| a.id == "run"));
    }
}
