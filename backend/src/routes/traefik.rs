use axum::{extract::State, Json};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;

use crate::docker::DockerService;
use crate::routes::AppState;

#[derive(Serialize, Clone, Debug)]
pub struct TraefikRouter {
    pub name: String,
    pub protocol: String,
    pub rule: String,
    pub hosts: Vec<String>,
    pub entrypoints: Vec<String>,
    pub tls: bool,
    pub service: String,
    /// Container name (without leading slash) this router targets, if resolvable.
    pub container: Option<String>,
}

#[derive(Serialize)]
pub struct TraefikResponse {
    pub enabled: bool,
    pub routers: Vec<TraefikRouter>,
}

pub fn routes() -> axum::Router<AppState> {
    axum::Router::new().route("/", axum::routing::get(get_traefik))
}

async fn get_traefik(State(state): State<AppState>) -> Json<TraefikResponse> {
    let (enabled, routers) = fetch_traefik(&state.docker).await;
    Json(TraefikResponse { enabled, routers })
}

async fn fetch_traefik(docker: &DockerService) -> (bool, Vec<TraefikRouter>) {
    // Build a map of container IP -> container name for resolving routers.
    let mut ip_to_container: HashMap<String, String> = HashMap::new();
    if let Ok(containers) = docker.list_containers(true).await {
        for c in &containers {
            let name = c
                .names
                .as_ref()
                .and_then(|n| n.first())
                .cloned()
                .unwrap_or_default()
                .trim_start_matches('/')
                .to_string();
            if let Some(id) = &c.id {
                if let Ok(inspect) = docker.inspect_container(id).await {
                    if let Some(ns) = &inspect.network_settings {
                        if let Some(networks) = &ns.networks {
                            for net in networks.values() {
                                if let Some(ip) = &net.ip_address {
                                    if !ip.is_empty() {
                                        ip_to_container.insert(ip.clone(), name.clone());
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Detect a Traefik container by image name.
    let mut base_urls: Vec<String> = Vec::new();
    if let Ok(containers) = docker.list_containers(true).await {
        for c in &containers {
            let image = c.image.clone().unwrap_or_default().to_lowercase();
            if image.contains("traefik") {
                if let Some(id) = &c.id {
                    if let Ok(inspect) = docker.inspect_container(id).await {
                        if let Some(ns) = &inspect.network_settings {
                            if let Some(networks) = &ns.networks {
                                for net in networks.values() {
                                    if let Some(ip) = &net.ip_address {
                                        if !ip.is_empty() {
                                            base_urls.push(format!("http://{}:8080", ip));
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    base_urls.push("http://127.0.0.1:8080".to_string());
    base_urls.push("http://localhost:8080".to_string());

    for base in &base_urls {
        if let Ok(routers) = fetch_routers(base, &ip_to_container).await {
            if !routers.is_empty() || probe(base).await {
                return (true, routers);
            }
        }
    }
    (false, Vec::new())
}

async fn probe(base: &str) -> bool {
    reqwest::get(format!("{}/api/http/routers", base))
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

async fn fetch_routers(
    base: &str,
    ip_to_container: &HashMap<String, String>,
) -> Result<Vec<TraefikRouter>, ()> {
    // Fetch services to map service name -> container name via server IP.
    let mut service_to_container: HashMap<String, String> = HashMap::new();
    for path in ["/api/http/services", "/api/tcp/services"] {
        let url = format!("{}{}", base, path);
        let resp = match reqwest::get(&url).await {
            Ok(r) if r.status().is_success() => r,
            _ => continue,
        };
        let json: Value = match resp.json().await {
            Ok(j) => j,
            Err(_) => continue,
        };
        let arr = match json.as_array() {
            Some(a) => a,
            None => continue,
        };
        for s in arr {
            let sname_raw = s.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let sname = sname_raw.trim_end_matches("@docker").to_string();
            let servers = s
                .get("loadBalancer")
                .and_then(|lb| lb.get("servers"))
                .or_else(|| s.get("server").and_then(|x| x.get("servers")))
                .and_then(|v| v.as_array());
            if let Some(srvs) = servers {
                for srv in srvs {
                    let url = srv.get("url").and_then(|v| v.as_str()).unwrap_or("");
                    let host = url
                        .trim_start_matches("http://")
                        .trim_start_matches("https://")
                        .split('/')
                        .next()
                        .unwrap_or("")
                        .split(':')
                        .next()
                        .unwrap_or("");
                    if !host.is_empty() {
                        if let Some(cname) = ip_to_container.get(host) {
                            service_to_container.insert(sname.clone(), cname.clone());
                        }
                    }
                }
            }
        }
    }

    let mut out = Vec::new();
    for (path, protocol) in [("/api/http/routers", "http"), ("/api/tcp/routers", "tcp")] {
        let url = format!("{}{}", base, path);
        let resp = match reqwest::get(&url).await {
            Ok(r) if r.status().is_success() => r,
            _ => continue,
        };
        let json: Value = match resp.json().await {
            Ok(j) => j,
            Err(_) => continue,
        };
        let arr = match json.as_array() {
            Some(a) => a,
            None => continue,
        };
        for r in arr {
            let name = r.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let rule = r.get("rule").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let service = r.get("service").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let tls = r.get("tls").map(|v| !v.is_null()).unwrap_or(false);
            let entrypoints: Vec<String> = r
                .get("entryPoints")
                .and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
                .unwrap_or_default();
            let hosts = hosts_from_rule(&rule);
            let container = service_to_container
                .get(service.trim_end_matches("@docker"))
                .cloned();
            out.push(TraefikRouter {
                name,
                protocol: protocol.to_string(),
                rule,
                hosts,
                entrypoints,
                tls,
                service,
                container,
            });
        }
    }
    Ok(out)
}

fn hosts_from_rule(rule: &str) -> Vec<String> {
    let mut hosts = Vec::new();
    let re = regex::Regex::new(r"(?:Host|HostSNI)\(([^)]*)\)").unwrap();
    for cap in re.captures_iter(rule) {
        for part in cap[1].split(',') {
            let host = part.trim().trim_matches(|c| c == '`' || c == '"' || c == '\'');
            if !host.is_empty() && !hosts.contains(&host.to_string()) {
                hosts.push(host.to_string());
            }
        }
    }
    hosts
}