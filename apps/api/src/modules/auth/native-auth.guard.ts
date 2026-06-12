import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable
} from "@nestjs/common";
import type { NativeAuthMeResponse } from "@automator/contracts";
import { AuthService } from "./auth.service";

type RequestWithAuth = {
  auth?: NativeAuthMeResponse;
  body?: { tenantId?: unknown };
  headers?: Record<string, string | string[] | undefined>;
  query?: { tenantId?: unknown };
};

@Injectable()
export class NativeAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const authorization = headerValue(request.headers?.authorization);
    const session = await this.authService.currentSessionFromAuthorization(authorization);
    const requestedTenantId = tenantIdFromRequest(request);

    if (requestedTenantId !== undefined && requestedTenantId !== session.user.tenantId) {
      throw new ForbiddenException({
        code: "tenantScopeMismatch",
        message: "Request tenant does not match the authenticated user tenant.",
        retryable: false,
        remediation: "Sign in with a user from the requested tenant."
      });
    }

    request.auth = session;
    return true;
  }
}

function tenantIdFromRequest(request: RequestWithAuth): string | undefined {
  const bodyTenantId = safeString(request.body?.tenantId);
  if (bodyTenantId !== undefined) {
    return bodyTenantId;
  }

  return safeString(request.query?.tenantId);
}

function safeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}
