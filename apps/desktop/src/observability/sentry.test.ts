import { describe, expect, it } from "vitest";
import { browserTelemetryStatus } from "./sentry";

describe("browser Sentry observability", () => {
  it("reports disabled status without DSN", () => {
    expect(browserTelemetryStatus({ MODE: "production" })).toEqual({
      enabled: false,
      dsnConfigured: false,
      environment: "production",
      release: null,
      tracesSampleRate: 0.1,
      replayEnabled: false,
      sendDefaultPii: false
    });
  });

  it("reports enabled status without exposing DSN", () => {
    expect(
      browserTelemetryStatus({
        VITE_SENTRY_DSN: "https://public@example.invalid/1",
        VITE_SENTRY_ENVIRONMENT: "prod",
        VITE_SENTRY_RELEASE: "release-1",
        VITE_SENTRY_TRACES_SAMPLE_RATE: "0.4"
      })
    ).toEqual({
      enabled: true,
      dsnConfigured: true,
      environment: "prod",
      release: "release-1",
      tracesSampleRate: 0.4,
      replayEnabled: false,
      sendDefaultPii: false
    });
  });

  it("rejects invalid sample rates", () => {
    expect(() =>
      browserTelemetryStatus({
        VITE_SENTRY_TRACES_SAMPLE_RATE: "1.2"
      })
    ).toThrow("VITE_SENTRY_TRACES_SAMPLE_RATE must be a number from 0 to 1.");
  });
});
