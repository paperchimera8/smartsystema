#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TelemetryEvent {
    pub name: String,
}

impl TelemetryEvent {
    pub fn new(name: impl Into<String>) -> Result<Self, String> {
        let name = name.into();

        if name.trim().is_empty() {
            return Err("Telemetry event name cannot be empty.".to_owned());
        }

        Ok(Self { name })
    }
}
