use anyhow::{Context, Result};
use bollard::container::{
    InspectContainerOptions, ListContainersOptions, RemoveContainerOptions,
    RestartContainerOptions, StopContainerOptions,
};
use bollard::image::{CreateImageOptions, ListImagesOptions, RemoveImageOptions};
use bollard::models::{
    ContainerInspectResponse, ContainerSummary, ImageInspect, ImageSummary, Network,
    NetworkCreateResponse, SystemInfo, VolumeListResponse, VolumeUsageData,
};
use bollard::network::{CreateNetworkOptions, InspectNetworkOptions, ListNetworksOptions};
use bollard::Docker;
use futures_util::stream::StreamExt;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;
use tracing::{error, info, warn};

const VOLUME_USAGE_CACHE_TTL: Duration = Duration::from_secs(30);

#[derive(Clone)]
struct CachedVolumeUsage {
    values: HashMap<String, VolumeUsageData>,
    fetched_at: Instant,
}

/// Volume sizes as of the last completed `df`, plus whether a newer one is
/// still being computed.
///
/// Docker's `df` walks every image to attribute shared layers, so it costs
/// seconds and grows with the image count. It used to run inline, which parked
/// the HTTP request for that whole time and made the Volumes page appear to
/// hang on a cold cache. Now it runs detached and callers get whatever is
/// already known straight away.
#[derive(Clone, Debug, Serialize)]
pub struct VolumeUsageSnapshot {
    pub values: HashMap<String, VolumeUsageData>,
    /// A refresh is in flight; `values` may be empty or stale.
    pub pending: bool,
}

#[derive(Clone)]
pub struct DockerService {
    pub client: Arc<Docker>,
    volume_usage_cache: Arc<Mutex<Option<CachedVolumeUsage>>>,
    volume_usage_refreshing: Arc<AtomicBool>,
}

impl DockerService {
    pub fn new(socket_str: &str) -> Result<Self> {
        let client = if socket_str.starts_with("unix://") {
            let path = socket_str.trim_start_matches("unix://");
            Docker::connect_with_unix(path, 120, bollard::API_DEFAULT_VERSION)
                .context("Failed to connect to Docker unix socket")?
        } else if socket_str.starts_with("tcp://") || socket_str.starts_with("http://") {
            Docker::connect_with_http_defaults().context("Failed to connect to Docker HTTP host")?
        } else {
            Docker::connect_with_local_defaults()
                .context("Failed to connect with local Docker defaults")?
        };

        Ok(Self {
            client: Arc::new(client),
            volume_usage_cache: Arc::new(Mutex::new(None)),
            volume_usage_refreshing: Arc::new(AtomicBool::new(false)),
        })
    }

    pub async fn ping(&self) -> bool {
        self.client.ping().await.is_ok()
    }

    pub async fn version(&self) -> Result<bollard::system::Version> {
        let ver = self.client.version().await?;
        Ok(ver)
    }

    pub async fn info(&self) -> Result<SystemInfo> {
        let info = self.client.info().await?;
        Ok(info)
    }

    // Containers
    pub async fn list_containers(&self, all: bool) -> Result<Vec<ContainerSummary>> {
        let options = Some(ListContainersOptions::<String> {
            all,
            ..Default::default()
        });
        let containers = self.client.list_containers(options).await?;
        Ok(containers)
    }

    pub async fn list_containers_for_stack(
        &self,
        stack_name: &str,
    ) -> Result<Vec<ContainerSummary>> {
        let mut filters = HashMap::new();
        filters.insert(
            "label".to_string(),
            vec![format!("com.docker.compose.project={}", stack_name)],
        );
        let options = Some(ListContainersOptions::<String> {
            all: true,
            filters,
            ..Default::default()
        });
        let containers = self.client.list_containers(options).await?;
        Ok(containers)
    }

    pub async fn inspect_container(&self, id: &str) -> Result<ContainerInspectResponse> {
        let resp = self
            .client
            .inspect_container(id, None::<InspectContainerOptions>)
            .await?;
        Ok(resp)
    }

    pub async fn start_container(&self, id: &str) -> Result<()> {
        self.client
            .start_container(
                id,
                None::<bollard::container::StartContainerOptions<String>>,
            )
            .await?;
        Ok(())
    }

    pub async fn stop_container(&self, id: &str) -> Result<()> {
        let options = Some(StopContainerOptions { t: 10 });
        self.client.stop_container(id, options).await?;
        Ok(())
    }

    pub async fn restart_container(&self, id: &str) -> Result<()> {
        let options = Some(RestartContainerOptions { t: 10 });
        self.client.restart_container(id, options).await?;
        Ok(())
    }

    pub async fn pause_container(&self, id: &str) -> Result<()> {
        self.client.pause_container(id).await?;
        Ok(())
    }

    pub async fn unpause_container(&self, id: &str) -> Result<()> {
        self.client.unpause_container(id).await?;
        Ok(())
    }

    pub async fn remove_container(&self, id: &str, force: bool) -> Result<()> {
        let options = Some(RemoveContainerOptions {
            force,
            v: true,
            ..Default::default()
        });
        self.client.remove_container(id, options).await?;
        Ok(())
    }

    // Networks
    pub async fn list_networks(&self) -> Result<Vec<Network>> {
        let networks = self
            .client
            .list_networks(None::<ListNetworksOptions<String>>)
            .await?;
        Ok(networks)
    }

    pub async fn inspect_network(&self, id: &str) -> Result<Network> {
        let net = self
            .client
            .inspect_network(id, None::<InspectNetworkOptions<String>>)
            .await?;
        Ok(net)
    }

    pub async fn create_network(
        &self,
        name: &str,
        driver: Option<&str>,
    ) -> Result<NetworkCreateResponse> {
        let options = CreateNetworkOptions {
            name: name.to_string(),
            check_duplicate: true,
            driver: driver.unwrap_or("bridge").to_string(),
            ..Default::default()
        };
        let resp = self.client.create_network(options).await?;
        Ok(resp)
    }

    pub async fn remove_network(&self, id: &str) -> Result<()> {
        self.client.remove_network(id).await?;
        Ok(())
    }

    // Images
    pub async fn list_images(&self) -> Result<Vec<ImageSummary>> {
        let images = self
            .client
            .list_images(Some(ListImagesOptions::<String> {
                all: true,
                ..Default::default()
            }))
            .await?;
        Ok(images)
    }

    pub async fn inspect_image(&self, id: &str) -> Result<ImageInspect> {
        let img = self.client.inspect_image(id).await?;
        Ok(img)
    }

    pub async fn remove_image(&self, id: &str, force: bool) -> Result<()> {
        let options = Some(RemoveImageOptions {
            force,
            ..Default::default()
        });
        self.client.remove_image(id, options, None).await?;
        Ok(())
    }

    pub async fn volume_usage(&self) -> VolumeUsageSnapshot {
        // Cheap read first: an unexpired cache needs no refresh at all.
        {
            let cache = self.volume_usage_cache.lock().await;
            if let Some(cached) = cache.as_ref() {
                if cached.fetched_at.elapsed() < VOLUME_USAGE_CACHE_TTL {
                    return VolumeUsageSnapshot {
                        values: cached.values.clone(),
                        pending: false,
                    };
                }
            }
        }

        // Stale or missing. Hand back what we have and recompute in the
        // background; the caller re-polls until `pending` clears.
        let known = {
            let cache = self.volume_usage_cache.lock().await;
            cache.as_ref().map(|c| c.values.clone()).unwrap_or_default()
        };

        // Only one refresh at a time. Without this guard, every poll from a
        // connected client would spawn its own multi-second `df`.
        if self.volume_usage_refreshing.swap(true, Ordering::SeqCst) {
            return VolumeUsageSnapshot {
                values: known,
                pending: true,
            };
        }

        let service = self.clone();
        tokio::spawn(async move {
            let refreshed = service.refresh_volume_usage().await;
            // Cleared even on failure so a transient Docker error cannot wedge
            // the endpoint into reporting `pending` forever.
            service
                .volume_usage_refreshing
                .store(false, Ordering::SeqCst);
            if let Err(e) = refreshed {
                warn!(
                    "Failed to refresh Docker disk usage; keeping previous volume sizes: {:?}",
                    e
                );
            }
        });

        VolumeUsageSnapshot {
            values: known,
            pending: true,
        }
    }

    async fn refresh_volume_usage(&self) -> Result<()> {
        let df = self.client.df().await?;
        let values: HashMap<String, VolumeUsageData> = df
            .volumes
            .unwrap_or_default()
            .into_iter()
            .filter_map(|volume| volume.usage_data.map(|usage| (volume.name, usage)))
            .collect();
        *self.volume_usage_cache.lock().await = Some(CachedVolumeUsage {
            values,
            fetched_at: Instant::now(),
        });
        Ok(())
    }

    /// Remove unused images.
    ///
    /// `dangling_only` narrows this to untagged images, which is far safer than
    /// removing every image no container happens to reference: a tagged image
    /// with no running container is usually a stopped stack's image, and a
    /// parent layer pulled in by a build, not garbage.
    pub async fn prune_images(
        &self,
        dangling_only: bool,
    ) -> Result<bollard::models::ImagePruneResponse> {
        // Never rely on the daemon's default when the `dangling` filter is
        // omitted: the two candidate defaults differ across API versions, and
        // the wider one ("all unused images") is destructive here. Always send
        // the filter explicitly so `dangling_only` fully determines the scope.
        let options = Some(bollard::image::PruneImagesOptions::<String> {
            filters: HashMap::from([("dangling".to_string(), vec![dangling_only.to_string()])]),
        });
        self.client.prune_images(options).await.map_err(Into::into)
    }

    pub async fn pull_image(&self, from_image: &str, tag: Option<&str>) -> Result<()> {
        let options = Some(CreateImageOptions {
            from_image: from_image.to_string(),
            tag: tag.unwrap_or("latest").to_string(),
            ..Default::default()
        });

        let mut stream = self.client.create_image(options, None, None);
        while let Some(msg) = stream.next().await {
            match msg {
                Ok(status) => {
                    info!("Pulling image {}: {:?}", from_image, status.status);
                }
                Err(e) => {
                    error!("Error pulling image {}: {:?}", from_image, e);
                    return Err(e.into());
                }
            }
        }
        Ok(())
    }

    // Volumes
    /// The volume list itself is fast. Size accounting comes from Docker's
    /// `/system/df`, which can take seconds on hosts with many images/layers, so
    /// it is exposed and cached separately by `volume_usage`.
    pub async fn list_volumes(&self) -> Result<VolumeListResponse> {
        Ok(self
            .client
            .list_volumes(None::<bollard::volume::ListVolumesOptions<String>>)
            .await?)
    }

    pub async fn prune_volumes(
        &self,
        include_named: bool,
    ) -> Result<bollard::models::VolumePruneResponse> {
        // Docker's default volume prune only considers anonymous volumes.
        // `all=true` additionally includes named volumes.
        let options = include_named.then(|| bollard::volume::PruneVolumesOptions {
            filters: HashMap::from([("all".to_string(), vec!["true".to_string()])]),
        });
        self.client.prune_volumes(options).await.map_err(Into::into)
    }

    pub async fn remove_volume(&self, name: &str, force: bool) -> Result<()> {
        let options = Some(bollard::volume::RemoveVolumeOptions { force });
        self.client.remove_volume(name, options).await?;
        Ok(())
    }
}

#[cfg(test)]
mod usage_tests {
    use super::*;
    use std::path::PathBuf;

    fn service() -> DockerService {
        // `connect_with_unix` checks the socket exists, so point at a throwaway
        // path we create. No IO happens, so no daemon is required: the tests
        // only exercise the cache/refresh bookkeeping.
        static SOCK: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
        let sock = SOCK.get_or_init(|| {
            let path = std::env::temp_dir().join("gisco-usage-test.sock");
            let _ = std::os::unix::net::UnixListener::bind(&path);
            path
        });
        DockerService::new(&format!("unix://{}", sock.display())).expect("construct service")
    }

    #[tokio::test]
    async fn fresh_cache_reports_not_pending() {
        let svc = service();
        // Force the seed through the public path: mark the cache fresh.
        *svc.volume_usage_cache.lock().await = Some(CachedVolumeUsage {
            values: HashMap::from([(
                "v1".to_string(),
                VolumeUsageData {
                    size: 7,
                    ref_count: 1,
                },
            )]),
            fetched_at: Instant::now(),
        });

        let snap = svc.volume_usage().await;
        assert!(!snap.pending, "a fresh cache must not report pending");
        assert_eq!(snap.values.get("v1").map(|v| v.size), Some(7));
        // Nothing should have been spawned, so the guard is untouched.
        assert!(!svc.volume_usage_refreshing.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn cold_cache_returns_immediately_as_pending() {
        let svc = service();
        let started = std::time::Instant::now();
        let snap = svc.volume_usage().await;
        let elapsed = started.elapsed();

        assert!(snap.pending, "a cold cache must report pending");
        assert!(snap.values.is_empty(), "nothing cached yet, so no values");
        assert!(
            elapsed < std::time::Duration::from_millis(500),
            "must not block on df: took {:?}",
            elapsed
        );
    }

    #[tokio::test]
    async fn stale_cache_serves_old_values_and_reports_pending() {
        let svc = service();
        *svc.volume_usage_cache.lock().await = Some(CachedVolumeUsage {
            values: HashMap::from([(
                "v1".to_string(),
                VolumeUsageData {
                    size: 42,
                    ref_count: 0,
                },
            )]),
            // Older than the TTL, so it must be treated as stale.
            fetched_at: Instant::now() - VOLUME_USAGE_CACHE_TTL - Duration::from_secs(1),
        });

        let snap = svc.volume_usage().await;
        assert!(snap.pending);
        assert_eq!(
            snap.values.get("v1").map(|v| v.size),
            Some(42),
            "stale sizes are served rather than blanked"
        );
    }
}
