import type { NodeOptions } from "@sentry/nestjs";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

export type SentryServiceName = "api" | "worker";

export type SentryRuntimeStatus = {
  enabled: boolean;
  dsnConfigured: boolean;
  environment: string;
  release: string | null;
  tracesSampleRate: number;
  profileSessionSampleRate: number;
  profileLifecycle: "manual" | "trace";
  enableLogs: boolean;
  sendDefaultPii: false;
};

type SentryEnvironment = Record<string, string | undefined>;

const DEFAULT_TRACES_SAMPLE_RATE = 1.0;
const DEFAULT_PROFILE_SESSION_SAMPLE_RATE = 1.0;
const DEFAULT_PROFILE_LIFECYCLE = "trace";
const DEFAULT_ENABLE_LOGS = true;

export function buildNodeSentryOptions(
  service: SentryServiceName,
  env: SentryEnvironment = process.env
): NodeOptions | null {
  const dsn = readNonEmpty(env.SENTRY_DSN);

  if (!dsn) {
    return null;
  }

  const tracesSampleRate = parseSampleRate(
    env.SENTRY_TRACES_SAMPLE_RATE,
    DEFAULT_TRACES_SAMPLE_RATE,
    "SENTRY_TRACES_SAMPLE_RATE"
  );
  const options: NodeOptions = {
    dsn,
    environment: sentryEnvironment(env),
    initialScope: {
      tags: {
        service
      }
    },
    integrations: [nodeProfilingIntegration()],
    enableLogs: parseBoolean(env.SENTRY_ENABLE_LOGS, DEFAULT_ENABLE_LOGS, "SENTRY_ENABLE_LOGS"),
    profileLifecycle: parseProfileLifecycle(env.SENTRY_PROFILE_LIFECYCLE),
    profileSessionSampleRate: parseSampleRate(
      env.SENTRY_PROFILE_SESSION_SAMPLE_RATE,
      DEFAULT_PROFILE_SESSION_SAMPLE_RATE,
      "SENTRY_PROFILE_SESSION_SAMPLE_RATE"
    ),
    sendDefaultPii: false,
    tracesSampleRate
  };
  const release = readNonEmpty(env.SENTRY_RELEASE);

  if (release) {
    options.release = release;
  }

  return options;
}

export function sentryRuntimeStatus(
  env: SentryEnvironment = process.env
): SentryRuntimeStatus {
  return {
    enabled: Boolean(readNonEmpty(env.SENTRY_DSN)),
    dsnConfigured: Boolean(readNonEmpty(env.SENTRY_DSN)),
    environment: sentryEnvironment(env),
    release: readNonEmpty(env.SENTRY_RELEASE) ?? null,
    tracesSampleRate: parseSampleRate(
      env.SENTRY_TRACES_SAMPLE_RATE,
      DEFAULT_TRACES_SAMPLE_RATE,
      "SENTRY_TRACES_SAMPLE_RATE"
    ),
    profileSessionSampleRate: parseSampleRate(
      env.SENTRY_PROFILE_SESSION_SAMPLE_RATE,
      DEFAULT_PROFILE_SESSION_SAMPLE_RATE,
      "SENTRY_PROFILE_SESSION_SAMPLE_RATE"
    ),
    profileLifecycle: parseProfileLifecycle(env.SENTRY_PROFILE_LIFECYCLE),
    enableLogs: parseBoolean(env.SENTRY_ENABLE_LOGS, DEFAULT_ENABLE_LOGS, "SENTRY_ENABLE_LOGS"),
    sendDefaultPii: false
  };
}

function sentryEnvironment(env: SentryEnvironment): string {
  return readNonEmpty(env.SENTRY_ENVIRONMENT) ?? readNonEmpty(env.NODE_ENV) ?? "development";
}

function parseSampleRate(rawValue: string | undefined, fallback: number, name: string): number {
  const trimmed = rawValue?.trim();

  if (!trimmed) {
    return fallback;
  }

  const rate = Number(trimmed);

  if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw new Error(`${name} must be a number from 0 to 1.`);
  }

  return rate;
}

function parseProfileLifecycle(value: string | undefined): "manual" | "trace" {
  const normalized = value?.trim().toLowerCase();

  if (!normalized) {
    return DEFAULT_PROFILE_LIFECYCLE;
  }

  if (normalized === "manual" || normalized === "trace") {
    return normalized;
  }

  throw new Error("SENTRY_PROFILE_LIFECYCLE must be either manual or trace.");
}

function parseBoolean(value: string | undefined, fallback: boolean, name: string): boolean {
  const normalized = value?.trim().toLowerCase();

  if (!normalized) {
    return fallback;
  }

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  throw new Error(`${name} must be a boolean value.`);
}

function readNonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
