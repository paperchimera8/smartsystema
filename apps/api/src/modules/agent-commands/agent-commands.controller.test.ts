import { describe, expect, it, vi } from "vitest";
import type {
  AgentCommandEnvelope,
  AgentHeartbeatResponse,
  CreateAgentCommandRequest,
  CreateAgentCommandResponse
} from "@automator/contracts";
import { AGENT_COMMAND_PAYLOAD_VERSION } from "@automator/contracts";
import { AgentCommandsController } from "./agent-commands.controller";
import type { AgentCommandsService } from "./agent-commands.service";

const fixedDeadline = "2099-06-01T12:30:00.000Z";

function createRequest(): CreateAgentCommandRequest {
  return {
    payloadVersion: AGENT_COMMAND_PAYLOAD_VERSION,
    tenantId: "tenant-1",
    agentId: "agent-1",
    commandId: "command-1",
    draftId: "draft-1",
    metadataSnapshotId: "metadata-1",
    commandType: "CreateDraftIn1C",
    commandPayloadVersion: 1,
    payload: { draftId: "draft-1" },
    idempotencyKey: "command-draft-1",
    deadlineAt: fixedDeadline,
    correlationId: "corr-1",
    createdByUserId: "user-1"
  };
}

function envelope(status: AgentCommandEnvelope["status"]): AgentCommandEnvelope {
  return {
    commandId: "command-1",
    tenantId: "tenant-1",
    agentId: "agent-1",
    commandType: "CreateDraftIn1C",
    payloadVersion: 1,
    payload: { draftId: "draft-1" },
    draftId: "draft-1",
    metadataSnapshotId: "metadata-1",
    idempotencyKey: "command-draft-1",
    status,
    retries: 0,
    maxRetries: 3,
    deadlineAt: fixedDeadline,
    correlationId: "corr-1",
    createdAt: "2026-06-01T12:00:00.000Z",
    updatedAt: "2026-06-01T12:00:00.000Z"
  };
}

describe("AgentCommandsController", () => {
  it("delegates command creation to the service", async () => {
    const response: CreateAgentCommandResponse = {
      ...envelope("queued"),
      idempotencyReplay: false
    };
    const service = {
      createCommand: vi.fn(async () => response)
    } as unknown as AgentCommandsService;
    const controller = new AgentCommandsController(service);

    await expect(controller.createCommand(createRequest())).resolves.toBe(response);
    expect(service.createCommand).toHaveBeenCalledWith(createRequest());
  });

  it("delegates pending polling, result submission, and heartbeat", async () => {
    const heartbeat: AgentHeartbeatResponse = {
      agentId: "agent-1",
      tenantId: "tenant-1",
      acknowledgedAt: "2026-06-01T12:00:00.000Z",
      pendingCommandCount: 1
    };
    const service = {
      getPendingCommands: vi.fn(async () => [envelope("delivered")]),
      submitResult: vi.fn(async () => envelope("succeeded")),
      recordHeartbeat: vi.fn(async () => heartbeat)
    } as unknown as AgentCommandsService;
    const controller = new AgentCommandsController(service);

    await expect(
      controller.getPendingCommands({ tenantId: "tenant-1", agentId: "agent-1", limit: "50" })
    ).resolves.toEqual({ commands: [envelope("delivered")] });
    await expect(
      controller.submitCommandResult("command-1", {
        commandId: "command-1",
        tenantId: "tenant-1",
        agentId: "agent-1",
        status: "succeeded",
        startedAt: "2026-06-01T12:00:01.000Z",
        finishedAt: "2026-06-01T12:00:02.000Z",
        normalizedErrors: [],
        retryable: false,
        correlationId: "corr-1"
      })
    ).resolves.toMatchObject({ status: "succeeded" });
    await expect(
      controller.recordHeartbeat({
        agentId: "agent-1",
        tenantId: "tenant-1",
        runState: "ready",
        capabilities: ["odata"]
      })
    ).resolves.toBe(heartbeat);
    expect(service.getPendingCommands).toHaveBeenCalledWith("tenant-1", "agent-1", 20);
  });
});
