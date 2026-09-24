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

    let cpu_delta = cpu_stats
        .cpu_usage
        .total_usage
        .saturating_sub(precpu_stats.cpu_usage.total_usage) as f64;
    let system_delta = cpu_stats
        .system_cpu_usage
        .unwrap_or(0)
        .saturating_sub(precpu_stats.system_cpu_usage.unwrap_or(0)) as f64;

    let num_cpus = cpu_stats.online_cpus.unwrap_or_else(|| {
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
        .map(|s| match s {
            MemoryStatsStats::V1(v1) => v1.total_inactive_file,
            MemoryStatsStats::V2(v2) => v2.inactive_file,
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
        for net in networks.values() {
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Real `GET /containers/{id}/stats?one-shot=true` payload; per-test
    /// mutations below only touch the fields under examination.
    fn fixture() -> serde_json::Value {
        let raw = include_str!("../../tests/fixtures/container-stats.json");
        serde_json::from_str(raw).unwrap()
    }

    fn stats_from(json: serde_json::Value) -> Stats {
        serde_json::from_value(json).unwrap()
    }

    #[test]
    fn test_cpu_percent_from_deltas() {
        // 2 CPUs, container used 100 of 1000 system ticks -> 20%.
        let mut v = fixture();
        v["cpu_stats"]["cpu_usage"]["total_usage"] = serde_json::json!(200);
        v["cpu_stats"]["system_cpu_usage"] = serde_json::json!(2000);
        v["cpu_stats"]["online_cpus"] = serde_json::json!(2);
        v["precpu_stats"]["cpu_usage"]["total_usage"] = serde_json::json!(100);
        v["precpu_stats"]["system_cpu_usage"] = serde_json::json!(1000);
        let m = calculate_metrics("c1", &stats_from(v));
        assert_eq!(m.cpu_percent, 20.0);
    }

    #[test]
    fn test_cpu_percent_zero_without_deltas() {
        let mut v = fixture();
        v["cpu_stats"]["cpu_usage"]["total_usage"] = serde_json::json!(0);
        v["precpu_stats"]["cpu_usage"]["total_usage"] = serde_json::json!(0);
        v["cpu_stats"]["system_cpu_usage"] = serde_json::json!(0);
        v["precpu_stats"]["system_cpu_usage"] = serde_json::json!(0);
        let m = calculate_metrics("c1", &stats_from(v));
        assert_eq!(m.cpu_percent, 0.0);
    }

    #[test]
    fn test_memory_deducts_cache() {
        // Fixture host uses cgroups v1 or v2; whichever key exists, the
        // inactive-file amount must be deducted from usage.
        let mut v = fixture();
        v["memory_stats"]["usage"] = serde_json::json!(1000);
        v["memory_stats"]["limit"] = serde_json::json!(2000);
        let stats = stats_from(v);
        let cache = stats
            .memory_stats
            .stats
            .as_ref()
            .map(|s| match s {
                MemoryStatsStats::V1(v1) => v1.total_inactive_file,
                MemoryStatsStats::V2(v2) => v2.inactive_file,
            })
            .unwrap_or(0);
        let m = calculate_metrics("c1", &stats);
        assert_eq!(m.memory_usage_bytes, 1000u64.saturating_sub(cache));
        assert!(m.memory_percent >= 0.0 && m.memory_percent <= 100.0);
    }

    #[test]
    fn test_network_sums_across_interfaces() {
        let mut v = fixture();
        // Replace every interface's counters, then expect the exact totals.
        if let Some(networks) = v.get_mut("networks").and_then(|n| n.as_object_mut()) {
            let mut rx = 0u64;
            let mut tx = 0u64;
            for (i, (_name, net)) in networks.iter_mut().enumerate() {
                let r = 100u64 + i as u64;
                let t = 1000u64 + i as u64;
                net["rx_bytes"] = serde_json::json!(r);
                net["tx_bytes"] = serde_json::json!(t);
                rx += r;
                tx += t;
            }
            let m = calculate_metrics("c1", &stats_from(v));
            assert_eq!(m.network_rx_bytes, rx);
            assert_eq!(m.network_tx_bytes, tx);
        } else {
            panic!("fixture has no networks object");
        }
    }

    #[test]
    fn test_blkio_aggregates_read_write_case_insensitive() {
        let mut full = fixture();
        full["blkio_stats"]["io_service_bytes_recursive"] = serde_json::json!([
            { "op": "read", "value": 10, "major": 8, "minor": 0 },
            { "op": "Read", "value": 5, "major": 8, "minor": 0 },
            { "op": "write", "value": 7, "major": 8, "minor": 0 },
            { "op": "Total", "value": 999, "major": 8, "minor": 0 }
        ]);
        let m = calculate_metrics("c1", &stats_from(full));
        assert_eq!(m.block_read_bytes, 15);
        assert_eq!(m.block_write_bytes, 7);
    }
}
