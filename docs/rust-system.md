# Rust System Guide

Rust code in the desktop agent must be production-grade, robust system code, rather than fragile demo glue.

## Asynchronous Runtime

- Use `tokio` for asynchronous IO, HTTP connections, timers, and background tasks.
- Never block the asynchronous tokio runtime with heavy synchronous operations.
- Move long-running synchronous or blocking operations (like heavy cryptography or direct file parsers) to a dedicated thread or execute them within `tokio::task::spawn_blocking`.
- All background tasks and workers must implement explicit cancellation paths and handle graceful shutdown signals.
- Values moved across spawned tasks must satisfy the necessary `Send + Sync + 'static` bounds. Do not hide non-thread-safe state behind erased error types or trait objects.

## Ownership, Borrowing, and Allocation

- Prefer borrowing over cloning: use `&T`, `&str`, and `&[T]` in function parameters unless the callee must take ownership.
- Use owned `String`, `Vec<T>`, and `HashMap<K, V>` only when ownership transfer, mutation, caching, or persistence is required.
- Avoid cloning large values, especially inside loops. If cloning is necessary, do it as late and as locally as possible.
- Use `.cloned()` or `.copied()` intentionally at iterator boundaries instead of ad hoc `map(|value| value.clone())`.
- Small plain-data types that implement `Copy` can be passed by value.
- Avoid needless intermediate allocations. Prefer lazy iterator chains and pass iterators or slices where possible.
- Use `Cow<'_, T>` when an API may accept either borrowed or owned data without forcing allocation.

## Linting and Formatting

- Run `cargo fmt` before committing Rust changes.
- Run Clippy regularly:

  ```bash
  cargo clippy --all-targets --all-features --locked -- -D warnings
  ```

- Pay special attention to:
  - `redundant_clone`;
  - `clone_on_copy`;
  - `needless_collect`;
  - `large_enum_variant`;
  - `manual_ok_or`;
  - `unnecessary_wraps`.
- Do not silence Clippy globally.
- Prefer `#[expect(clippy::lint_name)]` over `#[allow(...)]`, and include a short justification comment.
- Keep imports formatted by rustfmt. Grouping should follow standard Rust order: standard library, external crates, workspace crates, then local `super`/`crate` modules.

## HTTP Communications

- Maintain a single, reusable `reqwest::Client` instance across services to benefit from connection pooling.
- Always configure strict connection and request timeouts.
- Separate network-level retries (transient dropouts) from business-level retries (workflow failures).
- `reqwest` can be configured with a retry-budget pattern for transient network failures.
- Validate all JSON and multipart payloads before sending them over the network.
- **TLS verification must NEVER be disabled in production environments.**
- For corporate deployments with custom private root CAs, use `rustls-platform-verifier` instead of manually loading PEM files. This integrates native OS certificate facilities and enterprise active directory trust stores securely on Windows (CryptoAPI) and macOS (Keychain).

## Dynamic COM Dispatch (Windows Automation)

- **IDispatch Automation Model:** On Windows (`#[cfg(windows)]`), COM integration with 1C should be isolated. Implement Microsoft's dynamic automation sequence:
  1. Call `OleInitialize` on the active thread.
  2. Create the COM object instance (Automation Server or external connection).
  3. Obtain the `IDispatch` interface pointer.
  4. Resolve names using `GetIDsOfNames`.
  5. Invoke methods or access properties via `Invoke`.
- **Boilerplate Reduction:** Use the official `windows` crate for core bindings. To simplify the dynamic dispatch (`IDispatch`) boilerplate, integrate helper crates such as `win-idispatch`.
- Ensure COM modules are excluded from macOS builds entirely via compilation gates.

## System Certificates & Cryptography

- On Windows, system certificate stores must be opened and validated using native APIs. Use the `schannel` crate or invoke `CertOpenSystemStore` / `CertOpenStore` directly via the `windows` crate.
- Enterprise CA deployments are handled natively by using `rustls-platform-verifier`.

## Performance Discipline

- Do not optimize by guesswork. Measure first.
- Benchmark and profile with release builds.
- Use `cargo clippy -- -D clippy::perf` as an early signal, not as a replacement for profiling.
- Use benchmarks for hot code paths such as metadata parsing, schema diffing, local queue scanning, and resolver logic.
- Use flamegraphs or platform profilers when CPU time is material.
- Avoid large stack allocations. Box large recursive or fixed-size structures when necessary.
- Use `#[inline]` only when benchmark evidence shows a benefit.

## Serialization & Typing

- Derive `serde::Serialize` and `serde::Deserialize` for all DTOs.
- Always use strongly-typed `enum` definitions instead of loose, fragile magic strings.
- Avoid passing loose `serde_json::Value` structures deep into the core domain logic.
- Treat unknown payload fields strictly: either configure serde to reject them explicitly, or parse and log them as compatible extensions without mutating existing states.

## Domain & System Errors

- Use the `thiserror` crate to declare strongly-typed, domain-specific error hierarchies.
- The `anyhow` crate is permitted only at the outermost application boundaries (e.g., in `main.rs` or high-level Tauri command entrypoints), never as an internal error model.
- Every system error must be actionable and answer:
  1. Where and when the error occurred.
  2. Whether the error is transient and safe to retry.
  3. What specific actions the user or administrator can take to resolve it.
  4. A unique reference key for looking up detailed, unredacted technical error logs.
- Prefer the `?` operator for propagation. Use `map_err`, `inspect_err`, and explicit recovery branches when the error must be transformed, logged, or downgraded.
- Async errors crossing task boundaries should be `Send + Sync + 'static`.

## Strict "No Panics" Policy in Production

Forbidden in production runtime paths:
- Direct usage of `.unwrap()`.
- Direct usage of `.expect()`, except for verifying startup configuration invariants (e.g., validating static paths or environment variables).
- Panic-based validation chains.
- Silent fallback states that disguise database or file corruption.

Permitted:
- Assertion panics in unit and integration test suites.
- `.expect()` for compile-time, verified static invariants.
- Immediate fail-fast crashes during startup initialization (Sprint 0 foundation check).

## Persistent Local Storage

- Maintain local queues and caching states within an SQLite database.
- Utilize the `rusqlite` crate configured with bundled `SQLCipher` features to achieve robust, encrypted-at-rest database schemas.
- Ensure SQL migrations are sequential, explicit, and support backward rollbacks where practical.
- Execute all write operations affecting queue states or transaction outcomes inside ACID database transactions.
- Enforce unique constraints on `idempotencyKey` fields to prevent logical duplicates.
- Do not store raw document binary payloads inside the local database. Rely on file references paired with strict file retention policies instead.

## Generics, Dispatch, and State Modeling

- Prefer generics or `impl Trait` for performance-critical paths when concrete types are known at compile time.
- Use `dyn Trait` only when runtime polymorphism is needed, such as provider/plugin adapters or heterogeneous collections.
- Prefer `&dyn Trait` over `Box<dyn Trait>` when ownership is not required.
- Use `Arc<dyn Trait + Send + Sync>` only when shared cross-thread ownership is actually needed.
- Box at API boundaries rather than deep inside internal code.
- Consider the type-state pattern for connection, authentication, and command execution states when it prevents invalid transitions from compiling.
- Avoid typestate when it creates complex generics without removing real runtime risk.

## Pointers and Shared State

- Prefer plain borrows (`&T`, `&mut T`) before smart pointers.
- Use `Box<T>` for large or recursive owned values.
- Use `Arc<T>` for shared ownership across threads.
- Do not use `Rc<T>` or `RefCell<T>` in multi-threaded async code.
- Use `Mutex<T>` or `RwLock<T>` only for small, well-scoped shared state. Avoid holding locks across `.await`.
- Raw pointers are allowed only for FFI or platform APIs, and every `unsafe` block must document its safety invariants.

## Observability & Redaction

- Use the `tracing` crate to capture structured diagnostic spans.
- Instrument spans with correlation identifiers: `traceId`, `commandId`, `documentId`, `tenantId`.
- Ensure logs are structured (e.g., JSON log format) for seamless ingestion.
- **NEVER write secrets, access tokens, raw OCR text, document contents, or private keys to loggers or telemetry sinks.**
- Keep user-visible errors clear and redacted, storing detailed technical traceback stacks behind an internal reference key.

## Sub-Process Management

- Spawning the 1C thin client (`1cv8c.exe`) and other helper executables must be handled via `std::process::Command` or `tokio::process::Command`.
- Limit shell capabilities within Tauri by strictly auditing the configuration of `tauri-plugin-shell`.

## Rust Tests and Documentation

- Unit tests should live near the logic they test and use descriptive names that read like behavior statements.
- Prefer one behavior per test. Split large scenario tests when failures would be hard to diagnose.
- Test error paths, invalid input, unsupported platforms, idempotency, and retry classification.
- Use integration tests for local queue persistence, metadata parsing, and command execution boundaries.
- Use golden/snapshot tests for normalized metadata snapshots, schema diffs, validation reports, and export manifests.
- Public Rust APIs should have `///` docs with `# Errors`, `# Panics`, and `# Safety` sections when applicable.
- Module-level `//!` docs should explain module purpose and invariants for important integration modules.
- Comments should explain why, not restate what the code says. Use `// SAFETY:`, `// CONTEXT:`, or ADR links for non-obvious constraints.
- TODO comments must reference an issue or tracked task.

## References

- Apollo GraphQL Rust Best Practices: https://github.com/apollographql/rust-best-practices
- Tokio Runtime: https://tokio.rs/
- reqwest: https://docs.rs/reqwest/latest/reqwest/
- serde: https://serde.rs/
- thiserror: https://docs.rs/thiserror/latest/thiserror/
- tracing: https://docs.rs/tracing/latest/tracing/
- rusqlite: https://docs.rs/rusqlite/latest/rusqlite/
- keyring: https://docs.rs/keyring/latest/keyring/
- windows-service: https://docs.rs/windows-service/latest/windows_service/
