import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex
} from "drizzle-orm/pg-core";
import type {
  AgentCommandResult,
  AgentCommandStatus,
  AgentCommandType,
  AgentRunState,
  DocumentExceptionCategory,
  DocumentExceptionPriority,
  DocumentExceptionQueueName,
  DocumentExceptionSignal,
  DocumentExceptionSignalCode,
  DocumentExceptionStage,
  DocumentExceptionStatus,
  DraftConfidence,
  DraftField,
  DraftLifecycleStatus,
  DraftApprovalStatus,
  DraftReference,
  DraftValidationSummary,
  DraftWriteStatus,
  IntegrationPath
} from "@automator/contracts";

export type AuthUserRole = "accountant" | "admin";
export type AuthUserStatus = "active" | "disabled";
export type NativeAuthRequestStatus = "pending" | "completed" | "consumed" | "expired";

export const drafts = pgTable(
  "drafts",
  {
    draftId: text("draft_id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    documentId: text("document_id").notNull(),
    metadataSnapshotId: text("metadata_snapshot_id").notNull(),
    schemaHash: text("schema_hash").notNull(),
    documentType: text("document_type").notNull(),
    targetResourceName: text("target_resource_name").notNull(),
    lifecycleStatus: text("lifecycle_status").$type<DraftLifecycleStatus>().notNull(),
    approvalStatus: text("approval_status").$type<DraftApprovalStatus>().notNull(),
    writeStatus: text("write_status").$type<DraftWriteStatus>().notNull(),
    requiresAccountantApproval: boolean("requires_accountant_approval").notNull(),
    fields: jsonb("fields").$type<DraftField[]>().notNull(),
    references: jsonb("draft_references").$type<DraftReference[]>().notNull(),
    confidence: jsonb("confidence").$type<DraftConfidence>().notNull(),
    validationSummary: jsonb("validation_summary").$type<DraftValidationSummary>().notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    correlationId: text("correlation_id").notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
  },
  (table) => [uniqueIndex("drafts_tenant_idempotency_key_idx").on(table.tenantId, table.idempotencyKey)]
);

export const auditEvents = pgTable("audit_events", {
  auditEventId: text("audit_event_id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  actorType: text("actor_type").notNull(),
  actorId: text("actor_id").notNull(),
  eventType: text("event_type").notNull(),
  subjectType: text("subject_type").notNull(),
  subjectId: text("subject_id").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  correlationId: text("correlation_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
});

export const users = pgTable(
  "users",
  {
    userId: text("user_id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    role: text("role").$type<AuthUserRole>().notNull().default("accountant"),
    status: text("status").$type<AuthUserStatus>().notNull().default("active"),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
  },
  (table) => [
    uniqueIndex("users_email_idx").on(table.email),
    index("users_tenant_idx").on(table.tenantId)
  ]
);

export const nativeAuthRequests = pgTable(
  "native_auth_requests",
  {
    authRequestId: text("auth_request_id").primaryKey(),
    stateHash: text("state_hash").notNull(),
    pollTokenHash: text("poll_token_hash").notNull(),
    status: text("status").$type<NativeAuthRequestStatus>().notNull().default("pending"),
    userId: text("user_id"),
    tenantId: text("tenant_id"),
    sessionCodeHash: text("session_code_hash"),
    deviceLabel: text("device_label"),
    correlationId: text("correlation_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
  },
  (table) => [
    index("native_auth_requests_status_expires_idx").on(table.status, table.expiresAt),
    index("native_auth_requests_correlation_idx").on(table.correlationId)
  ]
);

export const authSessions = pgTable(
  "auth_sessions",
  {
    sessionId: text("session_id").primaryKey(),
    userId: text("user_id").notNull(),
    tenantId: text("tenant_id").notNull(),
    accessTokenHash: text("access_token_hash").notNull(),
    userAgent: text("user_agent"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
  },
  (table) => [
    index("auth_sessions_user_idx").on(table.userId, table.expiresAt),
    index("auth_sessions_tenant_idx").on(table.tenantId, table.expiresAt)
  ]
);

export const documentExceptions = pgTable(
  "document_exceptions",
  {
    exceptionId: text("exception_id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    documentId: text("document_id").notNull(),
    draftId: text("draft_id"),
    metadataSnapshotId: text("metadata_snapshot_id"),
    schemaHash: text("schema_hash"),
    stage: text("stage").$type<DocumentExceptionStage>().notNull(),
    category: text("category").$type<DocumentExceptionCategory>().notNull(),
    queueName: text("queue_name").$type<DocumentExceptionQueueName>().notNull(),
    priority: text("priority").$type<DocumentExceptionPriority>().notNull(),
    status: text("status").$type<DocumentExceptionStatus>().notNull(),
    requiresAccountantReview: boolean("requires_accountant_review").notNull(),
    requiresAdminReview: boolean("requires_admin_review").notNull(),
    signals: jsonb("signals").$type<DocumentExceptionSignal[]>().notNull(),
    topSignalCode: text("top_signal_code").$type<DocumentExceptionSignalCode>().notNull(),
    suggestedActions: jsonb("suggested_actions").$type<string[]>().notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    correlationId: text("correlation_id").notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
  },
  (table) => [
    uniqueIndex("document_exceptions_tenant_idempotency_key_idx").on(
      table.tenantId,
      table.idempotencyKey
    )
  ]
);

export const agentCommands = pgTable(
  "agent_commands",
  {
    commandId: text("command_id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    agentId: text("agent_id").notNull(),
    draftId: text("draft_id"),
    metadataSnapshotId: text("metadata_snapshot_id"),
    commandType: text("command_type").$type<AgentCommandType>().notNull(),
    payloadVersion: integer("payload_version").notNull().default(1),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").$type<AgentCommandStatus>().notNull().default("queued"),
    retries: integer("retries").notNull().default(0),
    maxRetries: integer("max_retries").notNull().default(3),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }).notNull(),
    lastError: text("last_error"),
    result: jsonb("result").$type<AgentCommandResult>(),
    requestHash: text("request_hash").notNull(),
    correlationId: text("correlation_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
  },
  (table) => [
    uniqueIndex("agent_commands_tenant_idempotency_idx").on(table.tenantId, table.idempotencyKey),
    index("agent_commands_tenant_agent_status_idx").on(table.tenantId, table.agentId, table.status)
  ]
);

export const agentHeartbeats = pgTable(
  "agent_heartbeats",
  {
    agentId: text("agent_id").notNull(),
    tenantId: text("tenant_id").notNull(),
    runState: text("run_state").$type<AgentRunState>().notNull().default("ready"),
    capabilities: jsonb("capabilities").$type<IntegrationPath[]>().notNull().default([]),
    schemaSnapshotId: text("schema_snapshot_id"),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
  },
  (table) => [
    primaryKey({ columns: [table.agentId, table.tenantId] }),
    index("agent_heartbeats_tenant_idx").on(table.tenantId, table.observedAt)
  ]
);
