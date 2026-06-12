use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueSummary {
    pub pending_jobs: u32,
    pub failed_jobs: u32,
}

impl QueueSummary {
    pub fn empty() -> Self {
        Self {
            pending_jobs: 0,
            failed_jobs: 0,
        }
    }
}
