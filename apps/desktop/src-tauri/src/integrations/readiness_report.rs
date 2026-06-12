use super::metadata::{MetadataField, MetadataObject, MetadataObjectKind, MetadataSnapshot};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;

const REPORT_ID_HASH_PREFIX_LEN: usize = 16;

const COUNTERPARTY_OBJECT_ALIASES: &[&str] = &[
    "counterparty",
    "counterparties",
    "contractor",
    "contractors",
    "supplier",
    "suppliers",
    "partner",
    "partners",
];
const NOMENCLATURE_OBJECT_ALIASES: &[&str] = &[
    "nomenclature",
    "inventory",
    "item",
    "items",
    "product",
    "products",
    "good",
    "goods",
    "service",
    "services",
];
const PURCHASE_DOCUMENT_ALIASES: &[&str] = &[
    "purchase",
    "receipt",
    "invoice",
    "incoming",
    "goodsreceipt",
    "servicesreceipt",
    "purchaseinvoice",
    "supplierinvoice",
];

const KEY_FIELD_ALIASES: &[&str] = &["ref", "refkey", "reference", "id"];
const NAME_FIELD_ALIASES: &[&str] = &["description", "name", "fullname", "title"];
const CODE_FIELD_ALIASES: &[&str] = &["code", "externalcode", "vendorcode"];
const INN_FIELD_ALIASES: &[&str] = &["inn", "taxid", "taxpayerid", "taxnumber"];
const KPP_FIELD_ALIASES: &[&str] = &["kpp", "taxregistration", "registrationreason"];
const UNIT_FIELD_ALIASES: &[&str] = &["unit", "baseunit", "uom", "measure", "measurement"];
const NUMBER_FIELD_ALIASES: &[&str] = &["number", "docnumber", "documentnumber"];
const DATE_FIELD_ALIASES: &[&str] = &["date", "docdate", "documentdate"];
const COUNTERPARTY_FIELD_ALIASES: &[&str] = &["counterparty", "contractor", "supplier", "partner"];
const ORGANIZATION_FIELD_ALIASES: &[&str] = &["organization", "company", "legalentity"];
const AMOUNT_FIELD_ALIASES: &[&str] = &["amount", "total", "totalamount", "sum", "totalsum"];
const VAT_FIELD_ALIASES: &[&str] = &["vat", "tax", "taxamount", "vatamount"];
const WAREHOUSE_FIELD_ALIASES: &[&str] = &["warehouse", "store", "stockroom"];
const CONTRACT_FIELD_ALIASES: &[&str] = &["contract", "agreement", "contractkey"];
const CONVERSION_FIELD_ALIASES: &[&str] = &[
    "conversion",
    "coefficient",
    "ratio",
    "uomratio",
    "unitratio",
    "conversioncoefficient",
];

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConnectionReadinessReportRequest {
    pub metadata_snapshot: MetadataSnapshot,
    pub correlation_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionReadinessReport {
    pub report_id: String,
    pub metadata_snapshot_id: String,
    pub schema_hash: String,
    pub status: ReadinessStatus,
    pub summary: String,
    pub totals: ReadinessTotals,
    pub sections: Vec<ReadinessSection>,
    pub limitations: Vec<String>,
    pub generated_at_unix_ms: u128,
    pub correlation_id: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ReadinessStatus {
    Ready,
    NeedsAdminSetup,
    ReviewOnly,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ReadinessCheckStatus {
    Found,
    Missing,
    Limited,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ReadinessSeverity {
    Critical,
    Warning,
    Info,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReadinessTotals {
    pub found: usize,
    pub required: usize,
    pub critical_missing: usize,
    pub warnings: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReadinessSection {
    pub code: String,
    pub title: String,
    pub status: ReadinessCheckStatus,
    pub summary: String,
    pub checks: Vec<ReadinessCheck>,
    pub administrator_actions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReadinessCheck {
    pub code: String,
    pub label: String,
    pub status: ReadinessCheckStatus,
    pub severity: ReadinessSeverity,
    pub message: String,
    pub matched_object: Option<String>,
    pub matched_field: Option<String>,
    pub remediation: Option<String>,
}

#[derive(Debug, Clone, Serialize, Error, PartialEq, Eq)]
#[serde(tag = "code", rename_all = "camelCase")]
pub enum ConnectionReadinessReportError {
    #[error("Metadata snapshot is empty.")]
    EmptySnapshot { remediation: String },
    #[error("Metadata snapshot contains secret-like material.")]
    SecretMaterialRejected { remediation: String },
    #[error("Internal readiness report error: {reason}")]
    Internal { reason: String },
}

#[derive(Debug, Clone)]
struct MatchedMember {
    name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HashableReport<'a> {
    metadata_snapshot_id: &'a str,
    schema_hash: &'a str,
    status: ReadinessStatus,
    totals: &'a ReadinessTotals,
    sections: &'a [ReadinessSection],
    limitations: &'a [String],
}

pub fn build_connection_readiness_report(
    request: ConnectionReadinessReportRequest,
) -> Result<ConnectionReadinessReport, ConnectionReadinessReportError> {
    validate_report_request(&request)?;

    let snapshot = &request.metadata_snapshot;
    let counterparty = find_object(
        snapshot,
        MetadataObjectKind::Catalog,
        COUNTERPARTY_OBJECT_ALIASES,
    );
    let nomenclature = find_object(
        snapshot,
        MetadataObjectKind::Catalog,
        NOMENCLATURE_OBJECT_ALIASES,
    );
    let purchase_document = find_object(
        snapshot,
        MetadataObjectKind::Document,
        PURCHASE_DOCUMENT_ALIASES,
    );

    let sections = vec![
        counterparties_section(counterparty),
        nomenclature_section(nomenclature),
        purchase_documents_section(purchase_document),
        draft_write_section(purchase_document),
        setup_required_section(snapshot, purchase_document, nomenclature),
    ];

    let totals = report_totals(&sections);
    let status = report_status(&totals);
    let limitations = report_limitations(&sections);
    let summary = format!(
        "Found {found} of {required} required fields.",
        found = totals.found,
        required = totals.required
    );
    let report_id = report_id(
        &snapshot.snapshot_id,
        &snapshot.schema_hash,
        status,
        &totals,
        &sections,
        &limitations,
    )?;

    Ok(ConnectionReadinessReport {
        report_id,
        metadata_snapshot_id: snapshot.snapshot_id.clone(),
        schema_hash: snapshot.schema_hash.clone(),
        status,
        summary,
        totals,
        sections,
        limitations,
        generated_at_unix_ms: unix_millis(),
        correlation_id: request.correlation_id,
    })
}

fn validate_report_request(
    request: &ConnectionReadinessReportRequest,
) -> Result<(), ConnectionReadinessReportError> {
    let snapshot = &request.metadata_snapshot;

    if snapshot.objects.is_empty() {
        return Err(ConnectionReadinessReportError::EmptySnapshot {
            remediation:
                "Run the OData metadata scan again and verify that the publication exposes accessible objects."
                    .to_owned(),
        });
    }

    let values = [
        Some(snapshot.source.endpoint.as_str()),
        Some(snapshot.source.service_document_url.as_str()),
        Some(snapshot.source.metadata_url.as_str()),
        snapshot.source.auth_ref.as_deref(),
        snapshot.source.correlation_id.as_deref(),
        request.correlation_id.as_deref(),
    ];

    if values
        .into_iter()
        .flatten()
        .any(contains_secret_like_fragment)
    {
        return Err(ConnectionReadinessReportError::SecretMaterialRejected {
            remediation:
                "Provide only clean metadata snapshots. Store endpoints with credentials and tokens in secure storage, not in IPC payloads."
                    .to_owned(),
        });
    }

    Ok(())
}

fn counterparties_section(counterparty: Option<&MetadataObject>) -> ReadinessSection {
    let checks = vec![
        object_check(
            "counterparties.object",
            "Counterparty catalog",
            counterparty,
            ReadinessSeverity::Critical,
            "Publish the counterparty catalog through the standard OData interface.",
        ),
        key_check(
            "counterparties.ref",
            "Counterparty reference key",
            counterparty,
            ReadinessSeverity::Critical,
            "Expose the reference key field for the counterparty catalog.",
        ),
        field_check(
            "counterparties.name",
            "Counterparty name",
            counterparty,
            NAME_FIELD_ALIASES,
            false,
            ReadinessSeverity::Critical,
            "Expose a counterparty name or description field.",
        ),
        field_check(
            "counterparties.code",
            "Counterparty code",
            counterparty,
            CODE_FIELD_ALIASES,
            false,
            ReadinessSeverity::Critical,
            "Expose a stable counterparty code field.",
        ),
        field_check(
            "counterparties.inn",
            "Counterparty tax identifier",
            counterparty,
            INN_FIELD_ALIASES,
            false,
            ReadinessSeverity::Critical,
            "Expose the counterparty tax identifier field used for exact matching.",
        ),
        field_check(
            "counterparties.kpp",
            "Counterparty tax registration",
            counterparty,
            KPP_FIELD_ALIASES,
            false,
            ReadinessSeverity::Warning,
            "Expose the tax registration field or configure a manual rule for cases where it is absent.",
        ),
    ];

    section("counterparties", "Counterparties", checks)
}

fn nomenclature_section(nomenclature: Option<&MetadataObject>) -> ReadinessSection {
    let checks = vec![
        object_check(
            "nomenclature.object",
            "Nomenclature catalog",
            nomenclature,
            ReadinessSeverity::Critical,
            "Publish the nomenclature catalog through the standard OData interface.",
        ),
        key_check(
            "nomenclature.ref",
            "Nomenclature reference key",
            nomenclature,
            ReadinessSeverity::Critical,
            "Expose the reference key field for the nomenclature catalog.",
        ),
        field_check(
            "nomenclature.name",
            "Nomenclature name",
            nomenclature,
            NAME_FIELD_ALIASES,
            false,
            ReadinessSeverity::Critical,
            "Expose a nomenclature name or description field.",
        ),
        field_check(
            "nomenclature.code",
            "Nomenclature code",
            nomenclature,
            CODE_FIELD_ALIASES,
            false,
            ReadinessSeverity::Critical,
            "Expose a stable nomenclature code field.",
        ),
        field_check(
            "nomenclature.unit",
            "Nomenclature accounting unit",
            nomenclature,
            UNIT_FIELD_ALIASES,
            true,
            ReadinessSeverity::Warning,
            "Publish the unit field or configure manual unit mapping before sending drafts.",
        ),
    ];

    section("nomenclature", "Nomenclature", checks)
}

fn purchase_documents_section(purchase_document: Option<&MetadataObject>) -> ReadinessSection {
    let checks = vec![
        object_check(
            "purchaseDocuments.object",
            "Purchase document object",
            purchase_document,
            ReadinessSeverity::Critical,
            "Publish a purchase or receipt document object through OData.",
        ),
        key_check(
            "purchaseDocuments.ref",
            "Purchase document reference key",
            purchase_document,
            ReadinessSeverity::Critical,
            "Expose the reference key field for the purchase document object.",
        ),
        field_check(
            "purchaseDocuments.number",
            "Document number",
            purchase_document,
            NUMBER_FIELD_ALIASES,
            false,
            ReadinessSeverity::Critical,
            "Expose the document number field.",
        ),
        field_check(
            "purchaseDocuments.date",
            "Document date",
            purchase_document,
            DATE_FIELD_ALIASES,
            false,
            ReadinessSeverity::Critical,
            "Expose the document date field.",
        ),
        field_check(
            "purchaseDocuments.counterparty",
            "Counterparty reference",
            purchase_document,
            COUNTERPARTY_FIELD_ALIASES,
            true,
            ReadinessSeverity::Critical,
            "Expose the counterparty reference field for purchase documents.",
        ),
        field_check(
            "purchaseDocuments.organization",
            "Organization reference",
            purchase_document,
            ORGANIZATION_FIELD_ALIASES,
            true,
            ReadinessSeverity::Critical,
            "Expose the organization reference field for purchase documents.",
        ),
        field_check(
            "purchaseDocuments.amount",
            "Document amount",
            purchase_document,
            AMOUNT_FIELD_ALIASES,
            false,
            ReadinessSeverity::Critical,
            "Expose the total amount field used by validation and duplicate checks.",
        ),
        field_check(
            "purchaseDocuments.vat",
            "VAT amount",
            purchase_document,
            VAT_FIELD_ALIASES,
            false,
            ReadinessSeverity::Critical,
            "Expose the VAT or tax amount field used by validation.",
        ),
    ];

    section("purchaseDocuments", "Purchase Documents", checks)
}

fn draft_write_section(purchase_document: Option<&MetadataObject>) -> ReadinessSection {
    let checks = vec![
        object_check(
            "draftWrite.targetDocument",
            "Draft target document",
            purchase_document,
            ReadinessSeverity::Critical,
            "Publish the document object that will receive safe draft payloads.",
        ),
        key_check(
            "draftWrite.targetReference",
            "Draft target reference key",
            purchase_document,
            ReadinessSeverity::Critical,
            "Expose the target document reference key for idempotent draft reconciliation.",
        ),
        multi_field_check(
            "draftWrite.minimumPayload",
            "Minimum draft payload fields",
            purchase_document,
            &[
                ("number", NUMBER_FIELD_ALIASES),
                ("date", DATE_FIELD_ALIASES),
                ("amount", AMOUNT_FIELD_ALIASES),
            ],
            false,
            ReadinessSeverity::Critical,
            "Expose number, date, and amount fields before draft planning can be trusted.",
        ),
        ReadinessCheck {
            code: "draftWrite.permissionCaveat".to_owned(),
            label: "Write permission caveat".to_owned(),
            status: ReadinessCheckStatus::Found,
            severity: ReadinessSeverity::Info,
            message:
                "Metadata is sufficient only for planning. Actual draft creation permission still requires a separate execution or preflight check."
                    .to_owned(),
            matched_object: purchase_document.map(|object| object.resource_name.clone()),
            matched_field: None,
            remediation: None,
        },
    ];

    section("draftWrite", "Draft Write Readiness", checks)
}

fn setup_required_section(
    snapshot: &MetadataSnapshot,
    purchase_document: Option<&MetadataObject>,
    nomenclature: Option<&MetadataObject>,
) -> ReadinessSection {
    let checks = vec![
        field_check(
            "setupRequired.warehouse",
            "Warehouse reference",
            purchase_document,
            WAREHOUSE_FIELD_ALIASES,
            true,
            ReadinessSeverity::Warning,
            "Expose the warehouse field or configure a default warehouse rule with an administrator.",
        ),
        field_check(
            "setupRequired.contract",
            "Contract reference",
            purchase_document,
            CONTRACT_FIELD_ALIASES,
            true,
            ReadinessSeverity::Warning,
            "Expose the contract field or configure a contract selection rule.",
        ),
        field_check(
            "setupRequired.unit",
            "Unit mapping source",
            nomenclature,
            UNIT_FIELD_ALIASES,
            true,
            ReadinessSeverity::Warning,
            "Expose accounting units for nomenclature before automatic line matching is enabled.",
        ),
        cross_snapshot_field_check(
            "setupRequired.conversionCoefficient",
            "Unit conversion coefficient",
            snapshot,
            CONVERSION_FIELD_ALIASES,
            ReadinessSeverity::Warning,
            "Publish conversion coefficients or configure manual conversion rules for supplier units.",
        ),
    ];

    section("setupRequired", "Setup Required", checks)
}

fn section(code: &str, title: &str, mut checks: Vec<ReadinessCheck>) -> ReadinessSection {
    // Sort by check code here so every derived computation below sees a stable,
    // deterministic order.  All three derived values are order-independent, but
    // sorting once at construction avoids doing it (and recomputing) later.
    checks.sort_by(|left, right| left.code.cmp(&right.code));

    let status = section_status(&checks);

    ReadinessSection {
        code: code.to_owned(),
        title: title.to_owned(),
        status,
        summary: section_summary(title, &checks),
        administrator_actions: administrator_actions(&checks),
        checks,
    }
}

fn object_check(
    code: &str,
    label: &str,
    object: Option<&MetadataObject>,
    severity: ReadinessSeverity,
    remediation: &str,
) -> ReadinessCheck {
    match object {
        Some(object) => ReadinessCheck {
            code: code.to_owned(),
            label: label.to_owned(),
            status: ReadinessCheckStatus::Found,
            severity,
            message: format!("Found published object `{}`.", object.resource_name),
            matched_object: Some(object.resource_name.clone()),
            matched_field: None,
            remediation: None,
        },
        None => missing_check(
            code,
            label,
            severity,
            "The required object was not found in the published OData metadata.",
            remediation,
        ),
    }
}

fn key_check(
    code: &str,
    label: &str,
    object: Option<&MetadataObject>,
    severity: ReadinessSeverity,
    remediation: &str,
) -> ReadinessCheck {
    match object {
        Some(object) => {
            if let Some(field) = key_member(object) {
                return ReadinessCheck {
                    code: code.to_owned(),
                    label: label.to_owned(),
                    status: ReadinessCheckStatus::Found,
                    severity,
                    message: format!("Found key field `{}`.", field.name),
                    matched_object: Some(object.resource_name.clone()),
                    matched_field: Some(field.name),
                    remediation: None,
                };
            }

            if let Some(key_name) = object.keys.iter().min() {
                return ReadinessCheck {
                    code: code.to_owned(),
                    label: label.to_owned(),
                    status: ReadinessCheckStatus::Found,
                    severity,
                    message: format!("Found key field `{key_name}`."),
                    matched_object: Some(object.resource_name.clone()),
                    matched_field: Some(key_name.clone()),
                    remediation: None,
                };
            }

            missing_check(
                code,
                label,
                severity,
                "The object is published, but no key field was found.",
                remediation,
            )
        }
        None => missing_check(
            code,
            label,
            severity,
            "The parent object is not available, so its key field cannot be verified.",
            remediation,
        ),
    }
}

fn field_check(
    code: &str,
    label: &str,
    object: Option<&MetadataObject>,
    aliases: &[&str],
    prefer_reference: bool,
    severity: ReadinessSeverity,
    remediation: &str,
) -> ReadinessCheck {
    match object {
        Some(object) => {
            if let Some(member) = field_or_reference_member(object, aliases, prefer_reference) {
                ReadinessCheck {
                    code: code.to_owned(),
                    label: label.to_owned(),
                    status: ReadinessCheckStatus::Found,
                    severity,
                    message: format!("Found field `{}`.", member.name),
                    matched_object: Some(object.resource_name.clone()),
                    matched_field: Some(member.name),
                    remediation: None,
                }
            } else {
                missing_check(
                    code,
                    label,
                    severity,
                    "The object is published, but this field was not found.",
                    remediation,
                )
            }
        }
        None => missing_check(
            code,
            label,
            severity,
            "The parent object is not available, so this field cannot be verified.",
            remediation,
        ),
    }
}

fn multi_field_check(
    code: &str,
    label: &str,
    object: Option<&MetadataObject>,
    requirements: &[(&str, &[&str])],
    prefer_reference: bool,
    severity: ReadinessSeverity,
    remediation: &str,
) -> ReadinessCheck {
    match object {
        Some(object) => {
            let mut matched_names = Vec::new();
            let mut missing_labels = Vec::new();

            for (requirement_label, aliases) in requirements {
                if let Some(member) = field_or_reference_member(object, aliases, prefer_reference) {
                    matched_names.push(member.name);
                } else {
                    missing_labels.push(*requirement_label);
                }
            }

            if missing_labels.is_empty() {
                matched_names.sort();
                matched_names.dedup();
                ReadinessCheck {
                    code: code.to_owned(),
                    label: label.to_owned(),
                    status: ReadinessCheckStatus::Found,
                    severity,
                    message: format!("Found required fields: {}.", matched_names.join(", ")),
                    matched_object: Some(object.resource_name.clone()),
                    matched_field: Some(matched_names.join(", ")),
                    remediation: None,
                }
            } else {
                missing_check(
                    code,
                    label,
                    severity,
                    &format!(
                        "The object is published, but required fields are missing: {}.",
                        missing_labels.join(", ")
                    ),
                    remediation,
                )
            }
        }
        None => missing_check(
            code,
            label,
            severity,
            "The parent object is not available, so draft payload fields cannot be verified.",
            remediation,
        ),
    }
}

fn cross_snapshot_field_check(
    code: &str,
    label: &str,
    snapshot: &MetadataSnapshot,
    aliases: &[&str],
    severity: ReadinessSeverity,
    remediation: &str,
) -> ReadinessCheck {
    if let Some((object, member)) = field_or_reference_member_in_snapshot(snapshot, aliases) {
        return ReadinessCheck {
            code: code.to_owned(),
            label: label.to_owned(),
            status: ReadinessCheckStatus::Found,
            severity,
            message: format!("Found field `{}`.", member.name),
            matched_object: Some(object.resource_name.clone()),
            matched_field: Some(member.name),
            remediation: None,
        };
    }

    missing_check(
        code,
        label,
        severity,
        "No published field appears to expose this setup information.",
        remediation,
    )
}

fn missing_check(
    code: &str,
    label: &str,
    severity: ReadinessSeverity,
    message: &str,
    remediation: &str,
) -> ReadinessCheck {
    let status = match severity {
        ReadinessSeverity::Critical => ReadinessCheckStatus::Missing,
        ReadinessSeverity::Warning | ReadinessSeverity::Info => ReadinessCheckStatus::Limited,
    };

    ReadinessCheck {
        code: code.to_owned(),
        label: label.to_owned(),
        status,
        severity,
        message: message.to_owned(),
        matched_object: None,
        matched_field: None,
        remediation: Some(remediation.to_owned()),
    }
}

fn find_object<'a>(
    snapshot: &'a MetadataSnapshot,
    kind: MetadataObjectKind,
    aliases: &[&str],
) -> Option<&'a MetadataObject> {
    snapshot
        .objects
        .iter()
        .filter(|object| object.object_kind == kind)
        .filter(|object| {
            aliases.iter().any(|alias| {
                normalized_contains(&object.resource_name, alias)
                    || normalized_contains(&object.name, alias)
            })
        })
        .min_by(|left, right| left.resource_name.cmp(&right.resource_name))
}

fn key_member(object: &MetadataObject) -> Option<MatchedMember> {
    object
        .fields
        .iter()
        .filter(|field| {
            field.is_key
                || object.keys.iter().any(|key| key == &field.name)
                || KEY_FIELD_ALIASES
                    .iter()
                    .any(|alias| normalized_contains(&field.name, alias))
        })
        .min_by(|left, right| left.name.cmp(&right.name))
        .map(|field| MatchedMember {
            name: field.name.clone(),
        })
}

fn field_or_reference_member(
    object: &MetadataObject,
    aliases: &[&str],
    prefer_reference: bool,
) -> Option<MatchedMember> {
    if prefer_reference {
        // or_else is lazy: reference_member is skipped when field_member succeeds.
        reference_member(object, aliases)
            .or_else(|| field_member(object, aliases, prefer_reference))
    } else {
        field_member(object, aliases, prefer_reference)
            .or_else(|| reference_member(object, aliases))
    }
}

fn field_member(
    object: &MetadataObject,
    aliases: &[&str],
    prefer_reference: bool,
) -> Option<MatchedMember> {
    object
        .fields
        .iter()
        .filter(|field| {
            !prefer_reference || field.is_reference || aliases_match(&field.type_name, aliases)
        })
        .filter(|field| {
            aliases.iter().any(|alias| {
                normalized_contains(&field.name, alias)
                    || normalized_contains(&field.type_name, alias)
            })
        })
        .min_by(|left, right| field_order(left, right, aliases, prefer_reference))
        .map(|field| MatchedMember {
            name: field.name.clone(),
        })
}

fn reference_member(object: &MetadataObject, aliases: &[&str]) -> Option<MatchedMember> {
    object
        .references
        .iter()
        .filter(|reference| {
            aliases.iter().any(|alias| {
                normalized_contains(&reference.name, alias)
                    || normalized_contains(&reference.target_type, alias)
            })
        })
        .min_by(|left, right| left.name.cmp(&right.name))
        .map(|reference| MatchedMember {
            name: reference.name.clone(),
        })
}

fn field_or_reference_member_in_snapshot<'a>(
    snapshot: &'a MetadataSnapshot,
    aliases: &[&str],
) -> Option<(&'a MetadataObject, MatchedMember)> {
    snapshot
        .objects
        .iter()
        .filter_map(|object| {
            field_or_reference_member(object, aliases, false).map(|member| (object, member))
        })
        .min_by(|(left_object, left_member), (right_object, right_member)| {
            left_object
                .resource_name
                .cmp(&right_object.resource_name)
                .then_with(|| left_member.name.cmp(&right_member.name))
        })
}

fn field_order(
    left: &MetadataField,
    right: &MetadataField,
    aliases: &[&str],
    prefer_reference: bool,
) -> std::cmp::Ordering {
    let left_exact = aliases_match_exact(&left.name, aliases);
    let right_exact = aliases_match_exact(&right.name, aliases);
    let left_reference = left.is_reference || aliases_match(&left.type_name, aliases);
    let right_reference = right.is_reference || aliases_match(&right.type_name, aliases);

    right_exact
        .cmp(&left_exact)
        .then_with(|| {
            if prefer_reference {
                right_reference.cmp(&left_reference)
            } else {
                std::cmp::Ordering::Equal
            }
        })
        .then_with(|| left.name.cmp(&right.name))
}

fn aliases_match(value: &str, aliases: &[&str]) -> bool {
    aliases
        .iter()
        .any(|alias| normalized_contains(value, alias))
}

fn aliases_match_exact(value: &str, aliases: &[&str]) -> bool {
    let normalized_value = normalize_identifier(value);
    aliases
        .iter()
        .map(|alias| normalize_identifier(alias))
        .any(|alias| alias == normalized_value)
}

fn normalized_contains(value: &str, alias: &str) -> bool {
    let normalized_value = normalize_identifier(value);
    let normalized_alias = normalize_identifier(alias);

    !normalized_alias.is_empty() && normalized_value.contains(&normalized_alias)
}

fn normalize_identifier(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn section_status(checks: &[ReadinessCheck]) -> ReadinessCheckStatus {
    if checks.iter().any(|check| {
        check.severity == ReadinessSeverity::Critical && check.status != ReadinessCheckStatus::Found
    }) {
        return ReadinessCheckStatus::Missing;
    }

    if checks
        .iter()
        .any(|check| check.status != ReadinessCheckStatus::Found)
    {
        return ReadinessCheckStatus::Limited;
    }

    ReadinessCheckStatus::Found
}

fn section_summary(title: &str, checks: &[ReadinessCheck]) -> String {
    let found = checks
        .iter()
        .filter(|check| check.status == ReadinessCheckStatus::Found)
        .count();
    format!(
        "{title}: found {found} of {total} checks.",
        total = checks.len()
    )
}

fn administrator_actions(checks: &[ReadinessCheck]) -> Vec<String> {
    let mut actions = checks
        .iter()
        .filter(|check| check.status != ReadinessCheckStatus::Found)
        .filter_map(|check| check.remediation.clone())
        .collect::<Vec<_>>();
    actions.sort();
    actions.dedup();
    actions
}

fn report_totals(sections: &[ReadinessSection]) -> ReadinessTotals {
    let counted_checks = sections
        .iter()
        .flat_map(|section| section.checks.iter())
        .filter(|check| check.severity != ReadinessSeverity::Info);

    let mut totals = ReadinessTotals {
        found: 0,
        required: 0,
        critical_missing: 0,
        warnings: 0,
    };

    for check in counted_checks {
        totals.required += 1;

        if check.status == ReadinessCheckStatus::Found {
            totals.found += 1;
        }

        if check.severity == ReadinessSeverity::Critical
            && check.status != ReadinessCheckStatus::Found
        {
            totals.critical_missing += 1;
        }

        if check.severity == ReadinessSeverity::Warning
            && check.status != ReadinessCheckStatus::Found
        {
            totals.warnings += 1;
        }
    }

    totals
}

fn report_status(totals: &ReadinessTotals) -> ReadinessStatus {
    if totals.critical_missing > 0 {
        ReadinessStatus::NeedsAdminSetup
    } else if totals.warnings > 0 {
        ReadinessStatus::ReviewOnly
    } else {
        ReadinessStatus::Ready
    }
}

fn report_limitations(sections: &[ReadinessSection]) -> Vec<String> {
    let mut limitations = vec![
        "The report is based only on objects published through OData and accessible to the active credential context."
            .to_owned(),
        "Draft write readiness means metadata is sufficient for planning; actual write permission still requires a separate execution or preflight check."
            .to_owned(),
    ];

    if sections
        .iter()
        .flat_map(|section| section.checks.iter())
        .any(|check| {
            check.severity == ReadinessSeverity::Warning
                && check.status != ReadinessCheckStatus::Found
        })
    {
        limitations.push(
            "Some setup gaps require administrator configuration before fully automated draft preparation."
                .to_owned(),
        );
    }

    limitations.sort();
    limitations.dedup();
    limitations
}

fn report_id(
    metadata_snapshot_id: &str,
    schema_hash: &str,
    status: ReadinessStatus,
    totals: &ReadinessTotals,
    sections: &[ReadinessSection],
    limitations: &[String],
) -> Result<String, ConnectionReadinessReportError> {
    let hashable = HashableReport {
        metadata_snapshot_id,
        schema_hash,
        status,
        totals,
        sections,
        limitations,
    };
    let json = serde_json::to_vec(&hashable).map_err(|error| {
        ConnectionReadinessReportError::Internal {
            reason: format!("readiness report serialization failed: {error}"),
        }
    })?;
    let mut hasher = Sha256::new();
    hasher.update(json);
    let hash = lower_hex(&hasher.finalize());

    Ok(format!("readiness-{}", &hash[..REPORT_ID_HASH_PREFIX_LEN]))
}

fn contains_secret_like_fragment(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    lower.contains(';')
        || (lower.contains("://") && lower.contains('@'))
        || lower.contains("api_key")
        || lower.contains("authorization:")
        || lower.contains("bearer ")
        || lower.contains("basic ")
        || lower.contains("secret=")
        || lower.contains("usr=")
        || lower.contains("user=")
        || lower.contains("pwd=")
        || lower.contains("password=")
        || lower.contains("token=")
        || lower.contains("access_token")
        || lower.contains("connectionstring=")
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

fn unix_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::integrations::metadata::{MetadataReference, MetadataSource};

    fn snapshot(objects: Vec<MetadataObject>) -> MetadataSnapshot {
        MetadataSnapshot {
            snapshot_id: "metadata-test".to_owned(),
            source: MetadataSource {
                endpoint: "https://example.test/odata/standard.odata/".to_owned(),
                service_document_url: "https://example.test/odata/standard.odata/".to_owned(),
                metadata_url: "https://example.test/odata/standard.odata/$metadata".to_owned(),
                auth_ref: Some("keyring:one-c-demo".to_owned()),
                correlation_id: Some("corr-demo".to_owned()),
            },
            collected_at_unix_ms: 1,
            schema_hash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
                .to_owned(),
            objects,
            warnings: Vec::new(),
        }
    }

    fn field(name: &str, type_name: &str, nullable: bool) -> MetadataField {
        MetadataField {
            name: name.to_owned(),
            type_name: type_name.to_owned(),
            nullable,
            is_key: false,
            is_reference: name.ends_with("_Key") || type_name.contains("Ref."),
        }
    }

    fn key_field() -> MetadataField {
        MetadataField {
            name: "Ref_Key".to_owned(),
            type_name: "Edm.Guid".to_owned(),
            nullable: false,
            is_key: true,
            is_reference: true,
        }
    }

    fn object(
        resource_name: &str,
        object_kind: MetadataObjectKind,
        fields: Vec<MetadataField>,
    ) -> MetadataObject {
        MetadataObject {
            name: resource_name
                .split_once('_')
                .map_or(resource_name, |(_, name)| name)
                .to_owned(),
            resource_name: resource_name.to_owned(),
            object_kind,
            fields,
            keys: vec!["Ref_Key".to_owned()],
            references: Vec::new(),
        }
    }

    fn complete_snapshot() -> MetadataSnapshot {
        snapshot(vec![
            object(
                "Catalog_Counterparties",
                MetadataObjectKind::Catalog,
                vec![
                    key_field(),
                    field("Description", "Edm.String", true),
                    field("Code", "Edm.String", true),
                    field("INN", "Edm.String", true),
                    field("KPP", "Edm.String", true),
                ],
            ),
            object(
                "Catalog_Nomenclature",
                MetadataObjectKind::Catalog,
                vec![
                    key_field(),
                    field("Description", "Edm.String", true),
                    field("Code", "Edm.String", true),
                    field("BaseUnit_Key", "StandardODATA.CatalogRef.Units", true),
                ],
            ),
            object(
                "Document_PurchaseInvoice",
                MetadataObjectKind::Document,
                vec![
                    key_field(),
                    field("Number", "Edm.String", false),
                    field("Date", "Edm.DateTimeOffset", false),
                    field(
                        "Counterparty_Key",
                        "StandardODATA.CatalogRef.Counterparties",
                        false,
                    ),
                    field(
                        "Organization_Key",
                        "StandardODATA.CatalogRef.Organizations",
                        false,
                    ),
                    field("TotalAmount", "Edm.Decimal", false),
                    field("VATAmount", "Edm.Decimal", true),
                    field("Warehouse_Key", "StandardODATA.CatalogRef.Warehouses", true),
                    field("Contract_Key", "StandardODATA.CatalogRef.Contracts", true),
                    field("ConversionCoefficient", "Edm.Decimal", true),
                ],
            ),
        ])
    }

    fn report_for(snapshot: MetadataSnapshot) -> ConnectionReadinessReport {
        build_connection_readiness_report(ConnectionReadinessReportRequest {
            metadata_snapshot: snapshot,
            correlation_id: Some("corr-report".to_owned()),
        })
        .expect("report should build")
    }

    fn flattened_checks(report: &ConnectionReadinessReport) -> Vec<&ReadinessCheck> {
        report
            .sections
            .iter()
            .flat_map(|section| section.checks.iter())
            .collect()
    }

    #[test]
    fn report_should_be_ready_when_complete_metadata_is_available() {
        let report = report_for(complete_snapshot());

        assert_eq!(report.status, ReadinessStatus::Ready);
        assert_eq!(report.totals.critical_missing, 0);
        assert_eq!(report.totals.warnings, 0);
    }

    #[test]
    fn report_should_require_admin_setup_when_counterparty_catalog_is_missing() {
        let mut snapshot = complete_snapshot();
        snapshot
            .objects
            .retain(|object| object.resource_name != "Catalog_Counterparties");

        let report = report_for(snapshot);

        assert_eq!(report.status, ReadinessStatus::NeedsAdminSetup);
        assert!(flattened_checks(&report)
            .iter()
            .any(|check| check.code == "counterparties.object"
                && check.status == ReadinessCheckStatus::Missing));
    }

    #[test]
    fn report_should_limit_readiness_when_unit_and_conversion_setup_is_missing() {
        let mut snapshot = complete_snapshot();
        for object in &mut snapshot.objects {
            object.fields.retain(|field| {
                field.name != "BaseUnit_Key" && field.name != "ConversionCoefficient"
            });
        }

        let report = report_for(snapshot);

        assert_eq!(report.status, ReadinessStatus::ReviewOnly);
        assert!(flattened_checks(&report)
            .iter()
            .any(|check| check.code == "setupRequired.conversionCoefficient"
                && check.status == ReadinessCheckStatus::Limited));
    }

    #[test]
    fn report_should_return_actionable_missing_field_checks_for_purchase_documents() {
        let mut snapshot = complete_snapshot();
        for object in &mut snapshot.objects {
            if object.resource_name == "Document_PurchaseInvoice" {
                object
                    .fields
                    .retain(|field| field.name != "Counterparty_Key" && field.name != "VATAmount");
            }
        }

        let report = report_for(snapshot);

        assert!(flattened_checks(&report)
            .iter()
            .any(|check| check.code == "purchaseDocuments.counterparty"
                && check.remediation.as_deref()
                    == Some("Expose the counterparty reference field for purchase documents.")));
    }

    #[test]
    fn report_id_should_be_deterministic_for_equivalent_snapshots() {
        let first = complete_snapshot();
        let mut second = complete_snapshot();
        second.objects.reverse();

        let first_report = report_for(first);
        let second_report = report_for(second);

        assert_eq!(first_report.report_id, second_report.report_id);
    }

    #[test]
    fn checks_should_be_sorted_within_each_section() {
        let report = report_for(complete_snapshot());

        for section in report.sections {
            let mut sorted_codes = section
                .checks
                .iter()
                .map(|check| check.code.as_str())
                .collect::<Vec<_>>();
            sorted_codes.sort_unstable();

            let actual_codes = section
                .checks
                .iter()
                .map(|check| check.code.as_str())
                .collect::<Vec<_>>();

            assert_eq!(actual_codes, sorted_codes);
        }
    }

    #[test]
    fn serialized_report_should_not_include_source_or_auth_material() {
        let report = report_for(complete_snapshot());
        let json = serde_json::to_string(&report).expect("report should serialize");

        assert!(!json.contains("authRef"));
        assert!(!json.contains("standard.odata"));
        assert!(!json.contains("token"));
        assert!(!json.contains("password"));
        assert!(!json.contains("connectionstring"));
    }

    #[test]
    fn empty_snapshot_should_return_typed_error() {
        let error = build_connection_readiness_report(ConnectionReadinessReportRequest {
            metadata_snapshot: snapshot(Vec::new()),
            correlation_id: None,
        })
        .expect_err("empty snapshots should fail");

        assert!(matches!(
            error,
            ConnectionReadinessReportError::EmptySnapshot { .. }
        ));
    }

    #[test]
    fn snapshot_with_secret_like_source_should_be_rejected() {
        let mut snapshot = complete_snapshot();
        snapshot.source.auth_ref = Some("token=secret".to_owned());

        let error = build_connection_readiness_report(ConnectionReadinessReportRequest {
            metadata_snapshot: snapshot,
            correlation_id: None,
        })
        .expect_err("secret-like source values should fail");

        assert!(matches!(
            error,
            ConnectionReadinessReportError::SecretMaterialRejected { .. }
        ));
    }

    #[test]
    fn navigation_references_should_be_used_as_reference_fields() {
        let mut snapshot = complete_snapshot();
        for object in &mut snapshot.objects {
            if object.resource_name == "Document_PurchaseInvoice" {
                object
                    .fields
                    .retain(|field| field.name != "Counterparty_Key");
                object.references.push(MetadataReference {
                    name: "Counterparty".to_owned(),
                    target_type: "StandardODATA.Catalog_Counterparties".to_owned(),
                });
            }
        }

        let report = report_for(snapshot);

        assert!(flattened_checks(&report)
            .iter()
            .any(|check| check.code == "purchaseDocuments.counterparty"
                && check.status == ReadinessCheckStatus::Found
                && check.matched_field.as_deref() == Some("Counterparty")));
    }
}
