import { Inject, Injectable, InternalServerErrorException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type {
  CreateDraftResponse,
  DraftConfidence,
  DraftField,
  DraftReference,
  DraftValidationSummary
} from "@automator/contracts";
import {
  DRAFT_APPROVAL_INITIAL_STATE,
  DRAFT_LIFECYCLE_INITIAL_STATE,
  WRITE_STATUS_INITIAL_STATE
} from "@automator/contracts";
import { DATABASE } from "../database/database.constants";
import type { AutomatorDatabase } from "../database/database.types";
import { auditEvents, drafts } from "../database/schema";

export type DraftRow = typeof drafts.$inferSelect;
type DraftInsert = typeof drafts.$inferInsert;
type AuditEventInsert = typeof auditEvents.$inferInsert;

export type PersistDraftInput = {
  draftId: string;
  tenantId: string;
  documentId: string;
  metadataSnapshotId: string;
  schemaHash: string;
  documentType: string;
  targetResourceName: string;
  fields: DraftField[];
  references: DraftReference[];
  confidence: DraftConfidence;
  validationSummary: DraftValidationSummary;
  idempotencyKey: string;
  requestHash: string;
  correlationId: string;
  createdByUserId: string;
  createdAt: Date;
};

@Injectable()
export class DraftsRepository {
  constructor(@Inject(DATABASE) private readonly database: AutomatorDatabase) {}

  async findByTenantAndIdempotencyKey(
    tenantId: string,
    idempotencyKey: string
  ): Promise<DraftRow | undefined> {
    const rows = await this.database
      .select()
      .from(drafts)
      .where(and(eq(drafts.tenantId, tenantId), eq(drafts.idempotencyKey, idempotencyKey)))
      .limit(1);

    return rows[0];
  }

  async createDraftAndAudit(input: PersistDraftInput): Promise<CreateDraftResponse> {
    return this.database.transaction(async (transaction) => {
      const draftRecord = buildDraftInsert(input);
      const insertedDrafts = await transaction.insert(drafts).values(draftRecord).returning();
      const insertedDraft = insertedDrafts[0];

      if (insertedDraft === undefined) {
        // The DB driver returned no rows after INSERT … RETURNING.
        // This is an invariant violation, not a transient DB failure.
        throw new InternalServerErrorException("Draft insert did not return a row.");
      }

      await transaction.insert(auditEvents).values(buildDraftCreatedAuditEvent(input));

      return mapDraftRowToResponse(insertedDraft, false);
    });
  }
}

export function mapDraftRowToResponse(
  draft: DraftRow,
  idempotencyReplay: boolean
): CreateDraftResponse {
  return {
    draftId: draft.draftId,
    tenantId: draft.tenantId,
    documentId: draft.documentId,
    metadataSnapshotId: draft.metadataSnapshotId,
        lifecycleStatus: DRAFT_LIFECYCLE_INITIAL_STATE,
        approvalStatus: DRAFT_APPROVAL_INITIAL_STATE,
        writeStatus: WRITE_STATUS_INITIAL_STATE,
    requiresAccountantApproval: true,
    idempotencyReplay,
    createdAt: draft.createdAt.toISOString(),
    correlationId: draft.correlationId
  };
}

export function buildDraftCreatedAuditEvent(input: PersistDraftInput): AuditEventInsert {
  return {
    auditEventId: `audit_${randomUUID()}`,
    tenantId: input.tenantId,
    actorType: "user",
    actorId: input.createdByUserId,
    eventType: "draft.created",
    subjectType: "draft",
    subjectId: input.draftId,
    payload: {
      payloadVersion: 1,
      documentId: input.documentId,
      metadataSnapshotId: input.metadataSnapshotId,
      schemaHash: input.schemaHash,
      documentType: input.documentType,
      targetResourceName: input.targetResourceName,
        lifecycleStatus: DRAFT_LIFECYCLE_INITIAL_STATE,
        approvalStatus: DRAFT_APPROVAL_INITIAL_STATE,
        writeStatus: WRITE_STATUS_INITIAL_STATE,
      requiresAccountantApproval: true,
      fieldCount: input.fields.length,
      referenceCount: input.references.length,
      confidenceScore: input.confidence.score,
      validationStatus: input.validationSummary.status,
      requestHash: input.requestHash
    },
    correlationId: input.correlationId,
    createdAt: input.createdAt
  };
}

export function buildDraftInsert(input: PersistDraftInput): DraftInsert {
  return {
    draftId: input.draftId,
    tenantId: input.tenantId,
    documentId: input.documentId,
    metadataSnapshotId: input.metadataSnapshotId,
    schemaHash: input.schemaHash,
    documentType: input.documentType,
    targetResourceName: input.targetResourceName,
        lifecycleStatus: DRAFT_LIFECYCLE_INITIAL_STATE,
        approvalStatus: DRAFT_APPROVAL_INITIAL_STATE,
        writeStatus: WRITE_STATUS_INITIAL_STATE,
    requiresAccountantApproval: true,
    fields: input.fields,
    references: input.references,
    confidence: input.confidence,
    validationSummary: input.validationSummary,
    idempotencyKey: input.idempotencyKey,
    requestHash: input.requestHash,
    correlationId: input.correlationId,
    createdByUserId: input.createdByUserId,
    createdAt: input.createdAt,
    updatedAt: input.createdAt
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
