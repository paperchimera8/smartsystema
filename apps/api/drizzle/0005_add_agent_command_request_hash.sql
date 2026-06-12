ALTER TABLE agent_commands
  ADD COLUMN IF NOT EXISTS request_hash text;

UPDATE agent_commands
  SET request_hash = md5(
    concat_ws(
      '|',
      tenant_id,
      agent_id,
      command_type,
      payload_version::text,
      payload::text,
      coalesce(draft_id, ''),
      coalesce(metadata_snapshot_id, ''),
      idempotency_key,
      deadline_at::text,
      max_retries::text,
      correlation_id
    )
  )
  WHERE request_hash IS NULL;

ALTER TABLE agent_commands
  ALTER COLUMN request_hash SET NOT NULL;
