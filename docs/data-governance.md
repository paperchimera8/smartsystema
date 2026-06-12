# Data Governance

This guide defines how Automator handles sensitive documents, OCR artifacts, tenant data boundaries, and retention policy.

## Data Classes

Automator handles several sensitivity classes:

- raw uploaded documents;
- OCR artifacts;
- extracted business fields;
- mapping suggestions;
- resolved entity candidates;
- accountant corrections;
- validation reports;
- write commands and results;
- audit events;
- diagnostics and logs.

Raw documents, OCR artifacts, extracted fields, corrections, and diagnostics are sensitive by default.

## Tenant Policy

Tenant policy must define:

- allowed OCR/LLM execution modes;
- allowed regions/providers;
- raw document retention;
- OCR artifact retention;
- diagnostic bundle policy;
- crash reporting policy;
- export package retention;
- support access rules.

OCR/LLM adapters must check tenant policy before sending content to any external provider.

## Storage Rules

- Store raw documents in object storage, not in queue payloads.
- Store OCR artifacts separately from normalized business fields.
- Store only references to raw artifacts in jobs and audit events.
- Encrypt sensitive storage where practical.
- Do not duplicate raw document bytes across services.
- Do not store secrets in document metadata records.

## Retention

Retention should be explicit per tenant and data class.

Recommended defaults for MVP:

- raw documents: tenant-configured;
- OCR artifacts: tenant-configured;
- diagnostics: short retention;
- audit log: long retention, append-only;
- learning feedback: long retention, tenant-scoped;
- local agent queue payloads: only until completed and acknowledged.

Deletion must preserve audit integrity. If a raw document is deleted, audit records should keep redacted references and deletion metadata, not the original content.

## Data Residency

Execution modes:

- `local`: processing stays on customer-controlled infrastructure;
- `regional-cloud`: processing uses approved regional providers;
- `cloud`: processing may use configured global cloud providers.

If tenant policy requires local processing, cloud OCR/LLM adapters must fail closed or use an approved local fallback.

## Logs And Diagnostics

Logs must not contain:

- raw document content;
- full OCR text;
- secrets or tokens;
- connection strings;
- personal data unless explicitly redacted;
- private file system paths that reveal customer data.

Diagnostic bundles must include references, normalized error codes, versions, and redacted context instead of raw contents.

## Learning Feedback

Learning feedback must be:

- tenant-scoped;
- linked to a metadata snapshot;
- traceable to a correction event;
- separate from immutable audit events;
- reversible or disableable by policy.

Learning feedback must not mutate historical documents or rewrite audit history.

## Support Access

Support access should be:

- time-bound;
- audited;
- least privilege;
- tenant-approved where required;
- blocked from raw documents unless explicitly authorized.

## References

- GDPR official text: https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng
- OpenTelemetry semantic concepts: https://opentelemetry.io/docs/concepts/signals/

