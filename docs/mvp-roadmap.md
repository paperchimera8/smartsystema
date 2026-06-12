# MVP Roadmap

## Sprint Schedule

### Sprint 0: Foundation
- Confirm 1C target versions and configurations for the pilot.
- Finalize threat model and tenant data policy.
- Install workspace dependencies and generate first lockfile.
- Add CI with typecheck, Rust checks, and desktop build smoke tests.

### Sprint 1: Agent And API Skeleton
- Implement desktop enrollment flow.
- Add OIDC/PKCE auth surface.
- Persist local agent identity and secure secrets.
- Add agent heartbeat API.

### Sprint 2: Metadata Discovery
- Implement OData connection profiles.
- Read and normalize metadata snapshots.
- Store schema snapshots in Postgres.
- Add schema diff endpoint.

### Sprint 3: Local Queue And Uploads
- Add SQLCipher-backed local outbox/inbox.
- Add document upload API and signed object storage flow.
- Add BullMQ job creation.

### Sprint 4: OCR And Mapping
- Add OCR provider abstraction.
- Implement local/open-source OCR path first.
- Add entity resolver and confidence scoring.

### Sprint 5: Draft Validation
- Add draft state machine.
- Add human review API and admin UI surface.
- Validate mandatory fields and idempotency behavior.

### Sprint 6: EPF Runner
- Harden `.epf` runner assumptions against pilot environments.
- Add controlled thin-client launch path.
- Document unsupported cross-version behavior.

### Sprint 7: Hardening
- Add updater channel model.
- Add signing/notarization plan.
- Add telemetry, redaction, and pilot diagnostics.

---

## Team Composition (MVP Build)

Building this platform requires a cohesive, mixed product-integration team rather than a generalist pool. Below is the hiring and staffing priority roadmap:

1. **Tech Lead / Staff Architect (Critical - Sprint 0):** Glues together the desktop agent, backend APIs, 1C integrations, and core security frameworks.
2. **Senior Rust / Windows Engineer (Critical - Sprint 0):** Responsible for the Windows COM layer, local background services, OS keyrings, secure storage, and desktop packaging.
3. **Senior NestJS / Backend Engineer (Critical - Sprint 0):** Handles core APIs, BullMQ workers, authentication pipelines, and Postgres/Redis orchestration.
4. **Senior 1C Analyst / Integration Specialist (Critical - Sprint 0):** Essential to prevent product-fit failures on mapping schemas, document validations, and 1C business processes.
5. **Applied AI / OCR Engineer (High Priority - Sprint 1):** Develops the OCR ingestion pipelines, layout analysis models, entity resolvers, and confidence calibration.
6. **React / Admin UI Engineer (Medium Priority - Sprint 1-2):** Designs the operations console, human-in-the-loop review screens, and desktop agent onboarding flows.
7. **QA Automation Engineer (High Priority - Sprint 2):** Covers regression tests for both the desktop app and backend API workflows.
8. **DevOps / SRE Engineer (High Priority - Sprint 1-2):** Sets up matrix build pipelines, code signing and notarization automation, telemetry collection, and runner setups.
9. **Fractional Security & Compliance Advisor (Medium Priority - Sprint 2):** Ensures compliance with GDPR (Art. 28/32) and RU data localization rules (152-FZ, 242-FZ).

---

## Team Training Program (4 Blocks of 2 Weeks)

The training of the team should be structured in explicit 2-week blocks to mitigate learning curves systematically:

*   **Block 1: Rust Async, Tauri, & OS Integration (Weeks 1-2)**
    *   Topics: Tokio runtime, async/sync thread boundaries, Tauri commands & IPC, OS keyrings (keyring crate), TLS certificate handling, updater manifest setup, signed GHA matrix builds.
*   **Block 2: NestJS Production Baseline (Weeks 3-4)**
    *   Topics: Passport & JWT setups, BullMQ queue events, class-validator/class-transformer pipelines, NestJS ConfigModule, global filters, OpenAPI/Swagger schemas, Terminus health checks.
*   **Block 3: 1C Integration Lab (Weeks 5-6)**
    *   Topics: 1C OData endpoints & EDMX XML schema processing, external data processor (.epf) execution model, thin client command-line arguments (1cv8c.exe), Windows COM dynamic dispatch (IDispatch, windows/win-idispatch crates).
*   **Block 4: OCR & LLM Safety Loop (Weeks 7-8)**
    *   Topics: Layout extraction strategies, vector search with Postgres/pgvector, fuzzy-matching algorithms, confidence score calibration, human-in-the-loop validation, correction storage.
