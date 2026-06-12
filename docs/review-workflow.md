# Review Workflow

This guide defines the accountant-facing review and approval workflow between AI suggestions and final 1C execution.

## Purpose

The review workflow exists to keep automation safe. It turns OCR and AI output into an auditable draft that a human or tenant policy can approve before any 1C write occurs.

## Review Rules

Review items are generated only from current recognition, mapping, entity resolution, and validation quality. Supported reasons include low OCR confidence, missing or invalid required fields, counterparty identifier conflicts, ambiguous counterparty or nomenclature matches, unit mismatches, missing conversion coefficients, VAT or line-total mismatches, unsupported document types, metadata gaps, policy blocks, and technical failures.

Duplicate detection and reconciliation against existing 1C documents are not part of the MVP review rules. The product must not create duplicate-related statuses, warnings, queues, readiness caps, or blocking decisions.

Status rules:

- `uploaded`: file accepted, processing has not started.
- `recognizing`: OCR, classification, mapping, or validation is running.
- `needs_review`: processing finished, but critical/warning review items remain or confidence is below threshold.
- `ready_to_send`: required data is complete, validation passed, and no unresolved critical/warning issues remain.
- `sent_to_1c`: safe draft write completed.
- `error`: technical or unrecoverable processing failure.

Readiness rules:

- Uploaded documents stay in the `0-20` range.
- Processing documents stay in the `21-45` range.
- Processed documents with critical issues are capped at `84`.
- Missing required fields are capped at `79`.
- Warning-only documents are capped at `94`.
- Ready or sent documents can reach `100`.

Confidence rules:

- Exact identifiers dominate fuzzy matching.
- Exact INN/KPP, barcode, vendor code, SKU, or user confirmation can produce high confidence.
- Name-only fuzzy matches are capped and require review below the automatic threshold.
- Unit mismatches and missing conversion coefficients require review even when other fields are high confidence.
- High confidence does not permit sending if unresolved review items remain.

## Review Entry Points

A draft enters review when:

- a mapped document proposal is first persisted by `POST /api/drafts`;
- document classification confidence is low;
- field extraction confidence is low;
- entity resolution has multiple plausible candidates;
- validation reports blocking errors;
- validation reports overridable warnings;
- metadata snapshot changed after mapping;
- tenant policy requires manual approval;
- write strategy is risky or unavailable.

A document enters the exception queue before draft review when:

- OCR fails or must be retried;
- document type is unsupported;
- document-level or field-level confidence is too low for draft creation;
- counterparty or nomenclature matching is ambiguous or missing;
- unit conversion is missing or unsafe;
- VAT, totals, or validation checks block normal processing;
- published 1C metadata is incomplete;
- tenant policy blocks automation.

The exception queue is not approval and not write planning. It is a triage state that explains why automation stopped and what a human or administrator should do next.

## Review Screen Requirements

The review UI should show:

- source document preview;
- extracted fields;
- source page and coordinates where available;
- proposed 1C object and field mapping;
- resolved entity candidates;
- confidence score and reasons;
- validation messages;
- alternatives;
- correction controls;
- approval and rejection actions;
- write strategy preview.

The UI must not expose secrets, tokens, raw internal diagnostics, or unrelated tenant data.

## Decision Types

Supported decisions:

- approve draft;
- reject draft;
- correct extracted field;
- select entity candidate;
- create manual mapping;
- override warning;
- request metadata rescan;
- create export package instead of automatic write;
- cancel draft.

Every decision must create an audit event.

## Approval Policy

Approval can be:

- manual;
- policy-based for high-confidence low-risk drafts;
- blocked by validation;
- blocked by tenant policy;
- blocked by stale metadata snapshot.

Automatic approval must require:

- high confidence;
- no blocking validation errors;
- current metadata snapshot;
- safe write strategy;
- tenant policy allowance;
- idempotency key.

Draft creation is not approval. The draft creation endpoint must always leave the draft in `needs_review` with `approvalStatus: "pending"` and `writeStatus: "not_requested"`. Write planning may only happen after an explicit approval transition records who approved the draft, why it was eligible, and which validation result was current.

## Correction Learning

Corrections should capture:

- original extracted value;
- corrected value;
- rejected candidates;
- selected candidate;
- user id;
- draft id;
- metadata snapshot id;
- reason when provided.

Corrections improve future mapping and resolution, but they do not rewrite historical audit events.

## Write Preview

Before approval, show:

- target 1C document/object;
- write strategy;
- required fields;
- fields that will be written;
- fields that require manual handling;
- possible side effects;
- fallback option if automatic write fails.

## Failure States

If review cannot proceed:

- show actionable validation errors;
- allow metadata rescan when schema drift is suspected;
- allow export package generation when auto-write is unsafe;
- keep draft state recoverable;
- do not hide uncertainty.

If a document is routed to the exception queue:

- show the selected category and queue name;
- show the top signal and compact supporting signals;
- show suggested actions;
- keep the document recoverable for retry, manual processing, or later draft creation;
- do not include raw OCR text, raw documents, credentials, or internal diagnostics in the exception record.

## Audit Requirements

Audit events must distinguish:

- AI suggestion;
- validation result;
- document exception queued;
- human correction;
- policy approval;
- manual approval;
- warning override;
- write command creation;
- write result.
