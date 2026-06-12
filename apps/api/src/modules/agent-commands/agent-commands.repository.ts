import { Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray, lte } from "drizzle-orm";
import type {
  AgentCommandEnvelope,
  AgentCommandResult,
  AgentCommandStatus,
  AgentCommandType,
  AgentHeartbeatRequest,
  AgentHeartbeatResponse,
  AgentRunState,
  IntegrationPath
} from "@automator/contracts";
import {
  AGENT_COMMAND_ACTIVE_STATUSES,
  AGENT_COMMAND_INITIAL_STATE,
  AGENT_COMMAND_STATE_TRANSITIONS,
  canTransition
} from "@automator/contracts";
import { DATABASE } from "../database/database.constants";
import type { AutomatorDatabase } from "../database/database.types";
import { agentCommands, agentHeartbeats } from "../database/schema";

export type CommandRow = typeof agentCommands.$inferSelect;

@Injectable()
export class AgentCommandsRepository {
  constructor(@Inject(DATABASE) private readonly database: AutomatorDatabase) {}

  async findPendingForAgent(tenantId: string, agentId: string, limit = 10): Promise<CommandRow[]> {
    return this.database
      .select()
      .from(agentCommands)
      .where(
        and(
          eq(agentCommands.tenantId, tenantId),
          eq(agentCommands.agentId, agentId),
          inArray(agentCommands.status, ["queued"] as AgentCommandStatus[])
        )
      )
      .limit(limit)
      .orderBy(agentCommands.createdAt);
  }

  async markDelivered(commandIds: string[], updatedAt: Date): Promise<CommandRow[]> {
    if (commandIds.length === 0) return [];

    // Validates queued → delivered is a legal transition before issuing the UPDATE
    if (!canTransition(AGENT_COMMAND_STATE_TRANSITIONS, "queued", "delivered")) {
      throw new Error("State machine invariant violation: queued → delivered must be legal");
    }

    return this.database
      .update(agentCommands)
      .set({ status: "delivered", updatedAt })
      .where(
        and(
          inArray(agentCommands.commandId, commandIds),
          inArray(agentCommands.status, ["queued"] as AgentCommandStatus[])
        )
      )
      .returning();
  }

  async expireDueCommands(now: Date): Promise<CommandRow[]> {
    return this.database
      .update(agentCommands)
      .set({ status: "expired", updatedAt: now, lastError: "Command deadline expired." })
      .where(
        and(
          inArray(agentCommands.status, [...AGENT_COMMAND_ACTIVE_STATUSES] as AgentCommandStatus[]),
          lte(agentCommands.deadlineAt, now)
        )
      )
      .returning();
  }

  async findById(commandId: string): Promise<CommandRow | undefined> {
    const rows = await this.database
      .select()
      .from(agentCommands)
      .where(eq(agentCommands.commandId, commandId))
      .limit(1);
    return rows[0];
  }

  async findByTenantAndIdempotencyKey(
    tenantId: string,
    idempotencyKey: string
  ): Promise<CommandRow | undefined> {
    const rows = await this.database
      .select()
      .from(agentCommands)
      .where(
        and(
          eq(agentCommands.tenantId, tenantId),
          eq(agentCommands.idempotencyKey, idempotencyKey)
        )
      )
      .limit(1);
    return rows[0];
  }

  async createCommand(input: {
    commandId: string;
    tenantId: string;
    agentId: string;
    commandType: AgentCommandType;
    payload: Record<string, unknown>;
    draftId?: string;
    metadataSnapshotId?: string;
    idempotencyKey: string;
    requestHash: string;
    deadlineAt: Date;
    commandPayloadVersion: number;
    maxRetries: number;
    correlationId: string;
    createdAt: Date;
  }): Promise<CommandRow> {
    const { commandPayloadVersion, ...insertInput } = input;
    const rows = await this.database
      .insert(agentCommands)
      .values({
        ...insertInput,
        payloadVersion: commandPayloadVersion,
        status: AGENT_COMMAND_INITIAL_STATE,
        retries: 0,
        updatedAt: input.createdAt
      })
      .returning();
    return rows[0]!;
  }

  async applyResult(
    commandId: string,
    result: AgentCommandResult,
    currentStatus: AgentCommandStatus,
    updatedAt: Date
  ): Promise<CommandRow | undefined> {
    const finalStatus: AgentCommandStatus =
      result.status === "succeeded"
        ? "succeeded"
        : result.retryable
          ? "failed_retryable"
          : "failed_terminal";

    if (!canTransition(AGENT_COMMAND_STATE_TRANSITIONS, currentStatus, finalStatus)) {
      return undefined;
    }

    const rows = await this.database
      .update(agentCommands)
      .set({
        status: finalStatus,
        result,
        lastError: result.normalizedErrors[0],
        updatedAt
      })
      .where(
        and(
          eq(agentCommands.commandId, commandId),
          inArray(agentCommands.status, [...AGENT_COMMAND_ACTIVE_STATUSES] as AgentCommandStatus[])
        )
      )
      .returning();

    return rows[0];
  }

  async upsertHeartbeat(request: AgentHeartbeatRequest, now: Date): Promise<AgentHeartbeatResponse> {
    await this.database
      .insert(agentHeartbeats)
      .values({
        agentId: request.agentId,
        tenantId: request.tenantId,
        runState: request.runState as AgentRunState,
        capabilities: request.capabilities as IntegrationPath[],
        schemaSnapshotId: request.schemaSnapshotId,
        observedAt: now,
        createdAt: now,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: [agentHeartbeats.agentId, agentHeartbeats.tenantId],
        set: {
          runState: request.runState as AgentRunState,
          capabilities: request.capabilities as IntegrationPath[],
          schemaSnapshotId: request.schemaSnapshotId,
          observedAt: now,
          updatedAt: now
        }
      });

    const pendingRows = await this.database
      .select({ commandId: agentCommands.commandId })
      .from(agentCommands)
      .where(
        and(
          eq(agentCommands.tenantId, request.tenantId),
          eq(agentCommands.agentId, request.agentId),
          inArray(agentCommands.status, ["queued"] as AgentCommandStatus[])
        )
      );

    return {
      agentId: request.agentId,
      tenantId: request.tenantId,
      acknowledgedAt: now.toISOString(),
      pendingCommandCount: pendingRows.length
    };
  }
}

export function mapCommandRowToEnvelope(row: CommandRow): AgentCommandEnvelope {
  return {
    commandId: row.commandId,
    tenantId: row.tenantId,
    agentId: row.agentId,
    commandType: row.commandType as AgentCommandType,
    payloadVersion: row.payloadVersion,
    payload: (row.payload as Record<string, unknown>) ?? {},
    ...(row.draftId ? { draftId: row.draftId } : {}),
    ...(row.metadataSnapshotId ? { metadataSnapshotId: row.metadataSnapshotId } : {}),
    idempotencyKey: row.idempotencyKey,
    status: row.status as AgentCommandStatus,
    retries: row.retries,
    maxRetries: row.maxRetries,
    deadlineAt: row.deadlineAt.toISOString(),
    ...(row.lastError ? { lastError: row.lastError } : {}),
    ...(row.result ? { result: row.result as AgentCommandResult } : {}),
    correlationId: row.correlationId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}
