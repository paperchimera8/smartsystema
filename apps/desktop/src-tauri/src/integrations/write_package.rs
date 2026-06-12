use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use thiserror::Error;

const WRITE_PACKAGE_PAYLOAD_VERSION: u8 = 1;
const JSON_FORMAT_VERSION: u8 = 1;
const MAX_SAFE_FILE_SEGMENT_CHARS: usize = 96;

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WritePackageRequest {
    pub payload_version: u8,
    pub target_kind: WriteTargetKind,
    pub operation: WriteOperation,
    pub document: FinalDocumentForWrite,
    pub metadata_object: WritePackageMetadataObject,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum WriteTargetKind {
    FreshOData,
    LocalJsonExport,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum WriteOperation {
    Create,
    Update,
    Delete,
    Post,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum WriteApprovalStatus {
    Approved,
    Pending,
    Rejected,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum WriteValidationStatus {
    Passed,
    Failed,
    Warning,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FinalDocumentForWrite {
    pub draft_id: String,
    pub metadata_snapshot_id: String,
    pub schema_hash: String,
    pub resource_name: String,
    pub approval_status: WriteApprovalStatus,
    pub validation_status: WriteValidationStatus,
    pub fields: Vec<FinalDocumentField>,
    #[serde(default)]
    pub references: Vec<FinalDocumentReference>,
    pub idempotency_key: String,
    pub correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FinalDocumentField {
    pub name: String,
    pub value: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FinalDocumentReference {
    pub name: String,
    pub field_name: String,
    pub target_resource_name: Option<String>,
    pub target_key: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WritePackageMetadataObject {
    pub name: String,
    pub resource_name: String,
    pub fields: Vec<WritePackageMetadataField>,
    pub keys: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WritePackageMetadataField {
    pub name: String,
    pub type_name: String,
    pub nullable: bool,
    pub is_key: bool,
    pub is_reference: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WritePackagePlan {
    pub plan_id: String,
    pub target_kind: WriteTargetKind,
    pub operation: WriteOperation,
    pub draft_id: String,
    pub metadata_snapshot_id: String,
    pub schema_hash: String,
    pub idempotency_key: String,
    pub correlation_id: String,
    pub checks: Vec<WritePackageCheck>,
    pub artifact: WritePackageArtifact,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WritePackageCheck {
    pub code: WritePackageCheckCode,
    pub status: WritePackageCheckStatus,
    pub message: String,
    pub field: Option<String>,
    pub remediation: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum WritePackageCheckCode {
    PayloadVersion,
    ApprovalStatus,
    ValidationStatus,
    RequiredIdentifiers,
    OperationSupported,
    MetadataResource,
    MetadataFields,
    RequiredFields,
    SecretBoundary,
    ExecutionBoundary,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum WritePackageCheckStatus {
    Passed,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum WritePackageArtifact {
    ODataRequest(ODataRequestArtifact),
    LocalJsonExport(LocalJsonExportArtifact),
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ODataRequestArtifact {
    pub method: ODataMethod,
    pub relative_path: String,
    pub query: ODataQuery,
    pub headers: ODataHeaders,
    pub body: BTreeMap<String, Value>,
    pub body_hash: String,
    pub will_execute: bool,
    pub will_write_to_1c: bool,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ODataMethod {
    Post,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ODataQuery {
    #[serde(rename = "$format")]
    pub format: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ODataHeaders {
    pub accept: String,
    pub content_type: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalJsonExportArtifact {
    pub media_type: String,
    pub file_name: String,
    pub package: LocalJsonExportPackage,
    pub package_hash: String,
    pub will_write_file: bool,
    pub will_write_to_1c: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalJsonExportPackage {
    pub format_version: u8,
    pub draft_id: String,
    pub metadata_snapshot_id: String,
    pub schema_hash: String,
    pub resource_name: String,
    pub operation: WriteOperation,
    pub fields: BTreeMap<String, Value>,
    pub references: Vec<FinalDocumentReference>,
    pub idempotency_key: String,
}

#[derive(Debug, Clone, Serialize, Error, PartialEq, Eq)]
#[serde(tag = "code", rename_all = "camelCase")]
pub enum WritePackagePlanError {
    #[error("Write package payload version is unsupported.")]
    InvalidPayloadVersion {
        message: String,
        retryable: bool,
        remediation: String,
        correlation_id: Option<String>,
    },
    #[error("Draft approval is required before planning a write package.")]
    ApprovalRequired {
        message: String,
        retryable: bool,
        remediation: String,
        correlation_id: Option<String>,
    },
    #[error("Successful validation is required before planning a write package.")]
    ValidationRequired {
        message: String,
        retryable: bool,
        remediation: String,
        correlation_id: Option<String>,
    },
    #[error("A required write package identifier is invalid.")]
    InvalidIdentifier {
        message: String,
        retryable: bool,
        remediation: String,
        field: String,
        correlation_id: Option<String>,
    },
    #[error("The requested write operation is unsupported.")]
    UnsupportedOperation {
        message: String,
        retryable: bool,
        remediation: String,
        correlation_id: Option<String>,
    },
    #[error("The draft target does not match the provided metadata object.")]
    MetadataMismatch {
        message: String,
        retryable: bool,
        remediation: String,
        field: Option<String>,
        correlation_id: Option<String>,
    },
    #[error("The final document contains a field that is not present in metadata.")]
    UnknownField {
        message: String,
        retryable: bool,
        remediation: String,
        field: String,
        correlation_id: Option<String>,
    },
    #[error("The final document is missing a required field.")]
    MissingRequiredField {
        message: String,
        retryable: bool,
        remediation: String,
        field: String,
        correlation_id: Option<String>,
    },
    #[error("Write package request appears to contain secret material.")]
    SecretMaterialRejected {
        message: String,
        retryable: bool,
        remediation: String,
        correlation_id: Option<String>,
    },
    #[error("The final document contains the same output field more than once.")]
    DuplicateField {
        message: String,
        retryable: bool,
        remediation: String,
        field: String,
        correlation_id: Option<String>,
    },
    #[error("Internal write package error: {reason}")]
    Internal { reason: String },
}

pub fn plan_write_package(
    request: WritePackageRequest,
) -> Result<WritePackagePlan, WritePackagePlanError> {
    validate_secret_boundary(&request)?;
    validate_payload_version(&request)?;
    validate_approval_status(&request)?;
    validate_validation_status(&request)?;
    validate_supported_operation(&request)?;
    validate_required_identifiers(&request)?;
    validate_metadata_resource(&request)?;
    validate_metadata_fields(&request)?;

    let metadata_fields = metadata_field_map(&request.metadata_object);
    let body = build_body(&request, &metadata_fields)?;
    validate_required_fields(
        &metadata_fields,
        &body,
        request.document.correlation_id.as_str(),
    )?;

    let artifact = match request.target_kind {
        WriteTargetKind::FreshOData => {
            WritePackageArtifact::ODataRequest(build_odata_artifact(&request, &body)?)
        }
        WriteTargetKind::LocalJsonExport => {
            WritePackageArtifact::LocalJsonExport(build_local_json_artifact(&request, &body)?)
        }
    };
    let artifact_hash = artifact_hash(&artifact)?;

    Ok(WritePackagePlan {
        plan_id: format!("write-plan-{}", &artifact_hash[..16]),
        target_kind: request.target_kind,
        operation: WriteOperation::Create,
        draft_id: request.document.draft_id,
        metadata_snapshot_id: request.document.metadata_snapshot_id,
        schema_hash: request.document.schema_hash,
        idempotency_key: request.document.idempotency_key,
        correlation_id: request.document.correlation_id,
        checks: success_checks(),
        artifact,
    })
}

fn validate_payload_version(request: &WritePackageRequest) -> Result<(), WritePackagePlanError> {
    if request.payload_version == WRITE_PACKAGE_PAYLOAD_VERSION {
        return Ok(());
    }

    Err(WritePackagePlanError::InvalidPayloadVersion {
        message: "Only write package payload version 1 is supported.".to_owned(),
        retryable: false,
        remediation: "Regenerate the write package request with payloadVersion 1.".to_owned(),
        correlation_id: correlation_id(request),
    })
}

fn validate_approval_status(request: &WritePackageRequest) -> Result<(), WritePackagePlanError> {
    if request.document.approval_status == WriteApprovalStatus::Approved {
        return Ok(());
    }

    Err(WritePackagePlanError::ApprovalRequired {
        message: "The draft must be approved before a write package can be planned.".to_owned(),
        retryable: false,
        remediation: "Route the draft through review and approval before planning a write."
            .to_owned(),
        correlation_id: correlation_id(request),
    })
}

fn validate_validation_status(request: &WritePackageRequest) -> Result<(), WritePackagePlanError> {
    if request.document.validation_status == WriteValidationStatus::Passed {
        return Ok(());
    }

    Err(WritePackagePlanError::ValidationRequired {
        message: "The draft must have a passed validation report before write planning.".to_owned(),
        retryable: false,
        remediation: "Fix validation errors or complete an authorized validation override first."
            .to_owned(),
        correlation_id: correlation_id(request),
    })
}

fn validate_supported_operation(
    request: &WritePackageRequest,
) -> Result<(), WritePackagePlanError> {
    if request.operation == WriteOperation::Create {
        return Ok(());
    }

    Err(WritePackagePlanError::UnsupportedOperation {
        message: "Module 3 supports only create write packages.".to_owned(),
        retryable: false,
        remediation: "Use a create operation or implement a later write planner version."
            .to_owned(),
        correlation_id: correlation_id(request),
    })
}

fn validate_required_identifiers(
    request: &WritePackageRequest,
) -> Result<(), WritePackagePlanError> {
    [
        ("draftId", request.document.draft_id.as_str()),
        (
            "metadataSnapshotId",
            request.document.metadata_snapshot_id.as_str(),
        ),
        ("schemaHash", request.document.schema_hash.as_str()),
        ("resourceName", request.document.resource_name.as_str()),
        ("idempotencyKey", request.document.idempotency_key.as_str()),
        ("correlationId", request.document.correlation_id.as_str()),
    ]
    .iter()
    .try_for_each(|(field, value)| validate_non_empty_identifier(field, value, request))
}

fn validate_non_empty_identifier(
    field: &str,
    value: &str,
    request: &WritePackageRequest,
) -> Result<(), WritePackagePlanError> {
    if !value.trim().is_empty() {
        return Ok(());
    }

    Err(WritePackagePlanError::InvalidIdentifier {
        message: "A required write package identifier is empty.".to_owned(),
        retryable: false,
        remediation: "Provide all required identifiers before planning a write package.".to_owned(),
        field: (*field).to_owned(),
        correlation_id: correlation_id(request),
    })
}

fn validate_metadata_resource(request: &WritePackageRequest) -> Result<(), WritePackagePlanError> {
    validate_non_empty_identifier(
        "metadataObject.resourceName",
        &request.metadata_object.resource_name,
        request,
    )?;
    validate_resource_path_segment("resourceName", &request.document.resource_name, request)?;
    validate_resource_path_segment(
        "metadataObject.resourceName",
        &request.metadata_object.resource_name,
        request,
    )?;

    if request.document.resource_name == request.metadata_object.resource_name {
        return Ok(());
    }

    Err(WritePackagePlanError::MetadataMismatch {
        message: "The final document target resource does not match the metadata object."
            .to_owned(),
        retryable: false,
        remediation:
            "Rebuild the final draft against the active metadata snapshot before planning a write."
                .to_owned(),
        field: Some("resourceName".to_owned()),
        correlation_id: correlation_id(request),
    })
}

fn validate_resource_path_segment(
    field: &str,
    value: &str,
    request: &WritePackageRequest,
) -> Result<(), WritePackagePlanError> {
    let is_safe_relative_segment = !value.trim().is_empty()
        && !value.chars().any(|character| {
            character.is_control()
                || character.is_whitespace()
                || matches!(
                    character,
                    '/' | '\\' | '?' | '#' | '&' | '=' | ':' | '@' | ';'
                )
        })
        && !value.contains("..");

    if is_safe_relative_segment {
        return Ok(());
    }

    Err(WritePackagePlanError::InvalidIdentifier {
        message: "The target resource name must be a single safe OData resource segment."
            .to_owned(),
        retryable: false,
        remediation:
            "Use the resourceName from the active metadata snapshot, without URL, query, or path fragments."
                .to_owned(),
        field: field.to_owned(),
        correlation_id: correlation_id(request),
    })
}

fn validate_metadata_fields(request: &WritePackageRequest) -> Result<(), WritePackagePlanError> {
    let mut field_names = BTreeSet::new();

    for field in &request.metadata_object.fields {
        validate_non_empty_identifier("metadataObject.fields.name", &field.name, request)?;

        if !field_names.insert(field.name.as_str()) {
            return Err(WritePackagePlanError::MetadataMismatch {
                message: "The metadata object contains duplicate field names.".to_owned(),
                retryable: false,
                remediation:
                    "Refresh the metadata snapshot and retry planning with a normalized schema."
                        .to_owned(),
                field: Some(safe_field_name(&field.name)),
                correlation_id: correlation_id(request),
            });
        }
    }

    let mut key_names = BTreeSet::new();

    for key in &request.metadata_object.keys {
        validate_non_empty_identifier("metadataObject.keys", key, request)?;

        if !key_names.insert(key.as_str()) {
            return Err(WritePackagePlanError::MetadataMismatch {
                message: "The metadata object contains duplicate key names.".to_owned(),
                retryable: false,
                remediation:
                    "Refresh the metadata snapshot and retry planning with a normalized schema."
                        .to_owned(),
                field: Some(safe_field_name(key)),
                correlation_id: correlation_id(request),
            });
        }

        if !field_names.contains(key.as_str()) {
            return Err(WritePackagePlanError::MetadataMismatch {
                message: "The metadata object contains a key that is not present as a field."
                    .to_owned(),
                retryable: false,
                remediation:
                    "Refresh the metadata snapshot and retry planning with a complete schema."
                        .to_owned(),
                field: Some(safe_field_name(key)),
                correlation_id: correlation_id(request),
            });
        }
    }

    Ok(())
}

fn metadata_field_map(
    metadata_object: &WritePackageMetadataObject,
) -> BTreeMap<&str, &WritePackageMetadataField> {
    metadata_object
        .fields
        .iter()
        .map(|field| (field.name.as_str(), field))
        .collect()
}

fn build_body(
    request: &WritePackageRequest,
    metadata_fields: &BTreeMap<&str, &WritePackageMetadataField>,
) -> Result<BTreeMap<String, Value>, WritePackagePlanError> {
    let mut output = BTreeMap::new();

    for field in &request.document.fields {
        validate_known_field(&field.name, metadata_fields, request)?;
        let canonical = canonical_json_value(
            &field.value,
            &field.name,
            Some(request.document.correlation_id.as_str()),
        )?;
        insert_field(&mut output, field.name.clone(), canonical, request)?;
    }

    for reference in &request.document.references {
        validate_reference(reference, metadata_fields, request)?;
        insert_field(
            &mut output,
            reference.field_name.clone(),
            Value::String(reference.target_key.clone()),
            request,
        )?;
    }

    Ok(output)
}

fn validate_known_field(
    field_name: &str,
    metadata_fields: &BTreeMap<&str, &WritePackageMetadataField>,
    request: &WritePackageRequest,
) -> Result<(), WritePackagePlanError> {
    if metadata_fields.contains_key(field_name) {
        return Ok(());
    }

    Err(WritePackagePlanError::UnknownField {
        message: "The final document contains a field that is not present in the metadata object."
            .to_owned(),
        retryable: false,
        remediation: "Rebuild mapping against the active metadata snapshot and retry planning."
            .to_owned(),
        field: safe_field_name(field_name),
        correlation_id: correlation_id(request),
    })
}

fn validate_reference(
    reference: &FinalDocumentReference,
    metadata_fields: &BTreeMap<&str, &WritePackageMetadataField>,
    request: &WritePackageRequest,
) -> Result<(), WritePackagePlanError> {
    let Some(metadata_field) = metadata_fields.get(reference.field_name.as_str()) else {
        return Err(WritePackagePlanError::UnknownField {
            message:
                "The final document contains a reference field that is not present in metadata."
                    .to_owned(),
            retryable: false,
            remediation: "Rebuild entity resolution against the active metadata snapshot."
                .to_owned(),
            field: safe_field_name(&reference.field_name),
            correlation_id: correlation_id(request),
        });
    };

    if metadata_field.is_reference || reference.field_name.ends_with("_Key") {
        validate_non_empty_reference_key(reference, request)?;
        return Ok(());
    }

    Err(WritePackagePlanError::MetadataMismatch {
        message: "The reference output field is not marked as a reference in metadata.".to_owned(),
        retryable: false,
        remediation: "Use a metadata reference field such as an OData *_Key field.".to_owned(),
        field: Some(safe_field_name(&reference.field_name)),
        correlation_id: correlation_id(request),
    })
}

fn validate_non_empty_reference_key(
    reference: &FinalDocumentReference,
    request: &WritePackageRequest,
) -> Result<(), WritePackagePlanError> {
    if !reference.target_key.trim().is_empty() {
        return Ok(());
    }

    Err(WritePackagePlanError::InvalidIdentifier {
        message: "A reference target key cannot be empty.".to_owned(),
        retryable: false,
        remediation: "Resolve the referenced 1C entity before planning a write package.".to_owned(),
        field: safe_field_name(&reference.field_name),
        correlation_id: correlation_id(request),
    })
}

fn insert_field(
    output: &mut BTreeMap<String, Value>,
    field_name: String,
    value: Value,
    request: &WritePackageRequest,
) -> Result<(), WritePackagePlanError> {
    use std::collections::btree_map::Entry;

    match output.entry(field_name) {
        Entry::Vacant(slot) => {
            slot.insert(value);
            Ok(())
        }
        Entry::Occupied(slot) => Err(WritePackagePlanError::DuplicateField {
            message: "The final document maps more than one value to the same output field."
                .to_owned(),
            retryable: false,
            remediation: "Resolve duplicate mapping outputs before planning a write package."
                .to_owned(),
            // slot.key() borrows the key already in the map; no clone needed.
            field: safe_field_name(slot.key()),
            correlation_id: correlation_id(request),
        }),
    }
}

fn validate_required_fields(
    metadata_fields: &BTreeMap<&str, &WritePackageMetadataField>,
    body: &BTreeMap<String, Value>,
    correlation_id: &str,
) -> Result<(), WritePackagePlanError> {
    for field in metadata_fields.values() {
        if field.is_key || field.nullable {
            continue;
        }

        let Some(value) = body.get(&field.name) else {
            return Err(WritePackagePlanError::MissingRequiredField {
                message: "The final document is missing a non-nullable metadata field.".to_owned(),
                retryable: false,
                remediation: "Complete required fields before planning a write package.".to_owned(),
                field: safe_field_name(&field.name),
                correlation_id: non_empty_string(correlation_id),
            });
        };

        if value.is_null() {
            return Err(WritePackagePlanError::MissingRequiredField {
                message: "The final document contains null for a non-nullable metadata field."
                    .to_owned(),
                retryable: false,
                remediation: "Complete required fields before planning a write package.".to_owned(),
                field: safe_field_name(&field.name),
                correlation_id: non_empty_string(correlation_id),
            });
        }
    }

    Ok(())
}

fn build_odata_artifact(
    request: &WritePackageRequest,
    body: &BTreeMap<String, Value>,
) -> Result<ODataRequestArtifact, WritePackagePlanError> {
    Ok(ODataRequestArtifact {
        method: ODataMethod::Post,
        relative_path: request.document.resource_name.clone(),
        query: ODataQuery {
            format: "json".to_owned(),
        },
        headers: ODataHeaders {
            accept: "application/json".to_owned(),
            content_type: "application/json".to_owned(),
        },
        body: body.clone(),
        body_hash: hash_json(body)?,
        will_execute: false,
        will_write_to_1c: false,
    })
}

fn build_local_json_artifact(
    request: &WritePackageRequest,
    body: &BTreeMap<String, Value>,
) -> Result<LocalJsonExportArtifact, WritePackagePlanError> {
    let mut references = request.document.references.clone();
    references.sort_by(|left, right| {
        left.field_name
            .cmp(&right.field_name)
            .then_with(|| left.name.cmp(&right.name))
    });
    references.dedup_by(|left, right| left.field_name == right.field_name);

    let package = LocalJsonExportPackage {
        format_version: JSON_FORMAT_VERSION,
        draft_id: request.document.draft_id.clone(),
        metadata_snapshot_id: request.document.metadata_snapshot_id.clone(),
        schema_hash: request.document.schema_hash.clone(),
        resource_name: request.document.resource_name.clone(),
        operation: WriteOperation::Create,
        fields: body.clone(),
        references,
        idempotency_key: request.document.idempotency_key.clone(),
    };

    Ok(LocalJsonExportArtifact {
        media_type: "application/json".to_owned(),
        file_name: format!(
            "{}.{}.json",
            safe_file_segment(&request.document.draft_id),
            safe_file_segment(&request.document.resource_name)
        ),
        package_hash: hash_json(&package)?,
        package,
        will_write_file: false,
        will_write_to_1c: false,
    })
}

fn artifact_hash(artifact: &WritePackageArtifact) -> Result<String, WritePackagePlanError> {
    hash_json(artifact)
}

fn hash_json(value: &impl Serialize) -> Result<String, WritePackagePlanError> {
    let json = serde_json::to_vec(value).map_err(|e| WritePackagePlanError::Internal {
        reason: format!("write package artifact serialization failed: {e}"),
    })?;
    let mut hasher = Sha256::new();
    hasher.update(json);
    Ok(lower_hex(&hasher.finalize()))
}

fn success_checks() -> Vec<WritePackageCheck> {
    vec![
        passed(
            WritePackageCheckCode::PayloadVersion,
            "Write package payload version is supported.",
        ),
        passed(
            WritePackageCheckCode::ApprovalStatus,
            "Draft approval gate passed.",
        ),
        passed(
            WritePackageCheckCode::ValidationStatus,
            "Draft validation gate passed.",
        ),
        passed(
            WritePackageCheckCode::RequiredIdentifiers,
            "Required write package identifiers are present.",
        ),
        passed(
            WritePackageCheckCode::OperationSupported,
            "Create operation is supported by Module 3.",
        ),
        passed(
            WritePackageCheckCode::MetadataResource,
            "Draft target resource matches metadata.",
        ),
        passed(
            WritePackageCheckCode::MetadataFields,
            "Mapped fields are present in metadata.",
        ),
        passed(
            WritePackageCheckCode::RequiredFields,
            "Non-nullable metadata fields are present.",
        ),
        passed(
            WritePackageCheckCode::SecretBoundary,
            "Planner input did not include secret-like material.",
        ),
        passed(
            WritePackageCheckCode::ExecutionBoundary,
            "Planner produced a non-executing artifact.",
        ),
    ]
}

fn passed(code: WritePackageCheckCode, message: &str) -> WritePackageCheck {
    WritePackageCheck {
        code,
        status: WritePackageCheckStatus::Passed,
        message: message.to_owned(),
        field: None,
        remediation: None,
    }
}

fn validate_secret_boundary(request: &WritePackageRequest) -> Result<(), WritePackagePlanError> {
    if request_contains_secret_like_fragment(request) {
        return Err(WritePackagePlanError::SecretMaterialRejected {
            message: "The write package request contains secret-like material.".to_owned(),
            retryable: false,
            remediation: "Remove credentials, tokens, endpoints with userinfo, and raw connection strings before planning."
                .to_owned(),
            // Never include correlation_id here: the correlation_id itself may
            // be the source of the secret that triggered this rejection.
            correlation_id: None,
        });
    }

    Ok(())
}

fn request_contains_secret_like_fragment(request: &WritePackageRequest) -> bool {
    [
        request.document.draft_id.as_str(),
        request.document.metadata_snapshot_id.as_str(),
        request.document.schema_hash.as_str(),
        request.document.resource_name.as_str(),
        request.document.idempotency_key.as_str(),
        request.document.correlation_id.as_str(),
        request.metadata_object.name.as_str(),
        request.metadata_object.resource_name.as_str(),
    ]
    .iter()
    .any(|value| contains_secret_like_fragment(value))
        || request.metadata_object.fields.iter().any(|field| {
            contains_secret_like_fragment(&field.name)
                || contains_secret_like_fragment(&field.type_name)
        })
        || request
            .metadata_object
            .keys
            .iter()
            .any(|key| contains_secret_like_fragment(key))
        || request.document.fields.iter().any(|field| {
            contains_secret_like_fragment(&field.name) || value_contains_secret(&field.value)
        })
        || request.document.references.iter().any(|reference| {
            contains_secret_like_fragment(&reference.name)
                || contains_secret_like_fragment(&reference.field_name)
                || contains_secret_like_fragment(&reference.target_key)
                || reference
                    .target_resource_name
                    .as_deref()
                    .is_some_and(contains_secret_like_fragment)
        })
}

fn value_contains_secret(value: &Value) -> bool {
    value_contains_secret_at(value, 0)
}

fn value_contains_secret_at(value: &Value, depth: usize) -> bool {
    if depth >= MAX_VALUE_SCAN_DEPTH {
        return true;
    }
    match value {
        Value::String(value) => contains_secret_like_fragment(value),
        Value::Array(values) => values
            .iter()
            .any(|v| value_contains_secret_at(v, depth + 1)),
        Value::Object(values) => values.iter().any(|(key, value)| {
            contains_secret_like_fragment(key) || value_contains_secret_at(value, depth + 1)
        }),
        _ => false,
    }
}

fn contains_secret_like_fragment(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    lower.contains(';')
        || (lower.contains("://") && lower.contains('@'))
        || lower.contains("authorization:")
        || lower.contains("bearer ")
        || lower.contains("api_key")
        || lower.contains("apikey")
        || lower.contains("secret=")
        || lower.contains("usr=")
        || lower.contains("user=")
        || lower.contains("pwd=")
        || lower.contains("password=")
        || lower.contains("token=")
        || lower.contains("access_token")
        || lower.contains("connectionstring=")
}

/// Maximum nesting depth for secret-value scanning in `value_contains_secret_at`.
const MAX_VALUE_SCAN_DEPTH: usize = 64;
/// Maximum nesting depth for canonical JSON normalization in `canonical_json_value_at`.
const MAX_CANONICAL_DEPTH: usize = 64;

fn canonical_json_value(
    value: &Value,
    field: &str,
    correlation_id: Option<&str>,
) -> Result<Value, WritePackagePlanError> {
    canonical_json_value_at(value, 0, field, correlation_id)
}

fn canonical_json_value_at(
    value: &Value,
    depth: usize,
    field: &str,
    correlation_id: Option<&str>,
) -> Result<Value, WritePackagePlanError> {
    if depth >= MAX_CANONICAL_DEPTH {
        return Err(WritePackagePlanError::MetadataMismatch {
            message: "A draft field value exceeds the supported JSON nesting depth.".to_owned(),
            retryable: false,
            remediation:
                "Reduce the nesting depth of field values before planning a write package."
                    .to_owned(),
            field: Some(safe_field_name(field)),
            correlation_id: correlation_id.and_then(non_empty_string),
        });
    }
    match value {
        Value::Array(values) => {
            let items = values
                .iter()
                .map(|v| canonical_json_value_at(v, depth + 1, field, correlation_id))
                .collect::<Result<Vec<_>, _>>()?;
            Ok(Value::Array(items))
        }
        Value::Object(values) => {
            let mut sorted = Map::new();
            let ordered = values.iter().collect::<BTreeMap<_, _>>();
            for (key, v) in ordered {
                sorted.insert(
                    key.clone(),
                    canonical_json_value_at(v, depth + 1, field, correlation_id)?,
                );
            }
            Ok(Value::Object(sorted))
        }
        _ => Ok(value.clone()),
    }
}

fn safe_file_segment(value: &str) -> String {
    let mut segment = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '_' | '-' | '.') {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();

    segment.truncate(MAX_SAFE_FILE_SEGMENT_CHARS);

    if segment.is_empty() {
        "write-package".to_owned()
    } else {
        segment
    }
}

fn safe_field_name(value: &str) -> String {
    if contains_secret_like_fragment(value) {
        "[redacted]".to_owned()
    } else {
        value.to_owned()
    }
}

fn correlation_id(request: &WritePackageRequest) -> Option<String> {
    non_empty_string(&request.document.correlation_id)
}

fn non_empty_string(value: &str) -> Option<String> {
    let trimmed = value.trim();

    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_owned())
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn request(target_kind: WriteTargetKind) -> WritePackageRequest {
        WritePackageRequest {
            payload_version: WRITE_PACKAGE_PAYLOAD_VERSION,
            target_kind,
            operation: WriteOperation::Create,
            document: FinalDocumentForWrite {
                draft_id: "draft-1".to_owned(),
                metadata_snapshot_id: "metadata-1".to_owned(),
                schema_hash: "schema-hash-1".to_owned(),
                resource_name: "Document_PurchaseInvoice".to_owned(),
                approval_status: WriteApprovalStatus::Approved,
                validation_status: WriteValidationStatus::Passed,
                fields: vec![
                    FinalDocumentField {
                        name: "Number".to_owned(),
                        value: Value::String("INV-1".to_owned()),
                    },
                    FinalDocumentField {
                        name: "Date".to_owned(),
                        value: Value::String("2026-05-28T10:00:00Z".to_owned()),
                    },
                ],
                references: vec![FinalDocumentReference {
                    name: "Counterparty".to_owned(),
                    field_name: "Counterparty_Key".to_owned(),
                    target_resource_name: Some("Catalog_Counterparties".to_owned()),
                    target_key: "41aa6331-954f-11e3-814b-005056c00008".to_owned(),
                }],
                idempotency_key: "idem-1".to_owned(),
                correlation_id: "corr-1".to_owned(),
            },
            metadata_object: WritePackageMetadataObject {
                name: "PurchaseInvoice".to_owned(),
                resource_name: "Document_PurchaseInvoice".to_owned(),
                fields: vec![
                    WritePackageMetadataField {
                        name: "Ref_Key".to_owned(),
                        type_name: "Edm.Guid".to_owned(),
                        nullable: false,
                        is_key: true,
                        is_reference: true,
                    },
                    WritePackageMetadataField {
                        name: "Number".to_owned(),
                        type_name: "Edm.String".to_owned(),
                        nullable: false,
                        is_key: false,
                        is_reference: false,
                    },
                    WritePackageMetadataField {
                        name: "Date".to_owned(),
                        type_name: "Edm.DateTimeOffset".to_owned(),
                        nullable: false,
                        is_key: false,
                        is_reference: false,
                    },
                    WritePackageMetadataField {
                        name: "Counterparty_Key".to_owned(),
                        type_name: "StandardODATA.CatalogRef.Counterparties".to_owned(),
                        nullable: false,
                        is_key: false,
                        is_reference: true,
                    },
                ],
                keys: vec!["Ref_Key".to_owned()],
            },
        }
    }

    fn serialized_error(error: &WritePackagePlanError) -> String {
        serde_json::to_string(error).expect("error should serialize")
    }

    #[test]
    fn approved_validated_draft_should_produce_fresh_odata_post_plan() {
        let plan =
            plan_write_package(request(WriteTargetKind::FreshOData)).expect("plan should build");

        let WritePackageArtifact::ODataRequest(artifact) = plan.artifact else {
            panic!("expected OData artifact");
        };

        assert_eq!(artifact.method, ODataMethod::Post);
        assert_eq!(artifact.relative_path, "Document_PurchaseInvoice");
        assert_eq!(artifact.query.format, "json");
        assert_eq!(
            artifact.body.get("Counterparty_Key"),
            Some(&Value::String(
                "41aa6331-954f-11e3-814b-005056c00008".to_owned()
            ))
        );
        assert!(!artifact.will_execute);
        assert!(!artifact.will_write_to_1c);
    }

    #[test]
    fn successful_plan_should_report_all_gates_as_passed() {
        let plan =
            plan_write_package(request(WriteTargetKind::FreshOData)).expect("plan should build");

        assert_eq!(plan.checks.len(), 10);
        assert!(plan
            .checks
            .iter()
            .all(|check| check.status == WritePackageCheckStatus::Passed));
    }

    #[test]
    fn approved_validated_draft_should_produce_local_json_export_plan() {
        let plan = plan_write_package(request(WriteTargetKind::LocalJsonExport))
            .expect("plan should build");

        let WritePackageArtifact::LocalJsonExport(artifact) = plan.artifact else {
            panic!("expected local JSON artifact");
        };

        assert_eq!(artifact.media_type, "application/json");
        assert_eq!(artifact.package.format_version, 1);
        assert_eq!(artifact.package.operation, WriteOperation::Create);
        assert_eq!(artifact.package.resource_name, "Document_PurchaseInvoice");
        assert!(!artifact.will_write_file);
        assert!(!artifact.will_write_to_1c);
    }

    #[test]
    fn unapproved_draft_should_fail() {
        let mut request = request(WriteTargetKind::FreshOData);
        request.document.approval_status = WriteApprovalStatus::Pending;
        let error = plan_write_package(request).expect_err("unapproved draft should fail");

        assert!(matches!(
            error,
            WritePackagePlanError::ApprovalRequired { .. }
        ));
    }

    #[test]
    fn failed_validation_should_fail() {
        let mut request = request(WriteTargetKind::FreshOData);
        request.document.validation_status = WriteValidationStatus::Failed;
        let error = plan_write_package(request).expect_err("failed validation should fail");

        assert!(matches!(
            error,
            WritePackagePlanError::ValidationRequired { .. }
        ));
    }

    #[test]
    fn warning_validation_should_fail_closed() {
        let mut request = request(WriteTargetKind::FreshOData);
        request.document.validation_status = WriteValidationStatus::Warning;
        let error = plan_write_package(request).expect_err("warning validation should fail");

        assert!(matches!(
            error,
            WritePackagePlanError::ValidationRequired { .. }
        ));
    }

    #[test]
    fn invalid_payload_version_should_fail() {
        let mut request = request(WriteTargetKind::FreshOData);
        request.payload_version = 2;
        let error = plan_write_package(request).expect_err("unsupported version should fail");

        assert!(matches!(
            error,
            WritePackagePlanError::InvalidPayloadVersion { .. }
        ));
    }

    #[test]
    fn generated_required_identifier_inputs_should_fail_closed() {
        type RequestMutation = fn(&mut WritePackageRequest);

        let cases: [(&str, RequestMutation); 6] = [
            ("draftId", |request| request.document.draft_id.clear()),
            ("metadataSnapshotId", |request| {
                request.document.metadata_snapshot_id = "   ".to_owned();
            }),
            ("schemaHash", |request| request.document.schema_hash.clear()),
            ("resourceName", |request| {
                request.document.resource_name.clear()
            }),
            ("idempotencyKey", |request| {
                request.document.idempotency_key = "   ".to_owned();
            }),
            ("correlationId", |request| {
                request.document.correlation_id.clear()
            }),
        ];

        for (field, mutate) in cases {
            let mut request = request(WriteTargetKind::FreshOData);
            mutate(&mut request);

            let error = plan_write_package(request).expect_err("empty identifier should fail");

            assert_eq!(
                error,
                WritePackagePlanError::InvalidIdentifier {
                    message: "A required write package identifier is empty.".to_owned(),
                    retryable: false,
                    remediation:
                        "Provide all required identifiers before planning a write package."
                            .to_owned(),
                    field: field.to_owned(),
                    correlation_id: if field == "correlationId" {
                        None
                    } else {
                        Some("corr-1".to_owned())
                    },
                }
            );
        }
    }

    #[test]
    fn unknown_resource_should_fail() {
        let mut request = request(WriteTargetKind::FreshOData);
        request.metadata_object.resource_name = "Document_SalesInvoice".to_owned();
        let error = plan_write_package(request).expect_err("resource mismatch should fail");

        assert!(matches!(
            error,
            WritePackagePlanError::MetadataMismatch { .. }
        ));
    }

    #[test]
    fn unsafe_resource_path_segments_should_fail_closed() {
        for resource_name in [
            "Document_PurchaseInvoice?$format=json",
            "../Document_PurchaseInvoice",
            "Document/PurchaseInvoice",
            "https://example.test/Document_PurchaseInvoice",
            "Document PurchaseInvoice",
        ] {
            let mut request = request(WriteTargetKind::FreshOData);
            request.document.resource_name = resource_name.to_owned();
            request.metadata_object.resource_name = resource_name.to_owned();

            let error =
                plan_write_package(request).expect_err("unsafe resource segment should fail");

            assert!(matches!(
                error,
                WritePackagePlanError::InvalidIdentifier { .. }
                    | WritePackagePlanError::SecretMaterialRejected { .. }
            ));
        }
    }

    #[test]
    fn unknown_field_should_fail() {
        let mut request = request(WriteTargetKind::FreshOData);
        request.document.fields.push(FinalDocumentField {
            name: "UnknownField".to_owned(),
            value: Value::String("value".to_owned()),
        });
        let error = plan_write_package(request).expect_err("unknown field should fail");

        assert!(matches!(error, WritePackagePlanError::UnknownField { .. }));
    }

    #[test]
    fn metadata_duplicate_field_names_should_fail() {
        let mut request = request(WriteTargetKind::FreshOData);
        request
            .metadata_object
            .fields
            .push(request.metadata_object.fields[1].clone());

        let error = plan_write_package(request).expect_err("duplicate metadata should fail");

        assert!(matches!(
            error,
            WritePackagePlanError::MetadataMismatch { .. }
        ));
    }

    #[test]
    fn metadata_duplicate_key_names_should_fail() {
        let mut request = request(WriteTargetKind::FreshOData);
        request.metadata_object.keys.push("Ref_Key".to_owned());

        let error = plan_write_package(request).expect_err("duplicate key should fail");

        assert!(matches!(
            error,
            WritePackagePlanError::MetadataMismatch { .. }
        ));
    }

    #[test]
    fn metadata_key_without_matching_field_should_fail() {
        let mut request = request(WriteTargetKind::FreshOData);
        request.metadata_object.keys = vec!["Missing_Key".to_owned()];

        let error = plan_write_package(request).expect_err("missing key field should fail");

        assert!(matches!(
            error,
            WritePackagePlanError::MetadataMismatch { .. }
        ));
    }

    #[test]
    fn missing_non_nullable_field_should_fail() {
        let mut request = request(WriteTargetKind::FreshOData);
        request
            .document
            .fields
            .retain(|field| field.name != "Number");
        let error = plan_write_package(request).expect_err("missing required field should fail");

        assert!(matches!(
            error,
            WritePackagePlanError::MissingRequiredField { .. }
        ));
    }

    #[test]
    fn null_non_nullable_field_should_fail() {
        let mut request = request(WriteTargetKind::FreshOData);
        let number = request
            .document
            .fields
            .iter_mut()
            .find(|field| field.name == "Number")
            .expect("Number field should exist");
        number.value = Value::Null;

        let error = plan_write_package(request).expect_err("null required field should fail");

        assert!(matches!(
            error,
            WritePackagePlanError::MissingRequiredField { .. }
        ));
    }

    #[test]
    fn unsupported_operation_should_fail() {
        for operation in [
            WriteOperation::Update,
            WriteOperation::Delete,
            WriteOperation::Post,
        ] {
            let mut request = request(WriteTargetKind::FreshOData);
            request.operation = operation;
            let error = plan_write_package(request).expect_err("operation should fail");

            assert!(matches!(
                error,
                WritePackagePlanError::UnsupportedOperation { .. }
            ));
        }
    }

    #[test]
    fn duplicate_output_field_should_fail() {
        let mut request = request(WriteTargetKind::FreshOData);
        request.document.fields.push(FinalDocumentField {
            name: "Counterparty_Key".to_owned(),
            value: Value::String("duplicate".to_owned()),
        });
        let error = plan_write_package(request).expect_err("duplicate output should fail");

        assert!(matches!(
            error,
            WritePackagePlanError::DuplicateField { .. }
        ));
    }

    #[test]
    fn reference_to_non_reference_field_should_fail() {
        let mut request = request(WriteTargetKind::FreshOData);
        request.document.references = vec![FinalDocumentReference {
            name: "NotAReference".to_owned(),
            field_name: "Number".to_owned(),
            target_resource_name: None,
            target_key: "value".to_owned(),
        }];

        let error = plan_write_package(request).expect_err("non-reference should fail");

        assert!(matches!(
            error,
            WritePackagePlanError::MetadataMismatch { .. }
        ));
    }

    #[test]
    fn empty_reference_key_should_fail() {
        let mut request = request(WriteTargetKind::FreshOData);
        request.document.references[0].target_key = "   ".to_owned();

        let error = plan_write_package(request).expect_err("empty target key should fail");

        assert!(matches!(
            error,
            WritePackagePlanError::InvalidIdentifier { .. }
        ));
    }

    #[test]
    fn secret_like_material_should_be_rejected_and_redacted() {
        let mut request = request(WriteTargetKind::FreshOData);
        request.document.fields.push(FinalDocumentField {
            name: "password=hunter2".to_owned(),
            value: Value::String("token=secret".to_owned()),
        });
        let error = plan_write_package(request).expect_err("secret-like payload should fail");
        let serialized = serialized_error(&error);

        assert!(matches!(
            error,
            WritePackagePlanError::SecretMaterialRejected { .. }
        ));
        assert!(!serialized.contains("hunter2"));
        assert!(!serialized.contains("token=secret"));
    }

    #[test]
    fn generated_secret_like_fragments_should_be_rejected() {
        for secret_marker in [
            "user=alice",
            "usr=alice",
            "pwd=hunter2",
            "password=hunter2",
            "token=abc123",
            "access_token=abc123",
            "api_key=abc123",
            "apikey=abc123",
            "authorization: bearer abc123",
            "bearer abc123",
            "secret=value",
            "connectionString=Server=example",
            "https://alice:secret@example.test/odata",
        ] {
            let mut request = request(WriteTargetKind::FreshOData);
            request.document.fields.push(FinalDocumentField {
                name: "Comment".to_owned(),
                value: Value::String(secret_marker.to_owned()),
            });

            let error = plan_write_package(request).expect_err("secret marker should fail");
            let serialized = serialized_error(&error);

            assert!(matches!(
                error,
                WritePackagePlanError::SecretMaterialRejected { .. }
            ));
            assert!(!serialized.contains(secret_marker));
        }
    }

    #[test]
    fn plain_url_field_value_should_not_be_rejected_as_secret() {
        let mut request = request(WriteTargetKind::FreshOData);
        request
            .metadata_object
            .fields
            .push(WritePackageMetadataField {
                name: "Website".to_owned(),
                type_name: "Edm.String".to_owned(),
                nullable: true,
                is_key: false,
                is_reference: false,
            });
        request.document.fields.push(FinalDocumentField {
            name: "Website".to_owned(),
            value: Value::String("https://example.com".to_owned()),
        });

        plan_write_package(request).expect("plain URL without credentials should be accepted");
    }

    #[test]
    fn correlation_id_should_not_leak_when_it_is_the_secret_source() {
        // If the correlation_id itself contains secret-like material, the
        // SecretMaterialRejected error must not echo it back in the response.
        let mut request = request(WriteTargetKind::FreshOData);
        request.document.correlation_id = "token=hunter2".to_owned();

        let error = plan_write_package(request).expect_err("secret correlation_id should fail");
        let serialized = serialized_error(&error);

        assert!(matches!(
            error,
            WritePackagePlanError::SecretMaterialRejected { .. }
        ));
        assert!(
            !serialized.contains("hunter2"),
            "secret must not appear in error: {serialized}"
        );
    }

    #[test]
    fn metadata_secret_like_material_should_be_rejected_and_redacted() {
        let mut request = request(WriteTargetKind::FreshOData);
        request.metadata_object.fields[0].name = "password=hunter2".to_owned();

        let error = plan_write_package(request).expect_err("metadata secret marker should fail");
        let serialized = serialized_error(&error);

        assert!(matches!(
            error,
            WritePackagePlanError::SecretMaterialRejected { .. }
        ));
        assert!(!serialized.contains("hunter2"));
    }

    #[test]
    fn repeated_equivalent_input_should_produce_identical_artifact_hashes() {
        let first = request(WriteTargetKind::LocalJsonExport);
        let mut second = request(WriteTargetKind::LocalJsonExport);
        second.document.fields.reverse();

        let first_plan = plan_write_package(first).expect("first plan should build");
        let second_plan = plan_write_package(second).expect("second plan should build");

        assert_eq!(first_plan.plan_id, second_plan.plan_id);
    }

    #[test]
    fn nested_json_object_order_should_not_change_artifact_hash() {
        let mut first = request(WriteTargetKind::LocalJsonExport);
        let mut second = request(WriteTargetKind::LocalJsonExport);

        first
            .metadata_object
            .fields
            .push(WritePackageMetadataField {
                name: "Attributes".to_owned(),
                type_name: "Edm.String".to_owned(),
                nullable: true,
                is_key: false,
                is_reference: false,
            });
        second
            .metadata_object
            .fields
            .push(WritePackageMetadataField {
                name: "Attributes".to_owned(),
                type_name: "Edm.String".to_owned(),
                nullable: true,
                is_key: false,
                is_reference: false,
            });

        let first_nested = serde_json::json!({
            "beta": [2, 1],
            "alpha": {
                "z": true,
                "a": false
            }
        });
        let second_nested = serde_json::json!({
            "alpha": {
                "a": false,
                "z": true
            },
            "beta": [2, 1]
        });

        first.document.fields.push(FinalDocumentField {
            name: "Attributes".to_owned(),
            value: first_nested,
        });
        second.document.fields.push(FinalDocumentField {
            name: "Attributes".to_owned(),
            value: second_nested,
        });

        let first_plan = plan_write_package(first).expect("first plan should build");
        let second_plan = plan_write_package(second).expect("second plan should build");

        assert_eq!(first_plan.plan_id, second_plan.plan_id);
    }

    #[test]
    fn local_json_file_name_should_be_sanitized_and_bounded() {
        let mut request = request(WriteTargetKind::LocalJsonExport);
        request.document.draft_id = format!("draft/{}", "x".repeat(200));

        let plan = plan_write_package(request).expect("plan should build");
        let WritePackageArtifact::LocalJsonExport(artifact) = plan.artifact else {
            panic!("expected local JSON artifact");
        };

        let draft_segment = artifact
            .file_name
            .split('.')
            .next()
            .expect("filename should have a draft segment");

        assert!(!artifact.file_name.contains('/'));
        assert!(draft_segment.len() <= MAX_SAFE_FILE_SEGMENT_CHARS);
    }
}
