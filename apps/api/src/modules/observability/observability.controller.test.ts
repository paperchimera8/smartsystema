import { describe, expect, it, vi } from "vitest";
import { ObservabilityController } from "./observability.controller";

describe("ObservabilityController", () => {
  it("returns redacted telemetry status", () => {
    vi.stubEnv("SENTRY_DSN", "https://public@example.invalid/1");
    vi.stubEnv("SENTRY_ENVIRONMENT", "prod");
    vi.stubEnv("SENTRY_RELEASE", "release-1");
    vi.stubEnv("SENTRY_TRACES_SAMPLE_RATE", "0.2");

    const response = new ObservabilityController().getObservability();

    expect(response).toMatchObject({
      service: "api",
      status: "ok",
      telemetry: {
        sentry: {
          enabled: true,
          dsnConfigured: true,
          environment: "prod",
          release: "release-1",
          tracesSampleRate: 0.2,
          sendDefaultPii: false
        },
        pii: {
          rawDocumentsLogged: false,
          rawOcrTextLogged: false,
          credentialsLogged: false
        }
      }
    });
    expect(JSON.stringify(response)).not.toContain("public@example.invalid");

    vi.unstubAllEnvs();
  });
});
