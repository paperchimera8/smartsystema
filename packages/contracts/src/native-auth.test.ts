import { describe, expect, it } from "vitest";
import type {
  NativeAuthMeResponse,
  NativeAuthPollResponse,
  StartNativeAuthRequest,
  StartNativeAuthResponse
} from "./index";
import { NATIVE_AUTH_PAYLOAD_VERSION } from "./index";

describe("native browser auth contracts", () => {
  it("types start request and response payloads", () => {
    const request = {
      payloadVersion: NATIVE_AUTH_PAYLOAD_VERSION,
      deviceLabel: "Desktop Agent",
      preferredMode: "register",
      correlationId: "corr-auth-1"
    } satisfies StartNativeAuthRequest;

    const response = {
      payloadVersion: NATIVE_AUTH_PAYLOAD_VERSION,
      authRequestId: "auth-request-1",
      pollToken: "poll-token-1",
      loginUrl: "https://api.example.test/api/auth/native/login?requestId=auth-request-1&state=opaque",
      expiresAt: "2026-06-02T12:00:00.000Z",
      pollIntervalMs: 1500,
      correlationId: request.correlationId
    } satisfies StartNativeAuthResponse;

    expect(response.payloadVersion).toBe(1);
    expect(request.preferredMode).toBe("register");
  });

  it("types pending and authenticated polling responses", () => {
    const pending = {
      payloadVersion: NATIVE_AUTH_PAYLOAD_VERSION,
      status: "pending",
      expiresAt: "2026-06-02T12:00:00.000Z",
      pollIntervalMs: 1500,
      correlationId: "corr-auth-1"
    } satisfies NativeAuthPollResponse;

    const authenticated = {
      payloadVersion: NATIVE_AUTH_PAYLOAD_VERSION,
      status: "authenticated",
      accessToken: "jwt.access.token",
      expiresAt: "2026-06-02T12:15:00.000Z",
      user: {
        userId: "user-1",
        tenantId: "tenant-1",
        email: "accountant@example.test",
        displayName: "Accountant",
        role: "accountant"
      },
      correlationId: "corr-auth-1"
    } satisfies NativeAuthPollResponse;

    expect(pending.status).toBe("pending");
    expect(authenticated.status).toBe("authenticated");
  });

  it("types current session response", () => {
    const response = {
      user: {
        userId: "user-1",
        tenantId: "tenant-1",
        email: "accountant@example.test",
        displayName: "Accountant",
        role: "admin"
      },
      sessionId: "session-1",
      expiresAt: "2026-06-02T12:15:00.000Z"
    } satisfies NativeAuthMeResponse;

    expect(response.user.role).toBe("admin");
  });
});
