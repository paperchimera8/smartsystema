import { HttpException, Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type {
  CreateDraftRequest,
  CreateDraftResponse,
  DraftConfidence,
  DraftField,
  DraftJsonValue,
  DraftReference,
  DraftValidationMessage,
  DraftValidationSummary
} from "@automator/contracts";
import { DRAFT_CREATION_PAYLOAD_VERSION } from "@automator/contracts";
import {
  draftBadRequest,
  draftConflict,
  draftServiceUnavailable
} from "./drafts.errors";
import {
  DraftsRepository,
  isUniqueConstraintViolation,
  mapDraftRowToResponse,
  type PersistDraftInput
} from "./drafts.repository";

const FORBIDDEN_ROOT_FIELDS = new Set([
  "agentCommand",
  "approvalStatus",
  "commandId",
  "lifecycleStatus",
  "operation",
  "targetKind",
  "writePackage",
  "writeStatus"
]);

const MAX_JSON_DEPTH = 12;
const MAX_JSON_ARRAY_LENGTH = 500;
const MAX_JSON_OBJECT_KEYS = 500;
const MAX_JSON_OBJECT_KEY_LENGTH = 160;
const MAX_JSON_STRING_LENGTH = 4_000;
const MAX_DRAFT_FIELDS = 250;
const MAX_DRAFT_REFERENCES = 250;
const MAX_CONFIDENCE_REASONS = 40;
const MAX_VALIDATION_MESSAGES = 200;
const MAX_IDENTIFIER_LENGTH = 240;
const MAX_REASON_LENGTH = 300;
const MAX_VALIDATION_MESSAGE_LENGTH = 400;
const VALID_VALIDATION_STATUSES = ["passed", "warning", "failed"] as const;
const VALID_VALIDATION_SEVERITIES = ["error", "warning", "info"] as const;

export type NormalizedDraftCreation = Omit<
  PersistDraftInput,
  "draftId" | "requestHash" | "createdAt"
>;

@Injectable()
export class DraftsService {
  constructor(private readonly repository: DraftsRepository) {}

  async createDraft(request: CreateDraftRequest): Promise<CreateDraftResponse> {
    const normalized = normalizeDraftCreationRequest(request);
    const requestHash = hashDraftRequest(normalized);
    const existing = await this.repository.findByTenantAndIdempotencyKey(
      normalized.tenantId,
      normalized.idempotencyKey
    );

    if (existing !== undefined) {
      if (existing.requestHash !== requestHash) {
        throw draftConflict({
          code: "idempotencyConflict",
          message: "A draft already exists for this idempotency key with a different payload.",
          retryable: false,
          remediation: "Retry with the original payload or use a new idempotency key.",
          correlationId: normalized.correlationId
        });
      }

      return mapDraftRowToResponse(existing, true);
    }

    try {
      return await this.repository.createDraftAndAudit({
        ...normalized,
        draftId: `draft_${randomUUID()}`,
        requestHash,
        createdAt: new Date()
      });
    } catch (error) {
      // Propagate structured HTTP errors (e.g. internal invariant violations)
      // without re-wrapping them as a misleading 503 service-unavailable.
      if (error instanceof HttpException) {
        throw error;
      }

      if (isUniqueConstraintViolation(error)) {
        const replay = await this.repository.findByTenantAndIdempotencyKey(
          normalized.tenantId,
          normalized.idempotencyKey
        );

        if (replay !== undefined && replay.requestHash === requestHash) {
          return mapDraftRowToResponse(replay, true);
        }

        throw draftConflict({
          code: "idempotencyConflict",
          message: "A draft already exists for this idempotency key with a different payload.",
          retryable: false,
          remediation: "Retry with the original payload or use a new idempotency key.",
          correlationId: normalized.correlationId
        });
      }

      throw draftServiceUnavailable({
        code: "persistenceUnavailable",
        message: "Draft persistence is temporarily unavailable.",
        retryable: true,
        remediation: "Retry the request after the database is healthy.",
        correlationId: normalized.correlationId
      });
    }
  }
}

export function normalizeDraftCreationRequest(
  request: CreateDraftRequest
): NormalizedDraftCreation {
  assertRequestObject(request);
  assertPayloadVersion(request);
  assertForbiddenRootFieldsAbsent(request);
  assertNoSecretLikeMaterial(request);
  assertNoRawDocumentMaterial(request);

  const correlationId = extractCorrelationId(request);
  const fields = normalizeFields(
    requireArray(request.fields, "fields", correlationId, MAX_DRAFT_FIELDS, 1),
    correlationId
  );
  const references = normalizeReferences(
    request.references === undefined
      ? []
      : requireArray(request.references, "references", correlationId, MAX_DRAFT_REFERENCES),
    correlationId
  );
  const normalized: NormalizedDraftCreation = {
    tenantId: requireTrimmed(request.tenantId, "tenantId", correlationId),
    documentId: requireTrimmed(request.documentId, "documentId", correlationId),
    metadataSnapshotId: requireTrimmed(
      request.metadataSnapshotId,
      "metadataSnapshotId",
      correlationId
    ),
    schemaHash: requireTrimmed(request.schemaHash, "schemaHash", correlationId),
    documentType: requireTrimmed(request.documentType, "documentType", correlationId),
    targetResourceName: requireTrimmed(
      request.targetResourceName,
      "targetResourceName",
      correlationId
    ),
    fields,
    references,
    confidence: normalizeConfidence(request.confidence, correlationId),
    validationSummary: normalizeValidationSummary(request.validationSummary, correlationId),
    idempotencyKey: requireTrimmed(request.idempotencyKey, "idempotencyKey", correlationId),
    correlationId: requireTrimmed(request.correlationId, "correlationId", correlationId),
    createdByUserId: requireTrimmed(request.createdByUserId, "createdByUserId", correlationId)
  };

  assertNoSecretLikeMaterial(normalized);
  assertNoRawDocumentMaterial(normalized);

  return normalized;
}

export function hashDraftRequest(request: NormalizedDraftCreation): string {
  return createHash("sha256").update(stableStringify(request)).digest("hex");
}

function assertPayloadVersion(request: CreateDraftRequest): void {
  if (request.payloadVersion !== DRAFT_CREATION_PAYLOAD_VERSION) {
    throw draftBadRequest({
      code: "invalidPayloadVersion",
      message: "Unsupported draft creation payload version.",
      retryable: false,
      remediation: "Use payloadVersion 1.",
      correlationId: extractCorrelationId(request)
    });
  }
}

function assertForbiddenRootFieldsAbsent(request: CreateDraftRequest): void {
  const rawRequest = request as unknown as Record<string, unknown>;

  for (const field of FORBIDDEN_ROOT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(rawRequest, field)) {
      throw draftBadRequest({
        code: "invalidDraftInput",
        message: "Draft creation cannot accept lifecycle, approval, write, or command fields.",
        retryable: false,
        remediation: "Create a review draft first, then use approval and write APIs later.",
        field,
        correlationId:
          typeof rawRequest.correlationId === "string" ? rawRequest.correlationId : undefined
      });
    }
  }
}

function normalizeFields(fields: unknown[], correlationId: string | undefined): DraftField[] {
  const seenNames = new Set<string>();

  return fields
    .map((field, index) => {
      const record = requirePlainObject(field, `fields.${index}`, correlationId);
      const name = requireTrimmed(record.name, `fields.${index}.name`, correlationId);

      if (seenNames.has(name)) {
        throw draftBadRequest({
          code: "invalidDraftInput",
          message: "Draft field names must be unique.",
          retryable: false,
          remediation: "Merge duplicate field values before draft creation.",
          field: name,
          correlationId
        });
      }

      seenNames.add(name);

      return {
        name,
        value: normalizeJsonValue(record.value, `fields.${index}.value`, correlationId),
        ...optionalString(
          "sourceField",
          record.sourceField,
          `fields.${index}.sourceField`,
          correlationId
        ),
        ...optionalScore("confidence", record.confidence, `fields.${index}.confidence`, correlationId)
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
}

function normalizeReferences(
  references: unknown[],
  correlationId: string | undefined
): DraftReference[] {
  const seenNames = new Set<string>();

  return references
    .map((reference, index) => {
      const record = requirePlainObject(reference, `references.${index}`, correlationId);
      const name = requireTrimmed(record.name, `references.${index}.name`, correlationId);

      if (seenNames.has(name)) {
        throw draftBadRequest({
          code: "invalidDraftInput",
          message: "Draft reference names must be unique.",
          retryable: false,
          remediation: "Merge duplicate reference values before draft creation.",
          field: name,
          correlationId
        });
      }

      seenNames.add(name);

      return {
        name,
        fieldName: requireTrimmed(record.fieldName, `references.${index}.fieldName`, correlationId),
        ...optionalString(
          "targetResourceName",
          record.targetResourceName,
          `references.${index}.targetResourceName`,
          correlationId
        ),
        ...optionalString(
          "targetKey",
          record.targetKey,
          `references.${index}.targetKey`,
          correlationId
        ),
        ...optionalString(
          "candidateId",
          record.candidateId,
          `references.${index}.candidateId`,
          correlationId
        ),
        ...optionalScore("confidence", record.confidence, `references.${index}.confidence`, correlationId)
      };
    })
    .sort((left, right) => {
      const nameComparison = left.name.localeCompare(right.name, "en");
      return nameComparison === 0
        ? left.fieldName.localeCompare(right.fieldName, "en")
        : nameComparison;
    });
}

function normalizeConfidence(
  confidence: DraftConfidence,
  correlationId: string | undefined
): DraftConfidence {
  const record = requirePlainObject(confidence, "confidence", correlationId);
  const reasons = requireArray(
    record.reasons,
    "confidence.reasons",
    correlationId,
    MAX_CONFIDENCE_REASONS
  );

  return {
    score: requireScore(record.score, "confidence.score", correlationId),
    reasons: reasons.map((reason, index) =>
      requireTrimmed(reason, `confidence.reasons.${index}`, correlationId, MAX_REASON_LENGTH)
    ),
    requiresReview: true
  };
}

function normalizeValidationSummary(
  validationSummary: DraftValidationSummary,
  correlationId: string | undefined
): DraftValidationSummary {
  const record = requirePlainObject(validationSummary, "validationSummary", correlationId);

  if (!isValidationStatus(record.status)) {
    throw draftBadRequest({
      code: "invalidDraftInput",
      message: "Validation summary status is not supported.",
      retryable: false,
      remediation: "Use passed, warning, or failed.",
      field: "validationSummary.status",
      correlationId
    });
  }

  const messages = requireArray(
    record.messages,
    "validationSummary.messages",
    correlationId,
    MAX_VALIDATION_MESSAGES
  );

  return {
    status: record.status,
    messages: messages.map((message, index) =>
      normalizeValidationMessage(message, index, correlationId)
    )
  };
}

function normalizeValidationMessage(
  message: unknown,
  index: number,
  correlationId: string | undefined
): DraftValidationMessage {
  const record = requirePlainObject(message, `validationSummary.messages.${index}`, correlationId);

  if (!isValidationSeverity(record.severity)) {
    throw draftBadRequest({
      code: "invalidDraftInput",
      message: "Validation message severity is not supported.",
      retryable: false,
      remediation: "Use error, warning, or info.",
      field: `validationSummary.messages.${index}.severity`,
      correlationId
    });
  }

  return {
    code: requireTrimmed(record.code, `validationSummary.messages.${index}.code`, correlationId),
    severity: record.severity,
    message: requireTrimmed(
      record.message,
      `validationSummary.messages.${index}.message`,
      correlationId,
      MAX_VALIDATION_MESSAGE_LENGTH
    ),
    ...optionalString(
      "field",
      record.field,
      `validationSummary.messages.${index}.field`,
      correlationId
    )
  };
}

function normalizeJsonValue(
  value: unknown,
  field: string,
  correlationId: string | undefined,
  depth = 0
): DraftJsonValue {
  if (depth > MAX_JSON_DEPTH) {
    throw draftBadRequest({
      code: "invalidDraftInput",
      message: "Draft field values exceed the supported JSON nesting depth.",
      retryable: false,
      remediation: "Store large raw artifacts separately and pass only compact mapped values.",
      field,
      correlationId
    });
  }

  if (value === null || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    if (value.length > MAX_JSON_STRING_LENGTH) {
      throw draftBadRequest({
        code: "invalidDraftInput",
        message: "Draft field string values are too large.",
        retryable: false,
        remediation: "Store large raw artifacts separately and pass only compact mapped values.",
        field,
        correlationId
      });
    }

    if (containsRawDocumentMarker(value)) {
      throw draftBadRequest({
        code: "invalidDraftInput",
        message: "Raw document or OCR text cannot be stored in draft creation payloads.",
        retryable: false,
        remediation: "Store raw content in object storage and pass only durable references.",
        field,
        correlationId
      });
    }

    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw draftBadRequest({
        code: "invalidDraftInput",
        message: "Draft field values must be JSON-compatible.",
        retryable: false,
        remediation: "Replace non-finite numbers before creating the draft.",
        field,
        correlationId
      });
    }

    return value;
  }

  if (Array.isArray(value)) {
    if (value.length > MAX_JSON_ARRAY_LENGTH) {
      throw draftBadRequest({
        code: "invalidDraftInput",
        message: "Draft field arrays are too large.",
        retryable: false,
        remediation: "Store large raw artifacts separately and pass only compact mapped values.",
        field,
        correlationId
      });
    }

    return value.map((item, index) =>
      normalizeJsonValue(item, `${field}.${index}`, correlationId, depth + 1)
    );
  }

  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value);

    if (entries.length > MAX_JSON_OBJECT_KEYS) {
      throw draftBadRequest({
        code: "invalidDraftInput",
        message: "Draft field objects have too many keys.",
        retryable: false,
        remediation: "Store large raw artifacts separately and pass only compact mapped values.",
        field,
        correlationId
      });
    }

    return Object.fromEntries(
      entries
        .sort(([left], [right]) => left.localeCompare(right, "en"))
        .map(([key, item]) => {
          if (key.length > MAX_JSON_OBJECT_KEY_LENGTH) {
            throw draftBadRequest({
              code: "invalidDraftInput",
              message: "Draft field object keys are too large.",
              retryable: false,
              remediation: "Store large raw artifacts separately and pass only compact mapped values.",
              field,
              correlationId
            });
          }

          if (containsRawDocumentMarker(key)) {
            throw draftBadRequest({
              code: "invalidDraftInput",
              message: "Raw document or OCR text cannot be stored in draft creation payloads.",
              retryable: false,
              remediation: "Store raw content in object storage and pass only durable references.",
              field,
              correlationId
            });
          }

          return [key, normalizeJsonValue(item, `${field}.${key}`, correlationId, depth + 1)];
        })
    );
  }

  throw draftBadRequest({
    code: "invalidDraftInput",
    message: "Draft field values must be JSON-compatible.",
    retryable: false,
    remediation: "Remove undefined values, functions, symbols, or unsupported values.",
    field,
    correlationId
  });
}

function requireTrimmed(
  value: unknown,
  field: string,
  correlationId: string | undefined,
  maxLength = MAX_IDENTIFIER_LENGTH
): string {
  if (typeof value !== "string") {
    throw draftBadRequest({
      code: "invalidDraftInput",
      message: "Required draft creation fields must be strings.",
      retryable: false,
      remediation: "Provide a non-empty string value.",
      field,
      correlationId
    });
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw draftBadRequest({
      code: "invalidDraftInput",
      message: "Required draft creation fields must not be empty.",
      retryable: false,
      remediation: "Provide a non-empty value.",
      field,
      correlationId
    });
  }

  if (trimmed.length > maxLength) {
    throw draftBadRequest({
      code: "invalidDraftInput",
      message: "Draft creation string fields are too large.",
      retryable: false,
      remediation: "Store large raw artifacts separately and pass only compact mapped values.",
      field,
      correlationId
    });
  }

  if (containsRawDocumentMarker(trimmed)) {
    throw draftBadRequest({
      code: "invalidDraftInput",
      message: "Raw document or OCR text cannot be stored in draft creation payloads.",
      retryable: false,
      remediation: "Store raw content in object storage and pass only durable references.",
      field,
      correlationId
    });
  }

  return trimmed;
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
    throw draftBadRequest({
      code: "invalidDraftInput",
      message: "Optional draft creation fields must be strings.",
      retryable: false,
      remediation: "Remove unsupported optional values before creating the draft.",
      field,
      correlationId
    });
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return {};
  }

  return { [key]: requireTrimmed(value, field, correlationId) } as { [P in K]: string };
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

function requireScore(value: unknown, field: string, correlationId: string | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw draftBadRequest({
      code: "invalidDraftInput",
      message: "Confidence scores must be between 0 and 1.",
      retryable: false,
      remediation: "Provide a normalized confidence score.",
      field,
      correlationId
    });
  }

  return value;
}

function isValidationStatus(value: unknown): value is DraftValidationSummary["status"] {
  return (
    typeof value === "string" &&
    (VALID_VALIDATION_STATUSES as readonly string[]).includes(value)
  );
}

function isValidationSeverity(value: unknown): value is DraftValidationMessage["severity"] {
  return (
    typeof value === "string" &&
    (VALID_VALIDATION_SEVERITIES as readonly string[]).includes(value)
  );
}

function assertRequestObject(request: unknown): asserts request is CreateDraftRequest {
  requirePlainObject(request, "request", extractCorrelationId(request));
}

function requirePlainObject(
  value: unknown,
  field: string,
  correlationId: string | undefined
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw draftBadRequest({
      code: "invalidDraftInput",
      message: "Draft creation payload sections must be JSON objects.",
      retryable: false,
      remediation: "Provide a JSON object with the required draft creation fields.",
      field,
      correlationId
    });
  }

  return value as Record<string, unknown>;
}

function requireArray(
  value: unknown,
  field: string,
  correlationId: string | undefined,
  maxLength: number,
  minLength = 0
): unknown[] {
  if (!Array.isArray(value)) {
    throw draftBadRequest({
      code: "invalidDraftInput",
      message: "Draft creation payload arrays must be arrays.",
      retryable: false,
      remediation: "Provide an array value.",
      field,
      correlationId
    });
  }

  if (value.length < minLength) {
    throw draftBadRequest({
      code: "invalidDraftInput",
      message: "Draft creation requires at least one mapped field.",
      retryable: false,
      remediation: "Provide at least one mapped field for accountant review.",
      field,
      correlationId
    });
  }

  if (value.length > maxLength) {
    throw draftBadRequest({
      code: "invalidDraftInput",
      message: "Draft creation payload arrays are too large.",
      retryable: false,
      remediation: "Split the draft or store large raw artifacts separately.",
      field,
      correlationId
    });
  }

  return value;
}

function assertNoSecretLikeMaterial(value: unknown): void {
  if (containsSecretLikeMaterial(value, new WeakSet())) {
    throw draftBadRequest({
      code: "secretMaterialRejected",
      message: "Draft creation payload contains secret-like material.",
      retryable: false,
      remediation: "Store credentials only in secure storage and pass secure references.",
      correlationId: extractCorrelationId(value)
    });
  }
}

function assertNoRawDocumentMaterial(value: unknown): void {
  if (containsRawDocumentMaterial(value, new WeakSet())) {
    throw draftBadRequest({
      code: "invalidDraftInput",
      message: "Raw document or OCR text cannot be stored in draft creation payloads.",
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
  // Fail-closed at excessive depth: treat over-deep payloads as suspicious
  // rather than letting them exhaust the call stack.
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
  // Fail-closed at excessive depth: treat over-deep payloads as raw-document material.
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
