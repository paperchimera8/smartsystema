import { describe, expect, it, vi } from "vitest";
import type {
  CreateDocumentExceptionRequest,
  CreateDocumentExceptionResponse
} from "@automator/contracts";
import { DocumentExceptionsController } from "./document-exceptions.controller";
import type { DocumentExceptionsService } from "./document-exceptions.service";

function request(): CreateDocumentExceptionRequest {
  return {
    payloadVersion: 1,
    tenantId: "tenant-1",
    documentId: "document-1",
    stage: "entity_resolution",
    signals: [
      {
        code: "nomenclature_ambiguous",
        severity: "warning",
        message: "Two candidates require review.",
        entityKind: "nomenclature"
      }
    ],
    idempotencyKey: "exception-idempotency-1",
    correlationId: "corr-1",
    createdByUserId: "user-1"
  };
}

describe("DocumentExceptionsController", () => {
  it("delegates exception queueing to the service", async () => {
    const response: CreateDocumentExceptionResponse = {
      exceptionId: "exception-1",
      tenantId: "tenant-1",
      documentId: "document-1",
      category: "nomenclature_issue",
      queueName: "accountant_review",
      priority: "high",
      status: "open",
      requiresAccountantReview: true,
      requiresAdminReview: false,
      signalCount: 1,
      topSignalCode: "nomenclature_ambiguous",
      suggestedActions: ["Review nomenclature."],
      idempotencyReplay: false,
      createdAt: "2026-05-31T00:00:00.000Z",
      correlationId: "corr-1"
    };
    const service = {
      createException: vi.fn(async () => response)
    } as unknown as DocumentExceptionsService;
    const controller = new DocumentExceptionsController(service);

    await expect(controller.createException(request())).resolves.toBe(response);
    expect(service.createException).toHaveBeenCalledWith(request());
  });
});
