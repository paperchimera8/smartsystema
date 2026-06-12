pub mod executor;
pub mod queue;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::{
    atomic::{AtomicBool, AtomicU32, Ordering},
    Arc, Mutex,
};
use tokio::time::{sleep, Duration};
use tracing::{error, info, warn};

use queue::LocalQueue;

const POLL_INTERVAL_SECS: u64 = 10;
const HEARTBEAT_INTERVAL_SECS: u64 = 30;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandBusStatus {
    pub pending_count: u32,
    pub last_heartbeat_at: Option<String>,
    pub run_state: String,
    pub api_reachable: bool,
}

pub struct CommandBusState {
    pub pending_count: AtomicU32,
    pub api_reachable: AtomicBool,
    pub last_heartbeat_at: Mutex<Option<String>>,
    pub run_state: Mutex<String>,
    pub queue: Mutex<LocalQueue>,
}

impl CommandBusState {
    pub fn new(db_path: &str) -> Self {
        let queue = LocalQueue::open(db_path).unwrap_or_else(|e| {
            warn!(error = %e, "Failed to open SQLite queue at path, using in-memory fallback");
            LocalQueue::open_in_memory().expect("in-memory SQLite must work")
        });

        Self {
            pending_count: AtomicU32::new(0),
            api_reachable: AtomicBool::new(false),
            last_heartbeat_at: Mutex::new(None),
            run_state: Mutex::new("ready".to_string()),
            queue: Mutex::new(queue),
        }
    }

    pub fn get_status(&self) -> CommandBusStatus {
        let pending_count = self.pending_count.load(Ordering::Relaxed);
        let api_reachable = self.api_reachable.load(Ordering::Relaxed);
        let last_heartbeat_at = self.last_heartbeat_at.lock().ok().and_then(|g| g.clone());
        let run_state = self
            .run_state
            .lock()
            .ok()
            .map(|g| g.clone())
            .unwrap_or_else(|| "ready".to_string());

        CommandBusStatus {
            pending_count,
            last_heartbeat_at,
            run_state,
            api_reachable,
        }
    }

    fn refresh_pending_count(&self) {
        if let Ok(q) = self.queue.lock() {
            let count = q.pending_count();
            self.pending_count.store(count, Ordering::Relaxed);
        }
    }
}

// --- HTTP payload types (mirrors API contracts) ---

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HeartbeatRequest<'a> {
    agent_id: &'a str,
    tenant_id: &'a str,
    run_state: &'a str,
    capabilities: Vec<&'static str>,
    schema_snapshot_id: Option<&'a str>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HeartbeatResponse {
    acknowledged_at: String,
    pending_command_count: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PendingCommandsResponse {
    commands: Vec<PendingCommand>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PendingCommand {
    command_id: String,
    command_type: String,
    idempotency_key: String,
    payload: Value,
    deadline_at: String,
    correlation_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CommandResultRequest<'a> {
    command_id: &'a str,
    tenant_id: &'a str,
    agent_id: &'a str,
    status: &'a str,
    started_at: &'a str,
    finished_at: &'a str,
    selected_strategy: Option<String>,
    external_reference: Option<String>,
    normalized_errors: Vec<String>,
    retryable: bool,
    correlation_id: &'a str,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredCommandResult {
    status: String,
    selected_strategy: Option<String>,
    external_reference: Option<String>,
    normalized_errors: Vec<String>,
    retryable: bool,
}

// --- Background loop ---

pub async fn start_poll_loop(
    state: Arc<CommandBusState>,
    api_base_url: String,
    agent_id: String,
    tenant_id: String,
) {
    let api_base_url = normalize_api_base_url(&api_base_url);
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
    {
        Ok(client) => client,
        Err(e) => {
            state.api_reachable.store(false, Ordering::Relaxed);
            if let Ok(mut g) = state.run_state.lock() {
                *g = "error".to_string();
            }
            error!(error = %e, "Failed to build HTTP client for command bus");
            return;
        }
    };

    let mut last_heartbeat = std::time::Instant::now();

    loop {
        let now_str = chrono_now();

        // Heartbeat (every 30s)
        if last_heartbeat.elapsed().as_secs() >= HEARTBEAT_INTERVAL_SECS {
            let hb_result = send_heartbeat(&client, &api_base_url, &agent_id, &tenant_id).await;
            match hb_result {
                Ok(resp) => {
                    state.api_reachable.store(true, Ordering::Relaxed);
                    if let Ok(mut g) = state.last_heartbeat_at.lock() {
                        *g = Some(resp.acknowledged_at.clone());
                    }
                    info!(
                        pending = resp.pending_command_count,
                        "Heartbeat acknowledged"
                    );
                }
                Err(e) => {
                    state.api_reachable.store(false, Ordering::Relaxed);
                    warn!(error = %e, "Heartbeat failed");
                }
            }
            last_heartbeat = std::time::Instant::now();
        }

        // Poll pending commands
        let poll_result = poll_commands(&client, &api_base_url, &agent_id, &tenant_id).await;
        match poll_result {
            Ok(commands) => {
                state.api_reachable.store(true, Ordering::Relaxed);
                for cmd in &commands {
                    enqueue_command(&state, cmd, &now_str);
                }
                if !commands.is_empty() {
                    info!(count = commands.len(), "Received commands from API");
                    process_queue(&state, &client, &api_base_url, &agent_id, &tenant_id).await;
                }
            }
            Err(e) => {
                state.api_reachable.store(false, Ordering::Relaxed);
                warn!(error = %e, "Command poll failed");
            }
        }

        state.refresh_pending_count();
        sleep(Duration::from_secs(POLL_INTERVAL_SECS)).await;
    }
}

async fn send_heartbeat(
    client: &reqwest::Client,
    api_base_url: &str,
    agent_id: &str,
    tenant_id: &str,
) -> Result<HeartbeatResponse, String> {
    let url = format!("{api_base_url}/agents/heartbeat");
    let body = HeartbeatRequest {
        agent_id,
        tenant_id,
        run_state: "ready",
        capabilities: vec!["odata", "epf", "thin-client"],
        schema_snapshot_id: None,
    };

    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("heartbeat HTTP {}", resp.status()));
    }

    resp.json::<HeartbeatResponse>()
        .await
        .map_err(|e| e.to_string())
}

async fn poll_commands(
    client: &reqwest::Client,
    api_base_url: &str,
    agent_id: &str,
    tenant_id: &str,
) -> Result<Vec<PendingCommand>, String> {
    let url =
        format!("{api_base_url}/agents/commands/pending?tenantId={tenant_id}&agentId={agent_id}");

    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("poll HTTP {}", resp.status()));
    }

    let body: PendingCommandsResponse = resp.json().await.map_err(|e| e.to_string())?;
    Ok(body.commands)
}

fn enqueue_command(state: &CommandBusState, cmd: &PendingCommand, now_str: &str) {
    let Ok(q) = state.queue.lock() else { return };

    if q.exists(&cmd.idempotency_key) {
        return;
    }

    let local = queue::LocalCommand {
        command_id: cmd.command_id.clone(),
        idempotency_key: cmd.idempotency_key.clone(),
        command_type: cmd.command_type.clone(),
        correlation_id: cmd.correlation_id.clone(),
        payload: cmd.payload.to_string(),
        status: "delivered".to_string(),
        attempt_count: 0,
        next_attempt_at: now_str.to_string(),
        deadline_at: cmd.deadline_at.clone(),
        last_error: None,
        pending_result: None,
        created_at: now_str.to_string(),
        updated_at: now_str.to_string(),
    };

    if let Err(e) = q.upsert(&local) {
        error!(error = %e, command_id = %cmd.command_id, "Failed to enqueue command locally");
    }
}

async fn process_queue(
    state: &Arc<CommandBusState>,
    client: &reqwest::Client,
    api_base_url: &str,
    agent_id: &str,
    tenant_id: &str,
) {
    let pending = {
        let Ok(q) = state.queue.lock() else { return };
        match q.list_pending() {
            Ok(pending) => pending,
            Err(e) => {
                error!(error = %e, "Failed to list pending local commands");
                return;
            }
        }
    };

    for cmd in pending {
        let started_at = chrono_now();
        let stored_result = if let Some(raw) = cmd.pending_result.as_deref() {
            match serde_json::from_str::<StoredCommandResult>(raw) {
                Ok(result) => result,
                Err(e) => {
                    warn!(
                        error = %e,
                        command_id = %cmd.command_id,
                        "Stored command result is corrupted; failing command closed"
                    );

                    let recovered = StoredCommandResult {
                        status: "failed_terminal".to_string(),
                        selected_strategy: None,
                        external_reference: None,
                        normalized_errors: vec![
                            "Stored command result is corrupted.".to_string(),
                            format!("JSON parse error: {e}"),
                        ],
                        retryable: false,
                    };

                    if let Ok(serialized) = serde_json::to_string(&recovered) {
                        let Ok(q) = state.queue.lock() else { continue };
                        let _ = q.store_pending_result(
                            &cmd.command_id,
                            &recovered.status,
                            &serialized,
                            &started_at,
                        );
                    }

                    recovered
                }
            }
        } else {
            match serde_json::from_str::<Value>(&cmd.payload) {
                Ok(payload) => {
                    let result = executor::execute(&cmd.command_type, &payload);
                    let stored = StoredCommandResult {
                        status: result.status.to_string(),
                        selected_strategy: result.selected_strategy,
                        external_reference: result.external_reference,
                        normalized_errors: result.normalized_errors,
                        retryable: result.retryable,
                    };

                    let serialized = match serde_json::to_string(&stored) {
                        Ok(value) => value,
                        Err(e) => {
                            warn!(
                                error = %e,
                                command_id = %cmd.command_id,
                                "Failed to serialize command result"
                            );
                            continue;
                        }
                    };

                    {
                        let Ok(q) = state.queue.lock() else { continue };
                        let _ = q.store_pending_result(
                            &cmd.command_id,
                            &stored.status,
                            &serialized,
                            &started_at,
                        );
                    }

                    stored
                }
                Err(e) => {
                    warn!(
                        error = %e,
                        command_id = %cmd.command_id,
                        "Command payload is not valid JSON; failing command closed"
                    );

                    let recovered = StoredCommandResult {
                        status: "failed_terminal".to_string(),
                        selected_strategy: None,
                        external_reference: None,
                        normalized_errors: vec![
                            "Command payload is not valid JSON.".to_string(),
                            format!("JSON parse error: {e}"),
                        ],
                        retryable: false,
                    };

                    if let Ok(serialized) = serde_json::to_string(&recovered) {
                        let Ok(q) = state.queue.lock() else { continue };
                        let _ = q.store_pending_result(
                            &cmd.command_id,
                            &recovered.status,
                            &serialized,
                            &started_at,
                        );
                    }

                    recovered
                }
            }
        };
        let finished_at = chrono_now();

        let submission = submit_result(
            client,
            api_base_url,
            &cmd.command_id,
            agent_id,
            tenant_id,
            &stored_result.status,
            &started_at,
            &finished_at,
            stored_result.selected_strategy.clone(),
            stored_result.external_reference.clone(),
            stored_result.normalized_errors.clone(),
            stored_result.retryable,
            &cmd.correlation_id,
        )
        .await;

        if let Err(e) = submission {
            let Ok(q) = state.queue.lock() else { continue };
            let _ = q.mark_submission_failed(&cmd.command_id, &e, &finished_at, &finished_at);
            warn!(error = %e, command_id = %cmd.command_id, "Failed to submit command result");
        } else {
            let Ok(q) = state.queue.lock() else { continue };
            let _ = q.mark_result_submitted(&cmd.command_id, &stored_result.status, &finished_at);
            info!(command_id = %cmd.command_id, status = %stored_result.status, "Command result submitted");
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn submit_result(
    client: &reqwest::Client,
    api_base_url: &str,
    command_id: &str,
    agent_id: &str,
    tenant_id: &str,
    status: &str,
    started_at: &str,
    finished_at: &str,
    selected_strategy: Option<String>,
    external_reference: Option<String>,
    normalized_errors: Vec<String>,
    retryable: bool,
    correlation_id: &str,
) -> Result<(), String> {
    let url = format!("{api_base_url}/agents/commands/{command_id}/result");
    let body = CommandResultRequest {
        command_id,
        tenant_id,
        agent_id,
        status,
        started_at,
        finished_at,
        selected_strategy,
        external_reference,
        normalized_errors,
        retryable,
        correlation_id,
    };

    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("result submit HTTP {}", resp.status()));
    }

    Ok(())
}

fn chrono_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    // Simple ISO-ish string — good enough for logging and storage
    format!("{ms}")
}

pub fn normalize_api_base_url(raw: &str) -> String {
    let trimmed = raw.trim().trim_end_matches('/');

    if let Ok(mut url) = url::Url::parse(trimmed) {
        if url.path().is_empty() || url.path() == "/" {
            url.set_path("/api");
        } else {
            let normalized_path = url.path().trim_end_matches('/').to_string();
            url.set_path(&normalized_path);
        }

        return url.as_str().trim_end_matches('/').to_string();
    }

    trimmed.to_string()
}

#[cfg(test)]
mod tests {
    use super::normalize_api_base_url;

    #[test]
    fn normalizes_api_base_url_to_backend_api_prefix() {
        assert_eq!(
            normalize_api_base_url("http://127.0.0.1:8080"),
            "http://127.0.0.1:8080/api"
        );
        assert_eq!(
            normalize_api_base_url("http://127.0.0.1:8080/api/"),
            "http://127.0.0.1:8080/api"
        );
    }
}
