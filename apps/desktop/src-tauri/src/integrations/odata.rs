use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum ODataEndpointError {
    #[error("OData base URL cannot be empty")]
    Empty,
    #[error("OData base URL must use http or https")]
    InvalidScheme,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ODataEndpoint {
    pub base_url: String,
}

impl ODataEndpoint {
    pub fn new(base_url: impl Into<String>) -> Result<Self, ODataEndpointError> {
        let base_url = base_url.into();
        let normalized = base_url.trim().trim_end_matches('/').to_owned();

        if normalized.is_empty() {
            return Err(ODataEndpointError::Empty);
        }

        if !(normalized.starts_with("http://") || normalized.starts_with("https://")) {
            return Err(ODataEndpointError::InvalidScheme);
        }

        Ok(Self {
            base_url: normalized,
        })
    }
}
