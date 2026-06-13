import { describe, expect, it } from "vitest";
import { buildNodeSentryOptions, sentryRuntimeStatus } from "./sentry";

describe("Sentry observability config", () => {
  it("stays disabled when no DSN is configured", () => {
    const env = { NODE_ENV: "production" };

    expect(buildNodeSentryOptions("api", env)).toBeNull();
    expect(sentryRuntimeStatus(env)).toEqual({
      enabled: false,
      dsnConfigured: false,
      environment: "production",
      release: null,
      tracesSampleRate: 1,
      profileSessionSampleRate: 1,
      profileLifecycle: "trace",
      enableLogs: true,
      sendDefaultPii: false
    });
  });

  it("builds redacted Sentry options from environment", () => {
    const options = buildNodeSentryOptions("api", {
      SENTRY_DSN: "https://public@example.invalid/1",
      SENTRY_ENVIRONMENT: "prod",
      SENTRY_RELEASE: "release-1",
      SENTRY_TRACES_SAMPLE_RATE: "0.25",
      SENTRY_PROFILE_SESSION_SAMPLE_RATE: "0.5",
      SENTRY_PROFILE_LIFECYCLE: "manual",
      SENTRY_ENABLE_LOGS: "false"
    });

    expect(options).toMatchObject({
      dsn: "https://public@example.invalid/1",
      environment: "prod",
      release: "release-1",
      enableLogs: false,
      profileLifecycle: "manual",
      profileSessionSampleRate: 0.5,
      sendDefaultPii: false,
      tracesSampleRate: 0.25
    });
    expect(options?.integrations).toHaveLength(1);
  });

  it("rejects invalid sample rates", () => {
    expect(() =>
      buildNodeSentryOptions("worker", {
        SENTRY_DSN: "https://public@example.invalid/1",
        SENTRY_TRACES_SAMPLE_RATE: "2"
      })
    ).toThrow("SENTRY_TRACES_SAMPLE_RATE must be a number from 0 to 1.");
  });

  it("rejects invalid profiling configuration", () => {
    expect(() =>
      buildNodeSentryOptions("api", {
        SENTRY_DSN: "https://public@example.invalid/1",
        SENTRY_PROFILE_SESSION_SAMPLE_RATE: "-0.1"
      })
    ).toThrow("SENTRY_PROFILE_SESSION_SAMPLE_RATE must be a number from 0 to 1.");

    expect(() =>
      buildNodeSentryOptions("api", {
        SENTRY_DSN: "https://public@example.invalid/1",
        SENTRY_PROFILE_LIFECYCLE: "forever"
      })
    ).toThrow("SENTRY_PROFILE_LIFECYCLE must be either manual or trace.");

    expect(() =>
      buildNodeSentryOptions("api", {
        SENTRY_DSN: "https://public@example.invalid/1",
        SENTRY_ENABLE_LOGS: "maybe"
      })
    ).toThrow("SENTRY_ENABLE_LOGS must be a boolean value.");
  });
});
