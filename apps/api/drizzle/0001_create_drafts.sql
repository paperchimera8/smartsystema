CREATE TABLE IF NOT EXISTS drafts (
  draft_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  document_id text NOT NULL,
  metadata_snapshot_id text NOT NULL,
  schema_hash text NOT NULL,
  document_type text NOT NULL,
  target_resource_name text NOT NULL,
  lifecycle_status text NOT NULL DEFAULT 'needs_review',
  approval_status text NOT NULL DEFAULT 'pending',
  write_status text NOT NULL DEFAULT 'not_requested',
  requires_accountant_approval boolean NOT NULL DEFAULT true,
  fields jsonb NOT NULL,
  draft_references jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence jsonb NOT NULL,
  validation_summary jsonb NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  correlation_id text NOT NULL,
  created_by_user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT drafts_lifecycle_status_check CHECK (
    lifecycle_status IN (
      'created',
      'processing',
      'needs_review',
      'validated',
      'approved',
      'write_pending',
      'written',
      'failed',
      'write_failed',
      'export_required',
      'cancelled'
    )
  ),
  CONSTRAINT drafts_approval_status_check CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  CONSTRAINT drafts_write_status_check CHECK (
    write_status IN (
      'not_requested',
      'planning',
      'queued',
      'running',
      'succeeded',
      'failed',
      'export_required'
    )
  ),
  CONSTRAINT drafts_creation_requires_review_check CHECK (
    lifecycle_status <> 'needs_review'
    OR (
      approval_status = 'pending'
      AND write_status = 'not_requested'
      AND requires_accountant_approval = true
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS drafts_tenant_idempotency_key_idx
  ON drafts (tenant_id, idempotency_key);

CREATE INDEX IF NOT EXISTS drafts_tenant_document_idx
  ON drafts (tenant_id, document_id);

CREATE INDEX IF NOT EXISTS drafts_tenant_metadata_idx
  ON drafts (tenant_id, metadata_snapshot_id);

CREATE TABLE IF NOT EXISTS audit_events (
  audit_event_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  actor_type text NOT NULL,
  actor_id text NOT NULL,
  event_type text NOT NULL,
  subject_type text NOT NULL,
  subject_id text NOT NULL,
  payload jsonb NOT NULL,
  correlation_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_events_tenant_subject_idx
  ON audit_events (tenant_id, subject_type, subject_id, created_at);

CREATE INDEX IF NOT EXISTS audit_events_correlation_idx
  ON audit_events (correlation_id);
