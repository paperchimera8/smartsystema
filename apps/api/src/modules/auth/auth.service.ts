import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import type {
  NativeAuthMeResponse,
  NativeAuthPollResponse,
  NativeAuthSessionResponse,
  NativeAuthUser,
  PollNativeAuthRequest,
  StartNativeAuthRequest,
  StartNativeAuthResponse
} from "@automator/contracts";
import { NATIVE_AUTH_PAYLOAD_VERSION } from "@automator/contracts";
import { authBadRequest, authConflict, authNotFound, authUnauthorized } from "./auth.errors";
import {
  AuthRepository,
  isAuthUniqueConstraintViolation,
  type AuthUserRow,
  type NativeAuthRequestRow
} from "./auth.repository";
import type { NativeBrowserLoginFormDto } from "./dto/native-auth.dto";

const scrypt = promisify(scryptCallback);
const PASSWORD_HASH_PREFIX = "scrypt:v1";
const PASSWORD_KEY_LENGTH = 64;
const AUTH_REQUEST_TTL_MS = 10 * 60 * 1000;
const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
const POLL_INTERVAL_MS = 1500;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
type NativeAuthPreferredMode = "login" | "register";

type JwtPayload = {
  sub: string;
  tenantId: string;
  sessionId: string;
  email: string;
  role: NativeAuthUser["role"];
};

@Injectable()
export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService
  ) {}

  async startNativeAuth(
    request: StartNativeAuthRequest,
    publicApiBaseUrl: string
  ): Promise<StartNativeAuthResponse> {
    if (request.payloadVersion !== NATIVE_AUTH_PAYLOAD_VERSION) {
      throw authBadRequest({
        code: "invalidPayloadVersion",
        message: "Unsupported auth payload version.",
        retryable: false,
        remediation: "Send payloadVersion 1.",
        correlationId: request.correlationId
      });
    }

    const now = new Date();
    const authRequestId = `auth_${randomUUID()}`;
    const state = opaqueToken();
    const pollToken = opaqueToken();
    const expiresAt = new Date(now.getTime() + AUTH_REQUEST_TTL_MS);
    const preferredMode = safePreferredMode(request.preferredMode);
    const loginUrl = buildLoginUrl(publicApiBaseUrl, authRequestId, state, preferredMode);

    const deviceLabel = safeOptionalLabel(request.deviceLabel);

    await this.repository.createNativeAuthRequest({
      authRequestId,
      stateHash: hashOpaqueToken(state),
      pollTokenHash: hashOpaqueToken(pollToken),
      correlationId: request.correlationId,
      expiresAt,
      createdAt: now,
      ...(deviceLabel === undefined ? {} : { deviceLabel })
    });

    return {
      payloadVersion: NATIVE_AUTH_PAYLOAD_VERSION,
      authRequestId,
      pollToken,
      loginUrl,
      expiresAt: expiresAt.toISOString(),
      pollIntervalMs: POLL_INTERVAL_MS,
      correlationId: request.correlationId
    };
  }

  async renderLoginPage(
    requestId: string,
    state: string,
    preferredMode: NativeAuthPreferredMode = "login"
  ): Promise<string> {
    const authRequest = await this.getPendingBrowserRequest(requestId, state);

    return buildNativeLoginPage({
      requestId,
      state,
      preferredMode,
      deviceLabel: authRequest.deviceLabel ?? "СмартСистема Desktop Agent"
    });
  }

  async completeBrowserLogin(form: NativeBrowserLoginFormDto): Promise<string> {
    const mode = safePreferredMode(form.mode);

    try {
      const authRequest = await this.getPendingBrowserRequest(form.requestId, form.state);
      const email = normalizeEmail(form.email);

      if (!EMAIL_PATTERN.test(email)) {
        return buildNativeLoginErrorPage(form.requestId, form.state, "Введите корректную почту.", mode);
      }

      const user =
        mode === "register"
          ? await this.registerUser(email, form.password)
          : await this.verifyLogin(email, form.password);

      const completed = await this.repository.completeNativeAuthRequest({
        authRequestId: authRequest.authRequestId,
        userId: user.userId,
        tenantId: user.tenantId,
        sessionCodeHash: hashOpaqueToken(opaqueToken()),
        completedAt: new Date()
      });

      if (!completed) {
        return buildNativeLoginErrorPage(
          form.requestId,
          form.state,
          "This login request has already been used. Start sign-in again from the desktop app."
        );
      }

      return buildNativeLoginCompletedPage(this.nativeAuthReturnUrl());
    } catch (error) {
      if (isNativeAuthRequestUnavailable(error)) {
        return buildNativeLoginInvalidRequestPage(
          "Ссылка для входа устарела или уже использована. Запустите вход или регистрацию заново из окна СмартСистема."
        );
      }

      if (mode === "register" && isAuthUniqueConstraintViolation(error)) {
        return buildNativeLoginErrorPage(form.requestId, form.state, "Аккаунт с этой почтой уже существует. Попробуйте войти.", mode);
      }

      return buildNativeLoginErrorPage(form.requestId, form.state, authBrowserErrorMessage(error), mode);
    }
  }

  async pollNativeAuth(request: PollNativeAuthRequest, userAgent?: string): Promise<NativeAuthPollResponse> {
    if (request.payloadVersion !== NATIVE_AUTH_PAYLOAD_VERSION) {
      throw authBadRequest({
        code: "invalidPayloadVersion",
        message: "Unsupported auth payload version.",
        retryable: false,
        remediation: "Send payloadVersion 1.",
        correlationId: request.correlationId
      });
    }

    const authRequest = await this.repository.findNativeAuthRequest(request.authRequestId);

    if (!authRequest) {
      throw authNotFound({
        code: "authRequestNotFound",
        message: "Native auth request was not found.",
        retryable: false,
        remediation: "Start sign-in again.",
        correlationId: request.correlationId
      });
    }

    if (!safeEqualHash(authRequest.pollTokenHash, hashOpaqueToken(request.pollToken))) {
      throw authUnauthorized({
        code: "authRequestNotFound",
        message: "Native auth request was not found.",
        retryable: false,
        remediation: "Start sign-in again.",
        correlationId: request.correlationId
      });
    }

    const now = new Date();

    if (authRequest.expiresAt <= now) {
      await this.repository.expireNativeAuthRequest(authRequest.authRequestId, now);
      throw authBadRequest({
        code: "authRequestExpired",
        message: "Native auth request expired.",
        retryable: false,
        remediation: "Start sign-in again.",
        correlationId: request.correlationId
      });
    }

    if (authRequest.status === "pending") {
      return {
        payloadVersion: NATIVE_AUTH_PAYLOAD_VERSION,
        status: "pending",
        expiresAt: authRequest.expiresAt.toISOString(),
        pollIntervalMs: POLL_INTERVAL_MS,
        correlationId: request.correlationId
      };
    }

    if (authRequest.status !== "completed" || !authRequest.userId || !authRequest.tenantId) {
      throw authBadRequest({
        code: "authRequestAlreadyConsumed",
        message: "Native auth request has already been consumed.",
        retryable: false,
        remediation: "Start sign-in again if you need a new session.",
        correlationId: request.correlationId
      });
    }

    const user = await this.repository.findUserById(authRequest.userId);

    if (!user || user.status !== "active") {
      throw authUnauthorized({
        code: "invalidCredentials",
        message: "The authenticated user is not active.",
        retryable: false,
        remediation: "Contact an administrator.",
        correlationId: request.correlationId
      });
    }

    const session = await this.createSessionForUser(user, userAgent, request.correlationId);
    const consumed = await this.repository.consumeNativeAuthRequest(authRequest.authRequestId, now);

    if (!consumed) {
      throw authBadRequest({
        code: "authRequestAlreadyConsumed",
        message: "Native auth request has already been consumed.",
        retryable: false,
        remediation: "Start sign-in again if you need a new session.",
        correlationId: request.correlationId
      });
    }

    return session;
  }

  async currentSessionFromAuthorization(authorization: string | undefined): Promise<NativeAuthMeResponse> {
    const token = bearerToken(authorization);

    if (!token) {
      throw authUnauthorized({
        code: "invalidCredentials",
        message: "Bearer token is required.",
        retryable: false,
        remediation: "Sign in again from the desktop app."
      });
    }

    let payload: JwtPayload;

    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      throw authUnauthorized({
        code: "invalidCredentials",
        message: "Bearer token is invalid or expired.",
        retryable: false,
        remediation: "Sign in again from the desktop app."
      });
    }

    const session = await this.repository.findActiveSession(payload.sessionId, new Date());

    if (!session || !safeEqualHash(session.accessTokenHash, hashOpaqueToken(token))) {
      throw authUnauthorized({
        code: "invalidCredentials",
        message: "Session is no longer active.",
        retryable: false,
        remediation: "Sign in again from the desktop app."
      });
    }

    const user = await this.repository.findUserById(payload.sub);

    if (!user || user.status !== "active") {
      throw authUnauthorized({
        code: "invalidCredentials",
        message: "User is no longer active.",
        retryable: false,
        remediation: "Contact an administrator."
      });
    }

    return {
      user: mapUser(user),
      sessionId: session.sessionId,
      expiresAt: session.expiresAt.toISOString()
    };
  }

  private async registerUser(
    email: string,
    password: string
  ): Promise<AuthUserRow> {
    if (!isStrongEnoughPassword(password)) {
      throw authBadRequest({
        code: "weakPassword",
        message: "Password does not meet minimum requirements.",
        retryable: false,
        remediation: "Use at least 8 characters with letters and numbers."
      });
    }

    const now = new Date();

    return this.repository.createUser({
      userId: `user_${randomUUID()}`,
      tenantId: this.configService.get<string>("AUTH_DEFAULT_TENANT_ID")?.trim() || "tenant-local",
      email,
      displayName: safeDisplayName(email),
      role: "accountant",
      passwordHash: await hashPassword(password),
      createdAt: now
    });
  }

  private async verifyLogin(email: string, password: string): Promise<AuthUserRow> {
    const user = await this.repository.findUserByEmail(email);

    if (!user || user.status !== "active" || !(await verifyPassword(password, user.passwordHash))) {
      throw authUnauthorized({
        code: "invalidCredentials",
        message: "Email or password is incorrect.",
        retryable: false,
        remediation: "Check credentials and retry."
      });
    }

    return user;
  }

  private nativeAuthReturnUrl(): string | undefined {
    return safeNativeAuthReturnUrl(this.configService.get<string>("AUTH_NATIVE_RETURN_URL"));
  }

  private async getPendingBrowserRequest(
    authRequestId: string,
    state: string
  ): Promise<NativeAuthRequestRow> {
    const authRequest = await this.repository.findNativeAuthRequest(authRequestId);

    if (
      !authRequest ||
      authRequest.status !== "pending" ||
      !safeEqualHash(authRequest.stateHash, hashOpaqueToken(state))
    ) {
      throw authNotFound({
        code: "authRequestNotFound",
        message: "Native auth request was not found.",
        retryable: false,
        remediation: "Start sign-in again."
      });
    }

    const now = new Date();

    if (authRequest.expiresAt <= now) {
      await this.repository.expireNativeAuthRequest(authRequest.authRequestId, now);
      throw authBadRequest({
        code: "authRequestExpired",
        message: "Native auth request expired.",
        retryable: false,
        remediation: "Start sign-in again."
      });
    }

    return authRequest;
  }

  private async createSessionForUser(
    user: AuthUserRow,
    userAgent: string | undefined,
    correlationId: string
  ): Promise<NativeAuthSessionResponse> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ACCESS_TOKEN_TTL_MS);
    const sessionId = `session_${randomUUID()}`;
    const accessToken = await this.jwtService.signAsync(
      {
        sub: user.userId,
        tenantId: user.tenantId,
        sessionId,
        email: user.email,
        role: user.role
      } satisfies JwtPayload,
      {
        expiresIn: Math.floor(ACCESS_TOKEN_TTL_MS / 1000)
      }
    );

    const safeUserAgent = safeOptionalLabel(userAgent);

    await this.repository.createSession({
      sessionId,
      userId: user.userId,
      tenantId: user.tenantId,
      accessTokenHash: hashOpaqueToken(accessToken),
      expiresAt,
      createdAt: now,
      ...(safeUserAgent === undefined ? {} : { userAgent: safeUserAgent })
    });

    return {
      payloadVersion: NATIVE_AUTH_PAYLOAD_VERSION,
      status: "authenticated",
      accessToken,
      expiresAt: expiresAt.toISOString(),
      user: mapUser(user),
      correlationId
    };
  }
}

export async function hashPassword(password: string, salt = randomBytes(16)): Promise<string> {
  const derivedKey = (await scrypt(password, salt, PASSWORD_KEY_LENGTH)) as Buffer;
  return `${PASSWORD_HASH_PREFIX}:${salt.toString("base64url")}:${derivedKey.toString("base64url")}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split(":");

  if (parts.length !== 4 || `${parts[0]}:${parts[1]}` !== PASSWORD_HASH_PREFIX) {
    return false;
  }

  let salt: Buffer;
  let expectedKey: Buffer;

  try {
    salt = Buffer.from(parts[2]!, "base64url");
    expectedKey = Buffer.from(parts[3]!, "base64url");
  } catch {
    return false;
  }

  const actualKey = (await scrypt(password, salt, expectedKey.length)) as Buffer;

  return expectedKey.length === actualKey.length && timingSafeEqual(expectedKey, actualKey);
}

export function hashOpaqueToken(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function buildLoginUrl(
  publicApiBaseUrl: string,
  requestId: string,
  state: string,
  preferredMode: NativeAuthPreferredMode = "login"
): string {
  const url = new URL("/api/auth/native/login", publicApiBaseUrl);
  url.searchParams.set("requestId", requestId);
  url.searchParams.set("state", state);
  url.searchParams.set("mode", preferredMode);
  return url.toString();
}

export function buildNativeLoginPage(input: {
  requestId: string;
  state: string;
  deviceLabel: string;
  preferredMode?: NativeAuthPreferredMode;
  errorMessage?: string;
}): string {
  const safeRequestId = escapeHtml(input.requestId);
  const safeState = escapeHtml(input.state);
  const safeDeviceLabel = escapeHtml(input.deviceLabel);
  const safeError = input.errorMessage ? `<div class="error">${escapeHtml(input.errorMessage)}</div>` : "";
  const isRegister = input.preferredMode === "register";
  const title = isRegister ? "Регистрация в СмартСистеме" : "Вход в СмартСистему";
  const lead = isRegister
    ? "Создайте учётную запись во внешнем браузере. Пароль не передаётся в desktop-приложение."
    : "Введите почту и пароль во внешнем браузере. Пароль не передаётся в desktop-приложение.";
  const passwordAutocomplete = isRegister ? "new-password" : "current-password";
  const primaryButton = isRegister
    ? '<button class="btn" name="mode" type="submit" value="register">Создать аккаунт</button>'
    : '<button class="btn" name="mode" type="submit" value="login">Войти</button>';
  const modeSwitch = buildNativeAuthModeSwitch(isRegister);

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>СмартСистема — ${isRegister ? "регистрация" : "вход"}</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f5f5;color:#06040e;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.card{width:min(420px,calc(100vw - 32px));border:1px solid #e1edf2;border-radius:28px;background:#fff;padding:28px}h1{margin:0 0 8px;font-size:24px;letter-spacing:-.03em}.muted{margin:0 0 18px;color:#10242f;font-size:14px;line-height:1.5}.field{display:grid;gap:6px;margin-top:12px}.field span{font-size:11px;text-transform:uppercase;color:#10242f;letter-spacing:.02em}.field input{min-height:44px;border:1px solid #e1edf2;border-radius:14px;padding:0 12px;font:inherit}.actions{display:grid;gap:10px;margin-top:18px}.btn{min-height:44px;border:0;border-radius:14px;background:#06040e;color:#e1edf2;font:inherit;font-weight:700;cursor:pointer}.switch{display:flex;justify-content:center;gap:8px;margin-top:14px;color:#10242f;font-size:13px}.switch button{border:0;background:transparent;color:#06040e;font:inherit;font-weight:700;text-decoration:underline;text-underline-offset:3px;cursor:pointer}.error{border:1px solid rgba(69,38,35,.35);border-radius:14px;background:rgba(69,38,35,.08);color:#452623;padding:10px 12px;margin-bottom:12px;font-size:13px}
</style>
</head>
<body>
<main class="card">
<h1>${title}</h1>
<p class="muted">Запрос от ${safeDeviceLabel}. ${lead}</p>
${safeError}
<form method="post" action="/api/auth/native/login">
<input type="hidden" name="requestId" value="${safeRequestId}">
<input type="hidden" name="state" value="${safeState}">
<label class="field"><span>Почта</span><input autocomplete="email" name="email" required type="email"></label>
<label class="field"><span>Пароль</span><input autocomplete="${passwordAutocomplete}" minlength="8" name="password" required type="password"></label>
<div class="actions">
${primaryButton}
</div>
${modeSwitch}
</form>
</main>
</body>
</html>`;
}

function buildNativeAuthModeSwitch(isRegister: boolean): string {
  if (isRegister) {
    return '<div class="switch"><span>Уже есть аккаунт?</span><button name="mode" type="submit" value="login">Войти</button></div>';
  }

  return '<div class="switch"><span>Нет аккаунта?</span><button name="mode" type="submit" value="register">Зарегистрироваться</button></div>';
}

export function buildNativeLoginCompletedPage(returnUrl?: string): string {
  const safeReturnUrl = safeNativeAuthReturnUrl(returnUrl);
  const metaRefresh = safeReturnUrl
    ? `<meta http-equiv="refresh" content="0;url=${escapeHtml(safeReturnUrl)}">`
    : "";
  const fallbackLink = safeReturnUrl
    ? `<a class="btn" href="${escapeHtml(safeReturnUrl)}">Открыть кабинет</a>`
    : "";
  const jsReturnUrl = safeReturnUrl === undefined ? "null" : JSON.stringify(safeReturnUrl);

  return `<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">${metaRefresh}<title>СмартСистема — открываем кабинет</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f5f5;color:#06040e;font-family:Inter,ui-sans-serif,system-ui}.card{width:min(420px,calc(100vw - 32px));border:1px solid #e1edf2;border-radius:28px;background:#fff;padding:28px}h1{margin:0 0 8px;font-size:24px}.muted{margin:0;color:#10242f;font-size:14px;line-height:1.5}.btn{display:inline-flex;align-items:center;justify-content:center;min-height:42px;margin-top:16px;border-radius:14px;background:#06040e;color:#e1edf2;padding:0 14px;text-decoration:none;font-weight:700}</style></head><body><main class="card"><h1>Открываем кабинет</h1><p class="muted">Окно СмартСистема откроется автоматически.</p>${fallbackLink}</main><script>(()=>{const returnUrl=${jsReturnUrl};if(returnUrl){window.location.replace(returnUrl);}setTimeout(()=>{window.close();},500);})();</script></body></html>`;
}

export function buildNativeLoginErrorPage(
  requestId: string,
  state: string,
  errorMessage: string,
  preferredMode: NativeAuthPreferredMode = "login"
): string {
  return buildNativeLoginPage({
    requestId,
    state,
    deviceLabel: "СмартСистема Desktop Agent",
    preferredMode,
    errorMessage
  });
}

export function buildNativeLoginInvalidRequestPage(errorMessage: string): string {
  return `<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>СмартСистема — ссылка недействительна</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f5f5;color:#06040e;font-family:Inter,ui-sans-serif,system-ui}.card{width:min(420px,calc(100vw - 32px));border:1px solid #e1edf2;border-radius:28px;background:#fff;padding:28px}h1{margin:0 0 8px;font-size:24px}.muted{margin:0;color:#10242f;font-size:14px;line-height:1.5}.error{border:1px solid rgba(69,38,35,.35);border-radius:14px;background:rgba(69,38,35,.08);color:#452623;padding:10px 12px;margin-top:14px;font-size:13px}</style></head><body><main class="card"><h1>Ссылка недействительна</h1><p class="muted">Этот запрос входа больше нельзя использовать.</p><div class="error">${escapeHtml(errorMessage)}</div></main></body></html>`;
}

function mapUser(user: AuthUserRow): NativeAuthUser {
  return {
    userId: user.userId,
    tenantId: user.tenantId,
    email: user.email,
    displayName: user.displayName,
    role: user.role
  };
}

function bearerToken(authorization: string | undefined): string | undefined {
  const value = authorization?.trim();

  if (!value?.toLowerCase().startsWith("bearer ")) {
    return undefined;
  }

  const token = value.slice("bearer ".length).trim();
  return token.length > 0 ? token : undefined;
}

function safePreferredMode(value: StartNativeAuthRequest["preferredMode"]): NativeAuthPreferredMode {
  return value === "register" ? "register" : "login";
}

function opaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

function safeEqualHash(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function safeOptionalLabel(value: string | undefined): string | undefined {
  const trimmed = value?.trim();

  if (!trimmed) {
    return undefined;
  }

  return trimmed.slice(0, 120);
}

function safeDisplayName(email: string): string {
  return email.split("@")[0]?.slice(0, 120) || "Пользователь СмартСистема";
}

function isStrongEnoughPassword(password: string): boolean {
  return password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password);
}

export function safeNativeAuthReturnUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();

  if (!trimmed) {
    return undefined;
  }

  let url: URL;

  try {
    url = new URL(trimmed);
  } catch {
    return undefined;
  }

  if (url.username || url.password || url.search || url.hash) {
    return undefined;
  }

  if (url.protocol === "automator:") {
    return url.toString();
  }

  if (url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost")) {
    return url.toString();
  }

  if (url.protocol === "https:") {
    return url.toString();
  }

  return undefined;
}

function authBrowserErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "response" in error) {
    const response = (error as { response?: { code?: string; message?: string } }).response;

    if (response?.code === "weakPassword") {
      return "Пароль должен быть не короче 8 символов и содержать буквы и цифры.";
    }

    if (response?.code === "invalidCredentials") {
      return "Почта или пароль неверные.";
    }
  }

  return "Вход не выполнен. Проверьте данные и повторите попытку.";
}

function isNativeAuthRequestUnavailable(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("response" in error)) {
    return false;
  }

  const response = (error as { response?: { code?: string } }).response;

  return (
    response?.code === "authRequestNotFound" ||
    response?.code === "authRequestExpired" ||
    response?.code === "authRequestAlreadyConsumed"
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
