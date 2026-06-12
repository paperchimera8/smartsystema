pub mod epf_runner;
pub mod metadata;
pub mod odata;
pub mod readiness_report;
pub mod thin_client;
pub mod write_package;

#[cfg(windows)]
pub mod windows_com;

use serde::Serialize;

use odata::ODataEndpoint;
use thin_client::ThinClientExecutable;

#[derive(Debug, Clone, Copy, Serialize)]
pub enum IntegrationPath {
    #[serde(rename = "odata")]
    OData,
    #[serde(rename = "epf")]
    ExternalProcessing,
    #[serde(rename = "thin-client")]
    ThinClient,
    #[serde(rename = "windows-com")]
    WindowsCom,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationCapability {
    pub path: IntegrationPath,
    pub available: bool,
    pub reason: Option<String>,
}

pub fn default_capabilities() -> Vec<IntegrationCapability> {
    let odata_available = ODataEndpoint::new("http://localhost").is_ok();
    let thin_client_available = ThinClientExecutable::new("1cv8c.exe").is_ok();

    vec![
        IntegrationCapability {
            path: IntegrationPath::OData,
            available: odata_available,
            reason: Some("HTTP/OData path is available for configuration.".to_owned()),
        },
        IntegrationCapability {
            path: IntegrationPath::ExternalProcessing,
            available: true,
            reason: Some("External processing runner is enabled.".to_owned()),
        },
        IntegrationCapability {
            path: IntegrationPath::ThinClient,
            available: thin_client_available,
            reason: Some("Thin-client runner is enabled.".to_owned()),
        },
        IntegrationCapability {
            path: IntegrationPath::WindowsCom,
            available: cfg!(windows),
            reason: Some(
                if cfg!(windows) {
                    "Windows COM fallback can be configured."
                } else {
                    "COM integration is Windows-only."
                }
                .to_owned(),
            ),
        },
    ]
}
