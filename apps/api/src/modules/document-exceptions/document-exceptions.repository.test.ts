import { describe, expect, it } from "vitest";
import type { DocumentExceptionSignal } from "@automator/contracts";
import type { AutomatorDatabase } from "../database/database.types";
import { auditEvents, documentExceptions } from "../database/schema";
import {
  buildDocumentExceptionInsert,
  buildDocumentExceptionQueuedAuditEvent,
  DocumentExceptionsRepository,
  isUniqueConstraintViolation,
  mapDocumentExceptionRowToResponse,
  type DocumentExceptionRow,
  type PersistDocumentExceptionInput
} from "./document-exceptions.repository";

const createdAt = new Date("2026-05-31T00:00:00.000Z");

function signals(): DocumentExceptionSignal[] {
  return [
    {
      code: "nomenclature_ambiguous",
      severity: "warning",
      message: "Two nomenclature candidates require accountant review.",
      lineId: "line-1",
      entityKind: "nomenclature",
      score: 0.72,
      candidateCount: 2
    }
  ];
}

function persistInput(): PersistDocumentExceptionInput {
  return {
    exceptionId: "exception-1",
    tenantId: "tenant-1",
    documentId: "document-1",
    draftId: "draft-1",
    metadataSnapshotId: "metadata-1",
    schemaHash: "schema-hash-1",
    stage: "entity_resolution",
    category: "nomenclature_issue",
    queueName: "accountant_review",
    priority: "normal",
    requiresAccountantReview: true,
    requiresAdminReview: false,
    signals: signals(),
    topSignalCode: "nomenclature_ambiguous",
    suggestedActions: ["Confirm the nomenclature candidate or choose another catalog item."],
    idempotencyKey: "exception-route-1",
    requestHash: "request-hash-1",
    correlationId: "corr-1",
    createdByUserId: "user-1",
    createdAt
  };
}

function exceptionRow(input = persistInput()): DocumentExceptionRow {
  return {
    ...input,
    status: "open",
    draftId: input.draftId ?? null,
    metadataSnapshotId: input.metadataSnapshotId ?? null,
    schemaHash: input.schemaHash ?? null,
    updatedAt: input.createdAt
  };
}

function fakeDatabase(options: { failAudit?: boolean } = {}): {
  database: AutomatorDatabase;
  insertedExceptions: unknown[];
  insertedAuditEvents: unknown[];
  committed: boolean;
} {
  const insertedExceptions: unknown[] = [];
  const insertedAuditEvents: unknown[] = [];
  const state = { committed: false };
  const transaction = {
    insert: (table: unknown) => ({
      values: (payload: unknown) => {
        if (table === documentExceptions) {
          insertedExceptions.push(payload);
          return {
            returning: async () => [exceptionRow()]
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
    insertedExceptions,
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

describe("DocumentExceptionsRepository", () => {
  it("maps rows to open exception queue responses", () => {
    const response = mapDocumentExceptionRowToResponse(exceptionRow(), false);

    expect(response).toMatchObject({
      exceptionId: "exception-1",
      category: "nomenclature_issue",
      queueName: "accountant_review",
      status: "open",
      requiresAccountantReview: true,
      idempotencyReplay: false
    });
  });

  it("builds redacted exception audit events", () => {
    const event = buildDocumentExceptionQueuedAuditEvent({
      ...persistInput(),
      signals: [
        {
          code: "low_field_confidence",
          severity: "warning",
          message: "token=secret",
          field: "Comment"
        }
      ]
    });
    const serialized = JSON.stringify(event);

    expect(event.eventType).toBe("document.exception.queued");
    expect(serialized).not.toContain("token=secret");
    expect(serialized).not.toContain("Comment");
    expect(serialized).toContain("signalCount");
  });

  it("forces exception inserts into open queue state", () => {
    const row = buildDocumentExceptionInsert(persistInput());

    expect(row.status).toBe("open");
    expect(row.queueName).toBe("accountant_review");
    expect(row.requiresAccountantReview).toBe(true);
  });

  it("creates exception and audit event inside one transaction", async () => {
    const fake = fakeDatabase();
    const repository = new DocumentExceptionsRepository(fake.database);
    const response = await repository.createExceptionAndAudit(persistInput());

    expect(response.exceptionId).toBe("exception-1");
    expect(fake.insertedExceptions).toHaveLength(1);
    expect(fake.insertedAuditEvents).toHaveLength(1);
    expect(fake.committed).toBe(true);
  });

  it("finds an exception by tenant and idempotency key", async () => {
    const database = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [exceptionRow()]
          })
        })
      })
    } as unknown as AutomatorDatabase;
    const repository = new DocumentExceptionsRepository(database);

    await expect(
      repository.findByTenantAndIdempotencyKey("tenant-1", "exception-create-1")
    ).resolves.toMatchObject({
      exceptionId: "exception-1"
    });
  });

  it("does not commit when audit insertion fails", async () => {
    const fake = fakeDatabase({ failAudit: true });
    const repository = new DocumentExceptionsRepository(fake.database);

    await expect(repository.createExceptionAndAudit(persistInput())).rejects.toThrow(
      "audit insert failed"
    );
    expect(fake.insertedExceptions).toHaveLength(1);
    expect(fake.insertedAuditEvents).toHaveLength(1);
    expect(fake.committed).toBe(false);
  });

  it("detects PostgreSQL unique constraint violations", () => {
    expect(isUniqueConstraintViolation({ code: "23505" })).toBe(true);
    expect(isUniqueConstraintViolation({ code: "08006" })).toBe(false);
  });
});
