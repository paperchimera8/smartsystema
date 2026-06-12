import {
  COUNTERPARTY_RESOLUTION_PAYLOAD_VERSION,
  DOCUMENT_EXCEPTION_PAYLOAD_VERSION,
  DRAFT_CREATION_PAYLOAD_VERSION,
  NATIVE_AUTH_PAYLOAD_VERSION,
  NOMENCLATURE_RESOLUTION_PAYLOAD_VERSION,
  WRITE_PACKAGE_PAYLOAD_VERSION,
  type CounterpartyResolutionResult,
  type CreateDocumentExceptionRequest,
  type CreateDocumentExceptionResponse,
  type CreateDraftRequest,
  type CreateDraftResponse,
  type DocumentExceptionSignal,
  type DraftField,
  type NativeAuthMeResponse,
  type NativeAuthPollResponse,
  type PollNativeAuthRequest,
  type NomenclatureResolutionResult,
  type StartNativeAuthRequest,
  type StartNativeAuthResponse,
  type WritePackageRequest
} from "@automator/contracts";
import type { MappedDocument, ReviewField, WarningItem } from "./sample-document";

export type WorkflowMode = "live-api" | "demo";

export type WorkflowResult<T> = {
  mode: WorkflowMode;
  response: T;
};

type Fetcher = typeof fetch;

export class BackendRequestError extends Error {
  readonly code: string | undefined;
  readonly path: string;
  readonly remediation: string | undefined;
  readonly status: number;

  constructor(path: string, status: number, details: { code?: string; remediation?: string } = {}) {
    super(`Backend request ${path} failed with status ${status}.`);
    this.name = "BackendRequestError";
    this.path = path;
    this.status = status;
    this.code = details.code;
    this.remediation = details.remediation;
  }
}

export function normalizeApiBaseUrl(rawValue: string | undefined): string | null {
  const raw = rawValue?.trim();

  if (!raw) {
    return null;
  }

  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    throw new Error("API endpoint must be a valid http or https URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("API endpoint must use http or https.");
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new Error("API endpoint must not include credentials, query parameters, or fragments.");
  }

  if (url.pathname === "/" || url.pathname === "") {
    url.pathname = "/api";
  } else {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }

  return url.href.replace(/\/+$/, "");
}

export function configuredApiBaseUrl(): string | null {
  return normalizeApiBaseUrl(import.meta.env.VITE_API_BASE_URL);
}

export function apiEndpointUrl(
  apiBaseUrl: string,
  path:
    | "/auth/me"
    | "/auth/native/poll"
    | "/auth/native/start"
    | "/drafts"
    | "/document-exceptions"
    | "/documents/upload"
): string {
  const normalizedApiBaseUrl = normalizeApiBaseUrl(apiBaseUrl);

  if (normalizedApiBaseUrl === null) {
    throw new Error("API endpoint is not configured.");
  }

  return `${normalizedApiBaseUrl}${path}`;
}

export function isTauriRuntime() {
  if (typeof window === "undefined") {
    return false;
  }

  return Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

export async function createDraftWorkflow(
  apiBaseUrl = configuredApiBaseUrl(),
  fetcher: Fetcher = fetch
): Promise<WorkflowResult<CreateDraftResponse>> {
  return submitDraftRequest(buildDemoDraftRequest(), apiBaseUrl, fetcher);
}

export async function submitDraftRequest(
  request: CreateDraftRequest,
  apiBaseUrl = configuredApiBaseUrl(),
  fetcher: Fetcher = fetch,
  accessToken?: string
): Promise<WorkflowResult<CreateDraftResponse>> {
  if (apiBaseUrl === null) {
    return {
      mode: "demo",
      response: demoDraftResponse(request)
    };
  }

  return {
    mode: "live-api",
    response: await postJson<CreateDraftResponse>(apiBaseUrl, "/drafts", request, fetcher, accessToken)
  };
}

export async function routeDocumentExceptionWorkflow(
  apiBaseUrl = configuredApiBaseUrl(),
  fetcher: Fetcher = fetch
): Promise<WorkflowResult<CreateDocumentExceptionResponse>> {
  return submitDocumentExceptionRequest(buildDemoDocumentExceptionRequest(), apiBaseUrl, fetcher);
}

export async function submitDocumentExceptionRequest(
  request: CreateDocumentExceptionRequest,
  apiBaseUrl = configuredApiBaseUrl(),
  fetcher: Fetcher = fetch,
  accessToken?: string
): Promise<WorkflowResult<CreateDocumentExceptionResponse>> {
  if (apiBaseUrl === null) {
    return {
      mode: "demo",
      response: demoDocumentExceptionResponse(request)
    };
  }

  return {
    mode: "live-api",
      response: await postJson<CreateDocumentExceptionResponse>(
        apiBaseUrl,
        "/document-exceptions",
        request,
        fetcher,
        accessToken
      )
    };
}

export async function startNativeBrowserAuth(
  apiBaseUrl = configuredApiBaseUrl(),
  fetcher: Fetcher = fetch,
  preferredMode: StartNativeAuthRequest["preferredMode"] = "login"
): Promise<StartNativeAuthResponse> {
  if (apiBaseUrl === null) {
    throw new Error("API endpoint is not configured.");
  }

  return postJson<StartNativeAuthResponse>(
    apiBaseUrl,
    "/auth/native/start",
    {
      payloadVersion: NATIVE_AUTH_PAYLOAD_VERSION,
      deviceLabel: "СмартСистема Desktop Agent",
      preferredMode,
      apiBaseUrl,
      correlationId: `auth-${Date.now()}`
    },
    fetcher
  );
}

export async function pollNativeBrowserAuth(
  request: PollNativeAuthRequest,
  apiBaseUrl = configuredApiBaseUrl(),
  fetcher: Fetcher = fetch
): Promise<NativeAuthPollResponse> {
  if (apiBaseUrl === null) {
    throw new Error("API endpoint is not configured.");
  }

  return postJson<NativeAuthPollResponse>(apiBaseUrl, "/auth/native/poll", request, fetcher);
}

export async function fetchNativeAuthMe(
  accessToken: string,
  apiBaseUrl = configuredApiBaseUrl(),
  fetcher: Fetcher = fetch
): Promise<NativeAuthMeResponse> {
  if (apiBaseUrl === null) {
    throw new Error("API endpoint is not configured.");
  }

  return getJson<NativeAuthMeResponse>(apiBaseUrl, "/auth/me", fetcher, accessToken);
}

export function buildDraftRequestFromDocument(
  document: MappedDocument,
  correlationId = actionCorrelationId("draft", document)
): CreateDraftRequest {
  const fields = fieldMap(document);
  const validationMessages = validationMessagesForDocument(document);

  return {
    payloadVersion: DRAFT_CREATION_PAYLOAD_VERSION,
    tenantId: "tenant-demo",
    documentId: document.row.id,
    metadataSnapshotId: "metadata-demo",
    schemaHash: "schema-demo",
    documentType: documentTypeForRequest(document),
    targetResourceName: "Document_PurchaseInvoice",
    fields: [
      draftField("Date", normalizeDateForPayload(fields.get("date")?.value), fields.get("date")),
      draftField("Number", fields.get("number")?.value ?? "", fields.get("number")),
      draftField("TotalAmount", parseAmountForPayload(fields.get("total-amount")?.value), fields.get("total-amount")),
      draftField("VATAmount", parseAmountForPayload(fields.get("vat")?.value), fields.get("vat"))
    ],
    references: counterpartyReference(document),
    confidence: {
      score: documentConfidenceScore(document),
      reasons: confidenceReasons(document),
      requiresReview: validationMessages.some((message) => message.severity !== "info")
    },
    validationSummary: {
      status: validationMessages.some((message) => message.severity === "error")
        ? "failed"
        : validationMessages.some((message) => message.severity === "warning")
          ? "warning"
          : "passed",
      messages: validationMessages
    },
    idempotencyKey: `draft-${safeIdentifier(document.row.id)}`,
    correlationId,
    createdByUserId: "user-demo-accountant"
  };
}

export function buildWritePackageRequestFromDocument(
  document: MappedDocument,
  draftId = `draft-${safeIdentifier(document.row.id)}`,
  targetKind: "fresh-odata" | "local-json-export" = "local-json-export",
  correlationId = actionCorrelationId("write", document)
): WritePackageRequest {
  const fields = fieldMap(document);

  return {
    payloadVersion: WRITE_PACKAGE_PAYLOAD_VERSION,
    targetKind,
    operation: "create",
    document: {
      draftId,
      metadataSnapshotId: "metadata-demo",
      schemaHash: "schema-demo",
      resourceName: "Document_PurchaseInvoice",
      approvalStatus: "approved",
      validationStatus: "passed",
      fields: [
        { name: "Date", value: normalizeDateForPayload(fields.get("date")?.value) },
        { name: "Number", value: fields.get("number")?.value ?? "" },
        { name: "TotalAmount", value: parseAmountForPayload(fields.get("total-amount")?.value) },
        { name: "VATAmount", value: parseAmountForPayload(fields.get("vat")?.value) }
      ],
      references: finalCounterpartyReference(document),
      idempotencyKey: `write-${safeIdentifier(document.row.id)}`,
      correlationId
    },
    metadataObject: writePackageMetadataObject()
  };
}

export function buildDocumentExceptionRequestFromDocument(
  document: MappedDocument,
  draftId?: string,
  correlationId = actionCorrelationId("exception", document)
): CreateDocumentExceptionRequest {
  const signals = exceptionSignalsForDocument(document);

  return {
    payloadVersion: DOCUMENT_EXCEPTION_PAYLOAD_VERSION,
    tenantId: "tenant-demo",
    documentId: document.row.id,
    ...(draftId ? { draftId } : {}),
    metadataSnapshotId: "metadata-demo",
    schemaHash: "schema-demo",
    stage: signals.some((signal) => signal.code === "validation_error") ? "validation" : "entity_resolution",
    signals:
      signals.length > 0
        ? signals
        : [
            {
              code: "policy_blocked",
              severity: "warning",
              message: "The accountant requested manual review for this document.",
              entityKind: "document"
            }
          ],
    idempotencyKey: `exception-${safeIdentifier(document.row.id)}`,
    correlationId,
    createdByUserId: "user-demo-accountant"
  };
}

export function buildDemoDraftRequest(correlationId = "ui-draft-demo"): CreateDraftRequest {
  return {
    payloadVersion: DRAFT_CREATION_PAYLOAD_VERSION,
    tenantId: "tenant-demo",
    documentId: "document-demo-upd-4512",
    metadataSnapshotId: "metadata-demo",
    schemaHash: "schema-demo",
    documentType: "purchase-invoice",
    targetResourceName: "Document_PurchaseInvoice",
    fields: [
      { name: "Date", value: "2026-05-28", sourceField: "date", confidence: 0.99 },
      { name: "Number", value: "4512", sourceField: "number", confidence: 0.98 },
      { name: "TotalAmount", value: 148920.4, sourceField: "amount", confidence: 0.96 },
      { name: "VATAmount", value: 24820.07, sourceField: "vat", confidence: 0.88 }
    ],
    references: [
      {
        name: "Counterparty",
        fieldName: "Counterparty_Key",
        targetResourceName: "Catalog_Counterparties",
        targetKey: "counterparty-romashka",
        confidence: 0.98
      }
    ],
    confidence: {
      score: 0.91,
      reasons: ["Counterparty matched by INN.", "Nomenclature still needs review."],
      requiresReview: true
    },
    validationSummary: {
      status: "warning",
      messages: [
        {
          code: "nomenclature-review-required",
          severity: "warning",
          message: "Nomenclature line requires accountant confirmation.",
          field: "items.0"
        }
      ]
    },
    idempotencyKey: "ui-draft-demo-upd-4512",
    correlationId,
    createdByUserId: "user-demo-accountant"
  };
}

export function buildDemoDocumentExceptionRequest(
  correlationId = "ui-exception-demo"
): CreateDocumentExceptionRequest {
  return {
    payloadVersion: DOCUMENT_EXCEPTION_PAYLOAD_VERSION,
    tenantId: "tenant-demo",
    documentId: "document-demo-upd-4512",
    draftId: "draft-demo-upd-4512",
    metadataSnapshotId: "metadata-demo",
    schemaHash: "schema-demo",
    stage: "entity_resolution",
    signals: [
      {
        code: "nomenclature_ambiguous",
        severity: "warning",
        message: "Nomenclature line has two close candidates and needs accountant review.",
        lineId: "line-1",
        entityKind: "nomenclature",
        score: 0.72,
        candidateCount: 2
      }
    ],
    idempotencyKey: "ui-exception-demo-upd-4512",
    correlationId,
    createdByUserId: "user-demo-accountant"
  };
}

export function buildDemoWritePackageRequest(
  targetKind: "fresh-odata" | "local-json-export" = "local-json-export",
  correlationId = "ui-write-plan-demo"
): WritePackageRequest {
  return {
    payloadVersion: WRITE_PACKAGE_PAYLOAD_VERSION,
    targetKind,
    operation: "create",
    document: {
      draftId: "draft-demo-upd-4512",
      metadataSnapshotId: "metadata-demo",
      schemaHash: "schema-demo",
      resourceName: "Document_PurchaseInvoice",
      approvalStatus: "approved",
      validationStatus: "passed",
      fields: [
        { name: "Date", value: "2026-05-28" },
        { name: "Number", value: "4512" },
        { name: "TotalAmount", value: 148920.4 },
        { name: "VATAmount", value: 24820.07 }
      ],
      references: [
        {
          name: "Counterparty",
          fieldName: "Counterparty_Key",
          targetResourceName: "Catalog_Counterparties",
          targetKey: "counterparty-romashka"
        }
      ],
      idempotencyKey: "ui-write-plan-demo-upd-4512",
      correlationId
    },
    metadataObject: {
      name: "PurchaseInvoice",
      resourceName: "Document_PurchaseInvoice",
      fields: [
        { name: "Ref_Key", typeName: "Edm.Guid", nullable: false, isKey: true, isReference: false },
        { name: "Date", typeName: "Edm.DateTime", nullable: false, isKey: false, isReference: false },
        { name: "Number", typeName: "Edm.String", nullable: false, isKey: false, isReference: false },
        {
          name: "Counterparty_Key",
          typeName: "Catalog_Counterparties",
          nullable: false,
          isKey: false,
          isReference: true
        },
        { name: "TotalAmount", typeName: "Edm.Decimal", nullable: false, isKey: false, isReference: false },
        { name: "VATAmount", typeName: "Edm.Decimal", nullable: true, isKey: false, isReference: false }
      ],
      keys: ["Ref_Key"]
    }
  };
}

export function demoCounterpartyResolution(): CounterpartyResolutionResult {
  return {
    entityType: "counterparty",
    tenantId: "tenant-demo",
    metadataSnapshotId: "metadata-demo",
    correlationId: "ui-counterparty-demo",
    requiresReview: false,
    candidates: [
      {
        entityType: "counterparty",
        candidateId: "counterparty-romashka",
        displayName: "ООО Ромашка",
        score: 0.98,
        matchReasons: ["INN and KPP matched exactly."],
        signals: [{ code: "inn-kpp-exact", score: 0.98 }],
        warnings: [],
        requiresReview: false
      }
    ]
  };
}

export function demoNomenclatureResolution(): NomenclatureResolutionResult {
  return {
    entityType: "nomenclature",
    tenantId: "tenant-demo",
    metadataSnapshotId: "metadata-demo",
    correlationId: "ui-nomenclature-demo",
    sourceLineId: "line-1",
    requiresReview: true,
    candidates: [
      {
        entityType: "nomenclature",
        candidateId: "nomenclature-paper-a4",
        displayName: "Бумага А4 80 г/м2, 500 л.",
        score: 0.65,
        matchReasons: ["Product name is similar, but accounting unit differs."],
        signals: [
          { code: "name-fuzzy", score: 0.78 },
          { code: "unit-mismatch", score: 0.65 }
        ],
        warnings: [
          {
            code: "unit-mismatch",
            severity: "severe",
            message: "Supplier unit differs from the 1C accounting unit."
          }
        ],
        requiresReview: true
      }
    ]
  };
}

export function demoDraftResponse(request: CreateDraftRequest): CreateDraftResponse {
  return {
    draftId: draftIdFromDocumentId(request.documentId),
    tenantId: request.tenantId,
    documentId: request.documentId,
    metadataSnapshotId: request.metadataSnapshotId,
    lifecycleStatus: "needs_review",
    approvalStatus: "pending",
    writeStatus: "not_requested",
    requiresAccountantApproval: true,
    idempotencyReplay: false,
    createdAt: "2026-05-31T12:00:00.000Z",
    correlationId: request.correlationId
  };
}

export function demoDocumentExceptionResponse(
  request: CreateDocumentExceptionRequest
): CreateDocumentExceptionResponse {
  return {
    exceptionId: exceptionIdFromDocumentId(request.documentId),
    tenantId: request.tenantId,
    documentId: request.documentId,
    ...(request.draftId === undefined ? {} : { draftId: request.draftId }),
    category: "nomenclature_issue",
    queueName: "accountant_review",
    priority: "high",
    status: "open",
    requiresAccountantReview: true,
    requiresAdminReview: false,
    signalCount: request.signals.length,
    topSignalCode: "nomenclature_ambiguous",
    suggestedActions: ["Ask the accountant to confirm the matching nomenclature line."],
    idempotencyReplay: false,
    createdAt: "2026-05-31T12:01:00.000Z",
    correlationId: request.correlationId
  };
}

function fieldMap(document: MappedDocument): Map<string, ReviewField> {
  return new Map(document.fields.map((field) => [field.id, field]));
}

function draftField(name: string, value: string | number, source?: ReviewField): DraftField {
  return {
    name,
    value,
    ...(source ? { sourceField: source.id, confidence: confidenceScore(source.confidence) } : { confidence: 0 })
  };
}

function counterpartyReference(document: MappedDocument) {
  const topCounterparty = document.counterpartyResolution.candidates[0];

  if (!topCounterparty) {
    return [];
  }

  return [
    {
      name: "Counterparty",
      fieldName: "Counterparty_Key",
      targetResourceName: "Catalog_Counterparties",
      targetKey: topCounterparty.candidateId,
      confidence: topCounterparty.score
    }
  ];
}

function finalCounterpartyReference(document: MappedDocument) {
  const topCounterparty = document.counterpartyResolution.candidates[0];

  if (!topCounterparty) {
    return [];
  }

  return [
    {
      name: "Counterparty",
      fieldName: "Counterparty_Key",
      targetResourceName: "Catalog_Counterparties",
      targetKey: topCounterparty.candidateId
    }
  ];
}

function validationMessagesForDocument(document: MappedDocument) {
  const messages = openWarnings(document).map((warning) => ({
    code: warningCode(warning),
    severity: warning.tone === "critical" ? "error" as const : warning.tone,
    message: warning.description,
    field: warning.title
  }));

  for (const field of document.fields) {
    if (field.confirmationStatus === "rejected") {
      messages.push({
        code: "field-rejected",
        severity: "error" as const,
        message: `${field.label} was rejected by the accountant.`,
        field: field.id
      });
    } else if (field.confirmationStatus !== "confirmed") {
      messages.push({
        code: "field-confirmation-required",
        severity: "warning" as const,
        message: `${field.label} still requires accountant confirmation.`,
        field: field.id
      });
    }
  }

  return messages;
}

function exceptionSignalsForDocument(document: MappedDocument) {
  const signals: DocumentExceptionSignal[] = openWarnings(document).map((warning) => ({
    code: exceptionSignalCode(warning),
    severity: warning.tone,
    message: warning.description,
    field: warning.title,
    entityKind: exceptionEntityKind(warning)
  }));

  for (const field of document.fields) {
    if (field.confirmationStatus === "rejected") {
      signals.push({
        code: "validation_error" as const,
        severity: "critical" as const,
        message: `${field.label} was rejected by the accountant.`,
        field: field.id,
        entityKind: "validation" as const
      });
    } else if (field.confidence === "low") {
      signals.push({
        code: "low_field_confidence" as const,
        severity: "warning" as const,
        message: `${field.label} has low recognition confidence.`,
        field: field.id,
        entityKind: "document" as const
      });
    } else if (field.confirmationStatus === "pending") {
      signals.push({
        code: "low_field_confidence" as const,
        severity: "warning" as const,
        message: `${field.label} still requires accountant confirmation.`,
        field: field.id,
        entityKind: "document" as const
      });
    }
  }

  return signals;
}

function openWarnings(document: MappedDocument): WarningItem[] {
  return document.warnings.filter((warning) => warning.resolutionStatus !== "resolved");
}

function warningCode(warning: WarningItem): string {
  if (warning.title.toLowerCase().includes("ндс")) return "vat-review-required";
  if (warning.title.toLowerCase().includes("единиц")) return "unit-review-required";
  if (warning.title.toLowerCase().includes("номенклат")) return "nomenclature-review-required";
  return warning.tone === "critical" ? "critical-review-required" : "review-required";
}

function exceptionSignalCode(warning: WarningItem) {
  const title = warning.title.toLowerCase();

  if (title.includes("ндс")) return "vat_mismatch" as const;
  if (title.includes("единиц")) return "unit_mismatch" as const;
  if (title.includes("номенклат")) return "nomenclature_ambiguous" as const;
  if (title.includes("контрагент")) return "counterparty_ambiguous" as const;
  return warning.tone === "critical" ? "validation_error" as const : "low_document_confidence" as const;
}

function exceptionEntityKind(warning: WarningItem) {
  const title = warning.title.toLowerCase();

  if (title.includes("номенклат")) return "nomenclature" as const;
  if (title.includes("единиц")) return "unit" as const;
  if (title.includes("контрагент")) return "counterparty" as const;
  if (title.includes("ндс")) return "validation" as const;
  return "document" as const;
}

function documentConfidenceScore(document: MappedDocument): number {
  if (document.fields.length === 0) {
    return 0;
  }

  const fieldScore = document.fields.reduce((sum, field) => sum + confidenceScore(field.confidence), 0) / document.fields.length;
  const counterpartyScore = document.counterpartyResolution.candidates[0]?.score ?? 0;
  const nomenclatureScore = document.nomenclatureResolution.candidates[0]?.score ?? 0;

  return roundScore((fieldScore + counterpartyScore + nomenclatureScore) / 3);
}

function confidenceReasons(document: MappedDocument): string[] {
  const reasons = ["Draft was built from the selected mapped document."];

  if (document.counterpartyResolution.candidates[0]) {
    reasons.push("Counterparty candidate is attached to the draft payload.");
  }

  if (document.nomenclatureResolution.requiresReview) {
    reasons.push("Nomenclature still has review signals.");
  }

  return reasons;
}

function confidenceScore(confidence: ReviewField["confidence"]): number {
  if (confidence === "high") return 0.98;
  if (confidence === "medium") return 0.75;
  return 0.3;
}

function parseAmountForPayload(value: string | undefined): number {
  if (!value) {
    return 0;
  }

  const normalized = value
    .replace(/\s/g, "")
    .replace(/[₽руб.]/gi, "")
    .replace(",", ".")
    .trim();
  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeDateForPayload(value: string | undefined): string {
  if (!value) {
    return "";
  }

  const match = value.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);

  if (!match) {
    return value.trim();
  }

  return `${match[3]}-${match[2]}-${match[1]}`;
}

function documentTypeForRequest(document: MappedDocument): string {
  if (document.row.documentType === "УПД") return "purchase-invoice";
  if (document.row.documentType === "акт") return "act";
  if (document.row.documentType === "накладная") return "waybill";
  if (document.row.documentType === "счет-фактура") return "invoice";
  if (document.row.documentType === "счет") return "receipt";
  return "other";
}

function writePackageMetadataObject(): WritePackageRequest["metadataObject"] {
  return {
    name: "PurchaseInvoice",
    resourceName: "Document_PurchaseInvoice",
    fields: [
      { name: "Ref_Key", typeName: "Edm.Guid", nullable: false, isKey: true, isReference: false },
      { name: "Date", typeName: "Edm.DateTime", nullable: false, isKey: false, isReference: false },
      { name: "Number", typeName: "Edm.String", nullable: false, isKey: false, isReference: false },
      {
        name: "Counterparty_Key",
        typeName: "Catalog_Counterparties",
        nullable: false,
        isKey: false,
        isReference: true
      },
      { name: "TotalAmount", typeName: "Edm.Decimal", nullable: false, isKey: false, isReference: false },
      { name: "VATAmount", typeName: "Edm.Decimal", nullable: true, isKey: false, isReference: false }
    ],
    keys: ["Ref_Key"]
  };
}

function actionCorrelationId(action: string, document: MappedDocument): string {
  return `ui-${action}-${safeIdentifier(document.row.id)}`;
}

function draftIdFromDocumentId(documentId: string): string {
  const safeDocumentId = safeIdentifier(documentId);
  const withoutDocumentPrefix = safeDocumentId.startsWith("document-")
    ? safeDocumentId.slice("document-".length)
    : safeDocumentId;

  return `draft-${withoutDocumentPrefix}`;
}

function exceptionIdFromDocumentId(documentId: string): string {
  const safeDocumentId = safeIdentifier(documentId);
  const withoutDocumentPrefix = safeDocumentId.startsWith("document-")
    ? safeDocumentId.slice("document-".length)
    : safeDocumentId;

  return `exception-${withoutDocumentPrefix}`;
}

function safeIdentifier(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");

  return normalized || "document";
}

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}

async function postJson<TResponse>(
  apiBaseUrl: string,
  path: "/auth/native/poll" | "/auth/native/start" | "/drafts" | "/document-exceptions",
  request: unknown,
  fetcher: Fetcher,
  accessToken?: string
): Promise<TResponse> {
  const endpoint = apiEndpointUrl(apiBaseUrl, path);
  const response = await fetcher(endpoint, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {})
    },
    body: JSON.stringify(request)
  });

  if (!response.ok) {
    const pathName = new URL(endpoint).pathname;
    throw new BackendRequestError(pathName, response.status, await readBackendError(response));
  }

  return (await response.json()) as TResponse;
}

async function getJson<TResponse>(
  apiBaseUrl: string,
  path: "/auth/me",
  fetcher: Fetcher,
  accessToken: string
): Promise<TResponse> {
  const endpoint = apiEndpointUrl(apiBaseUrl, path);
  const response = await fetcher(endpoint, {
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    const pathName = new URL(endpoint).pathname;
    throw new BackendRequestError(pathName, response.status, await readBackendError(response));
  }

  return (await response.json()) as TResponse;
}

async function readBackendError(response: Response): Promise<{ code?: string; remediation?: string }> {
  try {
    const body = (await response.json()) as unknown;

    if (typeof body !== "object" || body === null) {
      return {};
    }

    const code = safeBackendErrorValue((body as { code?: unknown }).code);
    const remediation = safeBackendErrorValue((body as { remediation?: unknown }).remediation);

    return {
      ...(code === undefined ? {} : { code }),
      ...(remediation === undefined ? {} : { remediation })
    };
  } catch {
    return {};
  }
}

function safeBackendErrorValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  return /^[A-Za-z0-9._:-]{1,160}$/.test(trimmed) ? trimmed : undefined;
}
