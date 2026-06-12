import { ValidationPipe, type ArgumentMetadata } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { CreateDocumentExceptionDto } from "./create-document-exception.dto";

const metadata: ArgumentMetadata = {
  type: "body",
  metatype: CreateDocumentExceptionDto
};

function payload() {
  return {
    payloadVersion: 1,
    tenantId: "tenant-1",
    documentId: "document-1",
    draftId: "draft-1",
    metadataSnapshotId: "metadata-1",
    schemaHash: "schema-hash-1",
    stage: "entity_resolution",
    signals: [
      {
        code: "nomenclature_ambiguous",
        severity: "warning",
        message: "Two nomenclature candidates require accountant review.",
        lineId: "line-1",
        entityKind: "nomenclature",
        score: 0.72,
        candidateCount: 2
      }
    ],
    idempotencyKey: "exception-route-1",
    correlationId: "corr-1",
    createdByUserId: "user-1"
  };
}

describe("CreateDocumentExceptionDto", () => {
  const pipe = new ValidationPipe({
    forbidNonWhitelisted: true,
    transform: true,
    whitelist: true
  });

  it("accepts valid exception routing payloads", async () => {
    const result = await pipe.transform(payload(), metadata);

    expect(result).toBeInstanceOf(CreateDocumentExceptionDto);
  });

  it("rejects caller-provided queue and write fields", async () => {
    await expect(
      pipe.transform(
        {
          ...payload(),
          queueName: "accountant_review",
          writeStatus: "queued"
        },
        metadata
      )
    ).rejects.toThrow();
  });

  it("rejects empty signal arrays", async () => {
    await expect(pipe.transform({ ...payload(), signals: [] }, metadata)).rejects.toThrow();
  });

  it("rejects unsupported signal codes", async () => {
    await expect(
      pipe.transform(
        {
          ...payload(),
          signals: [{ ...payload().signals[0], code: "unknown_problem" }]
        },
        metadata
      )
    ).rejects.toThrow();
  });

  it("enforces signal count limits at the DTO boundary", async () => {
    await expect(
      pipe.transform(
        {
          ...payload(),
          signals: Array.from({ length: 101 }, (_, index) => ({
            code: "low_field_confidence",
            severity: "warning",
            message: `Field ${index} requires review.`
          }))
        },
        metadata
      )
    ).rejects.toThrow();
  });
});
