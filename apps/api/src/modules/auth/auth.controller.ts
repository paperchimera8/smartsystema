import { Body, Controller, Get, Header, Headers, Post, Query, Req } from "@nestjs/common";
import { ApiExcludeEndpoint, ApiTags } from "@nestjs/swagger";
import type {
  NativeAuthMeResponse,
  NativeAuthPollResponse,
  StartNativeAuthResponse
} from "@automator/contracts";
import { AuthService, buildNativeLoginInvalidRequestPage } from "./auth.service";
import { NativeBrowserLoginFormDto, PollNativeAuthDto, StartNativeAuthDto } from "./dto/native-auth.dto";

type MinimalRequest = {
  header(name: string): string | undefined;
  get(name: string): string | undefined;
  protocol?: string;
};

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly service: AuthService) {}

  @Post("native/start")
  async startNativeAuth(
    @Body() dto: StartNativeAuthDto,
    @Req() request: MinimalRequest
  ): Promise<StartNativeAuthResponse> {
    return this.service.startNativeAuth(dto, resolvePublicApiBaseUrl(dto.apiBaseUrl, request));
  }

  @Get("native/login")
  @ApiExcludeEndpoint()
  @Header("Content-Type", "text/html; charset=utf-8")
  async nativeLoginPage(
    @Query("requestId") requestId: string | undefined,
    @Query("state") state: string | undefined,
    @Query("mode") mode: string | undefined
  ): Promise<string> {
    if (!requestId || !state) {
      return buildNativeLoginInvalidRequestPage("Ссылка для входа недействительна. Запустите вход заново из окна СмартСистема.");
    }

    try {
      return await this.service.renderLoginPage(requestId, state, mode === "register" ? "register" : "login");
    } catch {
      return buildNativeLoginInvalidRequestPage("Ссылка для входа устарела или уже использована. Запустите вход заново из окна СмартСистема.");
    }
  }

  @Post("native/login")
  @ApiExcludeEndpoint()
  @Header("Content-Type", "text/html; charset=utf-8")
  async completeNativeLogin(@Body() dto: NativeBrowserLoginFormDto): Promise<string> {
    return this.service.completeBrowserLogin(dto);
  }

  @Post("native/poll")
  async pollNativeAuth(
    @Body() dto: PollNativeAuthDto,
    @Headers("user-agent") userAgent?: string
  ): Promise<NativeAuthPollResponse> {
    return this.service.pollNativeAuth(dto, userAgent);
  }

  @Get("me")
  async me(@Headers("authorization") authorization?: string): Promise<NativeAuthMeResponse> {
    return this.service.currentSessionFromAuthorization(authorization);
  }
}

function resolvePublicApiBaseUrl(clientApiBaseUrl: string | undefined, request: MinimalRequest): string {
  return normalizeClientPublicApiBaseUrl(clientApiBaseUrl) ?? publicApiBaseUrl(request);
}

function normalizeClientPublicApiBaseUrl(raw: string | undefined): string | null {
  const trimmed = raw?.trim();

  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    if (url.username || url.password || url.search || url.hash) {
      return null;
    }

    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

function publicApiBaseUrl(request: MinimalRequest): string {
  const forwardedProto = request.header("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto || request.protocol || "http";
  const host = request.header("x-forwarded-host")?.split(",")[0]?.trim() || request.get("host") || "localhost:8080";

  return `${protocol}://${host}`;
}
