import { describe, expect, it } from "vitest";
import type { JwtService } from "@nestjs/jwt";
import type { ConfigService } from "@nestjs/config";
import { NATIVE_AUTH_PAYLOAD_VERSION } from "@automator/contracts";
import {
  AuthService,
  buildLoginUrl,
  buildNativeLoginCompletedPage,
  buildNativeLoginInvalidRequestPage,
  buildNativeLoginPage,
  hashPassword,
  normalizeEmail,
  safeNativeAuthReturnUrl,
  verifyPassword
} from "./auth.service";
import type { AuthRepository, AuthSessionRow, AuthUserRow, NativeAuthRequestRow } from "./auth.repository";

describe("AuthService native browser flow", () => {
  it("creates an external-browser auth request and completes it via polling", async () => {
    const { service, repositoryState } = createService();
    const started = await service.startNativeAuth(
      {
        payloadVersion: NATIVE_AUTH_PAYLOAD_VERSION,
        deviceLabel: "Desktop Agent",
        correlationId: "corr-auth-1"
      },
      "http://127.0.0.1:8082"
    );
    const url = new URL(started.loginUrl);
    const requestId = url.searchParams.get("requestId") ?? "";
    const state = url.searchParams.get("state") ?? "";

    expect(started.pollToken).toHaveLength(43);
    expect(url.pathname).toBe("/api/auth/native/login");
    expect(url.searchParams.get("mode")).toBe("login");
    expect(repositoryState.authRequests.get(requestId)?.status).toBe("pending");

    const page = await service.renderLoginPage(requestId, state);
    expect(page).toContain("Вход в СмартСистему");

    const completedPage = await service.completeBrowserLogin({
      requestId,
      state,
      email: "Accountant@Example.Test",
      password: "Strong123",
      mode: "register"
    });
    expect(completedPage).toContain("Открываем кабинет");
    expect(completedPage).toContain("automator://auth-complete");
    expect(completedPage).not.toContain("accountant@example.test");
    expect(completedPage).not.toContain("Вернитесь");

    const polled = await service.pollNativeAuth({
      payloadVersion: NATIVE_AUTH_PAYLOAD_VERSION,
      authRequestId: started.authRequestId,
      pollToken: started.pollToken,
      correlationId: "corr-auth-1"
    });

    expect(polled.status).toBe("authenticated");
    if (polled.status === "authenticated") {
      expect(polled.user.email).toBe("accountant@example.test");
      expect(polled.user.tenantId).toBe("tenant-1");
      expect(polled.accessToken).toMatch(/^token-session_/);
    }
    expect(repositoryState.authRequests.get(requestId)?.status).toBe("consumed");
    expect(repositoryState.sessions.size).toBe(1);
  });

  it("hashes passwords and rejects malformed hashes", async () => {
    const hash = await hashPassword("Strong123");

    await expect(verifyPassword("Strong123", hash)).resolves.toBe(true);
    await expect(verifyPassword("Wrong123", hash)).resolves.toBe(false);
    await expect(verifyPassword("Strong123", "not-a-real-hash")).resolves.toBe(false);
  });

  it("normalizes email and escapes browser login HTML", () => {
    expect(normalizeEmail(" Accountant@Example.Test ")).toBe("accountant@example.test");
    expect(buildLoginUrl("https://api.example.test", "request-1", "state-1")).toBe(
      "https://api.example.test/api/auth/native/login?requestId=request-1&state=state-1&mode=login"
    );
    expect(buildLoginUrl("https://api.example.test", "request-1", "state-1", "register")).toBe(
      "https://api.example.test/api/auth/native/login?requestId=request-1&state=state-1&mode=register"
    );
    expect(
      buildNativeLoginPage({
        requestId: "request-1",
        state: "state-1",
        deviceLabel: "<script>alert(1)</script>",
        preferredMode: "register"
      })
    ).not.toContain("<script>alert(1)</script>");
    const loginPage = buildNativeLoginPage({
      requestId: "request-1",
      state: "state-1",
      deviceLabel: "Desktop Agent"
    });
    expect(loginPage).toContain("Нет аккаунта?");
    expect(loginPage).toContain("Зарегистрироваться");
    expect(loginPage).not.toContain("Имя для новой учётной записи");
    expect(loginPage).not.toContain("Можно оставить пустым");
    expect(loginPage).not.toContain("name=\"displayName\"");
    expect(loginPage).not.toContain("OAuth2/OIDC");
    expect(
      buildNativeLoginPage({
        requestId: "request-1",
        state: "state-1",
        deviceLabel: "Desktop Agent",
        preferredMode: "register"
      })
    ).toContain("Регистрация в СмартСистеме");
    expect(buildNativeLoginInvalidRequestPage("Expired link")).not.toContain("<form");
    expect(buildNativeLoginCompletedPage("automator://auth-complete")).toContain("Открыть кабинет");
    expect(buildNativeLoginCompletedPage("automator://auth-complete")).not.toContain("Вернитесь");
    expect(safeNativeAuthReturnUrl("automator://auth-complete")).toBe("automator://auth-complete");
    expect(safeNativeAuthReturnUrl("http://127.0.0.1:1420/")).toBe("http://127.0.0.1:1420/");
    expect(safeNativeAuthReturnUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeNativeAuthReturnUrl("https://example.test/callback?token=secret")).toBeUndefined();
  });

  it("renders browser-friendly auth errors instead of JSON for stale registration requests", async () => {
    const { service } = createService();

    const page = await service.completeBrowserLogin({
      requestId: "auth_missing",
      state: "opaque-state-value-with-safe-length-123456",
      email: "new@example.test",
      password: "Strong123",
      mode: "register"
    });

    expect(page).toContain("Ссылка недействительна");
    expect(page).toContain("Запустите вход или регистрацию заново");
    expect(page).not.toContain("authRequestNotFound");
    expect(page).not.toContain('"code"');
    expect(page).not.toContain("<form");
  });

  it("keeps recoverable registration errors on the registration form", async () => {
    const { service } = createService();
    const started = await service.startNativeAuth(
      {
        payloadVersion: NATIVE_AUTH_PAYLOAD_VERSION,
        preferredMode: "register",
        correlationId: "corr-auth-register-error"
      },
      "http://127.0.0.1:8082"
    );
    const url = new URL(started.loginUrl);
    const requestId = url.searchParams.get("requestId") ?? "";
    const state = url.searchParams.get("state") ?? "";

    const page = await service.completeBrowserLogin({
      requestId,
      state,
      email: "new@example.test",
      password: "weakpass",
      mode: "register"
    });

    expect(page).toContain("Регистрация в СмартСистеме");
    expect(page).toContain("Создать аккаунт");
    expect(page).toContain("Пароль должен быть не короче 8 символов");
  });
});

type RepositoryState = {
  authRequests: Map<string, NativeAuthRequestRow>;
  usersByEmail: Map<string, AuthUserRow>;
  usersById: Map<string, AuthUserRow>;
  sessions: Map<string, AuthSessionRow>;
};

function createService(): { service: AuthService; repositoryState: RepositoryState } {
  const repositoryState: RepositoryState = {
    authRequests: new Map(),
    usersByEmail: new Map(),
    usersById: new Map(),
    sessions: new Map()
  };

  const repository = {
    async createNativeAuthRequest(input: Partial<NativeAuthRequestRow>) {
      const row = {
        userId: null,
        tenantId: null,
        sessionCodeHash: null,
        deviceLabel: null,
        completedAt: null,
        consumedAt: null,
        status: "pending",
        ...input
      } as NativeAuthRequestRow;
      repositoryState.authRequests.set(row.authRequestId, row);
      return row;
    },
    async findNativeAuthRequest(authRequestId: string) {
      return repositoryState.authRequests.get(authRequestId);
    },
    async completeNativeAuthRequest(input: {
      authRequestId: string;
      userId: string;
      tenantId: string;
      sessionCodeHash: string;
      completedAt: Date;
    }) {
      const row = repositoryState.authRequests.get(input.authRequestId);
      if (!row || row.status !== "pending") return undefined;
      const completed = {
        ...row,
        status: "completed",
        userId: input.userId,
        tenantId: input.tenantId,
        sessionCodeHash: input.sessionCodeHash,
        completedAt: input.completedAt,
        updatedAt: input.completedAt
      } as NativeAuthRequestRow;
      repositoryState.authRequests.set(input.authRequestId, completed);
      return completed;
    },
    async consumeNativeAuthRequest(authRequestId: string, consumedAt: Date) {
      const row = repositoryState.authRequests.get(authRequestId);
      if (!row || row.status !== "completed") return undefined;
      const consumed = {
        ...row,
        status: "consumed",
        consumedAt,
        updatedAt: consumedAt
      } as NativeAuthRequestRow;
      repositoryState.authRequests.set(authRequestId, consumed);
      return consumed;
    },
    async expireNativeAuthRequest(authRequestId: string, expiredAt: Date) {
      const row = repositoryState.authRequests.get(authRequestId);
      if (row) {
        repositoryState.authRequests.set(authRequestId, {
          ...row,
          status: "expired",
          updatedAt: expiredAt
        } as NativeAuthRequestRow);
      }
    },
    async createUser(input: Partial<AuthUserRow>) {
      const row = {
        status: "active",
        ...input
      } as AuthUserRow;
      repositoryState.usersByEmail.set(row.email, row);
      repositoryState.usersById.set(row.userId, row);
      return row;
    },
    async findUserByEmail(email: string) {
      return repositoryState.usersByEmail.get(email);
    },
    async findUserById(userId: string) {
      return repositoryState.usersById.get(userId);
    },
    async createSession(input: Partial<AuthSessionRow>) {
      const row = {
        revokedAt: null,
        ...input
      } as AuthSessionRow;
      repositoryState.sessions.set(row.sessionId, row);
      return row;
    },
    async findActiveSession(sessionId: string) {
      return repositoryState.sessions.get(sessionId);
    }
  } as unknown as AuthRepository;

  const jwtService = {
    async signAsync(payload: { sessionId: string }) {
      return `token-${payload.sessionId}`;
    },
    async verifyAsync() {
      throw new Error("Not used in this test.");
    }
  } as unknown as JwtService;

  const configService = {
    get(key: string) {
      if (key === "AUTH_NATIVE_RETURN_URL") {
        return "automator://auth-complete";
      }

      return key === "AUTH_DEFAULT_TENANT_ID" ? "tenant-1" : undefined;
    }
  } as unknown as ConfigService;

  return {
    service: new AuthService(repository, jwtService, configService),
    repositoryState
  };
}
