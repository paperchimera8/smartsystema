# Security Guide

Security must be built into the product boundaries: desktop-agent as local executor, backend as control plane, AI as suggestion layer, and 1C writes only through validated commands.

## Core Rules

- No plaintext secrets.
- No raw documents in logs.
- No direct AI writes to 1C.
- No direct writes to 1C database tables.
- No cloud OCR/LLM without tenant policy.
- No embedded-webview login for desktop auth.
- No shell/process execution without explicit allowlist.
- No destructive migrations without explicit approval.

## Secrets

Desktop:

- Store secrets in OS keyring or Stronghold.
- Keep tokens out of React state.
- Redact secrets before logs, telemetry, diagnostics and crash reports.
- Separate user tokens from machine enrollment credentials.

Backend:

- Store secrets in environment/secret manager, not source code.
- Never log env values.
- Rotate provider/API credentials.
- Use least privilege credentials for object storage, Redis, Postgres and OCR providers.

## Native Auth

- Desktop auth uses external browser + Authorization Code + PKCE.
- Callback through deep link or loopback redirect.
- Validate `state` and PKCE verifier.
- Use single-instance handling for repeated callback launches.
- Refresh tokens live only in secure local storage.

## Tenant Isolation

- Every domain record must be tenant-scoped.
- Authorization checks must include tenant id.
- Background jobs must carry tenant id and validate access before side effects.
- Object storage keys must include tenant-safe partitioning.
- Cross-tenant search or embeddings lookup is forbidden.

## Document Data

- Raw documents are sensitive.
- Retention policy is explicit per tenant.
- OCR artifacts and extracted fields are sensitive.
- Logs and traces must contain references, not raw content.
- Diagnostic bundles must be redacted.

## OCR / LLM Policy

Tenant policy decides execution mode:

- `local`;
- `regional-cloud`;
- `cloud`.

Provider adapters must check policy before sending data out. If policy blocks provider usage, the system should fail with actionable error or use local fallback.

## Transport Security

- TLS verification remains enabled in production.
- Self-hosted server and LAN backend deployments must use HTTPS. Plain HTTP is allowed only for loopback development or same-machine local backend use.
- Backend CORS must use an explicit allowlist in production; wildcard origins are forbidden.
- Swagger and private-network CORS headers must be explicitly enabled in production rather than exposed by default.
- Enterprise CA support should use OS certificate facilities where practical.
- mTLS can be added for enterprise/self-hosted agent enrollment.
- WebSocket/control channels must authenticate agent and tenant.

## Desktop Permissions

- Tauri permissions and capabilities are security-sensitive.
- Shell plugin scopes must allow only specific commands and argument patterns.
- File scopes must be minimal.
- Updater channel must be signed and controlled.

## Audit Log

Audit log is append-only for significant actions:

- document upload;
- OCR result;
- mapping suggestion;
- validation result;
- user correction;
- approval;
- agent command;
- write result;
- export package creation.

Audit records must distinguish AI suggestions, validation decisions and human approvals.

## Redaction

Redact:

- tokens;
- passwords;
- connection strings;
- certificates/private keys;
- raw OCR text;
- personal data where not needed;
- document contents;
- file system paths if they expose customer data.

## References

- Tauri permissions: https://v2.tauri.app/security/permissions/
- Tauri Stronghold: https://v2.tauri.app/plugin/stronghold/
- Rust keyring: https://docs.rs/keyring/latest/keyring/
- RFC 8252 native app OAuth: https://www.rfc-editor.org/rfc/rfc8252.html
- Tauri shell plugin security: https://v2.tauri.app/plugin/shell/
