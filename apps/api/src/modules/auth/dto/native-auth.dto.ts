import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from "class-validator";
import { NATIVE_AUTH_PAYLOAD_VERSION } from "@automator/contracts";

const SAFE_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

export class StartNativeAuthDto {
  @IsInt()
  @Min(NATIVE_AUTH_PAYLOAD_VERSION)
  @Max(NATIVE_AUTH_PAYLOAD_VERSION)
  payloadVersion!: typeof NATIVE_AUTH_PAYLOAD_VERSION;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  deviceLabel?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(login|register)$/)
  preferredMode?: "login" | "register";

  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  apiBaseUrl?: string;

  @IsString()
  @Matches(SAFE_ID_PATTERN)
  @MinLength(1)
  @MaxLength(120)
  correlationId!: string;
}

export class PollNativeAuthDto {
  @IsInt()
  @Min(NATIVE_AUTH_PAYLOAD_VERSION)
  @Max(NATIVE_AUTH_PAYLOAD_VERSION)
  payloadVersion!: typeof NATIVE_AUTH_PAYLOAD_VERSION;

  @IsString()
  @Matches(SAFE_ID_PATTERN)
  @MinLength(1)
  @MaxLength(120)
  authRequestId!: string;

  @IsString()
  @Matches(SAFE_ID_PATTERN)
  @MinLength(32)
  @MaxLength(160)
  pollToken!: string;

  @IsString()
  @Matches(SAFE_ID_PATTERN)
  @MinLength(1)
  @MaxLength(120)
  correlationId!: string;
}

export class NativeBrowserLoginFormDto {
  @IsString()
  @Matches(SAFE_ID_PATTERN)
  @MinLength(1)
  @MaxLength(120)
  requestId!: string;

  @IsString()
  @Matches(SAFE_ID_PATTERN)
  @MinLength(32)
  @MaxLength(160)
  state!: string;

  @IsString()
  @MinLength(5)
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @IsOptional()
  @IsString()
  @Matches(/^(login|register)$/)
  mode?: "login" | "register";
}
