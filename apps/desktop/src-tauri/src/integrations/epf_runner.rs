use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use thiserror::Error;

const EXPECTED_EXECUTABLE_NAMES: [&str; 2] = ["1cv8.exe", "1cv8c.exe"];
/// Maximum EPF file size accepted for SHA-256 hashing. Prevents CPU-stall on
/// accidentally provided virtual-disk images or database files.
const MAX_EPF_HASH_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExternalProcessingPreflightRequest {
    pub one_c_executable_path: PathBuf,
    pub external_processing_path: PathBuf,
    pub expected_sha256: Option<String>,
    pub infobase: OneCInfobaseTarget,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum OneCInfobaseTarget {
    File { path: PathBuf },
    Server { server: String, infobase: String },
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalProcessingPreflightReport {
    pub ready: bool,
    pub checks: Vec<PreflightCheck>,
    pub warnings: Vec<String>,
    pub safe_launch_plan: Option<SafeLaunchPlan>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PreflightCheck {
    pub code: PreflightCheckCode,
    pub status: PreflightCheckStatus,
    pub message: String,
    pub remediation: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PreflightCheckCode {
    WindowsPlatform,
    ExecutionMode,
    LicenseBoundary,
    OneCExecutablePath,
    OneCExecutableName,
    ExternalProcessingPath,
    ExternalProcessingChecksum,
    InfobaseTarget,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PreflightCheckStatus {
    Passed,
    Warning,
    Failed,
    Skipped,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SafeLaunchPlan {
    pub mode: SafeLaunchMode,
    pub will_spawn_process: bool,
    pub will_write_to_1c: bool,
    pub executable_preview: String,
    pub external_processing_preview: String,
    pub infobase_preview: SafeInfobasePreview,
    pub argument_preview: Vec<String>,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SafeLaunchMode {
    PreflightOnly,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SafeInfobasePreview {
    File { path_preview: String },
    Server { server: String, infobase: String },
}

#[derive(Debug, Clone, Serialize, Error, PartialEq, Eq)]
#[serde(tag = "code", rename_all = "camelCase")]
pub enum EpfPreflightError {
    #[error("External processing preflight is supported only on Windows.")]
    UnsupportedPlatform {
        current_os: String,
        remediation: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RuntimePlatform {
    Windows,
    Macos,
    Linux,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ValidatedPath {
    file_name: String,
}

pub fn preflight_external_processing(
    request: ExternalProcessingPreflightRequest,
) -> Result<ExternalProcessingPreflightReport, EpfPreflightError> {
    preflight_external_processing_for_platform(request, RuntimePlatform::current())
}

fn preflight_external_processing_for_platform(
    request: ExternalProcessingPreflightRequest,
    platform: RuntimePlatform,
) -> Result<ExternalProcessingPreflightReport, EpfPreflightError> {
    if platform != RuntimePlatform::Windows {
        return Err(EpfPreflightError::UnsupportedPlatform {
            current_os: platform.as_str().to_owned(),
            remediation:
                "Run this preflight on a Windows workstation with a licensed 1C client installed."
                    .to_owned(),
        });
    }

    let mut checks = vec![
        passed(
            PreflightCheckCode::WindowsPlatform,
            "Windows platform is supported for the first EPF preflight module.",
        ),
        passed(
            PreflightCheckCode::ExecutionMode,
            "This module is preflight-only and will not spawn a 1C process.",
        ),
        passed(
            PreflightCheckCode::LicenseBoundary,
            "The preflight requires a customer-installed 1C client and does not bundle 1C binaries or license files.",
        ),
    ];

    let (executable, executable_checks) = validate_one_c_executable(&request.one_c_executable_path);
    checks.extend(executable_checks);

    let (external_processing, external_processing_checks) =
        validate_external_processing_file(&request.external_processing_path);
    checks.extend(external_processing_checks);

    checks.push(validate_checksum(
        request.expected_sha256.as_deref(),
        &request.external_processing_path,
        external_processing.is_some(),
    ));

    let (infobase_preview, infobase_check) = validate_infobase_target(&request.infobase);
    checks.push(infobase_check);

    let warnings = checks
        .iter()
        .filter(|check| check.status == PreflightCheckStatus::Warning)
        .map(|check| check.message.clone())
        .collect::<Vec<_>>();
    let ready = checks
        .iter()
        .all(|check| check.status != PreflightCheckStatus::Failed);
    let safe_launch_plan = match (ready, executable, external_processing, infobase_preview) {
        (true, Some(executable), Some(external_processing), Some(infobase_preview)) => Some(
            build_safe_launch_plan(executable, external_processing, infobase_preview),
        ),
        _ => None,
    };

    Ok(ExternalProcessingPreflightReport {
        ready,
        checks,
        warnings,
        safe_launch_plan,
    })
}

fn validate_one_c_executable(path: &Path) -> (Option<ValidatedPath>, Vec<PreflightCheck>) {
    let (validated, mut checks) = validate_absolute_existing_file(
        path,
        "1C executable",
        "exe",
        PreflightCheckCode::OneCExecutablePath,
        "Select an absolute path to an installed 1C executable file.",
    );

    let Some(validated) = validated else {
        return (None, checks);
    };

    if EXPECTED_EXECUTABLE_NAMES
        .iter()
        .any(|name| validated.file_name.eq_ignore_ascii_case(name))
    {
        checks.push(passed(
            PreflightCheckCode::OneCExecutableName,
            "The executable name matches a supported 1C client binary.",
        ));
        (Some(validated), checks)
    } else {
        checks.push(failed(
            PreflightCheckCode::OneCExecutableName,
            "The executable name is not a supported 1C client binary.",
            "Use 1cv8.exe or 1cv8c.exe from an installed 1C distribution.",
        ));
        (None, checks)
    }
}

fn validate_external_processing_file(path: &Path) -> (Option<ValidatedPath>, Vec<PreflightCheck>) {
    validate_absolute_existing_file(
        path,
        "external processing file",
        "epf",
        PreflightCheckCode::ExternalProcessingPath,
        "Select an absolute path to a signed or controlled .epf file.",
    )
}

fn validate_absolute_existing_file(
    path: &Path,
    label: &str,
    extension: &str,
    code: PreflightCheckCode,
    remediation: &str,
) -> (Option<ValidatedPath>, Vec<PreflightCheck>) {
    let mut checks = Vec::new();

    if path.as_os_str().is_empty() {
        checks.push(failed(
            code,
            &format!("The {label} path cannot be empty."),
            remediation,
        ));
        return (None, checks);
    }

    if !path.is_absolute() {
        checks.push(failed(
            code,
            &format!("The {label} path must be absolute."),
            remediation,
        ));
        return (None, checks);
    }

    // Single metadata() call avoids the TOCTOU window between try_exists() and is_file().
    match fs::metadata(path) {
        Ok(meta) if meta.is_file() => {}
        Ok(_) => {
            checks.push(failed(
                code,
                &format!("The {label} must be a file."),
                remediation,
            ));
            return (None, checks);
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            checks.push(failed(
                code,
                &format!("The {label} does not exist."),
                remediation,
            ));
            return (None, checks);
        }
        Err(_) => {
            checks.push(failed(
                code,
                &format!("The {label} could not be inspected."),
                "Check local file permissions and retry.",
            ));
            return (None, checks);
        }
    }

    if !extension_equals(path, extension) {
        checks.push(failed(
            code,
            &format!("The {label} must use the .{extension} extension."),
            remediation,
        ));
        return (None, checks);
    }

    checks.push(passed(code, &format!("The {label} path is valid.")));
    (
        Some(ValidatedPath {
            file_name: safe_file_name(path),
        }),
        checks,
    )
}

fn validate_checksum(
    expected_sha256: Option<&str>,
    external_processing_path: &Path,
    external_processing_path_valid: bool,
) -> PreflightCheck {
    if !external_processing_path_valid {
        return skipped(
            PreflightCheckCode::ExternalProcessingChecksum,
            "Checksum validation was skipped because the .epf file path is invalid.",
        );
    }

    let Some(expected_sha256) = expected_sha256 else {
        return warning(
            PreflightCheckCode::ExternalProcessingChecksum,
            "Expected SHA-256 checksum was not provided for the .epf file.",
            "Provide expectedSha256 from a trusted package manifest before pilot or production usage.",
        );
    };

    let Some(expected_sha256) = normalize_sha256(expected_sha256) else {
        return failed(
            PreflightCheckCode::ExternalProcessingChecksum,
            "Expected SHA-256 checksum is malformed.",
            "Provide a 64-character hexadecimal SHA-256 value.",
        );
    };

    match sha256_file(external_processing_path) {
        Ok(actual_sha256) if actual_sha256 == expected_sha256 => passed(
            PreflightCheckCode::ExternalProcessingChecksum,
            "The .epf SHA-256 checksum matches the expected value.",
        ),
        Ok(_) => failed(
            PreflightCheckCode::ExternalProcessingChecksum,
            "The .epf SHA-256 checksum does not match the expected value.",
            "Do not run this file. Re-download or re-approve the controlled EPF package.",
        ),
        Err(_) => failed(
            PreflightCheckCode::ExternalProcessingChecksum,
            "The .epf SHA-256 checksum could not be computed.",
            "Check local file permissions and retry.",
        ),
    }
}

fn validate_infobase_target(
    infobase: &OneCInfobaseTarget,
) -> (Option<SafeInfobasePreview>, PreflightCheck) {
    match infobase {
        OneCInfobaseTarget::File { path } => validate_file_infobase(path),
        OneCInfobaseTarget::Server { server, infobase } => {
            validate_server_infobase(server, infobase)
        }
    }
}

fn validate_file_infobase(path: &Path) -> (Option<SafeInfobasePreview>, PreflightCheck) {
    if path.as_os_str().is_empty() {
        return (
            None,
            failed(
                PreflightCheckCode::InfobaseTarget,
                "The file infobase path cannot be empty.",
                "Select an absolute path to an existing file-based 1C infobase directory.",
            ),
        );
    }

    if contains_connection_secret(&path.to_string_lossy()) {
        return (
            None,
            failed(
                PreflightCheckCode::InfobaseTarget,
                "The file infobase target appears to contain credentials or a raw connection string.",
                "Provide only an infobase directory path. Credentials must stay in secure local storage.",
            ),
        );
    }

    if !path.is_absolute() {
        return (
            None,
            failed(
                PreflightCheckCode::InfobaseTarget,
                "The file infobase path must be absolute.",
                "Select an absolute path to an existing file-based 1C infobase directory.",
            ),
        );
    }

    // Single metadata() call avoids the TOCTOU window between try_exists() and is_dir().
    match fs::metadata(path) {
        Ok(meta) if meta.is_dir() => (
            Some(SafeInfobasePreview::File {
                path_preview: "<file-infobase-directory>".to_owned(),
            }),
            passed(
                PreflightCheckCode::InfobaseTarget,
                "The file infobase target is valid.",
            ),
        ),
        Ok(_) => (
            None,
            failed(
                PreflightCheckCode::InfobaseTarget,
                "The file infobase target must be a directory.",
                "Select the root directory of the file-based 1C infobase.",
            ),
        ),
        Err(e) if e.kind() == io::ErrorKind::NotFound => (
            None,
            failed(
                PreflightCheckCode::InfobaseTarget,
                "The file infobase target does not exist.",
                "Select an existing file-based 1C infobase directory.",
            ),
        ),
        Err(_) => (
            None,
            failed(
                PreflightCheckCode::InfobaseTarget,
                "The file infobase target could not be inspected.",
                "Check local directory permissions and retry.",
            ),
        ),
    }
}

fn validate_server_infobase(
    server: &str,
    infobase: &str,
) -> (Option<SafeInfobasePreview>, PreflightCheck) {
    let server = server.trim();
    let infobase = infobase.trim();

    if server.is_empty() || infobase.is_empty() {
        return (
            None,
            failed(
                PreflightCheckCode::InfobaseTarget,
                "The server infobase target requires both server and infobase names.",
                "Provide server and infobase names only. Do not include credentials.",
            ),
        );
    }

    if contains_connection_secret(server) || contains_connection_secret(infobase) {
        return (
            None,
            failed(
                PreflightCheckCode::InfobaseTarget,
                "The server infobase target appears to contain credentials or a raw connection string.",
                "Provide only server and infobase names. Credentials must stay in secure local storage.",
            ),
        );
    }

    (
        Some(SafeInfobasePreview::Server {
            server: server.to_owned(),
            infobase: infobase.to_owned(),
        }),
        passed(
            PreflightCheckCode::InfobaseTarget,
            "The server infobase target is valid.",
        ),
    )
}

fn build_safe_launch_plan(
    executable: ValidatedPath,
    external_processing: ValidatedPath,
    infobase_preview: SafeInfobasePreview,
) -> SafeLaunchPlan {
    let mut argument_preview = vec![
        "<customer-installed-1c-client>".to_owned(),
        "ENTERPRISE".to_owned(),
    ];

    match &infobase_preview {
        SafeInfobasePreview::File { .. } => {
            argument_preview.push("/F".to_owned());
            argument_preview.push("<file-infobase-directory>".to_owned());
        }
        SafeInfobasePreview::Server { .. } => {
            argument_preview.push("/S".to_owned());
            argument_preview.push("<server>/<infobase>".to_owned());
        }
    }

    argument_preview.push("/Execute".to_owned());
    argument_preview.push("<validated-epf-file>".to_owned());

    SafeLaunchPlan {
        mode: SafeLaunchMode::PreflightOnly,
        will_spawn_process: false,
        will_write_to_1c: false,
        executable_preview: executable.file_name,
        external_processing_preview: external_processing.file_name,
        infobase_preview,
        argument_preview,
        notes: vec![
            "This is a non-executing plan for operator review only.".to_owned(),
            "Actual command-line behavior must be hardened on target customer environments before enabling execution.".to_owned(),
            "The module does not bundle 1C binaries, license files, or credentials.".to_owned(),
        ],
    }
}

fn extension_equals(path: &Path, expected_extension: &str) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case(expected_extension))
}

fn safe_file_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .map_or_else(|| "<non-unicode-file-name>".to_owned(), str::to_owned)
}

fn contains_connection_secret(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    lower.contains(';')
        || (lower.contains("://") && lower.contains('@'))
        || lower.contains("access_token")
        || lower.contains("api_key")
        || lower.contains("authorization:")
        || lower.contains("bearer ")
        || lower.contains("secret=")
        || lower.contains("usr=")
        || lower.contains("user=")
        || lower.contains("pwd=")
        || lower.contains("password=")
        || lower.contains("token=")
        || lower.contains("connectionstring=")
}

fn normalize_sha256(value: &str) -> Option<String> {
    let normalized = value.trim().to_ascii_lowercase();

    if normalized.len() == 64 && normalized.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        Some(normalized)
    } else {
        None
    }
}

fn sha256_file(path: &Path) -> io::Result<String> {
    let mut file = File::open(path)?;

    if file.metadata()?.len() > MAX_EPF_HASH_BYTES {
        return Err(io::Error::other(
            "EPF file exceeds 64 MiB; checksum validation is not supported for files this large",
        ));
    }

    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 65536];

    loop {
        let bytes_read = file.read(&mut buffer)?;
        if bytes_read == 0 {
            break;
        }
        hasher.update(&buffer[..bytes_read]);
    }

    Ok(lower_hex(&hasher.finalize()))
}

fn lower_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);

    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }

    output
}

fn passed(code: PreflightCheckCode, message: &str) -> PreflightCheck {
    PreflightCheck {
        code,
        status: PreflightCheckStatus::Passed,
        message: message.to_owned(),
        remediation: None,
    }
}

fn warning(code: PreflightCheckCode, message: &str, remediation: &str) -> PreflightCheck {
    PreflightCheck {
        code,
        status: PreflightCheckStatus::Warning,
        message: message.to_owned(),
        remediation: Some(remediation.to_owned()),
    }
}

fn failed(code: PreflightCheckCode, message: &str, remediation: &str) -> PreflightCheck {
    PreflightCheck {
        code,
        status: PreflightCheckStatus::Failed,
        message: message.to_owned(),
        remediation: Some(remediation.to_owned()),
    }
}

fn skipped(code: PreflightCheckCode, message: &str) -> PreflightCheck {
    PreflightCheck {
        code,
        status: PreflightCheckStatus::Skipped,
        message: message.to_owned(),
        remediation: None,
    }
}

impl RuntimePlatform {
    fn current() -> Self {
        if cfg!(windows) {
            Self::Windows
        } else if cfg!(target_os = "macos") {
            Self::Macos
        } else if cfg!(target_os = "linux") {
            Self::Linux
        } else {
            Self::Other
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Windows => "windows",
            Self::Macos => "macos",
            Self::Linux => "linux",
            Self::Other => "other",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(name: &str) -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("test clock should be after Unix epoch")
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "automator-epf-preflight-{name}-{}-{unique}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("test directory should be created");
            Self { path }
        }

        fn file(&self, name: &str, contents: &[u8]) -> PathBuf {
            let path = self.path.join(name);
            fs::write(&path, contents).expect("test file should be written");
            path
        }

        fn dir(&self, name: &str) -> PathBuf {
            let path = self.path.join(name);
            fs::create_dir_all(&path).expect("test child directory should be created");
            path
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn request(
        executable_path: PathBuf,
        external_processing_path: PathBuf,
        infobase_path: PathBuf,
    ) -> ExternalProcessingPreflightRequest {
        ExternalProcessingPreflightRequest {
            one_c_executable_path: executable_path,
            external_processing_path,
            expected_sha256: None,
            infobase: OneCInfobaseTarget::File {
                path: infobase_path,
            },
        }
    }

    fn ready_request() -> (TestDir, ExternalProcessingPreflightRequest) {
        let test_dir = TestDir::new("ready-request");
        let executable = test_dir.file("1cv8c.exe", b"fake executable");
        let epf = test_dir.file("processor.epf", b"fake epf");
        let infobase = test_dir.dir("infobase");
        let request = request(executable, epf, infobase);
        (test_dir, request)
    }

    fn status_for(
        report: &ExternalProcessingPreflightReport,
        code: PreflightCheckCode,
    ) -> PreflightCheckStatus {
        report
            .checks
            .iter()
            .find(|check| check.code == code)
            .expect("expected check should exist")
            .status
    }

    fn serialized_report(report: &ExternalProcessingPreflightReport) -> String {
        serde_json::to_string(report).expect("report should serialize to JSON for testing")
    }

    #[test]
    fn preflight_should_return_unsupported_platform_for_non_windows() {
        let (_test_dir, request) = ready_request();

        let error = preflight_external_processing_for_platform(request, RuntimePlatform::Macos)
            .expect_err("macOS should be unsupported for the first EPF module");

        assert!(matches!(
            error,
            EpfPreflightError::UnsupportedPlatform { .. }
        ));
    }

    #[cfg(not(windows))]
    #[test]
    fn public_preflight_should_use_current_platform_and_fail_closed_on_non_windows() {
        let (_test_dir, request) = ready_request();

        let error = preflight_external_processing(request)
            .expect_err("public preflight should fail closed outside Windows");

        assert!(matches!(
            error,
            EpfPreflightError::UnsupportedPlatform { .. }
        ));
    }

    #[test]
    fn executable_path_should_fail_when_empty() {
        let (_test_dir, request) = ready_request();
        let request = ExternalProcessingPreflightRequest {
            one_c_executable_path: PathBuf::new(),
            ..request
        };

        let report = preflight_external_processing_for_platform(request, RuntimePlatform::Windows)
            .expect("Windows preflight should return a report");

        assert_eq!(
            status_for(&report, PreflightCheckCode::OneCExecutablePath),
            PreflightCheckStatus::Failed
        );
    }

    #[test]
    fn executable_path_should_fail_when_relative() {
        let (_test_dir, request) = ready_request();
        let request = ExternalProcessingPreflightRequest {
            one_c_executable_path: PathBuf::from("1cv8c.exe"),
            ..request
        };

        let report = preflight_external_processing_for_platform(request, RuntimePlatform::Windows)
            .expect("Windows preflight should return a report");

        assert_eq!(
            status_for(&report, PreflightCheckCode::OneCExecutablePath),
            PreflightCheckStatus::Failed
        );
    }

    #[test]
    fn executable_path_should_fail_when_missing() {
        let (test_dir, request) = ready_request();
        let request = ExternalProcessingPreflightRequest {
            one_c_executable_path: test_dir.path.join("missing.exe"),
            ..request
        };

        let report = preflight_external_processing_for_platform(request, RuntimePlatform::Windows)
            .expect("Windows preflight should return a report");

        assert_eq!(
            status_for(&report, PreflightCheckCode::OneCExecutablePath),
            PreflightCheckStatus::Failed
        );
    }

    #[test]
    fn executable_path_should_fail_when_directory() {
        let (test_dir, request) = ready_request();
        let request = ExternalProcessingPreflightRequest {
            one_c_executable_path: test_dir.dir("client-directory"),
            ..request
        };

        let report = preflight_external_processing_for_platform(request, RuntimePlatform::Windows)
            .expect("Windows preflight should return a report");

        assert_eq!(
            status_for(&report, PreflightCheckCode::OneCExecutablePath),
            PreflightCheckStatus::Failed
        );
    }

    #[test]
    fn executable_path_should_fail_when_extension_is_wrong() {
        let (test_dir, request) = ready_request();
        let request = ExternalProcessingPreflightRequest {
            one_c_executable_path: test_dir.file("1cv8c.bat", b"not exe"),
            ..request
        };

        let report = preflight_external_processing_for_platform(request, RuntimePlatform::Windows)
            .expect("Windows preflight should return a report");

        assert_eq!(
            status_for(&report, PreflightCheckCode::OneCExecutablePath),
            PreflightCheckStatus::Failed
        );
    }

    #[test]
    fn executable_name_should_fail_when_not_supported_1c_binary() {
        let (test_dir, request) = ready_request();
        let request = ExternalProcessingPreflightRequest {
            one_c_executable_path: test_dir.file("not-1c.exe", b"exe"),
            ..request
        };

        let report = preflight_external_processing_for_platform(request, RuntimePlatform::Windows)
            .expect("Windows preflight should return a report");

        assert_eq!(
            status_for(&report, PreflightCheckCode::OneCExecutableName),
            PreflightCheckStatus::Failed
        );
    }

    #[test]
    fn epf_path_should_accept_uppercase_extension() {
        let (test_dir, request) = ready_request();
        let request = ExternalProcessingPreflightRequest {
            external_processing_path: test_dir.file("PROCESSOR.EPF", b"fake epf"),
            ..request
        };

        let report = preflight_external_processing_for_platform(request, RuntimePlatform::Windows)
            .expect("Windows preflight should return a report");

        assert_eq!(
            status_for(&report, PreflightCheckCode::ExternalProcessingPath),
            PreflightCheckStatus::Passed
        );
    }

    #[test]
    fn epf_path_should_fail_when_empty() {
        let (_test_dir, request) = ready_request();
        let request = ExternalProcessingPreflightRequest {
            external_processing_path: PathBuf::new(),
            ..request
        };

        let report = preflight_external_processing_for_platform(request, RuntimePlatform::Windows)
            .expect("Windows preflight should return a report");

        assert_eq!(
            status_for(&report, PreflightCheckCode::ExternalProcessingPath),
            PreflightCheckStatus::Failed
        );
        assert_eq!(
            status_for(&report, PreflightCheckCode::ExternalProcessingChecksum),
            PreflightCheckStatus::Skipped
        );
    }

    #[test]
    fn epf_path_should_fail_when_relative() {
        let (_test_dir, request) = ready_request();
        let request = ExternalProcessingPreflightRequest {
            external_processing_path: PathBuf::from("processor.epf"),
            ..request
        };

        let report = preflight_external_processing_for_platform(request, RuntimePlatform::Windows)
            .expect("Windows preflight should return a report");

        assert_eq!(
            status_for(&report, PreflightCheckCode::ExternalProcessingPath),
            PreflightCheckStatus::Failed
        );
        assert_eq!(
            status_for(&report, PreflightCheckCode::ExternalProcessingChecksum),
            PreflightCheckStatus::Skipped
        );
    }

    #[test]
    fn epf_path_should_fail_when_missing() {
        let (test_dir, request) = ready_request();
        let request = ExternalProcessingPreflightRequest {
            external_processing_path: test_dir.path.join("missing.epf"),
            ..request
        };

        let report = preflight_external_processing_for_platform(request, RuntimePlatform::Windows)
            .expect("Windows preflight should return a report");

        assert_eq!(
            status_for(&report, PreflightCheckCode::ExternalProcessingPath),
            PreflightCheckStatus::Failed
        );
        assert_eq!(
            status_for(&report, PreflightCheckCode::ExternalProcessingChecksum),
            PreflightCheckStatus::Skipped
        );
    }

    #[test]
    fn epf_path_should_fail_when_directory() {
        let (test_dir, request) = ready_request();
        let request = ExternalProcessingPreflightRequest {
            external_processing_path: test_dir.dir("processor-directory.epf"),
            ..request
        };

        let report = preflight_external_processing_for_platform(request, RuntimePlatform::Windows)
            .expect("Windows preflight should return a report");

        assert_eq!(
            status_for(&report, PreflightCheckCode::ExternalProcessingPath),
            PreflightCheckStatus::Failed
        );
        assert_eq!(
            status_for(&report, PreflightCheckCode::ExternalProcessingChecksum),
            PreflightCheckStatus::Skipped
        );
    }

    #[test]
    fn epf_path_should_fail_when_extension_is_wrong() {
        let (test_dir, request) = ready_request();
        let request = ExternalProcessingPreflightRequest {
            external_processing_path: test_dir.file("processor.txt", b"fake epf"),
            ..request
        };

        let report = preflight_external_processing_for_platform(request, RuntimePlatform::Windows)
            .expect("Windows preflight should return a report");

        assert_eq!(
            status_for(&report, PreflightCheckCode::ExternalProcessingPath),
            PreflightCheckStatus::Failed
        );
    }

    #[test]
    fn checksum_should_pass_when_expected_value_matches() {
        let (_test_dir, request) = ready_request();
        let expected_sha256 =
            sha256_file(&request.external_processing_path).expect("checksum should be computed");
        let request = ExternalProcessingPreflightRequest {
            expected_sha256: Some(expected_sha256.to_ascii_uppercase()),
            ..request
        };

        let report = preflight_external_processing_for_platform(request, RuntimePlatform::Windows)
            .expect("Windows preflight should return a report");

        assert_eq!(
            status_for(&report, PreflightCheckCode::ExternalProcessingChecksum),
            PreflightCheckStatus::Passed
        );
    }

    #[test]
    fn checksum_should_fail_when_expected_value_mismatches() {
        let (_test_dir, request) = ready_request();
        let request = ExternalProcessingPreflightRequest {
            expected_sha256: Some("0".repeat(64)),
            ..request
        };

        let report = preflight_external_processing_for_platform(request, RuntimePlatform::Windows)
            .expect("Windows preflight should return a report");

        assert_eq!(
            status_for(&report, PreflightCheckCode::ExternalProcessingChecksum),
            PreflightCheckStatus::Failed
        );
    }

    #[test]
    fn checksum_should_fail_when_expected_value_is_malformed() {
        let (_test_dir, request) = ready_request();
        let request = ExternalProcessingPreflightRequest {
            expected_sha256: Some("not-a-sha256".to_owned()),
            ..request
        };

        let report = preflight_external_processing_for_platform(request, RuntimePlatform::Windows)
            .expect("Windows preflight should return a report");

        assert_eq!(
            status_for(&report, PreflightCheckCode::ExternalProcessingChecksum),
            PreflightCheckStatus::Failed
        );
    }

    #[test]
    fn sha256_normalization_should_accept_trimmed_case_insensitive_hex_only() {
        let valid = "0123456789abcdef".repeat(4);
        let accepted_inputs = [
            valid.as_str(),
            "0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF",
            "  0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef  ",
        ];
        let rejected_inputs = [
            "",
            "0",
            "0123456789abcdef",
            "g123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdeff",
        ];

        for input in accepted_inputs {
            assert_eq!(normalize_sha256(input), Some(valid.clone()));
        }

        for input in rejected_inputs {
            assert_eq!(normalize_sha256(input), None);
        }
    }

    #[test]
    fn extension_comparison_should_be_case_insensitive_without_accepting_suffix_tricks() {
        let accepted_paths = [
            PathBuf::from("/tmp/processor.epf"),
            PathBuf::from("/tmp/processor.EPF"),
            PathBuf::from("/tmp/processor.ePf"),
        ];
        let rejected_paths = [
            PathBuf::from("/tmp/processor.epf.exe"),
            PathBuf::from("/tmp/processor"),
            PathBuf::from("/tmp/processor.epf/child"),
        ];

        for path in accepted_paths {
            assert!(extension_equals(&path, "epf"));
        }

        for path in rejected_paths {
            assert!(!extension_equals(&path, "epf"));
        }
    }

    #[test]
    fn checksum_should_warn_when_expected_value_is_missing() {
        let (_test_dir, request) = ready_request();

        let report = preflight_external_processing_for_platform(request, RuntimePlatform::Windows)
            .expect("Windows preflight should return a report");

        assert_eq!(
            status_for(&report, PreflightCheckCode::ExternalProcessingChecksum),
            PreflightCheckStatus::Warning
        );
        assert_eq!(report.warnings.len(), 1);
    }

    #[test]
    fn file_infobase_should_pass_when_directory_exists() {
        let (_test_dir, request) = ready_request();

        let report = preflight_external_processing_for_platform(request, RuntimePlatform::Windows)
            .expect("Windows preflight should return a report");

        assert_eq!(
            status_for(&report, PreflightCheckCode::InfobaseTarget),
            PreflightCheckStatus::Passed
        );
    }

    #[test]
    fn file_infobase_should_fail_when_path_contains_connection_secret() {
        let (test_dir, request) = ready_request();
        let secret_like_path = test_dir.dir("Srvr=one-c;Usr=admin;Pwd=secret");
        let request = ExternalProcessingPreflightRequest {
            infobase: OneCInfobaseTarget::File {
                path: secret_like_path,
            },
            ..request
        };

        let report = preflight_external_processing_for_platform(request, RuntimePlatform::Windows)
            .expect("Windows preflight should return a report");
        let serialized = serialized_report(&report);

        assert_eq!(
            status_for(&report, PreflightCheckCode::InfobaseTarget),
            PreflightCheckStatus::Failed
        );
        assert!(!serialized.contains("admin"));
        assert!(!serialized.contains("secret"));
    }

    #[test]
    fn server_infobase_should_pass_with_names_only() {
        let (_test_dir, request) = ready_request();
        let request = ExternalProcessingPreflightRequest {
            infobase: OneCInfobaseTarget::Server {
                server: "one-c.example.local:1541".to_owned(),
                infobase: "Accounting".to_owned(),
            },
            ..request
        };

        let report = preflight_external_processing_for_platform(request, RuntimePlatform::Windows)
            .expect("Windows preflight should return a report");

        assert_eq!(
            status_for(&report, PreflightCheckCode::InfobaseTarget),
            PreflightCheckStatus::Passed
        );
    }

    #[test]
    fn server_infobase_should_trim_names_before_previewing() {
        let (_test_dir, request) = ready_request();
        let request = ExternalProcessingPreflightRequest {
            infobase: OneCInfobaseTarget::Server {
                server: "  one-c.example.local:1541  ".to_owned(),
                infobase: "  Accounting  ".to_owned(),
            },
            ..request
        };

        let report = preflight_external_processing_for_platform(request, RuntimePlatform::Windows)
            .expect("Windows preflight should return a report");
        let launch_plan = report
            .safe_launch_plan
            .expect("valid server request should include launch plan");

        assert_eq!(
            launch_plan.infobase_preview,
            SafeInfobasePreview::Server {
                server: "one-c.example.local:1541".to_owned(),
                infobase: "Accounting".to_owned(),
            }
        );
    }

    #[test]
    fn infobase_should_fail_when_connection_string_contains_credentials() {
        let (_test_dir, request) = ready_request();
        let request = ExternalProcessingPreflightRequest {
            infobase: OneCInfobaseTarget::Server {
                server: "Srvr=one-c;Usr=admin;Pwd=secret".to_owned(),
                infobase: "Accounting".to_owned(),
            },
            ..request
        };

        let report = preflight_external_processing_for_platform(request, RuntimePlatform::Windows)
            .expect("Windows preflight should return a report");
        let serialized = serialized_report(&report);

        assert_eq!(
            status_for(&report, PreflightCheckCode::InfobaseTarget),
            PreflightCheckStatus::Failed
        );
        assert!(!serialized.contains("admin"));
        assert!(!serialized.contains("secret"));
    }

    #[test]
    fn infobase_should_fail_for_generated_credential_markers() {
        let markers = [
            "Usr=admin",
            "User=admin",
            "Pwd=secret",
            "Password=secret",
            "token=secret",
            "access_token=secret",
            "api_key=secret",
            "authorization: bearer secret",
            "Bearer secret",
            "secret=value",
            "https://user:pass@example.local/Accounting",
        ];

        for marker in markers {
            assert!(
                contains_connection_secret(marker),
                "marker should be classified as credential-like: {marker}"
            );
        }
    }

    #[test]
    fn infobase_should_not_flag_plain_server_or_infobase_names_as_credentials() {
        let safe_values = [
            "one-c.example.local",
            "one-c.example.local:1541",
            "Accounting",
            "erp-production",
            "department_accounting",
        ];

        for value in safe_values {
            assert!(
                !contains_connection_secret(value),
                "plain server or infobase name should be accepted: {value}"
            );
        }
    }

    #[test]
    fn ready_report_should_return_non_executing_launch_plan() {
        let (_test_dir, request) = ready_request();

        let report = preflight_external_processing_for_platform(request, RuntimePlatform::Windows)
            .expect("Windows preflight should return a report");
        let launch_plan = report
            .safe_launch_plan
            .expect("ready report should include launch plan");

        assert!(!launch_plan.will_spawn_process);
        assert!(!launch_plan.will_write_to_1c);
        assert_eq!(launch_plan.mode, SafeLaunchMode::PreflightOnly);
    }

    #[test]
    fn ready_report_should_not_expose_absolute_local_paths_or_raw_command_payloads() {
        let (test_dir, request) = ready_request();
        let executable_path = request.one_c_executable_path.display().to_string();
        let external_processing_path = request.external_processing_path.display().to_string();
        let infobase_path = match &request.infobase {
            OneCInfobaseTarget::File { path } => path.display().to_string(),
            OneCInfobaseTarget::Server { .. } => unreachable!("ready request uses file infobase"),
        };

        let report = preflight_external_processing_for_platform(request, RuntimePlatform::Windows)
            .expect("Windows preflight should return a report");
        let serialized = serialized_report(&report);
        let launch_plan = report
            .safe_launch_plan
            .expect("ready report should include launch plan");

        assert!(!serialized.contains(&test_dir.path.display().to_string()));
        assert!(!serialized.contains(&executable_path));
        assert!(!serialized.contains(&external_processing_path));
        assert!(!serialized.contains(&infobase_path));
        assert_eq!(
            launch_plan.argument_preview,
            vec![
                "<customer-installed-1c-client>",
                "ENTERPRISE",
                "/F",
                "<file-infobase-directory>",
                "/Execute",
                "<validated-epf-file>",
            ]
        );
    }
}
