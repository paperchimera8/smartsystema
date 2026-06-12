# External References

This file records the external sources used to align Automator's architecture and engineering guides. Prefer official documentation and well-known upstream repositories.

## Agent Context Files

- AGENTS.md open format: https://github.com/agentsmd/agents.md
- AGENT.md format proposal and examples: https://github.com/agentmd/agent.md
- Microsoft AGENTS generator skill: https://github.com/microsoft/skills/blob/main/.github/plugins/deep-wiki/skills/wiki-agents-md/SKILL.md

Alignment:

- Root `AGENTS.md` should act as a concise repository guide for coding agents.
- It should include project structure, commands, coding conventions, architecture boundaries, testing, security, and links to deeper docs.

## Tauri Desktop Agent

- Tauri architecture concept: https://v2.tauri.app/concept/architecture/
- Tauri upstream architecture document: https://github.com/tauri-apps/tauri/blob/dev/ARCHITECTURE.md
- Tauri command invocation: https://v2.tauri.app/develop/calling-rust/
- Tauri permissions: https://v2.tauri.app/security/permissions/
- Tauri shell plugin: https://v2.tauri.app/plugin/shell/
- Tauri Stronghold plugin: https://v2.tauri.app/plugin/stronghold/
- Tauri updater plugin: https://v2.tauri.app/plugin/updater/
- Tauri GitHub pipeline: https://v2.tauri.app/distribute/pipelines/github/

Alignment:

- Rust owns system-level capabilities.
- Webview/React communicates with Rust through controlled IPC.
- Plugins and permissions must be explicit and scoped.
- Signed updater flow is part of release architecture.

## Rust System Code

- Apollo GraphQL Rust Best Practices: https://github.com/apollographql/rust-best-practices
- Tokio: https://tokio.rs/
- reqwest: https://docs.rs/reqwest/latest/reqwest/
- serde: https://serde.rs/
- thiserror: https://docs.rs/thiserror/latest/thiserror/
- tracing: https://docs.rs/tracing/latest/tracing/
- rusqlite: https://docs.rs/rusqlite/latest/rusqlite/
- keyring: https://docs.rs/keyring/latest/keyring/
- windows-service: https://docs.rs/windows-service/latest/windows_service/
- Microsoft IDispatch: https://learn.microsoft.com/en-us/windows/win32/api/oaidl/nn-oaidl-idispatch

Alignment:

- Production Rust code should use typed errors, structured tracing, explicit timeouts, and platform-specific modules.
- COM integration is Windows-specific and must stay isolated.

## 1C Integration

- Standard OData interface: https://kb.1ci.com/1C_Enterprise_Platform/Guides/Developer_Guides/1C_Enterprise_8.3.23_Developer_Guide/Chapter_17._Integration_with_external_systems/17.4._Standard_OData_interface/17.4.1._General_information/?language=en
- OData description endpoints and `$metadata`: https://kb.1ci.com/1C_Enterprise_Platform/Guides/Developer_Guides/1C_Enterprise_8.3.23_Developer_Guide/Chapter_17._Integration_with_external_systems/17.4._Standard_OData_interface/17.4.7._Ways_to_get_a_description_of_the_standard_OData_interface/
- OData resource name generation rules: https://kb.1ci.com/1C_Enterprise_Platform/Guides/Developer_Guides/1C_Enterprise_8.3.23_Developer_Guide/Chapter_17._Integration_with_external_systems/17.4._Standard_OData_interface/17.4.4._Resource_name_generation_rules/?language=en
- Publishing and scoping the standard OData interface: https://kb.1ci.com/1C_Enterprise_Platform/Guides/Developer_Guides/1C_Enterprise_8.3.23_Developer_Guide/Chapter_17._Integration_with_external_systems/17.4._Standard_OData_interface/17.4.12._Publishing_the_standard_OData_interface/
- External data processors overview: https://kb.1ci.com/1C_Enterprise_Platform/1C_Enterprise_Platform_Overview/Rapid_development_environment/External_data_processors/?language=en
- External data processors and reports: https://kb.1ci.com/1C_Enterprise_Platform/Guides/Developer_Guides/1C_Enterprise_8.3.23_Developer_Guide/Chapter_5._Configuration_objects/5.10._Reports_and_data_processors/5.10.2._External_data_processors_and_reports/
- 1C command-line interface: https://kb.1ci.com/1C_Enterprise_Platform/Guides/Administrator_Guides/1C_Enterprise_8.3.27_Administrator_Guide/Appendix_7._Startup_command-line_options_of_1C_Enterprise/7.1._General_information_about_the_system_command_line_interface/?language=en

Alignment:

- OData can expose standard data access and metadata capabilities when published.
- `$metadata` returns an XML description of available entities, attributes, and functions.
- Published OData scope can be limited to the objects required by external applications.
- 1C resource names are generated from a prefix, configuration object name, and optional suffix.
- External data processors are separate `.epf`/`.erf` artifacts and can extend behavior without changing configuration structure.
- Thin-client and COM paths need pilot validation and platform-specific handling.

## NestJS Backend

- Validation: https://docs.nestjs.com/techniques/validation
- Queues: https://docs.nestjs.com/techniques/queues
- Configuration: https://docs.nestjs.com/techniques/configuration
- OpenAPI: https://docs.nestjs.com/openapi/introduction
- Health checks: https://docs.nestjs.com/recipes/terminus
- Testing: https://docs.nestjs.com/fundamentals/testing
- Passport/auth: https://docs.nestjs.com/recipes/passport

Alignment:

- Controllers stay thin.
- DTO validation is mandatory.
- Long-running work should move to queues.
- Health/readiness and OpenAPI should be first-class production concerns.

## Jobs And Workflows

- BullMQ documentation: https://docs.bullmq.io/
- BullMQ retrying failing jobs: https://docs.bullmq.io/guide/retrying-failing-jobs
- BullMQ production guide: https://docs.bullmq.io/guide/going-to-production
- Temporal retry policies: https://docs.temporal.io/encyclopedia/retry-policies

Alignment:

- BullMQ is appropriate for MVP job orchestration.
- Retry/backoff and failed-job handling need explicit policy.
- Temporal should be considered later for durable long-running workflows.

## OCR, AI, And Entity Resolution

- Yandex Vision OCR: https://aistudio.yandex.ru/docs/ru/vision/concepts/ocr/
- Google Document AI: https://cloud.google.com/document-ai/docs
- PaddleOCR: https://www.paddleocr.ai/main/en/index.html
- Tesseract OCR: https://tesseract-ocr.github.io/
- pgvector: https://github.com/pgvector/pgvector
- PostgreSQL pg_trgm: https://www.postgresql.org/docs/current/pgtrgm.html
- OpenAI embeddings: https://developers.openai.com/api/docs/guides/embeddings

Alignment:

- OCR providers should be behind policy-aware adapters.
- Entity resolution should combine exact identifiers, fuzzy matching, embeddings, history, and validation signals.
- AI suggestions must remain advisory.

## Native Auth

- RFC 8252 OAuth 2.0 for Native Apps: https://www.rfc-editor.org/rfc/rfc8252.html
- Tauri deep link plugin: https://v2.tauri.app/plugin/deep-link/
- Tauri single instance plugin: https://v2.tauri.app/plugin/single-instance/
- Tauri opener plugin: https://v2.tauri.app/plugin/opener/

Alignment:

- Native desktop auth should use external browser + Authorization Code + PKCE.
- Embedded webview login is not acceptable for this product.

## Release And Observability

- GitHub Actions matrix builds: https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/run-job-variations
- tauri-action: https://github.com/tauri-apps/tauri-action
- Microsoft SignTool: https://learn.microsoft.com/en-us/dotnet/framework/tools/signtool-exe
- Apple notarization: https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution
- OpenTelemetry JS: https://opentelemetry.io/docs/languages/js/
- OpenTelemetry Rust: https://opentelemetry.io/docs/languages/rust/

Alignment:

- Desktop releases require platform-specific build, signing, update, and rollback practices.
- Traces, metrics, logs, and diagnostics must be redacted and correlation-friendly.

## Data Governance And Persistence

- GDPR official text: https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng
- PostgreSQL transactions: https://www.postgresql.org/docs/current/tutorial-transactions.html
- PostgreSQL constraints: https://www.postgresql.org/docs/current/ddl-constraints.html

Alignment:

- Sensitive document data needs explicit retention, residency, and redaction policy.
- Durable domain truth should live in PostgreSQL/object storage, not queue payloads.
- Migrations are production-sensitive and should prefer additive, reversible changes.
