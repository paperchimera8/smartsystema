CREATE TABLE IF NOT EXISTS document_exceptions (
  exception_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  document_id text NOT NULL,
  draft_id text,
  metadata_snapshot_id text,
  schema_hash text,
  stage text NOT NULL,
  category text NOT NULL,
  queue_name text NOT NULL,
  priority text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  requires_accountant_review boolean NOT NULL DEFAULT true,
  requires_admin_review boolean NOT NULL DEFAULT false,
  signals jsonb NOT NULL,
  top_signal_code text NOT NULL,
  suggested_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  correlation_id text NOT NULL,
  created_by_user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_exceptions_stage_check CHECK (
    stage IN (
      'upload',
      'ocr',
      'classification',
      'mapping',
      'entity_resolution',
      'validation',
      'draft_creation',
      'write_planning'
    )
  ),
  CONSTRAINT document_exceptions_category_check CHECK (
    category IN (
      'ocr_failed',
      'unsupported_document',
      'low_confidence',
      'counterparty_issue',
      'nomenclature_issue',
      'unit_mismatch',
      'vat_mismatch',
      'metadata_gap',
      'validation_failed',
      'policy_blocked'
    )
  ),
  CONSTRAINT document_exceptions_queue_name_check CHECK (
    queue_name IN (
      'accountant_review',
      'admin_setup',
      'ocr_retry',
      'manual_processing'
    )
  ),
  CONSTRAINT document_exceptions_priority_check CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  CONSTRAINT document_exceptions_status_check CHECK (status IN ('open', 'in_review', 'resolved', 'dismissed')),
  CONSTRAINT document_exceptions_open_state_check CHECK (
    status <> 'open'
    OR (
      signals <> '[]'::jsonb
      AND jsonb_array_length(suggested_actions) > 0
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS document_exceptions_tenant_idempotency_key_idx
  ON document_exceptions (tenant_id, idempotency_key);

CREATE INDEX IF NOT EXISTS document_exceptions_tenant_queue_status_idx
  ON document_exceptions (tenant_id, queue_name, status, priority, created_at);

CREATE INDEX IF NOT EXISTS document_exceptions_tenant_document_idx
  ON document_exceptions (tenant_id, document_id, created_at);

CREATE INDEX IF NOT EXISTS document_exceptions_correlation_idx
  ON document_exceptions (correlation_id);
