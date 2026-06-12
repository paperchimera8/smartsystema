import { describe, expect, it } from "vitest";
import {
  DRAFT_CREATION_PAYLOAD_VERSION,
  type CreateDraftRequest,
  type CreateDraftResponse,
  type DraftCreationError,
  type DraftField,
  type DraftReference
} from "./index";

describe("draft creation contracts", () => {
  it("accepts draft creation request and response shapes", () => {
    const field = {
      name: "Date",
      value: "2026-05-28",
      sourceField: "invoice_date",
      confidence: 0.97
    } satisfies DraftField;

    const reference = {
      name: "Counterparty",
      fieldName: "Counterparty_Key",
      targetResourceName: "Catalog_Counterparties",
      targetKey: "counterparty-1",
      candidateId: "counterparty-1",
      confidence: 0.98
    } satisfies DraftReference;

    const request = {
      payloadVersion: DRAFT_CREATION_PAYLOAD_VERSION,
      tenantId: "tenant-1",
      documentId: "document-1",
      metadataSnapshotId: "metadata-1",
      schemaHash: "schema-hash-1",
      documentType: "purchase-invoice",
      targetResourceName: "Document_PurchaseInvoice",
      fields: [field],
      references: [reference],
      confidence: {
        score: 0.93,
        reasons: ["High-confidence extraction and entity resolution."],
        requiresReview: true
      },
      validationSummary: {
        status: "warning",
        messages: [
          {
            code: "manual-review-required",
            severity: "warning",
            message: "Accountant approval is required before any write planning."
          }
        ]
      },
      idempotencyKey: "draft-create-1",
      correlationId: "corr-1",
      createdByUserId: "user-1"
    } satisfies CreateDraftRequest;

    const response = {
      draftId: "draft-1",
      tenantId: request.tenantId,
      documentId: request.documentId,
      metadataSnapshotId: request.metadataSnapshotId,
      lifecycleStatus: "needs_review",
      approvalStatus: "pending",
      writeStatus: "not_requested",
      requiresAccountantApproval: true,
      idempotencyReplay: false,
      createdAt: "2026-05-28T00:00:00.000Z",
      correlationId: request.correlationId
    } satisfies CreateDraftResponse;

    expect(response.lifecycleStatus).toBe("needs_review");
    expect(response.approvalStatus).toBe("pending");
    expect(response.writeStatus).toBe("not_requested");
    expect(response.requiresAccountantApproval).toBe(true);
  });

  it("accepts normalized draft creation errors", () => {
    const error = {
      code: "idempotencyConflict",
      message: "A draft already exists for this idempotency key with a different payload.",
      retryable: false,
      remediation: "Use a new idempotency key or retry with the original payload.",
      correlationId: "corr-1"
    } satisfies DraftCreationError;

    expect(error.code).toBe("idempotencyConflict");
  });
});
