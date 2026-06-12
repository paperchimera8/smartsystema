import { Inject, Injectable, InternalServerErrorException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type {
  CreateDocumentExceptionResponse,
  DocumentExceptionCategory,
  DocumentExceptionPriority,
  DocumentExceptionQueueName,
  DocumentExceptionSignal,
  DocumentExceptionSignalCode,
  DocumentExceptionStage
} from "@automator/contracts";
import { EXCEPTION_QUEUE_INITIAL_STATE } from "@automator/contracts";
import { DATABASE } from "../database/database.constants";
import type { AutomatorDatabase } from "../database/database.types";
import { auditEvents, documentExceptions } from "../database/schema";

export type DocumentExceptionRow = typeof documentExceptions.$inferSelect;
type DocumentExceptionInsert = typeof documentExceptions.$inferInsert;
type AuditEventInsert = typeof auditEvents.$inferInsert;

export type PersistDocumentExceptionInput = {
  exceptionId: string;
  tenantId: string;
  documentId: string;
  draftId?: string;
  metadataSnapshotId?: string;
  schemaHash?: string;
  stage: DocumentExceptionStage;
  category: DocumentExceptionCategory;
  queueName: DocumentExceptionQueueName;
  priority: DocumentExceptionPriority;
  requiresAccountantReview: boolean;
  requiresAdminReview: boolean;
  signals: DocumentExceptionSignal[];
  topSignalCode: DocumentExceptionSignalCode;
  suggestedActions: string[];
  idempotencyKey: string;
  requestHash: string;
  correlationId: string;
  createdByUserId: string;
  createdAt: Date;
};

@Injectable()
export class DocumentExceptionsRepository {
  constructor(@Inject(DATABASE) private readonly database: AutomatorDatabase) {}

  async findByTenantAndIdempotencyKey(
    tenantId: string,
    idempotencyKey: string
  ): Promise<DocumentExceptionRow | undefined> {
    const rows = await this.database
      .select()
      .from(documentExceptions)
      .where(
        and(
          eq(documentExceptions.tenantId, tenantId),
          eq(documentExceptions.idempotencyKey, idempotencyKey)
        )
      )
      .limit(1);

    return rows[0];
  }

  async createExceptionAndAudit(
    input: PersistDocumentExceptionInput
  ): Promise<CreateDocumentExceptionResponse> {
    return this.database.transaction(async (transaction) => {
      const insertedExceptions = await transaction
        .insert(documentExceptions)
        .values(buildDocumentExceptionInsert(input))
        .returning();
      const insertedException = insertedExceptions[0];

      if (insertedException === undefined) {
        throw new InternalServerErrorException("Document exception insert did not return a row.");
      }

      await transaction.insert(auditEvents).values(buildDocumentExceptionQueuedAuditEvent(input));

      return mapDocumentExceptionRowToResponse(insertedException, false);
    });
  }
}

export function mapDocumentExceptionRowToResponse(
  row: DocumentExceptionRow,
  idempotencyReplay: boolean
): CreateDocumentExceptionResponse {
  return {
    exceptionId: row.exceptionId,
    tenantId: row.tenantId,
    documentId: row.documentId,
    ...(row.draftId === null ? {} : { draftId: row.draftId }),
    category: row.category,
    queueName: row.queueName,
    priority: row.priority,
    status: EXCEPTION_QUEUE_INITIAL_STATE,
    requiresAccountantReview: row.requiresAccountantReview,
    requiresAdminReview: row.requiresAdminReview,
    signalCount: row.signals.length,
    topSignalCode: row.topSignalCode,
    suggestedActions: row.suggestedActions,
    idempotencyReplay,
    createdAt: row.createdAt.toISOString(),
    correlationId: row.correlationId
  };
}

export function buildDocumentExceptionInsert(
  input: PersistDocumentExceptionInput
): DocumentExceptionInsert {
  return {
    exceptionId: input.exceptionId,
    tenantId: input.tenantId,
    documentId: input.documentId,
    draftId: input.draftId,
    metadataSnapshotId: input.metadataSnapshotId,
    schemaHash: input.schemaHash,
    stage: input.stage,
    category: input.category,
    queueName: input.queueName,
    priority: input.priority,
    status: EXCEPTION_QUEUE_INITIAL_STATE,
    requiresAccountantReview: input.requiresAccountantReview,
    requiresAdminReview: input.requiresAdminReview,
    signals: input.signals,
    topSignalCode: input.topSignalCode,
    suggestedActions: input.suggestedActions,
    idempotencyKey: input.idempotencyKey,
    requestHash: input.requestHash,
    correlationId: input.correlationId,
    createdByUserId: input.createdByUserId,
    createdAt: input.createdAt,
    updatedAt: input.createdAt
  };
}

export function buildDocumentExceptionQueuedAuditEvent(
  input: PersistDocumentExceptionInput
): AuditEventInsert {
  return {
    auditEventId: `audit_${randomUUID()}`,
    tenantId: input.tenantId,
    actorType: "user",
    actorId: input.createdByUserId,
    eventType: "document.exception.queued",
    subjectType: "document",
    subjectId: input.documentId,
    payload: {
      payloadVersion: 1,
      documentId: input.documentId,
      draftId: input.draftId,
      metadataSnapshotId: input.metadataSnapshotId,
      schemaHash: input.schemaHash,
      stage: input.stage,
      category: input.category,
      queueName: input.queueName,
      priority: input.priority,
      status: EXCEPTION_QUEUE_INITIAL_STATE,
      requiresAccountantReview: input.requiresAccountantReview,
      requiresAdminReview: input.requiresAdminReview,
      topSignalCode: input.topSignalCode,
      signalCount: input.signals.length,
      signalCodes: input.signals.map((signal) => signal.code),
      requestHash: input.requestHash
    },
    correlationId: input.correlationId,
    createdAt: input.createdAt
  };
}

export function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}
