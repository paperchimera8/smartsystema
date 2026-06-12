export const INTEGRATION_PATHS = ["odata", "epf", "thin-client", "windows-com"] as const;

export type IntegrationPath = (typeof INTEGRATION_PATHS)[number];

export type AgentRunState = "ready" | "degraded" | "offline";

export type OcrExecutionPolicy = "local" | "regional-cloud" | "cloud";

export type AgentHeartbeat = {
  agentId: string;
  tenantId: string;
  runState: AgentRunState;
  capabilities: IntegrationPath[];
  observedAt: string;
  schemaSnapshotId?: string;
};

export const AGENT_COMMAND_TYPES = [
  "WriteDocument",
  "CreateDraftIn1C",
  "ExportPackage",
  "ScanMetadata",
  "RefreshCapabilities",
  "TestConnection",
  "ValidateOneCObject",
  "RunExternalProcessing",
  "CollectDiagnostics"
] as const;

export type AgentCommandType = (typeof AGENT_COMMAND_TYPES)[number];

export const AGENT_COMMAND_STATUSES = [
  "queued",
  "delivered",
  "accepted",
  "running",
  "succeeded",
  "rejected",
  "failed_retryable",
  "failed_terminal",
  "timed_out",
  "cancelled",
  "expired"
] as const;

export type AgentCommandStatus = (typeof AGENT_COMMAND_STATUSES)[number];

export type AgentCommandEnvelope = {
  commandId: string;
  tenantId: string;
  agentId: string;
  commandType: AgentCommandType;
  payloadVersion: number;
  payload: Record<string, unknown>;
  draftId?: string;
  metadataSnapshotId?: string;
  idempotencyKey: string;
  status: AgentCommandStatus;
  retries: number;
  maxRetries: number;
  deadlineAt: string;
  lastError?: string;
  result?: AgentCommandResult;
  correlationId: string;
  createdAt: string;
  updatedAt: string;
};

export type AgentCommandResult = {
  commandId: string;
  tenantId: string;
  agentId: string;
  status: "succeeded" | "failed_retryable" | "failed_terminal";
  startedAt: string;
  finishedAt: string;
  selectedStrategy?: string;
  externalReference?: string;
  normalizedErrors: string[];
  retryable: boolean;
  diagnosticRef?: string;
  correlationId: string;
};

export const AGENT_COMMAND_PAYLOAD_VERSION = 1 as const;

export type CreateAgentCommandRequest = {
  payloadVersion: typeof AGENT_COMMAND_PAYLOAD_VERSION;
  tenantId: string;
  agentId: string;
  commandId?: string;
  draftId?: string;
  metadataSnapshotId?: string;
  commandType: AgentCommandType;
  commandPayloadVersion: number;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  deadlineAt: string;
  maxRetries?: number;
  correlationId: string;
  createdByUserId: string;
};

export type CreateAgentCommandResponse = AgentCommandEnvelope & {
  idempotencyReplay: boolean;
};

export type AgentCommandError =
  | {
      code:
        | "invalidCommandInput"
        | "invalidPayloadVersion"
        | "idempotencyConflict"
        | "secretMaterialRejected"
        | "persistenceUnavailable"
        | "commandNotFound"
        | "commandOwnershipMismatch"
        | "invalidStateTransition"
        | "commandNotActive";
      message: string;
      retryable: boolean;
      remediation: string;
      field?: string;
      correlationId?: string;
    };

export type AgentHeartbeatRequest = {
  agentId: string;
  tenantId: string;
  runState: AgentRunState;
  capabilities: IntegrationPath[];
  schemaSnapshotId?: string;
};

export type AgentHeartbeatResponse = {
  agentId: string;
  tenantId: string;
  acknowledgedAt: string;
  pendingCommandCount: number;
};

export type DocumentProcessingJob = {
  tenantId: string;
  documentId: string;
  storageKey: string;
  policy: OcrExecutionPolicy;
  imageUrl?: string;
};

export type OcrExtractedField = {
  name: string;
  value: string;
  confidence: number;
};

export type OcrExtractResult = {
  documentId: string;
  provider: "openai";
  model: string;
  rawText: string;
  documentType: string;
  fields: OcrExtractedField[];
  overallConfidence: number;
  tokenUsage: { inputTokens: number; outputTokens: number };
};

export const NATIVE_AUTH_PAYLOAD_VERSION = 1 as const;

export type NativeAuthUser = {
  userId: string;
  tenantId: string;
  email: string;
  displayName: string;
  role: "accountant" | "admin";
};

export type StartNativeAuthRequest = {
  payloadVersion: typeof NATIVE_AUTH_PAYLOAD_VERSION;
  deviceLabel?: string;
  preferredMode?: "login" | "register";
  /** Client-visible API base URL used to build the external-browser login page URL. */
  apiBaseUrl?: string;
  correlationId: string;
};

export type StartNativeAuthResponse = {
  payloadVersion: typeof NATIVE_AUTH_PAYLOAD_VERSION;
  authRequestId: string;
  pollToken: string;
  loginUrl: string;
  expiresAt: string;
  pollIntervalMs: number;
  correlationId: string;
};

export type PollNativeAuthRequest = {
  payloadVersion: typeof NATIVE_AUTH_PAYLOAD_VERSION;
  authRequestId: string;
  pollToken: string;
  correlationId: string;
};

export type NativeAuthPendingResponse = {
  payloadVersion: typeof NATIVE_AUTH_PAYLOAD_VERSION;
  status: "pending";
  expiresAt: string;
  pollIntervalMs: number;
  correlationId: string;
};

export type NativeAuthSessionResponse = {
  payloadVersion: typeof NATIVE_AUTH_PAYLOAD_VERSION;
  status: "authenticated";
  accessToken: string;
  expiresAt: string;
  user: NativeAuthUser;
  correlationId: string;
};

export type NativeAuthPollResponse = NativeAuthPendingResponse | NativeAuthSessionResponse;

export type NativeAuthMeResponse = {
  user: NativeAuthUser;
  sessionId: string;
  expiresAt: string;
};

export type NativeAuthErrorCode =
  | "invalidAuthInput"
  | "invalidPayloadVersion"
  | "authRequestExpired"
  | "authRequestNotFound"
  | "authRequestAlreadyConsumed"
  | "invalidCredentials"
  | "emailAlreadyRegistered"
  | "weakPassword"
  | "persistenceUnavailable";

export type NativeAuthError = {
  code: NativeAuthErrorCode;
  message: string;
  retryable: boolean;
  remediation: string;
  correlationId?: string;
};

export type DraftConfidence = {
  score: number;
  reasons: string[];
  requiresReview: boolean;
};

export const DRAFT_CREATION_PAYLOAD_VERSION = 1 as const;

export type DraftJsonPrimitive = string | number | boolean | null;

export type DraftJsonValue =
  | DraftJsonPrimitive
  | DraftJsonValue[]
  | { readonly [key: string]: DraftJsonValue };

export type DraftLifecycleStatus =
  | "created"
  | "processing"
  | "needs_review"
  | "validated"
  | "approved"
  | "write_pending"
  | "written"
  | "failed"
  | "write_failed"
  | "export_required"
  | "cancelled";

export type DraftApprovalStatus = "pending" | "approved" | "rejected";

export type DraftWriteStatus =
  | "not_requested"
  | "planning"
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "export_required";

export type DraftField = {
  name: string;
  value: DraftJsonValue;
  sourceField?: string;
  confidence?: number;
};

export type DraftReference = {
  name: string;
  fieldName: string;
  targetResourceName?: string;
  targetKey?: string;
  candidateId?: string;
  confidence?: number;
};

export type DraftValidationSeverity = "error" | "warning" | "info";

export type DraftValidationMessage = {
  code: string;
  severity: DraftValidationSeverity;
  message: string;
  field?: string;
};

export type DraftValidationSummary = {
  status: WriteValidationStatus;
  messages: DraftValidationMessage[];
};

export type CreateDraftRequest = {
  payloadVersion: typeof DRAFT_CREATION_PAYLOAD_VERSION;
  tenantId: string;
  documentId: string;
  metadataSnapshotId: string;
  schemaHash: string;
  documentType: string;
  targetResourceName: string;
  fields: DraftField[];
  references?: DraftReference[];
  confidence: DraftConfidence;
  validationSummary: DraftValidationSummary;
  idempotencyKey: string;
  correlationId: string;
  createdByUserId: string;
};

export type CreateDraftResponse = {
  draftId: string;
  tenantId: string;
  documentId: string;
  metadataSnapshotId: string;
  lifecycleStatus: "needs_review";
  approvalStatus: "pending";
  writeStatus: "not_requested";
  requiresAccountantApproval: true;
  idempotencyReplay: boolean;
  createdAt: string;
  correlationId: string;
};

export type DraftCreationErrorCode =
  | "invalidPayloadVersion"
  | "invalidDraftInput"
  | "idempotencyConflict"
  | "secretMaterialRejected"
  | "persistenceUnavailable";

export type DraftCreationError = {
  code: DraftCreationErrorCode;
  message: string;
  retryable: boolean;
  remediation: string;
  field?: string;
  correlationId?: string;
};

export const DOCUMENT_EXCEPTION_PAYLOAD_VERSION = 1 as const;

export const DOCUMENT_EXCEPTION_STAGES = [
  "upload",
  "ocr",
  "classification",
  "mapping",
  "entity_resolution",
  "validation",
  "draft_creation",
  "write_planning"
] as const;

export type DocumentExceptionStage = (typeof DOCUMENT_EXCEPTION_STAGES)[number];

export const DOCUMENT_EXCEPTION_SIGNAL_CODES = [
  "ocr_failed",
  "unsupported_document_type",
  "low_document_confidence",
  "low_field_confidence",
  "counterparty_not_found",
  "counterparty_ambiguous",
  "nomenclature_not_found",
  "nomenclature_ambiguous",
  "unit_mismatch",
  "vat_mismatch",
  "metadata_gap",
  "validation_error",
  "policy_blocked"
] as const;

export type DocumentExceptionSignalCode = (typeof DOCUMENT_EXCEPTION_SIGNAL_CODES)[number];

export type DocumentExceptionSeverity = "info" | "warning" | "critical";

export type DocumentExceptionCategory =
  | "ocr_failed"
  | "unsupported_document"
  | "low_confidence"
  | "counterparty_issue"
  | "nomenclature_issue"
  | "unit_mismatch"
  | "vat_mismatch"
  | "metadata_gap"
  | "validation_failed"
  | "policy_blocked";

export type DocumentExceptionQueueName =
  | "accountant_review"
  | "admin_setup"
  | "ocr_retry"
  | "manual_processing";

export type DocumentExceptionStatus = "open" | "in_review" | "resolved" | "dismissed";

export type DocumentExceptionPriority = "low" | "normal" | "high" | "urgent";

export type DocumentExceptionSignal = {
  code: DocumentExceptionSignalCode;
  severity: DocumentExceptionSeverity;
  message: string;
  field?: string;
  lineId?: string;
  entityKind?: "counterparty" | "nomenclature" | "unit" | "document" | "metadata" | "validation";
  score?: number;
  candidateCount?: number;
};

export type CreateDocumentExceptionRequest = {
  payloadVersion: typeof DOCUMENT_EXCEPTION_PAYLOAD_VERSION;
  tenantId: string;
  documentId: string;
  draftId?: string;
  metadataSnapshotId?: string;
  schemaHash?: string;
  stage: DocumentExceptionStage;
  signals: DocumentExceptionSignal[];
  idempotencyKey: string;
  correlationId: string;
  createdByUserId: string;
};

export type CreateDocumentExceptionResponse = {
  exceptionId: string;
  tenantId: string;
  documentId: string;
  draftId?: string;
  category: DocumentExceptionCategory;
  queueName: DocumentExceptionQueueName;
  priority: DocumentExceptionPriority;
  status: "open";
  requiresAccountantReview: boolean;
  requiresAdminReview: boolean;
  signalCount: number;
  topSignalCode: DocumentExceptionSignalCode;
  suggestedActions: string[];
  idempotencyReplay: boolean;
  createdAt: string;
  correlationId: string;
};

export type DocumentExceptionErrorCode =
  | "invalidPayloadVersion"
  | "invalidExceptionInput"
  | "idempotencyConflict"
  | "secretMaterialRejected"
  | "persistenceUnavailable";

export type DocumentExceptionError = {
  code: DocumentExceptionErrorCode;
  message: string;
  retryable: boolean;
  remediation: string;
  field?: string;
  correlationId?: string;
};

export type DocumentReviewPhase = "uploaded" | "processing" | "processed" | "sent" | "failed";

export type DocumentReviewStatusCode =
  | "uploaded"
  | "recognizing"
  | "needs_review"
  | "ready_to_send"
  | "sent_to_1c"
  | "error";

export type DocumentReviewIssueCode =
  | "low_ocr_confidence"
  | "missing_required_field"
  | "invalid_field_format"
  | "counterparty_not_found"
  | "counterparty_fuzzy_match"
  | "counterparty_identifier_conflict"
  | "nomenclature_not_found"
  | "nomenclature_ambiguous"
  | "nomenclature_fuzzy_match"
  | "unit_mismatch"
  | "conversion_coefficient_missing"
  | "vat_mismatch"
  | "line_total_mismatch"
  | "technical_failure";

export type DocumentReviewSeverity = "info" | "warning" | "critical";

export type DocumentReviewIssue = {
  code: DocumentReviewIssueCode;
  severity: DocumentReviewSeverity;
  message: string;
  field?: string;
  lineId?: string;
  score?: number;
  resolved?: boolean;
};

export type DocumentReviewRuleInput = {
  phase: DocumentReviewPhase;
  confidence: number;
  requiredFieldsComplete: boolean;
  validationPassed: boolean;
  issues?: DocumentReviewIssue[];
  processingReadiness?: number;
};

export type DocumentReviewDecision = {
  status: DocumentReviewStatusCode;
  readiness: number;
  confidence: number;
  requiresReview: boolean;
  canSendToOneC: boolean;
  activeIssues: DocumentReviewIssue[];
};

const REMOVED_DOCUMENT_REVIEW_ISSUE_CODES = new Set([
  "duplicate_suspected",
  "similar_document_found",
  "one_c_reconciliation_mismatch"
]);

export function deriveDocumentReviewDecision(
  input: DocumentReviewRuleInput
): DocumentReviewDecision {
  const confidence = normalizeReviewScore(input.confidence);
  const activeIssues = (input.issues ?? []).filter((issue) => {
    const issueCode = String(issue.code);

    return issue.resolved !== true && !REMOVED_DOCUMENT_REVIEW_ISSUE_CODES.has(issueCode);
  });
  const hasCriticalIssue = activeIssues.some((issue) => issue.severity === "critical");
  const hasWarningIssue = activeIssues.some((issue) => issue.severity === "warning");
  const hasMissingRequiredField =
    !input.requiredFieldsComplete ||
    activeIssues.some((issue) => issue.code === "missing_required_field");
  const hasBlockingValidation = !input.validationPassed;

  if (input.phase === "sent") {
    return reviewDecision("sent_to_1c", 100, confidence, false, false, activeIssues);
  }

  if (input.phase === "failed") {
    return reviewDecision(
      "error",
      Math.min(normalizeReadiness(input.processingReadiness, 69), 69),
      confidence,
      true,
      false,
      activeIssues
    );
  }

  if (input.phase === "uploaded") {
    return reviewDecision(
      "uploaded",
      Math.min(normalizeReadiness(input.processingReadiness, 20), 20),
      confidence,
      false,
      false,
      activeIssues
    );
  }

  if (input.phase === "processing") {
    return reviewDecision(
      "recognizing",
      clampPercent(normalizeReadiness(input.processingReadiness, 45), 21, 45),
      confidence,
      false,
      false,
      activeIssues
    );
  }

  if (hasCriticalIssue || hasBlockingValidation || hasMissingRequiredField) {
    const cap = hasMissingRequiredField ? 79 : 84;

    return reviewDecision(
      "needs_review",
      Math.min(Math.max(Math.round(confidence * 100), 70), cap),
      confidence,
      true,
      false,
      activeIssues
    );
  }

  if (hasWarningIssue || confidence < 0.92) {
    const cap = confidence < 0.8 ? 84 : 94;

    return reviewDecision(
      "needs_review",
      Math.min(Math.max(Math.round(confidence * 100), 85), cap),
      confidence,
      true,
      false,
      activeIssues
    );
  }

  return reviewDecision("ready_to_send", 100, confidence, false, true, activeIssues);
}

function reviewDecision(
  status: DocumentReviewStatusCode,
  readiness: number,
  confidence: number,
  requiresReview: boolean,
  canSendToOneC: boolean,
  activeIssues: DocumentReviewIssue[]
): DocumentReviewDecision {
  return {
    status,
    readiness,
    confidence,
    requiresReview,
    canSendToOneC,
    activeIssues
  };
}

function normalizeReviewScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(Math.max(value, 0), 1);
}

function normalizeReadiness(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }

  return clampPercent(Math.round(value), 0, 100);
}

function clampPercent(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export const WRITE_PACKAGE_PAYLOAD_VERSION = 1 as const;

export const WRITE_TARGET_KINDS = ["fresh-odata", "local-json-export"] as const;

export type WriteTargetKind = (typeof WRITE_TARGET_KINDS)[number];

export const WRITE_OPERATIONS = ["create", "update", "delete", "post"] as const;

export type WriteOperation = (typeof WRITE_OPERATIONS)[number];

export type WriteApprovalStatus = "approved" | "pending" | "rejected";

export type WriteValidationStatus = "passed" | "failed" | "warning";

export type WritePackageJsonPrimitive = string | number | boolean | null;

export type WritePackageJsonValue =
  | WritePackageJsonPrimitive
  | WritePackageJsonValue[]
  | { readonly [key: string]: WritePackageJsonValue };

export type FinalDocumentField = {
  name: string;
  value: WritePackageJsonValue;
};

export type FinalDocumentReference = {
  name: string;
  fieldName: string;
  targetResourceName?: string;
  targetKey: string;
};

export type FinalDocumentForWrite = {
  draftId: string;
  metadataSnapshotId: string;
  schemaHash: string;
  resourceName: string;
  approvalStatus: WriteApprovalStatus;
  validationStatus: WriteValidationStatus;
  fields: FinalDocumentField[];
  references?: FinalDocumentReference[];
  idempotencyKey: string;
  correlationId: string;
};

export type WritePackageMetadataField = {
  name: string;
  typeName: string;
  nullable: boolean;
  isKey: boolean;
  isReference: boolean;
};

export type WritePackageMetadataObject = {
  name: string;
  resourceName: string;
  fields: WritePackageMetadataField[];
  keys: string[];
};

export type WritePackageRequest = {
  payloadVersion: typeof WRITE_PACKAGE_PAYLOAD_VERSION;
  targetKind: WriteTargetKind;
  operation: WriteOperation;
  document: FinalDocumentForWrite;
  metadataObject: WritePackageMetadataObject;
};

export type WritePackageCheckStatus = "passed";

export type WritePackageCheckCode =
  | "payload-version"
  | "approval-status"
  | "validation-status"
  | "required-identifiers"
  | "operation-supported"
  | "metadata-resource"
  | "metadata-fields"
  | "required-fields"
  | "secret-boundary"
  | "execution-boundary";

export type WritePackageCheck = {
  code: WritePackageCheckCode;
  status: WritePackageCheckStatus;
  message: string;
  field?: string;
  remediation?: string;
};

export type ODataRequestArtifact = {
  kind: "odata-request";
  method: "POST";
  relativePath: string;
  query: {
    "$format": "json";
  };
  headers: {
    accept: "application/json";
    contentType: "application/json";
  };
  body: Record<string, WritePackageJsonValue>;
  bodyHash: string;
  willExecute: false;
  willWriteTo1C: false;
};

export type LocalJsonExportPackage = {
  formatVersion: 1;
  draftId: string;
  metadataSnapshotId: string;
  schemaHash: string;
  resourceName: string;
  operation: "create";
  fields: Record<string, WritePackageJsonValue>;
  references: FinalDocumentReference[];
  idempotencyKey: string;
};

export type LocalJsonExportArtifact = {
  kind: "local-json-export";
  mediaType: "application/json";
  fileName: string;
  package: LocalJsonExportPackage;
  packageHash: string;
  willWriteFile: false;
  willWriteTo1C: false;
};

export type WritePackagePlan = {
  planId: string;
  targetKind: WriteTargetKind;
  operation: "create";
  draftId: string;
  metadataSnapshotId: string;
  schemaHash: string;
  idempotencyKey: string;
  correlationId: string;
  checks: WritePackageCheck[];
  artifact: ODataRequestArtifact | LocalJsonExportArtifact;
};

export type WritePackagePlanErrorCode =
  | "invalidPayloadVersion"
  | "approvalRequired"
  | "validationRequired"
  | "invalidIdentifier"
  | "unsupportedOperation"
  | "metadataMismatch"
  | "unknownField"
  | "missingRequiredField"
  | "duplicateField"
  | "secretMaterialRejected";

export type WritePackagePlanError = {
  code: WritePackagePlanErrorCode;
  message: string;
  retryable: boolean;
  remediation: string;
  field?: string;
  correlationId?: string;
};

export const COUNTERPARTY_RESOLUTION_PAYLOAD_VERSION = 1 as const;

export type ExtractedCounterpartyInput = {
  rawName: string;
  inn?: string;
  kpp?: string;
  sourceField?: string;
  extractionConfidence?: number;
};

export type CounterpartyCandidate = {
  candidateId: string;
  displayName: string;
  inn?: string;
  kpp?: string;
  metadataSnapshotId?: string;
  sourceResourceName?: string;
};

export type CounterpartyResolutionOptions = {
  autoAcceptThreshold?: number;
  nameOnlyScoreCap?: number;
  identifierMismatchScoreCap?: number;
  maxCandidates?: number;
};

export type CounterpartyResolutionRequest = {
  payloadVersion: typeof COUNTERPARTY_RESOLUTION_PAYLOAD_VERSION;
  tenantId: string;
  metadataSnapshotId: string;
  documentId?: string;
  draftId?: string;
  correlationId: string;
  extracted: ExtractedCounterpartyInput;
  candidates: CounterpartyCandidate[];
  options?: CounterpartyResolutionOptions;
};

export type CounterpartyMatchSignalCode =
  | "inn-kpp-exact"
  | "inn-exact"
  | "kpp-exact"
  | "name-fuzzy"
  | "identifier-conflict";

export type CounterpartyMatchSignal = {
  code: CounterpartyMatchSignalCode;
  score: number;
};

export type CounterpartyMatchWarningSeverity = "info" | "warning" | "severe";

export type CounterpartyMatchWarningCode =
  | "inn-mismatch"
  | "kpp-mismatch"
  | "identifier-name-conflict"
  | "invalid-extracted-identifier"
  | "invalid-candidate-identifier"
  | "low-name-similarity"
  | "missing-extracted-name"
  | "missing-candidate-identifier";

export type CounterpartyMatchWarning = {
  code: CounterpartyMatchWarningCode;
  severity: CounterpartyMatchWarningSeverity;
  message: string;
};

export type CounterpartyMatchCandidate = {
  entityType: "counterparty";
  candidateId: string;
  displayName: string;
  score: number;
  matchReasons: string[];
  signals: CounterpartyMatchSignal[];
  warnings: CounterpartyMatchWarning[];
  requiresReview: boolean;
};

export type CounterpartyResolutionResult = {
  entityType: "counterparty";
  tenantId: string;
  metadataSnapshotId: string;
  correlationId: string;
  candidates: CounterpartyMatchCandidate[];
  requiresReview: boolean;
};

export const NOMENCLATURE_RESOLUTION_PAYLOAD_VERSION = 1 as const;

export type ExtractedNomenclatureItemInput = {
  rawName: string;
  vendorCode?: string;
  sku?: string;
  barcode?: string;
  unit?: string;
  supplierCounterpartyId?: string;
  supplierItemCode?: string;
  sourceLineId?: string;
  extractionConfidence?: number;
};

export type NomenclatureSupplierAlias = {
  counterpartyId: string;
  displayName?: string;
  supplierItemCode?: string;
  vendorCode?: string;
  sku?: string;
  barcode?: string;
};

export type NomenclatureCandidate = {
  candidateId: string;
  displayName: string;
  vendorCode?: string;
  sku?: string;
  barcode?: string;
  unit?: string;
  metadataSnapshotId?: string;
  sourceResourceName?: string;
  supplierAliases?: NomenclatureSupplierAlias[];
};

export type NomenclatureResolutionOptions = {
  autoAcceptThreshold?: number;
  nameOnlyScoreCap?: number;
  unitMismatchScoreCap?: number;
  maxCandidates?: number;
};

export type NomenclatureResolutionRequest = {
  payloadVersion: typeof NOMENCLATURE_RESOLUTION_PAYLOAD_VERSION;
  tenantId: string;
  metadataSnapshotId: string;
  documentId?: string;
  draftId?: string;
  correlationId: string;
  extracted: ExtractedNomenclatureItemInput;
  candidates: NomenclatureCandidate[];
  options?: NomenclatureResolutionOptions;
};

export type NomenclatureMatchSignalCode =
  | "barcode-exact"
  | "supplier-code-exact"
  | "vendor-code-exact"
  | "sku-exact"
  | "name-fuzzy"
  | "unit-compatible"
  | "unit-mismatch";

export type NomenclatureMatchSignal = {
  code: NomenclatureMatchSignalCode;
  score: number;
};

export type NomenclatureMatchWarningSeverity = "info" | "warning" | "severe";

export type NomenclatureMatchWarningCode =
  | "unit-mismatch"
  | "supplier-context-only"
  | "invalid-extracted-identifier"
  | "invalid-candidate-identifier"
  | "low-name-similarity"
  | "missing-extracted-name"
  | "missing-candidate-identifier";

export type NomenclatureMatchWarning = {
  code: NomenclatureMatchWarningCode;
  severity: NomenclatureMatchWarningSeverity;
  message: string;
};

export type NomenclatureMatchCandidate = {
  entityType: "nomenclature";
  candidateId: string;
  displayName: string;
  score: number;
  matchReasons: string[];
  signals: NomenclatureMatchSignal[];
  warnings: NomenclatureMatchWarning[];
  requiresReview: boolean;
};

export type NomenclatureResolutionResult = {
  entityType: "nomenclature";
  tenantId: string;
  metadataSnapshotId: string;
  correlationId: string;
  sourceLineId?: string;
  candidates: NomenclatureMatchCandidate[];
  requiresReview: boolean;
};

export * from "./state-machines.js";
