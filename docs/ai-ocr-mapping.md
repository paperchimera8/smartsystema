# AI OCR Mapping Guide

The AI/OCR layer serves to recognize ingested documents and propose mapping candidates. It is strictly an advisory component and has **zero permission** to execute direct write operations or mutations in 1C.

## Core Ingestion Rule

```text
AI Output -> Draft -> Validation -> Manual/Policy Approval -> Write Command
```

AI algorithms are completely segregated from direct write operations.

## AI Recognition And Agent Capabilities

For the full product and technical specification of the recognition and bounded agentic layer, read [ai-recognition-agents.md](/Users/vital/Documents/automator/docs/ai-recognition-agents.md). That guide is the canonical source for the 70-80% no-programmer configuration coverage target, safety workflow, document understanding contract, semantic mapping, resolver agents, confidence engine, agent tools, public interfaces, and tests.

This file keeps the lower-level OCR, provider, mapping, confidence, and hallucination guardrails that the canonical guide builds on.

## Provider Abstraction Model

The OCR integration layer uses a decoupled adapter design:

```text
Input Document Reference
  -> Ingestion Provider Request
  -> Normalized OCR Artifact Output
  -> Confidence & Quality Metrics
```

The platform supports four categories of Ingestion Providers:

- **Local Open-Source OCR:** Used as the default offline processing option.
- **Regional Cloud OCR:** Configurable cloud-based text extraction.
- **Global Cloud OCR:** High-end document parsing.
- **Self-Hosted Enterprise OCR:** On-premise private processing servers.

**CRITICAL:** The selection of an OCR provider must strictly respect the active `tenantPolicy` and data residency boundaries.

## Inbound Document Parsers

Document parsers must isolate and extract:
- Raw text strings.
- Geometric layout blocks.
- Table structures, rows, and grid coordinates.
- Multi-page structures.
- Coordinate bounding boxes.
- Quality metrics and parser confidence indexes.
- Warnings (blur, skew, occlusion).

Always store the raw, unmodified OCR JSON artifact separately from the extracted business schemas.

## Document Classification

The classifier identifies the transaction type:
- Invoices / Bills.
- Acts of acceptance.
- Universal Transfer Documents (UPD).
- Waybills.
- VAT invoices.
- EDI JSON/XML payloads.
- Unknown/unsupported formats.

If the classification algorithm falls below safety thresholds, the Draft must be flagged as `needs_review` and locked.

## Field Extraction

The field extraction component must output:
- Target business field names.
- Extracted raw string values.
- Mapped data types.
- Source coordinates (page number and bounding box coordinates).
- Confidence scores.
- Value normalization details (e.g., date formats, currency codes).
- Value alternatives.

**Never silently coerce or guess financially critical fields.** This includes:
- Document totals.
- VAT and tax amounts.
- Transaction dates.
- Inn/KPP organization identifiers.

## Semantic Schema Mapping

Semantic mapping bridges extracted document schemas to the retrieved 1C metadata model:
- Mapping document types to corresponding 1C object structures.
- Pairing extracted properties with 1C fields.
- Tracking optional and mandatory status requirements.
- Applying schema translation rules.
- Providing human-readable explanations for mapping choices.

Semantic mapping must always align with a specific `metadataSnapshotId`.

## Entity Resolution

The Entity Resolver links extracted text labels with actual, existing 1C database records:
- Counterparties / Suppliers.
- Active contracts.
- Inventory items (nomenclature).
- Warehouses.
- Client organizations.
- Accounts from the Chart of Accounts.

The resolver must always return a list of top-scored candidates with clear matching metrics, rather than silently committing a single guess.

## Multi-Signal Confidence Engine

Confidence scores must never rely on single, opaque LLM probability predictions. The platform combines multiple signals:

- Raw OCR parser confidence.
- Document classifier confidence.
- Presence of exact unique keys (e.g., INN, bank account numbers).
- Trigram fuzzy-matching scores.
- Text embedding similarity ratings.
- Historic supplier and transaction patterns.
- Active validation warning statuses.
- Record of previous manual corrections.

## Explainability and Transparency

For any low-confidence mapping, the engine must persist:
- The exact business reasons behind the match.
- Evaluated alternative matches.
- The specific document fields that influenced the matching outcome.
- Tripped validation rules.
- Specific, actionable recommendations for the human reviewer.

## Human-in-the-Loop Review

The Review UI must present:
- The extracted document value.
- Visual highlight coordinates on the source document image.
- The recommended mapping candidate.
- Matching confidence indexes.
- Validation messages and rules status.
- Alternative matching options.
- Manual override fields.

All manual corrections must be stored in the database as learning feedback.

## Hallucination Guardrails

AI algorithms are strictly prohibited from:
- Fabricating organization identifiers (INN/KPP).
- Fabricating contract records or reference agreements.
- Fabricating inventory (nomenclature) or warehouse items.
- Suppressing or masking low-confidence scores.
- Modifying numerical amounts without verifiable document evidence.
- Directly dispatching or signing write commands.
- Bypassing the Validation Engine.

## Ingestion Provider Evaluation

As outlined in the technical assessment, use the following provider mapping:

- **Yandex Vision OCR:** Preferred for Cyrillic (RU) contexts. Features highly optimized models for table extractions, handwriting recognition, and multi-page PDF processing with asynchronous execution modes.
- **Google Document AI:** Selected for global multi-language deployments requiring high-end layout analysis and structured field extraction.
- **PaddleOCR:** Recommended as the modern, high-performance open-source option for self-hosted/on-premise installations. Highly optimized for document parsing and structural analysis.
- **Tesseract OCR:** Retained as a basic, lightweight fallback for legacy on-premise deployments.
- **Few-Shot Rules Memory:** The system must start with explicit semantic rules paired with few-shot context matching, rather than autonomous reinforcement learning loops.

## References

- Yandex Vision OCR: https://aistudio.yandex.ru/docs/ru/vision/concepts/ocr/
- Google Document AI: https://cloud.google.com/document-ai/docs
- PaddleOCR: https://www.paddleocr.ai/main/en/index.html
- Tesseract OCR: https://tesseract-ocr.github.io/
- OpenAI Embeddings: https://developers.openai.com/api/docs/guides/embeddings
