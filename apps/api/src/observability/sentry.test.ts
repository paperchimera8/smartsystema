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
      tracesSampleRate: 0.1,
      sendDefaultPii: false
    });
  });

  it("builds redacted Sentry options from environment", () => {
    const options = buildNodeSentryOptions("api", {
      SENTRY_DSN: "https://public@example.invalid/1",
      SENTRY_ENVIRONMENT: "prod",
      SENTRY_RELEASE: "release-1",
      SENTRY_TRACES_SAMPLE_RATE: "0.25"
    });

    expect(options).toMatchObject({
      dsn: "https://public@example.invalid/1",
      environment: "prod",
      release: "release-1",
      sendDefaultPii: false,
      tracesSampleRate: 0.25
    });
  });

  it("rejects invalid sample rates", () => {
    expect(() =>
      buildNodeSentryOptions("worker", {
        SENTRY_DSN: "https://public@example.invalid/1",
        SENTRY_TRACES_SAMPLE_RATE: "2"
      })
    ).toThrow("SENTRY_TRACES_SAMPLE_RATE must be a number from 0 to 1.");
  });
});
