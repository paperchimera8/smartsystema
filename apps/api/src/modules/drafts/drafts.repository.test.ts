import { describe, expect, it } from "vitest";
import type { DraftConfidence, DraftField, DraftReference, DraftValidationSummary } from "@automator/contracts";
import { DATABASE } from "../database/database.constants";
import type { AutomatorDatabase } from "../database/database.types";
import { auditEvents, drafts } from "../database/schema";
import {
  buildDraftInsert,
  buildDraftCreatedAuditEvent,
  DraftsRepository,
  isUniqueConstraintViolation,
  mapDraftRowToResponse,
  type DraftRow,
  type PersistDraftInput
} from "./drafts.repository";

const createdAt = new Date("2026-05-28T00:00:00.000Z");

function persistInput(): PersistDraftInput {
  const fields: DraftField[] = [{ name: "Date", value: "2026-05-28" }];
  const references: DraftReference[] = [{ name: "Counterparty", fieldName: "Counterparty_Key" }];
  const confidence: DraftConfidence = {
    score: 0.94,
    reasons: ["High-confidence mapping."],
    requiresReview: true
  };
  const validationSummary: DraftValidationSummary = {
    status: "warning",
    messages: [
      {
        code: "manual-review-required",
        severity: "warning",
        message: "Accountant review is required before write planning."
      }
    ]
  };

  return {
    draftId: "draft-1",
    tenantId: "tenant-1",
    documentId: "document-1",
    metadataSnapshotId: "metadata-1",
    schemaHash: "schema-hash-1",
    documentType: "purchase-invoice",
    targetResourceName: "Document_PurchaseInvoice",
    fields,
    references,
    confidence,
    validationSummary,
    idempotencyKey: "draft-create-1",
    requestHash: "request-hash-1",
    correlationId: "corr-1",
    createdByUserId: "user-1",
    createdAt
  };
}

function draftRow(input = persistInput()): DraftRow {
  return {
    ...input,
    lifecycleStatus: "needs_review",
    approvalStatus: "pending",
    writeStatus: "not_requested",
    requiresAccountantApproval: true,
    updatedAt: input.createdAt
  };
}

function fakeDatabase(options: { failAudit?: boolean } = {}): {
  database: AutomatorDatabase;
  insertedDrafts: unknown[];
  insertedAuditEvents: unknown[];
  committed: boolean;
} {
  const insertedDrafts: unknown[] = [];
  const insertedAuditEvents: unknown[] = [];
  const state = { committed: false };
  const transaction = {
    insert: (table: unknown) => ({
      values: (payload: unknown) => {
        if (table === drafts) {
          insertedDrafts.push(payload);
          return {
            returning: async () => [draftRow()]
          };
        }

        if (table === auditEvents) {
          insertedAuditEvents.push(payload);

          if (options.failAudit === true) {
            return Promise.reject(new Error("audit insert failed"));
          }

          return Promise.resolve();
        }

        return Promise.reject(new Error("unexpected table"));
      }
    })
  };

  return {
    insertedDrafts,
    insertedAuditEvents,
    get committed() {
      return state.committed;
    },
    database: {
      transaction: async (callback: (tx: typeof transaction) => Promise<unknown>) => {
        try {
          const result = await callback(transaction);
          state.committed = true;
          return result;
        } catch (error) {
          state.committed = false;
          throw error;
        }
      }
    } as unknown as AutomatorDatabase
  };
}

describe("DraftsRepository", () => {
  it("maps draft rows to non-writeable creation responses", () => {
    const response = mapDraftRowToResponse(draftRow(), false);

    expect(response).toMatchObject({
      draftId: "draft-1",
      lifecycleStatus: "needs_review",
      approvalStatus: "pending",
      writeStatus: "not_requested",
      requiresAccountantApproval: true,
      idempotencyReplay: false
    });
  });

  it("builds redacted draft-created audit events", () => {
    const event = buildDraftCreatedAuditEvent({
      ...persistInput(),
      fields: [{ name: "Comment", value: "password=secret" }]
    });
    const serialized = JSON.stringify(event);

    expect(event.eventType).toBe("draft.created");
    expect(serialized).not.toContain("password=secret");
    expect(serialized).not.toContain("fields");
    expect(serialized).not.toContain("references");
    expect(serialized).toContain("fieldCount");
  });

  it("forces draft insert rows into the non-writeable review state", () => {
    const row = buildDraftInsert(persistInput());

    expect(row.lifecycleStatus).toBe("needs_review");
    expect(row.approvalStatus).toBe("pending");
    expect(row.writeStatus).toBe("not_requested");
    expect(row.requiresAccountantApproval).toBe(true);
  });

  it("creates draft and audit event inside one transaction", async () => {
    const fake = fakeDatabase();
    const repository = new DraftsRepository(fake.database);
    const response = await repository.createDraftAndAudit(persistInput());

    expect(response.draftId).toBe("draft-1");
    expect(fake.insertedDrafts).toHaveLength(1);
    expect(fake.insertedAuditEvents).toHaveLength(1);
    expect(fake.committed).toBe(true);
  });

  it("finds a draft by tenant and idempotency key", async () => {
    const database = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [draftRow()]
          })
        })
      })
    } as unknown as AutomatorDatabase;
    const repository = new DraftsRepository(database);

    await expect(repository.findByTenantAndIdempotencyKey("tenant-1", "draft-create-1")).resolves.toMatchObject({
      draftId: "draft-1"
    });
  });

  it("does not commit when audit insertion fails", async () => {
    const fake = fakeDatabase({ failAudit: true });
    const repository = new DraftsRepository(fake.database);

    await expect(repository.createDraftAndAudit(persistInput())).rejects.toThrow(
      "audit insert failed"
    );
    expect(fake.insertedDrafts).toHaveLength(1);
    expect(fake.insertedAuditEvents).toHaveLength(1);
    expect(fake.committed).toBe(false);
  });

  it("detects PostgreSQL unique constraint violations", () => {
    expect(isUniqueConstraintViolation({ code: "23505" })).toBe(true);
    expect(isUniqueConstraintViolation({ code: "08006" })).toBe(false);
  });
});
