# Entity Resolution Guide

The Entity Resolver matches extracted text labels from ingested documents with actual, structured entities inside the 1C database: counterparties (suppliers/clients), contracts, nomenclature (inventory/items), warehouses, and accounting ledger codes.

## Output Contract Schema

The Entity Resolver must return a list of matching candidates in a structured, observable format:

```text
entityType (counterparty, contract, nomenclature, warehouse, account)
candidateId
displayName
score (0.00 - 1.00)
matchReasons (array of strings explaining match signals)
warnings (array of potential mismatch warnings)
requiresReview (boolean)
```

**Never return a single database reference without transparent, matching criteria and candidate alternatives.**

## Counterparty Resolution

To resolve counterparties securely, the engine evaluates the following prioritized signals:

1. Exact matching on unique tax identifiers (INN).
2. Exact matching on INN + KPP identifiers.
3. Matching on registered Electronic Data Interchange (EDI) identifiers.
4. Exact match on bank account details (IBAN / Account Number).
5. Supplier transaction history patterns.
6. Normalized fuzzy legal name matching.
7. Address, telephone, or email matching.
8. Semantic embedding vector similarity.

**CRITICAL:** If an extracted INN matches a candidate but the associated legal name differs significantly, the resolver must raise a severe validation warning.

### MVP Counterparty Fuzzy Resolver

The first counterparty resolver is a pure TypeScript worker module. It receives extracted supplier data and a provided list of 1C counterparty candidates. It does not query a database, create counterparties, approve drafts, or write to 1C.

MVP signals:

- Exact `INN + KPP` match.
- Exact `INN` match.
- Normalized legal-name fuzzy matching.
- Identifier conflict detection.

Default scoring:

- Exact `INN + KPP`: `0.98`.
- Exact `INN`: `0.90`.
- Name-only fuzzy score is capped at `0.82`.
- Identifier mismatch caps candidate score at `0.40`.
- Top candidate is review-free only when score is at least `0.92` and no severe warnings exist.
- Runtime options may only make the resolver stricter: auto-accept threshold cannot be lowered below `0.92`, name-only score cap cannot be raised above `0.82`, and identifier mismatch cap cannot be raised above `0.40`.

Normalization rules:

- Keep raw extracted values separate from normalized values.
- Normalize INN and KPP by keeping digits only.
- Treat INN as valid only when it has 10 or 12 digits after normalization.
- Treat KPP as valid only when it has 9 digits after normalization.
- Normalize legal names by lowercasing, collapsing whitespace, removing punctuation and quotes, and stripping common legal forms such as `ooo`, `llc`, `ao`, `pao`, `zao`, `jsc`, and `ip`.
- Use deterministic trigram Dice similarity for legal-name scoring.

Safety rules:

- Exact identifiers dominate fuzzy names.
- Fuzzy name matching must never override an active INN conflict.
- Exact INN with very low legal-name similarity must require review with a severe warning.
- Every result must return ranked candidates with scores, signals, warnings, and `requiresReview`.
- Empty candidate lists and severe identifier conflicts require review.
- The resolver is advisory and cannot approve or execute write commands.

## Contract Resolution

To resolve contracts securely, the engine evaluates:

- Active counterparty associations (`counterpartyId`).
- Contract number similarity.
- Contract signature and start dates.
-Mismatched client organizations.
- Compatibility of contract currency definitions.
- Historic transactional records.
- Agreement activity status (verifying if dates fall within active periods).
- Compatibility of the contract type with the transaction document type.

If a contract cannot be resolved with high confidence, the Draft must be flagged as `needs_review` and locked.

## Nomenclature (Inventory) Resolution

To match item descriptions with the 1C nomenclature catalog, the engine evaluates:

- Exact matching on vendor codes, SKU, or manufacturer parts.
- Barcode match.
- Historic nomenclature associations for this specific supplier.
- Normalized fuzzy string distance matching on product names.
- Units of measure compatibility (e.g., kg, units, liters).
- Historical pricing brackets.
- Tax and VAT categories.
- Semantic embedding similarity ratings.

**CRITICAL:** The resolver must recognize that identical product names from different suppliers may map to completely different inventory SKU records in 1C.

### MVP Nomenclature Fuzzy Resolver

The first nomenclature resolver is a pure TypeScript worker module. It receives one extracted document line item and a provided list of 1C nomenclature candidates. It does not query a database, call an LLM, create nomenclature records, approve drafts, or write to 1C.

MVP signals:

- Exact barcode match.
- Exact supplier-specific item code match for the extracted supplier context.
- Exact vendor code match.
- Exact SKU match.
- Normalized product-name fuzzy matching.
- Unit compatibility or unit mismatch.

Default scoring:

- Exact barcode: `0.99`.
- Exact supplier-specific item code: `0.96`.
- Exact vendor code or SKU: `0.94`.
- Name-only fuzzy score is capped at `0.82`.
- Unit mismatch caps candidate score at `0.65` and always requires review.
- Top candidate is review-free only when score is at least `0.90` and no severe warnings exist.
- Runtime options may only make the resolver stricter: auto-accept threshold cannot be lowered below `0.90`, name-only score cap cannot be raised above `0.82`, and unit mismatch score cap cannot be raised above `0.65`.

Normalization rules:

- Keep raw extracted values separate from normalized values.
- Normalize product names by lowercasing, collapsing whitespace, removing punctuation and quotes, splitting compact number/unit tokens, and normalizing common unit words such as `kilogram`, `liter`, `piece`, and `service`.
- Normalize vendor codes, SKU values, barcodes, and supplier-specific item codes by trimming, uppercasing, and removing separator noise.
- Normalize barcodes as digits only and accept exact barcode matches only for common GTIN/UPC/EAN lengths: 8, 12, 13, or 14 digits.
- Use deterministic trigram Dice similarity for product-name scoring.

Safety rules:

- Exact product identifiers dominate fuzzy product names.
- Unit mismatch is safety-critical and must force review even when barcode, vendor code, SKU, or supplier code matched.
- Supplier context is optional and cannot be the only reason for automatic acceptance. A supplier-specific code match without compatible unit, generic identifier, or reasonable product-name support must require review.
- Every result must return ranked candidates with scores, signals, warnings, and `requiresReview`.
- Empty candidate lists require review.
- The resolver is advisory and cannot approve, create, or execute write commands.

## Warehouse Resolution

To resolve delivery warehouses, the engine evaluates:

- Organization ownership rules.
- Delivery and shipping address coordinates.
- Default historic warehouses assigned to specific supplier accounts.
- Document and transaction types.
- Tenant-specific default storage rules.
- Explicit warehouse fields present in the document.

If the selected warehouse impacts tax or accounting ledger assignments, any confidence drops must block automated writes.

## String Normalization and Fuzzy Matching

- Prior to fuzzy calculation, normalize inputs: convert to lowercase, strip whitespaces and quotes, and normalize legal forms such as LLC, OOO, JSC, and CJSC.
- Keep the raw, unmodified string separate from the normalized search terms.
- A fuzzy name matching score must never override an active unique key conflict (e.g., mismatched INNs).
- Ensure fuzzy matching thresholds are configurable at the tenant and organization levels.

## Semantic Vector Database (pgvector)

We utilize the PostgreSQL **pgvector** extension for our semantic search needs:

- **Unified Persistence:** Vector embeddings reside inside our main PostgreSQL database next to domain entities.
- **Transactional Safety:** Benefit from PostgreSQL's native ACID compliance, schema constraints, security row-filters, and Point-in-Time Recovery (PITR) backups.
- **Operational Simplicity:** Eliminates the operational overhead, cost, and complexity of running an independent dedicated vector database cluster during the MVP phase.

**Important:** Vector search scores must serve strictly as an auxiliary signal for financially significant records and must never act as a standalone auto-matching criteria.

## Embedding Ingestion Providers

- **Yandex AI Studio Embeddings:** Highly recommended and configured for Cyrillic (RU) documents and terminology models.
- **OpenAI Embeddings:** Utilized for multilingual, global multi-currency customer deployments.
- **Ollama / vLLM:** Selected for strict, offline self-hosted or on-premise enterprise environments requiring complete local data confinement.

## Unified Confidence Scoring

The final match score must compile and calibrate multiple parameters:
- Presence of exact, unique identifier matches.
- Multi-string fuzzy comparison results.
- Neural vector similarity metrics.
- Supplier and business context histories.
- Recent manual override history.
- Presence of validation warnings or conflicting data signals.

## Learning from Accountant Corrections

Human overrides must be captured as structured, immutable training events:

- Tenant ID.
- Active Metadata Snapshot ID.
- Source Document Type.
- Raw, unmodified extracted value.
- The ID of the entity selected by the user.
- Rejected candidate IDs.
- Creation timestamp.
- User ID.

Learning feedback events must reside in a separate analytical store and must never modify historical transactions or immutable audit logs.

## References

- pgvector extension: https://github.com/pgvector/pgvector
- OpenAI Embeddings: https://developers.openai.com/api/docs/guides/embeddings
- PostgreSQL Trigram matching: https://www.postgresql.org/docs/current/pgtrgm.html
- Yandex Embeddings API: https://aistudio.yandex.ru/docs/ru/ai-studio/concepts/embeddings
- Ollama capabilities: https://docs.ollama.com/capabilities/embeddings
