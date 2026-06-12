import { ValidationPipe, type ArgumentMetadata } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { CreateDraftDto } from "./create-draft.dto";

const metadata: ArgumentMetadata = {
  type: "body",
  metatype: CreateDraftDto
};

function payload() {
  return {
    payloadVersion: 1,
    tenantId: "tenant-1",
    documentId: "document-1",
    metadataSnapshotId: "metadata-1",
    schemaHash: "schema-hash-1",
    documentType: "purchase-invoice",
    targetResourceName: "Document_PurchaseInvoice",
    fields: [{ name: "Date", value: "2026-05-28" }],
    references: [{ name: "Counterparty", fieldName: "Counterparty_Key" }],
    confidence: {
      score: 0.94,
      reasons: ["High-confidence mapping."],
      requiresReview: true
    },
    validationSummary: {
      status: "warning",
      messages: [
        {
          code: "manual-review-required",
          severity: "warning",
          message: "Accountant review is required before write planning."
        }
      ]
    },
    idempotencyKey: "draft-create-1",
    correlationId: "corr-1",
    createdByUserId: "user-1"
  };
}

describe("CreateDraftDto", () => {
  const pipe = new ValidationPipe({
    forbidNonWhitelisted: true,
    transform: true,
    whitelist: true
  });

  it("accepts valid draft creation payloads", async () => {
    const result = await pipe.transform(payload(), metadata);

    expect(result).toBeInstanceOf(CreateDraftDto);
  });

  it("rejects approval and write fields supplied by callers", async () => {
    await expect(
      pipe.transform(
        {
          ...payload(),
          approvalStatus: "approved",
          writeStatus: "queued"
        },
        metadata
      )
    ).rejects.toThrow();
  });

  it("rejects empty field arrays", async () => {
    await expect(pipe.transform({ ...payload(), fields: [] }, metadata)).rejects.toThrow();
  });

  it("rejects missing required nested summaries", async () => {
    const { confidence: _confidence, ...withoutConfidence } = payload();

    await expect(pipe.transform(withoutConfidence, metadata)).rejects.toThrow();
  });

  it("rejects unsupported payload versions", async () => {
    await expect(pipe.transform({ ...payload(), payloadVersion: 2 }, metadata)).rejects.toThrow();
  });

  it("rejects nested command fields in mapped field records", async () => {
    await expect(
      pipe.transform(
        {
          ...payload(),
          fields: [{ name: "Date", value: "2026-05-28", writeStatus: "queued" }]
        },
        metadata
      )
    ).rejects.toThrow();
  });

  it("enforces field and reference count limits at the DTO boundary", async () => {
    await expect(
      pipe.transform(
        {
          ...payload(),
          fields: Array.from({ length: 251 }, (_, index) => ({
            name: `Field${index}`,
            value: index
          }))
        },
        metadata
      )
    ).rejects.toThrow();

    await expect(
      pipe.transform(
        {
          ...payload(),
          references: Array.from({ length: 251 }, (_, index) => ({
            name: `Reference${index}`,
            fieldName: `Reference${index}_Key`
          }))
        },
        metadata
      )
    ).rejects.toThrow();
  });
});
