import { describe, expect, it } from "vitest";
import {
  AGENT_COMMAND_PAYLOAD_VERSION,
  type AgentCommandEnvelope,
  type AgentCommandError,
  type AgentCommandResult,
  type CreateAgentCommandRequest,
  type CreateAgentCommandResponse
} from "./index";

describe("agent command contracts", () => {
  it("accepts command creation, envelope, result, and response shapes", () => {
    const request = {
      payloadVersion: AGENT_COMMAND_PAYLOAD_VERSION,
      tenantId: "tenant-1",
      agentId: "agent-1",
      commandId: "command-1",
      draftId: "draft-1",
      metadataSnapshotId: "metadata-1",
      commandType: "CreateDraftIn1C",
      commandPayloadVersion: 1,
      payload: {
        draftId: "draft-1",
        writePackageId: "write-package-1"
      },
      idempotencyKey: "command-draft-1",
      deadlineAt: "2026-06-01T12:30:00.000Z",
      maxRetries: 3,
      correlationId: "corr-1",
      createdByUserId: "user-1"
    } satisfies CreateAgentCommandRequest;

    const result = {
      commandId: request.commandId,
      tenantId: request.tenantId,
      agentId: request.agentId,
      status: "succeeded",
      startedAt: "2026-06-01T12:00:01.000Z",
      finishedAt: "2026-06-01T12:00:02.000Z",
      selectedStrategy: "local-json-export",
      externalReference: "1c-draft-1",
      normalizedErrors: [],
      retryable: false,
      correlationId: request.correlationId
    } satisfies AgentCommandResult;

    const envelope = {
      commandId: request.commandId,
      tenantId: request.tenantId,
      agentId: request.agentId,
      commandType: request.commandType,
      payloadVersion: request.commandPayloadVersion,
      payload: request.payload,
      draftId: request.draftId,
      metadataSnapshotId: request.metadataSnapshotId,
      idempotencyKey: request.idempotencyKey,
      status: "succeeded",
      retries: 0,
      maxRetries: 3,
      deadlineAt: request.deadlineAt,
      result,
      correlationId: request.correlationId,
      createdAt: "2026-06-01T12:00:00.000Z",
      updatedAt: "2026-06-01T12:00:02.000Z"
    } satisfies AgentCommandEnvelope;

    const response = {
      ...envelope,
      idempotencyReplay: false
    } satisfies CreateAgentCommandResponse;

    expect(response.commandId).toBe("command-1");
    expect(response.draftId).toBe("draft-1");
    expect(response.metadataSnapshotId).toBe("metadata-1");
    expect(response.idempotencyKey).toBe("command-draft-1");
    expect(response.result?.status).toBe("succeeded");
  });

  it("accepts normalized command errors", () => {
    const error = {
      code: "idempotencyConflict",
      message: "An agent command already exists for this idempotency key with a different payload.",
      retryable: false,
      remediation: "Retry with the original payload or use a new idempotency key.",
      correlationId: "corr-1"
    } satisfies AgentCommandError;

    expect(error.code).toBe("idempotencyConflict");
  });
});
