import { describe, expect, it } from "vitest";
import { captureWorkerException, workerSentryStatus } from "./sentry.js";

describe("worker Sentry observability", () => {
  it("reports disabled status without DSN", () => {
    expect(workerSentryStatus({ NODE_ENV: "production" })).toEqual({
      enabled: false,
      dsnConfigured: false,
      environment: "production",
      release: null,
      tracesSampleRate: 0.1,
      sendDefaultPii: false
    });
  });

  it("reports redacted enabled status", () => {
    expect(
      workerSentryStatus({
        SENTRY_DSN: "https://public@example.invalid/1",
        SENTRY_ENVIRONMENT: "prod",
        SENTRY_RELEASE: "release-1",
        SENTRY_TRACES_SAMPLE_RATE: "0.3"
      })
    ).toEqual({
      enabled: true,
      dsnConfigured: true,
      environment: "prod",
      release: "release-1",
      tracesSampleRate: 0.3,
      sendDefaultPii: false
    });
  });

  it("does not throw when capture is disabled", () => {
    expect(() =>
      captureWorkerException(new Error("boom"), {
        jobId: "job-1",
        jobName: "ocr.extract"
      })
    ).not.toThrow();
  });
});
