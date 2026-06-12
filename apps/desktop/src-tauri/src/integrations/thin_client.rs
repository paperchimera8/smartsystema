use std::path::{Path, PathBuf};
use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum ThinClientError {
    #[error("thin client executable path cannot be empty")]
    EmptyPath,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ThinClientExecutable {
    pub path: PathBuf,
}

impl ThinClientExecutable {
    pub fn new(path: impl AsRef<Path>) -> Result<Self, ThinClientError> {
        let path = path.as_ref();

        if path.as_os_str().is_empty() {
            return Err(ThinClientError::EmptyPath);
        }

        Ok(Self {
            path: path.to_path_buf(),
        })
    }
}
