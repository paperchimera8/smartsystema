import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { NativeAuthMeResponse } from "@automator/contracts";
import { NativeAuthGuard } from "./native-auth.guard";
import type { AuthService } from "./auth.service";

const session: NativeAuthMeResponse = {
  user: {
    userId: "user-1",
    tenantId: "tenant-1",
    email: "accountant@example.test",
    displayName: "Accountant",
    role: "accountant"
  },
  sessionId: "session-1",
  expiresAt: "2099-01-01T00:00:00.000Z"
};

describe("NativeAuthGuard", () => {
  it("authenticates bearer sessions and stores the session on the request", async () => {
    const authService = {
      currentSessionFromAuthorization: vi.fn(async () => session)
    } as unknown as AuthService;
    const request = {
      body: { tenantId: "tenant-1" },
      headers: { authorization: "Bearer token" },
      query: {}
    };
    const guard = new NativeAuthGuard(authService);

    await expect(guard.canActivate(executionContext(request))).resolves.toBe(true);
    expect(authService.currentSessionFromAuthorization).toHaveBeenCalledWith("Bearer token");
    expect(request).toMatchObject({ auth: session });
  });

  it("rejects tenant scope mismatches", async () => {
    const authService = {
      currentSessionFromAuthorization: vi.fn(async () => session)
    } as unknown as AuthService;
    const guard = new NativeAuthGuard(authService);

    await expect(
      guard.canActivate(
        executionContext({
          body: { tenantId: "tenant-2" },
          headers: { authorization: "Bearer token" },
          query: {}
        })
      )
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

function executionContext(request: object) {
  return {
    switchToHttp: () => ({
      getRequest: () => request
    })
  } as never;
}
