use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::docker::DockerService;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct NetworkNode {
    pub id: String,
    pub name: String,
    pub driver: String,
    pub scope: String,
    pub internal: bool,
    pub subnet: Option<String>,
    pub gateway: Option<String>,
    pub container_count: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ContainerInterface {
    pub network_id: String,
    pub network_name: String,
    pub ip_address: String,
    pub mac_address: String,
    pub gateway: String,
    pub aliases: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ContainerPortMapping {
    pub container_port: u16,
    pub protocol: String,
    pub host_ip: Option<String>,
    pub host_port: Option<u16>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ContainerNode {
    pub id: String,
    pub name: String,
    pub image: String,
    pub state: String,
    pub stack: Option<String>,
    pub interfaces: Vec<ContainerInterface>,
    pub ports: Vec<ContainerPortMapping>,
    #[serde(default)]
    pub hostname: Option<String>,
    #[serde(default)]
    pub domainname: Option<String>,
    #[serde(default)]
    pub labels: HashMap<String, String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct HostPortNode {
    pub id: String,
    pub host_ip: String,
    pub host_port: u16,
    pub protocol: String,
    pub target_container_id: String,
    pub target_container_port: u16,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct NetworkLink {
    pub source: String,
    pub target: String,
    pub link_type: String, // "interface" or "port_forward"
    pub label: String,
    pub ip: Option<String>,
    pub mac: Option<String>,
    pub port: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct NetworkGraph {
    pub networks: Vec<NetworkNode>,
    pub containers: Vec<ContainerNode>,
    pub host_ports: Vec<HostPortNode>,
    pub links: Vec<NetworkLink>,
}

pub struct NetworkGraphBuilder;

impl NetworkGraphBuilder {
    pub async fn build(docker: &DockerService) -> Result<NetworkGraph> {
        let raw_networks = docker.list_networks().await.unwrap_or_default();
        let raw_containers = docker.list_containers(true).await.unwrap_or_default();

        let mut network_nodes: Vec<NetworkNode> = Vec::new();
        let mut network_map: HashMap<String, String> = HashMap::new(); // Name -> Id
        let mut network_container_counts: HashMap<String, usize> = HashMap::new();

        for net in &raw_networks {
            let id = net.id.clone().unwrap_or_default();
            let name = net.name.clone().unwrap_or_default();
            let driver = net.driver.clone().unwrap_or_else(|| "bridge".to_string());
            let scope = net.scope.clone().unwrap_or_else(|| "local".to_string());
            let internal = net.internal.unwrap_or(false);

            let mut subnet = None;
            let mut gateway = None;
            if let Some(ipam) = &net.ipam {
                if let Some(configs) = &ipam.config {
                    if let Some(first) = configs.first() {
                        subnet = first.subnet.clone();
                        gateway = first.gateway.clone();
                    }
                }
            }

            network_map.insert(name.clone(), id.clone());

            network_nodes.push(NetworkNode {
                id: id.clone(),
                name,
                driver,
                scope,
                internal,
                subnet,
                gateway,
                container_count: 0,
            });
        }

        let mut container_nodes: Vec<ContainerNode> = Vec::new();
        let mut host_port_nodes: Vec<HostPortNode> = Vec::new();
        let mut links: Vec<NetworkLink> = Vec::new();

        // Hostname/domainname only come from inspect; fetch concurrently so
        // large hosts don't pay N sequential round-trips. Failures map to None.
        let inspects = futures_util::future::join_all(raw_containers.iter().map(|c| {
            let id = c.id.clone().unwrap_or_default();
            let docker = docker.clone();
            async move {
                let info = docker
                    .inspect_container(&id)
                    .await
                    .ok()
                    .and_then(|insp| insp.config)
                    .map(|cfg| (cfg.hostname, cfg.domainname));
                (id, info)
            }
        }))
        .await;
        let host_info: HashMap<String, (Option<String>, Option<String>)> = inspects
            .into_iter()
            .filter_map(|(id, info)| info.map(|i| (id, i)))
            .collect();

        for c in &raw_containers {
            let id = c.id.clone().unwrap_or_default();
            let name = c
                .names
                .as_ref()
                .and_then(|names| names.first())
                .map(|n| n.trim_start_matches('/').to_string())
                .unwrap_or_else(|| id[..12.min(id.len())].to_string());

            let image = c.image.clone().unwrap_or_default();
            let state = c.state.clone().unwrap_or_default();
            let stack = c
                .labels
                .as_ref()
                .and_then(|l| l.get("com.docker.compose.project").cloned());

            let mut interfaces = Vec::new();
            if let Some(settings) = &c.network_settings {
                if let Some(nets) = &settings.networks {
                    for (net_name, endpoint) in nets {
                        let net_id = endpoint
                            .network_id
                            .clone()
                            .or_else(|| network_map.get(net_name).cloned())
                            .unwrap_or_else(|| net_name.clone());

                        let ip = endpoint.ip_address.clone().unwrap_or_default();
                        let mac = endpoint.mac_address.clone().unwrap_or_default();
                        let gw = endpoint.gateway.clone().unwrap_or_default();
                        let aliases = endpoint.aliases.clone().unwrap_or_default();

                        if !ip.is_empty() || !net_id.is_empty() {
                            *network_container_counts.entry(net_id.clone()).or_default() += 1;

                            interfaces.push(ContainerInterface {
                                network_id: net_id.clone(),
                                network_name: net_name.clone(),
                                ip_address: ip.clone(),
                                mac_address: mac.clone(),
                                gateway: gw,
                                aliases,
                            });

                            // Create link from container to network bus
                            links.push(NetworkLink {
                                source: id.clone(),
                                target: net_id,
                                link_type: "interface".to_string(),
                                label: format!("veth ({})", if ip.is_empty() { "host" } else { &ip }),
                                ip: if ip.is_empty() { None } else { Some(ip) },
                                mac: if mac.is_empty() { None } else { Some(mac) },
                                port: None,
                            });
                        }
                    }
                }
            }

            let mut ports = Vec::new();
            if let Some(raw_ports) = &c.ports {
                for p in raw_ports {
                    let private_port = p.private_port;
                    let proto = p.typ.as_ref().map(|t| t.to_string()).unwrap_or_else(|| "tcp".to_string());
                    let host_ip = p.ip.clone();
                    let host_port = p.public_port;

                    ports.push(ContainerPortMapping {
                        container_port: private_port,
                        protocol: proto.clone(),
                        host_ip: host_ip.clone(),
                        host_port,
                    });

                    if let Some(hp) = host_port {
                        let hip = host_ip.unwrap_or_else(|| "0.0.0.0".to_string());
                        let port_node_id = format!("host_port_{}_{}_{}", hip, hp, proto);

                        host_port_nodes.push(HostPortNode {
                            id: port_node_id.clone(),
                            host_ip: hip.clone(),
                            host_port: hp,
                            protocol: proto.clone(),
                            target_container_id: id.clone(),
                            target_container_port: private_port,
                        });

                        // Link from Host Port to Container
                        links.push(NetworkLink {
                            source: port_node_id,
                            target: id.clone(),
                            link_type: "port_forward".to_string(),
                            label: format!("{}:{} -> {}/{}", hip, hp, private_port, proto),
                            ip: None,
                            mac: None,
                            port: Some(format!("{}/{}", private_port, proto)),
                        });
                    }
                }
            }

            let labels = c.labels.clone().unwrap_or_default();
            let (hostname, domainname) = host_info
                .get(&id)
                .cloned()
                .unwrap_or((None, None));

            container_nodes.push(ContainerNode {
                id,
                name,
                image,
                state,
                stack,
                interfaces,
                ports,
                hostname,
                domainname,
                labels,
            });
        }

        // Update container counts on network nodes
        for n in &mut network_nodes {
            if let Some(count) = network_container_counts.get(&n.id) {
                n.container_count = *count;
            }
        }

        Ok(NetworkGraph {
            networks: network_nodes,
            containers: container_nodes,
            host_ports: host_port_nodes,
            links,
        })
    }
}
