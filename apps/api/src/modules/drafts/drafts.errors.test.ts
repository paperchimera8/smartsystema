import { BadRequestException, ConflictException, ServiceUnavailableException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { draftBadRequest, draftConflict, draftCreationError, draftServiceUnavailable } from "./drafts.errors";

const baseOptions = {
  code: "invalidDraftInput" as const,
  message: "Invalid draft input.",
  retryable: false,
  remediation: "Fix the draft payload.",
  field: "fields.0.value",
  correlationId: "corr-1"
};

describe("draft error helpers", () => {
  it("keeps safe metadata in structured draft errors", () => {
    expect(draftCreationError(baseOptions)).toMatchObject({
      field: "fields.0.value",
      correlationId: "corr-1"
    });
  });

  it("redacts unsafe metadata in structured draft errors", () => {
    expect(
      draftCreationError({
        ...baseOptions,
        field: "token=secret",
        correlationId: "contains space"
      })
    ).not.toMatchObject({
      field: expect.any(String),
      correlationId: expect.any(String)
    });
  });

  it("creates typed NestJS HTTP exceptions", () => {
    expect(draftBadRequest(baseOptions)).toBeInstanceOf(BadRequestException);
    expect(draftConflict({ ...baseOptions, code: "idempotencyConflict" })).toBeInstanceOf(
      ConflictException
    );
    expect(
      draftServiceUnavailable({ ...baseOptions, code: "persistenceUnavailable", retryable: true })
    ).toBeInstanceOf(ServiceUnavailableException);
  });
});
