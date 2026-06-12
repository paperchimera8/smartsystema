import type {
  CounterpartyResolutionResult,
  NomenclatureResolutionResult
} from "@automator/contracts";

export const SAMPLE_DOCUMENT_FILE_NAME = "automator-sample-upd-4512-romashka.pdf";
export const SAMPLE_DOCUMENT_SHA256 =
  "3d3d56fa2bc2a89b566e1c7f4499ee4cbedf68095c73c48e199ab7f3e0093702";

export type AppSection = "documents" | "review" | "settings" | "audit";

export type DocumentStatus =
  | "Загружен"
  | "Распознаётся"
  | "Требует проверки"
  | "Готов к отправке в 1С"
  | "Отправлен в 1С"
  | "Отклонён"
  | "Ошибка";

export type DocumentType = "УПД" | "акт" | "счет" | "накладная" | "счет-фактура" | "не определён";

export type Tone = "neutral" | "info" | "warning" | "success" | "danger";
export type RecognitionConfidence = "high" | "medium" | "low";
export type FieldConfirmationStatus = "pending" | "confirmed" | "rejected";
export type WarningResolutionStatus = "open" | "resolved";

export type DocumentRow = {
  id: string;
  fileName: string;
  documentType: DocumentType;
  supplier: string;
  date: string;
  amount: string;
  status: DocumentStatus;
  readiness: number;
  issueSummary: string;
  issueTone: Tone;
};

export type ReviewField = {
  id: string;
  label: string;
  value: string;
  confidence: RecognitionConfidence;
  confirmationStatus: FieldConfirmationStatus;
  required: boolean;
};

export type WarningItem = {
  id: string;
  tone: "info" | "warning" | "critical";
  title: string;
  description: string;
  resolutionStatus: WarningResolutionStatus;
};

export type NomenclatureLine = {
  sourceName: string;
  suggestedName: string;
  quantity: string;
  supplierUnit: string;
  accountingUnit: string;
  coefficient: string;
  price: string;
  amount: string;
  status: string;
  tone: Tone;
};

export type AuditEvent = {
  time: string;
  actor: string;
  documentType: DocumentType;
  documentNumber: string;
  documentDate: string;
  counterparty: string;
  action: string;
  details: string;
};

export type MappedDocument = {
  row: DocumentRow;
  preview: {
    title: string;
    pageLabel: string;
    documentType: string;
    supplier: string;
  };
  fields: ReviewField[];
  warnings: WarningItem[];
  nomenclatureLines: NomenclatureLine[];
  auditEvents: AuditEvent[];
  counterpartyResolution: CounterpartyResolutionResult;
  nomenclatureResolution: NomenclatureResolutionResult;
};

const sampleMappedDocument: MappedDocument = {
  row: {
    id: "sample-upd-4512",
    fileName: SAMPLE_DOCUMENT_FILE_NAME,
    documentType: "УПД",
    supplier: "ООО Ромашка",
    date: "28.05.2026",
    amount: "148 920,40 ₽",
    status: "Требует проверки",
    readiness: 82,
    issueSummary: "3 пункта проверки",
    issueTone: "warning"
  },
  preview: {
    title: SAMPLE_DOCUMENT_FILE_NAME,
    pageLabel: "Страница 1 из 1",
    documentType: "УПД",
    supplier: "ООО Ромашка"
  },
  fields: [
    reviewField("document-type", "Тип документа", "УПД", "high"),
    reviewField("number", "Номер", "4512", "high"),
    reviewField("date", "Дата", "28.05.2026", "high"),
    reviewField("supplier", "Поставщик", "ООО Ромашка", "high"),
    reviewField("tax-id", "ИНН / КПП", "7708123456 / 770801001", "high"),
    reviewField("total-amount", "Сумма", "148 920,40 ₽", "high"),
    reviewField("vat", "НДС", "24 820,07 ₽", "medium")
  ],
  warnings: [
    {
      id: "counterparty-inn-match",
      tone: "info",
      title: "Контрагент найден по ИНН",
      description: "ИНН и КПП совпали с карточкой ООО Ромашка в 1С.",
      resolutionStatus: "resolved"
    },
    {
      id: "nomenclature-review-required",
      tone: "warning",
      title: "Номенклатура требует подтверждения",
      description: "Для строки “Бумага офисная А4” найдено похожее совпадение по названию.",
      resolutionStatus: "open"
    },
    {
      id: "unit-conversion-missing",
      tone: "critical",
      title: "Единица измерения отличается",
      description: "В документе указана “коробка”, в 1С учет ведется в “штуках”. Коэффициент пересчета не найден.",
      resolutionStatus: "open"
    },
    {
      id: "vat-rounding-review",
      tone: "warning",
      title: "НДС отличается на 0,02 ₽",
      description: "Расхождение похоже на округление, но требует подтверждения перед созданием черновика.",
      resolutionStatus: "open"
    }
  ],
  nomenclatureLines: [
    {
      sourceName: "Бумага офисная А4, коробка",
      suggestedName: "Бумага А4 80 г/м2, 500 л.",
      quantity: "4",
      supplierUnit: "коробка",
      accountingUnit: "штука",
      coefficient: "не найден",
      price: "1 940,00 ₽",
      amount: "7 760,00 ₽",
      status: "не совпадает единица измерения",
      tone: "danger"
    },
    {
      sourceName: "Картридж лазерный TK-1170",
      suggestedName: "Картридж Kyocera TK-1170",
      quantity: "8",
      supplierUnit: "шт",
      accountingUnit: "шт",
      coefficient: "1",
      price: "6 420,00 ₽",
      amount: "51 360,00 ₽",
      status: "спорное совпадение",
      tone: "warning"
    },
    {
      sourceName: "Доставка",
      suggestedName: "Услуги доставки поставщика",
      quantity: "1",
      supplierUnit: "усл",
      accountingUnit: "усл",
      coefficient: "1",
      price: "89 800,40 ₽",
      amount: "89 800,40 ₽",
      status: "проверено",
      tone: "success"
    }
  ],
  auditEvents: [
    {
      time: "Сегодня, 14:42",
      actor: "Елена Смирнова",
      documentType: "УПД",
      documentNumber: "4512",
      documentDate: "28.05.2026",
      counterparty: "ООО Ромашка",
      action: "Загрузила документ",
      details: SAMPLE_DOCUMENT_FILE_NAME
    },
    {
      time: "Сегодня, 14:43",
      actor: "Система",
      documentType: "УПД",
      documentNumber: "4512",
      documentDate: "28.05.2026",
      counterparty: "ООО Ромашка",
      action: "Распознала основные поля",
      details: "Тип, номер, дата, сумма и НДС извлечены из тестового PDF."
    },
    {
      time: "Сегодня, 14:44",
      actor: "Система",
      documentType: "УПД",
      documentNumber: "4512",
      documentDate: "28.05.2026",
      counterparty: "ООО Ромашка",
      action: "Применила правила",
      details: "Контрагент сопоставлен по ИНН / КПП, номенклатура сопоставлена по коду и названию."
    },
    {
      time: "Сегодня, 14:49",
      actor: "Система",
      documentType: "УПД",
      documentNumber: "4512",
      documentDate: "28.05.2026",
      counterparty: "ООО Ромашка",
      action: "Остановила отправку",
      details: "Не настроен коэффициент пересчета единиц для строки с бумагой А4."
    }
  ],
  counterpartyResolution: {
    entityType: "counterparty",
    tenantId: "tenant-demo",
    metadataSnapshotId: "metadata-demo",
    correlationId: "ui-counterparty-sample",
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
  },
  nomenclatureResolution: {
    entityType: "nomenclature",
    tenantId: "tenant-demo",
    metadataSnapshotId: "metadata-demo",
    correlationId: "ui-nomenclature-sample",
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
  }
};

export async function mapUploadedDocumentFile(file: File): Promise<MappedDocument> {
  const checksum = await sha256File(file);
  const normalizedName = normalizeFileName(file.name);

  if (checksum === SAMPLE_DOCUMENT_SHA256 || normalizedName === SAMPLE_DOCUMENT_FILE_NAME) {
    return withUploadedFileName(sampleMappedDocument, file.name, checksum);
  }

  return unknownDocument(file.name, checksum);
}

function withUploadedFileName(
  document: MappedDocument,
  uploadedFileName: string,
  checksum: string
): MappedDocument {
  const mappedDocument = clone(document);
  const suffix = checksum.slice(0, 12);

  mappedDocument.row = {
    ...mappedDocument.row,
    id: `uploaded-${suffix}`,
    fileName: uploadedFileName
  };
  mappedDocument.preview = {
    ...mappedDocument.preview,
    title: uploadedFileName
  };
  mappedDocument.auditEvents = mappedDocument.auditEvents.map((event, index) =>
    index === 0 ? { ...event, details: uploadedFileName } : event
  );

  return mappedDocument;
}

function unknownDocument(fileName: string, checksum: string): MappedDocument {
  const id = `unknown-${checksum.slice(0, 12) || normalizeFileName(fileName)}`;

  return {
    row: {
      id,
      fileName,
      documentType: "не определён",
      supplier: "не распознан",
      date: "—",
      amount: "—",
      status: "Ошибка",
      readiness: 45,
      issueSummary: "нет локального OCR",
      issueTone: "danger"
    },
    preview: {
      title: fileName,
      pageLabel: "Файл загружен",
      documentType: "не определён",
      supplier: "не распознан"
    },
    fields: [
      reviewField("document-type", "Тип документа", "не определён", "low"),
      reviewField("number", "Номер", "—", "low"),
      reviewField("date", "Дата", "—", "low"),
      reviewField("supplier", "Поставщик", "не распознан", "low"),
      reviewField("tax-id", "ИНН / КПП", "—", "low"),
      reviewField("total-amount", "Сумма", "—", "low"),
      reviewField("vat", "НДС", "—", "low")
    ],
    warnings: [
      {
        id: "local-ocr-not-connected",
        tone: "critical",
        title: "Документ не распознан локальным MVP",
        description: "Сейчас без OCR-провайдера маппится только скачиваемый тестовый PDF СмартСистема.",
        resolutionStatus: "open"
      }
    ],
    nomenclatureLines: [],
    auditEvents: [
      {
        time: "Сейчас",
        actor: "Пользователь",
        documentType: "не определён",
        documentNumber: "—",
        documentDate: "—",
        counterparty: "не распознан",
        action: "Загрузил файл",
        details: fileName
      },
      {
        time: "Сейчас",
        actor: "Система",
        documentType: "не определён",
        documentNumber: "—",
        documentDate: "—",
        counterparty: "не распознан",
        action: "Остановила распознавание",
        details: "Для произвольных файлов нужен подключенный OCR-пайплайн."
      }
    ],
    counterpartyResolution: emptyCounterpartyResolution(),
    nomenclatureResolution: emptyNomenclatureResolution()
  };
}

async function sha256File(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function normalizeFileName(fileName: string): string {
  return fileName.trim().toLowerCase();
}

export function emptyCounterpartyResolution(): CounterpartyResolutionResult {
  return {
    entityType: "counterparty",
    tenantId: "tenant-demo",
    metadataSnapshotId: "metadata-demo",
    correlationId: "ui-counterparty-empty",
    candidates: [],
    requiresReview: true
  };
}

export function emptyNomenclatureResolution(): NomenclatureResolutionResult {
  return {
    entityType: "nomenclature",
    tenantId: "tenant-demo",
    metadataSnapshotId: "metadata-demo",
    correlationId: "ui-nomenclature-empty",
    candidates: [],
    requiresReview: true
  };
}

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

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
