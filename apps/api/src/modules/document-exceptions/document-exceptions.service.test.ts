import { HttpException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { CreateDocumentExceptionRequest } from "@automator/contracts";
import {
  DocumentExceptionsService,
  hashDocumentExceptionRequest,
  normalizeDocumentExceptionRequest,
  routeDocumentException
} from "./document-exceptions.service";
import type {
  DocumentExceptionRow,
  DocumentExceptionsRepository,
  PersistDocumentExceptionInput
} from "./document-exceptions.repository";

function request(
  overrides: Partial<CreateDocumentExceptionRequest> = {}
): CreateDocumentExceptionRequest {
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
    createdByUserId: "user-1",
    ...overrides
  };
}

function exceptionRow(
  input: PersistDocumentExceptionInput,
  requestHash = input.requestHash
): DocumentExceptionRow {
  return {
    exceptionId: input.exceptionId,
    tenantId: input.tenantId,
    documentId: input.documentId,
    draftId: input.draftId ?? null,
    metadataSnapshotId: input.metadataSnapshotId ?? null,
    schemaHash: input.schemaHash ?? null,
    stage: input.stage,
    category: input.category,
    queueName: input.queueName,
    priority: input.priority,
    status: "open",
    requiresAccountantReview: input.requiresAccountantReview,
    requiresAdminReview: input.requiresAdminReview,
    signals: input.signals,
    topSignalCode: input.topSignalCode,
    suggestedActions: input.suggestedActions,
    idempotencyKey: input.idempotencyKey,
    requestHash,
    correlationId: input.correlationId,
    createdByUserId: input.createdByUserId,
    createdAt: input.createdAt,
    updatedAt: input.createdAt
  };
}

function repository(existing?: DocumentExceptionRow): {
  repository: DocumentExceptionsRepository;
  createExceptionAndAudit: ReturnType<typeof vi.fn>;
} {
  const createExceptionAndAudit = vi.fn(async (input: PersistDocumentExceptionInput) => ({
    exceptionId: input.exceptionId,
    tenantId: input.tenantId,
    documentId: input.documentId,
    ...(input.draftId === undefined ? {} : { draftId: input.draftId }),
    category: input.category,
    queueName: input.queueName,
    priority: input.priority,
    status: "open" as const,
    requiresAccountantReview: input.requiresAccountantReview,
    requiresAdminReview: input.requiresAdminReview,
    signalCount: input.signals.length,
    topSignalCode: input.topSignalCode,
    suggestedActions: input.suggestedActions,
    idempotencyReplay: false,
    createdAt: input.createdAt.toISOString(),
    correlationId: input.correlationId
  }));

  return {
    createExceptionAndAudit,
    repository: {
      findByTenantAndIdempotencyKey: vi.fn(async () => existing),
      createExceptionAndAudit
    } as unknown as DocumentExceptionsRepository
  };
}

describe("DocumentExceptionsService", () => {
  it("routes ambiguous nomenclature to accountant review", async () => {
    const fakeRepository = repository();
    const service = new DocumentExceptionsService(fakeRepository.repository);
    const result = await service.createException(request());
    const persisted = fakeRepository.createExceptionAndAudit.mock
      .calls[0]?.[0] as PersistDocumentExceptionInput;

    expect(result.category).toBe("nomenclature_issue");
    expect(result.queueName).toBe("accountant_review");
    expect(result.status).toBe("open");
    expect(result.requiresAccountantReview).toBe(true);
    expect(persisted.topSignalCode).toBe("nomenclature_ambiguous");
  });

  it("routes low confidence to accountant review with high priority when score is very low", () => {
    const route = routeDocumentException([
      {
        code: "low_document_confidence",
        severity: "warning",
        message: "Document confidence is below threshold.",
        score: 0.42
      }
    ]);

    expect(route).toMatchObject({
      category: "low_confidence",
      queueName: "accountant_review",
      priority: "high",
      requiresAccountantReview: true
    });
  });

  it("routes metadata gaps to administrator setup", () => {
    const route = routeDocumentException([
      {
        code: "metadata_gap",
        severity: "critical",
        message: "Required purchase document field is not published."
      }
    ]);

    expect(route).toMatchObject({
      category: "metadata_gap",
      queueName: "admin_setup",
      priority: "urgent",
      requiresAdminReview: true,
      requiresAccountantReview: false
    });
  });

  it("rejects removed duplicate-detection signals", () => {
    expect(() =>
      normalizeDocumentExceptionRequest(
        request({
          signals: [
            {
              code: "duplicate_suspected",
              severity: "warning",
              message: "Legacy duplicate detection is no longer supported."
            }
          ] as unknown as CreateDocumentExceptionRequest["signals"]
        })
      )
    ).toThrow(HttpException);
  });

  it("chooses the highest-risk signal deterministically", () => {
    const normalized = normalizeDocumentExceptionRequest(
      request({
        signals: [
          {
            code: "low_field_confidence",
            severity: "warning",
            message: "A field requires review.",
            field: "VATAmount",
            score: 0.62
          },
          {
            code: "validation_error",
            severity: "critical",
            message: "Required total does not match line totals.",
            field: "TotalAmount"
          }
        ]
      })
    );

    expect(normalized.topSignalCode).toBe("validation_error");
    expect(normalized.category).toBe("validation_failed");
    expect(normalized.priority).toBe("urgent");
  });

  it("returns an existing exception for an idempotent replay with the same payload", async () => {
    const normalized = normalizeDocumentExceptionRequest(request());
    const existing = exceptionRow(
      {
        ...normalized,
        exceptionId: "exception-existing",
        requestHash: hashDocumentExceptionRequest(normalized),
        createdAt: new Date("2026-05-31T00:00:00.000Z")
      },
      hashDocumentExceptionRequest(normalized)
    );
    const service = new DocumentExceptionsService(repository(existing).repository);
    const result = await service.createException(request());

    expect(result.exceptionId).toBe("exception-existing");
    expect(result.idempotencyReplay).toBe(true);
  });

  it("rejects idempotency key reuse with a different payload", async () => {
    const normalized = normalizeDocumentExceptionRequest(request());
    const existing = exceptionRow({
      ...normalized,
      exceptionId: "exception-existing",
      requestHash: "different-hash",
      createdAt: new Date("2026-05-31T00:00:00.000Z")
    });
    const service = new DocumentExceptionsService(repository(existing).repository);

    await expect(service.createException(request())).rejects.toMatchObject({
      response: expect.objectContaining({ code: "idempotencyConflict" })
    });
  });

  it("rejects caller-provided queue, status, and write fields", async () => {
    const service = new DocumentExceptionsService(repository().repository);
    const unsafeRequest = {
      ...request(),
      queueName: "accountant_review",
      status: "open",
      writeStatus: "queued"
    } as unknown as CreateDocumentExceptionRequest;

    await expect(service.createException(unsafeRequest)).rejects.toBeInstanceOf(HttpException);
  });

  it("rejects secret-like signal material before persistence", async () => {
    const fakeRepository = repository();
    const service = new DocumentExceptionsService(fakeRepository.repository);

    await expect(
      service.createException(
        request({
          signals: [
            {
              code: "low_field_confidence",
              severity: "warning",
              message: "token=secret",
              field: "Comment"
            }
          ]
        })
      )
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "secretMaterialRejected" })
    });
    expect(fakeRepository.createExceptionAndAudit).not.toHaveBeenCalled();
  });

  it("rejects raw document markers before persistence", async () => {
    const fakeRepository = repository();
    const service = new DocumentExceptionsService(fakeRepository.repository);

    await expect(
      service.createException(
        request({
          signals: [
            {
              code: "ocr_failed",
              severity: "critical",
              message: "raw_ocr payload was too noisy"
            }
          ]
        })
      )
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "invalidExceptionInput" })
    });
    expect(fakeRepository.createExceptionAndAudit).not.toHaveBeenCalled();
  });

  it("normalizes signal ordering for deterministic idempotency hashes", () => {
    const left = normalizeDocumentExceptionRequest(
      request({
        signals: [
          {
            code: "unit_mismatch",
            severity: "warning",
            message: "Unit conversion is missing.",
            field: "Unit"
          },
          {
            code: "nomenclature_ambiguous",
            severity: "warning",
            message: "Two candidates require review.",
            lineId: "line-1"
          }
        ]
      })
    );
    const right = normalizeDocumentExceptionRequest(
      request({
        signals: [
          {
            code: "nomenclature_ambiguous",
            severity: "warning",
            message: "Two candidates require review.",
            lineId: "line-1"
          },
          {
            code: "unit_mismatch",
            severity: "warning",
            message: "Unit conversion is missing.",
            field: "Unit"
          }
        ]
      })
    );

    expect(left.signals.map((signal) => signal.code)).toEqual([
      "nomenclature_ambiguous",
      "unit_mismatch"
    ]);
    expect(hashDocumentExceptionRequest(left)).toBe(hashDocumentExceptionRequest(right));
  });

  it("uses optional field and line identifiers when signal ordering otherwise ties", () => {
    const normalized = normalizeDocumentExceptionRequest(
      request({
        signals: [
          {
            code: "nomenclature_ambiguous",
            severity: "warning",
            message: "Two candidates require review.",
            field: "Item",
            lineId: "line-2"
          },
          {
            code: "nomenclature_ambiguous",
            severity: "warning",
            message: "Two candidates require review.",
            field: "Item",
            lineId: "line-1"
          }
        ]
      })
    );

    expect(normalized.signals.map((signal) => signal.lineId)).toEqual(["line-1", "line-2"]);
  });

  it("redacts unsafe correlation ids from early validation errors", async () => {
    const service = new DocumentExceptionsService(repository().repository);

    await expect(
      service.createException({
        ...request(),
        payloadVersion: 2,
        correlationId: "token=secret"
      } as unknown as CreateDocumentExceptionRequest)
    ).rejects.toMatchObject({
      response: expect.not.objectContaining({ correlationId: expect.any(String) })
    });
  });
});
