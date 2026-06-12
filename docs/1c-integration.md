# 1C Integration Guide

The 1C integration layer is one of the highest-risk areas of the platform. All data processing and communication must follow a draft-first, metadata-aware, and gracefully degrading design.

## Core Integration Principles

- **OData/REST First:** Standard OData is the preferred path for reading schemas, introspection, metadata discovery, and high-level CRUD workflows.
- **External Data Processors (.epf):** Use `.epf` processing as an extensible pathway to invoke internal 1C business logic without altering the configuration.
- **Thin Client Runner:** Used as a controlled local workflow, launching client-side sessions only when necessary.
- **COM (Windows-Only Fallback):** Used strictly as a last resort on Windows for legacy databases (Automation Server or external connection).
- **File-Based Exchange:** Standard XML, CSV, or Excel exports as the ultimate safe failover.
- **DIRECT SQL WRITE IS STRICTLY FORBIDDEN:** Writing data directly to the underlying 1C SQL tables is a dangerous, unsupported pattern that bypasses all business logic and database integrity checks.
- **NO DIRECT AI WRITING:** Under no circumstances should AI algorithms output directly to 1C write targets.
- **DRAFT GATEWAY:** Every database mutation must pass through:
  
  ```text
  Raw AI Data -> Draft -> Validation -> Manual/Policy Approval -> Write Command
  ```

## Integration Capabilities Discovery

Upon startup, the Desktop Agent must verify connection options to build a dynamic `capabilityMatrix`:

- Is the OData endpoint accessible?
- Does the active credential context permit metadata reading?
- Can the credential context execute CRUD and document posting operations via OData?
- Is the 1C thin client installed on the local system?
- Are external `.epf` data processors allowed by local system configurations?
- Is COM dynamic dispatch available (Windows-only check)?
- Can file-based importing/exporting (XML, CSV, Excel) be performed locally?
- What are the active user role permissions?
- What system limitations are enforced by the active 1C environment?

The resulting `capabilityMatrix` must be bound directly to the active `metadataSnapshotId`.

## Metadata Snapshots

The metadata snapshot is a first-class entity. Any mapping, validation, or write decisions must refer to a specific `metadataSnapshotId`.

This metadata-first design is also the foundation for Automator's 70-80% no-programmer coverage target for typical and moderately customized configurations. The AI recognition and bounded agentic layer uses metadata snapshots as schema truth for evidence-based mapping, resolver decisions, validation, learning, and drift detection. See [ai-recognition-agents.md](/Users/vital/Documents/automator/docs/ai-recognition-agents.md).

A snapshot contains:

- Configuration name and version.
- Platform version.
- Detailed lists of catalogs and directories.
- Document registries and field definitions.
- Mandatory field flags.
- Relationship hierarchies and data types.
- Enumerations.
- Allowed write paths.
- Active credentials permission scopes.
- Schema checksum hash.
- Generation timestamp (`collectedAt`).

### MVP OData Metadata Scanner

The first Desktop Agent metadata module scans only the published standard OData interface. It normalizes a provided OData service root, performs a read-only check against the service document, fetches `$metadata`, and converts the returned CSDL/XML into a deterministic JSON map.

The scanner returns:

- Snapshot ID and schema hash.
- Source service root and metadata URL.
- Accessible 1C resource names.
- Object kind classification based on 1C OData prefixes such as `Catalog_`, `Document_`, `InformationRegister_`, `AccumulationRegister_`, `AccountingRegister_`, `Constant_`, `Task_`, and `BusinessProcess_`.
- Entity fields with type names, nullable flags, key flags, and reference flags.
- Navigation/reference fields and target types.
- Warnings for classifiable entities that are present in XML but not bound to an `EntitySet`.

Important limits:

- The snapshot represents only objects published through OData and accessible to the active credential context. It is not guaranteed to describe the full 1C configuration.
- The IPC request must not contain usernames, passwords, tokens, query strings, fragments, or raw connection strings.
- `authRef` is only an opaque placeholder for a future secure credential lookup. It is not a credential value.
- The module does not write to 1C, does not use EPF, does not use COM, and does not spawn 1C processes.
- Schema hashes must be calculated from normalized snapshot content, not raw XML order.

### MVP Connection Readiness Report

The first connection readiness report is a Desktop Agent diagnostic layer built on top of the OData metadata snapshot. It does not rescan 1C by itself. It accepts an existing `MetadataSnapshot`, evaluates it against the built-in MVP document-intake profile, and returns a deterministic report for the React UI.

The report checks:

- counterparty catalog availability, reference keys, names, codes, INN, and KPP aliases;
- nomenclature catalog availability, reference keys, names, codes, and accounting unit aliases;
- purchase or receipt document objects with number, date, counterparty, organization, amount, and VAT fields;
- draft-write planning prerequisites, while clearly stating that actual write permission still requires a separate execution or preflight check;
- setup gaps such as warehouses, contracts, units, and conversion coefficients.

Status rules:

- `ready`: all critical checks are found and no warning-level setup gaps remain;
- `needsAdminSetup`: at least one critical object or field is missing;
- `reviewOnly`: critical checks are found, but warning-level setup gaps require review or administrator configuration.

The report must show counts and actionable text, for example `Found 28 of 32 required fields.` It must not show abstract readiness percentages. The command must not accept credentials, execute network calls, spawn 1C, create write packages, or mutate 1C data.

## OData Path

Use OData for:

- Performing schema introspection and reading metadata models.
- Pulling catalog lists and reference tables.
- Querying and searching existing entities.
- Standard CRUD mutations.
- Posting financial documents, provided that safety validations and credential permissions explicitly allow it.

Requirements:

- Standardized, normalized OData error parsing.
- Custom network timeouts and retry limits (transient dropouts only).
- Unique idempotency keys attached to all write payloads.
- Running dry-run schema validations before committing writes.

### MVP Write Package Planner

The first write abstraction module converts a final approved draft into a non-executing write package. It is a translation layer between validation/approval and the later execution strategy.

The planner supports:

- `fresh-odata`: a relative OData `POST` request artifact for 1C Fresh or published OData targets;
- `local-json-export`: a deterministic JSON export package artifact for local 1C import routines.

The planner requires:

- `approvalStatus` equal to `approved`;
- `validationStatus` equal to `passed`;
- `operation` equal to `create`;
- `draftId`, `metadataSnapshotId`, `schemaHash`, `idempotencyKey`, and `correlationId`;
- a metadata object from the active metadata snapshot;
- field and reference names that exist in that metadata object.

The planner must:

- validate non-nullable metadata fields before producing an artifact;
- reject duplicate output fields instead of overwriting values;
- reject secret-like material in planner input;
- calculate stable hashes from normalized JSON content;
- return typed checks and typed errors.

The planner must not:

- execute HTTP requests;
- write local files;
- spawn 1C processes;
- attach authentication headers;
- accept usernames, passwords, tokens, endpoints with credentials, or raw connection strings;
- generate direct SQL or direct database payloads.

The resulting artifact is an input to a later executor. The executor is responsible for secure credential lookup, endpoint resolution, retries, result reconciliation, and audit event creation.

## External Data Processors (.epf) Path

Use `.epf` scripts for:

- Executing highly customized, configuration-specific posting rules.
- Writing data securely by executing internal 1C business methods.
- Soft-coupling integration rules without modifying the master configuration.

Requirements:

- Strict version-control for `.epf` packages.
- Integrity verification using checksum and cryptographic signature checks.
- A standardized, typed protocol for arguments between the Agent and the EPF runtime.
- Normalized return codes and structured JSON output shapes.
- No silent state mutations allowed outside explicit write commands.

### MVP EPF Preflight Module

The first Desktop Agent EPF module is **preflight-only**. It validates whether a workstation can safely prepare an external processing launch plan, but it does not execute 1C and does not write anything.

The module must:

- require a customer-installed 1C client executable;
- validate absolute local paths for the 1C executable and `.epf` file;
- accept `.epf` extensions case-insensitively;
- optionally verify a trusted SHA-256 checksum for the `.epf` file;
- validate file-based or server-based infobase targets without credentials;
- return typed checks, warnings, remediation, and a non-executing launch plan.

The module must not:

- bundle 1C binaries, license files, or platform components;
- accept passwords, tokens, usernames, or raw connection strings;
- spawn `1cv8.exe` or `1cv8c.exe`;
- use COM or direct SQL;
- mutate 1C data, configuration, or licensing state;
- log full sensitive local paths or payloads.

## Thin Client Runner Path

The 1C Thin Client (`1cv8c.exe` on Windows) should be invoked only when a scenario cannot be securely executed via OData or the EPF path.

Requirements:

- Controlled process lifecycle management with active process timeouts.
- Explicit task cancellation support.
- Console output (`stdout`/`stderr`) and log captures with automatic secret redaction.
- Dynamic OS-specific execution paths.
- No headless graphical UI automation (UI clicking) without explicit, isolated policy overrides.
- **CRITICAL WARNING:** A universal, cross-version command-line argument signature for launching and passing parameters to `.epf` scripts across all 1C versions and configuration editions cannot be guaranteed. Command-line parameters of `1cv8c.exe` can vary significantly across versions. The command-line runner logic requires rigorous **pilot hardening and validation** on target customer environments.

## COM Connection Path

COM connections are restricted:

- Available strictly on Windows systems (`#[cfg(windows)]`).
- Must run within an isolated, single-threaded apartment (STA) module.
- Allowed only as a legacy fallback.
- Must be decoupled with interface stubs and mock adapters for unit testing.

COM automation must never be selected as the default integration pathway.

## Schema Drift and Configuration Changes

If the schema hash changes:

- Flag all active AI mappings as potentially outdated or stale.
- Trigger an automatic schema diff analysis.
- Block automated write actions for any mutated or added fields.
- Require manual reviewer validation if mandatory fields have been added or removed in 1C.

## Graceful Fallback and Degradation

If automated writes fail or are unsupported:

```text
Do not panic.
Avoid partial commits.
Gracefully compile a structured local export package (XML/CSV/Excel).
Log a detailed, normalized audit event with actionable remediation steps.
```

## References

- 1C Standard OData interface: https://kb.1ci.com/1C_Enterprise_Platform/Guides/Developer_Guides/1C_Enterprise_8.3.23_Developer_Guide/Chapter_17._Integration_with_external_systems/17.4._Standard_OData_interface/17.4.1._General_information/?language=en
- 1C external data processors overview: https://kb.1ci.com/1C_Enterprise_Platform/1C_Enterprise_Platform_Overview/Rapid_development_environment/External_data_processors/?language=en
- 1C external data processors and reports: https://kb.1ci.com/1C_Enterprise_Platform/Guides/Developer_Guides/1C_Enterprise_8.3.23_Developer_Guide/Chapter_5._Configuration_objects/5.10._Reports_and_data_processors/5.10.2._External_data_processors_and_reports/
- 1C command-line interface: https://kb.1ci.com/1C_Enterprise_Platform/Guides/Administrator_Guides/1C_Enterprise_8.3.27_Administrator_Guide/Appendix_7._Startup_command-line_options_of_1C_Enterprise/7.1._General_information_about_the_system_command_line_interface/?language=en
