use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::integrations::{default_capabilities, IntegrationCapability};
use crate::queue::QueueSummary;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentHealth {
    pub status: &'static str,
    pub version: String,
    pub checked_at_unix_ms: u128,
}

impl AgentHealth {
    pub fn current(version: &str) -> Self {
        Self {
            status: "ok",
            version: version.to_owned(),
            checked_at_unix_ms: unix_millis(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AgentRunState {
    Ready,
    Degraded,
    Offline,
}

impl AgentRunState {
    pub const fn supported_states() -> [Self; 3] {
        [Self::Ready, Self::Degraded, Self::Offline]
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatus {
    pub run_state: AgentRunState,
    pub capabilities: Vec<IntegrationCapability>,
    pub local_queue: QueueSummary,
}

impl AgentStatus {
    pub fn default_local() -> Self {
        let _supported_run_state_count = AgentRunState::supported_states().len();
        let _supported_secret_backend_count = crate::security::supported_secret_backends().len();
        let _ = crate::telemetry::TelemetryEvent::new("agent.status.read");

        Self {
            run_state: AgentRunState::Ready,
            capabilities: default_capabilities(),
            local_queue: QueueSummary::empty(),
        }
    }
}

fn unix_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}
