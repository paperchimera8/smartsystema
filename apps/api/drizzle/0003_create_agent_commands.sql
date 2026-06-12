CREATE TABLE IF NOT EXISTS agent_commands (
  command_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  agent_id text NOT NULL,
  draft_id text,
  metadata_snapshot_id text,
  command_type text NOT NULL,
  payload_version integer NOT NULL DEFAULT 1,
  payload jsonb NOT NULL DEFAULT '{}',
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  retries integer NOT NULL DEFAULT 0,
  max_retries integer NOT NULL DEFAULT 3,
  deadline_at timestamptz NOT NULL,
  last_error text,
  result jsonb,
  request_hash text NOT NULL,
  correlation_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_commands_status_check CHECK (
    status IN (
      'queued',
      'delivered',
      'accepted',
      'running',
      'succeeded',
      'rejected',
      'failed_retryable',
      'failed_terminal',
      'timed_out',
      'cancelled',
      'expired'
    )
  ),
  CONSTRAINT agent_commands_command_type_check CHECK (
    command_type IN (
      'WriteDocument',
      'CreateDraftIn1C',
      'ExportPackage',
      'ScanMetadata',
      'RefreshCapabilities',
      'TestConnection',
      'ValidateOneCObject',
      'RunExternalProcessing',
      'CollectDiagnostics'
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_commands_tenant_idempotency_idx
  ON agent_commands (tenant_id, idempotency_key);

CREATE INDEX IF NOT EXISTS agent_commands_tenant_agent_status_idx
  ON agent_commands (tenant_id, agent_id, status);

CREATE INDEX IF NOT EXISTS agent_commands_tenant_deadline_idx
  ON agent_commands (tenant_id, deadline_at)
  WHERE status IN ('queued', 'delivered', 'accepted', 'running');
