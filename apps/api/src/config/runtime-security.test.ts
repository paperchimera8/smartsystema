import { describe, expect, it } from "vitest";
import { buildRuntimeSecurityConfig, parseCorsOrigins } from "./runtime-security";

describe("runtime security config", () => {
  it("keeps development convenient for local self-hosted runs", () => {
    expect(buildRuntimeSecurityConfig({ NODE_ENV: "development" })).toMatchObject({
      allowPrivateNetworkCors: true,
      corsOrigin: true,
      enableSwagger: true,
      isProduction: false
    });
  });

  it("requires explicit production settings", () => {
    expect(() => buildRuntimeSecurityConfig({ NODE_ENV: "production" })).toThrow(
      /API_CORS_ORIGINS/
    );
  });

  it("normalizes explicit self-hosted production origins", () => {
    expect(
      buildRuntimeSecurityConfig({
        NODE_ENV: "production",
        API_CORS_ORIGINS: "https://office.example.test, http://127.0.0.1:1420",
        AUTH_JWT_SECRET: "production-secret",
        DATABASE_URL: "postgres://example",
        API_SWAGGER_ENABLED: "false",
        API_ALLOW_PRIVATE_NETWORK_CORS: "false"
      })
    ).toMatchObject({
      allowPrivateNetworkCors: false,
      corsOrigin: ["http://127.0.0.1:1420", "https://office.example.test"],
      enableSwagger: false,
      isProduction: true
    });
  });

  it("rejects wildcard and credential-bearing CORS origins", () => {
    expect(() => parseCorsOrigins("*")).toThrow(/Wildcard/);
    expect(() => parseCorsOrigins("https://user:password@example.test")).toThrow(
      /credentials/
    );
    expect(() => parseCorsOrigins("https://example.test/api")).toThrow(/path/);
  });
});
