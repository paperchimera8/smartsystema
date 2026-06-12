# Agent Command Bus

The Agent Command Bus is the boundary between backend decisions and local 1C execution. Backend creates commands; the desktop-agent executes them; backend stores normalized results.

## Core Principle

```text
Backend decides what should happen.
Desktop Agent decides how to perform local execution safely.
1C is reached only through the Desktop Agent.
```

The backend must not call local 1C directly.

AI recognition and resolver agents must not create write commands directly. They may prepare drafts, validation inputs, explanations, and learning feedback, but command creation remains a backend-controlled transition after validation and approval. See [ai-recognition-agents.md](/Users/vital/Documents/automator/docs/ai-recognition-agents.md).

## Transport Model

MVP transport options:

- HTTPS polling or long polling for command retrieval;
- HTTPS command result submission;
- optional WebSocket for live status and push notifications.

Rules:

- Transport is not the source of truth.
- Commands and results must be persisted in backend storage.
- Agent local queue must survive restart and network loss.
- WebSocket should be an optimization, not the only execution path.

## MVP API Surface

The current backend command bus exposes these HTTP routes under the global `/api` prefix:

- `POST /api/agents/commands`: creates a queued backend-to-agent command.
- `GET /api/agents/commands/pending?tenantId=...&agentId=...&limit=...`: lets an agent poll queued commands and marks returned commands as `delivered`.
- `POST /api/agents/commands/:commandId/result`: stores a normalized terminal command result.
- `POST /api/agents/heartbeat`: records agent heartbeat, run state, capabilities, optional schema snapshot id, and pending command count.

Command creation uses `(tenantId, idempotencyKey)` plus a normalized request hash:

- same key plus same request hash returns the existing command as an idempotent replay;
- same key plus a different request hash returns a conflict;
- command payloads must not contain secrets, tokens, credentials, or connection strings.

## Command Envelope

Every command must include:

```text
commandId
tenantId
agentId
connectionProfileId
metadataSnapshotId, when relevant
idempotencyKey
commandType
payloadVersion
payload
requiredCapability
deadlineAt
createdBy
createdAt
correlationId
```

Side-effecting commands require an idempotency key.

## Command Types

Recommended MVP commands:

- `ScanMetadata`;
- `RefreshCapabilities`;
- `TestConnection`;
- `ValidateOneCObject`;
- `WriteDocument`;
- `CreateDraftIn1C`;
- `ExportPackage`;
- `RunExternalProcessing`;
- `CollectDiagnostics`.

Do not add new command types without defining:

- payload schema;
- required capability;
- idempotency behavior;
- timeout;
- retry policy;
- normalized result shape;
- audit events.

## Command Lifecycle

```text
created
  -> queued
  -> delivered
  -> accepted
  -> running
  -> succeeded

rejected
failed_retryable
failed_terminal
timed_out
cancelled
expired
```

Rules:

- `succeeded` must include a normalized result.
- `failed_terminal` must include a normalized error.
- `timed_out` must not imply that 1C side effects did not happen.
- Backend must reconcile unknown command state before retrying dangerous writes.

## Agent Local Queue

The agent stores commands locally before execution.

Local queue fields:

```text
commandId
idempotencyKey
commandType
payloadHash
status
attemptCount
nextAttemptAt
deadlineAt
lastErrorCode
pendingResult
createdAt
updatedAt
```

Rules:

- Local persistence should use SQLite/SQLCipher.
- Duplicate command ids must not create duplicate local work.
- Duplicate idempotency keys must resolve to the same final result where possible.
- Queue recovery must run on agent startup.
- If local execution completes while backend submission fails, the agent stores `pendingResult` and retries result submission without executing the command again.

## Result Envelope

Every result must include:

```text
commandId
tenantId
agentId
status
startedAt
finishedAt
selectedStrategy
externalReference
normalizedErrors
retryable
diagnosticRef
correlationId
```

Raw 1C errors can be stored as protected diagnostics, but user-facing payloads must be normalized and redacted.

## Idempotency

Write commands must be safe under retry.

Backend responsibilities:

- generate stable idempotency keys;
- prevent duplicate command creation for the same approved draft;
- reconcile unknown command outcomes.

Agent responsibilities:

- deduplicate command ids;
- deduplicate idempotency keys;
- avoid re-running completed side effects;
- report prior result when duplicate command is received.

## Timeouts And Retries

- Network delivery retries are safe.
- Validation failures are terminal.
- Permission failures are usually terminal until configuration changes.
- 1C transient availability failures can be retryable.
- Unknown write outcome requires reconciliation before retry.

Retry policy must be command-specific.

## Security

- Commands must be authenticated and authorized.
- Agent must verify tenant and agent identity.
- Backend must verify command target agent belongs to tenant.
- Payloads must not contain plaintext 1C credentials.
- Diagnostics must be redacted.

## Audit

Create audit events for:

- command created;
- command delivered;
- command accepted/rejected;
- command succeeded;
- command failed;
- command timed out;
- command manually cancelled.

Audit events should distinguish backend actor, human approver, and agent executor.
