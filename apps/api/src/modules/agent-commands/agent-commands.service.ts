import { Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type {
  AgentCommandEnvelope,
  AgentCommandResult,
  AgentCommandStatus,
  AgentCommandType,
  AgentHeartbeatRequest,
  AgentHeartbeatResponse,
  CreateAgentCommandRequest,
  CreateAgentCommandResponse
} from "@automator/contracts";
import {
  AGENT_COMMAND_PAYLOAD_VERSION,
  AGENT_COMMAND_STATE_TRANSITIONS,
  AGENT_COMMAND_TYPES,
  canTransition
} from "@automator/contracts";
import { commandBadRequest, commandConflict, commandNotFound } from "./agent-commands.errors";
import {
  AgentCommandsRepository,
  mapCommandRowToEnvelope
} from "./agent-commands.repository";
import type { SubmitCommandResultDto } from "./dto/submit-command-result.dto";

const MAX_IDENTIFIER_LENGTH = 240;
const MAX_JSON_DEPTH = 12;
const MAX_JSON_ARRAY_LENGTH = 500;
const MAX_JSON_OBJECT_KEYS = 500;
const MAX_JSON_OBJECT_KEY_LENGTH = 160;
const MAX_JSON_STRING_LENGTH = 4_000;
const MAX_RETRIES = 10;
const SECRET_MARKERS = [
  "password",
  "passwd",
  "pwd",
  "token",
  "secret",
  "authorization",
  "bearer",
  "api_key",
  "apikey",
  "connectionstring",
  "connection_string",
  "credential"
];

type NormalizedAgentCommandCreation = {
  commandId: string;
  tenantId: string;
  agentId: string;
  commandType: AgentCommandType;
  commandPayloadVersion: number;
  payload: Record<string, unknown>;
  draftId?: string;
  metadataSnapshotId?: string;
  idempotencyKey: string;
  deadlineAt: Date;
  maxRetries: number;
  correlationId: string;
  createdByUserId: string;
};

@Injectable()
export class AgentCommandsService {
  constructor(private readonly repository: AgentCommandsRepository) {}

  async createCommand(request: CreateAgentCommandRequest): Promise<CreateAgentCommandResponse> {
    const normalized = normalizeCreateAgentCommandRequest(request);
    const requestHash = hashAgentCommandRequest(normalized);
    const existing = await this.repository.findByTenantAndIdempotencyKey(
      normalized.tenantId,
      normalized.idempotencyKey
    );

    if (existing !== undefined) {
      if (existing.requestHash !== requestHash) {
        throw commandConflict({
          code: "idempotencyConflict",
          message: "An agent command already exists for this idempotency key with a different payload.",
          retryable: false,
          remediation: "Retry with the original payload or use a new idempotency key.",
          correlationId: normalized.correlationId
        });
      }

      return {
        ...mapCommandRowToEnvelope(existing),
        idempotencyReplay: true
      };
    }

    const row = await this.repository.createCommand({
      commandId: normalized.commandId,
      tenantId: normalized.tenantId,
      agentId: normalized.agentId,
      commandType: normalized.commandType,
      commandPayloadVersion: normalized.commandPayloadVersion,
      payload: normalized.payload,
      ...(normalized.draftId ? { draftId: normalized.draftId } : {}),
      ...(normalized.metadataSnapshotId
        ? { metadataSnapshotId: normalized.metadataSnapshotId }
        : {}),
      idempotencyKey: normalized.idempotencyKey,
      requestHash,
      deadlineAt: normalized.deadlineAt,
      maxRetries: normalized.maxRetries,
      correlationId: normalized.correlationId,
      createdAt: new Date()
    });

    return {
      ...mapCommandRowToEnvelope(row),
      idempotencyReplay: false
    };
  }

  async getPendingCommands(
    tenantId: string,
    agentId: string,
    limit: number
  ): Promise<AgentCommandEnvelope[]> {
    const now = new Date();
    await this.repository.expireDueCommands(now);
    const rows = await this.repository.findPendingForAgent(tenantId, agentId, limit);
    const deliveredRows = await this.repository.markDelivered(rows.map((r) => r.commandId), now);
    const deliveredById = new Map(deliveredRows.map((row) => [row.commandId, row]));

    return rows.map((row) =>
      mapCommandRowToEnvelope(
        deliveredById.get(row.commandId) ?? {
          ...row,
          status: "delivered",
          updatedAt: now
        }
      )
    );
  }

  async submitResult(
    commandId: string,
    dto: SubmitCommandResultDto
  ): Promise<AgentCommandEnvelope> {
    const existing = await this.repository.findById(commandId);

    if (!existing) {
      throw commandNotFound(commandId, dto.correlationId);
    }

    if (existing.tenantId !== dto.tenantId || existing.agentId !== dto.agentId) {
      throw commandBadRequest({
        code: "commandOwnershipMismatch",
        message: "Command tenant or agent identity does not match the submitted result.",
        retryable: false,
        remediation: "Verify tenantId and agentId match the original command.",
        correlationId: dto.correlationId
      });
    }

    const currentStatus = existing.status as AgentCommandStatus;
    const targetStatus: AgentCommandStatus =
      dto.status === "succeeded"
        ? "succeeded"
        : dto.retryable
          ? "failed_retryable"
          : "failed_terminal";

    if (!canTransition(AGENT_COMMAND_STATE_TRANSITIONS, currentStatus, targetStatus)) {
      throw commandBadRequest({
        code: "invalidStateTransition",
        message: `Cannot transition agent command from '${currentStatus}' to '${targetStatus}'.`,
        retryable: false,
        remediation: `Current status '${currentStatus}' does not allow transition to '${targetStatus}'. Allowed targets: ${(AGENT_COMMAND_STATE_TRANSITIONS[currentStatus] as readonly string[]).join(", ") || "none"}.`,
        correlationId: dto.correlationId
      });
    }

    const result: AgentCommandResult = {
      commandId: dto.commandId,
      tenantId: dto.tenantId,
      agentId: dto.agentId,
      status: dto.status,
      startedAt: dto.startedAt,
      finishedAt: dto.finishedAt,
      normalizedErrors: dto.normalizedErrors,
      retryable: dto.retryable,
      correlationId: dto.correlationId,
      ...(dto.selectedStrategy ? { selectedStrategy: dto.selectedStrategy } : {}),
      ...(dto.externalReference ? { externalReference: dto.externalReference } : {}),
      ...(dto.diagnosticRef ? { diagnosticRef: dto.diagnosticRef } : {})
    };

    const updated = await this.repository.applyResult(commandId, result, currentStatus, new Date());

    if (!updated) {
      throw commandBadRequest({
        code: "commandNotActive",
        message: "Command is not in an active state and cannot accept a result.",
        retryable: false,
        remediation: "Only queued, delivered, accepted, or running commands can receive results.",
        correlationId: dto.correlationId
      });
    }

    return mapCommandRowToEnvelope(updated);
  }

  async recordHeartbeat(request: AgentHeartbeatRequest): Promise<AgentHeartbeatResponse> {
    return this.repository.upsertHeartbeat(request, new Date());
  }
}

export function normalizeCreateAgentCommandRequest(
  request: CreateAgentCommandRequest
): NormalizedAgentCommandCreation {
  assertPlainObject(request, "request", undefined);
  const correlationId = optionalTrimmed(request.correlationId, "correlationId", undefined);

  if (request.payloadVersion !== AGENT_COMMAND_PAYLOAD_VERSION) {
    throw commandBadRequest({
      code: "invalidPayloadVersion",
      message: "Unsupported agent command creation payload version.",
      retryable: false,
      remediation: "Use payloadVersion 1.",
      correlationId
    });
  }

  const commandType = requireCommandType(request.commandType, correlationId);
  const payload = normalizeJsonObject(request.payload, "payload", correlationId);
  assertNoSecretLikeMaterial(payload, "payload", correlationId);

  const deadlineAt = parseFutureDate(request.deadlineAt, "deadlineAt", correlationId);
  const maxRetries =
    request.maxRetries === undefined
      ? 3
      : requireIntegerInRange(request.maxRetries, "maxRetries", 0, MAX_RETRIES, correlationId);

  return {
    commandId:
      optionalTrimmed(request.commandId, "commandId", correlationId) ?? `command_${randomUUID()}`,
    tenantId: requireTrimmed(request.tenantId, "tenantId", correlationId),
    agentId: requireTrimmed(request.agentId, "agentId", correlationId),
    commandType,
    commandPayloadVersion: requireIntegerInRange(
      request.commandPayloadVersion,
      "commandPayloadVersion",
      1,
      20,
      correlationId
    ),
    payload,
    ...optionalField("draftId", request.draftId, correlationId),
    ...optionalField("metadataSnapshotId", request.metadataSnapshotId, correlationId),
    idempotencyKey: requireTrimmed(request.idempotencyKey, "idempotencyKey", correlationId),
    deadlineAt,
    maxRetries,
    correlationId: requireTrimmed(request.correlationId, "correlationId", correlationId),
    createdByUserId: requireTrimmed(request.createdByUserId, "createdByUserId", correlationId)
  };
}

export function hashAgentCommandRequest(request: NormalizedAgentCommandCreation): string {
  return createHash("sha256")
    .update(
      stableStringify({
        ...request,
        deadlineAt: request.deadlineAt.toISOString()
      })
    )
    .digest("hex");
}

function requireCommandType(value: unknown, correlationId: string | undefined): AgentCommandType {
  if (typeof value !== "string" || !(AGENT_COMMAND_TYPES as readonly string[]).includes(value)) {
    throw commandBadRequest({
      code: "invalidCommandInput",
      message: "Agent command type is not supported.",
      retryable: false,
      remediation: "Use one of the supported Agent Command Bus command types.",
      field: "commandType",
      correlationId
    });
  }

  return value as AgentCommandType;
}

function parseFutureDate(value: unknown, field: string, correlationId: string | undefined): Date {
  const raw = requireTrimmed(value, field, correlationId);
  const parsed = new Date(raw);

  if (Number.isNaN(parsed.getTime())) {
    throw commandBadRequest({
      code: "invalidCommandInput",
      message: "Command deadline must be a valid date.",
      retryable: false,
      remediation: "Use an ISO 8601 deadlineAt value.",
      field,
      correlationId
    });
  }

  if (parsed.getTime() <= Date.now()) {
    throw commandBadRequest({
      code: "invalidCommandInput",
      message: "Command deadline must be in the future.",
      retryable: false,
      remediation: "Use a future deadlineAt value.",
      field,
      correlationId
    });
  }

  return parsed;
}

function requireIntegerInRange(
  value: unknown,
  field: string,
  min: number,
  max: number,
  correlationId: string | undefined
): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw commandBadRequest({
      code: "invalidCommandInput",
      message: "Agent command numeric option is outside the allowed range.",
      retryable: false,
      remediation: `Use an integer between ${min} and ${max}.`,
      field,
      correlationId
    });
  }

  return value as number;
}

function normalizeJsonObject(
  value: unknown,
  field: string,
  correlationId: string | undefined
): Record<string, unknown> {
  const record = assertPlainObject(value, field, correlationId);

  return normalizeJsonValue(record, field, correlationId) as Record<string, unknown>;
}

function normalizeJsonValue(
  value: unknown,
  field: string,
  correlationId: string | undefined,
  depth = 0
): unknown {
  if (depth > MAX_JSON_DEPTH) {
    throw invalidPayload(field, "Agent command payload is too deeply nested.", correlationId);
  }

  if (value === null || typeof value === "boolean" || typeof value === "number") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw invalidPayload(field, "Agent command payload contains a non-finite number.", correlationId);
    }

    return value;
  }

  if (typeof value === "string") {
    if (value.length > MAX_JSON_STRING_LENGTH) {
      throw invalidPayload(field, "Agent command payload string is too large.", correlationId);
    }

    return value;
  }

  if (Array.isArray(value)) {
    if (value.length > MAX_JSON_ARRAY_LENGTH) {
      throw invalidPayload(field, "Agent command payload array is too large.", correlationId);
    }

    return value.map((item, index) =>
      normalizeJsonValue(item, `${field}.${index}`, correlationId, depth + 1)
    );
  }

  const record = assertPlainObject(value, field, correlationId);
  const entries = Object.entries(record);

  if (entries.length > MAX_JSON_OBJECT_KEYS) {
    throw invalidPayload(field, "Agent command payload object has too many keys.", correlationId);
  }

  const normalizedEntries = entries.map(([key, child]): [string, unknown] => {
    if (key.length > MAX_JSON_OBJECT_KEY_LENGTH) {
      throw invalidPayload(field, "Agent command payload object key is too long.", correlationId);
    }

    if (child === undefined) {
      throw invalidPayload(
        `${field}.${key}`,
        "Agent command payload cannot contain undefined.",
        correlationId
      );
    }

    return [key, normalizeJsonValue(child, `${field}.${key}`, correlationId, depth + 1)];
  });

  return Object.fromEntries(
    normalizedEntries.sort(([left], [right]) => left.localeCompare(right, "en"))
  );
}

function assertPlainObject(
  value: unknown,
  field: string,
  correlationId: string | undefined
): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw invalidPayload(field, "Agent command payload must be a plain object.", correlationId);
  }

  return value as Record<string, unknown>;
}

function requireTrimmed(
  value: unknown,
  field: string,
  correlationId: string | undefined
): string {
  const trimmed = optionalTrimmed(value, field, correlationId);

  if (trimmed === undefined) {
    throw invalidPayload(field, "Required agent command field is missing.", correlationId);
  }

  return trimmed;
}

function optionalTrimmed(
  value: unknown,
  field: string,
  correlationId: string | undefined
): string | undefined {
  if (value === undefined) return undefined;

  if (typeof value !== "string") {
    throw invalidPayload(field, "Agent command field must be a string.", correlationId);
  }

  const trimmed = value.trim();

  if (!trimmed) {
    throw invalidPayload(field, "Agent command field cannot be empty.", correlationId);
  }

  if (trimmed.length > MAX_IDENTIFIER_LENGTH) {
    throw invalidPayload(field, "Agent command field is too long.", correlationId);
  }

  return trimmed;
}

function optionalField(
  field: "draftId" | "metadataSnapshotId",
  value: unknown,
  correlationId: string | undefined
): Partial<Pick<NormalizedAgentCommandCreation, typeof field>> {
  const normalized = optionalTrimmed(value, field, correlationId);
  return normalized === undefined ? {} : { [field]: normalized };
}

function assertNoSecretLikeMaterial(
  value: unknown,
  field: string,
  correlationId: string | undefined
): void {
  const serialized = JSON.stringify(value).toLowerCase();

  if (SECRET_MARKERS.some((marker) => serialized.includes(marker))) {
    throw commandBadRequest({
      code: "secretMaterialRejected",
      message: "Agent command payload must not contain secrets, tokens, credentials, or connection strings.",
      retryable: false,
      remediation: "Store credentials in the secure agent credential store and reference them by id.",
      field,
      correlationId
    });
  }
}

function invalidPayload(
  field: string,
  message: string,
  correlationId: string | undefined
) {
  return commandBadRequest({
    code: "invalidCommandInput",
    message,
    retryable: false,
    remediation: "Provide a valid Agent Command Bus payload.",
    field,
    correlationId
  });
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value === null || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([key, child]) => [key, sortJson(child)])
  );
}
