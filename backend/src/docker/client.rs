use anyhow::{Context, Result};
use bollard::container::{
    InspectContainerOptions, ListContainersOptions, RemoveContainerOptions,
    RestartContainerOptions, StopContainerOptions,
};
use bollard::image::{CreateImageOptions, ListImagesOptions, RemoveImageOptions};
use bollard::models::{
    ContainerInspectResponse, ContainerSummary, ImageInspect, ImageSummary, Network,
    NetworkCreateResponse, SystemInfo, VolumeListResponse,
};
use bollard::network::{CreateNetworkOptions, InspectNetworkOptions, ListNetworksOptions};
use bollard::Docker;
use futures_util::stream::StreamExt;
use std::collections::HashMap;
use std::sync::Arc;
use tracing::{error, info};

#[derive(Clone)]
pub struct DockerService {
    pub client: Arc<Docker>,
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
    pub async fn list_volumes(&self) -> Result<VolumeListResponse> {
        let mut vols = self
            .client
            .list_volumes(None::<bollard::volume::ListVolumesOptions<String>>)
            .await?;

        // `GET /volumes` omits UsageData; backfill sizes from `GET /system/df`.
        // Never fail the listing if df is unavailable.
        match self.client.df().await {
            Ok(df) => {
                let df_volumes = df.volumes.unwrap_or_default();
                let sizes: HashMap<&str, _> = df_volumes
                    .iter()
                    .filter_map(|v| v.usage_data.clone().map(|u| (v.name.as_str(), u)))
                    .collect();
                if let Some(list) = vols.volumes.as_mut() {
                    for vol in list.iter_mut() {
                        if vol.usage_data.is_none() {
                            vol.usage_data = sizes.get(vol.name.as_str()).cloned();
                        }
                    }
                }
            }
            Err(e) => {
                error!("Failed to fetch disk usage for volumes: {:?}", e);
            }
        }

        Ok(vols)
    }

    pub async fn remove_volume(&self, name: &str, force: bool) -> Result<()> {
        let options = Some(bollard::volume::RemoveVolumeOptions { force });
        self.client.remove_volume(name, options).await?;
        Ok(())
    }
}
