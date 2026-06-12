import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
  type HttpException
} from "@nestjs/common";
import type { DraftCreationError, DraftCreationErrorCode } from "@automator/contracts";

type DraftErrorOptions = {
  code: DraftCreationErrorCode;
  message: string;
  retryable: boolean;
  remediation: string;
  field?: string | undefined;
  correlationId?: string | undefined;
};

const SAFE_ERROR_METADATA_PATTERN = /^[A-Za-z0-9._:-]{1,240}$/;
const SECRET_METADATA_MARKERS = [
  "password",
  "pwd=",
  "token",
  "access_token",
  "authorization",
  "bearer",
  "connectionstring",
  "private_key",
  "api_key",
  "apikey",
  "client_secret",
  "refresh_token"
];

export function draftCreationError(options: DraftErrorOptions): DraftCreationError {
  const field = sanitizeErrorMetadata(options.field);
  const correlationId = sanitizeErrorMetadata(options.correlationId);

  return {
    code: options.code,
    message: options.message,
    retryable: options.retryable,
    remediation: options.remediation,
    ...(field === undefined ? {} : { field }),
    ...(correlationId === undefined ? {} : { correlationId })
  };
}

export function draftBadRequest(options: DraftErrorOptions): HttpException {
  return new BadRequestException(draftCreationError(options));
}

export function draftConflict(options: DraftErrorOptions): HttpException {
  return new ConflictException(draftCreationError(options));
}

export function draftServiceUnavailable(options: DraftErrorOptions): HttpException {
  return new ServiceUnavailableException(draftCreationError(options));
}

function sanitizeErrorMetadata(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();

  if (!SAFE_ERROR_METADATA_PATTERN.test(trimmed)) {
    return undefined;
  }

  if (SECRET_METADATA_MARKERS.some((marker) => lower.includes(marker))) {
    return undefined;
  }

  return trimmed;
}
