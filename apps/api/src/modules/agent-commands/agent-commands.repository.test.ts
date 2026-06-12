import { describe, expect, it } from "vitest";
import type { CommandRow } from "./agent-commands.repository";
import { mapCommandRowToEnvelope } from "./agent-commands.repository";

describe("AgentCommandsRepository mapping", () => {
  it("maps persisted command rows to command envelopes without exposing request hashes", () => {
    const row: CommandRow = {
      commandId: "command-1",
      tenantId: "tenant-1",
      agentId: "agent-1",
      draftId: "draft-1",
      metadataSnapshotId: "metadata-1",
      commandType: "CreateDraftIn1C",
      payloadVersion: 1,
      payload: { draftId: "draft-1" },
      idempotencyKey: "command-draft-1",
      status: "queued",
      retries: 0,
      maxRetries: 3,
      deadlineAt: new Date("2099-06-01T12:30:00.000Z"),
      lastError: null,
      result: null,
      requestHash: "request-hash-1",
      correlationId: "corr-1",
      createdAt: new Date("2026-06-01T12:00:00.000Z"),
      updatedAt: new Date("2026-06-01T12:00:00.000Z")
    };

    const envelope = mapCommandRowToEnvelope(row);

    expect(envelope).toMatchObject({
      commandId: "command-1",
      draftId: "draft-1",
      metadataSnapshotId: "metadata-1",
      idempotencyKey: "command-draft-1",
      status: "queued"
    });
    expect(JSON.stringify(envelope)).not.toContain("request-hash-1");
  });
});
