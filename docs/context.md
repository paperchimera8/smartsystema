# Product Context

This document is the high-level context file for Automator. Read it before making architectural, domain, integration, or security-sensitive changes.

## What Automator Is

Automator is a B2B platform that helps accountants and operations teams process incoming business documents and safely load the resulting drafts into 1C.

It supports documents such as:

- PDF invoices and acts;
- scanned documents;
- photos;
- Excel files;
- EDI payloads;
- mixed document batches.

The product combines OCR, AI-assisted mapping, entity resolution, validation, human review, and controlled write execution through a local desktop agent.

## Target Users

- Accountants who review and approve documents.
- Operators who manage document intake and integration status.
- Administrators who configure tenants, users, agents, and policies.
- Implementation specialists who validate 1C-specific mappings during pilots.
- Support engineers who diagnose agent, OCR, validation, and write failures.

## Core Product Promise

Automator should cover roughly **70-80% of typical and moderately customized document-to-1C configurations without requiring a 1C programmer or integrator for every setup**, while remaining honest about edge cases.

The realistic promise is:

```text
Predictable coverage for common and moderately customized workflows,
automatic metadata discovery,
evidence-based mapping,
safe drafts,
human-in-the-loop review,
learning from accountant corrections,
and graceful fallback when automatic writing is unsafe.
```

The product must not promise universal support for every customized 1C configuration without pilot hardening. The detailed design for this coverage target lives in [ai-recognition-agents.md](/Users/vital/Documents/automator/docs/ai-recognition-agents.md).

## Main Components

### Desktop Agent

The local Tauri + Rust + React agent is installed near the customer's 1C environment. It handles local capabilities that the backend cannot safely or reliably perform remotely:

- 1C metadata scanning;
- local credentials and keyring access;
- OData/HTTP connectivity checks;
- external data processor execution;
- thin-client runner workflows;
- Windows COM fallback;
- local export package generation;
- offline-safe command queue;
- diagnostics and update status.

The agent is a bridge and executor, not the product brain.

### Backend Platform

The TypeScript + NestJS backend is the control plane and decision engine:

- users and tenants;
- agent enrollment;
- document intake;
- OCR and AI orchestration;
- metadata registry;
- draft workflow;
- validation;
- approval;
- adaptive write orchestration;
- audit log;
- learning feedback.

### Worker Layer

Workers execute long-running and retryable jobs:

- OCR extraction;
- document classification;
- AI mapping;
- entity resolution;
- validation;
- write orchestration;
- correction learning.

### Shared Contracts

Shared contracts define stable payloads between backend, worker, and desktop code. They should be conservative, versionable, and JSON-compatible.

## Product Invariants

- AI never writes directly to 1C.
- Backend never writes directly to 1C.
- Desktop Agent only executes explicit backend commands.
- Every write must be tied to a draft, validation report, approval decision, metadata snapshot, and idempotency key.
- Raw documents and OCR artifacts are sensitive data.
- Tenant policy controls cloud OCR/LLM usage.
- Audit logs distinguish AI suggestions, validation results, user corrections, approvals, commands, and write results.

## Primary Data Flow

```text
User uploads document
  -> backend stores original document
  -> backend enqueues processing job
  -> worker runs OCR/parser
  -> worker classifies document type
  -> worker maps extracted fields to 1C metadata
  -> resolver finds counterparties, contracts, nomenclature, warehouses
  -> confidence engine scores decisions
  -> backend creates draft
  -> validation engine checks safety and completeness
  -> accountant reviews low-confidence fields
  -> backend creates write command
  -> desktop agent executes command through selected 1C path
  -> backend records result and audit events
  -> corrections feed future matching rules
```

## Graceful Degradation

When automation is unsafe or unavailable, the system should degrade to:

- human review;
- manual entity selection;
- export package generation;
- request for a new metadata scan;
- pilot-hardening requirement for a specific 1C configuration.

It should not silently perform partial writes or hide uncertainty.

## Non-Goals

- Direct SQL writes into 1C database tables.
- Fully autonomous AI posting without validation and approval.
- Universal support for every customized 1C installation without pilot validation.
- Storing 1C credentials in frontend code.
- Treating desktop UI as a business decision engine.
- Treating queue payloads as the system of record.
