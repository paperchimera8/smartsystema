# Automator

Automator is a B2B integration platform for connecting 1C installations to document intake, OCR/AI-assisted mapping, validation, draft creation, and controlled write-back flows.

The project is intentionally split into two execution contours:

- **Local desktop-agent**: a Tauri + Rust + React application installed near the customer 1C environment. It owns local integration paths, secrets, local queueing, helper processes, and desktop diagnostics.
- **Platform backend**: a TypeScript + NestJS control plane for auth, tenants, agent enrollment, OCR/AI orchestration, draft/validation workflows, storage, telemetry, and admin APIs.

## MVP Guardrails

- Windows-first for the deepest 1C coverage.
- OData and external processing (`.epf`) are the primary integration paths.
- Thin-client automation and Windows COM are isolated fallback paths.
- AI assists mapping and entity resolution, but final writes remain policy-driven and validation-first.
- Offline mode is modeled as durable local outbox/inbox state, not as a best-effort cache.
- Cloud OCR/LLM use must be controlled by explicit tenant policy.

## Repository Layout

```text
apps/
  api/          NestJS control plane API.
  desktop/      Tauri desktop-agent with Rust core and React UI.
  worker/       BullMQ worker process for OCR, mapping, and draft jobs.
packages/
  contracts/    Shared TypeScript contracts between apps.
infra/          Local development infrastructure.
docs/           Architecture, security notes, ADRs, and roadmap.
scripts/        Operational scripts added as the project matures.
```

## Development Bootstrap

This repository is scaffolded as a `pnpm` workspace. After dependencies are installed, the expected workflow is:

```bash
pnpm install
pnpm typecheck
pnpm dev
```

Local infrastructure for platform development lives in [infra/docker-compose.yml](/Users/vital/Documents/automator/infra/docker-compose.yml).

