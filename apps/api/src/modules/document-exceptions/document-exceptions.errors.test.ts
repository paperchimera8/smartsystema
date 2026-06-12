import { BadRequestException, ConflictException, ServiceUnavailableException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import {
  documentExceptionBadRequest,
  documentExceptionConflict,
  documentExceptionError,
  documentExceptionServiceUnavailable
} from "./document-exceptions.errors";

const baseOptions = {
  code: "invalidExceptionInput" as const,
  message: "Invalid exception input.",
  retryable: false,
  remediation: "Fix the exception payload.",
  field: "signals.0.message",
  correlationId: "corr-1"
};

describe("document exception error helpers", () => {
  it("keeps safe metadata in structured document-exception errors", () => {
    expect(documentExceptionError(baseOptions)).toMatchObject({
      field: "signals.0.message",
      correlationId: "corr-1"
    });
  });

  it("redacts unsafe metadata in structured document-exception errors", () => {
    expect(
      documentExceptionError({
        ...baseOptions,
        field: "password=secret",
        correlationId: "contains space"
      })
    ).not.toMatchObject({
      field: expect.any(String),
      correlationId: expect.any(String)
    });
  });

  it("creates typed NestJS HTTP exceptions", () => {
    expect(documentExceptionBadRequest(baseOptions)).toBeInstanceOf(BadRequestException);
    expect(
      documentExceptionConflict({ ...baseOptions, code: "idempotencyConflict" })
    ).toBeInstanceOf(ConflictException);
    expect(
      documentExceptionServiceUnavailable({
        ...baseOptions,
        code: "persistenceUnavailable",
        retryable: true
      })
    ).toBeInstanceOf(ServiceUnavailableException);
  });
});
