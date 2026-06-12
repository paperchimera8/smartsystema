import { HttpException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { CreateAgentCommandRequest } from "@automator/contracts";
import { AGENT_COMMAND_PAYLOAD_VERSION } from "@automator/contracts";
import {
  AgentCommandsService,
  hashAgentCommandRequest,
  normalizeCreateAgentCommandRequest
} from "./agent-commands.service";
import type { AgentCommandsRepository, CommandRow } from "./agent-commands.repository";

const deadlineAt = new Date("2099-06-01T12:30:00.000Z");

function request(overrides: Partial<CreateAgentCommandRequest> = {}): CreateAgentCommandRequest {
  return {
    payloadVersion: AGENT_COMMAND_PAYLOAD_VERSION,
    tenantId: "tenant-1",
    agentId: "agent-1",
    commandId: "command-1",
    draftId: "draft-1",
    metadataSnapshotId: "metadata-1",
    commandType: "CreateDraftIn1C",
    commandPayloadVersion: 1,
    payload: { draftId: "draft-1", packageId: "package-1" },
    idempotencyKey: "command-draft-1",
    deadlineAt: deadlineAt.toISOString(),
    maxRetries: 3,
    correlationId: "corr-1",
    createdByUserId: "user-1",
    ...overrides
  };
}

function commandRow(
  overrides: Partial<CommandRow> = {},
  sourceRequest = request()
): CommandRow {
  const normalized = normalizeCreateAgentCommandRequest(sourceRequest);

  return {
    commandId: normalized.commandId,
    tenantId: normalized.tenantId,
    agentId: normalized.agentId,
    draftId: normalized.draftId ?? null,
    metadataSnapshotId: normalized.metadataSnapshotId ?? null,
    commandType: normalized.commandType,
    payloadVersion: normalized.commandPayloadVersion,
    payload: normalized.payload,
    idempotencyKey: normalized.idempotencyKey,
    status: "queued",
    retries: 0,
    maxRetries: normalized.maxRetries,
    deadlineAt: normalized.deadlineAt,
    lastError: null,
    result: null,
    requestHash: hashAgentCommandRequest(normalized),
    correlationId: normalized.correlationId,
    createdAt: new Date("2026-06-01T12:00:00.000Z"),
    updatedAt: new Date("2026-06-01T12:00:00.000Z"),
    ...overrides
  };
}

function repository(existing?: CommandRow): {
  repository: AgentCommandsRepository;
  createCommand: ReturnType<typeof vi.fn>;
  expireDueCommands: ReturnType<typeof vi.fn>;
  markDelivered: ReturnType<typeof vi.fn>;
} {
  const createCommand = vi.fn(async (input) =>
    commandRow({
      commandId: input.commandId,
      tenantId: input.tenantId,
      agentId: input.agentId,
      draftId: input.draftId ?? null,
      metadataSnapshotId: input.metadataSnapshotId ?? null,
      commandType: input.commandType,
      payloadVersion: input.commandPayloadVersion,
      payload: input.payload,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      deadlineAt: input.deadlineAt,
      maxRetries: input.maxRetries,
      correlationId: input.correlationId,
      createdAt: input.createdAt,
      updatedAt: input.createdAt
    })
  );
  const markDelivered = vi.fn(async (commandIds: string[], updatedAt: Date) =>
    commandIds.map((commandId) =>
      commandRow({
        commandId,
        status: "delivered",
        updatedAt
      })
    )
  );
  const expireDueCommands = vi.fn(async () => []);

  return {
    createCommand,
    markDelivered,
    expireDueCommands,
    repository: {
      findByTenantAndIdempotencyKey: vi.fn(async () => existing),
      createCommand,
      expireDueCommands,
      findPendingForAgent: vi.fn(async () => [commandRow()]),
      markDelivered,
      findById: vi.fn(async () => commandRow({ status: "delivered" })),
      applyResult: vi.fn(async () =>
        commandRow({
          status: "succeeded",
          result: {
            commandId: "command-1",
            tenantId: "tenant-1",
            agentId: "agent-1",
            status: "succeeded",
            startedAt: "2026-06-01T12:00:01.000Z",
            finishedAt: "2026-06-01T12:00:02.000Z",
            normalizedErrors: [],
            retryable: false,
            correlationId: "corr-1"
          }
        })
      ),
      upsertHeartbeat: vi.fn(async () => ({
        agentId: "agent-1",
        tenantId: "tenant-1",
        acknowledgedAt: "2026-06-01T12:00:00.000Z",
        pendingCommandCount: 1
      }))
    } as unknown as AgentCommandsRepository
  };
}

describe("AgentCommandsService", () => {
  it("creates queued commands with draft, metadata, idempotency, retries, and deadline", async () => {
    const fake = repository();
    const service = new AgentCommandsService(fake.repository);
    const result = await service.createCommand(request());
    const persisted = fake.createCommand.mock.calls[0]?.[0];

    expect(result.status).toBe("queued");
    expect(result.draftId).toBe("draft-1");
    expect(result.metadataSnapshotId).toBe("metadata-1");
    expect(result.idempotencyKey).toBe("command-draft-1");
    expect(result.maxRetries).toBe(3);
    expect(persisted.requestHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns existing commands for idempotent replays with the same payload", async () => {
    const existing = commandRow({ commandId: "command-existing" });
    const service = new AgentCommandsService(repository(existing).repository);

    await expect(service.createCommand(request())).resolves.toMatchObject({
      commandId: "command-existing",
      idempotencyReplay: true
    });
  });

  it("rejects idempotency key reuse with a different payload", async () => {
    const existing = commandRow({ requestHash: "different-hash" });
    const service = new AgentCommandsService(repository(existing).repository);

    await expect(service.createCommand(request())).rejects.toMatchObject({
      response: expect.objectContaining({ code: "idempotencyConflict" })
    });
  });

  it("rejects secret-like payload material before persistence", async () => {
    const fake = repository();
    const service = new AgentCommandsService(fake.repository);

    await expect(
      service.createCommand(
        request({
          payload: { token: "secret" }
        })
      )
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "secretMaterialRejected" })
    });
    expect(fake.createCommand).not.toHaveBeenCalled();
  });

  it("expires due commands before polling and returns delivered envelopes", async () => {
    const fake = repository();
    const service = new AgentCommandsService(fake.repository);
    const result = await service.getPendingCommands("tenant-1", "agent-1", 10);

    expect(fake.expireDueCommands).toHaveBeenCalledOnce();
    expect(fake.markDelivered).toHaveBeenCalledWith(["command-1"], expect.any(Date));
    expect(result[0]).toMatchObject({ commandId: "command-1", status: "delivered" });
  });

  it("accepts a terminal result for a delivered command", async () => {
    const fake = repository();
    const service = new AgentCommandsService(fake.repository);

    await expect(
      service.submitResult("command-1", {
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
  });

  it("fails closed for malformed direct service payloads", async () => {
    const invalidPayloads = [
      null,
      { ...request(), payloadVersion: 2 },
      { ...request(), payload: [] },
      { ...request(), commandType: "DropDatabase" },
      { ...request(), commandPayloadVersion: 0 },
      { ...request(), maxRetries: 99 },
      { ...request(), deadlineAt: "2020-01-01T00:00:00.000Z" }
    ];

    for (const payload of invalidPayloads) {
      const service = new AgentCommandsService(repository().repository);

      await expect(
        service.createCommand(payload as unknown as CreateAgentCommandRequest)
      ).rejects.toBeInstanceOf(HttpException);
    }
  });
});
