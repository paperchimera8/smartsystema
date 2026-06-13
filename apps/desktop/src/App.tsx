import { invoke } from "@tauri-apps/api/core";
import { ChangeEvent, DragEvent, useMemo, useRef, useState } from "react";
import { NATIVE_AUTH_PAYLOAD_VERSION, type CreateDraftRequest, type CreateDraftResponse, type NativeAuthSessionResponse, type OcrExtractResult, type WritePackagePlan } from "@automator/contracts";
import {
  apiEndpointUrl,
  buildDraftRequestFromDocument,
  buildWritePackageRequestFromDocument,
  configuredApiBaseUrl,
  fetchNativeAuthMe,
  isTauriRuntime,
  normalizeApiBaseUrl,
  pollNativeBrowserAuth,
  startNativeBrowserAuth,
  submitDraftRequest
} from "./module-workflow";
import {
  emptyCounterpartyResolution,
  emptyNomenclatureResolution,
  mapUploadedDocumentFile,
  type AppSection,
  type AuditEvent,
  type DocumentRow,
  type DocumentStatus,
  type DocumentType,
  type FieldConfirmationStatus,
  type MappedDocument,
  type RecognitionConfidence,
  type ReviewField,
  type Tone,
  type WarningItem
} from "./sample-document";

type DocumentQueueGroup = {
  title: string;
  description: string;
  emptyText: string;
  documents: DocumentRow[];
};

type ReadinessRunState = "idle" | "checking" | "ready" | "error";
type ActionRunState = "idle" | "running" | "success" | "error";
type NativeAuthRunState = "idle" | "opening" | "polling" | "authenticated" | "error";

type ActionState = {
  state: ActionRunState;
  title: string;
  detail: string;
};

type DocumentActionRuntimeState = {
  draftId?: string;
  draftSaved: boolean;
  writePackagePreview?: string;
  sentToOneC: boolean;
  rejected: boolean;
  latestNotice: ActionState;
};

type DocumentActionBlockers = {
  isRunning: boolean;
  isTerminal: boolean;
  canSendToOneC: boolean;
  canReject: boolean;
  summary: string;
};

type MetadataSnapshot = {
  snapshotId: string;
  source: {
    endpoint: string;
    serviceDocumentUrl: string;
    metadataUrl: string;
    authRef?: string | null;
    correlationId?: string | null;
  };
  collectedAtUnixMs: number;
  schemaHash: string;
  objects: Array<Record<string, unknown>>;
  warnings: string[];
};

type ReadinessReportStatus = "ready" | "needs-admin-setup" | "review-only";
type ReadinessCheckStatus = "found" | "missing" | "limited";
type ReadinessSeverity = "critical" | "warning" | "info";

type ConnectionReadinessReport = {
  reportId: string;
  metadataSnapshotId: string;
  schemaHash: string;
  status: ReadinessReportStatus;
  summary: string;
  totals: {
    found: number;
    required: number;
    criticalMissing: number;
    warnings: number;
  };
  sections: ReadinessSection[];
  limitations: string[];
  generatedAtUnixMs: number;
  correlationId?: string | null;
};

type ReadinessSection = {
  code: string;
  title: string;
  status: ReadinessCheckStatus;
  summary: string;
  checks: ReadinessReportCheck[];
  administratorActions: string[];
};

type ReadinessReportCheck = {
  code: string;
  label: string;
  status: ReadinessCheckStatus;
  severity: ReadinessSeverity;
  message: string;
  matchedObject?: string | null;
  matchedField?: string | null;
  remediation?: string | null;
};

type FieldConfirmationSummary = {
  total: number;
  confirmed: number;
  pending: number;
  rejected: number;
};

const sections: Array<{ id: AppSection; label: string }> = [
  { id: "documents", label: "Документы" },
  { id: "review", label: "Проверка" },
  { id: "settings", label: "Настройки" },
  { id: "audit", label: "Журнал" }
];

const uploadStages = ["Загружаем", "Распознаём", "Проверяем", "Готовим черновик"];

const warningPriority: Record<WarningItem["tone"], number> = {
  critical: 0,
  warning: 1,
  info: 2
};

const demoConnectionReadinessReport: ConnectionReadinessReport = {
  reportId: "readiness-demo",
  metadataSnapshotId: "metadata-demo",
  schemaHash: "demo",
  status: "review-only",
  summary: "Found 18 of 21 required fields.",
  totals: {
    found: 18,
    required: 21,
    criticalMissing: 0,
    warnings: 3
  },
  sections: [
    {
      code: "counterparties",
      title: "Counterparties",
      status: "found",
      summary: "Counterparties: found 6 of 6 checks.",
      administratorActions: [],
      checks: [
        readinessDemoCheck("counterparties.object", "found", "critical", "Catalog_Counterparties"),
        readinessDemoCheck("counterparties.inn", "found", "critical", "Catalog_Counterparties", "INN"),
        readinessDemoCheck("counterparties.kpp", "found", "warning", "Catalog_Counterparties", "KPP")
      ]
    },
    {
      code: "nomenclature",
      title: "Nomenclature",
      status: "limited",
      summary: "Nomenclature: found 4 of 5 checks.",
      administratorActions: ["Publish the unit field or configure manual unit mapping before sending drafts."],
      checks: [
        readinessDemoCheck("nomenclature.object", "found", "critical", "Catalog_Nomenclature"),
        readinessDemoCheck("nomenclature.name", "found", "critical", "Catalog_Nomenclature", "Description"),
        readinessDemoCheck("nomenclature.unit", "limited", "warning")
      ]
    },
    {
      code: "purchaseDocuments",
      title: "Purchase Documents",
      status: "found",
      summary: "Purchase Documents: found 8 of 8 checks.",
      administratorActions: [],
      checks: [
        readinessDemoCheck("purchaseDocuments.object", "found", "critical", "Document_PurchaseInvoice"),
        readinessDemoCheck("purchaseDocuments.counterparty", "found", "critical", "Document_PurchaseInvoice", "Counterparty_Key"),
        readinessDemoCheck("purchaseDocuments.vat", "found", "critical", "Document_PurchaseInvoice", "VATAmount")
      ]
    },
    {
      code: "draftWrite",
      title: "Draft Write Readiness",
      status: "found",
      summary: "Draft Write Readiness: found 4 of 4 checks.",
      administratorActions: [],
      checks: [
        readinessDemoCheck("draftWrite.targetDocument", "found", "critical", "Document_PurchaseInvoice"),
        readinessDemoCheck("draftWrite.permissionCaveat", "found", "info", "Document_PurchaseInvoice")
      ]
    },
    {
      code: "setupRequired",
      title: "Setup Required",
      status: "limited",
      summary: "Setup Required: found 2 of 4 checks.",
      administratorActions: [
        "Expose the warehouse field or configure a default warehouse rule with an administrator.",
        "Publish conversion coefficients or configure manual conversion rules for supplier units."
      ],
      checks: [
        readinessDemoCheck("setupRequired.contract", "found", "warning", "Document_PurchaseInvoice", "Contract_Key"),
        readinessDemoCheck("setupRequired.warehouse", "limited", "warning"),
        readinessDemoCheck("setupRequired.conversionCoefficient", "limited", "warning")
      ]
    }
  ],
  limitations: [
    "The report is based only on objects published through OData and accessible to the active credential context.",
    "Draft write readiness means metadata is sufficient for planning; actual write permission still requires a separate execution or preflight check."
  ],
  generatedAtUnixMs: 1779998400000,
  correlationId: "demo"
};

const idleActionState: ActionState = {
  state: "idle",
  title: "Ожидает действия",
  detail: "Проверка ещё не запускалась."
};

const idleDocumentActionRuntime: DocumentActionRuntimeState = {
  draftSaved: false,
  sentToOneC: false,
  rejected: false,
  latestNotice: idleActionState
};

const DOC_TYPE_MAP: Record<string, DocumentType> = {
  invoice: "счет-фактура",
  waybill: "накладная",
  act: "акт",
  contract: "счет",
  receipt: "счет",
  upd: "УПД",
  other: "не определён"
};

const DOCUMENT_TYPES: readonly DocumentType[] = [
  "УПД",
  "акт",
  "счет",
  "накладная",
  "счет-фактура",
  "не определён"
];

function reviewField(
  id: string,
  label: string,
  value: string,
  confidence: RecognitionConfidence,
  required = true
): ReviewField {
  return {
    id,
    label,
    value,
    confidence,
    confirmationStatus: "pending",
    required
  };
}

function mapOcrResultToDocument(ocr: OcrExtractResult, fileName: string): MappedDocument {
  const id = `ocr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const findField = (key: string) =>
    ocr.fields.find((f) => f.name.toLowerCase().includes(key.toLowerCase()));

  const val = (key: string) => findField(key)?.value ?? "—";
  const conf = (key: string): RecognitionConfidence => {
    const c = findField(key)?.confidence ?? 0;
    return c >= 0.8 ? "high" : c >= 0.5 ? "medium" : "low";
  };

  const supplier = val("supplier");
  const buyer = val("buyer");
  const date = val("date");
  const total = val("total");
  const vat = val("vat");
  const docNum = val("number").replace("document ", "");
  const inn = val("inn");

  const documentType = DOC_TYPE_MAP[ocr.documentType] ?? "не определён";
  const readiness = Math.round(ocr.overallConfidence * 100);
  const status: DocumentStatus = ocr.overallConfidence >= 0.85 ? "Готов к отправке в 1С" : "Требует проверки";

  const warnings: WarningItem[] = [];
  if (ocr.overallConfidence < 0.85) {
    warnings.push({
      id: "ocr-low-confidence",
      tone: ocr.overallConfidence < 0.6 ? "critical" : "warning",
      title: "Проверьте распознанные поля",
      description: `Модель уверена на ${readiness}%. Поля с низкой уверенностью отмечены.`,
      resolutionStatus: "open"
    });
  }
  if (supplier === "—") {
    warnings.push({
      id: "supplier-not-found",
      tone: "warning",
      title: "Поставщик не найден",
      description: "Укажите поставщика вручную.",
      resolutionStatus: "open"
    });
  }

  const issueTone: Tone = warnings.some((w) => w.tone === "critical")
    ? "danger"
    : warnings.length > 0
      ? "warning"
      : "success";

  return {
    row: {
      id,
      fileName,
      documentType,
      supplier: supplier === "—" ? "не распознан" : supplier,
      date: date === "—" ? "—" : date,
      amount: total,
      status,
      readiness,
      issueSummary: warnings.length > 0 ? `${warnings.length} замечани${warnings.length === 1 ? "е" : "я"}` : "Без замечаний",
      issueTone
    },
    preview: { title: fileName, pageLabel: "", documentType, supplier: supplier === "—" ? "не распознан" : supplier },
    fields: [
      reviewField("document-type", "Тип документа", documentType, ocr.overallConfidence >= 0.7 ? "high" : "medium"),
      reviewField("number", "Номер", docNum, conf("number")),
      reviewField("date", "Дата", date, conf("date")),
      reviewField("supplier", "Поставщик", supplier, conf("supplier")),
      reviewField("buyer", "Покупатель", buyer, conf("buyer"), false),
      reviewField("tax-id", "ИНН / КПП", inn, conf("inn")),
      reviewField("total-amount", "Сумма с НДС", total, conf("total")),
      reviewField("vat", "НДС", vat, conf("vat"))
    ],
    warnings,
    nomenclatureLines: [],
    auditEvents: [],
    counterpartyResolution: emptyCounterpartyResolution(),
    nomenclatureResolution: emptyNomenclatureResolution()
  };
}

function getFieldConfirmationSummary(fields: ReviewField[]): FieldConfirmationSummary {
  return fields.reduce<FieldConfirmationSummary>(
    (summary, field) => ({
      total: summary.total + 1,
      confirmed: summary.confirmed + (field.confirmationStatus === "confirmed" ? 1 : 0),
      pending: summary.pending + (field.confirmationStatus === "pending" ? 1 : 0),
      rejected: summary.rejected + (field.confirmationStatus === "rejected" ? 1 : 0)
    }),
    { total: 0, confirmed: 0, pending: 0, rejected: 0 }
  );
}

function recalculateDocumentReviewState(document: MappedDocument): MappedDocument {
  const syncedDocument = syncDocumentRowFromFields(document);

  if (
    syncedDocument.row.status === "Ошибка" ||
    syncedDocument.row.status === "Отклонён" ||
    syncedDocument.row.status === "Отправлен в 1С"
  ) {
    return syncedDocument;
  }

  const fieldSummary = getFieldConfirmationSummary(syncedDocument.fields);
  const unresolvedWarnings = unresolvedReviewWarnings(syncedDocument);
  const criticalWarnings = unresolvedWarnings.filter((warning) => warning.tone === "critical").length;
  const warnings = unresolvedWarnings.filter((warning) => warning.tone === "warning").length;

  if (fieldSummary.rejected > 0) {
    return withReviewRowState(
      syncedDocument,
      "Требует проверки",
      Math.min(syncedDocument.row.readiness, 79),
      `${fieldSummary.rejected} ${pluralizeRussian(fieldSummary.rejected, "поле отклонено", "поля отклонены", "полей отклонены")}`,
      "danger"
    );
  }

  if (fieldSummary.pending > 0) {
    return withReviewRowState(
      syncedDocument,
      "Требует проверки",
      Math.min(syncedDocument.row.readiness, 94),
      `${fieldSummary.pending} ${pluralizeRussian(fieldSummary.pending, "поле не подтверждено", "поля не подтверждены", "полей не подтверждены")}`,
      "warning"
    );
  }

  if (criticalWarnings > 0) {
    return withReviewRowState(
      syncedDocument,
      "Требует проверки",
      Math.min(syncedDocument.row.readiness, 84),
      `${criticalWarnings} ${pluralizeRussian(criticalWarnings, "критичный пункт", "критичных пункта", "критичных пунктов")}`,
      "danger"
    );
  }

  if (warnings > 0) {
    return withReviewRowState(
      syncedDocument,
      "Требует проверки",
      Math.min(syncedDocument.row.readiness, 94),
      `${warnings} ${pluralizeRussian(warnings, "предупреждение", "предупреждения", "предупреждений")}`,
      "warning"
    );
  }

  return withReviewRowState(
    syncedDocument,
    "Готов к отправке в 1С",
    Math.max(syncedDocument.row.readiness, 95),
    "поля подтверждены",
    "success"
  );
}

function unresolvedReviewWarnings(document: MappedDocument): WarningItem[] {
  return document.warnings.filter((warning) => warning.resolutionStatus !== "resolved");
}

function getDocumentActionBlockers({
  document,
  actionState,
  fieldSummary,
  unresolvedWarningCount,
  criticalWarningCount,
  runningStates
}: {
  document: MappedDocument | null;
  actionState: DocumentActionRuntimeState;
  fieldSummary: FieldConfirmationSummary;
  unresolvedWarningCount: number;
  criticalWarningCount: number;
  runningStates: ActionState[];
}): DocumentActionBlockers {
  const isRunning = runningStates.some((state) => state.state === "running");
  const isRejected = actionState.rejected || document?.row.status === "Отклонён";
  const isSent = actionState.sentToOneC || document?.row.status === "Отправлен в 1С";
  const isError = document?.row.status === "Ошибка";
  const isTerminal = isRejected || isSent || isError;
  const hasFieldBlockers = fieldSummary.pending > 0 || fieldSummary.rejected > 0;
  const hasReviewBlockers = unresolvedWarningCount > 0 || criticalWarningCount > 0;
  const canUseDocument = document !== null && !isRunning && !isTerminal;
  const canSend = canUseDocument && !hasFieldBlockers && !hasReviewBlockers;

  return {
    isRunning,
    isTerminal,
    canSendToOneC: canSend,
    canReject: document !== null && !isRunning && !isRejected && !isSent,
    summary: actionSummaryText({
      document,
      actionState,
      fieldSummary,
      unresolvedWarningCount,
      criticalWarningCount
    })
  };
}

function actionSummaryText({
  document,
  actionState,
  fieldSummary,
  unresolvedWarningCount,
  criticalWarningCount
}: {
  document: MappedDocument | null;
  actionState: DocumentActionRuntimeState;
  fieldSummary: FieldConfirmationSummary;
  unresolvedWarningCount: number;
  criticalWarningCount: number;
}): string {
  if (document === null) return "Загрузите документ, чтобы выбрать действие.";
  if (actionState.sentToOneC || document.row.status === "Отправлен в 1С") {
    return "Документ уже отмечен как отправленный в 1С.";
  }
  if (actionState.rejected || document.row.status === "Отклонён") {
    return "Документ отклонён и недоступен для отправки.";
  }
  if (document.row.status === "Ошибка") {
    return "Документ с ошибкой недоступен для отправки.";
  }
  if (fieldSummary.rejected > 0) {
    return "Есть отклонённые поля, отправка в 1С заблокирована.";
  }
  if (fieldSummary.pending > 0) {
    return "Отправка в 1С заблокирована до подтверждения всех полей.";
  }
  if (criticalWarningCount > 0) {
    return "Отправка в 1С заблокирована до закрытия критичных пунктов проверки.";
  }
  if (unresolvedWarningCount > 0) {
    return "Закройте оставшиеся пункты проверки перед отправкой.";
  }

  return "Критичных ошибок нет, можно отправить в 1С как черновик.";
}

function syncDocumentRowFromFields(document: MappedDocument): MappedDocument {
  const valueById = new Map(document.fields.map((field) => [field.id, field.value.trim()]));
  const documentType = documentTypeFromValue(valueById.get("document-type"));
  const supplier = valueById.get("supplier");
  const date = valueById.get("date");
  const totalAmount = valueById.get("total-amount");

  return {
    ...document,
    row: {
      ...document.row,
      documentType: documentType ?? document.row.documentType,
      supplier: supplier && supplier !== "—" ? supplier : document.row.supplier,
      date: date && date !== "—" ? date : document.row.date,
      amount: totalAmount && totalAmount !== "—" ? totalAmount : document.row.amount
    },
    preview: {
      ...document.preview,
      documentType: documentType ?? document.preview.documentType,
      supplier: supplier && supplier !== "—" ? supplier : document.preview.supplier
    }
  };
}

function documentTypeFromValue(value: string | undefined): DocumentType | null {
  if (!value) return null;
  return DOCUMENT_TYPES.includes(value as DocumentType) ? (value as DocumentType) : null;
}

function withReviewRowState(
  document: MappedDocument,
  status: DocumentStatus,
  readiness: number,
  issueSummary: string,
  issueTone: Tone
): MappedDocument {
  return {
    ...document,
    row: {
      ...document.row,
      status,
      readiness,
      issueSummary,
      issueTone
    }
  };
}

function createReviewAuditEvent(document: MappedDocument, action: string, details: string): AuditEvent {
  const valueById = new Map(document.fields.map((field) => [field.id, field.value.trim()]));

  return {
    time: new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }),
    actor: "Бухгалтер",
    documentType: document.row.documentType,
    documentNumber: valueById.get("number") || "—",
    documentDate: valueById.get("date") || "—",
    counterparty: valueById.get("supplier") || "не распознан",
    action,
    details
  };
}

function buildLocalDraftResponse(request: CreateDraftRequest): CreateDraftResponse {
  return {
    draftId: `draft-${request.documentId}`,
    tenantId: request.tenantId,
    documentId: request.documentId,
    metadataSnapshotId: request.metadataSnapshotId,
    lifecycleStatus: "needs_review",
    approvalStatus: "pending",
    writeStatus: "not_requested",
    requiresAccountantApproval: true,
    idempotencyReplay: true,
    createdAt: new Date().toISOString(),
    correlationId: request.correlationId
  };
}

function recognitionConfidenceText(confidence: RecognitionConfidence): string {
  if (confidence === "high") return "высокая уверенность";
  if (confidence === "medium") return "нужно проверить";
  return "ошибка распознавания";
}

function fieldConfirmationText(confirmationStatus: FieldConfirmationStatus): string {
  if (confirmationStatus === "confirmed") return "подтверждено бухгалтером";
  if (confirmationStatus === "rejected") return "отклонено бухгалтером";
  return "не подтверждено";
}

function fieldReviewSummaryText(summary: FieldConfirmationSummary): string {
  if (summary.pending === 0 && summary.rejected === 0) {
    return "Все обязательные поля подтверждены бухгалтером.";
  }

  const parts: string[] = [];

  if (summary.pending > 0) {
    parts.push(
      `${summary.pending} ${pluralizeRussian(summary.pending, "поле ожидает", "поля ожидают", "полей ожидают")} решения`
    );
  }

  if (summary.rejected > 0) {
    parts.push(
      `${summary.rejected} ${pluralizeRussian(summary.rejected, "поле отклонено", "поля отклонены", "полей отклонены")}`
    );
  }

  return `${parts.join(", ")}.`;
}

function pluralizeRussian(count: number, one: string, few: string, many: string): string {
  const mod100 = count % 100;
  const mod10 = count % 10;

  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

function initialBackendApiBaseUrl(): string {
  try {
    return configuredApiBaseUrl() ?? "";
  } catch {
    return "";
  }
}

export function App() {
  const [activeSection, setActiveSection] = useState<AppSection>("documents");
  const [documents, setDocuments] = useState<MappedDocument[]>([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [uploadedFileNames, setUploadedFileNames] = useState<string[]>([]);
  const [uploadStageIndex, setUploadStageIndex] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [showSendConfirmation, setShowSendConfirmation] = useState(false);
  const [readinessEndpoint, setReadinessEndpoint] = useState("");
  const [readinessState, setReadinessState] = useState<ReadinessRunState>(() =>
    isTauriRuntime() ? "idle" : "ready"
  );
  const [readinessReport, setReadinessReport] = useState<ConnectionReadinessReport | null>(() =>
    isTauriRuntime() ? null : demoConnectionReadinessReport
  );
  const [readinessError, setReadinessError] = useState<string | null>(null);
  const [sendState, setSendState] = useState<ActionState>(idleActionState);
  const [rejectState, setRejectState] = useState<ActionState>(idleActionState);
  const [authState, setAuthState] = useState<NativeAuthRunState>("idle");
  const [authSession, setAuthSession] = useState<NativeAuthSessionResponse | null>(null);
  const [authMessage, setAuthMessage] = useState("Вход выполняется во внешнем браузере.");
  const [backendApiBaseUrl] = useState(initialBackendApiBaseUrl);
  const [documentActionStateById, setDocumentActionStateById] = useState<Record<string, DocumentActionRuntimeState>>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const authRunIdRef = useRef(0);


  const activeUploadStage = uploadStages[uploadStageIndex] ?? "Загружаем";
  const selectedDocument =
    documents.find((document) => document.row.id === selectedDocumentId) ?? documents[0] ?? null;
  const criticalWarningCount =
    selectedDocument ? unresolvedReviewWarnings(selectedDocument).filter((warning) => warning.tone === "critical").length : 0;
  const unresolvedWarningCount = selectedDocument ? unresolvedReviewWarnings(selectedDocument).length : 0;
  const selectedFieldSummary = getFieldConfirmationSummary(selectedDocument?.fields ?? []);
  const selectedDocumentActionState = selectedDocument
    ? documentActionStateById[selectedDocument.row.id] ?? idleDocumentActionRuntime
    : idleDocumentActionRuntime;
  const documentActionBlockers = getDocumentActionBlockers({
    document: selectedDocument,
    actionState: selectedDocumentActionState,
    fieldSummary: selectedFieldSummary,
    unresolvedWarningCount,
    criticalWarningCount,
    runningStates: [sendState, rejectState]
  });
  const canSendToOneC = documentActionBlockers.canSendToOneC;

  const documentSummary = useMemo(() => {
    const needsReview = documents.filter((document) => document.row.status === "Требует проверки").length;
    const ready = documents.filter((document) => document.row.status === "Готов к отправке в 1С").length;
    const blocked = documents.filter((document) => document.row.status === "Ошибка" || document.row.status === "Отклонён").length;

    return { needsReview, ready, blocked };
  }, [documents]);

  function selectedBackendApiBaseUrl(): string | null {
    return normalizeApiBaseUrl(backendApiBaseUrl);
  }

  async function handleSelectedFiles(fileList: FileList | null) {
    const files = Array.from(fileList ?? []);
    const names = files.map((file) => file.name.trim()).filter(Boolean);

    if (names.length === 0) return;

    setUploadedFileNames(names);
    setActiveSection("documents");
    setUploadStageIndex(0);

    try {
      const mappedDocuments = await Promise.all(
        files.map((file) => uploadAndMapFile(file))
      );
      const recalculatedDocuments = mappedDocuments.map(recalculateDocumentReviewState);
      setDocuments(recalculatedDocuments);
      setDocumentActionStateById((current) => ({
        ...current,
        ...Object.fromEntries(
          recalculatedDocuments.map((document) => [
            document.row.id,
            {
              ...idleDocumentActionRuntime,
              latestNotice: {
                state: "idle",
                title: "Документ загружен",
                detail: "Действия станут доступны после проверки полей."
              }
            }
          ])
        )
      }));
      setSelectedDocumentId(mappedDocuments[0]?.row.id ?? null);
    } catch {
      setDocuments([]);
      setSelectedDocumentId(null);
    }
  }

  function handleChangeReviewField(fieldId: string, value: string) {
    updateSelectedDocument((document) => ({
      ...document,
      fields: document.fields.map((field) =>
        field.id === fieldId
          ? {
              ...field,
              value,
              confirmationStatus: "pending"
            }
          : field
      )
    }));
    resetSelectedDocumentActionArtifacts();
  }

  function handleSetFieldConfirmation(fieldId: string, confirmationStatus: FieldConfirmationStatus) {
    updateSelectedDocument((document) => {
      const field = document.fields.find((candidate) => candidate.id === fieldId);

      if (!field) {
        return document;
      }

      const action = confirmationStatus === "confirmed" ? "Подтвердил поле" : "Не подтвердил поле";

      return {
        ...document,
        fields: document.fields.map((candidate) =>
          candidate.id === fieldId
            ? {
                ...candidate,
                confirmationStatus
              }
            : candidate
        ),
        auditEvents: [
          ...document.auditEvents,
          createReviewAuditEvent(document, action, `${field.label}: ${field.value}`)
        ]
      };
    });
    resetSelectedDocumentActionArtifacts();
  }

  function handleResolveWarning(warningId: string) {
    updateSelectedDocument((document) => {
      const warning = document.warnings.find((candidate) => candidate.id === warningId);

      if (!warning) {
        return document;
      }

      return {
        ...document,
        warnings: document.warnings.map((candidate) =>
          candidate.id === warningId
            ? {
                ...candidate,
                resolutionStatus: "resolved"
              }
            : candidate
        ),
        auditEvents: [
          ...document.auditEvents,
          createReviewAuditEvent(document, "Подтвердил пункт проверки", warning.title)
        ]
      };
    });
    resetSelectedDocumentActionArtifacts();
  }

  function updateSelectedDocument(transform: (document: MappedDocument) => MappedDocument) {
    setDocuments((currentDocuments) => {
      const activeDocumentId = selectedDocumentId ?? currentDocuments[0]?.row.id;

      if (!activeDocumentId) {
        return currentDocuments;
      }

      return currentDocuments.map((document) =>
        document.row.id === activeDocumentId
          ? recalculateDocumentReviewState(transform(document))
          : document
      );
    });
  }

  function updateSelectedDocumentActionState(
    transform: (state: DocumentActionRuntimeState, document: MappedDocument) => DocumentActionRuntimeState
  ) {
    const activeDocument = selectedDocument;

    if (!activeDocument) {
      return;
    }

    setDocumentActionStateById((current) => {
      const currentState = current[activeDocument.row.id] ?? idleDocumentActionRuntime;

      return {
        ...current,
        [activeDocument.row.id]: transform(currentState, activeDocument)
      };
    });
  }

  function resetSelectedDocumentActionArtifacts() {
    updateSelectedDocumentActionState((state) => {
      const { draftId: _draftId, writePackagePreview: _writePackagePreview, ...rest } = state;

      return {
        ...rest,
        draftSaved: false,
        sentToOneC: false
      };
    });
    setShowSendConfirmation(false);
  }

  async function uploadAndMapFile(file: File): Promise<MappedDocument> {
    const apiBase = selectedBackendApiBaseUrl();
    if (!apiBase) return mapUploadedDocumentFile(file);

    const fd = new FormData();
    fd.append("file", file);

    setUploadStageIndex(1); // Распознаём
    try {
      const uploadRequest: RequestInit = {
        method: "POST",
        body: fd,
        ...(authSession ? { headers: { authorization: `Bearer ${authSession.accessToken}` } } : {})
      };
      const res = await fetch(apiEndpointUrl(apiBase, "/documents/upload"), uploadRequest);
      setUploadStageIndex(2); // Проверяем
      if (!res.ok) return mapUploadedDocumentFile(file);
      const ocr = (await res.json()) as OcrExtractResult;
      setUploadStageIndex(3); // Готовим черновик
      return mapOcrResultToDocument(ocr, file.name);
    } catch {
      return mapUploadedDocumentFile(file);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    void handleSelectedFiles(event.dataTransfer.files);
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    void handleSelectedFiles(event.currentTarget.files);
    event.currentTarget.value = "";
  }

  async function handleRunReadinessCheck() {
    const correlationId = `readiness-${Date.now()}`;
    setReadinessError(null);
    setReadinessState("checking");

    if (!isTauriRuntime()) {
      setReadinessReport({
        ...demoConnectionReadinessReport,
        correlationId,
        generatedAtUnixMs: Date.now()
      });
      setReadinessState("ready");
      return;
    }

    const endpoint = readinessEndpoint.trim();

    if (!endpoint) {
      setReadinessError("Укажите OData endpoint без логина, пароля, токенов и параметров строки запроса.");
      setReadinessState("error");
      return;
    }

    try {
      const metadataSnapshot = await invoke<MetadataSnapshot>("scan_metadata", {
        request: {
          endpoint,
          timeoutMs: 10_000,
          correlationId
        }
      });
      const report = await invoke<ConnectionReadinessReport>("build_connection_readiness_report", {
        request: {
          metadataSnapshot,
          correlationId
        }
      });

      setReadinessReport(report);
      setReadinessState("ready");
    } catch (error) {
      setReadinessReport(null);
      setReadinessError(readinessErrorMessage(error));
      setReadinessState("error");
    }
  }

  function handleShowSendConfirmation() {
    if (!documentActionBlockers.canSendToOneC) {
      setSendState({
        state: "error",
        title: "Отправка заблокирована",
        detail: documentActionBlockers.summary
      });
      return;
    }

    setShowSendConfirmation(true);
  }

  async function handleConfirmSendToOneC() {
    const document = selectedDocument;

    if (!document || !documentActionBlockers.canSendToOneC) {
      setSendState({
        state: "error",
        title: "Отправка заблокирована",
        detail: documentActionBlockers.summary
      });
      return;
    }

    setSendState({
      state: "running",
      title: "Готовим безопасную отправку",
      detail: "Будет построен пакет и сохранён черновик. Реальная запись в 1С в MVP не выполняется."
    });

    try {
      const draftRequest = buildDraftRequestFromDocument(document, `ui-send-draft-${document.row.id}`);
      if (authSession) {
        draftRequest.tenantId = authSession.user.tenantId;
        draftRequest.createdByUserId = authSession.user.userId;
      }
      const draftResult = selectedDocumentActionState.draftId
        ? {
            mode: "demo" as const,
            response: {
              ...buildLocalDraftResponse(draftRequest),
              draftId: selectedDocumentActionState.draftId
            }
          }
        : await submitDraftRequest(draftRequest, selectedBackendApiBaseUrl(), fetch, authSession?.accessToken);
      const writeRequest = buildWritePackageRequestFromDocument(
        document,
        draftResult.response.draftId,
        "local-json-export",
        `ui-send-write-${document.row.id}`
      );
      const writePreview = isTauriRuntime()
        ? await invoke<WritePackagePlan>("plan_write_package", { request: writeRequest }).then(
            (plan) => `${plan.targetKind}: ${plan.operation}`
          )
        : `${writeRequest.targetKind}: ${writeRequest.operation}`;

      setSendState({
        state: "success",
        title: "Отправка смоделирована",
        detail: "Пакет записи построен, документ отмечен как отправленный. Реальная запись в 1С не выполнялась."
      });
      setShowSendConfirmation(false);
      updateSelectedDocumentActionState((state) => ({
        ...state,
        draftId: draftResult.response.draftId,
        draftSaved: true,
        writePackagePreview: writePreview,
        sentToOneC: true,
        latestNotice: {
          state: "success",
          title: "Отправка смоделирована",
          detail: writePreview
        }
      }));
      updateSelectedDocument((current) => ({
        ...current,
        row: {
          ...current.row,
          status: "Отправлен в 1С",
          readiness: 100,
          issueSummary: "черновик отправлен",
          issueTone: "success"
        },
        auditEvents: [
          ...current.auditEvents,
          createReviewAuditEvent(
            current,
            "Смоделировал отправку в 1С",
            `Черновик ${draftResult.response.draftId}; ${writePreview}; реальная запись не выполнялась.`
          )
        ]
      }));
    } catch (error) {
      setSendState({
        state: "error",
        title: "Отправка не подготовлена",
        detail: actionErrorMessage(error)
      });
    }
  }

  function handleRejectDocument() {
    const document = selectedDocument;

    if (!document || !documentActionBlockers.canReject) {
      setRejectState({
        state: "error",
        title: "Отклонение недоступно",
        detail: documentActionBlockers.summary
      });
      return;
    }

    setRejectState({
      state: "success",
      title: "Документ отклонён",
      detail: "Документ отклонён и недоступен для отправки."
    });
    setShowSendConfirmation(false);
    updateSelectedDocumentActionState((state) => ({
      ...state,
      rejected: true,
      latestNotice: {
        state: "success",
        title: "Документ отклонён",
        detail: "Отправка заблокирована."
      }
    }));
    updateSelectedDocument((current) => ({
      ...current,
      row: {
        ...current.row,
        status: "Отклонён",
        readiness: Math.min(current.row.readiness, 79),
        issueSummary: "отклонён",
        issueTone: "danger"
      },
      auditEvents: [
        ...current.auditEvents,
        createReviewAuditEvent(current, "Отклонил документ", "Документ отклонён и недоступен для отправки.")
      ]
    }));
  }

  async function handleStartExternalAuth(preferredMode: "login" | "register" = "login") {
    let apiBase: string | null;

    try {
      apiBase = selectedBackendApiBaseUrl();
    } catch {
      setAuthState("error");
      setAuthMessage("Укажите корректный адрес backend API без логина, пароля, токенов и параметров.");
      return;
    }

    if (apiBase === null) {
      setAuthState("error");
      setAuthMessage("Не удалось определить адрес облачного backend API.");
      return;
    }

    const authRunId = authRunIdRef.current + 1;
    authRunIdRef.current = authRunId;
    setAuthState("opening");
    setAuthMessage(preferredMode === "register" ? "Открываем внешний браузер для регистрации." : "Открываем внешний браузер для входа.");

    try {
      const start = await startNativeBrowserAuth(apiBase, fetch, preferredMode);
      await openExternalAuthUrl(start.loginUrl);

      setAuthState("polling");
      setAuthMessage(
        preferredMode === "register"
          ? "Создайте учётную запись в открывшемся браузере. Приложение ждёт подтверждение."
          : "Войдите в открывшемся браузере. Приложение ждёт подтверждение."
      );

      while (Date.now() < Date.parse(start.expiresAt) && authRunIdRef.current === authRunId) {
        await sleep(start.pollIntervalMs);
        const pollResult = await pollNativeBrowserAuth(
          {
            payloadVersion: NATIVE_AUTH_PAYLOAD_VERSION,
            authRequestId: start.authRequestId,
            pollToken: start.pollToken,
            correlationId: start.correlationId
          },
          apiBase
        );

        if (pollResult.status === "authenticated") {
          setAuthSession(pollResult);
          setAuthState("authenticated");
          setAuthMessage("");
          void focusSmartSistemaWindow();

          try {
            await fetchNativeAuthMe(pollResult.accessToken, apiBase);
          } catch {
            // Session is already established; /auth/me can be retried later.
          }

          return;
        }
      }

      if (authRunIdRef.current === authRunId) {
        setAuthState("error");
        setAuthMessage("Вход не завершён. Запустите вход ещё раз.");
      }
    } catch (error) {
      if (authRunIdRef.current === authRunId) {
        setAuthState("error");
        setAuthMessage(actionErrorMessage(error));
      }
    }
  }

  if (!authSession) {
    return (
      <AuthGate
        authMessage={authMessage}
        authState={authState}
        onStartExternalAuth={() => {
          void handleStartExternalAuth("login");
        }}
        onStartRegistration={() => {
          void handleStartExternalAuth("register");
        }}
      />
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Основные разделы">
        <div className="brand-block">
          <span className="brand-mark">С</span>
          <div>
            <strong>СмартСистема</strong>
          </div>
        </div>

        <nav className="nav-list">
          {sections.map((section) => (
            <button
              className="nav-item"
              data-active={activeSection === section.id}
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              type="button"
            >
              {section.label}
            </button>
          ))}
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>{sectionTitle(activeSection)}</h1>
          </div>
          <input
            accept=".pdf,.jpg,.jpeg,.png"
            className="visually-hidden"
            multiple
            onChange={handleFileChange}
            ref={fileInputRef}
            type="file"
          />
        </header>

        {activeSection === "documents" ? (
          <DocumentsScreen
            activeUploadStage={activeUploadStage}
            documents={documents}
            documentSummary={documentSummary}
            isDragging={isDragging}
            onDragLeave={() => setIsDragging(false)}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDrop={handleDrop}
            onOpenReview={(documentId) => {
              setSelectedDocumentId(documentId);
              setActiveSection("review");
            }}
            onPickFiles={() => fileInputRef.current?.click()}
            uploadStageIndex={uploadStageIndex}
            uploadedFileNames={uploadedFileNames}
          />
        ) : null}

        {activeSection === "review" ? (
          <ReviewScreen
            canSendToOneC={canSendToOneC}
            document={selectedDocument}
            documentActionBlockers={documentActionBlockers}
            documentActionState={selectedDocumentActionState}
            rejectState={rejectState}
            sendState={sendState}
            onChangeReviewField={handleChangeReviewField}
            onConfirmSendToOneC={handleConfirmSendToOneC}
            onRejectDocument={handleRejectDocument}
            onResolveWarning={handleResolveWarning}
            onSetFieldConfirmation={handleSetFieldConfirmation}
            onShowSendConfirmation={handleShowSendConfirmation}
            showSendConfirmation={showSendConfirmation}
          />
        ) : null}

        {activeSection === "settings" ? <SettingsScreen /> : null}
        {activeSection === "audit" ? <AuditScreen auditEvents={selectedDocument?.auditEvents ?? []} /> : null}
      </section>
    </main>
  );
}

function AuthGate({
  authMessage,
  authState,
  onStartExternalAuth,
  onStartRegistration
}: {
  authMessage: string;
  authState: NativeAuthRunState;
  onStartExternalAuth: () => void;
  onStartRegistration: () => void;
}) {
  const isRunning = authState === "opening" || authState === "polling";
  const statusText = authState === "error" ? "требуется вход" : isRunning ? "ожидаем подтверждение" : "не выполнен";

  return (
    <main className="auth-gate">
      <section className="auth-gate-card" aria-label="Вход в СмартСистему">
        <h1>Войдите в СмартСистему</h1>
        <p>
          Для работы с документами, настройками и отправкой черновиков нужно подтвердить пользователя во внешнем браузере.
        </p>
        <div className="auth-gate-status" data-state={authState} role={authState === "error" ? "alert" : "status"}>
          <span>{statusText}</span>
          <strong>{authMessage}</strong>
        </div>
        <div className="auth-gate-actions">
          <button disabled={isRunning} onClick={onStartExternalAuth} type="button">
            {isRunning ? "Ожидаем вход" : "Войти через браузер"}
          </button>
          <AuthRegistrationPrompt disabled={isRunning} onRegister={onStartRegistration} />
        </div>
      </section>
    </main>
  );
}

function AuthRegistrationPrompt({ disabled, onRegister }: { disabled: boolean; onRegister: () => void }) {
  return (
    <div className="auth-registration-prompt">
      <span>Нет аккаунта?</span>
      <button disabled={disabled} onClick={onRegister} type="button">
        Зарегистрироваться
      </button>
    </div>
  );
}

function DocumentsScreen({
  activeUploadStage,
  documents,
  documentSummary,
  isDragging,
  onDragLeave,
  onDragOver,
  onDrop,
  onOpenReview,
  onPickFiles,
  uploadStageIndex,
  uploadedFileNames
}: {
  activeUploadStage: string;
  documents: MappedDocument[];
  documentSummary: { needsReview: number; ready: number; blocked: number };
  isDragging: boolean;
  onDragLeave: () => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onOpenReview: (documentId: string) => void;
  onPickFiles: () => void;
  uploadStageIndex: number;
  uploadedFileNames: string[];
}) {
  const documentGroups = useMemo<DocumentQueueGroup[]>(() => {
    const rows = documents.map((document) => document.row);
    const manualActionDocuments = rows.filter(isManualActionDocument);
    const queueDocuments = rows.filter((document) => !isManualActionDocument(document));

    return [
      {
        title: "Очередь обработки",
        description: "Документы, которые загружаются, распознаются или уже готовы к безопасной отправке.",
        emptyText: "В очереди обработки сейчас нет документов.",
        documents: queueDocuments
      },
      {
        title: "Требуют ручного действия",
        description: "Спорные документы и ошибки, которые нельзя отправлять без решения бухгалтера.",
        emptyText: "Документов для ручного действия нет.",
        documents: manualActionDocuments
      }
    ];
  }, [documents]);

  return (
    <div className="screen-stack">
      <section
        className="upload-panel"
        data-dragging={isDragging}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <div>
          <h2>Загрузка документа</h2>
          <p>Мы распознаем документ и покажем спорные места перед отправкой в 1С.</p>
          <span>PDF, JPG или PNG. Можно выбрать несколько файлов.</span>
        </div>
        <button className="secondary-action" onClick={onPickFiles} type="button">
          Выбрать файлы
        </button>
      </section>

      {uploadedFileNames.length > 0 ? (
        <section className="processing-panel" aria-live="polite">
          <div className="processing-header">
            <strong>{activeUploadStage}</strong>
            <span>{uploadedFileNames.join(", ")}</span>
          </div>
          <div className="stage-track">
            {uploadStages.map((stage, index) => (
              <div className="stage-item" data-active={index <= uploadStageIndex} key={stage}>
                <span>{index + 1}</span>
                <strong>{stage}</strong>
              </div>
            ))}
          </div>
        </section>
      ) : null}


      {documentGroups.map((group) => (
        <DocumentGroupTable group={group} key={group.title} onOpenReview={onOpenReview} />
      ))}
    </div>
  );
}

async function openExternalAuthUrl(url: string): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("open_external_auth_url", { url });
    return;
  }

  const opened = window.open(url, "_blank", "noopener,noreferrer");

  if (!opened) {
    throw new Error("Browser window could not be opened.");
  }
}

async function focusSmartSistemaWindow(): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }

  try {
    await invoke("focus_main_window");
  } catch {
    // Focusing is best effort; authentication should remain successful if the OS refuses focus.
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function isManualActionDocument(document: DocumentRow) {
  return document.status === "Требует проверки" || document.status === "Ошибка" || document.status === "Отклонён";
}

function DocumentGroupTable({
  group,
  onOpenReview
}: {
  group: DocumentQueueGroup;
  onOpenReview: (documentId: string) => void;
}) {
  return (
    <section className="content-card document-group-card">
      <div className="section-heading">
        <div>
          <h2>{group.title}</h2>
          <p>{group.description}</p>
        </div>
        <span className="queue-count">{group.documents.length}</span>
      </div>
      {group.documents.length > 0 ? (
        <div className="document-table" role="table" aria-label={group.title}>
          <div className="table-row table-head" role="row">
            <span>Файл</span>
            <span>Тип</span>
            <span>Поставщик</span>
            <span>Дата</span>
            <span>Сумма</span>
            <span>Статус</span>
            <span>Готовность</span>
            <span>Проверка</span>
          </div>
          {group.documents.map((document) => (
            <div className="table-row" key={document.id} role="row">
              <button className="file-link" onClick={() => onOpenReview(document.id)} type="button">
                {document.fileName}
              </button>
              <span>{document.documentType}</span>
              <span>{document.supplier}</span>
              <span>{document.date}</span>
              <span>{document.amount}</span>
              <StatusBadge status={document.status} />
              <ReadinessMeter value={document.readiness} />
              <span className="issue-chip" data-tone={document.issueTone}>
                {document.issueSummary}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="empty-table-text">{group.emptyText}</p>
      )}
    </section>
  );
}

function ReviewScreen({
  canSendToOneC,
  document,
  documentActionBlockers,
  documentActionState,
  rejectState,
  sendState,
  onChangeReviewField,
  onConfirmSendToOneC,
  onRejectDocument,
  onResolveWarning,
  onSetFieldConfirmation,
  onShowSendConfirmation,
  showSendConfirmation
}: {
  canSendToOneC: boolean;
  document: MappedDocument | null;
  documentActionBlockers: DocumentActionBlockers;
  documentActionState: DocumentActionRuntimeState;
  rejectState: ActionState;
  sendState: ActionState;
  onChangeReviewField: (fieldId: string, value: string) => void;
  onConfirmSendToOneC: () => void;
  onRejectDocument: () => void;
  onResolveWarning: (warningId: string) => void;
  onSetFieldConfirmation: (fieldId: string, confirmationStatus: FieldConfirmationStatus) => void;
  onShowSendConfirmation: () => void;
  showSendConfirmation: boolean;
}) {
  if (document === null) {
    return (
      <section className="content-card empty-review-state">
        <div className="section-heading">
          <div>
            <h2>Проверка документа</h2>
            <p>Загрузите документ, чтобы увидеть распознанные поля и правила проверки.</p>
          </div>
        </div>
      </section>
    );
  }

  const priorityReviewWarnings = unresolvedReviewWarnings(document).sort(
    (left, right) => warningPriority[left.tone] - warningPriority[right.tone]
  );
  const topCounterparty = document.counterpartyResolution.candidates[0];
  const topNomenclature = document.nomenclatureResolution.candidates[0];
  const fieldSummary = getFieldConfirmationSummary(document.fields);
  const isDocumentLocked = documentActionBlockers.isTerminal || documentActionBlockers.isRunning;

  return (
    <div className="review-layout">
      <section className="document-preview" aria-label="Превью документа">
        <div className="preview-toolbar">
          <strong>{document.preview.title}</strong>
          <span>{document.preview.pageLabel}</span>
        </div>
        <div className="paper-preview">
          <span>{document.preview.documentType}</span>
          <strong>{document.preview.supplier}</strong>
          <div className="paper-lines">
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
          <div className="paper-table">
            <span />
            <span />
            <span />
            <span />
          </div>
        </div>
      </section>

      <section className="review-panel">
        <div className="section-heading">
          <div>
            <h2>Проверка документа</h2>
            <p>Подтвердите спорные поля перед созданием непроведенного черновика в 1С.</p>
          </div>
          <StatusBadge status={document.row.status} />
        </div>

        <section className="review-block review-priority-block">
          <h3>Что нужно проверить</h3>
          {priorityReviewWarnings.length > 0 ? (
            <div className="warning-list priority-warning-list">
              {priorityReviewWarnings.map((warning) => (
                <article className="warning-item" data-tone={warning.tone} key={warning.id}>
                  <strong>{warning.title}</strong>
                  <span>{warning.description}</span>
                  <button
                    aria-label={`Подтвердить пункт ${warning.title}`}
                    className="inline-review-action"
                    disabled={isDocumentLocked}
                    onClick={() => onResolveWarning(warning.id)}
                    type="button"
                  >
                    Подтвердить пункт
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <p className="empty-table-text">Все пункты проверки закрыты.</p>
          )}
        </section>

        <section className="review-block">
          <h3>Основные данные</h3>
          <div className="confirmation-summary" data-state={fieldSummary.pending === 0 && fieldSummary.rejected === 0 ? "complete" : "pending"}>
            <strong>{fieldSummary.confirmed} из {fieldSummary.total} полей подтверждено</strong>
            <span>{fieldReviewSummaryText(fieldSummary)}</span>
          </div>
          <div className="field-grid">
            {document.fields.map((field) => (
              <label
                className="review-field"
                data-confidence={field.confidence}
                data-confirmation={field.confirmationStatus}
                key={field.id}
              >
                <span>{field.label}</span>
                <input
                  aria-label={`${field.label}: значение`}
                  disabled={isDocumentLocked}
                  onChange={(event) => onChangeReviewField(field.id, event.currentTarget.value)}
                  value={field.value}
                />
                <div className="field-meta">
                  <em>{recognitionConfidenceText(field.confidence)}</em>
                  <strong>{fieldConfirmationText(field.confirmationStatus)}</strong>
                </div>
                <div className="field-review-actions" aria-label={`Решение по полю ${field.label}`}>
                  <button
                    aria-label={`Подтвердить поле ${field.label}`}
                    disabled={isDocumentLocked || field.confirmationStatus === "confirmed"}
                    onClick={() => onSetFieldConfirmation(field.id, "confirmed")}
                    type="button"
                  >
                    Подтвердить
                  </button>
                  <button
                    aria-label={`Не подтверждать поле ${field.label}`}
                    disabled={isDocumentLocked || field.confirmationStatus === "rejected"}
                    onClick={() => onSetFieldConfirmation(field.id, "rejected")}
                    type="button"
                  >
                    Не подтверждать
                  </button>
                </div>
              </label>
            ))}
          </div>
        </section>

        <section className="review-block">
          <h3>Контрагент</h3>
          <div className="counterparty-card">
            <div>
              <span>Найденный контрагент в 1С</span>
              <strong>{topCounterparty?.displayName ?? "не найден"}</strong>
            </div>
            <div>
              <span>Уверенность</span>
              <strong>{topCounterparty ? `${Math.round(topCounterparty.score * 100)}%` : "0%"}</strong>
            </div>
            <div>
              <span>Причина</span>
              <strong>{topCounterparty?.matchReasons[0] ?? "нужно подтвердить"}</strong>
            </div>
          </div>
          <div className="resolver-summary" data-tone={document.counterpartyResolution.requiresReview ? "warning" : "success"}>
            <strong>Базовый поиск контрагентов</strong>
            <span>
              {document.counterpartyResolution.requiresReview
                ? "Результат требует подтверждения бухгалтера."
                : "Контрагент сопоставлен по данным загруженного тестового PDF."}
            </span>
          </div>
        </section>

        <section className="review-block">
          <h3>Номенклатура</h3>
          <div className="resolver-summary" data-tone={document.nomenclatureResolution.requiresReview ? "warning" : "success"}>
            <strong>Базовый поиск номенклатуры</strong>
            <span>
              {topNomenclature
                ? `${topNomenclature.displayName}: ${Math.round(topNomenclature.score * 100)}%, ${
                    document.nomenclatureResolution.requiresReview ? "нужно проверить" : "можно принять"
                  }.`
                : "Кандидаты не найдены."}
            </span>
          </div>
          <div className="nomenclature-table" role="table" aria-label="Строки номенклатуры">
            <div className="nomenclature-row nomenclature-head" role="row">
              <span>Из документа</span>
              <span>В 1С</span>
              <span>Кол-во</span>
              <span>Ед. поставщика</span>
              <span>Ед. 1С</span>
              <span>Коэф.</span>
              <span>Цена</span>
              <span>Сумма</span>
              <span>Статус</span>
            </div>
            {document.nomenclatureLines.map((line) => (
              <div className="nomenclature-row" data-tone={line.tone} key={`${line.sourceName}-${line.amount}`} role="row">
                <span>{line.sourceName}</span>
                <span>{line.suggestedName}</span>
                <span>{line.quantity}</span>
                <span>{line.supplierUnit}</span>
                <span>{line.accountingUnit}</span>
                <span>{line.coefficient}</span>
                <span>{line.price}</span>
                <span>{line.amount}</span>
                <strong>{line.status}</strong>
              </div>
            ))}
          </div>
        </section>

        <footer className="action-bar">
          <div>
            <strong>Действие с документом</strong>
            <span>{documentActionBlockers.summary}</span>
          </div>
          <div className="action-buttons">
            <button
              className="primary-action"
              disabled={!canSendToOneC}
              onClick={onShowSendConfirmation}
              type="button"
            >
              Отправить в 1С
            </button>
            <button
              className="danger-action"
              disabled={!documentActionBlockers.canReject}
              onClick={onRejectDocument}
              type="button"
            >
              Отклонить
            </button>
          </div>
          <ActionNotice action={sendState} />
          <ActionNotice action={rejectState} />
          {documentActionState.writePackagePreview ? (
            <div className="action-notice" data-state="success" role="status">
              <strong>Последний preview пакета</strong>
              <span>{documentActionState.writePackagePreview}</span>
            </div>
          ) : null}
          {showSendConfirmation ? (
            <div className="send-confirmation">
              <span>
                Будет создан непроведённый черновик в 1С. В MVP реальная запись не выполняется без безопасного executor.
              </span>
              <button className="primary-action" onClick={onConfirmSendToOneC} type="button">
                Подтвердить отправку
              </button>
            </div>
          ) : null}
        </footer>
      </section>
    </div>
  );
}

type ConnectionUrlState = "empty" | "invalid" | "unsafe" | "ready";

function getConnectionUrlState(value: string): ConnectionUrlState {
  const trimmedValue = value.trim();

  if (trimmedValue.length === 0) {
    return "empty";
  }

  const hasSecretLikeQuery = /(?:^|[?&])(access_token|auth|api_key|apikey|password|pwd|refresh_token|secret|token)=/i.test(
    trimmedValue
  );

  try {
    const parsedUrl = new URL(trimmedValue);

    if (parsedUrl.username || parsedUrl.password || hasSecretLikeQuery) {
      return "unsafe";
    }

    return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:" ? "ready" : "invalid";
  } catch {
    return "invalid";
  }
}

function connectionStatusText(state: ConnectionUrlState) {
  switch (state) {
    case "ready":
      return "адрес указан";
    case "invalid":
      return "нужен http/https";
    case "unsafe":
      return "уберите секреты";
    case "empty":
    default:
      return "не настроено";
  }
}

function SettingsScreen() {
  const [connectionMode, setConnectionMode] = useState("");
  const [odataUrl, setOdataUrl] = useState("");
  const urlState = getConnectionUrlState(odataUrl);

  return (
    <div className="settings-grid">
      <section className="content-card">
        <div className="section-heading">
          <div>
            <h2>Подключение к 1С</h2>
            <p>Укажите способ подключения. Запись в 1С будет выполняться только через проверенные черновики.</p>
          </div>
          <span className="connection-status" data-state={urlState}>
            {connectionStatusText(urlState)}
          </span>
        </div>
        <form className="connection-form" onSubmit={(event) => event.preventDefault()}>
          <label className="connection-field">
            <span>Способ подключения</span>
            <select
              aria-label="Способ подключения"
              onChange={(event) => setConnectionMode(event.target.value)}
              value={connectionMode}
            >
              <option value="">Выберите способ</option>
              <option value="odata">OData / 1С Fresh или серверная 1С</option>
              <option value="local-agent">Локальная 1С через Desktop Agent</option>
            </select>
          </label>

          <label className="connection-field">
            <span>OData-ссылка</span>
            <input
              aria-describedby="odata-help"
              onChange={(event) => setOdataUrl(event.target.value)}
              placeholder="Вставьте ссылку на опубликованный OData-сервис"
              type="url"
              value={odataUrl}
            />
          </label>

          <div className="connection-help" id="odata-help">
            <strong>Как подключиться</strong>
            <span>
              Для Fresh или серверной 1С администратор публикует стандартный OData-сервис и выдаёт адрес сервиса.
              Для локальной базы используется Desktop Agent. Логины, пароли и токены нельзя вставлять в ссылку.
            </span>
          </div>

          <div className="settings-list">
            <SettingRow label="Безопасная запись" value="Только непроведённые черновики после проверки" />
          </div>
        </form>
      </section>
    </div>
  );
}

function ConnectionReportPanel({
  endpoint,
  error,
  isTauri,
  onEndpointChange,
  onRunCheck,
  report,
  state
}: {
  endpoint: string;
  error: string | null;
  isTauri: boolean;
  onEndpointChange: (value: string) => void;
  onRunCheck: () => void;
  report: ConnectionReadinessReport | null;
  state: ReadinessRunState;
}) {
  const status = report?.status ?? "review-only";

  return (
    <div className="wide-card connection-report-stack">
      <section className="readiness-hero" data-status={status}>
        <div>
          <p className="eyebrow">Отчёт подключения</p>
          <h2>{readinessHeadline(status)}</h2>
          <span>{readinessHeroText(report, isTauri)}</span>
        </div>
        <div className="readiness-totals" aria-label="Итог проверки">
          <strong>{report ? `${report.totals.found} из ${report.totals.required}` : "демо"}</strong>
          <span>необходимых полей найдено</span>
        </div>
      </section>

      <section className="content-card">
        <div className="section-heading">
          <div>
            <h2>Построить отчёт подключения</h2>
            <p>
              Агент читает опубликованные OData-метаданные и показывает, каких объектов и полей не хватает для
              безопасной подготовки черновиков.
            </p>
          </div>
        </div>

        <div className="readiness-form">
          <label>
            <span>OData endpoint</span>
            <input
              disabled={!isTauri || state === "checking"}
              onChange={(event) => onEndpointChange(event.currentTarget.value)}
              placeholder="https://server/base/odata/standard.odata/"
              value={endpoint}
            />
          </label>
          <button className="primary-action" disabled={state === "checking"} onClick={onRunCheck} type="button">
            {state === "checking" ? "Проверяем..." : "Построить отчёт"}
          </button>
        </div>

        {!isTauri ? (
          <div className="readiness-note">
            Открыто в браузере: показан демонстрационный отчёт. В Tauri будет выполнено реальное чтение OData
            метаданных без передачи логинов и паролей в интерфейс.
          </div>
        ) : null}

        {error ? <div className="readiness-error">{error}</div> : null}
      </section>

      {report ? (
        <>
          <section className="content-card">
            <div className="section-heading">
              <div>
                <h2>Структура готовности</h2>
                <p>{readinessSummaryText(report)}</p>
              </div>
              <span className="connection-status">{readinessStatusText(status)}</span>
            </div>

            <div className="readiness-section-list">
              {report.sections.map((section) => (
                <article className="readiness-section" data-status={section.status} key={section.code}>
                  <header>
                    <div>
                      <strong>{readinessSectionTitle(section)}</strong>
                      <span>{readinessSectionSummary(section)}</span>
                    </div>
                    <em>{readinessCheckStatusText(section.status)}</em>
                  </header>

                  <div className="readiness-list">
                    {section.checks.map((check) => (
                      <article className="readiness-row" data-status={check.status} key={check.code}>
                        <span className="readiness-indicator" />
                        <div>
                          <strong>{readinessCheckTitle(check)}</strong>
                          <span>{readinessCheckDescription(check)}</span>
                        </div>
                        <em>{readinessCheckStatusText(check.status)}</em>
                      </article>
                    ))}
                  </div>

                  {section.administratorActions.length > 0 ? (
                    <div className="admin-actions">
                      <strong>Что настроить</strong>
                      {section.administratorActions.map((action) => (
                        <span key={action}>{readinessActionText(action)}</span>
                      ))}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          </section>

          <section className="content-card">
            <div className="section-heading">
              <div>
                <h2>Ограничения отчёта</h2>
                <p>Эти пункты не блокируют работу, но показывают границы автоматической проверки.</p>
              </div>
            </div>
            <div className="limitation-list">
              {report.limitations.map((limitation) => (
                <span key={limitation}>{readinessLimitationText(limitation)}</span>
              ))}
            </div>
          </section>
        </>
      ) : (
        <section className="content-card empty-readiness">
          <h2>Отчёт ещё не построен</h2>
          <p>Укажите OData endpoint и запустите проверку, чтобы увидеть найденные объекты, поля и ограничения.</p>
        </section>
      )}
    </div>
  );
}

function AuditScreen({ auditEvents }: { auditEvents: AuditEvent[] }) {
  return (
    <section className="content-card">
      <div className="section-heading">
        <div>
          <h2>Журнал действий</h2>
          <p>История загрузки, распознавания, исправлений и остановок перед отправкой в 1С.</p>
        </div>
      </div>
      {auditEvents.length > 0 ? (
        <div className="audit-list">
          {auditEvents.map((event, index) => (
            <article className="audit-row" key={`${event.time}-${event.action}-${index}`}>
              <time>{event.time}</time>
              <div className="audit-document">
                <strong>
                  {event.documentType} №{event.documentNumber}
                </strong>
                <span>{event.documentDate}</span>
                <em>{event.counterparty}</em>
              </div>
              <div>
                <strong>{event.action}</strong>
                <span>{event.details}</span>
              </div>
              <div className="audit-actor">
                <span>Инициатор</span>
                <em>{event.actor}</em>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="empty-table-text">Журнал появится после загрузки документа.</p>
      )}
    </section>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  return (
    <article className="summary-card" data-tone={tone}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="setting-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ActionNotice({ action }: { action: ActionState }) {
  if (action.state === "idle") {
    return null;
  }

  return (
    <div className="action-notice" data-state={action.state} role={action.state === "error" ? "alert" : "status"}>
      <strong>{action.title}</strong>
      <span>{action.detail}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: DocumentStatus }) {
  return (
    <span className="status-badge" data-status={status}>
      {status}
    </span>
  );
}

function ReadinessMeter({ value }: { value: number }) {
  return (
    <span className="readiness-meter" aria-label={`Готовность ${value}%`}>
      <span className="readiness-track">
        <i style={{ width: `${value}%` }} />
      </span>
      <em>{value}%</em>
    </span>
  );
}

function sectionTitle(section: AppSection): string {
  if (section === "documents") return "Документы";
  if (section === "review") return "Проверка";
  if (section === "settings") return "Настройки";
  return "Журнал";
}

function readinessDemoCheck(
  code: string,
  status: ReadinessCheckStatus,
  severity: ReadinessSeverity,
  matchedObject?: string,
  matchedField?: string
): ReadinessReportCheck {
  return {
    code,
    label: code,
    status,
    severity,
    message: "Demo readiness check.",
    matchedObject: matchedObject ?? null,
    matchedField: matchedField ?? null,
    remediation: status === "found" ? null : "Administrator setup is required."
  };
}

function readinessHeadline(status: ReadinessReportStatus) {
  if (status === "ready") {
    return "Можно загружать документы";
  }

  if (status === "needs-admin-setup") {
    return "Нужна настройка администратора";
  }

  return "Можно работать только в режиме проверки";
}

function readinessHeroText(report: ConnectionReadinessReport | null, isTauri: boolean) {
  if (!report) {
    return "Проверка ещё не запускалась. Отчёт покажет найденные справочники, документы, поля и ограничения.";
  }

  if (!isTauri) {
    return "Демонстрационный режим показывает, как будет выглядеть отчёт после чтения OData-метаданных.";
  }

  if (report.status === "ready") {
    return "Опубликованные метаданные содержат критичные объекты и поля для подготовки безопасных черновиков.";
  }

  if (report.status === "needs-admin-setup") {
    return "Не хватает обязательных объектов или полей. До настройки нельзя безопасно готовить черновики.";
  }

  return "Критичные поля найдены, но часть правил и справочников требует подтверждения или настройки.";
}

function readinessStatusText(status: ReadinessReportStatus) {
  if (status === "ready") {
    return "готово";
  }

  if (status === "needs-admin-setup") {
    return "нужен администратор";
  }

  return "режим проверки";
}

function readinessSummaryText(report: ConnectionReadinessReport) {
  const criticalText =
    report.totals.criticalMissing > 0
      ? `Критичных пропусков: ${report.totals.criticalMissing}.`
      : "Критичных пропусков нет.";
  const warningText =
    report.totals.warnings > 0
      ? `Нужно проверить или настроить: ${report.totals.warnings}.`
      : "Дополнительных предупреждений нет.";

  return `Найдено ${report.totals.found} из ${report.totals.required} необходимых полей. ${criticalText} ${warningText}`;
}

function readinessSectionTitle(section: ReadinessSection) {
  const titles: Record<string, string> = {
    counterparties: "Контрагенты",
    nomenclature: "Номенклатура",
    purchaseDocuments: "Документы поступления",
    draftWrite: "Запись черновиков",
    setupRequired: "Поля, которые требуют настройки"
  };

  return titles[section.code] ?? section.title;
}

function readinessSectionSummary(section: ReadinessSection) {
  const found = section.checks.filter((check) => check.status === "found").length;

  return `Найдено ${found} из ${section.checks.length} проверок.`;
}

function readinessCheckTitle(check: ReadinessReportCheck) {
  const titles: Record<string, string> = {
    "counterparties.object": "Справочник контрагентов",
    "counterparties.ref": "Ключ контрагента",
    "counterparties.name": "Название контрагента",
    "counterparties.code": "Код контрагента",
    "counterparties.inn": "ИНН контрагента",
    "counterparties.kpp": "КПП контрагента",
    "nomenclature.object": "Справочник номенклатуры",
    "nomenclature.ref": "Ключ номенклатуры",
    "nomenclature.name": "Название номенклатуры",
    "nomenclature.code": "Код номенклатуры",
    "nomenclature.unit": "Единица учёта",
    "purchaseDocuments.object": "Документ поступления",
    "purchaseDocuments.ref": "Ключ документа",
    "purchaseDocuments.number": "Номер документа",
    "purchaseDocuments.date": "Дата документа",
    "purchaseDocuments.counterparty": "Контрагент в документе",
    "purchaseDocuments.organization": "Организация",
    "purchaseDocuments.amount": "Сумма документа",
    "purchaseDocuments.vat": "НДС",
    "draftWrite.targetDocument": "Целевой документ черновика",
    "draftWrite.targetReference": "Ключ черновика",
    "draftWrite.minimumPayload": "Минимальные поля черновика",
    "draftWrite.permissionCaveat": "Права на запись",
    "setupRequired.warehouse": "Склад",
    "setupRequired.contract": "Договор",
    "setupRequired.unit": "Единицы измерения",
    "setupRequired.conversionCoefficient": "Коэффициенты пересчёта"
  };

  return titles[check.code] ?? check.label;
}

function readinessCheckDescription(check: ReadinessReportCheck) {
  if (check.status === "found") {
    const foundParts = [check.matchedObject, check.matchedField].filter(Boolean);

    return foundParts.length > 0 ? `Найдено: ${foundParts.join(" / ")}.` : "Проверка пройдена.";
  }

  if (check.status === "missing") {
    return "Не найден обязательный объект или поле. Нужна настройка публикации OData.";
  }

  return "Пункт доступен частично или требует правила сопоставления перед отправкой документов.";
}

function readinessCheckStatusText(status: ReadinessCheckStatus) {
  if (status === "found") {
    return "найдено";
  }

  if (status === "missing") {
    return "не найдено";
  }

  return "требует настройки";
}

function readinessActionText(action: string) {
  const lower = action.toLowerCase();

  if (lower.includes("counterparty catalog")) {
    return "Опубликовать справочник контрагентов через OData.";
  }

  if (lower.includes("counterparty tax identifier")) {
    return "Опубликовать поле ИНН для точного сопоставления контрагентов.";
  }

  if (lower.includes("tax registration")) {
    return "Опубликовать поле КПП или задать ручное правило для случаев без КПП.";
  }

  if (lower.includes("nomenclature catalog")) {
    return "Опубликовать справочник номенклатуры через OData.";
  }

  if (lower.includes("unit field") || lower.includes("accounting units")) {
    return "Опубликовать единицы учёта или настроить ручное сопоставление единиц.";
  }

  if (lower.includes("purchase") || lower.includes("receipt document")) {
    return "Опубликовать документ поступления и его обязательные поля.";
  }

  if (lower.includes("counterparty reference")) {
    return "Опубликовать ссылку на контрагента в документе поступления.";
  }

  if (lower.includes("organization reference")) {
    return "Опубликовать ссылку на организацию в документе поступления.";
  }

  if (lower.includes("warehouse")) {
    return "Опубликовать поле склада или задать склад по умолчанию.";
  }

  if (lower.includes("contract")) {
    return "Опубликовать поле договора или настроить правило выбора договора.";
  }

  if (lower.includes("conversion")) {
    return "Опубликовать коэффициенты пересчёта или настроить ручные правила единиц.";
  }

  return "Проверить публикацию OData и права пользователя в 1С.";
}

function readinessLimitationText(limitation: string) {
  const lower = limitation.toLowerCase();

  if (lower.includes("published through odata")) {
    return "Отчёт видит только те объекты, которые опубликованы через OData и доступны текущему пользователю.";
  }

  if (lower.includes("draft write readiness")) {
    return "Готовность к записи означает только достаточность метаданных. Реальные права на создание черновиков проверяются отдельно.";
  }

  if (lower.includes("setup gaps")) {
    return "Часть настроек требует администратора перед полностью автоматической подготовкой черновиков.";
  }

  return "Есть ограничение, которое нужно учесть перед запуском в рабочем контуре.";
}

function readinessErrorMessage(error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";

  if (code === "invalidEndpoint") {
    return "Endpoint должен быть чистым http/https URL без логина, пароля, токена, query-строки или fragment.";
  }

  if (code === "serviceDocumentUnavailable" || code === "metadataUnavailable") {
    return "Не удалось прочитать OData-метаданные. Проверьте публикацию OData, сеть и права пользователя.";
  }

  if (code === "emptyMetadata" || code === "emptySnapshot") {
    return "Опубликованные метаданные не содержат доступных объектов 1С.";
  }

  if (code === "secretMaterialRejected" || code === "invalidAuthRef") {
    return "Проверка остановлена: в запрос попали данные, похожие на секрет. Используйте только чистый endpoint.";
  }

  return "Не удалось построить отчёт готовности. Проверьте подключение и повторите попытку.";
}

function actionErrorMessage(error: unknown) {
  const code = safeErrorCode(error);

  if (code === "authRequestNotFound" || code === "authRequestExpired" || code === "authRequestAlreadyConsumed") {
    return "Ссылка для входа устарела или уже использована. Запустите вход или регистрацию ещё раз.";
  }

  if (code === "invalidCredentials") {
    return "Почта или пароль неверные. Проверьте данные и повторите вход.";
  }

  if (code === "emailAlreadyRegistered") {
    return "Аккаунт с этой почтой уже есть. Попробуйте войти.";
  }

  if (code === "weakPassword") {
    return "Пароль должен быть не короче 8 символов и содержать буквы и цифры.";
  }

  if (code === "invalidPayloadVersion" || code === "invalidAuthInput") {
    return "Запрос входа некорректен. Запустите вход ещё раз.";
  }

  if (error instanceof Error) {
    if (error instanceof TypeError && /fetch/i.test(error.message)) {
      return "Не удалось подключиться к облачному backend API. Проверьте интернет-соединение и доступность https://api.smartsystema.online/api/health.";
    }

    return error.message;
  }

  return "Операция не выполнена. Проверьте настройки и повторите попытку.";
}

function safeErrorCode(error: unknown): string {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return "";
  }

  const code = (error as { code?: unknown }).code;

  return typeof code === "string" && /^[A-Za-z0-9._:-]{1,160}$/.test(code) ? code : "";
}
