mod agent;
mod command_bus;
mod integrations;
mod queue;
mod security;
mod telemetry;

use std::sync::Arc;

use agent::{AgentHealth, AgentStatus};
use command_bus::{CommandBusState, CommandBusStatus};
use integrations::epf_runner::{
    preflight_external_processing as run_external_processing_preflight, EpfPreflightError,
    ExternalProcessingPreflightReport, ExternalProcessingPreflightRequest,
};
use integrations::metadata::{
    scan_metadata as run_metadata_scan, MetadataScanError, MetadataSnapshot, ScanMetadataRequest,
};
use integrations::readiness_report::{
    build_connection_readiness_report as run_connection_readiness_report,
    ConnectionReadinessReport, ConnectionReadinessReportError, ConnectionReadinessReportRequest,
};
use integrations::write_package::{
    plan_write_package as run_write_package_plan, WritePackagePlan, WritePackagePlanError,
    WritePackageRequest,
};
use security::native_auth::{validate_external_auth_url, ExternalAuthOpenError};
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

#[derive(Debug, serde::Serialize, thiserror::Error)]
#[serde(tag = "code", content = "message")]
enum WindowFocusError {
    #[error("The main application window was not found.")]
    MainWindowNotFound,
    #[error("The main application window could not be focused.")]
    FocusFailed,
}

#[tauri::command]
fn health() -> AgentHealth {
    AgentHealth::current(env!("CARGO_PKG_VERSION"))
}

#[tauri::command]
fn get_agent_status() -> AgentStatus {
    AgentStatus::default_local()
}

#[tauri::command]
fn get_command_bus_status(state: tauri::State<'_, Arc<CommandBusState>>) -> CommandBusStatus {
    state.get_status()
}

#[tauri::command]
fn preflight_external_processing(
    request: ExternalProcessingPreflightRequest,
) -> Result<ExternalProcessingPreflightReport, EpfPreflightError> {
    run_external_processing_preflight(request)
}

#[tauri::command]
fn plan_write_package(
    request: WritePackageRequest,
) -> Result<WritePackagePlan, WritePackagePlanError> {
    run_write_package_plan(request)
}

#[tauri::command]
async fn scan_metadata(
    request: ScanMetadataRequest,
) -> Result<MetadataSnapshot, MetadataScanError> {
    run_metadata_scan(request).await
}

#[tauri::command]
fn build_connection_readiness_report(
    request: ConnectionReadinessReportRequest,
) -> Result<ConnectionReadinessReport, ConnectionReadinessReportError> {
    run_connection_readiness_report(request)
}

#[tauri::command]
fn open_external_auth_url(app: tauri::AppHandle, url: String) -> Result<(), ExternalAuthOpenError> {
    validate_external_auth_url(&url)?;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|_| ExternalAuthOpenError::BrowserOpenFailed)
}

#[tauri::command]
fn focus_main_window(app: tauri::AppHandle) -> Result<(), WindowFocusError> {
    let window = app
        .get_webview_window("main")
        .ok_or(WindowFocusError::MainWindowNotFound)?;

    window.show().map_err(|_| WindowFocusError::FocusFailed)?;
    window
        .set_focus()
        .map_err(|_| WindowFocusError::FocusFailed)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let api_base_url = std::env::var("AUTOMATOR_API_BASE_URL")
        .unwrap_or_else(|_| "https://api.smartsystema.online/api".to_string());
    let agent_id =
        std::env::var("AUTOMATOR_AGENT_ID").unwrap_or_else(|_| "desktop-agent-local".to_string());
    let tenant_id =
        std::env::var("AUTOMATOR_TENANT_ID").unwrap_or_else(|_| "tenant-demo".to_string());

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."));
            let db_path = data_dir.join("command_queue.db");
            let db_path_str = db_path.to_string_lossy().to_string();

            let bus_state = Arc::new(CommandBusState::new(&db_path_str));
            app.manage(bus_state.clone());

            let poll_state = bus_state.clone();
            let poll_api = api_base_url.clone();
            let poll_agent = agent_id.clone();
            let poll_tenant = tenant_id.clone();
            tauri::async_runtime::spawn(async move {
                command_bus::start_poll_loop(poll_state, poll_api, poll_agent, poll_tenant).await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            health,
            get_agent_status,
            get_command_bus_status,
            preflight_external_processing,
            plan_write_package,
            scan_metadata,
            build_connection_readiness_report,
            open_external_auth_url,
            focus_main_window
        ])
        .run(tauri::generate_context!())
        .expect("failed to run SmartSistema desktop agent");
}
