# Deployment & Release Guide

The platform's release pipeline orchestrates simultaneous updates for the self-hosted backend platform and the distributed desktop agent.

## Continuous Integration (CI) Baseline

Every commit must satisfy a rigorous set of verification checks before merging:

- **TypeScript Typecheck:** Strict compilation check across all packages.
- **Unit Testing:** Passes all TypeScript unit tests.
- **Backend E2E Testing:** Passes core API smoke and lifecycle tests.
- **Rust Quality Checks:** Run `cargo fmt --check`, `cargo clippy --all-targets`, and all Rust unit/integration tests.
- **Desktop Frontend Build:** Validates production compilation of the React client.
- **Tauri Build Smoke Test:** Performs a headless compile check of the Tauri workspace.
- **Migration Dry-Run:** Executes database migrations against an ephemeral PostgreSQL instance.
- **Dependency Audit:** Checks for vulnerabilities and licensing changes across both Cargo and NPM lockfiles.

## GitHub Actions Matrix Strategy

Desktop agents are compiled and packaged using a multi-platform GitHub Actions runner matrix:

```yaml
matrix:
  os: [windows-latest, macos-latest]
```

- Matrix runs package distribution binaries specifically compiled for each Operating System.
- Retain separate build artifact channels indexed by release channel, platform, and application version.
- **macOS Notarization Requirement:** Compilation, signing, and notarization of the macOS agent require native `macos-latest` GHA runners.

## Tauri Build Procedures

- Desktop compilation must execute via repeatable, fully scripted pipelines.
- The compiled application version must match the release tag and target channel policy.
- All binary distributions must be digitally signed before they are published to release servers.
- Isolate and store debug and crash symbols (e.g., PDBs on Windows, dSYMs on macOS) in a private, secure engineering archive. Never include debug symbols in the public release assets.

## Windows Desktop Artifact

The repository provides `.github/workflows/windows-desktop.yml` for building the Windows desktop-agent installer on `windows-latest`.

Use cases:

- Manual preview build: run **Windows Desktop Agent Build** from GitHub Actions with `workflow_dispatch`.
- Tagged build: push a tag matching `desktop-v*`.

Distribution rules:

- The public Windows artifact must be an installer, not a portable ZIP.
- The default installer format is the NSIS `.exe` installer.
- The installed application binary must be named `SmartSistema.exe`.
- The installer artifact uploaded by GitHub Actions must be named `SmartSistema-Setup-<version>-<channel>-<run>.exe`.
- The Tauri product name, window title, bundle publisher, and Start Menu folder must use `SmartSistema`.
- Raw release executables from `target/release` must not be uploaded as public distribution artifacts.
- Unsigned preview or pilot installers are for internal testing only and must not be linked from the public landing page.

The workflow:

- installs Node.js, pnpm, Rust `1.88.0`, and NSIS;
- runs workspace typecheck and tests;
- validates the optional desktop API base URL used by the packaged frontend;
- builds the Tauri desktop agent with the NSIS bundle target;
- verifies that the Windows application binary is `SmartSistema.exe`;
- stages exactly one NSIS installer under `dist/windows-installer`;
- uploads the generated Windows `.exe` installer as a GitHub Actions artifact;
- records the installer SHA-256 hash in the workflow summary.

Manual preview build inputs:

- `api_base_url`: optional backend API base URL to bake into the desktop frontend, for example `https://api.smartsystema.online/api`, `https://office.example.com/api`, or `http://127.0.0.1:8080/api`. The value must be an absolute `http` or `https` URL without embedded credentials or secret-like query parameters. HTTP is allowed only for `localhost` or `127.0.0.1`; server and LAN deployments must use HTTPS.
- `release_channel`: artifact label, one of `preview`, `pilot`, or `stable`.
- `allow_unsigned_preview`: allows an unsigned preview or pilot installer for internal testing. Stable releases ignore this bypass and require signing.

If `api_base_url` is omitted, the workflow falls back to the repository variable `AUTOMATOR_DESKTOP_API_BASE_URL`, then to the SmartSistema cloud API at `https://api.smartsystema.online/api`.

The backend that serves native browser authentication must be configured with:

```text
AUTH_NATIVE_RETURN_URL=automator://auth-complete
```

The desktop agent still polls the backend for native auth completion, so the custom return URL is an ergonomics and focus aid rather than a secret transport.

The preview artifact is unsigned until the Windows signing pipeline is configured. Unsigned preview builds are acceptable for internal testing only and can trigger Windows SmartScreen warnings.

Stable Windows releases are blocked by the workflow unless signing is configured through one of these CI secrets:

```text
TAURI_WINDOWS_SIGN_COMMAND=<custom signing command for the installer/binary path>
TAURI_WINDOWS_CERTIFICATE_THUMBPRINT=<certificate thumbprint available on the Windows runner>
```

`TAURI_WINDOWS_SIGN_COMMAND` is the preferred integration point for cloud or HSM-backed signing. It must not contain secret material directly; it should call a signing tool that retrieves credentials from the CI secret store or the signing provider. The command must be reviewed before enabling stable releases.

## Windows Code Signing (SignTool)

- All Windows executables, installers, and DLLs must be signed using Microsoft **SignTool** or an approved cloud-based signing key vault.
- Every signature must include a verifiable cryptographic timestamp.
- Signing certificates and private keys must never reside in the code repository. Access them securely via CI secrets or HSM integrations.
- Any modifications to the Windows code-signing pipeline are considered highly sensitive and require explicit security review.
- Windows SmartScreen reputation cannot be fully solved by packaging alone. A normal installer reduces distribution friction, but public releases still require Authenticode signing with a trusted publisher certificate and reputation built over time. EV certificates or Microsoft Trusted Signing can reduce early warnings compared with unsigned builds.
- Do not publish unsigned ZIP, portable EXE, or unsigned installer links on `smartsystema.online`.

## macOS Code Signing & Notarization

- **Developer ID Signing:** All macOS application bundles must be signed using an official Apple Developer ID Application certificate.
- **Notarization:** To bypass Apple Gatekeeper warnings, the compiled application must be uploaded to Apple's notarization service using `notarytool`.
- **Stapling:** Once notarization succeeds, staple the notarization ticket to the distribution DMG or zip package using `xcrun stapler`.
- Store Apple Developer credentials, private keys, and API tokens securely inside CI secrets.

## Auto-Updater Distribution

The auto-updater distributes updates across multiple progressive channels:

- **MVP Static Update Feed:** Desktop clients poll a static JSON update manifest hosted on secure, public S3-compatible buckets or GitHub Releases. This approach drastically minimizes operational overhead during the early pilot phase.
- **Dynamic Update Server (Phase 2):** Introduce an intelligent, dynamic update endpoint to enforce rollout policies based on specific tenants, channels, and progressive deployment rings.
- **Release Channels:**
  - `dev`: Internal developer builds.
  - `pilot`: Selected client groups participating in early pilot feedback.
  - `stable`: General production-ready releases.
- The updater system must support immediate pausing and rolling back of updates if critical regressions are discovered.
- The auto-update JSON manifest file must be signed and verified by the desktop agent to prevent hijacking.

## Backend Deployment & Database Migrations

- Production/self-hosted API deployments must set `API_CORS_ORIGINS`, `AUTH_JWT_SECRET`, and `DATABASE_URL`.
- `API_CORS_ORIGINS` must be an explicit comma-separated allowlist. Wildcard origins and credential-bearing origins are rejected.
- Swagger is disabled by default in production unless `API_SWAGGER_ENABLED=true` is explicitly set.
- `Access-Control-Allow-Private-Network` is enabled only outside production or when `API_ALLOW_PRIVATE_NETWORK_CORS=true` is explicitly set.
- Database schema migrations must run in a decoupled, monitored environment prior to API container startups.
- Destructive schema migrations (such as dropping tables or columns) are prohibited on production clusters without explicit owner review and a formal rollback plan.
- Background worker deployments must protect active processing queues. Implement graceful shutdowns to allow workers to complete jobs in-flight before the container is replaced.
- Prefer backward-compatible API contract modifications (e.g., optional parameters or new fields) over breaking REST schema changes.

## GitHub-To-VPS Deployment

The repository provides `.github/workflows/deploy-vps.yml` for automatic cloud deployment on every push to `main`.

The workflow:

- installs Node.js and pnpm;
- installs workspace dependencies from `pnpm-lock.yaml`;
- runs workspace typecheck and tests;
- builds contracts, API, worker, and the desktop web bundle;
- uploads the repository to the VPS over SSH with `rsync`;
- runs `scripts/deploy-vps.sh` on the VPS;
- restarts `automator-api`, `automator-worker`, and reloads Caddy;
- verifies the local API health endpoint before marking the deploy successful.

Required GitHub repository secrets:

```text
VPS_HOST=159.194.236.26
VPS_USER=root
VPS_SSH_KEY=<private SSH key allowed on the VPS>
VPS_KNOWN_HOSTS=<ssh-keyscan output or pinned host key line>
VPS_DEPLOY_DIR=/opt/automator
SENTRY_DSN=<server-side Sentry DSN, optional>
VITE_SENTRY_DSN=<desktop/browser Sentry DSN, optional>
```

Optional GitHub repository variables:

```text
SENTRY_TRACES_SAMPLE_RATE=0.1
VITE_SENTRY_TRACES_SAMPLE_RATE=0.1
```

The workflow never stores database passwords, JWT secrets, Sentry DSNs, or SSH private keys in source files. Runtime secrets remain in the VPS environment file and GitHub repository secrets.

The VPS must already have:

- Caddy installed and configured;
- `automator-api.service` and `automator-worker.service`;
- Redis reachable by the worker;
- managed PostgreSQL reachable by the API;
- the public deployment SSH key installed in the target user account.

## Rapid Rollback Operations

The engineering team must maintain documented, tested rollback strategies for all components:

- **Backend APIs:** Immediate container image rollback to the last known stable tag.
- **Background Workers:** Worker image rollback paired with queue processing pause triggers.
- **Database Migrations:** Backward-compatible rollback migrations designed to run without data loss.
- **Desktop Releases:** Revoking a published version by updating the signed auto-update JSON manifest to point back to the previous stable binary version.

## References

- GitHub Actions Matrix: https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/run-job-variations
- Tauri GitHub Release Pipeline: https://v2.tauri.app/distribute/pipelines/github/
- tauri-action GitHub integration: https://github.com/tauri-apps/tauri-action
- Tauri Auto-Updater: https://v2.tauri.app/plugin/updater/
- Microsoft SignTool: https://learn.microsoft.com/en-us/dotnet/framework/tools/signtool-exe
- Apple Notarization: https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution
