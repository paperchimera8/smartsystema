# AGENTS.md

This file provides repository-specific context and operating rules for AI coding agents working on Automator.

## Language Rule

All new and modified repository files must be written in English. This includes documentation, comments, identifiers where practical, commit-oriented notes, examples, and configuration descriptions. User-facing Russian text may be added only when the product requirement explicitly calls for Russian UI copy or Russian document-processing fixtures.

## Project Context

Automator is a B2B document-to-1C integration platform.

Core flow:

```text
Document upload
  -> OCR / parsing
  -> document classification
  -> AI mapping
  -> entity resolution
  -> confidence scoring
  -> draft creation
  -> validation
  -> accountant or policy approval
  -> adaptive write strategy
  -> Desktop Agent execution in 1C
  -> write result, audit log, and correction learning
```

Core invariant:

```text
AI proposes.
Validation checks.
Accountant or policy approves.
Desktop Agent writes to 1C.
Backend records the result and audit trail.
```

AI must never write directly to 1C.

## External Memory

Automator uses an external Obsidian memory vault outside this repository:

```text
/Users/vital/Documents/Obsidian Vault/Automator Memory Vault
```

Use this memory to preserve continuity across sessions without loading the full conversation history.

### Memory Workflow

1. Start of session: read `/Users/vital/Documents/Obsidian Vault/Automator Memory Vault/00-hot.md` before opening older notes.
2. Session note: create or update one note in `/Users/vital/Documents/Obsidian Vault/Automator Memory Vault/01-sessions/` for every meaningful work session.
3. During work: keep the session note focused on user requests, changed files, important assumptions, verification, risks, and follow-up work.
4. Lessons: write a note in `02-lessons/` when a durable implementation lesson, failure pattern, edge case, or operational trap is discovered.
5. Decisions: write a note in `03-decisions/` when an architecture, product, security, data, or workflow decision is made.
6. Inbox: put uncertain candidates in `04-inbox/` when they may become lessons or decisions but need later review.
7. End of session: update the session note and refresh `00-hot.md` with a short 2-3 line summary.
8. Privacy: never store secrets, tokens, credentials, raw customer documents, raw OCR text, or sensitive personal data in memory.

Additional rules:

- Keep memory notes concise, factual, and written in English.
- Do not read the whole memory vault by default; start with `00-hot.md` and open older notes only when needed.
- Do not move this memory vault into the repository.

## Architecture Boundaries

- `apps/desktop`: Tauri + Rust + React desktop agent. It is a secure local executor near 1C, not the product brain.
- `apps/api`: NestJS backend control plane for users, tenants, documents, drafts, validation, agent commands, audit, and policy.
- `apps/worker`: BullMQ workers for OCR, mapping, validation, write orchestration, and learning jobs.
- `packages/contracts`: shared TypeScript contracts and DTO types.
- `infra`: local infrastructure definitions.
- `docs`: architecture, guardrails, operational context, and implementation guides.

## Required Reading By Task

- System-level architecture: `docs/context.md`, `docs/architecture.md`, `docs/domain-model.md`; use `.agents/skills/system-design` and `.agents/skills/architecture` when evaluating major architecture changes.
- Skill discovery: use the installed `.agents/skills/find-skills` skill when evaluating installable skills.
- Desktop-agent work: `docs/tauri-rust-agent.md`, `docs/rust-system.md`, `docs/auth-native-app.md`; `.agents/skills/tauri-v2` is installed but must be manually reviewed before use because its installer reported Snyk Med Risk.
- Rust code review: use the installed `.agents/skills/rust-best-practices` skill when available.
- 1C integration work: `docs/1c-integration.md`, `docs/agent-command-bus.md`.
- Backend work: `docs/backend-nestjs.md`, `docs/api-contracts.md`, `docs/jobs-queues.md`, `docs/persistence-migrations.md`; use `.agents/skills/nestjs-best-practices`, `.agents/skills/typescript-advanced-types`, `.agents/skills/api-design-principles`, `.agents/skills/bullmq-specialist`, and `.agents/skills/nodejs-backend-patterns` where relevant.
- React desktop UI work: use `.agents/skills/vercel-react-best-practices` where relevant. `.agents/skills/web-design-guidelines` is installed but must be manually reviewed before use because its installer reported Snyk Med Risk.
- Playwright and browser automation tests: use `.agents/skills/playwright-best-practices` where relevant.
- OCR, AI, agentic recognition, and matching work: `docs/ai-recognition-agents.md`, `docs/ai-ocr-mapping.md`, `docs/entity-resolution.md`.
- Review and approval workflow: `docs/review-workflow.md`.
- Production readiness: `docs/security.md`, `docs/data-governance.md`, `docs/testing.md`, `docs/observability.md`, `docs/deployment-release.md`.
- Planning larger implementation work: use `.agents/skills/writing-plans` when a written plan is useful.
- Final verification: use `.agents/skills/verification-before-completion` when completing non-trivial implementation or documentation changes.
- Production-readiness review after implementation: use `.agents/skills/differential-review`, `.agents/skills/semgrep`, `.agents/skills/codeql`, `.agents/skills/secret-scanning`, `.agents/skills/supply-chain-risk-auditor`, `.agents/skills/insecure-defaults`, `.agents/skills/sharp-edges`, `.agents/skills/property-based-testing`, `.agents/skills/audit-prep-assistant`, and `.agents/skills/code-maturity-assessor` where relevant. Review skill instructions before use because some installer checks reported elevated risk.
- Hard stop rules: `docs/forbidden-actions.md`.
- External source alignment: `docs/references.md`.

## Installed Local Skills

- `.agents/skills/find-skills`
- `.agents/skills/rust-best-practices`
- `.agents/skills/vercel-react-best-practices`
- `.agents/skills/typescript-advanced-types`
- `.agents/skills/nestjs-best-practices`
- `.agents/skills/playwright-best-practices`
- `.agents/skills/bullmq-specialist`
- `.agents/skills/nodejs-backend-patterns`
- `.agents/skills/tauri-v2` (manual review before use; installer reported Snyk Med Risk)
- `.agents/skills/web-design-guidelines` (manual review before use; installer reported Snyk Med Risk)
- `.agents/skills/system-design`
- `.agents/skills/architecture`
- `.agents/skills/api-design-principles`
- `.agents/skills/writing-plans`
- `.agents/skills/verification-before-completion`
- `.agents/skills/semgrep` (manual review before use; installer reported Snyk Med Risk)
- `.agents/skills/differential-review`
- `.agents/skills/supply-chain-risk-auditor` (manual review before use; installer reported Snyk Med Risk)
- `.agents/skills/insecure-defaults` (manual review before use; installer reported Snyk High Risk)
- `.agents/skills/sharp-edges` (manual review before use; installer reported 1 Socket alert)
- `.agents/skills/property-based-testing` (manual review before use; installer reported Gen High Risk)
- `.agents/skills/audit-prep-assistant`
- `.agents/skills/code-maturity-assessor`
- `.agents/skills/codeql`
- `.agents/skills/secret-scanning`

## Development Commands

Use `pnpm` for the TypeScript monorepo.

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Local infrastructure:

```bash
docker compose -f infra/docker-compose.yml up -d
docker compose -f infra/docker-compose.yml config
```

Rust desktop-agent checks:

```bash
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --check
cargo metadata --manifest-path apps/desktop/src-tauri/Cargo.toml --no-deps --format-version 1
```

Run the narrowest meaningful checks for the files changed. Do not disable tests or weaken validation to make a build pass.

## Coding Rules

- Keep changes scoped to the task.
- Prefer existing patterns and module boundaries.
- Use typed DTOs and typed errors.
- Validate external input at boundaries.
- Model long-running work as jobs, not HTTP request work.
- Use idempotency keys for side-effecting operations.
- Keep React UI out of secret handling and system integration logic.
- Keep Rust system code free of production-path panics.
- Keep Windows-only COM code behind Windows-only modules and conditional compilation.
- Do not introduce broad abstractions before the first concrete use case justifies them.

## Security Rules

- Never write directly to 1C database tables.
- Never bypass draft, validation, and approval before writing to 1C.
- Never let AI create or execute write commands directly.
- Never log raw documents, raw OCR text, secrets, tokens, passwords, private keys, or connection strings.
- Never store 1C credentials in React state or browser storage.
- Never add shell/process execution without an explicit allowlist and Tauri permission scope.
- Never introduce cloud OCR/LLM processing without tenant policy.
- Never change signing, notarization, updater, retention, or destructive migration behavior without explicit instruction.

## Documentation Rules

- Documentation files must be English.
- Add or update docs when changing architecture, module boundaries, security posture, data flow, release process, or integration behavior.
- Keep docs actionable. Prefer concrete rules, state models, commands, and failure handling over broad prose.
- When adding a new guide under `docs/`, update `docs/README.md` and `docs/structure.md`.
- If a guide relies on external behavior, add or update `docs/references.md` with official sources or well-known repository references.

## Verification Before Final Response

Before finishing a task, verify:

- changed JSON/YAML/TOML files parse;
- Rust files are formatted if touched;
- TypeScript contracts typecheck if touched;
- docs links and filenames match;
- no forbidden action was introduced;
- generated or edited files are in English.
