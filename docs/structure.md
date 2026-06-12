# Project Structure

```text
apps/api
  src/main.ts
  src/app.module.ts
  src/modules/*

apps/desktop
  src/*
  src-tauri/src/*

apps/worker
  src/main.ts

packages/contracts
  src/index.ts

infra
  docker-compose.yml

docs
  README.md
  context.md
  architecture.md
  1c-integration.md
  agent-command-bus.md
  ai-recognition-agents.md
  ai-ocr-mapping.md
  api-contracts.md
  auth-native-app.md
  backend-nestjs.md
  data-governance.md
  deployment-release.md
  domain-model.md
  entity-resolution.md
  forbidden-actions.md
  jobs-queues.md
  observability.md
  persistence-migrations.md
  references.md
  review-workflow.md
  rust-system.md
  security.md
  tauri-rust-agent.md
  testing.md
  mvp-roadmap.md
  adr/*
  reviews/*
```

## Ownership Boundaries

- Shared runtime-neutral contracts live in `packages/contracts`.
- Desktop-specific system logic stays in Rust under `apps/desktop/src-tauri/src`.
- Desktop React code is presentation and diagnostics only.
- Backend domain modules stay under `apps/api/src/modules`.
- Long-running background execution starts in `apps/worker`.
- Docker, local services, and future deployment manifests live under `infra`.
