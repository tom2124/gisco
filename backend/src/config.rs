use std::path::PathBuf;
use tracing::info;

#[derive(Clone, Debug)]
pub struct Config {
    pub port: u16,
    pub stack_dir: PathBuf,
    pub template_dir: PathBuf,
    pub default_uid: u32,
    pub default_gid: u32,
    pub docker_socket: String,
    pub static_dir: Option<PathBuf>,
}

impl Config {
    pub fn from_env() -> Self {
        let port = std::env::var("GISCO_PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(8080);

        let stack_dir = std::env::var("GISCO_STACK_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("./data/stacks"));

        let template_dir = std::env::var("GISCO_TEMPLATE_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("./templates"));

        let default_uid = std::env::var("GISCO_DEFAULT_UID")
            .ok()
            .and_then(|u| u.parse().ok())
            .unwrap_or(1000);

        let default_gid = std::env::var("GISCO_DEFAULT_GID")
            .ok()
            .and_then(|g| g.parse().ok())
            .unwrap_or(1000);

        let docker_socket = std::env::var("DOCKER_HOST")
            .unwrap_or_else(|_| "unix:///var/run/docker.sock".to_string());

        let static_dir = std::env::var("GISCO_STATIC_DIR")
            .map(PathBuf::from)
            .ok()
            .or_else(|| {
                // Check if ./frontend/dist exists
                let dev_path = PathBuf::from("./frontend/dist");
                if dev_path.exists() {
                    Some(dev_path)
                } else {
                    None
                }
            });

        Self {
            port,
            stack_dir,
            template_dir,
            default_uid,
            default_gid,
            docker_socket,
            static_dir,
        }
    }

    pub fn ensure_directories(&self) -> std::io::Result<()> {
        if !self.stack_dir.exists() {
            info!("Creating stack directory at {:?}", self.stack_dir);
            std::fs::create_dir_all(&self.stack_dir)?;
        }
        if !self.template_dir.exists() {
            info!("Creating template directory at {:?}", self.template_dir);
            std::fs::create_dir_all(&self.template_dir)?;
        }
        Ok(())
    }
}
