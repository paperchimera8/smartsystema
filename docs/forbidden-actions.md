# Forbidden Actions

This document establishes strict operational constraints for AI agents (including Cursor/Codex) and human developers. If a task requires bypassing or violating any of the rules listed below, you must stop immediately and obtain explicit, documented confirmation from the project owner.

The AI agent and developers must NOT:

- Write directly to 1C database tables via direct SQL or database connection drivers.
- Bypass the draft, validation, and approval layers before executing a write to 1C.
- Allow AI algorithms to directly create or execute write commands without validation.
- Store raw uploaded documents or binary files in application log systems.
- Store raw OCR text outputs in logs without applying a strict redaction filter.
- Log secrets, OAuth tokens, API keys, passwords, private keys, or raw connection strings.
- Store 1C credentials, passwords, or access tokens in React/frontend state or local storage variables.
- Add local shell commands to the desktop agent without establishing an explicit allowlist and registering Tauri permission scopes.
- Broaden Tauri file system or process permission scopes without formal architectural review.
- Add COM/Automation code outside of designated Windows-only (`#[cfg(windows)]`) modules.
- Make Windows COM the default or preferred integration path.
- Disable TLS verification in production environments or communication clients.
- Introduce cloud-based OCR/LLM providers without checking and enforcing active tenant data-residency policies.
- Send documents or transactional data to cloud providers when the tenant policy mandates local on-premise execution.
- Modify CI/CD code-signing, timestamping, or notarization steps without explicit engineering instructions.
- Publish unsigned desktop agent binaries as a stable or pilot release.
- Disable, skip, or delete test suites simply to make CI builds pass.
- Weaken DTO validation filters to silently accept malformed or unvalidated input payloads.
- Modify production database schemas or migrations destructively (e.g., dropping columns) without explicit owner approval.
- Delete or modify database records in the immutable audit log.
- Mutate, overwrite, or rewrite learning feedback events as if they were original system recommendations.
- Silently expand the scope of a development task beyond the requested feature.
- Execute direct production side effects inside HTTP request handlers when an asynchronous job or agent command is architecturally required.
- Hide validation warnings or errors from the accountant or user review UI.
- Convert low-confidence AI mappings or predictions into auto-approved drafts.
- Swallow or suppress agent command execution errors without logging and returning a normalized error payload.

## Required Stop Points

Stop execution and ask for explicit confirmation before:

- Altering the core behavior, fallback paths, or priorities of the active write strategies.
- Modifying the tenant data residency policies, boundary checks, or encryption parameters.
- Changing the document retention and storage policies.
- Adding a new external OCR, parser, or LLM provider adapter.
- Introducing a new local shell or process execution command to the desktop agent.
- Modifying release pipelines or update manifest signing automations.
- Altering user authentication, device enrollment, or secure token storage mechanisms.
- Writing or committing destructive database migrations.
- Removing or reducing test coverage around core draft, validation, or write paths.
