# Engineering Guides

These documents serve as project skills for Codex and the development team. Their purpose is to keep architectural boundaries, security guardrails, and production best practices close to the codebase.

## How to Use

- For product context, read [context.md](/Users/vital/Documents/automator/docs/context.md).
- For architectural and system-level decisions, read [architecture.md](/Users/vital/Documents/automator/docs/architecture.md) and [domain-model.md](/Users/vital/Documents/automator/docs/domain-model.md).
- For desktop agent specifications, read [tauri-rust-agent.md](/Users/vital/Documents/automator/docs/tauri-rust-agent.md), [rust-system.md](/Users/vital/Documents/automator/docs/rust-system.md), and [auth-native-app.md](/Users/vital/Documents/automator/docs/auth-native-app.md).
- For 1C integration protocols, read [1c-integration.md](/Users/vital/Documents/automator/docs/1c-integration.md) and [agent-command-bus.md](/Users/vital/Documents/automator/docs/agent-command-bus.md).
- For backend guidelines, read [backend-nestjs.md](/Users/vital/Documents/automator/docs/backend-nestjs.md), [api-contracts.md](/Users/vital/Documents/automator/docs/api-contracts.md), [jobs-queues.md](/Users/vital/Documents/automator/docs/jobs-queues.md), and [persistence-migrations.md](/Users/vital/Documents/automator/docs/persistence-migrations.md).
- For OCR and AI capabilities, read [ai-recognition-agents.md](/Users/vital/Documents/automator/docs/ai-recognition-agents.md), [ai-ocr-mapping.md](/Users/vital/Documents/automator/docs/ai-ocr-mapping.md), and [entity-resolution.md](/Users/vital/Documents/automator/docs/entity-resolution.md). The recognition guide is the canonical product/technical spec for the 70-80% no-programmer configuration coverage target.
- For accountant review and approval flows, read [review-workflow.md](/Users/vital/Documents/automator/docs/review-workflow.md).
- For production readiness standards, read [security.md](/Users/vital/Documents/automator/docs/security.md), [data-governance.md](/Users/vital/Documents/automator/docs/data-governance.md), [testing.md](/Users/vital/Documents/automator/docs/testing.md), [observability.md](/Users/vital/Documents/automator/docs/observability.md), and [deployment-release.md](/Users/vital/Documents/automator/docs/deployment-release.md).
- For module-specific hardening reviews, read files under [reviews/](/Users/vital/Documents/automator/docs/reviews).
- For strict constraints, read [forbidden-actions.md](/Users/vital/Documents/automator/docs/forbidden-actions.md) before making any high-risk changes.
- For external source alignment, read [references.md](/Users/vital/Documents/automator/docs/references.md).

## Guide Evaluation

The provided guides are crucial for maintaining the integrity of this architecture. They address and mitigate various failure modes:

- Mixing UI, agent, and backend responsibilities.
- Overly trustful automated AI writes into 1C.
- Unsecure secret and credentials storage.
- Unreliable message queues lacking idempotency keys.
- Unmanaged desktop agent updates.
- Weak diagnostic and tracing capabilities for production incidents.
- AI code generation that overreaches or introduces redundant code.

## Current Coverage Gaps Closed

The documentation set now includes dedicated guides for repository context, domain entities, API contract rules, persistence and migrations, data governance, review workflow, and the backend-to-agent command boundary. These were the main missing files for this architecture because they define how decisions move from the platform to the local 1C executor without bypassing drafts, validation, approval, idempotency, data policy, or audit.
