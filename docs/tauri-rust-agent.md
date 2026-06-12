# Tauri Rust Agent Guide

The Desktop Agent is a local execution layer operating on the client machine next to 1C. It is designed to be a bridge, not the brain of the product, and does not make high-level product decisions or execute heavy AI/OCR logic.

The agent still enables the AI recognition coverage target: its metadata scans, capability matrix, local queue, and safe write/export execution make it possible for the backend AI layer to support roughly 70-80% of typical and moderately customized 1C configurations without a 1C programmer for every setup. The product and technical design for that bounded AI layer lives in [ai-recognition-agents.md](/Users/vital/Documents/automator/docs/ai-recognition-agents.md).

## Agent Boundaries

The Agent is responsible for:

- Tauri command bindings and IPC bridges between the React UI and the Rust core.
- Connecting to 1C.
- Reading and scanning metadata schemas.
- Storing local outbox/inbox queues securely.
- Safe encryption and storage of credentials and secrets.
- Parsing and executing agent commands dispatched by the backend.
- Managing and launching local helper processes safely.
- Performing safe, idempotent write/export operations.
- Delivering local telemetry, health statistics, and system diagnostics.

The Agent is NOT responsible for:

- Executing OCR or layout analysis.
- Computing AI mapping suggestions.
- Performing entity resolution.
- Calculating confidence scores.
- Validating drafts against accounting policies.
- Enforcing approval workflows.
- Classifying documents or determining their business intent.

## Tauri Commands

Rules:

- Every Tauri command must act as a thin adapter layer, delegating tasks to dedicated Rust services.
- No complex business or mapping logic should reside in command handlers.
- All input payloads must be strictly validated before execution.
- All errors must be returned as typed, structured responses, never as arbitrary panics or unformatted string dumps.
- Never pass raw secrets, passwords, connection strings, or unredacted raw diagnostics to the frontend.

Recommended flow:

```text
React UI -> Tauri command -> Rust service -> typed result/error
```

Forbidden flow:

```text
React UI -> shell command -> uncontrolled local side effect
```

Implemented local diagnostic commands:

- `scan_metadata`: async OData service-root and `$metadata` scanner. It performs read-only HTTP calls and returns a normalized `MetadataSnapshot`.
- `build_connection_readiness_report`: synchronous pure diagnostic command. It receives a `MetadataSnapshot`, evaluates the built-in MVP readiness profile, and returns a structured report for UI display.

`build_connection_readiness_report` must remain side-effect free. It must not perform network calls, read credentials, spawn processes, create write plans, or write to 1C. It is an explainability layer over already collected metadata.

## React UI

The React application inside the Tauri desktop agent is restricted to:

- Initial onboarding and configuration workflows.
- Visualizing connection status and diagnostic reports.
- Displaying actionable, local error states.
- Prompting manual user approvals for local-only actions.
- Triggering secure, local agent workflows.

The React UI MUST NOT:

- Store 1C credentials or access tokens in UI state.
- Select the backend write strategies.
- Execute direct shell commands or sub-processes.
- Host the core system integration and writing logic for 1C.

For the connection readiness screen, the browser preview may use a static demo report. The Tauri runtime path must call `scan_metadata` first and then pass the returned snapshot to `build_connection_readiness_report`. The UI should display counts, found or missing checks, limitations, and administrator actions without exposing raw endpoints, credentials, or low-level diagnostics.

## IPC & Contracts

- All IPC payloads must be versioned and strictly typed.
- Shared DTO types must reside in `packages/contracts` if needed by both backend and desktop frontends.
- Use clean, JSON-compatible DTO structures across the Rust/TypeScript boundaries.
- Never transmit heavy raw documents over IPC. Use secure file paths or storage references with explicit permissions instead.

## Local Queue

The local queue ensures offline-safe, resilient execution of incoming agent commands.

Requirements:

- Durable persistent storage.
- An explicit, unique `idempotencyKey` assigned to each command.
- Status, attempt counters, and retry backoff delays.
- `pendingResult` storage so completed local execution results can be retried after network loss without executing the same command again.
- Clear separation of retryable (e.g., network transient) and non-retryable (e.g., invalid data) errors.
- Dead-letter state for unrecoverable errors.
- Redacted payload previews for user diagnostics.
- Graceful recovery and job resumption upon application restart.

Implementation Blueprint for MVP:

```text
rusqlite + SQLCipher bundled features -> SQLite/SQLCipher persistent outbox/inbox tables
```

State storage options:
- **SQLCipher** (via `rusqlite` bundled features) for database-level state encryption, OR
- **Tauri Stronghold** for credentials/secrets storage combined with a standard **SQLite** database for queue state.

## Secrets Security

- Secret materials must reside strictly in the OS keyring (using the `keyring` crate) or within Tauri's secure Stronghold plugin.
- The React frontend must have zero access to raw secret material.
- Telemetry, diagnostic dumps, and logs must be heavily redacted to exclude passwords, access tokens, connection strings, and certificates.

## Plugin Permissions & Allowlists

- Enable Tauri plugins only when absolutely necessary.
- The Tauri shell plugin must be restricted using a strict allowlist of allowed commands and exact argument schemas.
- File system scopes must be minimal (least privilege).
- Any modifications to plugins, permissions, or system capabilities must undergo peer reviews as security-sensitive changes.

## Platform-Specific Implementation Boundaries

- All Windows COM and automation-related logic must be isolated behind `#[cfg(windows)]`.
- macOS Keychain, launchd agents/daemons, and code notarization must reside in isolated macOS modules.
- **CRITICAL (Windows Services):** Do not attempt to run the main Tauri GUI executable as a Windows Service. Instead, build a separate Rust helper/service binary (`#[cfg(windows)]`) that registers as a service via the `windows-service` crate. The Tauri GUI agent should only configure, start/stop, and read diagnostics from this service binary.
- **CRITICAL (macOS WebView):** On macOS, Tauri utilizes Apple's native WKWebView/WebKit rather than Chromium or WebView2. WebKit updates are bound to macOS system updates; unsupported macOS versions will not receive WebKit updates. The frontend code must be compatible with older WKWebView versions where applicable.
- macOS desktop agent background tasks must use launchd agents/daemons.
- Cross-platform facade interfaces must return an explicit `UnsupportedPlatform` error with descriptive reasons instead of crashing or panicking.

## Updater

- The auto-updater must only pull from a signed distribution channel.
- Update manifests must support channel segregation: `dev`, `pilot`, and `stable`.
- Rollback and update-pause strategies must be ready before staging a production rollout.
- Auto-updater errors must be logged with redacted paths and metadata to protect customer environments.

## References

- Tauri Architecture: https://v2.tauri.app/concept/architecture/
- Calling Rust from Frontend: https://v2.tauri.app/develop/calling-rust/
- Tauri Permissions Security: https://v2.tauri.app/security/permissions/
- Tauri Shell Plugin: https://v2.tauri.app/plugin/shell/
- Tauri Stronghold Plugin: https://v2.tauri.app/plugin/stronghold/
- Tauri Updater Plugin: https://v2.tauri.app/plugin/updater/
