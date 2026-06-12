import { HttpException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { CreateDraftRequest } from "@automator/contracts";
import {
  DraftsService,
  hashDraftRequest,
  normalizeDraftCreationRequest
} from "./drafts.service";
import type { DraftRow, DraftsRepository, PersistDraftInput } from "./drafts.repository";

function request(overrides: Partial<CreateDraftRequest> = {}): CreateDraftRequest {
  return {
    payloadVersion: 1,
    tenantId: "tenant-1",
    documentId: "document-1",
    metadataSnapshotId: "metadata-1",
    schemaHash: "schema-hash-1",
    documentType: "purchase-invoice",
    targetResourceName: "Document_PurchaseInvoice",
    fields: [
      {
        name: "Date",
        value: "2026-05-28",
        sourceField: "invoice_date",
        confidence: 0.97
      }
    ],
    references: [
      {
        name: "Counterparty",
        fieldName: "Counterparty_Key",
        targetResourceName: "Catalog_Counterparties",
        targetKey: "counterparty-1",
        confidence: 0.98
      }
    ],
    confidence: {
      score: 0.94,
      reasons: ["High-confidence mapping."],
      requiresReview: false
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
    createdByUserId: "user-1",
    ...overrides
  };
}

function draftRow(input: PersistDraftInput, requestHash = input.requestHash): DraftRow {
  return {
    draftId: input.draftId,
    tenantId: input.tenantId,
    documentId: input.documentId,
    metadataSnapshotId: input.metadataSnapshotId,
    schemaHash: input.schemaHash,
    documentType: input.documentType,
    targetResourceName: input.targetResourceName,
    lifecycleStatus: "needs_review",
    approvalStatus: "pending",
    writeStatus: "not_requested",
    requiresAccountantApproval: true,
    fields: input.fields,
    references: input.references,
    confidence: input.confidence,
    validationSummary: input.validationSummary,
    idempotencyKey: input.idempotencyKey,
    requestHash,
    correlationId: input.correlationId,
    createdByUserId: input.createdByUserId,
    createdAt: input.createdAt,
    updatedAt: input.createdAt
  };
}

function repository(existing?: DraftRow): {
  repository: DraftsRepository;
  createDraftAndAudit: ReturnType<typeof vi.fn>;
} {
  const createDraftAndAudit = vi.fn(async (input: PersistDraftInput) => ({
    draftId: input.draftId,
    tenantId: input.tenantId,
    documentId: input.documentId,
    metadataSnapshotId: input.metadataSnapshotId,
    lifecycleStatus: "needs_review",
    approvalStatus: "pending",
    writeStatus: "not_requested",
    requiresAccountantApproval: true,
    idempotencyReplay: false,
    createdAt: input.createdAt.toISOString(),
    correlationId: input.correlationId
  }));

  return {
    createDraftAndAudit,
    repository: {
      findByTenantAndIdempotencyKey: vi.fn(async () => existing),
      createDraftAndAudit
    } as unknown as DraftsRepository
  };
}

describe("DraftsService", () => {
  it("creates drafts in accountant-review state", async () => {
    const fakeRepository = repository();
    const service = new DraftsService(fakeRepository.repository);
    const result = await service.createDraft(request());
    const persisted = fakeRepository.createDraftAndAudit.mock.calls[0]?.[0] as PersistDraftInput;

    expect(result.lifecycleStatus).toBe("needs_review");
    expect(result.approvalStatus).toBe("pending");
    expect(result.writeStatus).toBe("not_requested");
    expect(result.requiresAccountantApproval).toBe(true);
    expect(result.idempotencyReplay).toBe(false);
    expect(persisted.confidence.requiresReview).toBe(true);
  });

  it("rejects caller-provided lifecycle, approval, write, and command fields", async () => {
    const service = new DraftsService(repository().repository);
    const unsafeRequest = {
      ...request(),
      approvalStatus: "approved",
      writeStatus: "queued",
      commandId: "command-1"
    } as unknown as CreateDraftRequest;

    await expect(service.createDraft(unsafeRequest)).rejects.toBeInstanceOf(HttpException);
  });

  it("returns an existing draft for an idempotent replay with the same payload", async () => {
    const normalized = normalizeDraftCreationRequest(request());
    const existing = draftRow(
      {
        ...normalized,
        draftId: "draft-existing",
        requestHash: hashDraftRequest(normalized),
        createdAt: new Date("2026-05-28T00:00:00.000Z")
      },
      hashDraftRequest(normalized)
    );
    const service = new DraftsService(repository(existing).repository);
    const result = await service.createDraft(request());

    expect(result.draftId).toBe("draft-existing");
    expect(result.idempotencyReplay).toBe(true);
  });

  it("rejects idempotency key reuse with a different payload", async () => {
    const normalized = normalizeDraftCreationRequest(request());
    const existing = draftRow({
      ...normalized,
      draftId: "draft-existing",
      requestHash: "different-hash",
      createdAt: new Date("2026-05-28T00:00:00.000Z")
    });
    const service = new DraftsService(repository(existing).repository);

    await expect(service.createDraft(request())).rejects.toMatchObject({
      response: expect.objectContaining({ code: "idempotencyConflict" })
    });
  });

  it("rejects secret-like material before persistence", async () => {
    const fakeRepository = repository();
    const service = new DraftsService(fakeRepository.repository);

    await expect(
      service.createDraft(
        request({
          fields: [{ name: "Comment", value: "token=secret" }]
        })
      )
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "secretMaterialRejected" })
    });
    expect(fakeRepository.createDraftAndAudit).not.toHaveBeenCalled();
  });

  it("rejects raw document markers before persistence", async () => {
    const fakeRepository = repository();
    const service = new DraftsService(fakeRepository.repository);

    await expect(
      service.createDraft(
        request({
          fields: [{ name: "Comment", value: { raw_ocr: "large sensitive OCR text" } }]
        })
      )
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "invalidDraftInput" })
    });
    expect(fakeRepository.createDraftAndAudit).not.toHaveBeenCalled();
  });

  it("rejects oversized mapped field strings before persistence", async () => {
    const fakeRepository = repository();
    const service = new DraftsService(fakeRepository.repository);

    await expect(
      service.createDraft(
        request({
          fields: [{ name: "Comment", value: "x".repeat(4_001) }]
        })
      )
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "invalidDraftInput" })
    });
    expect(fakeRepository.createDraftAndAudit).not.toHaveBeenCalled();
  });

  it("normalizes field and reference ordering for deterministic idempotency hashes", () => {
    const normalizedLeft = normalizeDraftCreationRequest(
      request({
        fields: [
          { name: "Total", value: 1200 },
          { name: "Date", value: "2026-05-28" }
        ],
        references: [
          { name: "Warehouse", fieldName: "Warehouse_Key" },
          { name: "Counterparty", fieldName: "Counterparty_Key" }
        ]
      })
    );
    const normalizedRight = normalizeDraftCreationRequest(
      request({
        fields: [
          { name: "Date", value: "2026-05-28" },
          { name: "Total", value: 1200 }
        ],
        references: [
          { name: "Counterparty", fieldName: "Counterparty_Key" },
          { name: "Warehouse", fieldName: "Warehouse_Key" }
        ]
      })
    );

    expect(normalizedLeft.fields.map((field) => field.name)).toEqual(["Date", "Total"]);
    expect(normalizedLeft.references.map((reference) => reference.name)).toEqual([
      "Counterparty",
      "Warehouse"
    ]);
    expect(hashDraftRequest(normalizedLeft)).toBe(hashDraftRequest(normalizedRight));
  });

  it("fails closed for malformed direct service payloads instead of throwing TypeError", async () => {
    const invalidPayloads = [
      ["null payload", null],
      ["missing fields", { fields: undefined }],
      ["non-array fields", { fields: "Date" }],
      ["non-object field", { fields: [null] }],
      ["invalid field value", { fields: [{ name: "Date", value: undefined }] }],
      ["missing confidence", { confidence: undefined }],
      ["invalid confidence reasons", { confidence: { score: 0.9, reasons: "ok" } }],
      [
        "too many validation messages",
        {
          validationSummary: {
            status: "warning",
            messages: Array.from({ length: 201 }, (_, index) => ({
              code: `warning-${index}`,
              severity: "warning",
              message: "Review this field."
            }))
          }
        }
      ],
      ["non-array references", { references: "Counterparty" }]
    ] as const;

    for (const [caseName, overrides] of invalidPayloads) {
      const service = new DraftsService(repository().repository);
      const payload =
        overrides === null
          ? (overrides as unknown as CreateDraftRequest)
          : ({ ...request(), ...overrides } as unknown as CreateDraftRequest);

      await expect(service.createDraft(payload), caseName).rejects.toBeInstanceOf(HttpException);
    }
  });

  it("redacts unsafe correlation ids from early validation errors", async () => {
    const service = new DraftsService(repository().repository);

    await expect(
      service.createDraft({
        ...request(),
        payloadVersion: 2,
        correlationId: "token=secret"
      } as unknown as CreateDraftRequest)
    ).rejects.toMatchObject({
      response: expect.not.objectContaining({ correlationId: expect.any(String) })
    });
  });

  it("rejects secret-like nested keys before persistence", async () => {
    const fakeRepository = repository();
    const service = new DraftsService(fakeRepository.repository);

    await expect(
      service.createDraft(
        request({
          fields: [{ name: "Comment", value: { apiKey: "do-not-store" } }]
        })
      )
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "secretMaterialRejected" })
    });
    expect(fakeRepository.createDraftAndAudit).not.toHaveBeenCalled();
  });

  it("does not echo secret-like duplicate names in error fields", async () => {
    const service = new DraftsService(repository().repository);

    await expect(
      service.createDraft(
        request({
          fields: [
            { name: "token=secret", value: "one" },
            { name: "token=secret", value: "two" }
          ]
        })
      )
    ).rejects.toMatchObject({
      response: expect.not.objectContaining({ field: expect.stringContaining("secret") })
    });
  });
});
