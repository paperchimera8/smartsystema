import type { NestExpressApplication } from "@nestjs/platform-express";

type RuntimeEnvironment = Record<string, string | undefined>;

export type CorsOriginPolicy = true | string[];

export type RuntimeSecurityConfig = {
  allowPrivateNetworkCors: boolean;
  corsOrigin: CorsOriginPolicy;
  enableSwagger: boolean;
  isProduction: boolean;
};

const REQUIRED_PRODUCTION_ENV = ["API_CORS_ORIGINS", "AUTH_JWT_SECRET", "DATABASE_URL"] as const;
const ALLOWED_CORS_PROTOCOLS = new Set(["http:", "https:", "tauri:"]);

export function buildRuntimeSecurityConfig(
  env: RuntimeEnvironment = process.env
): RuntimeSecurityConfig {
  const isProduction = env.NODE_ENV === "production";

  if (isProduction) {
    requireProductionEnv(env);
  }

  return {
    allowPrivateNetworkCors: parseBoolean(
      env.API_ALLOW_PRIVATE_NETWORK_CORS,
      !isProduction
    ),
    corsOrigin: isProduction ? parseCorsOrigins(env.API_CORS_ORIGINS) : true,
    enableSwagger: parseBoolean(env.API_SWAGGER_ENABLED, !isProduction),
    isProduction
  };
}

export function applySecurityHeaders(app: NestExpressApplication): void {
  app.use(
    (
      _req: unknown,
      res: { setHeader: (name: string, value: string) => void },
      next: () => void
    ) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("X-Frame-Options", "DENY");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
      next();
    }
  );
}

export function applyPrivateNetworkCorsHeader(
  app: NestExpressApplication,
  enabled: boolean
): void {
  if (!enabled) {
    return;
  }

  app.use(
    (
      _req: unknown,
      res: { setHeader: (name: string, value: string) => void },
      next: () => void
    ) => {
      res.setHeader("Access-Control-Allow-Private-Network", "true");
      next();
    }
  );
}

export function parseCorsOrigins(rawValue: string | undefined): string[] {
  const values = rawValue
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (!values?.length) {
    throw new Error("API_CORS_ORIGINS must be configured in production.");
  }

  const origins = values.map(normalizeCorsOrigin);
  return [...new Set(origins)].sort();
}

function requireProductionEnv(env: RuntimeEnvironment): void {
  const missing = REQUIRED_PRODUCTION_ENV.filter((name) => !env[name]?.trim());

  if (missing.length > 0) {
    throw new Error(`Missing production environment variables: ${missing.join(", ")}.`);
  }
}

function normalizeCorsOrigin(rawOrigin: string): string {
  if (rawOrigin === "*") {
    throw new Error("Wildcard CORS origins are forbidden in production.");
  }

  let url: URL;

  try {
    url = new URL(rawOrigin);
  } catch {
    throw new Error(`Invalid CORS origin: ${rawOrigin}.`);
  }

  if (!ALLOWED_CORS_PROTOCOLS.has(url.protocol)) {
    throw new Error(`Unsupported CORS origin protocol: ${url.protocol}.`);
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new Error("CORS origins must not contain credentials, query parameters, or fragments.");
  }

  if (url.pathname !== "/" && url.pathname !== "") {
    throw new Error("CORS origins must not contain a path.");
  }

  return `${url.protocol}//${url.host}`;
}

function parseBoolean(rawValue: string | undefined, defaultValue: boolean): boolean {
  const normalized = rawValue?.trim().toLowerCase();

  if (!normalized) {
    return defaultValue;
  }

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  throw new Error(`Invalid boolean environment value: ${rawValue}.`);
}
