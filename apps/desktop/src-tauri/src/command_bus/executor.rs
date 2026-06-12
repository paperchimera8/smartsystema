use serde_json::Value;
use tracing::{info, warn};

#[derive(Debug, Clone)]
pub struct ExecutionResult {
    pub status: &'static str,
    pub selected_strategy: Option<String>,
    pub external_reference: Option<String>,
    pub normalized_errors: Vec<String>,
    pub retryable: bool,
}

pub fn execute(command_type: &str, payload: &Value) -> ExecutionResult {
    match command_type {
        "WriteDocument" => execute_write_document(payload),
        "CreateDraftIn1C" => execute_create_draft_in_1c(payload),
        "ExportPackage" => execute_export_package(payload),
        "ScanMetadata" => execute_scan_metadata(payload),
        "RefreshCapabilities" => execute_refresh_capabilities(payload),
        "TestConnection" => execute_test_connection(payload),
        "ValidateOneCObject" => execute_validate_object(payload),
        "RunExternalProcessing" => execute_external_processing(payload),
        "CollectDiagnostics" => execute_collect_diagnostics(payload),
        unknown => {
            warn!(command_type = %unknown, "Unknown command type received");
            ExecutionResult {
                status: "failed_terminal",
                selected_strategy: None,
                external_reference: None,
                normalized_errors: vec![format!("Unknown command type: {}", unknown)],
                retryable: false,
            }
        }
    }
}

fn execute_write_document(payload: &Value) -> ExecutionResult {
    let draft_id = payload
        .get("draftId")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    info!(draft_id = %draft_id, "WriteDocument: stub execution");
    ExecutionResult {
        status: "succeeded",
        selected_strategy: Some("local-json-export".to_string()),
        external_reference: Some(format!("stub-ref-{draft_id}")),
        normalized_errors: vec![],
        retryable: false,
    }
}

fn execute_create_draft_in_1c(payload: &Value) -> ExecutionResult {
    let draft_id = payload
        .get("draftId")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    info!(draft_id = %draft_id, "CreateDraftIn1C: stub execution");
    ExecutionResult {
        status: "succeeded",
        selected_strategy: Some("odata".to_string()),
        external_reference: None,
        normalized_errors: vec![],
        retryable: false,
    }
}

fn execute_export_package(_payload: &Value) -> ExecutionResult {
    info!("ExportPackage: stub execution");
    ExecutionResult {
        status: "succeeded",
        selected_strategy: Some("local-json-export".to_string()),
        external_reference: None,
        normalized_errors: vec![],
        retryable: false,
    }
}

fn execute_scan_metadata(_payload: &Value) -> ExecutionResult {
    info!("ScanMetadata: stub execution");
    ExecutionResult {
        status: "succeeded",
        selected_strategy: Some("odata-metadata".to_string()),
        external_reference: None,
        normalized_errors: vec![],
        retryable: false,
    }
}

fn execute_refresh_capabilities(_payload: &Value) -> ExecutionResult {
    info!("RefreshCapabilities: stub execution");
    ExecutionResult {
        status: "succeeded",
        selected_strategy: None,
        external_reference: None,
        normalized_errors: vec![],
        retryable: false,
    }
}

fn execute_test_connection(_payload: &Value) -> ExecutionResult {
    info!("TestConnection: stub execution");
    ExecutionResult {
        status: "succeeded",
        selected_strategy: None,
        external_reference: None,
        normalized_errors: vec![],
        retryable: false,
    }
}

fn execute_validate_object(_payload: &Value) -> ExecutionResult {
    info!("ValidateOneCObject: stub execution");
    ExecutionResult {
        status: "succeeded",
        selected_strategy: None,
        external_reference: None,
        normalized_errors: vec![],
        retryable: false,
    }
}

fn execute_external_processing(_payload: &Value) -> ExecutionResult {
    info!("RunExternalProcessing: stub execution");
    ExecutionResult {
        status: "succeeded",
        selected_strategy: Some("epf".to_string()),
        external_reference: None,
        normalized_errors: vec![],
        retryable: false,
    }
}

fn execute_collect_diagnostics(_payload: &Value) -> ExecutionResult {
    info!("CollectDiagnostics: stub execution");
    ExecutionResult {
        status: "succeeded",
        selected_strategy: None,
        external_reference: None,
        normalized_errors: vec![],
        retryable: false,
    }
}
