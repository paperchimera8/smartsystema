# Workspace Context

Last updated: Wednesday, May 27, 2026.

## Current Goal

The repository is being prepared as a production-oriented scaffold for Automator: a Tauri + Rust + React desktop-agent and a TypeScript + NestJS backend platform for safe document-to-1C workflows.

The current documentation goal is to give future coding agents enough context to preserve the core architecture:

```text
AI proposes.
Validation checks.
Accountant or policy approves.
Desktop Agent writes to 1C.
Backend records result, audit, and learning feedback.
```

## Current State

- Root `AGENTS.md` exists and defines repository rules for AI coding agents.
- External Obsidian memory exists at `/Users/vital/Documents/Obsidian Vault/Automator Memory Vault`.
- Memory workflow is mandatory for meaningful work: read `00-hot.md` at session start, write or update a `01-sessions/` note, update `00-hot.md` at session end, and add `02-lessons/` or `03-decisions/` notes when durable knowledge or decisions appear.
- Installed local skills include `.agents/skills/find-skills`, `.agents/skills/rust-best-practices`, `.agents/skills/vercel-react-best-practices`, `.agents/skills/typescript-advanced-types`, `.agents/skills/nestjs-best-practices`, `.agents/skills/playwright-best-practices`, `.agents/skills/bullmq-specialist`, `.agents/skills/nodejs-backend-patterns`, `.agents/skills/tauri-v2`, `.agents/skills/web-design-guidelines`, `.agents/skills/system-design`, `.agents/skills/architecture`, `.agents/skills/api-design-principles`, `.agents/skills/writing-plans`, and `.agents/skills/verification-before-completion`.
- `.agents/skills/tauri-v2` and `.agents/skills/web-design-guidelines` must be manually reviewed before use because their installer security report returned Snyk Med Risk.
- All current repository docs are written in English.
- `docs/context.md` is the product context guide.
- `docs/architecture.md` describes the overall architecture.
- `docs/domain-model.md` defines core entities and ownership.
- `docs/agent-command-bus.md` defines the backend-to-agent execution boundary.
- `docs/api-contracts.md` defines DTO and contract rules.
- `docs/data-governance.md` defines retention, residency, and sensitive data handling.
- `docs/persistence-migrations.md` defines durable state and migration rules.
- `docs/review-workflow.md` defines accountant review and approval behavior.
- `docs/references.md` records official documentation and repository sources used for alignment.

## Important Decisions

- Desktop Agent is a local executor, not the product brain.
- Backend owns orchestration, policy, validation, drafts, audit, and write command creation.
- AI/OCR/mapping is advisory and cannot execute writes.
- 1C writes must go through draft, validation, approval, idempotent command, agent execution, and audit.
- OData and external data processors are preferred integration paths; Windows COM is a fallback only.
- Direct SQL writes into 1C tables are forbidden.
- BullMQ is the MVP queue layer; Temporal can be reconsidered later for durable long-running workflows.
- Files added or modified from now on must be written in English.
- Meaningful Automator work must be recorded in the external Obsidian memory workflow.

## Verification Completed

- Checked docs file inventory.
- Fixed `ai-ocr-mapping.md` naming and references.
- Added missing context, domain, command bus, API contract, data governance, persistence, review workflow, and references guides.
- Updated `docs/README.md`, `docs/structure.md`, and `AGENTS.md`.
- Created external Obsidian memory with ordered sections: `00-hot.md`, `01-sessions/`, `02-lessons/`, `03-decisions/`, `04-inbox/`, and `99-memory-guide.md`.
- Checked internal Markdown links.
- Checked JSON config parsing.
- Checked Docker Compose config.
- Checked Rust formatting.
- Checked TypeScript contracts with `tsc --noEmit -p packages/contracts/tsconfig.json`.

## Recommended Next Work

- Add initial database schema and migrations after choosing the ORM/migration tool.
- Add contract tests around draft, validation, and agent command payloads.
- Add fake 1C metadata fixtures and golden snapshot tests.
- Add local development scripts only after dependency lockfile generation.
