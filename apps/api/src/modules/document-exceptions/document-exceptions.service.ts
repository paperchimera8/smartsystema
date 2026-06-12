import { HttpException, Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type {
  CreateDocumentExceptionRequest,
  CreateDocumentExceptionResponse,
  DocumentExceptionCategory,
  DocumentExceptionPriority,
  DocumentExceptionQueueName,
  DocumentExceptionSeverity,
  DocumentExceptionSignal,
  DocumentExceptionSignalCode,
  DocumentExceptionStage
} from "@automator/contracts";
import {
  DOCUMENT_EXCEPTION_PAYLOAD_VERSION,
  DOCUMENT_EXCEPTION_SIGNAL_CODES,
  DOCUMENT_EXCEPTION_STAGES,
  EXCEPTION_QUEUE_INITIAL_STATE
} from "@automator/contracts";
import {
  documentExceptionBadRequest,
  documentExceptionConflict,
  documentExceptionServiceUnavailable
} from "./document-exceptions.errors";
import {
  DocumentExceptionsRepository,
  isUniqueConstraintViolation,
  mapDocumentExceptionRowToResponse,
  type PersistDocumentExceptionInput
} from "./document-exceptions.repository";

const FORBIDDEN_ROOT_FIELDS = new Set([
  "agentCommand",
  "approvalStatus",
  "assignedToUserId",
  "category",
  "commandId",
  "exceptionId",
  "lifecycleStatus",
  "operation",
  "priority",
  "queueName",
  "resolvedAt",
  "status",
  "targetKind",
  "writePackage",
  "writeStatus"
]);

const MAX_JSON_DEPTH = 12;
const MAX_EXCEPTION_SIGNALS = 100;
const MAX_IDENTIFIER_LENGTH = 240;
const MAX_SIGNAL_MESSAGE_LENGTH = 300;
const VALID_SEVERITIES = ["info", "warning", "critical"] as const;
const CATEGORY_SUGGESTED_ACTIONS: Record<DocumentExceptionCategory, string[]> = {
  ocr_failed: [
    "Retry OCR with the configured provider or send the file to manual intake if retry fails."
  ],
  unsupported_document: [
    "Route the document to manual processing and add a classifier rule before automating this type."
  ],
  low_confidence: [
    "Open accountant review and confirm low-confidence fields before draft creation."
  ],
  counterparty_issue: [
    "Confirm the counterparty candidate or ask an administrator to add the missing 1C catalog entry."
  ],
  nomenclature_issue: [
    "Confirm the nomenclature candidate or select the correct catalog item before draft creation."
  ],
  unit_mismatch: ["Confirm accounting units and conversion coefficients before draft creation."],
  vat_mismatch: ["Review VAT and totals before draft creation."],
  metadata_gap: [
    "Ask a 1C administrator to publish missing metadata or refresh the metadata snapshot."
  ],
  validation_failed: ["Fix blocking validation errors before draft creation or write planning."],
  policy_blocked: [
    "Review tenant policy and route the document manually until the policy is updated."
  ]
};

const BASE_SIGNAL_ROUTE_RANK: Record<DocumentExceptionSignalCode, number> = {
  policy_blocked: 100,
  ocr_failed: 95,
  unsupported_document_type: 92,
  validation_error: 88,
  metadata_gap: 84,
  counterparty_not_found: 74,
  nomenclature_not_found: 73,
  counterparty_ambiguous: 70,
  nomenclature_ambiguous: 69,
  unit_mismatch: 64,
  vat_mismatch: 62,
  low_document_confidence: 56,
  low_field_confidence: 54
};

const VALID_ENTITY_KINDS = [
  "counterparty",
  "nomenclature",
  "unit",
  "document",
  "metadata",
  "validation"
] as const;

type NormalizedDocumentExceptionInput = Omit<
  PersistDocumentExceptionInput,
  "exceptionId" | "requestHash" | "createdAt"
>;

type RouteDecision = Pick<
  PersistDocumentExceptionInput,
  | "category"
  | "queueName"
  | "priority"
  | "requiresAccountantReview"
  | "requiresAdminReview"
  | "topSignalCode"
  | "suggestedActions"
>;
type DocumentExceptionEntityKind = NonNullable<DocumentExceptionSignal["entityKind"]>;

@Injectable()
export class DocumentExceptionsService {
  constructor(private readonly repository: DocumentExceptionsRepository) {}

  async createException(
    request: CreateDocumentExceptionRequest
  ): Promise<CreateDocumentExceptionResponse> {
    const normalized = normalizeDocumentExceptionRequest(request);
    const requestHash = hashDocumentExceptionRequest(normalized);
    const existing = await this.repository.findByTenantAndIdempotencyKey(
      normalized.tenantId,
      normalized.idempotencyKey
    );

    if (existing !== undefined) {
      if (existing.requestHash !== requestHash) {
        throw documentExceptionConflict({
          code: "idempotencyConflict",
          message: "An exception already exists for this idempotency key with a different payload.",
          retryable: false,
          remediation: "Retry with the original payload or use a new idempotency key.",
          correlationId: normalized.correlationId
        });
      }

      return mapDocumentExceptionRowToResponse(existing, true);
    }

    try {
      return await this.repository.createExceptionAndAudit({
        ...normalized,
        exceptionId: `exception_${randomUUID()}`,
        requestHash,
        createdAt: new Date()
      });
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      if (isUniqueConstraintViolation(error)) {
        const replay = await this.repository.findByTenantAndIdempotencyKey(
          normalized.tenantId,
          normalized.idempotencyKey
        );

        if (replay !== undefined && replay.requestHash === requestHash) {
          return mapDocumentExceptionRowToResponse(replay, true);
        }

        throw documentExceptionConflict({
          code: "idempotencyConflict",
          message: "An exception already exists for this idempotency key with a different payload.",
          retryable: false,
          remediation: "Retry with the original payload or use a new idempotency key.",
          correlationId: normalized.correlationId
        });
      }

      throw documentExceptionServiceUnavailable({
        code: "persistenceUnavailable",
        message: "Document exception persistence is temporarily unavailable.",
        retryable: true,
        remediation: "Retry the request after the database is healthy.",
        correlationId: normalized.correlationId
      });
    }
  }
}

export function normalizeDocumentExceptionRequest(
  request: CreateDocumentExceptionRequest
): NormalizedDocumentExceptionInput {
  assertRequestObject(request);
  assertPayloadVersion(request);
  assertForbiddenRootFieldsAbsent(request);
  assertNoSecretLikeMaterial(request);
  assertNoRawDocumentMaterial(request);

  const correlationId = extractCorrelationId(request);
  const signals = normalizeSignals(
    requireArray(request.signals, "signals", correlationId, MAX_EXCEPTION_SIGNALS, 1),
    correlationId
  );
  const routeDecision = routeDocumentException(signals);

  const normalized: NormalizedDocumentExceptionInput = {
    tenantId: requireTrimmed(request.tenantId, "tenantId", correlationId),
    documentId: requireTrimmed(request.documentId, "documentId", correlationId),
    ...optionalString("draftId", request.draftId, "draftId", correlationId),
    ...optionalString(
      "metadataSnapshotId",
      request.metadataSnapshotId,
      "metadataSnapshotId",
      correlationId
    ),
    ...optionalString("schemaHash", request.schemaHash, "schemaHash", correlationId),
    stage: requireStage(request.stage, "stage", correlationId),
    signals,
    idempotencyKey: requireTrimmed(request.idempotencyKey, "idempotencyKey", correlationId),
    correlationId: requireTrimmed(request.correlationId, "correlationId", correlationId),
    createdByUserId: requireTrimmed(request.createdByUserId, "createdByUserId", correlationId),
    ...routeDecision
  };

  assertNoSecretLikeMaterial(normalized);
  assertNoRawDocumentMaterial(normalized);

  return normalized;
}

export function hashDocumentExceptionRequest(request: NormalizedDocumentExceptionInput): string {
  return createHash("sha256").update(stableStringify(request)).digest("hex");
}

export function routeDocumentException(signals: DocumentExceptionSignal[]): RouteDecision {
  const topSignal = [...signals].sort(compareSignalsForRouting)[0];

  if (topSignal === undefined) {
    throw documentExceptionBadRequest({
      code: "invalidExceptionInput",
      message: "At least one exception signal is required.",
      retryable: false,
      remediation: "Provide a compact signal describing why the document cannot continue."
    });
  }

  const category = categoryForSignal(topSignal.code);
  const queueName = queueForCategory(category);
  const requiresAdminReview = category === "metadata_gap" || category === "policy_blocked";
  const requiresAccountantReview = !["metadata_gap", "ocr_failed"].includes(category);
  const priority = priorityForSignal(topSignal, category);
  const suggestedActions = suggestedActionsForCategory(category, topSignal.code);

  return {
    category,
    queueName,
    priority,
    requiresAccountantReview,
    requiresAdminReview,
    topSignalCode: topSignal.code,
    suggestedActions
  };
}

function assertPayloadVersion(request: CreateDocumentExceptionRequest): void {
  if (request.payloadVersion !== DOCUMENT_EXCEPTION_PAYLOAD_VERSION) {
    throw documentExceptionBadRequest({
      code: "invalidPayloadVersion",
      message: "Unsupported document exception payload version.",
      retryable: false,
      remediation: "Use payloadVersion 1.",
      correlationId: extractCorrelationId(request)
    });
  }
}

function assertForbiddenRootFieldsAbsent(request: CreateDocumentExceptionRequest): void {
  const rawRequest = request as unknown as Record<string, unknown>;

  for (const field of FORBIDDEN_ROOT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(rawRequest, field)) {
      throw documentExceptionBadRequest({
        code: "invalidExceptionInput",
        message: "Document exception routing does not accept lifecycle, queue, approval, or write fields.",
        retryable: false,
        remediation: "Submit only signals and durable identifiers; the service chooses the queue.",
        field,
        correlationId:
          typeof rawRequest.correlationId === "string" ? rawRequest.correlationId : undefined
      });
    }
  }
}

function normalizeSignals(
  signals: unknown[],
  correlationId: string | undefined
): DocumentExceptionSignal[] {
  const normalizedSignals = signals.map((signal, index) =>
    normalizeSignal(signal, index, correlationId)
  );

  return normalizedSignals.sort((left, right) => {
    const codeComparison = left.code.localeCompare(right.code, "en");

    if (codeComparison !== 0) {
      return codeComparison;
    }

    return severityRank(right.severity) - severityRank(left.severity)
      || optionalCompare(left.field, right.field)
      || optionalCompare(left.lineId, right.lineId)
      || left.message.localeCompare(right.message, "en");
  });
}

function normalizeSignal(
  signal: unknown,
  index: number,
  correlationId: string | undefined
): DocumentExceptionSignal {
  const record = requirePlainObject(signal, `signals.${index}`, correlationId);
  const code = requireSignalCode(record.code, `signals.${index}.code`, correlationId);
  const severity = requireSeverity(record.severity, `signals.${index}.severity`, correlationId);

  return {
    code,
    severity,
    message: requireTrimmed(
      record.message,
      `signals.${index}.message`,
      correlationId,
      MAX_SIGNAL_MESSAGE_LENGTH
    ),
    ...optionalString("field", record.field, `signals.${index}.field`, correlationId),
    ...optionalString("lineId", record.lineId, `signals.${index}.lineId`, correlationId),
    ...optionalEntityKind(record.entityKind, `signals.${index}.entityKind`, correlationId),
    ...optionalScore("score", record.score, `signals.${index}.score`, correlationId),
    ...optionalCandidateCount(
      "candidateCount",
      record.candidateCount,
      `signals.${index}.candidateCount`,
      correlationId
    )
  };
}

function compareSignalsForRouting(
  left: DocumentExceptionSignal,
  right: DocumentExceptionSignal
): number {
  return signalRouteRank(right) - signalRouteRank(left)
    || severityRank(right.severity) - severityRank(left.severity)
    || left.code.localeCompare(right.code, "en")
    || optionalCompare(left.field, right.field)
    || optionalCompare(left.lineId, right.lineId);
}

function signalRouteRank(signal: DocumentExceptionSignal): number {
  // Extra penalty when a confidence signal has a very low score, pushing it
  // higher in the routing queue than a barely-below-threshold confidence score.
  const scorePenalty =
    signal.score !== undefined && signal.score < 0.5 && signal.code.includes("confidence")
      ? 8
      : 0;

  return BASE_SIGNAL_ROUTE_RANK[signal.code] + severityRank(signal.severity) * 10 + scorePenalty;
}

function categoryForSignal(code: DocumentExceptionSignalCode): DocumentExceptionCategory {
  switch (code) {
    case "ocr_failed":
      return "ocr_failed";
    case "unsupported_document_type":
      return "unsupported_document";
    case "low_document_confidence":
    case "low_field_confidence":
      return "low_confidence";
    case "counterparty_not_found":
    case "counterparty_ambiguous":
      return "counterparty_issue";
    case "nomenclature_not_found":
    case "nomenclature_ambiguous":
      return "nomenclature_issue";
    case "unit_mismatch":
      return "unit_mismatch";
    case "vat_mismatch":
      return "vat_mismatch";
    case "metadata_gap":
      return "metadata_gap";
    case "validation_error":
      return "validation_failed";
    case "policy_blocked":
      return "policy_blocked";
  }
}

function queueForCategory(category: DocumentExceptionCategory): DocumentExceptionQueueName {
  switch (category) {
    case "ocr_failed":
      return "ocr_retry";
    case "metadata_gap":
      return "admin_setup";
    case "unsupported_document":
    case "policy_blocked":
      return "manual_processing";
    case "low_confidence":
    case "counterparty_issue":
    case "nomenclature_issue":
    case "unit_mismatch":
    case "vat_mismatch":
    case "validation_failed":
      return "accountant_review";
  }
}

function priorityForSignal(
  signal: DocumentExceptionSignal,
  category: DocumentExceptionCategory
): DocumentExceptionPriority {
  if (
    signal.severity === "critical" &&
    ["ocr_failed", "metadata_gap", "policy_blocked", "validation_failed"].includes(category)
  ) {
    return "urgent";
  }

  if (
    signal.severity === "critical" ||
    (signal.score !== undefined && signal.score < 0.5)
  ) {
    return "high";
  }

  if (signal.severity === "warning") {
    return "normal";
  }

  return "low";
}

function suggestedActionsForCategory(
  category: DocumentExceptionCategory,
  code: DocumentExceptionSignalCode
): string[] {
  if (code === "nomenclature_ambiguous") {
    return [
      "Confirm the nomenclature candidate or choose another catalog item.",
      ...CATEGORY_SUGGESTED_ACTIONS[category]
    ];
  }

  if (code === "low_document_confidence" || code === "low_field_confidence") {
    return [
      "Review OCR and mapped fields with low confidence before draft creation.",
      ...CATEGORY_SUGGESTED_ACTIONS[category]
    ];
  }

  return CATEGORY_SUGGESTED_ACTIONS[category];
}

function requireStage(
  value: unknown,
  field: string,
  correlationId: string | undefined
): DocumentExceptionStage {
  if (
    typeof value !== "string" ||
    !(DOCUMENT_EXCEPTION_STAGES as readonly string[]).includes(value)
  ) {
    throw documentExceptionBadRequest({
      code: "invalidExceptionInput",
      message: "Document exception stage is not supported.",
      retryable: false,
      remediation: "Use a documented processing stage.",
      field,
      correlationId
    });
  }

  return value as DocumentExceptionStage;
}

function requireSignalCode(
  value: unknown,
  field: string,
  correlationId: string | undefined
): DocumentExceptionSignalCode {
  if (
    typeof value !== "string" ||
    !(DOCUMENT_EXCEPTION_SIGNAL_CODES as readonly string[]).includes(value)
  ) {
    throw documentExceptionBadRequest({
      code: "invalidExceptionInput",
      message: "Document exception signal code is not supported.",
      retryable: false,
      remediation: "Use a documented exception signal code.",
      field,
      correlationId
    });
  }

  return value as DocumentExceptionSignalCode;
}

function requireSeverity(
  value: unknown,
  field: string,
  correlationId: string | undefined
): DocumentExceptionSeverity {
  if (typeof value !== "string" || !(VALID_SEVERITIES as readonly string[]).includes(value)) {
    throw documentExceptionBadRequest({
      code: "invalidExceptionInput",
      message: "Document exception signal severity is not supported.",
      retryable: false,
      remediation: "Use info, warning, or critical.",
      field,
      correlationId
    });
  }

  return value as DocumentExceptionSeverity;
}

function optionalEntityKind(
  value: unknown,
  field: string,
  correlationId: string | undefined
): { entityKind?: DocumentExceptionEntityKind } {
  if (value === undefined) {
    return {};
  }

  if (typeof value !== "string" || !(VALID_ENTITY_KINDS as readonly string[]).includes(value)) {
    throw documentExceptionBadRequest({
      code: "invalidExceptionInput",
      message: "Document exception signal entity kind is not supported.",
      retryable: false,
      remediation: "Use a documented entity kind.",
      field,
      correlationId
    });
  }

  return { entityKind: value as DocumentExceptionEntityKind };
}

function optionalString<K extends string>(
  key: K,
  value: unknown,
  field: string,
  correlationId: string | undefined
): { [P in K]?: string } {
  if (value === undefined) {
    return {};
  }

  if (typeof value !== "string") {
    throw documentExceptionBadRequest({
      code: "invalidExceptionInput",
      message: "Optional document exception fields must be strings.",
      retryable: false,
      remediation: "Remove unsupported optional values before routing the exception.",
      field,
      correlationId
    });
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return {};
  }

  return { [key]: requireTrimmed(trimmed, field, correlationId) } as { [P in K]: string };
}

function optionalScore<K extends string>(
  key: K,
  value: unknown,
  field: string,
  correlationId: string | undefined
): { [P in K]?: number } {
  if (value === undefined) {
    return {};
  }

  return { [key]: requireScore(value, field, correlationId) } as { [P in K]: number };
}

function optionalCandidateCount<K extends string>(
  key: K,
  value: unknown,
  field: string,
  correlationId: string | undefined
): { [P in K]?: number } {
  if (value === undefined) {
    return {};
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 1000) {
    throw documentExceptionBadRequest({
      code: "invalidExceptionInput",
      message: "Candidate count must be an integer between 0 and 1000.",
      retryable: false,
      remediation: "Provide a bounded candidate count.",
      field,
      correlationId
    });
  }

  return { [key]: value } as { [P in K]: number };
}

function requireScore(value: unknown, field: string, correlationId: string | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw documentExceptionBadRequest({
      code: "invalidExceptionInput",
      message: "Confidence scores must be between 0 and 1.",
      retryable: false,
      remediation: "Provide a normalized confidence score.",
      field,
      correlationId
    });
  }

  return value;
}

function requireTrimmed(
  value: unknown,
  field: string,
  correlationId: string | undefined,
  maxLength = MAX_IDENTIFIER_LENGTH
): string {
  if (typeof value !== "string") {
    throw documentExceptionBadRequest({
      code: "invalidExceptionInput",
      message: "Required document exception fields must be strings.",
      retryable: false,
      remediation: "Provide a non-empty string value.",
      field,
      correlationId
    });
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw documentExceptionBadRequest({
      code: "invalidExceptionInput",
      message: "Required document exception fields must not be empty.",
      retryable: false,
      remediation: "Provide a non-empty value.",
      field,
      correlationId
    });
  }

  if (trimmed.length > maxLength) {
    throw documentExceptionBadRequest({
      code: "invalidExceptionInput",
      message: "Document exception string fields are too large.",
      retryable: false,
      remediation: "Store large artifacts separately and pass compact identifiers.",
      field,
      correlationId
    });
  }

  if (containsRawDocumentMarker(trimmed)) {
    throw documentExceptionBadRequest({
      code: "invalidExceptionInput",
      message: "Raw document or OCR text cannot be stored in exception routing payloads.",
      retryable: false,
      remediation: "Store raw content in object storage and pass only durable references.",
      field,
      correlationId
    });
  }

  return trimmed;
}

function requireArray(
  value: unknown,
  field: string,
  correlationId: string | undefined,
  maxLength: number,
  minLength = 0
): unknown[] {
  if (!Array.isArray(value)) {
    throw documentExceptionBadRequest({
      code: "invalidExceptionInput",
      message: "Document exception payload arrays must be arrays.",
      retryable: false,
      remediation: "Provide an array value.",
      field,
      correlationId
    });
  }

  if (value.length < minLength) {
    throw documentExceptionBadRequest({
      code: "invalidExceptionInput",
      message: "Document exception routing requires at least one signal.",
      retryable: false,
      remediation: "Provide at least one compact signal.",
      field,
      correlationId
    });
  }

  if (value.length > maxLength) {
    throw documentExceptionBadRequest({
      code: "invalidExceptionInput",
      message: "Document exception payload arrays are too large.",
      retryable: false,
      remediation: "Split the exception routing event or store large artifacts separately.",
      field,
      correlationId
    });
  }

  return value;
}

function assertRequestObject(request: unknown): asserts request is CreateDocumentExceptionRequest {
  requirePlainObject(request, "request", extractCorrelationId(request));
}

function requirePlainObject(
  value: unknown,
  field: string,
  correlationId: string | undefined
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw documentExceptionBadRequest({
      code: "invalidExceptionInput",
      message: "Document exception payload sections must be JSON objects.",
      retryable: false,
      remediation: "Provide a JSON object with the required exception routing fields.",
      field,
      correlationId
    });
  }

  return value as Record<string, unknown>;
}

function assertNoSecretLikeMaterial(value: unknown): void {
  if (containsSecretLikeMaterial(value, new WeakSet())) {
    throw documentExceptionBadRequest({
      code: "secretMaterialRejected",
      message: "Document exception payload contains secret-like material.",
      retryable: false,
      remediation: "Store credentials only in secure storage and pass secure references.",
      correlationId: extractCorrelationId(value)
    });
  }
}

function assertNoRawDocumentMaterial(value: unknown): void {
  if (containsRawDocumentMaterial(value, new WeakSet())) {
    throw documentExceptionBadRequest({
      code: "invalidExceptionInput",
      message: "Raw document or OCR text cannot be stored in exception routing payloads.",
      retryable: false,
      remediation: "Store raw content in object storage and pass only durable references.",
      correlationId: extractCorrelationId(value)
    });
  }
}

function containsSecretLikeMaterial(
  value: unknown,
  seen: WeakSet<object>,
  depth = 0
): boolean {
  if (depth > MAX_JSON_DEPTH) {
    return true;
  }

  if (typeof value === "string") {
    const lower = value.toLowerCase();
    const compact = lower.replace(/[\s._-]+/g, "");

    return (
      lower.includes("password=") ||
      lower.includes("password:") ||
      lower.includes("pwd=") ||
      lower.includes("token=") ||
      lower.includes("token:") ||
      lower.includes("access_token") ||
      compact.includes("accesstoken") ||
      compact.includes("refreshtoken") ||
      compact.includes("authtoken") ||
      compact.includes("apikey") ||
      compact.includes("clientsecret") ||
      lower.includes("authorization:") ||
      lower.includes("bearer ") ||
      lower.includes("connectionstring=") ||
      lower.includes("connection string") ||
      lower.includes("private_key") ||
      lower.includes("begin private key")
    );
  }

  if (Array.isArray(value)) {
    return value.some((item) => containsSecretLikeMaterial(item, seen, depth + 1));
  }

  if (typeof value === "object" && value !== null) {
    if (seen.has(value)) {
      return false;
    }

    seen.add(value);

    return Object.entries(value).some(
      ([key, item]) =>
        containsSecretLikeMaterial(key, seen, depth + 1) ||
        containsSecretLikeMaterial(item, seen, depth + 1)
    );
  }

  return false;
}

function containsRawDocumentMaterial(
  value: unknown,
  seen: WeakSet<object>,
  depth = 0
): boolean {
  if (depth > MAX_JSON_DEPTH) {
    return true;
  }

  if (typeof value === "string") {
    return containsRawDocumentMarker(value);
  }

  if (Array.isArray(value)) {
    return value.some((item) => containsRawDocumentMaterial(item, seen, depth + 1));
  }

  if (typeof value === "object" && value !== null) {
    if (seen.has(value)) {
      return false;
    }

    seen.add(value);

    return Object.entries(value).some(
      ([key, item]) =>
        containsRawDocumentMaterial(key, seen, depth + 1) ||
        containsRawDocumentMaterial(item, seen, depth + 1)
    );
  }

  return false;
}

function containsRawDocumentMarker(value: string): boolean {
  const lower = value.toLowerCase();

  return (
    lower.includes("rawocr") ||
    lower.includes("raw_ocr") ||
    lower.includes("rawtext") ||
    lower.includes("raw_text") ||
    lower.includes("rawdocument") ||
    lower.includes("raw_document") ||
    lower.includes("ocrtext") ||
    lower.includes("ocr_text") ||
    lower.includes("documentcontent") ||
    lower.includes("document_content") ||
    lower.includes("documentbody") ||
    lower.includes("document_body") ||
    lower.includes("filebytes") ||
    lower.includes("file_bytes") ||
    lower.includes("imagebytes") ||
    lower.includes("image_bytes") ||
    lower.includes("base64document") ||
    lower.includes("base64_document")
  );
}

function extractCorrelationId(value: unknown): string | undefined {
  if (
    typeof value === "object" &&
    value !== null &&
    "correlationId" in value &&
    typeof (value as { correlationId?: unknown }).correlationId === "string"
  ) {
    return (value as { correlationId: string }).correlationId;
  }

  return undefined;
}

function severityRank(severity: DocumentExceptionSeverity): number {
  switch (severity) {
    case "critical":
      return 3;
    case "warning":
      return 2;
    case "info":
      return 1;
  }
}

function optionalCompare(left: string | undefined, right: string | undefined): number {
  return (left ?? "").localeCompare(right ?? "", "en");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  return `{${Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`;
}
