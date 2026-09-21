use axum::http::StatusCode;
use axum::Json;

/// Build an error response for Docker passthrough failures.
///
/// The daemon's own non-5xx status codes (404 no such container, 304 already
/// started, 409 conflict, ...) pass through instead of becoming generic 500s
/// (which also keeps routine stale-resource races out of the error logs).
/// Anything else stays a 500.
pub fn docker_error(err: anyhow::Error) -> (StatusCode, Json<serde_json::Value>) {
    (
        docker_status(&err),
        Json(serde_json::json!({ "error": err.to_string() })),
    )
}

pub fn docker_status(err: &anyhow::Error) -> StatusCode {
    for cause in err.chain() {
        if let Some(bollard_err) = cause.downcast_ref::<bollard::errors::Error>() {
            if let bollard::errors::Error::DockerResponseServerError { status_code, .. } =
                bollard_err
            {
                if let Ok(status) = StatusCode::from_u16(*status_code) {
                    if status.as_u16() < 500 {
                        return status;
                    }
                }
            }
        }
    }
    StatusCode::INTERNAL_SERVER_ERROR
}

#[cfg(test)]
mod tests {
    use super::*;

    fn daemon_error(code: u16) -> anyhow::Error {
        bollard::errors::Error::DockerResponseServerError {
            status_code: code,
            message: "boom".to_string(),
        }
        .into()
    }

    #[test]
    fn test_docker_status_passthrough() {
        assert_eq!(docker_status(&daemon_error(404)), StatusCode::NOT_FOUND);
        assert_eq!(docker_status(&daemon_error(304)), StatusCode::NOT_MODIFIED);
        assert_eq!(docker_status(&daemon_error(409)), StatusCode::CONFLICT);
    }

    #[test]
    fn test_docker_status_falls_back_to_500() {
        assert_eq!(docker_status(&daemon_error(500)), StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(
            docker_status(&anyhow::anyhow!("plain failure")),
            StatusCode::INTERNAL_SERVER_ERROR
        );
        // Context wrapping must not hide the daemon code.
        let wrapped = daemon_error(404).context("removing container");
        assert_eq!(docker_status(&wrapped), StatusCode::NOT_FOUND);
    }
}
