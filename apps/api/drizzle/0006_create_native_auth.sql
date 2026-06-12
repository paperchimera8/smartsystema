CREATE TABLE IF NOT EXISTS users (
  user_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  email text NOT NULL,
  display_name text NOT NULL,
  role text NOT NULL DEFAULT 'accountant',
  status text NOT NULL DEFAULT 'active',
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_role_check CHECK (role IN ('accountant', 'admin')),
  CONSTRAINT users_status_check CHECK (status IN ('active', 'disabled')),
  CONSTRAINT users_email_normalized_check CHECK (email = lower(email)),
  CONSTRAINT users_password_hash_check CHECK (password_hash LIKE 'scrypt:v1:%')
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx
  ON users (email);

CREATE INDEX IF NOT EXISTS users_tenant_idx
  ON users (tenant_id);

CREATE TABLE IF NOT EXISTS native_auth_requests (
  auth_request_id text PRIMARY KEY,
  state_hash text NOT NULL,
  poll_token_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  user_id text,
  tenant_id text,
  session_code_hash text,
  device_label text,
  correlation_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT native_auth_requests_status_check CHECK (
    status IN ('pending', 'completed', 'consumed', 'expired')
  ),
  CONSTRAINT native_auth_requests_completion_check CHECK (
    status <> 'completed'
    OR (
      user_id IS NOT NULL
      AND tenant_id IS NOT NULL
      AND session_code_hash IS NOT NULL
      AND completed_at IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS native_auth_requests_status_expires_idx
  ON native_auth_requests (status, expires_at);

CREATE INDEX IF NOT EXISTS native_auth_requests_correlation_idx
  ON native_auth_requests (correlation_id);

CREATE TABLE IF NOT EXISTS auth_sessions (
  session_id text PRIMARY KEY,
  user_id text NOT NULL,
  tenant_id text NOT NULL,
  access_token_hash text NOT NULL,
  user_agent text,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_sessions_user_idx
  ON auth_sessions (user_id, expires_at);

CREATE INDEX IF NOT EXISTS auth_sessions_tenant_idx
  ON auth_sessions (tenant_id, expires_at);
