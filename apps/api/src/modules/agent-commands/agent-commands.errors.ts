import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";

type ErrorDetail = {
  code: string;
  message: string;
  retryable: boolean;
  remediation: string;
  field?: string;
  correlationId?: string | undefined;
};

export function commandBadRequest(detail: ErrorDetail): BadRequestException {
  return new BadRequestException({ error: "AgentCommandBadRequest", ...detail });
}

export function commandNotFound(commandId: string, correlationId?: string): NotFoundException {
  return new NotFoundException({
    error: "AgentCommandNotFound",
    code: "commandNotFound",
    message: `Agent command ${commandId} was not found.`,
    retryable: false,
    remediation: "Check the command ID and retry.",
    correlationId
  });
}

export function commandConflict(detail: ErrorDetail): ConflictException {
  return new ConflictException({ error: "AgentCommandConflict", ...detail });
}
