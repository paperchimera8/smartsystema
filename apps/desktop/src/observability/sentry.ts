import * as Sentry from "@sentry/react";
import type { BrowserOptions } from "@sentry/react";

export type BrowserTelemetryStatus = {
  enabled: boolean;
  dsnConfigured: boolean;
  environment: string;
  release: string | null;
  tracesSampleRate: number;
  replayEnabled: false;
  sendDefaultPii: false;
};

type BrowserTelemetryEnv = Record<string, string | boolean | undefined>;

const DEFAULT_TRACES_SAMPLE_RATE = 0.1;

export function initializeBrowserTelemetry(
  env: BrowserTelemetryEnv = import.meta.env
): BrowserTelemetryStatus {
  const status = browserTelemetryStatus(env);
  const dsn = readString(env.VITE_SENTRY_DSN);

  if (!dsn) {
    return status;
  }

  const options: BrowserOptions = {
    dsn,
    environment: status.environment,
    integrations: [Sentry.browserTracingIntegration()],
    sendDefaultPii: false,
    tracesSampleRate: status.tracesSampleRate
  };

  if (status.release) {
    options.release = status.release;
  }

  Sentry.init(options);

  return status;
}

export function browserTelemetryStatus(
  env: BrowserTelemetryEnv = import.meta.env
): BrowserTelemetryStatus {
  return {
    enabled: Boolean(readString(env.VITE_SENTRY_DSN)),
    dsnConfigured: Boolean(readString(env.VITE_SENTRY_DSN)),
    environment: readString(env.VITE_SENTRY_ENVIRONMENT) ?? readString(env.MODE) ?? "development",
    release: readString(env.VITE_SENTRY_RELEASE) ?? null,
    tracesSampleRate: parseSampleRate(
      readString(env.VITE_SENTRY_TRACES_SAMPLE_RATE),
      DEFAULT_TRACES_SAMPLE_RATE,
      "VITE_SENTRY_TRACES_SAMPLE_RATE"
    ),
    replayEnabled: false,
    sendDefaultPii: false
  };
}

function parseSampleRate(rawValue: string | undefined, fallback: number, name: string): number {
  if (!rawValue) {
    return fallback;
  }

  const rate = Number(rawValue);

  if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw new Error(`${name} must be a number from 0 to 1.`);
  }

  return rate;
}

function readString(value: string | boolean | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
