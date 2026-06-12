# ADR 0001: Monorepo Boundaries

## Status

Accepted.

## Context

The product has a local desktop-agent, backend API, background workers, shared contracts, and local development infrastructure. Splitting this into separate repositories too early would slow down contract evolution and make pilot changes harder to coordinate.

## Decision

Use a `pnpm` monorepo with:

- `apps/desktop` for Tauri + Rust + React.
- `apps/api` for NestJS.
- `apps/worker` for BullMQ workers.
- `packages/contracts` for shared TypeScript contracts.
- `infra` for local infrastructure.
- `docs` for architecture and ADRs.

Rust code remains inside the Tauri application for now. A separate Rust workspace package can be extracted when multiple Rust binaries or libraries need to share code.

## Consequences

- Contract changes can land atomically with API and desktop changes.
- The first lockfile will cover all TypeScript packages.
- CI must understand both Node and Rust toolchains.
- Ownership boundaries must be enforced by folder structure and review discipline.

