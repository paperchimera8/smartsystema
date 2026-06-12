use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use thiserror::Error;
use url::Url;

const DEFAULT_TIMEOUT_MS: u64 = 10_000;
const MAX_TIMEOUT_MS: u64 = 120_000;
const MAX_RESPONSE_BYTES: usize = 16 * 1024 * 1024;
/// Number of hex characters from the schema hash used in `snapshot_id`.
const SNAPSHOT_ID_HASH_PREFIX_LEN: usize = 16;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScanMetadataRequest {
    pub endpoint: String,
    pub auth_ref: Option<String>,
    pub timeout_ms: Option<u64>,
    pub correlation_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MetadataSnapshot {
    pub snapshot_id: String,
    pub source: MetadataSource,
    pub collected_at_unix_ms: u128,
    pub schema_hash: String,
    pub objects: Vec<MetadataObject>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MetadataSource {
    pub endpoint: String,
    pub service_document_url: String,
    pub metadata_url: String,
    pub auth_ref: Option<String>,
    pub correlation_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MetadataObject {
    pub name: String,
    pub resource_name: String,
    pub object_kind: MetadataObjectKind,
    pub fields: Vec<MetadataField>,
    pub keys: Vec<String>,
    pub references: Vec<MetadataReference>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "kebab-case")]
pub enum MetadataObjectKind {
    Catalog,
    Document,
    InformationRegister,
    AccumulationRegister,
    AccountingRegister,
    Constant,
    Task,
    BusinessProcess,
    Unknown,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MetadataField {
    pub name: String,
    pub type_name: String,
    pub nullable: bool,
    pub is_key: bool,
    pub is_reference: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MetadataReference {
    pub name: String,
    pub target_type: String,
}

#[derive(Debug, Clone, Serialize, Error, PartialEq, Eq)]
#[serde(tag = "code", rename_all = "camelCase")]
pub enum MetadataScanError {
    #[error("OData endpoint is invalid.")]
    InvalidEndpoint { reason: String, remediation: String },
    #[error("Authentication reference is invalid.")]
    InvalidAuthRef { reason: String, remediation: String },
    #[error("Metadata scan timeout is invalid.")]
    InvalidTimeout { reason: String, remediation: String },
    #[error("OData service document request failed.")]
    ServiceDocumentUnavailable {
        status: Option<u16>,
        retryable: bool,
        remediation: String,
    },
    #[error("OData metadata request failed.")]
    MetadataUnavailable {
        status: Option<u16>,
        retryable: bool,
        remediation: String,
    },
    #[error("OData metadata XML could not be parsed.")]
    XmlParse { reason: String, remediation: String },
    #[error("OData metadata XML did not contain accessible 1C objects.")]
    EmptyMetadata { remediation: String },
    #[error("Internal metadata error: {reason}")]
    Internal { reason: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct NormalizedODataEndpoint {
    service_url: Url,
    metadata_url: Url,
}

#[derive(Debug, Clone)]
struct EntityBuilder {
    name: String,
    fields: Vec<FieldBuilder>,
    keys: BTreeSet<String>,
    references: Vec<MetadataReference>,
}

#[derive(Debug, Clone)]
struct FieldBuilder {
    name: String,
    type_name: String,
    nullable: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HashableSnapshot<'a> {
    objects: &'a [MetadataObject],
}

pub async fn scan_metadata(
    request: ScanMetadataRequest,
) -> Result<MetadataSnapshot, MetadataScanError> {
    let endpoint = normalize_endpoint(&request.endpoint)?;
    validate_auth_ref(request.auth_ref.as_deref())?;
    let timeout = timeout_from_request(request.timeout_ms)?;
    let client = Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|_| MetadataScanError::MetadataUnavailable {
            status: None,
            retryable: true,
            remediation: "Retry the metadata scan. If the issue persists, check the local agent network stack."
                .to_owned(),
        })?;

    get_bytes(
        &client,
        endpoint.service_url.clone(),
        MetadataRequestKind::ServiceDocument,
    )
    .await?;
    let metadata_xml = get_bytes(
        &client,
        endpoint.metadata_url.clone(),
        MetadataRequestKind::Metadata,
    )
    .await?;
    let metadata_xml =
        String::from_utf8(metadata_xml).map_err(|_| MetadataScanError::XmlParse {
            reason: "The OData $metadata response is not valid UTF-8.".to_owned(),
            remediation: "Check the 1C OData publication and retry the scan.".to_owned(),
        })?;

    build_snapshot_from_metadata_xml(
        &endpoint,
        request.auth_ref,
        request.correlation_id,
        &metadata_xml,
        unix_millis(),
    )
}

async fn get_bytes(
    client: &Client,
    url: Url,
    kind: MetadataRequestKind,
) -> Result<Vec<u8>, MetadataScanError> {
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|_| kind.unavailable(None, true))?;
    let status = response.status();

    if !status.is_success() {
        return Err(kind.unavailable(Some(status), status_is_retryable(status)));
    }

    if response
        .content_length()
        .is_some_and(|len| len > MAX_RESPONSE_BYTES as u64)
    {
        return Err(kind.response_too_large());
    }

    let mut body = Vec::with_capacity(
        response
            .content_length()
            .unwrap_or_default()
            .min(MAX_RESPONSE_BYTES as u64) as usize,
    );

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| kind.unavailable(None, true))?
    {
        let next_len = body
            .len()
            .checked_add(chunk.len())
            .ok_or_else(|| kind.response_too_large())?;

        if next_len > MAX_RESPONSE_BYTES {
            return Err(kind.response_too_large());
        }

        body.extend_from_slice(&chunk);
    }

    Ok(body)
}

fn build_snapshot_from_metadata_xml(
    endpoint: &NormalizedODataEndpoint,
    auth_ref: Option<String>,
    correlation_id: Option<String>,
    metadata_xml: &str,
    collected_at_unix_ms: u128,
) -> Result<MetadataSnapshot, MetadataScanError> {
    let (mut objects, mut warnings) = parse_metadata_objects(metadata_xml)?;

    if objects.is_empty() {
        return Err(MetadataScanError::EmptyMetadata {
            remediation: "Verify that the 1C OData publication exposes at least one metadata object to this user."
                .to_owned(),
        });
    }

    objects.sort_by(|left, right| {
        left.object_kind
            .cmp(&right.object_kind)
            .then_with(|| left.resource_name.cmp(&right.resource_name))
    });
    warnings.sort();
    warnings.dedup();

    let schema_hash = schema_hash(&objects)?;
    let snapshot_id = format!("metadata-{}", &schema_hash[..SNAPSHOT_ID_HASH_PREFIX_LEN]);

    Ok(MetadataSnapshot {
        snapshot_id,
        source: MetadataSource {
            endpoint: endpoint.service_url.to_string(),
            service_document_url: endpoint.service_url.to_string(),
            metadata_url: endpoint.metadata_url.to_string(),
            auth_ref,
            correlation_id,
        },
        collected_at_unix_ms,
        schema_hash,
        objects,
        warnings,
    })
}

fn parse_metadata_objects(
    metadata_xml: &str,
) -> Result<(Vec<MetadataObject>, Vec<String>), MetadataScanError> {
    let mut reader = Reader::from_str(metadata_xml);
    reader.config_mut().trim_text(true);

    let mut entity_builders = Vec::new();
    let mut current_entity: Option<EntityBuilder> = None;
    let mut entity_sets = BTreeMap::<String, String>::new();
    let mut in_key = false;

    loop {
        match reader.read_event() {
            Ok(Event::Start(event)) => {
                handle_start_event(&event, &mut current_entity, &mut entity_sets, &mut in_key)?;
            }
            Ok(Event::Empty(event)) => {
                handle_empty_event(
                    &event,
                    &mut current_entity,
                    &mut entity_sets,
                    in_key,
                    &mut entity_builders,
                )?;
            }
            Ok(Event::End(event)) => match local_name(event.name().as_ref()) {
                "EntityType" => {
                    if let Some(entity) = current_entity.take() {
                        entity_builders.push(entity);
                    }
                }
                "Key" => in_key = false,
                _ => {}
            },
            Ok(Event::Eof) => break,
            Err(_) => {
                return Err(MetadataScanError::XmlParse {
                    reason: "The OData $metadata response is not well-formed XML.".to_owned(),
                    remediation: "Check the 1C OData publication and retry the scan.".to_owned(),
                });
            }
            _ => {}
        }
    }

    let mut warnings = Vec::new();
    let mut objects = entity_builders
        .into_iter()
        .filter_map(|entity| build_metadata_object(entity, &entity_sets, &mut warnings))
        .collect::<Vec<_>>();

    objects.sort_by(|left, right| left.resource_name.cmp(&right.resource_name));

    Ok((objects, warnings))
}

fn handle_start_event(
    event: &BytesStart<'_>,
    current_entity: &mut Option<EntityBuilder>,
    entity_sets: &mut BTreeMap<String, String>,
    in_key: &mut bool,
) -> Result<(), MetadataScanError> {
    match local_name(event.name().as_ref()) {
        "EntityType" => {
            if let Some(name) = attribute(event, "Name")? {
                *current_entity = Some(EntityBuilder {
                    name,
                    fields: Vec::new(),
                    keys: BTreeSet::new(),
                    references: Vec::new(),
                });
            }
        }
        "Key" if current_entity.is_some() => *in_key = true,
        "PropertyRef" if *in_key => {
            if let (Some(entity), Some(name)) = (current_entity.as_mut(), attribute(event, "Name")?)
            {
                entity.keys.insert(name);
            }
        }
        "Property" => {
            if let Some(field) = field_from_event(event)? {
                if let Some(entity) = current_entity.as_mut() {
                    entity.fields.push(field);
                }
            }
        }
        "NavigationProperty" => {
            if let Some(reference) = reference_from_event(event)? {
                if let Some(entity) = current_entity.as_mut() {
                    entity.references.push(reference);
                }
            }
        }
        "EntitySet" => capture_entity_set(event, entity_sets)?,
        _ => {}
    }

    Ok(())
}

fn handle_empty_event(
    event: &BytesStart<'_>,
    current_entity: &mut Option<EntityBuilder>,
    entity_sets: &mut BTreeMap<String, String>,
    in_key: bool,
    entity_builders: &mut Vec<EntityBuilder>,
) -> Result<(), MetadataScanError> {
    match local_name(event.name().as_ref()) {
        "EntityType" => {
            if let Some(name) = attribute(event, "Name")? {
                entity_builders.push(EntityBuilder {
                    name,
                    fields: Vec::new(),
                    keys: BTreeSet::new(),
                    references: Vec::new(),
                });
            }
        }
        "PropertyRef" if in_key => {
            if let (Some(entity), Some(name)) = (current_entity.as_mut(), attribute(event, "Name")?)
            {
                entity.keys.insert(name);
            }
        }
        "Property" => {
            if let Some(field) = field_from_event(event)? {
                if let Some(entity) = current_entity.as_mut() {
                    entity.fields.push(field);
                }
            }
        }
        "NavigationProperty" => {
            if let Some(reference) = reference_from_event(event)? {
                if let Some(entity) = current_entity.as_mut() {
                    entity.references.push(reference);
                }
            }
        }
        "EntitySet" => capture_entity_set(event, entity_sets)?,
        _ => {}
    }

    Ok(())
}

fn capture_entity_set(
    event: &BytesStart<'_>,
    entity_sets: &mut BTreeMap<String, String>,
) -> Result<(), MetadataScanError> {
    let Some(name) = attribute(event, "Name")? else {
        return Ok(());
    };
    let Some(entity_type) = attribute(event, "EntityType")? else {
        return Ok(());
    };

    entity_sets.insert(type_tail(&entity_type).to_owned(), name);
    Ok(())
}

fn field_from_event(event: &BytesStart<'_>) -> Result<Option<FieldBuilder>, MetadataScanError> {
    let Some(name) = attribute(event, "Name")? else {
        return Ok(None);
    };
    let Some(type_name) = attribute(event, "Type")? else {
        return Ok(None);
    };
    let nullable = attribute(event, "Nullable")?
        .map(|value| !value.eq_ignore_ascii_case("false"))
        .unwrap_or(true);

    Ok(Some(FieldBuilder {
        name,
        type_name: normalize_type_name(&type_name),
        nullable,
    }))
}

fn reference_from_event(
    event: &BytesStart<'_>,
) -> Result<Option<MetadataReference>, MetadataScanError> {
    let Some(name) = attribute(event, "Name")? else {
        return Ok(None);
    };
    let Some(target_type) = attribute(event, "Type")? else {
        return Ok(None);
    };

    Ok(Some(MetadataReference {
        name,
        target_type: normalize_type_name(&target_type),
    }))
}

fn build_metadata_object(
    entity: EntityBuilder,
    entity_sets: &BTreeMap<String, String>,
    warnings: &mut Vec<String>,
) -> Option<MetadataObject> {
    let resource_name = entity_sets
        .get(&entity.name)
        .cloned()
        .unwrap_or_else(|| entity.name.clone());
    let object_kind = classify_object_kind(&resource_name)
        .or_else(|| classify_object_kind(&entity.name))
        .unwrap_or(MetadataObjectKind::Unknown);

    let has_entity_set = entity_sets.contains_key(&entity.name);

    if object_kind == MetadataObjectKind::Unknown && !has_entity_set {
        return None;
    }

    if !has_entity_set {
        warnings.push(format!(
            "Entity type {name} is not referenced by an EntitySet; included as a classifiable 1C object.",
            name = entity.name
        ));
    }

    // BTreeSet already yields sorted unique elements; move it directly into
    // key_lookup to avoid the BTreeSet→Vec→sort→dedup→BTreeSet round-trip.
    let key_lookup = entity.keys;
    let keys: Vec<String> = key_lookup.iter().cloned().collect();

    let mut fields = entity
        .fields
        .into_iter()
        .map(|field| {
            let is_key = key_lookup.contains(&field.name);
            MetadataField {
                is_reference: is_reference_field(&field.name, &field.type_name, is_key),
                name: field.name,
                type_name: field.type_name,
                nullable: field.nullable,
                is_key,
            }
        })
        .collect::<Vec<_>>();
    fields.sort_by(|left, right| left.name.cmp(&right.name));
    fields.dedup_by(|left, right| left.name == right.name);

    let mut references = entity.references;
    references.sort_by(|left, right| left.name.cmp(&right.name));
    references.dedup_by(|left, right| left.name == right.name);

    Some(MetadataObject {
        name: object_name(&resource_name),
        resource_name,
        object_kind,
        fields,
        keys,
        references,
    })
}

fn normalize_endpoint(value: &str) -> Result<NormalizedODataEndpoint, MetadataScanError> {
    let trimmed = value.trim();

    if trimmed.is_empty() {
        return Err(invalid_endpoint(
            "Endpoint cannot be empty.",
            "Provide the 1C OData service root URL.",
        ));
    }

    if contains_secret_like_fragment(trimmed) {
        return Err(invalid_endpoint(
            "Endpoint appears to contain credentials or token-like material.",
            "Provide only the OData service root. Store credentials in secure local storage.",
        ));
    }

    let mut service_url = Url::parse(trimmed).map_err(|_| {
        invalid_endpoint(
            "Endpoint is not a valid URL.",
            "Provide a valid http:// or https:// OData service root URL.",
        )
    })?;

    if !matches!(service_url.scheme(), "http" | "https") {
        return Err(invalid_endpoint(
            "Endpoint must use http or https.",
            "Provide a valid http:// or https:// OData service root URL.",
        ));
    }

    if !service_url.username().is_empty() || service_url.password().is_some() {
        return Err(invalid_endpoint(
            "Endpoint must not include username or password components.",
            "Provide only the OData service root. Store credentials in secure local storage.",
        ));
    }

    if service_url.query().is_some() || service_url.fragment().is_some() {
        return Err(invalid_endpoint(
            "Endpoint must not include query strings or fragments.",
            "Provide the clean OData service root URL.",
        ));
    }

    let normalized_path = normalized_service_path(service_url.path());
    service_url.set_path(&normalized_path);

    let metadata_url = service_url.join("$metadata").map_err(|_| {
        invalid_endpoint("Endpoint could not be normalized.", "Check the URL path.")
    })?;

    Ok(NormalizedODataEndpoint {
        service_url,
        metadata_url,
    })
}

fn normalized_service_path(path: &str) -> String {
    let without_trailing = path.trim_end_matches('/');

    // strip_suffix is panic-free regardless of the path encoding, unlike
    // truncate(len - suffix_len) which panics on non-char boundaries.
    let base = if let Some(s) = without_trailing.strip_suffix("/$metadata") {
        s
    } else if without_trailing == "$metadata" {
        ""
    } else {
        without_trailing
    };

    if base.is_empty() {
        "/".to_owned()
    } else {
        format!("{}/", base.trim_end_matches('/'))
    }
}

fn validate_auth_ref(auth_ref: Option<&str>) -> Result<(), MetadataScanError> {
    let Some(auth_ref) = auth_ref else {
        return Ok(());
    };
    let trimmed = auth_ref.trim();

    if trimmed.is_empty() {
        return Err(MetadataScanError::InvalidAuthRef {
            reason: "authRef cannot be empty when provided.".to_owned(),
            remediation: "Omit authRef or provide an opaque secure credential reference."
                .to_owned(),
        });
    }

    if contains_secret_like_fragment(trimmed) {
        return Err(MetadataScanError::InvalidAuthRef {
            reason: "authRef appears to contain secret material.".to_owned(),
            remediation: "Use an opaque secure-storage reference, not a credential value."
                .to_owned(),
        });
    }

    Ok(())
}

fn timeout_from_request(timeout_ms: Option<u64>) -> Result<Duration, MetadataScanError> {
    let timeout_ms = timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS);

    if timeout_ms == 0 || timeout_ms > MAX_TIMEOUT_MS {
        return Err(MetadataScanError::InvalidTimeout {
            reason: format!("timeoutMs must be between 1 and {MAX_TIMEOUT_MS}."),
            remediation: "Use a bounded timeout to avoid hanging the local agent.".to_owned(),
        });
    }

    Ok(Duration::from_millis(timeout_ms))
}

fn classify_object_kind(name: &str) -> Option<MetadataObjectKind> {
    [
        (
            "InformationRegister_",
            MetadataObjectKind::InformationRegister,
        ),
        (
            "AccumulationRegister_",
            MetadataObjectKind::AccumulationRegister,
        ),
        (
            "AccountingRegister_",
            MetadataObjectKind::AccountingRegister,
        ),
        ("BusinessProcess_", MetadataObjectKind::BusinessProcess),
        ("Catalog_", MetadataObjectKind::Catalog),
        ("Document_", MetadataObjectKind::Document),
        ("Constant_", MetadataObjectKind::Constant),
        ("Task_", MetadataObjectKind::Task),
    ]
    .iter()
    .find_map(|(prefix, kind)| name.starts_with(prefix).then_some(*kind))
}

fn object_name(resource_name: &str) -> String {
    resource_name
        .split_once('_')
        .map_or(resource_name, |(_, name)| name)
        .to_owned()
}

fn is_reference_field(name: &str, type_name: &str, is_key: bool) -> bool {
    is_key
        || name.ends_with("_Key")
        || type_name.contains("Ref.")
        || type_name.contains("CatalogRef.")
        || type_name.contains("DocumentRef.")
}

fn schema_hash(objects: &[MetadataObject]) -> Result<String, MetadataScanError> {
    let hashable = HashableSnapshot { objects };
    let json = serde_json::to_vec(&hashable).map_err(|e| MetadataScanError::Internal {
        reason: format!("metadata snapshot serialization failed: {e}"),
    })?;
    let mut hasher = Sha256::new();
    hasher.update(json);
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

fn attribute(event: &BytesStart<'_>, name: &str) -> Result<Option<String>, MetadataScanError> {
    for attribute in event.attributes().with_checks(false) {
        let attribute = attribute.map_err(|_| MetadataScanError::XmlParse {
            reason: "An XML attribute could not be parsed.".to_owned(),
            remediation: "Check the 1C OData publication and retry the scan.".to_owned(),
        })?;

        if local_name(attribute.key.as_ref()) == name {
            let value = std::str::from_utf8(attribute.value.as_ref()).map_err(|_| {
                MetadataScanError::XmlParse {
                    reason: "An XML attribute value is not valid UTF-8.".to_owned(),
                    remediation: "Check the 1C OData publication and retry the scan.".to_owned(),
                }
            })?;
            return Ok(Some(unescape_basic_xml(value)));
        }
    }

    Ok(None)
}

fn local_name(name: &[u8]) -> &str {
    // XML element names must be valid UTF-8; the empty-string fallback is
    // intentional: malformed names miss all match arms and hit `_ => {}`
    // rather than panicking, preserving fail-open XML scanning.
    let value = std::str::from_utf8(name).unwrap_or("");
    value.rsplit_once(':').map_or(value, |(_, local)| local)
}

fn normalize_type_name(type_name: &str) -> String {
    let mut current = type_name.trim();

    loop {
        match current
            .strip_prefix("Collection(")
            .and_then(|v| v.strip_suffix(')'))
        {
            Some(inner) => current = inner.trim(),
            None => return current.to_owned(),
        }
    }
}

fn type_tail(type_name: &str) -> &str {
    // rsplit_once returns None when there is no '.', in which case the full
    // name is already the tail (e.g. "Catalog_Counterparties" with no namespace).
    type_name
        .rsplit_once('.')
        .map_or(type_name, |(_, tail)| tail)
}

fn contains_secret_like_fragment(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    lower.contains(';')
        || (lower.contains("://") && lower.contains('@'))
        || lower.contains("api_key")
        || lower.contains("authorization:")
        || lower.contains("bearer ")
        || lower.contains("secret=")
        || lower.contains("usr=")
        || lower.contains("user=")
        || lower.contains("pwd=")
        || lower.contains("password=")
        || lower.contains("token=")
        || lower.contains("access_token")
        || lower.contains("connectionstring=")
}

fn unescape_basic_xml(value: &str) -> String {
    value
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

fn invalid_endpoint(reason: &str, remediation: &str) -> MetadataScanError {
    MetadataScanError::InvalidEndpoint {
        reason: reason.to_owned(),
        remediation: remediation.to_owned(),
    }
}

fn status_is_retryable(status: StatusCode) -> bool {
    status.is_server_error()
        || status == StatusCode::REQUEST_TIMEOUT
        || status == StatusCode::TOO_MANY_REQUESTS
}

fn unix_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

#[derive(Debug, Clone, Copy)]
enum MetadataRequestKind {
    ServiceDocument,
    Metadata,
}

impl MetadataRequestKind {
    fn unavailable(self, status: Option<StatusCode>, retryable: bool) -> MetadataScanError {
        match self {
            Self::ServiceDocument => MetadataScanError::ServiceDocumentUnavailable {
                status: status.map(|status| status.as_u16()),
                retryable,
                remediation:
                    "Verify that the OData service root is published and reachable from this workstation."
                        .to_owned(),
            },
            Self::Metadata => MetadataScanError::MetadataUnavailable {
                status: status.map(|status| status.as_u16()),
                retryable,
                remediation:
                    "Verify that the OData $metadata endpoint is published and accessible to this user."
                        .to_owned(),
            },
        }
    }

    fn response_too_large(self) -> MetadataScanError {
        match self {
            Self::ServiceDocument => MetadataScanError::ServiceDocumentUnavailable {
                status: None,
                retryable: false,
                remediation:
                    "The OData service document response exceeded the 16 MB size limit. Contact your 1C administrator."
                        .to_owned(),
            },
            Self::Metadata => MetadataScanError::MetadataUnavailable {
                status: None,
                retryable: false,
                remediation:
                    "The OData $metadata response exceeded the 16 MB size limit. Reduce the number of published objects or contact your 1C administrator."
                        .to_owned(),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    const SAMPLE_METADATA: &str = r#"
<?xml version="1.0" encoding="UTF-8"?>
<edmx:Edmx xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
  <edmx:DataServices>
    <Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="StandardODATA">
      <EntityType Name="Catalog_Counterparties">
        <Key>
          <PropertyRef Name="Ref_Key" />
        </Key>
        <Property Name="Ref_Key" Type="Edm.Guid" Nullable="false" />
        <Property Name="Description" Type="Edm.String" Nullable="true" />
        <Property Name="INN" Type="Edm.String" />
        <NavigationProperty Name="Owner" Type="StandardODATA.CatalogRef_Organizations" />
      </EntityType>
      <EntityType Name="Document_PurchaseInvoice">
        <Key><PropertyRef Name="Ref_Key" /></Key>
        <Property Name="Ref_Key" Type="Edm.Guid" Nullable="false" />
        <Property Name="Number" Type="Edm.String" Nullable="false" />
        <Property Name="Date" Type="Edm.DateTimeOffset" Nullable="false" />
        <Property Name="Counterparty_Key" Type="StandardODATA.CatalogRef.Counterparties" Nullable="false" />
        <NavigationProperty Name="Counterparty" Type="StandardODATA.Catalog_Counterparties" />
      </EntityType>
      <EntityType Name="InformationRegister_Prices">
        <Key><PropertyRef Name="Recorder" /></Key>
        <Property Name="Recorder" Type="Edm.Guid" Nullable="false" />
        <Property Name="Price" Type="Edm.Decimal" Nullable="false" />
      </EntityType>
      <EntityType Name="Constant_MainOrganization">
        <Key><PropertyRef Name="Name" /></Key>
        <Property Name="Name" Type="Edm.String" Nullable="false" />
        <Property Name="Value" Type="StandardODATA.CatalogRef.Organizations" />
      </EntityType>
      <EntityContainer Name="Container">
        <EntitySet Name="Catalog_Counterparties" EntityType="StandardODATA.Catalog_Counterparties" />
        <EntitySet Name="Document_PurchaseInvoice" EntityType="StandardODATA.Document_PurchaseInvoice" />
        <EntitySet Name="InformationRegister_Prices" EntityType="StandardODATA.InformationRegister_Prices" />
        <EntitySet Name="Constant_MainOrganization" EntityType="StandardODATA.Constant_MainOrganization" />
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>
"#;

    const SAMPLE_METADATA_REORDERED_ATTRIBUTES: &str = r#"
<edmx:Edmx xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
  <edmx:DataServices>
    <Schema Namespace="StandardODATA" xmlns="http://docs.oasis-open.org/odata/ns/edm">
      <EntityType Name="Catalog_Counterparties">
        <Key><PropertyRef Name="Ref_Key"/></Key>
        <Property Nullable="false" Type="Edm.Guid" Name="Ref_Key"/>
        <Property Nullable="true" Type="Edm.String" Name="Description"/>
        <Property Type="Edm.String" Name="INN"/>
        <NavigationProperty Type="StandardODATA.CatalogRef_Organizations" Name="Owner"/>
      </EntityType>
      <EntityType Name="Document_PurchaseInvoice">
        <Key><PropertyRef Name="Ref_Key"/></Key>
        <Property Type="Edm.Guid" Name="Ref_Key" Nullable="false"/>
        <Property Nullable="false" Name="Number" Type="Edm.String"/>
        <Property Name="Date" Nullable="false" Type="Edm.DateTimeOffset"/>
        <Property Nullable="false" Name="Counterparty_Key" Type="StandardODATA.CatalogRef.Counterparties"/>
        <NavigationProperty Type="StandardODATA.Catalog_Counterparties" Name="Counterparty"/>
      </EntityType>
      <EntityType Name="InformationRegister_Prices">
        <Key><PropertyRef Name="Recorder"/></Key>
        <Property Nullable="false" Type="Edm.Guid" Name="Recorder"/>
        <Property Nullable="false" Type="Edm.Decimal" Name="Price"/>
      </EntityType>
      <EntityType Name="Constant_MainOrganization">
        <Key><PropertyRef Name="Name"/></Key>
        <Property Type="Edm.String" Nullable="false" Name="Name"/>
        <Property Type="StandardODATA.CatalogRef.Organizations" Name="Value"/>
      </EntityType>
      <EntityContainer Name="Container">
        <EntitySet EntityType="StandardODATA.Constant_MainOrganization" Name="Constant_MainOrganization"/>
        <EntitySet EntityType="StandardODATA.InformationRegister_Prices" Name="InformationRegister_Prices"/>
        <EntitySet EntityType="StandardODATA.Document_PurchaseInvoice" Name="Document_PurchaseInvoice"/>
        <EntitySet EntityType="StandardODATA.Catalog_Counterparties" Name="Catalog_Counterparties"/>
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>
"#;

    fn endpoint() -> NormalizedODataEndpoint {
        normalize_endpoint("https://example.test/Accounting/odata/standard.odata/")
            .expect("test endpoint should normalize")
    }

    fn snapshot(xml: &str) -> MetadataSnapshot {
        build_snapshot_from_metadata_xml(&endpoint(), None, None, xml, 1)
            .expect("sample metadata should parse")
    }

    fn serialized_error(error: &MetadataScanError) -> String {
        serde_json::to_string(error).expect("error should serialize for testing")
    }

    fn spawn_http_response(status_line: &str, body: &'static [u8]) -> Url {
        spawn_http_response_with_content_length(status_line, body.len(), body)
    }

    fn spawn_http_response_with_content_length(
        status_line: &str,
        content_length: usize,
        body: &'static [u8],
    ) -> Url {
        let listener =
            TcpListener::bind("127.0.0.1:0").expect("test HTTP listener should bind locally");
        let address = listener
            .local_addr()
            .expect("test HTTP listener should expose local address");
        let status_line = status_line.to_owned();

        thread::spawn(move || {
            let (mut stream, _) = listener
                .accept()
                .expect("test HTTP listener should accept one request");
            let mut request_buffer = [0_u8; 1024];
            let _ = stream.read(&mut request_buffer);
            let response = format!(
                "HTTP/1.1 {status_line}\r\nContent-Length: {content_length}\r\nConnection: close\r\n\r\n",
            );
            stream
                .write_all(response.as_bytes())
                .expect("test HTTP response headers should be written");
            stream
                .write_all(body)
                .expect("test HTTP response body should be written");
        });

        Url::parse(&format!("http://{address}/odata/")).expect("test URL should parse")
    }

    fn spawn_http_sequence(responses: Vec<(&'static str, &'static [u8])>) -> Url {
        let listener =
            TcpListener::bind("127.0.0.1:0").expect("test HTTP listener should bind locally");
        let address = listener
            .local_addr()
            .expect("test HTTP listener should expose local address");

        thread::spawn(move || {
            for (status_line, body) in responses {
                let (mut stream, _) = listener
                    .accept()
                    .expect("test HTTP listener should accept request");
                let mut request_buffer = [0_u8; 1024];
                let _ = stream.read(&mut request_buffer);
                let response = format!(
                    "HTTP/1.1 {status_line}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                stream
                    .write_all(response.as_bytes())
                    .expect("test HTTP response headers should be written");
                stream
                    .write_all(body)
                    .expect("test HTTP response body should be written");
            }
        });

        Url::parse(&format!("http://{address}/odata/standard.odata/"))
            .expect("test URL should parse")
    }

    #[test]
    fn endpoint_should_normalize_service_root_and_metadata_url() {
        let endpoint =
            normalize_endpoint("https://example.test/base/odata/standard.odata/$metadata")
                .expect("endpoint should normalize");

        assert_eq!(
            endpoint.service_url.as_str(),
            "https://example.test/base/odata/standard.odata/"
        );
        assert_eq!(
            endpoint.metadata_url.as_str(),
            "https://example.test/base/odata/standard.odata/$metadata"
        );
    }

    #[test]
    fn endpoint_normalization_should_be_idempotent_for_service_roots() {
        let inputs = [
            "https://example.test/base/odata/standard.odata",
            "https://example.test/base/odata/standard.odata/",
            "https://example.test/base/odata/standard.odata/$metadata",
            " https://example.test/base/odata/standard.odata/$metadata ",
        ];

        for input in inputs {
            let first = normalize_endpoint(input).expect("endpoint should normalize");
            let second =
                normalize_endpoint(first.service_url.as_str()).expect("endpoint should normalize");

            assert_eq!(first, second);
        }
    }

    #[test]
    fn endpoint_should_reject_empty_value() {
        let error = normalize_endpoint(" ").expect_err("empty endpoint should fail");

        assert!(matches!(error, MetadataScanError::InvalidEndpoint { .. }));
    }

    #[test]
    fn endpoint_should_reject_malformed_url() {
        let error = normalize_endpoint("not a url").expect_err("malformed endpoint should fail");

        assert!(matches!(error, MetadataScanError::InvalidEndpoint { .. }));
    }

    #[test]
    fn endpoint_should_reject_non_http_scheme() {
        let error = normalize_endpoint("file:///tmp/metadata.xml")
            .expect_err("non-http endpoint should fail");

        assert!(matches!(error, MetadataScanError::InvalidEndpoint { .. }));
    }

    #[test]
    fn endpoint_should_reject_username_and_password() {
        let error = normalize_endpoint("https://alice:hunter2@example.test/odata/")
            .expect_err("credential-bearing endpoint should fail");
        let serialized = serialized_error(&error);

        assert!(matches!(error, MetadataScanError::InvalidEndpoint { .. }));
        assert!(!serialized.contains("alice"));
        assert!(!serialized.contains("hunter2"));
    }

    #[test]
    fn endpoint_should_reject_token_query() {
        let error = normalize_endpoint("https://example.test/odata/?token=secret")
            .expect_err("token endpoint should fail");
        let serialized = serialized_error(&error);

        assert!(matches!(error, MetadataScanError::InvalidEndpoint { .. }));
        assert!(!serialized.contains("secret"));
    }

    #[test]
    fn endpoint_should_reject_generated_secret_like_fragments() {
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
            "https://user:pass@example.test/odata/",
        ];

        for marker in markers {
            assert!(
                contains_secret_like_fragment(marker),
                "marker should be classified as credential-like: {marker}"
            );
        }
    }

    #[test]
    fn auth_ref_should_reject_secret_like_values() {
        let error = validate_auth_ref(Some("password=hunter2"))
            .expect_err("secret-like authRef should fail");
        let serialized = serialized_error(&error);

        assert!(matches!(error, MetadataScanError::InvalidAuthRef { .. }));
        assert!(!serialized.contains("hunter2"));
    }

    #[test]
    fn auth_ref_should_accept_opaque_secure_reference_values() {
        for auth_ref in [
            "keyring:profile-1",
            "stronghold:tenant-profile",
            "profile_123",
        ] {
            validate_auth_ref(Some(auth_ref)).expect("opaque authRef should pass");
        }
    }

    #[test]
    fn timeout_should_reject_zero_and_unbounded_values() {
        let zero = timeout_from_request(Some(0)).expect_err("zero timeout should fail");
        let unbounded =
            timeout_from_request(Some(MAX_TIMEOUT_MS + 1)).expect_err("large timeout should fail");

        assert!(matches!(zero, MetadataScanError::InvalidTimeout { .. }));
        assert!(matches!(
            unbounded,
            MetadataScanError::InvalidTimeout { .. }
        ));
    }

    #[test]
    fn timeout_should_accept_documented_bounds() {
        assert_eq!(
            timeout_from_request(None).expect("default timeout should pass"),
            Duration::from_millis(DEFAULT_TIMEOUT_MS)
        );
        assert_eq!(
            timeout_from_request(Some(1)).expect("minimum timeout should pass"),
            Duration::from_millis(1)
        );
        assert_eq!(
            timeout_from_request(Some(MAX_TIMEOUT_MS)).expect("maximum timeout should pass"),
            Duration::from_millis(MAX_TIMEOUT_MS)
        );
    }

    #[test]
    fn parser_should_extract_objects_fields_keys_and_references() {
        let snapshot = snapshot(SAMPLE_METADATA);

        assert_eq!(snapshot.objects.len(), 4);
        let document = snapshot
            .objects
            .iter()
            .find(|object| object.resource_name == "Document_PurchaseInvoice")
            .expect("document object should exist");
        let counterparty_field = document
            .fields
            .iter()
            .find(|field| field.name == "Counterparty_Key")
            .expect("reference field should exist");

        assert_eq!(document.object_kind, MetadataObjectKind::Document);
        assert_eq!(document.keys, vec!["Ref_Key"]);
        assert!(counterparty_field.is_reference);
        assert!(!counterparty_field.nullable);
        assert_eq!(document.references[0].name, "Counterparty");
    }

    #[test]
    fn parser_should_deduplicate_fields_keys_references_and_keep_sorted_output() {
        let metadata = r#"
<edmx:Edmx xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
  <edmx:DataServices>
    <Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="StandardODATA">
      <EntityType Name="Catalog_Items">
        <Key>
          <PropertyRef Name="Ref_Key" />
          <PropertyRef Name="Ref_Key" />
        </Key>
        <Property Name="Description" Type="Edm.String" />
        <Property Name="Ref_Key" Type="Edm.Guid" Nullable="false" />
        <Property Name="Description" Type="Edm.String" />
        <NavigationProperty Name="Owner" Type="Collection(StandardODATA.Catalog_Organizations)" />
        <NavigationProperty Name="Owner" Type="StandardODATA.Catalog_Organizations" />
      </EntityType>
      <EntityContainer Name="Container">
        <EntitySet Name="Catalog_Items" EntityType="StandardODATA.Catalog_Items" />
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>
"#;

        let snapshot = snapshot(metadata);
        let object = snapshot
            .objects
            .first()
            .expect("catalog object should be parsed");
        let field_names = object
            .fields
            .iter()
            .map(|field| field.name.as_str())
            .collect::<Vec<_>>();

        assert_eq!(object.keys, vec!["Ref_Key"]);
        assert_eq!(field_names, vec!["Description", "Ref_Key"]);
        assert_eq!(object.references.len(), 1);
        assert_eq!(
            object.references[0].target_type,
            "StandardODATA.Catalog_Organizations"
        );
    }

    #[test]
    fn parser_should_include_classifiable_entity_without_entity_set_with_warning() {
        let metadata = r#"
<edmx:Edmx xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
  <edmx:DataServices>
    <Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="StandardODATA">
      <EntityType Name="Document_UnpublishedButClassifiable">
        <Key><PropertyRef Name="Ref_Key" /></Key>
        <Property Name="Ref_Key" Type="Edm.Guid" Nullable="false" />
      </EntityType>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>
"#;

        let snapshot = snapshot(metadata);

        assert_eq!(snapshot.objects.len(), 1);
        assert_eq!(
            snapshot.objects[0].resource_name,
            "Document_UnpublishedButClassifiable"
        );
        assert_eq!(snapshot.warnings.len(), 1);
        assert!(snapshot.warnings[0].contains("Entity type Document_UnpublishedButClassifiable"));
    }

    #[test]
    fn parser_should_skip_unknown_entity_without_entity_set() {
        let error = build_snapshot_from_metadata_xml(
            &endpoint(),
            None,
            None,
            r#"
<edmx:Edmx xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
  <edmx:DataServices>
    <Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="StandardODATA">
      <EntityType Name="HelperType">
        <Property Name="Value" Type="Edm.String" />
      </EntityType>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>
"#,
            1,
        )
        .expect_err("unknown helper-only metadata should be empty");

        assert!(matches!(error, MetadataScanError::EmptyMetadata { .. }));
    }

    #[test]
    fn parser_should_classify_1c_resource_prefixes() {
        let snapshot = snapshot(SAMPLE_METADATA);
        let kinds = snapshot
            .objects
            .iter()
            .map(|object| (object.resource_name.as_str(), object.object_kind))
            .collect::<BTreeMap<_, _>>();

        assert_eq!(
            kinds.get("Catalog_Counterparties"),
            Some(&MetadataObjectKind::Catalog)
        );
        assert_eq!(
            kinds.get("InformationRegister_Prices"),
            Some(&MetadataObjectKind::InformationRegister)
        );
        assert_eq!(
            kinds.get("Constant_MainOrganization"),
            Some(&MetadataObjectKind::Constant)
        );
        assert_eq!(
            classify_object_kind("AccumulationRegister_Sales"),
            Some(MetadataObjectKind::AccumulationRegister)
        );
        assert_eq!(
            classify_object_kind("AccountingRegister_Ledger"),
            Some(MetadataObjectKind::AccountingRegister)
        );
        assert_eq!(
            classify_object_kind("BusinessProcess_Approval"),
            Some(MetadataObjectKind::BusinessProcess)
        );
        assert_eq!(
            classify_object_kind("Task_Review"),
            Some(MetadataObjectKind::Task)
        );
    }

    #[test]
    fn schema_hash_should_be_stable_for_equivalent_metadata() {
        let first = snapshot(SAMPLE_METADATA);
        let second = snapshot(SAMPLE_METADATA_REORDERED_ATTRIBUTES);

        assert_eq!(first.schema_hash, second.schema_hash);
    }

    #[test]
    fn snapshot_should_sort_warnings_and_objects_deterministically() {
        let metadata = r#"
<edmx:Edmx xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
  <edmx:DataServices>
    <Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="StandardODATA">
      <EntityType Name="Document_Zeta">
        <Key><PropertyRef Name="Ref_Key" /></Key>
        <Property Name="Ref_Key" Type="Edm.Guid" Nullable="false" />
      </EntityType>
      <EntityType Name="Catalog_Alpha">
        <Key><PropertyRef Name="Ref_Key" /></Key>
        <Property Name="Ref_Key" Type="Edm.Guid" Nullable="false" />
      </EntityType>
      <EntityType Name="Task_Beta">
        <Key><PropertyRef Name="Ref_Key" /></Key>
        <Property Name="Ref_Key" Type="Edm.Guid" Nullable="false" />
      </EntityType>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>
"#;
        let snapshot = snapshot(metadata);
        let resource_names = snapshot
            .objects
            .iter()
            .map(|object| object.resource_name.as_str())
            .collect::<Vec<_>>();

        assert_eq!(
            resource_names,
            vec!["Catalog_Alpha", "Document_Zeta", "Task_Beta"]
        );
        assert_eq!(
            snapshot.warnings,
            vec![
                "Entity type Catalog_Alpha is not referenced by an EntitySet; included as a classifiable 1C object.",
                "Entity type Document_Zeta is not referenced by an EntitySet; included as a classifiable 1C object.",
                "Entity type Task_Beta is not referenced by an EntitySet; included as a classifiable 1C object.",
            ]
        );
    }

    #[test]
    fn parser_should_return_redacted_xml_error() {
        let error = build_snapshot_from_metadata_xml(
            &endpoint(),
            None,
            None,
            "<edmx:Edmx><broken></edmx:Edmx>",
            1,
        )
        .expect_err("invalid XML should fail");
        let serialized = serialized_error(&error);

        assert!(matches!(error, MetadataScanError::XmlParse { .. }));
        assert!(!serialized.contains("https://example.test"));
    }

    #[test]
    fn status_errors_should_not_include_endpoint_or_auth_material() {
        let service_error =
            MetadataRequestKind::ServiceDocument.unavailable(Some(StatusCode::UNAUTHORIZED), false);
        let metadata_error =
            MetadataRequestKind::Metadata.unavailable(Some(StatusCode::TOO_MANY_REQUESTS), true);
        let serialized = serde_json::to_string(&(service_error, metadata_error))
            .expect("errors should serialize for testing");

        assert!(serialized.contains("401"));
        assert!(serialized.contains("429"));
        assert!(!serialized.contains("https://example.test"));
        assert!(!serialized.contains("hunter2"));
        assert!(!serialized.contains("token"));
    }

    #[tokio::test]
    async fn get_bytes_should_return_response_body_from_local_service() {
        let url = spawn_http_response("200 OK", b"service document");
        let client = Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .expect("test client should build");
        let body = get_bytes(&client, url, MetadataRequestKind::ServiceDocument)
            .await
            .expect("successful local HTTP response should be returned");

        assert_eq!(body, b"service document");
    }

    #[tokio::test]
    async fn get_bytes_should_redact_http_status_errors() {
        let url = spawn_http_response("503 Service Unavailable", b"temporary failure");
        let client = Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .expect("test client should build");
        let error = get_bytes(&client, url, MetadataRequestKind::Metadata)
            .await
            .expect_err("503 response should fail");
        let serialized = serialized_error(&error);

        assert!(matches!(
            error,
            MetadataScanError::MetadataUnavailable {
                status: Some(503),
                retryable: true,
                ..
            }
        ));
        assert!(!serialized.contains("127.0.0.1"));
        assert!(!serialized.contains("temporary failure"));
    }

    #[tokio::test]
    async fn get_bytes_should_fail_when_response_is_too_large() {
        let url = spawn_http_response_with_content_length("200 OK", MAX_RESPONSE_BYTES + 1, b"");
        let client = Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .expect("test client should build");
        let error = get_bytes(&client, url, MetadataRequestKind::Metadata)
            .await
            .expect_err("oversized response should fail before reading the body");
        let serialized = serialized_error(&error);

        assert!(matches!(
            error,
            MetadataScanError::MetadataUnavailable {
                status: None,
                retryable: false,
                ..
            }
        ));
        assert!(!serialized.contains("127.0.0.1"));
    }

    #[tokio::test]
    async fn scan_metadata_should_fetch_service_document_and_metadata() {
        let endpoint = spawn_http_sequence(vec![
            ("200 OK", b"{\"value\":[]}"),
            ("200 OK", SAMPLE_METADATA.as_bytes()),
        ]);

        let snapshot = scan_metadata(ScanMetadataRequest {
            endpoint: endpoint.to_string(),
            auth_ref: None,
            timeout_ms: Some(5_000),
            correlation_id: Some("corr-scan".to_owned()),
        })
        .await
        .expect("local metadata scan should succeed");

        assert_eq!(snapshot.objects.len(), 4);
        assert_eq!(snapshot.source.correlation_id.as_deref(), Some("corr-scan"));
        assert!(snapshot.collected_at_unix_ms > 0);
    }

    #[test]
    fn empty_metadata_should_fail() {
        let error = build_snapshot_from_metadata_xml(
            &endpoint(),
            None,
            None,
            "<edmx:Edmx xmlns:edmx=\"urn:test\" />",
            1,
        )
        .expect_err("empty metadata should fail");

        assert!(matches!(error, MetadataScanError::EmptyMetadata { .. }));
    }

    #[test]
    fn serialized_snapshot_should_not_contain_auth_material() {
        let request = ScanMetadataRequest {
            endpoint: "https://example.test/odata/".to_owned(),
            auth_ref: Some("keyring:profile-1".to_owned()),
            timeout_ms: None,
            correlation_id: Some("corr-1".to_owned()),
        };
        validate_auth_ref(request.auth_ref.as_deref()).expect("opaque authRef should pass");
        let snapshot = build_snapshot_from_metadata_xml(
            &normalize_endpoint(&request.endpoint).expect("endpoint should normalize"),
            request.auth_ref,
            request.correlation_id,
            SAMPLE_METADATA,
            1,
        )
        .expect("sample metadata should parse");
        let serialized =
            serde_json::to_string(&snapshot).expect("snapshot should serialize for testing");

        assert!(!serialized.contains("password"));
        assert!(!serialized.contains("token"));
        assert!(!serialized.contains("secret"));
    }
}
