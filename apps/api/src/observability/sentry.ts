import type { NodeOptions } from "@sentry/nestjs";

export type SentryServiceName = "api" | "worker";

export type SentryRuntimeStatus = {
  enabled: boolean;
  dsnConfigured: boolean;
  environment: string;
  release: string | null;
  tracesSampleRate: number;
  sendDefaultPii: false;
};

type SentryEnvironment = Record<string, string | undefined>;

const DEFAULT_TRACES_SAMPLE_RATE = 0.1;

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

function readNonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
