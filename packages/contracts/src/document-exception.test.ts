import { describe, expect, it } from "vitest";
import {
  DOCUMENT_EXCEPTION_PAYLOAD_VERSION,
  DOCUMENT_EXCEPTION_SIGNAL_CODES,
  type CreateDocumentExceptionRequest,
  type CreateDocumentExceptionResponse,
  type DocumentExceptionError,
  type DocumentExceptionSignal
} from "./index";

describe("document exception queue contracts", () => {
  it("accepts document exception request and response shapes", () => {
    const signal = {
      code: "nomenclature_ambiguous",
      severity: "warning",
      message: "Two nomenclature candidates are close enough to require accountant review.",
      lineId: "line-1",
      entityKind: "nomenclature",
      score: 0.72,
      candidateCount: 2
    } satisfies DocumentExceptionSignal;

    const request = {
      payloadVersion: DOCUMENT_EXCEPTION_PAYLOAD_VERSION,
      tenantId: "tenant-1",
      documentId: "document-1",
      draftId: "draft-1",
      metadataSnapshotId: "metadata-1",
      schemaHash: "schema-hash-1",
      stage: "entity_resolution",
      signals: [signal],
      idempotencyKey: "exception-route-1",
      correlationId: "corr-1",
      createdByUserId: "user-1"
    } satisfies CreateDocumentExceptionRequest;

    const response = {
      exceptionId: "exception-1",
      tenantId: request.tenantId,
      documentId: request.documentId,
      draftId: request.draftId,
      category: "nomenclature_issue",
      queueName: "accountant_review",
      priority: "high",
      status: "open",
      requiresAccountantReview: true,
      requiresAdminReview: false,
      signalCount: 1,
      topSignalCode: "nomenclature_ambiguous",
      suggestedActions: ["Confirm the nomenclature candidate or choose another catalog item."],
      idempotencyReplay: false,
      createdAt: "2026-05-31T00:00:00.000Z",
      correlationId: request.correlationId
    } satisfies CreateDocumentExceptionResponse;

    expect(response.status).toBe("open");
    expect(response.queueName).toBe("accountant_review");
  });

  it("accepts normalized document exception errors", () => {
    const error = {
      code: "idempotencyConflict",
      message: "An exception already exists for this idempotency key with a different payload.",
      retryable: false,
      remediation: "Retry with the original payload or use a new idempotency key.",
      correlationId: "corr-1"
    } satisfies DocumentExceptionError;

    expect(error.code).toBe("idempotencyConflict");
  });

  it("does not expose removed duplicate-detection signals", () => {
    expect(DOCUMENT_EXCEPTION_SIGNAL_CODES).not.toContain("duplicate_suspected");
  });
});
