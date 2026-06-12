import { describe, expect, it, vi } from "vitest";
import type { CreateDraftRequest, CreateDraftResponse } from "@automator/contracts";
import { DraftsController } from "./drafts.controller";
import type { DraftsService } from "./drafts.service";

function request(): CreateDraftRequest {
  return {
    payloadVersion: 1,
    tenantId: "tenant-1",
    documentId: "document-1",
    metadataSnapshotId: "metadata-1",
    schemaHash: "schema-1",
    documentType: "purchase-invoice",
    targetResourceName: "Document_PurchaseInvoice",
    fields: [{ name: "Date", value: "2026-05-31" }],
    confidence: {
      score: 0.9,
      reasons: ["Controller test."],
      requiresReview: true
    },
    validationSummary: {
      status: "warning",
      messages: []
    },
    idempotencyKey: "draft-idempotency-1",
    correlationId: "corr-1",
    createdByUserId: "user-1"
  };
}

describe("DraftsController", () => {
  it("delegates draft creation to the service", async () => {
    const response: CreateDraftResponse = {
      draftId: "draft-1",
      tenantId: "tenant-1",
      documentId: "document-1",
      metadataSnapshotId: "metadata-1",
      lifecycleStatus: "needs_review",
      approvalStatus: "pending",
      writeStatus: "not_requested",
      requiresAccountantApproval: true,
      idempotencyReplay: false,
      createdAt: "2026-05-31T00:00:00.000Z",
      correlationId: "corr-1"
    };
    const service = {
      createDraft: vi.fn(async () => response)
    } as unknown as DraftsService;
    const controller = new DraftsController(service);

    await expect(controller.createDraft(request())).resolves.toBe(response);
    expect(service.createDraft).toHaveBeenCalledWith(request());
  });
});
