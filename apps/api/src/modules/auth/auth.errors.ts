import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
  type HttpException
} from "@nestjs/common";
import type { NativeAuthError, NativeAuthErrorCode } from "@automator/contracts";

type AuthErrorOptions = {
  code: NativeAuthErrorCode;
  message: string;
  retryable: boolean;
  remediation: string;
  correlationId?: string | undefined;
};

const SAFE_METADATA_PATTERN = /^[A-Za-z0-9._:-]{1,240}$/;

export function nativeAuthError(options: AuthErrorOptions): NativeAuthError {
  const correlationId = sanitizeErrorMetadata(options.correlationId);

  return {
    code: options.code,
    message: options.message,
    retryable: options.retryable,
    remediation: options.remediation,
    ...(correlationId === undefined ? {} : { correlationId })
  };
}

export function authBadRequest(options: AuthErrorOptions): HttpException {
  return new BadRequestException(nativeAuthError(options));
}

export function authConflict(options: AuthErrorOptions): HttpException {
  return new ConflictException(nativeAuthError(options));
}

export function authNotFound(options: AuthErrorOptions): HttpException {
  return new NotFoundException(nativeAuthError(options));
}

export function authUnauthorized(options: AuthErrorOptions): HttpException {
  return new UnauthorizedException(nativeAuthError(options));
}

function sanitizeErrorMetadata(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return SAFE_METADATA_PATTERN.test(trimmed) ? trimmed : undefined;
}
