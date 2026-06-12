CREATE TABLE IF NOT EXISTS agent_heartbeats (
  agent_id text NOT NULL,
  tenant_id text NOT NULL,
  run_state text NOT NULL DEFAULT 'ready',
  capabilities jsonb NOT NULL DEFAULT '[]',
  schema_snapshot_id text,
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, tenant_id),
  CONSTRAINT agent_heartbeats_run_state_check CHECK (
    run_state IN ('ready', 'degraded', 'offline')
  )
);

CREATE INDEX IF NOT EXISTS agent_heartbeats_tenant_idx
  ON agent_heartbeats (tenant_id, observed_at DESC);
