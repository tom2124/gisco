use anyhow::Result;
use bollard::container::{MemoryStatsStats, Stats, StatsOptions};
use bollard::Docker;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ContainerMetrics {
    pub container_id: String,
    pub cpu_percent: f64,
    pub memory_usage_bytes: u64,
    pub memory_limit_bytes: u64,
    pub memory_percent: f64,
    pub network_rx_bytes: u64,
    pub network_tx_bytes: u64,
    pub block_read_bytes: u64,
    pub block_write_bytes: u64,
    pub timestamp: String,
}

pub fn calculate_metrics(container_id: &str, stats: &Stats) -> ContainerMetrics {
    // CPU calculation
    let mut cpu_percent: f64 = 0.0;
    let cpu_stats = &stats.cpu_stats;
    let precpu_stats = &stats.precpu_stats;

    let cpu_delta = cpu_stats.cpu_usage.total_usage.saturating_sub(precpu_stats.cpu_usage.total_usage) as f64;
    let system_delta = cpu_stats
        .system_cpu_usage
        .unwrap_or(0)
        .saturating_sub(precpu_stats.system_cpu_usage.unwrap_or(0)) as f64;

    let num_cpus = cpu_stats
        .online_cpus
        .unwrap_or_else(|| {
            cpu_stats
                .cpu_usage
                .percpu_usage
                .as_ref()
                .map(|v: &Vec<u64>| v.len() as u64)
                .unwrap_or(1)
        }) as f64;

    if system_delta > 0.0 && cpu_delta > 0.0 {
        cpu_percent = (cpu_delta / system_delta) * num_cpus * 100.0;
    }

    // Memory calculation
    let mem_stats = &stats.memory_stats;
    let mem_limit = mem_stats.limit.unwrap_or(0);
    let usage = mem_stats.usage.unwrap_or(0);
    // Deduct cache or inactive file if available (cgroups v1 vs v2)
    let cache = mem_stats
        .stats
        .as_ref()
        .and_then(|s| match s {
            MemoryStatsStats::V1(v1) => Some(v1.total_inactive_file),
            MemoryStatsStats::V2(v2) => Some(v2.inactive_file),
        })
        .unwrap_or(0);

    let mem_usage = usage.saturating_sub(cache);
    let mem_percent = if mem_limit > 0 {
        (mem_usage as f64 / mem_limit as f64) * 100.0
    } else {
        0.0
    };

    // Network calculation
    let mut rx_bytes = 0u64;
    let mut tx_bytes = 0u64;
    if let Some(networks) = &stats.networks {
        for (_net_name, net) in networks {
            rx_bytes += net.rx_bytes;
            tx_bytes += net.tx_bytes;
        }
    }

    // Block I/O
    let mut block_read = 0u64;
    let mut block_write = 0u64;
    let blkio = &stats.blkio_stats;
    if let Some(service_bytes) = &blkio.io_service_bytes_recursive {
        for entry in service_bytes {
            match entry.op.as_str() {
                "read" | "Read" => block_read += entry.value,
                "write" | "Write" => block_write += entry.value,
                _ => {}
            }
        }
    }

    ContainerMetrics {
        container_id: container_id.to_string(),
        cpu_percent: (cpu_percent * 100.0_f64).round() / 100.0_f64,
        memory_usage_bytes: mem_usage,
        memory_limit_bytes: mem_limit,
        memory_percent: (mem_percent * 100.0_f64).round() / 100.0_f64,
        network_rx_bytes: rx_bytes,
        network_tx_bytes: tx_bytes,
        block_read_bytes: block_read,
        block_write_bytes: block_write,
        timestamp: stats.read.clone(),
    }
}

pub async fn get_single_stats(docker: &Docker, container_id: &str) -> Result<ContainerMetrics> {
    let options = Some(StatsOptions {
        stream: false,
        one_shot: true,
    });
    let mut stream = docker.stats(container_id, options);
    if let Some(stats_res) = stream.next().await {
        let stats = stats_res?;
        return Ok(calculate_metrics(container_id, &stats));
    }
    anyhow::bail!("No stats returned for container {}", container_id)
}
