# Module 1 EPF Preflight Production Readiness Review

Date: 2026-05-28

## Scope

Reviewed Module 1, the desktop-agent EPF preflight service:

- `apps/desktop/src-tauri/src/integrations/epf_runner.rs`
- `apps/desktop/src-tauri/src/lib.rs` command registration boundary
- `apps/desktop/src-tauri/Cargo.toml` direct dependency surface

The module remains preflight-only. It does not spawn 1C, does not write to 1C, does not accept credentials, and does not bundle 1C binaries or license material.

## Test Coverage Added

Added Rust tests for:

- EPF path empty, relative, missing, directory, wrong extension, and uppercase extension cases.
- Checksum match, mismatch, missing expected checksum warning, malformed checksum rejection, and SHA-256 normalization invariants.
- Extension comparison invariants that reject suffix tricks such as `.epf.exe`.
- File and server infobase validation, including trimming safe server names.
- Credential-like marker rejection for `Usr=`, `User=`, `Pwd=`, `Password=`, `token=`, `access_token`, `api_key`, `authorization:`, `Bearer`, `secret=`, and URL userinfo.
- Plain server and infobase names not being falsely rejected.
- Serialized preflight reports not exposing absolute executable, EPF, or file-infobase paths.
- Launch plans remaining non-executing with placeholder arguments only.

Property-based testing guidance was applied as deterministic invariant-style tests without adding a new fuzzing dependency. This keeps the first module's supply-chain surface unchanged.

## Security Review Notes

### Insecure Defaults

No fail-open security default was introduced in Module 1. The preflight fails closed for invalid paths, malformed checksums, unsupported platforms, unsupported executable names, and credential-like infobase input.

### Sharp Edges

The review expanded credential detection for infobase inputs. The easy path remains the safe path:

- invalid file paths produce failed checks;
- invalid EPF paths skip checksum validation instead of giving a misleading checksum result;
- the launch plan uses placeholders instead of raw paths;
- execution flags are fixed to `false`.

### Secret Scanning

Targeted secret-pattern scanning found only documentation guardrails and test fixtures that intentionally contain fake secret-like markers. The module rejects those markers and verifies they are not serialized into reports.

### Supply Chain

No new dependencies were added. Direct desktop-agent dependencies remain unchanged. `cargo audit` and `cargo deny` are not installed in the workspace, so advisory and license scans were not run locally.

### Semgrep

The Semgrep CLI is not installed in the workspace. A real Semgrep scan was not run. When Semgrep is available, run an approved Rust-focused important-only scan with metrics disabled against `apps/desktop/src-tauri/src/integrations/epf_runner.rs`.

### CodeQL

The CodeQL CLI is not installed in the workspace. A local CodeQL database analysis was not run. The repository should add a future GitHub Actions CodeQL workflow for Rust and JavaScript/TypeScript.

## Verification Evidence

- `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --check` passed.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml epf_runner -- --nocapture` passed: 28 Module 1 tests.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` passed: 54 Rust tests.
- `cargo metadata --manifest-path apps/desktop/src-tauri/Cargo.toml --no-deps --format-version 1` passed.
- `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets --all-features --locked -- -D warnings` failed on pre-existing scaffold dead-code warnings outside Module 1.
- `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets --all-features --locked -- -D warnings -A dead_code` passed.
- Cyrillic scan over repository docs/code in scope found no matches.

## Remaining Follow-Up

- Resolve or intentionally annotate existing scaffold dead code so strict Clippy can pass without `-A dead_code`.
- Install and configure Semgrep and CodeQL in CI for repeatable static analysis.
- Add `cargo audit` or `cargo deny` to the security toolchain before pilot release.
